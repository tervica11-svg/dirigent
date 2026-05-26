/**
 * Диагностика Redis — Vercel side
 * GET /api/redis-check?key=docs:TOKEN
 * Временный эндпоинт для отладки
 */
const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

module.exports = async function handler(req, res) {
  const { key } = req.query;

  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    return res.json({ error: 'UPSTASH env vars NOT SET on Vercel', url: UPSTASH_URL || 'undefined' });
  }

  if (!key) {
    return res.json({ status: 'ok', url: UPSTASH_URL.replace(/\/\/.*@/, '//***@') });
  }

  try {
    const r = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
    const json = await r.json();
    return res.json({ key, found: !!json.result, result: json.result ? 'EXISTS' : 'NULL', upstash_url: UPSTASH_URL });
  } catch (e) {
    return res.json({ error: e.message });
  }
};
