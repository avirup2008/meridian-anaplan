# Intelligence Engine v2 — Implementation Spec

## Architecture Overview

The intelligence engine is a deterministic knowledge graph built from the full formula corpus. AI is a thin optional narration layer. The graph persists and powers dashboard, chatbot, and workflow features.

```
Anaplan MCP/API (full blueprint fetch)
        │
        ▼
┌─────────────────────────────────────┐
│  model-state.js (enriched blob)     │
│  - Full formula text (no truncation)│
│  - Dimensions per line item         │
│  - List member names (top dims)     │
└───────────────┬─────────────────────┘
                │ state blob (Vercel Blob)
                ▼
┌─────────────────────────────────────┐
│  intelligence-engine.js (NEW)       │
│                                     │
│  1. Formula Parser                  │
│  2. Line-Item Graph Builder         │
│  3. Graph Algorithms                │
│  4. Risk Analyzer                   │
│  5. Module Intelligence Generator   │
│  6. Template Renderer               │
└───────────────┬─────────────────────┘
                │ IntelligenceGraph (Vercel Blob)
                ▼
┌─────────────────────────────────────┐
│  analyze-v3.js (orchestrator)       │
│  - Streams SSE events               │
│  - Optional AI narration (last)     │
│  - Stores graph for chatbot/wf      │
└─────────────────────────────────────┘
```

---

## Part 1: State Blob Enrichment

### Changes to model-state.js

**Remove formula truncation:**
```
// DELETE: const FORMULA_TRUNCATE_LEN = 600;
// Store full formula text — the intelligence engine needs complete references
```

**Add dimensions to row format:**
```
Current:  CALC\t{name}\t{format}\t{summary}\t{formula}
New:      CALC\t{name}\t{format}\t{summary}\t{dims}\t{formula}

Where {dims} = pipe-separated dimension names:
  PR09 - Components|WA01 - Warehouses|SC02 - Scenarios
```

**Add list members section (top 20 dimensions by reference count):**
```
LISTMEMBERS\t{listName}\t{member1}|{member2}|{member3}|...
```

This enables hardcoded-reference validation without additional API calls during analysis.

### Blob format v2

```
LIST\t{name}\t{itemCount}
LISTMEMBERS\t{name}\t{member1}|{member2}|...
VERSION\t{name}
IMPORT\t{name}
EXPORT\t{name}
PROCESS\t{name}

MODULE\t{id}\t{name}\t{prefix}
CALC\t{name}\t{format}\t{summary}\t{dims}\t{formula}
INPUT\t{name}\t{format}\t{summary}\t{dims}\t
ITEM\t{name}\t{format}\t{summary}\t{dims}\t
```

### Additional fetch in model-state.js

After fetching line items, for each dimension that appears in >5 modules (top 20 dims max):
```javascript
const memberResults = await Promise.allSettled(
  topDimensions.map(dim =>
    fetch(`/lineItems/${anyLineItemId}/dimensions/${dim.id}/items?limit=200`)
  )
);
```

This adds ~2-3 seconds to the fetch but provides the full list member vocabulary for validation.

---

## Part 2: Formula Parser

### File: `api/formula-parser.js`

Extracts structured references from Anaplan formula text.

### Reference Types

| Type | Pattern | Example |
|------|---------|---------|
| Cross-module | `'Module Name'.'Item Name'` or `'Module Name'.ItemName` | `'SUP02 - Supply Chain Parameters'.F Leadtime` |
| Intra-module | Bare name matching known siblings | `Total deliveries`, `MOQ`, `Batch Size` |
| Dimensional op | `[SUM: ...]` or `[LOOKUP: ...]` | `[SUM: 'SYS04'.Warehouse List, LOOKUP: Settings.Actuals]` |
| Temporal | `PREVIOUS()`, `NEXT()`, `OFFSET()` | `PREVIOUS(Projected Inventory)` |
| List member | `'List'.MemberName` inside conditional | `ITEM('SC02') = 'SC02'.Consensus supply high demand` |
| Time ref | `ITEM(Time)` | `IF ITEM(Time) >= 'MOD01'.Current Period` |

### Parser Output per Line Item

```javascript
{
  lineItemId: string,
  lineItemName: string,
  moduleId: string,

  // Extracted references
  crossModuleRefs: [
    { moduleName: string, itemName: string, context: 'direct'|'conditional'|'aggregation'|'temporal' }
  ],
  intraModuleRefs: [
    { itemName: string, context: 'direct'|'conditional'|'temporal' }
  ],
  dimensionalOps: [
    { type: 'SUM'|'LOOKUP', targetModule: string, targetItem: string }
  ],
  temporalOps: [
    { type: 'PREVIOUS'|'NEXT'|'OFFSET', targetItem: string, offset?: number }
  ],
  literalValues: [
    { value: string, listName?: string, validated?: boolean }
  ],

  // Computed attributes
  isSelfReferencing: boolean,  // uses PREVIOUS/NEXT on itself
  isAccumulation: boolean,     // PREVIOUS(self) pattern
  hasConditionals: boolean,
  conditionalBranches: number,
  hasHardcodedMembers: boolean,
  referencedModuleCount: number,
  referencedItemCount: number,
}
```

