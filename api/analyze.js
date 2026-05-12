import Anthropic from '@anthropic-ai/sdk';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const SONNET_MODEL = 'claude-sonnet-4-6';
const TOKEN_LIMIT = 180_000;
const BATCH_SIZE = 20;              // 214 modules → ~11 batches (was 5 → 43 batches)
const MIN_LINE_ITEMS_FOR_HAIKU = 3;
const HAIKU_BUDGET_MS = 35_000;    // stop Haiku batches if elapsed exceeds this
const TOTAL_BUDGET_MS = 52_000;    // overall guard before Sonnet (8s buffer before Vercel 60s kill)

// ANLZ-03: Extraction pre-pass — strips banned fields, reduces appliesTo to dimensions[]
export function extractionPrePass(blueprint) {
  const results = [];
  for (const mod of blueprint.modules) {
    if (mod.fetchError || mod.lineItemCount === 0) continue;
    results.push({
      moduleId: mod.id,
      moduleName: mod.name,
      lineItemCount: mod.lineItemCount,
      lineItems: mod.lineItems.map(li => ({
        name: li.name,
        formula: li.formula || null,
        format: li.format || null,
        summary: li.summary || null,
        dimensions: Array.isArray(li.appliesTo)
          ? li.appliesTo.map(d => (typeof d === 'string' ? d : (d?.name || ''))).filter(Boolean)
          : [],
        notes: li.notes || null,
      })),
    });
  }
  return results;
}

// ANLZ-03: countTokens pre-flight guard — throws if prompt exceeds TOKEN_LIMIT
async function guardTokens(client, model, messages, system) {
  const r = await client.messages.countTokens({ model, messages, ...(system ? { system } : {}) });
  if (r.input_tokens > TOKEN_LIMIT) {
    throw new Error(`Token budget exceeded: ${r.input_tokens} > ${TOKEN_LIMIT} for ${model}`);
  }
  return r.input_tokens;
}

// Strip markdown fences and JSON.parse; return null on failure
export function parseJsonStrict(text) {
  const cleaned = String(text || '').replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

function buildHaikuPrompt(mod) {
  return `Analyze this Anaplan module and return improvement suggestions as JSON.

Module: ${mod.moduleName} (${mod.lineItemCount} line items)

Line Items:
${mod.lineItems.map(li =>
  `- ${li.name}${li.formula ? ` = ${li.formula}` : ' [input]'}` +
  `${li.format ? ` [${li.format}]` : ''}` +
  `${li.dimensions.length ? ` (dims: ${li.dimensions.join(', ')})` : ''}` +
  `${li.notes ? ` // ${li.notes}` : ''}`
).join('\n')}

Return a JSON array of suggestions. Each suggestion: { "domain", "triage", "title", "reasoning", "action" }
domain: "Structural" | "Formula" | "Best Practice" | "Naming"
triage: "Fix Now" | "Consider" | "Monitor"
title: short (< 60 chars)
reasoning: 1-2 sentences explaining why this matters
action: concrete step the builder should take

If no issues found, return an empty array [].
Respond with raw JSON only — no markdown fences, no commentary.`;
}

async function runHaikuForModule(client, mod) {
  const messages = [{ role: 'user', content: buildHaikuPrompt(mod) }];
  await guardTokens(client, HAIKU_MODEL, messages);
  const resp = await client.messages.create({ model: HAIKU_MODEL, max_tokens: 1024, messages });
  const parsed = parseJsonStrict(resp.content?.[0]?.text);
  if (!parsed || !Array.isArray(parsed)) {
    return { moduleId: mod.moduleId, moduleName: mod.moduleName, items: [] };
  }
  const VALID_TRIAGE = new Set(['Fix Now', 'Consider', 'Monitor']);
  const VALID_DOMAIN = new Set(['Structural', 'Formula', 'Best Practice', 'Naming']);
  const filteredArray = parsed
    .filter(item => VALID_TRIAGE.has(item.triage) && VALID_DOMAIN.has(item.domain))
    .map(item => ({
      domain: item.domain,
      triage: item.triage,
      text: item.title || item.text,
      reasoning: item.reasoning,
      action: item.action,
    }));
  return { moduleId: mod.moduleId, moduleName: mod.moduleName, items: filteredArray };
}

async function runHaikuBatches(client, extractions, sendEvent, startMs) {
  const eligible = extractions.filter(m => m.lineItemCount >= MIN_LINE_ITEMS_FOR_HAIKU);
  const collected = [];
  let modulesDone = 0;

  // Emit haiku-progress for skipped (ineligible) modules
  for (const mod of extractions) {
    if (mod.lineItemCount < MIN_LINE_ITEMS_FOR_HAIKU) {
      sendEvent({ type: 'haiku-progress', modulesDone: modulesDone, modulesTotal: extractions.length, moduleName: mod.moduleName, skipped: true });
    }
  }

  for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
    if (Date.now() - startMs > HAIKU_BUDGET_MS) {
      sendEvent({ type: 'partial-analysis', reason: 'Haiku time budget reached', modulesAnalysed: modulesDone, modulesSkipped: extractions.length - modulesDone });
      break;
    }

    const batch = eligible.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map(m => runHaikuForModule(client, m)));

    for (let j = 0; j < settled.length; j++) {
      const mod = batch[j];
      let result;
      if (settled[j].status === 'fulfilled') {
        result = settled[j].value;
      } else {
        result = { moduleId: mod.moduleId, moduleName: mod.moduleName, items: [] };
      }
      collected.push(result);
      sendEvent({ type: 'suggestions', moduleId: result.moduleId, moduleName: result.moduleName, items: result.items });
      sendEvent({ type: 'haiku-progress', modulesDone: ++modulesDone, modulesTotal: extractions.length, moduleName: result.moduleName, skipped: false });
    }
  }

  return collected;
}

