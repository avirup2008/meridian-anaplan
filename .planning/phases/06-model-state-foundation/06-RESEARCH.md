# Phase 6: Model State Foundation — Research

**Researched:** 2026-05-14
**Domain:** Anaplan REST API v2 (model-level lineItems endpoint), compact text serialization, evidence admissibility gating, Vercel SSE + Blob, vanilla JS SPA navigation
**Confidence:** HIGH (existing codebase verified; architecture patterns proven in v2.0; Anaplan endpoint shape is the only UNCONFIRMED item — a spike is required before locking the design)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Fetch `/modules` and `GET /models/{id}/lineItems?includeAll=true` in parallel simultaneously — two calls, one round-trip of latency, no per-module batching loop.
- **D-02:** Module names come from the `/modules` call; line items are grouped by module ID from the model-level call. The serialization step joins them by ID.
- **D-03:** Whether `includeAll=true` on the model-level endpoint returns formula text is UNCONFIRMED. Phase 6 plan MUST include a live API spike (hit the endpoint, log the response shape) before committing to the design. If formulas are absent, fall back to: model-level call for structure, formula text fetched per-module only.
- **D-04:** New endpoint lives in `api/model-state.js`. The old `api/blueprint.js` is deleted.
- **D-05:** Compact model state is written to Vercel Blob under the `model-state/` prefix (distinct from the old `blueprints/` prefix).
- **D-06:** Blob URL is passed downstream to analyze/chat/build endpoints — consistent with the v2.0 pattern.
- **D-07:** `cleanup.js` cron must add `model-state/` to its PREFIXES array so state Blobs expire after 7 days alongside reports.
- **D-08:** SSE is still used for the fetch screen. Server sends named stage events: `'Authenticating…'` → `'Loading model structure…'` → `'Serializing state…'` → `'Writing state…'` → `'Done'`. No module-by-module counter.
- **D-09:** On the SSE `complete` event, the client auto-navigates to the dashboard with the **Model tab** active (not the Health tab, which was v2.0 default).
- **D-10:** Old `blueprints/` Blobs from v2.0 shared reports are left to expire naturally via the 7-day TTL cron. No migration, no backward-compatible reader, no explicit invalidation.
- **D-11:** `api/blueprint.js` is fully replaced by `api/model-state.js`. No parallel running. `api/generate.js` (CSV fallback) is unaffected.

### Claude's Discretion

- Exact compact serialization format (column order, separator characters, line item row structure) — Claude chooses the most token-efficient text format that preserves all fields.
- Evidence admissibility threshold values (e.g., what % formula coverage triggers a gate) — Claude sets sensible defaults; these can be tuned after testing.
- SSE stage message wording and timing.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MSF-01 | System fetches complete model state via a single model-level lineItems API call (replacing per-module batching) | D-01/D-02: parallel `/modules` + `/lineItems?includeAll=true`; existing `blueprint.js` per-module loop is the before-state |
| MSF-02 | Model state is serialized into a compact, token-efficient text format (~45K tokens for a 228-module model) | Serialization design section; target derived from INTELLIGENCE_REBUILD_PLAN.md compact-state goal |
| MSF-03 | Evidence pack is produced with admissibility gates (fetch completeness, formula coverage, dependency graph density, naming coverage) | Evidence Pack section; gate logic lifted from INTELLIGENCE_REBUILD_PLAN.md product contract |
| MSF-04 | System identifies and excludes decorator/separator modules from analysis automatically | Already implemented in `analysis-core.js`; MSF-04 moves this exclusion into model-state.js at fetch time so state Blob is already clean |
| MSF-05 | Incomplete fetches surface a visible evidence-limit warning; blocked conclusions are listed explicitly in the UI | UI change in index.html s-fetch screen + dashboard evidence-limits section |

</phase_requirements>

---

## Summary

Phase 6 replaces `api/blueprint.js` (an N+1 per-module loop, up to ~8 concurrent workers, ~52-second budget) with `api/model-state.js` (two parallel API calls + serialization + Blob write). The new endpoint fetches `/modules` and `/workspaces/{wsId}/models/{modelId}/lineItems?includeAll=true` simultaneously, joins them by module ID, filters decorator/separator modules, serializes to a compact line-per-item text format, computes an evidence pack, and writes both to Vercel Blob.

The only design risk is whether `includeAll=true` on the model-level lineItems endpoint actually returns formula text. The existing v2.0 `blueprint.js` calls the per-module endpoint `/modules/{modId}/lineItems?includeAll=true` and successfully retrieves formulas (confirmed by `analysis-core.js` using `li.formula`). The model-level version `/models/{modelId}/lineItems?includeAll=true` is a different endpoint — its response shape is UNCONFIRMED from codebase evidence alone. D-03 mandates a live API spike as the first task of Phase 6 before committing to the parallel-call design.

