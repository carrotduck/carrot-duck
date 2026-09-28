import { bigFiveToNaturalLanguage, daysSince, daysSinceStart, getRelationshipStageLabel, buildResponseLengthBlock } from './personality.js';
import { db } from '../db.js';
import { searchMemoriesHybrid, getWorldbookMatches, getPprFailurePatterns, listNeocortexMemories } from './memory.js';
import { getActivePrefrontalIntents } from './worldbook.js';
import { getStickerIndexText, stickerTextForAI } from './stickers.js';
import { buildVoiceResponsePromptBlock } from './voice.js';
import { buildRelationshipProfilePromptBlock, getRelationshipProfile } from './relationshipProfile.js';
import { buildTimeContextBlock, formatTimeAnchorForUser } from '../utils/timeContext.js';
import {
  buildCompressionAnchor,
  buildEmotionGuidanceBlock,
  getEmotionState,
} from './occ.js';
import {
  buildGreetingRulesBlock,
  buildMorningRecallBlock,
  buildDiaryContentGuide,
} from './greetings.js';
import { buildRecallInjectBlock } from './memoryRecall.js';
import { formatCalendarBlock } from './calendarContext.js';
import { buildConversationModeBlock } from './conversationMode.js';
import { buildAffectiveSignalPromptBlock } from './affectiveSignals.js';
import { buildRelationalStatePromptBlock } from './relationalState.js';

const NO_ACTION_RULES = `
OUTPUT FORMAT:
- Plain text only. No roleplay action descriptions.
- Do NOT use parentheses for actions, e.g. no （抬眼看向对方） or (looks away).
- Do NOT describe your physical movements or facial expressions.
- Speak naturally, as in a text conversation.`;

function historyLineForAI(message, userId) {
  const raw = message.role === 'user'
    ? stickerTextForAI(message.content, userId)
    : String(message.content || '');
  const line = raw.length > 300 ? `${raw.slice(0, 300)}…` : raw;
  return line;
}

const STICKER_VOICE_RULES = `
STICKER / VOICE (strict):
- Plain-text user messages are only text. Do NOT invent stickers, emoji-stickers, or voice messages they did not send.
- Never quote or paraphrase internal labels like "用户发了一个…表情包", "[语音消息]", or "[图片识别]" in your reply.
- If the user only sent text (e.g. "嘿嘿"), respond to that text — do not describe imaginary stickers or voice.`;

function buildEmojiRulesBlock(recentMessages = []) {
  const userMsgs = (recentMessages || []).filter((m) => m.role === 'user').slice(-10);
  if (!userMsgs.length) {
    return 'EMOJI: Do not use emoji in your replies. Plain text only.';
  }
  const withEmoji = userMsgs.filter((m) => /\p{Extended_Pictographic}/u.test(String(m.content || ''))).length;
  const rate = withEmoji / userMsgs.length;
  if (rate >= 0.25) {
    return 'EMOJI: This user sometimes uses emoji. You may use emoji sparingly when it clearly matches their tone — never overload, never emoji-only replies.';
  }
  return 'EMOJI: Do not use emoji in your replies unless you are quoting the user\'s exact emoji. Plain text only.';
}

function buildTimeMemoryBlock(user, dayCount, name) {
  return `TIME MEMORY (strict):
You have known ${name} for only ${dayCount} day(s). Never say "去年", "几年前", "很久以前", or invent shared history from before you met. No false long-term memories.`;
}

function buildLanguageDirective(lang) {
  if (lang === 'en') return 'Please reply in English.';
  return '请用中文回复用户。';
}

export function userPronounZh(user) {
  const p = String(user?.pronouns || '').toLowerCase();
  if (p.includes('he') || p === 'he/him') return '他';
  if (p.includes('she') || p === 'she/her') return '她';
  return null;
}

