---
status: partial
phase: 02-connection
source: [02-VERIFICATION.md]
started: 2026-05-10
updated: 2026-05-10
---

## Current Test

[awaiting human testing — session expiry only]

## Tests

### 1. Live credential round-trip
expected: POST /api/connect with valid Anaplan username+password returns 200 with {workspaces, tokenExpiresAt, totalModels}. Field names `tokenInfo.tokenValue` and `tokenInfo.expiresAt` resolve correctly. Confirmation card shows numeric model count and workspace count — no raw UUIDs visible.
result: PASS — confirmed 617 models across 3 workspaces shown correctly

### 2. Confirmation card visual
expected: After connecting, the confirmation card displays "N models" and "across M workspaces" — both stats populated, no raw IDs visible anywhere.
result: PASS — 617 models / 3 workspaces displayed correctly

### 3. Model picker live render
expected: Model picker shows workspace-grouped model cards. If ≥1 model was previously selected, it appears in the "Recently Used" section at the top.
result: PASS — all 617 models visible after fix (activeState filter was 'ACTIVE' vs actual 'UNLOCKED'/'LOCKED')

### 4. Session expiry modal
expected: Open DevTools, set `JSON.parse(sessionStorage.meridian_session).tokenExpiresAt` to a past timestamp, then trigger loadModels() — the re-auth modal appears instead of an API error or silent failure.
result: [pending]

## Summary

total: 4
passed: 3
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps

- activeState bug found and fixed during UAT: Anaplan uses UNLOCKED/LOCKED not ACTIVE