The rest of the implementation is well-understood: all SSE, Blob, auth, and CORS patterns are copied verbatim from the proven v2.0 functions. The main new work is the serialization algorithm (token-efficiency design) and the evidence pack computation (four gate values + blocked-conclusions list).

**Primary recommendation:** Run the API spike first (one task). Confirm the response shape, then build `api/model-state.js` using the reusable patterns below. The v2.0 → v3.0 transition is a clean file replacement: delete `api/blueprint.js`, add `api/model-state.js`, update `vercel.json`, update `index.html` SSE handler + navigation, update `cleanup.js`.

---

## Standard Stack

### Core (no new packages required)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@vercel/blob` | `^2.3.3` [VERIFIED: npm registry 2026-05-10] | Write compact state to Blob; read in downstream analyze/chat endpoints | Already installed; proven in v2.0 blueprint + share + cache writes |
| `@anthropic-ai/sdk` | `^0.95.1` [VERIFIED: npm registry 2026-05-10] | Not used in model-state.js itself — downstream consumer in analyze-v3.js | Already installed |
| Node.js built-in `fetch` | Node 18+ [VERIFIED: Vercel runtime] | All Anaplan API calls (server-to-server proxy) | Zero-dependency; no SDK exists for Anaplan |

**No new packages needed for Phase 6.** All work is done with existing dependencies.

### Anaplan API Endpoints Used

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `https://auth.anaplan.com/token/authenticate` | POST (Basic header) | Fresh auth token for fetch session | CONFIRMED — same as blueprint.js |
| `/2/0/workspaces/{wsId}/models/{modelId}/modules` | GET | Module names + IDs | CONFIRMED — proven in blueprint.js |
| `/2/0/workspaces/{wsId}/models/{modelId}/lineItems?includeAll=true` | GET | All line items across model | UNCONFIRMED shape — spike required |

**Installation:** No changes to package.json needed.

---

## Architecture Patterns

### Pattern 1: Parallel Fetch + Join (D-01, D-02)

The model-level endpoint is the v3.0 replacement for the N+1 per-module loop. Two calls fire simultaneously; the join happens in memory.

```javascript
// Source: D-01/D-02 decisions; adapted from blueprint.js auth pattern
const [modRes, liRes] = await Promise.all([
  fetch(`https://api.anaplan.com/2/0/workspaces/${wsId}/models/${modelId}/modules`, {
    headers: { 'Authorization': `AnaplanAuthToken ${token}` },
  }),
  fetch(`https://api.anaplan.com/2/0/workspaces/${wsId}/models/${modelId}/lineItems?includeAll=true`, {
    headers: { 'Authorization': `AnaplanAuthToken ${token}` },
  }),
]);

// Both must succeed before proceeding
if (!modRes.ok || !liRes.ok) { /* send SSE error */ return; }

const { modules } = await modRes.json();          // [{ id, name, ... }]
const { items }   = await liRes.json();            // [{ moduleId, name, formula, ... }]

// Join by moduleId
const byModuleId = new Map();
for (const li of items) {
  const key = li.moduleId || li.module?.id;        // field name TBD — spike confirms
  if (!byModuleId.has(key)) byModuleId.set(key, []);
  byModuleId.get(key).push(li);
}

const assembledModules = modules.map(mod => ({
  id: mod.id,
  name: mod.name,
  lineItems: byModuleId.get(mod.id) || [],
}));
```

**Critical unknown:** The field name for module ID on each line item in the model-level response. On the per-module endpoint, there is no `moduleId` field because the module is the URL parameter. The model-level endpoint MUST attach a module identifier to each line item row — but whether that field is `moduleId`, `module.id`, `parentModuleId`, or something else is UNCONFIRMED. The spike must log the raw response before any join logic is written.

### Pattern 2: Compact Text Serialization (MSF-02, Claude's Discretion)

The target is ~45K tokens for a 228-module model. The v2.0 blueprint JSON averages ~2-5 MB for a model of that size. The v3.0 format must be at least 10x smaller.

**Design principle:** One line per object; tab-separated key fields; omit null/empty fields; no JSON nesting. The serialization produces a UTF-8 text file, not JSON.

```
// Proposed format (Claude's discretion — adjust column order for token density):
// MODULE lines introduce a module; ITEM lines follow indented.
// Format: MODULE\t{id}\t{name}\t{prefix}
//         CALC\t{name}\t{format}\t{summary}\t{formula_truncated}
//         INPUT\t{name}\t{format}\t{summary}
// Separator: blank line between modules; --- between sections

