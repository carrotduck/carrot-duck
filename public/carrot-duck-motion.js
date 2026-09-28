(function (root) {
  'use strict';

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));
  const smooth = value => { const x = clamp(value); return x * x * (3 - 2 * x); };
  const heldPose = progress => progress < 0.3 ? smooth(progress / 0.3) : progress < 0.6 ? 1 : 1 - smooth((progress - 0.6) / 0.4);
  const ACTIONS = Object.freeze({
    softSmile: 3000, nod: 1600, shakeHead: 1800, listening: 3200,
    thinking: 3000, shy: 3000, breathe: 3200, greet: 2800,
    attentiveLean: 3400, patientNod: 2600, earReveal: 3400, offerHead: 4200, amused: 3200,
    rememberedSmile: 4000, caughtMe: 4400,
  });
  const NEUTRAL = Object.freeze({
    ParamAngleX: 0, ParamAngleY: 0, ParamAngleZ: 0,
    ParamBodyAngleX: 0, ParamBodyAngleY: 0, ParamBodyAngleZ: 0,
    ParamEyeBallX: 0, ParamEyeBallY: 0, ParamBreath: 0.5,
    ParamEyeLOpen: 1, ParamEyeROpen: 1, ParamEyeLSmile: 0, ParamEyeRSmile: 0,
    ParamBrowLY: 0, ParamBrowRY: 0, ParamBrowLAngle: 0, ParamBrowRAngle: 0,
    ParamMouthForm: 0,
  });

  function createController({ random = Math.random } = {}) {
    let state = 'idle';
    let intensity = 1;
    let boundary = false;
    let reduced = false;
    let action = null;
    let speechStyle = null;
    let lastVoicedAt = -Infinity, speechBeatAt = -Infinity, beatSide = 1;
    let lastTime = null;
    let blinkAt = null;
    let lastBlush = 0, blushTail = null;
    let values = { ...NEUTRAL };

    function trigger(name, { now = performance.now(), strength = 1, force = false } = {}) {
      if (!Object.hasOwn(ACTIONS, name)) return false;
      if (!force && action && now - action.startedAt < 600) return false;
      if (boundary && ['shy', 'softSmile', 'greet', 'earReveal', 'offerHead', 'amused', 'rememberedSmile', 'caughtMe'].includes(name)) name = 'listening';
      action = { name, startedAt: now, duration: ACTIONS[name], strength: clamp(strength) };
      return true;
    }

    function sample(now, { pointer = null, mouth = null, face = null } = {}) {
      const dt = lastTime == null ? 1 / 60 : clamp((now - lastTime) / 1000, 0, 0.05);
      if (lastTime != null && now - lastTime > 1000) blinkAt = null;
      lastTime = now;
      const t = now / 1000;
      const gain = intensity * (boundary ? 0.4 : 1) * (reduced ? 0.2 : 1);
      const target = { ...NEUTRAL };
      let blush = 0;
      const active = state === 'speaking';
      const listening = state === 'listening';
      const thinking = state === 'thinking';
      target.ParamBreath = 0.5 + Math.sin(t * 1.25) * 0.12 * gain;
      target.ParamAngleX = Math.sin(t * 0.43) * 0.6 * gain;
      target.ParamAngleY = (Math.sin(t * 0.6) * 0.45 - (listening ? 0.5 : 0)) * gain;
      target.ParamBodyAngleZ = Math.sin(t * 0.37) * 0.25 * gain;
      if (listening) {
        target.ParamAngleZ += 3 * gain;
        target.ParamAngleY -= 2 * gain;
      }
      if (thinking) {
        target.ParamAngleX -= 5 * gain;
        target.ParamAngleZ -= 3 * gain;
        target.ParamEyeBallX -= 0.22 * gain;
        target.ParamEyeBallY += 0.16 * gain;
      }
      if (pointer?.active) {
        const x = clamp(pointer.x) * 2 - 1;
        const y = 1 - clamp(pointer.y) * 2;
        const follow = gain * (action ? 0.45 : active ? 0.7 : 1);
        target.ParamEyeBallX = x * 0.7 * gain;
        target.ParamEyeBallY = y * 0.5 * gain;
        target.ParamAngleX += x * 15 * follow;
        target.ParamAngleY += y * 10 * follow;
        target.ParamAngleZ -= x * y * 3 * follow;
        target.ParamBodyAngleX += x * 3 * follow;
      }
      if (active && speechStyle) {
        const facial = speechStyle.strength * gain;
        const voiced = mouth?.active && mouth.open > 0.03;
        // One conversational beat after a pause, not a metronome tied to every mouth opening.
        if (voiced) {
          if (!action && now - lastVoicedAt > 180 && now - speechBeatAt > 2400) {
            speechBeatAt = now; beatSide *= -1;
          }
          lastVoicedAt = now;
        }
        const beat = heldPose(clamp((now - speechBeatAt) / 1800)) * facial;
        target.ParamAngleY -= 4 * beat;
        target.ParamAngleZ += 3 * beat * beatSide;
        target.ParamBodyAngleZ += 0.8 * beat * beatSide;
        if (['softSmile', 'greet', 'amused', 'offerHead'].includes(speechStyle.name)) {
          target.ParamMouthForm = 0.75 * facial;
          target.ParamEyeLSmile = target.ParamEyeRSmile = 0.6 * facial;
          target.ParamEyeLOpen = target.ParamEyeROpen = 1 - 0.18 * facial;
        } else if (['shy', 'caughtMe'].includes(speechStyle.name) && !boundary) {
          target.ParamMouthForm = 0.25 * facial;
          target.ParamEyeBallX -= 0.15 * facial;
          target.ParamAngleZ -= 3 * facial;
          if (speechStyle.name === 'caughtMe') blush = clamp(1.125 * facial);
        }
      }
      if (action) {
        const progress = clamp((now - action.startedAt) / action.duration);
        const envelope = ['nod', 'patientNod', 'shakeHead', 'breathe'].includes(action.name)
          ? Math.sin(Math.PI * progress) ** 2 : heldPose(progress);
        const amount = envelope * gain * action.strength;
        const wave = Math.sin(progress * Math.PI * 2);
        if (progress >= 1) action = null;
        else switch (action.name) {
          case 'nod':
            target.ParamAngleY -= 16 * amount;
            target.ParamBodyAngleY -= 2 * amount;
            break;
          case 'shakeHead':
            target.ParamAngleX += wave * 20 * amount;
            target.ParamBodyAngleX -= wave * 2.5 * amount;
            break;
          case 'softSmile':
          case 'rememberedSmile':
          case 'greet':
            target.ParamMouthForm += 0.9 * amount;
            target.ParamEyeLSmile += 0.8 * amount;
            target.ParamEyeRSmile += 0.8 * amount;
            target.ParamAngleZ += (action.name === 'greet' ? 10 : action.name === 'rememberedSmile' ? 8 : 4) * amount;
            target.ParamAngleY -= 3 * amount;
            break;
          case 'listening':
            target.ParamAngleZ += 7 * amount;
            target.ParamAngleY -= 4 * amount;
            target.ParamBrowLY += 0.12 * amount;
            target.ParamBrowRY += 0.12 * amount;
            break;
          case 'thinking':
            target.ParamAngleX -= 10 * amount;
            target.ParamAngleZ -= 6 * amount;
            target.ParamEyeBallX -= 0.28 * amount;
            target.ParamEyeBallY += 0.15 * amount;
            target.ParamBrowLY += 0.22 * amount;
            target.ParamBrowRY -= 0.1 * amount;
            break;
          case 'shy':
            target.ParamAngleX -= 10 * amount;
            target.ParamAngleY -= 7 * amount;
            target.ParamEyeBallX -= 0.18 * amount;
            target.ParamMouthForm += 0.35 * amount;
            break;
          case 'breathe':
            target.ParamBodyAngleY += 1.2 * amount;
            break;
          case 'attentiveLean':
            target.ParamAngleY -= 13 * amount;
            target.ParamAngleZ += 13 * amount;
            target.ParamBodyAngleX += 4 * amount;
            target.ParamBodyAngleY -= 4 * amount;
            target.ParamBrowLY += 0.15 * amount;
            target.ParamBrowRY += 0.15 * amount;
            break;
          case 'patientNod': {
            target.ParamAngleY -= 23 * amount;
            target.ParamAngleZ += 3 * amount;
            target.ParamBodyAngleY -= 5 * amount;
            break;
          }
          case 'earReveal':
            target.ParamEyeBallX -= 0.2 * amount;
            target.ParamAngleZ += 14 * amount;
            target.ParamAngleX -= 9 * amount;
            target.ParamBodyAngleZ += 3 * amount;
            target.ParamBrowLY += 0.3 * amount;
            target.ParamBrowRY += 0.3 * amount;
            target.ParamMouthForm += 0.5 * amount;
            break;
          case 'offerHead':
            target.ParamAngleY -= 13 * amount;
            target.ParamAngleZ += 5 * amount;
            target.ParamEyeBallY += 0.3 * amount;
            target.ParamEyeLSmile += 0.4 * amount;
            target.ParamEyeRSmile += 0.4 * amount;
            target.ParamMouthForm += 0.5 * amount;
            break;
          case 'caughtMe': {
            const elapsed = now - action.startedAt;
            const turn = smooth((elapsed - 350) / 550) * amount;
            // A visible blush precedes the sideways glance; shoulders stay still.
            blush = Math.max(blush, clamp(1.25 * gain * action.strength) * smooth(elapsed / 250)
              * (1 - smooth((progress - 0.72) / 0.28)));
            target.ParamEyeBallX -= 0.3 * turn;
            target.ParamAngleX -= 15 * turn;
            target.ParamAngleZ -= 6 * turn;
            target.ParamAngleY -= 3 * turn;
            target.ParamMouthForm += 0.45 * turn;
            target.ParamEyeLSmile += 0.35 * turn;
            target.ParamEyeRSmile += 0.35 * turn;
            break;
          }
          case 'amused':
            target.ParamEyeBallX += 0.16 * amount;
            target.ParamAngleX += 8 * amount;
            target.ParamAngleZ -= 9 * amount;
            target.ParamBodyAngleZ -= 3 * amount;
            target.ParamMouthForm += 0.9 * amount;
            target.ParamEyeLSmile += 0.8 * amount;
            target.ParamEyeRSmile += 0.8 * amount;
            break;
        }
      }
      // Optional independent facial channel; neutral on old surfaces keeps their existing behavior.
      const faceGain = clamp(face?.strength ?? 0) * gain;
      if (!boundary && face?.name === 'warm') {
        target.ParamEyeLSmile = target.ParamEyeRSmile = Math.max(target.ParamEyeLSmile, 0.5 * faceGain);
        target.ParamMouthForm = Math.max(target.ParamMouthForm, 0.45 * faceGain);
      } else if (!boundary && face?.name === 'concerned') {
        target.ParamBrowLY += 0.25 * faceGain; target.ParamBrowRY += 0.25 * faceGain;
        target.ParamBrowLAngle -= 0.15 * faceGain; target.ParamBrowRAngle -= 0.15 * faceGain;
      } else if (!boundary && face?.name === 'curious') {
        target.ParamBrowLY += 0.3 * faceGain; target.ParamBrowRY += 0.15 * faceGain;
      }
      const smile = Math.max(target.ParamEyeLSmile, target.ParamEyeRSmile);
      target.ParamEyeLOpen = Math.min(target.ParamEyeLOpen, 1 - 0.22 * smile);
      target.ParamEyeROpen = Math.min(target.ParamEyeROpen, 1 - 0.22 * smile);
      for (const id of Object.keys(target)) {
        // Eyes lead; head and shoulders settle later into the same pose.
        const tau = id.startsWith('ParamBody') ? 0.32 : id.startsWith('ParamAngle') ? 0.2
          : id.includes('EyeBall') ? 0.075 : id.includes('Mouth') ? 0.12 : 0.16;
        const blend = 1 - Math.exp(-dt / tau);
        const delta = (target[id] - values[id]) * blend;
        // Keep larger gestures from snapping when an incoming action replaces a pose.
        const speed = id.startsWith('ParamBody') ? 6 : 36;
        values[id] += /^Param(?:Body)?Angle/.test(id) ? clamp(delta, -speed * dt, speed * dt) : delta;
      }
      // Blinking multiplies the expressive eyelid pose, never replaces it.
      if (blinkAt == null) blinkAt = now + 2600 + random() * 3000;
      const elapsed = now - blinkAt;
      let blink = 1;
      if (elapsed >= 0 && elapsed < 75) blink = 1 - elapsed / 75;
      else if (elapsed >= 75 && elapsed < 115) blink = 0;
      else if (elapsed >= 115 && elapsed < 260) blink = (elapsed - 115) / 145;
      else if (elapsed >= 260) blinkAt = now + 2600 + random() * 3000;
      const params = { ...values };
      // Speech owns mouth opening, including quiet gaps. Gestures cannot open it.
      params.ParamMouthOpenY = mouth?.active ? clamp(mouth.open) : 0;
      params.MouthFunnel = mouth?.active ? clamp(mouth.funnel) : 0;
      if (mouth?.active) params.ParamMouthForm = clamp((mouth.form || 0) + values.ParamMouthForm * 0.55, -1, 1);
      if (blushTail) {
        const progress = clamp((now - blushTail.startedAt) / 900);
        blush = Math.max(blush, blushTail.value * (1 - smooth(progress)));
        if (progress >= 1) blushTail = null;
      }
      lastBlush = clamp(blush);
      return { params, blink, blush: lastBlush, action: action?.name || null, state };
    }

    return {
      trigger, sample,
      setState(value) { if (['idle', 'listening', 'thinking', 'speaking'].includes(value)) state = value; },
      setIntensity(value) { intensity = clamp(value); },
      setReducedMotion(value) { reduced = Boolean(value); },
      setBoundary(value) {
        boundary = value === 'deescalate';
        if (boundary) { action = null; speechStyle = null; blushTail = null; lastBlush = 0; }
      },
      setSpeechStyle(name, strength = 1) { speechStyle = { name, strength: clamp(strength) }; lastVoicedAt = speechBeatAt = -Infinity; },
      release({ fadeBlush = false } = {}) {
        blushTail = fadeBlush && lastBlush > 0 ? { value: lastBlush, startedAt: lastTime ?? 0 } : null;
        if (!fadeBlush) lastBlush = 0;
        action = null; speechStyle = null; lastVoicedAt = speechBeatAt = -Infinity;
      },
      adoptPose(read) {
        for (const id of Object.keys(values)) {
          const value = read(id);
          if (Number.isFinite(value)) values[id] = value;
        }
      },
      resetClock() { lastTime = null; blinkAt = null; },
    };
  }

  function createMouthSmoother() {
    let lastTime = null;
    let pose = { open: 0, form: 0, funnel: 0 };
    function reset() { lastTime = null; pose = { open: 0, form: 0, funnel: 0 }; }
    return {
      reset,
      sample(now, target) {
        if (!target?.active) { reset(); return { ...pose, active: false }; }
        if (lastTime !== null && (now < lastTime || now - lastTime > 250)) reset();
        const dt = lastTime === null ? 1 / 60 : clamp((now - lastTime) / 1000, 0, 0.05);
        lastTime = now;
        const goal = { open: clamp(target.open, 0, 0.6), form: clamp(target.form, -1, 1), funnel: clamp(target.funnel) };
        for (const key of Object.keys(pose)) {
          const tau = key === 'open' ? (goal.open > pose.open ? 0.055 : 0.075) : 0.11;
          const delta = (goal[key] - pose[key]) * (1 - Math.exp(-dt / tau));
          pose[key] += clamp(delta, -4 * dt, 4 * dt);
        }
        if (goal.open === 0 && pose.open < 0.025) pose.open = 0;
        return { ...pose, active: true };
      },
    };
  }

  function createParameterWriter(core) {
    const capabilities = new Map();
    // pixi-live2d-display 0.4 exposes parameter IDs through its Cubism Core model.
    const ids = core._model.parameters.ids;
    for (let index = 0; index < core.getParameterCount(); index++) {
      capabilities.set(ids[index], {
        index, min: core.getParameterMinimumValue(index), max: core.getParameterMaximumValue(index),
      });
    }
    return {
      capabilities,
      set(id, value) {
        const parameter = capabilities.get(id);
        if (!parameter || !Number.isFinite(value)) return false;
        core.setParameterValueByIndex(parameter.index, clamp(value, parameter.min, parameter.max));
        return true;
      },
      get(id) {
        const parameter = capabilities.get(id);
        return parameter ? core.getParameterValueByIndex(parameter.index) : 0;
      },
    };
  }

  function tintBlushMesh(renderer, core, drawableId) {
    if (!renderer || !core || typeof renderer.drawMesh !== 'function'
      || typeof renderer.getModelColor !== 'function' || typeof renderer.setModelColor !== 'function'
      || typeof renderer.getClippingContextBufferForMask !== 'function'
      || typeof core.getDrawableIndex !== 'function' || typeof core.getDrawableVertexPositions !== 'function') return null;
    const index = core.getDrawableIndex(drawableId);
    if (index < 0) return null;
    const original = renderer.drawMesh;
    // Pinned Cubism renderer: arg 4 is the vertex array. Tint only the authored blush, never its mask or neighboring meshes.
    const tinted = function (...args) {
      if (args[4] !== core.getDrawableVertexPositions(index) || this.getClippingContextBufferForMask()) return original.apply(this, args);
      const color = this.getModelColor();
      this.setModelColor(color.R, color.G * 0.25, color.B * 0.36, color.A);
      try { return original.apply(this, args); }
      finally { this.setModelColor(color.R, color.G, color.B, color.A); }
    };
    renderer.drawMesh = tinted;
    return () => { if (renderer.drawMesh === tinted) renderer.drawMesh = original; };
  }

  root.CarrotDuckMotion = { ACTIONS, createController, createMouthSmoother, createParameterWriter, tintBlushMesh, clamp };
})(typeof globalThis !== 'undefined' ? globalThis : window);
