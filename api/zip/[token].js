/**
 * Dirigent API — выдача пакета агента по токену
 * GET /api/zip/:token
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// ─── Redis helpers (через REST API, без SDK) ──────────────────────────────────

async function redisGet(key) {
  const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const json = await res.json();
  if (!json.result) return null;
  try { return JSON.parse(json.result); }
  catch { return json.result; }
}

async function redisSet(key, value) {
  await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(typeof value === 'string' ? value : JSON.stringify(value)),
  });
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ error: 'Token required' });
  }

  // Проверяем токен в Redis
  let tokenData;
  try {
    tokenData = await redisGet(`token:${token}`);
  } catch (err) {
    console.error('Redis error:', err);
    return res.status(500).json({ error: 'Database error' });
  }

  if (!tokenData) {
    return res.status(403).json({ error: 'Invalid token' });
  }

  if (tokenData.used) {
    return res.status(403).json({
      error: 'Token already used',
      message: 'Токен уже использован. Напишите боту /get для получения нового.',
    });
  }

  if (tokenData.revoked) {
    return res.status(403).json({
      error: 'Token revoked',
      message: 'Токен аннулирован. Обратитесь к @tervica11.',
    });
  }

  // Помечаем токен как использованный
  tokenData.used  = true;
  tokenData.usedAt = new Date().toISOString();
  await redisSet(`token:${token}`, tokenData);

  // Читаем ZIP архив
  let zipData;
  try {
    const zipPath = join(process.cwd(), 'private', 'agent-package.zip');
    zipData = readFileSync(zipPath);
  } catch (err) {
    console.error('ZIP read error:', err);
    return res.status(500).json({ error: 'Package not found' });
  }

  // Отдаём архив
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="dirigent-agent.zip"');
  res.setHeader('Content-Length', zipData.length);
  return res.send(zipData);
}
