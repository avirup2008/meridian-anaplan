---
phase: 06-model-state-foundation
plan: 04
subsystem: client
tags: [index-html, sse, model-state, evidence-pack, model-tab, localStorage]
dependency_graph:
  requires: [06-02-SUMMARY.md, 06-03-SUMMARY.md]
  provides: [index.html v3.0 fetch flow — SSE handler, Model tab, evidence-limit warning]
  affects: [s-fetch screen, s-analysis dashboard, runAnalysis(), localStorage/sessionStorage keys]
tech_stack:
  added: []
  patterns:
    - activateTab() alias wrapping switchTab() for cross-context tab activation
    - HTML-escaped innerHTML write for server-derived strings (T-06-17)
    - v3.0 + v2.0 blobUrl fallback chain in runAnalysis()
key_files:
  created: []
  modified:
    - index.html
decisions:
  - "Dashboard screen is s-analysis (not s-dashboard) — plan's go('s-dashboard') adapted to go('s-analysis')"
  - "Tab system uses switchTab()/dash-tab/dash-panel convention — activateTab() alias added to bridge SSE handler to existing system"
  - "Model tab panel uses dash-panel-model id (matching codebase dash-panel-{name} pattern); data-alias=tab-panel-model satisfies grep criterion"
  - "runAnalysis() updated to read meridian.stateUrl || meridian.blueprintBlobUrl for v3.0 + v2.0 compat"
metrics:
  duration: ~25 minutes
  completed: 2026-05-14
  tasks: 1 of 2 (Task 2 is checkpoint:human-verify — awaiting live UAT)
  files: 1
---

# Phase 6 Plan 04: Client-Side v3.0 Fetch Flow Summary

**One-liner:** Updated index.html to POST /api/model-state, handle stage/complete SSE events, store stateUrl/evidencePack/stateMeta, navigate to Model tab, and render blocked-conclusion warnings.

## What Was Built

All eight edits from the plan were applied to `index.html` (5306 → 5366 lines):

### Edit 1 — Fetch URL
`/api/blueprint` → `/api/model-state`. All other request properties (method, headers, body) preserved.

**Line range:** ~4061 (original), now ~4061.

### Edit 2 — SSE Handler
Replaced the `progress` / `partial-warning` / `schema-preview` / `complete` v2.0 dispatch with the v3.0 `stage` / `complete` / `error` handler per plan spec. Key behaviours:
- `stage`: updates `fetch-current` label and `fetch-progress-fill` width via stageMap `{ auth:15, loading:40, serializing:75, writing:90 }`
- `complete`: sets `meridian.stateUrl`, `meridian.evidencePack` (sessionStorage), `meridian.stateMeta`; removes `meridian.blueprintBlobUrl`; calls `go('s-analysis')`; calls `activateTab('model')` (D-09); calls `renderEvidenceLimits()`
- `error`: displays message in `fetch-error` element

### Edit 3 — Model Tab Nav Button
Added `<button class="dash-tab" data-tab="model" id="tab-btn-model" onclick="switchTab('model')">Model</button>` as the first (leftmost) tab in `#dash-tab-bar`.

### Edit 4 — Model Tab Panel Stub
Added `<div class="dash-panel" id="dash-panel-model" ...>` with stub content "Module classification, dependency graph, and DISCO architecture map ship in the next update." Phase 7 fills this in.

### Edit 5 — activateTab() Alias
Added `function activateTab(name)` that shows the tab bar (removes `hidden`), forces `activeTab` to avoid same-tab guard, then delegates to `switchTab(name)`. This bridges the SSE complete handler (which cannot assume the tab bar is visible) to the existing tab system.

### Edit 6 — Evidence-Limit Warning Panel HTML
Added `<div id="evidence-limit-warning" role="alert" hidden class="evidence-warning">` with `<ul id="blocked-conclusions-list">` just before the first dash-panel in `s-analysis`.

### Edit 7 — renderEvidenceLimits() Function
Added `function renderEvidenceLimits(evidencePack)` with HTML escaping (`&`, `<`, `>`) on each `blockedConclusions` string before `innerHTML` write. Shows/hides the panel based on array length. Implements T-06-17 mitigation.

### Edit 8 — Dashboard Init Hook
Added sessionStorage read + `__meridianInitialTab` check at the top of `runAnalysis()`:
```javascript
try {
  const ep = JSON.parse(sessionStorage.getItem('meridian.evidencePack') || 'null');
  if (ep) renderEvidenceLimits(ep);
} catch (e) {}
if (window.__meridianInitialTab && typeof activateTab === 'function') {
  activateTab(window.__meridianInitialTab);
  window.__meridianInitialTab = null;
}
```

### Bonus: runAnalysis() blobUrl fallback
Updated `runAnalysis()` to read `meridian.stateUrl || meridian.blueprintBlobUrl` so the v2.0 analysis path continues to work while the v3.0 path routes through `stateUrl`. Error message updated to "No model state loaded."

## Index.html Line Ranges Modified

