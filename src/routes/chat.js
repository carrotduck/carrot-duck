import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db, getUser, saveUser, parseMessage } from '../db.js';
import { callDeepSeekStream, callDeepSeek } from '../services/deepseek.js';
import { buildMainPromptMessages, buildContextBundle } from '../services/prompts.js';
import { extractTodosFromChat } from '../services/todos.js';
import { stripPprTag } from '../services/text.js';
import { maybeWriteMemoryFromChat } from '../services/memory.js';
import { extractRecallQueries, runRecallQueries, buildRecallInjectBlock, stripRecallTags } from '../services/memoryRecall.js';
import { runCogniFoldConsolidation } from '../services/cogniFold.js';
import { ingestThoughtsFromUserMessage, applyPresenceChatEffects } from '../services/desireDrive.js';
import { detectConversationMode } from '../services/conversationMode.js';
import { maybeExtractWorldbook } from '../services/worldbook.js';
import { noteChatActivity, getPendingKeepaliveMessages } from '../services/keepalive.js';
import { driftPersonality } from '../services/personality.js';
import { splitAssistantBubbleParts, isStickerOnlyContent } from '../services/bubbles.js';
import {
  emitVoiceBubbleIfNeeded,
  userRequestedVoice,
  detectVoiceTurnContext,
  rewriteVoiceDenialReply,
} from '../services/voice.js';
import { stickerTextForAI, sanitizeStickerMarkup } from '../services/stickers.js';
import { describeImage } from '../services/vision.js';
import {
  recordPprEvent,
  resolvePprForUserTurn,
} from '../services/ppr.js';
import {
  buildEmotionState,
  getEmotionState,
  saveEmotionState,
  refineEmotionAsync,
} from '../services/occ.js';
import {
  analyzeAffectiveSignal,
  saveRelationalTurnSignal,
} from '../services/affectiveSignals.js';
import { getRelationalStateSnapshot, shouldAllowPprTag } from '../services/relationalState.js';
import { updateRelationshipProfile } from '../services/relationshipProfile.js';
import { buildExpressionPlan } from '../services/expressionPlan.js';
import { createDeliveryCommand } from '../services/deliveryReceipts.js';
import { planChatTurn } from '../services/turnPlanner.js';
import { startModelRun, completeModelRun } from '../services/modelRuns.js';
import { recordAgentActionOutcome } from '../services/actionArbiter.js';
import { APP_VERSION } from '../config.js';
import { registerMediaAsset } from '../services/mediaAssets.js';
import rehearsalRouter from './rehearsal.js';
import autonomousRouter from './autonomous.js';
import { rehearsal } from '../services/rehearsal.js';
import {
  isGoodNight,
  isGoodMorning,
  getLastNightDiary,
  writeGoodnightDiary,
} from '../services/greetings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '../../public/uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const router = Router();
const sessionBuffers = new Map();
router.use('/:userId/rehearsal', rehearsalRouter);
router.use('/:userId/autonomous', autonomousRouter);

function buildApiMessages(recent, userId) {
  return recent.map((m, index) => {
    const content = m.role === 'user'
      ? stickerTextForAI(m.content, userId)
      : String(m.content || '');
    const isCurrentUser = m.role === 'user' && index === recent.length - 1;
    const limit = isCurrentUser ? 4000 : 900;
    const clipped = content.length > limit ? `${content.slice(0, limit)}…` : content;
    return { role: m.role, content: clipped };
  });
}

function buildAdaptiveApiMessages(recent, userId, turnPlan) {
  const historyLimit = Math.max(6, Math.min(25, turnPlan?.history_limit || 16));
  const selected = recent.slice(-historyLimit);
  const messages = buildApiMessages(selected, userId);
  if (turnPlan?.context_mode === 'compact' && recent.length > historyLimit) {
    const digest = recent.slice(Math.max(0, recent.length - historyLimit - 8), -historyLimit)
      .map((row) => `${row.role}: ${String(row.content || '').replace(/\s+/g, ' ').slice(0, 90)}`)
      .join('\n');
    if (digest) {
      messages.unshift({
        role: 'system',
        content: `EARLIER CONTEXT (extractive, lower priority than recent turns and active memories):\n${digest}`,
      });
    }
  }
  return messages;
}

