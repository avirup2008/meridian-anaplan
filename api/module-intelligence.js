// ─── Module Intelligence Generator ──────────────────────────────────────────
// Synthesizes graph data into per-module intelligence cards.
// Deterministic — no AI needed. Every claim traces to a specific formula.

import { computeImpactScope, computeModuleImpact, getModuleItems, findBottlenecks } from './graph-builder.js';

// ─── Issue Templates ────────────────────────────────────────────────────────
// Each template converts a raw finding into human-readable {issue, danger, fix}

const ISSUE_TEMPLATES = {
  FORMULA_SELECT_HARDCODED: (f, graph) => {
    const literal = extractLiteralFromEvidence(f.evidence);
    const scope = computeItemImpact(graph, f);
    return {
      issue: `${f.lineItemName} hardcodes a list member name in SELECT`,
      danger: `If that member is renamed, this formula silently returns zero${scope.outputSuffix}`,
      fix: `Replace the hardcoded SELECT with a system module lookup or driver list reference`,
    };
  },

  FORMULA_SUM_LOOKUP: (f, graph) => {
    const scope = computeItemImpact(graph, f);
    return {
      issue: `${f.lineItemName} combines SUM and LOOKUP in one expression`,
      danger: `This pattern recalculates on every cell intersection — performance degrades exponentially with list size${scope.outputSuffix}`,
      fix: `Split into a LOOKUP intermediate line item, then aggregate with SUM separately`,
    };
  },

  FORMULA_NESTED_IF: (f, graph) => {
    const depth = f.ifDepth || extractNumberFromEvidence(f.evidence);
    return {
      issue: `${f.lineItemName} uses ${depth} levels of nested IF logic`,
      danger: `Deepest branches cannot be isolated or tested — edge-case inputs silently return wrong values`,
      fix: `Extract conditions into a mapping/driver module and resolve with LOOKUP (reduces depth to 1-2)`,
    };
  },

  FORMULA_DIVISION_UNGUARDED: (f, graph) => {
    const scope = computeItemImpact(graph, f);
    return {
      issue: `${f.lineItemName} divides without checking for zero`,
      danger: `When denominator has no data (new period, new product), this errors${scope.outputSuffix}`,
      fix: `Add IF denominator <> 0 guard, or create a safe-denominator intermediate line item`,
    };
  },

  FORMULA_LONG: (f, graph) => ({
    issue: `${f.lineItemName} formula is ${f.formulaLength || extractNumberFromEvidence(f.evidence)} characters`,
    danger: `Long formulas are unreadable, untestable, and hide multiple business rules in one cell`,
    fix: `Decompose into named intermediate line items — one business rule per formula`,
  }),

  RATE_SUMMARY_SUM: (f, graph) => ({
    issue: `${f.lineItemName} is a rate/percentage but uses SUM to aggregate`,
    danger: `Parent-level totals are mathematically wrong — you cannot sum percentages across list members`,
    fix: `Set summary to NONE, or recalculate from summed numerator and denominator at each level`,
  }),

  BOOLEAN_SUMMARY_INVALID: (f, graph) => ({
    issue: `${f.lineItemName} is Boolean with ${extractSummaryFromEvidence(f.evidence)} summary`,
    danger: `Boolean rollups with SUM/AVERAGE produce nonsensical numeric totals at parent level`,
    fix: `Set summary method to NONE, ANY, or ALL depending on the rollup intent`,
  }),

  MODULE_DATA_HAS_CALC: (f, graph) => ({
    issue: `Data module contains calculation: ${f.lineItemName}`,
    danger: `Mixing data storage and calculations breaks the separation principle — edits to logic risk corrupting source data`,
    fix: `Move calculation logic into a dedicated CAL module; keep this module as pure data input/reference`,
  }),

  MODULE_TOO_MANY_DIMS: (f, graph) => ({
    issue: `Module uses ${extractNumberFromEvidence(f.evidence)} dimensions`,
    danger: `Every additional dimension multiplies cell count — this module likely consumes disproportionate model memory`,
    fix: `Split into sub-modules by dimension group, or move mapping dimensions into a system module`,
  }),

  ARCH_OUTPUT_READS_RAW_LAYER: (f, graph) => ({
    issue: `Report reads directly from data layer (${f.relatedModuleName || 'raw input'})`,
    danger: `This output bypasses all calculation and business rule logic — shows raw inputs to stakeholders`,
    fix: `Route through the calculation layer so business rules are applied before reporting`,
  }),

  ARCH_DATA_MODULE_HAS_FORMULAS: (f, graph) => ({
    issue: `Data module ${f.moduleName} contains formulas`,
    danger: `Data modules should store inputs only — formulas here indicate mixed responsibility`,
    fix: `Extract formulas into a calculation module that references this data module`,
  }),

  ARCH_CALC_MODULE_STORES_INPUTS: (f, graph) => ({
    issue: `Calculation module ${f.moduleName} stores input data`,
    danger: `Inputs in calculation modules bypass the data layer — no clear audit trail for source values`,
    fix: `Move inputs into a dedicated data module and reference them from here`,
  }),

  ARCH_MIXED_RESPONSIBILITY_MODULE: (f, graph) => ({
    issue: `${f.moduleName} mixes input storage and calculation logic`,
    danger: `Mixed-responsibility modules are hard to maintain — changes to logic risk overwriting source data`,
    fix: `Split into separate data (input) and calculation modules following DISCO pattern`,
  }),

  MODULE_NAMING_PATTERN: (f, graph) => ({
    issue: `Module name "${f.moduleName}" does not follow prefix convention`,
    danger: `Without functional prefixes, developers cannot quickly identify module purpose in a large model`,
    fix: `Rename using the agreed naming standard (e.g., DAT01, CAL02, REP03)`,
  }),

  TEXT_FORMAT_USED: (f, graph) => ({
    issue: `${f.lineItemName} is a calculated text line item`,
    danger: `Text calculations are memory-intensive and cannot be aggregated — often a list-format alternative exists`,
    fix: `Use Boolean flags or list-coded status fields where practical instead of calculated text`,
  }),

  BOOLEAN_NAME_WEAK: (f, graph) => ({
    issue: `Boolean "${f.lineItemName}" lacks a verb prefix`,
    danger: `Without Is/Has/Can prefix, the true/false meaning is ambiguous to other developers`,
    fix: `Rename with a Boolean verb prefix (Is Active, Has Override, Can Edit)`,
  }),

  FORMULA_FINDITEM_EXPENSIVE: (f, graph) => {
    const scope = computeItemImpact(graph, f);
    return {
      issue: `${f.lineItemName} uses FINDITEM — expensive list scan per cell`,
      danger: `FINDITEM forces a sequential scan of the target list for every cell intersection. In multi-dimensional modules this causes exponential performance degradation${scope.outputSuffix}`,
      fix: `Pre-map the text-to-item conversion in a SYS module, then use LOOKUP to retrieve the mapped value`,
    };
  },

  FORMULA_IF_SHOULD_BE_BOOLEAN_GATE: (f, graph) => ({
    issue: `${f.lineItemName} uses IF/THEN in a high-dimensional module`,
    danger: `IF/THEN evaluates branch logic per cell — in high-cell-count modules, boolean multiplication (Value * Flag) is significantly faster`,
    fix: `Replace IF condition THEN value ELSE 0 with: value * BooleanFlag (pre-calculate the flag in a SYS module)`,
  }),

  FORMULA_LONG_LOOKUP_CHAIN: (f, graph) => {
    const scope = computeItemImpact(graph, f);
    return {
      issue: `${f.lineItemName} has a long cross-module reference chain`,
      danger: `Multiple sequential cross-module reads create a deep DAG path — recalculation cascades slowly through the dependency chain${scope.outputSuffix}`,
      fix: `Cache intermediate values in a SYS module. Read once from source, then reference the cached value locally`,
    };
  },

  SUMMARY_LOOKUP_NOT_NONE: (f, graph) => ({
    issue: `${f.lineItemName} is a LOOKUP reference that aggregates`,
    danger: `Mapped attributes (category, region, type) rolled up via SUM/AVERAGE produce meaningless parent totals and waste computation`,
    fix: `Set summary method to NONE for all lookup/mapping line items`,
  }),

  MODULE_MONOLITHIC: (f, graph) => ({
    issue: `${f.moduleName} is monolithic — ${extractNumberFromEvidence(f.evidence)} line items with high dimensionality`,
    danger: `Cell count = line items × all dimension members × time × versions. Monolithic modules consume disproportionate memory and slow targeted recalculation`,
    fix: `Split into single-responsibility modules by DISCO pattern: separate inputs (INP), calculations (CAL), and outputs (REP)`,
  }),

  ARCH_INP_TOO_MANY_FORMULAS: (f, graph) => ({
    issue: `Input module ${f.moduleName} contains excessive formulas`,
    danger: `INP modules should store user-entered planning data with minimal validation. Heavy formula logic here violates DISCO separation and makes the input layer fragile`,
    fix: `Move calculation logic into a dedicated CAL module. INP should contain only input-enabled line items and basic validation`,
  }),

  ARCH_DAT_NO_IMPORT: (f, graph) => ({
    issue: `Data module ${f.moduleName} has no matching import action`,
    danger: `DAT modules are meant for imported data staging. Without an import source, this may be orphaned or incorrectly classified`,
    fix: `Verify data source exists. If manually populated, rename to INP. If integration was removed, archive the module`,
  }),
};