### Cross-Module Reference Extraction

```javascript
// Pattern: 'Module Name'.'Item Name' or 'Module Name'.ItemName
const CROSS_MODULE_QUOTED = /'([^']+)'\.('([^']+)'|([A-Za-z][\w\s]*))/g;

function extractCrossModuleRefs(formula, knownModuleNames) {
  const refs = [];
  // Strategy 1: quoted module pattern
  for (const match of formula.matchAll(CROSS_MODULE_QUOTED)) {
    const moduleName = match[1];
    const itemName = match[3] || match[4]?.trim();
    if (knownModuleNames.has(moduleName) && itemName) {
      refs.push({ moduleName, itemName, context: classifyContext(formula, match.index) });
    }
  }
  // Strategy 2: unquoted module.item (rare but possible for no-space names)
  for (const modName of knownModuleNames) {
    if (modName.includes(' ')) continue; // skip names with spaces (would be quoted)
    const pattern = new RegExp(`\\b${escapeRegex(modName)}\\.([A-Za-z][\\w ]*?)(?=[\\s,\\]\\)\\+\\-\\*\\/]|$)`, 'g');
    for (const match of formula.matchAll(pattern)) {
      refs.push({ moduleName: modName, itemName: match[1].trim(), context: classifyContext(formula, match.index) });
    }
  }
  return refs;
}
```

### Intra-Module Reference Extraction

```javascript
function extractIntraModuleRefs(formula, siblingNames, selfName) {
  const refs = [];
  // Sort by length descending to match longest names first (avoids partial matches)
  const sorted = [...siblingNames].filter(n => n !== selfName).sort((a, b) => b.length - a.length);

  // Remove all cross-module references first (so we don't false-match inside them)
  let cleaned = formula.replace(/'[^']+'\.'[^']+'/g, '⌀')
                       .replace(/'[^']+'\.[A-Za-z][\w\s]*/g, '⌀');
  // Remove string literals
  cleaned = cleaned.replace(/"[^"]*"/g, '⌀');
  // Remove function names (so "MAX" doesn't match a line item named "MAX")
  cleaned = cleaned.replace(/\b(IF|THEN|ELSE|AND|OR|NOT|MAX|MIN|SUM|ROUND|ABS|YEARVALUE|MONTHVALUE|PREVIOUS|NEXT|OFFSET|ITEM|LOOKUP|SELECT|FINDITEM|ISBLANK|ISERROR|LENGTH|TRIM|TEXT|VALUE|MOD|POWER|LOG|EXP|SQRT)\b/gi, '⌀');

  for (const name of sorted) {
    // Match the exact name with word boundaries
    // Handle quoted names: 'Name With Specials'
    const quotedPattern = `'${escapeRegex(name)}'`;
    const barePattern = name.includes("'") || /[^A-Za-z0-9\s]/.test(name.replace(/[?%]/g, ''))
      ? null  // names with special chars must be quoted in formulas
      : `\\b${escapeRegex(name)}\\b`;

    if (cleaned.includes(quotedPattern) || (barePattern && new RegExp(barePattern).test(cleaned))) {
      refs.push({ itemName: name, context: classifyContext(formula, formula.indexOf(name)) });
      // Blank out matched name to prevent sub-matches
      cleaned = cleaned.replace(new RegExp(escapeRegex(name), 'g'), '⌀'.repeat(name.length));
    }
  }
  return refs;
}
```

### Dimensional Operation Extraction

```javascript
function extractDimensionalOps(formula) {
  const ops = [];
  // Match [SUM: ...] and [LOOKUP: ...] clauses
  const BRACKET_CLAUSE = /\[(SUM|LOOKUP):\s*([^\],]+)/g;
  for (const match of formula.matchAll(BRACKET_CLAUSE)) {
    const type = match[1];
    const target = match[2].trim();
    // Target can be 'Module'.Item or just a dimension name
    const modItemMatch = target.match(/^'([^']+)'\.(.+)$/);
    if (modItemMatch) {
      ops.push({ type, targetModule: modItemMatch[1], targetItem: modItemMatch[2].trim() });
    } else {
      ops.push({ type, targetModule: null, targetItem: target });
    }
  }
  return ops;
}
```

### Temporal Operation Extraction

