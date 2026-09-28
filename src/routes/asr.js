import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { transcribeAudioBuffer, transcribeAudioFileByUrl } from '../services/asr.js';
import { isSupportedAudio, mediaFileFilter } from '../utils/uploadValidation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '../../public/uploads');
const VOICE_DIR = path.join(UPLOAD_DIR, 'voice');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: mediaFileFilter('audio'),
});
const router = Router();

function resolveLocalAudioPath(urlPath) {
  const url = String(urlPath || '').trim();
  if (!url || /^https?:\/\//i.test(url) || url.includes('\0')) return null;
  const rel = url
    .replace(/^\/uploads\/voice\//, '')
    .replace(/^\/uploads\//, '')
    .replace(/^\/audio\//, '')
    .replace(/^\//, '');
  if (!rel || rel !== path.basename(rel) || !/^[A-Za-z0-9._-]+$/.test(rel)) return null;
  const roots = [VOICE_DIR, UPLOAD_DIR];
  const candidates = [
    path.resolve(VOICE_DIR, rel),
    path.resolve(UPLOAD_DIR, rel),
  ];
  return candidates.find((fp) => roots.some((root) => fp.startsWith(`${path.resolve(root)}${path.sep}`)) && fs.existsSync(fp)) || null;
}

async function handleTranscribe(req, res) {
  if (!req.file?.buffer?.length) return res.status(400).json({ error: 'no audio' });
  if (!isSupportedAudio(req.file.buffer)) return res.status(415).json({ error: 'unsupported audio data' });
  try {
    const mime = req.file.mimetype || 'audio/webm';
    const text = await transcribeAudioBuffer(req.file.buffer, mime);
    if (!text) return res.status(500).json({ error: 'asr failed' });
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: 'asr failed', detail: e.message });
  }
}

router.post('/transcribe', upload.single('audio'), handleTranscribe);
router.post('/', upload.single('audio'), handleTranscribe);

router.post('/transcribe-url', async (req, res) => {
  try {
    const url = String(req.body?.url || '').trim();
    if (!url) return res.status(400).json({ error: 'no url' });
    const fp = resolveLocalAudioPath(url);
    if (!fp) return res.status(404).json({ error: 'file not found', url });
    const text = await transcribeAudioFileByUrl(url);
    if (!text) {
      const st = fs.statSync(fp);
      return res.status(500).json({
        error: 'asr failed',
        detail: 'aliyun qwen3-asr-flash could not transcribe audio',
        fileSize: st.size,
        ext: path.extname(fp),
      });
    }
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: 'asr failed', detail: e.message });
  }
});

export default router;
