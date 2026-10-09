import { describe, expect, it } from 'vitest';
import {
  OfficeEmployee,
  RecurringExpense,
  getMonthlyRecurringDueWeek,
  getWeekRange,
  isRecurringExpenseDueInWeek,
} from '../src/components/WeeklyRelationView';

describe('Weekly Relation Financial Engine & Salary Sorting', () => {
  it('sorts employee salaries from highest to lowest (de mayor a menor de arriba a abajo)', () => {
    const rawEmployees: OfficeEmployee[] = [
      { id: 'EMP-01', name: 'Juan', weeklySalary: 50.0, role: 'Asesor Saul Motors' },
      { id: 'EMP-02', name: 'Williana', weeklySalary: 90.0, role: 'Asesor Peddle' },
      { id: 'EMP-03', name: 'Maggie', weeklySalary: 75.0, role: 'Asesor Wheelzy' },
      { id: 'EMP-04', name: 'Douglas', weeklySalary: 150.0, role: 'Supervisor' },
      { id: 'EMP-05', name: 'Favio', weeklySalary: 120.0, role: 'Asesor Comercial' },
      { id: 'EMP-06', name: 'Darrel', weeklySalary: 75.0, role: 'Asesor Comercial' },
      { id: 'EMP-07', name: 'Samuel Rincon', weeklySalary: 75.0, role: 'Dispatcher RCAT' },
      { id: 'EMP-08', name: 'Jose Puche', weeklySalary: 75.0, role: 'Marketing' },
    ];

    const sorted = [...rawEmployees].sort((a, b) => b.weeklySalary - a.weeklySalary);

    expect(sorted[0].name).toBe('Douglas');
    expect(sorted[0].weeklySalary).toBe(150.0);

    expect(sorted[1].name).toBe('Favio');
    expect(sorted[1].weeklySalary).toBe(120.0);

    expect(sorted[2].name).toBe('Williana');
    expect(sorted[2].weeklySalary).toBe(90.0);

    // Mid earners at $75
    const mid75 = sorted.filter((e) => e.weeklySalary === 75.0);
    expect(mid75.length).toBe(4);

    // Lowest earner at the bottom
    expect(sorted[sorted.length - 1].name).toBe('Juan');
    expect(sorted[sorted.length - 1].weeklySalary).toBe(50.0);

    // Verify every element is >= the next element
    for (let i = 0; i < sorted.length - 1; i++) {
      expect(sorted[i].weeklySalary).toBeGreaterThanOrEqual(sorted[i + 1].weeklySalary);
    }
  });

  it('calculates the 2% manager commission and total payroll correctly', () => {
    const deliveredTotal = 12500;
    const managerCommission = deliveredTotal * 0.02;
    expect(managerCommission).toBe(250);

    const employees: OfficeEmployee[] = [
      { id: 'EMP-01', name: 'Douglas', weeklySalary: 150.0 },
      { id: 'EMP-02', name: 'Favio', weeklySalary: 120.0 },
      { id: 'EMP-03', name: 'Williana', weeklySalary: 90.0 },
      { id: 'EMP-04', name: 'Maggie', weeklySalary: 75.0 },
    ];

    const totalPayroll = employees.reduce((acc, emp) => acc + emp.weeklySalary, 0);
    expect(totalPayroll).toBe(435);

    const totalOfficialPayout = totalPayroll + managerCommission;
    expect(totalOfficialPayout).toBe(685);
  });
});

