# Anaplan Performance Optimization — Expert Reference

## 1. Model Performance Fundamentals

### The Three Performance Pillars
1. **Cell Count**: Fewer cells = faster calculation, less memory
2. **Formula Complexity**: Simpler, well-structured formulas recalculate faster
3. **Dependency Graph**: Shorter DAG paths = faster cascading recalculation

### Why Anaplan Slows Down
```
Root causes of slow Anaplan models (in order of frequency):
1. Too many cells (over-dimensioning, unnecessary lists on modules)
2. FINDITEM() in large-dimensioned CAL modules
3. Long LOOKUP chains across multiple modules
4. Complex IF-nesting inside SUM/aggregation functions
5. DAG traversal over long formula dependency chains
6. Too many cross-model references
7. Text operations in calculation modules
8. Redundant calculations (same result computed in multiple places)
9. Large numbered list in composite hierarchy without subsets
10. Time dimension too granular (weekly/daily when monthly sufficient)
```

---

## 2. Cell Count Optimization

### Cell Count Formula (Reminder)
```
Cells per line item = Dim1 × Dim2 × ... × Time × Versions
Total model cells = Σ (cells per line item across all line items)
```

### Reduction Strategies

#### 1. Apply Subsets Instead of Full Lists
```
Before: Module applied to all Customers (50,000 items)
        → 50,000 × 24 months × 2 versions × 30 line items = 72,000,000 cells

After: Module applied to Active Customers subset (8,000 items)
       → 8,000 × 24 months × 2 versions × 30 line items = 11,520,000 cells
       → 84% cell reduction
```

#### 2. Summary Method = NONE for Reference Line Items
```
Pattern: Line items that are purely lookup references (not aggregatable)
         e.g., "Product Category" line item that maps from SYS module
Summary Method: Set to NONE
Effect: Parent hierarchy level shows blank (no rollup computed)
        Saves: hierarchy × time × versions × (summary computation cost)
```

#### 3. No Data Format for Non-Data Line Items
```
Section headers, UI spacers, grouping labels
Format: No Data
Effect: Zero cell allocation — these line items consume no memory
```

#### 4. Remove Unnecessary Version Dimension
```
Modules that don't need version comparison: Set version = current only
e.g., SYS Exchange Rates doesn't need Budget/Forecast versions
     DAT actuals staging doesn't need version comparison
Effect: 2-5× cell reduction depending on version count
```

#### 5. Reduce Time Range to Minimum Needed
```
History: Only as many periods as needed for LAG/MOVINGSUM window
         + 1 buffer period (for LAG comparisons)
Forecast: Only as far forward as business actually plans
Wrong: 10 years history + 10 years forecast = 20 years × 12 months = 240 periods
Right: 3 years history + 18 months forecast = 54 periods (78% reduction)
```

#### 6. Separate High-Dimensional Modules
```
Problem: One module with [Products(500) × Customers(5000) × Regions(100)]
         = 250,000,000 cells per line item — catastrophic

Solution:
  Module A: [Products × Regions] — product-level metrics
  Module B: [Customers × Regions] — customer metrics
  Module C: [Customers] — customer-only metrics
  Use LOOKUP to bridge where needed
```

---

## 3. Formula Optimization Patterns

### Pattern 1: SYS Module as Centralized Calculation Cache
```
Anti-pattern: Same LOOKUP formula repeated in 5 different CAL modules
  CAL Revenue: Price × SYS.Cost Rate[LOOKUP: Product Map.Cost Category]
  CAL COGS:    Volume × SYS.Cost Rate[LOOKUP: Product Map.Cost Category]
  CAL Margin:  SYS.Cost Rate[LOOKUP: Product Map.Cost Category] × ...

Optimized pattern:
  SYS Products module: Cost Rate [LOOKUP applied once here]
  CAL Revenue:  Price × SYS Products.Cost Rate
  CAL COGS:     Volume × SYS Products.Cost Rate
→ LOOKUP computed once; downstream modules read pre-resolved value
```

