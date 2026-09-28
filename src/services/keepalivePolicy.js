/**
 * Keepalive decision tree + anti-repetition + message grading.
 */
import { db } from '../db.js';
import { getDesireState } from './desireDrive.js';
import { isNoProactiveActive } from './conversationMode.js';
import { getBoundaryControl } from './relationalState.js';

const TOPIC_WINDOW_MS = 3 * 86400000;

function safeTimeMs(value, fallback = Date.now()) {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(t) ? t : fallback;
}

export function isTogetherRainActive(user) {
  if (!user?.together_rain_until) return false;
  return new Date(user.together_rain_until).getTime() > Date.now();
}

export function hoursSinceLastVoiceCall(userId) {
  const row = db.prepare(`
    SELECT created_at FROM messages
    WHERE user_id = ? AND (source = 'voice_call' OR json_extract(metadata, '$.voice_call_summary') = 1)
    ORDER BY datetime(created_at) DESC LIMIT 1
  `).get(userId);
  if (!row?.created_at) return Infinity;
  const ts = safeTimeMs(row.created_at, NaN);
  if (!Number.isFinite(ts)) return Infinity;
  return (Date.now() - ts) / 3600000;
}

export function minutesSinceLastChat(userId, fallbackMs = Date.now()) {
  const row = db.prepare(`
    SELECT created_at FROM messages
    WHERE user_id = ? AND role = 'user' AND source = 'chat'
    ORDER BY datetime(created_at) DESC LIMIT 1
  `).get(userId);
  const ts = row?.created_at ? safeTimeMs(row.created_at, fallbackMs) : fallbackMs;
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, (Date.now() - ts) / 60000);
}

export function recentKeepaliveTopics(userId, withinMs = TOPIC_WINDOW_MS) {
  const cutoff = new Date(Date.now() - withinMs).toISOString();
  const rows = db.prepare(`
    SELECT thoughts, content, action FROM keepalive_logs
    WHERE user_id = ? AND datetime(created_at) >= datetime(?)
    ORDER BY datetime(created_at) DESC LIMIT 30
  `).all(userId, cutoff);
  const topics = [];
  for (const row of rows) {
    const blob = `${row.thoughts || ''} ${row.content || ''}`;
    const tokens = blob.match(/[\u4e00-\u9fff]{2,8}|[a-zA-Z]{4,}/g) || [];
    topics.push(...tokens.slice(0, 6));
  }
  return topics;
}

export function topicRecentlyMentioned(userId, text) {
  const topics = recentKeepaliveTopics(userId);
  if (!topics.length) return false;
  const blob = String(text || '').toLowerCase();
  const hits = topics.filter((t) => blob.includes(String(t).toLowerCase()));
  return hits.length >= 2;
}

export function interactionDensity(userId, withinHours = 48) {
  const cutoff = new Date(Date.now() - withinHours * 3600000).toISOString();
  const count = db.prepare(`
    SELECT COUNT(*) AS c FROM messages
    WHERE user_id = ? AND role = 'user' AND source = 'chat'
    AND datetime(created_at) >= datetime(?)
  `).get(userId, cutoff)?.c || 0;
  if (count >= 12) return 'high';
  if (count >= 4) return 'medium';
  return 'low';
}

/**
 * @returns {{ allowRoam: boolean, allowMessage: boolean, allowProactive: boolean, reason: string, topicDampen: number, messageLevel: string }}
 */
