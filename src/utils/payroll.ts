export const PAYROLL_TIME_ZONE = 'America/Tegucigalpa';

export interface WeekRange {
  start: string;
  end: string;
  label: string;
}

export interface PayrollFault {
  faultDate: string;
  amount: number;
  points: number;
}

export interface WeekPayroll extends WeekRange {
  gross: number;
  deductions: number;
  points: number;
  faultCount: number;
  net: number;
}

export const roundMoney = (value: number) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

export function isoDateInTimeZone(date: Date = new Date(), timeZone = PAYROLL_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

export function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function weekStartForIso(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  return addDaysIso(iso, -offset);
}

const monthShort = (iso: string) =>
  new Intl.DateTimeFormat('es-HN', { timeZone: 'UTC', month: 'short' })
    .format(new Date(`${iso}T00:00:00Z`))
    .replace('.', '');

const dayNumber = (iso: string) => Number(iso.slice(8, 10));

export function weekLabel(start: string, end: string): string {
  const year = end.slice(0, 4);
  const startMonth = monthShort(start);
  const endMonth = monthShort(end);
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${dayNumber(start)} – ${dayNumber(end)} ${endMonth} ${year}`;
  }
  return `${dayNumber(start)} ${startMonth} – ${dayNumber(end)} ${endMonth} ${year}`;
}

export function weekFor(date: Date = new Date(), timeZone = PAYROLL_TIME_ZONE): WeekRange {
  const start = weekStartForIso(isoDateInTimeZone(date, timeZone));
  const end = addDaysIso(start, 6);
  return { start, end, label: weekLabel(start, end) };
}

export function recentWeeks(count: number, date: Date = new Date(), timeZone = PAYROLL_TIME_ZONE): WeekRange[] {
  const current = weekFor(date, timeZone);
  return Array.from({ length: count }, (_, index) => {
    const start = addDaysIso(current.start, -7 * index);
    const end = addDaysIso(start, 6);
    return { start, end, label: weekLabel(start, end) };
  });
}

export function summarizeWeek(
  salary: number | null | undefined,
  faults: PayrollFault[],
  week: WeekRange,
): WeekPayroll {
  const inWeek = faults.filter((fault) => fault.faultDate >= week.start && fault.faultDate <= week.end);
  const gross = roundMoney(Number(salary || 0));
  const deductions = roundMoney(inWeek.reduce((total, fault) => total + Number(fault.amount || 0), 0));
  const points = inWeek.reduce((total, fault) => total + Number(fault.points || 0), 0);
  return {
    ...week,
    gross,
    deductions,
    points,
    faultCount: inWeek.length,
    net: roundMoney(gross - deductions),
  };
}

export function formatLempiras(amount: number): string {
  const value = Number.isFinite(amount) ? roundMoney(amount) : 0;
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
  return value < 0 ? `-L ${formatted}` : `L ${formatted}`;
}
