# Anaplan Model Design & Planual — Expert Reference

## 1. The Planual — Anaplan's Official Model Building Standard

### What the Planual Is
The Planual (Planning Manual) is Anaplan's official guide to building high-performance, maintainable Anaplan models. It defines structural, naming, and architectural standards that underpin every well-built Anaplan model. All certified Anaplan implementations are expected to follow Planual principles.

### The PLANS Acronym
| Letter | Principle | Core Idea |
|---|---|---|
| **P** | Performance | Models should be built for calculation speed; avoid unnecessary cells, cross-module lookups, and redundant calculations |
| **L** | Layout | Consistent module structure: line items ordered logically, formulas readable, views well-named |
| **A** | Auditability | Any model builder should be able to navigate and understand the model; no black-box formulas |
| **N** | Necessary Data | Only store data that's actually needed; don't bring in data you don't use |
| **S** | Structured | Follow consistent naming, module purpose separation, and hierarchical organization |

---

## 2. Module Naming Conventions — The Full Standard

### Prefix System (DISCO-based)
| Prefix | Full Name | Purpose | Characteristics |
|---|---|---|---|
| **SYS** | System | Configuration, lookup tables, master data attributes, parameters | No user input; calculated or imported once; referenced everywhere |
| **DAT** | Data | Imported raw data staging | No formulas beyond basic cleansing; import targets; source of truth for actuals |
| **INP** | Input | User-entered planning data | Minimal formulas; validation rules; input prompts |
| **CAL** | Calculation | Intermediate and final calculations | Formula-heavy; reads from SYS/DAT/INP; produces CAL results for REP |
| **REP** | Reporting/Output | UX-facing views and export sources | Reads from CAL; formatted for display; no business logic |
| **KPI** | Key Performance Indicators | Summary performance metrics | Subset of REP for executive views; often NUX board cards |
| **MAP** | Mapping | Dimension translation tables | Bridges list dimensions (e.g., Customer → Region mapping) |
| **OPT** | Optimizer | Optimizer inputs/outputs | Used with Anaplan Optimizer module |
| **TMP** | Temporary | Development scaffolding | Should be removed before production |

### Line Item Naming Within Modules
- Use full descriptive names: `Revenue Growth Rate` not `Rev Gr Rate`
- Prefix formulas with verb where helpful: `Calculate...`, `Lookup...`
- Clearly distinguish inputs from calculations: `[Input] Assumed Growth Rate`
- Group related line items together (use No Data spacer line items as section headers)
- Unit context in name where ambiguous: `Revenue ($000s)`, `Headcount (FTEs)`

### List Naming Conventions
| Type | Convention | Example |
|---|---|---|
| Business entity | Singular noun | `Products`, `Customers`, `Employees` |
| Hierarchical list | Singular + hierarchy indicator | `GL Accounts`, `Org Hierarchy` |
| Numbered list | # prefix | `#Employee Positions`, `#Sales Opportunities` |
| Composite child | # prefix + parent context | `#Order Lines` (child of `Orders`) |
| System list | SYS_ prefix for non-business | `SYS_Scenarios`, `SYS_User Roles` |

---

## 3. DISCO Methodology — The Module Design Framework

DISCO is the sequenced data flow methodology for module design. Every line item and module should be classifiable into one of five DISCO phases.

### D — Data
**What**: Raw, imported, unmodified source data
**Modules**: All DAT_ modules
**Characteristics**: No formulas (or very minimal cleansing only); import targets; read-only in UX
**Examples**: `DAT Actuals from SAP`, `DAT CRM Opportunities`, `DAT Headcount from Workday`
**Rule**: Never build calculations on top of DAT modules directly — always stage through SYS first

### I — Input
**What**: User-entered planning assumptions and data
**Modules**: All INP_ modules
**Characteristics**: Input-enabled line items; validation rules; dropdown selectors
**Examples**: `INP Revenue Assumptions`, `INP Headcount Plan`, `INP Capital Requests`
**Rule**: Keep INP modules focused; don't put CAL logic in INP modules

### S — System (SYS)
**What**: Configuration, parameters, lookup tables, master data attributes
**Modules**: All SYS_ modules
**Characteristics**: Calculated or populated once; read by many modules; central reference
**Examples**: `SYS Global Assumptions`, `SYS Exchange Rates`, `SYS Product Attributes`, `SYS Org Mapping`
**Rule**: One SYS module per major list is best practice (SYS_Customers, SYS_Products, etc.)

### C — Calculation
**What**: All computational logic transforming inputs and data into analytical results
**Modules**: All CAL_ modules
**Characteristics**: Formula-heavy; references DAT/INP/SYS; produces outputs for REP
**Examples**: `CAL Revenue`, `CAL P&L`, `CAL Headcount Costs`, `CAL Working Capital`
**Rule**: Break complex calculations into multiple CAL modules — don't create >50 line items in a single CAL module

