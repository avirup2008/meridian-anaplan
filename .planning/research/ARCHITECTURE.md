# Architecture Patterns: Meridian v2.0 Anaplan Integration

**Domain:** Vanilla JS SPA + Vercel serverless API, adding live Anaplan API integration
**Researched:** 2026-05-10
**Overall confidence:** HIGH (Vercel docs verified current; Anaplan API patterns confirmed via official apiary)

---

## Current State (Baseline)

```
index.html (2990 lines, all JS inline)
  └── Single screen state machine via go(screenId)
  └── Global state: uploadedFiles[], parsedModules[], generatedNotes[]
  └── API calls: fetch('/api/generate', {method:'POST'}) → JSON

api/generate.js
  └── Proxy to Gemini 2.0 Flash
  └── Default export handler (Vercel Node.js runtime)
  └── No maxDuration set (uses Vercel plan default)

vercel.json
  └── builds[] array (legacy v2 format)
  └── routes[] array
  └── Static for index.html, @vercel/node for api/generate.js
```

---

## New Architecture Overview

```
Browser (index.html)
  │
  ├── sessionStorage
  │     ├── meridian_creds  → { email, token }   [short-lived Basic Auth token]
  │     ├── meridian_ws     → selected workspaceId
  │     └── meridian_model  → selected modelId
  │
  ├── Screen: Connect   → POST /api/connect   (validates credentials, returns workspaces)
  ├── Screen: ModelPick → GET  /api/models    (lists models for workspace)
  ├── Screen: Blueprint → POST /api/blueprint (streams progress via SSE or polling)
  ├── Screen: Dashboard → POST /api/analyze   (Claude analysis, streams or chunks)
  └── Screen: Export    → POST /api/share     (Vercel Blob, returns 7-day URL)

Vercel Functions (Node.js runtime)
  ├── api/connect.js    → Anaplan auth + workspaces list
  ├── api/models.js     → Anaplan models list for workspace
  ├── api/blueprint.js  → Batched module+line-item fetch (20-40s) → SSE stream
  ├── api/analyze.js    → Claude Sonnet + Haiku analysis (30-60s) → SSE stream
  ├── api/share.js      → @vercel/blob put(), returns signed URL
  └── api/generate.js   → UNCHANGED (existing Gemini proxy)
```

---

## Question 1: Long-Running Functions — SSE vs Polling vs Chunked Response

**Recommendation: SSE (Server-Sent Events) for both /api/blueprint and /api/analyze.**

### Why SSE, Not Polling

Polling requires the client to fire repeated requests, each of which could hit a cold start and adds round-trip overhead. For /api/blueprint with 20-40s of Anaplan batch calls, polling would require holding session credentials in the browser between requests with no server-side state, or re-authenticating on every poll. SSE opens one connection and the server pushes progress events as they happen.

Chunked JSON responses (Transfer-Encoding: chunked with a single JSON payload at the end) provide no intermediate progress — the UI has no live feedback during the wait.

### SSE Implementation Pattern for Vercel Node.js Runtime

With Fluid Compute enabled by default (GA April 2025), Vercel Node.js functions run up to 300s on Hobby and 800s on Pro. Both /api/blueprint (max ~40s) and /api/analyze (max ~60s) fit within Hobby limits. Fluid Compute also eliminates most cold starts by reusing warm instances.

**Server side (each long-running function):**

```js
// api/blueprint.js
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { /* CORS preflight */ return res.status(200).end(); }

  // Set SSE headers before any await
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx/proxy buffering
  res.flushHeaders(); // Critical: send headers immediately, before async work

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { workspaceId, modelId, token } = req.body;

    // Batch 1: fetch modules
    send('progress', { phase: 'modules', count: 0, total: null, msg: 'Fetching modules...' });
    const modules = await fetchAnaplanModules(workspaceId, modelId, token);
    send('progress', { phase: 'modules', count: modules.length, total: modules.length, msg: `${modules.length} modules found` });

    // Batch 2: fetch line items per module
    let done = 0;
    for (const mod of modules) {
      const lineItems = await fetchLineItems(workspaceId, modelId, mod.id, token);
      done++;
      send('progress', { phase: 'lineItems', count: done, total: modules.length, msg: `${mod.name}` });
      mod.lineItems = lineItems;
    }

    send('done', { modules });
    res.end();
  } catch (err) {
    send('error', { message: err.message });
    res.end();
  }
}
```

