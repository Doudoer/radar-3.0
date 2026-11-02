import { afterEach, describe, it, expect, vi } from 'vitest';
import { getWeekRange, getMonthRange, parseOrderDate } from '../src/components/OperationsView';
import { getWeekRange as dashboardWeek, getMonthRange as dashboardMonth } from '../src/components/DashboardView';
import { financeDateKey } from '../src/utils/finance';
import type { Order } from '../src/types';

afterEach(() => vi.useRealTimers());

describe('OperationsView Analytics & Date Helpers', () => {
  it('uses the same exact business-week boundaries as the dashboard across DST', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
    for (const offset of [-1, 0, 1]) {
      const operations = getWeekRange(offset);
      const dashboard = dashboardWeek(offset);
      expect(operations.monday).toEqual(dashboard.start);
      expect(operations.sunday).toEqual(dashboard.end);
    }
    expect(getWeekRange().monday.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(getWeekRange(-1).sunday.toISOString()).toBe('2026-11-02T04:59:59.999Z');
  });

  it('moves months from day one without skipping February on January 31', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-31T12:00:00Z'));
    const february = getMonthRange(1);
    expect(financeDateKey(february.start)).toBe('2026-02-01');
    expect(financeDateKey(february.end)).toBe('2026-02-28');
    expect(february).toEqual(dashboardMonth(1));
  });

  it('parses DD/MM before native date parsing and never replaces invalid dates with today', () => {
    expect(financeDateKey(parseOrderDate({ createdAt: '08/10/2026, 10:30' } as Order)!)).toBe('2026-10-08');
    expect(parseOrderDate({ createdAt: '' } as Order)).toBeNull();
    expect(parseOrderDate({ createdAt: '31/02/2026' } as Order)).toBeNull();
    expect(parseOrderDate({ createdAt: '28 unknown 2026' } as Order)).toBeNull();
  });

  it('resolves relative labels by business date even when UTC is already the following day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-03T02:00:00Z'));
    expect(financeDateKey(parseOrderDate({ createdAt: 'Hoy, 13:45' } as Order)!)).toBe('2026-11-02');
    expect(financeDateKey(parseOrderDate({ createdAt: 'Ayer' } as Order)!)).toBe('2026-11-01');
    expect(financeDateKey(parseOrderDate({ createdAt: '28 Ago 2026' } as Order)!)).toBe('2026-08-28');
  });
});
