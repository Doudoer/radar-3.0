import { describe, expect, it } from 'vitest';
import {
  OfficeEmployee, RecurringExpense, getMonthlyRecurringDueWeek,
  getWeekRange, isRecurringExpenseDueInWeek, isAdvisorRole, orderMatchesAdvisor,
} from '../src/components/WeeklyRelationView';
import { commissionAmount, financeDateKey, sumMoney, isDeliveredSaleOrder } from '../src/utils/finance';
import {
  DOWNPAYMENT_COMMISSION_AMOUNT,
  DELIVERY_CLOSED_COMMISSION_AMOUNT,
  getWorkingWeekRange,
  getPreviousWorkingWeekRange,
  isOrderSoldInWorkingPeriod,
  calculateAdvisorWeeklyBreakdown,
} from '../src/utils/commissions';
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

  it('excludes yard sellers from office payroll and automatedly sorts office staff by salary', () => {
    const rawUsers = [
      { id: 1, name: 'Jose Puche', role: 'admin', active: 1, weekly_salary: 200 },
      { id: 2, name: 'Moises Rossell', role: 'operator', active: 1, weekly_salary: 75 },
      { id: 3, name: 'Darrel Machado', role: 'dispatcher', active: 1, weekly_salary: 100 },
      { id: 4, name: 'Alejandro Palacio', role: 'vendedor_yarda', active: 1, weekly_salary: 50 }, // Yard seller - MUST be excluded!
      { id: 5, name: 'Inactivo', role: 'marketing', active: 0, weekly_salary: 80 }, // Inactive - MUST be excluded!
      { id: 6, name: 'Sin Salario', role: 'rct', active: 1, weekly_salary: null }, // No salary - excluded from payroll
    ];

    const ROLE_MAP: Record<string, string> = {
      admin: 'Gerente',
      operator: 'Asesor de ventas',
      dispatcher: 'Dispatcher',
      rct: 'RCT (Rodriguez Construction)',
      marketing: 'Marketing',
    };

    const officePayroll = rawUsers
      .filter((u) => Boolean(u.active) && u.role !== 'vendedor_yarda')
      .map((u) => ({
        id: `user-${u.id}`,
        name: u.name,
        weeklySalary: Number(u.weekly_salary || 0),
        role: ROLE_MAP[u.role] || u.role,
      }))
      .filter((emp) => emp.weeklySalary > 0)
      .sort((a, b) => b.weeklySalary - a.weeklySalary);

    expect(officePayroll.map((emp) => emp.name)).toEqual(['Jose Puche', 'Darrel Machado', 'Moises Rossell']);
    expect(officePayroll.map((emp) => emp.role)).toEqual(['Gerente', 'Dispatcher', 'Asesor de ventas']);
    expect(officePayroll.map((emp) => emp.weeklySalary)).toEqual([200, 100, 75]);
    expect(officePayroll.find((emp) => emp.name === 'Alejandro Palacio')).toBeUndefined();
    expect(sumMoney(officePayroll.map((emp) => emp.weeklySalary))).toBe(375);
  });

  it('keeps 2% office commission for delivered orders even if refunded in the same week', () => {
    const deliveredAndRefundRequestedOrder = {
      status: 'solicitud_reembolso',
      deliveredAt: '2026-11-25T15:00:00Z',
      financials: { partPrice: 1000, total: 1100 },
    } as Order;

    const deliveredAndRefundedOrder = {
      status: 'reembolsado',
      deliveredAt: '2026-11-25T16:00:00Z',
      financials: { partPrice: 2000, total: 2200 },
    } as Order;

    const notDeliveredRefundedOrder = {
      status: 'reembolsado',
      deliveredAt: null,
      financials: { partPrice: 1500, total: 1600 },
    } as Order;

    expect(isDeliveredSaleOrder(deliveredAndRefundRequestedOrder)).toBe(true);
    expect(isDeliveredSaleOrder(deliveredAndRefundedOrder)).toBe(true);
    expect(isDeliveredSaleOrder(notDeliveredRefundedOrder)).toBe(false);

    expect(commissionAmount([deliveredAndRefundRequestedOrder, deliveredAndRefundedOrder])).toBe(60);
  });

  it('correctly identifies sales advisors and matches closed sales for $5 commissions', () => {
    expect(isAdvisorRole('Asesor de ventas')).toBe(true);
    expect(isAdvisorRole('Asesor')).toBe(true);
    expect(isAdvisorRole('ventas')).toBe(true);
    expect(isAdvisorRole('Gerente')).toBe(false);
    expect(isAdvisorRole('Dispatcher')).toBe(false);
    expect(isAdvisorRole('RCT (Rodriguez Construction)')).toBe(false);
    expect(isAdvisorRole('Marketing')).toBe(false);
    expect(isAdvisorRole('vendedor_yarda')).toBe(false); // Yard sellers excluded
    expect(isAdvisorRole(null)).toBe(false);

    const normalSale = {
      id: 'ORD-1',
      advisor: 'Darrel Machado',
      userId: 3,
      status: 'pagado',
      isYardSale: false,
    } as unknown as Order;

    const yardSale = {
      id: 'ORD-2',
      advisor: 'Darrel Machado',
      userId: 3,
      status: 'pagado',
      isYardSale: true,
    } as unknown as Order;

    const canceledSale = {
      id: 'ORD-3',
      advisor: 'Darrel Machado',
      userId: 3,
      status: 'cancelado',
      isYardSale: false,
    } as unknown as Order;

    const otherAdvisorSale = {
      id: 'ORD-4',
      advisor: 'Moises Rossell',
      userId: 2,
      status: 'pagado',
      isYardSale: false,
    } as unknown as Order;

    // Matches Darrel by ID or name
    expect(orderMatchesAdvisor(normalSale, 'user-3', 'Darrel Machado')).toBe(true);
    expect(orderMatchesAdvisor(normalSale, 'user-99', 'Darrel Machado')).toBe(true);
    // Excludes yard sales
    expect(orderMatchesAdvisor(yardSale, 'user-3', 'Darrel Machado')).toBe(false);
    // Excludes canceled sales
    expect(orderMatchesAdvisor(canceledSale, 'user-3', 'Darrel Machado')).toBe(false);
    // Does not match other advisor
    expect(orderMatchesAdvisor(otherAdvisorSale, 'user-3', 'Darrel Machado')).toBe(false);
    expect(orderMatchesAdvisor(otherAdvisorSale, 'user-2', 'Moises Rossell')).toBe(true);
  });

  it('calculates weekly payout for advisors: base salary ($75) + $5 per closed non-yard sale', () => {
    const darrel: OfficeEmployee = { id: 'user-3', name: 'Darrel Machado', weeklySalary: 75, role: 'Asesor de ventas' };
    const moises: OfficeEmployee = { id: 'user-2', name: 'Moises Rossell', weeklySalary: 75, role: 'Asesor de ventas' };
    const douglas: OfficeEmployee = { id: 'user-1', name: 'Douglas Villalobos', weeklySalary: 150, role: 'Gerente' };

    const weeklySales = [
      { id: 'O1', advisor: 'Darrel Machado', userId: 3, status: 'pagado', isYardSale: false },
      { id: 'O2', advisor: 'Darrel Machado', userId: 3, status: 'en_camino', isYardSale: false },
      { id: 'O3', advisor: 'Darrel Machado', userId: 3, status: 'pagado', isYardSale: false },
      { id: 'O4', advisor: 'Darrel Machado', userId: 3, status: 'pagado', isYardSale: true }, // yard - excluded
      { id: 'O5', advisor: 'Moises Rossell', userId: 2, status: 'pagado', isYardSale: false },
    ] as unknown as Order[];

    // Darrel has 3 eligible sales * $5 = $15 commission
    const darrelSalesCount = weeklySales.filter((o) => orderMatchesAdvisor(o, darrel.id, darrel.name)).length;
    expect(darrelSalesCount).toBe(3);
    const darrelCommissions = darrelSalesCount * DOWNPAYMENT_COMMISSION_AMOUNT;
    expect(darrelCommissions).toBe(15);
    const darrelTotal = darrel.weeklySalary + darrelCommissions;
    expect(darrelTotal).toBe(90);

    // Moises has 1 eligible sale * $5 = $5 commission
    const moisesSalesCount = weeklySales.filter((o) => orderMatchesAdvisor(o, moises.id, moises.name)).length;
    expect(moisesSalesCount).toBe(1);
    const moisesCommissions = moisesSalesCount * DOWNPAYMENT_COMMISSION_AMOUNT;
    expect(moisesCommissions).toBe(5);
    const moisesTotal = moises.weeklySalary + moisesCommissions;
    expect(moisesTotal).toBe(80);

    // Douglas is Gerente, not an advisor - no sales commissions
    expect(isAdvisorRole(douglas.role)).toBe(false);
    const douglasTotal = douglas.weeklySalary;
    expect(douglasTotal).toBe(150);

    // Total payroll with commissions: 150 + 90 + 80 = 320
    expect(sumMoney([douglasTotal, darrelTotal, moisesTotal])).toBe(320);
  });

  it('implements Monday-Saturday working cycle and week-lagged (semana vencida) commission payout', () => {
    // Current Week 2: Nov 23 (Mon) to Nov 29 (Sun). Work period is Mon Nov 23 00:00 to Sat Nov 28 23:59:59.
    const currentWeekRange = {
      start: new Date('2026-11-23T04:00:00.000Z'), // Mon Nov 23
      end: new Date('2026-11-30T03:59:59.999Z'),   // Sun Nov 29
    };

    const workRange = getWorkingWeekRange(currentWeekRange);
    const prevRange = getPreviousWorkingWeekRange(currentWeekRange);

    // Verify Monday to Saturday working periods
    expect(new Date(workRange.start).getUTCDay()).toBe(1); // Monday
    expect(workRange.end.getTime() - workRange.start.getTime()).toBe(6 * 86_400_000 - 1); // 6 full days (Mon..Sat)

    expect(new Date(prevRange.start).getUTCDay()).toBe(1); // Previous Monday
    expect(prevRange.end.getTime() - prevRange.start.getTime()).toBe(6 * 86_400_000 - 1); // 6 full days

    const darrel = { id: 'user-3', name: 'Darrel Machado', weeklySalary: 75, role: 'Asesor de ventas' };

    // Orders sold in Previous Week (Week 1: Nov 16 to Nov 21)
    const prevOrder1 = {
      id: 'P1',
      advisor: 'Darrel Machado',
      userId: 3,
      createdAtIso: '2026-11-18T15:00:00Z',
      status: 'pagado',
      isYardSale: false,
    } as unknown as Order;

    const prevOrder2 = {
      id: 'P2',
      advisor: 'Darrel Machado',
      userId: 3,
      createdAtIso: '2026-11-20T10:00:00Z',
      status: 'pagado',
      isYardSale: false,
    } as unknown as Order;

    // Orders sold in Current Week (Week 2: Nov 23 to Nov 28)
    const currOrder1 = {
      id: 'C1',
      advisor: 'Darrel Machado',
      userId: 3,
      createdAtIso: '2026-11-24T12:00:00Z',
      status: 'pagado',
      isYardSale: false,
    } as unknown as Order;

    // Old order from 2 weeks ago - MUST NEVER be counted as current week sale!
    const oldOrder = {
      id: 'OLD',
      advisor: 'Darrel Machado',
      userId: 3,
      createdAtIso: '2026-11-05T12:00:00Z',
      status: 'pagado',
      isYardSale: false,
    } as unknown as Order;

    expect(isOrderSoldInWorkingPeriod(oldOrder, [], workRange)).toBe(false);

    const allOrders = [prevOrder1, prevOrder2, currOrder1, oldOrder];

    const breakdown = calculateAdvisorWeeklyBreakdown(darrel, allOrders, [], currentWeekRange);

    // Rule: In Week 2, payable commissions come from Week 1 (prev week)
    expect(breakdown.payableSalesCount).toBe(2);
    expect(breakdown.payableCommissionsTotal).toBe(10); // 2 sales * $5

    // Rule: In Week 2, Current Week sales are accrued for Week 3 (next week)
    expect(breakdown.currentSalesCount).toBe(1);
    expect(breakdown.currentAccruedCommissionsTotal).toBe(5); // 1 sale * $5

    // Total payout in Week 2 is Base ($75) + Prev Week Commissions ($10) = $85 (NOT including current week's $5)
    expect(breakdown.totalPayout).toBe(85);
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
