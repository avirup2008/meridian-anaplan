# Phase 07-03 + 07-04 Summary

**Completed:** 2026-05-15  
**Status:** Done

---

## HEALTH_FORMAT applied

`const HEALTH_FORMAT = 'workstreams'`  
Matches the 07-MOCKUP-DECISION.md choice: Brief + Workstreams combined. The workstreams format provides the richest per-card output; architecture/domain context comes from `model-comprehension-enriched`.

---

## Sonnet call structure

Single call via `singleSonnetCall()` — replaces the old `Promise.all([workstreamPrompt, briefPrompt])` dual-call.

**Input to Sonnet:**
- All module names (one per line — domain inference)
- Top 10 blast radius modules with downstream counts
- Deterministic finding summary (rule-level, module + line item names)
- Model stats (module count, line item count, formula count, naming coverage %)

**Output from Sonnet (validated JSON):**
- `domainMap[]` — planning domains inferred from module names
- `integrationSeams[]` — cross-domain boundary modules
- `architectureStory` — 2-sentence characterization
- `architectureVerdict` — one-line verdict string
- `workstreams[]` — 3-5 review workstream cards
- `healthScoreSonnet` — 0-100 integer
- `healthScoreReasoning` — 1-2 sentence rationale

---

## Deterministic health score formula (D-06)

```javascript
penalty += severityWeight * (1 + blastRadius * 0.25)
score = clamp(95, 100 - (penalty / moduleCount) * 8)
```

Severity weights: Critical=4, warning=2, info=1.  
Final `healthScore = round((deterministicScore + sonnetScore) / 2)`.  
Both components emitted separately (`healthScoreDeterministic`, `healthScoreSonnet`) for transparency.

---

## SSE event order

1. `model-comprehension` — fast (pre-Sonnet): modules, graph, blast radius top-10, dead logic, cycles
2. `model-comprehension-enriched` — post-Sonnet: domain map, integration seams, architecture story + verdict
3. `health-workstreams` — post-Sonnet: honest limits, health score, workstreams, architecture verdict
4. `complete`

---

## Fallback behaviour

On Sonnet timeout (40s) or JSON parse failure:
- `architectureVerdict` = 'Architectural verdict unavailable — synthesis failed'
- `architectureStory` = deterministic fallback string
- `healthScoreSonnet` defaults to 50 (neutral)
- `workstreams` = `intelligence.workstreams` (deterministic fallback from `buildEvidenceBackedIntelligence`)
- SSE still completes — UI renders with deterministic data

---

## index.html changes (Wave 4)

- Added `model-architecture-section`, `model-blast-radius-section`, `model-domain-map-section` to Model tab (additive layout)
- Added `health-honest-limits`, `health-verdict-card`, `health-format-slot` to Health tab (above workstreams)
- Added `_anlOnModelComprehensionEnriched()` function
- Replaced `_anlOnHealthWorkstreams()` with new version
- Added `_renderHealthFormat()` dispatcher (handles workstreams, brief, surgical, domain formats)
- Added `case 'model-comprehension-enriched'` to SSE switch
- Deleted all 6 `#mock-*` sections + `#mock-nav` strip + `showMock()` script (959 lines removed)
- All Sonnet-sourced strings wrapped via `escapeHtml()`
