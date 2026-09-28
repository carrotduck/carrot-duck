import { Router } from 'express';
import { listMemories } from '../services/memory.js';
import { listPprEvents, markMoment, hasFullPprEvent } from '../services/ppr.js';
import { getRecentActivity, getPendingKeepaliveMessages, runInstantRoam, deleteKeepaliveLog } from '../services/keepalive.js';
import { listWorldbook, addWorldbookEntry } from '../services/worldbook.js';
import { listFavorites } from '../services/favorites.js';
import { db, getUser } from '../db.js';
import { bigFiveToNaturalLanguage, daysSince } from '../services/personality.js';
import { listEmotionLogs } from '../services/occ.js';
import { isInRoamingWindow, isWithinShanghaiDays, formatShanghaiTime } from '../utils/timezone.js';
import { roamActionLabel } from '../services/roam.js';
import { isUserVisibleDiaryEntry } from '../services/diaryQuota.js';

const router = Router();

router.get('/:userId/home', (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const activity = getRecentActivity(req.params.userId, 3);
  const latest = activity[0];
  let status_line = '在这里';
  if (latest?.action === 'idle' || latest?.action === 'none') status_line = '今天很安静';
  else if (latest?.action === 'review_memory') status_line = '翻了翻记忆';
  else if (latest?.action === 'review_favorites') status_line = '翻了翻收藏';
  else if (latest?.action === 'web_search' || latest?.action === 'explore') status_line = '上网冲浪了';
  else if (latest?.action === 'message') status_line = '刚想过你';
  else if (latest?.action === 'associate') status_line = '联想了一会儿';
  else if (latest?.action === 'wonder') status_line = '惦念着你';
  else if (latest?.action === 'introspect') status_line = '自省了一下';
  else if (latest?.action === 'diary') status_line = '写了一点什么';
  else status_line = bigFiveToNaturalLanguage(user.big_five, user.keywords).split('.')[0] || '在这里';
  res.json({
    status_line,
    days_known: daysSince(user.created_at),
    recent_activity: activity,
  });
});

router.get('/:userId/memories', (req, res) => {
  res.json({ memories: listMemories(req.params.userId, req.query.category) });
});

router.get('/:userId/worldbook', (req, res) => {
  res.json({ entries: listWorldbook(req.params.userId) });
});

router.post('/:userId/worldbook', (req, res) => {
  const { keyword, content } = req.body || {};
  if (!keyword || !content) return res.status(400).json({ error: 'keyword and content required' });
  const entry = addWorldbookEntry(req.params.userId, keyword, content);
  res.json({ entry });
});

router.get('/:userId/keepalive/pending', (req, res) => {
  res.json({ messages: getPendingKeepaliveMessages(req.params.userId) });
});

const ROAMING_LABEL = {
  idle: '发呆',
  none: '发呆',
  associate: '联想',
  review_memory: '回忆',
  wonder: '惦念',
  introspect: '自省',
  review_favorites: '回味',
  message: '留字',
  diary: '思考',
  web_search: '探索',
  explore: '探索',
};

router.get('/:userId/diary', (req, res) => {
  const userId = req.params.userId;
  const user = getUser(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const memories = listMemories(userId, 'diary')
    .filter(isUserVisibleDiaryEntry)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const keepalive = getRecentActivity(userId, 200);
  const tz = user.timezone || 'Asia/Shanghai';

  const windowLogs = keepalive.filter((a) => isInRoamingWindow(a.created_at, tz));
  const todayRoaming = {};
  for (const log of windowLogs) {
    const label = ROAMING_LABEL[log.action] || log.action || '漫游';
    todayRoaming[label] = (todayRoaming[label] || 0) + 1;
  }

  const weekRoamingCount = keepalive.filter((a) => isWithinShanghaiDays(a.created_at, 7)).length;
  const favorites = listFavorites(userId, 100);

  const todayRoamingEvents = windowLogs
    .slice()
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map((log) => ({
      id: log.id,
      time: formatShanghaiTime(log.created_at),
      action: log.action,
      label: roamActionLabel(log.action),
      display: roamActionLabel(log.action),
      thoughts: log.thoughts || '',
      created_at: log.created_at,
    }));

  res.json({
    diary: memories,
    today_roaming: todayRoaming,
    today_roaming_logs: windowLogs,
    today_roaming_events: todayRoamingEvents,
    week_roaming_count: weekRoamingCount,
    favorites,
  });
});

router.delete('/:userId/roam/:logId', (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const ok = deleteKeepaliveLog(user.id, req.params.logId);
  if (!ok) return res.status(404).json({ error: 'Roam entry not found' });
  res.json({ ok: true });
});

router.post('/:userId/roam', async (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  try {
    const event = await runInstantRoam(user);
    res.json({
      ok: true,
      event: {
        id: event.logId || event.id || null,
        time: formatShanghaiTime(event.created_at),
        action: event.action,
        label: roamActionLabel(event.action),
        display: roamActionLabel(event.action),
        thoughts: event.thoughts || '',
        created_at: event.created_at,
      },
    });
  } catch (e) {
    if (e.code === 'ROAM_BUSY') return res.status(409).json({ error: 'Roam already in progress' });
    res.status(500).json({ error: e.message });
  }
});

router.get('/:userId/ppr', (req, res) => {
  const fullOnly = req.query.fullOnly === '1';
  const userId = req.params.userId;
  res.json({
    has_full: hasFullPprEvent(userId),
    events: listPprEvents(userId, { fullOnly }),
  });
});

router.post('/:userId/ppr/mark/:messageId', (req, res) => {
  const id = markMoment(req.params.userId, req.params.messageId);
  if (!id) return res.status(404).json({ error: 'Message not found' });
  res.json({ ok: true, id });
});

router.get('/:userId/emotions', (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    current: user.emotion_state || null,
    history: listEmotionLogs(req.params.userId, Number(req.query.limit) || 60),
  });
});

router.get('/:userId/export', (req, res) => {
  const userId = req.params.userId;
  const messages = db.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at ASC').all(userId);
  const memories = db.prepare('SELECT * FROM memory_entries WHERE user_id = ? ORDER BY created_at ASC').all(userId);
  const ppr = db.prepare('SELECT * FROM ppr_events WHERE user_id = ? ORDER BY created_at ASC').all(userId);
  res.json({ messages, memories, ppr_events: ppr, exported_at: new Date().toISOString() });
});

export default router;
