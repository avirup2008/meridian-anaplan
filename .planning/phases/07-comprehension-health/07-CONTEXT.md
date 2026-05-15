# Phase 7: Comprehension & Health Rebuild — Context

**Gathered:** 2026-05-15
**Status:** Ready for planning
**Source:** /gsd-discuss-phase 7 (full interactive session)

<domain>
## Phase Boundary

Rebuild the Model tab and Health tab intelligence layer so that analysis output is genuinely specific to the loaded model — not generic rule-count narration.

**Two deliverables:**
1. **Model tab** — architecture story, domain map, blast radius ranking, module classification
2. **Health tab** — health score, architecture verdict, named findings, honest limits (prominent)

The phase starts with a mockup wave (static HTML, hardcoded fake data) to evaluate format options before committing to an implementation. Format decisions are locked after user review of mockups, then implementation proceeds.

</domain>

<decisions>
## Implementation Decisions

### D-01: Mockup-first format selection
Build ALL candidate Health tab formats AND Model tab layouts as static sections in `index.html` with hardcoded fake data BEFORE wiring any real SSE data. User reviews in browser and picks format. Only then does implementation proceed.

Health tab candidates to mock:
1. Consultant model brief (domain coverage, architecture shape, top 3 named risks, what's unknowable)
2. Surgical named findings (10–15 items: module · line item · issue · one-line fix, no narrative)
3. Domain map + findings per domain (grouped under inferred domain, 1 sentence per domain)
4. Workstream cards with model-specific Sonnet synthesis (current approach, fixed prompt)

Model tab layouts to mock:
1. Add to existing — insert architecture story + blast radius ranking above current classification table
2. Redesign — architecture story as headline, existing content (DISCO map, module table, dependency graph) as subordinate detail

### D-02: Domain detection via Sonnet
Sonnet reads ALL module names and infers planning subdomains. This approach is chosen because it works even on models with inconsistent or no DISCO naming (like the COPS Demo).

Sonnet output from module name inference:
- Planning domains detected (e.g. Workforce Planning, Demand Planning, Financial Consolidation)
- Which modules belong to each domain
- Integration seam modules (sit at cross-domain boundaries — highest blast radius nodes)
- 2-sentence architecture story (what kind of model is this, how mature is the architecture)

This is a SINGLE Sonnet call that feeds BOTH the Model tab and Health tab (see D-05).

### D-03: Blast radius — both summary and inline
Blast radius is surfaced at two levels:
1. **Model tab summary section** — top 10 modules ranked by downstream module count. Format: "If SYS01 changes → 23 modules recalculate. If CAL07 changes → 8 modules recalculate."
2. **Health tab findings** — each finding includes the downstream count for the affected module inline. Format: "CAL07 · Revenue Forecast · SUM+LOOKUP · 8 downstream modules affected"

Integration seam modules (from D-02) are flagged separately as cross-domain risk nodes in the Model tab.

### D-04: Honest limits — prominent, first-class content
"What Meridian cannot tell you" is NOT buried in an Evidence Limits panel. It is a prominent, first-class section visible at the top of the Health tab. Explicitly stating what we cannot assess builds trust and differentiates Meridian from tools that hallucinate confidence.

Cannot-assess list (fixed, not dynamic):
- Calculation execution speed
- Data load runtimes
- User experience / dashboard design
- ALM governance (dev/test/prod hygiene)
- Whether formulas are logically correct (only that they exist)
- Workspace utilization

### D-05: Single Sonnet call architecture
One Sonnet call replaces the current dual-call approach. The single call receives:
- All module names (for domain inference)
- Deterministic finding breakdown per rule (module names, line item names, counts — same signal as current implementation)

The single call produces:
- Domain map (domain list + module membership + integration seams)
- Architecture story (2 sentences)
- Architecture verdict (1-line model characterization)
- Health workstreams / findings (format TBD after mockup review)
- Health score narrative (Sonnet's judgment component)

SSE event flow: model-comprehension → stage:health → single Sonnet call → `health-workstreams` event (carries all of the above) → complete

### D-06: Health score — hybrid (deterministic base + Sonnet judgment)
Health score = deterministic component (finding severity × blast radius of affected module) + Sonnet's narrative judgment.

Deterministic component: each finding contributes based on its rule severity tier (Critical > High > Medium > Watch) weighted by the downstream module count of its host module. Normalized to 0–100.

Sonnet's judgment: after generating the architecture story and findings, Sonnet assigns a score with reasoning. The final displayed score is a blend of both.

Score display: Claude's discretion (user deferred). Recommendation: tier label as headline (e.g. "Executive Review"), numeric score available on expand to avoid false precision as the leading signal.

### D-07: Architecture verdict
A one-line characterization of the model's structural health generated by Sonnet from the architecture story inference. Examples:
- "Multi-domain model (workforce + demand), well-layered DISCO structure, integration seams under-protected"
- "Single-domain revenue model, inconsistent naming, heavy calculation layer with high blast radius nodes"

### D-08: Replan scope — keep skeleton, redesign intelligence layer
Keep: SSE plumbing, parseStateBlob(), SSRF guards, deterministic rule scanning (scanDeterministicFindings, scanArchitectureFindings), detectDeadLogic, detectCircularDependencies, detectDaisyChains.

Replace/redesign: Sonnet call structure (single call per D-05), SSE event payload shapes, Health tab UI rendering, Model tab layout (after mockup review).

### Claude's Discretion
- Health score display format: plain numeric score 0–100, no letter grade
- Exact Sonnet prompt engineering for the single combined call
- Fallback behavior when Sonnet domain inference times out or returns malformed output
- Whether to cache the architecture story in Vercel Blob alongside the state blob (recommended: yes, to avoid re-running Sonnet on repeated analysis of the same model)
- Final mockup format choices are Claude's recommendation based on what looks most credible and actionable

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core implementation files
- `api/analyze-v3.js` — existing SSE handler; keep skeleton (parseStateBlob, SSE plumbing, SSRF guard); redesign Sonnet call and health-workstreams event
- `api/analysis-core.js` — deterministic rules engine; scanDeterministicFindings, scanArchitectureFindings, buildDependencyGraph, buildArchitectureClassification; DO NOT modify these
- `index.html` — ~4700 lines; Model tab + Health tab rendering; runAnalysis() + SSE switch; escapeHtml() defined once

### Planning docs
- `.planning/REQUIREMENTS.md` — Phase 7 requirements: COMP-01 through COMP-06, HLTH-01 through HLTH-04
- `.planning/phases/07-comprehension-health/07-RESEARCH.md` — original research (domain intelligence section still relevant)

### Market research (done in this session — summarized in session context)
- Confirmed: ModelBuilderTools.com is closest competitor; no tool does multi-domain architectural reasoning
- Confirmed: community-validated signals are already in our deterministic rules
- Confirmed: whitespace is architectural reasoning, not better detection

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `parseStateBlob()` in analyze-v3.js — converts tab-separated blob to module objects; keep as-is
- `scanDeterministicFindings()` + `scanArchitectureFindings()` in analysis-core.js — produce the finding breakdown that feeds Sonnet; keep as-is
- `buildDependencyGraph()` in analysis-core.js — produces cross-module reference graph used for blast radius ranking; keep as-is
- `detectDeadLogic()`, `detectCircularDependencies()`, `detectDaisyChains()` — keep as-is
- `escapeHtml()` in index.html — XSS protection for all dynamic DOM insertion; must be used for all new Sonnet output rendered to DOM

### Established Patterns
- SSE via `fetch()` + `ReadableStream` (not native EventSource — POST endpoints)
- `res.flushHeaders()` before first `await` in every SSE handler
- Evidence pack with 4 admissibility gates (fetchCompleteness, formulaCoverage, graphDensity, namingCoverage) — passed from client to analyze-v3.js
- Dynamic DOM insertion pattern: `_anl$('element-id')` helper for Model/Health tab DOM

### Integration Points
- `runAnalysis()` in index.html sends stateUrl + evidencePack to `/api/analyze-v3`
- SSE switch in `runAnalysis()` handles: 'stage', 'model-comprehension', 'health-workstreams', 'complete', 'error'
- `_anlOnModelComprehension(evt)` and `_anlOnHealthWorkstreams(evt)` are the two main SSE event handlers in the UI

</code_context>

<specifics>
## Specific Ideas

### The "word salad" problem — root cause and fix
Current failure: Sonnet was narrating rule counts ("422 naming violations") rather than reasoning about architecture. The fix is NOT better prompts — it's a different input structure. Sonnet needs to receive module names (to infer architecture) AND finding specifics (to anchor claims), not just aggregate counts.

### Mockup fidelity requirement
Mockups must use REALISTIC hardcoded data — real-looking module names (e.g. "CAL07 Revenue Build", "SYS01 Config", "DAT03 Employee Master"), realistic finding counts, realistic blast radius numbers. Fake data that looks real is essential for evaluating whether a format feels credible.

### The domain seam insight
The most valuable intelligence a multi-domain model reader wants: which modules sit at the boundary between planning domains. These are the highest-risk architectural nodes — a change there propagates across domains, not just within one. This is the key differentiator vs. ModelBuilderTools.com (which only scores individual modules).

### Honest limits as credibility signal
Explicit "we cannot assess X" language is a credibility marker. The market research confirmed that tools which surface evidence limits are perceived as more trustworthy than those that produce unbounded confidence assessments.

</specifics>

<deferred>
## Deferred Ideas

- Caching architecture story in Vercel Blob — noted for implementation consideration; Claude's discretion on whether to include in Phase 7 or Phase 8
- DEEP-01 through DEEP-05 requirements (calculation complexity, UX coverage, ALM analysis) — v4.0 scope, out of Phase 7
- Multi-model batch health analysis — the confirmed whitespace, but Phase 7 is single-model
- Chat interface integration (CHAT-01 through CHAT-05) — Phase 8

</deferred>

---

*Phase: 07-comprehension-health*
*Context gathered: 2026-05-15 via /gsd-discuss-phase 7*
