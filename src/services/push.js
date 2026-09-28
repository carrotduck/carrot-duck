import webpush from 'web-push';
import { db } from '../db.js';
import { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL } from '../config.js';
import { isReasonableKeepaliveHour } from '../utils/timeContext.js';

const COOLDOWN_MS = 45 * 60 * 1000;
let vapidReady = false;

function ensureVapid() {
  if (vapidReady) return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidReady = true;
    return true;
  }
  return false;
}

export function getVapidPublicKey() {
  return VAPID_PUBLIC_KEY || '';
}

export function savePushSubscription(userId, subscription) {
  const endpoint = String(subscription?.endpoint || '').trim();
  if (!/^https:\/\//i.test(endpoint) || endpoint.length > 2048) throw new Error('Invalid push subscription');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO push_subscriptions (endpoint, user_id, subscription_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id,
      subscription_json = excluded.subscription_json,
      updated_at = excluded.updated_at
  `).run(endpoint, userId, JSON.stringify(subscription), now, now);
  db.prepare('UPDATE users SET device_token = ? WHERE id = ?').run(JSON.stringify(subscription), userId);
}

export function hasPushSubscription(userId) {
  const row = db.prepare('SELECT 1 FROM push_subscriptions WHERE user_id = ? LIMIT 1').get(userId);
  if (row) return true;
  return Boolean(db.prepare('SELECT device_token FROM users WHERE id = ?').get(userId)?.device_token);
}

export async function sendKeepalivePush(user, messageText, { skipCooldown = false, skipWindow = false } = {}) {
  if (!user?.notify_keepalive) return { ok: false, reason: 'disabled' };
  if (!skipWindow && !isReasonableKeepaliveHour(user)) return { ok: false, reason: 'outside_window' };
  const title = user.ai_name || 'Duck';
  return sendUserPush(user, { title, body: messageText, skipCooldown });
}

export async function sendTodoReminderPush(user, todo) {
  const lang = user.ui_lang === 'en' ? 'en' : 'zh';
  const title = lang === 'en' ? 'Todo reminder' : '待办提醒';
  const timeSuffix = todo.due_time ? ` · ${todo.due_time}` : '';
  const body = `${todo.content}${timeSuffix}`;
  return sendUserPush(user, { title, body, skipCooldown: true });
}

export async function sendDiaryPush(user, snippet) {
  if (user?.notify_diary === false) return { ok: false, reason: 'disabled' };
  const lang = user.ui_lang === 'en' ? 'en' : 'zh';
  const title = lang === 'en'
    ? `${user.ai_name || 'Duck'} wrote tonight's diary`
    : `${user.ai_name || 'Duck'} 写了今晚的日记`;
  const body = String(snippet || '').trim().slice(0, 80);
  if (!body) return { ok: false, reason: 'empty_body' };
  return sendUserPush(user, { title, body, skipCooldown: true });
}

async function sendUserPush(user, { title, body, skipCooldown = false } = {}) {
  if (!ensureVapid()) return { ok: false, reason: 'no_vapid' };
  const row = db.prepare('SELECT device_token, push_last_at FROM users WHERE id = ?').get(user.id);
  const stored = db.prepare('SELECT endpoint, subscription_json FROM push_subscriptions WHERE user_id = ? ORDER BY updated_at DESC')
    .all(user.id);
  if (!stored.length && row?.device_token) {
    try {
      const legacy = JSON.parse(row.device_token);
      if (legacy?.endpoint) stored.push({ endpoint: legacy.endpoint, subscription_json: row.device_token, legacy: true });
    } catch { /* invalid legacy value */ }
  }
  if (!stored.length) return { ok: false, reason: 'no_subscription' };

  if (!skipCooldown && row.push_last_at) {
    const since = Date.now() - new Date(row.push_last_at).getTime();
    if (since < COOLDOWN_MS) return { ok: false, reason: 'cooldown' };
  }

  const hadSticker = /\[STICKER:[^\]]+\]/i.test(String(body || ''));
  let cleanBody = String(body || '').replace(/\[STICKER:[^\]]+\]/gi, '').trim().slice(0, 120);
  if (!cleanBody && hadSticker) {
    cleanBody = user.ui_lang === 'en' ? 'Sent a sticker' : '发来了一张表情';
  }
  if (!cleanBody) return { ok: false, reason: 'empty_body' };

  const url = '/';

  let sent = 0;
  let lastError = null;
  for (const entry of stored) {
    try {
      const sub = JSON.parse(entry.subscription_json);
      await webpush.sendNotification(sub, JSON.stringify({ title: title || user.ai_name || 'Duck', body: cleanBody, url }));
      sent += 1;
    } catch (e) {
      lastError = e;
      if (e.statusCode === 404 || e.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(entry.endpoint, user.id);
        if (entry.legacy) db.prepare('UPDATE users SET device_token = NULL WHERE id = ?').run(user.id);
      }
      console.error('[push]', user.id, e.message);
    }
  }
  if (sent > 0) {
    db.prepare('UPDATE users SET push_last_at = ? WHERE id = ?').run(new Date().toISOString(), user.id);
    return { ok: true, sent };
  }
  return { ok: false, reason: lastError?.message || 'push failed', statusCode: lastError?.statusCode };
}

export async function sendTestPush(userId, messageText = '测试推送 — 如果你看到这条，keepalive 推送正常。') {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return { ok: false, reason: 'user_not_found' };
  return sendKeepalivePush(user, messageText, { skipCooldown: true, skipWindow: true });
}
