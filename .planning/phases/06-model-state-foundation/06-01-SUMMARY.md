# Plan 06-01 Summary — API Spike: Model-Level lineItems

**Completed:** 2026-05-14
**Status:** DONE — spike invalidated the primary design; D-03 fallback is now the confirmed path

## Spike Outcome

The model-level `GET /models/{modelId}/lineItems?includeAll=true` endpoint **does not exist** in Anaplan API v2. Both tested endpoints returned HTTP 404. Authentication succeeded (HTTP 201), so this is not a credentials issue.

## Four Resolved Unknowns

| Unknown | Answer |
|---|---|
| Does model-level `/lineItems` exist? | **No** — HTTP 404 |
| Does it return formula text? | **Moot** — endpoint absent |
| Does it paginate? | **Moot** — endpoint absent |
| What field links a line item to its module? | **Moot** — per-module fetch makes this unnecessary |

## What IS Available from the Anaplan API

The only confirmed working pattern (proven by `api/blueprint.js` in production) is:

1. `GET /workspaces/{wsId}/models/{modelId}/modules` → list of all modules (id + name)
2. `GET /workspaces/{wsId}/models/{modelId}/modules/{moduleId}/lineItems?includeAll=true` → per-module line items with formula text in an `items[]` array

This is the N+1 pattern. `blueprint.js` already implements it with an 8-worker concurrency pool.

## What D-03 Fallback Means for Plan 02

Plan 02 must be replanned around the per-module fetch strategy:

**Remove from Plan 02:**
- `Promise.all([/modules, /lineItems?includeAll=true])` parallel design — the model-level URL does not exist
- Any join logic that uses a `moduleIdField` on line items — not needed when fetching per-module

**Keep in Plan 02:**
- Module list fetch (`/modules`) — confirmed working
- Per-module lineItems fan-out — replicate the `blueprint.js` worker pool (FETCH_CONCURRENCY = 8, MAX_RETRIES = 1, REQUEST_TIMEOUT_MS = 7000, TOTAL_BUDGET_MS = 52000)
- Formula field name: `formula` (confirmed from blueprint.js source)
- Top-level array key: `items` (confirmed from blueprint.js source)

**Key difference from blueprint.js in Plan 02:**
- SSE events change from per-module progress counters to named stage events (`auth → loading → serializing → writing → complete`) per D-08
- Output changes from raw BlueprintDocument JSON to compact text state + evidence pack per MSF-02/MSF-03
- Decorator/separator modules are filtered out before serialization per MSF-04

## Whether Plan 02 Proceeds with Parallel Design or D-03 Hybrid

**D-03 hybrid** is now the only option. Plan 02's `must_haves.truths` item — "The handler issues parallel calls to /modules and /lineItems?includeAll=true — no per-module loop" — is **invalidated**. Plan 02 needs its objective updated before implementation starts.

Recommend: update Plan 02's objective to remove the `Promise.all` parallel-call truth and replace it with the per-module worker-pool truth. The rest of the plan (SSE shape, Blob write, evidence pack, compact serialization) is unaffected and can proceed as written.
