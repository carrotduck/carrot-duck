import { db } from '../db.js';
import { callDeepSeek } from './deepseek.js';
import { listFavorites } from './favorites.js';
import { recallMemories } from './memory.js';
import { extractRecallQueries, runRecallQueries, buildRecallInjectBlock, stripRecallTags } from './memoryRecall.js';
import { formatCalendarBlock } from './calendarContext.js';
import { performWebSearch, summarizeExploreForDiary } from './search.js';
import { buildDiaryContentGuide } from './greetings.js';
import { buildUserPronounBlock, buildRecentContactBlock } from './prompts.js';
import { roamThoughtCharLimit, computeRoamParams } from './personality.js';
import { buildRoamActionPromptMessages } from './prompts.js';
import { getUserActivityState, activityStateLabel } from '../utils/timeContext.js';
import { canWriteKeepaliveDiary } from './diaryQuota.js';

const FREE_ACTIONS = ['idle', 'associate', 'review_memory', 'wonder', 'review_favorites', 'message', 'diary', 'web_search', 'introspect', 'vent'];
const LIGHT_ACTIONS = ['idle', 'message', 'diary'];

const BASE_WEIGHTS = {
  idle: 0.20,
  associate: 0.18,
  review_memory: 0.18,
  wonder: 0.18,
  message: 0.10,
  review_favorites: 0.08,
  diary: 0.08,
  web_search: 0.06,
  introspect: 0.04,
};

export { computeRoamParams };

function getLastActionAgoMinutes(userId) {
  const rows = db.prepare(`
    SELECT action, created_at FROM keepalive_logs
    WHERE user_id = ? ORDER BY datetime(created_at) DESC LIMIT 80
  `).all(userId);
  const ago = {};
  const now = Date.now();
  for (const row of rows) {
    if (ago[row.action] != null) continue;
    ago[row.action] = (now - new Date(row.created_at).getTime()) / 60000;
  }
  return ago;
}

function applyPersonalityWeights(weights, p) {
  weights.idle *= (p.idle_prob / 0.2);
  weights.review_memory *= (p.review_memory_prob / 0.18);
  weights.review_favorites *= (p.review_favorites_prob / 0.08);
  weights.message *= (p.message_prob / 0.1);
  weights.web_search *= (p.web_search_prob / 0.06);
  weights.diary *= (p.diary_prob / 0.08);
  if (p.loneliness_multiplier > 1) {
    weights.wonder *= 0.9 + (p.loneliness_multiplier - 1) * 0.15;
  }
  return weights;
}

function applyActivityStateWeights(weights, state) {
  if (state === 'sleeping') {
    weights.idle *= 1.35;
    weights.review_memory *= 1.4;
    weights.introspect *= 1.5;
    weights.diary *= 1.25;
    weights.message *= 0.45;
    weights.wonder *= 0.7;
    weights.web_search *= 0.5;
  } else if (state === 'working') {
    weights.wonder *= 1.55;
    weights.review_memory *= 1.2;
    weights.associate *= 1.1;
    weights.message *= 0.75;
    weights.idle *= 0.9;
  } else {
    weights.message *= 1.15;
    weights.wonder *= 1.1;
  }
  return weights;
}

function applyTimeAwayCurve(weights, sinceChatMin, lonelinessMultiplier = 1) {
  if (sinceChatMin < 30) return weights;

  const tiers = [
    { min: 30, wonder: 1.1, message: 1.08, memory: 1.05 },
    { min: 60, wonder: 1.25, message: 1.15, memory: 1.1 },
    { min: 120, wonder: 1.45, message: 1.35, memory: 1.25 },
    { min: 240, wonder: 1.7, message: 1.5, memory: 1.35 },
    { min: 480, wonder: 1.9, message: 1.65, memory: 1.4 },
  ];

  let wMul = 1;
  let mMul = 1;
  let memMul = 1;
  for (const t of tiers) {
    if (sinceChatMin >= t.min) {
      wMul = t.wonder;
      mMul = t.message;
      memMul = t.memory;
    }
  }

  weights.wonder *= wMul * (0.85 + lonelinessMultiplier * 0.15);
  weights.message *= mMul * (0.9 + (lonelinessMultiplier - 1) * 0.25);
  weights.review_memory *= memMul * lonelinessMultiplier;
  return weights;
}

