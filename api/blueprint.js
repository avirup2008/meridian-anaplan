import { put } from '@vercel/blob';

// BPRT-01: parallel batch size
const BATCH_SIZE = 20;
// BPRT-04: default backoff if Retry-After missing
const RETRY_AFTER_DEFAULT_MS = 10_000;
// BPRT-04: per-module retry cap
const MAX_RETRIES = 2;

async function fetchWithRetry(url, token) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const r = await fetch(url, { headers: { 'Authorization': `AnaplanAuthToken ${token}` } });
    if (r.status !== 429) return r;
    const ra = parseInt(r.headers.get('Retry-After') ?? '10', 10);
    const waitMs = (isNaN(ra) || ra <= 0) ? RETRY_AFTER_DEFAULT_MS : ra * 1000;
    await new Promise((res) => setTimeout(res, waitMs));
  }
  // exhausted retries — caller decides what to do
  return null;
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
      fetchError: r ? `HTTP ${r.status}` : 'Rate limit retries exhausted (429)',
    };
  }
  const data = await r.json();
  const items = data.items || [];
  return { id: mod.id, name: mod.name, lineItemCount: items.length, lineItems: items };
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-anaplan-user, x-anaplan-pass');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { workspaceId, modelId } = req.body;

  if (!workspaceId || !modelId) {
    return res.status(400).json({ error: 'Missing workspaceId or modelId' });
  }

  const username = req.headers['x-anaplan-user'];
  const password = req.headers['x-anaplan-pass'];

  if (!username || !password) {
    return res.status(400).json({ error: 'Missing credentials' });
  }

  // Normalize workspace ID to lowercase
  const wsId = workspaceId.toLowerCase();

  // Build Basic Auth header server-side — encoded string is never logged
  const encoded = Buffer.from(`${username}:${password}`).toString('base64');

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
    // Step 1: Authenticate with Anaplan via Basic Auth
    const authRes = await fetch('https://auth.anaplan.com/token/authenticate', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${encoded}`,
        'Content-Type': 'application/json'
      },
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

    const modData = await modRes.json();
    const modules = modData.modules || [];

    // Emit initial progress event
    sendEvent({ type: 'progress', modulesDone: 0, modulesTotal: modules.length, moduleName: '', lineItemCount: 0 });

    // Step 3: Fetch line items in batches (BPRT-01)
    const assembled = [];
    let totalLineItems = 0;
    let partialLoad = false;
    let modulesDone = 0;

    // BPRT-01: process modules in batches of 20 in parallel (controlled concurrency,
    // NOT all-at-once Promise.all which would trigger 429 storms, and NOT fully
    // sequential which would violate the batch-parallel requirement).
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
          // Promise rejection (network error, etc.) — treat as fetchError sentinel
          result = {
            id: mod.id,
            name: mod.name,
            lineItemCount: 0,
            lineItems: [],
            fetchError: s.reason?.message || 'Unknown fetch error',
          };
        }

        if (result.fetchError) {
          // BPRT-04: surface partial-warning and continue rather than failing the whole fetch
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

    // Build BlueprintDocument (locked schema)
    const blueprint = {
      modelId,
      workspaceId: wsId,
      fetchedAt: new Date().toISOString(),
      moduleCount: modules.length,
      totalLineItems,
      partialLoad,
      modules: assembled,
    };

    // BPRT-03: write blueprint to Vercel Blob server-side; the raw JSON must never
    // flow back through the function response body (4.5 MB body limit + privacy).
    const json = JSON.stringify(blueprint);
    const pathname = `blueprints/${modelId}-${Date.now()}.json`;

    // Decision: access:"public" — the Blob URL is consumed by /api/analyze server-side in Phase 4,
    // but downstream Phase 5 share flow also reads from Blob; "public" keeps the consumption path
    // simple and the URL itself is opaque (random suffix). Re-evaluate in Phase 5 share planning.
    const putResult = await put(pathname, json, {
      access: 'public',
      contentType: 'application/json',
      allowOverwrite: true,
    });

    // Developer-facing schema preview (NOT a BPRT requirement — internal Phase 3 → Phase 4
    // hand-off checkpoint so the developer can confirm the BlueprintDocument shape before
    // prompt engineering begins). Sent BEFORE the complete event.
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
    // Only log err.message (string) — never log err object, req.body, or encoded
    console.error('Blueprint error:', err.message);
    sendEvent({ type: 'error', message: err.message });
  } finally {
    res.end();
  }
}
