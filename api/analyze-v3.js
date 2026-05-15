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

    // Emit model-comprehension event
    sendEvent({
      type: 'model-comprehension',
      modules: classifiedModules,
      graph,
      deadLogic,
      deadLogicConfidence: 'Medium',
      cycles,
      daisyChains,
      discoMap,
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

    // ── Build per-rule example map for Sonnet ────────────────────────────────────
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

    // ── Sonnet: model-specific workstream narratives ──────────────────────────────
    let workstreams = intelligence.workstreams; // deterministic fallback
    let executiveBrief = intelligence.executiveNarrative;
    let assessmentObj = intelligence.assessment;

    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const aiClient = new Anthropic();

      const workstreamPrompt = `You are a senior Anaplan architect writing a health review for a client model.

Model: ${normalized.modules.length} functional modules, ${totalLIs} line items, ${totalFormulas} calculated formulas.
DISCO naming coverage: ${namingPct} of modules have recognisable layer prefixes.

Deterministic scan findings:
${findingSummary}

Write 3–5 review workstreams as a JSON array. Each object must have exactly these keys:
  id (slug), title, priority (Critical|High|Medium|Watch), confidence (High|Medium|Low),
  kind ("remediation" or "evidence-limit"), whyItMatters (2 sentences),
  reviewQuestion (1 sentence), action (1 sentence), evidenceCount (integer), examples (array of ≤5 strings)

Rules:
- title must describe THIS model's actual pattern, not generic Anaplan advice
- whyItMatters must cite specific module names and counts from the findings above
- Do NOT mention "blueprint" — the data came from the live Anaplan API
- Return ONLY the JSON array, no markdown fences, no explanation`;

      const briefPrompt = `Anaplan model: ${normalized.modules.length} modules, ${totalFormulas} formulas.
Key findings: ${findings.length} total — formula issues: ${findings.filter(f=>FORMULA_RULES.includes(f.ruleId)).length}, naming issues: ${findings.filter(f=>NAMING_RULES.includes(f.ruleId)).length}, rollup issues: ${findings.filter(f=>ROLLUP_RULES.includes(f.ruleId)).length}.
Top affected modules: ${[...new Set(findings.slice(0,30).map(f=>f.moduleName).filter(Boolean))].slice(0,5).join(', ')}.
Write exactly 2 sentences summarising the most important health findings for the model owner. Cite module names. No generic advice. No markdown.`;

      const [wsRes, brRes] = await Promise.all([
        Promise.race([
          aiClient.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 2000, messages: [{ role: 'user', content: workstreamPrompt }] }),
          new Promise((_,rej) => setTimeout(()=>rej(new Error('timeout')), 30000)),
        ]),
        Promise.race([
          aiClient.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 150, messages: [{ role: 'user', content: briefPrompt }] }),
          new Promise((_,rej) => setTimeout(()=>rej(new Error('timeout')), 10000)),
        ]).catch(()=>null),
      ]);

      const raw = wsRes.content?.[0]?.text?.trim() || '[]';
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        workstreams = parsed;
        const hasEvLimit = workstreams.some(w => w.kind === 'evidence-limit');
        const critical   = workstreams.filter(w => w.priority === 'Critical').length;
        const high       = workstreams.filter(w => w.priority === 'High').length;
        assessmentObj = {
          verdict: hasEvLimit ? 'Evidence Limited' : critical > 0 ? 'Executive Review' : high > 0 ? 'Focused Review' : 'Builder Review',
          summary: workstreams[0]?.whyItMatters || '',
          confidence: 'Qualified evidence',
          posture: 'review',
        };
      }
      if (brRes?.content?.[0]?.text) executiveBrief = brRes.content[0].text.trim();
    } catch (e) {
      console.log('[analyze-v3] Sonnet synthesis failed, using deterministic fallback:', e.message);
    }

    // Emit health-workstreams event
    sendEvent({
      type: 'health-workstreams',
      workstreams,
      assessment: {
        verdict: assessmentObj.verdict,
        summary: assessmentObj.summary,
        confidence: assessmentObj.confidence,
        posture: assessmentObj.posture,
      },
      evidenceLimits: {
        canSay: intelligence.feasibility.supportedNow,
        cannotSay: intelligence.feasibility.notKnowableYet,
      },
      executiveBrief,
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
    console.error('analyze-v3 error:', err.message);
    sendEvent({ type: 'error', message: err.message });
  } finally {
    res.end();
  }
}
