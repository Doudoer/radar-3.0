import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getWeekRange,
  getMonthRange,
  getYearRange,
  parseOrderDate,
} from '../src/components/DashboardView';
import { Order } from '../src/types';
import { financeDateKey } from '../src/utils/finance';

afterEach(() => vi.useRealTimers());

describe('Panorama Operativo & Finanzas - Dashboard Period & Analytics', () => {
  it('getWeekRange computes exact Monday 00:00:00 to Sunday 23:59:59 bounds for current and offset weeks', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
    const currentWeek = getWeekRange(0);
    expect(currentWeek.start.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(currentWeek.end.toISOString()).toBe('2026-11-09T04:59:59.999Z');
    expect(financeDateKey(currentWeek.start)).toBe('2026-11-02');
    expect(financeDateKey(currentWeek.end)).toBe('2026-11-08');
    const prevWeek = getWeekRange(-1);
    expect(prevWeek.start.toISOString()).toBe('2026-10-26T04:00:00.000Z');
    expect(prevWeek.end.toISOString()).toBe('2026-11-02T04:59:59.999Z');
    expect(currentWeek.start.getTime() - prevWeek.start.getTime()).toBe(169 * 3600000);
  });

  it('getMonthRange computes start of month to end of month bounds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
    const currentMonth = getMonthRange(0);
    expect(currentMonth.start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(currentMonth.end.toISOString()).toBe('2026-12-01T04:59:59.999Z');
    const nextMonth = getMonthRange(1);
    expect(nextMonth.start.toISOString()).toBe('2026-12-01T05:00:00.000Z');
    expect(nextMonth.end.toISOString()).toBe('2027-01-01T04:59:59.999Z');
  });

  it('getYearRange computes Jan 1 to Dec 31 bounds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
    const currentYear = getYearRange(0);
    expect(currentYear.year).toBe(2026);
    expect(currentYear.start.toISOString()).toBe('2026-01-01T05:00:00.000Z');
    expect(currentYear.end.toISOString()).toBe('2027-01-01T04:59:59.999Z');
  });

  it('parseOrderDate handles various date formats accurately', () => {
    // ISO format
    const orderIso: Partial<Order> = {
      createdAtIso: '2026-10-12T10:30:00.000Z',
    };
    const parsedIso = parseOrderDate(orderIso as Order);
    expect(parsedIso).not.toBeNull();
    expect(parsedIso!.toISOString()).toBe('2026-10-12T10:30:00.000Z');

    // Slash format DD/MM/YYYY
    const orderSlash: Partial<Order> = {
      createdAt: '12/10/2026, 14:15',
    };
    const parsedSlash = parseOrderDate(orderSlash as Order);
    expect(parsedSlash).not.toBeNull();
    expect(parsedSlash!.getFullYear()).toBe(2026);
    expect(parsedSlash!.getMonth()).toBe(9); // October (0-indexed)
    expect(parsedSlash!.getDate()).toBe(12);

    // Hoy
    const orderHoy: Partial<Order> = {
      createdAt: 'Hoy, 09:00',
    };
    const parsedHoy = parseOrderDate(orderHoy as Order);
    const today = new Date();
    expect(parsedHoy).not.toBeNull();
    expect(parsedHoy!.getDate()).toBe(today.getDate());
    expect(parsedHoy!.getMonth()).toBe(today.getMonth());

    // Spanish text
    const orderSpanish: Partial<Order> = {
      createdAt: '12 oct 2026',
    };
    const parsedSpanish = parseOrderDate(orderSpanish as Order);
    expect(parsedSpanish).not.toBeNull();
    expect(parsedSpanish!.getDate()).toBe(12);
    expect(parsedSpanish!.getMonth()).toBe(9);
    expect(parsedSpanish!.getFullYear()).toBe(2026);
  });

  it('filters orders strictly within the operative week range', () => {
    const currentWeek = getWeekRange(0);
    const monday = currentWeek.start;

    // Create an order right in the middle of current week (Wednesday)
    const midWeekDate = new Date(monday.getTime() + 2 * 86400000 + 3600000); // Wednesday 01:00
    const inWeekOrder: Partial<Order> = {
      id: 'ORD-CURRENT',
      createdAtIso: midWeekDate.toISOString(),
      status: 'pagado',
      financials: { total: 1500, subtotal: 1500, partPrice: 1500 },
    };

    // Create an order 3 weeks ago
    const threeWeeksAgo = new Date(monday.getTime() - 21 * 86400000);
    const oldOrder: Partial<Order> = {
      id: 'ORD-OLD',
      createdAtIso: threeWeeksAgo.toISOString(),
      status: 'pagado',
      financials: { total: 2000, subtotal: 2000, partPrice: 2000 },
    };

    const orders = [inWeekOrder as Order, oldOrder as Order];

    const filtered = orders.filter((o) => {
      const d = parseOrderDate(o);
      return d && d >= currentWeek.start && d <= currentWeek.end;
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('ORD-CURRENT');
  });
});
