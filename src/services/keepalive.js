import { v4 as uuid } from 'uuid';
import { db } from '../db.js';
import { rehearsal } from './rehearsal.js';
import { userDateKey } from '../utils/timezone.js';
import { callDeepSeek, warmupCache } from './deepseek.js';
import { buildKeepalivePromptMessages, buildStablePromptPrefix } from './prompts.js';
import { addMemory, listNeocortexMemories } from './memory.js';
import { clipDiaryBody } from './greetings.js';
import { sanitizeStickerMarkup } from './stickers.js';
import { getUser, touchUser } from '../db.js';
import { getFavoritesForContext } from './favorites.js';
import { splitAssistantBubbleParts, isStickerOnlyContent } from './bubbles.js';
import { emitVoiceBubbleIfNeeded } from './voice.js';
import { buildTimeContextBlock, isReasonableKeepaliveHour } from '../utils/timeContext.js';
import { formatTodosForKeepalive } from './todos.js';
import { sendKeepalivePush } from './push.js';
import {
  computeRoamParams,
  executeFreeRoamAction,
  runWebSearchRoam,
  roamActionLabel,
} from './roam.js';
import { addWorldbookEntry } from './worldbook.js';
import { runDailyFavoriteCuration, shouldRunDailyFavoriteHour } from './dailyFavorites.js';
import { pickKeepaliveIntervalMinutes } from './personality.js';
import { canWriteKeepaliveDiary } from './diaryQuota.js';
import { getActivePrefrontalIntents } from './worldbook.js';
import { runDailyCogniFoldForUser } from './cogniFold.js';
import {
  desireHeartbeat,
  pickDriveRoamAction,
  buildDesirePromptBlock,
  applyDriveFallback,
  ingestThoughtFromRoam,
  ingestThoughtFromExplore,
  logDesireAction,
  bumpDutyFromCalendar,
} from './desireDrive.js';
import {
  evaluateKeepalivePolicy,
  applyPolicyToRoamResult,
  minutesSinceLastChat,
} from './keepalivePolicy.js';
import { formatCalendarBlock, formatDutyNudge, shouldAllowPostWorkNudge } from './calendarContext.js';
import { extractRecallQueries, runRecallQueries, buildRecallInjectBlock } from './memoryRecall.js';
import {
  decideAgentAction,
  expireAgentActionOutcomes,
  markAgentActionFailed,
  markAgentActionExecuted,
} from './actionArbiter.js';

const lastChatByUser = new Map();
const lastWarmupByUser = new Map();
const keepaliveInFlight = new Set();
const nextKeepaliveAfter = new Map();
const keepaliveFailureUntil = new Map();

function inActiveHours(user) {
  if (!user.timezone) user = { ...user, timezone: 'Asia/Shanghai' };
  return isReasonableKeepaliveHour(user);
}

function safeKeepaliveTimeMs(value, fallback = Date.now()) {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(t) ? t : fallback;
}

function formatDuration(ms) {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins} minutes`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hours`;
  return `${Math.floor(hours / 24)} days`;
}

function recentChatSnippet(userId, limit = 4) {
  const rows = db.prepare(`
    SELECT role, content FROM messages
    WHERE user_id = ? AND role IN ('user','assistant') AND source = 'chat' AND archived = 0
    ORDER BY created_at DESC LIMIT ?
  `).all(userId, limit).reverse();
  return rows.map((m) => `${m.role}: ${String(m.content || '').slice(0, 100)}`).join('\n').slice(0, 400);
}

function lastUserContactMeta(user) {
  const tz = user?.timezone || 'Asia/Shanghai';
  const row = db.prepare(`
    SELECT created_at FROM messages
    WHERE user_id = ? AND role = 'user'
    ORDER BY created_at DESC LIMIT 1
  `).get(user.id);
  if (!row?.created_at) {
    return { chattedToday: false, withinHours: false };
  }
  const ts = safeKeepaliveTimeMs(row.created_at, NaN);
  if (!Number.isFinite(ts)) return { chattedToday: false, withinHours: false };
  const agoMs = Date.now() - ts;
  const chattedToday = userDateKey(row.created_at, tz) === userDateKey(new Date(), tz);
  const withinHours = agoMs < 12 * 60 * 60 * 1000;
  return { chattedToday, withinHours };
}

function parseKeepaliveResponse(text) {
  const thoughts = (text.match(/THOUGHTS:\s*([\s\S]*?)(?=ACTION:|$)/i)?.[1] || '').trim();
  const action = (text.match(/ACTION:\s*(\w+)/i)?.[1] || 'idle').toLowerCase();
  const content = (text.match(/CONTENT:\s*([\s\S]*?)$/i)?.[1] || '').trim();
  return { thoughts, action: action === 'none' ? 'idle' : action, content };
}