### O — Output
**What**: Final results formatted for UX display and exports
**Modules**: All REP_ / KPI_ modules
**Characteristics**: Reads from CAL; no business logic; formatted for end users; saved views for NUX
**Examples**: `REP P&L Summary`, `KPI Executive Dashboard`, `REP Sales Pipeline`
**Rule**: Never use REP modules as a data source for other CAL modules (one-way flow only)

---

## 4. Hub-and-Spoke Architecture — Enterprise Standard

### Why Hub-and-Spoke?
In enterprise Anaplan deployments with multiple planning functions (FP&A + Supply Chain + Sales Planning + HR), a single monolithic model becomes:
- Too large to maintain
- Too complex to performance-optimize
- Impossible to give different teams independent release cycles

Hub-and-Spoke solves this.

### Hub Model Responsibilities
The Data Hub model is the centralized source of truth:
- **Master data lists**: All production lists (Customers, Products, Employees, GL Accounts, Cost Centers, Org Hierarchy)
- **Actuals**: ERP/GL actuals imported from SAP/Oracle/NetSuite into DAT modules
- **Reference data**: Exchange rates, calendars, system parameters
- **Integration surface**: All external system connectors write to Hub first

**Hub does NOT contain**: Planning logic, assumptions, forecasts, calculations

### Spoke Model Responsibilities
Each spoke = one planning domain:
- **FP&A Spoke**: P&L planning, budget, forecast, headcount costs
- **Sales Planning Spoke**: Revenue planning, pipeline, quota
- **Supply Chain Spoke**: Demand planning, inventory, S&OP
- **HR/Workforce Spoke**: Headcount planning, compensation

Each spoke:
- **Imports** master data lists from Hub (synchronized via scheduled imports)
- **Imports** actuals from Hub for variance analysis
- **Contains** all planning logic, CAL, INP, and REP modules for its domain
- **Never writes back to Hub** (Hub is read-only source of truth)

### Hub-to-Spoke Data Flow
```
External Systems (SAP, Salesforce, Workday)
         ↓ (API/Integration)
    Data Hub Model
    ├── DAT Actuals (from ERP)
    ├── SYS Master Data Lists
    └── SYS Exchange Rates
         ↓ (Scheduled Imports)
    ┌────┴────┬──────────┬──────────┐
   FP&A    Sales     Supply    HR/WF
   Spoke   Spoke     Spoke     Spoke
```

### Multi-Hub Patterns
**When multiple hubs make sense**:
- Large enterprises with separate legal entities needing data isolation
- Different data refresh cadences (daily transactional hub + monthly actuals hub)
- Regulatory separation requirements (e.g., separate EU data hub for GDPR)

**Single hub preferred** for: most mid-market implementations, unified data governance, simpler maintenance

### Spoke-to-Spoke Data Flows
**Best practice**: Avoid direct spoke-to-spoke data flows
**When unavoidable**: Route through Hub (spoke A → Hub → spoke B)
**Why**: Maintains Hub as single source of truth; prevents complex dependency management

---

## 5. List Design Patterns — Deep Architecture

### Decision Framework: What List Type?

