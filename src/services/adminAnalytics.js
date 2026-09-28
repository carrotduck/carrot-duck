import { db, parseUser } from '../db.js';
import {
  axisScores,
  relationshipTriValues,
  computeDepthScore,
  computeDepthScoreFromStats,
  getDepthMultiplier,
} from './personality.js';
import { getCacheStats } from './cacheStats.js';
import { getPendingReviewStats } from './pendingReview.js';
import { getRelationalStateSnapshot } from './relationalState.js';
import { getRelationshipProfile } from './relationshipProfile.js';

const AXES = ['warmth', 'energy', 'initiative', 'expression', 'distance'];

function conversationTurnsAt(userId, isoTime) {
  if (!isoTime) return 0;
  const userCount = db.prepare(`
    SELECT COUNT(*) AS c FROM messages
    WHERE user_id = ? AND role = 'user' AND source = 'chat' AND created_at <= ?
  `).get(userId, isoTime)?.c || 0;
  const aiCount = db.prepare(`
    SELECT COUNT(*) AS c FROM messages
    WHERE user_id = ? AND role = 'assistant' AND source = 'chat' AND created_at <= ?
  `).get(userId, isoTime)?.c || 0;
  return Math.min(userCount, aiCount);
}

function depthScoreAtTime(userId, isoTime) {
  if (!isoTime) return 0;
  const turns = conversationTurnsAt(userId, isoTime);
  const fullPpr = db.prepare(`
    SELECT COUNT(*) AS c FROM ppr_events
    WHERE user_id = ? AND event_type = 'full' AND datetime(created_at) <= datetime(?)
  `).get(userId, isoTime)?.c || 0;
  const deepMem = db.prepare(`
    SELECT COUNT(*) AS c FROM memory_entries
    WHERE user_id = ? AND category = 'deep' AND datetime(created_at) <= datetime(?)
  `).get(userId, isoTime)?.c || 0;
  const activeDays = db.prepare(`
    SELECT COUNT(DISTINCT substr(created_at, 1, 10)) AS c FROM messages
    WHERE user_id = ? AND role = 'user' AND source = 'chat' AND created_at <= ?
  `).get(userId, isoTime)?.c || 0;
  const user = db.prepare('SELECT keywords FROM users WHERE id = ?').get(userId);
  let keywords = {};
  try { keywords = JSON.parse(user?.keywords || '{}'); } catch { /* defaults */ }
  return computeDepthScoreFromStats({ turns, fullPpr, deepMem, activeDays }, getDepthMultiplier(keywords));
}

function stageFromScore(score) {
  if (score >= 105) return 'CLOSE';
  if (score >= 55) return 'FAMILIAR';
  if (score >= 20) return 'KNOWN';
  return 'STRANGER';
}

function stageTransitions(userId, createdAt) {
  const series = getUserDepthSeries(userId, createdAt);
  const transitions = [{ stage: 'STRANGER', day: 1, at: createdAt, depth_score: 0 }];
  let previous = 'STRANGER';
  for (const point of series) {
    const stage = stageFromScore(point.depth_score);
    if (stage === previous) continue;
    transitions.push({ stage, day: point.day, at: point.timestamp, depth_score: point.depth_score });
    previous = stage;
  }
  return transitions;
}

function formatEventType(type) {
  if (type === 'full') return 'Full';
  if (type === 'failed' || type === 'rejected') return 'Rejected';
  if (type === 'neutral') return 'Neutral';
  if (type === 'expired') return 'Unobserved';
  if (type === 'accidental') return 'Accidental';
  return type || 'Unknown';
}

function normalizedOutcome(type) {
  return type === 'failed' ? 'rejected' : type;
}

