import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const library = readFileSync(new URL('../public/carrot-duck-motion.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/live2d-demo.html', import.meta.url), 'utf8');

function controller() {
  const context = vm.createContext({ performance: { now: () => 0 } });
  vm.runInContext(library, context);
  return context.CarrotDuckMotion.createController({ random: () => 0 });
}

function advance(motion, end = 900, options = {}) {
  let frame;
  for (let time = 0; time <= end; time += 10) frame = motion.sample(time, options);
  return frame;
}

test('all gestures are bounded and return to neutral without opening a silent mouth', () => {
  for (const action of ['nod', 'shakeHead', 'softSmile', 'thinking', 'listening', 'greet', 'shy', 'breathe', 'attentiveLean', 'patientNod', 'earReveal', 'offerHead', 'amused', 'rememberedSmile', 'caughtMe']) {
    const motion = controller();
    assert.equal(motion.trigger(action, { now: 0 }), true);
    for (let time = 0; time < 6000; time += 16) {
      const frame = motion.sample(time);
      assert.equal(frame.params.ParamMouthOpenY, 0, action);
      assert.ok(Object.values(frame.params).every(Number.isFinite), action);
      assert.ok(Math.abs(frame.params.ParamAngleX) < 30, action);
      assert.ok(Math.abs(frame.params.ParamAngleY) < 30, action);
    }
    const settled = motion.sample(6010);
    assert.equal(settled.action, null);
    assert.ok(Math.abs(settled.params.ParamMouthForm) < 0.01, action);
  }
});

test('normal conversational strength produces a visible nod, with restrained idle motion', () => {
  const motion = controller();
  motion.trigger('nod', { now: 0, strength: 0.5 });
  assert.ok(Math.abs(advance(motion, 900).params.ParamAngleY) > 6);
  const idle = advance(controller(), 900);
  assert.ok(Math.abs(idle.params.ParamAngleY) < 1);
});

test('scenario gestures are distinct, visible and remain bounded with reduced motion', () => {
  for (const name of ['attentiveLean', 'patientNod', 'earReveal', 'offerHead', 'amused', 'rememberedSmile', 'caughtMe']) {
    const normal = controller(), reduced = controller();
    normal.trigger(name, { now: 0, strength: 0.8 });
    reduced.setReducedMotion(true); reduced.trigger(name, { now: 0, strength: 0.8 });
    let peak = 0, reducedPeak = 0;
    for (let t = 0; t < 4000; t += 16) {
      const a = normal.sample(t).params, b = reduced.sample(t).params;
      peak = Math.max(peak, Math.abs(a.ParamAngleY), Math.abs(a.ParamAngleZ));
      reducedPeak = Math.max(reducedPeak, Math.abs(b.ParamAngleY), Math.abs(b.ParamAngleZ));
    }
    assert.ok(peak > 4, name);
    assert.ok(reducedPeak < peak * 0.35, name);
  }
});

test('thinking pose persists and speech beats follow phrases rather than a periodic loop', () => {
  const thinking = controller(); thinking.setState('thinking');
  assert.ok(advance(thinking, 5000).params.ParamAngleX < -4);
  const voiced = controller(); voiced.setState('speaking'); voiced.setSpeechStyle('breathe', 0.6);
  const silent = controller(); silent.setState('speaking'); silent.setSpeechStyle('breathe', 0.6);
  const a = advance(voiced, 900, { mouth: { active: true, open: 0.5 } });
  const b = advance(silent, 900, { mouth: { active: true, open: 0 } });
  assert.ok(Math.abs(a.params.ParamAngleY - b.params.ParamAngleY) > 1);
  assert.equal(b.params.ParamMouthOpenY, 0);
  const settled = advance(voiced, 5000, { mouth: { active: true, open: 0.5 } });
  assert.ok(Math.abs(settled.params.ParamAngleY) < 1, 'Continuous voicing must not trigger repeated nods');
});

test('patient nod is one clearly visible dip during silent listening', () => {
  const motion = controller(); motion.setState('listening');
  motion.trigger('patientNod', { now: 0, strength: 0.8 });
  let deepest = 0;
  for (let t = 0; t < 3000; t += 16) {
    const frame = motion.sample(t);
    deepest = Math.min(deepest, frame.params.ParamAngleY);
    assert.equal(frame.params.ParamMouthOpenY, 0);
  }
  assert.ok(deepest < -18);
});

