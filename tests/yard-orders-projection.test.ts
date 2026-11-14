import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../src/server/config', () => ({ pool: { query }, maxBodyBytes: 50000, jwtSecret: 'test-only', frontendRoot: '' }));

import { getYardOrders, getYardQueueCounts } from '../src/server/orders';

describe('yard order projection', () => {
  beforeEach(() => query.mockClear());

  it('returns a minimal queue payload for paid and claim orders only', async () => {
    query.mockResolvedValueOnce([[
      {
        id: 558,
        version: 3,
        order_code: 'ORD-639333',
        customer_id: 21,
        is_yard_sale: 1,
        status: 'Reclamo',
        product_type: 'Puerta delantera',
        product_specs: 'Piel, eléctrica',
        stock_nr: '24D109',
        workflow_step: 2,
        warranty_days: 60,
        created_at: new Date('2026-09-12T15:40:39Z'),
        claim_reason: null,
        description: 'Cliente pide llamada antes de retirar',
        vin_nr: '1N4AL21E88C111111',
        brand: 'Nissan',
        model: 'Altima',
        sub_model: 'S',
        year: 2012,
        transmission_type: 'AT',
        color: 'Gris',
        mileage: '120000',
        yard_piece_ready: 0,
        yard_piece_ready_at: null,
        yard_piece_ready_ack_at: new Date('2026-11-12T08:00:00Z'),
        yard_piece_ready_ack_by: 3,
        yard_compatibility: JSON.stringify({ compatibilityList: 'Altima 2007-2012', referenceImages: ['/uploads/a.jpg'] }),
        workflow_data: JSON.stringify({ yardPieceUnavailable: true, yardPieceUnavailableReason: 'No encontrada', yardPieceUnavailableAt: '2026-11-10T10:00:00.000Z', claimPieceReady: true, claimPieceReadyAt: '2026-11-11T09:00:00.000Z' }),
        auction_search_active: 1,
        first_name: 'Ana',
        last_name: 'Torres',
        phone: '555-0100',
        company: 'Taller Norte',
        type: 'Taller Mecánico',
        advisor: 'Luis',
        advisor_role: 'operator',
        paid_log_at: new Date('2026-09-20T18:00:00Z'),
        claim_log_at: new Date('2026-09-25T12:00:00Z'),
      },
    ], []]);

    const orders = await getYardOrders();

    expect(query.mock.calls[0][1]).toEqual([['Pagado', 'Reclamo'], 50, 0]);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      id: '558',
      version: 3,
      status: 'reclamo',
      isYardSale: true,
      stockNumber: '24D109',
      paidAtIso: '2026-09-20T18:00:00.000Z',
      claimLoggedAt: '2026-09-25T12:00:00.000Z',
      yardPieceReadyAckAt: '2026-11-12T08:00:00.000Z',
      yardPieceReadyAckBy: 3,
      yardPieceUnavailable: true,
      yardPieceUnavailableReason: 'No encontrada',
      claimPieceReady: true,
      claimPieceReadyAt: '2026-11-11T09:00:00.000Z',
      notes: 'Cliente pide llamada antes de retirar',
      auctionActive: true,
      customer: { name: 'Ana Torres', phone: '555-0100', email: '', location: '', shippingAddress: '' },
      vehicle: { vin: '1N4AL21E88C111111', make: 'Nissan', model: 'Altima', year: 2012 },
    });
    expect(orders[0].yardCompatibility).toEqual({ compatibilityList: 'Altima 2007-2012', referenceImages: ['/uploads/a.jpg'] });
    expect(orders[0]).not.toHaveProperty('financials');
  });

  it('paginates the FIFO queue with a stable tie-breaker and clamps the page size', async () => {
    query.mockResolvedValueOnce([[], []]);
    await getYardOrders({ limit: 20, offset: 40, q: '' });

    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain('ORDER BY COALESCE(paid_log_at, o.created_at) ASC, o.id ASC');
    expect(String(sql)).toContain('LIMIT ? OFFSET ?');
    expect(params).toEqual([['Pagado', 'Reclamo'], 20, 40]);

    query.mockResolvedValueOnce([[], []]);
    await getYardOrders({ limit: 9999, offset: -5 });
    expect(query.mock.calls[1][1]).toEqual([['Pagado', 'Reclamo'], 201, 0]);
  });

  it('searches the whole queue by order, VIN, pallet, part, customer, phone and vehicle', async () => {
    query.mockResolvedValueOnce([[], []]);
    await getYardOrders({ q: ' 100%_abc ', limit: 10 });

    const [sql, params] = query.mock.calls[0];
    const statement = String(sql);
    expect(statement).toContain('o.order_code LIKE ?');
    expect(statement).toContain('o.vin_nr LIKE ?');
    expect(statement).toContain('o.stock_nr LIKE ?');
    expect(statement).toContain('o.product_type LIKE ?');
    expect(statement).toContain("CONCAT_WS(' ', c.first_name, c.last_name) LIKE ?");
    expect(statement).toContain('c.phone LIKE ?');
    expect(statement).toContain("CONCAT_WS(' ', o.year, o.brand, o.model, o.sub_model) LIKE ?");
    const escaped = '%100\\%\\_abc%';
    expect(params).toEqual([['Pagado', 'Reclamo'], escaped, escaped, escaped, escaped, escaped, escaped, escaped, 10, 0]);
  });

  it('aggregates the tab counts over the scoped queue', async () => {
    query.mockResolvedValueOnce([[{ total: 21, pending_yard: '8', yard_ready: '2', claims: '11', yard_sales: '3' }], []]);

    await expect(getYardQueueCounts()).resolves.toEqual({
      all: 21, pending_yard: 8, yard_ready: 2, claims: 11, yard_sales: 3,
    });
    expect(query.mock.calls[0][1]).toEqual([['Pagado', 'Reclamo']]);
    expect(String(query.mock.calls[0][0])).toContain("LOWER(o.status) = 'pagado'");
  });
});
