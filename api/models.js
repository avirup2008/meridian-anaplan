import { applyCors } from './_cors.js';

export default async function handler(req, res) {
  applyCors(req, res, 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const workspaceId = req.query.workspaceId;
  if (!workspaceId) {
    return res.status(400).json({ error: 'Missing workspaceId' });
  }

  // Normalize workspace ID to lowercase
  const wsId = workspaceId.toLowerCase();

  // SEC-04/SEC-05: Accept a pre-issued Anaplan token directly — no need to re-authenticate
  // on every call and no need to receive the user's password.
  // Falls back to user/pass re-auth for backwards compatibility during rollout.
  const directToken = req.headers['x-anaplan-token'];

  let token;
  if (directToken) {
    // Fast path: use the token the client already holds from /api/connect
    token = directToken;
  } else {
    // Legacy path: re-authenticate with credentials (kept for rollback safety)
    const username = req.headers['x-anaplan-user'];
    const password = req.headers['x-anaplan-pass'];

    if (!username || !password) {
      return res.status(400).json({ error: 'Missing credentials or token' });
    }

    const encoded = Buffer.from(`${username}:${password}`).toString('base64');

    try {
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
      token = tokenInfo.tokenValue;
    } catch (err) {
      console.error('Models auth error:', err.message);
      return res.status(500).json({ error: 'Failed to fetch models' });
    }
  }

  try {
    const modRes = await fetch(
      `https://api.anaplan.com/2/0/workspaces/${wsId}/models`,
      { headers: { 'Authorization': `AnaplanAuthToken ${token}` } }
    );

    if (!modRes.ok) {
      return res.status(502).json({ error: `Failed to fetch models: HTTP ${modRes.status}` });
    }
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
    console.error('Models error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch models' });
  }
}
