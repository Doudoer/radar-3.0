import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { createConnection, createPool, type RowDataPacket } from 'mysql2/promise';
import { pool as applicationPool } from '../src/server/config';
import { applyAftersalesAction, handleAftersalesRequest, parseStoredJson } from '../src/server/aftersales';
import { ensureAuditTable } from '../src/server/audit';
import { completeOrderDelivery } from '../src/server/orderPayments';
import { refundExecutionSchema, warrantyTermsSchema, type AftersalesAction } from '../src/utils/aftersales';
import { shiftWorkflowDate, workflowDate } from '../src/utils/orderWorkflow';
import { getOrderWarrantyInfo } from '../src/utils/orderWarranty';
import { mapOrder } from '../src/server/orders';

const host = process.env.DB_HOST;
assert.ok(host && ['127.0.0.1', 'localhost', 'db'].includes(host), 'Local disposable database only.');
const schema = `radar_aftersales_test_${Date.now()}_${process.pid}`;
const options = { host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, timezone: 'Z' };
const admin = await createConnection(options);
const database = createPool({ ...options, database: schema });
let created = false;
try {
  await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
  const migration = await createConnection({ ...options, database: schema, multipleStatements: true });
  try {
    for (const file of (await readdir('migrations')).filter(file => file.endsWith('.sql')).sort()) await migration.query(await readFile(`migrations/${file}`, 'utf8'));
    await migration.query(await readFile('migrations/028_aftersales.sql', 'utf8'));
  } finally { await migration.end(); }
  await ensureAuditTable(database);
  await database.execute("INSERT INTO users (id,name,email,password,role) VALUES (7,'Test admin','admin@example.test','test-only','admin'),(8,'Test operator','operator@example.test','test-only','operator')");
  await database.execute("INSERT INTO customers (id,first_name,phone) VALUES (1,'Synthetic customer','2025550100')");
  const now = new Date();
  const today = workflowDate(now);
  for (const id of [900, 901, 902, 903, 904, 905]) {
    await database.execute(`INSERT INTO orders (id,order_code,customer_id,user_id,product_type,price,core_fee,down_payment,status,delivered_at,warranty_started,warranty_terms,core_deposit_amount)
      VALUES (?,?,1,8,'Test part',1000,150,1150,'Entregado',?,1,?,150)`,
      [id, `TEST-AFTER-${id}`, now, JSON.stringify({ startedAt: now.toISOString(), days: 60, policy: 'calendar' })]);
  }
  for (const [filename, mime, orderId] of [['invoice.pdf', 'application/pdf', 900], ['receipt.png', 'image/png', 900], ['foreign.pdf', 'application/pdf', 902]]) {
    await database.execute('INSERT INTO uploaded_files (filename,original_name,content_type,size_bytes,user_id,order_id) VALUES (?,?,?,?,7,?)', [filename, filename, mime, 100, orderId]);
  }
  const events: string[] = [];
  const row = async (id = 900) => (await database.query<RowDataPacket[]>('SELECT * FROM orders WHERE id=?', [id]))[0][0];
  const invoke = async (data?: AftersalesAction, id = 900, key = crypto.randomUUID(), version?: number, role = 'admin', actor = '7') => {
    const request = new IncomingMessage(new Socket()); request.method = data ? 'POST' : 'GET'; request.headers = { 'content-type': 'application/json' };
    request.push(Buffer.from(JSON.stringify(data ? { data, version: version ?? Number((await row(id)).version), idempotencyKey: key } : {}))); request.push(null);
    const response = new ServerResponse(request); let output: Record<string, unknown> = {};
    response.end = ((value: Buffer | string) => { output = JSON.parse(String(value)); return response; }) as typeof response.end;
    await handleAftersalesRequest(request, response, `/api/orders/${id}/aftersales`, { sub: actor, role }, database, type => events.push(type));
    return output;
  };
  await assert.rejects(invoke({ action: 'invoice', file: '/uploads/foreign.pdf' }), /soporte/);
  const beforeInvoice = await row();
  const invoiceKey = crypto.randomUUID();
  const invoiceVersion = Number(beforeInvoice.version);
  const invoiceAction = { action: 'invoice', file: '/uploads/invoice.pdf' } as const;
  await invoke(invoiceAction, 900, invoiceKey, invoiceVersion);
  await invoke(invoiceAction, 900, invoiceKey, invoiceVersion);
  const [invoices] = await database.query<RowDataPacket[]>('SELECT * FROM order_invoices');
  assert.equal(invoices.length, 1, 'Invoice retry must not duplicate version');
  const afterInvoice = await row();
  for (const key of ['down_payment', 'status', 'delivered_at', 'warranty_terms']) assert.deepEqual(afterInvoice[key], beforeInvoice[key]);
  const snapshot = async () => {
    const [orders] = await database.query('SELECT * FROM orders ORDER BY id');
    const [refunds] = await database.query('SELECT * FROM refund_requests ORDER BY id');
    const [ledger] = await database.query('SELECT * FROM finance_movements ORDER BY id');
    const [history] = await database.query('SELECT * FROM order_aftersales_history ORDER BY id');
    return { orders, refunds, ledger, history };
  };
  const initial = await snapshot();
  await assert.rejects(invoke({ action: 'core_refund', execution: { method: 'cash', recipient: 'Test customer', confirmed: true } }), /primero/);
  assert.deepEqual(await snapshot(), initial);
  await invoke({ action: 'core_receive', notes: 'Core physically received', files: [], confirmed: true });
  const currentVersion = Number((await row()).version);
  const cash = { action: 'core_refund', execution: { method: 'cash', recipient: 'Test customer', confirmed: true } } as const;
  const results = await Promise.allSettled([invoke(cash, 900, crypto.randomUUID(), currentVersion), invoke(cash, 900, crypto.randomUUID(), currentVersion)]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  const [coreRefunds] = await database.query<RowDataPacket[]>("SELECT * FROM refund_requests WHERE refund_scope='core'");
  assert.equal(coreRefunds.length, 1); assert.equal(Number(coreRefunds[0].amount), 150);
  assert.equal((await row()).status, 'Entregado');
  assert.deepEqual((await row()).delivered_at, beforeInvoice.delivered_at);
  assert.deepEqual((await row()).warranty_terms, beforeInvoice.warranty_terms);
  await assert.rejects(invoke(cash), /ya fue/);
  await assert.rejects(invoke({ action: 'refund_create', amount: 1000.01, notes: 'Reject excessive purchase refund', files: [], pieceRequired: false }), /excede/);
  await invoke({ action: 'refund_create', amount: 1000, notes: 'Purchase return after core refund', files: [], pieceRequired: true });
  const [requests] = await database.query<RowDataPacket[]>("SELECT * FROM refund_requests WHERE refund_scope='purchase'");
  const refundId = Number(requests[0].id);
  await assert.rejects(invoke({ action: 'refund_update', id: refundId, stage: 'completed', notes: 'Premature cash refund', pieceReceived: true, execution: cash.execution }), /revisión/);
  await invoke({ action: 'refund_update', id: refundId, stage: 'review', notes: 'Verified collected funds and return', pieceReceived: false });
  await invoke({ action: 'refund_update', id: refundId, stage: 'approved', notes: 'Approved purchase refund', pieceReceived: false });
  const beforeFailure = await snapshot();
  await assert.rejects(invoke({ action: 'refund_update', id: refundId, stage: 'completed', notes: 'Missing required returned piece', pieceReceived: false, execution: cash.execution }), /pieza/);
  assert.deepEqual(await snapshot(), beforeFailure);
  await invoke({ action: 'refund_update', id: refundId, stage: 'completed', notes: 'Piece returned and customer paid', pieceReceived: true,
    execution: { method: 'square', last4: '1234', reference: 'SQ-TEST-1', receipt: '/uploads/receipt.png', confirmed: true } });
  assert.equal((await row()).status, 'Reembolsado');
  const [ledger] = await database.query<RowDataPacket[]>("SELECT * FROM finance_movements WHERE kind='refund'");
  assert.equal(ledger.length, 2); assert.equal(ledger.reduce((sum, entry) => sum + Number(entry.amount), 0), 1150);
  const [executed] = await database.query<RowDataPacket[]>('SELECT * FROM refund_requests WHERE id=?', [refundId]);
  assert.ok(executed[0].completed_at);
  const square = refundExecutionSchema.parse(parseStoredJson(executed[0].execution));
  assert.ok(square.method === 'square');
  assert.equal(square.last4, '1234');
  await invoke({ action: 'claim_create', notes: 'Reported part malfunction', files: [], nextDate: today }, 901);
  const [claimsRows] = await database.query<RowDataPacket[]>('SELECT * FROM claims WHERE order_id=901');
  const claimId = Number(claimsRows[0].id);
  const oldSnapshot = claimsRows[0].warranty_snapshot;
  await database.execute('UPDATE orders SET warranty_terms=? WHERE id=901', [JSON.stringify({ startedAt: '2020-01-01T12:00:00Z', days: 60, policy: 'calendar' })]);
  await invoke({ action: 'claim_update', id: claimId, stage: 'review', notes: 'Client called, case still valid after expiry', notified: false, files: [], nextDate: today }, 901);
  await invoke({ action: 'claim_update', id: claimId, stage: 'resolution', notes: 'Replacement approved for client', notified: false, files: [], nextDate: today }, 901);
  await assert.rejects(invoke({ action: 'claim_update', id: claimId, stage: 'replacement', notes: 'Replacement not yet delivered', notified: true, files: [], replacementStock: 'TEST-STOCK', confirmed: false }, 901), /entrega/);
  const originalDelivery = (await row(901)).delivered_at;
  await invoke({ action: 'claim_update', id: claimId, stage: 'replacement', notes: 'Replacement handed to client', notified: true, files: [], replacementStock: 'TEST-STOCK', confirmed: true }, 901);
  assert.equal((await row(901)).status, 'Entregado');
  assert.deepEqual((await row(901)).delivered_at, originalDelivery, 'Replacement must not reset original delivery/core clock');
  assert.equal(getOrderWarrantyInfo(mapOrder(await row(901))).status, 'active');
  assert.equal(warrantyTermsSchema.parse(parseStoredJson((await row(901)).warranty_terms)).days, warrantyTermsSchema.parse(parseStoredJson(oldSnapshot)).days);
  await database.execute('UPDATE orders SET warranty_terms=? WHERE id=902', [JSON.stringify({ startedAt: '2020-01-01T12:00:00Z', days: 60, policy: 'elapsed' })]);
  await assert.rejects(invoke({ action: 'claim_create', notes: 'Expired warranty case', files: [], nextDate: today }, 902), /expiró/);
  const local = await database.getConnection();
  try {
    await local.beginTransaction();
    const onTime = new Date(`${shiftWorkflowDate(today, 15)}T17:00:00Z`);
    await applyAftersalesAction(local, await row(903), { action: 'core_receive', notes: 'Core on final allowed day', confirmed: true, files: [] }, { sub: '7', role: 'admin' }, onTime);
    await local.rollback();
    await local.beginTransaction();
    await assert.rejects(applyAftersalesAction(local, await row(903), { action: 'core_receive', notes: 'Core one day late', confirmed: true, files: [] },
      { sub: '7', role: 'admin' }, new Date(`${shiftWorkflowDate(today, 16)}T17:00:00Z`)), /venció/);
    await local.rollback();
  } finally { local.release(); }
  await assert.rejects(invoke({ action: 'core_receive', notes: 'Unauthorized core return', confirmed: true, files: [] }, 904, crypto.randomUUID(), undefined, 'operator', '8'), /administración/);
  await assert.rejects(invoke(undefined, 900, crypto.randomUUID(), undefined, 'operator', '999'), /asignado/);
  await database.execute("UPDATE orders SET status='Listo para Retiro',delivered_at=NULL,warranty_started=0,warranty_terms=NULL,core_fee=0,down_payment=1000 WHERE id=905");
  const delivery = await database.getConnection();
  try { await delivery.beginTransaction(); await completeOrderDelivery(delivery, await row(905), { sub: '7', role: 'admin' }, 'Test physical delivery'); await delivery.commit(); }
  finally { delivery.release(); }
  const delivered = await row(905);
  assert.equal(warrantyTermsSchema.parse(parseStoredJson(delivered.warranty_terms)).policy, 'calendar');
  assert.equal(Number(delivered.core_deposit_amount), 0);
  const loaded = await invoke(undefined, 900);
  assert.ok(loaded.invoices); assert.ok(loaded.history);
  console.log('PASS: isolated MariaDB migrations repeat; invoice ownership/history/idempotency; cash core refund only after receipt, date boundary, one concurrent save, delivery/warranty unchanged; shared purchase/core cap, approval separate from execution, missing piece rollback, Square last4/receipt/server timestamp; timely claim survives expiry, verified replacement renews same duration without resetting core; role/access checks and new delivery snapshots.');
} finally {
  await database.end();
  if (created) await admin.query(`DROP DATABASE \`${schema}\``);
  await admin.end(); await applicationPool.end();
}
