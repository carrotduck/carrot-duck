import { v4 as uuid } from 'uuid';
import { db, sqliteVectorReady } from '../db.js';
import { callDeepSeek } from './deepseek.js';
import { getBoundaryControl } from './relationalState.js';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from '../config.js';
import { embedQuery, embedTexts, embeddingsConfigured } from './embeddings.js';
import {
  classifyMemoryMeta,
  detectQueryThread,
  heuristicThread,
  inferConfidence,
  normalizeConfidence,
  normalizeTopicKey,
  normalizeThread,
} from './memoryMeta.js';

export const LAYER_HIPPOCAMPUS = 'layer:hippocampus';
export const LAYER_NEOCORTEX = 'layer:neocortex';
export const TAG_FOLDED_NEOCORTEX = 'folded:neocortex';

const THREAD_BOOST = 0.35;

function tokenize(text) {
  const value = String(text || '').toLowerCase().normalize('NFKC');
  const tokens = [];
  const latin = value.match(/[a-z0-9]{2,}/g) || [];
  tokens.push(...latin);
  const hanRuns = value.match(/[\p{Script=Han}]{2,}/gu) || [];
  for (const run of hanRuns) {
    const maxN = run.length <= 4 ? 2 : 3;
    for (let size = 2; size <= maxN; size += 1) {
      for (let i = 0; i <= run.length - size; i += 1) {
        tokens.push(run.slice(i, i + size));
      }
    }
  }
  return [...new Set(tokens)].slice(0, 160);
}

function overlapScore(queryTokens, contentTokens) {
  if (!queryTokens.length || !contentTokens.length) return 0;
  const set = new Set(contentTokens);
  let hits = 0;
  for (const t of queryTokens) if (set.has(t)) hits += 1;
  return hits / queryTokens.length;
}

export function parseMemoryTags(row) {
  const raw = row?.tags;
  if (Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw || '[]');
  } catch {
    return [];
  }
}

function parseSourceRefs(row) {
  try {
    const parsed = JSON.parse(row?.source_refs_json || '[]');
    if (Array.isArray(parsed)) return parsed;
  } catch { /* legacy row */ }
  const legacy = parseMemoryTags(row).find((tag) => String(tag).startsWith('source_refs:'));
  if (!legacy) return [];
  try { return JSON.parse(String(legacy).slice('source_refs:'.length)); } catch { return []; }
}

function resolveEpistemicMode({ source, userExplicit, fromRoam, epistemicMode }) {
  if (['grounded', 'inference', 'imagination'].includes(epistemicMode)) return epistemicMode;
  if (userExplicit || source === 'user-stated' || source === 'tool' || source === 'vision') return 'grounded';
  if (fromRoam || source === 'roam') return 'imagination';
  return 'inference';
}

export function hasMemoryTag(tags, tag) {
  return (tags || []).includes(tag);
}

function isHippocampusRow(row) {
  const tags = parseMemoryTags(row);
  if (hasMemoryTag(tags, LAYER_NEOCORTEX)) return false;
  if (hasMemoryTag(tags, LAYER_HIPPOCAMPUS)) return true;
  return row.category === 'daily';
}

function isNeocortexRow(row) {
  const tags = parseMemoryTags(row);
  return row.category === 'deep' && hasMemoryTag(tags, LAYER_NEOCORTEX);
}

function normalizeTags(category, tags = []) {
  const next = [...tags];
  if (category === 'daily' && !next.includes(LAYER_NEOCORTEX) && !next.includes(LAYER_HIPPOCAMPUS)) {
    next.push(LAYER_HIPPOCAMPUS);
  }
  return next;
}