test('intensity, reduced motion and boundary controls lower movement', () => {
  const normal = controller(); normal.trigger('nod', { now: 0 });
  const low = controller(); low.setIntensity(0.2); low.trigger('nod', { now: 0 });
  const reduced = controller(); reduced.setReducedMotion(true); reduced.trigger('nod', { now: 0 });
  const baseline = Math.abs(advance(normal).params.ParamAngleY);
  assert.ok(Math.abs(advance(low).params.ParamAngleY) < baseline * 0.4);
  assert.ok(Math.abs(advance(reduced).params.ParamAngleY) < baseline * 0.3);
  const boundary = controller(); boundary.setBoundary('deescalate'); boundary.trigger('shy', { now: 0 });
  assert.equal(advance(boundary).action, 'listening');
  assert.equal(boundary.trigger('unknown', { now: 1000 }), false);
});

test('mouth follows speech, including closed visemes during a smile', () => {
  const motion = controller();
  motion.setState('speaking');
  motion.setSpeechStyle('softSmile');
  motion.trigger('softSmile', { now: 0 });
  const speaking = advance(motion, 900, { mouth: { active: true, open: 0.8, form: 0.3, funnel: 0.2 } });
  assert.equal(speaking.params.ParamMouthOpenY, 0.8);
  assert.ok(speaking.params.ParamMouthForm > 0.3);
  assert.equal(motion.sample(920, { mouth: { active: true, open: 0 } }).params.ParamMouthOpenY, 0);
  motion.release(); motion.setState('idle');
  assert.equal(motion.sample(940).params.ParamMouthOpenY, 0);
});

test('blink closes fully and resuming after a long hidden interval remains finite', () => {
  const motion = controller();
  advance(motion, 2680);
  assert.equal(motion.sample(2690).blink, 0);
  motion.trigger('thinking', { now: 2700, force: true });
  const resumed = motion.sample(10000000);
  assert.equal(resumed.action, null);
  assert.equal(resumed.blink, 1);
  assert.ok(Object.values(resumed.params).every(Number.isFinite));
});

test('pointer tracking is visible, smooth and yields to scenario gestures', () => {
  const motion = controller();
  const right = advance(motion, 1000, { pointer: { active: true, x: 1, y: 0.5 } });
  assert.ok(right.params.ParamAngleX > 12);
  const left = motion.sample(1016, { pointer: { active: true, x: 0, y: 0.5 } });
  assert.ok(Math.abs(left.params.ParamAngleX - right.params.ParamAngleX) <= 36 * 0.016 + 1e-9);
  const gesture = controller(); gesture.trigger('patientNod', { now: 0 });
  const dip = advance(gesture, 1300, { pointer: { active: true, x: 1, y: 0 } });
  assert.ok(dip.params.ParamAngleY < -15, 'Looking up must not cancel a nod');
  const reduced = controller(); reduced.setReducedMotion(true);
  assert.ok(advance(reduced, 1000, { pointer: { active: true, x: 1, y: 0.5 } }).params.ParamAngleX < 4);
});

test('smiles soften eyelids while keeping silent lips closed', () => {
  const motion = controller(); motion.trigger('amused', { now: 0 });
  const smile = advance(motion, 1300);
  assert.ok(smile.params.ParamEyeLOpen < 0.9);
  assert.ok(smile.params.ParamMouthForm > 0.6);
  assert.equal(smile.params.ParamMouthOpenY, 0);
});

test('expressive poses hold before returning, with eyes leading the head and body', () => {
  const motion = controller(); motion.trigger('offerHead', { now: 0 });
  const held = advance(motion, 2100);
  assert.ok(held.params.ParamAngleY < -11);
  assert.equal(held.params.ParamBodyAngleY, 0, 'Offering a head pat must not bow the torso');
  const eased = advance(motion, 4700);
  assert.ok(Math.abs(eased.params.ParamAngleY) < 1);
  const follow = controller();
  const first = follow.sample(0, { pointer: { active: true, x: 1, y: 0.5 } }).params;
  assert.ok(first.ParamEyeBallX / 0.7 > first.ParamAngleX / 15);
  assert.ok(first.ParamAngleX / 15 > first.ParamBodyAngleX / 3);
});

