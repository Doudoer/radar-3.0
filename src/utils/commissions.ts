export const DOWNPAYMENT_COMMISSION_AMOUNT = 5.0;
export const DELIVERY_CLOSED_COMMISSION_AMOUNT = 2.0;
export const YARD_VERIFICATION_HOURS = 12;

export interface EmployeeCommissionItem {
  id: number;
  userId: number;
  orderId: number;
  orderCode: string;
  type: 'downpayment_sale' | 'delivered_closed';
  amount: number;
  status: 'pending_yard_check' | 'earned' | 'voided_availability' | 'paid';
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
  earnedCommissions: number; // Comisiones ganadas disponibles en la semana
  pendingYardCommissions: number; // Comisiones en ventana de 12h de yarda
  totalPenalties: number; // Penalizaciones activas de la semana
  previousCarryoverDebt: number; // Deuda diferida de semanas anteriores
  grossDeduction: number; // Total a descontar (penalizaciones + arrastre)
  appliedDeduction: number; // Descuento efectivamente aplicado a las comisiones
  netCommissions: number; // Comisiones netas a pagar (después de deducciones)
  nextCarryoverDebt: number; // Déficit no cubierto que se acumula para el siguiente sábado
  netPayout: number; // Pago total neto: Sueldo Base + Comisiones Netas
}

export const isYardEmployee = (role?: string | null): boolean => {
  if (!role) return false;
  const normalized = role.toLowerCase().trim();
  return normalized === 'vendedor_yarda' || normalized === 'personal de yarda';
};

const roundMoney = (val: number): number =>
  Math.round((Number(val || 0) + Number.EPSILON) * 100) / 100;

/**
 * Realiza la liquidación semanal del empleado garantizando que el salario base sea 100% intocable.
 * Las penalizaciones se descuentan única y exclusivamente de las comisiones ganadas.
 * Si las penalizaciones superan a las comisiones disponibles al sábado 6:00 PM, el déficit no
 * se cobra esa semana y se acumula (carry-over) para el próximo corte.
 */
export function settleEmployeeCompensation(
  weeklySalary: number | null | undefined,
  earnedCommissions: number | null | undefined,
  penaltiesAmount: number | null | undefined,
  previousCarryover = 0,
): EmployeeSettlementSummary {
  const baseSalary = Math.max(0, roundMoney(Number(weeklySalary || 0)));
  const commissions = Math.max(0, roundMoney(Number(earnedCommissions || 0)));
  const currentPenalties = Math.max(0, roundMoney(Number(penaltiesAmount || 0)));
  const prevDebt = Math.max(0, roundMoney(Number(previousCarryover || 0)));
  const totalDeductions = roundMoney(currentPenalties + prevDebt);

  // REGLA FUNDAMENTAL: Las deducciones solo se absorben hasta el tope de comisiones.
  const appliedDeduction = roundMoney(Math.min(commissions, totalDeductions));
  const netCommissions = roundMoney(commissions - appliedDeduction);
  const nextCarryoverDebt = roundMoney(totalDeductions - appliedDeduction);

  // El salario base NUNCA es tocado por penalizaciones:
  const netPayout = roundMoney(baseSalary + netCommissions);

  return {
    weeklySalary: baseSalary,
    earnedCommissions: commissions,
    pendingYardCommissions: 0,
    totalPenalties: currentPenalties,
    previousCarryoverDebt: prevDebt,
    grossDeduction: totalDeductions,
    appliedDeduction,
    netCommissions,
    nextCarryoverDebt,
    netPayout,
  };
}
