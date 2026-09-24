import { IncomingMessage, ServerResponse } from 'node:http';
import jwt from 'jsonwebtoken';
import { jwtSecret, pool } from './config';

export type Claims = jwt.JwtPayload & { role?: string; sub?: string | number };

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

const getBearerToken = (request: IncomingMessage) => {
  const authorization = request.headers.authorization || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
};

const getCookieToken = (request: IncomingMessage) => {
  const cookies = request.headers.cookie || '';
  const sessionCookie = cookies.split(';').map((part) => part.trim()).find((part) => part.startsWith('radar_session='));
  return sessionCookie ? decodeURIComponent(sessionCookie.slice('radar_session='.length)) : '';
};

export const verifyToken = (request: IncomingMessage) => {
  if (!jwtSecret) return null;
  const token = getBearerToken(request) || getCookieToken(request);
  if (!token) return null;
  try {
    return jwt.verify(token, jwtSecret) as Claims;
  } catch {
    return null;
  }
};

export const roleIs = (claims: Claims | null, ...roles: string[]) =>
  Boolean(claims?.role && roles.includes(String(claims.role).toLowerCase()));

export const requireRole = (response: ServerResponse, claims: Claims | null, ...roles: string[]) => {
  if (!roleIs(claims, ...roles)) {
    response.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ message: 'No tienes permisos para esta operación' }));
    return false;
  }
  return true;
};

export const isLoginRateLimited = (key: string) => {
  const now = Date.now();
  const attempt = loginAttempts.get(key);
  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.set(key, { count: 0, resetAt: now + 15 * 60 * 1000 });
    return false;
  }
  return attempt.count >= 10;
};

export const recordLoginFailure = (key: string) => {
  const attempt = loginAttempts.get(key) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
  attempt.count += 1;
  loginAttempts.set(key, attempt);
};

export const resetLoginAttempts = (key: string) => loginAttempts.delete(key);

setInterval(() => {
  const now = Date.now();
  for (const [key, attempt] of loginAttempts) {
    if (attempt.resetAt <= now) loginAttempts.delete(key);
  }
}, 60_000).unref();

export const userIsActive = async (claims: Claims) => {
  if (!claims.sub) return false;
  const [rows] = await pool.query<Array<{ active: number; updated_at: Date } & import('mysql2/promise').RowDataPacket>>(
    'SELECT active, updated_at FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [claims.sub]
  );
  const user = rows[0];
  if (!user?.active) return false;
  const issuedAt = Number(claims.iat || 0) * 1000;
  return !issuedAt || !user.updated_at || new Date(user.updated_at).getTime() <= issuedAt + 2000;
};

export const setSessionCookie = (response: ServerResponse, token: string) => {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `radar_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secure}`);
};

export const clearSessionCookie = (response: ServerResponse) => {
  response.setHeader('Set-Cookie', 'radar_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
};