function rowToMemory(row) {
  const tags = parseMemoryTags(row);
  return {
    id: row.id,
    content: row.content,
    category: row.category,
    tags,
    thread: normalizeThread(row.thread || 'daily'),
    topic_key: row.topic_key || null,
    memory_key: row.memory_key || null,
    confidence: row.confidence || 'medium',
    source_type: row.source_type || 'legacy',
    source_ref: row.source_ref || null,
    source_refs: parseSourceRefs(row),
    epistemic_mode: row.epistemic_mode || 'inference',
    valid_from: row.valid_from || row.created_at,
    valid_to: row.valid_to || null,
    status: row.status || 'active',
    superseded_by: row.superseded_by || null,
    updated_at: row.updated_at || row.created_at,
    created_at: row.created_at,
    access_count: row.access_count,
    layer: hasMemoryTag(tags, LAYER_NEOCORTEX) ? 'neocortex' : (isHippocampusRow(row) ? 'hippocampus' : row.category),
  };
}

function scoreMemoryRow(row, queryTokens, queryThread) {
  const contentTokens = tokenize(row.content);
  const lexical = overlapScore(queryTokens, contentTokens);
  if (lexical <= 0) return 0;
  const createdMs = new Date(row.created_at || 0).getTime();
  const ageDays = Number.isFinite(createdMs) ? Math.max(0, (Date.now() - createdMs) / 86400000) : 365;
  const recency = Math.max(0, 0.16 * Math.pow(0.5, ageDays / 45));
  let score = lexical * 2.3
    + Math.min(row.access_count || 0, 10) * 0.015
    + recency;
  const rowThread = row.thread || heuristicThread(row.content);
  if (queryThread && rowThread === queryThread) score += THREAD_BOOST;
  if (row.confidence === 'high') score += 0.12;
  if (row.confidence === 'low') score *= 0.72;
  return score;
}

function bumpMemoryAccess(rowIds) {
  const now = new Date().toISOString();
  for (const id of rowIds) {
    db.prepare('UPDATE memory_entries SET access_count = access_count + 1, last_accessed = ? WHERE id = ?')
      .run(now, id);
  }
}

function vectorBuffer(vector) {
  return Buffer.from(new Float32Array(vector).buffer);
}

