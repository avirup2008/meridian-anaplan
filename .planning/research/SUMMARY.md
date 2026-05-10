# Project Research Summary

**Project:** Meridian v2.0 — Anaplan API Integration + Claude AI + Vercel Blob
**Domain:** Anaplan model intelligence and health analysis tool
**Researched:** 2026-05-10
**Confidence:** HIGH

---

## Executive Summary

Meridian v2.0 adds live Anaplan API connectivity, Claude AI analysis, Vercel Blob report sharing, SSE streaming progress, and improved PDF generation to the existing vanilla HTML/JS app. The recommended build approach is strictly additive: 5 new Vercel serverless functions (connect, models, blueprint, analyze, share) wired to 5 new screens in the existing monolithic index.html, with the existing Gemini-based CSV path left fully intact. Only 3 npm packages are needed — `@anthropic-ai/sdk`, `@vercel/blob`, and `pdfmake` — everything else (Anaplan auth, SSE streaming, progress events) is covered by Node.js built-ins and the browser's native APIs. No official SDK exists for Anaplan; a ~100-line fetch helper covers the full required API surface.

The recommended approach for all long-running operations (blueprint fetch: 20-40s, AI analysis: 30-60s) is Server-Sent Events (SSE) via `fetch()` + `ReadableStream` rather than native `EventSource`, because both endpoints require POST with credentials in the body. Vercel Fluid Compute (GA April 2025) eliminates most cold starts and allows up to 300s on Hobby, so timeout risk is manageable with explicit `maxDuration` configuration. The highest-complexity piece is the blueprint fetch: Anaplan has no native API for blueprint/module-structure export, so the implementation must traverse workspace → model → modules → line items across sequential paginated calls with 10-second backoff on 429 errors.

Two critical constraints must be resolved at architecture design time before any code is written: (1) large blueprint JSON routinely exceeds Vercel's 4.5 MB request body hard limit, requiring blueprints to be fetched server-to-server and written to Blob rather than POSTed from the browser; and (2) the Anaplan API is CORS-blocked from the browser, so zero Anaplan calls can exist in client-side JS. Both constraints fundamentally shape the data flow and must be locked in before any feature phase begins.

---

## Key Findings

### Recommended Stack

The stack is intentionally minimal. No new runtime, no framework, no bundler. The existing vanilla JS + Vercel Node.js runtime handles everything. Claude replaces Gemini for AI analysis calls (the existing `api/generate.js` Gemini proxy is left unchanged; new analysis runs through `api/analyze.js`). The two-model strategy — Haiku 4.5 for per-module extraction/classification, Sonnet 4.6 for final synthesis — is the right cost/quality tradeoff given Haiku's 200K context limit and Sonnet's 1M window.

**Packages to add:**

```bash
npm install @anthropic-ai/sdk @vercel/blob pdfmake
```

| Package | Version | Purpose |
|---------|---------|---------|
| `@anthropic-ai/sdk` | `^0.95.1` | Claude Haiku 4.5 + Sonnet 4.6 API calls |
| `@vercel/blob` | `^2.3.3` | Shareable report snapshots with manual 7-day expiry via cron |
| `pdfmake` | `^0.3.7` | Multi-section vector PDF (client-side; replaces html2canvas rasterization) |

**Packages explicitly NOT to add:** `@ai-sdk/anthropic`, `puppeteer`, `@sparticuz/chromium-min`, `axios`, `eventsource-parser`, `socket.io`, `html-to-pdfmake`, any Anaplan community SDK.

**New environment variables required:**
- `ANTHROPIC_API_KEY`
- `ANAPLAN_USERNAME`
- `ANAPLAN_PASSWORD`
- `ANAPLAN_WORKSPACE_ID`
- `ANAPLAN_MODEL_ID`
- `BLOB_READ_WRITE_TOKEN` (auto-provisioned via Vercel dashboard)
- `CRON_SECRET` (for securing the daily cleanup endpoint)

**Constraint:** Anaplan Basic Auth passwords expire every 90 days. Document for operators at handover.

---

### Expected Features

**Must have (table stakes):**

