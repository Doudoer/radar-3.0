import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/server/config', () => ({
  pool: { query: vi.fn(), getConnection: vi.fn() },
  jwtSecret: 'test-signing-key-that-is-at-least-thirty-two-characters',
}));

import { pool } from '../src/server/config';
import { handleClaimsListRequest } from '../src/server/claims';
import { handleRefundsListRequest, mapRefundRow } from '../src/server/refunds';
import { canReadOrderUpload, isYardScopedStatus } from '../src/server/uploadAccess';
import type { Claims } from '../src/server/auth';

const claimsFor = (role: string, sub = '7'): Claims => ({ sub, role });

const makeResponse = () => {
  const request = new IncomingMessage(new Socket());
  request.method = 'GET';
  const response = new ServerResponse(request);
  let body = '';
  const originalEnd = response.end.bind(response);
  response.end = ((chunk?: unknown, ...rest: unknown[]) => {
    if (typeof chunk === 'string') body += chunk;
    else if (Buffer.isBuffer(chunk)) body += chunk.toString('utf8');
    return (originalEnd as (...args: unknown[]) => ServerResponse)(chunk, ...rest);
  }) as typeof response.end;
  return { request, response, body: () => body };
};

const get = (path: string) => {
  const { request, response, body } = makeResponse();
  request.url = path;
  return { request, response, body };
};

beforeEach(() => vi.clearAllMocks());

describe('GET /api/claims authorization', () => {
  it('rejects sessions without a valid token before touching the database', async () => {
    const { request, response } = get('/api/claims');
    expect(await handleClaimsListRequest(request, response, '/api/claims', null)).toBe(true);
    expect(response.statusCode).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('denies yard sellers and unknown roles with 403', async () => {
    for (const role of ['vendedor_yarda', 'invitado']) {
      const { request, response } = get('/api/claims');
      expect(await handleClaimsListRequest(request, response, '/api/claims', claimsFor(role))).toBe(true);
      expect(response.statusCode).toBe(403);
    }
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('serves claims to admins and operators', async () => {
    vi.mocked(pool.query).mockResolvedValue([[], []] as never);
    for (const role of ['admin', 'operator']) {
      const { request, response } = get('/api/claims');
      await handleClaimsListRequest(request, response, '/api/claims', claimsFor(role));
      expect(response.statusCode).toBe(200);
    }
    expect(pool.query).toHaveBeenCalledTimes(4);
  });

  it('ignores unrelated routes', async () => {
    const { request, response } = get('/api/claims/1');
    expect(await handleClaimsListRequest(request, response, '/api/claims/1', claimsFor('admin'))).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('GET /api/refunds authorization', () => {
  it('rejects sessions without a valid token before touching the database', async () => {
    const { request, response } = get('/api/refunds');
    expect(await handleRefundsListRequest(request, response, '/api/refunds', null)).toBe(true);
    expect(response.statusCode).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('denies yard sellers with 403 and no payment data read', async () => {
    const { request, response } = get('/api/refunds');
    expect(await handleRefundsListRequest(request, response, '/api/refunds', claimsFor('vendedor_yarda'))).toBe(true);
    expect(response.statusCode).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('serves refunds to admins and operators, mapping payment details', async () => {
    vi.mocked(pool.query).mockResolvedValue([[
      {
        id: 9, order_id: 44, order_code: 'ORD-44', first_name: 'Ana', last_name: 'Ruiz',
        year: 2020, brand: 'GMC', model: 'Terrain', product_type: 'Radiador', reason: 'Pieza incompleta',
        amount: '150.00', amount_type: 'downpayment', payment_method: 'zelle',
        payment_contact: 'ana@example.com', status: 'pending', refund_scope: 'purchase',
        created_at: new Date('2026-11-01T12:00:00Z'),
      },
    ], []] as never);
    const { request, response } = get('/api/refunds');
    await handleRefundsListRequest(request, response, '/api/refunds', claimsFor('operator'));
    expect(response.statusCode).toBe(200);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(mapRefundRow({ id: 9, order_id: 44, payment_method: 'cashapp', payment_contact: 'user@cash' })).toMatchObject({
      id: 'REF-9', orderId: '44', paymentMethod: 'CashApp', paymentDetails: 'user@cash',
    });
  });
});

describe('/uploads order scope', () => {
  it('requires a session and denies unknown roles', () => {
    expect(canReadOrderUpload(null, 'Pagado')).toBe(false);
    expect(canReadOrderUpload({ role: 'invitado' }, 'Pagado')).toBe(false);
  });

  it('lets office roles read any attachment, matching shared order visibility', () => {
    expect(canReadOrderUpload({ role: 'admin' }, 'Entregado')).toBe(true);
    expect(canReadOrderUpload({ role: 'operator' }, 'Entregado')).toBe(true);
  });

  it('limits yard sellers to yard queue statuses and unattached files', () => {
    expect(canReadOrderUpload({ role: 'vendedor_yarda' }, 'Pagado')).toBe(true);
    expect(canReadOrderUpload({ role: 'vendedor_yarda' }, 'Reclamo')).toBe(true);
    expect(canReadOrderUpload({ role: 'vendedor_yarda' }, 'En Preparación')).toBe(false);
    expect(canReadOrderUpload({ role: 'vendedor_yarda' }, 'Entregado')).toBe(false);
    expect(canReadOrderUpload({ role: 'vendedor_yarda' }, 'Cancelado')).toBe(false);
    expect(canReadOrderUpload({ role: 'vendedor_yarda' }, undefined)).toBe(true);
    expect(isYardScopedStatus('Pagado')).toBe(true);
    expect(isYardScopedStatus('Reclamo')).toBe(true);
    expect(isYardScopedStatus('Archivado')).toBe(false);
    expect(isYardScopedStatus(null)).toBe(false);
  });
});
