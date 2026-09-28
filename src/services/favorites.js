import { v4 as uuid } from 'uuid';
import { db } from '../db.js';

export function listFavorites(userId, limit = 50) {
  return db.prepare(`
    SELECT * FROM favorites WHERE user_id = ? ORDER BY datetime(created_at) DESC LIMIT ?
  `).all(userId, limit).map((row) => ({
    ...row,
    source: row.source || 'manual',
  }));
}

export function addFavorite(userId, { messageId, content, role = 'user', source = 'manual' }) {
  const text = String(content || '').trim();
  if (!text) return null;
  const existing = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND content = ?').get(userId, text);
  if (existing) return existing.id;
  const id = uuid();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO favorites (id, user_id, message_id, content, role, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, messageId || null, text, role, source, now);
  return id;
}

export function removeFavorite(userId, { id, content }) {
  if (id) {
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND id = ?').run(userId, id);
    return true;
  }
  if (content) {
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND content = ?').run(userId, String(content).trim());
    return true;
  }
  return false;
}

export function getFavoritesForContext(userId, limit = 5) {
  return listFavorites(userId, limit);
}
