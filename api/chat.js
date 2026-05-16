// ─── Meridian Chat API ─────────────────────────────────────────────────────
// Model-grounded conversational endpoint. SSE streaming.
// Fetches actual model data (formulas, line items) from blob for deep answers.

import { readFileSync } from 'fs';
import { join } from 'path';

// Load framework knowledge at cold start
const FRAMEWORK_DIR = join(process.cwd(), 'framework');
let FRAMEWORK_KNOWLEDGE = '';
try {
  const files = ['disco-naming.md', 'module-design.md', 'architecture-patterns.md', 'formula-library.md', 'build-sequences.md'];
  FRAMEWORK_KNOWLEDGE = files.map(f => {
    try { return readFileSync(join(FRAMEWORK_DIR, f), 'utf-8'); } catch { return ''; }
  }).filter(Boolean).join('\n\n---\n\n');
} catch (e) {
  console.error('[chat] Failed to load framework:', e.message);
}

// Parse the TSV blob format back into structured modules + lists
function parseBlobTSV(text) {
  const lines = text.split('\n');
  const modules = [];
  const lists = [];
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
    }
  }
  return { modules: modules.length ? modules : null, lists };
}

// Mode detection: comprehension vs build
function detectMode(message) {
  const lower = message.toLowerCase();
  const buildSignals = ['build', 'create', 'design', 'spec', 'add a module', 'new module', 'implement', 'how would i build', 'help me plan', 'generate a'];
  const comprehendSignals = ['explain', 'what does', 'why does', 'how does', 'what is', 'describe', 'show me', 'tell me about', 'what are the', 'analyze'];

  const buildScore = buildSignals.filter(s => lower.includes(s)).length;
  const compScore = comprehendSignals.filter(s => lower.includes(s)).length;

  if (buildScore > compScore) return 'build';
  return 'comprehension';
}

// Extract relevant modules with dependency expansion
function extractRelevantModules(modules, message, maxModules = 12) {
  if (!modules || !modules.length) return [];
  const lower = message.toLowerCase();
  const words = lower.split(/\s+/).filter(w => w.length > 2);

  // Build name→module lookup
  const byName = new Map(modules.map(m => [m.name, m]));

  // Score each module by relevance to the question
  const scored = modules.map(mod => {
    const name = (mod.name || '').toLowerCase();
    let score = 0;

    for (const w of words) {
      if (name.includes(w)) score += 10;
    }

    const prefix = name.split(/\s*[-–]\s*/)[0]?.trim();
    if (prefix && lower.includes(prefix.toLowerCase())) score += 15;

    if (mod.lineItems) {
      for (const li of mod.lineItems) {
        const liName = (li.name || '').toLowerCase();
        for (const w of words) {
          if (liName.includes(w)) { score += 3; break; }
        }
      }
    }

    return { mod, score };
  });

  // Get direct matches
  const direct = scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(s => s.mod);

  // Dependency expansion: find modules referenced in formulas of direct matches
  const expanded = new Set(direct.map(m => m.name));
  for (const mod of direct) {
    for (const li of (mod.lineItems || [])) {
      if (!li.formula) continue;
      // Find 'ModuleName'.LineItem references
      const refs = li.formula.match(/'[^']+'/g) || [];
      for (const ref of refs) {
        const refName = ref.slice(1, -1); // strip quotes
        if (byName.has(refName) && !expanded.has(refName)) {
          expanded.add(refName);
        }
      }
    }
  }

  // Collect all: direct + referenced, up to max
  const result = [];
  for (const mod of direct) result.push(mod);
  for (const name of expanded) {
    if (result.length >= maxModules) break;
    const mod = byName.get(name);
    if (mod && !direct.includes(mod)) result.push(mod);
  }

  return result;
}

// Compute module dependency map for context
function buildDependencyContext(modules) {
  const names = new Set(modules.map(m => m.name));
  const deps = [];

  for (const mod of modules) {
    const refs = new Set();
    for (const li of (mod.lineItems || [])) {
      if (!li.formula) continue;
      const matches = li.formula.match(/'[^']+'/g) || [];
      for (const m of matches) {
        const refName = m.slice(1, -1);
        if (names.has(refName) && refName !== mod.name) refs.add(refName);
      }
    }
    if (refs.size) {
      deps.push(`${mod.name} → reads from: ${[...refs].join(', ')}`);
    }
  }
  return deps.length ? deps.join('\n') : '';
}

