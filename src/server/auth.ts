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
  if (!sessionCookie) return '';
  try {
    return decodeURIComponent(sessionCookie.slice('radar_session='.length));
  } catch {
    return '';
  }
};

export const getSessionToken = (request: IncomingMessage) => getBearerToken(request) || getCookieToken(request);

export const verifyToken = (request: IncomingMessage) => {
  if (!jwtSecret) return null;
  const token = getSessionToken(request);
  if (!token) return null;
  try {
    const claims = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    return typeof claims !== 'string' && claims.sub && Number.isFinite(claims.exp) ? claims as Claims : null;
  } catch {
    return null;
  }
};

export const appendCookie = (response: ServerResponse, cookie: string) => {
  const previous = response.getHeader('Set-Cookie');
  response.setHeader('Set-Cookie', previous ? [...(Array.isArray(previous) ? previous.map(String) : [String(previous)]), cookie] : cookie);
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
  try {
    const [rows] = await pool.query<Array<{ active: number; role: string; session_version: number; permissions: unknown } & import('mysql2/promise').RowDataPacket>>(
      'SELECT active, role, permissions, session_version FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [claims.sub]
    );
    const user = rows[0];
    if (!user || !user.active) return false;
    if (Number(claims.sessionVersion ?? 1) !== Number(user.session_version)) return false;
    claims.sessionVersion = Number(user.session_version);
    claims.role = user.role;
    claims.permissions = user.permissions;

    return true;
  } catch (error) {
    console.error('[Authentication] No fue posible verificar la sesión:', error);
    throw Object.assign(new Error('No fue posible verificar la sesión'), { statusCode: 503 });
  }
};

export const setSessionCookie = (response: ServerResponse, token: string) => {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  appendCookie(response, `radar_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secure}`);
};

export const clearSessionCookie = (response: ServerResponse) => {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  appendCookie(response, `radar_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
};
