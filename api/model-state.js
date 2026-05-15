import { put } from '@vercel/blob';
import { applyCors } from './_cors.js';
import { isDecorativeModuleName } from './analysis-core.js';

export const config = { maxDuration: 60 };

const GATE_THRESHOLDS = {
  fetchCompleteness: 0.95,
  formulaCoverage: 0.50,
  graphDensity: 0.30,
  namingCoverage: 0.60,
};

// 600 chars preserves most real Anaplan formulas (raised from 150 which was too short for AI analysis)
const FORMULA_TRUNCATE_LEN = 600;

const DISCO_PREFIX_REGEX = /^[A-Z]{2,5}\d{2}\s/;

const SENSITIVE_KEYS = new Set([
  'authorization', 'password', 'token', 'tokenvalue',
  'x-anaplan-user', 'x-anaplan-pass',
]);

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

// ─── Domain classifier ────────────────────────────────────────────────────────
// Infers model purpose from list (dimension) names — lists are the clearest semantic signal.

function classifyModelDomain(listNames) {
  const lower = listNames.join(' ').toLowerCase();
  if (/employee|headcount|fte|job.grade|position|workforce|personnel|hcm/.test(lower)) return 'Workforce Planning';
  if (/product|sku|channel|customer|territory|quota|pipeline|opportunity|crm/.test(lower)) return 'Sales & Revenue Planning';
  if (/supplier|warehouse|inventory|demand|lead.time|procurement|logistics|distribution/.test(lower)) return 'Supply Chain Planning';
  if (/project|milestone|capex|initiative|program|phase|deliverable/.test(lower)) return 'Project & Capex Planning';
  if (/entity|subsidiary|elimination|intercompany|consolidat|group/.test(lower)) return 'Financial Consolidation';
  if (/account|cost.center|gl|general.ledger|budget|forecast/.test(lower)) return 'Financial Planning & Analysis';
  return 'General Planning';
}

// ─── Serialization ────────────────────────────────────────────────────────────
// Enrichment sections (LIST/VERSION/IMPORT/EXPORT/PROCESS) are written before MODULE sections.
// analyze-v3 parseStateBlob reads all row types in a single pass.

function serializeModelState(functionalModules, enrichment = {}) {
  const lines = [];

  if (enrichment.lists?.length) {
    for (const l of enrichment.lists) {
      lines.push(`LIST\t${l.name.replace(/[\t\n]/g, ' ')}\t${l.itemCount || 0}`);
    }
    lines.push('');
  }
  if (enrichment.versions?.length) {
    for (const v of enrichment.versions) {
      lines.push(`VERSION\t${v.name.replace(/[\t\n]/g, ' ')}`);
    }
    lines.push('');
  }
  if (enrichment.imports?.length) {
    for (const i of enrichment.imports) {
      lines.push(`IMPORT\t${i.name.replace(/[\t\n]/g, ' ')}`);
    }
  }
  if (enrichment.exports?.length) {
    for (const e of enrichment.exports) {
      lines.push(`EXPORT\t${e.name.replace(/[\t\n]/g, ' ')}`);
    }
  }
  if (enrichment.processes?.length) {
    for (const p of enrichment.processes) {
      lines.push(`PROCESS\t${p.name.replace(/[\t\n]/g, ' ')}`);
    }
    lines.push('');
  }

  for (const mod of functionalModules) {
    const prefix = DISCO_PREFIX_REGEX.test(mod.name)
      ? mod.name.match(/^([A-Z]{2,5})\d{2}\s/)[1]
      : '';
    lines.push(`MODULE\t${mod.id}\t${mod.name.replace(/[\t\n]/g, ' ')}\t${prefix}`);

    for (const li of mod.lineItems) {
      const name = (li.name ?? '').replace(/[\t\n]/g, ' ');
      const format = (li.formatType ?? li.format ?? '').replace(/[\t\n]/g, ' ');
      const summary = (li.summaryMethod ?? li.summary ?? '').replace(/[\t\n]/g, ' ');

      let typeLabel;
      if (typeof li.formula === 'string' && li.formula.trim().length > 0) {
        typeLabel = 'CALC';
      } else if (li.isInput === true) {
        typeLabel = 'INPUT';
      } else {
        typeLabel = 'ITEM';
      }

      let formula = '';
      if (typeLabel === 'CALC') {
        const raw = li.formula.replace(/[\t\n]/g, ' ');
        formula = raw.length > FORMULA_TRUNCATE_LEN
          ? raw.slice(0, FORMULA_TRUNCATE_LEN) + '…'
          : raw;
      }

      lines.push(`${typeLabel}\t${name}\t${format}\t${summary}\t${formula}`);
    }

    lines.push('');
  }
  return lines.join('\n');
}

