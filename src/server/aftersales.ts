import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import type { Claims } from './auth';
import { readBody, sendJson } from './http';
import { beginIdempotentRequest, cents, fail, finishIdempotentRequest } from './business';
import { assertPaymentAccess } from './orderPayments';
import { mapOrder, statusFromDatabase, warrantyFromRow } from './orders';
import { assertUploadedOrderFiles } from './paymentEvidence';
import { aftersalesActionSchema, coreDeadline, refundExecutionSchema, validateRefundBudget, warrantyDeadline,
  warrantyTermsSchema, type AftersalesAction, type RefundExecution } from '../utils/aftersales';
import { getOrderWarrantyInfo } from '../utils/orderWarranty';
import { workflowDate } from '../utils/orderWorkflow';

const envelope = z.object({ version: z.number().int().positive(), idempotencyKey: z.string().uuid(), data: aftersalesActionSchema }).strict();
export const parseStoredJson = (value: unknown): unknown => typeof value === 'string' ? JSON.parse(value) : value;
const iso = (value: string | Date) => new Date(value).toISOString();
export { warrantyFromRow } from './orders';
export async function assertAftersalesFiles(connection: PoolConnection, orderId: number, files: string[], claims: Claims) {
  await assertUploadedOrderFiles(connection, orderId, files, claims, true);
}
async function refundTotals(connection: PoolConnection, orderId: number, excludeId = 0) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(IF(status='completed',amount,0)),0) AS completed,
      COALESCE(SUM(IF(status='pending',amount,0)),0) AS reserved
      FROM refund_requests WHERE order_id=? AND id<>?`, [orderId, excludeId]);
  return { completed: Number(rows[0].completed), reserved: Number(rows[0].reserved) };
}
function coreAmount(row: RowDataPacket, refunded: number) {
  if (row.core_deposit_amount !== null && row.core_deposit_amount !== undefined) return Number(row.core_deposit_amount);
  if (refunded > 0) return null;
  if (!(row.delivered_at || row.delivery_log_at) || cents(row.down_payment) < cents(row.price) + cents(row.shipping_cost) + cents(row.core_fee)) return null;
  return Number(row.core_fee || 0);
}
async function setStatus(connection: PoolConnection, row: RowDataPacket, status: string, claims: Claims, description: string) {
  if (row.status === status) return;
  await connection.execute('UPDATE orders SET status=? WHERE id=?', [status, row.id]);
  await connection.execute('INSERT INTO status_orders (order_id,status,description,user_id) VALUES (?,?,?,?)',
    [row.id, status, description, Number(claims.sub)]);
  row.status = status;
}
async function recordRefund(connection: PoolConnection, row: RowDataPacket, id: number, amount: number, execution: RefundExecution, claims: Claims) {
  const totals = await refundTotals(connection, row.id, id);
  const error = validateRefundBudget(Number(row.down_payment), totals.completed, totals.reserved, amount);
  if (error) fail(409, error);
  if ('receipt' in execution) await assertAftersalesFiles(connection, row.id, [execution.receipt], claims);
  await connection.execute(
    `INSERT INTO finance_movements (order_id,kind,amount,effective_at,source,reference_key,user_id,payment_method,payment_receipt,payment_received_by)
     VALUES (?,'refund',?,UTC_TIMESTAMP(),'refund',?,?,?,?,?)`,
    [row.id, amount, `refund-${id}`, Number(claims.sub), execution.method,
      'receipt' in execution ? execution.receipt : null, 'recipient' in execution ? execution.recipient : null]);
  await connection.execute(
    "UPDATE refund_requests SET status='completed',review_stage='completed',execution=?,payment_method=?,payment_contact=?,completed_at=UTC_TIMESTAMP(),completed_by=? WHERE id=?",
    [JSON.stringify(execution), execution.method === 'cash' ? 'Efectivo' : execution.method === 'square' ? 'Tarjeta (Square)' : execution.method,
      'recipient' in execution ? execution.recipient : `${execution.reference}${execution.method === 'square' ? ` · ****${execution.last4}` : ''}`,
      Number(claims.sub), id]);
}
export async function applyAftersalesAction(connection: PoolConnection, row: RowDataPacket, data: AftersalesAction, claims: Claims, now = new Date()) {
  const admin = claims.role === 'admin';
  const delivered = row.delivered_at || row.delivery_log_at;
  const terms = warrantyFromRow(row);
  const date = workflowDate(now);
  const files = 'files' in data ? data.files : data.action === 'invoice' ? [data.file] : [];
  await assertAftersalesFiles(connection, row.id, files, claims);
  const [actors] = await connection.query<RowDataPacket[]>('SELECT name FROM users WHERE id=?', [Number(claims.sub)]);
  if (!actors[0]) fail(403, 'Operador no encontrado');
  const name = actors[0].name;
  if (['refund_update', 'core_refund', 'core_receive', 'warranty_correct'].includes(data.action) && !admin) fail(403, 'Solo administración puede corregir cobertura, recibir el core o autorizar y registrar devoluciones.');
  if (data.action === 'warranty_correct') {
    if (!terms || !delivered) fail(409, 'Falta una entrega verificable para corregir la cobertura.');
    await connection.execute('UPDATE orders SET warranty_days=?,warranty_terms=? WHERE id=?', [data.days, JSON.stringify({ ...terms, days: data.days }), row.id]);
  }
  if (data.action === 'invoice') {
    if (!delivered) fail(409, 'El invoice solo se adjunta después de una entrega verificable.');
    await connection.execute('INSERT INTO order_invoices (order_id,file_url,actor_id,actor_name) VALUES (?,?,?,?)',
      [row.id, data.file, Number(claims.sub), name]);
  }
  if (data.action === 'claim_create') {
    if (!delivered || !terms) fail(409, 'Falta una entrega verificable para validar la garantía.');
    const warranty = getOrderWarrantyInfo({ deliveredAt: iso(delivered), warrantyStarted: true, warrantyTerms: terms }, now.getTime());
    if (warranty.status === 'expired') fail(409, 'No se puede registrar un reclamo: la garantía expiró.');
    if (['reclamo', 'solicitud_reembolso', 'reembolsado', 'cancelado', 'archivado'].includes(statusFromDatabase(row.status))) fail(409, 'La orden ya tiene una incidencia o está cerrada.');
    if (data.nextDate < date) fail(400, 'La próxima revisión no puede estar en el pasado.');
    const [open] = await connection.query<RowDataPacket[]>("SELECT id FROM claims WHERE order_id=? AND status IN ('Pending','In Process') AND deleted_at IS NULL", [row.id]);
    if (open.length) fail(409, 'Ya existe un reclamo abierto.');
    if (data.assignedUserId) {
      const [users] = await connection.query<RowDataPacket[]>("SELECT id FROM users WHERE id=? AND role IN ('admin','operator')", [data.assignedUserId]);
      if (!users.length) fail(400, 'Selecciona un responsable de administración o call center.');
    }
    await connection.execute(
      `INSERT INTO claims (order_id,description,status,assigned_user_id,previous_order_status,stage,evidence_files,warranty_snapshot,next_review_date)
       VALUES (?,?,'Pending',?,?,'registered',?,?,?)`,
      [row.id, data.notes, data.assignedUserId || Number(claims.sub), row.status, JSON.stringify(files), JSON.stringify(terms), data.nextDate]);
    await setStatus(connection, row, 'Reclamo', claims, 'Reclamo registrado dentro de garantía');
  }
  if (data.action === 'claim_update') {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM claims WHERE id=? AND order_id=? AND deleted_at IS NULL FOR UPDATE', [data.id, row.id]);
    const claim = rows[0];
    if (!claim || ['Resolved', 'Denied'].includes(claim.status)) fail(409, 'El reclamo no existe o ya fue cerrado.');
    if (!admin && Number(claim.assigned_user_id) !== Number(claims.sub)) fail(403, 'Solo el responsable o administración puede gestionar el reclamo.');
    const closing = ['resolved', 'denied', 'replacement'].includes(data.stage);
    const currentStage = claim.stage || 'registered';
    if (data.stage === 'resolution' && currentStage !== 'review' ||
      closing && !['resolution', 'review'].includes(currentStage)) fail(409, 'Registra primero la revisión del reclamo.');
    if (data.stage === 'replacement' && currentStage !== 'resolution') fail(409, 'Registra la resolución antes de entregar el reemplazo.');
    if (closing && !data.notified) fail(400, 'Confirma que notificaste la resolución al cliente.');
    if (data.stage === 'denied' && !admin) fail(403, 'Solo administración puede rechazar un reclamo.');
    if (!closing && (!data.nextDate || data.nextDate < date)) fail(400, 'Indica la próxima fecha de revisión.');
    if (closing && statusFromDatabase(row.status) !== 'reclamo') fail(409, 'Resuelve primero la solicitud de reembolso activa.');
    if (data.stage === 'replacement') {
      if (!admin || !data.replacementStock || !data.confirmed) fail(400, 'Administración debe identificar la pieza de reemplazo y confirmar su entrega física.');
      const snapshot = claim.warranty_snapshot ? warrantyTermsSchema.parse(parseStoredJson(claim.warranty_snapshot)) : terms;
      if (!snapshot) fail(409, 'La duración de garantía original requiere revisión.');
      await connection.execute('UPDATE orders SET warranty_terms=? WHERE id=?', [
        JSON.stringify({ startedAt: now.toISOString(), days: snapshot.days, policy: 'calendar' }), row.id]);
    }
    const status = data.stage === 'denied' ? 'Denied' : closing ? 'Resolved' : 'In Process';
    await connection.execute(
      'UPDATE claims SET status=?,stage=?,resolution_notes=?,resolved_by=?,resolved_at=?,next_review_date=? WHERE id=?',
      [status, data.stage, data.notes, closing ? Number(claims.sub) : null, closing ? now : null, closing ? null : data.nextDate, data.id]);
    if (closing) {
      let targetStatus = claim.previous_order_status;
      if (!targetStatus) {
        const [prevRows] = await connection.query<RowDataPacket[]>(
          "SELECT status FROM status_orders WHERE order_id=? AND LOWER(status) NOT IN ('reclamo','solicitud_reembolso','solicitud de reembolso') ORDER BY id DESC LIMIT 1",
          [row.id]
        );
        targetStatus = prevRows[0]?.status || (row.delivered_at || row.delivery_log_at ? 'Entregado' : 'Pagado');
        await connection.execute('UPDATE claims SET previous_order_status=? WHERE id=?', [targetStatus, claim.id]);
      }
      await setStatus(connection, row, targetStatus, claims, `Reclamo ${data.id}: ${data.notes}`);
    }
  }
  if (data.action === 'refund_create') {
    if (['reembolsado', 'archivado'].includes(statusFromDatabase(row.status))) fail(409, 'La orden no permite nuevas devoluciones.');
    let claimId = data.claimId || null;
    if (statusFromDatabase(row.status) === 'reclamo' || claimId) {
      const [open] = await connection.query<RowDataPacket[]>("SELECT id FROM claims WHERE order_id=? AND status IN ('Pending','In Process') AND deleted_at IS NULL", [row.id]);
      if (!open[0] || claimId && Number(open[0].id) !== claimId) fail(409, 'Selecciona el reclamo abierto de esta orden.');
      claimId = Number(open[0].id);
    }
    const [pending] = await connection.query<RowDataPacket[]>("SELECT id FROM refund_requests WHERE order_id=? AND status='pending' AND COALESCE(refund_scope,'purchase')='purchase'", [row.id]);
    if (pending.length) fail(409, 'Ya existe una solicitud de reembolso de compra pendiente.');
    const totals = await refundTotals(connection, row.id);
    const error = validateRefundBudget(Number(row.down_payment), totals.completed, totals.reserved, data.amount);
    if (error) fail(409, error);
    await connection.execute(
      `INSERT INTO refund_requests (order_id,amount,amount_type,payment_method,reason,status,requested_by,previous_order_status,review_stage,refund_scope,claim_id,piece_required,evidence_files)
       VALUES (?,?,'custom','Por definir',?,'pending',?,?,'requested','purchase',?,?,?)`,
      [row.id, data.amount, data.notes, Number(claims.sub), row.status, claimId, data.pieceRequired, JSON.stringify(files)]);
    await setStatus(connection, row, 'Solicitud Reembolso', claims, data.notes);
  }
  if (data.action === 'refund_update') {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM refund_requests WHERE id=? AND order_id=? FOR UPDATE', [data.id, row.id]);
    const refund = rows[0];
    if (!refund || refund.status !== 'pending' || refund.refund_scope === 'core') fail(409, 'La solicitud no está pendiente o corresponde al core.');
    const previousStage = refund.review_stage || 'requested';
    if (data.stage === 'review' && previousStage !== 'requested' ||
      data.stage === 'approved' && previousStage !== 'review' ||
      data.stage === 'completed' && previousStage !== 'approved') fail(409, 'Completa revisión y aprobación antes de registrar la devolución.');
    if (data.stage === 'completed') {
      if (!data.execution) fail(400, 'Registra cómo se devolvió el dinero y su soporte.');
      if (refund.piece_required && !refund.piece_received_at && !data.pieceReceived) fail(409, 'Confirma la recepción física de la pieza.');
      await recordRefund(connection, row, data.id, Number(refund.amount), data.execution, claims);
      if (data.pieceReceived) await connection.execute('UPDATE refund_requests SET piece_received_at=UTC_TIMESTAMP() WHERE id=?', [data.id]);
    } else {
      await connection.execute('UPDATE refund_requests SET review_stage=?,status=? WHERE id=?',
        [data.stage, data.stage === 'rejected' ? 'cancelled' : 'pending', data.id]);
    }
    if (['completed', 'rejected'].includes(data.stage)) {
      let prevStatus = refund.previous_order_status;
      if (!prevStatus) {
        const [prevRows] = await connection.query<RowDataPacket[]>(
          "SELECT status FROM status_orders WHERE order_id=? AND LOWER(status) NOT IN ('reclamo','solicitud_reembolso','solicitud de reembolso') ORDER BY id DESC LIMIT 1",
          [row.id]
        );
        prevStatus = prevRows[0]?.status || (row.delivered_at || row.delivery_log_at ? 'Entregado' : 'Pagado');
        await connection.execute('UPDATE refund_requests SET previous_order_status=? WHERE id=?', [prevStatus, refund.id]);
      }
      const totals = await refundTotals(connection, row.id);
      const fullyRefunded = cents(totals.completed) >= cents(row.down_payment);
      if (data.stage === 'completed' && fullyRefunded && refund.claim_id) {
        await connection.execute("UPDATE claims SET status='Resolved',stage='refunded',resolution_notes=?,resolved_at=UTC_TIMESTAMP(),resolved_by=? WHERE id=?",
          [data.notes, Number(claims.sub), refund.claim_id]);
      }
      await setStatus(connection, row, data.stage === 'completed' && fullyRefunded ? 'Reembolsado' : prevStatus, claims, data.notes);
    }
  }
  if (data.action === 'core_receive') {
    const totals = await refundTotals(connection, row.id);
    const amount = coreAmount(row, totals.completed);
    const deadline = coreDeadline(delivered);
    if (row.core_returned_at || row.core_received_at) fail(409, 'El core ya fue recibido.');
    if (!deadline || amount === null) fail(409, 'La fecha o el depósito histórico requieren revisión; no se puede asumir un importe.');
    if (amount <= 0) fail(409, 'No existe un depósito de core cobrado para devolver.');
    if (date > deadline) fail(409, 'El plazo de 15 días para devolver el core venció.');
    await connection.execute('UPDATE orders SET core_returned_at=UTC_TIMESTAMP(),core_deposit_amount=? WHERE id=?', [amount, row.id]);
  }
  if (data.action === 'core_refund') {
    if (!row.core_returned_at) fail(409, 'Registra primero la recepción del core dentro del plazo.');
    const totals = await refundTotals(connection, row.id);
    const amount = coreAmount(row, totals.completed);
    if (amount === null || amount <= 0) fail(409, 'No hay un depósito verificable que devolver.');
    const [existing] = await connection.query<RowDataPacket[]>("SELECT id FROM refund_requests WHERE order_id=? AND refund_scope='core' AND status IN ('pending','completed')", [row.id]);
    if (existing.length) fail(409, 'La devolución del core ya fue registrada.');
    const [insert] = await connection.execute<ResultSetHeader>(
      `INSERT INTO refund_requests (order_id,amount,amount_type,payment_method,reason,status,requested_by,previous_order_status,review_stage,refund_scope)
       VALUES (?,?,'custom',?,'Devolución del depósito del core','pending',?,?,'approved','core')`,
      [row.id, amount, data.execution.method, Number(claims.sub), row.status]);
    await recordRefund(connection, row, insert.insertId, amount, data.execution, claims);
  }
  const notes = 'notes' in data ? data.notes : data.action === 'invoice' ? 'Invoice PDF adjunto; se conserva el historial de versiones.' : 'Depósito de core devuelto.';
  await connection.execute('INSERT INTO order_aftersales_history (order_id,action,notes,details,actor_id,actor_name) VALUES (?,?,?,?,?,?)',
    [row.id, data.action, notes, JSON.stringify(data.action === 'warranty_correct' ? { ...data, previousWarranty: terms } : data), Number(claims.sub), name]);
  await connection.execute("INSERT INTO audit_logs (user_id,action,resource_type,resource_id,details) VALUES (?,'ORDER_AFTERSALES','order',?,?)",
    [Number(claims.sub), String(row.id), JSON.stringify(data)]);
}
export async function handleAftersalesRequest(request: IncomingMessage, response: ServerResponse, pathname: string, claims: Claims, database: Pool,
  broadcast: (type: string, payload: Record<string, unknown>) => void) {
  const id = pathname.match(/^\/api\/orders\/(\d+)\/aftersales$/)?.[1];
  if (!id) return false;
  if (!['GET', 'POST'].includes(request.method || '')) { sendJson(response, 405, { message: 'Método no permitido' }); return true; }
  const body = request.method === 'POST' ? envelope.parse(await readBody(request)) : null;
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT o.*,(SELECT advisor_id FROM order_followup_assignments WHERE order_id=o.id) AS followup_user_id,
      (SELECT MIN(created_at) FROM status_orders WHERE order_id=o.id AND LOWER(status)='entregado') AS delivery_log_at
      FROM orders o WHERE o.id=? AND o.deleted_at IS NULL FOR UPDATE`, [id]);
    const row = rows[0];
    if (!row) fail(404, 'Orden no encontrada');
    assertPaymentAccess(row, claims, true);
    if (body) {
      if (!['admin', 'operator', 'vendedor_yarda'].includes(claims.role || '')) fail(403, 'No tienes permiso para esta operación.');
      if (claims.role === 'vendedor_yarda' && body.data.action !== 'invoice') fail(403, 'Solo administración y call center gestionan incidencias.');
      const replay = await beginIdempotentRequest(connection, 'aftersales', body.idempotencyKey, Number(claims.sub), { ...body, orderId: Number(id) });
      if (!replay) {
        if (body.version !== Number(row.version)) fail(409, 'La orden cambió. Actualiza antes de guardar.');
        await applyAftersalesAction(connection, row, body.data, claims);
        await connection.execute('UPDATE orders SET version=version+1 WHERE id=?', [id]);
        await finishIdempotentRequest(connection, 'aftersales', body.idempotencyKey, Number(id));
      }
      await connection.commit();
      if (!replay) broadcast('order:updated', { orderId: Number(id), action: 'AFTERSALES_UPDATED', timestamp: Date.now() });
      sendJson(response, 200, { ok: true });
    } else {
      const [invoices] = await connection.query<RowDataPacket[]>('SELECT * FROM order_invoices WHERE order_id=? ORDER BY id DESC', [id]);
      const [claimsRows] = await connection.query<RowDataPacket[]>('SELECT * FROM claims WHERE order_id=? AND deleted_at IS NULL ORDER BY id DESC', [id]);
      const [refunds] = await connection.query<RowDataPacket[]>('SELECT * FROM refund_requests WHERE order_id=? ORDER BY id DESC', [id]);
      const [history] = await connection.query<RowDataPacket[]>('SELECT * FROM order_aftersales_history WHERE order_id=? ORDER BY id DESC', [id]);
      const totals = await refundTotals(connection, Number(id));
      const terms = warrantyFromRow(row);
      const warranty = getOrderWarrantyInfo(mapOrder(row));
      const core = coreAmount(row, totals.completed);
      await connection.commit();
      sendJson(response, 200, { version: Number(row.version), canManage: ['admin', 'operator'].includes(claims.role || ''), canAdmin: claims.role === 'admin',
        warranty: { ...warranty, terms, deadline: terms ? warrantyDeadline(terms) : null },
        core: { amount: core || 0, deadline: coreDeadline(row.delivered_at || row.delivery_log_at), receivedAt: row.core_returned_at,
          refund: refunds.filter(value => value.refund_scope === 'core' && value.status === 'completed').map(value => ({
            ...value, execution: value.execution ? refundExecutionSchema.parse(parseStoredJson(value.execution)) : null }))[0] || null, reviewRequired: core === null },
        invoices, claims: claimsRows.map(value => ({ ...value, evidence_files: parseStoredJson(value.evidence_files) || [],
          warranty_snapshot: parseStoredJson(value.warranty_snapshot) || null })),
        refunds: refunds.map(value => ({ ...value, amount: Number(value.amount), execution: value.execution ? refundExecutionSchema.parse(parseStoredJson(value.execution)) : null })),
        history: history.map(value => ({ ...value, details: parseStoredJson(value.details) })),
        paid: Number(row.down_payment), refunded: totals.completed, reserved: totals.reserved });
    }
    return true;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
