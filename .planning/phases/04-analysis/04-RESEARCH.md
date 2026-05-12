# Phase 4: Analysis — Research

**Researched:** 2026-05-11
**Domain:** Anthropic SDK (countTokens, streaming, multi-model orchestration), blueprint extraction pre-pass, SSE in Vercel serverless functions, prompt engineering for structured JSON output
**Confidence:** HIGH (SDK verified from installed package; blueprint schema verified from live COPS Demo run; SSE patterns inherited from Phase 3 confirmed implementation)

---

## Summary

Phase 4 builds `api/analyze.js` — a single Vercel serverless function that reads the blueprint Blob URL stored in Phase 3, performs an extraction pre-pass to distil raw JSON into a Claude-safe payload, runs Claude Haiku 4.5 per-module in controlled-concurrency batches for triage-tagged suggestions, then calls Claude Sonnet 4.6 for a health score, executive summary, and cross-module narrative. Everything streams via SSE to the browser using the same `res.flushHeaders() + res.write()` pattern proven in `api/blueprint.js`.

The critical constraint is the 60-second `maxDuration`. A 228-module model (COPS Demo baseline) cannot run 228 sequential Haiku calls; they must run in controlled-parallel batches. The token guard — `client.messages.countTokens()` before every Claude call — ensures no prompt exceeds 180K tokens regardless of model size. The extraction pre-pass is the mechanism that makes this possible: it reduces each module from its full `lineItems[]` array down to a compact summary object before anything touches Claude.

The SSE event protocol for this phase is richer than Phase 3's: it includes `extraction-done`, `haiku-progress`, `sonnet-start`, `sonnet-complete`, `narrative-complete`, and `error` events so the UI can render a live progress sequence rather than a blank wait.

**Primary recommendation:** Build `api/analyze.js` as a single orchestration function with four sequential stages: (1) fetch + parse blueprint from Blob, (2) extraction pre-pass producing `ExtractionSummary[]`, (3) batched Haiku suggestion calls, (4) single Sonnet synthesis call. All Claude calls are guarded by `countTokens()` pre-flight that aborts and emits an error event if the token budget would be exceeded.

---

<user_constraints>
## User Constraints (from STATE.md locked decisions)

### Locked Decisions
- Two-model strategy: Haiku 4.5 (`claude-haiku-4-5-20251001`) for per-module extraction/suggestions, Sonnet 4.6 (`claude-sonnet-4-6`) for final synthesis and health scoring
- Extraction pre-pass required before every Claude call — 200K token limit on Haiku; 180K soft limit enforced via countTokens() pre-flight
- Blueprint Blob URL (not raw JSON) passed to /api/analyze — comes from sessionStorage key `meridian.blueprintBlobUrl`
- SSE via `fetch()` + `ReadableStream` for streaming analysis output
- `res.flushHeaders()` before first `await` in every SSE handler
- `api/analyze.js` maxDuration must be 60s — already in vercel.json from Phase 1
- ESM: `export default async function handler(req, res)` — matching `api/blueprint.js` and `api/generate.js` patterns
- Blob stored with `access: 'public'` (Phase 3 decision) — fetch from Blob URL via plain `fetch()`, no auth token needed

### Claude's Discretion
- Batch size for parallel Haiku calls (researched below — recommend 5 modules/batch)
- SSE event names and payload shapes
- Health score dimension weighting (researched below — 5 dimensions per ANLZ-01)
- Triage calibration: Fix Now / Consider / Monitor threshold definitions
- Cross-module narrative prompt structure

### Deferred Ideas (OUT OF SCOPE for Phase 4)
- PDF export (Phase 5)
- Shareable link (Phase 5)
- Full UI overhaul (Phase 5)
- Incremental re-analysis of individual modules (PERF-02, future)
- OAuth 2.0 (AUTH-01, future)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ANLZ-01 | Health score (0–100), tiered verdict (Good/Needs Work/Critical), executive summary, 5 dimension scores — from Claude Sonnet via blueprint Blob URL | Sonnet synthesis prompt design in Architecture Patterns; score derivation rules; verdict thresholds |
| ANLZ-02 | Improvement suggestions grouped by domain (Structural/Formula/Best Practice/Naming) with triage tag (Fix Now/Consider/Monitor) per suggestion — Claude Haiku per module in parallel | Haiku per-module prompt; structured JSON output format; batch concurrency strategy |
| ANLZ-03 | Extraction pre-pass on blueprint before any Claude call — raw JSON never reaches prompt; token count < 180K via countTokens() pre-flight | ExtractionSummary design; countTokens() API usage; field stripping strategy |
| ANLZ-04 | Cross-module data flow story with clickable module nodes → per-module drill-in (purpose, receives-from, sends-to, risks) with breadcrumb back | Narrative prompt; dependency graph derivation from formula text; per-module note shape |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @anthropic-ai/sdk | 0.95.1 | Claude Haiku + Sonnet API calls; countTokens() pre-flight | Already installed; Haiku 4.5 and Sonnet 4.6 model IDs verified in installed type definitions |
| @vercel/blob | 2.3.3 | Fetch blueprint JSON from Blob URL | Already installed; Phase 3 writes here; Phase 4 reads the URL |

[VERIFIED: `/tmp/meridian-anaplan/package.json` — both packages at pinned versions]

### Supporting (no new installs needed)

No new npm packages are required for Phase 4. All tools needed are already declared:
- `fetch()` (Node 18 built-in) — for fetching the Blob URL
- `@anthropic-ai/sdk` `Messages` class — for all Claude calls
- `res.write()` + `res.flushHeaders()` — for SSE (same pattern as `api/blueprint.js`)

