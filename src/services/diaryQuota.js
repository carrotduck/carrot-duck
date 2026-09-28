import { db } from '../db.js';
import { computeRoamParams } from './personality.js';

function parseTags(row) {
  const raw = row?.tags;
  if (Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw || '[]');
  } catch {
    return [];
  }
}

export function userDayKey(iso, timeZone = 'Asia/Shanghai') {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function listDiaryEntriesForDay(userId, dayKey, timeZone = 'Asia/Shanghai') {
  const rows = db.prepare(`
    SELECT id, content, category, tags, created_at
    FROM memory_entries
    WHERE user_id = ? AND category = 'diary' AND status = 'active'
    ORDER BY datetime(created_at) ASC
  `).all(userId);

  return rows.filter((row) => userDayKey(row.created_at, timeZone) === dayKey);
}

export function countDiaryToday(userId, timeZone = 'Asia/Shanghai') {
  const today = userDayKey(new Date().toISOString(), timeZone);
  return listDiaryEntriesForDay(userId, today, timeZone).length;
}

/** Second diary only when personality favors it and today had real chat. */
export function allowBonusDiaryToday(user) {
  if (!user?.id) return false;
  const tz = user.timezone || 'Asia/Shanghai';
  const today = userDayKey(new Date().toISOString(), tz);
  const entries = listDiaryEntriesForDay(user.id, today, tz);
  if (entries.length !== 1) return false;

  const params = computeRoamParams(user);
  if ((params.diary_prob || 0) < 0.1) return false;

  const chatCount = db.prepare(`
    SELECT COUNT(*) AS n FROM messages
    WHERE user_id = ? AND role = 'user' AND source = 'chat'
      AND datetime(created_at) >= datetime('now', '-20 hours')
  `).get(user.id)?.n || 0;

  return chatCount >= 12;
}

export function canWriteKeepaliveDiary(user) {
  if (!user?.id) return false;
  const tz = user.timezone || 'Asia/Shanghai';
  const count = countDiaryToday(user.id, tz);
  if (count === 0) return true;
  if (count === 1 && allowBonusDiaryToday(user)) return true;
  return false;
}

export function isUserVisibleDiaryEntry(row) {
  const tags = parseTags(row);
  if (tags.includes('keepalive-explore')) return false;
  const content = String(row.content || '').trim();
  if (content.startsWith('[explore]')) return false;
  return true;
}
