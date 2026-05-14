import Anthropic from '@anthropic-ai/sdk';
import { put, list, del } from '@vercel/blob';
import { createHash } from 'crypto';
import { applyCors } from './_cors.js';
import {
  buildAnalysisSnapshot,
  normalizeBlueprint,
  validateAiSuggestions,
} from './analysis-core.js';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const SONNET_MODEL = 'claude-sonnet-4-6';
const TOTAL_BUDGET_MS = 52_000;    // guard before Vercel 60s hard kill
const MAX_HAIKU_ISSUES = 60;       // raised: 228-module models need more headroom
const FORMULA_MAX_CHARS = 200;     // allow longer formula previews
const FORMULA_MAX_PER_MODULE = 12; // show more calculated line items per module
const INPUT_MAX_PER_MODULE = 25;   // max input line items shown per module
const MAX_INPUT_TOKENS = 180_000;
const ENABLE_AI_ANALYSIS = process.env.MERIDIAN_ENABLE_AI_ANALYSIS === '1';

// Caching
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CACHE_PREFIX = 'analysis-cache-v19/'; // v19: separator filtering and calibrated intelligence scoring

// CA-04: Hash only stable fields — exclude fetchedAt which changes on every blueprint fetch
export function blueprintHash(blueprint) {
  const stableKey = { modelId: blueprint.modelId, modules: blueprint.modules };
  return createHash('sha256')
    .update(JSON.stringify(stableKey))
    .digest('hex')
    .slice(0, 24);
}

// SEC-01: Only allow Vercel Blob domains to prevent SSRF.
// Vercel Blob URLs are prefixed with a store-specific subdomain:
// e.g. https://<store-id>.public.blob.vercel-storage.com/<path>
export function isAllowedBlobUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (
      u.hostname.endsWith('.public.blob.vercel-storage.com') ||
      u.hostname.endsWith('.blob.vercel-storage.com')
    );
  } catch {
    return false;
  }
}

