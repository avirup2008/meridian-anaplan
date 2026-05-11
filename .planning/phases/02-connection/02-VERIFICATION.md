---
phase: 02-connection
verified: 2026-05-10T00:00:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification: false
human_verification:
  - test: "Enter valid Anaplan credentials on the s-connect screen and click Connect"
    expected: "Confirmation card appears within 5 seconds showing a numeric model count (from data.totalModels) and workspace count — no raw IDs visible anywhere in the UI"
    why_human: "Cannot call live Anaplan auth endpoint in a static code check; the tokenInfo field names (tokenInfo.tokenValue, tokenInfo.expiresAt) are assumed from Anapedia docs and must be confirmed with a real credential round-trip"
  - test: "After connecting, click Browse Models and wait for the model picker to load"
    expected: "Workspace-grouped collapsible model cards appear; if any prior selections exist in localStorage, a Recently used section appears at the top with a gold Recent badge"
    why_human: "Requires a live Anaplan account and localStorage state; DOM rendering of grouped cards and recents section cannot be verified statically"
  - test: "Connect, then wait 35 minutes (or manipulate tokenExpiresAt in sessionStorage to a past epoch ms value), then click Browse Models"
    expected: "Re-auth modal appears with password field — no cryptic API error or blank state"
    why_human: "Requires either waiting for real token expiry or manually editing sessionStorage; the time-gated behavior of isSessionExpired() cannot be asserted by code inspection alone"
  - test: "Click the Upload CSV tab inside the s-connect screen"
    expected: "Navigates to the existing CSV upload screen (s-upload) with the v1 file-picker UI intact — no new upload logic, no modification to analyseModules() or uploadedFiles"
    why_human: "Navigation behavior (go() activating the correct screen) and visual confirmation that v1 upload logic is unmodified require browser testing"
---

# Phase 2: Connection Verification Report

**Phase Goal:** Users can authenticate with Anaplan, browse their workspaces and models, and proceed to blueprint fetch — with graceful handling of session expiry and CSV fallback
**Verified:** 2026-05-10
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | User entering valid Anaplan credentials sees a confirmation card with workspace name and model count within 5 seconds — no raw IDs visible | VERIFIED (code) / ? HUMAN (live) | `confirm-stat-models` (line 1016) populated by `data.totalModels` (line 3246); `confirm-stat-workspaces` from `(data.workspaces\|\|[]).length` (line 3247); api/connect.js returns `totalModels` integer from `Promise.all` across all workspaces |
| 2 | User can browse workspaces, see models grouped under each, select one to proceed; recently used models appear at top | VERIFIED (code) / ? HUMAN (live) | `s-picker` screen (line 1048), `renderPicker()` (line 3428) groups by `workspaceName`; `getRecentModels()` / `addToRecents()` use `localStorage['meridian_recent_models']`; `selectModel()` and `confirmModelSelection()` defined and wired |
| 3 | User connected ~35 minutes sees a re-auth prompt, not a cryptic API error | VERIFIED (code) / ? HUMAN (live) | `isSessionExpired()` checks `Date.now() >= (s.tokenExpiresAt - 60_000)` (both epoch ms, no division by 1000) at line 3188; `checkTokenExpiry()` called at top of both `loadModels()` (line 3359) and `confirmModelSelection()` (line 3552); `reauth-overlay` modal present at line 1030 |
| 4 | User without Anaplan access can upload CSV and receive single-module Haiku analysis via existing fallback path | VERIFIED (code) / ? HUMAN (live) | "Upload CSV" tab (line 1003) calls `go('s-upload')` (line 1006); `s-upload` screen untouched; `analyseModules()` and `uploadedFiles` not modified |
| 5 | Zero Anaplan API calls exist in client-side JS (`grep 'anaplan.com' index.html` returns nothing) | VERIFIED | `grep -n 'anaplan\.com' index.html` returns 0 matches — confirmed |

**Score:** 5/5 truths verified at code level. 4/5 require human live-system testing.

---

### Deferred Items

