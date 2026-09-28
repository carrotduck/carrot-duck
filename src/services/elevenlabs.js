import https from 'https';
import { ELEVENLABS_API_KEY } from '../config.js';

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function requestBody(text, lang, overrides = {}) {
  const useLang = lang === 'en' ? 'en' : 'zh';
  return {
    text,
    model_id: 'eleven_multilingual_v2',
    language_code: useLang,
    voice_settings: {
      stability: clamp(overrides.stability, 0, 1, useLang === 'en' ? 0.72 : 0.62),
      similarity_boost: 0.88,
      style: clamp(overrides.style, 0, 1, useLang === 'en' ? 0.05 : 0.06),
      speed: clamp(overrides.speed, 0.7, 1.2, 0.93),
    },
  };
}

function requestElevenLabs(voiceId, endpointSuffix, body, { json = false } = {}) {
  if (!ELEVENLABS_API_KEY) return Promise.reject(new Error('ELEVENLABS_API_KEY is not configured'));
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${encodeURIComponent(voiceId)}${endpointSuffix}?output_format=mp3_44100_128`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY,
        Accept: json ? 'application/json' : 'audio/mpeg',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('aborted', () => reject(new Error('ElevenLabs response aborted')));
      res.on('end', () => {
        const result = Buffer.concat(chunks);
        if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
          return reject(new Error(`ElevenLabs error ${res.statusCode || 0}: ${result.toString('utf8').slice(0, 180)}`));
        }
        if (!json) return resolve(result);
        try {
          return resolve(JSON.parse(result.toString('utf8')));
        } catch {
          return reject(new Error('ElevenLabs returned invalid timestamp JSON'));
        }
      });
    });
    req.setTimeout(60_000, () => req.destroy(new Error('ElevenLabs request timed out')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

export function synthesizeSpeech(voiceId, text, lang = 'en', voiceSettings = {}) {
  return requestElevenLabs(voiceId, '', requestBody(text, lang, voiceSettings));
}

export async function synthesizeSpeechWithTimestamps(voiceId, text, lang = 'en', voiceSettings = {}) {
  const result = await requestElevenLabs(
    voiceId,
    '/with-timestamps',
    requestBody(text, lang, voiceSettings),
    { json: true },
  );
  const audio = Buffer.from(String(result.audio_base64 || ''), 'base64');
  if (!audio.length) throw new Error('ElevenLabs timestamp response contained no audio');
  return {
    audio,
    alignment: result.normalized_alignment || result.alignment || null,
  };
}

