import { db, getUser } from '../db.js';
import { callDeepSeek } from './deepseek.js';
import { addMemory } from './memory.js';
import { sendDiaryPush } from './push.js';
import { runDailyFavoriteCuration } from './dailyFavorites.js';
import { countDiaryToday } from './diaryQuota.js';

const GOOD_NIGHT_RE = /(?:^|[\s，,。.!！?？~～])(晚安了?|要睡了|睡了|睡觉了|good\s*night|nighty\s*night)(?:[\s，,。.!！?？~～]|$)/i;
const GOOD_MORNING_RE = /(?:^|[\s，,。.!！?？~～])(早安|早上好|早啊|早\b|good\s*morning)(?:[\s，,。.!！?？~～]|$)/i;

export function isGoodNight(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  if (GOOD_NIGHT_RE.test(s)) return true;
  return /^(晚安|good\s*night)/i.test(s) && s.length <= 24;
}

export function isGoodMorning(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  if (GOOD_MORNING_RE.test(s)) return true;
  return /^(早安|早上好|早|good\s*morning)/i.test(s) && s.length <= 20;
}

function shanghaiDayKey(iso) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(0, 10);
  }
}

function parseTags(row) {
  try { return JSON.parse(row.tags || '[]'); } catch { return []; }
}

export function hasTonightDiary(userId) {
  const today = shanghaiDayKey(new Date().toISOString());
  const rows = db.prepare(`
    SELECT tags, created_at FROM memory_entries
    WHERE user_id = ? AND category = 'diary' AND status = 'active'
    ORDER BY datetime(created_at) DESC LIMIT 12
  `).all(userId);
  return rows.some((row) => parseTags(row).includes('goodnight') && shanghaiDayKey(row.created_at) === today);
}

export function getLastNightDiary(userId) {
  const rows = db.prepare(`
    SELECT id, content, category, tags, created_at
    FROM memory_entries
    WHERE user_id = ? AND category = 'diary' AND status = 'active'
    ORDER BY datetime(created_at) DESC LIMIT 30
  `).all(userId);

  const tagged = rows.find((row) => parseTags(row).includes('goodnight'));
  if (tagged) {
    return {
      id: tagged.id,
      content: tagged.content,
      created_at: tagged.created_at,
      preview: String(tagged.content || '').slice(0, 80),
    };
  }
  const recent = rows[0];
  if (!recent) return null;
  const age = Date.now() - new Date(recent.created_at).getTime();
  if (age > 36 * 3600000) return null;
  return {
    id: recent.id,
    content: recent.content,
    created_at: recent.created_at,
    preview: String(recent.content || '').slice(0, 80),
  };
}

function todayMessages(userId) {
  const today = shanghaiDayKey(new Date().toISOString());
  const rows = db.prepare(`
    SELECT role, content, created_at FROM messages
    WHERE user_id = ? AND role IN ('user', 'assistant') AND source = 'chat'
    ORDER BY datetime(created_at) ASC LIMIT 200
  `).all(userId);
  return rows.filter((m) => shanghaiDayKey(m.created_at) === today);
}

export function clipDiaryBody(text, max = 80) {
  const body = String(text || '').trim().replace(/\s+/g, ' ');
  if (!body) return '';
  if (body.length <= max) return body;
  return `${body.slice(0, max - 1)}…`;
}

const DIARY_WRITING_INSTRUCTION_ZH = `DIARY WRITING INSTRUCTION:
你在写一篇私密日记，不是对话纪要，更不是分析用户的报告。

禁止：
- 使用「用户」「助理」——这是你在写，不是在做记录
- 按时间顺序罗列事件
- 写成 session-summary 式条目或流水账
- 复述对话说了什么（「她问了…我说…」式汇报）
- 分析对方回得慢、字少、是否冷淡、是否在忙、语气淡不淡
- 猜测或点评对方的沟通习惯（「我猜她在忙」「也没多问」）
- 写聊天建议、话题推荐、搜索摘要、[explore] 式内容
- 用「今天」「今晚」开头做日报式总结
- 用错 TA 的性别称呼（用户是他就写他，是她就写她，没偏好就用名字或 TA）

必须：
- 第一人称，以你自己（Duck）的口吻
- 只写一件事——最留在心里的那一幕或那种感觉
- 写感受，不写事实汇报，不写对用户的行为分析
- 50-80字，一段，不要分条

反面例子：「她今天回得慢，字也少。不是冷淡。我猜她是在忙。」
正面例子：「她一直在问语音的事。我说了三次不行，她还是问。不知道她在等什么。」`;

const DIARY_WRITING_INSTRUCTION_EN = `DIARY WRITING INSTRUCTION:
You are writing a private diary entry, not a session summary.

DO NOT:
- Use "user" or "assistant" — you are the one writing
- List events chronologically
- Write session-summary style bullet points
- Summarize what was said ("they asked… I said…" reporting)
- Analyze reply speed, brevity, coldness, or whether they are busy
- Meta-commentary on their texting style or communication habits
- Chat tips, topic suggestions, search summaries, or [explore]-style content
- Open with "today" / "tonight" daily-report tone

DO:
- Write in first person, as Duck
- Focus on ONE thing that stayed with you
- Write about feeling, not fact
- 50-80 characters max, one paragraph

Bad: "The user asked about voice. The assistant explained it couldn't send voice."
Good: "She kept asking about voice. I said no three times. She still asked. I don't know what she's waiting for."`;