// ─── Dependency edge count ─────────────────────────────────────────────────────

function computeDependencyEdges(functionalModules) {
  const nameToId = new Map(functionalModules.map((m) => [m.name, m.id]));
  let totalEdges = 0;

  for (const mod of functionalModules) {
    const referencedModules = new Set();
    for (const li of mod.lineItems) {
      if (typeof li.formula !== 'string' || li.formula.trim().length === 0) continue;
      const formulaText = li.formula.length > 10_000 ? li.formula.slice(0, 10_000) : li.formula;

      for (const [refName, refId] of nameToId) {
        if (refId === mod.id) continue;
        if (referencedModules.has(refId)) continue;
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

  const wsId = workspaceId;
  const mId = modelId;

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

    // ── Stage 2: Wave 1 + Wave 2 in parallel ──────────────────────────────────
    // Wave 1 (required): modules + all line items with formulas.
    // Wave 2 (enrichment): lists, imports, exports, processes, versions — fires simultaneously,
    //   uses allSettled so individual failures never block the core analysis.
    sendEvent({ type: 'stage', stage: 'loading', label: 'Loading model intelligence…' });

    const authHeader = { 'Authorization': `AnaplanAuthToken ${token}` };

    const [
      [modRes, liRes],
      [listsResult, importsResult, exportsResult, processesResult, versionsResult],
    ] = await Promise.all([
      Promise.all([
        fetch(`https://api.anaplan.com/2/0/workspaces/${wsId}/models/${mId}/modules`, { headers: authHeader }),
        fetch(`https://api.anaplan.com/2/0/models/${mId}/lineItems?includeAll=true`, { headers: authHeader }),
      ]),
      Promise.allSettled([
        fetch(`https://api.anaplan.com/2/0/workspaces/${wsId}/models/${mId}/lists`, { headers: authHeader })
          .then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`https://api.anaplan.com/2/0/workspaces/${wsId}/models/${mId}/imports`, { headers: authHeader })
          .then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`https://api.anaplan.com/2/0/workspaces/${wsId}/models/${mId}/exports`, { headers: authHeader })
          .then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`https://api.anaplan.com/2/0/workspaces/${wsId}/models/${mId}/processes`, { headers: authHeader })
          .then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`https://api.anaplan.com/2/0/models/${mId}/versions`, { headers: authHeader })
          .then(r => r.ok ? r.json() : null).catch(() => null),
      ]),
    ]);

    if (!modRes.ok) {
      sendEvent({ type: 'error', message: `Failed to list modules: HTTP ${modRes.status}` });
      return;
    }
    if (!liRes.ok) {
      sendEvent({ type: 'error', message: `Failed to fetch line items: HTTP ${liRes.status}` });
      return;
    }

    const [modData, liData] = await Promise.all([modRes.json(), liRes.json()]);
    const modules = modData.modules || [];
    const allLineItems = liData.items || liData.lineItems || [];

    // Unpack enrichment — each may be null if Anaplan returned an error for that call
    const listsData     = listsResult.status     === 'fulfilled' ? listsResult.value     : null;
    const importsData   = importsResult.status   === 'fulfilled' ? importsResult.value   : null;
    const exportsData   = exportsResult.status   === 'fulfilled' ? exportsResult.value   : null;
    const processesData = processesResult.status === 'fulfilled' ? processesResult.value : null;
    const versionsData  = versionsResult.status  === 'fulfilled' ? versionsResult.value  : null;

    const enrichment = {
      lists:     (listsData?.lists     || listsData?.items     || []).map(l => ({ name: l.name, itemCount: l.itemCount ?? l.membersCount ?? 0 })),
      imports:   (importsData?.imports || importsData?.items   || []).map(i => ({ name: i.name })),
      exports:   (exportsData?.exports || exportsData?.items   || []).map(e => ({ name: e.name })),
      processes: (processesData?.processes || processesData?.items || []).map(p => ({ name: p.name })),
      versions:  (versionsData?.versions || versionsData?.items || []).map(v => ({ name: v.name })),
    };

    const domain = classifyModelDomain(enrichment.lists.map(l => l.name));

    safeLog('[model-state] fetch complete', {
      modules: modules.length,
      lineItems: allLineItems.length,
      lists: enrichment.lists.length,
      imports: enrichment.imports.length,
      exports: enrichment.exports.length,
      processes: enrichment.processes.length,
      versions: enrichment.versions.length,
      domain,
    });

    // Group line items by module — try name first, fall back to moduleId
    // Anaplan returns moduleName on the model-level lineItems endpoint; moduleId is the safe fallback
    const lisByModuleName = new Map();
    const lisByModuleId   = new Map();
    for (const li of allLineItems) {
      const modName = li.moduleName || li.module || '';
      const modId   = li.moduleId   || li.moduleID || '';
      if (modName) {
        if (!lisByModuleName.has(modName)) lisByModuleName.set(modName, []);
        lisByModuleName.get(modName).push(li);
      }
      if (modId) {
        if (!lisByModuleId.has(modId)) lisByModuleId.set(modId, []);
        lisByModuleId.get(modId).push(li);
      }
    }

    // Prefer name-keyed map; if it produced nothing, use id-keyed map
    const nameHits = modules.filter(m => lisByModuleName.get(m.name)?.length).length;
    const idHits   = modules.filter(m => lisByModuleId.get(m.id)?.length).length;
    const lisByModule = nameHits >= idHits ? lisByModuleName : lisByModuleId;
    const groupKey    = nameHits >= idHits ? (m) => m.name : (m) => m.id;
    console.log(`[model-state] lineItem grouping: nameHits=${nameHits} idHits=${idHits} using=${nameHits >= idHits ? 'name' : 'id'}`);

    const assembled = modules.map((mod) => ({
      id: mod.id,
      name: mod.name,
      lineItems: lisByModule.get(groupKey(mod)) || [],
    }));

    const fetchedModuleIds = new Set(assembled.map((m) => m.id));

    // ── Stage 3: Serialize + filter decorators + compute evidence pack ─────────
    sendEvent({ type: 'stage', stage: 'serializing', label: 'Serializing state…' });

    const functional = assembled.filter((m) => !isDecorativeModuleName(m.name));
    const decorators = assembled.filter((m) => isDecorativeModuleName(m.name));

    const stateText = serializeModelState(functional, enrichment);
    const evidencePack = computeEvidencePack(functional, fetchedModuleIds, modules.length);

    safeLog('[model-state] serialization complete', {
      functionalModules: functional.length,
      decoratorModules: decorators.length,
      stateBytes: stateText.length,
      lineItems: allLineItems.length,
      domain,
    });

    // ── Stage 4: Write to Blob ─────────────────────────────────────────────────
    sendEvent({ type: 'stage', stage: 'writing', label: 'Writing state…' });

    const blob = await put(`model-state/${mId}-${Date.now()}.txt`, stateText, {
      access: 'public',
      contentType: 'text/plain',
      allowOverwrite: true,
    });

    const lineItemCount = functional.reduce((s, m) => s + m.lineItems.length, 0);
    const formulaCount  = functional.reduce((s, m) =>
      s + m.lineItems.filter(li => typeof li.formula === 'string' && li.formula.trim().length > 0).length, 0);

    safeLog('[model-state] formula count', { formulaCount, lineItemCount, modulesWithFormulas: functional.filter(m => m.lineItems.some(li => typeof li.formula === 'string' && li.formula.trim().length > 0)).length });

    sendEvent({
      type: 'complete',
      stateUrl: blob.url,
      evidencePack,
      moduleCount: functional.length,
      excludedCount: decorators.length,
      lineItemCount,
      formulaCount,
      tokenEstimate: Math.round(stateText.length / 4),
      domain,
      enrichment: {
        lists: enrichment.lists.length,
        imports: enrichment.imports.length,
        exports: enrichment.exports.length,
        processes: enrichment.processes.length,
        versions: enrichment.versions.length,
      },
    });

  } catch (err) {
    console.error('model-state error:', err.message);
    sendEvent({ type: 'error', message: err.message });
  } finally {
    res.end();
  }
}
