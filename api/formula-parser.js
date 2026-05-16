// ─── Formula Parser ──────────────────────────────────────────────────────────
// Extracts structured references from Anaplan formula text.
// Produces: cross-module refs, intra-module refs, dimensional ops, temporal ops, literals.

const ANAPLAN_KEYWORDS = new Set([
  'IF', 'THEN', 'ELSE', 'AND', 'OR', 'NOT',
  'MAX', 'MIN', 'SUM', 'ROUND', 'ABS', 'YEARVALUE', 'MONTHVALUE',
  'PREVIOUS', 'NEXT', 'OFFSET', 'ITEM', 'LOOKUP', 'SELECT',
  'FINDITEM', 'ISBLANK', 'ISERROR', 'ISNOTBLANK',
  'LENGTH', 'TRIM', 'TEXT', 'VALUE', 'MOD', 'POWER', 'LOG', 'EXP', 'SQRT',
  'WEEKVALUE', 'DAYVALUE', 'DATE', 'PERIOD', 'START', 'END',
  'FIRSTNONBLANK', 'LASTNONBLANK', 'RANK', 'CUMULATE',
  'MOVINGSUM', 'POST', 'COLLECT', 'ALL', 'ANY', 'NONE',
  'NAME', 'CODE', 'PARENT', 'CURRENTVERSION',
  'TRUE', 'FALSE',
]);

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function classifyContext(formula, refIndex) {
  const before = formula.slice(Math.max(0, refIndex - 50), refIndex).toUpperCase();
  if (/\b(PREVIOUS|NEXT|OFFSET)\s*\(\s*$/.test(before)) return 'temporal';
  if (/\[\s*(SUM|LOOKUP)\s*:\s*$/.test(before)) return 'aggregation';
  if (/\b(IF|AND|OR|NOT)\s+[^,]*$/.test(before)) return 'conditional';
  return 'direct';
}

export function extractCrossModuleRefs(formula, knownModuleNames) {
  const refs = [];
  if (!formula) return refs;

  // Pattern 1: 'Module Name'.'Item Name' (both quoted)
  const QUOTED_BOTH = /'([^']+)'\.(?:'([^']+)')/g;
  for (const match of formula.matchAll(QUOTED_BOTH)) {
    const moduleName = match[1];
    const itemName = match[2];
    if (knownModuleNames.has(moduleName)) {
      refs.push({ moduleName, itemName, context: classifyContext(formula, match.index) });
    }
  }

  // Pattern 2: 'Module Name'.ItemName (module quoted, item unquoted)
  const QUOTED_MODULE = /'([^']+)'\.([A-Za-z][\w\s?%]*?)(?=[\s,\]\)\+\-\*\/=<>]|$)/g;
  for (const match of formula.matchAll(QUOTED_MODULE)) {
    const moduleName = match[1];
    const itemName = match[2].trim();
    if (!knownModuleNames.has(moduleName)) continue;
    // Skip if this was already captured by QUOTED_BOTH (item starts with quote char)
    if (refs.some(r => r.moduleName === moduleName && r.itemName === itemName)) continue;
    refs.push({ moduleName, itemName, context: classifyContext(formula, match.index) });
  }

  // Pattern 3: Unquoted Module.Item (no spaces in module name — rare)
  for (const modName of knownModuleNames) {
    if (modName.includes(' ') || modName.includes("'")) continue;
    const pattern = new RegExp(`\\b${escapeRegex(modName)}\\.([A-Za-z][\\w ]*?)(?=[\\s,\\]\\)\\+\\-\\*\\/=<>]|$)`, 'g');
    for (const match of formula.matchAll(pattern)) {
      const itemName = match[1].trim();
      if (!refs.some(r => r.moduleName === modName && r.itemName === itemName)) {
        refs.push({ moduleName: modName, itemName, context: classifyContext(formula, match.index) });
      }
    }
  }

  return refs;
}

export function extractIntraModuleRefs(formula, siblingNames, selfName) {
  const refs = [];
  if (!formula || !siblingNames.length) return refs;

  // Clean the formula: remove cross-module refs, string literals, and keywords
  let cleaned = formula;
  // Remove quoted cross-module refs
  cleaned = cleaned.replace(/'[^']+'\.'[^']+'/g, '\x00'.repeat(10));
  cleaned = cleaned.replace(/'[^']+'\.[A-Za-z][\w\s?%]*/g, '\x00'.repeat(10));
  // Remove string literals
  cleaned = cleaned.replace(/"[^"]*"/g, '\x00'.repeat(5));

  // Sort siblings by length descending (match longest first to avoid partial matches)
  const sorted = siblingNames
    .filter(n => n !== selfName && n.length > 1)
    .sort((a, b) => b.length - a.length);

  const matched = new Set();

  for (const name of sorted) {
    // Check for quoted reference: 'Item Name'
    const quotedPattern = `'${name}'`;
    if (cleaned.includes(quotedPattern)) {
      refs.push({ itemName: name, context: classifyContext(formula, formula.indexOf(name)) });
      matched.add(name);
      cleaned = cleaned.split(quotedPattern).join('\x00'.repeat(name.length + 2));
      continue;
    }

    // Check for bare reference (only if name doesn't look like a keyword)
    if (ANAPLAN_KEYWORDS.has(name.toUpperCase())) continue;
    if (name.length <= 2) continue;

    // Build a pattern that respects word boundaries
    // Anaplan item names can contain spaces, ?, %, digits
    const escaped = escapeRegex(name);
    // Use negative lookbehind/ahead for alphanumeric to avoid partial matches
    try {
      const re = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'g');
      if (re.test(cleaned)) {
        refs.push({ itemName: name, context: classifyContext(formula, formula.indexOf(name)) });
        matched.add(name);
        cleaned = cleaned.replace(re, '\x00'.repeat(name.length));
      }
    } catch {
      // Regex construction failed for unusual name — skip
    }
  }

  return refs;
}