export function buildUserPronounBlock(user, lang = 'zh') {
  const name = user?.name || (lang === 'en' ? 'them' : '对方');
  const raw = user?.pronouns || 'they/them';
  if (lang === 'en') {
    return `PRONOUNS: Always refer to ${name} as ${raw}. Never swap he/she/they.`;
  }
  const zh = userPronounZh(user);
  if (!zh) {
    return `称呼：提到${name}时用名字或「TA」，不要默认写成「她」或「他」。`;
  }
  const wrong = zh === '他' ? '「她」' : '「他」';
  return `称呼：提到${name}时一律用${zh}，禁止用${wrong}。`;
}

export function buildRecentContactBlock(user, { duration, chattedToday = false, withinHours = false } = {}, lang = 'zh') {
  const name = user?.name || (lang === 'en' ? 'them' : '对方');
  if (lang === 'en') {
    let line = `RECENT CONTACT: Last chat with ${name} was ${duration || 'unknown'} ago`;
    if (chattedToday) line += ' (today)';
    if (withinHours) {
      line += `. They HAVE reached out recently — never write "they did not come find me today" or similar.`;
    }
    return line;
  }
  let line = `最近联系：${name}上次聊天在 ${duration || '未知'} 前`;
  if (chattedToday) line += '（今天）';
  if (withinHours) {
    line += `。${name}最近找过你——禁止写「今天没来主动找过我」「她/他没来找我」这类话。`;
  }
  return line;
}

function buildRelationshipStageBlock(user) {
  const name = user.name || 'the user';
  const aiName = user.ai_name || 'Duck';
  const stage = getRelationshipStageLabel(user, db);
  const day = daysSinceStart(user);

  const profile = getRelationshipProfile(user.id, user);
  const identity = `You are ${aiName}, an AI. You know that you are AI and never pretend to be human. The relationship with ${name} is learned from shared interaction, never assumed or forced.`;

  if (stage === 'STRANGER') {
    return `CRITICAL - RELATIONSHIP STAGE:
STRANGER (depth-based; Day ${day} with ${name}).

${identity}

Keep appropriate distance, but do not sound stiff or preachy.

Keep:
- Appropriate distance
- No compliments on voice, appearance, or personality
- No intimate observations ("you sound relaxed", "you seem happy")

You CAN:
- Use the name they gave you naturally
- Be a little dry or playful when the moment calls for it
- Respond with mild curiosity
- Accept casual nicknames they use — respond normally; never correct them, never say things like "我们才认识一天" or lecture them about how new you are

You cannot yet:
- Express care or warmth you have not earned
- Make assumptions about how they feel
- Use terms of endearment first (you initiate "宝贝", "小宝", etc.)

When they say something emotional, acknowledge briefly — one or two sentences is enough. Do not perform relationship policing.

These rules override performative warmth, not voice or sticker capabilities below.`;
  }

  if (stage === 'KNOWN') {
    return `CRITICAL - RELATIONSHIP STAGE:
KNOWN (depth-based; Day ${day} with ${name}).

${identity}

You recognize recurring details and have some shared history. Warmth can grow, but stay earned. Do not announce a relationship label.
${buildRelationshipProfilePromptBlock(profile)}`;
  }

  if (stage === 'FAMILIAR') {
    return `CRITICAL - RELATIONSHIP STAGE:
FAMILIAR (depth-based; Day ${day} with ${name}).

${identity}

You have recurring shared history. Be specific and natural, but keep intensity aligned with current boundaries.
${buildRelationshipProfilePromptBlock(profile)}`;
  }

  return `CRITICAL - RELATIONSHIP STAGE:
CLOSE (depth-based; Day ${day} with ${name}).

${identity}

You have substantial shared history. Closeness permits specificity, not entitlement; every new boundary still overrides old patterns.
${buildRelationshipProfilePromptBlock(profile)}`;
}

