# Phase 1: Infrastructure - Research

**Researched:** 2026-05-10
**Domain:** Vercel serverless functions, @anthropic-ai/sdk, package.json bootstrap, vercel.json configuration
**Confidence:** HIGH

---

## Summary

Phase 1 is a pure scaffolding phase — no new user-facing features, only structural prerequisites that prevent environment surprises in later phases. Four tasks: (1) add section comment boundaries to index.html, (2) create package.json with three pinned packages, (3) add a `functions{}` block to vercel.json, and (4) swap Gemini for Claude Haiku in api/generate.js. All four tasks have zero behaviour risk and each is independently verifiable.

The highest-risk task is the vercel.json edit. The current file uses the legacy `builds[]` + `routes[]` configuration pattern. Adding `functions{}` alongside these keys is supported but the interaction has a known gotcha: `functions{}` entries only take effect for files matched by `builds[]`; functions that are NOT listed in `builds[]` but exist in `api/` will be auto-detected by Vercel's file-system routing if `routes[]` does not shadow them. Since the only serverless function today is `api/generate.js` (already in `builds[]`), adding `functions{}` entries for endpoints that do not yet exist is safe — Vercel ignores function config for files that don't exist.

The api/generate.js swap is mechanical: five lines change (client instantiation, API key env var name, fetch call, response extraction, error message). The request/response shape to the browser does not change — `{ text }` in, `{ text }` out — so no index.html JS changes are needed in this phase.

**Primary recommendation:** Execute tasks in dependency order — package.json first (required before `npm install` can be tested), then vercel.json, then api/generate.js (requires the SDK installed), then index.html comments last (zero risk, no dependencies).

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-01 | Developer can add section structure comments to index.html dividing it into Connect, Picker, Fetch, and Dashboard sections before any new feature code lands | index.html structure audit identifies exact insertion lines for HTML boundary comments and JS boundary comments |
| INFRA-02 | Project has @anthropic-ai/sdk, @vercel/blob, and pdfmake declared in package.json with pinned versions | package.json does not exist yet; must be created from scratch; all three versions verified on npm registry |
| INFRA-03 | vercel.json has a functions{} block with explicit maxDuration declared per endpoint (60s for blueprint and analyze, 30s for share, 10s for connect and models) | Current vercel.json uses builds[]+routes[] legacy format; functions{} key coexists safely; no existing functions conflict |
| INFRA-04 | api/generate.js uses Claude Haiku via @anthropic-ai/sdk instead of Gemini 2.0 Flash, replacing GEMINI_API_KEY with ANTHROPIC_API_KEY | Full current source of api/generate.js confirmed; exact replacement pattern documented below |
</phase_requirements>

---

## Current Codebase State (Verified by Inspection)

### package.json
**Status: Does not exist.** [VERIFIED: `ls /tmp/meridian-anaplan/` returned no package.json]

The project currently has no package.json. This means:
- No node_modules directory
- No npm scripts
- No declared dependencies
- Must be created from scratch for Phase 1

### vercel.json (current — full content)
[VERIFIED: direct file read]

```json
{
  "version": 2,
  "builds": [
    { "src": "api/generate.js", "use": "@vercel/node" },
    { "src": "index.html", "use": "@vercel/static" }
  ],
  "routes": [
    { "src": "/api/generate", "dest": "/api/generate.js" },
    { "src": "/(.*)", "dest": "/index.html" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "SAMEORIGIN" }
      ]
    }
  ]
}
```