**Client side (vanilla JS EventSource alternative for POST):**

Note: The browser's native `EventSource` API only supports GET requests. For POST (required to send credentials in the body, not query params), use `fetch()` with a `ReadableStream` reader instead:

```js
async function fetchBlueprint(workspaceId, modelId) {
  const creds = JSON.parse(sessionStorage.getItem('meridian_creds') || '{}');

  const resp = await fetch('/api/blueprint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, modelId, token: creds.token })
  });

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Parse SSE lines from buffer
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete last line

    let eventType = 'message';
    for (const line of lines) {
      if (line.startsWith('event: ')) { eventType = line.slice(7).trim(); }
      else if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));
        handleBlueprintEvent(eventType, data);
        eventType = 'message';
      }
    }
  }
}

function handleBlueprintEvent(type, data) {
  if (type === 'progress') updateProgressUI(data);
  else if (type === 'done') onBlueprintComplete(data.modules);
  else if (type === 'error') showBlueprintError(data.message);
}
```

This pattern works for both /api/blueprint and /api/analyze.

---

## Question 2: Monolithic vs Modular index.html

**Recommendation: Stay monolithic but impose strict internal section structure.**

### Why Not Split into ES Modules Loaded at Runtime

- The existing vercel.json uses `@vercel/static` for index.html with a wildcard route catch-all. Adding `<script type="module" src="/js/connect.js">` requires those files to be served as static assets and declared in the vercel.json builds. This adds build complexity without a build step.
- Dynamic `import()` of external JS files requires a module bundler or careful MIME-type configuration on the CDN. Without a build step, you would be loading scripts from the same static deployment — possible but adds deployment surface area.
- The app has no framework. The screen state machine (`go(screenId)`) and global vars (`parsedModules`, `uploadedFiles`, etc.) are the "framework." Splitting across files creates implicit cross-file state dependencies that are harder to debug than inline code.
- At ~3000 lines, index.html is large but not pathological. 5 new screens will add roughly 1000-1500 lines. 4500 lines in a single file is maintainable with clear section delimiters.

### Structure to Impose Within the Monolith

Divide index.html into clearly labelled zones using comment headers. All new code follows the same pattern as existing code:

```
<!-- ════ SECTION: HTML SCREENS ════ -->
<!-- Screen: s-connect -->
<!-- Screen: s-models -->
<!-- Screen: s-blueprint -->
<!-- Screen: s-dashboard -->

<script>
// ══════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════
// ... all global vars

// ══════════════════════════════════════════════
// SCREEN: CONNECT
// ══════════════════════════════════════════════

// ══════════════════════════════════════════════
// SCREEN: MODEL PICKER
// ══════════════════════════════════════════════

// (and so on per screen)
</script>
```

The one module boundary that does make sense: keep the SSE fetch helpers as named functions separate from the UI render functions. This is a logical boundary, not a file boundary.

---

## Question 3: Credential Security — sessionStorage Through to Anaplan API

### The Threat Model for This App

Meridian is a tool for Anaplan administrators and model builders. It is not a consumer app. The Anaplan Basic Auth token it uses is the user's own credential for their own workspace. The risk profile is: (1) XSS could steal the token from sessionStorage, and (2) the token could be logged server-side.

### Recommended Pattern: Token in POST Body, Scrubbed Server-Side

**Do not use query parameters for credentials.** Query params appear in Vercel access logs and browser history. POST body content does not appear in Vercel request logs by default.

