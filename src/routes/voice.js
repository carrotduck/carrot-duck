import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { getUser } from '../db.js';
import { resolveVoiceId } from '../services/personality.js';
import { synthesizeSpeech } from '../services/elevenlabs.js';
import { transcribeAudioBuffer } from '../services/asr.js';
import { textForSpeech } from '../services/text.js';
import { englishSpokenLineForVoice } from '../services/voice.js';
import { isSupportedAudio, mediaFileFilter } from '../utils/uploadValidation.js';
import { registerMediaAsset } from '../services/mediaAssets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '../../public/uploads');
const VOICE_DIR = path.join(UPLOAD_DIR, 'voice');
fs.mkdirSync(VOICE_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: mediaFileFilter('audio'),
});
const router = Router();

function estimateDurationSec(buffer, hintSec) {
  const hint = parseFloat(hintSec);
  if (hint > 0 && isFinite(hint)) return Math.max(1, Math.round(hint * 10) / 10);
  return Math.max(1, Math.round((buffer?.length || 0) / 12000 * 10) / 10);
}

function saveVoiceBuffer(buffer, mime, durationHint, userId) {
  const ext = String(mime || '').includes('mp4') ? 'm4a' : 'webm';
  const filename = `${uuid()}.${ext}`;
  fs.writeFileSync(path.join(VOICE_DIR, filename), buffer);
  const url = `/uploads/voice/${filename}`;
  registerMediaAsset(userId, url, { purpose: 'user_voice', mime, bytes: buffer.length, retentionDays: 365 });
  return {
    url,
    duration: estimateDurationSec(buffer, durationHint),
  };
}

router.post('/:userId/upload', upload.single('audio'), async (req, res) => {
  try {
    const user = getUser(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!req.file?.buffer?.length) return res.status(400).json({ error: 'no audio' });
    if (!isSupportedAudio(req.file.buffer)) return res.status(415).json({ error: 'unsupported audio data' });
    const saved = saveVoiceBuffer(req.file.buffer, req.file.mimetype, req.body?.duration, user.id);
    res.json({ ...saved, text: '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:userId/tts', async (req, res) => {
  try {
    const user = getUser(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { text } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: 'text required' });
    const speak = await englishSpokenLineForVoice(text.trim(), user.ai_name || 'Duck');
    const audio = await synthesizeSpeech(resolveVoiceId(user), speak || textForSpeech(text.trim()), 'en');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audio);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:userId/asr', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file?.buffer?.length) return res.status(400).json({ error: 'no audio' });
    if (!isSupportedAudio(req.file.buffer)) return res.status(415).json({ error: 'unsupported audio data' });
    const text = await transcribeAudioBuffer(req.file.buffer, req.file.mimetype || 'audio/webm');
    res.json({ text: text || '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
