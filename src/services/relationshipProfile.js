import { v4 as uuid } from 'uuid';
import { db, getUser } from '../db.js';
import { computeDepthScore, getRelationshipStageLabel } from './personality.js';

const DIRECTIONS = ['FRIEND', 'FAMILY_LIKE', 'ROMANTIC', 'COUPLE', 'COMPANION'];
const SCORE_COLUMNS = {
  FRIEND: 'friendship',
  FAMILY_LIKE: 'family_like',
  ROMANTIC: 'romantic',
  COUPLE: 'couple',
  COMPANION: 'companion',
};

const CUE_RULES = [
  { direction: 'COUPLE', weight: 20, label: 'explicit_partner_term', re: /(?:你是|当|做)(?:我)?(?:的)?(?:老公|老婆|男朋友|女朋友|对象|伴侣)|我们(?:正式)?在一起|my (?:boyfriend|girlfriend|partner)|be my (?:boyfriend|girlfriend|partner)/i },
  { direction: 'ROMANTIC', weight: 13, label: 'explicit_romantic', re: /我(?:真的)?(?:喜欢|爱)你|对你心动|想和你恋爱|和你约会|暧昧|fall(?:ing)? in love with you|i love you|i like you romantically/i },
  { direction: 'FAMILY_LIKE', weight: 14, label: 'family_like', re: /把你当(?:成)?家人|你像(?:我)?家人|家人一样|像我(?:姐姐|哥哥|妹妹|弟弟)|chosen family/i },
  { direction: 'FRIEND', weight: 12, label: 'friendship', re: /把你当(?:成)?(?:最好的?|很好的?)?朋友|你是我(?:最好的?)?朋友|闺蜜|兄弟|好朋友|best friend|bestie|my friend/i },
  { direction: 'COMPANION', weight: 8, label: 'companionship', re: /你是我的搭子|长期搭档|生活搭子|学习搭子|工作搭子|伙伴|companion|teammate/i },
  { direction: 'ROMANTIC', weight: -16, label: 'romantic_boundary', re: /只是朋友|别暧昧|不想恋爱|不是对象|不要当我(?:男朋友|女朋友|老公|老婆)|friends only|not romantic/i },
  { direction: 'COUPLE', weight: -20, label: 'couple_boundary', re: /不是(?:情侣|对象|伴侣)|别叫我(?:老婆|老公|女朋友|男朋友)|not (?:a )?(?:couple|partner)/i },
  { direction: 'FAMILY_LIKE', weight: -14, label: 'family_boundary', re: /别把我当家人|不是家人|not family/i },
];

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

export function detectRelationshipCues(text) {
  const value = String(text || '').trim();
  if (!value) return [];
  return CUE_RULES
    .filter((rule) => rule.re.test(value))
    .map(({ direction, weight, label }) => ({ direction, weight, label }));
}

function pickDirection(scores) {
  const ranked = DIRECTIONS
    .map((direction) => ({ direction, score: scores[direction] || 0 }))
    .sort((a, b) => b.score - a.score);
  const first = ranked[0];
  const second = ranked[1];
  const margin = first.score - second.score;
  const threshold = first.direction === 'COUPLE' ? 30 : 18;
  if (first.score < threshold || margin < 4) {
    return { primary: 'UNDEFINED', confidence: clamp(first.score / 100, 0, 0.45) };
  }
  const confidence = clamp(0.35 + first.score / 140 + margin / 160, 0.35, 0.95);
  return { primary: first.direction, confidence: Math.round(confidence * 100) / 100 };
}

function rowToProfile(row, user) {
  const familiarityScore = computeDepthScore(row?.user_id || user?.id, db, user);
  const familiarityStage = getRelationshipStageLabel(user, db);
  const scores = {
    FRIEND: clamp(row?.friendship),
    FAMILY_LIKE: clamp(row?.family_like),
    ROMANTIC: clamp(row?.romantic),
    COUPLE: clamp(row?.couple),
    COMPANION: clamp(row?.companion),
  };
  const selected = pickDirection(scores);
  return {
    schema: 'carrot_duck_relationship_profile_v2',
    user_id: user?.id || row?.user_id,
    familiarity_score: familiarityScore,
    familiarity_stage: familiarityStage,
    primary_direction: selected.primary,
    direction_confidence: selected.confidence,
    direction_scores: scores,
    evidence: parseJson(row?.evidence_json, []),
    updated_at: row?.updated_at || null,
  };
}

