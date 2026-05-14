# Meridian Intelligence Rebuild Plan

## Objective

Meridian should behave like a senior Anaplan CoE review assistant, not a rules engine with consultant wording.

The core product rule is:

> Intelligence is only allowed to make claims that are supported by the fetched blueprint evidence. When the evidence is weak, the product must say that directly and downgrade or hide diagrams, blast-radius claims, and remediation advice.

## Research Findings

The current Anaplan blueprint-level fetch gives Meridian useful metadata, but it is not enough to prove every model-quality claim.

Blueprint line-item exports can include formats, formulas, and summaries. That supports evidence-backed checks for formula patterns, summary methods, format usage, dimensionality, and visible formula references.

Anaplan guidance also makes several checks valid from blueprint metadata:

- Summary methods matter because they define how child cells roll up, and totals across many dimensions or deep hierarchies can materially increase calculation work.
- Summary should generally be `None` unless a summary is required.
- Formula structure matters: nested IFs, repeated expressions, SUM and LOOKUP together, hardcoded SELECT, and long formulas are all recognized performance or maintainability concerns.
- Polaris formula design must preserve sparsity where possible; however, true Polaris calculation complexity needs fields such as calculation complexity/fan-out that Meridian does not currently fetch.

## What Is Feasible From Current Data

Current fetched fields:

- modules
- module id/name
- line items
- line item id/name
- formula
- format
- summary
- appliesTo dimensions
- notes when present
- fetch errors / partial load state

High-confidence capabilities:

- Identify incomplete fetches and skipped modules.
- Exclude decorative separator/header modules.
- Count functional modules, line items, formulas, and non-formula line items.
- Detect formula references between modules when formula text includes exact module names.
- Detect specific formula anti-patterns that are text-visible.
- Detect rate-like or percentage-like line items using `SUM` summary.
- Detect boolean summaries that are not `NONE`, `ANY`, or `ALL`.
- Detect text-formatted calculated line items.
- Estimate naming coverage and classification confidence.

Medium-confidence capabilities:

- Infer module responsibility from formula ratio, formats, summaries, dimensions, and references.
- Identify possible architecture boundary issues when naming and dependency evidence are both strong enough.
- Prioritize regression review targets when dependency evidence has enough edges.

Low-confidence / not feasible without more data:

- Actual performance impact, model open time, or recalculation time.
- True cell count, sparsity, or Polaris calculation complexity unless those fields are fetched.
- User-facing page usage and whether a line item is displayed on a UX page.
- Import/export/action/process design and scheduling.
- ALM revision history and change frequency.
- User roles, access controls, selective access, and workflow governance.
- Whether a module is intentionally named outside DISCO.
- Whether a summary method is wrong in business context without output validation.

## Product Contract

The intelligence layer has four levels.

1. Evidence Admissibility
   - Is the fetch complete?
   - Are formulas present?
   - Is the dependency graph dense enough to support architecture conclusions?
   - Is naming coverage strong enough to use DISCO/prefix classification?
   - Which conclusions are blocked?

2. Blueprint Facts
   - Functional module count
   - Excluded separator/header modules
   - Line-item and formula coverage
   - Summary/format risk counts
   - Dependency edge count
   - Classification coverage

3. Review Workstreams
   - No more than 5-6 workstreams.
   - Every workstream must have cited evidence.
   - Workstreams must distinguish:
     - evidence-quality limitations,
     - executive-number risks,
     - formula maintainability risks,
     - architecture claims,
     - metadata/governance cleanup.
   - Low-confidence architecture evidence must become a limitation workstream, not a remediation workstream.

4. Optional AI Synthesis
   - AI should not invent findings.
   - AI should receive only the evidence pack, diagnostics, and blocked-claims list.
   - AI output must be validated against real module/line-item evidence before display.
   - AI should write executive synthesis and questions for the model owner, not generate raw issues.

## UI Contract

The UI should show:

- Assessment posture based on evidence quality and material risks.
- A visible "Evidence Limits" section.
- "What Meridian can say" and "What Meridian cannot say yet".
- Diagrams only when evidence quality is sufficient.
- If dependency evidence is sparse, show a limitation card instead of a dependency map.
- If naming/classification confidence is low, show classification coverage instead of architecture mix.
- Workstreams as decision cards, not issue cards.

## Implementation Direction

The immediate rebuild should:

- Add backend diagnostics and admissibility gates.
- Add explicit `visualizations` flags to determine whether diagrams are allowed.
- Add source/limit-aware workstreams.
- Suppress confident architecture diagrams when graph or naming confidence is weak.
- Update UI panels and workstream cards to make confidence and limits legible.

## Research Sources

- Anaplan, "Export line items", Anapedia: line item exports include formats, formulas, and summaries.
- Anaplan, "Summary methods", Anapedia: summary methods define parent aggregation and should generally be `None` unless needed.
- Anaplan, "Formulas", Planual support: nested IFs, SUM + LOOKUP, hardcoded SELECT, formula breakup, and daisy chains are recognized model-building concerns.
- Anaplan, "Polaris calculation complexity", Anapedia: formula design affects sparsity and calculation density, but true complexity requires fields Meridian does not currently fetch.
