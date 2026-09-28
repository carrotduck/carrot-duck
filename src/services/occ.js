import { v4 as uuid } from 'uuid';
import { db, getUser } from '../db.js';
import { callDeepSeek } from './deepseek.js';

const DEFAULT_BIG_FIVE = { O: 50, C: 50, E: 50, A: 50, N: 50 };

const HEAVY_NEGATIVE = /难过|伤心|崩溃|害怕|焦虑|绝望|分手|去世|死|自杀|孤独|无助|委屈|讨厌自己|撑不住|好累|好累啊|不想活|抑郁/i;
const HEAVY_POSITIVE = /开心|高兴|太好了|哈哈|喜欢|爱|感动|谢谢|棒|顺利|放松/i;
const UNSETTLING = /你怎么知道|别说了|不想聊|算了|随便|无所谓|烦|滚/i;
const NOVEL = /第一次|从没|奇怪|为什么|什么意思|你是谁|你是什么/i;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

export function applyBigFiveModifiers(appraisal, bigFive = {}) {
  const bf = { ...DEFAULT_BIG_FIVE, ...bigFive };
  const next = { ...appraisal };

  if (next.arousal > 4) {
    next.arousal += (bf.E - 50) / 25;
  }
  if (next.valence < 0) {
    next.valence -= (bf.N - 50) / 20;
  }
  const N = bf.N;
  next.safety += (bf.A - 50) / 15;

  return {
    novelty: round1(clamp(next.novelty, 0, 10)),
    safety: round1(clamp(next.safety, 0, 10)),
    valence: round1(clamp(next.valence, -5, 5)),
    arousal: round1(clamp(next.arousal, 0, 10)),
  };
}

export function mapEmotionLabel(valence, arousal, novelty = 5) {
  if (valence >= 2 && arousal >= 6) return 'joy';
  if (valence <= -2 && arousal >= 6) return 'anxious';
  if (valence >= 2 && arousal < 4) return 'quietly pleased';
  if (valence <= -2 && arousal < 4) return 'low';
  if (novelty >= 7 && arousal >= 4) return 'curious';
  if (arousal >= 7) return 'alert';
  if (arousal >= 5) return 'attentive';
  return 'calm';
}

const LABEL_ZH = {
  calm: '平静',
  curious: '好奇',
  'quietly pleased': '暗自愉快',
  joy: '喜悦',
  anxious: '不安',
  low: '低落',
  alert: '警觉',
  attentive: '专注',
};

const LABEL_EN = {
  calm: 'calm',
  curious: 'curious',
  'quietly pleased': 'quietly pleased',
  joy: 'joy',
  anxious: 'uneasy',
  low: 'low',
  alert: 'alert',
  attentive: 'attentive',
};

function blendAppraisal(prior, fresh, weight = 0.55) {
  if (!prior?.appraisal) return fresh;
  const w = weight;
  return {
    novelty: round1(prior.appraisal.novelty * (1 - w) + fresh.novelty * w),
    safety: round1(prior.appraisal.safety * (1 - w) + fresh.safety * w),
    valence: round1(prior.appraisal.valence * (1 - w) + fresh.valence * w),
    arousal: round1(prior.appraisal.arousal * (1 - w) + fresh.arousal * w),
  };
}

export function heuristicAppraise(userText, priorState = null) {
  const text = String(userText || '').trim();
  let novelty = 4;
  let safety = 6;
  let valence = 0;
  let arousal = 3;

  const len = text.length;
  if (len > 300) arousal += 2;
  else if (len > 120) arousal += 1;
  if (len < 8) arousal -= 1;

  if (HEAVY_NEGATIVE.test(text)) {
    valence -= 3;
    arousal += 2;
    safety -= 1;
  }
  if (HEAVY_POSITIVE.test(text)) {
    valence += 2;
    arousal += 1;
    safety += 1;
  }
  if (UNSETTLING.test(text)) {
    valence -= 1;
    safety -= 2;
    arousal += 1;
  }
  if (NOVEL.test(text)) novelty += 3;
  if (/[?？]/.test(text)) novelty += 1;
  if (/！{2,}|!{2,}/.test(text)) arousal += 2;

  const fresh = { novelty, safety, valence, arousal };
  return blendAppraisal(priorState, fresh);
}

export function buildEmotionState(user, userText, priorState = null) {
  const raw = heuristicAppraise(userText, priorState);
  const appraisal = applyBigFiveModifiers(raw, user.big_five);
  const emotion_label = mapEmotionLabel(appraisal.valence, appraisal.arousal, appraisal.novelty);
  const lang = user.ui_lang === 'en' ? 'en' : 'zh';
  return {
    appraisal,
    emotion_label,
    arousal: appraisal.arousal,
    valence: appraisal.valence,
    narrative: renderEmotionNarrative({ appraisal, emotion_label }, lang),
    updated_at: new Date().toISOString(),
  };
}

