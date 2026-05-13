import { applyCors } from './_cors.js';

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Missing credentials' });
  }

  // Build Basic Auth header server-side — encoded string is never logged
  const encoded = Buffer.from(`${username}:${password}`).toString('base64');

  try {
    // Step 1: Authenticate with Anaplan
    const authRes = await fetch('https://auth.anaplan.com/token/authenticate', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${encoded}`,
        'Content-Type': 'application/json'
      },
      body: ''
    });

    if (!authRes.ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const authData = await authRes.json();
    // [ASSUMED] Field names tokenInfo.tokenValue and tokenInfo.expiresAt — confirmed in Anapedia docs
    // but live validation flagged in STATE.md research flags
    const token = authData?.tokenInfo?.tokenValue;
    const expiresAt = authData?.tokenInfo?.expiresAt; // epoch ms

    if (!token) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Step 2: Fetch workspace list
    const wsRes = await fetch('https://api.anaplan.com/2/0/workspaces', {
      headers: { 'Authorization': `AnaplanAuthToken ${token}` }
    });

    if (!wsRes.ok) {
      return res.status(502).json({ error: `Failed to fetch workspaces: HTTP ${wsRes.status}` });
    }
    const wsData = await wsRes.json();

    // Normalize workspace IDs to lowercase on receipt
    const workspaces = (wsData.workspaces || []).map(w => ({
      id: w.id.toLowerCase(),
      name: w.name
    }));

    // Step 3: Fetch model counts in small batches — B-07: all-at-once Promise.all
    // fires N simultaneous requests at login, triggering 429 storms on large tenants.
    // Batch size of 3 balances speed vs rate-limit pressure.
    const WS_BATCH = 3;
    const modelCounts = [];
    for (let i = 0; i < workspaces.length; i += WS_BATCH) {
      const batch = workspaces.slice(i, i + WS_BATCH);
      const batchCounts = await Promise.all(
        batch.map(ws =>
          fetch(`https://api.anaplan.com/2/0/workspaces/${ws.id}/models`, {
            headers: { 'Authorization': `AnaplanAuthToken ${token}` }
          })
          .then(r => r.ok ? r.json() : { models: [] })
          .then(data => (data.models || []).filter(m => m.activeState === 'UNLOCKED').length)
          .catch(() => 0) // partial failure: use 0, don't fail entire login
        )
      );
      modelCounts.push(...batchCounts);
    }

    const totalModels = modelCounts.reduce((sum, c) => sum + c, 0);

    // SEC-04: Return the Anaplan token so the client can use it directly on subsequent
    // calls — client no longer needs to store or re-send the password.
    return res.status(200).json({
      workspaces,
      tokenExpiresAt: expiresAt,
      tokenValue: token,
      totalModels
    });

  } catch (err) {
    // Only log err.message (string) — never log err object, req.body, or encoded
    console.error('Connect error:', err.message);
    return res.status(500).json({ error: 'Connection failed' });
  }
}
