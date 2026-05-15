import { applyCors } from './_cors.js';

// Temporary diagnostic endpoint — remove after debugging
export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const keyPresent = !!process.env.ANTHROPIC_API_KEY;
  const keyPrefix = process.env.ANTHROPIC_API_KEY?.slice(0, 12) || '(none)';

  let result = { keyPresent, keyPrefix };

  // Simulate the actual workstreams call size: 80 module names + findings + blast radius
  const fakeModules = Array.from({length: 80}, (_, i) => `CAL${String(i+1).padStart(2,'0')} - Workforce Planning Calculation Module ${i+1}`).join('\n');
  const fakeFindings = `FORMULA issues (47 total):\n  FORMULA_SUM_LOOKUP: 23 occurrences — modules: CAL01; CAL07; CAL12; CAL19; CAL23\n  FORMULA_NESTED_IF: 18 occurrences — modules: CAL03; CAL08; CAL14\nROLLUP issues (12 total):\n  RATE_SUMMARY_SUM: 12 occurrences — modules: CAL02; CAL05; CAL11\nNAMING issues (40 total):\n  MODULE_NAMING_PATTERN: 40 occurrences — modules: CAL01; DAT01; REP01\nARCHITECTURE signals (8 total):\n  ARCH_OUTPUT_READS_RAW_LAYER: 8 occurrences — modules: REP01; REP02; REP03`;

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();
    const t0 = Date.now();
    const resp = await Promise.race([
      client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{ role: 'user', content: `You are a senior Anaplan model reviewer. Respond with VALID JSON only.\n\nREAL MODULE NAMES:\n${fakeModules}\n\nFINDINGS:\n${fakeFindings}\n\nReturn JSON: {"workstreams":[{"id":"ws-1","title":"Test workstream citing CAL01","priority":"High","confidence":"Medium","kind":"remediation","whyItMatters":"CAL01 has 23 SUM-IF issues affecting downstream modules. This creates recalculation risk.","reviewQuestion":"Are SUM-IF formulas in CAL01 intentional?","action":"Review CAL01 formula patterns","evidenceCount":23,"examples":["CAL01.Revenue Forecast — nested SUM-IF"]}]}` }],
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout-35s')), 35000)),
    ]);
    result.success = true;
    result.elapsedMs = Date.now() - t0;
    result.response = resp.content?.[0]?.text?.slice(0, 200);
  } catch (e) {
    result.success = false;
    result.errorClass = e.constructor.name;
    result.message = e.message;
    result.status = e.status;
    result.errorType = e.error?.type;
    result.errorBody = e.error;
  }

  return res.status(200).json(result);
}
