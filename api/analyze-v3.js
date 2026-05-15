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

// parseStateBlob: converts the compact tab-separated state blob (from model-state.js
// serializeModelState) back into an array of module objects.
//
// Format:
//   MODULE\t{id}\t{name}\t{prefix}
//   CALC\t{name}\t{format}\t{summary}\t{formula}
//   INPUT\t{name}\t{format}\t{summary}\t
//   ITEM\t{name}\t{format}\t{summary}\t
//   <blank line between modules>
function parseStateBlob(text) {
  const modules = [];
  let current = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    // Blank line ends the current module block
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
      const formula = parts[4] || '';
      current.lineItems.push({
        id: '',
        name: parts[1] || '',
        formatType: parts[2] || '',
        summaryMethod: parts[3] || '',
        formula,
        hasFormula: rowType === 'CALC' && formula.length > 0,
        isInput: rowType === 'INPUT',
        formulaTruncated: formula.endsWith('…'), // '…'
        dimensions: [],
        dimensionCount: 0,
        notes: '',
        formulaLength: formula.length,
        ifDepth: countIfDepth(formula),
        hasSumLookup: hasSumLookup(formula),
        hasHardcodedSelect: hasHardcodedSelect(formula),
        hasUnguardedDivision: hasUnguardedDivision(formula),
      });
    }
    // Unknown row types are silently skipped (T-07-01-02: never throws on malformed input)
  }

  return modules;
}

// toNormalized: wraps a modules array into the shape that buildDependencyGraph() and
// all other analysis-core.js functions expect.
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

