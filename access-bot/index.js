/**
 * Dirigent Access Bot — управление доступом к персональным агентам
 *
 * Команды для клиентов:
 *   /start — приветствие
 *   /get   — получить токен (если в белом списке)
 *
 * Команды для администратора:
 *   /add @username    — добавить в белый список
 *   /remove @username — удалить из белого списка
 *   /list             — показать всех пользователей
 *   /revoke @username — аннулировать активный токен
 *   /stats            — статистика
 */

import "dotenv/config";
import { Bot, InlineKeyboard } from "grammy";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID  = Number(process.env.ADMIN_ID);

if (!BOT_TOKEN) { console.error("❌ BOT_TOKEN не задан в .env"); process.exit(1); }
if (!ADMIN_ID)  { console.error("❌ ADMIN_ID не задан в .env");  process.exit(1); }

const __dir   = dirname(fileURLToPath(import.meta.url));
const DATA    = join(__dir, "data");
const WL_FILE = join(DATA, "whitelist.json");
const TK_FILE = join(DATA, "tokens.json");

// URL инструкции установки (INSTALL-BONUS.md в репо Dirigent)
const INSTALL_URL = "https://raw.githubusercontent.com/tervica11-svg/dirigent/main/INSTALL-BONUS.md";

// ─── ХРАНИЛИЩЕ ────────────────────────────────────────────────────────────────

function loadJSON(file, def) {
  if (!existsSync(file)) return def;
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch { return def; }
}

function saveJSON(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

// whitelist: { "username": { added: ISO, addedBy: adminId, active: bool } }
// tokens:    { "uuid": { username, issued: ISO, used: bool, usedAt: ISO|null } }

function wl()        { return loadJSON(WL_FILE, {}); }
function saveWL(d)   { saveJSON(WL_FILE, d); }
function tk()        { return loadJSON(TK_FILE, {}); }
function saveTK(d)   { saveJSON(TK_FILE, d); }

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function isAdmin(ctx) {
  return ctx.from?.id === ADMIN_ID;
}

// Нормализуем username: убираем @ если есть, lower-case
function normalizeUsername(raw) {
  return raw.replace(/^@/, "").toLowerCase().trim();
}

// Дата в человеческом формате
function humanDate(iso) {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric"
  });
}

// ─── UPSTASH REDIS ────────────────────────────────────────────────────────────

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisSet(key, value) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return; // пропускаем если не настроено
  try {
    await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(typeof value === 'string' ? value : JSON.stringify(value)),
    });
  } catch (err) {
    console.error('Redis set error:', err.message);
  }
}

