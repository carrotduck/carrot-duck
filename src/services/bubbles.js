/** ~one line of CJK at max bubble width (78% / 320px, 14px) */
const BUBBLE_LINE_CHARS = 22;

export function isStickerOnlyContent(text) {
  return /^\[STICKER:\s*[^\]]+\]\s*$/i.test(String(text || '').trim());
}

function splitSentences(text) {
  const s = String(text || '').trim();
  if (!s) return [];

  const parts = [];
  let start = 0;
  const re = /[。！？!?…]+[」』"'”]*|\n+/g;
  let match = re.exec(s);
  while (match) {
    const end = match.index + match[0].length;
    const chunk = s.slice(start, end).trim();
    if (chunk) parts.push(chunk);
    start = end;
    match = re.exec(s);
  }
  const tail = s.slice(start).trim();
  if (tail) parts.push(tail);
  return parts.length ? parts : [s];
}

function splitLongClause(text) {
  const s = String(text || '').trim();
  if (!s) return [];
  if (s.length <= BUBBLE_LINE_CHARS) return [s];

  const clauses = s.split(/(?<=[，,、；;])(?=[^\s])|(?<=[—–-])(?=[^\s])/);
  const out = [];
  let buffer = '';

  for (const clause of clauses) {
    const piece = clause.trim();
    if (!piece) continue;
    const candidate = buffer ? `${buffer}${piece}` : piece;
    if (candidate.length <= BUBBLE_LINE_CHARS) {
      buffer = candidate;
      continue;
    }
    if (buffer) out.push(buffer.trim());
    if (piece.length <= BUBBLE_LINE_CHARS) {
      buffer = piece;
    } else {
      out.push(piece);
      buffer = '';
    }
  }
  if (buffer.trim()) out.push(buffer.trim());
  return out.length ? out : [s];
}

function splitTextIntoBubbles(text) {
  const sentences = splitSentences(text);
  const bubbles = [];
  for (const sentence of sentences) {
    bubbles.push(...splitLongClause(sentence));
  }
  return bubbles.filter(Boolean);
}

export function splitAssistantBubbleParts(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const stickers = [];
  const re = /\[STICKER:([^\]]+)\]/gi;
  let match = re.exec(raw);
  while (match) {
    stickers.push(`[STICKER:${match[1].trim()}]`);
    match = re.exec(raw);
  }

  const textOnly = raw.replace(/\[STICKER:[^\]]+\]/gi, '').replace(/\s+/g, ' ').trim();

  if (stickers.length && !textOnly) return stickers;

  const textBubbles = textOnly ? splitTextIntoBubbles(textOnly) : [];

  if (stickers.length && textBubbles.length) {
    return [...stickers, ...textBubbles];
  }
  if (stickers.length === 1) return [stickers[0]];
  if (textBubbles.length) return textBubbles;
  return [raw];
}
