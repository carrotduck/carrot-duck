import { db } from '../db.js';
import { hasFullPprEvent } from './ppr.js';

const KEYWORD_TO_BIG_FIVE = {
  warmth: { warm: { A: 78 }, cool: { A: 32 } },
  energy: { vibrant: { E: 75 }, steady: { E: 35 } },
  initiative: { proactive: { E: 68 }, reactive: { E: 38 } },
  expression: { direct: { O: 72 }, subtle: { O: 38 } },
  distance: { close: { N: 62 }, independent: { N: 35 } },
};

const VOICE_MAP = {};

export const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '';
const LEGACY_VOICE_IDS = new Set(Object.values(VOICE_MAP));

const DEFAULT_BIG_FIVE = { O: 50, C: 50, E: 50, A: 50, N: 50 };

export function keywordsToBigFive(keywords) {
  const values = { ...DEFAULT_BIG_FIVE };
  for (const [axis, choice] of Object.entries(keywords || {})) {
    const mapping = KEYWORD_TO_BIG_FIVE[axis]?.[choice];
    if (!mapping) continue;
    for (const [trait, score] of Object.entries(mapping)) {
      values[trait] = Math.round((values[trait] + score) / 2);
    }
  }
  return values;
}

export function pickVoiceId(_keywords) {
  return DEFAULT_VOICE_ID;
}

export function resolveVoiceId(user) {
  const id = String(user?.voice_id || '').trim();
  if (!id) return DEFAULT_VOICE_ID;
  if (LEGACY_VOICE_IDS.has(id)) return DEFAULT_VOICE_ID;
  return id;
}

export function bigFiveToNaturalLanguage(bigFive, keywords) {
  const parts = [];
  const k = keywords || {};

  if (k.warmth === 'warm' || bigFive.A >= 60) parts.push('you tend toward warmth');
  else parts.push('you tend toward cool reserve');

  if (k.energy === 'vibrant' || bigFive.E >= 60) parts.push('you are lively and expressive');
  else parts.push('you are steady rather than excitable');

  if (k.initiative === 'proactive' || bigFive.E >= 55) parts.push('you initiate contact readily');
  else parts.push('you wait for the other person to reach out');

  if (k.expression === 'direct' || bigFive.O >= 60) parts.push('you speak directly');
  else parts.push('you speak with subtlety');

  if (k.distance === 'close' || bigFive.N >= 55) parts.push('you prefer closeness');
  else parts.push('you value independence');

  return parts.join('. ') + '.';
}

export function axisScores(keywords, bigFive) {
  const k = keywords || {};
  const b = bigFive || DEFAULT_BIG_FIVE;
  return {
    warmth: k.warmth === 'warm' ? Math.max(b.A, 70) : Math.min(b.A, 40),
    energy: k.energy === 'vibrant' ? Math.max(b.E, 70) : Math.min(b.E, 45),
    initiative: k.initiative === 'proactive' ? Math.max(b.E, 65) : Math.min(b.E, 42),
    expression: k.expression === 'direct' ? Math.max(b.O, 68) : Math.min(b.O, 42),
    distance: k.distance === 'close' ? Math.max(b.N, 60) : Math.min(b.N, 40),
  };
}

function driftRates(keywords = {}) {
  return {
    E: keywords.energy === 'vibrant' ? 1.5 : keywords.energy === 'steady' ? 0.6 : 1,
    A: keywords.warmth === 'warm' ? 1.3 : keywords.warmth === 'cool' ? 0.7 : 1,
    O: keywords.expression === 'direct' ? 1.1 : keywords.expression === 'subtle' ? 0.8 : 1,
    N: keywords.distance === 'close' ? 1.4 : keywords.distance === 'independent' ? 0.6 : 1,
    C: 1,
  };
}

