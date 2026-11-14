import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RowDataPacket } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { OrderDetailView } from '../src/components/OrderDetailView';
import { mapOrder } from '../src/server/orders';
import type { Order } from '../src/types';

const readyPaidRow = {
  id: 902,
  order_code: 'ORD-902',
  version: 2,
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
  yard_piece_ready: 1,
  yard_piece_ready_at: '2026-11-11T09:00:00.000Z',
} as RowDataPacket;

const renderOrder = (order: Order, role: string) => renderToStaticMarkup(
  <OrderDetailView order={order} onBack={() => {}} onOpenSMS={() => {}} userRole={role} />
);

const renderDetail = (role: string) => renderOrder(mapOrder(readyPaidRow) as Order, role);

describe('office yard revert affordance', () => {
  it('lets only administrators revert a ready piece from the office detail', () => {
    const adminHtml = renderDetail('admin');
    expect(adminHtml).toContain('Revertir Pieza Lista');
    expect(adminHtml).not.toContain('Marcar Pieza Lista en Yarda');

    const yardHtml = renderDetail('vendedor_yarda');
    expect(yardHtml).not.toContain('Revertir Pieza Lista');
  });

  it('lets administrators clear a legacy ready piece that is already in preparation', () => {
    const legacyReady = mapOrder({ ...readyPaidRow, status: 'En Preparación' } as RowDataPacket) as Order;
    const adminHtml = renderOrder(legacyReady, 'admin');
    expect(adminHtml).toContain('PIEZA LISTA EN YARDA');
    expect(adminHtml).toContain('Revertir Pieza Lista');
    expect(adminHtml).not.toContain('Marcar Pieza Lista en Yarda');

    const yardHtml = renderOrder(legacyReady, 'vendedor_yarda');
    expect(yardHtml).not.toContain('Revertir Pieza Lista');
  });

  it('only offers to mark a piece ready while the order is still paid', () => {
    const paidPending = mapOrder({ ...readyPaidRow, yard_piece_ready: 0, yard_piece_ready_at: null } as RowDataPacket) as Order;
    expect(renderOrder(paidPending, 'admin')).toContain('Marcar Pieza Lista en Yarda');

    const preparationPending = { ...paidPending, status: 'en_preparacion' as const };
    expect(renderOrder(preparationPending, 'admin')).not.toContain('Marcar Pieza Lista en Yarda');
  });
});