// ─── Purpose Inference ──────────────────────────────────────────────────────

function inferModulePurpose(mod, graph) {
  const dims = mod.dimensions.slice(0, 2).join(' × ');
  const up = mod.upstreamModules.slice(0, 3).join(', ');
  const down = mod.downstreamModules.slice(0, 3).join(', ');

  if (mod.role === 'source' && mod.inputCount > mod.formulaCount) {
    return `Stores input data${dims ? ` at ${dims} grain` : ''}. ${mod.outboundEdges} downstream calculations read from here.`;
  }
  if (mod.role === 'hub') {
    return `Core calculation hub — reads from ${up || 'multiple sources'} and feeds ${down || 'multiple consumers'}${dims ? `. Operates at ${dims} grain` : ''}.`;
  }
  if (mod.role === 'sink' && /^(REP|OUT|KPI|SOP|IBP|DASH)/.test(mod.name)) {
    return `Reporting output. Aggregates results from ${up || 'calculation modules'} for stakeholder consumption.`;
  }
  if (/^(SYS|MOD|SET)/.test(mod.name)) {
    return `System/configuration module. Referenced by ${mod.outboundEdges} downstream calculations.`;
  }
  if (mod.role === 'source') {
    return `Data source module${dims ? ` at ${dims} grain` : ''}. Feeds ${down || `${mod.outboundEdges} downstream modules`}.`;
  }
  if (mod.role === 'sink') {
    return `End-of-chain module. Consumes data from ${up || 'upstream calculations'} with no further dependents.`;
  }
  if (mod.role === 'transformer') {
    return `Transforms data from ${up || 'inputs'}${dims ? ` at ${dims} grain` : ''}, feeding ${down || 'downstream modules'}.`;
  }
  return `Module with ${mod.lineItemCount} line items${dims ? ` at ${dims} grain` : ''}.`;
}