function storeMemoryVectors(rows, vectors) {
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO memory_vectors (memory_id, user_id, embedding, model, dimensions, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(memory_id) DO UPDATE SET
      embedding = excluded.embedding,
      model = excluded.model,
      dimensions = excluded.dimensions,
      updated_at = excluded.updated_at
  `);
  const save = db.transaction(() => {
    rows.forEach((row, index) => insert.run(
      row.id,
      row.user_id,
      vectorBuffer(vectors[index]),
      EMBEDDING_MODEL,
      EMBEDDING_DIMENSIONS,
      now,
    ));
  });
  save();
}

export async function ensureMemoryEmbedding(memoryId) {
  if (!sqliteVectorReady || !embeddingsConfigured()) return false;
  const row = db.prepare("SELECT id, user_id, content FROM memory_entries WHERE id = ? AND status = 'active'").get(memoryId);
  if (!row) return false;
  const [vector] = await embedTexts([row.content]);
  storeMemoryVectors([row], [vector]);
  return true;
}

export async function backfillMemoryEmbeddings(batchSize = 10) {
  if (!sqliteVectorReady || !embeddingsConfigured()) return { embedded: 0, ready: false };
  let embedded = 0;
  while (true) {
    const rows = db.prepare(`
      SELECT m.id, m.user_id, m.content
      FROM memory_entries m
      LEFT JOIN memory_vectors v ON v.memory_id = m.id
      WHERE v.memory_id IS NULL AND m.status = 'active'
      ORDER BY m.created_at ASC LIMIT ?
    `).all(Math.max(1, Math.min(10, batchSize)));
    if (!rows.length) break;
    const vectors = await embedTexts(rows.map((row) => row.content));
    storeMemoryVectors(rows, vectors);
    embedded += rows.length;
    if (rows.length < batchSize) break;
  }
  return { embedded, ready: true };
}

export function addMemory(userId, {
  content,
  category = 'daily',
  emotional_valence = 0,
  tags = [],
  source_refs = null,
  thread = null,
  topic_key = null,
  memory_key = null,
  confidence = null,
  epistemic_mode = null,
  meta = {},
} = {}) {
  const id = uuid();
  const now = new Date().toISOString();
  const normalizedTags = normalizeTags(category, [...tags]);
  const resolvedThread = normalizeThread(thread || heuristicThread(content));
  const resolvedTopic = normalizeTopicKey(topic_key);
  const resolvedMemoryKey = normalizeTopicKey(memory_key);
  const resolvedConfidence = normalizeConfidence(
    confidence || inferConfidence({
      source: meta.source,
      userExplicit: meta.userExplicit,
      fromRoam: meta.fromRoam,
    }),
  );
  const sourceType = String(meta.source || 'chat').slice(0, 40);
  const sourceRef = String(meta.sourceRef || meta.messageId || '').slice(0, 160) || null;
  const refs = Array.isArray(source_refs) ? source_refs.slice(0, 12) : [];
  const epistemicMode = resolveEpistemicMode({
    source: sourceType,
    userExplicit: meta.userExplicit,
    fromRoam: meta.fromRoam,
    epistemicMode: epistemic_mode,
  });

  const insert = db.transaction(() => {
    if (resolvedMemoryKey) {
      db.prepare(`
        UPDATE memory_entries
        SET status = 'archived', valid_to = ?, archived_at = ?, superseded_by = ?, updated_at = ?
        WHERE user_id = ? AND memory_key = ? AND status = 'active'
      `).run(now, now, id, now, userId, resolvedMemoryKey);
    }
    db.prepare(`
      INSERT INTO memory_entries (
        id, user_id, content, category, emotional_valence, tags, thread, topic_key,
        memory_key, confidence, source_type, source_ref, source_refs_json,
        epistemic_mode, valid_from, status, updated_at, access_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, ?)
    `).run(
      id, userId, content, category, emotional_valence,
      JSON.stringify(normalizedTags), resolvedThread, resolvedTopic, resolvedMemoryKey,
      resolvedConfidence, sourceType, sourceRef, JSON.stringify(refs), epistemicMode,
      now, now, now,
    );
  });
  insert();
  classifyMemoryMeta(content, meta).then(({ thread: t, topic_key: inferredTopic, confidence: c }) => {
    db.prepare("UPDATE memory_entries SET thread = ?, topic_key = COALESCE(topic_key, ?), confidence = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'active'")
      .run(normalizeThread(t), normalizeTopicKey(inferredTopic), normalizeConfidence(c), new Date().toISOString(), id, userId);
  }).catch(() => {});
  ensureMemoryEmbedding(id).catch((error) => console.warn('[memory-embedding]', id, error.message));
  return {
    id, content, category, tags: normalizedTags,
    thread: resolvedThread, topic_key: resolvedTopic, memory_key: resolvedMemoryKey,
    confidence: resolvedConfidence, source_type: sourceType, source_ref: sourceRef,
    source_refs: refs, epistemic_mode: epistemicMode, status: 'active',
    valid_from: now, updated_at: now, created_at: now,
  };
}

export function listHippocampusEntries(userId, { excludeFolded = false, limit = 80, withinDays = 30 } = {}) {
  const cutoff = new Date(Date.now() - withinDays * 86400000).toISOString();
  const rows = db.prepare(`
    SELECT * FROM memory_entries
    WHERE user_id = ? AND category = 'daily' AND status = 'active' AND datetime(created_at) >= datetime(?)
    ORDER BY datetime(created_at) DESC LIMIT ?
  `).all(userId, cutoff, limit);

  return rows
    .filter(isHippocampusRow)
    .filter((row) => {
      if (!excludeFolded) return true;
      return !hasMemoryTag(parseMemoryTags(row), TAG_FOLDED_NEOCORTEX);
    })
    .map(rowToMemory);
}

export function markHippocampusFolded(userId, entryIds) {
  for (const entryId of entryIds || []) {
    const row = db.prepare('SELECT tags FROM memory_entries WHERE id = ? AND user_id = ?').get(entryId, userId);
    if (!row) continue;
    const tags = parseMemoryTags(row);
    if (hasMemoryTag(tags, TAG_FOLDED_NEOCORTEX)) continue;
    tags.push(TAG_FOLDED_NEOCORTEX);
    db.prepare('UPDATE memory_entries SET tags = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(tags), entryId, userId);
  }
}

export function listNeocortexMemories(userId, limit = 12) {
  const rows = db.prepare(`
    SELECT * FROM memory_entries
    WHERE user_id = ? AND category = 'deep' AND status = 'active'
    ORDER BY datetime(created_at) DESC LIMIT ?
  `).all(userId, limit * 2);

  return rows.filter(isNeocortexRow).slice(0, limit).map(rowToMemory);
}

export function searchMemories(userId, query, limit = 5, { includeLowConfidence = true } = {}) {
  return recallMemories(userId, query, limit, { includeLowConfidence, bumpAccess: true });
}

export async function searchMemoriesHybrid(userId, query, limit = 5, { includeLowConfidence = true, explicit = false } = {}) {
  const lexical = recallMemories(userId, query, Math.max(limit, 10), {
    includeLowConfidence,
    bumpAccess: false,
    explicit,
  });
  const boundary = getBoundaryControl(userId);
  if (!explicit && boundary.memoryMode === 'blocked') return [];
  if (!sqliteVectorReady || !embeddingsConfigured()) {
    const fallback = lexical.slice(0, limit);
    bumpMemoryAccess(fallback.map((memory) => memory.id));
    return fallback;
  }
  const vectorCount = db.prepare('SELECT COUNT(*) AS count FROM memory_vectors WHERE user_id = ?').get(userId)?.count || 0;
  if (!vectorCount) {
    const fallback = lexical.slice(0, limit);
    bumpMemoryAccess(fallback.map((memory) => memory.id));
    return fallback;
  }

  try {
    const queryVector = await embedQuery(query);
    const semanticRows = db.prepare(`
      SELECT m.*, vec_distance_cosine(v.embedding, ?) AS distance
      FROM memory_vectors v
      JOIN memory_entries m ON m.id = v.memory_id
      WHERE v.user_id = ? AND m.category = 'daily' AND m.status = 'active'
      ORDER BY distance ASC LIMIT 20
    `).all(vectorBuffer(queryVector), userId);
    const merged = new Map();
    lexical.forEach((memory, index) => {
      merged.set(memory.id, { memory, score: 1.1 - index * 0.04, retrieval: ['lexical'] });
    });
    for (const row of semanticRows) {
      const similarity = Math.max(0, 1 - Number(row.distance || 0));
      if (similarity < 0.35) continue;
      if (!includeLowConfidence && row.confidence === 'low') continue;
      if (!explicit && boundary.memoryMode !== 'normal' && row.confidence === 'low') continue;
      const confidenceBoost = row.confidence === 'high' ? 0.12 : (row.confidence === 'low' ? -0.12 : 0);
      const score = similarity * 1.35 + confidenceBoost;
      const existing = merged.get(row.id);
      if (existing) {
        existing.score += score;
        existing.retrieval.push('semantic');
      } else {
        merged.set(row.id, { memory: rowToMemory(row), score, retrieval: ['semantic'] });
      }
    }
    let effectiveLimit = limit;
    if (!explicit && boundary.memoryMode === 'minimal') effectiveLimit = Math.min(1, limit);
    else if (!explicit && boundary.memoryMode === 'soft') effectiveLimit = Math.min(3, limit);
    const top = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, effectiveLimit);
    bumpMemoryAccess(top.map((item) => item.memory.id));
    return top.map((item) => ({ ...item.memory, retrieval: item.retrieval }));
  } catch (error) {
    console.warn('[memory-hybrid] semantic fallback:', error.message);
    const fallback = lexical.slice(0, limit);
    bumpMemoryAccess(fallback.map((memory) => memory.id));
    return fallback;
  }
}

export function recallMemories(userId, query, limit = 5, { includeLowConfidence = true, bumpAccess = true, thread = null, topic = null, explicit = false } = {}) {
  const boundary = getBoundaryControl(userId);
  let effectiveLimit = limit;
  let effectiveIncludeLow = includeLowConfidence;
  if (!explicit) {
    if (boundary.memoryMode === 'blocked') return [];
    if (boundary.memoryMode === 'minimal') {
      effectiveLimit = Math.min(effectiveLimit, 1);
      effectiveIncludeLow = false;
    } else if (boundary.memoryMode === 'soft') {
      effectiveLimit = Math.min(effectiveLimit, 3);
      effectiveIncludeLow = false;
    }
  }

  const rows = db.prepare(`
    SELECT * FROM memory_entries WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 200
  `).all(userId);

  const hippocampusRows = rows.filter(isHippocampusRow);

  // When thread is explicitly specified, prefer memories from that thread
  let candidateRows = hippocampusRows;
  if (topic) {
    const topicFiltered = hippocampusRows.filter((row) => row.topic_key === topic);
    if (topicFiltered.length) candidateRows = topicFiltered;
  } else if (thread) {
    const threadFiltered = hippocampusRows.filter((r) => (r.thread || 'daily') === thread);
    if (threadFiltered.length >= 2) candidateRows = threadFiltered;
  }

  const queryTokens = tokenize(query);
  const queryThread = thread || detectQueryThread(query);
  const scored = candidateRows.map((row) => ({
    row,
    score: scoreMemoryRow(row, queryTokens, queryThread),
  }));

  scored.sort((a, b) => b.score - a.score);
  const top = scored
    .filter((s) => s.score >= 0.2)
    .filter((s) => effectiveIncludeLow || s.row.confidence !== 'low')
    .slice(0, effectiveLimit);

  if (bumpAccess) bumpMemoryAccess(top.map((s) => s.row.id));
  return top.map((s) => rowToMemory(s.row));
}

export function searchCallbackMemories(userId, query, limit = 5) {
  return searchMemories(userId, query, limit, { includeLowConfidence: false });
}

export function contextHasLowConfidenceMemories(memories = []) {
  return (memories || []).some((m) => m.confidence === 'low');
}

export function getMemory(userId, memoryId) {
  const row = db.prepare('SELECT * FROM memory_entries WHERE id = ? AND user_id = ?').get(memoryId, userId);
  if (!row) return null;
  return {
    ...rowToMemory(row),
    emotional_valence: row.emotional_valence,
  };
}

export function updateMemory(userId, memoryId, { content, category, thread, confidence }) {
  const existing = getMemory(userId, memoryId);
  if (!existing || existing.status !== 'active') return null;
  const validCategories = new Set(['daily', 'deep', 'diary']);
  const nextContent = content !== undefined ? String(content).trim() : existing.content;
  if (!nextContent) return null;
  let nextCategory = existing.category;
  if (category !== undefined) {
    if (!validCategories.has(category)) return null;
    nextCategory = category;
  }
  if (content === undefined && category === undefined && thread === undefined && confidence === undefined) return existing;

  const versionKey = existing.memory_key || `memory:${memoryId}`;
  if (!existing.memory_key) {
    db.prepare('UPDATE memory_entries SET memory_key = ? WHERE id = ? AND user_id = ?').run(versionKey, memoryId, userId);
  }
  return addMemory(userId, {
    content: nextContent,
    category: nextCategory,
    emotional_valence: existing.emotional_valence || 0,
    tags: existing.tags || [],
    source_refs: existing.source_refs || [],
    thread: thread !== undefined ? normalizeThread(thread) : existing.thread,
    topic_key: existing.topic_key,
    memory_key: versionKey,
    confidence: confidence !== undefined ? normalizeConfidence(confidence) : existing.confidence,
    epistemic_mode: existing.epistemic_mode,
    meta: {
      source: 'admin-edit',
      sourceRef: memoryId,
      userExplicit: existing.epistemic_mode === 'grounded',
    },
  });
}

export function deleteMemory(userId, memoryId) {
  const now = new Date().toISOString();
  const r = db.prepare(`
    UPDATE memory_entries
    SET status = 'recycled', valid_to = COALESCE(valid_to, ?), archived_at = ?, updated_at = ?
    WHERE id = ? AND user_id = ? AND status = 'active'
  `).run(now, now, now, memoryId, userId);
  if (r.changes) db.prepare('DELETE FROM memory_vectors WHERE memory_id = ?').run(memoryId);
  return r.changes > 0;
}

export function restoreMemory(userId, memoryId) {
  const row = db.prepare("SELECT * FROM memory_entries WHERE id = ? AND user_id = ? AND status = 'recycled'").get(memoryId, userId);
  if (!row) return null;
  if (row.memory_key) {
    const newer = db.prepare("SELECT id FROM memory_entries WHERE user_id = ? AND memory_key = ? AND status = 'active' LIMIT 1")
      .get(userId, row.memory_key);
    if (newer) return null;
  }
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE memory_entries
    SET status = 'active', valid_to = NULL, archived_at = NULL, superseded_by = NULL, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(now, memoryId, userId);
  ensureMemoryEmbedding(memoryId).catch((error) => console.warn('[memory-embedding]', memoryId, error.message));
  return getMemory(userId, memoryId);
}

export function listMemoryRecycle(userId, limit = 100) {
  return db.prepare(`
    SELECT * FROM memory_entries
    WHERE user_id = ? AND status = 'recycled'
    ORDER BY datetime(archived_at) DESC LIMIT ?
  `).all(userId, Math.max(1, Math.min(200, Number(limit) || 100))).map(rowToMemory);
}

export function listMemories(userId, category) {
  let sql = "SELECT * FROM memory_entries WHERE user_id = ? AND status = 'active'";
  const params = [userId];
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  sql += ' ORDER BY created_at DESC LIMIT 100';
  return db.prepare(sql).all(...params).map(rowToMemory);
}

export function getPprFailurePatterns(userId) {
  return db.prepare('SELECT * FROM worldbook_entries WHERE user_id = ? AND keyword = ?').all(userId, 'ppr-failure-pattern');
}

export function getWorldbookMatches(userId, text) {
  const entries = db.prepare(`
    SELECT * FROM worldbook_entries
    WHERE user_id = ? AND keyword NOT IN ('ppr-failure-pattern', 'prefrontal-intent')
  `).all(userId);
  const lower = String(text || '').toLowerCase();
  return entries.filter((e) => lower.includes(String(e.keyword).toLowerCase()));
}

export async function maybeWriteMemoryFromChat(userId, userMessage, aiMessage, {
  userMessageId = null,
  aiMessageIds = [],
} = {}) {
  const remember = /记住|remember this|别忘了|记下来/i.test(userMessage);
  const emotional = /我哭了|好难过|好开心|太感动了|i'm crying|so happy|devastated/i.test(userMessage);
  if (!remember && !emotional) return null;

  const { text } = await callDeepSeek([
    { role: 'system', content: `Extract one concise memory from this exchange. JSON only:
{"content":"one sentence","memory_key":"stable concept key","topic_key":"short user-specific topic or null"}
memory_key should identify the fact that future updates would replace, for example paper-status or current-job. Do not store counts or frequency observations. Focus on meaningful facts and feelings.` },
    { role: 'user', content: `User: ${userMessage}\nAI: ${aiMessage}` },
  ], { maxTokens: 160, temperature: 0.25, source: 'memory_extract' });

  if (!text?.trim()) return null;
  let extracted = { content: text.trim(), memory_key: null, topic_key: null };
  try {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (match) extracted = { ...extracted, ...JSON.parse(match[0]) };
  } catch { /* use plain-text fallback */ }
  const memoryContent = String(extracted.content || '').trim();
  if (!memoryContent) return null;
  return addMemory(userId, {
    content: memoryContent,
    category: 'daily',
    tags: [
      LAYER_HIPPOCAMPUS,
      ...(remember ? ['user-requested'] : []),
      ...(emotional ? ['emotional'] : []),
    ],
    source_refs: [
      ...(userMessageId ? [{ type: 'user_message', id: userMessageId }] : []),
      ...(aiMessageIds || []).map((id) => ({ type: 'assistant_message', id })),
    ],
    memory_key: extracted.memory_key,
    topic_key: extracted.topic_key,
    meta: {
      source: remember ? 'user-stated' : 'chat',
      sourceRef: userMessageId,
      messageId: userMessageId,
      userExplicit: remember,
      fromRoam: false,
    },
    confidence: remember ? 'high' : 'medium',
  });
}
