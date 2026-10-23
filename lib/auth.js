import crypto from 'node:crypto';
import { send } from './http.js';

const COOKIE = 'jt_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw Object.assign(new Error('SESSION_SECRET is missing or shorter than 32 characters'), { status: 500 });
  }
  return s;
}

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('base64url');
}

function cookie(value, maxAge) {
  const secure = process.env.NODE_ENV === 'development' ? '' : '; Secure';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function createSessionCookie() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + MAX_AGE * 1000 })).toString('base64url');
  return cookie(`${payload}.${sign(payload)}`, MAX_AGE);
}

export function clearSessionCookie() {
  return cookie('', 0);
}

export function isAuthenticated(req) {
  const header = req.headers.cookie || '';
  const part = header.split(/;\s*/).find((p) => p.startsWith(`${COOKIE}=`));
  if (!part) return false;
  const [payload, sig] = part.slice(COOKIE.length + 1).split('.');
  if (!payload || !sig) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

export function checkPassword(input) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) throw Object.assign(new Error('APP_PASSWORD is not set'), { status: 500 });
  const a = crypto.createHash('sha256').update(String(input ?? '')).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// Returns true when signed in; otherwise answers 401 and returns false.
export function requireAuth(req, res) {
  if (isAuthenticated(req)) return true;
  send(res, 401, { error: 'Not signed in' });
  return false;
}
