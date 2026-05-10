---
phase: 2
slug: connection
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-10
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — Phase 2 is server + client code; verification is via shell commands, grep checks, and node module import tests |
| **Config file** | none |
| **Quick run command** | `node --input-type=module -e "import('./api/connect.js').then(m=>console.log(typeof m.default))"` |
| **Full suite command** | `grep -c 'anaplan.com' /tmp/meridian-anaplan/index.html \|\| true && node --input-type=module -e "import('./api/connect.js').then(m=>console.log('connect OK:',typeof m.default))" && node --input-type=module -e "import('./api/models.js').then(m=>console.log('models OK:',typeof m.default))"` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick run command (confirms new module parses and exports correctly)
- **After every plan wave:** Run full suite command above
- **Before `/gsd-verify-work`:** All success criteria must pass manually
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 1 | CONN-01 | cred-leak | credentials only in headers, never logged | shell | `grep -c "x-anaplan-user" /tmp/meridian-anaplan/api/models.js` | ✅ created in task | ⬜ pending |
| 2-01-02 | 01 | 1 | CONN-01 | cred-log | no console.log of credentials server-side | shell | `grep -ci "console.log.*password\|console.log.*pass\b" /tmp/meridian-anaplan/api/connect.js; echo "exit:$?"` | ✅ | ⬜ pending |
| 2-01-03 | 01 | 1 | INFRA-03 | — | vercel.json functions block includes connect.js and models.js | shell | `node --input-type=module -e "import { readFileSync } from 'fs'; const v=JSON.parse(readFileSync('/tmp/meridian-anaplan/vercel.json','utf8')); if(!v.functions['api/connect.js']||!v.functions['api/models.js'])process.exit(1); console.log('OK')"` | ✅ | ⬜ pending |
| 2-02-01 | 02 | 2 | CONN-02 | — | models endpoint exports default function | shell | `node --input-type=module -e "import('./api/models.js').then(m=>console.log(typeof m.default))"` | ✅ | ⬜ pending |
| 2-02-02 | 02 | 2 | CONN-04 | — | CSV fallback path intact (no anaplan.com refs in index.html) | shell | `grep -c 'anaplan.com' /tmp/meridian-anaplan/index.html; echo "exit:$?"` | ✅ | ⬜ pending |
| 2-03-01 | 03 | 3 | CONN-03 | expiry | tokenExpiresAt stored and checked before API calls | shell | `grep -c "tokenExpiresAt" /tmp/meridian-anaplan/index.html` | ✅ | ⬜ pending |
| 2-03-02 | 03 | 3 | CONN-02 | — | recently-used models in localStorage only (not sessionStorage with credentials) | shell | `grep -c "meridian_recent_models\|getRecentModels\|addToRecents" /tmp/meridian-anaplan/index.html` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

**Wave 0 tasks needed:** `api/connect.js` and `api/models.js` are created in their respective plan tasks (Plans 01 and 02 respectively). No pre-existing test scaffold required — verification is shell-level module import tests.

**vercel.json update** is a Phase 2 Wave 1 task — adds `api/connect.js` and `api/models.js` to the `functions{}` block. This must happen before deployment.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| POST /api/connect with valid Anaplan credentials returns workspace list | CONN-01 | Requires live Anaplan account + ANTHROPIC_API_KEY | curl POST to /api/connect with valid creds; confirm 200 + workspaces array |
| Token expiry re-auth prompt fires at ~35 min | CONN-03 | Requires real time passage or clock manipulation | Connect, wait 35 min (or mock tokenExpiresAt to past timestamp), trigger any API call; confirm re-auth modal appears |
| CSV upload fallback still works end-to-end | CONN-04 | Requires live /api/generate endpoint + ANTHROPIC_API_KEY | Upload a sample CSV in the app; confirm analysis appears |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
