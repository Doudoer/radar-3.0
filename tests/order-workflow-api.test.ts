import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import mysql, { type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import { enforceWorkflowUpdate, handleWorkflowRequest, recordWorkflowReopening, workflowActionSchema, workflowOrderFromRow } from '../src/server/orderWorkflow';

vi.mock('../src/server/config', () => ({ pool: {}, maxBodyBytes: 50000, jwtSecret: 'test-only', frontendRoot: '' }));
const pools: Pool[] = [];
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await Promise.all(pools.splice(0).map(pool => pool.end())); });
const row = {
  id: 901, order_code: 'ORD-TEST', user_id: 7, advisor: 'Assigned operator', version: 1,
  created_at: new Date('2026-10-21T16:00:00Z'), status: 'Pagado', delivered_at: null,
  scheduled_pickup_at: null, price: 100, core_fee: 0, shipping_cost: 0, down_payment: 100,
  workflow_step: 1, customer_id: 1, customer_first_name: 'Test', customer_phone: '555',
};
const setup = (overrides: Partial<typeof row> = {}, eventRows: Record<string, unknown>[] = []) => {
  const database = mysql.createPool({ host: '127.0.0.1', port: 1, user: 'test', connectTimeout: 1 });
  pools.push(database);
  const connection = Object.assign(database, {
    connection: database,
    beginTransaction: vi.fn().mockResolvedValue(undefined), commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
    query: vi.fn<Pool['query']>()
      .mockResolvedValue([[], []])
      .mockResolvedValueOnce([[{ ...row, ...overrides }] as RowDataPacket[], []])
      .mockResolvedValueOnce([eventRows as RowDataPacket[], []])
      .mockResolvedValueOnce([[{ name: 'Authenticated actor' }] as RowDataPacket[], []]),
    execute: vi.fn<Pool['execute']>().mockResolvedValue([{ constructor: { name: 'ResultSetHeader' }, insertId: 21, affectedRows: 1, fieldCount: 0, info: '', serverStatus: 0, warningStatus: 0, changedRows: 0 }, []]),
  });
  vi.spyOn(database, 'getConnection').mockResolvedValue(connection);
  return { database, connection };
};
const request = (method = 'POST', action: Record<string, unknown> = {}) => {
  const req = new IncomingMessage(new Socket());
  req.method = method; req.headers = { 'content-type': 'application/json' };
  req.push(Buffer.from(JSON.stringify(action))); req.push(null);
  const res = new ServerResponse(req);
  const end = vi.spyOn(res, 'end').mockReturnValue(res);
  return { req, res, end };
};
const action = { version: 1, task: 'quote', outcome: 'completed', notes: 'Cotización confirmada', evidence: 'Conversation reference', confirmed: true };

