# Anaplan Module Design Principles

## Module Sizing

- Target: 50-100 line items per module (max 200)
- Modules over 200 line items should be split by business function
- Modules under 10 line items may indicate over-fragmentation

## Line Item Design

### Formats
- NUMBER: Quantities, counts, ratios
- CURRENCY: Financial values (inherit model currency)
- PERCENTAGE: Rates, margins, growth factors
- DATE: Temporal values
- TEXT: Labels, codes (avoid in calculation modules)
- BOOLEAN: Flags, switches (name as questions: "Is Active?", "Has Override?")
- TIME PERIOD: References to time dimensions
- LIST: References to list members

### Summary Methods
- NONE: Default. Use unless aggregation is explicitly needed.
- SUM: Additive values (revenue, headcount, quantities)
- AVERAGE: Rates that should average across time
- OPENING/CLOSING: Balance sheet items
- FORMULA: When parent aggregation needs different logic
- ANY/ALL: Boolean aggregation

**Critical Rule:** Rate-like or percentage-like line items should NEVER use SUM summary. This causes rolled-up values to exceed 100% or produce meaningless totals.

## Formula Best Practices

### Avoid
- Nested IF depth > 3 (use lookup tables instead)
- SUM + LOOKUP in same expression (split into intermediate)
- Hardcoded member names in SELECT (use system module drivers)
- Division without zero-guard (use IF x <> 0)
- Formulas longer than 300 characters (decompose into steps)

### Prefer
- LOOKUP over SELECT for dimension mapping
- Intermediate line items over complex single formulas
- Driver-based formulas over hardcoded values
- COLLECT for cross-dimensional aggregation
- YEARVALUE/MONTHVALUE over string manipulation for time

## Dimensionality

- Apply only the dimensions a line item needs
- Avoid "dense" modules with many large dimensions
- Use subsidiary views to filter large list intersections
- Time dimension: use model calendar unless a line item is genuinely time-independent
