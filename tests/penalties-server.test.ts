import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Pool } from 'mysql2/promise';
import {
  getUserPenaltySnapshot,
  readPenaltySettings,
  syncPenalties,
  syncPenaltiesThrottled,
  writePenaltySettings,
} from '../src/server/penalties';

type Resolver = (sql: string, params?: unknown[]) => Record<string, unknown>[];

const createPool = (resolve: Resolver) => {
  const query = vi.fn((sql: string, params?: unknown[]) =>
    Promise.resolve([resolve(sql, params), []] as [unknown[], unknown[]]));
  const execute = vi.fn((_sql: string, _params?: unknown[]) =>
    Promise.resolve([{}, []] as [unknown, unknown[]]));
  return { pool: { query, execute } as unknown as Pool, query, execute };
};

const queryFor = (handlers: Array<[RegExp, Record<string, unknown>[]]>, sql: string): Record<string, unknown>[] => {
  for (const [pattern, rows] of handlers) if (pattern.test(sql)) return rows;
  throw new Error(`Consulta no simulada: ${sql.slice(0, 80)}`);
};

const NOW = new Date('2026-11-20T18:00:00.000Z');
const SETTINGS_ON = [
  { setting_key: 'penalties.enabled', setting_value: '1', updated_at: '2026-11-14T10:00:00Z', updated_by: 3 },
  { setting_key: 'penalties.enabled_since', setting_value: '2026-11-01T00:00:00Z' },
  { setting_key: 'penalties.accrual_since', setting_value: '2026-11-01 00:00:00' },
];

describe('ajustes de penalizaciones', () => {
  it('lee los ajustes con valores por defecto y fechas inválidas', async () => {
    const empty = createPool(() => []);
    await expect(readPenaltySettings(empty.pool)).resolves.toEqual({
      enabled: true, enabledSince: null, accrualSince: null, updatedAt: null, updatedBy: null,
    });

    const invalid = createPool(() => ([
      { setting_key: 'penalties.enabled', setting_value: '0', updated_at: 'no-date', updated_by: '9' },
      { setting_key: 'penalties.enabled_since', setting_value: 'tampoco' },
      { setting_key: 'penalties.accrual_since', setting_value: new Date('2026-11-02T00:00:00Z') },
    ]));
    await expect(readPenaltySettings(invalid.pool)).resolves.toEqual({
      enabled: false, enabledSince: null, accrualSince: '2026-11-02T00:00:00.000Z', updatedAt: null, updatedBy: 9,
    });
  });

  it('no escribe cuando el estado no cambia y sí al activar o desactivar', async () => {
    const pool = createPool(sql => sql.includes('app_settings') ? SETTINGS_ON : []);
    await expect(writePenaltySettings(pool.pool, true, 9)).resolves.toMatchObject({ enabled: true });
    expect(pool.execute).not.toHaveBeenCalled();

    await writePenaltySettings(pool.pool, false, 9);
    expect(pool.execute).toHaveBeenCalledWith(
      expect.stringContaining("'penalties.enabled'"), ['0', 9],
    );

    const disabled = createPool(sql => sql.includes('app_settings')
      ? [{ setting_key: 'penalties.enabled', setting_value: '0' }]
      : []);
    await writePenaltySettings(disabled.pool, true, 4, NOW);
    expect(disabled.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO app_settings'), ['2026-11-20 18:00:00', 4],
    );
  });
});

