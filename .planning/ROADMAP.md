# Meridian v3.0 — Roadmap

**Milestone:** v3.0 Meridian Intelligence Layer
**Created:** 2026-05-14
**Granularity:** Standard (4 phases)
**Coverage:** 24/24 requirements mapped

---

## Phases

- [x] **Phase 6: Model State Foundation** — Replace per-module blueprint batching with a single model-level lineItems API call; compact serialization; evidence pack with admissibility gates
- [ ] **Phase 7: Comprehension & Health Rebuild** — New Model tab with module classification, dependency graph, and DISCO architecture map; rebuilt Health tab with evidence-backed workstreams and confidence limits
- [ ] **Phase 8: Chat Interface** — Persistent conversational panel grounded in loaded model state and embedded Anaplan framework knowledge; mode-aware responses
- [ ] **Phase 9: Build Workflow** — Natural-language build spec generation; structured Markdown output accounting for the existing model

---

## Phase Details

### Phase 6: Model State Foundation
**Goal**: The system loads complete, verified model state from a single API call, serializes it compactly, and gates all downstream intelligence on evidence admissibility
**Depends on**: v2.0 baseline (Phases 1–5)
**Requirements**: MSF-01, MSF-02, MSF-03, MSF-04, MSF-05
**Success Criteria** (what must be TRUE):
  1. A connected user triggers one API call to `GET /models/{id}/lineItems?includeAll=true` and receives all modules, line items, and formulas — no per-module batching loop executes
  2. The serialized model state is verifiably compact (target ~45K tokens for a 228-module model) and the evidence pack JSON is present with four gate values (fetch completeness, formula coverage, dependency graph density, naming coverage)
  3. Decorator and separator modules are excluded from analysis automatically — they do not appear in comprehension output, health workstreams, or chat context
  4. When fetch completeness falls below the admissibility threshold, the UI renders a visible evidence-limit warning listing exactly which conclusions are blocked and why
**Plans**: 4 plans
- [x] 06-01-PLAN.md — API spike: confirm Anaplan model-level lineItems endpoint shape (wave 1, blocking gate)
- [x] 06-02-PLAN.md — api/model-state.js: parallel fetch, compact serializer, evidence pack, Blob write (wave 2)
- [ ] 06-03-PLAN.md — Infra swap: cleanup.js PREFIXES, delete blueprint.js, vercel.json (wave 3)
- [ ] 06-04-PLAN.md — index.html: SSE handler, Model tab stub, evidence-limit warning UI (wave 3)

### Phase 7: Comprehension & Health Rebuild
**Goal**: Users can inspect their model's architecture, module roles, and dependency structure in a new Model tab, and receive evidence-backed health workstreams with explicit confidence limits in a rebuilt Health tab
**Depends on**: Phase 6
**Requirements**: COMP-01, COMP-02, COMP-03, COMP-04, COMP-05, COMP-06, HLTH-01, HLTH-02, HLTH-03, HLTH-04
**Success Criteria** (what must be TRUE):
  1. The Model tab renders module classification (SYS, DAT, CAL, REP, INP) with a per-module confidence score, a dependency graph of cross-module formula references, and a DISCO architecture map with unknown-prefix modules flagged
  2. Dead logic (line items with no downstream references) and circular or daisy-chain formula patterns are detected and listed — the user can see which specific line items and modules are implicated
  3. When graph density or naming coverage is insufficient, diagrams and architecture claims are replaced with limitation cards that state exactly what evidence is missing — no speculative claims appear
  4. The rebuilt Health tab shows up to 6 workstreams with cited evidence and explicit confidence levels; low-confidence findings appear as limitation workstreams, not remediation workstreams; an "Evidence Limits" section states what Meridian can and cannot say; the executive summary is validated against real module and line-item data before display
**Plans**: TBD
**UI hint**: yes

