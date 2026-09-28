import { v4 as uuid } from 'uuid';
import { db } from '../db.js';

const OUTCOME_WINDOW_MS = 18 * 60 * 60 * 1000;
const TOPIC_COOLDOWN_MS = 48 * 60 * 60 * 1000;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function feedbackBoost(userId, action) {
  const row = db.prepare(`
    SELECT AVG(outcome_weight) AS mean, COUNT(*) AS attempts
    FROM agent_actions
    WHERE user_id = ? AND action = ? AND outcome_weight IS NOT NULL
      AND datetime(created_at) >= datetime(?)
  `).get(userId, action, new Date(Date.now() - 60 * 86400000).toISOString());
  if (!row?.attempts) return 0;
  return Math.max(-0.12, Math.min(0.12, (Number(row.mean || 0.5) - 0.5) * 0.3));
}

function topicPenalty(userId, topicKey) {
  if (!topicKey) return 0;
  const row = db.prepare(`
    SELECT created_at FROM agent_actions
    WHERE user_id = ? AND topic_key = ? AND action != 'wait'
    ORDER BY datetime(created_at) DESC LIMIT 1
  `).get(userId, topicKey);
  if (!row?.created_at) return 0;
  const age = Date.now() - new Date(row.created_at).getTime();
  return age < TOPIC_COOLDOWN_MS ? clamp(1 - age / TOPIC_COOLDOWN_MS, 0, 1) * 0.35 : 0;
}

export function expireAgentActionOutcomes(userId = null) {
  const cutoff = new Date(Date.now() - OUTCOME_WINDOW_MS).toISOString();
  const params = userId ? [cutoff, userId] : [cutoff];
  const whereUser = userId ? ' AND user_id = ?' : '';
  return db.prepare(`
    UPDATE agent_actions
    SET status = 'resolved', outcome = 'quiet', outcome_weight = 0.35, resolved_at = ?
    WHERE status = 'pending_user' AND datetime(created_at) < datetime(?)${whereUser}
  `).run(new Date().toISOString(), ...params).changes;
}

export function decideAgentAction({ user, desireState, summon, policy, diaryAllowed = true, sinceChatMin = 0 } = {}) {
  expireAgentActionOutcomes(user.id);
  const drives = desireState?.drives || {};
  const topicKey = `drive:${summon?.driveKey || 'none'}`;
  const cooldown = topicPenalty(user.id, topicKey);
  const candidates = [
    { action: 'wait', score: 0.18 + (sinceChatMin < 60 ? 0.25 : 0) + (drives.fatigue || 0) * 0.35 },
    { action: summon?.action || 'idle', score: 0.32 + clamp(summon?.score, 0, 1.4) * 0.5 - cooldown },
    { action: 'review_memory', score: 0.2 + (drives.reflection || 0) * 0.3 - cooldown * 0.5 },
    { action: 'review_favorites', score: 0.16 + (drives.attachment || 0) * 0.24 - cooldown * 0.5 },
    { action: 'associate', score: 0.18 + (drives.curiosity || 0) * 0.26 - cooldown * 0.4 },
    { action: 'introspect', score: 0.14 + (drives.reflection || 0) * 0.24 },
  ];

  for (const candidate of candidates) {
    if (candidate.action === 'idle') candidate.action = 'wait';
    if (candidate.action === 'message' && !policy?.allowMessage) candidate.score = 0;
    if (candidate.action === 'diary' && !diaryAllowed) candidate.score = 0;
    if (!policy?.allowRoam && candidate.action !== 'wait') candidate.score = 0;
    candidate.score += feedbackBoost(user.id, candidate.action);
    candidate.score = clamp(candidate.score, 0, 1.25);
  }

  const unique = new Map();
  for (const candidate of candidates) {
    const current = unique.get(candidate.action);
    if (!current || candidate.score > current.score) unique.set(candidate.action, candidate);
  }
  const ranked = [...unique.values()].sort((a, b) => b.score - a.score);
  let selected = ranked[0] || { action: 'wait', score: 1 };
  const bestNonWait = ranked.find((candidate) => candidate.action !== 'wait');
  if (!bestNonWait || bestNonWait.score < 0.54 || ranked[0]?.action === 'wait') {
    selected = { action: 'wait', score: Math.max(ranked.find((c) => c.action === 'wait')?.score || 0.5, 0.5) };
  }

  const id = uuid();
  const now = new Date().toISOString();
  const confidence = clamp(0.55 + Math.abs((ranked[0]?.score || 0) - (ranked[1]?.score || 0)) * 0.5, 0.55, 0.95);
  db.prepare(`
    INSERT INTO agent_actions (
      id, user_id, action, topic_key, score, confidence, decision_source,
      status, policy_json, created_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'code', ?, ?, ?, ?)
  `).run(
    id,
    user.id,
    selected.action,
    topicKey,
    selected.score,
    confidence,
    selected.action === 'wait' ? 'resolved' : 'decided',
    JSON.stringify({ reason: policy?.reason || 'ok', candidates: ranked.slice(0, 5) }),
    now,
    selected.action === 'wait' ? now : null,
  );
  return { id, action: selected.action, topic_key: topicKey, score: selected.score, confidence, candidates: ranked.slice(0, 5) };
}

export function markAgentActionExecuted(actionId, actualAction, { expectsReply = false } = {}) {
  if (!actionId) return false;
  const status = expectsReply ? 'pending_user' : 'resolved';
  const outcome = expectsReply ? null : 'completed';
  const weight = expectsReply ? null : 0.5;
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE agent_actions
    SET action = ?, status = ?, outcome = ?, outcome_weight = ?, resolved_at = ?
    WHERE id = ?
  `).run(actualAction || 'wait', status, outcome, weight, expectsReply ? null : now, actionId);
  return result.changes > 0;
}

export function markAgentActionFailed(actionId) {
  if (!actionId) return false;
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE agent_actions
    SET status = 'resolved', outcome = 'execution_failed', resolved_at = ?
    WHERE id = ?
  `).run(now, actionId);
  return result.changes > 0;
}

export function recordAgentActionOutcome(userId, signal) {
  const row = db.prepare(`
    SELECT id FROM agent_actions
    WHERE user_id = ? AND status = 'pending_user'
      AND datetime(created_at) >= datetime(?)
    ORDER BY datetime(created_at) DESC LIMIT 1
  `).get(userId, new Date(Date.now() - OUTCOME_WINDOW_MS).toISOString());
  if (!row) return null;

  let outcome = 'neutral';
  let weight = 0.5;
  if (signal?.boundary_risk === 'strong' || signal?.openness === 'closed') {
    outcome = 'rejected';
    weight = 0;
  } else if (signal?.valence === 'positive' || signal?.openness === 'open') {
    outcome = 'positive';
    weight = 1;
  } else if (signal?.valence === 'negative') {
    outcome = 'engaged';
    weight = 0.55;
  }
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE agent_actions
    SET status = 'resolved', outcome = ?, outcome_weight = ?, resolved_at = ?
    WHERE id = ?
  `).run(outcome, weight, now, row.id);
  return { id: row.id, outcome, weight };
}

export function getActionArbiterStats(userId = null) {
  const rows = userId
    ? db.prepare(`SELECT action, outcome, COUNT(*) AS count FROM agent_actions WHERE user_id = ? GROUP BY action, outcome`).all(userId)
    : db.prepare(`SELECT action, outcome, COUNT(*) AS count FROM agent_actions GROUP BY action, outcome`).all();
  return { schema: 'carrot_duck_action_arbiter_v1', rows };
}