MODULE\tSYS01 Revenue Model\tSYS
CALC\tRevenue\tNumber\tSum\tQuantity * Unit Price
CALC\tUnit Price\tNumber\tNone\tLOOKUP(Price List.Price, ...)
INPUT\tBudget Flag\tBoolean\tNone

MODULE\tDAT02 Customer List\tDAT
INPUT\tCustomer Name\tText\tNone
```

**Token budget math** [ASSUMED — validated by measuring output]:
- 228 modules × average 50 line items = 11,400 line items
- Per CALC line: ~30 tokens (name + format + summary + truncated formula at 150 chars)
- Per INPUT line: ~15 tokens (name + format + summary)
- Per MODULE header: ~10 tokens
- Estimated total: 228 × 10 + 8,000 × 30 + 3,400 × 15 = ~297K chars → ~74K tokens at GPT-4 tokenization rate
- With formula truncation at 80 chars: ~45-50K tokens — achievable

**Formula truncation:** Truncate formula text at 150 characters for CALC lines. Full formula text is never needed for the comprehension and health use cases. The dependency graph only needs module name references, which appear in the first 50 characters of most Anaplan formulas.

### Pattern 3: Evidence Pack (MSF-03)

The evidence pack is a small JSON object computed server-side alongside the text state. It is written to Blob as a separate key or embedded in the `complete` SSE event and stored by the client.

```javascript
// Source: INTELLIGENCE_REBUILD_PLAN.md § Evidence Admissibility
function computeEvidencePack(modules, fetchedModuleIds, totalModuleCount) {
  const functional = modules.filter(m => !m.isDecorator);
  const withFormulas = functional.filter(m => m.lineItems.some(li => li.formula));
  const withNames = functional.filter(m => /^[A-Z]{2,5}\d{2}\s/.test(m.name));  // DISCO prefix pattern
  const totalEdges = computeDependencyEdges(functional);

  const fetchCompleteness = totalModuleCount > 0
    ? fetchedModuleIds.size / totalModuleCount
    : 0;
  const formulaCoverage = functional.length > 0
    ? withFormulas.length / functional.length
    : 0;
  const graphDensity = functional.length > 1
    ? Math.min(1, totalEdges / (functional.length * 2))  // normalise: expect ~2 edges/module
    : 0;
  const namingCoverage = functional.length > 0
    ? withNames.length / functional.length
    : 0;

  return {
    fetchCompleteness,           // 0–1; threshold: 0.95
    formulaCoverage,             // 0–1; threshold: 0.5
    graphDensity,                // 0–1; threshold: 0.3
    namingCoverage,              // 0–1; threshold: 0.6
    blockedConclusions: computeBlockedConclusions({
      fetchCompleteness, formulaCoverage, graphDensity, namingCoverage
    }),
  };
}
```

**Admissibility thresholds** [Claude's Discretion — starting defaults]:
| Gate | Threshold | Blocked when below |
|------|-----------|-------------------|
| `fetchCompleteness` | 0.95 | Architecture claims, health workstreams |
| `formulaCoverage` | 0.50 | Formula anti-pattern checks, dependency graph |
| `graphDensity` | 0.30 | Cross-module dependency diagram |
| `namingCoverage` | 0.60 | DISCO architecture map, prefix classification |

**`blockedConclusions`** is an array of plain-English strings the UI renders verbatim in the evidence-limit warning panel. Example: `"Dependency diagram suppressed — graph density 0.18 (minimum 0.30 required)"`.

### Pattern 4: SSE Stage Events (D-08)

`api/model-state.js` fires four named stage events, not a per-module counter. This is a deliberate simplification: two parallel API calls produce no per-module progress naturally.

```javascript
// Source: blueprint.js SSE pattern — copied verbatim, stage names changed
// CRITICAL: flushHeaders() BEFORE first await
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache, no-transform');
res.setHeader('Connection', 'keep-alive');
res.setHeader('X-Accel-Buffering', 'no');
res.flushHeaders();  // BEFORE any await

function sendEvent(obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
  if (typeof res.flush === 'function') res.flush();
}

