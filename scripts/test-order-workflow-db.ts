import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { createConnection, createPool, type RowDataPacket } from 'mysql2/promise';
import { pool as applicationPool } from '../src/server/config';
import { enforceWorkflowUpdate, handleWorkflowRequest } from '../src/server/orderWorkflow';
import { ensureAuditTable } from '../src/server/audit';
import { addWorkingDays, completedWorkflowStages, workflowDate, type WorkflowOrder } from '../src/utils/orderWorkflow';
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
    for (const file of (await readdir('migrations')).filter(file => file.endsWith('.sql') && file !== '025_confirmation_rollout.sql').sort()) {
      await migration.query(await readFile(`migrations/${file}`, 'utf8'));
    }
    await migration.query(await readFile('migrations/022_order_workflow_events.sql', 'utf8'));
    await migration.query(await readFile('migrations/023_order_payments.sql', 'utf8'));
    await migration.query(await readFile('migrations/024_workflow_downpayment_details.sql', 'utf8'));
    await migration.query(await readFile('migrations/026_verified_preparation.sql', 'utf8'));
    await migration.query(await readFile('migrations/027_collection_evidence.sql', 'utf8'));
  } finally { await migration.end(); }
  database = createPool({ ...options, database: schema });
  await ensureAuditTable(database);
  await database.execute("INSERT INTO users (id,name,email,password,role) VALUES (7,'Test operator','operator@example.test','not-a-real-password','operator')");
  await database.execute("INSERT INTO customers (id,first_name,phone) VALUES (1,'Test customer','2025550100')");
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
  await database.execute(`INSERT INTO orders (id,order_code,customer_id,user_id,product_type,price,down_payment,status,created_at)
    VALUES (801,'ORD-ROLLOUT-PAID',1,7,'Test part',100,100,'Pagado','2026-10-31 16:00:00'),
    (802,'ORD-ROLLOUT-QUOTE',1,7,'Test part',100,50,'Cotización','2026-10-31 16:00:00'),
    (803,'ORD-ROLLOUT-READY',1,7,'Test part',100,100,'Listo para Retiro','2026-10-31 16:00:00')`);
  const [beforeRollout] = await database.query('SELECT * FROM orders ORDER BY id');
  const [beforeLedger] = await database.query('SELECT * FROM finance_movements ORDER BY id');
  const applyRollout = async () => {
    const ddl = await createConnection({ ...options, database: schema, multipleStatements: true });
    try { await ddl.query(await readFile('migrations/025_confirmation_rollout.sql', 'utf8')); }
    finally { await ddl.end(); }
  };
  await applyRollout();
  const [afterRollout] = await database.query('SELECT * FROM orders ORDER BY id');
  assert.deepEqual(afterRollout, beforeRollout, 'Snapshot must not change any original order value');
  const [afterLedger] = await database.query('SELECT * FROM finance_movements ORDER BY id');
  assert.deepEqual(afterLedger, beforeLedger);
  const [snapshot] = await database.query<RowDataPacket[]>('SELECT * FROM order_confirmation_rollout ORDER BY order_id');
  assert.deepEqual(snapshot.map(row => [Number(row.order_id), row.confirmation_policy]), [[801, 'preapproved'], [802, 'legacy'], [803, 'legacy']]);
  const preapproved = (await invoke('GET', '/api/orders/801/workflow')).data;
  assert.equal((preapproved.order as { confirmationPolicy: string }).confirmationPolicy, 'preapproved');
  assert.equal((preapproved.tasks as { task: string }[])[0].task, 'prepare');
  assert.deepEqual(preapproved.events, [], 'Preapproval is not a fabricated operator confirmation');
  const transition = await database.getConnection();
  try { await assert.rejects(enforceWorkflowUpdate(transition, (afterRollout as RowDataPacket[]).find(row => Number(row.id) === 801)!, { status: 'en_preparacion' }), /flujo/); }
  finally { transition.release(); }
  await database.execute("UPDATE orders SET status='Pagado' WHERE id=802");
  assert.equal(((await invoke('GET', '/api/orders/802/workflow')).data.tasks as { task: string }[])[0].task, 'ack');
  assert.equal((await invoke('POST', '/api/orders/802/workflow', {
    version: 1, task: 'ack', outcome: 'completed', notes: 'Historical confirmation',
    evidence: 'Existing verifiable reference', confirmed: true, nextDueDate: addWorkingDays(today, 1),
  })).status, 201);
  await database.execute("UPDATE orders SET status='Cotización' WHERE id=801");
  await applyRollout();
  const [snapshotAgain] = await database.query('SELECT * FROM order_confirmation_rollout ORDER BY order_id');
  assert.deepEqual(snapshotAgain, snapshot, 'Rerunning must not resnapshot changed statuses or alter activation date');
  await database.execute('DELETE FROM order_workflow_events WHERE order_id=802');
  events.length = 0;
  await database.execute(`INSERT INTO orders (id,order_code,customer_id,user_id,product_type,price,down_payment,status,created_at)
    VALUES (905,'ORD-WORKFLOW-NEW',1,7,'Test part',100,100,'Pagado',UTC_TIMESTAMP())`);
  await applyRollout();
  const freshOrder = (await invoke('GET', '/api/orders/905/workflow')).data.order as { confirmationPolicy: string };
  assert.equal(freshOrder.confirmationPolicy, 'documented');
  await database.execute(`INSERT INTO orders (id,order_code,customer_id,user_id,product_type,price,down_payment,status,created_at)
    VALUES (901,'ORD-WORKFLOW-TEST',1,7,'Test part',100,100,'Cotización',UTC_TIMESTAMP())`);
  console.log('PASS: one-time rollout snapshots only existing Paid confirmations, retains historical nonpaid behavior, never alters order/ledger values or fabricates events, remains idempotent and keeps later Paid orders subject to new requirements.');
  const save = async (task: string, extra: Record<string, unknown> = {}) => {
    const [rows] = await database!.query<RowDataPacket[]>('SELECT version FROM orders WHERE id=901');
    return invoke('POST', '/api/orders/901/workflow', {
      version: Number(rows[0].version), task, outcome: 'completed', notes: 'Verified test management',
      evidence: 'Synthetic verifiable reference', confirmed: true, ...extra,
    });
  };
  await assert.rejects(save('prepare'), /etapa/);
  const downpayment = [{ method: 'cash', amount: 40, receivedBy: 'Cash receiver', receipt: null },
    { method: 'zelle', amount: 60, receipt: '/uploads/test-receipt.png' }];
  const moneySnapshot = async () => {
    const [orders] = await database!.query('SELECT down_payment,price,core_fee FROM orders WHERE id=901');
    const [ledger] = await database!.query('SELECT * FROM finance_movements ORDER BY id');
    return { orders, ledger };
  };
  const moneyBefore = await moneySnapshot();
  await assert.rejects(save('ack', { downpayment }), /comprobante/);
  await database.execute("INSERT INTO uploaded_files (filename,original_name,content_type,size_bytes,user_id,order_id) VALUES ('test-receipt.png','test.png','image/png',100,8,901)");
  await assert.rejects(save('ack', { downpayment }), /comprobante/);
  await database.execute("UPDATE uploaded_files SET user_id=7,order_id=902 WHERE filename='test-receipt.png'");
  await assert.rejects(save('ack', { downpayment }), /comprobante/);
  await database.execute("UPDATE uploaded_files SET order_id=901 WHERE filename='test-receipt.png'");
  await assert.rejects(save('ack', { downpayment, nextDueDate: today }), /automáticamente/);
  await assert.rejects(save('ack', { downpayment: [{ ...downpayment[0], amount: 99 }] }), /exactamente/);
  await assert.rejects(invoke('POST', '/api/orders/901/workflow', { version: 1, task: 'quote', outcome: 'completed', notes: 'Wrong operator', evidence: 'Reference', confirmed: true }, '8'), /asignado/);
  await assert.rejects(save('quote'), /etapa/);
  const beforeConfirmation = Date.now();
  assert.equal((await save('ack', { downpayment })).status, 201);
  const [paidOrder] = await database.query<RowDataPacket[]>('SELECT status FROM orders WHERE id=901');
  assert.equal(paidOrder[0].status, 'Pagado');
  assert.deepEqual(await moneySnapshot(), moneyBefore, 'Confirmation must not collect or alter any money');
  const confirmation = (await invoke('GET', '/api/orders/901/workflow')).data.events as { downpayment: unknown; createdAt: string; actorId: number }[];
  assert.deepEqual(confirmation[0].downpayment, downpayment);
  assert.equal(confirmation[0].actorId, 7);
  assert.ok(Math.abs(Date.parse(confirmation[0].createdAt) - beforeConfirmation) < 10000, 'Database generates the confirmation date');
  await assert.rejects(save('ack', { downpayment }), /etapa/);
  await assert.rejects(invoke('POST', '/api/orders/901/workflow', { version: 1, task: 'ack', outcome: 'completed', notes: 'Stale version', evidence: 'Reference', confirmed: true }), /cambió/);
  const preparation = {
    yardNotified: true, channel: 'call', failedCall: false, failedCallNotes: '', customerConfirmed: true,
    dateFrom: today, dateTo: addWorkingDays(today, 1), balanceNotified: true, paymentMethodsNotified: true,
    corePlan: 'return_core', deliveryType: 'retiro_tienda', address: '', screenshots: [],
  };
  await assert.rejects(save('prepare'), /object/);
  assert.equal((await save('prepare', { preparation })).status, 201);
  assert.deepEqual(await moneySnapshot(), moneyBefore, 'Preparation does not collect money or receive core');
  const [readyOrder] = await database.query<RowDataPacket[]>('SELECT status,preparation_details,shipping_toggle FROM orders WHERE id=901');
  assert.equal(readyOrder[0].status, 'Listo para Retiro');
  assert.deepEqual(typeof readyOrder[0].preparation_details === 'string' ? JSON.parse(readyOrder[0].preparation_details) : readyOrder[0].preparation_details, preparation);
  assert.equal(Number(readyOrder[0].shipping_toggle), 0);
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM orders WHERE id=901 FOR UPDATE');
    await assert.rejects(enforceWorkflowUpdate(connection, rows[0], { status: 'entregado', workflowStep: 4 }), /flujo/);
    await enforceWorkflowUpdate(connection, rows[0], { status: 'listo_retiro', workflowStep: 4 });
    await assert.rejects(enforceWorkflowUpdate(connection, rows[0], { deliveryType: 'envio_domicilio' }), /modalidad/);
    await connection.commit();
  } finally { connection.release(); }
  assert.equal((await save('delivery')).status, 201);
  const [delivered] = await database.query<RowDataPacket[]>('SELECT delivered_at,warranty_started FROM orders WHERE id=901');
  assert.equal(Number(delivered[0].warranty_started), 1);
  await assert.rejects(save('post_3', { contactResult: 'sms_replied', partStatus: 'installed_ok', communication: { channel: 'sms', warrantyWarningGiven: false } }), /todavía/);
  await database.execute('UPDATE orders SET delivered_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 3 DAY) WHERE id=901');
  const [original] = await database.query<RowDataPacket[]>('SELECT delivered_at,warranty_started FROM orders WHERE id=901');
  const promisedInstallation = `${addWorkingDays(today, 1)}T18:00:00Z`;
  await assert.rejects(save('post_3', { contactResult: 'sms_replied', partStatus: 'not_installed',
    scheduledAt: promisedInstallation, communication: { channel: 'whatsapp', warrantyWarningGiven: false } }), /advertiste/);
  await assert.rejects(save('post_3', { evidence: undefined, contactResult: 'sms_replied', partStatus: 'installed_ok',
    communication: { channel: 'whatsapp', warrantyWarningGiven: false, screenshots: ['/uploads/missing.png'] } }), /imagen/);
  assert.equal((await save('post_3', { evidence: undefined, contactResult: 'sms_replied', partStatus: 'not_installed',
    scheduledAt: promisedInstallation, communication: { channel: 'whatsapp', warrantyWarningGiven: true, screenshots: ['/uploads/test-receipt.png'] } })).status, 201);
  const [firstFollowup] = await database.query<RowDataPacket[]>('SELECT contact_channel,warranty_warning_given,part_status FROM order_delivery_followups WHERE order_id=901 ORDER BY id');
  assert.equal(firstFollowup[0].contact_channel, 'whatsapp');
  assert.equal(Number(firstFollowup[0].warranty_warning_given), 1);
  const [firstEvidence] = await database.query<RowDataPacket[]>("SELECT evidence FROM order_workflow_events WHERE order_id=901 AND task='post_3'");
  assert.deepEqual(JSON.parse(firstEvidence[0].evidence).communication, { channel: 'whatsapp', warrantyWarningGiven: true, screenshots: ['/uploads/test-receipt.png'] });
  assert.equal(JSON.parse(firstEvidence[0].evidence).reference, '');
  const [currentVersion] = await database.query<RowDataPacket[]>('SELECT version FROM orders WHERE id=901');
  assert.equal((await invoke('POST', '/api/orders/901/workflow', { version: Number(currentVersion[0].version), task: 'post_7', outcome: 'no_response',
    notes: 'Actual message without reply', nextAction: 'Retry contact tomorrow', nextDueDate: addWorkingDays(today, 1),
    contactResult: 'sms_no_reply', communication: { channel: 'sms', warrantyWarningGiven: false } })).status, 201);
  const [lastFollowup] = await database.query<RowDataPacket[]>('SELECT part_status,warranty_warning_given FROM order_delivery_followups WHERE order_id=901 ORDER BY id DESC LIMIT 1');
  assert.equal(lastFollowup[0].part_status, 'not_installed');
  assert.equal(Number(lastFollowup[0].warranty_warning_given), 0);
  const [noResponseEvent] = await database.query<RowDataPacket[]>("SELECT part_status FROM order_workflow_events WHERE order_id=901 AND outcome='no_response'");
  assert.equal(noResponseEvent[0].part_status, null, 'No new piece confirmation without reply');
  const queue = await invoke('GET', '/api/orders/901/workflow');
  const tasks = queue.data.tasks as { task: string }[];
  assert.equal(tasks[0].task, 'post_7');
  const [after] = await database.query<RowDataPacket[]>('SELECT delivered_at,warranty_started FROM orders WHERE id=901');
  assert.deepEqual(after, original);
  const [counts] = await database.query<RowDataPacket[]>(`SELECT
    (SELECT COUNT(*) FROM order_workflow_events) AS events,
    (SELECT COUNT(*) FROM order_delivery_followups) AS contacts,
    (SELECT COUNT(*) FROM call_register WHERE whatsapp_dispatched=0) AS reports`);
  assert.equal(Number(counts[0].events), 5); assert.equal(Number(counts[0].contacts), 2); assert.equal(Number(counts[0].reports), 2);
  assert.equal(events.length, 5);
  await database.execute(`INSERT INTO orders (id,order_code,customer_id,user_id,product_type,price,core_fee,down_payment,status,created_at)
    VALUES (906,'ORD-PREPARATION-SMS',1,7,'Test part',900,100,200,'Cotización',UTC_TIMESTAMP())`);
  assert.equal((await invoke('POST', '/api/orders/906/workflow', {
    version: 1, task: 'ack', outcome: 'completed', downpayment: [{ method: 'cash', amount: 200, receivedBy: 'Test receiver', receipt: null }],
  })).status, 201);
  const sms = { ...preparation, channel: 'sms', failedCall: true, failedCallNotes: 'Cliente no respondió la llamada',
    deliveryType: 'envio_domicilio', address: '123 Test Street, Test City', corePlan: 'pay_core',
    screenshots: ['/uploads/first.png', '/uploads/second.png'] };
  const smsAction = { version: 2, task: 'prepare', outcome: 'completed', preparation: sms };
  await database.execute(`INSERT INTO uploaded_files (filename,original_name,content_type,size_bytes,user_id,order_id)
    VALUES ('first.png','first.png','image/png',100,7,906),('second.png','second.png','image/png',100,7,901)`);
  await assert.rejects(invoke('POST', '/api/orders/906/workflow', smsAction), /comprobante/);
  const [failedSms] = await database.query<RowDataPacket[]>('SELECT status,version,preparation_details FROM orders WHERE id=906');
  assert.equal(failedSms[0].status, 'Pagado'); assert.equal(Number(failedSms[0].version), 2); assert.equal(failedSms[0].preparation_details, null);
  await database.execute("UPDATE uploaded_files SET order_id=906 WHERE filename='second.png'");
  assert.equal((await invoke('POST', '/api/orders/906/workflow', smsAction)).status, 201);
  await assert.rejects(invoke('POST', '/api/orders/906/workflow', smsAction), /cambió/);
  const [shipped] = await database.query<RowDataPacket[]>('SELECT * FROM orders WHERE id=906');
  assert.equal(shipped[0].status, 'Listo para Despacho'); assert.equal(Number(shipped[0].shipping_toggle), 1);
  assert.equal(shipped[0].shipping_address, sms.address); assert.deepEqual(typeof shipped[0].preparation_details === 'string' ? JSON.parse(shipped[0].preparation_details) : shipped[0].preparation_details, sms);
  assert.equal(Number(shipped[0].down_payment), 200); assert.equal(Number(shipped[0].core_fee), 100);
  assert.equal(shipped[0].delivered_at, null); assert.equal(Number(shipped[0].warranty_started), 0);
  const [smsHistory] = await database.query<RowDataPacket[]>('SELECT * FROM order_workflow_events WHERE order_id=906 AND task=?', ['prepare']);
  assert.equal(smsHistory.length, 1); assert.equal(smsHistory[0].contact_result, 'sms_replied');
  const smsReload = (await invoke('GET', '/api/orders/906/workflow')).data;
  assert.deepEqual((smsReload.order as { preparation: unknown }).preparation, sms);
  for (const method of ['card', 'cashier_check']) {
    await assert.rejects(invoke('POST', '/api/orders/906/payments', { version: 3, settlement: { payments: [{ amount: 1, method, reference: 'TEST', confirmed: true }], coreAction: 'keep', coreReference: '', coreConfirmed: false } }, '7', 'admin'), /efectivo/);
  }
  console.log('PASS: workflow-only transitions; existing advance -> Paid; verified pickup/date range -> Ready; SMS after failed call requires every own-order image; delivery mode/address synchronized; duplicate and invalid evidence rollback; core/money/warranty untouched; restricted balance methods.');
  await database.execute(`INSERT INTO orders (id,order_code,customer_id,user_id,product_type,price,down_payment,status,created_at)
    VALUES (907,'ORD-HISTORICAL-DELIVERED',1,7,'Test part',100,100,'Entregado','2026-10-22 16:00:00')`);
  await database.execute(`INSERT INTO status_orders (order_id,status,created_at) VALUES
    (907,'Pagado','2026-10-25 14:12:34'),(907,'Listo para Retiro','2026-10-30 15:10:20'),
    (907,'Entregado','2026-11-01 18:35:12'),(907,'Pagado','2026-11-02 19:00:00'),(907,'Entregado','2026-11-03 20:00:00')`);
  const [historyBefore] = await database.query('SELECT * FROM status_orders WHERE order_id=907 ORDER BY id');
  const [orderBeforeHistoryRead] = await database.query('SELECT * FROM orders WHERE id=907');
  const deliveredHistory = (await invoke('GET', '/api/orders/907/workflow')).data;
  assert.deepEqual(completedWorkflowStages([], deliveredHistory.order as WorkflowOrder), ['quote', 'ack', 'prepare', 'delivery']);
  assert.deepEqual((deliveredHistory.order as WorkflowOrder).historicalDelivery, {
    paidAt: '2026-10-25T14:12:34.000Z', readyAt: '2026-10-30T15:10:20.000Z', deliveredAt: '2026-11-01T18:35:12.000Z',
  });
  assert.deepEqual(deliveredHistory.events, []);
  await database.execute("UPDATE orders SET delivered_at='2026-11-01 17:01:02' WHERE id=907");
  assert.equal(((await invoke('GET', '/api/orders/907/workflow')).data.order as WorkflowOrder).historicalDelivery?.deliveredAt, '2026-11-01T17:01:02.000Z');
  await database.execute("UPDATE orders SET delivered_at=NULL WHERE id=907");
  const [historyAfter] = await database.query('SELECT * FROM status_orders WHERE order_id=907 ORDER BY id');
  const [orderAfterHistoryRead] = await database.query('SELECT * FROM orders WHERE id=907');
  assert.deepEqual(historyAfter, historyBefore); assert.deepEqual(orderAfterHistoryRead, orderBeforeHistoryRead);
  console.log('PASS: delivered orders auto-complete all stages from original Paid/Ready/Delivered history; exact seconds and physical-date precedence; later duplicate status entries ignored; no history, money, warranty or order writes.');
  await database.execute(`INSERT INTO orders (id,order_code,customer_id,user_id,product_type,price,core_fee,down_payment,status,created_at)
    VALUES (902,'ORD-PAYMENT-LEGACY',1,7,'Test part',900,100,200,'Listo para Retiro','2026-10-01 16:00:00'),
    (903,'ORD-PAYMENT-NEW',1,7,'Test part',900,100,200,'Listo para Retiro','2026-10-21 16:00:00'),
    (904,'ORD-PAYMENT-CONCURRENT',1,7,'Test part',900,0,0,'Cotización','2026-10-21 16:00:00')`);
  const settlement = {
    payments: [{ amount: 300, method: 'cash', reference: '', confirmed: true, receivedBy: 'Test receiver', receipt: null }, { amount: 400, method: 'zelle', reference: 'TEST-REFERENCE', confirmed: true, receipt: '/uploads/collection.png' }],
    coreAction: 'received', coreReference: 'TEST-CORE-RECEIPT', coreConfirmed: true,
  };
  await database.execute(`INSERT INTO uploaded_files (filename,original_name,content_type,size_bytes,user_id,order_id)
    VALUES ('collection.png','collection.png','image/png',100,7,902)`);
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
  await database.execute("UPDATE uploaded_files SET order_id=903 WHERE filename='collection.png'");
  const managed = { version: 1, settlement, task: 'delivery', outcome: 'completed', ...delivery };
  await assert.rejects(invoke('POST', '/api/orders/903/workflow', managed, '7', 'admin'), /inventario/);
  const [rollback] = await database.query<RowDataPacket[]>(`SELECT
    (SELECT COUNT(*) FROM finance_movements WHERE order_id=903) AS payments,
    (SELECT COUNT(*) FROM order_core_receipts WHERE order_id=903) AS receipts,
    (SELECT down_payment FROM orders WHERE id=903) AS paid`);
  assert.equal(Number(rollback[0].payments), 0); assert.equal(Number(rollback[0].receipts), 0); assert.equal(Number(rollback[0].paid), 200);
  await database.execute('UPDATE orders SET inventory_part_id=NULL WHERE id=903');
  assert.equal((await invoke('POST', '/api/orders/903/workflow', managed, '7', 'admin')).status, 201);
  const partial = { version: 1, settlement: { payments: [{ amount: 10, method: 'cash', reference: '', confirmed: true, receivedBy: 'Test receiver', receipt: null }], coreAction: 'keep', coreReference: '', coreConfirmed: false } };
  const concurrent = await Promise.allSettled([invoke('POST', '/api/orders/904/payments', partial, '7', 'admin'), invoke('POST', '/api/orders/904/payments', partial, '7', 'admin')]);
  assert.equal(concurrent.filter(item => item.status === 'fulfilled').length, 1);
  const [once] = await database.query<RowDataPacket[]>('SELECT down_payment,version,delivered_at FROM orders WHERE id=904');
  assert.equal(Number(once[0].down_payment), 10); assert.equal(Number(once[0].version), 2); assert.equal(once[0].delivered_at, null);
  await database.execute(`INSERT INTO orders (id,order_code,customer_id,user_id,product_type,price,core_fee,down_payment,status,created_at)
    VALUES (908,'ORD-MODAL-COMPLETE',1,7,'Test part',900,100,200,'Cotización',UTC_TIMESTAMP()),
    (909,'ORD-MODAL-ZERO-ADVANCE',1,7,'Test part',900,0,0,'Cotización',UTC_TIMESTAMP())`);
  const modal = { version: 1, task: 'delivery', outcome: 'completed', ...delivery, settlement,
    completion: { downpayment: [{ method: 'cash', amount: 200, receivedBy: 'Test receiver', receipt: null }], preparation } };
  await assert.rejects(invoke('POST', '/api/orders/908/workflow', modal, '7', 'admin'), /comprobante/);
  await database.execute("UPDATE uploaded_files SET order_id=908 WHERE filename='collection.png'");
  await assert.rejects(invoke('POST', '/api/orders/908/workflow', { ...modal, completion: { downpayment: modal.completion.downpayment } }, '7', 'admin'), /object/);
  const [uncommitted] = await database.query<RowDataPacket[]>(`SELECT
    (SELECT COUNT(*) FROM finance_movements WHERE order_id=908) AS payments,
    (SELECT COUNT(*) FROM order_workflow_events WHERE order_id=908) AS events,
    (SELECT COUNT(*) FROM status_orders WHERE order_id=908) AS statuses,
    (SELECT COUNT(*) FROM order_core_receipts WHERE order_id=908) AS cores`);
  assert.deepEqual(Object.values(uncommitted[0]).map(Number), [0, 0, 0, 0], 'Failed completion rolls back payments, core, workflow and statuses');
  await database.execute('UPDATE orders SET inventory_part_id=999999 WHERE id=908');
  await assert.rejects(invoke('POST', '/api/orders/908/workflow', modal, '7', 'admin'), /inventario/);
  const [failedStages] = await database.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM order_workflow_events WHERE order_id=908');
  assert.equal(Number(failedStages[0].n), 0);
  await database.execute('UPDATE orders SET inventory_part_id=NULL WHERE id=908');
  const modalConcurrency = await Promise.allSettled([invoke('POST', '/api/orders/908/workflow', modal, '7', 'admin'), invoke('POST', '/api/orders/908/workflow', modal, '7', 'admin')]);
  assert.equal(modalConcurrency.filter(result => result.status === 'fulfilled').length, 1);
  const [closedModal] = await database.query<RowDataPacket[]>('SELECT * FROM orders WHERE id=908');
  assert.equal(closedModal[0].status, 'Entregado'); assert.equal(Number(closedModal[0].version), 2); assert.equal(Number(closedModal[0].workflow_step), 4);
  assert.equal(Number(closedModal[0].down_payment), 900); assert.equal(Number(closedModal[0].core_fee), 0); assert.ok(closedModal[0].delivered_at); assert.equal(Number(closedModal[0].warranty_started), 1);
  const closedFlow = (await invoke('GET', '/api/orders/908/workflow')).data;
  assert.deepEqual((closedFlow.events as { task: string }[]).map(event => event.task), ['ack', 'prepare', 'delivery']);
  assert.equal((closedFlow.tasks as { task: string }[])[0].task, 'post_3');
  const documentedPayments = (await invoke('GET', '/api/orders/908/payments')).data.payments as { amount: number; receivedBy: string | null; receipt: string | null }[];
  assert.deepEqual(documentedPayments.map(item => [item.amount, item.receivedBy, item.receipt]), [[300, 'Test receiver', null], [400, null, '/uploads/collection.png']]);
  const inPerson = { ...preparation, channel: 'in_person', dateFrom: today, dateTo: today };
  await database.execute("INSERT INTO uploaded_files (filename,original_name,content_type,size_bytes,user_id,order_id) VALUES ('piece-front.png','front.png','image/png',8,7,909),('piece-back.png','back.png','image/png',8,7,909)");
  const direct = { ...modal, notes: '', evidence: '', deliveryPhotos: ['/uploads/piece-front.png', '/uploads/piece-back.png'],
    settlement: { ...partial.settlement, payments: [{ ...partial.settlement.payments[0], amount: 900 }] }, completion: { preparation: inPerson } };
  assert.equal((await invoke('POST', '/api/orders/909/workflow', direct, '7', 'admin')).status, 201);
  const [directMoney] = await database.query<RowDataPacket[]>('SELECT COUNT(*) AS n,SUM(amount) AS amount FROM finance_movements WHERE order_id=909');
  assert.equal(Number(directMoney[0].n), 1); assert.equal(Number(directMoney[0].amount), 900);
  const [presentHistory] = await database.query<RowDataPacket[]>("SELECT contact_result,notes,preparation_details FROM order_workflow_events WHERE order_id=909 AND task='prepare'");
  assert.equal(presentHistory.length, 1); assert.equal(presentHistory[0].contact_result, null, 'No invented answered phone call');
  assert.match(presentHistory[0].notes, /cliente presente/);
  const presentFlow = (await invoke('GET', '/api/orders/909/workflow')).data;
  assert.equal((presentFlow.order as WorkflowOrder).preparation?.channel, 'in_person');
  const [deliveryRecord] = await database.query<RowDataPacket[]>("SELECT notes,evidence FROM order_workflow_events WHERE order_id=909 AND task='delivery'");
  assert.equal(deliveryRecord[0].notes, 'Recibe la pieza: Test customer');
  assert.deepEqual(JSON.parse(deliveryRecord[0].evidence), direct.deliveryPhotos);
  await database.execute(`INSERT INTO orders (id,order_code,customer_id,user_id,product_type,price,core_fee,down_payment,status,created_at)
    VALUES (910,'ORD-LEGACY-OPTIONAL-PHOTOS',1,7,'Test part',100,0,100,'Listo para Retiro','2026-10-01 16:00:00')`);
  assert.equal((await invoke('POST', '/api/orders/910/payments', { version: 1, settlement: { ...partial.settlement, payments: [] },
    delivery: { photos: [], confirmed: true } }, '7', 'admin')).status, 201);
  const [legacyRecord] = await database.query<RowDataPacket[]>("SELECT notes,evidence FROM order_workflow_events WHERE order_id=910 AND task='delivery'");
  assert.equal(legacyRecord[0].notes, 'Recibe la pieza: Test customer'); assert.equal(legacyRecord[0].evidence, '[]');
  console.log('PASS: modal closes missing confirmation/preparation/delivery in one version and transaction; cash receiver/electronic image persisted; foreign image, missing stages and inventory failure rollback ALL changes; concurrent duplicate saves collect once; no-advance confirmation reuses current payment without duplicate money; post-delivery remains active.');
  await database.execute("INSERT INTO audit_logs (user_id,action,resource_type,resource_id,details) VALUES (7,'ORDER_CREATED','order','901','{}')");
  await database.execute('UPDATE orders SET user_id=NULL WHERE id=901');
  const quotation = await invoke('GET', '/api/orders/901/workflow', {}, '7', 'admin');
  assert.equal((quotation.data.order as { quoteCreatedBy: string }).quoteCreatedBy, 'Test operator');
  const unknownCreator = await invoke('GET', '/api/orders/904/workflow', {}, '7', 'admin');
  assert.equal((unknownCreator.data.order as { quoteCreatedBy: string | null }).quoteCreatedBy, null);
  assert.equal((unknownCreator.data.tasks as { task: string }[])[0].task, 'ack');
  console.log('PASS: quotation automatically complete; audit creation actor survives reassignment, missing historical actor explicit; no manual quote mutation.');
  await database.execute(`INSERT INTO users (id,name,email,password,role,active) VALUES
    (8,'Delegated advisor','delegated@example.test','test-only','operator',1),
    (9,'Second advisor','second@example.test','test-only','operator',1),
    (10,'Inactive advisor','inactive@example.test','test-only','operator',0),
    (11,'Yard seller','yard@example.test','test-only','vendedor_yarda',1)`);
  await database.execute(`INSERT INTO orders (id,order_code,customer_id,user_id,product_type,price,down_payment,status,created_at,delivered_at,warranty_started,is_yard_sale)
    VALUES (920,'ORD-YARD-FOLLOWUP',1,11,'Test part',100,100,'Entregado',DATE_SUB(UTC_TIMESTAMP(),INTERVAL 5 DAY),DATE_SUB(UTC_TIMESTAMP(),INTERVAL 4 DAY),1,1),
    (921,'ORD-NORMAL-FOLLOWUP',1,7,'Test part',100,100,'Entregado',DATE_SUB(UTC_TIMESTAMP(),INTERVAL 5 DAY),DATE_SUB(UTC_TIMESTAMP(),INTERVAL 4 DAY),1,0),
    (922,'ORD-PREDELIVERY-DELEGATED',1,7,'Test part',100,100,'Pagado',UTC_TIMESTAMP(),NULL,0,0)`);
  const businessSnapshot = async () => {
    const [orders] = await database!.query(`SELECT id,user_id,status,price,down_payment,core_fee,created_at,delivered_at,warranty_started,warranty_days,warranty_terms
      FROM orders WHERE id IN (920,921,922) ORDER BY id`);
    const [money] = await database!.query('SELECT * FROM finance_movements WHERE order_id IN (920,921,922) ORDER BY id');
    const [history] = await database!.query('SELECT * FROM status_orders WHERE order_id IN (920,921,922) ORDER BY id');
    return { orders, money, history };
  };
  const originalBusiness = await businessSnapshot();
  const queueIds = async (actor: string, role = 'operator') =>
    ((await invoke('GET', '/api/workflow/tasks', {}, actor, role)).data.tasks as { order: WorkflowOrder }[]).map(task => task.order.id);
  assert.ok((await queueIds('7', 'admin')).includes('920'));
  assert.ok(!(await queueIds('11', 'vendedor_yarda')).includes('920'));
  assert.ok((await queueIds('7')).includes('921'));
  assert.ok(!(await queueIds('8')).includes('921'));
  assert.equal((await invoke('POST', '/api/orders/920/workflow/assignee', { version: 1, advisorId: 8 }, '8')).status, 403);
  await assert.rejects(invoke('POST', '/api/orders/920/workflow/assignee', { version: 1, advisorId: 10 }, '7', 'admin'), /activo/);
  await assert.rejects(invoke('POST', '/api/orders/920/workflow/assignee', { version: 1, advisorId: 11 }, '7', 'admin'), /activo/);
  const assignments = await Promise.allSettled([8, 9].map(advisorId =>
    invoke('POST', '/api/orders/920/workflow/assignee', { version: 1, advisorId }, '7', 'admin')));
  assert.equal(assignments.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(assignments.filter(result => result.status === 'rejected').length, 1);
  assert.equal((await invoke('POST', '/api/orders/920/workflow/assignee', { version: 2, advisorId: 8 }, '7', 'admin')).status, 200);
  assert.ok((await queueIds('8')).includes('920'));
  assert.ok(!(await queueIds('9')).includes('920'));
  assert.ok(!(await queueIds('11', 'vendedor_yarda')).includes('920'));
  const delegatedDetail = (await invoke('GET', '/api/orders/920/workflow', {}, '8')).data;
  assert.equal((delegatedDetail.order as WorkflowOrder).userId, 11);
  assert.equal((delegatedDetail.order as WorkflowOrder).followupUserId, 8);
  assert.equal((await invoke('GET', '/api/orders/920/payments', {}, '8')).status, 200);
  await assert.rejects(invoke('POST', '/api/orders/920/payments', { version: 3, settlement: { payments: [], coreAction: 'keep', coreReference: '', coreConfirmed: false } }, '8'), /operador asignado/);
  assert.equal((await invoke('POST', '/api/orders/922/workflow/assignee', { version: 1, advisorId: 8 }, '7', 'admin')).status, 200);
  assert.ok(!(await queueIds('8')).includes('922'));
  await assert.rejects(invoke('GET', '/api/orders/922/payments', {}, '8'), /operador asignado/);
  await assert.rejects(invoke('POST', '/api/orders/922/workflow', { version: 2, task: 'ack', outcome: 'completed' }, '8'), /operador asignado/);
  const postBody = { version: 3, task: 'post_3', outcome: 'completed', notes: 'Customer confirmed installation', confirmed: true,
    contactResult: 'answered', partStatus: 'installed_ok', communication: { channel: 'call', warrantyWarningGiven: false, screenshots: [] } };
  await assert.rejects(invoke('POST', '/api/orders/920/workflow', postBody, '11', 'vendedor_yarda'), /operador asignado/);
  await database.execute("INSERT INTO uploaded_files (filename,original_name,content_type,size_bytes,user_id,order_id) VALUES ('delegated.png','delegated.png','image/png',8,8,920)");
  assert.equal((await invoke('POST', '/api/orders/920/workflow', { ...postBody, contactResult: 'sms_replied',
    communication: { channel: 'whatsapp', warrantyWarningGiven: false, screenshots: ['/uploads/delegated.png'] } }, '8')).status, 201);
  const [actorHistory] = await database.query<RowDataPacket[]>('SELECT actor_id,evidence FROM order_workflow_events WHERE order_id=920');
  assert.equal(Number(actorHistory[0].actor_id), 8);
  assert.deepEqual(JSON.parse(actorHistory[0].evidence).communication.screenshots, ['/uploads/delegated.png']);
  assert.equal((await invoke('POST', '/api/orders/920/workflow/assignee', { version: 4, advisorId: 9 }, '7', 'admin')).status, 200);
  await assert.rejects(invoke('GET', '/api/orders/920/workflow', {}, '8'), /no asignada/);
  await assert.rejects(invoke('GET', '/api/orders/920/payments', {}, '8'), /operador asignado/);
  await assert.rejects(invoke('POST', '/api/orders/920/workflow', { ...postBody, version: 5, task: 'post_7' }, '8'), /operador asignado/);
  const [unchangedHistory] = await database.query('SELECT actor_id,evidence FROM order_workflow_events WHERE order_id=920');
  assert.deepEqual(unchangedHistory, actorHistory);
  assert.equal((await invoke('POST', '/api/orders/920/workflow/assignee', { version: 5, advisorId: null }, '7', 'admin')).status, 200);
  assert.ok(!(await queueIds('9')).includes('920'));
  assert.ok((await queueIds('7', 'admin')).includes('920'));
  assert.equal((await invoke('POST', '/api/orders/921/workflow/assignee', { version: 1, advisorId: 8 }, '7', 'admin')).status, 200);
  assert.ok(!(await queueIds('7')).includes('921'));
  assert.equal((await invoke('POST', '/api/orders/921/workflow/assignee', { version: 2, advisorId: null }, '7', 'admin')).status, 200);
  assert.ok((await queueIds('7')).includes('921'));
  assert.deepEqual(await businessSnapshot(), originalBusiness);
  const [auditAssignments] = await database.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM audit_logs WHERE action='ORDER_FOLLOWUP_ASSIGNED' AND resource_id IN ('920','921','922')");
  assert.equal(Number(auditAssignments[0].n), 7);
  const ddl = await createConnection({ ...options, database: schema, multipleStatements: true });
  try { await ddl.query(await readFile('migrations/029_followup_assignment.sql', 'utf8')); }
  finally { await ddl.end(); }
  assert.deepEqual(await businessSnapshot(), originalBusiness);
  console.log('PASS: real assignment queue isolation, admin-only active operator selection, concurrent version lock, delegated captures/read only after delivery, collection and commercial denial, reassignment revocation, audited reset, preserved seller/money/delivery/warranty/history and idempotent additive DDL.');
  console.log('PASS: split collection + legacy/workflow delivery, core receipt, ledger methods, inventory-failure rollback and concurrent duplicate prevention on real MariaDB.');
  console.log('PASS: all migrations + idempotent workflow DDL; authenticated transaction, concurrency, ordered evidence, delivery, preserved warranty, calendar milestones and existing contact reporting.');
} finally {
  if (database) await database.end();
  if (created) await admin.query(`DROP DATABASE \`${schema}\``);
  await admin.end();
  await applicationPool.end();
}
