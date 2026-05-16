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

// ─── Hard constraint: validate formulas against real Anaplan function whitelist ───
const VALID_FUNCTIONS = new Set([
  // Logic
  'IF', 'THEN', 'ELSE', 'AND', 'OR', 'NOT',
  // Aggregation
  'SUM', 'COLLECT', 'ALL', 'ANY',
  // Math
  'ABS', 'MAX', 'MIN', 'ROUND', 'POWER', 'MOD', 'LOG', 'EXP', 'SQRT', 'CEILING', 'INT',
  // Text
  'LEFT', 'RIGHT', 'MID', 'LEN', 'TRIM', 'UPPER', 'LOWER', 'FIND', 'SUBSTITUTE', 'TEXT', 'CODE', 'CHAR', 'VALUE',
  // Time
  'OFFSET', 'PREVIOUS', 'CUMULATE', 'YEARVALUE', 'MONTHVALUE', 'DAYVALUE',
  'CURRENTPERIODSTART', 'CURRENTPERIODEND', 'CURRENTPERIODLENGTH',
  'INPERIOD', 'HALFYEARVALUE', 'QUARTERVALUE', 'WEEKVALUE',
  'FIRSTNONBLANK', 'LASTNONBLANK', 'TEXTTODATE',
  // Lookup / list
  'LOOKUP', 'SELECT', 'ITEM', 'FINDITEM', 'PARENT', 'NAME', 'ISBLANK', 'ISNOTBLANK',
  // Boolean
  'TRUE', 'FALSE',
  // Anaplan specific
  'RANK', 'PROFILE', 'MAKELINK', 'ISFIRSTOCCURRENCE', 'ISANCESTOR',
  'POST', 'MOVINGSUM', 'MOVINGAVERAGE',
]);

// Known invalid functions that LLMs hallucinate
const INVALID_FUNCTIONS = new Set([
  'FORMAT', 'CONCATENATE', 'CONCAT', 'SUMIF', 'SUMIFS', 'COUNTIF', 'COUNTIFS',
  'AVERAGEIF', 'AVERAGEIFS', 'VLOOKUP', 'HLOOKUP', 'INDEX', 'MATCH',
  'IFERROR', 'IFNA', 'SWITCH', 'CHOOSE', 'INDIRECT', 'ADDRESS',
  'COUNTA', 'COUNTBLANK', 'LARGE', 'SMALL', 'PERCENTILE',
  'SUMPRODUCT', 'DATEDIF', 'EOMONTH', 'NETWORKDAYS', 'DATEVALUE',
  'NUMBERVALUE', 'PROPER', 'REPT', 'EXACT', 'SEARCH', 'REPLACE',
  'CLEAN', 'UNICHAR', 'UNICODE', 'DOLLAR', 'FIXED',
  'CEILING.MATH', 'FLOOR', 'FLOOR.MATH', 'TRUNC',
  'ARRAYFORMULA', 'FILTER', 'SORT', 'UNIQUE', 'TRANSPOSE',
  'LAMBDA', 'MAP', 'REDUCE', 'BYROW', 'BYCOL', 'LET',
]);

