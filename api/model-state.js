import { put } from '@vercel/blob';
import { applyCors } from './_cors.js';
import { isDecorativeModuleName } from './analysis-core.js';

export const config = { maxDuration: 60 };

// ─── Constants ────────────────────────────────────────────────────────────────

const GATE_THRESHOLDS = {
  fetchCompleteness: 0.95,
  formulaCoverage: 0.50,
  graphDensity: 0.30,
  namingCoverage: 0.60,
};

const FORMULA_TRUNCATE_LEN = 150; // chars

// Matches DISCO-style prefixes: e.g. "SYS01 ", "DAT02 ", "REP10 "
const DISCO_PREFIX_REGEX = /^[A-Z]{2,5}\d{2}\s/;

// Worker pool constants — matching blueprint.js values for consistency
const FETCH_CONCURRENCY = 8;
const MAX_RETRIES = 1;
const REQUEST_TIMEOUT_MS = 7_000;
const TOTAL_BUDGET_MS = 52_000;
const RETRY_AFTER_DEFAULT_MS = 2_000;
const RETRY_AFTER_MAX_MS = 3_000;

// ─── Security helpers ─────────────────────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
  'authorization', 'password', 'token', 'tokenvalue',
  'x-anaplan-user', 'x-anaplan-pass',
]);

/**
 * Strips sensitive fields before logging. Recurses one level into nested objects.
 * NEVER call with raw req.headers, req.body if it may contain credentials, or the auth token.
 */
function safeLog(label, obj) {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    console.log(label, obj);
    return;
  }
  const cleaned = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      cleaned[k] = '[REDACTED]';
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const nested = {};
      for (const [nk, nv] of Object.entries(v)) {
        nested[nk] = SENSITIVE_KEYS.has(nk.toLowerCase()) ? '[REDACTED]' : nv;
      }
      cleaned[k] = nested;
    } else {
      cleaned[k] = v;
    }
  }
  console.log(label, cleaned);
}

// ─── Budget helpers (copied from blueprint.js) ────────────────────────────────

function elapsedSince(startMs) {
  return Date.now() - startMs;
}

function budgetRemaining(startMs) {
  return TOTAL_BUDGET_MS - elapsedSince(startMs);
}

// ─── Per-module fetch with retry (adapted from blueprint.js) ─────────────────

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
      if (err.name === 'TimeoutError' || err.name === 'AbortError') return null;
      if (attempt < MAX_RETRIES) continue;
      return null;
    }
    if (r.status !== 429) return r;
    const ra = parseInt(r.headers.get('Retry-After') ?? '10', 10);
    const waitMs = Math.min((isNaN(ra) || ra <= 0) ? RETRY_AFTER_DEFAULT_MS : ra * 1_000, RETRY_AFTER_MAX_MS);
    if (budgetRemaining(startMs) < waitMs + 5_000) return null;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return null;
}

async function fetchModuleLineItems(mod, wsId, mId, token, startMs) {
  const url = `https://api.anaplan.com/2/0/workspaces/${wsId}/models/${mId}/modules/${mod.id}/lineItems?includeAll=true`;
  const r = await fetchWithRetry(url, token, startMs);
  if (!r || !r.ok) {
    return {
      id: mod.id,
      name: mod.name,
      lineItems: [],
      fetchError: r ? `HTTP ${r.status}` : 'Timeout or rate limit — skipped',
    };
  }
  const data = await r.json();
  const items = data.items || [];
  return { id: mod.id, name: mod.name, lineItems: items };
}

/**
 * Fan-out per-module line item fetches using a bounded worker pool (concurrency=8).
 * Streams no per-module progress events — only named stage events per D-08.
 */
async function fetchAllModuleLineItems({ modules, wsId, mId, token, startMs, sendEvent }) {
  const assembled = [];
  let fetchedCount = 0;
  let partialLoad = false;
  let cursor = 0;

  async function worker() {
    while (cursor < modules.length) {
      if (budgetRemaining(startMs) < 6_000) return;
      const mod = modules[cursor++];
      let result;
      try {
        result = await fetchModuleLineItems(mod, wsId, mId, token, startMs);
      } catch (err) {
        result = {
          id: mod.id,
          name: mod.name,
          lineItems: [],
          fetchError: err?.message || 'Unknown fetch error',
        };
      }

      if (result.fetchError) {
        partialLoad = true;
        sendEvent({ type: 'partial-warning', moduleName: result.name, reason: result.fetchError });
      } else {
        fetchedCount++;
      }
      assembled.push(result);
    }
  }

  const workers = Array.from(
    { length: Math.min(FETCH_CONCURRENCY, modules.length) },
    () => worker(),
  );
  await Promise.all(workers);

  // If budget cut short, backfill any missing modules with fetch-error stubs
  if (assembled.length < modules.length) {
    partialLoad = true;
    const fetchedIds = new Set(assembled.map((m) => m.id));
    for (const mod of modules) {
      if (fetchedIds.has(mod.id)) continue;
      assembled.push({
        id: mod.id,
        name: mod.name,
        lineItems: [],
        fetchError: 'Serverless time budget reached — skipped',
      });
      sendEvent({ type: 'partial-warning', moduleName: mod.name, reason: 'Serverless time budget reached — skipped' });
    }
  }

  return { assembled, fetchedCount, partialLoad };
}

