/**
 * CogniFold-inspired tri-layer memory for CARROT DUCK.
 * Hippocampus (fast daily) → Neocortex (stable patterns) → Prefrontal (actionable intents).
 */
import { callDeepSeek } from './deepseek.js';
import { db, getUser } from '../db.js';
import {
  addMemory,
  listHippocampusEntries,
  listNeocortexMemories,
  markHippocampusFolded,
  parseMemoryTags,
  hasMemoryTag,
  LAYER_NEOCORTEX,
  LAYER_HIPPOCAMPUS,
} from './memory.js';
import {
  addPrefrontalIntent,
  getActivePrefrontalIntents,
  purgeExpiredPrefrontalIntents,
} from './worldbook.js';
import { userDateKey } from '../utils/timezone.js';

export { LAYER_HIPPOCAMPUS, LAYER_NEOCORTEX, TAG_FOLDED_NEOCORTEX } from './memory.js';
export const MIN_TOPIC_OCCURRENCES = 3;
export const INTENT_TTL_MS = 7 * 86400000;

const lastDailyRunByUser = new Map();

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function overlapRatio(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.length || !tb.length) return 0;
  const setB = new Set(tb);
  let hits = 0;
  for (const t of ta) if (setB.has(t)) hits += 1;
  return hits / Math.max(ta.length, tb.length);
}

function parseJsonBlock(text) {
  const raw = String(text || '').trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function formatSourceTrail(sources) {
  if (!sources?.length) return '';
  const dates = sources
    .map((s) => s.created_at)
    .filter(Boolean)
    .map((iso) => {
      try {
        return iso.slice(0, 10);
      } catch {
        return iso;
      }
    });
  const unique = [...new Set(dates)];
  return unique.length ? `\n[来源: ${unique.join(', ')}]` : '';
}

export function shouldRunDailyCogniFold(user, date = new Date()) {
  if (!user?.id) return false;
  const tz = user.timezone || 'Asia/Shanghai';
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hour12: false,
  }).format(date));
  if (hour !== 3) return false;
  const dayKey = userDateKey(date, tz);
  if (lastDailyRunByUser.get(user.id) === dayKey) return false;
  lastDailyRunByUser.set(user.id, dayKey);
  return true;
}

export async function consolidateHippocampusToNeocortex(user) {
  const entries = listHippocampusEntries(user.id, {
    excludeFolded: true,
    limit: 80,
    withinDays: 30,
  });

  if (entries.length < MIN_TOPIC_OCCURRENCES) {
    return { created: 0, skipped: 'too_few_entries', scanned: entries.length };
  }

  const existingNeo = listNeocortexMemories(user.id, 40);
  const catalog = entries.map((e, i) => ({
    index: i,
    id: e.id,
    created_at: e.created_at,
    content: String(e.content || '').slice(0, 200),
  }));

  const lang = user.ui_lang === 'en' ? 'en' : 'zh';
  const name = user.name || (lang === 'en' ? 'the user' : '用户');

  const { text } = await callDeepSeek([
    {
      role: 'system',
      content: lang === 'en'
        ? `You consolidate episodic memories into stable understanding about ${name}.
Find themes that appear at least ${MIN_TOPIC_OCCURRENCES} times across the entries (same topic/concern, not exact wording).
Output JSON only:
{"patterns":[{"theme":"short label","statement":"one stable sentence about ${name}","source_indices":[0,1,2]}]}
Rules:
- Only patterns with >= ${MIN_TOPIC_OCCURRENCES} distinct entries
- statement = generalized fact/feeling, not a quote
- No reply-speed analysis, no session summaries
- Max 4 patterns; empty array if none qualify`
        : `你将 episodic 记忆整合成关于${name}的稳定理解。
找出在条目中出现至少 ${MIN_TOPIC_OCCURRENCES} 次的同一主题/模式（话题相同即可，不要求措辞一样）。
只输出 JSON：
{"patterns":[{"theme":"短标签","statement":"一句关于${name}的稳定理解","source_indices":[0,1,2]}]}
规则：
- 仅保留 >= ${MIN_TOPIC_OCCURRENCES} 条条目支撑的模式
- statement 是概括性理解，不是原话
- 禁止分析回复速度、禁止会话总结式内容
- 最多 4 条；没有则 patterns 为空数组`,
    },
    { role: 'user', content: JSON.stringify(catalog, null, 2) },
  ], { maxTokens: 520, temperature: 0.25, source: 'cognifold_neocortex' });

  const parsed = parseJsonBlock(text);
  const patterns = (parsed?.patterns || []).filter(
    (p) => Array.isArray(p.source_indices) && p.source_indices.length >= MIN_TOPIC_OCCURRENCES,
  );

  if (!patterns.length) {
    return { created: 0, skipped: 'no_patterns', scanned: entries.length };
  }

  let created = 0;
  for (const pattern of patterns.slice(0, 4)) {
    const statement = String(pattern.statement || '').trim();
    if (!statement || statement.length < 4) continue;

    const dup = existingNeo.some((neo) => overlapRatio(neo.content, statement) >= 0.55);
    if (dup) continue;

    const sources = pattern.source_indices
      .map((idx) => catalog[idx])
      .filter(Boolean);
    if (sources.length < MIN_TOPIC_OCCURRENCES) continue;

    const sourceMeta = sources.map((s) => ({ id: s.id, created_at: s.created_at }));
    const body = `${statement}${formatSourceTrail(sources)}`;

    addMemory(user.id, {
      content: body,
      category: 'deep',
      tags: [
        LAYER_NEOCORTEX,
        'cognifold',
        `theme:${String(pattern.theme || 'pattern').slice(0, 40)}`,
        `source_count:${sources.length}`,
      ],
      source_refs: sourceMeta,
      meta: { source: 'cognifold' },
      epistemic_mode: 'inference',
    });

    markHippocampusFolded(user.id, sources.map((s) => s.id));
    existingNeo.push({ content: body });
    created += 1;
  }

  return { created, scanned: entries.length, patterns: patterns.length };
}