async function redisSetEx(key, ttlSeconds, value) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return;
  try {
    await fetch(`${UPSTASH_URL}/setex/${encodeURIComponent(key)}/${ttlSeconds}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(typeof value === 'string' ? value : JSON.stringify(value)),
    });
  } catch (err) {
    console.error('Redis setex error:', err.message);
  }
}

async function redisRevoke(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return;
  try {
    // Читаем текущее значение
    const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
    const json = await res.json();
    if (!json.result) return;
    // Парсим до объекта (защита от двойного кодирования)
    let data = json.result;
    for (let i = 0; i < 3; i++) {
      if (typeof data !== 'string') break;
      try { data = JSON.parse(data); } catch { break; }
    }
    if (typeof data !== 'object' || data === null) return;
    data.revoked = true;
    await redisSet(key, data);
  } catch (err) {
    console.error('Redis revoke error:', err.message);
  }
}

// ─── ТОКЕНЫ ───────────────────────────────────────────────────────────────────

// Генерируем токен и сохраняем
async function issueToken(username) {
  const tokens = tk();
  // Аннулируем предыдущие неиспользованные токены этого пользователя
  for (const [id, t] of Object.entries(tokens)) {
    if (t.username === username && !t.used) {
      tokens[id].revoked = true;
      await redisRevoke(`token:${id}`);
    }
  }
  const id = uuidv4();
  const tokenData = {
    username,
    issued: new Date().toISOString(),
    used: false,
    usedAt: null,
    revoked: false
  };
  tokens[id] = tokenData;
  saveTK(tokens);
  // Сохраняем токен в Redis для Vercel API
  await redisSet(`token:${id}`, tokenData);
  return id;
}

// URL для скачивания ZIP
const DOWNLOAD_URL = "https://dirigent-gray.vercel.app/api/zip";

// Промпт в стиле Дмитрия — чистый, лаконичный, для Claude Code
function buildPrompt(username, tokenId, lang = "ru") {
  const issued = humanDate(new Date().toISOString());
  const last4  = tokenId.slice(-4);
  const zipUrl = `${DOWNLOAD_URL}/${tokenId}`;

  if (lang === "de") {
    return [
      `Ich habe einen persönlichen AI-Agenten Dirigent erworben. Hilf mir bei der Installation.`,
      ``,
      `Meine Daten:`,
      `- Mein Telegram: @${username}`,
      `- Ausstellungsdatum: ${issued}`,
      ``,
      `Schritt 1: Erstelle den Ordner, lade das Archiv herunter und entpacke es:`,
      `mkdir -p ~/dirigent && cd ~/dirigent`,
      `curl -fsSL "${zipUrl}" -o package.zip`,
      `unzip -q package.zip && rm package.zip`,
      ``,
      `Falls curl einen Fehler zurückgibt — Token abgelaufen. Sage: «Schreiben Sie dem Bot /new — ich stelle einen neuen aus.» Und stop.`,
      ``,
      `Schritt 2: Ersetze in ~/dirigent/LICENSE.md {{LICENSED_TO}} durch:`,
      `@${username} (ausgestellt ${issued}, Token ...${last4})`,
      ``,
      `Schritt 3: Frage mich — wohin soll der Agent installiert werden:`,
      ``,
      `Variante A — auf Server (VPS, läuft 24/7):`,
      `Frage mich in einer Nachricht: 1) IP-Adresse 2) Root-Passwort 3) Telegram-Bot-Token von @BotFather (wenn ich einen Bot möchte)`,
      `Dann lese server/INSTALL-SERVER.md und folge den Schritten.`,
      `Zuerst Installation auf dem Server, dann Interview mit 10 Fragen.`,
      ``,
      `Variante B — auf diesen Computer:`,
      `Lese INSTALL.md und führe das Interview mit 10 Fragen durch.`,
      ``,
      `Alle Dateien befinden sich im entpackten Ordner ~/dirigent.`,
    ].join("\n");
  }

  // RU
  return [
    `Я приобрёл персонального AI-агента Dirigent. Помоги мне его установить.`,
    ``,
    `Мои данные:`,
    `- Мой Telegram: @${username}`,
    `- Дата выдачи: ${issued}`,
    ``,
    `Шаг 1: создай папку, скачай архив и распакуй:`,
    `mkdir -p ~/dirigent && cd ~/dirigent`,
    `curl -fsSL "${zipUrl}" -o package.zip`,
    `unzip -q package.zip && rm package.zip`,
    ``,
    `Если curl вернул ошибку — токен сгорел. Скажи: «Напишите боту /new — выдам новый.» И остановись.`,
    ``,
    `Шаг 2: в файле ~/dirigent/LICENSE.md замени {{LICENSED_TO}} на:`,
    `@${username} (выдано ${issued}, токен ...${last4})`,
    ``,
    `Шаг 3: спроси меня — куда установить Агента:`,
    ``,
    `Вариант A — на сервер (VPS, работает 24/7):`,
    `Спроси у меня одним сообщением: 1) IP-адрес сервера 2) Пароль root 3) Токен Telegram-бота от @BotFather (если хочу бота)`,
    `Потом прочитай server/INSTALL-SERVER.md и выполняй по шагам.`,
    `Сначала установка на сервер, потом интервью из 10 вопросов.`,
    ``,
    `Вариант B — на этот компьютер:`,
    `Прочитай INSTALL.md и проведи интервью из 10 вопросов.`,
    ``,
    `Все файлы лежат в распакованной папке ~/dirigent.`,
  ].join("\n");
}

// ─── БОТ ──────────────────────────────────────────────────────────────────────

const bot = new Bot(BOT_TOKEN);

// Хранилище выбранного языка по userId (сбрасывается при рестарте бота)
const userLang = new Map();

// Получить язык пользователя (default: ru)
function getLang(ctx) {
  return userLang.get(ctx.from?.id) || "ru";
}

// Тексты на двух языках
const T = {
  ru: {
    start_text: `👋 Добро пожаловать в <b>Dirigent</b> — завод персональных AI-агентов.\n\nВаш личный агент работает 24/7 в Telegram, помнит ваши проекты и становится умнее с каждым разговором.\n\nВыберите действие:`,
    btn_about:   "🤖 Что такое Dirigent?",
    btn_access:  "▶ Получить промпт",
    btn_knowledge: "📚 База знаний",
    btn_faq:     "❓ Частые вопросы",
    about: `<b>Dirigent</b> — это персональный AI-агент на базе Claude Code.\n\n• Общается в Telegram 24/7\n• Помнит ваши проекты и привычки\n• Понимает голос, фото, документы\n• Пишет код, создаёт контент, ведёт задачи\n• Живёт на вашем сервере — данные только у вас\n\nЧтобы получить своего агента — нажмите <b>«Получить доступ»</b>.`,
    faq: `<b>Частые вопросы</b>\n\n<b>Сколько стоит?</b>\n1 000 € — разовый платёж, включает установку и настройку.\n\n<b>Нужен ли сервер?</b>\nДа, VPS Ubuntu 22/24 (~5–10 €/мес). Помогаем настроить.\n\n<b>Нужна ли подписка Claude?</b>\nДа, Claude Pro ($20/мес) или Max ($100/мес).\n\n<b>Мои данные в безопасности?</b>\nАгент живёт на вашем сервере. Мы не имеем доступа к вашим данным.\n\nПо другим вопросам — @tervica11`,
    knowledge: `<b>📚 База знаний — Как получить личного AI-агента</b>\n\n<b>Что такое Dirigent?</b>\nDirigent — это завод персональных AI-агентов на базе Claude. Ваш агент живёт на вашем сервере, общается с вами в Telegram 24/7, помнит проекты и становится умнее с каждым разговором.\n\n<b>Что нужно подготовить:</b>\n\n1️⃣ <b>Claude Code</b> — установить на ваш компьютер\nСкачать: claude.ai/code (бесплатно)\nПодписка: Pro — $20/мес или Max — $100/мес\n\n2️⃣ <b>VPS-сервер</b> — арендованный сервер для работы агента 24/7\nЦена: ~5–10 €/мес (Hetzner, DigitalOcean, TimeWeb и др.)\nСистема: Ubuntu 22 или 24\nПомогаем выбрать и настроить — просто напишите нам.\n\n3️⃣ <b>15 минут свободного времени</b>\nВсё остальное Claude Code сделает сам.\n\n<b>Как это происходит:</b>\n1. Вы оплачиваете → пишете нам @tervica11\n2. Мы открываем вам доступ в этом боте\n3. Нажимаете «Получить доступ» → получаете токен\n4. Вставляете токен в Claude Code → агент устанавливается сам\n\n<b>Стоимость: 1 000 €</b> — разовый платёж\nВключает: установку, настройку, поддержку при старте.\n\nГотовы? Напишите <b>@tervica11</b>`,
    no_username: `⚠️ У вас не установлен username в Telegram.\n\nЗайдите в Настройки → задайте имя пользователя, затем попробуйте снова.`,
    no_access: (u) => `🔒 Ваш username <code>@${u}</code> не найден в списке доступа.\n\nЧтобы получить доступ — напишите <b>@tervica11</b>.`,
    token_issued: (prompt) => `✅ Готово, Ваш персональный промпт для Claude Code:\n\n<pre>${prompt}</pre>\n\n<b>Что сделать:</b>\n1. Откройте Claude Code на компьютере\n2. Скопируйте текст промпта выше целиком\n3. Вставьте в Claude Code и нажмите Enter\n\n<b>Что произойдёт:</b>\n— Claude Code скачает и распакует Ваш пакет\n— Поставит водяной знак с Вашим Telegram\n— Спросит куда ставим: на сервер или на компьютер\n— Если на сервер — установит всё на VPS\n— Проведёт интервью из 10 вопросов о Вас и заполнит шаблоны\n— Покажет превью каждого файла на подтверждение\n— Запустит Telegram-бота (если дали токен)\n\nПромпт работает только у Вас. Пересылка коллеге не сработает.\nЕсли что-то пошло не так — нажмите /get снова.`,
    token_notify: (u, id) => `🔑 Выдан токен\nПользователь: @${u}\nТокен: <code>${id}</code>`,
  },
  de: {
    start_text: `👋 Willkommen bei <b>Dirigent</b> — der Fabrik für persönliche AI-Agenten.\n\nIhr persönlicher Agent arbeitet 24/7 in Telegram, merkt sich Ihre Projekte und wird mit jedem Gespräch klüger.\n\nWählen Sie eine Aktion:`,
    btn_about:   "🤖 Was ist Dirigent?",
    btn_access:  "▶ Prompt erhalten",
    btn_knowledge: "📚 Wissensbasis",
    btn_faq:     "❓ Häufige Fragen",
    about: `<b>Dirigent</b> — Ihr persönlicher AI-Agent auf Basis von Claude Code.\n\n• Kommuniziert 24/7 über Telegram\n• Merkt sich Ihre Projekte und Gewohnheiten\n• Versteht Sprachnachrichten, Fotos, Dokumente\n• Schreibt Code, erstellt Inhalte, verwaltet Aufgaben\n• Läuft auf Ihrem Server — Ihre Daten bleiben bei Ihnen\n\nUm Ihren Agenten zu erhalten — klicken Sie auf <b>«Zugang erhalten»</b>.`,
    faq: `<b>Häufige Fragen</b>\n\n<b>Was kostet es?</b>\n1.000 € — Einmalzahlung, inkl. Installation und Einrichtung.\n\n<b>Brauche ich einen Server?</b>\nJa, VPS Ubuntu 22/24 (~5–10 €/Mon.). Wir helfen bei der Einrichtung.\n\n<b>Brauche ich ein Claude-Abo?</b>\nJa, Claude Pro ($20/Mon.) oder Max ($100/Mon.).\n\n<b>Sind meine Daten sicher?</b>\nDer Agent läuft auf Ihrem Server. Wir haben keinen Zugriff auf Ihre Daten.\n\nWeitere Fragen — @tervica11`,
    knowledge: `<b>📚 Wissensbasis — So erhalten Sie Ihren persönlichen AI-Agenten</b>\n\n<b>Was ist Dirigent?</b>\nDirigent ist eine Fabrik für persönliche AI-Agenten auf Basis von Claude. Ihr Agent läuft auf Ihrem eigenen Server, kommuniziert 24/7 über Telegram, merkt sich Ihre Projekte und wird mit jedem Gespräch klüger.\n\n<b>Was Sie vorbereiten müssen:</b>\n\n1️⃣ <b>Claude Code</b> — auf Ihrem Computer installieren\nDownload: claude.ai/code (kostenlos)\nAbo: Pro — $20/Mon. oder Max — $100/Mon.\n\n2️⃣ <b>VPS-Server</b> — gemieteter Server für den 24/7-Betrieb\nPreis: ~5–10 €/Mon. (Hetzner, DigitalOcean u.a.)\nSystem: Ubuntu 22 oder 24\nWir helfen bei Auswahl und Einrichtung — schreiben Sie uns einfach.\n\n3️⃣ <b>15 Minuten Zeit</b>\nDen Rest erledigt Claude Code automatisch.\n\n<b>So läuft es ab:</b>\n1. Sie bezahlen → schreiben Sie uns @tervica11\n2. Wir schalten Sie in diesem Bot frei\n3. Klicken Sie «Zugang erhalten» → erhalten Ihren Token\n4. Token in Claude Code einfügen → Agent installiert sich selbst\n\n<b>Preis: 1.000 €</b> — Einmalzahlung\nInklusive: Installation, Einrichtung, Support beim Start.\n\nBereit? Schreiben Sie <b>@tervica11</b>`,
    no_username: `⚠️ Sie haben keinen Telegram-Benutzernamen.\n\nGehen Sie zu Einstellungen → legen Sie einen Benutzernamen fest und versuchen Sie es erneut.`,
    no_access: (u) => `🔒 Ihr Benutzername <code>@${u}</code> wurde nicht in der Zugriffsliste gefunden.\n\nUm Zugang zu erhalten — schreiben Sie <b>@tervica11</b>.`,
    token_issued: (prompt) => `✅ Fertig, Ihr persönlicher Prompt für Claude Code:\n\n<pre>${prompt}</pre>\n\n<b>Was zu tun ist:</b>\n1. Öffnen Sie Claude Code auf dem Computer\n2. Kopieren Sie den gesamten Prompt-Text oben\n3. Fügen Sie ihn in Claude Code ein und drücken Sie Enter\n\n<b>Was passiert:</b>\n— Claude Code lädt Ihr Paket herunter und entpackt es\n— Setzt Ihr Wasserzeichen mit Ihrem Telegram\n— Fragt wohin installieren: Server oder Computer\n— Auf Server: installiert alles auf dem VPS\n— Führt ein Interview mit 10 Fragen über Sie durch und füllt Vorlagen aus\n— Zeigt eine Vorschau jeder Datei zur Bestätigung\n— Startet den Telegram-Bot (wenn Sie einen Token angegeben haben)\n\nDer Prompt funktioniert nur bei Ihnen. Weiterleitung an andere klappt nicht.\nFalls etwas schief läuft — tippen Sie erneut /get.`,
    token_notify: (u, id) => `🔑 Token ausgestellt\nBenutzer: @${u}\nToken: <code>${id}</code>`,
  }
};

// Показать главное меню на нужном языке
async function showMainMenu(ctx, lang) {
  const t = T[lang];
  const kb = new InlineKeyboard()
    .text(t.btn_about, "about").row()
    .text(t.btn_access, "get_token").row()
    .text(t.btn_knowledge, "knowledge").text(t.btn_faq, "faq");
  await ctx.reply(t.start_text, { parse_mode: "HTML", reply_markup: kb });
}

// /start — сначала выбор языка
bot.command("start", async (ctx) => {
  const kb = new InlineKeyboard()
    .text("🇷🇺 Русский", "lang_ru")
    .text("🇩🇪 Deutsch", "lang_de");
  await ctx.reply(
    `👋 <b>Dirigent</b>\n\nВыберите язык / Sprache wählen:`,
    { parse_mode: "HTML", reply_markup: kb }
  );
});

// Выбор языка — русский
bot.callbackQuery("lang_ru", async (ctx) => {
  await ctx.answerCallbackQuery();
  userLang.set(ctx.from.id, "ru");
  await showMainMenu(ctx, "ru");
});

// Выбор языка — немецкий
bot.callbackQuery("lang_de", async (ctx) => {
  await ctx.answerCallbackQuery();
  userLang.set(ctx.from.id, "de");
  await showMainMenu(ctx, "de");
});

// Кнопка — о продукте
bot.callbackQuery("about", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(T[getLang(ctx)].about, { parse_mode: "HTML" });
});

// Кнопка — FAQ
bot.callbackQuery("faq", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(T[getLang(ctx)].faq, { parse_mode: "HTML" });
});

// Кнопка — База знаний → проверяет whitelist, генерирует токен, отдаёт личную ссылку
bot.callbackQuery("knowledge", async (ctx) => {
  await ctx.answerCallbackQuery();
  const lang = getLang(ctx);
  const username = ctx.from?.username;

  if (!username) {
    await ctx.reply(T[lang].no_username);
    return;
  }

  const whitelist = wl();
  const key = normalizeUsername(username);

  if (!whitelist[key] || !whitelist[key].active) {
    await ctx.reply(T[lang].no_access(username), { parse_mode: "HTML" });
    return;
  }

  // Генерируем токен, сохраняем в Redis на 30 дней
  const docsToken = uuidv4();
  await redisSetEx(`docs:${docsToken}`, 2592000, { username, issued: new Date().toISOString() });

  const docsUrl = `https://dirigent-gray.vercel.app/api/docs/${docsToken}`;

  if (lang === "de") {
    await ctx.reply(
      `📚 <b>Ihre persönliche Wissensbasis:</b>\n\n<a href="${docsUrl}">Wissensbasis öffnen →</a>\n\nLink ist 30 Tage gültig. Nur für Sie — Weitersenden funktioniert nicht.`,
      { parse_mode: "HTML" }
    );
  } else {
    await ctx.reply(
      `📚 <b>Ваша персональная база знаний:</b>\n\n<a href="${docsUrl}">Открыть базу знаний →</a>\n\nСсылка действительна 30 дней. Только для Вас — пересылка другому не сработает.`,
      { parse_mode: "HTML" }
    );
  }
});

