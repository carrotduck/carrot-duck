import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { db } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = path.resolve(path.join(__dirname, '../../public'));

function safePublicFile(urlPath) {
  const value = String(urlPath || '').trim();
  if (!value.startsWith('/uploads/') || value.includes('\0')) return null;
  const fullPath = path.resolve(PUBLIC_ROOT, `.${value}`);
  return fullPath.startsWith(`${PUBLIC_ROOT}${path.sep}`) ? fullPath : null;
}

export function registerMediaAsset(userId, urlPath, {
  purpose,
  mime = null,
  bytes = 0,
  retentionDays = 30,
} = {}) {
  const filePath = safePublicFile(urlPath);
  if (!userId || !filePath) return null;
  const id = uuid();
  const now = new Date().toISOString();
  const retentionUntil = new Date(Date.now() + Math.max(1, retentionDays) * 86400000).toISOString();
  db.prepare(`
    INSERT INTO media_assets (id, user_id, url_path, purpose, mime, bytes, retention_until, created_at, last_accessed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, urlPath, purpose || 'unknown', mime, Number(bytes) || 0, retentionUntil, now, now);
  return id;
}

function referencedByMessage(userId, urlPath) {
  return Boolean(db.prepare(`
    SELECT 1 FROM messages
    WHERE user_id = ? AND (content LIKE ? OR metadata LIKE ?) LIMIT 1
  `).get(userId, `%${urlPath}%`, `%${urlPath}%`));
}

export function cleanupExpiredMedia() {
  const rows = db.prepare('SELECT * FROM media_assets WHERE retention_until <= ? ORDER BY retention_until ASC LIMIT 500')
    .all(new Date().toISOString());
  let deleted = 0;
  let retained = 0;
  for (const row of rows) {
    if (referencedByMessage(row.user_id, row.url_path)) {
      db.prepare('UPDATE media_assets SET retention_until = ?, last_accessed = ? WHERE id = ?')
        .run(new Date(Date.now() + 90 * 86400000).toISOString(), new Date().toISOString(), row.id);
      retained += 1;
      continue;
    }
    const filePath = safePublicFile(row.url_path);
    if (filePath && fs.existsSync(filePath)) fs.rmSync(filePath);
    db.prepare('DELETE FROM media_assets WHERE id = ?').run(row.id);
    deleted += 1;
  }
  return { deleted, retained };
}

export function deleteUserMedia(userId) {
  const rows = db.prepare('SELECT id, url_path FROM media_assets WHERE user_id = ?').all(userId);
  for (const row of rows) {
    const filePath = safePublicFile(row.url_path);
    if (filePath && fs.existsSync(filePath)) fs.rmSync(filePath);
  }
  return db.prepare('DELETE FROM media_assets WHERE user_id = ?').run(userId).changes || 0;
}

export function deleteMediaFiles(urlPaths = []) {
  let deleted = 0;
  for (const urlPath of urlPaths) {
    const filePath = safePublicFile(urlPath);
    if (filePath && fs.existsSync(filePath)) {
      fs.rmSync(filePath);
      deleted += 1;
    }
  }
  return deleted;
}
