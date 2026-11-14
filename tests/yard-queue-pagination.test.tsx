import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RowDataPacket } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { YardPortalView } from '../src/components/YardPortalView';
import { mapOrder } from '../src/server/orders';
import { mergeYardOrders, yardQueueCountsFromOrders } from '../src/utils/yardQueue';
import type { Order } from '../src/types';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  order_code: 'ORD-1',
  version: 1,
  created_at: '2026-11-01T16:00:00Z',
  status: 'Pagado',
  product_type: 'Motor',
  customer_id: 1,
  first_name: 'Ana',
  last_name: 'Torres',
  phone: '555-0100',
  brand: 'Nissan',
  model: 'Altima',
  year: 2012,
  price: 100,
  down_payment: 100,
  yard_piece_ready: 0,
  ...overrides,
} as RowDataPacket);

const order = (overrides: Record<string, unknown> = {}) => mapOrder(row(overrides)) as Order;

const renderYard = (props: Partial<React.ComponentProps<typeof YardPortalView>> = {}) => renderToStaticMarkup(
  <YardPortalView
    orders={[order({ id: 1, order_code: 'ORD-1' }), order({ id: 2, order_code: 'ORD-2' })]}
    currentUser={{ id: 7, name: 'Yarda', role: 'vendedor_yarda' }}
    onLogout={() => {}}
    {...props}
  />
);

describe('yard queue pagination helpers', () => {
  it('counts each tab from a loaded page', () => {
    const orders = [
      order({ id: 1, status: 'Pagado', yard_piece_ready: 0 }),
      order({ id: 2, status: 'Pagado', yard_piece_ready: 1 }),
      order({ id: 3, status: 'Reclamo' }),
      order({ id: 4, status: 'Pagado', is_yard_sale: 1 }),
    ];
    expect(yardQueueCountsFromOrders(orders)).toEqual({
      all: 4, pending_yard: 2, yard_ready: 1, claims: 1, yard_sales: 1,
    });
  });

  it('appends pages without duplicating an order already loaded', () => {
    const first = [order({ id: 1 }), order({ id: 2 })];
    const second = [order({ id: 2 }), order({ id: 3 })];
    expect(mergeYardOrders(first, second).map((item) => item.id)).toEqual(['1', '2', '3']);
  });
});

describe('yard queue paging controls', () => {
  it('shows server counts and a load-more control when the queue has more pages', () => {
    const html = renderYard({
      serverCounts: { all: 120, pending_yard: 100, yard_ready: 10, claims: 20, yard_sales: 5 },
      hasMoreYardOrders: true,
      onLoadMoreYardOrders: async () => {},
    });
    expect(html).toContain('Mostrando 2 de 100 en esta pestaña');
    expect(html).toContain('Cargar más órdenes');
  });

  it('hides the load-more control once every page is loaded', () => {
    const html = renderYard({ hasMoreYardOrders: false, onLoadMoreYardOrders: async () => {} });
    expect(html).not.toContain('Cargar más órdenes');
    expect(html).not.toContain('Mostrando ');
  });

  it('keeps the office exit reachable on small screens for administrators', () => {
    const html = renderYard({ currentUser: { id: 7, name: 'Admin', role: 'admin' }, onToggleOffice: () => {} });
    const officeButton = html.match(/<button[^>]*aria-label="Ir a Radar Oficina"[^>]*>/)?.[0] || '';
    expect(officeButton).not.toBe('');
    expect(officeButton).not.toContain('hidden sm:flex');
  });

  it('announces server-side search while the whole queue is queried', () => {
    const html = renderYard({
      hasMoreYardOrders: true,
      isSearchingYardOrders: true,
      onSearchYardOrders: () => {},
      onLoadMoreYardOrders: async () => {},
    });
    expect(html).toContain('Buscando en toda la cola de patio');
  });
});