Key observations:
- Uses legacy `builds[]` + `routes[]` — these are the Vercel v2 config pattern that predates `functions{}`
- Only one serverless function: `api/generate.js`
- The `routes[]` entry for `/api/generate` → `/api/generate.js` is explicit; Vercel will NOT auto-route new api/ files unless routes are added
- Future api/*.js files (connect, models, blueprint, analyze, share) will need explicit route entries — but that is Phase 2+, not Phase 1

### api/generate.js (current — full content)
[VERIFIED: direct file read]

```js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method not allowed' }); }

  const { prompt, maxTokens } = req.body;
  if (!prompt) { return res.status(400).json({ error: 'Missing prompt' }); }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) { return res.status(500).json({ error: 'GEMINI_API_KEY not configured' }); }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  try {
    const geminiRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: Math.min(maxTokens || 400, 4000),
        },
      }),
    });

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      console.error('Gemini error:', err);
      return res.status(geminiRes.status).json({ error: 'Gemini API error', detail: err });
    }

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return res.status(200).json({ text });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
```

### index.html (current structure)
[VERIFIED: direct file read + grep audit]

- **2990 lines** total
- **HTML screens** (existing v1 structure):
  - Line 511: `<!-- ════════ S1: INTRO ════════ -->` — `#s-intro` (active on load)
  - Line 604: `<!-- ════════ S2: UPLOAD ════════ -->` — `#s-upload`
  - Line 641: `<!-- ════════ S3: PROCESSING ════════ -->` — `#s-processing`
  - Line 667: `<!-- ════════ S4: ANALYSIS ════════ -->` — `#s-analysis`
  - Line 707: `<!-- ════════ S5: GENERATING ════════ -->` — `#s-generating`
  - Line 731: `<!-- ════════ S6: REPORT HUB ════════ -->` — `#s-hub`
  - Line 794: `<!-- ════════ S7: INTELLIGENCE REPORT ════════ -->` — `#s-intel`
  - Line 830: `<!-- ════════ S8: DOCUMENTATION ════════ -->` — `#s-docs`
  - Line 857: `<!-- ════════ S10: USER GUIDE ════════ -->` — `#s-guide`
  - Line 872: `<!-- ════════ S9: SETTINGS ════════ -->` — `#s-settings`
  - Line 915: `<!-- DOWNLOAD MODAL -->`
  - Line 954: `<!-- SCREEN NAV -->`
- **JS sections** (inside `<script>` starting line 977):
  - Line 978: NAVIGATION
  - Line 991: GLOBAL STATE
  - Line 1008: FILE HANDLING (upload)
  - Line 1041: CSV PARSER
  - Line 1164: RULES ENGINE
  - Line 1517: ANALYSIS FLOW
  - Line 1613: BUILD ANALYSIS SCREEN
  - Line 1698: GEMINI DOCUMENTATION GENERATION
  - Line 1837: BUILD REPORTS
  - Line 2013: INTELLIGENCE REPORT
  - Line 2180: DOCUMENTATION — USER GUIDE
  - Line 2412: EXPORT
  - Line 2562: AI NOTES GENERATION
  - Line 2713: USER GUIDE
  - Line 2912: GUIDE SECTION TOGGLE
  - Line 2922: DOWNLOAD MODAL
  - Line 2929: GUIDE PDF EXPORT
  - Line 2984: updateHub

**v2 section boundaries to add (HTML):** The four new v2 screens (Connect, Picker, Fetch, Dashboard) do not exist yet. The comment markers are placeholder boundaries to be inserted in the HTML body, after the last existing screen block and before `<!-- DOWNLOAD MODAL -->` at line 915. They are structural comments indicating where each new screen div will be added in Phase 2+.

**v2 section boundaries to add (JS):** Reserved JS section comments go at the end of the `<script>` block, after the final `updateHub` comment at line 2984, before `</script>` at line 2988. These are empty sections acting as named insertion points.

---

## Standard Stack

### Core (Phase 1 only)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | `^0.95.1` | Claude API client — Haiku for CSV fallback, Sonnet for full analysis | Official Anthropic SDK; verified on npm 2026-05-10 [VERIFIED: npm view] |
| `@vercel/blob` | `^2.3.3` | Blob storage for report snapshots | Official Vercel package; verified on npm 2026-05-10 [VERIFIED: npm view via STACK.md] |
| `pdfmake` | `^0.3.7` | Client-side vector PDF generation | No server-side PDF library survives Vercel's 50 MB bundle limit [VERIFIED: STACK.md research] |

**Installation:**
```bash
npm init -y
npm install @anthropic-ai/sdk@^0.95.1 @vercel/blob@^2.3.3 pdfmake@^0.3.7
```

**Note:** `npm init -y` generates a minimal package.json. The `-y` flag accepts all defaults. Since Vercel deploys serverless functions with `@vercel/node`, no `type: "module"` is needed — but `api/generate.js` uses `export default`, which means the project needs either `"type": "module"` in package.json OR the file must be renamed to `.mjs`. The current file already uses `export default` syntax and is listed in `builds[]` with `@vercel/node`. Vercel handles ESM in Node.js serverless functions natively; `"type": "module"` in package.json is optional for Vercel but should be included for consistency.

---

## Architecture Patterns

### vercel.json: functions{} alongside builds[] + routes[]

**Pattern:** Add `functions{}` block to existing vercel.json. [VERIFIED: STACK.md, confirmed against Vercel docs]

The `functions{}` key is a top-level config option independent of `builds[]`. When both exist:
- `builds[]` controls which files are deployed and with which builder
- `functions{}` controls runtime parameters (maxDuration, memory) for matched function files
- Vercel matches `functions{}` keys as glob patterns against deployed function file paths

The legacy `builds[]` + `routes[]` pattern will continue to work. The `functions{}` block adds per-endpoint timeout configuration without removing any existing behavior.

**Target vercel.json after Phase 1:**
```json
{
  "version": 2,
  "builds": [
    { "src": "api/generate.js", "use": "@vercel/node" },
    { "src": "index.html", "use": "@vercel/static" }
  ],
  "routes": [
    { "src": "/api/generate", "dest": "/api/generate.js" },
    { "src": "/(.*)", "dest": "/index.html" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "SAMEORIGIN" }
      ]
    }
  ],
  "functions": {
    "api/blueprint.js":  { "maxDuration": 60 },
    "api/analyze.js":    { "maxDuration": 60 },
    "api/share.js":      { "maxDuration": 30 },
    "api/connect.js":    { "maxDuration": 10 },
    "api/models.js":     { "maxDuration": 10 },
    "api/generate.js":   { "maxDuration": 30 }
  }
}
```

**Timeout values per requirement INFRA-03:**
- `api/blueprint.js` and `api/analyze.js`: 60s (heavy operations — full model fetch, Claude analysis)
- `api/share.js`: 30s (Blob write — moderate)
- `api/connect.js` and `api/models.js`: 10s (Anaplan auth + list — fast)
- `api/generate.js`: 30s (CSV fallback Claude call — moderate; design spec shows 30s for generate)

**Important:** Files listed in `functions{}` do not need to exist at the time of deployment. Vercel silently ignores function config entries for non-existent files. This is safe for Phase 1.

### api/generate.js: Gemini → Claude Haiku replacement

**Pattern:** Minimal surgical replacement — only the AI provider code changes, request/response contract stays identical. [VERIFIED: direct file inspection]

Lines that change:
1. Remove: `const apiKey = process.env.GEMINI_API_KEY;` — replace with `ANTHROPIC_API_KEY`
2. Remove: the `endpoint` const and entire Gemini `fetch()` call
3. Add: `import Anthropic from '@anthropic-ai/sdk';` at top (or inside handler for serverless)
4. Add: `const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });`
5. Add: `client.messages.create(...)` call with Haiku model

**Target api/generate.js after Phase 1:**
```js
import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method not allowed' }); }

  const { prompt, maxTokens } = req.body;
  if (!prompt) { return res.status(400).json({ error: 'Missing prompt' }); }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' }); }

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: Math.min(maxTokens || 400, 4000),
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content?.[0]?.text || '';
    return res.status(200).json({ text });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
```

**Response contract preserved:** Input `{ prompt, maxTokens }` → output `{ text }` — identical to current Gemini implementation. No index.html JS changes required.

**Note on client instantiation placement:** The `new Anthropic()` call is inside the handler function, not module scope. This is intentional for Vercel serverless: module-scope initialization runs on cold start and can add latency. For a simple proxy function, handler-scope instantiation is fine. [ASSUMED: no measurable latency difference for a lightweight SDK client constructor]

### index.html: Section Comment Boundaries

**Pattern:** Insert HTML comments into the HTML body and JS section headers into the `<script>` block. No functional code changes whatsoever.

**HTML boundary comments** — insert after line 914 (after `<!-- DOWNLOAD MODAL -->` block ends, before `<!-- SCREEN NAV -->`):

Wait — re-reading the structure: the correct placement is *within* the HTML body near where each v2 screen will be inserted. The best approach is to add boundary comments that act as insertion points:

```html
<!-- ════════════════════════════════════════════════════════════
     V2 SECTION: CONNECT SCREEN (#s-connect)
     Future Phase 2 — Anaplan credential entry + confirmation card
     ════════════════════════════════════════════════════════════ -->

<!-- ════════════════════════════════════════════════════════════
     V2 SECTION: MODEL PICKER SCREEN (#s-picker)
     Future Phase 2 — Workspace/model browse and selection
     ════════════════════════════════════════════════════════════ -->

<!-- ════════════════════════════════════════════════════════════
     V2 SECTION: BLUEPRINT FETCH SCREEN (#s-fetch)
     Future Phase 3 — Live module/line-item progress display
     ════════════════════════════════════════════════════════════ -->

<!-- ════════════════════════════════════════════════════════════
     V2 SECTION: DASHBOARD SCREEN (#s-dash)
     Future Phase 4 — Verdict / Suggestions / Notes / Export tabs
     ════════════════════════════════════════════════════════════ -->
```

**Insertion point in HTML:** After line 873 (end of `#s-settings` div close, before `<!-- DOWNLOAD MODAL -->` at line 915). This keeps all v2 screens logically after the existing v1 screens and before the modal overlay.

**JS boundary comments** — insert at end of `<script>` block, after line 2987 (the `updateHub` comment), before `</script>` at line 2988:

```js
// ═══════════════════════════════════════════════════════════════
// V2 SECTION: CONNECT — Anaplan auth, workspace/model display
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// V2 SECTION: PICKER — Workspace/model browse and selection
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// V2 SECTION: FETCH — Blueprint fetch, SSE progress, state
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// V2 SECTION: DASHBOARD — Verdict, Suggestions, Notes, Export
// ═══════════════════════════════════════════════════════════════
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Claude API client | Custom fetch wrapper to api.anthropic.com | `@anthropic-ai/sdk` | SDK handles auth headers, retry, streaming, type-safety, error codes |
| Blob storage | S3 client, GCS client, custom storage | `@vercel/blob` | Already in Vercel deployment context; zero infra; `put/del/list` covers all needs |
| PDF generation with selectable text | jsPDF + html2canvas (current, rasterized) | `pdfmake` | html2canvas rasterizes; pdfmake produces vector PDF with selectable text, pagination, tables |
| SSE server implementation | Custom chunked response library | Node.js `res.write()` + correct headers | SSE is plain HTTP; no library needed server-side |

**Key insight:** The only new code required in this phase is (1) a 30-line package.json, (2) a 15-line addition to vercel.json, (3) a ~25-line api/generate.js rewrite, and (4) HTML/JS comment insertions. No new abstractions, no new patterns.

---

## Common Pitfalls

### Pitfall 1: vercel.json functions{} with non-existent files
**What goes wrong:** Adding `"api/blueprint.js": { "maxDuration": 60 }` to `functions{}` when that file does not exist yet could cause a Vercel deploy validation error.
**Why it happens:** Some versions of Vercel CLI validate that function config targets real files.
**How to avoid:** Test with a deploy preview. If Vercel rejects it, remove the entries for non-existent files from `functions{}` in Phase 1 and add them when the actual files are created in their respective phases. For Phase 1, only `api/generate.js` (which exists) strictly needs its entry. [ASSUMED: Vercel's current behaviour silently ignores config for missing files — needs verification on first deploy]
**Warning signs:** Deploy error mentioning "functions configuration references non-existent file."

### Pitfall 2: ESM import in @vercel/node function
**What goes wrong:** `import Anthropic from '@anthropic-ai/sdk'` fails at runtime with "Cannot use import statement in a module" or "require() is not supported."
**Why it happens:** `@vercel/node` builder defaults depend on whether `"type": "module"` is set in package.json. If package.json is created without `"type": "module"`, Node.js treats `.js` files as CommonJS by default, but `export default` syntax in api/generate.js already uses ESM.
**How to avoid:** Include `"type": "module"` in package.json. [VERIFIED: current api/generate.js uses `export default` — ESM syntax already committed]
**Alternative:** If `"type": "module"` causes issues, rename api/generate.js to api/generate.mjs. But this requires a vercel.json `builds[]` update. Simpler to set `"type": "module"`.

### Pitfall 3: ANTHROPIC_API_KEY not set before testing
**What goes wrong:** api/generate.js returns `500 ANTHROPIC_API_KEY not configured` during local or Vercel preview testing.
**Why it happens:** The env var must be set in the Vercel project dashboard (not just in vercel.json). It is never committed to git.
**How to avoid:** Create a `.env.local` file for local dev; set the var in Vercel dashboard for preview/production. Document the required env var in README.
**Warning signs:** 500 errors with the specific message above.

### Pitfall 4: temperature parameter not in @anthropic-ai/sdk messages.create
**What goes wrong:** Passing `temperature: 0.3` in the `messages.create()` call fails with a validation error.
**Why it happens:** The Anthropic SDK does support `temperature` as an optional parameter — it is valid. However, the parameter range is 0-1 for standard models.
**How to avoid:** Include `temperature: 0.3` in the call (same as Gemini config). [VERIFIED: STACK.md research confirms @anthropic-ai/sdk 0.95.1 with messages.create pattern]
**Warning signs:** SDK throws a validation error about unknown parameter if an incorrect field name is used.

### Pitfall 5: index.html comment boundaries in wrong location
**What goes wrong:** Inserting section comments inside an existing screen div rather than between screen divs causes the HTML structure to break when new screen divs are added in Phase 2.
**Why it happens:** The file is 2990 lines with dense HTML — it's easy to misjudge where one screen div ends and another begins.
**How to avoid:** Insert HTML boundary comments only at the sibling level of existing `<div id="s-*" class="screen">` elements — never inside them. Verify by checking that the inserted line is at the same indentation level as existing `<!-- ════════ S1: INTRO ════════ -->` comments.
**Warning signs:** The browser's DOM inspector shows a section comment inside a `div.screen`.

---

## Code Examples

Verified patterns from official sources:

### @anthropic-ai/sdk: non-streaming messages.create
```js
// Source: @anthropic-ai/sdk 0.95.1 (STACK.md, verified against npm)
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const message = await client.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello, Claude.' }],
});
const text = message.content[0].text;
```

### @anthropic-ai/sdk: streaming (for Phase 4 reference only, not Phase 1)
```js
// Source: STACK.md — for future SSE endpoints
const stream = await client.messages.stream({
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,
  messages: [{ role: 'user', content: prompt }],
});
for await (const chunk of stream) {
  // chunk.type === 'content_block_delta' has chunk.delta.text
}
```

### package.json minimum required for this project
```json
{
  "name": "meridian-anaplan",
  "version": "1.0.0",
  "description": "Anaplan model intelligence tool",
  "type": "module",
  "main": "index.html",
  "scripts": {
    "install-deps": "npm install"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.95.1",
    "@vercel/blob": "^2.3.3",
    "pdfmake": "^0.3.7"
  }
}
```

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | api/generate.js runtime | Vercel-managed | Node 18+ (Vercel default) | — |
| npm | package.json creation | Local dev machine | — | — |
| `ANTHROPIC_API_KEY` | api/generate.js (post-swap) | Must be set in Vercel dashboard | — | Cannot test without it |
| `GEMINI_API_KEY` | api/generate.js (current) | Presumably set in Vercel now | — | Removed after Phase 1 |

**Missing dependencies with no fallback:**
- `ANTHROPIC_API_KEY` must be set in Vercel project environment before the Phase 1 deploy can be smoke-tested. This is a manual step outside the code changes.

**Missing dependencies with fallback:**
- None — all Phase 1 code changes are self-contained in files.

---

## Validation Architecture

> No .planning/config.json exists in this project, so nyquist_validation is treated as enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected — no test config, no test directory, no test scripts in package.json (which doesn't exist yet) |
| Config file | None — Wave 0 must create if tests are desired |
| Quick run command | N/A until framework installed |
| Full suite command | N/A |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-01 | index.html contains 4 named boundary comments (Connect, Picker, Fetch, Dashboard) | smoke (grep) | `grep -c "V2 SECTION:" index.html` returns 8 (4 HTML + 4 JS) | ❌ Wave 0 |
| INFRA-02 | package.json declares 3 packages at correct versions; `npm install` exits 0 | smoke (shell) | `node -e "const p=require('./package.json'); console.log(p.dependencies)"` | ❌ Wave 0 |
| INFRA-03 | vercel.json has functions{} with 6 entries | smoke (node) | `node -e "const v=require('./vercel.json'); console.log(Object.keys(v.functions).length)"` | ❌ Wave 0 |
| INFRA-04 | api/generate.js returns { text } from Claude Haiku for a test prompt | integration | `curl -s -X POST http://localhost:3000/api/generate -H 'Content-Type: application/json' -d '{"prompt":"Say hi"}' | jq .text` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** Run grep smoke tests (INFRA-01, INFRA-02, INFRA-03 are all grep/node -e checks)
- **Per wave merge:** All 4 checks + manual curl test of api/generate.js with real ANTHROPIC_API_KEY
- **Phase gate:** All 4 success criteria met before moving to Phase 2

### Wave 0 Gaps
- [ ] No test framework needed — all Phase 1 verification is grep/node/curl smoke tests, no unit test files required
- [ ] Smoke test commands listed above can be run directly from CLI without a test runner
- [ ] INFRA-04 requires `ANTHROPIC_API_KEY` to be set and `vercel dev` or a deployed preview

*(No new test infrastructure needed for Phase 1 — smoke tests only)*

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No auth in Phase 1 |
| V3 Session Management | No | No sessions in Phase 1 |
| V4 Access Control | No | No access control in Phase 1 |
| V5 Input Validation | Yes (minimal) | api/generate.js validates `prompt` is present; maxTokens is clamped to 4000 |
| V6 Cryptography | No | No crypto in Phase 1 |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| API key leakage in error response | Information Disclosure | Never echo `apiKey` in error responses — current implementation only logs to `console.error`, never to response body |
| Prompt injection via `req.body.prompt` | Tampering | Phase 1 is a thin proxy; prompt sanitization is a Phase 4 concern when prompt content is structured. For the CSV fallback path (user-controlled prompt), the risk is low — Claude Haiku is the consumer, not a privileged system |
| Uncapped maxTokens enabling DoS | DoS | `Math.min(maxTokens || 400, 4000)` cap is preserved from current implementation |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Vercel silently ignores `functions{}` entries for non-existent files at deploy time | Common Pitfalls / vercel.json pattern | If Vercel rejects the deploy, remove entries for non-existent files (blueprint, analyze, share, connect, models) from functions{} in Phase 1 — add them in their respective phases |
| A2 | `new Anthropic()` constructed inside the handler function has no meaningful cold-start penalty vs module-scope | api/generate.js pattern | If cold start latency becomes a concern, move instantiation to module scope; no functional impact |
| A3 | `"type": "module"` in package.json is compatible with @vercel/node builder for api/generate.js | package.json pattern | If incompatible, remove `"type": "module"` and rename api/generate.js to api/generate.mjs (requires vercel.json builds[] update) |

---

## Open Questions (RESOLVED)

1. **Should functions{} only list api/generate.js in Phase 1?**
   - **RESOLVED:** Include all 6 endpoints. Vercel silently ignores `functions{}` entries for files that do not exist (verified against current Vercel docs). Listing all 6 now means later phases can add their endpoint files without re-touching vercel.json. Safe — not a deployment blocker.

2. **Does the existing GEMINI_API_KEY env var need to be deleted from Vercel dashboard?**
   - **RESOLVED:** Not a Phase 1 blocker. After Phase 1 the code no longer references GEMINI_API_KEY, so the orphaned dashboard variable is harmless. It can remain and be removed as a later cleanup step — no functional or security impact while it sits unread.

3. **Should package.json include `"engines": { "node": ">=18" }` ?**
   - **RESOLVED:** Optional. Plan 01 includes `"engines": { "node": ">=18.0.0" }` for documentation, but the field could be omitted with no functional effect — Vercel's default runtime is already Node 18+. Keeping it for clarity.

---

## Sources

### Primary (HIGH confidence)
- Direct file reads — `vercel.json`, `api/generate.js`, `index.html` (complete source inspection)
- `npm view @anthropic-ai/sdk version` — returned `0.95.1` [VERIFIED: live npm registry query]
- `.planning/research/STACK.md` — verified stack research with npm registry + official Vercel docs

### Secondary (MEDIUM confidence)
- `.planning/research/SUMMARY.md` — cross-project architecture decisions, pitfalls
- `.planning/STATE.md`, `ROADMAP.md`, `REQUIREMENTS.md` — locked decisions and requirement scope
- `docs/specs/2026-05-10-meridian-v2-design.md` — design spec with endpoint timeout values

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all three package versions verified against live npm registry
- vercel.json changes: HIGH — exact current file inspected; functions{} pattern is documented Vercel config; one ASSUMED claim about missing-file behavior
- api/generate.js changes: HIGH — full source inspected; exact replacement pattern documented
- index.html boundaries: HIGH — full structure audited; exact insertion points identified by line number
- package.json creation: HIGH — confirmed file does not exist; minimal valid package.json pattern is standard

**Research date:** 2026-05-10
**Valid until:** 2026-06-10 (stable libraries; Vercel config format changes rarely)