// ─── Criticality Scoring ────────────────────────────────────────────────────

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };
const CRITICALITY_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3, None: 4 };

const SUPPRESSED_RULES = new Set(['BOOLEAN_SUMMARY_INVALID', 'FORMULA_DIVISION_UNGUARDED']);

function computeCriticality(mod, graph, findings) {
  const modFindings = findings.filter(f => f.moduleId === mod.id && !SUPPRESSED_RULES.has(f.ruleId));
  const criticalCount = modFindings.filter(f => f.severity === 'critical').length;
  const warningCount = modFindings.filter(f => f.severity === 'warning').length;

  const impact = computeModuleImpact(graph, mod.id);
  const roleMultiplier = mod.role === 'hub' ? 2.0
    : mod.role === 'source' ? 1.5
    : mod.role === 'sink' ? 0.8
    : 1.0;

  const score = (criticalCount * 4 + warningCount * 2)
    * (1 + impact.affectedOutputCount * 0.5)
    * roleMultiplier;

  if (score >= 12 || (criticalCount > 0 && impact.affectedOutputCount > 0)) return 'Critical';
  if (score >= 6 || criticalCount > 0) return 'High';
  if (score >= 2 || warningCount > 0) return 'Medium';
  if (modFindings.length > 0) return 'Low';
  return 'None';
}

