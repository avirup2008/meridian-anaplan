# Requirements: Meridian v3.0

**Defined:** 2026-05-14
**Core Value:** Anaplan builders and consultants get instant, deep model understanding and AI-powered build guidance — comprehension, health diagnostics, and spec generation — without leaving the browser.

## v3.0 Requirements

### Model State Foundation

- [ ] **MSF-01**: System fetches complete model state via a single model-level lineItems API call (replacing per-module batching)
- [ ] **MSF-02**: Model state is serialized into a compact, token-efficient text format (~45K tokens for a 228-module model)
- [ ] **MSF-03**: Evidence pack is produced with admissibility gates (fetch completeness, formula coverage, dependency graph density, naming coverage)
- [ ] **MSF-04**: System identifies and excludes decorator/separator modules from analysis automatically
- [ ] **MSF-05**: Incomplete fetches surface a visible evidence-limit warning; blocked conclusions are listed explicitly in the UI

### Model Comprehension

- [ ] **COMP-01**: User sees module classification (SYS, DAT, CAL, REP, INP) with per-module confidence scores
- [ ] **COMP-02**: User sees a dependency graph showing cross-module formula references derived from formula text
- [ ] **COMP-03**: User sees a DISCO architecture map with prefix coverage and unknown-prefix modules flagged
- [ ] **COMP-04**: System detects dead logic (line items with no downstream formula references)
- [ ] **COMP-05**: System detects circular or daisy-chain formula patterns visible in formula text
- [ ] **COMP-06**: Diagrams and architecture claims are suppressed (replaced with limitation cards) when graph or naming evidence is insufficient

### Health & Performance (rebuilt)

- [ ] **HLTH-01**: Health tab shows up to 6 workstreams, each with cited evidence and explicit confidence level
- [ ] **HLTH-02**: Low-confidence architecture findings become limitation workstreams, not remediation workstreams
- [ ] **HLTH-03**: UI shows an "Evidence Limits" section: "What Meridian can say" and "What Meridian cannot say yet"
- [ ] **HLTH-04**: Executive summary is written by AI from the evidence pack only — no invented findings, validated against real module/line-item data before display

### Chat Interface

- [ ] **CHAT-01**: User can ask freeform questions about their model in a persistent chat panel
- [ ] **CHAT-02**: Chat responses are grounded in the loaded model state (not generic Anaplan advice)
- [ ] **CHAT-03**: Chat has access to embedded Anaplan framework knowledge stored in `/framework/` directory in the Vercel project
- [ ] **CHAT-04**: Framework covers: DISCO naming, PLANS module roles, naming conventions, architecture patterns, summary methods, formula library, integration points, build sequences
- [ ] **CHAT-05**: Chat distinguishes between comprehension mode ("explain this logic") and build guidance mode ("help me build this")

### Build Workflow

- [ ] **BLDW-01**: User can request a build spec for a new model capability in natural language from the chat or a dedicated Build tab
- [ ] **BLDW-02**: Meridian generates a structured build spec including: list dimensions, module names, line item names, formats, formulas, summary methods, and build sequence
- [ ] **BLDW-03**: Build spec accounts for the existing model — avoids duplicating what already exists; references existing modules and lists by name where appropriate
- [ ] **BLDW-04**: Build spec is downloadable as a structured Markdown document

## Future Requirements (v4.0+)

### Deeper Intelligence

- **DEEP-01**: True Polaris calculation complexity scoring (requires fetching additional complexity fields)
- **DEEP-02**: UX page coverage — detect which line items are visible on dashboards
- **DEEP-03**: Import/export/action/process design analysis
- **DEEP-04**: ALM revision history and change frequency analysis
- **DEEP-05**: User role and selective access analysis

### Collaboration

- **COLB-01**: Multi-user shared session (same model, different browsers)
- **COLB-02**: Annotation layer on top of model comprehension view
- **COLB-03**: Build spec review workflow with comments

## Out of Scope

| Feature | Reason |
|---------|--------|
| Anaplan write-back | Read-only integration only — safety boundary |
| OAuth / SSO | Basic Auth sufficient; OAuth adds disproportionate complexity |
| Mobile layout | Desktop-first tool for builders and consultants |
| User accounts / persistent storage | No database — sessionStorage + Vercel Blob only |
| Real-time collaboration | Static snapshots only; concurrent editing out of scope |
| i18n / localisation | English only |
| Performance benchmarking against model history | Requires ALM access not available via blueprint API |
| Direct Anaplan model write (create modules/line items) | Read-only API scope; write-back requires Model Admin permissions and separate design |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| MSF-01 | Phase 6 | Pending |
| MSF-02 | Phase 6 | Pending |
| MSF-03 | Phase 6 | Pending |
| MSF-04 | Phase 6 | Pending |
| MSF-05 | Phase 6 | Pending |
| COMP-01 | Phase 7 | Pending |
| COMP-02 | Phase 7 | Pending |
| COMP-03 | Phase 7 | Pending |
| COMP-04 | Phase 7 | Pending |
| COMP-05 | Phase 7 | Pending |
| COMP-06 | Phase 7 | Pending |
| HLTH-01 | Phase 7 | Pending |
| HLTH-02 | Phase 7 | Pending |
| HLTH-03 | Phase 7 | Pending |
| HLTH-04 | Phase 7 | Pending |
| CHAT-01 | Phase 8 | Pending |
| CHAT-02 | Phase 8 | Pending |
| CHAT-03 | Phase 8 | Pending |
| CHAT-04 | Phase 8 | Pending |
| CHAT-05 | Phase 8 | Pending |
| BLDW-01 | Phase 9 | Pending |
| BLDW-02 | Phase 9 | Pending |
| BLDW-03 | Phase 9 | Pending |
| BLDW-04 | Phase 9 | Pending |

**Coverage:**
- v3.0 requirements: 24 total
- Mapped to phases: 24
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-14*
*Last updated: 2026-05-14 — traceability confirmed after v3.0 roadmap creation*
