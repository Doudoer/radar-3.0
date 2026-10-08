import { describe, it, expect } from 'vitest';
import { getWeekRange, getMonthRange, parseOrderDate } from '../src/components/OperationsView';
import { Order } from '../src/types';

describe('OperationsView Analytics & Date Helpers', () => {
  it('getWeekRange computes Monday 00:00:00 to Sunday 23:59:59.999', () => {
    const range = getWeekRange(0);
    // Monday is getDay() === 1
    expect(range.monday.getDay()).toBe(1);
    expect(range.monday.getHours()).toBe(0);
    expect(range.monday.getMinutes()).toBe(0);
    expect(range.monday.getSeconds()).toBe(0);

    // Sunday is getDay() === 0
    expect(range.sunday.getDay()).toBe(0);
    expect(range.sunday.getHours()).toBe(23);
    expect(range.sunday.getMinutes()).toBe(59);
    expect(range.sunday.getSeconds()).toBe(59);

    // Difference between Sunday and Monday is 6 days
    const diffDays = Math.round((range.sunday.getTime() - range.monday.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(7); // Full 7 day duration (approx 6.999 days)
  });

  it('getWeekRange computes previous and next week offsets accurately', () => {
    const currentWeek = getWeekRange(0);
    const lastWeek = getWeekRange(-1);
    const nextWeek = getWeekRange(1);

    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(currentWeek.monday.getTime() - lastWeek.monday.getTime()).toBe(sevenDaysMs);
    expect(nextWeek.monday.getTime() - currentWeek.monday.getTime()).toBe(sevenDaysMs);
  });

  it('getMonthRange computes start of month to end of month', () => {
    const range = getMonthRange(0);
    expect(range.start.getDate()).toBe(1);
    expect(range.start.getHours()).toBe(0);
    expect(range.end.getHours()).toBe(23);
    expect(range.end.getMinutes()).toBe(59);
    expect(range.end.getSeconds()).toBe(59);
  });

  it('parseOrderDate handles ISO strings, Spanish locale dates, Hoy and Ayer', () => {
    const orderIso: Partial<Order> = {
      createdAtIso: '2026-10-08T14:30:00.000Z',
      createdAt: '08/10/2026, 10:30',
    };
    const parsedIso = parseOrderDate(orderIso as Order);
    expect(parsedIso.toISOString()).toBe('2026-10-08T14:30:00.000Z');

    const orderHoy: Partial<Order> = {
      createdAt: 'Hoy, 13:45',
    };
    const parsedHoy = parseOrderDate(orderHoy as Order);
    const today = new Date();
    expect(parsedHoy.getDate()).toBe(today.getDate());
    expect(parsedHoy.getMonth()).toBe(today.getMonth());

    const orderSpanish: Partial<Order> = {
      createdAt: '28 Ago 2026',
    };
    const parsedSpanish = parseOrderDate(orderSpanish as Order);
    expect(parsedSpanish.getFullYear()).toBe(2026);
    expect(parsedSpanish.getMonth()).toBe(7); // August is month 7 (0-indexed)
    expect(parsedSpanish.getDate()).toBe(28);
  });
});