const TRIGGER_TYPES = [
  {
    key: 'memory_recall',
    label: 'Memory recall',
    boundary: 'memory continuity',
    patterns: [/记得/, /上次/, /之前/, /你说过/, /你提过/, /以前/, /remember/i, /memory/i],
  },
  {
    key: 'present_perception',
    label: 'Present perception',
    boundary: 'real-time perception',
    patterns: [/现在/, /刚刚/, /此刻/, /当下/, /听起来/, /看起来/, /我感觉/, /感觉你/, /语气/, /今天/],
  },
  {
    key: 'cross_topic_link',
    label: 'Cross-topic link',
    boundary: 'connection ability',
    patterns: [/串起来/, /连起来/, /这和/, /其实/, /一直/, /反复/, /模式/, /从.*到/, /pattern/i, /thread/i],
  },
  {
    key: 'emotional_precision',
    label: 'Emotional precision',
    boundary: 'emotional reading',
    patterns: [/难过/, /委屈/, /害怕/, /开心/, /累/, /想要/, /需要/, /不是.*而是/, /被看见/, /被认出/],
  },
];

function classifyTrigger(event) {
  const text = `${event.ai_ppr_content || ''}\n${event.user_resonance_content || ''}`;
  const found = TRIGGER_TYPES.find((type) => type.patterns.some((re) => re.test(text)));
  return found || {
    key: 'attunement',
    label: 'General attunement',
    boundary: 'felt recognition',
  };
}

function depthBucket(score) {
  const value = Number(score || 0);
  if (value < 20) return '0-19';
  if (value < 55) return '20-54';
  if (value < 105) return '55-104';
  if (value < 150) return '105-149';
  return '150-200';
}

