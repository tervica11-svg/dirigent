/**
 * Dirigent API — персональная база знаний по токену
 * GET /api/docs/:token
 */

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisGet(key) {
  const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const json = await res.json();
  if (!json.result) return null;
  let value = json.result;
  for (let i = 0; i < 3; i++) {
    if (typeof value !== 'string') break;
    try { value = JSON.parse(value); } catch { break; }
  }
  return value;
}

module.exports = async function handler(req, res) {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send('Token required');
  }

  let docsData;
  try {
    docsData = await redisGet(`docs:${token}`);
  } catch (err) {
    console.error('Redis error:', err);
    return res.status(500).send('Database error');
  }

  if (!docsData) {
    return res.status(403).send(`
      <!DOCTYPE html><html><head><meta charset="UTF-8"><title>Dirigent</title>
      <style>body{font-family:sans-serif;background:#0f0f13;color:#e8e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}</style>
      </head><body>
      <div><h2>🔒 Link abgelaufen / Ссылка истекла</h2>
      <p style="color:#8080a0">Schreiben Sie dem Bot /docs — ich stelle einen neuen aus.<br>Напишите боту /docs — выдам новую.</p>
      <p><a href="https://t.me/dirigent_access_bot" style="color:#a78bfa">@dirigent_access_bot</a></p>
      </div></body></html>
    `);
  }

  // Читаем HTML страницу базы знаний и отдаём
  const { readFileSync } = require('fs');
  const { join } = require('path');
  try {
    const html = readFileSync(join(process.cwd(), 'public', 'docs.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (err) {
    console.error('docs.html read error:', err);
    return res.status(500).send('Page not found');
  }
};