None.

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `api/connect.js` | POST endpoint: Anaplan auth + workspace discovery + total model count | VERIFIED | ESM `export default async function handler`; calls `auth.anaplan.com/token/authenticate`, `api.anaplan.com/2/0/workspaces`, and per-workspace models in `Promise.all`; returns `{ workspaces, tokenExpiresAt, totalModels }` |
| `api/models.js` | GET endpoint: credential-header proxy returning ACTIVE models | VERIFIED | ESM `export default async function handler`; reads `x-anaplan-user`/`x-anaplan-pass` headers; re-auths then fetches; filters `activeState === 'ACTIVE'`; returns `{ models }` |
| `vercel.json` | functions block with all three endpoints at correct maxDuration | VERIFIED | `api/connect.js: 10`, `api/models.js: 10`, `api/generate.js: 30` — all confirmed via node parse |
| `index.html` (s-connect) | Connect screen with tabs, confirmation card, re-auth modal | VERIFIED | `id="s-connect"` at line 973; two tab buttons; `id="confirm-card"` with `id="confirm-stat-models"` and `id="confirm-stat-workspaces"`; `id="reauth-overlay"` at line 1030 |
| `index.html` (s-picker) | Model picker screen with workspace groups and recents | VERIFIED | `id="s-picker"` at line 1048; `picker-list`, `picker-loading`, `picker-error`, `picker-cta` elements present; `renderPicker()` / `buildModelCard()` defined |
| `index.html` (SECTION: CONNECT JS) | Session helpers, connectToAnaplan(), token expiry logic | VERIFIED | All 12 functions confirmed at expected lines: `getSession`, `setSession`, `clearSession`, `isSessionExpired`, `switchConnectTab`, `connectToAnaplan`, `disconnectAnaplan`, `showReAuth`, `hideReAuth`, `checkTokenExpiry`, `reAuthenticate` |
| `index.html` (SECTION: MODEL-PICKER JS) | loadModels(), renderPicker(), addToRecents(), escHtml(), selectModel(), confirmModelSelection() | VERIFIED | All 8 functions present; exactly 1 definition of `loadModels` (stub removed); `escHtml` applied 6 times |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `api/connect.js` | `https://auth.anaplan.com/token/authenticate` | `fetch` with `Authorization: Basic ${encoded}` | WIRED | Line 26 — `fetch('https://auth.anaplan.com/token/authenticate', ...)` |
| `api/connect.js` | `https://api.anaplan.com/2/0/workspaces` | `fetch` with `Authorization: AnaplanAuthToken` | WIRED | Line 50 — `fetch('https://api.anaplan.com/2/0/workspaces', ...)` |
| `api/connect.js` | per-workspace models | `Promise.all` parallel fetch | WIRED | Lines 63-72 — `Promise.all(workspaces.map(ws => fetch(.../models, ...)))` with `.catch(() => 0)` |
| `api/models.js` | `https://api.anaplan.com/2/0/workspaces/{id}/models` | re-auth then fetch | WIRED | Lines 31-52 — re-auth at line 31, model fetch at line 50 |
| `index.html connectToAnaplan()` | `/api/connect` | `fetch` POST with JSON body | WIRED | Line 3221 — `fetch('/api/connect', { method: 'POST', body: JSON.stringify({ username, password }) })` |
| `index.html connectToAnaplan()` | `confirm-stat-models` element | `data.totalModels` written to DOM | WIRED | Line 3246 — `document.getElementById('confirm-stat-models').textContent = totalModels` |
| `index.html loadModels()` | `/api/models` | `fetch` GET with `x-anaplan-user`/`x-anaplan-pass` headers | WIRED | Line 3383 — `fetch('/api/models?workspaceId=...', { headers: { 'x-anaplan-user': s.username, 'x-anaplan-pass': s.password } })` |
| `index.html selectModel()` | `addToRecents()` | called inside `confirmModelSelection()` before navigation | WIRED | Line 3564 — `addToRecents({ id: _selectedModelId, ... })` |
| `index.html selectModel()` | `setSession()` | merges modelId/modelName into session | WIRED | Lines 3557-3561 — `setSession({ ...s, modelId, modelName, workspaceId, workspaceName })` |
| `index.html Upload CSV tab` | `go('s-upload')` | onclick on CSV tab button | WIRED | Line 1006 — `onclick="go('s-upload')"` inside `id="tab-body-csv"` |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `confirm-stat-models` (HTML element) | `data.totalModels` | `api/connect.js` → `Promise.all` across workspace model fetches → `modelCounts.reduce()` | Yes — real API count, not hardcoded | FLOWING |
| `confirm-stat-workspaces` (HTML element) | `(data.workspaces\|\|[]).length` | `api/connect.js` → `api.anaplan.com/2/0/workspaces` response | Yes — live workspace list length | FLOWING |
| `picker-list` (rendered by `renderPicker()`) | `allModels` array | `loadModels()` → `Promise.allSettled` → `/api/models` per workspace → `api/models.js` → Anaplan API | Yes — filtered ACTIVE models from API | FLOWING |
| `recents-section` in picker | `getRecentModels()` | `localStorage['meridian_recent_models']` set by `addToRecents()` on model selection | Yes — real user selections, or empty `[]` on first use | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| api/connect.js exports async function | `node --input-type=module -e "import('/tmp/meridian-anaplan/api/connect.js').then(m=>console.log(typeof m.default))"` | `function` | PASS |
| api/models.js exports async function | `node --input-type=module -e "import('/tmp/meridian-anaplan/api/models.js').then(m=>console.log(typeof m.default))"` | `function` | PASS |
| vercel.json is valid JSON with connect.js at 10s | `node --input-type=module -e "...JSON.parse...v.functions['api/connect.js'].maxDuration"` | `10` | PASS |
| Zero anaplan.com URLs in index.html | `grep -c 'anaplan\.com' index.html` | `0` | PASS |
| Zero credential writes to localStorage | `grep 'localStorage.*password\|password.*localStorage' index.html` | 0 matches | PASS |
| loadModels defined exactly once | `grep -c 'function loadModels' index.html` | `1` | PASS |
| escHtml applied to external data | `grep -c 'escHtml' index.html` | `6` (1 definition + 5 call sites) | PASS |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| CONN-01 | 02-01, 02-02 | User can enter Anaplan credentials, submit to POST /api/connect, see confirmation card with workspace name and model count | VERIFIED (code) | `api/connect.js` returns `{ workspaces, tokenExpiresAt, totalModels }`; `connectToAnaplan()` POSTs and populates `confirm-stat-models` + `confirm-stat-workspaces`; confirmation card rendered after success |
| CONN-02 | 02-01, 02-03 | User can browse workspaces and models (grouped by workspace, recently used at top) and select one | VERIFIED (code) | `s-picker` screen; `loadModels()` fetches from `/api/models`; `renderPicker()` groups by workspace with collapsible headers; `getRecentModels()` / `addToRecents()` with `meridian_recent_models` key; `selectModel()` + `confirmModelSelection()` wire through session |
| CONN-03 | 02-02, 02-03 | User sees re-auth prompt after ~35 minutes session expiry — not a cryptic API error | VERIFIED (code) | `isSessionExpired()` uses `Date.now() >= (s.tokenExpiresAt - 60_000)` (epoch ms, 60s buffer); `checkTokenExpiry()` called at top of `loadModels()` AND `confirmModelSelection()`; `reauth-overlay` modal with password field present in DOM |
| CONN-04 | 02-02 | User can upload CSV blueprint as fallback when no live Anaplan connection available | VERIFIED (code) | "Upload CSV" tab (`tab-body-csv`) in `s-connect` calls `go('s-upload')`; no new upload logic; `analyseModules()` and `uploadedFiles` untouched |

