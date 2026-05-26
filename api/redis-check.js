const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

module.exports = async function handler(req, res) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    return res.json({ error: 'UPSTASH env vars NOT SET', url: String(UPSTASH_URL) });
  }

  const { key } = req.query;

  if (key) {
    try {
      const r = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      });
      const text = await r.text();
      return res.json({ key, status: r.status, raw: text });
    } catch (e) {
      return res.json({ error: e.message });
    }
  }

  // Round-trip
  const testKey = `test:ping-${Date.now()}`;
  try {
    const wRes = await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(testKey)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify('pong'),
    });
    const wText = await wRes.text();

    const rRes = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(testKey)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
    const rText = await rRes.text();

    return res.json({
      url: UPSTASH_URL,
      write_status: wRes.status, write_raw: wText,
      read_status: rRes.status,  read_raw: rText,
    });
  } catch (e) {
    return res.json({ error: e.message, url: UPSTASH_URL });
  }
};
