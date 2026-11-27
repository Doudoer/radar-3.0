import { IncomingMessage, ServerResponse } from 'node:http';
import type { RowDataPacket } from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { jwtSecret, pool } from './config';

export type Claims = jwt.JwtPayload & { role?: string; sub?: string | number; scope?: string };

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

export const normalizeAuthRole = (role?: string | null): string => {
  if (!role) return '';
  const r = String(role).trim().toLowerCase();
  if (r === 'gerente' || r === 'super_admin' || r === 'super admin' || r === 'admin') return 'admin';
  if (r === 'asesor' || r === 'asesor de ventas' || r === 'asesor_de_ventas' || r === 'operator') return 'operator';
  if (r === 'dispatcher' || r === 'dispatchers') return 'dispatcher';
  if (r === 'rct') return 'rct';
  if (r === 'marketing') return 'marketing';
  if (r === 'vendedor_yarda' || r === 'vendedor yarda' || r === 'yarda') return 'vendedor_yarda';
  return r;
};

export const roleIs = (claims: Claims | null, ...roles: string[]) => {
  if (!claims?.role) return false;
  const userRole = normalizeAuthRole(claims.role);
  const normalizedTargets = roles.map(normalizeAuthRole);
  return (
    normalizedTargets.includes(userRole) ||
    roles.map((r) => r.trim().toLowerCase()).includes(String(claims.role).trim().toLowerCase())
  );
};

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

export const isPinInUse = async (pin: string, excludeUserId?: number) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, pin_hash FROM users WHERE pin_hash IS NOT NULL AND deleted_at IS NULL${excludeUserId ? ' AND id <> ?' : ''}`,
    excludeUserId ? [excludeUserId] : []
  );
  for (const row of rows) {
    if (await bcrypt.compare(pin, String(row.pin_hash || ''))) return true;
  }
  return false;
};

export const userIsActive = async (claims: Claims) => {
  if (!claims.sub) return false;
  try {
    if (claims.scope === 'yard_global') {
      const [settingRows] = await pool.query<RowDataPacket[]>(
        "SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('yard.global_access_code_hash', 'yard.global_code_version')",
      );
      const map = new Map(settingRows.map((r) => [String(r.setting_key), String(r.setting_value ?? '')]));
      const hash = (map.get('yard.global_access_code_hash') || '').trim();
      if (!hash) return false;
      const version = Number(map.get('yard.global_code_version') || 1) || 1;
      if (claims.sessionVersion !== undefined && Number(claims.sessionVersion) !== version) return false;
      claims.sessionVersion = version;
      claims.role = 'vendedor_yarda';
      return true;
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [claims.sub]
    );
    const user = rows[0];
    if (!user || !user.active) return false;
    const sessionVer = Number(user.session_version ?? 1) || 1;
    if (claims.sessionVersion !== undefined && Number(claims.sessionVersion) !== sessionVer) return false;
    claims.sessionVersion = sessionVer;
    claims.role = user.role;
    claims.permissions = user.permissions;

    return true;
  } catch (error) {
    console.error('[Authentication] No fue posible verificar la sesión:', error);
    throw Object.assign(new Error('No fue posible verificar la sesión'), { statusCode: 503 });
  }
};

export const setSessionCookie = (response: ServerResponse, token: string, maxAgeSeconds = 28800) => {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  appendCookie(response, `radar_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`);
};

export const clearSessionCookie = (response: ServerResponse) => {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  appendCookie(response, `radar_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
};
