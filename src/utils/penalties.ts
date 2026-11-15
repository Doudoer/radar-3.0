export const PAYROLL_TIME_ZONE = 'America/Tegucigalpa';
export const PENALTY_CUTOFF_HOUR = 18;
const PAYROLL_OFFSET_MINUTES = -360;

export const PENALTY_PERCENT_PER_UNIT = 0.8333;

export const POST_DELIVERY_ALERT_DAYS = [3, 7, 14] as const;

export interface PenaltyPause {
  from: string;
  to?: string | null;
}

export interface PostDeliveryAccrual {
  day3: number;
  day7: number;
  day14Daily: number;
  day14OneTime: number;
  totalUnits: number;
}

export interface AccrualOptions {
  paused?: PenaltyPause[];
}

export interface PostDeliveryOptions extends AccrualOptions {
  deliveredAt: string;
  asOf?: string | Date;
  closedAt?: string | null;
}

export interface ClockOptions extends AccrualOptions {
  startedAt: string;
  asOf?: string | Date;
  closedAt?: string | null;
  graceHours?: number;
}

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor;
};

export const roundPercent = (value: number): number => roundTo(value, 2);
export const roundPenaltyAmount = (value: number): number => roundTo(value, 2);

export const penaltyPercent = (units: number, rate: number): number =>
  roundPercent(Math.max(0, Number(units || 0)) * Number(rate || 0));

export const penaltyAmount = (weeklySalary: number | null | undefined, percent: number): number =>
  roundPenaltyAmount(Math.max(0, Number(weeklySalary || 0)) * (Number(percent || 0) / 100));

