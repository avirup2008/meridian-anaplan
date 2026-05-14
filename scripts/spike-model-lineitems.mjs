/**
 * Phase 6 API Spike — Model-Level lineItems Endpoint
 *
 * PURPOSE: One-time investigation script. Confirms the response shape of:
 *   GET /workspaces/{wsId}/models/{modelId}/lineItems?includeAll=true
 *
 * Resolves four unknowns that block Phase 6 Plan 02:
 *   1. Does the endpoint exist and return 200?
 *   2. Does it return formula text when includeAll=true?
 *   3. Does it paginate? If so, what is the cursor field name?
 *   4. What exact field name on each line item identifies the parent module?
 *
 * USAGE (run from project root):
 *   ANAPLAN_USER='your@email.com' \
 *   ANAPLAN_PASS='yourpassword' \
 *   ANAPLAN_WORKSPACE_ID='your-workspace-id' \
 *   ANAPLAN_MODEL_ID='your-model-id' \
 *   node scripts/spike-model-lineitems.mjs 2>&1 | tee .planning/phases/06-model-state-foundation/06-SPIKE-OUTPUT.txt
 *
 * NOTE: This script is for one-time investigation only. It is checked in so the spike
 * is reproducible but is NOT imported by any production code.
 *
 * SECURITY: safeLog() strips all credential-related keys before printing. The token,
 * password, and Authorization header value are NEVER logged.
 */

// ─── NEVER-LOG list (matches blueprint.js safeLog convention) ──────────────
const NEVER_LOG = ['authorization', 'password', 'token', 'tokenvalue', 'x-anaplan-user', 'x-anaplan-pass'];

/**
 * Recursively strips NEVER_LOG keys from an object before printing.
 * @param {string} label
 * @param {unknown} obj
 */
function safeLog(label, obj) {
  function sanitize(val) {
    if (val === null || typeof val !== 'object') return val;
    if (Array.isArray(val)) return val.map(sanitize);
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      if (NEVER_LOG.includes(k.toLowerCase())) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitize(v);
      }
    }
    return out;
  }
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(sanitize(obj), null, 2));
}

// ─── Environment validation ─────────────────────────────────────────────────
const REQUIRED_VARS = ['ANAPLAN_USER', 'ANAPLAN_PASS', 'ANAPLAN_WORKSPACE_ID', 'ANAPLAN_MODEL_ID'];
const missing = REQUIRED_VARS.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error('\n[spike] ERROR: Missing required environment variables:');
  missing.forEach(v => console.error(`  ${v}`));
  console.error('\nUsage:');
  console.error('  ANAPLAN_USER=\'your@email.com\' \\');
  console.error('  ANAPLAN_PASS=\'yourpassword\' \\');
  console.error('  ANAPLAN_WORKSPACE_ID=\'your-workspace-id\' \\');
  console.error('  ANAPLAN_MODEL_ID=\'your-model-id\' \\');
  console.error('  node scripts/spike-model-lineitems.mjs');
  process.exit(1);
}

// Lowercase IDs per blueprint.js convention
const wsId    = process.env.ANAPLAN_WORKSPACE_ID.toLowerCase();
const modelId = process.env.ANAPLAN_MODEL_ID.toLowerCase();
const username = process.env.ANAPLAN_USER;
const password = process.env.ANAPLAN_PASS;

console.log('[spike] Phase 6 API Spike — Model-Level lineItems Endpoint');
console.log(`[spike] Workspace ID: ${wsId}`);
console.log(`[spike] Model ID:     ${modelId}`);
console.log('[spike] Starting authentication...');

// ─── Step 1: Authenticate ───────────────────────────────────────────────────
const encoded = Buffer.from(`${username}:${password}`).toString('base64');
const authRes = await fetch('https://auth.anaplan.com/token/authenticate', {
  method: 'POST',
  headers: {
    'Authorization': `Basic ${encoded}`,
    'Content-Type': 'application/json',
  },
  body: '',
});

