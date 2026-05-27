/**
 * Dirigent API — база знаний по персональному токену
 * GET /api/docs/:token
 * Токен проверяется в Redis (TTL 30 дней), выдаётся ботом
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // 1. Формат токена
  if (!token || !UUID_RE.test(token)) {
    return res.status(400).send(errorPage());
  }

  // 2. Проверка в Redis
  let data = null;
  try {
    data = await redisGet(`docs:${token}`);
  } catch (err) {
    console.error('Redis error:', err);
  }

  if (!data) {
    return res.status(403).send(expiredPage());
  }

  // 3. Отдаём docs.html (язык по ?lang= параметру)
  const { readFileSync } = require('fs');
  const { join } = require('path');

  try {
    const lang = (req.query.lang || 'ru').toLowerCase();
    const filename = lang === 'de' ? 'docs-de.html' : 'docs.html';
    const html = readFileSync(join(process.cwd(), 'public', filename), 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(html);
  } catch (err) {
    console.error('File read error:', err);
    return res.status(500).send('Internal error');
  }
};

function errorPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Dirigent</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f7f7f8;
    display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .box { text-align: center; padding: 40px; background: #fff; border-radius: 16px;
    border: 1px solid #e8e8e8; max-width: 400px; }
  h2 { font-size: 20px; color: #111; margin-bottom: 12px; }
  p { color: #888; font-size: 14px; line-height: 1.6; margin-bottom: 16px; }
  a { color: #7c5cfc; text-decoration: none; font-weight: 600; }
</style>
</head><body><div class="box">
  <h2>🔒 Ungültiger Link / Неверная ссылка</h2>
  <p>Der Link ist ungültig oder wurde nicht gefunden.<br>Ссылка недействительна или не найдена.</p>
  <p><a href="https://t.me/dirigent_access_bot">@dirigent_access_bot</a></p>
</div></body></html>`;
}

function expiredPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Dirigent</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f7f7f8;
    display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .box { text-align: center; padding: 40px; background: #fff; border-radius: 16px;
    border: 1px solid #e8e8e8; max-width: 400px; }
  h2 { font-size: 20px; color: #111; margin-bottom: 12px; }
  p { color: #888; font-size: 14px; line-height: 1.6; margin-bottom: 16px; }
  a { color: #7c5cfc; text-decoration: none; font-weight: 600; }
</style>
</head><body><div class="box">
  <h2>🔒 Link abgelaufen / Ссылка истекла</h2>
  <p>Der Link ist abgelaufen (30 Tage). Schreiben Sie dem Bot — er stellt einen neuen aus.<br>
  Ссылка истекла (30 дней). Напишите боту — выдаст новую.</p>
  <p><a href="https://t.me/dirigent_access_bot">@dirigent_access_bot</a></p>
</div></body></html>`;
}
