import { Router } from 'express';
import crypto from 'crypto';
import { ADMIN_SECRET_KEY } from '../config.js';
import { db } from '../db.js';
import { parseUser } from '../db.js';
import { getPprAnalytics, deletePprEvent, clearUserPprEvents } from '../services/ppr.js';
import { getPprCorrectionStats } from '../services/pprCorrection.js';
import { buildAdminDashboard } from '../services/adminAnalytics.js';
import { listMemories, listMemoryRecycle, updateMemory, deleteMemory, restoreMemory } from '../services/memory.js';
import {
  consolidateDiaryMemories,
} from '../services/memoryConsolidate.js';
import { runCogniFoldConsolidation, backfillHippocampusTags } from '../services/cogniFold.js';
import { getDesireAdminData } from '../services/desireDrive.js';
import { getConversationModeStats } from '../services/adminAnalytics.js';
import { sendTestPush } from '../services/push.js';
import { listPendingReviews, resolvePendingReview, deletePendingReview, getPendingReviewStats } from '../services/pendingReview.js';

const router = Router();

function requireAdmin(req, res, next) {
  const supplied = String(req.headers['x-admin-key'] || req.query.key || '');
  const expected = String(ADMIN_SECRET_KEY || '');
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  const valid = left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
  if (!valid) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

router.use(requireAdmin);

router.get('/dashboard', (req, res) => {
  const filters = {
    userId: req.query.userId || '',
    eventType: req.query.eventType || '',
    from: req.query.from || '',
    to: req.query.to || '',
    limit: Number(req.query.limit || 500),
  };
  res.json(buildAdminDashboard(filters));
});

router.get('/overview', (req, res) => {
  const filters = {
    userId: req.query.userId || '',
    eventType: req.query.eventType || '',
    from: req.query.from || '',
    to: req.query.to || '',
  };
  const dashboard = buildAdminDashboard(filters);
  res.json({
    ...dashboard.summary,
    users: dashboard.summary.users,
    messageCount: dashboard.summary.messages,
    memoryCount: dashboard.summary.memories,
    ppr: getPprAnalytics(),
    pprCorrection: getPprCorrectionStats(),
    keepaliveStats: dashboard.keepalive.distribution,
    memoryByCategory: dashboard.memory.by_category,
    userSummaries: dashboard.users,
    dashboard,
  });
});

router.get('/user/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const parsed = parseUser(user);
  const dashboard = buildAdminDashboard({ userId: req.params.id });
  res.json({
    user: parsed,
    analytics: dashboard.user_analytics[0] || null,
    ppr_events: dashboard.ppr.events,
    first_ppr: dashboard.first_ppr.find((r) => r.user_id === req.params.id) || null,
  });
});

router.delete('/ppr/:eventId', (req, res) => {
  const ok = deletePprEvent(req.params.eventId);
  if (!ok) return res.status(404).json({ error: 'PPR event not found' });
  res.json({ ok: true });
});

router.delete('/ppr/user/:userId', (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const deleted = clearUserPprEvents(req.params.userId);
  res.json({ ok: true, deleted });
});

router.get('/memories/:userId', (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const category = String(req.query.category || '').trim();
  const memories = listMemories(req.params.userId, category || undefined).map((m) => ({
    id: m.id,
    category: m.category,
    content: m.content,
    tags: m.tags,
    thread: m.thread,
    topic_key: m.topic_key,
    memory_key: m.memory_key,
    confidence: m.confidence,
    source_type: m.source_type,
    source_ref: m.source_ref,
    epistemic_mode: m.epistemic_mode,
    valid_from: m.valid_from,
    status: m.status,
    created_at: m.created_at,
    access_count: m.access_count,
  }));
  res.json({ memories, category: category || 'all' });
});

router.patch('/memories/:userId/:memoryId', (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { content, category } = req.body || {};
  if (content === undefined && category === undefined) {
    return res.status(400).json({ error: 'content or category required' });
  }
  const updated = updateMemory(req.params.userId, req.params.memoryId, { content, category });
  if (!updated) return res.status(404).json({ error: 'Memory not found' });
  res.json({ memory: updated });
});

router.delete('/memories/:userId/:memoryId', (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const ok = deleteMemory(req.params.userId, req.params.memoryId);
  if (!ok) return res.status(404).json({ error: 'Memory not found' });
  res.json({ ok: true, status: 'recycled' });
});

router.get('/memories/:userId/recycle', (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ memories: listMemoryRecycle(req.params.userId, req.query.limit) });
});

router.post('/memories/:userId/:memoryId/restore', (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const restored = restoreMemory(req.params.userId, req.params.memoryId);
  if (!restored) return res.status(409).json({ error: 'Memory cannot be restored while a newer active version exists' });
  res.json({ ok: true, memory: restored });
});

router.post('/memories/:userId/consolidate-session-summaries', async (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  try {
    const maxPerDay = Number(req.body?.maxPerDay);
    const result = await consolidateDiaryMemories(req.params.userId, {
      maxPerDay: Number.isFinite(maxPerDay) && maxPerDay > 0 ? maxPerDay : 1,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[consolidate]', req.params.userId, e.message);
    res.status(500).json({ error: e.message || 'Consolidation failed' });
  }
});

router.post('/memories/:userId/cognifold', async (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  try {
    if (req.body?.backfill) backfillHippocampusTags(req.params.userId);
    const result = await runCogniFoldConsolidation(req.params.userId, { reason: 'admin' });
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[cognifold]', req.params.userId, e.message);
    res.status(500).json({ error: e.message || 'CogniFold consolidation failed' });
  }
});

router.get('/desire/:userId', (req, res) => {
  const data = getDesireAdminData(req.params.userId);
  if (!data) return res.status(404).json({ error: 'User not found' });
  res.json(data);
});

router.get('/conversation-mode', (req, res) => {
  const stats = getConversationModeStats({
    userId: req.query.userId || '',
    from: req.query.from || '',
    to: req.query.to || '',
  });
  res.json(stats);
});

router.post('/push/test/:userId', async (req, res) => {
  const user = db.prepare('SELECT id, name, device_token FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const message = String(req.body?.message || '测试推送 — 如果你看到这条，keepalive 推送正常。');
  const result = await sendTestPush(user.id, message);
  res.json({
    ...result,
    user: user.name,
    has_subscription: Boolean(user.device_token),
  });
});


router.get('/pending-review', (req, res) => {
  res.json({
    stats: getPendingReviewStats(),
    items: listPendingReviews({
      userId: req.query.userId || '',
      status: req.query.status || 'pending',
      type: req.query.type || '',
      limit: Number(req.query.limit || 100),
    }),
  });
});

router.post('/pending-review/:userId/:reviewId/resolve', (req, res) => {
  const review = resolvePendingReview(req.params.reviewId, req.params.userId, req.body?.status || 'approved');
  if (!review) return res.status(404).json({ error: 'Pending review not found' });
  res.json({ review });
});

router.delete('/pending-review/:userId/:reviewId', (req, res) => {
  const ok = deletePendingReview(req.params.reviewId, req.params.userId);
  if (!ok) return res.status(404).json({ error: 'Pending review not found' });
  res.json({ ok: true });
});

export default router;