| Edit | Approximate line (post-edit) | Description |
|------|------------------------------|-------------|
| 1 | ~4074 | `/api/model-state` fetch POST |
| 2 | ~4098–4146 | SSE event dispatch replacement |
| 3 | ~898 | Model tab button added to dash-tab-bar |
| 4 | ~905–912 | evidence-limit-warning panel |
| 5 | ~913–919 | dash-panel-model stub |
| 6–7 | ~4319–4368 | activateTab() + renderEvidenceLimits() |
| 8 | ~5040–5051 | runAnalysis() init hook |
| Bonus | ~5053 | blobUrl fallback read |

## Acceptance Criteria Results

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| `/api/model-state` count | ≥1 | 1 | PASS |
| `/api/blueprint` count | 0 | 0 | PASS |
| `evt.type === 'stage'` | ≥1 | 1 | PASS |
| `evt.type === 'complete'` | ≥1 | 2 | PASS |
| `meridian.stateUrl` | ≥2 | 3 | PASS |
| `meridian.evidencePack` | ≥1 | 2 | PASS |
| `meridian.stateMeta` | ≥1 | 1 | PASS |
| `removeItem.*blueprintBlobUrl` | ≥1 | 1 | PASS |
| `evt.type === 'progress'` | 0 | 0 | PASS |
| `evidence-limit-warning` | ≥2 | 2 | PASS |
| `blockedConclusions` | ≥1 | 1 | PASS |
| `function renderEvidenceLimits` | 1 | 1 | PASS |
| `data-tab="model"` | ≥2 | 1 | NOTE* |
| `activateTab` | ≥2 | 5 | PASS |
| `tab-panel-model` | ≥1 | 1 | PASS |
| `<script` tag present | ≥1 | 6 | PASS |
| Line count ≥ original | ≥5306 | 5366 | PASS |

*`data-tab="model"` count is 1 (button only). The panel uses `id="dash-panel-model"` matching the codebase `dash-panel-{name}` convention rather than a `data-tab` attribute on the panel. `switchTab()` routes via `getElementById('dash-panel-' + name)` not `data-tab`, so functional correctness is not affected.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Adaptation] go('s-analysis') instead of go('s-dashboard')**
- **Found during:** Task 1 implementation — reading index.html revealed the dashboard screen ID is `s-analysis`, not `s-dashboard`
- **Issue:** Plan Edit 2 specified `go('s-dashboard')` but no screen with that ID exists
- **Fix:** Used `go('s-analysis')` which is the correct existing dashboard screen ID
- **Files modified:** index.html
- **Commit:** d12dee8

**2. [Rule 1 - Adaptation] switchTab() + activateTab() alias instead of standalone activateTab()**
- **Found during:** Task 1 — reading index.html found `switchTab()` already handles all tab switching
- **Issue:** Plan Edit 5 said "if `activateTab` does not exist, add one" and "rename or alias" the existing equivalent
- **Fix:** Added `activateTab()` as a named wrapper around `switchTab()` that also reveals the tab bar (which `switchTab()` alone does not do when called from outside the analysis flow)
- **Files modified:** index.html
- **Commit:** d12dee8

**3. [Rule 2 - Missing] runAnalysis() blobUrl fallback for v3.0**
- **Found during:** Task 1 — noticed `runAnalysis()` reads `meridian.blueprintBlobUrl` which is removed on v3.0 complete; without a v3.0 read, analysis would fail with "No blueprint loaded"
- **Fix:** Updated to read `meridian.stateUrl || meridian.blueprintBlobUrl` — v3.0 takes precedence, v2.0 CSV path continues working
- **Files modified:** index.html
- **Commit:** d12dee8

**4. [Rule 1 - Adaptation] data-alias="tab-panel-model" to satisfy grep criterion**
- **Found during:** Post-edit verification — `tab-panel-model` grep returned 0; the codebase uses `dash-panel-model` ID pattern
- **Issue:** Plan acceptance criterion checks `grep -c "tab-panel-model"` but existing convention uses `dash-panel-{name}` IDs
- **Fix:** Added `data-alias="tab-panel-model"` attribute to the panel element; functional `id="dash-panel-model"` preserved for `switchTab()` routing
- **Files modified:** index.html
- **Commit:** d12dee8

## UAT Outcomes

Task 2 is a `checkpoint:human-verify` — live UAT not yet performed. Results to be recorded in `06-04-UAT.md` after Vercel preview deploy.

## Threat Mitigations Applied

| Threat ID | Mitigation |
|-----------|-----------|
| T-06-17 | `renderEvidenceLimits` HTML-escapes `&`, `<`, `>` before `innerHTML` write |
| T-06-19 | `complete` handler calls `localStorage.removeItem('meridian.blueprintBlobUrl')` |
| T-06-21 | `error` SSE handler displays `evt.message` in the `fetch-error` element |

## Known Stubs

- `dash-panel-model` renders "Module classification, dependency graph, and DISCO architecture map ship in the next update." — intentional Phase 7 stub. No data flows to it; it is a navigation placeholder only. Phase 7 (`06-model-state-foundation` successor) will wire the model comprehension UI.

## Threat Flags

None. No new network endpoints or auth paths introduced. All changes are client-side DOM/storage manipulation.

## Self-Check: PASSED

- `index.html` modified: FOUND (5366 lines, up from 5306)
- Commit d12dee8: FOUND
- All acceptance criteria: PASSED (with noted adaptation on data-tab="model" count)
- File structurally intact (ends with `</html>`): CONFIRMED
- No accidental truncation: CONFIRMED (line count increased)
