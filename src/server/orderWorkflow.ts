import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import type { Claims } from './auth';
import type { OrderStatus } from '../types';
import { ORDER_STATUS_LABELS } from '../utils/orderStatusRules';
import { requireRole } from './auth';
import { readBody, sendJson } from './http';
import { fail } from './business';
import { statusFromDatabase, toMysqlDateTime } from './orders';
import { settlementSchema } from '../utils/orderPayments';
import { applyOrderSettlement, completeOrderDelivery } from './orderPayments';
import {
  addWorkingDays, completedWorkflowStages, validateWorkflowAction, workflowDate, workflowRequired, workflowTasks,
  type WorkflowEvent, type WorkflowOrder, type WorkflowTask,
} from '../utils/orderWorkflow';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Fecha inválida');
export const workflowActionSchema = z.object({
  version: z.number().int().positive(),
  task: z.enum(['quote', 'ack', 'prepare', 'delivery', 'post_3', 'post_7', 'post_14', 'incident']),
  outcome: z.enum(['completed', 'no_response', 'blocked', 'incident']),
  notes: z.string().trim().min(5).max(5000),
  evidence: z.string().trim().max(5000).optional(),
  confirmed: z.boolean().optional(),
  nextDueDate: dateSchema.optional().nullable(),
  nextAction: z.string().trim().max(1000).optional().nullable(),
  blockedBy: z.string().trim().max(200).optional().nullable(),
  scheduledAt: z.string().datetime({ offset: true }).optional().nullable(),
  contactResult: z.enum(['answered', 'no_answer', 'busy', 'wrong_number', 'sms_sent', 'sms_replied', 'sms_no_reply']).optional().nullable(),
  partStatus: z.enum(['not_installed', 'in_process', 'installed_ok', 'has_issues', 'defect_claim']).optional().nullable(),
  settlement: settlementSchema.optional(),
}).strict().refine(value => !value.settlement || value.task === 'delivery' && value.outcome === 'completed',
  'Los cobros solo se adjuntan a una entrega confirmada.');

const isOrderStatus = (value: string): value is OrderStatus => Object.hasOwn(ORDER_STATUS_LABELS, value);
const incidentDateSql = `CASE WHEN o.status IN ('Reclamo','reclamo') THEN
  (SELECT MAX(c.created_at) FROM claims c WHERE c.order_id=o.id AND c.deleted_at IS NULL)
  WHEN o.status IN ('Solicitud Reembolso','Solicitud de Reembolso','solicitud_reembolso') THEN
  (SELECT MAX(r.created_at) FROM refund_requests r WHERE r.order_id=o.id AND r.status='pending') END AS incident_created_at`;
export const workflowOrderFromRow = (row: RowDataPacket): WorkflowOrder => {
  const status = statusFromDatabase(row.status);
  if (isOrderStatus(status)) return {
  id: String(row.id), code: row.order_code, userId: row.user_id ? Number(row.user_id) : null,
  advisor: row.advisor || 'Sin asignar', version: Number(row.version),
  createdAt: new Date(row.created_at).toISOString(), status,
  deliveredAt: row.delivered_at ? new Date(row.delivered_at).toISOString() : null,
  scheduledPickupAt: row.scheduled_pickup_at ? new Date(row.scheduled_pickup_at).toISOString() : null,
  total: Number(row.price || 0) + Number(row.core_fee || 0) + Number(row.shipping_cost || 0),
  paid: Number(row.down_payment || 0),
  incidentCreatedAt: row.incident_created_at ? new Date(row.incident_created_at).toISOString() : null,
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
});
export async function loadWorkflowEvents(connection: Pool | PoolConnection, orderId: string | number) {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM order_workflow_events WHERE order_id=? ORDER BY id', [orderId]);
  return rows.map(workflowEventFromRow);
}
export function assertWorkflowAssignee(order: WorkflowOrder, claims: Claims) {
  if (claims.role !== 'admin' && order.userId !== Number(claims.sub)) fail(403, 'Solo el operador asignado o administración puede gestionar el flujo.');
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
  const stage = closed || nextIndex <= 1 ? 'quote' : 'prepare';
  const [actors] = await connection.query<RowDataPacket[]>('SELECT name FROM users WHERE id=?', [Number(claims.sub)]);
  if (!actors[0]) fail(403, 'Operador autenticado no encontrado');
  const nextDueDate = addWorkingDays(workflowDate(new Date()), 1);
  await connection.execute(
    `INSERT INTO order_workflow_events (order_id,task,outcome,actor_id,actor_name,notes,evidence,next_due_date,next_action)
     VALUES (?,?,'reopened',?,?,?,'',?,?)`,
    [previous.id, stage, Number(claims.sub), actors[0].name, `Flujo reabierto por cambio de estado: ${oldStatus} → ${nextStatus}`, nextDueDate, 'Verificar nuevamente la etapa reabierta. Se conserva la entrega y garantía originales.'],
  );
}
export async function enforceWorkflowUpdate(connection: PoolConnection, previous: RowDataPacket, next: { status?: string; workflowStep?: number }, claims?: Claims) {
  if (!workflowRequired(new Date(previous.created_at).toISOString())) return;
  if (next.workflowStep !== undefined && next.workflowStep !== Number(previous.workflow_step || 1)) {
    fail(409, 'Completa las etapas desde el flujo verificable; no se puede editar su número.');
  }
  const oldStatus = statusFromDatabase(previous.status);
  if (next.status === oldStatus) return;
  const events = await loadWorkflowEvents(connection, previous.id);
  const completed = completedWorkflowStages(events);
  if (next.status === 'entregado') fail(409, 'Registra la entrega física y su evidencia desde el flujo verificable.');
  if (claims?.role === 'admin' && ['cancelado', 'archivado', 'reembolsado'].includes(oldStatus) &&
      ['cotizacion', 'pagado', 'en_preparacion'].includes(next.status || '')) {
    await recordWorkflowReopening(connection, previous, next.status!, claims);
    return;
  }
  const needed = ['listo_despacho', 'listo_retiro', 'en_camino'].includes(next.status || '')
    ? ['quote', 'ack', 'prepare'] : ['pagado', 'en_preparacion'].includes(next.status || '') ? ['quote'] : [];
  if (next.status === 'en_preparacion') needed.push('ack');
  if (needed.some(stage => !completed.includes(stage as typeof completed[number]))) {
    fail(409, 'Completa las etapas previas con evidencia antes de avanzar el estado.');
  }
  if (claims && next.status) await recordWorkflowReopening(connection, previous, next.status, claims);
}