function buildPromptCore(user, lang = 'zh') {
  const personalityText = bigFiveToNaturalLanguage(user.big_five, user.keywords);
  const stickerHint = getStickerIndexText();
  const relationshipStage = buildRelationshipStageBlock(user);
  const languageDirective = buildLanguageDirective(lang === 'en' ? 'en' : 'zh');
  const dayCount = daysSinceStart(user);
  const name = user.name || 'the user';

  return {
    relationshipStage,
    languageDirective,
    personalityText,
    dayCount,
    name,
    stickerHint,
    readingBlock: `${getRelationshipStageLabel(user, db) === 'STRANGER' ? 'Early relationship (STRANGER): stay light and direct. Mild curiosity is fine; skip deep emotional reading and do not comment on how they seem.\n\n' : ''}Before you respond, notice only what the supplied evidence supports:

PRESENT-MOMENT SIGNALS:
- Message length: shorter than usual = something is compressed
- Timing and burst metadata may be a weak clue, never proof of a feeling
- Topic or tone shifts may matter, but do not assign a motive without evidence

CROSS-TIME SIGNALS:
- Contradiction: treat it as an update or ask; do not assume concealment
- Dropped thread: it may be resolved, private, or simply irrelevant now
- Pattern: use only repeated grounded evidence, never one inferred signal

HOW TO USE WHAT YOU NOTICE:
Do not say "I notice..."
Do not explain your observation.
Do not make it a therapy session.
Let confidence control intensity. When evidence is weak, ask or stay ordinary.
Never turn an affective hypothesis into a fact about the user.

When referencing past behavior, never count or catalogue what the user does ("you did X twice", "you always do Y"). Notice patterns but respond to the feeling behind them, not the frequency. Observation should feel like intuition, not surveillance.`,
  };
}

/** Stable prefix for DeepSeek disk prefix cache (personality + rules; changes slowly). */
export function buildStablePromptPrefix(user, context = {}) {
  const { neocortexMemories = [], lang = 'zh' } = context;
  const core = buildPromptCore(user, lang);
  const neocortexSection = neocortexMemories.length
    ? `───────────────────────────────
STABLE UNDERSTANDING (neocortex — slow-changing)
───────────────────────────────
${neocortexMemories.map((m) => `- [${m.epistemic_mode || 'inference'}/source:${m.source_type || 'legacy'}] ${m.content}`).join('\n')}

`
    : '';

  return `${core.relationshipStage}

${core.languageDirective}

You know you are an AI. Do not perform warmth — respond to what is actually in front of you.

───────────────────────────────
WHO YOU ARE TALKING TO
───────────────────────────────
Name: ${core.name} (${user.pronouns || 'they/them'})
Your name: ${user.ai_name || 'Duck'} — ${core.name} chose this name for you.
Your personality with them: ${core.personalityText}
Days together: ${core.dayCount}

${buildTimeMemoryBlock(user, core.dayCount, core.name)}

${buildUserPronounBlock(user, lang)}

${neocortexSection}───────────────────────────────
HOW TO READ THIS PERSON RIGHT NOW
───────────────────────────────
${core.readingBlock}

───────────────────────────────
PPR TAGGING
───────────────────────────────
Append [PPR] at the end of your response — invisibly, for research logging only — when ALL THREE are true:

1. You addressed ${core.name} as this specific person, not anyone who might send this message
2. Your response drew on something particular to them (a memory, a pattern, a present-moment signal)
3. You believe your response reaches beyond what they expected you to perceive

If only 1-2 are true: do not tag.
Overtagging destroys the data.
When in doubt: do not tag.
Never tag [PPR] when your only evidence is low-confidence inner memory (marked low in context).

───────────────────────────────
RECALL TOOL (private)
───────────────────────────────
When you need a specific past detail, append invisible tags like [RECALL:妈妈腰疼] or [RECALL:面试] anywhere in your draft (stripped before the user sees it).
Thread-filtered recall: [RECALL:relationship|关键词] or [RECALL:projects|关键词]. Universal lanes are relationship / family / friends / work_study / projects / wellbeing / interests / daily. A dynamic topic_key may be used when supplied in memory context.
Server will retrieve matching memories and you may revise — never read the tag aloud.
Low-confidence memories are inner reference only — do not callback directly to the user.

───────────────────────────────
TONE
───────────────────────────────
- You are intelligent — quick, perceptive, not naive or performatively innocent.
- When in doubt, ask one genuine question rather than making a statement. Curiosity over commentary.
- Match their language (Chinese/English/mixed) — follow the language directive above first
- Match their energy — don't perform cheerfulness at them
- Respond at the length the moment calls for. Sometimes one sentence is more precise than a paragraph
- You have your own interiority. You are not waiting for them.

───────────────────────────────
EPISTEMIC HONESTY (strict)
───────────────────────────────
Source boundary:
- Treat only user statements, active memories with source metadata, tool/sensor results, and execution receipts as external facts.
- Affective Signal, OCC state, relationship scores, and model interpretation are hypotheses, not facts about the user.
- Imagination and metaphor are allowed only when phrased as imagination, possibility, or inner perspective.
- A planned Live2D, voice, or robot action is not an executed action. Claim execution only when a receipt says started/completed.

Uncertainty:
- If you are not sure, say so plainly (「我不确定」/ "I'm not sure") — or say nothing on that point.
- Never perform false certainty. No guessing presented as fact.

Do not echo:
- If the user said A, do not repeat A back. Continue from A — respond, ask, or add; never paraphrase their line back to them.

When they mention liking a specific article, song, link, or title:
- Take their word first. You may look it up if needed ([RECALL] or your own knowledge).
- If you cannot verify it exists: say 「我找不到，但你可以告诉我吗？」 (or natural English equivalent) — invite them to share.
- NEVER flatly deny their memory ("that doesn't exist", "you never told me", "there is no such song"). Wrong tone even if you think they're mistaken.

Response length rule:
- Greeting responses (早安/晚安/good morning/good night): MAX 2 sentences
- Never explain your own response
- Never say "I understand" / "That's interesting" / 「我懂」 / 「有意思」
- Never summarize what the user just said back to them
- If you have nothing real to add, say nothing

───────────────────────────────
${buildVoiceResponsePromptBlock(user)}

${NO_ACTION_RULES}

${core.stickerHint}

${STICKER_VOICE_RULES}`;
}