// ─── Module Intelligence Card Assembly ──────────────────────────────────────

export function buildModuleIntelligence(graph, findings) {
  const cards = [];

  for (const mod of graph.modules.values()) {
    const criticality = computeCriticality(mod, graph, findings);
    if (criticality === 'None') continue;

    const modFindings = findings.filter(f => f.moduleId === mod.id && !SUPPRESSED_RULES.has(f.ruleId));
    const issues = modFindings
      .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 2) - (SEVERITY_RANK[b.severity] ?? 2))
      .slice(0, 5)
      .map(f => renderIssue(f, graph));

    const items = getModuleItems(graph, mod.id);
    const temporalCount = items.filter(n => n.isSelfReferencing).length;

    cards.push({
      moduleId: mod.id,
      moduleName: mod.name,
      purpose: inferModulePurpose(mod, graph),
      criticality,
      complexity: mod.lineItemCount > 30 ? 'High' : mod.lineItemCount > 15 ? 'Moderate' : 'Simple',
      grain: mod.grain || mod.dimensions.join(' × ') || 'Model-level',
      role: mod.role,
      upstreamModules: mod.upstreamModules,
      downstreamModules: mod.downstreamModules,
      stats: {
        lineItems: mod.lineItemCount,
        formulas: mod.formulaCount,
        inputs: mod.inputCount,
        inboundEdges: mod.inboundEdges,
        outboundEdges: mod.outboundEdges,
        internalEdges: mod.internalEdges,
        temporalCalcs: temporalCount,
      },
      issues,
      findingCount: modFindings.length,
    });
  }

  return cards.sort((a, b) =>
    (CRITICALITY_RANK[a.criticality] ?? 4) - (CRITICALITY_RANK[b.criticality] ?? 4) ||
    b.stats.outboundEdges - a.stats.outboundEdges
  );
}

// ─── Aggregate Model Summary ────────────────────────────────────────────────