function mouthController() {
  const context = vm.createContext({}); vm.runInContext(library, context);
  return context.CarrotDuckMotion.createMouthSmoother();
}

test('caught-me blush precedes head turn; remembered smile is silent and tilted', () => {
  const motion = controller(); motion.trigger('caughtMe', { now: 0, strength: 0.8 });
  const blush = advance(motion, 300);
  assert.ok(blush.blush > 0.4);
  assert.ok(Math.abs(blush.params.ParamAngleX) < 1);
  const turned = advance(motion, 1200);
  assert.ok(turned.params.ParamAngleX < -7);
  assert.equal(turned.params.ParamMouthOpenY, 0);
  motion.release();
  assert.equal(motion.sample(1220).blush, 0);
  motion.setBoundary('deescalate'); motion.trigger('caughtMe', { now: 1240 });
  assert.equal(motion.sample(1400).action, 'listening');
  assert.equal(motion.sample(1410).blush, 0);
  const smile = controller(); smile.trigger('rememberedSmile', { now: 0, strength: 0.8 });
  const frame = advance(smile, 1600);
  assert.ok(frame.params.ParamAngleZ > 5);
  assert.ok(frame.params.ParamEyeLSmile > 0.5);
  assert.equal(frame.params.ParamMouthOpenY, 0);
});

test('stronger blush stays within the rig range and fades only on natural completion', () => {
  const motion = controller(); motion.trigger('caughtMe', { now: 0, strength: 0.8 });
  const full = advance(motion, 1500);
  assert.equal(full.blush, 1);
  motion.release({ fadeBlush: true }); motion.setState('idle');
  const tail = [1500, 1700, 1900, 2200, 2400].map(time => motion.sample(time).blush);
  assert.equal(tail[0], 1); assert.equal(tail.at(-1), 0);
  assert.ok(tail.slice(1).every((value, i) => value < tail[i]));
  motion.trigger('caughtMe', { now: 2500, strength: 1 });
  for (let time = 2500; time < 4000; time += 10) assert.ok(motion.sample(time).blush <= 1);
  motion.release({ fadeBlush: true }); motion.setBoundary('deescalate');
  assert.equal(motion.sample(4010).blush, 0);
});

test('blush tint affects only its authored mesh, preserving masks, colors and geometry', () => {
  const context = vm.createContext({}); vm.runInContext(library, context);
  const vertices = new Float32Array([1, 2, 3, 4]);
  const other = new Float32Array([5, 6]);
  const calls = []; let color = { R: 0.9, G: 0.8, B: 0.7, A: 0.6 }, mask = null, throws = false;
  const originalColor = { ...color };
  const original = function (...args) { calls.push({ color: { ...color }, args }); if (throws) throw new Error('render failed'); };
  const renderer = { drawMesh: original, getModelColor: () => ({ ...color }),
    setModelColor: (R, G, B, A) => { color = { R, G, B, A }; }, getClippingContextBufferForMask: () => mask };
  const core = { getDrawableIndex: id => id === 'ArtMesh9' ? 2 : -1, getDrawableVertexPositions: () => vertices };
  assert.equal(context.CarrotDuckMotion.tintBlushMesh(renderer, core, 'missing'), null);
  const restore = context.CarrotDuckMotion.tintBlushMesh(renderer, core, 'ArtMesh9');
  renderer.drawMesh(0, 0, 0, null, vertices);
  assert.deepEqual(calls[0].color, { R: 0.9, G: 0.2, B: 0.7 * 0.36, A: 0.6 });
  assert.equal(calls[0].args[4], vertices); assert.deepEqual(Array.from(vertices), [1, 2, 3, 4]);
  assert.deepEqual(color, originalColor);
  renderer.drawMesh(0, 0, 0, null, other);
  assert.deepEqual(calls[1].color, originalColor);
  mask = {}; renderer.drawMesh(0, 0, 0, null, vertices);
  assert.deepEqual(calls[2].color, originalColor);
  mask = null; throws = true;
  assert.throws(() => renderer.drawMesh(0, 0, 0, null, vertices), /render failed/);
  assert.deepEqual(color, originalColor);
  restore(); assert.equal(renderer.drawMesh, original);
});

