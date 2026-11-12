import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import type { Claims } from './auth';
import type { OrderStatus } from '../types';
import { ORDER_STATUS_LABELS } from '../utils/orderStatusRules';
import { requireRole } from './auth';
import { readBody, sendJson } from './http';
import { fail } from './business';
import { statusFromDatabase, statusToDatabase, toMysqlDateTime, warrantyFromRow } from './orders';
import { isBalancePaymentMethod, settlementSchema } from '../utils/orderPayments';
import { applyOrderSettlement, completeOrderDelivery } from './orderPayments';
import { downpaymentSchema } from '../utils/downpaymentConfirmation';
import { preparationSchema } from '../utils/orderPreparation';
import { deliveryPhotosSchema } from '../utils/orderDelivery';
import { assertPaymentImages } from './paymentEvidence';
import { communicationSchema } from '../utils/followupCommunication';
import { wasender } from '../integrations/wasender/client';
import {
  addWorkingDays, completedWorkflowStages, validateWorkflowAction, workflowDate, workflowRequired, workflowTasks, workflowTaskAssignee,
  type WorkflowAction, type WorkflowEvent, type WorkflowOrder, type WorkflowTask, type WorkflowTaskKey,
} from '../utils/orderWorkflow';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Fecha inválida');
export const workflowActionSchema = z.object({
  version: z.number().int().positive(),
  task: z.enum(['quote', 'ack', 'prepare', 'delivery', 'post_3', 'post_7', 'post_14', 'incident']),
  outcome: z.enum(['completed', 'no_response', 'blocked', 'incident']),
  notes: z.string().trim().max(5000).default(''),
  evidence: z.string().trim().max(5000).optional(),
  deliveryPhotos: deliveryPhotosSchema.optional(),
  confirmed: z.boolean().optional(),
  nextDueDate: dateSchema.optional().nullable(),
  nextAction: z.string().trim().max(1000).optional().nullable(),
  blockedBy: z.string().trim().max(200).optional().nullable(),
  scheduledAt: z.string().datetime({ offset: true }).optional().nullable(),
  contactResult: z.enum(['answered', 'no_answer', 'busy', 'wrong_number', 'sms_sent', 'sms_replied', 'sms_no_reply']).optional().nullable(),
  communication: communicationSchema.optional(),
  partStatus: z.enum(['not_installed', 'in_process', 'installed_ok', 'has_issues', 'defect_claim']).optional().nullable(),
  settlement: settlementSchema.optional(),
  downpayment: downpaymentSchema.optional(),
  preparation: preparationSchema.optional(),
  completion: z.object({ downpayment: downpaymentSchema.optional(), preparation: preparationSchema.optional() }).strict().optional(),
  exemptDownpayment: z.boolean().optional(),
}).strict().refine(value => value.communication === undefined || value.task.startsWith('post_'),
  'La comunicación post-entrega solo corresponde a sus hitos.')
  .refine(value => value.deliveryPhotos === undefined || value.task === 'delivery' && value.outcome === 'completed',
  'Las imágenes de entrega solo corresponden a una entrega completada.')
  .refine(value => !value.settlement || value.task === 'delivery' && value.outcome === 'completed',
  'Los cobros solo se adjuntan a una entrega confirmada.')
  .refine(value => !value.downpayment || value.task === 'ack' && value.outcome === 'completed',
    'Los datos del downpayment solo corresponden a Confirmación.')
  .refine(value => !value.exemptDownpayment || value.task === 'ack' && value.outcome === 'completed',
    'La exoneración del downpayment solo corresponde a Confirmación.')
  .refine(value => !value.preparation || value.task === 'prepare' && value.outcome === 'completed',
    'Los datos de preparación solo corresponden a Preparación y cita completada.')
  .refine(value => !value.completion || value.task === 'delivery' && value.outcome === 'completed' && Boolean(value.settlement) && !value.downpayment && !value.preparation,
    'Completar el flujo desde cobros requiere una entrega física con liquidación verificada.');

const isOrderStatus = (value: string): value is OrderStatus => Object.hasOwn(ORDER_STATUS_LABELS, value);
const incidentDateSql = `CASE WHEN o.status IN ('Reclamo','reclamo') THEN
  (SELECT MAX(c.created_at) FROM claims c WHERE c.order_id=o.id AND c.deleted_at IS NULL)
  WHEN o.status IN ('Solicitud Reembolso','Solicitud de Reembolso','solicitud_reembolso') THEN
  (SELECT MAX(r.created_at) FROM refund_requests r WHERE r.order_id=o.id AND r.status='pending') END AS incident_created_at,
  (SELECT MIN(c.next_review_date) FROM claims c WHERE c.order_id=o.id AND c.deleted_at IS NULL
    AND c.status IN ('Pending','In Process')) AS incident_next_due_date,
  (SELECT c.assigned_user_id FROM claims c WHERE c.order_id=o.id AND c.deleted_at IS NULL
    AND c.status IN ('Pending','In Process') ORDER BY c.id DESC LIMIT 1) AS incident_assigned_user_id,
  (SELECT cu.name FROM claims c LEFT JOIN users cu ON cu.id=c.assigned_user_id WHERE c.order_id=o.id AND c.deleted_at IS NULL
    AND c.status IN ('Pending','In Process') ORDER BY c.id DESC LIMIT 1) AS incident_assigned_advisor`;
const quoteCreatorSql = `(SELECT COALESCE(a.username, creator.name) FROM audit_logs a
  LEFT JOIN users creator ON creator.id=a.user_id
  WHERE a.resource_type='order' AND a.resource_id=CAST(o.id AS CHAR) AND a.action='ORDER_CREATED'
  ORDER BY a.id LIMIT 1) AS quote_created_by`;
const confirmationPolicySql = `(SELECT r.confirmation_policy FROM order_confirmation_rollout r WHERE r.order_id=o.id) AS confirmation_policy,
  (SELECT r.confirmation_policy_at FROM order_confirmation_rollout r WHERE r.order_id=o.id) AS confirmation_policy_at`;
const POST_DELIVERY_FOLLOWUP_CUTOFF_SQL = '2026-11-07 20:05:52';
const deliveredHistoryDateSql = `(SELECT MIN(s.created_at) FROM status_orders s WHERE s.order_id=o.id AND LOWER(TRIM(s.status))='entregado')`;
const deliveryHistorySql = `${deliveredHistoryDateSql} AS delivery_log_at,
  CASE WHEN LOWER(TRIM(o.status))='entregado' AND COALESCE(o.delivered_at,${deliveredHistoryDateSql},o.created_at)<='${POST_DELIVERY_FOLLOWUP_CUTOFF_SQL}' THEN 1 ELSE 0 END AS post_delivery_finalized,
  (SELECT MIN(s.created_at) FROM status_orders s WHERE s.order_id=o.id AND LOWER(TRIM(s.status))='pagado'
    AND s.created_at<=COALESCE(o.delivered_at,${deliveredHistoryDateSql},'9999-12-31')) AS historical_paid_at,
  (SELECT MIN(s.created_at) FROM status_orders s WHERE s.order_id=o.id
    AND LOWER(TRIM(s.status)) IN ('listo para retiro','listo para despacho','listo para entrega')
    AND s.created_at<=COALESCE(o.delivered_at,${deliveredHistoryDateSql},'9999-12-31')) AS historical_ready_at`;