**sessionStorage is acceptable for this use case** with the following conditions:
- Store only the short-lived Anaplan auth token, not the raw password. The /api/connect endpoint exchanges email+password for an Anaplan JWT token; only the JWT is stored in sessionStorage.
- Token is tab-scoped and cleared on tab close — appropriate for an admin tool.
- The raw password is never stored anywhere client-side; it is sent once to /api/connect and discarded.

**Server-side logging discipline:**

```js
// api/blueprint.js — CORRECT
const { workspaceId, modelId, token } = req.body;
// Never log token:
console.log(`Blueprint request: ws=${workspaceId} model=${modelId}`); // OK
console.log('Request body:', req.body); // BAD — logs token

// Scrub before any error reporting
const safeContext = { workspaceId, modelId }; // no token
```

**Add a scrubbing helper to all new API files:**

```js
function safeLog(msg, ctx = {}) {
  const { token, password, authorization, ...safe } = ctx;
  console.log(msg, safe);
}
```

**vercel.json: add Content-Security-Policy header** to reduce XSS surface:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "SAMEORIGIN" },
        { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self' 'unsafe-inline' cdnjs.cloudflare.com fonts.googleapis.com; style-src 'self' 'unsafe-inline' fonts.googleapis.com fonts.gstatic.com; connect-src 'self'" }
      ]
    }
  ]
}
```

Note: `unsafe-inline` is required because all JS is inline in index.html. This limits CSP value but is unavoidable without a build step.

**The /api/connect flow:**

```
Browser: POST /api/connect { email, password }
  ↓
api/connect.js:
  1. POST https://auth.anaplan.com/token/authenticate  (Basic Auth: email:password)
  2. Receive { tokenInfo: { tokenValue, expiresAt } }
  3. GET https://api.anaplan.com/2/0/workspaces
     Authorization: AnaplanAuthToken {tokenValue}
  4. Return { token: tokenValue, expiresAt, workspaces: [...] }
  (password never stored, never logged)
  ↓
Browser: sessionStorage.setItem('meridian_creds', JSON.stringify({ token, expiresAt }))
         sessionStorage.setItem('meridian_workspaces', JSON.stringify(workspaces))
```

---

## Question 4: Vercel Cold Starts on Long-Duration Endpoints

### Current Situation (2025)

Fluid Compute is enabled by default for all new projects as of April 23, 2025. It is the primary cold start mitigation. For existing projects, it can be enabled in the Vercel dashboard under Settings > Functions.

With Fluid Compute:
- Cold starts affect fewer than 0.63% of requests (Vercel's stated figure)
- Warm instances are reused across requests; bytecode is cached
- No code changes required to benefit

### Additional Mitigations for This Project

**1. Keep dependencies minimal.** Each new API file should use only built-in Node.js `fetch` and `@vercel/blob`. No heavy SDKs. Cold start time is proportional to bundle size.

```js
// Good: zero dependencies beyond fetch (built-in Node 18+)
import { put } from '@vercel/blob'; // only in api/share.js
```

**2. Set maxDuration explicitly per function.** This signals to Vercel's scheduler that the function is intended to be long-running and prevents premature termination:

```json
// vercel.json — functions section (replaces legacy builds array for new endpoints)
{
  "functions": {
    "api/blueprint.js": { "maxDuration": 60 },
    "api/analyze.js":   { "maxDuration": 90 },
    "api/connect.js":   { "maxDuration": 15 },
    "api/models.js":    { "maxDuration": 15 },
    "api/share.js":     { "maxDuration": 15 }
  }
}
```

**3. Send SSE headers before async work begins.** `res.flushHeaders()` immediately prevents Vercel's infrastructure from buffering the response and starts the clock for the open connection. This is also the pattern that prevents the "10 second silent timeout" that some community reports describe — the connection is established before any async awaits.

**4. Do not use the Edge runtime for these endpoints.** Edge runtime has a 25-second response-start window but is unsuitable for long-running Anaplan batch fetches with Node.js `fetch` chains. Stick with the Node.js runtime.

---

## Question 5: Build Order for the 5 New Endpoints

### Dependency Graph

```
/api/connect   ──────────────────────────────────── (no deps; exchanges credentials)
      │
      ▼
