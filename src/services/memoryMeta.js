/** Universal memory lanes plus an emergent per-user topic key. */
import { callDeepSeek } from './deepseek.js';

export const MEMORY_THREADS = [
  { key: 'relationship', label_zh: '我们/关系', label_en: 'Relationship' },
  { key: 'family', label_zh: '家人', label_en: 'Family' },
  { key: 'friends', label_zh: '朋友', label_en: 'Friends' },
  { key: 'work_study', label_zh: '工作/学习', label_en: 'Work & study' },
  { key: 'projects', label_zh: '项目/目标', label_en: 'Projects & goals' },
  { key: 'wellbeing', label_zh: '身心状态', label_en: 'Wellbeing' },
  { key: 'interests', label_zh: '兴趣/娱乐', label_en: 'Interests' },
  { key: 'daily', label_zh: '日常', label_en: 'Daily life' },
];

export const THREAD_KEYS = MEMORY_THREADS.map((t) => t.key);
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];

const THREAD_HINTS = [
  { key: 'relationship', re: /我们俩|我们一起|上次你说|你跟我|我记得你|跟你在一起|那天我们|关系|亲密|边界/i },
  { key: 'projects', re: /申请季|选校|文书|offer|录取|推荐信|sop|cv|套磁|教授|论文|paper|实验|数据|研究|发表|投稿|答辩|课题|项目|计划|目标|deadline|ddl/i },
  { key: 'work_study', re: /实习|工作|上班|面试|公司|加班|老板|同事|学习|考试|课程|学校|作业/i },
  { key: 'family', re: /妈妈|爸爸|父母|家人|家里|爷爷|奶奶|弟弟|妹妹|哥哥|姐姐/i },
  { key: 'friends', re: /朋友|闺蜜|同学|室友|聚会/i },
  { key: 'wellbeing', re: /心情|难过|开心|累|失眠|焦虑|身体|生病|疼|情绪|压力|睡眠/i },
  { key: 'interests', re: /游戏|番剧|动漫|电影|剧|打机|steam|原神|追剧|音乐|画画|摄影|旅行|爱好/i },
  { key: 'daily', re: /今天|昨天|明天|吃饭|起床|回家|天气|日常/i },
];

const LEGACY_THREAD_MAP = {
  phd_apply: 'projects',
  outreach: 'projects',
  research: 'projects',
  work: 'work_study',
  entertainment: 'interests',
  we: 'relationship',
  study: 'work_study',
};

export function normalizeThread(raw) {
  const key = String(raw || '').trim().toLowerCase();
  if (LEGACY_THREAD_MAP[key]) return LEGACY_THREAD_MAP[key];
  return THREAD_KEYS.includes(key) ? key : 'daily';
}

export function normalizeTopicKey(raw, fallback = null) {
  const value = String(raw || '').trim().toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{Letter}\p{Number}._:-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return value || fallback;
}

export function normalizeConfidence(raw) {
  const key = String(raw || '').trim().toLowerCase();
  return CONFIDENCE_LEVELS.includes(key) ? key : 'medium';
}

export function heuristicThread(content) {
  const text = String(content || '');
  for (const hint of THREAD_HINTS) {
    if (hint.re.test(text)) return hint.key;
  }
  return 'daily';
}

export function inferConfidence({ source = 'chat', userExplicit = false, fromRoam = false } = {}) {
  if (fromRoam) return 'low';
  if (userExplicit || source === 'user-stated') return 'high';
  if (source === 'inferred' || source === 'chat') return 'medium';
  return 'medium';
}

export async function classifyMemoryMeta(content, { source = 'chat', userExplicit = false, fromRoam = false } = {}) {
  const fallback = {
    thread: heuristicThread(content),
    topic_key: null,
    confidence: inferConfidence({ source, userExplicit, fromRoam }),
  };

  const threadList = MEMORY_THREADS.map((t) => `${t.key}=${t.label_zh}`).join(', ');
  try {
    const { text } = await callDeepSeek([
      {
        role: 'system',
        content: `Classify a memory snippet. Output JSON only: {"thread":"one of ${THREAD_KEYS.join('|')}","topic_key":"short reusable topic or null","confidence":"high|medium|low"}
Threads: ${threadList}
Rules:
- thread is a universal lane; topic_key is a user-specific topic such as paper-status, new-job, favorite-game
- never put a person name or private sentence in topic_key
- high: user explicitly stated a fact about themselves/someone
- medium: reasonably inferred from conversation
- low: roam association / weak guess`,
      },
      { role: 'user', content: String(content || '').slice(0, 400) },
    ], { maxTokens: 60, temperature: 0.1, source: 'memory_meta' });

    const parsed = JSON.parse(String(text || '').replace(/```json|```/g, '').trim());
    return {
      thread: normalizeThread(parsed.thread),
      topic_key: normalizeTopicKey(parsed.topic_key),
      confidence: normalizeConfidence(parsed.confidence),
    };
  } catch {
    return fallback;
  }
}

export function threadLabel(key, lang = 'zh') {
  const row = MEMORY_THREADS.find((t) => t.key === key);
  if (!row) return key;
  return lang === 'en' ? row.label_en : row.label_zh;
}

export function detectQueryThread(query) {
  return heuristicThread(query);
}