export function buildModelSummary(graph, moduleCards, riskClusters, patterns) {
  const criticalModules = moduleCards.filter(c => c.criticality === 'Critical');
  const highModules = moduleCards.filter(c => c.criticality === 'High');
  const cleanCount = graph.modules.size - moduleCards.length;

  const overallHealth = criticalModules.length > 0 ? 'Needs Attention'
    : highModules.length > 0 ? 'Review Recommended'
    : 'Healthy';

  const bottlenecks = findBottlenecks(graph, 5);

  return {
    overallHealth,
    healthScore: computeHealthScore(moduleCards, graph),

    moduleSummary: {
      total: graph.modules.size,
      critical: criticalModules.length,
      high: highModules.length,
      medium: moduleCards.filter(c => c.criticality === 'Medium').length,
      low: moduleCards.filter(c => c.criticality === 'Low').length,
      clean: cleanCount,
    },

    graphStats: {
      totalNodes: graph.nodes.size,
      totalEdges: graph.edges.length,
      crossModuleEdges: graph.edges.filter(e => e.isCrossModule).length,
      intraModuleEdges: graph.edges.filter(e => !e.isCrossModule).length,
    },

    topRiskModules: moduleCards.slice(0, 10),
    riskClusters: riskClusters.slice(0, 5),
    bottlenecks: bottlenecks.map(b => ({
      moduleName: b.moduleName,
      itemName: b.name,
      fanOut: b.fanOut,
      fanIn: b.fanIn,
    })),
    patterns: summarizePatterns(patterns),

    evidenceLimits: {
      canSay: [
        'Formula-level dependencies between all line items',
        'Exact blast radius for any change',
        'Hardcoded references that break on rename',
        'Dimensional flow and aggregation patterns',
        'Business calculation patterns (accumulation, driver, variance)',
        'Remediation order respecting dependency chains',
      ],
      cannotSay: [
        'Actual recalculation performance or memory usage',
        'Whether a finding is intentional (model-owner decision)',
        'Cell count without Polaris/HyperConnect metadata',
        'User-facing page layout and dashboard configuration',
        'Import/export scheduling and data freshness',
        'User permissions and access patterns',
      ],
    },
  };
}

// ─── Admissibility Gates ───────────────────────────────────────────────────
// Determines which visualizations and claims are supported by actual evidence.

export function computeAdmissibilityGates(graph, moduleCards, normalized, discoMap) {
  const moduleCount = normalized.modules.length;
  const formulaCount = normalized.modules.reduce((sum, m) => sum + m.lineItems.filter(li => li.formula).length, 0);
  const totalLineItems = normalized.modules.reduce((sum, m) => sum + m.lineItems.length, 0);
  const formulaCoverage = totalLineItems > 0 ? formulaCount / totalLineItems : 0;

  const edgeCount = graph.edges.length;
  const crossModuleEdges = graph.edges.filter(e => e.isCrossModule).length;
  const graphDensity = moduleCount > 1 ? crossModuleEdges / (moduleCount * (moduleCount - 1)) : 0;

  const unknown = discoMap.UNKNOWN || 0;
  const namingCoverage = moduleCount > 0 ? (moduleCount - unknown) / moduleCount : 0;

  // Thresholds
  const hasFormulas = formulaCoverage > 0.05; // at least 5% of line items have formulas
  const hasDenseGraph = crossModuleEdges >= 3 && graphDensity > 0.02;
  const hasStrongNaming = namingCoverage >= 0.5;
  const hasRichGraph = crossModuleEdges >= 8 && graphDensity > 0.05;
  const hasEnoughModules = moduleCount >= 3;

  // Visualization flags
  const vizFlags = {
    dependencyArchitecture: hasFormulas && hasDenseGraph && hasEnoughModules,
    riskClusters: hasFormulas && moduleCards.length >= 2,
    fixOrder: moduleCards.filter(c => c.criticality === 'Critical' || c.criticality === 'High').length >= 2,
    bottlenecks: hasFormulas && hasRichGraph,
    architectureMix: hasStrongNaming,
    blastRadius: hasFormulas && hasDenseGraph,
  };

  // Dynamic canSay / cannotSay based on actual evidence
  const canSay = [];
  const cannotSay = [];

  if (hasFormulas) {
    canSay.push('Formula-level dependencies between line items');
    canSay.push('Hardcoded references that break on rename');
    if (hasDenseGraph) {
      canSay.push('Exact blast radius for any change');
      canSay.push('Remediation order respecting dependency chains');
    } else {
      cannotSay.push('Full blast radius — too few cross-module formula references detected');
    }
  } else {
    cannotSay.push('Formula dependencies — no formula text in the blueprint export');
    cannotSay.push('Blast radius — requires formula references');
  }

  if (hasStrongNaming) {
    canSay.push('Module responsibility classification (DISCO prefix mapping)');
    canSay.push('Architecture layer boundary analysis');
  } else {
    cannotSay.push('Architecture classification — naming coverage below 50%');
  }

  if (totalLineItems > 0) {
    canSay.push('Summary method and format risk detection');
    canSay.push('Dimensional flow and aggregation patterns');
  }

  // Always cannot-say items
  cannotSay.push('Actual recalculation performance or memory usage');
  cannotSay.push('Whether a finding is intentional (model-owner decision)');
  cannotSay.push('Cell count without Polaris/HyperConnect metadata');
  cannotSay.push('User-facing page layout and dashboard configuration');

  return {
    vizFlags,
    evidenceQuality: {
      formulaCoverage: Math.round(formulaCoverage * 100),
      graphDensity: Math.round(graphDensity * 1000) / 1000,
      namingCoverage: Math.round(namingCoverage * 100),
      crossModuleEdges,
      moduleCount,
      totalLineItems,
      formulaCount,
    },
    canSay,
    cannotSay,
  };
}