### Pattern 2: Boolean Gate vs COLLECT for Conditional Aggregation
```
For large modules (>1M cells), boolean gate is faster than COLLECT:

Boolean gate pattern (preferred for performance):
  Step 1 (in same or staging module):
    Is Active Product = SYS Products.Active Flag  [Boolean, dimensioned by Products × Time]
  Step 2:
    Active Revenue = IF Is Active Product THEN Revenue ELSE 0  [Numeric]
  Step 3:
    SUM(Active Revenue)  → Total active revenue

COLLECT pattern (acceptable for smaller modules):
  COLLECT(Revenue, SYS Products.Active Flag)

Reason: Boolean gate separates the conditional logic from the aggregation —
        DAG can optimize each step independently
```

### Pattern 3: Avoid TEXT() in Calculation Modules
```
Text operations are expensive: CONCATENATE, TEXT(), UPPER(), LOWER()
Rule: Keep ALL text functions in REP modules only (display layer)
     Never use text functions in CAL modules

Anti-pattern:
  CAL Revenue: Label = Product Name & " - " & Region Name  [in CAL module]

Correct:
  REP Revenue: Label = Product Name & " - " & Region Name  [in REP module only]
```

### Pattern 4: Minimize FINDITEM() Usage in Large Modules
```
FINDITEM() does O(n) text search on list at every cell
In a module with 10M cells, this is catastrophically slow

Anti-pattern:
  CAL: Resolved Product = FINDITEM(Products, DAT.Product Name Text)

Correct approach:
  At import time: Map by Code (not by FINDITEM in model)
  Or: Create a dedicated SYS mapping module with one-time FINDITEM
      SYS Product Name Map: [Products list]
        Lookup Text = Product Name  (input/import target)
      Then in DAT: reference SYS map (much faster — runs once per product, not per transaction)
```

### Pattern 5: Intermediate Line Items for Complex Formulas
```
Anti-pattern (single monster formula):
  Final Result = IF SUM(Revenue × SYS.Rate[LOOKUP: Map.Key]) >
                    LAG(SUM(Revenue × SYS.Rate[LOOKUP: Map.Key]), 12)
                 THEN ... ELSE ...

Optimized (broken into stages):
  Line 1: Adjusted Revenue = Revenue × SYS.Rate[LOOKUP: Map.Key]
  Line 2: Adjusted Revenue Summed = SUM(Adjusted Revenue)
  Line 3: Prior Year Adjusted Revenue = LAG(Adjusted Revenue Summed, 12)
  Line 4: Final Result = IF Adjusted Revenue Summed > Prior Year Adjusted Revenue THEN ...

Benefits:
  - Each line item can be cached independently by DAG
  - Easier debugging (inspect intermediate values)
  - If only one input changes, only affected downstream lines recalculate
```

### Pattern 6: Minimize Cross-Module References in Hot Paths
```
"Hot path" = formula that recalculates on every user input
Cross-module reference = potential performance bottleneck

Rule: Critical-path CAL modules should minimize external module references
      SYS modules are exempt (they're lookup-only, cached)

Anti-pattern (in main CAL module):
  Revenue Tier = CAL SegmentAnalysis.Tier[LOOKUP: ...]  [always recalculates]

Better:
  Cache tier in SYS or staging module; reference cached value
```

---

## 4. Workspace and Model-Level Optimization

### Archived vs Active Models
```
Workspace size = sum of all non-archived models
Archiving a model: Frees workspace capacity; model still accessible but not in active memory
When to archive:
  - Prior fiscal year models (keep for audit; not needed in active workspace)
  - Prototype/POC models (archive after production go-live)
  - Development models when replaced by new DEV iteration
```

### Model Size Audit
```
Check model size:
  Model Settings → Model Information → shows size in bytes/GB

Line item analysis:
  Reports → Line Items → sort by cell count
  → Identify largest line items (candidates for optimization)

Workspace remaining capacity:
  Workspace Admin → shows used vs total workspace allocation
```

### Calculation Priority Settings
```
Model Settings → Calculation Priority
Options: Normal / High (for critical models needing faster calculation)
Note: High priority allocates more computation resources
      Use sparingly — not a substitute for good model design
```

---

## 5. Import Performance Optimization

### Import Speed — Key Factors
| Factor | Fast | Slow |
|---|---|---|
| List item matching | By Code | By Name or Combination |
| File format | CSV (plain) | Excel (.xlsx) |
| File size | <10 MB chunks | Unchunked large files |
| Row count | <100K rows | >1M rows (use chunked upload) |
| Column count | Only needed columns | Wide tables with unused columns |
| Data type parsing | Pre-formatted dates | Text dates needing parsing |