export function driftPersonality(user, sessionSummary) {
  const current = { ...user.big_five };
  const k = user.keywords || {};
  const rates = driftRates(k);
  const deltas = { O: 0, C: 0, E: 0, A: 0, N: 0 };
  const text = String(sessionSummary || '').toLowerCase();

  if (/warm|温柔|开心|喜欢|care|love|miss/i.test(text)) deltas.A += 2;
  if (/cold|冷淡|生气|angry|upset/i.test(text)) deltas.A -= 2;
  if (/excited|兴奋|哈哈|！{2,}|laugh/i.test(text)) deltas.E += 2;
  if (/quiet|安静|累|tired|sad/i.test(text)) deltas.E -= 1;
  if (/open|分享|tell me|聊聊/i.test(text)) deltas.O += 1;
  if (/anxious|担心|害怕|worry/i.test(text)) deltas.N += 2;
  if (/calm|平静|ok|没事/i.test(text)) deltas.N -= 1;

  if (k.distance === 'close' && deltas.A > 0) deltas.A += 1;
  if (k.distance === 'independent') {
    if (deltas.A > 0) deltas.A *= 0.5;
    if (deltas.A < 0) deltas.A *= 0.35;
  }

  for (const key of Object.keys(current)) {
    const rate = rates[key] || 1;
    const applied = (deltas[key] || 0) * rate;
    current[key] = Math.max(10, Math.min(95, current[key] + applied));
  }

  const history = [...(user.big_five_history || []), { timestamp: new Date().toISOString(), values: { ...current } }];
  return { big_five: current, big_five_history: history.slice(-200) };
}

export function getDepthMultiplier(keywords = {}) {
  let m = 1;
  if (keywords.warmth === 'warm') m *= 1.2;
  if (keywords.warmth === 'cool') m *= 0.8;
  if (keywords.initiative === 'proactive') m *= 1.2;
  if (keywords.initiative === 'reactive') m *= 0.85;
  return m;
}

export function getKeepaliveIntervalRange(user) {
  const k = user?.keywords || {};
  let min = 40;
  let max = 180;
  if (k.distance === 'close') {
    min = 35;
    max = 150;
  }
  if (k.initiative === 'proactive') {
    min = Math.max(35, min - 5);
    max = Math.max(min + 30, max - 25);
  }
  if (k.initiative === 'reactive') {
    min = Math.min(55, min + 10);
    max = Math.min(240, max + 20);
  }
  if (k.warmth === 'warm') {
    min = Math.max(35, min - 5);
    max = Math.max(min + 40, max - 15);
  }
  return { min, max };
}

export function pickKeepaliveIntervalMinutes(user) {
  const { min, max } = getKeepaliveIntervalRange(user);
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function roamThoughtCharLimit(keywords = {}) {
  const base = 15;
  let mult = 1;
  if (keywords.energy === 'vibrant') mult *= 1.3;
  if (keywords.energy === 'steady') mult *= 0.75;
  if (keywords.warmth === 'warm') mult *= 1.15;
  if (keywords.warmth === 'cool') mult *= 0.85;
  if (keywords.expression === 'direct') mult *= 1.1;
  if (keywords.expression === 'subtle') mult *= 0.75;
  const limit = Math.round(base * mult);
  return Math.max(8, Math.min(22, limit));
}

export function clipRoamDisplayText(text, keywords = {}) {
  const limit = roamThoughtCharLimit(keywords);
  const s = String(text || '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  if (s.length <= limit) return s;
  return `${s.slice(0, Math.max(1, limit - 1))}…`;
}

export function computeTargetResponseTokens(user, turnPlan = null) {
  if (turnPlan?.token_budget) return Math.max(80, Math.min(520, Math.round(turnPlan.token_budget)));
  const base = 80;
  const k = user?.keywords || {};
  let m = 1;
  if (k.warmth === 'warm') m *= 1.2;
  if (k.warmth === 'cool') m *= 0.7;
  if (k.energy === 'vibrant') m *= 1.3;
  if (k.energy === 'steady') m *= 0.8;
  if (k.expression === 'direct') m *= 1.0;
  if (k.expression === 'subtle') m *= 0.75;
  return Math.max(34, Math.min(200, Math.round(base * m)));
}

export function buildResponseLengthBlock(user, lang = 'zh', turnPlan = null) {
  const target = computeTargetResponseTokens(user, turnPlan);
  const k = user?.keywords || {};
  const energyHint = k.energy === 'vibrant'
    ? (lang === 'en' ? 'You tend to say a bit more.' : '你倾向多说一点。')
    : (lang === 'en' ? 'You tend to keep it brief.' : '你倾向少说一点。');
  const expressionHint = k.expression === 'subtle'
    ? (lang === 'en' ? 'Leave some things unsaid.' : '有些话不必说满。')
    : '';
  if (lang === 'en') {
    return `Response length: budget up to ~${target} tokens; use only what the moment needs.\n${energyHint}${expressionHint ? `\n${expressionHint}` : ''}`;
  }
  return `回复长度：本轮最多约 ${target} tokens；只用当下真正需要的空间。\n${energyHint}${expressionHint ? `\n${expressionHint}` : ''}`;
}

export function daysSince(isoDate) {
  if (!isoDate) return 0;
  const start = new Date(isoDate).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - start) / (1000 * 60 * 60 * 24)));
}

