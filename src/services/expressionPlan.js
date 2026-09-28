import { v4 as uuid } from 'uuid';

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

export function buildExpressionPlan({
  affectiveSignal = null,
  emotionState = null,
  relationalState = null,
  relationshipProfile = null,
  surface = 'chat',
  turnId = null,
  messageId = null,
  deliveryExpected = false,
} = {}) {
  const occValence = clamp(((emotionState?.appraisal?.valence ?? 0) + 5) / 10) * 2 - 1;
  const valence = affectiveSignal?.valence_score ?? occValence;
  const arousal = affectiveSignal?.arousal ?? clamp((emotionState?.appraisal?.arousal ?? 3) / 10);
  const boundary = affectiveSignal?.boundary_risk || 'none';
  const caution = relationalState?.caution_level || 'normal';

  let tone = 'calm';
  let customAction = 'breathe';
  let expression = '';
  let speed = 0.94;
  let stability = 0.68;
  let style = 0.06;

  if (boundary === 'strong' || caution === 'high') {
    tone = 'boundary-respecting';
    customAction = 'listening';
    speed = 0.9;
    stability = 0.82;
    style = 0.02;
  } else if (valence <= -0.35) {
    tone = arousal >= 0.55 ? 'grounding' : 'gentle';
    customAction = arousal >= 0.55 ? 'listening' : 'nod';
    speed = 0.9;
    stability = 0.78;
    style = 0.03;
  } else if (valence >= 0.35 && arousal >= 0.45) {
    tone = 'bright';
    customAction = 'softSmile';
    expression = 'bloom';
    speed = 0.98;
    stability = 0.6;
    style = 0.11;
  } else if (affectiveSignal?.ppr_hint === 'memory' || affectiveSignal?.ppr_hint === 'cross_topic') {
    tone = 'attentive';
    customAction = 'thinking';
    speed = 0.92;
    stability = 0.74;
  }

  if (relationshipProfile?.primary_direction === 'ROMANTIC' && boundary === 'none' && valence > 0.2) {
    customAction = 'shy';
    expression = 'hong';
  }

  return {
    schema: 'carrot_duck_expression_plan_v2',
    command_id: deliveryExpected ? uuid() : null,
    turn_id: turnId,
    message_id: messageId,
    surface,
    state: 'speaking',
    tone,
    valence: Math.round(valence * 100) / 100,
    arousal: Math.round(arousal * 100) / 100,
    live2d: {
      custom_action: customAction,
      expression,
      intensity: Math.round(clamp(0.35 + arousal * 0.55) * 100) / 100,
      apply_on: 'audio_start',
      release_on: 'audio_end',
    },
    voice: {
      speed: Math.round(speed * 100) / 100,
      stability: Math.round(stability * 100) / 100,
      style: Math.round(style * 100) / 100,
    },
    boundary_mode: boundary === 'strong' || caution === 'high' ? 'deescalate' : 'normal',
    delivery: {
      expected: Boolean(deliveryExpected),
      prepare_state: 'listening',
      start_trigger: 'audio_play',
      completion_trigger: 'audio_ended',
    },
  };
}
