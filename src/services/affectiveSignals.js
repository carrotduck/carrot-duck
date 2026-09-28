import { v4 as uuid } from 'uuid';
import { db } from '../db.js';
import { detectRelationshipCues } from './relationshipProfile.js';
import { APP_VERSION, PPR_POLICY_VERSION } from '../config.js';

const POSITIVE = /开心|高兴|喜欢|爱|谢谢|太好了|棒|顺利|放松|可爱|亲亲|抱抱|happy|love|thanks|cute|great|nice/i;
const NEGATIVE = /难过|伤心|烦|累|焦虑|害怕|委屈|孤独|崩溃|撑不住|不想活|讨厌|生气|low|sad|tired|anxious|afraid|angry|upset/i;
const OPEN = /小宝|宝宝|宝贝|抱|亲|陪|想你|贴贴|摸摸|谢谢|love|hug|miss you/i;
const CLOSED = /别说|不想聊|算了|随便|无所谓|别管|闭嘴|滚|停|不用|别提|stop|leave me|shut up|never mind/i;
const NEGATED_POSITIVE = /不开心|不高兴|不喜欢|不爱|不觉得可爱|not happy|don't like|do not like/i;
const NEGATED_OPEN = /不要(?:亲|抱|陪)|别(?:亲|抱|摸|叫我宝)|不想(?:亲|抱|贴)|don't (?:kiss|hug|call me)/i;
const MEMORY = /记得|上次|之前|以前|那天|你说过|我说过|还记得|remember|last time|before/i;
const PRESENT = /现在|刚刚|今天|此刻|这会儿|我现在|突然|有点|感觉|right now|today|just now/i;
const CROSS_TOPIC = /一直|每次|总是|反复|串起来|连起来|pattern|again|always/i;
const CARE = /怎么办|救命|陪我|安慰|抱抱|亲亲|摸摸|难受|累了|睡不着|help|comfort/i;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function unique(items) {
  return [...new Set(items.filter(Boolean))].slice(0, 8);
}

function levelFromScore(score) {
  if (score >= 4) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}

function choosePprHint(text, memories = []) {
  if (MEMORY.test(text)) return 'memory';
  if (CROSS_TOPIC.test(text)) return 'cross_topic';
  if (PRESENT.test(text)) return 'present_state';
  if (CARE.test(text)) return 'care';
  return 'none';
}

function chooseStrategy({ openness, boundary_risk, ppr_hint, intensity, conversationMode }) {
  if (boundary_risk === 'strong') return 'boundary_preserving_response';
  if (conversationMode === 'QUESTION' && ppr_hint === 'none') return 'ordinary_answer';
  if (boundary_risk === 'mild' || openness === 'cautious') return 'soft_recognition';
  if (openness === 'open' && ppr_hint !== 'none') return intensity === 'high' ? 'soft_recognition' : 'direct_recognition';
  if (ppr_hint === 'care') return 'support_response';
  return 'plain_response';
}