All 4 requirements (CONN-01 through CONN-04) are claimed and fully evidenced. No orphaned requirements for Phase 2.

**INFRA-03 holdover check:** vercel.json `functions` block has `api/connect.js: { maxDuration: 10 }` and `api/models.js: { maxDuration: 10 }` alongside `api/generate.js: { maxDuration: 30 }` — SATISFIED.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `index.html` | 3067 | `picker-cta` has `id="btn-fetch"` on the Fetch blueprint button pointing to `confirmModelSelection()` — `go('s-fetch')` will silently no-op until Phase 3 creates the `s-fetch` screen | Info | Forward reference only; `go()` is a documented silent no-op on missing element; not a stub in the data sense |

No TODO/FIXME/PLACEHOLDER comments found in any created/modified file. No hardcoded empty return values in API files. No credential logging in either `api/connect.js` or `api/models.js`.

---

## Human Verification Required

### 1. Live Credential Round-Trip (CONN-01)

**Test:** POST to `/api/connect` with valid Anaplan username and password (or use the s-connect screen in a deployed environment). Inspect the response body.
**Expected:** Response contains `{ workspaces: [...], tokenExpiresAt: <13-digit epoch ms>, totalModels: <integer> }`. The field paths `authData.tokenInfo.tokenValue` and `authData.tokenInfo.expiresAt` must exist in the Anaplan auth response — if Anaplan returns a different shape, the token will be `undefined` and all downstream calls will fail with "Invalid credentials".
**Why human:** Anaplan's API cannot be called from a static code check. The field name assumption (`tokenInfo.tokenValue`, `tokenInfo.expiresAt`) is documented in Anapedia examples but marked as HIGH (not CONFIRMED) in the research. A wrong field name is a silent failure — the code will return 401 with "Invalid credentials" rather than a structural error.