export const workflowOrderFromRow = (row: RowDataPacket): WorkflowOrder => {
  const status = statusFromDatabase(row.status);
  const deliveredAt = row.delivered_at || row.delivery_log_at;
  const timestamp = (value: string | Date | null | undefined) => value ? new Date(value).toISOString() : null;
  const confirmationPolicy = row.confirmation_policy ?? 'documented';
  if (!['documented', 'legacy', 'preapproved'].includes(confirmationPolicy)) return fail(409, 'Política de confirmación desconocida.');
  if (isOrderStatus(status)) return {
  id: String(row.id), code: row.order_code, userId: row.user_id ? Number(row.user_id) : null,
  isYardSale: Boolean(row.is_yard_sale || row.advisor_role === 'vendedor_yarda'),
  followupUserId: row.followup_user_id ? Number(row.followup_user_id) : null,
  followupAdvisor: row.followup_advisor || null,
  customerName: [row.first_name, row.last_name].filter(Boolean).join(' ').trim(),
  customerLanguage: (row.customer_language || row.customer_crm_language) === 'en' ? 'en' : 'es',
  warrantyTerms: warrantyFromRow(row),
  advisor: row.advisor || 'Sin asignar', version: Number(row.version),
  createdAt: new Date(row.created_at).toISOString(), status,
  deliveredAt: timestamp(deliveredAt),
  postDeliveryFinalized: status === 'entregado' && Boolean(row.post_delivery_finalized),
  historicalDelivery: status === 'entregado' ? {
    paidAt: timestamp(row.historical_paid_at), readyAt: timestamp(row.historical_ready_at), deliveredAt: timestamp(deliveredAt),
  } : null,
  scheduledPickupAt: row.scheduled_pickup_at ? new Date(row.scheduled_pickup_at).toISOString() : null,
  total: Number(row.price || 0) + Number(row.core_fee || 0) + Number(row.shipping_cost || 0),
  paid: Number(row.down_payment || 0),
  core: Number(row.core_fee || 0),
  quoteCreatedBy: row.quote_created_by || null,
  confirmationPolicy,
  confirmationPolicyAt: row.confirmation_policy_at ? new Date(row.confirmation_policy_at).toISOString() : null,
  preparation: row.preparation_details ? preparationSchema.parse(typeof row.preparation_details === 'string' ? JSON.parse(row.preparation_details) : row.preparation_details) : null,
  yardPieceReady: Boolean(row.yard_piece_ready),
  yardPieceReadyAt: timestamp(row.yard_piece_ready_at),
  downpaymentVerified: Boolean(row.downpayment_verified),
  downpaymentVerifiedAt: timestamp(row.downpayment_verified_at),
  incidentCreatedAt: row.incident_created_at ? new Date(row.incident_created_at).toISOString() : null,
  incidentNextDueDate: row.incident_next_due_date ? new Date(row.incident_next_due_date).toISOString().slice(0, 10) : null,
  incidentAssignedUserId: row.incident_assigned_user_id ? Number(row.incident_assigned_user_id) : null,
  incidentAssignedAdvisor: row.incident_assigned_advisor || null,
  };
  return fail(409, 'La orden contiene un estado desconocido; corrígelo antes de gestionar el flujo.');
};
export const workflowEventFromRow = (row: RowDataPacket): WorkflowEvent => ({
  id: String(row.id), task: row.task, outcome: row.outcome, notes: row.notes, evidence: row.evidence,
  actorId: Number(row.actor_id), actorName: row.actor_name, createdAt: new Date(row.created_at).toISOString(),
  nextDueDate: row.next_due_date ? new Date(row.next_due_date).toISOString().slice(0, 10) : null,
  nextAction: row.next_action, blockedBy: row.blocked_by,
  scheduledAt: row.scheduled_at ? new Date(row.scheduled_at).toISOString() : null,
  contactResult: row.contact_result, partStatus: row.part_status,
  taskDueDate: row.task_due_date ? new Date(row.task_due_date).toISOString().slice(0, 10) : null,
  downpayment: (() => {
    if (!row.downpayment_details) return null;
    try {
      const parsed = downpaymentSchema.safeParse(typeof row.downpayment_details === 'string' ? JSON.parse(row.downpayment_details) : row.downpayment_details);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  })(),
  preparation: row.preparation_details ? preparationSchema.parse(typeof row.preparation_details === 'string' ? JSON.parse(row.preparation_details) : row.preparation_details) : null,
});
export async function loadWorkflowEvents(connection: Pool | PoolConnection, orderId: string | number) {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM order_workflow_events WHERE order_id=? ORDER BY id', [orderId]);
  return rows.map(workflowEventFromRow);
}
export function assertWorkflowAssignee(order: WorkflowOrder, claims: Claims, task?: WorkflowTaskKey) {
  const userId = task ? workflowTaskAssignee(order, task).userId : order.userId;
  if (claims.role !== 'admin' && userId !== Number(claims.sub)) fail(403, 'Solo el operador asignado o administración puede gestionar el flujo.');
}
export async function recordWorkflowReopening(connection: PoolConnection, previous: RowDataPacket, nextStatus: string, claims: Claims) {
  if (!workflowRequired(new Date(previous.created_at).toISOString())) return;
  const oldStatus = statusFromDatabase(previous.status);
  const closed = ['cancelado', 'archivado', 'reembolsado'].includes(oldStatus);
  const stages = { cotizacion: 0, espera_confirmacion: 0, pagado: 1, en_preparacion: 2, listo_despacho: 3, listo_retiro: 3, en_camino: 3, entregado: 4,
    en_diagnostico: 0, pendiente_aprobacion: 0, listo_pago: 1, facturado: 1, en_reparacion: 2, detenido_pieza: 2, en_proceso: 2 };
  const oldIndex = stages[oldStatus as keyof typeof stages];
  const nextIndex = stages[nextStatus as keyof typeof stages];
  const resolvedIntoPreparation = ['reclamo', 'solicitud_reembolso'].includes(oldStatus) && nextIndex !== undefined && nextIndex < 4;
  if (!(closed && nextIndex !== undefined || resolvedIntoPreparation || nextIndex !== undefined && oldIndex !== undefined && nextIndex < oldIndex)) return;
  const stage = closed || nextIndex <= 1 ? 'ack' : 'prepare';
  const [actors] = await connection.query<RowDataPacket[]>('SELECT name FROM users WHERE id=?', [Number(claims.sub)]);
  if (!actors[0]) fail(403, 'Operador autenticado no encontrado');
  const nextDueDate = addWorkingDays(workflowDate(new Date()), 1);
  await connection.execute(
    `INSERT INTO order_workflow_events (order_id,task,outcome,actor_id,actor_name,notes,evidence,next_due_date,next_action)
     VALUES (?,?,'reopened',?,?,?,'',?,?)`,
    [previous.id, stage, Number(claims.sub), actors[0].name, `Flujo reabierto por cambio de estado: ${oldStatus} → ${nextStatus}`, nextDueDate, 'Verificar nuevamente la etapa reabierta. Se conserva la entrega y garantía originales.'],
  );
}
export async function enforceWorkflowUpdate(connection: PoolConnection, previous: RowDataPacket, next: {
  status?: string; workflowStep?: number; deliveryType?: string; customer?: { shippingAddress?: string | null }; scheduledPickupAt?: string | null;
}, _claims?: Claims) {
  if (next.status && next.status !== statusFromDatabase(previous.status)) fail(409, 'El estado solo cambia desde el flujo verificable o las vistas propias de incidencias; no se permiten cambios manuales.');
  if (previous.preparation_details && (
    next.deliveryType !== undefined && next.deliveryType !== (previous.shipping_toggle ? 'envio_domicilio' : 'retiro_tienda') ||
    next.customer?.shippingAddress !== undefined && (next.customer.shippingAddress || '') !== (previous.shipping_address || '') ||
    next.scheduledPickupAt !== undefined && toMysqlDateTime(next.scheduledPickupAt) !== toMysqlDateTime(previous.scheduled_pickup_at)
  )) fail(409, 'La modalidad, dirección y cita verificadas solo se cambian al reabrir Preparación y cita desde el flujo.');
  if (!workflowRequired(new Date(previous.created_at).toISOString())) return;
  if (next.workflowStep !== undefined && next.workflowStep !== Number(previous.workflow_step || 1)) {
    fail(409, 'Completa las etapas desde el flujo verificable; no se puede editar su número.');
  }
}

export async function performYardImagesCleanup(
  connection: PoolConnection,
  orderId: number,
  yardCompatibilityRaw: unknown,
  orderCode: string,
  claims: Claims
): Promise<number> {
  let compat: any = null;
  try {
    compat = typeof yardCompatibilityRaw === 'string'
      ? JSON.parse(yardCompatibilityRaw)
      : yardCompatibilityRaw;
  } catch {
    compat = null;
  }

  const images: string[] = Array.isArray(compat?.referenceImages)
    ? compat.referenceImages.filter((img: unknown): img is string => typeof img === 'string')
    : [];

  if (!images.length) return 0;

  const deletedFiles: string[] = [];
  const uploadDir = path.resolve(process.cwd(), 'uploads');

  for (const imgUrl of images) {
    const filename = path.basename(imgUrl);
    if (/^[a-zA-Z0-9._-]+$/.test(filename) && !filename.includes('..')) {
      const filePath = path.join(uploadDir, filename);
      try {
        if (existsSync(filePath)) {
          await fs.unlink(filePath);
          deletedFiles.push(filename);
        }
      } catch (err) {
        console.warn(`[YardCleanup] No se pudo borrar archivo físico ${filename}:`, err);
      }
      try {
        await connection.execute('DELETE FROM uploaded_files WHERE filename=? AND order_id=?', [filename, orderId]);
      } catch (err) {
        console.warn(`[YardCleanup] Error borrando fila uploaded_files ${filename}:`, err);
      }
    }
  }

  const updatedCompat = {
    ...compat,
    referenceImages: [],
    cleanedAt: new Date().toISOString(),
    cleanedBy: claims.username || claims.sub || 'system',
  };

  await connection.execute(
    'UPDATE orders SET yard_compatibility=?, version=version+1 WHERE id=?',
    [JSON.stringify(updatedCompat), orderId]
  );

  await connection.execute(
    "INSERT INTO audit_logs (user_id,username,action,resource_type,resource_id,details) VALUES (?,?,'YARD_REFERENCE_IMAGES_CLEANED','order',?,?)",
    [
      Number(claims.sub || 0),
      String(claims.username || claims.sub || 'system'),
      String(orderId),
      JSON.stringify({
        orderCode,
        deletedFilesCount: deletedFiles.length,
        deletedFiles,
      }),
    ]
  );

  return deletedFiles.length;
}

export async function handleWorkflowRequest(
  request: IncomingMessage, response: ServerResponse, pathname: string, claims: Claims, database: Pool,
  broadcast: (type: string, payload: Record<string, unknown>) => void,
): Promise<boolean> {
  const match = pathname.match(/^\/api\/orders\/(\d+)\/workflow$/);
  const assignment = pathname.match(/^\/api\/orders\/(\d+)\/workflow\/assignee$/);
  const yardReady = pathname.match(/^\/api\/orders\/(\d+)\/yard-ready$/);
  const yardUnavailable = pathname.match(/^\/api\/orders\/(\d+)\/yard-unavailable$/);
  const verifyDownpayment = pathname.match(/^\/api\/orders\/(\d+)\/verify-downpayment$/);
  const exemptDownpayment = pathname.match(/^\/api\/orders\/(\d+)\/exempt-downpayment$/);
  const yardCompatibility = pathname.match(/^\/api\/orders\/([a-zA-Z0-9_-]+)\/yard-compatibility$/);
  const queue = pathname === '/api/workflow/tasks';
  if (!match && !queue && !assignment && !yardReady && !yardUnavailable && !verifyDownpayment && !exemptDownpayment && !yardCompatibility) return false;
  if (!requireRole(response, claims, 'admin', 'operator', 'vendedor_yarda')) return true;

  if (yardCompatibility) {
    if (!requireRole(response, claims, 'admin')) return true;
    if (request.method !== 'PUT' && request.method !== 'POST') {
      sendJson(response, 405, { message: 'Método no permitido' });
      return true;
    }
    const orderId = yardCompatibility[1];
    let parsed: any = {};
    try {
      parsed = (await readBody(request, 10 * 1024 * 1024)) || {};
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Cuerpo de solicitud JSON inválido';
      sendJson(response, 400, { message });
      return true;
    }

    const compatibilityList = typeof parsed.compatibilityList === 'string' ? parsed.compatibilityList.trim() : '';
    const compatibleVehicles = Array.isArray(parsed.compatibleVehicles) ? parsed.compatibleVehicles : undefined;
    const referenceImages = Array.isArray(parsed.referenceImages)
      ? parsed.referenceImages.filter((img: unknown): img is string => typeof img === 'string')
      : [];

    const connection = await database.getConnection();
    try {
      await connection.beginTransaction();
      const [orders] = await connection.query<RowDataPacket[]>(
        'SELECT id,version,order_code FROM orders WHERE (id=? OR order_code=?) AND deleted_at IS NULL FOR UPDATE',
        [orderId, orderId]
      );
      if (!orders[0]) {
        await connection.rollback();
        sendJson(response, 404, { message: 'Orden no encontrada' });
        return true;
      }

      const realOrderId = Number(orders[0].id);
      const yardCompatData = {
        compatibilityList,
        compatibleVehicles,
        referenceImages,
        updatedAt: new Date().toISOString(),
        updatedBy: claims.username || claims.sub,
      };

      await connection.execute(
        'UPDATE orders SET yard_compatibility=?, version=version+1 WHERE id=?',
        [JSON.stringify(yardCompatData), realOrderId]
      );

      await connection.execute(
        "INSERT INTO audit_logs (user_id,username,action,resource_type,resource_id,details) VALUES (?,?,'YARD_COMPATIBILITY_UPDATED','order',?,?)",
        [Number(claims.sub), String(claims.sub), String(realOrderId), JSON.stringify({ orderCode: orders[0].order_code, yardCompatData })]
      );

      await connection.commit();
      broadcast('order:updated', {
        orderId: realOrderId,
        action: 'YARD_COMPATIBILITY_UPDATED',
        yardCompatibility: yardCompatData,
        timestamp: Date.now(),
      });
      sendJson(response, 200, { ok: true, yardCompatibility: yardCompatData });
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  if (yardReady) {
    if (!requireRole(response, claims, 'admin', 'vendedor_yarda')) return true;
    if (request.method !== 'POST') { sendJson(response, 405, { message: 'Método no permitido' }); return true; }
    const orderId = yardReady[1];
    const connection = await database.getConnection();
    try {
      await connection.beginTransaction();
      const [orders] = await connection.query<RowDataPacket[]>(
        'SELECT id,version,order_code,yard_piece_ready,preparation_details,workflow_step,yard_compatibility FROM orders WHERE id=? AND deleted_at IS NULL FOR UPDATE',
        [orderId]
      );
      if (!orders[0]) fail(404, 'Orden no encontrada');
      const orderRow = orders[0];
      await connection.execute('UPDATE orders SET yard_piece_ready=1,yard_piece_ready_at=CURRENT_TIMESTAMP,yard_piece_ready_by=?,version=version+1 WHERE id=?',
        [Number(claims.sub), orderId]);
      await connection.execute("INSERT INTO audit_logs (user_id,username,action,resource_type,resource_id,details) VALUES (?,?,'YARD_PIECE_READY','order',?,?)",
        [Number(claims.sub), String(claims.sub), String(orderId), JSON.stringify({ orderCode: orderRow.order_code })]);

      // If the customer was already contacted and order is ready for delivery, clean up images immediately
      const isDeliveryReady = Boolean(orderRow.preparation_details) || Number(orderRow.workflow_step) >= 3;
      let cleanedCount = 0;
      if (isDeliveryReady) {
        cleanedCount = await performYardImagesCleanup(connection, Number(orderId), orderRow.yard_compatibility, orderRow.order_code, claims);
      }

      await connection.commit();
      broadcast('order:updated', {
        orderId: Number(orderId),
        action: 'YARD_PIECE_READY',
        yardPieceReady: true,
        cleanedReferenceImages: cleanedCount,
        timestamp: Date.now()
      });
      sendJson(response, 200, { ok: true, yardPieceReady: true, cleanedImagesCount: cleanedCount });
      return true;
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }

  if (yardUnavailable) {
    if (!requireRole(response, claims, 'admin', 'vendedor_yarda')) return true;
    if (request.method !== 'POST') { sendJson(response, 405, { message: 'Método no permitido' }); return true; }
    const orderId = yardUnavailable[1];
    let parsed: any = {};
    try {
      parsed = (await readBody(request, 64 * 1024)) || {};
    } catch {
      parsed = {};
    }
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim()
      ? parsed.reason.trim()
      : 'Pieza no encontrada o no disponible en patio físico';

    const connection = await database.getConnection();
    try {
      await connection.beginTransaction();
      const [orders] = await connection.query<RowDataPacket[]>(
        'SELECT id,version,order_code,advisor,user_id,workflow_data,status FROM orders WHERE id=? AND deleted_at IS NULL FOR UPDATE',
        [orderId]
      );
      if (!orders[0]) fail(404, 'Orden no encontrada');
      const orderRow = orders[0];

      let workflowData: Record<string, unknown> = {};
      try {
        workflowData = typeof orderRow.workflow_data === 'string'
          ? JSON.parse(orderRow.workflow_data || '{}')
          : (orderRow.workflow_data || {});
      } catch {
        workflowData = {};
      }

      const nowIso = new Date().toISOString();
      workflowData.yardPieceUnavailable = true;
      workflowData.yardPieceUnavailableAt = nowIso;
      workflowData.yardPieceUnavailableBy = Number(claims.sub);
      workflowData.yardPieceUnavailableReason = reason;

      // Update order: activate auction search, mark piece not ready in yard, save workflow_data
      await connection.execute(
        'UPDATE orders SET auction_search_active=1, yard_piece_ready=0, workflow_data=?, version=version+1 WHERE id=?',
        [JSON.stringify(workflowData), orderId]
      );

      // Record in status_orders timeline
      await connection.execute(
        'INSERT INTO status_orders (order_id,status,description,user_id) VALUES (?,?,?,?)',
        [
          orderId,
          orderRow.status || 'Pagado',
          `⚠️ Pieza NO disponible en patio reportada por Yarda. Búsqueda en subasta activada. Se requiere contactar al cliente para extensión de tiempo o definir cancelación/reembolso. Motivo: ${reason}`,
          Number(claims.sub)
        ]
      );

      // Record in audit_logs
      await connection.execute(
        "INSERT INTO audit_logs (user_id,username,action,resource_type,resource_id,details) VALUES (?,?,'YARD_PIECE_UNAVAILABLE','order',?,?)",
        [
          Number(claims.sub),
          String(claims.sub),
          String(orderId),
          JSON.stringify({
            orderCode: orderRow.order_code,
            reason,
            auctionActive: true,
            yardPieceUnavailable: true
          })
        ]
      );

      // Send alert notification to Admin and Advisor
      const alertMsg = `⚠️ ALERTA PATIO - PIEZA NO DISPONIBLE\nOrden: ${orderRow.order_code}\nMotivo: ${reason}\n\nSe activó la búsqueda en subasta Copart/IAAI.\nAsesor y Administrador deben contactar al cliente para:\n1. Solicitar extensión de tiempo de entrega.\n2. Evaluar cancelación de orden o reembolso.`;

      // 1. Queue to BUSQUEDA_SUBASTAS channel (superadmin & multicast)
      try {
        const { queueSystemNotification } = await import('../integrations/wasender/notificationService');
        await queueSystemNotification(connection, 'BUSQUEDA_SUBASTAS', alertMsg, {
          creatorUserId: orderRow.user_id,
          orderStatus: String(orderRow.status || 'pagado'),
        });
      } catch (e) {
        console.warn('[YardUnavailable] Could not queue channel notification:', e);
      }

      // 2. Also locate advisor's phone and queue direct notification if advisor has phone
      try {
        if (orderRow.user_id || orderRow.advisor) {
          const res = await connection.query<RowDataPacket[]>(
            'SELECT phone, name FROM users WHERE id=? OR name=? LIMIT 1',
            [orderRow.user_id || 0, orderRow.advisor || '']
          );
          const advisorRows = Array.isArray(res) ? res[0] : [];
          if (Array.isArray(advisorRows) && advisorRows[0]?.phone) {
            await connection.execute('INSERT INTO notification_outbox (payload) VALUES (?)', [
              JSON.stringify({ phone: advisorRows[0].phone, text: alertMsg })
            ]);
          }
        }
      } catch (e) {
        console.warn('[YardUnavailable] Could not queue advisor direct notification:', e);
      }

      await connection.commit();

      broadcast('order:updated', {
        orderId: Number(orderId),
        action: 'YARD_PIECE_UNAVAILABLE',
        auctionActive: true,
        yardPieceUnavailable: true,
        yardPieceUnavailableReason: reason,
        yardPieceUnavailableAt: nowIso,
        timestamp: Date.now()
      });

      sendJson(response, 200, {
        ok: true,
        auctionActive: true,
        yardPieceUnavailable: true,
        reason,
      });
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  if (verifyDownpayment) {
    if (!requireRole(response, claims, 'admin')) return true;
    if (request.method !== 'POST') { sendJson(response, 405, { message: 'Método no permitido' }); return true; }
    const orderId = verifyDownpayment[1];
    const connection = await database.getConnection();
    try {
      await connection.beginTransaction();
      const [orders] = await connection.query<RowDataPacket[]>('SELECT id,version,order_code,status FROM orders WHERE id=? AND deleted_at IS NULL FOR UPDATE', [orderId]);
      if (!orders[0]) fail(404, 'Orden no encontrada');
      await connection.execute("UPDATE orders SET downpayment_verified=1,downpayment_verified_at=CURRENT_TIMESTAMP,downpayment_verified_by=?,status='Pagado',version=version+1 WHERE id=?",
        [Number(claims.sub), orderId]);
      await connection.execute('INSERT INTO status_orders (order_id,status,description,user_id) VALUES (?,?,?,?)',
        [orderId, 'Pagado', 'Anticipo verificado en banco por el Administrador', Number(claims.sub)]);
      await connection.execute("INSERT INTO audit_logs (user_id,username,action,resource_type,resource_id,details) VALUES (?,?,'DOWNPAYMENT_VERIFIED','order',?,?)",
        [Number(claims.sub), String(claims.sub), String(orderId), JSON.stringify({ orderCode: orders[0].order_code })]);
      await connection.commit();
      broadcast('order:updated', { orderId: Number(orderId), action: 'DOWNPAYMENT_VERIFIED', status: 'pagado', downpaymentVerified: true, timestamp: Date.now() });
      sendJson(response, 200, { ok: true, status: 'pagado', downpaymentVerified: true });
      return true;
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }

  if (exemptDownpayment) {
    if (!requireRole(response, claims, 'admin')) return true;
    if (request.method !== 'POST') { sendJson(response, 405, { message: 'Método no permitido' }); return true; }
    const orderId = exemptDownpayment[1];
    let parsedBody: any = {};
    try {
      parsedBody = (await readBody(request, 1024 * 1024)) || {};
    } catch {
      parsedBody = {};
    }
    const adminNotes = typeof parsedBody.notes === 'string' && parsedBody.notes.trim()
      ? parsedBody.notes.trim()
      : 'Anticipo exonerado por Administrador. Cobro del 100% acordado contra entrega al cliente.';

    const connection = await database.getConnection();
    try {
      await connection.beginTransaction();
      const [orders] = await connection.query<RowDataPacket[]>(
        'SELECT id,version,order_code,status,down_payment FROM orders WHERE id=? AND deleted_at IS NULL FOR UPDATE',
        [orderId]
      );
      if (!orders[0]) fail(404, 'Orden no encontrada');
      const currentOrder = orders[0];
      const currentStatus = statusFromDatabase(currentOrder.status);
      if (['entregado', 'cancelado', 'archivado', 'reembolsado'].includes(currentStatus)) {
        fail(409, `No se puede exonerar una orden en estado ${currentStatus}.`);
      }

      await connection.execute(
        "UPDATE orders SET downpayment_verified=1,downpayment_verified_at=CURRENT_TIMESTAMP,downpayment_verified_by=?,status='Pagado',version=version+1 WHERE id=?",
        [Number(claims.sub), orderId]
      );

      await connection.execute(
        'INSERT INTO status_orders (order_id,status,description,user_id) VALUES (?,?,?,?)',
        [orderId, 'Pagado', `Anticipo exonerado por Administrador: ${adminNotes}`, Number(claims.sub)]
      );

      const [actors] = await connection.query<RowDataPacket[]>('SELECT name FROM users WHERE id=?', [Number(claims.sub)]);
      const actorName = actors[0]?.name || 'Super Administrador';
      const today = workflowDate(new Date());
      const nextDue = addWorkingDays(today, 1);
      await connection.execute(
        `INSERT INTO order_workflow_events (
          order_id, task, outcome, actor_id, actor_name, notes, evidence,
          task_due_date, next_due_date, next_action, downpayment_details
        ) VALUES (?, 'ack', 'completed', ?, ?, ?, 'Exoneración autorizada por Administrador', ?, ?, ?, NULL)`,
        [
          orderId,
          Number(claims.sub),
          actorName,
          adminNotes,
          today,
          nextDue,
          'Buscar, desmontar y preparar la refacción en patio para entrega o retiro',
        ]
      );

      await connection.execute(
        "INSERT INTO audit_logs (user_id,username,action,resource_type,resource_id,details) VALUES (?,?,'DOWNPAYMENT_EXEMPTED','order',?,?)",
        [Number(claims.sub), String(claims.sub), String(orderId), JSON.stringify({ orderCode: currentOrder.order_code, reason: adminNotes })]
      );

      await connection.commit();
      broadcast('order:updated', {
        orderId: Number(orderId),
        action: 'DOWNPAYMENT_EXEMPTED',
        status: 'pagado',
        downpaymentVerified: true,
        timestamp: Date.now(),
      });
      sendJson(response, 200, { ok: true, status: 'pagado', downpaymentVerified: true, orderId: Number(orderId) });
      return true;
    } catch (error) {
      await connection.rollback();
      console.error('[ExemptDownpayment Error]:', error);
      const message = error instanceof Error ? error.message : 'No fue posible completar la solicitud';
      sendJson(response, 500, { message: `Error al exonerar anticipo: ${message}` });
      return true;
    } finally {
      connection.release();
    }
  }
  if (assignment) {
    if (!requireRole(response, claims, 'admin')) return true;
    if (request.method !== 'POST') { sendJson(response, 405, { message: 'Método no permitido' }); return true; }
    const input = z.object({ version: z.number().int().positive(), advisorId: z.number().int().positive().nullable() }).strict().parse(await readBody(request));
    const connection = await database.getConnection();
    try {
      await connection.beginTransaction();
      const [orders] = await connection.query<RowDataPacket[]>('SELECT id,version,user_id FROM orders WHERE id=? AND deleted_at IS NULL FOR UPDATE', [assignment[1]]);
      const order = orders[0];
      if (!order) fail(404, 'Orden no encontrada');
      if (Number(order.version) !== input.version) fail(409, 'La orden cambió; actualiza antes de asignar el seguimiento.');
      if (input.advisorId !== null) {
        const [advisors] = await connection.query<RowDataPacket[]>("SELECT id FROM users WHERE id=? AND role='operator' AND active=1 AND deleted_at IS NULL", [input.advisorId]);
        if (!advisors.length) fail(400, 'Selecciona un asesor activo de call center.');
        await connection.execute(`INSERT INTO order_followup_assignments (order_id,advisor_id,assigned_by,assigned_at) VALUES (?,?,?,UTC_TIMESTAMP())
          ON DUPLICATE KEY UPDATE advisor_id=VALUES(advisor_id),assigned_by=VALUES(assigned_by),assigned_at=UTC_TIMESTAMP()`,
          [order.id, input.advisorId, Number(claims.sub)]);
      } else await connection.execute('DELETE FROM order_followup_assignments WHERE order_id=?', [order.id]);
      await connection.execute("INSERT INTO audit_logs (user_id,username,action,resource_type,resource_id,details) VALUES (?,?,'ORDER_FOLLOWUP_ASSIGNED','order',?,?)",
        [Number(claims.sub), String(claims.sub), String(order.id), JSON.stringify({ advisorId: input.advisorId, sellerId: order.user_id })]);
      await connection.execute('UPDATE orders SET version=version+1 WHERE id=?', [order.id]);
      await connection.commit();
      broadcast('order:updated', { orderId: Number(order.id), action: 'FOLLOWUP_ASSIGNED', timestamp: Date.now() });
      sendJson(response, 200, { ok: true, version: input.version + 1 });
      return true;
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
  if (request.method === 'GET') {
    const params: (string | number)[] = [];
    let where = 'o.deleted_at IS NULL';
    if (match) { where += ' AND o.id=?'; params.push(match[1]); }
    else { where += " AND o.created_at>='2026-10-21 04:00:00'"; }
    if (claims.role !== 'admin') {
      where += ' AND (o.user_id=? OR (COALESCE(o.delivered_at,' + deliveredHistoryDateSql + ') IS NOT NULL AND f.advisor_id=?) OR (o.id IN (SELECT c.order_id FROM claims c WHERE c.assigned_user_id=? AND c.deleted_at IS NULL AND c.status IN (\'Pending\',\'In Process\'))))';
      params.push(Number(claims.sub), Number(claims.sub), Number(claims.sub));
    }
    const [rows] = await database.query<RowDataPacket[]>(
      `SELECT o.*, u.name AS advisor,u.role AS advisor_role,f.advisor_id AS followup_user_id,fu.name AS followup_advisor,c.first_name,c.last_name,c.language AS customer_crm_language, ${incidentDateSql}, ${confirmationPolicySql}, ${deliveryHistorySql}, ${match ? quoteCreatorSql : 'NULL AS quote_created_by'} FROM orders o LEFT JOIN users u ON u.id=o.user_id LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN order_followup_assignments f ON f.order_id=o.id LEFT JOIN users fu ON fu.id=f.advisor_id WHERE ${where}`, params,
    );
    if (match && !rows.length) fail(404, 'Orden no encontrada o no asignada a este operador.');
    const ids = rows.map(row => row.id);
    const [eventRows] = ids.length ? await database.query<RowDataPacket[]>(
      'SELECT * FROM order_workflow_events WHERE order_id IN (?) ORDER BY id', [ids],
    ) : [[]];
    const today = workflowDate(new Date());
    const tasks: WorkflowTask[] = [];
    const operators = new Map<number | null, { userId: number | null; name: string; completed: number; onTime: number; attempts: number; overdue: number; escalated: number; blocked: number; unassigned: number; penaltyPoints: number; overdueFollowups: number }>();
    const operatorSummary = (userId: number | null, name: string) => {
      let summary = operators.get(userId);
      if (!summary) {
        summary = { userId, name, completed: 0, onTime: 0, attempts: 0, overdue: 0, escalated: 0, blocked: 0, unassigned: 0, penaltyPoints: 0, overdueFollowups: 0 };
        operators.set(userId, summary);
      }
      return summary;
    };
    for (const row of rows) {
      const order = workflowOrderFromRow(row);
      const events = eventRows.filter(event => Number(event.order_id) === Number(row.id)).map(workflowEventFromRow);
      const pending = workflowTasks(order, events, today).filter(task => {
        if (match) return true;
        // "Mi trabajo de hoy": para operadores, solo Reclamos (incident), Listas para entregar (prepare) y Seguimiento post entrega (post_*)
        const isAllowedQueue = claims.role === 'admin' || task.task === 'incident' || task.task === 'prepare' || task.task.startsWith('post_');
        if (!isAllowedQueue) return false;
        return claims.role === 'admin' || workflowTaskAssignee(order, task.task).userId === Number(claims.sub);
      });
      if (match) {
        const [contacts] = await database.query<RowDataPacket[]>('SELECT id,operator_name,notes,created_at FROM order_delivery_followups WHERE order_id=? ORDER BY id DESC', [order.id]);
        sendJson(response, 200, { order, required: workflowRequired(order.createdAt), events, tasks: pending,
          contacts: contacts.map(contact => ({ id: String(contact.id), actor: contact.operator_name, notes: contact.notes, createdAt: new Date(contact.created_at).toISOString() })) });
        return true;
      }
      tasks.push(...pending);
      const assignee = workflowTaskAssignee(order, pending[0]?.task || (order.deliveredAt ? 'post_3' : 'prepare'));
      const summary = operatorSummary(assignee.userId, assignee.name);
      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const actorSummary = operatorSummary(event.actorId, event.actorName);
        if (event.outcome === 'completed') {
          actorSummary.completed++;
          if (event.taskDueDate && event.taskDueDate >= workflowDate(event.createdAt)) actorSummary.onTime++;
        } else if (event.outcome === 'no_response') actorSummary.attempts++;
      }
      summary.overdue += pending.filter(task => task.overdue && task.bucket !== 'blocked').length;
      summary.escalated += pending.filter(task => task.escalated).length;
      summary.blocked += pending.filter(task => task.bucket === 'blocked').length;
      summary.unassigned += assignee.userId === null ? pending.length : 0;
      for (const t of pending) {
        if (t.task.startsWith('post_') && t.overdue) {
          summary.overdueFollowups++;
          summary.penaltyPoints += (t.penaltyPoints || 0);
        }
      }
    }
    const rank = { overdue: 0, today: 1, blocked: 2, waiting: 3, upcoming: 4 };
    tasks.sort((a, b) => Number(b.escalated) - Number(a.escalated) || rank[a.bucket] - rank[b.bucket] || a.dueDate.localeCompare(b.dueDate));
    const [advisors] = claims.role === 'admin'
      ? await database.query<RowDataPacket[]>("SELECT id,name FROM users WHERE role='operator' AND active=1 AND deleted_at IS NULL ORDER BY name,id") : [[]];
    sendJson(response, 200, { tasks, today, operators: claims.role === 'admin' ? [...operators.values()] : [],
      followupAdvisors: advisors.map(advisor => ({ id: Number(advisor.id), name: advisor.name })) });
    return true;
  }
  if (request.method !== 'POST' || !match) { sendJson(response, 405, { message: 'Método no permitido' }); return true; }
  const requestAction = workflowActionSchema.parse(await readBody(request));
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT o.*,u.name AS advisor,u.role AS advisor_role,f.advisor_id AS followup_user_id,fu.name AS followup_advisor,c.first_name,c.last_name,c.phone AS customer_phone,c.language AS customer_crm_language,${incidentDateSql},${confirmationPolicySql},${deliveryHistorySql}
       FROM orders o LEFT JOIN users u ON u.id=o.user_id LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN order_followup_assignments f ON f.order_id=o.id LEFT JOIN users fu ON fu.id=f.advisor_id
       WHERE o.id=? AND o.deleted_at IS NULL FOR UPDATE`, [match[1]],
    );
    if (!rows.length) fail(404, 'Orden no encontrada');
    let previous = rows[0];
    const original = workflowOrderFromRow(previous);
    assertWorkflowAssignee(original, claims, requestAction.task);
    if (original.version !== requestAction.version) fail(409, 'La orden cambió; recarga antes de registrar la gestión.');
    if (requestAction.deliveryPhotos !== undefined) {
      if (!original.customerName) fail(409, 'La orden requiere el nombre del cliente para registrar la entrega.');
      requestAction.notes = `Recibe la pieza: ${original.customerName}`;
      requestAction.evidence = JSON.stringify(requestAction.deliveryPhotos);
    }
    if (requestAction.task === 'delivery' && requestAction.settlement?.payments.some(payment => !isBalancePaymentMethod(payment.method))) {
      fail(409, 'El saldo de entrega se paga únicamente en efectivo, Cash App o Zelle.');
    }
    if (requestAction.completion && (original.deliveredAt || original.status === 'entregado')) fail(409, 'La entrega ya está registrada.');
    if (requestAction.settlement) previous = await applyOrderSettlement(connection, previous, requestAction.settlement, claims);
    const events = await loadWorkflowEvents(connection, original.id);
    const actions: WorkflowAction[] = [];
    if (requestAction.completion) {
      const completed = completedWorkflowStages(events, original);
      if (completed.includes('ack') && requestAction.completion.downpayment) fail(409, 'La confirmación ya está verificada; no vuelvas a documentar el abono.');
      if (completed.includes('prepare') && requestAction.completion.preparation) fail(409, 'Preparación y cita ya están verificadas.');
      if (!completed.includes('ack')) {
        const paidNow = !original.paid && previous.down_payment;
        const downpayment = paidNow ? downpaymentSchema.parse(requestAction.settlement!.payments.map(payment => ({
          amount: payment.amount, method: payment.method, receivedBy: payment.receivedBy, receipt: payment.receipt || null,
        }))) : requestAction.completion.downpayment;
        if (paidNow && requestAction.completion.downpayment) fail(409, 'No hay abono anterior; la confirmación usa únicamente los pagos recibidos ahora.');
        actions.push({ task: 'ack', outcome: 'completed', notes: requestAction.notes, evidence: requestAction.evidence,
          confirmed: requestAction.confirmed, downpayment });
      }
      if (!completed.includes('prepare')) actions.push({
        task: 'prepare', outcome: 'completed', notes: '', preparation: requestAction.completion.preparation,
      });
    }
    actions.push(requestAction);
    let eventId = '';
    for (const action of actions) {
      const order = workflowOrderFromRow(previous);
      if (action.exemptDownpayment && claims.role !== 'admin') {
        fail(403, 'Solo el Administrador puede exonerar el anticipo.');
      }
      const validationOrder = action.task === 'ack' && original.paid > 0 ? { ...order, paid: original.paid } : order;
      try { validateWorkflowAction(validationOrder, events, action); }
      catch (error) { fail(409, error instanceof Error ? error.message : 'Gestión inválida'); }
      const images = [...(action.downpayment?.flatMap(payment => payment.receipt ? [payment.receipt] : []) || []), ...(action.preparation?.screenshots || []), ...(action.deliveryPhotos || []), ...(action.communication?.screenshots || [])];
      await assertPaymentImages(connection, order.id, images, claims);
      const [actors] = await connection.query<RowDataPacket[]>('SELECT name FROM users WHERE id=?', [Number(claims.sub)]);
      if (!actors.length) fail(403, 'Operador autenticado no encontrado');
      const actorName = actors[0].name;
      if (action.task === 'delivery' && action.outcome === 'completed' && order.status !== 'entregado') {
        await completeOrderDelivery(connection, previous, claims, 'Entrega verificada con evidencia');
      }
      let nextStatus: string | null = null;
      if (action.outcome === 'completed' && !order.deliveredAt) {
        if (action.task === 'ack' && ['cotizacion', 'espera_confirmacion', 'pagado'].includes(order.status)) {
          if (action.exemptDownpayment) {
            nextStatus = statusToDatabase.pagado;
            await connection.execute("UPDATE orders SET downpayment_verified=1,downpayment_verified_at=CURRENT_TIMESTAMP,downpayment_verified_by=? WHERE id=?",
              [Number(claims.sub), order.id]);
          } else {
            const hasP2P = action.downpayment?.some(p => ['zelle', 'cashapp'].includes(p.method));
            if (hasP2P && claims.role !== 'admin' && !order.downpaymentVerified) {
              nextStatus = statusToDatabase.espera_confirmacion;
            } else {
              nextStatus = statusToDatabase.pagado;
            }
          }
        }
        if (action.task === 'prepare' && action.preparation) nextStatus = action.preparation.deliveryType === 'envio_domicilio' ? statusToDatabase.listo_despacho : statusToDatabase.listo_retiro;
      }
      if (action.preparation) {
        await connection.execute(
          'UPDATE orders SET preparation_details=?,shipping_toggle=?,shipping_address=IF(?, ?, shipping_address),scheduled_pickup_at=? WHERE id=?',
          [JSON.stringify(action.preparation), action.preparation.deliveryType === 'envio_domicilio',
          action.preparation.deliveryType === 'envio_domicilio', action.preparation.address,
          `${action.preparation.dateFrom} 16:00:00`, order.id],
        );
        previous = {
          ...previous, preparation_details: JSON.stringify(action.preparation),
          shipping_toggle: action.preparation.deliveryType === 'envio_domicilio',
          shipping_address: action.preparation.deliveryType === 'envio_domicilio' ? action.preparation.address : previous.shipping_address,
          scheduled_pickup_at: `${action.preparation.dateFrom} 16:00:00`
        } as RowDataPacket;
      }
      if (nextStatus && nextStatus !== previous.status) {
        await connection.execute('UPDATE orders SET status=? WHERE id=?', [nextStatus, order.id]);
        await connection.execute('INSERT INTO status_orders (order_id,status,description,user_id) VALUES (?,?,?,?)',
          [order.id, nextStatus, `Cambio automático por flujo verificado: ${action.task}`, Number(claims.sub)]);
        previous = { ...previous, status: nextStatus } as RowDataPacket;
      }
      const [insert] = await connection.execute<ResultSetHeader>(
        `INSERT INTO order_workflow_events (order_id,task,outcome,actor_id,actor_name,notes,evidence,task_due_date,next_due_date,next_action,blocked_by,scheduled_at,contact_result,part_status,downpayment_details,preparation_details)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [order.id, action.task, action.outcome, Number(claims.sub), actorName,
        action.exemptDownpayment ? (action.notes || 'Anticipo exonerado por Administrador. Cobro del 100% acordado contra entrega al cliente.') : action.downpayment ? 'Downpayment existente documentado; no se agregó dinero al acumulado.' : action.preparation ? action.preparation.channel === 'in_person' ? 'Preparación verificada con el cliente presente para entrega inmediata en yarda; sin llamada ni cita futura.' : 'Preparación y cita verificadas con el cliente; sin registrar cobros ni recepción del core.' : action.notes,
        action.downpayment ? '' : action.communication ? JSON.stringify({ format: 'followup-contact-v1', reference: action.evidence || '', communication: action.communication })
          : action.evidence || '', workflowTasks(order, events)[0].objectiveDueDate,
        action.nextDueDate || null, action.nextAction || null, action.blockedBy || null,
        action.outcome === 'completed' ? toMysqlDateTime(action.scheduledAt) : null,
        action.preparation ? action.preparation.channel === 'in_person' ? null : action.preparation.channel === 'sms' ? 'sms_replied' : 'answered' : action.contactResult || null,
        action.partStatus || null, action.downpayment ? JSON.stringify(action.downpayment) : null,
        action.preparation ? JSON.stringify(action.preparation) : null],
      );
      eventId = String(insert.insertId);
      events.push({
        ...action, id: eventId, actorId: Number(claims.sub), actorName, createdAt: new Date().toISOString(),
        evidence: action.evidence || '', nextDueDate: action.nextDueDate || null, nextAction: action.nextAction || null,
        blockedBy: action.blockedBy || null, scheduledAt: action.scheduledAt || null,
        contactResult: action.contactResult || null, partStatus: action.partStatus || null
      });
      if (action.task.startsWith('post_')) {
        const [previousContacts] = await connection.query<RowDataPacket[]>(
          'SELECT part_status FROM order_delivery_followups WHERE order_id=? ORDER BY id DESC LIMIT 1', [order.id]);
        await connection.execute(
          `INSERT INTO order_delivery_followups (order_id,operator_name,contact_channel,call_result,part_status,warranty_warning_given,promised_install_date,notes)
         VALUES (?,?,?,?,?,?,?,?)`,
          [order.id, actorName, action.communication?.channel || (action.contactResult?.startsWith('sms') ? 'sms' : 'call'),
          action.contactResult || 'no_answer', action.partStatus || previousContacts[0]?.part_status || 'not_installed', Number(action.communication?.warrantyWarningGiven || false),
          action.scheduledAt ? workflowDate(action.scheduledAt) : null, action.notes],
        );
        await connection.execute(
          `INSERT INTO call_register (order_id,caller_name,caller_phone,attended_by,conversation_summary,whatsapp_dispatched)
         VALUES (?,?,?,?,?,0)`,
          [order.id, [previous.first_name, previous.last_name].filter(Boolean).join(' ') || 'Cliente', previous.customer_phone || '',
            actorName, `[FLUJO ${action.task} · ${action.contactResult || 'no_answer'}] ${action.notes}`],
        );
      }
      await connection.execute(
        "INSERT INTO audit_logs (user_id,username,action,resource_type,resource_id,details) VALUES (?,?,'ORDER_WORKFLOW_RECORDED','order',?,?)",
        [Number(claims.sub), actorName, order.id, JSON.stringify({ eventId: insert.insertId, ...action })],
      );
    }
    const stageIndex = ['quote', 'ack', 'prepare', 'delivery'].indexOf(requestAction.task);
    await connection.execute(
      'UPDATE orders SET version=version+1,workflow_step=IF(? >= 0,?,workflow_step) WHERE id=?',
      [requestAction.outcome === 'completed' ? stageIndex : -1, Math.min(4, stageIndex + 2), original.id],
    );
    if ((requestAction.task === 'prepare' && requestAction.outcome === 'completed' || Boolean(requestAction.preparation)) && Boolean(previous.yard_piece_ready)) {
      await performYardImagesCleanup(connection, Number(original.id), previous.yard_compatibility, original.code, claims);
    }
    await connection.commit();
    broadcast('order:updated', { orderId: Number(original.id), action: 'WORKFLOW_RECORDED', timestamp: Date.now() });
    const hasP2P = requestAction.downpayment?.some(p => ['zelle', 'cashapp'].includes(p.method));
    if (requestAction.task === 'ack' && hasP2P && claims.role !== 'admin') {
      try {
        const [admins] = await database.query<RowDataPacket[]>(
          "SELECT phone FROM users WHERE role = 'admin' AND phone IS NOT NULL AND phone != ''"
        );
        const zelleLines = requestAction.downpayment?.filter(p => ['zelle', 'cashapp'].includes(p.method)) || [];
        const desc = zelleLines.map(p => `• ${p.method.toUpperCase()}: $${p.amount.toFixed(2)} (Remitente: ${p.senderName || 'No indicado'})`).join('\n');
        const msg = `🚨 *ANTICIPO POR VERIFICAR EN BANCO*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n📦 *Orden:* ${original.code}\n👤 *Cliente:* ${original.customerName || 'Cliente'}\n💳 *Método:* Zelle / Cash App\n${desc}\n━━━━━━━━━━━━━━━━━━━━━━━━━\n👉 Ingresa a la orden en Radar y presiona "Aprobar Anticipo (Banco)" para pasar a Pagado.`;
        for (const a of admins) {
          if (a.phone) void wasender.sendText({ to: a.phone, text: msg });
        }
      } catch (err) {
        console.error('[Workflow] Error notificando WhatsApp al admin:', err);
      }
    }
    sendJson(response, 201, { ok: true, version: original.version + 1, eventId });
    return true;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
