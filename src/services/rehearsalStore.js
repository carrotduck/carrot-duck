import { randomUUID } from 'node:crypto';
import { rehearsalScenes, rehearsalPlan, resolveRehearsalStep } from './rehearsalScenes.js';

export function createRehearsalStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rehearsal_accounts (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, enabled INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS rehearsal_takes (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scene TEXT NOT NULL, status TEXT NOT NULL, step INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 0, paused INTEGER NOT NULL DEFAULT 0,
      next_reply TEXT, last_plan TEXT, created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS rehearsal_one_active ON rehearsal_takes(user_id) WHERE status = 'active';
    CREATE TABLE IF NOT EXISTS rehearsal_turns (
      id TEXT PRIMARY KEY, take_id TEXT NOT NULL REFERENCES rehearsal_takes(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rehearsal_requests (
      take_id TEXT NOT NULL REFERENCES rehearsal_takes(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(take_id, request_id)
    );
  `);
  const fail = (message, status = 409) => Object.assign(new Error(message), { status });
  const transaction = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const enabled = (id) => db.prepare('SELECT enabled FROM rehearsal_accounts WHERE user_id = ?').get(id)?.enabled === 1;
  const active = (id) => enabled(id) ? db.prepare("SELECT * FROM rehearsal_takes WHERE user_id = ? AND status = 'active'").get(id) : null;
  const requireEnabled = (id) => { if (!enabled(id)) throw fail('Rehearsal is not enabled for this account', 403); };
  const scenes = () => Object.entries(rehearsalScenes).map(([id, s]) => ({ id, title: s.title, diary: s.diary }));
  const snapshot = (id) => {
    requireEnabled(id);
    const take = active(id);
    return { enabled: true, language: 'en', scenes: scenes(), active: take ? {
      id: take.id, scene: take.scene, step: take.step, revision: take.revision,
      paused: !!take.paused, pending_reply: take.next_reply ? JSON.parse(take.next_reply) : null,
      hint: rehearsalScenes[take.scene].steps[take.step]?.prompt || 'Scene complete. Restart the take or end rehearsal.',
      finished: take.step >= rehearsalScenes[take.scene].steps.length,
      plan: take.last_plan ? JSON.parse(take.last_plan) : null,
    } : null };
  };
  const validTake = (id, takeId, revision) => {
    requireEnabled(id);
    const take = active(id);
    if (!take || take.id !== takeId || take.revision !== revision) throw fail('Rehearsal has changed. Refresh and try again.');
    return take;
  };
  const start = (id, scene, previousId) => transaction(() => {
    requireEnabled(id);
    if (!Object.hasOwn(rehearsalScenes, scene)) throw fail('Unknown scene', 400);
    if ((active(id)?.id || null) !== (previousId || null)) throw fail('Another window changed scenes. Refresh first.');
    db.prepare("UPDATE rehearsal_takes SET status = 'archived' WHERE user_id = ? AND status = 'active'").run(id);
    db.prepare("INSERT INTO rehearsal_takes (id,user_id,scene,status,created_at) VALUES (?,?,?,'active',?)")
      .run(randomUUID(), id, scene, new Date().toISOString());
    return snapshot(id);
  });
  const update = (id, body) => transaction(() => {
    const take = validTake(id, body.take_id, body.revision);
    if (body.command === 'stop') db.prepare("UPDATE rehearsal_takes SET status='archived' WHERE id=?").run(take.id);
    else if (body.command === 'pause') db.prepare('UPDATE rehearsal_takes SET paused=?,revision=revision+1 WHERE id=?').run(body.paused ? 1 : 0, take.id);
    else if (body.command === 'reply') {
      const actions = ['listening', 'nod', 'softSmile', 'thinking', 'shakeHead', 'greet', 'shy', 'breathe', 'attentiveLean', 'patientNod', 'earReveal', 'offerHead', 'amused'];
      if (typeof body.text !== 'string' || body.text.length > 1200 || !actions.includes(body.action)) throw fail('Invalid reply or action', 400);
      const reply = { reply: body.text.trim(), action: body.action, ears: !!body.ears, advance: false, silent: !body.text.trim() };
      db.prepare('UPDATE rehearsal_takes SET next_reply=?,revision=revision+1 WHERE id=?').run(JSON.stringify(reply), take.id);
    } else throw fail('Unknown rehearsal command', 400);
    return snapshot(id);
  });
  const message = (row) => ({ ...row, source: 'rehearsal', metadata: { synthetic: true, take_id: row.take_id }, ppr_tagged: false, resonance_tagged: false });
  const history = (id) => {
    const take = active(id);
    if (!take) return null;
    return { messages: db.prepare('SELECT * FROM rehearsal_turns WHERE take_id=? AND user_id=? ORDER BY rowid').all(take.id, id).map(message),
      pagination: { has_more: false, next_before: null }, rehearsal: snapshot(id).active };
  };
  const diary = (id) => {
    const take = active(id);
    if (!take) return null;
    return { diary: [{ id: `rehearsal-${take.id}`, category: 'diary', content: rehearsalScenes[take.scene].diary,
      created_at: take.created_at, tags: [], source_type: 'rehearsal', metadata: { synthetic: true }, confidence: 1 }],
      today_roaming: {}, today_roaming_logs: [], today_roaming_events: [], week_roaming_count: 0, favorites: [] };
  };
  const turn = (id, body) => transaction(() => {
    requireEnabled(id);
    const current = active(id);
    if (!current || current.id !== body.take_id) throw fail('Rehearsal ended or changed scenes. Refresh first.');
    if (typeof body.request_id !== 'string' || !/^[\w-]{8,80}$/.test(body.request_id)) throw fail('Missing rehearsal request ID', 400);
    const cached = db.prepare('SELECT response FROM rehearsal_requests WHERE take_id=? AND request_id=?').get(current.id, body.request_id);
    if (cached) return JSON.parse(cached.response);
    const take = validTake(id, body.take_id, body.revision);
    if (take.paused) throw fail('Rehearsal is paused');
    if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 4000) throw fail('Enter a rehearsal line', 400);
    const cue = take.next_reply ? JSON.parse(take.next_reply) : resolveRehearsalStep(rehearsalScenes[take.scene], take.step, body.message, body.surface);
    if (cue.mismatch) throw fail(`Continue with the current scene: ${cue.hint}`);
    const now = new Date().toISOString();
    const insert = (role, content) => {
      const row = { id: randomUUID(), take_id: take.id, user_id: id, role, content, created_at: now };
      db.prepare('INSERT INTO rehearsal_turns (id,take_id,user_id,role,content,created_at) VALUES (?,?,?,?,?,?)')
        .run(row.id, take.id, id, role, content, now);
      return message(row);
    };
    const userMessage = insert('user', body.message.trim());
    const plan = rehearsalPlan(cue.action, cue);
    const reply = cue.reply ? insert('assistant', cue.reply) : null;
    const replies = reply ? [reply] : [];
    if (body.surface === 'chat' && cue.sticker && !cue.silent) {
      replies.push(insert('assistant', `[STICKER:${cue.sticker}]`));
    }
    db.prepare('UPDATE rehearsal_takes SET step=step+?,revision=revision+1,next_reply=NULL,last_plan=? WHERE id=?')
      .run(cue.advance ? 1 : 0, JSON.stringify(plan), take.id);
    const result = { type: 'done', message: reply, messages: replies, expression_plan: plan,
      ...(take.scene === 'small_gesture_of_care' && cue.bodyCue && reply ? { body_sync: {
        schema: 'duck-body-text/v1', mode: 'preview_only', cue: cue.bodyCue,
        take_id: take.id, user_id: id, request_id: body.request_id,
        user_message_id: userMessage.id, user_text: userMessage.content,
        assistant_message_id: reply.id, assistant_text: reply.content,
        reply_to_message_id: userMessage.id, expires_at: Date.now() + 120000,
      } } : {}),
      rehearsal: { ...snapshot(id).active, silent: !!cue.silent, synthetic: true } };
    db.prepare('INSERT INTO rehearsal_requests (take_id,request_id,response) VALUES (?,?,?)').run(take.id, body.request_id, JSON.stringify(result));
    return result;
  });
  const enroll = (id, allow) => transaction(() => {
    if (!db.prepare('SELECT id FROM users WHERE id=?').get(id)) throw fail('Account not found', 404);
    db.prepare('INSERT INTO rehearsal_accounts(user_id,enabled) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled').run(id, allow ? 1 : 0);
    if (!allow) db.prepare("UPDATE rehearsal_takes SET status='archived' WHERE user_id=? AND status='active'").run(id);
    return { enabled: !!allow };
  });
  return { enabled, active, snapshot, start, update, history, diary, turn, enroll };
}