// Derives confidence score for module classification per RESEARCH.md methodology
function moduleConfidence(mod, declaredLayer) {
  if (declaredLayer === 'unknown') {
    return { score: 0.40, label: 'Low', reason: 'No DISCO prefix recognised' };
  }
  // Check if behavior inferred from line item ratios matches declared layer
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

// D-05: which health output format Sonnet produces (matches 07-MOCKUP-DECISION.md choice)
const HEALTH_FORMAT = 'workstreams';

// D-04: fixed list of what Meridian cannot assess — always emitted verbatim
const HONEST_LIMITS = [
  'Calculation execution speed',
  'Data load runtimes',
  'User experience / dashboard design',
  'ALM governance (dev/test/prod hygiene)',
  'Whether formulas are logically correct (only that they exist)',
  'Workspace utilization',
];

// D-06: deterministic health score — finding severity weighted by host module blast radius
function computeDeterministicHealthScore(findings, blastRadiusById, moduleCount) {
  const SEVERITY_WEIGHT = { critical: 4, warning: 2, info: 1 };
  let penalty = 0;
  for (const f of findings) {
    const w = SEVERITY_WEIGHT[f.severity] || 1;
    const blast = blastRadiusById.get(f.moduleId) || 0;
    penalty += w * (1 + blast * 0.25);
  }
  const score = Math.max(0, 100 - (penalty / Math.max(moduleCount, 1)) * 8);
  return Math.round(Math.min(95, score));
}

// Deterministic architecture verdict — computed from DISCO coverage + blast radius + finding counts.
// Used as primary verdict (no Sonnet dependency for this field).
function buildDeterministicVerdict(discoMap, blastRadiusTop10, findings, moduleCount) {
  const unknown = discoMap.UNKNOWN || 0;
  const namingPct = moduleCount > 0 ? Math.round((1 - unknown / moduleCount) * 100) : 0;
  const criticalCount = findings.filter(f => f.severity === 'critical').length;
  const topBlast = blastRadiusTop10[0]?.downstreamCount || 0;

  const calCount = discoMap.CAL || 0;
  const datCount = discoMap.DAT || 0;
  const modelType = calCount > datCount ? 'calculation-heavy model'
    : datCount > calCount ? 'data-staging model'
    : 'balanced model';

  const namingLabel = namingPct >= 80 ? 'well-named'
    : namingPct >= 50 ? 'partially-named'
    : 'sparse naming';

  const riskLabel = criticalCount > 5 ? 'high formula risk'
    : criticalCount > 0 ? 'moderate formula risk'
    : topBlast > 20 ? 'high blast-radius concentration'
    : 'low detected risk';

  return `${modelType}, ${namingLabel}, ${riskLabel}`;
}

// Call 1: Sonnet — workstream cards only.
// Focused prompt with real module names forces model-specific output.
async function callWorkstreams({ aiClient, modules, findingSummary, blastRadiusTop10 }) {
  const moduleNames = modules.slice(0, 50).map(m => m.name).join('\n')
    + (modules.length > 50 ? `\n… and ${modules.length - 50} more` : '');
  const blastLines = blastRadiusTop10
    .map(b => `  ${b.moduleName}: ${b.downstreamCount} downstream modules`)
    .join('\n');

  const prompt = `You are a senior Anaplan model reviewer. Respond with VALID JSON only — no markdown, no explanation.

REAL MODULE NAMES IN THIS MODEL (you MUST cite these by exact name in your output):
${moduleNames}

TOP BLAST-RADIUS MODULES (highest downstream dependency count):
${blastLines}

DETERMINISTIC FINDINGS (anchor every claim to these — do NOT invent issues):
${findingSummary}

Return a JSON object with exactly this shape:
{
  "workstreams": [
    {
      "id": "ws-1",
      "title": "string (5-8 words, MUST include a real module name from the list above)",
      "priority": "Critical|High|Medium|Watch",
      "confidence": "High|Medium|Low",
      "kind": "remediation|evidence-limit",
      "whyItMatters": "exactly 2 sentences — MUST name specific modules from the list above by exact name",
      "reviewQuestion": "specific question about this model's structure or findings",
      "action": "specific action mentioning real module names",
      "evidenceCount": <integer matching finding counts above>,
      "examples": ["<ModuleName.LineItemName> — issue description"]
    }
  ]
}

RULES:
- Output 3-5 workstream objects
- Every title and whyItMatters MUST name at least one real module from the list above
- NEVER use generic phrases like "several modules" or "many line items" — name them specifically
- Every claim must trace to a real finding from DETERMINISTIC FINDINGS above
- Return ONLY the JSON object, no prose`;

  const response = await Promise.race([
    aiClient.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('workstreams-timeout')), 20000)),
  ]);

  const raw = response.content?.[0]?.text?.trim() || '{}';
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) {
    console.error('[analyze-v3] workstreams: no JSON (first 200):', raw.slice(0, 200));
    throw new Error('Workstreams response contained no JSON object');
  }
  return JSON.parse(raw.slice(start, end + 1));
}