// ─── Serialization ────────────────────────────────────────────────────────────

/**
 * Produces compact tab-separated text: one MODULE header + one line per line item per module.
 * Decorators must be excluded BEFORE calling this function (pass only functional modules).
 */
function serializeModelState(functionalModules) {
  const lines = [];
  for (const mod of functionalModules) {
    const prefix = DISCO_PREFIX_REGEX.test(mod.name)
      ? mod.name.match(/^([A-Z]{2,5})\d{2}\s/)[1]
      : '';
    lines.push(`MODULE\t${mod.id}\t${mod.name.replace(/[\t\n]/g, ' ')}\t${prefix}`);

    for (const li of mod.lineItems) {
      const name = (li.name ?? '').replace(/[\t\n]/g, ' ');
      const format = (li.formatType ?? li.format ?? '').replace(/[\t\n]/g, ' ');
      const summary = (li.summaryMethod ?? li.summary ?? '').replace(/[\t\n]/g, ' ');

      // Determine type label
      let typeLabel;
      if (typeof li.formula === 'string' && li.formula.trim().length > 0) {
        typeLabel = 'CALC';
      } else if (li.isInput === true) {
        typeLabel = 'INPUT';
      } else {
        typeLabel = 'ITEM';
      }

      // Truncate formula
      let formula = '';
      if (typeLabel === 'CALC') {
        const raw = li.formula.replace(/[\t\n]/g, ' ');
        formula = raw.length > FORMULA_TRUNCATE_LEN
          ? raw.slice(0, FORMULA_TRUNCATE_LEN) + '…'
          : raw;
      }

      lines.push(`${typeLabel}\t${name}\t${format}\t${summary}\t${formula}`);
    }

    // Blank line between modules
    lines.push('');
  }
  return lines.join('\n');
}

// ─── Dependency edge count ─────────────────────────────────────────────────────

/**
 * Counts deduplicated directed cross-module formula reference edges.
 * Caps formula scan at 10K characters for performance on large models.
 */
function computeDependencyEdges(functionalModules) {
  const nameToId = new Map(functionalModules.map((m) => [m.name, m.id]));
  let totalEdges = 0;

  for (const mod of functionalModules) {
    const referencedModules = new Set();
    for (const li of mod.lineItems) {
      if (typeof li.formula !== 'string' || li.formula.trim().length === 0) continue;
      const formulaText = li.formula.length > 10_000 ? li.formula.slice(0, 10_000) : li.formula;

      for (const [refName, refId] of nameToId) {
        if (refId === mod.id) continue; // skip self-references
        if (referencedModules.has(refId)) continue; // already counted
        try {
          const escaped = refName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (new RegExp(escaped).test(formulaText)) {
            referencedModules.add(refId);
          }
        } catch {
          // Malformed regex from unusual module name — skip
        }
      }
    }
    totalEdges += referencedModules.size;
  }

  return totalEdges;
}

// ─── Evidence pack ────────────────────────────────────────────────────────────

/**
 * Computes admissibility gates and blocked-conclusions list.
 * @param {Array} functionalModules - modules after decorator exclusion
 * @param {Set} fetchedModuleIds - IDs of modules that were successfully fetched (no fetchError)
 * @param {number} totalModuleCount - total modules returned by the /modules call
 */
