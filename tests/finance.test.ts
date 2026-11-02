import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  commissionAmount, commissionBase, financeDateKey, getFinanceWeekRange,
  isInFinancePeriod, movementIncome, movementsInPeriod, parseFinanceDate, sumMoney, toCents,
} from '../src/utils/finance';
import { getMonthlyRecurringDueWeek, isRecurringExpenseDueInWeek } from '../src/components/WeeklyRelationView';
import { InvoiceView } from '../src/components/InvoiceView';
import { InvoiceModal } from '../src/components/InvoiceModal';
import { DispatchLabelView } from '../src/components/DispatchLabelView';
import { DispatchLabelModal } from '../src/components/DispatchLabelModal';
import type { Order } from '../src/types';

const order = (fields: Partial<Order> = {}): Order => ({
  id: 'order-1', code: 'ORD-1', createdAt: '', advisor: 'Agent', status: 'entregado',
  mainPart: 'Pieza', workflowStep: 4, deliveredAt: '2026-11-02T15:00:00Z',
  customer: { id: 'c1', name: 'Cliente', phone: '', email: '', location: '', type: 'Particular', initials: 'C' },
  vehicle: { vin: '', plate: '', make: '', model: '', year: 2020, mileage: '', color: '' },
  financials: { partPrice: 1000, deliveryFee: 200, coreFee: 300, total: 1500, subtotal: 1500 },
  ...fields,
});

describe('finance timezone and integer-cent calculations', () => {
  it('uses the New York week, not the host timezone or UTC Monday', () => {
    const beforeMonday = getFinanceWeekRange(new Date('2026-11-02T04:59:59Z'));
    expect(beforeMonday.start.toISOString()).toBe('2026-10-26T04:00:00.000Z');
    expect(beforeMonday.end.toISOString()).toBe('2026-11-02T04:59:59.999Z');
    const monday = getFinanceWeekRange(new Date('2026-11-02T05:00:00Z'));
    expect(monday.start.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(monday.end.toISOString()).toBe('2026-11-09T04:59:59.999Z');
  });

  it('handles spring DST and selected week offsets with calendar days', () => {
    const range = getFinanceWeekRange(new Date('2026-03-08T12:00:00Z'));
    expect(range.start.toISOString()).toBe('2026-03-02T05:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-03-09T03:59:59.999Z');
    expect(getFinanceWeekRange(new Date('2026-03-09T04:00:00Z'), -1)).toEqual(range);
    expect(isInFinancePeriod('2026-03-09T03:59:59.999Z', range)).toBe(true);
    expect(isInFinancePeriod('2026-03-09T04:00:00Z', range)).toBe(false);
  });

  it('interprets date-only expenses as NY calendar dates and rejects ambiguous or invalid dates', () => {
    expect(parseFinanceDate('2026-11-02')?.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(parseFinanceDate('02/11/2026')?.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    for (const value of ['Hoy', 'not-a-date', '2026-02-30', '2026-99-99', '2026-11-02T15:00:00']) {
      expect(parseFinanceDate(value)).toBeNull();
    }
  });

  it('rounds all amounts to cents before summing and commissions only delivered piece price', () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(toCents(1.005)).toBe(101);
    const orders = [
      order(),
      order({ id: 'yard', isYardSale: true }),
      order({ id: 'yard-role', advisorRole: 'vendedor_yarda' }),
      order({ id: 'pending', status: 'pagado' }),
      order({ id: 'missing-price', financials: { total: 9000, subtotal: 9000 } }),
      order({ id: 'zero', financials: { partPrice: 0, total: 9000, subtotal: 9000 } }),
    ];
    expect(commissionBase(orders)).toBe(1000);
    expect(commissionAmount(orders)).toBe(20);
    expect(commissionAmount([order({ financials: { partPrice: 123.45, total: 200, subtotal: 200 } })])).toBe(2.47);
  });

  it('counts payments/refunds by effective date, not order creation, status or undated legacy balances', () => {
    const range = getFinanceWeekRange(new Date('2026-11-02T12:00:00Z'));
    const movements = [
      { id: 1, orderId: 'old-order', kind: 'payment' as const, amount: 100.1, effectiveAt: '2026-11-02T05:00:00Z', source: 'manual' },
      { id: 2, orderId: 'old-order', kind: 'refund' as const, amount: 25.05, effectiveAt: '2026-11-03T18:00:00Z', source: 'manual' },
      { id: 3, orderId: 'legacy', kind: 'payment' as const, amount: 900, effectiveAt: null, source: 'legacy_baseline' },
      { id: 4, orderId: 'legacy-dated', kind: 'payment' as const, amount: 800, effectiveAt: '2026-11-03T18:00:00Z', source: 'legacy_baseline' },
      { id: 5, orderId: 'previous-week', kind: 'payment' as const, amount: 700, effectiveAt: '2026-11-02T04:59:59Z', source: 'manual' },
    ];
    expect(movementsInPeriod(movements, range).map((movement) => movement.id)).toEqual([1, 2]);
    expect(movementIncome(movementsInPeriod(movements, range))).toBe(75.05);
  });

  it('keeps recurring due weeks in NY across month/year boundaries and weekend anticipation', () => {
    const due = getMonthlyRecurringDueWeek(2026, 9, 30, true);
    expect(financeDateKey(due.start)).toBe('2026-10-19');
    expect(financeDateKey(due.end)).toBe('2026-10-25');
    const rule = { id: 'r1', name: 'Rent', category: 'Alquiler de Oficina / Patio' as const, amount: 50, frequency: 'monthly' as const, monthlyDay: 30, advanceIfWeekend: true, active: true, paymentMethod: 'Transferencia' as const };
    expect(isRecurringExpenseDueInWeek(rule, due)).toBe(true);
    expect(isRecurringExpenseDueInWeek({ ...rule, active: false }, due)).toBe(false);
    expect(isRecurringExpenseDueInWeek(rule, getFinanceWeekRange(new Date('2026-10-26T12:00:00Z')))).toBe(false);
  });
});

describe('documents use registered information only', () => {
  it('does not fabricate company, tax ID, stock, price, dates or warranty in either invoice', () => {
    const missing = order({ financials: {} as Order['financials'] });
    for (const component of [
      React.createElement(InvoiceView, { order: missing, onBack: () => {} }),
      React.createElement(InvoiceModal, { order: missing, isOpen: true, onClose: () => {} }),
    ]) {
      const html = renderToStaticMarkup(component);
      expect(html).toContain('Sin registrar');
      expect(html).not.toContain('STK-2026');
      expect(html).not.toContain('RAP-260925');
      expect(html).not.toContain('$1000.00');
      expect(html).not.toContain('24 Oct 2026');
      expect(html).not.toContain('Monterrey');
    }
  });

  it('uses actual stock and removes simulated barcodes from dispatch labels', () => {
    const registered = order({ stockNumber: 'REAL-STOCK-1', warrantyDays: 90 });
    for (const component of [
      React.createElement(DispatchLabelView, { order: registered, onBack: () => {} }),
      React.createElement(DispatchLabelModal, { order: registered, isOpen: true, onClose: () => {} }),
    ]) {
      const html = renderToStaticMarkup(component);
      expect(html).toContain('REAL-STOCK-1');
      expect(html).toContain('90 DÍAS');
      expect(html).not.toContain('||| | ||||');
      expect(html).not.toContain('STK-2026');
    }
  });
});
