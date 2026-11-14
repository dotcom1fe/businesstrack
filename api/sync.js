// api/sync.js — Upstash Redis cloud sync for BusinessTrack
// Data lives under the single key "bt-data", so this can share a database with other apps.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Vercel/Upstash name these differently depending on how the database was connected
  // (KV_REST_API_URL, UPSTASH_REDIS_REST_URL, or either with a custom prefix), so match by suffix.
  const env = process.env;
  const pick = (suffixes) => {
    for (const s of suffixes) if (env[s]) return env[s];
    for (const s of suffixes) { const k = Object.keys(env).find((k) => k.endsWith(s) && env[k]); if (k) return env[k]; }
  };
  const KV_URL = pick(['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL']);
  const KV_TOKEN = pick(['KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN']);
  if (!KV_URL || !KV_TOKEN) return res.status(500).json({ error: 'KV not configured', found: false });

  const KEY = 'bt-data';
  const call = async (path, body) => {
    const r = await fetch(`${KV_URL.replace(/\/$/, '')}/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      body,
      signal: AbortSignal.timeout(6000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || `Upstash responded ${r.status}`);
    return j.result;
  };
  // Earlier versions stored the JSON double-encoded; keep parsing until we have the object.
  const read = async () => {
    let v = await call(`get/${KEY}`);
    for (let i = 0; i < 3 && typeof v === 'string'; i++) { try { v = JSON.parse(v); } catch (e) { return null; } }
    return v && typeof v === 'object' ? v : null;
  };
  const write = (data) => call(`set/${KEY}`, JSON.stringify(data));

  try {
    if (req.method === 'GET') {
      const data = await read();
      return res.json(data ? { found: true, data } : { found: false });
    }
    if (req.method === 'POST') {
      const { data, lastMod = 0, force } = req.body || {};
      if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Missing data' });
      if (force) { await write(data); return res.json({ ok: true, action: 'force-pushed' }); }
      const cloud = await read();
      if (cloud && (cloud.lastMod || 0) > lastMod) return res.json({ ok: true, action: 'skipped-cloud-newer' });
      await write(data);
      return res.json({ ok: true, action: cloud ? 'updated' : 'initial-push' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