// (устаревший обработчик — оставлен для совместимости со старыми сообщениями)
bot.callbackQuery("knowledge_ru", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    `<b>📚 База знаний — Как получить личного AI-агента</b>\n\n` +
    `<b>Что такое Dirigent?</b>\n` +
    `Dirigent — это завод персональных AI-агентов на базе Claude. Ваш агент живёт на вашем сервере, общается с вами в Telegram 24/7, помнит проекты и становится умнее с каждым разговором.\n\n` +
    `<b>Что нужно подготовить:</b>\n\n` +
    `1️⃣ <b>Claude Code</b> — установить на ваш компьютер\n` +
    `Скачать: claude.ai/code (бесплатно)\n` +
    `Подписка: Pro — $20/мес или Max — $100/мес\n\n` +
    `2️⃣ <b>VPS-сервер</b> — арендованный сервер для работы агента 24/7\n` +
    `Цена: ~5–10 €/мес (Hetzner, DigitalOcean, TimeWeb и др.)\n` +
    `Система: Ubuntu 22 или 24\n` +
    `Помогаем выбрать и настроить — просто напишите нам.\n\n` +
    `3️⃣ <b>15 минут свободного времени</b>\n` +
    `Всё остальное Claude Code сделает сам.\n\n` +
    `<b>Как это происходит:</b>\n` +
    `1. Вы оплачиваете → пишете нам @tervica11\n` +
    `2. Мы открываем вам доступ в этом боте\n` +
    `3. Нажимаете «Получить доступ» → получаете токен\n` +
    `4. Вставляете токен в Claude Code → агент устанавливается сам\n\n` +
    `<b>Стоимость: 1 000 €</b> — разовый платёж\n` +
    `Включает: установку, настройку, поддержку при старте.\n\n` +
    `Готовы? Напишите <b>@tervica11</b>`,
    { parse_mode: "HTML" }
  );
});

