import type { Order } from '../types';
import type { FinanceMovement } from './finance';
import { isInFinancePeriod } from './finance';
import { parseOrderDate } from './orderAnalytics';

export const DOWNPAYMENT_COMMISSION_AMOUNT = 5.0;
export const DELIVERY_CLOSED_COMMISSION_AMOUNT = 2.0;
export const YARD_VERIFICATION_HOURS = 12;

export interface WorkingWeekPeriod {
  start: Date;
  end: Date;
}

/**
 * Returns the exact Monday 00:00:00 to Saturday 23:59:59.999 work period for a given week range.
 */
export const getWorkingWeekRange = (weekRange: { start: Date; end: Date }): WorkingWeekPeriod => {
  const start = new Date(weekRange.start.getTime());
  // 6 full days: Monday 00:00:00 + 6 days - 1ms = Saturday 23:59:59.999
  const end = new Date(start.getTime() + 6 * 86_400_000 - 1);
  return { start, end };
};

/**
 * Returns the exact previous Monday 00:00:00 to Saturday 23:59:59.999 work period.
 */
export const getPreviousWorkingWeekRange = (weekRange: { start: Date; end: Date }): WorkingWeekPeriod => {
  const prevStart = new Date(weekRange.start.getTime() - 7 * 86_400_000);
  const prevEnd = new Date(prevStart.getTime() + 6 * 86_400_000 - 1);
  return { start: prevStart, end: prevEnd };
};

const roundMoney = (val: number): number =>
  Math.round((Number(val || 0) + Number.EPSILON) * 100) / 100;

export const isYardEmployee = (role?: string | null): boolean => {
  if (!role) return false;
  const normalized = role.toLowerCase().trim();
  return normalized === 'vendedor_yarda' || normalized === 'personal de yarda';
};

export const isAdvisorRole = (role?: string | null): boolean => {
  if (!role) return false;
  if (isYardEmployee(role)) return false;
  const lower = role.toLowerCase().trim();
  return lower.includes('asesor') || lower.includes('ventas');
};

export const orderMatchesAdvisor = (order: Order, employeeId: string, employeeName: string): boolean => {
  if (order.isYardSale || order.advisorRole === 'vendedor_yarda') return false;
  if (order.status === 'cancelado') return false;

  const rawId = employeeId.replace(/^user-/, '').trim();
  if (order.userId && String(order.userId) === rawId) return true;

  const orderAdvisor = (order.advisor || '').trim().toLowerCase();
  const empName = employeeName.trim().toLowerCase();
  if (orderAdvisor && orderAdvisor !== 'sin asignar') {
    if (orderAdvisor === empName) return true;
    const empParts = empName.split(/\s+/);
    if (empParts.length > 1 && orderAdvisor === empParts[0]) return true;
  }

  return false;
};

/**
 * Checks if an order was legitimately sold/created within the working period (Monday to Saturday).
 * Strict rule: Orders created in previous weeks NEVER generate sales commissions in current weeks.
 */
export const isOrderSoldInWorkingPeriod = (
  order: Order,
  movements: FinanceMovement[] = [],
  period: WorkingWeekPeriod,
): boolean => {
  if (order.isYardSale || order.advisorRole === 'vendedor_yarda') return false;
  const status = String(order.status || '').toLowerCase().trim();
  if (['cancelado', 'cancelada', 'cotización', 'cotizacion'].includes(status)) return false;

  const orderDate = parseOrderDate(order);
  // If order creation date exists and is strictly before this working period, it is an old order from a prior week!
  if (orderDate && orderDate.getTime() < period.start.getTime()) {
    return false;
  }

  // If order was created within the working period:
  if (orderDate && orderDate.getTime() >= period.start.getTime() && orderDate.getTime() <= period.end.getTime()) {
    return true;
  }

  // Or if there was a payment movement in this period:
  if (movements.length > 0) {
    const hasPaymentInPeriod = movements.some(
      (m) =>
        (String(m.orderId) === String(order.id) || String(m.orderId) === order.code) &&
        m.kind === 'payment' &&
        isInFinancePeriod(m.effectiveAt, period),
    );
    if (hasPaymentInPeriod) {
      return true;
    }
  }

  return false;
};

/**
 * Checks if an order was delivered within the working period.
 * Closed orders pay delivery commission ($2) strictly once.
 */
