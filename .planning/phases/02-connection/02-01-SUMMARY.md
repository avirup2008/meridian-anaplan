---
phase: 02-connection
plan: "01"
subsystem: api-proxy
tags: [anaplan, auth, serverless, vercel, proxy]
dependency_graph:
  requires: []
  provides: [api/connect.js, api/models.js]
  affects: [vercel.json, index.html-client-calls]
tech_stack:
  added: []
  patterns: [server-side-credential-proxy, parallel-fetch-Promise.all, re-auth-per-call]
key_files:
  created:
    - api/connect.js
    - api/models.js
  modified:
    - vercel.json
decisions:
  - "Re-authenticate on every /api/models call rather than passing token between client and server — avoids server-side token state management at cost of one extra Anaplan round-trip per workspace selection"
  - "Credentials passed to /api/models via x-anaplan-user / x-anaplan-pass headers (not body) — GET request convention"
  - "Workspace IDs lowercased on receipt in both files — Anaplan requires lowercase workspace IDs"
  - "Partial model-count failures in Promise.all() use 0 count and do not abort /api/connect — resilient degradation"
  - "totalModels is sum of all model counts across all workspaces, fetched in parallel alongside workspace list"
  - "Filter models to activeState === 'ACTIVE' in /api/models — plan spec"
metrics:
  duration: "~12 minutes"
  completed: "2026-05-10"
  tasks_completed: 3
  files_changed: 3
---

# Phase 2 Plan 1: Anaplan API Proxy Layer Summary

**One-liner:** Server-side Basic Auth proxy pair (connect.js + models.js) with parallel workspace model counting and per-call re-authentication, zero client-side Anaplan URLs.

## What Was Built

Two Vercel serverless functions that proxy all Anaplan API calls server-side, preventing any browser-side CORS exposure.

### api/connect.js (POST /api/connect)

Accepts `{ username, password }` in request body. Performs:
1. Basic Auth to `https://auth.anaplan.com/token/authenticate` with `Buffer.from(...).toString('base64')` encoding server-side
2. Workspace list fetch from `https://api.anaplan.com/2/0/workspaces` using `AnaplanAuthToken` header
3. Parallel model count fetch for all workspaces via `Promise.all()` — each workspace's `/models` call runs concurrently; any single failure uses 0 (no full-call abort)

Returns: `{ workspaces: [{ id, name }], tokenExpiresAt, totalModels }`

### api/models.js (GET /api/models?workspaceId=...)

Accepts credentials via `x-anaplan-user` / `x-anaplan-pass` custom headers and `workspaceId` as a query parameter. Performs:
1. Re-authentication with Anaplan Basic Auth (fresh token per call)
2. Model list fetch for the specified workspace
3. Filters to `activeState === 'ACTIVE'` models only

Returns: `{ models: [{ id, name, activeState, lastModified, currentWorkspaceName }] }`

### vercel.json

Added `api/connect.js` and `api/models.js` to the `functions` block at `maxDuration: 10`. The existing `api/generate.js` entry at `maxDuration: 30` is unchanged.

## Key Implementation Decisions

| Decision | Rationale |
|----------|-----------|
| Re-auth per /api/models call | Avoids server-side token state; client holds credentials in sessionStorage and passes them on each request. Safe for one-shot model picker use case (Pitfall 3 in RESEARCH.md). |
| Credentials via request headers for GET | GET requests have no body; x-anaplan-user / x-anaplan-pass headers carry credentials to /api/models cleanly |
| Workspace IDs lowercased on receipt | Anaplan requires lowercase workspace IDs in API calls (Pitfall 2 in RESEARCH.md) |
| Promise.all() for model counts | All workspace model-count fetches run in parallel, minimizing /api/connect latency even with multiple workspaces |
| Partial failure → 0 count | A single workspace model fetch failure should not abort the connect flow; degrade to 0 count for that workspace |
| Log only err.message | Never log full error object or req.body — prevents credential exposure in Vercel function logs (T-02-01, T-02-02) |

## Field Name Assumptions Requiring Live Validation

| Field | Path | Confidence | Risk if Wrong |
|-------|------|------------|---------------|
| `tokenInfo.tokenValue` | `authData.tokenInfo.tokenValue` | HIGH — confirmed Anapedia | Token would be undefined; all downstream calls fail |
| `tokenInfo.expiresAt` | `authData.tokenInfo.expiresAt` | HIGH — confirmed Anapedia example value `1571088766187` (13-digit = ms) | Token expiry detection wrong; use `Date.now()` directly vs `expiresAt` |
| `workspaces[].name` | `wsData.workspaces[].name` | HIGH — confirmed Anapedia | If `displayName`, workspace names show undefined in confirmation card |
| `models[].activeState` | `modData.models[].activeState` | HIGH — confirmed Anapedia | Filter to ACTIVE would be no-op or wrong |

**Validation method:** After deploying, `POST /api/connect` with valid Anaplan credentials and inspect the response shape in DevTools Network tab.

## Verification Results

```
# 1. Both API files export a valid function
connect: function
models: function

# 2. vercel.json valid — functions block
{"api/generate.js":{"maxDuration":30},"api/connect.js":{"maxDuration":10},"api/models.js":{"maxDuration":10}}

# 3. Zero credential logging in either API file
PASS: no credential logging in either file

# 4. generate.js is unchanged
PASS: generate.js unchanged

# 5. No anaplan.com URLs in index.html
PASS: zero Anaplan URLs in client

# 6. totalModels and Promise.all present in connect.js
    const modelCounts = await Promise.all(
    const totalModels = modelCounts.reduce((sum, c) => sum + c, 0);
      totalModels
```

All six verification checks passed.

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1: api/connect.js | `da5dd79` | api/connect.js (created) |
| Task 2: api/models.js | `9a9d720` | api/models.js (created) |
| Task 3: vercel.json update | `a95126a` | vercel.json (modified) |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — no placeholder data, no hardcoded empty values, no TODO/FIXME in created files.

## Threat Flags

None — no new trust boundaries introduced beyond those documented in the plan's threat model (T-02-01 through T-02-07). All mitigate dispositions implemented:
- T-02-01/T-02-02: `err.message` only in catch blocks
- T-02-03: `Buffer.from().toString('base64')` server-side only; encoded string never logged
- T-02-04: `workspaceId.toLowerCase()` applied in both files
- T-02-07: Any non-2xx from auth treated as "Invalid credentials" without parsing error body

## Self-Check

**Files created/exist:**
- api/connect.js: EXISTS
- api/models.js: EXISTS
- vercel.json: MODIFIED (functions block updated)

**Commits exist:**
- da5dd79: EXISTS (feat(02-01): create api/connect.js)
- 9a9d720: EXISTS (feat(02-01): create api/models.js)
- a95126a: EXISTS (chore(02-01): register vercel.json)

## Self-Check: PASSED