function getRecentActivity(userId, limit = 5) {
  return db.prepare('SELECT * FROM keepalive_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit);
}

function getPendingKeepaliveMessages(userId) {
  return db.prepare(`
    SELECT * FROM messages
    WHERE user_id = ? AND source = 'keepalive' AND consumed = 0 AND archived = 0
    ORDER BY created_at DESC LIMIT 1
  `).all(userId);
}

export function archiveKeepaliveBacklog() {
  const users = db.prepare(`
    SELECT DISTINCT user_id FROM messages
    WHERE source = 'keepalive' AND consumed = 0 AND archived = 0
  `).all();
  const archive = db.transaction(() => {
    let archived = 0;
    for (const { user_id: userId } of users) {
      const stale = db.prepare(`
        SELECT id FROM messages
        WHERE user_id = ? AND source = 'keepalive' AND consumed = 0 AND archived = 0
        ORDER BY created_at DESC LIMIT -1 OFFSET 1
      `).all(userId);
      for (const row of stale) {
        archived += db.prepare('UPDATE messages SET archived = 1, consumed = 1 WHERE id = ?').run(row.id).changes;
      }
    }
    archived += db.prepare(`
      UPDATE messages SET archived = 1
      WHERE source = 'keepalive' AND consumed = 1 AND archived = 0
        AND created_at < ?
    `).run(new Date(Date.now() - 30 * 86400000).toISOString()).changes;
    return archived;
  });
  return archive();
}

export function noteChatActivity(userId) {
  lastChatByUser.set(userId, Date.now());
  touchUser(userId);
}

export async function runCacheWarmup(user) {
  const now = Date.now();
  const lastChat = lastChatByUser.get(user.id) || safeKeepaliveTimeMs(user.last_active || user.created_at, now);
  const sinceChatMin = Math.max(0, (now - lastChat) / 60000);
  const sinceWarmupMin = (now - (lastWarmupByUser.get(user.id) || 0)) / 60000;
  if (sinceChatMin < 45 || sinceChatMin > 55) return;
  if (sinceWarmupMin < 25) return;
  if (!inActiveHours(user)) return;

  const stable = buildStablePromptPrefix(user, {
    neocortexMemories: listNeocortexMemories(user.id, 10),
    lang: user.ui_lang === 'en' ? 'en' : 'zh',
  });
  await warmupCache([
    { role: 'system', content: stable },
    { role: 'user', content: '嗯' },
  ]);
  lastWarmupByUser.set(user.id, now);
}

async function insertKeepaliveMessage(user, content, ts) {
  const safeContent = sanitizeStickerMarkup(content, user.id);
  const parts = splitAssistantBubbleParts(safeContent);
  const inserted = [];
  for (const part of parts) {
    const msgId = uuid();
    db.prepare(`
      INSERT INTO messages (id, user_id, role, content, source, consumed, created_at)
      VALUES (?, ?, 'assistant', ?, 'keepalive', 0, ?)
    `).run(msgId, user.id, part, ts);
    inserted.push({ id: msgId, content: part });
  }

  const textPart = parts.find((p) => !isStickerOnlyContent(p)) || safeContent;

  const voiceBubble = await emitVoiceBubbleIfNeeded(user, safeContent, '', '', { source: 'keepalive' });
  if (voiceBubble) {
    const voiceTarget = [...inserted].reverse().find((m) => !isStickerOnlyContent(m.content)) || inserted[inserted.length - 1];
    if (voiceTarget) {
      db.prepare('UPDATE messages SET metadata = ? WHERE id = ?').run(JSON.stringify({
        voice: {
          url: voiceBubble.url,
          transcript: voiceBubble.text,
          duration: voiceBubble.duration,
          lang: voiceBubble.lang || 'en',
        },
      }), voiceTarget.id);
    }
  }

  const textForPush = parts.find((p) => !isStickerOnlyContent(p)) || safeContent;
  if (user.notify_keepalive) {
    sendKeepalivePush(user, textForPush).catch(() => {});
  }
}

function saveRoamLog(userId, { action, thoughts, content, mode }) {
  const logId = uuid();
  const ts = new Date().toISOString();
  db.prepare(`
    INSERT INTO keepalive_logs (id, user_id, action, thoughts, content, mode, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(logId, userId, action, thoughts, content, mode, ts);
  return { logId, ts };
}

async function handleRoamResult(user, result, ts) {
  const action = result.action;
  if (action === 'message' && result.rawContent) {
    await insertKeepaliveMessage(user, result.rawContent, ts);
  } else if (action === 'diary' && result.rawContent) {
    if (canWriteKeepaliveDiary(user)) {
      addMemory(user.id, {
        content: clipDiaryBody(result.rawContent),
        category: 'diary',
        tags: ['keepalive-diary'],
        meta: { fromRoam: true, source: 'roam' },
        confidence: 'low',
      });
    }
  } else if (action === 'web_search') {
    if (result.shareMessage) {
      await insertKeepaliveMessage(user, result.shareMessage, ts);
    }
  } else if (action === 'introspect' && result.rawContent) {
    const wish = String(result.rawContent).trim().slice(0, 120);
    if (wish.length >= 4) {
      addWorldbookEntry(user.id, 'inner-wish', wish);
    }
  }
}

async function executeRoamCycle(user, { forceFree = false, forcedAction = null, actionDecision = null } = {}) {
  const params = computeRoamParams(user);
  const now = Date.now();
  const lastChat = lastChatByUser.get(user.id) || safeKeepaliveTimeMs(user.last_active || user.created_at, now);
  const sinceChatMin = Math.max(0, (now - lastChat) / 60000);
  const mode = forcedAction ? 'arbiter' : (forceFree ? 'free' : (Math.random() < 0.25 ? 'free' : 'lightweight'));
  bumpDutyFromCalendar(user);
  const dueTodos = formatTodosForKeepalive(user.id, user.timezone);
  const calendarBlock = formatCalendarBlock(user, user.ui_lang === 'en' ? 'en' : 'zh');
  const contact = lastUserContactMeta(user);
  const desireState = desireHeartbeat(user);
  const postWorkNudge = shouldAllowPostWorkNudge(user);
  const policy = evaluateKeepalivePolicy(user, {
    sinceChatMin,
    desireState,
    postWorkNudge,
    suggestedTopic: formatDutyNudge(user),
  });

  if (!policy.allowRoam) {
    if (actionDecision?.id) markAgentActionExecuted(actionDecision.id, 'wait');
    return { result: { action: 'idle', thoughts: '一起听雨，不打扰。', content: roamActionLabel('idle'), rawContent: '' }, ts: new Date().toISOString(), mode, logId: null, skipped: true };
  }

  const summon = pickDriveRoamAction(user, desireState, { topicDampen: policy.topicDampen });
  const desireBlock = buildDesirePromptBlock(user, desireState, summon);
  const roamContext = {
    duration: formatDuration(now - lastChat),
    mode,
    favorites: getFavoritesForContext(user.id, 5),
    activityLog: getRecentActivity(user.id, 3).map((a) => ({
      action: a.action,
      label: roamActionLabel(a.action),
    })),
    timeAnchor: new Date().toISOString(),
    timeContext: buildTimeContextBlock(user),
    dueTodos,
    calendarBlock,
    diaryAllowed: canWriteKeepaliveDiary(user),
    recentChat: recentChatSnippet(user.id),
    chattedToday: contact.chattedToday,
    withinHours: contact.withinHours,
    prefrontalIntents: getActivePrefrontalIntents(user.id),
    desireBlock,
    suggestedAction: summon,
    keepalivePolicy: policy,
  };

  let result;
  if (mode === 'free' || mode === 'arbiter') {
    let picked = forcedAction || (summon.forcedFatigue ? 'idle' : summon.action);
    if (picked === 'diary' && !canWriteKeepaliveDiary(user)) picked = 'idle';
    if (picked === 'web_search') {
      const pre = await executeFreeRoamAction(user, 'web_search', roamContext);
      result = await runWebSearchRoam(user, pre.rawContent, pre.thoughts);
      if (result.diaryBody) ingestThoughtFromExplore(user, result.diaryBody);
      if (!result.content) {
        result.content = roamActionLabel('web_search');
      }
    } else {
      result = await executeFreeRoamAction(user, picked, roamContext);
    }
  } else {
    const promptMessages = buildKeepalivePromptMessages(user, roamContext);
    const { text } = await callDeepSeek(promptMessages, { maxTokens: 220, temperature: 0.9, source: 'keepalive' });
    const parsed = parseKeepaliveResponse(text);
    result = {
      action: parsed.action,
      thoughts: parsed.thoughts,
      content: roamActionLabel(parsed.action),
      rawContent: parsed.content,
    };
  }

  applyDriveFallback(user, result.action);
  const dutyNudge = formatDutyNudge(user, user.ui_lang === 'en' ? 'en' : 'zh');
  if (result.action === 'idle' && summon.driveKey === 'duty' && dutyNudge && policy.allowMessage) {
    result = { ...result, action: 'message', rawContent: dutyNudge };
  }
  result = applyPolicyToRoamResult(result, policy);
  ingestThoughtFromRoam(user, result);
  logDesireAction(user.id, {
    driveKey: summon.driveKey,
    action: result.action,
    score: summon.score,
    intent: summon.intent,
    thoughts: desireState.thoughts,
  });

  const { logId, ts } = saveRoamLog(user.id, {
    action: result.action,
    thoughts: result.thoughts,
    content: result.content,
    mode,
  });

  await handleRoamResult(user, result, ts);
  if (actionDecision?.id) {
    markAgentActionExecuted(actionDecision.id, result.action, {
      expectsReply: result.action === 'message' || Boolean(result.shareMessage),
    });
  }
  return { result, ts, mode, logId };
}

export async function runInstantRoam(user) {
  if (rehearsal.enabled(user.id)) throw Object.assign(new Error('Proactive roaming is disabled for rehearsal accounts'), { code: 'REHEARSAL_ACCOUNT' });
  if (keepaliveInFlight.has(user.id)) {
    const err = new Error('Roam already in progress');
    err.code = 'ROAM_BUSY';
    throw err;
  }
  keepaliveInFlight.add(user.id);
  try {
    const { result, ts, logId } = await executeRoamCycle(user, { forceFree: true });
    return {
      action: result.action,
      thoughts: result.thoughts,
      content: result.content,
      created_at: ts,
      logId,
    };
  } finally {
    keepaliveInFlight.delete(user.id);
  }
}

function shouldSkipKeepaliveByTiming(user, now) {
  const scheduled = nextKeepaliveAfter.get(user.id);
  if (scheduled && now < scheduled) return true;
  const sinceChatMin = minutesSinceLastChat(user.id, new Date(user.last_active || user.created_at).getTime());
  const params = computeRoamParams(user);
  const roamGap = params.keepalive_interval_min_min;
  const chatCooldown = Math.min(60, Math.max(30, Math.round(roamGap * 0.6)));
  if (sinceChatMin < chatCooldown) return true;
  const lastKeepalive = db.prepare('SELECT created_at FROM keepalive_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(user.id);
  if (lastKeepalive) {
    const sinceLast = (now - new Date(lastKeepalive.created_at).getTime()) / 60000;
    if (sinceLast < roamGap) return true;
  }
  return false;
}

export async function runKeepaliveCheck(user) {
  if (rehearsal.enabled(user.id)) return;
  if (keepaliveInFlight.has(user.id)) return;

  const now = Date.now();
  if ((keepaliveFailureUntil.get(user.id) || 0) > now) return;
  if (shouldSkipKeepaliveByTiming(user, now)) return;

  const sinceChatMin = minutesSinceLastChat(user.id, new Date(user.last_active || user.created_at).getTime());
  expireAgentActionOutcomes(user.id);
  const desireState = desireHeartbeat(user);
  const policy = evaluateKeepalivePolicy(user, { sinceChatMin, desireState });
  if (!policy.allowRoam) return;

  const summon = pickDriveRoamAction(user, desireState, { topicDampen: policy.topicDampen });
  const decision = decideAgentAction({
    user,
    desireState,
    summon,
    policy,
    diaryAllowed: canWriteKeepaliveDiary(user),
    sinceChatMin,
  });
  if (decision.action === 'wait') {
    const waitMin = Math.max(20, Math.round(pickKeepaliveIntervalMinutes(user) * 0.6));
    nextKeepaliveAfter.set(user.id, Date.now() + waitMin * 60000);
    return;
  }

  keepaliveInFlight.add(user.id);
  try {
    await executeRoamCycle(user, { forcedAction: decision.action, actionDecision: decision });
    keepaliveFailureUntil.delete(user.id);
    const waitMin = pickKeepaliveIntervalMinutes(user);
    nextKeepaliveAfter.set(user.id, Date.now() + waitMin * 60000);
  } catch (error) {
    markAgentActionFailed(decision.id);
    keepaliveFailureUntil.set(user.id, Date.now() + 20 * 60_000);
    throw error;
  } finally {
    keepaliveInFlight.delete(user.id);
  }
}

export function startScheduler() {
  const archived = archiveKeepaliveBacklog();
  if (archived) console.log('[keepalive] archived stale message backlog', archived);
  setInterval(async () => {
    const users = db.prepare('SELECT * FROM users').all();
    for (const row of users) {
      const user = getUser(row.id);
      if (!user || rehearsal.enabled(user.id)) continue;
      try {
        await runCacheWarmup(user).catch((e) => console.warn('[cache-warmup]', user.id, e.message));
        if (shouldRunDailyFavoriteHour(user)) {
          runDailyFavoriteCuration(user).catch((e) => console.warn('[daily-fav]', user.id, e.message));
        }
        runDailyCogniFoldForUser(user);
        desireHeartbeat(user);
        await runKeepaliveCheck(user);
      } catch (e) {
        console.error('[keepalive]', user.id, e.message);
      }
    }
  }, 60_000);
}

export function deleteKeepaliveLog(userId, logId) {
  const r = db.prepare('DELETE FROM keepalive_logs WHERE user_id = ? AND id = ?').run(userId, logId);
  return r.changes > 0;
}

export { getPendingKeepaliveMessages, getRecentActivity };
