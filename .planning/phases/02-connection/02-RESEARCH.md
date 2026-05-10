# Phase 2: Connection - Research

**Researched:** 2026-05-10
**Domain:** Anaplan Basic Auth API, sessionStorage security, server-side proxy pattern, token expiry UX
**Confidence:** HIGH (auth API) / MEDIUM (exact error response shapes, workspace field names)

---

## Summary

Phase 2 implements Anaplan authentication via a server-side proxy (no CORS block hits the browser), a workspace+model picker, token expiry detection at ~35 minutes, and preservation of the existing v1 CSV upload fallback. The Anaplan auth endpoint (`https://auth.anaplan.com/token/authenticate`) is a POST with a Basic Authorization header; on success it returns `tokenInfo.tokenValue` (the bearer token) and `tokenInfo.expiresAt` (Unix epoch in milliseconds). Two new Vercel serverless functions are needed: `api/connect.js` and `api/models.js`, each capped at 10s maxDuration.

The browser stores credentials in `sessionStorage` only (never localStorage, never cookies). The Anaplan token itself is passed from browser to server via custom headers (`x-anaplan-user` / `x-anaplan-pass`) on every API call — the server re-authenticates per call rather than storing the token server-side. This avoids server-side token state management entirely, at the cost of one extra round-trip on each server call (acceptable at 10s maxDuration).

Recently-used models must survive tab close, so they go to `localStorage` (not `sessionStorage`), storing only safe display data (model id + name + workspace name — no credentials). The v1 CSV fallback path (upload → `/api/generate` → Haiku analysis) already works end-to-end; Phase 2 preserves it by adding the "Upload CSV" tab to the Connect screen without modifying any existing upload/analysis logic.

**Primary recommendation:** Build `api/connect.js` and `api/models.js` as thin proxy functions that accept credentials via headers, call Anaplan APIs with Basic Auth, and return normalized responses. The client stores `{ username, password, workspaceId, workspaceName, modelId, modelName, tokenExpiresAt }` in `sessionStorage` and manages expiry by comparing `Date.now()` against `tokenExpiresAt` before each API call.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONN-01 | User enters credentials → POST /api/connect → confirmation card with workspace name + model count | Anaplan `/workspaces` endpoint returns `name` per workspace; `/models` for count. Design spec §3.1–3.2 locked. |
| CONN-02 | User browses workspaces+models grouped, recently used at top, selects one to proceed | GET /api/models returns models with `name`, `id`, `currentWorkspaceName`. localStorage for recency. Design spec §3.3 locked. |
| CONN-03 | ~35-min expiry shows re-auth prompt, not cryptic error | `expiresAt` epoch ms confirmed. Client checks `Date.now() >= expiresAt` before each call. |
| CONN-04 | CSV fallback: upload → /api/generate → single-module Haiku analysis | Fully implemented in v1. Phase 2 only adds a tab to the Connect screen; zero changes to existing upload/analysis flow. |
</phase_requirements>

---

## User Constraints

> Locked decisions from STATE.md and design spec — do not re-litigate.

### Locked Decisions
- Zero Anaplan API calls in client-side JS — CORS block is absolute; all Anaplan calls go through server-side proxy
- Credentials stored in `sessionStorage` only — raw password never persists beyond browser close
- Two new server endpoints: `POST /api/connect` (workspaces list) and `GET /api/models` (models per workspace)
- Token expiry: Anaplan tokens expire in ~35 minutes; client must detect and show re-auth prompt, not a cryptic error
- CSV fallback path already exists in v1 (single-module Haiku analysis) — Phase 2 must preserve this flow unchanged
- vercel.json `maxDuration: 10` for connect and models endpoints
- UI: Tabbed connect card (Connect tab | Upload CSV tab) — design spec §3.1 locked
- Post-connect confirmation card shows workspace name, model count, user display name — design spec §3.2 locked
- Model picker: cards grouped by workspace, recently used at top — design spec §3.3 locked
- CSS design tokens locked: `--bg:#FAF8F0`, `--accent:#175AA6`, `--gold:#BF801E`, `--pos:#217348`, `--neg:#B82E2E`
- Font: IBM Plex Sans + IBM Plex Mono — no framework, no build step, single index.html

