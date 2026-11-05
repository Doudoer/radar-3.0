import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../services/apiFetch';
import {
  addWorkingDays, completedWorkflowStages, WORKFLOW_STAGES, workflowDate,
  type WorkflowAction, type WorkflowEvent, type WorkflowOrder, type WorkflowTask,
} from '../utils/orderWorkflow';
import { ORDER_STATUS_LABELS } from '../utils/orderStatusRules';
import { emptySettlement, settlementSchema, type Settlement } from '../utils/orderPayments';
import { OrderPaymentFields, usePaymentDetail } from './OrderPayments';

export interface WorkflowDetail {
  order: WorkflowOrder; required: boolean; events: WorkflowEvent[]; tasks: WorkflowTask[];
  contacts?: { id: string; actor: string; notes: string; createdAt: string }[];
}
export const workflowResponse = async <T,>(response: Response): Promise<T> => {
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'No se pudo cargar el flujo de órdenes.');
  return data;
};
export const WorkflowActionForm: React.FC<{
  task: WorkflowTask; onSaved: () => Promise<void>; onCancel?: () => void;
}> = ({ task, onSaved, onCancel }) => {
  const today = workflowDate(new Date());
  const [outcome, setOutcome] = useState<WorkflowAction['outcome']>(task.task === 'incident' ? 'blocked' : 'completed');
  const [notes, setNotes] = useState('');
  const [evidence, setEvidence] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [nextAction, setNextAction] = useState('');
  const [nextDueDate, setNextDueDate] = useState(addWorkingDays(today, 1));
  const [blockedBy, setBlockedBy] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [contactResult, setContactResult] = useState<'answered' | 'sms_replied'>('answered');
  const [partStatus, setPartStatus] = useState<'not_installed' | 'in_process' | 'installed_ok' | 'has_issues' | 'defect_claim'>('not_installed');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const completed = outcome === 'completed';
  const postDelivery = task.task.startsWith('post_');
  const [settlement, setSettlement] = useState(emptySettlement);
  const [paymentsVerified, setPaymentsVerified] = useState(false);
  const deliverySettlement = task.task === 'delivery' && completed;
  const { detail: paymentDetail, error: paymentError, reload: reloadPayments } = usePaymentDetail(task.order.id, task.order.version, deliverySettlement);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try {
      let verifiedSettlement: Settlement | undefined;
      if (deliverySettlement) {
        if (!paymentDetail) throw new Error(paymentError || 'Espera a que se carguen los cobros.');
        const parsed = settlementSchema.safeParse(settlement);
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || 'Revisa los pagos.');
        if (settlement.payments.length && !paymentsVerified) throw new Error('Confirma que verificaste la recepción de todos los pagos.');
        verifiedSettlement = parsed.data;
      }
      const action: WorkflowAction & { version: number; settlement?: Settlement } = {
        task: task.task, version: task.order.version, outcome, notes,
        evidence: completed ? evidence : undefined, confirmed: completed ? confirmed : false,
        nextAction: completed ? undefined : nextAction,
        nextDueDate: outcome === 'no_response' ? addWorkingDays(today, 1) : !completed || task.task === 'ack' ? nextDueDate : undefined,
        blockedBy: outcome === 'blocked' ? blockedBy : undefined,
        scheduledAt: completed && (task.task === 'prepare' || task.task === 'post_3' && partStatus === 'not_installed') && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        contactResult: postDelivery ? (outcome === 'no_response' ? 'no_answer' : contactResult) : undefined,
        partStatus: postDelivery ? partStatus : undefined,
        settlement: verifiedSettlement,
      };
      const saved = await workflowResponse<{ version: number; eventId: string }>(await apiFetch(`/orders/${task.order.id}/workflow`, { method: 'POST', body: JSON.stringify(action) }));
      if (saved.version !== task.order.version + 1 || !saved.eventId) throw new Error('Respuesta de guardado inválida; recarga para comprobar el registro antes de reintentar.');
      window.dispatchEvent(new Event('radar:data-changed'));
      window.dispatchEvent(new CustomEvent('radar:followup-updated', { detail: { orderId: task.order.id } }));
      await onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se guardó la gestión.'); }
    finally { saving.current = false; setBusy(false); }
  };
  const field = 'flex flex-col gap-2 text-sm font-medium';
  return <form onSubmit={submit} className="horizon-workflow-form space-y-4">
    <h3 className="text-lg font-bold">{task.title} · {task.order.code}</h3>
    <p className="text-sm text-[var(--text-secondary)]">{task.requirement}</p>
    <p className="text-sm">Estado logístico: {ORDER_STATUS_LABELS[task.order.status]}. {task.task === 'delivery' && 'La pieza debe estar lista para retiro, despacho o en camino; cambia el estado logístico desde la orden si corresponde.'}</p>
    {task.regularization && <p className="text-sm text-amber-600">Orden ya entregada: documenta la gestión histórica real. No se cambiará su fecha de entrega.</p>}
    <label className={field}>Resultado
      <select value={outcome} onChange={event => setOutcome(event.target.value as WorkflowAction['outcome'])}>
        {task.task !== 'incident' && <option value="completed">Objetivo confirmado con evidencia</option>}
        <option value="no_response">Sin respuesta · reintentar</option>
        <option value="blocked">Bloqueada por un tercero</option>
        <option value="incident">Incidencia · requiere gestión del caso</option>
      </select>
    </label>
    {deliverySettlement && <div className="space-y-4">
      {paymentError ? <><p role="alert" className="text-red-600">{paymentError}</p><button type="button" onClick={reloadPayments}>Recargar cobros</button></>
        : !paymentDetail ? <p role="status">Cargando cobros…</p> : <OrderPaymentFields detail={paymentDetail} value={settlement} onChange={value => { setSettlement(value); setPaymentsVerified(false); }} disabled={busy} />}
      {settlement.payments.length > 0 && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={paymentsVerified} onChange={event => setPaymentsVerified(event.target.checked)} />Verifiqué la recepción de todos los pagos indicados.</label>}
    </div>}
    <label className={field}>Detalle de la gestión
      <textarea required minLength={5} maxLength={5000} rows={3} value={notes} onChange={event => setNotes(event.target.value)} />
    </label>
    {completed ? <>
      <label className={field}>Evidencia o referencia verificable
        <textarea required minLength={5} maxLength={5000} rows={2} placeholder="Referencia del mensaje, comprobante o conversación; indica qué confirmó el cliente." value={evidence} onChange={event => setEvidence(event.target.value)} />
      </label>
      {task.task === 'ack' && <label className={field}>Fecha comprometida de preparación
        <input required type="date" min={today} value={nextDueDate} onChange={event => setNextDueDate(event.target.value)} />
      </label>}
      {(task.task === 'prepare' || task.task === 'post_3' && partStatus === 'not_installed') && <label className={field}>
        {task.task === 'prepare' ? 'Retiro o entrega acordada (hora local)' : 'Fecha de instalación acordada (hora local)'}
        <input required type="datetime-local" value={scheduledAt} onChange={event => setScheduledAt(event.target.value)} />
      </label>}
      <label className="flex items-start gap-2 text-sm">
        <input required type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
        <span>Confirmo que realicé las verificaciones indicadas. {task.task === 'delivery' && 'La entrega fue física, el comprobante está registrado y se comunicó la garantía.'}</span>
      </label>
    </> : <>
      <label className={field}>Próxima acción<input required maxLength={1000} value={nextAction} onChange={event => setNextAction(event.target.value)} /></label>
      <label className={field}>Próxima revisión
        <input required type="date" min={addWorkingDays(today, 1)} value={outcome === 'no_response' ? addWorkingDays(today, 1) : nextDueDate} readOnly={outcome === 'no_response'} onChange={event => setNextDueDate(event.target.value)} />
      </label>
      {outcome === 'blocked' && <label className={field}>Quién debe resolver el bloqueo<input required maxLength={200} value={blockedBy} onChange={event => setBlockedBy(event.target.value)} placeholder="Inventario, administración, transporte, cliente…" /></label>}
      {outcome === 'incident' && <p role="note" className="text-sm text-amber-600">Este registro no crea ni resuelve un reclamo o reembolso. Gestiona también el caso desde su vista correspondiente.</p>}
    </>}
    {postDelivery && outcome !== 'no_response' && <div className="grid gap-4 sm:grid-cols-2">
      <label className={field}>Respuesta del cliente<select value={contactResult} onChange={event => setContactResult(event.target.value as typeof contactResult)}><option value="answered">Contestó la llamada</option><option value="sms_replied">Respondió al mensaje</option></select></label>
      <label className={field}>Estado de la pieza<select value={partStatus} onChange={event => setPartStatus(event.target.value as typeof partStatus)}>
        <option value="not_installed">No instalada</option><option value="in_process">En montaje</option><option value="installed_ok">Instalada y funcionando</option><option value="has_issues">Con observaciones</option><option value="defect_claim">Posible defecto</option>
      </select></label>
    </div>}
    {error && <p role="alert" className="text-sm text-red-600">{error} Si la orden cambió, cancela y recarga antes de reintentar.</p>}
    <div className="flex flex-wrap gap-3">
      <button type="submit" disabled={busy} className="horizon-primary rounded-xl px-4 py-2.5 font-bold">{busy ? 'Registrando…' : 'Registrar gestión'}</button>
      {onCancel && <button type="button" disabled={busy} onClick={onCancel} className="cyber-btn-secondary px-4 py-2">Cancelar</button>}
    </div>
  </form>;
};
export const OrderQuotationSummary: React.FC<{ order: WorkflowOrder }> = ({ order }) => <>
  <p className="text-sm mt-2" style={{ color: 'var(--positive)' }}>Completada al crear la orden</p>
  <dl className="text-sm mt-2 space-y-2">
    <div><dt>Fecha de creación de la cotización</dt><dd><time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleString('es', { timeZone: 'America/New_York' })}</time></dd></div>
    <div><dt>Agente que atendió</dt><dd>{order.quoteCreatedBy || 'No registrado'}</dd></div>
  </dl>