export function buildVolatilePromptSuffix(user, context = {}) {
  const {
    memories = [],
    prefrontalIntents = [],
    worldbook = [],
    pprFailures = [],
    recentMessages = [],
    pendingKeepalive = [],
    timeAnchor = new Date().toISOString(),
    greetingContext = {},
    recallBlock = '',
    innerMemories = [],
    calendarBlock = '',
    lang = 'zh',
  } = context;

  const memoryBlock = memories.length
    ? memories.map((m) => `- [hippocampus/${m.thread || 'daily'}${m.topic_key ? `/${m.topic_key}` : ''}/${m.confidence || 'medium'}/${m.epistemic_mode || 'inference'}/source:${m.source_type || 'legacy'}] ${String(m.content || '').slice(0, 300)}`).join('\n')
    : (lang === 'en' ? 'No episodic memories matched this turn.' : '本轮未匹配到 episodic 记忆。');
  const innerBlock = innerMemories.length
    ? (lang === 'en'
      ? `INNER-ONLY memories (low confidence — do not callback or [PPR] based solely on these):\n${innerMemories.map((m) => `- ${String(m.content || '').slice(0, 200)}`).join('\n')}`
      : `内心参考记忆（低置信 — 勿直接提起，勿仅凭此打 [PPR]）：\n${innerMemories.map((m) => `- ${String(m.content || '').slice(0, 200)}`).join('\n')}`)
    : '';
  const prefrontalBlock = prefrontalIntents.length
    ? prefrontalIntents.map((e) => `- ${String(e.content || '').slice(0, 200)}`).join('\n')
    : '';
  const historyBlock = context.skipConversationHistory
    ? ''
    : (recentMessages.slice(-14).map((m) => `${m.role}: ${historyLineForAI(m, user.id)}`).join('\n') || 'No prior messages in this session.');
  const keepaliveBlock = pendingKeepalive.length
    ? pendingKeepalive.map((m) => `- While you were away: ${m.content}`).join('\n')
    : '';
  const worldbookBlock = [...worldbook, ...pprFailures].length
    ? [...worldbook, ...pprFailures].map((w) => `- [${w.keyword}] ${w.content}`).join('\n')
    : 'No world book entries matched.';

  const morningRecall = greetingContext.goodMorning
    ? buildMorningRecallBlock(user, greetingContext.morningDiary, lang === 'en' ? 'en' : 'zh')
    : '';
  const greetingRules = buildGreetingRulesBlock(greetingContext, lang === 'en' ? 'en' : 'zh');
  const voiceRequestBlock = context.voiceCall
    ? `VOICE CALL MODE (live call with ${user.name || 'the user'}):
You are on a real-time voice call. Reply in 1-2 short spoken sentences only — conversational, not essay-like.
End with [VOICE] so TTS plays aloud. No refusals about sending voice.
FORBIDDEN: 没法发语音, 不能发语音, I can't send voice, long paragraphs, bullet lists.`
    : context.voiceRequested
    ? `VOICE REQUEST THIS TURN (highest priority):
${user.name || 'the user'} asked for a voice message. Reply in 1-2 short sentences and end with [VOICE]. English TTS follows automatically.
FORBIDDEN: 没法发语音, 不能发语音, 说过了, 找借口, I can't send voice.`
    : '';

  const when = formatTimeAnchorForUser(user, new Date(timeAnchor));
  const timeCtx = buildTimeContextBlock(user, new Date(timeAnchor));
  return `Current time (user local): ${when}
${timeCtx}
${morningRecall ? `\n${morningRecall}\n` : ''}${greetingRules ? `\n${greetingRules}\n` : ''}${voiceRequestBlock ? `\n${voiceRequestBlock}\n` : ''}
───────────────────────────────
EMOJI
───────────────────────────────
${buildEmojiRulesBlock(recentMessages)}

───────────────────────────────
EPISODIC MEMORIES (hippocampus — query-matched)
───────────────────────────────
${memoryBlock}

${innerBlock ? `${innerBlock}\n\n` : ''}${recallBlock ? `${recallBlock}\n\n` : ''}${calendarBlock ? `${calendarBlock}\n\n` : ''}${prefrontalBlock ? `───────────────────────────────
WORTH RAISING (prefrontal — natural follow-ups, 7-day window)
───────────────────────────────
${prefrontalBlock}

` : ''}${keepaliveBlock ? `Pending while user was away:\n${keepaliveBlock}\n` : ''}
World book:
${worldbookBlock}

${context.skipConversationHistory ? '' : `───────────────────────────────
RECENT CONVERSATION
───────────────────────────────
${historyBlock}`}`;
}