// Stage sequence:
sendEvent({ type: 'stage', stage: 'auth',        label: 'Authenticating…' });
// ... auth ...
sendEvent({ type: 'stage', stage: 'loading',     label: 'Loading model structure…' });
// ... Promise.all([modRes, liRes]) ...
sendEvent({ type: 'stage', stage: 'serializing', label: 'Serializing state…' });
// ... serialize + compute evidence pack ...
sendEvent({ type: 'stage', stage: 'writing',     label: 'Writing state…' });
// ... Blob put() ...
sendEvent({ type: 'complete', stateUrl: putResult.url, evidencePack: pack, moduleCount, lineItemCount });
```

### Pattern 5: Auth (copy verbatim from blueprint.js)

```javascript
// Source: api/blueprint.js lines 178-193 — copy verbatim
const username = req.headers['x-anaplan-user'];
const password = req.headers['x-anaplan-pass'];
const encoded = Buffer.from(`${username}:${password}`).toString('base64');
const authRes = await fetch('https://auth.anaplan.com/token/authenticate', {
  method: 'POST',
  headers: { 'Authorization': `Basic ${encoded}`, 'Content-Type': 'application/json' },
  body: ''
});
const authData = await authRes.json();
const token = authData?.tokenInfo?.tokenValue;
```

### Pattern 6: Blob Write (copy from blueprint.js)

```javascript
// Source: api/blueprint.js lines 239-244
import { put } from '@vercel/blob';
const putResult = await put(`model-state/${modelId}-${Date.now()}.txt`, serializedText, {
  access: 'public',
  contentType: 'text/plain',  // text, not JSON — compact format
  allowOverwrite: true,
});
// putResult.url → sent in 'complete' SSE event as stateUrl
```

### Pattern 7: Decorator Exclusion (reuse analysis-core.js)

`isDecorativeModuleName()` is already exported from `api/analysis-core.js`. `api/model-state.js` must import and apply it during assembly — so the Blob written to `model-state/` contains only functional modules.

```javascript
// Source: api/analysis-core.js line 93
import { isDecorativeModuleName } from './analysis-core.js';

const functional = assembledModules.filter(m => !isDecorativeModuleName(m.name));
const decorators = assembledModules.filter(m => isDecorativeModuleName(m.name));
// functional → serialized to Blob
// decorators → counted in evidence pack only (excludedModuleCount)
```

### Recommended File Structure

No new directories. New and changed files only:

```
api/
├── model-state.js      NEW — replaces blueprint.js
├── blueprint.js        DELETED
├── cleanup.js          MODIFIED — add 'model-state/' to PREFIXES array
├── analyze.js          MODIFIED — rename blueprintUrl param to stateUrl; update cache prefix (v21+)
├── analysis-core.js    UNCHANGED (isDecorativeModuleName imported by model-state.js)
├── _cors.js            UNCHANGED
└── ...all others       UNCHANGED

vercel.json             MODIFIED — replace blueprint route with model-state; same maxDuration: 60
index.html              MODIFIED — update s-fetch SSE handler; update navigation on complete event;
                                   add evidence-limit warning panel
