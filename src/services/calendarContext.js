/**
 * Duck-side calendar awareness — aligned with Yushi Phase 3.
 */
import { db } from '../db.js';
import { userDateKey } from '../utils/timezone.js';
import {
  listTodos,
  listUndatedTodos,
  advanceRecurringTodos,
  getPendingReviewTodos,
} from './todos.js';

function addDays(dateKey, days, timeZone) {
  const d = new Date(`${dateKey}T12:00:00`);
  d.setDate(d.getDate() + days);
  return userDateKey(d, timeZone);
}

function localHourMinute(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  const weekday = parts.find((p) => p.type === 'weekday')?.value || '';
  return { hour, minute, weekday };
}

export function isWorkday(date, timeZone = 'Asia/Shanghai') {
  const { weekday } = localHourMinute(date, timeZone);
  return !['Sat', 'Sun'].includes(weekday);
}

export function isAfterWorkHours(user, date = new Date()) {
  const tz = user?.timezone || 'Asia/Shanghai';
  const { hour, minute } = localHourMinute(date, tz);
  const nowMins = hour * 60 + minute;
  const end = String(user?.work_end || '18:00').slice(0, 5);
  const [eh, em] = end.split(':').map(Number);
  const endMins = (eh || 18) * 60 + (em || 0);
  return nowMins >= endMins;
}

export function checkCalendar(user, date = new Date()) {
  const tz = user?.timezone || 'Asia/Shanghai';
  advanceRecurringTodos(user.id, tz);
  const today = userDateKey(date, tz);
  const tomorrow = addDays(today, 1, tz);
  const todayTodos = listTodos(user.id, { date: today, status: 'pending' });
  const tomorrowTodos = listTodos(user.id, { date: tomorrow, status: 'pending' });
  const undated = listUndatedTodos(user.id);
  const pendingReview = getPendingReviewTodos(user.id);
  const workday = isWorkday(date, tz);
  const afterWork = isAfterWorkHours(user, date);

  return {
    today,
    tomorrow,
    is_workday: workday,
    after_work_hours: afterWork,
    today_todos: todayTodos,
    tomorrow_todos: tomorrowTodos,
    undated_todos: undated,
    pending_review: pendingReview,
    has_unfinished: todayTodos.length + undated.length > 0,
  };
}

export function formatCalendarBlock(user, lang = 'zh') {
  const cal = checkCalendar(user);
  const fmtTodo = (t) => {
    const time = t.due_time ? ` ${String(t.due_time).slice(0, 5)}` : '';
    return `- ${t.content}${time}`;
  };
  if (lang === 'en') {
    return `CALENDAR CHECK:
Today (${cal.today})${cal.is_workday ? ' — workday' : ' — weekend'}${cal.after_work_hours ? ', after work hours' : ''}
Today: ${cal.today_todos.length ? cal.today_todos.map(fmtTodo).join('\n') : '(nothing scheduled)'}
Tomorrow: ${cal.tomorrow_todos.length ? cal.tomorrow_todos.map(fmtTodo).join('\n') : '(nothing scheduled)'}
Undated pending: ${cal.undated_todos.length}
Pending user review: ${cal.pending_review.length}`;
  }
  return `日历检查：
今天（${cal.today}）${cal.is_workday ? '工作日' : '周末'}${cal.after_work_hours ? '，已下班' : ''}
今日安排：${cal.today_todos.length ? `\n${cal.today_todos.map(fmtTodo).join('\n')}` : '无'}
明日安排：${cal.tomorrow_todos.length ? `\n${cal.tomorrow_todos.map(fmtTodo).join('\n')}` : '无'}
未设日期：${cal.undated_todos.length} 条
待用户确认：${cal.pending_review.length} 条`;
}

export function getDueSoonForDutyBump(user, withinDays = 2) {
  const tz = user?.timezone || 'Asia/Shanghai';
  const today = userDateKey(new Date(), tz);
  const rows = db.prepare(`
    SELECT * FROM todos
    WHERE user_id = ? AND status = 'pending' AND due_date IS NOT NULL
    AND due_date >= ? AND due_date <= ?
    ORDER BY due_date ASC, due_time ASC LIMIT 8
  `).all(user.id, today, addDays(today, withinDays, tz));
  return rows;
}

export function formatDutyNudge(user, lang = 'zh') {
  const soon = getDueSoonForDutyBump(user, 1);
  if (!soon.length) return '';
  const top = soon[0];
  const time = top.due_time ? String(top.due_time).slice(0, 5) : '';
  if (lang === 'en') {
    return `Deadline soon: "${top.content}"${time ? ` at ${time}` : ''} (${top.due_date})`;
  }
  return `截止近了：「${top.content}」${time ? ` ${time}` : ''}（${top.due_date}）`;
}

export function shouldAllowPostWorkNudge(user) {
  const cal = checkCalendar(user);
  return cal.after_work_hours && cal.has_unfinished;
}
