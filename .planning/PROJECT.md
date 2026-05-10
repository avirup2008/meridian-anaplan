# Meridian

## What This Is

Meridian is a web-based intelligence tool for Anaplan model builders. It connects to a live Anaplan model, fetches the complete blueprint of all modules and line items, and uses Claude AI to score the model's health, generate prioritised improvement suggestions, produce cross-module documentation notes, and export shareable reports — all from a single-page browser app with no backend infrastructure beyond Vercel serverless functions.

## Core Value

Anaplan model builders get instant, AI-powered analysis of their entire model without leaving the browser — replacing hours of manual review with actionable, prioritised suggestions in minutes.

## Current Milestone: v2.0 Live Model Intelligence

**Goal:** Replace manual CSV uploads with a live Anaplan API connection and overhaul the entire analysis, UI, and reporting layer.

**Target features:**
- Live Anaplan connection (Basic Auth, workspace + model picker)
- Master blueprint fetch (all modules + all line items, batched parallel)
- Claude-powered analysis (Sonnet for model verdict, Haiku for suggestions + notes)
- Overhauled dashboard UI (verdict, suggestions, notes, export panels)
- Shareable reports via Vercel Blob (PDF + 7-day shareable link)
- CSV upload retained as fallback

## Requirements

### Validated

- ✓ Single-page HTML app with Vercel serverless functions — v1.0
- ✓ CSV blueprint upload and per-module AI analysis — v1.0
- ✓ AI-generated improvement suggestions — v1.0
- ✓ PDF export of analysis results — v1.0

### Active

- [ ] User can connect to Anaplan via Basic Auth credentials
- [ ] User can browse and select a workspace and model
- [ ] System fetches complete master blueprint (all modules + all line items)
- [ ] Claude Sonnet produces model health score, tiered verdict, and executive summary
- [ ] Claude Haiku produces domain-grouped, triage-tagged suggestions per module
- [ ] Notes generator produces cross-module story with per-module drill-down
- [ ] Export panel lets user compose and download PDF or shareable Vercel Blob link
- [ ] CSV upload fallback still works via updated Claude Haiku endpoint

### Out of Scope

- OAuth / SSO authentication — Basic Auth only in v2; complexity not justified
- Anaplan write-back — read-only integration only
- Real-time collaboration on shared links — static snapshots via Vercel Blob
- Mobile layout — desktop browser only
- User accounts / persistent storage — no database, no auth system
- i18n / localisation — English only

## Context

- **v1 shipped:** Single 2990-line `index.html` + `api/generate.js` (Gemini 2.0 Flash). Users upload per-module CSV blueprints manually. Analysis is single-module, no cross-module awareness.
- **Stack:** `index.html` (vanilla JS, IBM Plex Sans/Mono) + Vercel serverless functions in `api/`. Deployed as `@vercel/static` + `@vercel/node`. No build step, no framework.
- **CSS tokens:** `--bg:#FAF8F0`, `--accent:#175AA6`, `--gold:#BF801E`, `--pos:#217348`, `--neg:#B82E2E`
- **Anaplan API:** Basic Auth. Key endpoints: `/workspaces`, `/models`, `/modules`, `/lineItems`. Blueprint assembled server-side in batches of 20 modules.
- **AI swap:** `GEMINI_API_KEY` + Gemini 2.0 Flash → `ANTHROPIC_API_KEY` + Claude Haiku (fast tasks) / Claude Sonnet (full model analysis).
- **Sharing:** Vercel Blob for 7-day read-only report links. No DB required.
- **Credentials:** Stored in `sessionStorage` only — cleared on browser close, never logged server-side.
- **Design decisions:** All UI decisions made in brainstorm session (2026-05-10). Full screen-by-screen spec at `docs/specs/2026-05-10-meridian-v2-design.md`.

## Constraints

- **Tech stack:** Vanilla HTML/JS + Vercel serverless — no framework, no build step, no DB
- **Auth:** Basic Auth only — no OAuth complexity in v2
- **Credentials:** Must never be stored beyond sessionStorage — security requirement
- **Function timeout:** Vercel max 60s on blueprint + analyze endpoints — chunked batching required
- **No accounts:** Vercel Blob handles sharing — no user management system

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Stay with single HTML file | v1 pattern works; no framework adds no value for this app size | — Pending |
| Basic Auth over OAuth | Simpler, Anaplan supports it, avoids token management complexity | — Pending |
| Claude Haiku for per-module work | Cost and speed — parallelised across 20–30 modules | — Pending |
| Claude Sonnet for full-model analysis | Cross-module reasoning requires stronger model | — Pending |
| Vercel Blob for sharing | No DB needed, 7-day TTL, zero infrastructure | — Pending |
| sessionStorage for credentials | Security — never persists beyond browser session | — Pending |
| Batch 20 modules at a time | Balance between parallelism and Anaplan API rate limits | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-10 — Milestone v2.0 started*