// База знаний — немецкий
bot.callbackQuery("knowledge_de", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    `<b>📚 Wissensbasis — So erhalten Sie Ihren persönlichen AI-Agenten</b>\n\n` +
    `<b>Was ist Dirigent?</b>\n` +
    `Dirigent ist eine Fabrik für persönliche AI-Agenten auf Basis von Claude. Ihr Agent läuft auf Ihrem eigenen Server, kommuniziert 24/7 über Telegram, merkt sich Ihre Projekte und wird mit jedem Gespräch klüger.\n\n` +
    `<b>Was Sie vorbereiten müssen:</b>\n\n` +
    `1️⃣ <b>Claude Code</b> — auf Ihrem Computer installieren\n` +
    `Download: claude.ai/code (kostenlos)\n` +
    `Abo: Pro — $20/Mon. oder Max — $100/Mon.\n\n` +
    `2️⃣ <b>VPS-Server</b> — gemieteter Server für den 24/7-Betrieb\n` +
    `Preis: ~5–10 €/Mon. (Hetzner, DigitalOcean u.a.)\n` +
    `System: Ubuntu 22 oder 24\n` +
    `Wir helfen bei Auswahl und Einrichtung — schreiben Sie uns einfach.\n\n` +
    `3️⃣ <b>15 Minuten Zeit</b>\n` +
    `Den Rest erledigt Claude Code automatisch.\n\n` +
    `<b>So läuft es ab:</b>\n` +
    `1. Sie bezahlen → schreiben Sie uns @tervica11\n` +
    `2. Wir schalten Sie in diesem Bot frei\n` +
    `3. Sie klicken «Zugang erhalten» → erhalten Ihren Token\n` +
    `4. Token in Claude Code einfügen → Agent installiert sich selbst\n\n` +
    `<b>Preis: 1.000 €</b> — Einmalzahlung\n` +
    `Inklusive: Installation, Einrichtung, Support beim Start.\n\n` +
    `Bereit? Schreiben Sie <b>@tervica11</b>`,
    { parse_mode: "HTML" }
  );
});