| Situation | Recommended Type |
|---|---|
| Fixed master data, no duplicates, manageable size | Standard flat/hierarchy list |
| High-volume transactional items (millions) | Numbered list (#) |
| Many-to-one relationship (multiple orders per customer) | Composite list |
| Attributes with time or version variation | SYS module line items (not properties) |
| Dynamic filtering for performance | Subset |
| Cross-functional dimension bridging | MAP module + LOOKUP |

### Numbered List Architecture
- Items created with numeric codes, no inherent name
- Display Name is a property on the numbered list
- **Critical**: Display Name property must be List-formatted (pointing to a text interpretation), not Text format
- Use cases: #Employee, #Sales Opportunity, #Project, #Purchase Order Line
- Import: Always import by code (fastest); combine with parent list for composite structure
- Scale: Polaris workspace handles millions of numbered list items efficiently

### Composite List Design
```
Structure:
  Parent List: Customers (500 items)
    └── Child List: #Sales Opportunities (numbered, 50,000 items)

Module dimensioned by: [#Sales Opportunities]
  Properties of #Sales Opportunities:
    - Customer (List: Customers) — parent link
    - Deal Value (Number)
    - Close Date (Date)
    - Stage (List: Deal Stages)

This creates 50,000 addressable opportunities, each linked to one of 500 customers
```

### Subset Best Practices
```
Static subset:    Manually curated, stable set of items
                  Use for: Active products subset (when list rarely changes)

Dynamic subset:   Driven by boolean line item in a SYS module
                  Use for: Frequently changing active/inactive flags, regional subsets by user
                  e.g., SYS Products.Is Active → drives Active Products subset

Performance rule: If only 20% of list members are used in most modules,
                  create a subset and apply subset to modules
                  → reduces cell count by 80%

Caution: Dynamic subsets recalculate when their driving boolean changes
          → don't use for very high-frequency changing data
```

### Hierarchy Depth Guidelines
- Optimal: 3-5 hierarchy levels
- Acceptable: Up to 8 levels (Anaplan hard limit)
- Anti-pattern: Very flat hierarchy (1-2 levels) that could be simple lookups
- Anti-pattern: Very deep hierarchy (>6 levels) causing performance issues on rollup

---

## 6. Module Design Patterns — Expert Architecture

### Single-Purpose Module Principle
Each module should answer ONE business question:
- ✅ `CAL Revenue by Product` — calculates all revenue metrics by product
- ✅ `CAL Headcount Costs` — all people cost calculations
- ❌ `CAL Revenue and Headcount and OpEx` — too broad, hard to debug

### Optimal Module Size
| Dimension | Guideline |
|---|---|
| Line items per module | 20-50 ideal; <100 before splitting |
| Lists applied | Only what's needed; no more |
| Calculation complexity | Any individual formula readable in <2 lines |
| Cross-module references | Minimize; batch similar reads together |

### Module Dependency Chain Management
```
Good pattern (clean DISCO flow):
DAT → SYS → INP → CAL_1 → CAL_2 → REP

Anti-pattern (circular or backward flow):
CAL_2 → reads → INP directly
REP → referenced by → CAL  [OUTPUT feeding CALCULATION is wrong]
SYS → reads → CAL           [CONFIG reading OUTPUTS is wrong]
```

### Boolean Gate Pattern
```
Module: CAL Revenue
Line items:
  Revenue (input or DAT reference)
  Product Is Active (boolean, reads SYS Products.Is Active)
  Active Revenue = IF Product Is Active THEN Revenue ELSE 0

Aggregation on Active Revenue → gives revenue from active products only
This is more performant than COLLECT() for very large modules
```

### Avoiding Over-Dimensioning
Common mistake: Adding list dimensions "for flexibility" that aren't needed
```
Anti-pattern:
  Module CAL Revenue has dimensions [Products × Regions × Customers × Channels × Scenarios]
  But Channel is never used in calculations — it's there "in case"
  → Wasted cells: could be 5× more cells than needed

Rule: Every dimension in a module's Applies To must be actively used
```

---

## 7. Data Architecture Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Mixing INP and CAL in same module | User can accidentally overwrite formula cells | Separate into distinct INP and CAL modules |
| Very long formula chains in one module | Hard to debug, performance risk | Break into intermediate CAL stages |
| REP module as source for CAL | Creates backward data flow | REP should only read from CAL |
| Text LOOKUP (FINDITEM) in large CAL module | Very slow for millions of cells | Use code-based matching at import; resolve to list items in DAT |
| LOOKUP of large flat list without subset | O(n) performance | Use subset or pre-map in SYS |
| Calculated properties on lists | Limited formula support, hard to maintain | Use SYS module instead |
| Deep nested IF in single formula | Unreadable, hard to debug | Break into multiple boolean line items |
| Single massive "Everything" module | Cell explosion, can't optimize sections | Decompose by business area |
| Hub → Spoke direct writes (spoke to hub) | Contaminates source of truth | Spokes read-only from Hub |
| Using versions for what should be list items | Version count explosion | Use custom list for scenario dimension when >5 scenarios |

---

## 8. Version Architecture Patterns

### Standard Version Set Design
```
Typical enterprise version set:
  - Actual (auto-populated from ERP, read-only)
  - Working Forecast (active planning, updated monthly)
  - Budget (annual plan, locked after approval)
  - LY Budget (prior year budget, for comparison)
  - Strategic Plan (long-range 3-5 year, quarterly)
  - Stretch (upside scenario)
  - Conservative (downside scenario)
```

**Rule of thumb**: 3-7 versions is manageable; >10 versions becomes maintenance-heavy

### Rolling Forecast Architecture
```
Switchover advances monthly:
  Jan: Switchover at Dec → 0 actuals, 12 forecast months
  Feb: Switchover at Jan → 1 actual, 11 forecast months
  ...
  Dec: Switchover at Nov → 11 actuals, 1 forecast month

This creates 12-month rolling view always showing actuals-to-date + remaining forecast
```

### Fixed vs Rolling Forecast Decision
| Approach | Description | Best For |
|---|---|---|
| Fixed budget | Annual plan set once; all variance vs this fixed baseline | Traditional P&L, board-approved budgets |
| Rolling forecast | Always 12+ months forward; updates each cycle | Operational forecasting, sales planning |
| Driver-based update | Inputs change monthly; forecasts recalculate automatically | FP&A models with clear drivers |

---

## 9. Time Architecture Design

### Monthly vs Weekly Granularity
| Factor | Monthly | Weekly |
|---|---|---|
| Cell count | Baseline | 4.33× more cells |
| Use case | FP&A, budget, headcount | Retail, supply chain, demand planning |
| ERP alignment | Natural for financial periods | Retail week calendars (4-4-5, 4-5-4) |
| Reporting effort | Standard | Complex period alignment |

**Recommendation**: Monthly unless business process is inherently weekly

### Daily Data Handling
- Daily granularity in Anaplan = massive cell counts
- Best practice: Import daily transaction data into Data Hub, aggregate to weekly/monthly before spoke import
- Exception: Polaris workspaces can handle daily data for demand/supply planning at scale

### Forecast Horizon Design
```
Typical horizons:
  FP&A:           18-24 months forward + 2-3 years history
  Supply Chain:   3-18 months forward + 1-2 years history
  Long-Range Plan: 5-10 years at annual granularity

Model time range = max(history needed for LAG) + max(forecast horizon)
E.g., Need 13 months LAG (prior year comparison) + 18 month forecast = 31 months minimum
```

---

## 10. Model Metadata (SYS.Settings) Pattern

### Global Parameters Module
```
SYS Global Assumptions (no list dimension, no time, no version):
  Tax Rate                = 0.21
  Discount Rate           = 0.10
  Benefits Rate           = 0.18
  Standard Working Days   = 22
  FX Base Currency        = "USD"
```

### Scenario Toggle Architecture
```
SYS Scenario Settings:
  Dimensions: [Scenarios List]
  Line items:
    Revenue Growth Rate   (Number - differs by scenario)
    Cost Inflation Rate   (Number - differs by scenario)
    Headcount Growth      (Number - differs by scenario)

CAL Revenue:
  Active Scenario Rev Growth = Revenue Growth Rate[LOOKUP: SYS User.Selected Scenario]

User selects scenario → all calculations automatically switch
```

### Exchange Rate Module Pattern
```
SYS Exchange Rates:
  Dimensions: [Currencies] × Time
  Line items:
    Spot Rate (end of month)
    Average Rate (month average for P&L)
    Closing Rate (balance sheet rate)

Usage in CAL modules:
  Functional Currency Revenue = Local Currency Revenue ×
    SYS Exchange Rates.Average Rate[LOOKUP: SYS Entities.Reporting Currency]
```

---

## 11. Master Anaplanner Architecture Checklist

### Pre-Build Design Checklist
- [ ] Data model diagram documented (lists, hierarchies, module map)
- [ ] Hub-and-spoke architecture defined (number of models, data flows)
- [ ] List sizes estimated (to project cell count)
- [ ] Cell count estimated per major module
- [ ] Version set agreed with business (no more than necessary)
- [ ] Time range defined (history + forecast horizon)
- [ ] Security model designed (roles, access drivers, selective access scope)
- [ ] Integration points identified (source systems, refresh frequency, method)
- [ ] DISCO applied to all modules (prefix assigned)
- [ ] Module naming convention document shared with team

### Module Quality Review Checklist
- [ ] Module has single, clear purpose (matches prefix)
- [ ] No unnecessary list dimensions on module
- [ ] All line items have correct summary methods (especially FORMULA for non-additive)
- [ ] No circular references
- [ ] CAL logic not embedded in INP module
- [ ] REP module not feeding CAL
- [ ] Formula complexity manageable (readable in under 2 lines each)
- [ ] Boolean gate patterns used for conditional calculations
- [ ] No TEXT() functions in CAL modules (move to REP)

### Performance Review Checklist
- [ ] Estimated total model cell count < workspace limit
- [ ] No FINDITEM() in large-dimensioned CAL modules
- [ ] Subsets used where list is >50% inactive/unused items
- [ ] Summary method = NONE on lookup/reference-only line items
- [ ] No redundant calculations (SYS pattern: calculate once, read many)
- [ ] Module dependency chain is DAG (no circular paths)
- [ ] Long LAG/MOVINGSUM windows evaluated for sparsity impact

### Go-Live Readiness Checklist
- [ ] All modules follow naming convention
- [ ] No TMP_ modules remaining
- [ ] All line items have descriptive names
- [ ] Saved views created for all UX pages
- [ ] Import/export actions tested with production-volume data
- [ ] Process actions complete end-to-end without error
- [ ] User roles configured and tested
- [ ] Selective access validated with test users
- [ ] ALM revision tag created for Production baseline
- [ ] Data reconciliation completed (totals match source system)
- [ ] Performance validated (calculations complete in <30 seconds for real-time pages)
