import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/services/apiFetch', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../src/services/apiFetch';
import { ordersApi } from '../src/services/ordersApi';
import { Order } from '../src/types';

describe('orders frontend API contracts', () => {
  beforeEach(() => vi.mocked(apiFetch).mockReset());
  it('loads all server pages using X-Next-Offset', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: '1' }]), { headers: { 'X-Next-Offset': '1000' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: '2' }])));
    expect(await ordersApi.list()).toEqual([{ id: '1' }, { id: '2' }]);
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/orders?limit=1000&offset=0');
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/orders?limit=1000&offset=1000');
  });
  it('does not silently accept a partially loaded collection', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(new Response('[]', { headers: { 'X-Next-Offset': '1000' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Base no disponible' }), { status: 500 }));
    await expect(ordersApi.list()).rejects.toThrow('Base no disponible');
  });
  it('preserves version and idempotency key and exposes server conflict messages', async () => {
    const order = { id: '3', version: 7, idempotencyKey: 'stable-key' } as Order;
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ message: 'Versión obsoleta' }), { status: 409 }));
    await expect(ordersApi.update(order)).rejects.toThrow('Versión obsoleta');
    expect(JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][1]?.body))).toEqual(order);
  });
  it('requires a version for administrative delivery correction and never sends an OTP', async () => {
    await expect(ordersApi.updateDeliveryDate('3', { deliveredAt: '2026-11-01', reason: 'Fecha real' })).rejects.toThrow('versión');
    expect(apiFetch).not.toHaveBeenCalled();
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    await ordersApi.updateDeliveryDate('3', { deliveredAt: '2026-11-01', version: 7, reason: 'Fecha real' });
    expect(JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][1]?.body))).toEqual({ deliveredAt: '2026-11-01', version: 7, reason: 'Fecha real' });
  });
});
