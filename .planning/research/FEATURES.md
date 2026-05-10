# Feature Landscape: Meridian v2.0

**Domain:** Anaplan model intelligence and health analysis tool
**Researched:** 2026-05-10
**Overall confidence:** HIGH for Anaplan domain patterns (verified via official docs, community, and third-party tools); MEDIUM for AI suggestion UX patterns (verified via multiple sources but no single authoritative standard)

---

## Research Summary

This document answers five specific questions about feature design for Meridian v2.0:

1. What do Anaplan builders care most about when reviewing model health?
2. What makes AI suggestions actually actionable vs noise?
3. What are the expected UX patterns for live API connection flows?
4. What does a good model documentation generator produce?
5. What sharing formats do Anaplan teams actually use?

---

## Question 1: What Anaplan Builders Care About in Model Health Reviews

**Confidence: HIGH** — sourced from Anapedia, Planual, community discussions, modelbuildertools.com audit patterns, and consulting guides.

### The four dimensions builders consistently audit

| Dimension | Specific Signals They Check | Severity |
|-----------|----------------------------|----------|
| **Formula Performance** | SUM+LOOKUP in same expression; RANK/RANKCUMULATE on large lists; TIMESUM on time-dimensioned items; FINDITEM on null values; TEXTLIST usage; nested IFs | Critical |
| **Module Structure** | Modules with 50+ line items; missing DISCO methodology; incorrect dimension order; subsidiary views overused; no SYS module per hierarchy | High |
| **Naming Conventions** | Module prefixes missing (DAT, SYS, CALC, etc.); inconsistent Title Case; names over 60 chars; hardcoded SELECT values instead of constants | Medium |
| **Best Practice Violations** | Import sources set to lists/modules instead of saved views/files; unused or unnamed actions; list properties beyond Display Name | Medium |

### The single most-requested community feature

The Anaplan community has explicitly asked for a built-in Model Health/Performance Dashboard for years. It does not exist natively. Anaplan provides two reports (Model Open Analysis and Model Performance Analysis) but they are raw diagnostic logs, not scored health summaries. Third-party tools like modelbuildertools.com fill this gap with a numeric health score (e.g., "82 — Good health, 3 optimization opportunities found") broken into four sub-dimensions: Formulas, Naming, Performance, Patterns.

**Implication for Meridian:** The health score + tiered verdict is not a nice-to-have — it is what the market is actively requesting and no native tool delivers well. This is a primary differentiator.

### What calculation effort thresholds trigger concern

- Single line item consuming >10% of model calculation effort warrants investigation.
- Formulas over ~100 characters should be decomposed into helper line items.
- Multiple PARENT() calls in a single formula signal unnecessary hierarchy climbing.

---

## Question 2: What Makes AI Suggestions Actionable vs Noise

**Confidence: MEDIUM** — patterns drawn from SonarQube severity model, NNG research on AI UX, enterprise planning tool analysis, and Anaplan community patterns.

### The SonarQube triage model is the industry reference for this pattern

SonarQube's five-tier severity model (Blocker → Critical → Major → Minor → Info) is the most widely-adopted framework for triage-tagged code/model suggestions in technical tooling. They faced exactly the same problem Meridian faces: too many suggestions without prioritization creates alert fatigue and forces manual overhead.

Their 2024 Multi-Quality Rule mode also introduced per-dimension severity — a rule can be Critical for Reliability but only Minor for Maintainability. This is directly analogous to Meridian's domain grouping (Structural/Formula/Best Practice/Naming).

### What separates actionable from noise

| Actionable | Noise |
|-----------|-------|
| Tied to a specific line item or module by name | Generic "you have formula issues" |
| Explains why it matters (consequence) | Just identifies the problem |
| Scoped to fix effort (1-line change vs refactor) | No complexity signal |
| Grouped by domain so reviewer can batch-fix | Flat list sorted by severity only |
| False positives can be dismissed | Forces action on everything |
| Cross-module context ("this pattern appears 14x") | Per-item isolation with no pattern signal |

### The three-tier triage model for Meridian

