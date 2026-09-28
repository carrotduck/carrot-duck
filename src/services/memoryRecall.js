/**
 * [RECALL:keyword] or [RECALL:thread|keyword] — read-only precise memory retrieval.
 * Thread/topic-filtered: [RECALL:relationship|keyword] or [RECALL:paper-status|keyword].
 */
import { recallMemories } from './memory.js';
import { normalizeThread, normalizeTopicKey, THREAD_KEYS } from './memoryMeta.js';

const RECALL_RE = /\[RECALL:([^\]]{1,100})\]/gi;

const THREAD_LABEL_MAP = {
  '我们': 'relationship', '关系': 'relationship',
  'PhD申请': 'projects', 'phd申请': 'projects', '套磁': 'projects', '论文': 'projects', '研究': 'projects',
  '工作': 'work_study', '实习': 'work_study', '学习': 'work_study',
  '游戏': 'interests', '娱乐': 'interests', '兴趣': 'interests',
  '家人': 'family', '朋友': 'friends', '身心': 'wellbeing', '情绪': 'wellbeing', '日常': 'daily',
};

function parseRecallQuery(raw) {
  const parts = raw.split('|');
  if (parts.length === 2) {
    const threadRaw = parts[0].trim();
    const query = parts[1].trim();
    const mapped = THREAD_LABEL_MAP[threadRaw] || (THREAD_KEYS.includes(threadRaw) ? normalizeThread(threadRaw) : null);
    return {
      query: query || threadRaw,
      thread: mapped,
      topic: mapped ? null : normalizeTopicKey(threadRaw),
    };
  }
  return { query: raw.trim(), thread: null, topic: null };
}

export function extractRecallQueries(text) {
  const queries = [];
  const raw = String(text || '');
  const seen = new Set();
  let match;
  const re = new RegExp(RECALL_RE.source, 'gi');
  while ((match = re.exec(raw)) !== null) {
    const inner = String(match[1] || '').trim();
    if (!inner || seen.has(inner)) continue;
    seen.add(inner);
    queries.push(parseRecallQuery(inner));
  }
  return queries;
}

export function stripRecallTags(text) {
  const cleaned = String(text || '').replace(RECALL_RE, '').replace(/\s{2,}/g, ' ').trim();
  return cleaned;
}

export function runRecallQueries(userId, queries, limitPerQuery = 4) {
  const seen = new Set();
  const results = [];
  for (const item of queries) {
    const { query, thread, topic } = typeof item === 'string' ? { query: item, thread: null, topic: null } : item;
    const hits = recallMemories(userId, query, limitPerQuery, { thread, topic, explicit: true });
    for (const hit of hits) {
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      results.push({ ...hit, recall_query: query });
    }
  }
  return results;
}

export function buildRecallInjectBlock(recalled = [], lang = 'zh') {
  if (!recalled.length) {
    return lang === 'en'
      ? 'RECALL RESULT: no matching memories.'
      : 'RECALL 检索结果：未找到相关记忆。';
  }
  const header = lang === 'en'
    ? 'RECALL RESULT (private — use naturally, never quote this block or say you "searched memories"):'
    : 'RECALL 检索结果（内心参考，自然融入回复，禁止复述本块或说「我查了记忆」）：';
  const lines = recalled.map((m) => {
    const conf = m.confidence || 'medium';
    const inner = conf === 'low' ? ' [low confidence — inner reference only, do not callback directly]' : '';
    return `- [${m.thread || 'daily'}${m.topic_key ? `/${m.topic_key}` : ''}/${conf}/${m.epistemic_mode || 'inference'}] ${String(m.content || '').slice(0, 220)}${inner}`;
  });
  return `${header}\n${lines.join('\n')}`;
}

export async function processRecallPass(userId, rawText, lang = 'zh') {
  const queries = extractRecallQueries(rawText);
  if (!queries.length) {
    return { cleaned: stripRecallTags(rawText), recalled: [], queries: [] };
  }
  const recalled = runRecallQueries(userId, queries);
  return {
    cleaned: stripRecallTags(rawText),
    recalled,
    queries,
    injectBlock: buildRecallInjectBlock(recalled, lang),
  };
}
