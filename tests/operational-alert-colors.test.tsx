import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RowDataPacket } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { OrderDetailView } from '../src/components/OrderDetailView';
import { YardPortalView } from '../src/components/YardPortalView';
import { mapOrder } from '../src/server/orders';
import type { Order } from '../src/types';

const unavailableRow = {
  id: 931,
  order_code: 'ORD-931',
  version: 1,
  created_at: '2026-11-10T16:00:00Z',
  status: 'Pagado',
  product_type: 'Transmisión',
  customer_id: 1,
  first_name: 'Ana',
  last_name: 'Torres',
  phone: '555-0100',
  brand: 'Toyota',
  model: 'Corolla',
  year: 2009,
  price: 100,
  down_payment: 100,
  yard_piece_ready: 0,
} as RowDataPacket;

const unavailableOrder = (): Order => ({
  ...(mapOrder(unavailableRow) as Order),
  yardPieceUnavailable: true,
  yardPieceUnavailableAt: '2026-11-10T18:00:00.000Z',
  yardPieceUnavailableReason: 'No encontrada en anaqueles',
});

describe('operational alert colors', () => {
  it('uses amber, not rose, for the unavailable-piece alert in the office detail', () => {
    const html = renderToStaticMarkup(
      <OrderDetailView order={unavailableOrder()} onBack={() => {}} onOpenSMS={() => {}} userRole="admin" />
    );
    expect(html).toContain('Pieza no disponible en patio físico');
    expect(html).toContain('border-amber-500/60');
    expect(html).not.toContain('from-rose-950/60');
    expect(html).not.toContain('bg-rose-500 text-slate-950');
    expect(html).not.toContain('Notificar WhatsApp');
  });

  it('uses amber for the unavailable-piece and auction controls in the yard queue', () => {
    const html = renderToStaticMarkup(
      <YardPortalView orders={[unavailableOrder()]} currentUser={{ id: 7, name: 'Yarda', role: 'vendedor_yarda' }} onLogout={() => {}} />
    );
    expect(html).toContain('No disponible · Subasta activa');
    expect(html).toContain('border border-yard-accent bg-yard-accent-soft');
    expect(html).toContain('text-yard-accent-strong');
    expect(html).not.toContain('yard-card--claim');
    expect(html).not.toContain('bg-yard-danger-soft');
  });
});
