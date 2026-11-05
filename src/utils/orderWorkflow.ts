import type { FollowupCallResult, FollowupPartStatus, OrderStatus } from '../types';

export const WORKFLOW_CUTOFF = '2026-10-21';
export const WORKFLOW_STAGES = [
  { id: 'quote', title: 'Cotización', requirement: 'Cotización registrada al crear la orden.' },
  { id: 'ack', title: 'Confirmación', requirement: 'Aceptación del cliente y abono recibido; fecha comprometida de preparación.' },
  { id: 'prepare', title: 'Preparación y cita', requirement: 'Pieza verificada y lista; retiro o envío acordado con fecha.' },
  { id: 'delivery', title: 'Entrega', requirement: 'Entrega física, comprobante y garantía comunicada; saldo liquidado.' },
] as const;
export type WorkflowStage = typeof WORKFLOW_STAGES[number]['id'];
export type WorkflowTaskKey = WorkflowStage | 'post_3' | 'post_7' | 'post_14' | 'incident';
export type WorkflowOutcome = 'completed' | 'no_response' | 'blocked' | 'incident';
export interface WorkflowOrder {
  id: string; code: string; userId: number | null; advisor: string; version: number;
  createdAt: string; status: OrderStatus; deliveredAt: string | null;
  scheduledPickupAt: string | null; total: number; paid: number;
  incidentCreatedAt?: string | null;
  quoteCreatedBy?: string | null;
}
export interface WorkflowEvent {
  id: string; task: WorkflowTaskKey; outcome: WorkflowOutcome | 'reopened';
  notes: string; evidence: string; actorId: number; actorName: string; createdAt: string;
  nextDueDate: string | null; nextAction: string | null; blockedBy: string | null;
  scheduledAt: string | null; contactResult: FollowupCallResult | null; partStatus: FollowupPartStatus | null;
  taskDueDate?: string | null;
}
export interface WorkflowAction {
  task: WorkflowTaskKey; outcome: WorkflowOutcome; notes: string; evidence?: string; confirmed?: boolean;
  nextDueDate?: string | null; nextAction?: string | null; blockedBy?: string | null;
  scheduledAt?: string | null; contactResult?: FollowupCallResult | null; partStatus?: FollowupPartStatus | null;
}
export interface WorkflowTask {
  order: WorkflowOrder; task: WorkflowTaskKey; title: string; requirement: string;
  dueDate: string; nextAction: string; blockedBy: string | null;
  objectiveDueDate: string;
  bucket: 'overdue' | 'today' | 'upcoming' | 'waiting' | 'blocked';
  overdue: boolean; escalated: boolean; regularization: boolean;
  needsIncident: boolean;
}
export const workflowDate = (value: string | Date) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Fecha de flujo inválida');
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
};
export const shiftWorkflowDate = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(value.getTime())) throw new Error('Fecha de flujo inválida');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
export const addWorkingDays = (date: string, days: number) => {
  let current = date;
  for (let i = 0; i < days;) {
    current = shiftWorkflowDate(current, 1);
    const weekday = new Date(`${current}T12:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) i++;
  }
  return current;
};
export const workflowRequired = (createdAt: string) => workflowDate(createdAt) >= WORKFLOW_CUTOFF;
const effectiveWorkflowEvents = (events: WorkflowEvent[]) => {
  const reopened = [...events].reverse().find(event => event.outcome === 'reopened');
  if (!reopened) return events;
  const index = events.indexOf(reopened);
  const stageIndex = WORKFLOW_STAGES.findIndex(stage => stage.id === reopened.task);
  return events.filter((event, i) => i >= index || WORKFLOW_STAGES.findIndex(stage => stage.id === event.task) >= 0 &&
    WORKFLOW_STAGES.findIndex(stage => stage.id === event.task) < stageIndex);
};
export const completedWorkflowStages = (events: WorkflowEvent[]) =>
  WORKFLOW_STAGES.filter(stage => stage.id === 'quote' || effectiveWorkflowEvents(events).some(event => event.task === stage.id && event.outcome === 'completed')).map(stage => stage.id);

export function workflowTasks(order: WorkflowOrder, events: WorkflowEvent[], today = workflowDate(new Date())): WorkflowTask[] {
  if (!workflowRequired(order.createdAt) || ['cancelado', 'reembolsado', 'archivado'].includes(order.status)) return [];
  events = effectiveWorkflowEvents(events);
  let task: WorkflowTaskKey;
  let title: string;
  let requirement: string;
  let dueDate: string;
  const completed = completedWorkflowStages(events);
  const stage = WORKFLOW_STAGES.find(stage => !completed.includes(stage.id));
  const incident = ['reclamo', 'solicitud_reembolso'].includes(order.status);
  if (incident) {
    task = 'incident'; title = 'Dar seguimiento a la incidencia';
    requirement = 'Gestionar el caso en Reclamos o Reembolsos; registrar responsable y próxima revisión.';
    dueDate = addWorkingDays(workflowDate(order.incidentCreatedAt || order.createdAt), 1);
  } else if (stage) {
    task = stage.id; title = stage.title; requirement = stage.requirement;
    const index = WORKFLOW_STAGES.indexOf(stage);
    const previous = index > 1 ? [...events].reverse().find(event => event.task === WORKFLOW_STAGES[index - 1].id && event.outcome === 'completed') : undefined;
    dueDate = previous?.nextDueDate || (task === 'delivery' && previous?.scheduledAt
      ? workflowDate(previous.scheduledAt) : addWorkingDays(workflowDate(previous?.createdAt || order.createdAt), 1));
  } else {
    if (!order.deliveredAt) return [];
    const milestone = ([3, 7, 14] as const).find(day => !events.some(event => event.task === `post_${day}` && event.outcome === 'completed'));
    if (!milestone) return [];
    task = `post_${milestone}`; title = `Post-entrega · Día ${milestone}`;
    requirement = milestone === 3 ? 'Confirmar recepción y programación de instalación.'
      : milestone === 7 ? 'Confirmar montaje y funcionamiento; abrir incidencia ante problemas.'
      : 'Confirmar conformidad y funcionamiento para cerrar el seguimiento temprano.';
    dueDate = shiftWorkflowDate(workflowDate(order.deliveredAt), milestone);
  }
  const latest = [...events].reverse().find(event => event.task === task);
  const reopened = events.find(event => (event.task === task || task === 'ack' && event.task === 'quote') && event.outcome === 'reopened');
  if (reopened?.nextDueDate) dueDate = reopened.nextDueDate;
  const objectiveDueDate = dueDate;
  if (latest?.nextDueDate) dueDate = latest.nextDueDate;
  const overdue = dueDate < today || objectiveDueDate < today;
  const escalated = addWorkingDays(objectiveDueDate, 1) <= today && latest?.outcome !== 'blocked';
  const bucket = latest?.outcome === 'blocked' ? 'blocked'
    : dueDate < today ? 'overdue' : dueDate === today ? 'today'
    : latest?.outcome === 'no_response' ? 'waiting' : 'upcoming';
  return [{
    order, task, title, requirement, dueDate, objectiveDueDate, nextAction: latest?.nextAction || requirement,
    blockedBy: latest?.blockedBy || null, bucket, overdue, escalated,
    needsIncident: incident || latest?.outcome === 'incident' || ['has_issues', 'defect_claim'].includes(latest?.partStatus || ''),
    regularization: Boolean(stage && order.status === 'entregado'),
  }];
}

export function validateWorkflowAction(order: WorkflowOrder, events: WorkflowEvent[], action: WorkflowAction, today = workflowDate(new Date())) {
  const task = workflowTasks(order, events, today)[0];
  if (!task || task.task !== action.task) throw new Error('Debes gestionar la etapa pendiente; no se permiten saltos ni completar dos veces.');
  if (action.notes.trim().length < 5) throw new Error('Registra el detalle de la gestión (mínimo 5 caracteres).');
  if (action.outcome !== 'completed') {
    if (!action.nextAction?.trim()) throw new Error('Indica la próxima acción.');
    if (!action.nextDueDate || action.nextDueDate <= today) throw new Error('La próxima fecha debe ser posterior a hoy.');
    if (action.outcome === 'no_response' && action.nextDueDate !== addWorkingDays(today, 1)) throw new Error('El reintento corresponde al siguiente día hábil.');
    if (action.outcome === 'blocked' && !action.blockedBy?.trim()) throw new Error('Indica quién debe resolver el bloqueo.');
    if (action.outcome === 'no_response' && ['answered', 'sms_replied'].includes(action.contactResult || '')) throw new Error('El resultado de contacto contradice una gestión sin respuesta.');
    return;
  }
  if (task.task === 'incident') throw new Error('Cierra el caso desde Reclamos o Reembolsos, no desde el flujo.');
  if (!action.evidence?.trim() || action.evidence.trim().length < 5) throw new Error('La evidencia o referencia verificable es obligatoria.');
  if (!action.confirmed) throw new Error('Confirma que realizaste las verificaciones de esta etapa.');
  if (action.nextDueDate && task.task !== 'ack') throw new Error('Esta etapa no permite cambiar el plazo de la siguiente gestión.');
  if (action.scheduledAt && !['prepare', 'post_3'].includes(task.task)) throw new Error('Esta etapa no permite modificar una fecha acordada.');
  if (task.task === 'ack') {
    if (order.paid <= 0) throw new Error('Administración debe registrar el abono antes de confirmar.');
    if (!action.nextDueDate || action.nextDueDate < today) throw new Error('Indica la fecha comprometida de preparación.');
  }
  if (task.task === 'prepare') {
    if (!action.scheduledAt || !Number.isFinite(Date.parse(action.scheduledAt))) throw new Error('Indica la fecha de retiro o entrega acordada.');
    if (!order.deliveredAt && workflowDate(action.scheduledAt) < today) throw new Error('La cita no puede ser anterior a hoy.');
  }
  if (task.task === 'delivery' && Math.round(order.paid * 100) !== Math.round(order.total * 100)) throw new Error('Liquida el saldo pendiente antes de completar la entrega.');
  if (task.task.startsWith('post_')) {
    if (task.objectiveDueDate > today) throw new Error('El hito post-entrega todavía no vence.');
    if (!['answered', 'sms_replied'].includes(action.contactResult || '')) throw new Error('Necesitas una respuesta real del cliente, no solo un intento.');
    if (task.task === 'post_3' && action.partStatus === 'not_installed' &&
      (!action.scheduledAt || !Number.isFinite(Date.parse(action.scheduledAt)) || workflowDate(action.scheduledAt) < today)) {
      throw new Error('Registra la fecha de instalación acordada o un bloqueo con responsable.');
    }
    const allowed = task.task === 'post_3' ? ['not_installed', 'in_process', 'installed_ok'] : ['installed_ok'];
    if (task.task === 'post_14' ? action.partStatus !== 'installed_ok' : !allowed.includes(action.partStatus || '')) {
      throw new Error('El resultado no confirma el objetivo; registra un bloqueo o gestiona la incidencia.');
    }
  }
}