The planned "Fix Now / Consider / Monitor" tier system maps cleanly to industry precedent:

- **Fix Now** = Blockers that directly impair performance or violate structural integrity (SUM+LOOKUP, FINDITEM on nulls, import from module/list instead of saved view)
- **Consider** = Best practice violations that add technical debt but don't break calculations (missing SYS modules, subsidiary view overuse, hardcoded SELECTs)
- **Monitor** = Naming and cosmetic issues, minor inconsistencies, things that will matter at scale but not today

**Anti-pattern to avoid:** Do not let AI surface every finding at equal weight. The Anaplan community explicitly flags that current tools generate "too much noise" and that models slow down over time without "regular cleanup" — implying they already tune out undifferentiated suggestions. Meridian's triage tags are a primary trust signal.

### Domain grouping rationale

The four domains (Structural / Formula / Best Practice / Naming) map to how builders mentally partition work:

- Structural issues require architectural decisions — loop in senior builder or architect
- Formula issues are self-contained — any builder can fix them in a single session
- Best Practice violations often require stakeholder sign-off (changing import sources affects data flows)
- Naming issues can be batched in a single cleanup pass

Grouping by domain lets a builder hand off specific groups to appropriate team members — this is real-world workflow, not cosmetic organization.

---

## Question 3: Expected UX Patterns for Live API Connection Flows

**Confidence: HIGH** — sourced from Anaplan official API docs, OAuth 2.0 standards docs, and enterprise SaaS UX pattern research.

### Anaplan API authentication realities

Anaplan supports two auth methods:
1. **Basic/Certificate auth** — older method, still documented, uses AnaplanAuthToken JWT
2. **OAuth 2.0** — preferred for new integrations; Authorization Code flow for user-facing apps

Key Anaplan-specific constraints that affect UX:
- Workspace IDs must be **lowercase** in API calls
- Model IDs must be **UPPERCASE**
- Rate limit is at the **tenant level** — all workspaces share it; 429 errors require a hardcoded 10-second retry wait
- Blueprint export via API is a **community-requested feature** that does not exist natively — builders currently export manually by going to Modules → Line Items → Export (Excel with Formula column)

### The standard enterprise SaaS connection flow pattern

The Authorization Code flow is the correct choice for Meridian's user-facing connection UX. The expected pattern users recognize from tools like Slack, Notion, and Google Workspace:

1. "Connect to Anaplan" button in settings or onboarding
2. Redirect to Anaplan OAuth consent screen (or input client ID/secret for service credentials)
3. Return to Meridian with token stored; confirm connection success
4. Workspace picker — dropdown or searchable list of available workspaces
5. Model picker — once workspace selected, fetch available models
6. Connection status indicator (connected, last synced, error state)

### What users expect at each step

| Step | Table Stakes Behavior | Anti-pattern to Avoid |
|------|-----------------------|-----------------------|
| Credentials input | Clear label for what type of credential (OAuth vs service account) | Unlabeled fields |
| Redirect | Branded, descriptive consent screen explaining what access is requested | Blank OAuth screen |
| Workspace picker | Searchable, shows workspace display names not raw IDs | Showing raw 16-char hex workspace IDs |
| Model picker | Filtered by workspace; loads incrementally if many models | Loading all models across all workspaces upfront |
| Error states | Specific message (wrong credentials vs expired token vs rate limit) | Generic "connection failed" |
| Token management | Silent refresh; user never sees "please reconnect" unless truly needed | Forcing re-auth on every session |

### Blueprint fetch mechanism

Since Anaplan has no native API for blueprint export, the practical approach is:
- Use the Integration API v2.0 to trigger an existing export action in the model
- Or use the ALM (Application Lifecycle Management) API for model structure metadata
- The community has explicitly requested an API endpoint for blueprint/module structure — meaning this is a known gap and any workaround will require documentation

**Complexity note:** The blueprint fetch step is the highest-complexity piece of the entire v2.0 build. Rate limits, the lack of a native blueprint endpoint, and the need to traverse workspace → model → module → line item hierarchy all add up. Treat this as a phased rollout: connect → list models → fetch blueprint for one selected module first before attempting full model sweep.

