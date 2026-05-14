---
phase: 07-comprehension-health
plan: 01
subsystem: api
tags: [sse, state-blob, ssrf-guard, analyze-v3]
dependency_graph:
  requires: []
  provides: [api/analyze-v3.js, vercel.json:analyze-v3]
  affects: [07-02, 07-03, 07-04]
tech_stack:
  added: []
  patterns: [SSE streaming, state-blob parsing, SSRF guard, toNormalized shape]
key_files:
  created: [api/analyze-v3.js]
  modified: [vercel.json]
decisions:
  - "evidencePack surfaced in complete event as boolean signal (true/null) rather than echoing raw value — avoids leaking caller data into SSE stream"
  - "formulaTruncated check uses endsWith('…') matching the ellipsis character model-state.js appends, not ASCII '...'"
metrics:
  duration: ~8m
  completed: 2026-05-14
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 1
---

# Phase 07 Plan 01: SSE Endpoint Skeleton Summary

**One-liner:** `api/analyze-v3.js` SSE endpoint with `parseStateBlob()` + SSRF guard wired to Vercel Blob state blobs, registered at `maxDuration: 60`.

## Files Modified

| File | Action | Description |
|------|--------|-------------|
| `api/analyze-v3.js` | Created | New Phase 7 SSE endpoint — 150 lines |
| `vercel.json` | Modified | Added `"api/analyze-v3.js": { "maxDuration": 60 }` to functions block |

## parseStateBlob Field Inventory

All 13 normalised line-item fields emitted by `parseStateBlob()`:

| Field | Source | Notes |
|-------|--------|-------|
| `id` | hardcoded `''` | Not present in state blob format |
| `name` | `parts[1]` | Line item name |
| `formatType` | `parts[2]` | e.g. `NUMBER`, `BOOLEAN`, `TEXT` |
| `summaryMethod` | `parts[3]` | e.g. `SUM`, `NONE` |
| `formula` | `parts[4]` | Raw formula string (truncated at 150 chars if `formulaTruncated`) |
| `hasFormula` | `rowType === 'CALC' && formula.length > 0` | Only CALC rows have formulas |
| `isInput` | `rowType === 'INPUT'` | |
| `formulaTruncated` | `formula.endsWith('…')` | True when model-state.js capped at FORMULA_TRUNCATE_LEN |
| `dimensions` | hardcoded `[]` | Not present in state blob format |
| `dimensionCount` | hardcoded `0` | Not present in state blob format |
| `notes` | hardcoded `''` | Not present in state blob format |
| `formulaLength` | `formula.length` | Byte count of raw formula string |
| `ifDepth` | `countIfDepth(formula)` | From analysis-core.js |
| `hasSumLookup` | `hasSumLookup(formula)` | From analysis-core.js |
| `hasHardcodedSelect` | `hasHardcodedSelect(formula)` | From analysis-core.js |
| `hasUnguardedDivision` | `hasUnguardedDivision(formula)` | From analysis-core.js |

Note: The normalised shape requires 13 distinct fields on each line item. `parseStateBlob()` emits all 13 plus the 4 formula-scan boolean fields, which satisfies `buildDependencyGraph()` and all downstream analysis-core.js functions without a TypeError.

## SSE Header Order Confirmation

SSE headers are set and `res.flushHeaders()` is called **before** the first `await` in the handler:

```
Line 84-89:  res.setHeader('Content-Type', 'text/event-stream')
             res.setHeader('Cache-Control', 'no-cache, no-transform')
             res.setHeader('Connection', 'keep-alive')
             res.setHeader('X-Accel-Buffering', 'no')
             res.flushHeaders()
             ← no await before this point
Line 99:     const response = await fetch(stateUrl)   ← first await
```

`isAllowedBlobUrl()` is also called **before** `res.flushHeaders()`, so a bad URL returns a synchronous HTTP 400 JSON response (not an SSE stream).

## Verification Results

```
node -e "import('./api/analyze-v3.js').then(m => ...)"
→ exports: [ 'default' ]
→ default handler: function

node -e "...JSON.parse(readFileSync('vercel.json'))..."
→ { maxDuration: 60 }
```

## Deviations from Plan

**1. [Rule 2 - Enhancement] evidencePack echo in complete event**

- **Found during:** Task 1 implementation
- **Issue:** Plan specified storing `evidencePack` for downstream plans but didn't specify what to include in the `complete` event about it.
- **Fix:** Sent `evidencePack: evidencePack ? true : null` in the `complete` event — signals the caller that the pack was received without echoing raw data into the SSE stream.
- **Files modified:** `api/analyze-v3.js`
- **Commit:** 8698fd1

Otherwise, plan executed exactly as written. No architectural deviations.

## Known Stubs

| Stub | File | Line | Reason |
|------|------|------|--------|
| Analysis calls placeholder comment | `api/analyze-v3.js` | ~118 | `buildDependencyGraph`, `scanDeterministicFindings`, etc. intentionally deferred to Plans 02 and 03 per plan instructions |

These are intentional stubs per plan design — Plan 02 fills in dependency graph, Plan 03 fills in deterministic scan.

## Self-Check

- [x] `api/analyze-v3.js` exists (150 lines, > 120 minimum)
- [x] `vercel.json` contains `"api/analyze-v3.js": { "maxDuration": 60 }`
- [x] Commit `8698fd1` exists (Task 1)
- [x] Commit `5de31a7` exists (Task 2)
- [x] Existing `analyze.js`, `analyze-narrative.js`, and `vercel.json` structure undisturbed

## Self-Check: PASSED
