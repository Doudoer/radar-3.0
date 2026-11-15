import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  formatLempiras,
  isoDateInTimeZone,
  recentWeeks,
  roundMoney,
  summarizeWeek,
  weekFor,
  weekStartForIso,
} from '../src/utils/payroll';

describe('payroll week windows', () => {
  it('resolves the Honduras calendar date across the UTC boundary', () => {
    expect(isoDateInTimeZone(new Date('2026-11-15T03:30:00Z'))).toBe('2026-11-14');
    expect(isoDateInTimeZone(new Date('2026-11-15T06:30:00Z'))).toBe('2026-11-15');
  });

  it('starts weeks on Monday and keeps Sunday in the same week', () => {
    expect(weekStartForIso('2026-11-14')).toBe('2026-11-09');
    expect(weekStartForIso('2026-11-15')).toBe('2026-11-09');
    expect(weekStartForIso('2026-11-16')).toBe('2026-11-16');
    expect(weekStartForIso('2026-11-09')).toBe('2026-11-09');
  });

  it('labels same-month and cross-month weeks in Spanish', () => {
    const sameMonth = weekFor(new Date('2026-11-14T18:00:00Z'));
    expect(sameMonth).toEqual({ start: '2026-11-09', end: '2026-11-15', label: '9 – 15 nov 2026' });
    const crossMonth = weekFor(new Date('2026-12-02T18:00:00Z'));
    expect(crossMonth.start).toBe('2026-11-30');
    expect(crossMonth.end).toBe('2026-12-06');
    expect(crossMonth.label).toBe('30 nov – 6 dic 2026');
  });

  it('lists recent weeks newest first without gaps', () => {
    const weeks = recentWeeks(3, new Date('2026-11-14T18:00:00Z'));
    expect(weeks.map((week) => week.start)).toEqual(['2026-11-09', '2026-11-02', '2026-10-26']);
    expect(weeks[0].end).toBe('2026-11-15');
    expect(addDaysIso('2026-11-15', 1)).toBe('2026-11-16');
  });
});

describe('weekly payroll summary', () => {
  const week = { start: '2026-11-09', end: '2026-11-15', label: '9 – 15 nov 2026' };

  it('deducts only faults inside the week and totals points', () => {
    const summary = summarizeWeek(3500, [
      { faultDate: '2026-11-10', amount: 150, points: 5 },
      { faultDate: '2026-11-15', amount: 300, points: 20 },
      { faultDate: '2026-11-16', amount: 999, points: 99 },
      { faultDate: '2026-11-08', amount: 999, points: 99 },
    ], week);
    expect(summary.gross).toBe(3500);
    expect(summary.deductions).toBe(450);
    expect(summary.points).toBe(25);
    expect(summary.faultCount).toBe(2);
    expect(summary.net).toBe(3050);
  });

  it('handles unset salary and money rounding', () => {
    const summary = summarizeWeek(null, [
      { faultDate: '2026-11-10', amount: 0.1, points: 1 },
      { faultDate: '2026-11-11', amount: 0.2, points: 1 },
    ], week);
    expect(summary.gross).toBe(0);
    expect(summary.deductions).toBe(0.3);
    expect(summary.net).toBe(-0.3);
    expect(roundMoney(1.005)).toBe(1.01);
  });

  it('formats lempiras with two decimals and a sign', () => {
    expect(formatLempiras(1500)).toBe('L 1,500.00');
    expect(formatLempiras(0)).toBe('L 0.00');
    expect(formatLempiras(-250.5)).toBe('-L 250.50');
    expect(formatLempiras(Number.NaN)).toBe('L 0.00');
  });
});
