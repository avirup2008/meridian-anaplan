# Domain Pitfalls: Anaplan API + Claude AI + Vercel Serverless

**Domain:** Browser-based app adding live Anaplan API, Claude AI analysis, and Vercel Blob storage
**Researched:** 2026-05-10
**Existing stack:** Vanilla HTML/JS, Vercel serverless (@vercel/node), no framework, no build step

---

## Critical Pitfalls

Mistakes that cause hard failures, security incidents, or forced rewrites.

---

### Pitfall 1: Blueprint JSON Exceeds Vercel's 4.5 MB Request Body Hard Limit

**What goes wrong:** Vercel enforces a hard 4.5 MB limit on both request and response bodies for serverless functions. A 5 MB blueprint JSON sent from the browser to the analysis function returns `413 FUNCTION_PAYLOAD_TOO_LARGE` and the call never reaches your handler code — no graceful error, no partial processing.

**Why it happens:** Blueprint payloads are routinely 2-5 MB. The naive implementation fetches the blueprint JSON client-side and POSTs the full body to `/api/analyze`. One larger-than-expected customer model breaks everything at once.

**Consequences:** Silent 413 failures that look like network errors in the browser. The analysis feature stops working for any model above 4.5 MB with no user-friendly fallback.

**Prevention:**
- Never POST blueprint JSON through a Vercel function body. Instead: fetch the blueprint in the serverless function (it calls Anaplan server-to-server), write it directly to Vercel Blob, then pass only the Blob URL to the Claude analysis function.
- Alternatively, compress the JSON client-side (pako/gzip) before POSTing — compressed 5 MB JSON often fits under 1 MB.
- Add an explicit size check in the browser before any POST: `if (jsonString.length > 4_000_000) { /* use blob upload path */ }`.

**Detection:** Test with a real large model blueprint during Phase 1 spike. Log `Content-Length` on every incoming API request.

**Build phase:** Phase 1 (architecture decision, not implementation detail). The data flow for large blueprints must be decided before writing any fetch/analysis code.