function buildSonnetSynthesisPrompt(extractions, allSuggestions) {
  const userContent = `Assess the health of this Anaplan model blueprint.

Model has ${extractions.length} modules and ${extractions.reduce((s, m) => s + m.lineItemCount, 0)} line items.

Module Summaries:
${extractions.map(m =>
  `${m.moduleName}: ${m.lineItemCount} items, ` +
  `${m.lineItems.filter(li => li.formula).length} calculated, ` +
  `${m.lineItems.filter(li => !li.formula).length} inputs`
).join('\n')}

Collected Issues Summary:
${allSuggestions.filter(s => s.triage === 'Fix Now').length} Fix Now
${allSuggestions.filter(s => s.triage === 'Consider').length} Consider
${allSuggestions.filter(s => s.triage === 'Monitor').length} Monitor

Top issues by domain:
${['Structural', 'Formula', 'Best Practice', 'Naming'].map(d => {
  const n = allSuggestions.filter(s => s.domain === d && s.triage === 'Fix Now').length;
  return `${d}: ${n} Fix Now`;
}).join('\n')}

Return JSON:
{
  "healthScore": <0-100>,
  "verdict": "Good" | "Needs Work" | "Critical",
  "summary": "<2-3 sentence executive summary>",
  "dimensions": {
    "architecture": <0-100>,
    "naming": <0-100>,
    "formulas": <0-100>,
    "dataHygiene": <0-100>,
    "governance": <0-100>
  }
}
Respond with raw JSON only — no markdown fences.`;

  const system = 'You are an expert Anaplan model reviewer. You assess blueprints and produce structured health assessments. Always respond with valid JSON only, no markdown.';
  return { userContent, system };
}