export const isOrderDeliveredInWorkingPeriod = (
  order: Order,
  period: WorkingWeekPeriod,
): boolean => {
  if (order.isYardSale || order.advisorRole === 'vendedor_yarda') return false;
  if (order.status === 'cancelado') return false;
  if (!order.deliveredAt) return false;

  const deliveredDate = new Date(order.deliveredAt);
  if (Number.isNaN(deliveredDate.getTime())) return false;

  return deliveredDate.getTime() >= period.start.getTime() && deliveredDate.getTime() <= period.end.getTime();
};

export interface AdvisorWeeklyBreakdown {
  employeeId: string;
  isAdvisor: boolean;
  baseSalary: number;

  // Semana vencida (Semana W-1) -> Lo que se PAGA en la nómina de esta semana:
  payableSalesCount: number;
  payableSalesCommission: number;
  payableDeliveryCount: number;
  payableDeliveryCommission: number;
  payableCommissionsTotal: number;

  // Semana actual (Semana W) -> Lo que se GENERA esta semana (a pagar la próxima semana W+1):
  currentSalesCount: number;
  currentSalesCommission: number;
  currentDeliveryCount: number;
  currentDeliveryCommission: number;
  currentAccruedCommissionsTotal: number;

  // Total neto a pagar en esta nómina: Base + Comisiones semana previa
  totalPayout: number;
}

export const calculateAdvisorWeeklyBreakdown = (
  emp: { id: string; name: string; weeklySalary: number; role?: string },
  orders: Order[],
  movements: FinanceMovement[] = [],
  currentWeekRange: { start: Date; end: Date },
): AdvisorWeeklyBreakdown => {
  const isAdv = isAdvisorRole(emp.role);
  const baseSalary = Math.max(0, emp.weeklySalary || 0);

  if (!isAdv) {
    return {
      employeeId: emp.id,
      isAdvisor: false,
      baseSalary,
      payableSalesCount: 0,
      payableSalesCommission: 0,
      payableDeliveryCount: 0,
      payableDeliveryCommission: 0,
      payableCommissionsTotal: 0,
      currentSalesCount: 0,
      currentSalesCommission: 0,
      currentDeliveryCount: 0,
      currentDeliveryCommission: 0,
      currentAccruedCommissionsTotal: 0,
      totalPayout: baseSalary,
    };
  }

  // 1. Semana vencida (Semana W-1): Comisiones a pagar en la nómina de esta semana
  const prevPeriod = getPreviousWorkingWeekRange(currentWeekRange);
  const payableSales = orders.filter(
    (o) => orderMatchesAdvisor(o, emp.id, emp.name) && isOrderSoldInWorkingPeriod(o, movements, prevPeriod),
  );
  const payableDeliveries = orders.filter(
    (o) => orderMatchesAdvisor(o, emp.id, emp.name) && isOrderDeliveredInWorkingPeriod(o, prevPeriod),
  );

  const payableSalesCommission = payableSales.length * DOWNPAYMENT_COMMISSION_AMOUNT;
  const payableDeliveryCommission = payableDeliveries.length * DELIVERY_CLOSED_COMMISSION_AMOUNT;
  const payableCommissionsTotal = payableSalesCommission + payableDeliveryCommission;

  // 2. Semana en curso (Semana W): Comisiones acumuladas esta semana (a pagar la próxima semana W+1)
  const currPeriod = getWorkingWeekRange(currentWeekRange);
  const currentSales = orders.filter(
    (o) => orderMatchesAdvisor(o, emp.id, emp.name) && isOrderSoldInWorkingPeriod(o, movements, currPeriod),
  );
  const currentDeliveries = orders.filter(
    (o) => orderMatchesAdvisor(o, emp.id, emp.name) && isOrderDeliveredInWorkingPeriod(o, currPeriod),
  );

  const currentSalesCommission = currentSales.length * DOWNPAYMENT_COMMISSION_AMOUNT;
  const currentDeliveryCommission = currentDeliveries.length * DELIVERY_CLOSED_COMMISSION_AMOUNT;
  const currentAccruedCommissionsTotal = currentSalesCommission + currentDeliveryCommission;

  const totalPayout = roundMoney(baseSalary + payableCommissionsTotal);

  return {
    employeeId: emp.id,
    isAdvisor: true,
    baseSalary,
    payableSalesCount: payableSales.length,
    payableSalesCommission,
    payableDeliveryCount: payableDeliveries.length,
    payableDeliveryCommission,
    payableCommissionsTotal,
    currentSalesCount: currentSales.length,
    currentSalesCommission,
    currentDeliveryCount: currentDeliveries.length,
    currentDeliveryCommission,
    currentAccruedCommissionsTotal,
    totalPayout,
  };
};