test('mouth blends rapid shape changes instead of flapping once per character', () => {
  const mouth = mouthController(); let previousRaw = 0, previous = 0, rawVariation = 0, variation = 0;
  for (let time = 0; time <= 2000; time += 10) {
    const raw = Math.floor(time / 60) % 2 ? 0.2 : 0.9;
    const frame = mouth.sample(time, { active: true, open: raw, form: raw });
    if (time > 300) { rawVariation += Math.abs(raw - previousRaw); variation += Math.abs(frame.open - previous); }
    assert.ok(frame.open <= 0.6);
    assert.ok(Math.abs(frame.open - previous) <= (time === 0 ? 4/60 : 0.04) + 1e-9);
    previousRaw = raw; previous = frame.open;
  }
  assert.ok(variation < rawVariation * 0.45);
});

test('mouth bridges a brief gap, closes on a real pause, and resets immediately on stop', () => {
  const mouth = mouthController(); let frame;
  for (let t=0;t<=500;t+=10) frame = mouth.sample(t,{active:true,open:0.5,form:0.4});
  for (let t=510;t<=530;t+=10) frame = mouth.sample(t,{active:true,open:0});
  assert.ok(frame.open > 0.3);
  for (let t=540;t<=800;t+=10) frame = mouth.sample(t,{active:true,open:0});
  assert.equal(frame.open,0);
  for (let t=810;t<=1100;t+=10) mouth.sample(t,{active:true,open:0.8});
  assert.equal(mouth.sample(1110,{active:false}).open,0);
  assert.equal(mouth.sample(5000,{active:true,open:0}).open,0);
});

test('mouth is frame-rate independent and does not inherit the last clip pose', () => {
  const results = [30,60,120].map(fps=>{
    const mouth = mouthController(); let frame;
    for(let i=0;i<=fps;i++) frame=mouth.sample(i*1000/fps,{active:true,open:0.45,form:0.3});
    mouth.reset(); assert.equal(mouth.sample(1010,{active:true,open:0}).open,0);
    return frame.open;
  });
  assert.ok(Math.max(...results)-Math.min(...results)<0.01);
});

test('action cooldown and replacement preserve a continuous pose', () => {
  const motion = controller();
  motion.trigger('nod', { now: 0 });
  assert.equal(motion.trigger('shy', { now: 200 }), false);
  const before = advance(motion, 800);
  motion.trigger('thinking', { now: 800, force: true });
  const after = motion.sample(816);
  assert.ok(Math.abs(after.params.ParamAngleY - before.params.ParamAngleY) < 0.6);
});

test('writer checks actual model capabilities and clamps without creating virtual parameters', () => {
  const context = vm.createContext({}); vm.runInContext(library, context);
  const writes = [];
  const writer = context.CarrotDuckMotion.createParameterWriter({
    _model: { parameters: { ids: ['ParamAngleX'] } },
    getParameterCount: () => 1, getParameterMinimumValue: () => -30,
    getParameterMaximumValue: () => 30, getParameterValueByIndex: () => 3,
    setParameterValueByIndex: (index, value) => writes.push([index, value]),
  });
  assert.equal(writer.set('Unknown', 1), false);
  assert.equal(writer.set('ParamAngleX', NaN), false);
  assert.equal(writer.set('ParamAngleX', 99), true);
  assert.deepEqual(writes, [[0, 30]]);
});

function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function pageHarness() {
  let now = 100, sampleValue = 128;
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, { value: '', style: {}, textContent: '', disabled: false, checked: false,
      addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
    return elements.get(id);
  };
  const requests = []; const plays = [];
  const timers = new Map(); let timerId = 0;
  class FakeAudio {
    constructor(url) { this.src = url; this.paused = true; this.currentTime = 0; this.ended = false; }
    play() { this.paused = false; plays.push(this); this.onplaying?.(); return Promise.resolve(); }
    pause() { this.paused = true; }
    removeAttribute() { this.src = ''; }
    load() {}
  }
  class FakeContext {
    state = 'running';
    createAnalyser() { return { fftSize: 512, connect() {}, disconnect() {}, getByteTimeDomainData: (samples) => samples.fill(sampleValue) }; }
    createMediaElementSource() { return { connect() {}, disconnect() {} }; }
  }
  const context = vm.createContext({
    console, URL, URLSearchParams, AbortController, Uint8Array,
    performance: { now: () => now },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    Audio: FakeAudio, AudioContext: FakeContext,
    document: { getElementById: getElement, querySelectorAll: () => [],
      body: { dataset: {}, classList: { add() {} } }, addEventListener() {} },
    location: { origin: 'http://localhost', search: '' },
    localStorage: { getItem: () => '' },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    fetch: (url, options) => {
      const pending = deferred(); requests.push({ url, options, ...pending }); return pending.promise;
    },
  });
  context.window = context; context.parent = context;
  context.postMessage = () => {};
  vm.runInContext(library, context);
  vm.runInContext(readFileSync(new URL('../public/carrot-duck-performance.js', import.meta.url), 'utf8'), context);
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  vm.runInContext(inline.replace(/boot\(\)\.catch\([\s\S]*?\n    \}\);/, ''), context);
  const result = (url) => ({ ok: true, json: async () => ({ url, alignment: { visemes: [] } }) });
  return { context, requests, plays, result, timers, tick(ms=16) {
    now += ms;
    for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); }
  }, volume(value) { sampleValue = value; }, run: (code) => vm.runInContext(code, context) };
}