// Кнопка — получить токен (дублирует /get)
bot.callbackQuery("get_token", async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleGet(ctx);
});

// /get — основная команда выдачи токена
bot.command("get", async (ctx) => {
  await handleGet(ctx);
});

// Экранирование HTML для вставки в <pre>
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function handleGet(ctx) {
  const username = ctx.from?.username;
  const t = T[getLang(ctx)];

  if (!username) {
    await ctx.reply(t.no_username);
    return;
  }

  const whitelist = wl();
  const key = normalizeUsername(username);

  if (!whitelist[key] || !whitelist[key].active) {
    await ctx.reply(t.no_access(username), { parse_mode: "HTML" });
    return;
  }

  // Выдаём токен
  const lang    = getLang(ctx);
  const tokenId = await issueToken(key);
  const prompt  = buildPrompt(key, tokenId, lang);

  await ctx.reply(t.token_issued(escapeHtml(prompt)), { parse_mode: "HTML" });

  // Уведомляем администратора (всегда на русском)
  await bot.api.sendMessage(
    ADMIN_ID,
    `🔑 Выдан токен\nПользователь: @${username}\nТокен: <code>${tokenId}</code>`,
    { parse_mode: "HTML" }
  );

}

// /help
bot.command("help", async (ctx) => {
  if (isAdmin(ctx)) {
    await ctx.reply(
      `<b>Команды администратора:</b>\n\n` +
      `<code>/add @username</code> — добавить в белый список\n` +
      `<code>/remove @username</code> — удалить из белого списка\n` +
      `<code>/list</code> — все пользователи\n` +
      `<code>/revoke @username</code> — аннулировать токен\n` +
      `<code>/stats</code> — статистика`,
      { parse_mode: "HTML" }
    );
  } else {
    await ctx.reply(
      `<b>Команды:</b>\n\n` +
      `/start — главное меню\n` +
      `/get — получить установочный промпт\n\n` +
      `По вопросам — @tervica11`,
      { parse_mode: "HTML" }
    );
  }
});

