import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { synthesizeSpeech, synthesizeSpeechWithTimestamps } from './elevenlabs.js';
import { textForSpeech } from './text.js';
import { registerMediaAsset } from './mediaAssets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TTS_DIR = path.join(__dirname, '../../public/uploads/tts');
fs.mkdirSync(TTS_DIR, { recursive: true });

function detectTtsLang(text) {
  const t = String(text || '').replace(/\s+/g, '');
  if (!t) return 'zh';
  const ascii = (t.match(/[\x00-\x7F]/g) || []).length;
  return ascii / t.length > 0.85 ? 'en' : 'zh';
}

function estimateMp3DurationSec(buffer) {
  return Math.max(1, Math.round((buffer?.length || 0) / 16000 * 10) / 10);
}

export async function generateTTS(text, lang = 'en', voiceId, voiceSettings = {}, userId = null) {
  const speakText = textForSpeech(text);
  if (!speakText || speakText.length < 2 || !voiceId) return null;
  const useLang = lang === 'zh' ? 'zh' : 'en';
  const audio = await synthesizeSpeech(voiceId, speakText.slice(0, 2000), useLang, voiceSettings);
  const filename = `${uuid()}.mp3`;
  fs.writeFileSync(path.join(TTS_DIR, filename), audio);
  const url = `/uploads/tts/${filename}`;
  if (userId) registerMediaAsset(userId, url, { purpose: 'tts', mime: 'audio/mpeg', bytes: audio.length, retentionDays: 7 });
  return {
    url,
    duration: estimateMp3DurationSec(audio),
    lang: useLang,
  };
}

const VISEME_SEQUENCE = ['a', 'i', 'u', 'e', 'o'];
const CJK_RE = /[\u3400-\u9FFF]/;

function visemeForToken(token, index) {
  const t = String(token || '').toLowerCase();
  if (/[aāáǎà]/.test(t)) return 'a';
  if (/[eēéěè]/.test(t)) return 'e';
  if (/[iīíǐìy]/.test(t)) return 'i';
  if (/[oōóǒò]/.test(t)) return 'o';
  if (/[uūúǔùüǖǘǚǜw]/.test(t)) return 'u';
  if (CJK_RE.test(t)) return VISEME_SEQUENCE[index % VISEME_SEQUENCE.length];
  return VISEME_SEQUENCE[index % VISEME_SEQUENCE.length];
}

function tokenizeForVisemes(text) {
  return String(text || '')
    .replace(/[，。！？、,.!?;；:：]/g, ' $& ')
    .split(/\s+/)
    .flatMap((part) => {
      if (!part) return [];
      if (/^[，。！？、,.!?;；:：]$/.test(part)) return [{ token: part, pause: true }];
      if ([...part].some((ch) => CJK_RE.test(ch))) {
        return [...part].map((ch) => ({ token: ch, pause: false }));
      }
      return part.split(/(?=[aeiouy])/i).filter(Boolean).map((token) => ({ token, pause: false }));
    });
}

export function buildVisemeTimeline(text, duration = 1) {
  const tokens = tokenizeForVisemes(text);
  if (!tokens.length) return [];
  const weights = tokens.map((item) => (item.pause ? 0.55 : 1));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  let cursor = 0;
  let syllableIndex = 0;
  const timeline = [];
  tokens.forEach((item, index) => {
    const span = Math.max(0.04, (Number(duration) || 1) * weights[index] / totalWeight);
    const start = cursor;
    const end = Math.min(Number(duration) || 1, cursor + span);
    cursor = end;
    if (item.pause) {
      timeline.push({ start, end, viseme: 'closed', value: 0 });
      return;
    }
    const viseme = visemeForToken(item.token, syllableIndex);
    syllableIndex += 1;
    timeline.push({ start, end, viseme, value: viseme === 'u' || viseme === 'o' ? 0.72 : 0.92 });
  });
  return timeline;
}

function visemesFromCharacterAlignment(alignment) {
  const chars = alignment?.characters || [];
  const starts = alignment?.character_start_times_seconds || [];
  const ends = alignment?.character_end_times_seconds || [];
  const timeline = [];
  let spokenIndex = 0;
  for (let index = 0; index < chars.length; index += 1) {
    const token = chars[index];
    const start = Number(starts[index]);
    const end = Number(ends[index]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    if (/\s|[，。！？、,.!?;；:：]/.test(token)) {
      timeline.push({ start, end, viseme: 'closed', value: 0 });
      continue;
    }
    const viseme = visemeForToken(token, spokenIndex);
    spokenIndex += 1;
    timeline.push({ start, end, viseme, value: viseme === 'u' || viseme === 'o' ? 0.72 : 0.92 });
  }
  return timeline;
}

export async function generateTTSWithTimeline(text, lang = 'en', voiceId, voiceSettings = {}, userId = null) {
  const speakText = textForSpeech(text);
  if (!speakText || speakText.length < 2 || !voiceId) return null;
  const useLang = lang === 'zh' ? 'zh' : 'en';
  try {
    const timed = await synthesizeSpeechWithTimestamps(voiceId, speakText.slice(0, 2000), useLang, voiceSettings);
    const filename = `${uuid()}.mp3`;
    fs.writeFileSync(path.join(TTS_DIR, filename), timed.audio);
    const url = `/uploads/tts/${filename}`;
    if (userId) registerMediaAsset(userId, url, { purpose: 'tts_aligned', mime: 'audio/mpeg', bytes: timed.audio.length, retentionDays: 7 });
    const ends = timed.alignment?.character_end_times_seconds || [];
    const duration = Number(ends[ends.length - 1]) || estimateMp3DurationSec(timed.audio);
    return {
      url,
      duration,
      lang: useLang,
      alignment: {
        type: 'viseme-timeline',
        method: 'elevenlabs-character-timestamps',
        visemes: visemesFromCharacterAlignment(timed.alignment),
      },
    };
  } catch (error) {
    console.warn('[tts-alignment] falling back to estimated timeline:', error.message);
    const result = await generateTTS(text, useLang, voiceId, voiceSettings, userId);
    if (!result) return null;
    return {
      ...result,
      alignment: {
        type: 'viseme-timeline',
        method: 'text-duration-estimate-fallback',
        visemes: buildVisemeTimeline(speakText, result.duration),
      },
    };
  }
}
