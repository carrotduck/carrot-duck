import { Router } from 'express';
import { getUser } from '../db.js';
import { getVapidPublicKey, hasPushSubscription, savePushSubscription, sendTestPush } from '../services/push.js';

const router = Router();

router.get('/vapid-public-key', (_req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

router.post('/:userId/subscribe', (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { subscription } = req.body || {};
  if (!subscription?.endpoint) return res.status(400).json({ error: 'subscription required' });
  savePushSubscription(user.id, subscription);
  res.json({ ok: true });
});

router.post('/:userId/test', async (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const message = String(req.body?.message || '测试推送 — 小鸭找你啦');
  const result = await sendTestPush(user.id, message);
  res.json({
    ...result,
    has_subscription: hasPushSubscription(user.id),
  });
});

export default router;
