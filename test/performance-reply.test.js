import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Exercise the real completion callback with storage/model providers replaced by fixtures.
const source = readFileSync(new URL('../src/routes/chat.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('onEnd: async (raw, err) => {');
const end = source.indexOf('\n      },\n    }\n  );', start);
assert.ok(start >= 0 && end > start);
const callback = source.slice(start + 'onEnd: '.length, end) + '\n}';

function completionHarness(performanceMode) {
  const events = []; const commands = [];
  let voiceCalls = 0;
  let finishVoice;
  const voice = new Promise((resolve) => { finishVoice = resolve; });
  const noop = () => {};
  const context = vm.createContext({
    performanceMode, fullText: '', user: { id: 'fixture-user' }, storedContent: 'Please speak',
    uiLang: 'zh', userMsgId: 'fixture-turn', voiceCall: true, goodNight: false,
    systemMessages: [], apiMessages: [], memories: [], innerMemories: [], recent: [],
    sessionBuffers: new Map(), emotionState: {}, affectiveSignal: {}, relationalState: {},
    relationshipProfile: {}, turnPlan: {}, modelRun: { id: 'fixture-run' }, APP_VERSION: 'test',
    res: { write: (data) => events.push(JSON.parse(data.slice(6))), end: noop },
    db: { prepare: () => ({ run: noop, get: () => ({ metadata: '{}' }) }) }, uuid: () => 'fixture-message',
    stripPprTag: (text) => ({ cleaned: text, tagged: false, voiceTagged: true }),
    sanitizeStickerMarkup: (text) => text, stripRecallTags: (text) => text,
    extractRecallQueries: () => [], userRequestedVoice: () => true,
    rewriteVoiceDenialReply: (text) => text, splitAssistantBubbleParts: (text) => [text],
    isStickerOnlyContent: () => false, maybeWriteMemoryFromChat: async () => {},
    maybeExtractWorldbook: async () => {}, extractTodosFromChat: async () => {},
    saveEmotionState: noop, refineEmotionAsync: async () => {}, detectVoiceTurnContext: () => ({}),
    emitVoiceBubbleIfNeeded: () => { voiceCalls++; return voice; },
    buildExpressionPlan: () => ({ command_id: performanceMode ? 'fixture-command' : null }),
    createDeliveryCommand: (command) => commands.push(command), completeModelRun: noop,
  });
  return { run: vm.runInContext(`(${callback})`, context), events, commands,
    voiceCalls: () => voiceCalls, finishVoice };
}

test('performance final reply bypasses unused chat TTS but still creates its delivery command', async () => {
  const h = completionHarness(true);
  await h.run('Hello from the fixture');
  assert.equal(h.voiceCalls(), 0);
  assert.equal(h.commands.length, 1);
  assert.equal(h.events.at(-1).type, 'done');
  assert.equal(h.events.at(-1).expression_plan.command_id, 'fixture-command');
});

test('regular chat still emits its requested voice bubble', async () => {
  const h = completionHarness(false);
  const pending = h.run('Hello from the fixture');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.voiceCalls(), 1);
  assert.equal(h.events.length, 0);
  h.finishVoice({ url: '/fixture.wav', text: 'Hello from the fixture', duration: 1 });
  await pending;
  assert.deepEqual(h.events.map((event) => event.type), ['voice_bubble', 'done']);
  assert.equal(h.commands.length, 0);
});
