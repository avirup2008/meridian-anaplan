export const config = { maxDuration: 60 };

import { applyCors } from './_cors.js';
import { isAllowedBlobUrl } from './analyze.js';
import {
  countIfDepth,
  hasSumLookup,
  hasHardcodedSelect,
  hasUnguardedDivision,
  buildDependencyGraph,
  buildArchitectureClassification,
  buildEvidenceDiagnostics,
  scanDeterministicFindings,
  scanArchitectureFindings,
  buildEvidenceBackedIntelligence,
  detectDeadLogic,
  detectCircularDependencies,
  detectDaisyChains,
} from './analysis-core.js';
import { parseAllFormulas } from './formula-parser.js';
import { buildLineItemGraph, buildRiskClusters, detectBusinessPatterns, computeRemediationOrder } from './graph-builder.js';
import { buildModuleIntelligence, buildModelSummary } from './module-intelligence.js';

// ─── parseStateBlob ───────────────────────────────────────────────────────────
// Parses the compact tab-separated blob written by model-state.js.
// Returns { modules, enrichment } — enrichment contains lists, versions,
// imports, exports, processes extracted from the header sections.
//
// Row types:
//   LIST\t{name}\t{itemCount}
//   VERSION\t{name}
//   IMPORT\t{name}
//   EXPORT\t{name}
//   PROCESS\t{name}
//   MODULE\t{id}\t{name}\t{prefix}
//   CALC\t{name}\t{format}\t{summary}\t{formula}
//   INPUT\t{name}\t{format}\t{summary}\t
//   ITEM\t{name}\t{format}\t{summary}\t
function parseStateBlob(text) {
  const modules = [];
  const enrichment = { lists: [], versions: [], imports: [], exports: [], processes: [], listMembers: new Map() };
  let current = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line) {
      current = null;
      continue;
    }

    const parts = line.split('\t');
    const rowType = parts[0];

    if (rowType === 'MODULE') {
      current = {
        id: parts[1] || '',
        name: parts[2] || '',
        prefix: parts[3] || '',
        lineItems: [],
      };
      modules.push(current);
    } else if ((rowType === 'CALC' || rowType === 'INPUT' || rowType === 'ITEM') && current) {
      // v2 format: TYPE\tname\tformat\tsummary\tdims\tformula
      // v1 format: TYPE\tname\tformat\tsummary\tformula
      // Detect v2 by checking if parts[5] exists (formula in position 5)
      const hasV2Dims = parts.length >= 6;
      const dims = hasV2Dims ? (parts[4] || '').split('|').filter(Boolean) : [];
      const formula = hasV2Dims ? (parts[5] || '') : (parts[4] || '');
      current.lineItems.push({
        id: '',
        name: parts[1] || '',
        formatType: parts[2] || '',
        summaryMethod: parts[3] || '',
        formula,
        hasFormula: rowType === 'CALC' && formula.length > 0,
        isInput: rowType === 'INPUT',
        formulaTruncated: formula.endsWith('…'),
        dimensions: dims,
        dimensionCount: dims.length,
        notes: '',
        formulaLength: formula.length,
        ifDepth: countIfDepth(formula),
        hasSumLookup: hasSumLookup(formula),
        hasHardcodedSelect: hasHardcodedSelect(formula),
        hasUnguardedDivision: hasUnguardedDivision(formula),
      });
    } else if (rowType === 'LIST') {
      enrichment.lists.push({ name: parts[1] || '', itemCount: parseInt(parts[2] || '0', 10) });
    } else if (rowType === 'LISTMEMBERS') {
      const listName = parts[1] || '';
      const members = (parts[2] || '').split('|').filter(Boolean);
      if (listName && members.length) enrichment.listMembers.set(listName, members);
    } else if (rowType === 'VERSION') {
      enrichment.versions.push({ name: parts[1] || '' });
    } else if (rowType === 'IMPORT') {
      enrichment.imports.push({ name: parts[1] || '' });
    } else if (rowType === 'EXPORT') {
      enrichment.exports.push({ name: parts[1] || '' });
    } else if (rowType === 'PROCESS') {
      enrichment.processes.push({ name: parts[1] || '' });
    }
    // Unknown row types silently skipped — forward-compatible
  }

  return { modules, enrichment };
}

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

function moduleConfidence(mod, declaredLayer) {
  if (declaredLayer === 'unknown') {
    return { score: 0.40, label: 'Low', reason: 'No DISCO prefix recognised' };
  }
  const formulaRatio = mod.lineItems && mod.lineItems.length > 0
    ? mod.lineItems.filter(li => li.hasFormula).length / mod.lineItems.length
    : 0;
  let inferred = 'data';
  if (formulaRatio >= 0.65) inferred = 'calculation';
  else if (formulaRatio > 0.15) inferred = 'mixed';
  if (inferred !== 'mixed' && inferred !== declaredLayer) {
    return { score: 0.60, label: 'Medium', reason: 'Prefix and behaviour disagree' };
  }
  return { score: 0.90, label: 'High', reason: 'Prefix matches observed behaviour' };
}

