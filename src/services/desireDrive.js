/**
 * 起维系统 — CARROT DUCK 研究原型
 * 七维驱动条 + 念头池 + 召唤力 → 漫游行动
 */
import { v4 as uuid } from 'uuid';
import { db, getUser, saveUser } from '../db.js';
import { getDueSoonForDutyBump } from './calendarContext.js';
import { setNoProactive24h } from './conversationMode.js';

export const DRIVE_KEYS = [
  'curiosity',
  'reflection',
  'social',
  'duty',
  'attachment',
  'stress',
  'fatigue',
];

const BASE_DRIVE = 0.5;
const FIXATION_BOOST = 0.35;
const FLASH_DECAY = 0.82;
const FIXATION_GROW = 1.10;
const FIXATION_THRESHOLD = 0.80;
const FATIGUE_FORCE_IDLE = 0.72;
const SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000;

const DRIVE_ACTION_MAP = {
  curiosity: 'web_search',
  reflection: 'diary',
  social: 'message',
  duty: 'idle',
  attachment: 'message',
  stress: 'vent',
};

const ACTION_FALLBACK = {
  web_search: { curiosity: 0.48 },
  diary: { reflection: 0.45 },
  message: { social: 0.48, attachment: 0.78 },
  vent: { stress: 0.45 },
  idle: { attachment: 0.58, duty: 0.80 },
  associate: { curiosity: 0.85 },
  wonder: { attachment: 0.88 },
  review_memory: { reflection: 0.90 },
  introspect: { reflection: 0.88, stress: 0.85 },
};

const DRIVE_LABELS_ZH = {
  curiosity: '好奇',
  reflection: '沉淀',
  social: '社交',
  duty: '记挂',
  attachment: '依恋',
  stress: '压力',
  fatigue: '疲惫',
};

const KEYWORD_DRIVE_HINTS = [
  { re: /睡不着|失眠|睡眠|熬夜|好累|累死了|疲惫|困/i, drive: 'fatigue', bump: 0.12, thought: '睡眠/疲惫' },
  { re: /妈妈|爸爸|家人|父母|回家|家里/i, drive: 'attachment', bump: 0.1, thought: '家人' },
  { re: /考试|面试|DDL|deadline|待办|还没做|记得/i, drive: 'duty', bump: 0.12, thought: '未完成的事' },
  { re: /难过|焦虑|压力|烦|崩溃|生气|委屈/i, drive: 'stress', bump: 0.14, thought: '情绪压力' },
  { re: /想你|好久不见|在吗|聊|说说/i, drive: 'social', bump: 0.1, thought: '想说话' },
  { re: /电影|书|新闻|为什么|怎么回事|好奇/i, drive: 'curiosity', bump: 0.1, thought: '外面的事' },
  { re: /日记|回忆|以前|想起|感悟/i, drive: 'reflection', bump: 0.1, thought: '想沉淀' },
];

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function personalityBaselines(keywords = {}) {
  const k = keywords || {};
  const drives = Object.fromEntries(DRIVE_KEYS.map((key) => [key, BASE_DRIVE]));
  if (k.energy === 'vibrant') drives.curiosity = clamp01(BASE_DRIVE + 0.15);
  if (k.distance === 'close') drives.attachment = clamp01(BASE_DRIVE + 0.2);
  if (k.initiative === 'proactive') drives.social = clamp01(BASE_DRIVE + 0.15);
  if (k.energy === 'steady') drives.fatigue = clamp01(BASE_DRIVE - 0.05);
  return drives;
}

function fatigueDecayRate(keywords = {}) {
  return keywords?.energy === 'steady' ? 0.9985 : 0.996;
}

export function createInitialDesireState(keywords = {}) {
  return {
    drives: personalityBaselines(keywords),
    thoughts: [],
    updated_at: new Date().toISOString(),
  };
}

function parseDesireState(row) {
  if (!row?.desire_state) return null;
  try {
    const parsed = JSON.parse(row.desire_state);
    if (!parsed?.drives) return null;
    for (const key of DRIVE_KEYS) {
      if (typeof parsed.drives[key] !== 'number') parsed.drives[key] = BASE_DRIVE;
    }
    parsed.thoughts = Array.isArray(parsed.thoughts) ? parsed.thoughts : [];
    return parsed;
  } catch {
    return null;
  }
}