```javascript
function extractTemporalOps(formula, selfName) {
  const ops = [];
  const TEMPORAL = /\b(PREVIOUS|NEXT)\(\s*(?:'([^']+)'|([A-Za-z][\w\s?%]*))/g;
  for (const match of formula.matchAll(TEMPORAL)) {
    const type = match[1];
    const target = (match[2] || match[3])?.trim();
    ops.push({ type, targetItem: target, isSelfRef: target === selfName });
  }
  const OFFSET = /\bOFFSET\(\s*(?:'([^']+)'\.)?'?([^',]+)'?\s*,\s*(-?\d+)/g;
  for (const match of formula.matchAll(OFFSET)) {
    ops.push({ type: 'OFFSET', targetModule: match[1] || null, targetItem: match[2].trim(), offset: parseInt(match[3]) });
  }
  return ops;
}
```

### Literal Value Extraction

```javascript
function extractLiterals(formula, knownListMembers) {
  const literals = [];
  // Pattern: ITEM('ListName') = 'ListName'.MemberName
  const MEMBER_CMP = /ITEM\(\s*'([^']+)'\s*\)\s*=\s*'([^']+)'\.([A-Za-z][\w\s]*)/g;
  for (const match of formula.matchAll(MEMBER_CMP)) {
    const listName = match[1];
    const memberName = match[3].trim();
    const validated = knownListMembers.get(listName)?.includes(memberName) ?? null;
    literals.push({ value: memberName, listName, validated });
  }
  // Also catch [SELECT: 'List'.'Member'] hardcoded selects
  const SELECT_MEMBER = /\[SELECT:\s*'([^']+)'\.(?:'([^']+)'|([A-Za-z][\w\s]*))/g;
  for (const match of formula.matchAll(SELECT_MEMBER)) {
    const listName = match[1];
    const memberName = (match[2] || match[3])?.trim();
    if (memberName) {
      const validated = knownListMembers.get(listName)?.includes(memberName) ?? null;
      literals.push({ value: memberName, listName, validated });
    }
  }
  return literals;
}
```

### Context Classification

```javascript
function classifyContext(formula, refIndex) {
  // Look backwards from reference to determine context
  const before = formula.slice(Math.max(0, refIndex - 40), refIndex);
  if (/\b(IF|AND|OR)\b/i.test(before)) return 'conditional';
  if (/\b(PREVIOUS|NEXT|OFFSET)\s*\(\s*$/i.test(before)) return 'temporal';
  if (/\[\s*(SUM|LOOKUP)\s*:/i.test(before)) return 'aggregation';
  return 'direct';
}
```

---

## Part 3: Line-Item Graph Builder

### File: `api/graph-builder.js`

Constructs the IntelligenceGraph from parsed formulas.

### Graph Structure

```javascript
{
  nodes: Map<lineItemId, {
    id: string,
    name: string,
    moduleId: string,
    moduleName: string,
    format: string,
    summary: string,
    dimensions: string[],
    hasFormula: boolean,
    isInput: boolean,
    isSelfReferencing: boolean,
    isAccumulation: boolean,
    hasHardcodedMembers: boolean,
    formulaLength: number,
    conditionalBranches: number,
  }>,

  edges: [
    {
      from: { moduleId, moduleName, itemId, itemName },
      to: { moduleId, moduleName, itemId, itemName },
      type: 'direct' | 'conditional' | 'aggregation' | 'temporal',
      dimensionalOp: null | { type: 'SUM'|'LOOKUP', dimension: string },
    }
  ],

  // Module-level summary (derived from line-item graph)
  modules: Map<moduleId, {
    id: string,
    name: string,
    prefix: string,
    dimensions: string[],        // union of all line item dimensions
    lineItemCount: number,
    formulaCount: number,
    inputCount: number,
    inboundEdges: number,        // edges INTO this module from other modules
    outboundEdges: number,       // edges FROM this module to other modules
    internalEdges: number,       // intra-module edges
    upstreamModules: string[],   // modules this depends on
    downstreamModules: string[], // modules that depend on this
    role: 'source' | 'sink' | 'transformer' | 'hub' | 'isolated',
    grain: string,               // primary dimensional grain (e.g., "Component × Warehouse")
  }>,
}
```

### Build Process

```javascript
export function buildLineItemGraph(modules, parsedFormulas) {
  const graph = { nodes: new Map(), edges: [], modules: new Map() };

  // Step 1: Create all nodes
  for (const mod of modules) {
    for (const li of mod.lineItems) {
      graph.nodes.set(li.id, {
        id: li.id,
        name: li.name,
        moduleId: mod.id,
        moduleName: mod.name,
        format: li.format,
        summary: li.summary,
        dimensions: li.dimensions,
        hasFormula: li.hasFormula,
        isInput: li.isInput,
        ...parsedFormulas.get(li.id)?.attributes,
      });
    }
  }

  // Step 2: Create edges from parsed references
  for (const [liId, parsed] of parsedFormulas) {
    const sourceNode = graph.nodes.get(liId);
    if (!sourceNode) continue;

    // Cross-module edges
    for (const ref of parsed.crossModuleRefs) {
      const targetNode = findNode(graph, ref.moduleName, ref.itemName);
      if (targetNode) {
        graph.edges.push({
          from: { moduleId: targetNode.moduleId, moduleName: targetNode.moduleName, itemId: targetNode.id, itemName: targetNode.name },
          to: { moduleId: sourceNode.moduleId, moduleName: sourceNode.moduleName, itemId: sourceNode.id, itemName: sourceNode.name },
          type: ref.context,
          dimensionalOp: findDimOp(parsed.dimensionalOps, ref.moduleName, ref.itemName),
        });
      }
    }

    // Intra-module edges
    for (const ref of parsed.intraModuleRefs) {
      const targetNode = findNodeInModule(graph, sourceNode.moduleId, ref.itemName);
      if (targetNode) {
        graph.edges.push({
          from: { moduleId: targetNode.moduleId, moduleName: targetNode.moduleName, itemId: targetNode.id, itemName: targetNode.name },
          to: { moduleId: sourceNode.moduleId, moduleName: sourceNode.moduleName, itemId: sourceNode.id, itemName: sourceNode.name },
          type: ref.context,
          dimensionalOp: null,
        });
      }
    }
  }

  // Step 3: Compute module summaries
  computeModuleSummaries(graph);

  return graph;
}
```