export function extractDimensionalOps(formula) {
  const ops = [];
  if (!formula) return ops;

  // Match [SUM: ...] and [LOOKUP: ...] clauses — can have multiple comma-separated
  const BRACKET_CLAUSE = /\[(SUM|LOOKUP):\s*(?:'([^']+)'\.)?(?:'([^']+)'|([A-Za-z][\w\s?%]*))/g;
  for (const match of formula.matchAll(BRACKET_CLAUSE)) {
    const type = match[1];
    const targetModule = match[2] || null;
    const targetItem = (match[3] || match[4] || '').trim();
    if (targetItem) {
      ops.push({ type, targetModule, targetItem });
    }
  }
  return ops;
}

export function extractTemporalOps(formula, selfName) {
  const ops = [];
  if (!formula) return ops;

  // PREVIOUS(...) and NEXT(...)
  const PREV_NEXT = /\b(PREVIOUS|NEXT)\(\s*(?:'([^']+)'|([A-Za-z][\w\s?%]*))/g;
  for (const match of formula.matchAll(PREV_NEXT)) {
    const type = match[1];
    const target = (match[2] || match[3] || '').trim();
    ops.push({ type, targetItem: target, isSelfRef: target === selfName });
  }

  // OFFSET(ref, periods, ...)
  const OFFSET_RE = /\bOFFSET\(\s*(?:'([^']+)'\.)?(?:'([^']+)'|([A-Za-z][\w\s?%]*))\s*,\s*(-?\d+)/g;
  for (const match of formula.matchAll(OFFSET_RE)) {
    ops.push({
      type: 'OFFSET',
      targetModule: match[1] || null,
      targetItem: (match[2] || match[3] || '').trim(),
      offset: parseInt(match[4]),
    });
  }

  return ops;
}

export function extractLiterals(formula, knownListMembers) {
  const literals = [];
  if (!formula) return literals;

  // Pattern: ITEM('ListName') = 'ListName'.MemberName
  const MEMBER_CMP = /ITEM\(\s*'([^']+)'\s*\)\s*=\s*'([^']+)'\.(?:'([^']+)'|([A-Za-z][\w\s]*))/g;
  for (const match of formula.matchAll(MEMBER_CMP)) {
    const listName = match[1];
    const memberName = (match[3] || match[4] || '').trim();
    if (memberName) {
      const members = knownListMembers?.get(listName);
      const validated = members ? members.includes(memberName) : null;
      literals.push({ value: memberName, listName, validated });
    }
  }

  // [SELECT: 'List'.'Member'] or [SELECT: 'Versions'.'Actual']
  const SELECT_MEMBER = /\[SELECT:\s*'([^']+)'\.(?:'([^']+)'|([A-Za-z][\w\s]*))/g;
  for (const match of formula.matchAll(SELECT_MEMBER)) {
    const listName = match[1];
    const memberName = (match[2] || match[3] || '').trim();
    if (memberName) {
      const members = knownListMembers?.get(listName);
      const validated = members ? members.includes(memberName) : null;
      literals.push({ value: memberName, listName, validated });
    }
  }

  // Hardcoded string in SELECT without list context: SELECT: Module.'member'
  const SELECT_HARDCODED = /\[SELECT:\s*(?!'[^']*'\.)(?:[^']*?)'([^']+)'/g;
  for (const match of formula.matchAll(SELECT_HARDCODED)) {
    if (!literals.some(l => l.value === match[1])) {
      literals.push({ value: match[1], listName: null, validated: null });
    }
  }

  return literals;
}

export function parseFormula(formula, { selfName, siblingNames, knownModuleNames, knownListMembers } = {}) {
  const crossModuleRefs = extractCrossModuleRefs(formula, knownModuleNames || new Set());
  const intraModuleRefs = extractIntraModuleRefs(formula, siblingNames || [], selfName);
  const dimensionalOps = extractDimensionalOps(formula);
  const temporalOps = extractTemporalOps(formula, selfName);
  const literals = extractLiterals(formula, knownListMembers);

  const isSelfReferencing = temporalOps.some(op => op.isSelfRef);
  const isAccumulation = isSelfReferencing && temporalOps.some(op => op.type === 'PREVIOUS' && op.isSelfRef);
  const hasConditionals = /\bIF\b/i.test(formula);
  const conditionalBranches = (formula.match(/\bIF\b/gi) || []).length;
  const hasHardcodedMembers = literals.length > 0;

  return {
    crossModuleRefs,
    intraModuleRefs,
    dimensionalOps,
    temporalOps,
    literals,
    isSelfReferencing,
    isAccumulation,
    hasConditionals,
    conditionalBranches,
    hasHardcodedMembers,
    referencedModuleCount: new Set(crossModuleRefs.map(r => r.moduleName)).size,
    referencedItemCount: crossModuleRefs.length + intraModuleRefs.length,
  };
}

export function parseAllFormulas(modules, knownListMembers) {
  const knownModuleNames = new Set(modules.map(m => m.name));
  const parsed = new Map();

  for (const mod of modules) {
    const siblingNames = mod.lineItems.map(li => li.name);

    for (const li of mod.lineItems) {
      if (!li.hasFormula) continue;
      const result = parseFormula(li.formula, {
        selfName: li.name,
        siblingNames,
        knownModuleNames,
        knownListMembers,
      });
      parsed.set(`${mod.id}::${li.name}`, {
        moduleId: mod.id,
        moduleName: mod.name,
        lineItemName: li.name,
        ...result,
      });
    }
  }

  return parsed;
}
