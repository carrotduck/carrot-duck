import { db } from '../db.js';

function ratio(part, total) {
  return total ? Math.round((part / total) * 100) / 100 : 0;
}

function rowsToCounts(rows, keyField = 'key') {
  return rows.map((row) => ({
    key: row[keyField] || 'unknown',
    count: Number(row.count) || 0,
  }));
}

function top(rows, key = 'key') {
  return rows[0]?.[key] || null;
}

function recentHintCounts(userId, eventTypes) {
  const types = Array.isArray(eventTypes) ? eventTypes : [eventTypes];
  const placeholders = types.map(() => '?').join(', ');
  return db.prepare(`
    SELECT COALESCE(ppr_hint, 'unknown') AS key, COUNT(*) AS count
    FROM ppr_events
    WHERE user_id = ? AND event_type IN (${placeholders}) AND created_at >= ?
    GROUP BY ppr_hint
    ORDER BY count DESC LIMIT 5
  `).all(userId, ...types, new Date(Date.now() - 90 * 86400000).toISOString());
}

function decayedBoundaryState(userId) {
  const rows = db.prepare(`
    SELECT boundary_risk, COALESCE(ppr_hint, 'none') AS ppr_hint, created_at
    FROM relational_turn_signals
    WHERE user_id = ? AND boundary_risk IN ('mild', 'strong') AND created_at >= ?
    ORDER BY created_at DESC LIMIT 100
  `).all(userId, new Date(Date.now() - 30 * 86400000).toISOString());

  const now = Date.now();
  const severity = new Map();
  const hints = new Map();
  let pressure = 0;
  let recentStrong = false;

  for (const row of rows) {
    const timestamp = new Date(row.created_at).getTime();
    const ageDays = Number.isFinite(timestamp) ? Math.max(0, (now - timestamp) / 86400000) : 30;
    const decay = Math.pow(0.5, ageDays / 4);
    const weight = (row.boundary_risk === 'strong' ? 2 : 1) * decay;
    pressure += weight;
    severity.set(row.boundary_risk, (severity.get(row.boundary_risk) || 0) + weight);
    const hintKey = `${row.ppr_hint}:${row.boundary_risk}`;
    hints.set(hintKey, (hints.get(hintKey) || 0) + weight);
    if (row.boundary_risk === 'strong' && ageDays < 1) recentStrong = true;
  }

  const unanswered = db.prepare(`
    SELECT COUNT(*) AS count FROM messages
    WHERE user_id = ? AND source = 'keepalive' AND consumed = 0 AND archived = 0
  `).get(userId)?.count || 0;
  pressure += Math.min(1.2, unanswered * 0.4);

  return {
    pressure: Math.round(pressure * 100) / 100,
    recentStrong,
    unanswered,
    boundaryRows: [...severity.entries()]
      .map(([key, value]) => ({ key, count: Math.round(value * 100) / 100 }))
      .sort((a, b) => b.count - a.count),
    riskyHints: [...hints.entries()]
      .map(([compound, value]) => {
        const [key, boundary_risk] = compound.split(':');
        return { key, boundary_risk, count: Math.round(value * 100) / 100 };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
  };
}

export function getRelationalStateSnapshot(userId) {
  if (!userId) return null;
  const pprCounts = db.prepare(`
    SELECT event_type, COUNT(*) AS count
    FROM ppr_events
    WHERE user_id = ? AND event_type IN ('full', 'rejected', 'failed', 'neutral', 'expired', 'accidental')
    GROUP BY event_type
  `).all(userId);
  const ppr = { full: 0, rejected: 0, failed: 0, neutral: 0, expired: 0, accidental: 0 };
  for (const row of pprCounts) ppr[row.event_type] = row.count;
  ppr.rejected += ppr.failed;
  const totalPpr = ppr.full + ppr.rejected + ppr.neutral + ppr.expired + ppr.accidental;

  const boundary = decayedBoundaryState(userId);
  const successfulHints = recentHintCounts(userId, 'full');
  const failedHints = recentHintCounts(userId, ['rejected', 'failed']);
  const openness = db.prepare(`
    SELECT openness AS key, COUNT(*) AS count
    FROM relational_turn_signals
    WHERE user_id = ? AND created_at >= ?
    GROUP BY openness
    ORDER BY count DESC
  `).all(userId, new Date(Date.now() - 14 * 86400000).toISOString());
  const recentSignals = db.prepare(`
    SELECT valence, intensity, openness, ppr_hint, boundary_risk, strategy, confidence, created_at
    FROM relational_turn_signals
    WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 8
  `).all(userId);

  let caution = 'normal';
  if (boundary.recentStrong || boundary.pressure >= 4) caution = 'high';
  else if (boundary.pressure >= 1.2 || ppr.rejected > ppr.full + 2) caution = 'medium';

  return {
    user_id: userId,
    ppr,
    ppr_total: totalPpr,
    ppr_success_rate: ratio(ppr.full, ppr.full + ppr.rejected),
    caution_level: caution,
    boundary_pressure: boundary.pressure,
    unanswered_proactive: boundary.unanswered,
    boundary_counts: rowsToCounts(boundary.boundaryRows),
    risky_hints: boundary.riskyHints,
    successful_hints: rowsToCounts(successfulHints),
    failed_hints: rowsToCounts(failedHints),
    openness: rowsToCounts(openness),
    preferred_ppr_hint: top(successfulHints),
    avoid_or_soften_hint: top(boundary.riskyHints),
    recent_signals: recentSignals,
    updated_at: new Date().toISOString(),
  };
}

export function buildRelationalStatePromptBlock(snapshot) {
  if (!snapshot) return '';
  const risky = snapshot.risky_hints?.length
    ? snapshot.risky_hints.map((row) => `${row.key}/${row.boundary_risk}:${row.count}`).join(', ')
    : 'none';
  const success = snapshot.successful_hints?.length
    ? snapshot.successful_hints.map((row) => `${row.key}:${row.count}`).join(', ')
    : 'none';
  const failed = snapshot.failed_hints?.length
    ? snapshot.failed_hints.map((row) => `${row.key}:${row.count}`).join(', ')
    : 'none';

  return `RELATIONAL STATE LAYER (private):
caution_level=${snapshot.caution_level}
boundary_pressure=${snapshot.boundary_pressure}
unanswered_proactive=${snapshot.unanswered_proactive}
ppr_success_rate=${snapshot.ppr_success_rate}
successful_hints=${success}
failed_hints=${failed}
risky_boundary_hints=${risky}
Use this as a decaying long-term boundary and timing guide. New explicit boundaries override old success. If caution is medium/high, soften recognition, ask less, and avoid confident emotional reading.`;
}

export function getBoundaryControl(userId) {
  const snapshot = getRelationalStateSnapshot(userId);
  if (!snapshot) {
    return {
      caution_level: 'normal',
      proactiveDampen: 1,
      memoryMode: 'normal',
      pprTagMode: 'normal',
      avoidHints: [],
      preferredHints: [],
    };
  }

  const avoidHints = (snapshot.risky_hints || [])
    .filter((row) => row.boundary_risk === 'strong' || row.count >= 1.2)
    .map((row) => row.key)
    .filter(Boolean);
  const preferredHints = (snapshot.successful_hints || []).map((row) => row.key).filter(Boolean);

  let proactiveDampen = 1;
  let memoryMode = 'normal';
  let pprTagMode = 'normal';
  if (snapshot.caution_level === 'high') {
    proactiveDampen = 0;
    memoryMode = avoidHints.includes('memory') ? 'blocked' : 'minimal';
    pprTagMode = 'strict';
  } else if (snapshot.caution_level === 'medium') {
    proactiveDampen = 0.35;
    memoryMode = avoidHints.includes('memory') ? 'minimal' : 'soft';
    pprTagMode = 'careful';
  } else if (snapshot.unanswered_proactive > 0) {
    proactiveDampen = 0;
  }

  return {
    caution_level: snapshot.caution_level,
    proactiveDampen,
    memoryMode,
    pprTagMode,
    avoidHints,
    preferredHints,
    ppr_success_rate: snapshot.ppr_success_rate,
    boundary_pressure: snapshot.boundary_pressure,
  };
}

export function shouldAllowPprTag(signal, snapshot) {
  if (!signal || signal.boundary_risk === 'strong') return false;
  if (signal.strategy === 'boundary_preserving_response') return false;
  if (!signal.ppr_hint || signal.ppr_hint === 'none') return false;

  const state = snapshot || null;
  if (!state) return signal.confidence >= 0.5;
  const riskyHints = new Set((state.risky_hints || [])
    .filter((row) => row.boundary_risk === 'strong' || row.count >= 1.2)
    .map((row) => row.key));
  const successfulHints = new Set((state.successful_hints || []).map((row) => row.key));
  if (signal.ppr_hint && riskyHints.has(signal.ppr_hint) && !successfulHints.has(signal.ppr_hint)) return false;

  if (state.caution_level === 'high') {
    return signal.boundary_risk === 'none' && signal.confidence >= 0.75 && successfulHints.has(signal.ppr_hint);
  }
  if (state.caution_level === 'medium') {
    return signal.boundary_risk === 'none' && signal.confidence >= 0.62 && signal.strategy !== 'direct_recognition';
  }
  return signal.confidence >= 0.48;
}