---

## Part 4: Graph Algorithms

### File: `api/graph-algorithms.js`

Pure functions operating on the IntelligenceGraph.

### 4.1 Calculation Chain Tracer

Traces complete paths from source inputs to output sinks.

```javascript
export function traceCalculationChains(graph, { maxDepth = 30, minLength = 3 } = {}) {
  const chains = [];
  // Start from source nodes (inputs with no inbound edges)
  const sources = [...graph.nodes.values()].filter(n =>
    n.isInput && !graph.edges.some(e => e.to.itemId === n.id)
  );
  // Trace forward from each source using DFS
  for (const source of sources) {
    dfsForward(graph, source, [], chains, maxDepth);
  }
  // Filter to chains that reach output modules and meet minimum length
  return chains
    .filter(c => c.length >= minLength && isOutputModule(c[c.length - 1].moduleName))
    .sort((a, b) => b.length - a.length);
}
```

### 4.2 Bottleneck Detection

Items with highest combined fan-in + fan-out.

```javascript
export function findBottlenecks(graph, { topN = 20 } = {}) {
  const fanOut = new Map();  // how many items depend on this
  const fanIn = new Map();   // how many items this depends on
  for (const edge of graph.edges) {
    fanOut.set(edge.from.itemId, (fanOut.get(edge.from.itemId) || 0) + 1);
    fanIn.set(edge.to.itemId, (fanIn.get(edge.to.itemId) || 0) + 1);
  }
  return [...graph.nodes.values()]
    .map(n => ({
      ...n,
      fanOut: fanOut.get(n.id) || 0,
      fanIn: fanIn.get(n.id) || 0,
      totalConnections: (fanOut.get(n.id) || 0) + (fanIn.get(n.id) || 0),
    }))
    .sort((a, b) => b.fanOut - a.fanOut)
    .slice(0, topN);
}
```

### 4.3 Impact Propagation

For a given item, compute everything downstream that would be affected.

```javascript
export function computeImpactScope(graph, itemId) {
  const affected = new Set();
  const affectedModules = new Set();
  const queue = [itemId];
  while (queue.length) {
    const current = queue.shift();
    const downstream = graph.edges
      .filter(e => e.from.itemId === current)
      .map(e => e.to.itemId);
    for (const next of downstream) {
      if (!affected.has(next)) {
        affected.add(next);
        affectedModules.add(graph.nodes.get(next)?.moduleId);
        queue.push(next);
      }
    }
  }
  const outputModules = [...affectedModules].filter(id =>
    /^(REP|OUT|KPI|SOP|IBP)/.test(graph.modules.get(id)?.name || '')
  );
  return {
    affectedItemCount: affected.size,
    affectedModuleCount: affectedModules.size,
    affectedOutputCount: outputModules.length,
    outputModuleNames: outputModules.map(id => graph.modules.get(id)?.name),
    affectedItems: [...affected].map(id => graph.nodes.get(id)),
  };
}
```

### 4.4 Risk Clustering

Groups items that would break together (shared fragility).