export async function crystallizePrefrontalIntents(user) {
  const neocortex = listNeocortexMemories(user.id, 12);
  if (neocortex.length < 1) {
    return { created: 0, skipped: 'no_neocortex' };
  }

  purgeExpiredPrefrontalIntents(user.id);

  const lang = user.ui_lang === 'en' ? 'en' : 'zh';
  const name = user.name || (lang === 'en' ? 'the user' : '用户');
  const aiName = user.ai_name || 'Duck';
  const existing = getActivePrefrontalIntents(user.id);

  const neoBlock = neocortex.map((m) => `- ${m.content}`).join('\n');
  const existingBlock = existing.length
    ? existing.map((e) => `- ${e.content}`).join('\n')
    : (lang === 'en' ? '(none)' : '（无）');

  const { text } = await callDeepSeek([
    {
      role: 'system',
      content: lang === 'en'
        ? `You are ${aiName}. From stable understanding about ${name}, derive 0-2 intents worth raising in a future chat or roam message within 7 days.
Output JSON only: {"intents":[{"intent":"what to naturally bring up later","rationale":"why it matters"}]}
Rules:
- Natural follow-ups only (care, plans, unfinished threads) — not surveillance
- Do not duplicate existing active intents
- No guilt, no "you haven't replied"
- Empty array if nothing worth storing`
        : `你是${aiName}。基于对${name}的稳定理解，生成 0-2 条「未来 7 天内值得自然提起」的意图。
只输出 JSON：{"intents":[{"intent":"下次聊天时可以…","rationale":"简短原因"}]}
规则：
- 只能是自然的关心/跟进/计划类，禁止监控式观察
- 不要重复已有活跃意图
- 禁止愧疚、禁止「你怎么不回」
- 没有合适的就返回空数组`,
    },
    {
      role: 'user',
      content: lang === 'en'
        ? `Stable understanding:\n${neoBlock}\n\nActive intents:\n${existingBlock}`
        : `稳定理解：\n${neoBlock}\n\n已有意图：\n${existingBlock}`,
    },
  ], { maxTokens: 360, temperature: 0.35, source: 'cognifold_prefrontal' });

  const parsed = parseJsonBlock(text);
  const intents = (parsed?.intents || []).slice(0, 2);
  let created = 0;

  for (const item of intents) {
    const intent = String(item.intent || '').trim();
    if (!intent || intent.length < 6) continue;
    const dup = existing.some((e) => overlapRatio(e.content, intent) >= 0.6);
    if (dup) continue;
    addPrefrontalIntent(user.id, intent, {
      rationale: String(item.rationale || '').slice(0, 120),
      source: 'cognifold',
    });
    existing.push({ content: intent });
    created += 1;
  }

  return { created, neocortex_used: neocortex.length };
}

export async function runCogniFoldConsolidation(userId, options = {}) {
  const user = typeof userId === 'object' ? userId : getUser(userId);
  if (!user?.id) return { ok: false, reason: 'no_user' };

  purgeExpiredPrefrontalIntents(user.id);

  const neoResult = await consolidateHippocampusToNeocortex(user);
  const prefrontalResult = await crystallizePrefrontalIntents(user);

  return {
    ok: true,
    reason: options.reason || 'manual',
    neocortex: neoResult,
    prefrontal: prefrontalResult,
  };
}

export function runDailyCogniFoldForUser(user) {
  if (!shouldRunDailyCogniFold(user)) return Promise.resolve(null);
  return runCogniFoldConsolidation(user, { reason: 'daily' }).catch((e) => {
    console.warn('[cognifold-daily]', user.id, e.message);
    return null;
  });
}

/** Backfill hippocampus tag on legacy daily entries (read-only scan, optional one-time). */
export function backfillHippocampusTags(userId) {
  const rows = db.prepare(`
    SELECT id, tags, category FROM memory_entries
    WHERE user_id = ? AND category = 'daily' AND status = 'active'
  `).all(userId);

  let updated = 0;
  for (const row of rows) {
    const tags = parseMemoryTags(row);
    if (hasMemoryTag(tags, LAYER_HIPPOCAMPUS) || hasMemoryTag(tags, LAYER_NEOCORTEX)) continue;
    tags.push(LAYER_HIPPOCAMPUS);
    db.prepare('UPDATE memory_entries SET tags = ? WHERE id = ?').run(JSON.stringify(tags), row.id);
    updated += 1;
  }
  return updated;
}