describe('workflow API transactional enforcement', () => {
  it('rejects forged actors, impossible dates, invalid task and stale input shapes', () => {
    expect(workflowActionSchema.safeParse({ ...action, actorId: 8 }).success).toBe(false);
    expect(workflowActionSchema.safeParse({ ...action, nextDueDate: '2026-02-31' }).success).toBe(false);
    expect(workflowActionSchema.safeParse({ ...action, task: 'arbitrary' }).success).toBe(false);
    expect(workflowActionSchema.safeParse({ ...action, version: 0 }).success).toBe(false);
  });
  it('records the authenticated actor and commits only after evidence and version are checked', async () => {
    const { database, connection } = setup();
    const { req, res, end } = request('POST', action);
    const broadcast = vi.fn();
    expect(await handleWorkflowRequest(req, res, '/api/orders/901/workflow', { sub: '7', role: 'operator' }, database, broadcast)).toBe(true);
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(String(end.mock.calls[0][0]))).toMatchObject({ version: 2, eventId: '21' });
    const insert = connection.execute.mock.calls.find(call => String(call[0]).includes('INSERT INTO order_workflow_events'));
    expect(insert?.[1]).toContain('Authenticated actor');
    expect(insert?.[1]).not.toContain('Assigned operator');
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledOnce();
    for (const call of connection.execute.mock.calls) {
      if (Array.isArray(call[1])) expect(call[1]).not.toContain(undefined);
    }
  });
  it('rolls back ownership, version and evidence failures without writes or success notifications', async () => {
    for (const variant of [
      { user: 8, body: action }, { user: 7, body: { ...action, version: 2 } },
      { user: 7, body: { ...action, evidence: '' } }, { user: 7, body: { ...action, task: 'ack' } },
    ]) {
      const { database, connection } = setup();
      const { req, res } = request('POST', variant.body);
      const broadcast = vi.fn();
      await expect(handleWorkflowRequest(req, res, '/api/orders/901/workflow', { sub: String(variant.user), role: 'operator' }, database, broadcast)).rejects.toThrow();
      expect(connection.execute).not.toHaveBeenCalled();
      expect(connection.rollback).toHaveBeenCalledOnce();
      expect(connection.release).toHaveBeenCalledOnce();
      expect(broadcast).not.toHaveBeenCalled();
    }
  });
  it('surfaces storage failures and never acknowledges uncommitted actions', async () => {
    const { database, connection } = setup();
    connection.execute.mockRejectedValueOnce(new Error('Database write failed'));
    const { req, res } = request('POST', action);
    const broadcast = vi.fn();
    await expect(handleWorkflowRequest(req, res, '/api/orders/901/workflow', { sub: '7', role: 'admin' }, database, broadcast)).rejects.toThrow('Database write failed');
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(broadcast).not.toHaveBeenCalled();
  });
  it('filters the operator queue by authenticated ID, not an advisor name', async () => {
    const { database, connection } = setup();
    const { req, res, end } = request('GET');
    await handleWorkflowRequest(req, res, '/api/workflow/tasks', { sub: '7', role: 'operator' }, database, vi.fn());
    expect(connection.query.mock.calls[0][0]).toContain('o.user_id=?');
    expect(connection.query.mock.calls[0][1]).toEqual([7]);
    const result = JSON.parse(String(end.mock.calls[0][0]));
    expect(result.tasks[0].order.userId).toBe(7);
    expect(result.operators).toEqual([]);
  });
  it('blocks direct workflow and delivery edits while preserving unrelated edits and old orders', async () => {
    const { connection } = setup();
    const prev = row as RowDataPacket;
    await expect(enforceWorkflowUpdate(connection as PoolConnection, prev, { status: 'pagado', workflowStep: 2 })).rejects.toThrow(/etapas/);
    await expect(enforceWorkflowUpdate(connection as PoolConnection, prev, { status: 'entregado', workflowStep: 1 })).rejects.toThrow(/entrega física/);
    await expect(enforceWorkflowUpdate(connection as PoolConnection, prev, { status: 'pagado', workflowStep: 1 })).resolves.toBeUndefined();
    await expect(enforceWorkflowUpdate(connection as PoolConnection, { ...prev, created_at: new Date('2026-10-20T12:00:00Z') } as RowDataPacket, { status: 'entregado', workflowStep: 4 })).resolves.toBeUndefined();
  });
  it('exposes supervisor objectives separately from attempts and external blocks', async () => {
    vi.setSystemTime(new Date('2026-11-05T16:00:00Z'));
    const { database } = setup({}, [{
      id: 1, order_id: 901, task: 'quote', outcome: 'completed', actor_id: 7, actor_name: 'Actor',
      created_at: new Date('2026-10-22T16:00:00Z'), task_due_date: new Date('2026-10-22T00:00:00Z'),
      notes: 'Confirmed', evidence: 'Reference',
    }, {
      id: 2, order_id: 901, task: 'ack', outcome: 'blocked', actor_id: 7, actor_name: 'Actor',
      created_at: new Date('2026-11-05T16:00:00Z'), next_due_date: new Date('2026-11-06T00:00:00Z'), blocked_by: 'Inventario',
      notes: 'Waiting', evidence: '', next_action: 'Revisar pieza',
    }]);
    const { req, res, end } = request('GET');
    await handleWorkflowRequest(req, res, '/api/workflow/tasks', { sub: '7', role: 'admin' }, database, vi.fn());
    const data = JSON.parse(String(end.mock.calls[0][0]));
    expect(data.operators[0]).toMatchObject({ completed: 1, onTime: 1, blocked: 1, escalated: 0, overdue: 0 });
    expect(data.tasks[0].bucket).toBe('blocked');
  });
  it('preserves historical contacts without fabricating their stage evidence', async () => {
    const { database, connection } = setup();
    connection.query.mockReset().mockResolvedValueOnce([[row] as RowDataPacket[], []]).mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: 1, operator_name: 'Historical actor', notes: 'Historical contact', created_at: row.created_at }] as RowDataPacket[], []]);
    const { req, res, end } = request('GET');
    await handleWorkflowRequest(req, res, '/api/orders/901/workflow', { sub: '7', role: 'admin' }, database, vi.fn());
    const data = JSON.parse(String(end.mock.calls[0][0]));
    expect(data.events).toEqual([]);
    expect(data.contacts[0].actor).toBe('Historical actor');
    expect(data.tasks[0].task).toBe('quote');
  });
  it('requires all earlier objectives before preparation and ready states', async () => {
    for (const status of ['pagado', 'en_preparacion', 'listo_retiro', 'en_camino']) {
      const { connection } = setup();
      connection.query.mockReset().mockResolvedValue([[], []]);
      await expect(enforceWorkflowUpdate(connection, { ...row, status: 'Cotización' } as RowDataPacket, { status })).rejects.toThrow(/etapas previas/);
    }
  });
  it('records status reactivation and case-resolution reopenings with a new review date', async () => {
    for (const status of ['Entregado', 'Reclamo', 'Cancelado']) {
      const { connection } = setup();
      connection.query.mockReset().mockResolvedValue([[{ name: 'Authenticated actor' }] as RowDataPacket[], []]);
      await recordWorkflowReopening(connection, { ...row, status } as RowDataPacket, 'en_preparacion', { sub: '7', role: 'admin' });
      expect(connection.execute).toHaveBeenCalledOnce();
      expect(connection.execute.mock.calls[0][0]).toContain("'reopened'");
      expect(connection.execute.mock.calls[0][1]).toContain(status === 'Cancelado' ? 'quote' : 'prepare');
    }
  });
  it('completes delivery in the same transaction and never changes an existing original warranty date', async () => {
    const deliveredAt = new Date('2026-11-01T16:00:00Z');
    const events = ['quote', 'ack', 'prepare'].map((task, i) => ({
      id: i + 1, order_id: 901, task, outcome: 'completed', actor_id: 7, actor_name: 'Actor',
      created_at: row.created_at, notes: 'Confirmed', evidence: 'Reference',
    }));
    const { database, connection } = setup({ status: 'Listo para Retiro', delivered_at: deliveredAt }, events);
    const { req, res } = request('POST', { ...action, task: 'delivery' });
    await handleWorkflowRequest(req, res, '/api/orders/901/workflow', { sub: '7', role: 'admin' }, database, vi.fn());
    const delivery = connection.execute.mock.calls.find(call => String(call[0]).includes('warranty_started=1'));
    expect(delivery?.[1]).toContain('2026-11-01 16:00:00');
    expect(connection.commit).toHaveBeenCalledOnce();
  });
  it('mirrors verified post-delivery actions to existing contact reporting without claiming a WhatsApp send', async () => {
    vi.setSystemTime(new Date('2026-11-05T16:00:00Z'));
    const events = ['quote', 'ack', 'prepare', 'delivery'].map((task, i) => ({
      id: i + 1, order_id: 901, task, outcome: 'completed', actor_id: 7, actor_name: 'Actor',
      created_at: row.created_at, notes: 'Confirmed', evidence: 'Reference',
    }));
    const { database, connection } = setup({ status: 'Entregado', delivered_at: new Date('2026-11-01T16:00:00Z') }, events);
    const { req, res } = request('POST', { ...action, task: 'post_3', contactResult: 'sms_replied', partStatus: 'installed_ok' });
    await handleWorkflowRequest(req, res, '/api/orders/901/workflow', { sub: '7', role: 'operator' }, database, vi.fn());
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('INSERT INTO order_delivery_followups'))).toBe(true);
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('whatsapp_dispatched)') && String(call[0]).includes('0)'))).toBe(true);
    expect(connection.commit).toHaveBeenCalledOnce();
  });
  it('rejects unknown persisted statuses, unavailable orders and inappropriate methods', async () => {
    expect(() => workflowOrderFromRow({ ...row, status: 'bad' } as RowDataPacket)).toThrow();
    const { database, connection } = setup();
    connection.query.mockReset().mockResolvedValue([[], []]);
    const missing = request('GET');
    await expect(handleWorkflowRequest(missing.req, missing.res, '/api/orders/901/workflow', { sub: '7', role: 'operator' }, database, vi.fn())).rejects.toThrow(/no encontrada/);
    const unsupported = request('DELETE');
    await handleWorkflowRequest(unsupported.req, unsupported.res, '/api/workflow/tasks', { sub: '7', role: 'admin' }, database, vi.fn());
    expect(unsupported.res.statusCode).toBe(405);
    const unrelated = request('GET');
    expect(await handleWorkflowRequest(unrelated.req, unrelated.res, '/api/customers', { sub: '7', role: 'admin' }, database, vi.fn())).toBe(false);
  });
  it('allows an administrator to reactivate a terminal order and then regularize its stages', async () => {
    const { connection } = setup();
    connection.query.mockReset().mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ name: 'Authenticated actor' }] as RowDataPacket[], []]);
    await expect(enforceWorkflowUpdate(connection, { ...row, status: 'Cancelado' } as RowDataPacket, { status: 'pagado', workflowStep: 1 }, { sub: '7', role: 'admin' })).resolves.toBeUndefined();
    expect(connection.execute).toHaveBeenCalledOnce();
  });
});
