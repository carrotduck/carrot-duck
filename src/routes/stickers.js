import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { getUser } from '../db.js';
import { listStickerFiles, getStickerIndex } from '../services/stickers.js';
import { describeStickerLabel } from '../services/vision.js';
import {
  insertUserSticker,
  listUserStickers,
  userStickerDir,
} from '../services/userStickers.js';
import { detectImageExtension, mediaFileFilter } from '../utils/uploadValidation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: mediaFileFilter('image'),
});
const router = Router();

function stickerExt(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('gif')) return 'gif';
  if (m.includes('webp')) return 'webp';
  return 'jpg';
}

router.get('/', (_req, res) => {
  res.json({ stickers: listStickerFiles(), index: getStickerIndex() });
});

router.get('/:userId', (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    stickers: listStickerFiles(),
    index: getStickerIndex(),
    userStickers: listUserStickers(user.id),
  });
});

router.post('/:userId/upload', upload.single('image'), async (req, res) => {
  try {
    const user = getUser(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!req.file?.buffer?.length) return res.status(400).json({ error: 'no image' });

    const detectedExt = detectImageExtension(req.file.buffer);
    if (!detectedExt) return res.status(415).json({ error: 'unsupported image data' });
    const manualLabel = String(req.body?.label || '').trim().slice(0, 80);
    let label = manualLabel;
    if (!label) {
      try {
        label = await describeStickerLabel(
          req.file.buffer.toString('base64'),
          req.file.mimetype || 'image/jpeg',
        );
      } catch {
        label = '自定义表情';
      }
    }

    const ext = detectedExt;
    const filename = `${uuid()}.${ext}`;
    const dir = userStickerDir(user.id);
    fs.writeFileSync(path.join(dir, filename), req.file.buffer);

    const saved = insertUserSticker(user.id, filename, label);
    res.json(saved);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