// ─── ADMIN КОМАНДЫ ────────────────────────────────────────────────────────────

// /add @username
bot.command("add", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.reply("⛔ Нет доступа."); return; }

  const args = ctx.message?.text?.split(" ").slice(1);
  if (!args?.length) {
    await ctx.reply("Использование: <code>/add @username</code>", { parse_mode: "HTML" });
    return;
  }

  const username = normalizeUsername(args[0]);
  const whitelist = wl();

  if (whitelist[username]?.active) {
    await ctx.reply(`ℹ️ @${username} уже в белом списке.`);
    return;
  }

  whitelist[username] = {
    added: new Date().toISOString(),
    addedBy: ADMIN_ID,
    active: true
  };
  saveWL(whitelist);

  await ctx.reply(`✅ @${username} добавлен в белый список.`);

  // Уведомляем пользователя если он уже писал боту
  try {
    // Не знаем chat_id по username — пропускаем автоуведомление
  } catch {}
});

// /remove @username
bot.command("remove", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.reply("⛔ Нет доступа."); return; }

  const args = ctx.message?.text?.split(" ").slice(1);
  if (!args?.length) {
    await ctx.reply("Использование: <code>/remove @username</code>", { parse_mode: "HTML" });
    return;
  }

  const username  = normalizeUsername(args[0]);
  const whitelist = wl();

  if (!whitelist[username]) {
    await ctx.reply(`ℹ️ @${username} не найден в белом списке.`);
    return;
  }

  whitelist[username].active = false;
  saveWL(whitelist);

  await ctx.reply(`✅ @${username} удалён из белого списка.`);
});