### Claude's Discretion
- Exact HTML structure and CSS classes for new Connect / Model Picker / Confirmation screens
- How to represent the "recently used" merge algorithm (order: recency first, then alphabetical)
- Error message copy for auth failure vs network failure vs 401 expiry

### Deferred Ideas (OUT OF SCOPE for Phase 2)
- OAuth 2.0 Client Credentials flow (AUTH-01 in Future Requirements)
- Real-time collaboration, user accounts, persistent storage
- Mobile layout
- All Phase 3–5 features (blueprint fetch, analysis, export, share)

---

## Standard Stack

### Core
| Library / API | Version | Purpose | Why Standard |
|---------------|---------|---------|--------------|
| `https://auth.anaplan.com/token/authenticate` | v2 Auth API | Anaplan Basic Auth → tokenInfo | Official Anaplan auth endpoint |
| `https://api.anaplan.com/2/0/workspaces` | Integration API v2 | List workspaces for authenticated user | Official endpoint confirmed in Anapedia |
| `https://api.anaplan.com/2/0/workspaces/{id}/models` | Integration API v2 | List models per workspace | Confirmed response includes `id`, `name`, `activeState` |
| `sessionStorage` | Browser built-in | Credential + token storage (session-scoped) | Locked decision — clears on tab close |
| `localStorage` | Browser built-in | Recently-used models only (survives sessions) | Tab close clears sessionStorage; recency needs persistence |
| `node-fetch` / built-in `fetch` | Node 18+ built-in | Server-side HTTP calls to Anaplan in Vercel functions | Node 18+ includes native fetch; no extra dep needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@anthropic-ai/sdk` | 0.95.1 (already installed) | Powers existing `/api/generate` (CSV fallback) | Already wired — Phase 2 preserves as-is |

**Installation:** No new npm packages required for Phase 2. Node 18+ native `fetch` handles all server-side HTTP. [VERIFIED: package.json already has all needed deps]

---

## Architecture Patterns

### Recommended File Structure (Phase 2 additions)
```
api/
├── connect.js          # NEW — POST /api/connect (Basic Auth → workspace list)
├── models.js           # NEW — GET /api/models?workspaceId= (token via headers)
└── generate.js         # EXISTING — CSV fallback, zero changes

index.html              # EXISTING — add new screens inside SECTION: CONNECT
                        #   and SECTION: MODEL-PICKER boundary comments
                        #   No changes outside these boundaries