### 2. Confirmation Card Visual Check (CONN-01 SC-1)

**Test:** After a successful connect, inspect the confirmation card.
**Expected:** A numeric model count (not "—" or undefined) appears in the `confirm-stat-models` element. A workspace count appears in `confirm-stat-workspaces`. Username appears in the `confirm-sub` subtitle. No raw IDs (UUIDs) are visible anywhere on the card.
**Why human:** Visual rendering of DOM textContent requires a browser; "no raw IDs" is a display-level check that cannot be inferred from code alone.

### 3. Model Picker Live Render (CONN-02)

**Test:** After connecting, click Browse Models. Inspect the picker.
**Expected:** Workspace sections with collapsible headers appear, each containing model cards. If `localStorage['meridian_recent_models']` has any entries matching current model IDs, a "Recently used" section with gold "Recent" badges appears above the workspace sections.
**Why human:** Requires a live Anaplan account with accessible workspaces and models; DOM construction by `renderPicker()` and `buildModelCard()` must be visually confirmed.

### 4. Session Expiry Re-Auth Modal (CONN-03)

**Test:** After connecting, open DevTools console and run: `const s = JSON.parse(sessionStorage.getItem('meridian_session')); s.tokenExpiresAt = Date.now() - 1000; sessionStorage.setItem('meridian_session', JSON.stringify(s));`. Then click Browse Models.
**Expected:** The re-auth modal appears with a password field and "Session expired" heading — not an API error message, not a blank screen.
**Why human:** Requires browser DevTools manipulation of sessionStorage; the visual appearance of the modal and absence of API error messaging must be confirmed by a human.

### 5. CSV Fallback Path (CONN-04)

**Test:** Click the "Upload CSV" tab in the s-connect screen, then click "Choose CSV file →". Upload a CSV blueprint file and proceed through the existing v1 analysis flow.
**Expected:** The s-upload screen appears with its original file-picker UI. A CSV analysis completes via the existing Claude Haiku path. No changes to upload behavior, no new upload logic introduced.
**Why human:** Navigation and end-to-end CSV flow completion require browser interaction; the v1 analysis result quality requires visual inspection.

---

## Gaps Summary

No automated gaps found. All 5 roadmap success criteria are verifiable at code level and pass. The 4 items in "Human Verification Required" are behavioral/live-system checks that cannot be resolved statically — they are not code defects, they are live-integration tests.

The one notable risk is the Anaplan field name assumption (`tokenInfo.tokenValue`, `tokenInfo.expiresAt`). If Anaplan returns a different field structure, the token will be silently `undefined` and the entire auth flow fails. This must be confirmed with a live credential test before marking CONN-01 fully satisfied.

---

_Verified: 2026-05-10_
_Verifier: Claude (gsd-verifier)_
