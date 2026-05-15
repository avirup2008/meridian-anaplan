---
phase: 7
reviewers: [gemini]
reviewed_at: 2026-05-15T16:55:00Z
codex_skipped: no OpenAI API key configured
claude_skipped: self (running inside Claude Code)
scope: api/analyze-v3.js + index.html (Phase 7 implementation)
---

# Cross-AI Review — Phase 7 Implementation

## Gemini Review

This code review analyzes the Phase 7 implementation of the Meridian Anaplan Analyzer, focusing on the shift to parallelized Haiku AI calls and deterministic health scoring.

### Summary
The implementation demonstrates a significant architectural maturation by decoupling core logic from AI whims. Moving the Health Score and Architecture Verdict to deterministic functions solves the "hallucination vs. reality" conflict and drastically improves reliability. The parallelized AI strategy via `Promise.allSettled` is a smart optimization for the Vercel execution environment, though the interface between the API and UI currently suffers from "integration drift" — where the API is emitting rich data that the UI has not yet been updated to display.

### Strengths
- **Parallelization strategy:** `Promise.allSettled` ensures a failure in the Architecture Story doesn't block Health Workstreams delivery.
- **Deterministic core:** Health score formula correctly accounts for blast radius — a bug in a high-fan-out module is objectively worse than one in a leaf module.
- **State management:** `startOver()` is thorough — clears `localStorage`, `sessionStorage`, and uses `location.replace` to prevent back-button cache loop.
- **Cost/latency optimization:** Shifting from Sonnet to Haiku for structured extraction is appropriate — these tasks need pattern matching, not deep reasoning.

### Concerns

| Severity | Concern |
|----------|---------|
| HIGH | **JSON extraction robustness** — `indexOf('{')` / `lastIndexOf('}')` works for the happy path but Haiku frequently ignores "Return only JSON" and wraps output in markdown fences. If trailing text appears after the closing fence, the extraction may include it. |
| MEDIUM | **Vercel timeout window** — 20s code timeout + Vercel's function overhead. Hobby accounts are capped at 10s; Pro allows 60s. Parallel Haiku calls might still skirt limits on cold starts. |
| MEDIUM | **Event-to-UI mismatch** — API emits `assessment` and `evidenceLimits` but UI discards them. Production renders no confidence label or `canSay`/`cannotSay` content. |
| LOW | **Health score sensitivity on small models** — `penalty / moduleCount * 8` is overly punitive for models with < 10 modules. A 5-module model with one critical finding could score ~30. |

### Specific Bugs

1. **Haiku markdown fencing** — Test output confirms Haiku wraps response in ` ```json ` despite instruction. Current `indexOf('{')` extraction handles this correctly, but if Haiku adds trailing explanation text *after* the closing fence AND that text contains `}`, `lastIndexOf('}')` returns the wrong position.

2. **Architecture verdict emitted twice** — `architectureVerdict` appears in both `model-comprehension-enriched` and `health-workstreams`. If the UI applies both events sequentially, no issue (same deterministic value). But this is redundant coupling.

3. **`assessment` silently dropped** — `_anlOnHealthWorkstreams` receives `evt.assessment` but no DOM element renders `posture` or `confidence`. User never sees AI confidence level.

4. **Domain `moduleCount` fallback** — If Haiku returns a domain object with neither `moduleCount` nor `moduleIds`, the fallback evaluates to `0`, not `undefined` — so it renders "0 modules" rather than hiding the count. Acceptable but imprecise.

5. **`api/test-ai.js` left in repo** — Diagnostic endpoint exposes Anthropic SDK initialization logic and consumes API credits if crawled. Should be deleted before shipping.

6. **Dead HTML** — `#health-score-split` and `#health-score-reasoning` remain in the DOM with no content written to them. They contribute to DOM weight and confuse future readers.

### Suggestions

- **Harder prompt constraint:** Add to workstream prompt: *"Your response MUST begin with `{` and end with `}`. No markdown fences. No preamble."*
- **Regex extraction:** `raw.match(/{[\s\S]*}/)?.[0]` is equivalent to current approach but fails more explicitly — or use a streaming approach to avoid needing extraction at all.
- **Hydrate assessment:** Render `evt.assessment.confidence` ("Qualified evidence" / "Evidence limited") somewhere in the Assessment tab header.
- **Delete `api/test-ai.js`** — Security / cost concern.
- **Remove dead HTML:** Delete `#health-score-split` and `#health-score-reasoning` `<div>`s from the verdict card.

### Risk Assessment: MEDIUM
Core logic (deterministic analysis) is solid. The AI integration layer is brittle — production tests are still seeing deterministic fallbacks, suggesting the JSON parsing or Haiku response format is already failing. Once JSON extraction is hardened and dead elements cleaned up, risk drops to LOW.

---

## Consensus Summary (single reviewer)

### Confirmed Strengths
- `Promise.allSettled` parallelism is the right pattern
- Deterministic health score + verdict eliminates AI hallucination risk
- `startOver()` correctly clears all persistence layers

### Priority Fixes (from review)

| # | Issue | Severity | File | Action |
|---|-------|----------|------|--------|
| 1 | Haiku may add trailing `}` after fence | HIGH | analyze-v3.js | Add prompt constraint: output must begin with `{` |
| 2 | `api/test-ai.js` exposes internals | HIGH | test-ai.js | Delete the file |
| 3 | `assessment` + `evidenceLimits` silently dropped | MEDIUM | index.html | Render confidence label or remove from API payload |
| 4 | Dead HTML elements | LOW | index.html | Remove `#health-score-split` and `#health-score-reasoning` |
| 5 | Duplicate `architectureVerdict` emission | LOW | analyze-v3.js | Remove from `health-workstreams` payload (already in enriched) |
