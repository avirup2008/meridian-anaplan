export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-anaplan-user, x-anaplan-pass, x-anaplan-workspace');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const workspaceId = req.query.workspaceId;
  const username = req.headers['x-anaplan-user'];
  const password = req.headers['x-anaplan-pass'];

  if (!workspaceId || !username || !password) {
    return res.status(400).json({ error: 'Missing workspaceId or credentials' });
  }

  // Normalize workspace ID to lowercase
  const wsId = workspaceId.toLowerCase();

  // Build Basic Auth header server-side — encoded string is never logged
  const encoded = Buffer.from(`${username}:${password}`).toString('base64');

  try {
    // Step 1: Re-authenticate with Anaplan
    const authRes = await fetch('https://auth.anaplan.com/token/authenticate', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${encoded}`,
        'Content-Type': 'application/json'
      }
    });

    if (!authRes.ok) {
      return res.status(401).json({ error: 'Auth failed — please reconnect' });
    }

    const { tokenInfo } = await authRes.json();

    if (!tokenInfo || !tokenInfo.tokenValue) {
      return res.status(401).json({ error: 'Auth failed — please reconnect' });
    }

    // Step 2: Fetch models for the specified workspace
    const modRes = await fetch(
      `https://api.anaplan.com/2/0/workspaces/${wsId}/models`,
      { headers: { 'Authorization': `AnaplanAuthToken ${tokenInfo.tokenValue}` } }
    );

    const modData = await modRes.json();

    // Only show UNLOCKED models — filter out ARCHIVED, LOCKED, etc.
    const models = (modData.models || [])
      .filter(m => m.activeState === 'UNLOCKED')
      .map(m => ({
        id: m.id,
        name: m.name,
        activeState: m.activeState,
        lastModified: m.lastModified,
        currentWorkspaceName: m.currentWorkspaceName
      }));

    return res.status(200).json({ models });

  } catch (err) {
    // Only log err.message (string) — never log err object, headers, or encoded
    console.error('Models error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch models' });
  }
}