---

## Question 4: What a Good Model Documentation Generator Produces

**Confidence: HIGH** — sourced from Anaplan CoModeler official page, community documentation discussions, and modelbuildertools.com audit patterns.

### What Anaplan teams actually need documented

Anaplan's own CoModeler product (their AI documentation generator) defines the standard. It produces:

1. **Plain-language specifications** — "What does this module do and why?" not just formula dumps
2. **Annotations** — inline explanations for non-obvious line items
3. **Change history** — what changed, when, and why (critical for handovers)
4. **Dependency maps** — which modules feed which, which line items reference which lists
5. **Logical flow explanations** — the cross-module story of how data moves

### The two views that matter

| View | Audience | Content |
|------|----------|---------|
| **Cross-module story view** | Business stakeholders, new team members | High-level narrative: "This model calculates headcount-driven costs by pulling actuals from DAT01, applying growth rates from SYS02, and outputting to the P&L calculation in CALC05" |
| **Per-module drill-down** | Model builders, auditors | Specific line item documentation, formula explanations, dimension rationale, performance notes |

### What makes documentation actually used vs filed-and-forgotten

Community consensus (from the November 2024 Best Practices Challenge and the "Documentation: It Starts With the 'Why'" discussion):

- Documentation must explain the **why**, not just the what — "This module exists because we needed to separate time-granularity calculations to avoid TIMESUM on time-dimensioned line items" is more valuable than "This module contains 14 line items"
- Notes and tooltips embedded in Anaplan itself are preferred for day-to-day reference (reduces round-trips to external docs)
- For handovers and audits, PDF or Confluence-linked documents are expected
- Teams that maintain documentation treat it "like a diary" — daily incremental updates, not big-bang docs at project end

### What Meridian's notes generator should produce (recommendation)

- **Cross-module view:** Narrative paragraph describing data flow, then a dependency table (Module → feeds → Module)
- **Per-module view:** Module purpose (1-2 sentences), dimension breakdown, top 5 performance-relevant line items with formula explanations, known issues or flags
- **Tone:** Plain language, not formula dumps — this is the gap CoModeler fills and the community has asked for for years
- **Format output:** Both inline (readable in browser) and exportable (PDF for handover, shareable link for async review)

**Anti-feature:** Do not generate documentation that is purely a reformatted blueprint CSV. That is what builders already have. The value is the AI-synthesized narrative layer on top of the raw structure.

---

## Question 5: What Sharing Formats Anaplan Teams Actually Use

**Confidence: HIGH** — sourced from Anapedia official export docs, community sharing discussions, and Vercel Blob documentation.

### The real sharing workflow in consulting and FP&A contexts

| Context | Preferred Format | Why |
|---------|-----------------|-----|
| Stakeholder health review | **PDF** — Anaplan Management Report style (slide-deck format) | Executives don't have Anaplan access; PDF is a trusted format for sign-off |
| Consulting handover | **PDF** | Deliverable for the engagement; client keeps it regardless of ongoing access |
| Internal builder review | **Shared link** | Builder already has Anaplan access; link lets them navigate to the relevant area |
| Cross-team async review | **Shareable link with snapshot** | Asynchronous, no account needed, can be embedded in Confluence/Slack |
| Archived audit record | **PDF stored in Confluence or SharePoint** | Compliance and governance requirements |

### What the community explicitly asks for and does NOT have

- **Automated bulk PDF export** — currently manual (select customer, export, rename, repeat). A major pain point for teams managing 50+ client engagements.
- **Toggle-based composition** — ability to select which sections to include before generating output (common request: "I want health score + formulas section only, skip naming")
- **Live preview before export** — so they can verify the content without going through a full export cycle

### Vercel Blob shareable link: fit for this use case

Vercel Blob is appropriate for Meridian's shareable link feature:
- Stores generated PDFs as durable blobs (99.999999999% durability via S3-backed storage)
- Link sharing does not require the recipient to have a Vercel account
- Supports conditional writes for collaborative scenarios
- Usage-based pricing aligns with a tool that generates reports on demand rather than continuously

