import crypto from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Claims, getSessionToken } from './auth';

const lifetime = 15 * 60 * 1000;
const grants = new Map<string, { userId: string; session: string; expiresAt: number }>();
const sessionHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const cookie = (request: IncomingMessage, name: string) =>
  (request.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) || '';

function setCookie(response: ServerResponse, token: string, seconds: number) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', [
    ...(Array.isArray(response.getHeader('Set-Cookie')) ? response.getHeader('Set-Cookie') as string[] :
      response.getHeader('Set-Cookie') ? [String(response.getHeader('Set-Cookie'))] : []),
    `radar_finance=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure}`,
  ]);
}

export function unlockFinanceVault(response: ServerResponse, claims: Claims, token: string) {
  for (const [key, grant] of grants) if (grant.expiresAt <= Date.now()) grants.delete(key);
  const key = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + lifetime;
  grants.set(key, { userId: String(claims.sub), session: sessionHash(token), expiresAt });
  setCookie(response, key, lifetime / 1000);
  return expiresAt;
}

export function financeVaultExpiry(request: IncomingMessage, claims: Claims | null) {
  const key = cookie(request, 'radar_finance');
  const grant = grants.get(key);
  if (!grant || grant.expiresAt <= Date.now()) {
    grants.delete(key);
    return 0;
  }
  return claims?.role === 'admin' && grant.userId === String(claims.sub) &&
    grant.session === sessionHash(getSessionToken(request)) ? grant.expiresAt : 0;
}

export function revokeFinanceVaults(userId: string | number) {
  for (const [key, grant] of grants) if (grant.userId === String(userId)) grants.delete(key);
}

export function lockFinanceVault(request: IncomingMessage, response: ServerResponse) {
  grants.delete(cookie(request, 'radar_finance'));
  setCookie(response, '', 0);
}
