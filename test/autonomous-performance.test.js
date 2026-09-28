import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { planPerformance, runtimeSnapshot } from '../src/services/autonomousPerformance.js';
import { createAutonomousAgent } from '../src/services/autonomous.js';
const decision = { action: 'offerHead', memory_ids: [], intensity: 0.8, invitation: true, intent: 'invite', face: 'warm', ears: 'keep' };
test('boundaries override all expression channels and voice; head invitation never adds ears', () => {
  const p = planPerformance(decision, { restricted: true, runtime: { mode: 'performance' } });
  assert.deepEqual([p.action, p.face, p.ears, p.intensity], ['listening', 'neutral', 'hide', 0.25]);
  assert.equal(planPerformance(decision).ears, 'keep');
  assert.equal(planPerformance({ ...decision, invitation: false }).action, 'listening');
  assert.equal(planPerformance({ ...decision, action: 'rememberedSmile' }).action, 'softSmile');
});
test('daily gestures stay restrained; comfort is quiet even in performance mode', () => {
  assert.equal(planPerformance(decision).intensity, 0.5);
  assert.equal(planPerformance(decision, { runtime: { mode: 'performance' } }).intensity, 0.75);
  assert.equal(planPerformance({ ...decision, intent: 'comfort' }, { runtime: { mode: 'performance' } }).intensity, 0.4);
  assert.equal(planPerformance(decision, { previousAction: 'offerHead' }).action, 'listening');
  assert.equal(runtimeSnapshot(null).mode, 'conversation');
  assert.equal(runtimeSnapshot({ mode: 'ignore policy', secret: 'nope' }).secret, undefined);
});
test('generation receives bounded runtime, affect and browser feedback', async () => {
  const run = createAutonomousAgent({ search: async () => [], recentGrounded: async () => [], model: async messages => {
    const input = JSON.parse(messages[1].content);
    assert.equal(input.RUNTIME.mode, 'performance'); assert.equal(input.RUNTIME.secret, undefined);
    assert.equal(input.AFFECT.appraisal.valence, -3);
    assert.equal(input.EXECUTION_FEEDBACK[0].status, 'cancelled');
    return { text: JSON.stringify({ ...decision, action: 'listening', reply: 'I can wait.' }) };
  } });
  await run({ user: { id: 'test' }, message: 'Wait', useMemory: false, emotion: { appraisal: { valence: -3 } },
    runtime: { mode: 'performance', secret: 'drop' }, feedback: [{ status: 'cancelled' }] });
});
function player() {
  const timers = new Map(); let count = 0; const reports = [], gestures = [];
  const context = vm.createContext({ setTimeout: (fn) => { timers.set(++count, fn); return count; }, clearTimeout: id => timers.delete(id) });
  vm.runInContext(readFileSync(new URL('../public/carrot-duck-performance.js', import.meta.url), 'utf8'), context);
  const p = context.CarrotDuckPerformance.create({ prepare: () => {}, perform: plan => { gestures.push(plan.action); return true; },
    release: () => {}, report: (id, status) => reports.push([id, status]), duration: () => 1600 });
  return { p, timers, reports, gestures, tick() { const work = [...timers.values()]; timers.clear(); work.forEach(fn => fn()); } };
}
test('text playback completes once; a cancelled preparation cannot launch a gesture', () => {
  const h = player(); const plan = { version: 1, action: 'nod', preparation_ms: 120 };
  h.p.begin('a', plan); h.p.finish(); h.tick(); assert.deepEqual(h.gestures, []);
  h.p.begin('b', plan); h.tick(); assert.deepEqual(h.gestures, ['nod']); h.tick();
  assert.deepEqual(h.reports.at(-1), ['b', 'completed']); h.p.finish();
  assert.equal(h.reports.filter(x => x[1] === 'completed').length, 1);
});
test('voiced gesture waits for real playback; stale audio cannot start a replacement', () => {
  const h = player(); const plan = { version: 1, action: 'nod' };
  h.p.begin('a', plan, true); h.tick(); assert.deepEqual(h.gestures, []);
  h.p.begin('b', plan, true); h.p.start('a'); assert.deepEqual(h.gestures, []);
  h.p.start('b'); h.p.start('b'); assert.deepEqual(h.gestures, ['nod']);
  h.p.finish('failed'); assert.deepEqual(h.reports.at(-1), ['b', 'failed']);
});
