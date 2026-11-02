import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeeklyRelationView } from '../src/components/WeeklyRelationView';
import { financeVaultExpiry, lockFinanceVault, unlockFinanceVault } from '../src/server/financeVault';

const request = (session = 'session-A', vault = '') => {
  const req = new IncomingMessage(new Socket());
  req.headers.cookie = `radar_session=${session}; radar_finance=${vault}`;
  return req;
};
const grant = () => {
  const response = new ServerResponse(request());
  response.setHeader('Set-Cookie', 'radar_session=session-A; HttpOnly');
  const expiresAt = unlockFinanceVault(response, { sub: '1', role: 'admin' }, 'session-A');
  const cookies = response.getHeader('Set-Cookie') as string[];
  return { expiresAt, token: cookies[1].split(';')[0].split('=')[1], cookies };
};
afterEach(() => vi.useRealTimers());

describe('financial vault', () => {
  it('renders the locked vault instead of payroll and finance data', () => {
    const html = renderToStaticMarkup(<WeeklyRelationView />);
    expect(html).toContain('AUTENTICACIÓN EN DOS PASOS');
    expect(html).toContain('WhatsApp');
    expect(html).toContain('Authenticator');
    expect(html).toContain('8 Códigos');
    expect(html).toContain('VERIFICAR Y DESBLOQUEAR');
    expect(html).not.toContain('Nómina Empleados');
    expect(html).not.toContain('Recargar ingresos');
  });
  it('requires an administrative grant bound to the exact authenticated session', () => {
    const { token, expiresAt, cookies } = grant();
    expect(cookies[0]).toContain('radar_session=');
    expect(cookies[1]).toContain('HttpOnly');
    expect(financeVaultExpiry(request(), { sub: '1', role: 'admin' })).toBe(0);
    expect(financeVaultExpiry(request('session-A', token), { sub: '1', role: 'admin' })).toBe(expiresAt);
    expect(financeVaultExpiry(request('session-B', token), { sub: '1', role: 'admin' })).toBe(0);
    expect(financeVaultExpiry(request('session-A', token), { sub: '2', role: 'admin' })).toBe(0);
    expect(financeVaultExpiry(request('session-A', token), { sub: '1', role: 'operator' })).toBe(0);
  });
  it('expires access after fifteen minutes', () => {
    vi.useFakeTimers();
    const { token } = grant();
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(financeVaultExpiry(request('session-A', token), { sub: '1', role: 'admin' })).toBe(0);
  });
  it('revokes the grant when locking, including replay of the previous cookie', () => {
    const { token } = grant();
    const req = request('session-A', token);
    const response = new ServerResponse(req);
    lockFinanceVault(req, response);
    expect(financeVaultExpiry(req, { sub: '1', role: 'admin' })).toBe(0);
    expect(String(response.getHeader('Set-Cookie'))).toContain('Max-Age=0');
  });
});