async function getCachedEvents(hash) {
  try {
    const { blobs } = await list({ prefix: `${CACHE_PREFIX}${hash}` });
    if (!blobs.length) return null;
    const blob = blobs[0];
    // CA-03: Delete stale blobs rather than silently skipping — prevents storage accumulation
    if (Date.now() - new Date(blob.uploadedAt).getTime() > CACHE_TTL_MS) {
      del(blob.url).catch(e => console.error('Stale blob delete failed (non-fatal):', e.message));
      return null;
    }
    const resp = await fetch(blob.url);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function setCachedEvents(hash, events) {
  try {
    await put(
      `${CACHE_PREFIX}${hash}.json`,
      JSON.stringify(events),
      { access: 'public', addRandomSuffix: false, allowOverwrite: true }
    );
  } catch (e) {
    console.error('Cache write failed (non-fatal):', e.message);
  }
}

// ANLZ-03: Extraction pre-pass — strips banned fields, reduces appliesTo to dimensions[]
export function extractionPrePass(blueprint) {
  return normalizeBlueprint(blueprint).modules.map(mod => ({
    moduleId: mod.id,
    moduleName: mod.name,
    lineItemCount: mod.lineItemCount,
    lineItems: mod.lineItems.map(li => ({
      id: li.id,
      name: li.name,
      formula: li.formula || null,
      format: li.formatType || null,
      summary: li.summaryMethod || null,
      dimensions: li.dimensions,
      notes: li.notes || null,
      formulaLength: li.formulaLength,
      ifDepth: li.ifDepth,
    })),
  }));
}

// Strip markdown fences and JSON.parse; return null on failure
export function parseJsonStrict(text) {
  const cleaned = String(text || '').replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

export async function guardTokens(client, model, messages, system = null) {
  const result = await client.messages.countTokens({
    model,
    messages,
    ...(system ? { system } : {}),
  });
  const inputTokens = result?.input_tokens ?? 0;
  if (inputTokens > MAX_INPUT_TOKENS) {
    throw new Error(`Prompt exceeds token budget: ${inputTokens} > ${MAX_INPUT_TOKENS}`);
  }
  return inputTokens;
}

// ANLZ-02: Single bulk Haiku call — all modules in one compact prompt, full reasoning
function buildHaikuBulkPrompt(extractions) {
  const moduleLines = extractions.map(m => {
    const calc = m.lineItems.filter(li => li.formula);
    const inp  = m.lineItems.filter(li => !li.formula);

    // Collect all unique dimensions across all line items in the module
    const allDims = [...new Set(m.lineItems.flatMap(li => li.dimensions || []))];
    const dimStr = allDims.length ? allDims.join(', ') : 'none';

    const header = `[${m.moduleId}] ${m.moduleName} (${m.lineItemCount} items: ${calc.length} calc, ${inp.length} input | dims: ${dimStr})`;

    // Input line items: name + format + summary — critical for detecting naming violations
    // and wrong summary methods (e.g. percentage with SUM). Previously invisible to the AI.
    const inputLines = inp.slice(0, INPUT_MAX_PER_MODULE).map(li => {
      const fmt = li.format || '?';
      const sum = li.summary || '?';
      return `  INPUT: ${li.name} [${fmt}/${sum}]`;
    });
    if (inp.length > INPUT_MAX_PER_MODULE) {
      inputLines.push(`  INPUT: … +${inp.length - INPUT_MAX_PER_MODULE} more`);
    }

    // Calculated line items: name + format + summary + formula
    const formulaLines = calc.slice(0, FORMULA_MAX_PER_MODULE).map(li => {
      const f = li.formula.length > FORMULA_MAX_CHARS
        ? li.formula.slice(0, FORMULA_MAX_CHARS) + '…'
        : li.formula;
      const fmt = li.format || '?';
      const sum = li.summary || '?';
      return `  CALC: ${li.name} [${fmt}/${sum}] = ${f}`;
    });
    if (calc.length > FORMULA_MAX_PER_MODULE) {
      formulaLines.push(`  CALC: … +${calc.length - FORMULA_MAX_PER_MODULE} more`);
    }

    const lines = [...inputLines, ...formulaLines];
    return lines.length ? header + '\n' + lines.join('\n') : header;
  }).join('\n');

  return `You are a senior Anaplan certified model builder. Review the modules below against the Anaplan Way rules listed here and flag genuine violations only.

=== ANAPLAN WAY REFERENCE ===

PLATFORM RULES
- Engine: Polaris (NOT Classic). No circular references, no PREVIOUS() across versions.
- Maximum 6 dimensions per module (hard Anaplan limit) — flag any module that appears to exceed this
- 60-character limit on all module/list/line item names — flag names that are clearly too long
- Formula length: keep under 120 characters per PLANS methodology; decompose into intermediate line items if longer
- Time functions: use CURRENTPERIODSTART(), CURRENTPERIODEND() — never hardcode period names
- Version handling: ISACTUALVERSION() is dynamic to version switchover; CURRENTPERIOD() is model-wide — never confuse them
- Text line items: avoid unless truly needed (consume significantly more memory than numbers)

MODULE NAMING — correct pattern is: XXX## Description (code + 2-digit number + space + name)
Valid prefix codes: SYS (System Settings), DAT (Data Hub), CAP (Capture/Pipeline),
TRK (Track/Project), PLN (Plan/Resource), PRC (Procure), MFG (Make/Manufacturing),
FIN (Financial), SOP (S&OP), KPI (KPI Reporting), IBP (Integrated Business Planning), SCN (Scenarios)
Flag: module names missing the XXX## prefix entirely, or using wrong/invented codes.
Do NOT flag: modules that follow the pattern even if you don't recognise the functional area.

LIST NAMING
- Flat list: Plural noun (e.g. "Projects", "Resources")
- Numbered list: # prefix (e.g. "#BOM Items", "#Milestones")
- Subset: "sub ListName: Description"
Flag: lists that don't follow these conventions.

LINE ITEM NAMING
Boolean line items must start with a verb: "Is Active", "Has BOM", "Can Ship"
Flag: booleans named without verb prefix; vague names like "Number 1", "Test", "Temp", "Copy of"

DISCO CLASSIFICATION RULES (Data / Input / System / Calculation / Output)
- D (Data): source system imports only — never mix with user input
- I (Input): end-user entry, minimal calculations
- S (System): lookups, mappings, time management — summaries typically OFF
- C (Calculation): heavy computation, fan-out pattern — summaries ALWAYS OFF
- O (Output): reads from Calculation modules, never recalculates
Flag: mixing imported data and user input in the same module; Calculation modules with summaries ON.

PLANS CRITICAL RULES — NEVER VIOLATE:
1. NEVER SUM + LOOKUP in same line item → split: LOOKUP first (intermediate), then SUM
2. NEVER daisy-chain formulas A→B→C→D → fan-out: B, C, D each reference A directly
3. NEVER SELECT with hardcoded list member names → use a System lookup module
4. NEVER nest IF-THEN-ELSE more than 3 levels deep → use mapping module + LOOKUP
5. NEVER SUM a percentage, rate, or ratio → re-derive: SUM(numerator)/SUM(denominator)
6. ALWAYS set correct Summary Method: Currency/Count→SUM | Rate/Percentage/Ratio→NONE | Boolean→NONE | Date→NONE
Flag: division A/B with no zero-guard; hardcoded magic numbers in formulas; formulas >120 chars without intermediate decomposition.

CROSS-MODULE DATA FLOW — correct direction is strictly top-down:
  Source Systems (ERP/MES/QMS)
    → Data Hub (DAT01–DAT14) — flat lists and properties only
    → Operational modules: CAP (Pipeline) → PLN (Demand) → PRC (Procurement)
                                                           → MFG (Production)
                           TRK (Tracking) ←→ PLN (demand from projects)
    → Financial modules (FIN01–FIN08)
    → Strategic modules (SOP01–SOP05, KPI01–KPI02, IBP01–IBP04)
    → Dashboards

Key expected references (flag if these are reversed or missing):
- DAT01 Project Master → all pillars (project attributes, contract value)
- TRK04 EVM Input → FIN02 Cost Aggregation (actual labor cost)
- TRK05 EVM Calc → KPI01, FIN04 (CPI, SPI, EV%)
- PLN07 Demand Summary → SOP01 Demand Review (resource demand by type)
- PRC03 Procurement Calc → FIN02 Cost Aggregation (material costs)
- MFG07 NCR Calc → FIN02 Cost Aggregation (NCR rework costs)
- MFG02 Capacity Calc → SOP02 Supply Review (available capacity)
- FIN08 Financial Output → SOP/KPI/IBP (revenue, margin, P&L)
Flag: any module referencing another module that is DOWNSTREAM of it in this flow (e.g. a DAT module reading from FIN, or SYS reading from an Output module).

HUB-AND-SPOKE ARCHITECTURE
- Data Hub modules (DAT01–DAT14): flat lists and property modules ONLY — no planning logic, no hierarchies, no calculations
- Spoke modules (CAP/TRK/PLN/PRC/MFG/FIN/SOP/KPI/IBP): all input/calculation/output logic lives here
- Store attributes as line items in property modules, NOT as list properties
- Lists stay flat in Data Hub; build hierarchies via saved views in spoke models
Flag: DAT modules that contain calculated line items or planning logic.

VERSION HANDLING
Modules that SHOULD be versioned: FIN03–FIN08, SOP01–SOP03, IBP02, IBP04, PLN04–PLN07
Modules that must NOT be versioned (actuals/source data): TRK01–TRK12, PRC01–PRC06, MFG01–MFG10, FIN01–FIN02, all DAT modules, all SYS modules
Rule: if a module contains actual/historical data imported from source systems, it must NOT have the version dimension.
Flag: TRK, PRC, MFG, DAT, or SYS modules that appear to have version dimension enabled.

VALID ANAPLAN FORMULA FUNCTIONS — only flag formula issues using functions that actually exist:
LOOKUP, SELECT, SUM, IF/THEN/ELSE, OFFSET, CUMULATE, FINDITEM, RANK, PARENT, CHILDREN,
CURRENTPERIODSTART(), CURRENTPERIODEND(), CURRENTPERIOD(), ISACTUALVERSION(),
AND(), OR(), NOT(), ANY(), ALL(), LAG(), LEAD(), YEARVALUE(), MONTHVALUE(),
ABS(), MAX(), MIN(), ROUND(), POWER(), SQRT(), TEXT(), VALUE(), LENGTH(),
LEFT(), RIGHT(), MID(), TRIM(), UPPER(), LOWER(), SUBSTITUTE(), CONCATENATE()
NEVER flag a formula for using an invented or non-existent function.

SUMMARY METHODS — correct mapping by data type:
Currency / Revenue / Hours / Count → SUM
Rate / Price / Percentage / Ratio / Index → NONE (NEVER SUM these)
Boolean → NONE (or ANY / ALL for rollups)
Date → NONE (or MIN / MAX)
Text → NONE
Headcount (snapshot, not additive across time) → NONE
Flag: percentage/rate/ratio line items with SUM summary; currency/count line items with NONE summary when aggregation is needed.

CORRECT FORMULA PATTERNS — DO NOT FLAG THESE:
- IF NOT Is Active THEN 0 ELSE [calculation] — valid performance guard when >50% cells are zero
- RAG threshold pattern: Is Green / Is Amber / Is Red as separate boolean line items feeding a status text — correct decomposition
- Fan-out: multiple modules all referencing the same source module — correct (NOT daisy-chaining)
- EAC override: IF Manual Override > 0 THEN Manual Override ELSE Calculated EAC — correct override pattern
- Numerator/Denominator split for portfolio rates: SUM(EV) / SUM(AC) — correct aggregation
- OFFSET(line_item, N) for payment delay or time-shifting — correct cash flow pattern
- CUMULATE(line_item) for running totals — correct
- SELECT with Versions.Actual or Versions.Forecast is acceptable when referencing version dimension members (not arbitrary list members)

ANTI-PATTERNS (flag if clearly present):
- SUM+LOOKUP in same line item
- Daisy-chain (A→B→C→D sequential dependency)
- SELECT with hardcoded member names
- Nested IF > 3 levels
- SUM of percentages/rates
- Missing Summary Method on currency or count line items
- Mixing imports with user input in same module
- Duplicate logic in multiple modules instead of one shared SYS module
- Hardcoded time period names (use CURRENTPERIODSTART/END instead)
- DAT module with calculations (violates Hub-and-Spoke)
- TRK/PRC/MFG/DAT/SYS module with version dimension (should never be versioned)

=== PATTERNS THAT ARE CORRECT — DO NOT FLAG ===
- IF Future / IF Current / IF Prior / IF ISANCESTOR() — standard time-phasing, always intentional
- IF [time condition] THEN value ELSE 0 — correct; forecasts/plans are zero outside planning horizon
- IF [time condition] THEN value ELSE BLANK() — also correct
- LOOKUP, SUM, COLLECT across lists — normal cross-module reads
- Input modules with few or no formulas — correct DISCO separation (I category)
- Modules with only BOOLEAN line items — valid filter/flag modules (S or C category)
- Setting forecast or plan to 0 for history periods — CORRECT forward-looking practice
- Long but readable formulas — only flag if >120 chars AND no intermediate decomposition

=== MODULES TO REVIEW ===

${moduleLines}

=== OUTPUT QUALITY RULES ===
- NEVER invent module names, line item names, or formulas not present in the blueprint above
- NEVER flag a missing cross-module reference unless you have confirmed the source module does not exist in the blueprint
- VERIFY: before flagging a formula issue, confirm the formula text is actually present in the data above
- FLAG RISKS: if fixing an issue could break downstream modules that reference this one, note it in builderNote
- PLAIN ENGLISH: reasoning and action must be understandable to a non-technical stakeholder
- Add a builderNote when the fix is non-trivial, involves cross-module impact, or requires specific Anaplan steps
- SKIP a module entirely if it has no genuine violations — do not invent problems
- Total issues capped at ${MAX_HAIKU_ISSUES}. Prioritise "Fix Now" first, then "Consider", then "Monitor"
- Use the [format/summary] data shown for INPUT and CALC items to flag wrong summary methods (e.g. Percentage with SUM, Currency with NONE)
- Use the dims list on each module header to flag modules with more than 6 dimensions
- Use INPUT item names to flag naming violations (booleans without verb prefix, vague names like Temp/Copy/Test/Number)
- Only flag something if you are confident it is a real Anaplan Way violation per the rules above

Each issue: { "moduleId", "moduleName", "domain", "triage", "title", "reasoning", "action", "builderNote" }
domain: "Structural" | "Formula" | "Best Practice" | "Naming"
triage: "Fix Now" | "Consider" | "Monitor"
title: ≤ 60 chars — specific: name the line item or pattern
reasoning: ≤ 25 words — why it violates Anaplan Way and what risk it creates
action: ≤ 25 words — concrete step to fix it
builderNote: ≤ 40 words — cross-module impact, specific Anaplan steps, or downstream risk (omit if trivial)

Respond with a raw JSON array only — no markdown fences, no commentary.`;
}

async function runHaikuBulk(client, extractions, normalized, sendEvent) {
  sendEvent({ type: 'haiku-progress', modulesDone: 0, modulesTotal: extractions.length, moduleName: 'Scanning all modules…', skipped: false });

  // Prompt is larger now (full line-item visibility) but still well under 200K limit
  const messages = [{ role: 'user', content: buildHaikuBulkPrompt(extractions) }];
  await guardTokens(client, HAIKU_MODEL, messages);
  // 12288: 60 issues × ~180 tokens each (longer reasoning/action/builderNote) = ~10800 tokens
  const resp = await client.messages.create({ model: HAIKU_MODEL, max_tokens: 12288, messages });

  const parsed = parseJsonStrict(resp.content?.[0]?.text);
  if (!parsed || !Array.isArray(parsed)) {
    sendEvent({ type: 'haiku-progress', modulesDone: extractions.length, modulesTotal: extractions.length, moduleName: 'Done', skipped: false });
    return [];
  }

  const VALID_TRIAGE = new Set(['Fix Now', 'Consider', 'Monitor']);
  const VALID_DOMAIN = new Set(['Structural', 'Formula', 'Best Practice', 'Naming']);

  const allIssues = parsed
    .filter(item => item && VALID_TRIAGE.has(item.triage) && VALID_DOMAIN.has(item.domain))
    .map(item => ({
      moduleId:    item.moduleId   || 'unknown',
      moduleName:  item.moduleName || 'Unknown Module',
      lineItemName: item.lineItemName || item.lineItem || '',
      evidence:    item.evidence || '',
      domain:      item.domain,
      triage:      item.triage,
      text:        item.title || item.text || '',
      reasoning:   item.reasoning || '',
      action:      item.action || '',
      builderNote: item.builderNote || '',
    }));
  const { valid: validatedIssues, rejected } = validateAiSuggestions(normalized, allIssues);
  if (rejected.length) {
    sendEvent({ type: 'validation', rejectedSuggestions: rejected.length });
  }

  // Group by module and emit one suggestions event per affected module
  const byModule = new Map();
  for (const issue of validatedIssues) {
    if (!byModule.has(issue.moduleId)) {
      byModule.set(issue.moduleId, { moduleId: issue.moduleId, moduleName: issue.moduleName, items: [] });
    }
    byModule.get(issue.moduleId).items.push(issue);
  }
  for (const group of byModule.values()) {
    sendEvent({ type: 'suggestions', moduleId: group.moduleId, moduleName: group.moduleName, items: group.items });
  }

  sendEvent({ type: 'haiku-progress', modulesDone: extractions.length, modulesTotal: extractions.length, moduleName: 'Done', skipped: false });
  return validatedIssues;
}

function buildSonnetSynthesisPrompt(extractions, allSuggestions, deterministicScore) {
  const fixNow = allSuggestions.filter(s => s.triage === 'Fix Now');
  const consider = allSuggestions.filter(s => s.triage === 'Consider');
  const monitor = allSuggestions.filter(s => s.triage === 'Monitor');

  const userContent = `You are a senior Anaplan certified model builder. Assess the health of this Anaplan ETO model blueprint using Anaplan Way standards.

MODEL OVERVIEW
${extractions.length} modules | ${extractions.reduce((s, m) => s + m.lineItemCount, 0)} line items
${extractions.filter(m => m.lineItems.some(li => li.formula)).length} modules with calculated line items
${extractions.filter(m => m.lineItems.every(li => !li.formula)).length} input-only modules

MODULE BREAKDOWN
${extractions.map(m =>
  `${m.moduleName}: ${m.lineItemCount} items (${m.lineItems.filter(li => li.formula).length} calc, ${m.lineItems.filter(li => !li.formula).length} input)`
).join('\n')}

ISSUES FOUND
${fixNow.length} Fix Now | ${consider.length} Consider | ${monitor.length} Monitor

DETERMINISTIC BASE SCORE
Health score: ${deterministicScore.healthScore}/100
Verdict: ${deterministicScore.verdict}
Dimension scores: ${Object.entries(deterministicScore.dimensions).map(([k, v]) => `${k}=${v}`).join(', ')}

By domain:
${['Structural', 'Formula', 'Best Practice', 'Naming'].map(d => {
  const fn = allSuggestions.filter(s => s.domain === d && s.triage === 'Fix Now').length;
  const co = allSuggestions.filter(s => s.domain === d && s.triage === 'Consider').length;
  return `  ${d}: ${fn} Fix Now, ${co} Consider`;
}).join('\n')}

Fix Now issues:
${fixNow.map(s => `  [${s.domain}] ${s.moduleName}: ${s.text}`).join('\n') || '  None'}

SCORING GUIDANCE (Anaplan Way)
Use the deterministic base score as the anchor. You may adjust by at most 10 points if the suggestion set shows severity the deterministic scan cannot infer. healthScore starts at 100, then deduct:
  - Each Structural "Fix Now": -8 (SUM+LOOKUP, daisy-chain, DISCO violation are architecture-critical)
  - Each Formula "Fix Now": -6 (missing zero-guard, SUM of percentage, hardcoded SELECT)
  - Each Best Practice "Fix Now": -5
  - Each Naming "Fix Now": -3
  - Each "Consider": -1.5
  - Each "Monitor": -0.5
  Cap minimum at 5. Round to nearest integer.

verdict: "Good" (≥85) | "Needs Work" (60–84) | "Critical" (<60)

Dimension scoring:
  architecture: penalise hub-and-spoke violations, wrong versioning, DISCO mixing; boost if module structure is clean
  naming: penalise missing XXX## prefixes, vague names, wrong boolean naming
  formulas: penalise SUM+LOOKUP, zero-guard missing, SUM of ratios, hardcoded members
  dataHygiene: penalise mixing imports with input, wrong summary methods, text line items overuse
  governance: penalise daisy-chains, hardcoded periods, duplicate logic, lack of SYS modules

summary: 2 sentences max. Sentence 1: describe what this model does — its planning scope, the functional areas it covers, and its scale (use the module count above). Sentence 2: explain the score at a dimensional level — which dimensions held up and which pulled it down. Do NOT list specific violations, module names, or recommendations (those appear in the suggestions panel below). Do NOT use filler phrases.

Return JSON:
{
  "healthScore": <0-100>,
  "verdict": "Good" | "Needs Work" | "Critical",
  "summary": "<2-3 sentence specific executive summary>",
  "dimensions": {
    "architecture": <0-100>,
    "naming": <0-100>,
    "formulas": <0-100>,
    "dataHygiene": <0-100>,
    "governance": <0-100>
  }
}
Respond with raw JSON only — no markdown fences.`;

  const system = 'You are a senior Anaplan certified model builder producing health assessments grounded in Anaplan Way standards. Always respond with valid JSON only, no markdown.';
  return { userContent, system };
}

// ANLZ-01: Defensive normalisation of Sonnet synthesis response
export function normalizeSynthesis(raw, fallbackScore = null) {
  const r = raw || {};
  const baseScore = typeof fallbackScore?.healthScore === 'number' ? fallbackScore.healthScore : 50;
  const rawScore = typeof r.healthScore === 'number' ? Math.max(0, Math.min(100, r.healthScore)) : baseScore;
  const score = Math.max(0, Math.min(100, Math.max(baseScore - 10, Math.min(baseScore + 10, rawScore))));
  const verdict = score >= 85 ? 'Good' : score >= 60 ? 'Needs Work' : 'Critical';
  const d = r.dimensions || {};
  const dim = k => {
    const base = typeof fallbackScore?.dimensions?.[k] === 'number' ? fallbackScore.dimensions[k] : 50;
    const rawDim = typeof d[k] === 'number' ? Math.max(0, Math.min(100, d[k])) : base;
    return Math.max(0, Math.min(100, Math.max(base - 10, Math.min(base + 10, rawDim))));
  };
  return {
    healthScore: score,
    verdict,
    summary: r.summary || 'Analysis complete.',
    dimensions: {
      architecture: dim('architecture'),
      naming: dim('naming'),
      formulas: dim('formulas'),
      dataHygiene: dim('dataHygiene'),
      governance: dim('governance'),
    },
  };
}

// ANLZ-04: Build cross-module dependency graph from formula text matching
export function detectDependencies(extractions) {
  const deps = {};
  for (const mod of extractions) {
    if (!deps[mod.moduleId]) deps[mod.moduleId] = { receivesFrom: new Set(), sendsTo: new Set() };
  }
  for (const mod of extractions) {
    for (const li of mod.lineItems) {
      if (!li.formula) continue;
      for (const other of extractions) {
        if (other.moduleId === mod.moduleId) continue;
        // B-10: append '.' so 'FIN02' won't match inside 'FIN020' or 'FIN02Cost'
        if (li.formula.includes(other.moduleName + '.')) {
          deps[mod.moduleId].receivesFrom.add(other.moduleName);
          if (!deps[other.moduleId]) deps[other.moduleId] = { receivesFrom: new Set(), sendsTo: new Set() };
          deps[other.moduleId].sendsTo.add(mod.moduleName);
        }
      }
    }
  }
  const result = {};
  for (const [id, val] of Object.entries(deps)) {
    result[id] = {
      receivesFrom: Array.from(val.receivesFrom),
      sendsTo: Array.from(val.sendsTo),
    };
  }
  return result;
}

// B-02: Generates a plain-English model overview — layers, scope, data flow direction
export function buildNarrativePrompt(extractions, _deps) {
  const totalLineItems = extractions.reduce((s, m) => s + m.lineItemCount, 0);

  // Group modules by pillar prefix so Sonnet understands what layers exist
  const pillarMap = {};
  for (const m of extractions) {
    const prefix = (m.moduleName.match(/^([A-Z]{2,4})/) || ['', 'OTHER'])[1];
    pillarMap[prefix] = (pillarMap[prefix] || 0) + 1;
  }
  const pillarSummary = Object.entries(pillarMap)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${v} modules`)
    .join(', ');

  const sampleNames = extractions.slice(0, 30).map(m => m.moduleName).join(', ');

  const userContent = `You are a senior Anaplan model builder. Write a concise plain-English description of this model's design for a business stakeholder — not a technical audience.

MODEL: ${extractions.length} modules, ${totalLineItems} line items
PILLARS: ${pillarSummary}
SAMPLE NAMES: ${sampleNames}

Describe:
1. What planning problem this model solves and its overall scope
2. The main layers (e.g. data hub, operational planning, financial consolidation, reporting) and how data flows top-down through them
3. Any notable structural approach (e.g. whether it separates actuals from forecasts, centralises master data, etc.)

Format — use this exact structure:
• One opening sentence covering what the model does and its scale
• 3–5 bullet points (use the • character) for the main layers and data flow
• One closing sentence on the overall structural approach

Rules:
- Under 130 words total
- Avoid Anaplan jargon: do not use terms like hub-and-spoke, DISCO, PLANS, Polaris, fan-out, daisy-chain
- Do not mention formula issues, violations, or health score
- Do not fabricate module names not in the list above
- Write as if explaining to a finance or ops director, not a developer

Return JSON only: { "story": "<description>" }`;

  const system = 'You are a senior Anaplan model builder writing plain-English model overviews for business stakeholders. Always respond with valid JSON only, no markdown fences.';
  return { userContent, system };
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const blobUrl = req.body?.blobUrl; // safe — req.body may be undefined if body parsing fails
  if (!blobUrl) return res.status(400).json({ error: 'Missing blobUrl' });
  // SEC-01: Reject non-Vercel-Blob URLs before any network call (SSRF guard)
  if (!isAllowedBlobUrl(blobUrl)) return res.status(400).json({ error: 'Invalid blobUrl — must be a Vercel Blob URL' });
  if (ENABLE_AI_ANALYSIS && !process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  // SSE headers BEFORE first await
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Event log collects every event so we can cache and replay
  const eventLog = [];
  function sendEvent(obj) {
    eventLog.push(obj);
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  }

  const startMs = Date.now();
  const client = ENABLE_AI_ANALYSIS ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
  // Declared outside try so finally can always clearInterval it regardless of where error occurs
  let tickInterval = null;

  try {
    // Stage 1: Fetch blueprint
    sendEvent({ type: 'progress', stage: 'fetching', pct: 5 });
    const bpRes = await fetch(blobUrl);
    if (!bpRes.ok) throw new Error(`Blob fetch failed: ${bpRes.status}`);
    const blueprint = await bpRes.json();

    if (!blueprint.modules || !Array.isArray(blueprint.modules)) {
      throw new Error('Blueprint Blob is missing modules array');
    }

    // Stage 1b: Check cache before doing any AI work
    const hash = blueprintHash(blueprint);
    const cached = await getCachedEvents(hash);
    if (cached) {
      // Replay stored events — free, instant
      res.write(`data: ${JSON.stringify({ type: 'cache-hit' })}\n\n`);
      for (const evt of cached) {
        // Mark the complete event so the frontend knows this is a cache replay
        const toSend = evt.type === 'complete' ? { ...evt, fromCache: true } : evt;
        res.write(`data: ${JSON.stringify(toSend)}\n\n`);
      }
      if (typeof res.flush === 'function') res.flush();
      return;
    }

    // Stage 2: Extraction pre-pass (ANLZ-03)
    sendEvent({ type: 'progress', stage: 'extracting', pct: 15 });
    const snapshot = buildAnalysisSnapshot(blueprint);
    const extractions = extractionPrePass(blueprint);
    sendEvent({
      type: 'extraction-done',
      moduleCount: extractions.length,
      totalLineItems: extractions.reduce((s, m) => s + m.lineItemCount, 0),
    });
    const deterministicByModule = new Map();
    for (const item of snapshot.deterministicSuggestions) {
      if (!deterministicByModule.has(item.moduleId)) {
        deterministicByModule.set(item.moduleId, { moduleId: item.moduleId, moduleName: item.moduleName, items: [] });
      }
      deterministicByModule.get(item.moduleId).items.push(item);
    }
    for (const group of deterministicByModule.values()) {
      sendEvent({ type: 'suggestions', moduleId: group.moduleId, moduleName: group.moduleName, items: group.items });
    }
    sendEvent({
      type: 'deterministic-scan',
      findingCount: snapshot.findings.length,
      healthScore: snapshot.score.healthScore,
      verdict: snapshot.score.verdict,
    });
    sendEvent({
      type: 'intelligence',
      intelligence: snapshot.intelligence,
    });

    if (!ENABLE_AI_ANALYSIS) {
      sendEvent({ type: 'progress', stage: 'scoring', pct: 90 });
      sendEvent({
        type: 'score',
        healthScore: snapshot.score.healthScore,
        verdict: snapshot.score.verdict,
        summary: snapshot.intelligence.evidenceSummary,
        dimensions: snapshot.score.dimensions,
      });
      sendEvent({
        type: 'complete',
        healthScore: snapshot.score.healthScore,
        totalSuggestions: snapshot.deterministicSuggestions.length,
        underlyingFindings: snapshot.findings.length,
        analysisId: blueprint.modelId,
        deterministicOnly: true,
      });
      await setCachedEvents(hash, eventLog);
      return;
    }

    // Stage 3: Single Haiku bulk call — all modules, full reasoning (ANLZ-02)
    sendEvent({ type: 'progress', stage: 'suggestions', pct: 25 });
    const _haikuStartMs = Date.now();
    tickInterval = setInterval(() => {
      const elapsed = Date.now() - _haikuStartMs;
      const pct = Math.min(65, 25 + Math.round((elapsed / 28_000) * 40));
      sendEvent({ type: 'progress', stage: 'suggestions', pct });
    }, 2000);
    const aiSuggestions = await runHaikuBulk(client, extractions, snapshot.normalized, sendEvent);
    const allSuggestions = [...snapshot.deterministicSuggestions, ...aiSuggestions];
    clearInterval(tickInterval); tickInterval = null;

    // Budget guard before Sonnet
    if (Date.now() - startMs > TOTAL_BUDGET_MS) {
      sendEvent({ type: 'partial-analysis', reason: 'Total budget reached before synthesis', modulesAnalysed: extractions.length, modulesSkipped: 0 });
      sendEvent({ type: 'complete', healthScore: null, totalSuggestions: allSuggestions.length, analysisId: blueprint.modelId });
      await setCachedEvents(hash, eventLog);
      return;
    }

    // Stage 4a: Sonnet synthesis — health score, verdict, dimensions (ANLZ-01)
    sendEvent({ type: 'progress', stage: 'scoring', pct: 70 });
    // Real-time tick: creep bar 70→82% while awaiting Sonnet response (~14s)
    const _sonnetStartMs = Date.now();
    tickInterval = setInterval(() => {
      const elapsed = Date.now() - _sonnetStartMs;
      const pct = Math.min(82, 70 + Math.round((elapsed / 14_000) * 12));
      sendEvent({ type: 'progress', stage: 'scoring', pct });
    }, 2000);
    const { userContent: synthUser, system: synthSystem } = buildSonnetSynthesisPrompt(extractions, allSuggestions, snapshot.score);
    const synthMessages = [{ role: 'user', content: synthUser }];
    await guardTokens(client, SONNET_MODEL, synthMessages, synthSystem);
    const synthRaw = await client.messages.create({ model: SONNET_MODEL, max_tokens: 1024, messages: synthMessages, system: synthSystem });
    clearInterval(tickInterval); tickInterval = null;
    const synth = normalizeSynthesis(parseJsonStrict(synthRaw.content?.[0]?.text), snapshot.score);

    sendEvent({
      type: 'score',
      healthScore: synth.healthScore,
      verdict: synth.verdict,
      summary: synth.summary,
      dimensions: synth.dimensions,
    });

    // Narrative is handled by /api/analyze-narrative — this endpoint is now complete after scoring
    sendEvent({ type: 'complete', healthScore: synth.healthScore, totalSuggestions: allSuggestions.length, analysisId: blueprint.modelId });
    await setCachedEvents(hash, eventLog);

  } catch (err) {
    console.error('Analyze error:', err.message);
    sendEvent({ type: 'error', message: err.message });
  } finally {
    if (tickInterval) clearInterval(tickInterval);
    res.end();
  }
}
