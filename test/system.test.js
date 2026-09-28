import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'carrot-duck-test-'));
process.env.DATA_DIR = dataDir;
process.env.DEEPSEEK_API_KEY = '';
process.env.ALIYUN_API_KEY = '';
process.env.DASHSCOPE_API_KEY = '';
process.env.EMBEDDING_API_KEY = '';

const { db, getUser, saveUser, sqliteVectorReady } = await import('../src/db.js');
const { computeDepthScore, getRelationshipStageLabel } = await import('../src/services/personality.js');
const {
  authenticateBearer,
  issueCredentials,
  verifyRecoveryCode,
} = await import('../src/middleware/security.js');
const { analyzeAffectiveSignal } = await import('../src/services/affectiveSignals.js');
const { detectRelationshipCues, updateRelationshipProfile } = await import('../src/services/relationshipProfile.js');
const { buildExpressionPlan } = await import('../src/services/expressionPlan.js');
const {
  addMemory,
  deleteMemory,
  listMemoryRecycle,
  restoreMemory,
  searchMemories,
  updateMemory,
} = await import('../src/services/memory.js');
const { recordPprEvent, resolvePprForUserTurn } = await import('../src/services/ppr.js');
const { archiveKeepaliveBacklog } = await import('../src/services/keepalive.js');
const { saveEmotionState } = await import('../src/services/occ.js');
const { createDeliveryCommand, recordDeliveryReceipt } = await import('../src/services/deliveryReceipts.js');
const { planChatTurn } = await import('../src/services/turnPlanner.js');
const { startModelRun, completeModelRun } = await import('../src/services/modelRuns.js');
const {
  decideAgentAction,
  markAgentActionExecuted,
  recordAgentActionOutcome,
} = await import('../src/services/actionArbiter.js');

function makeUser(id, name = 'Test') {
  const now = new Date().toISOString();
  const user = {
    id,
    name,
    pronouns: 'they/them',
    ai_gender: 'neutral',
    ai_name: 'Duck',
    keywords: {},
    big_five: { O: 50, C: 50, E: 50, A: 50, N: 50 },
    big_five_history: [],
    voice_id: null,
    notify_keepalive: true,
    notify_diary: true,
    notify_window_start: 8,
    notify_window_end: 1,
    ui_lang: 'zh',
    ui_theme: 'auto',
    timezone: 'Asia/Shanghai',
    work_start: null,
    work_end: null,
    device_token: null,
    push_last_at: null,
    desire_state: null,
    calendar_duck_assist: false,
    together_rain_until: null,
    no_proactive_until: null,
    created_at: now,
    last_active: now,
  };
  saveUser(user);
  return getUser(id);
}

