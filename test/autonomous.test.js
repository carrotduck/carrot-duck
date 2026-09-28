import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutonomousAgent, validateDecision, eligibleMemory } from '../src/services/autonomous.js';
const memory = (id, content, more = {}) => ({ id, content, status: 'active', epistemic_mode: 'grounded', confidence: 'high', ...more });
const reply = (ids = [], action = 'softSmile') => ({ reply: 'A fresh reply', memory_ids: ids, action, invitation: false, intensity: 0.6 });
test('unknown evidence and unsupported actions fail closed', () => {
  assert.throws(() => validateDecision(reply(['invented']), [memory('real', 'A fact')]));
  assert.throws(() => validateDecision(reply([], 'servo:500'), []));
  assert.throws(() => validateDecision({ ...reply(), reply: '' }, []));
  assert.throws(() => validateDecision({ ...reply(), reply: "I don't have any saved notes about that." }, [], false, false));
  assert.throws(() => validateDecision({ ...reply(), reply: "I don't have anything saved about what helps you unwind." }, [], false, false));
});
test('only active grounded non-low-confidence records qualify', () => {
  assert.equal(eligibleMemory(memory('a', 'a')), true);
  for (const attrs of [{ status: 'recycled' }, { epistemic_mode: 'imagination' }, { confidence: 'low' }])
    assert.equal(eligibleMemory(memory('a', 'a', attrs)), false);
});
test('retrieves for this user, filters invalid evidence, retains exact citations', async () => {
  const calls = [];
  const run = createAutonomousAgent({ model: async messages => {
    if (messages[0].content.includes('search query')) return { text: '{"query":"comfort"}' };
    const data = JSON.parse(messages[1].content);
    assert.deepEqual(data.EVIDENCE.map(m => m.id), ['walk']);
    return { text: JSON.stringify({ ...reply(['walk'], 'offerHead'), invitation: true, intent: 'invite' }) };
  }, search: async (id, q) => { calls.push([id, q]); return [memory('walk', 'Walking helped'), memory('fake', 'A dream', { epistemic_mode: 'imagination' })]; }, recentGrounded: async () => [] });
  const result = await run({ user: { id: 'owner' }, message: 'I feel low' });
  assert.deepEqual(calls, [['owner', 'I feel low'], ['owner', 'comfort']]);
  assert.equal(result.trace.used[0].id, 'walk');
  assert.equal(result.decision.action, 'offerHead');
});
test('no evidence is an empty evidence set, not a preset cat story', async () => {
  const run = createAutonomousAgent({ model: async messages => {
    if (messages[0].content.includes('search query')) return { text: '{"query":"comfort"}' };
    assert.deepEqual(JSON.parse(messages[1].content).EVIDENCE, []);
    return { text: JSON.stringify(reply()) };
  }, search: async () => [], recentGrounded: async () => [] });
  assert.equal((await run({ user: { id: 'owner' }, message: 'Hello' })).trace.used.length, 0);
});
for (const options of [{ message: 'No thanks, stop.' }, { useMemory: false }, { boundary: { memoryMode: 'blocked' } }]) {
  test(`no recall bypass on refusal/opt-out/boundary ${JSON.stringify(options)}`, async () => {
    const run = createAutonomousAgent({ search: async () => assert.fail('must not retrieve'), recentGrounded: async () => assert.fail('must not list'),
      model: async messages => {
        const input = JSON.parse(messages[1].content); assert.deepEqual(input.EVIDENCE, []); assert.deepEqual(input.history, []);
        return { text: JSON.stringify(reply([], 'offerHead')) };
      } });
    const result = await run({ user: { id: 'owner' }, message: 'Hello', history: [{ role: 'assistant', content: 'old sensitive recall' }], ...options });
    assert.equal(result.trace.memory_enabled, false);
    if (options.message) assert.equal(result.decision.action, 'listening');
  });
}
test('two invalid generations return an error, not scripted fallback', async () => {
  let count = 0;
  const run = createAutonomousAgent({ model: async () => { count++; return { text: JSON.stringify(reply(['unknown'])) }; }, search: async () => [], recentGrounded: async () => [] });
  await assert.rejects(run({ user: { id: 'owner' }, message: 'Hi', useMemory: false }), /failed validation/);
  assert.equal(count, 2);
});
