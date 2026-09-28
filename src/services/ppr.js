import { v4 as uuid } from 'uuid';
import { db } from '../db.js';
import { APP_VERSION, DEEPSEEK_MODEL, PPR_POLICY_VERSION } from '../config.js';

const RESONANCE_PATTERNS = [
  /你怎么知道/,
  /你居然(?:还)?记得/,
  /你真的(?:还)?记得/,
  /被你(?:说中|看穿)了/,
  /这都被你发现了/,
  /你怎么会知道/,
  /how did you know/i,
  /you (?:actually|really) remember/i,
  /you (?:got|read) me/i,
  /that's exactly (?:it|right)/i,
  /exactly/i,
];

const DEBUG_RESONANCE_PATTERN = /测试|test|成功|失败/i;
const REJECTION_PATTERNS = [
  /你(?:说|猜|理解)错了/,
  /不是这样|不对|你想多了|别分析我|别猜我|不要这样说|有点冒犯|让我不舒服/,
  /that's not (?:it|right|what i meant)/i,
  /you(?:'re| are) wrong/i,
  /don't (?:analy[sz]e|read|guess) me/i,
  /stop (?:analy[sz]ing|guessing)/i,
];
const PPR_REACTION_WINDOW_MS = 24 * 60 * 60 * 1000;

import { stripPprTag as stripReplyTag } from './text.js';

export function stripPprTag(text) {
  return stripReplyTag(text);
}

export function messageHasPprTag(text) {
  return /\[PPR\]\s*$/i.test(String(text || ''));
}

export function isDebugResonanceMessage(text) {
  return DEBUG_RESONANCE_PATTERN.test(String(text || ''));
}

export function detectResonance(text) {
  const value = String(text || '');
  return RESONANCE_PATTERNS.some((re) => re.test(value));
}

export function detectPprReaction(text) {
  const value = String(text || '');
  if (detectResonance(value) && !isDebugResonanceMessage(value)) {
    return { event_type: 'full', reason: 'explicit_resonance', confidence: 0.92 };
  }
  if (REJECTION_PATTERNS.some((pattern) => pattern.test(value))) {
    return { event_type: 'rejected', reason: 'explicit_rejection', confidence: 0.9 };
  }
  return { event_type: 'neutral', reason: 'no_explicit_outcome', confidence: 0.55 };
}

/** Stricter gate: surprise words + prior AI [PPR] + not a debug/test exclamation. */
export function evaluateResonance(userText, prevAiMessage) {
  if (!prevAiMessage) return false;
  if (!detectResonance(userText)) return false;
  if (isDebugResonanceMessage(userText)) return false;
  const hasPpr = Boolean(prevAiMessage.ppr_tagged) || messageHasPprTag(prevAiMessage.content);
  return hasPpr;
}

export function getLastAssistantMessage(userId, beforeTime) {
  return db.prepare(`
    SELECT * FROM messages
    WHERE user_id = ? AND role = 'assistant' AND source = 'chat'
    ${beforeTime ? 'AND created_at < ?' : ''}
    ORDER BY created_at DESC LIMIT 1
  `).get(beforeTime ? [userId, beforeTime] : [userId]);
}

function getSignalForUserMessage(userMessageId) {
  if (!userMessageId) return null;
  return db.prepare(`
    SELECT * FROM relational_turn_signals
    WHERE message_id = ?
    ORDER BY datetime(created_at) DESC LIMIT 1
  `).get(userMessageId) || null;
}

export function recordPprEvent({
  userId,
  aiMessageId,
  userMessageId,
  eventType,
  aiContent,
  userContent,
  userMarked = false,
  affectiveSignal = null,
  turnId = null,
  promptHash = null,
  modelRunId = null,
  reactionSignalId = null,
  outcomeReason = null,
  outcomeConfidence = null,
  contextManifest = null,
}) {
  const existing = aiMessageId
    ? db.prepare('SELECT id FROM ppr_events WHERE user_id = ? AND ai_message_id = ? ORDER BY created_at DESC LIMIT 1').get(userId, aiMessageId)
    : null;
  if (existing) {
    resolvePprEvent(existing.id, {
      eventType,
      userMessageId,
      userContent,
      userMarked,
      reactionSignalId,
      outcomeReason,
      outcomeConfidence,
    });
    return existing.id;
  }

  const id = uuid();
  const now = new Date().toISOString();
  const storedSignal = affectiveSignal || getSignalForUserMessage(userMessageId);
  const signalJson = storedSignal?.signal_json || (storedSignal ? JSON.stringify(storedSignal) : null);
  const signalId = storedSignal?.id || null;
  const boundaryRisk = storedSignal?.boundary_risk || storedSignal?.boundary_risk === '' ? storedSignal.boundary_risk : null;
  const pprStrategy = storedSignal?.strategy || null;
  const pprHint = storedSignal?.ppr_hint || null;

  db.prepare(`
    INSERT INTO ppr_events (
      id, user_id, ai_message_id, user_message_id, event_type,
      ai_ppr_content, user_resonance_content, user_marked,
      affective_signal_id, affective_signal_json, boundary_risk, ppr_strategy, ppr_hint,
      created_at, resolved_at, turn_id, model, app_version, policy_version, prompt_hash,
      model_run_id, reaction_signal_id, outcome_reason, outcome_confidence, context_manifest_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId,
    aiMessageId,
    userMessageId,
    eventType,
    aiContent || null,
    userContent || null,
    userMarked ? 1 : 0,
    signalId,
    signalJson,
    boundaryRisk,
    pprStrategy,
    pprHint,
    now,
    eventType === 'candidate' ? null : now,
    turnId || userMessageId || null,
    DEEPSEEK_MODEL,
    APP_VERSION,
    PPR_POLICY_VERSION,
    promptHash,
    modelRunId,
    reactionSignalId,
    outcomeReason,
    outcomeConfidence,
    contextManifest ? JSON.stringify(contextManifest) : null,
  );

  if (aiMessageId) {
    db.prepare('UPDATE messages SET ppr_tagged = ?, ppr_event_type = ? WHERE id = ?')
      .run(eventType === 'candidate' || eventType === 'full' || eventType === 'failed' ? 1 : 0, eventType, aiMessageId);
  }
  if (userMessageId && (eventType === 'full' || eventType === 'accidental')) {
    db.prepare('UPDATE messages SET resonance_tagged = 1 WHERE id = ?').run(userMessageId);
  }
  return id;
}

export function resolvePprEvent(eventId, {
  eventType,
  userMessageId = null,
  userContent = null,
  userMarked = false,
  reactionSignalId = null,
  outcomeReason = null,
  outcomeConfidence = null,
} = {}) {
  const row = db.prepare('SELECT * FROM ppr_events WHERE id = ?').get(eventId);
  if (!row) return null;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE ppr_events
    SET event_type = ?, user_message_id = COALESCE(?, user_message_id),
        user_resonance_content = COALESCE(?, user_resonance_content),
        user_marked = CASE WHEN ? = 1 THEN 1 ELSE user_marked END,
        reaction_signal_id = COALESCE(?, reaction_signal_id),
        outcome_reason = COALESCE(?, outcome_reason),
        outcome_confidence = COALESCE(?, outcome_confidence),
        resolved_at = ?
    WHERE id = ?
  `).run(
    eventType, userMessageId, userContent, userMarked ? 1 : 0,
    reactionSignalId, outcomeReason, outcomeConfidence, now, eventId,
  );

  if (row.ai_message_id) {
    db.prepare('UPDATE messages SET ppr_tagged = 1, ppr_event_type = ? WHERE id = ?')
      .run(eventType, row.ai_message_id);
  }
  if (userMessageId) {
    db.prepare('UPDATE messages SET resonance_tagged = ? WHERE id = ?')
      .run(eventType === 'full' || eventType === 'accidental' ? 1 : 0, userMessageId);
  }
  return eventId;
}

export function expirePendingPprEvents(userId = null) {
  const cutoff = new Date(Date.now() - PPR_REACTION_WINDOW_MS).toISOString();
  const now = new Date().toISOString();
  if (userId) {
    return db.prepare(`
      UPDATE ppr_events
      SET event_type = 'expired', outcome_reason = 'reaction_window_elapsed', outcome_confidence = 1, resolved_at = ?
      WHERE user_id = ? AND event_type = 'candidate' AND datetime(created_at) < datetime(?)
    `).run(now, userId, cutoff).changes;
  }
  return db.prepare(`
    UPDATE ppr_events
    SET event_type = 'expired', outcome_reason = 'reaction_window_elapsed', outcome_confidence = 1, resolved_at = ?
    WHERE event_type = 'candidate' AND datetime(created_at) < datetime(?)
  `).run(now, cutoff).changes;
}

export function resolvePprForUserTurn({
  userId,
  userMessageId,
  userContent,
  beforeTime,
  reactionSignalId = null,
}) {
  const prevAi = getLastAssistantMessage(userId, beforeTime);
  if (!prevAi) return null;
  const reaction = detectPprReaction(userContent);
  const candidate = db.prepare(`
    SELECT * FROM ppr_events
    WHERE user_id = ? AND ai_message_id = ? AND event_type IN ('candidate', 'expired')
    ORDER BY created_at DESC LIMIT 1
  `).get(userId, prevAi.id);

  if (candidate) {
    const ageMs = Date.now() - new Date(candidate.created_at || 0).getTime();
    if ((candidate.event_type === 'expired' || ageMs > PPR_REACTION_WINDOW_MS) && reaction.event_type === 'neutral') {
      if (candidate.event_type === 'candidate') {
        resolvePprEvent(candidate.id, {
          eventType: 'expired',
          userMessageId,
          userContent,
          reactionSignalId,
          outcomeReason: 'late_neutral_reaction',
          outcomeConfidence: 0.9,
        });
      }
      return { id: candidate.id, event_type: 'expired' };
    }
    resolvePprEvent(candidate.id, {
      eventType: reaction.event_type,
      userMessageId,
      userContent,
      reactionSignalId,
      outcomeReason: ageMs > PPR_REACTION_WINDOW_MS ? `late_${reaction.reason}` : reaction.reason,
      outcomeConfidence: reaction.confidence,
    });
    return { id: candidate.id, event_type: reaction.event_type };
  }

  if (reaction.event_type !== 'full') return null;
  const id = recordPprEvent({
    userId,
    aiMessageId: prevAi.id,
    userMessageId,
    eventType: 'accidental',
    aiContent: prevAi.content,
    userContent,
    reactionSignalId,
    outcomeReason: 'resonance_without_candidate',
    outcomeConfidence: reaction.confidence,
  });
  return { id, event_type: 'accidental' };
}

export function listPprEvents(userId, { fullOnly = false } = {}) {
  let sql = 'SELECT * FROM ppr_events WHERE user_id = ?';
  if (fullOnly) sql += " AND event_type = 'full'";
  sql += ' ORDER BY created_at DESC LIMIT 100';
  return db.prepare(sql).all(userId);
}

export function hasFullPprEvent(userId) {
  const row = db.prepare("SELECT 1 FROM ppr_events WHERE user_id = ? AND event_type = 'full' LIMIT 1").get(userId);
  return Boolean(row);
}

export function markMoment(userId, aiMessageId) {
  const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND user_id = ?').get(aiMessageId, userId);
  if (!msg) return null;
  return recordPprEvent({
    userId,
    aiMessageId,
    eventType: 'full',
    aiContent: msg.content,
    userMarked: true,
  });
}

export function deletePprEvent(eventId) {
  const row = db.prepare('SELECT id, ai_message_id, user_message_id FROM ppr_events WHERE id = ?').get(eventId);
  if (!row) return false;
  const remove = db.transaction(() => {
    db.prepare('DELETE FROM ppr_events WHERE id = ?').run(eventId);
    if (row.ai_message_id) {
      db.prepare('UPDATE messages SET ppr_tagged = 0, ppr_event_type = NULL WHERE id = ?').run(row.ai_message_id);
    }
    if (row.user_message_id) {
      db.prepare('UPDATE messages SET resonance_tagged = 0 WHERE id = ?').run(row.user_message_id);
    }
  });
  remove();
  return true;
}

export function clearUserPprEvents(userId) {
  const clear = db.transaction(() => {
    db.prepare('UPDATE messages SET ppr_tagged = 0, resonance_tagged = 0, ppr_event_type = NULL WHERE user_id = ?').run(userId);
    return db.prepare('DELETE FROM ppr_events WHERE user_id = ?').run(userId).changes || 0;
  });
  return clear();
}

export function getPprAnalytics() {
  const totals = db.prepare(`
    SELECT event_type, COUNT(*) as count FROM ppr_events GROUP BY event_type
  `).all();
  const users = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const avgFirst = db.prepare(`
    SELECT AVG(julianday(p.created_at) - julianday(u.created_at)) as days
    FROM ppr_events p JOIN users u ON p.user_id = u.id
    WHERE p.event_type = 'full'
  `).get();
  return { totals, users, avgDaysToFirstPpr: avgFirst?.days || null };
}