// ─── Health Score (deterministic) ───────────────────────────────────────────

function computeHealthScore(moduleCards, graph) {
  if (graph.modules.size === 0) return 95;

  const criticalWeight = 8;
  const highWeight = 4;
  const mediumWeight = 1.5;

  const criticalCount = moduleCards.filter(c => c.criticality === 'Critical').length;
  const highCount = moduleCards.filter(c => c.criticality === 'High').length;
  const mediumCount = moduleCards.filter(c => c.criticality === 'Medium').length;

  const penalty = (criticalCount * criticalWeight + highCount * highWeight + mediumCount * mediumWeight)
    / Math.max(graph.modules.size, 1) * 10;

  return Math.round(Math.min(95, Math.max(0, 100 - penalty)));
}

// ─── Pattern Summarization ──────────────────────────────────────────────────

function summarizePatterns(patterns) {
  const counts = {};
  for (const p of patterns) {
    counts[p.type] = (counts[p.type] || 0) + 1;
  }
  return Object.entries(counts).map(([type, count]) => ({
    type,
    label: PATTERN_LABELS[type] || type,
    count,
  }));
}

const PATTERN_LABELS = {
  'accumulation': 'Temporal accumulation (running balances)',
  'hardcoded-member': 'Hardcoded list member references',
  'inventory-tracking': 'Inventory/balance tracking modules',
  'branching-logic': 'Complex conditional branching modules',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function renderIssue(finding, graph) {
  const template = ISSUE_TEMPLATES[finding.ruleId];
  if (template) {
    return template(finding, graph);
  }
  return {
    issue: finding.title || `${finding.lineItemName || finding.moduleName}: ${finding.ruleId}`,
    danger: finding.evidence || 'See formula for details',
    fix: finding.action || 'Review and remediate according to Anaplan best practices',
  };
}

function computeItemImpact(graph, finding) {
  const nodeId = finding.moduleId && finding.lineItemName
    ? `${finding.moduleId}::${finding.lineItemName}`
    : null;
  if (!nodeId || !graph.nodes.has(nodeId)) {
    return { outputSuffix: '' };
  }
  const scope = computeImpactScope(graph, nodeId);
  if (scope.affectedOutputCount > 0) {
    return { outputSuffix: ` — propagating errors to ${scope.outputModuleNames.slice(0, 2).join(', ')}` };
  }
  if (scope.affectedModuleCount > 2) {
    return { outputSuffix: ` — affecting ${scope.affectedItemCount} items across ${scope.affectedModuleCount} modules` };
  }
  return { outputSuffix: '' };
}

function extractLiteralFromEvidence(evidence) {
  const match = evidence?.match(/quoted list member|SELECT.*?'([^']+)'/i);
  return match?.[1] || 'a list member';
}

function extractNumberFromEvidence(evidence) {
  const match = evidence?.match(/(\d+)/);
  return match ? parseInt(match[1]) : '?';
}

function extractSummaryFromEvidence(evidence) {
  const match = evidence?.match(/with (\w+) summary/i);
  return match?.[1] || 'invalid';
}
