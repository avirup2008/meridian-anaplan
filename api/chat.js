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

// Extract relevant modules from the full model state based on the user's question
function extractRelevantModules(modules, message, maxModules = 8) {
  if (!modules || !modules.length) return [];
  const lower = message.toLowerCase();
  const words = lower.split(/\s+/).filter(w => w.length > 2);

  // Score each module by relevance to the question
  const scored = modules.map(mod => {
    const name = (mod.name || '').toLowerCase();
    let score = 0;

    // Direct name match
    for (const w of words) {
      if (name.includes(w)) score += 10;
    }

    // Prefix match (e.g. "SLP" for slot planning)
    const prefix = name.split(/\s*[-–]\s*/)[0]?.trim();
    if (prefix && lower.includes(prefix.toLowerCase())) score += 15;

    // Line item name matches
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

  // Return top N with score > 0, sorted by relevance
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxModules)
    .map(s => s.mod);
}

// Compact module representation with formulas
function formatModuleForContext(mod) {
  const lines = [];
  lines.push(`\n## ${mod.name}`);
  if (mod.lineItems && mod.lineItems.length) {
    lines.push(`Line items (${mod.lineItems.length}):`);
    for (const li of mod.lineItems) {
      let entry = `  - ${li.name}`;
      if (li.format) entry += ` [${li.format}]`;
      if (li.summary && li.summary !== 'None') entry += ` (summary: ${li.summary})`;
      if (li.formula) entry += `\n    Formula: ${li.formula}`;
      if (li.appliesTo && li.appliesTo.length) entry += `\n    Dimensions: ${li.appliesTo.join(', ')}`;
      lines.push(entry);
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

    // ─── Fetch actual model data from blob ─────────────────────────────────
    let fullModules = null;
    if (stateUrl) {
      try {
        const blobResp = await fetch(stateUrl);
        if (blobResp.ok) {
          const blobData = await blobResp.json();
          fullModules = blobData.modules || null;
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
      if (relevant.length) {
        parts.push('\n═══ RELEVANT MODULES (with formulas) ═══');
        for (const mod of relevant) {
          parts.push(formatModuleForContext(mod));
        }
      }

      // Also include a full module name list for reference
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
      'You are Meridian, an Anaplan model expert. You answer questions about this specific model using the actual data provided.',
      '',
      'STRICT RULES:',
      '- Answer ONLY what the user asked. Do not volunteer unsolicited observations, architecture issues, or improvement suggestions.',
      '- Ground every answer in the ACTUAL model data. Quote exact formula text, line item names, and dimensions verbatim.',
      '- For "explain" questions: trace the business logic step by step through the actual formulas. Explain WHAT the formula computes in business terms.',
      '- For "how does X work" questions: show the data flow — which line items feed which, what dimensions apply, what the formula produces.',
      '- For build questions: propose specs that account for what already exists in the model.',
      '- Never describe module names or counts as an answer. The user wants to understand the LOGIC.',
      '- If the model data doesn\'t contain enough detail to answer, say exactly what\'s missing. Do not speculate.',
      '- Be concise. No preamble, no summaries, no "here\'s what I found" framing.',
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
      model: 'claude-sonnet-4-20250514',
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
