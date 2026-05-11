---
phase: 04-analysis
plan: 01
subsystem: analysis-api
tags: [analysis, sse, claude, anthropic, vercel, haiku, sonnet]
dependency_graph:
  requires: [api/blueprint.js, vercel.json]
  provides: [api/analyze.js POST handler with full SSE analysis pipeline]
  affects: [index.html analysis UI (Phase 4 plan 02)]
tech_stack:
  added: []
  patterns:
    - ESM SSE handler matching api/blueprint.js pattern
    - Promise.allSettled batched Haiku calls (BATCH_SIZE=5)
    - countTokens() pre-flight guard before every Claude call
    - parseJsonStrict() with markdown fence stripping for LLM JSON output
    - detectDependencies() string-match against module names in formulas
key_files:
  created:
    - api/analyze.js
  modified:
    - vercel.json
decisions:
  - dimension keys use architecture/naming/formulas/dataHygiene/governance per PLAN.md must_haves (not RESEARCH.md Pattern 6 keys structure/formula/bestPractice/naming/performance)
  - haiku-progress for skipped modules emitted before batch loop (not interleaved) for implementation simplicity
  - HAIKU_BUDGET_MS=45000 and TOTAL_BUDGET_MS=55000 match PLAN.md constants exactly
metrics:
  duration: ~8 minutes
  completed: 2026-05-11
  tasks: 2
  files: 2
---

# Phase 04 Plan 01: Analysis API — Summary

## One-liner

SSE orchestration handler (`api/analyze.js`) with extraction pre-pass, batched Haiku per-module suggestions, Sonnet health scoring, and Sonnet cross-module narrative — covering ANLZ-01 through ANLZ-04.

## What Was Built

### Task 1: vercel.json update (commit 040ea08)

Added `"api/analyze.js": { "maxDuration": 60 }` to the `functions` block. Without this, every analysis call would time out at Vercel's default 10s — well below the ~55s pipeline runtime.

Final `functions` block:
```json
{
  "api/generate.js": { "maxDuration": 30 },
  "api/connect.js": { "maxDuration": 10 },
  "api/models.js": { "maxDuration": 10 },
  "api/blueprint.js": { "maxDuration": 60 },
  "api/analyze.js": { "maxDuration": 60 }
}
```

### Task 2: api/analyze.js (commit dbbb544)

Single 376-line ESM file implementing the full four-stage SSE analysis pipeline.