```javascript
export function buildRiskClusters(graph, findings) {
  const clusters = [];

  // Cluster 1: Hardcoded member references (items that break on same rename)
  const byLiteral = new Map();
  for (const node of graph.nodes.values()) {
    if (node.hasHardcodedMembers) {
      for (const lit of node.literals || []) {
        const key = `${lit.listName}::${lit.value}`;
        if (!byLiteral.has(key)) byLiteral.set(key, []);
        byLiteral.get(key).push(node);
      }
    }
  }
  for (const [key, nodes] of byLiteral) {
    if (nodes.length >= 2) {
      const [listName, memberName] = key.split('::');
      clusters.push({
        type: 'fragility',
        trigger: `Rename of '${memberName}' in list '${listName}'`,
        affectedItems: nodes,
        affectedModules: [...new Set(nodes.map(n => n.moduleName))],
        severity: nodes.length >= 5 ? 'Critical' : nodes.length >= 3 ? 'High' : 'Medium',
      });
    }
  }

  // Cluster 2: Dependency chains with multiple findings
  // (modules connected by edges that both have critical/high findings)
  const modulesWithFindings = new Set(findings.filter(f => f.severity === 'critical').map(f => f.moduleId));
  for (const mod of graph.modules.values()) {
    if (!modulesWithFindings.has(mod.id)) continue;
    const chain = traceModuleChain(graph, mod.id, modulesWithFindings);
    if (chain.length >= 2) {
      clusters.push({
        type: 'cascading-risk',
        trigger: `Findings in connected modules propagate downstream`,
        affectedItems: chain.flatMap(m => getModuleItems(graph, m)),
        affectedModules: chain.map(id => graph.modules.get(id)?.name),
        severity: 'Critical',
      });
    }
  }

  return clusters.sort((a, b) =>
    severityRank(a.severity) - severityRank(b.severity) || b.affectedItems.length - a.affectedItems.length
  );
}
```

### 4.5 Remediation Sequencing

Topological sort of items that need fixing, respecting dependencies.

```javascript
export function computeRemediationOrder(graph, targetItems) {
  // Build subgraph of only the items we need to fix
  const subgraph = targetItems.map(id => graph.nodes.get(id)).filter(Boolean);
  const subEdges = graph.edges.filter(e =>
    targetItems.includes(e.from.itemId) && targetItems.includes(e.to.itemId)
  );

  // Topological sort — fix upstream items first
  const sorted = topologicalSort(subgraph, subEdges);

  // Group into parallel-safe batches
  const batches = [];
  const completed = new Set();
  for (const item of sorted) {
    const deps = subEdges.filter(e => e.to.itemId === item.id).map(e => e.from.itemId);
    const batch = batches.find(b =>
      !b.some(bItem => deps.includes(bItem.id)) && // no dependency within batch
      deps.every(d => completed.has(d) || !targetItems.includes(d)) // all deps in prior batches
    );
    if (batch) batch.push(item);
    else batches.push([item]);
    completed.add(item.id);
  }

  return batches.map((items, i) => ({
    step: i + 1,
    parallel: items.length > 1,
    items: items.map(item => ({
      moduleId: item.moduleId,
      moduleName: item.moduleName,
      itemName: item.name,
      finding: item.finding,
    })),
  }));
}
```

### 4.6 Business Pattern Detection

Identifies standard Anaplan calculation patterns from formula structure.

```javascript
export function detectBusinessPatterns(graph) {
  const patterns = [];

  for (const node of graph.nodes.values()) {
    if (!node.hasFormula) continue;
    const inbound = graph.edges.filter(e => e.to.itemId === node.id);

    // Driver-based planning: A * B = C (two direct inputs multiplied)
    if (inbound.length === 2 && inbound.every(e => e.type === 'direct') && isMultiply(node)) {
      patterns.push({ type: 'driver-multiplication', node, inputs: inbound.map(e => e.from) });
    }

    // Accumulation: PREVIOUS(self) + delta
    if (node.isAccumulation) {
      patterns.push({ type: 'accumulation', node, description: 'Running total / inventory balance' });
    }

    // Variance: A - B pattern where A and B come from different versions
    if (inbound.length === 2 && isSubtraction(node)) {
      patterns.push({ type: 'variance', node, inputs: inbound.map(e => e.from) });
    }

    // Aggregation: reads from finer grain via SUM
    const sumOps = inbound.filter(e => e.dimensionalOp?.type === 'SUM');
    if (sumOps.length > 0) {
      patterns.push({ type: 'aggregation', node, sources: sumOps.map(e => e.from), dimensions: sumOps.map(e => e.dimensionalOp.dimension) });
    }

    // Higher-of demand: MAX(orders, forecast)
    if (inbound.length >= 2 && isMaxFunction(node)) {
      patterns.push({ type: 'higher-of', node, inputs: inbound.map(e => e.from) });
    }

    // Override pattern: IF override THEN adjusted ELSE calculated
    if (node.conditionalBranches >= 1 && hasOverridePattern(node)) {
      patterns.push({ type: 'manual-override', node });
    }
  }

  return patterns;
}
```

---

## Part 5: Module Intelligence Generator

### File: `api/module-intelligence.js`

Synthesizes graph data into per-module intelligence cards.

### Module Role Classification

```javascript
function classifyModuleRole(mod, graph) {
  if (mod.inboundEdges === 0 && mod.outboundEdges > 0) return 'source';
  if (mod.outboundEdges === 0 && mod.inboundEdges > 0) return 'sink';
  if (mod.inboundEdges > 5 && mod.outboundEdges > 5) return 'hub';
  if (mod.inboundEdges > 0 && mod.outboundEdges > 0) return 'transformer';
  return 'isolated';
}
```

### Module Purpose Inference