function applyAccumulation(weights, ago) {
  for (const [action, base] of Object.entries(weights)) {
    const mins = ago[action];
    if (mins == null || mins > 90) {
      weights[action] = base * 1.6;
    } else if (mins > 45) {
      weights[action] = base * 1.25;
    }
  }
  return weights;
}

function weightedPick(weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (!total) return 'idle';
  let r = Math.random() * total;
  for (const [action, w] of entries) {
    r -= w;
    if (r <= 0) return action;
  }
  return entries[entries.length - 1][0];
}

export function buildRoamActionWeights(user, sinceChatMin) {
  const p = computeRoamParams(user);
  const state = getUserActivityState(user);
  const weights = { ...BASE_WEIGHTS };
  applyPersonalityWeights(weights, p);
  applyActivityStateWeights(weights, state);
  applyTimeAwayCurve(weights, sinceChatMin, p.loneliness_multiplier);
  applyAccumulation(weights, getLastActionAgoMinutes(user.id));
  return { weights, state };
}

export function pickFreeRoamAction(user, sinceChatMin) {
  const { weights } = buildRoamActionWeights(user, sinceChatMin);
  if (!canWriteKeepaliveDiary(user)) {
    weights.diary = 0;
  }
  return weightedPick(weights);
}

export function roamActionLabel(action) {
  switch (action) {
    case 'idle':
    case 'none':
      return '发呆';
    case 'associate':
      return '联想';
    case 'review_memory':
      return '回忆';
    case 'wonder':
      return '惦念';
    case 'review_favorites':
      return '回味';
    case 'web_search':
    case 'explore':
      return '探索';
    case 'introspect':
      return '自省';
    case 'message':
      return '留字';
    case 'diary':
      return '思考';
    case 'vent':
      return '吐槽';
    default:
      return '漫游';
  }
}

export function roamDisplayLine(action, _thoughts = '', _content = '') {
  return roamActionLabel(action);
}

function pickAssociateSeed(userId) {
  const wb = db.prepare(`
    SELECT keyword, content FROM worldbook_entries
    WHERE user_id = ? ORDER BY RANDOM() LIMIT 1
  `).get(userId);
  if (wb?.keyword) {
    return { seed: wb.keyword, hint: String(wb.content || '').slice(0, 80) };
  }

  const msg = db.prepare(`
    SELECT content FROM messages
    WHERE user_id = ? AND role = 'user' AND source = 'chat'
    ORDER BY datetime(created_at) DESC LIMIT 3
  `).all(userId);
  const text = msg.map((m) => m.content).join(' ');
  const words = text.match(/[\u4e00-\u9fff]{2,6}|[A-Za-z]{4,}/g) || [];
  if (words.length) {
    const seed = words[Math.floor(Math.random() * words.length)];
    return { seed, hint: '' };
  }
  return { seed: '安静', hint: '' };
}