```

### Anti-Patterns to Avoid

- **Keeping blueprint.js alongside model-state.js:** D-11 is a hard delete. Running both creates confusion about which downstream endpoints receive which URL format.
- **Sending the full JSON blob to Claude:** The compact text format exists for this reason. Never pass the raw Anaplan API response to an LLM.
- **Skipping flushHeaders() before the first await:** The SSE stream will buffer silently and deliver all events at the end. This is the #1 SSE pitfall in the v2.0 codebase.
- **Treating "not found in a grep" as "confirmed does not exist":** The model-level lineItems endpoint response shape is confirmed ONLY by a live API call. Training data about Anaplan API field names may be wrong.
- **Writing both text state AND evidence pack as separate Blob objects:** Keep it simple — write the compact text state to Blob; pass the evidence pack inline in the `complete` SSE event and store it in sessionStorage client-side. Only one Blob write per fetch.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CORS helper | Custom headers in model-state.js | `applyCors(req, res)` from `_cors.js` | Already handles origin allowlist, preview deploys, localhost |
| Decorator detection | New regex in model-state.js | `isDecorativeModuleName()` from `analysis-core.js` | Already handles edge cases: symbol ratio, heading style, empty names |
| SSE stream setup | Ad-hoc headers | Copy the exact 4-line header block + `flushHeaders()` from blueprint.js | X-Accel-Buffering is critical — easy to miss |
| Blob TTL | Custom expiry tracking | Existing `cleanup.js` cron — just add `'model-state/'` to PREFIXES | Already proven; runs daily at 03:00 UTC |
| Token budget estimation | Ship and measure | Use the truncated-formula format from the architecture section | If over 60K tokens, reduce formula truncation length from 150 to 80 chars |

**Key insight:** The v2.0 codebase already solved every infrastructure problem in Phase 6. The only net-new code is: (1) the parallel fetch + join, (2) the compact serializer, and (3) the evidence pack computation.

---

## Common Pitfalls

### Pitfall 1: Model-Level lineItems Response May Paginate

**What goes wrong:** The per-module endpoint returns all line items for one module in a single call (small enough). The model-level endpoint returns ALL line items across ALL modules — for a 228-module model with 50 items each, that is 11,400 rows. Anaplan REST API v2 uses cursor-based pagination on some list endpoints. If the model-level endpoint paginates, a single fetch only returns the first page.

**Why it happens:** Developers assume "includeAll=true" means all results in one call. The `includeAll` flag in Anaplan API refers to including all field types (formulas, formats, etc.) — it does NOT disable pagination. [ASSUMED — confirm via spike]

**How to avoid:** In the spike, check the response for `meta.paging` or a `nextPage` cursor. If pagination exists, implement a `while (cursor)` loop identical to how `cleanup.js` handles `list()` pagination from Vercel Blob.

**Warning signs:** Response `items` array count is a round number (100, 500, 1000) that is suspiciously smaller than expected total line item count.

### Pitfall 2: Module ID Field Name on Model-Level Line Items Is Unknown

**What goes wrong:** The join logic in Pattern 1 above assumes `li.moduleId` or `li.module.id`. If the actual field name is different (e.g., `li.moduleInfo.id`, `li.parentModule`, or a nested object), all line items end up in the fallback bucket and the assembled modules have zero line items.

**Why it happens:** The per-module endpoint never returns a `moduleId` field because the module is the URL context. The model-level endpoint must use a different field — but which one is undocumented in available sources. [ASSUMED — spike required]

**How to avoid:** Log `items[0]` raw from the spike. Identify the module linkage field before writing any join code. Write a defensive join that warns loudly (SSE error event) if no items join to any module.

### Pitfall 3: Compact Serialization Exceeds Token Target

**What goes wrong:** The 45K-token target is an estimate based on a 228-module model. A model with 500 modules and 100 items each will produce a 2-3x larger state. If Phase 7 or Phase 8 passes the full state Blob to Claude in one call, a larger-than-expected model overflows context.

**Why it happens:** Token count depends on formula complexity, not just item count. Models with long, complex formulas will produce larger compact text files.

**How to avoid:** Include `lineItemCount` and a `tokenEstimate` field in the `complete` SSE event. Phase 7/8 must check this estimate before sending to Claude and apply chunking or sliding-window strategies if the estimate exceeds 120K tokens.

**Warning signs:** Formula-heavy calculation modules with formulas >400 characters each. A single module with 200+ calc items and long formulas can add 8K tokens on its own.

### Pitfall 4: Client SSE Handler Still Listens for Old Event Types

**What goes wrong:** The existing `fetchBlueprint()` in index.html listens for `evt.type === 'progress'` (with `modulesDone`, `modulesTotal`, `lineItemCount` fields) and `evt.type === 'schema-preview'`. The new `api/model-state.js` sends `evt.type === 'stage'` with `{ stage, label }`. If the client handler is not updated, the fetch screen shows no progress updates at all.

**Why it happens:** The fetch screen HTML exists at line 1305 of index.html with UI elements (`fetch-modules-done`, `fetch-modules-total`, `fetch-lineitems-total`) that are wired to the `progress` event type. These DOM IDs need either updating or replacing.

**How to avoid:** Update both the SSE event handler in `fetchBlueprint()` AND the HTML element references together. The new fetch screen can be simpler — four stage labels with no numeric counters.

### Pitfall 5: blueprintBlobUrl in localStorage Is Stale After Phase 6 Deploy

**What goes wrong:** v2.0 stores `meridian.blueprintBlobUrl` in `localStorage`. v3.0 will store `meridian.stateUrl`. If a user has a live session from before the Phase 6 deploy, their localStorage has the old key pointing to a `blueprints/` Blob. The analysis tab will attempt to fetch from the old Blob URL which may have already expired, or pass the old JSON format to `analyze-v3.js` which expects the new compact text format.

**Why it happens:** localStorage persists across deploys in the user's browser.

**How to avoid:** Use a different localStorage key (`meridian.stateUrl` instead of `meridian.blueprintBlobUrl`). Presence of the old key with no new key → redirect to fetch screen. This is a clean version boundary, not a migration.

---

## Code Examples

### api/model-state.js — Complete File Skeleton

```javascript
// Source: adapted from api/blueprint.js; reuses _cors.js, analysis-core.js patterns
import { put } from '@vercel/blob';
import { applyCors } from './_cors.js';
import { isDecorativeModuleName } from './analysis-core.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { workspaceId, modelId } = req.body;
  if (!workspaceId || !modelId) return res.status(400).json({ error: 'Missing workspaceId or modelId' });

  const wsId = workspaceId.toLowerCase();
  const username = req.headers['x-anaplan-user'];
  const password = req.headers['x-anaplan-pass'];
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

  // CRITICAL: SSE headers BEFORE first await
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  function sendEvent(obj) {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  }

  try {
    // Stage 1: Auth
    sendEvent({ type: 'stage', stage: 'auth', label: 'Authenticating…' });
    const token = await authenticate(username, password);
    if (!token) { sendEvent({ type: 'error', message: 'Auth failed — please reconnect' }); return; }

    // Stage 2: Load model structure (parallel)
    sendEvent({ type: 'stage', stage: 'loading', label: 'Loading model structure…' });
    const [modules, lineItems] = await fetchModelStructure(wsId, modelId, token);

    // Stage 3: Serialize
    sendEvent({ type: 'stage', stage: 'serializing', label: 'Serializing state…' });
    const { text: stateText, functional, decorators, evidencePack } = serialize(modules, lineItems);

    // Stage 4: Write
    sendEvent({ type: 'stage', stage: 'writing', label: 'Writing state…' });
    const blob = await put(`model-state/${modelId}-${Date.now()}.txt`, stateText, {
      access: 'public',
      contentType: 'text/plain',
      allowOverwrite: true,
    });

    sendEvent({
      type: 'complete',
      stateUrl: blob.url,
      evidencePack,
      moduleCount: functional.length,
      excludedCount: decorators.length,
      lineItemCount: functional.reduce((s, m) => s + m.lineItems.length, 0),
    });

  } catch (err) {
    console.error('model-state error:', err.message);
    sendEvent({ type: 'error', message: err.message });
  } finally {
    res.end();
  }
}
```

### cleanup.js — Minimal Change Required

```javascript
// Source: api/cleanup.js line 8 — add 'model-state/' to PREFIXES
const PREFIXES = ['reports/', 'blueprints/', 'analysis-cache-v14/', 'analysis-narrative-cache-v2/', 'model-state/'];
```

### vercel.json — Route Change

```json
// Replace:
"api/blueprint.js": { "maxDuration": 60 }
// With:
"api/model-state.js": { "maxDuration": 60 }
```

No route entries exist in the current `vercel.json` — it uses `rewrites` not `routes`, so the API files are auto-detected. No `rewrites` change needed.

### index.html — SSE Handler Update (s-fetch screen)

```javascript
// Replace old fetchBlueprint() SSE dispatch:
// OLD: if (evt.type === 'progress') { update module counter... }
// NEW:
if (evt.type === 'stage') {
  currentEl.textContent = evt.label;
  const stageMap = { auth: 15, loading: 40, serializing: 75, writing: 90 };
  fillEl.style.width = (stageMap[evt.stage] || 10) + '%';
} else if (evt.type === 'complete') {
  fillEl.style.width = '100%';
  // D-09: store stateUrl (not blueprintBlobUrl), navigate to Model tab
  localStorage.setItem('meridian.stateUrl', evt.stateUrl || '');
  sessionStorage.setItem('meridian.evidencePack', JSON.stringify(evt.evidencePack || {}));
  localStorage.setItem('meridian.stateMeta', JSON.stringify({
    moduleCount: evt.moduleCount,
    lineItemCount: evt.lineItemCount,
    excludedCount: evt.excludedCount,
    fetchedAt: new Date().toISOString(),
  }));
  go('s-dashboard');          // navigate to dashboard
  activateTab('model');       // D-09: Model tab, not Health tab
} else if (evt.type === 'error') {
  fetchErr.style.display = 'block';
  fetchErr.textContent = evt.message || 'Unknown error';
}
```

### index.html — Evidence-Limit Warning (MSF-05)

```html
<!-- Add to s-fetch screen and/or dashboard panel: -->
<div id="evidence-limit-warning" style="display:none" class="evidence-warning" role="alert">
  <strong>Evidence Limits</strong>
  <p>This fetch is incomplete. The following conclusions are blocked:</p>
  <ul id="blocked-conclusions-list"></ul>