### Chunked File Upload Pattern
```
Files >10 MB: Always use chunked upload via API
Optimal chunk size: 5-10 MB
Pattern:
  Chunk 1: First 5 MB → upload → server confirms
  Chunk 2: Next 5 MB → upload → server confirms
  ...
  Final chunk → upload → POST /files/{id}/complete
  → Trigger import
```

### Delta Import vs Full Reload
```
Full reload: Every row re-imported; slow for large datasets
Delta import: Only changed records since last load
  Requires: Source system provides delta (changed-since timestamp)
  Anaplan side: "Ignore blank cells" = OFF for deltas (to clear old values)
               "Ignore blank cells" = ON for incremental adds (preserve existing)
```

---

## 6. Polaris Engine Performance Advantages

### When Polaris Outperforms Hyperblock
```
Scenario: Supply chain planning
  Products: 100,000 SKUs
  Locations: 5,000 stores
  Time: Daily (365 days)
  Versions: 3

Cell count: 100,000 × 5,000 × 365 × 3 = 547 billion cells
% populated: 2% (most SKU-location combinations have no sales)

Hyperblock: 547B × 8 bytes = 4.4 TB — impossible
Polaris:    547B × 2% × 8 bytes = 87 GB — feasible
→ Polaris is the only viable engine for this use case
```

### Polaris-Specific Optimization Tips
```
1. Embrace sparsity — don't try to make sparse data dense for Polaris
2. Avoid forcing Polaris to simulate dense calculations
3. Use native Polaris aggregation rather than pre-aggregating in staging
4. Large numbered list with composite hierarchy: Polaris handles millions natively
5. Daily time scale: Only practical on Polaris (Hyperblock would explode in memory)
```

---

## 7. Performance Anti-Patterns Reference Card

| Anti-Pattern | Impact | Correct Approach |
|---|---|---|
| Full list on module (only subset needed) | 10-100× cell bloat | Apply subset to module |
| FINDITEM in large CAL module | Calculation timeout | Code-based import matching |
| TEXT/CONCATENATE in CAL module | Memory + speed | Move to REP module |
| Long LOOKUP chain (3+ hops) | Slow recalculation | Intermediate SYS staging |
| SUM(IF ...) in mega-module | Slow aggregation | Boolean gate + separate SUM |
| Unnecessary versions on SYS modules | Cell waste | Remove version dimension |
| 10+ year history in forecast model | Wasted cells + memory | Trim to needed history only |
| No Data line items counted in total | No issue — intentional | Use freely |
| Single module for all calculations | Hard to optimize/debug | Separate by functional area |
| Cross-model LOOKUP in hot path | Slow on every change | Stage in SYS; cache result |
| OFFSET with dynamic line item | Complex DAG path | Prefer LAG with fixed n |
| Duplicate calculations (same formula in 3 modules) | 3× cell cost + maintenance | Calculate once in SYS |

---

## 8. Performance Diagnostic Workflow

### Step 1: Identify the Problem
```
Symptoms:
  - NUX page takes >10 seconds to load
  - Calculation doesn't update after input
  - Import action takes >10 minutes
  - Model size approaching workspace limit

Diagnostic tools:
  - Model → View → Line Items: Sort by cell count → find large line items
  - Model size in Model Information
  - Calculation Status: Shows what's recalculating
```

### Step 2: Analyse Root Cause
```
For slow calculations:
  1. Identify which module/line item is slow
  2. Check: Is it large? (cell count)
  3. Check: Does it have FINDITEM, COLLECT, or complex nested formula?
  4. Check: Does it reference many other modules? (cross-module chain)
  5. Check: Is it dimensioned with unnecessary lists?

For large model size:
  1. Check: Which line items have most cells?
  2. Check: Are all dimensions needed on each module?
  3. Check: Any text line items with large strings?
```

### Step 3: Apply Optimization
```
Priority 1: Reduce cell count (subset, remove dimension, reduce time range)
Priority 2: Simplify formulas (intermediate line items, SYS cache)
Priority 3: Remove text from CAL (move to REP)
Priority 4: Break large modules into focused smaller modules
Priority 5: Convert Hyperblock to Polaris (for sparse high-dimensional models)
```
