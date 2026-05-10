---
phase: 02-connection
plan: "02"
subsystem: ui-connect-screen
tags: [anaplan, auth, sessionStorage, connect-screen, css, html, javascript]
dependency_graph:
  requires: [02-01]
  provides: [index.html s-connect screen, index.html SECTION:CONNECT JS, Connect CSS]
  affects: [index.html]
tech_stack:
  added: []
  patterns: [sessionStorage-session-management, token-expiry-check-before-call, tabbed-card-ui, confirmation-card]
key_files:
  created: []
  modified:
    - index.html
decisions:
  - "All CSS tokens (--pos-pale, --gold-pale, --gold-bd, --sh-lg, --neg-pale, --neg-bd) were already present in :root — no additions needed"
  - "loadModels() is a navigation stub only (calls go('s-picker')) — Plan 03 replaces with real model-fetch logic"
  - "confirm-stat-models populated from data.totalModels (total across all workspaces); confirm-stat-workspaces from data.workspaces.length"
  - "sessionStorage key is exactly 'meridian_session' as a single JSON object — cleared atomically on disconnect or tab close"
  - "reauth-overlay inserted as global overlay outside s-connect screen shell so it works from any screen"
metrics:
  duration: "~10 minutes"
  completed: "2026-05-10"
  tasks_completed: 2
  files_changed: 1
---

# Phase 2 Plan 2: Connect Screen HTML, CSS, and JS Summary

**One-liner:** Tabbed Anaplan connect card with confirmation stats, re-auth modal, session management helpers, and token-expiry guard wired to /api/connect endpoint from Plan 01.

## What Was Built

Single file modified: `index.html`. Two edits per task, four total edits.

### Task 1: HTML + CSS

**HTML sections added (inside SECTION: CONNECT boundary comments):**

- `<div id="s-connect" class="screen">` — new screen participating in go() system automatically
  - Tabbed card (`id="connect-card"`) with two tab buttons:
    - "Connect to Anaplan" (default active) — username + password fields, Connect button, inline error slot
    - "Upload CSV" — navigates to existing `go('s-upload')` (no new upload logic)
  - Confirmation card (`id="confirm-card"`, `display:none` by default):
    - `id="confirm-stat-models"` — populated from `data.totalModels` returned by api/connect.js
    - `id="confirm-stat-workspaces"` — populated from `data.workspaces.length`
    - Browse Models button → `loadModels()` stub
    - Disconnect button → `disconnectAnaplan()`
- `<div id="reauth-overlay" class="reauth-overlay">` — global modal outside screen shell, password re-entry only

**CSS classes added (before `</style>`):**

| Class | Purpose |
|-------|---------|
| `.screen-shell` | Full-viewport centering shell for connect screen |
| `.connect-wrap` | Max-width 440px wrapper |
| `.connect-card` | Tabbed card container with shadow and rounded corners |
| `.connect-tabs` | Flex tab bar |
| `.connect-tab` | Individual tab button; `.active` variant with accent underline |
| `.connect-body` | Tab body padding |
| `.connect-field` | Form field wrapper |
| `.connect-error` | Error message slot (red, min-height to prevent layout shift) |
| `.confirmation-card` | Post-auth confirmation card |
| `.confirm-icon` | Success icon circle (pos-pale background) |
| `.confirm-title` | "Connected to Anaplan" heading |
| `.confirm-sub` | Connected-as username line |
| `.confirm-stat` | Large numeric stat (IBM Plex Mono, accent colour) |
| `.confirm-stat-label` | UPPERCASE label beneath stat |
| `.reauth-overlay` | Fixed full-viewport modal backdrop (hidden by default via opacity:0) |
| `.reauth-overlay.visible` | Shown state |
| `.reauth-modal` | Modal card |
| `.reauth-title` | Modal heading |
| `.reauth-msg` | Modal description paragraph |

**CSS tokens:** All required tokens (`--pos-pale`, `--gold-pale`, `--gold-bd`, `--sh-lg`, `--neg-pale`, `--neg-bd`) were already defined in the existing `:root` block. No additions to `:root` were needed.

### Task 2: JavaScript

**Functions added inside `// SECTION: CONNECT` block:**