const DISCO_LABEL = {
  data: 'DAT', system: 'SYS', calculation: 'CAL', planning: 'INP', output: 'REP', unknown: 'UNKNOWN',
};

const HEALTH_FORMAT = 'workstreams';

// ─── Domain classifier ────────────────────────────────────────────────────────
// Mirrors the classifier in model-state.js — used when enrichment is parsed from the blob.

function classifyModelDomain(listNames) {
  const lower = listNames.join(' ').toLowerCase();
  if (/employee|headcount|fte|job.grade|position|workforce|personnel|hcm/.test(lower)) return 'Workforce Planning';
  // Supply chain / S&OP checked before Sales — "product" and "customer" appear in both; only CRM-specific terms (quota, pipeline, opportunity, crm, territory) uniquely identify sales
  if (/clinical|trial|pharma|pharmaceutical|patient|dosage|formulation|flavour|flavor/.test(lower)) return 'Pharmaceutical Supply Chain';
  if (/supplier|warehouse|inventory|demand plan|supply plan|s&op|snop|lead.time|procurement|logistics|distribution|replenishment/.test(lower)) return 'Supply Chain Planning';
  if (/quota|pipeline|opportunity|crm|territory|bookings|win.rate/.test(lower)) return 'Sales & Revenue Planning';
  if (/product|sku|channel|customer/.test(lower)) return 'Sales & Revenue Planning';
  if (/project|milestone|capex|initiative|program|phase|deliverable/.test(lower)) return 'Project & Capex Planning';
  if (/entity|subsidiary|elimination|intercompany|consolidat|group/.test(lower)) return 'Financial Consolidation';
  if (/account|cost.center|gl|general.ledger|budget|forecast/.test(lower)) return 'Financial Planning & Analysis';
  return 'General Planning';
}

// ─── Formula sample extractor ─────────────────────────────────────────────────
// Selects up to maxSamples formula strings from the highest blast-radius modules.
// Prioritises formulas with the most risk flags (IF depth, SUM-IF, unguarded division).
// These are the examples passed verbatim to the AI so it can generate specific advisory.

function extractFormulaSamples(modules, blastRadiusById, maxSamples = 12) {
  const byBlast = [...modules].sort(
    (a, b) => (blastRadiusById.get(b.id) || 0) - (blastRadiusById.get(a.id) || 0),
  );

  const samples = [];

  for (const mod of byBlast) {
    if (samples.length >= maxSamples) break;

    const risky = mod.lineItems
      .filter(li => li.hasFormula && li.formula.length > 20)
      .map(li => ({
        ...li,
        riskScore:
          (li.ifDepth > 3 ? 4 : li.ifDepth > 1 ? 2 : 0) +
          (li.hasSumLookup ? 3 : 0) +
          (li.hasUnguardedDivision ? 3 : 0) +
          (li.hasHardcodedSelect ? 2 : 0) +
          Math.min(2, li.formula.length / 200),
      }))
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 2);

    for (const li of risky) {
      const flags = [];
      if (li.ifDepth > 3) flags.push(`nested IF depth ${li.ifDepth}`);
      else if (li.ifDepth > 1) flags.push(`IF depth ${li.ifDepth}`);
      if (li.hasSumLookup) flags.push('SUM-IF on list member name — rename risk');
      if (li.hasUnguardedDivision) flags.push('unguarded division — zero-data risk');
      if (li.hasHardcodedSelect) flags.push('hardcoded SELECT');
      if (li.formulaTruncated) flags.push('formula truncated at 600 chars');
      if (!flags.length) flags.push('complex formula');

      samples.push({
        module: mod.name,
        lineItem: li.name,
        formula: li.formula,
        blast: blastRadiusById.get(mod.id) || 0,
        flags,
      });
    }
  }

  return samples;
}

// ─── Deterministic health score ────────────────────────────────────────────────

function computeDeterministicHealthScore(findings, blastRadiusById, moduleCount) {
  const SEVERITY_WEIGHT = { critical: 4, warning: 2, info: 1 };
  // Cap each rule at 10 occurrences so a single repeated pattern (e.g. 331×
  // BOOLEAN_SUMMARY_INVALID) can't dominate the score by itself.
  const ruleCount = new Map();
  let penalty = 0;
  for (const f of findings) {
    const seen = (ruleCount.get(f.ruleId) || 0) + 1;
    ruleCount.set(f.ruleId, seen);
    if (seen > 10) continue;
    const w = SEVERITY_WEIGHT[f.severity] || 1;
    const blast = blastRadiusById.get(f.moduleId) || 0;
    penalty += w * (1 + blast * 0.25);
  }
  const score = Math.max(0, 100 - (penalty / Math.max(moduleCount, 1)) * 8);
  // 95 cap: even clean models show 95 — Meridian cannot verify all quality dimensions
  return Math.round(Math.min(95, score));
}