```javascript
function inferModulePurpose(mod, graph) {
  const prefix = mod.prefix;
  const role = mod.role;
  const primaryDims = mod.dimensions.slice(0, 2).join(' x ');
  const upstreamNames = mod.upstreamModules.slice(0, 3).join(', ');
  const downstreamNames = mod.downstreamModules.slice(0, 3).join(', ');
  const patterns = graph.patterns?.filter(p => p.node.moduleId === mod.id) || [];
  const dominantPattern = patterns[0]?.type;

  // Template-based purpose generation
  if (role === 'source' && mod.inputCount > mod.formulaCount) {
    return `Stores ${formatDescription(mod)} inputs. ${mod.outboundEdges} calculations read from here.`;
  }
  if (role === 'hub') {
    return `Core calculation module — reads from ${upstreamNames} and feeds ${downstreamNames}. Operates at ${primaryDims} grain.`;
  }
  if (role === 'sink' && /^(REP|OUT|KPI)/.test(mod.name)) {
    return `Reporting output. Aggregates results from ${upstreamNames} for stakeholder consumption.`;
  }
  if (dominantPattern === 'accumulation') {
    return `Computes running balances over time at ${primaryDims} grain. Uses temporal accumulation (PREVIOUS).`;
  }
  if (dominantPattern === 'higher-of') {
    return `Demand resolution — picks the higher of multiple demand signals (orders vs forecast).`;
  }
  if (prefix === 'SYS' || prefix === 'MOD') {
    return `System configuration / settings. Referenced by ${mod.outboundEdges} downstream calculations.`;
  }
  return `Transforms data from ${upstreamNames || 'inputs'} at ${primaryDims || 'model'} grain.`;
}
```

### Criticality Scoring

```javascript
function computeCriticality(mod, graph, findings) {
  const modFindings = findings.filter(f => f.moduleId === mod.id);
  const criticalCount = modFindings.filter(f => f.severity === 'critical').length;
  const highCount = modFindings.filter(f => f.severity === 'warning').length;

  // Blast radius: total downstream items (recursive)
  const downstreamScope = computeModuleImpact(graph, mod.id);

  // Criticality = findings severity * blast radius * role importance
  const roleMultiplier = mod.role === 'hub' ? 2.0 : mod.role === 'source' ? 1.5 : mod.role === 'sink' ? 0.8 : 1.0;
  const score = (criticalCount * 4 + highCount * 2) * (1 + downstreamScope.affectedOutputCount * 0.5) * roleMultiplier;

  if (score >= 12 || (criticalCount > 0 && downstreamScope.affectedOutputCount > 0)) return 'Critical';
  if (score >= 6 || criticalCount > 0) return 'High';
  if (score >= 2 || highCount > 0) return 'Medium';
  if (modFindings.length > 0) return 'Low';
  return 'None';
}
```

### Issue Template Rendering

For each finding in a module, render human-readable root cause + impact + fix:

```javascript
const ISSUE_TEMPLATES = {
  FORMULA_SELECT_HARDCODED: (finding, graph) => {
    const literal = finding.extractedLiteral || 'a list member';
    const downstream = computeImpactScope(graph, finding.lineItemId);
    return {
      issue: `${finding.lineItemName} hardcodes the member name '${literal}'`,
      danger: `If '${literal}' is renamed, this formula silently returns zero${downstream.affectedOutputCount ? ` — and ${downstream.outputModuleNames.join(', ')} show wrong numbers` : ''}`,
      fix: `Replace the hardcoded name with a system module lookup or driver list reference`,
    };
  },

  FORMULA_DIVISION_UNGUARDED: (finding, graph) => {
    const denominator = finding.extractedDenominator || 'a value';
    const downstream = computeImpactScope(graph, finding.lineItemId);
    return {
      issue: `${finding.lineItemName} divides by ${denominator} without checking for zero`,
      danger: `When ${denominator} has no data (new period, new product), this errors${downstream.affectedOutputCount ? ` — propagating to ${downstream.outputModuleNames.join(', ')}` : ''}`,
      fix: `Add IF ${denominator} <> 0 guard, or create a safe-denominator intermediate`,
    };
  },

  FORMULA_NESTED_IF: (finding, graph) => ({
    issue: `${finding.lineItemName} uses ${finding.ifDepth} levels of nested IF logic`,
    danger: `The deepest branches cannot be isolated or tested — edge-case inputs silently return wrong values`,
    fix: `Extract conditions into a driver/mapping module and resolve with LOOKUP (reduces depth to 1-2)`,
  }),

  RATE_SUMMARY_SUM: (finding, graph) => ({
    issue: `${finding.lineItemName} is a percentage/rate but uses SUM to aggregate`,
    danger: `Parent-level totals are mathematically wrong — you cannot sum percentages`,
    fix: `Set summary to NONE, or recalculate from summed numerator and denominator at each level`,
  }),

  ARCH_OUTPUT_READS_RAW_LAYER: (finding, graph) => ({
    issue: `Reads directly from ${finding.relatedModuleName} (data layer) without going through calculations`,
    danger: `This report shows raw input data — business rules and calculations are bypassed`,
    fix: `Route through the calculation layer so all business logic is applied before reporting`,
  }),

  // ... templates for all finding types
};

function renderIssue(finding, graph) {
  const template = ISSUE_TEMPLATES[finding.ruleId];
  if (!template) return { issue: finding.title, danger: finding.evidence, fix: finding.action };
  return template(finding, graph);
}
```

