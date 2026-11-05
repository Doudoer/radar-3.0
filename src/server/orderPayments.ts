import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import type { Claims } from './auth';
import { readBody, sendJson } from './http';
import { cents, fail, syncInventory, validateOrder } from './business';
import { mapOrder, statusFromDatabase, statusToDatabase, toMysqlDateTime } from './orders';
import { previewSettlement, settlementSchema, type Settlement } from '../utils/orderPayments';
import { workflowRequired } from '../utils/orderWorkflow';

export const paymentActionSchema = z.object({
  version: z.number().int().positive(),
  settlement: settlementSchema,
  delivery: z.object({ notes: z.string().trim().min(5).max(5000), evidence: z.string().trim().min(5).max(5000), confirmed: z.literal(true) }).strict().optional(),
}).strict();
export const settlementOrderFromRow = (row: RowDataPacket) => ({
  price: Number(row.price || 0), shipping: Number(row.shipping_cost || 0), core: Number(row.core_fee || 0),
  paid: Number(row.down_payment || 0), coreReceived: Boolean(row.core_received_at),
});
export function enforceCollectionUpdate(row: RowDataPacket, next: { status?: string; financials?: { downPayment?: number; coreFee?: number } }) {
  if (next.financials && cents(next.financials.downPayment) !== cents(row.down_payment)) {
    fail(409, 'Usa Registrar cobro para agregar pagos; las devoluciones se registran desde Reembolsos.');
  }
  if (row.core_received_at && cents(next.financials?.coreFee) !== 0) fail(409, 'El core ya fue recibido; no puedes volver a cobrarlo.');
  if (next.status === 'entregado' && statusFromDatabase(row.status) !== 'entregado') fail(409, 'Registra el cobro y la entrega desde el formulario de entrega.');
}
export function assertPaymentAccess(row: RowDataPacket, claims: Claims) {
  if (claims.role !== 'admin' && Number(row.user_id) !== Number(claims.sub)) fail(403, 'Solo el operador asignado o administración puede consultar esta orden.');
}
export async function applyOrderSettlement(connection: PoolConnection, row: RowDataPacket, input: Settlement, claims: Claims) {
  const changes = input.payments.length > 0 || input.coreAction === 'received';
  if (changes && claims.role !== 'admin') fail(403, 'Solo administración puede registrar cobros o recibir el core.');
  if (changes && ['cancelado', 'reembolsado', 'archivado', 'reclamo', 'solicitud_reembolso'].includes(statusFromDatabase(row.status))) {
    fail(409, 'Gestiona la incidencia o reactiva la orden antes de registrar cobros.');
  }
  let summary: ReturnType<typeof previewSettlement>;
  try { summary = previewSettlement(settlementOrderFromRow(row), input); }
  catch (error) { return fail(409, error instanceof Error ? error.message : 'Liquidación inválida'); }
  if (input.coreAction === 'received') {
    await connection.execute('INSERT INTO order_core_receipts (order_id,amount,reference,actor_id) VALUES (?,?,?,?)',
      [row.id, summary.coreCredit, input.coreReference, Number(claims.sub)]);
    await connection.execute('UPDATE orders SET core_fee=0,core_received_at=UTC_TIMESTAMP(),core_received_amount=? WHERE id=?', [summary.coreCredit, row.id]);
  }
  for (const payment of input.payments) {
    await connection.execute(
      `INSERT INTO finance_movements (order_id,kind,amount,effective_at,source,reference_key,user_id,payment_method,payment_reference)
       VALUES (?,'payment',?,UTC_TIMESTAMP(),'order_collection',?,?,?,?)`,
      [row.id, payment.amount, `collection-${crypto.randomUUID()}`, Number(claims.sub), payment.method, payment.reference || null],
    );
  }
  if (input.payments.length) await connection.execute('UPDATE orders SET down_payment=? WHERE id=?', [summary.paid, row.id]);
  return { ...row, down_payment: summary.paid, core_fee: input.coreAction === 'received' ? 0 : row.core_fee } as RowDataPacket;
}
export async function completeOrderDelivery(connection: PoolConnection, row: RowDataPacket, claims: Claims, description: string) {
  const payload = { ...mapOrder(row), status: 'entregado' as const, deliveredAt: row.delivered_at ? new Date(row.delivered_at).toISOString() : new Date().toISOString() };
  validateOrder(payload, row, claims.role || '');
  await syncInventory(connection, Number(row.id), row.inventory_part_id, 'entregado');
  await connection.execute('UPDATE orders SET status=?,delivered_at=?,warranty_started=1 WHERE id=?',
    [statusToDatabase.entregado, toMysqlDateTime(payload.deliveredAt), row.id]);
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
    const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM orders WHERE id=? AND deleted_at IS NULL FOR UPDATE', [match[1]]);
    if (!rows[0]) fail(404, 'Orden no encontrada');
    const row = rows[0];
    assertPaymentAccess(row, claims);
    if (!action) {
      const [payments] = await connection.query<RowDataPacket[]>(`SELECT m.*,u.name AS actor FROM finance_movements m
        LEFT JOIN users u ON u.id=m.user_id WHERE m.order_id=? AND m.kind='payment' ORDER BY m.id`, [row.id]);
      const [receipts] = await connection.query<RowDataPacket[]>(`SELECT r.*,u.name AS actor FROM order_core_receipts r LEFT JOIN users u ON u.id=r.actor_id WHERE r.order_id=?`, [row.id]);
      await connection.commit();
      sendJson(response, 200, {
        version: Number(row.version), order: settlementOrderFromRow(row), canRecord: claims.role === 'admin',
        payments: payments.map(item => ({ id: String(item.id), amount: Number(item.amount), method: item.payment_method || null, reference: item.payment_reference || null, date: item.effective_at ? new Date(item.effective_at).toISOString() : null, actor: item.actor || null })),
        coreReceipt: receipts[0] ? { amount: Number(receipts[0].amount), reference: receipts[0].reference, actor: receipts[0].actor, date: new Date(receipts[0].created_at).toISOString() } : null,
      });
      return true;
    }
    if (Number(row.version) !== action.version) fail(409, 'La orden cambió; recarga antes de registrar el cobro.');
    if (!action.delivery && !action.settlement.payments.length && action.settlement.coreAction === 'keep') fail(400, 'Agrega un cobro o registra la recepción del core.');
    if (action.delivery && workflowRequired(new Date(row.created_at).toISOString())) fail(409, 'Completa la entrega desde el flujo verificable.');
    if (action.delivery && row.delivered_at) fail(409, 'La entrega ya está registrada.');
    const settled = await applyOrderSettlement(connection, row, action.settlement, claims);
    if (action.delivery) await completeOrderDelivery(connection, settled, claims, `${action.delivery.notes} · Evidencia: ${action.delivery.evidence}`);
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
