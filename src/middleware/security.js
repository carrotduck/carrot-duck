import crypto from 'crypto';
import { db, normalizeUserId } from '../db.js';

const TOKEN_BYTES = 32;
const RECOVERY_BYTES = 18;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const rateBuckets = new Map();

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function randomSecret(bytes) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function timingSafeHexEqual(left, right) {
  if (!left || !right) return false;
  const a = Buffer.from(String(left), 'hex');
  const b = Buffer.from(String(right), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function publicUserRoute(req) {
  if (req.path === '/api/health') return true;
  if (req.path === '/api/users/onboarding' || req.path === '/api/users/recover') return true;
  if (req.path === '/api/push/vapid-public-key') return true;
  if (req.path.startsWith('/api/admin')) return true;
  // This route owns the one-time legacy-account bootstrap flow.
  if (req.method === 'GET' && /^\/api\/users\/user\/[^/]+$/.test(req.path)) return true;
  return false;
}

function targetUserIds(req) {
  const bodyId = normalizeUserId(req.body?.user_id || req.body?.userId);
  const match = req.path.match(/^\/api\/(?:users\/user|chat|data|voice|stickers|favorites|todos|push|tts|delivery)\/([^/?]+)/);
  const pathId = normalizeUserId(match?.[1]);
  return [pathId, bodyId].filter(id => UUID_RE.test(id));
}

export function issueCredentials(userId, { rotateRecovery = true } = {}) {
  const id = normalizeUserId(userId);
  const sessionToken = randomSecret(TOKEN_BYTES);
  const recoveryCode = rotateRecovery ? randomSecret(RECOVERY_BYTES) : null;
  const now = new Date().toISOString();

  if (rotateRecovery) {
    db.prepare(`
      UPDATE users
      SET auth_token_hash = ?, recovery_code_hash = ?, auth_migrated_at = ?
      WHERE id = ?
    `).run(sha256(sessionToken), sha256(recoveryCode), now, id);
  } else {
    db.prepare('UPDATE users SET auth_token_hash = ?, auth_migrated_at = COALESCE(auth_migrated_at, ?) WHERE id = ?')
      .run(sha256(sessionToken), now, id);
  }
  db.prepare(`
    INSERT INTO user_sessions (token_hash, user_id, created_at, last_used_at, revoked_at)
    VALUES (?, ?, ?, ?, NULL)
  `).run(sha256(sessionToken), id, now, now);

  return {
    session_token: sessionToken,
    recovery_code: recoveryCode,
    recovery_key: recoveryCode ? `${id}.${recoveryCode}` : null,
  };
}

export function bootstrapLegacyCredentials(userId) {
  const id = normalizeUserId(userId);
  const row = db.prepare('SELECT auth_token_hash FROM users WHERE id = ?').get(id);
  if (!row || row.auth_token_hash) return null;

  const sessionToken = randomSecret(TOKEN_BYTES);
  const recoveryCode = randomSecret(RECOVERY_BYTES);
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE users
    SET auth_token_hash = ?, recovery_code_hash = ?, auth_migrated_at = ?
    WHERE id = ? AND auth_token_hash IS NULL
  `).run(sha256(sessionToken), sha256(recoveryCode), now, id);

  if (!result.changes) return null;
  db.prepare(`
    INSERT INTO user_sessions (token_hash, user_id, created_at, last_used_at, revoked_at)
    VALUES (?, ?, ?, ?, NULL)
  `).run(sha256(sessionToken), id, now, now);
  return {
    session_token: sessionToken,
    recovery_code: recoveryCode,
    recovery_key: `${id}.${recoveryCode}`,
  };
}

export function parseRecoveryKey(raw) {
  const value = String(raw || '').trim();
  const dot = value.lastIndexOf('.');
  if (dot < 1) return { userId: normalizeUserId(value), recoveryCode: null };
  return {
    userId: normalizeUserId(value.slice(0, dot)),
    recoveryCode: value.slice(dot + 1).trim(),
  };
}

export function verifyRecoveryCode(userId, recoveryCode) {
  const row = db.prepare('SELECT recovery_code_hash FROM users WHERE id = ?').get(normalizeUserId(userId));
  if (!row?.recovery_code_hash || !recoveryCode) return false;
  return timingSafeHexEqual(row.recovery_code_hash, sha256(recoveryCode));
}

export function authenticateBearer(req) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const hash = sha256(token);
  const session = db.prepare(`
    SELECT user_id FROM user_sessions
    WHERE token_hash = ? AND revoked_at IS NULL
  `).get(hash);
  if (session?.user_id) {
    db.prepare('UPDATE user_sessions SET last_used_at = ? WHERE token_hash = ?')
      .run(new Date().toISOString(), hash);
    return session.user_id;
  }
  const row = db.prepare('SELECT id FROM users WHERE auth_token_hash = ?').get(hash);
  return row?.id || null;
}

export function requireUserSession(req, res, next) {
  if (!req.path.startsWith('/api/') || publicUserRoute(req)) return next();

  const sessionUserId = req.authUserId || authenticateBearer(req);
  if (!sessionUserId) {
    return res.status(401).json({ error: 'Session required', code: 'SESSION_REQUIRED' });
  }

  if (targetUserIds(req).some(id => id !== sessionUserId)) {
    return res.status(403).json({ error: 'This session cannot access another account', code: 'ACCOUNT_MISMATCH' });
  }

  req.authUserId = sessionUserId;
  next();
}

export function secureHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

function ratePolicy(req) {
  const path = req.path;
  if (path === '/api/health') return null;
  if (/\/chat$/.test(path)) return { windowMs: 60_000, max: 18, name: 'chat' };
  if (/\/roam$/.test(path)) return { windowMs: 60_000, max: 4, name: 'roam' };
  if (/\/(?:asr|tts)(?:\/|$)|\/upload$|transcribe/.test(path)) {
    return { windowMs: 60_000, max: 20, name: 'media' };
  }
  if (path === '/api/users/recover' || path === '/api/users/onboarding') {
    return { windowMs: 15 * 60_000, max: 12, name: 'account' };
  }
  return { windowMs: 60_000, max: 240, name: 'general' };
}

export function rateLimit(req, res, next) {
  const policy = ratePolicy(req);
  if (!policy) return next();
  const now = Date.now();
  const authenticated = authenticateBearer(req);
  if (authenticated) req.authUserId = authenticated;
  const identity = authenticated || req.ip || req.socket.remoteAddress || 'unknown';
  const key = `${policy.name}:${identity}`;
  const current = rateBuckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + policy.windowMs }
    : current;
  bucket.count += 1;
  rateBuckets.set(key, bucket);

  res.setHeader('RateLimit-Limit', String(policy.max));
  res.setHeader('RateLimit-Remaining', String(Math.max(0, policy.max - bucket.count)));
  res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
  if (bucket.count > policy.max) {
    res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
    return res.status(429).json({ error: 'Too many requests', code: 'RATE_LIMITED' });
  }
  next();
}

export function corsOrigin(origin, callback) {
  if (!origin) return callback(null, true);
  const allowed = /^https:\/\/(?:www\.)?carrotduck\.online$/i.test(origin)
    || /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin);
  callback(allowed ? null : new Error('Origin not allowed'), allowed);
}