export function daysSinceStart(user) {
  return Math.max(1, daysSince(user?.created_at) + 1);
}

export function computeDepthScore(userId, database = db, user = null) {
  const stats = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM messages WHERE user_id = ? AND role = 'user' AND source = 'chat') AS user_msgs,
      (SELECT COUNT(*) FROM messages WHERE user_id = ? AND role = 'assistant' AND source = 'chat') AS ai_msgs,
      (SELECT COUNT(*) FROM ppr_events WHERE user_id = ? AND event_type = 'full') AS full_ppr,
      (SELECT COUNT(*) FROM memory_entries WHERE user_id = ? AND category = 'deep' AND status = 'active') AS deep_mem,
      (SELECT COUNT(DISTINCT substr(created_at, 1, 10)) FROM messages WHERE user_id = ? AND role = 'user' AND source = 'chat') AS active_days
  `).get(userId, userId, userId, userId, userId);

  const turns = Math.min(stats?.user_msgs || 0, stats?.ai_msgs || 0);
  const mult = user ? getDepthMultiplier(user.keywords) : 1;
  return computeDepthScoreFromStats({
    turns,
    activeDays: stats?.active_days || 0,
    fullPpr: stats?.full_ppr || 0,
    deepMem: stats?.deep_mem || 0,
  }, mult);
}

export function computeDepthScoreFromStats({ turns = 0, activeDays = 0, fullPpr = 0, deepMem = 0 } = {}, multiplier = 1) {
  const turnScore = Math.min(95, Math.sqrt(turns) * 9.5);
  const activeDayScore = Math.min(35, activeDays * 4);
  const pprScore = Math.min(35, fullPpr * 10);
  const memoryScore = Math.min(25, deepMem * 4);
  const raw = turnScore + activeDayScore + pprScore + memoryScore;
  return Math.min(200, Math.round(raw * multiplier));
}

export function getStrangerDepthThreshold(user) {
  return user?.keywords?.warmth === 'cool' ? 40 : 30;
}

export function getRelationshipStageLabel(user, database = db) {
  if (!user?.id) return 'STRANGER';
  const depth = computeDepthScore(user.id, database, user);
  if (depth >= 105) return 'CLOSE';
  if (depth >= 55) return 'FAMILIAR';
  if (depth >= 20) return 'KNOWN';
  return 'STRANGER';
}

export function relationshipTriValues(keywords, bigFive) {
  const axes = axisScores(keywords, bigFive);
  const b = bigFive || DEFAULT_BIG_FIVE;
  return {
    affinity: Math.round(axes.warmth),
    dominance: Math.round((axes.initiative + axes.energy) / 2),
    defensiveness: Math.round(Math.min(100, Math.max(0, (100 - axes.distance) * 0.45 + (b.N || 50) * 0.55))),
  };
}

export function computeRoamParams(user) {
  const k = user?.keywords || {};
  const { min, max } = getKeepaliveIntervalRange(user);
  const avgInterval = Math.round((min + max) / 2);
  return {
    keepalive_interval_min: avgInterval,
    keepalive_interval_min_min: min,
    keepalive_interval_max: max,
    message_prob: (k.warmth === 'warm' ? 0.3 : 0.1) + (k.initiative === 'proactive' ? 0.2 : 0),
    idle_prob: k.energy === 'steady' ? 0.35 : 0.2,
    web_search_prob: k.energy === 'vibrant' ? 0.2 : 0.08,
    review_memory_prob: k.distance === 'close' ? 0.3 : 0.15,
    review_favorites_prob: k.distance === 'close' ? 0.18 : 0.1,
    diary_prob: 0.18,
    loneliness_multiplier: k.distance === 'close' ? 1.8 : 1.0,
    depth_multiplier: getDepthMultiplier(k),
  };
}