</div>

<script>
// Render evidence-limit warning from evidencePack.blockedConclusions
function renderEvidenceLimits(evidencePack) {
  const panel = document.getElementById('evidence-limit-warning');
  const list = document.getElementById('blocked-conclusions-list');
  if (!evidencePack || !evidencePack.blockedConclusions || !evidencePack.blockedConclusions.length) {
    panel.style.display = 'none'; return;
  }
  list.innerHTML = evidencePack.blockedConclusions
    .map(c => `<li>${c}</li>`).join('');
  panel.style.display = 'block';
}
</script>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-module line item fetch loop (N+1 calls, 8 concurrent workers, 52s budget) | Single model-level call + parallel modules call | Phase 6 | Removes 226 API calls for a 228-module model; ~15-20s instead of 45-52s |
| All modules serialized to JSON (2-5 MB Blob) | Functional modules only serialized to compact text (~100-200 KB) | Phase 6 | 10x token reduction; decorator modules excluded at source |
| Blueprint Blob stored under `blueprints/` prefix | Model state stored under `model-state/` prefix | Phase 6 | Clean version boundary; no mixed-format reads |
| Client navigates to Health tab after fetch | Client navigates to Model tab after fetch | Phase 6 | Model tab is Phase 7's primary new feature |

**Deprecated by Phase 6:**
- `api/blueprint.js` — deleted; no longer referenced from any endpoint or UI
- `localStorage.meridian.blueprintBlobUrl` — replaced by `localStorage.meridian.stateUrl`
- `api/analyze.js` param `blueprintUrl` — renamed to `stateUrl` when analyze-v3.js is built in Phase 7

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `GET /models/{modelId}/lineItems?includeAll=true` exists as a Anaplan REST API v2 endpoint and returns all line items across modules in one call | Architecture Patterns §Pattern 1 | If endpoint does not exist or has different base path, D-01 collapses → fall back to D-03 per-module formula fetch |
| A2 | Model-level lineItems response attaches a module identifier to each line item (as `moduleId` or similar field) | Architecture Patterns §Pattern 1 critical unknown | If no module ID on line items, join is impossible → need to use per-module endpoint for structure |
| A3 | Model-level lineItems endpoint returns formula text when `includeAll=true` is set | D-03 | If formulas absent, must call per-module endpoints for formula text (fall back described in D-03) |
| A4 | Model-level lineItems endpoint does NOT paginate at small model sizes, or paginates with a standard cursor field | Pitfall 1 | If pagination is present and not handled, large models return incomplete state without error |
| A5 | Token estimate of ~45K for 228-module model is achievable with 150-char formula truncation | Standard Stack §token budget math | If actual token count is 2x higher, Phase 7/8 must implement chunked state delivery to Claude |
| A6 | `activateTab('model')` or equivalent function exists or can be added to index.html without breaking existing tab state machine | index.html §SSE handler update | If tab activation is tightly coupled to analysis flow, D-09 requires more invasive UI refactoring |