### Model IDs (verified from installed SDK type definitions)

[VERIFIED: `/tmp/meridian-anaplan/node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts` line 795]

```
type Model = 'claude-opus-4-7' | 'claude-mythos-preview' | 'claude-opus-4-6'
           | 'claude-sonnet-4-6' | 'claude-haiku-4-5' | 'claude-haiku-4-5-20251001'
           | 'claude-opus-4-5' | ...
```

- **Haiku per-module:** `'claude-haiku-4-5-20251001'` — matches `api/generate.js` line 32 [VERIFIED]
- **Sonnet synthesis:** `'claude-sonnet-4-6'` — locked decision; verified as valid Model type [VERIFIED]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Batched parallel Haiku (5/batch) | Sequential Haiku | Sequential: safer but 228 × ~3s = 11+ minutes, far exceeds 60s. Batched parallel is required. |
| Batched parallel Haiku (5/batch) | All-at-once Promise.all | All-at-once risks Anthropic rate limits; 5/batch keeps throughput high while staying within rate limits |
| Sonnet for synthesis only | Sonnet for per-module too | Sonnet is ~5x more expensive and slower per call; Haiku is sufficient for structured suggestion extraction |
| SSE streaming | Polling or long-poll | SSE is already proven in Phase 3; polling adds round-trip overhead |

**Installation:** No new packages needed. `npm install` already run in Phase 1.

---

## Architecture Patterns

### Recommended File Structure

```
api/
├── blueprint.js     # Phase 3 — already exists
├── analyze.js       # Phase 4 — NEW: full orchestration
├── connect.js       # Phase 2
├── generate.js      # Phase 1
└── models.js        # Phase 2
```

`api/analyze.js` is a single file. No helper modules — the project uses plain JS files directly in `api/`, not a `lib/` directory. [VERIFIED: `ls /tmp/meridian-anaplan/api/`]

### Pattern 1: Four-Stage SSE Orchestration

**What:** `api/analyze.js` runs four sequential stages inside a single SSE handler, emitting named events at each stage boundary.

**Stage sequence:**
1. Fetch + parse blueprint JSON from Blob URL
2. Extraction pre-pass → `ExtractionSummary[]`
3. Batched Haiku suggestion calls (5 modules/batch, `Promise.allSettled`)
4. Single Sonnet synthesis call (health score + narrative)

**SSE event protocol:**

```javascript
// Source: derived from blueprint.js SSE pattern [VERIFIED: api/blueprint.js]

// Stage 1 complete
sendEvent({ type: 'extraction-done', moduleCount: N, totalLineItems: M });

// Stage 3 progress (per batch)
sendEvent({ type: 'haiku-progress', modulesDone: N, modulesTotal: M, moduleName: '...' });

// Stage 4 start
sendEvent({ type: 'sonnet-start' });

// Stage 4 complete — health score payload
sendEvent({
  type: 'sonnet-complete',
  healthScore: 72,
  verdict: 'Needs Work',      // 'Good' | 'Needs Work' | 'Critical'
  summary: '...',             // executive summary paragraph
  dimensions: {
    structure: 68,
    formula: 75,
    bestPractice: 70,
    naming: 80,
    performance: 65,
  },
});

// Stage 4 narrative complete
sendEvent({
  type: 'narrative-complete',
  story: '...',               // cross-module narrative markdown
  moduleNotes: {              // keyed by moduleId
    'mod-abc': {
      purpose: '...',
      receivesFrom: ['mod-xyz'],
      sendsTo: ['mod-def'],
      risks: ['...'],
    },
  },
});

// Error (any stage)
sendEvent({ type: 'error', stage: 'haiku' | 'sonnet' | 'extraction', message: '...' });

// Terminal event
sendEvent({ type: 'complete' });
```

### Pattern 2: SSE Handler Skeleton for api/analyze.js

```javascript
// Source: modeled on api/blueprint.js [VERIFIED: api/blueprint.js lines 39-226]
import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { blobUrl } = req.body;
  if (!blobUrl) return res.status(400).json({ error: 'Missing blobUrl' });

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

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    // Stage 1: Fetch blueprint from Blob
    const bpRes = await fetch(blobUrl);
    const blueprint = await bpRes.json();

    // Stage 2: Extraction pre-pass
    const extractions = extractBlueprint(blueprint);
    sendEvent({ type: 'extraction-done', moduleCount: blueprint.moduleCount, totalLineItems: blueprint.totalLineItems });

    // Stage 3: Batched Haiku suggestions
    const suggestions = await runHaikuBatches(client, extractions, sendEvent);

    // Stage 4: Sonnet synthesis
    sendEvent({ type: 'sonnet-start' });
    const synthesis = await runSonnetSynthesis(client, extractions, suggestions);
    sendEvent({ type: 'sonnet-complete', ...synthesis.verdict });

    // Stage 4b: Narrative
    const narrative = await runSonnetNarrative(client, extractions);
    sendEvent({ type: 'narrative-complete', ...narrative });

    sendEvent({ type: 'complete' });
  } catch (err) {
    console.error('Analyze error:', err.message);
    sendEvent({ type: 'error', message: err.message });
  } finally {
    res.end();
  }
}
```

### Pattern 3: Extraction Pre-Pass (ANLZ-03)

**What:** Transform raw `BlueprintDocument` into an array of `ExtractionSummary` objects. Raw blueprint for 228 modules × ~10 line items each can be 1-3 MB of JSON. The extraction reduces this to a compact token-efficient structure.

