import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('browser CSRF protocol', () => {
  it('gets a token before mutations and refreshes it once after session rotation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'first-token' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'CSRF_INVALID' }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'fresh-token' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);
    const { apiFetch } = await import('../src/services/apiFetch');
    const response = await apiFetch('/api/orders', { method: 'PUT', body: '{}' });
    expect(response.ok).toBe(true);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/api/auth/csrf', '/api/orders', '/api/auth/csrf', '/api/orders']);
    expect((fetchMock.mock.calls[3][1].headers as Headers).get('X-CSRF-Token')).toBe('fresh-token');
    expect(fetchMock.mock.calls[3][1].credentials).toBe('include');
  });

  it('never retries role or vault denials as mutations', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ token: 'token' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'FINANCE_LOCKED' }), { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const { apiFetch } = await import('../src/services/apiFetch');
    expect((await apiFetch('/users', { method: 'POST', body: '{}' })).status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails explicitly without issuing the mutation if CSRF bootstrap fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const { apiFetch } = await import('../src/services/apiFetch');
    await expect(apiFetch('/orders', { method: 'POST', body: '{}' })).rejects.toThrow(/seguridad/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