export function analyzeAffectiveSignal({
  user,
  message,
  conversationMode = 'PRESENCE',
  emotionState = null,
  memories = [],
  messageId = null,
  recentMessages = [],
} = {}) {
  const text = String(message || '').trim();
  const evidence = [];
  const observations = {
    char_count: text.length,
    exclamation_count: (text.match(/[!！]/g) || []).length,
    question_count: (text.match(/[?？]/g) || []).length,
    turn_gap_seconds: null,
    burst_count_5m: 1,
  };
  const priorUserTurns = (recentMessages || [])
    .filter((row) => row.role === 'user' && row.id !== messageId && row.created_at)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const previousUser = priorUserTurns[priorUserTurns.length - 1];
  if (previousUser?.created_at) {
    const gapMs = Date.now() - new Date(previousUser.created_at).getTime();
    if (Number.isFinite(gapMs) && gapMs >= 0) {
      observations.turn_gap_seconds = Math.round(gapMs / 1000);
      const cutoff = Date.now() - 5 * 60_000;
      observations.burst_count_5m = 1 + priorUserTurns.filter((row) => new Date(row.created_at).getTime() >= cutoff).length;
      evidence.push('turn_timing_observed');
    }
  }
  let pos = 0;
  let neg = 0;
  let energy = 0;

  if (POSITIVE.test(text) && !NEGATED_POSITIVE.test(text)) {
    pos += 2;
    evidence.push('positive_words');
  }
  if (NEGATIVE.test(text) || NEGATED_POSITIVE.test(text)) {
    neg += 2;
    evidence.push('negative_words');
  }
  if (/[!！]{2,}/.test(text)) {
    energy += 2;
    evidence.push('strong_exclamation');
  }
  if (/[?？]{2,}/.test(text)) {
    energy += 1;
    evidence.push('repeated_questions');
  }
  if (text.length > 120) {
    energy += 2;
    evidence.push('long_message');
  } else if (text.length > 40) {
    energy += 1;
    evidence.push('medium_message');
  }
  if (emotionState?.appraisal) {
    if (emotionState.appraisal.valence >= 2) pos += 1;
    if (emotionState.appraisal.valence <= -2) neg += 1;
    if (emotionState.appraisal.arousal >= 6) energy += 1;
    evidence.push('emotion_state');
  }

  let valence = 'neutral';
  if (pos > 0 && neg > 0) valence = 'mixed';
  else if (pos > 0) valence = 'positive';
  else if (neg > 0) valence = 'negative';

  let openness = 'cautious';
  if (OPEN.test(text) && !NEGATED_OPEN.test(text)) {
    openness = 'open';
    evidence.push('openness_words');
  }
  if (CLOSED.test(text) || NEGATED_OPEN.test(text)) {
    openness = 'closed';
    evidence.push('boundary_words');
  }

  const ppr_hint = choosePprHint(text, memories);
  if (ppr_hint !== 'none') evidence.push(`ppr_hint_${ppr_hint}`);

  let riskScore = 0;
  if (CLOSED.test(text) || NEGATED_OPEN.test(text)) riskScore += 3;
  if (neg > 0 && energy >= 2) riskScore += 1;
  if (/别|不要|stop|don't/i.test(text)) riskScore += 1;
  const boundary_risk = riskScore >= 3 ? 'strong' : riskScore >= 1 ? 'mild' : 'none';

  const intensity = levelFromScore(energy + Math.max(pos, neg));
  const valenceScore = clamp((pos - neg) / Math.max(2, pos + neg), -1, 1);
  const arousalScore = clamp((energy + Math.max(pos, neg)) / 7, 0, 1);
  const relationshipCues = detectRelationshipCues(text);
  if (relationshipCues.length) evidence.push('explicit_relationship_cue');
  const confidence = clamp(0.35 + evidence.length * 0.08 + (text.length > 20 ? 0.08 : 0), 0.35, 0.88);
  const strategy = chooseStrategy({ openness, boundary_risk, ppr_hint, intensity, conversationMode });

  return {
    schema: 'carrot_duck_affective_signal_v2',
    app_version: APP_VERSION,
    policy_version: PPR_POLICY_VERSION,
    user_id: user?.id || null,
    valence,
    valence_score: Math.round(valenceScore * 100) / 100,
    arousal: Math.round(arousalScore * 100) / 100,
    intensity,
    openness,
    ppr_hint,
    boundary_risk,
    strategy,
    confidence: Math.round(confidence * 100) / 100,
    evidence: unique(evidence),
    observations,
    epistemic_mode: 'inference',
    source_refs: messageId ? [{ type: 'user_message', id: messageId }] : [],
    relationship_cues: relationshipCues,
    created_at: new Date().toISOString(),
  };
}

export function saveRelationalTurnSignal(userId, messageId, signal) {
  if (!userId || !messageId || !signal) return null;
  const id = uuid();
  const now = signal.created_at || new Date().toISOString();
  db.prepare(`
    INSERT INTO relational_turn_signals
      (id, user_id, message_id, valence, intensity, openness, ppr_hint, boundary_risk, strategy, confidence, evidence, signal_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId,
    messageId,
    signal.valence,
    signal.intensity,
    signal.openness,
    signal.ppr_hint,
    signal.boundary_risk,
    signal.strategy,
    signal.confidence,
    JSON.stringify(signal.evidence || []),
    JSON.stringify(signal),
    now,
  );
  return id;
}

export function buildAffectiveSignalPromptBlock(signal, lang = 'zh') {
  if (!signal) return '';
  const line = [
    `valence=${signal.valence}`,
    `intensity=${signal.intensity}`,
    `openness=${signal.openness}`,
    `ppr_hint=${signal.ppr_hint}`,
    `boundary_risk=${signal.boundary_risk}`,
    `strategy=${signal.strategy}`,
    `confidence=${signal.confidence}`,
  ].join('; ');

  if (lang === 'en') {
    return `RELATIONAL SIGNALS (private hypotheses; not facts or a diagnosis):
${line}
These signals are inferred from observable text features and may be wrong. Use them only to choose timing and intensity. Do not state them as facts. If boundary_risk is mild/strong, lower recognition intensity and avoid over-reading.`;
  }

  return `RELATIONAL SIGNALS (private hypotheses; not facts or a diagnosis):
${line}
These signals are inferred from observable text features and may be wrong. Use them only to choose timing and intensity. Do not state them as facts. If boundary_risk is mild/strong, lower recognition intensity and avoid over-reading.`;
}