function saveUploadedImage(base64, type, userId) {
  const mime = String(type || '').toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('Unsupported image type');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > 4 * 1024 * 1024) throw new Error('Image is too large');
  const isPng = buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWebp = buffer.length > 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
  if (!isPng && !isJpeg && !isWebp) throw new Error('Invalid image data');
  const ext = isPng ? 'png' : (isWebp ? 'webp' : 'jpg');
  const filename = `${uuid()}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
  const url = `/uploads/${filename}`;
  registerMediaAsset(userId, url, { purpose: 'chat_image', mime, bytes: buffer.length, retentionDays: 365 });
  return url;
}

router.get('/:userId/messages', (req, res) => {
  const staged = rehearsal.history(req.params.userId);
  if (staged) { res.setHeader('Cache-Control', 'no-store'); return res.json(staged); }
  const before = String(req.query.before || '').trim() || '9999-12-31T23:59:59.999Z';
  const requested = Math.max(20, Math.min(480, Number(req.query.limit) || 480));
  const select = 'id, role, content, metadata, ppr_tagged, resonance_tagged, ppr_event_type, source, consumed, archived, created_at';
  const chatRows = db.prepare(`
    SELECT ${select} FROM messages
    WHERE user_id = ? AND source != 'keepalive' AND archived = 0
      AND role IN ('user', 'assistant', 'system') AND created_at < ?
    ORDER BY created_at DESC LIMIT ?
  `).all(req.params.userId, before, requested + 1);
  const keepaliveRows = db.prepare(`
    SELECT ${select} FROM messages
    WHERE user_id = ? AND source = 'keepalive' AND archived = 0
      AND role = 'assistant' AND created_at < ?
    ORDER BY created_at DESC LIMIT 20
  `).all(req.params.userId, before);
  const hasMore = chatRows.length > requested;
  const pageChat = chatRows.slice(0, requested);
  const rows = [...pageChat, ...keepaliveRows]
    .filter((row, index, all) => all.findIndex((item) => item.id === row.id) === index)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  res.json({
    messages: rows.map((row) => {
      const m = parseMessage(row);
      const voice = m.metadata?.assistant_voice || (row.role === 'assistant' ? m.metadata?.voice : m.metadata?.voice);
      if (voice?.url && row.role === 'assistant') {
        m.voice_url = voice.url;
        m.voice_text = voice.transcript || voice.text || '';
        m.voice_duration = voice.duration;
      }
      return m;
    }),
    pagination: {
      has_more: hasMore,
      next_before: hasMore ? pageChat[pageChat.length - 1]?.created_at || null : null,
    },
  });
});

router.post('/:userId/voice-call-end', (req, res) => {
  if (rehearsal.active(req.params.userId)) return res.status(409).json({ error: 'Rehearsal does not write formal voice-call records' });
  const user = getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { content, durationSec = 0 } = req.body || {};
  if (!content?.trim()) return res.status(400).json({ error: 'content required' });
  const id = uuid();
  const now = new Date().toISOString();
  const metadata = { voice_call_summary: true, duration_sec: durationSec };
  db.prepare(`
    INSERT INTO messages (id, user_id, role, content, metadata, source, consumed, created_at)
    VALUES (?, ?, 'system', ?, ?, 'voice_call', 1, ?)
  `).run(id, user.id, content.trim(), JSON.stringify(metadata), now);
  res.json({
    id,
    role: 'system',
    content: content.trim(),
    metadata,
    created_at: now,
  });
});

router.post('/:userId/chat', async (req, res) => {
  // Rehearsals never enter memory extraction, relationship updates, PPR or model-run logging.
  if (rehearsal.active(req.params.userId) || req.get('X-Duck-Rehearsal-Take')) {
    if (req.authUserId !== req.params.userId) return res.status(403).json({ error: 'Account mismatch' });
    try {
      if (req.body?.image || req.body?.voice) return res.status(400).json({ error: 'Rehearsal accepts text lines only' });
      const result = rehearsal.turn(req.authUserId, {
        take_id: req.get('X-Duck-Rehearsal-Take'), revision: Number(req.get('X-Duck-Rehearsal-Revision')),
        request_id: req.get('X-Duck-Rehearsal-Request'), message: req.body?.message,
        surface: req.body?.performance_mode ? 'live2d' : 'chat',
      });
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-store');
      if (result.message) res.write(`data: ${JSON.stringify({ type: 'chunk', content: result.message.content })}\n\n`);
      return res.end(`data: ${JSON.stringify(result)}\n\n`);
    } catch (error) { return res.status(error.status || 500).json({ error: error.message }); }
  }
  const user = getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { message, image, imageText, voice, lang, voiceCall, performance_mode: performanceMode, no_stickers: noStickers } = req.body || {};
  if (!message?.trim() && !image?.base64 && !voice?.url) return res.status(400).json({ error: 'message is required' });

  const now = new Date().toISOString();
  let storedContent = String(message || '').trim() || '[IMAGE] 发了一张图';
  let userMetadata = null;

  if (voice?.url) {
    const transcript = String(voice.transcript || voice.text || '').trim();
    storedContent = transcript || '[语音消息]';
    userMetadata = {
      voice: {
        url: voice.url,
        duration: voice.duration || 1,
        transcript,
        fromVoice: true,
      },
    };
  } else if (image?.base64) {
    const url = saveUploadedImage(image.base64, image.type, user.id);
    storedContent = `[IMAGE]${url}`;
    if (imageText?.trim()) storedContent = `${imageText.trim()}\n${storedContent}`;
  }
  userMetadata = {
    ...(userMetadata || {}),
    surface: performanceMode ? 'live2d' : 'chat',
  };

  const userMsgId = uuid();
  const aiTextForMode = stickerTextForAI(storedContent, user.id);
  const conversationMode = detectConversationMode(aiTextForMode);
  db.prepare(`
    INSERT INTO messages (id, user_id, role, content, metadata, conversation_mode, source, consumed, created_at)
    VALUES (?, ?, 'user', ?, ?, ?, 'chat', 1, ?)
  `).run(userMsgId, user.id, storedContent, userMetadata ? JSON.stringify(userMetadata) : null, conversationMode, now);

  if (conversationMode === 'PRESENCE') {
    applyPresenceChatEffects(user);
  }

  const pendingKeepalive = getPendingKeepaliveMessages(user.id);
  db.prepare('UPDATE messages SET consumed = 1 WHERE user_id = ? AND source = ? AND consumed = 0')
    .run(user.id, 'keepalive');

  noteChatActivity(user.id);
  ingestThoughtsFromUserMessage(user, storedContent);

  const recent = db.prepare(`
    SELECT id, role, content, metadata, created_at FROM messages
    WHERE user_id = ? AND role IN ('user','assistant') AND source = 'chat' AND archived = 0
    ORDER BY created_at DESC LIMIT 30
  `).all(user.id).reverse();

  const priorEmotion = getEmotionState(user);
  const emotionState = buildEmotionState(user, stickerTextForAI(storedContent, user.id), priorEmotion);
  const goodNight = isGoodNight(storedContent);
  const goodMorning = isGoodMorning(storedContent);
  const morningDiary = goodMorning ? getLastNightDiary(user.id) : null;
  const { memories, innerMemories, neocortex, prefrontalIntents, worldbook, pprFailures } = await buildContextBundle(user, stickerTextForAI(storedContent, user.id));
  const affectiveSignal = analyzeAffectiveSignal({
    user,
    message: stickerTextForAI(storedContent, user.id),
    conversationMode,
    emotionState,
    memories,
    messageId: userMsgId,
    recentMessages: recent,
  });
  const affectiveSignalId = saveRelationalTurnSignal(user.id, userMsgId, affectiveSignal);
  affectiveSignal.id = affectiveSignalId;
  resolvePprForUserTurn({
    userId: user.id,
    userMessageId: userMsgId,
    userContent: storedContent,
    beforeTime: now,
    reactionSignalId: affectiveSignalId,
  });
  recordAgentActionOutcome(user.id, affectiveSignal);
  const relationshipProfile = updateRelationshipProfile(user.id, userMsgId, storedContent, affectiveSignal);
  const relationalState = getRelationalStateSnapshot(user.id);
  const turnPlan = planChatTurn(user, {
    message: aiTextForMode,
    conversationMode,
    affectiveSignal,
    voiceCall: Boolean(voiceCall),
  });
  const uiLang = lang === 'en' ? 'en' : 'zh';
  const systemMessages = buildMainPromptMessages(user, {
    memories,
    innerMemories,
    neocortex,
    prefrontalIntents,
    worldbook,
    pprFailures,
    conversationMode,
    recentMessages: recent,
    pendingKeepalive,
    timeAnchor: now,
    lang: uiLang,
    emotionState,
    affectiveSignal,
    relationalState,
    turnPlan,
    greetingContext: { goodNight, goodMorning, morningDiary },
    voiceRequested: userRequestedVoice(storedContent) || Boolean(voiceCall),
    voiceCall: Boolean(voiceCall),
  });
  if (performanceMode || noStickers) {
    systemMessages.push({
      role: 'system',
      content: 'LIVE2D SURFACE: Reply to the user message itself. Plain conversational text only; no sticker tags, no roleplay actions, and no description of facial expressions or body movements. The expression layer handles performance separately.',
    });
  }
  const apiMessages = buildAdaptiveApiMessages(recent, user.id, turnPlan);

  let visionSource = null;
  if (image?.base64) {
    try {
      const visionNote = await describeImage(
        image.base64,
        image.type || 'image/jpeg',
        imageText || message || '',
      );
      console.log('[vision] qwen-vl ok', { userId: user.id, preview: visionNote.slice(0, 80) });
      const last = apiMessages[apiMessages.length - 1];
      if (last?.role === 'user') {
        apiMessages[apiMessages.length - 1] = {
          role: 'user',
          content: `${last.content}\n[TOOL RESULT source=vision epistemic=grounded confidence=medium] ${visionNote}`,
        };
      }
      visionSource = { source: 'vision', status: 'ok', confidence: 'medium' };
    } catch (e) {
      console.error('[vision] failed', user.id, e.message);
      const last = apiMessages[apiMessages.length - 1];
      if (last?.role === 'user') {
        apiMessages[apiMessages.length - 1] = {
          role: 'user',
          content: `${last.content}\n[TOOL RESULT source=vision status=failed] 暂时无法识别这张图片。`,
        };
      }
      visionSource = { source: 'vision', status: 'failed', confidence: 'none' };
    }
  }

  const modelRun = startModelRun({
    userId: user.id,
    turnId: userMsgId,
    systemMessages,
    apiMessages,
    turnPlan,
    memories,
    innerMemories,
    neocortex,
    params: {
      temperature: 0.85,
      max_tokens: turnPlan.token_budget,
      conversation_mode: conversationMode,
      performance_mode: Boolean(performanceMode),
      vision: visionSource,
    },
  });
  const promptHash = modelRun.fullHash;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let fullText = '';
  const upstreamRequest = callDeepSeekStream(
    [...systemMessages, ...apiMessages],
    {
      maxTokens: turnPlan.token_budget,
      temperature: 0.85,
      source: 'chat_stream',
      onChunk: (delta) => {
        if (res.destroyed || res.writableEnded) return;
        fullText += delta;
        const display = stripRecallTags(stripPprTag(fullText).cleaned);
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: display })}\n\n`);
      },
      onEnd: async (raw, err) => {
        if (res.destroyed || res.writableEnded) return;
        if (err) {
          completeModelRun(modelRun.id, { status: 'failed' });
          res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
          return res.end();
        }

        const { cleaned, tagged, voiceTagged } = stripPprTag(raw || fullText);
        let finalCleaned = sanitizeStickerMarkup(cleaned, user.id);
        const recallQueries = extractRecallQueries(raw || fullText);
        let blockPpr = memories.length === 0 && innerMemories.length > 0;

        if (recallQueries.length) {
          const recalled = runRecallQueries(user.id, recallQueries);
          finalCleaned = stripRecallTags(finalCleaned);
          if (recalled.length) {
            try {
              const { text: revised } = await callDeepSeek([
                ...systemMessages,
                ...apiMessages,
                { role: 'assistant', content: finalCleaned },
                { role: 'system', content: buildRecallInjectBlock(recalled, uiLang) },
                { role: 'user', content: uiLang === 'en'
                  ? 'Revise your reply using recalled memories naturally. No RECALL tags. Plain text.'
                  : '根据召回记忆自然修订回复。不要 RECALL 标签。纯文本。' },
              ], { maxTokens: turnPlan.token_budget, temperature: 0.82, source: 'chat_recall' });
              const stripped = stripPprTag(revised || finalCleaned);
              finalCleaned = sanitizeStickerMarkup(stripRecallTags(stripped.cleaned), user.id);
              blockPpr = blockPpr || (recalled.length > 0 && recalled.every((m) => m.confidence === 'low'));
            } catch (e) {
              console.warn('[recall]', user.id, e.message);
            }
          }
        } else {
          finalCleaned = stripRecallTags(finalCleaned);
        }

        const voiceRequested = userRequestedVoice(storedContent) || Boolean(voiceCall);
        const rewritten = voiceRequested ? rewriteVoiceDenialReply(finalCleaned, storedContent) : finalCleaned;
        finalCleaned = sanitizeStickerMarkup(rewritten, user.id);
        const aiTime = new Date().toISOString();
        const parts = splitAssistantBubbleParts(finalCleaned);
        const assistantMessages = [];

        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          const msgId = uuid();
          let pprOnThis = tagged && i === parts.length - 1 && !isStickerOnlyContent(part) && !blockPpr && shouldAllowPprTag(affectiveSignal, relationalState);
          db.prepare(`
            INSERT INTO messages (id, user_id, role, content, ppr_tagged, source, consumed, created_at)
            VALUES (?, ?, 'assistant', ?, ?, 'chat', 1, ?)
          `).run(msgId, user.id, part, pprOnThis ? 1 : 0, aiTime);

          assistantMessages.push({
            id: msgId,
            role: 'assistant',
            content: part,
            ppr_tagged: pprOnThis,
            created_at: aiTime,
          });

          if (pprOnThis) {
            recordPprEvent({
              userId: user.id,
              aiMessageId: msgId,
              userMessageId: userMsgId,
              eventType: 'candidate',
              aiContent: part,
              userContent: storedContent,
              affectiveSignal,
              turnId: userMsgId,
              promptHash,
              modelRunId: modelRun.id,
              contextManifest: modelRun.manifest,
            });
          }
        }

        await maybeWriteMemoryFromChat(user.id, storedContent, finalCleaned, {
          userMessageId: userMsgId,
          aiMessageIds: assistantMessages.map((item) => item.id),
        });
        maybeExtractWorldbook(user.id, storedContent, finalCleaned).catch(() => {});
        extractTodosFromChat(user, storedContent, finalCleaned).catch(() => {});

        saveEmotionState(user.id, emotionState, userMsgId);
        user.emotion_state = emotionState;
        refineEmotionAsync(user.id, storedContent, finalCleaned, emotionState).catch(() => {});

        if (goodNight) {
          writeGoodnightDiary(user, recent).catch(() => {});
        }

        const buffer = sessionBuffers.get(user.id) || [];
        buffer.push({ role: 'user', content: storedContent }, { role: 'assistant', content: finalCleaned });
        sessionBuffers.set(user.id, buffer.slice(-40));

        // Personality drift only — no automatic session-summary memories (was ~1 entry per 4 turns).
        if (buffer.length >= 20) {
          const driftMsgs = buffer.slice(-20);
          const drifted = driftPersonality(user, driftMsgs.map((m) => m.content).join('\n'));
          user.big_five = drifted.big_five;
          user.big_five_history = drifted.big_five_history;
          saveUser(user);
          sessionBuffers.set(user.id, buffer.slice(-12));
          runCogniFoldConsolidation(user, { reason: 'chat_turns' }).catch((e) => {
            console.warn('[cognifold]', user.id, e.message);
          });
        }

        const recentChat = recent.map((m) => `${m.role}: ${m.content}`).join('\n');
        const voiceCtx = detectVoiceTurnContext(storedContent, recentChat);
        const wantsVoice = userRequestedVoice(storedContent) || Boolean(voiceCall);
        // The performance stage synthesizes aligned speech with the final expression plan.
        const voiceBubble = performanceMode ? null : await emitVoiceBubbleIfNeeded(user, finalCleaned, storedContent, recentChat, {
          voiceCtx,
          voiceTagged: voiceTagged || wantsVoice,
          userRequestedVoice: wantsVoice,
          user,
        });

        if (voiceBubble) {
          const voiceTarget = [...assistantMessages].reverse().find((m) => !isStickerOnlyContent(m.content))
            || assistantMessages[assistantMessages.length - 1];
          if (voiceTarget) {
            const voiceMeta = {
              assistant_voice: {
                url: voiceBubble.url,
                transcript: voiceBubble.text,
                duration: voiceBubble.duration,
                lang: voiceBubble.lang || 'en',
              },
            };
            db.prepare('UPDATE messages SET metadata = ? WHERE id = ?').run(JSON.stringify(voiceMeta), voiceTarget.id);
            voiceTarget.voice_url = voiceBubble.url;
            voiceTarget.voice_text = voiceBubble.text;
            voiceTarget.voice_duration = voiceBubble.duration;
            voiceTarget.metadata = voiceMeta;
          }
          res.write(`data: ${JSON.stringify({
            type: 'voice_bubble',
            url: voiceBubble.url,
            text: voiceBubble.text,
            duration: voiceBubble.duration,
          })}\n\n`);
        }

        const lastMessage = assistantMessages[assistantMessages.length - 1] || null;
        const expressionPlan = buildExpressionPlan({
          affectiveSignal,
          emotionState,
          relationalState,
          relationshipProfile,
          surface: performanceMode ? 'live2d' : 'chat',
          turnId: userMsgId,
          messageId: lastMessage?.id || null,
          deliveryExpected: Boolean(performanceMode),
        });
        if (performanceMode && lastMessage && expressionPlan.command_id) {
          createDeliveryCommand({
            userId: user.id,
            turnId: userMsgId,
            messageId: lastMessage.id,
            surface: 'live2d',
            plan: expressionPlan,
          });
        }
        if (lastMessage) {
          const stored = db.prepare('SELECT metadata FROM messages WHERE id = ?').get(lastMessage.id);
          let metadata = {};
          try { metadata = JSON.parse(stored?.metadata || '{}'); } catch { metadata = {}; }
          metadata = { ...metadata, expression_plan: expressionPlan, turn_id: userMsgId, app_version: APP_VERSION };
          db.prepare('UPDATE messages SET metadata = ? WHERE id = ?').run(JSON.stringify(metadata), lastMessage.id);
          lastMessage.metadata = metadata;
        }
        res.write(`data: ${JSON.stringify({
          type: 'done',
          messages: assistantMessages,
          bubble_parts: parts,
          message: lastMessage,
          emotion_state: emotionState,
          relationship_profile: relationshipProfile,
          expression_plan: expressionPlan,
          model_run_id: modelRun.id,
          turn_plan: turnPlan,
        })}\n\n`);
        completeModelRun(modelRun.id, { output: finalCleaned, status: 'completed' });
        res.end();
      },
    }
  );
  res.on('close', () => {
    if (!res.writableEnded && upstreamRequest && !upstreamRequest.destroyed) {
      completeModelRun(modelRun.id, { output: fullText, status: 'disconnected' });
      upstreamRequest.destroy(new Error('Client disconnected'));
    }
  });
});

export default router;
