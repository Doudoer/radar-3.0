import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RowDataPacket, PoolConnection } from 'mysql2/promise';
import { OrderDetailView } from '../src/components/OrderDetailView';
import { validateOrder } from '../src/server/business';
import { enforceWorkflowUpdate } from '../src/server/orderWorkflow';
import { mapOrder } from '../src/server/orders';
import type { Order } from '../src/types';
import { ORDER_STATUS_LABELS } from '../src/utils/orderStatusRules';

const row = { id: 1, order_code: 'TEST', created_at: new Date(), status: 'Cotización', version: 1,
  user_id: 7, customer_id: 1, price: 100, down_payment: 10, core_fee: 0, shipping_cost: 0 } as RowDataPacket;
describe('workflow-controlled order statuses', () => {
  it('never offers the standalone payments button in any order status', () => {
    for (const status of Object.keys(ORDER_STATUS_LABELS) as Order['status'][]) {
      const order = { ...mapOrder(row), status } as Order;
      const html = renderToStaticMarkup(<OrderDetailView order={order} onBack={() => {}} onOpenSMS={() => {}} userRole="admin" />);
      expect(html).not.toContain('Registrar cobro / ver pagos y core');
      expect(html).toContain('Desglose &amp; Liquidación');
    }
  });
  it('offers a separate post-delivery tab only in delivered status and does not mix followup into summary', () => {
    for (const status of Object.keys(ORDER_STATUS_LABELS) as Order['status'][]) {
      const order = { ...mapOrder(row), status, deliveredAt: '2026-11-01T18:00:00.000Z' } as Order;
      const html = renderToStaticMarkup(<OrderDetailView order={order} onBack={() => {}} onOpenSMS={() => {}} userRole="admin" />);
      expect(html.includes('>Seguimiento post entrega</button>'), status).toBe(status === 'entregado');
      expect(html).not.toContain('Registros de contacto post-entrega');
    }
  });
  it('shows inventory availability only for active orders without a physical delivery', () => {
    for (const status of Object.keys(ORDER_STATUS_LABELS) as Order['status'][]) {
      for (const deliveredAt of [undefined, '2026-11-01T18:00:00.000Z']) {
        const order = { ...mapOrder(row), status, deliveredAt } as Order;
        const html = renderToStaticMarkup(<OrderDetailView order={order} onBack={() => {}} onOpenSMS={() => {}} userRole="admin" />);
        const active = !['entregado', 'cancelado', 'reembolsado', 'archivado', 'reclamo', 'solicitud_reembolso'].includes(status);
        expect(html.includes('aria-label="Disponibilidad en inventario"'), `${status}, delivered=${Boolean(deliveredAt)}`).toBe(active && !deliveredAt);
        expect(html.includes('>Registrar entrega<')).toBe(active && !deliveredAt);
      }
    }
  });
  it('renders only the current state in a disabled header selector', () => {
    const order = mapOrder(row) as Order;
    const html = renderToStaticMarkup(<OrderDetailView order={order} onBack={() => {}} onOpenSMS={() => {}} userRole="admin" />);
    expect(html).toMatch(/<select[^>]*disabled=""[^>]*aria-label="Estado de orden"|<select[^>]*aria-label="Estado de orden"[^>]*disabled=""/);
    const selector = html.match(/<select[^>]*aria-label="Estado de orden"[\s\S]*?<\/select>/)?.[0] || '';
    expect(selector.match(/<option/g)).toHaveLength(1);
    expect(selector).toContain('Cotización');
  });
  it('rejects generic status changes for every role and retains normal edits', async () => {
    const connection = { query: vi.fn().mockResolvedValue([[], []]), execute: vi.fn() } as unknown as PoolConnection;
    for (const role of ['admin', 'operator', 'vendedor_yarda']) {
      for (const status of ['pagado', 'en_preparacion', 'listo_retiro', 'listo_despacho', 'entregado', 'cotizacion']) {
        await expect(enforceWorkflowUpdate(connection, { ...row, status: 'En Espera Confirmación' } as RowDataPacket,
          { status }, { sub: '7', role })).rejects.toThrow(/flujo/);
      }
    }
    await expect(enforceWorkflowUpdate(connection, row, { status: 'cotizacion' })).resolves.toBeUndefined();
    expect(connection.execute).not.toHaveBeenCalled();
  });
  it('requires every newly-created order to start at quotation even when an advance exists', () => {
    const payload = { status: 'cotizacion' as const, mainPart: 'Test part', customer: { name: 'Test customer' }, vehicle: {}, financials: { partPrice: 100, downPayment: 10 } };
    expect(() => validateOrder(payload)).not.toThrow();
    for (const status of ['pagado', 'listo_retiro', 'entregado'] as const) {
      expect(() => validateOrder({ ...payload, status })).toThrow(/Cotización/);
    }
  });
});