after(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('session tokens protect account identity and recovery remains separate', () => {
  const user = makeUser('11111111-1111-4111-8111-111111111111', 'Auth');
  const credentials = issueCredentials(user.id);
  const req = { headers: { authorization: `Bearer ${credentials.session_token}` } };
  assert.equal(authenticateBearer(req), user.id);
  assert.equal(verifyRecoveryCode(user.id, credentials.recovery_code), true);
  assert.equal(verifyRecoveryCode(user.id, 'wrong-code'), false);
  assert.equal('auth_token_hash' in getUser(user.id), false);
  assert.equal('recovery_code_hash' in getUser(user.id), false);
});

test('sqlite-vec is loaded and computes cosine distance', () => {
  assert.equal(sqliteVectorReady, true);
  const first = Buffer.from(new Float32Array([1, 0, 0]).buffer);
  const same = Buffer.from(new Float32Array([1, 0, 0]).buffer);
  const other = Buffer.from(new Float32Array([0, 1, 0]).buffer);
  const result = db.prepare(`
    SELECT
      vec_distance_cosine(?, ?) AS same_distance,
      vec_distance_cosine(?, ?) AS other_distance
  `).get(first, same, first, other);
  assert.ok(result.same_distance < 0.000001);
  assert.ok(result.other_distance > 0.9);
});

test('legacy proactive backlog is capped at one unanswered message per user', () => {
  const user = makeUser('66666666-6666-4666-8666-666666666666', 'Keepalive');
  const insert = db.prepare(`
    INSERT INTO messages (id, user_id, role, content, source, consumed, archived, created_at)
    VALUES (?, ?, 'assistant', ?, 'keepalive', 0, 0, ?)
  `);
  insert.run('ka-1', user.id, 'first', '2026-07-01T10:00:00.000Z');
  insert.run('ka-2', user.id, 'second', '2026-07-01T11:00:00.000Z');
  insert.run('ka-3', user.id, 'latest', '2026-07-01T12:00:00.000Z');
  assert.equal(archiveKeepaliveBacklog(), 2);
  const active = db.prepare(`
    SELECT id FROM messages
    WHERE user_id = ? AND source = 'keepalive' AND consumed = 0 AND archived = 0
  `).all(user.id);
  assert.deepEqual(active, [{ id: 'ka-3' }]);
});

test('late emotion refinement cannot recreate rows after account deletion', () => {
  const user = makeUser('77777777-7777-4777-8777-777777777777', 'Emotion');
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  const saved = saveEmotionState(user.id, {
    appraisal: { novelty: 1, safety: 5, valence: 0, arousal: 1 },
    emotion_label: 'calm',
    narrative: 'calm',
    updated_at: new Date().toISOString(),
  });
  assert.equal(saved, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM emotion_logs WHERE user_id = ?').get(user.id).count, 0);
});

test('familiarity stages are reachable through real interaction', () => {
  const user = makeUser('22222222-2222-4222-8222-222222222222', 'Depth');
  const insert = db.prepare(`
    INSERT INTO messages (id, user_id, role, content, source, consumed, archived, created_at)
    VALUES (?, ?, ?, 'hello', 'chat', 1, 0, ?)
  `);
  const addTurns = db.transaction((from, to) => {
    for (let index = from; index < to; index += 1) {
      const day = String((index % 28) + 1).padStart(2, '0');
      const time = `2026-06-${day}T12:00:${String(index % 60).padStart(2, '0')}.000Z`;
      insert.run(`u-${index}`, user.id, 'user', time);
      insert.run(`a-${index}`, user.id, 'assistant', time);
    }
  });
  assert.equal(getRelationshipStageLabel(user, db), 'STRANGER');
  addTurns(0, 5);
  assert.equal(getRelationshipStageLabel(user, db), 'KNOWN');
  addTurns(5, 35);
  assert.equal(getRelationshipStageLabel(user, db), 'FAMILIAR');
  addTurns(35, 100);
  assert.equal(getRelationshipStageLabel(user, db), 'CLOSE');
  assert.ok(computeDepthScore(user.id, db, user) >= 105);
});

test('relationship direction needs explicit evidence and respects friend boundaries', () => {
  const user = makeUser('33333333-3333-4333-8333-333333333333', 'Relation');
  assert.deepEqual(detectRelationshipCues('嘿嘿小宝今天真可爱'), []);
  const cues = detectRelationshipCues('我把你当成最好的朋友，只是朋友，不要暧昧');
  assert.ok(cues.some((cue) => cue.direction === 'FRIEND' && cue.weight > 0));
  assert.ok(cues.some((cue) => cue.direction === 'ROMANTIC' && cue.weight < 0));
  const profile = updateRelationshipProfile(user.id, 'relation-msg', '我把你当成最好的朋友，只是朋友，不要暧昧', {
    relationship_cues: cues,
    boundary_risk: 'none',
  });
  assert.equal(profile.primary_direction, 'UNDEFINED');
  assert.ok(profile.direction_scores.FRIEND > profile.direction_scores.ROMANTIC);
});

test('affective negation and expression boundary mode do not invert meaning', () => {
  const signal = analyzeAffectiveSignal({ message: '我不开心，也不要亲亲，先停一下' });
  assert.equal(signal.valence, 'negative');
  assert.equal(signal.openness, 'closed');
  assert.equal(signal.boundary_risk, 'strong');
  const plan = buildExpressionPlan({ affectiveSignal: signal });
  assert.equal(plan.boundary_mode, 'deescalate');
  assert.equal(plan.live2d.custom_action, 'listening');
});

test('Chinese memory retrieval uses lexical n-grams instead of whitespace only', async () => {
  const user = makeUser('44444444-4444-4444-8444-444444444444', 'Memory');
  addMemory(user.id, {
    content: '用户的博士论文已经提交了。',
    category: 'daily',
    confidence: 'high',
    meta: { source: 'user-stated', userExplicit: true },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const results = searchMemories(user.id, '你还记得我的论文吗？', 3);
  assert.equal(results[0]?.content, '用户的博士论文已经提交了。');
});

test('memory updates preserve versions and recycle is reversible', () => {
  const user = makeUser('88888888-8888-4888-8888-888888888888', 'MemoryV4');
  const first = addMemory(user.id, {
    content: '论文还在写。',
    memory_key: 'paper-status',
    topic_key: 'paper',
    confidence: 'high',
    meta: { source: 'user-stated', userExplicit: true },
  });
  const second = updateMemory(user.id, first.id, { content: '论文已经提交。' });
  assert.notEqual(second.id, first.id);
  assert.equal(db.prepare('SELECT status FROM memory_entries WHERE id = ?').get(first.id).status, 'archived');
  assert.equal(db.prepare('SELECT superseded_by FROM memory_entries WHERE id = ?').get(first.id).superseded_by, second.id);
  assert.equal(deleteMemory(user.id, second.id), true);
  assert.equal(listMemoryRecycle(user.id)[0]?.id, second.id);
  assert.equal(restoreMemory(user.id, second.id)?.status, 'active');
});

test('turn planning expands emotional context without making acknowledgements long', () => {
  const user = makeUser('99999999-9999-4999-8999-999999999999', 'Planner');
  const ack = planChatTurn(user, { message: '收到', conversationMode: 'QUESTION' });
  assert.equal(ack.context_mode, 'compact');
  assert.equal(ack.token_budget, 120);
  const relational = planChatTurn(user, {
    message: '我一直很难过，你还记得那天吗？',
    conversationMode: 'PRESENCE',
    affectiveSignal: { intensity: 'high', valence: 'negative', ppr_hint: 'memory', boundary_risk: 'none' },
  });
  assert.equal(relational.context_mode, 'full');
  assert.ok(relational.token_budget >= 340);
});

test('model run manifest hashes full visible context without storing prompt text', () => {
  const user = makeUser('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Manifest');
  const run = startModelRun({
    userId: user.id,
    turnId: 'turn-manifest',
    systemMessages: [{ role: 'system', content: 'stable' }, { role: 'system', content: 'dynamic' }],
    apiMessages: [{ role: 'user', content: 'hello' }],
    turnPlan: { context_mode: 'compact', token_budget: 120, response_class: 'ack' },
  });
  assert.equal(run.manifest.blocks[0].name, 'stable_system');
  assert.equal(JSON.stringify(run.manifest).includes('hello'), false);
  assert.equal(completeModelRun(run.id, { output: 'hi' }), true);
  assert.equal(db.prepare('SELECT status FROM model_runs WHERE id = ?').get(run.id).status, 'completed');
});

test('delivery commands retain ordered execution receipts', () => {
  const user = makeUser('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Delivery');
  const plan = buildExpressionPlan({
    affectiveSignal: { valence_score: 0.5, arousal: 0.6, boundary_risk: 'none' },
    turnId: 'turn-delivery',
    messageId: 'message-delivery',
    surface: 'live2d',
    deliveryExpected: true,
  });
  createDeliveryCommand({ userId: user.id, turnId: 'turn-delivery', messageId: 'message-delivery', surface: 'live2d', plan });
  recordDeliveryReceipt(user.id, plan.command_id, 'ack', { resource: 'live2d_tts' });
  recordDeliveryReceipt(user.id, plan.command_id, 'started', { resource: 'live2d_tts' });
  const completed = recordDeliveryReceipt(user.id, plan.command_id, 'completed', { duration_ms: 1234, final_state: 'idle' });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.duration_ms, 1234);
  assert.deepEqual(JSON.parse(completed.timeline_json).map((item) => item.status), ['planned', 'ack', 'started', 'completed']);
});

test('action arbiter learns positive, neutral, and boundary-aware outcomes', () => {
  const user = makeUser('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Arbiter');
  const decision = decideAgentAction({
    user,
    desireState: { drives: { social: 0.9, attachment: 0.8, reflection: 0.4, curiosity: 0.4, fatigue: 0.1 } },
    summon: { action: 'message', driveKey: 'social', score: 0.95 },
    policy: { allowRoam: true, allowMessage: true, reason: 'test' },
    diaryAllowed: true,
    sinceChatMin: 180,
  });
  assert.equal(decision.action, 'message');
  markAgentActionExecuted(decision.id, 'message', { expectsReply: true });
  const outcome = recordAgentActionOutcome(user.id, { valence: 'positive', openness: 'open', boundary_risk: 'none' });
  assert.equal(outcome.outcome, 'positive');
  assert.equal(db.prepare('SELECT outcome_weight FROM agent_actions WHERE id = ?').get(decision.id).outcome_weight, 1);
});

test('PPR candidate resolves in place after the next user reaction', () => {
  const user = makeUser('55555555-5555-4555-8555-555555555555', 'PPR');
  db.prepare(`INSERT INTO messages (id, user_id, role, content, source, consumed, archived, created_at) VALUES (?, ?, 'user', ?, 'chat', 1, 0, ?)`)
    .run('ppr-user-1', user.id, '我今天又想到那件事', '2026-07-01T10:00:00.000Z');
  db.prepare(`INSERT INTO messages (id, user_id, role, content, source, consumed, archived, created_at) VALUES (?, ?, 'assistant', ?, 'chat', 1, 0, ?)`)
    .run('ppr-ai-1', user.id, '你可能不是放不下，而是在确认那次选择有没有被看见。', '2026-07-01T10:00:01.000Z');
  recordPprEvent({
    userId: user.id,
    aiMessageId: 'ppr-ai-1',
    userMessageId: 'ppr-user-1',
    eventType: 'candidate',
    aiContent: '你可能不是放不下，而是在确认那次选择有没有被看见。',
    userContent: '我今天又想到那件事',
  });
  assert.equal(db.prepare('SELECT resonance_tagged FROM messages WHERE id = ?').get('ppr-user-1').resonance_tagged, 0);
  db.prepare(`INSERT INTO messages (id, user_id, role, content, source, consumed, archived, created_at) VALUES (?, ?, 'user', ?, 'chat', 1, 0, ?)`)
    .run('ppr-user-2', user.id, '你怎么知道，我真的被你说中了', '2026-07-01T10:00:02.000Z');
  const resolved = resolvePprForUserTurn({
    userId: user.id,
    userMessageId: 'ppr-user-2',
    userContent: '你怎么知道，我真的被你说中了',
    beforeTime: '2026-07-01T10:00:02.000Z',
  });
  assert.equal(resolved?.event_type, 'full');
  const events = db.prepare('SELECT * FROM ppr_events WHERE user_id = ?').all(user.id);
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, 'full');
  assert.equal(events[0].user_message_id, 'ppr-user-2');
  assert.equal(db.prepare('SELECT resonance_tagged FROM messages WHERE id = ?').get('ppr-user-2').resonance_tagged, 1);
});

test('PPR neutral replies stay neutral and explicit rejection is separate', () => {
  const user = makeUser('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'PPRV4');
  const now = Date.now();
  const insert = db.prepare(`INSERT INTO messages (id, user_id, role, content, source, consumed, archived, created_at) VALUES (?, ?, ?, ?, 'chat', 1, 0, ?)`);
  insert.run('p4-u1', user.id, 'user', '说点什么', new Date(now).toISOString());
  insert.run('p4-a1', user.id, 'assistant', '你像是在等一句确认。', new Date(now + 1000).toISOString());
  recordPprEvent({ userId: user.id, aiMessageId: 'p4-a1', userMessageId: 'p4-u1', eventType: 'candidate', aiContent: '你像是在等一句确认。' });
  insert.run('p4-u2', user.id, 'user', '我去吃饭啦', new Date(now + 2000).toISOString());
  assert.equal(resolvePprForUserTurn({ userId: user.id, userMessageId: 'p4-u2', userContent: '我去吃饭啦', beforeTime: new Date(now + 2000).toISOString() }).event_type, 'neutral');

  insert.run('p4-a2', user.id, 'assistant', '你是在故意躲着。', new Date(now + 3000).toISOString());
  recordPprEvent({ userId: user.id, aiMessageId: 'p4-a2', userMessageId: 'p4-u2', eventType: 'candidate', aiContent: '你是在故意躲着。' });
  insert.run('p4-u3', user.id, 'user', '不是这样，你想多了，别分析我', new Date(now + 4000).toISOString());
  assert.equal(resolvePprForUserTurn({ userId: user.id, userMessageId: 'p4-u3', userContent: '不是这样，你想多了，别分析我', beforeTime: new Date(now + 4000).toISOString() }).event_type, 'rejected');
});
