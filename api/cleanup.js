import { list, del } from '@vercel/blob';
import { applyCors } from './_cors.js';

// 6.75 days = 6 days 18 hours, in ms. Chosen tighter than 7 days to absorb
// Hobby plan cron timing variance (±59 min) so reports are reliably gone by 7d.
const TTL_MS = 6.75 * 24 * 60 * 60 * 1000; // 583,200,000

const PREFIXES = ['reports/'];

export default async function handler(req, res) {
  applyCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // CRON_SECRET auth (Vercel sends: Authorization: Bearer <secret>)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const now = Date.now();
  const results = { scanned: 0, deleted: 0, errors: 0, prefixes: {} };

  for (const prefix of PREFIXES) {
    let cursor = undefined;
    let prefixDeleted = 0;
    let prefixScanned = 0;
    do {
      const page = await list({ prefix, cursor, limit: 100 });
      cursor = page.cursor;
      for (const blob of (page.blobs || [])) {
        prefixScanned++;
        results.scanned++;
        const uploadedAtMs = new Date(blob.uploadedAt).getTime();
        if (isNaN(uploadedAtMs)) continue;
        const ageMs = now - uploadedAtMs;
        if (ageMs > TTL_MS) {
          try {
            await del(blob.url);
            results.deleted++;
            prefixDeleted++;
          } catch (e) {
            results.errors++;
          }
        }
      }
    } while (cursor);
    results.prefixes[prefix] = { scanned: prefixScanned, deleted: prefixDeleted };
  }

  return res.status(200).json(results);
}
