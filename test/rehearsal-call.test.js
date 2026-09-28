import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/carrot-duck-rehearsal-call.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(deliver = async () => {}) {
  const instances = [], states = [], errors = [], lines = [], timers = new Map(); let current = true, serial = 0;
  class Recognition {
    constructor() { instances.push(this); }
    start() { this.onstart?.(); }
    abort() { this.aborted = true; this.onend?.(); }
    results(parts) {
      this.onresult?.({ results: parts.map(([text, final]) => Object.assign([{ transcript: text }], { isFinal: final })) });
    }
  }
  const context = vm.createContext({ setTimeout: fn => { timers.set(++serial, fn); return serial; }, clearTimeout: id => timers.delete(id) });
  vm.runInContext(source, context);
  const call = context.CarrotDuckRehearsalCall.create({ Recognition, deliver: async (...args) => { lines.push(args[0]); await deliver(...args); },
    isCurrent: () => current, onState: s => states.push(s), onInterim() {}, onError: e => errors.push(e) });
  return { call, instances, states, errors, lines, invalidate: () => { current = false; }, retry: () => { const fns = [...timers.values()]; timers.clear(); fns.forEach(fn => fn()); } };
}
test('final results are delivered once, interim updates and silence never submit', async () => {
  const f = fixture(); f.call.start(); const mic = f.instances[0];
  assert.equal(mic.continuous, true);
  mic.results([['Today', false]]); await flush(); assert.equal(f.lines.length, 0);
  mic.results([['Today I present my project.', true]]); await flush();
  mic.results([['Today I present my project.', true], ['Wait', false]]); await flush();
  assert.deepEqual(f.lines, ['Today I present my project.']);
  mic.onend(); f.retry(); assert.equal(f.instances.length, 2);
  assert.equal(f.lines.length, 1); f.call.stop();
});
test('recognition stops before playback and resumes only after playback completes', async () => {
  let finish;
  const f = fixture(async (text, beforeSpeak) => { beforeSpeak(); await new Promise(resolve => { finish = resolve; }); });
  f.call.start(); const mic = f.instances[0]; const lateResult = mic.onresult;
  mic.results([['That is all.', true]]); await flush();
  assert.equal(mic.aborted, true); assert.equal(f.instances.length, 1);
  lateResult({ results: [Object.assign([{ transcript: 'Duck echo' }], { isFinal: true })] });
  finish(); await flush(); assert.equal(f.instances.length, 2);
  assert.deepEqual(f.lines, ['That is all.']); f.call.stop();
});
test('hangup discards pending work and late playback cannot restart recording', async () => {
  let finish;
  const f = fixture(async (text, beforeSpeak) => { beforeSpeak(); await new Promise(resolve => { finish = resolve; }); });
  f.call.start(); f.instances[0].results([['Done', true], ['Queued', true]]); await flush();
  f.call.stop(); finish(); await flush(); f.retry();
  assert.equal(f.call.active, false); assert.equal(f.instances.length, 1); assert.deepEqual(f.lines, ['Done']);
});
test('permission failures and revoked accounts cannot restart a microphone', async () => {
  const f = fixture(); f.call.start(); f.instances[0].onerror({ error: 'not-allowed' });
  f.retry(); assert.equal(f.call.active, false); assert.equal(f.errors.length, 1);
  const g = fixture(); g.call.start(); g.invalidate(); g.instances[0].results([['late', true]]);
  await flush(); assert.equal(g.lines.length, 0); g.call.stop();
});
test('repeated empty disconnects have a bounded retry budget', () => {
  const f = fixture(); f.call.start();
  for (let i = 0; i < 13; i++) { f.instances.at(-1).onend(); f.retry(); }
  assert.equal(f.call.active, false); assert.equal(f.errors.length, 1);
});
