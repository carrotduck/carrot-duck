// Capability-bounded performance policy. Original implementation; references in project notes.
const pick = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
const clamp = (n, low, high, fallback) => Number.isFinite(n) ? Math.max(low, Math.min(high, n)) : fallback;
export const INTENTS = ['answer', 'acknowledge', 'comfort', 'celebrate', 'recall', 'clarify', 'playful', 'invite', 'boundary'];
export const FACES = ['neutral', 'warm', 'concerned', 'curious'];
export function runtimeSnapshot(raw = {}) {
  if (!raw || typeof raw !== 'object') raw = {};
  return { surface: 'autonomous', mode: pick(raw.mode, ['conversation', 'performance'], 'conversation'),
    state: pick(raw.state, ['idle', 'preparing', 'speaking', 'performing', 'completed', 'cancelled', 'failed', 'unknown'], 'unknown'),
    ears: raw.ears === true, ready: raw.ready === true };
}
export function affectSnapshot(emotion = {}, signal = {}) {
  return { appraisal: { valence: clamp(emotion.appraisal?.valence, -5, 5, 0), arousal: clamp(emotion.appraisal?.arousal, 0, 10, 3) },
    signal: { valence: pick(signal.valence, ['positive', 'negative', 'mixed', 'neutral'], 'neutral'),
      intensity: pick(signal.intensity, ['low', 'medium', 'high'], 'low'),
      strategy: String(signal.strategy || 'plain_response').slice(0, 60) }, confidence_note: 'Text-derived hypotheses, not facts about user feelings.' };
}
export function planPerformance(decision, { restricted = false, affect = {}, runtime = {}, previousAction = null } = {}) {
  const mode = runtimeSnapshot(runtime).mode;
  const intent = restricted ? 'boundary' : pick(decision.intent, INTENTS, 'answer');
  let action = decision.action;
  if (restricted) action = 'listening';
  else if (action === 'offerHead' && (!decision.invitation || intent !== 'invite')) action = 'listening';
  else if (action === 'rememberedSmile' && !decision.memory_ids.length) action = 'softSmile';
  else if (action === previousAction && ['earReveal', 'offerHead', 'greet'].includes(action)) action = 'listening';
  const quiet = restricted || intent === 'comfort' || affect.signal?.valence === 'negative';
  const intensity = clamp(decision.intensity, 0.2, restricted ? 0.25 : quiet ? 0.4 : mode === 'conversation' ? 0.5 : 0.75, 0.35);
  const face = restricted ? 'neutral' : pick(decision.face, FACES, intent === 'comfort' ? 'concerned' : 'neutral');
  // Ears are a persistent appearance choice, not an automatic side effect of offering a head pat.
  const ears = restricted ? 'hide' : action === 'earReveal' ? 'show' : pick(decision.ears, ['keep', 'hide'], 'keep');
  return { version: 1, mode, intent, action, intensity, face, ears,
    preparation_ms: mode === 'performance' && !restricted ? 350 : 120,
    recovery_ms: 350,
    voice: { speed: quiet ? 0.9 : intent === 'celebrate' ? 1.02 : 0.96,
      stability: quiet ? 0.78 : 0.7, style: quiet ? 0.02 : mode === 'performance' ? 0.12 : 0.05 } };
}