### Module Intelligence Card Assembly

```javascript
export function buildModuleIntelligence(modules, graph, findings) {
  const cards = [];

  for (const mod of graph.modules.values()) {
    const criticality = computeCriticality(mod, graph, findings);
    if (criticality === 'None') continue; // skip clean modules

    const modFindings = findings.filter(f => f.moduleId === mod.id);
    const issues = modFindings
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
      .slice(0, 5) // max 5 issues per module
      .map(f => renderIssue(f, graph));

    cards.push({
      moduleId: mod.id,
      moduleName: mod.name,
      purpose: inferModulePurpose(mod, graph),
      criticality,
      complexity: mod.lineItemCount > 30 ? 'High' : mod.lineItemCount > 15 ? 'Moderate' : 'Simple',
      grain: mod.dimensions.join(' x ') || 'Model-level',
      upstreamModules: mod.upstreamModules,
      downstreamModules: mod.downstreamModules,
      role: mod.role,
      stats: {
        lineItems: mod.lineItemCount,
        formulas: mod.formulaCount,
        crossModuleDeps: mod.inboundEdges + mod.outboundEdges,
        temporalCalcs: countTemporalInModule(graph, mod.id),
      },
      issues,
    });
  }

  return cards.sort((a, b) =>
    criticalityRank(a.criticality) - criticalityRank(b.criticality) ||
    b.stats.crossModuleDeps - a.stats.crossModuleDeps
  );
}
```

---

## Part 6: Aggregate Intelligence

### Model Health Summary

```javascript
export function buildModelSummary(graph, moduleCards, riskClusters) {
  const criticalModules = moduleCards.filter(c => c.criticality === 'Critical');
  const highModules = moduleCards.filter(c => c.criticality === 'High');
  const cleanModules = graph.modules.size - moduleCards.length;

  return {
    // Top-level verdict
    overallHealth: criticalModules.length > 0 ? 'Needs Attention'
      : highModules.length > 0 ? 'Review Recommended'
      : 'Healthy',

    // Module breakdown
    moduleSummary: {
      total: graph.modules.size,
      critical: criticalModules.length,
      high: highModules.length,
      medium: moduleCards.filter(c => c.criticality === 'Medium').length,
      clean: cleanModules,
    },

    // Top risk modules (cards, sorted)
    topRiskModules: moduleCards.slice(0, 10),

    // Risk clusters
    riskClusters: riskClusters.slice(0, 5),

    // Fix order (topological)
    remediationOrder: computeRemediationOrder(graph,
      moduleCards.filter(c => c.criticality === 'Critical' || c.criticality === 'High')
        .flatMap(c => c.issues.map(i => i.lineItemId)).filter(Boolean)
    ),

    // Evidence limits
    evidenceLimits: {
      canSay: [
        'Formula-level dependencies between all line items',
        'Exact blast radius for any change',
        'Hardcoded references and fragility points',
        'Dimensional flow and aggregation patterns',
        'Business calculation patterns (accumulation, driver, variance)',
      ],
      cannotSay: [
        'Actual performance or recalculation time',
        'Whether a finding is intentional (model-owner decision)',
        'Cell count or memory impact without Polaris metadata',
        'User-facing page layout and dashboard usage',
        'Import/export scheduling and data freshness',
      ],
    },
  };
}
```

---

## Part 7: SSE Event Stream (Updated)

### analyze-v3.js changes

Replace the current AI-generates-workstreams flow with:

```javascript
// Stage 1: Parse blob (existing, updated for v2 format)
const { modules, enrichment, listMembers } = parseStateBlobV2(stateText);

// Stage 2: Build intelligence graph (NEW — deterministic, ~3-5 seconds)
sendEvent({ type: 'stage', stage: 'parsing-formulas', label: 'Parsing formula references…' });
const parsedFormulas = parseAllFormulas(modules);

sendEvent({ type: 'stage', stage: 'building-graph', label: 'Building dependency graph…' });
const graph = buildLineItemGraph(modules, parsedFormulas);

sendEvent({ type: 'stage', stage: 'analyzing', label: 'Analyzing risk and patterns…' });
const findings = scanAllFindings(graph);
const riskClusters = buildRiskClusters(graph, findings);
const patterns = detectBusinessPatterns(graph);
const moduleCards = buildModuleIntelligence(modules, graph, findings);
const summary = buildModelSummary(graph, moduleCards, riskClusters);

// Stage 3: Stream results
sendEvent({
  type: 'model-intelligence',
  summary,
  moduleCards: moduleCards.slice(0, 15),
  riskClusters: riskClusters.slice(0, 5),
  remediationOrder: summary.remediationOrder,
  evidenceLimits: summary.evidenceLimits,
  patterns: patterns.slice(0, 10),
});

// Stage 4: Optional AI narration (additive, failure-safe)
sendEvent({ type: 'stage', stage: 'narrating', label: 'Writing executive summary…' });
try {
  const narrative = await generateNarrative(summary, moduleCards);
  sendEvent({ type: 'intelligence-narrative', narrative });
} catch (e) {
  // AI failure is fine — product is complete without it
  console.warn('[analyze-v3] AI narration skipped:', e.message);
}

sendEvent({ type: 'complete', version: 'v3.1', ... });
```

