import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import type { Claims } from './auth';
import { readBody, sendJson } from './http';
import { cents, fail, syncInventory, validateOrder } from './business';
import { mapOrder, statusFromDatabase, statusToDatabase, toMysqlDateTime } from './orders';
import { isBalancePaymentMethod, previewSettlement, settlementSchema, validateCollectionEvidence, type Settlement } from '../utils/orderPayments';
import { assertPaymentImages } from './paymentEvidence';
import { workflowRequired } from '../utils/orderWorkflow';
import { deliveryPhotosSchema } from '../utils/orderDelivery';

export const paymentActionSchema = z.object({
  version: z.number().int().positive(),
  settlement: settlementSchema,
  delivery: z.union([
    z.object({ photos: deliveryPhotosSchema, confirmed: z.literal(true) }).strict(),
    z.object({ notes: z.string().trim().min(5).max(5000), evidence: z.string().trim().min(5).max(5000), confirmed: z.literal(true) }).strict(),
  ]).optional(),
}).strict();
export const settlementOrderFromRow = (row: RowDataPacket) => ({
  price: Number(row.price || 0), shipping: Number(row.shipping_cost || 0), core: Number(row.core_fee || 0),
  paid: Number(row.down_payment || 0), coreReceived: Boolean(row.core_received_at),
  delivered: Boolean(row.delivered_at || row.delivery_log_at),
});
export function enforceCollectionUpdate(row: RowDataPacket, next: { status?: string; financials?: { downPayment?: number; coreFee?: number } }) {
  if (row.delivered_at && next.financials && cents(next.financials.coreFee) !== cents(row.core_fee)) {
    fail(409, 'El core de una orden entregada se gestiona desde Devolución del core.');
  }
  if (next.financials && cents(next.financials.downPayment) !== cents(row.down_payment)) {
    fail(409, 'Usa Registrar cobro para agregar pagos; las devoluciones se registran desde Reembolsos.');
  }
  if (row.core_received_at && cents(next.financials?.coreFee) !== 0) fail(409, 'El core ya fue recibido; no puedes volver a cobrarlo.');
  if (next.status === 'entregado' && statusFromDatabase(row.status) !== 'entregado') fail(409, 'Registra el cobro y la entrega desde el formulario de entrega.');
}
export function assertPaymentAccess(row: RowDataPacket, claims: Claims, allowFollowup = false) {
  const assignedFollowup = allowFollowup && (row.delivered_at || row.delivery_log_at) && Number(row.followup_user_id) === Number(claims.sub);
  if (claims.role !== 'admin' && Number(row.user_id) !== Number(claims.sub) && !assignedFollowup) fail(403, 'Solo el operador asignado o administración puede consultar esta orden.');
}
async function assertUnrefundedSale(connection: PoolConnection, row: RowDataPacket) {
  if (row.delivered_at) return;
  const [refunds] = await connection.query<RowDataPacket[]>(
    "SELECT id FROM refund_requests WHERE order_id=? AND status='completed' AND COALESCE(refund_scope,'purchase')='purchase' LIMIT 1", [row.id]);
  if (refunds.length) fail(409, 'Esta venta tiene dinero devuelto; registra una nueva orden para no reutilizar cobros reembolsados al cobrar o entregar.');
}
export async function applyOrderSettlement(connection: PoolConnection, row: RowDataPacket, input: Settlement, claims: Claims) {
  if (row.delivered_at && input.coreAction === 'received') fail(409, 'Registra la devolución del depósito desde Devolución del core; no elimines un cargo ya cobrado.');
  if (row.preparation_details && input.payments.some(payment => !isBalancePaymentMethod(payment.method))) {
    fail(409, 'El saldo después de Preparación y cita se paga únicamente en efectivo, Cash App o Zelle.');
  }
  let summary: ReturnType<typeof previewSettlement>;
  try { summary = previewSettlement(settlementOrderFromRow(row), input); }
  catch (error) { return fail(409, error instanceof Error ? error.message : 'Liquidación inválida'); }
  const effectiveCoreFee = input.coreAction === 'charge' && input.coreAmount !== undefined && input.coreAmount !== null
    ? input.coreAmount
    : input.coreAction === 'none'
      ? 0
      : Number(row.core_fee || 0);
  const changes = input.payments.length > 0 || input.coreAction === 'received' || (input.coreAction === 'charge' && effectiveCoreFee !== Number(row.core_fee || 0)) || (input.coreAction === 'none' && Number(row.core_fee || 0) > 0);
  if (changes) await assertUnrefundedSale(connection, row);
  if (changes && claims.role !== 'admin') fail(403, 'Solo administración puede registrar cobros o recibir el core.');
  try { validateCollectionEvidence(input); }
  catch (error) { fail(409, error instanceof Error ? error.message : 'Revisa los comprobantes de pago.'); }
  await assertPaymentImages(connection, row.id, input.payments.flatMap(payment => payment.receipt ? [payment.receipt] : []), claims);
  if (changes && ['cancelado', 'reembolsado', 'archivado', 'reclamo', 'solicitud_reembolso'].includes(statusFromDatabase(row.status))) {
    fail(409, 'Gestiona la incidencia o reactiva la orden antes de registrar cobros.');
  }
  if (input.coreAction === 'received') {
    await connection.execute('INSERT INTO order_core_receipts (order_id,amount,reference,actor_id) VALUES (?,?,?,?)',
      [row.id, summary.coreCredit, input.coreReference, Number(claims.sub)]);
    await connection.execute('UPDATE orders SET core_fee=0,core_received_at=UTC_TIMESTAMP(),core_received_amount=? WHERE id=?', [summary.coreCredit, row.id]);
  } else if (input.coreAction === 'charge' && effectiveCoreFee !== Number(row.core_fee || 0)) {
    await connection.execute('UPDATE orders SET core_fee=? WHERE id=?', [effectiveCoreFee, row.id]);
  } else if (input.coreAction === 'none' && Number(row.core_fee || 0) > 0) {
    await connection.execute('UPDATE orders SET core_fee=0 WHERE id=?', [row.id]);
  }
  for (const payment of input.payments) {
    await connection.execute(
      `INSERT INTO finance_movements (order_id,kind,amount,effective_at,source,reference_key,user_id,payment_method,payment_reference,payment_receipt,payment_received_by)
       VALUES (?,'payment',?,UTC_TIMESTAMP(),'order_collection',?,?,?,?,?,?)`,
      [row.id, payment.amount, `collection-${crypto.randomUUID()}`, Number(claims.sub), payment.method, payment.reference || null, payment.receipt || null, payment.method === 'cash' ? payment.receivedBy : null],
    );
  }
  if (input.payments.length) await connection.execute('UPDATE orders SET down_payment=? WHERE id=?', [summary.paid, row.id]);
  const newCoreFee = input.coreAction === 'received' || input.coreAction === 'none' ? 0 : effectiveCoreFee;
  return { ...row, down_payment: summary.paid, core_fee: newCoreFee } as RowDataPacket;
}
export async function completeOrderDelivery(connection: PoolConnection, row: RowDataPacket, claims: Claims, description: string) {
  await assertUnrefundedSale(connection, row);
  const payload = { ...mapOrder(row), status: 'entregado' as const, deliveredAt: row.delivered_at ? new Date(row.delivered_at).toISOString() : new Date().toISOString() };
  validateOrder(payload, row, claims.role || '');
  await syncInventory(connection, Number(row.id), row.inventory_part_id, 'entregado');
  await connection.execute('UPDATE orders SET status=?,delivered_at=?,warranty_started=1,auction_search_active=0 WHERE id=?',
    [statusToDatabase.entregado, toMysqlDateTime(payload.deliveredAt), row.id]);
  if (!row.delivered_at) {
    await connection.execute('UPDATE orders SET warranty_terms=?,core_deposit_amount=? WHERE id=?',
      [JSON.stringify({ startedAt: payload.deliveredAt, days: Number(row.warranty_days ?? 60),
        policy: 'calendar' }), Number(row.core_fee || 0), row.id]);
  }
  await connection.execute('INSERT INTO status_orders (order_id,status,description,user_id) VALUES (?,?,?,?)',
    [row.id, statusToDatabase.entregado, description, Number(claims.sub)]);
}
export async function handlePaymentRequest(
  request: IncomingMessage, response: ServerResponse, pathname: string, claims: Claims, database: Pool,
  broadcast: (type: string, payload: Record<string, unknown>) => void,
) {
  const match = pathname.match(/^\/api\/orders\/(\d+)\/payments$/);
  if (!match) return false;
  if (!['GET', 'POST'].includes(request.method || '')) { sendJson(response, 405, { message: 'Método no permitido' }); return true; }
  const action = request.method === 'POST' ? paymentActionSchema.parse(await readBody(request)) : null;
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT o.*,
      (SELECT MIN(created_at) FROM status_orders WHERE order_id=o.id AND LOWER(TRIM(status))='entregado') AS delivery_log_at,
      (SELECT advisor_id FROM order_followup_assignments WHERE order_id=o.id) AS followup_user_id
      FROM orders o WHERE o.id=? AND o.deleted_at IS NULL FOR UPDATE`, [match[1]]);
    if (!rows[0]) fail(404, 'Orden no encontrada');
    const row = rows[0];
    assertPaymentAccess(row, claims, !action);
    if (!action) {
      const [payments] = await connection.query<RowDataPacket[]>(`SELECT m.*,u.name AS actor FROM finance_movements m
        LEFT JOIN users u ON u.id=m.user_id WHERE m.order_id=? AND m.kind='payment' ORDER BY m.id`, [row.id]);
      const [receipts] = await connection.query<RowDataPacket[]>(`SELECT r.*,u.name AS actor FROM order_core_receipts r LEFT JOIN users u ON u.id=r.actor_id WHERE r.order_id=?`, [row.id]);
      await connection.commit();
      let prepPlan: 'return_core' | 'pay_core' | null = null;
      if (row.preparation_details) {
        try {
          const parsed = typeof row.preparation_details === 'string' ? JSON.parse(row.preparation_details) : row.preparation_details;
          prepPlan = parsed?.corePlan || null;
        } catch { /* ignore */ }
      }
      sendJson(response, 200, {
        version: Number(row.version), order: settlementOrderFromRow(row), canRecord: claims.role === 'admin', remainingMethodsOnly: Boolean(row.preparation_details),
        preparationPlan: prepPlan,
        payments: payments.map(item => ({ id: String(item.id), amount: Number(item.amount), method: item.payment_method || null, reference: item.payment_reference || null, receipt: item.payment_receipt || null, receivedBy: item.payment_received_by || null, date: item.effective_at ? new Date(item.effective_at).toISOString() : null, actor: item.actor || null })),
        coreReceipt: receipts[0] ? { amount: Number(receipts[0].amount), reference: receipts[0].reference, actor: receipts[0].actor, date: new Date(receipts[0].created_at).toISOString() } : null,
      });
      return true;
    }
    if (Number(row.version) !== action.version) fail(409, 'La orden cambió; recarga antes de registrar el cobro.');
    const hasCoreModification = action.settlement.coreAction === 'received' || (action.settlement.coreAction === 'charge' && (action.settlement.coreAmount !== undefined ? action.settlement.coreAmount !== Number(row.core_fee || 0) : true)) || (action.settlement.coreAction === 'none' && Number(row.core_fee || 0) > 0);
    if (!action.delivery && !action.settlement.payments.length && !hasCoreModification) fail(400, 'Agrega un cobro o registra la gestión del core.');
    if (action.delivery && workflowRequired(new Date(row.created_at).toISOString())) fail(409, 'Completa la entrega desde el flujo verificable.');
    if (action.delivery && row.delivered_at) fail(409, 'La entrega ya está registrada.');
    if (action.delivery && action.settlement.payments.some(payment => !isBalancePaymentMethod(payment.method))) {
      fail(409, 'El saldo de entrega se paga únicamente en efectivo, Cash App o Zelle.');
    }
    const settled = await applyOrderSettlement(connection, row, action.settlement, claims);
    if (action.delivery) {
      if ('photos' in action.delivery) {
        await assertPaymentImages(connection, row.id, action.delivery.photos, claims);
        const [customers] = await connection.query<RowDataPacket[]>('SELECT first_name,last_name FROM customers WHERE id=?', [row.customer_id]);
        const name = customers[0] && [customers[0].first_name, customers[0].last_name].filter(Boolean).join(' ').trim();
        if (!name) fail(409, 'La orden requiere el nombre del cliente para registrar la entrega.');
        const notes = `Recibe la pieza: ${name}`;
        await completeOrderDelivery(connection, settled, claims, notes);
        const [actors] = await connection.query<RowDataPacket[]>('SELECT name FROM users WHERE id=?', [Number(claims.sub)]);
        if (!actors[0]) fail(403, 'Operador autenticado no encontrado');
        await connection.execute(`INSERT INTO order_workflow_events (order_id,task,outcome,actor_id,actor_name,notes,evidence)
          VALUES (?,'delivery','completed',?,?,?,?)`,
        [row.id, Number(claims.sub), actors[0].name, notes, JSON.stringify(action.delivery.photos)]);
      } else await completeOrderDelivery(connection, settled, claims, `${action.delivery.notes} · Evidencia: ${action.delivery.evidence}`);
    }
    await connection.execute('UPDATE orders SET version=version+1 WHERE id=?', [row.id]);
    await connection.execute(
      "INSERT INTO audit_logs (user_id,username,action,resource_type,resource_id,details) VALUES (?,?,'ORDER_COLLECTION_RECORDED','order',?,?)",
      [Number(claims.sub), claims.sub, row.id, JSON.stringify(action)],
    );
    await connection.commit();
    broadcast('order:updated', { orderId: Number(row.id), action: 'COLLECTION_RECORDED', timestamp: Date.now() });
    sendJson(response, 201, { ok: true, version: action.version + 1 });
    return true;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
