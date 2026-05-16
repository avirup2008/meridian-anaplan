# DISCO Module Naming Convention

## Prefixes

| Prefix | Role | Description |
|--------|------|-------------|
| SYS | System | Configuration, settings, time management, version control |
| DAT | Data | Raw data imports, staging, data hub modules |
| INP | Input | User-facing input modules for planning assumptions |
| CAL | Calculation | Business logic, transformations, intermediate calcs |
| REP | Report/Output | Output modules for dashboards, exports, reporting |
| MAP | Mapping | Cross-dimensional mapping modules |
| TMP | Temporary | Temporary calculation modules (should be minimized) |

## Naming Pattern

`PREFIX## - Descriptive Name`

Examples:
- `SYS01 - Time Settings`
- `DAT03 - Revenue Data Hub`
- `INP02 - Headcount Assumptions`
- `CAL05 - Margin Calculation`
- `REP01 - Board Pack Output`

## Architecture Flow

```
SYS (config) → DAT (raw data) → CAL (logic) → REP (output)
                    ↑                ↑
                  INP (user)       MAP (mapping)
```

## Rules

- Each module should have ONE clear responsibility
- Data modules should NOT contain formulas (only imports)
- Calculation modules should NOT store input values
- Output/Report modules should only read from calculation modules, never from data modules directly
- System modules provide configuration consumed by all layers
