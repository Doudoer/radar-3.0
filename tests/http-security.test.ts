import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/server/config', async importOriginal => ({
  ...await importOriginal<typeof import('../src/server/config')>(),
  jwtSecret: 'test-signing-key-that-is-at-least-thirty-two-characters',
}));
import { clientAddress, isSecureRequest, issueCsrfToken, originAllowed, rateLimit, requestOriginAllowed, securityHeaders, validCsrfToken } from '../src/server/security';
import { getSessionToken } from '../src/server/auth';

const request = () => new IncomingMessage(new Socket());
afterEach(() => vi.unstubAllEnvs());

describe('HTTP security boundary', () => {
  it('requires signed, unexpired CSRF header AND cookie bound to the exact session', () => {
    const req = request();
    req.headers.cookie = 'radar_session=session-a';
    const token = issueCsrfToken(req, new ServerResponse(req));
    expect(validCsrfToken(req)).toBe(false);
    req.headers['x-csrf-token'] = token;
    expect(validCsrfToken(req)).toBe(false);
    req.headers.cookie += `; radar_csrf=${token}`;
    expect(validCsrfToken(req)).toBe(true);
    req.headers.cookie = `radar_session=session-b; radar_csrf=${token}`;
    expect(validCsrfToken(req)).toBe(false);
    req.headers.cookie = `radar_session=session-a; radar_csrf=${token}`;
    req.headers['x-csrf-token'] = token.replace(/.$/, token.endsWith('0') ? '1' : '0');
    expect(validCsrfToken(req)).toBe(false);
    req.headers['x-csrf-token'] = token;
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 8 * 60 * 60 * 1000 + 1);
    expect(validCsrfToken(req)).toBe(false);
    vi.restoreAllMocks();
  });

  it('uses Secure, HttpOnly and SameSite=Strict for production CSRF cookies', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const req = request();
    const res = new ServerResponse(req);
    issueCsrfToken(req, res);
    expect(res.getHeader('Set-Cookie')).toMatch(/HttpOnly; SameSite=Strict; Max-Age=\d+; Secure/);
  });

  it('rejects hostile origins and cross-site browser requests, permits local development only', () => {
    const req = request();
    req.headers.origin = 'https://attacker.invalid';
    expect(requestOriginAllowed(req)).toBe(false);
    req.headers.origin = 'http://127.0.0.1:5000';
    expect(requestOriginAllowed(req)).toBe(true);
    vi.stubEnv('NODE_ENV', 'production');
    expect(requestOriginAllowed(req)).toBe(false);
    delete req.headers.origin;
    req.headers['sec-fetch-site'] = 'cross-site';
    expect(requestOriginAllowed(req)).toBe(false);
    expect(originAllowed('null')).toBe(false);
    expect(originAllowed('https://radar-rsy.store.attacker.invalid')).toBe(false);
  });

  it('does not trust forged proxy headers unless explicitly configured', () => {
    const req = request();
    req.headers['x-real-ip'] = '192.0.2.12';
    req.headers['x-forwarded-proto'] = 'https';
    vi.stubEnv('TRUST_PROXY', '0');
    expect(clientAddress(req)).toBe('unknown');
    expect(isSecureRequest(req)).toBe(false);
    vi.stubEnv('TRUST_PROXY', '1');
    expect(clientAddress(req)).toBe('192.0.2.12');
    expect(isSecureRequest(req)).toBe(true);
  });

  it('bounds traffic and resets the bucket only after its window', () => {
    const key = crypto.randomUUID();
    expect(rateLimit(key, 2, 60000, 100000)).toBe(0);
    expect(rateLimit(key, 2, 60000, 100000)).toBe(0);
    expect(rateLimit(key, 2, 60000, 100000)).toBe(60);
    expect(rateLimit(key, 2, 60000, 160000)).toBe(0);
  });

  it('disallows inline/eval scripts, embeds and framing', () => {
    const req = request();
    const res = new ServerResponse(req);
    securityHeaders(req, res);
    const csp = String(res.getHeader('Content-Security-Policy'));
    expect(csp).toContain("script-src 'self';");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.getHeader('X-Content-Type-Options')).toBe('nosniff');
    expect(res.getHeader('Access-Control-Allow-Origin')).toBeUndefined();
  });

  it('treats a malformed session cookie as unauthenticated, not a server error', () => {
    const req = request();
    req.headers.cookie = 'radar_session=%E0%A4%A';
    expect(getSessionToken(req)).toBe('');
  });
});