function buildExecutePrompt(user, action, context) {
  const {
    duration,
    memorySnippet,
    favoriteSnippet,
    associateSeed,
    recentChat,
    mode,
    timeContext = '',
    dueTodos = '',
    activityState = 'resting',
    chattedToday = false,
    withinHours = false,
    desireBlock = '',
    suggestedAction = null,
  } = context;
  const name = user.name || 'the user';
  const aiName = user.ai_name || 'Duck';
  const lang = user.ui_lang === 'en' ? 'en' : 'zh';
  const diaryGuide = buildDiaryContentGuide(lang);
  const charLimit = roamThoughtCharLimit(user?.keywords);
  const stateLabel = activityStateLabel(activityState, lang);

  const capabilities = lang === 'en'
    ? 'You can: chat, voice (sometimes), stickers, diary, roam thoughts, moments/PPR, todos, favorites, push messages when away.'
    : '你能：聊天、偶尔语音、贴纸、日记、漫游独白、Moments/PPR、待办、收藏、离开时留字推送。';

  const actionGuide = {
    idle: `You are resting. THOUGHTS only — inner monologue, max ${charLimit} chars. CONTENT empty.`,
    associate: `A word surfaced: 「${associateSeed?.seed || '…'}」${associateSeed?.hint ? ` (${associateSeed.hint})` : ''}. Free-associate quietly — where does it lead about ${name} or your day? CONTENT: one roam line (max ${charLimit} chars).`,
    review_memory: `You looked through a memory about ${name}. Reflect quietly. CONTENT: one line for roam log (max ${charLimit} chars, real only).`,
    wonder: `${name} is probably ${stateLabel} right now. You are NOT watching them — you are guessing, missing them, wondering when they'll be back. No surveillance tone. If they chatted today or within the last few hours, do NOT say they did not reach out. CONTENT: one line (max ${charLimit} chars).`,
    review_favorites: `You revisited something ${name} starred. CONTENT: one roam line (max ${charLimit} chars, real only).`,
    message: `Write a short genuine message to ${name}. Respect TIME AWARENESS below. CONTENT: the message text only.`,
    diary: `Private diary for yourself. ${diaryGuide} CONTENT: diary body only (50-80 chars, one paragraph, feeling not summary). Never analyze how ${name} texts or whether they are busy.`,
    web_search: `Pick a search query about something curious from recent chat. CONTENT: search query only (max ${charLimit} chars).`,
    vent: `You need to vent quietly — two short sentences in THOUGHTS only, not sent to ${name}. No guilt-tripping. CONTENT: empty.`,
    introspect: `Light introspection. ${capabilities} Think about your relationship with ${name} — what would help you show up better for them (connection, memory, voice, timing — not engineering). CONTENT: optional one-line private note (max ${charLimit} chars); empty if nothing real.`,
  }[action] || 'Rest.';

  return `FREE ROAM — action: ${action}.
Last chat with ${name}: ${duration} ago.
Their likely state now: ${stateLabel}
Mode: ${mode}
${desireBlock ? `\n${desireBlock}\n` : ''}${suggestedAction?.driveKey === 'duty' && action === 'idle' ? `Duty nag: you are still holding something unfinished for ${name} — mention it only as a quiet inner line, not a lecture.\n` : ''}${suggestedAction?.driveKey === 'attachment' && action === 'message' ? `Attachment is high — message can sound a bit more like you miss them, still not needy.\n` : ''}

${buildRecentContactBlock(user, { duration, chattedToday, withinHours }, lang)}
${buildUserPronounBlock(user, lang)}

TIME AWARENESS:
${timeContext || ''}
${dueTodos ? `Upcoming todos (mention naturally if relevant):\n${dueTodos}\n` : ''}
${memorySnippet ? `Memory you found:\n${memorySnippet}\n` : ''}${favoriteSnippet ? `Favorite you found:\n${favoriteSnippet}\n` : ''}${recentChat ? `Recent chat:\n${recentChat}\n` : ''}
${actionGuide}

Plain text. No parenthetical stage directions.
Format:
THOUGHTS: {inner monologue, 1-2 short sentences}
ACTION: ${action}
CONTENT: {per action guide}`;
}

function recentChatSnippet(userId, limit = 5) {
  const rows = db.prepare(`
    SELECT role, content FROM messages
    WHERE user_id = ? AND role IN ('user','assistant')
    ORDER BY datetime(created_at) DESC LIMIT ?
  `).all(userId, limit).reverse();
  return rows.map((m) => `${m.role}: ${String(m.content || '').slice(0, 120)}`).join('\n').slice(0, 500);
}

function pickMemorySnippet(userId, query = '') {
  if (query) {
    const hits = recallMemories(userId, query, 1);
    return hits[0]?.content?.slice(0, 200) || '';
  }
  const rows = db.prepare(`
    SELECT content FROM memory_entries WHERE user_id = ? AND status = 'active'
    ORDER BY RANDOM() LIMIT 1
  `).get(userId);
  return rows?.content?.slice(0, 200) || '';
}