**If this table has entries:** Items A1-A4 are all resolved by the mandatory API spike (D-03 task). A5 is resolved by measuring actual output on a test model. A6 is resolved by reading the dashboard tab activation code in index.html before writing the SSE handler update.

---

## Open Questions

1. **Does the model-level lineItems endpoint exist and what is its full URL?**
   - What we know: Anaplan REST API v2 has `/models/{id}/lineItems` documented in Apiary. The query param `includeAll=true` is used on the per-module endpoint and may work on the model-level endpoint too.
   - What's unclear: Exact URL, whether it works, what `includeAll` actually controls at this level, and how formulas are represented.
   - Recommendation: First task of Phase 6 is a spike: authenticate, call the endpoint, `console.log(JSON.stringify(response, null, 2))` and inspect the shape. Takes 30 minutes. All other tasks block on this result.

2. **Does `analyze.js` need to change in Phase 6, or only in Phase 7?**
   - What we know: `analyze.js` currently receives `blueprintUrl` (pointing to `blueprints/` prefix Blob containing full JSON). Phase 6 produces `stateUrl` (pointing to `model-state/` prefix Blob containing compact text).
   - What's unclear: Whether Phase 6 ships `analyze-v3.js` as a stub, or leaves `analyze.js` functional for CSV-uploaded blueprints only, or renames the parameter.
   - Recommendation: Phase 6 does NOT touch `analyze.js`. The CSV path and existing shared reports continue to use `analyze.js` with `blueprintUrl`. The new `analyze-v3.js` (Phase 7) will consume `stateUrl`. This preserves backward compatibility for the CSV path during the v3.0 build period.

3. **What is the correct dashboard tab system to hook for D-09 navigation?**
   - What we know: The existing tab system uses `activeTab` variable and a `switch()` in the dashboard JS section (index.html line 4307 area). The v2.0 code sets `activeTab = 'verdict'` as default.
   - What's unclear: Whether a Model tab exists yet (it ships in Phase 7) or Phase 6 just pre-positions the nav so Phase 7 activates correctly.
   - Recommendation: Phase 6 adds a `Model` tab button to the dashboard nav (stub, shows "Coming in next update") and navigates to it on `complete`. The tab renders a placeholder until Phase 7 fills it in.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Vercel Blob (`@vercel/blob`) | D-05/D-06 state Blob write | ✓ | `^2.3.3` | — |
