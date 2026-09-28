import { v4 as uuid } from 'uuid';
import { db } from '../db.js';

function parse(row) {
  if (!row) return null;
  let payload = null;
  if (row.payload) {
    try { payload = JSON.parse(row.payload); } catch { payload = row.payload; }
  }
  return { ...row, payload };
}

export function addPendingReview(userId, { type, title = '', content, payload = null, source = 'system', id = uuid() } = {}) {
  const t = String(type || '').trim();
  const c = String(content || '').trim();
  if (!userId || !t || !c) return null;
  db.prepare(`
    INSERT INTO pending_review (id, user_id, type, title, content, payload, status, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, userId, t, String(title || '').trim() || t, c, payload == null ? null : JSON.stringify(payload), source, new Date().toISOString());
  return getPendingReview(id, userId);
}

export function getPendingReview(id, userId = null) {
  const row = userId
    ? db.prepare('SELECT * FROM pending_review WHERE id = ? AND user_id = ?').get(id, userId)
    : db.prepare('SELECT * FROM pending_review WHERE id = ?').get(id);
  return parse(row);
}

export function listPendingReviews({ userId = '', status = 'pending', type = '', limit = 100 } = {}) {
  let sql = 'SELECT * FROM pending_review WHERE 1=1';
  const params = [];
  if (userId) { sql += ' AND user_id = ?'; params.push(userId); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (type) { sql += ' AND type = ?'; params.push(type); }
  sql += ' ORDER BY datetime(created_at) DESC LIMIT ?';
  params.push(Math.max(1, Math.min(Number(limit) || 100, 500)));
  return db.prepare(sql).all(...params).map(parse);
}

export function resolvePendingReview(id, userId, status = 'approved') {
  const next = status === 'rejected' ? 'rejected' : 'approved';
  const result = db.prepare(`
    UPDATE pending_review SET status = ?, reviewed_at = ?
    WHERE id = ? AND user_id = ? AND status = 'pending'
  `).run(next, new Date().toISOString(), id, userId);
  return result.changes > 0 ? getPendingReview(id, userId) : null;
}

export function deletePendingReview(id, userId) {
  return db.prepare('DELETE FROM pending_review WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

export function getPendingReviewStats() {
  return {
    total: db.prepare('SELECT COUNT(*) AS c FROM pending_review').get().c,
    by_status: db.prepare('SELECT status, COUNT(*) AS count FROM pending_review GROUP BY status ORDER BY count DESC').all(),
    by_type: db.prepare('SELECT type, status, COUNT(*) AS count FROM pending_review GROUP BY type, status ORDER BY count DESC').all(),
    pending_by_user: db.prepare(`
      SELECT user_id, COUNT(*) AS count FROM pending_review WHERE status = 'pending'
      GROUP BY user_id ORDER BY count DESC LIMIT 20
    `).all().map((r) => ({ ...r, user_prefix: String(r.user_id || '').slice(0, 8) })),
  };
}
