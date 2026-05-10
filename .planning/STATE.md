# Meridian — State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-05-10)

**Core value:** Anaplan model builders get instant, AI-powered analysis of their entire model without leaving the browser.
**Current focus:** Phase 1 — Infrastructure

## Current Position

Phase: 1 — Infrastructure
Plan: — (not yet planned)
Status: Ready to plan
Last activity: 2026-05-10 — Roadmap created, v2.0 milestone underway

Progress: `[ ][ ][ ][ ][ ]` 0/5 phases complete

## Performance Metrics

Plans executed: 0
Requirements covered: 0/24
Phases complete: 0/5

## Accumulated Context

### Decisions

- Full brainstorm completed 2026-05-10 — all screen decisions locked
- Complete design spec at `docs/specs/2026-05-10-meridian-v2-design.md`
- Blueprint must be fetched server-to-server and written to Vercel Blob — 4.5 MB body limit enforced by Vercel
- Zero Anaplan API calls in client-side JS — CORS block is absolute
- Credentials stored in sessionStorage only — raw password never persists beyond browser close
- Two-model strategy: Haiku 4.5 for per-module extraction, Sonnet 4.6 for final synthesis
- Extraction pre-pass required before every Claude call — 200K token limit on Haiku
- Blob cleanup cron ships in same phase as blob creation (Phase 5) — non-negotiable
- SSE via `fetch()` + `ReadableStream` (not native EventSource) — POST endpoints require this
- `res.flushHeaders()` before first `await` in every SSE handler — prevents silent buffering

### Key Files

- `index.html` — 2990-line monolith; needs section comments before any new code (Phase 1)
- `api/generate.js` — Gemini proxy being migrated to Claude Haiku (Phase 1)
- `vercel.json` — needs `functions{}` block with per-endpoint `maxDuration` (Phase 1)

### Research Flags

- Phase 2: Anaplan auth response field names (`tokenInfo.tokenValue`, `expiresAt`) need live validation
- Phase 3: Blueprint payload size spike needed against real customer model before Blob-passthrough path confirmed as Day 1 requirement
- Phase 4: Triage tag calibration (Fix Now / Consider / Monitor) needs review with Anaplan builder before Phase 4 ships
- Phase 5: Blob access control — confirm no compliance requirements around public report URLs before starting Phase 5

### Todos

- [ ] Set `ANTHROPIC_API_KEY`, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET` in Vercel dashboard before Phase 2
- [ ] Validate Anaplan auth response field names against live account in Phase 2

### Blockers

None.

## Session Continuity

Next action: Run `/gsd-plan-phase 1` to plan Infrastructure phase.
