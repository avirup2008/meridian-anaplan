---
phase: 7
reviewers: [gemini, codex]
reviewed_at: 2026-05-15T17:20:00Z
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

## Codex Review (gpt-5.5)

### Summary
The two-call split is directionally solid: it reduces prompt scope, makes the core health score deterministic, and keeps the SSE stream useful even when Anthropic fails. The main weakness is not the parallelism itself, but validation and UI integration. The API accepts weak AI payloads too easily, while the UI still has several assumptions from the older `score`/`suggestion` event flow, so "successful" AI output can still be generic, under-rendered, or counted as zero workstreams.

### Strengths
- Deterministic `healthScore` and `architectureVerdict` are good product choices; the app no longer depends on AI for core scoring.
- `Promise.allSettled()` is the right shape for independently fallible AI enrichments.
- Normal markdown-fenced JSON will usually parse because extraction uses first `{` and last `}`.
- Fallback workstreams remain available via `intelligence.workstreams` when the AI call rejects.
- `startOver()` correctly clears all cached state keys and uses `location.replace()` to avoid back-button reload loops.

### Concerns

| Severity | Concern |
|----------|---------|
| HIGH | **No workstream schema validation** — any non-empty `workstreams` array replaces deterministic fallback, even if items omit required fields or are generic. |
| HIGH | **`dash-badge-suggestions` never updated** — v3 workstreams don't update the Workstreams tab badge, so it stays "0" even when health workstreams render in the Assessment tab. |
| MEDIUM | **Prompt examples contain invalid JSON** — `{"id":"ws-2",...}` placeholders cause Haiku to copy the `...` pattern, producing invalid JSON that fails `JSON.parse`. |
| MEDIUM | **JSON extraction fragility** — if model adds prose with braces before JSON, or echoes a schema block, `raw.slice(firstBrace, lastBrace)` can produce invalid combined JSON. |
| MEDIUM | **`assessment` and `evidenceLimits` silently dropped** — emitted by API but never rendered. |
| LOW | **`?reset` checked after `?id`** — `?reset&id=...` routes to shared report, not reset. |
| LOW | **Health score caps at 95** — clean models score 95, not 100. Should be documented. |

### Specific Bugs
1. AI workstreams accepted with no schema validation — bad payload replaces good deterministic fallback.
2. `dash-badge-suggestions` stays "0" even after health workstreams render.
3. `{"id":"ws-2",...}` in prompt causes Haiku to output `...` literally, breaking JSON parse.
4. `?reset&id=` combination routes to shared report instead of resetting.

### Suggestions
- Add strict normalizer for AI workstreams: require valid priority/confidence/kind enum values, non-empty string fields, numeric `evidenceCount`. Keep deterministic fallback if validation fails.
- Replace prompt schema examples with three complete valid JSON objects (no `...` placeholders).
- Update `dash-badge-suggestions` from `evt.workstreams.length` in `_anlOnHealthWorkstreams`.
- Check `?reset` before `?id` in boot router.
- Document the 95 cap in a code comment.

### Risk Assessment: MEDIUM
Server-side fallback prevents total failure at transport level. Remaining risk is product correctness: weak AI JSON can replace good deterministic workstreams, and the UI under-consumes the new payload shape.

---

## Consensus Summary (Gemini + Codex)

### Confirmed Strengths
- `Promise.allSettled` parallelism is the right pattern
- Deterministic health score + verdict eliminates AI hallucination risk
- `startOver()` correctly clears all persistence layers

### Priority Fixes (from both reviewers)

| # | Issue | Raised by | Severity | Status |
|---|-------|-----------|----------|--------|
| 1 | Haiku ignores soft "no markdown fences" instruction | Gemini | HIGH | Fixed — hard constraint added to both prompts |
| 2 | `api/test-ai.js` exposes internals | Gemini | HIGH | Fixed — deleted |
| 3 | No workstream schema validation | Codex | HIGH | Fixed — validator added before replacing fallback |
| 4 | Workstreams tab badge stays "0" | Codex | HIGH | Fixed — badge updated in `_anlOnHealthWorkstreams` |
| 5 | Prompt `...` placeholders cause invalid JSON output | Codex | MEDIUM | Fixed — replaced with 3 complete valid examples |
| 6 | `?reset` checked after `?id` in boot router | Codex | LOW | Fixed — `?reset` now checked first |
| 7 | Dead HTML (`#health-score-split`, `#health-score-reasoning`) | Gemini | LOW | Fixed — removed from DOM |
| 8 | 95 health score cap undocumented | Codex | LOW | Fixed — comment added |
| 9 | `assessment` + `evidenceLimits` silently dropped | Both | MEDIUM | Open — separate UI pass needed |
| 10 | Duplicate `architectureVerdict` emission | Gemini | LOW | Kept — removing breaks verdict card render |