**Complexity note:** Vercel Blob is low-complexity to implement given Meridian is already Vercel-hosted. The primary design question is expiry — shareable links for audit documents probably should not expire, but links for informal sharing probably should (7-30 days).

---

## Table Stakes vs Differentiators vs Anti-Features

### Table Stakes — Must have or tool feels incomplete

| Feature | Why Expected | Complexity |
|---------|--------------|------------|
| Numeric health score with tiered verdict | Community asks for this explicitly; third-party tools already do it; missing from Anaplan native | Medium — needs scoring algorithm calibration |
| Formula issue detection with specific line item names | Builders expect specific, named findings not generic warnings | Low — apply known rule set to parsed blueprint |
| Naming convention violation detection | Planual has explicit rules; any audit tool checks these | Low — regex/pattern matching |
| PDF export of analysis | Table stakes for consulting handover | Low — existing feature already in v1 |
| Connection success/failure states with specific error messages | Any integration UX requires this | Low |

### Differentiators — Not expected but creates strong value

| Feature | Value Proposition | Complexity |
|---------|-------------------|------------|
| Cross-module story view (narrative AI output) | CoModeler does this inside Anaplan, but not for health auditing; no third-party tool does narrative synthesis across modules | High — requires multi-module context in AI prompt |
| Triage tags (Fix Now / Consider / Monitor) | Reduces alert fatigue; maps to how consulting teams prioritize remediation sprints | Medium — needs tag logic + UX for dismissal/false positive |
| Domain grouping (Structural/Formula/Best Practice/Naming) | Lets builders delegate fixes to appropriate team members; no existing tool groups this way | Low once tagging logic exists |
| Toggle-based export composition | Addresses explicit community pain point for tailored handover docs | Medium — requires section-level state management |
| Shareable Vercel Blob link | Async sharing without requiring Anaplan access; no native equivalent | Low given existing Vercel infrastructure |
| Live API connection (workspace → model picker) | Eliminates manual CSV export step; most tools require upload; this is first-class UX | High — blueprint fetch workaround required |

### Anti-Features — Explicitly do not build

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Flat undifferentiated suggestion list | Causes alert fatigue; builders already tune out undifferentiated output | Always show triage tags; allow filtering by tier |
| Formula dump as documentation | Already available in the raw blueprint CSV builders export manually | Produce AI-synthesized narrative explanations |
| Showing raw workspace/model IDs to users | IDs are hex strings meaningless to builders | Always resolve to display names before showing |
| Global blueprint fetch on connection (fetch everything at once) | Rate limits + model size = timeouts and 429 errors | Fetch one model at a time on explicit user request |
| Permanent shareable links for all exports | Audit links should be durable; casual share links should expire | Offer expiry toggle at share time |
| Forcing re-auth on every session | Destroys UX for repeat users | Use refresh tokens with silent re-auth |
| Generating suggestions without cross-module context | Single-module analysis misses patterns that only appear across modules | Collect all modules before running AI analysis |

---

## Feature Dependencies on Existing v1 Code

| New Feature | Depends On (Existing) | Integration Risk |
|-------------|----------------------|-----------------|
| Live API connection | Nothing — new capability | High — blueprint fetch has no native API endpoint |
| Cross-model AI analysis | Single-module AI analysis (Gemini calls) | Medium — prompt engineering needs multi-module context window |
| Triage-tagged suggestions | Single-module suggestion generation | Low — add classification layer to existing suggestion output |
| Domain grouping | Suggestion generation | Low — grouping is presentation logic |
| Cross-module story view | Per-module analysis | Medium — needs synthesis step across module outputs |
| Per-module drill-down | Single-module AI analysis | Low — already exists, needs UI update |
| Export compose toggles | Basic PDF export | Medium — section-level state management |
| Live PDF preview | PDF export | Low — render existing pipeline in preview iframe |
| Vercel Blob shareable link | PDF export | Low — upload generated PDF to Blob, return URL |

---

## Phase-Specific Complexity Notes

