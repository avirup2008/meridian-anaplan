import { applyCors } from './_cors.js';
import { isAllowedBlobUrl } from './analyze.js';
import {
  countIfDepth,
  hasSumLookup,
  hasHardcodedSelect,
  hasUnguardedDivision,
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

    sendEvent({ type: 'stage', stage: 'graph', label: 'Building dependency graph…' });

    // Plans 02 and 03 will fill in the analysis calls here
    // (buildDependencyGraph, scanDeterministicFindings, etc.)

    const lineItemCount = normalized.modules.reduce((s, m) => s + m.lineItemCount, 0);
    sendEvent({
      type: 'complete',
      version: 'v3',
      moduleCount: modules.length,
      lineItemCount,
      evidencePack: evidencePack ? true : null, // signal to caller that pack was received
    });
  } catch (err) {
    console.error('analyze-v3 error:', err.message);
    sendEvent({ type: 'error', message: err.message });
  } finally {
    res.end();
  }
}