**Source:** [Vercel Functions Limits — Request body size](https://vercel.com/docs/functions/limitations), [FUNCTION_PAYLOAD_TOO_LARGE](https://vercel.com/docs/errors/FUNCTION_PAYLOAD_TOO_LARGE)

---

### Pitfall 2: Anaplan API Is Blocked by CORS When Called Directly from the Browser

**What goes wrong:** Every call to `api.anaplan.com` or `auth.anaplan.com` from browser-side `fetch()` is blocked by CORS. The Anaplan API does not send `Access-Control-Allow-Origin` headers for arbitrary web app origins. This works in Postman and cURL because CORS is a browser enforcement mechanism — it is not an API authentication issue.

**Why it happens:** Anaplan designed its API for server-side integration tools, not for direct browser consumption. Adding `Access-Control-Allow-Origin` as a request header (a common mistake) does nothing — CORS headers must come from the server response.

**Consequences:** Every direct browser-to-Anaplan API call fails. The error message in the console is misleading ("network error" or CORS policy block) and is often confused with authentication failure. Developers waste time debugging auth when the real issue is the call must never originate from the browser.

**Prevention:** All Anaplan API calls must go through a Vercel serverless function acting as a proxy. The browser calls `/api/anaplan-proxy`, the function holds credentials server-side and calls Anaplan, returns results to browser. Zero Anaplan API calls from browser JS.

**Detection:** If any `fetch('https://api.anaplan.com/...')` call exists in the HTML/JS file, it is wrong. Grep the codebase for `anaplan.com` in client-side code before any deploy.

**Build phase:** Phase 1. Non-negotiable architectural constraint. Proxy function must be built before any Anaplan feature.

**Source:** [Anaplan Community — REST API CORS block](https://community.anaplan.com/discussion/43868/rest-api-cors-block)

---

### Pitfall 3: Basic Auth Token Has a 35-Minute Session Lifespan — Re-Auth on Every Request Fails

**What goes wrong:** The Anaplan Basic Auth flow (`POST https://auth.anaplan.com/token/authenticate`) returns a token valid for ~35 minutes. If the proxy function fetches a new token on every request, rate limiting kicks in and requests start failing. If the token is cached in a serverless function's module-level variable, cold starts invalidate the cache and the next warm start may use an expired token.

**Why it happens:** Anaplan's own documentation warns: "If you get a new auth token for every call, your request might fail. Our system works better for API calls if you use a single token for each 35 minute session."

**Consequences:** Intermittent 401 failures under moderate load. Failures are non-deterministic (depends on warm/cold function state) and very hard to reproduce locally.

**Prevention:**
- Store the token and its expiry timestamp in Vercel Blob or an environment variable via KV-like caching. Reuse the token until 5 minutes before expiry, then refresh.
- Do not rely on in-memory module caching in serverless functions — cold starts wipe it.
- Treat Anaplan Basic Auth as a server credential flow only. Never pass the raw username:password to the browser.

**Detection:** Log every token fetch event. More than 1 token fetch per 30 minutes per workspace is a warning sign.

**Build phase:** Phase 2 (Anaplan API integration). Must be designed into the proxy, not added as a patch later.

**Source:** [Anaplan — Use basic authentication](https://help.anaplan.com/use-basic-authentication-3a4a2905-3d55-4199-a980-d1a89ffdcb7e)

---

### Pitfall 4: Vercel Function Timeout — The Client Gets a 504 with No Recovery Path

**What goes wrong:** With Fluid Compute enabled (now the default), Vercel functions default to 300 seconds on all plans. Without `maxDuration` explicitly configured, the function uses that default. The real danger is the opposite: if `maxDuration` is set too low (e.g., 60s in `vercel.json`) and a blueprint fetch or Claude analysis runs 65 seconds, Vercel sends a `504 FUNCTION_INVOCATION_TIMEOUT` to the browser mid-operation. The browser fetch() rejects, the user sees a generic error, and there is no way to know how far the operation got.

**Why it happens:** Developers copy old documentation showing 60s as the Pro plan max. As of early 2026, with Fluid Compute, the default is 300s and the configurable max is 800s on Pro. But without explicit `maxDuration` in `vercel.json`, functions that previously worked may silently adopt new defaults during Vercel platform updates.

**Consequences:** For the blueprint fetch (20-40s) and AI analysis (30-60s), a 504 mid-stream destroys the operation with no partial result. If streaming is used (SSE), the stream closes abruptly. The browser's `EventSource` or `fetch` reader gets an error event with no context.

**Prevention:**
- Explicitly set `maxDuration` per function in `vercel.json`. For blueprint fetch: `60`. For AI analysis with streaming: `300`.
- Never rely on Vercel's default duration — always declare it.
- Implement a client-side timeout detection: if no SSE event received in 10 seconds, show "still working" state. If the connection closes with no `done` event, show a retry option.
- For AI analysis specifically: stream the response. A streaming function that sends its first byte within 25 seconds (Edge runtime) or any byte before timeout (Node runtime) stays alive much longer than a silent function.

**Detection:** Add a `started_at` timestamp as the first SSE event. Add a `done` event as the last. Any session that has `started_at` but no `done` after the expected duration is a timeout.

**Build phase:** Phase 2 (function configuration) and Phase 3 (streaming implementation).

**Source:** [Vercel Functions Limits — Max Duration](https://vercel.com/docs/functions/limitations), [Configuring Maximum Duration](https://vercel.com/docs/functions/configuring-functions/duration)

---

### Pitfall 5: Claude Haiku Has a 200K Token Limit — a 5 MB Blueprint Will Overflow It

**What goes wrong:** A 5 MB JSON blueprint converts to roughly 1.25 million tokens (a rough estimate: 1 byte ≈ 0.25 tokens for structured JSON). This is 6x the context window of Claude Haiku 4.5 (200K tokens). Sending the raw blueprint to Haiku returns a validation error — not a silent truncation as older Claude models did. Claude Sonnet 4.6 has a 1M token window, which still may not fit a verbose 5 MB blueprint with a system prompt.

**Why it happens:** Developers select Haiku for cost savings on analysis and assume "Claude can handle large contexts." Haiku 4.5 is capped at 200K tokens. The 1M context window beta for Sonnet 4.5 was retired as of August 2025. Only Sonnet 4.6 and Opus 4.6/4.7 have native 1M token windows.

**Consequences:** Analysis fails entirely for any blueprint exceeding Haiku's 200K limit. If Sonnet 4.6 is used and the blueprint still overflows, the API returns a validation error (not truncation — this is the new behavior starting with Sonnet 3.7+).

**Prevention:**
- Never send raw blueprint JSON to Claude. Pre-process server-side: extract only the relevant sections (module names, line items, formula text, dependencies). A 5 MB blueprint distilled to its key structural data is typically under 50K tokens.
- Use a two-pass approach: Haiku for initial extraction/summarization of blueprint sections, Sonnet for final analysis of the summarized data.
- Measure token count server-side before submitting: use `anthropic.messages.countTokens()` (available in the Anthropic SDK) as a pre-flight check.
- Hard fail with a user-friendly message if the pre-flight check exceeds 180K tokens (leaving headroom).

**Detection:** Log token counts for every Claude API call. Alert on any request over 150K tokens.

**Build phase:** Phase 3 (AI analysis). The extraction/summarization layer must be designed before writing the analysis prompt.

**Source:** [Claude Models overview](https://platform.claude.com/docs/en/about-claude/models/overview), [Context windows](https://platform.claude.com/docs/en/build-with-claude/context-windows)

---

### Pitfall 6: Anaplan API Rate Limit — 600 Requests Per Minute Across the Workspace

**What goes wrong:** Anaplan enforces a 600 requests/minute rate limit at the workspace level. If multiple users are using the app simultaneously, or if the proxy function makes several sequential API calls per user action (auth token + workspace list + model list + blueprint fetch), the rate limit is hit quickly and returns `HTTP 429`.

**Why it happens:** Each user session making 4-5 API calls per workflow consumes roughly 10-15 requests/minute. At 40-60 concurrent users, the workspace hits its limit. The 429 response is not retried automatically — the proxy function just returns the error to the browser.

**Consequences:** Intermittent failures for all users sharing the workspace when load spikes. Because the limit is workspace-wide (not per-user), a single user running repeated blueprint fetches can affect everyone.

**Prevention:**
- Cache workspace and model metadata aggressively. The list of workspaces, models, and their IDs changes infrequently. Cache these in Vercel Blob with a 5-minute TTL. Only the blueprint fetch needs to be live.
- Implement exponential backoff with jitter in the proxy function for 429 responses: retry after 1s, 2s, 4s, up to 3 attempts.
- Expose remaining rate limit headers to monitoring. Add `X-RateLimit-Remaining` to logs if Anaplan returns it.

**Detection:** Log every 429 from the Anaplan API. If the rate is above 0, caching strategy needs review.

**Build phase:** Phase 2 (Anaplan API integration). Caching must be built alongside the proxy, not retrofitted.

**Source:** [Anaplan Community — API request exceeds limit](https://community.anaplan.com/discussion/160895/api-request-exceeds-limit)

---

## Moderate Pitfalls

---

### Pitfall 7: Vercel Blob Has No Native TTL — Manual Cleanup Required for 7-Day Reports

**What goes wrong:** There is no native TTL or auto-expiry on Vercel Blob objects. Setting a "7-day shareable link" means nothing unless you actively delete the blob after 7 days. Blobs accumulate indefinitely unless explicitly deleted with `del()` from `@vercel/blob`.

**Why it happens:** Developers assume cloud storage has lifecycle rules like S3. Vercel Blob does not (as of early 2026). Public blob URLs are also cached for up to 1 month at the CDN edge — deleting the blob from storage does not immediately invalidate cached CDN responses for cold URLs.

**Consequences:** Storage costs accumulate over time. Expired "7-day" reports remain accessible via cached CDN URLs even after the blob is deleted, because the CDN may serve the cached version for up to another month. Conversely, infrequently accessed blob URLs may expire from CDN cache before the 7-day window, making the "shareable link" temporarily unavailable even though the blob still exists in storage.

**Prevention:**
- Implement a Vercel Cron Job (runs on a schedule) to scan and delete blobs older than 7 days using the `list()` and `del()` APIs from `@vercel/blob`. Run it daily.
- Store blob metadata (creation time, user identifier) in a lightweight log (another blob or Edge Config) to make the cron scan efficient.
- Do not promise users that "deleted" reports are immediately inaccessible — CDN cache means deleted blobs may be served for up to 1 more month.
- For the inverse problem (CDN cache miss on cold URLs): warn users that first access after extended inactivity may be slower (origin fetch). Do not promise instant delivery for long-inactive report URLs.

**Detection:** Monitor Vercel Blob storage size over time. If it grows monotonically, the cleanup cron is not running.

**Build phase:** Phase 4 (Vercel Blob integration). Cron cleanup must be shipped in the same phase as blob creation — never as a follow-up.

**Source:** [Vercel Blob expiry TTL community thread](https://community.vercel.com/t/vercel-blob-expiry-ttl-possible-workaround/17650), [Vercel Blob public storage docs](https://vercel.com/docs/vercel-blob/public-storage)

---

### Pitfall 8: sessionStorage Credential Leakage in the Proxy Pattern

**What goes wrong:** The proxy pattern keeps Anaplan credentials (username/password) server-side in Vercel environment variables — correct. But the anti-pattern is: the browser collects credentials from a login form and stores them in `sessionStorage`, then sends them to the proxy function on every request. Any XSS vulnerability in the 2990-line monolithic HTML file can read `sessionStorage` and exfiltrate credentials.

**Why it happens:** The proxy pattern is implemented "correctly" from a CORS perspective (credentials never in client JS source) but "incorrectly" from a storage perspective (credentials survive in browser storage and travel over the wire on every API call).

**Consequences:** If the monolithic HTML has any XSS vector (even a minor one — URL parameter rendered into innerHTML, for example), an attacker can harvest Anaplan credentials for every active session.

**Prevention:**
- Credentials should only travel browser-to-server once, at session initialization. The proxy function validates credentials against Anaplan's auth endpoint and returns a short-lived session token (a random UUID stored server-side in Edge Config or a Vercel Blob session store). All subsequent requests use the session token, never the raw credentials.
- If a simpler approach is needed: store only the session token (not credentials) in `sessionStorage`. The session token maps to credentials server-side.
- Audit the HTML file for innerHTML assignments before any credential-handling code ships.

**Detection:** If `sessionStorage.setItem('password', ...)` or similar appears anywhere in client code, it is a finding. Grep for `sessionStorage` and `password` / `token` together.

**Build phase:** Phase 1 (security architecture). Session token design must precede any credential handling code.

**Source:** [GitGuardian — Stop Leaking API Keys: BFF Pattern](https://blog.gitguardian.com/stop-leaking-api-keys-the-backend-for-frontend-bff-pattern-explained/)

---

### Pitfall 9: SSE Streaming Breaks Silently When the Vercel Function Returns Before the Stream Closes

**What goes wrong:** When implementing Server-Sent Events (SSE) for progress feedback on long-running operations, a common pattern in vanilla JS is `fetch()` with a `ReadableStream` reader rather than `EventSource`. If the Vercel function does not keep the response stream open correctly (i.e., does not flush after each write, or closes the response object early), the browser receives no events and the UI appears frozen — no error, just silence.

**Why it happens:** `@vercel/node` serverless functions require explicit `res.write()` + `res.flush()` for SSE. Frameworks handle this automatically. In raw Node.js handler style, forgetting `res.flush()` causes buffering — events accumulate server-side and are sent as one burst when the function ends, giving the appearance that SSE is not working.

**Consequences:** Users see a spinner for the full 30-60 seconds with no progress, then either get the result or a timeout error. All the UX benefit of streaming is lost.

**Prevention:**
- After every `res.write('data: ...\n\n')`, call `res.flush()` explicitly. Some Node.js response objects require this; some handle it automatically. Always call it.
- Set the correct SSE response headers explicitly: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no` (the last header disables Nginx buffering at the proxy layer, which Vercel uses).
- Test SSE locally with `curl -N` before assuming the browser behavior is representative.
- The `X-Accel-Buffering: no` header is particularly important on Vercel — without it, Nginx at the edge may buffer SSE events into batches.

**Detection:** Use `curl -N https://your-app/api/stream-endpoint` and verify events arrive one at a time with appropriate intervals. If all events arrive simultaneously at the end, buffering is active.

**Build phase:** Phase 3 (streaming implementation). The `X-Accel-Buffering` header and `flush()` pattern must be in the initial implementation.

**Source:** [Vercel — Streaming for serverless Node.js and Edge runtimes](https://vercel.com/blog/streaming-for-serverless-node-js-and-edge-runtimes-with-vercel-functions), [SSE requests timing out — Vercel Community](https://community.vercel.com/t/sse-requests-timing-out/7964)

---

### Pitfall 10: Monolithic HTML File Becomes Uneditable After Adding New Feature Sections

**What goes wrong:** The existing 2990-line file will grow to 5000+ lines when Anaplan API UI, AI analysis UI, and report sharing UI are added inline. At that size, the file has multiple competing `DOMContentLoaded` handlers, interleaved script sections referencing state set up earlier in the file, and CSS that cannot be changed without visual regression testing the entire page.

**Why it happens:** Each feature phase adds its own `<script>` block and `<style>` block to the monolith because "it's already inline, just add below." No module boundary means no enforced separation. Variables defined in one `<script>` block silently shadow or overwrite variables in another.

**Consequences:** A change to the credential management section breaks the analysis section because they share global variable names. Adding a new feature requires reading 5000 lines to find insertion points. Debugging requires disabling entire `<script>` blocks with no module boundary isolation.

**Prevention:**
- Before adding new features, extract all existing `<script>` content into a single `main.js` file loaded via `<script src="/main.js"></script>`. This is the minimum viable modularization and requires zero tooling.
- New feature JS goes into separate files: `anaplan-api.js`, `ai-analysis.js`, `report-sharing.js`. Load them in order with `<script src>` tags.
- Use an IIFE or `const app = (() => { ... })()` namespace pattern to avoid global variable pollution between files without needing a bundler.
- Do not refactor and add features simultaneously. One PR: extraction only, no behavior change. Subsequent PR: new feature in new file.

**Detection:** Count global variable names. More than 20 globals in a single file is a warning sign. A file over 3000 lines with more than 3 `<script>` blocks is already problematic.

**Build phase:** Phase 0 / pre-work before any new feature phase. The extraction must happen before new features are added, not concurrently.

**Source:** General frontend engineering practice; inline JS pitfalls documented at [javaspring.net](https://www.javaspring.net/blog/how-does-inline-javascript-in-html-work/), [Qodo refactoring guide](https://www.qodo.ai/blog/refactoring-frontend-code-turning-spaghetti-javascript-into-modular-maintainable-components/)

---

## Minor Pitfalls

---

### Pitfall 11: Vercel Blob Public URLs Are Always Inspectable — No Token-Gated Downloads

**What goes wrong:** Vercel Blob `put()` with `access: 'public'` generates a URL that is publicly accessible to anyone who has it — no authentication, no expiry token in the URL. If the "shareable report" URL is shared with a colleague who then shares it further, it is accessible forever (until the blob is manually deleted).

**Why it happens:** Vercel Blob public URLs are designed for CDN delivery of static assets, not for access-controlled document sharing. There is no signed URL mechanism with an expiry date analogous to S3 pre-signed URLs.

**Prevention:** If access control matters, use a URL-shortener pattern: store the real blob URL server-side and expose only an opaque short code (`/report/abc123`). The serverless function validates the code, checks if the report has expired (using the metadata cron approach), and either proxies the blob response or returns 410 Gone.

**Build phase:** Phase 4 (Vercel Blob). Accept the limitation upfront and document it to stakeholders before implementation.

**Source:** [Vercel Blob — downloadUrl exposure issue #594](https://github.com/vercel/storage/issues/594)

---

### Pitfall 12: Anaplan Auth Token Scope — Basic Auth vs. OAuth Access Controls Differ

**What goes wrong:** A service account using Basic Auth inherits that account's Anaplan workspace permissions. If the service account has more access than the end user, the proxy pattern effectively elevates the end user's permissions — they can fetch blueprints for models they would not normally have access to.

**Why it happens:** The proxy acts on behalf of all users using a single set of service account credentials. Anaplan has no per-request user impersonation mechanism for Basic Auth integrations.

**Prevention:** Scope the service account used for API integration to read-only access on the specific workspaces and models the app is designed to expose. Document the access scope explicitly. Validate that workspace IDs and model IDs passed by the browser are in a known allowed list before forwarding to Anaplan API.

**Build phase:** Phase 1 (security review). Clarify with the Anaplan workspace administrator what access the service account should have before writing any proxy code.

**Source:** [Anaplan — Authentication service API](https://help.anaplan.com/authentication-service-api-4060eddf-fe4e-4220-96f6-267d54502ed6)

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Phase 0: File extraction | Global variable collision when splitting monolith | Use IIFE namespace pattern per file before splitting |
| Phase 1: Proxy architecture | Direct browser calls to Anaplan CORS-blocked | Zero Anaplan API calls in client code — verified by grep |
| Phase 1: Credential design | Raw credentials in sessionStorage | Session token pattern, credentials never leave server after auth |
| Phase 2: Anaplan API | Token re-auth rate limiting | Cache token with expiry timestamp in durable store |
| Phase 2: Anaplan API | 429 rate limit under concurrent users | Cache workspace/model metadata with TTL, retry with backoff |
| Phase 3: Payload size | 5 MB blueprint → 413 from Vercel | Fetch blueprint server-side, write to Blob, pass URL only |
| Phase 3: Claude context | 5 MB blueprint overflows Haiku 200K limit | Extract+summarize server-side before sending to Claude |
| Phase 3: Streaming | SSE buffered — all events arrive at end | Set `X-Accel-Buffering: no` header, call `res.flush()` after each write |
| Phase 3: Timeouts | Long-running functions get 504 | Explicit `maxDuration` in vercel.json per function, stream to keep alive |
| Phase 4: Blob expiry | Blobs accumulate, CDN cache != storage TTL | Daily cron to delete old blobs, document CDN lag to users |
| Phase 4: Blob access | Public URLs not revokable immediately | Opaque short-code redirector if access control is required |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Vercel function limits (4.5 MB, timeout, SSE) | HIGH | Verified against official Vercel docs, Feb 2026 |
| Anaplan CORS blocking | HIGH | Confirmed by Anaplan community thread and structural API design |
| Anaplan Basic Auth token lifespan | HIGH | Official Anapedia documentation |
| Anaplan rate limit (600 req/min) | MEDIUM | Community reports (Sept 2025), not in official docs |
| Claude token limits by model | HIGH | Official Claude models overview, confirmed 1M beta retirement |
| Vercel Blob TTL gap | HIGH | Official Vercel docs confirm no native TTL |
| CDN cache lag on Blob deletion | MEDIUM | Official Vercel Blob docs mention up to 1 month cache, early eviction documented as edge case |
| SSE buffering / X-Accel-Buffering | MEDIUM | Community reports and Vercel blog, not in main Vercel docs |

---

## Sources

- [Vercel Functions Limits](https://vercel.com/docs/functions/limitations)
- [Vercel — Configuring Maximum Duration](https://vercel.com/docs/functions/configuring-functions/duration)
- [Vercel — FUNCTION_PAYLOAD_TOO_LARGE](https://vercel.com/docs/errors/FUNCTION_PAYLOAD_TOO_LARGE)
- [Vercel — How to bypass Vercel body size limit](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)
- [Vercel Blob documentation](https://vercel.com/docs/vercel-blob)
- [Vercel Blob expiry TTL community thread](https://community.vercel.com/t/vercel-blob-expiry-ttl-possible-workaround/17650)
- [Vercel — Streaming for serverless Node.js](https://vercel.com/blog/streaming-for-serverless-node-js-and-edge-runtimes-with-vercel-functions)
- [SSE requests timing out — Vercel Community](https://community.vercel.com/t/sse-requests-timing-out/7964)
- [Anaplan — Use basic authentication](https://help.anaplan.com/use-basic-authentication-3a4a2905-3d55-4199-a980-d1a89ffdcb7e)
- [Anaplan — Authentication service API](https://help.anaplan.com/authentication-service-api-4060eddf-fe4e-4220-96f6-267d54502ed6)
- [Anaplan Community — REST API CORS block](https://community.anaplan.com/discussion/43868/rest-api-cors-block)
- [Anaplan Community — API request exceeds limit](https://community.anaplan.com/discussion/160895/api-request-exceeds-limit)
- [Claude — Models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Claude — Context windows](https://platform.claude.com/docs/en/build-with-claude/context-windows)
- [GitGuardian — BFF Pattern to stop API key leakage](https://blog.gitguardian.com/stop-leaking-api-keys-the-backend-for-frontend-bff-pattern-explained/)
- [Vercel Blob downloadUrl exposure — GitHub issue #594](https://github.com/vercel/storage/issues/594)