function persistProfile(profile) {
  db.prepare(`
    INSERT INTO relationship_profiles (
      user_id, familiarity_score, familiarity_stage,
      friendship, family_like, romantic, couple, companion,
      primary_direction, direction_confidence, evidence_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      familiarity_score = excluded.familiarity_score,
      familiarity_stage = excluded.familiarity_stage,
      friendship = excluded.friendship,
      family_like = excluded.family_like,
      romantic = excluded.romantic,
      couple = excluded.couple,
      companion = excluded.companion,
      primary_direction = excluded.primary_direction,
      direction_confidence = excluded.direction_confidence,
      evidence_json = excluded.evidence_json,
      updated_at = excluded.updated_at
  `).run(
    profile.user_id,
    profile.familiarity_score,
    profile.familiarity_stage,
    profile.direction_scores.FRIEND,
    profile.direction_scores.FAMILY_LIKE,
    profile.direction_scores.ROMANTIC,
    profile.direction_scores.COUPLE,
    profile.direction_scores.COMPANION,
    profile.primary_direction,
    profile.direction_confidence,
    JSON.stringify(profile.evidence || []),
    profile.updated_at || new Date().toISOString(),
  );
}

export function getRelationshipProfile(userId, suppliedUser = null) {
  const user = suppliedUser || getUser(userId);
  if (!user) return null;
  const row = db.prepare('SELECT * FROM relationship_profiles WHERE user_id = ?').get(user.id);
  const profile = rowToProfile(row || { user_id: user.id }, user);
  profile.updated_at = row?.updated_at || new Date().toISOString();
  persistProfile(profile);
  return profile;
}

export function updateRelationshipProfile(userId, messageId, text, signal = null) {
  const user = getUser(userId);
  if (!user) return null;
  const row = db.prepare('SELECT * FROM relationship_profiles WHERE user_id = ?').get(user.id);
  const current = rowToProfile(row || { user_id: user.id }, user);
  const scores = { ...current.direction_scores };
  const cues = signal?.relationship_cues || detectRelationshipCues(text);
  const now = new Date().toISOString();
  const evidence = [...(current.evidence || [])];

  for (const cue of cues) {
    const boundaryFactor = signal?.boundary_risk === 'strong' && cue.weight > 0 ? 0.35 : 1;
    const delta = cue.weight * boundaryFactor;
    scores[cue.direction] = clamp((scores[cue.direction] || 0) + delta);
    if (cue.direction === 'COUPLE' && delta > 0) {
      scores.ROMANTIC = clamp(scores.ROMANTIC + delta * 0.35);
    }
    if (cue.direction === 'FRIEND' && cue.label === 'friendship' && /只是朋友|friends only/i.test(String(text || ''))) {
      scores.ROMANTIC = clamp(scores.ROMANTIC - 12);
      scores.COUPLE = clamp(scores.COUPLE - 16);
    }

    const excerpt = String(text || '').replace(/\s+/g, ' ').slice(0, 180);
    evidence.unshift({ direction: cue.direction, label: cue.label, weight: delta, excerpt, created_at: now });
    db.prepare(`
      INSERT INTO relationship_evidence (id, user_id, message_id, direction, polarity, weight, excerpt, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uuid(), user.id, messageId || null, cue.direction, delta >= 0 ? 1 : -1, Math.abs(delta), excerpt, now);
  }

  const selected = pickDirection(scores);
  const profile = {
    ...current,
    familiarity_score: computeDepthScore(user.id, db, user),
    familiarity_stage: getRelationshipStageLabel(user, db),
    primary_direction: selected.primary,
    direction_confidence: selected.confidence,
    direction_scores: scores,
    evidence: evidence.slice(0, 16),
    updated_at: now,
  };
  persistProfile(profile);
  return profile;
}

export function buildRelationshipProfilePromptBlock(profile) {
  if (!profile) return '';
  const directionGuidance = {
    UNDEFINED: 'No relationship direction is established. Do not label or escalate it.',
    FRIEND: 'The strongest explicit evidence is friendship. Keep warmth compatible with friendship and do not romanticize it.',
    FAMILY_LIKE: 'The strongest explicit evidence is family-like trust. Do not turn that into romance.',
    ROMANTIC: 'There is explicit romantic direction, but do not claim a formal couple relationship without explicit mutual evidence.',
    COUPLE: 'There is repeated explicit couple/partner evidence. Keep respecting new boundaries; the label is descriptive, never coercive.',
    COMPANION: 'The strongest evidence is companionship or partnership in daily life. Keep the role practical and earned.',
  }[profile.primary_direction] || '';

  return `RELATIONSHIP PROFILE (private, evidence-based):
familiarity_stage=${profile.familiarity_stage}; familiarity_score=${profile.familiarity_score}/200
primary_direction=${profile.primary_direction}; direction_confidence=${profile.direction_confidence}
${directionGuidance}
Never announce these internal labels or infer a relationship from pet names alone.`;
}
