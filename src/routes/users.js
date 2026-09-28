import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { db, getUser, saveUser } from '../db.js';
import { keywordsToBigFive, pickVoiceId, driftPersonality, axisScores, relationshipTriValues, computeDepthScore, getRelationshipStageLabel, daysSince, DEFAULT_VOICE_ID } from '../services/personality.js';
import { callDeepSeek } from '../services/deepseek.js';
import { buildIntroPrompt } from '../services/prompts.js';
import { createInitialDesireState } from '../services/desireDrive.js';
import {
  authenticateBearer,
  bootstrapLegacyCredentials,
  issueCredentials,
  parseRecoveryKey,
  verifyRecoveryCode,
} from '../middleware/security.js';
import { getRelationshipProfile } from '../services/relationshipProfile.js';
import { deleteUserStickerFiles } from '../services/userStickers.js';
import { deleteMediaFiles } from '../services/mediaAssets.js';

const router = Router();

router.post('/onboarding', async (req, res) => {
  try {
    const { name, pronouns, ai_gender, keywords, ai_name, timezone, work_start, work_end } = req.body || {};
    if (!name || !keywords) {
      return res.status(400).json({ error: 'name and keywords are required' });
    }

    const id = uuid();
    const now = new Date().toISOString();
    const bigFive = keywordsToBigFive(keywords);
    const user = {
      id,
      name: String(name).trim(),
      pronouns: pronouns || 'they/them',
      ai_gender: ai_gender || 'neutral',
      ai_name: (ai_name && String(ai_name).trim()) || 'Duck',
      keywords,
      big_five: bigFive,
      big_five_history: [{ timestamp: now, values: bigFive }],
      voice_id: pickVoiceId(keywords),
      notify_keepalive: true,
      notify_diary: true,
      notify_window_start: 8,
      notify_window_end: 1,
      timezone: timezone || 'Asia/Shanghai',
      work_start: work_start || null,
      work_end: work_end || null,
      desire_state: createInitialDesireState(keywords),
      created_at: now,
      last_active: now,
    };
    saveUser(user);
    const credentials = issueCredentials(id);

    const introMessages = buildIntroPrompt(user);
    let text;
    try {
      ({ text } = await callDeepSeek(introMessages, { maxTokens: 220, temperature: 0.85, source: 'onboarding' }));
    } catch (error) {
      console.warn('[onboarding] intro fallback:', error.message);
      text = `你好，${user.name}。我是${user.ai_name}，一个会记得我们共同经历、也会尊重你边界的 AI。我们可以慢慢认识。`;
    }
    const msgId = uuid();
    db.prepare(`
      INSERT INTO messages (id, user_id, role, content, source, consumed, created_at)
      VALUES (?, ?, 'assistant', ?, 'chat', 1, ?)
    `).run(msgId, id, text, now);

    res.json({
      user,
      ...credentials,
      intro: { id: msgId, role: 'assistant', content: text, created_at: now },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/recover', (req, res) => {
  const { userId, recoveryCode } = parseRecoveryKey(req.body?.recovery_key || req.body?.id);
  const user = getUser(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const authRow = db.prepare('SELECT auth_token_hash, recovery_code_hash FROM users WHERE id = ?').get(user.id);
  if (authRow?.auth_token_hash && !verifyRecoveryCode(user.id, recoveryCode)) {
    return res.status(401).json({ error: 'Recovery key required', code: 'RECOVERY_KEY_REQUIRED' });
  }

  const credentials = authRow?.auth_token_hash
    ? issueCredentials(user.id, { rotateRecovery: false })
    : issueCredentials(user.id, { rotateRecovery: true });
  res.json({
    user,
    ...credentials,
    recovery_key: credentials.recovery_key || `${user.id}.${recoveryCode}`,
  });
});

router.get('/user/:id', (req, res) => {
  const user = getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const sessionUserId = authenticateBearer(req);
  if (sessionUserId && sessionUserId !== user.id) {
    return res.status(403).json({ error: 'This session cannot access another account', code: 'ACCOUNT_MISMATCH' });
  }
  if (sessionUserId === user.id) return res.json({ user });

  const credentials = bootstrapLegacyCredentials(user.id);
  if (!credentials) {
    return res.status(401).json({ error: 'Session or recovery key required', code: 'SESSION_REQUIRED' });
  }
  res.json({ user, ...credentials, legacy_migrated: true });
});

router.patch('/user/:id', (req, res) => {
  const user = getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { name, pronouns, notify_keepalive, notify_diary, notify_window_start, notify_window_end, ui_lang, ui_theme, ai_name, timezone, work_start, work_end, voice_id, calendar_duck_assist, together_rain_until } = req.body || {};
  if (name) user.name = String(name).trim();
  if (pronouns) user.pronouns = pronouns;
  if (ai_name != null) user.ai_name = String(ai_name).trim() || 'Duck';
  if (timezone) user.timezone = timezone;
  if (work_start !== undefined) user.work_start = work_start || null;
  if (work_end !== undefined) user.work_end = work_end || null;
  if (typeof notify_keepalive === 'boolean') user.notify_keepalive = notify_keepalive;
  if (typeof notify_diary === 'boolean') user.notify_diary = notify_diary;
  if (notify_window_start != null) user.notify_window_start = Number(notify_window_start);
  if (notify_window_end != null) user.notify_window_end = Number(notify_window_end);
  if (ui_lang === 'en' || ui_lang === 'zh') user.ui_lang = ui_lang;
  if (['auto', 'morning', 'afternoon', 'night'].includes(ui_theme)) user.ui_theme = ui_theme;
  if (voice_id !== undefined) {
    const v = String(voice_id || '').trim();
    user.voice_id = v && /^[A-Za-z0-9]{10,32}$/.test(v) ? v : DEFAULT_VOICE_ID;
  }
  if (typeof calendar_duck_assist === 'boolean') user.calendar_duck_assist = calendar_duck_assist;
  if (together_rain_until !== undefined) user.together_rain_until = together_rain_until || null;
  user.last_active = new Date().toISOString();
  saveUser(user);
  res.json({ user });
});

router.post('/user/:id/reset', (req, res) => {
  const userId = req.params.id;
  const mediaUrls = db.prepare('SELECT url_path FROM media_assets WHERE user_id = ?').all(userId).map((row) => row.url_path);
  const reset = db.transaction(() => {
    const tables = [
      'relationship_evidence', 'relationship_profiles', 'relational_turn_signals',
      'pending_review', 'emotion_logs', 'user_stickers', 'push_subscriptions', 'media_assets', 'messages', 'memory_entries',
      'ppr_events', 'keepalive_logs', 'worldbook_entries', 'favorites', 'todos',
      'model_runs', 'delivery_commands', 'agent_actions',
    ];
    db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId);
    for (const table of tables) db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
    for (const table of ['desire_snapshots', 'desire_action_logs']) {
      const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      if (exists) db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  reset();
  try {
    deleteMediaFiles(mediaUrls);
    deleteUserStickerFiles(userId);
  } catch (error) {
    console.warn('[account-reset] data reset succeeded but media cleanup failed:', error.message);
  }
  res.json({ ok: true });
});

router.get('/user/:id/personality', (req, res) => {
  const user = getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const history = user.big_five_history || [];
  const initialBigFive = history[0]?.values || keywordsToBigFive(user.keywords);
  const initialAxes = axisScores(user.keywords, initialBigFive);
  const currentAxes = axisScores(user.keywords, user.big_five);
  res.json({
    keywords: user.keywords,
    big_five: user.big_five,
    history,
    drift_events: Math.max(0, history.length - 1),
    days_since_start: daysSince(user.created_at),
    depth_score: computeDepthScore(req.params.id, db, user),
    relationship_stage: getRelationshipStageLabel(user, db),
    relationship_profile: getRelationshipProfile(user.id, user),
    axes: { initial: initialAxes, current: currentAxes },
    relationship: {
      initial: relationshipTriValues(user.keywords, initialBigFive),
      current: relationshipTriValues(user.keywords, user.big_five),
    },
  });
});

router.post('/user/:id/personality/drift', (req, res) => {
  const user = getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { sessionSummary } = req.body || {};
  const drifted = driftPersonality(user, sessionSummary);
  user.big_five = drifted.big_five;
  user.big_five_history = drifted.big_five_history;
  saveUser(user);
  res.json({ big_five: user.big_five, history: user.big_five_history });
});

export default router;
