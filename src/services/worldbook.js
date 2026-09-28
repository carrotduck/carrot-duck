import { v4 as uuid } from 'uuid';
import { db } from '../db.js';
import { callDeepSeek } from './deepseek.js';

export const PREFRONTAL_KEYWORD = 'prefrontal-intent';
export const INTENT_TTL_MS = 7 * 86400000;

export function listWorldbook(userId) {
  return db.prepare('SELECT * FROM worldbook_entries WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

export function addWorldbookEntry(userId, keyword, content) {
  const id = uuid();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO worldbook_entries (id, user_id, keyword, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, userId, keyword, content, now);
  return { id, keyword, content, created_at: now };
}

export function addPrefrontalIntent(userId, intentText, { rationale = '' } = {}) {
  const content = rationale
    ? `${intentText}\n（${rationale}）`
    : intentText;
  return addWorldbookEntry(userId, PREFRONTAL_KEYWORD, content);
}

export function getActivePrefrontalIntents(userId) {
  purgeExpiredPrefrontalIntents(userId);
  const cutoff = new Date(Date.now() - INTENT_TTL_MS).toISOString();
  return db.prepare(`
    SELECT * FROM worldbook_entries
    WHERE user_id = ? AND keyword = ? AND datetime(created_at) >= datetime(?)
    ORDER BY datetime(created_at) DESC LIMIT 8
  `).all(userId, PREFRONTAL_KEYWORD, cutoff);
}

export function purgeExpiredPrefrontalIntents(userId) {
  const cutoff = new Date(Date.now() - INTENT_TTL_MS).toISOString();
  const result = db.prepare(`
    DELETE FROM worldbook_entries
    WHERE user_id = ? AND keyword = ? AND datetime(created_at) < datetime(?)
  `).run(userId, PREFRONTAL_KEYWORD, cutoff);
  return result.changes || 0;
}

export function upsertPprFailureSummary(userId, userName, summary) {
  const keyword = 'ppr-failure-pattern';
  const content = `对${userName}无效的PPR方式：${summary}`;
  const existing = db.prepare('SELECT id FROM worldbook_entries WHERE user_id = ? AND keyword = ?').get(userId, keyword);
  const now = new Date().toISOString();
  if (existing) {
    db.prepare('UPDATE worldbook_entries SET content = ?, created_at = ? WHERE id = ?').run(content, now, existing.id);
    return { id: existing.id, keyword, content };
  }
  return addWorldbookEntry(userId, keyword, content);
}

export async function maybeExtractWorldbook(userId, userMessage, aiMessage) {
  if (!/我是|我叫|我住在|我喜欢|my name is|i live|i like|remember/i.test(userMessage)) return null;

  const { text } = await callDeepSeek([
    { role: 'system', content: 'Extract one user fact as JSON: {"keyword":"short trigger word","content":"fact sentence"}. Only if a clear personal fact exists. Otherwise output NONE.' },
    { role: 'user', content: `User: ${userMessage}\nAI: ${aiMessage}` },
  ], { maxTokens: 100, temperature: 0.2 });

  if (!text || /NONE/i.test(text)) return null;
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    if (parsed.keyword && parsed.content) {
      return addWorldbookEntry(userId, parsed.keyword, parsed.content);
    }
  } catch {
    // ignore parse errors
  }
  return null;
}
