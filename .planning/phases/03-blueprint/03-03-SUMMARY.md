---
phase: 03-blueprint
plan: "03"
subsystem: deploy-config
tags: [vercel, functions, blueprint, sse, blob]
dependency_graph:
  requires: ["03-01", "03-02"]
  provides: ["api/blueprint.js function registration", "Phase 3 BPRT sign-off"]
  affects: ["vercel.json", "Phase 4 prompt engineering"]
tech_stack:
  added: []
  patterns: ["vercel functions block", "maxDuration per endpoint"]
key_files:
  modified:
    - vercel.json
decisions:
  - "api/blueprint.js registered at maxDuration: 60 — matches STATE.md locked decision for batched-parallel fetch + Blob write budget"
metrics:
  completed_date: "2026-05-11"
  tasks_completed: 1
  tasks_total: 2
  status: awaiting-checkpoint
---

# Phase 3 Plan 03: Blueprint Deploy Config + BPRT Sign-Off Summary

**One-liner:** `api/blueprint.js` registered in `vercel.json` at `maxDuration: 60` to cover the full batched-parallel SSE fetch and Blob write; BPRT end-to-end sign-off pending human verification.

## What Was Built

### Task 1: Register api/blueprint.js in vercel.json (COMPLETE — commit 176a0ab)

Added `"api/blueprint.js": { "maxDuration": 60 }` to the `functions{}` block in `vercel.json`.

Final `functions` block:

```json
"functions": {
  "api/generate.js": { "maxDuration": 30 },
  "api/connect.js": { "maxDuration": 10 },
  "api/models.js": { "maxDuration": 10 },
  "api/blueprint.js": { "maxDuration": 60 }
}
```

The 60-second value is the locked Phase 1 budget for the batched-parallel fetch with retries and the Vercel Blob write — both must complete inside the same function invocation that streams SSE progress.

### Task 2: Phase 3 BPRT End-to-End Sign-Off (AWAITING HUMAN VERIFICATION)

Status: **Checkpoint — blocking**

The human developer must run the full Connect → Picker → Fetch flow against a live Anaplan model and confirm all four BPRT behaviors:

- **BPRT-01:** Batched-parallel fetch (modules counter increments in batches of 20)
- **BPRT-02:** Live SSE counters (line items counter and current-module text update in real time)
- **BPRT-03:** Blob URL handoff (blob exists in Vercel Blob dashboard; raw JSON NOT in response body)
- **BPRT-04:** 429 retry + partial-warning (yellow warning strip for skipped modules; fetch does not abort)

**Resume signal received:** _Pending_

**Per-BPRT observations:** _To be recorded after human verification_

**Schema deviations for Phase 4 prompt engineering:** _To be recorded after human verification_

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | 176a0ab | feat(03-03): register api/blueprint.js in vercel.json at maxDuration 60 |
| Task 2 | — | Awaiting human checkpoint |

## Deviations from Plan

None — Task 1 executed exactly as written.

## Known Stubs

None — vercel.json is a pure configuration file; no rendering stubs.

## Self-Check

- [x] `/tmp/meridian-anaplan/vercel.json` exists and parses as valid JSON
- [x] `functions['api/blueprint.js'].maxDuration === 60` verified by automated check
- [x] Commit 176a0ab exists in git log
- [x] No other keys altered (rewrites, headers, version unchanged)

## Self-Check: PASSED
