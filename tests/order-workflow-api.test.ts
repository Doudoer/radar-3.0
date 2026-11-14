import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import mysql, { type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import { enforceWorkflowUpdate, handleWorkflowRequest, recordWorkflowReopening, workflowActionSchema, workflowOrderFromRow } from '../src/server/orderWorkflow';
import { unlockFinanceVault } from '../src/server/financeVault';
import { preparationSchema } from '../src/utils/orderPreparation';

vi.mock('../src/server/config', () => ({ pool: {}, maxBodyBytes: 50000, jwtSecret: 'test-only', frontendRoot: '' }));
const pools: Pool[] = [];
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await Promise.all(pools.splice(0).map(pool => pool.end())); });
const row = {
  id: 901, order_code: 'ORD-TEST', user_id: 7, advisor: 'Assigned operator', version: 1,
  created_at: new Date('2026-10-21T16:00:00Z'), status: 'Pagado', delivered_at: null as Date | string | null,
  scheduled_pickup_at: null, price: 100, core_fee: 0, shipping_cost: 0, down_payment: 100,
  workflow_step: 1, customer_id: 1, customer_first_name: 'Test', customer_phone: '555',
  yard_piece_ready: 0,
  yard_piece_ready_ack_at: null as Date | string | null,
  workflow_data: null as string | null,
  confirmation_policy: null as string | null, confirmation_policy_at: null as Date | null,
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
const management = { notes: 'Cliente confirma', evidence: 'Conversation reference', confirmed: true };
const unlockVault = (req: IncomingMessage, res: ServerResponse, claims: { sub: string; role: string }) => {
  const token = 'test-session-token';
  req.headers.authorization = `Bearer ${token}`;
  unlockFinanceVault(res, claims as any, token);
  const header = res.getHeader('Set-Cookie');
  const cookies = Array.isArray(header) ? header : [String(header || '')];
  const finance = cookies.find(value => value.startsWith('radar_finance='));
  req.headers.cookie = finance ? finance.split(';')[0] : '';
};
const action = { version: 1, task: 'ack', outcome: 'completed', downpayment: [{ method: 'cash', amount: 100, receivedBy: 'Cash receiver', receipt: null }] };
const preparation = preparationSchema.parse({
  yardNotified: true, channel: 'call', failedCall: false, failedCallNotes: '', customerConfirmed: true,
  dateFrom: '2099-01-02', dateTo: '2099-01-04', balanceNotified: true, paymentMethodsNotified: true,
  corePlan: 'return_core', deliveryType: 'retiro_tienda', address: '', screenshots: [],
});
const acknowledged = [{ id: 1, order_id: 901, task: 'ack', outcome: 'completed', notes: 'Existing confirmation', evidence: '', actor_id: 7, created_at: new Date().toISOString() }];

describe('workflow API transactional enforcement', () => {
  it('routes delegated tasks without exposing the seller task to the assignee or unassigned yard followup to the seller', async () => {
    for (const [actor, extra, expected] of [
      ['8', { followup_user_id: 8, followup_advisor: 'Delegated', status: 'Entregado', delivered_at: '2026-11-01T16:00:00Z' }, 1],
      ['7', { followup_user_id: 8, followup_advisor: 'Delegated', status: 'Entregado', delivered_at: '2026-11-01T16:00:00Z' }, 0],
      ['7', { is_yard_sale: 1, status: 'Entregado', delivered_at: '2026-11-01T16:00:00Z' }, 0],
      ['8', { followup_user_id: 8, status: 'Pagado', delivered_at: null }, 0],
    ] as const) {
      const { database, connection } = setup();
      connection.query.mockReset().mockResolvedValue([[], []]).mockResolvedValueOnce([[{ ...row, ...extra }] as RowDataPacket[], []]);
      const { req, res, end } = request('GET');
      await handleWorkflowRequest(req, res, '/api/workflow/tasks', { sub: actor, role: 'operator' }, database, vi.fn());
      expect(JSON.parse(String(end.mock.calls[0][0])).tasks).toHaveLength(expected);
    }
  });
  it('allows only admin to assign an active advisor, with version lock and no commercial or milestone writes', async () => {
    const { database, connection } = setup();
    connection.query.mockReset().mockResolvedValue([[], []])
      .mockResolvedValueOnce([[{ ...row }] as RowDataPacket[], []])
      .mockResolvedValueOnce([[{ id: 8 }] as RowDataPacket[], []]);
    const { req, res, end } = request('POST', { version: 1, advisorId: 8 });
    const broadcast = vi.fn();
    await handleWorkflowRequest(req, res, '/api/orders/901/workflow/assignee', { sub: '1', role: 'admin' }, database, broadcast);
    expect(JSON.parse(String(end.mock.calls[0][0]))).toEqual({ ok: true, version: 2 });
    expect(connection.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(connection.query.mock.calls[1][0]).toContain("role='operator' AND active=1 AND deleted_at IS NULL");
    expect(connection.execute.mock.calls.map(call => String(call[0]))).toEqual([
      expect.stringContaining('INSERT INTO order_followup_assignments'),
      expect.stringContaining('INSERT INTO audit_logs'),
      'UPDATE orders SET version=version+1 WHERE id=?',
    ]);
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(broadcast).toHaveBeenCalledOnce();
  });
  it('rejects missing orders, stale assignment versions and inactive/invalid advisors without writes', async () => {
    for (const variant of [
      { orders: [], version: 1, message: /encontrada/ },
      { orders: [row], version: 2, message: /cambió/ },
      { orders: [row], version: 1, message: /activo/ },
    ]) {
      const { database, connection } = setup();
      connection.query.mockReset().mockResolvedValue([[], []]).mockResolvedValueOnce([variant.orders as RowDataPacket[], []]);
      const { req, res } = request('POST', { version: variant.version, advisorId: 8 });
      const broadcast = vi.fn();
      await expect(handleWorkflowRequest(req, res, '/api/orders/901/workflow/assignee', { sub: '1', role: 'admin' }, database, broadcast)).rejects.toThrow(variant.message);
      expect(connection.execute).not.toHaveBeenCalled();
      expect(connection.rollback).toHaveBeenCalledOnce();
      expect(broadcast).not.toHaveBeenCalled();
    }
  });
  it('blocks advisor assignment requests and restores the default using an audited reset', async () => {
    for (const role of ['operator', 'vendedor_yarda']) {
      const { database, connection } = setup();
      const { req, res } = request('POST', { version: 1, advisorId: 8 });
      await handleWorkflowRequest(req, res, '/api/orders/901/workflow/assignee', { sub: '7', role }, database, vi.fn());
      expect(res.statusCode).toBe(403);
      expect(connection.beginTransaction).not.toHaveBeenCalled();
    }
    const { database, connection } = setup();
    const { req, res } = request('POST', { version: 1, advisorId: null });
    await handleWorkflowRequest(req, res, '/api/orders/901/workflow/assignee', { sub: '1', role: 'admin' }, database, vi.fn());
    expect(connection.execute.mock.calls[0]).toEqual(['DELETE FROM order_followup_assignments WHERE order_id=?', [901]]);
    expect(connection.commit).toHaveBeenCalledOnce();
  });
  it('retains completed event credit for its actual actor after reassignment', async () => {
    const { database, connection } = setup();
    connection.query.mockReset().mockResolvedValue([[], []])
      .mockResolvedValueOnce([[{ ...row, status: 'Entregado', delivered_at: '2026-11-01T16:00:00Z', followup_user_id: 8, followup_advisor: 'Delegated' }] as RowDataPacket[], []])
      .mockResolvedValueOnce([[{ ...acknowledged[0], order_id: '901', actor_name: 'Original seller' }] as RowDataPacket[], []]);
    const { req, res, end } = request('GET');
    await handleWorkflowRequest(req, res, '/api/workflow/tasks', { sub: '1', role: 'admin' }, database, vi.fn());
    const result = JSON.parse(String(end.mock.calls[0][0]));
    expect(result.operators.find((value: { userId: number }) => value.userId === 7)).toMatchObject({ completed: 1 });
    expect(result.operators.find((value: { userId: number }) => value.userId === 8)).toMatchObject({ completed: 0 });
  });
  it('stores optional conversation screenshots only after checking order ownership and image type', async () => {
    vi.setSystemTime(new Date('2026-11-05T16:00:00Z'));
    const events = ['ack', 'prepare', 'delivery'].map((task, i) => ({
      id: i + 1, task, outcome: 'completed', actor_id: 7, created_at: row.created_at, notes: 'Confirmed', evidence: 'Reference',
    }));
    for (const file of [null, { content_type: 'image/png', user_id: 8 }, { content_type: 'application/pdf', user_id: 7 }, { content_type: 'image/png', user_id: 7 }]) {
      const { database, connection } = setup({ status: 'Entregado', delivered_at: new Date('2026-11-01T16:00:00Z') }, events);
      connection.query.mockReset()
        .mockResolvedValueOnce([[{ ...row, status: 'Entregado', delivered_at: new Date('2026-11-01T16:00:00Z') }] as RowDataPacket[], []])
        .mockResolvedValueOnce([events as RowDataPacket[], []])
        .mockResolvedValueOnce([file ? [file] as RowDataPacket[] : [], []])
        .mockResolvedValue([[{ name: 'Authenticated actor' }] as RowDataPacket[], []]);
      const communication = { channel: 'whatsapp', warrantyWarningGiven: false, screenshots: ['/uploads/conversation.png'] };
      const { req, res } = request('POST', { version: 1, task: 'post_3', outcome: 'completed', notes: 'Cliente confirmó funcionamiento', confirmed: true,
        contactResult: 'sms_replied', partStatus: 'installed_ok', communication });
      const result = handleWorkflowRequest(req, res, '/api/orders/901/workflow', { sub: '7', role: 'operator' }, database, vi.fn());
      if (file?.content_type === 'image/png' && file.user_id === 7) {
        await result;
        expect(connection.query.mock.calls).toContainEqual([
          'SELECT content_type,user_id FROM uploaded_files WHERE filename=? AND order_id=?', ['conversation.png', '901'],
        ]);
        const insert = connection.execute.mock.calls.find(call => String(call[0]).includes('INSERT INTO order_workflow_events'));
        expect(insert?.[1]).toContain(JSON.stringify({ format: 'followup-contact-v1', reference: '', communication }));
        expect(connection.commit).toHaveBeenCalledOnce();
      } else {
        await expect(result).rejects.toThrow(/imagen/);
        expect(connection.execute).not.toHaveBeenCalled();
        expect(connection.rollback).toHaveBeenCalledOnce();
      }
    }
  });
  it('rejects forged actors, impossible dates, invalid task and stale input shapes', () => {
    expect(workflowActionSchema.safeParse({ ...action, actorId: 8 }).success).toBe(false);
    expect(workflowActionSchema.safeParse({ ...action, nextDueDate: '2026-02-31' }).success).toBe(false);
    expect(workflowActionSchema.safeParse({ ...action, task: 'arbitrary' }).success).toBe(false);
    expect(workflowActionSchema.safeParse({ ...action, version: 0 }).success).toBe(false);
    expect(workflowActionSchema.safeParse({ ...action, confirmationPolicy: 'preapproved' }).success).toBe(false);
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
      { user: 7, body: { ...action, downpayment: [{ ...action.downpayment[0], amount: 99 }] } }, { user: 7, body: { ...action, task: 'prepare', downpayment: undefined, ...management } },
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
    const { database, connection } = setup({ status: 'En Preparación', workflow_step: 2 }, acknowledged);
    const { req, res, end } = request('GET');
    await handleWorkflowRequest(req, res, '/api/workflow/tasks', { sub: '7', role: 'operator' }, database, vi.fn());
    expect(connection.query.mock.calls[0][0]).toContain('o.user_id=?');
    expect(connection.query.mock.calls[0][1]).toEqual([7, 7, 7]);
    const result = JSON.parse(String(end.mock.calls[0][0]));
    expect(result.tasks[0].order.userId).toBe(7);
    expect(result.operators).toEqual([]);
  });
  it('blocks direct workflow and delivery edits while preserving unrelated edits and old orders', async () => {
    const { connection } = setup();
    const prev = row as RowDataPacket;
    await expect(enforceWorkflowUpdate(connection as PoolConnection, prev, { status: 'pagado', workflowStep: 2 })).rejects.toThrow(/etapas/);
    await expect(enforceWorkflowUpdate(connection as PoolConnection, prev, { status: 'entregado', workflowStep: 1 })).rejects.toThrow(/flujo/);
    await expect(enforceWorkflowUpdate(connection as PoolConnection, prev, { status: 'pagado', workflowStep: 1 })).resolves.toBeUndefined();
    await expect(enforceWorkflowUpdate(connection as PoolConnection, { ...prev, created_at: new Date('2026-10-20T12:00:00Z') } as RowDataPacket, { status: 'entregado', workflowStep: 4 })).rejects.toThrow(/flujo/);
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
    expect(data.tasks[0].task).toBe('ack');
  });
  it('requires all earlier objectives before preparation and ready states', async () => {
    for (const status of ['en_preparacion', 'listo_retiro', 'en_camino']) {
      const { connection } = setup();
      connection.query.mockReset().mockResolvedValue([[], []]);
      await expect(enforceWorkflowUpdate(connection, { ...row, status: 'Cotización' } as RowDataPacket, { status })).rejects.toThrow(/flujo/);
    }
  });
  it('records status reactivation and case-resolution reopenings with a new review date', async () => {
    for (const status of ['Entregado', 'Reclamo', 'Cancelado']) {
      const { connection } = setup();
      connection.query.mockReset().mockResolvedValue([[{ name: 'Authenticated actor' }] as RowDataPacket[], []]);
      await recordWorkflowReopening(connection, { ...row, status } as RowDataPacket, 'en_preparacion', { sub: '7', role: 'admin' });
      expect(connection.execute).toHaveBeenCalledOnce();
      expect(connection.execute.mock.calls[0][0]).toContain("'reopened'");
      expect(connection.execute.mock.calls[0][1]).toContain(status === 'Cancelado' ? 'ack' : 'prepare');
    }
  });
  it('completes delivery in the same transaction and never changes an existing original warranty date', async () => {
    const deliveredAt = new Date('2026-11-01T16:00:00Z');
    const events = ['quote', 'ack', 'prepare'].map((task, i) => ({
      id: i + 1, order_id: 901, task, outcome: 'completed', actor_id: 7, actor_name: 'Actor',
      created_at: row.created_at, notes: 'Confirmed', evidence: 'Reference',
    }));
    const { database, connection } = setup({ status: 'Listo para Retiro', delivered_at: deliveredAt }, events);
    const { req, res } = request('POST', { ...action, task: 'delivery', downpayment: undefined, ...management });
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
    const { req, res } = request('POST', { ...action, task: 'post_3', downpayment: undefined, ...management, evidence: undefined, contactResult: 'sms_replied', partStatus: 'installed_ok', communication: { channel: 'whatsapp', warrantyWarningGiven: false } });
    await handleWorkflowRequest(req, res, '/api/orders/901/workflow', { sub: '7', role: 'operator' }, database, vi.fn());
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('INSERT INTO order_delivery_followups'))).toBe(true);
    const contact = connection.execute.mock.calls.find(call => String(call[0]).includes('INSERT INTO order_delivery_followups'));
    expect(contact?.[1]).toContain('whatsapp');
    const recorded = connection.execute.mock.calls.find(call => String(call[0]).includes('INSERT INTO order_workflow_events'));
    expect(Array.isArray(recorded?.[1]) && recorded[1].some((value: unknown) => typeof value === 'string' && value.includes('followup-contact-v1'))).toBe(true);
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('whatsapp_dispatched)') && String(call[0]).includes('0)'))).toBe(true);
    expect(connection.commit).toHaveBeenCalledOnce();
  });
  it('rejects missing channel, contradictory message results and missing warning before writing', async () => {
    vi.setSystemTime(new Date('2026-11-05T16:00:00Z'));
    const events = ['ack', 'prepare', 'delivery'].map((task, i) => ({
      id: i + 1, task, outcome: 'completed', actor_id: 7, actor_name: 'Actor', created_at: row.created_at, notes: 'Confirmed', evidence: 'Reference',
    }));
    for (const communication of [undefined, { channel: 'sms', warrantyWarningGiven: false }, { channel: 'call', warrantyWarningGiven: false }]) {
      const { database, connection } = setup({ status: 'Entregado', delivered_at: new Date('2026-11-01T16:00:00Z') }, events);
      const { req, res } = request('POST', { version: 1, task: 'post_3', outcome: 'completed', ...management,
        contactResult: 'answered', partStatus: 'not_installed', scheduledAt: '2026-11-06T18:00:00Z', communication });
      await expect(handleWorkflowRequest(req, res, '/api/orders/901/workflow', { sub: '7', role: 'operator' }, database, vi.fn())).rejects.toThrow();
      expect(connection.execute).not.toHaveBeenCalled();
      expect(connection.rollback).toHaveBeenCalledOnce();
    }
  });
  it('records unanswered WhatsApp without overwriting the previously confirmed piece state', async () => {
    vi.setSystemTime(new Date('2026-11-05T16:00:00Z'));
    const events = ['ack', 'prepare', 'delivery'].map((task, i) => ({
      id: i + 1, task, outcome: 'completed', actor_id: 7, created_at: row.created_at, notes: 'Confirmed', evidence: 'Reference',
    }));
    const { database, connection } = setup({ status: 'Entregado', delivered_at: new Date('2026-11-01T16:00:00Z') }, events);
    connection.query.mockResolvedValueOnce([[{ part_status: 'installed_ok' }] as RowDataPacket[], []]);
    const { req, res } = request('POST', { version: 1, task: 'post_3', outcome: 'no_response', notes: 'Sent actual WhatsApp without reply',
      nextAction: 'Contact again', nextDueDate: '2026-11-06', contactResult: 'sms_sent', communication: { channel: 'whatsapp', warrantyWarningGiven: false } });
    await handleWorkflowRequest(req, res, '/api/orders/901/workflow', { sub: '7', role: 'operator' }, database, vi.fn());
    const contact = connection.execute.mock.calls.find(call => String(call[0]).includes('INSERT INTO order_delivery_followups'));
    expect(contact?.[1]).toContain('installed_ok');
    expect(contact?.[1]).toContain('whatsapp');
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
  it('does not let an administrator reactivate a terminal order through the generic editor', async () => {
    const { connection } = setup();
    connection.query.mockReset().mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ name: 'Authenticated actor' }] as RowDataPacket[], []]);
    await expect(enforceWorkflowUpdate(connection, { ...row, status: 'Cancelado' } as RowDataPacket, { status: 'pagado', workflowStep: 1 }, { sub: '7', role: 'admin' })).rejects.toThrow(/flujo/);
    expect(connection.execute).not.toHaveBeenCalled();
  });
  it('allows deposit status without manual quotation evidence, but rejects duplicate quotation management', async () => {
    const { connection } = setup();
    connection.query.mockReset().mockResolvedValue([[], []]);
    await expect(enforceWorkflowUpdate(connection, { ...row, status: 'Cotización' } as RowDataPacket, { status: 'pagado' })).rejects.toThrow(/flujo/);
    const { database, connection: mutation } = setup();
    const { req, res } = request('POST', { ...action, task: 'quote', downpayment: undefined, ...management });
    await expect(handleWorkflowRequest(req, res, '/api/orders/901/workflow', { sub: '7', role: 'operator' }, database, vi.fn())).rejects.toThrow(/etapa/);
    expect(mutation.execute).not.toHaveBeenCalled();
  });
  it('maps the original quotation agent separately from the current assignee', () => {
    expect(workflowOrderFromRow({ ...row, quote_created_by: 'Original agent' } as RowDataPacket)).toMatchObject({
      advisor: 'Assigned operator', quoteCreatedBy: 'Original agent', createdAt: row.created_at.toISOString(),
    });
    expect(workflowOrderFromRow(row as RowDataPacket)).toHaveProperty('quoteCreatedBy', null);
  });
  it('documents downpayment with actor/date only and never modifies cash balances or ledger', async () => {
    const { database, connection } = setup();
    const { req, res } = request('POST', action);
    await handleWorkflowRequest(req, res, '/api/orders/901/workflow', { sub: '7', role: 'operator' }, database, vi.fn());
    const statements = connection.execute.mock.calls.map(call => String(call[0])).join('\n');
    expect(statements).toContain('downpayment_details');
    expect(statements).not.toMatch(/INSERT INTO finance_movements|down_payment=|effective_at=/);
    expect(statements).not.toContain('created_at');
    expect(connection.execute.mock.calls[0][1]).toContain(JSON.stringify(action.downpayment));
    expect(connection.commit).toHaveBeenCalledOnce();
  });
  it('preapproves a snapshotted Paid confirmation without inventing evidence or an authenticated actor', async () => {
    const policy = { confirmation_policy: 'preapproved', confirmation_policy_at: new Date('2026-11-05T16:00:00Z') };
    const { database, connection } = setup(policy);
    connection.query.mockReset().mockResolvedValueOnce([[{ ...row, ...policy }] as RowDataPacket[], []]).mockResolvedValue([[], []]);
    const { req, res, end } = request('GET');
    await handleWorkflowRequest(req, res, '/api/orders/901/workflow', { sub: '7', role: 'operator' }, database, vi.fn());
    const body = JSON.parse(String(end.mock.calls[0][0]));
    expect(body.order).toMatchObject({ status: 'pagado', paid: 100, confirmationPolicy: 'preapproved' });
    expect(body.tasks[0].task).toBe('prepare'); expect(body.events).toEqual([]);
    expect(connection.execute).not.toHaveBeenCalled();
    const attempt = setup(policy);
    const post = request('POST', action);
    await expect(handleWorkflowRequest(post.req, post.res, '/api/orders/901/workflow', { sub: '7', role: 'operator' }, attempt.database, vi.fn())).rejects.toThrow(/etapa/);
    expect(attempt.connection.execute).not.toHaveBeenCalled();
  });
  it('documents pending historical confirmation with the same deposit payload without duplicating money or changing rollout history', async () => {
    const { database, connection } = setup({ confirmation_policy: 'legacy', confirmation_policy_at: new Date('2026-11-05T16:00:00Z') });
    const { req, res } = request('POST', action);
    await handleWorkflowRequest(req, res, '/api/orders/901/workflow', { sub: '7', role: 'operator' }, database, vi.fn());
    expect(res.statusCode).toBe(201);
    expect(connection.execute.mock.calls[0][1]).toContain(JSON.stringify(action.downpayment));
    expect(connection.execute.mock.calls[0][1]).toContain('Downpayment existente documentado; no se agregó dinero al acumulado.');
    expect(connection.execute.mock.calls.map(call => call[0]).join('\n')).not.toMatch(/finance_movements|down_payment=|order_confirmation_rollout|scheduled_pickup_at=/);
    expect(connection.commit).toHaveBeenCalledOnce();
  });
  it('rejects the outdated pending historical confirmation payload without fabricating a completed step', async () => {
    const { database, connection } = setup({ confirmation_policy: 'legacy' });
    const { req, res } = request('POST', { version: 1, task: 'ack', outcome: 'completed', ...management, nextDueDate: '2099-01-01' });
    await expect(handleWorkflowRequest(req, res, '/api/orders/901/workflow', { sub: '7', role: 'operator' }, database, vi.fn())).rejects.toThrow();
    expect(connection.execute).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
  it('validates receipt scope/type/owner before committing, without inventing trusted uploads', async () => {
    for (const file of [null, { content_type: 'application/pdf', user_id: 7 }, { content_type: 'image/png', user_id: 8 }]) {
      const { database, connection } = setup();
      connection.query.mockReset()
        .mockResolvedValueOnce([[row] as RowDataPacket[], []]).mockResolvedValueOnce([[], []])
        .mockResolvedValueOnce([file ? [file] as RowDataPacket[] : [], []]);
      const { req, res } = request('POST', { ...action, downpayment: [{ ...action.downpayment[0], method: 'zelle', receipt: '/uploads/receipt.png' }] });
      await expect(handleWorkflowRequest(req, res, '/api/orders/901/workflow', { sub: '7', role: 'operator' }, database, vi.fn())).rejects.toThrow(/comprobante/);
      expect(connection.execute).not.toHaveBeenCalled();
      expect(connection.rollback).toHaveBeenCalledOnce();
      expect(connection.query.mock.calls[2][1]).toEqual(['receipt.png', '901']);
    }
    const { database, connection } = setup();
    connection.query.mockReset().mockResolvedValueOnce([[row] as RowDataPacket[], []]).mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ content_type: 'image/png', user_id: 7 }] as RowDataPacket[], []])
      .mockResolvedValueOnce([[{ name: 'Actor' }] as RowDataPacket[], []]);
    const { req, res } = request('POST', { ...action, downpayment: [{ amount: 100, method: 'card', receipt: '/uploads/receipt.png' }] });
    await handleWorkflowRequest(req, res, '/api/orders/901/workflow', { sub: '7', role: 'operator' }, database, vi.fn());
    expect(connection.commit).toHaveBeenCalledOnce();
  });
  it('moves quotation to Paid atomically when its existing advance is documented, without collecting it twice', async () => {
    const { database, connection } = setup({ status: 'Cotización' });
    const { req, res } = request('POST', action);
    await handleWorkflowRequest(req, res, '/api/orders/901/workflow', { sub: '7', role: 'operator' }, database, vi.fn());
    expect(connection.execute.mock.calls.find(call => String(call[0]) === 'UPDATE orders SET status=? WHERE id=?')?.[1]).toEqual(['Pagado', '901']);
    expect(connection.execute.mock.calls.filter(call => String(call[0]).includes('INSERT INTO status_orders'))).toHaveLength(1);
    expect(connection.execute.mock.calls.map(call => call[0]).join('\n')).not.toMatch(/finance_movements|down_payment=|core_fee=/);
    expect(connection.commit).toHaveBeenCalledOnce();
  });
  it('requires verified preparation and synchronizes pickup or delivery status, date range and address in one transaction', async () => {
    for (const deliveryType of ['retiro_tienda', 'envio_domicilio'] as const) {
      const { database, connection } = setup({}, acknowledged);
      const ready = { ...preparation, deliveryType, address: deliveryType === 'envio_domicilio' ? '123 Test Street, Test City' : '' };
      const { req, res } = request('POST', { version: 1, task: 'prepare', outcome: 'completed', preparation: ready });
      await handleWorkflowRequest(req, res, '/api/orders/901/workflow', { sub: '7', role: 'operator' }, database, vi.fn());
      expect(connection.execute.mock.calls.find(call => String(call[0]) === 'UPDATE orders SET status=? WHERE id=?')?.[1])
        .toEqual([deliveryType === 'envio_domicilio' ? 'Listo para Despacho' : 'Listo para Retiro', '901']);
      expect(connection.execute.mock.calls.find(call => String(call[0]).includes('SET preparation_details='))?.[1])
        .toEqual([JSON.stringify(ready), deliveryType === 'envio_domicilio', deliveryType === 'envio_domicilio', ready.address, '2099-01-02 16:00:00', '901']);
      expect(connection.execute.mock.calls.find(call => String(call[0]).includes('INSERT INTO order_workflow_events'))?.[1]).toContain(JSON.stringify(ready));
      expect(connection.execute.mock.calls.map(call => call[0]).join('\n')).not.toMatch(/finance_movements|core_receipts|warranty_started|down_payment=/);
      expect(connection.commit).toHaveBeenCalledOnce();
    }
  });
  it('validates every SMS screenshot belongs to the order and authenticated uploader before changing status', async () => {
    const sms = { ...preparation, channel: 'sms', failedCall: true, failedCallNotes: 'No respondió la llamada', screenshots: ['/uploads/first.png', '/uploads/second.png'] };
    for (const valid of [false, true]) {
      const { database, connection } = setup({}, acknowledged);
      connection.query.mockReset().mockResolvedValueOnce([[row] as RowDataPacket[], []]).mockResolvedValueOnce([acknowledged as RowDataPacket[], []])
        .mockResolvedValueOnce([[{ content_type: 'image/png', user_id: 7 }] as RowDataPacket[], []])
        .mockResolvedValueOnce([valid ? [{ content_type: 'image/png', user_id: 7 }] as RowDataPacket[] : [], []])
        .mockResolvedValueOnce([[{ name: 'Actor' }] as RowDataPacket[], []]);
      const { req, res } = request('POST', { version: 1, task: 'prepare', outcome: 'completed', preparation: sms });
      const run = handleWorkflowRequest(req, res, '/api/orders/901/workflow', { sub: '7', role: 'operator' }, database, vi.fn());
      if (valid) { await run; expect(connection.commit).toHaveBeenCalledOnce(); }
      else { await expect(run).rejects.toThrow(/comprobante/); expect(connection.execute).not.toHaveBeenCalled(); expect(connection.rollback).toHaveBeenCalledOnce(); }
      expect(connection.query.mock.calls[3][1]).toEqual(['second.png', '901']);
    }
  });
  it('never promotes an unanswered/blocked preparation or downgrades an already delivered historical order', async () => {
    const blocked = setup({}, acknowledged);
    const post = request('POST', { version: 1, task: 'prepare', outcome: 'blocked', notes: 'Esperar al cliente', nextAction: 'Volver a contactar', blockedBy: 'Cliente', nextDueDate: '2099-01-01' });
    await handleWorkflowRequest(post.req, post.res, '/api/orders/901/workflow', { sub: '7', role: 'operator' }, blocked.database, vi.fn());
    expect(blocked.connection.execute.mock.calls.map(call => call[0]).join('\n')).not.toContain('SET status=');
    const delivered = setup({ status: 'Entregado', delivered_at: '2026-10-25T16:00:00Z' }, acknowledged);
    const prepare = request('POST', { version: 1, task: 'prepare', outcome: 'completed', preparation });
    await expect(handleWorkflowRequest(prepare.req, prepare.res, '/api/orders/901/workflow', { sub: '7', role: 'operator' }, delivered.database, vi.fn())).rejects.toThrow(/etapa/);
    expect(delivered.connection.execute).not.toHaveBeenCalled();
  });
  it('allows only admin to mark yard piece ready, notifies advisor and admins and records audit', async () => {
    const { database, connection } = setup();
    connection.query.mockReset()
      .mockResolvedValueOnce([[{
        id: 901, version: 1, order_code: 'ORD-901', status: 'Pagado', yard_piece_ready: 0,
        user_id: 12, product_type: 'Engine', year: 2020, brand: 'Toyota', model: 'Camry',
        customer_name: 'Test Customer',
      }] as RowDataPacket[], []])
      .mockResolvedValueOnce([[{ phone: '+15550001' }, { phone: '+15550002' }, { phone: '+15550001' }] as RowDataPacket[], []]);
    const op = request('POST');
    const opDenied = await handleWorkflowRequest(op.req, op.res, '/api/orders/901/yard-ready', { sub: '7', role: 'operator' }, database, vi.fn());
    expect(opDenied).toBe(true);
    expect(op.res.statusCode).toBe(403);
    expect(connection.execute).not.toHaveBeenCalled();

    const admin = request('POST', { version: 1 });
    const adminAllowed = await handleWorkflowRequest(admin.req, admin.res, '/api/orders/901/yard-ready', { sub: '1', role: 'admin' }, database, vi.fn());
    expect(adminAllowed).toBe(true);
    expect(admin.res.statusCode).toBe(200);
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('SET yard_piece_ready=1'))).toBe(true);
    const outbox = connection.execute.mock.calls.filter(call => String(call[0]).includes('notification_outbox'));
    expect(outbox).toHaveLength(2);
    expect(outbox.map(call => JSON.parse(String(call[1]?.[0])).phone).sort()).toEqual(['+15550001', '+15550002']);
    expect(outbox[0][1]?.[0]).toContain('PIEZA LISTA EN YARDA');
    expect(JSON.parse(String(admin.end.mock.calls[0][0]))).toMatchObject({ yardPieceReady: true, notifiedRecipients: 2 });
    expect(connection.commit).toHaveBeenCalledOnce();
  });
  it('clears an active auction search when the piece is found and marked ready', async () => {
    const { database, connection } = setup();
    connection.query.mockReset()
      .mockResolvedValueOnce([[{
        id: 901, version: 1, order_code: 'ORD-901', status: 'Pagado', yard_piece_ready: 0,
        user_id: 12, product_type: 'Engine', year: 2020, brand: 'Toyota', model: 'Camry',
        customer_name: 'Test Customer',
        workflow_data: JSON.stringify({
          yardPieceUnavailable: true,
          yardPieceUnavailableReason: 'No encontrada en patio',
          yardPieceUnavailableAt: '2026-11-10T10:00:00.000Z',
        }),
      }] as RowDataPacket[], []])
      .mockResolvedValueOnce([[{ phone: '+15550001' }] as RowDataPacket[], []]);

    const admin = request('POST', { version: 1 });
    const broadcast = vi.fn();
    await handleWorkflowRequest(admin.req, admin.res, '/api/orders/901/yard-ready', { sub: '1', role: 'admin' }, database, broadcast);

    expect(admin.res.statusCode).toBe(200);
    const readyUpdate = connection.execute.mock.calls.find(call => String(call[0]).includes('SET yard_piece_ready=1'));
    expect(String(readyUpdate?.[0])).toContain('auction_search_active=0');
    const savedWorkflow = JSON.parse(String(readyUpdate?.[1]?.[1]));
    expect(savedWorkflow).toMatchObject({
      yardPieceUnavailable: false,
      yardPieceUnavailableReason: 'No encontrada en patio',
      yardPieceUnavailableResolvedBy: 1,
    });
    expect(connection.execute.mock.calls.some(call =>
      String(call[0]).includes('status_orders') && String(call[1]?.[2]).includes('Pieza localizada')
    )).toBe(true);
    expect(JSON.parse(String(admin.end.mock.calls[0][0]))).toMatchObject({ resolvedUnavailable: true });
    expect(broadcast).toHaveBeenCalledWith('order:updated', expect.objectContaining({
      action: 'YARD_PIECE_READY',
      auctionActive: false,
      yardPieceUnavailable: false,
    }));
  });
  it('allows only admin to revert a yard-ready piece and records timeline and audit', async () => {
    const { database, connection } = setup();
    connection.query.mockReset().mockResolvedValueOnce([[{
      id: 901,
      version: 2,
      order_code: 'ORD-901',
      status: 'Pagado',
      yard_piece_ready: 1,
      yard_piece_ready_at: '2026-11-13T00:00:00.000Z',
    }] as RowDataPacket[], []]);

    for (const role of ['operator', 'vendedor_yarda']) {
      const denied = request('POST', { version: 2 });
      await handleWorkflowRequest(denied.req, denied.res, '/api/orders/901/revert-yard-ready', { sub: '7', role }, database, vi.fn());
      expect(denied.res.statusCode).toBe(403);
    }
    expect(connection.execute).not.toHaveBeenCalled();

    const admin = request('POST', { version: 2 });
    const broadcast = vi.fn();
    const allowed = await handleWorkflowRequest(admin.req, admin.res, '/api/orders/901/revert-yard-ready', { sub: '1', role: 'admin' }, database, broadcast);
    expect(allowed).toBe(true);
    expect(admin.res.statusCode).toBe(200);
    expect(JSON.parse(String(admin.end.mock.calls[0][0]))).toEqual({ ok: true, yardPieceReady: false, alreadyPending: false });
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('SET yard_piece_ready=0'))).toBe(true);
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('status_orders'))).toBe(true);
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('YARD_PIECE_READY_REVERTED'))).toBe(true);
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(broadcast).toHaveBeenCalledWith('order:updated', expect.objectContaining({
      orderId: 901,
      action: 'YARD_PIECE_READY_REVERTED',
      yardPieceReady: false,
    }));
  });
  it('lets an admin clear a legacy yard-ready piece without moving an order out of preparation', async () => {
    const { database, connection } = setup();
    connection.query.mockReset().mockResolvedValueOnce([[{
      id: 901,
      version: 2,
      order_code: 'ORD-901',
      status: 'En Preparación',
      yard_piece_ready: 1,
      yard_piece_ready_at: '2026-11-13T00:00:00.000Z',
    }] as RowDataPacket[], []]);

    const denied = request('POST', { version: 2 });
    await handleWorkflowRequest(denied.req, denied.res, '/api/orders/901/revert-yard-ready', { sub: '7', role: 'operator' }, database, vi.fn());
    expect(denied.res.statusCode).toBe(403);
    expect(connection.execute).not.toHaveBeenCalled();

    const admin = request('POST', { version: 2 });
    const broadcast = vi.fn();
    await handleWorkflowRequest(admin.req, admin.res, '/api/orders/901/revert-yard-ready', { sub: '1', role: 'admin' }, database, broadcast);
    expect(admin.res.statusCode).toBe(200);
    expect(JSON.parse(String(admin.end.mock.calls[0][0]))).toEqual({ ok: true, yardPieceReady: false, alreadyPending: false });
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('SET yard_piece_ready=0'))).toBe(true);
    expect(connection.execute.mock.calls.some(call =>
      String(call[0]).includes('status_orders') && String(call[1]?.[2]).includes('permanece en preparación')
    )).toBe(true);
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('YARD_PIECE_READY_REVERTED'))).toBe(true);
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(broadcast).toHaveBeenCalledWith('order:updated', expect.objectContaining({
      action: 'YARD_PIECE_READY_REVERTED',
      yardPieceReady: false,
    }));
  });
  it('allows office roles to acknowledge a yard-ready piece and records audit', async () => {
    const notReady = setup({ status: 'Pagado', yard_piece_ready: 0 });
    const notReadyReq = request('POST');
    await expect(handleWorkflowRequest(notReadyReq.req, notReadyReq.res, '/api/orders/901/yard-ready-ack', { sub: '7', role: 'operator' }, notReady.database, vi.fn()))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(notReady.connection.execute).not.toHaveBeenCalled();

    const denied = setup({ status: 'Pagado', yard_piece_ready: 1 });
    const deniedReq = request('POST');
    await handleWorkflowRequest(deniedReq.req, deniedReq.res, '/api/orders/901/yard-ready-ack', { sub: '7', role: 'vendedor_yarda' }, denied.database, vi.fn());
    expect(deniedReq.res.statusCode).toBe(403);
    expect(denied.connection.beginTransaction).not.toHaveBeenCalled();

    for (const role of ['admin', 'operator']) {
      const { database, connection } = setup({ status: 'Pagado', yard_piece_ready: 1 });
      const { req, res, end } = request('POST');
      const broadcast = vi.fn();
      await handleWorkflowRequest(req, res, '/api/orders/901/yard-ready-ack', { sub: '7', role }, database, broadcast);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(String(end.mock.calls[0][0]))).toMatchObject({ ok: true, alreadyAcknowledged: false });
      expect(connection.execute.mock.calls.some(call =>
        String(call[0]).includes('yard_piece_ready_ack_at=?') && String(call[0]).includes('yard_piece_ready_ack_by=?')
      )).toBe(true);
      expect(connection.execute.mock.calls.some(call => String(call[0]).includes('YARD_PIECE_READY_ACKNOWLEDGED'))).toBe(true);
      expect(connection.commit).toHaveBeenCalledOnce();
      expect(broadcast).toHaveBeenCalledWith('order:updated', expect.objectContaining({
        action: 'YARD_PIECE_READY_ACKNOWLEDGED',
      }));
    }
  });
  it('returns an existing yard-ready acknowledgement without writing again', async () => {
    const { database, connection } = setup({
      status: 'Pagado',
      yard_piece_ready: 1,
      yard_piece_ready_ack_at: '2026-11-12T10:00:00Z',
    });
    const { req, res, end } = request('POST');
    const broadcast = vi.fn();
    await handleWorkflowRequest(req, res, '/api/orders/901/yard-ready-ack', { sub: '7', role: 'operator' }, database, broadcast);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(String(end.mock.calls[0][0]))).toMatchObject({ ok: true, alreadyAcknowledged: true });
    expect(connection.execute).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });
  it('rejects stale, out-of-stage or already-pending yard reverts without writing', async () => {
    const stale = setup({ status: 'Pagado', yard_piece_ready: 1, version: 3 });
    const staleReq = request('POST', { version: 2 });
    await expect(handleWorkflowRequest(staleReq.req, staleReq.res, '/api/orders/901/revert-yard-ready', { sub: '1', role: 'admin' }, stale.database, vi.fn()))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(stale.connection.execute).not.toHaveBeenCalled();
    expect(stale.connection.rollback).toHaveBeenCalledOnce();

    const delivered = setup({ status: 'Entregado', yard_piece_ready: 1 });
    const deliveredReq = request('POST', { version: 1 });
    await expect(handleWorkflowRequest(deliveredReq.req, deliveredReq.res, '/api/orders/901/revert-yard-ready', { sub: '1', role: 'admin' }, delivered.database, vi.fn()))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(delivered.connection.execute).not.toHaveBeenCalled();

    const pending = setup({ status: 'Pagado', yard_piece_ready: 0 });
    const pendingReq = request('POST', { version: 1 });
    await handleWorkflowRequest(pendingReq.req, pendingReq.res, '/api/orders/901/revert-yard-ready', { sub: '1', role: 'admin' }, pending.database, vi.fn());
    expect(pendingReq.res.statusCode).toBe(200);
    expect(JSON.parse(String(pendingReq.end.mock.calls[0][0]))).toMatchObject({ yardPieceReady: false, alreadyPending: true });
    expect(pending.connection.execute).not.toHaveBeenCalled();
  });
  it('allows vendedor_yarda and admin to mark yard piece unavailable, activates auction search and records timeline and audit', async () => {
    const { database, connection } = setup();
    connection.query.mockReset().mockResolvedValueOnce([[{
      id: 901,
      version: 1,
      order_code: 'ORD-901',
      status: 'Pagado',
      user_id: 12,
      workflow_data: null,
    }] as RowDataPacket[], []]);

    const op = request('POST', { reason: 'No encontrada en anaqueles', version: 1 });
    const opDenied = await handleWorkflowRequest(op.req, op.res, '/api/orders/901/yard-unavailable', { sub: '7', role: 'operator' }, database, vi.fn());
    expect(opDenied).toBe(true);
    expect(op.res.statusCode).toBe(403);
    expect(connection.execute).not.toHaveBeenCalled();

    const yardWorker = request('POST', { reason: 'No encontrada en inventario físico', version: 1 });
    const broadcastMock = vi.fn();
    const yardAllowed = await handleWorkflowRequest(yardWorker.req, yardWorker.res, '/api/orders/901/yard-unavailable', { sub: '15', role: 'vendedor_yarda' }, database, broadcastMock);
    expect(yardAllowed).toBe(true);
    expect(yardWorker.res.statusCode).toBe(200);
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('auction_search_active=1'))).toBe(true);
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('status_orders'))).toBe(true);
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('YARD_PIECE_UNAVAILABLE'))).toBe(true);
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(broadcastMock).toHaveBeenCalledWith('order:updated', expect.objectContaining({
      orderId: 901,
      action: 'YARD_PIECE_UNAVAILABLE',
      auctionActive: true,
      yardPieceUnavailable: true,
    }));
  });
  it('rejects stale or out-of-stage yard confirmations without writing', async () => {
    const stale = setup({ status: 'Pagado', yard_piece_ready: 0, version: 2 });
    const staleReq = request('POST', { version: 1 });
    await expect(handleWorkflowRequest(staleReq.req, staleReq.res, '/api/orders/901/yard-ready', { sub: '1', role: 'admin' }, stale.database, vi.fn()))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(stale.connection.execute).not.toHaveBeenCalled();
    expect(stale.connection.rollback).toHaveBeenCalledOnce();

    const delivered = setup({ status: 'Entregado', yard_piece_ready: 0 });
    const deliveredReq = request('POST', { version: 1 });
    await expect(handleWorkflowRequest(deliveredReq.req, deliveredReq.res, '/api/orders/901/yard-ready', { sub: '1', role: 'admin' }, delivered.database, vi.fn()))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(delivered.connection.execute).not.toHaveBeenCalled();

    for (const status of ['En Preparación', 'Reclamo']) {
      const legacy = setup({ status, yard_piece_ready: 0 });
      const legacyReq = request('POST', { version: 1 });
      await expect(handleWorkflowRequest(legacyReq.req, legacyReq.res, '/api/orders/901/yard-ready', { sub: '1', role: 'admin' }, legacy.database, vi.fn()))
        .rejects.toMatchObject({ statusCode: 409 });
      expect(legacy.connection.execute).not.toHaveBeenCalled();
    }
  });
  it('treats an already-ready piece as an idempotent success and caps the unavailable reason', async () => {
    const ready = setup({ status: 'Pagado', yard_piece_ready: 1 });
    const readyReq = request('POST', { version: 1 });
    await handleWorkflowRequest(readyReq.req, readyReq.res, '/api/orders/901/yard-ready', { sub: '1', role: 'admin' }, ready.database, vi.fn());
    expect(readyReq.res.statusCode).toBe(200);
    expect(JSON.parse(String(readyReq.end.mock.calls[0][0]))).toMatchObject({ yardPieceReady: true, alreadyReady: true });
    expect(ready.connection.execute).not.toHaveBeenCalled();

    const longReason = setup({ status: 'Pagado', yard_piece_ready: 0 });
    const longReq = request('POST', { version: 1, reason: 'x'.repeat(501) });
    await expect(handleWorkflowRequest(longReq.req, longReq.res, '/api/orders/901/yard-unavailable', { sub: '15', role: 'vendedor_yarda' }, longReason.database, vi.fn()))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(longReason.connection.execute).not.toHaveBeenCalled();
  });
  it('notifies active advisors and admins when a claim replacement piece is ready', async () => {
    const { database, connection } = setup();
    connection.query.mockReset().mockResolvedValue([[], []])
      .mockResolvedValueOnce([[{
        id: 901,
        version: 1,
        order_code: 'ORD-901',
        status: 'Reclamo',
        user_id: 9,
        customer_id: 3,
        product_type: 'Motor',
        stock_nr: 'TST-01',
        brand: 'Nissan',
        model: 'Altima',
        year: 2012,
        claim_reason: 'Consumo de aceite',
        workflow_data: JSON.stringify({}),
      }] as RowDataPacket[], []])
      .mockResolvedValueOnce([[{ first_name: 'Ana', last_name: 'Torres' }] as RowDataPacket[], []])
      .mockResolvedValueOnce([[{ assigned_user_id: 6 }] as RowDataPacket[], []])
      .mockResolvedValueOnce([[
        { name: 'Admin Uno', phone: '584100000001' },
        { name: 'Asesor Uno', phone: '584100000001' },
        { name: 'Asesor Dos', phone: '584100000003' },
      ] as RowDataPacket[], []]);

    const { req, res, end } = request('POST', { version: 1 });
    const broadcast = vi.fn();
    await handleWorkflowRequest(req, res, '/api/orders/901/claim-ready', { sub: '15', role: 'vendedor_yarda' }, database, broadcast);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(String(end.mock.calls[0][0]))).toMatchObject({ claimPieceReady: true, notifiedRecipients: 2 });
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('UPDATE orders SET workflow_data=?, version=version+1'))).toBe(true);
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('INSERT INTO status_orders'))).toBe(true);
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('CLAIM_REPLACEMENT_READY'))).toBe(true);
    const outbox = connection.execute.mock.calls.filter(call => String(call[0]).includes('INSERT INTO notification_outbox'));
    expect(outbox).toHaveLength(2);
    expect(outbox.map(call => JSON.parse(String((call[1] as unknown[])[0])).phone)).toEqual(['584100000001', '584100000003']);
    expect(broadcast).toHaveBeenCalledWith('order:updated', expect.objectContaining({ action: 'CLAIM_REPLACEMENT_READY', claimPieceReady: true }));
    expect(connection.commit).toHaveBeenCalledOnce();
  });
  it('rejects claim replacement notifications for non-claims, stale versions and repeats without writing', async () => {
    const pagado = setup({ status: 'Pagado' });
    const wrongStatus = request('POST', { version: 1 });
    await expect(handleWorkflowRequest(wrongStatus.req, wrongStatus.res, '/api/orders/901/claim-ready', { sub: '15', role: 'vendedor_yarda' }, pagado.database, vi.fn()))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(pagado.connection.execute).not.toHaveBeenCalled();

    const stale = setup({ status: 'Reclamo', version: 2 });
    const staleReq = request('POST', { version: 1 });
    await expect(handleWorkflowRequest(staleReq.req, staleReq.res, '/api/orders/901/claim-ready', { sub: '15', role: 'vendedor_yarda' }, stale.database, vi.fn()))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(stale.connection.execute).not.toHaveBeenCalled();

    const ready = setup({ status: 'Reclamo', workflow_data: JSON.stringify({ claimPieceReady: true, claimPieceReadyAt: '2026-11-12T10:00:00.000Z' }) });
    const readyReq = request('POST', { version: 1 });
    await handleWorkflowRequest(readyReq.req, readyReq.res, '/api/orders/901/claim-ready', { sub: '15', role: 'vendedor_yarda' }, ready.database, vi.fn());
    expect(readyReq.res.statusCode).toBe(200);
    expect(JSON.parse(String(readyReq.end.mock.calls[0][0]))).toMatchObject({ alreadyReady: true, claimPieceReadyAt: '2026-11-12T10:00:00.000Z' });
    expect(ready.connection.execute).not.toHaveBeenCalled();
  });
  it('allows only admin to revert a claim replacement notification and records timeline and audit', async () => {
    const { database, connection } = setup({
      status: 'Reclamo',
      workflow_data: JSON.stringify({ claimPieceReady: true, claimPieceReadyAt: '2026-11-12T10:00:00.000Z', claimPieceReadyBy: 15 }),
    });

    for (const role of ['operator', 'vendedor_yarda']) {
      const denied = request('POST', { version: 1 });
      await handleWorkflowRequest(denied.req, denied.res, '/api/orders/901/revert-claim-ready', { sub: '7', role }, database, vi.fn());
      expect(denied.res.statusCode).toBe(403);
    }
    expect(connection.execute).not.toHaveBeenCalled();

    const admin = request('POST', { version: 1 });
    const broadcast = vi.fn();
    const allowed = await handleWorkflowRequest(admin.req, admin.res, '/api/orders/901/revert-claim-ready', { sub: '1', role: 'admin' }, database, broadcast);
    expect(allowed).toBe(true);
    expect(admin.res.statusCode).toBe(200);
    expect(JSON.parse(String(admin.end.mock.calls[0][0]))).toEqual({ ok: true, claimPieceReady: false, alreadyPending: false });
    const savedWorkflowCall = connection.execute.mock.calls.find(call => String(call[0]).includes('UPDATE orders SET workflow_data=?, version=version+1'));
    expect(savedWorkflowCall).toBeDefined();
    const savedWorkflow = JSON.parse(String((savedWorkflowCall![1] as unknown[])[0]));
    expect(savedWorkflow.claimPieceReady).toBeUndefined();
    expect(savedWorkflow.claimPieceReadyAt).toBeUndefined();
    expect(savedWorkflow.claimPieceReadyRevertedBy).toBe(1);
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('INSERT INTO status_orders'))).toBe(true);
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('CLAIM_REPLACEMENT_READY_REVERTED'))).toBe(true);
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(broadcast).toHaveBeenCalledWith('order:updated', expect.objectContaining({
      orderId: 901,
      action: 'CLAIM_REPLACEMENT_READY_REVERTED',
      claimPieceReady: false,
    }));
  });
  it('rejects claim replacement reverts for non-claims, stale versions and already-pending claims without writing', async () => {
    const pagado = setup({ status: 'Pagado', workflow_data: JSON.stringify({ claimPieceReady: true }) });
    const wrongStatus = request('POST', { version: 1 });
    await expect(handleWorkflowRequest(wrongStatus.req, wrongStatus.res, '/api/orders/901/revert-claim-ready', { sub: '1', role: 'admin' }, pagado.database, vi.fn()))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(pagado.connection.execute).not.toHaveBeenCalled();
    expect(pagado.connection.rollback).toHaveBeenCalledOnce();

    const stale = setup({ status: 'Reclamo', version: 2, workflow_data: JSON.stringify({ claimPieceReady: true }) });
    const staleReq = request('POST', { version: 1 });
    await expect(handleWorkflowRequest(staleReq.req, staleReq.res, '/api/orders/901/revert-claim-ready', { sub: '1', role: 'admin' }, stale.database, vi.fn()))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(stale.connection.execute).not.toHaveBeenCalled();

    const pending = setup({ status: 'Reclamo', workflow_data: JSON.stringify({}) });
    const pendingReq = request('POST', { version: 1 });
    await handleWorkflowRequest(pendingReq.req, pendingReq.res, '/api/orders/901/revert-claim-ready', { sub: '1', role: 'admin' }, pending.database, vi.fn());
    expect(pendingReq.res.statusCode).toBe(200);
    expect(JSON.parse(String(pendingReq.end.mock.calls[0][0]))).toMatchObject({ claimPieceReady: false, alreadyPending: true });
    expect(pending.connection.execute).not.toHaveBeenCalled();
  });
  it('allows only admin to verify downpayment and transitions order to Pagado', async () => {
    const { database, connection } = setup();
    connection.query.mockReset().mockResolvedValueOnce([[{ id: 901, version: 1, order_code: 'ORD-901', status: 'En Espera Confirmación' }] as RowDataPacket[], []]);
    const op = request('POST');
    const opDenied = await handleWorkflowRequest(op.req, op.res, '/api/orders/901/verify-downpayment', { sub: '7', role: 'operator' }, database, vi.fn());
    expect(opDenied).toBe(true);
    expect(op.res.statusCode).toBe(403);

    const admin = request('POST');
    const adminClaims = { sub: '1', role: 'admin' };
    const adminLocked = await handleWorkflowRequest(admin.req, admin.res, '/api/orders/901/verify-downpayment', adminClaims, database, vi.fn());
    expect(adminLocked).toBe(true);
    expect(admin.res.statusCode).toBe(403);
    expect(JSON.parse(String(admin.end.mock.calls[0][0]))).toMatchObject({ code: 'FINANCE_LOCKED' });
    expect(connection.execute).not.toHaveBeenCalled();

    const adminUnlocked = request('POST');
    unlockVault(adminUnlocked.req, adminUnlocked.res, adminClaims);
    const adminAllowed = await handleWorkflowRequest(adminUnlocked.req, adminUnlocked.res, '/api/orders/901/verify-downpayment', adminClaims, database, vi.fn());
    expect(adminAllowed).toBe(true);
    expect(adminUnlocked.res.statusCode).toBe(200);
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('downpayment_verified=1'))).toBe(true);
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes("status='Pagado'"))).toBe(true);
    expect(connection.commit).toHaveBeenCalledOnce();
  });
});
