import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAftersalesAction, handleAftersalesRequest, warrantyFromRow } from '../src/server/aftersales';
import { aftersalesActionSchema } from '../src/utils/aftersales';
import { shiftWorkflowDate, workflowDate } from '../src/utils/orderWorkflow';

vi.mock('../src/server/config', () => ({ pool: {}, maxBodyBytes: 50000, jwtSecret: 'test-only', frontendRoot: '' }));
const pools: Pool[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(pools.splice(0).map(pool => pool.end())); });
const today = workflowDate(new Date());
const baseRow = { id: 901, order_code: 'TEST', version: 1, user_id: 7, created_at: new Date(), status: 'Entregado',
  delivered_at: new Date(), warranty_started: 1, warranty_days: 60, core_fee: 150, price: 1000, down_payment: 1150,
  core_deposit_amount: 150, core_returned_at: null, core_received_at: null, warranty_terms: null };
const actor = { sub: '7', role: 'admin' };
const cash = { method: 'cash', recipient: 'Test customer', confirmed: true };
const square = { method: 'square', last4: '1234', reference: 'SQ-TEST', receipt: '/uploads/receipt.png', confirmed: true };
const setup = (overrides: Record<string, unknown> = {}) => {
  const database = mysql.createPool({ host: '127.0.0.1', port: 1, connectTimeout: 1 }); pools.push(database);
  const row = { ...baseRow, ...overrides } as RowDataPacket;
  const context = {
    found: true, actorFound: true, imageFound: true, assigneeFound: true,
    completed: 0, reserved: 0, replay: false, hash: '', openClaims: [] as RowDataPacket[],
    refund: { id: 9, amount: 100, status: 'pending', review_stage: 'approved', refund_scope: 'purchase',
      previous_order_status: 'Entregado', piece_required: 0, claim_id: null } as RowDataPacket,
    claim: { id: 8, status: 'In Process', stage: 'resolution', assigned_user_id: 7, previous_order_status: 'Entregado', warranty_snapshot: null } as RowDataPacket,
    existingCore: [] as RowDataPacket[],
    getRefunds: [] as RowDataPacket[], getInvoices: [] as RowDataPacket[], getHistory: [] as RowDataPacket[],
  };
  const connection = Object.assign(database, {
    connection: database, beginTransaction: vi.fn().mockResolvedValue(undefined), commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
    query: vi.fn<Pool['query']>().mockImplementation(async sql => {
      const text = String(sql);
      if (text.includes('FROM orders')) return [context.found ? [row] : [], []];
      if (text.includes('FROM users')) return [((text.includes('role IN') ? context.assigneeFound : context.actorFound) ? [{ id: 7, name: 'Test actor' }] : []) as RowDataPacket[], []];
      if (text.includes('FROM uploaded_files')) return [(context.imageFound ? [{ user_id: 7, content_type: 'image/png' }] : []) as RowDataPacket[], []];
      if (text.includes('FROM api_idempotency')) return [[{ user_id: 7, request_hash: context.hash, resource_id: context.replay ? 901 : null }] as RowDataPacket[], []];
      if (text.includes('AS completed')) return [[{ completed: context.completed, reserved: context.reserved }] as RowDataPacket[], []];
      if (text.includes('FROM claims') && text.includes('WHERE id=')) return [[context.claim], []];
      if (text.includes('FROM claims')) return [context.openClaims, []];
      if (text.includes('FROM refund_requests') && text.includes("refund_scope='core'")) return [context.existingCore, []];
      if (text.includes('FROM refund_requests') && text.includes('WHERE id=')) return [[context.refund], []];
      if (text.includes('FROM refund_requests') && text.includes('status=')) return [[], []];
      if (text.includes('FROM refund_requests')) return [context.getRefunds, []];
      if (text.includes('FROM order_invoices')) return [context.getInvoices, []];
      if (text.includes('FROM order_aftersales_history')) return [context.getHistory, []];
      return [[], []];
    }),
    execute: vi.fn<Pool['execute']>().mockImplementation(async (sql, params) => {
      if (String(sql).includes('INSERT IGNORE INTO api_idempotency')) context.hash = String((params as unknown[])[3]);
      return [{ constructor: { name: 'ResultSetHeader' }, insertId: 11, affectedRows: 1, fieldCount: 0, info: '', serverStatus: 0, warningStatus: 0, changedRows: 0 }, []];
    }),
  });
  vi.spyOn(database, 'getConnection').mockResolvedValue(connection);
  const apply = (data: unknown, claims = actor, now = new Date()) => applyAftersalesAction(connection, row, aftersalesActionSchema.parse(data), claims, now);
  return { database, connection, row, context, apply };
};
const request = (method: string, data?: unknown) => {
  const req = new IncomingMessage(new Socket()); req.method = method; req.headers = { 'content-type': 'application/json' };
  req.push(Buffer.from(JSON.stringify(data || {}))); req.push(null);
  const res = new ServerResponse(req); const end = vi.spyOn(res, 'end').mockReturnValue(res);
  return { req, res, end };
};
describe('verified aftersales API', () => {
  it('allows delegated postdelivery read access but denies it before delivery and keeps refunds admin-only', async () => {
    for (const delivered of [true, false]) {
      const { database, connection } = setup({ followup_user_id: 8, delivered_at: delivered ? new Date() : null });
      const { req, res, end } = request('GET');
      const result = handleAftersalesRequest(req, res, '/api/orders/901/aftersales', { sub: '8', role: 'operator' }, database, vi.fn());
      if (delivered) {
        await result;
        expect(JSON.parse(String(end.mock.calls[0][0]))).toMatchObject({ canManage: true, canAdmin: false });
      } else {
        await expect(result).rejects.toThrow(/operador asignado/);
        expect(connection.rollback).toHaveBeenCalledOnce();
      }
    }
    const { apply } = setup({ followup_user_id: 8 });
    await expect(apply({ action: 'refund_update', id: 9, stage: 'completed', notes: 'Refund attempt', files: [], execution: cash },
      { sub: '8', role: 'operator' })).rejects.toThrow(/administración/);
  });
  it('creates claims with original terms and follows review, resolution, notification and replacement', async () => {
    const { apply, row, context, connection } = setup();
    await apply({ action: 'claim_create', notes: 'Part problem reported', files: ['/uploads/receipt.png'], nextDate: today, assignedUserId: 7 });
    expect(row.status).toBe('Reclamo');
    await apply({ action: 'claim_update', id: 8, stage: 'review', notes: 'Client called and reviewed', files: [], nextDate: today });
    context.claim.stage = 'review';
    await apply({ action: 'claim_update', id: 8, stage: 'resolution', notes: 'Replacement decision', files: [], nextDate: today });
    context.claim.stage = 'resolution';
    context.claim.warranty_snapshot = JSON.stringify({ startedAt: new Date().toISOString(), days: 30, policy: 'calendar' });
    await apply({ action: 'claim_update', id: 8, stage: 'replacement', notes: 'Replacement delivered', files: [], notified: true, confirmed: true, replacementStock: 'TEST' });
    expect(row.status).toBe('Entregado');
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('warranty_terms='))).toBe(true);
  });
  it.each(['resolved', 'denied'])('closes %s only after review and notification without expiry revalidation', async stage => {
    const { apply, row } = setup({ status: 'Reclamo', delivered_at: new Date('2020-01-01') });
    await apply({ action: 'claim_update', id: 8, stage, notes: 'Client notified of resolution', notified: true, files: [] });
    expect(row.status).toBe('Entregado');
  });
  it.each([
    ['missing-delivery', /entrega/], ['expired', /expiró/], ['incident', /incidencia/], ['past-review', /pasado/],
    ['duplicate', /abierto/], ['assignee', /responsable/],
  ])('rejects invalid claim creation: %s', async (variant, message) => {
    const { apply, row, context } = setup();
    if (variant === 'missing-delivery') row.delivered_at = null;
    if (variant === 'expired') row.delivered_at = new Date('2020-01-01');
    if (variant === 'incident') row.status = 'Solicitud Reembolso';
    if (variant === 'duplicate') context.openClaims = [{ id: 8 }] as RowDataPacket[];
    if (variant === 'assignee') context.assigneeFound = false;
    await expect(apply({ action: 'claim_create', notes: 'Claim problem reported', nextDate: variant === 'past-review' ? '2020-01-01' : today,
      assignedUserId: variant === 'assignee' ? 99 : undefined, files: [] })).rejects.toThrow(message);
  });
  it.each([
    ['closed', /cerrado/], ['owner', /responsable/], ['unreviewed', /revisión/], ['unnotified', /notificaste/],
    ['missing-next', /fecha/], ['wrong-order-status', /reembolso/], ['replacement-unconfirmed', /entrega/],
  ])('rejects incomplete claim resolution: %s', async (variant, message) => {
    const { apply, row, context } = setup({ status: 'Reclamo' });
    if (variant === 'closed') context.claim.status = 'Resolved';
    if (variant === 'owner') context.claim.assigned_user_id = 99;
    if (variant === 'unreviewed') context.claim.stage = 'registered';
    if (variant === 'wrong-order-status') row.status = 'Solicitud Reembolso';
    await expect(apply({ action: 'claim_update', id: 8, stage: variant === 'missing-next' ? 'review' : variant === 'replacement-unconfirmed' ? 'replacement' : 'resolved',
      notes: 'Resolution explanatory detail', notified: variant !== 'unnotified', files: [] },
    variant === 'owner' ? { sub: '7', role: 'operator' } : actor)).rejects.toThrow(message);
  });
  it('resolves legacy claim with automatic fallback previous status', async () => {
    const { apply, row, context } = setup({ status: 'Reclamo' });
    context.claim.previous_order_status = null;
    await apply({ action: 'claim_update', id: 8, stage: 'resolved', notes: 'Resolution explanatory detail', notified: true, files: [] });
    expect(['Entregado', 'Pagado']).toContain(row.status);
  });
  it('links refund to active claim and reserves funds without a financial movement', async () => {
    const { apply, context, row, connection } = setup({ status: 'Reclamo' });
    context.openClaims = [{ id: 8 }] as RowDataPacket[];
    await apply({ action: 'refund_create', claimId: 8, amount: 150, notes: 'Verified requested refund', pieceRequired: true, files: [] });
    expect(row.status).toBe('Solicitud Reembolso');
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('INSERT INTO finance_movements'))).toBe(false);
  });
  it.each(['review', 'approved', 'rejected', 'completed'])('handles refund stage %s with distinct money execution', async stage => {
    const { apply, context, row, connection } = setup({ status: 'Solicitud Reembolso' });
    context.refund.review_stage = stage === 'review' ? null : stage === 'approved' ? 'review' : 'approved';
    await apply({ action: 'refund_update', id: 9, stage, notes: 'Verified refund decision', pieceReceived: true, execution: stage === 'completed' ? square : undefined });
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('INSERT INTO finance_movements'))).toBe(stage === 'completed');
    if (stage === 'completed' || stage === 'rejected') expect(row.status).toBe('Entregado');
  });
  it('closes linked claim only for full completed refund', async () => {
    const { apply, context, row, connection } = setup({ status: 'Solicitud Reembolso' });
    context.refund.amount = 1150; context.refund.claim_id = 8; context.completed = 0;
    const originalQuery = connection.query.getMockImplementation()!;
    let totalsReads = 0;
    connection.query.mockImplementation(async (...args) => {
      if (String(args[0]).includes('AS completed')) return [[{ completed: totalsReads++ ? 1150 : 0, reserved: 0 }] as RowDataPacket[], []];
      return originalQuery(...args);
    });
    await apply({ action: 'refund_update', id: 9, stage: 'completed', notes: 'Full refund executed', execution: cash });
    expect(row.status).toBe('Reembolsado');
  });
  it.each([
    ['unapproved', /aprobación/], ['missing-execution', /dinero/], ['piece', /pieza/], ['closed', /pendiente/],
    ['budget', /excede/],
  ])('rejects unsafe refund completion: %s', async (variant, message) => {
    const { apply, context } = setup();
    if (variant === 'unapproved') context.refund.review_stage = 'review';
    if (variant === 'piece') context.refund.piece_required = 1;
    if (variant === 'closed') context.refund.status = 'completed';
    if (variant === 'budget') context.completed = 1150;
    await expect(apply({ action: 'refund_update', id: 9, stage: 'completed', notes: 'Refund attempt detail',
      execution: variant === 'missing-execution' ? undefined : cash })).rejects.toThrow(message);
  });
  it('completes refund with automatic fallback previous status', async () => {
    const { apply, context, row } = setup({ status: 'Solicitud Reembolso' });
    context.refund.previous_order_status = null;
    await apply({ action: 'refund_update', id: 9, stage: 'completed', notes: 'Refund attempt detail', execution: cash });
    expect(['Entregado', 'Pagado', 'Reembolsado']).toContain(row.status);
  });
  it('receives timely core and refunds cash separately without changing status or coverage', async () => {
    const { apply, connection, row } = setup();
    await apply({ action: 'core_receive', notes: 'Physical core received', confirmed: true, files: [] });
    row.core_returned_at = new Date();
    await apply({ action: 'core_refund', execution: cash });
    expect(row.status).toBe('Entregado');
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('INSERT INTO finance_movements'))).toBe(true);
  });
  it.each(['already-received', 'missing-date', 'unpaid-legacy', 'no-deposit', 'expired', 'not-admin'])('rejects invalid core reception %s', async variant => {
    const { apply, row } = setup();
    if (variant === 'already-received') row.core_received_at = new Date();
    if (variant === 'missing-date') { row.delivered_at = null; row.core_deposit_amount = null; }
    if (variant === 'unpaid-legacy') { row.down_payment = 10; row.core_deposit_amount = null; }
    if (variant === 'no-deposit') row.core_deposit_amount = 0;
    if (variant === 'expired') row.delivered_at = new Date('2020-01-01');
    await expect(apply({ action: 'core_receive', notes: 'Physical core received', confirmed: true, files: [] },
      variant === 'not-admin' ? { sub: '7', role: 'operator' } : actor)).rejects.toThrow();
  });
  it('supports verified legacy core without assigning an invented previous refund', async () => {
    const { apply } = setup({ core_deposit_amount: null });
    await apply({ action: 'core_receive', notes: 'Core legacy physically received', confirmed: true, files: [] });
    const failed = setup({ core_deposit_amount: null });
    failed.context.completed = 10;
    await expect(failed.apply({ action: 'core_receive', notes: 'Unknown previous refund', confirmed: true, files: [] })).rejects.toThrow(/histórico/);
  });
  it('corrects coverage only through admin action and preserves its beginning', async () => {
    const { apply, connection } = setup();
    await apply({ action: 'warranty_correct', days: 90, notes: 'Correct original agreed duration' });
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('warranty_days='))).toBe(true);
    expect(warrantyFromRow({ warranty_terms: { startedAt: new Date().toISOString(), days: 90, policy: 'calendar' } } as RowDataPacket)?.days).toBe(90);
  });
  it('validates evidence membership and actor existence', async () => {
    const { apply, context } = setup(); context.imageFound = false;
    await expect(apply({ action: 'invoice', file: '/uploads/invoice.pdf' })).rejects.toThrow(/soporte/);
    context.actorFound = false;
    await expect(apply({ action: 'core_receive', notes: 'Received core physical', confirmed: true, files: [] })).rejects.toThrow(/Operador/);
  });
  it('returns invoice versions, claim snapshots, Square core refund and parsed history', async () => {
    const { database, context } = setup({ core_returned_at: new Date() });
    const terms = { startedAt: new Date().toISOString(), days: 60, policy: 'calendar' };
    context.openClaims = [{ id: 8, evidence_files: '["/uploads/test.png"]', warranty_snapshot: JSON.stringify(terms) }] as RowDataPacket[];
    context.getInvoices = [{ id: 1, file_url: '/uploads/invoice.pdf' }] as RowDataPacket[];
    context.getRefunds = [{ id: 9, refund_scope: 'core', status: 'completed', amount: '150', execution: JSON.stringify(square) }] as RowDataPacket[];
    context.getHistory = [{ id: 1, details: JSON.stringify({ action: 'core_refund', execution: square }) }] as RowDataPacket[];
    const input = request('GET');
    await handleAftersalesRequest(input.req, input.res, '/api/orders/901/aftersales', actor, database, vi.fn());
    const body = JSON.parse(String(input.end.mock.calls[0][0]));
    expect(body.core.refund.execution.last4).toBe('1234');
    expect(body.claims[0].warranty_snapshot.days).toBe(60);
    expect(body.refunds[0].amount).toBe(150);
    expect(body.history[0].details.action).toBe('core_refund');
  });
  it.each(['duplicate', 'no-deposit', 'missing-receipt'])('rejects invalid core refund %s', async variant => {
    const { apply, row, context } = setup({ core_returned_at: new Date() });
    if (variant === 'duplicate') context.existingCore = [{ id: 9 }] as RowDataPacket[];
    if (variant === 'no-deposit') row.core_deposit_amount = 0;
    if (variant === 'missing-receipt') context.imageFound = false;
    await expect(apply({ action: 'core_refund', execution: square })).rejects.toThrow();
  });
  it('enforces API role restrictions even when the forbidden role owns the order', async () => {
    const { database } = setup();
    for (const role of ['viewer', 'vendedor_yarda']) {
      const input = request('POST', { version: 1, idempotencyKey: 'b6fbe592-e2eb-46a9-9f60-a7f3db45eea1',
        data: { action: 'claim_create', notes: 'Forbidden role mutation', files: [], nextDate: today } });
      await expect(handleAftersalesRequest(input.req, input.res, '/api/orders/901/aftersales', { sub: '7', role }, database, vi.fn())).rejects.toThrow(/permiso|administración/);
    }
  });
  it('routes GET, version conflicts, replay and transaction failures explicitly', async () => {
    const { database, connection, context } = setup();
    let input = request('GET');
    await handleAftersalesRequest(input.req, input.res, '/api/orders/901/aftersales', actor, database, vi.fn());
    expect(input.res.statusCode).toBe(200);
    expect(JSON.parse(String(input.end.mock.calls[0][0])).warranty.terms.policy).toBe('elapsed');
    const data = { data: { action: 'core_receive', notes: 'Core physically received', confirmed: true, files: [] }, version: 1, idempotencyKey: 'b6fbe592-e2eb-46a9-9f60-a7f3db45eea1' };
    input = request('POST', data);
    await handleAftersalesRequest(input.req, input.res, '/api/orders/901/aftersales', actor, database, vi.fn());
    context.replay = true; input = request('POST', data);
    const broadcast = vi.fn();
    await handleAftersalesRequest(input.req, input.res, '/api/orders/901/aftersales', actor, database, broadcast);
    expect(broadcast).not.toHaveBeenCalled();
    context.replay = false; input = request('POST', { ...data, version: 2 });
    await expect(handleAftersalesRequest(input.req, input.res, '/api/orders/901/aftersales', actor, database, vi.fn())).rejects.toThrow(/cambió/);
    expect(connection.rollback).toHaveBeenCalled();
    input = request('DELETE');
    await handleAftersalesRequest(input.req, input.res, '/api/orders/901/aftersales', actor, database, vi.fn()); expect(input.res.statusCode).toBe(405);
    expect(await handleAftersalesRequest(input.req, input.res, '/api/other', actor, database, vi.fn())).toBe(false);
    context.found = false; input = request('GET');
    await expect(handleAftersalesRequest(input.req, input.res, '/api/orders/901/aftersales', actor, database, vi.fn())).rejects.toThrow(/encontrada/);
  });
  it('accepts review dates on the final allowed future calendar boundary', async () => {
    const { apply } = setup();
    await apply({ action: 'claim_create', notes: 'Claim future scheduled review', files: [], nextDate: shiftWorkflowDate(today, 5) });
  });
});
