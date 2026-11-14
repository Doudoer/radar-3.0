import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise';
import { handleWorkflowRequest, workflowEventFromRow } from '../src/server/orderWorkflow';
import { unlockFinanceVault } from '../src/server/financeVault';
import { validateWorkflowAction } from '../src/utils/orderWorkflow';

vi.mock('../src/server/config', () => ({
  pool: {},
  maxBodyBytes: 50000,
  jwtSecret: 'test-only',
  frontendRoot: '',
}));

const pools: Pool[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

const createMockRequest = (method = 'POST', body: Record<string, unknown> = {}) => {
  const req = new IncomingMessage(new Socket());
  req.method = method;
  req.headers = { 'content-type': 'application/json' };
  req.push(Buffer.from(JSON.stringify(body)));
  req.push(null);
  const res = new ServerResponse(req);
  const end = vi.spyOn(res, 'end').mockReturnValue(res);
  return { req, res, end };
};

const unlockVault = (req: IncomingMessage, res: ServerResponse, claims: { sub: string; role: string }) => {
  const token = 'test-session-token';
  req.headers.authorization = `Bearer ${token}`;
  unlockFinanceVault(res, claims as any, token);
  const header = res.getHeader('Set-Cookie');
  const cookies = Array.isArray(header) ? header : [String(header || '')];
  const finance = cookies.find(value => value.startsWith('radar_finance='));
  req.headers.cookie = finance ? finance.split(';')[0] : '';
};

describe('Exempt Downpayment Admin Feature', () => {
  it('allows an Administrator to exempt downpayment, sets status to Pagado, and records workflow event', async () => {
    const executedQueries: { sql: string; values?: any[] }[] = [];

    const mockOrder = {
      id: 555,
      order_code: 'ORD-2026-5555',
      status: 'Cotizacion',
      version: 1,
      total: 1200,
      down_payment: 0,
    };

    const database = mysql.createPool({ host: '127.0.0.1', port: 1, user: 'test', connectTimeout: 1 });
    pools.push(database);

    const connection = Object.assign(database, {
      connection: database,
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
      query: vi.fn((sql: string, values?: any[]) => {
        executedQueries.push({ sql, values });
        if (sql.includes('SELECT id,version,order_code,status,down_payment FROM orders')) {
          return Promise.resolve([[mockOrder] as RowDataPacket[], []]);
        }
        if (sql.includes('SELECT name FROM users WHERE id=?')) {
          return Promise.resolve([[{ name: 'Super Admin' }] as RowDataPacket[], []]);
        }
        return Promise.resolve([[], []]);
      }),
      execute: vi.fn((sql: string, values?: any[]) => {
        executedQueries.push({ sql, values });
        return Promise.resolve([{ affectedRows: 1, insertId: 99 } as any, []]);
      }),
    });

    vi.spyOn(database, 'getConnection').mockResolvedValue(connection as any);

    const { req, res } = createMockRequest('POST', {
      notes: 'Cliente de confianza - cobro 100% contra entrega',
    });

    const claims = { sub: '1', role: 'admin', username: 'admin' };
    unlockVault(req, res, claims);
    const broadcast = vi.fn();
    const handled = await handleWorkflowRequest(
      req,
      res,
      '/api/orders/555/exempt-downpayment',
      claims as any,
      database,
      broadcast
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);

    // Verify orders update: status='Pagado', downpayment_verified=1
    const orderUpdate = executedQueries.find((q) => q.sql.includes('UPDATE orders SET downpayment_verified=1'));
    expect(orderUpdate).toBeDefined();
    expect(orderUpdate?.values).toEqual([1, '555']);

    // Verify order_workflow_events insert: task='ack', outcome='completed'
    const workflowEventInsert = executedQueries.find((q) => q.sql.includes('INSERT INTO order_workflow_events'));
    expect(workflowEventInsert).toBeDefined();
    expect(workflowEventInsert?.values?.[0]).toBe('555');
    expect(workflowEventInsert?.values?.[1]).toBe(1); // actor_id
    expect(workflowEventInsert?.values?.[2]).toBe('Super Admin'); // actor_name
    expect(workflowEventInsert?.values?.[3]).toBe('Cliente de confianza - cobro 100% contra entrega'); // notes

    // Verify audit log insert: DOWNPAYMENT_EXEMPTED
    const auditInsert = executedQueries.find((q) => q.sql.includes("action,resource_type,resource_id,details) VALUES (?,?,'DOWNPAYMENT_EXEMPTED'"));
    expect(auditInsert).toBeDefined();

    // Verify status_orders insert: Pagado
    const statusInsert = executedQueries.find((q) => q.sql.includes('INSERT INTO status_orders'));
    expect(statusInsert).toBeDefined();
    expect(statusInsert?.values?.[1]).toBe('Pagado');
  });

  it('rejects non-admin operators attempting to exempt downpayment', async () => {
    const database = mysql.createPool({ host: '127.0.0.1', port: 1, user: 'test', connectTimeout: 1 });
    pools.push(database);

    const { req, res } = createMockRequest('POST', { notes: 'Intentando exonerar sin permisos' });
    const operatorClaims = { sub: '2', role: 'operator', username: 'advisor1' };
    const broadcast = vi.fn();

    const handled = await handleWorkflowRequest(
      req,
      res,
      '/api/orders/555/exempt-downpayment',
      operatorClaims as any,
      database,
      broadcast
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(403);
  });

  it('requires the finance vault before an admin can exempt a downpayment', async () => {
    const database = mysql.createPool({ host: '127.0.0.1', port: 1, user: 'test', connectTimeout: 1 });
    pools.push(database);
    const getConnection = vi.spyOn(database, 'getConnection');

    const { req, res, end } = createMockRequest('POST', { notes: 'Sin bóveda' });
    const claims = { sub: '1', role: 'admin', username: 'admin' };
    const handled = await handleWorkflowRequest(
      req, res, '/api/orders/555/exempt-downpayment', claims as any, database, vi.fn()
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(String(end.mock.calls[0][0]))).toMatchObject({ code: 'FINANCE_LOCKED' });
    expect(getConnection).not.toHaveBeenCalled();
  });

  it('requires the finance vault before an admin can verify a downpayment', async () => {
    const database = mysql.createPool({ host: '127.0.0.1', port: 1, user: 'test', connectTimeout: 1 });
    pools.push(database);
    const getConnection = vi.spyOn(database, 'getConnection');

    const { req, res, end } = createMockRequest('POST');
    const claims = { sub: '1', role: 'admin', username: 'admin' };
    const handled = await handleWorkflowRequest(
      req, res, '/api/orders/555/verify-downpayment', claims as any, database, vi.fn()
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(String(end.mock.calls[0][0]))).toMatchObject({ code: 'FINANCE_LOCKED' });
    expect(getConnection).not.toHaveBeenCalled();
  });

  it('requires the finance vault for workflow actions that exempt the downpayment', async () => {
    const database = mysql.createPool({ host: '127.0.0.1', port: 1, user: 'test', connectTimeout: 1 });
    pools.push(database);
    const getConnection = vi.spyOn(database, 'getConnection');

    const { req, res, end } = createMockRequest('POST', {
      version: 1, task: 'ack', outcome: 'completed', exemptDownpayment: true,
    });
    const claims = { sub: '1', role: 'admin', username: 'admin' };
    const handled = await handleWorkflowRequest(
      req, res, '/api/orders/555/workflow', claims as any, database, vi.fn()
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(String(end.mock.calls[0][0]))).toMatchObject({ code: 'FINANCE_LOCKED' });
    expect(getConnection).not.toHaveBeenCalled();
  });

  it('does not honor a vault grant issued to another admin session', async () => {
    const database = mysql.createPool({ host: '127.0.0.1', port: 1, user: 'test', connectTimeout: 1 });
    pools.push(database);
    const getConnection = vi.spyOn(database, 'getConnection');

    const { req, res, end } = createMockRequest('POST', { notes: 'Sesión distinta' });
    unlockVault(req, res, { sub: '1', role: 'admin' });
    const handled = await handleWorkflowRequest(
      req, res, '/api/orders/555/exempt-downpayment', { sub: '2', role: 'admin' } as any, database, vi.fn()
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(String(end.mock.calls[0][0]))).toMatchObject({ code: 'FINANCE_LOCKED' });
    expect(getConnection).not.toHaveBeenCalled();
  });

  it('validates WorkflowAction with exemptDownpayment: true allows $0 paid in ack stage', () => {
    const order = {
      id: 555,
      code: 'ORD-2026-5555',
      version: 1,
      userId: 1,
      advisor: 'Admin',
      createdAt: '2026-11-11T12:00:00Z',
      status: 'cotizacion',
      paid: 0,
      total: 1000,
    } as any;

    const action = {
      version: 1,
      task: 'ack' as const,
      outcome: 'completed' as const,
      exemptDownpayment: true,
      notes: 'Exonerado por Administrador',
    };

    // Should not throw error even with paid = 0
    expect(() => validateWorkflowAction(order, [], action)).not.toThrow();
  });

  it('safely parses workflow events without crashing on 0 amount downpayment', () => {
    const row = {
      id: 1,
      order_id: 555,
      task: 'ack',
      outcome: 'completed',
      notes: 'Exonerado',
      evidence: '',
      actor_id: 1,
      actor_name: 'Admin',
      created_at: new Date(),
      next_due_date: null,
      next_action: null,
      blocked_by: null,
      scheduled_at: null,
      contact_result: null,
      part_status: null,
      task_due_date: null,
      downpayment_details: JSON.stringify([{ method: 'cash', amount: 0, receivedBy: 'Exonerado' }]),
      preparation_details: null,
    } as any;

    expect(() => workflowEventFromRow(row)).not.toThrow();
    const event = workflowEventFromRow(row);
    expect(event.downpayment).toBeNull();
  });
});
