import { describe, expect, it } from 'vitest';
import {
  PENALTY_PERCENT_PER_UNIT,
  latestCutoff,
  localDateKey,
  payPeriodFor,
  penaltyAmount,
  penaltyPercent,
  postDeliveryAccrual,
  readyPieceAccrual,
  summarizePenalties,
} from '../src/utils/penalties';

const DELIVERED_MONDAY = '2026-11-09T16:00:00.000Z';
const SATURDAY_CUTOFF = new Date('2026-11-15T00:00:00.000Z');
const SUNDAY_CUTOFF = new Date('2026-11-16T00:00:00.000Z');
const MONDAY_DAY7_CUTOFF = new Date('2026-11-17T00:00:00.000Z');
const DAY14_CUTOFF = new Date('2026-11-24T00:00:00.000Z');

describe('tarifa única de amonestación', () => {
  it('usa 0.8333% por unidad para todo el equipo', () => {
    expect(PENALTY_PERCENT_PER_UNIT).toBe(0.8333);
  });

  it('calcula la tabla de porcentajes desde las unidades totales', () => {
    const table = [1, 2, 3, 4, 5].map(units => penaltyPercent(units, PENALTY_PERCENT_PER_UNIT));
    expect(table).toEqual([0.83, 1.67, 2.5, 3.33, 4.17]);
  });

  it('aplica el mismo porcentaje al salario semanal de cada empleado', () => {
    expect(penaltyAmount(120, 0.83)).toBe(1);
    expect(penaltyAmount(75, 0.83)).toBe(0.62);
    expect(penaltyAmount(120, 2.5)).toBe(3);
    expect(penaltyAmount(75, 2.5)).toBe(1.88);
  });

  it('suma las unidades y redondea una sola vez', () => {
    const summary = summarizePenalties(120, PENALTY_PERCENT_PER_UNIT, [
      { source: 'post_delivery', units: 2 },
      { source: 'ready_piece', units: 1 },
    ]);
    expect(summary.units).toBe(3);
    expect(summary.percent).toBe(2.5);
    expect(summary.amount).toBe(3);
    expect(summary.lines.map(line => line.amount)).toEqual([2, 1]);
  });
});

describe('corte diario y periodo de pago', () => {
  it('aplica el corte a las 18:00 de Honduras', () => {
    expect(localDateKey(latestCutoff(new Date('2026-11-14T23:59:00.000Z')))).toBe('2026-11-13');
    expect(latestCutoff(new Date('2026-11-15T00:00:00.000Z')).toISOString()).toBe('2026-11-15T00:00:00.000Z');
    expect(localDateKey(latestCutoff(new Date('2026-11-15T01:00:00.000Z')))).toBe('2026-11-14');
  });

  it('cierra el periodo el sábado a las 18:00', () => {
    const before = payPeriodFor(new Date('2026-11-14T23:59:00.000Z'));
    const after = payPeriodFor(new Date('2026-11-15T00:00:00.000Z'));
    const midweek = payPeriodFor(new Date('2026-11-18T15:00:00.000Z'));
    expect(before.end).toBe('2026-11-15T00:00:00.000Z');
    expect(after.end).toBe('2026-11-22T00:00:00.000Z');
    expect(new Date(after.end).getTime() - new Date(after.start).getTime()).toBe(7 * 86_400_000);
    expect(midweek.end).toBe('2026-11-22T00:00:00.000Z');
  });
});

describe('contadores post-entrega', () => {
  it('no cobra durante los primeros tres días', () => {
    expect(postDeliveryAccrual({ deliveredAt: DELIVERED_MONDAY, asOf: '2026-11-13T00:00:00.000Z' }).totalUnits).toBe(0);
  });

  it('cobra $1 por día desde el cuarto día', () => {
    const saturday = postDeliveryAccrual({ deliveredAt: DELIVERED_MONDAY, asOf: SATURDAY_CUTOFF });
    expect(saturday).toMatchObject({ day3: 2, day7: 0, day14Daily: 0, totalUnits: 2 });
    const sunday = postDeliveryAccrual({ deliveredAt: DELIVERED_MONDAY, asOf: SUNDAY_CUTOFF });
    expect(sunday.day3).toBe(3);
  });

  it('activa el día 7 con $2 diarios adicionales', () => {
    const day7 = postDeliveryAccrual({ deliveredAt: DELIVERED_MONDAY, asOf: MONDAY_DAY7_CUTOFF });
    expect(day7).toMatchObject({ day3: 4, day7: 2, totalUnits: 6 });
  });

  it('suma $5 una vez y $1 diario desde el día 14', () => {
    const day14 = postDeliveryAccrual({ deliveredAt: DELIVERED_MONDAY, asOf: DAY14_CUTOFF });
    expect(day14.day14OneTime).toBe(5);
    expect(day14.day14Daily).toBe(1);
    expect(day14.day3).toBe(11);
    expect(day14.day7).toBe(16);
    const next = postDeliveryAccrual({
      deliveredAt: DELIVERED_MONDAY,
      asOf: new Date(DAY14_CUTOFF.getTime() + 86_400_000),
    });
    expect(next.day14OneTime).toBe(5);
    expect(next.day14Daily).toBe(2);
  });

  it('se congela al cerrar la orden', () => {
    const closed = postDeliveryAccrual({
      deliveredAt: DELIVERED_MONDAY,
      asOf: new Date('2026-11-20T00:00:00.000Z'),
      closedAt: SATURDAY_CUTOFF.toISOString(),
    });
    expect(closed.totalUnits).toBe(2);
  });

  it('no cuenta los cortes en pausa mientras la evidencia se verifica', () => {
    const paused = postDeliveryAccrual({
      deliveredAt: DELIVERED_MONDAY,
      asOf: MONDAY_DAY7_CUTOFF,
      paused: [{ from: '2026-11-14T00:00:00.000Z', to: '2026-11-15T00:00:00.000Z' }],
    });
    expect(paused.day3).toBe(3);
    expect(paused.day7).toBe(2);
  });
});

describe('piezas listas y reclamos', () => {
  it('respeta 24 horas de gracia antes de cobrar', () => {
    const started = '2026-11-12T16:00:00.000Z';
    expect(readyPieceAccrual({ startedAt: started, asOf: '2026-11-13T00:00:00.000Z' })).toBe(0);
    expect(readyPieceAccrual({ startedAt: started, asOf: new Date('2026-11-13T16:00:00.000Z') })).toBe(0);
    expect(readyPieceAccrual({ startedAt: started, asOf: SATURDAY_CUTOFF })).toBe(2);
  });

  it('deja de cobrar cuando se registra la notificación', () => {
    const started = '2026-11-12T16:00:00.000Z';
    expect(readyPieceAccrual({
      startedAt: started,
      asOf: new Date('2026-11-20T00:00:00.000Z'),
      closedAt: SATURDAY_CUTOFF.toISOString(),
    })).toBe(2);
  });

  it('excluye piezas dentro de una pausa', () => {
    const started = '2026-11-12T16:00:00.000Z';
    expect(readyPieceAccrual({
      startedAt: started,
      asOf: SATURDAY_CUTOFF,
      paused: [{ from: SATURDAY_CUTOFF.toISOString(), to: SUNDAY_CUTOFF.toISOString() }],
    })).toBe(1);
  });
});
