---
phase: 02-connection
plan: "03"
subsystem: ui-model-picker
tags: [anaplan, model-picker, sessionStorage, localStorage, XSS, recently-used, javascript, css, html]
dependency_graph:
  requires: [02-01, 02-02]
  provides: [index.html s-picker screen, index.html SECTION:MODEL-PICKER JS]
  affects: [index.html]
tech_stack:
  added: []
  patterns: [Promise.allSettled-parallel-fetch, recently-used-localStorage, XSS-escaping-innerHTML, collapsible-workspace-groups, model-card-selection]
key_files:
  created: []
  modified:
    - index.html
decisions:
  - "All CSS tokens (--pos-pale, --gold-pale, --gold-bd, --sh-lg, --neg-pale, --neg-bd) were already present in :root from Plan 02 — no additions needed in Plan 03"
  - "loadModels() stub removed from SECTION: CONNECT; exactly one definition of loadModels() now exists in SECTION: MODEL-PICKER"
  - "escHtml() applied to all Anaplan-sourced strings (model.name, workspaceName, activeState, lastMod) to prevent XSS from external data rendered via innerHTML"
  - "Recently used models stored in localStorage key 'meridian_recent_models' — display data only (id, name, workspaceId, workspaceName, selectedAt); no credentials"
  - "confirmModelSelection() calls addToRecents() then go('s-fetch') — Phase 3 creates s-fetch screen; go() silently no-ops if element not found"
  - "workspaceId lowercased before /api/models fetch URL and in selectModel()/confirmModelSelection() per RESEARCH.md Pitfall 2"
metrics:
  duration: "~12 minutes"
  completed: "2026-05-10"
  tasks_completed: 2
  files_changed: 1
---

# Phase 2 Plan 3: Model Picker HTML, CSS, and JS Summary

**One-liner:** Model picker with workspace-grouped collapsible cards, recently-used localStorage section, XSS-safe rendering, token-expiry guard, and full Promise.allSettled parallel fetch replacing the Plan 02 navigation stub.

## What Was Built

Single file modified: `index.html`. Two tasks, two commits.

### Task 1: HTML + CSS

**HTML section added (inside SECTION: MODEL-PICKER boundary comments):**

- `<div id="s-picker" class="screen">` — new screen participating in go() system automatically
  - `picker-shell` / `picker-inner` — layout wrapper with max-width 860px
  - `picker-header` — title "Choose a model" + live model count (`id="picker-count"`)
  - `id="picker-loading"` — spinner + "Loading models…" text, hidden by default
  - `id="picker-error"` — error message box, hidden by default
  - `id="picker-list"` — empty div; renderPicker() populates this at runtime
  - `id="picker-cta"` — CTA row with "Fetch blueprint →" button (`confirmModelSelection()`) and "← Back" button; hidden until a card is selected

**CSS classes added (before `</style>`):**

| Class | Purpose |
|-------|---------|
| `.picker-shell` | Full-viewport background shell with 80px top padding |
| `.picker-inner` | Max-width 860px centered container |
| `.picker-header` | Flex row for title and live count |
| `.picker-title` | 22px bold heading |
| `.picker-count` | 12px mono live count label |
| `.picker-loading` | Flex row with spinner; hidden by default |
| `.picker-error` | Red-tinted error box with neg-pale background |
| `.recents-section` | Wrapper for recently-used grid section |
| `.recents-label` | Uppercase 9px mono "Recently used" label with bottom border |
| `.workspace-section` | Per-workspace grouping wrapper |
| `.workspace-header` | Clickable collapsible workspace header row |
| `.workspace-toggle` | Rotating triangle indicator (rotates 90deg when open) |
| `.model-grid` | Auto-fill responsive grid, min 240px per card |
| `.model-card` | Individual model card with border, hover, selected states |
| `.model-name` | 14px bold model name |
| `.model-ws` | 11px mono workspace name below title |
| `.model-meta` | 11px flex row for activeState + lastModified |
| `.model-recent-badge` | Absolute-positioned "Recent" badge (gold-pale background) |
| `.picker-cta` | Flex row for CTA buttons, hidden until selection |

**CSS token note:** All tokens (`--pos-pale`, `--gold-pale`, `--gold-bd`, `--sh-lg`, `--neg-pale`, `--neg-bd`) were already defined in `:root` from Plan 02. No `:root` additions were needed in this plan.

### Task 2: JavaScript (SECTION: MODEL-PICKER)

**Stub removal:** `loadModels()` navigation stub was removed from `// SECTION: CONNECT`. Exactly one `function loadModels` definition now exists in the file (in SECTION: MODEL-PICKER).

**Functions added inside `// SECTION: MODEL-PICKER` block:**

| Function | Purpose |
|----------|---------|
| `getRecentModels()` | Reads `localStorage['meridian_recent_models']`, returns array or `[]` on error |
| `addToRecents({id, name, workspaceId, workspaceName})` | Prepends entry, deduplicates by id, caps at 5, writes to localStorage |
| `loadModels()` | Full implementation: checkTokenExpiry() → go('s-picker') → Promise.allSettled fetch per workspace → renderPicker() |
| `renderPicker(models)` | Builds recently-used section (if any valid entries) + workspace-grouped collapsible model cards |
| `buildModelCard(model, isRecent)` | Creates model card DOM element; applies escHtml() to all Anaplan-sourced strings |
| `escHtml(str)` | Escapes &, <, >, " to prevent XSS from Anaplan model names rendered via innerHTML |
| `selectModel(modelId, modelName, workspaceId, workspaceName)` | Highlights selected card, stores state in module-level vars, shows picker-cta |
| `confirmModelSelection()` | checkTokenExpiry() → setSession() with modelId/modelName/workspaceId/workspaceName → addToRecents() → go('s-fetch') |