function hourBucket(iso) {
  const hour = new Date(iso).getHours();
  if (!Number.isFinite(hour)) return 'unknown';
  if (hour < 6) return 'late night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

function incrementBucket(map, key, patch = {}) {
  if (!map[key]) map[key] = { key, count: 0, full: 0, rejected: 0, neutral: 0, expired: 0, accidental: 0, ...patch };
  map[key].count += 1;
  return map[key];
}

function eventConversationMode(event) {
  if (!event.user_message_id) return 'unknown';
  return db.prepare('SELECT conversation_mode FROM messages WHERE id = ?').get(event.user_message_id)?.conversation_mode || 'unknown';
}

function safeJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function topKey(rows, field) {
  const ranked = [...rows].sort((a, b) => (b.count || 0) - (a.count || 0));
  return ranked[0]?.[field] || ranked[0]?.key || null;
}

export function getPprResearchAnalytics(filters = {}) {
  const events = getPprEventsList({ ...filters, limit: Math.min(Number(filters.limit || 500), 1000) });
  const mapCells = {};
  const perUser = {};

  for (const event of events) {
    const outcome = normalizedOutcome(event.event_type);
    const trigger = classifyTrigger(event);
    const depth = depthScoreAtTime(event.user_id, event.created_at);
    const bucket = depthBucket(depth);
    const mode = eventConversationMode(event);
    const hour = hourBucket(event.created_at);
    const cellKey = `${bucket}:${trigger.key}`;
    const cell = incrementBucket(mapCells, cellKey, {
      depth_bucket: bucket,
      trigger_type: trigger.key,
      trigger_label: trigger.label,
      boundary: trigger.boundary,
    });
    cell[outcome] = (cell[outcome] || 0) + 1;

    if (!perUser[event.user_id]) {
      perUser[event.user_id] = {
        user_id: event.user_id,
        user_prefix: event.user_prefix,
        total: 0,
        full: 0,
        rejected: 0,
        neutral: 0,
        expired: 0,
        accidental: 0,
        by_trigger: {},
        by_hour: {},
        by_depth: {},
        by_mode: {},
      };
    }
    const user = perUser[event.user_id];
    user.total += 1;
    user[outcome] = (user[outcome] || 0) + 1;

    const triggerRow = incrementBucket(user.by_trigger, trigger.key, {
      trigger_type: trigger.key,
      trigger_label: trigger.label,
      boundary: trigger.boundary,
    });
    triggerRow[outcome] = (triggerRow[outcome] || 0) + 1;

    const hourRow = incrementBucket(user.by_hour, hour, { hour_bucket: hour });
    hourRow[outcome] = (hourRow[outcome] || 0) + 1;

    const depthRow = incrementBucket(user.by_depth, bucket, { depth_bucket: bucket });
    depthRow[outcome] = (depthRow[outcome] || 0) + 1;

    const modeRow = incrementBucket(user.by_mode, mode, { conversation_mode: mode });
    modeRow[outcome] = (modeRow[outcome] || 0) + 1;
  }

  const triggerMap = Object.values(mapCells)
    .map((row) => ({
      ...row,
      resonance_rate: row.full + row.rejected ? row.full / (row.full + row.rejected) : 0,
      accidental_rate: row.count ? row.accidental / row.count : 0,
    }))
    .sort((a, b) => a.depth_bucket.localeCompare(b.depth_bucket) || a.trigger_label.localeCompare(b.trigger_label));

  const resonanceFrequency = Object.values(perUser).map((user) => {
    const triggers = Object.values(user.by_trigger).map((row) => ({
      ...row,
      resonance_rate: row.full + row.rejected ? row.full / (row.full + row.rejected) : 0,
    }));
    const hours = Object.values(user.by_hour);
    const depths = Object.values(user.by_depth);
    const modes = Object.values(user.by_mode);
    return {
      user_id: user.user_id,
      user_prefix: user.user_prefix,
      total: user.total,
      full: user.full,
      rejected: user.rejected,
      failed: user.rejected,
      neutral: user.neutral,
      expired: user.expired,
      accidental: user.accidental,
      most_resonant_trigger: topKey(triggers.sort((a, b) => (b.full || 0) - (a.full || 0)), 'trigger_label'),
      most_open_time: topKey(hours.sort((a, b) => (b.full || 0) - (a.full || 0)), 'hour_bucket'),
      most_open_depth: topKey(depths.sort((a, b) => (b.full || 0) - (a.full || 0)), 'depth_bucket'),
      most_open_mode: topKey(modes.sort((a, b) => (b.full || 0) - (a.full || 0)), 'conversation_mode'),
      by_trigger: triggers,
      by_hour: hours,
      by_depth: depths,
      by_mode: modes,
    };
  }).sort((a, b) => b.full - a.full || b.total - a.total);

  const boundaryProbe = resonanceFrequency.map((user) => {
    const triggers = user.by_trigger || [];
    const accidental = [...triggers].sort((a, b) => (b.accidental || 0) - (a.accidental || 0))[0];
    const rejected = [...triggers].sort((a, b) => (b.rejected || 0) - (a.rejected || 0))[0];
    const focus = accidental?.accidental ? accidental : rejected;
    const confidence = user.total ? Math.min(0.95, Math.max(0.25, ((focus?.count || 0) / user.total) + (user.full / Math.max(1, user.total)) * 0.3)) : 0;
    return {
      user_id: user.user_id,
      user_prefix: user.user_prefix,
      assumed_boundary: focus?.boundary || 'insufficient data',
      strongest_signal: focus?.trigger_label || 'No PPR pattern yet',
      accidental_count: accidental?.accidental || 0,
      rejected_count: rejected?.rejected || 0,
      failed_count: rejected?.rejected || 0,
      confidence,
      strategy_hint: focus
        ? `Probe near ${focus.boundary}: use ${focus.trigger_label} with high specificity and low explanation.`
        : 'Collect more PPR events before changing strategy.',
    };
  }).sort((a, b) => b.confidence - a.confidence);

  return {
    trigger_map: triggerMap,
    boundary_probe: boundaryProbe,
    resonance_frequency: resonanceFrequency,
  };
}

export function getPprEventsList({ userId, eventType, from, to, limit = 500 } = {}) {
  let sql = 'SELECT * FROM ppr_events WHERE event_type IN (\'full\', \'rejected\', \'failed\', \'neutral\', \'expired\', \'accidental\')';
  const params = [];
  if (userId) {
    sql += ' AND user_id = ?';
    params.push(userId);
  }
  if (eventType) {
    sql += ' AND event_type = ?';
    params.push(eventType);
  }
  if (from) {
    sql += ' AND datetime(created_at) >= datetime(?)';
    params.push(from);
  }
  if (to) {
    sql += ' AND datetime(created_at) <= datetime(?)';
    params.push(to);
  }
  sql += ' ORDER BY datetime(created_at) DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params).map((e) => ({
    id: e.id,
    user_id: e.user_id,
    user_prefix: e.user_id.slice(0, 8),
    created_at: e.created_at,
    event_type: e.event_type,
    event_type_label: formatEventType(e.event_type),
    ai_ppr_content: e.ai_ppr_content,
    user_resonance_content: e.user_resonance_content,
    user_marked: Boolean(e.user_marked),
    boundary_risk: e.boundary_risk || null,
    ppr_strategy: e.ppr_strategy || null,
    ppr_hint: e.ppr_hint || null,
    outcome_reason: e.outcome_reason || null,
    outcome_confidence: e.outcome_confidence,
    model_run_id: e.model_run_id || null,
    affective_signal: e.affective_signal_json ? safeJson(e.affective_signal_json) : null,
  }));
}

