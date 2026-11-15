import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { getWeeklyPerformance } from '../src/server/performance';

type Resolver = (sql: string) => Record<string, unknown>[];

const createPool = (resolve: Resolver) => {
  const query = vi.fn((sql: string) =>
    Promise.resolve([resolve(sql), []] as [unknown[], unknown[]]));
  return { pool: { query } as unknown as Pool, query };
};

const NOW = new Date('2026-11-20T18:00:00.000Z');

const team = [
  { id: 1, name: 'Ana', role: 'advisor' },
  { id: 2, name: 'Beto', role: 'advisor' },
  { id: 3, name: 'Carla', role: 'admin' },
];

const handlers: Array<[RegExp, Record<string, unknown>[]]> = [
  [/active=1/, team],
  [/FROM orders/, [
    { id: 1, user_id: 1, status: 'Pagado', created_at: '2026-11-16T16:00:00Z', price: 80, shipping_cost: 10, core_fee: 10 },
    { id: 2, user_id: 1, status: 'En preparación', created_at: '2026-11-17T16:00:00Z', price: 50, shipping_cost: null, core_fee: null },
    { id: 3, user_id: 1, status: 'Cotización', created_at: '2026-11-18T16:00:00Z', price: 999 },
    { id: 4, user_id: 1, status: 'Archivado', created_at: '2026-11-18T17:00:00Z', price: 999 },
    { id: 5, user_id: 2, status: 'Pagado', created_at: '2026-11-18T18:00:00Z', price: 250, shipping_cost: 30, core_fee: 20 },
    { id: 6, user_id: 4, status: 'Pagado', created_at: '2026-11-19T16:00:00Z', price: 500 },
  ]],
  [/FROM status_orders/, [{ user_id: 1, total: 1 }, { user_id: 4, total: 9 }]],
  [/FROM claims/, [{ resolved_by: 1, total: 1 }, { resolved_by: 4, total: 5 }]],
  [/FROM order_workflow_events/, [{ actor_id: 1, total: 1 }, { actor_id: 2, total: 1 }]],
];

const resolve = (sql: string): Record<string, unknown>[] => {
  for (const [pattern, rows] of handlers) if (pattern.test(sql)) return rows;
  throw new Error(`Consulta no simulada: ${sql.slice(0, 80)}`);
};

describe('rendimiento semanal', () => {
  it('agrega ventas, cierres, resoluciones, serie diaria y puesto del empleado', async () => {
    const pool = createPool(resolve);
    const snapshot = await getWeeklyPerformance(pool.pool, 1, NOW);

    expect(snapshot.period).toEqual({
      start: '2026-11-15T00:00:00.000Z',
      end: '2026-11-22T00:00:00.000Z',
      label: 'Sábado 21 · 2026-11-14 → 2026-11-21',
    });
    expect(snapshot.me).toEqual({
      userId: 1, name: 'Ana', role: 'advisor', salesCount: 2, salesAmount: 150,
      closures: 1, resolutions: 2, rank: 2, totalEmployees: 3,
    });
    expect(snapshot.team).toEqual({
      totalEmployees: 3,
      averageSalesAmount: 150,
      averageSalesCount: 1,
      averageClosures: 0.3,
      averageResolutions: 1,
    });
    expect(snapshot.ranking.map(entry => [entry.userId, entry.salesAmount, entry.isMe])).toEqual([
      [2, 300, false], [1, 150, true], [3, 0, false],
    ]);
    expect(snapshot.series).toHaveLength(7);
    expect(snapshot.series[0].label).toBe('Sáb');
    expect(snapshot.series.reduce((total, day) => total + day.amount, 0)).toBe(150);
    expect(snapshot.series.reduce((total, day) => total + day.count, 0)).toBe(2);
    expect(snapshot.series.find(day => day.date === '2026-11-16')).toMatchObject({ amount: 100, count: 1 });
  });

  it('incluye al usuario objetivo aunque no esté activo y ordena a los empatados por nombre', async () => {
    const pool = createPool(sql => {
      if (/WHERE id=\?/.test(sql)) return [{ id: 9, name: 'Zoe', role: 'advisor' }];
      return resolve(sql);
    });
    const snapshot = await getWeeklyPerformance(pool.pool, 9, NOW);
    expect(snapshot.me).toMatchObject({ userId: 9, name: 'Zoe', rank: 4, totalEmployees: 4 });
    expect(snapshot.ranking.map(entry => entry.name)).toEqual(['Beto', 'Ana', 'Carla', 'Zoe']);
    expect(snapshot.ranking[3].isMe).toBe(true);
  });

  it('devuelve una instantánea vacía cuando el objetivo no existe', async () => {
    const pool = createPool(sql => /WHERE id=\?/.test(sql) ? [] : resolve(sql));
    const snapshot = await getWeeklyPerformance(pool.pool, 42, NOW);
    expect(snapshot.me).toEqual({
      userId: 42, name: '', role: '', salesCount: 0, salesAmount: 0,
      closures: 0, resolutions: 0, rank: 1, totalEmployees: 3,
    });
  });
});