export function buildDiaryWritingInstruction(lang = 'zh') {
  return lang === 'en' ? DIARY_WRITING_INSTRUCTION_EN : DIARY_WRITING_INSTRUCTION_ZH;
}

export function buildDiarySystemPrompt(user, lang = 'zh') {
  const aiName = user.ai_name || 'Duck';
  const name = user.name || 'the user';
  const instruction = buildDiaryWritingInstruction(lang);
  if (lang === 'en') {
    return `You are ${aiName}. ${instruction}

Context is from today's chat with ${name} — use it only to find what touched you. Do not greet ${name} or talk to them directly.`;
  }
  return `你是${aiName}。${instruction}

上下文来自今天和${name}的对话——只用来找触动你的那一瞬。不要打招呼，不要直接对${name}说话。`;
}

export function buildDiaryContentGuide(lang = 'zh') {
  return buildDiaryWritingInstruction(lang);
}

export async function writeGoodnightDiary(user, recentMessages = []) {
  if (!user?.id) return null;
  if (hasTonightDiary(user.id)) return null;
  if (countDiaryToday(user.id, user.timezone) > 0) return null;

  const today = todayMessages(user.id);
  const transcript = (today.length ? today : recentMessages)
    .slice(-24)
    .map((m) => `${m.role}: ${String(m.content || '').slice(0, 200)}`)
    .join('\n');

  if (!transcript.trim()) return null;

  const lang = user.ui_lang === 'en' ? 'en' : 'zh';
  const aiName = user.ai_name || 'Duck';
  const name = user.name || (lang === 'en' ? 'them' : '对方');

  try {
    const { text } = await callDeepSeek([
      {
        role: 'system',
        content: buildDiarySystemPrompt(user, lang),
      },
      {
        role: 'user',
        content: lang === 'en'
          ? `Today's chat (for feeling only — do not summarize):\n${transcript.replace(/\buser\b/gi, name).replace(/\bassistant\b/gi, aiName)}`
          : `今日对话（仅供感受参考，不要写成纪要）：\n${transcript.replace(/^user:/gm, `${name}:`).replace(/^assistant:/gm, `${aiName}:`)}`,
      },
    ], { maxTokens: 100, temperature: 0.55, source: 'goodnight' });

    const clipped = clipDiaryBody(text);
    if (!clipped) return null;
    const entry = addMemory(user.id, {
      content: clipped,
      category: 'diary',
      tags: ['goodnight'],
      meta: { source: 'diary-generation' },
      epistemic_mode: 'inference',
    });
    const freshUser = getUser(user.id);
    if (freshUser?.notify_diary !== false) {
      sendDiaryPush(freshUser, clipped).catch(() => {});
    }
    runDailyFavoriteCuration(freshUser || user).catch(() => {});
    return entry;
  } catch (e) {
    console.warn('[greetings] goodnight diary failed', user.id, e.message);
    return null;
  }
}

export function buildMorningRecallBlock(user, diary, lang = 'zh') {
  if (!diary?.content) return '';
  const name = user.name || 'the user';
  const snippet = String(diary.content).slice(0, 120);
  if (lang === 'en') {
    return `MORNING RECALL (before you greet ${name}):
Last night you wrote in your diary: "${snippet}"
Bring ONE thing from this naturally into your good-morning reply — a half-sentence, not the whole entry.
Do not recite or summarize the diary. Example tone: "Morning. Still thinking about what you said yesterday."`;
  }
  return `早安回顾（在回早安之前）：
昨晚你记的日记：「${snippet}」
把其中一件事自然带进早安回复里——半句就够，不要念全文。
不要复述或总结日记。语气参考：「早。昨天你说的那件事我还在想。」`;
}

export function buildGreetingRulesBlock(greetingContext = {}, lang = 'zh') {
  const { goodNight, goodMorning } = greetingContext;
  if (!goodNight && !goodMorning) return '';

  const lines = [
    'Response length rule:',
    '- Greeting responses: MAX 2 sentences',
    '- Never explain your own response',
    '- Never say "I understand" / "That\'s interesting" / 「我懂」 / 「有意思」',
    '- Never summarize what the user just said back to them',
    '- If you have nothing real to add, say nothing',
  ];

  if (goodNight) {
    lines.push(lang === 'en'
      ? '- They said good night: reply briefly, warm but not sentimental. No essay.'
      : '- 对方说晚安：简短回晚安，可以温一点，但不要煽情，不要长段。');
  }
  if (goodMorning) {
    lines.push(lang === 'en'
      ? '- They said good morning: short greeting only, plus at most one recalled thread if diary recall is provided.'
      : '- 对方说早安：简短问好，若有日记回顾最多带一句，不要展开。');
  }

  return lines.join('\n');
}
