import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Order } from '../src/types';
import { DashboardView } from '../src/components/DashboardView';
import { OperationsView } from '../src/components/OperationsView';
import { useFinanceMovements } from '../src/hooks/useFinanceState';
import { movementIncome, movementsInPeriod, sumMoney } from '../src/utils/finance';
import {
  getWeekRange, operationalDistribution, orderSaleTotal, orderCollection, orderBalance,
  matchesOrderAdvisor, saleStatuses, quoteStatuses, scaleNetBars,
} from '../src/utils/orderAnalytics';

vi.mock('../src/hooks/useFinanceState', () => ({ useFinanceMovements: vi.fn() }));
const movementMock = vi.mocked(useFinanceMovements);
const makeOrder = (status: Order['status'], financials: Partial<Order['financials']> = {}): Order => ({
  id: status, status, code: status, createdAt: '02 nov 2026', createdAtIso: '2026-11-02T12:00:00Z',
  advisor: 'Carlos', userId: 7, mainPart: 'Motor', workflowStep: 1,
  customer: { name: 'Cliente de prueba', phone: '5551234567', initials: 'CP', type: 'Particular' },
  vehicle: { year: 2020, make: 'Ford', model: 'F150', vin: '', plate: '' },
  financials: { total: 130.45, subtotal: 130.45, partPrice: 100, deliveryFee: 20, coreFee: 10.45, ...financials },
} as Order);
const renderDashboard = (orders: Order[] = []) => renderToStaticMarkup(
  <DashboardView orders={orders} activities={[]} onSelectOrder={vi.fn()} onNavigateTaller={vi.fn()} />
);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
  movementMock.mockReturnValue({ movements: [], loaded: true, error: null, refresh: vi.fn() });
});
afterEach(() => vi.useRealTimers());

