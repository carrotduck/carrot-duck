import { v4 as uuid } from 'uuid';
import { db } from '../db.js';
import { callDeepSeek } from './deepseek.js';
import { userDateKey } from '../utils/timezone.js';
import { addPendingReview } from './pendingReview.js';

export function createTodo(userId, { content, dueDate, dueTime, createdBy = 'user', status = 'pending', repeatRule = null }) {
  const id = uuid();
  const now = new Date().toISOString();
  const normalizedStatus = status === 'pending_review' ? 'pending_review' : 'pending';
  db.prepare(`
    INSERT INTO todos (id, user_id, content, due_date, due_time, created_by, status, repeat_rule, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, String(content).trim(), dueDate || null, dueTime || null, createdBy, normalizedStatus, repeatRule || null, now);
  return getTodo(id);
}

export function getTodo(id) {
  return db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
}

export function listTodos(userId, { date, status = 'pending' } = {}) {
  let sql = 'SELECT * FROM todos WHERE user_id = ?';
  const params = [userId];
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (date) {
    sql += ' AND due_date = ?';
    params.push(date);
  }
  sql += ' ORDER BY due_date ASC, due_time ASC, datetime(created_at) ASC';
  return db.prepare(sql).all(...params);
}

export function getPendingReviewTodos(userId) {
  return db.prepare(`
    SELECT * FROM todos WHERE user_id = ? AND status = 'pending_review'
    ORDER BY datetime(created_at) DESC
  `).all(userId);
}

export function confirmPendingTodo(id, userId) {
  const row = db.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ? AND status = ?').get(id, userId, 'pending_review');
  if (!row) return null;
  db.prepare('UPDATE todos SET status = ? WHERE id = ? AND user_id = ?').run('pending', id, userId);
  return getTodo(id);
}

export function rejectPendingTodo(id, userId) {
  const result = db.prepare('DELETE FROM todos WHERE id = ? AND user_id = ? AND status = ?').run(id, userId, 'pending_review');
  return result.changes > 0;
}

function addDaysKey(dateKey, days) {
  const d = new Date(`${dateKey}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonthsKey(dateKey, months) {
  const [y, m, day] = dateKey.split('-').map(Number);
  const d = new Date(y, m - 1 + months, day);
  return d.toISOString().slice(0, 10);
}

export function computeNextDueDate(dateKey, repeatRule) {
  if (!dateKey || !repeatRule) return null;
  if (repeatRule === 'weekly') return addDaysKey(dateKey, 7);
  if (repeatRule === 'monthly') return addMonthsKey(dateKey, 1);
  return null;
}

export function advanceRecurringTodos(userId, timeZone = 'Asia/Shanghai') {
  const today = userDateKey(new Date(), timeZone);
  const rows = db.prepare(`
    SELECT * FROM todos WHERE user_id = ? AND status = 'pending' AND repeat_rule IS NOT NULL AND due_date IS NOT NULL AND due_date < ?
  `).all(userId, today);
  for (const row of rows) {
    let next = row.due_date;
    while (next && next < today) {
      const candidate = computeNextDueDate(next, row.repeat_rule);
      if (!candidate || candidate === next) break;
      next = candidate;
    }
    if (next && next !== row.due_date) {
      db.prepare('UPDATE todos SET due_date = ?, reminded_at = NULL WHERE id = ?').run(next, row.id);
    }
  }
}

export function datesWithTodos(userId, year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const rows = db.prepare(`
    SELECT DISTINCT due_date FROM todos
    WHERE user_id = ? AND status IN ('pending', 'pending_review') AND due_date LIKE ?
  `).all(userId, `${prefix}-%`);
  return rows.map((r) => r.due_date).filter(Boolean);
}

export function listUndatedTodos(userId) {
  return db.prepare(`
    SELECT * FROM todos WHERE user_id = ? AND status = 'pending' AND due_date IS NULL
    ORDER BY datetime(created_at) DESC
  `).all(userId);
}

export function markTodoReminded(id) {
  db.prepare('UPDATE todos SET reminded_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}

function localTimeKey(date, timeZone = 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function getTodosNeedingReminder(userId, timeZone = 'Asia/Shanghai') {
  const now = new Date();
  const today = userDateKey(now, timeZone);
  const nowKey = localTimeKey(now, timeZone);
  const rows = db.prepare(`
    SELECT * FROM todos
    WHERE user_id = ? AND status = 'pending' AND reminded_at IS NULL AND due_date = ?
  `).all(userId, today);

  return rows.filter((t) => {
    if (t.due_time) return String(t.due_time).slice(0, 5) === nowKey;
    return nowKey === '08:00';
  });
}

export function updateTodo(id, userId, { status, content, dueDate, dueTime, repeatRule } = {}) {
  const existing = db.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?').get(id, userId);
  if (!existing) return null;

  const nextContent = content !== undefined ? String(content).trim() : existing.content;
  if (content !== undefined && !nextContent) return null;

  const nextStatus = status !== undefined ? status : existing.status;
  const nextDate = dueDate !== undefined ? (dueDate || null) : existing.due_date;
  const nextTime = dueTime !== undefined ? (dueTime || null) : existing.due_time;
  const nextRepeat = repeatRule !== undefined ? (repeatRule || null) : existing.repeat_rule;
  const dateOrTimeChanged = dueDate !== undefined || dueTime !== undefined;
  const remindedAt = dateOrTimeChanged ? null : existing.reminded_at;

  db.prepare(`
    UPDATE todos
    SET content = ?, due_date = ?, due_time = ?, status = ?, repeat_rule = ?, reminded_at = ?
    WHERE id = ? AND user_id = ?
  `).run(nextContent, nextDate, nextTime, nextStatus, nextRepeat, remindedAt, id, userId);

  if (nextStatus === 'done' && existing.repeat_rule && existing.due_date) {
    const nextDue = computeNextDueDate(existing.due_date, existing.repeat_rule);
    if (nextDue) {
      createTodo(userId, {
        content: existing.content,
        dueDate: nextDue,
        dueTime: existing.due_time,
        createdBy: existing.created_by,
        repeatRule: existing.repeat_rule,
      });
    }
  }

  return getTodo(id);
}

export function updateTodoStatus(id, userId, status) {
  return updateTodo(id, userId, { status });
}

export function deleteTodo(id, userId) {
  const result = db.prepare('DELETE FROM todos WHERE id = ? AND user_id = ?').run(id, userId);
  return result.changes > 0;
}

export function getDueSoonTodos(userId, withinHours = 3, timeZone = 'Asia/Shanghai') {
  const now = new Date();
  const today = userDateKey(now, timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  const nowMins = hour * 60 + minute;

  const rows = db.prepare(`
    SELECT * FROM todos WHERE user_id = ? AND status = 'pending'
    AND due_date IS NOT NULL
    AND (due_date = ? OR due_date > ?)
    ORDER BY due_date ASC, due_time ASC LIMIT 20
  `).all(userId, today, today);

  return rows.filter((t) => {
    if (t.due_date > today) return true;
    if (!t.due_time) return true;
    const [h, m] = String(t.due_time).split(':').map(Number);
    const dueMins = (h || 0) * 60 + (m || 0);
    return dueMins >= nowMins && dueMins <= nowMins + withinHours * 60;
  });
}

export async function extractTodosFromChat(user, userMessage, assistantReply) {
  if (!user?.calendar_duck_assist) return [];
  const hasTimeHint = /明天|后天|周[一二三四五六日天]|下周|今晚|下午|上午|\d{1,2}[：:]\d{2}|\d{1,2}点|号|日|月/i.test(userMessage);
  if (!hasTimeHint) return [];

  const tz = user.timezone || 'Asia/Shanghai';
  const today = userDateKey(new Date(), tz);
  const { text } = await callDeepSeek([
    {
      role: 'system',
      content: `Extract calendar items from chat. Today is ${today} (${tz}). JSON array only, max 2 items:
[{"content":"...","due_date":"YYYY-MM-DD or null","due_time":"HH:MM or null","repeat_rule":"weekly|monthly|null"}]
Rules: only clear tasks with time hints; "明天"=next calendar day; skip vague chat. Empty array if none.`,
    },
    { role: 'user', content: `User: ${userMessage}\nAssistant: ${assistantReply}` },
  ], { maxTokens: 220, temperature: 0.2 });

  const m = String(text || '').match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const items = JSON.parse(m[0]);
    const created = [];
    for (const item of items.slice(0, 2)) {
      const content = String(item.content || '').trim();
      if (!content || content.length < 2) continue;
      const dup = db.prepare(`
        SELECT id FROM todos WHERE user_id = ? AND content = ? AND status IN ('pending', 'pending_review') LIMIT 1
      `).get(user.id, content);
      if (dup) continue;
      const repeatRule = ['weekly', 'monthly'].includes(item.repeat_rule) ? item.repeat_rule : null;
      const todo = createTodo(user.id, {
        content,
        dueDate: item.due_date || null,
        dueTime: item.due_time || null,
        createdBy: 'ai',
        status: 'pending_review',
        repeatRule,
      });
      addPendingReview(user.id, {
        type: 'todo',
        title: 'Calendar item',
        content,
        source: 'calendar_extract',
        payload: { todo_id: todo.id, due_date: todo.due_date, due_time: todo.due_time, repeat_rule: todo.repeat_rule },
      });
      created.push(todo);
    }
    return created;
  } catch {
    return [];
  }
}

export function formatTodosForKeepalive(userId, timeZone = 'Asia/Shanghai') {
  advanceRecurringTodos(userId, timeZone);
  const soon = getDueSoonTodos(userId, 4, timeZone);
  if (!soon.length) return '';
  return soon.map((t) => {
    const repeat = t.repeat_rule ? ` [${t.repeat_rule}]` : '';
    return `- ${t.content}${t.due_time ? ` (${t.due_date} ${t.due_time})` : t.due_date ? ` (${t.due_date})` : ''}${repeat}`;
  }).join('\n');
}
