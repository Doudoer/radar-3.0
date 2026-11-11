import crypto from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { allowedOrigins, isAllowedLocalOrigin, jwtSecret } from './config';
import { getSessionToken } from './auth';

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const buckets = new Map<string, { count: number; resetAt: number }>();
const csrfLifetime = 8 * 60 * 60 * 1000;

export const clientAddress = (request: IncomingMessage) => {
  const forwarded = request.headers['x-real-ip'];
  return process.env.TRUST_PROXY === '1' && typeof forwarded === 'string' && isIP(forwarded)
    ? forwarded : request.socket.remoteAddress || 'unknown';
};

export const originAllowed = (origin: string) => allowedOrigins.has(origin) || isAllowedLocalOrigin(origin);
export const isUnsafeMethod = (method = 'GET') => unsafeMethods.has(method);

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= 10000) {
      for (const [oldKey, value] of buckets) if (value.resetAt <= now) buckets.delete(oldKey);
      if (buckets.size >= 10000) return Math.ceil(windowMs / 1000);
    }
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count++;
  return bucket.count > limit ? Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) : 0;
}

setInterval(() => {
  for (const [key, value] of buckets) if (value.resetAt <= Date.now()) buckets.delete(key);
}, 60_000).unref();

export function requestOriginAllowed(request: IncomingMessage) {
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = request.headers.origin;
  return !origin || originAllowed(origin);
}

export function isSecureRequest(request: IncomingMessage) {
  return ('encrypted' in request.socket && request.socket.encrypted === true) ||
    (process.env.TRUST_PROXY === '1' && request.headers['x-forwarded-proto'] === 'https');
}

export function securityHeaders(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin;
  if (origin && originAllowed(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
  response.setHeader('Access-Control-Expose-Headers', 'X-Next-Offset, Retry-After');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  const connect = process.env.NODE_ENV === 'production' ? '' : ' http://localhost:* http://127.0.0.1:* http://*.localhost:* http://*.localhost.com:* ws://localhost:* ws://127.0.0.1:* ws://*.localhost:* ws://*.localhost.com:*';
  response.setHeader('Content-Security-Policy', `default-src 'self'; connect-src 'self' https://vpic.nhtsa.dot.gov${connect}; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`);
  if (process.env.NODE_ENV === 'production') {
    response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

function csrfSignature(value: string, request: IncomingMessage) {
  const session = crypto.createHash('sha256').update(getSessionToken(request)).digest('hex');
  return crypto.createHmac('sha256', jwtSecret).update(`${value}.${session}`).digest('hex');
}

export function issueCsrfToken(request: IncomingMessage, response: ServerResponse) {
  const value = `${Date.now() + csrfLifetime}.${crypto.randomBytes(32).toString('hex')}`;
  const token = `${value}.${csrfSignature(value, request)}`;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `radar_csrf=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${csrfLifetime / 1000}${secure}`);
  return token;
}

export function validCsrfToken(request: IncomingMessage) {
  const token = request.headers['x-csrf-token'];
  const cookie = (request.headers.cookie || '').split(';').map(part => part.trim())
    .find(part => part.startsWith('radar_csrf='))?.slice('radar_csrf='.length);
  if (!jwtSecret || typeof token !== 'string' || token !== cookie || token.length > 200) return false;
  const match = token.match(/^(\d{13}\.[a-f0-9]{64})\.([a-f0-9]{64})$/);
  if (!match || Number(token.split('.')[0]) <= Date.now()) return false;
  return crypto.timingSafeEqual(Buffer.from(match[2]), Buffer.from(csrfSignature(match[1], request)));
}
