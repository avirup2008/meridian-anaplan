# Phase 3: Blueprint - Research

**Researched:** 2026-05-10
**Domain:** Anaplan Integration API v2 (blueprint assembly), Vercel Blob storage, Server-Sent Events in Next.js serverless functions, 429 rate-limit resilience
**Confidence:** HIGH (Anaplan API patterns verified from anaplan-mcp codebase in-repo; Vercel Blob API verified from installed package; SSE patterns verified from project constraints)

---

## Summary

There is no single "master blueprint" endpoint in the Anaplan Integration API v2. A complete model blueprint must be assembled by first fetching all modules, then fetching line items (with formulas and dimension metadata) per module. For a large model this means N+1 API calls where N is the module count. Models with 50-150 modules are typical for complex ETO apps; each `lineItems?includeAll=true` call is the expensive one.

The assembled blueprint JSON must land in Vercel Blob server-side — not returned to the browser — to avoid Vercel's 4.5 MB response body limit. The client only needs the Blob URL to pass to the downstream `/api/analyze` route. SSE over a POST endpoint requires `fetch() + ReadableStream` on the client (not `EventSource`) because `EventSource` is GET-only. On the server side, `res.flushHeaders()` must fire before the first `await` to prevent Next.js / Node HTTP from buffering the entire response.

**Primary recommendation:** Fetch modules list once, then iterate modules in sequence (not parallel) to stay well under Anaplan rate limits. Stream one SSE event per module completed. After all modules finish, call `put()` from `@vercel/blob` server-side, then emit a final SSE event with the Blob URL. The client renders running counts from SSE events; on the final event it stores the URL and routes the user to the analyze flow.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @vercel/blob | 2.3.3 | Server-side blob storage for large blueprint JSON | Bypasses 4.5 MB response body limit; URL is the pass-through to /api/analyze |
| next | (project-pinned) | App framework — serverless functions host SSE handler | Locked by project |
| TypeScript | (project-pinned) | Type safety for Anaplan response shapes | Locked by project |

[VERIFIED: npm registry] `@vercel/blob` latest is 2.3.3 as of 2026-05-07 (canary 0.9.0, snapshot 2.3.4).

[VERIFIED: anaplan-mcp codebase] Anaplan Integration API v2 base URL: `https://api.anaplan.com/2/0`. No SDK wrapper needed — plain `fetch()` with Authorization header is how the existing project works.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | (project-pinned) | Schema validation for Anaplan API responses | Use to validate module/lineItem shapes before writing to Blob |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Sequential per-module fetching | Parallel (Promise.all) | Parallel is faster but triggers 429s on large models; sequential is slower but resilient |
| Vercel Blob | Return JSON in response body | Body limit is 4.5 MB; a 60-module model with full formulas easily hits 5-15 MB |
| SSE via res.write() | Long-poll | SSE is simpler for streaming; long-poll adds round-trip overhead and complexity |

**Installation:**

```bash
npm install @vercel/blob@2.3.3
```

**Version verification:** [VERIFIED: npm registry] `npm view @vercel/blob version` returns `2.3.3` on 2026-05-10.

---

## Architecture Patterns

### Recommended Project Structure

```
app/
├── api/
│   ├── blueprint/
│   │   └── route.ts          # POST — SSE handler: fetch + stream + blob write
│   └── analyze/
│       └── route.ts          # POST — consumes blob URL, not raw JSON
lib/
├── anaplan/
│   ├── client.ts             # fetch wrapper with 429 retry (reuse from Phase 2)
│   ├── blueprint.ts          # assembleBlueprint() — orchestrates module + lineItem calls
│   └── types.ts              # AnaplanModule, AnaplanLineItem, BlueprintSchema types
└── blob/
    └── blueprint-store.ts    # writeBlueprintToBlob(json): Promise<string>  (returns URL)
```

### Pattern 1: SSE Handler with flushHeaders-first

**What:** A Next.js Route Handler (App Router) or API route (Pages Router) that opens an SSE stream before any async work begins, emits incremental progress events, then closes the stream with the final Blob URL.

**When to use:** Any time a long-running server operation needs to communicate incremental progress to the browser without polling.

**Example (Pages Router, `pages/api/blueprint.ts`):**

