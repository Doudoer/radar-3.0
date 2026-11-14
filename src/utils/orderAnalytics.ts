import type { Order } from '../types';
import { financeDateKey, financeMidnight, getFinanceWeekRange, movementsInPeriod, parseFinanceDate, shiftDateKey, sumMoney } from './finance';
import type { FinanceMovement } from './finance';

export const parseOrderDate = (order: Order): Date | null => {
  const raw = (order.createdAtIso || order.createdAt || '').trim();
  if (!raw) return null;
  if (/^(hoy|ayer)\b/i.test(raw)) {
    return financeMidnight(shiftDateKey(financeDateKey(new Date()), /^ayer\b/i.test(raw) ? -1 : 0));
  }
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:$|[,\s])/);
  if (slash) return parseFinanceDate(`${slash[3]}-${slash[2].padStart(2, '0')}-${slash[1].padStart(2, '0')}`);
  const direct = parseFinanceDate(raw);
  if (direct) return direct;
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const spanish = raw.match(/^(\d{1,2})\s+([a-záéíóú]+)\.?\s+(\d{4})(?:$|[,\s])/i);
  if (!spanish) return null;
  const month = months.indexOf(spanish[2].toLowerCase().slice(0, 3));
  if (month < 0) return null;
  return parseFinanceDate(`${spanish[3]}-${String(month + 1).padStart(2, '0')}-${spanish[1].padStart(2, '0')}`);
};

export const getWeekRange = (offset = 0) => getFinanceWeekRange(new Date(), offset);

export const getMonthRange = (offset = 0) => {
  const [currentYear, currentMonth] = financeDateKey(new Date()).split('-').map(Number);
  const date = new Date(Date.UTC(currentYear, currentMonth - 1 + offset, 1));
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const start = financeMidnight(date.toISOString().slice(0, 10));
  const next = new Date(Date.UTC(year, month + 1, 1)).toISOString().slice(0, 10);
  return { start, end: new Date(financeMidnight(next).getTime() - 1), year, month };
};

export const getYearRange = (offset = 0) => {
  const year = Number(financeDateKey(new Date()).slice(0, 4)) + offset;
  return {
    start: financeMidnight(`${year}-01-01`),
    end: new Date(financeMidnight(`${year + 1}-01-01`).getTime() - 1),
    year,
  };
};

export const saleStatuses = new Set([
  'pagado', 'en_preparacion', 'listo_despacho', 'listo_retiro', 'en_camino',
  'entregado', 'facturado', 'en_diagnostico', 'en_reparacion', 'en_proceso',
]);
export const workshopStatuses = new Set([
  'en_preparacion', 'listo_despacho', 'listo_retiro', 'en_camino',
  'en_diagnostico', 'en_reparacion', 'en_proceso',
]);
export const quoteStatuses = new Set([
  'cotizacion', 'espera_confirmacion', 'pendiente_aprobacion', 'listo_pago',
]);

export const orderSaleTotal = (order: Order) =>
  order.financials.total ?? sumMoney([
    order.financials.partPrice ?? 0, order.financials.deliveryFee ?? 0, order.financials.coreFee ?? 0,
  ]);
export const orderCollection = (order: Order) =>
  order.financials.downPayment ?? order.financials.advancePayment ?? 0;
export const orderBalance = (order: Order) =>
  order.financials.balanceDue ?? Math.max(0, sumMoney([orderSaleTotal(order), -orderCollection(order)]));

export const matchesOrderAdvisor = (order: Order, id: string, name: string) => {
  if (order.userId) return String(order.userId) === id;
  const advisor = (order.advisor || '').trim().toLowerCase();
  return Boolean(advisor && advisor !== 'sin asignar' && advisor === name.trim().toLowerCase());
};

export const ordersForMovements = (
  orders: Order[],
  movements: FinanceMovement[],
  range: { start: Date; end: Date },
) => {
  const movementOrderIds = new Set(movementsInPeriod(movements, range).map(movement => String(movement.orderId)));
  return orders.filter(order => movementOrderIds.has(String(order.id)) || movementOrderIds.has(order.code));
};

export function operationalDistribution(orders: ReadonlyArray<{ status: string }>) {
  const categories = [
    { label: 'En taller / Proceso', color: 'var(--brand)', count: 0 },
    { label: 'Pagadas / Entregadas / Facturadas', color: 'var(--positive)', count: 0 },
    { label: 'Cotizaciones / Esperando acción', color: 'var(--warning)', count: 0 },
    { label: 'Reclamos / Devoluciones / Canceladas', color: 'var(--danger)', count: 0 },
    { label: 'Archivadas / Otros estados', color: 'var(--text-secondary)', count: 0 },
  ];
  for (const order of orders) {
    const category = workshopStatuses.has(order.status) ? 0
      : saleStatuses.has(order.status) ? 1
      : quoteStatuses.has(order.status) ? 2
      : ['reclamo', 'solicitud_reembolso', 'reembolsado', 'cancelado'].includes(order.status) ? 3 : 4;
    categories[category].count++;
  }
  return categories.map(category => ({
    ...category,
    percentage: orders.length ? category.count / orders.length * 100 : 0,
  }));
}

export const scaleNetBars = <T extends { rawAmount: number }>(bars: T[]) => {
  const maximum = Math.max(...bars.map(bar => Math.abs(bar.rawAmount)), 1);
  return bars.map(bar => ({
    ...bar,
    height: `${Math.abs(bar.rawAmount) / maximum * 100}%`,
  }));
};
