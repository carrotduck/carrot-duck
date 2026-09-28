import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createRehearsalStore } from '../src/services/rehearsalStore.js';

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('demo'),('other'); CREATE TABLE messages(content TEXT); CREATE TABLE ppr_events(content TEXT); CREATE TABLE memory_entries(content TEXT)");
  const store = createRehearsalStore(db);
  t.after(() => db.close());
  store.enroll('demo', true);
  return { db, store };
}
function speak(store, message, surface = 'chat', overrides = {}) {
  const take = store.snapshot('demo').active;
  return store.turn('demo', { message, surface, take_id: take.id, revision: take.revision, request_id: randomUUID(), ...overrides });
}

test('body rehearsal correlates two text replies, stays preview-only and preserves retry IDs', t => {
  const {store,db} = fixture(t);
  store.start('demo','small_gesture_of_care');
  assert.throws(()=>speak(store,'What is it?'));
  const take=store.active('demo');
  const request={take_id:take.id,revision:take.revision,request_id:randomUUID(),surface:'chat',message:'Are you happy today?'};
  const first=store.turn('demo',request);
  assert.equal(first.body_sync.mode,'preview_only');
  assert.equal(first.body_sync.cue,'happy');
  assert.equal(first.body_sync.assistant_message_id,first.message.id);
  assert.equal(first.body_sync.reply_to_message_id,first.body_sync.user_message_id);
  assert.equal(first.body_sync.user_text,request.message);
  assert.equal(first.expression_plan.command_id,null);
  assert.deepEqual(store.turn('demo',request),first);
  assert.equal(speak(store,'What is it?').body_sync.cue,'hug');
  assert.equal(store.history('demo').messages.length,4);
  for(const table of ['messages','ppr_events','memory_entries'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
});

test('English scripts use distinct scene choreography and English voice plans', t => {
  const { store } = fixture(t);
  store.start('demo', 'presentation');
  assert.equal(store.snapshot('demo').language, 'en');
  speak(store, 'I have a presentation tomorrow. I feel nervous.');
  speak(store, "You'll be my audience?");
  assert.equal(speak(store, "I'll give it a try", 'live2d').expression_plan.live2d.custom_action, 'attentiveLean');
  assert.equal(speak(store, 'Wait a moment. Let me start again.', 'live2d').expression_plan.live2d.custom_action, 'patientNod');
  speak(store, "That's the end of this part", 'live2d');
  assert.match(speak(store, "You didn't rush me", 'live2d').message.content, /So I waited/);
  store.start('demo', 'surprise', store.snapshot('demo').active.id);
  speak(store, 'I feel a bit down today.'); speak(store, "Aren't we already talking?");
  assert.equal(speak(store, "I'm here", 'live2d').expression_plan.live2d.custom_action, 'earReveal');
  const offer = speak(store, 'Where did those ears come from?', 'live2d');
  assert.equal(offer.expression_plan.language, 'en');
  assert.equal(offer.expression_plan.live2d.custom_action, 'offerHead');
  const remembered = speak(store, 'You actually remembered.', 'live2d');
  assert.equal(remembered.message, null);
  assert.equal(remembered.rehearsal.step, 4);
  assert.equal(remembered.expression_plan.live2d.custom_action, 'rememberedSmile');
  assert.equal(remembered.expression_plan.rehearsal.pre_speech, undefined);
  const caught = speak(store, "Aren't those fox ears?", 'live2d');
  assert.equal(caught.expression_plan.live2d.custom_action, 'caughtMe');
  assert.equal(caught.expression_plan.rehearsal.pre_speech, 'caughtMe');
  speak(store, 'A fox works too.', 'live2d');
  assert.equal(speak(store, 'Thank you', 'live2d').expression_plan.rehearsal.ears, true);
  assert.ok(store.history('demo').messages.every(m => !/[\u3400-\u9fff]/.test(m.content)));
});
test('chat stickers persist as separate synthetic messages and retries do not duplicate them', t => {
  const { store, db } = fixture(t);
  for (const [scene, opening, invitation, file] of [
    ['presentation', 'I have a presentation tomorrow', "You'll be my audience?", 'highfive.jpg'],
    ['surprise', 'I feel down today', "Aren't we already talking?", 'fluffy.jpg'],
  ]) {
    store.start('demo', scene, store.active('demo')?.id);
    speak(store, opening);
    const take = store.snapshot('demo').active;
    const body = { take_id: take.id, revision: take.revision, request_id: randomUUID(), message: invitation, surface: 'chat' };
    const result = store.turn('demo', body);
    assert.equal(result.messages.length, 2);
    assert.equal(result.messages[1].content, `[STICKER:${file}]`);
    assert.ok(!result.message.content.includes('[STICKER:'));
    assert.deepEqual(store.turn('demo', body), result);
    assert.equal(store.history('demo').messages.filter(m => m.content.includes('[STICKER:')).length, 1);
    assert.ok(result.messages.every(m => m.metadata.synthetic && !m.ppr_tagged));
  }
  for (const table of ['messages', 'ppr_events', 'memory_entries']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
});

test('only enrolled accounts can start, inspect or control rehearsal', t => {
  const { store } = fixture(t);
  assert.equal(store.active('other'), null);
  for (const fn of [() => store.snapshot('other'), () => store.start('other', 'presentation'), () => store.turn('other', {})]) {
    assert.throws(fn, e => e.status === 403);
  }
  assert.throws(() => store.enroll('missing', true), e => e.status === 404);
});
test('presentation waits silently for explicit completion, without formal research rows', t => {
  const { store, db } = fixture(t);
  store.start('demo', 'presentation');
  assert.match(store.diary('demo').diary[0].content, /pause for a moment/);
  assert.match(speak(store, '明天汇报紧张').message.content, /try a little/);
  speak(store, '你当听众吗');
  assert.throws(() => speak(store, '那我开始咯'), /Open Performance/);
  assert.equal(speak(store, '那我开始咯', 'live2d').message, null);
  const waiting = speak(store, '等一下，我重新说一下', 'live2d');
  assert.equal(waiting.rehearsal.silent, true);
  assert.equal(waiting.expression_plan.live2d.custom_action, 'patientNod');
  assert.equal(waiting.rehearsal.step, 3);
  assert.equal(speak(store, '我们这次研究的是用户体验', 'live2d').rehearsal.step, 3);
  assert.equal(speak(store, '这一段讲完了', 'live2d').message.content, 'Mm-hm. I was listening.');
  assert.match(speak(store, '你刚刚没有催我', 'live2d').message.content, /So I waited/);
  for (const table of ['messages','ppr_events','memory_entries']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
  assert.ok(store.history('demo').messages.every(m => m.metadata.synthetic && !m.ppr_tagged));
});
test('surprise turns ears on only after arriving on stage and keeps them through the joke', t => {
  const { store } = fixture(t);
  store.start('demo', 'surprise');
  assert.equal(speak(store, '今天心情不好').expression_plan.rehearsal.ears, false);
  speak(store, '我们不是在聊天吗');
  const arrived = speak(store, '在啦', 'live2d');
  assert.equal(arrived.rehearsal.silent, true);
  assert.equal(arrived.expression_plan.rehearsal.ears, true);
  assert.match(speak(store, '你怎么长耳朵了', 'live2d').message.content, /pet this one/);
  assert.equal(speak(store, '你竟然还记得', 'live2d').message, null);
  assert.equal(speak(store, '是不是狐狸耳朵', 'live2d').message.content, '...You caught me.');
  assert.equal(speak(store, '哈哈也可以', 'live2d').rehearsal.finished, true);
});
test('retries are idempotent; stale tabs and cross-account controls cannot advance a take', t => {
  const { store } = fixture(t);
  const take = store.start('demo', 'presentation').active;
  const body = { take_id: take.id, revision: take.revision, request_id: randomUUID(), message: '明天汇报', surface: 'chat' };
  const one = store.turn('demo', body);
  assert.deepEqual(store.turn('demo', body), one);
  assert.equal(store.history('demo').messages.length, 2);
  assert.throws(() => store.turn('demo', { ...body, request_id: randomUUID() }), /has changed/);
  store.enroll('other', true);
  assert.throws(() => store.update('other', { take_id: take.id, revision: 1, command: 'stop' }), /has changed/);
  store.start('demo', 'surprise', take.id);
  assert.throws(() => store.turn('demo', body), /ended or changed/);
});
test('pause, one-shot custom reply, retake, exit and revoke preserve earlier takes', t => {
  const { store, db } = fixture(t);
  let take = store.start('demo', 'presentation').active;
  const control = body => {
    take = store.snapshot('demo').active;
    return store.update('demo', { take_id: take.id, revision: take.revision, ...body });
  };
  control({ command: 'pause', paused: true });
  assert.throws(() => speak(store, '明天汇报'), /paused/);
  control({ command: 'pause', paused: false });
  control({ command: 'reply', text: '我来当听众。', action: 'nod', ears: false });
  const manual = speak(store, '自由输入');
  assert.equal(manual.message.content, '我来当听众。');
  assert.equal(manual.rehearsal.step, 0);
  assert.equal(store.snapshot('demo').active.pending_reply, null);
  assert.throws(() => control({ command: 'reply', text: 'abc', action: 'fire' }), /Invalid/);
  store.start('demo', 'presentation', take.id);
  assert.equal(store.history('demo').messages.length, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM rehearsal_turns').get().n, 2);
  control({ command: 'stop' });
  assert.equal(store.history('demo'), null);
  store.start('demo', 'surprise'); store.enroll('demo', false);
  assert.equal(store.active('demo'), null);
  assert.throws(() => store.snapshot('demo'), e => e.status === 403);
  db.prepare('DELETE FROM users WHERE id=?').run('demo');
  assert.equal(db.prepare('SELECT count(*) AS n FROM rehearsal_turns').get().n, 0);
});