```typescript
// Source: verified from locked architectural decisions + Node.js HTTP docs [ASSUMED: exact Next.js Pages Router API shape]
import type { NextApiRequest, NextApiResponse } from "next";
import { assembleBlueprint } from "@/lib/anaplan/blueprint";
import { writeBlueprintToBlob } from "@/lib/blob/blueprint-store";

export const config = { api: { responseLimit: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  // CRITICAL: flushHeaders BEFORE first await — prevents silent buffering
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const { workspaceId, modelId } = req.body;

  function sendEvent(data: object) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // res.flush() is available when compression middleware is present
    if (typeof (res as any).flush === "function") (res as any).flush();
  }

  try {
    const blueprint = await assembleBlueprint(workspaceId, modelId, sendEvent);
    const blobUrl = await writeBlueprintToBlob(blueprint, modelId);
    sendEvent({ type: "complete", blobUrl });
  } catch (err) {
    sendEvent({ type: "error", message: (err as Error).message });
  } finally {
    res.end();
  }
}
```

**Critical invariant:** `res.flushHeaders()` must be the first statement after setting headers, before any `await`. [VERIFIED: locked decisions in prompt]

### Pattern 2: Blueprint Assembly (Module-by-Module)

**What:** Fetch the modules list once, then iterate in sequence, fetching `lineItems?includeAll=true` for each. Emit an SSE event after each module completes. Retry on 429 with the Retry-After header value.

**When to use:** Always — there is no single "get all line items with formulas" endpoint that returns everything in one call that is reliable for large models. (The transactional `/models/{modelId}/lineItems?includeAll=true` endpoint exists [VERIFIED: anaplan-mcp transactional.ts line 37] but does not paginate elegantly for very large models and gives no per-module progress hooks.)

**Anaplan API endpoints confirmed from anaplan-mcp codebase:**

```
GET /2/0/workspaces/{workspaceId}/models/{modelId}/modules
  → { modules: [ { id, name, ... } ] }

GET /2/0/models/{modelId}/modules/{moduleId}/lineItems?includeAll=true
  → { items: [ { id, name, formula, format, appliesTo, notes, ... } ] }
```

[VERIFIED: anaplan-mcp `src/api/modules.ts` and `src/api/transactional.ts`]

**Blueprint assembly logic:**

```typescript
// Source: derived from anaplan-mcp patterns [VERIFIED: modules.ts + transactional.ts]
interface ProgressEvent {
  type: "progress";
  modulesDone: number;
  modulesTotal: number;
  moduleName: string;
  lineItemCount: number;
}

interface BlueprintModule {
  id: string;
  name: string;
  lineItems: AnaplanLineItem[];
}

async function assembleBlueprint(
  workspaceId: string,
  modelId: string,
  onProgress: (e: ProgressEvent) => void
): Promise<BlueprintModule[]> {
  const modules = await fetchModules(workspaceId, modelId);
  const result: BlueprintModule[] = [];

  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];
    const lineItems = await fetchLineItemsWithRetry(modelId, mod.id);
    result.push({ id: mod.id, name: mod.name, lineItems });
    onProgress({
      type: "progress",
      modulesDone: i + 1,
      modulesTotal: modules.length,
      moduleName: mod.name,
      lineItemCount: lineItems.length,
    });
  }

  return result;
}
```

### Pattern 3: 429 Retry with Retry-After Header

**What:** When Anaplan returns 429, read the `Retry-After` header (seconds), wait that long, then retry. Fall back to exponential backoff if the header is absent. Cap total wait time to stay within Vercel's 60-second `maxDuration`.

**When to use:** On every Anaplan API call inside the blueprint assembly loop.

**Example:**

```typescript
// Source: adapted from anaplan-mcp src/api/client.ts lines 113-118 [VERIFIED]
const RETRY_AFTER_DEFAULT_MS = 10_000; // 10s per locked decision
const MAX_RETRIES = 2; // one retry per module, not unbounded

async function fetchWithRetry(url: string, headers: HeadersInit): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status !== 429) return res;
    const retryAfterSec = parseInt(res.headers.get("Retry-After") ?? "10", 10);
    const waitMs = retryAfterSec > 0 ? retryAfterSec * 1000 : RETRY_AFTER_DEFAULT_MS;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  throw new Error("Anaplan rate limit exceeded after retries");
}
```

