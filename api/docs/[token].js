/**
 * Dirigent API — база знаний по персональному токену
 * GET /api/docs/:token
 *
 * Токен генерируется ботом и выдаётся лично клиенту.
 * Проверка на формат UUID достаточна — контент базы знаний не секретный.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res) {
  const { token } = req.query;

  // Проверяем что токен выглядит как UUID (базовая защита от случайных запросов)
  if (!token || !UUID_RE.test(token)) {
    return res.status(400).send(`
      <!DOCTYPE html><html><head><meta charset="UTF-8"><title>Dirigent</title>
      <style>body{font-family:sans-serif;background:#0f0f13;color:#e8e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}</style>
      </head><body>
      <div><h2>🔒 Ungültiger Link / Неверная ссылка</h2>
      <p style="color:#8080a0">Schreiben Sie dem Bot /docs — ich stelle einen neuen aus.<br>Напишите боту /docs — выдам новую.</p>
      <p><a href="https://t.me/dirigent_access_bot" style="color:#a78bfa">@dirigent_access_bot</a></p>
      </div></body></html>
    `);
  }

  // Отдаём страницу базы знаний
  const { readFileSync } = require('fs');
  const { join } = require('path');

  try {
    const html = readFileSync(join(process.cwd(), 'public', 'docs.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.send(html);
  } catch (err) {
    // Fallback — редирект на публичную страницу
    res.setHeader('Location', '/docs.html');
    return res.status(302).send('');
  }
};
