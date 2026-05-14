# Phase 7: Comprehension & Health Rebuild — Research

**Researched:** 2026-05-14
**Domain:** Anaplan model intelligence — SSE serverless, compact state blob parsing, module classification, dependency graph, dead logic detection, evidence-backed health workstreams
**Confidence:** HIGH (all key findings come from direct codebase reads; no external sources required)

---

## Summary

Phase 7 builds on a fully verified Phase 6 foundation. The model state is already stored as compact tab-separated text in Vercel Blob (`model-state/` prefix). The `api/analyze.js` endpoint still reads the old blueprint JSON format; Phase 7 replaces its analysis path for v3.0 sessions with a new `api/analyze-v3.js` endpoint that consumes the tab-separated state blob directly.

The critical insight from the codebase audit: **`api/analysis-core.js` already contains almost everything Phase 7 needs.** It has `buildDependencyGraph()`, `buildArchitectureClassification()`, `classifyModuleName()`, `classifyModuleBehavior()`, `buildEvidenceWorkstreams()`, `buildEvidenceDiagnostics()`, and `isDecorativeModuleName()`. The gap is (1) a parser for the tab-separated state blob format (analysis-core.js works on normalised blueprint objects, not the serialised text), (2) new SSE event types that the frontend Model tab can consume, and (3) frontend rendering for the Model tab content and rebuilt Health tab (replacing the stub at line 912–917 of index.html).

No external libraries are needed. The stack is vanilla JS + Node.js serverless on Vercel. All intelligence logic can be done deterministically from the already-rich `analysis-core.js` — Claude AI is needed only for the executive summary narrative (Sonnet) and optionally for module classification confidence scoring where prefix is absent (Haiku).

**Primary recommendation:** Write a `parseStateBlob()` function that reconstructs the normalised module array from the tab-separated text, then feed it directly into the existing `analysis-core.js` functions. This eliminates a second Anthropic round-trip for classification, dependency, and dead-logic detection.

---

## Project Constraints (from CLAUDE.md)

- Keep sessions minimal — no auto-load workflows
- Do not use plugins, hooks, MCP tools, or background agents unless explicitly requested
- Avoid recursive audits and large file reads
- Do not spawn agents without asking
- Do not resume old bloated sessions

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COMP-01 | Module classification (SYS/DAT/CAL/REP/INP) with per-module confidence scores | `classifyModuleName()` + `classifyModuleBehavior()` already in analysis-core.js; confidence is derivable deterministically |
| COMP-02 | Dependency graph of cross-module formula references | `buildDependencyGraph()` already in analysis-core.js; just needs parsed blob as input |
| COMP-03 | DISCO architecture map with prefix coverage; unknown-prefix modules flagged | `buildEvidenceDiagnostics()` + `buildArchitectureClassification()` already emit this; needs frontend rendering |
| COMP-04 | Dead logic detection — line items with no downstream formula references | New function needed: scan all CALC rows, build reverse reference index, find unreferenced items |
| COMP-05 | Circular/daisy-chain formula pattern detection | New function: detect A→B→A cycles in dependency edges; daisy-chain = A→B→C where B has no other consumers |
| COMP-06 | Limitation cards when graph/naming evidence insufficient | Evidence gate thresholds already computed in evidencePack; frontend conditional render needed |
| HLTH-01 | Up to 6 workstreams with cited evidence and explicit confidence | `buildEvidenceWorkstreams()` already does this; wire to new endpoint |
| HLTH-02 | Low-confidence architecture findings become limitation workstreams | Already implemented in `buildDiagnosticWorkstreams()` with `kind: 'evidence-limit'` |
| HLTH-03 | "Evidence Limits" section: what Meridian can/cannot say | `buildEvidenceDiagnostics()` returns `usableClaims` and `blockedClaims`; needs frontend rendering |
| HLTH-04 | Executive summary from evidence pack only; no invented findings | `buildExecutiveBrief()` already generates this; validated against real data in analysis-core.js |
</phase_requirements>

