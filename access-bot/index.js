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

// Генерируем токен и сохраняем
function issueToken(username) {
  const tokens = tk();
  // Аннулируем предыдущие неиспользованные токены этого пользователя
  for (const [id, t] of Object.entries(tokens)) {
    if (t.username === username && !t.used) {
      tokens[id].revoked = true;
    }
  }
  const id = uuidv4();
  tokens[id] = {
    username,
    issued: new Date().toISOString(),
    used: false,
    usedAt: null,
    revoked: false
  };
  saveTK(tokens);
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

// /start
bot.command("start", async (ctx) => {
  const kb = new InlineKeyboard()
    .text("🤖 Что такое Dirigent?", "about").row()
    .text("🔑 Получить доступ", "get_token").row()
    .text("❓ Частые вопросы", "faq");

  await ctx.reply(
    `👋 Добро пожаловать в <b>Dirigent</b> — завод персональных AI-агентов.\n\n` +
    `Ваш личный агент работает 24/7 в Telegram, помнит ваши проекты и становится умнее с каждым разговором.\n\n` +
    `Выберите действие:`,
    { parse_mode: "HTML", reply_markup: kb }
  );
});

// Кнопка — о продукте
bot.callbackQuery("about", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    `<b>Dirigent</b> — это персональный AI-агент на базе Claude Code.\n\n` +
    `• Общается в Telegram 24/7\n` +
    `• Помнит ваши проекты и привычки\n` +
    `• Понимает голос, фото, документы\n` +
    `• Пишет код, создаёт контент, ведёт задачи\n` +
    `• Живёт на вашем сервере — данные только у вас\n\n` +
    `Чтобы получить своего агента — нажмите <b>«Получить доступ»</b>.`,
    { parse_mode: "HTML" }
  );
});

// Кнопка — FAQ
bot.callbackQuery("faq", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    `<b>Частые вопросы</b>\n\n` +
    `<b>Сколько стоит?</b>\n` +
    `Уточните у @tervica11\n\n` +
    `<b>Нужен ли сервер?</b>\n` +
    `Да, VPS Ubuntu 22/24 (~500–800 руб/мес). Помогаем настроить.\n\n` +
    `<b>Нужна ли подписка Claude?</b>\n` +
    `Да, Claude Pro ($20/мес) или Max ($100/мес).\n\n` +
    `<b>Мои данные в безопасности?</b>\n` +
    `Агент живёт на вашем сервере. Мы не имеем доступа к вашим данным.\n\n` +
    `По другим вопросам — @tervica11`,
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
  const tokenId = issueToken(key);
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
