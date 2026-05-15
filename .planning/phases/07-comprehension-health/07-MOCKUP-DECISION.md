# Phase 7: Mockup Decision

**Date:** 2026-05-15  
**Status:** LOCKED — proceed to Wave 3 implementation

---

## Health Tab Format: Brief + Workstreams (combined)

**Selected:** Option 1 (Consultant Brief) merged with Option 4 (Workstream Cards)

**Layout (top to bottom):**
1. Prominent honest limits banner (gold, first-class, before score)
2. Score card — plain numeric 62/100, "Focused Review" verdict chip, 5 dimension bars
3. Architecture verdict card (.verdict-card.risk) — named verdict + 2-sentence story
4. Domain map diagram — visual cluster diagram showing Workforce / Integration Seams / Demand Planning domains with module counts and seam highlights
5. Top named risks — 2–3 blocker cards (Critical/High only, with blast radius inline)
6. Divider
7. Review workstreams — 4 gen-block cards with priority badge, confidence badge, narrative, review question, evidence count

**Honest limits:** Prominent gold banner at top of Assessment tab content, badge list format. NOT buried in Evidence Limits panel.

**Health score display:** Plain numeric 0–100, no letter grade. Tier label ("Focused Review") as chip below the number.

---

## Model Tab Format: Additive

**Selected:** Option 5 (Additive — architecture story + blast radius inserted above existing content)

**Layout (top to bottom):**
1. Architecture verdict card — named one-liner characterization
2. Architecture story — 2 sentences (what kind of model, how mature)
3. Blast radius chart — horizontal bar chart with module name, downstream count, layer badge, risk flag; sorted descending
4. Integration seam callout — 3-module highlight with downstream counts
5. Divider ("Existing content preserved below")
6. Existing DISCO map tiles (unchanged)
7. Existing module classification table (unchanged)
8. Existing dependency graph (unchanged)

---

## Diagram Requirements

Both tabs need visual diagrams, not just tables and text.

**Health tab — Domain Map diagram:**
- Three-panel visual: [Workforce Planning] ←→ [Integration Seams] ←→ [Demand Planning]
- Each panel shows module count and key module names
- Seam panel highlighted in red/neg color with downstream counts
- Uses `.arch-wrap` / `.arch-node` / `.arch-arr` Meridian CSS classes

**Model tab — Blast Radius bar chart:**
- Horizontal bar chart, one row per top-10 module
- Bar width = downstream count / max downstream count
- Color: neg (≥15), gold (≥5), pos (<5)
- Inline layer badge and risk flag per row
- CSS-only (no canvas/d3), uses `.prog` / `.prog-f` bar pattern

---

## Implementation Notes for Wave 3 (07-03)

- Single Sonnet call must output: `domainMap` (domains array, seams array, architectureStory, architectureVerdict), `findings` (per-finding array with moduleName, lineItemName, ruleId, severity, downstreamCount, fix), `workstreams` (4–5 cards), `healthScore` (0–100 integer), `healthTier` (string)
- Blast radius ranking: computed deterministically from `buildDependencyGraph()` — already available, no Sonnet needed
- Domain map diagram: rendered from Sonnet's `domainMap` output
- All dynamic content rendered via `escapeHtml()` before DOM insertion