describe('sincronización de penalizaciones', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-20T18:05:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  const handlers: Array<[RegExp, Record<string, unknown>[]]> = [
    [/FROM app_settings/, SETTINGS_ON],
    [/FROM followup_evidence/, [
      { order_id: 901, task: 'post_3', status: 'approved', created_at: '2026-11-06T00:00:00Z', reviewed_at: null },
      { order_id: 905, task: 'post_3', status: 'pending', created_at: '2026-11-07T00:00:00Z', reviewed_at: null },
      { order_id: 906, task: 'post_3', status: 'rejected', created_at: '2026-11-07T00:00:00Z', reviewed_at: '2026-11-19T00:00:00Z' },
      { order_id: 907, task: 'quote', status: 'pending', created_at: '2026-11-06T00:00:00Z', reviewed_at: null },
      { order_id: 908, task: 'post_3', status: 'pending', created_at: 'not-a-date', reviewed_at: null },
    ]],
    [/FROM users WHERE deleted_at IS NULL/, [
      { id: 7, name: 'Ana', weekly_salary: 120 },
      { id: 8, name: 'Beto', weekly_salary: 75 },
      { id: 9, name: 'Carla', weekly_salary: null },
    ]],
    [/delivered_at > \?/, [
      { order_id: 901, order_code: 'ORD-901', user_id: 7, delivered_at: '2026-11-01T16:00:00Z', first_name: 'Ana', last_name: null },
      { order_id: 902, order_code: 'ORD-902', user_id: 7, followup_user_id: 8, delivered_at: '2026-11-01T16:00:00Z', first_name: 'Beto' },
      { order_id: 903, order_code: 'ORD-903', user_id: 0, delivered_at: '2026-11-01T16:00:00Z' },
      { order_id: 904, order_code: 'ORD-904', user_id: 7, delivered_at: 'fecha-invalida' },
      { order_id: 905, order_code: 'ORD-905', user_id: 7, delivered_at: '2026-11-01T16:00:00Z' },
      { order_id: 906, order_code: 'ORD-906', user_id: 7, delivered_at: '2026-11-01T16:00:00Z' },
      { order_id: 908, order_code: 'ORD-908', user_id: 7, delivered_at: '2026-11-01T16:00:00Z' },
      { order_id: 909, order_code: 'ORD-909', user_id: 999, delivered_at: '2026-11-01T16:00:00Z' },
    ]],
    [/yard_piece_ready=1/, [
      { order_id: 910, order_code: 'ORD-910', user_id: 8, yard_piece_ready_at: '2026-11-16T16:00:00Z' },
      { order_id: 911, order_code: 'ORD-911', user_id: 7, yard_piece_ready_at: 'invalida' },
      { order_id: 912, order_code: 'ORD-912', user_id: 0, yard_piece_ready_at: '2026-11-16T16:00:00Z' },
      { order_id: 913, order_code: 'ORD-913', user_id: 7, yard_piece_ready_at: '2026-11-16T16:00:00Z', yard_piece_ready_ack_at: '2026-11-17T00:00:00Z' },
    ]],
    [/FROM claims cl/, [
      { claim_id: 50, assigned_user_id: 12, order_id: 920, order_code: 'ORD-920', user_id: 7, workflow_data: '{"claimPieceReady":true,"claimPieceReadyAt":"2026-11-16T16:00:00Z"}' },
      { claim_id: 51, assigned_user_id: null, order_id: 921, order_code: 'ORD-921', user_id: 8, workflow_data: '{"claimPieceReady":true,"claimPieceReadyAt":"2026-11-16T16:00:00Z"}' },
      { claim_id: 52, order_id: 922, order_code: 'ORD-922', user_id: 7, workflow_data: { claimPieceReady: true, claimPieceReadyAt: 'nope' } },
      { claim_id: 53, order_id: 923, order_code: 'ORD-923', user_id: 7, workflow_data: '{json roto' },
      { claim_id: 54, order_id: 924, order_code: 'ORD-924', user_id: 7, workflow_data: '{"claimPieceReady":false}' },
      { claim_id: 55, order_id: 925, order_code: 'ORD-925', user_id: 7, workflow_data: '{"claimPieceReady":true,"claimPieceReadyAt":"2026-11-16T16:00:00Z"}', resolved_at: '2026-11-17T00:00:00Z' },
    ]],
  ];

  it('liquida periodos vencidos y acumula contadores post-entrega, pieza lista y reclamos', async () => {
    const pool = createPool(sql => queryFor(handlers, sql));
    await syncPenalties(pool.pool, NOW);

    expect(pool.execute).toHaveBeenCalledWith(
      expect.stringContaining("status='liquidated'"), ['2026-11-20 00:00:00'],
    );
    const inserts = pool.execute.mock.calls
      .map(call => call[1] as unknown[])
      .filter(args => Array.isArray(args) && args.length === 12);
    const keys = inserts.map(args => args[3]);
    expect(keys).toEqual(expect.arrayContaining([
      'post_3', 'post_7', 'post_14', 'ready_piece-2026-11-16', 'claim-51-2026-11-16',
    ]));
    expect(keys).not.toContain('claim-50-2026-11-16');
    expect(keys).not.toContain('claim-53-2026-11-16');
    expect(keys).not.toContain('claim-55-2026-11-16');

    const post3 = inserts.find(args => args[0] === 901 && args[3] === 'post_3');
    const post7 = inserts.find(args => args[0] === 901 && args[3] === 'post_7');
    const post14 = inserts.find(args => args[0] === 901 && args[3] === 'post_14');
    expect(post3?.slice(4, 9)).toEqual([15, 0.8333, 12.5, 120, 15]);
    expect(post7?.slice(4, 9)).toEqual([24, 0.8333, 20, 120, 24]);
    expect(post14?.slice(4, 9)).toEqual([10, 0.8333, 8.33, 120, 10]);
    expect(post3?.[9]).toBe('2026-11-15 00:00:00');
    expect(post3?.[10]).toBe('2026-11-22 00:00:00');

    const paused = inserts.find(args => args[0] === 905 && args[3] === 'post_3');
    expect(paused?.[4]).toBe(1);
    const rejected = inserts.find(args => args[0] === 906 && args[3] === 'post_3');
    expect(rejected?.[4]).toBe(3);
    expect(rejected?.[4]).toBeLessThan(15);
    const assigned = inserts.find(args => args[0] === 902 && args[3] === 'post_3');
    expect(assigned?.[1]).toBe(8);
    expect(assigned?.slice(4, 9)).toEqual([15, 0.8333, 12.5, 75, 9.38]);

    const ready = inserts.find(args => args[0] === 910);
    expect(ready?.slice(2, 9)).toEqual(['ready_piece', 'ready_piece-2026-11-16', 3, 0.8333, 2.5, 75, 1.88]);
    const claim = inserts.find(args => args[0] === 921);
    expect(claim?.slice(1, 9)).toEqual([8, 'claim', 'claim-51-2026-11-16', 3, 0.8333, 2.5, 75, 1.88]);
  });

  it('no acumula cuando el interruptor está apagado y crea la fecha base si falta', async () => {
    const disabled = createPool(sql => sql.includes('app_settings')
      ? [{ setting_key: 'penalties.enabled', setting_value: '0' }]
      : []);
    await syncPenalties(disabled.pool, NOW);
    expect(disabled.execute).toHaveBeenCalledTimes(1);

    const missing = createPool(sql => {
      if (sql.includes('FROM app_settings')) return [{ setting_key: 'penalties.enabled', setting_value: '1' }];
      if (sql.includes('FROM followup_evidence')) return [];
      return [];
    });
    await syncPenalties(missing.pool, NOW);
    expect(missing.execute).toHaveBeenCalledWith(
      expect.stringContaining("'penalties.accrual_since'"), ['2026-11-20 18:00:00'],
    );
  });

  it('limita la sincronización automática por intervalo', async () => {
    const pool = createPool(sql => queryFor(handlers, sql));
    await syncPenaltiesThrottled(pool.pool, NOW, 60_000);
    const calls = pool.execute.mock.calls.length;
    await syncPenaltiesThrottled(pool.pool, NOW, 60_000);
    expect(pool.execute).toHaveBeenCalledTimes(calls);
    vi.setSystemTime(new Date('2026-11-20T19:05:00Z'));
    await syncPenaltiesThrottled(pool.pool, NOW, 60_000);
    expect(pool.execute.mock.calls.length).toBeGreaterThan(calls);
  });
});