// ANLZ-01: Defensive normalisation of Sonnet synthesis response
export function normalizeSynthesis(raw) {
  const r = raw || {};
  const score = typeof r.healthScore === 'number' ? Math.max(0, Math.min(100, r.healthScore)) : 50;
  let verdict = r.verdict;
  if (!['Good', 'Needs Work', 'Critical'].includes(verdict)) {
    verdict = score >= 85 ? 'Good' : score >= 60 ? 'Needs Work' : 'Critical';
  }
  const d = r.dimensions || {};
  const dim = k => (typeof d[k] === 'number' ? Math.max(0, Math.min(100, d[k])) : 50);
  return {
    healthScore: score,
    verdict,
    summary: r.summary || 'Analysis complete.',
    dimensions: {
      architecture: dim('architecture'),
      naming: dim('naming'),
      formulas: dim('formulas'),
      dataHygiene: dim('dataHygiene'),
      governance: dim('governance'),
    },
  };
}

// ANLZ-04: Build cross-module dependency graph from formula text matching
export function detectDependencies(extractions) {
  const deps = {};

  for (const mod of extractions) {
    if (!deps[mod.moduleId]) deps[mod.moduleId] = { receivesFrom: new Set(), sendsTo: new Set() };
  }

  for (const mod of extractions) {
    for (const li of mod.lineItems) {
      if (!li.formula) continue;
      for (const other of extractions) {
        if (other.moduleId === mod.moduleId) continue;
        if (li.formula.includes(other.moduleName)) {
          deps[mod.moduleId].receivesFrom.add(other.moduleName);
          if (!deps[other.moduleId]) deps[other.moduleId] = { receivesFrom: new Set(), sendsTo: new Set() };
          deps[other.moduleId].sendsTo.add(mod.moduleName);
        }
      }
    }
  }

  // Convert Sets to arrays for serialization
  const result = {};
  for (const [id, val] of Object.entries(deps)) {
    result[id] = {
      receivesFrom: Array.from(val.receivesFrom),
      sendsTo: Array.from(val.sendsTo),
    };
  }
  return result;
}

