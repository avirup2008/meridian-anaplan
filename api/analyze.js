import { put, list, del } from '@vercel/blob';
import { createHash } from 'crypto';
import { applyCors } from './_cors.js';
import {
  buildAnalysisSnapshot,
  normalizeBlueprint,
} from './analysis-core.js';

const TOTAL_BUDGET_MS = 52_000;    // guard before Vercel 60s hard kill
const FORMULA_MAX_CHARS = 200;     // allow longer formula previews
const FORMULA_MAX_PER_MODULE = 12; // show more calculated line items per module
const INPUT_MAX_PER_MODULE = 25;   // max input line items shown per module
const MAX_INPUT_TOKENS = 180_000;

// Caching
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CACHE_PREFIX = 'analysis-cache-v20/'; // v20: evidence-backed workstream intelligence, no synthetic score

// CA-04: Hash only stable fields — exclude fetchedAt which changes on every blueprint fetch
export function blueprintHash(blueprint) {
  const stableKey = { modelId: blueprint.modelId, modules: blueprint.modules };
  return createHash('sha256')
    .update(JSON.stringify(stableKey))
    .digest('hex')
    .slice(0, 24);
}

// SEC-01: Only allow Vercel Blob domains to prevent SSRF.
// Vercel Blob URLs are prefixed with a store-specific subdomain:
// e.g. https://<store-id>.public.blob.vercel-storage.com/<path>
export function isAllowedBlobUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (
      u.hostname.endsWith('.public.blob.vercel-storage.com') ||
      u.hostname.endsWith('.blob.vercel-storage.com')
    );
  } catch {
    return false;
  }
}

async function getCachedEvents(hash) {
  try {
    const { blobs } = await list({ prefix: `${CACHE_PREFIX}${hash}` });
    if (!blobs.length) return null;
    const blob = blobs[0];
    // CA-03: Delete stale blobs rather than silently skipping — prevents storage accumulation
    if (Date.now() - new Date(blob.uploadedAt).getTime() > CACHE_TTL_MS) {
      del(blob.url).catch(e => console.error('Stale blob delete failed (non-fatal):', e.message));
      return null;
    }
    const resp = await fetch(blob.url);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function setCachedEvents(hash, events) {
  try {
    await put(
      `${CACHE_PREFIX}${hash}.json`,
      JSON.stringify(events),
      { access: 'public', addRandomSuffix: false, allowOverwrite: true }
    );
  } catch (e) {
    console.error('Cache write failed (non-fatal):', e.message);
  }
}

// ANLZ-03: Extraction pre-pass — strips banned fields, reduces appliesTo to dimensions[]
export function extractionPrePass(blueprint) {
  return normalizeBlueprint(blueprint).modules.map(mod => ({
    moduleId: mod.id,
    moduleName: mod.name,
    lineItemCount: mod.lineItemCount,
    lineItems: mod.lineItems.map(li => ({
      id: li.id,
      name: li.name,
      formula: li.formula || null,
      format: li.formatType || null,
      summary: li.summaryMethod || null,
      dimensions: li.dimensions,
      notes: li.notes || null,
      formulaLength: li.formulaLength,
      ifDepth: li.ifDepth,
    })),
  }));
}

// Strip markdown fences and JSON.parse; return null on failure
export function parseJsonStrict(text) {
  const cleaned = String(text || '').replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

export async function guardTokens(client, model, messages, system = null) {
  const result = await client.messages.countTokens({
    model,
    messages,
    ...(system ? { system } : {}),
  });
  const inputTokens = result?.input_tokens ?? 0;
  if (inputTokens > MAX_INPUT_TOKENS) {
    throw new Error(`Prompt exceeds token budget: ${inputTokens} > ${MAX_INPUT_TOKENS}`);
  }
  return inputTokens;
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
        // B-10: append '.' so 'FIN02' won't match inside 'FIN020' or 'FIN02Cost'
        if (li.formula.includes(other.moduleName + '.')) {
          deps[mod.moduleId].receivesFrom.add(other.moduleName);
          if (!deps[other.moduleId]) deps[other.moduleId] = { receivesFrom: new Set(), sendsTo: new Set() };
          deps[other.moduleId].sendsTo.add(mod.moduleName);
        }
      }
    }
  }
  const result = {};
  for (const [id, val] of Object.entries(deps)) {
    result[id] = {
      receivesFrom: Array.from(val.receivesFrom),
      sendsTo: Array.from(val.sendsTo),
    };
  }
  return result;
}