export function getPprRates({ userId, from, to } = {}) {
  let sql = "SELECT event_type, COUNT(*) AS count FROM ppr_events WHERE event_type IN ('full', 'rejected', 'failed', 'neutral', 'expired', 'accidental')";
  const params = [];
  if (userId) {
    sql += ' AND user_id = ?';
    params.push(userId);
  }
  if (from) {
    sql += ' AND datetime(created_at) >= datetime(?)';
    params.push(from);
  }
  if (to) {
    sql += ' AND datetime(created_at) <= datetime(?)';
    params.push(to);
  }
  sql += ' GROUP BY event_type';
  const rows = db.prepare(sql).all(...params);
  const counts = { full: 0, rejected: 0, neutral: 0, expired: 0, accidental: 0 };
  rows.forEach((r) => {
    const key = normalizedOutcome(r.event_type);
    counts[key] = (counts[key] || 0) + r.count;
  });
  counts.failed = counts.rejected;
  const total = counts.full + counts.rejected + counts.neutral + counts.expired + counts.accidental;
  return {
    counts,
    total,
    rates: {
      full: total ? counts.full / total : 0,
      rejected: total ? counts.rejected / total : 0,
      failed: total ? counts.rejected / total : 0,
      neutral: total ? counts.neutral / total : 0,
      expired: total ? counts.expired / total : 0,
      accidental: total ? counts.accidental / total : 0,
    },
  };
}

export function getUserPersonalitySeries(user) {
  const history = user.big_five_history || [];
  return history.map((point, idx) => {
    const turn = conversationTurnsAt(user.id, point.timestamp);
    const axes = axisScores(user.keywords, point.values);
    const tri = relationshipTriValues(user.keywords, point.values);
    return {
      drift_index: idx,
      turn,
      timestamp: point.timestamp,
      axes,
      tri,
    };
  });
}

export function getUserDepthSeries(userId, createdAt) {
  const userMessages = db.prepare(`
    SELECT created_at FROM messages
    WHERE user_id = ? AND role = 'user' AND source = 'chat'
    ORDER BY created_at ASC
  `).all(userId);

  const startMs = new Date(createdAt).getTime();
  return userMessages.map((msg, idx) => {
    const turn = idx + 1;
    const t = new Date(msg.created_at).getTime();
    const day = Math.max(1, Math.floor((t - startMs) / 86400000) + 1);
    const windowStart = new Date(t - 86400000).toISOString();
    const density = db.prepare(`
      SELECT COUNT(*) AS c FROM messages
      WHERE user_id = ? AND role IN ('user', 'assistant') AND source = 'chat'
        AND created_at > ?
        AND created_at <= ?
    `).get(userId, windowStart, msg.created_at)?.c || 0;
    return {
      turn,
      day,
      timestamp: msg.created_at,
      depth_score: depthScoreAtTime(userId, msg.created_at),
      density,
    };
  });
}