/api/models    ─── depends on: workspaceId from connect response
      │
      ▼
/api/blueprint ─── depends on: modelId from models response
      │
      ▼
/api/analyze   ─── depends on: blueprint data (modules + line items)
      │
      ▼
/api/share     ─── depends on: analysis result from analyze
```

### Recommended Build Order

**Phase A — Credential and Discovery (build first, unblock all UI work)**

1. `/api/connect` — validates email+password against Anaplan auth endpoint, returns token + workspace list. This is the entry point for the entire live API path. Build and test in isolation with a hardcoded test account before building any UI.

2. `/api/models` — takes workspaceId + token, calls `GET /2/0/workspaces/{workspaceId}/models`. Depends only on output of connect. Can be built same day as connect.

**Phase B — Data Acquisition (the core value, hardest to test)**

3. `/api/blueprint` — takes modelId + token, must batch across all modules and their line items. The Anaplan API returns modules and line items as separate paginated calls. This is the most complex endpoint. Implement SSE progress events from the start; the UI cannot meaningfully display results without them. Expect to spend time here on rate limiting (429 → 10s backoff) and pagination.

**Phase C — Intelligence (depends on blueprint data shape being stable)**

4. `/api/analyze` — takes the blueprint JSON, calls Claude Sonnet + Haiku. Can begin once the blueprint response schema is finalized. The SSE streaming pattern is identical to /api/blueprint so the implementation is largely copy-adapt. The main new concern is Claude API key management (add `ANTHROPIC_API_KEY` to Vercel env vars).

**Phase D — Persistence (no blocking dependencies other than analyze output shape)**

5. `/api/share` — takes analysis result, calls `@vercel/blob` `put()` with a generated key, sets `expiresAt` to 7 days. Install `@vercel/blob` and connect the Blob store in Vercel dashboard before building. This can be built in parallel with /api/analyze if the output schema is agreed upfront.

### Concrete Build Order (respecting dependencies)

| Order | Endpoint | Prerequisite | Estimated complexity |
|-------|----------|-------------|---------------------|
| 1 | /api/connect | None | Low |
| 2 | /api/models | /api/connect complete | Low |
| 3 | /api/blueprint | /api/models complete, blueprint schema agreed | High |
| 4 | /api/analyze | /api/blueprint schema stable | Medium |
| 5 | /api/share | @vercel/blob store connected | Low |

---

## vercel.json Migration

The existing `vercel.json` uses the legacy `builds[]` + `routes[]` format. The new `functions{}` key is additive and works alongside it. No migration of the existing generate.js configuration is required; add the `functions` key alongside the existing `builds` and `routes`:

```json
{
  "version": 2,
  "builds": [
    { "src": "api/generate.js", "use": "@vercel/node" },
    { "src": "index.html",      "use": "@vercel/static" }
  ],
  "functions": {
    "api/blueprint.js": { "maxDuration": 60 },
    "api/analyze.js":   { "maxDuration": 90 },
    "api/connect.js":   { "maxDuration": 15 },
    "api/models.js":    { "maxDuration": 15 },
    "api/share.js":     { "maxDuration": 15 }
  },
  "routes": [
    { "src": "/api/generate",  "dest": "/api/generate.js"  },
    { "src": "/api/connect",   "dest": "/api/connect.js"   },
    { "src": "/api/models",    "dest": "/api/models.js"    },
    { "src": "/api/blueprint", "dest": "/api/blueprint.js" },
    { "src": "/api/analyze",   "dest": "/api/analyze.js"   },
    { "src": "/api/share",     "dest": "/api/share.js"     },
    { "src": "/(.*)",          "dest": "/index.html"        }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "SAMEORIGIN" }
      ]
    }
  ]
}
```

Note: The new API files (`api/connect.js`, etc.) do not need entries in `builds[]` — Vercel auto-detects Node.js files in `/api/` when using the `functions` key. The `builds[]` entries for generate.js and index.html remain unchanged.

---

## New vs Modified Components

| Component | Status | Change |
|-----------|--------|--------|
| `index.html` | MODIFIED | Add 4 new screen HTML blocks + JS handlers for connect/models/blueprint/dashboard/export screens. Global state gains: `anaplanToken`, `selectedWorkspace`, `selectedModel`, `blueprintData`, `analysisResult`. Existing CSV path (`uploadedFiles`, `parsedModules`) unchanged. |
| `api/generate.js` | UNCHANGED | Existing Gemini proxy. No modifications. |
| `api/connect.js` | NEW | Anaplan auth token exchange + workspace list |
| `api/models.js` | NEW | Anaplan model list for selected workspace |
| `api/blueprint.js` | NEW | Batched module+line-item fetch with SSE progress |
| `api/analyze.js` | NEW | Claude analysis with SSE streaming |
| `api/share.js` | NEW | Vercel Blob store + 7-day URL generation |
| `vercel.json` | MODIFIED | Add `functions{}` key with maxDuration per endpoint, add 5 new route entries |

---

## Data Flow Through the System

```
1. CONNECT SCREEN
   User: email + password
     → POST /api/connect { email, password }
     ← { token, expiresAt, workspaces: [{id, name},...] }
   Browser stores: sessionStorage.meridian_creds = { token, expiresAt }
                   sessionStorage.meridian_workspaces = workspaces[]