**Fields to KEEP per line item (for Haiku suggestion prompt):**
- `name` — required (referenced in suggestions)
- `formula` — most important for formula analysis
- `format` — data type context (BOOLEAN, NUMBER, etc.)
- `summary` — SUM/NONE/FORMULA reveals calculation patterns
- `appliesTo` — dimension count affects performance assessment
- `notes` — builder intent; useful for best-practice check

**Fields to DROP per line item (reduce token count):**
- `id` — internal UUID, not useful for analysis
- `formatMetadata` — low-signal nested object
- `version`, `style`, `timeScale`, `timeRange` — rarely analysis-relevant
- `cellCount` — raw number, better computed as a metric
- `isSummary`, `useSwitchover`, `breakback`, `broughtForward`, `startOfSection` — boolean flags not needed for suggestion prompts
- `formulaScope`, `moduleId`, `moduleName` — redundant when grouped under module

**ExtractionSummary shape:**

```javascript
// Source: derived from live COPS Demo blueprint schema confirmed in Phase 3
// [VERIFIED: 03-01-SUMMARY.md sampleLineItemKeys from live run]

// Per module:
const extractModule = (mod) => ({
  moduleId: mod.id,
  moduleName: mod.name,
  lineItemCount: mod.lineItemCount,
  fetchError: mod.fetchError || null,
  lineItems: mod.lineItems.map((li) => ({
    name: li.name,
    formula: li.formula || null,
    format: li.format || null,
    summary: li.summary || null,
    // appliesTo can be array of {id,name} objects — reduce to name array only
    dimensions: Array.isArray(li.appliesTo)
      ? li.appliesTo.map((d) => d.name || d)
      : (li.appliesTo ? [li.appliesTo] : []),
    notes: li.notes || null,
  })),
});
```

**Token budget estimate for extraction payload:**

A compact ExtractionSummary for one module with 10 line items ≈ ~400 tokens (names + short formulas).
228 modules × 400 tokens = ~91K tokens — well under the 180K soft limit.
For Haiku per-module calls: 1 module extraction ≈ 400 tokens + system prompt ≈ 600 tokens total input.

[ASSUMED: Token estimates based on typical Anaplan formula lengths from COPS Demo schema. Actual counts verified via countTokens() pre-flight before every call.]

### Pattern 4: countTokens() Pre-Flight (ANLZ-03)

**What:** Before every `client.messages.create()` call, call `client.messages.countTokens()` to verify the prompt fits within the 180K budget. Abort with an error event if it exceeds the limit.

**API shape (verified from installed SDK):**

```javascript
// Source: [VERIFIED: node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts line 93]
// countTokens(body: MessageCountTokensParams): APIPromise<MessageTokensCount>
// MessageTokensCount: { input_tokens: number }
// MessageCountTokensParams: { model, messages, system? }

async function guardTokens(client, model, messages, system, limitK = 180) {
  const result = await client.messages.countTokens({
    model,
    messages,
    ...(system ? { system } : {}),
  });
  const tokens = result.input_tokens;
  if (tokens > limitK * 1000) {
    throw new Error(`Token budget exceeded: ${tokens} > ${limitK * 1000} for ${model}`);
  }
  return tokens;
}
```

**Usage pattern:**

```javascript
// Before each Haiku call:
await guardTokens(client, 'claude-haiku-4-5-20251001', haikuMessages, haikuSystem, 180);
const haikuRes = await client.messages.create({ model: 'claude-haiku-4-5-20251001', ... });

// Before Sonnet synthesis call:
await guardTokens(client, 'claude-sonnet-4-6', sonnetMessages, sonnetSystem, 180);
const sonnetRes = await client.messages.create({ model: 'claude-sonnet-4-6', ... });
```

Note: `countTokens()` itself does not count against rate limits and is not billed. [ASSUMED — consistent with documented Anthropic behavior, but not re-verified against current API docs in this session.]

### Pattern 5: Batched Haiku Suggestion Calls (ANLZ-02)

**What:** Run Haiku suggestion calls in batches of 5 modules per batch using `Promise.allSettled`. Each batch completes before the next begins. Failed modules produce an empty suggestions array (not a thrown error).

**Batch size rationale:**

- 60s budget. Stage 1 (blob fetch + extract): ~2s. Stage 4 (two Sonnet calls): ~15-20s. Budget for Stage 3: ~38s.
- Each Haiku call on a single-module prompt: ~2-4s observed for Claude Haiku. [ASSUMED: based on typical Haiku latency; actual measured in generate.js notes as 10-25s for longer prompts but per-module prompts are short]
- 5 parallel Haiku × ~3s = ~3s per batch. 228 modules / 5 per batch = 46 batches × 3s = ~138s — exceeds budget.
- **Real mitigation:** Not every module needs a Haiku call. Modules with `fetchError`, zero line items, or < 3 line items are skipped (emit `haiku-progress` immediately). In COPS Demo with 228 modules, expect ~80-100 active modules after filtering. 100 / 5 = 20 batches × 3s = ~60s — borderline.
- **Fallback:** If approaching 45s elapsed, skip remaining Haiku calls and proceed to Sonnet synthesis with partial suggestions. Emit a `partial-analysis` warning event.

**Time budget check pattern:**

```javascript
const START_MS = Date.now();
const BUDGET_MS = 45_000; // reserve 15s for Sonnet calls

for (let i = 0; i < modules.length; i += BATCH_SIZE) {
  if (Date.now() - START_MS > BUDGET_MS) {
    sendEvent({ type: 'partial-analysis', reason: 'Time budget reached before all modules analyzed' });
    break;
  }
  const batch = modules.slice(i, i + BATCH_SIZE);
  // ... Promise.allSettled(batch.map(runHaikuForModule))
}
```

