import { ALIYUN_API_KEY } from '../config.js';

const BASE_URL = process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const VISION_MODEL = process.env.VISION_MODEL || 'qwen-vl-max';

export async function describeImage(base64, mimeType = 'image/jpeg', hint = '') {
  if (!ALIYUN_API_KEY) {
    throw new Error('ALIYUN_API_KEY is not configured for vision');
  }
  const prompt = hint.trim()
    ? `用户附言：${hint.trim()}。请客观描述这张图片（1-3句中文），供聊天 AI 理解。`
    : '请客观描述这张图片（1-3句中文），供聊天 AI 理解。';

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ALIYUN_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          { type: 'text', text: prompt },
        ],
      }],
      max_tokens: 220,
      temperature: 0.2,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.message || `Vision API ${res.status}`);
  }
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Vision API returned empty description');
  return text;
}

export async function describeStickerLabel(base64, mimeType = 'image/jpeg', hint = '') {
  if (!ALIYUN_API_KEY) {
    return hint.trim() || '自定义表情';
  }
  const prompt = hint.trim()
    ? `用户备注：${hint.trim()}。用一句话（20字以内）概括这个表情包的情绪或含义，供聊天 AI 理解。只输出描述。`
    : '用一句话（20字以内）概括这个表情包画面的情绪或含义，供聊天 AI 理解。只输出描述，不要引号。';

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ALIYUN_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          { type: 'text', text: prompt },
        ],
      }],
      max_tokens: 80,
      temperature: 0.2,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.message || `Vision API ${res.status}`);
  }
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Vision API returned empty description');
  return text.replace(/^["'「『]|["'」』]$/g, '').slice(0, 60);
}