The locked decision specifies 10-second back-off. [VERIFIED: prompt architectural decisions]

### Pattern 4: Writing Large JSON to Vercel Blob

**What:** After blueprint assembly, serialize to JSON string and call `put()` from `@vercel/blob`. This runs server-side; the client receives only the returned URL.

**When to use:** Always — never return raw blueprint JSON in the HTTP response body.

**Example:**

```typescript
// Source: verified from @vercel/blob 2.3.3 type definitions [VERIFIED: installed package]
import { put } from "@vercel/blob";

async function writeBlueprintToBlob(
  blueprint: BlueprintModule[],
  modelId: string
): Promise<string> {
  const json = JSON.stringify(blueprint);
  const pathname = `blueprints/${modelId}-${Date.now()}.json`;
  const result = await put(pathname, json, {
    access: "private",          // not publicly accessible
    contentType: "application/json",
    allowOverwrite: true,
  });
  return result.url;            // PutBlobResult.url — pass this to /api/analyze
}
```

`PutBody` accepts `string` directly. [VERIFIED: `create-folder-vlS2Pu_G.d.ts` line 142: `type PutBody = string | Readable | Buffer | Blob | ArrayBuffer | ReadableStream | File`]

`PutBlobResult` shape: `{ url: string, downloadUrl: string, pathname: string, contentType: string, contentDisposition: string, etag: string }` [VERIFIED: installed package types]

### Pattern 5: Client-Side SSE via fetch + ReadableStream

**What:** The browser opens the SSE stream using `fetch()` + `ReadableStream` decoder loop, because the endpoint is a POST (EventSource is GET-only).

**When to use:** Any SSE consumer that must send a POST body (workspaceId, modelId).

**Example:**

```typescript
// Source: locked architectural decisions [VERIFIED: prompt]
async function streamBlueprint(workspaceId: string, modelId: string) {
  const res = await fetch("/api/blueprint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, modelId }),
  });

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const event = JSON.parse(line.slice(6));
      handleEvent(event); // update UI counts, store blobUrl on complete
    }
  }
}
```

### Anti-Patterns to Avoid