function buildSonnetNarrativePrompt(extractions, deps) {
  // Cap to top 30 most-connected modules to keep output within max_tokens budget.
  // For large models (e.g. 214 modules) a full response would exceed 8K tokens.
  const MAX_NARR_MODULES = 30;
  const ranked = extractions
    .map(m => {
      const d = deps[m.moduleId] || { receivesFrom: [], sendsTo: [] };
      return { m, connections: d.receivesFrom.length + d.sendsTo.length };
    })
    .sort((a, b) => b.connections - a.connections)
    .slice(0, MAX_NARR_MODULES)
    .map(x => x.m);

  const userContent = `Generate a cross-module data-flow narrative for this Anaplan model.

Showing the ${ranked.length} most-connected modules (out of ${extractions.length} total).

Modules and dependencies:
${ranked.map(m => {
  const d = deps[m.moduleId] || { receivesFrom: [], sendsTo: [] };
  return `${m.moduleName} (id:${m.moduleId}) — receives-from: [${d.receivesFrom.join(', ')}] — sends-to: [${d.sendsTo.join(', ')}]`;
}).join('\n')}

Return JSON:
{
  "story": "<3-5 paragraph narrative of how data flows across modules>",
  "modules": [
    { "id": "<moduleId>", "name": "<moduleName>", "purpose": "<1 sentence>",
      "receivesFrom": ["<moduleName>", ...], "sendsTo": ["<moduleName>", ...],
      "risks": ["<risk text>", ...] }
  ]
}
Include one entry in modules[] for every module listed above, preserving the id.
Respond with raw JSON only — no markdown fences.`;

  const system = 'You are an expert Anaplan model reviewer producing data-flow narratives. Always respond with valid JSON only.';
  return { userContent, system };
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { blobUrl } = req.body;
  if (!blobUrl) {
    return res.status(400).json({ error: 'Missing blobUrl' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  // CRITICAL: SSE headers BEFORE first await
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  function sendEvent(obj) {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  }

  const startMs = Date.now();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    // Stage 1: Fetch blueprint from Vercel Blob
    sendEvent({ type: 'progress', stage: 'fetching', pct: 5 });
    const bpRes = await fetch(blobUrl);
    if (!bpRes.ok) throw new Error(`Blob fetch failed: ${bpRes.status}`);
    const blueprint = await bpRes.json();

    if (!blueprint.modules || !Array.isArray(blueprint.modules)) {
      throw new Error('Blueprint Blob is missing modules array');
    }

    // Stage 2: Extraction pre-pass (ANLZ-03)
    sendEvent({ type: 'progress', stage: 'extracting', pct: 15 });
    const extractions = extractionPrePass(blueprint);
    sendEvent({
      type: 'extraction-done',
      moduleCount: extractions.length,
      totalLineItems: extractions.reduce((s, m) => s + m.lineItemCount, 0),
    });

    // Stage 3: Batched Haiku suggestion calls (ANLZ-02)
    sendEvent({ type: 'progress', stage: 'suggestions', pct: 25 });
    const haikuResults = await runHaikuBatches(client, extractions, sendEvent, startMs);
    const allSuggestions = haikuResults.flatMap(r =>
      r.items.map(it => ({ ...it, moduleId: r.moduleId, moduleName: r.moduleName }))
    );

    // Total budget guard before Sonnet calls
    if (Date.now() - startMs > TOTAL_BUDGET_MS) {
      sendEvent({ type: 'partial-analysis', reason: 'Total budget reached before synthesis', modulesAnalysed: haikuResults.length, modulesSkipped: 0 });
      sendEvent({ type: 'complete', healthScore: null, totalSuggestions: allSuggestions.length, analysisId: blueprint.modelId });
      return;
    }

    // Stage 4a: Sonnet synthesis — health score, verdict, dimensions (ANLZ-01)
    sendEvent({ type: 'progress', stage: 'scoring', pct: 70 });
    const { userContent: synthUser, system: synthSystem } = buildSonnetSynthesisPrompt(extractions, allSuggestions);
    const synthMessages = [{ role: 'user', content: synthUser }];
    await guardTokens(client, SONNET_MODEL, synthMessages, synthSystem);
    const synthRaw = await client.messages.create({ model: SONNET_MODEL, max_tokens: 1024, messages: synthMessages, system: synthSystem });
    const synth = normalizeSynthesis(parseJsonStrict(synthRaw.content?.[0]?.text));

    sendEvent({
      type: 'score',
      healthScore: synth.healthScore,
      verdict: synth.verdict,
      summary: synth.summary,
      dimensions: synth.dimensions,
    });

    // Stage 4b: Sonnet narrative — cross-module data flow (ANLZ-04)
    sendEvent({ type: 'progress', stage: 'narrative', pct: 85 });

    // Time-check before narrative
    if (Date.now() - startMs > TOTAL_BUDGET_MS) {
      sendEvent({ type: 'complete', healthScore: synth.healthScore, totalSuggestions: allSuggestions.length, analysisId: blueprint.modelId });
      return;
    }

    const deps = detectDependencies(extractions);
    const { userContent: narrUser, system: narrSystem } = buildSonnetNarrativePrompt(extractions, deps);
    const narrMessages = [{ role: 'user', content: narrUser }];
    await guardTokens(client, SONNET_MODEL, narrMessages, narrSystem);
    const narrResp = await client.messages.create({ model: SONNET_MODEL, max_tokens: 8192, messages: narrMessages, system: narrSystem });
    const narrRaw = parseJsonStrict(narrResp.content?.[0]?.text) || { story: '', modules: [] };

    sendEvent({
      type: 'narrative',
      story: narrRaw.story || '',
      modules: Array.isArray(narrRaw.modules) ? narrRaw.modules : [],
    });

    sendEvent({ type: 'complete', healthScore: synth.healthScore, totalSuggestions: allSuggestions.length, analysisId: blueprint.modelId });

  } catch (err) {
    console.error('Analyze error:', err.message);
    sendEvent({ type: 'error', message: err.message });
  } finally {
    res.end();
  }
}