**File structure:**
1. Constants — HAIKU_MODEL, SONNET_MODEL, TOKEN_LIMIT=180_000, BATCH_SIZE=5, MIN_LINE_ITEMS_FOR_HAIKU=3, HAIKU_BUDGET_MS=45_000, TOTAL_BUDGET_MS=55_000
2. `extractionPrePass(blueprint)` — strips banned line item fields, maps `appliesTo` array of `{id,name}` objects to `dimensions: string[]`
3. `guardTokens(client, model, messages, system)` — `countTokens()` pre-flight, throws on > 180K
4. `parseJsonStrict(text)` — strips ```json fences, JSON.parse with null fallback
5. `buildHaikuPrompt(mod)` — exact template per PLAN.md
6. `runHaikuForModule(client, mod)` — single Haiku call, validates domain/triage, maps to `{domain, triage, text, reasoning, action}`
7. `runHaikuBatches(client, extractions, sendEvent, startMs)` — filters eligible modules (>= 3 line items), processes in batches of 5, 45s time-budget guard with `partial-analysis` event on expiry
8. `buildSonnetSynthesisPrompt(extractions, allSuggestions)` — returns `{userContent, system}` with 5 dimension keys: architecture, naming, formulas, dataHygiene, governance
9. `normalizeSynthesis(raw)` — clamps scores 0-100, derives verdict from score if invalid (≥85→Good, ≥60→Needs Work, else→Critical), fills missing dimensions with 50
10. `detectDependencies(extractions)` — formula string-match against module names, returns `{[moduleId]: {receivesFrom: string[], sendsTo: string[]}}`
11. `buildSonnetNarrativePrompt(extractions, deps)` — returns `{userContent, system}`
12. `handler(req, res)` — main SSE orchestration (CORS, OPTIONS, validation, SSE headers + flushHeaders, four-stage pipeline, try/catch/finally)

**SSE event protocol implemented:**

| Event type | When emitted | Example payload |
|------------|-------------|----------------|
| `progress` | Stage transitions | `{ type: 'progress', stage: 'fetching', pct: 5 }` |
| `extraction-done` | After pre-pass | `{ type: 'extraction-done', moduleCount: 228, totalLineItems: 2280 }` |
| `haiku-progress` | Per module (skipped or completed) | `{ type: 'haiku-progress', modulesDone: 5, modulesTotal: 228, moduleName: 'PLN01', skipped: false }` |
| `suggestions` | Per eligible module | `{ type: 'suggestions', moduleId: '...', moduleName: 'PLN01', items: [{domain, triage, text, reasoning, action}] }` |
| `partial-analysis` | Budget exceeded | `{ type: 'partial-analysis', reason: 'Haiku time budget reached', modulesAnalysed: 42, modulesSkipped: 186 }` |
| `score` | After Sonnet synthesis | `{ type: 'score', healthScore: 72, verdict: 'Needs Work', summary: '...', dimensions: {architecture, naming, formulas, dataHygiene, governance} }` |
| `narrative` | After Sonnet narrative | `{ type: 'narrative', story: '...', modules: [{id, name, purpose, receivesFrom, sendsTo, risks}] }` |
| `complete` | Terminal | `{ type: 'complete', healthScore: 72, totalSuggestions: 47, analysisId: '...'}` |
| `error` | Any stage failure | `{ type: 'error', message: '...' }` |

**Named exports (for future unit testing):**
- `extractionPrePass` — ANLZ-03 field stripping
- `normalizeSynthesis` — ANLZ-01 response normalisation
- `parseJsonStrict` — markdown fence stripping + JSON.parse
- `detectDependencies` — ANLZ-04 formula cross-reference detection

## Module-Skipping Rules

A module is skipped (ineligible for Haiku analysis) if:
- `mod.fetchError` is truthy (Anaplan fetch failed for that module in Phase 3)
- `mod.lineItemCount === 0` (extractionPrePass skips these entirely)
- `mod.lineItemCount < 3` (MIN_LINE_ITEMS_FOR_HAIKU — not enough signal for meaningful suggestions)

Skipped modules still emit a `haiku-progress` event with `skipped: true` so the UI can show total progress accurately.

## Token Counts (live run not performed — shell-based verification only)

No live API run performed in this wave (VALIDATION.md shell-based strategy). Token budget estimates from RESEARCH.md:
- Per-module Haiku prompt: ~520 tokens input, 1024 max output
- Sonnet synthesis: ~1,880 tokens input, 1024 max output
- Sonnet narrative (228 modules): ~11,680 tokens input, 4096 max output

All well under 180K. `countTokens()` pre-flight is the authoritative runtime check.

## Deviations from Plan

### 1. Dimension key names follow PLAN.md, not RESEARCH.md Pattern 6

**Found during:** Task 2 implementation
**Issue:** RESEARCH.md Pattern 6 uses dimension keys `structure, formula, bestPractice, naming, performance`. The PLAN.md `must_haves.truths` and `normalizeSynthesis` function spec use `architecture, naming, formulas, dataHygiene, governance`.
**Fix:** Used PLAN.md dimension keys as authoritative — PLAN.md overrides RESEARCH.md where they conflict.
**Impact:** Frontend (Phase 4 plan 02) must use the PLAN.md key names.

### 2. haiku-progress for skipped modules emitted before batch loop

**Found during:** Task 2 implementation
**Issue:** PLAN.md describes emitting skipped `haiku-progress` events interleaved with the batch loop, but the skipped modules are identified before the loop (they're filtered out into `eligible`). Emitting all skipped events upfront at the start of `runHaikuBatches` is simpler and functionally equivalent for the UI.
**Fix:** Skipped module events emitted in a pre-loop pass over `extractions`.
**Impact:** None — the events arrive before any real work begins, which is correct.

## Threat Mitigations Applied

| Threat | Mitigation |
|--------|-----------|
| T-04-01-01 Information Disclosure | `console.error('Analyze error:', err.message)` only — no req.body, no apiKey in logs or SSE |
| T-04-01-02 DoS runaway batches | `HAIKU_BUDGET_MS=45_000` check before each batch; `TOTAL_BUDGET_MS=55_000` guard before Sonnet |
| T-04-01-03 Token explosion | `guardTokens()` runs `countTokens()` before every Haiku and Sonnet call; throws if > 180K |

T-04-01-04 and T-04-01-05 accepted per threat register.

## Self-Check: PASSED

- [x] `/tmp/meridian-anaplan/api/analyze.js` exists (376 lines)
- [x] `/tmp/meridian-anaplan/vercel.json` contains `api/analyze.js` at 60s
- [x] commit 040ea08 exists — vercel.json update
- [x] commit dbbb544 exists — api/analyze.js creation
- [x] ESM import loads cleanly, default export is `function`
- [x] All named exports present: extractionPrePass, normalizeSynthesis, parseJsonStrict, detectDependencies
- [x] All acceptance criteria greps pass (model IDs, countTokens, SSE event types, triage/domain tags, security hygiene)
