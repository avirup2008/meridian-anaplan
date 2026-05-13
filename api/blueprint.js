import { put } from '@vercel/blob';
import { applyCors } from './_cors.js';

// BPRT-01: bounded worker pool. Do not wait for a whole batch before streaming progress.
const FETCH_CONCURRENCY = 8;
// BPRT-04: default backoff if Retry-After missing
const RETRY_AFTER_DEFAULT_MS = 2_000;
const RETRY_AFTER_MAX_MS = 3_000;
// BPRT-04: per-module retry cap
const MAX_RETRIES = 1;
// Per-request timeout: abort a hung connection so it never blocks an entire batch
const REQUEST_TIMEOUT_MS = 7_000;
// Leave enough time to write the partial/full blueprint to Blob before Vercel's 60s cap.
const TOTAL_BUDGET_MS = 52_000;

function elapsedSince(startMs) {
  return Date.now() - startMs;
}

function budgetRemaining(startMs) {
  return TOTAL_BUDGET_MS - elapsedSince(startMs);
}

async function fetchWithRetry(url, token, startMs) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (budgetRemaining(startMs) < 5_000) return null;
    let r;
    try {
      const timeoutMs = Math.min(REQUEST_TIMEOUT_MS, Math.max(1_000, budgetRemaining(startMs) - 3_000));
      r = await fetch(url, {
        headers: { 'Authorization': `AnaplanAuthToken ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // Timeout (AbortError/TimeoutError) — don't retry, just skip this module
      if (err.name === 'TimeoutError' || err.name === 'AbortError') return null;
      // Other network error — retryable
      if (attempt < MAX_RETRIES) continue;
      return null;
    }
    if (r.status !== 429) return r;
    const ra = parseInt(r.headers.get('Retry-After') ?? '10', 10);
    const waitMs = Math.min((isNaN(ra) || ra <= 0) ? RETRY_AFTER_DEFAULT_MS : ra * 1000, RETRY_AFTER_MAX_MS);
    if (budgetRemaining(startMs) < waitMs + 5_000) return null;
    await new Promise((res) => setTimeout(res, waitMs));
  }
  return null; // exhausted retries
}

async function fetchModuleLineItems(mod, wsId, modelId, token, startMs) {
  const url = `https://api.anaplan.com/2/0/workspaces/${wsId}/models/${modelId}/modules/${mod.id}/lineItems?includeAll=true`;
  const r = await fetchWithRetry(url, token, startMs);
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

async function fetchModulesWithProgress({ modules, wsId, modelId, token, startMs, sendEvent }) {
  const assembled = [];
  let totalLineItems = 0;
  let partialLoad = false;
  let modulesDone = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < modules.length) {
      if (budgetRemaining(startMs) < 6_000) return;
      const mod = modules[cursor++];
      let result;
      try {
        result = await fetchModuleLineItems(mod, wsId, modelId, token, startMs);
      } catch (err) {
        result = {
          id: mod.id,
          name: mod.name,
          lineItemCount: 0,
          lineItems: [],
          fetchError: err?.message || 'Unknown fetch error',
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

  const workers = Array.from({ length: Math.min(FETCH_CONCURRENCY, modules.length) }, () => worker());
  await Promise.all(workers);

  if (assembled.length < modules.length) {
    partialLoad = true;
    const fetchedIds = new Set(assembled.map(m => m.id));
    for (const mod of modules) {
      if (fetchedIds.has(mod.id)) continue;
      const result = {
        id: mod.id,
        name: mod.name,
        lineItemCount: 0,
        lineItems: [],
        fetchError: 'Serverless time budget reached — skipped',
      };
      assembled.push(result);
      modulesDone++;
      sendEvent({ type: 'partial-warning', moduleName: result.name, reason: result.fetchError });
      sendEvent({
        type: 'progress',
        modulesDone,
        modulesTotal: modules.length,
        moduleName: result.name,
        lineItemCount: 0,
      });
    }
  }

  return { assembled, totalLineItems, partialLoad };
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

  const startMs = Date.now();

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

    // Step 3: Fetch line items with a bounded worker pool and stream every completed module.
    const { assembled, totalLineItems, partialLoad } = await fetchModulesWithProgress({
      modules,
      wsId,
      modelId,
      token,
      startMs,
      sendEvent,
    });

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
