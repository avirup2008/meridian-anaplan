# Anaplan Build Sequences

## Standard Module Build Order

1. **System modules first** — Time settings, version config, global parameters
2. **Lists and hierarchies** — Dimension structure before any data
3. **Data hub modules** — Import staging (no formulas)
4. **Input modules** — User assumption entry points
5. **Calculation modules** — Business logic (formula-only)
6. **Output modules** — Reporting and export views
7. **Integration modules** — Export actions, CloudWorks connections

## New Capability Build Checklist

### 1. Define Scope
- What business question does this answer?
- What dimensions are needed? (existing lists vs new lists)
- What time granularity? (monthly, weekly, daily)
- What's the data source? (import, user input, calculated)

### 2. Design Lists
- Identify required list dimensions
- Check if existing lists can be reused
- Define hierarchy levels if needed
- Plan list member maintenance (manual vs import)

### 3. Design Modules
For each module:
- Assign DISCO prefix and number
- Define applies-to dimensions
- List all line items with: name, format, summary method
- Write formulas referencing only upstream modules
- Verify no circular dependencies

### 4. Build Sequence
```
Lists → SYS → DAT → INP → CAL → REP → Actions → Dashboards
```

### 5. Validation Steps
- Zero-state test: Does the model calculate without data?
- Single-row test: Does one import row flow correctly?
- Full-load test: Does production data volume perform acceptably?
- Edge-case test: Zeros, blanks, negative values, missing members

## Common Build Specs

### Headcount Planning
```
Lists: Department, Position, Employee (optional)
Modules:
  DAT01 - HC Data Hub (imports from HRIS)
  INP01 - HC Assumptions (salary bands, benefits %)
  CAL01 - HC Calculation (FTE cost, burden rate)
  CAL02 - HC Forecast (attrition, hiring plan)
  REP01 - HC Summary (by department, by month)
```

### Revenue Planning
```
Lists: Product, Customer Segment, Region
Modules:
  DAT01 - Revenue Actuals (imports from ERP)
  INP01 - Revenue Drivers (growth rates, price changes)
  CAL01 - Revenue Baseline (trend, seasonality)
  CAL02 - Revenue Forecast (driver-based projection)
  CAL03 - Revenue Variance (actual vs plan)
  REP01 - Revenue Dashboard (segment × region × time)
```

### Expense Planning
```
Lists: Cost Center, GL Account, Vendor (optional)
Modules:
  DAT01 - Expense Actuals (imports from GL)
  INP01 - Expense Assumptions (inflation, vendor rates)
  CAL01 - Expense Allocation (driver-based cost split)
  CAL02 - Expense Forecast (baseline + adjustments)
  REP01 - Expense Summary (by cost center, by account)
```
