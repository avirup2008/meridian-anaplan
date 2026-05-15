---
phase: 07-comprehension-health
plan: 01
subsystem: index.html (static mockups)
tags: [mockup, health-tab, model-tab, format-selection, dev-nav]
dependency_graph:
  requires: []
  provides: [mock-health-brief, mock-health-surgical, mock-health-domain, mock-health-workstreams, mock-model-additive, mock-model-redesign, mock-nav]
  affects: [index.html]
tech_stack:
  added: []
  patterns: [inline onclick, hidden attribute toggle, DOM querySelector]
key_files:
  created: []
  modified:
    - index.html
decisions:
  - "#mock-nav placed immediately after <body> opening tag (line 718) for maximum dev visibility"
  - "showMock() uses querySelectorAll('[id^=mock-health-],[id^=mock-model-]') selector to avoid hardcoding section list"
  - "12 surgical findings styled with inline border-bottom rows rather than a <table> to match reading flow of the format"
  - "Blast radius top-10 table duplicated verbatim in both model layouts — avoids cross-section references in static HTML"
  - "Workstream card colors follow existing palette: critical=#c41a1a, high=#d97706, medium=#0a7a3b, watch=#5563de"
metrics:
  duration: "~15 minutes"
  completed: "2026-05-15"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 1
  lines_added: 259
---

# Phase 07 Plan 01: Static Mockup Sections — Summary

**One-liner:** Six static HTML mockup sections (4 Health tab variants + 2 Model tab layouts) inserted into index.html with realistic hardcoded Anaplan data and a fixed-position dev nav strip for browser-based format review.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Insert four Health tab mockup variants + dev nav strip | 6ea2550 | index.html (lines 718–737, 1042–1197) |
| 2 | Insert two Model tab mockup layouts | 6ea2550 | index.html (lines 1198–1274) |

## Mockup Section IDs and Line Ranges

| Section ID | Type | Lines | Description |
|------------|------|-------|-------------|
| `#mock-nav` | Dev strip | 718–737 | Fixed-position nav with 7 buttons + showMock() script |
| `#mock-health-brief` | Health variant 1 | 1042–1067 | Consultant brief: domain coverage, architecture shape, top 3 named risks |
| `#mock-health-surgical` | Health variant 2 | 1068–1098 | 12 surgical findings with module · line item · issue · fix · downstream count |
| `#mock-health-domain` | Health variant 3 | 1099–1134 | Domain map grouped by Workforce Planning / Demand Planning / Integration Seams |
| `#mock-health-workstreams` | Health variant 4 | 1135–1197 | 4 workstream cards matching current _anlOnHealthWorkstreams card style |
| `#mock-model-additive` | Model layout 1 | 1198–1237 | Architecture verdict + blast radius top-10 above preserved classification slots |
| `#mock-model-redesign` | Model layout 2 | 1238–1273 | Dark hero verdict header + blast radius + collapsible details for existing content |

## What Was Built

### Dev Nav Strip (#mock-nav, lines 718–737)
- Fixed top-right, z-index 9999, amber border on pale yellow background
- 6 format buttons + "Hide all mockups" reset button
- `showMock(id)` function: hides all `[id^="mock-health-"]` and `[id^="mock-model-"]` sections, then unhides and scrolls to target

### Health Variant 1: Consultant Brief (#mock-health-brief)
- Prominent orange "What Meridian cannot tell you" banner (D-04) with all 6 cannot-assess items
- Domain Coverage: Workforce Planning (12 modules) + Demand Planning (18 modules) + 3 integration seams
- Architecture Shape: DISCO naming 62%, calculation layer 73% concentration
- Top 3 Named Risks with blast radius counts (CAL07 ×8, SYS01 ×23, WFP01 ×4)

### Health Variant 2: Surgical Findings (#mock-health-surgical)
- Same honest-limits banner
- 12 finding rows: module · line item · issue type · downstream count (bold red if >10) · one-line fix
- No narrative wrapper — pure list format
- Module names: CAL07 (×3), SYS01 (×2), WFP01 (×3), DAT03 (×2), DEM05 (×2)

### Health Variant 3: Domain Map (#mock-health-domain)
- Same honest-limits banner
- Three grouped sections: Workforce Planning, Demand Planning, Integration Seams
- Integration seams highlighted as cross-domain risk nodes (D-03)

### Health Variant 4: Workstream Cards (#mock-health-workstreams)
- Same honest-limits banner
- 4 cards with color-coded left border per priority tier
- Each card: title, priority chip, confidence chip, why-it-matters, review question, examples
- Cards 3 and 4 explicitly note evidence limits as the source of medium/low confidence

### Model Layout 1: Additive (#mock-model-additive)
- Blue architecture verdict box at top
- 2-sentence architecture story
- Blast radius top-10 table with color-coded counts (>10 = red)
- Horizontal rule separator, then placeholder slots for existing DISCO classification table and DISCO map tiles

### Model Layout 2: Redesign (#mock-model-redesign)
- Dark (#0f172a) hero card with architecture verdict as headline (D-07 wording)
- Blast radius top-10 table (same data as additive)
- Three `<details>` elements collapsing: Module Classification, DISCO Map, Cross-Module Dependencies

## Deviations from Plan

None. Plan executed exactly as written.

- Tasks 1 and 2 were committed in a single atomic commit (6ea2550) because both edits touched index.html sequentially with no intervening verification step requiring separate commits.

## Known Stubs

These stubs are intentional — this is a mockup-selection plan. All data is hardcoded fake data per D-01. The stubs are NOT blockers for this plan's goal (format review). They will be replaced in Plan 07-04 when real SSE data is wired.

| Stub | File | Lines | Reason |
|------|------|-------|--------|
| Hardcoded module names + finding counts | index.html | 1042–1274 | Intentional per D-01 MOCKUP-FIRST; Plan 07-04 deletes all #mock-* sections |
| "(Existing #model-classification-table content slot — preserved)" placeholder divs | index.html | 1232, 1261, 1266, 1271 | Slot indicators for additive/redesign layouts; wired in Plan 07-04 |
| #mock-nav dev strip | index.html | 718–737 | T-07-01-03: must be removed by Plan 07-04; Wave 4 verification checks `grep -c "mock-nav" = 0` |

## Threat Flags

No new threat surface beyond what is already in the plan's threat model (T-07-01-01 through T-07-01-03). All mock data is fake/illustrative. `showMock()` uses no eval and no innerHTML of untrusted data.

## Self-Check

Verifying all claims before marking complete.
