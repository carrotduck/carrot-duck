const HIGH_STAKES = /不想活|自杀|伤害自己|急诊|报警|被骗|违法|合同|诉讼|药物|剂量|suicid|self[- ]?harm|emergency|legal|medication/i;
const SHORT_ACK = /^(嗯+|哦+|好+|行|知道了|收到|哈哈+|嘿嘿+|ok|okay|got it|thanks|谢谢)[。.!！~～ ]*$/i;
const GREETING = /^(早安|早上好|晚安|睡了|睡觉了|good morning|good night)[。.!！~～ ]*$/i;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function personalityScale(user) {
  const keywords = user?.keywords || {};
  let scale = 1;
  if (keywords.warmth === 'warm') scale *= 1.08;
  if (keywords.warmth === 'cool') scale *= 0.85;
  if (keywords.energy === 'vibrant') scale *= 1.12;
  if (keywords.energy === 'steady') scale *= 0.92;
  if (keywords.expression === 'subtle') scale *= 0.88;
  return scale;
}

export function planChatTurn(user, {
  message = '',
  conversationMode = 'PRESENCE',
  affectiveSignal = null,
  voiceCall = false,
} = {}) {
  const text = String(message || '').trim();
  const highStakes = HIGH_STAKES.test(text);
  const relational = affectiveSignal?.ppr_hint && affectiveSignal.ppr_hint !== 'none';
  const emotional = affectiveSignal?.intensity === 'high'
    || (affectiveSignal?.intensity === 'medium' && affectiveSignal?.valence !== 'neutral');
  const explicitBoundary = affectiveSignal?.boundary_risk === 'strong';
  const longMessage = text.length >= 140;
  const shortAck = SHORT_ACK.test(text);
  const greeting = GREETING.test(text);

  let contextMode = 'compact';
  let historyLimit = 10;
  if (highStakes || relational || emotional || explicitBoundary || longMessage) {
    contextMode = 'full';
    historyLimit = 25;
  } else if (conversationMode === 'PRESENCE' || text.length >= 55) {
    contextMode = 'balanced';
    historyLimit = 16;
  }

  let baseTokens = 260;
  let responseClass = 'normal';
  if (voiceCall) {
    baseTokens = 140;
    responseClass = 'voice';
  } else if (shortAck || greeting) {
    baseTokens = 120;
    responseClass = shortAck ? 'ack' : 'greeting';
  } else if (highStakes || longMessage) {
    baseTokens = 480;
    responseClass = highStakes ? 'high_stakes' : 'long';
  } else if (emotional || relational || explicitBoundary) {
    baseTokens = 360;
    responseClass = 'relational';
  } else if (conversationMode === 'QUESTION') {
    baseTokens = 240;
    responseClass = 'question';
  }

  const tokenBudget = voiceCall
    ? baseTokens
    : Math.round(clamp(baseTokens * personalityScale(user), 100, 520));

  return {
    schema: 'carrot_duck_turn_plan_v1',
    context_mode: contextMode,
    history_limit: historyLimit,
    token_budget: tokenBudget,
    response_class: responseClass,
    high_stakes: highStakes,
    reasons: [
      highStakes ? 'high_stakes' : '',
      relational ? 'relational_signal' : '',
      emotional ? 'affective_intensity' : '',
      explicitBoundary ? 'boundary' : '',
      longMessage ? 'long_message' : '',
      shortAck ? 'short_ack' : '',
      greeting ? 'greeting' : '',
    ].filter(Boolean),
  };
}