// Format module grouped by data flow: inputs → calculations → outputs
function formatModuleForContext(mod) {
  const lines = [];
  lines.push(`\n## ${mod.name}`);
  if (!mod.lineItems || !mod.lineItems.length) return lines.join('\n');

  const dims = mod.lineItems[0]?.appliesTo;
  if (dims && dims.length) lines.push(`Dimensions: ${dims.join(' × ')}`);

  const inputs = mod.lineItems.filter(li => li.type === 'INPUT');
  const calcs = mod.lineItems.filter(li => li.type === 'CALC');
  const items = mod.lineItems.filter(li => li.type === 'ITEM');

  if (inputs.length) {
    lines.push(`\nInputs (user-entered):`);
    for (const li of inputs) {
      lines.push(`  - ${li.name} [${li.format || '?'}]`);
    }
  }

  if (calcs.length) {
    lines.push(`\nCalculations:`);
    for (const li of calcs) {
      let entry = `  - ${li.name} [${li.format || '?'}]`;
      if (li.formula) entry += `\n    = ${li.formula}`;
      lines.push(entry);
    }
  }

  if (items.length) {
    lines.push(`\nOther line items:`);
    for (const li of items) {
      lines.push(`  - ${li.name} [${li.format || '?'}]`);
    }
  }

  return lines.join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { message, history, modelState, stateUrl } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message required' });
  }

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  function send(data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();

    const mode = detectMode(message);
    send({ type: 'mode', mode });

    // ─── Fetch actual model data from blob (TSV format) ─────────────────────
    let fullModules = null;
    let modelLists = [];
    if (stateUrl) {
      try {
        const blobResp = await fetch(stateUrl);
        if (blobResp.ok) {
          const blobText = await blobResp.text();
          const parsed = parseBlobTSV(blobText);
          fullModules = parsed.modules;
          modelLists = parsed.lists || [];
        }
      } catch (e) {
        console.error('[chat] Failed to fetch state blob:', e.message);
      }
    }

    // ─── Build deep model context ──────────────────────────────────────────
    let modelContext = '';
    const parts = [];

    if (modelState) {
      if (modelState.modelName) parts.push(`Model: ${modelState.modelName}`);
      if (modelState.domain) parts.push(`Domain: ${modelState.domain}`);
      if (modelState.moduleCount) parts.push(`Modules: ${modelState.moduleCount}`);
      if (modelState.healthScore) parts.push(`Health Score: ${modelState.healthScore}/100`);
    }

    // If we have full module data, extract relevant ones with formulas
    if (fullModules && fullModules.length) {
      const relevant = extractRelevantModules(fullModules, message);

      // List context — what dimensions exist
      if (modelLists.length) {
        const listDesc = modelLists.map(l => l.parent ? `${l.name} (child of ${l.parent})` : l.name).join(', ');
        parts.push(`\nDimensions/Lists: ${listDesc}`);
      }

      // Dependency map — how modules connect
      if (relevant.length) {
        const depMap = buildDependencyContext(relevant);
        if (depMap) {
          parts.push('\n═══ DATA FLOW ═══');
          parts.push(depMap);
        }

        parts.push('\n═══ MODULE DETAILS ═══');
        for (const mod of relevant) {
          parts.push(formatModuleForContext(mod));
        }
      }

      // Full module name list for reference
      const allNames = fullModules.map(m => m.name).join(', ');
      parts.push(`\n═══ ALL MODULES IN MODEL ═══\n${allNames}`);
    } else if (modelState && modelState.modules) {
      // Fallback: just names and counts
      const modList = modelState.modules.slice(0, 50).map(m => {
        const li = m.lineItemCount || 0;
        return `  ${m.name} (${li} items${m.formulaCount ? ', ' + m.formulaCount + ' formulas' : ''})`;
      }).join('\n');
      parts.push(`\nModule List:\n${modList}`);
    }

    // Include findings
    if (modelState && modelState.findings && modelState.findings.length) {
      const top = modelState.findings.slice(0, 10).map(f =>
        `  [${f.severity}] ${f.moduleName}: ${f.title || f.ruleId}`
      ).join('\n');
      parts.push(`\nTop Findings:\n${top}`);
    }

    // Include workstreams
    if (modelState && modelState.workstreams && modelState.workstreams.length) {
      const ws = modelState.workstreams.slice(0, 5).map(w =>
        `  [${w.priority}] ${w.title}: ${w.problem || ''}`
      ).join('\n');
      parts.push(`\nWorkstreams:\n${ws}`);
    }

    modelContext = parts.join('\n');

    // ─── Build system prompt ───────────────────────────────────────────────
    const systemParts = [
      'You are Meridian, an Anaplan model expert. You explain how this model works in plain business language.',
      '',
      'HOW TO ANSWER:',
      '- Lead with PLAIN ENGLISH explanation of the business logic. Describe what happens, why, and in what order — as if explaining to a business stakeholder.',
      '- Structure as: business purpose → decision logic → data flow. NOT as a list of formulas.',
      '- Use formulas only as SUPPORTING EVIDENCE cited inline (e.g. "the system checks if a slot has an order assigned, and if so marks it allocated"). Put the formula in a code block after the explanation, not instead of it.',
      '- Explain cause and effect: "When X happens, the model does Y because Z".',
      '- Use analogies and plain language for complex logic. "Think of it as..." is fine.',
      '',
      'STRICT RULES:',
      '- Answer ONLY what the user asked. No unsolicited observations or improvement suggestions.',
      '- Never dump a wall of formulas. If you catch yourself listing more than 2 formulas in a row without plain English between them, stop and restructure.',
      '- For "explain" questions: narrate the logic like a story. The formulas are footnotes, not the story.',
      '- For "how does X work" questions: describe the process end-to-end in business terms first, then show key formulas as proof.',
      '- If the model data doesn\'t contain enough detail to answer, say exactly what\'s missing.',
      '- No preamble. No "here\'s what I found". Start with the answer.',
      '',
      'EXAMPLE OF A GOOD ANSWER:',
      'Q: "How does the model calculate slot availability?"',
      'A: "Each production slot has three possible states: allocated (assigned to a firm order), reserved (held for an opportunity), or available (open for new demand).',
      '',
      'The model determines state by checking assignments in priority order — if a slot has an Order linked, it\'s allocated. If it has an Opportunity but no Order, it\'s reserved. Otherwise it\'s available for scheduling.',
      '',
      '```',
      'Allocated nr = IF ISNOTBLANK(Order) THEN 1 ELSE 0',
      'Reserved nr = IF ISNOTBLANK(Opportunity) THEN 1 ELSE 0',
      'Available = IF Not Allocated AND Not Reserved THEN 1 ELSE 0',
      '```',
      '',
      'This three-state system means the planning team can see at a glance how much capacity is committed vs. tentative vs. open."',
      '',
      'EXAMPLE OF A BAD ANSWER (never do this):',
      '"Here are the formulas in SLP05: Allocated nr = IF ISNOTBLANK(Order) THEN 1 ELSE 0. Reserved nr = IF ISNOTBLANK(Opportunity)..."',
      '(This just lists formulas without explaining the business meaning.)',
    ];

    if (modelContext) {
      systemParts.push('', modelContext);
    }

    if (mode === 'build' && FRAMEWORK_KNOWLEDGE) {
      systemParts.push('', '═══ ANAPLAN FRAMEWORK KNOWLEDGE ═══', FRAMEWORK_KNOWLEDGE.slice(0, 12000));
    } else if (mode === 'comprehension' && FRAMEWORK_KNOWLEDGE) {
      systemParts.push('', '═══ REFERENCE (use to explain patterns) ═══', FRAMEWORK_KNOWLEDGE.slice(0, 4000));
    }

    const system = systemParts.join('\n');

    // ─── Build messages array from history ─────────────────────────────────
    const messages = [];
    if (Array.isArray(history)) {
      for (const h of history.slice(-10)) {
        if (h.role === 'user' || h.role === 'assistant') {
          messages.push({ role: h.role, content: h.content });
        }
      }
    }
    messages.push({ role: 'user', content: message });

    // ─── Stream response ───────────────────────────────────────────────────
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-6-20250514',
      max_tokens: 3000,
      system,
      messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        send({ type: 'delta', text: event.delta.text });
      }
    }

    send({ type: 'done', mode });
    res.end();

  } catch (err) {
    console.error('[chat] Error:', err.message);
    send({ type: 'error', message: err.message || 'Chat failed' });
    res.end();
  }
}