describe('instantánea del usuario', () => {
  const handlers: Array<[RegExp, Record<string, unknown>[]]> = [
    [/FROM app_settings/, SETTINGS_ON],
    [/FROM users WHERE id=\?/, [{ id: 7, weekly_salary: 75 }]],
    [/FROM order_penalties p/, [
      { source: 'post_delivery', units: 2, percent: 3, amount: 2.25, period_end: '2026-11-22 00:00:00', cutoff_at: NOW, status: 'pending', order_id: 901, order_code: 'ORD-901', first_name: 'Ana', last_name: 'Pérez', delivered_at: '2026-11-01T16:00:00Z', workflow_data: null },
      { source: 'ready_piece', units: 1, percent: 1.5, amount: 1.13, period_end: '2026-11-22 00:00:00', cutoff_at: NOW, status: 'liquidated', order_id: 910, order_code: 'ORD-910', first_name: 'Beto', yard_piece_ready_at: '2026-11-16T16:00:00Z' },
      { source: 'claim', units: 3, percent: 4.5, amount: 3.38, period_end: '2026-11-22 00:00:00', status: 'pending', order_id: 921, order_code: 'ORD-921', workflow_data: '{"claimPieceReadyAt":"2026-11-16T16:00:00Z"}' },
      { source: 'claim', units: 5, percent: 7.5, amount: 5.63, period_end: '2026-11-22 00:00:00', status: 'void', order_id: 922, order_code: 'ORD-922' },
      { source: 'claim', units: 5, percent: 7.5, amount: 5.63, period_end: '2026-11-22 00:00:00', status: 'rejected', order_id: 923, order_code: 'ORD-923' },
    ]],
    [/FROM order_penalties$|GROUP BY period_end, status/, [
      { period_end: new Date('2026-11-15T00:00:00Z'), units: 4, amount: 4.5, cutoff_at: new Date('2026-11-15T00:00:00Z'), status: 'liquidated' },
      { period_end: new Date('2026-11-08T00:00:00Z'), units: 2, amount: 2.25, cutoff_at: null, status: 'liquidated' },
    ]],
  ];

  it('agrega líneas abiertas, detalles vigentes e historial con la tarifa única', async () => {
    const pool = createPool(sql => queryFor(handlers, sql));
    const snapshot = await getUserPenaltySnapshot(pool.pool, 7, NOW);
    expect(snapshot).toMatchObject({
      userId: 7, weeklySalary: 75, rate: 0.8333, enabled: true,
      period: { end: '2026-11-22T00:00:00.000Z', label: 'Sábado 21', cutoffLabel: 'Se descuenta el sábado 21 a las 6:00 p. m.' },
      open: { units: 6, percent: 5, amount: 3.75 },
    });
    expect(snapshot.details.map(line => line.source)).toEqual(['post_delivery', 'ready_piece', 'claim']);
    expect(snapshot.details[0]).toMatchObject({
      customerName: 'Ana Pérez', date: '2026-11-01T16:00:00.000Z', nextDueDate: null,
    });
    expect(snapshot.details[1].date).toBe('2026-11-16T16:00:00.000Z');
    expect(snapshot.details[2].date).toBe('2026-11-16T16:00:00.000Z');
    expect(snapshot.history).toEqual([
      { periodEnd: '2026-11-15T00:00:00.000Z', units: 4, percent: 3.33, amount: 4.5, cutAt: '2026-11-15T00:00:00.000Z', status: 'liquidated' },
      { periodEnd: '2026-11-08T00:00:00.000Z', units: 2, percent: 1.67, amount: 2.25, cutAt: '', status: 'liquidated' },
    ]);
  });

  it('usa la tarifa única y salario nulo cuando el usuario no existe', async () => {
    const pool = createPool(sql => sql.includes('app_settings') ? [] : []);
    const snapshot = await getUserPenaltySnapshot(pool.pool, 404, NOW);
    expect(snapshot).toMatchObject({
      weeklySalary: null, rate: 0.8333, details: [], history: [],
      open: { units: 0, percent: 0, amount: 0 },
    });
  });
});
