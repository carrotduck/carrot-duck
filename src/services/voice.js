import { getRelationshipStageLabel, resolveVoiceId } from './personality.js';
import { callDeepSeek } from './deepseek.js';
import { textForSpeech } from './text.js';
import { generateTTS } from './tts.js';

const STAGE_VOICE_RATES = {
  STRANGER: 0.05,
  ACQUAINTANCE: 0.15,
  KNOWN: 0.25,
};

const turnsSinceVoiceByUser = new Map();

export function getRelationshipVoiceStage(user) {
  return getRelationshipStageLabel(user);
}

export function buildVoicePersonalityHint(user, stage) {
  const k = user?.keywords || {};
  const lines = [];
  if (k.expression === 'subtle') {
    lines.push('- Reserved/subtle expression: your voice chance is halved — use [VOICE] sparingly.');
  }
  if (k.expression === 'direct') {
    lines.push('- Direct expression: normal voice rates apply.');
  }
  if (k.energy === 'steady') {
    lines.push(`- Steady temperament: you only initiate voice at KNOWN stage (current: ${stage}). User-requested voice is always honored.`);
  }
  return lines.length ? lines.join('\n') : '- Personality: normal voice rates apply.';
}

export function buildVoiceResponsePromptBlock(user) {
  const stage = getRelationshipVoiceStage(user);
  const name = user?.name || 'the user';
  const personalityHint = buildVoicePersonalityHint(user, stage);

  return `───────────────────────────────
VOICE RESPONSE
───────────────────────────────
You can choose to respond with a voice message instead of text. Use this sparingly.

Send voice when:
- The moment feels quiet and the user seems relaxed
- One sentence is all that needs to be said
- Text would feel too formal for what you want to say

Current relationship stage: ${stage}
Base chance if you tag [VOICE] (backend rolls):
- STRANGER: 5%
- ACQUAINTANCE: 15%
- KNOWN: 25%

${personalityHint}

To send voice, end your response with [VOICE]. Backend converts to English TTS automatically.
Do NOT use [VOICE] for long replies. Max 2 sentences when using [VOICE].
Never say you cannot send voice. When ${name} asks for voice, reply briefly (1-2 sentences) and add [VOICE].`;
}

export function userRequestedVoice(text) {
  const t = String(text || '').replace(/\[STICKER:[^\]]+\]/gi, '').trim();
  return /(?:再说|多说|说两句|说给我|说句话|讲讲|念给|读给|用声音|发语音|发一条语音|语音给我|可以用语音|能发语音|说话|开口|one more|speak|say more|say something|talk to me|voice message|read it|say it)/i.test(t);
}

export function voiceEligibleText(text) {
  const t = textForSpeech(text);
  if (!t || t.length < 2) return false;
  if (t.length > 200) return false;
  const sentences = t.split(/[。！？.!?]+/).map((s) => s.trim()).filter(Boolean);
  return sentences.length <= 2;
}

export function voiceProbability(user, stage) {
  let rate = STAGE_VOICE_RATES[stage] ?? STAGE_VOICE_RATES.ACQUAINTANCE;
  if (user?.keywords?.expression === 'subtle') rate *= 0.5;
  return rate;
}

export function shouldSendVoice(user, speakText, lastUserText, opts = {}) {
  const voiceCtx = opts.voiceCtx;
  const userPlain = voiceCtx?.userTextOnly || lastUserText || '';
  const requested = opts.userRequestedVoice || userRequestedVoice(userPlain);

  if (requested) return true;

  if (!opts.voiceTagged) return false;
  if (!voiceEligibleText(speakText)) return false;

  const stage = opts.relationshipStage || getRelationshipVoiceStage(user);
  const k = user?.keywords || {};

  if (k.energy === 'steady' && stage !== 'KNOWN') return false;

  let rate = voiceProbability(user, stage);
  const turns = (turnsSinceVoiceByUser.get(user?.id) || 999) + 1;
  if (turns <= (stage === 'STRANGER' ? 5 : 3)) rate *= 0.5;
  if (opts.source === 'keepalive') rate *= 0.6;

  return Math.random() < rate;
}

export function markVoiceSent(userId) {
  turnsSinceVoiceByUser.set(userId, 0);
}

function isEnglishText(text) {
  const t = String(text || '').replace(/\s+/g, '');
  if (!t) return false;
  return (t.match(/[a-zA-Z]/g) || []).length / t.length > 0.3;
}

