import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db, getUser } from '../db.js';
import { callDeepSeek } from '../services/deepseek.js';
import { searchMemoriesHybrid, addMemory } from '../services/memory.js';
import { getBoundaryControl } from '../services/relationalState.js';
import { analyzeAffectiveSignal } from '../services/affectiveSignals.js';
import { buildEmotionState, getEmotionState } from '../services/occ.js';
import { createAutonomousAgent } from '../services/autonomous.js';

db.exec(`CREATE TABLE IF NOT EXISTS autonomous_turns (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
  message TEXT NOT NULL, result TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(user_id, request_id)
)`);
const router = Router({ mergeParams: true });
db.exec(`CREATE TABLE IF NOT EXISTS autonomous_delivery (
  turn_id TEXT PRIMARY KEY REFERENCES autonomous_turns(id), user_id TEXT NOT NULL,
  status TEXT NOT NULL, updated_at TEXT NOT NULL
)`);
const active = new Set();
const run = createAutonomousAgent({
  model: callDeepSeek,
  search: (id, query) => searchMemoriesHybrid(id, query, 8, { includeLowConfidence: false }),
  recentGrounded: id => db.prepare(`SELECT id,content,category,status,confidence,epistemic_mode,source_type,source_ref,created_at
    FROM memory_entries WHERE user_id=? AND status='active' AND epistemic_mode='grounded' AND confidence!='low'
    ORDER BY created_at DESC LIMIT 12`).all(id),
});
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!req.authUserId || req.authUserId !== req.params.userId) return res.status(403).json({ error: 'Account mismatch' });
  next();
});
router.get('/', (req, res) => {
  const turns = db.prepare("SELECT id,message,result,created_at FROM autonomous_turns WHERE user_id=? AND status='complete' ORDER BY created_at DESC LIMIT 20").all(req.authUserId).reverse();
  res.json({ mode: 'autonomous', turns: turns.map(t => ({ ...t, result: JSON.parse(t.result) })) });
});
router.post('/memory', (req, res) => {
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!content || content.length > 2000) return res.status(400).json({ error: 'Enter a memory of 1–2000 characters.' });
  const memory = addMemory(req.authUserId, { content, confidence: 'high', epistemic_mode: 'grounded',
    tags: ['user-requested', 'autonomous-input'], meta: { source: 'user-stated', userExplicit: true } });
  res.json({ memory });
});
router.post('/feedback', (req, res) => {
  const { turn_id: id, status } = req.body || {};
  if (typeof id !== 'string' || !['started', 'completed', 'cancelled', 'failed'].includes(status)) return res.status(400).json({ error: 'Invalid playback report' });
  const turn = db.prepare("SELECT id FROM autonomous_turns WHERE id=? AND user_id=? AND status='complete'").get(id, req.authUserId);
  if (!turn) return res.status(404).json({ error: 'Turn not found' });
  // Terminal state is sticky: delayed start/finish packets cannot resurrect cancelled playback.
  db.prepare(`INSERT INTO autonomous_delivery(turn_id,user_id,status,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(turn_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at
    WHERE autonomous_delivery.status='started'`).run(id, req.authUserId, status, new Date().toISOString());
  res.json({ ok: true });
});
router.post('/', async (req, res) => {
  const userId = req.authUserId;
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const requestId = req.body?.request_id;
  if (!message || message.length > 2000 || typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId))
    return res.status(400).json({ error: 'Message and valid request_id required.' });
  const previous = db.prepare('SELECT * FROM autonomous_turns WHERE user_id=? AND request_id=?').get(userId, requestId);
  if (previous) {
    if (previous.message !== message) return res.status(409).json({ error: 'Request ID was already used for another message.' });
    if (previous.status === 'complete') return res.json(JSON.parse(previous.result));
    return res.status(409).json({ error: 'This request is pending or failed. Send a new request to retry.' });
  }
  if (active.has(userId)) return res.status(429).json({ error: 'Please wait for the current reply.' });
  const user = getUser(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  active.add(userId);
  const turnId = randomUUID();
  try {
    db.prepare("INSERT INTO autonomous_turns(id,user_id,request_id,message,status,created_at) VALUES(?,?,?,?,'pending',?)")
      .run(turnId, userId, requestId, message, new Date().toISOString());
    const history = db.prepare("SELECT message,result FROM autonomous_turns WHERE user_id=? AND status='complete' ORDER BY created_at DESC LIMIT 6")
      .all(userId).reverse().flatMap(t => [{ role: 'user', content: t.message }, { role: 'assistant', content: JSON.parse(t.result).reply }]);
    const emotion = buildEmotionState(user, message, getEmotionState(user));
    const signal = analyzeAffectiveSignal({ user, message, emotionState: emotion, memories: [], recentMessages: history });
    const feedback = db.prepare(`SELECT d.status,d.updated_at,t.result FROM autonomous_delivery d
      JOIN autonomous_turns t ON t.id=d.turn_id WHERE d.user_id=? ORDER BY d.updated_at DESC LIMIT 3`).all(userId)
      .map(t => ({ status: t.status, updated_at: t.updated_at, action: JSON.parse(t.result).trace.action, source: 'browser_report' }));
    const last = db.prepare("SELECT result FROM autonomous_turns WHERE user_id=? AND status='complete' ORDER BY created_at DESC LIMIT 1").get(userId);
    const { decision, trace } = await run({ user, message, history, boundary: getBoundaryControl(userId), signal, emotion,
      runtime: req.body.runtime, feedback, previousAction: last ? JSON.parse(last.result).trace.action : null,
      useMemory: req.body.use_memory !== false, lang: req.body.lang === 'zh' ? 'zh' : 'en' });
    const result = { mode: 'autonomous', turn_id: turnId, request_id: requestId, reply: decision.reply, invitation: decision.invitation, trace,
      expression_plan: { schema: 'carrot_duck_expression_plan_v2', source: 'autonomous', synthetic: false,
        language: req.body.lang === 'zh' ? 'zh' : 'en', state: 'speaking', command_id: null,
        live2d: { custom_action: decision.action, intensity: decision.intensity, apply_on: 'audio_start', release_on: 'audio_end' },
        performance: trace.performance,
        boundary_mode: trace.restricted ? 'deescalate' : 'normal', delivery: { expected: false },
        voice: trace.performance.voice } };
    db.prepare("UPDATE autonomous_turns SET result=?,status='complete' WHERE id=?").run(JSON.stringify(result), turnId);
    if (!res.destroyed) res.json(result);
  } catch (error) {
    db.prepare("UPDATE autonomous_turns SET status='failed' WHERE id=?").run(turnId);
    console.warn('[autonomous]', error.status || 500, error.name);
    if (!res.destroyed) res.status(error.status === 502 ? 502 : 503).json({ error: 'Autonomous generation unavailable. No scripted reply was substituted; please retry.' });
  } finally { active.delete(userId); }
});
export default router;
