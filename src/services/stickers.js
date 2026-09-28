import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describeUserStickerTag, getUserSticker } from './userStickers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STICKER_DIR = path.join(__dirname, '../../public/stickers');
const INDEX_PATH = path.join(__dirname, '../../data/stickers_index.json');
const EXCLUDE = new Set(['avatar.jpg']);

let stickerIndexCache = null;

function loadStickerIndex() {
  if (stickerIndexCache) return stickerIndexCache;
  try {
    if (fs.existsSync(INDEX_PATH)) {
      stickerIndexCache = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
      return stickerIndexCache;
    }
  } catch {
    stickerIndexCache = {};
  }
  stickerIndexCache = stickerIndexCache || {};
  return stickerIndexCache;
}

export function listStickerFiles() {
  try {
    if (!fs.existsSync(STICKER_DIR)) return [];
    return fs.readdirSync(STICKER_DIR)
      .filter((f) => /\.(jpg|jpeg|png|gif|webp)$/i.test(f))
      .filter((f) => !EXCLUDE.has(f.toLowerCase()))
      .slice(0, 120);
  } catch {
    return [];
  }
}

export function getStickerIndex() {
  return loadStickerIndex();
}

function stickerFileExists(file) {
  const name = normalizeStickerFile(file);
  if (!name) return false;
  return fs.existsSync(path.join(STICKER_DIR, name));
}

export function resolveStickerFile(raw) {
  const name = normalizeStickerFile(raw);
  if (!name) return null;
  if (stickerFileExists(name)) return name;

  if (!/\.(jpg|jpeg|png|gif|webp)$/i.test(name)) {
    for (const ext of ['.jpg', '.webp', '.png', '.gif', '.jpeg']) {
      const candidate = `${name}${ext}`;
      if (stickerFileExists(candidate)) return candidate;
    }
  }

  const files = listStickerFiles();
  const lower = name.toLowerCase();
  const exact = files.find((f) => f.toLowerCase() === lower);
  if (exact) return exact;

  const stem = name.replace(/\.[^.]+$/, '').toLowerCase();
  const stemMatch = files.find((f) => f.replace(/\.[^.]+$/, '').toLowerCase() === stem);
  if (stemMatch) return stemMatch;

  const index = loadStickerIndex();
  for (const [file, entry] of Object.entries(index)) {
    if (!stickerFileExists(file)) continue;
    const desc = String(entry?.desc || '').trim();
    const moods = Array.isArray(entry?.mood) ? entry.mood : [];
    if (desc && (desc === name || desc.includes(name) || name.includes(desc))) return file;
    if (moods.some((m) => m === name || name.includes(m) || m.includes(name))) return file;
    if (file.replace(/\.[^.]+$/, '').toLowerCase() === stem) return file;
  }

  return null;
}

const FALLBACK_STICKER = 'pat.jpg';

export function sanitizeStickerMarkup(text, userId = null) {
  return String(text || '').replace(/\[STICKER:([^\]]+)\]/gi, (full, tag) => {
    const raw = String(tag || '').trim();
    if (!raw) return '';
    if (/^user:/i.test(raw)) {
      const id = raw.replace(/^user:/i, '').trim();
      if (userId && id && getUserSticker(userId, id)) return full;
      const resolved = resolveStickerFile(raw.replace(/^user:/i, '')) || FALLBACK_STICKER;
      return `[STICKER:${resolved}]`;
    }
    const resolved = resolveStickerFile(raw);
    return `[STICKER:${resolved || FALLBACK_STICKER}]`;
  });
}

function normalizeStickerFile(raw) {
  const name = String(raw || '').trim();
  if (!name) return '';
  return name.includes('/') ? name.split('/').pop() : name;
}

export function describeStickerFile(filename) {
  const file = normalizeStickerFile(filename);
  if (!file) return '用户发了一个表情包';
  const index = loadStickerIndex();
  const entry = index[file] || index[file.toLowerCase()];
  if (entry) {
    const desc = entry.desc || file.replace(/\.[^.]+$/, '');
    const hint = entry.use_when || (Array.isArray(entry.mood) ? entry.mood.join('、') : '');
    if (hint) return `用户发了一个${desc}表情包（${hint}）`;
    return `用户发了一个${desc}表情包`;
  }
  const stem = file.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  return `用户发了一个表情包（${stem}）`;
}

export function describeStickerTag(tag, userId = null) {
  const raw = String(tag || '').trim();
  if (/^user:/i.test(raw)) {
    return describeUserStickerTag(userId, raw);
  }
  return describeStickerFile(raw);
}

export function stickerTextForAI(text, userId = null) {
  return String(text || '').replace(/\[STICKER:([^\]]+)\]/gi, (_, tag) => describeStickerTag(tag, userId));
}

export function getStickerIndexText() {
  const files = listStickerFiles();
  if (!files.length) return '';
  const samples = files.slice(0, 12).map((f) => {
    const index = loadStickerIndex();
    const entry = index[f];
    return entry?.desc ? `${f}=${entry.desc}` : f;
  });
  return `【表情包】想发表情包时只用 [STICKER:文件名] 格式，单独一行。必须用真实文件名（含扩展名），例如 [STICKER:pat.jpg]、[STICKER:hug.jpg]，禁止用中文描述或省略扩展名。用户自己的表情用 [STICKER:user:贴纸ID]。禁止 markdown 图片。用户发表情包时你收到的是文字描述，不是图片；禁止在回复里复述这些描述。可用：${samples.join(', ')}`;
}

export function expandStickerMarkup(text) {
  return String(text || '').replace(/\[STICKER:([^\]]+)\]/gi, (_, file) => `[STICKER:${file.trim()}]`);
}