| Function | Purpose |
|----------|---------|
| `getSession()` | `JSON.parse(sessionStorage.getItem('meridian_session') \|\| 'null')` with try/catch |
| `setSession(data)` | `sessionStorage.setItem('meridian_session', JSON.stringify(data))` |
| `clearSession()` | `sessionStorage.removeItem('meridian_session')` |
| `isSessionExpired()` | Checks `Date.now() >= (s.tokenExpiresAt - 60_000)` — both epoch ms, no division |
| `switchConnectTab(tab)` | Toggles `.active` class on tab buttons and shows/hides tab bodies |
| `connectToAnaplan()` | POSTs `{username, password}` to `/api/connect`; on success stores session and shows confirmation card |
| `disconnectAnaplan()` | Calls `clearSession()`, resets form fields, shows connect card |
| `showReAuth()` | Adds `.visible` to `reauth-overlay` |
| `hideReAuth()` | Removes `.visible` from `reauth-overlay` |
| `checkTokenExpiry()` | Calls `showReAuth()` and returns false if session expired; returns true otherwise |
| `reAuthenticate()` | Re-POSTs to `/api/connect` with stored username + new password; updates `tokenExpiresAt` in session |
| `loadModels()` | Navigation stub — calls `checkTokenExpiry()` then `go('s-picker')`; Plan 03 replaces with full logic |

**Key implementation details:**
- `connectToAnaplan()` populates `confirm-stat-models` from `data.totalModels` (integer — total model count across all workspaces, computed by api/connect.js via Promise.all)
- `connectToAnaplan()` populates `confirm-stat-workspaces` from `(data.workspaces || []).length`
- Session stored as single JSON object under key `'meridian_session'` in sessionStorage — clears on tab close
- Password stored in sessionStorage (not localStorage) by design — required for re-auth within session (T-02-08: accepted risk)
- `checkTokenExpiry()` called at top of `loadModels()` — implements T-02-09 mitigation
- Error display shows `data.error || 'Connection failed...'` generic fallback — implements T-02-11 mitigation
- Zero `anaplan.com` URLs in any client code — all Anaplan calls remain in api/*.js

## Stub Tracking

`loadModels()` is a deliberate navigation stub. It navigates to `go('s-picker')` so the end-to-end screen flow works after Plan 02 without requiring Plan 03 to be complete. Plan 03 (Model Picker) will define a new `loadModels()` function that replaces this stub with full model-fetching and picker-rendering logic.

## Verification Results

```
1. Connect screen HTML present: 1 (grep -c 'id="s-connect"')
2. All JS functions present:
   function getSession()
   function isSessionExpired()
   async function connectToAnaplan()
   function checkTokenExpiry()
   async function reAuthenticate()
3. Zero Anaplan URLs in client: PASS
4. Credentials not in localStorage: PASS
5. v1 upload flow untouched: PASS (git diff shows no removals to s-upload/analyseModules/uploadedFiles)
6. SECTION boundary comments preserved: SECTION: CONNECT (×2), SECTION: MODEL-PICKER (×3)
7. Confirmation card stats: confirm-stat-models, confirm-stat-workspaces, totalModels all present
8. CSS tokens defined: 24 matches for --pos-pale|--gold-pale|--sh-lg
```

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1: HTML + CSS | `4492039` | index.html (99 lines added) |
| Task 2: JS | `856f5e9` | index.html (166 lines added) |

## Deviations from Plan

None — plan executed exactly as written. All CSS tokens were pre-existing; the plan's token-check step confirmed they did not need to be added.

## Known Stubs

`loadModels()` — navigation-only stub at `// SECTION: CONNECT`. Calls `go('s-picker')` which navigates to a screen that does not yet exist (Plan 03 will add `id="s-picker"`). This is intentional per the plan spec. The stub is not a data stub — it does not render empty/placeholder data to the user; it will simply 404 on the screen transition until Plan 03 is complete.

## Threat Flags

None — no new trust boundaries introduced beyond those in the plan's threat model (T-02-08 through T-02-12). All mitigate dispositions implemented:
- T-02-09: `checkTokenExpiry()` called at top of `loadModels()` — returns early + shows re-auth modal
- T-02-11: `data.error || 'Connection failed...'` generic fallback in connectToAnaplan() and reAuthenticate()

## Self-Check

**Files modified:**
- index.html: MODIFIED (265 lines added total across 2 commits)

**Commits exist:**
- 4492039: EXISTS (feat(02-02): insert Connect screen HTML and CSS into index.html)
- 856f5e9: EXISTS (feat(02-02): insert connectToAnaplan() and session management JS into SECTION: CONNECT)

## Self-Check: PASSED
