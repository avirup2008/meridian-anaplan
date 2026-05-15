# Phase 7: Comprehension & Health Rebuild — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-15
**Phase:** 07-comprehension-health
**Areas discussed:** Intelligence format, Domain detection, Blast radius & dependency, Model tab format, Honest limits, Architecture verdict, Health score, Mockup process, Sonnet call structure, Replan scope

---

## Pre-discussion brainstorm (this session)

Before /gsd-discuss-phase was invoked, a significant brainstorm session occurred covering:
- User identified current workstreams as "word salad AI slop, NOT intelligence"
- Root cause analysis: Sonnet was narrating rule counts, not reasoning about architecture
- Market research: no tool does multi-domain architectural reasoning; Meridian's confirmed whitespace
- Advisor comparison: surgical findings (module + line item + issue + fix) is the trust-building layer; domain detection is the insight layer
- Key insight: large enterprise models span multiple planning domains (workforce + demand + financial) so single-domain labeling doesn't work

---

## What intelligence means

| Option | Description | Selected |
|--------|-------------|----------|
| Consultant model brief | Domain coverage, architecture shape, top 3 named risks, unknowables | |
| Surgical named findings | 10–15 items: module · line item · issue · fix, no narrative | |
| Domain map + findings per domain | Grouped under domains, 1 sentence per domain | |
| Keep workstreams, fix the prompt | Same card format, better Sonnet prompting | |

**User's choice:** "Show me mockups for each, detailed in localhost to see how it would look like"
**Notes:** User wants to evaluate all formats visually before committing. Mockup-first approach added as D-01.

---

## Domain detection

| Option | Description | Selected |
|--------|-------------|----------|
| Sonnet reads all module names and infers | Works even with inconsistent naming | ✓ |
| Prefix clustering (deterministic) | Fast, fails on unlabeled models | |
| Hybrid: prefix first, Sonnet fills gaps | Best of both approaches | |
| Skip domain detection | Focus on finding-level specificity | |

**User's choice:** Sonnet reads all module names and infers

### Domain output

| Option | Description | Selected |
|--------|-------------|----------|
| Domain list + module membership | Which modules belong to each domain | |
| Domain list + integration seams | Plus boundary modules | |
| Full architecture story | Domains + seams + 2-sentence narrative | ✓ |

**User's choice:** Full architecture story

---

## Blast radius & dependency

| Option | Description | Selected |
|--------|-------------|----------|
| Top 10 modules by downstream impact | Ranked list with downstream counts | |
| Integration seam highlighting | Cross-domain boundary flags | |
| Both | Blast radius ranking + seam identification | ✓ |

**User's choice:** Both (Recommended)

### Blast radius prominence

| Option | Description | Selected |
|--------|-------------|----------|
| Top-level card in Model tab | First thing you see | |
| Integrated into Health tab findings | Inline per finding | |
| Both — summary in Model tab, inline in Health | ✓ |

**User's choice:** Both (Recommended)

---

## Model tab format

| Option | Description | Selected |
|--------|-------------|----------|
| Add to it — insert domain map at top | Keep existing classification table | |
| Redesign — lead with architecture story | Everything subordinate to architecture framing | |
| See the mockup first | ✓ |

**User's choice:** See the mockup first

---

## Honest limits

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — make it prominent, first-class content | ✓ |
| No — keep it secondary in Evidence Limits panel | |

**User's choice:** Yes — prominent, first-class content

---

## Architecture verdict

**User's choice:** Yes, with an overall health score

---

## Health score basis

| Option | Description | Selected |
|--------|-------------|----------|
| Finding severity × blast radius | Weighted deterministic formula | ✓ |
| Finding counts by category | Equal weight per category | |
| Sonnet's judgment | Holistic but less auditable | ✓ |

**User's choice:** 1+3 — hybrid: deterministic (severity × blast radius) base + Sonnet's narrative judgment

---

## Health score display

| Option | Description | Selected |
|--------|-------------|----------|
| Numeric score with letter grade | 67/100 — C+ | |
| Color-coded tier label | Executive Review, Focused Review, etc. | |
| Both — label headline, score on hover | | |

**User's choice:** [Dismissed — Claude's discretion]

---

## Mockup process

| Option | Description | Selected |
|--------|-------------|----------|
| Static HTML in index.html with hardcoded fake data | ✓ |
| Live SSE integration, iterate one format | |
| Separate mockup.html file | |

**User's choice:** Static HTML in index.html — hardcode fake data

---

## Sonnet call structure

| Option | Description | Selected |
|--------|-------------|----------|
| One combined Sonnet call — architecture + health findings | Fewer API calls, one SSE event | ✓ |
| Two separate Sonnet calls — Pass 1 architecture, Pass 2 health | More precise, two round-trips | |

**User's choice:** One Sonnet call — architecture story + domain map + health findings together

---

## Replan scope

| Option | Description | Selected |
|--------|-------------|----------|
| Keep skeleton, redesign intelligence layer | | ✓ (Claude's choice) |
| Start fresh — clean implementation | |

**User's choice:** Claude's discretion → Claude recommends keeping skeleton (working SSE plumbing, parseStateBlob, deterministic rules) and redesigning only the Sonnet call and UI rendering.

---

## Claude's Discretion

- Health score display format
- Exact Sonnet prompt engineering
- Fallback behavior on Sonnet timeout/malformed output
- Whether to cache architecture story in Vercel Blob

## Deferred Ideas

- DEEP-01 through DEEP-05 (calculation complexity, UX, ALM) — v4.0
- Multi-model batch analysis — confirmed whitespace, out of Phase 7
- Chat integration — Phase 8
