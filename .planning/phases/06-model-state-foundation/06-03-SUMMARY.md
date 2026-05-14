---
phase: 06-model-state-foundation
plan: 03
subsystem: api
tags: [cleanup, vercel, infrastructure, blob-ttl, dead-code-removal]
dependency_graph:
  requires: [06-02-SUMMARY.md]
  provides: [api/cleanup.js PREFIXES including model-state/, vercel.json aligned to v3.0]
  affects: [Vercel Blob TTL for model-state/ prefix, Vercel function routing]
tech_stack:
  added: []
  patterns:
    - PREFIXES whitelist in cleanup.js controls all Blob TTL scope
key_files:
  created: []
  modified:
    - api/cleanup.js
    - vercel.json
  deleted:
    - api/blueprint.js
decisions:
  - "D-11 executed: api/blueprint.js hard-deleted; api/model-state.js is the sole model-fetch endpoint"
  - "D-10 preserved: 'blueprints/' retained in PREFIXES so legacy v2.0 Blobs still expire on 7-day cron"
  - "blueprint variable names in analysis-core.js and analyze.js are semantic uses, not imports of the deleted file — left untouched per plan (Phase 7 scope)"
metrics:
  duration: ~10 minutes
  completed: 2026-05-14
  tasks: 2
  files: 2
---

# Phase 6 Plan 03: Infrastructure Cleanup Summary

**One-liner:** Hard-deleted api/blueprint.js, added model-state/ to cleanup PREFIXES, and aligned vercel.json functions config to the v3.0 endpoint set.

## What Was Done

### Task 1: cleanup.js update and blueprint.js deletion

**Diff applied to api/cleanup.js PREFIXES (line 8):**

```diff
-const PREFIXES = ['reports/', 'blueprints/', 'analysis-cache-v14/', 'analysis-narrative-cache-v2/'];
+const PREFIXES = ['reports/', 'blueprints/', 'analysis-cache-v14/', 'analysis-narrative-cache-v2/', 'model-state/'];
```

`'model-state/'` is now included so Blob objects written by `api/model-state.js` under the `model-state/{modelId}-{timestamp}.txt` path are deleted after 6.75 days — matching the existing TTL for all other Blob prefixes.

`'blueprints/'` is preserved (D-10) — legacy v2.0 blueprint Blobs continue to expire naturally without intervention.

`api/blueprint.js` was deleted entirely (273 lines, D-11 hard delete). No imports of `./blueprint` exist anywhere in `api/` — confirmed by grep.

**Commit:** dc8b436

### Task 2: vercel.json functions config aligned to v3.0

**Diff applied to vercel.json functions block:**

```diff
-    "api/blueprint.js": { "maxDuration": 60 },
+    "api/model-state.js": { "maxDuration": 60 },
```

All other function configs preserved unchanged:
- `api/generate.js`: 30s
- `api/connect.js`: 10s
- `api/models.js`: 10s
- `api/analyze.js`: 60s
- `api/analyze-narrative.js`: 60s
- `api/share.js`: 10s
- `api/cleanup.js`: 10s

Crons block unchanged (`/api/cleanup` at `0 3 * * *`).

JSON validity confirmed via `node -e "JSON.parse(...)"` — exit 0.

**Commit:** 1ac843e

## Dangling Import Scan

No imports of `./blueprint` (or `../blueprint`) anywhere in `api/`. The word "blueprint" appears in `analysis-core.js` and `analyze.js` as internal variable/function names (`normalizeBlueprint`, `blueprintHash`, `blueprint` as a local variable holding fetched data) — these are semantic references to the concept, not module imports. Phase 6 leaves these files untouched; `analyze.js` continues to work with the v2.0 `blueprintUrl` pattern until Phase 7 ships `analyze-v3.js`.

## Deviations from Plan

None. Plan executed exactly as written. Both tasks completed in sequence with their respective commits.

## Threat Mitigations Applied

| Threat ID | Mitigation |
|-----------|-----------|
| T-06-13 | JSON validity verified via `node -e "JSON.parse(...)"` — exits 0 |
| T-06-14 | `api/model-state.js` entry carries `maxDuration: 60` matching Hobby plan ceiling |
| T-06-15 | `'blueprints/'` retained in PREFIXES; legacy Blobs continue to expire on 7-day TTL |
| T-06-16 | PREFIXES whitelist unchanged in logic; `model-state/` addition is the only change |

## Known Stubs

None. All plan goals achieved.

## Threat Flags

None. No new network endpoints, auth paths, or trust boundary surfaces introduced. Changes are config and dead-code removal only.

## Self-Check: PASSED

- `api/blueprint.js` absent: FOUND (deleted)
- `api/cleanup.js` contains `model-state/`: PASS (1 match)
- `api/cleanup.js` contains `blueprints/`: PASS (1 match, preserved)
- `vercel.json` valid JSON: PASS
- `vercel.json` contains `api/model-state`: PASS (1 match)
- `vercel.json` contains no `api/blueprint`: PASS (0 matches)
- No `./blueprint` imports in `api/`: PASS (0 matches)
- Commit dc8b436: FOUND
- Commit 1ac843e: FOUND
