import { Router } from 'express';
import { getUser } from '../db.js';
import {
  listTodos,
  listUndatedTodos,
  datesWithTodos,
  createTodo,
  updateTodo,
  deleteTodo,
  getPendingReviewTodos,
  confirmPendingTodo,
  rejectPendingTodo,
  advanceRecurringTodos,
} from '../services/todos.js';
import { userDateKey } from '../utils/timezone.js';

const router = Router();

router.get('/:userId', (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const date = req.query.date || userDateKey(new Date(), user.timezone);
  const year = Number(req.query.year || new Date().getFullYear());
  const month = Number(req.query.month || (new Date().getMonth() + 1));
  advanceRecurringTodos(user.id, user.timezone);
  res.json({
    todos: listTodos(req.params.userId, { date: req.query.all === '1' ? null : date }),
    undated_todos: listUndatedTodos(req.params.userId),
    pending_review: getPendingReviewTodos(req.params.userId),
    marked_dates: datesWithTodos(req.params.userId, year, month),
    selected_date: date,
  });
});

router.post('/:userId', (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { content, due_date, due_time, created_by, repeat_rule } = req.body || {};
  if (!content?.trim()) return res.status(400).json({ error: 'content required' });
  const todo = createTodo(user.id, {
    content: content.trim(),
    dueDate: due_date,
    dueTime: due_time,
    createdBy: created_by || 'user',
    repeatRule: ['weekly', 'monthly'].includes(repeat_rule) ? repeat_rule : null,
  });
  res.json({ todo });
});

router.post('/:userId/:todoId/confirm', (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const todo = confirmPendingTodo(req.params.todoId, user.id);
  if (!todo) return res.status(404).json({ error: 'Todo not found' });
  res.json({ todo });
});

router.post('/:userId/:todoId/reject', (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const ok = rejectPendingTodo(req.params.todoId, user.id);
  if (!ok) return res.status(404).json({ error: 'Todo not found' });
  res.json({ ok: true });
});

router.patch('/:userId/:todoId', (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { status, content, due_date, due_time, repeat_rule } = req.body || {};
  if (status === undefined && content === undefined && due_date === undefined && due_time === undefined && repeat_rule === undefined) {
    return res.status(400).json({ error: 'nothing to update' });
  }
  const todo = updateTodo(req.params.todoId, user.id, {
    status,
    content,
    dueDate: due_date,
    dueTime: due_time,
    repeatRule: repeat_rule,
  });
  if (!todo) return res.status(404).json({ error: 'Todo not found' });
  res.json({ todo });
});

router.delete('/:userId/:todoId', (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const ok = deleteTodo(req.params.todoId, user.id);
  if (!ok) return res.status(404).json({ error: 'Todo not found' });
  res.json({ ok: true });
});

export default router;