// ─── Deterministic architecture verdict ───────────────────────────────────────

function buildDeterministicVerdict(discoMap, blastRadiusTop10, findings, moduleCount, domain) {
  const unknown = discoMap.UNKNOWN || 0;
  const namingPct = moduleCount > 0 ? Math.round((1 - unknown / moduleCount) * 100) : 0;
  const criticalCount = findings.filter(f => f.severity === 'critical').length;
  const topBlast = blastRadiusTop10[0]?.downstreamCount || 0;

  const calCount = discoMap.CAL || 0;
  const datCount = discoMap.DAT || 0;
  // Only infer model type from DISCO counts when DISCO covers > 50% of modules — otherwise the sample is too small to be meaningful
  const discoKnown = moduleCount - unknown;
  const modelType = discoKnown / (moduleCount || 1) < 0.5
    ? 'mixed-prefix model'
    : calCount > datCount ? 'calculation-heavy model'
    : datCount > calCount ? 'data-staging model'
    : 'balanced model';

  const namingLabel = namingPct >= 80 ? 'well-named'
    : namingPct >= 50 ? 'partially-named'
    : namingPct >= 20 ? 'client-prefix naming'
    : 'sparse naming';

  const riskLabel = criticalCount > 5 ? 'high formula risk'
    : criticalCount > 0 ? 'moderate formula risk'
    : topBlast > 20 ? 'high blast-radius concentration'
    : 'low detected risk';

  const domainSuffix = domain && domain !== 'General Planning' ? ` (${domain})` : '';
  return `${modelType}${domainSuffix}, ${namingLabel}, ${riskLabel}`;
}

// ─── AI call: workstreams ──────────────────────────────────────────────────────
// Uses full formula samples + domain + integration context for model-specific advisory.

async function callWorkstreams({ aiClient, modules, findingSummary, blastRadiusTop10, domain, formulaSamples, enrichment }) {
  const blastLines = blastRadiusTop10
    .map(b => `  ${b.moduleName}: ${b.downstreamCount} downstream modules`)
    .join('\n');

  const formulaBlock = formulaSamples.length
    ? formulaSamples.slice(0, 5).map(s =>
        `[${s.module}].'${s.lineItem}' (blast: ${s.blast}):\n  ${s.formula}\n  ⚠ ${s.flags.join(', ')}`
      ).join('\n\n')
    : 'No formula samples available — model may not expose formula text.';

  const integrationLines = [
    enrichment.imports.length
      ? `Receives data from: ${enrichment.imports.slice(0, 5).map(i => i.name).join(', ')}`
      : '',
    enrichment.exports.length
      ? `Feeds downstream: ${enrichment.exports.slice(0, 5).map(e => e.name).join(', ')}`
      : '',
    enrichment.processes.length
      ? `Operational processes: ${enrichment.processes.slice(0, 3).map(p => p.name).join(', ')}`
      : '',
    enrichment.versions.length
      ? `Planning versions: ${enrichment.versions.map(v => v.name).join(', ')}`
      : '',
  ].filter(Boolean).join('\n');

  const listContext = enrichment.lists.length
    ? `Key dimensions: ${enrichment.lists.slice(0, 10).map(l => `${l.name} (${l.itemCount})`).join(', ')}`
    : '';

  const prompt = `You are a senior Anaplan architect writing a model review for a ${domain} model.
Your response MUST begin with { and end with }. No markdown fences. No preamble. Raw JSON only.

MODEL CONTEXT:
Domain: ${domain}
${listContext}
${integrationLines}

HIGH-RISK FORMULA SAMPLES — cite these directly, using the exact module and line item names:
${formulaBlock}

FINDINGS SUMMARY:
${findingSummary}

TOP BLAST-RADIUS MODULES:
${blastLines}

Generate exactly 3 workstreams. Each field is ONE sentence only — no conjunctions chaining multiple issues.
- title: module name + the specific defect (e.g. "Data Upload — IF depth 12 with hardcoded German months")
- problem: what the formula does wrong, naming the exact line item and pattern
- impact: what breaks downstream and where (name the affected module or export)
- fix: the specific remediation action (MONTHVALUE, COUNTIF, lookup table, guard clause, etc.)
- No generic phrases. No review questions. No "this may" or "could potentially".
- Use kind "evidence-limit" only when evidence is genuinely sparse

{"workstreams":[
{"id":"ws-1","title":"DAT01 Revenue Data — SUM-IF member name hardcode","priority":"High","confidence":"High","kind":"remediation","problem":"DAT01 Revenue Data.Net Revenue uses SUM-IF on the literal member name 'Revenue', which silently returns zero if the account list member is renamed.","impact":"14 downstream modules including the Board export receive zeroed revenue figures with no error surfaced.","fix":"Replace the hardcoded member name with a driver list lookup or a LOOKUP formula referencing a stable list item ID.","evidenceCount":14,"examples":["DAT01 Revenue Data.Net Revenue"]},
{"id":"ws-2","title":"CAL03 Margin Calc — unguarded division by volume driver","priority":"Critical","confidence":"High","kind":"remediation","problem":"CAL03 Margin Calc.Gross Margin % divides by a volume driver with no IF ISERROR or IF volume<>0 guard.","impact":"When volume data is not yet loaded, every downstream margin metric returns an error state and corrupts the CFO pack export.","fix":"Wrap the division in IF(volume<>0, numerator/volume, 0) or use IFERROR to return a safe fallback.","evidenceCount":8,"examples":["CAL03 Margin Calc.Gross Margin %"]},
{"id":"ws-3","title":"SYS02 Config — nested IF depth 6 untestable branches","priority":"Medium","confidence":"Medium","kind":"remediation","problem":"SYS02 Config.Override Logic uses IF nesting depth 6, where the deepest branches cannot be isolated or unit-tested.","impact":"Edge-case inputs silently return wrong override values, propagating incorrect config state to dependent calculation modules.","fix":"Extract the nested conditions into a driver table with a LOOKUP, reducing formula depth to 1-2 levels.","evidenceCount":6,"examples":["SYS02 Config.Override Logic"]}
]}`;

  const response = await Promise.race([
    aiClient.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1600,
      messages: [{ role: 'user', content: prompt }],
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('workstreams-timeout')), 30000)),
  ]);

  const raw = response.content?.[0]?.text?.trim() || '{}';
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) {
    console.error('[analyze-v3] workstreams: no JSON (first 200):', raw.slice(0, 200));
    throw new Error('Workstreams response contained no JSON object');
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (parseErr) {
    console.error('[analyze-v3] workstreams: JSON.parse failed, raw (first 600):', raw.slice(0, 600));
    throw parseErr;
  }
}