</>;
export const OrderWorkflowPanel: React.FC<{ orderId: string }> = ({ orderId }) => {
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    setError('');
    try {
      const data = await workflowResponse<WorkflowDetail>(await apiFetch(`/orders/${orderId}/workflow`));
      if (request === generation.current) setDetail(data);
    } catch (reason) {
      if (request === generation.current) { setDetail(null); setError(reason instanceof Error ? reason.message : 'No se pudo cargar el flujo.'); }
    }
  }, [orderId]);
  useEffect(() => {
    setDetail(null); void reload();
    return () => { generation.current++; };
  }, [reload]);
  const completed = completedWorkflowStages(detail?.events || []);
  const task = detail?.tasks[0];
  return <section className="horizon-view-card horizon-workflow-panel space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-bold">Flujo verificable de la orden</h2>
      <button type="button" onClick={() => void reload()} className="cyber-btn-secondary px-3 py-2">Recargar flujo</button>
    </div>
    {error ? <p role="alert" className="text-red-600">{error}</p> : !detail ? <p role="status">Cargando flujo…</p> : <>
      <ol className="horizon-workflow-stages grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {WORKFLOW_STAGES.map(stage => <li key={stage.id} className="rounded-2xl p-4 bg-[var(--bg-card-subtle)]" aria-current={task?.task === stage.id ? 'step' : undefined}>
          <strong>{stage.title}</strong>
          {stage.id === 'quote' ? <OrderQuotationSummary order={detail.order} />
            : <p className="text-sm mt-2" style={{ color: completed.includes(stage.id) ? 'var(--positive)' : 'var(--text-secondary)' }}>{completed.includes(stage.id) ? 'Completada con evidencia' : 'Pendiente de verificar'}</p>}
        </li>)}
      </ol>
      {task ? <WorkflowActionForm key={`${orderId}-${detail.order.version}-${task.task}`} task={task} onSaved={reload} />
        : <p className="text-sm text-[var(--text-secondary)]">Sin tarea activa. Las incidencias y los estados finales se gestionan en sus vistas.</p>}
      <h3 className="font-bold">Historial de gestiones</h3>
      {!detail.events.length && <p className="text-sm text-[var(--text-secondary)]">Cotización registrada al crear la orden. Aún no hay gestiones de las etapas siguientes.</p>}
      <div className="space-y-3">{[...detail.events].reverse().map(event => <article key={event.id} className="rounded-xl bg-[var(--bg-card-subtle)] p-4 text-sm space-y-2">
        <strong>{event.actorName} · {event.task} · {event.outcome}</strong>
        <p>{new Date(event.createdAt).toLocaleString()}</p><p className="whitespace-pre-wrap">{event.notes}</p>
        {event.evidence && <p className="whitespace-pre-wrap">Evidencia: {event.evidence}</p>}
        {event.nextAction && <p>Próxima acción: {event.nextAction} · {event.nextDueDate}</p>}
        {event.blockedBy && <p>Responsable del bloqueo: {event.blockedBy}</p>}
      </article>)}</div>
      {Boolean(detail.contacts?.length) && <div className="space-y-3">
        <h3 className="font-bold">Registros de contacto post-entrega</h3>
        <p className="text-sm text-[var(--text-secondary)]">Se conserva el historial anterior. Un contacto por sí solo no completa una etapa.</p>
        {detail.contacts?.map(contact => <article key={contact.id} className="rounded-xl bg-[var(--bg-card-subtle)] p-4 text-sm">
          <strong>{contact.actor} · {new Date(contact.createdAt).toLocaleString()}</strong><p className="whitespace-pre-wrap">{contact.notes}</p>
        </article>)}
      </div>}
    </>}
  </section>;
};
