import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAnalyticsRequest } from '../src/server/analytics';
import { handleFinanceRequest } from '../src/server/finance';
import { pool } from '../src/server/config';
import { sendJson } from '../src/server/http';

vi.mock('../src/server/config', () => ({ pool: { query: vi.fn() } }));
vi.mock('../src/server/http', () => ({ sendJson: vi.fn(), readBody: vi.fn() }));
const req = () => { const request = new IncomingMessage(new Socket()); request.method = 'GET'; return request; };
beforeEach(() => vi.clearAllMocks());

describe('administrative dashboard aggregates without a vault grant', () => {
  it('returns only daily grouped amounts, preserving business dates and cents', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce([[
      { kind: 'payment', amount: '10.10', effective_at: new Date('2026-11-03T02:00:00Z') },
      { kind: 'payment', amount: '20.20', effective_at: new Date('2026-11-02T18:00:00Z') },
      { kind: 'refund', amount: '5.25', effective_at: new Date('2026-11-03T02:30:00Z') },
    ], []] as never);
    const request = req();
    const response = new ServerResponse(request);
    expect(await handleAnalyticsRequest(request, response, '/api/analytics/income', { sub: '1', role: 'admin' })).toBe(true);
    const result = vi.mocked(sendJson).mock.calls[0];
    expect(result[1]).toBe(200);
    expect(result[2]).toEqual([
      { id: '2026-11-02-payment', orderId: '', kind: 'payment', amount: 30.3, effectiveAt: '2026-11-02', source: 'daily_aggregate' },
      { id: '2026-11-02-refund', orderId: '', kind: 'refund', amount: 5.25, effectiveAt: '2026-11-02', source: 'daily_aggregate' },
    ]);
    expect(vi.mocked(pool.query).mock.calls[0][0]).toContain("source <> 'legacy_baseline'");
    expect(response.getHeader('Cache-Control')).toBe('no-store');
  });
  it('denies operators without reading finance data', async () => {
    const request = req();
    const response = new ServerResponse(request);
    await handleAnalyticsRequest(request, response, '/api/analytics/income', { sub: '2', role: 'operator' });
    expect(response.statusCode).toBe(403);
    expect(response.writableEnded).toBe(true);
    expect(pool.query).not.toHaveBeenCalled();
  });
  it('keeps detailed movements and payroll state locked even for administrators', async () => {
    for (const path of ['/api/finance/movements', '/api/finance/state']) {
      const request = req();
      const response = new ServerResponse(request);
      await handleFinanceRequest(request, response, path, { sub: '1', role: 'admin' });
      expect(sendJson).toHaveBeenCalledWith(response, 403, expect.objectContaining({ code: 'FINANCE_LOCKED' }));
    }
    expect(pool.query).not.toHaveBeenCalled();
  });
});