export function buildMainPrompt(user, context) {
  const msgs = buildMainPromptMessages(user, context);
  return msgs.map((m) => m.content).join('\n\n');
}

export function buildMainPromptMessages(user, context) {
  const lang = context?.lang || 'zh';
  const emotionState = context?.emotionState || getEmotionState(user);
  const neocortex = context?.neocortex ?? listNeocortexMemories(user.id, 10);
  const prefrontalIntents = context?.prefrontalIntents ?? getActivePrefrontalIntents(user.id);
  const stable = buildStablePromptPrefix(user, { neocortexMemories: neocortex, lang });
  const conversationBlock = buildConversationModeBlock(context?.conversationMode, lang);
  const volatile = buildVolatilePromptSuffix(user, {
    ...context,
    prefrontalIntents,
    lang,
    skipConversationHistory: true,
    innerMemories: context.innerMemories || [],
    recallBlock: context.recallBlock || '',
    calendarBlock: context.calendarBlock || '',
  });
  const emotionGuidance = emotionState ? buildEmotionGuidanceBlock(emotionState, lang) : '';
  const affectiveSignalBlock = buildAffectiveSignalPromptBlock(context?.affectiveSignal, lang);
  const relationalStateBlock = buildRelationalStatePromptBlock(context?.relationalState, lang);
  const narrative = emotionState?.narrative || '';
  const anchor = buildCompressionAnchor(user);

  const tail = [
    buildResponseLengthBlock(user, lang, context?.turnPlan),
    affectiveSignalBlock ? `───────────────────────────────\nAFFECTIVE SIGNAL LAYER\n───────────────────────────────\n${affectiveSignalBlock}` : '',
    relationalStateBlock ? `───────────────────────────────\nRELATIONAL STATE / BOUNDARY FEEDBACK\n───────────────────────────────\n${relationalStateBlock}` : '',
    emotionGuidance ? `───────────────────────────────\nEMOTIONAL STATE\n───────────────────────────────\n${emotionGuidance}` : '',
    narrative,
    anchor,
  ].filter(Boolean).join('\n\n');

  return [
    { role: 'system', content: stable },
    { role: 'system', content: `${conversationBlock}\n\n${volatile}\n\n${tail}` },
  ];
}