// ─── AI call: architecture ─────────────────────────────────────────────────────
// Uses domain + list names + integration context for grounded architecture description.

async function callArchitecture({ aiClient, modules, domain, enrichment }) {
  const moduleNames = modules.slice(0, 50).map(m => m.name).join('\n')
    + (modules.length > 50 ? `\n… and ${modules.length - 50} more` : '');

  const listContext = enrichment.lists.length
    ? enrichment.lists.slice(0, 15).map(l => `${l.name} (${l.itemCount} members)`).join(', ')
    : 'not available';

  const importContext = enrichment.imports.length
    ? enrichment.imports.slice(0, 5).map(i => i.name).join(', ')
    : '';
  const exportContext = enrichment.exports.length
    ? enrichment.exports.slice(0, 5).map(e => e.name).join(', ')
    : '';

  const prompt = `You are an Anaplan architect. Your response MUST begin with { and end with }. No markdown fences. Raw JSON only.

MODEL: ${domain}
DIMENSION LISTS: ${listContext}
${importContext ? `DATA SOURCES: ${importContext}` : ''}
${exportContext ? `DOWNSTREAM CONSUMERS: ${exportContext}` : ''}

MODULE NAMES:
${moduleNames}

Return exactly this JSON shape:
{
  "domainMap": [
    { "domainName": "string", "description": "1 sentence — use actual list and module names, not generic terms", "moduleCount": <int> }
  ],
  "integrationSeams": [
    { "moduleName": "string (must be from the module list above)", "reason": "1 phrase" }
  ],
  "architectureStory": "2 sentences: first describes what this ${domain} model calculates, naming real lists and modules; second assesses architecture maturity from naming patterns and structure"
}

RULES:
- 2-4 domains inferred from module prefixes and naming
- 1-3 integration seams at cross-domain boundaries
- architectureStory must name at least 2 specific lists or modules — no generic statements
- All module names cited must appear in the module list above`;

  const response = await Promise.race([
    aiClient.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('architecture-timeout')), 30000)),
  ]);

  const raw = response.content?.[0]?.text?.trim() || '{}';
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) {
    console.error('[analyze-v3] architecture: no JSON (first 200):', raw.slice(0, 200));
    throw new Error('Architecture response contained no JSON object');
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (parseErr) {
    console.error('[analyze-v3] architecture: JSON.parse failed, raw (first 600):', raw.slice(0, 600));
    throw parseErr;
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const stateUrl = req.body?.stateUrl;
  if (!stateUrl) return res.status(400).json({ error: 'Missing stateUrl' });
  if (!isAllowedBlobUrl(stateUrl)) {
    return res.status(400).json({ error: 'Invalid stateUrl — must be a Vercel Blob URL' });
  }

  const evidencePack = req.body?.evidencePack || null;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  function sendEvent(obj) {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  }

  try {
    sendEvent({ type: 'stage', stage: 'parsing', label: 'Fetching model state…' });

    const response = await fetch(stateUrl);
    if (!response.ok) throw new Error(`State blob fetch failed: ${response.status}`);
    const stateText = await response.text();

    sendEvent({ type: 'stage', stage: 'classifying', label: 'Parsing model state…' });

    const { modules, enrichment } = parseStateBlob(stateText);
    if (!modules.length) {
      throw new Error('State blob contains no modules — re-fetch model state');
    }

    // Classify domain from list names (available after enrichment fetch in model-state.js)
    const domain = classifyModelDomain(enrichment.lists.map(l => l.name));

    const normalized = toNormalized(modules);

    sendEvent({ type: 'stage', stage: 'graph', label: 'Building dependency graph…' });
    const graph = buildDependencyGraph(normalized);

    sendEvent({ type: 'stage', stage: 'classifying', label: 'Classifying modules…' });
    const architecture = buildArchitectureClassification(normalized, graph);
    const diagnostics = buildEvidenceDiagnostics(normalized, graph, architecture);

    const classifiedModules = architecture.modules.map(archMod => {
      const rawMod = normalized.modules.find(m => m.id === archMod.moduleId) || {};
      const discoLabel = DISCO_LABEL[archMod.declaredLayer] || 'UNKNOWN';
      const conf = moduleConfidence(rawMod, archMod.declaredLayer);
      return {
        moduleId: archMod.moduleId,
        moduleName: archMod.moduleName,
        prefix: rawMod.prefix || '',
        discoLabel,
        confidence: conf.score,
        confidenceLabel: conf.label,
        confidenceReason: conf.reason,
        formulaCount: archMod.formulaCount,
        inputCount: archMod.inputCount,
      };
    });

    const discoMap = { SYS: 0, DAT: 0, CAL: 0, REP: 0, INP: 0, UNKNOWN: 0 };
    for (const m of classifiedModules) {
      discoMap[m.discoLabel] = (discoMap[m.discoLabel] || 0) + 1;
    }

    sendEvent({ type: 'stage', stage: 'dead-logic', label: 'Detecting dead logic…' });
    const deadLogic = detectDeadLogic(normalized.modules, graph);
    const cycles = detectCircularDependencies(graph);
    const daisyChains = detectDaisyChains(graph);

    // Blast radius — downstream module count per module
    const downstreamByModule = new Map();
    for (const edge of graph.edges) {
      if (!downstreamByModule.has(edge.fromModuleId)) downstreamByModule.set(edge.fromModuleId, new Set());
      downstreamByModule.get(edge.fromModuleId).add(edge.toModuleId);
    }
    const blastRadius = normalized.modules.map(m => ({
      moduleId: m.id,
      moduleName: m.name,
      downstreamCount: (downstreamByModule.get(m.id) || new Set()).size,
    })).sort((a, b) => b.downstreamCount - a.downstreamCount);
    const blastRadiusTop10 = blastRadius.slice(0, 10);
    const blastRadiusById = new Map(blastRadius.map(b => [b.moduleId, b.downstreamCount]));

    // Extract formula samples from highest blast-radius modules — passed verbatim to AI
    const formulaSamples = extractFormulaSamples(normalized.modules, blastRadiusById);

    sendEvent({
      type: 'model-comprehension',
      modules: classifiedModules,
      graph,
      deadLogic,
      deadLogicConfidence: 'Medium',
      cycles,
      daisyChains,
      discoMap,
      blastRadiusTop10,
      domain,
    });

    // ─── Line-Item Intelligence Graph (v2 engine) ──────────────────────────────
    sendEvent({ type: 'stage', stage: 'parsing-formulas', label: 'Parsing formula references…' });
    const parsedFormulas = parseAllFormulas(modules, enrichment.listMembers);

    sendEvent({ type: 'stage', stage: 'building-graph', label: 'Building line-item graph…' });
    const lineItemGraph = buildLineItemGraph(modules, parsedFormulas);

    sendEvent({ type: 'stage', stage: 'health', label: 'Synthesizing model intelligence…' });

    const findings = [
      ...scanDeterministicFindings(normalized),
      ...scanArchitectureFindings(normalized),
    ];

    const intelligence = buildEvidenceBackedIntelligence(normalized, findings);

    // Graph-based intelligence: risk clusters, patterns, module cards, summary
    const riskClusters = buildRiskClusters(lineItemGraph, findings);
    const businessPatterns = detectBusinessPatterns(lineItemGraph);
    const moduleCards = buildModuleIntelligence(lineItemGraph, findings);
    const criticalModuleIds = moduleCards
      .filter(c => c.criticality === 'Critical' || c.criticality === 'High')
      .map(c => c.moduleId);
    const remediationOrder = computeRemediationOrder(lineItemGraph, criticalModuleIds);
    const modelSummary = buildModelSummary(lineItemGraph, moduleCards, riskClusters, businessPatterns);

    sendEvent({
      type: 'model-intelligence',
      summary: modelSummary,
      moduleCards: moduleCards.slice(0, 15),
      riskClusters: riskClusters.slice(0, 5),
      remediationOrder: remediationOrder.slice(0, 8),
      patterns: modelSummary.patterns,
      bottlenecks: modelSummary.bottlenecks,
      evidenceLimits: modelSummary.evidenceLimits,
    });

    // Build finding summary — module + line item evidence per rule category
    const byRule = {};
    for (const f of findings) {
      if (!byRule[f.ruleId]) byRule[f.ruleId] = [];
      byRule[f.ruleId].push(f);
    }
    function ruleLines(rules) {
      return rules
        .filter(r => byRule[r]?.length)
        .map(r => {
          const fs = byRule[r];
          const mods = [...new Set(fs.map(f => f.moduleName).filter(Boolean))].slice(0, 5);
          const lis  = [...new Set(fs.map(f => f.lineItemName).filter(Boolean))].slice(0, 3);
          return `  ${r}: ${fs.length} occurrences — modules: ${mods.join('; ')}${lis.length ? ` — line items: ${lis.join('; ')}` : ''}`;
        }).join('\n');
    }
    const FORMULA_RULES = ['FORMULA_SUM_LOOKUP','FORMULA_SELECT_HARDCODED','FORMULA_NESTED_IF','FORMULA_DIVISION_UNGUARDED','FORMULA_LONG'];
    const NAMING_RULES  = ['MODULE_NAMING_PATTERN','BOOLEAN_NAME_WEAK','TEXT_FORMAT_USED'];
    const ROLLUP_RULES  = ['RATE_SUMMARY_SUM','BOOLEAN_SUMMARY_INVALID'];
    const ARCH_RULES    = ['ARCH_OUTPUT_READS_RAW_LAYER','ARCH_DATA_MODULE_HAS_FORMULAS','MODULE_DATA_HAS_CALC','ARCH_CALC_MODULE_STORES_INPUTS'];
    const namingPct = evidencePack?.namingCoverage != null ? `${(evidencePack.namingCoverage*100).toFixed(0)}%` : 'unknown';

    const findingSummary = [
      `FORMULA issues (${findings.filter(f=>FORMULA_RULES.includes(f.ruleId)).length} total):\n${ruleLines(FORMULA_RULES) || '  none detected'}`,
      `ROLLUP issues (${findings.filter(f=>ROLLUP_RULES.includes(f.ruleId)).length} total):\n${ruleLines(ROLLUP_RULES) || '  none detected'}`,
      `NAMING/GOVERNANCE issues (${findings.filter(f=>NAMING_RULES.includes(f.ruleId)).length} total):\n${ruleLines(NAMING_RULES) || '  none detected'}`,
      `ARCHITECTURE signals (${findings.filter(f=>ARCH_RULES.includes(f.ruleId)).length} total):\n${ruleLines(ARCH_RULES) || '  none detected — naming coverage ${namingPct} limits architecture detection'}`,
    ].join('\n\n');

    const architectureVerdict = buildDeterministicVerdict(discoMap, blastRadiusTop10, findings, normalized.modules.length, domain);
    const healthScore = computeDeterministicHealthScore(findings, blastRadiusById, normalized.modules.length);

    let workstreams = intelligence.workstreams;
    let domainMap = [];
    let integrationSeams = [];
    let architectureStory = '';
    let assessmentObj = intelligence.assessment;

    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const aiClient = new Anthropic();

      console.log('[analyze-v3] AI calls: domain=%s formulaSamples=%d samplePreview=%s',
        domain, formulaSamples.length,
        formulaSamples[0] ? `${formulaSamples[0].module}.${formulaSamples[0].lineItem}:${formulaSamples[0].formula.slice(0, 80)}` : 'none');

      const [wsResult, archResult] = await Promise.allSettled([
        callWorkstreams({ aiClient, modules: normalized.modules, findingSummary, blastRadiusTop10, domain, formulaSamples, enrichment }),
        callArchitecture({ aiClient, modules: normalized.modules, domain, enrichment }),
      ]);

      if (wsResult.status === 'fulfilled' && Array.isArray(wsResult.value?.workstreams) && wsResult.value.workstreams.length) {
        const PRIORITIES = new Set(['Critical','High','Medium','Watch']);
        const CONFIDENCES = new Set(['High','Medium','Low']);
        const KINDS = new Set(['remediation','evidence-limit']);
        const knownModNames = new Set(normalized.modules.map(m => m.name));
        const valid = wsResult.value.workstreams.filter(w => {
          if (!w || typeof w.title !== 'string' || w.title.length <= 3) return false;
          if (w.title.includes('ModuleName')) return false;
          if (!PRIORITIES.has(w.priority) || !CONFIDENCES.has(w.confidence) || !KINDS.has(w.kind)) return false;
          if (typeof w.problem !== 'string' || w.problem.length <= 5) return false;
          if (typeof w.impact !== 'string' || w.impact.length <= 5) return false;
          if (typeof w.fix !== 'string' || w.fix.length <= 5) return false;
          // Grounding: title must reference a real module name from the model
          const titleGrounded = [...knownModNames].some(name => w.title.includes(name));
          if (!titleGrounded) return false;
          // evidenceCount must be > 0
          if (!w.evidenceCount || w.evidenceCount < 1) return false;
          return true;
        });
        if (valid.length === 0) {
          console.error('[analyze-v3] workstreams failed schema validation — keeping deterministic fallback');
        } else {
          workstreams = valid;
          const critical = workstreams.filter(w => w.priority === 'Critical').length;
          const high = workstreams.filter(w => w.priority === 'High').length;
          assessmentObj = {
            verdict: critical > 0 ? 'Executive Review' : high > 0 ? 'Focused Review' : 'Builder Review',
            summary: workstreams[0]?.problem || '',
            confidence: 'Qualified evidence',
            posture: 'review',
          };
        }
      } else if (wsResult.status === 'rejected') {
        const we = wsResult.reason;
        console.error('[analyze-v3] workstreams failed:', we?.constructor?.name, we?.message, 'status:', we?.status, 'errBody:', JSON.stringify(we?.error || {}).slice(0, 300));
      }

      if (archResult.status === 'fulfilled') {
        domainMap = Array.isArray(archResult.value?.domainMap) ? archResult.value.domainMap : [];
        integrationSeams = Array.isArray(archResult.value?.integrationSeams) ? archResult.value.integrationSeams : [];
        architectureStory = String(archResult.value?.architectureStory || '');
      } else {
        const ae = archResult.reason;
        console.error('[analyze-v3] architecture failed:', ae?.constructor?.name, ae?.message, 'status:', ae?.status);
      }
    } catch (e) {
      console.error('[analyze-v3] AI calls failed:', e.constructor.name, e.message);
    }

    sendEvent({
      type: 'model-comprehension-enriched',
      domainMap,
      integrationSeams,
      architectureStory,
      architectureVerdict,
      domain,
    });

    sendEvent({
      type: 'health-workstreams',
      format: HEALTH_FORMAT,
      healthScore,
      architectureVerdict,
      domain,
      moduleCount: normalized.modules.length,
      workstreams,
      assessment: {
        verdict: assessmentObj.verdict,
        summary: assessmentObj.summary || architectureStory,
        confidence: assessmentObj.confidence,
        posture: assessmentObj.posture,
      },
      evidenceLimits: {
        canSay: intelligence.feasibility.supportedNow,
        cannotSay: intelligence.feasibility.notKnowableYet,
      },
    });

    // ─── Optional AI narration (Phase E) — failure-safe ─────────────────────────
    if (moduleCards.length >= 2) {
      try {
        sendEvent({ type: 'stage', stage: 'narrating', label: 'Writing executive summary…' });
        const Anthropic = (await import('@anthropic-ai/sdk')).default;
        const narrativeClient = new Anthropic();
        const topCards = moduleCards.slice(0, 5).map(c =>
          `${c.moduleName} [${c.criticality}]: ${c.purpose} Issues: ${(c.issues || []).map(i => i.issue).join('; ')}`
        ).join('\n');
        const clusterText = riskClusters.slice(0, 3).map(cl => cl.trigger).join('; ');
        const narrativePrompt = `You are writing a 2-paragraph executive model review for a ${domain} model with ${normalized.modules.length} modules.
Your response MUST begin with { and end with }. No markdown. Raw JSON only.

TOP RISK MODULES:
${topCards}

RISK CLUSTERS: ${clusterText || 'None identified'}
HEALTH: ${modelSummary.overallHealth}, score ${modelSummary.healthScore}/100

Return:
{"executive":"2 paragraphs: first describes the model and its top risk; second recommends next steps. Name specific modules.","ownerQuestions":["question 1 for model owner","question 2"]}

Rules:
- Every module named must come from the data above
- No generic advice — be specific to what was found
- Keep each paragraph to 2-3 sentences`;

        const narrativeResp = await Promise.race([
          narrativeClient.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 600,
            messages: [{ role: 'user', content: narrativePrompt }],
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('narrative-timeout')), 15000)),
        ]);
        const nRaw = narrativeResp.content?.[0]?.text?.trim() || '';
        const nStart = nRaw.indexOf('{');
        const nEnd = nRaw.lastIndexOf('}');
        if (nStart >= 0 && nEnd > nStart) {
          const narrative = JSON.parse(nRaw.slice(nStart, nEnd + 1));
          sendEvent({ type: 'intelligence-narrative', narrative });
        }
      } catch (narrativeErr) {
        console.warn('[analyze-v3] AI narration skipped:', narrativeErr.message);
      }
    }

    // ─── Sequential AI Module Intelligence (Sonnet — per-module) ──────────────
    // Fires after deterministic intelligence. Each call is independent so we
    // avoid Vercel's 60s timeout by streaming results as they arrive.
    const AI_MODULE_LIMIT = 8; // top N by criticality
    const topAiCards = moduleCards.slice(0, AI_MODULE_LIMIT);
    if (topAiCards.length >= 1) {
      try {
        sendEvent({ type: 'stage', stage: 'ai-intelligence', label: 'Generating AI insights…' });
        const Anthropic = (await import('@anthropic-ai/sdk')).default;
        const sonnetClient = new Anthropic();

        for (let i = 0; i < topAiCards.length; i++) {
          const card = topAiCards[i];
          // Gather formula samples for this module
          const modFormulas = formulaSamples
            .filter(s => s.module === card.moduleName)
            .slice(0, 3)
            .map(s => `  ${s.lineItem}: ${s.formula.slice(0, 200)}${s.formula.length > 200 ? '…' : ''} [flags: ${s.flags.join(', ')}]`)
            .join('\n');

          // Build per-module context
          const issueText = (card.issues || [])
            .map(iss => `- ${iss.issue}${iss.danger ? ' → ' + iss.danger : ''}`)
            .join('\n');

          const prompt = `You are a senior Anaplan model architect reviewing a specific module.
Respond ONLY with valid JSON — no markdown, no explanation outside JSON.

MODULE: ${card.moduleName}
ROLE: ${card.role} | CRITICALITY: ${card.criticality} | COMPLEXITY: ${card.complexity}
GRAIN: ${card.grain}
PURPOSE: ${card.purpose}
UPSTREAM: ${(card.upstreamModules || []).slice(0, 5).join(', ') || 'none'}
DOWNSTREAM: ${(card.downstreamModules || []).slice(0, 5).join(', ') || 'none'}
STATS: ${card.stats.lineItems} line items, ${card.stats.formulas} formulas, ${card.stats.inputs} inputs, ${card.stats.outboundEdges} outbound edges

DETECTED ISSUES:
${issueText || 'None detected'}

FORMULA SAMPLES:
${modFormulas || 'No samples available for this module'}

MODEL CONTEXT: ${domain} domain, ${normalized.modules.length} total modules, health score ${modelSummary.healthScore}/100

Return:
{
  "insight": "1-2 sentence expert interpretation of this module's risk posture — what's actually dangerous here and why a model owner should care. Be specific to the formulas/issues shown.",
  "recommendation": "1 concrete, actionable next step the model owner should take for this module. Reference specific line items or patterns from the evidence.",
  "riskNarrative": "Brief assessment of blast radius — if this module fails, what breaks downstream and how quickly would the error surface in reports?"
}

Rules:
- Be specific — reference actual module/line item names from the data
- No generic Anaplan advice — only insights grounded in the evidence shown
- Keep each field to 1-3 sentences max`;

          try {
            const resp = await Promise.race([
              sonnetClient.messages.create({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 400,
                messages: [{ role: 'user', content: prompt }],
              }),
              new Promise((_, rej) => setTimeout(() => rej(new Error('module-ai-timeout')), 12000)),
            ]);

            const raw = resp.content?.[0]?.text?.trim() || '';
            const jStart = raw.indexOf('{');
            const jEnd = raw.lastIndexOf('}');
            if (jStart >= 0 && jEnd > jStart) {
              const parsed = JSON.parse(raw.slice(jStart, jEnd + 1));
              if (parsed.insight && parsed.recommendation) {
                sendEvent({
                  type: 'module-ai-insight',
                  moduleId: card.moduleId,
                  moduleName: card.moduleName,
                  insight: String(parsed.insight).slice(0, 500),
                  recommendation: String(parsed.recommendation).slice(0, 500),
                  riskNarrative: String(parsed.riskNarrative || '').slice(0, 500),
                  index: i,
                  total: topAiCards.length,
                });
              }
            }
          } catch (modErr) {
            console.warn(`[analyze-v3] AI insight skipped for ${card.moduleName}:`, modErr.message);
          }
        }
      } catch (aiErr) {
        console.error('[analyze-v3] AI intelligence layer failed:', aiErr.message);
      }
    }

    const lineItemCount = normalized.modules.reduce((s, m) => s + m.lineItemCount, 0);
    sendEvent({
      type: 'complete',
      version: 'v3.1',
      moduleCount: normalized.modules.length,
      lineItemCount,
      workstreamCount: workstreams.length,
      deadLogicCount: deadLogic.length,
      cycleCount: cycles.length,
      domain,
      formulaSampleCount: formulaSamples.length,
      graphStats: {
        nodes: lineItemGraph.nodes.size,
        edges: lineItemGraph.edges.length,
        moduleCards: moduleCards.length,
        riskClusters: riskClusters.length,
        patterns: businessPatterns.length,
      },
    });
  } catch (err) {
    console.error('[analyze-v3] error:', err.constructor.name, err.message);
    sendEvent({ type: 'error', message: err.message });
  } finally {
    res.end();
  }
}