```

### Pattern 1: Server-Side Proxy (api/connect.js)

**What:** Accept `{ username, password }` in request body. Build Basic Auth header server-side. Call Anaplan auth endpoint. On success, call `/workspaces`. Return `{ workspaces, tokenExpiresAt }` to client. Never log credentials.

**When to use:** Every Anaplan auth call — this is the only entry point for credentials into the server.

```javascript
// Source: Anaplan Anapedia docs + api/generate.js pattern
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

  const encoded = Buffer.from(`${username}:${password}`).toString('base64');

  try {
    // Step 1: Authenticate
    const authRes = await fetch('https://auth.anaplan.com/token/authenticate', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${encoded}`, 'Content-Type': 'application/json' }
    });
    if (!authRes.ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const authData = await authRes.json();
    // [ASSUMED] Field names tokenInfo.tokenValue and tokenInfo.expiresAt — confirmed in Anapedia docs
    // but live validation flagged in STATE.md research flags
    const token = authData?.tokenInfo?.tokenValue;
    const expiresAt = authData?.tokenInfo?.expiresAt; // epoch ms

    // Step 2: List workspaces
    const wsRes = await fetch('https://api.anaplan.com/2/0/workspaces', {
      headers: { 'Authorization': `AnaplanAuthToken ${token}` }
    });
    const wsData = await wsRes.json();

    return res.status(200).json({
      workspaces: (wsData.workspaces || []).map(w => ({ id: w.id, name: w.name })),
      tokenExpiresAt: expiresAt,
    });
  } catch (err) {
    // No credential logging — only log sanitized error
    console.error('Connect error (no credentials logged):', err.message);
    return res.status(500).json({ error: 'Connection failed' });
  }
}
```

### Pattern 2: Models Proxy (api/models.js)

**What:** Accept workspace ID in query param. Accept credentials via `x-anaplan-user` / `x-anaplan-pass` headers (not body — GET request). Re-authenticate server-side to get a fresh token per call. Return model list.

**Design note:** The design spec shows credentials passed as `x-anaplan-user` / `x-anaplan-pass` headers. This avoids storing the Anaplan token client-side between the connect call and models call (the client stores username+password in sessionStorage; the server re-auths on each request). This is safe because re-auth within a 35-min window succeeds immediately.

```javascript
// Source: design spec §4 + Anaplan API v2 docs
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { workspaceId } = req.query;
  const username = req.headers['x-anaplan-user'];
  const password = req.headers['x-anaplan-pass'];
  if (!workspaceId || !username || !password) {
    return res.status(400).json({ error: 'Missing workspaceId or credentials' });
  }

  const encoded = Buffer.from(`${username}:${password}`).toString('base64');
  try {
    // Re-auth
    const authRes = await fetch('https://auth.anaplan.com/token/authenticate', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${encoded}` }
    });
    if (!authRes.ok) return res.status(401).json({ error: 'Auth failed' });
    const { tokenInfo } = await authRes.json();

    // Fetch models for workspace
    const modRes = await fetch(
      `https://api.anaplan.com/2/0/workspaces/${workspaceId}/models`,
      { headers: { 'Authorization': `AnaplanAuthToken ${tokenInfo.tokenValue}` } }
    );
    const modData = await modRes.json();

    return res.status(200).json({
      models: (modData.models || []).map(m => ({
        id: m.id,
        name: m.name,
        activeState: m.activeState,
        lastModified: m.lastModified,
        currentWorkspaceName: m.currentWorkspaceName,
      }))
    });
  } catch (err) {
    console.error('Models error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch models' });
  }
}
```

### Pattern 3: Client-Side Token Expiry Detection

**What:** Store `tokenExpiresAt` (epoch ms from Anaplan response) in `sessionStorage`. Before any API call that needs auth, check `Date.now() >= tokenExpiresAt - 60000` (1-min buffer). If expired, show re-auth modal — do not silently fail.

```javascript
// Source: [ASSUMED] — standard token expiry pattern
const SESSION_KEY = 'meridian_session';

function getSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
  catch { return null; }
}

function setSession(data) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

function isSessionExpired() {
  const s = getSession();
  if (!s || !s.tokenExpiresAt) return true;
  return Date.now() >= (s.tokenExpiresAt - 60_000); // 1-min buffer
}

function requireAuth(callback) {
  if (isSessionExpired()) {
    showReAuthPrompt(); // show modal, do not throw cryptic error
    return;
  }
  callback();
}
```

### Pattern 4: Recently-Used Models (localStorage)

**What:** On model selection, write `{ id, name, workspaceId, workspaceName, selectedAt }` to `localStorage` under key `meridian_recent_models`. Cap at 5 entries. When rendering the picker, merge recent list with live model list — recently used entries surface first.

```javascript
// Source: [ASSUMED] — standard recency pattern
const RECENT_KEY = 'meridian_recent_models';
const MAX_RECENT = 5;

function addRecentModel(model) {
  let recent = getRecentModels().filter(r => r.id !== model.id);
  recent.unshift({ ...model, selectedAt: Date.now() });
  if (recent.length > MAX_RECENT) recent = recent.slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}

