import type { Order } from '../types';

export const FINANCE_TIME_ZONE = 'America/New_York';
export const toCents = (amount: number): number =>
  Number.isFinite(amount) ? Math.round((amount + Number.EPSILON) * 100) : 0;
export const fromCents = (cents: number): number => cents / 100;
export const sumMoney = (amounts: number[]): number =>
  fromCents(amounts.reduce((sum, amount) => sum + toCents(amount), 0));

export const financeDateKey = (date: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: FINANCE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);

export const shiftDateKey = (key: string, days: number): string => {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** Resolve a New York wall-clock midnight, including DST offset changes. */
export const financeMidnight = (key: string): Date => {
  const target = Date.parse(`${key}T00:00:00Z`);
  let timestamp = target;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: FINANCE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(timestamp));
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const wallClock = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
    timestamp += target - wallClock;
  }
  return new Date(timestamp);
};

export const parseFinanceDate = (value?: string | null): Date | null => {
  if (!value) return null;
  let raw = value.trim();
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) raw = `${slash[3]}-${slash[2].padStart(2, '0')}-${slash[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const utc = new Date(`${raw}T00:00:00Z`);
    if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 10) !== raw) return null;
    const date = financeMidnight(raw);
    return Number.isFinite(date.getTime()) && financeDateKey(date) === raw ? date : null;
  }
  // Undated/localized display labels are not accounting timestamps.
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw)) return null;
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(raw)) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

export const getFinanceWeekRange = (reference = new Date(), offset = 0) => {
  const key = financeDateKey(reference);
  const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
  const weekStart = shiftDateKey(key, (weekday === 0 ? -6 : 1 - weekday) + offset * 7);
  const start = financeMidnight(weekStart);
  const end = new Date(financeMidnight(shiftDateKey(weekStart, 7)).getTime() - 1);
  return { start, end };
};

export const isInFinancePeriod = (value: string | null | undefined, range: { start: Date; end: Date }): boolean => {
  const date = parseFinanceDate(value);
  return date !== null && date >= range.start && date <= range.end;
};

export interface FinanceMovement {
  id: string | number;
  orderId: string;
  kind: 'payment' | 'refund';
  amount: number;
  effectiveAt: string | null;
  source: string;
}

export const movementsInPeriod = (movements: FinanceMovement[], range: { start: Date; end: Date }) =>
  movements.filter((movement) => movement.source !== 'legacy_baseline' &&
    isInFinancePeriod(movement.effectiveAt, range));

export const movementIncome = (movements: FinanceMovement[]): number =>
  sumMoney(movements.map((movement) => movement.kind === 'refund' ? -Math.abs(movement.amount) : Math.abs(movement.amount)));

export const commissionBase = (orders: Order[]): number =>
  sumMoney(orders.filter((order) => order.status === 'entregado' && !order.isYardSale &&
    order.advisorRole !== 'vendedor_yarda').map((order) => order.financials.partPrice ?? 0));

export const commissionAmount = (orders: Order[]): number =>
  fromCents(Math.round(toCents(commissionBase(orders)) * 2 / 100));
