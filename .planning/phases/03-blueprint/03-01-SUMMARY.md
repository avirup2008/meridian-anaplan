---
phase: 03-blueprint
plan: 01
subsystem: api
tags: [sse, anaplan, blob, rate-limit, blueprint]
dependency_graph:
  requires: []
  provides: [api/blueprint.js]
  affects: [Phase 4 analyze handler, Phase 5 share flow]
tech_stack:
  added: ["@vercel/blob put()"]
  patterns: ["SSE via res.flushHeaders + res.write", "Promise.allSettled batching", "429 retry with Retry-After", "fetchError sentinel pattern"]
key_files:
  created:
    - api/blueprint.js
  modified: []
decisions:
  - "Blob access:'public' chosen for simplicity — downstream Phase 4 consumes URL server-side, Phase 5 share flow also needs it; URL is opaque with random suffix; re-evaluate in Phase 5 share planning"
  - "SSE flushHeaders placed before first await — prevents silent proxy buffering per STATE.md decision log"
  - "Promise.allSettled (not Promise.all) per batch — single module failure cannot abort entire batch"
  - "fetchError sentinel pattern — exhausted-retry modules record error inline rather than throwing, enabling partialLoad: true flow"
metrics:
  duration: "~10 minutes"
  completed_date: "2026-05-11"
  tasks_completed: 3
  files_created: 1
---

# Phase 3 Plan 01: Blueprint SSE Fetch Handler Summary

**One-liner:** SSE blueprint fetch handler with batched parallel Anaplan line-item fetching (20/batch), 429 retry, Vercel Blob write, and partial-warning flow.

## What Was Built

`api/blueprint.js` — a single Vercel serverless function (ESM, plain JS) that owns the full blueprint fetch pipeline:

1. **Auth + CORS guard** — POST-only, credentials from `x-anaplan-user` / `x-anaplan-pass` headers, Basic Auth to `auth.anaplan.com`, token extracted from `tokenInfo.tokenValue`.

2. **SSE stream opened before first await** — `res.flushHeaders()` immediately after setting `Content-Type: text/event-stream`, preventing silent proxy buffering.

3. **Modules list** — `GET /workspaces/{wsId}/models/{modelId}/modules`, initial `progress` event emitted with `modulesDone: 0`.

4. **Batched parallel line-item fetch (BPRT-01)** — outer `for` loop slices modules into chunks of 20; each chunk runs `Promise.allSettled` so one failure never aborts its batch; each batch fully settles before the next begins.

5. **429 retry (BPRT-04)** — `fetchWithRetry` retries up to `MAX_RETRIES=2` times, honoring `Retry-After` header (default 10 s). `null` return signals exhaustion; caller creates a `fetchError` sentinel and emits `partial-warning`.

6. **SSE progress events (BPRT-02)** — every resolved module (success or error) emits `{ type: 'progress', modulesDone, modulesTotal, moduleName, lineItemCount }`.

7. **BlueprintDocument assembly** — conforms to locked schema: `{ modelId, workspaceId, fetchedAt, moduleCount, totalLineItems, partialLoad, modules[] }`.

8. **Vercel Blob write (BPRT-03)** — `put('blueprints/{modelId}-{timestamp}.json', json, { access: 'public' })`; raw JSON never enters the response body.

9. **schema-preview event** — emitted before `complete`; carries `sampleModuleName`, `sampleLineItemKeys`, `sampleFormula` for the Phase 3 → Phase 4 developer hand-off checkpoint.

10. **complete event** — `{ type: 'complete', blobUrl, moduleCount, totalLineItems, partialLoad }`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | SSE skeleton + auth + modules list | b615b31 | api/blueprint.js |
| 2 | Batched parallel line-item fetch + 429 retry | b615b31 | api/blueprint.js |
| 3 | Vercel Blob write + complete event + schema-preview | b615b31 | api/blueprint.js |

All three tasks implemented in a single atomic commit (the file was written complete end-to-end).

## Verification Results

- `node --input-type=module -e "import(...).then(...)"` → `OK` (ESM parses, default export is function)
- `grep -c "flushHeaders"` → `1` (BPRT-02: SSE before first await)
- `grep -cE "BATCH_SIZE|allSettled|429|Retry-After|partial-warning|fetchWithRetry"` → `13` (BPRT-01 + BPRT-04)
- `grep -cE "@vercel/blob|put\(|schema-preview|blobUrl"` → `4` (BPRT-03)

## Deviations from Plan

None — plan executed exactly as written. All three tasks were implemented in one pass because the plan's code blocks were complete and non-overlapping; writing them atomically avoids an intermediate state where the Blob import is missing.

## Known Stubs

None. The blueprint pipeline is fully wired: auth → modules list → batched line-item fetch → Blob write → complete event. The only runtime dependency not exercisable locally is `BLOB_READ_WRITE_TOKEN` (tracked in STATE.md todos — must be set in Vercel dashboard before deploy).

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: public-blob-url | api/blueprint.js | Blueprint Blob stored with `access:'public'`; URL is opaque but unauthenticated. Flagged for review in Phase 5 share planning per STATE.md research flag. |

## Self-Check: PASSED

- /tmp/meridian-anaplan/api/blueprint.js — FOUND
- commit b615b31 — FOUND (`git log --oneline -1` confirms)
