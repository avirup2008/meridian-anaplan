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
    sendEvent({ type: 'stage', stage: 'health', label: 'Building health workstreams…' });

    // Run deterministic findings (reuses graph + architecture already computed above)
    const findings = [
      ...scanDeterministicFindings(normalized),
      ...scanArchitectureFindings(normalized),
    ];

    // buildEvidenceBackedIntelligence is the top-level orchestrator in analysis-core.js.
    // It internally calls buildDependencyGraph, buildArchitectureClassification,
    // buildEvidenceDiagnostics, buildEvidenceWorkstreams, buildAssessment, and
    // buildExecutiveBrief. We pass it the normalized object and deterministic findings.
    // NOTE: This re-runs the graph build internally; that is acceptable — it is O(n*m)
    // on module count and completes in well under 1 second for 228-module models.
    const intelligence = buildEvidenceBackedIntelligence(normalized, findings);

    // Diagnostic log — remove after debugging
    const ruleBreakdown = {};
    for (const f of findings) { ruleBreakdown[f.ruleId] = (ruleBreakdown[f.ruleId] || 0) + 1; }
    console.log('[analyze-v3] findings:', findings.length, JSON.stringify(ruleBreakdown));
    console.log('[analyze-v3] workstreams:', intelligence.workstreams.length, intelligence.workstreams.map(w => `${w.id}(${w.kind},${w.evidenceCount})`).join(', '));

    // ── Executive brief: Haiku with deterministic fallback ───────────────────────
    let executiveBrief = intelligence.executiveNarrative; // deterministic fallback
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const aiClient = new Anthropic();
      const briefPrompt = `You are a senior Anaplan architect writing an executive summary for a model health report.
Evidence pack (4 gates): fetchCompleteness=${evidencePack?.fetchCompleteness?.toFixed(2)}, formulaCoverage=${evidencePack?.formulaCoverage?.toFixed(2)}, graphDensity=${evidencePack?.graphDensity?.toFixed(2)}, namingCoverage=${evidencePack?.namingCoverage?.toFixed(2)}.
Verdict: ${intelligence.assessment.verdict}. Confidence: ${intelligence.assessment.confidence}.
Workstreams (${intelligence.workstreams.length}): ${intelligence.workstreams.slice(0,6).map(w => `${w.priority} – ${w.title}`).join('; ')}.
Write 2–3 sentences. Cite only what the evidence supports. No invented findings. No score out of 10.`;

      const briefRes = await Promise.race([
        aiClient.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 200,
          messages: [{ role: 'user', content: briefPrompt }],
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
      ]);
      if (briefRes.content?.[0]?.text) {
        executiveBrief = briefRes.content[0].text.trim();
      }
    } catch (e) {
      // Haiku unavailable or timed out — fall back to deterministic brief (already set above)
      console.log('[analyze-v3] Haiku brief skipped, using deterministic fallback:', e.message);
    }

    // Emit health-workstreams event
    sendEvent({
      type: 'health-workstreams',
      workstreams: intelligence.workstreams,
      assessment: {
        verdict: intelligence.assessment.verdict,
        summary: intelligence.assessment.summary,
        confidence: intelligence.assessment.confidence,
        posture: intelligence.assessment.posture,
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
      workstreamCount: intelligence.workstreams.length,
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