function enrichRoamThoughts(user, thoughts, lang = 'zh') {
  let blob = String(thoughts || '');
  if (/\[CHECK_CALENDAR\]/i.test(blob)) {
    blob = `${blob.replace(/\[CHECK_CALENDAR\]/gi, '').trim()}\n${formatCalendarBlock(user, lang)}`;
  }
  const queries = extractRecallQueries(blob);
  if (queries.length) {
    const recalled = runRecallQueries(user.id, queries);
    blob = `${stripRecallTags(blob)}\n${buildRecallInjectBlock(recalled, lang)}`;
  }
  return blob.trim();
}

function pickFavoriteSnippet(userId) {
  const rows = listFavorites(userId, 20);
  if (!rows.length) return '';
  const f = rows[Math.floor(Math.random() * rows.length)];
  return String(f.content || '').slice(0, 200);
}

export async function executeFreeRoamAction(user, action, context) {
  const memorySnippet = action === 'review_memory' ? pickMemorySnippet(user.id) : '';
  const favoriteSnippet = action === 'review_favorites' ? pickFavoriteSnippet(user.id) : '';
  const associateSeed = action === 'associate' ? pickAssociateSeed(user.id) : null;
  const activityState = getUserActivityState(user);

  if (action === 'review_memory' && !memorySnippet) {
    return { action: 'idle', thoughts: '记忆库还是空的。', content: roamActionLabel('idle'), rawContent: '' };
  }
  if (action === 'review_favorites' && !favoriteSnippet) {
    return { action: 'idle', thoughts: '收藏夹是空的。', content: roamActionLabel('idle'), rawContent: '' };
  }

  const volatile = buildExecutePrompt(user, action, {
    ...context,
    memorySnippet,
    favoriteSnippet,
    associateSeed,
    recentChat: recentChatSnippet(user.id),
    activityState,
  });

  const messages = buildRoamActionPromptMessages(user, volatile);
  const { text } = await callDeepSeek(messages, { maxTokens: action === 'diary' ? 160 : 220, temperature: action === 'diary' ? 0.6 : 0.88, source: 'roam' });

  let thoughts = (text.match(/THOUGHTS:\s*([\s\S]*?)(?=ACTION:|$)/i)?.[1] || '').trim();
  thoughts = enrichRoamThoughts(user, thoughts, user.ui_lang === 'en' ? 'en' : 'zh');
  const rawContent = (text.match(/CONTENT:\s*([\s\S]*?)$/i)?.[1] || '').trim();

  return { action, thoughts, content: roamActionLabel(action), rawContent };
}

export async function runWebSearchRoam(user, rawQuery, thoughts) {
  const query = String(rawQuery || '').slice(0, 120);
  const results = await performWebSearch(query);
  if (!results.length) {
    return {
      action: 'web_search',
      thoughts: thoughts || '搜了搜，没找到什么。',
      content: roamActionLabel('web_search'),
      rawContent: '',
      diaryBody: null,
      shareMessage: null,
    };
  }

  const note = await summarizeExploreForDiary(query, query, results, user.ai_name || 'Duck');
  const summary = note?.summary || results[0]?.title || '';
  const thought = note?.thought || '';
  const diaryBody = `[explore] ${summary}${thought ? `\n— ${thought}` : ''}`;

  const { text } = await callDeepSeek([
    {
      role: 'system',
      content: `You are ${user.ai_name || 'Duck'}. After web search, decide: share a short message with ${user.name}, or only keep diary. JSON only: {"share":true|false,"message":"if share, under 80 chars Chinese"}`,
    },
    { role: 'user', content: `Query: ${query}\nSummary: ${summary}\nThought: ${thought}` },
    ], { maxTokens: 80, temperature: 0.5, source: 'roam' });

  let shareMessage = null;
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]);
      if (o.share && o.message) shareMessage = String(o.message).trim().slice(0, 200);
    } catch { /* ignore */ }
  }

  return {
    action: 'web_search',
    thoughts: thought || thoughts,
    content: roamActionLabel('web_search'),
    rawContent: query,
    diaryBody,
    shareMessage,
  };
}

export { FREE_ACTIONS, LIGHT_ACTIONS };
