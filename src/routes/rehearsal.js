import { Router } from 'express';
import { rehearsal, bodyEvents } from '../services/rehearsal.js';

const router = Router({ mergeParams: true });
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!req.authUserId || req.authUserId !== req.params.userId) return res.status(403).json({ error: 'Account mismatch' });
  if (!rehearsal.enabled(req.authUserId)) return res.status(403).json({ error: 'Rehearsal is not enabled for this account' });
  next();
});
router.get('/', (req, res) => res.json(rehearsal.snapshot(req.authUserId)));
router.get('/body-events', (req,res) => {
  try { res.json(bodyEvents.read(req.authUserId,req.query.take_id,Number(req.query.after||0))); }
  catch(error){res.status(error.status||500).json({error:error.message});}
});
router.post('/body-events', (req,res) => {
  try {
    const b=req.body||{};
    if(['launch','executor_poll','executor_result'].includes(b.command))return res.json(bodyEvents.executor(req.authUserId,b));
    if(!['open','heartbeat','close','commit','ack'].includes(b.command))return res.status(400).json({error:'Unknown body command'});
    res.json(['commit','ack'].includes(b.command)?bodyEvents[b.command](req.authUserId,b):bodyEvents[b.command](req.authUserId,b.take_id));
  } catch(error){res.status(error.status||500).json({error:error.message});}
});
router.post('/', (req, res) => {
  try {
    const body = req.body || {};
    res.json(body.command === 'start'
      ? rehearsal.start(req.authUserId, body.scene, body.take_id)
      : rehearsal.update(req.authUserId, body));
  } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});
export default router;
