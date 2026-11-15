/**
 * Authentication, session, CSRF, rate-limit and sanitisation primitives.
 * Everything here runs server-side only. No secrets ever reach the browser.
 */
import { all, nowIso, one, run, uid } from './db.js';

export const SESSION_COOKIE = 'dd_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
// Cloudflare Workers' WebCrypto rejects PBKDF2 iteration counts above 100,000.
// Stored hashes carry their own iteration count, so this can be raised on a
// platform that supports it without invalidating existing passwords.
const PBKDF2_ITERATIONS = 100000;

const enc = new TextEncoder();

function toB64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function fromB64(str) {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function randomToken(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toB64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, iterations, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'pbkdf2') return false;
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: fromB64(saltB64), iterations: Number(iterations), hash: 'SHA-256' },
      key,
      256,
    );
    return timingSafeEqual(toB64(new Uint8Array(bits)), hashB64);
  } catch {
    return false;
  }
}

export function timingSafeEqual(a, b) {
  const sa = String(a);
  const sb = String(b);
  let diff = sa.length ^ sb.length;
  const len = Math.max(sa.length, sb.length);
  for (let i = 0; i < len; i += 1) {
    diff |= (sa.charCodeAt(i) || 0) ^ (sb.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function hmacSha256Hex(secret, payload) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function parseCookies(request) {
  const header = request.headers.get('cookie') || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

export function clientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '127.0.0.1'
  );
}

/** Create a session row and return { token, setCookie }. The DB stores only SHA-256(token). */
export async function createSession(db, userId, request) {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const now = Date.now();
  await run(
    db,
    `INSERT INTO sessions (id, user_id, csrf_token, created_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    await sha256Hex(token),
    userId,
    csrfToken,
    new Date(now).toISOString(),
    new Date(now + SESSION_TTL_MS).toISOString(),
    clientIp(request),
    (request.headers.get('user-agent') || '').slice(0, 200),
  );
  const cookie = `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secureSuffix(request)}`;
  return { token, csrfToken, setCookie: cookie };
}

function secureSuffix(request) {
  const url = new URL(request.url);
  return url.protocol === 'https:' ? '; Secure' : '';
}

export function clearSessionCookie(request) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureSuffix(request)}`;
}

export async function destroySession(db, request) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) return;
  await run(db, 'DELETE FROM sessions WHERE id = ?', await sha256Hex(token));
}

/** Resolve the signed-in user and session. Also removes expired sessions. */
export async function getAuth(db, request) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const id = await sha256Hex(token);
  const row = await one(
    db,
    `SELECT s.id AS session_id, s.csrf_token, s.expires_at, u.id, u.email, u.name, u.role, u.is_active, u.must_change_password
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    id,
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await run(db, 'DELETE FROM sessions WHERE id = ?', id);
    return null;
  }
  if (!row.is_active) return null;
  return {
    sessionId: row.session_id,
    csrfToken: row.csrf_token,
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      mustChangePassword: Boolean(row.must_change_password),
    },
  };
}

export const CONSOLE_ROLES = ['founder', 'admin', 'staff'];

export function canAccessConsole(user) {
  return Boolean(user && CONSOLE_ROLES.includes(user.role));
}

/** Fine-grained capabilities for the console. */
export function can(user, capability) {
  if (!user) return false;
  const role = user.role;
  const matrix = {
    'inventory.write': ['founder', 'admin'],
    'inventory.read': ['founder', 'admin', 'staff'],
    'products.write': ['founder', 'admin'],
    'orders.read': ['founder', 'admin', 'staff'],
    'orders.write': ['founder', 'admin', 'staff'],
    'refunds.issue': ['founder', 'admin'],
    'payments.manage': ['founder'],
    'users.manage': ['founder'],
    'content.manage': ['founder', 'admin'],
    'analytics.read': ['founder', 'admin'],
    'settings.manage': ['founder'],
    'audit.read': ['founder', 'admin'],
    'batches.write': ['founder', 'admin'],
  };
  return (matrix[capability] || []).includes(role);
}

/** Constant-time-ish CSRF check plus same-origin enforcement. */
export function isSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true; // non-browser clients / form posts without Origin
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export function verifyCsrf(form, auth, request) {
  if (!auth) return false;
  const token = form.get('_csrf') || request.headers.get('x-csrf-token') || '';
  return timingSafeEqual(token, auth.csrfToken);
}

export async function rateLimit(db, key, limit, windowSeconds) {
  const now = Date.now();
  const windowStart = new Date(now - (now % (windowSeconds * 1000))).toISOString();
  const row = await one(db, 'SELECT count, window_start FROM rate_limits WHERE key = ?', key);
  if (!row || row.window_start !== windowStart) {
    await run(
      db,
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start`,
      key,
      windowStart,
    );
    return { allowed: true, remaining: limit - 1 };
  }
  if (row.count >= limit) return { allowed: false, remaining: 0 };
  await run(db, 'UPDATE rate_limits SET count = count + 1 WHERE key = ?', key);
  return { allowed: true, remaining: limit - row.count - 1 };
}

/** Double-submit CSRF cookie for guests (checkout, waitlist, contact forms). */
export function guestCsrf(request) {
  const cookies = parseCookies(request);
  const existing = cookies.dd_csrf;
  if (existing && existing.length >= 16) return { token: existing, setCookie: null };
  const token = randomToken(24);
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return { token, setCookie: `dd_csrf=${token}; Path=/; SameSite=Lax; Max-Age=86400${secure}` };
}

/** Public forms accept either an authenticated session token or the guest cookie. */
export function verifyPublicCsrf(request, form, auth = null) {
  if (auth && verifyCsrf(form, auth, request)) return true;
  return verifyGuestCsrf(request, form);
}

export function verifyGuestCsrf(request, form) {
  const cookies = parseCookies(request);
  const cookieToken = cookies.dd_csrf || '';
  const formToken = form.get('_csrf') || '';
  return Boolean(cookieToken && formToken && timingSafeEqual(cookieToken, formToken));
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export function validEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email.trim());
}

export function cleanText(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

export async function pruneExpired(db) {
  const now = nowIso();
  await run(db, 'DELETE FROM sessions WHERE expires_at < ?', now);
  await run(
    db,
    `UPDATE inventory_reservations SET status = 'released'
     WHERE status = 'active' AND expires_at < ?`,
    now,
  );
  await run(db, 'DELETE FROM rate_limits WHERE window_start < ?', new Date(Date.now() - 86400000).toISOString());
}

export async function recentAudit(db, limit = 10) {
  return all(db, 'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?', limit);
}

export function generateTemporaryPassword() {
  return `Dd-${randomToken(9)}`;
}