// /list
bot.command("list", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.reply("⛔ Нет доступа."); return; }

  const whitelist = wl();
  const entries   = Object.entries(whitelist);

  if (!entries.length) {
    await ctx.reply("Белый список пуст.");
    return;
  }

  const active   = entries.filter(([, v]) => v.active);
  const inactive = entries.filter(([, v]) => !v.active);

  let text = `<b>Белый список (${active.length} активных):</b>\n\n`;

  if (active.length) {
    text += active.map(([u, v]) => `✅ @${u} — с ${humanDate(v.added)}`).join("\n");
  }

  if (inactive.length) {
    text += `\n\n<b>Отключены (${inactive.length}):</b>\n`;
    text += inactive.map(([u, v]) => `❌ @${u} — с ${humanDate(v.added)}`).join("\n");
  }

  await ctx.reply(text, { parse_mode: "HTML" });
});

// /revoke @username
bot.command("revoke", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.reply("⛔ Нет доступа."); return; }

  const args = ctx.message?.text?.split(" ").slice(1);
  if (!args?.length) {
    await ctx.reply("Использование: <code>/revoke @username</code>", { parse_mode: "HTML" });
    return;
  }

  const username = normalizeUsername(args[0]);
  const tokens   = tk();
  let revoked    = 0;

  for (const [id, t] of Object.entries(tokens)) {
    if (t.username === username && !t.used && !t.revoked) {
      tokens[id].revoked = true;
      revoked++;
    }
  }

  saveTK(tokens);

  if (revoked) {
    await ctx.reply(`✅ Аннулировано токенов для @${username}: ${revoked}`);
  } else {
    await ctx.reply(`ℹ️ Активных токенов для @${username} не найдено.`);
  }
});

// /stats
bot.command("stats", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.reply("⛔ Нет доступа."); return; }

  const whitelist = wl();
  const tokens    = tk();

  const totalUsers  = Object.keys(whitelist).length;
  const activeUsers = Object.values(whitelist).filter(v => v.active).length;
  const totalTokens = Object.keys(tokens).length;
  const usedTokens  = Object.values(tokens).filter(t => t.used).length;
  const activeTokens = Object.values(tokens).filter(t => !t.used && !t.revoked).length;

  await ctx.reply(
    `<b>📊 Статистика Dirigent</b>\n\n` +
    `<b>Пользователи:</b>\n` +
    `• Всего в списке: ${totalUsers}\n` +
    `• Активных: ${activeUsers}\n\n` +
    `<b>Токены:</b>\n` +
    `• Выдано всего: ${totalTokens}\n` +
    `• Использовано: ${usedTokens}\n` +
    `• Активных (не использовано): ${activeTokens}`,
    { parse_mode: "HTML" }
  );
});

// ─── /update — обновление бота из GitHub (только admin) ──────────────────────

