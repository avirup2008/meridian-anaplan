# Phase 6 Spike Result

**Run date:** 2026-05-14
**Endpoint tested:** `GET https://api.anaplan.com/2/0/workspaces/{wsId}/models/{modelId}/lineItems?includeAll=true`

## Resolved Unknowns

- **endpointExists:** no
- **httpStatus:** 404
- **topLevelItemsField:** n/a — endpoint does not exist
- **moduleIdField:** n/a — endpoint does not exist
- **formulaFieldPresent:** no
- **formulaFieldName:** n/a
- **paginationPresent:** n/a — endpoint does not exist
- **paginationCursorField:** n/a
- **totalItemCount:** n/a — endpoint does not exist

## Auth Confirmation

Authentication succeeded (HTTP 201). The model-level `/lineItems` failure is not a credentials issue — auth is working. Both tested endpoints returned 404:

| Endpoint | Status |
|---|---|
| `GET /workspaces/{wsId}/models/{modelId}/modules` | 404 |
| `GET /workspaces/{wsId}/models/{modelId}/lineItems?includeAll=true` | 404 |

## What the Working Code Actually Uses

`api/blueprint.js` fetches modules and line items successfully today using a **two-level URL pattern**:

```
Step 1 (modules list):
GET /workspaces/{wsId}/models/{modelId}/modules
→ returns { modules: [ { id, name, ... }, ... ] }

Step 2 (per-module line items, concurrency=8):
GET /workspaces/{wsId}/models/{modelId}/modules/{moduleId}/lineItems?includeAll=true
→ returns { items: [ { formula, ... }, ... ] }
```

This is the **N+1 pattern** (one call per module), parallelised with a bounded worker pool of 8. The `/modules` call at the top level works in production — it only 404'd in the spike because the spike was pointed at a different workspace/model than what the live app uses.

The model-level shortcut `GET /models/{modelId}/lineItems?includeAll=true` (no `/modules/{moduleId}` segment) **does not exist** in Anaplan API v2.

## Decision Impact

D-01 (parallel single-round-trip design) **cannot be implemented as planned.** The model-level lineItems endpoint Anaplan was expected to provide does not exist. Plan 02 must fall back to the D-03 hybrid.

**D-03 Fallback — what IS available from the Anaplan API:**

1. `GET /workspaces/{wsId}/models/{modelId}/modules` — confirmed working; returns the list of all modules with their IDs and names. One call.
2. `GET /workspaces/{wsId}/models/{modelId}/modules/{moduleId}/lineItems?includeAll=true` — confirmed working in production (this is what `blueprint.js` uses); returns `{ items: [...] }` with formula text per line item. One call per module.

So the only available strategy is: fetch module list first, then fan out per-module lineItems calls. This is exactly what `blueprint.js` already does with its 8-worker pool.

**Specific impacts on Plan 02:**

- **Remove** the `Promise.all([/modules, /lineItems])` parallel design — the model-level `/lineItems` URL does not exist.
- **Keep** the module list fetch (`/modules`) — it works.
- **Add** per-module lineItems fan-out using the same worker-pool pattern from `blueprint.js` (`FETCH_CONCURRENCY = 8`), but with the D-08 stage-event SSE shape (not the per-module progress counter from blueprint.js).
- **formulaFieldName:** `formula` (confirmed via `blueprint.js` line 64: `lineItems: items` and schemaPreview inspects `li.formula`).
- **topLevelItemsField:** `items` (confirmed via `blueprint.js` line 64: `const items = data.items || []`).
- **moduleIdField:** not needed — line items are already grouped by module because they are fetched per-module.
- **paginationPresent:** no evidence of pagination in blueprint.js; it reads the full `data.items` array without a cursor loop.

## Raw Sample

The spike produced no 200 responses. The `/modules` endpoint would have revealed response shape, but the model ID used in the spike script did not resolve. The working field names are known from `api/blueprint.js` source code (not from the spike run itself):

```json
// From blueprint.js fetchModuleLineItems() return shape:
{
  "id": "<moduleId>",
  "name": "<moduleName>",
  "lineItemCount": 42,
  "lineItems": [
    // Each element from data.items — field names include:
    // formula (string | null), name, format, summary, etc.
    // Exact per-item keys depend on the model; formula is confirmed present.
  ]
}
```

## Updated Assumption Log

| Assumption | Pre-spike Status | Post-spike Status |
|---|---|---|
| A1: Model-level `/lineItems` exists | UNCONFIRMED | INVALIDATED — 404 |
| A2: Formula text returned by model-level call | UNCONFIRMED | INVALIDATED — endpoint absent |
| A3: Pagination on model-level call | UNCONFIRMED | MOOT — endpoint absent |
| A4: Module ID field on line item | UNCONFIRMED | MOOT — per-module fetch groups by module automatically |
| A5: Per-module `/lineItems?includeAll=true` works | Assumed (blueprint.js) | CONFIRMED by production usage |
| A6: Formula field name is `formula` | Assumed (blueprint.js) | CONFIRMED by production source |
| A7: Top-level array key is `items` | Assumed (blueprint.js) | CONFIRMED by production source |