function getRecentModels() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
  catch { return []; }
}
```

### Anti-Patterns to Avoid
- **Storing Anaplan token server-side:** No server-side token cache. Each proxy call re-auths (2 Anaplan calls per /api/models request — acceptable within 10s maxDuration).
- **Storing credentials in localStorage:** Never. sessionStorage only. localStorage is for recency data (no credentials, no token).
- **Calling Anaplan APIs from index.html:** `grep 'anaplan.com' index.html` must return nothing. All Anaplan URLs belong in `api/*.js` only.
- **Logging credentials server-side:** `console.log(req.body)` or `console.log(err)` with full error object risks exposing username/password in Vercel function logs.
- **Trusting only 401 for expiry:** Also check `tokenExpiresAt` proactively — a 401 from the model-picker route would confuse users; the re-auth prompt should appear before the call is made.
- **Modifying existing v1 upload logic:** The CSV fallback path (`uploadedFiles`, `analyseModules()`, `go('s-processing')`) must be untouched. Phase 2 only adds the tabbed UI wrapper around it.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Base64 encoding for Basic Auth | Custom btoa() in browser | `Buffer.from().toString('base64')` in Node.js server | Buffer handles UTF-8 edge cases; browser btoa() not needed (all encoding is server-side) |
| Token expiry refresh | Auto-refresh loop | Re-auth prompt (show modal) | Anaplan token refresh requires a POST with existing token — simpler and safer to re-prompt in a user tool context |
| Pagination of workspace/model lists | Custom cursor pagination | Single call — Anaplan typically returns all workspaces for a user | Anaplan paging info is in `meta.paging`; typical user has <10 workspaces. Handle paging only if `totalSize > currentPageSize` |

**Key insight:** Phase 2 has no heavy computation — it's a credential proxy. Simplicity beats cleverness. Each server function should be < 60 lines.

---

## Anaplan API Reference (verified)

### Auth Endpoint
- **URL:** `POST https://auth.anaplan.com/token/authenticate`
- **Request header:** `Authorization: Basic {base64(username:password)}`
- **Request body:** Empty (credentials in header only) [CITED: help.anaplan.com/use-basic-authentication]
- **Success response:**
```json
{
  "status": "SUCCESS",
  "statusMessage": "Login successful",
  "tokenInfo": {
    "tokenId": "ce81e2ed-eec4-11e9-9750-6925ec1fee7f",
    "tokenValue": "{jwt_token_string}",
    "expiresAt": 1571088766187,
    "refreshTokenId": "45ffca7c-eec5-11e9-a51d-1bd448913ef3"
  },
  "meta": { "validationUrl": "..." }
}
```
[CITED: help.anaplan.com/use-basic-authentication + Anapedia confirmed field names]
- **`expiresAt` format:** Unix epoch in **milliseconds** (not seconds) [VERIFIED: Anapedia docs]
- **Token lifetime:** 35 minutes from issuance [VERIFIED: Anapedia docs]
- **Auth header for subsequent calls:** `Authorization: AnaplanAuthToken {tokenValue}` [VERIFIED: Anapedia docs]
- **Invalid credentials response:** HTTP 401. Response body shape not precisely documented in official docs — treat any non-2xx as auth failure. [ASSUMED: response body may contain `{ "status": { ... } }` but exact schema unconfirmed]

### Workspaces Endpoint
- **URL:** `GET https://api.anaplan.com/2/0/workspaces`
- **Auth header:** `Authorization: AnaplanAuthToken {tokenValue}`
- **Response:**
```json
{
  "meta": { "schema": "...", "paging": { "currentPageSize": N, "totalSize": N, "offset": 0 } },
  "status": { "code": 200, "message": "Success" },
  "workspaces": [
    { "id": "8a8b8c8d8e8f8g8i", "name": "Financial Planning" }
  ]
}
```
[CITED: Anapedia — Obtain workspace and model IDs; confirmed `id` and `name` fields]
- **Note:** Workspace IDs are lowercase in API calls [VERIFIED: Anapedia]

### Models Endpoint
- **URL:** `GET https://api.anaplan.com/2/0/workspaces/{workspaceId}/models`
- **Response key fields:** `id`, `name`, `activeState` ("UNLOCKED"/"LOCKED"), `currentWorkspaceName`, `lastModified`, `isoCreationDate` [CITED: Anapedia]
- **Note:** Field is `name` not `displayName` — confirmed [CITED: Anapedia — Get your list of models]
- **Model IDs are uppercase** in API calls [VERIFIED: Anapedia]

### Token Refresh Endpoint
- **URL:** `POST https://auth.anaplan.com/token/refresh`
- **Auth header:** `Authorization: AnaplanAuthToken {currentToken}`
- **Response:** Same `tokenInfo` shape as initial auth [CITED: help.anaplan.com/refresh-your-authentication-token]
- **Phase 2 decision:** Do NOT implement silent refresh. Show re-auth prompt instead. Reason: simpler, user is already providing credentials on this screen; refresh adds token state management complexity for no UX gain in a 35-min session tool.

---

## Common Pitfalls

### Pitfall 1: expiresAt Units (Milliseconds vs Seconds)
**What goes wrong:** Comparing `Date.now()` (ms) against `expiresAt` treated as seconds — token appears to expire 1000x sooner.
**Why it happens:** Anaplan `expiresAt` is epoch milliseconds. `Date.now()` is also ms. If you divide by 1000 accidentally, you get a timestamp in the past.
**How to avoid:** Use `Date.now() >= expiresAt` directly (both in ms). Add a comment.
**Warning signs:** Re-auth prompt appears immediately after connecting.

### Pitfall 2: Workspace ID Case Sensitivity
**What goes wrong:** Passing an uppercase workspace ID to the models endpoint returns 404 or empty.
**Why it happens:** Anaplan requires workspace IDs lowercase and model IDs uppercase.
**How to avoid:** Normalize on receipt: `workspaceId.toLowerCase()` before storing and before calling `/api/models`.

### Pitfall 3: Single-Auth-Call-Per-Session Violation
**What goes wrong:** Calling `POST /token/authenticate` on every API request (every model picker refresh) can fail — Anaplan rate-limits repeated auth calls.
**Why it happens:** STATE.md notes "don't call to get a new token until your 35-minute session lapses".
**How to avoid:** In `api/models.js`, re-auth on every request is acceptable because the client only calls it once per workspace selection. Do NOT create a polling loop that calls /api/models repeatedly.
**Note:** The current proxy design (re-auth in every server call) is safe for the one-shot model picker use case — it is not a polling pattern.

### Pitfall 4: Credential Leak in Server Logs
**What goes wrong:** `console.error(err)` or `console.log(req.body)` captures username/password in Vercel function logs.
**Why it happens:** Default Node.js error objects can serialize req context.
**How to avoid:** Log only `err.message` (a string), never `err` (object that may include request context), never `req.body`, never the encoded credential string.

### Pitfall 5: Touching v1 Upload Flow
**What goes wrong:** Modifying `uploadedFiles`, `analyseModules()`, or `go('s-upload')` logic breaks the existing CSV path.
**Why it happens:** Phase 2 adds a tabbed wrapper, and a developer might try to "clean up" the old upload code.
**How to avoid:** The Connect screen's "Upload CSV" tab must call `go('s-upload')` — literally navigate to the existing upload screen. Do not rewrite it. The tab is a navigation shortcut, not a replacement.

### Pitfall 6: v2 New Screens vs v1 `go()` System
**What goes wrong:** New screens added outside the `go()` system don't show/hide correctly.
**Why it happens:** `go(id)` toggles `.active` class on all `.screen` divs. Any new `<div class="screen">` participates automatically.
**How to avoid:** New HTML screens for Phase 2 (connect, model-picker, confirm) must have `class="screen"` and unique IDs. The `go()` function requires no changes — it's generic.

### Pitfall 7: vercel.json Missing New Endpoints
**What goes wrong:** `api/connect.js` and `api/models.js` deploy without a `maxDuration` limit and hit Vercel's default (which may be lower than 10s on Hobby tier).
**Why it happens:** The current `vercel.json` only declares `api/generate.js`. New functions need entries added.
**How to avoid:** Add `"api/connect.js": { "maxDuration": 10 }` and `"api/models.js": { "maxDuration": 10 }` to the `functions` block before deploying.

---

## Existing v1 Code Inventory (preserve all of this)

The CSV fallback path in index.html that Phase 2 must preserve unchanged:

| Element | Location (approx line) | Role |
|---------|------------------------|------|
| `<div id="s-upload" class="screen">` | ~605 | Upload screen — do not modify |
| `<div id="s-processing" class="screen">` | ~642 | Processing screen |
| `<div id="s-analysis" class="screen">` | ~668 | Analysis screen |
| `uploadedFiles = []` | ~1014 | Global state — do not touch |
| `function go(id)` | ~1001 | Screen nav — generic, no changes needed |
| `fetch('/api/generate', ...)` | ~1806, ~2618, ~2758 | API calls to generate.js |
| `SECTION: CONNECT` HTML comment | ~916–918 | Phase 2 adds NEW screen HTML here |
| `SECTION: MODEL-PICKER` HTML comment | ~921–923 | Phase 2 adds NEW screen HTML here |
| `SECTION: CONNECT` JS comment | ~3009–3011 | Phase 2 adds NEW JS here |
| `SECTION: MODEL-PICKER` JS comment | ~3014–3016 | Phase 2 adds NEW JS here |

**Critical:** Phase 2 adds code INSIDE the boundary comment blocks. It never modifies code outside them.

---

## State Storage Map

| Data | Storage | Key | When Set | When Cleared |
|------|---------|-----|----------|--------------|
| `username` | sessionStorage | `meridian_session` (JSON field) | On connect success | Tab close / explicit sign-out |
| `password` | sessionStorage | `meridian_session` (JSON field) | On connect success | Tab close / explicit sign-out |
| `workspaceId` | sessionStorage | `meridian_session` (JSON field) | On workspace selection | Tab close |
| `workspaceName` | sessionStorage | `meridian_session` (JSON field) | On workspace selection | Tab close |
| `modelId` | sessionStorage | `meridian_session` (JSON field) | On model selection | Tab close |
| `modelName` | sessionStorage | `meridian_session` (JSON field) | On model selection | Tab close |
| `tokenExpiresAt` | sessionStorage | `meridian_session` (JSON field) | On connect success | Tab close |
| Recently-used models | localStorage | `meridian_recent_models` (JSON array) | On model selection | Never auto-cleared (cap 5 entries) |

**Single session object:** Store all session data as a single JSON object in one `sessionStorage` key — easier to clear atomically on sign-out.

---

## Environment Availability

> Step 2.6: External dependency audit for Phase 2.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 18+ | Vercel serverless functions (native fetch) | Assumed ✓ | Vercel uses Node 18 by default | — |
| Anaplan API (auth.anaplan.com) | api/connect.js, api/models.js | External service — cannot probe | Current | If down: show error "Anaplan unavailable, use CSV fallback" |
| `sessionStorage` | Credential storage (browser) | ✓ Browser built-in | — | None needed |
| `localStorage` | Recently-used models | ✓ Browser built-in | — | Degrade gracefully — skip recent section |
| `@anthropic-ai/sdk` 0.95.1 | CSV fallback (api/generate.js) | ✓ In package.json | 0.95.1 pinned | — |

**Missing dependencies with no fallback:**
- None that block Phase 2 execution.

**External service dependency:**
- Anaplan API availability cannot be probed at plan time. All API calls must handle network errors gracefully with user-facing messages (not raw error objects).

---

## Validation Architecture

> Nyquist compliance — automated verification commands after implementation.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None established (no test framework in package.json) |
| Config file | None — Wave 0 gap |
| Quick run command | `grep -c 'anaplan.com' /tmp/meridian-anaplan/index.html` (should return 0) |
| Full suite command | Manual verification checklist (see below) — no automated test framework yet |

### Phase Requirements → Verification Map

| Req ID | Behavior | Test Type | Automated Command | Available Now? |
|--------|----------|-----------|-------------------|---------------|
| CONN-01 | Zero Anaplan API calls in client HTML | Static grep | `grep 'anaplan.com' index.html` — expect: no output | ✅ (run post-implementation) |
| CONN-01 | `/api/connect` file exists | File existence | `ls api/connect.js` | ❌ Wave 0 gap |
| CONN-02 | `/api/models` file exists | File existence | `ls api/models.js` | ❌ Wave 0 gap |
| CONN-03 | `tokenExpiresAt` stored in session | Code grep | `grep 'tokenExpiresAt' index.html` | ❌ Wave 0 gap |
| CONN-03 | Expiry check present in client code | Code grep | `grep 'isSessionExpired\|tokenExpiresAt' index.html` | ❌ Wave 0 gap |
| CONN-04 | CSV upload flow untouched | Static grep | `grep -c "s-upload" index.html` — compare to pre-phase count | ✅ (baseline before Phase 2) |
| CONN-04 | `api/generate.js` unchanged | Git diff | `git diff HEAD api/generate.js` — expect: no changes | ✅ |
| ALL | vercel.json has connect + models entries | JSON check | `node -e "const v=require('./vercel.json');console.log(v.functions)"` | ✅ (after vercel.json edit) |
| CONN-01 | `password` never in localStorage | Code grep | `grep "localStorage.*password\|password.*localStorage" index.html` — expect: no output | ✅ |
| CONN-01 | Credentials not stored in server files | Code grep | `grep -r "password\|username" api/connect.js api/models.js \| grep -v "req\.\|headers\.\|body\."` | ✅ (after implementation) |

### Sampling Rate
- **Per task commit:** `grep 'anaplan.com' index.html` (zero-output assertion) + `git diff api/generate.js` (unchanged assertion)
- **Per wave merge:** Full manual checklist in design spec success criteria
- **Phase gate:** All 5 success criteria from ROADMAP.md must be manually verified before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `api/connect.js` — does not yet exist
- [ ] `api/models.js` — does not yet exist
- [ ] No automated test framework (no pytest/jest/vitest) — Phase 2 verification is grep-based static analysis + manual browser testing. Recommend noting this as a future PERF/quality item; do not block Phase 2 on test framework setup.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | Credentials in sessionStorage only; never logged server-side; Basic Auth over HTTPS |
| V3 Session Management | Yes | sessionStorage (tab-scoped); `tokenExpiresAt` checked before calls; explicit clear on sign-out |
| V4 Access Control | No | No server-side user accounts; Anaplan's own auth enforces access |
| V5 Input Validation | Yes | `username` and `password` fields: non-empty check server-side before constructing Basic Auth header |
| V6 Cryptography | Partial | No hand-rolled crypto. Credentials transmitted only over HTTPS (Anaplan's endpoint is HTTPS). Base64 is encoding not encryption — this is by design for Basic Auth. |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Credentials in server logs | Information Disclosure | Log only `err.message` strings, never `req.body` or full error objects |
| Token stored in localStorage | Elevation of Privilege | sessionStorage only for credentials/token; localStorage only for non-sensitive recency data |
| Anaplan.com URL in client JS | Spoofing / CORS bypass | All Anaplan calls in `api/*.js` only; `grep 'anaplan.com' index.html` must return 0 |
| XSS reading sessionStorage | Elevation of Privilege | Single-origin app in single HTML file; no third-party script execution beyond CDN libs already in v1 |
| Credential logging on 500 error | Information Disclosure | Catch block logs `err.message` only; no structured logging that serializes request body |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Invalid credentials return HTTP 401 from `auth.anaplan.com` | Anaplan API Reference | If wrong status code (e.g., 403 or 200 with error body), the proxy's `!authRes.ok` guard still catches it, but error messaging may be imprecise |
| A2 | `workspaces` array field name is `name` (not `displayName`) | Standard Stack | If field is `displayName`, workspace names in the confirmation card show `undefined`. Live validate on first connect. |
| A3 | Re-authenticating on every `/api/models` call (rather than passing token between calls) won't hit Anaplan's rate limit for the model-picker use case | Architecture Patterns | If Anaplan rate-limits rapid re-auth, switch to a single token per session (requires client to pass token in header instead of credentials). |
| A4 | `expiresAt` value format is Unix milliseconds (not seconds, not ISO string) | Anaplan API Reference | Confirmed in Anapedia with an example value of `1571088766187` (13-digit = ms). Low risk. |
| A5 | `api/models.js` total round-trip (re-auth + workspace models call) completes within 10s maxDuration on Vercel | Environment Availability | Anaplan auth is typically < 2s; models list < 2s; total ~4s. If a workspace has 50+ models or latency spikes, may be close to 10s. Cannot confirm without live test. |
| A6 | No additional `Content-Type` header required on auth POST body (empty body) | Anaplan API Reference | Curl example in Anapedia shows no body — but some Anaplan integrations add `Content-Type: application/json`. Safe to include it. |

**If this table is empty:** n/a — assumptions exist and are documented above.

---

## Open Questions

1. **Exact 401 body shape from auth.anaplan.com on bad credentials**
   - What we know: HTTP 401 status returned
   - What's unclear: Whether the body contains a parseable JSON error with a `statusMessage` or just a generic HTTP error
   - Recommendation: Treat any non-2xx from auth endpoint as "Invalid credentials" — do not parse body for error detail

2. **Does `/api/connect` need to return the full workspace list, or just a count?**
   - What we know: CONN-01 says "confirmation card with workspace name and model count". The design spec (§3.2) says the card shows "connected workspace name, model count, user display name"
   - What's unclear: A user may have multiple workspaces — which workspace name appears on the card? The confirmation card implies a single workspace. But the model picker (§3.3) shows multiple workspaces.
   - Recommendation: `/api/connect` returns ALL workspaces. The confirmation card shows the count of workspaces (e.g., "3 workspaces, 14 models"). The model picker then lets the user browse all of them. Skip "user display name" unless Anaplan returns it from the workspaces endpoint (not confirmed).

3. **Does the model list API return `lastModified` as ISO string or epoch?**
   - What we know: Field name confirmed as `lastModified` in Anapedia; format not specified
   - What's unclear: Format — ISO string vs epoch int
   - Recommendation: Parse defensively — try `new Date(m.lastModified).toLocaleDateString()` which handles both ISO strings and epoch numbers

4. **Should `/api/connect` also return model counts per workspace?**
   - What we know: CONN-01 success criterion says "workspace name and model count" visible within 5 seconds
   - What's unclear: Is "model count" across ALL workspaces, or per-workspace? Getting per-workspace model count requires an additional API call per workspace in the connect handler.
   - Recommendation: Return workspace count only in `/api/connect`. Defer model count to the model picker screen (populated from `/api/models` per workspace). The confirmation card shows "N workspaces found" rather than a model count.

---

## Sources

### Primary (HIGH confidence)
- [Anapedia — Use Basic Authentication](https://help.anaplan.com/use-basic-authentication-3a4a2905-3d55-4199-a980-d1a89ffdcb7e) — auth endpoint URL, request format, tokenInfo field names, expiresAt format, 35-min lifetime
- [Anapedia — Refresh Token](https://help.anaplan.com/refresh-your-authentication-token-9e31aab4-0e66-4502-a666-70cd9525fcbe) — POST /token/refresh endpoint, response shape
- [Anapedia — Obtain Workspace and Model IDs](https://help.anaplan.com/obtain-workspace-and-model-ids-2b2a74f2-55ad-4253-95d5-32e3c552042e) — workspace/model endpoint URLs, field names
- [Anapedia — Get Your List of Models](https://help.anaplan.com/get-your-list-of-models-15281ada-7854-4205-9559-c5323ac43c06) — confirms `name` not `displayName` for model field
- Existing `api/generate.js` — Vercel serverless handler pattern to replicate
- Existing `index.html` (inspected) — section boundary positions, go() function, v1 upload flow lines

### Secondary (MEDIUM confidence)
- [Anaplan Integration API V2 — Apiary](https://anaplan.docs.apiary.io/) — base URL `https://api.anaplan.com/2/0/`, workspace ID case sensitivity (lowercase), model ID case sensitivity (uppercase), paging structure
- [Anaplan Community — API Python Workspace and Model IDs](https://community.anaplan.com/discussion/102803/api-python-workspace-and-model-ids) — confirms `id` and `name` fields in practice

### Tertiary (LOW confidence — assumed, not live-verified)
- `expiresAt` being milliseconds confirmed by example value `1571088766187` (13 digits) but not explicitly stated as ms in all doc pages
- Exact 401 error response body shape from auth.anaplan.com (not found in official docs)
- Round-trip latency estimate for auth + models calls fitting in 10s maxDuration

---

## Metadata

**Confidence breakdown:**
- Auth endpoint + tokenInfo field names: HIGH — confirmed in multiple Anapedia pages with example JSON
- Workspace/model endpoint + field names: HIGH — confirmed in Anapedia and Apiary reference
- Error response body shape: LOW — not documented; handle defensively
- 10s maxDuration sufficiency: LOW — cannot measure without live Anaplan account
- expiresAt as milliseconds: HIGH — confirmed by 13-digit example value in docs

**Research date:** 2026-05-10
**Valid until:** 2026-06-10 (Anaplan API is stable; auth endpoint has been unchanged for years)