| Feature | Complexity | Notes |
|---------|------------|-------|
| Numeric health score with tiered verdict | Medium | Community has explicitly requested this for years; no native Anaplan equivalent |
| Formula issue detection naming specific line items | Low | Apply Planual rule set to parsed blueprint |
| Naming convention violation detection | Low | Regex/pattern matching against Planual rules |
| Connection success/error states with specific messages | Low | Distinguish wrong credentials vs expired token vs rate limit |
| PDF export of analysis | Low | Already in v1; needs pdfmake upgrade for multi-section reports |

**Should have (differentiators):**

| Feature | Complexity | Notes |
|---------|------------|-------|
| Triage tags (Fix Now / Consider / Monitor) | Medium | Primary trust signal; maps to SonarQube severity model |
| Domain grouping (Structural / Formula / Best Practice / Naming) | Low | Enables team delegation by domain; no existing tool does this |
| Cross-module story view (AI narrative synthesis) | High | No third-party tool does this; requires multi-module context window |
| Live API connection (workspace → model picker) | High | Eliminates manual CSV export step; blueprint fetch workaround required |
| Vercel Blob shareable link | Low | Async sharing without Anaplan access; 7-day default with toggle |

**Defer to v2+:**
- Export compose toggles (can't design sections until AI output shape is stable)
- OAuth 2.0 auth (Basic Auth covers the immediate need; OAuth is significant additional surface)
- Automated bulk PDF export across multiple engagements

**Anti-features — explicitly do not build:**
- Flat undifferentiated suggestion list (causes alert fatigue; always triage-tag)
- Formula dump as documentation (provide AI narrative, not reformatted CSV)
- Showing raw workspace/model IDs to users (always resolve to display names)
- Global blueprint fetch on connection (fetch one model at a time on explicit user request)
- Permanent shareable links for all exports (offer expiry toggle at share time)

---

### Architecture Approach

Five new serverless functions layer onto the existing monolith without touching the CSV analysis path. All Anaplan API calls are server-side only (CORS constraint). Credentials flow browser-to-server once via `/api/connect`, which exchanges them for a short-lived Anaplan JWT; only the JWT is stored in `sessionStorage`, never the raw password. Blueprint data is held in-memory client-side (too large for sessionStorage); for models where the blueprint may exceed 4.5 MB, the server fetches and writes directly to Vercel Blob, passing only the Blob URL downstream. The index.html file stays monolithic but is given strict comment-section headers before any new code is added.

**Major components:**

| Component | Status | Responsibility |
|-----------|--------|----------------|
| `api/connect.js` | NEW | Anaplan auth token exchange + workspace list |
| `api/models.js` | NEW | Anaplan model list for selected workspace |
| `api/blueprint.js` | NEW | Sequential module + line-item fetch with SSE progress events |
| `api/analyze.js` | NEW | Claude Haiku (extraction) + Sonnet (synthesis) with SSE streaming |
| `api/share.js` | NEW | Vercel Blob `put()` + 7-day URL generation |
| `api/cleanup-blobs.js` | NEW | Daily cron to delete blobs older than 7 days |
| `api/generate.js` | UNCHANGED | Existing Gemini proxy; no modifications |
| `index.html` | MODIFIED | Add 5 new screens + JS handlers; section structure imposed first |
| `vercel.json` | MODIFIED | Add `functions{}` key with per-function `maxDuration`; add 5 routes + cron |

**Key architectural decisions:**
1. SSE via `fetch()` + `ReadableStream` (not native `EventSource`) — required because blueprint and analyze endpoints are POST with credentials in the body.
2. Blueprint fetched server-to-server — eliminates CORS block and 4.5 MB payload risk simultaneously.
3. Blob filenames embed expiry timestamp (`reports/{expiry_unix}-{reportId}.html`) — self-contained TTL metadata, no separate KV store needed.
4. Monolith stays monolithic — no runtime module splitting without a build step; impose comment-section headers instead.
5. `res.flushHeaders()` before first `await` in every SSE handler — prevents Nginx/Vercel buffering that silently breaks streaming.

---

### Critical Pitfalls (Priority Order)

1. **CORS: Anaplan API blocked from browser** — Zero Anaplan API calls in client code. Verify with `grep 'anaplan.com' index.html` before any deploy. All calls go through a serverless proxy.

2. **Payload size: 4.5 MB Vercel request body limit** — A real model blueprint is routinely 2-5 MB. POSTing it from the browser returns `413 FUNCTION_PAYLOAD_TOO_LARGE` with no graceful fallback. Fix: fetch blueprint server-to-server in `/api/blueprint`, write to Blob if large, pass only the Blob URL to the analysis function. Decide data flow before writing any fetch code.

3. **Claude context overflow: 5 MB blueprint overflows Haiku's 200K token limit** — Never send raw blueprint JSON to Claude. Pre-process server-side to extract module names, line items, formula text, dependencies — typically reduces to under 50K tokens. Use `anthropic.messages.countTokens()` as a pre-flight check; hard-fail with user-friendly message above 180K tokens.

4. **Anaplan token lifespan: Basic Auth JWT expires in ~35 minutes** — Fetching a new token on every request triggers rate limiting. In-memory module caching is wiped on cold starts. Cache the token and `expiresAt` in Vercel Blob; reuse until 5 minutes before expiry.

5. **SSE buffering: all events arrive at once at the end** — Caused by missing `res.flushHeaders()` before first `await`, or missing `X-Accel-Buffering: no` header (Vercel edge buffering). Both must be in every SSE handler from the first commit. Test with `curl -N` before relying on browser behavior.

6. **Monolith growth: 2990-line file becomes 5000+ lines and uneditable** — Before adding any new feature code, impose comment-section headers as a no-behavior-change commit. New screens must be added into defined sections, not appended to the bottom.

7. **Vercel Blob no TTL: blobs accumulate without cleanup cron** — Ship the daily cleanup cron in the same phase as blob creation. CDN cache persists up to 1 month after blob deletion — do not promise users that deleted reports are immediately inaccessible.

---

## Implications for Roadmap

### Phase 0: Pre-work — Environment + Monolith Structure
**Rationale:** Two blocking prerequisites before any feature code: (1) the monolith needs section structure to prevent variable collision as new screens are added, and (2) Anaplan API access needs to be validated empirically before implementation assumptions are locked in.
**Delivers:** Structured index.html with comment-section headers; Vercel Blob store connected; Anaplan test account validated; all env vars set in Vercel dashboard; `vercel.json` skeleton with `functions{}` and cron entries.
**Avoids:** Monolith collision pitfall, discovering CORS or token issues mid-build.
**Research flag:** None — well-documented setup steps.

### Phase 1: Proxy Foundation — Connect + Models + Security Architecture
**Rationale:** The credential and discovery endpoints unblock everything downstream. The session token security design (exchange credentials once for JWT, never store raw password client-side) must be locked in before any credential-handling UI is built. Fully testable in isolation with a hardcoded test account.
**Delivers:** Working `/api/connect` (auth + workspace list) and `/api/models` (model list); session token pattern established; `safeLog()` helper in all API files; CSP headers in `vercel.json`; workspace and model picker UI screens.
**Addresses:** Connection UX table stakes, specific error states feature.
**Avoids:** CORS pitfall, credential storage pitfall, token scope pitfall.
**Research flag:** MEDIUM — Anaplan auth endpoint response field names (`tokenInfo.tokenValue`, `expiresAt` format) documented in Apiary but must be validated against a live account before building the session token store.

### Phase 2: Data Acquisition — Blueprint Fetch with SSE
**Rationale:** The blueprint fetch is the highest-complexity single endpoint and determines the data schema that all downstream phases depend on. Building and finalizing the schema before AI work begins means no wasted prompt engineering against an unstable input shape. The sequential per-module fetch with 429 backoff is the core engineering challenge of the milestone.
**Delivers:** Working `/api/blueprint` with SSE progress events; client-side `ReadableStream` SSE parser; blueprint data schema finalized and documented; retry/backoff helper module; progress bar UI on blueprint screen.
**Addresses:** Live API connection differentiator; prerequisite for cross-model analysis.
**Avoids:** CORS pitfall, 4.5 MB payload pitfall (server-to-server fetch), token caching pitfall, SSE buffering pitfall, 429 rate-limit pitfall.
**Research flag:** HIGH — blueprint fetch has no native API endpoint; the ALM API or export action workaround needs a prototype spike before building the full screen. Rate limit behavior under concurrent blueprint fetches needs empirical testing with real models.

### Phase 3: Intelligence — Claude Analysis with Triage Tags + Health Score
**Rationale:** Depends on a stable blueprint schema from Phase 2. The two-model pattern (Haiku extraction → Sonnet synthesis) must be implemented together; the extraction layer determines what Sonnet receives. Triage tags and domain grouping are classification logic applied to Claude output — implemented here, not as a separate UI-only phase.
**Delivers:** Working `/api/analyze` with SSE streaming; Haiku extraction layer with token pre-flight check; Sonnet synthesis producing health score + tiered verdict; triage-tagged + domain-grouped suggestions panel; cross-module story view narrative.
**Addresses:** Health score (table stakes), formula detection (table stakes), triage tags (differentiator), domain grouping (differentiator), cross-module narrative (differentiator).
**Uses:** `@anthropic-ai/sdk` 0.95.1, `claude-haiku-4-5-20251001` + `claude-sonnet-4-6`.
**Avoids:** Claude context overflow pitfall, SSE buffering pitfall, timeout pitfall (explicit `maxDuration: 90` in vercel.json).
**Research flag:** MEDIUM — triage tag calibration (what qualifies as Fix Now vs Consider) requires iteration. Start conservative; only known-bad Planual patterns as Fix Now. Plan one calibration loop after first real model analysis before shipping.

### Phase 4: Persistence + Export — Blob Sharing + PDF
**Rationale:** Depends on a stable analysis output schema from Phase 3. Blob sharing and cleanup cron must ship together — never blob creation without expiry management. PDF upgrade can begin once analysis output fields are finalized.
**Delivers:** Working `/api/share` (Blob put + 7-day URL); `/api/cleanup-blobs` daily cron; pdfmake-based multi-section PDF replacing html2canvas for structured reports; shareable link UI with copy-to-clipboard; expiry toggle (casual share vs audit-grade durable link).
**Addresses:** Vercel Blob shareable link (differentiator), PDF export upgrade (table stakes improvement).
**Uses:** `@vercel/blob` 2.3.3, `pdfmake` 0.3.7, Vercel Cron.
**Avoids:** Blob TTL pitfall, CDN cache lag confusion.
**Research flag:** LOW — Vercel Blob and pdfmake are well-documented. Main open question: does any customer have compliance requirements around report link sharing that require the opaque short-code redirector pattern? Confirm with stakeholders before Phase 4 starts.

### Phase Ordering Rationale

- Phase 0 before everything: proves the environment and locks in monolith structure before any feature code lands.
- Phase 1 before Phase 2: the auth token from `/api/connect` is required input to all downstream endpoints; credentials architecture must be fixed before any credential-handling code exists.
- Phase 2 before Phase 3: the blueprint data schema is the input contract for Claude prompt engineering; changing it mid-analysis work is expensive.
- Phase 3 before Phase 4: the analysis output schema drives PDF section structure; can't design exports against unknown fields.
- Blob cleanup cron ships in Phase 4 alongside blob creation — this is a hard constraint, not a recommendation.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All packages verified on npm; Vercel limits confirmed against official docs |
| Features | HIGH (Anaplan domain) / MEDIUM (AI UX) | Domain patterns confirmed via Planual, community, CoModeler; triage calibration is inference from SonarQube analogy |
| Architecture | HIGH (Vercel) / MEDIUM (Anaplan API) | SSE + Fluid Compute confirmed; Anaplan response field names documented but need live validation |
| Pitfalls | HIGH (most) / MEDIUM (rate limits, CDN lag) | CORS, payload limits, token lifespan: official sources. 600 req/min and CDN cache duration: community reports |

**Overall confidence:** HIGH for architecture decisions and stack choices. MEDIUM for Anaplan API response shapes and rate-limit behavior under load — both need empirical validation in Phase 0/1.

### Gaps to Address

- **Anaplan auth response schema:** The exact field path (`tokenInfo.tokenValue`, `expiresAt` format) must be verified against a live account in Phase 0 before building the session token store. One wrong field name breaks the entire auth chain.
- **Blueprint payload size in production:** Research confirms 2-5 MB range, but threshold depends on model size. A Phase 2 spike against a real customer model is required to confirm whether the Blob-passthrough path is needed on Day 1 or can be deferred.
- **Triage tag calibration:** The Fix Now / Consider / Monitor boundary needs review with an Anaplan model builder before Phase 3 ships, not after user complaints arrive.
- **Blob access control decision:** Current design uses public Blob URLs with no token-gating. If any customer has compliance requirements around report link sharing, the opaque short-code redirector pattern must be built in Phase 4. Confirm with stakeholders before starting that phase.
- **vercel.json `functions{}` + legacy `builds[]` compatibility:** Mixing these two config keys is documented as valid but should be verified on first deploy to catch any silent fallback to defaults.

---

## Sources

### Primary (HIGH confidence)
- [Anaplan Integration API V2 — Apiary](https://anaplan.docs.apiary.io/) — auth flow, endpoint structure, workspace/model/module/lineItem calls
- [Anthropic Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview) — model IDs, context windows, token limits
- [Vercel Functions Limits](https://vercel.com/docs/functions/limitations) — 4.5 MB body limit, maxDuration, 50 MB bundle cap
- [Vercel Fluid Compute](https://vercel.com/docs/fluid-compute) — cold start behavior, GA April 2025
- [Vercel Blob docs](https://vercel.com/docs/vercel-blob) — put/del/list API, public URL behavior
- [Vercel Cron Jobs docs](https://vercel.com/docs/cron-jobs) — schedule format, Hobby plan limits (2 crons max)
- [@anthropic-ai/sdk npm](https://www.npmjs.com/package/@anthropic-ai/sdk) — version 0.95.1
- [@vercel/blob npm](https://www.npmjs.com/package/@vercel/blob) — version 2.3.3
- [pdfmake npm](https://www.npmjs.com/package/pdfmake) — version 0.3.7
- [Anaplan — Use basic authentication](https://help.anaplan.com/use-basic-authentication-3a4a2905-3d55-4199-a980-d1a89ffdcb7e) — 35-minute token lifespan

### Secondary (MEDIUM confidence)
- [Anaplan Community — REST API CORS block](https://community.anaplan.com/discussion/43868/rest-api-cors-block) — confirms browser CORS enforcement
- [Anaplan Community — API request exceeds limit](https://community.anaplan.com/discussion/160895/api-request-exceeds-limit) — 600 req/min rate limit (community-reported)
- [Vercel Blob TTL community thread](https://community.vercel.com/t/vercel-blob-expiry-ttl-possible-workaround/17650) — no native TTL confirmed
- [Vercel — Streaming for serverless Node.js](https://vercel.com/blog/streaming-for-serverless-node-js-and-edge-runtimes-with-vercel-functions) — SSE + X-Accel-Buffering pattern
- [SonarQube Issues docs](https://docs.sonarsource.com/sonarqube-server/10.4/user-guide/issues) — triage severity model reference for Meridian tag design
- [Anaplan CoModeler](https://www.anaplan.com/platform/anaplan-comodeler/) — documentation generator benchmark
- [Model Builder Tools](https://modelbuildertools.com/) — third-party health score reference
- [Planual](https://anaplancommunity.s3.us-east-2.amazonaws.com/Misc/planual06052019.pdf) — naming convention and formula rules
- [GitGuardian — BFF Pattern](https://blog.gitguardian.com/stop-leaking-api-keys-the-backend-for-frontend-bff-pattern-explained/) — credential storage guidance

### Tertiary (validate in Phase 0/1)
- Anaplan auth response field names (`tokenInfo.tokenValue`, `expiresAt`) — documented in Apiary; confirm against live account
- Rate limit behavior under concurrent users — 600 req/min is community-reported, not in official docs

---

*Research completed: 2026-05-10*
*Ready for roadmap: yes*