export function getDesireState(user) {
  const fromUser = user?.desire_state;
  if (fromUser?.drives) {
    return {
      drives: { ...fromUser.drives },
      thoughts: [...(fromUser.thoughts || [])],
      updated_at: fromUser.updated_at || new Date().toISOString(),
    };
  }
  const row = db.prepare('SELECT desire_state FROM users WHERE id = ?').get(user?.id);
  return parseDesireState(row) || createInitialDesireState(user?.keywords);
}

export function saveDesireState(userId, state) {
  const payload = {
    drives: state.drives,
    thoughts: (state.thoughts || []).slice(-24),
    updated_at: new Date().toISOString(),
  };
  db.prepare('UPDATE users SET desire_state = ? WHERE id = ?').run(JSON.stringify(payload), userId);
  return payload;
}

function ensureDesireTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS desire_snapshots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      drives TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_desire_snap_user ON desire_snapshots(user_id, created_at);

    CREATE TABLE IF NOT EXISTS desire_action_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      drive_key TEXT,
      action TEXT,
      score REAL,
      intent_text TEXT,
      thoughts_snapshot TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_desire_action_user ON desire_action_logs(user_id, created_at);
  `);
}

ensureDesireTables();

function lastSnapshotAt(userId) {
  const row = db.prepare(`
    SELECT created_at FROM desire_snapshots WHERE user_id = ?
    ORDER BY datetime(created_at) DESC LIMIT 1
  `).get(userId);
  return row?.created_at ? new Date(row.created_at).getTime() : 0;
}

function maybeSnapshot(userId, drives) {
  const now = Date.now();
  if (now - lastSnapshotAt(userId) < SNAPSHOT_INTERVAL_MS) return;
  db.prepare(`
    INSERT INTO desire_snapshots (id, user_id, drives, created_at)
    VALUES (?, ?, ?, ?)
  `).run(uuid(), userId, JSON.stringify(drives), new Date().toISOString());
}

function tickThoughts(thoughts) {
  const next = [];
  for (const t of thoughts || []) {
    let strength = Number(t.strength) || 0.4;
    let kind = t.kind || 'flash';
    const fed = Number(t.fed_count) || 0;
    if (fed > 3) continue;

    if (kind === 'fixation') {
      strength = clamp01(strength * FIXATION_GROW);
    } else {
      strength = clamp01(strength * FLASH_DECAY);
    }
    if (strength < 0.08) continue;
    if (kind === 'flash' && strength >= FIXATION_THRESHOLD) kind = 'fixation';
    next.push({ ...t, strength, kind });
  }
  return next.slice(-20);
}

function decayDrives(drives, baselines, keywords) {
  const next = { ...drives };
  const fatigueRate = fatigueDecayRate(keywords);
  for (const key of DRIVE_KEYS) {
    const base = baselines[key] ?? BASE_DRIVE;
    const rate = key === 'fatigue' ? fatigueRate : 0.992;
    next[key] = clamp01(base + (next[key] - base) * rate);
  }
  return next;
}

export function addThought(state, { text, drive, strength = 0.45, source = 'event' }) {
  const trimmed = String(text || '').trim().slice(0, 120);
  if (!trimmed || !DRIVE_KEYS.includes(drive)) return state;
  const thoughts = [...(state.thoughts || [])];
  const existing = thoughts.find((t) => t.drive === drive && t.text === trimmed);
  if (existing) {
    existing.fed_count = (existing.fed_count || 0) + 1;
    existing.strength = clamp01((existing.strength || 0.4) + 0.08);
    existing.kind = existing.strength >= FIXATION_THRESHOLD ? 'fixation' : (existing.kind || 'flash');
  } else {
    thoughts.push({
      id: uuid(),
      text: trimmed,
      drive,
      strength: clamp01(strength),
      born_at: new Date().toISOString(),
      fed_count: 0,
      kind: 'flash',
      source,
    });
  }
  return { ...state, thoughts: tickThoughts(thoughts) };
}

export function bumpDrive(state, drive, delta) {
  if (!DRIVE_KEYS.includes(drive)) return state;
  const drives = { ...state.drives };
  drives[drive] = clamp01((drives[drive] || BASE_DRIVE) + delta);
  return { ...state, drives };
}

export function ingestThoughtsFromUserMessage(user, text) {
  if (!user?.id || !text) return;
  let state = getDesireState(user);
  const content = String(text).slice(0, 500);
  for (const hint of KEYWORD_DRIVE_HINTS) {
    if (hint.re.test(content)) {
      state = bumpDrive(state, hint.drive, hint.bump);
      state = addThought(state, { text: hint.thought, drive: hint.drive, strength: 0.42 + hint.bump });
    }
  }
  const sinceChat = (Date.now() - new Date(user.last_active || user.created_at).getTime()) / 60000;
  if (sinceChat > 180) {
    state = bumpDrive(state, 'attachment', 0.06);
    state = bumpDrive(state, 'social', 0.05);
  }
  saveDesireState(user.id, state);
}

export function ingestThoughtFromRoam(user, { thoughts, action, rawContent }) {
  if (!user?.id) return;
  const snippet = String(thoughts || rawContent || '').trim().slice(0, 100);
  if (!snippet) return;
  let state = getDesireState(user);
  const drive = action === 'web_search' ? 'curiosity'
    : action === 'diary' ? 'reflection'
      : action === 'message' ? 'social'
        : action === 'vent' ? 'stress'
          : 'reflection';
  state = addThought(state, { text: snippet, drive, strength: 0.5, source: 'roam' });
  if (action === 'web_search') state = bumpDrive(state, 'curiosity', 0.08);
  if (action === 'diary') state = bumpDrive(state, 'reflection', 0.06);
  saveDesireState(user.id, state);
}

export function ingestThoughtFromExplore(user, summary) {
  if (!user?.id || !summary) return;
  let state = getDesireState(user);
  state = addThought(state, {
    text: String(summary).slice(0, 80),
    drive: 'curiosity',
    strength: 0.55,
    source: 'explore',
  });
  state = bumpDrive(state, 'curiosity', 0.1);
  saveDesireState(user.id, state);
}

export function desireHeartbeat(user) {
  if (!user?.id) return getDesireState(user);
  const baselines = personalityBaselines(user.keywords);
  let state = getDesireState(user);
  state.drives = decayDrives(state.drives, baselines, user.keywords);
  state.thoughts = tickThoughts(state.thoughts);
  state.updated_at = new Date().toISOString();
  saveDesireState(user.id, state);
  maybeSnapshot(user.id, state.drives);
  return state;
}

function strongestFixationForDrive(thoughts, drive) {
  const list = (thoughts || []).filter((t) => t.drive === drive);
  if (!list.length) return 0;
  return Math.max(...list.map((t) => Number(t.strength) || 0));
}

export function computeSummonScores(state) {
  const drives = state.drives || {};
  const thoughts = state.thoughts || [];
  const scores = {};
  for (const key of DRIVE_KEYS) {
    if (key === 'fatigue') continue;
    scores[key] = (drives[key] || BASE_DRIVE) + FIXATION_BOOST * strongestFixationForDrive(thoughts, key);
  }
  return scores;
}

export function pickDriveRoamAction(user, state, { topicDampen = 1 } = {}) {
  const drives = state.drives || {};
  if ((drives.fatigue || 0) >= FATIGUE_FORCE_IDLE) {
    return {
      action: 'idle',
      driveKey: 'fatigue',
      score: drives.fatigue,
      intent: '有点累，就静静待着',
      forcedFatigue: true,
    };
  }

  const scores = computeSummonScores(state);
  if (topicDampen < 1) {
    for (const key of Object.keys(scores)) {
      // attachment drive (「我们」thread) 不受反重复限制
      if (key !== 'attachment') scores[key] *= topicDampen;
    }
  }
  let bestKey = 'curiosity';
  let bestScore = -1;
  for (const [key, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  const action = DRIVE_ACTION_MAP[bestKey] || 'idle';
  const topThoughts = (state.thoughts || [])
    .filter((t) => t.drive === bestKey)
    .sort((a, b) => (b.strength || 0) - (a.strength || 0))
    .slice(0, 1);
  const intent = topThoughts[0]?.text
    || (bestKey === 'duty' ? '还记挂着那件事' : DRIVE_LABELS_ZH[bestKey] || bestKey);

  return {
    action,
    driveKey: bestKey,
    score: bestScore,
    intent,
    forcedFatigue: false,
  };
}

export function applyDriveFallback(user, action) {
  if (!user?.id) return;
  const multipliers = ACTION_FALLBACK[action] || ACTION_FALLBACK.idle;
  const state = getDesireState(user);
  const drives = { ...state.drives };
  for (const [key, mul] of Object.entries(multipliers)) {
    if (DRIVE_KEYS.includes(key)) drives[key] = clamp01((drives[key] || BASE_DRIVE) * mul);
  }
  saveDesireState(user.id, { ...state, drives });
}

export function logDesireAction(userId, { driveKey, action, score, intent, thoughts }) {
  const top = (thoughts || []).slice(0, 3).map((t) => `${t.kind === 'fixation' ? '执念' : '闪念'}:${t.text}`).join(' | ');
  db.prepare(`
    INSERT INTO desire_action_logs (id, user_id, drive_key, action, score, intent_text, thoughts_snapshot, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuid(), userId, driveKey || '', action || '', score || 0, intent || '', top, new Date().toISOString());
}