console.log(`[spike] Auth response status: ${authRes.status}`);

if (!authRes.ok) {
  const body = await authRes.text();
  console.error('[spike] Auth failed. Response body:');
  console.error(body);
  process.exit(1);
}

const authData = await authRes.json();
const token = authData?.tokenInfo?.tokenValue;

if (!token) {
  console.error('[spike] Auth succeeded but no tokenValue found. Full auth response:');
  safeLog('authData', authData);
  process.exit(1);
}

console.log('[spike] Authentication successful. Token obtained (not logged).');

// ─── Step 2: Fire parallel requests ────────────────────────────────────────
const MODULES_URL    = `https://api.anaplan.com/2/0/workspaces/${wsId}/models/${modelId}/modules`;
const LINEITEMS_URL  = `https://api.anaplan.com/2/0/workspaces/${wsId}/models/${modelId}/lineItems?includeAll=true`;

console.log('\n[spike] Firing parallel requests...');
console.log(`[spike]   → ${MODULES_URL}`);
console.log(`[spike]   → ${LINEITEMS_URL}`);

const [modRes, liRes] = await Promise.all([
  fetch(MODULES_URL,   { headers: { 'Authorization': `AnaplanAuthToken ${token}` } }),
  fetch(LINEITEMS_URL, { headers: { 'Authorization': `AnaplanAuthToken ${token}` } }),
]);

// ─── Step 3: Inspect /modules response ─────────────────────────────────────
console.log('\n─────────────────────────────────────────────────────────────────');
console.log('ENDPOINT 1: /modules');
console.log('─────────────────────────────────────────────────────────────────');
console.log(`status: ${modRes.status} ${modRes.statusText}`);

const modHeaders = {};
for (const [k, v] of modRes.headers.entries()) {
  modHeaders[k] = v;
}
console.log('response headers (selected):');
console.log(`  content-type:    ${modHeaders['content-type'] ?? '(none)'}`);
console.log(`  link:            ${modHeaders['link'] ?? '(none)'}`);
console.log(`  x-pagination-*:  ${Object.keys(modHeaders).filter(k => k.startsWith('x-pagination')).join(', ') || '(none)'}`);

if (modRes.ok) {
  const modBody = await modRes.json();
  safeLog('/modules — top-level keys', Object.keys(modBody));
  const mods = modBody.modules || modBody.items || modBody.data || [];
  console.log(`\n[spike] Modules count: ${mods.length}`);
  if (mods.length > 0) {
    safeLog('/modules — first module field names', Object.keys(mods[0]));
    safeLog('/modules — first module (sample)', mods[0]);
  }
} else {
  const errBody = await modRes.text();
  console.error(`[spike] /modules request failed: HTTP ${modRes.status}`);
  console.error(errBody.slice(0, 2000));
}

// ─── Step 4: Inspect /lineItems?includeAll=true response ───────────────────
console.log('\n─────────────────────────────────────────────────────────────────');
console.log('ENDPOINT 2: /lineItems?includeAll=true');
console.log('─────────────────────────────────────────────────────────────────');
console.log(`status: ${liRes.status} ${liRes.statusText}`);

const liHeaders = {};
for (const [k, v] of liRes.headers.entries()) {
  liHeaders[k] = v;
}
console.log('response headers (selected):');
console.log(`  content-type:    ${liHeaders['content-type'] ?? '(none)'}`);
console.log(`  link:            ${liHeaders['link'] ?? '(none)'}`);
const paginationHeaders = Object.keys(liHeaders).filter(k =>
  k.startsWith('x-pagination') || k === 'link'
);
console.log(`  pagination headers found: ${paginationHeaders.join(', ') || '(none)'}`);