### Phase 8: Chat Interface
**Goal**: Users can hold a persistent, model-grounded conversation with Meridian that distinguishes comprehension questions from build guidance requests and draws on embedded Anaplan framework knowledge
**Depends on**: Phase 7
**Requirements**: CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05
**Success Criteria** (what must be TRUE):
  1. A user can type a freeform question in the Chat panel and receive a response that references specific modules, line items, or formulas from their loaded model state — not generic Anaplan advice
  2. Chat responses for comprehension questions ("explain the supply planning logic") cite model evidence; responses for build guidance questions ("help me build a demand planning module") reference the embedded Anaplan framework knowledge in `/framework/`
  3. The `/framework/` directory is populated and covers DISCO naming, PLANS module roles, naming conventions, architecture patterns, summary methods, formula library, integration points, and build sequences
  4. The chat panel persists across tab switches within a session — conversation history is not lost when the user navigates to the Model or Health tab and back
**Plans**: TBD
**UI hint**: yes

### Phase 9: Build Workflow
**Goal**: Users can request a complete build specification for a new Anaplan capability in natural language and download it as a structured Markdown document that accounts for what already exists in their model
**Depends on**: Phase 8
**Requirements**: BLDW-01, BLDW-02, BLDW-03, BLDW-04
**Success Criteria** (what must be TRUE):
  1. A user can describe a capability in natural language ("I need a headcount planning module by department and month") and receive a structured build spec without leaving the chat or Build tab
  2. The generated build spec contains: list dimensions, module names, line item names, formats, formulas, summary methods, and build sequence — all as a coherent, ordered specification
  3. The build spec references existing model modules and lists by name where applicable and does not propose duplicating structures that already exist in the loaded model state
  4. The user can download the build spec as a Markdown file with one click — the file is well-formed and opens correctly in any Markdown viewer
**Plans**: TBD
**UI hint**: yes

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 6. Model State Foundation | 0/0 | Not started | - |
| 7. Comprehension & Health Rebuild | 0/0 | Not started | - |
| 8. Chat Interface | 0/0 | Not started | - |
| 9. Build Workflow | 0/0 | Not started | - |

---

*Roadmap created: 2026-05-14*
*Milestone: v3.0 Meridian Intelligence Layer*

---

---

## Archived: Meridian v2.0 Roadmap

**Milestone:** v2.0 Live Model Intelligence
**Created:** 2026-05-10
**Status:** Shipped

### Phases (v2.0)

- [x] **Phase 1: Infrastructure** — Lay the structural and dependency foundation before any feature code lands
- [x] **Phase 2: Connection** — Anaplan auth, workspace and model discovery, session token security
- [x] **Phase 3: Blueprint** — Master blueprint fetch via SSE, Vercel Blob storage, rate-limit resilience (completed 2026-05-11)
- [x] **Phase 4: Analysis** — Claude Sonnet + Haiku intelligence layer with extraction pre-pass
- [x] **Phase 5: Export, Share & UI** — Full UI overhaul, PDF export, Blob sharing, shared report view

### Phase Details (v2.0)

#### Phase 1: Infrastructure
**Goal**: All structural prerequisites are in place so feature code can land cleanly with no environment surprises
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04
**Plans**: 2/2 complete

#### Phase 2: Connection
**Goal**: Users can authenticate with Anaplan, browse their workspaces and models, and proceed to blueprint fetch — with graceful handling of session expiry and CSV fallback
**Requirements**: CONN-01, CONN-02, CONN-03, CONN-04
**Plans**: 3/3 complete

#### Phase 3: Blueprint
**Goal**: The system fetches and stores the complete master blueprint for a selected model, streaming live progress to the user, with resilience against Anaplan rate limits
**Requirements**: BPRT-01, BPRT-02, BPRT-03, BPRT-04
**Plans**: 3/3 complete

#### Phase 4: Analysis
**Goal**: Users receive a complete AI-powered assessment of their model — health score, triage-tagged suggestions, and a cross-module narrative — all within Vercel function timeout limits
**Requirements**: ANLZ-01, ANLZ-02, ANLZ-03, ANLZ-04
**Plans**: 3/3 complete

#### Phase 5: Export, Share & UI
**Goal**: Users can compose and download a PDF report or share a read-only link, across a fully overhauled 5-screen UI that renders correctly from Blob-stored data — including the shared report view
**Requirements**: EXPRT-01, EXPRT-02, EXPRT-03, EXPRT-04, UI-01, UI-02, UI-03, UI-04
**Plans**: 3/3 complete

---
*v2.0 archived: 2026-05-14*
