/**
 * Dirigent API — база знаний по персональному токену
 * GET /api/docs/:token?lang=de|ru
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res) {
  const { token, lang } = req.query;
  const language = (lang === 'ru') ? 'ru' : 'de'; // default: de

  if (!token || !UUID_RE.test(token)) {
    return res.status(400).send(errorPage(language));
  }

  const { readFileSync } = require('fs');
  const { join } = require('path');

  try {
    let html = readFileSync(join(process.cwd(), 'public', 'docs.html'), 'utf8');

    // Устанавливаем язык прямо в HTML — убираем переключатель, фиксируем язык
    html = html
      .replace(`<body class="lang-de">`, `<body class="lang-${language}">`)
      .replace(
        `<div class="lang-switch">
    <button class="lang-btn active" onclick="setLang('de')">🇩🇪 DE</button>
    <button class="lang-btn" onclick="setLang('ru')">🇷🇺 RU</button>
  </div>`,
        '' // убираем переключатель языка
      )
      // Убираем JS-функцию setLang и восстановление языка из localStorage
      .replace(
        `function setLang(lang) {
    document.body.className = 'lang-' + lang;
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.textContent.toLowerCase().includes(lang));
    });
    localStorage.setItem('dirigent-lang', lang);
  }`,
        `function setLang(lang) {}` // no-op
      )
      .replace(
        `// Restore language preference
  const saved = localStorage.getItem('dirigent-lang') || 'de';
  setLang(saved);`,
        '' // язык уже зафиксирован в body class
      );

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.send(html);
  } catch (err) {
    // Fallback — редирект на публичную страницу с языком
    res.setHeader('Location', `/docs.html?lang=${language}`);
    return res.status(302).send('');
  }
};

function errorPage(lang) {
  const de = lang === 'de';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Dirigent</title>
<style>body{font-family:sans-serif;background:#0f0f13;color:#e8e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}</style>
</head><body><div>
<h2>🔒 ${de ? 'Ungültiger Link' : 'Неверная ссылка'}</h2>
<p style="color:#8080a0">${de
  ? 'Schreiben Sie dem Bot /docs — ich stelle einen neuen aus.'
  : 'Напишите боту /docs — выдам новую.'}</p>
<p><a href="https://t.me/dirigent_access_bot" style="color:#a78bfa">@dirigent_access_bot</a></p>
</div></body></html>`;
}
