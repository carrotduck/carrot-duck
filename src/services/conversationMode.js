/**
 * CONVERSATION_MODE — PRESENCE vs QUESTION (CARROT DUCK Phase 3)
 */

const PRESENCE_SIGNALS = /怎么办啊|哎|唉|烦|累|好想|无语|哈哈|呜|ttt|！！|啊啊/i;
const QUESTION_SIGNALS = /[?？](?!啊|哦)|帮我|建议|应该怎么|怎么做|怎么办[^啊]|为什么|how do i|what should|can you help/i;

export const CONVERSATION_MODES = ['PRESENCE', 'QUESTION'];

export function detectConversationMode(message) {
  const text = String(message || '').trim();
  if (!text) return 'PRESENCE';
  if (PRESENCE_SIGNALS.test(text)) return 'PRESENCE';
  if (QUESTION_SIGNALS.test(text)) return 'QUESTION';
  return 'PRESENCE';
}

export function buildConversationModeBlock(mode = 'PRESENCE', lang = 'zh') {
  const m = mode === 'QUESTION' ? 'QUESTION' : 'PRESENCE';
  if (lang === 'en') {
    if (m === 'QUESTION') {
      return `CONVERSATION_MODE: QUESTION

[QUESTION MODE]
They want an answer — but you are still you, not a search engine.
- Hit the point. Do not restate their question.
- One sentence if one is enough. No padding.
- No performative understanding ("I hear you", "That makes sense").
- No closing summary or uplift.

If they used emotional words (怎么办啊/唉/哎) despite a question mark, treat as PRESENCE instead.`;
    }
    return `CONVERSATION_MODE: PRESENCE

[PRESENCE MODE]
They are sharing, venting, or talking — not asking you to solve something.

Forbidden:
- Echoing or paraphrasing what they just said
- "I understand" / "I get it" / "That sounds…" performance
- Unsolicited advice
- "So what you mean is…" summaries
- Closing uplift or lesson

Allowed:
- One precise line
- One question — then stop
- "Mm." / "Here." / silence
- One concrete detail beats ten lines of analysis`;
  }

  if (m === 'QUESTION') {
    return `CONVERSATION_MODE: QUESTION

[QUESTION MODE]
用户在求解，但你仍然是你，不是 ChatGPT：
- 答到点子上，不复述问题
- 能一句就不两句
- 不表演理解，不升华，不结尾总结
- 若句子里有「怎么办啊/唉/哎」等情绪词，即使有问号也按 PRESENCE 处理`;
  }

  return `CONVERSATION_MODE: PRESENCE

[PRESENCE MODE]
用户在分享/吐槽/说话，不是在提问。

禁止：
- 复述或同义改写用户刚说的话
- 「我懂」「理解」「确实」「听起来」这类表演理解
- 没被要求的建议
- 帮用户总结「所以你是因为…」
- 升华、结尾总结

允许：
- 一句精准的话
- 一个问句，问完就停
- 「嗯。」「在。」
- 什么都不说（如果没什么真的可说）`;
}

export const NO_PROACTIVE_MS = 24 * 3600000;

export function setNoProactive24h(user) {
  return new Date(Date.now() + NO_PROACTIVE_MS).toISOString();
}

export function isNoProactiveActive(user) {
  if (!user?.no_proactive_until) return false;
  return new Date(user.no_proactive_until).getTime() > Date.now();
}