### New SSE Events

| Event | Payload | Purpose |
|-------|---------|---------|
| `model-intelligence` | summary, moduleCards, riskClusters, remediationOrder, evidenceLimits, patterns | Core intelligence delivery — everything the UI needs |
| `intelligence-narrative` | executive summary, per-module narratives, owner questions | Optional AI enhancement |

---

## Part 8: AI Narration (Optional, Last)

### What AI does

Given the complete summary + top module cards, AI writes:

1. **Executive brief** (2-3 paragraphs for a non-technical stakeholder)
2. **Per-module one-liner** (optional — adds a "so what" sentence to each card)
3. **Owner questions** (2-3 specific questions derived from the findings)

### Prompt structure

```
You are writing an executive model review summary.

MODEL: {domain} with {moduleCount} modules
TOP RISK: {moduleCards[0].moduleName} — {moduleCards[0].issues[0].issue}
RISK CLUSTERS: {riskClusters.map(c => c.trigger).join('; ')}
OVERALL: {summary.overallHealth}

Write:
1. A 2-3 paragraph executive brief. Name specific modules and issues. No generic statements.
2. For each top-risk module, one sentence: what the business consequence is if nothing is fixed.
3. Two questions for the model owner that would help determine if findings are intentional.

Every claim must reference a module name from the data above. Do not invent issues.
```

### AI model choice

Haiku is sufficient. The intelligence is pre-computed — AI is just formatting structured data as prose. If Haiku quality feels low, Sonnet adds ~5 seconds but the core product doesn't depend on it.

---

## Part 9: Persistence for Chatbot/Workflow

### Stored Intelligence Graph

After analysis completes, store the graph in Vercel Blob:

```javascript
const graphBlob = await put(`intelligence/${modelId}-${Date.now()}.json`, JSON.stringify({
  version: '2.0',
  modelId,
  generatedAt: new Date().toISOString(),
  graph: { nodes: [...graph.nodes], edges: graph.edges, modules: [...graph.modules] },
  findings,
  moduleCards,
  riskClusters,
  patterns,
  summary,
}), { access: 'public', contentType: 'application/json' });
```

### Chatbot Query Interface (Future Phase)

The stored graph supports these query types without recomputation:
- `impactOf(itemId)` → computeImpactScope from stored graph
- `dependenciesOf(moduleId)` → filter edges
- `whatIf(memberName, 'rename')` → filter literals + trace downstream
- `fixOrder(moduleIds)` → topological sort from stored graph
- `explain(moduleId)` → return stored module card

---

## Part 10: Migration Path

### Phase A: Blob enrichment (1 session)
- Remove formula truncation in model-state.js
- Add dimensions to blob row format
- Add LISTMEMBERS section
- Update parseStateBlob in analyze-v3.js to read new format
- Backwards-compatible: old blobs still parse (dims field defaults to [])

### Phase B: Formula parser + graph (2-3 sessions)
- Implement formula-parser.js
- Implement graph-builder.js
- Implement graph-algorithms.js
- Unit tests against real formula samples from COPS Demo

### Phase C: Module intelligence + templates (1-2 sessions)
- Implement module-intelligence.js
- Issue templates for all finding types
- Aggregate summary builder
- SSE event restructure

### Phase D: UI update (1-2 sessions)
- Assessment tab renders module cards (not workstream cards)
- Per-module detail view
- Risk cluster visualization
- Remediation order display
- Remove Notes tab

### Phase E: AI narration (1 session)
- Implement optional narrative generation
- Wire to SSE event
- Graceful fallback

### Phase F: Persistence + chatbot foundation (future)
- Store intelligence graph
- Build query API
- Chatbot consumes stored graph

---

## Success Criteria

1. Every claim in the UI traces back to a specific formula in a specific line item
2. The product delivers complete intelligence with AI disabled
3. Module cards answer: purpose, complexity, criticality, root causes, and fix actions
4. A CoE reviewer reads the output and says "this is what I would have found in 2 days"
5. The intelligence graph persists and is queryable for chatbot and workflow features
