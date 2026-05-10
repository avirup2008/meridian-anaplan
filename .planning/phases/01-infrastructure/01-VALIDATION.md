---
phase: 1
slug: infrastructure
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-10
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — Phase 1 is scaffolding only; verification is via shell commands and smoke test |
| **Config file** | none |
| **Quick run command** | `npm install && node --input-type=module -e "import('./api/generate.js').then(m=>console.log(typeof m.default))"` |
| **Full suite command** | `npm install && grep -c "SECTION:" index.html && node --input-type=module -e "import Anthropic from '@anthropic-ai/sdk'; console.log('SDK OK')"` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm install` (confirms package resolution clean)
- **After every plan wave:** Run full suite command above
- **Before `/gsd-verify-work`:** All four success criteria must pass manually
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | INFRA-02 | — | package.json declares exact pinned versions | shell | `node --input-type=module -e "import { readFileSync } from 'fs'; const p=JSON.parse(readFileSync('./package.json','utf8')); console.log(JSON.stringify(p.dependencies))"` | ✅ created in task | ⬜ pending |
| 1-01-02 | 01 | 1 | INFRA-03 | — | vercel.json functions{} block present with correct maxDuration values | shell | `node --input-type=module -e "import { readFileSync } from 'fs'; const v=JSON.parse(readFileSync('./vercel.json','utf8')); console.log(JSON.stringify(v.functions))"` | ✅ | ⬜ pending |
| 1-02-01 | 02 | 2 | INFRA-04 | — | api/generate.js imports Anthropic, no Gemini references | shell | `grep -c "Anthropic" api/generate.js && (grep -ci "gemini" api/generate.js \|\| true)` | ✅ | ⬜ pending |
| 1-02-02 | 02 | 2 | INFRA-01 | — | index.html has section boundary comments | shell | `grep -c "SECTION:" index.html` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

**No Wave 0 tasks needed.** package.json is the artifact being created in Task 1-01-01 (it IS the deliverable, not a test scaffold). All other files (vercel.json, api/generate.js, index.html) already exist on disk. Phase 1 is pure scaffolding with no test framework requirement — every task has a direct shell-level automated verify command.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `ANTHROPIC_API_KEY` set in Vercel dashboard | INFRA-04 | Env var requires Vercel UI access — cannot be scripted | Log into Vercel → Project Settings → Environment Variables → add ANTHROPIC_API_KEY |
| `npm install` succeeds cleanly | INFRA-02 | Requires network access to npm registry | Run `npm install` in project root; confirm exit 0 and no peer dep warnings |
| api/generate.js returns valid Claude Haiku response | INFRA-04 | Requires live ANTHROPIC_API_KEY | POST to /api/generate locally or via Vercel preview URL with a sample CSV payload |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (no Wave 0 needed — package.json is a deliverable, not test scaffold)
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