export function buildDesirePromptBlock(user, state, summon) {
  const drives = state.drives || {};
  const lang = user?.ui_lang === 'en' ? 'en' : 'zh';
  const topThoughts = [...(state.thoughts || [])]
    .sort((a, b) => (b.strength || 0) - (a.strength || 0))
    .slice(0, 3)
    .map((t) => `${t.kind === 'fixation' ? '执念' : '闪念'}「${t.text}」(${(t.strength || 0).toFixed(2)})`)
    .join('；') || (lang === 'en' ? '(none)' : '（暂无）');

  if (lang === 'en') {
    return `[Duck inner state]
Most drawn to: ${summon.intent} (${summon.driveKey} drive, score ${(summon.score || 0).toFixed(2)})
Floating thoughts: ${topThoughts}
Drives: curiosity ${drives.curiosity?.toFixed(2)} / social ${drives.social?.toFixed(2)} / attachment ${drives.attachment?.toFixed(2)} / fatigue ${drives.fatigue?.toFixed(2)}`;
  }

  return `[Duck此刻内心]
最想做的事：${summon.intent}（${DRIVE_LABELS_ZH[summon.driveKey] || summon.driveKey}驱动，score ${(summon.score || 0).toFixed(2)}）
飘着的念头：${topThoughts}
驱动状态：curiosity ${drives.curiosity?.toFixed(2)} / social ${drives.social?.toFixed(2)} / attachment ${drives.attachment?.toFixed(2)} / fatigue ${drives.fatigue?.toFixed(2)}`;
}

