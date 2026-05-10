---
phase: 1
slug: infrastructure
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-10
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — Phase 1 is scaffolding only; verification is via shell commands and smoke test |
| **Config file** | none — Wave 0 installs npm |
| **Quick run command** | `npm install && node -e "require('./api/generate.js')"` |
| **Full suite command** | `npm install && grep -c "SECTION:" index.html && node -e "const a=require('@anthropic-ai/sdk'); console.log('SDK OK')"` |
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
| 1-01-01 | 01 | 1 | INFRA-02 | — | package.json declares exact pinned versions | shell | `node -e "const p=require('./package.json'); console.log(p.dependencies)"` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | INFRA-03 | — | vercel.json functions{} block present with correct maxDuration values | shell | `node -e "const v=require('./vercel.json'); console.log(JSON.stringify(v.functions))"` | ✅ | ⬜ pending |
| 1-01-03 | 01 | 2 | INFRA-04 | — | api/generate.js imports Anthropic, no Gemini references | shell | `grep -c "Anthropic" api/generate.js && grep -c "gemini" api/generate.js \|\| true` | ✅ | ⬜ pending |
| 1-01-04 | 01 | 2 | INFRA-01 | — | index.html has section boundary comments | shell | `grep -c "=== SECTION:" index.html` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `package.json` — must be created before npm install can run; all dependency tasks depend on it

*All other files (vercel.json, api/generate.js, index.html) already exist.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `ANTHROPIC_API_KEY` set in Vercel dashboard | INFRA-04 | Env var requires Vercel UI access — cannot be scripted | Log into Vercel → Project Settings → Environment Variables → add ANTHROPIC_API_KEY |
| `npm install` succeeds cleanly | INFRA-02 | Requires network access to npm registry | Run `npm install` in project root; confirm exit 0 and no peer dep warnings |
| api/generate.js returns valid Claude Haiku response | INFRA-04 | Requires live ANTHROPIC_API_KEY | POST to /api/generate locally or via Vercel preview URL with a sample CSV payload |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
