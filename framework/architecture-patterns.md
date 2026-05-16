# Anaplan Architecture Patterns

## Standard Data Flow

```
Import Sources → Data Hub (DAT) → Calculation (CAL) → Output (REP) → Export/Dashboard
                                        ↑
                              Input (INP) + System (SYS)
```

## Module Layering (PLANS)

| Layer | Purpose | Reads From | Written By |
|-------|---------|------------|------------|
| P - Prep | Data staging, cleansing | External imports | Import actions |
| L - Logic | Business calculations | Prep + Assumptions | Formulas only |
| A - Assumptions | Planning inputs | System config | End users |
| N - Narratives | Output formatting | Logic layer | Formulas only |
| S - System | Configuration | Nothing (leaf) | Admin users |

## Common Architecture Anti-Patterns

### 1. Spaghetti References
- Symptoms: Every module references every other module
- Fix: Introduce hub modules that consolidate cross-functional data

### 2. Fat Data Modules
- Symptoms: DAT modules with 100+ formulas
- Fix: Split into pure-import DAT module + CAL module for transformations

### 3. Output Reading Raw
- Symptoms: REP modules pulling directly from DAT modules
- Fix: Route through CAL layer so business logic is centralized

### 4. Daisy Chains
- Symptoms: A → B → C → D → E where each module only passes data through
- Fix: Flatten to direct references where intermediate adds no logic

### 5. Circular Dependencies
- Symptoms: Module A references Module B which references Module A
- Fix: Extract shared logic into a common calculation module

## Integration Patterns

### Import Design
- One module per data source
- Include "last loaded" timestamp line item
- Validate row counts in a system line item
- Never transform during import — stage raw, calculate separately

### Export Design
- Dedicated output modules (REP/OUT prefix)
- Export views should reference only output modules
- Include "export ready" boolean flag for workflow control

## Scaling Considerations

- Models > 100 modules: Consider model-to-model integration (CloudWorks)
- Lists > 100K members: Use numbered lists, avoid production lists in formulas
- Time periods > 5 years monthly: Archive historical data to separate model
