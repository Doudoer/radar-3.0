import { describe, expect, it } from 'vitest';
import {
  addWorkingDays, completedWorkflowStages, workflowRequired, workflowTasks, validateWorkflowAction,
  workflowDate, shiftWorkflowDate, type WorkflowOrder, type WorkflowEvent,
} from '../src/utils/orderWorkflow';

const order: WorkflowOrder = {
  id: '901', code: 'ORD-TEST', userId: 7, advisor: 'Operador', version: 1,
  createdAt: '2026-10-21T16:00:00Z', status: 'pagado', deliveredAt: null,
  scheduledPickupAt: null, total: 100, paid: 100,
};
const event = (task: WorkflowEvent['task'], overrides: Partial<WorkflowEvent> = {}): WorkflowEvent => ({
  id: '1', task, outcome: 'completed', notes: 'Confirmación documentada del cliente',
  evidence: 'Referencia verificable de la gestión', actorId: 7, actorName: 'Operador',
  createdAt: '2026-11-05T16:00:00Z', nextDueDate: null, nextAction: null,
  blockedBy: null, scheduledAt: null, contactResult: null, partStatus: null, ...overrides,
});
describe('verifiable order workflow', () => {
  it('covers October 21 inclusive, not earlier history', () => {
    expect(workflowRequired(order.createdAt)).toBe(true);
    expect(workflowRequired('2026-10-21T03:59:59Z')).toBe(false);
    expect(workflowRequired('2026-11-05T12:00:00Z')).toBe(true);
  });
  it('skips weekends for retries and escalations', () => {
    expect(addWorkingDays('2026-11-06', 1)).toBe('2026-11-09');
    expect(addWorkingDays('2026-11-07', 1)).toBe('2026-11-09');
    expect(addWorkingDays('2026-11-05', 2)).toBe('2026-11-09');
  });
  it('completes quotation at creation without completing later objectives from status', () => {
    expect(completedWorkflowStages([])).toEqual(['quote']);
    expect(workflowTasks({ ...order, status: 'cotizacion' }, [], '2026-10-21')[0]).toMatchObject({
      task: 'ack', dueDate: '2026-10-22',
    });
    const tasks = workflowTasks({ ...order, status: 'entregado', deliveredAt: '2026-11-01T12:00:00Z' }, [], '2026-11-05');
    expect(tasks[0].task).toBe('ack');
    expect(tasks[0].escalated).toBe(true);
    expect(tasks[0].regularization).toBe(true);
  });
  it('does not advance on no response, and retries the next business day', () => {
    const tasks = workflowTasks(order, [event('ack', {
      outcome: 'no_response', nextDueDate: '2026-11-09', nextAction: 'Llamar nuevamente',
    })], '2026-11-06');
    expect(tasks[0].task).toBe('ack');
    expect(tasks[0].bucket).toBe('waiting');
    expect(tasks[0].dueDate).toBe('2026-11-09');
  });
  it('separates external blocks from operator overdue escalation', () => {
    const tasks = workflowTasks(order, [event('ack', {
      outcome: 'blocked', blockedBy: 'Inventario', nextDueDate: '2026-11-06', nextAction: 'Verificar existencia',
    })], '2026-11-09');
    expect(tasks[0].bucket).toBe('blocked');
    expect(tasks[0].escalated).toBe(false);
    expect(tasks[0].overdue).toBe(true);
  });
  it('rejects skipping stages and missing evidence', () => {
    expect(() => validateWorkflowAction(order, [], { task: 'prepare', outcome: 'completed', notes: 'Confirmado', evidence: 'Referencia', confirmed: true }, '2026-11-05')).toThrow(/etapa/i);
    expect(() => validateWorkflowAction(order, [], { task: 'ack', outcome: 'completed', notes: 'Confirmado', evidence: '', confirmed: true }, '2026-11-05')).toThrow(/evidencia/i);
    expect(() => validateWorkflowAction(order, [], { task: 'quote', outcome: 'completed', notes: 'Duplicada', evidence: 'Referencia', confirmed: true }, '2026-11-05')).toThrow(/etapa/i);
  });
  it('requires a commitment date before preparation and an agreed delivery date', () => {
    expect(() => validateWorkflowAction(order, [event('quote')], { task: 'ack', outcome: 'completed', notes: 'Aceptado por el cliente', evidence: 'Conversación registrada', confirmed: true }, '2026-11-05')).toThrow(/fecha/i);
    const tasks = workflowTasks(order, [event('quote'), event('ack', { nextDueDate: '2026-11-09' })], '2026-11-05');
    expect(tasks[0].task).toBe('prepare');
    expect(tasks[0].dueDate).toBe('2026-11-09');
  });
  it('keeps completion distinct from the fourth active step', () => {
    const events = ['quote', 'ack', 'prepare', 'delivery'].map(task => event(task as WorkflowEvent['task']));
    expect(workflowTasks({ ...order, status: 'entregado', deliveredAt: '2026-11-05T16:00:00Z' }, events, '2026-11-05')[0].task).toBe('post_3');
  });
  it('schedules calendar-day 3/7/14 checks even after earlier installed-ok confirmation', () => {
    const events = ['quote', 'ack', 'prepare', 'delivery', 'post_3'].map(task => event(task as WorkflowEvent['task'], { partStatus: 'installed_ok', contactResult: 'answered' }));
    const tasks = workflowTasks({ ...order, status: 'entregado', deliveredAt: '2026-11-05T16:00:00Z' }, events, '2026-11-06');
    expect(tasks[0].task).toBe('post_7');
    expect(tasks[0].dueDate).toBe('2026-11-12');
  });
  it('does not permit delivered closure without liquidation or confirmed documentation', () => {
    const events = ['quote', 'ack', 'prepare'].map(task => event(task as WorkflowEvent['task']));
    expect(() => validateWorkflowAction({ ...order, paid: 20 }, events, { task: 'delivery', outcome: 'completed', notes: 'Entrega física confirmada', evidence: 'Comprobante registrado', confirmed: true }, '2026-11-05')).toThrow(/saldo/i);
    expect(() => validateWorkflowAction(order, events, { task: 'delivery', outcome: 'completed', notes: 'Entrega física confirmada', evidence: 'Comprobante registrado', confirmed: false }, '2026-11-05')).toThrow(/confirm/i);
  });
  it('never counts an unanswered message as customer confirmation', () => {
    const events = ['quote', 'ack', 'prepare', 'delivery'].map(task => event(task as WorkflowEvent['task']));
    expect(() => validateWorkflowAction({ ...order, status: 'entregado', deliveredAt: '2026-11-02T12:00:00Z' }, events, {
      task: 'post_3', outcome: 'completed', notes: 'Envié un mensaje', evidence: 'Mensaje enviado',
      confirmed: true, contactResult: 'sms_sent', partStatus: 'installed_ok',
    }, '2026-11-05')).toThrow(/respuesta/i);
  });
  it('keeps incidents in the queue and does not close them with a workflow checkbox', () => {
    expect(workflowTasks({ ...order, status: 'reclamo' }, [], '2026-11-05')[0].task).toBe('incident');
    expect(() => validateWorkflowAction({ ...order, status: 'reclamo' }, [], {
      task: 'incident', outcome: 'completed', notes: 'Caso revisado', evidence: 'Revisión', confirmed: true,
    }, '2026-11-05')).toThrow(/Reclamos|Reembolsos/);
  });
  it('does not forgive an overdue objective by recording another unanswered attempt', () => {
    const tasks = workflowTasks(order, [event('ack', { outcome: 'no_response', nextDueDate: '2026-11-06', nextAction: 'Reintentar' })], '2026-11-05');
    expect(tasks[0].bucket).toBe('waiting');
    expect(tasks[0].escalated).toBe(true);
  });
  it('reopens preparation and later milestones without erasing earlier audit evidence', () => {
    const events = ['quote', 'ack', 'prepare', 'delivery', 'post_3'].map(task => event(task as WorkflowEvent['task']));
    events.push(event('prepare', { outcome: 'reopened', nextDueDate: '2026-11-06', createdAt: '2026-11-05T16:00:00Z' }));
    const pending = workflowTasks({ ...order, status: 'en_preparacion', deliveredAt: '2026-11-01T16:00:00Z' }, events, '2026-11-05');
    expect(pending[0].task).toBe('prepare');
    expect(pending[0].dueDate).toBe('2026-11-06');
    expect(events).toHaveLength(6);
  });
  it('requires installation scheduling for the first customer receipt confirmation', () => {
    const stages = ['quote', 'ack', 'prepare', 'delivery'].map(task => event(task as WorkflowEvent['task']));
    expect(() => validateWorkflowAction({ ...order, status: 'entregado', deliveredAt: '2026-11-01T16:00:00Z' }, stages, {
      task: 'post_3', outcome: 'completed', notes: 'El cliente recibió la pieza', evidence: 'Respuesta del cliente',
      confirmed: true, contactResult: 'answered', partStatus: 'not_installed',
    }, '2026-11-05')).toThrow(/instalación/i);
  });
  it('requires confirmed operation by day 7 and day 14', () => {
    const stages = ['quote', 'ack', 'prepare', 'delivery', 'post_3'].map(task => event(task as WorkflowEvent['task']));
    expect(() => validateWorkflowAction({ ...order, status: 'entregado', deliveredAt: '2026-10-28T16:00:00Z' }, stages, {
      task: 'post_7', outcome: 'completed', notes: 'Continúa en montaje', evidence: 'Cliente confirma montaje',
      confirmed: true, contactResult: 'answered', partStatus: 'in_process',
    }, '2026-11-05')).toThrow(/objetivo|funcionamiento/i);
  });
  it('validates retry dates, next actions and external ownership without changing stages', () => {
    const action = { task: 'ack' as const, outcome: 'no_response' as const, notes: 'No contestó', nextAction: 'Llamar otra vez', nextDueDate: '2026-11-06' };
    expect(() => validateWorkflowAction(order, [], action, '2026-11-05')).not.toThrow();
    expect(() => validateWorkflowAction(order, [], { ...action, nextAction: '' }, '2026-11-05')).toThrow(/acción/);
    expect(() => validateWorkflowAction(order, [], { ...action, nextDueDate: null }, '2026-11-05')).toThrow(/fecha/);
    expect(() => validateWorkflowAction(order, [], { ...action, nextDueDate: '2026-11-05' }, '2026-11-05')).toThrow(/fecha/);
    expect(() => validateWorkflowAction(order, [], { ...action, nextDueDate: '2026-11-07' }, '2026-11-05')).toThrow(/hábil/);
    expect(() => validateWorkflowAction(order, [], { ...action, outcome: 'blocked' }, '2026-11-05')).toThrow(/bloqueo/);
    expect(() => validateWorkflowAction(order, [], { ...action, outcome: 'blocked', blockedBy: 'Cliente' }, '2026-11-05')).not.toThrow();
    expect(() => validateWorkflowAction(order, [], { ...action, notes: 'No' }, '2026-11-05')).toThrow(/detalle/);
  });
  it('requires a deposit and a valid appointment, but permits documenting a delivered historical appointment', () => {
    const base = { outcome: 'completed' as const, notes: 'Confirmed objective', evidence: 'Verified reference', confirmed: true };
    const stages = [event('quote'), event('ack')];
    expect(() => validateWorkflowAction({ ...order, paid: 0 }, [event('quote')], { ...base, task: 'ack', nextDueDate: '2026-11-06' }, '2026-11-05')).toThrow(/abono/);
    for (const scheduledAt of [undefined, 'bad-date', '2026-11-04T16:00:00Z']) {
      expect(() => validateWorkflowAction(order, stages, { ...base, task: 'prepare', scheduledAt }, '2026-11-05')).toThrow(/fecha|cita/);
    }
    expect(() => validateWorkflowAction({ ...order, deliveredAt: '2026-11-01T16:00:00Z' }, stages, { ...base, task: 'prepare', scheduledAt: '2026-11-01T16:00:00Z' }, '2026-11-05')).not.toThrow();
  });
  it('completes all calendar checkpoints only with their objective and actual customer response', () => {
    const delivered = { ...order, status: 'entregado' as const, deliveredAt: '2026-10-21T16:00:00Z' };
    const stages = ['quote', 'ack', 'prepare', 'delivery', 'post_3', 'post_7'].map(task => event(task as WorkflowEvent['task']));
    const action = { task: 'post_14' as const, outcome: 'completed' as const, notes: 'Client confirms satisfaction', evidence: 'Conversation reference', confirmed: true, contactResult: 'answered' as const, partStatus: 'installed_ok' as const };
    expect(workflowTasks(delivered, stages, '2026-11-04')[0].bucket).toBe('today');
    expect(() => validateWorkflowAction(delivered, stages, action, '2026-11-04')).not.toThrow();
    expect(() => validateWorkflowAction(delivered, stages, { ...action, partStatus: 'has_issues' }, '2026-11-04')).toThrow(/objetivo/);
    expect(workflowTasks(delivered, [...stages, event('post_14')], '2026-11-05')).toEqual([]);
    expect(workflowTasks({ ...delivered, deliveredAt: null }, stages, '2026-11-05')).toEqual([]);
    expect(workflowTasks({ ...order, status: 'cancelado' }, [], '2026-11-05')).toEqual([]);
    expect(workflowTasks({ ...order, createdAt: '2026-10-20T16:00:00Z' }, [], '2026-11-05')).toEqual([]);
  });
  it('distinguishes business dates across DST and rejects invalid timestamps', () => {
    expect(workflowDate('2026-11-05T04:59:59Z')).toBe('2026-11-04');
    expect(workflowDate('2026-11-05T05:00:00Z')).toBe('2026-11-05');
    expect(() => workflowDate('invalid')).toThrow(/Fecha/);
    expect(() => shiftWorkflowDate('invalid', 1)).toThrow(/Fecha/);
  });
  it('does not allow a review date to pull a calendar checkpoint forward', () => {
    const delivered = { ...order, status: 'entregado' as const, deliveredAt: '2026-11-05T16:00:00Z' };
    const stages = ['quote', 'ack', 'prepare', 'delivery'].map(task => event(task as WorkflowEvent['task']));
    stages.push(event('post_3', { outcome: 'blocked', nextDueDate: '2026-11-06', blockedBy: 'Taller' }));
    expect(() => validateWorkflowAction(delivered, stages, {
      task: 'post_3', outcome: 'completed', notes: 'Customer confirmed reception', evidence: 'Conversation reference',
      confirmed: true, contactResult: 'answered', partStatus: 'installed_ok',
    }, '2026-11-06')).toThrow(/todavía/);
  });
  it('does not let callers postpone the initial confirmation SLA or contradict a no-response result', () => {
    expect(() => validateWorkflowAction(order, [event('ack')], {
      task: 'prepare', outcome: 'completed', notes: 'Preparación verificada', evidence: 'Referencia verificada',
      confirmed: true, nextDueDate: '2027-01-01',
    }, '2026-11-05')).toThrow(/fecha|plazo/);
    expect(() => validateWorkflowAction(order, [], {
      task: 'ack', outcome: 'no_response', notes: 'No respondió', nextDueDate: '2026-11-06', nextAction: 'Reintentar',
      contactResult: 'answered',
    }, '2026-11-05')).toThrow(/respuesta|contradictorio/);
  });
  it('keeps quotation automatic after reopening and ignores obsolete quotation retry deadlines', () => {
    const reopened = [event('ack'), event('quote', { outcome: 'reopened', nextDueDate: '2026-11-06' })];
    expect(completedWorkflowStages(reopened)).toEqual(['quote']);
    expect(workflowTasks(order, reopened, '2026-11-05')[0]).toMatchObject({ task: 'ack', dueDate: '2026-11-06' });
    expect(workflowTasks(order, [event('quote', { outcome: 'no_response', nextDueDate: '2027-01-01' })], '2026-11-05')[0])
      .toMatchObject({ task: 'ack', objectiveDueDate: '2026-10-22' });
    expect(workflowTasks(order, [event('quote', { createdAt: '2026-11-05T16:00:00Z' })], '2026-11-05')[0].objectiveDueDate).toBe('2026-10-22');
  });
});