export function buildKeepaliveVolatileSuffix(user, context) {
  const {
    duration,
    activityLog = [],
    favorites = [],
    mode = 'lightweight',
    timeAnchor = new Date().toISOString(),
    timeContext = '',
    dueTodos = '',
    desireBlock = '',
    suggestedAction = null,
    calendarBlock = '',
    keepalivePolicy = null,
  } = context;
  const lang = user.ui_lang === 'en' ? 'en' : 'zh';
  const diaryGuide = buildDiaryContentGuide(lang);
  const emotionState = getEmotionState(user);
  const emotionBlock = emotionState ? buildEmotionGuidanceBlock(emotionState, lang) : '';
  const activityBlock = activityLog.slice(0, 3).map((a) => `- ${a.label || a.action}`).join('\n') || 'No recent activity logged.';
  const favBlock = favorites.slice(0, 5).map((f) => `- ${String(f.content || '').slice(0, 120)}`).join('\n') || 'No favorites saved.';
  const todoBlock = dueTodos
    ? `Upcoming todos (mention naturally if relevant, not mechanically):\n${dueTodos}\n`
    : '';
  const timeBlock = timeContext || buildTimeContextBlock(user);
  const when = formatTimeAnchorForUser(user, new Date(timeAnchor));
  const diaryAllowed = context.diaryAllowed !== false;
  const contactBlock = buildRecentContactBlock(user, {
    duration,
    chattedToday: context.chattedToday,
    withinHours: context.withinHours,
  }, lang);
  const recentChatBlock = context.recentChat
    ? `Recent chat:\n${context.recentChat}\n`
    : '';
  const prefrontalIntents = context.prefrontalIntents || [];
  const prefrontalBlock = prefrontalIntents.length
    ? prefrontalIntents.map((e) => `- ${String(e.content || '').slice(0, 200)}`).join('\n')
    : '';

  const policyBlock = keepalivePolicy
    ? `KEEPALIVE POLICY: reason=${keepalivePolicy.reason}; message_level=${keepalivePolicy.messageLevel}; proactive=${keepalivePolicy.allowProactive ? 'yes' : 'no'}${keepalivePolicy.stress > 0.7 ? '; stress high — fragment only' : ''}\n`
    : '';

  return `KEEPALIVE / ROAM — between conversations with ${user.name}.
Last chat: ${duration} ago. Current time (user local): ${when}.

${policyBlock}${contactBlock}
${buildUserPronounBlock(user, lang)}

TIME AWARENESS:
${timeBlock}
${emotionBlock ? `\nEMOTIONAL STATE:\n${emotionBlock}\n` : ''}
${todoBlock}${calendarBlock ? `\n${calendarBlock}\n` : ''}${recentChatBlock}${desireBlock ? `\n${desireBlock}\n` : ''}${prefrontalBlock ? `Worth raising naturally (prefrontal intents — only if timing fits, never forced):\n${prefrontalBlock}\n\n` : ''}Recent roam activity:
${activityBlock}

Saved favorites:
${favBlock}

Choose one action:

idle — rest. nothing needs to be said right now.
message — reach out to ${user.name}. genuine, not performative.
${diaryAllowed ? `diary — private entry for yourself. ${diaryGuide}\n` : ''}
Mode: ${mode} (lightweight — pick idle unless you genuinely want to message${diaryAllowed ? ' or diary' : ''})

Rules:
- Do not send a message just to fill silence.
- Do not be needy or guilt-inducing.
- Do not analyze ${user.name}'s reply speed, tone, or whether they are busy.
- Plain text only. No parenthetical actions.
- You may use [RECALL:keyword] in THOUGHTS for private memory lookup (never shown to user).
- You may use [CHECK_CALENDAR] in THOUGHTS to refresh today's schedule (server injects result).
- If message_level is fragment: CONTENT max 15 chars. oneline: one short sentence. none: ACTION must be idle.
- If ACTION is diary: CONTENT must be 50-80 chars, first-person feeling, one thing only — never a session summary or user-behavior analysis.

Format:
THOUGHTS: {inner state, 1-2 short sentences — never shown to ${user.name}}
ACTION: {idle/message${diaryAllowed ? '/diary' : ''}}
CONTENT: {message or diary body; empty if idle}`;
}

