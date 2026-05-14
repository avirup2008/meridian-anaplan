const DOMAIN_FOR_RULE = {
  MODULE_NAMING_PATTERN: 'Naming',
  MODULE_DATA_HAS_CALC: 'Structural',
  MODULE_TOO_MANY_DIMS: 'Structural',
  BOOLEAN_SUMMARY_INVALID: 'Best Practice',
  RATE_SUMMARY_SUM: 'Best Practice',
  FORMULA_SUM_LOOKUP: 'Formula',
  FORMULA_SELECT_HARDCODED: 'Formula',
  FORMULA_NESTED_IF: 'Formula',
  FORMULA_LONG: 'Formula',
  FORMULA_DIVISION_UNGUARDED: 'Formula',
  TEXT_FORMAT_USED: 'Best Practice',
  BOOLEAN_NAME_WEAK: 'Naming',
};

const TRIAGE_FOR_SEVERITY = {
  critical: 'Fix Now',
  warning: 'Consider',
  info: 'Monitor',
};

const SCORE_WEIGHTS = {
  critical: 4,
  warning: 2,
  info: 1,
};

const SUGGESTION_SEVERITY_ORDER = {
  critical: 0,
  warning: 1,
  info: 2,
};

const MAX_SUGGESTION_CARDS = 20;
const EXAMPLE_LIMIT = 6;

const DIMENSION_RULES = {
  architecture: new Set(['MODULE_NAMING_PATTERN', 'MODULE_DATA_HAS_CALC', 'MODULE_TOO_MANY_DIMS']),
  naming: new Set(['MODULE_NAMING_PATTERN']),
  formulas: new Set(['FORMULA_SUM_LOOKUP', 'FORMULA_SELECT_HARDCODED', 'FORMULA_NESTED_IF', 'FORMULA_LONG', 'FORMULA_DIVISION_UNGUARDED']),
  dataHygiene: new Set(['BOOLEAN_SUMMARY_INVALID', 'RATE_SUMMARY_SUM', 'TEXT_FORMAT_USED']),
  governance: new Set(['MODULE_NAMING_PATTERN', 'MODULE_DATA_HAS_CALC', 'FORMULA_LONG']),
};

const BOOLEAN_PREFIX_RE = /^(Is|Has|Can|Should|Use|Enable|Allow|Include|Exclude|Requires?)\b/i;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

export function normalizeFormat(format) {
  if (!format) return '';
  if (typeof format === 'string') return upper(format);
  return upper(format.dataType || format.type || format.name || format.formatType || format.format || '');
}

export function normalizeSummary(summary) {
  if (!summary) return '';
  if (typeof summary === 'string') return upper(summary);
  return upper(summary.summaryMethod || summary.method || summary.name || '');
}

export function normalizeDimensions(appliesTo) {
  if (!Array.isArray(appliesTo)) return [];
  return appliesTo
    .map(d => typeof d === 'string' ? d : (d?.name || d?.id || ''))
    .map(text)
    .filter(Boolean);
}

export function countIfDepth(formula) {
  const matches = text(formula).match(/\bIF\b/gi);
  return matches ? matches.length : 0;
}

