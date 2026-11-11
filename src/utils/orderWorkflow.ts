import type { FollowupCallResult, FollowupPartStatus, OrderStatus } from '../types';
import { downpaymentSchema, validateDownpayment, type DownpaymentLine } from './downpaymentConfirmation';
import { preparationSchema, validatePreparation, type Preparation } from './orderPreparation';
import { deliveryPhotosSchema } from './orderDelivery';
import { communicationSchema, validateCommunication } from './followupCommunication';

export const WORKFLOW_CUTOFF = '2026-10-21';
export const POST_DELIVERY_FOLLOWUP_CUTOFF = '2026-11-07T20:05:52.000Z';
export const WORKFLOW_STAGES = [
  { id: 'quote', title: 'Cotización', requirement: 'Cotización registrada al crear la orden.' },
  { id: 'ack', title: 'Confirmación', requirement: 'Documentar el downpayment ya registrado: métodos, montos, receptor solo en cash e imágenes de comprobantes para los demás métodos.' },
  { id: 'prepare', title: 'Preparación y cita', requirement: 'Pieza verificada y lista; retiro o envío acordado con fecha.' },
  { id: 'delivery', title: 'Entrega', requirement: 'Entrega física, comprobante y garantía comunicada; saldo liquidado.' },
] as const;
export type WorkflowStage = typeof WORKFLOW_STAGES[number]['id'];
export type WorkflowTaskKey = WorkflowStage | 'post_3' | 'post_7' | 'post_14' | 'incident';
export type WorkflowOutcome = 'completed' | 'no_response' | 'blocked' | 'incident';
export interface WorkflowOrder {
  isYardSale?: boolean;
  followupUserId?: number | null;
  followupAdvisor?: string | null;
  warrantyTerms?: import('./aftersales').WarrantyTerms | null;
  customerLanguage?: 'es' | 'en';
  customerName?: string;
  id: string; code: string; userId: number | null; advisor: string; version: number;
  createdAt: string; status: OrderStatus; deliveredAt: string | null;
  scheduledPickupAt: string | null; total: number; paid: number; core?: number;
  incidentCreatedAt?: string | null;
  incidentNextDueDate?: string | null;
  incidentAssignedUserId?: number | null;
  incidentAssignedAdvisor?: string | null;
  quoteCreatedBy?: string | null;
  confirmationPolicy?: 'documented' | 'legacy' | 'preapproved';
  confirmationPolicyAt?: string | null;
  preparation?: Preparation | null;
  yardPieceReady?: boolean;
  yardPieceReadyAt?: string | null;
  downpaymentVerified?: boolean;
  downpaymentVerifiedAt?: string | null;
  postDeliveryFinalized?: boolean;
  historicalDelivery?: { paidAt: string | null; readyAt: string | null; deliveredAt: string | null } | null;
}
export interface WorkflowEvent {
  id: string; task: WorkflowTaskKey; outcome: WorkflowOutcome | 'reopened';
  notes: string; evidence: string; actorId: number; actorName: string; createdAt: string;
  nextDueDate: string | null; nextAction: string | null; blockedBy: string | null;
  scheduledAt: string | null; contactResult: FollowupCallResult | null; partStatus: FollowupPartStatus | null;
  taskDueDate?: string | null;
  downpayment?: DownpaymentLine[] | null;
  preparation?: Preparation | null;
}
export interface WorkflowAction {
  communication?: import('./followupCommunication').FollowupCommunication;
  deliveryPhotos?: string[];
  task: WorkflowTaskKey; outcome: WorkflowOutcome; notes: string; evidence?: string; confirmed?: boolean;
  nextDueDate?: string | null; nextAction?: string | null; blockedBy?: string | null;
  scheduledAt?: string | null; contactResult?: FollowupCallResult | null; partStatus?: FollowupPartStatus | null;
  downpayment?: DownpaymentLine[];
  preparation?: Preparation;
  exemptDownpayment?: boolean;
}
export interface WorkflowTask {
  order: WorkflowOrder; task: WorkflowTaskKey; title: string; requirement: string;
  dueDate: string; nextAction: string; blockedBy: string | null;
  objectiveDueDate: string;
  bucket: 'overdue' | 'today' | 'upcoming' | 'waiting' | 'blocked';
  overdue: boolean; escalated: boolean; regularization: boolean;
  needsIncident: boolean;
  daysOverdue?: number;
  penaltyPoints?: number;
}
export function workflowTaskAssignee(order: WorkflowOrder, task: WorkflowTaskKey) {
  if (task === 'incident') {
    if (order.incidentAssignedUserId) return { userId: order.incidentAssignedUserId, name: order.incidentAssignedAdvisor || 'Operador asignado' };
  }
  if (order.deliveredAt && (task.startsWith('post_') || task === 'incident')) {
    if (order.followupUserId) return { userId: order.followupUserId, name: order.followupAdvisor || 'Asesor asignado' };
    if (order.isYardSale) return { userId: null, name: 'Pendiente de asignación' };
  }
  return { userId: order.userId, name: order.advisor };
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
export const confirmationPreapproved = (order: WorkflowOrder | undefined, events: WorkflowEvent[]) =>
  order?.confirmationPolicy === 'preapproved' && !events.some(event => event.outcome === 'reopened' && ['quote', 'ack'].includes(event.task));
export const completedWorkflowStages = (events: WorkflowEvent[], order?: WorkflowOrder) =>
  WORKFLOW_STAGES.filter(stage => order?.status === 'entregado' && order.historicalDelivery || stage.id === 'quote' || stage.id === 'ack' && confirmationPreapproved(order, events) ||
    effectiveWorkflowEvents(events).some(event => event.task === stage.id && event.outcome === 'completed')).map(stage => stage.id);

export function workflowTasks(order: WorkflowOrder, events: WorkflowEvent[], today = workflowDate(new Date())): WorkflowTask[] {
  if (!workflowRequired(order.createdAt) || ['cancelado', 'reembolsado', 'archivado'].includes(order.status)) return [];
  events = effectiveWorkflowEvents(events);
  let task: WorkflowTaskKey;
  let title: string;
  let requirement: string;
  let dueDate: string;
  const completed = completedWorkflowStages(events, order);
  const stage = WORKFLOW_STAGES.find(stage => !completed.includes(stage.id));
  const incident = ['reclamo', 'solicitud_reembolso'].includes(order.status);
  if (incident) {
    task = 'incident'; title = 'Dar seguimiento a la incidencia';
    requirement = 'Gestionar el caso en Reclamos o Reembolsos; registrar responsable y próxima revisión.';
    dueDate = order.incidentNextDueDate || addWorkingDays(workflowDate(order.incidentCreatedAt || order.createdAt), 1);
  } else if (stage) {
    task = stage.id; title = stage.title; requirement = stage.requirement;
    if (task === 'prepare' && order.yardPieceReady) {
      title = 'Pieza lista en patio · Notificar cliente y pasar a Listo para Retiro';
      requirement = 'Administración reportó pieza lista. Comunícate con el cliente para agendar retiro/despacho y pasar la orden a Listo para Retiro.';
    }
    const index = WORKFLOW_STAGES.indexOf(stage);
    const previous = index > 1 ? [...events].reverse().find(event => event.task === WORKFLOW_STAGES[index - 1].id && event.outcome === 'completed') : undefined;
    dueDate = previous?.nextDueDate || (task === 'delivery' && previous?.preparation
      ? previous.preparation.dateFrom : task === 'delivery' && previous?.scheduledAt
      ? workflowDate(previous.scheduledAt) : addWorkingDays(workflowDate(previous?.createdAt ||
        (task === 'prepare' && confirmationPreapproved(order, events) ? order.confirmationPolicyAt : null) || order.createdAt), 1));
  } else {
    if (!order.deliveredAt || order.postDeliveryFinalized) return [];
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
  if (latest?.nextDueDate && !(incident && order.incidentNextDueDate)) dueDate = latest.nextDueDate;
  const overdue = dueDate < today || objectiveDueDate < today;
  const escalated = addWorkingDays(objectiveDueDate, 1) <= today && latest?.outcome !== 'blocked';
  const bucket = latest?.outcome === 'blocked' ? 'blocked'
    : dueDate < today ? 'overdue' : dueDate === today ? 'today'
    : latest?.outcome === 'no_response' ? 'waiting' : 'upcoming';

  let daysOverdue = 0;
  let penaltyPoints = 0;
  if (task.startsWith('post_') && overdue) {
    const dueTime = new Date(`${dueDate}T00:00:00Z`).getTime();
    const todayTime = new Date(`${today}T00:00:00Z`).getTime();
    daysOverdue = Math.max(0, Math.round((todayTime - dueTime) / 86400000));
    penaltyPoints = -daysOverdue;
  }

  return [{
    order, task, title, requirement, dueDate, objectiveDueDate, nextAction: latest?.nextAction || requirement,
    blockedBy: latest?.blockedBy || null, bucket, overdue, escalated,
    needsIncident: incident || latest?.outcome === 'incident' || ['has_issues', 'defect_claim'].includes(latest?.partStatus || ''),
    regularization: Boolean(stage && order.status === 'entregado'),
    daysOverdue,
    penaltyPoints,
  }];
}

export function validateWorkflowAction(order: WorkflowOrder, events: WorkflowEvent[], action: WorkflowAction, today = workflowDate(new Date())) {
  const task = workflowTasks(order, events, today)[0];
  if (!task || task.task !== action.task) throw new Error('Debes gestionar la etapa pendiente; no se permiten saltos ni completar dos veces.');
  if (action.downpayment && (action.task !== 'ack' || action.outcome !== 'completed')) throw new Error('Los datos del depósito solo corresponden a una confirmación completada.');
  if (action.preparation && (action.task !== 'prepare' || action.outcome !== 'completed')) throw new Error('La preparación solo se adjunta al completar Preparación y cita.');
  if (action.task === 'ack' && action.outcome === 'completed') {
    if (action.exemptDownpayment) {
      if (action.nextDueDate || action.scheduledAt) throw new Error('La fecha de confirmación se registra automáticamente.');
      return;
    }
    const parsed = downpaymentSchema.safeParse(action.downpayment);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || 'Revisa los datos del downpayment.');
    validateDownpayment(order.paid, parsed.data);
    if (action.nextDueDate || action.scheduledAt) throw new Error('La fecha de confirmación se registra automáticamente.');
    return;
  }
  if (action.task === 'prepare' && action.outcome === 'completed') {
    const parsed = preparationSchema.safeParse(action.preparation);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || 'Revisa la preparación y cita.');
    validatePreparation(parsed.data, today);
    if (action.nextDueDate || action.scheduledAt) throw new Error('Usa las fechas acordadas de Preparación y cita.');
    return;
  }
  if (task.task === 'delivery' && action.outcome === 'completed' && action.deliveryPhotos !== undefined) {
    deliveryPhotosSchema.parse(action.deliveryPhotos);
    if (!action.confirmed) throw new Error('Confirma la entrega física y la comunicación de la garantía.');
    if (Math.round(order.paid * 100) !== Math.round(order.total * 100)) throw new Error('Liquida el saldo pendiente antes de completar la entrega.');
    return;
  }
  if (action.notes.trim().length < 5) throw new Error('Registra el detalle de la gestión (mínimo 5 caracteres).');
  if (task.task.startsWith('post_')) {
    if (!action.communication) throw new Error('Selecciona el canal y registra la comunicación con el cliente.');
    communicationSchema.parse(action.communication);
    const error = validateCommunication(action.communication, action.contactResult, action.partStatus, action.outcome);
    if (error) throw new Error(error);
  }
  if (action.outcome !== 'completed') {
    if (!action.nextAction?.trim()) throw new Error('Indica la próxima acción.');
    if (!action.nextDueDate || action.nextDueDate <= today) throw new Error('La próxima fecha debe ser posterior a hoy.');
    if (action.outcome === 'no_response' && action.nextDueDate !== addWorkingDays(today, 1)) throw new Error('El reintento corresponde al siguiente día hábil.');
    if (action.outcome === 'blocked' && !action.blockedBy?.trim()) throw new Error('Indica quién debe resolver el bloqueo.');
    if (action.outcome === 'no_response' && ['answered', 'sms_replied'].includes(action.contactResult || '')) throw new Error('El resultado de contacto contradice una gestión sin respuesta.');
    return;
  }
  if (task.task === 'incident') throw new Error('Cierra el caso desde Reclamos o Reembolsos, no desde el flujo.');
  if (!task.task.startsWith('post_') && (!action.evidence?.trim() || action.evidence.trim().length < 5)) throw new Error('La evidencia o referencia verificable es obligatoria.');
  if (!action.confirmed) throw new Error('Confirma que realizaste las verificaciones de esta etapa.');
  if (action.nextDueDate) throw new Error('Esta etapa no permite cambiar el plazo de la siguiente gestión.');
  if (action.scheduledAt && task.task !== 'post_3') throw new Error('Esta etapa no permite modificar una fecha acordada.');
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
