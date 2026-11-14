// api/sync.js — Upstash Redis cloud sync for BusinessTrack
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Find Upstash env vars (Vercel integration uses various naming conventions)
  const KV_URL = process.env.KV_REST_API_URL ||
                 process.env.UPSTASH_REDIS_REST_URL ||
                 process.env.BUSINESSTRACK_KV_REST_API_URL ||
                 process.env.STORAGETRACK_KV_REST_API_URL;

  const KV_TOKEN = process.env.KV_REST_API_TOKEN ||
                   process.env.UPSTASH_REDIS_REST_TOKEN ||
                   process.env.BUSINESSTRACK_KV_REST_API_TOKEN ||
                   process.env.STORAGETRACK_KV_REST_API_TOKEN;

  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ error: 'KV not configured', found: false });
  }

  const KEY = 'bt-data';

  async function kvGet(key) {
    const r = await fetch(`${KV_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      signal: AbortSignal.timeout(6000),
    });
    const j = await r.json();
    return j.result;
  }

  async function kvSet(key, value) {
    await fetch(`${KV_URL}/set/${key}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
      signal: AbortSignal.timeout(6000),
    });
  }

  try {
    if (req.method === 'GET') {
      const raw = await kvGet(KEY);
      if (!raw) return res.json({ found: false });
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return res.json({ found: true, data });

    } else if (req.method === 'POST') {
      const body = req.body || {};
      const incoming = body.data;
      const incomingMod = body.lastMod || 0;
      const isForce = body.force === true;

      if (!incoming) return res.status(400).json({ error: 'Missing data' });

      if (isForce) {
        await kvSet(KEY, JSON.stringify(incoming));
        return res.json({ ok: true, action: 'force-pushed' });
      }

      // Conflict resolution: compare lastMod
      const raw = await kvGet(KEY);
      if (!raw) {
        await kvSet(KEY, JSON.stringify(incoming));
        return res.json({ ok: true, action: 'initial-push' });
      }

      const cloud = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const cloudMod = cloud.lastMod || 0;

      if (incomingMod >= cloudMod) {
        await kvSet(KEY, JSON.stringify(incoming));
        return res.json({ ok: true, action: 'updated' });
      }

      return res.json({ ok: true, action: 'skipped-cloud-newer', cloudMod, incomingMod });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