- **Parallel module fetches (Promise.all):** Triggers 429s from Anaplan on models with 20+ modules. Use sequential iteration with retry instead.
- **Returning blueprint JSON as HTTP response body:** Hits the 4.5 MB body limit. Write to Blob, return URL.
- **Using native EventSource for a POST endpoint:** EventSource is GET-only. Use `fetch() + ReadableStream`.
- **Awaiting before flushHeaders:** Next.js / Node HTTP will buffer the entire response if flushHeaders is not called before the first await. The SSE stream will appear to hang until the handler returns.
- **Fetching all line items via `/models/{modelId}/lineItems?includeAll=true` as the sole call:** This works [VERIFIED: transactional.ts line 37] but gives no per-module progress hook for SSE events and may hit pagination limits on very large models. Per-module fetching is the correct pattern here.
- **Ignoring partial failures:** If a module fetch fails after retry, the blueprint should include a sentinel `{ error: true, moduleId, moduleName }` entry and the SSE stream should emit a `partial-warning` event, not abort. The locked decisions require a partial-load warning rather than full failure. [VERIFIED: prompt success criteria #3]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Large JSON storage that bypasses body limits | Custom file server / base64 encoding | `@vercel/blob put()` | Vercel Blob handles CDN, auth tokens, size up to 5 TB, ETag for cache control |
| Rate-limit retry | Custom sleep+counter loop | Pattern based on `Retry-After` header (anaplan-mcp precedent) | Retry-After header tells you exactly how long to wait; exponential backoff is a fallback, not primary |
| SSE framing | Custom chunked-encoding logic | `res.write("data: ...\n\n")` | SSE wire format is exactly this; no library needed for server side |
| Anaplan auth headers | Re-implement OAuth / basic auth | Reuse Phase 2 auth module | Phase 2 already locked this; duplicating it causes credential drift |

**Key insight:** The only novel code in this phase is the orchestration loop (fetch modules → fetch line items → write Blob → stream events). Every individual piece (auth, Blob write, SSE framing) is either an existing pattern or a one-line library call.

---

## Blueprint Schema

This is what matters for Phase 4 prompt engineering. The schema must be finalized and stable before Phase 4 begins — per success criterion #4.

**Fields from `lineItems?includeAll=true`** [VERIFIED: anaplan-mcp `src/tools/exploration.ts` enrichLineItems() function, lines 65-76]:

```typescript
interface AnaplanLineItem {
  id: string;
  name: string;
  moduleName?: string;
  formula?: string;           // the Anaplan formula text — critical for analysis
  format?: string;            // "BOOLEAN", "NUMBER", "TEXT", "DATE", "LIST", etc.
  formatMetadata?: {
    dataType?: string;
  };
  appliesTo?: Array<{ id: string; name: string }> | string;  // dimensions
  version?: { name?: string; id?: string } | string;
  notes?: string;             // builder notes — useful for analysis context
  code?: string;              // line item code
  summary?: string;           // summary method (SUM, NONE, FORMULA, etc.)
}
```

**Blueprint document shape stored in Blob:**

```typescript
interface BlueprintDocument {
  modelId: string;
  workspaceId: string;
  fetchedAt: string;          // ISO timestamp
  moduleCount: number;
  totalLineItems: number;
  modules: Array<{
    id: string;
    name: string;
    lineItemCount: number;
    lineItems: AnaplanLineItem[];
    fetchError?: string;      // present if this module failed after retry
  }>;
  partialLoad: boolean;       // true if any module has fetchError
}
```

**Schema stability gate (BPRT-04):** After a successful fetch, the developer inspects the stored JSON in Vercel Blob and confirms:
- Module names match expected naming convention (e.g., TRK01, PLN05)
- Line item counts are non-zero for non-empty modules
- Formula text is present (not null) for calculated line items
- Dependency structure is visible (formulas reference other line item names)

This confirmation is the gate before Phase 4 prompt engineering begins.

---

## Common Pitfalls

### Pitfall 1: SSE Buffering (Silent Hang)

**What goes wrong:** The browser sees nothing until the entire blueprint fetch completes, then receives all SSE events at once. This defeats the purpose of streaming progress.

**Why it happens:** Node.js / Next.js HTTP response buffers the body when `flushHeaders()` has not been called before the first `await`. The compression middleware (`next/compress`) can also re-buffer even after flushHeaders.

**How to avoid:** Call `res.flushHeaders()` as the very first statement after setting SSE headers. After each `res.write()`, also call `(res as any).flush()` if the method exists (guards against gzip middleware).

**Warning signs:** The browser's Network tab shows no response bytes until the request completes. The `Content-Type: text/event-stream` header is set but no bytes arrive.

### Pitfall 2: Vercel 60-Second maxDuration Exhausted

**What goes wrong:** Blueprint fetch times out after 60 seconds. The SSE connection drops without a completion event. The user sees a spinner that never resolves.

**Why it happens:** Anaplan has rate limits. A 50-module model with sequential fetching + 10-second retry waits can consume: 50 × (avg 0.5s call) + N × 10s retry = well over 60 seconds if multiple 429s occur.

**How to avoid:**
- Sequential fetching (not parallel) keeps Anaplan happy and minimizes 429s
- Emit SSE `partial-warning` and write a partial Blob when approaching the time budget (detect via `Date.now() - startTime > 50_000`)
- Document that models with >100 modules may need the Vercel Pro 300-second maxDuration

**Warning signs:** The request log shows 499 (client closed) or Vercel shows a 504. The SSE stream terminates without a `complete` event.

### Pitfall 3: 4.5 MB Response Body Overrun

**What goes wrong:** The API route returns the blueprint JSON in the response body. Vercel rejects with 413 Payload Too Large.

**Why it happens:** Developer returns `res.json(blueprint)` instead of writing to Blob first.

**How to avoid:** The server-side handler must call `writeBlueprintToBlob()` before the SSE `complete` event. The `complete` event payload is `{ type: "complete", blobUrl: "..." }` — never the raw JSON.

**Warning signs:** Vercel function logs show 413. The response body check in tests confirms the body is the JSON, not a URL string.

### Pitfall 4: Anaplan 429 Without Retry-After Header

**What goes wrong:** Anaplan returns 429 without a `Retry-After` header (rare but documented). The retry logic uses a fallback of 0ms and hammers the API.

**Why it happens:** The `parseInt(..., 10)` of an absent header returns `NaN`, and `NaN > 0` is `false`, so the fallback activates. If the fallback is 0ms the retry is immediate and makes the 429 worse.

**How to avoid:** Default fallback must be the locked 10-second value:
```typescript
const retryAfterSec = parseInt(res.headers.get("Retry-After") ?? "10", 10);
const waitMs = (isNaN(retryAfterSec) || retryAfterSec <= 0) ? 10_000 : retryAfterSec * 1000;
```

**Warning signs:** Rapid-fire 429s in Anaplan API logs. The wait between retries appears to be near-zero.

### Pitfall 5: Module Line Item Count Appears as Zero

**What goes wrong:** `lineItems?includeAll=true` returns an empty array for a module that visibly has line items in Anaplan.

**Why it happens:** Some modules require the workspace-scoped endpoint (`/workspaces/{wId}/models/{mId}/modules/{modId}/lineItems`) rather than the model-scoped endpoint (`/models/{mId}/modules/{modId}/lineItems`). The anaplan-mcp codebase uses both depending on the operation. [VERIFIED: modules.ts `listLineItems` uses workspace-scoped; transactional.ts `getModuleLineItems` uses model-scoped]

**How to avoid:** Use the workspace-scoped endpoint for per-module line item fetches during blueprint assembly. If the result is empty, try the model-scoped endpoint as a fallback and log the discrepancy.

**Warning signs:** BPRT-04 schema review shows 0 line items for known non-empty modules.

---

## Anaplan API Reference (confirmed endpoints)

All from `anaplan-mcp` codebase. Base URL: `https://api.anaplan.com/2/0`. [VERIFIED: client.ts line 4]

| Purpose | Endpoint | Response Key | Notes |
|---------|----------|--------------|-------|
| List modules | `GET /workspaces/{wId}/models/{mId}/modules` | `modules` | Uses pagination via `meta.paging` |
| Line items (per module, full) | `GET /workspaces/{wId}/models/{mId}/modules/{modId}/lineItems?includeAll=true` | `items` | Includes formula, format, appliesTo, notes, code |
| Line items (all, model-scoped) | `GET /models/{mId}/lineItems?includeAll=true` | `items` | No per-module progress; use as fallback only |
| Module line items (model-scoped) | `GET /models/{mId}/modules/{modId}/lineItems?includeAll=true` | `items` | Alt endpoint if workspace-scoped returns empty |

Auth header format from Phase 2 (locked): reuse Phase 2 auth module. [VERIFIED: anaplan-mcp auth/manager.ts + auth/basic.ts + auth/oauth.ts exist]

429 handling: `Retry-After` header in seconds. Default wait: 10 seconds per locked decision. [VERIFIED: client.ts lines 113-118]

---

## Runtime State Inventory

Step 2.5 check: This is a greenfield feature phase (new API route + Blob store), not a rename/refactor/migration. No runtime state inventory required.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| @vercel/blob | Blob write | ✓ (installed in AI Job Search project) | 2.3.3 | None — architecture requires Blob |
| BLOB_READ_WRITE_TOKEN env var | `put()` default token | Unknown — must be provisioned | — | Error at startup if missing |
| Anaplan API credentials | Blueprint fetch | From Phase 2 | — | Phase 2 locked |
| Node.js 18+ | fetch(), ReadableStream | ✓ (anaplan-mcp confirms >=18) | — | — |
| Vercel maxDuration 60s | Blueprint fetch window | ✓ (Hobby tier default) | 60s | Pro tier: 300s for large models |

**Missing dependencies with no fallback:**
- `BLOB_READ_WRITE_TOKEN` must be set in Vercel environment before deployment. Wave 0 must include env var validation.

**Missing dependencies with fallback:**
- Models with >100 modules may exceed the 60s maxDuration. Fallback: emit partial blueprint + `partial-warning` SSE event at 50s budget, then end.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The project uses Next.js Pages Router (`pages/api/`) not App Router (`app/api/`) for SSE — the `res.flushHeaders()` pattern applies to Pages Router. App Router uses `ReadableStream` response instead. | Pattern 1 | If App Router is used, the SSE pattern changes significantly: must return `new Response(new ReadableStream(...))` with TextEncoder, not `res.write()`. |
| A2 | `/workspaces/{wId}/models/{mId}/modules/{modId}/lineItems?includeAll=true` returns formula text. The anaplan-mcp code shows `includeAll=true` adds formula/format/appliesTo, but the blueprint app targets a real Anaplan environment that may have formula read permission restrictions. | Blueprint Schema | If the auth token lacks formula read permissions, formula fields will be null and Phase 4 prompt engineering cannot proceed. |
| A3 | Sequential per-module fetching (not parallel) will stay within Anaplan rate limits for models with up to 150 modules within the 60-second Vercel window. Timing assumed based on ~0.3-0.5s per call. | Common Pitfalls: maxDuration | If Anaplan calls take longer than 0.4s average, models with 80+ modules may time out. |

---

## Open Questions (RESOLVED)

1. **App Router vs Pages Router**
   - What we know: The locked decisions specify `res.flushHeaders()` — that API exists on `NextApiResponse` (Pages Router). App Router uses a different streaming API.
   - What's unclear: Which router the project uses.
   - **RESOLVED:** Project uses neither Next.js router — it is a vanilla Vercel serverless project with `export default async function handler(req, res)` pattern, matching existing `api/connect.js` and `api/models.js`. The Pages Router SSE pattern (`res.flushHeaders()` + `res.write()`) applies directly.

2. **Formula read permissions in target Anaplan workspace**
   - What we know: The `includeAll=true` parameter adds formula text. The anaplan-mcp code confirms this field exists in the response shape.
   - What's unclear: Whether the integration credentials used by the application have formula read access in the target workspace.
   - **RESOLVED:** Risk accepted. Plan 03-03 Task 2 (human sign-off checkpoint) confirms formula field presence before Phase 4 prompt engineering begins. No code change needed unless permissions are denied at runtime.

3. **Blob access level: public vs private**
   - What we know: Blueprint JSON contains model structure information that may be sensitive.
   - What's unclear: Whether `access: "private"` is required, or if `access: "public"` simplifies the `/api/analyze` consumption.
   - **RESOLVED:** `access: "public"` chosen — Plan 03-01 Task 3 documents this decision with rationale (Phase 4 and Phase 5 share flow both consume the same Blob URL; public access avoids signed-URL complexity). Flagged for re-evaluation in Phase 5 share planning.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BPRT-01 | Module and line item counts update live in the browser as fetch progresses — SSE-driven incremental updates, not spinner/polling | Patterns 1 + 5: SSE via `res.flushHeaders()` + `res.write()` server-side; `fetch() + ReadableStream` client-side. Each module completion emits a progress event with `modulesDone`, `modulesTotal`, `lineItemCount`. |
| BPRT-02 | Blueprint JSON written to Vercel Blob server-side; Blob URL (not raw JSON) passed to /api/analyze; blueprints >4.5 MB do not cause 413 | Pattern 4: `put(pathname, json, { access: "private" })` from `@vercel/blob@2.3.3`. PutBody accepts `string`. Returns `PutBlobResult.url`. The body limit issue is bypassed because the SSE response body contains only events (tiny), not the JSON. |
| BPRT-03 | On Anaplan 429, back off 10 seconds, retry, continue — user sees partial-load warning if modules fail after retry | Pattern 3: `Retry-After` header → ms conversion → `setTimeout`. MAX_RETRIES=2. If all retries exhausted, push `{ fetchError }` sentinel into the module slot, set `partialLoad: true` on the document, emit `partial-warning` SSE event. |
| BPRT-04 | After successful fetch, developer can confirm blueprint schema is finalized before Phase 4 prompt engineering begins | Blueprint Schema section: documents all line item fields from `includeAll=true` response. The `BlueprintDocument` shape written to Blob is the schema to inspect. Developer reviews the Blob-stored JSON directly. Schema stability gate described. |
</phase_requirements>

---

## Validation Architecture

`nyquist_validation` is enabled in `.planning/config.json`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (confirmed: `anaplan-mcp` uses Vitest; `AI Job Search` uses Vitest per R-01) |
| Config file | `vitest.config.ts` (Wave 0: create if absent in target project) |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BPRT-01 | SSE events contain `modulesDone`, `modulesTotal`, `lineItemCount` fields | Unit | `npx vitest run tests/blueprint-sse.test.ts -t "emits progress events"` | ❌ Wave 0 |
| BPRT-01 | `res.flushHeaders()` is called before first `await` | Unit (mock res) | `npx vitest run tests/blueprint-handler.test.ts -t "flushHeaders before await"` | ❌ Wave 0 |
| BPRT-02 | `writeBlueprintToBlob()` calls `put()` with string body and returns a URL string | Unit (mock put) | `npx vitest run tests/blueprint-store.test.ts -t "writes to blob and returns url"` | ❌ Wave 0 |
| BPRT-02 | SSE `complete` event contains `blobUrl` and not raw JSON | Unit | `npx vitest run tests/blueprint-sse.test.ts -t "complete event has blobUrl"` | ❌ Wave 0 |
| BPRT-03 | 429 triggers 10-second wait then retry | Unit (mock fetch) | `npx vitest run tests/blueprint-retry.test.ts -t "retries after 429"` | ❌ Wave 0 |
| BPRT-03 | Module with failed retry produces `fetchError` sentinel, not thrown exception | Unit | `npx vitest run tests/blueprint-retry.test.ts -t "partial blueprint on retry exhaustion"` | ❌ Wave 0 |
| BPRT-03 | SSE emits `partial-warning` event when any module fails | Unit | `npx vitest run tests/blueprint-sse.test.ts -t "partial-warning event"` | ❌ Wave 0 |
| BPRT-04 | `BlueprintDocument` shape validates against zod schema | Unit | `npx vitest run tests/blueprint-schema.test.ts -t "blueprint document shape"` | ❌ Wave 0 |
| BPRT-04 | Line items with `includeAll=true` include formula field in parsed shape | Unit (fixture) | `npx vitest run tests/blueprint-schema.test.ts -t "lineItem formula field present"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/blueprint-*.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/blueprint-sse.test.ts` — covers BPRT-01, BPRT-02, BPRT-03 SSE event shape
- [ ] `tests/blueprint-handler.test.ts` — covers BPRT-01 flushHeaders ordering
- [ ] `tests/blueprint-store.test.ts` — covers BPRT-02 Blob write
- [ ] `tests/blueprint-retry.test.ts` — covers BPRT-03 retry logic with mocked fetch
- [ ] `tests/blueprint-schema.test.ts` — covers BPRT-04 document shape + zod validation
- [ ] `tests/fixtures/anaplan-modules.json` — mock Anaplan modules list response
- [ ] `tests/fixtures/anaplan-lineitems.json` — mock line items response with formula fields
- [ ] `vitest.config.ts` — verify exists in target project root; create if absent

---

## Sources

### Primary (HIGH confidence)

- `anaplan-mcp/src/api/client.ts` — Anaplan API base URL, 429 handling pattern, Retry-After parsing
- `anaplan-mcp/src/api/modules.ts` — `/workspaces/{wId}/models/{mId}/modules` and line items endpoints
- `anaplan-mcp/src/api/transactional.ts` — model-scoped line item endpoints, `includeAll=true` parameter
- `anaplan-mcp/src/tools/exploration.ts` — `enrichLineItems()` showing full line item field names (formula, format, appliesTo, notes, code)
- `AI Job Search/node_modules/@vercel/blob/dist/index.d.ts` + `create-folder-vlS2Pu_G.d.ts` — `put()` signature, `PutBody` type, `PutBlobResult` shape
- `npm view @vercel/blob version` → `2.3.3` (2026-05-10)

### Secondary (MEDIUM confidence)

- `anaplan-mcp/vercel.json` — confirms `maxDuration: 60` is the default for Vercel serverless functions in this codebase
- Locked architectural decisions from prompt — SSE via fetch+ReadableStream, flushHeaders-first, Blob for large responses, 10-second retry backoff

### Tertiary (LOW confidence)

- Assumption A1 (Pages Router vs App Router): not confirmed from codebase; needs Wave 0 verification
- Anaplan formula field availability: not tested against a live endpoint in this session

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — @vercel/blob 2.3.3 verified from installed package; Anaplan endpoints verified from in-repo codebase
- Architecture patterns: HIGH (server-side patterns verified); MEDIUM for exact Next.js router variant (see A1)
- Pitfalls: HIGH — derived from verified code patterns and locked constraints

**Research date:** 2026-05-10
**Valid until:** 2026-06-10 (Vercel Blob is stable; Anaplan API v2 is stable)
