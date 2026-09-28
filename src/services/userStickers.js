import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { db } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_ROOT = path.join(__dirname, '../../public/uploads/stickers');

export function userStickerDir(userId) {
  const dir = path.join(UPLOAD_ROOT, userId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function deleteUserStickerFiles(userId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(userId || ''))) return false;
  const root = path.resolve(UPLOAD_ROOT);
  const dir = path.resolve(root, userId);
  if (!dir.startsWith(`${root}${path.sep}`) || !fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export function getUserSticker(userId, id) {
  if (!userId || !id) return null;
  return db.prepare('SELECT * FROM user_stickers WHERE user_id = ? AND id = ?').get(userId, id) || null;
}

export function listUserStickers(userId) {
  if (!userId) return [];
  const rows = db.prepare(`
    SELECT id, filename, label, created_at FROM user_stickers
    WHERE user_id = ? ORDER BY datetime(created_at) DESC LIMIT 80
  `).all(userId);
  return rows.map((r) => ({
    id: r.id,
    label: r.label || '',
    tag: `user:${r.id}`,
    url: `/uploads/stickers/${userId}/${r.filename}`,
    created_at: r.created_at,
  }));
}

export function insertUserSticker(userId, filename, label) {
  const id = uuid();
  const created_at = new Date().toISOString();
  db.prepare(`
    INSERT INTO user_stickers (id, user_id, filename, label, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, userId, filename, label || null, created_at);
  return {
    id,
    label: label || '',
    tag: `user:${id}`,
    url: `/uploads/stickers/${userId}/${filename}`,
    created_at,
  };
}

export function describeUserStickerTag(userId, tag) {
  const id = String(tag || '').replace(/^user:/i, '').trim();
  if (!id) return '用户发了一个自定义表情包';
  const row = getUserSticker(userId, id);
  if (row?.label) return `用户发了一个表情包：${row.label}`;
  return '用户发了一个自定义表情包';
}
