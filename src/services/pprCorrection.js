import { db } from '../db.js';
import { callDeepSeek } from './deepseek.js';
import { upsertPprFailureSummary } from './worldbook.js';
import { expirePendingPprEvents } from './ppr.js';

const PPR_FAILURE_KEYWORD = 'ppr-failure-pattern';
const INTERVAL_MS = 72 * 60 * 60 * 1000;
let lastRun = 0;

export function getFailedPprEvents(userId, sinceIso) {
  let sql = `SELECT * FROM ppr_events WHERE user_id = ? AND event_type IN ('rejected', 'failed')`;
  const params = [userId];
  if (sinceIso) {
    sql += ' AND datetime(created_at) >= datetime(?)';
    params.push(sinceIso);
  }
  sql += ' ORDER BY datetime(created_at) DESC LIMIT 30';
  return db.prepare(sql).all(...params);
}

export async function analyzeUserPprFailures(user) {
  const since = new Date(Date.now() - INTERVAL_MS).toISOString();
  const failed = getFailedPprEvents(user.id, since);
  if (!failed.length) return null;

  const samples = failed.map((e) => ({
    ai: e.ai_ppr_content,
    user: e.user_resonance_content,
    at: e.created_at,
  }));

  const { text } = await callDeepSeek([
    {
      role: 'system',
      content: 'Analyze explicitly rejected PPR attempts. Neutral replies and silence are not failures. Output 2-4 concise Chinese bullets about what was rejected for THIS user (e.g. wrong memory, over-reading, tone mismatch).',
    },
    { role: 'user', content: JSON.stringify(samples, null, 2) },
  ], { maxTokens: 220, temperature: 0.3 });

  if (!text?.trim()) return null;
  const summary = text.trim();
  upsertPprFailureSummary(user.id, user.name, summary);
  return summary;
}

export async function runPprCorrectionJob() {
  expirePendingPprEvents();
  const now = Date.now();
  if (now - lastRun < INTERVAL_MS) return;
  lastRun = now;

  const users = db.prepare('SELECT id FROM users').all();
  for (const row of users) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.id);
    if (!user) continue;
    try {
      const parsed = { ...user, name: user.name };
      await analyzeUserPprFailures(parsed);
    } catch (e) {
      console.error('[ppr-correction]', row.id, e.message);
    }
  }
}

export function getPprCorrectionStats() {
  const rows = db.prepare(`
    SELECT user_id, COUNT(*) as count FROM ppr_events WHERE event_type IN ('rejected', 'failed') GROUP BY user_id
  `).all();
  const patterns = db.prepare(`
    SELECT * FROM worldbook_entries WHERE keyword = ?
  `).all(PPR_FAILURE_KEYWORD);
  return { failedByUser: rows, failurePatterns: patterns.length };
}