function validateFormulas(spec) {
  const warnings = [];
  if (!spec.modules) return { spec, warnings };

  for (const mod of spec.modules) {
    for (const li of (mod.lineItems || [])) {
      if (!li.formula || li.type !== 'CALC') continue;

      // Extract function-like tokens: WORD(
      const funcCalls = li.formula.match(/\b([A-Z_][A-Z_0-9]*)\s*\(/gi) || [];
      for (const call of funcCalls) {
        const funcName = call.replace(/\s*\($/, '').toUpperCase();
        if (INVALID_FUNCTIONS.has(funcName)) {
          warnings.push({
            module: mod.name,
            lineItem: li.name,
            issue: `Invalid function: ${funcName}() does not exist in Anaplan`,
            formula: li.formula,
          });
          // Mark the formula as needing review
          li.formula = `⚠ REVIEW: ${li.formula} [${funcName} is not a valid Anaplan function]`;
        }
      }
    }
  }

  return { spec, warnings };
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
    send({ type: 'status', text: 'Analyzing model structure...', phase: 1 });

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
3. INPUT type = user-entered (no formula). CALC type = formula-driven. ITEM type = list-formatted or date.
4. Specify appliesTo dimensions for every module
5. Consider connections to existing modules — how does new work integrate?
6. Build sequence must respect dependencies: Lists → DAT → INP → CAL → REP
7. Be thorough: include ALL line items needed, not just examples. This is an implementation spec.
8. Reuse existing lists where possible. Only create new lists if the dimension doesn't exist.

═══ ANAPLAN FORMULA RULES (CRITICAL) ═══

You MUST only use REAL Anaplan functions. Anaplan is NOT Excel. Many common functions DO NOT EXIST in Anaplan.

VALID Anaplan functions and syntax:
- Arithmetic: +, -, *, /
- Comparison: =, <>, <, >, <=, >=
- Logic: IF condition THEN value ELSE value, AND, OR, NOT
- Text: LEFT, RIGHT, MID, LEN, TRIM, UPPER, LOWER, FIND, SUBSTITUTE, TEXT (converts number to text), CODE, CHAR, VALUE
- Aggregation: SUM (within a module across dimensions), COLLECT
- Time: OFFSET(line_item, periods, 0), PREVIOUS(line_item), CUMULATE(line_item), YEARVALUE, MONTHVALUE, CURRENTPERIODSTART, CURRENTPERIODEND, INPERIOD
- Lookup: line_item[LOOKUP: mapping_line_item], line_item[SELECT: condition]
- List: ITEM(list), FINDITEM(list, text), PARENT(list), NAME(list_item), ISBLANK()
- Math: MAX, MIN, ABS, ROUND, POWER, MOD, LOG, EXP, SQRT
- Guarded division: IF denominator <> 0 THEN x / denominator ELSE 0 (ALWAYS use this pattern)
- Summary methods: SUM, NONE, ANY, ALL, MIN, MAX, AVERAGE, OPENING PERIOD, CLOSING PERIOD, FORMULA

INVALID — these DO NOT EXIST in Anaplan (never use them):
- FORMAT() — does not exist. Use TEXT() for number-to-text conversion
- CONCATENATE() — does not exist. Use & for text joining
- SUMIF/SUMIFS/COUNTIF — do not exist. Use SUM with SELECT: SUM(value[SELECT: condition])
- VLOOKUP/HLOOKUP/INDEX/MATCH — do not exist. Use LOOKUP syntax: source[LOOKUP: mapping]
- IFERROR — does not exist. Guard inputs manually
- SWITCH/CHOOSE — do not exist. Use nested IF or lookup tables
- RANK — does not exist
- String concatenation with numbers: must convert number to TEXT() first, then use &
- SUM(IF ...) as array formula — does not exist. Use line_item[SELECT: condition] pattern

FORMULA STYLE:
- Cross-module references: 'Module Name'.Line Item Name (single quotes around module name, period separator)
- SELECT syntax: Source.'Line Item'[SELECT: List.Boolean Flag = TRUE]
- LOOKUP syntax: Source.'Line Item'[LOOKUP: Mapping Line Item]
- Avoid nested IF deeper than 3 levels — use a lookup table instead
- Max 2 LOOKUPs per formula — create intermediate line items for more`,
    ];

    if (modelContext) {
      systemParts.push('', '═══ EXISTING MODEL ═══', modelContext);
    }

    // Extract real formula examples from existing model for pattern-matching
    if (existingModules.length) {
      const formulaExamples = [];
      for (const m of existingModules) {
        for (const li of (m.lineItems || [])) {
          if (li.formula && li.formula.length > 10 && li.formula.length < 200) {
            formulaExamples.push(`${m.name}.${li.name} = ${li.formula}`);
            if (formulaExamples.length >= 20) break;
          }
        }
        if (formulaExamples.length >= 20) break;
      }
      if (formulaExamples.length) {
        systemParts.push('', '═══ REAL FORMULA EXAMPLES FROM THIS MODEL (copy this syntax style) ═══', formulaExamples.join('\n'));
      }
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

    // Stream response with progress tracking
    let fullText = '';
    let phasesSent = new Set();
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

        // Send progress updates based on detected JSON sections
        if (!phasesSent.has('lists') && fullText.includes('"lists"')) {
          phasesSent.add('lists');
          send({ type: 'status', text: 'Designing list dimensions...', phase: 2 });
        }
        if (!phasesSent.has('modules') && fullText.includes('"modules"')) {
          phasesSent.add('modules');
          send({ type: 'status', text: 'Architecting modules and line items...', phase: 3 });
        }
        if (!phasesSent.has('lineItems') && fullText.includes('"lineItems"')) {
          phasesSent.add('lineItems');
          send({ type: 'status', text: 'Writing formulas...', phase: 4 });
        }
        if (!phasesSent.has('buildSequence') && fullText.includes('"buildSequence"')) {
          phasesSent.add('buildSequence');
          send({ type: 'status', text: 'Determining build order...', phase: 5 });
        }
        if (!phasesSent.has('connections') && fullText.includes('"connections"')) {
          phasesSent.add('connections');
          send({ type: 'status', text: 'Mapping integration points...', phase: 6 });
        }
      }
    }

    // Parse the final JSON, validate formulas, send structured result
    try {
      let jsonText = fullText.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
      }
      const rawSpec = JSON.parse(jsonText);

      // Hard constraint: validate all formulas against Anaplan function whitelist
      const { spec, warnings } = validateFormulas(rawSpec);

      if (warnings.length) {
        send({ type: 'formula-warnings', warnings });
      }

      send({ type: 'spec', data: spec });
    } catch (e) {
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
