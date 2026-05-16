const DOMAIN_FOR_RULE = {
  MODULE_NAMING_PATTERN: 'Naming',
  MODULE_DATA_HAS_CALC: 'Structural',
  MODULE_TOO_MANY_DIMS: 'Structural',
  MODULE_MONOLITHIC: 'Structural',
  BOOLEAN_SUMMARY_INVALID: 'Best Practice',
  RATE_SUMMARY_SUM: 'Best Practice',
  SUMMARY_LOOKUP_NOT_NONE: 'Best Practice',
  FORMULA_SUM_LOOKUP: 'Formula',
  FORMULA_SELECT_HARDCODED: 'Formula',
  FORMULA_NESTED_IF: 'Formula',
  FORMULA_LONG: 'Formula',
  FORMULA_DIVISION_UNGUARDED: 'Formula',
  FORMULA_FINDITEM_EXPENSIVE: 'Formula',
  FORMULA_IF_SHOULD_BE_BOOLEAN_GATE: 'Formula',
  FORMULA_LONG_LOOKUP_CHAIN: 'Formula',
  TEXT_FORMAT_USED: 'Best Practice',
  BOOLEAN_NAME_WEAK: 'Naming',
  ARCH_DATA_MODULE_HAS_FORMULAS: 'Structural',
  ARCH_CALC_MODULE_STORES_INPUTS: 'Structural',
  ARCH_OUTPUT_MODULE_NO_DERIVED_VALUES: 'Structural',
  ARCH_MIXED_RESPONSIBILITY_MODULE: 'Structural',
  ARCH_NAME_BEHAVIOR_MISMATCH: 'Structural',
  ARCH_OUTPUT_READS_RAW_LAYER: 'Structural',
  ARCH_DAT_NO_IMPORT: 'Structural',
  ARCH_INP_TOO_MANY_FORMULAS: 'Structural',
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

const RULE_SCORE_CONFIG = {
  MODULE_NAMING_PATTERN: { scope: 'module', cap: 10, sensitivity: 1.2 },
  MODULE_DATA_HAS_CALC: { scope: 'module', cap: 18, sensitivity: 2.2 },
  MODULE_TOO_MANY_DIMS: { scope: 'module', cap: 24, sensitivity: 3.2 },
  MODULE_MONOLITHIC: { scope: 'module', cap: 16, sensitivity: 2.0 },
  BOOLEAN_SUMMARY_INVALID: { scope: 'lineItem', cap: 14, sensitivity: 3 },
  RATE_SUMMARY_SUM: { scope: 'lineItem', cap: 22, sensitivity: 4 },
  SUMMARY_LOOKUP_NOT_NONE: { scope: 'lineItem', cap: 8, sensitivity: 1.5 },
  FORMULA_SUM_LOOKUP: { scope: 'lineItem', cap: 18, sensitivity: 3.4 },
  FORMULA_SELECT_HARDCODED: { scope: 'lineItem', cap: 18, sensitivity: 3.4 },
  FORMULA_NESTED_IF: { scope: 'lineItem', cap: 12, sensitivity: 2.2 },
  FORMULA_LONG: { scope: 'lineItem', cap: 10, sensitivity: 1.5 },
  FORMULA_DIVISION_UNGUARDED: { scope: 'lineItem', cap: 14, sensitivity: 2.6 },
  FORMULA_FINDITEM_EXPENSIVE: { scope: 'lineItem', cap: 20, sensitivity: 3.5 },
  FORMULA_IF_SHOULD_BE_BOOLEAN_GATE: { scope: 'lineItem', cap: 12, sensitivity: 2.0 },
  FORMULA_LONG_LOOKUP_CHAIN: { scope: 'lineItem', cap: 16, sensitivity: 2.8 },
  TEXT_FORMAT_USED: { scope: 'lineItem', cap: 4, sensitivity: 1 },
  BOOLEAN_NAME_WEAK: { scope: 'lineItem', cap: 4, sensitivity: 1 },
  ARCH_DATA_MODULE_HAS_FORMULAS: { scope: 'module', cap: 18, sensitivity: 2.2 },
  ARCH_CALC_MODULE_STORES_INPUTS: { scope: 'module', cap: 12, sensitivity: 1.8 },
  ARCH_OUTPUT_MODULE_NO_DERIVED_VALUES: { scope: 'module', cap: 3, sensitivity: 1 },
  ARCH_MIXED_RESPONSIBILITY_MODULE: { scope: 'module', cap: 14, sensitivity: 2 },
  ARCH_NAME_BEHAVIOR_MISMATCH: { scope: 'module', cap: 12, sensitivity: 1.8 },
  ARCH_OUTPUT_READS_RAW_LAYER: { scope: 'module', cap: 20, sensitivity: 2.8 },
  ARCH_DAT_NO_IMPORT: { scope: 'module', cap: 10, sensitivity: 1.5 },
  ARCH_INP_TOO_MANY_FORMULAS: { scope: 'module', cap: 14, sensitivity: 2.0 },
};

const DIMENSION_WEIGHTS = {
  architecture: 0.25,
  naming: 0.15,
  formulas: 0.3,
  dataHygiene: 0.2,
  governance: 0.1,
};

const SUGGESTION_SEVERITY_ORDER = {
  critical: 0,
  warning: 1,
  info: 2,
};

const MAX_SUGGESTION_CARDS = 20;
const EXAMPLE_LIMIT = 6;
const MAX_WORKSTREAMS = 6;
const WORKSTREAM_EVIDENCE_LIMIT = 8;
const DECORATIVE_MARK_RE = /[▼▲▶◀▾▴▸◂◆◇]{2,}/;

const DIMENSION_RULES = {
  architecture: new Set(['MODULE_NAMING_PATTERN', 'MODULE_DATA_HAS_CALC', 'MODULE_TOO_MANY_DIMS', 'MODULE_MONOLITHIC', 'ARCH_DATA_MODULE_HAS_FORMULAS', 'ARCH_CALC_MODULE_STORES_INPUTS', 'ARCH_OUTPUT_MODULE_NO_DERIVED_VALUES', 'ARCH_MIXED_RESPONSIBILITY_MODULE', 'ARCH_NAME_BEHAVIOR_MISMATCH', 'ARCH_OUTPUT_READS_RAW_LAYER', 'ARCH_DAT_NO_IMPORT', 'ARCH_INP_TOO_MANY_FORMULAS']),
  naming: new Set(['MODULE_NAMING_PATTERN', 'BOOLEAN_NAME_WEAK']),
  formulas: new Set(['FORMULA_SUM_LOOKUP', 'FORMULA_SELECT_HARDCODED', 'FORMULA_NESTED_IF', 'FORMULA_LONG', 'FORMULA_DIVISION_UNGUARDED', 'FORMULA_FINDITEM_EXPENSIVE', 'FORMULA_IF_SHOULD_BE_BOOLEAN_GATE', 'FORMULA_LONG_LOOKUP_CHAIN']),
  dataHygiene: new Set(['BOOLEAN_SUMMARY_INVALID', 'RATE_SUMMARY_SUM', 'SUMMARY_LOOKUP_NOT_NONE', 'TEXT_FORMAT_USED']),
  governance: new Set(['MODULE_NAMING_PATTERN', 'MODULE_DATA_HAS_CALC', 'FORMULA_LONG', 'ARCH_NAME_BEHAVIOR_MISMATCH', 'ARCH_OUTPUT_READS_RAW_LAYER', 'ARCH_DAT_NO_IMPORT']),
};

const BOOLEAN_PREFIX_RE = /^(Is|Has|Can|Should|Use|Enable|Allow|Include|Exclude|Requires?)\b/i;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

export function isDecorativeModuleName(name) {
  const value = text(name);
  if (!value) return true;
  if (DECORATIVE_MARK_RE.test(value)) return true;
  if (/^[-=_*.\s]{3,}$/.test(value)) return true;
  const letters = value.replace(/[^A-Za-z0-9]/g, '');
  const symbols = value.replace(/[A-Za-z0-9\s]/g, '');
  return value.length >= 6 && letters.length > 0 && symbols.length / value.length > 0.45;
}

function isDecorativeLineItem(li) {
  const name = text(li?.name);
  const style = upper(li?.style || li?.styleName || li?.itemStyle || li?.lineItemStyle);
  return !name || style === 'HEADING1' || style === 'HEADING 1' || isDecorativeModuleName(name);
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
  const normalizedModules = [];
  const excludedModules = [];
  for (const mod of modules) {
    const moduleName = text(mod?.name);
    if (mod?.fetchError || !Array.isArray(mod?.lineItems)) {
      excludedModules.push({
        id: text(mod?.id),
        name: moduleName,
        reason: mod?.fetchError ? 'fetch_error' : 'missing_line_items',
      });
      continue;
    }
    if (isDecorativeModuleName(moduleName)) {
      excludedModules.push({ id: text(mod?.id), name: moduleName, reason: 'decorative_separator' });
      continue;
    }

    const lineItems = mod.lineItems.filter(li => !isDecorativeLineItem(li)).map(li => {
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
    if (!lineItems.length) {
      excludedModules.push({ id: text(mod?.id), name: moduleName, reason: 'empty_or_header_only' });
      continue;
    }
    const widestLineItem = lineItems.reduce(
      (widest, li) => li.dimensionCount > widest.dimensionCount ? li : widest,
      { dimensionCount: 0, dimensions: [] }
    );
    const moduleDims = widestLineItem.dimensions;
    const prefix = (moduleName.match(/^([A-Z]{2,4})(?:\d{2}|\.)/) || [])[1] || '';
    normalizedModules.push({
      id: text(mod.id),
      name: moduleName,
      lineItemCount: lineItems.length,
      prefix,
      dimensions: moduleDims,
      dimensionCount: widestLineItem.dimensionCount,
      lineItems,
    });
  }
  return {
    modelId: blueprint?.modelId || '',
    workspaceId: blueprint?.workspaceId || '',
    partialLoad: Boolean(blueprint?.partialLoad),
    rawModuleCount: modules.length,
    excludedModules,
    modules: normalizedModules,
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

      if (li.formulaLength > 500) {
        findings.push(finding({
          ruleId: 'FORMULA_LONG',
          severity: li.formulaLength > 1200 ? 'critical' : 'warning',
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

      // ── FINDITEM in formula (expensive — forces list scan per cell) ──
      if (li.hasFormula && /\bFINDITEM\s*\(/i.test(li.formula)) {
        const dimCount = li.dimensionCount || module.dimensionCount || 0;
        findings.push(finding({
          ruleId: 'FORMULA_FINDITEM_EXPENSIVE',
          severity: dimCount >= 3 ? 'critical' : 'warning',
          module,
          lineItem: li,
          title: 'FINDITEM in calculation formula',
          evidence: `${li.name} uses FINDITEM${dimCount >= 3 ? ` in a ${dimCount}-dimensional module — list scan runs per cell intersection` : ''}.`,
          action: 'Pre-map via a SYS mapping module with LOOKUP instead of runtime FINDITEM.',
        }));
      }

      // ── IF/THEN in high-cell module where boolean gate is preferable ──
      if (li.hasFormula && li.ifDepth >= 1 && li.ifDepth <= 3 && module.dimensionCount >= 3) {
        // Only flag IF usage in high-dimensional modules (where boolean multiplication is faster)
        const formulaUpper = li.formula.toUpperCase();
        if (/\bIF\b/.test(formulaUpper) && /\bTHEN\b/.test(formulaUpper)) {
          findings.push(finding({
            ruleId: 'FORMULA_IF_SHOULD_BE_BOOLEAN_GATE',
            severity: 'info',
            module,
            lineItem: li,
            title: 'IF/THEN in high-dimensional module',
            evidence: `${li.name} uses IF logic in a ${module.dimensionCount}-dimension module. Boolean gate pattern (Value * Flag) is more performant at scale.`,
            action: 'Replace IF condition THEN value ELSE 0 with: value * BooleanFlag (pre-calculated in a SYS module).',
          }));
        }
      }

      // ── Long LOOKUP chains (>3 cross-module refs in one formula) ──
      if (li.hasFormula) {
        const lookupMatches = li.formula.match(/\[\s*(LOOKUP|SUM)\s*:/gi);
        const crossModRefs = li.formula.match(/'[^']+'\./g);
        const chainLength = Math.max(lookupMatches?.length || 0, crossModRefs?.length || 0);
        if (chainLength >= 4) {
          findings.push(finding({
            ruleId: 'FORMULA_LONG_LOOKUP_CHAIN',
            severity: chainLength >= 6 ? 'critical' : 'warning',
            module,
            lineItem: li,
            title: 'Long cross-module reference chain',
            evidence: `${li.name} has ${chainLength} cross-module references/lookups in one formula — long DAG path slows recalculation.`,
            action: 'Cache intermediate values in a SYS module. Read once, reference locally.',
          }));
        }
      }

      // ── LOOKUP reference line item without summary=NONE ──
      if (li.hasFormula && /\[\s*LOOKUP\s*:/i.test(li.formula) && !li.formulaLength > 200) {
        // Simple lookup formulas (short, single LOOKUP) that aren't set to NONE
        const summaryUpper = (li.summaryMethod || '').toUpperCase();
        if (summaryUpper && summaryUpper !== 'NONE' && li.formulaLength < 150) {
          findings.push(finding({
            ruleId: 'SUMMARY_LOOKUP_NOT_NONE',
            severity: 'info',
            module,
            lineItem: li,
            title: 'Lookup reference aggregates unnecessarily',
            evidence: `${li.name} is a LOOKUP reference with summary method ${li.summaryMethod} — parent totals are meaningless for mapped attributes.`,
            action: 'Set summary method to NONE for lookup/mapping line items to save rollup computation.',
          }));
        }
      }
    }

    // ── MODULE-LEVEL: Monolithic module (>20 line items + multi-dimensional) ──
    if (module.lineItemCount > 20 && module.dimensionCount >= 3) {
      findings.push(finding({
        ruleId: 'MODULE_MONOLITHIC',
        severity: module.lineItemCount > 40 ? 'critical' : 'warning',
        module,
        title: 'Monolithic module — too many line items with high dimensionality',
        evidence: `${module.name} has ${module.lineItemCount} line items across ${module.dimensionCount} dimensions. Cell count multiplies with each dimension.`,
        action: 'Split by DISCO purpose into single-responsibility modules. Separate inputs, calculations, and outputs.',
      }));
    }

    // ── INP module with too many formulas (>40% formula ratio) ──
    if (/^INP\d{2}/.test(module.name)) {
      const formulaCount = module.lineItems.filter(li => li.hasFormula).length;
      const ratio = module.lineItemCount > 0 ? formulaCount / module.lineItemCount : 0;
      if (ratio > 0.4 && formulaCount >= 3) {
        findings.push(finding({
          ruleId: 'ARCH_INP_TOO_MANY_FORMULAS',
          severity: 'warning',
          module,
          title: 'Input module contains excessive calculation logic',
          evidence: `${module.name} has ${formulaCount}/${module.lineItemCount} line items with formulas (${Math.round(ratio * 100)}%). INP modules should primarily store user inputs.`,
          action: 'Move calculation logic into a CAL module. Keep INP modules focused on data entry with minimal validation formulas.',
        }));
      }
    }

    // ── DAT module without a matching import (orphaned data staging) ──
    if (/^DAT\d{2}/.test(module.name) && normalized._enrichment) {
      const importNames = (normalized._enrichment.imports || []).map(i => i.name.toUpperCase());
      const modNameUpper = module.name.toUpperCase();
      const hasMatchingImport = importNames.some(imp =>
        imp.includes(modNameUpper.replace(/^DAT\d{2}\s*/, '')) ||
        modNameUpper.includes(imp.replace(/^IMPORT\s*/i, '').slice(0, 15))
      );
      if (!hasMatchingImport && importNames.length > 0) {
        findings.push(finding({
          ruleId: 'ARCH_DAT_NO_IMPORT',
          severity: 'info',
          module,
          title: 'Data module has no matching import action',
          evidence: `${module.name} is prefixed DAT (data staging) but no import action name matches it. May be orphaned or manually populated.`,
          action: 'Verify this module has a data source. If manual entry, rename to INP. If obsolete, remove.',
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

export function scoreFindings(findings, normalized = null) {
  const dimensions = {};
  for (const [dimension, rules] of Object.entries(DIMENSION_RULES)) {
    const dimFindings = findings.filter(f => rules.has(f.ruleId));
    const dimPenalty = densityPenalty(dimFindings, normalized);
    let dimScore = Math.max(25, Math.round(100 - dimPenalty));
    if (dimFindings.length > 0) dimScore = Math.min(dimScore, 94);
    if (dimFindings.some(f => f.severity === 'warning')) dimScore = Math.min(dimScore, 89);
    if (dimFindings.some(f => f.severity === 'critical')) dimScore = Math.min(dimScore, 84);
    dimensions[dimension] = dimScore;
  }
  let healthScore = Math.round(Object.entries(DIMENSION_WEIGHTS).reduce(
    (sum, [dimension, weight]) => sum + (dimensions[dimension] ?? 100) * weight,
    0
  ));
  if (findings.length > 0) healthScore = Math.min(healthScore, 94);
  if (findings.some(f => f.severity === 'warning')) healthScore = Math.min(healthScore, 89);
  const criticalRules = new Set(findings.filter(f => f.severity === 'critical').map(f => f.ruleId));
  if (criticalRules.size > 0) healthScore = Math.min(healthScore, 84);
  if (
    criticalRules.has('MODULE_TOO_MANY_DIMS') ||
    (criticalRules.has('RATE_SUMMARY_SUM') && (criticalRules.has('FORMULA_SUM_LOOKUP') || criticalRules.has('FORMULA_SELECT_HARDCODED'))
  )) {
    healthScore = Math.min(healthScore, 78);
  }
  return {
    healthScore,
    verdict: healthScore >= 85 ? 'Good' : healthScore >= 55 ? 'Needs Work' : 'Critical',
    dimensions,
  };
}

function analysisSize(normalized, findings) {
  const moduleIds = new Set(findings.map(f => f.moduleId || f.moduleName).filter(Boolean));
  const lineItemIds = new Set(findings.map(f => f.lineItemId || `${f.moduleId}:${f.lineItemName}`).filter(Boolean));
  const lineItemCount = normalized?.modules?.reduce((sum, mod) => sum + (mod.lineItems?.length || 0), 0) || lineItemIds.size || findings.length || 1;
  return {
    moduleCount: normalized?.modules?.length || moduleIds.size || 1,
    lineItemCount,
  };
}

function densityPenalty(findings, normalized) {
  if (!findings.length) return 0;
  const { moduleCount, lineItemCount } = analysisSize(normalized, findings);
  const grouped = new Map();
  for (const finding of findings) {
    const key = finding.ruleId;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(finding);
  }
  let penalty = 0;
  for (const group of grouped.values()) {
    const first = group[0] || {};
    const config = RULE_SCORE_CONFIG[first.ruleId] || { scope: first.lineItemName ? 'lineItem' : 'module', cap: 8, sensitivity: 1.5 };
    const moduleHits = new Set(group.map(f => f.moduleId || f.moduleName).filter(Boolean)).size;
    const lineItemHits = new Set(group.map(f => f.lineItemId || `${f.moduleId}:${f.lineItemName}`).filter(Boolean)).size || group.length;
    const denominator = config.scope === 'module' ? moduleCount : lineItemCount;
    const affected = config.scope === 'module' ? moduleHits : lineItemHits;
    const density = Math.min(1, affected / Math.max(1, denominator));
    const severityBias = first.severity === 'critical' ? 1.12 : first.severity === 'warning' ? 1 : 0.65;
    penalty += config.cap * severityBias * (1 - Math.exp(-density * config.sensitivity));
  }
  return Math.min(75, penalty);
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

export function scanArchitectureFindings(normalized) {
  const graph = buildDependencyGraph(normalized);
  const architecture = buildArchitectureClassification(normalized, graph);
  const moduleById = new Map(normalized.modules.map(m => [m.id, m]));
  return architecture.issues.map(issue => {
    const module = moduleById.get(issue.moduleId) || { id: issue.moduleId, name: issue.moduleName };
    return finding({
      ruleId: issue.ruleId,
      severity: issue.severity,
      module,
      title: issue.title,
      evidence: issue.relatedModuleName
        ? `${issue.evidence} Related module: ${issue.relatedModuleName}.`
        : issue.evidence,
      action: issue.action,
    });
  });
}

export function buildBlastRadius(normalized, graph, options = {}) {
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
  }).filter(item => options.includeZero || item.downstreamModuleCount > 0 || item.downstreamOutputCount > 0).sort((a, b) =>
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
      rules: new Set(['MODULE_DATA_HAS_CALC', 'MODULE_TOO_MANY_DIMS', 'ARCH_DATA_MODULE_HAS_FORMULAS', 'ARCH_CALC_MODULE_STORES_INPUTS', 'ARCH_OUTPUT_MODULE_NO_DERIVED_VALUES', 'ARCH_MIXED_RESPONSIBILITY_MODULE', 'ARCH_NAME_BEHAVIOR_MISMATCH', 'ARCH_OUTPUT_READS_RAW_LAYER']),
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

export function buildEvidenceSummary(normalized, findings, blastRadius, displayFindings = []) {
  const topDomains = Object.entries(findings.reduce((acc, f) => {
    acc[f.domain] = (acc[f.domain] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 2);
  const topImpact = blastRadius[0];
  const separatorCount = (normalized.excludedModules || []).filter(m => m.reason === 'decorative_separator' || m.reason === 'empty_or_header_only').length;
  const domainText = topDomains.length
    ? topDomains.map(([domain]) => domain).join(' and ')
    : 'no deterministic';
  const impactText = topImpact && topImpact.downstreamModuleCount > 0
    ? ` Highest blast radius is ${topImpact.moduleName}, which feeds ${topImpact.downstreamModuleCount} downstream module${topImpact.downstreamModuleCount === 1 ? '' : 's'}.`
    : '';
  const bucketText = displayFindings.length
    ? `${displayFindings.length} evidence buckets`
    : `${findings.length} deterministic finding${findings.length === 1 ? '' : 's'}`;
  const exclusionText = separatorCount
    ? ` ${separatorCount} separator or empty/header-only module${separatorCount === 1 ? ' was' : 's were'} excluded from scoring and diagrams.`
    : '';
  return `Evaluated ${normalized.modules.length} functional modules and ${normalized.modules.reduce((sum, m) => sum + m.lineItemCount, 0)} line items as ${bucketText}; strongest rule patterns are ${domainText}.${impactText}${exclusionText}`;
}

function buildExecutiveNarrative(normalized, findings, score, blastRadius, displayFindings, architecture) {
  const moduleCount = normalized.modules.length;
  const lineItemCount = normalized.modules.reduce((sum, m) => sum + m.lineItemCount, 0);
  const excluded = normalized.excludedModules || [];
  const decorativeCount = excluded.filter(m => m.reason === 'decorative_separator' || m.reason === 'empty_or_header_only').length;
  const topBuckets = displayFindings.slice(0, 3).map(f =>
    `${f.title}${f.affectedCount && f.affectedCount > 1 ? ` (${f.affectedCount} occurrences across ${f.affectedModuleCount || 1} modules)` : ''}`
  );
  const topBlast = blastRadius[0];
  const issueCount = architecture?.issues?.length || 0;
  const layerText = Object.entries(architecture?.layerCounts || {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([layer, count]) => `${count} ${layer}`)
    .slice(0, 4)
    .join(', ');

  const paragraphs = [
    `This report evaluated ${moduleCount} functional modules and ${lineItemCount} line items. ${decorativeCount ? `${decorativeCount} decorative separators or header-only modules were removed before scoring, dependency mapping, and blast-radius ranking.` : 'No decorative separator modules were included in scoring or diagrams.'}`,
    `Legacy numeric scoring is not used as the product assessment. Findings are treated as evidence signals that must be grouped into review workstreams before remediation.`,
  ];
  if (layerText || issueCount) {
    paragraphs.push(`Architecture read: ${layerText || 'layer classification is sparse'}. The structural scan found ${issueCount} architecture issue${issueCount === 1 ? '' : 's'} that should be reviewed against model-builder intent before remediation.`);
  }
  if (topBlast) {
    paragraphs.push(`Dependency read: ${topBlast.moduleName} has the highest observed blast radius, feeding ${topBlast.downstreamModuleCount} downstream module${topBlast.downstreamModuleCount === 1 ? '' : 's'}${topBlast.downstreamOutputCount ? ` including ${topBlast.downstreamOutputCount} output module${topBlast.downstreamOutputCount === 1 ? '' : 's'}` : ''}. Regression checks should start with downstream outputs rather than isolated modules.`);
  }
  if (topBuckets.length) {
    paragraphs.push(`Primary evidence buckets: ${topBuckets.join('; ')}. Treat these as review workstreams, not hundreds of individual tickets.`);
  } else {
    paragraphs.push('No evidence-backed review workstreams survived filtering. If this is unexpected, re-fetch the blueprint and confirm modules and line items were returned before trusting the result.');
  }
  return paragraphs.join('\n\n');
}

export function buildModelIntelligence(normalized, findings, score = scoreFindings(findings, normalized), displayFindings = summarizeFindingsForSuggestions(findings)) {
  const graph = buildDependencyGraph(normalized);
  const architecture = buildArchitectureClassification(normalized, graph);
  const blastRadius = buildBlastRadius(normalized, graph);
  const regressionImpact = buildBlastRadius(normalized, graph, { includeZero: true });
  const prioritizedFindings = prioritizeFindings(findings, blastRadius);
  return {
    graph,
    architecture,
    blastRadius: blastRadius.slice(0, 20),
    prioritizedFindings: prioritizedFindings.slice(0, 30),
    remediationPlan: buildRemediationPlan(prioritizedFindings),
    regressionChecklist: buildRegressionChecklist(regressionImpact),
    evidenceSummary: buildEvidenceSummary(normalized, findings, blastRadius, displayFindings),
    executiveNarrative: buildExecutiveNarrative(normalized, findings, score, blastRadius, displayFindings, architecture),
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

function moduleFootprint(normalized) {
  const lineItemCount = normalized.modules.reduce((sum, mod) => sum + mod.lineItems.length, 0);
  const formulaCount = normalized.modules.reduce((sum, mod) => sum + mod.lineItems.filter(li => li.hasFormula).length, 0);
  const inputCount = lineItemCount - formulaCount;
  const excludedDecorative = (normalized.excludedModules || []).filter(m => m.reason === 'decorative_separator' || m.reason === 'empty_or_header_only').length;
  const fetchErrorCount = (normalized.excludedModules || []).filter(m => m.reason === 'fetch_error' || m.reason === 'missing_line_items').length;
  return {
    rawModuleCount: normalized.rawModuleCount || normalized.modules.length,
    functionalModuleCount: normalized.modules.length,
    lineItemCount,
    formulaCount,
    inputCount,
    excludedDecorative,
    fetchErrorCount,
  };
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(2));
}

function gate(status, label, detail, blocks = []) {
  return { status, label, detail, blocks };
}

function plural(count, singular, pluralLabel = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

export function buildEvidenceDiagnostics(normalized, graph, architecture) {
  const footprint = moduleFootprint(normalized);
  const declared = architecture.modules.filter(m => m.declaredLayer !== 'unknown').length;
  const unknown = architecture.modules.length - declared;
  const formulaModules = normalized.modules.filter(m => m.lineItems.some(li => li.hasFormula)).length;
  const edgeCount = graph.edges.length;
  const formulaCoverage = pct(footprint.formulaCount, Math.max(1, footprint.lineItemCount));
  const dependencyDensity = pct(edgeCount, Math.max(1, formulaModules));
  const namingCoverage = pct(declared, Math.max(1, architecture.modules.length));
  const partial = normalized.partialLoad || footprint.fetchErrorCount > 0;

  const dependencyStatus = formulaModules === 0
    ? 'not_applicable'
    : edgeCount === 0
    ? 'absent'
    : edgeCount < Math.max(3, Math.ceil(normalized.modules.length * 0.08))
      ? 'weak'
      : 'usable';
  const classificationStatus = namingCoverage < 0.55
    ? 'low_confidence'
    : namingCoverage < 0.75
      ? 'limited'
      : 'usable';

  const gates = {
    dataCompleteness: partial
      ? gate('limited', 'Partial blueprint', `${footprint.fetchErrorCount} module${footprint.fetchErrorCount === 1 ? '' : 's'} were skipped or missing line items.`, ['complete_model_assessment'])
      : gate('usable', 'Blueprint fetched', 'No skipped modules were present in the fetched blueprint.'),
    dependencyGraph: dependencyStatus === 'usable'
      ? gate('usable', 'Dependency evidence usable', `${plural(edgeCount, 'cross-module formula edge')} detected across ${plural(formulaModules, 'formula-bearing module')}.`)
      : dependencyStatus === 'not_applicable'
        ? gate('not_applicable', 'No formula dependency evidence expected', 'No formula-bearing modules were present in the fetched blueprint, so dependency diagrams are not applicable.', ['dependency_map', 'blast_radius'])
      : gate(dependencyStatus, dependencyStatus === 'absent' ? 'No dependency evidence' : 'Sparse dependency evidence', `${plural(edgeCount, 'cross-module formula edge')} detected across ${plural(formulaModules, 'formula-bearing module')}. Architecture and blast-radius claims should be treated as low-confidence.`, ['dependency_map', 'blast_radius', 'architecture_flow']),
    architectureClassification: classificationStatus === 'usable'
      ? gate('usable', 'Classification evidence usable', `${Math.round(namingCoverage * 100)}% of functional modules have recognizable layer prefixes.`)
      : gate(classificationStatus, classificationStatus === 'low_confidence' ? 'Low classification confidence' : 'Limited classification confidence', `${unknown} of ${architecture.modules.length} functional modules do not have recognizable layer prefixes. DISCO-style architecture conclusions should be qualified.`, ['architecture_mix', 'layer_remediation']),
  };

  const blockedClaims = [
    'Actual model performance, recalculation time, and open time',
    'True cell count, sparsity, or Polaris calculation complexity unless exported in blueprint fields',
    'UX page usage and whether a line item is user-facing',
    'Import/export/action/process quality and scheduling',
    'ALM history, change frequency, user roles, and access controls',
  ];

  const usableClaims = [
    'Blueprint fetch completeness and separator/header exclusion',
    'Module, line-item, format, summary, formula, and applies-to facts',
    'Text-visible formula anti-patterns and summary-method risk signals',
    'Formula-reference dependency edges when module names appear in formulas',
    'Classification confidence based on naming coverage and observed line-item behavior',
  ];

  const visualizations = {
    showDependencyMap: gates.dependencyGraph.status === 'usable',
    showBlastRadius: gates.dependencyGraph.status === 'usable',
    showLayerDistribution: gates.architectureClassification.status === 'usable',
  };

  return {
    footprint,
    metrics: {
      formulaCoverage,
      dependencyDensity,
      namingCoverage,
      edgeCount,
      formulaModules,
      unknownModuleCount: unknown,
    },
    gates,
    visualizations,
    usableClaims,
    blockedClaims,
  };
}

function findingToEvidence(finding, graphImpact = null) {
  return {
    ruleId: finding.ruleId,
    severity: finding.severity,
    domain: finding.domain,
    moduleId: finding.moduleId,
    moduleName: finding.moduleName,
    lineItemId: finding.lineItemId || '',
    lineItemName: finding.lineItemName || '',
    observation: finding.title,
    evidence: finding.evidence,
    action: finding.action,
    downstreamModuleCount: graphImpact?.downstreamModuleCount || 0,
    downstreamOutputCount: graphImpact?.downstreamOutputCount || 0,
  };
}

function buildEvidenceItems(findings, blastRadius) {
  const blastByModule = new Map(blastRadius.map(b => [b.moduleId, b]));
  return findings.map(f => findingToEvidence(f, blastByModule.get(f.moduleId)));
}

function evidenceForRules(evidenceItems, rules) {
  const ruleSet = new Set(rules);
  return evidenceItems
    .filter(item => ruleSet.has(item.ruleId))
    .sort((a, b) =>
      severityWeight(b.severity) - severityWeight(a.severity) ||
      b.downstreamOutputCount - a.downstreamOutputCount ||
      b.downstreamModuleCount - a.downstreamModuleCount ||
      a.moduleName.localeCompare(b.moduleName)
    );
}

function summarizeEvidenceList(items) {
  const moduleCount = new Set(items.map(item => item.moduleId || item.moduleName).filter(Boolean)).size;
  const lineItemCount = items.filter(item => item.lineItemName).length;
  return {
    evidenceCount: items.length,
    affectedModuleCount: moduleCount,
    affectedLineItemCount: lineItemCount,
    examples: [...new Set(items
      .map(item => item.lineItemName ? `${item.moduleName}: ${item.lineItemName}` : item.moduleName)
      .filter(Boolean))]
      .slice(0, EXAMPLE_LIMIT),
  };
}

function workstreamPriority(items) {
  if (items.some(item => item.severity === 'critical' && item.downstreamOutputCount > 0)) return 'Critical';
  if (items.some(item => item.severity === 'critical')) return 'High';
  if (items.some(item => item.severity === 'warning')) return 'Medium';
  return 'Watch';
}

function workstreamTriage(priority) {
  if (priority === 'Critical' || priority === 'High') return 'Fix Now';
  if (priority === 'Medium') return 'Consider';
  return 'Monitor';
}

function makeWorkstream({ id, title, domain, evidence, whyItMatters, reviewQuestion, action, regressionChecks, priority = null, confidence = 'High', kind = 'remediation' }) {
  if (!evidence.length) return null;
  const summary = summarizeEvidenceList(evidence);
  const resolvedPriority = priority || workstreamPriority(evidence);
  const topEvidence = evidence.slice(0, WORKSTREAM_EVIDENCE_LIMIT);
  return {
    id,
    title,
    domain,
    kind,
    priority: resolvedPriority,
    triage: workstreamTriage(resolvedPriority),
    confidence,
    whyItMatters,
    reviewQuestion,
    action,
    regressionChecks,
    evidence: topEvidence,
    evidenceCount: summary.evidenceCount,
    affectedModuleCount: summary.affectedModuleCount,
    affectedLineItemCount: summary.affectedLineItemCount,
    examples: summary.examples,
  };
}

function diagnosticEvidence(id, diagnostics, observation, evidence, action) {
  return {
    ruleId: id,
    severity: 'warning',
    domain: 'Structural',
    moduleId: '',
    moduleName: 'Evidence quality',
    lineItemId: '',
    lineItemName: '',
    observation,
    evidence,
    action,
    downstreamModuleCount: 0,
    downstreamOutputCount: 0,
    diagnostics,
  };
}

function buildDiagnosticWorkstreams(diagnostics) {
  const streams = [];
  const depGate = diagnostics.gates.dependencyGraph;
  const classGate = diagnostics.gates.architectureClassification;
  const dataGate = diagnostics.gates.dataCompleteness;

  const dependencyBlocksArchitecture = depGate.status !== 'usable' && depGate.status !== 'not_applicable';
  if (dataGate.status !== 'usable' || dependencyBlocksArchitecture || classGate.status !== 'usable') {
    const evidence = [];
    if (dataGate.status !== 'usable') {
      evidence.push(diagnosticEvidence('EVIDENCE_PARTIAL_BLUEPRINT', diagnostics, dataGate.label, dataGate.detail, 'Re-fetch the blueprint or split the fetch before using the report as a complete model assessment.'));
    }
    if (dependencyBlocksArchitecture) {
      evidence.push(diagnosticEvidence('EVIDENCE_SPARSE_DEPENDENCIES', diagnostics, depGate.label, depGate.detail, 'Do not use dependency diagrams or blast-radius ranking as architecture proof until formula-reference coverage improves.'));
    }
    if (classGate.status !== 'usable') {
      evidence.push(diagnosticEvidence('EVIDENCE_LOW_CLASSIFICATION', diagnostics, classGate.label, classGate.detail, 'Treat architecture classification as a coverage limitation; ask the model owner for naming conventions and module intent before proposing redesign.'));
    }
    streams.push(makeWorkstream({
      id: 'evidence-admissibility',
      title: 'Resolve evidence limits before making architecture claims',
      domain: 'Structural',
      evidence,
      priority: dataGate.status !== 'usable' ? 'High' : 'Medium',
      confidence: 'High',
      kind: 'evidence-limit',
      whyItMatters: 'The fetched blueprint can support line-item checks, but weak dependency or naming evidence can make architecture conclusions look more certain than they are.',
      reviewQuestion: 'Is this blueprint complete enough to support architecture review, or should Meridian ask for a fuller export/API fetch before diagnosing model design?',
      action: 'Use this report for concrete line-item risks, but hold architecture remediation until dependency and classification evidence are adequate.',
      regressionChecks: [],
    }));
  }
  return streams;
}

export function buildEvidenceWorkstreams(normalized, evidenceItems, intelligence, diagnostics = null) {
  const diagnosticStreams = diagnostics ? buildDiagnosticWorkstreams(diagnostics) : [];
  const architectureConfidence = diagnostics?.gates?.dependencyGraph?.status === 'usable' && diagnostics?.gates?.architectureClassification?.status !== 'low_confidence'
    ? 'Medium'
    : 'Low';
  const architectureKind = architectureConfidence === 'Low' ? 'evidence-limit' : 'remediation';
  const workstreams = [
    ...diagnosticStreams,
    makeWorkstream({
      id: 'architecture-flow',
      title: architectureKind === 'evidence-limit'
        ? 'Qualify architecture findings before redesign'
        : 'Validate declared architecture exceptions',
      domain: 'Structural',
      evidence: evidenceForRules(evidenceItems, [
        'ARCH_OUTPUT_READS_RAW_LAYER',
        'ARCH_DATA_MODULE_HAS_FORMULAS',
        'MODULE_DATA_HAS_CALC',
        'ARCH_NAME_BEHAVIOR_MISMATCH',
        'ARCH_MIXED_RESPONSIBILITY_MODULE',
        'ARCH_CALC_MODULE_STORES_INPUTS',
      ]),
      priority: architectureConfidence === 'Low' ? 'Medium' : null,
      confidence: architectureConfidence,
      kind: architectureKind,
      whyItMatters: architectureKind === 'evidence-limit'
        ? 'The blueprint shows possible layer-boundary signals, but naming or dependency evidence is not strong enough to justify redesign recommendations.'
        : 'These observations point to layer boundaries or data-flow assumptions that affect model ownership and regression scope.',
      reviewQuestion: architectureKind === 'evidence-limit'
        ? 'Are these modules intentionally named outside DISCO, and is the formula graph complete enough to diagnose architecture?'
        : 'Do the named modules intentionally cross DISCO/Data Hub boundaries, or are they carrying logic in the wrong layer?',
      action: architectureKind === 'evidence-limit'
        ? 'Ask the model owner for naming conventions and validate formula extraction coverage before treating these as remediation items.'
        : 'Review the affected modules with the model owner, confirm intended layer ownership, then move logic only where the evidence matches design intent.',
      regressionChecks: (intelligence.regressionChecklist || []).slice(0, 5),
    }),
    makeWorkstream({
      id: 'formula-correctness',
      title: 'Refactor only formulas with concrete evidence',
      domain: 'Formula',
      evidence: evidenceForRules(evidenceItems, [
        'FORMULA_SUM_LOOKUP',
        'FORMULA_SELECT_HARDCODED',
        'FORMULA_NESTED_IF',
        'FORMULA_DIVISION_UNGUARDED',
        'FORMULA_LONG',
      ]),
      whyItMatters: 'These are text-visible formula patterns with direct calculation or maintainability risk.',
      reviewQuestion: 'Which flagged formulas are business-approved exceptions, and which should be decomposed into auditable intermediate line items?',
      action: 'Prioritize formulas that feed output modules or shared calculation modules; split complex expressions into named intermediates and validate downstream values.',
      regressionChecks: (intelligence.regressionChecklist || []).slice(0, 5),
    }),
    makeWorkstream({
      id: 'aggregation-accuracy',
      title: 'Validate rollups that can change executive numbers',
      domain: 'Best Practice',
      evidence: evidenceForRules(evidenceItems, [
        'RATE_SUMMARY_SUM',
        'BOOLEAN_SUMMARY_INVALID',
      ]),
      whyItMatters: 'Summary methods define parent aggregation, so rate-like or boolean rollups can change reported totals without looking like formula defects.',
      reviewQuestion: 'Are these summary methods intentional, or do they change rolled-up reporting values?',
      action: 'For each affected line item, confirm the intended rollup; rates should usually be recalculated from numerator and denominator, not summed.',
      regressionChecks: (intelligence.regressionChecklist || []).slice(0, 5),
    }),
    makeWorkstream({
      id: 'metadata-governance',
      title: 'Clean governance metadata without turning it into a refactor',
      domain: 'Naming',
      evidence: evidenceForRules(evidenceItems, [
        'MODULE_NAMING_PATTERN',
        'BOOLEAN_NAME_WEAK',
        'TEXT_FORMAT_USED',
      ]),
      whyItMatters: 'Naming and metadata issues affect maintainability, but they should not dominate remediation unless they block ownership or handover.',
      reviewQuestion: 'Which naming or format changes materially improve ownership, onboarding, or model-builder handover?',
      action: 'Batch low-risk metadata cleanup separately from formula and architecture changes; avoid mixing rename work with calculation remediation.',
      regressionChecks: [],
    }),
    makeWorkstream({
      id: 'dimensionality-review',
      title: 'Confirm dimensionality hotspots',
      domain: 'Structural',
      evidence: evidenceForRules(evidenceItems, [
        'MODULE_TOO_MANY_DIMS',
      ]),
      whyItMatters: 'High-dimensional modules can indicate performance and maintainability risk, but the fix depends on business dimensionality requirements.',
      reviewQuestion: 'Can any dimensions be moved to system mappings, staging modules, or lower-granularity calculations?',
      action: 'Validate dimensional necessity before splitting modules; if split, define regression checks around totals and intersections.',
      regressionChecks: (intelligence.regressionChecklist || []).slice(0, 5),
    }),
  ].filter(Boolean);

  return workstreams
    .sort((a, b) => {
      const rank = { Critical: 0, High: 1, Medium: 2, Watch: 3 };
      const kindRank = { 'evidence-limit': 0, remediation: 1 };
      return (kindRank[a.kind] ?? 1) - (kindRank[b.kind] ?? 1) ||
        rank[a.priority] - rank[b.priority] ||
        b.evidenceCount - a.evidenceCount ||
        a.title.localeCompare(b.title);
    })
    .slice(0, MAX_WORKSTREAMS);
}

function buildAssessment(workstreams, diagnostics = null) {
  const hasEvidenceLimit = workstreams.some(w => w.kind === 'evidence-limit');
  const critical = workstreams.filter(w => w.priority === 'Critical').length;
  const high = workstreams.filter(w => w.priority === 'High').length;
  const medium = workstreams.filter(w => w.priority === 'Medium').length;
  let verdict = 'Stable';
  if (hasEvidenceLimit) verdict = 'Evidence Limited';
  else if (critical > 0) verdict = 'Executive Review';
  else if (high > 0) verdict = 'Focused Review';
  else if (medium > 0) verdict = 'Builder Review';
  const depGate = diagnostics?.gates?.dependencyGraph;
  const classGate = diagnostics?.gates?.architectureClassification;
  return {
    healthScore: null,
    verdict,
    summary: hasEvidenceLimit
      ? `The blueprint supports concrete line-item checks, but ${depGate?.label || 'dependency evidence'} and ${classGate?.label || 'classification evidence'} limit architecture conclusions.`
      : critical > 0
      ? 'Evidence indicates at least one high-impact workstream that should be reviewed before this model is positioned as clean or production-grade.'
      : high > 0
        ? 'Evidence indicates focused model-builder review is warranted; no synthetic precision score is assigned.'
        : medium > 0
          ? 'Evidence indicates targeted cleanup workstreams; no synthetic precision score is assigned.'
          : 'No material evidence-backed workstreams were generated from the fetched blueprint.',
    dimensions: null,
    posture: verdict,
    confidence: hasEvidenceLimit ? 'Qualified evidence' : (workstreams.length ? 'Evidence-backed' : 'Low evidence'),
  };
}

function buildIntelligenceSummary(normalized, workstreams, intelligence, diagnostics = null) {
  const footprint = moduleFootprint(normalized);
  const top = workstreams[0];
  const depGate = diagnostics?.gates?.dependencyGraph;
  const classGate = diagnostics?.gates?.architectureClassification;
  const dependencyText = depGate
    ? `${depGate.label.toLowerCase()} (${depGate.detail})`
    : intelligence.graph.edges.length
      ? `${intelligence.graph.edges.length} formula dependency edge${intelligence.graph.edges.length === 1 ? '' : 's'}`
      : 'no formula dependency edges';
  const separatorText = footprint.excludedDecorative
    ? `${footprint.excludedDecorative} separator/header module${footprint.excludedDecorative === 1 ? '' : 's'} excluded`
    : 'no separator modules included';
  return top
    ? `Evaluated ${footprint.functionalModuleCount} functional modules and ${footprint.lineItemCount} line items; ${dependencyText}; ${classGate ? classGate.label.toLowerCase() + '; ' : ''}${separatorText}. Top workstream: ${top.title}.`
    : `Evaluated ${footprint.functionalModuleCount} functional modules and ${footprint.lineItemCount} line items; ${dependencyText}; ${separatorText}. No evidence-backed review workstream was generated.`;
}

function buildExecutiveBrief(normalized, workstreams, intelligence, assessment, diagnostics = null) {
  const footprint = moduleFootprint(normalized);
  const depGate = diagnostics?.gates?.dependencyGraph;
  const classGate = diagnostics?.gates?.architectureClassification;
  const lines = [
    `Scope reviewed: ${footprint.functionalModuleCount} functional modules, ${footprint.lineItemCount} line items, ${footprint.formulaCount} formula-bearing line items. ${footprint.excludedDecorative} separator/header-only modules were excluded from analysis.`,
    `Assessment posture: ${assessment.verdict}. Meridian is no longer assigning a fake 0-100 precision score; claims are gated by evidence quality before they become workstreams.`,
  ];
  if (diagnostics) {
    lines.push(`Evidence limits: ${depGate.label} — ${depGate.detail} ${classGate.label} — ${classGate.detail}`);
  }
  if (workstreams.length) {
    lines.push(`Primary workstreams: ${workstreams.slice(0, 3).map(w => `${w.title} (${w.priority})`).join('; ')}.`);
  } else {
    lines.push('No material workstream was generated from the available blueprint evidence. If that seems wrong, re-fetch the blueprint and verify line-item formulas and formats were returned.');
  }
  if (depGate?.status === 'usable' && intelligence.graph.edges.length) {
    const topBlast = intelligence.blastRadius[0];
    lines.push(topBlast
      ? `Dependency evidence is available from formula references. Highest observed fan-out is ${topBlast.moduleName}, feeding ${topBlast.downstreamModuleCount} downstream module${topBlast.downstreamModuleCount === 1 ? '' : 's'}.`
      : 'Dependency evidence is available from formula references, but no module has material downstream fan-out.');
  } else {
    lines.push('Dependency diagrams and blast-radius rankings are withheld because formula-reference evidence is too sparse for a reliable architecture claim.');
  }
  lines.push('Recommended use: treat this as a senior review agenda, not an auto-generated task list. Each workstream requires owner confirmation before model changes.');
  return lines.join('\n\n');
}

export function buildEvidenceBackedIntelligence(normalized, findings) {
  const graph = buildDependencyGraph(normalized);
  const architecture = buildArchitectureClassification(normalized, graph);
  const blastRadius = buildBlastRadius(normalized, graph);
  const regressionImpact = buildBlastRadius(normalized, graph, { includeZero: true });
  const diagnostics = buildEvidenceDiagnostics(normalized, graph, architecture);
  const baseIntelligence = {
    graph,
    architecture,
    blastRadius: blastRadius.slice(0, 20),
    regressionChecklist: diagnostics.visualizations.showBlastRadius ? buildRegressionChecklist(regressionImpact) : [],
    diagnostics,
    visualizations: diagnostics.visualizations,
  };
  const evidenceItems = buildEvidenceItems(findings, blastRadius);
  const workstreams = buildEvidenceWorkstreams(normalized, evidenceItems, baseIntelligence, diagnostics);
  const assessment = buildAssessment(workstreams, diagnostics);
  return {
    ...baseIntelligence,
    evidenceItems,
    workstreams,
    remediationPlan: workstreams.map(w => ({
      stage: w.title,
      rationale: w.whyItMatters,
      findingCount: w.evidenceCount,
      items: w.evidence.map(e => ({
        ruleId: e.ruleId,
        moduleName: e.moduleName,
        lineItemName: e.lineItemName,
        action: e.action,
      })),
    })),
    prioritizedFindings: evidenceItems.slice(0, 30),
    evidenceSummary: buildIntelligenceSummary(normalized, workstreams, baseIntelligence, diagnostics),
    executiveNarrative: buildExecutiveBrief(normalized, workstreams, baseIntelligence, assessment, diagnostics),
    assessment,
    footprint: moduleFootprint(normalized),
    feasibility: {
      supportedNow: diagnostics.usableClaims,
      notKnowableYet: diagnostics.blockedClaims,
      needsAdditionalData: [
        'Saved views, UX pages, and action/process metadata',
        'Model history and ALM revision metadata',
        'Cell counts, calculation complexity, and performance telemetry',
        'Business owner confirmation of naming conventions and module intent',
      ],
    },
  };
}

export function workstreamToSuggestion(workstream) {
  const firstEvidence = workstream.evidence[0] || {};
  return {
    moduleId: firstEvidence.moduleId || '',
    moduleName: workstream.affectedModuleCount > 1
      ? `${workstream.affectedModuleCount} modules`
      : (firstEvidence.moduleName || 'Model-wide'),
    lineItemId: firstEvidence.lineItemId || '',
    lineItemName: firstEvidence.lineItemName || '',
    domain: workstream.domain,
    triage: workstream.triage,
    text: workstream.title,
    reasoning: `${workstream.whyItMatters} Review question: ${workstream.reviewQuestion}`,
    action: workstream.action,
    builderNote: `${workstream.confidence} confidence from ${workstream.evidenceCount} evidence item${workstream.evidenceCount === 1 ? '' : 's'}.`,
    evidence: workstream.evidence.map(e => e.evidence).filter(Boolean).join(' | '),
    source: 'evidence-workstream',
    ruleId: workstream.id,
    kind: workstream.kind,
    priority: workstream.priority,
    confidence: workstream.confidence,
    affectedCount: workstream.evidenceCount,
    affectedModuleCount: workstream.affectedModuleCount,
    examples: workstream.examples,
    workstream,
  };
}

export function buildAnalysisSnapshot(blueprint) {
  const normalized = normalizeBlueprint(blueprint);
  const totalLineItems = normalized.modules.reduce((sum, mod) => sum + mod.lineItems.length, 0);
  if (normalized.modules.length === 0 || totalLineItems === 0) {
    const sourceModules = Array.isArray(blueprint?.modules) ? blueprint.modules.length : 0;
    const skippedModules = Array.isArray(blueprint?.modules) ? blueprint.modules.filter(mod => mod?.fetchError).length : 0;
    throw new Error(`No usable line items were fetched from the blueprint (${sourceModules} modules, ${skippedModules} skipped). Re-fetch the blueprint before analysing.`);
  }
  const findings = [...scanDeterministicFindings(normalized), ...scanArchitectureFindings(normalized)];
  const intelligence = buildEvidenceBackedIntelligence(normalized, findings);
  const displayFindings = intelligence.workstreams;
  const score = intelligence.assessment;
  return {
    normalized,
    findings,
    evidenceItems: intelligence.evidenceItems,
    workstreams: intelligence.workstreams,
    displayFindings,
    deterministicSuggestions: intelligence.workstreams.map(workstreamToSuggestion),
    score,
    intelligence,
  };
}

// ---------------------------------------------------------------------------
// Comprehension engine: three detection functions added in Plan 07-02
// ---------------------------------------------------------------------------

export function detectDeadLogic(modules, graph) {
  // Build a set of all line item names that appear as a reference target
  // in any other module's formula. Use the graph's edge lineItems arrays
  // (already computed by buildDependencyGraph) — these are the names of
  // line items whose formula references a source module.
  // But we also need the reverse: which CALC line items are referenced BY others.
  // Build a referenced-name set by scanning all module formulas directly.
  const referencedNames = new Set();
  for (const mod of modules) {
    for (const li of mod.lineItems) {
      if (!li.formula) continue;
      // Match "{ModuleName}.{ItemName}" pattern — item name after the dot
      // Use a simple indexOf scan to avoid regex DoS on large formulas.
      // Cap formula scan at 500 chars per RESEARCH.md security guidance.
      const f = li.formula.length > 500 ? li.formula.slice(0, 500) : li.formula;
      // Find all ".{word}" segments after module name patterns
      let i = 0;
      while (i < f.length) {
        const dot = f.indexOf('.', i);
        if (dot === -1) break;
        // Extract the word after the dot
        let end = dot + 1;
        while (end < f.length && /[\w\s]/.test(f[end])) end++;
        const itemName = f.slice(dot + 1, end).trim();
        if (itemName) referencedNames.add(itemName);
        i = dot + 1;
      }
    }
  }

  const dead = [];
  for (const mod of modules) {
    for (const li of mod.lineItems) {
      // Only check CALC items — inputs are user-entered, always "live"
      if (!li.hasFormula) continue;
      // Exclude truncated formulas — we cannot know their full reference set
      if (li.formulaTruncated) continue;
      if (!referencedNames.has(li.name)) {
        dead.push({
          moduleId: mod.id,
          moduleName: mod.name,
          lineItemName: li.name,
          formula: li.formula,
        });
      }
    }
  }
  return dead;
  // Callers MUST label this result as MEDIUM confidence due to formula truncation.
}

export function detectCircularDependencies(graph) {
  // Build adjacency map from graph edges (module-level)
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
      // Found a cycle — extract the cycle portion of path
      const idx = path.indexOf(node);
      if (idx !== -1) cycles.push(path.slice(idx).concat(node));
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

  for (const nodeId of adj.keys()) {
    if (!visited.has(nodeId)) dfs(nodeId, []);
  }
  return cycles; // array of module-ID arrays
}

export function detectDaisyChains(graph) {
  // Passthrough module: exactly one upstream (inDegree=1) and one downstream (outDegree=1)
  const inDegree = new Map();
  const outDegree = new Map();
  for (const edge of graph.edges) {
    outDegree.set(edge.fromModuleId, (outDegree.get(edge.fromModuleId) || 0) + 1);
    inDegree.set(edge.toModuleId, (inDegree.get(edge.toModuleId) || 0) + 1);
  }
  return [...inDegree.keys()].filter(id =>
    inDegree.get(id) === 1 && (outDegree.get(id) || 0) === 1
  );
}