export interface EmployeeCommissionItem {
  id: number;
  userId: number;
  orderId: number;
  orderCode: string;
  type: 'downpayment_sale' | 'delivered_closed';
  amount: number;
  status: 'pending_yard_check' | 'earned' | 'voided_availability' | 'voided_refund' | 'paid';
  availableAt: string;
  earnedAt?: string | null;
  voidedAt?: string | null;
  createdAt: string;
  customerName?: string;
  vehicle?: string;
  minutesRemaining?: number;
}

export interface EmployeeCommissionsSummary {
  userId: number;
  periodStart: string;
  periodEnd: string;
  earnedAmount: number;
  pendingYardAmount: number;
  voidedAmount: number;
  earnedCount: number;
  pendingYardCount: number;
  voidedCount: number;
  items: EmployeeCommissionItem[];
}

export interface EmployeeSettlementSummary {
  weeklySalary: number; // Salario base (intocable)
  earnedCommissions: number; // Comisiones pagables esta semana (alias retro-compatible de payableCommissions)
  payableCommissions: number; // Comisiones pagables esta semana (de la semana previa W-1 a semana vencida)
  currentAccruedCommissions: number; // Comisiones acumuladas esta semana W (a pagar la próxima semana W+1)
  pendingYardCommissions: number; // Comisiones en ventana de 12h de yarda
  totalPenalties: number; // Penalizaciones activas de la semana
  previousCarryoverDebt: number; // Deuda diferida de semanas anteriores
  grossDeduction: number; // Total a descontar (penalizaciones + arrastre)
  appliedDeduction: number; // Descuento efectivamente aplicado a las comisiones pagables
  netCommissions: number; // Comisiones netas a pagar esta semana
  nextCarryoverDebt: number; // Déficit no cubierto que se acumula para el siguiente sábado
  netPayout: number; // Pago total neto: Sueldo Base + Comisiones Netas pagables
  baseSalaryProtected: boolean;
}

/**
 * Realiza la liquidación semanal del empleado garantizando que el salario base sea 100% intocable.
 * Las comisiones se pagan a semana vencida:
 * - payableCommissions: Comisiones ganadas en la semana previa (W-1).
 * - currentAccruedCommissions: Comisiones ganadas en la semana actual (W), acumuladas para pagarse en W+1.
 * Las penalizaciones se descuentan única y exclusivamente de las comisiones pagables.
 * Si las penalizaciones superan a las comisiones disponibles al sábado 6:00 PM, el déficit no
 * se cobra del salario base y se acumula (carry-over) para el próximo corte.
 */
export function settleEmployeeCompensation(
  weeklySalary: number | null | undefined,
  payableCommissions: number | null | undefined,
  penaltiesAmount: number | null | undefined,
  previousCarryover = 0,
  currentAccruedCommissions = 0,
): EmployeeSettlementSummary {
  const baseSalary = Math.max(0, roundMoney(Number(weeklySalary || 0)));
  const payable = Math.max(0, roundMoney(Number(payableCommissions || 0)));
  const currentAccrued = Math.max(0, roundMoney(Number(currentAccruedCommissions || 0)));
  const currentPenalties = Math.max(0, roundMoney(Number(penaltiesAmount || 0)));
  const prevDebt = Math.max(0, roundMoney(Number(previousCarryover || 0)));
  const totalDeductions = roundMoney(currentPenalties + prevDebt);

  // REGLA FUNDAMENTAL: Las deducciones solo se absorben hasta el tope de comisiones pagables.
  const appliedDeduction = roundMoney(Math.min(payable, totalDeductions));
  const netCommissions = roundMoney(payable - appliedDeduction);
  const nextCarryoverDebt = roundMoney(totalDeductions - appliedDeduction);

  // El salario base NUNCA es tocado por penalizaciones:
  const netPayout = roundMoney(baseSalary + netCommissions);

  return {
    weeklySalary: baseSalary,
    earnedCommissions: payable,
    payableCommissions: payable,
    currentAccruedCommissions: currentAccrued,
    pendingYardCommissions: 0,
    totalPenalties: currentPenalties,
    previousCarryoverDebt: prevDebt,
    grossDeduction: totalDeductions,
    appliedDeduction,
    netCommissions,
    nextCarryoverDebt,
    netPayout,
    baseSalaryProtected: true,
  };
}