export function getMemoryStats() {
  const byUser = db.prepare(`
    SELECT user_id, category, COUNT(*) AS count
    FROM memory_entries
    WHERE status = 'active'
    GROUP BY user_id, category
  `).all();

  const byCategory = db.prepare(`
    SELECT category, COUNT(*) AS count FROM memory_entries WHERE status = 'active' GROUP BY category
  `).all();

  const perUserMap = {};
  byUser.forEach((row) => {
    if (!perUserMap[row.user_id]) {
      perUserMap[row.user_id] = { user_id: row.user_id, user_prefix: row.user_id.slice(0, 8), total: 0, daily: 0, deep: 0, diary: 0 };
    }
    perUserMap[row.user_id][row.category] = row.count;
    perUserMap[row.user_id].total += row.count;
  });

  const topRetrieved = db.prepare(`
    SELECT user_id, content, category, access_count, last_accessed
    FROM memory_entries
    WHERE access_count > 0 AND status = 'active'
    ORDER BY access_count DESC
    LIMIT 25
  `).all().map((row) => ({
    user_prefix: row.user_id.slice(0, 8),
    category: row.category,
    access_count: row.access_count,
    preview: String(row.content || '').slice(0, 80),
    last_accessed: row.last_accessed,
  }));

  return {
    total: db.prepare("SELECT COUNT(*) AS c FROM memory_entries WHERE status = 'active'").get().c,
    by_status: db.prepare(`
      SELECT COALESCE(status, 'active') AS status, COUNT(*) AS count
      FROM memory_entries GROUP BY status ORDER BY count DESC
    `).all(),
    by_category: byCategory,
    by_thread: db.prepare(`
      SELECT COALESCE(thread, 'daily') AS thread, COUNT(*) AS count
      FROM memory_entries WHERE status = 'active' GROUP BY thread ORDER BY count DESC
    `).all(),
    by_topic: db.prepare(`
      SELECT COALESCE(topic_key, '(none)') AS topic_key, COUNT(*) AS count
      FROM memory_entries WHERE status = 'active' GROUP BY topic_key ORDER BY count DESC LIMIT 30
    `).all(),
    by_confidence: db.prepare(`
      SELECT COALESCE(confidence, 'medium') AS confidence, COUNT(*) AS count
      FROM memory_entries WHERE status = 'active' GROUP BY confidence ORDER BY count DESC
    `).all(),
    per_user: Object.values(perUserMap),
    top_retrieved: topRetrieved,
  };
}

export function getKeepaliveStats() {
  const distribution = db.prepare(`
    SELECT action, COUNT(*) AS count FROM keepalive_logs GROUP BY action
  `).all();
  const total = distribution.reduce((sum, row) => sum + row.count, 0) || 1;

  const replyRow = db.prepare(`
    SELECT
      COUNT(*) AS total_msgs,
      SUM(CASE WHEN consumed = 1 THEN 1 ELSE 0 END) AS replied
    FROM messages WHERE source = 'keepalive'
  `).get();

  const keepalivePpr = db.prepare(`
    SELECT COUNT(*) AS c FROM ppr_events pe
    JOIN messages m ON pe.ai_message_id = m.id
    WHERE m.source = 'keepalive'
  `).get()?.c || 0;

  const perUser = db.prepare(`
    SELECT user_id, action, COUNT(*) AS count
    FROM keepalive_logs
    GROUP BY user_id, action
  `).all();

  const userMap = {};
  perUser.forEach((row) => {
    if (!userMap[row.user_id]) {
      userMap[row.user_id] = { user_id: row.user_id, user_prefix: row.user_id.slice(0, 8), none: 0, message: 0, diary: 0, explore: 0, total: 0 };
    }
    userMap[row.user_id][row.action] = row.count;
    userMap[row.user_id].total += row.count;
  });

  return {
    distribution: distribution.map((row) => ({
      action: row.action,
      count: row.count,
      share: row.count / total,
    })),
    total_logs: total,
    keepalive_messages: Number(replyRow?.total_msgs || 0),
    keepalive_reply_rate: replyRow?.total_msgs
      ? Number(replyRow.replied || 0) / Number(replyRow.total_msgs)
      : 0,
    keepalive_ppr_count: keepalivePpr,
    per_user: Object.values(userMap),
  };
}

