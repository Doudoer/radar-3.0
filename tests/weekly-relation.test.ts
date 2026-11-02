import { describe, expect, it } from 'vitest';
import {
  OfficeEmployee, RecurringExpense, getMonthlyRecurringDueWeek,
  getWeekRange, isRecurringExpenseDueInWeek,
} from '../src/components/WeeklyRelationView';
import { commissionAmount, financeDateKey, sumMoney } from '../src/utils/finance';
import type { Order } from '../src/types';

describe('Weekly relation financial engine', () => {
  it('sorts salaries highest to lowest and sums payroll in cents', () => {
    const employees: OfficeEmployee[] = [
      { id: '1', name: 'A', weeklySalary: 50 },
      { id: '2', name: 'B', weeklySalary: 90 },
      { id: '3', name: 'C', weeklySalary: 75 },
      { id: '4', name: 'D', weeklySalary: 150 },
      { id: '5', name: 'E', weeklySalary: 120 },
      { id: '6', name: 'F', weeklySalary: 75 },
      { id: '7', name: 'G', weeklySalary: 75 },
      { id: '8', name: 'H', weeklySalary: 75 },
    ];
    const sorted = [...employees].sort((a, b) => b.weeklySalary - a.weeklySalary);
    expect(sorted.map((employee) => employee.weeklySalary)).toEqual([150, 120, 90, 75, 75, 75, 75, 50]);
    expect(sumMoney(employees.map((employee) => employee.weeklySalary))).toBe(710);
    expect(commissionAmount([{ status: 'entregado', financials: { partPrice: 12500, total: 13000 } } as Order])).toBe(250);
  });
});

describe('Recurring expenses use New York calendar weeks', () => {
  it.each([
    { year: 2026, month: 9, day: 30, due: '2026-10-30', start: '2026-10-19T04:00:00.000Z', end: '2026-10-26T03:59:59.999Z', advanced: true },
    { year: 2026, month: 9, day: 31, due: '2026-10-31', start: '2026-10-19T04:00:00.000Z', end: '2026-10-26T03:59:59.999Z', advanced: true },
    { year: 2026, month: 4, day: 31, due: '2026-05-31', start: '2026-05-18T04:00:00.000Z', end: '2026-05-25T03:59:59.999Z', advanced: true },
    { year: 2026, month: 5, day: 30, due: '2026-06-30', start: '2026-06-29T04:00:00.000Z', end: '2026-07-06T03:59:59.999Z', advanced: false },
    { year: 2026, month: 1, day: 30, due: '2026-02-28', start: '2026-02-16T05:00:00.000Z', end: '2026-02-23T04:59:59.999Z', advanced: true },
  ])('clamps/advances due date $due into its exact Monday–Sunday week', ({ year, month, day, due, start, end, advanced }) => {
    const result = getMonthlyRecurringDueWeek(year, month, day, true);
    expect(financeDateKey(result.rawDueDate)).toBe(due);
    expect(result.wasAdvanced).toBe(advanced);
    expect(result.start.toISOString()).toBe(start);
    expect(result.end.toISOString()).toBe(end);
    expect(new Date(`${financeDateKey(result.start)}T12:00:00Z`).getUTCDay()).toBe(1);
    expect(new Date(`${financeDateKey(result.end)}T12:00:00Z`).getUTCDay()).toBe(0);
  });

  it('does not anticipate a Friday when anticipation is explicitly disabled', () => {
    const result = getMonthlyRecurringDueWeek(2026, 9, 30, false);
    expect(result.wasAdvanced).toBe(false);
    expect(result.start.toISOString()).toBe('2026-10-26T04:00:00.000Z');
    expect(result.end.toISOString()).toBe('2026-11-02T04:59:59.999Z');
  });

  it('evaluates weekly, monthly and paused rules against the selected week', () => {
    const weekly: RecurringExpense = {
      id: 'weekly', name: 'Payroll', category: 'Nómina / Pago de Empleados',
      amount: 710, frequency: 'weekly', active: true, paymentMethod: 'Transferencia',
    };
    const monthly: RecurringExpense = {
      id: 'monthly', name: 'Rent', category: 'Alquiler de Oficina / Patio', amount: 350,
      frequency: 'monthly', monthlyDay: 30, advanceIfWeekend: true, active: true, paymentMethod: 'Transferencia',
    };
    const target = getWeekRange(new Date('2026-10-21T16:00:00Z'));
    expect(isRecurringExpenseDueInWeek(weekly, target)).toBe(true);
    expect(isRecurringExpenseDueInWeek(monthly, target)).toBe(true);
    expect(isRecurringExpenseDueInWeek(monthly, getWeekRange(new Date('2026-10-07T16:00:00Z')))).toBe(false);
    expect(isRecurringExpenseDueInWeek({ ...monthly, active: false }, target)).toBe(false);
  });
});