const caughtPlan = JSON.stringify({ source: 'rehearsal', synthetic: true, boundary_mode: 'normal',
  live2d: { custom_action: 'caughtMe', intensity: 0.8 }, rehearsal: { pre_speech: 'caughtMe' } });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('rehearsal pauses before speech and does not restart the head turn at audio onset', async () => {
  const h = pageHarness(); const pending = h.run(`speak('...You caught me.', ${caughtPlan})`);
  h.requests[0].resolve(h.result('caught.wav')); await flush();
  assert.equal(h.timers.size, 1);
  assert.equal(h.plays.length, 0);
  h.run('motionController.sample(performance.now())');
  h.tick(300);
  assert.ok(h.run('motionController.sample(performance.now()).blush') > 0.4);
  h.tick(890); await flush(); assert.equal(h.plays.length, 0);
  h.tick(10); await pending;
  assert.equal(h.plays.length, 1);
  assert.equal(h.run('currentState'), 'speaking');
  assert.ok(h.run('motionController.sample(performance.now()).blush') > 0.5, 'Action must not rewind at playback');
});

test('stopping or replacing the prelude cancels its timer and prevents stale speech', async () => {
  for (const replace of [false, true]) {
    const h = pageHarness(); const pending = h.run(`speak('caught', ${caughtPlan})`);
    h.requests[0].resolve(h.result('caught.wav')); await flush();
    assert.equal(h.timers.size, 1);
    if (replace) {
      const next = h.run("speak('next')");
      h.requests[1].resolve(h.result('next.wav')); await next;
    } else h.run('stopAudio()');
    await pending; h.tick(5000); await flush();
    assert.equal(h.timers.size, 0);
    assert.deepEqual(h.plays.map(el => el.src), replace ? ['next.wav'] : []);
  }
});

test('ordinary replies and boundary de-escalation never get the rehearsal delay', async () => {
  for (const override of [{ source: 'normal' }, { synthetic: false }, { boundary_mode: 'deescalate' }]) {
    const h = pageHarness(); const plan = { ...JSON.parse(caughtPlan), ...override };
    const pending = h.run(`speak('reply', ${JSON.stringify(plan)})`);
    h.requests[0].resolve(h.result('normal.wav')); await pending;
    assert.equal(h.plays.length, 1); assert.equal(h.timers.size, 0);
  }
});

test('a late previous TTS result cannot play over the new turn', async () => {
  const h = pageHarness();
  const first = h.run("speak('first', { command_id: 'first' })");
  const second = h.run("speak('second', { command_id: 'second' })");
  assert.equal(h.requests[0].options.signal.aborted, true);
  h.requests[1].resolve(h.result('second.wav')); await second;
  h.requests[0].resolve(h.result('first.wav')); await first;
  assert.deepEqual(h.plays.map((audio) => audio.src), ['second.wav']);
  assert.equal(h.run('activeDelivery.commandId'), 'second');
});

test('stop cancels pending synthesis and does not wake back up on late completion', async () => {
  const h = pageHarness(); const pending = h.run("speak('pending')");
  h.run('stopAudio()');
  h.requests[0].resolve(h.result('late.wav')); await pending;
  assert.equal(h.plays.length, 0);
  assert.equal(h.run('currentState'), 'idle');
});

