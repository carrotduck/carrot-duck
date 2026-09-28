import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import * as sqliteVec from 'sqlite-vec';
import { DATA_DIR } from './config.js';

fs.mkdirSync(DATA_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, 'carrotduck.db');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
export let sqliteVectorReady = false;
try {
  sqliteVec.load(db);
  sqliteVectorReady = Boolean(db.prepare('SELECT vec_version() AS version').get()?.version);
} catch (error) {
  console.warn('[sqlite-vec] lexical memory fallback:', error.message);
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pronouns TEXT,
  ai_gender TEXT,
  ai_name TEXT DEFAULT 'Duck',
  keywords TEXT,
  big_five TEXT,
  big_five_history TEXT,
  voice_id TEXT,
  notify_keepalive INTEGER DEFAULT 1,
  notify_window_start INTEGER DEFAULT 8,
  notify_window_end INTEGER DEFAULT 1,
  created_at TEXT,
  last_active TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  ppr_tagged INTEGER DEFAULT 0,
  resonance_tagged INTEGER DEFAULT 0,
  ppr_event_type TEXT,
  source TEXT DEFAULT 'chat',
  consumed INTEGER DEFAULT 1,
  created_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS memory_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT DEFAULT 'daily',
  emotional_valence REAL,
  tags TEXT,
  embedding TEXT,
  access_count INTEGER DEFAULT 0,
  last_accessed TEXT,
  created_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ppr_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  ai_message_id TEXT,
  user_message_id TEXT,
  event_type TEXT,
  ai_ppr_content TEXT,
  user_resonance_content TEXT,
  user_marked INTEGER DEFAULT 0,
  created_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS keepalive_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT,
  thoughts TEXT,
  content TEXT,
  mode TEXT,
  created_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS worldbook_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS favorites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  message_id TEXT,
  content TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  created_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  due_date TEXT,
  due_time TEXT,
  created_by TEXT DEFAULT 'user',
  status TEXT DEFAULT 'pending',
  created_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_user ON memory_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_ppr_user ON ppr_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_keepalive_user ON keepalive_logs(user_id, created_at);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS relational_turn_signals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  message_id TEXT,
  valence TEXT,
  intensity TEXT,
  openness TEXT,
  ppr_hint TEXT,
  boundary_risk TEXT,
  strategy TEXT,
  confidence REAL,
  evidence TEXT,
  signal_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_relational_signals_user ON relational_turn_signals(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_relational_signals_hint ON relational_turn_signals(ppr_hint, boundary_risk, created_at);
`);



db.exec(`
CREATE TABLE IF NOT EXISTS pending_review (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  payload TEXT,
  status TEXT DEFAULT 'pending',
  source TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_pending_review_user ON pending_review(user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_pending_review_type ON pending_review(type, status, created_at);
`);

function addColumn(table, name, definition) {
  if (!/^[a-z_]+$/i.test(table) || !/^[a-z_]+$/i.test(name)) throw new Error('Unsafe migration identifier');
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((column) => column.name === name);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

[
  ['messages', 'metadata', 'TEXT'],
  ['users', 'ui_lang', "TEXT DEFAULT 'zh'"],
  ['users', 'timezone', "TEXT DEFAULT 'Asia/Shanghai'"],
  ['users', 'work_start', 'TEXT'],
  ['users', 'work_end', 'TEXT'],
  ['users', 'device_token', 'TEXT'],
  ['users', 'push_last_at', 'TEXT'],
  ['favorites', 'source', "TEXT DEFAULT 'manual'"],
  ['users', 'ui_theme', "TEXT DEFAULT 'auto'"],
  ['users', 'emotion_state', 'TEXT'],
  ['todos', 'reminded_at', 'TEXT'],
  ['users', 'notify_diary', 'INTEGER DEFAULT 1'],
  ['users', 'desire_state', 'TEXT'],
  ['memory_entries', 'thread', "TEXT DEFAULT 'daily'"],
  ['memory_entries', 'confidence', "TEXT DEFAULT 'medium'"],
  ['memory_entries', 'topic_key', 'TEXT'],
  ['memory_entries', 'memory_key', 'TEXT'],
  ['memory_entries', 'source_type', "TEXT DEFAULT 'legacy'"],
  ['memory_entries', 'source_ref', 'TEXT'],
  ['memory_entries', 'source_refs_json', "TEXT DEFAULT '[]'"],
  ['memory_entries', 'epistemic_mode', "TEXT DEFAULT 'inference'"],
  ['memory_entries', 'valid_from', 'TEXT'],
  ['memory_entries', 'valid_to', 'TEXT'],
  ['memory_entries', 'status', "TEXT DEFAULT 'active'"],
  ['memory_entries', 'superseded_by', 'TEXT'],
  ['memory_entries', 'updated_at', 'TEXT'],
  ['memory_entries', 'archived_at', 'TEXT'],
  ['todos', 'repeat_rule', 'TEXT'],
  ['users', 'calendar_duck_assist', 'INTEGER DEFAULT 0'],
  ['users', 'together_rain_until', 'TEXT'],
  ['messages', 'conversation_mode', 'TEXT'],
  ['users', 'no_proactive_until', 'TEXT'],
  ['ppr_events', 'affective_signal_id', 'TEXT'],
  ['ppr_events', 'affective_signal_json', 'TEXT'],
  ['ppr_events', 'boundary_risk', 'TEXT'],
  ['ppr_events', 'ppr_strategy', 'TEXT'],
  ['ppr_events', 'ppr_hint', 'TEXT'],
  ['users', 'auth_token_hash', 'TEXT'],
  ['users', 'recovery_code_hash', 'TEXT'],
  ['users', 'auth_migrated_at', 'TEXT'],
  ['messages', 'archived', 'INTEGER DEFAULT 0'],
  ['ppr_events', 'resolved_at', 'TEXT'],
  ['ppr_events', 'turn_id', 'TEXT'],
  ['ppr_events', 'model', 'TEXT'],
  ['ppr_events', 'app_version', 'TEXT'],
  ['ppr_events', 'policy_version', 'TEXT'],
  ['ppr_events', 'prompt_hash', 'TEXT'],
  ['ppr_events', 'model_run_id', 'TEXT'],
  ['ppr_events', 'reaction_signal_id', 'TEXT'],
  ['ppr_events', 'outcome_reason', 'TEXT'],
  ['ppr_events', 'outcome_confidence', 'REAL'],
  ['ppr_events', 'context_manifest_json', 'TEXT'],
].forEach(([table, name, definition]) => addColumn(table, name, definition));

db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_token ON users(auth_token_hash) WHERE auth_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_chat_feed ON messages(user_id, source, archived, created_at);
CREATE INDEX IF NOT EXISTS idx_ppr_ai_message ON ppr_events(ai_message_id);
CREATE INDEX IF NOT EXISTS idx_memory_active ON memory_entries(user_id, status, category, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_key ON memory_entries(user_id, memory_key, status, valid_from);
CREATE INDEX IF NOT EXISTS idx_memory_topic ON memory_entries(user_id, thread, topic_key, status, created_at);

CREATE TABLE IF NOT EXISTS relationship_profiles (
  user_id TEXT PRIMARY KEY,
  familiarity_score REAL DEFAULT 0,
  familiarity_stage TEXT DEFAULT 'STRANGER',
  friendship REAL DEFAULT 0,
  family_like REAL DEFAULT 0,
  romantic REAL DEFAULT 0,
  couple REAL DEFAULT 0,
  companion REAL DEFAULT 0,
  primary_direction TEXT DEFAULT 'UNDEFINED',
  direction_confidence REAL DEFAULT 0,
  evidence_json TEXT DEFAULT '[]',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS relationship_evidence (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  message_id TEXT,
  direction TEXT NOT NULL,
  polarity INTEGER DEFAULT 1,
  weight REAL DEFAULT 0,
  excerpt TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_relationship_evidence_user ON relationship_evidence(user_id, created_at);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subscription_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id, updated_at);

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, last_used_at);

CREATE TABLE IF NOT EXISTS memory_vectors (
  memory_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  embedding BLOB NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memory_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_memory_vectors_user ON memory_vectors(user_id, updated_at);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  url_path TEXT NOT NULL,
  purpose TEXT NOT NULL,
  mime TEXT,
  bytes INTEGER DEFAULT 0,
  retention_until TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_accessed TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_media_assets_retention ON media_assets(retention_until, user_id);

CREATE TABLE IF NOT EXISTS model_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  model TEXT NOT NULL,
  context_mode TEXT NOT NULL,
  token_budget INTEGER NOT NULL,
  system_hash TEXT NOT NULL,
  context_hash TEXT NOT NULL,
  full_hash TEXT NOT NULL,
  block_manifest_json TEXT NOT NULL,
  retrieval_refs_json TEXT DEFAULT '[]',
  params_json TEXT DEFAULT '{}',
  status TEXT DEFAULT 'started',
  output_hash TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_model_runs_user ON model_runs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_model_runs_turn ON model_runs(turn_id, created_at);

CREATE TABLE IF NOT EXISTS delivery_commands (
  command_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  message_id TEXT,
  surface TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  status TEXT DEFAULT 'planned',
  timeline_json TEXT DEFAULT '[]',
  planned_at TEXT NOT NULL,
  ack_at TEXT,
  ready_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  failed_at TEXT,
  duration_ms INTEGER,
  error TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_delivery_user ON delivery_commands(user_id, planned_at);
CREATE INDEX IF NOT EXISTS idx_delivery_turn ON delivery_commands(turn_id, planned_at);
CREATE INDEX IF NOT EXISTS idx_delivery_status ON delivery_commands(status, updated_at);

CREATE TABLE IF NOT EXISTS agent_actions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  topic_key TEXT,
  score REAL DEFAULT 0,
  confidence REAL DEFAULT 0,
  decision_source TEXT DEFAULT 'code',
  status TEXT DEFAULT 'decided',
  outcome TEXT,
  outcome_weight REAL,
  policy_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_agent_actions_user ON agent_actions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_actions_pending ON agent_actions(user_id, status, created_at);
`);

db.exec(`
UPDATE memory_entries
SET valid_from = COALESCE(valid_from, created_at),
    updated_at = COALESCE(updated_at, created_at),
    status = COALESCE(NULLIF(status, ''), 'active'),
    source_type = COALESCE(NULLIF(source_type, ''), 'legacy'),
    source_refs_json = COALESCE(NULLIF(source_refs_json, ''), '[]'),
    epistemic_mode = COALESCE(NULLIF(epistemic_mode, ''), 'inference');

UPDATE memory_entries SET thread = CASE thread
  WHEN 'phd_apply' THEN 'projects'
  WHEN 'outreach' THEN 'projects'
  WHEN 'research' THEN 'projects'
  WHEN 'work' THEN 'work_study'
  WHEN 'entertainment' THEN 'interests'
  WHEN 'we' THEN 'relationship'
  ELSE COALESCE(NULLIF(thread, ''), 'daily')
END;
`);

db.exec(`
CREATE TABLE IF NOT EXISTS emotion_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  message_id TEXT,
  novelty REAL,
  safety REAL,
  valence REAL,
  arousal REAL,
  emotion_label TEXT,
  narrative TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_emotion_user ON emotion_logs(user_id, created_at);

CREATE TRIGGER IF NOT EXISTS trg_emotion_logs_user_guard
BEFORE INSERT ON emotion_logs
WHEN NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id)
BEGIN
  SELECT RAISE(ABORT, 'emotion_logs user does not exist');
END;

CREATE TRIGGER IF NOT EXISTS trg_users_delete_emotion_logs
AFTER DELETE ON users
BEGIN
  DELETE FROM emotion_logs WHERE user_id = OLD.id;
END;
`);

db.exec(`
CREATE TABLE IF NOT EXISTS user_stickers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_user_stickers_user ON user_stickers(user_id, created_at);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`);

db.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)')
  .run('2026-07-12-full-loop-v4', new Date().toISOString());

export function cleanupOrphanedRows() {
  const candidates = [
    'messages', 'memory_entries', 'ppr_events', 'keepalive_logs', 'worldbook_entries',
    'favorites', 'todos', 'relational_turn_signals', 'pending_review', 'emotion_logs',
    'user_stickers', 'relationship_profiles', 'relationship_evidence', 'push_subscriptions',
    'user_sessions', 'memory_vectors', 'media_assets', 'model_runs', 'delivery_commands',
    'agent_actions',
  ];
  const cleanup = db.transaction(() => {
    const removed = {};
    for (const table of candidates) {
      const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table', 'virtual table') AND name = ?").get(table);
      if (!exists) continue;
      const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
      if (!columns.includes('user_id')) continue;
      const changes = db.prepare(`DELETE FROM ${table} WHERE NOT EXISTS (SELECT 1 FROM users WHERE users.id = ${table}.user_id)`).run().changes;
      if (changes) removed[table] = changes;
    }
    return removed;
  });
  return cleanup();
}

const orphanCleanup = cleanupOrphanedRows();
if (Object.keys(orphanCleanup).length) console.log('[db] removed orphaned research rows', orphanCleanup);

export function parseMessage(row) {
  let metadata = null;
  try { metadata = row.metadata ? JSON.parse(row.metadata) : null; } catch { metadata = null; }
  return {
    ...row,
    ppr_tagged: Boolean(row.ppr_tagged),
    resonance_tagged: Boolean(row.resonance_tagged),
    metadata,
  };
}

export function normalizeUserId(raw) {
  return String(raw || '').trim().replace(/\s+/g, '').toLowerCase();
}

export function getUser(id) {
  const normalized = normalizeUserId(id);
  if (!normalized) return null;
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(normalized);
  if (!row) return null;
  return parseUser(row);
}

export function parseUser(row) {
  let emotion_state = null;
  if (row.emotion_state) {
    try { emotion_state = JSON.parse(row.emotion_state); } catch { emotion_state = null; }
  }
  let desire_state = null;
  if (row.desire_state) {
    try { desire_state = JSON.parse(row.desire_state); } catch { desire_state = null; }
  }
  const parseObject = (value, fallback) => {
    try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
  };
  const {
    auth_token_hash: _authTokenHash,
    recovery_code_hash: _recoveryCodeHash,
    ...safeRow
  } = row;
  return {
    ...safeRow,
    keywords: parseObject(row.keywords, {}),
    big_five: parseObject(row.big_five, {}),
    big_five_history: parseObject(row.big_five_history, []),
    emotion_state,
    desire_state,
    notify_keepalive: Boolean(row.notify_keepalive),
    notify_diary: row.notify_diary == null ? true : Boolean(row.notify_diary),
    calendar_duck_assist: Boolean(row.calendar_duck_assist),
    together_rain_until: row.together_rain_until || null,
    no_proactive_until: row.no_proactive_until || null,
  };
}

export function saveUser(user) {
  db.prepare(`
    INSERT INTO users (id, name, pronouns, ai_gender, ai_name, keywords, big_five, big_five_history, voice_id, notify_keepalive, notify_diary, notify_window_start, notify_window_end, ui_lang, ui_theme, timezone, work_start, work_end, device_token, push_last_at, desire_state, calendar_duck_assist, together_rain_until, no_proactive_until, created_at, last_active)
    VALUES (@id, @name, @pronouns, @ai_gender, @ai_name, @keywords, @big_five, @big_five_history, @voice_id, @notify_keepalive, @notify_diary, @notify_window_start, @notify_window_end, @ui_lang, @ui_theme, @timezone, @work_start, @work_end, @device_token, @push_last_at, @desire_state, @calendar_duck_assist, @together_rain_until, @no_proactive_until, @created_at, @last_active)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      pronouns=excluded.pronouns,
      ai_gender=excluded.ai_gender,
      ai_name=excluded.ai_name,
      keywords=excluded.keywords,
      big_five=excluded.big_five,
      big_five_history=excluded.big_five_history,
      voice_id=excluded.voice_id,
      notify_keepalive=excluded.notify_keepalive,
      notify_diary=excluded.notify_diary,
      notify_window_start=excluded.notify_window_start,
      notify_window_end=excluded.notify_window_end,
      ui_lang=excluded.ui_lang,
      ui_theme=excluded.ui_theme,
      timezone=excluded.timezone,
      work_start=excluded.work_start,
      work_end=excluded.work_end,
      device_token=excluded.device_token,
      push_last_at=excluded.push_last_at,
      desire_state=excluded.desire_state,
      calendar_duck_assist=excluded.calendar_duck_assist,
      together_rain_until=excluded.together_rain_until,
      no_proactive_until=excluded.no_proactive_until,
      last_active=excluded.last_active
  `).run({
    ...user,
    ui_lang: user.ui_lang || 'zh',
    ui_theme: user.ui_theme || 'auto',
    timezone: user.timezone || 'Asia/Shanghai',
    work_start: user.work_start || null,
    work_end: user.work_end || null,
    device_token: user.device_token || null,
    push_last_at: user.push_last_at || null,
    desire_state: user.desire_state ? JSON.stringify(user.desire_state) : null,
    calendar_duck_assist: user.calendar_duck_assist ? 1 : 0,
    together_rain_until: user.together_rain_until || null,
    no_proactive_until: user.no_proactive_until || null,
    keywords: JSON.stringify(user.keywords || {}),
    big_five: JSON.stringify(user.big_five || {}),
    big_five_history: JSON.stringify(user.big_five_history || []),
    notify_keepalive: user.notify_keepalive ? 1 : 0,
    notify_diary: user.notify_diary === false ? 0 : 1,
  });
}

export function touchUser(id) {
  db.prepare('UPDATE users SET last_active = ? WHERE id = ?').run(new Date().toISOString(), id);
}