export async function handleWorkflowRequest(
  request: IncomingMessage, response: ServerResponse, pathname: string, claims: Claims, database: Pool,
  broadcast: (type: string, payload: Record<string, unknown>) => void,
): Promise<boolean> {
  const match = pathname.match(/^\/api\/orders\/(\d+)\/workflow$/);
  const queue = pathname === '/api/workflow/tasks';
  if (!match && !queue) return false;
  if (!requireRole(response, claims, 'admin', 'operator', 'vendedor_yarda')) return true;
  if (request.method === 'GET') {
    const params: (string | number)[] = [];
    let where = 'o.deleted_at IS NULL';
    if (match) { where += ' AND o.id=?'; params.push(match[1]); }
    else { where += " AND o.created_at>='2026-10-21 04:00:00'"; }
    if (claims.role !== 'admin') { where += ' AND o.user_id=?'; params.push(Number(claims.sub)); }
    const [rows] = await database.query<RowDataPacket[]>(
      `SELECT o.*, u.name AS advisor, ${incidentDateSql} FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE ${where}`, params,
    );
    if (match && !rows.length) fail(404, 'Orden no encontrada o no asignada a este operador.');
    const ids = rows.map(row => row.id);
    const [eventRows] = ids.length ? await database.query<RowDataPacket[]>(
      'SELECT * FROM order_workflow_events WHERE order_id IN (?) ORDER BY id', [ids],
    ) : [[]];
    const today = workflowDate(new Date());
    const tasks: WorkflowTask[] = [];
    const operators = new Map<number | null, { userId: number | null; name: string; completed: number; onTime: number; attempts: number; overdue: number; escalated: number; blocked: number; unassigned: number }>();
    for (const row of rows) {
      const order = workflowOrderFromRow(row);
      const events = eventRows.filter(event => Number(event.order_id) === Number(row.id)).map(workflowEventFromRow);
      const pending = workflowTasks(order, events, today);
      if (match) {
        const [contacts] = await database.query<RowDataPacket[]>('SELECT id,operator_name,notes,created_at FROM order_delivery_followups WHERE order_id=? ORDER BY id DESC', [order.id]);
        sendJson(response, 200, { order, required: workflowRequired(order.createdAt), events, tasks: pending,
          contacts: contacts.map(contact => ({ id: String(contact.id), actor: contact.operator_name, notes: contact.notes, createdAt: new Date(contact.created_at).toISOString() })) });
        return true;
      }
      tasks.push(...pending);
      const summary = operators.get(order.userId) || { userId: order.userId, name: order.advisor, completed: 0, onTime: 0, attempts: 0, overdue: 0, escalated: 0, blocked: 0, unassigned: 0 };
      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        if (event.outcome === 'completed') {
          summary.completed++;
          if (event.taskDueDate && event.taskDueDate >= workflowDate(event.createdAt)) summary.onTime++;
        } else if (event.outcome === 'no_response') summary.attempts++;
      }
      summary.overdue += pending.filter(task => task.overdue && task.bucket !== 'blocked').length;
      summary.escalated += pending.filter(task => task.escalated).length;
      summary.blocked += pending.filter(task => task.bucket === 'blocked').length;
      summary.unassigned += order.userId === null ? pending.length : 0;
      operators.set(order.userId, summary);
    }
    const rank = { overdue: 0, today: 1, blocked: 2, waiting: 3, upcoming: 4 };
    tasks.sort((a, b) => Number(b.escalated) - Number(a.escalated) || rank[a.bucket] - rank[b.bucket] || a.dueDate.localeCompare(b.dueDate));
    sendJson(response, 200, { tasks, today, operators: claims.role === 'admin' ? [...operators.values()] : [] });
    return true;
  }
  if (request.method !== 'POST' || !match) { sendJson(response, 405, { message: 'Método no permitido' }); return true; }
  const action = workflowActionSchema.parse(await readBody(request));
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT o.*,u.name AS advisor,c.first_name,c.last_name,c.phone AS customer_phone,${incidentDateSql}
       FROM orders o LEFT JOIN users u ON u.id=o.user_id LEFT JOIN customers c ON c.id=o.customer_id
       WHERE o.id=? AND o.deleted_at IS NULL FOR UPDATE`, [match[1]],
    );
    if (!rows.length) fail(404, 'Orden no encontrada');
    let previous = rows[0];
    const original = workflowOrderFromRow(previous);
    assertWorkflowAssignee(original, claims);
    if (original.version !== action.version) fail(409, 'La orden cambió; recarga antes de registrar la gestión.');
    if (action.settlement) previous = await applyOrderSettlement(connection, previous, action.settlement, claims);
    const order = workflowOrderFromRow(previous);
    const events = await loadWorkflowEvents(connection, order.id);
    try { validateWorkflowAction(order, events, action); }
    catch (error) { fail(409, error instanceof Error ? error.message : 'Gestión inválida'); }
    const [actors] = await connection.query<RowDataPacket[]>('SELECT name FROM users WHERE id=?', [Number(claims.sub)]);
    if (!actors.length) fail(403, 'Operador autenticado no encontrado');
    const actorName = actors[0].name;
    if (action.task === 'delivery' && action.outcome === 'completed' && order.status !== 'entregado') {
      await completeOrderDelivery(connection, previous, claims, 'Entrega verificada con evidencia');
    }
    const [insert] = await connection.execute<ResultSetHeader>(
      `INSERT INTO order_workflow_events (order_id,task,outcome,actor_id,actor_name,notes,evidence,task_due_date,next_due_date,next_action,blocked_by,scheduled_at,contact_result,part_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [order.id, action.task, action.outcome, Number(claims.sub), actorName, action.notes, action.evidence || '', workflowTasks(order, events)[0].objectiveDueDate,
        action.nextDueDate || null, action.nextAction || null, action.blockedBy || null,
        action.outcome === 'completed' ? toMysqlDateTime(action.scheduledAt) : null,
        action.contactResult || null, action.partStatus || null],
    );
    const stageIndex = ['quote', 'ack', 'prepare', 'delivery'].indexOf(action.task);
    await connection.execute(
      'UPDATE orders SET version=version+1,workflow_step=IF(? >= 0,?,workflow_step),scheduled_pickup_at=COALESCE(?,scheduled_pickup_at) WHERE id=?',
      [action.outcome === 'completed' ? stageIndex : -1, Math.min(4, stageIndex + 2),
        action.task === 'prepare' && action.outcome === 'completed' ? toMysqlDateTime(action.scheduledAt) : null, order.id],
    );
    if (action.task.startsWith('post_')) {
      await connection.execute(
        `INSERT INTO order_delivery_followups (order_id,operator_name,contact_channel,call_result,part_status,warranty_warning_given,promised_install_date,notes)
         VALUES (?,?,?,?,?,?,?,?)`,
        [order.id, actorName, action.contactResult?.startsWith('sms') ? 'sms' : 'call',
          action.contactResult || 'no_answer', action.partStatus || 'not_installed', 0,
          action.scheduledAt ? workflowDate(action.scheduledAt) : action.outcome === 'blocked' ? action.nextDueDate : null, action.notes],
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
    await connection.commit();
    broadcast('order:updated', { orderId: Number(order.id), action: 'WORKFLOW_RECORDED', timestamp: Date.now() });
    sendJson(response, 201, { ok: true, version: order.version + 1, eventId: String(insert.insertId) });
    return true;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