// Call 2: Haiku — domain map + architecture story only.
// Lighter model, smaller token budget, fewer failure modes.
async function callArchitecture({ aiClient, modules }) {
  const moduleNames = modules.slice(0, 60).map(m => m.name).join('\n')
    + (modules.length > 60 ? `\n… and ${modules.length - 60} more` : '');

  const prompt = `You are an Anaplan architect. Respond with VALID JSON only — no markdown, no explanation.

MODULE NAMES IN THIS MODEL:
${moduleNames}

Return a JSON object with exactly this shape:
{
  "domainMap": [
    { "domainName": "string", "description": "1 sentence", "moduleCount": <int> }
  ],
  "integrationSeams": [
    { "moduleName": "string (must be from the list above)", "reason": "1 phrase" }
  ],
  "architectureStory": "exactly 2 sentences describing the model type and architecture maturity"
}

RULES:
- 2-4 domains, inferred from module name prefixes and naming patterns
- 1-3 integration seams (cross-domain boundary modules)
- All module names cited must come from the list above
- Return ONLY the JSON object`;

  const response = await Promise.race([
    aiClient.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('architecture-timeout')), 20000)),
  ]);

  const raw = response.content?.[0]?.text?.trim() || '{}';
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) {
    console.error('[analyze-v3] architecture: no JSON (first 200):', raw.slice(0, 200));
    throw new Error('Architecture response contained no JSON object');
  }
  return JSON.parse(raw.slice(start, end + 1));
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // T-07-01-01: Validate stateUrl before any network call (SSRF guard)
  const stateUrl = req.body?.stateUrl;
  if (!stateUrl) return res.status(400).json({ error: 'Missing stateUrl' });
  if (!isAllowedBlobUrl(stateUrl)) {
    return res.status(400).json({ error: 'Invalid stateUrl — must be a Vercel Blob URL' });
  }

  // evidencePack is optional — older callers may omit it; downstream plans consume it
  const evidencePack = req.body?.evidencePack || null;

  // SSE headers MUST be set and flushed before the first await (SSE ordering requirement)
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

    const modules = parseStateBlob(stateText);
    if (!modules.length) {
      throw new Error('State blob contains no modules — re-fetch model state');
    }

    const normalized = toNormalized(modules);

    // Build dependency graph
    sendEvent({ type: 'stage', stage: 'graph', label: 'Building dependency graph…' });
    const graph = buildDependencyGraph(normalized);

    // Build architecture classification
    sendEvent({ type: 'stage', stage: 'classifying', label: 'Classifying modules…' });
    const architecture = buildArchitectureClassification(normalized, graph);
    const diagnostics = buildEvidenceDiagnostics(normalized, graph, architecture);

    // Build module classification payload with DISCO labels and confidence
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

    // Build DISCO prefix count map
    const discoMap = { SYS: 0, DAT: 0, CAL: 0, REP: 0, INP: 0, UNKNOWN: 0 };
    for (const m of classifiedModules) {
      discoMap[m.discoLabel] = (discoMap[m.discoLabel] || 0) + 1;
    }

    // Dead logic detection
    sendEvent({ type: 'stage', stage: 'dead-logic', label: 'Detecting dead logic…' });
    const deadLogic = detectDeadLogic(normalized.modules, graph);
    const cycles = detectCircularDependencies(graph);
    const daisyChains = detectDaisyChains(graph);

    // Limitation cards from diagnostics blocked conclusions
    const limitationCards = diagnostics.blockedClaims || [];

    // D-03: Blast radius — downstream module count per module
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

    // Emit model-comprehension event (fast — pre-AI)
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
      limitationCards,
    });

    // ── Health engine ────────────────────────────────────────────────────────────
    sendEvent({ type: 'stage', stage: 'health', label: 'Synthesizing model intelligence…' });

    // Run deterministic findings
    const findings = [
      ...scanDeterministicFindings(normalized),
      ...scanArchitectureFindings(normalized),
    ];

    // Get deterministic structure (workstream groupings, examples, evidence items)
    const intelligence = buildEvidenceBackedIntelligence(normalized, findings);

    // Build per-rule example map for Sonnet prompt
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
    const totalFormulas = normalized.modules.reduce((s,m)=>s+m.lineItems.filter(li=>li.hasFormula).length,0);
    const totalLIs      = normalized.modules.reduce((s,m)=>s+m.lineItems.length,0);
    const namingPct     = evidencePack?.namingCoverage != null ? `${(evidencePack.namingCoverage*100).toFixed(0)}%` : 'unknown';

    const findingSummary = [
      `FORMULA issues (${findings.filter(f=>FORMULA_RULES.includes(f.ruleId)).length} total):\n${ruleLines(FORMULA_RULES) || '  none detected'}`,
      `ROLLUP issues (${findings.filter(f=>ROLLUP_RULES.includes(f.ruleId)).length} total):\n${ruleLines(ROLLUP_RULES) || '  none detected'}`,
      `NAMING/GOVERNANCE issues (${findings.filter(f=>NAMING_RULES.includes(f.ruleId)).length} total):\n${ruleLines(NAMING_RULES) || '  none detected'}`,
      `ARCHITECTURE signals (${findings.filter(f=>ARCH_RULES.includes(f.ruleId)).length} total):\n${ruleLines(ARCH_RULES) || '  none detected — naming coverage ${namingPct} limits architecture detection'}`,
    ].join('\n\n');

    // Deterministic verdict and health score — primary outputs, no AI dependency
    const architectureVerdict = buildDeterministicVerdict(discoMap, blastRadiusTop10, findings, normalized.modules.length);
    const healthScore = computeDeterministicHealthScore(findings, blastRadiusById, normalized.modules.length);

    // Defaults — used if AI calls fail
    let workstreams = intelligence.workstreams;
    let domainMap = [];
    let integrationSeams = [];
    let architectureStory = '';
    let assessmentObj = intelligence.assessment;

    // Two parallel AI calls — workstreams (Sonnet) + architecture/domain (Haiku)
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const aiClient = new Anthropic();

      const [wsResult, archResult] = await Promise.allSettled([
        callWorkstreams({ aiClient, modules: normalized.modules, findingSummary, blastRadiusTop10 }),
        callArchitecture({ aiClient, modules: normalized.modules }),
      ]);

      if (wsResult.status === 'fulfilled' && Array.isArray(wsResult.value?.workstreams) && wsResult.value.workstreams.length) {
        workstreams = wsResult.value.workstreams;
        const critical = workstreams.filter(w => w.priority === 'Critical').length;
        const high = workstreams.filter(w => w.priority === 'High').length;
        assessmentObj = {
          verdict: critical > 0 ? 'Executive Review' : high > 0 ? 'Focused Review' : 'Builder Review',
          summary: workstreams[0]?.whyItMatters || '',
          confidence: 'Qualified evidence',
          posture: 'review',
        };
      } else if (wsResult.status === 'rejected') {
        const we = wsResult.reason;
        console.error('[analyze-v3] workstreams failed:', we?.constructor?.name, we?.message, 'status:', we?.status, 'errType:', we?.error?.type, 'errBody:', JSON.stringify(we?.error || {}).slice(0, 300));
      }

      if (archResult.status === 'fulfilled') {
        domainMap = Array.isArray(archResult.value?.domainMap) ? archResult.value.domainMap : [];
        integrationSeams = Array.isArray(archResult.value?.integrationSeams) ? archResult.value.integrationSeams : [];
        architectureStory = String(archResult.value?.architectureStory || '');
      } else {
        const ae = archResult.reason;
        console.error('[analyze-v3] architecture failed:', ae?.constructor?.name, ae?.message, 'status:', ae?.status, 'errType:', ae?.error?.type);
      }
    } catch (e) {
      console.error('[analyze-v3] AI calls failed:', e.constructor.name, e.message);
    }

    // Emit enriched architecture fields after AI (Model tab merges both events)
    sendEvent({
      type: 'model-comprehension-enriched',
      domainMap,
      integrationSeams,
      architectureStory,
      architectureVerdict,
    });

    // Emit health-workstreams with final payload
    sendEvent({
      type: 'health-workstreams',
      format: HEALTH_FORMAT,
      healthScore,
      architectureVerdict,
      honestLimits: HONEST_LIMITS,
      workstreams,
      assessment: {
        verdict: assessmentObj.verdict,
        summary: architectureStory || assessmentObj.summary,
        confidence: assessmentObj.confidence,
        posture: assessmentObj.posture,
      },
      evidenceLimits: {
        canSay: intelligence.feasibility.supportedNow,
        cannotSay: intelligence.feasibility.notKnowableYet,
      },
    });

    const lineItemCount = normalized.modules.reduce((s, m) => s + m.lineItemCount, 0);
    sendEvent({
      type: 'complete',
      version: 'v3',
      moduleCount: normalized.modules.length,
      lineItemCount,
      workstreamCount: workstreams.length,
      deadLogicCount: deadLogic.length,
      cycleCount: cycles.length,
    });
  } catch (err) {
    console.error('[analyze-v3] error:', err.constructor.name, err.message);
    sendEvent({ type: 'error', message: err.message });
  } finally {
    res.end();
  }
}