**Per-module Haiku prompt (ANLZ-02):**

```javascript
// Structured JSON output via tool_use (forces clean JSON without markdown fences)
const haikuMessages = [{
  role: 'user',
  content: `Analyze this Anaplan module and return improvement suggestions as JSON.

Module: ${mod.moduleName} (${mod.lineItemCount} line items)

Line Items:
${mod.lineItems.map((li) =>
  `- ${li.name}${li.formula ? ` = ${li.formula}` : ' [input]'}` +
  `${li.format ? ` [${li.format}]` : ''}` +
  `${li.dimensions.length ? ` (dims: ${li.dimensions.join(', ')})` : ''}` +
  `${li.notes ? ` // ${li.notes}` : ''}`
).join('\n')}

Return a JSON array of suggestions. Each suggestion: { domain, tag, title, reasoning, action }
domain: "Structural" | "Formula" | "Best Practice" | "Naming"
tag: "Fix Now" | "Consider" | "Monitor"
title: short (< 60 chars)
reasoning: 1-2 sentences
action: concrete step the builder should take

If no issues found, return an empty array [].`,
}];
```

**Why tool_use over plain text:** Forcing JSON via a tool definition eliminates markdown code fence wrapping and JSON parse failures. [ASSUMED: tool_use forces JSON; this is Anthropic's recommended pattern for structured output but verified in training knowledge only, not in installed SDK docs in this session.]

**Alternative:** Use a system prompt instructing "respond only with raw JSON array, no markdown" — simpler and sufficient for Haiku. Planner should choose one approach.

### Pattern 6: Sonnet Synthesis Prompt (ANLZ-01)

**What:** After all Haiku suggestions are collected, send a single Sonnet 4.6 call that receives the full extraction summary (all modules) plus the collected suggestions, and returns a health score, verdict, executive summary, and 5 dimension scores.

**5 Dimensions (per ANLZ-01 requirement):**
- `structure` — module organization, separation of concerns, circular dependency risk
- `formula` — formula complexity, hardcoded values, self-referential issues
- `bestPractice` — naming conventions, note completeness, list usage
- `naming` — module names, line item names (clear vs cryptic)
- `performance` — cell count estimates, multi-dimensional items, SUM vs FORMULA patterns

**Verdict thresholds (recommended, Claude's discretion):**
- `Good`: health score ≥ 75
- `Needs Work`: health score 50–74
- `Critical`: health score < 50

**Sonnet synthesis prompt:**

```javascript
const sonnetSystem = `You are an expert Anaplan model reviewer. You assess Anaplan model blueprints and produce structured health assessments. Always respond with valid JSON only, no markdown.`;

const sonnetMessages = [{
  role: 'user',
  content: `Assess the health of this Anaplan model blueprint.

Model has ${blueprint.moduleCount} modules and ${blueprint.totalLineItems} line items.

Module Summaries:
${extractions.map((m) =>
  `${m.moduleName}: ${m.lineItemCount} items, ` +
  `${m.lineItems.filter((li) => li.formula).length} calculated, ` +
  `${m.lineItems.filter((li) => !li.formula).length} inputs`
).join('\n')}

Collected Issues Summary:
${allSuggestions.filter((s) => s.tag === 'Fix Now').length} Fix Now
${allSuggestions.filter((s) => s.tag === 'Consider').length} Consider
${allSuggestions.filter((s) => s.tag === 'Monitor').length} Monitor

Top issues by domain:
${['Structural','Formula','Best Practice','Naming'].map((d) => {
  const issues = allSuggestions.filter((s) => s.domain === d && s.tag === 'Fix Now');
  return `${d}: ${issues.length} Fix Now`;
}).join('\n')}

Return JSON:
{
  "healthScore": <0-100>,
  "verdict": "Good" | "Needs Work" | "Critical",
  "summary": "<2-3 sentence executive summary>",
  "dimensions": {
    "structure": <0-100>,
    "formula": <0-100>,
    "bestPractice": <0-100>,
    "naming": <0-100>,
    "performance": <0-100>
  }
}`,
}];
```

**Token budget for Sonnet synthesis prompt:** With 228 modules compressed to one line each, the prompt body is ~1,500 tokens + system ~100 tokens = ~1,600 tokens total. Well within 180K limit. [VERIFIED conceptually — module summary lines are short strings]

### Pattern 7: Sonnet Narrative Prompt (ANLZ-04)

**What:** A second Sonnet call that derives the cross-module data flow story from formula cross-references. Returns both a narrative string and a per-module notes object.

**Dependency extraction from formulas:**

Formula text in Anaplan often contains direct references to other modules:
```
NAME(ITEM(Users))                    → references "Users" list module
SUM(TRK01.Revenue[LOOKUP: Account])  → references module TRK01
PLN05.Headcount                      → references module PLN05
```

A simple pattern to detect cross-module references before the Sonnet call:

```javascript
function detectDependencies(extractions) {
  const moduleNames = new Set(extractions.map((m) => m.moduleName));
  const deps = {};  // moduleId → { receivesFrom: Set, sendsTo: Set }

  for (const mod of extractions) {
    if (!deps[mod.moduleId]) deps[mod.moduleId] = { receivesFrom: new Set(), sendsTo: new Set() };
    for (const li of mod.lineItems) {
      if (!li.formula) continue;
      for (const other of extractions) {
        if (other.moduleId === mod.moduleId) continue;
        // Check if formula text contains the other module's name
        if (li.formula.includes(other.moduleName)) {
          deps[mod.moduleId].receivesFrom.add(other.moduleName);
          if (!deps[other.moduleId]) deps[other.moduleId] = { receivesFrom: new Set(), sendsTo: new Set() };
          deps[other.moduleId].sendsTo.add(mod.moduleName);
        }
      }
    }
  }
  return deps;
}
```

This pre-detection reduces the Sonnet narrative prompt to structured dependency data — not raw formula text — making the narrative prompt much more token-efficient.

**Narrative prompt payload:** The dependency graph summary passed to Sonnet replaces raw formulas. For 228 modules, the dependency graph with names is ~50 tokens/module = ~11,400 tokens — well within budget.

### Anti-Patterns to Avoid

- **Passing raw blueprint JSON to Claude:** The full BlueprintDocument for COPS Demo is ~1-3 MB. Even if it fit in tokens, it would be token-wasteful and expensive. Always extract first.
- **Sequential Haiku calls:** 100 active modules × 3s each = 300s — 5× over the timeout. Must batch.
- **Skipping countTokens() pre-flight:** A large model with verbose formulas could still exceed 180K even after extraction. Pre-flight prevents 400 errors mid-SSE stream.
- **Awaiting before flushHeaders:** Same as Phase 3 — must call `res.flushHeaders()` before the first `await fetch(blobUrl)`.
- **JSON.parse without try/catch on Haiku output:** Haiku may occasionally return non-JSON despite instructions. Wrap all JSON.parse calls in try/catch and default to empty suggestions array.
- **Two separate Sonnet calls without checking remaining time:** Check elapsed time before starting narrative call; if > 50s, skip narrative and emit a `narrative-skipped` event.
- **Storing suggestions in res object:** Large suggestion arrays can exhaust memory in serverless functions. Keep suggestions as a flat array, never as nested nested objects.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting before Claude call | Manual character count heuristic | `client.messages.countTokens()` | SDK method returns exact token count per model's tokenizer; character heuristics can be off by 30-50% |
| Structured JSON from Claude | Regex-based response parsing | System prompt "return only JSON" or tool_use | LLMs reliably produce clean JSON when instructed; regex breaks on edge cases |
| Parallel rate-limited requests | Custom rate limiter class | `Promise.allSettled` with fixed batch size | Batch size of 5 is the built-in rate limiter; no library needed |
| Dependency graph analysis | Graph algorithm library | String matching on formula text | Anaplan formulas reference modules by exact name; simple string includes() is sufficient and adds no dependencies |
| Claude response streaming per-call | Manual ReadableStream handling per Haiku call | Non-streaming `client.messages.create()` | Per-module suggestions are short (< 500 tokens output); non-streaming is simpler and faster for short responses. SSE to browser is separate. |

**Key insight:** The complexity in this phase is orchestration, not any individual library call. Each piece (countTokens, messages.create, fetch, allSettled) is a single call. The hard part is sequencing them correctly within the 60-second budget.

---

## Common Pitfalls

### Pitfall 1: All Haiku Calls Exceed 60-Second Budget

**What goes wrong:** Analysis times out at Vercel's maxDuration=60s. The SSE connection drops. The user sees a partial or no result.

**Why it happens:** 228 modules × 3s/call = 684s. Even 100 active modules × 3s = 300s. Batching helps but is not sufficient alone — module filtering is also required.

**How to avoid:**
1. Skip modules with `fetchError`, 0 line items, or < 3 line items (no meaningful analysis possible)
2. Use BATCH_SIZE=5 with `Promise.allSettled` — 5 parallel Haiku calls per batch
3. Check elapsed time before each batch; emit `partial-analysis` and break at 45s
4. Reserve 15s minimum for Sonnet calls

**Warning signs:** Vercel logs show 504 or client-closed (499). SSE stream ends without a `complete` event.

### Pitfall 2: Haiku Returns Malformed JSON

**What goes wrong:** `JSON.parse(haikuResponse)` throws. The batch handler throws. The `Promise.allSettled` catches it and the module produces an empty suggestions array — or worse, the outer try/catch triggers an `error` SSE event and terminates the stream.

**Why it happens:** Haiku sometimes wraps JSON output in markdown code fences (```json...```) despite instructions not to.

**How to avoid:**
```javascript
function parseHaikuSuggestions(text) {
  // Strip markdown fences if present
  const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // Graceful degradation — no suggestions for this module
  }
}
```

**Warning signs:** Console logs show JSON parse errors. Suggestion count is 0 across many modules where issues were expected.

### Pitfall 3: Blob Fetch Fails Silently

**What goes wrong:** `fetch(blobUrl)` succeeds (200) but `bpRes.json()` fails because the Blob content is not valid JSON (e.g., partial write from Phase 3 error path).

**Why it happens:** If Phase 3 had a partial error, the Blob may have been written with incomplete JSON.

**How to avoid:**
```javascript
const bpRes = await fetch(blobUrl);
if (!bpRes.ok) throw new Error(`Blob fetch failed: ${bpRes.status}`);
const blueprint = await bpRes.json().catch(() => { throw new Error('Blueprint Blob is not valid JSON'); });
if (!blueprint.modules || !Array.isArray(blueprint.modules)) {
  throw new Error('Blueprint Blob is missing modules array');
}
```

**Warning signs:** Error event with "Blueprint Blob is not valid JSON" message.

### Pitfall 4: Sonnet Synthesis Receives Duplicate or Missing Fields

**What goes wrong:** The `sonnet-complete` SSE event payload is missing `dimensions` or `verdict`, causing the frontend to crash when accessing `result.dimensions.structure`.

**Why it happens:** Sonnet occasionally omits fields from a JSON response if the schema is under-specified in the prompt.

**How to avoid:** Validate the Sonnet response against expected shape before emitting the SSE event. Provide defaults for any missing numeric fields:

```javascript
function normalizeSynthesis(raw) {
  const dims = raw.dimensions || {};
  return {
    healthScore: typeof raw.healthScore === 'number' ? raw.healthScore : 50,
    verdict: ['Good','Needs Work','Critical'].includes(raw.verdict) ? raw.verdict : 'Needs Work',
    summary: raw.summary || 'Analysis complete.',
    dimensions: {
      structure: dims.structure ?? 50,
      formula: dims.formula ?? 50,
      bestPractice: dims.bestPractice ?? 50,
      naming: dims.naming ?? 50,
      performance: dims.performance ?? 50,
    },
  };
}
```

**Warning signs:** Frontend JavaScript errors accessing undefined properties of the sonnet-complete payload.

### Pitfall 5: vercel.json Missing api/analyze.js Entry

**What goes wrong:** `api/analyze.js` runs with Vercel's default 10-second maxDuration. Analysis always times out.

**Why it happens:** `vercel.json` currently lists `api/blueprint.js` at 60s but does not have an entry for `api/analyze.js` (that file doesn't exist yet). [VERIFIED: `/tmp/meridian-anaplan/vercel.json`]

**How to avoid:** Wave 0 of Phase 4 must add `"api/analyze.js": { "maxDuration": 60 }` to the `functions` block in `vercel.json` before any analysis code runs.

**Warning signs:** Vercel function logs show 10-second timeout. The STATE.md note says `api/analyze.js maxDuration must be 60s` — this is not yet in `vercel.json`.

### Pitfall 6: sessionStorage Key Mismatch

**What goes wrong:** Client-side JS reads `sessionStorage.getItem('meridian.blueprintBlobUrl')` but Phase 3's `complete` event stored it under a different key. The `blobUrl` sent to `/api/analyze` is null or undefined.

**Why it happens:** The key name was specified in STATE.md locked decisions but may not match what Phase 3's client-side JS actually wrote to sessionStorage.

**How to avoid:** Phase 4 Wave 0 must verify the exact sessionStorage key written by the Phase 3 client-side `complete` event handler in `index.html` before writing the `/api/analyze` request code.

**Warning signs:** `/api/analyze` receives `blobUrl: null` or `blobUrl: undefined`. The 400 response "Missing blobUrl" appears in browser network tab.

---

## Code Examples

Verified patterns from the installed codebase:

### countTokens() — Exact SDK Call

```javascript
// Source: [VERIFIED: node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts line 93]
// Returns: APIPromise<{ input_tokens: number }>
const tokenCount = await client.messages.countTokens({
  model: 'claude-haiku-4-5-20251001',
  messages: [{ role: 'user', content: promptText }],
  system: systemPromptText,   // optional
});
// tokenCount.input_tokens is the count
if (tokenCount.input_tokens > 180_000) {
  throw new Error(`Token limit exceeded: ${tokenCount.input_tokens}`);
}
```

### messages.create() — Same Pattern as generate.js

```javascript
// Source: [VERIFIED: api/generate.js lines 29-35]
const message = await client.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 1024,
  messages: [{ role: 'user', content: promptText }],
  system: systemPromptText,
});
const responseText = message.content?.[0]?.text || '';
```

### vercel.json — Required Addition (Wave 0)

```json
// Source: [VERIFIED: /tmp/meridian-anaplan/vercel.json]
// Add this entry to the existing functions{} block:
"api/analyze.js": { "maxDuration": 60 }
```

### ExtractionSummary — Field Stripping

```javascript
// Source: derived from blueprint schema [VERIFIED: 03-01-SUMMARY.md sampleLineItemKeys from live COPS Demo]
// Fields confirmed present: moduleId, moduleName, id, name, format, formatMetadata, summary,
// appliesTo, timeScale, timeRange, version, style, cellCount, notes, isSummary, formulaScope,
// useSwitchover, breakback, broughtForward, startOfSection, formula

// KEEP: name, formula, format, summary, appliesTo (→ dimensions[]), notes
// DROP: id, formatMetadata, timeScale, timeRange, version, style, cellCount,
//       isSummary, formulaScope, useSwitchover, breakback, broughtForward,
//       startOfSection, moduleId, moduleName (redundant at module level)
```

---

## Token Budget Analysis

**Model context windows (verified from installed SDK type definitions):**
- Haiku 4.5 (`claude-haiku-4-5-20251001`): 200K input context [ASSUMED — SDK type defs do not list context window; this is Anthropic's documented limit for Haiku 4.5]
- Sonnet 4.6 (`claude-sonnet-4-6`): 200K input context [ASSUMED]

**Per-module Haiku call budget:**

| Component | Estimated Tokens |
|-----------|-----------------|
| System prompt | ~80 |
| Module name + count | ~20 |
| Line items (10 avg, compact format) | ~300 |
| Instructions | ~120 |
| **Total input** | **~520 tokens** |
| Max output (suggestions JSON) | 512 |
| countTokens() call overhead | ~20ms |

**Sonnet synthesis call budget:**

| Component | Estimated Tokens |
|-----------|-----------------|
| System prompt | ~80 |
| 228 module one-liners | ~1,500 |
| Issue count summary | ~100 |
| Instructions + schema | ~200 |
| **Total input** | **~1,880 tokens** |
| Max output | 512 |

**Sonnet narrative call budget:**

| Component | Estimated Tokens |
|-----------|-----------------|
| System prompt | ~80 |
| Dependency graph (228 modules × ~50 tokens) | ~11,400 |
| Instructions | ~200 |
| **Total input** | **~11,680 tokens** |
| Max output | 2048 |

All three are comfortably under 180K. The pre-flight `countTokens()` call validates the actual count before every call. [ASSUMED: token estimates; countTokens() is the authoritative check]

---

## Runtime State Inventory

This is a greenfield feature phase (new `api/analyze.js` file). No rename/refactor/migration. No runtime state inventory required.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `ANTHROPIC_API_KEY` env var | All Claude calls | Configured in Vercel dashboard (per STATE.md todos) | — | Function returns 500 if missing; Wave 0 must validate |
| `@anthropic-ai/sdk` | All Claude calls | ✓ (installed) | 0.95.1 | — |
| `@vercel/blob` | Blueprint fetch (Blob URL is public, uses plain fetch()) | ✓ (installed) | 2.3.3 | — |
| Node.js fetch() | Blob fetch | ✓ (Node >= 18) | Built-in | — |
| `api/analyze.js` entry in vercel.json | 60s maxDuration | ✗ — NOT in vercel.json yet | — | Default 10s = always timeout; Wave 0 must add |

[VERIFIED: `vercel.json` has no `api/analyze.js` entry — confirmed by reading file]
[VERIFIED: `package.json` has both SDK packages at correct versions]

**Missing dependencies with no fallback:**
- `api/analyze.js` maxDuration must be added to `vercel.json` in Wave 0 — without this, every analysis call times out at 10s

**Missing dependencies with fallback:**
- None

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Haiku 4.5 context window is 200K tokens | Token Budget Analysis | If lower, countTokens() pre-flight will catch it but batch sizes may need reduction |
| A2 | Each Haiku per-module call completes in ~2-4 seconds on average | Pitfall 1; batch size rationale | If Haiku calls take 6-8s, 5-module batches take 30-40s, leaving < 20s for Sonnet — need to reduce batch parallelism or skip more modules |
| A3 | countTokens() does not count against Anthropic rate limits or billing | Pattern 4 | If countTokens() is billed, adding a pre-flight to every call doubles the number of API hits and could trigger rate limits |
| A4 | Anthropic rate limit for Haiku 4.5 allows 5 simultaneous requests without throttling | Batch size | If Anthropic throttles at < 5 concurrent, 429 errors will appear; reduce BATCH_SIZE to 3 |
| A5 | Formula text references other module names by exact string (e.g., `TRK01.Revenue`) — enabling simple string matching for dependency detection | Pattern 7 dependency extraction | If Anaplan uses internal IDs rather than names in formula text, dependency detection will produce empty graphs and the narrative will lack cross-module context |
| A6 | sessionStorage key for blobUrl is `meridian.blueprintBlobUrl` (from STATE.md locked decisions) | Pitfall 6 | If Phase 3 client-side code wrote to a different key, the analyze call receives null blobUrl; Wave 0 must verify |
| A7 | Tool_use or plain JSON system prompt is sufficient to force structured JSON output from Haiku without markdown fences | Pattern 5 | If Haiku wraps output in fences, parseHaikuSuggestions() strips them — mitigation is in place |

---

## Open Questions (RESOLVED)

1. **Haiku concurrency and rate limits** — RESOLVED: BATCH_SIZE=5 chosen. Plan 01 Task 2 implements `HAIKU_BUDGET_MS=45_000` time-budget guard: if elapsed > 45s before all batches complete, emit `partial-analysis` and proceed to Sonnet synthesis. 429s handled by `Promise.allSettled` — individual module failures produce empty suggestions, not stream termination.

2. **Narrative prompt: single Sonnet call vs separate** — RESOLVED: Two separate calls kept (synthesis call then narrative call), matching STATE.md locked decisions. Both are short prompts (~1,600 and ~11,680 tokens respectively) so two × ~10s = ~20s total, within the 15s reserve budget.

3. **sessionStorage key name for blobUrl** — RESOLVED: Key confirmed as `'meridian.blueprintBlobUrl'` (flat string with dot) by grepping Phase 3 client-side code in `index.html`. Plan 02 Task 2 reads `sessionStorage.getItem('meridian.blueprintBlobUrl')` directly.

---

## Validation Architecture

`nyquist_validation` is absent from `.planning/config.json` — treated as enabled. [VERIFIED: config.json has no `nyquist_validation` key]

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (inherited from Phase 3 research; consistent with anaplan-mcp codebase) |
| Config file | `vitest.config.ts` (Wave 0: create if absent — none found in project root) |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ANLZ-01 | `normalizeSynthesis()` returns valid healthScore, verdict, dimensions with defaults | Unit | `npx vitest run tests/analyze-synthesis.test.js -t "normalizeSynthesis defaults"` | ❌ Wave 0 |
| ANLZ-01 | Verdict thresholds: ≥75 → Good, 50-74 → Needs Work, <50 → Critical | Unit | `npx vitest run tests/analyze-synthesis.test.js -t "verdict thresholds"` | ❌ Wave 0 |
| ANLZ-01 | `sonnet-complete` SSE event contains all 5 dimension scores | Unit (mock client) | `npx vitest run tests/analyze-sse.test.js -t "sonnet-complete event shape"` | ❌ Wave 0 |
| ANLZ-02 | `parseHaikuSuggestions()` handles markdown-fenced JSON | Unit | `npx vitest run tests/analyze-haiku.test.js -t "parseHaikuSuggestions strips fences"` | ❌ Wave 0 |
| ANLZ-02 | `parseHaikuSuggestions()` returns [] on malformed JSON | Unit | `npx vitest run tests/analyze-haiku.test.js -t "parseHaikuSuggestions malformed"` | ❌ Wave 0 |
| ANLZ-02 | `haiku-progress` events fire once per module (including skipped modules) | Unit (mock client) | `npx vitest run tests/analyze-sse.test.js -t "haiku-progress per module"` | ❌ Wave 0 |
| ANLZ-03 | `extractModule()` drops id, formatMetadata, timeScale, timeRange, version, style, cellCount, isSummary, formulaScope, useSwitchover, breakback, broughtForward, startOfSection | Unit | `npx vitest run tests/analyze-extraction.test.js -t "extraction drops banned fields"` | ❌ Wave 0 |
| ANLZ-03 | `extractModule()` keeps name, formula, format, summary, dimensions[], notes | Unit | `npx vitest run tests/analyze-extraction.test.js -t "extraction keeps signal fields"` | ❌ Wave 0 |
| ANLZ-03 | `guardTokens()` throws when input_tokens > 180000 | Unit (mock countTokens) | `npx vitest run tests/analyze-extraction.test.js -t "guardTokens rejects over-budget"` | ❌ Wave 0 |
| ANLZ-04 | `detectDependencies()` correctly identifies receives-from when formula contains module name | Unit | `npx vitest run tests/analyze-narrative.test.js -t "detectDependencies formula match"` | ❌ Wave 0 |
| ANLZ-04 | `detectDependencies()` populates sendsTo on the referenced module | Unit | `npx vitest run tests/analyze-narrative.test.js -t "detectDependencies sendsTo"` | ❌ Wave 0 |
| ANLZ-04 | `narrative-complete` event contains story and moduleNotes keyed by moduleId | Unit (mock client) | `npx vitest run tests/analyze-sse.test.js -t "narrative-complete event shape"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/analyze-*.test.js`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/analyze-extraction.test.js` — covers ANLZ-03 field stripping, guardTokens
- [ ] `tests/analyze-haiku.test.js` — covers ANLZ-02 parseHaikuSuggestions, malformed JSON
- [ ] `tests/analyze-synthesis.test.js` — covers ANLZ-01 normalizeSynthesis, verdict thresholds
- [ ] `tests/analyze-narrative.test.js` — covers ANLZ-04 detectDependencies
- [ ] `tests/analyze-sse.test.js` — covers SSE event shapes for all four event types
- [ ] `tests/fixtures/blueprint-cops-demo-sample.json` — minimal BlueprintDocument fixture (3 modules, 10 line items each) representing COPS Demo schema
- [ ] `vitest.config.ts` — verify exists in project root; create if absent
- [ ] `vercel.json` — add `"api/analyze.js": { "maxDuration": 60 }` to functions block (Wave 0, not a test file but a blocking prerequisite)

---

## Sources

### Primary (HIGH confidence)

- `/tmp/meridian-anaplan/api/blueprint.js` — SSE handler pattern, sendEvent(), flushHeaders placement, BATCH_SIZE, Promise.allSettled, fetchError sentinel [VERIFIED]
- `/tmp/meridian-anaplan/api/generate.js` — `client.messages.create()` call pattern, model ID `claude-haiku-4-5-20251001` [VERIFIED]
- `/tmp/meridian-anaplan/node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts` — `countTokens()` signature, `MessageTokensCount.input_tokens`, full Model type union [VERIFIED]
- `/tmp/meridian-anaplan/vercel.json` — confirms `api/analyze.js` not yet listed; `api/blueprint.js` at 60s [VERIFIED]
- `/tmp/meridian-anaplan/package.json` — `@anthropic-ai/sdk@0.95.1`, `@vercel/blob@2.3.3` pinned [VERIFIED]
- `.planning/phases/03-blueprint/03-01-SUMMARY.md` — confirmed live COPS Demo schema fields from `sampleLineItemKeys` [VERIFIED]
- `.planning/STATE.md` — locked decisions: two-model strategy, extraction pre-pass, SSE pattern, ESM, Blob URL path [VERIFIED]

### Secondary (MEDIUM confidence)

- `.planning/phases/03-blueprint/03-RESEARCH.md` — `BlueprintDocument` shape, `AnaplanLineItem` fields, SSE architecture patterns (all derived from same Phase 3 research) [CITED]
- `.planning/REQUIREMENTS.md` — ANLZ-01 through ANLZ-04 exact requirement text [VERIFIED]

### Tertiary (LOW confidence)

- A1–A7 assumptions in Assumptions Log — based on training knowledge of Anthropic API behavior, not re-verified in this session

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — both packages verified from installed node_modules + package.json
- Architecture patterns: HIGH — SSE pattern is a direct port of confirmed Phase 3 implementation; Claude SDK calls verified from installed type definitions
- Token budgets: MEDIUM — estimates are derived from COPS Demo schema field sizes; countTokens() pre-flight is the authoritative runtime check
- Pitfalls: HIGH — most derived from verified code constraints (vercel.json missing entry, JSON parse failure modes, budget arithmetic)

**Research date:** 2026-05-11
**Valid until:** 2026-06-11 (SDK at pinned version; Anthropic API model IDs stable; Vercel function timeout behavior stable)