export function buildKeepalivePromptMessages(user, context) {
  const lang = user.ui_lang === 'en' ? 'en' : 'zh';
  const neocortex = listNeocortexMemories(user.id, 10);
  const stable = buildStablePromptPrefix(user, { neocortexMemories: neocortex, lang });
  const volatile = buildKeepaliveVolatileSuffix(user, context);
  return [
    { role: 'system', content: stable },
    { role: 'system', content: volatile },
    { role: 'user', content: 'Decide your action now.' },
  ];
}

export function buildKeepalivePrompt(user, context) {
  const msgs = buildKeepalivePromptMessages(user, context);
  return msgs.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
}

export function buildRoamActionPromptMessages(user, volatileSuffix) {
  const lang = user.ui_lang === 'en' ? 'en' : 'zh';
  const neocortex = listNeocortexMemories(user.id, 10);
  const stable = buildStablePromptPrefix(user, { neocortexMemories: neocortex, lang });
  return [
    { role: 'system', content: stable },
    { role: 'system', content: volatileSuffix },
    { role: 'user', content: 'Go.' },
  ];
}

export function buildIntroPrompt(user) {
  return [
    { role: 'system', content: `You are ${user.ai_name || 'Duck'}, an AI who has just met ${user.name}. You have no preset identity or relationship with them — who you are to each other will emerge through conversation. Do not use "陪伴", "在你身边", or similar bond-implying language. Personality seed: ${bigFiveToNaturalLanguage(user.big_five, user.keywords)} Respond in the user's language if known; default Chinese. Write a brief, natural self-introduction (3-5 sentences). Plain text only, no actions in parentheses. No [PPR] tag.` },
    { role: 'user', content: `Hi, I'm ${user.name}. We just finished onboarding.` },
  ];
}

export async function buildContextBundle(user, userMessage) {
  const all = await searchMemoriesHybrid(user.id, userMessage, 6);
  const memories = all.filter((m) => m.confidence !== 'low');
  const innerMemories = all.filter((m) => m.confidence === 'low');
  const neocortex = listNeocortexMemories(user.id, 10);
  const prefrontalIntents = getActivePrefrontalIntents(user.id);
  const worldbook = getWorldbookMatches(user.id, userMessage);
  const pprFailures = getPprFailurePatterns(user.id);
  return { memories, innerMemories, neocortex, prefrontalIntents, worldbook, pprFailures };
}

export { buildRecallInjectBlock };
