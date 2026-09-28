import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ALIYUN_API_KEY, PUBLIC_BASE_URL } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '../../public/uploads');
const VOICE_DIR = path.join(UPLOAD_DIR, 'voice');

function mimeToDataType(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('webm')) return 'audio/webm';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'audio/mp4';
  if (m.includes('ogg')) return 'audio/ogg';
  if (m.includes('wav')) return 'audio/wav';
  return 'audio/mpeg';
}

export function normalizeTranscriptLanguage(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  if (cjk === 0 || latin === 0) return t;
  if (cjk >= latin) {
    return t
      .replace(/[A-Za-z]+(?:[''][A-Za-z]+)?(?:[\s,.-]+[A-Za-z]+)*/g, ' ')
      .replace(/[\u3000-\u303f\uff00-\uffef]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return t
    .replace(/[\u4e00-\u9fff]+/g, ' ')
    .replace(/[\u3000-\u303f\uff00-\uffef]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function finalizeVoiceTranscript(text) {
  return normalizeTranscriptLanguage(String(text || '').trim());
}

export function getPublicAudioUrl(urlPath) {
  const p = String(urlPath || '');
  if (p.startsWith('http')) return p;
  const base = PUBLIC_BASE_URL.replace(/\/$/, '');
  return base + (p.startsWith('/') ? p : `/${p}`);
}

async function aliyunQwenASRData(audioData) {
  if (!ALIYUN_API_KEY || !audioData) return '';
  const baseUrl = process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ALIYUN_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen3-asr-flash',
        messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: audioData } }] }],
        stream: false,
        asr_options: { enable_itn: false },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return '';
    return finalizeVoiceTranscript(String(data?.choices?.[0]?.message?.content || '').trim());
  } catch {
    return '';
  }
}

export async function transcribeAudioBuffer(buffer, mime) {
  if (!buffer?.length) return '';
  const fmt = mimeToDataType(mime);
  const dataUri = `data:${fmt};base64,${buffer.toString('base64')}`;
  return aliyunQwenASRData(dataUri);
}

function resolveLocalAudioPath(urlPath) {
  const url = String(urlPath || '').trim();
  if (!url) return null;
  const rel = url
    .replace(/^\/uploads\/voice\//, '')
    .replace(/^\/uploads\//, '')
    .replace(/^\/audio\//, '')
    .replace(/^\//, '');
  const candidates = [
    path.join(VOICE_DIR, rel),
    path.join(UPLOAD_DIR, rel),
    path.join(UPLOAD_DIR, 'voice', rel),
  ];
  return candidates.find((fp) => fp && fs.existsSync(fp)) || null;
}

export async function transcribeAudioFileByUrl(urlPath) {
  const local = resolveLocalAudioPath(urlPath);
  if (local) {
    const buf = fs.readFileSync(local);
    const ext = path.extname(local).toLowerCase();
    const mime = ext === '.m4a' || ext === '.mp4' ? 'audio/mp4'
      : ext === '.ogg' ? 'audio/ogg'
        : ext === '.wav' ? 'audio/wav'
          : ext === '.mp3' ? 'audio/mpeg'
            : 'audio/webm';
    const text = await transcribeAudioBuffer(buf, mime);
    if (text) return text;
  }
  return aliyunQwenASRData(getPublicAudioUrl(urlPath));
}
