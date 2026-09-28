import { db, getUser } from '../db.js';
import { getTodosNeedingReminder, markTodoReminded } from './todos.js';
import { sendTodoReminderPush } from './push.js';

export async function runTodoReminderCheck() {
  const rows = db.prepare('SELECT id FROM users').all();
  for (const row of rows) {
    const user = getUser(row.id);
    if (!user || user.notify_keepalive === false) continue;
    const due = getTodosNeedingReminder(user.id, user.timezone || 'Asia/Shanghai');
    for (const todo of due) {
      const result = await sendTodoReminderPush(user, todo);
      if (result.ok) markTodoReminded(todo.id);
    }
  }
}
