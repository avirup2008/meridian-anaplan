---
phase: 04-analysis
plan: 02
subsystem: analysis-ui
tags: [analysis, ui, sse, frontend, vanilla-js]
dependency_graph:
  requires: [api/analyze.js, index.html Phase 3 s-fetch section]
  provides: [index.html s-analysis v2 UI, runAnalysis() SSE consumer]
  affects: [index.html Phase 5 export/dashboard sections]
tech_stack:
  added: []
  patterns:
    - fetch() + ReadableStream SSE consumer (POST endpoint, not EventSource)
    - Incremental DOM updates on SSE events (no full re-render)
    - _anlEsc() XSS guard for all innerHTML injection of Anaplan/Claude strings
    - go() IIFE wrapper hook to trigger runAnalysis() on screen entry
key_files:
  created: []
  modified:
    - index.html
decisions:
  - Dimension keys use architecture/naming/formulas/dataHygiene/governance matching api/analyze.js (not RESEARCH.md Pattern 6 names)
  - SSE parsing uses line-by-line split on '\n' matching the api/analyze.js sendEvent format ('data: {...}\n\n')
  - go() hooked via IIFE rather than modifying go() body directly — preserves existing function integrity
  - _anlRunning guard prevents duplicate runAnalysis() calls if user navigates away and back rapidly
metrics:
  duration: ~15 minutes
  completed: 2026-05-11
  tasks: 2
  files: 1
---

# Phase 04 Plan 02: Analysis UI — Summary

## One-liner

v2 s-analysis screen with live SSE progress bar, health score card, 5-dimension bars, domain-grouped suggestion cards with triage pills, cross-module narrative, and per-module drill-in panel — fully wired to `/api/analyze`.

## What Was Built

### Task 1: s-analysis HTML + CSS (commit 5fb39b7)

Replaced the v1 stub `<div id="s-analysis">` (lines 737–775 of index.html) with the full v2 markup, and replaced the minimal CSS comment block with 60+ `.anl-*` CSS rules.

**HTML panels added inside `#s-analysis`:**

| Element ID | Purpose |
|---|---|
| `anl-hdr-status` | Header status text ("Preparing analysis…" → "Analysis complete") |
| `anl-progress-wrap` | Progress bar container (hidden after complete) |
| `anl-stage-label` | Current stage name (Fetching blueprint, Extracting modules, etc.) |
| `anl-progress-bar` | Progress fill bar (0–100% width) |
| `anl-progress-pct` | Percentage text |
| `anl-progress-detail` | Secondary detail (module count, haiku progress) |
| `anl-error` | Error banner (hidden by default) |
| `anl-error-msg` | Error message text |
| `anl-warning` | Partial-analysis warning banner (hidden by default) |
| `anl-warning-msg` | Warning message text |
| `anl-score-card` | Score card container (hidden until `score` event) |
| `anl-score-num` | Health score number (e.g. "72/100") |
| `anl-verdict-chip` | Verdict badge with colour-coded dot (Good/Needs Work/Critical) |
| `anl-verdict-text` | Verdict label inside chip |
| `anl-summary` | Executive summary paragraph |
| `anl-dims` | 5 dimension bar rows (architecture, naming, formulas, dataHygiene, governance) |
| `anl-suggestions` | Suggestions panel (hidden until `complete` event) |
| `anl-sugg-count` | Total suggestion count badge |
| `anl-suggestion-domains` | Container for domain group cards |
| `anl-narrative` | Narrative panel (hidden until `narrative` event) |
| `anl-story-text` | Cross-module data flow story text |
| `anl-module-nodes` | Clickable module node chips |
| `anl-narrative-story-view` | Story view (shown by default within narrative panel) |
| `anl-narrative-drill-view` | Drill-in view (hidden by default) |
| `anl-breadcrumb-back` | "← Back to story" link |
| `anl-breadcrumb-mod` | Module name in breadcrumb |
| `anl-drill-name` | Module name heading in drill view |
| `anl-drill-purpose` | Module purpose text |
| `anl-drill-rx` | "Receives from" list |
| `anl-drill-tx` | "Sends to" list |
| `anl-drill-risks` | Risks list |

**CSS added:** All `.anl-*` classes including `.anl-triage.t-fix` (red), `.anl-triage.t-con` (gold), `.anl-triage.t-mon` (blue) per the CSS token spec.

### Task 2: SECTION: ANALYSIS JS block (commit d614c06)

Inserted a new `// SECTION: ANALYSIS` block between `// SECTION: FETCH` and `// SECTION: DASHBOARD`.

**Functions defined:**