describe('verified operational analytics', () => {
  it('renders six compact Horizon statistics with labels, values and operational context', () => {
    const html = renderDashboard([makeOrder('en_preparacion')]);
    expect(html.match(/class="horizon-stat-icon"/g)).toHaveLength(6);
    expect(html.match(/class="horizon-stat-value"/g)).toHaveLength(6);
    expect(html).toContain('aria-label="Órdenes Operativas"');
    expect(html).toContain('1 activas en taller / proceso');
    expect(html).toContain('Pagos − reembolsos por fecha efectiva');
  });
  it('matches the Main Dashboard modules without inserting demonstration data', () => {
    const html = renderDashboard([makeOrder('en_preparacion')]);
    expect(html).toContain('aria-label="Ingresos netos acumulados"');
    expect(html).toContain('aria-label="Órdenes del período"');
    expect(html).toContain('horizon-distribution-pie');
    expect(html).toContain('Ford F150');
    expect(html).not.toContain('Horizon UI PRO');
  });
  it('plots the cumulative net amount from dated payments and refunds only', () => {
    movementMock.mockReturnValue({
      movements: [
        { id: 1, orderId: 'old', kind: 'payment', amount: 200.15, effectiveAt: '2026-11-02T12:00:00Z', source: 'order_payment' },
        { id: 2, orderId: 'old', kind: 'refund', amount: 50.10, effectiveAt: '2026-11-03T12:00:00Z', source: 'refund' },
      ],
      loaded: true, error: null, refresh: vi.fn(),
    });
    const html = renderDashboard();
    expect(html).toContain('Lunes 02 de nov: $200.15 acumulados');
    expect(html).toContain('Martes 03 de nov: $150.05 acumulados');
    expect(html).toContain('Domingo 08 de nov: $150.05 acumulados');
    expect(html).toContain('polyline');
    expect(html).not.toContain('NaN');
  });
  it('counts each order exactly once including archives and unknown historical statuses', () => {
    const orders = [
      makeOrder('en_preparacion'), makeOrder('entregado'), makeOrder('pagado'),
      makeOrder('cotizacion'), makeOrder('espera_confirmacion'),
      makeOrder('reclamo'), makeOrder('reembolsado'), makeOrder('cancelado'),
      makeOrder('archivado'), { status: 'actualizacion' },
    ];
    const distribution = operationalDistribution(orders);
    expect(distribution.map(category => category.count)).toEqual([1, 2, 2, 3, 2]);
    expect(distribution.reduce((sum, category) => sum + category.count, 0)).toBe(orders.length);
    expect(distribution.reduce((sum, category) => sum + category.percentage, 0)).toBeCloseTo(100, 8);
    expect(operationalDistribution([]).every(category => category.percentage === 0)).toBe(true);
  });

  it('does not count pending quotes, claims, refunds or archived orders as sales', () => {
    for (const status of ['espera_confirmacion', 'cotizacion', 'reclamo', 'solicitud_reembolso', 'reembolsado', 'cancelado', 'archivado']) {
      expect(saleStatuses.has(status)).toBe(false);
    }
    expect(quoteStatuses.has('espera_confirmacion')).toBe(true);
    expect(saleStatuses.has('entregado')).toBe(true);
    expect(saleStatuses.has('en_preparacion')).toBe(true);
  });

  it('uses full commercial totals and preserves explicit zero payments and balances', () => {
    const order = makeOrder('pagado', { downPayment: 0, advancePayment: 90, balanceDue: 0 });
    expect(orderSaleTotal(order)).toBe(130.45);
    expect(orderCollection(order)).toBe(0);
    expect(orderBalance(order)).toBe(0);
    expect(orderBalance(makeOrder('pagado', { downPayment: 30.15 }))).toBe(100.30);
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
  });

  it('uses authoritative operator IDs, exact legacy names, and never assigns unowned orders arbitrarily', () => {
    const order = { ...makeOrder('pagado'), userId: 7, advisor: 'Carlos' };
    expect(matchesOrderAdvisor(order, '7', 'Otro nombre')).toBe(true);
    expect(matchesOrderAdvisor(order, '8', 'Carlos')).toBe(false);
    expect(matchesOrderAdvisor({ ...order, userId: undefined, advisor: ' Carlos ' }, '7', 'carlos')).toBe(true);
    expect(matchesOrderAdvisor({ ...order, userId: undefined, advisor: 'Carlos Alberto' }, '7', 'Carlos')).toBe(false);
    expect(matchesOrderAdvisor({ ...order, userId: undefined, advisor: 'Sin asignar' }, '7', 'Carlos')).toBe(false);
  });

  it('keeps Operations cards and sales tables consistent with the full order totals and selected operator', () => {
    const orders = [
      makeOrder('pagado', { downPayment: 0, advancePayment: 90 }),
      makeOrder('entregado', { total: 230.55, downPayment: 30.15 }),
      makeOrder('espera_confirmacion', { total: 900 }),
      makeOrder('reembolsado', { total: 800 }),
      { ...makeOrder('pagado', { total: 700 }), id: 'other-advisor', userId: 8 },
    ];
    const html = renderToStaticMarkup(<OperationsView orders={orders} currentUser={{ id: 7, name: 'Carlos', role: 'operador' }} userRole="operador" />);
    expect(html).toContain('$361.00');
    expect(html).toContain('$180.50');
    expect(html).toContain('$30.15');
    expect(html).toContain('$330.85');
    expect(html).not.toContain('Facturación Ventas');
    expect(html).toContain('Abonos acumulados');
    expect(html).toContain('Acumulado de estas órdenes');
  });

  it('scales positive, negative and zero bars by absolute magnitude without fictitious minimums', () => {
    expect(scaleNetBars([{ rawAmount: 100 }, { rawAmount: -50 }, { rawAmount: 0 }]).map(bar => bar.height))
      .toEqual(['100%', '50%', '0%']);
    expect(scaleNetBars([{ rawAmount: -200 }, { rawAmount: 100 }]).map(bar => bar.height)).toEqual(['100%', '50%']);
    expect(scaleNetBars([{ rawAmount: 0 }])[0].height).toBe('0%');
  });

  it('separates gross collections from net income using payment dates, not order creation dates', () => {
    const movements = [
      { id: 1, orderId: 'old-order', kind: 'payment' as const, amount: 100.25, effectiveAt: '2026-11-02T12:00:00Z', source: 'order_payment' },
      { id: 2, orderId: 'old-order', kind: 'refund' as const, amount: 40.10, effectiveAt: '2026-11-02T12:30:00Z', source: 'refund' },
      { id: 3, orderId: 'legacy', kind: 'payment' as const, amount: 500, effectiveAt: '2026-11-02T12:00:00Z', source: 'legacy_baseline' },
      { id: 4, orderId: 'outside', kind: 'payment' as const, amount: 700, effectiveAt: '2026-11-02T04:59:59Z', source: 'order_payment' },
    ];
    expect(movementIncome(movementsInPeriod(movements, getWeekRange()))).toBe(60.15);
    movementMock.mockReturnValue({ movements, loaded: true, error: null, refresh: vi.fn() });
    const html = renderDashboard();
    expect(html).toContain('$60.15');
    expect(html).toContain('$100.25');
    expect(html).toContain('Lunes 02 de nov: $60.15');
    expect(html).not.toContain('$500.00');
    expect(html).toContain('Cobros del período');
    expect(html).not.toContain('Cobranza &amp; Abonos');
  });

  it('renders negative amounts below a zero axis and keeps cent precision accessible', () => {
    movementMock.mockReturnValue({
      movements: [{ id: 1, orderId: 'old', kind: 'refund', amount: 125.57, effectiveAt: '2026-11-02T12:00:00Z', source: 'refund' }],
      loaded: true, error: null, refresh: vi.fn(),
    });
    const html = renderDashboard();
    expect(html).toContain('$-125.57');
    expect(html).toContain('top:50%');
    expect(html).toContain('height:50%');
    expect(html).toContain('bg-rose-500');
  });

  it('shows no fabricated bars for empty periods and preserves the vault lock error', () => {
    expect(renderDashboard()).toContain('Sin ingresos netos registrados');
    movementMock.mockReturnValue({ movements: [], loaded: false, error: 'Bóveda bloqueada', refresh: vi.fn() });
    const html = renderDashboard();
    expect(html).toContain('No disponible');
    expect(html).toContain('Bóveda bloqueada');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('Sin ingresos netos registrados');
  });
});