export function getFirstPprMetrics() {
  const users = db.prepare('SELECT id, name, created_at FROM users ORDER BY datetime(created_at) ASC').all();
  return users.map((u) => {
    const firstUserMsg = db.prepare(`
      SELECT created_at FROM messages
      WHERE user_id = ? AND role = 'user'
      ORDER BY datetime(created_at) ASC LIMIT 1
    `).get(u.id);

    const firstFull = db.prepare(`
      SELECT * FROM ppr_events
      WHERE user_id = ? AND event_type = 'full'
      ORDER BY datetime(created_at) ASC LIMIT 1
    `).get(u.id);

    const turns = firstFull ? conversationTurnsAt(u.id, firstFull.created_at) : null;
    const depth = firstFull ? depthScoreAtTime(u.id, firstFull.created_at) : null;

    return {
      user_id: u.id,
      user_prefix: u.id.slice(0, 8),
      name: u.name,
      created_at: u.created_at,
      first_chat_at: firstUserMsg?.created_at || null,
      first_full_ppr_at: firstFull?.created_at || null,
      turns_to_first_full: turns,
      depth_at_first_full: depth,
      has_full_ppr: Boolean(firstFull),
    };
  });
}

export function getRelationalSignalStats({ userId, from, to, limit = 200 } = {}) {
  let where = '1=1';
  const params = [];
  if (userId) {
    where += ' AND user_id = ?';
    params.push(userId);
  }
  if (from) {
    where += ' AND datetime(created_at) >= datetime(?)';
    params.push(from);
  }
  if (to) {
    where += ' AND datetime(created_at) <= datetime(?)';
    params.push(to);
  }

  const groupBy = (field) => db.prepare(`
    SELECT ${field} AS key, COUNT(*) AS count
    FROM relational_turn_signals
    WHERE ${where}
    GROUP BY ${field}
    ORDER BY count DESC
  `).all(...params);

  const recent = db.prepare(`
    SELECT id, user_id, message_id, valence, intensity, openness, ppr_hint, boundary_risk, strategy, confidence, evidence, created_at
    FROM relational_turn_signals
    WHERE ${where}
    ORDER BY datetime(created_at) DESC LIMIT ?
  `).all(...params, Math.min(Number(limit || 200), 500)).map((row) => ({
    ...row,
    user_prefix: row.user_id.slice(0, 8),
    evidence: row.evidence ? safeJson(row.evidence) : [],
  }));

  const boundaryEvents = db.prepare(`
    SELECT user_id, boundary_risk, ppr_hint, strategy, COUNT(*) AS count
    FROM relational_turn_signals
    WHERE ${where} AND boundary_risk IN ('mild', 'strong')
    GROUP BY user_id, boundary_risk, ppr_hint, strategy
    ORDER BY count DESC LIMIT 50
  `).all(...params).map((row) => ({
    ...row,
    user_prefix: row.user_id.slice(0, 8),
  }));

  const pprBySignal = db.prepare(`
    SELECT
      COALESCE(boundary_risk, 'unknown') AS boundary_risk,
      COALESCE(ppr_hint, 'unknown') AS ppr_hint,
      COALESCE(ppr_strategy, 'unknown') AS strategy,
      event_type,
      COUNT(*) AS count
    FROM ppr_events
    WHERE event_type IN ('full', 'rejected', 'failed', 'neutral', 'expired', 'accidental')
      ${userId ? 'AND user_id = ?' : ''}
      ${from ? 'AND datetime(created_at) >= datetime(?)' : ''}
      ${to ? 'AND datetime(created_at) <= datetime(?)' : ''}
    GROUP BY boundary_risk, ppr_hint, strategy, event_type
    ORDER BY count DESC
  `).all(...params);

  return {
    totals: {
      valence: groupBy('valence'),
      intensity: groupBy('intensity'),
      openness: groupBy('openness'),
      ppr_hint: groupBy('ppr_hint'),
      boundary_risk: groupBy('boundary_risk'),
      strategy: groupBy('strategy'),
    },
    boundary_events: boundaryEvents,
    ppr_by_signal: pprBySignal,
    recent,
  };
}