export function hasSumLookup(formula) {
  const f = upper(formula);
  return /\[\s*SUM\s*:/.test(f) && /\bLOOKUP\s*:/.test(f);
}

export function hasHardcodedSelect(formula) {
  const f = text(formula);
  return /\[\s*SELECT\s*:\s*(?!\s*Versions\.)[^\]]*['"]/.test(f);
}

export function hasUnguardedDivision(formula) {
  const f = text(formula);
  if (!f.includes('/')) return false;
  return !/\bIF\b[\s\S]{0,80}(?:<>|=|>|<)\s*0\b/i.test(f);
}

export function normalizeBlueprint(blueprint) {
  const modules = Array.isArray(blueprint?.modules) ? blueprint.modules : [];
  return {
    modelId: blueprint?.modelId || '',
    workspaceId: blueprint?.workspaceId || '',
    partialLoad: Boolean(blueprint?.partialLoad),
    modules: modules
      .filter(mod => !mod.fetchError && Array.isArray(mod.lineItems))
      .map(mod => {
        const moduleName = text(mod.name);
        const lineItems = mod.lineItems.map(li => {
          const formula = text(li.formula);
          const dimensions = normalizeDimensions(li.appliesTo);
          const formatType = normalizeFormat(li.format);
          const summaryMethod = normalizeSummary(li.summary);
          return {
            id: text(li.id),
            name: text(li.name),
            formula,
            hasFormula: Boolean(formula),
            formatType,
            summaryMethod,
            dimensions,
            dimensionCount: dimensions.length,
            notes: text(li.notes),
            formulaLength: formula.length,
            ifDepth: countIfDepth(formula),
            hasSumLookup: hasSumLookup(formula),
            hasHardcodedSelect: hasHardcodedSelect(formula),
            hasUnguardedDivision: hasUnguardedDivision(formula),
          };
        });
        const widestLineItem = lineItems.reduce(
          (widest, li) => li.dimensionCount > widest.dimensionCount ? li : widest,
          { dimensionCount: 0, dimensions: [] }
        );
        const moduleDims = widestLineItem.dimensions;
        const prefix = (moduleName.match(/^([A-Z]{2,4})(?:\d{2}|\.)/) || [])[1] || '';
        return {
          id: text(mod.id),
          name: moduleName,
          lineItemCount: Number(mod.lineItemCount || lineItems.length),
          prefix,
          dimensions: moduleDims,
          dimensionCount: widestLineItem.dimensionCount,
          lineItems,
        };
      }),
  };
}

function finding({ ruleId, severity, module, lineItem = null, title, evidence, action }) {
  return {
    ruleId,
    severity,
    domain: DOMAIN_FOR_RULE[ruleId] || 'Best Practice',
    triage: TRIAGE_FOR_SEVERITY[severity] || 'Monitor',
    moduleId: module.id,
    moduleName: module.name,
    lineItemId: lineItem?.id || '',
    lineItemName: lineItem?.name || '',
    title,
    text: title,
    evidence,
    reasoning: evidence,
    action,
  };
}

function isRateLike(li) {
  const source = `${li.name} ${li.formatType}`.toUpperCase();
  return /%|PERCENT|RATE|RATIO|MARGIN|INDEX|PRICE/.test(source);
}

function validModuleName(name) {
  return /^[A-Z]{2,4}\d{2}\s+\S/.test(name) || /^[A-Z]{2,4}\.\S/.test(name);
}

export function scanDeterministicFindings(normalized) {
  const findings = [];
  for (const module of normalized.modules) {
    if (!validModuleName(module.name)) {
      findings.push(finding({
        ruleId: 'MODULE_NAMING_PATTERN',
        severity: 'warning',
        module,
        title: 'Module name does not follow the prefix pattern',
        evidence: `"${module.name}" should use a functional code and two-digit number, such as FIN01 Revenue.`,
        action: 'Rename the module to the agreed Anaplan naming standard.',
      }));
    }

    if (module.dimensionCount > 6) {
      findings.push(finding({
        ruleId: 'MODULE_TOO_MANY_DIMS',
        severity: 'critical',
        module,
        title: 'Module uses more than six dimensions',
        evidence: `${module.dimensionCount} dimensions detected: ${module.dimensions.join(', ')}.`,
        action: 'Split the module or move mappings into system modules before calculation.',
      }));
    }

    for (const li of module.lineItems) {
      if (/^DAT\d{2}/.test(module.name) && li.hasFormula) {
        findings.push(finding({
          ruleId: 'MODULE_DATA_HAS_CALC',
          severity: 'critical',
          module,
          lineItem: li,
          title: 'Data module contains calculation logic',
          evidence: `${li.name} contains formula: ${li.formula.slice(0, 180)}.`,
          action: 'Move calculation logic into a calculation module and keep the data module as source/reference data.',
        }));
      }

      if (li.formatType === 'BOOLEAN' && li.summaryMethod && !['NONE', 'ANY', 'ALL'].includes(li.summaryMethod)) {
        findings.push(finding({
          ruleId: 'BOOLEAN_SUMMARY_INVALID',
          severity: 'warning',
          module,
          lineItem: li,
          title: 'Boolean line item has invalid summary method',
          evidence: `${li.name} is Boolean with ${li.summaryMethod} summary.`,
          action: 'Set the summary method to NONE, ANY, or ALL depending on rollup intent.',
        }));
      }

      if (li.formatType === 'BOOLEAN' && li.name && !BOOLEAN_PREFIX_RE.test(li.name)) {
        findings.push(finding({
          ruleId: 'BOOLEAN_NAME_WEAK',
          severity: 'info',
          module,
          lineItem: li,
          title: 'Boolean line item name lacks verb prefix',
          evidence: `${li.name} does not start with a Boolean verb such as Is, Has, or Can.`,
          action: 'Rename the Boolean line item so its true/false meaning is obvious.',
        }));
      }

      if (isRateLike(li) && li.summaryMethod === 'SUM') {
        findings.push(finding({
          ruleId: 'RATE_SUMMARY_SUM',
          severity: 'critical',
          module,
          lineItem: li,
          title: 'Rate or percentage is summed',
          evidence: `${li.name} looks rate-like and uses SUM summary.`,
          action: 'Set summary to NONE or recalculate from summed numerator and denominator.',
        }));
      }

      if (li.hasSumLookup) {
        findings.push(finding({
          ruleId: 'FORMULA_SUM_LOOKUP',
          severity: 'critical',
          module,
          lineItem: li,
          title: 'Formula combines SUM and LOOKUP',
          evidence: `${li.name} formula contains SUM and LOOKUP in one expression.`,
          action: 'Split the formula into a LOOKUP intermediate and then aggregate with SUM.',
        }));
      }

      if (li.hasHardcodedSelect) {
        findings.push(finding({
          ruleId: 'FORMULA_SELECT_HARDCODED',
          severity: 'critical',
          module,
          lineItem: li,
          title: 'Formula uses hardcoded SELECT',
          evidence: `${li.name} formula contains a SELECT to a quoted list member.`,
          action: 'Replace hardcoded SELECT with a system mapping and LOOKUP.',
        }));
      }

      if (li.ifDepth > 3) {
        findings.push(finding({
          ruleId: 'FORMULA_NESTED_IF',
          severity: 'warning',
          module,
          lineItem: li,
          title: 'Formula has deeply nested IF logic',
          evidence: `${li.name} contains ${li.ifDepth} IF statements.`,
          action: 'Move branching logic into a mapping module and resolve with LOOKUP.',
        }));
      }

      if (li.formulaLength > 120) {
        findings.push(finding({
          ruleId: 'FORMULA_LONG',
          severity: li.formulaLength > 300 ? 'critical' : 'warning',
          module,
          lineItem: li,
          title: 'Formula exceeds recommended length',
          evidence: `${li.name} formula is ${li.formulaLength} characters.`,
          action: 'Decompose the formula into named intermediate line items.',
        }));
      }

      if (li.hasUnguardedDivision) {
        findings.push(finding({
          ruleId: 'FORMULA_DIVISION_UNGUARDED',
          severity: 'warning',
          module,
          lineItem: li,
          title: 'Formula divides without an obvious zero guard',
          evidence: `${li.name} uses division without a nearby denominator zero check.`,
          action: 'Add an IF guard or use a safe denominator line item before dividing.',
        }));
      }

      if (li.formatType === 'TEXT' && li.hasFormula) {
        findings.push(finding({
          ruleId: 'TEXT_FORMAT_USED',
          severity: 'info',
          module,
          lineItem: li,
          title: 'Calculated text line item may be heavy',
          evidence: `${li.name} is a calculated text line item.`,
          action: 'Use Boolean/list-coded status fields where practical instead of calculated text.',
        }));
      }
    }
  }
  return findings;
}

function moduleByIdentity(normalized, suggestion) {
  return normalized.modules.find(m =>
    (suggestion.moduleId && m.id === suggestion.moduleId) ||
    (suggestion.moduleName && m.name === suggestion.moduleName)
  );
}

function lineItemByIdentity(module, suggestion) {
  const name = suggestion.lineItemName || suggestion.lineItem || suggestion.itemName;
  if (!name) return null;
  return module.lineItems.find(li => li.name === name || li.id === suggestion.lineItemId);
}

function evidencePresent(module, suggestion, lineItem) {
  const evidence = text(suggestion.evidence || suggestion.formulaEvidence || '');
  if (!evidence) return true;
  const haystack = [
    module.name,
    ...module.lineItems.flatMap(li => [li.name, li.formula, li.formatType, li.summaryMethod]),
  ].join('\n').toUpperCase();
  if (haystack.includes(evidence.toUpperCase())) return true;
  if (lineItem) {
    const lineHaystack = `${lineItem.name}\n${lineItem.formula}\n${lineItem.formatType}\n${lineItem.summaryMethod}`.toUpperCase();
    return evidence.toUpperCase().split(/\s+/).filter(Boolean).every(part => lineHaystack.includes(part));
  }
  return false;
}

export function validateAiSuggestions(normalized, suggestions) {
  const valid = [];
  const rejected = [];
  const allowedDomains = new Set(['Structural', 'Formula', 'Best Practice', 'Naming']);
  const allowedTriage = new Set(['Fix Now', 'Consider', 'Monitor']);
  for (const raw of Array.isArray(suggestions) ? suggestions : []) {
    const module = moduleByIdentity(normalized, raw || {});
    if (!module) {
      rejected.push({ ...raw, rejectionReason: 'module_not_found' });
      continue;
    }
    const lineItem = lineItemByIdentity(module, raw || {});
    if ((raw.lineItemName || raw.lineItemId || raw.lineItem) && !lineItem) {
      rejected.push({ ...raw, rejectionReason: 'line_item_not_found' });
      continue;
    }
    if (!evidencePresent(module, raw || {}, lineItem)) {
      rejected.push({ ...raw, rejectionReason: 'evidence_not_found' });
      continue;
    }
    const domain = allowedDomains.has(raw.domain) ? raw.domain : 'Best Practice';
    const triage = allowedTriage.has(raw.triage) ? raw.triage : 'Monitor';
    valid.push({
      moduleId: module.id,
      moduleName: module.name,
      lineItemId: lineItem?.id || raw.lineItemId || '',
      lineItemName: lineItem?.name || raw.lineItemName || '',
      domain,
      triage,
      text: raw.title || raw.text || '',
      reasoning: raw.reasoning || '',
      action: raw.action || '',
      builderNote: raw.builderNote || '',
      evidence: raw.evidence || '',
      source: 'ai',
    });
  }
  return { valid, rejected };
}

export function scoreFindings(findings) {
  const penalties = groupedPenalty(findings);
  const healthScore = Math.max(5, Math.round(100 - penalties));
  const dimensions = {};
  for (const [dimension, rules] of Object.entries(DIMENSION_RULES)) {
    const dimPenalty = groupedPenalty(findings.filter(f => rules.has(f.ruleId)));
    dimensions[dimension] = Math.max(5, Math.round(100 - dimPenalty));
  }
  return {
    healthScore,
    verdict: healthScore >= 85 ? 'Good' : healthScore >= 60 ? 'Needs Work' : 'Critical',
    dimensions,
  };
}

function groupedPenalty(findings) {
  const grouped = new Map();
  for (const finding of findings) {
    const key = `${finding.moduleId || finding.moduleName}:${finding.ruleId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(finding);
  }
  let penalty = 0;
  for (const group of grouped.values()) {
    const first = group[0] || {};
    const weight = SCORE_WEIGHTS[first.severity] || 1;
    penalty += weight * (1 + Math.log2(Math.max(1, group.length)));
  }
  return penalty;
}

function findModuleReferences(formula, modules) {
  const refs = [];
  for (const mod of modules) {
    if (!formula || !mod.name) continue;
    if (formula.includes(`${mod.name}.`)) {
      refs.push(mod);
    }
  }
  return refs;
}

export function buildDependencyGraph(normalized) {
  const nodes = normalized.modules.map(mod => ({
    moduleId: mod.id,
    moduleName: mod.name,
    prefix: mod.prefix,
    lineItemCount: mod.lineItemCount,
    dimensionCount: mod.dimensionCount,
  }));
  const edgeMap = new Map();
  for (const target of normalized.modules) {
    for (const li of target.lineItems) {
      if (!li.formula) continue;
      for (const source of findModuleReferences(li.formula, normalized.modules)) {
        if (source.id === target.id) continue;
        const key = `${source.id}->${target.id}`;
        if (!edgeMap.has(key)) {
          edgeMap.set(key, {
            fromModuleId: source.id,
            fromModuleName: source.name,
            toModuleId: target.id,
            toModuleName: target.name,
            lineItems: [],
          });
        }
        edgeMap.get(key).lineItems.push(li.name);
      }
    }
  }
  return { nodes, edges: [...edgeMap.values()] };
}

function downstreamModules(graph, moduleId) {
  const adjacency = new Map();
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.fromModuleId)) adjacency.set(edge.fromModuleId, []);
    adjacency.get(edge.fromModuleId).push(edge.toModuleId);
  }
  const seen = new Set();
  const queue = [...(adjacency.get(moduleId) || [])];
  while (queue.length) {
    const next = queue.shift();
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...(adjacency.get(next) || []));
  }
  return seen;
}

function downstreamOutputCount(graph, downstreamIds) {
  const nodeById = new Map(graph.nodes.map(n => [n.moduleId, n]));
  return [...downstreamIds].filter(id => /^(REP|OUT|KPI|SOP|IBP)/.test(nodeById.get(id)?.moduleName || '')).length;
}

function classifyModuleName(moduleName) {
  if (/^(DAT|DATA|HUB|SRC)/.test(moduleName)) return 'data';
  if (/^(SYS|MAP|LIS)/.test(moduleName)) return 'system';
  if (/^(CAL|CALC|FIN|REV|COGS|MTH|EXP)/.test(moduleName)) return 'calculation';
  if (/^(INP|INPUT|ASS|DRV|PLN)/.test(moduleName)) return 'planning';
  if (/^(REP|OUT|KPI|SOP|IBP|DASH)/.test(moduleName)) return 'output';
  return 'unknown';
}

function classifyModuleBehavior(module) {
  const lineItems = module.lineItems || [];
  const formulaCount = lineItems.filter(li => li.hasFormula).length;
  const inputCount = lineItems.length - formulaCount;
  const booleanCount = lineItems.filter(li => li.formatType === 'BOOLEAN').length;
  const textCount = lineItems.filter(li => li.formatType === 'TEXT').length;
  const rateCount = lineItems.filter(isRateLike).length;
  const formulaRatio = lineItems.length ? formulaCount / lineItems.length : 0;
  const dimensions = new Set(lineItems.flatMap(li => li.dimensions || []));

  let behavior = 'data';
  if (formulaRatio >= 0.65) behavior = 'calculation';
  else if (formulaRatio > 0.15) behavior = 'mixed';
  else if (booleanCount + textCount >= Math.max(2, lineItems.length * 0.45)) behavior = 'system';

  const responsibilities = [];
  if (inputCount > 0) responsibilities.push('input storage');
  if (formulaCount > 0) responsibilities.push('calculation');
  if (booleanCount + textCount > 0) responsibilities.push('mapping/status logic');
  if (rateCount > 0) responsibilities.push('rate or KPI reporting');
  if (dimensions.size > 3) responsibilities.push('multi-dimensional staging');

  return {
    behavior,
    formulaCount,
    inputCount,
    booleanCount,
    textCount,
    rateCount,
    formulaRatio: Number(formulaRatio.toFixed(2)),
    responsibilityCount: responsibilities.length,
    responsibilities,
  };
}

function architectureIssue({ ruleId, severity = 'warning', module, title, evidence, action, relatedModuleName = '' }) {
  return {
    ruleId,
    severity,
    moduleId: module.id,
    moduleName: module.name,
    relatedModuleName,
    title,
    evidence,
    action,
  };
}

export function buildArchitectureClassification(normalized, graph) {
  const modules = normalized.modules.map(module => {
    const declaredLayer = classifyModuleName(module.name);
    const behavior = classifyModuleBehavior(module);
    return {
      moduleId: module.id,
      moduleName: module.name,
      declaredLayer,
      inferredBehavior: behavior.behavior,
      formulaCount: behavior.formulaCount,
      inputCount: behavior.inputCount,
      formulaRatio: behavior.formulaRatio,
      responsibilityCount: behavior.responsibilityCount,
      responsibilities: behavior.responsibilities,
    };
  });

  const moduleById = new Map(normalized.modules.map(m => [m.id, m]));
  const classById = new Map(modules.map(m => [m.moduleId, m]));
  const issues = [];

  for (const classified of modules) {
    const module = moduleById.get(classified.moduleId);
    if (!module) continue;
    if (classified.declaredLayer === 'data' && classified.formulaCount > 0) {
      issues.push(architectureIssue({
        ruleId: 'ARCH_DATA_MODULE_HAS_FORMULAS',
        severity: 'critical',
        module,
        title: 'Data layer module contains formulas',
        evidence: `${classified.formulaCount} calculated line item${classified.formulaCount === 1 ? '' : 's'} detected in a data-classified module.`,
        action: 'Move calculations into a calculation layer module and keep data modules as source/reference storage.',
      }));
    }
    if (classified.declaredLayer === 'calculation' && classified.inputCount > classified.formulaCount) {
      issues.push(architectureIssue({
        ruleId: 'ARCH_CALC_MODULE_STORES_INPUTS',
        module,
        title: 'Calculation module stores more inputs than calculations',
        evidence: `${classified.inputCount} input line items versus ${classified.formulaCount} formula line items.`,
        action: 'Separate source inputs from calculation logic so dependencies and ownership are clear.',
      }));
    }
    if (classified.declaredLayer === 'output' && classified.formulaCount === 0) {
      issues.push(architectureIssue({
        ruleId: 'ARCH_OUTPUT_MODULE_NO_DERIVED_VALUES',
        severity: 'info',
        module,
        title: 'Output module has no derived values',
        evidence: 'No formula-bearing line items were detected in this output-classified module.',
        action: 'Confirm this module is genuinely a reporting surface and not a staging/input module with an output prefix.',
      }));
    }
    if (classified.responsibilityCount >= 4) {
      issues.push(architectureIssue({
        ruleId: 'ARCH_MIXED_RESPONSIBILITY_MODULE',
        module,
        title: 'Module mixes too many responsibilities',
        evidence: `Detected responsibilities: ${classified.responsibilities.join(', ')}.`,
        action: 'Split storage, mappings, calculations, and reporting into separate modules before adding more logic.',
      }));
    }
    if (classified.declaredLayer !== 'unknown' && classified.inferredBehavior !== 'mixed') {
      const mismatch =
        (classified.declaredLayer === 'data' && classified.inferredBehavior === 'calculation') ||
        (classified.declaredLayer === 'calculation' && classified.inferredBehavior === 'data') ||
        (classified.declaredLayer === 'system' && classified.inferredBehavior === 'calculation');
      if (mismatch) {
        issues.push(architectureIssue({
          ruleId: 'ARCH_NAME_BEHAVIOR_MISMATCH',
          module,
          title: 'Module name does not match observed behavior',
          evidence: `Name suggests ${classified.declaredLayer}, but line items behave like ${classified.inferredBehavior}.`,
          action: 'Rename the module or move line items so the layer name matches the actual responsibility.',
        }));
      }
    }
  }

  for (const edge of graph.edges) {
    const source = classById.get(edge.fromModuleId);
    const target = classById.get(edge.toModuleId);
    const targetModule = moduleById.get(edge.toModuleId);
    if (!source || !target || !targetModule) continue;
    if (target.declaredLayer === 'output' && ['data', 'planning'].includes(source.declaredLayer)) {
      issues.push(architectureIssue({
        ruleId: 'ARCH_OUTPUT_READS_RAW_LAYER',
        severity: 'critical',
        module: targetModule,
        relatedModuleName: source.moduleName,
        title: 'Output module reads directly from raw planning/data layer',
        evidence: `${target.moduleName} reads ${source.moduleName} in ${edge.lineItems.slice(0, 3).join(', ')}.`,
        action: 'Route raw inputs through a calculation or system mapping layer before output reporting.',
      }));
    }
  }

  const layerCounts = modules.reduce((acc, mod) => {
    acc[mod.declaredLayer] = (acc[mod.declaredLayer] || 0) + 1;
    return acc;
  }, {});

  return {
    modules,
    layerCounts,
    issues: issues.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity) || a.moduleName.localeCompare(b.moduleName)),
  };
}

export function buildBlastRadius(normalized, graph) {
  const nodeById = new Map(graph.nodes.map(n => [n.moduleId, n]));
  return normalized.modules.map(mod => {
    const downstream = downstreamModules(graph, mod.id);
    const downstreamNames = [...downstream].map(id => nodeById.get(id)?.moduleName).filter(Boolean);
    return {
      moduleId: mod.id,
      moduleName: mod.name,
      downstreamModuleCount: downstream.size,
      downstreamOutputCount: downstreamOutputCount(graph, downstream),
      downstreamModules: downstreamNames,
    };
  }).sort((a, b) =>
    b.downstreamOutputCount - a.downstreamOutputCount ||
    b.downstreamModuleCount - a.downstreamModuleCount ||
    a.moduleName.localeCompare(b.moduleName)
  );
}

function severityWeight(severity) {
  return SCORE_WEIGHTS[severity] || 1;
}

function severityRank(severity) {
  return SUGGESTION_SEVERITY_ORDER[severity] ?? 9;
}

function sortFindingsForDisplay(a, b) {
  return severityRank(a.severity) - severityRank(b.severity) ||
    (b.affectedCount || 1) - (a.affectedCount || 1) ||
    a.domain.localeCompare(b.domain) ||
    a.moduleName.localeCompare(b.moduleName) ||
    a.title.localeCompare(b.title);
}

function aggregateFindingGroup(items) {
  const first = items[0];
  if (!first) return [];
  if (items.length === 1) return items;
  const moduleNames = [...new Set(items.map(f => f.moduleName).filter(Boolean))];
  const examples = items
    .map(f => f.lineItemName ? `${f.moduleName}: ${f.lineItemName}` : f.moduleName)
    .filter(Boolean)
    .slice(0, EXAMPLE_LIMIT);
  const exampleText = examples.length ? ` Examples: ${examples.join('; ')}${items.length > examples.length ? '; ...' : ''}.` : '';
  return [{
    ...first,
    moduleId: '',
    moduleName: `${moduleNames.length} module${moduleNames.length === 1 ? '' : 's'}`,
    lineItemId: '',
    lineItemName: '',
    title: first.title,
    text: first.title,
    evidence: `${items.length} underlying findings across ${moduleNames.length} module${moduleNames.length === 1 ? '' : 's'} triggered ${first.ruleId}.${exampleText}`,
    reasoning: `${items.length} occurrences share the same deterministic rule pattern across the model.`,
    action: first.action,
    affectedCount: items.length,
    affectedModuleCount: moduleNames.length,
    examples,
  }];
}

export function summarizeFindingsForSuggestions(findings, maxCards = MAX_SUGGESTION_CARDS) {
  const grouped = new Map();
  for (const item of findings) {
    const key = `${item.domain}:${item.ruleId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }

  const cards = [];
  for (const group of grouped.values()) {
    group.sort(sortFindingsForDisplay);
    cards.push(...aggregateFindingGroup(group));
  }

  return cards
    .sort(sortFindingsForDisplay)
    .slice(0, maxCards);
}

export function prioritizeFindings(findings, blastRadius) {
  const blastByModule = new Map(blastRadius.map(b => [b.moduleId, b]));
  return findings
    .map(f => {
      const blast = blastByModule.get(f.moduleId) || { downstreamModuleCount: 0, downstreamOutputCount: 0 };
      const impactScore = severityWeight(f.severity) * (1 + blast.downstreamModuleCount) + blast.downstreamOutputCount * 3;
      return {
        ...f,
        impactScore,
        downstreamModuleCount: blast.downstreamModuleCount,
        downstreamOutputCount: blast.downstreamOutputCount,
      };
    })
    .sort((a, b) => b.impactScore - a.impactScore || a.moduleName.localeCompare(b.moduleName));
}

export function buildRemediationPlan(prioritizedFindings) {
  const stages = [
    {
      stage: 'Metadata and naming fixes',
      rules: new Set(['MODULE_NAMING_PATTERN', 'BOOLEAN_NAME_WEAK']),
      rationale: 'Low formula risk; improves readability and governance first.',
    },
    {
      stage: 'Summary and data hygiene fixes',
      rules: new Set(['BOOLEAN_SUMMARY_INVALID', 'RATE_SUMMARY_SUM', 'TEXT_FORMAT_USED']),
      rationale: 'Can change reported totals, so fix before deeper formula refactors.',
    },
    {
      stage: 'Formula refactors',
      rules: new Set(['FORMULA_SUM_LOOKUP', 'FORMULA_SELECT_HARDCODED', 'FORMULA_NESTED_IF', 'FORMULA_LONG', 'FORMULA_DIVISION_UNGUARDED']),
      rationale: 'Requires regression checks because formulas can affect downstream outputs.',
    },
    {
      stage: 'Structural remediation',
      rules: new Set(['MODULE_DATA_HAS_CALC', 'MODULE_TOO_MANY_DIMS']),
      rationale: 'Highest design impact; plan with model-builder review and downstream validation.',
    },
  ];
  return stages.map(stage => {
    const items = prioritizedFindings.filter(f => stage.rules.has(f.ruleId)).slice(0, 10);
    return {
      stage: stage.stage,
      rationale: stage.rationale,
      findingCount: prioritizedFindings.filter(f => stage.rules.has(f.ruleId)).length,
      items: items.map(f => ({
        ruleId: f.ruleId,
        moduleName: f.moduleName,
        lineItemName: f.lineItemName,
        action: f.action,
        impactScore: f.impactScore,
      })),
    };
  }).filter(stage => stage.findingCount > 0);
}

export function buildRegressionChecklist(blastRadius) {
  return blastRadius
    .filter(b => b.downstreamOutputCount > 0 || /^(REP|OUT|KPI|SOP|IBP)/.test(b.moduleName))
    .sort((a, b) => {
      const aOutput = /^(REP|OUT|KPI|SOP|IBP)/.test(a.moduleName) ? 1 : 0;
      const bOutput = /^(REP|OUT|KPI|SOP|IBP)/.test(b.moduleName) ? 1 : 0;
      return bOutput - aOutput || b.downstreamOutputCount - a.downstreamOutputCount || b.downstreamModuleCount - a.downstreamModuleCount;
    })
    .slice(0, 12)
    .map(b => ({
      moduleId: b.moduleId,
      moduleName: b.moduleName,
      reason: b.downstreamOutputCount > 0
        ? `Validate ${b.downstreamOutputCount} downstream output module${b.downstreamOutputCount === 1 ? '' : 's'}.`
        : 'Business-facing output module; verify displayed values after remediation.',
      downstreamModules: b.downstreamModules.slice(0, 8),
    }));
}

export function buildEvidenceSummary(normalized, findings, blastRadius) {
  const topDomains = Object.entries(findings.reduce((acc, f) => {
    acc[f.domain] = (acc[f.domain] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 2);
  const topImpact = blastRadius[0];
  const domainText = topDomains.length
    ? topDomains.map(([domain, count]) => `${count} ${domain}`).join(' and ')
    : 'no deterministic';
  const impactText = topImpact && topImpact.downstreamModuleCount > 0
    ? ` Highest blast radius is ${topImpact.moduleName}, which feeds ${topImpact.downstreamModuleCount} downstream module${topImpact.downstreamModuleCount === 1 ? '' : 's'}.`
    : '';
  return `This model contains ${normalized.modules.length} modules and ${normalized.modules.reduce((sum, m) => sum + m.lineItemCount, 0)} line items. The deterministic scan found ${findings.length} underlying findings, led by ${domainText} issue${findings.length === 1 ? '' : 's'}.${impactText}`;
}

export function buildModelIntelligence(normalized, findings) {
  const graph = buildDependencyGraph(normalized);
  const architecture = buildArchitectureClassification(normalized, graph);
  const blastRadius = buildBlastRadius(normalized, graph);
  const prioritizedFindings = prioritizeFindings(findings, blastRadius);
  return {
    graph,
    architecture,
    blastRadius: blastRadius.slice(0, 20),
    prioritizedFindings: prioritizedFindings.slice(0, 30),
    remediationPlan: buildRemediationPlan(prioritizedFindings),
    regressionChecklist: buildRegressionChecklist(blastRadius),
    evidenceSummary: buildEvidenceSummary(normalized, findings, blastRadius),
  };
}

export function findingToSuggestion(finding) {
  return {
    moduleId: finding.moduleId,
    moduleName: finding.moduleName,
    lineItemId: finding.lineItemId,
    lineItemName: finding.lineItemName,
    domain: finding.domain,
    triage: finding.triage,
    text: finding.title,
    reasoning: finding.reasoning,
    action: finding.action,
    builderNote: finding.evidence,
    evidence: finding.evidence,
    source: 'deterministic',
    ruleId: finding.ruleId,
    affectedCount: finding.affectedCount || 1,
    affectedModuleCount: finding.affectedModuleCount || 1,
    examples: finding.examples || [],
  };
}

export function buildAnalysisSnapshot(blueprint) {
  const normalized = normalizeBlueprint(blueprint);
  const findings = scanDeterministicFindings(normalized);
  const displayFindings = summarizeFindingsForSuggestions(findings);
  const score = scoreFindings(findings);
  const intelligence = buildModelIntelligence(normalized, findings);
  return {
    normalized,
    findings,
    displayFindings,
    deterministicSuggestions: displayFindings.map(findingToSuggestion),
    score,
    intelligence,
  };
}
