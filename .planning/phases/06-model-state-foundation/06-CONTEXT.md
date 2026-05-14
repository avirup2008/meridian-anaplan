# Phase 6: Model State Foundation - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the per-module blueprint fetch (N+1 API calls) with parallel model-level calls, serialize the result into a compact, token-efficient model state, write it to Vercel Blob under a new prefix, and gate all downstream intelligence on evidence admissibility. No UI features ship in this phase — only the data foundation changes.

</domain>

<decisions>
## Implementation Decisions

### API Endpoint Strategy
- **D-01:** Fetch `/modules` and `GET /models/{id}/lineItems?includeAll=true` in parallel simultaneously — two calls, one round-trip of latency, no per-module batching loop.
- **D-02:** Module names come from the `/modules` call; line items are grouped by module ID from the model-level call. The serialization step joins them by ID.
- **D-03:** Whether `includeAll=true` on the model-level endpoint returns formula text is UNCONFIRMED. Phase 6 plan MUST include a live API spike (hit the endpoint, log the response shape) before committing to the design. If formulas are absent, fall back to: model-level call for structure, formula text fetched per-module only.
- **D-04:** New endpoint lives in `api/model-state.js`. The old `api/blueprint.js` is deleted.

### Blob Storage
- **D-05:** Compact model state is written to Vercel Blob under the `model-state/` prefix (distinct from the old `blueprints/` prefix).
- **D-06:** Blob URL is passed downstream to analyze/chat/build endpoints — consistent with the v2.0 pattern.
- **D-07:** `cleanup.js` cron must add `model-state/` to its PREFIXES array so state Blobs expire after 7 days alongside reports.

### Fetch UX
- **D-08:** SSE is still used for the fetch screen. Server sends named stage events: `'Authenticating…'` → `'Loading model structure…'` → `'Serializing state…'` → `'Writing state…'` → `'Done'`. No module-by-module counter.
- **D-09:** On the SSE `complete` event, the client auto-navigates to the dashboard with the **Model tab** active (not the Health tab, which was v2.0 default).

### Backward Compatibility
- **D-10:** Old `blueprints/` Blobs from v2.0 shared reports are left to expire naturally via the 7-day TTL cron. No migration, no backward-compatible reader, no explicit invalidation.
- **D-11:** `api/blueprint.js` is fully replaced by `api/model-state.js`. No parallel running. `api/generate.js` (CSV fallback) is unaffected — it never used `blueprint.js`.

### Claude's Discretion
- Exact compact serialization format (column order, separator characters, line item row structure) — Claude chooses the most token-efficient text format that preserves all fields.
- Evidence admissibility threshold values (e.g., what % formula coverage triggers a gate) — Claude sets sensible defaults; these can be tuned after testing.
- SSE stage message wording and timing.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Codebase
- `api/blueprint.js` — file being replaced; read to understand SSE pattern, auth flow, Blob write pattern, and what the downstream consumers expect
- `api/analyze.js` — primary consumer of the Blob URL; read to understand what fields it expects in the model state JSON
- `api/cleanup.js` — must add `model-state/` prefix to PREFIXES array
- `api/_cors.js` — shared CORS helper; must be imported by `api/model-state.js`
- `vercel.json` — must update: replace `blueprint` route with `model-state`, same maxDuration (60s)

### Requirements
- `.planning/REQUIREMENTS.md` §Model State Foundation — MSF-01 through MSF-05

### Anaplan API (research spike required)
- Anaplan REST API v2: `GET /workspaces/{wsId}/models/{modelId}/lineItems?includeAll=true`
  — Confirm: does this return formula text? What is the response JSON shape? Does it include module structure?
- Anaplan REST API v2: `GET /workspaces/{wsId}/models/{modelId}/modules`
  — Already proven in v2.0; use same pattern.

### Intelligence Rebuild Plan
- `/Users/avi/Downloads/INTELLIGENCE_REBUILD_PLAN.md` — product contract, evidence admissibility gates definition, what fields are high/medium/low confidence

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `api/_cors.js` — `applyCors(req, res)` pattern; copy import into model-state.js
- SSE pattern from `blueprint.js` — `res.flushHeaders()`, `sendEvent()`, `res.write()`, `res.end()` in `finally`
- Vercel Blob `put()` pattern from `blueprint.js` — `{ access: 'public', contentType: 'application/json', allowOverwrite: true }`
- Auth pattern from `blueprint.js` — Basic → `AnaplanAuthToken` token exchange; copy verbatim

### Established Patterns
- SSE: `res.flushHeaders()` BEFORE first `await` — non-negotiable
- `res.end()` in `finally` block — always, even on error
- `sendEvent()` helper flushes after every write: `if (typeof res.flush === 'function') res.flush()`
- Credentials arrive as `x-anaplan-user` / `x-anaplan-pass` headers (not `x-anaplan-token`)
- `workspaceId` is lowercased before use in API URLs

### Integration Points
- `index.html` fetch screen: SSE event handler must be updated to handle new stage event types (`stage` instead of `progress`)
- `index.html` boot router: after `complete` SSE event, navigate to dashboard with Model tab active (not Health)
- `api/analyze.js` and future `api/analyze-v3.js`: will receive `stateUrl` (Blob URL) instead of `blueprintUrl`
- `cleanup.js` PREFIXES array: add `'model-state/'`

</code_context>

<specifics>
## Specific Ideas

- The compact model state serialization should use a line-per-item text format (not JSON) to minimize token count. Something like:
  ```
  MODULE: SYS01 Revenue Model [CAL]
  DIMS: P3 Customers, Time
  CALC: Revenue [Number/Sum] = Quantity * Unit Price
  CALC: Unit Price [Number/None] = LOOKUP(...)
  INPUT: Budget Flag [Boolean/None]
  ---
  ```
- The evidence pack should be a separate small JSON object (not embedded in the serialized text) — passed alongside the state Blob URL to downstream analysis functions.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 06-model-state-foundation*
*Context gathered: 2026-05-14*
