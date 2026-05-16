# Anaplan Formula Library

## Safe Patterns

### Guarded Division
```
IF denominator <> 0 THEN numerator / denominator ELSE 0
```

### Lookup with Fallback
```
IF ISBLANK(target.line_item[LOOKUP: mapping]) THEN default_value ELSE target.line_item[LOOKUP: mapping]
```

### Time-Safe Accumulation
```
IF ISBLANK(PREVIOUS(Balance)) THEN Opening Balance ELSE PREVIOUS(Balance) + Net Change
```

### Conditional Aggregation
```
SUM(Line Item[SELECT: list_member.Boolean Flag = TRUE])
```

### Period Offset
```
OFFSET(Revenue, -1, 0)  -- prior period
OFFSET(Revenue, -12, 0) -- prior year same period (monthly model)
```

## Anti-Patterns to Detect

### Nested IF (depth > 3)
```
-- BAD:
IF x THEN IF y THEN IF z THEN a ELSE b ELSE c ELSE d

-- GOOD: Use lookup table
Classification[LOOKUP: driver_list]
```

### SUM + LOOKUP Combined
```
-- BAD: Recalculates on every intersection
SUM(Source[LOOKUP: mapping_list].Value)

-- GOOD: Split into two steps
Step 1: Mapped Value = Source[LOOKUP: mapping_list].Value
Step 2: Total = SUM(Mapped Value)
```

### Hardcoded SELECT
```
-- BAD: Breaks on rename
Revenue[SELECT: Products.'Widget A']

-- GOOD: System module driver
Revenue[SELECT: Products.SYS01.Target Product]
```

### Unguarded Division
```
-- BAD: Returns error on zero
Margin = Profit / Revenue

-- GOOD:
Margin = IF Revenue <> 0 THEN Profit / Revenue ELSE 0
```

## Performance-Critical Patterns

### COLLECT vs SUM
- Use COLLECT when aggregating across a list dimension
- Use SUM for simple additive aggregation within same dimensionality

### LOOKUP Chain Length
- Max recommended: 2 LOOKUPs in a single formula
- Beyond 2: Create intermediate line items

### FINDITEM Performance
- Avoid in calculated line items (recalculates every cell)
- Prefer list-formatted line items with direct member references

## Time Intelligence

### YTD Accumulation
```
IF INPERIOD(Current Period, CURRENTPERIODSTART('FY'), CURRENTPERIODEND('FY'))
THEN CUMULATE(Monthly Value)
ELSE 0
```

### Rolling 12-Month
```
SUM(OFFSET(Monthly Value, -11, 0), 12)
```

### Variance Analysis
```
Variance = Actual - Plan
Variance % = IF Plan <> 0 THEN (Actual - Plan) / ABS(Plan) ELSE 0
```
