import { Router } from 'express';
import { getUser } from '../db.js';
import { listDeliveryCommands, recordDeliveryReceipt } from '../services/deliveryReceipts.js';

const router = Router();

router.post('/:userId/:commandId/receipt', (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const receipt = recordDeliveryReceipt(user.id, req.params.commandId, req.body?.status, req.body || {});
  if (!receipt) return res.status(404).json({ error: 'Delivery command not found or invalid status' });
  return res.json({ ok: true, command_id: receipt.command_id, status: receipt.status });
});

router.get('/:userId/recent', (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ commands: listDeliveryCommands(user.id, req.query.limit) });
});

export default router;

