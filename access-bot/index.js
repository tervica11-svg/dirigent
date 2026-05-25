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

async function redisRevoke(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return;
  try {
    // Читаем текущее значение
    const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
    const json = await res.json();
    if (!json.result) return;
    const data = JSON.parse(json.result);
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

// Промпт, который отправляется клиенту
function buildPrompt(username, tokenId) {
  const issued = humanDate(new Date().toISOString());
  return (
    `Скачай инструкцию с ${INSTALL_URL}\n` +
    `и выполни всё что в ней написано.\n\n` +
    `Telegram: @${username}\n` +
    `Токен: ${tokenId}\n` +
    `Выдан: ${issued}`
  );
}

// ─── БОТ ──────────────────────────────────────────────────────────────────────

const bot = new Bot(BOT_TOKEN);

// Определяем язык пользователя: 'de' если Telegram-язык немецкий, иначе 'ru'
function getLang(ctx) {
  const lang = ctx.from?.language_code || "";
  return lang.startsWith("de") ? "de" : "ru";
}

// Тексты на двух языках
const T = {
  ru: {
    start_text: `👋 Добро пожаловать в <b>Dirigent</b> — завод персональных AI-агентов.\n\nВаш личный агент работает 24/7 в Telegram, помнит ваши проекты и становится умнее с каждым разговором.\n\nВыберите действие:`,
    btn_about:   "🤖 Что такое Dirigent?",
    btn_access:  "🔑 Получить доступ",
    btn_knowledge: "📚 База знаний",
    btn_faq:     "❓ Частые вопросы",
    about: `<b>Dirigent</b> — это персональный AI-агент на базе Claude Code.\n\n• Общается в Telegram 24/7\n• Помнит ваши проекты и привычки\n• Понимает голос, фото, документы\n• Пишет код, создаёт контент, ведёт задачи\n• Живёт на вашем сервере — данные только у вас\n\nЧтобы получить своего агента — нажмите <b>«Получить доступ»</b>.`,
    faq: `<b>Частые вопросы</b>\n\n<b>Сколько стоит?</b>\n1 000 € — разовый платёж, включает установку и настройку.\n\n<b>Нужен ли сервер?</b>\nДа, VPS Ubuntu 22/24 (~5–10 €/мес). Помогаем настроить.\n\n<b>Нужна ли подписка Claude?</b>\nДа, Claude Pro ($20/мес) или Max ($100/мес).\n\n<b>Мои данные в безопасности?</b>\nАгент живёт на вашем сервере. Мы не имеем доступа к вашим данным.\n\nПо другим вопросам — @tervica11`,
    knowledge: `<b>📚 База знаний — Как получить личного AI-агента</b>\n\n<b>Что такое Dirigent?</b>\nDirigent — это завод персональных AI-агентов на базе Claude. Ваш агент живёт на вашем сервере, общается с вами в Telegram 24/7, помнит проекты и становится умнее с каждым разговором.\n\n<b>Что нужно подготовить:</b>\n\n1️⃣ <b>Claude Code</b> — установить на ваш компьютер\nСкачать: claude.ai/code (бесплатно)\nПодписка: Pro — $20/мес или Max — $100/мес\n\n2️⃣ <b>VPS-сервер</b> — арендованный сервер для работы агента 24/7\nЦена: ~5–10 €/мес (Hetzner, DigitalOcean, TimeWeb и др.)\nСистема: Ubuntu 22 или 24\nПомогаем выбрать и настроить — просто напишите нам.\n\n3️⃣ <b>15 минут свободного времени</b>\nВсё остальное Claude Code сделает сам.\n\n<b>Как это происходит:</b>\n1. Вы оплачиваете → пишете нам @tervica11\n2. Мы открываем вам доступ в этом боте\n3. Нажимаете «Получить доступ» → получаете токен\n4. Вставляете токен в Claude Code → агент устанавливается сам\n\n<b>Стоимость: 1 000 €</b> — разовый платёж\nВключает: установку, настройку, поддержку при старте.\n\nГотовы? Напишите <b>@tervica11</b>`,
  },
  de: {
    start_text: `👋 Willkommen bei <b>Dirigent</b> — der Fabrik für persönliche AI-Agenten.\n\nIhr persönlicher Agent arbeitet 24/7 in Telegram, merkt sich Ihre Projekte und wird mit jedem Gespräch klüger.\n\nWählen Sie eine Aktion:`,
    btn_about:   "🤖 Was ist Dirigent?",
    btn_access:  "🔑 Zugang erhalten",
    btn_knowledge: "📚 Wissensbasis",
    btn_faq:     "❓ Häufige Fragen",
    about: `<b>Dirigent</b> — Ihr persönlicher AI-Agent auf Basis von Claude Code.\n\n• Kommuniziert 24/7 über Telegram\n• Merkt sich Ihre Projekte und Gewohnheiten\n• Versteht Sprachnachrichten, Fotos, Dokumente\n• Schreibt Code, erstellt Inhalte, verwaltet Aufgaben\n• Läuft auf Ihrem Server — Ihre Daten bleiben bei Ihnen\n\nUm Ihren Agenten zu erhalten — klicken Sie auf <b>«Zugang erhalten»</b>.`,
    faq: `<b>Häufige Fragen</b>\n\n<b>Was kostet es?</b>\n1.000 € — Einmalzahlung, inkl. Installation und Einrichtung.\n\n<b>Brauche ich einen Server?</b>\nJa, VPS Ubuntu 22/24 (~5–10 €/Mon.). Wir helfen bei der Einrichtung.\n\n<b>Brauche ich ein Claude-Abo?</b>\nJa, Claude Pro ($20/Mon.) oder Max ($100/Mon.).\n\n<b>Sind meine Daten sicher?</b>\nDer Agent läuft auf Ihrem Server. Wir haben keinen Zugriff auf Ihre Daten.\n\nWeitere Fragen — @tervica11`,
    knowledge: `<b>📚 Wissensbasis — So erhalten Sie Ihren persönlichen AI-Agenten</b>\n\n<b>Was ist Dirigent?</b>\nDirigent ist eine Fabrik für persönliche AI-Agenten auf Basis von Claude. Ihr Agent läuft auf Ihrem eigenen Server, kommuniziert 24/7 über Telegram, merkt sich Ihre Projekte und wird mit jedem Gespräch klüger.\n\n<b>Was Sie vorbereiten müssen:</b>\n\n1️⃣ <b>Claude Code</b> — auf Ihrem Computer installieren\nDownload: claude.ai/code (kostenlos)\nAbo: Pro — $20/Mon. oder Max — $100/Mon.\n\n2️⃣ <b>VPS-Server</b> — gemieteter Server für den 24/7-Betrieb\nPreis: ~5–10 €/Mon. (Hetzner, DigitalOcean u.a.)\nSystem: Ubuntu 22 oder 24\nWir helfen bei Auswahl und Einrichtung — schreiben Sie uns einfach.\n\n3️⃣ <b>15 Minuten Zeit</b>\nDen Rest erledigt Claude Code automatisch.\n\n<b>So läuft es ab:</b>\n1. Sie bezahlen → schreiben Sie uns @tervica11\n2. Wir schalten Sie in diesem Bot frei\n3. Klicken Sie «Zugang erhalten» → erhalten Ihren Token\n4. Token in Claude Code einfügen → Agent installiert sich selbst\n\n<b>Preis: 1.000 €</b> — Einmalzahlung\nInklusive: Installation, Einrichtung, Support beim Start.\n\nBereit? Schreiben Sie <b>@tervica11</b>`,
  }
};

// /start
bot.command("start", async (ctx) => {
  const lang = getLang(ctx);
  const t = T[lang];
  const kb = new InlineKeyboard()
    .text(t.btn_about, "about").row()
    .text(t.btn_access, "get_token").row()
    .text(t.btn_knowledge, "knowledge").text(t.btn_faq, "faq");
  await ctx.reply(t.start_text, { parse_mode: "HTML", reply_markup: kb });
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

// Кнопка — База знаний (сразу на языке пользователя)
bot.callbackQuery("knowledge", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(T[getLang(ctx)].knowledge, { parse_mode: "HTML" });
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

async function handleGet(ctx) {
  const username = ctx.from?.username;

  if (!username) {
    await ctx.reply(
      `⚠️ У вас не установлен username в Telegram.\n\n` +
      `Зайдите в Настройки → задайте имя пользователя, затем попробуйте снова.`
    );
    return;
  }

  const whitelist = wl();
  const key = normalizeUsername(username);

  if (!whitelist[key] || !whitelist[key].active) {
    await ctx.reply(
      `🔒 Ваш username <code>@${username}</code> не найден в списке доступа.\n\n` +
      `Чтобы получить доступ — напишите <b>@tervica11</b>.`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // Выдаём токен
  const tokenId = await issueToken(key);
  const prompt  = buildPrompt(key, tokenId);

  await ctx.reply(
    `✅ Доступ подтверждён! Вот ваш установочный промпт:\n\n` +
    `<pre>${prompt}</pre>\n\n` +
    `<b>Как использовать:</b>\n` +
    `1. Откройте Claude Code на вашем компьютере\n` +
    `2. Вставьте промпт выше и нажмите Enter\n` +
    `3. Claude Code настроит агента сам (~10–15 минут)\n\n` +
    `⚠️ Токен одноразовый. Если потребуется переустановка — нажмите /get снова.`,
    { parse_mode: "HTML" }
  );

  // Уведомляем администратора
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

// ─── ЗАПУСК ───────────────────────────────────────────────────────────────────

// Создаём папку data если нет
if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });

bot.catch((err) => {
  console.error("Bot error:", err.message);
});

console.log("🎼 Dirigent Access Bot запущен...");
bot.start();