2. MODEL PICKER
   User: selects workspace
     → GET /api/models?workspaceId={ws}  (token in body or custom header)
     ← { models: [{id, name, currentWorkspaceId},...] }
   Browser stores: sessionStorage.meridian_model = selectedModelId

3. BLUEPRINT FETCH
   User: clicks "Fetch Blueprint"
     → POST /api/blueprint { workspaceId, modelId, token }
     ← SSE stream:
         event: progress  data: { phase:'modules', count:N, total:T }
         event: progress  data: { phase:'lineItems', count:N, total:T }
         event: done      data: { modules:[...full blueprint...] }
   Browser stores: in-memory blueprintData (too large for sessionStorage)

4. DASHBOARD / ANALYZE
   User: clicks "Analyze"
     → POST /api/analyze { blueprintData, token? }  (token not needed if analysis is pure Claude)
     ← SSE stream:
         event: progress  data: { phase:'verdict', pct:30 }
         event: progress  data: { phase:'suggestions', pct:60 }
         event: done      data: { verdict:{...}, suggestions:[...], notes:[...] }
   Browser stores: in-memory analysisResult

5. SHARE / EXPORT
   User: clicks "Share Report"
     → POST /api/share { analysisResult, modelName }
     ← { url: "https://blob.vercel-storage.com/...", expiresAt: "2026-05-17..." }
   Browser: shows copyable URL
```

---

## Anaplan API Reference

Endpoints used by the new functions (all under `https://api.anaplan.com/2/0/`):

| Endpoint | Method | Used By |
|----------|--------|---------|
| `https://auth.anaplan.com/token/authenticate` | POST (Basic Auth header) | /api/connect |
| `/workspaces` | GET | /api/connect |
| `/workspaces/{wsId}/models` | GET | /api/models |
| `/workspaces/{wsId}/models/{mId}/modules` | GET | /api/blueprint |
| `/workspaces/{wsId}/models/{mId}/modules/{modId}/lineItems` | GET | /api/blueprint |

All Anaplan API requests use `Authorization: AnaplanAuthToken {token}` header (not Basic Auth — Basic Auth is only for the initial token exchange at auth.anaplan.com).

