---
phase: 4
slug: analysis
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-11
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — shell-based (node ESM import + grep), matching project convention |
| **Config file** | none |
| **Quick run command** | `node --input-type=module -e "import('/tmp/meridian-anaplan/api/analyze.js').then(m=>console.log('analyze OK:',typeof m.default))"` |
| **Full suite command** | `node --input-type=module -e "import('/tmp/meridian-anaplan/api/analyze.js').then(m=>console.log('analyze OK:',typeof m.default))" && grep -cE "countTokens|extractionPrePass" /tmp/meridian-anaplan/api/analyze.js && grep -cE "claude-sonnet\|claude-haiku" /tmp/meridian-anaplan/api/analyze.js && grep -cE "s-analysis\|renderAnalysis\|healthScore" /tmp/meridian-anaplan/index.html` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick run command
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** All success criteria pass manually
- **Max feedback latency:** 15 seconds

---

## Authoritative ANLZ Mapping (from REQUIREMENTS.md)

- **ANLZ-01** = Health score (0–100), verdict, executive summary, 5 dimension scores via Claude Sonnet
- **ANLZ-02** = Per-module suggestions with domain + triage tags via Claude Haiku
- **ANLZ-03** = Extraction pre-pass; token count < 180K; raw JSON never reaches Claude prompt
- **ANLZ-04** = Cross-module data flow story + clickable module drill-in with breadcrumb

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 4-01-01 | 01 | 1 | ANLZ-03 | token-leak | extractionPrePass() strips raw JSON before Claude calls | shell | `grep -cE "extractionPrePass\|countTokens" /tmp/meridian-anaplan/api/analyze.js` | ❌ W0 | ⬜ pending |
| 4-01-02 | 01 | 1 | ANLZ-01 | — | Sonnet health score call present with claude-sonnet-4-6 | shell | `grep -cE "claude-sonnet\|healthScore\|verdict" /tmp/meridian-anaplan/api/analyze.js` | ❌ W0 | ⬜ pending |
| 4-01-03 | 01 | 1 | ANLZ-02 | — | Haiku per-module suggestion call with triage tags | shell | `grep -cE "claude-haiku\|Fix Now\|Consider\|Monitor" /tmp/meridian-anaplan/api/analyze.js` | ❌ W0 | ⬜ pending |
| 4-01-04 | 01 | 1 | ANLZ-04 | — | Cross-module narrative generation present | shell | `grep -cE "narrative\|receives-from\|sends-to\|dataFlow" /tmp/meridian-anaplan/api/analyze.js` | ❌ W0 | ⬜ pending |
| 4-01-05 | 01 | 1 | ANLZ-03 | — | api/analyze.js exports default handler function | shell | `node --input-type=module -e "import('/tmp/meridian-anaplan/api/analyze.js').then(m=>console.log(typeof m.default))"` | ❌ W0 | ⬜ pending |
| 4-02-01 | 02 | 2 | ANLZ-01 | — | s-analysis screen renders health score + 5 dimensions | shell | `grep -cE "healthScore\|s-analysis\|dimension-score" /tmp/meridian-anaplan/index.html` | ✅ | ⬜ pending |
| 4-02-02 | 02 | 2 | ANLZ-02 | — | Suggestion cards with triage pills rendered in DOM | shell | `grep -cE "triage\|Fix Now\|renderSuggestions\|suggestion-card" /tmp/meridian-anaplan/index.html` | ✅ | ⬜ pending |
| 4-02-03 | 02 | 2 | ANLZ-04 | — | Module drill-in with breadcrumb wired in JS | shell | `grep -cE "drillIn\|breadcrumb\|receives-from\|sends-to" /tmp/meridian-anaplan/index.html` | ✅ | ⬜ pending |
| 4-03-01 | 03 | 3 | ANLZ-01 | — | vercel.json api/analyze.js maxDuration 60 | shell | `node --input-type=module -e "import { readFileSync } from 'fs'; const v=JSON.parse(readFileSync('/tmp/meridian-anaplan/vercel.json','utf8')); if(v.functions['api/analyze.js'].maxDuration!==60)process.exit(1); console.log('OK')"` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

`api/analyze.js` must be created in Plan 01 Wave 1. All grep checks against it depend on its existence. No test scaffold needed — shell verification only.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Health score + verdict renders from live blueprint Blob | ANLZ-01 | Requires live Anaplan session + BLOB_READ_WRITE_TOKEN | Connect → Picker → Fetch → Analyse; confirm score 0–100, verdict text, 5 dimension bars |
| Suggestions load per module with triage tags | ANLZ-02 | Requires Haiku API call against real blueprint | Confirm suggestions panel shows Fix Now / Consider / Monitor pills |
| Token count stays < 180K (countTokens pre-flight) | ANLZ-03 | Runtime value only visible in Vercel logs | Check Vercel function logs for "Token count: NNNK" line after analysis |
| Module drill-in navigates to per-module note | ANLZ-04 | Requires rendered DOM with clickable nodes | Click any module name in narrative; confirm drill-in panel with breadcrumb appears |
| Analysis completes in < 60s on COPS Demo (228 modules) | ANLZ-01+02 | Requires live run timing | Measure wall clock from "Analyse Model" click to "Complete" event |

---

## Validation Sign-Off

- [x] All tasks have automated verify or are human-verify checkpoints
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0: api/analyze.js created in Wave 1 — all subsequent greps have a valid target
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] nyquist_compliant: true set in frontmatter

**Approval:** ready