| Anaplan API access | D-01/D-02 spike | Requires live credentials | — | If no test account: mock the response locally using captured JSON from blueprint.js runs |
| Node.js built-in `fetch` | Parallel API calls | ✓ | Node 18+ on Vercel | — |
| `analysis-core.js` `isDecorativeModuleName` export | MSF-04 | ✓ | Already exported (line 93) | — |

**Missing dependencies with no fallback:**
- Live Anaplan credentials + workspace/model access are required for the spike. Without them, D-03 cannot be resolved and the parallel-call design cannot be confirmed.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes — Anaplan Basic Auth in headers | Same as blueprint.js: `x-anaplan-user` / `x-anaplan-pass` headers; never logged |
| V3 Session Management | Partial | sessionStorage for evidencePack; localStorage for stateUrl — consistent with v2.0 pattern |
| V4 Access Control | Yes — SSRF risk on stateUrl | `isAllowedBlobUrl()` pattern already in `analyze.js` (line 31); apply same guard in any endpoint that fetches from stateUrl |
| V5 Input Validation | Yes | `workspaceId` lowercased; `modelId` not injected into formula text; `stateUrl` validated against Vercel Blob domain allowlist |
| V6 Cryptography | No | No new crypto — auth token pattern unchanged |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Credential logging (token in console.log) | Information Disclosure | `safeLog()` pattern from blueprint.js — never log `token`, `password`, `authorization` |
| SSRF via stateUrl | Tampering / Elevation | Apply `isAllowedBlobUrl()` (from analyze.js) in every endpoint that fetches from stateUrl |
| Old blueprintBlobUrl in localStorage used after Phase 6 deploy | Spoofing | Key rename to `meridian.stateUrl` creates clean break; old key presence → redirect to re-fetch |

---

## Sources

### Primary (HIGH confidence)
- `api/blueprint.js` (verified in codebase) — SSE pattern, auth pattern, Blob write pattern, budget constants, `fetchWithRetry` shape
- `api/analysis-core.js` (verified in codebase) — `isDecorativeModuleName()`, `normalizeBlueprint()`, field name assumptions (`li.formula`, `li.formatType`, `li.summaryMethod`)
- `api/cleanup.js` (verified in codebase) — PREFIXES array, list+del loop pattern
- `api/_cors.js` (verified in codebase) — `applyCors()` signature
- `api/analyze.js` (verified in codebase) — `isAllowedBlobUrl()`, `blueprintUrl` param name, `analysis-cache-v20` prefix
- `vercel.json` (verified in codebase) — functions config, rewrites format, maxDuration values
- `index.html` (verified in codebase) — `fetchBlueprint()` SSE handler, `localStorage.meridian.blueprintBlobUrl`, fetch screen DOM IDs
- `/Users/avi/Downloads/INTELLIGENCE_REBUILD_PLAN.md` (verified) — evidence admissibility product contract, four gate definitions, blocked-conclusions concept

### Secondary (MEDIUM confidence)
- v2.0 planning research `PITFALLS.md` (2026-05-10) — Vercel 4.5 MB limit, SSE buffering, `X-Accel-Buffering`
- v2.0 planning research `STACK.md` (2026-05-10) — `@vercel/blob` version, `@anthropic-ai/sdk` version, maxDuration limits
- v2.0 planning research `ARCHITECTURE.md` (2026-05-10) — Anaplan auth endpoint, AnaplanAuthToken header pattern, workspace ID lowercasing

### Tertiary (LOW confidence — resolved by spike)
- Anaplan REST API v2 model-level lineItems endpoint response shape — UNCONFIRMED; A1-A4 assumptions all depend on spike result

---

## Metadata

**Confidence breakdown:**
- Auth, SSE, Blob patterns: HIGH — verified by reading existing working code
- Decorator exclusion: HIGH — existing `isDecorativeModuleName()` is proven, just moved earlier in the pipeline
- Compact serialization format: MEDIUM — design is sound; actual token count needs measurement on a real model
- Evidence pack thresholds: MEDIUM — starting defaults are reasonable; will need calibration after first real model run
- Model-level lineItems endpoint: LOW until spike completes — this is the only architectural unknown

**Research date:** 2026-05-14
**Valid until:** 2026-06-14 for infrastructure patterns (Vercel, Blob, SSE). Anaplan API shape: valid until a breaking API change (rare, announced in advance).