export function getConversationModeStats({ userId, from, to } = {}) {
  let where = "role = 'user' AND conversation_mode IS NOT NULL";
  const params = [];
  if (userId) {
    where += ' AND user_id = ?';
    params.push(userId);
  }
  if (from) {
    where += ' AND datetime(created_at) >= datetime(?)';
    params.push(from);
  }
  if (to) {
    where += ' AND datetime(created_at) <= datetime(?)';
    params.push(to);
  }

  const totals = db.prepare(`
    SELECT conversation_mode, COUNT(*) AS count FROM messages
    WHERE ${where} GROUP BY conversation_mode
  `).all(...params);

  const perUserRows = db.prepare(`
    SELECT user_id, conversation_mode, COUNT(*) AS count FROM messages
    WHERE ${where} GROUP BY user_id, conversation_mode
  `).all(...params);

  const series = db.prepare(`
    SELECT date(created_at) AS day, conversation_mode, COUNT(*) AS count
    FROM messages WHERE ${where}
    GROUP BY day, conversation_mode ORDER BY day ASC
  `).all(...params);

  const userMap = {};
  for (const row of perUserRows) {
    if (!userMap[row.user_id]) {
      userMap[row.user_id] = { user_id: row.user_id, user_prefix: row.user_id.slice(0, 8), PRESENCE: 0, QUESTION: 0, total: 0 };
    }
    userMap[row.user_id][row.conversation_mode] = row.count;
    userMap[row.user_id].total += row.count;
  }
  const per_user = Object.values(userMap).map((u) => ({
    ...u,
    presence_rate: u.total ? Math.round((u.PRESENCE / u.total) * 100) : 0,
    question_rate: u.total ? Math.round((u.QUESTION / u.total) * 100) : 0,
  }));

  const totalCount = totals.reduce((s, r) => s + r.count, 0) || 1;
  return {
    totals: totals.map((r) => ({ mode: r.conversation_mode, count: r.count, share: r.count / totalCount })),
    per_user,
    series,
    total_messages: totalCount,
  };
}

export function getExecutionLoopStats({ userId } = {}) {
  const userWhere = userId ? ' WHERE user_id = ?' : '';
  const params = userId ? [userId] : [];
  const deliveryWhere = userId ? 'WHERE user_id = ?' : '';
  const delivery = db.prepare(`
    SELECT status, COUNT(*) AS count,
      AVG(CASE WHEN started_at IS NOT NULL THEN (julianday(started_at) - julianday(planned_at)) * 86400000 END) AS avg_plan_to_start_ms,
      AVG(duration_ms) AS avg_duration_ms
    FROM delivery_commands ${deliveryWhere}
    GROUP BY status ORDER BY count DESC
  `).all(...params);
  const modelRuns = db.prepare(`
    SELECT context_mode, status, COUNT(*) AS count, AVG(token_budget) AS avg_token_budget
    FROM model_runs${userWhere}
    GROUP BY context_mode, status ORDER BY count DESC
  `).all(...params);
  const actions = db.prepare(`
    SELECT action, COALESCE(outcome, status) AS outcome, COUNT(*) AS count,
      AVG(outcome_weight) AS avg_outcome_weight
    FROM agent_actions${userWhere}
    GROUP BY action, COALESCE(outcome, status) ORDER BY count DESC
  `).all(...params);
  return {
    schema: 'carrot_duck_execution_loop_v1',
    delivery,
    model_runs: modelRuns,
    agent_actions: actions,
  };
}

