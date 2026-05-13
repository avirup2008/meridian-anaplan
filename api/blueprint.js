import { put } from '@vercel/blob';
import { applyCors } from './_cors.js';

// BPRT-01: parallel batch size — raised from 20 to 60 so 228-module models
// complete in ~4 rounds instead of 12, fitting within the 60s Vercel budget.
const BATCH_SIZE = 60;
// BPRT-04: default backoff if Retry-After missing
const RETRY_AFTER_DEFAULT_MS = 10_000;
// BPRT-04: per-module retry cap
const MAX_RETRIES = 2;
// Per-request timeout: lowered from 18s to 10s so a hung module fails fast
// and doesn't stall the whole batch — 60 × 10s worst-case = 60s, fits budget.
const REQUEST_TIMEOUT_MS = 10_000;

async function fetchWithRetry(url, token) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let r;
    try {
      r = await fetch(url, {
        headers: { 'Authorization': `AnaplanAuthToken ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Timeout or network error — treat as retryable
      if (attempt < MAX_RETRIES) continue;
      return null;
    }
    if (r.status !== 429) return r;
    const ra = parseInt(r.headers.get('Retry-After') ?? '10', 10);
    const waitMs = (isNaN(ra) || ra <= 0) ? RETRY_AFTER_DEFAULT_MS : ra * 1000;
    await new Promise((res) => setTimeout(res, waitMs));
  }
  return null; // exhausted retries
}

async function fetchModuleLineItems(mod, wsId, modelId, token) {
  const url = `https://api.anaplan.com/2/0/workspaces/${wsId}/models/${modelId}/modules/${mod.id}/lineItems?includeAll=true`;
  const r = await fetchWithRetry(url, token);
  if (!r || !r.ok) {
    return {
      id: mod.id,
      name: mod.name,
      lineItemCount: 0,
      lineItems: [],
      fetchError: r ? `HTTP ${r.status}` : 'Timeout or rate limit — skipped',
    };
  }
  const data = await r.json();
  const items = data.items || [];
  return { id: mod.id, name: mod.name, lineItemCount: items.length, lineItems: items };
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { workspaceId, modelId } = req.body;
  if (!workspaceId || !modelId) return res.status(400).json({ error: 'Missing workspaceId or modelId' });

  const wsId = workspaceId.toLowerCase();

  // Blueprint always re-authenticates fresh — token reuse risks expiry mid-fetch
  // on large models (100+ modules can take 60-90s). Re-auth cost is one round-trip
  // at the start; reliable for any model size.
  const username = req.headers['x-anaplan-user'];
  const password = req.headers['x-anaplan-pass'];

  if (!username || !password) {
    return res.status(400).json({ error: 'Missing credentials' });
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

  try {
    // Step 1: Authenticate fresh — never reuse a stored token for blueprint
    const encoded = Buffer.from(`${username}:${password}`).toString('base64');
    const authRes = await fetch('https://auth.anaplan.com/token/authenticate', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${encoded}`, 'Content-Type': 'application/json' },
      body: ''
    });
    if (!authRes.ok) {
      sendEvent({ type: 'error', message: 'Auth failed — please reconnect' });
      return;
    }
    const authData = await authRes.json();
    const token = authData?.tokenInfo?.tokenValue;
    if (!token) {
      sendEvent({ type: 'error', message: 'Auth failed — please reconnect' });
      return;
    }

    // Step 2: List modules for the selected model
    const modRes = await fetch(
      `https://api.anaplan.com/2/0/workspaces/${wsId}/models/${modelId}/modules`,
      { headers: { 'Authorization': `AnaplanAuthToken ${token}` } }
    );
    if (!modRes.ok) {
      sendEvent({ type: 'error', message: `Failed to list modules: HTTP ${modRes.status}` });
      return;
    }
    const modData = await modRes.json();
    const modules = modData.modules || [];

    sendEvent({ type: 'progress', modulesDone: 0, modulesTotal: modules.length, moduleName: '', lineItemCount: 0 });

    // Step 3: Fetch line items in batches (BPRT-01)
    const assembled = [];
    let totalLineItems = 0;
    let partialLoad = false;
    let modulesDone = 0;

    for (let i = 0; i < modules.length; i += BATCH_SIZE) {
const batch = modules.slice(i, i + BATCH_SIZE);
      const settled = await Promise.allSettled(
        batch.map((mod) => fetchModuleLineItems(mod, wsId, modelId, token))
      );

      for (let j = 0; j < settled.length; j++) {
        const mod = batch[j];
        const s = settled[j];
        let result;
        if (s.status === 'fulfilled') {
          result = s.value;
        } else {
          result = {
            id: mod.id,
            name: mod.name,
            lineItemCount: 0,
            lineItems: [],
            fetchError: s.reason?.message || 'Unknown fetch error',
          };
        }

        if (result.fetchError) {
          partialLoad = true;
          sendEvent({ type: 'partial-warning', moduleName: result.name, reason: result.fetchError });
        } else {
          totalLineItems += result.lineItemCount;
        }

        assembled.push(result);
        modulesDone++;
        sendEvent({
          type: 'progress',
          modulesDone,
          modulesTotal: modules.length,
          moduleName: result.name,
          lineItemCount: result.lineItemCount,
        });
      }
    }

    // Build BlueprintDocument
    const blueprint = {
      modelId,
      workspaceId: wsId,
      fetchedAt: new Date().toISOString(),
      moduleCount: modules.length,
      totalLineItems,
      partialLoad,
      modules: assembled,
    };

    const json = JSON.stringify(blueprint);
    const pathname = `blueprints/${modelId}-${Date.now()}.json`;
    const putResult = await put(pathname, json, {
      access: 'public',
      contentType: 'application/json',
      allowOverwrite: true,
    });

    // Schema preview for developer handoff checkpoint
    const sampleModule = blueprint.modules.find((m) => m.lineItems.length > 0);
    const schemaPreview = {
      moduleCount: blueprint.moduleCount,
      totalLineItems: blueprint.totalLineItems,
      partialLoad: blueprint.partialLoad,
      sampleModuleName: sampleModule?.name ?? null,
      sampleLineItemKeys: sampleModule?.lineItems[0] ? Object.keys(sampleModule.lineItems[0]) : [],
      sampleFormula: sampleModule?.lineItems.find((li) => li.formula)?.formula ?? null,
    };
    sendEvent({ type: 'schema-preview', schema: schemaPreview });

    sendEvent({
      type: 'complete',
      blobUrl: putResult.url,
      moduleCount: blueprint.moduleCount,
      totalLineItems: blueprint.totalLineItems,
      partialLoad: blueprint.partialLoad,
    });

  } catch (err) {
    console.error('Blueprint error:', err.message);
    sendEvent({ type: 'error', message: err.message });
  } finally {
    res.end();
  }
}
