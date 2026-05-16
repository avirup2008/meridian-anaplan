// ─── Meridian Build API ─────────────────────────────────────────────────────
// Generates structured Anaplan build specifications from freeform descriptions.
// SSE streaming with structured JSON events for progressive UI rendering.

import { readFileSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';

export const config = { maxDuration: 60 };

// Load framework knowledge at cold start
const FRAMEWORK_DIR = join(process.cwd(), 'framework');
let FRAMEWORK_KNOWLEDGE = '';
try {
  const files = ['disco-naming.md', 'module-design.md', 'architecture-patterns.md', 'formula-library.md', 'build-sequences.md'];
  FRAMEWORK_KNOWLEDGE = files.map(f => {
    try { return readFileSync(join(FRAMEWORK_DIR, f), 'utf-8'); } catch { return ''; }
  }).filter(Boolean).join('\n\n---\n\n');
} catch (e) {
  console.error('[build] Failed to load framework:', e.message);
}

// Parse the TSV blob format
function parseBlobTSV(text) {
  const lines = text.split('\n');
  const modules = [];
  const lists = [];
  const listMembers = new Map();
  let current = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    const type = cols[0];

    if (type === 'MODULE') {
      current = { id: cols[1], name: cols[2], prefix: cols[3] || '', lineItems: [] };
      modules.push(current);
    } else if ((type === 'CALC' || type === 'INPUT' || type === 'ITEM') && current) {
      const li = { name: cols[1] || '', format: cols[2] || '', summary: cols[3] || '', type };
      if (cols[4]) li.appliesTo = cols[4].split('|').filter(Boolean);
      if (type === 'CALC' && cols[5]) li.formula = cols[5];
      current.lineItems.push(li);
    } else if (type === 'LIST') {
      lists.push({ name: cols[1] || '', parent: cols[2] || '' });
    } else if (type === 'LISTMEMBERS') {
      const listName = cols[1] || '';
      const members = (cols[2] || '').split('|').filter(Boolean);
      if (listName && members.length) listMembers.set(listName, members);
    }
  }
  return { modules, lists, listMembers };
}

// Build existing model summary for context
function buildExistingModelContext(modules, lists, listMembers) {
  const parts = [];

  if (lists.length) {
    parts.push('EXISTING LISTS:');
    for (const l of lists) {
      const members = listMembers.get(l.name);
      const memberStr = members ? ` (${members.length} members: ${members.slice(0, 8).join(', ')}${members.length > 8 ? '...' : ''})` : '';
      parts.push(`  ${l.name}${l.parent ? ' [parent: ' + l.parent + ']' : ''}${memberStr}`);
    }
  }

  if (modules.length) {
    parts.push('', 'EXISTING MODULES (' + modules.length + ' total):');
    // Group by prefix
    const byPrefix = {};
    for (const m of modules) {
      const p = m.prefix || 'OTHER';
      if (!byPrefix[p]) byPrefix[p] = [];
      byPrefix[p].push(m);
    }
    for (const [prefix, mods] of Object.entries(byPrefix)) {
      parts.push(`  [${prefix}] ${mods.length} modules: ${mods.slice(0, 10).map(m => m.name).join(', ')}${mods.length > 10 ? '...' : ''}`);
    }

    // Show relevant modules with their line items (just names for space)
    parts.push('', 'MODULE DETAILS (first 30):');
    for (const m of modules.slice(0, 30)) {
      const liNames = m.lineItems.map(li => li.name).join(', ');
      parts.push(`  ${m.name}: ${liNames.slice(0, 200)}${liNames.length > 200 ? '...' : ''}`);
    }
  }

  return parts.join('\n');
}