function computeEvidencePack(functionalModules, fetchedModuleIds, totalModuleCount) {
  const functional = functionalModules;
  const withFormulas = functional.filter((m) =>
    m.lineItems.some((li) => typeof li.formula === 'string' && li.formula.trim().length > 0),
  );
  const withNames = functional.filter((m) => DISCO_PREFIX_REGEX.test(m.name));
  const totalEdges = computeDependencyEdges(functional);

  const fetchCompleteness = totalModuleCount > 0 ? fetchedModuleIds.size / totalModuleCount : 0;
  const formulaCoverage = functional.length > 0 ? withFormulas.length / functional.length : 0;
  const graphDensity = functional.length > 1 ? Math.min(1, totalEdges / (functional.length * 2)) : 0;
  const namingCoverage = functional.length > 0 ? withNames.length / functional.length : 0;

  const blockedConclusions = [];
  if (fetchCompleteness < GATE_THRESHOLDS.fetchCompleteness) {
    blockedConclusions.push(
      `Architecture and health claims suppressed — fetch completeness ${fetchCompleteness.toFixed(2)} (minimum ${GATE_THRESHOLDS.fetchCompleteness.toFixed(2)} required).`,
    );
  }
  if (formulaCoverage < GATE_THRESHOLDS.formulaCoverage) {
    blockedConclusions.push(
      `Formula anti-pattern checks and dependency graph suppressed — formula coverage ${formulaCoverage.toFixed(2)} (minimum ${GATE_THRESHOLDS.formulaCoverage.toFixed(2)} required).`,
    );
  }
  if (graphDensity < GATE_THRESHOLDS.graphDensity) {
    blockedConclusions.push(
      `Cross-module dependency diagram suppressed — graph density ${graphDensity.toFixed(2)} (minimum ${GATE_THRESHOLDS.graphDensity.toFixed(2)} required).`,
    );
  }
  if (namingCoverage < GATE_THRESHOLDS.namingCoverage) {
    blockedConclusions.push(
      `DISCO architecture map and prefix classification suppressed — naming coverage ${namingCoverage.toFixed(2)} (minimum ${GATE_THRESHOLDS.namingCoverage.toFixed(2)} required).`,
    );
  }

  return {
    fetchCompleteness,
    formulaCoverage,
    graphDensity,
    namingCoverage,
    thresholds: GATE_THRESHOLDS,
    blockedConclusions,
    totalEdges,
    functionalModuleCount: functional.length,
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { workspaceId, modelId } = req.body ?? {};
  if (!workspaceId || !modelId) {
    return res.status(400).json({ error: 'Missing workspaceId or modelId' });
  }

  const username = req.headers['x-anaplan-user'];
  const password = req.headers['x-anaplan-pass'];
  if (!username || !password) {
    return res.status(400).json({ error: 'Missing credentials' });
  }

  // Lowercase IDs — T-06-06: path-segment injection mitigation
  const wsId = workspaceId.toLowerCase();
  const mId = modelId.toLowerCase();

  // CRITICAL: SSE headers BEFORE first await — X-Accel-Buffering prevents proxy buffering
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
    // ── Stage 1: Auth ──────────────────────────────────────────────────────────
    sendEvent({ type: 'stage', stage: 'auth', label: 'Authenticating…' });

    const encoded = Buffer.from(`${username}:${password}`).toString('base64');
    const authRes = await fetch('https://auth.anaplan.com/token/authenticate', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${encoded}`, 'Content-Type': 'application/json' },
      body: '',
    });
    if (!authRes.ok) {
      sendEvent({ type: 'error', message: 'Authentication failed — please reconnect.' });
      return;
    }
    const authData = await authRes.json();
    const token = authData?.tokenInfo?.tokenValue;
    if (!token) {
      sendEvent({ type: 'error', message: 'Authentication failed — please reconnect.' });
      return;
    }

    // ── Stage 2: Load model structure ──────────────────────────────────────────
    // D-03 fallback: model-level /lineItems endpoint does not exist (HTTP 404 confirmed in spike).
    // Pattern: fetch /modules list first, then fan out per-module lineItems with concurrency=8.
    sendEvent({ type: 'stage', stage: 'loading', label: 'Loading model structure…' });

    const baseUrl = `https://api.anaplan.com/2/0/workspaces/${wsId}/models/${mId}`;
    const authHeader = { 'Authorization': `AnaplanAuthToken ${token}` };

    const modRes = await fetch(`${baseUrl}/modules`, { headers: authHeader });
    if (!modRes.ok) {
      sendEvent({ type: 'error', message: `Failed to list modules: HTTP ${modRes.status}` });
      return;
    }
    const modData = await modRes.json();
    const modules = modData.modules || [];

    safeLog('[model-state] modules listed', { count: modules.length, wsId, mId });

    // Fan out per-module lineItems with bounded worker pool (concurrency=8, D-03 fallback)
    const { assembled, fetchedCount, partialLoad } = await fetchAllModuleLineItems({
      modules,
      wsId,
      mId,
      token,
      startMs,
      sendEvent,
    });

    // Build set of successfully-fetched module IDs for fetchCompleteness gate
    const fetchedModuleIds = new Set(
      assembled.filter((m) => !m.fetchError).map((m) => m.id),
    );

    // ── Stage 3: Serialize + filter decorators + compute evidence pack ─────────
    sendEvent({ type: 'stage', stage: 'serializing', label: 'Serializing state…' });

    const functional = assembled.filter((m) => !isDecorativeModuleName(m.name));
    const decorators = assembled.filter((m) => isDecorativeModuleName(m.name));

    const stateText = serializeModelState(functional);
    const evidencePack = computeEvidencePack(functional, fetchedModuleIds, modules.length);

    safeLog('[model-state] serialization complete', {
      functionalModules: functional.length,
      decoratorModules: decorators.length,
      stateBytes: stateText.length,
      fetchedCount,
      partialLoad,
    });

    // ── Stage 4: Write to Blob ─────────────────────────────────────────────────
    sendEvent({ type: 'stage', stage: 'writing', label: 'Writing state…' });

    const blob = await put(`model-state/${mId}-${Date.now()}.txt`, stateText, {
      access: 'public',
      contentType: 'text/plain',
      allowOverwrite: true,
    });

    const lineItemCount = functional.reduce((s, m) => s + m.lineItems.length, 0);

    sendEvent({
      type: 'complete',
      stateUrl: blob.url,
      evidencePack,
      moduleCount: functional.length,
      excludedCount: decorators.length,
      lineItemCount,
      tokenEstimate: Math.round(stateText.length / 4), // rough chars/4 estimate
    });

  } catch (err) {
    console.error('model-state error:', err.message);
    sendEvent({ type: 'error', message: err.message });
  } finally {
    res.end();
  }
}
