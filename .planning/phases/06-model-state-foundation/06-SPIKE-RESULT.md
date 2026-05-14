# Phase 6 Spike Result

**Run date:** 2026-05-14
**Updated:** 2026-05-14 (MCP live confirmation)

## Resolved Unknowns

- **endpointExists:** YES — at `/2/0/models/{modelId}/lineItems?includeAll=true` (no workspace prefix)
- **httpStatus:** 200
- **topLevelItemsField:** `items`
- **moduleField:** `moduleName` or `module` (string — module name, not ID)
- **formulaFieldPresent:** yes
- **formulaFieldName:** `formula`
- **paginationPresent:** no (2383 items returned in one response for 228-module model)
- **totalItemCount:** 2383 line items across 228 modules

## How We Got Here

The initial spike script 404'd because it tested the **wrong URL path**:

| Endpoint tested by spike | Status | Reason |
|---|---|---|
| `GET /workspaces/{wsId}/models/{modelId}/lineItems?includeAll=true` | 404 | Wrong path — workspace prefix not valid here |
| `GET /workspaces/{wsId}/models/{modelId}/modules` | 404 | Spike lowercased model ID; Anaplan API is case-sensitive |

The MCP `show_alllineitems` tool confirmed the **correct URL** (no workspace prefix):

```
GET /2/0/models/{modelId}/lineItems?includeAll=true
→ returns { items: [ { name, moduleName, formula, format, appliesTo, id, ... } ] }
```

Auth confirmed working (HTTP 201 in spike). The 404s were URL mistakes, not API capability gaps.

## Confirmed Field Names (from live MCP call)

| Field | Value | Notes |
|---|---|---|
| `name` | line item name string | e.g. `"(cf) comments formula"` |
| `moduleName` / `module` | module name string | e.g. `"DEM03 - Forecasting"` — try both field names |
| `formula` | formula text or empty string | e.g. `"IF 'FIL03...' = 3 THEN ..."` |
| `format` / `Format` | format type | `NUMBER`, `TEXT`, `DATE`, `LIST`, etc. |
| `appliesTo` / `Applies To` | dimension list | comma-separated list names |
| `id` / `ID` | numeric string ID | e.g. `"298000000010"` |

## Confirmed Fetch Strategy

Two parallel calls (D-01 restored):

```
Promise.all([
  GET /workspaces/{wsId}/models/{mId}/modules        → { modules: [{id, name}] }
  GET /models/{mId}/lineItems?includeAll=true        → { items: [{name, moduleName, formula, ...}] }
])
```

Join: group line items by `li.moduleName || li.module`, match with module by name to attach IDs.

No per-module fan-out needed. No worker pool. 2 API calls total.

## Updated Assumption Log

| Assumption | Pre-spike Status | Final Status |
|---|---|---|
| A1: Model-level `/lineItems` exists | UNCONFIRMED | CONFIRMED — at correct URL (no workspace prefix) |
| A2: Formula text returned | UNCONFIRMED | CONFIRMED — `formula` field populated |
| A3: Pagination | UNCONFIRMED | CONFIRMED absent — 2383 items in single response |
| A4: Module linkage field | UNCONFIRMED | CONFIRMED — `moduleName` string (no join by ID needed) |
| A5: Per-module fallback | Assumed from blueprint.js | NOT NEEDED — single call works |
| A6: Formula field name is `formula` | Assumed | CONFIRMED |
| A7: Top-level array key is `items` | Assumed | CONFIRMED |