// Determine next available DISCO numbers for each prefix
function getNextNumbers(modules) {
  const maxNums = { DAT: 0, INP: 0, CAL: 0, REP: 0, SYS: 0 };
  for (const m of modules) {
    const match = m.name.match(/^(DAT|INP|CAL|REP|SYS)(\d+)/i);
    if (match) {
      const prefix = match[1].toUpperCase();
      const num = parseInt(match[2], 10);
      if (num > (maxNums[prefix] || 0)) maxNums[prefix] = num;
    }
  }
  return maxNums;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { message, history, stateUrl } = req.body || {};
  if (!message) return res.status(400).json({ error: 'No message provided' });

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const client = new Anthropic();

    // Fetch model state from blob
    let modelContext = '';
    let existingModules = [];
    let existingLists = [];
    if (stateUrl) {
      try {
        send({ type: 'status', text: 'Loading model context...' });
        const blobResp = await fetch(stateUrl);
        if (blobResp.ok) {
          const text = await blobResp.text();
          const parsed = parseBlobTSV(text);
          if (parsed.modules && parsed.modules.length) {
            existingModules = parsed.modules;
            existingLists = parsed.lists || [];
            modelContext = buildExistingModelContext(parsed.modules, parsed.lists || [], parsed.listMembers);
          }
        }
      } catch (e) {
        console.error('[build] Blob fetch error:', e.message);
      }
    }

    const nextNums = getNextNumbers(existingModules);
    send({ type: 'status', text: 'Generating build specification...' });

    // Build system prompt
    const systemParts = [
      `You are Meridian's Build Architect — a senior Anaplan solution architect who generates complete, implementation-ready build specifications.

You have deep knowledge of Anaplan best practices: DISCO naming, module design patterns, formula optimization, and build sequences.

The user describes what they want to add or change in their existing Anaplan model. You generate a COMPLETE build specification as a single JSON object.

═══ OUTPUT FORMAT ═══

Respond with ONLY a valid JSON object (no markdown, no backticks, no explanation). The JSON must have this exact structure:

{
  "title": "Short title for this build spec",
  "summary": "1-2 sentence description of what this builds",
  "lists": [
    { "name": "ListName", "parent": "", "estimatedMembers": 50, "source": "Import / Manual", "notes": "purpose" }
  ],
  "modules": [
    {
      "name": "CAL07 HC Cost Calculation",
      "prefix": "CAL",
      "number": 7,
      "purpose": "Calculate fully loaded headcount costs",
      "appliesTo": ["Position", "Time"],
      "lineItems": [
        { "name": "Monthly Salary", "format": "NUMBER", "summary": "SUM", "formula": "'DAT04 HC Data Hub'.Base Salary / 12", "type": "CALC" },
        { "name": "Benefits Rate", "format": "%", "summary": "NONE", "formula": "", "type": "INPUT" }
      ]
    }
  ],
  "buildSequence": ["List: Department", "List: Position", "DAT04", "INP04", "CAL07", "CAL08", "REP04"],
  "connections": [
    { "from": "REP04 HC Summary", "to": "CAL03 Expense Allocation", "via": "Total HC Cost → Personnel line", "direction": "outbound" }
  ],
  "notes": "Any important implementation notes or caveats"
}

═══ RULES ═══

1. Use DISCO naming: SYS (system), DAT (data/import), INP (user input), CAL (calculation), REP (reporting)
2. Number modules continuing from what exists. Next available numbers: DAT=${nextNums.DAT + 1}, INP=${nextNums.INP + 1}, CAL=${nextNums.CAL + 1}, REP=${nextNums.REP + 1}, SYS=${nextNums.SYS + 1}
3. Every formula must use Anaplan syntax: IF/THEN/ELSE, LOOKUP, SUM, OFFSET, PREVIOUS, etc.
4. Guard all divisions: IF denominator <> 0 THEN x / denominator ELSE 0
5. Use appropriate summary methods: NONE for rates/%, SUM for additive values, NONE for calculated items
6. INPUT type = user-entered (no formula). CALC type = formula-driven. ITEM type = list-formatted or date.
7. Specify appliesTo dimensions for every module
8. Consider connections to existing modules — how does new work integrate?
9. Build sequence must respect dependencies: Lists → DAT → INP → CAL → REP
10. Be thorough: include ALL line items needed, not just examples. This is an implementation spec.
11. Reuse existing lists where possible. Only create new lists if the dimension doesn't exist.`,
    ];

    if (modelContext) {
      systemParts.push('', '═══ EXISTING MODEL ═══', modelContext);
    }

    if (FRAMEWORK_KNOWLEDGE) {
      systemParts.push('', '═══ ANAPLAN FRAMEWORK REFERENCE ═══', FRAMEWORK_KNOWLEDGE.slice(0, 10000));
    }

    const system = systemParts.join('\n');

    // Build messages
    const messages = [];
    if (Array.isArray(history)) {
      for (const h of history.slice(-6)) {
        if (h.role === 'user' || h.role === 'assistant') {
          messages.push({ role: h.role, content: h.content });
        }
      }
    }
    messages.push({ role: 'user', content: message });

    // Stream response
    let fullText = '';
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system,
      messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        fullText += event.delta.text;
        send({ type: 'delta', text: event.delta.text });
      }
    }

    // Parse the final JSON and send structured result
    try {
      // Strip any markdown backticks if model included them
      let jsonText = fullText.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
      }
      const spec = JSON.parse(jsonText);
      send({ type: 'spec', data: spec });
    } catch (e) {
      // If JSON parse fails, send raw text as fallback
      send({ type: 'spec-raw', text: fullText });
    }

    send({ type: 'done' });
    res.end();

  } catch (err) {
    console.error('[build] Error:', err);
    send({ type: 'error', message: err.message || 'Build generation failed' });
    res.end();
  }
}