export function renderEmotionNarrative(state, lang = 'zh') {
  const { appraisal, emotion_label } = state || {};
  if (!appraisal) return lang === 'en' ? '[Right now: calm, nothing particular.]' : '[此刻状态：平静，没有什么特别的事发生]';

  const { valence, arousal, novelty, safety } = appraisal;

  if (lang === 'en') {
    if (valence <= -2 && arousal >= 5) return '[Right now: that last line landed — noticing it, not saying much about it.]';
    if (valence <= -2) return '[Right now: a bit weighed down, keeping replies short.]';
    if (emotion_label === 'curious' || novelty >= 7) return '[Right now: curious, paying attention, still calm.]';
    if (emotion_label === 'joy') return '[Right now: lightly pleased, energy up a notch.]';
    if (arousal < 3) return '[Right now: quiet, minimal — one sentence is enough.]';
    return '[Right now: calm, nothing particular happening.]';
  }

  if (valence <= -2 && arousal >= 5) {
    return '[此刻状态：对刚才那句话有点在意，但不打算说出来]';
  }
  if (valence <= -2 && safety < 5) {
    return '[此刻状态：有点绷紧，会少说一点]';
  }
  if (valence <= -2) {
    return '[此刻状态：心情沉了一点，回复会收着]';
  }
  if (emotion_label === 'joy' || (valence >= 2 && arousal >= 6)) {
    return '[此刻状态：轻快了一点，句子可能会短而快]';
  }
  if (emotion_label === 'quietly pleased') {
    return '[此刻状态：暗自愉快，但不打算表演出来]';
  }
  if (emotion_label === 'curious' || novelty >= 7) {
    return '[此刻状态：有些好奇，平静，想多问一句]';
  }
  if (arousal < 3) {
    return '[此刻状态：很安静，一句就够]';
  }
  if (arousal >= 7) {
    return '[此刻状态：情绪上来了一点，句子会变短]';
  }
  return '[此刻状态：有些好奇，平静，没有什么特别的事发生]';
}

export function buildEmotionGuidanceBlock(state, lang = 'zh') {
  if (!state?.appraisal) return '';
  const label = lang === 'en' ? (LABEL_EN[state.emotion_label] || state.emotion_label) : (LABEL_ZH[state.emotion_label] || state.emotion_label);
  const enLabel = LABEL_EN[state.emotion_label] || state.emotion_label;
  const { valence, arousal } = state.appraisal;

  const rules = [];
  if (arousal > 7) rules.push('If arousal > 7: shorter sentences, may send follow-up');
  if (arousal < 3) rules.push('If arousal < 3: minimal response, one sentence is fine');
  if (valence < -2) rules.push('If valence < -2: more reserved, less initiative');

  return `Duck's current emotional state:
${enLabel}（${label}）
arousal: ${Math.round(arousal)}/10

${rules.join('\n')}`;
}

export function buildCompressionAnchor(user) {
  const name = user?.name || 'them';
  return `Earned, not given. Warmth with ${name} is built through accurate presence, not performance. When uncertain, compress — say less, mean it.`;
}

export function getEmotionState(user) {
  if (!user?.emotion_state) return null;
  if (typeof user.emotion_state === 'string') {
    try { return JSON.parse(user.emotion_state); } catch { return null; }
  }
  return user.emotion_state;
}

export function saveEmotionState(userId, state, messageId = null) {
  const now = state.updated_at || new Date().toISOString();
  const updated = db.prepare('UPDATE users SET emotion_state = ? WHERE id = ?').run(JSON.stringify(state), userId);
  if (!updated.changes) return false;
  db.prepare(`
    INSERT INTO emotion_logs (id, user_id, message_id, novelty, safety, valence, arousal, emotion_label, narrative, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuid(),
    userId,
    messageId,
    state.appraisal.novelty,
    state.appraisal.safety,
    state.appraisal.valence,
    state.appraisal.arousal,
    state.emotion_label,
    state.narrative,
    now,
  );
  return true;
}

export function listEmotionLogs(userId, limit = 60) {
  return db.prepare(`
    SELECT id, novelty, safety, valence, arousal, emotion_label, narrative, created_at
    FROM emotion_logs WHERE user_id = ?
    ORDER BY datetime(created_at) DESC LIMIT ?
  `).all(userId, limit).reverse();
}

export async function refineEmotionAsync(userId, userText, aiReply, draftState) {
  try {
    const user = getUser(userId);
    if (!user) return;
    const prior = draftState?.appraisal || {};
    const messages = [
      {
        role: 'system',
        content: `You appraise how ${user.ai_name || 'Duck'} would feel after this chat turn. Return ONLY JSON:
{"novelty":0-10,"safety":0-10,"valence":-5 to 5,"arousal":0-10}
novelty=how surprising the user message is; safety=felt accepted/safe; valence=pleasant vs unpleasant; arousal=intensity.`,
      },
      {
        role: 'user',
        content: `Prior: ${JSON.stringify(prior)}\nUser said: ${String(userText || '').slice(0, 800)}\nDuck replied: ${String(aiReply || '').slice(0, 400)}`,
      },
    ];
    const { text } = await callDeepSeek(messages, { maxTokens: 120, temperature: 0.2 });
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return;
    const parsed = JSON.parse(match[0]);
    const merged = applyBigFiveModifiers({
      novelty: Number(parsed.novelty),
      safety: Number(parsed.safety),
      valence: Number(parsed.valence),
      arousal: Number(parsed.arousal),
    }, user.big_five);
    const emotion_label = mapEmotionLabel(merged.valence, merged.arousal, merged.novelty);
    const lang = user.ui_lang === 'en' ? 'en' : 'zh';
    const state = {
      appraisal: merged,
      emotion_label,
      arousal: merged.arousal,
      valence: merged.valence,
      narrative: renderEmotionNarrative({ appraisal: merged, emotion_label }, lang),
      updated_at: new Date().toISOString(),
    };
    saveEmotionState(userId, state, null);
  } catch (e) {
    console.warn('[occ] refine failed', userId, e.message);
  }
}