**Key implementation details:**
- `loadModels()` uses `Promise.allSettled()` — partial failures (one workspace 404) still render successful workspaces; only shows error if ALL workspaces fail
- `checkTokenExpiry()` called at top of both `loadModels()` and `confirmModelSelection()` — implements T-02-16 and T-02-15 mitigations
- `escHtml()` applied to `model.name`, `workspaceName`, `currentWorkspaceName`, `model.activeState`, `lastMod` — implements T-02-13 mitigation
- `workspaceId` lowercased via `.toLowerCase()` before `/api/models` fetch URL — implements T-02-18 mitigation (RESEARCH.md Pitfall 2)
- `addToRecents()` stores only `{ id, name, workspaceId, workspaceName, selectedAt }` — no credentials, no token (T-02-14 accepted)
- `confirmModelSelection()` calls `go('s-fetch')` — Phase 3 will create `id="s-fetch"` screen; `go()` silently no-ops if element not found until then

## loadModels() Stub Removal Confirmed

The Plan 02 stub in `// SECTION: CONNECT` (lines approx 3270-3276) was:
```javascript
function loadModels() {
  if (!checkTokenExpiry()) return;
  go('s-picker');
}
```

This was removed and replaced by the full async implementation in `// SECTION: MODEL-PICKER`. The file now contains exactly one definition of `function loadModels`.

## escHtml() Rationale

Model names, workspace names, and `activeState` strings all come from the Anaplan API — they are external, user-controlled data (workspace/model names are set by Anaplan admins and can contain any characters). Rendering them via `innerHTML` without sanitization would allow XSS if a model name contained `<script>` or `"><img onerror=...`. `escHtml()` escapes the four HTML metacharacters (`&`, `<`, `>`, `"`) before insertion.

## Forward Reference

`confirmModelSelection()` calls `go('s-fetch')`. The `id="s-fetch"` screen div does not yet exist — Phase 3 will create it. The existing `go()` function uses `document.querySelector('#' + id)` which returns `null` if the element doesn't exist; the function assigns `.active` class to `null`, which is a no-op. This is acceptable per the plan spec.

## Verification Results

```
=== Function definition counts (expect 1 each) ===
loadModels: 1 definitions (expect 1)
renderPicker: 1 definitions (expect 1)
selectModel: 1 definitions (expect 1)
addToRecents: 1 definitions (expect 1)
confirmModelSelection: 1 definitions (expect 1)
escHtml: 1 definitions (expect 1)

=== Security checks ===
PASS: zero Anaplan URLs (grep 'anaplan.com' returns 0)
PASS: no credentials in localStorage (grep 'localStorage.*password' returns 0)

=== checkTokenExpiry calls (non-definition) ===
  if (!checkTokenExpiry()) return;  [in loadModels()]
  if (!checkTokenExpiry()) return;  [in confirmModelSelection()]

=== escHtml usage count ===
6 (definition + 4 call sites in buildModelCard() + 1 in lastMod)

=== Section boundaries preserved ===
    <!-- SECTION: CONNECT -->
    <!-- SECTION: MODEL-PICKER -->
    <!-- SECTION: FETCH -->
    // SECTION: CONNECT
    // SECTION: MODEL-PICKER
    // SECTION: FETCH

=== Key counts ===
tokenExpiresAt: 5 references
meridian_session: 3 references
meridian_recent_models: 2 references (RECENT_KEY const + localStorage.setItem call)
CSS tokens (--pos-pale|--gold-pale|--sh-lg): 25 matches
```

## Phase 2 Complete

All four CONN requirements are addressed across Plans 01–03:

| Req | Status | Evidence |
|-----|--------|---------|
| CONN-01 | Complete (Plan 02) | s-connect screen; connectToAnaplan() POSTs to /api/connect; confirmation card shows totalModels + workspace count |
| CONN-02 | Complete (this plan) | s-picker screen; loadModels() fetches from /api/models; renderPicker() groups by workspace; recents section from localStorage; selectModel() stores in sessionStorage |
| CONN-03 | Complete (Plan 02 + this plan) | isSessionExpired() checks tokenExpiresAt ms against Date.now() with 60s buffer; checkTokenExpiry() called before loadModels() AND confirmModelSelection() |
| CONN-04 | Complete (Plan 02) | "Upload CSV" tab calls go('s-upload') — v1 upload/analysis flow fully preserved |

Security gate: `grep 'anaplan.com' index.html` returns zero matches — ROADMAP Phase 2 success criterion 5 satisfied.

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1: HTML + CSS | `0e161a6` | index.html (55 lines added) |
| Task 2: JS (stub removal + full implementation) | `37929a0` | index.html (246 insertions, 8 deletions) |

## Deviations from Plan

None — plan executed exactly as written. All CSS tokens were pre-existing from Plan 02; the plan's token-check step confirmed they did not need to be added. The `loadModels()` stub removal proceeded exactly as specified (found in SECTION: CONNECT, removed, real implementation added to SECTION: MODEL-PICKER).

## Known Stubs

None. `loadModels()` is now the full implementation. `confirmModelSelection()` calling `go('s-fetch')` is a forward reference, not a stub — it calls the real navigation function; only the target screen is absent until Phase 3.

## Threat Flags

None — all mitigate dispositions from the plan's threat model implemented:
- T-02-13: `escHtml()` applied to all Anaplan-sourced strings in `buildModelCard()`
- T-02-15: `checkTokenExpiry()` at top of `confirmModelSelection()`
- T-02-16: `checkTokenExpiry()` at top of `loadModels()`
- T-02-18: `.toLowerCase()` on workspaceId in fetch URL, `selectModel()`, and `confirmModelSelection()`

## Self-Check: PASSED