| Function | Purpose |
|---|---|
| `_anl$(id)` | getElementById shorthand |
| `_anlReset()` | Reset all UI state before each run |
| `_anlShowError(message)` | Show inline error, hide progress bar |
| `_anlOnProgress(stage, pct)` | Update stage label + progress bar |
| `_anlOnExtractionDone(moduleCount, totalLineItems)` | Update progress detail text |
| `_anlOnHaikuProgress(done, total, name, skipped)` | Sub-progress within 25–65% range |
| `_anlOnSuggestions(evt)` | Accumulate suggestions by domain into `_anlState` |
| `_anlOnPartial(reason, analysed, skipped)` | Show warning banner |
| `_anlOnScore(s)` | Render score card + dimension bars |
| `_anlRenderSuggestions()` | Build domain-grouped suggestion HTML (called at `complete`) |
| `_anlEsc(s)` | XSS escape for innerHTML insertion |
| `_anlOnNarrative(n)` | Render story text + module node chips |
| `_anlDrillIn(moduleId)` | Show drill-in panel for a module |
| `_anlOnComplete(c)` | Render suggestions, hide progress bar, update header/sub |
| `runAnalysis()` | Main async SSE consumer — POST to /api/analyze, parse stream |
| IIFE go() hook | Wraps `window.go` to call `setTimeout(runAnalysis, 0)` on 's-analysis' |

**SSE event dispatch table (all handled):**

| Event type | Handler |
|---|---|
| `progress` | `_anlOnProgress(stage, pct)` |
| `extraction-done` | `_anlOnExtractionDone(moduleCount, totalLineItems)` |
| `haiku-progress` | `_anlOnHaikuProgress(done, total, name, skipped)` |
| `suggestions` | `_anlOnSuggestions(evt)` |
| `partial-analysis` | `_anlOnPartial(reason, analysed, skipped)` |
| `score` | `_anlOnScore(evt)` |
| `narrative` | `_anlOnNarrative(evt)` |
| `complete` | `_anlOnComplete(evt)` |
| `error` | `_anlShowError(evt.message)` |

## Threat Mitigations Applied

| Threat ID | Mitigation |
|---|---|
| T-04-02-01 XSS | All Claude/Haiku strings (suggestion text/reasoning/action, moduleName, story, module purpose/risks) routed through `_anlEsc()` before `innerHTML` assignment; story text and list items use `textContent` where possible |
| T-04-02-02 blobUrl disclosure | `blobUrl` only used in `fetch()` POST body; no `console.log(blobUrl)` anywhere in the new block |
| T-04-02-03 Malformed SSE | Each `JSON.parse(payload)` wrapped in try/catch; malformed events skipped via `continue` |
| T-04-02-04 Missing blueprint | `runAnalysis()` checks `sessionStorage.getItem('meridian.blueprintBlobUrl')` on entry; missing → friendly error + "Re-fetch blueprint" button |

T-04-02-05 accepted per threat register.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. All data sources are wired: `runAnalysis()` connects to live `/api/analyze` SSE endpoint on screen entry; the `blobUrl` is read from `sessionStorage` as set by Phase 3's `fetchBlueprint()` complete handler. No hardcoded values or placeholders in the rendered UI path.

## Acceptance Criteria Verification

```
grep -c '<!-- SECTION: ANALYSIS -->' index.html  → 1  ✓
grep -c 'id="anl-score-card"' index.html         → 1  ✓
grep -c 'data-key="architecture"' index.html     → 1  ✓
grep -c 'data-key="naming"' index.html           → 1  ✓
grep -c 'data-key="formulas"' index.html         → 1  ✓
grep -c 'data-key="dataHygiene"' index.html      → 1  ✓
grep -c 'data-key="governance"' index.html       → 1  ✓
grep -c 'anl-triage.t-fix' index.html            → 1  ✓  (CSS class definition)
grep -c 'id="anl-narrative-drill-view"' index.html → 1  ✓
grep -c 'id="anl-breadcrumb-back"' index.html    → 1  ✓
grep -c 'id="anl-mii-num"' index.html            → 0  ✓  (old stub removed)
grep -c '<!-- SECTION: CONNECT -->' index.html   → 1  ✓  (boundary preserved)
grep -c '// SECTION: ANALYSIS' index.html        → 1  ✓
grep -c 'async function runAnalysis' index.html  → 1  ✓
grep -c "fetch('/api/analyze'" index.html        → 1  ✓
grep -c "sessionStorage.getItem('meridian.blueprintBlobUrl')" index.html → 1  ✓
grep -c '_anlOnScore|_anlOnNarrative|...' index.html → 10 ✓
grep -c "'Fix Now'" index.html                   → 4  ✓  (≥2 required)
grep -c "case 'narrative'" index.html            → 1  ✓
grep -c "case 'partial-analysis'" index.html     → 1  ✓
grep -c "anl-breadcrumb-back" index.html         → 2  ✓  (HTML + JS)
grep -c "reader.read()" index.html               → 2  ✓  (FETCH + ANALYSIS)
grep -c '// SECTION: FETCH' index.html           → 1  ✓  (no regression)
grep -c '// SECTION: DASHBOARD' index.html       → 1  ✓  (no regression)
```

## Self-Check: PASSED

- [x] `/tmp/meridian-anaplan/index.html` exists and contains all v2 s-analysis markup
- [x] commit 5fb39b7 exists — Task 1 HTML + CSS
- [x] commit d614c06 exists — Task 2 JS block
- [x] All acceptance criteria greps pass (documented above)
- [x] All 9 SSE event types handled in `runAnalysis()` switch
- [x] All threat mitigations applied: _anlEsc(), blobUrl guard, try/catch SSE parse, sessionStorage check
- [x] SECTION: CONNECT, FETCH, DASHBOARD boundaries intact and unchanged
- [x] No TypeScript, no import/export syntax, no framework — plain vanilla JS as required
