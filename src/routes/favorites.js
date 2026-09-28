import { Router } from 'express';
import { getUser } from '../db.js';
import { addFavorite, listFavorites, removeFavorite } from '../services/favorites.js';

const router = Router();

router.get('/:userId', (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ favorites: listFavorites(req.params.userId) });
});

router.post('/:userId/add', (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { messageId, content, role, source } = req.body || {};
  const id = addFavorite(user.id, { messageId, content, role, source: source || 'manual' });
  if (!id) return res.status(400).json({ error: 'content required' });
  res.json({ ok: true, id });
});

router.post('/:userId/remove', (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { id, content } = req.body || {};
  removeFavorite(user.id, { id, content });
  res.json({ ok: true });
});

export default router;