describe('Recurring Expenses Due Date & Weekend Anticipation Rules', () => {
  it('advances monthly recurring expense to previous week when due day is Friday (e.g. Oct 30, 2026 is Friday)', () => {
    // October 2026: Month is 9 (0-indexed)
    // Oct 30, 2026 is Friday (getDay() === 5)
    const result = getMonthlyRecurringDueWeek(2026, 9, 30, true);

    expect(result.rawDueDate.getDate()).toBe(30);
    expect(result.rawDueDate.getDay()).toBe(5); // Friday
    expect(result.wasAdvanced).toBe(true);

    // Normal week for Oct 30, 2026 is Oct 26 (Mon) to Nov 1 (Sun)
    // Shifted week is Oct 19 (Mon) to Oct 25 (Sun)
    expect(result.start.getDate()).toBe(19);
    expect(result.start.getMonth()).toBe(9); // October
    expect(result.end.getDate()).toBe(25);
    expect(result.end.getMonth()).toBe(9);
  });

  it('advances monthly recurring expense to previous week when due day is Saturday (e.g. Oct 31, 2026 is Saturday)', () => {
    // Oct 31, 2026 is Saturday (getDay() === 6)
    const result = getMonthlyRecurringDueWeek(2026, 9, 31, true);

    expect(result.rawDueDate.getDate()).toBe(31);
    expect(result.rawDueDate.getDay()).toBe(6); // Saturday
    expect(result.wasAdvanced).toBe(true);

    // Shifted week is Oct 19 (Mon) to Oct 25 (Sun)
    expect(result.start.getDate()).toBe(19);
    expect(result.end.getDate()).toBe(25);
  });

  it('advances monthly recurring expense to previous week when due day is Sunday (e.g. May 31, 2026 is Sunday)', () => {
    // May 2026 (month index 4), May 31 is Sunday (getDay() === 0)
    const result = getMonthlyRecurringDueWeek(2026, 4, 31, true);

    expect(result.rawDueDate.getDate()).toBe(31);
    expect(result.rawDueDate.getDay()).toBe(0); // Sunday
    expect(result.wasAdvanced).toBe(true);

    // Normal week is May 25 - May 31
    // Shifted week is May 18 - May 24
    expect(result.start.getDate()).toBe(18);
    expect(result.end.getDate()).toBe(24);
  });

  it('does NOT advance monthly recurring expense when due day is Monday-Thursday (e.g. June 30, 2026 is Tuesday)', () => {
    // June 2026 (month index 5), June 30 is Tuesday (getDay() === 2)
    const result = getMonthlyRecurringDueWeek(2026, 5, 30, true);

    expect(result.rawDueDate.getDate()).toBe(30);
    expect(result.rawDueDate.getDay()).toBe(2); // Tuesday
    expect(result.wasAdvanced).toBe(false);

    // Week containing June 30 is June 29 (Mon) - July 5 (Sun)
    expect(result.start.getDate()).toBe(29);
    expect(result.start.getMonth()).toBe(5); // June
    expect(result.end.getDate()).toBe(5);
    expect(result.end.getMonth()).toBe(6); // July
  });

  it('clamps to the last day of the month for shorter months like February (e.g. Feb 28)', () => {
    // Feb 2026 (month index 1, 28 days)
    // Feb 28, 2026 is Saturday (getDay() === 6)
    const result = getMonthlyRecurringDueWeek(2026, 1, 30, true);

    expect(result.rawDueDate.getDate()).toBe(28); // Clamped to 28
    expect(result.rawDueDate.getDay()).toBe(6); // Saturday
    expect(result.wasAdvanced).toBe(true);

    // Normal week for Feb 28 is Feb 23 - Mar 1
    // Shifted week is Feb 16 - Feb 22
    expect(result.start.getDate()).toBe(16);
    expect(result.end.getDate()).toBe(22);
  });

  it('evaluates isRecurringExpenseDueInWeek correctly for weekly and monthly expenses', () => {
    const weeklyEmployeeExpense: RecurringExpense = {
      id: 'REC-EMP',
      name: 'Nómina Semanal Operativa',
      category: 'Nómina / Pago de Empleados',
      amount: 710.0,
      frequency: 'weekly',
      active: true,
      paymentMethod: 'Transferencia',
    };

    const targetWeek = getWeekRange(new Date(2026, 9, 21)); // Oct 19 - Oct 25, 2026

    // Weekly expense is always due
    expect(isRecurringExpenseDueInWeek(weeklyEmployeeExpense, targetWeek)).toBe(true);

    const monthlyRent: RecurringExpense = {
      id: 'REC-01',
      name: 'Alquiler de Local / Galpón y Oficina',
      category: 'Alquiler de Oficina / Patio',
      amount: 350.0,
      frequency: 'monthly',
      monthlyDay: 30,
      advanceIfWeekend: true,
      active: true,
      paymentMethod: 'Transferencia',
    };

    // In Oct 19 - Oct 25 week, Oct 30 is Friday so it advances to Oct 19 - Oct 25
    expect(isRecurringExpenseDueInWeek(monthlyRent, targetWeek)).toBe(true);

    // In earlier week Oct 5 - Oct 11, it is not due
    const earlierWeek = getWeekRange(new Date(2026, 9, 7));
    expect(isRecurringExpenseDueInWeek(monthlyRent, earlierWeek)).toBe(false);

    // Paused expense is not due
    const pausedExpense: RecurringExpense = {
      ...monthlyRent,
      active: false,
    };
    expect(isRecurringExpenseDueInWeek(pausedExpense, targetWeek)).toBe(false);
  });
});
