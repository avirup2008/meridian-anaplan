import { put, list } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { applyCors } from './_cors.js';

const SHARE_PREFIX = 'reports/';
const MAX_PAYLOAD_BYTES = 1_048_576; // 1 MB hard cap on payload size

export default async function handler(req, res) {
  applyCors(req, res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') return handlePost(req, res);
  if (req.method === 'GET')  return handleGet(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handlePost(req, res) {
  try {
    const body = req.body || {};
    const payload = body.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ error: 'Missing or invalid payload object' });
    }
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) {
      return res.status(413).json({ error: 'Payload exceeds 1 MB limit' });
    }
    const shareId = randomUUID();
    const blob = await put(
      `${SHARE_PREFIX}${shareId}.json`,
      serialized,
      { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true }
    );
    return res.status(200).json({
      shareId,
      shareUrl: `/report?id=${shareId}`,
      blobUrl: blob.url
    });
  } catch (err) {
    return res.status(500).json({ error: 'Share create failed', detail: String(err?.message || err) });
  }
}

async function handleGet(req, res) {
  try {
    const id = (req.query?.id || '').toString();
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return res.status(400).json({ error: 'Invalid id format' });
    }
    const { blobs } = await list({ prefix: `${SHARE_PREFIX}${id}.json`, limit: 1 });
    if (!blobs || blobs.length === 0) {
      return res.status(404).json({ error: 'Report not found or expired' });
    }
    return res.status(200).json({ blobUrl: blobs[0].url });
  } catch (err) {
    return res.status(500).json({ error: 'Share lookup failed', detail: String(err?.message || err) });
  }
}