// B-02: Generates a plain-English model overview — layers, scope, data flow direction
export function buildNarrativePrompt(extractions, _deps) {
  const totalLineItems = extractions.reduce((s, m) => s + m.lineItemCount, 0);

  // Group modules by pillar prefix so Sonnet understands what layers exist
  const pillarMap = {};
  for (const m of extractions) {
    const prefix = (m.moduleName.match(/^([A-Z]{2,4})/) || ['', 'OTHER'])[1];
    pillarMap[prefix] = (pillarMap[prefix] || 0) + 1;
  }
  const pillarSummary = Object.entries(pillarMap)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${v} modules`)
    .join(', ');

  const sampleNames = extractions.slice(0, 30).map(m => m.moduleName).join(', ');

  const userContent = `You are a senior Anaplan model builder. Write a concise plain-English description of this model's design for a business stakeholder — not a technical audience.

MODEL: ${extractions.length} modules, ${totalLineItems} line items
PILLARS: ${pillarSummary}
SAMPLE NAMES: ${sampleNames}

Describe:
1. What planning problem this model solves and its overall scope
2. The main layers (e.g. data hub, operational planning, financial consolidation, reporting) and how data flows top-down through them
3. Any notable structural approach (e.g. whether it separates actuals from forecasts, centralises master data, etc.)

Format — use this exact structure:
• One opening sentence covering what the model does and its scale
• 3–5 bullet points (use the • character) for the main layers and data flow
• One closing sentence on the overall structural approach

Rules:
- Under 130 words total
- Avoid Anaplan jargon: do not use terms like hub-and-spoke, DISCO, PLANS, Polaris, fan-out, daisy-chain
- Do not mention formula issues, violations, or health score
- Do not fabricate module names not in the list above
- Write as if explaining to a finance or ops director, not a developer

Return JSON only: { "story": "<description>" }`;

  const system = 'You are a senior Anaplan model builder writing plain-English model overviews for business stakeholders. Always respond with valid JSON only, no markdown fences.';
  return { userContent, system };
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const blobUrl = req.body?.blobUrl; // safe — req.body may be undefined if body parsing fails
  if (!blobUrl) return res.status(400).json({ error: 'Missing blobUrl' });
  // SEC-01: Reject non-Vercel-Blob URLs before any network call (SSRF guard)
  if (!isAllowedBlobUrl(blobUrl)) return res.status(400).json({ error: 'Invalid blobUrl — must be a Vercel Blob URL' });

  // SSE headers BEFORE first await
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Event log collects every event so we can cache and replay
  const eventLog = [];
  function sendEvent(obj) {
    eventLog.push(obj);
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  }

  // Declared outside try so finally can always clearInterval it regardless of where error occurs
  let tickInterval = null;

  try {
    // Stage 1: Fetch blueprint
    sendEvent({ type: 'progress', stage: 'fetching', pct: 5 });
    const bpRes = await fetch(blobUrl);
    if (!bpRes.ok) throw new Error(`Blob fetch failed: ${bpRes.status}`);
    const blueprint = await bpRes.json();

    if (!blueprint.modules || !Array.isArray(blueprint.modules)) {
      throw new Error('Blueprint Blob is missing modules array');
    }

    // Stage 1b: Check cache before rebuilding evidence workstreams
    const hash = blueprintHash(blueprint);
    const cached = await getCachedEvents(hash);
    if (cached) {
      // Replay stored events — free, instant
      res.write(`data: ${JSON.stringify({ type: 'cache-hit' })}\n\n`);
      for (const evt of cached) {
        // Mark the complete event so the frontend knows this is a cache replay
        const toSend = evt.type === 'complete' ? { ...evt, fromCache: true } : evt;
        res.write(`data: ${JSON.stringify(toSend)}\n\n`);
      }
      if (typeof res.flush === 'function') res.flush();
      return;
    }

    // Stage 2: Extraction pre-pass (ANLZ-03)
    sendEvent({ type: 'progress', stage: 'extracting', pct: 15 });
    const snapshot = buildAnalysisSnapshot(blueprint);
    const extractions = extractionPrePass(blueprint);
    sendEvent({
      type: 'extraction-done',
      moduleCount: extractions.length,
      totalLineItems: extractions.reduce((s, m) => s + m.lineItemCount, 0),
    });
    const deterministicByModule = new Map();
    for (const item of snapshot.deterministicSuggestions) {
      if (!deterministicByModule.has(item.moduleId)) {
        deterministicByModule.set(item.moduleId, { moduleId: item.moduleId, moduleName: item.moduleName, items: [] });
      }
      deterministicByModule.get(item.moduleId).items.push(item);
    }
    for (const group of deterministicByModule.values()) {
      sendEvent({ type: 'suggestions', moduleId: group.moduleId, moduleName: group.moduleName, items: group.items });
    }
    sendEvent({
      type: 'deterministic-scan',
      findingCount: snapshot.findings.length,
      healthScore: snapshot.score.healthScore,
      verdict: snapshot.score.verdict,
    });
    sendEvent({
      type: 'intelligence',
      intelligence: snapshot.intelligence,
    });

    sendEvent({ type: 'progress', stage: 'scoring', pct: 90 });
    sendEvent({
      type: 'score',
      healthScore: snapshot.score.healthScore,
      verdict: snapshot.score.verdict,
      summary: snapshot.score.summary,
      dimensions: snapshot.score.dimensions,
      confidence: snapshot.score.confidence,
      posture: snapshot.score.posture,
    });
    sendEvent({
      type: 'complete',
      healthScore: snapshot.score.healthScore,
      totalSuggestions: snapshot.deterministicSuggestions.length,
      underlyingFindings: snapshot.findings.length,
      analysisId: blueprint.modelId,
      deterministicOnly: true,
      analysisMode: 'evidence-workstreams',
    });
    await setCachedEvents(hash, eventLog);
    return;

  } catch (err) {
    console.error('Analyze error:', err.message);
    sendEvent({ type: 'error', message: err.message });
  } finally {
    if (tickInterval) clearInterval(tickInterval);
    res.end();
  }
}
