import Anthropic from '@anthropic-ai/sdk';
import { put, list, del } from '@vercel/blob';
import { applyCors } from './_cors.js';
import {
  isAllowedBlobUrl,
  blueprintHash,
  extractionPrePass,
  buildNarrativePrompt,
  parseJsonStrict,
} from './analyze.js';

const SONNET_MODEL = 'claude-sonnet-4-6';
const NARR_CACHE_PREFIX = 'analysis-narrative-cache-v2/'; // v2: Sonnet model, plain-English layer overview
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function getCachedNarrative(hash) {
  try {
    const { blobs } = await list({ prefix: `${NARR_CACHE_PREFIX}${hash}` });
    if (!blobs.length) return null;
    const blob = blobs[0];
    if (Date.now() - new Date(blob.uploadedAt).getTime() > CACHE_TTL_MS) {
      del(blob.url).catch(e => console.error('Stale narrative blob delete failed:', e.message));
      return null;
    }
    const resp = await fetch(blob.url);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function setCachedNarrative(hash, events) {
  try {
    await put(
      `${NARR_CACHE_PREFIX}${hash}.json`,
      JSON.stringify(events),
      { access: 'public', addRandomSuffix: false, allowOverwrite: true }
    );
  } catch (e) {
    console.error('Narrative cache write failed (non-fatal):', e.message);
  }
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const blobUrl = req.body?.blobUrl;
  if (!blobUrl) return res.status(400).json({ error: 'Missing blobUrl' });
  if (!isAllowedBlobUrl(blobUrl)) return res.status(400).json({ error: 'Invalid blobUrl — must be a Vercel Blob URL' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  // SSE headers BEFORE first await
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  function sendEvent(obj) {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  }

  let tickInterval = null;

  try {
    // Fetch blueprint
    const bpRes = await fetch(blobUrl);
    if (!bpRes.ok) throw new Error(`Blob fetch failed: ${bpRes.status}`);
    const blueprint = await bpRes.json();

    if (!blueprint.modules || !Array.isArray(blueprint.modules)) {
      throw new Error('Blueprint missing modules array');
    }

    // Cache check — replay narrative events instantly on hit
    const hash = blueprintHash(blueprint);
    const cached = await getCachedNarrative(hash);
    if (cached) {
      for (const evt of cached) {
        res.write(`data: ${JSON.stringify(evt)}\n\n`);
      }
      if (typeof res.flush === 'function') res.flush();
      return;
    }

    // Extract modules — no dependency detection needed for layer overview
    const extractions = extractionPrePass(blueprint);

    // Real-time tick: creep bar 88→96% while awaiting Sonnet (~8s for short output)
    sendEvent({ type: 'progress', stage: 'narrative', pct: 88 });
    const _narrStartMs = Date.now();
    tickInterval = setInterval(() => {
      const elapsed = Date.now() - _narrStartMs;
      const pct = Math.min(96, 88 + Math.round((elapsed / 10_000) * 8));
      sendEvent({ type: 'progress', stage: 'narrative', pct });
    }, 2000);

    // Sonnet narrative call — better quality, output is short so fits easily in budget
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const { userContent: narrUser, system: narrSystem } = buildNarrativePrompt(extractions, null);
    const narrResp = await client.messages.create({
      model: SONNET_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: narrUser }],
      system: narrSystem,
    });
    clearInterval(tickInterval); tickInterval = null;

    const narrRaw = parseJsonStrict(narrResp.content?.[0]?.text) || { story: '' };
    const narrativeEvent = {
      type: 'narrative',
      story: narrRaw.story || '',
    };

    sendEvent(narrativeEvent);
    sendEvent({ type: 'narrative-complete' });

    // Cache narrative for instant replay on future requests (v2 prefix — separate from v1)
    await setCachedNarrative(hash, [narrativeEvent, { type: 'narrative-complete' }]);

  } catch (err) {
    console.error('Narrative error:', err.message);
    sendEvent({ type: 'narrative-error', message: err.message });
  } finally {
    if (tickInterval) clearInterval(tickInterval);
    res.end();
  }
}
