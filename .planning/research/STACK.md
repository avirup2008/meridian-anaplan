# Technology Stack: Meridian v2.0 New Features

**Project:** Meridian v2.0 — Adding Anaplan API, Claude AI, Vercel Blob, streaming, improved PDF
**Researched:** 2026-05-10
**Overall confidence:** HIGH (all critical claims verified against official docs or npm registry)

---

## 1. Anaplan Integration API (Basic Auth)

### Approach: Raw fetch — no third-party Anaplan SDK

No official Anaplan Node.js SDK exists. The API is standard REST over HTTPS.
Use native `fetch` (Node 18+, already available in Vercel's runtime). No new library needed.

**Auth flow (two-step):**

1. POST to `https://auth.anaplan.com/token/authenticate` with header:
   `Authorization: Basic <base64(username:password)>`
2. Use the returned `tokenValue` as:
   `Authorization: AnaplanAuthToken <tokenValue>` on all subsequent calls.

**Key endpoints:**
```
GET  https://api.anaplan.com/2/0/workspaces
GET  https://api.anaplan.com/2/0/workspaces/{wsId}/models/{modelId}/exports
POST https://api.anaplan.com/2/0/workspaces/{wsId}/models/{modelId}/exports/{exportId}/tasks
GET  https://api.anaplan.com/2/0/workspaces/{wsId}/models/{modelId}/exports/{exportId}/tasks/{taskId}
GET  https://api.anaplan.com/2/0/workspaces/{wsId}/models/{modelId}/files/{fileId}/chunks/{chunkId}
```

**Why no SDK:** There is no official SDK. Community wrappers are unmaintained. The API surface needed
(auth + export run + file download) is small enough that a ~100-line helper module covers it.

**Libraries to add:** None. Use Node.js built-in `fetch` + `Buffer.from('user:pass').toString('base64')`.

**Vercel environment variables needed:**
- `ANAPLAN_USERNAME`
- `ANAPLAN_PASSWORD`
- `ANAPLAN_WORKSPACE_ID`
- `ANAPLAN_MODEL_ID`

**Constraint:** Basic Auth passwords expire every 90 days — document this for the operator.
OAuth 2.0 is more durable long-term but is a larger implementation. Start with Basic Auth.

**Rate limiting:** Anaplan returns 429 on concurrent requests. Build a simple retry with exponential
backoff (max 3 retries, starting at 1s). No library needed — a small `retryFetch` wrapper suffices.

---

## 2. Claude API via @anthropic-ai/sdk

### Package

```bash
npm install @anthropic-ai/sdk
```

**Current version:** 0.95.1 (verified on npm, published ~2 days before research date)

### Model IDs (verified against official Anthropic docs, 2026-05-10)

| Model | API ID | Context | Price (input/output per MTok) | Use |
|-------|--------|---------|-------------------------------|-----|
| Haiku 4.5 | `claude-haiku-4-5-20251001` | 200k tokens | $1 / $5 | Fast extraction, classification, light analysis |
| Sonnet 4.6 | `claude-sonnet-4-6` | 1M tokens | $3 / $15 | Heavy analytical narrative, full report |

**Pattern:** Use Haiku for any iterative/row-level processing (e.g., flagging anomalies in CSV rows),
use Sonnet for the final synthesis and narrative generation.

### Integration with existing `api/generate.js` pattern

Replace the Gemini client instantiation with:

```js
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
```

For non-streaming responses:
```js
const message = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,
  messages: [{ role: 'user', content: prompt }]
});
```

For streaming (see section 4 below), use `client.messages.stream(...)`.

**Environment variable needed:** `ANTHROPIC_API_KEY`

**What NOT to use:** Do NOT add `@ai-sdk/anthropic` (Vercel AI SDK wrapper). It adds abstraction
overhead and a heavier dependency tree with no benefit for a vanilla JS app that manages its own
streaming manually. The official `@anthropic-ai/sdk` is sufficient and lighter.

---

## 3. Vercel Blob for 7-Day Report Snapshots

### Package

```bash
npm install @vercel/blob
```

**Current version:** 2.3.3 (verified on npm)

### Usage

```js
import { put, del, list } from '@vercel/blob';

// Store a report snapshot (HTML string or JSON)
const blob = await put(`reports/${reportId}.html`, htmlContent, {
  access: 'public',
  contentType: 'text/html',
});
// blob.url is the shareable URL

// Delete a blob
await del(blobUrl);
```

### CRITICAL: No native TTL support

Vercel Blob has no built-in expiry or TTL on objects. Blobs persist until explicitly deleted.
(Confirmed via Vercel community thread and official docs, May 2026.)

**Workaround for 7-day expiry:** Add a Vercel Cron Job that runs daily and calls `del()` on expired blobs.

```json
// vercel.json addition
{
  "crons": [
    {
      "path": "/api/cleanup-blobs",
      "schedule": "0 3 * * *"
    }
  ]
}
```

The cleanup function needs to know which blobs to delete. Two options:
- Option A (simplest): Embed the expiry timestamp in the blob filename: `reports/${expiry_unix}-${reportId}.html`. The cron reads all blobs via `list()`, parses the filename, deletes expired ones.
- Option B: Store blob URL + creation time in a KV store or database. Over-engineering for this use case.

**Recommendation:** Option A. Keep it self-contained in the blob store itself.

**Cron plan limitations:** Hobby plan allows 2 cron jobs maximum, and cron job minimum interval is
once per day. This is fine for 7-day expiry cleanup.

**Environment variable needed:** `BLOB_READ_WRITE_TOKEN` (auto-provisioned when you create a Blob store in the Vercel dashboard).

**What NOT to add:** Do not add any external file storage SDK (S3, GCS). Vercel Blob is already
available in the existing deployment context and has zero additional infrastructure.

**Payload note:** The 4.5 MB Vercel function response limit applies to uploads via serverless function.
If the HTML snapshot of a report is likely to exceed 4.5 MB, use client-side upload instead
(`createUpload` + browser `fetch` direct to Blob). For typical financial reports, 4.5 MB is ample.

---

## 4. Streaming Progress from a Long-Running Serverless Function

### Approach: Server-Sent Events (SSE) using ReadableStream

No new library needed on the server. Use the Web Streams API built into Node.js 18+.

**Server (Vercel serverless function):**

```js
export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering if present

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // ... do work, call sendEvent({ step: 'anaplan_fetch', pct: 20 }) etc.

  res.end();
}
```

**Client (vanilla JS):**

```js
const evtSource = new EventSource('/api/analyze');
evtSource.onmessage = (e) => {
  const { step, pct } = JSON.parse(e.data);
  updateProgressBar(step, pct);
};
evtSource.addEventListener('done', () => evtSource.close());
```

**Why SSE over WebSockets:** SSE is unidirectional server-to-client, which is exactly what progress
reporting needs. WebSockets require a persistent bidirectional connection and are significantly
harder to implement on Vercel. SSE works with the native `EventSource` browser API — no client
library needed.

**Why NOT to use `eventsource-parser` npm package on the client:** The vanilla `EventSource` API
handles parsing natively. Only add `eventsource-parser` if consuming SSE via `fetch()` + async
iteration (needed for environments where `EventSource` is unavailable, which is not the case here).

### Vercel timeout constraints

- **Hobby plan:** `maxDuration` hard cap is 60 seconds. This matches the stated requirement.
- **Pro plan:** Can extend to 300 seconds if needed in future.

Set in `vercel.json`:
```json
{
  "functions": {
    "api/analyze.js": { "maxDuration": 60 }
  }
}
```

**Cold start risk:** A function that calls Anaplan (multi-step export flow), then streams to Claude,
could take 30-50 seconds in the worst case. SSE keeps the connection alive during this time.
The browser's `EventSource` reconnects automatically if the connection drops — but since the
function result is not persisted, a reconnected client would restart from zero.

**Mitigation:** Break the long operation into two functions if needed:
1. `POST /api/start-analysis` — triggers work, stores progress in a KV store (or even a blob),
   returns a job ID.
2. `GET /api/status?jobId=X` — polled by client (not SSE) every 2 seconds.

This is more robust than SSE for operations near the 60-second limit. However, for an MVP, SSE
from a single function is simpler and sufficient if Anaplan + Claude together finish under 55 seconds.

---

## 5. Improved PDF Generation

### Recommendation: pdfmake (client-side, keep existing approach server-free)

```bash
npm install pdfmake
# TypeScript types (if needed)
npm install --save-dev @types/pdfmake
```

**Current version:** 0.3.7 (verified on npm, published ~2 months before research date)

**Why pdfmake over alternatives:**

| Option | Size | CSS Fidelity | Multi-page | Vercel Safe | Verdict |
|--------|------|--------------|------------|-------------|---------|
| jsPDF + html2canvas (existing) | Small | Poor (rasterized, no text select) | Manual slicing | Yes | Keep for simple fallback only |
| pdfmake 0.3.7 | Medium | N/A (JSON-based layout) | Native pagination | Yes | **Recommended** |
| Puppeteer + @sparticuz/chromium-min | ~150 MB | Excellent | Native | Risky (bundle size, cold start) | No |
| External PDF API (PDFBolt, APITemplate) | None | Excellent | Native | Yes | Over-engineering for v2 |

**Why NOT Puppeteer on Vercel:** Chromium binary is 150-400 MB. Vercel has a 50 MB function
bundle limit. Even `@sparticuz/chromium-min` is a significant operational burden, requires
a paid plan for sufficient timeout, and increases cold start dramatically. Do not add it.

**pdfmake integration pattern for multi-section reports:**

```js
// Client-side, in vanilla JS
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
pdfMake.vfs = pdfFonts.pdfMake.vfs;

const docDefinition = {
  pageOrientation: 'landscape',
  content: [
    { text: 'Executive Summary', style: 'header' },
    { text: analysisText, style: 'body' },
    { text: 'Data Tables', style: 'header', pageBreak: 'before' },
    {
      table: {
        headerRows: 1,
        widths: ['*', 'auto', 'auto'],
        body: tableRows
      }
    }
  ],
  styles: {
    header: { fontSize: 16, bold: true, margin: [0, 20, 0, 8] },
    body: { fontSize: 11, lineHeight: 1.4 }
  }
};

pdfMake.createPdf(docDefinition).download('meridian-report.pdf');
```

pdfmake handles page breaks, header repetition across pages, and table of contents natively.
It generates vector PDF with selectable text — a significant improvement over html2canvas rasterization.

**What to do with existing html2canvas + jsPDF:** Keep the dependency in place but restrict its use
to the "quick screenshot export" fallback (current feature). New multi-section report PDFs use pdfmake.

**Chart embedding in pdfmake:** pdfmake accepts base64-encoded images. For any charts in the report,
use `canvas.toDataURL('image/png')` to capture the chart, then pass to pdfmake as `{ image: dataUrl, width: 500 }`.
This is the standard pattern and requires no additional library.

---

## Packages to Add — Summary

```bash
npm install @anthropic-ai/sdk @vercel/blob pdfmake
```

| Package | Version | Purpose |
|---------|---------|---------|
| `@anthropic-ai/sdk` | `^0.95.1` | Claude Haiku 4.5 + Sonnet 4.6 API calls |
| `@vercel/blob` | `^2.3.3` | Store and serve shareable report snapshots |
| `pdfmake` | `^0.3.7` | Multi-section vector PDF generation (client-side) |

**No new packages for:** Anaplan auth (raw fetch), SSE streaming (Web Streams API), progress events (native EventSource).

---

## Packages NOT to Add

| Package | Why Not |
|---------|---------|
| `@ai-sdk/anthropic` | Vercel AI SDK abstraction — unnecessary wrapper for vanilla JS project |
| `puppeteer` / `playwright` | Bundle size exceeds Vercel function limits; cold start impact |
| `@sparticuz/chromium-min` | Still large; operational complexity outweighs benefit |
| `axios` | Native fetch covers all Anaplan and Claude needs in Node 18+ |
| `eventsource-parser` | Not needed when browser `EventSource` is the SSE consumer |
| `socket.io` / `ws` | WebSockets are over-engineered for unidirectional progress reporting |
| `pdf-lib` | Lower-level than pdfmake; requires more manual layout code for no benefit here |
| `html-to-pdfmake` | Adds fragility — define pdfmake doc structure directly from structured data |
| Any Anaplan community SDK | Unmaintained; the API surface needed is small enough to implement directly |

---

## Vercel Configuration Additions

```json
// vercel.json additions
{
  "functions": {
    "api/analyze.js": { "maxDuration": 60 }
  },
  "crons": [
    {
      "path": "/api/cleanup-blobs",
      "schedule": "0 3 * * *"
    }
  ]
}
```

**Environment variables to add:**
- `ANTHROPIC_API_KEY`
- `ANAPLAN_USERNAME`
- `ANAPLAN_PASSWORD`
- `ANAPLAN_WORKSPACE_ID`
- `ANAPLAN_MODEL_ID`
- `BLOB_READ_WRITE_TOKEN` (provisioned automatically via Vercel dashboard)
- `CRON_SECRET` (for securing the cleanup cron endpoint)

---

## Sources

- [@anthropic-ai/sdk npm page](https://www.npmjs.com/package/@anthropic-ai/sdk) — version 0.95.1
- [Anthropic Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview) — verified model IDs
- [@vercel/blob npm page](https://www.npmjs.com/package/@vercel/blob) — version 2.3.3
- [Vercel Blob docs](https://vercel.com/docs/vercel-blob)
- [Vercel Blob TTL community thread](https://community.vercel.com/t/vercel-blob-expiry-ttl-possible-workaround/17650) — confirms no native TTL
- [Vercel Streaming Functions docs](https://vercel.com/docs/functions/streaming-functions)
- [Vercel Function Duration docs](https://vercel.com/docs/functions/configuring-functions/duration) — 60s Hobby cap confirmed
- [Vercel Function Limits](https://vercel.com/docs/functions/limitations) — 4.5 MB payload, 50 MB bundle
- [Vercel Cron Jobs docs](https://vercel.com/docs/cron-jobs)
- [pdfmake npm page](https://www.npmjs.com/package/pdfmake) — version 0.3.7
- [Anaplan Integration API v2 Guide](https://anaplan.docs.apiary.io/)
- [Anaplan Basic Auth docs](https://help.anaplan.com/use-basic-authentication-3a4a2905-3d55-4199-a980-d1a89ffdcb7e)