bot.command("update", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.reply("⛔ Нет доступа."); return; }

  await ctx.reply("🔄 Запускаю обновление...");

  const { exec } = require("child_process");
  const PROJECT_DIR = join(__dirname, "..");

  // Шаг 1: исправить права .git и сделать git pull
  const pullCmd = `
    chown -R $(whoami):$(whoami) ${PROJECT_DIR}/.git 2>/dev/null || true;
    cd ${PROJECT_DIR} && git pull 2>&1
  `;

  exec(pullCmd, async (err, stdout, stderr) => {
    const pullOutput = (stdout + stderr).trim().slice(0, 500);

    if (err && !stdout.includes("Already up to date") && !stdout.includes("Updating")) {
      await ctx.reply(`⚠️ git pull завершился с ошибкой:\n<pre>${pullOutput}</pre>`, { parse_mode: "HTML" });
      return;
    }

    await ctx.reply(`✅ git pull:\n<pre>${pullOutput || "Already up to date"}</pre>`, { parse_mode: "HTML" });

    // Шаг 2: перезапустить сервис
    exec("sudo /usr/bin/systemctl restart dirigent-access", async (err2) => {
      if (err2) {
        await ctx.reply(`⚠️ Не удалось перезапустить сервис: ${err2.message}\nПерезапусти вручную: <code>sudo systemctl restart dirigent-access</code>`, { parse_mode: "HTML" });
      } else {
        await ctx.reply("🎼 Бот перезапущен с новым кодом!");
      }
    });
  });
});

// ─── АВТООБНОВЛЕНИЕ ───────────────────────────────────────────────────────────

const PROJECT_DIR  = join(__dirname, "..");
const GITHUB_REPO  = "tervica11-svg/dirigent";
const VERSION_FILE = join(PROJECT_DIR, ".last-sha");

async function getRemoteSha() {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/git/refs/heads/main`,
      { headers: { "User-Agent": "dirigent-bot" } }
    );
    const json = await res.json();
    return json?.object?.sha || null;
  } catch { return null; }
}

function getLocalSha() {
  try { return readFileSync(VERSION_FILE, "utf8").trim(); } catch { return ""; }
}

// SSH ключ агента — добавляется автоматически при каждом обновлении
const AGENT_SSH_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICHnPXnxhPhqNaHZLWYwdZQqE7M8KXe7idWJoKu0qvNr go-agent";

function ensureAgentSshKey() {
  const { execSync } = require("child_process");
  try {
    const authKeys = execSync("cat /root/.ssh/authorized_keys 2>/dev/null || true").toString();
    if (!authKeys.includes("go-agent")) {
      execSync(`mkdir -p /root/.ssh && chmod 700 /root/.ssh`);
      execSync(`echo "${AGENT_SSH_KEY}" >> /root/.ssh/authorized_keys`);
      execSync(`chmod 600 /root/.ssh/authorized_keys`);
      console.log("✅ SSH ключ агента добавлен в authorized_keys");
    }
  } catch (e) {
    console.error("⚠️ SSH ключ не добавлен:", e.message);
  }
}

async function checkAndUpdate() {
  const remote = await getRemoteSha();
  const local  = getLocalSha();
  if (!remote || remote === local) return;

  console.log(`🔄 Новый коммит: ${remote.slice(0,7)} (был ${local.slice(0,7)||"?"}). Обновляюсь...`);

  // Уведомляем admin
  try {
    await bot.api.sendMessage(ADMIN_ID, `🔄 Обнаружен новый коммит <code>${remote.slice(0,7)}</code>. Запускаю обновление...`, { parse_mode: "HTML" });
  } catch {}

  const { exec } = await import("child_process");

  const pullCmd = `chown -R $(whoami):$(whoami) ${PROJECT_DIR}/.git 2>/dev/null; cd ${PROJECT_DIR} && git pull 2>&1`;

  exec(pullCmd, async (err, stdout) => {
    const out = (stdout || "").trim().slice(0, 300);
    console.log("git pull:", out);

    // Сохраняем новый SHA
    try { writeFileSync(VERSION_FILE, remote); } catch {}

    // Обеспечиваем SSH-доступ агента
    ensureAgentSshKey();

    try {
      await bot.api.sendMessage(ADMIN_ID, `✅ git pull:\n<pre>${out || "OK"}</pre>\nПерезапускаю...`, { parse_mode: "HTML" });
    } catch {}

    exec("sudo /usr/bin/systemctl restart dirigent-access", async (err2) => {
      if (!err2) console.log("✅ Бот перезапущен.");
      else console.error("⚠️ Не удалось перезапустить:", err2.message);
    });
  });
}

// SSH ключ агента — добавляем сразу при старте
ensureAgentSshKey();

// Проверяем сразу при старте (через 10 сек) и потом каждые 30 минут
setTimeout(checkAndUpdate, 10_000);
setInterval(checkAndUpdate, 30 * 60 * 1000);

// ─── ЗАПУСК ───────────────────────────────────────────────────────────────────

// Создаём папку data если нет
if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });

bot.catch((err) => {
  console.error("Bot error:", err.message);
});

console.log("🎼 Dirigent Access Bot запущен...");
bot.start();
