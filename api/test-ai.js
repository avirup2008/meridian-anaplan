import { applyCors } from './_cors.js';

// Temporary diagnostic endpoint — remove after debugging
export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const keyPresent = !!process.env.ANTHROPIC_API_KEY;
  const keyPrefix = process.env.ANTHROPIC_API_KEY?.slice(0, 12) || '(none)';

  let result = { keyPresent, keyPrefix };

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();
    const resp = await Promise.race([
      client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say OK.' }],
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout-15s')), 15000)),
    ]);
    result.success = true;
    result.response = resp.content?.[0]?.text;
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
