// SEC-02: Shared CORS helper — restricts Access-Control-Allow-Origin from * to known origins.
// Import and call applyCors(req, res) at the top of every handler, before the OPTIONS check.

// CORS_ORIGIN env var: single origin or comma-separated list for multi-alias setups.
// Default: production alias. Add preview URLs to the env var when needed.
const ALLOWED_ORIGINS = new Set(
  (process.env.CORS_ORIGIN || 'https://meridian-anaplan.vercel.app')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  // Allow localhost for local development
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return true;
  // Allow Vercel preview deploy URLs for this project
  if (/^https:\/\/meridian-anaplan[a-z0-9-]*\.vercel\.app$/.test(origin)) return true;
  return false;
}

export function applyCors(req, res, methods = 'POST, OPTIONS') {
  const origin = req.headers.origin || '';
  // Reflect allowed origin; fall back to primary allowed origin for non-browser clients
  const reflected = isAllowedOrigin(origin) ? origin : [...ALLOWED_ORIGINS][0];
  res.setHeader('Access-Control-Allow-Origin', reflected);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', methods);
  // x-anaplan-token replaces x-anaplan-pass in SEC-04; keep old headers for rollback safety
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, x-anaplan-user, x-anaplan-pass, x-anaplan-token, x-anaplan-workspace');
}
