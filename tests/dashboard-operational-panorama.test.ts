import { describe, it, expect } from 'vitest';
import {
  getWeekRange,
  getMonthRange,
  getYearRange,
  parseOrderDate,
} from '../src/components/DashboardView';
import { Order } from '../src/types';

describe('Panorama Operativo & Finanzas - Dashboard Period & Analytics', () => {
  it('getWeekRange computes exact Monday 00:00:00 to Sunday 23:59:59 bounds for current and offset weeks', () => {
    const currentWeek = getWeekRange(0);

    // Monday is getDay() === 1
    expect(currentWeek.start.getDay()).toBe(1);
    expect(currentWeek.start.getHours()).toBe(0);
    expect(currentWeek.start.getMinutes()).toBe(0);
    expect(currentWeek.start.getSeconds()).toBe(0);

    // Sunday is getDay() === 0
    expect(currentWeek.end.getDay()).toBe(0);
    expect(currentWeek.end.getHours()).toBe(23);
    expect(currentWeek.end.getMinutes()).toBe(59);
    expect(currentWeek.end.getSeconds()).toBe(59);

    // Difference between Sunday and Monday is 6 full days (start of Monday to end of Sunday)
    const spanMs = currentWeek.end.getTime() - currentWeek.start.getTime();
    expect(spanMs).toBeGreaterThan(6 * 86400000);
    expect(spanMs).toBeLessThanOrEqual(7 * 86400000);

    // Previous week offset
    const prevWeek = getWeekRange(-1);
    const sevenDaysMs = 7 * 86400000;
    expect(currentWeek.start.getTime() - prevWeek.start.getTime()).toBe(sevenDaysMs);
  });

  it('getMonthRange computes start of month to end of month bounds', () => {
    const currentMonth = getMonthRange(0);
    expect(currentMonth.start.getDate()).toBe(1);
    expect(currentMonth.start.getHours()).toBe(0);

    expect(currentMonth.end.getHours()).toBe(23);
    expect(currentMonth.end.getMinutes()).toBe(59);
    expect(currentMonth.end.getSeconds()).toBe(59);

    // Next month check
    const nextMonth = getMonthRange(1);
    expect(nextMonth.start.getDate()).toBe(1);
  });

  it('getYearRange computes Jan 1 to Dec 31 bounds', () => {
    const currentYear = getYearRange(0);
    const thisYear = new Date().getFullYear();

    expect(currentYear.year).toBe(thisYear);
    expect(currentYear.start.getFullYear()).toBe(thisYear);
    expect(currentYear.start.getMonth()).toBe(0); // January
    expect(currentYear.start.getDate()).toBe(1);

    expect(currentYear.end.getFullYear()).toBe(thisYear);
    expect(currentYear.end.getMonth()).toBe(11); // December
    expect(currentYear.end.getDate()).toBe(31);
    expect(currentYear.end.getHours()).toBe(23);
    expect(currentYear.end.getMinutes()).toBe(59);
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