export function rewriteVoiceDenialReply(text, userText) {
  const t = String(text || '').trim();
  if (!t) return t;
  const denies = /(?:没法|不能|没办法|不可以|无法).{0,12}发语音|说过了.{0,24}语音|没有语音|找借口|can't send voice|cannot send voice|no voice|text-only/i.test(t);
  if (!denies) return t;
  if (/晚安|睡了|睡觉|good\s*night/i.test(String(userText || ''))) return '好，睡吧。';
  return '好。';
}

export async function spokenLineForVoice(fullText, user, userText = '') {
  return englishSpokenLineForVoice(fullText, user?.ai_name || 'Duck', userText);
}

function hasCjk(text) {
  return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(String(text || ''));
}

function englishFallbackForVoice(userText = '', assistantText = '') {
  const hay = `${userText}\n${assistantText}`.toLowerCase();
  if (/晚安|睡了|睡觉|good\s*night|nighty/.test(hay)) return 'Sleep well.';
  if (/早安|早上|good\s*morning/.test(hay)) return 'Morning.';
  if (/发语音|语音|speak|voice message/.test(hay)) return 'Yeah.';
  if (/谢谢|thanks/.test(hay)) return 'Sure.';
  return 'Mm.';
}

function forceEnglishSpokenLine(line, userText = '', assistantText = '') {
  const cleaned = String(line || '').trim().replace(/^["']|["']$/g, '');
  if (cleaned && !hasCjk(cleaned) && /[a-zA-Z]/.test(cleaned)) return cleaned.slice(0, 800);
  return englishFallbackForVoice(userText, assistantText);
}

export async function englishSpokenLineForVoice(fullText, aiName = 'Duck', userText = '') {
  const speakText = textForSpeech(fullText);
  if (!speakText) return englishFallbackForVoice(userText, speakText);

  if (isEnglishText(speakText) && !hasCjk(speakText)) {
    return speakText.slice(0, 800);
  }

  const { text } = await callDeepSeek([
    {
      role: 'system',
      content: `You are ${aiName}. Convert the reply into ONE short natural English line for a voice message.
CRITICAL: English only. Zero Chinese/CJK characters. No quotes. Brief, restrained, not performative.
Output only the spoken English line.`,
    },
    { role: 'user', content: speakText.slice(0, 600) },
  ], { maxTokens: 60, temperature: 0.25 });

  return forceEnglishSpokenLine(text, userText, speakText);
}

export async function emitVoiceBubbleIfNeeded(user, fullText, lastUserText, recentChat, opts = {}) {
  try {
    const speakText = textForSpeech(fullText);
    if (!speakText || speakText.length < 2) return null;
    const voiceId = resolveVoiceId(user);
    if (!voiceId) return null;

    const voiceCtx = opts.voiceCtx;
    const relationshipStage = opts.relationshipStage || getRelationshipVoiceStage(user);
    const userRequested = opts.userRequestedVoice ?? userRequestedVoice(voiceCtx?.userTextOnly || lastUserText);

    const shouldSend = opts.voiceSendDecisionPromise
      ? await opts.voiceSendDecisionPromise
      : shouldSendVoice(user, speakText, lastUserText, {
        ...opts,
        voiceCtx,
        relationshipStage,
        userRequestedVoice: userRequested,
      });

    if (!shouldSend) return null;

    const spokenLine = await spokenLineForVoice(fullText, user, lastUserText);
    const englishLine = forceEnglishSpokenLine(spokenLine, lastUserText, speakText);
    if (!englishLine || englishLine.length < 2) return null;

    const ttsResult = await generateTTS(englishLine, 'en', voiceId, {}, user.id);
    if (!ttsResult) return null;

    markVoiceSent(user.id);
    return {
      url: ttsResult.url,
      duration: ttsResult.duration,
      text: englishLine,
      lang: 'en',
    };
  } catch {
    return null;
  }
}

// Keepalive / sticker context helper (optional metadata for prompts)
export function detectVoiceTurnContext(lastUserText, recentChat) {
  const last = String(lastUserText || '').trim();
  const userTextOnly = last.replace(/\[STICKER:[^\]]+\]/gi, '').replace(/\[IMAGE\][^\n]*/gi, '').trim();
  return { userTextOnly };
}