---

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Note |
|---------|---------|---------|------|
| `@anthropic-ai/sdk` | existing | Claude API calls | Already used in analyze-narrative.js |
| `@vercel/blob` | existing | Blob fetch for state text | Already wired |
| Vanilla JS SPA | — | Frontend rendering | No framework; index.html is ~4700 lines |
| Vercel serverless functions | — | Node.js ESM endpoint | All api/*.js files already this pattern |

### No new libraries needed
All graph traversal, classification, and workstream logic is already in `api/analysis-core.js`. Dead logic detection and circular detection can be implemented as pure JS functions in the same file.

### Claude models in use
| Task | Model | Why |
|------|-------|-----|
| Executive summary narrative (HLTH-04) | `claude-sonnet-4-6` | Already established in analyze-narrative.js |
| Module classification for unknown-prefix modules (optional confidence boost) | `claude-haiku-4-5` or omit | Haiku is fast and cheap; but deterministic classification is sufficient for COMP-01 without it |
| Pattern detection bulk pass | Not needed | All detectable patterns (dead logic, cycles, anti-patterns) can be computed deterministically from formula text |

**Recommendation:** Do NOT use Haiku for pattern detection. All required patterns (dead logic, circular references, daisy-chain) are computable deterministically from the formula reference graph already built by `buildDependencyGraph()`. Reserve Haiku budget for Phase 8 (Chat). The executive narrative is the only AI call needed in Phase 7.

---

## Architecture Patterns

### State Blob Parsing (Research Question 1)

The serialised format from `serializeModelState()` in `api/model-state.js` is:

```
MODULE\t{id}\t{name}\t{prefix}
CALC\t{name}\t{format}\t{summary}\t{formula}
INPUT\t{name}\t{format}\t{summary}\t
ITEM\t{name}\t{format}\t{summary}\t
[blank line]
MODULE\t...
```

**Parsing approach — server-side in `api/analyze-v3.js`:**

```javascript
// [VERIFIED: api/model-state.js serializeModelState() lines 61-100]
function parseStateBlob(text) {
  const modules = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line) { current = null; continue; }
    const parts = line.split('\t');
    if (parts[0] === 'MODULE') {
      current = { id: parts[1], name: parts[2], prefix: parts[3] || '', lineItems: [] };
      modules.push(current);
    } else if (current && (parts[0] === 'CALC' || parts[0] === 'INPUT' || parts[0] === 'ITEM')) {
      current.lineItems.push({
        name: parts[1] || '',
        formatType: parts[2] || '',
        summaryMethod: parts[3] || '',
        formula: parts[4] || '',          // empty string for INPUT/ITEM rows
        hasFormula: parts[0] === 'CALC' && (parts[4] || '').length > 0,
        isInput: parts[0] === 'INPUT',
      });
    }
  }
  return modules; // array compatible with analysis-core.js normalised shape
}
```

This produces the same module+lineItem array shape that `normalizeBlueprint()` produces, so all downstream `analysis-core.js` functions accept it directly.

**Key compatibility note:** `analysis-core.js` functions access `li.hasFormula`, `li.formula`, `li.formatType`, `li.summaryMethod`. The parser above maps these directly. Functions that access `li.dimensions`, `li.dimensionCount`, `li.ifDepth`, `li.hasSumLookup`, `li.hasHardcodedSelect`, `li.hasUnguardedDivision` need to be added to the parser using the existing helper functions already exported from `analysis-core.js` (`countIfDepth`, `hasSumLookup`, `hasHardcodedSelect`, `hasUnguardedDivision`).

### Module Classification (Research Question 2)

**Use deterministic regex — no Claude needed for COMP-01.**

`analysis-core.js` already has two classification functions:

1. `classifyModuleName(moduleName)` — regex on prefix → returns `'data'|'system'|'calculation'|'planning'|'output'|'unknown'`
2. `classifyModuleBehavior(module)` — line item ratio analysis → returns `'data'|'calculation'|'mixed'|'system'`

**Mapping to COMP-01's required labels (SYS/DAT/CAL/REP/INP):**

| `classifyModuleName()` output | DISCO label | DISCO prefixes |
|-------------------------------|-------------|----------------|
| `system` | SYS | SYS, MAP, LIS |
| `data` | DAT | DAT, DATA, HUB, SRC |
| `calculation` | CAL | CAL, CALC, FIN, REV, COGS, MTH, EXP |
| `planning` | INP | INP, INPUT, ASS, DRV, PLN |
| `output` | REP | REP, OUT, KPI, SOP, IBP, DASH |
| `unknown` | UNKNOWN | anything else |

**Confidence score derivation (COMP-01):**

```javascript
function moduleConfidence(module) {
  const nameBased = classifyModuleName(module.name) !== 'unknown'; // prefix recognised
  const behaviorMatch = classifyModuleName(module.name) !== 'unknown' &&
    classifyModuleName(module.name) !== 'mixed';
  const declared = classifyModuleName(module.name);
  const inferred = classifyModuleBehavior(module).behavior;
  const mismatch = declared !== 'unknown' && inferred !== 'mixed' && declared !== inferred;
  if (!nameBased) return { score: 0.40, label: 'Low', reason: 'No DISCO prefix recognised' };
  if (mismatch) return { score: 0.60, label: 'Medium', reason: 'Prefix and behaviour disagree' };
  return { score: 0.90, label: 'High', reason: 'Prefix matches observed behaviour' };
}
```

**No Claude call needed for classification.** The deterministic approach covers COMP-01 fully.

### Dependency Graph (Research Question 4)

**`buildDependencyGraph(normalized)` in `analysis-core.js` (lines 543–572) already does this.** It:
- Creates nodes from all modules
- Scans every CALC line item's formula for `{ModuleName}.` pattern matches
- Builds directed edges `{fromModuleId, fromModuleName, toModuleId, toModuleName, lineItems[]}`

**The blob-parsed module array is compatible input.** The only shape requirement is `{ id, name, lineItems: [{ formula }] }`.

**What `computeDependencyEdges()` in model-state.js does differently:** It counts unique cross-module edges for the evidence pack density gate, using `{ModuleName}` substring matching (without the `.` suffix). `buildDependencyGraph()` in analysis-core.js uses `{ModuleName}.` (with dot), which is more precise (avoids false positives where one module name is a substring of another). **Use `buildDependencyGraph()` for Phase 7** — it produces the full edge structure needed for the frontend.

### Dead Logic Detection (COMP-04)

No existing function — must be added to `analysis-core.js`:

```javascript
// [ASSUMED pattern — derived from dependency graph structure]
export function detectDeadLogic(modules, graph) {
  // Build reverse reference index: which line items are referenced in other modules' formulas?
  const referencedNames = new Set();
  for (const mod of modules) {
    for (const li of mod.lineItems) {
      if (!li.formula) continue;
      // Any "{ModuleName}.{ItemName}" pattern means ItemName is referenced
      const matches = li.formula.matchAll(/\b\w[\w\s]*\.\s*([A-Za-z][\w\s]*)/g);
      for (const m of matches) {
        referencedNames.add(m[1].trim());
      }
    }
  }
  const dead = [];
  for (const mod of modules) {
    for (const li of mod.lineItems) {
      if (!li.hasFormula) continue; // only CALC items — inputs are always "live" (user-entered)
      if (!referencedNames.has(li.name)) {
        dead.push({ moduleId: mod.id, moduleName: mod.name, lineItemName: li.name, formula: li.formula });
      }
    }
  }
  return dead;
}
```

**Important caveat:** Formula text is truncated to 150 chars in `serializeModelState()`. This means some references in long formulas will be missed. The dead logic detector must report confidence as MEDIUM and note this limitation. Line items with truncated formulas (formula ends with `…`) should be excluded from dead-logic flagging.

### Circular / Daisy-Chain Detection (COMP-05)

```javascript
// [ASSUMED pattern — standard graph cycle detection]
export function detectCircularDependencies(graph) {
  // Build adjacency map from edges (module-level, not line-item-level)
  const adj = new Map();
  for (const edge of graph.edges) {
    if (!adj.has(edge.fromModuleId)) adj.set(edge.fromModuleId, new Set());
    adj.get(edge.fromModuleId).add(edge.toModuleId);
  }
  const cycles = [];
  const visited = new Set();
  const stack = new Set();

  function dfs(node, path) {
    if (stack.has(node)) {
      const idx = path.indexOf(node);
      cycles.push(path.slice(idx));
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    stack.add(node);
    path.push(node);
    for (const neighbour of (adj.get(node) || [])) {
      dfs(neighbour, path);
    }
    path.pop();
    stack.delete(node);
  }

  for (const nodeId of adj.keys()) dfs(nodeId, []);
  return cycles; // array of module-ID cycles
}

// Daisy-chain: A→B→C where B has exactly one consumer and one producer
export function detectDaisyChains(graph, threshold = 3) {
  const inDegree = new Map();
  const outDegree = new Map();
  for (const edge of graph.edges) {
    outDegree.set(edge.fromModuleId, (outDegree.get(edge.fromModuleId) || 0) + 1);
    inDegree.set(edge.toModuleId, (inDegree.get(edge.toModuleId) || 0) + 1);
  }
  // A passthrough module: in=1, out=1 — part of a chain
  const passthrough = [...inDegree.keys()].filter(id =>
    inDegree.get(id) === 1 && (outDegree.get(id) || 0) === 1
  );
  return passthrough; // module IDs that are single-path passthrough nodes
}
```

### Claude Prompt Structure (Research Question 3)

**Only one AI prompt is needed for Phase 7:** the executive summary (HLTH-04).

The current `buildExecutiveBrief()` in analysis-core.js already generates a text-based executive summary deterministically. The AI upgrade is optional — use it only if the deterministic version looks too formulaic in UAT. The pattern from `analyze-narrative.js` applies:

```javascript
// Pattern from analyze-narrative.js lines 12, 63-66
// [VERIFIED: api/analyze-narrative.js]
const SONNET_MODEL = 'claude-sonnet-4-6';

// Prompt caching: put the state blob in the system prompt with cache_control
// so repeated analysis of the same model doesn't re-tokenize it
const messages = [{
  role: 'user',
  content: [{
    type: 'text',
    text: stateText,
    cache_control: { type: 'ephemeral' }  // Anthropic prompt caching
  }, {
    type: 'text',
    text: synthesisPrompt
  }]
}];
```

**Prompt structure for health workstream synthesis (HLTH-01, HLTH-04):**

```
SYSTEM: You are a senior Anaplan model reviewer. Respond with valid JSON only.

USER (cached): [full state blob text, ~45K tokens]

USER (not cached):
Given this evidence pack:
- Module count: N, Line items: M
- Workstreams found: [list titles and evidence counts]
- Dependency graph: [edge count, density]
- Evidence limits: [blocked conclusions from evidencePack]

Write an executive summary in 3–5 sentences covering:
1. What was analysed (scope facts only — no speculation)
2. What the evidence shows (cite workstream names and evidence counts)
3. What cannot be said yet (cite blocked conclusions verbatim)

Return JSON: { "summary": "<text>", "confidence": "High|Medium|Low" }
```

### SSE Event Schema for analyze-v3.js (Research Question 5)

Based on the existing frontend event handler pattern at `index.html` lines 5141–5152:

```javascript
// Events the frontend already handles:
// 'progress', 'extraction-done', 'suggestions', 'intelligence',
// 'deterministic-scan', 'score', 'complete', 'error', 'cache-hit'

// New events for Phase 7 — additions only, no removals:
{ type: 'stage', stage: 'parsing', label: 'Parsing model state…' }
{ type: 'stage', stage: 'classifying', label: 'Classifying modules…' }
{ type: 'stage', stage: 'graph', label: 'Building dependency graph…' }
{ type: 'stage', stage: 'dead-logic', label: 'Detecting dead logic…' }
{ type: 'stage', stage: 'health', label: 'Building health workstreams…' }
{ type: 'stage', stage: 'narrative', label: 'Generating executive summary…' }

// Model tab payload (one event after classification + graph complete)
{
  type: 'model-comprehension',
  modules: [{ moduleId, moduleName, prefix, discoLabel, confidence, formulaCount, inputCount }],
  graph: { nodes: [...], edges: [...] },   // from buildDependencyGraph()
  deadLogic: [{ moduleId, moduleName, lineItemName }],
  cycles: [[moduleId, moduleId, ...]],     // circular dependency chains
  daisyChains: [moduleId, ...],           // passthrough module IDs
  discoMap: {                              // prefix → count
    SYS: N, DAT: N, CAL: N, REP: N, INP: N, UNKNOWN: N
  },
  limitationCards: ['...text if gate failed...']  // from evidencePack.blockedConclusions
}

// Health tab payload (replaces old 'intelligence' event structure)
{
  type: 'health-workstreams',
  workstreams: [...],      // from buildEvidenceWorkstreams() — max 6
  assessment: { verdict, summary, confidence, posture },
  evidenceLimits: {
    canSay: [...],         // from buildEvidenceDiagnostics().usableClaims
    cannotSay: [...],      // from buildEvidenceDiagnostics().blockedClaims
  }
}

// Final complete event (same shape as existing, with v3 flag)
{
  type: 'complete',
  version: 'v3',
  moduleCount: N,
  lineItemCount: N,
  workstreamCount: N,
  deadLogicCount: N,
  cycleCount: N
}
```

### Limitation Cards (Research Question 6)

**Gate thresholds are already computed in evidencePack (Phase 6 output).**

```javascript
// evidencePack from sessionStorage (verified: index.html line 4122)
const evidencePack = JSON.parse(sessionStorage.getItem('meridian.evidencePack') || '{}');

// Four gates, each with a threshold:
// fetchCompleteness: 0.95  → if below: suppress architecture claims
// formulaCoverage:  0.50  → if below: suppress formula anti-patterns + dependency graph
// graphDensity:     0.30  → if below: suppress cross-module dependency diagram
// namingCoverage:   0.60  → if below: suppress DISCO map + prefix classification

// Frontend logic for Model tab:
function shouldShowDependencyDiagram(evidencePack) {
  return evidencePack.graphDensity >= evidencePack.thresholds.graphDensity;
}
function shouldShowDiscoMap(evidencePack) {
  return evidencePack.namingCoverage >= evidencePack.thresholds.namingCoverage;
}
```

**Limitation card HTML pattern (to introduce in Model tab):**

```html
<div class="limitation-card">
  <strong>Limitation</strong>
  <p>{blockedConclusion text verbatim from evidencePack}</p>
</div>
```

### Single vs Split Endpoint (Research Question 7)

**Use a single `api/analyze-v3.js` endpoint.** Rationale:

1. The 60-second budget is sufficient. All Phase 7 computation is deterministic except the optional Sonnet narrative call. Parsing + classification + graph + dead logic + workstreams on a 228-module model will complete in under 5 seconds based on the O(n²) graph scan in `computeDependencyEdges()` which already runs in model-state.js under the 60s limit.

2. The frontend already handles a single SSE stream and dispatches event types. Adding new event types (`model-comprehension`, `health-workstreams`) to the existing switch statement is cleaner than coordinating two streams.

3. Splitting would require the frontend to manage two AbortControllers and two timing windows — unnecessary complexity.

4. The existing `api/analyze.js` continues to serve v2.0 paths (blueprintBlobUrl). `analyze-v3.js` is the new endpoint for stateUrl paths only.

**Frontend routing logic:**

```javascript
// In index.html initDashboard():
const blobUrl = localStorage.getItem('meridian.stateUrl') || localStorage.getItem('meridian.blueprintBlobUrl');
const endpoint = localStorage.getItem('meridian.stateUrl') ? '/api/analyze-v3' : '/api/analyze';
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Module dependency graph | Custom graph library | `buildDependencyGraph()` in analysis-core.js | Already built, tested, handles edge deduplication |
| Architecture classification | Claude prompt | `classifyModuleName()` + `classifyModuleBehavior()` | Deterministic, free, covers all DISCO prefixes |
| Evidence workstream generation | New workstream logic | `buildEvidenceWorkstreams()` in analysis-core.js | Fully implemented with evidence gating, confidence scoring, kind='evidence-limit' |
| Evidence diagnostics | New gate logic | `buildEvidenceDiagnostics()` in analysis-core.js | Returns `usableClaims`, `blockedClaims`, `visualizations`, `gates` |
| Executive brief | Custom template | `buildExecutiveBrief()` in analysis-core.js (or Sonnet) | Already generates evidence-validated prose |
| SSE streaming | Custom protocol | Existing `sendEvent()` pattern in all api/*.js files | Established pattern: `res.write('data: ...\n\n'); res.flush()` |
| State blob fetch + SSRF guard | New fetch utility | `isAllowedBlobUrl()` in analyze.js | Already implemented, must be reused |

**Key insight:** The analysis-core.js file is the project's intelligence engine. Phase 7 is primarily about (a) writing a state blob parser so the engine has input, (b) adding dead-logic and cycle detection as new pure functions, and (c) wiring the engine output to new frontend event types and UI.

---

## Common Pitfalls

### Pitfall 1: Re-implementing what analysis-core.js already has
**What goes wrong:** Writing new classification or workstream logic in analyze-v3.js instead of importing from analysis-core.js — leading to divergence and doubled maintenance surface.
**Why it happens:** The researcher doesn't read analysis-core.js in full before designing.
**How to avoid:** Always `import { buildDependencyGraph, buildArchitectureClassification, buildEvidenceWorkstreams, buildEvidenceDiagnostics, buildEvidenceBackedIntelligence } from './analysis-core.js'` in analyze-v3.js.
**Warning signs:** Any new function in analyze-v3.js that looks like it classifies modules or builds workstreams.

### Pitfall 2: State blob shape mismatch with analysis-core.js
**What goes wrong:** The `parseStateBlob()` parser returns objects that are missing fields that `analysis-core.js` functions assume (`li.hasSumLookup`, `li.ifDepth`, `li.dimensions`, etc.).
**Why it happens:** The serialised format in `serializeModelState()` only stores name/format/summary/formula — not pre-computed derived fields.
**How to avoid:** After parsing each line item, apply the existing helper functions:
- `countIfDepth(formula)` → `ifDepth`
- `hasSumLookup(formula)` → `hasSumLookup`
- `hasHardcodedSelect(formula)` → `hasHardcodedSelect`
- `hasUnguardedDivision(formula)` → `hasUnguardedDivision`
- Set `dimensions: []`, `dimensionCount: 0` (not in blob — dimension data is not serialised)
**Warning signs:** TypeError when passing parsed modules to `scanDeterministicFindings()`.

### Pitfall 3: Formula truncation causes false dead-logic positives
**What goes wrong:** Line items whose formulas are truncated to 150 chars (ending with `…`) appear dead because the truncated formula doesn't contain the full module reference.
**Why it happens:** `FORMULA_TRUNCATE_LEN = 150` in model-state.js.
**How to avoid:** In `detectDeadLogic()`, exclude line items where `formula.endsWith('…')` or `formula.endsWith('...')` from the dead-logic candidate list.
**Warning signs:** Large numbers of CALC items flagged as dead in formula-heavy models.

### Pitfall 4: v2.0 path broken when adding v3 endpoint routing
**What goes wrong:** The frontend routing logic in `initDashboard()` incorrectly routes v2.0 sessions (blueprintBlobUrl) to analyze-v3 which expects tab-separated text but receives JSON.
**Why it happens:** `localStorage.getItem('meridian.stateUrl')` returns `null` when the old blueprintBlobUrl key is set — but if the routing check is `||` instead of explicit null-check, it can fall through incorrectly.
**How to avoid:** Route on presence of `meridian.stateUrl` key specifically:
```javascript
const stateUrl = localStorage.getItem('meridian.stateUrl');
const endpoint = stateUrl ? '/api/analyze-v3' : '/api/analyze';
const blobUrl = stateUrl || localStorage.getItem('meridian.blueprintBlobUrl');
```
**Warning signs:** v2.0 sessions throw "Blueprint missing modules array" from analyze-v3.

### Pitfall 5: SSE headers must be set before first await
**What goes wrong:** Vercel proxy buffers the response if headers aren't flushed before the first async operation, causing the UI to appear frozen.
**Why it happens:** Node.js response headers are sent on first write; if you await first, the connection may be committed differently.
**How to avoid:** Mirror the existing pattern — set all SSE headers and call `res.flushHeaders()` as the very first action in the handler, before any `await`. All api/*.js files already follow this pattern.
**Warning signs:** Frontend progress events arrive all at once at the end instead of streaming.

### Pitfall 6: Model tab rendered before model-comprehension event arrives
**What goes wrong:** User clicks Model tab immediately after landing on dashboard; tab is empty because `model-comprehension` event hasn't arrived yet.
**Why it happens:** `activateTab('model')` is called on the `complete` SSE event from model-state.js, which is Phase 6's endpoint — not analyze-v3.js's endpoint.
**How to avoid:** The Model tab should render a loading state until the `model-comprehension` event arrives. Alternatively, trigger analyze-v3 automatically on dashboard init when `meridian.stateUrl` is present, and show a skeleton loader in the Model tab.
**Warning signs:** Model tab shows empty or stub content even after analysis completes.

---

## Code Examples

### Wiring parseStateBlob into buildDependencyGraph
```javascript
// In api/analyze-v3.js
// [VERIFIED: analysis-core.js exports buildDependencyGraph; model-state.js serializeModelState() format]
import {
  buildDependencyGraph,
  buildArchitectureClassification,
  buildEvidenceBackedIntelligence,
  scanDeterministicFindings,
  scanArchitectureFindings,
  isAllowedBlobUrl,
  countIfDepth,
  hasSumLookup,
  hasHardcodedSelect,
  hasUnguardedDivision,
} from './analysis-core.js';

async function fetchStateBlob(stateUrl) {
  const r = await fetch(stateUrl);
  if (!r.ok) throw new Error(`State blob fetch failed: ${r.status}`);
  return r.text();
}

// Returns shape compatible with analysis-core.js normalized modules
function parseStateBlob(text) {
  const modules = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line) { current = null; continue; }
    const parts = line.split('\t');
    const rowType = parts[0];
    if (rowType === 'MODULE') {
      current = { id: parts[1] || '', name: parts[2] || '', prefix: parts[3] || '', lineItems: [] };
      modules.push(current);
    } else if (current && (rowType === 'CALC' || rowType === 'INPUT' || rowType === 'ITEM')) {
      const name = parts[1] || '';
      const formatType = parts[2] || '';
      const summaryMethod = parts[3] || '';
      const formula = parts[4] || '';
      const truncated = formula.endsWith('…');
      current.lineItems.push({
        id: '',          // not serialised
        name,
        formatType,
        summaryMethod,
        formula,
        hasFormula: rowType === 'CALC' && formula.length > 0,
        isInput: rowType === 'INPUT',
        formulaTruncated: truncated,
        dimensions: [],  // not serialised — set empty
        dimensionCount: 0,
        notes: '',
        formulaLength: formula.length,
        ifDepth: countIfDepth(formula),
        hasSumLookup: hasSumLookup(formula),
        hasHardcodedSelect: hasHardcodedSelect(formula),
        hasUnguardedDivision: hasUnguardedDivision(formula),
      });
    }
  }
  return modules;
}

// Reconstruct normalized shape expected by analysis-core.js functions
function toNormalized(modules) {
  return {
    modelId: '',
    workspaceId: '',
    partialLoad: false,
    rawModuleCount: modules.length,
    excludedModules: [],
    modules: modules.map(m => ({
      ...m,
      lineItemCount: m.lineItems.length,
      dimensions: [],
      dimensionCount: 0,
    })),
  };
}
```

### Prompt caching pattern (from analyze-narrative.js)
```javascript
// [VERIFIED: api/analyze-narrative.js — Anthropic prompt caching]
// Put the state blob in a cached message block to avoid re-tokenizing on each call
const client = new Anthropic();
const response = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  system: 'You are a senior Anaplan model reviewer. Respond with valid JSON only.',
  messages: [{
    role: 'user',
    content: [
      {
        type: 'text',
        text: stateText,
        cache_control: { type: 'ephemeral' }
      },
      {
        type: 'text',
        text: synthesisPrompt
      }
    ]
  }]
});
```

### SSRF guard (reuse existing)
```javascript
// [VERIFIED: api/analyze.js isAllowedBlobUrl()]
import { isAllowedBlobUrl } from './analyze.js';
// Use at top of handler before any fetch():
if (!isAllowedBlobUrl(stateUrl)) {
  return res.status(400).json({ error: 'Invalid stateUrl — must be a Vercel Blob URL' });
}
```

---

## State of the Art

| Old Approach | Current Approach | Impact for Phase 7 |
|--------------|------------------|-------------------|
| Per-module API batching (Phase 1–5) | Single model-level lineItems call (Phase 6) | State blob is now a reliable, consistent input |
| Blueprint JSON format (v2.0) | Tab-separated text blob (v3.0) | Must write `parseStateBlob()` — no legacy parser exists |
| `api/analyze.js` consumes blueprint JSON | `api/analyze-v3.js` consumes state blob text | New endpoint needed; old endpoint kept for v2.0 backward compat |
| Analysis-core.js was written for blueprint JSON | Analysis-core.js functions accept normalized object shape | Parser output must match that normalized shape exactly |
| Model tab was a stub ("ships in next update") | Phase 7 fills the Model tab fully | Frontend requires new rendering functions and HTML structure |
| Health tab shows deterministic workstreams | Health tab rebuilt with evidence pack gates + limitation workstreams | `buildEvidenceWorkstreams()` already handles this — just needs wiring |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Dead logic detection via reverse reference index from formula text is sufficient — no additional API needed | Dead Logic Detection | Formula truncation (150 chars) means some references are missed; output must be qualified as MEDIUM confidence |
| A2 | Daisy-chain detection via in/out degree = 1 is a useful signal for the builder | Circular/Daisy-Chain Detection | May produce noise if many valid passthrough modules exist; should be presented as "candidate patterns for review" not definitive findings |
| A3 | No Claude call is needed for module classification — deterministic regex is sufficient for COMP-01 | Module Classification | If the model uses non-standard prefixes throughout, confidence scores will all be LOW and the DISCO map will show mostly UNKNOWN — which is correct and handled by limitation cards |
| A4 | A single analyze-v3.js endpoint stays within 60s on models up to ~300 modules | Single vs Split Endpoint | Larger models could time out; monitoring needed; splitting endpoint is the fallback |
| A5 | `li.dimensions` being empty (not serialised) does not break `scanDeterministicFindings()` | Pitfall 2 | `MODULE_TOO_MANY_DIMS` rule uses `module.dimensionCount` which would be 0 — that rule would never fire from blob-parsed data. Acceptable for Phase 7 since dimension data is not in the blob. |

---

## Open Questions

1. **Does analyze-v3.js also need to replace analyze.js's caching logic?**
   - What we know: analyze.js uses a SHA-256 hash of the blueprint JSON for cache keys (7-day TTL in Vercel Blob)
   - What's unclear: Should analyze-v3.js use the stateUrl as the cache key, or hash the state blob content?
   - Recommendation: Hash the first 10KB of state blob content for the cache key (fast, stable, doesn't require storing the full blob twice)

2. **Should the Model tab auto-trigger analyze-v3 on dashboard load, or wait for a user action?**
   - What we know: Phase 6 wires `activateTab('model')` immediately after fetch; the Model tab is the landing tab
   - What's unclear: If analysis takes 3–8 seconds, the Model tab will show a blank/loading state immediately on landing
   - Recommendation: Auto-trigger analyze-v3 on dashboard init (same pattern as the existing analyze call at line 5099), showing a progress bar in the Model tab panel

3. **What HTML structure for the dependency graph in the Model tab?**
   - What we know: The project uses vanilla JS with no charting library; graphs would need SVG or a library
   - What's unclear: Whether to use a lightweight library (e.g., d3-force, cytoscape) or render as a structured list
   - Recommendation: For Phase 7, render the dependency graph as a sortable table of edges (source → target, line items count). Full SVG graph rendering is a Phase 7 stretch goal or deferred to Phase 8. This avoids adding a large charting dependency to a vanilla JS SPA.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — all required tools are already in the project)

---

## Validation Architecture

Step 4: SKIPPED — `workflow.nyquist_validation` is explicitly `false` in `.planning/config.json`.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Not adding auth paths |
| V3 Session Management | No | SessionStorage use is read-only in this phase |
| V4 Access Control | No | Endpoint accepts stateUrl — same SSRF guard applies |
| V5 Input Validation | Yes | `isAllowedBlobUrl()` already enforces Vercel Blob domain allowlist |
| V6 Cryptography | No | Not adding crypto; existing SHA-256 cache key reused |

### Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SSRF via stateUrl parameter | Tampering | Reuse `isAllowedBlobUrl()` from analyze.js — already verifies `*.public.blob.vercel-storage.com` |
| Credentials in SSE events | Information Disclosure | `safeLog()` from model-state.js pattern; no credentials flow through analyze-v3.js |
| Malformed tab-separated blob | Tampering/DoS | `parseStateBlob()` uses defensive `parts[N] || ''` access; never throws on malformed input |
| Formula regex DoS | DoS | `buildDependencyGraph()` already uses `.includes()` not regex; dead-logic detection uses `matchAll` which can be slow on very long formulas — cap formula scan length at 500 chars |

---

## Sources

### Primary (HIGH confidence — direct codebase reads)
- `api/model-state.js` lines 61–100: `serializeModelState()` — exact blob format
- `api/model-state.js` lines 108–135: `computeDependencyEdges()` — edge counting approach
- `api/model-state.js` lines 145–190: `computeEvidencePack()` — gate thresholds and blocked conclusions
- `api/analysis-core.js` lines 543–572: `buildDependencyGraph()` — full edge builder
- `api/analysis-core.js` lines 653–760: `buildArchitectureClassification()` — module classification
- `api/analysis-core.js` lines 596–603: `classifyModuleName()` — DISCO prefix mapping
- `api/analysis-core.js` lines 1063–1138: `buildEvidenceDiagnostics()` — gate-to-visualization mapping
- `api/analysis-core.js` lines 1279–1382: `buildEvidenceWorkstreams()` — full workstream builder
- `api/analysis-core.js` lines 1460–1508: `buildEvidenceBackedIntelligence()` — top-level orchestrator
- `api/analyze-narrative.js` lines 1–15: Claude model version (`claude-sonnet-4-6`), caching pattern
- `api/analyze.js` lines 31–41: `isAllowedBlobUrl()` — SSRF guard to reuse
- `index.html` lines 898–917: Tab bar structure and Model tab stub
- `index.html` lines 5087–5105: Dashboard init routing (stateUrl vs blueprintBlobUrl)
- `index.html` lines 5141–5152: SSE event dispatcher — all currently handled event types
- `.planning/phases/06-model-state-foundation/VERIFICATION.md`: Phase 6 delivery confirmation
- `vercel.json` lines 16–22: `maxDuration: 60` for all api/* endpoints

### Secondary (MEDIUM confidence)
- None required — all research findings came from the codebase directly

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified from package usage in existing endpoints
- Architecture patterns: HIGH — all functions verified in analysis-core.js source
- Pitfalls: HIGH — derived from direct code inspection of shape mismatches and format assumptions
- Dead logic / cycle detection: MEDIUM — algorithms are standard but the formula truncation limitation creates known gaps

**Research date:** 2026-05-14
**Valid until:** 2026-06-14 (stable codebase; no external dependencies to drift)