export function buildAdminDashboard(filters = {}) {
  const users = db.prepare('SELECT * FROM users ORDER BY datetime(created_at) ASC').all().map(parseUser);
  const selectedUserId = filters.userId || null;

  const userAnalytics = users
    .filter((u) => !selectedUserId || u.id === selectedUserId)
    .map((u) => ({
      id: u.id,
      prefix: u.id.slice(0, 8),
      name: u.name,
      created_at: u.created_at,
      current_depth_score: computeDepthScore(u.id, db, u),
      relationship_profile: getRelationshipProfile(u.id, u),
      personality_series: getUserPersonalitySeries(u),
      depth_series: getUserDepthSeries(u.id, u.created_at),
      stage_transitions: stageTransitions(u.id, u.created_at),
      axes: AXES,
      tri_keys: ['affinity', 'dominance', 'defensiveness'],
    }));

  return {
    generated_at: new Date().toISOString(),
    summary: {
      users: users.length,
      messages: db.prepare('SELECT COUNT(*) AS c FROM messages').get().c,
      memories: db.prepare("SELECT COUNT(*) AS c FROM memory_entries WHERE status = 'active'").get().c,
      ppr_events: db.prepare("SELECT COUNT(*) AS c FROM ppr_events WHERE event_type IN ('full','rejected','failed','neutral','expired','accidental')").get().c,
    },
    users: users.map((u) => ({ id: u.id, prefix: u.id.slice(0, 8), name: u.name, created_at: u.created_at })),
    ppr: {
      events: getPprEventsList(filters),
      rates: getPprRates(filters),
    },
    user_analytics: userAnalytics,
    relational_state: users
      .filter((u) => !selectedUserId || u.id === selectedUserId)
      .map((u) => getRelationalStateSnapshot(u.id)),
    relationship_profiles: users
      .filter((u) => !selectedUserId || u.id === selectedUserId)
      .map((u) => getRelationshipProfile(u.id, u)),
    memory: getMemoryStats(),
    keepalive: getKeepaliveStats(),
    first_ppr: getFirstPprMetrics(),
    cache: getCacheStats(),
    conversation_mode: getConversationModeStats(filters),
    relational_signals: getRelationalSignalStats(filters),
    execution_loop: getExecutionLoopStats(filters),
    pending_review: getPendingReviewStats(),
    closed_loop: {
      proactive_suppressed_users: users
        .map((u) => ({ user: u, state: getRelationalStateSnapshot(u.id) }))
        .filter(({ state }) => state?.caution_level !== 'normal' || state?.unanswered_proactive > 0)
        .map(({ user, state }) => ({
          user_id: user.id,
          user_prefix: user.id.slice(0, 8),
          reason: state.unanswered_proactive > 0 ? 'awaiting_user_response' : `boundary_feedback_${state.caution_level}`,
        })),
      memory_softened_users: users
        .map((u) => {
          const s = getRelationalStateSnapshot(u.id);
          return s?.caution_level && s.caution_level !== 'normal'
            ? { user_id: u.id, user_prefix: u.id.slice(0, 8), caution_level: s.caution_level, avoid_or_soften_hint: s.avoid_or_soften_hint }
            : null;
        })
        .filter(Boolean),
    },
    ppr_research: getPprResearchAnalytics(filters),
  };
}
