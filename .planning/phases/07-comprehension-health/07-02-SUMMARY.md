---
phase: 07-comprehension-health
plan: 02
subsystem: api
tags: [comprehension-engine, dead-logic, dependency-graph, daisy-chain, sse, disco]
dependency_graph:
  requires: [07-01]
  provides: [api/analysis-core.js:detectDeadLogic, api/analysis-core.js:detectCircularDependencies, api/analysis-core.js:detectDaisyChains, model-comprehension SSE event]
  affects: [07-03, 07-04]
tech_stack:
  added: []
  patterns: [DFS cycle detection, indexOf formula scan (DoS-safe), DISCO label mapping, SSE comprehension pipeline]
key_files:
  created: []
  modified: [api/analysis-core.js, api/analyze-v3.js]
decisions:
  - "Formula scan uses indexOf loop capped at 500 chars (not regex) to prevent ReDoS per T-07-02-01"
  - "deadLogicConfidence always 'Medium' — formulaTruncated items excluded but truncation means we cannot guarantee completeness"
  - "moduleConfidence guards against empty lineItems array (rawMod may be {}) to prevent divide-by-zero"
  - "scanDeterministicFindings and scanArchitectureFindings imported but not called in handler — reserved for Plan 03"
metrics:
  duration: ~12m
  completed: 2026-05-14
  tasks_completed: 2
  tasks_total: 2
  files_created: 0
  files_modified: 2
---

# Phase 07 Plan 02: Comprehension Engine Summary

**One-liner:** Three detection functions (dead logic, circular dependencies, daisy chains) appended to `analysis-core.js`; `analyze-v3.js` wired to emit the full `model-comprehension` SSE event with DISCO labels, confidence scores, and limitation cards.

## Files Modified

| File | Action | Lines Added | Description |
|------|--------|-------------|-------------|
| `api/analysis-core.js` | Appended | 1562–1664 | Three new exported detection functions after `buildAnalysisSnapshot` |
| `api/analyze-v3.js` | Updated | +88, -4 | Import expansion, `moduleConfidence` helper, `DISCO_LABEL` map, full comprehension pipeline |

## New Functions in analysis-core.js

| Function | Lines | Description |
|----------|-------|-------------|
| `detectDeadLogic(modules, graph)` | 1562–1619 | Scans all formula text (indexOf, capped 500 chars) to build referenced-name set; returns CALC items whose name is absent from that set, excluding formulaTruncated items |
| `detectCircularDependencies(graph)` | 1621–1645 | DFS over module-level adjacency map; returns arrays of module IDs forming cycles |
| `detectDaisyChains(graph)` | 1647–1664 | Counts in/out degree per module; returns IDs where inDegree=1 and outDegree=1 |

## model-comprehension SSE Event Shape (as emitted)

```json
{
  "type": "model-comprehension",
  "modules": [{
    "moduleId": "string",
    "moduleName": "string",
    "prefix": "string",
    "discoLabel": "SYS|DAT|CAL|REP|INP|UNKNOWN",
    "confidence": 0.40 | 0.60 | 0.90,
    "confidenceLabel": "Low|Medium|High",
    "confidenceReason": "string",
    "formulaCount": 0,
    "inputCount": 0
  }],
  "graph": { "nodes": [...], "edges": [...] },
  "deadLogic": [{ "moduleId", "moduleName", "lineItemName", "formula" }],
  "deadLogicConfidence": "Medium",
  "cycles": [["moduleId", ...]],
  "daisyChains": ["moduleId", ...],
  "discoMap": { "SYS": 0, "DAT": 0, "CAL": 0, "REP": 0, "INP": 0, "UNKNOWN": 0 },
  "limitationCards": ["string"]
}
```

## Formula Scan Cap Confirmation

`detectDeadLogic` caps each formula at 500 characters before the indexOf loop:
```javascript
const f = li.formula.length > 500 ? li.formula.slice(0, 500) : li.formula;
```
This satisfies T-07-02-01 (DoS mitigation). No regex is used anywhere in the scan.

## Confidence Score Logic

| Condition | Score | Label |
|-----------|-------|-------|
| `declaredLayer === 'unknown'` | 0.40 | Low |
| Prefix and formula-ratio behaviour disagree | 0.60 | Medium |
| Prefix matches observed behaviour | 0.90 | High |

Formula ratio thresholds: `>= 0.65` → calculation, `> 0.15` → mixed, else → data.

## SSE Pipeline Order (analyze-v3.js)

1. `stage: parsing` — fetch state blob
2. `stage: classifying` — parse state blob
3. `stage: graph` — `buildDependencyGraph()`
4. `stage: classifying` — `buildArchitectureClassification()` + `buildEvidenceDiagnostics()`
5. `stage: dead-logic` — `detectDeadLogic()` + `detectCircularDependencies()` + `detectDaisyChains()`
6. `model-comprehension` event
7. `// PLAN-03: health-workstreams event goes here`
8. `complete` event (with `deadLogicCount`, `cycleCount`, `workstreamCount: 0`)

## Commits

| Task | Hash | Message |
|------|------|---------|
| Task 1 | ec744f2 | feat(07-02): add detectDeadLogic, detectCircularDependencies, detectDaisyChains to analysis-core.js |
| Task 2 | a5e3bac | feat(07-02): wire comprehension engine into analyze-v3.js, emit model-comprehension SSE event |

## Deviations from Plan

**1. [Rule 2 - Enhancement] Guard for empty lineItems in moduleConfidence**

- **Found during:** Task 2 implementation
- **Issue:** Plan's `moduleConfidence` snippet used `mod.lineItems.length > 0` but `rawMod` is looked up with `|| {}` fallback, so `lineItems` could be undefined if module ID lookup misses.
- **Fix:** Changed guard to `mod.lineItems && mod.lineItems.length > 0` to prevent TypeError on undefined.
- **Files modified:** `api/analyze-v3.js` (line 101)
- **Commit:** a5e3bac

Otherwise, plan executed exactly as written.

## Known Stubs

| Stub | File | Line | Reason |
|------|------|------|--------|
| `workstreamCount: 0` | `api/analyze-v3.js` | 224 | Plan 03 fills in health workstreams count |
| `scanDeterministicFindings`, `scanArchitectureFindings` imported but unused | `api/analyze-v3.js` | 11-12 | Reserved for Plan 03 — imported now so Plan 03 only touches one import block |

## Threat Flags

None. All new surface covered by plan's threat model (T-07-02-01 mitigated by formula cap; T-07-02-02 and T-07-02-03 accepted).

## Self-Check

- [x] `api/analysis-core.js` contains `export function detectDeadLogic` (line 1562)
- [x] `api/analysis-core.js` contains `export function detectCircularDependencies` (line 1621)
- [x] `api/analysis-core.js` contains `export function detectDaisyChains` (line 1647)
- [x] `api/analyze-v3.js` contains `model-comprehension` (lines 205, 203)
- [x] `api/analyze-v3.js` contains `// PLAN-03: health-workstreams event goes here` (line 216)
- [x] Both commits exist: ec744f2, a5e3bac
- [x] `node -e "import('./api/analysis-core.js').then(m => console.log(typeof m.detectDeadLogic, typeof m.detectCircularDependencies, typeof m.detectDaisyChains))"` → `function function function`
- [x] `node -e "import('./api/analyze-v3.js').then(m => console.log('ok'))"` → no import errors

## Self-Check: PASSED
