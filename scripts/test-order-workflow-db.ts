import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { createConnection, createPool, type RowDataPacket } from 'mysql2/promise';
import { pool as applicationPool } from '../src/server/config';
import { enforceWorkflowUpdate, handleWorkflowRequest } from '../src/server/orderWorkflow';
import { ensureAuditTable } from '../src/server/audit';
import { addWorkingDays, workflowDate } from '../src/utils/orderWorkflow';
import { handlePaymentRequest } from '../src/server/orderPayments';

const host = process.env.DB_HOST;
assert.ok(host && ['127.0.0.1', 'localhost', 'db'].includes(host), 'Only a local disposable database is allowed.');
const schema = `radar_workflow_test_${Date.now()}_${process.pid}`;
const options = { host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, timezone: 'Z' };
const admin = await createConnection(options);
let created = false;
let database: ReturnType<typeof createPool> | undefined;
try {
  await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  created = true;
  const migration = await createConnection({ ...options, database: schema, multipleStatements: true });
  try {
    for (const file of (await readdir('migrations')).filter(file => file.endsWith('.sql')).sort()) {
      await migration.query(await readFile(`migrations/${file}`, 'utf8'));
    }
    await migration.query(await readFile('migrations/022_order_workflow_events.sql', 'utf8'));
    await migration.query(await readFile('migrations/023_order_payments.sql', 'utf8'));
  } finally { await migration.end(); }
  database = createPool({ ...options, database: schema });
  await ensureAuditTable(database);
  await database.execute("INSERT INTO users (id,name,email,password,role) VALUES (7,'Test operator','operator@example.test','not-a-real-password','operator')");
  await database.execute("INSERT INTO customers (id,first_name,phone) VALUES (1,'Test customer','2025550100')");
  await database.execute(`INSERT INTO orders (id,order_code,customer_id,user_id,product_type,price,down_payment,status,created_at)
    VALUES (901,'ORD-WORKFLOW-TEST',1,7,'Test part',100,100,'Pagado','2026-10-21 16:00:00')`);
  const today = workflowDate(new Date());
  const events: string[] = [];
  const invoke = async (method: string, path: string, body: Record<string, unknown> = {}, actor = '7', role = 'operator') => {
    const request = new IncomingMessage(new Socket());
    request.method = method; request.headers = { 'content-type': 'application/json' };
    request.push(Buffer.from(JSON.stringify(body))); request.push(null);
    const response = new ServerResponse(request);
    let output: Record<string, unknown>;
    response.end = ((data: Buffer | string) => { output = JSON.parse(String(data)); return response; }) as typeof response.end;
    const handler = path.endsWith('/payments') ? handlePaymentRequest : handleWorkflowRequest;
    await handler(request, response, path, { sub: actor, role }, database!, type => { events.push(type); });
    return { status: response.statusCode, data: output! };
  };
  const save = async (task: string, extra: Record<string, unknown> = {}) => {
    const [rows] = await database!.query<RowDataPacket[]>('SELECT version FROM orders WHERE id=901');
    return invoke('POST', '/api/orders/901/workflow', {
      version: Number(rows[0].version), task, outcome: 'completed', notes: 'Verified test management',
      evidence: 'Synthetic verifiable reference', confirmed: true, ...extra,
    });
  };
  await assert.rejects(save('prepare'), /etapa/);
  await assert.rejects(invoke('POST', '/api/orders/901/workflow', { version: 1, task: 'ack', outcome: 'completed', notes: 'Invalid evidence', evidence: '', confirmed: true }), /evidencia/);
  await assert.rejects(invoke('POST', '/api/orders/901/workflow', { version: 1, task: 'quote', outcome: 'completed', notes: 'Wrong operator', evidence: 'Reference', confirmed: true }, '8'), /asignado/);
  await assert.rejects(save('quote'), /etapa/);
  assert.equal((await save('ack', { nextDueDate: addWorkingDays(today, 1) })).status, 201);
  await assert.rejects(invoke('POST', '/api/orders/901/workflow', { version: 1, task: 'ack', outcome: 'completed', notes: 'Stale version', evidence: 'Reference', confirmed: true }), /cambió/);
  assert.equal((await save('prepare', { scheduledAt: new Date(Date.now() + 86400000).toISOString() })).status, 201);
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM orders WHERE id=901 FOR UPDATE');
    await assert.rejects(enforceWorkflowUpdate(connection, rows[0], { status: 'entregado', workflowStep: 4 }), /entrega física/);
    await enforceWorkflowUpdate(connection, rows[0], { status: 'listo_retiro', workflowStep: 4 });
    await connection.execute("UPDATE orders SET status='Listo para Retiro',version=version+1 WHERE id=901");
    await connection.commit();
  } finally { connection.release(); }
  assert.equal((await save('delivery')).status, 201);
  const [delivered] = await database.query<RowDataPacket[]>('SELECT delivered_at,warranty_started FROM orders WHERE id=901');
  assert.equal(Number(delivered[0].warranty_started), 1);
  await assert.rejects(save('post_3', { contactResult: 'sms_replied', partStatus: 'installed_ok' }), /todavía/);
  await database.execute('UPDATE orders SET delivered_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 3 DAY) WHERE id=901');
  const [original] = await database.query<RowDataPacket[]>('SELECT delivered_at,warranty_started FROM orders WHERE id=901');
  assert.equal((await save('post_3', { contactResult: 'sms_replied', partStatus: 'installed_ok' })).status, 201);
  const queue = await invoke('GET', '/api/orders/901/workflow');
  const tasks = queue.data.tasks as { task: string }[];
  assert.equal(tasks[0].task, 'post_7');
  const [after] = await database.query<RowDataPacket[]>('SELECT delivered_at,warranty_started FROM orders WHERE id=901');
  assert.deepEqual(after, original);
  const [counts] = await database.query<RowDataPacket[]>(`SELECT
    (SELECT COUNT(*) FROM order_workflow_events) AS events,
    (SELECT COUNT(*) FROM order_delivery_followups) AS contacts,
    (SELECT COUNT(*) FROM call_register WHERE whatsapp_dispatched=0) AS reports`);
  assert.equal(Number(counts[0].events), 4); assert.equal(Number(counts[0].contacts), 1); assert.equal(Number(counts[0].reports), 1);
  assert.equal(events.length, 4);
  await database.execute(`INSERT INTO orders (id,order_code,customer_id,user_id,product_type,price,core_fee,down_payment,status,created_at)
    VALUES (902,'ORD-PAYMENT-LEGACY',1,7,'Test part',900,100,200,'Listo para Retiro','2026-10-01 16:00:00'),
    (903,'ORD-PAYMENT-NEW',1,7,'Test part',900,100,200,'Listo para Retiro','2026-10-21 16:00:00'),
    (904,'ORD-PAYMENT-CONCURRENT',1,7,'Test part',900,0,0,'Cotización','2026-10-21 16:00:00')`);
  const settlement = {
    payments: [{ amount: 300, method: 'cash', reference: '', confirmed: true }, { amount: 400, method: 'zelle', reference: 'TEST-REFERENCE', confirmed: true }],
    coreAction: 'received', coreReference: 'TEST-CORE-RECEIPT', coreConfirmed: true,
  };
  const delivery = { notes: 'Synthetic physical handover', evidence: 'Test signed receipt', confirmed: true };
  const legacy = { version: 1, settlement, delivery };
  assert.equal((await invoke('POST', '/api/orders/902/payments', legacy, '7', 'admin')).status, 201);
  await assert.rejects(invoke('POST', '/api/orders/902/payments', legacy, '7', 'admin'), /cambió/);
  const history = await invoke('GET', '/api/orders/902/payments');
  const payments = history.data.payments as { amount: number; method: string }[];
  assert.deepEqual(payments.map(item => [item.amount, item.method]), [[300, 'cash'], [400, 'zelle']]);
  const [collected] = await database.query<RowDataPacket[]>('SELECT down_payment,core_fee,core_received_amount,status,warranty_started FROM orders WHERE id=902');
  assert.equal(Number(collected[0].down_payment), 900); assert.equal(Number(collected[0].core_fee), 0);
  assert.equal(Number(collected[0].core_received_amount), 100); assert.equal(collected[0].status, 'Entregado');
  assert.equal(Number(collected[0].warranty_started), 1);
  await database.execute(`INSERT INTO order_workflow_events (order_id,task,outcome,actor_id,actor_name,notes,evidence)
    SELECT 903,task,outcome,actor_id,actor_name,notes,evidence FROM order_workflow_events WHERE order_id=901 AND task IN ('quote','ack','prepare')`);
  await database.execute('UPDATE orders SET inventory_part_id=999999 WHERE id=903');
  const managed = { version: 1, settlement, task: 'delivery', outcome: 'completed', ...delivery };
  await assert.rejects(invoke('POST', '/api/orders/903/workflow', managed, '7', 'admin'), /inventario/);
  const [rollback] = await database.query<RowDataPacket[]>(`SELECT
    (SELECT COUNT(*) FROM finance_movements WHERE order_id=903) AS payments,
    (SELECT COUNT(*) FROM order_core_receipts WHERE order_id=903) AS receipts,
    (SELECT down_payment FROM orders WHERE id=903) AS paid`);
  assert.equal(Number(rollback[0].payments), 0); assert.equal(Number(rollback[0].receipts), 0); assert.equal(Number(rollback[0].paid), 200);
  await database.execute('UPDATE orders SET inventory_part_id=NULL WHERE id=903');
  assert.equal((await invoke('POST', '/api/orders/903/workflow', managed, '7', 'admin')).status, 201);
  const partial = { version: 1, settlement: { payments: [{ amount: 10, method: 'cash', reference: '', confirmed: true }], coreAction: 'keep', coreReference: '', coreConfirmed: false } };
  const concurrent = await Promise.allSettled([invoke('POST', '/api/orders/904/payments', partial, '7', 'admin'), invoke('POST', '/api/orders/904/payments', partial, '7', 'admin')]);
  assert.equal(concurrent.filter(item => item.status === 'fulfilled').length, 1);
  const [once] = await database.query<RowDataPacket[]>('SELECT down_payment,version,delivered_at FROM orders WHERE id=904');
  assert.equal(Number(once[0].down_payment), 10); assert.equal(Number(once[0].version), 2); assert.equal(once[0].delivered_at, null);
  await database.execute("INSERT INTO audit_logs (user_id,action,resource_type,resource_id,details) VALUES (7,'ORDER_CREATED','order','901','{}')");
  await database.execute('UPDATE orders SET user_id=NULL WHERE id=901');
  const quotation = await invoke('GET', '/api/orders/901/workflow', {}, '7', 'admin');
  assert.equal((quotation.data.order as { quoteCreatedBy: string }).quoteCreatedBy, 'Test operator');
  const unknownCreator = await invoke('GET', '/api/orders/904/workflow', {}, '7', 'admin');
  assert.equal((unknownCreator.data.order as { quoteCreatedBy: string | null }).quoteCreatedBy, null);
  assert.equal((unknownCreator.data.tasks as { task: string }[])[0].task, 'ack');
  console.log('PASS: quotation automatically complete; audit creation actor survives reassignment, missing historical actor explicit; no manual quote mutation.');
  console.log('PASS: split collection + legacy/workflow delivery, core receipt, ledger methods, inventory-failure rollback and concurrent duplicate prevention on real MariaDB.');
  console.log('PASS: all migrations + idempotent workflow DDL; authenticated transaction, concurrency, ordered evidence, delivery, preserved warranty, calendar milestones and existing contact reporting.');
} finally {
  if (database) await database.end();
  if (created) await admin.query(`DROP DATABASE \`${schema}\``);
  await admin.end();
  await applicationPool.end();
}