test('old audio callbacks cannot complete a new delivery; quiet audio does not flap the mouth', async () => {
  const h = pageHarness();
  const first = h.run("speak('first', { command_id: 'first' })");
  h.requests[0].resolve(h.result('first.wav')); await first;
  const oldEnded = h.plays[0].onended;
  const second = h.run("speak('second', { command_id: 'second' })");
  h.requests[1].resolve(h.result('second.wav')); await second;
  oldEnded();
  assert.equal(h.run('activeDelivery.commandId'), 'second');
  assert.equal(h.run('sampleMouth().open'), 0);
  h.run("visemeTimeline = [{ start: 0, end: 0.5, viseme: 'a', value: 0.8 }]; audio.currentTime = 0.25");
  assert.equal(h.run('sampleMouth().open'), 0, 'Aligned letters cannot open a silent audio track');
  h.volume(140);
  for(let i=0;i<12;i++) { h.tick(); h.run('sampleMouth()'); }
  const voiced = h.run('sampleMouth().open');
  assert.ok(voiced > 0.1 && voiced < 0.6);
  h.run('audio.currentTime = 0.75');
  h.volume(128);
  for(let i=0;i<20;i++) { h.tick(); h.run('sampleMouth()'); }
  assert.equal(h.run('sampleMouth().open'), 0);
});

test('autonomous playback reports real start/end and failure without claiming silent completion', async () => {
  const h = pageHarness(); const reports = [];
  h.context.postMessage = data => reports.push(data);
  h.run('model = {}');
  const plan = JSON.stringify({ source: 'autonomous', performance: { version: 1, action: 'nod', face: 'warm', intensity: 0.4, ears: 'keep' }, live2d: { custom_action: 'nod', intensity: 0.4 } });
  const pending = h.run(`speak('hello', ${plan}, 'one')`);
  assert.equal(reports.at(-1).status, 'preparing');
  h.requests[0].resolve(h.result('voice.wav')); await pending;
  assert.equal(reports.at(-1).status, 'started');
  assert.equal(h.run('autonomousFace.name'), 'warm');
  h.plays[0].onended();
  assert.equal(reports.filter(r => r.type === 'carrotduck-performance').at(-1).status, 'completed');
  assert.equal(h.run('autonomousFace'), null);
  const failed = h.run(`speak('fail', ${plan}, 'two')`);
  h.requests[1].reject(new Error('provider failed')); await assert.rejects(failed);
  assert.equal(reports.filter(r => r.type === 'carrotduck-performance').at(-1).status, 'failed');
});

test('touch during speech keeps the speaking state; cancelled touch cannot leave a drag', async () => {
  const h = pageHarness(); h.run("setState('speaking'); handlePointerClick({ clientX: 50, clientY: 50 })");
  assert.equal(h.run('currentState'), 'speaking');
  h.run('handlePointerDown({ clientX: 20, clientY: 20 }); handlePointerCancel()');
  assert.equal(h.run('pointerStart'), null);
});

test('a late expression load cannot restore a released expression', async () => {
  const h = pageHarness(); const pending = deferred(); let activations = 0;
  const neutral = {};
  const manager = {
    definitions: [{ Name: 'hong' }], defaultExpression: neutral, currentExpression: { old: true },
    loadExpression: () => pending.promise, resetExpression() {},
  };
  h.context.stubModel = { internalModel: { motionManager: { expressionManager: manager } },
    expression: async () => { activations++; } };
  h.run('model = stubModel');
  const applying = h.run("applyExpression('hong')");
  h.run('releaseExpression()');
  pending.resolve({}); await applying;
  assert.equal(activations, 0);
  assert.equal(manager.currentExpression, neutral);
  await h.run("applyExpression('hong')");
  assert.equal(activations, 1);
});

test('a late authored motion load cannot override a newer custom gesture', async () => {
  const h = pageHarness(); const pending = deferred(); let starts = 0;
  h.context.stubModel = {
    internalModel: { motionManager: { loadMotion: () => pending.promise, stopAllMotions() {} } },
    motion: async () => { starts++; return true; },
  };
  h.run('model = stubModel');
  const loading = h.run("playMotion('think')");
  h.run("triggerCustomAction('nod', { force: true })");
  pending.resolve({}); await loading;
  assert.equal(starts, 0);
});
