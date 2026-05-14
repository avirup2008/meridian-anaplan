# Phase 6: Model State Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-14
**Phase:** 06-model-state-foundation
**Areas discussed:** API endpoint shape, Blob vs direct state, Fetch UX during single-call, Old blueprint.js fate

---

## API Endpoint Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Two calls, one round-trip feel | Fetch /modules and /lineItems?includeAll=true in parallel simultaneously | ✓ |
| Single call + ID-only mode | Use /lineItems?includeAll=true only; module IDs as-is throughout | |
| Keep /modules first, skip per-module loop | Sequential: /modules then one model-level call | |

**User's choice:** Two calls, one round-trip feel

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, confirmed — includeAll=true returns formulas | Proceed with this assumption | |
| Not confirmed — use what we know works | Fall back to per-module for formulas only | |
| Treat it as a research question | Phase 6 plan includes a spike before committing | ✓ |

**User's choice:** Treat it as a research question — live API spike required before committing to endpoint design

---

## Blob vs Direct State

| Option | Description | Selected |
|--------|-------------|----------|
| Keep Blob — consistent with v2.0 pattern | Compact state to Blob; URL passed downstream | ✓ |
| Inline — skip Blob for compacted state | State fits in POST body (~180KB); client holds in memory | |
| Hybrid — Blob for raw, inline for compact | Raw JSON to Blob, compact state in sessionStorage | |

**User's choice:** Keep Blob

---

| Option | Description | Selected |
|--------|-------------|----------|
| model-state/ | Clear, distinct from blueprints/ | ✓ |
| Keep blueprints/ prefix | Reuse existing; mixes v2 and v3 formats | |
| state-v3/ | Version-namespaced | |

**User's choice:** `model-state/` prefix

---

## Fetch UX During Single Call

| Option | Description | Selected |
|--------|-------------|----------|
| Staged status messages via SSE | Named stages: Authenticating → Loading → Serializing → Done | ✓ |
| Simple spinner — no SSE needed | Single POST, spinner until response | |
| Keep SSE with fake progress | Simulated progress bar (timed estimate) | |

**User's choice:** Staged status messages via SSE

---

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-navigate to Model tab | On complete event, navigate to dashboard with Model tab active | ✓ |
| Show summary card, then button to proceed | Fetch screen shows stats; user clicks 'View Analysis' | |
| Same as v2.0 — navigate to Dashboard automatically | Maintain exact v2.0 UX transition | |

**User's choice:** Auto-navigate to Model tab

---

## Old Blueprint.js Fate

| Option | Description | Selected |
|--------|-------------|----------|
| Replace it — new model-state.js takes over | blueprint.js deleted; api/model-state.js takes over | ✓ |
| Keep both — blueprint.js as fallback | Run alongside for fallback | |
| Rename and refactor in-place | Rewrite blueprint.js without renaming | |

**User's choice:** Replace it entirely with model-state.js

---

| Option | Description | Selected |
|--------|-------------|----------|
| Let them expire naturally (7-day TTL) — no migration | Old shared reports expire; no migration code | ✓ |
| Keep backward-compatible reader | Detect old vs new format; render both | |
| Invalidate old links explicitly | Mark old Blobs expired on Phase 6 deploy | |

**User's choice:** Let them expire naturally — no migration

---

## Claude's Discretion

- Exact compact serialization format (column order, separator characters, line item row structure)
- Evidence admissibility threshold values
- SSE stage message wording and timing

## Deferred Ideas

None.
