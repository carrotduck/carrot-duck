import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';

fs.mkdirSync(DATA_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, 'carrotduck.db');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

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

try { db.exec('ALTER TABLE messages ADD COLUMN metadata TEXT'); } catch { /* exists */ }
try { db.exec("ALTER TABLE users ADD COLUMN ui_lang TEXT DEFAULT 'zh'"); } catch { /* exists */ }
try { db.exec("ALTER TABLE users ADD COLUMN timezone TEXT DEFAULT 'Asia/Shanghai'"); } catch { /* exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN work_start TEXT'); } catch { /* exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN work_end TEXT'); } catch { /* exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN device_token TEXT'); } catch { /* exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN push_last_at TEXT'); } catch { /* exists */ }
try { db.exec("ALTER TABLE favorites ADD COLUMN source TEXT DEFAULT 'manual'"); } catch { /* exists */ }
try { db.exec("ALTER TABLE users ADD COLUMN ui_theme TEXT DEFAULT 'auto'"); } catch { /* exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN emotion_state TEXT'); } catch { /* exists */ }
try { db.exec('ALTER TABLE todos ADD COLUMN reminded_at TEXT'); } catch { /* exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN notify_diary INTEGER DEFAULT 1'); } catch { /* exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN desire_state TEXT'); } catch { /* exists */ }
try { db.exec('ALTER TABLE memory_entries ADD COLUMN thread TEXT DEFAULT \'daily\''); } catch { /* exists */ }
try { db.exec("ALTER TABLE memory_entries ADD COLUMN confidence TEXT DEFAULT 'medium'"); } catch { /* exists */ }
try { db.exec('ALTER TABLE todos ADD COLUMN repeat_rule TEXT'); } catch { /* exists */ }
try { db.exec("ALTER TABLE users ADD COLUMN calendar_duck_assist INTEGER DEFAULT 0"); } catch { /* exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN together_rain_until TEXT'); } catch { /* exists */ }
try { db.exec('ALTER TABLE messages ADD COLUMN conversation_mode TEXT'); } catch { /* exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN no_proactive_until TEXT'); } catch { /* exists */ }

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
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emotion_user ON emotion_logs(user_id, created_at);
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
`);

export function parseMessage(row) {
  return {
    ...row,
    ppr_tagged: Boolean(row.ppr_tagged),
    resonance_tagged: Boolean(row.resonance_tagged),
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
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
  return {
    ...row,
    keywords: row.keywords ? JSON.parse(row.keywords) : {},
    big_five: row.big_five ? JSON.parse(row.big_five) : {},
    big_five_history: row.big_five_history ? JSON.parse(row.big_five_history) : [],
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
