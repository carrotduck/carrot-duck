import assert from 'node:assert/strict';
import test from 'node:test';
import { createReplyDelivery } from '../src/services/replyDelivery.js';

function completionHarness(performanceMode, contents = ['Hello from the fixture']) {
  const events = [];
  const commands = [];
  const metadata = new Map();
  const completed = [];
  let voiceCalls = 0;
  let endCalls = 0;
  let finishVoice;
  const voice = new Promise((resolve) => { finishVoice = resolve; });
  const deliver = createReplyDelivery({
    db: { prepare: () => ({
      run: (value, id) => metadata.set(id, value),
      get: (id) => ({ metadata: metadata.get(id) || '{}' }),
    }) },
    userRequestedVoice: () => true,
    isStickerOnlyContent: (text) => text === '[sticker]',
    detectVoiceTurnContext: () => ({}),
    emitVoiceBubbleIfNeeded: () => { voiceCalls++; return voice; },
    buildExpressionPlan: () => ({ command_id: performanceMode ? 'fixture-command' : null }),
    createDeliveryCommand: (command) => commands.push(command),
    completeModelRun: (...args) => completed.push(args),
    appVersion: 'test',
  });
  const input = {
    performanceMode, user: { id: 'fixture-user' }, storedContent: 'Please speak',
    finalCleaned: 'Hello from the fixture', userMsgId: 'fixture-turn',
    voiceCall: true, voiceTagged: true, recent: [], emotionState: {},
    affectiveSignal: {}, relationalState: {}, relationshipProfile: {},
    turnPlan: {}, modelRun: { id: 'fixture-run' }, parts: contents,
    assistantMessages: contents.map((content, index) => ({ id: 'message-' + index, content })),
    res: {
      write: (data) => events.push(JSON.parse(data.slice(6))),
      end: () => { endCalls++; },
    },
  };
  return {
    run: () => deliver(input), events, commands, metadata, completed,
    voiceCalls: () => voiceCalls, endCalls: () => endCalls, finishVoice,
  };
}

test('performance final reply bypasses unused chat TTS but still creates its delivery command', async () => {
  const h = completionHarness(true);
  await h.run();
  assert.equal(h.voiceCalls(), 0);
  assert.equal(h.commands.length, 1);
  assert.equal(h.commands[0].messageId, 'message-0');
  assert.equal(h.events.at(-1).expression_plan.command_id, 'fixture-command');
  assert.equal(h.completed.length, 1);
  assert.equal(h.endCalls(), 1);
});

test('regular chat waits for its requested voice bubble and preserves voice metadata', async () => {
  const h = completionHarness(false);
  const pending = h.run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.voiceCalls(), 1);
  assert.equal(h.events.length, 0);
  h.finishVoice({ url: '/fixture.wav', text: 'Hello from the fixture', duration: 1 });
  await pending;
  assert.deepEqual(h.events.map((event) => event.type), ['voice_bubble', 'done']);
  assert.equal(h.commands.length, 0);
  const saved = JSON.parse(h.metadata.get('message-0'));
  assert.equal(saved.assistant_voice.url, '/fixture.wav');
  assert.equal(saved.turn_id, 'fixture-turn');
  assert.equal(saved.app_version, 'test');
  assert.equal(h.endCalls(), 1);
});

test('voice attaches to spoken text rather than the trailing sticker', async () => {
  const h = completionHarness(false, ['Hello', '[sticker]']);
  h.finishVoice({ url: '/fixture.wav', text: 'Hello', duration: 1 });
  await h.run();
  assert.equal(JSON.parse(h.metadata.get('message-0')).assistant_voice.transcript, 'Hello');
  assert.equal(JSON.parse(h.metadata.get('message-1')).assistant_voice, undefined);
  assert.ok(JSON.parse(h.metadata.get('message-1')).expression_plan);
});

test('an empty performance result creates no command for a missing message', async () => {
  const h = completionHarness(true, []);
  await h.run();
  assert.equal(h.commands.length, 0);
  assert.equal(h.events.at(-1).message, null);
  assert.equal(h.endCalls(), 1);
});