export function evaluateKeepalivePolicy(user, context = {}) {
  const desireState = context.desireState || getDesireState(user);
  const stress = desireState?.drives?.stress ?? 0;
  const sinceChatMin = context.sinceChatMin ?? minutesSinceLastChat(user.id);
  const sinceCallH = context.sinceCallH ?? hoursSinceLastVoiceCall(user.id);
  const togetherRain = context.togetherRain ?? isTogetherRainActive(user);
  const boundary = context.boundaryControl || getBoundaryControl(user.id);

  let allowMessage = true;
  let allowProactive = true;
  let reason = 'ok';
  let topicDampen = 1;

  const activity = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM messages WHERE user_id = ? AND role = 'user' AND source = 'chat') AS user_messages,
      (SELECT COUNT(*) FROM messages WHERE user_id = ? AND source = 'keepalive' AND consumed = 0 AND archived = 0) AS pending_messages,
      (SELECT COUNT(*) FROM messages WHERE user_id = ? AND source = 'keepalive' AND archived = 0 AND substr(created_at, 1, 10) = substr(?, 1, 10)) AS proactive_today
  `).get(user.id, user.id, user.id, new Date().toISOString());

  if (togetherRain) {
    return {
      allowRoam: false,
      allowMessage: false,
      allowProactive: false,
      reason: 'together_rain',
      topicDampen: 1,
      messageLevel: 'none',
      stress,
    };
  }

  if (isNoProactiveActive(user)) {
    allowMessage = false;
    allowProactive = false;
    reason = 'presence_no_proactive_24h';
  }

  if ((activity?.user_messages || 0) < 2) {
    allowMessage = false;
    allowProactive = false;
    reason = reason === 'ok' ? 'relationship_too_early' : `${reason}+relationship_too_early`;
  }

  if ((activity?.pending_messages || 0) >= 1) {
    allowMessage = false;
    allowProactive = false;
    reason = reason === 'ok' ? 'awaiting_user_response' : `${reason}+awaiting_user_response`;
  }

  if ((activity?.proactive_today || 0) >= 1) {
    allowMessage = false;
    allowProactive = false;
    reason = reason === 'ok' ? 'daily_proactive_cap' : `${reason}+daily_proactive_cap`;
  }

  if (sinceChatMin < 60) {
    allowMessage = false;
    allowProactive = false;
    reason = 'recent_chat';
  }

  if (sinceCallH < 24) {
    allowProactive = false;
    if (reason === 'ok') reason = 'recent_call';
  }

  if (boundary.caution_level === 'high' || boundary.proactiveDampen === 0) {
    allowMessage = false;
    allowProactive = false;
    reason = reason === 'ok' ? 'boundary_feedback_high' : `${reason}+boundary_feedback_high`;
  } else if (boundary.caution_level === 'medium') {
    allowProactive = false;
    if (reason === 'ok') reason = 'boundary_feedback_medium';
  }

  if (context.suggestedTopic && topicRecentlyMentioned(user.id, context.suggestedTopic)) {
    topicDampen = 0.5;
  }

  const messageLevel = pickMessageLevel(user, {
    attachment: (desireState?.drives?.attachment ?? 0.5) * (boundary.proactiveDampen ?? 1),
    density: interactionDensity(user.id),
    stress,
    allowMessage,
    allowProactive,
    postWorkNudge: context.postWorkNudge && boundary.caution_level === 'normal',
    boundary,
  });

  return {
    allowRoam: true,
    allowMessage: allowMessage && messageLevel !== 'none',
    allowProactive,
    reason,
    topicDampen,
    messageLevel,
    stress,
    boundary,
    activity,
  };
}

export function pickMessageLevel(user, {
  attachment = 0.5,
  density = 'low',
  stress = 0,
  allowMessage = true,
  allowProactive = false,
  postWorkNudge = false,
  boundary = null,
} = {}) {
  if (!allowMessage) return 'none';
  if (boundary?.caution_level === 'high') return 'none';
  if (boundary?.caution_level === 'medium' && !postWorkNudge) return 'fragment';
  if (stress > 0.7) return 'fragment';

  let score = attachment;
  if (density === 'high') score += 0.2;
  if (density === 'medium') score += 0.08;
  if (postWorkNudge && allowProactive) score += 0.05;

  if (score >= 0.82) return 'full';
  if (score >= 0.62) return 'oneline';
  if (score >= 0.42) return 'fragment';
  return 'none';
}

export function clipMessageToLevel(text, level) {
  const s = String(text || '').trim();
  if (!s || level === 'none') return '';
  if (level === 'fragment') {
    // 喻拾话少，碎语更短
    return s.length <= 10 ? s : `${s.slice(0, 9)}…`;
  }
  if (level === 'oneline') {
    const first = s.split(/[。！？.!?\n]/)[0].trim() || s;
    return first.length <= 48 ? first : `${first.slice(0, 47)}…`;
  }
  return s;
}

export function applyPolicyToRoamResult(result, policy) {
  const next = { ...result };
  if (!policy.allowMessage && next.action === 'message') {
    next.action = 'idle';
    next.rawContent = '';
    next.thoughts = `${next.thoughts || ''}（policy: no proactive message）`.trim();
    next.content = '发呆';
    return next;
  }
  if (next.action === 'message' && next.rawContent && policy.messageLevel) {
    next.rawContent = clipMessageToLevel(next.rawContent, policy.messageLevel);
    if (!next.rawContent) {
      next.action = 'idle';
      next.content = '发呆';
    }
  }
  return next;
}