if (liRes.ok) {
  const liBody = await liRes.json();

  // Top-level structure
  safeLog('/lineItems — top-level keys', Object.keys(liBody));

  // Truncated raw body (first 8KB)
  const rawJson = JSON.stringify(liBody, null, 2);
  console.log('\n/lineItems — raw body (first 8000 chars):');
  console.log(rawJson.slice(0, 8000));
  if (rawJson.length > 8000) {
    console.log(`\n[spike] ... (truncated — full body is ${rawJson.length} chars)`);
  }

  // Identify the items array
  const items = liBody.items ?? liBody.lineItems ?? liBody.data ?? [];
  console.log(`\n[spike] Line items array key found: ${
    liBody.items != null ? '"items"' :
    liBody.lineItems != null ? '"lineItems"' :
    liBody.data != null ? '"data"' :
    '(unknown — check top-level keys above)'
  }`);
  console.log(`[spike] Total line items in this response: ${items.length}`);

  // Field names on the first line item — this reveals the moduleId field name
  if (items.length > 0) {
    safeLog('/lineItems — first line item field names', Object.keys(items[0]));
    safeLog('/lineItems — first line item (sample)', items[0]);

    // Formula presence
    const firstFormula = items[0]?.formula;
    console.log(`\n[spike] formula field type on items[0]: ${typeof firstFormula}`);
    if (firstFormula != null) {
      console.log(`[spike] first non-null formula (first 200 chars): ${String(firstFormula).slice(0, 200)}`);
    } else {
      // Check for a non-null formula anywhere in the first 50 items
      const sample = items.slice(0, 50);
      const withFormula = sample.find(li => li.formula != null && li.formula !== '');
      if (withFormula) {
        console.log(`[spike] formula is null on items[0] but found on items[${sample.indexOf(withFormula)}]:`);
        console.log(`  formula: ${String(withFormula.formula).slice(0, 200)}`);
      } else {
        console.log('[spike] formula field is null/empty on first 50 items — formulaFieldPresent may be NO');
      }
    }

    // Module ID field detection — this is the key unknown
    const firstItem = items[0];
    const moduleIdCandidates = Object.keys(firstItem).filter(k =>
      k.toLowerCase().includes('module') || k.toLowerCase().includes('parent')
    );
    console.log(`\n[spike] Module-related field candidates on line item: ${JSON.stringify(moduleIdCandidates)}`);
    for (const key of moduleIdCandidates) {
      console.log(`  ${key}: ${JSON.stringify(firstItem[key])}`);
    }
  }

  // Pagination signals
  const paginationFields = Object.keys(liBody).filter(k =>
    k.toLowerCase().includes('page') ||
    k.toLowerCase().includes('cursor') ||
    k.toLowerCase().includes('next') ||
    k.toLowerCase().includes('total') ||
    k === 'meta'
  );
  console.log(`\n[spike] Pagination-related top-level fields: ${JSON.stringify(paginationFields)}`);
  for (const f of paginationFields) {
    console.log(`  ${f}: ${JSON.stringify(liBody[f])}`);
  }

  // meta field (common Anaplan pattern)
  if (liBody.meta) {
    safeLog('/lineItems — meta field', liBody.meta);
  }

} else {
  const errBody = await liRes.text();
  console.error(`[spike] /lineItems request failed: HTTP ${liRes.status}`);
  console.error(errBody.slice(0, 2000));
}

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n─────────────────────────────────────────────────────────────────');
console.log('SPIKE COMPLETE — review output above and fill in 06-SPIKE-RESULT.md');
console.log('─────────────────────────────────────────────────────────────────');
console.log('Key questions to answer from this output:');
console.log('  1. endpointExists: Did /lineItems return 200? (check "status:" line above)');
console.log('  2. topLevelItemsField: Was it "items", "lineItems", or "data"?');
console.log('  3. moduleIdField: Which field name links each line item to its module?');
console.log('  4. formulaFieldPresent: Was formula non-null on any line item?');
console.log('  5. paginationPresent: Were any pagination-related fields found?');