| Phase | Likely Bottleneck | Mitigation |
|-------|------------------|------------|
| Live API connection | Blueprint fetch — no native API; must use export action workaround or ALM API | Prototype fetch mechanism first before building connection UX |
| Cross-model analysis | AI prompt context window — full model blueprint can be very large | Chunk by module; summarize module outputs before cross-model synthesis |
| Suggestion triage tagging | Calibrating Fix Now vs Consider — wrong calibration destroys trust | Start conservative (only flag known-bad patterns as Fix Now); expand over time |
| Export compose | Section toggle state must survive multi-step flow | Treat compose state as explicit UI state object, not derived |

---

## MVP Recommendation

Build in this order based on dependency chain and user value:

1. **Triage tags on existing suggestions** — highest leverage on existing v1 output; immediately makes existing suggestions more actionable; low complexity
2. **Domain grouping on suggestion panel** — presentation change on existing data; no AI changes needed
3. **Vercel Blob shareable link** — low complexity; directly addresses handover use case; independent of API work
4. **Live API connection (workspace → model picker)** — high value but high complexity; front-load the blueprint fetch prototype before building the UX
5. **Cross-model AI analysis with health score** — requires API connection to be stable first
6. **Cross-module story view** — highest AI complexity; requires multi-module context; do last

Defer: Export compose toggles until cross-model analysis output is stable — you cannot design good toggle sections until you know what the AI actually produces.

---

## Sources

- [Anaplan Integration API V2 Guide — Apiary](https://anaplan.docs.apiary.io/)
- [Anaplan API — Anapedia](https://help.anaplan.com/anaplan-api-844c6d40-a21c-423d-8435-ebaaa0372b76)
- [Integration API v2.0 — Anapedia](https://help.anaplan.com/integration-api-v20-399496b0-d66e-4a84-895a-8d1ffdee2e6b)
- [Anaplan Connect — Anapedia](https://help.anaplan.com/anaplan-connect-e3a9f00c-3924-4cfb-aed0-1ec14233821b)
- [Model Health Performance Dashboard — Anaplan Community](https://community.anaplan.com/discussion/104425)
- [Four tips on Anaplan model documentation — Anaplan Community](https://community.anaplan.com/discussion/158732)
- [Documentation: It Starts With the Why — Anaplan Community](https://community.anaplan.com/discussion/109626)
- [OEG Best Practice: Formula optimization in Anaplan — Community](https://community.anaplan.com/t5/Best-Practices/Formula-optimization-in-Anaplan/ta-p/41663)
- [OEG Best Practice: Best practices for module design — Community](https://community.anaplan.com/t5/Best-Practices/Best-Practices-for-Module-Design/ta-p/35993)
- [A Leader's Guide to Spotting Issues in Anaplan Models — Medium/Seyma Tash](https://seymatash.medium.com/a-leaders-guide-to-spotting-issues-in-anaplan-models-a213bdbfe220)
- [Model Builder Tools — modelbuildertools.com](https://modelbuildertools.com/)
- [Anaplan CoModeler — anaplan.com](https://www.anaplan.com/platform/anaplan-comodeler/)
- [Share your model design best practices — Community Nov 2024](https://community.anaplan.com/discussion/159444)
- [Export a report as a PDF file — Anapedia](https://help.anaplan.com/259f4906-5963-46e2-a224-88a655b7c3f1)
- [Vercel Blob — Vercel Docs](https://vercel.com/docs/vercel-blob)
- [SonarQube Issues — Sonar Documentation](https://docs.sonarsource.com/sonarqube-server/10.4/user-guide/issues)
- [OAuth 2.0 for Agent Connectors — Airbyte](https://airbyte.com/agentic-data/oauth-agent-connectors-architecture)
- [Ability to automate export of blueprint view — Anaplan Community](https://community.anaplan.com/discussion/54285)
- [Planual — Anaplan Community S3](https://anaplancommunity.s3.us-east-2.amazonaws.com/Misc/planual06052019.pdf)
- [Naming Conventions — Anapedia](https://help.anaplan.com/name-conventions-aeb0b95e-f7a3-4fe5-81c7-aec9a12f80be)
