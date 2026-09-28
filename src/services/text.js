export function stripParentheticalActions(text) {
  return String(text || '')
    .replace(/（[^）]{1,40}）/g, '')
    .replace(/\([^)]{1,60}\)/g, '')
    .replace(/\*{0,2}动作[：:][^\n]*/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stripPprTag(text) {
  const raw = String(text || '');
  let cleaned = raw.trim();
  let voiceTagged = false;
  let tagged = false;

  while (true) {
    if (/\[VOICE\]\s*$/i.test(cleaned)) {
      voiceTagged = true;
      cleaned = cleaned.replace(/\s*\[VOICE\]\s*$/i, '').trim();
      continue;
    }
    if (/\[PPR\]\s*$/i.test(cleaned)) {
      tagged = true;
      cleaned = cleaned.replace(/\s*\[PPR\]\s*$/i, '').trim();
      continue;
    }
    break;
  }

  cleaned = stripParentheticalActions(cleaned);
  return { cleaned, tagged, voiceTagged };
}

export function processAssistantReply(text) {
  return stripPprTag(text);
}

export function textForSpeech(text) {
  return stripParentheticalActions(
    String(text || '')
      .replace(/\[STICKER:[^\]]+\]/gi, '')
      .replace(/\s*\[VOICE\]\s*$/i, '')
      .replace(/\s*\[PPR\]\s*$/i, '')
      .trim(),
  );
}