const hondurasDateParts = (date: Date) => {
  const shifted = new Date(date.getTime() + PAYROLL_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
};

export const localDateKey = (date: Date): string => {
  const parts = hondurasDateParts(date);
  return `${parts.year}-${String(parts.month + 1).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
};

const localDateKeyFromIso = (iso: string): string => {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? '' : localDateKey(parsed);
};

const cutoffForLocalDateKey = (dateKey: string): Date => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, PENALTY_CUTOFF_HOUR - PAYROLL_OFFSET_MINUTES / 60, 0, 0));
};

const addDaysToKey = (dateKey: string, days: number): string => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
};

export const latestCutoff = (now: Date = new Date()): Date => {
  const parts = hondurasDateParts(now);
  const todayKey = `${parts.year}-${String(parts.month + 1).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  const todayCutoff = cutoffForLocalDateKey(todayKey);
  if (parts.minutes >= PENALTY_CUTOFF_HOUR * 60) return todayCutoff;
  return cutoffForLocalDateKey(addDaysToKey(todayKey, -1));
};

export const nextCutoffAfter = (moment: Date): Date => {
  const latest = latestCutoff(moment);
  return latest.getTime() < moment.getTime() ? new Date(latest.getTime() + 86_400_000) : latest;
};

export interface PayPeriod {
  start: string;
  end: string;
  label: string;
}

export const payPeriodFor = (now: Date = new Date()): PayPeriod => {
  let end = latestCutoff(now);
  do {
    end = new Date(end.getTime() + 86_400_000);
  } while (hondurasDateParts(end).weekday !== 6);
  const start = new Date(end.getTime() - 7 * 86_400_000);
  const endKey = localDateKey(end);
  const startKey = localDateKey(start);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    label: `Sábado ${endKey.slice(8, 10)} · ${startKey} → ${endKey}`,
  };
};

const cutoffsBetween = (start: string, end: string): Date[] => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return [];
  if (endDate.getTime() < startDate.getTime()) return [];
  const cutoffs: Date[] = [];
  let cursor = nextCutoffAfter(startDate);
  while (cursor.getTime() <= endDate.getTime()) {
    cutoffs.push(cursor);
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return cutoffs;
};

const isPausedAt = (paused: PenaltyPause[] | undefined, cutoff: Date): boolean => {
  if (!paused?.length) return false;
  const time = cutoff.getTime();
  return paused.some(pause => {
    const from = Date.parse(pause.from);
    if (!Number.isFinite(from) || time < from) return false;
    const to = pause.to ? Date.parse(pause.to) : Number.POSITIVE_INFINITY;
    return !Number.isFinite(to) ? time >= from : time < to;
  });
};

const dayIndexBetween = (startKey: string, cutoffKey: string): number => {
  if (!startKey || !cutoffKey) return 0;
  const start = Date.parse(`${startKey}T00:00:00Z`);
  const end = Date.parse(`${cutoffKey}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000);
};

const accrualEnd = (asOf: Date, closedAt?: string | null): Date => {
  if (!closedAt) return asOf;
  const closed = new Date(closedAt);
  if (Number.isNaN(closed.getTime())) return asOf;
  return closed.getTime() < asOf.getTime() ? closed : asOf;
};

export const postDeliveryAccrual = ({
  deliveredAt,
  asOf = new Date(),
  closedAt,
  paused,
}: PostDeliveryOptions): PostDeliveryAccrual => {
  const empty: PostDeliveryAccrual = { day3: 0, day7: 0, day14Daily: 0, day14OneTime: 0, totalUnits: 0 };
  const deliveredKey = localDateKeyFromIso(deliveredAt);
  if (!deliveredKey) return empty;
  const end = accrualEnd(asOf instanceof Date ? asOf : new Date(asOf), closedAt);
  const cutoffs = cutoffsBetween(deliveredAt, end.toISOString());
  let day3 = 0;
  let day7 = 0;
  let day14Daily = 0;
  let day14OneTime = 0;
  for (const cutoff of cutoffs) {
    if (isPausedAt(paused, cutoff)) continue;
    const dayIndex = dayIndexBetween(deliveredKey, localDateKey(cutoff));
    if (dayIndex >= 4) day3 += 1;
    if (dayIndex >= 7) day7 += 2;
    if (dayIndex >= 14) {
      day14Daily += 1;
      if (day14OneTime === 0) day14OneTime = 5;
    }
  }
  return { day3, day7, day14Daily, day14OneTime, totalUnits: day3 + day7 + day14Daily + day14OneTime };
};

export const readyPieceAccrual = ({
  startedAt,
  asOf = new Date(),
  closedAt,
  paused,
  graceHours = 24,
}: ClockOptions): number => {
  if (!startedAt) return 0;
  const started = new Date(startedAt);
  if (Number.isNaN(started.getTime())) return 0;
  const end = accrualEnd(asOf instanceof Date ? asOf : new Date(asOf), closedAt);
  const cutoffs = cutoffsBetween(startedAt, end.toISOString());
  let units = 0;
  for (const cutoff of cutoffs) {
    if (isPausedAt(paused, cutoff)) continue;
    if (cutoff.getTime() - started.getTime() >= graceHours * 3_600_000) units += 1;
  }
  return units;
};

export interface PenaltyLine {
  source: 'post_delivery' | 'ready_piece' | 'claim';
  units: number;
  percent: number;
  amount: number;
}

export interface PenaltySummary {
  rate: number;
  units: number;
  percent: number;
  amount: number;
  lines: PenaltyLine[];
}

export const buildPenaltyLine = (
  source: PenaltyLine['source'],
  units: number,
  rate: number,
  weeklySalary: number | null | undefined,
): PenaltyLine => {
  const percent = penaltyPercent(units, rate);
  return { source, units, percent, amount: penaltyAmount(weeklySalary, percent) };
};

export const summarizePenalties = (
  weeklySalary: number | null | undefined,
  rate: number,
  sourceUnits: Array<{ source: PenaltyLine['source']; units: number }>,
): PenaltySummary => {
  const lines = sourceUnits
    .filter(entry => entry.units > 0)
    .map(entry => buildPenaltyLine(entry.source, entry.units, rate, weeklySalary));
  const units = lines.reduce((total, line) => total + line.units, 0);
  const percent = penaltyPercent(units, rate);
  return { rate, units, percent, amount: penaltyAmount(weeklySalary, percent), lines };
};

export const formatPenaltyPercent = (value: number): string =>
  `${roundPercent(value).toFixed(2)}%`;