export function getDesireAdminData(userId, { snapshotLimit = 120, logLimit = 40 } = {}) {
  const user = getUser(userId);
  if (!user) return null;
  const state = getDesireState(user);
  const snapshots = db.prepare(`
    SELECT created_at, drives FROM desire_snapshots
    WHERE user_id = ? ORDER BY datetime(created_at) ASC LIMIT ?
  `).all(userId, snapshotLimit).map((row, i) => {
    let drives = {};
    try { drives = JSON.parse(row.drives); } catch { drives = {}; }
    return { index: i + 1, created_at: row.created_at, ...drives };
  });

  const actionLogs = db.prepare(`
    SELECT * FROM desire_action_logs WHERE user_id = ?
    ORDER BY datetime(created_at) DESC LIMIT ?
  `).all(userId, logLimit);

  return {
    drives: state.drives,
    thoughts: state.thoughts,
    updated_at: state.updated_at,
    snapshots,
    action_logs: actionLogs,
    drive_labels: DRIVE_LABELS_ZH,
    drive_keys: DRIVE_KEYS,
  };
}

export function initUserDesireState(user) {
  if (!user?.id) return;
  const existing = db.prepare('SELECT desire_state FROM users WHERE id = ?').get(user.id);
  if (existing?.desire_state) return;
  saveDesireState(user.id, createInitialDesireState(user.keywords));
}

export function bumpDutyFromCalendar(user) {
  if (!user?.id) return;
  const soon = getDueSoonForDutyBump(user, 1);
  if (!soon.length) return;
  const state = bumpDrive(getDesireState(user), 'duty', 0.12);
  saveDesireState(user.id, state);
}

export function applyPresenceChatEffects(user) {
  if (!user?.id) return;
  const state = bumpDrive(getDesireState(user), 'attachment', 0.05);
  saveDesireState(user.id, state);
  user.no_proactive_until = setNoProactive24h(user);
  saveUser(user);
}
