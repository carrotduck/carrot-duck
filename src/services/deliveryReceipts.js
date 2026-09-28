import { db } from '../db.js';

const ALLOWED_STATUS = new Set(['planned', 'ack', 'tts_ready', 'started', 'completed', 'failed', 'skipped']);

function parseTimeline(value) {
  try { return JSON.parse(value || '[]'); } catch { return []; }
}

function safeDetails(details = {}) {
  return {
    resource: String(details.resource || '').slice(0, 40) || null,
    duration_ms: Number.isFinite(Number(details.duration_ms)) ? Math.max(0, Math.round(Number(details.duration_ms))) : null,
    generation_ms: Number.isFinite(Number(details.generation_ms)) ? Math.max(0, Math.round(Number(details.generation_ms))) : null,
    viseme_count: Number.isFinite(Number(details.viseme_count)) ? Math.max(0, Math.round(Number(details.viseme_count))) : null,
    final_state: String(details.final_state || '').slice(0, 40) || null,
    reason: String(details.reason || '').slice(0, 160) || null,
  };
}

export function createDeliveryCommand({ userId, turnId, messageId = null, surface = 'live2d', plan }) {
  if (!plan?.command_id) return null;
  const now = new Date().toISOString();
  const timeline = [{ status: 'planned', at: now }];
  db.prepare(`
    INSERT OR REPLACE INTO delivery_commands (
      command_id, user_id, turn_id, message_id, surface, plan_json,
      status, timeline_json, planned_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?)
  `).run(
    plan.command_id,
    userId,
    turnId,
    messageId,
    surface,
    JSON.stringify(plan),
    JSON.stringify(timeline),
    now,
    now,
  );
  return plan.command_id;
}

export function recordDeliveryReceipt(userId, commandId, status, details = {}) {
  const safeStatus = String(status || '').toLowerCase();
  if (!ALLOWED_STATUS.has(safeStatus) || safeStatus === 'planned') return null;
  const row = db.prepare('SELECT * FROM delivery_commands WHERE command_id = ? AND user_id = ?').get(commandId, userId);
  if (!row) return null;
  const now = new Date().toISOString();
  const clean = safeDetails(details);
  const timeline = parseTimeline(row.timeline_json);
  timeline.push({ status: safeStatus, at: now, ...clean });

  const fields = ['status = ?', 'timeline_json = ?', 'updated_at = ?'];
  const params = [safeStatus, JSON.stringify(timeline.slice(-24)), now];
  const timeColumn = {
    ack: 'ack_at',
    tts_ready: 'ready_at',
    started: 'started_at',
    completed: 'completed_at',
    failed: 'failed_at',
    skipped: 'failed_at',
  }[safeStatus];
  if (timeColumn) {
    fields.push(`${timeColumn} = ?`);
    params.push(now);
  }
  if (clean.duration_ms != null) {
    fields.push('duration_ms = ?');
    params.push(clean.duration_ms);
  }
  if (safeStatus === 'failed' || safeStatus === 'skipped') {
    fields.push('error = ?');
    params.push(clean.reason || safeStatus);
  }
  params.push(commandId, userId);
  db.prepare(`UPDATE delivery_commands SET ${fields.join(', ')} WHERE command_id = ? AND user_id = ?`).run(...params);
  return db.prepare('SELECT * FROM delivery_commands WHERE command_id = ? AND user_id = ?').get(commandId, userId);
}

export function listDeliveryCommands(userId, limit = 50) {
  return db.prepare(`
    SELECT * FROM delivery_commands WHERE user_id = ?
    ORDER BY datetime(planned_at) DESC LIMIT ?
  `).all(userId, Math.max(1, Math.min(200, Number(limit) || 50))).map((row) => ({
    ...row,
    plan: (() => { try { return JSON.parse(row.plan_json || '{}'); } catch { return {}; } })(),
    timeline: parseTimeline(row.timeline_json),
  }));
}

