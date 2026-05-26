/**
 * Диагностика Redis — Vercel side
 * GET /api/redis-check         → проверяет env vars + пишет тест-ключ и читает его
 * GET /api/redis-check?key=X   → читает конкретный ключ
 */
const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

module.exports = async function handler(req, res) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    return res.json({ error: 'UPSTASH env vars NOT SET on Vercel' });
  }

  const { key } = req.query;

  // Читаем конкретный ключ
  if (key) {
    try {
      const r = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      });
      const json = await r.json();
      return res.json({ key, found: !!json.result, raw: json.result, upstash_url: UPSTASH_URL });
    } catch (e) {
      return res.json({ error: e.message });
    }
  }

  // Round-trip тест: пишем test:ping → читаем обратно
  try {
    const testKey = `test:ping-${Date.now()}`;
    const testVal = 'pong';

    // Пишем через SET с EX
    const writeRes = await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(testKey)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(testVal),
    });
    const writeJson = await writeRes.json();

    // Читаем обратно
    const readRes = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(testKey)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
    const readJson = await readRes.json();

    return res.json({
      upstash_url: UPSTASH_URL,
      write_result: writeJson.result,
      read_result: readJson.result,
      round_trip_ok: readJson.result === testVal || readJson.result === `"${testVal}"`,
    });
  } catch (e) {
    return res.json({ error: e.message });
  }
};
