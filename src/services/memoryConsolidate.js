import { db, getUser } from '../db.js';
import { callDeepSeek } from './deepseek.js';
import { addMemory, deleteMemory } from './memory.js';
import { buildDiaryWritingInstruction, clipDiaryBody } from './greetings.js';

function parseTags(row) {
  try {
    return JSON.parse(row.tags || '[]');
  } catch {
    return [];
  }
}

function shanghaiDayKey(iso) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(0, 10);
  }
}

export function listSessionSummaryMemories(userId) {
  const rows = db.prepare(`
    SELECT * FROM memory_entries
    WHERE user_id = ? AND status = 'active'
    ORDER BY datetime(created_at) ASC
  `).all(userId);

  return rows
    .filter((row) => parseTags(row).includes('session-summary'))
    .map((row) => ({
      id: row.id,
      content: row.content,
      category: row.category,
      tags: parseTags(row),
      created_at: row.created_at,
    }));
}

const CONSOLIDATE_TAGS = new Set(['session-summary', 'keepalive-diary', 'keepalive-explore']);

export function listConsolidatableDiaryMemories(userId) {
  const rows = db.prepare(`
    SELECT * FROM memory_entries
    WHERE user_id = ? AND category = 'diary' AND status = 'active'
    ORDER BY datetime(created_at) ASC
  `).all(userId);

  return rows
    .filter((row) => {
      const tags = parseTags(row);
      if (tags.some((t) => CONSOLIDATE_TAGS.has(t))) return true;
      const content = String(row.content || '').trim();
      return content.startsWith('[explore]');
    })
    .map((row) => ({
      id: row.id,
      content: row.content,
      category: row.category,
      tags: parseTags(row),
      created_at: row.created_at,
    }));
}

export function countConsolidatableDiaryMemories(userId) {
  return listConsolidatableDiaryMemories(userId).length;
}

export function countSessionSummaryMemories(userId) {
  return listSessionSummaryMemories(userId).length;
}

function parseDiaryOutput(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  if (raw.startsWith('[')) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr
          .map((s) => clipDiaryBody(String(s)))
          .filter((s) => s.length >= 6);
      }
    } catch {
      /* fall through */
    }
  }

  return raw
    .split(/\n+/)
    .map((line) => line.replace(/^[\s\-•*\d.、)）]+/, '').trim())
    .filter((line) => line.length >= 6)
    .map((line) => clipDiaryBody(line));
}

function formatNotes(entries) {
  return entries
    .map((e) => `[${String(e.created_at).slice(0, 16)}] ${String(e.content || '').trim()}`)
    .join('\n');
}

function targetEntryCount(entryCount, override) {
  if (override != null && override > 0) return Math.min(override, 8);
  if (entryCount <= 4) return 1;
  return Math.min(5, Math.max(2, Math.ceil(entryCount / 10)));
}

async function mergeNotesToDiaries(user, notesText, maxEntries) {
  const lang = user.ui_lang === 'en' ? 'en' : 'zh';
  const instruction = buildDiaryWritingInstruction(lang);
  const aiName = user.ai_name || 'Duck';
  const name = user.name || (lang === 'en' ? 'them' : '对方');

  const system = lang === 'en'
    ? `You are ${aiName}. ${instruction}

You will read old private diary fragments about time with ${name}. Merge them into at most ${maxEntries} diary entries.
Drop search summaries, [explore] lines, and meta-analysis of how ${name} texts.
Output ONLY the diary lines, one per line. No numbering, no quotes, no headings, no JSON.`
    : `你是${aiName}。${instruction}

你将读一批与${name}相处的旧日记碎片，合并成最多 ${maxEntries} 条日记。
丢弃搜索摘要、[explore] 行、以及分析${name}怎么回消息的内容。
只输出日记正文，每行一条。不要编号、引号、标题或 JSON。`;

  const userPrompt = lang === 'en'
    ? `Old diary fragments (merge into at most one real diary entry per day; drop search summaries, [explore] lines, and meta-analysis of how ${name} texts):\n\n${notesText}`
    : `旧日记碎片（合并成每天最多一条真实日记；丢弃搜索摘要、[explore] 行、以及分析${name}怎么回消息的内容）：\n\n${notesText}`;

  const { text } = await callDeepSeek([
    { role: 'system', content: system },
    { role: 'user', content: userPrompt },
  ], {
    maxTokens: Math.max(120, maxEntries * 90),
    temperature: 0.45,
    source: 'consolidate',
  });

  return parseDiaryOutput(text);
}

async function consolidateDayEntries(user, dayEntries, maxEntriesOverride) {
  const maxEntries = targetEntryCount(dayEntries.length, maxEntriesOverride);
  const CHUNK = 14;

  if (dayEntries.length <= CHUNK) {
    return mergeNotesToDiaries(user, formatNotes(dayEntries), maxEntries);
  }

  const intermediate = [];
  for (let i = 0; i < dayEntries.length; i += CHUNK) {
    const chunk = dayEntries.slice(i, i + CHUNK);
    const lines = await mergeNotesToDiaries(user, formatNotes(chunk), 2);
    for (const content of lines) {
      intermediate.push({
        created_at: chunk[0].created_at,
        content,
      });
    }
  }

  return mergeNotesToDiaries(user, formatNotes(intermediate), maxEntries);
}

export async function consolidateSessionSummaryMemories(userId, options = {}) {
  const user = getUser(userId);
  if (!user) throw new Error('User not found');

  const entries = listSessionSummaryMemories(userId);
  if (!entries.length) {
    return { deleted: 0, created: [], days: 0, skipped: 'none', source_count: 0 };
  }

  return consolidateDiaryEntryList(user, entries, options);
}

export async function consolidateDiaryMemories(userId, options = {}) {
  const user = getUser(userId);
  if (!user) throw new Error('User not found');

  const entries = listConsolidatableDiaryMemories(userId);
  if (!entries.length) {
    return { deleted: 0, created: [], days: 0, skipped: 'none', source_count: 0 };
  }

  return consolidateDiaryEntryList(user, entries, options);
}

async function consolidateDiaryEntryList(user, entries, options = {}) {
  const userId = user.id;
  const byDay = new Map();
  for (const entry of entries) {
    const day = shanghaiDayKey(entry.created_at);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(entry);
  }

  const created = [];
  for (const [day, dayEntries] of byDay) {
    const lines = await consolidateDayEntries(user, dayEntries, options.maxPerDay ?? 1);
    for (const content of lines) {
      if (!content) continue;
      const entry = addMemory(userId, {
        content,
        category: 'diary',
        tags: ['consolidated', 'from-keepalive', day],
        source_refs: dayEntries.map((item) => ({ type: 'memory', id: item.id })),
        meta: { source: 'memory-consolidation' },
        epistemic_mode: 'inference',
      });
      created.push(entry);
    }
  }

  let deleted = 0;
  for (const entry of entries) {
    if (deleteMemory(userId, entry.id)) deleted += 1;
  }

  return {
    deleted,
    created,
    days: byDay.size,
    source_count: entries.length,
  };
}
