import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enforceCollectionUpdate, handlePaymentRequest } from '../src/server/orderPayments';
import { handleWorkflowRequest } from '../src/server/orderWorkflow';
import { emptySettlement } from '../src/utils/orderPayments';
import { preparationSchema } from '../src/utils/orderPreparation';

vi.mock('../src/server/config', () => ({ pool: {}, maxBodyBytes: 50000, jwtSecret: 'test-only', frontendRoot: '' }));
const pools: Pool[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(pools.splice(0).map(pool => pool.end())); });
const baseRow = {
  id: 901, version: 1, price: 900, core_fee: 100, shipping_cost: 0, down_payment: 200,
  user_id: 7, created_at: new Date('2026-10-21T16:00:00Z'), status: 'Listo para Retiro',
  order_code: 'TEST', workflow_step: 4, core_received_at: null, delivered_at: null, customer_id: 1,
};
const setup = (overrides: Record<string, unknown> = {}) => {
  const database = mysql.createPool({ host: '127.0.0.1', port: 1, user: 'test', connectTimeout: 1 });
  pools.push(database);
  const events = ['quote', 'ack', 'prepare'].map((task, i) => ({
    id: i + 1, task, outcome: 'completed', created_at: new Date(), scheduled_at: new Date(), actor_id: 7, notes: 'Test verified', evidence: 'Test evidence',
  }));
  const connection = Object.assign(database, {
    connection: database, beginTransaction: vi.fn().mockResolvedValue(undefined), commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
    query: vi.fn<Pool['query']>().mockImplementation(async sql => {
      if (String(sql).includes('FROM orders')) return [[{ ...baseRow, ...overrides }] as RowDataPacket[], []];
      if (String(sql).includes('FROM order_workflow_events')) return [events as RowDataPacket[], []];
      if (String(sql).includes('FROM users')) return [[{ name: 'Test actor' }] as RowDataPacket[], []];
      if (String(sql).includes('FROM uploaded_files')) return [[{ user_id: 7, content_type: 'image/png' }] as RowDataPacket[], []];
      return [[], []];
    }),
    execute: vi.fn<Pool['execute']>().mockResolvedValue([{ constructor: { name: 'ResultSetHeader' }, insertId: 21, affectedRows: 1, fieldCount: 0, info: '', serverStatus: 0, warningStatus: 0, changedRows: 0 }, []]),
  });
  vi.spyOn(database, 'getConnection').mockResolvedValue(connection);
  return { database, connection };
};
const split = { ...emptySettlement(), payments: [
  { amount: 300, method: 'cash', reference: '', confirmed: true, receivedBy: 'Receiver', receipt: null },
  { amount: 400, method: 'zelle', reference: 'TEST-ZELLE', confirmed: true, receipt: '/uploads/test.png' },
], coreAction: 'received', coreReference: 'TEST-CORE-RECEIPT', coreConfirmed: true };
const request = (body: Record<string, unknown>, method = 'POST') => {
  const req = new IncomingMessage(new Socket()); req.method = method; req.headers = { 'content-type': 'application/json' };
  req.push(Buffer.from(JSON.stringify(body))); req.push(null);
  const res = new ServerResponse(req); const end = vi.spyOn(res, 'end').mockReturnValue(res);
  return { req, res, end };
};
const actor = { sub: '7', role: 'admin' };
describe('transactional order collections', () => {
  it('closes delivery with optional piece photos and automatically records the customer, without text evidence', async () => {
    const { database, connection } = setup({ down_payment: 1000, first_name: 'Cliente', last_name: 'Prueba' });
    const { req, res } = request({ version: 1, task: 'delivery', outcome: 'completed',
      deliveryPhotos: [], confirmed: true, settlement: emptySettlement() });
    await handleWorkflowRequest(req, res, '/api/orders/901/workflow', actor, database, vi.fn());
    expect(connection.commit).toHaveBeenCalledOnce();
    const inserts = connection.execute.mock.calls.filter(call => String(call[0]).includes('INSERT INTO order_workflow_events'));
    expect(JSON.stringify(inserts)).toContain('Cliente Prueba');
    expect(JSON.stringify(inserts)).not.toContain('undefined');
  });
  it('validates every optional delivery photo against its own order before committing', async () => {
    const { database, connection } = setup({ down_payment: 1000, first_name: 'Cliente', last_name: 'Prueba' });
    const original = connection.query.getMockImplementation()!;
    connection.query.mockImplementation(async (...args) => String(args[0]).includes('FROM uploaded_files') ? [[], []] : original(...args));
    const { req, res } = request({ version: 1, task: 'delivery', outcome: 'completed',
      deliveryPhotos: ['/uploads/foreign.png'], confirmed: true, settlement: emptySettlement() });
    await expect(handleWorkflowRequest(req, res, '/api/orders/901/workflow', actor, database, vi.fn())).rejects.toThrow(/imagen/);
    expect(connection.commit).not.toHaveBeenCalled();
  });
  it('does not invent a customer name or skip physical confirmation when photos are omitted', async () => {
    for (const patch of [{ first_name: '', last_name: '', confirmed: true }, { first_name: 'Cliente', last_name: 'Prueba', confirmed: false }]) {
      const { database, connection } = setup({ down_payment: 1000, ...patch });
      const { req, res } = request({ version: 1, task: 'delivery', outcome: 'completed',
        deliveryPhotos: [], confirmed: patch.confirmed, settlement: emptySettlement() });
      await expect(handleWorkflowRequest(req, res, '/api/orders/901/workflow', actor, database, vi.fn())).rejects.toThrow(/cliente|Confirma/);
      expect(connection.commit).not.toHaveBeenCalled();
    }
  });
  it('does not reuse refunded pre-delivery collections for a new handover or collection', async () => {
    const { database, connection } = setup();
    const original = connection.query.getMockImplementation()!;
    connection.query.mockImplementation(async (...args) => {
      if (String(args[0]).includes('FROM refund_requests')) return [[{ id: 1 }] as RowDataPacket[], []];
      return original(...args);
    });
    const { req, res } = request({ version: 1, settlement: split });
    await expect(handlePaymentRequest(req, res, '/api/orders/901/payments', actor, database, vi.fn())).rejects.toThrow(/reembolsados/);
    expect(connection.commit).not.toHaveBeenCalled();
  });
  it('requires cash receiver or uploaded electronic evidence for every new collection, before writing money', async () => {
    for (const payment of [
      { amount: 10, method: 'cash', reference: '', confirmed: true },
      { amount: 10, method: 'zelle', reference: 'TEST', confirmed: true },
      { amount: 10, method: 'cash', reference: '', confirmed: true, receivedBy: 'Receiver', receipt: '/uploads/test.png' },
    ]) {
      const { database, connection } = setup();
      const { req, res } = request({ version: 1, settlement: { ...emptySettlement(), payments: [payment] } });
      await expect(handlePaymentRequest(req, res, '/api/orders/901/payments', actor, database, vi.fn())).rejects.toThrow(/recibió|comprobante/);
      expect(connection.execute).not.toHaveBeenCalled();
    }
  });
  it('finishes missing confirmation, preparation, collection and delivery together from the modal', async () => {
    const { database, connection } = setup({ status: 'Cotización' });
    connection.query.mockImplementation(async sql => {
      if (String(sql).includes('FROM orders')) return [[{ ...baseRow, status: 'Cotización' }] as RowDataPacket[], []];
      if (String(sql).includes('FROM uploaded_files')) return [[{ user_id: 7, content_type: 'image/png' }] as RowDataPacket[], []];
      if (String(sql).includes('FROM users')) return [[{ name: 'Test actor' }] as RowDataPacket[], []];
      return [[], []];
    });
    const preparation = preparationSchema.parse({
      yardNotified: true, channel: 'call', failedCall: false, failedCallNotes: '', customerConfirmed: true,
      dateFrom: '2099-01-02', dateTo: '2099-01-02', balanceNotified: true, paymentMethodsNotified: true,
      corePlan: 'return_core', deliveryType: 'retiro_tienda', address: '', screenshots: [],
    });
    const { req, res } = request({ version: 1, task: 'delivery', outcome: 'completed',
      notes: 'Physical handover', evidence: 'Signed receipt', confirmed: true,
      settlement: { ...split, payments: [
        { amount: 300, method: 'cash', reference: '', confirmed: true, receivedBy: 'Receiver', receipt: null },
        { amount: 400, method: 'zelle', reference: '', confirmed: true, receipt: '/uploads/test.png' },
      ] },
      completion: { downpayment: [{ amount: 200, method: 'cash', receivedBy: 'Receiver', receipt: null }], preparation },
    });
    await handleWorkflowRequest(req, res, '/api/orders/901/workflow', actor, database, vi.fn());
    expect(res.statusCode).toBe(201);
    const recorded = connection.execute.mock.calls.filter(call => String(call[0]).includes('INSERT INTO order_workflow_events'));
    expect(recorded.map(call => (call[1] as unknown[])[1])).toEqual(['ack', 'prepare', 'delivery']);
    expect(connection.execute.mock.calls.filter(call => String(call[0]).includes('INSERT INTO finance_movements'))).toHaveLength(2);
    expect(connection.execute.mock.calls.filter(call => String(call[0]).includes('version=version+1'))).toHaveLength(1);
    expect(connection.commit).toHaveBeenCalledOnce();
  });
  it('rejects missing preparation, foreign evidence, duplicate delivery and noncash receiver without committing any part', async () => {
    for (const variant of ['missing-preparation', 'foreign-image', 'duplicate', 'receiver', 'card']) {
      const { database, connection } = setup(variant === 'duplicate' ? { delivered_at: new Date(), status: 'Entregado' } : {});
      if (variant === 'foreign-image') connection.query.mockImplementation(async sql => {
        if (String(sql).includes('FROM orders')) return [[baseRow] as RowDataPacket[], []];
        if (String(sql).includes('FROM uploaded_files')) return [[], []];
        return [[], []];
      });
      if (variant === 'missing-preparation') connection.query.mockImplementation(async sql => {
        if (String(sql).includes('FROM orders')) return [[baseRow] as RowDataPacket[], []];
        if (String(sql).includes('FROM uploaded_files')) return [[{ user_id: 7, content_type: 'image/png' }] as RowDataPacket[], []];
        return [[], []];
      });
      const badSplit = variant === 'receiver' ? { ...split, payments: split.payments.map(payment => ({ ...payment, receivedBy: 'Receiver' })) }
        : variant === 'card' ? { ...split, payments: [{ amount: 700, method: 'card', reference: '', confirmed: true, receipt: '/uploads/test.png' }] } : split;
      const { req, res } = request({ version: 1, task: 'delivery', outcome: 'completed', confirmed: true,
        notes: 'Physical handover', evidence: 'Signed receipt', settlement: badSplit, completion: {} });
      const broadcast = vi.fn();
      await expect(handleWorkflowRequest(req, res, '/api/orders/901/workflow', actor, database, broadcast)).rejects.toThrow();
      expect(connection.commit).not.toHaveBeenCalled(); expect(connection.rollback).toHaveBeenCalledOnce(); expect(broadcast).not.toHaveBeenCalled();
    }
  });
  it('prevents manual order edits from bypassing the ledger or charging a received core again', () => {
    const row = baseRow as RowDataPacket;
    expect(() => enforceCollectionUpdate(row, { status: 'listo_retiro', financials: { downPayment: 201, coreFee: 100 } })).toThrow(/Registrar cobro/);
    expect(() => enforceCollectionUpdate({ ...row, core_received_at: new Date(), core_fee: 0 } as RowDataPacket, { financials: { downPayment: 200, coreFee: 100 } })).toThrow(/core/);
    expect(() => enforceCollectionUpdate(row, { status: 'entregado', financials: { downPayment: 200, coreFee: 100 } })).toThrow(/entrega/);
    expect(() => enforceCollectionUpdate(row, { status: 'listo_retiro', financials: { downPayment: 200, coreFee: 100 } })).not.toThrow();
  });
  it('records each method and core receipt once, increments version, and leaves delivery untouched', async () => {
    const { database, connection } = setup(); const { req, res, end } = request({ version: 1, settlement: split });
    const broadcast = vi.fn();
    await handlePaymentRequest(req, res, '/api/orders/901/payments', actor, database, broadcast);
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(String(end.mock.calls[0][0]))).toMatchObject({ version: 2 });
    const payments = connection.execute.mock.calls.filter(call => String(call[0]).includes('INSERT INTO finance_movements'));
    expect(payments).toHaveLength(2);
    expect(payments[0][1]).toEqual(expect.arrayContaining([300, 'cash']));
    expect(payments[1][1]).toEqual(expect.arrayContaining([400, 'zelle', 'TEST-ZELLE']));
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('INSERT INTO order_core_receipts'))).toBe(true);
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('warranty_started'))).toBe(false);
    expect(connection.commit).toHaveBeenCalledOnce(); expect(broadcast).toHaveBeenCalledOnce();
  });
  it('rejects stale versions, unauthorized collections, overpayments and repeat core receipts without writes', async () => {
    for (const variant of [
      { body: { version: 2, settlement: split }, row: {}, actor },
      { body: { version: 1, settlement: split }, row: {}, actor: { ...actor, role: 'operator' } },
      { body: { version: 1, settlement: split }, row: { down_payment: 900 }, actor },
      { body: { version: 1, settlement: split }, row: { core_received_at: new Date() }, actor },
      { body: { version: 1, settlement: split }, row: {}, actor: { sub: '8', role: 'operator' } },
    ]) {
      const { database, connection } = setup(variant.row); const { req, res } = request(variant.body);
      await expect(handlePaymentRequest(req, res, '/api/orders/901/payments', variant.actor, database, vi.fn())).rejects.toThrow();
      expect(connection.execute).not.toHaveBeenCalled(); expect(connection.rollback).toHaveBeenCalledOnce();
    }
  });
  it('rolls back all lines and never emits success on a database failure', async () => {
    const { database, connection } = setup(); const { req, res } = request({ version: 1, settlement: split });
    connection.execute.mockRejectedValueOnce(new Error('Storage unavailable')); const broadcast = vi.fn();
    await expect(handlePaymentRequest(req, res, '/api/orders/901/payments', actor, database, broadcast)).rejects.toThrow('Storage unavailable');
    expect(connection.commit).not.toHaveBeenCalled(); expect(connection.rollback).toHaveBeenCalledOnce(); expect(broadcast).not.toHaveBeenCalled();
  });
  it('commits split collection, core adjustment, workflow evidence and delivery in one transaction', async () => {
    const { database, connection } = setup();
    const { req, res } = request({ version: 1, settlement: split, task: 'delivery', outcome: 'completed', confirmed: true, notes: 'Physical handover', evidence: 'Synthetic signed receipt' });
    await handleWorkflowRequest(req, res, '/api/orders/901/workflow', actor, database, vi.fn());
    expect(res.statusCode).toBe(201);
    expect(connection.execute.mock.calls.filter(call => String(call[0]).includes('INSERT INTO finance_movements'))).toHaveLength(2);
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('warranty_started=1'))).toBe(true);
    expect(connection.commit).toHaveBeenCalledOnce();
  });
  it('rejects collection fields on unrelated workflow actions', async () => {
    const { database, connection } = setup();
    const { req, res } = request({ version: 1, settlement: split, task: 'post_3', outcome: 'blocked', notes: 'Blocked test', nextAction: 'Review', nextDueDate: '2026-12-01', blockedBy: 'Test' });
    await expect(handleWorkflowRequest(req, res, '/api/orders/901/workflow', actor, database, vi.fn())).rejects.toThrow();
    expect(connection.execute).not.toHaveBeenCalled();
  });
  it('restricts remaining collections after verified preparation to cash, Cash App or Zelle', async () => {
    for (const method of ['card', 'cashier_check']) {
      const { database, connection } = setup({ preparation_details: '{}' });
      const { req, res } = request({ version: 1, settlement: { ...emptySettlement(), payments: [{ amount: 1, method, reference: 'TEST', confirmed: true }] } });
      await expect(handlePaymentRequest(req, res, '/api/orders/901/payments', actor, database, vi.fn())).rejects.toThrow(/efectivo|Cash App|Zelle/);
      expect(connection.execute).not.toHaveBeenCalled();
    }
  });
  it('keeps new-workflow delivery guarded at the standalone endpoint', async () => {
    const { database, connection } = setup();
    const { req, res } = request({ version: 1, settlement: split, delivery: { notes: 'Test notes', evidence: 'Test evidence', confirmed: true } });
    await expect(handlePaymentRequest(req, res, '/api/orders/901/payments', actor, database, vi.fn())).rejects.toThrow(/flujo verificable/);
    expect(connection.execute).not.toHaveBeenCalled();
  });
  it('returns legacy and identified methods without inventing dates or a core receipt', async () => {
    const { database, connection } = setup();
    connection.query.mockReset().mockResolvedValueOnce([[baseRow] as RowDataPacket[], []])
      .mockResolvedValueOnce([[{ id: 1, amount: '200', payment_method: null }, { id: 2, amount: '20', payment_method: 'zelle', payment_reference: 'TEST', effective_at: new Date(), actor: 'Test actor' }] as RowDataPacket[], []])
      .mockResolvedValueOnce([[], []]);
    const { req, res, end } = request({}, 'GET');
    await handlePaymentRequest(req, res, '/api/orders/901/payments', { ...actor, role: 'operator' }, database, vi.fn());
    const data = JSON.parse(String(end.mock.calls[0][0]));
    expect(data.canRecord).toBe(false); expect(data.coreReceipt).toBeNull();
    expect(data.payments[0]).toMatchObject({ amount: 200, method: null, date: null, actor: null });
    expect(data.payments[1]).toMatchObject({ amount: 20, method: 'zelle', reference: 'TEST', actor: 'Test actor' });
    expect(connection.execute).not.toHaveBeenCalled();
  });
  it('returns the original core receipt with amount, author and date', async () => {
    const { database, connection } = setup();
    connection.query.mockReset().mockResolvedValueOnce([[baseRow] as RowDataPacket[], []]).mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ amount: '100', reference: 'TEST CORE', actor: 'Test actor', created_at: new Date() }] as RowDataPacket[], []]);
    const { req, res, end } = request({}, 'GET');
    await handlePaymentRequest(req, res, '/api/orders/901/payments', actor, database, vi.fn());
    expect(JSON.parse(String(end.mock.calls[0][0])).coreReceipt).toMatchObject({ amount: 100, reference: 'TEST CORE', actor: 'Test actor' });
  });
  it('commits legacy delivery with evidence and allows an assigned operator to deliver an already liquidated order', async () => {
    const { database, connection } = setup({ created_at: new Date('2026-10-01'), down_payment: 1000 });
    const { req, res } = request({ version: 1, settlement: emptySettlement(), delivery: { notes: 'Physical handover', evidence: 'Test receipt', confirmed: true } });
    await handlePaymentRequest(req, res, '/api/orders/901/payments', { ...actor, role: 'operator' }, database, vi.fn());
    expect(res.statusCode).toBe(201);
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('warranty_started=1'))).toBe(true);
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('finance_movements'))).toBe(false);
    expect(connection.commit).toHaveBeenCalledOnce();
  });
  it('rejects empty actions, closed orders and repeated legacy delivery', async () => {
    for (const variant of [
      { row: {}, body: { version: 1, settlement: emptySettlement() } },
      { row: { status: 'cancelado' }, body: { version: 1, settlement: split } },
      { row: { created_at: new Date('2026-10-01'), delivered_at: new Date(), status: 'Entregado' }, body: { version: 1, settlement: split, delivery: { notes: 'Test notes', evidence: 'Test evidence', confirmed: true } } },
    ]) {
      const { database, connection } = setup(variant.row);
      const { req, res } = request(variant.body);
      await expect(handlePaymentRequest(req, res, '/api/orders/901/payments', actor, database, vi.fn())).rejects.toThrow();
      expect(connection.execute).not.toHaveBeenCalled();
    }
  });
  it('routes only supported paths/methods and reports missing orders', async () => {
    const { database, connection } = setup();
    const { req, res } = request({}, 'DELETE');
    expect(await handlePaymentRequest(req, res, '/api/unrelated', actor, database, vi.fn())).toBe(false);
    await handlePaymentRequest(req, res, '/api/orders/901/payments', actor, database, vi.fn());
    expect(res.statusCode).toBe(405);
    connection.query.mockResolvedValueOnce([[], []]);
    const get = request({}, 'GET');
    await expect(handlePaymentRequest(get.req, get.res, '/api/orders/901/payments', actor, database, vi.fn())).rejects.toThrow(/encontrada/);
  });
});
