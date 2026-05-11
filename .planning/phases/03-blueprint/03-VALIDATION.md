---
phase: 3
slug: blueprint
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-11
updated: 2026-05-11
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — Phase 3 is server + client code in a project with no test framework. Verification is via shell commands, node ESM import checks, and grep assertions. This is the project's chosen verification mode; no Vitest scaffold is required. |
| **Config file** | none |
| **Quick run command** | `node --input-type=module -e "import('./api/blueprint.js').then(m=>console.log('blueprint OK:',typeof m.default))"` |
| **Full suite command** | `node --input-type=module -e "import('./api/blueprint.js').then(m=>console.log('blueprint OK:',typeof m.default))" && grep -cE "BATCH_SIZE\|allSettled" /tmp/meridian-anaplan/api/blueprint.js && grep -cE "@vercel/blob\|put\(" /tmp/meridian-anaplan/api/blueprint.js && grep -cE "429\|Retry-After\|partial-warning" /tmp/meridian-anaplan/api/blueprint.js && grep -cE "s-fetch\|fetchBlueprint\|getReader" /tmp/meridian-anaplan/index.html` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick run command (confirms the module still parses and exports correctly)
- **After every plan wave:** Run full suite command above
- **Before `/gsd-verify-work`:** All success criteria must pass manually
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

Authoritative BPRT mapping (from REQUIREMENTS.md):
- **BPRT-01** = batch 20 modules at a time in parallel server-side fetch
- **BPRT-02** = SSE live progress updates in browser
- **BPRT-03** = Blob storage, URL to /api/analyze (not raw JSON)
- **BPRT-04** = 429 backoff + partial-warning

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | BPRT-02 | — | SSE handler exports default function with flushHeaders before first await | shell | `node --input-type=module -e "import('./api/blueprint.js').then(m=>console.log(typeof m.default))" && grep -c "flushHeaders" /tmp/meridian-anaplan/api/blueprint.js` | ✅ (created in Wave 1) | ⬜ pending |
| 3-01-02 | 01 | 1 | BPRT-01 | — | Batched-parallel fetch (BATCH_SIZE=20, Promise.allSettled) | shell | `grep -cE "BATCH_SIZE\|allSettled" /tmp/meridian-anaplan/api/blueprint.js` | ✅ | ⬜ pending |
| 3-01-03 | 01 | 1 | BPRT-04 | rate-limit | 429 retry + partial-warning emission | shell | `grep -cE "429\|Retry-After\|partial-warning\|fetchWithRetry" /tmp/meridian-anaplan/api/blueprint.js` | ✅ | ⬜ pending |
| 3-01-04 | 01 | 1 | BPRT-03 | blob-leak | Blob put() called with blueprint JSON; URL surfaced via SSE complete event | shell | `grep -cE "@vercel/blob\|put\(\|blobUrl" /tmp/meridian-anaplan/api/blueprint.js` | ✅ | ⬜ pending |
| 3-02-01 | 02 | 2 | BPRT-02 | — | s-fetch screen HTML section exists with live counters and s-analysis stub | shell | `grep -cE "id=\"s-fetch\"\|id=\"s-analysis\"\|fetch-progress-fill" /tmp/meridian-anaplan/index.html` | ✅ | ⬜ pending |
| 3-02-02 | 02 | 2 | BPRT-02 | — | SSE consumer wired via fetch + ReadableStream getReader | shell | `grep -cE "fetchBlueprint\|getReader\(\)" /tmp/meridian-anaplan/index.html` | ✅ | ⬜ pending |
| 3-02-03 | 02 | 2 | BPRT-03 | — | Blob URL stored in sessionStorage on complete; continue button targets s-analysis (NOT s-dashboard) | shell | `grep -c "blueprintBlobUrl" /tmp/meridian-anaplan/index.html && grep -c "go('s-analysis')" /tmp/meridian-anaplan/index.html && (! grep -q "go('s-dashboard')" /tmp/meridian-anaplan/index.html)` | ✅ | ⬜ pending |
| 3-03-01 | 03 | 3 | BPRT-02 | — | vercel.json functions block registers api/blueprint.js at maxDuration 60 | shell | `node --input-type=module -e "import { readFileSync } from 'fs'; const v=JSON.parse(readFileSync('/tmp/meridian-anaplan/vercel.json','utf8')); if(v.functions['api/blueprint.js'].maxDuration!==60)process.exit(1); console.log('OK')"` | ✅ | ⬜ pending |
| 3-03-02 | 03 | 3 | BPRT-01/02/03/04 | — | End-to-end human sign-off that all four BPRT behaviors fire against a live model | manual | (human checkpoint — see Plan 03 Task 2) | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

The project has **no test framework** — verification is shell-level (module import, grep, JSON parse). The only "Wave 0" prerequisite is that `api/blueprint.js` must come into existence in Plan 01 Wave 1 before any verify command can run against it. Plan 01 Task 1 satisfies this prerequisite within Wave 1 itself, so `wave_0_complete: true` is correct.

- `api/blueprint.js` — created by Plan 01 Task 1 (Wave 1). All subsequent verify commands against this file therefore have a valid target.

*No Vitest / Jest / Playwright scaffold needed — the project verification mode is shell-based and the test scaffold is conceptually a no-op.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Batched-parallel fetch pacing (counter visibly steps in chunks of 20) | BPRT-01 | Requires live Anaplan account + model with > 20 modules | Pick a 25+ module model; observe the modules counter pausing briefly between batches as each batch of 20 settles |
| Live SSE counter increments module by module in browser | BPRT-02 | Requires live Anaplan account + valid session token | Select a model in picker, watch module counter increment live |
| Blueprint JSON stored in Vercel Blob, URL returned | BPRT-03 | Requires BLOB_READ_WRITE_TOKEN + live fetch | After fetch completes, confirm blobUrl present in sessionStorage; verify URL is accessible in browser; verify raw JSON never appears in SSE body |
| 429 retry backoff + partial-warning surfacing | BPRT-04 | Requires live Anaplan account with a large model OR rapid re-fetch to provoke a 429 | Fetch a large model or re-fetch rapidly; if 429 occurs, confirm yellow warning strip lists skipped modules and the fetch still completes |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or are explicit `checkpoint:human-verify` tasks
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none — project has no test framework, and `api/blueprint.js` is created in Wave 1)
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter
- [x] BPRT IDs in per-task map match REQUIREMENTS.md authoritative definitions

**Approval:** ready