Workspace IDs must be lowercase; model IDs must be uppercase. Rate limit is tenant-wide; on 429, wait for `Retry-After` header value (recommended: hardcode 10s minimum backoff).

---

## Architecture Anti-Patterns to Avoid

### Anti-Pattern 1: Storing raw password in sessionStorage
**What goes wrong:** XSS or browser extension reads `sessionStorage.meridian_creds.password` and exfiltrates it.
**Instead:** Exchange credentials for a token in /api/connect; store only the token. Token has limited scope (Anaplan workspace access only) and an expiry.

### Anti-Pattern 2: Using EventSource (native browser API) for credential-bearing SSE
**What goes wrong:** `new EventSource('/api/blueprint?token=abc')` puts the token in the query string, which lands in Vercel access logs permanently.
**Instead:** Use `fetch()` with `ReadableStream` reader and POST body for credentials. See client-side pattern in Question 1.

### Anti-Pattern 3: Single unbatched call to fetch all modules + line items
**What goes wrong:** Anaplan API returns modules and line items in separate paginated calls. A naive implementation tries to `Promise.all()` 50+ line-item fetches simultaneously, hitting the tenant rate limit (429) and failing silently.
**Instead:** Sequential per-module fetch with explicit 10s backoff on 429, streaming progress events to the client so the user sees activity.

### Anti-Pattern 4: Not calling `res.flushHeaders()` before the first await
**What goes wrong:** The SSE headers are buffered by Node.js/Vercel infrastructure until the function returns or the buffer fills. The client sees nothing for 20-40 seconds then gets a complete response dump — not a stream.
**Instead:** Call `res.flushHeaders()` immediately after setting SSE headers, before any `await`.

### Anti-Pattern 5: Splitting index.html into runtime-loaded modules without a build step
**What goes wrong:** `<script src="/js/connect.js">` files are not declared in `vercel.json` builds, so they are not deployed, or their MIME types are wrong, or cross-file global state creates subtle ordering bugs.
**Instead:** Keep the monolith; use strict comment section headers to maintain readability.

---

## Confidence Assessment

| Area | Confidence | Source |
|------|------------|--------|
| Vercel maxDuration limits with Fluid Compute | HIGH | Official Vercel docs, verified 2026-02-27 |
| SSE via fetch+ReadableStream for POST | HIGH | Vercel community + multiple implementation guides |
| Anaplan auth token exchange pattern | MEDIUM | Official Apiary docs; exact endpoint response shape should be validated against a live account before building |
| Vercel Blob `put()` API | HIGH | Official @vercel/blob docs |
| Cold start behavior with Fluid Compute | HIGH | Vercel blog + official docs, GA April 2025 |
| sessionStorage credential risk | HIGH | OWASP, multiple security sources |
| vercel.json `functions` key alongside legacy `builds` | MEDIUM | Docs show both patterns; compatibility of mixing them should be tested on first deploy |

---

## Sources

- [Vercel Functions: Configuring Maximum Duration](https://vercel.com/docs/functions/configuring-functions/duration)
- [Vercel Functions Limits](https://vercel.com/docs/functions/limitations)
- [Vercel Fluid Compute](https://vercel.com/docs/fluid-compute)
- [Scale to One: How Fluid Solves Cold Starts](https://vercel.com/blog/scale-to-one-how-fluid-solves-cold-starts)
- [Vercel Blob](https://vercel.com/docs/vercel-blob)
- [Anaplan Integration API V2 (Apiary)](https://anaplan.docs.apiary.io/)
- [Anaplan API — Structure of a request](https://help.anaplan.com/structure-of-an-api-request-bcddc03e-9c46-4174-9bae-347cf77a45d4)
- [Anaplan — Get your list of models](https://help.anaplan.com/get-your-list-of-models-15281ada-7854-4205-9559-c5323ac43c06)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [Vercel Project Configuration](https://vercel.com/docs/project-configuration)
