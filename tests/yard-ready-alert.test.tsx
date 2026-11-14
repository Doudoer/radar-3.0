import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { YardReadyAlertBar } from '../src/components/YardReadyAlertBar';
import { OrderDetailView } from '../src/components/OrderDetailView';
import { mapOrder } from '../src/server/orders';
import { formatYardReadyElapsed, canManageYardAlert, isClaimPieceReadyAlert, isYardReadyAlert, isYardReadyUrgent, yardReadyAgeMinutes } from '../src/utils/yardAlerts';
import type { Order } from '../src/types';

const now = Date.parse('2026-11-12T18:00:00.000Z');
const order = (overrides: Partial<Order> = {}) => ({
  id: 'ORD-901',
  code: 'ORD-901',
  status: 'pagado',
  customer: { name: 'Ana Torres' },
  yardPieceReady: true,
  yardPieceReadyAt: '2026-11-12T17:40:00.000Z',
  ...overrides,
} as Order);

describe('yard ready alerts', () => {
  it('only flags paid or in-preparation orders that the yard marked ready', () => {
    expect(isYardReadyAlert(order())).toBe(true);
    expect(isYardReadyAlert(order({ status: 'en_preparacion' }))).toBe(true);
    expect(isYardReadyAlert(order({ status: 'entregado' }))).toBe(false);
    expect(isYardReadyAlert(order({ yardPieceReady: false }))).toBe(false);
  });

  it('keeps the alert until the order leaves paid or preparation, ignoring acknowledgement', () => {
    expect(isYardReadyAlert(order({ yardPieceReadyAckAt: '2026-11-12T17:50:00.000Z' }))).toBe(true);
    expect(isYardReadyAlert(order({ status: 'listo_retiro' }))).toBe(false);
  });

  it('computes elapsed time and escalates after fifteen minutes', () => {
    expect(yardReadyAgeMinutes(order(), now)).toBe(20);
    expect(formatYardReadyElapsed(20)).toBe('hace 20 min');
    expect(formatYardReadyElapsed(90)).toBe('hace 1 h');
    expect(isYardReadyUrgent(20)).toBe(true);
    expect(isYardReadyUrgent(14)).toBe(false);
    expect(yardReadyAgeMinutes(order({ yardPieceReadyAt: undefined }), now)).toBeNull();
  });

  it('renders a large persistent alert with the oldest order and urgent styling', () => {
    const html = renderToStaticMarkup(
      <YardReadyAlertBar alerts={[order()]} now={now} onOpenOrder={() => undefined} onNotifyCustomer={() => undefined} />
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('PIEZA LISTA EN YARDA');
    expect(html).toContain('#ORD-901');
    expect(html).toContain('Ana Torres');
    expect(html).toContain('ATENCIÓN');
    expect(html).toContain('hace 20 min');
  });

  it('offers the notification CTA that moves the order to Listo para Retiro', () => {
    const html = renderToStaticMarkup(
      <YardReadyAlertBar alerts={[order()]} now={now} onOpenOrder={() => undefined} onNotifyCustomer={() => undefined} />
    );
    expect(html).toContain('Notificar cliente');
    expect(html).toContain('pasar a Listo para Retiro');
    expect(html).not.toContain('Ya la tomé');
  });

  it('shows the oldest pending order first and renders nothing without alerts', () => {
    const html = renderToStaticMarkup(
      <YardReadyAlertBar
        alerts={[order({ id: 'ORD-2', code: 'ORD-2', yardPieceReadyAt: '2026-11-12T17:55:00.000Z' }), order()]}
        now={now}
        onOpenOrder={() => undefined}
        onNotifyCustomer={() => undefined}
      />
    );
    expect(html).toContain('2 PIEZAS LISTAS EN YARDA');
    expect(html).toContain('#ORD-901');
    expect(html).not.toContain('ORD-2');
    expect(renderToStaticMarkup(
      <YardReadyAlertBar alerts={[]} now={now} onOpenOrder={() => undefined} onNotifyCustomer={() => undefined} />
    )).toBe('');
  });

  it('uses dispatch wording when the order ships to the customer', () => {
    const html = renderToStaticMarkup(
      <YardReadyAlertBar
        alerts={[order({ deliveryType: 'envio_domicilio' })]}
        now={now}
        onOpenOrder={() => undefined}
        onNotifyCustomer={() => undefined}
      />
    );
    expect(html).toContain('pasar a Listo para Despacho');
    expect(html).not.toContain('pasar a Listo para Retiro');
  });

  it('flags claim replacement pieces ready in the yard only for open claims', () => {
    const claim = order({ status: 'reclamo', claimPieceReady: true, claimPieceReadyAt: '2026-11-11T09:00:00.000Z' });
    expect(isClaimPieceReadyAlert(claim)).toBe(true);
    expect(isClaimPieceReadyAlert(order({ claimPieceReady: true }))).toBe(false);
    expect(isClaimPieceReadyAlert(order({ status: 'reclamo', claimPieceReady: false }))).toBe(false);
  });

  it('only surfaces alerts the viewer can act on, keeping unassigned ones for admins', () => {
    expect(canManageYardAlert(order({ userId: 5 }), 'operator', 5)).toBe(true);
    expect(canManageYardAlert(order({ userId: 5 }), 'operator', 6)).toBe(false);
    expect(canManageYardAlert(order({ userId: undefined }), 'operator', 5)).toBe(false);
    expect(canManageYardAlert(order({ userId: undefined }), 'admin', 5)).toBe(true);
    expect(canManageYardAlert(order({ userId: 5 }), 'admin', 5)).toBe(true);
  });

  it('renders the claim variant with the claim CTA instead of the sale CTA', () => {
    const html = renderToStaticMarkup(
      <YardReadyAlertBar
        variant="claim"
        alerts={[order({ status: 'reclamo', claimPieceReady: true, claimPieceReadyAt: '2026-11-12T17:40:00.000Z' })]}
        now={now}
        onOpenOrder={() => undefined}
        onNotifyCustomer={() => undefined}
      />
    );
    expect(html).toContain('data-testid="claim-ready-alert-bar"');
    expect(html).toContain('PIEZA DE RECLAMO LISTA EN YARDA');
    expect(html).toContain('Atender');
    expect(html).toContain('reclamo');
    expect(html).not.toContain('PIEZA LISTA EN YARDA');
    expect(html).not.toContain('pasar a Listo para');
  });

  it('shows dispatch wording in the order detail alert for shipped orders', () => {
    const shipped = mapOrder({
      id: 901,
      order_code: 'ORD-901',
      created_at: '2026-11-10T16:00:00Z',
      status: 'Pagado',
      product_type: 'Motor',
      shipping_toggle: 1,
      yard_piece_ready: 1,
      yard_piece_ready_at: '2026-11-12T17:40:00Z',
      first_name: 'Ana',
      last_name: 'Torres',
    } as never);
    const html = renderToStaticMarkup(
      <OrderDetailView order={shipped as Order} onBack={() => undefined} onOpenSMS={() => undefined} userRole="admin" />
    );
    expect(html).toContain('pasar la orden a <strong>Listo para Despacho</strong>');
    expect(html).toContain('Notificar cliente y pasar a Listo para Despacho');
  });
});
