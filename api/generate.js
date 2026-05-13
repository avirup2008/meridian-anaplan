import Anthropic from '@anthropic-ai/sdk';
import { applyCors } from './_cors.js';

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, maxTokens } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: Math.min(maxTokens || 400, 8192),
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content?.[0]?.text || '';
    return res.status(200).json({ text });

  } catch (err) {
    console.error('Server error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
