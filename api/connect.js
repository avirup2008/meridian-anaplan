export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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

    const wsData = await wsRes.json();

    // Normalize workspace IDs to lowercase on receipt
    const workspaces = (wsData.workspaces || []).map(w => ({
      id: w.id.toLowerCase(),
      name: w.name
    }));

    // Step 3: Fetch model counts for all workspaces in parallel
    const modelCounts = await Promise.all(
      workspaces.map(ws =>
        fetch(`https://api.anaplan.com/2/0/workspaces/${ws.id}/models`, {
          headers: { 'Authorization': `AnaplanAuthToken ${token}` }
        })
        .then(r => r.ok ? r.json() : { models: [] })
        .then(data => (data.models || []).length)
        .catch(() => 0) // partial failure: use 0 for this workspace, don't fail entire call
      )
    );

    const totalModels = modelCounts.reduce((sum, c) => sum + c, 0);

    return res.status(200).json({
      workspaces,
      tokenExpiresAt: expiresAt,
      totalModels
    });

  } catch (err) {
    // Only log err.message (string) — never log err object, req.body, or encoded
    console.error('Connect error:', err.message);
    return res.status(500).json({ error: 'Connection failed' });
  }
}
