import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../services/apiFetch';
import {
  addWorkingDays, completedWorkflowStages, confirmationPreapproved, WORKFLOW_STAGES, workflowDate,
  type WorkflowAction, type WorkflowEvent, type WorkflowOrder, type WorkflowTask, type WorkflowStage,
} from '../utils/orderWorkflow';
import { ORDER_STATUS_LABELS } from '../utils/orderStatusRules';
import { emptySettlement, settlementSchema, type Settlement } from '../utils/orderPayments';
import { OrderPaymentFields, usePaymentDetail } from './OrderPayments';
import { DOWNPAYMENT_METHODS, downpaymentSchema, validateDownpayment, type DownpaymentLine } from '../utils/downpaymentConfirmation';
import { DownpaymentFields, uploadDownpaymentReceipt } from './DownpaymentConfirmation';
import { PreparationFields } from './OrderPreparation';
import { emptyPreparation, preparationSchema, type Preparation } from '../utils/orderPreparation';
import { OrderDeliveryFields, OrderImageFields } from './OrderDeliveryFields';
import { readDeliveryPhotos } from '../utils/orderDelivery';
import { decodeCommunicationEvidence, followupTemplate, hasContactResponse, validateCommunication, type FollowupCommunication } from '../utils/followupCommunication';
import type { FollowupCallResult } from '../types';
import { warrantyDeadline } from '../utils/aftersales';

export interface WorkflowDetail {
  order: WorkflowOrder; required: boolean; events: WorkflowEvent[]; tasks: WorkflowTask[];
  contacts?: { id: string; actor: string; notes: string; createdAt: string }[];
}
export const workflowResponse = async <T,>(response: Response): Promise<T> => {
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'No se pudo cargar el flujo de órdenes.');
  return data;
};
export const HistoricalWorkflowStage: React.FC<{ order: WorkflowOrder; stage: Exclude<WorkflowStage, 'quote'> }> = ({ order, stage }) => {
  const history = order.historicalDelivery;
  if (!history) return null;
  const date = stage === 'ack' ? history.paidAt : stage === 'prepare' ? history.readyAt : history.deliveredAt;
  return <div className="text-sm mt-2 space-y-1">
    <p style={{ color: 'var(--positive)' }}>{stage === 'prepare' ? 'Regularizada por entrega histórica' : 'Completada según historial'}</p>
    <p>{stage === 'ack' ? 'Fecha del estado Pagado' : stage === 'prepare' ? 'Fecha de pieza lista registrada' : 'Fecha y hora de entrega'}</p>
    {date ? <time dateTime={date}>{new Date(date).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'medium' })}</time> : <p>Fecha no registrada en el historial.</p>}
    {stage === 'prepare' && <p>La orden ya consta como entregada; no se inventan llamadas, citas ni capturas anteriores.</p>}
  </div>;
};
const DownpaymentConfirmationForm: React.FC<{
  task: WorkflowTask; onSaved: () => Promise<void>; onCancel?: () => void;
}> = ({ task, onSaved, onCancel }) => {
  const [lines, setLines] = useState<DownpaymentLine[]>([{ method: 'cash', amount: task.order.paid, receivedBy: '', receipt: null }]);
  const [uploading, setUploading] = useState(false);
  const uploadInFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving.current || uploadInFlight.current) return;
    saving.current = true; setBusy(true); setError('');
    try {
      const parsed = downpaymentSchema.safeParse(lines);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || 'Revisa los datos del downpayment.');
      const downpayment = parsed.data;
      validateDownpayment(task.order.paid, downpayment);
      const saved = await workflowResponse<{ version: number; eventId: string }>(await apiFetch(`/orders/${task.order.id}/workflow`, {
        method: 'POST', body: JSON.stringify({ task: 'ack', outcome: 'completed', version: task.order.version, downpayment }),
      }));
      if (saved.version !== task.order.version + 1 || !saved.eventId) throw new Error('Respuesta inválida; recarga para comprobar antes de reintentar.');
      window.dispatchEvent(new Event('radar:data-changed'));
      window.dispatchEvent(new CustomEvent('radar:followup-updated', { detail: { orderId: task.order.id } }));
      await onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se guardó la confirmación.'); }
    finally { saving.current = false; setBusy(false); }
  };
  return <form onSubmit={submit} className="horizon-workflow-form space-y-4">
    <h3 className="text-lg font-bold">Confirmación · {task.order.code}</h3>
    <DownpaymentFields paid={task.order.paid} value={lines} onChange={setLines} disabled={busy}
      onUpload={file => uploadDownpaymentReceipt(task.order.id, file)} onUploadingChange={value => { uploadInFlight.current = value; setUploading(value); }} />
    {task.order.paid <= 0 && <p role="alert" className="text-sm text-amber-600">Primero registra el abono desde Registrar cobro. Aquí no se agrega dinero nuevo.</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <div className="flex flex-wrap gap-3">
      <button type="submit" className="cyber-btn-primary px-4 py-3" disabled={busy || uploading || task.order.paid <= 0}>{busy ? 'Guardando…' : 'Guardar confirmación'}</button>
      {onCancel && <button type="button" className="cyber-btn-secondary px-4 py-3" disabled={busy || uploading} onClick={onCancel}>Cancelar</button>}
    </div>
  </form>;
};
export const WorkflowActionForm: React.FC<{
  task: WorkflowTask; onSaved: () => Promise<void>; onCancel?: () => void;
}> = props => props.task.task === 'ack'
  ? <DownpaymentConfirmationForm {...props} /> : <WorkflowManagementForm {...props} />;
const WorkflowManagementForm: React.FC<{
  task: WorkflowTask; onSaved: () => Promise<void>; onCancel?: () => void;
}> = ({ task, onSaved, onCancel }) => {
  const today = workflowDate(new Date());
  const [outcome, setOutcome] = useState<WorkflowAction['outcome']>(task.task === 'incident' ? 'blocked' : 'completed');
  const [notes, setNotes] = useState('');
  const [evidence, setEvidence] = useState('');
  const [deliveryPhotos, setDeliveryPhotos] = useState<string[]>([]);
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [nextAction, setNextAction] = useState('');
  const [nextDueDate, setNextDueDate] = useState(addWorkingDays(today, 1));
  const [blockedBy, setBlockedBy] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [preparation, setPreparation] = useState(emptyPreparation);
  const [uploading, setUploading] = useState(false);
  const uploadInFlight = useRef(false);
  const [contactResult, setContactResult] = useState<FollowupCallResult>('answered');
  const [channel, setChannel] = useState<FollowupCommunication['channel']>('call');
  const [warrantyWarningGiven, setWarrantyWarningGiven] = useState(false);
  const [templateLanguage, setTemplateLanguage] = useState<'es' | 'en'>(task.order.customerLanguage || 'es');
  const [copied, setCopied] = useState(false);
  const [partStatus, setPartStatus] = useState<'not_installed' | 'in_process' | 'installed_ok' | 'has_issues' | 'defect_claim'>('not_installed');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const completed = outcome === 'completed';
  const postDelivery = task.task.startsWith('post_');
  const directContact = hasContactResponse(contactResult);
  const changeContact = (result: FollowupCallResult) => {
    setContactResult(result); setWarrantyWarningGiven(false); setConfirmed(false);
    if (!hasContactResponse(result)) setOutcome(result === 'wrong_number' ? 'blocked' : 'no_response');
    else if (outcome === 'no_response') setOutcome('completed');
  };
  const template = followupTemplate(task.task, templateLanguage, task.order.customerName || 'Cliente', task.order.code, task.order.warrantyTerms);
  const initialSettlement = (): Settlement => {
    const plan = task.order.preparation?.corePlan;
    if (plan === 'pay_core') {
      const defaultAmount = (task.order.core || 0) > 0 ? task.order.core! : 150;
      return {
        payments: [],
        coreAction: (task.order.core || 0) > 0 ? 'keep' : 'charge',
        coreAmount: defaultAmount,
        coreReference: '',
        coreConfirmed: false,
      };
    }
    return emptySettlement();
  };
  const [settlement, setSettlement] = useState(initialSettlement);
  const [paymentsVerified, setPaymentsVerified] = useState(false);
  const deliverySettlement = task.task === 'delivery' && completed;
  const { detail: paymentDetail, error: paymentError, reload: reloadPayments } = usePaymentDetail(task.order.id, task.order.version, deliverySettlement);

  useEffect(() => {
    if (!deliverySettlement || !paymentDetail) return;
    const plan = task.order.preparation?.corePlan || paymentDetail.preparationPlan;
    if (plan === 'pay_core') {
      setSettlement(prev => {
        if (prev.coreAction === 'keep' && paymentDetail.order.core === 0 && !prev.coreAmount) {
          return {
            ...prev,
            coreAction: 'charge',
            coreAmount: 150,
          };
        }
        return prev;
      });
    }
  }, [deliverySettlement, paymentDetail, task.order.preparation?.corePlan]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving.current || uploadInFlight.current) return;
    saving.current = true; setBusy(true); setError('');
    try {
      if (postDelivery) {
        const communicationError = validateCommunication({ channel, warrantyWarningGiven }, contactResult, directContact ? partStatus : null, outcome);
        if (communicationError) throw new Error(communicationError);
      }
      let verifiedSettlement: Settlement | undefined;
      let verifiedPreparation: Preparation | undefined;
      if (completed && task.task === 'prepare') {
        const parsed = preparationSchema.safeParse(preparation);
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || 'Revisa la preparación y cita.');
        verifiedPreparation = parsed.data;
      }
      if (deliverySettlement) {
        if (!paymentDetail) throw new Error(paymentError || 'Espera a que se carguen los cobros.');
        const parsed = settlementSchema.safeParse(settlement);
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || 'Revisa los pagos.');
        if (settlement.payments.length && !paymentsVerified) throw new Error('Confirma que verificaste la recepción de todos los pagos.');
        verifiedSettlement = parsed.data;
      }
      const action: WorkflowAction & { version: number; settlement?: Settlement } = {
        task: task.task, version: task.order.version, outcome, notes: deliverySettlement ? '' : notes,
        deliveryPhotos: deliverySettlement ? deliveryPhotos : undefined,
        evidence: completed && !postDelivery && task.task !== 'prepare' ? evidence : undefined, confirmed: completed && task.task !== 'prepare' ? confirmed : false,
        nextAction: completed ? undefined : nextAction,
        nextDueDate: outcome === 'no_response' ? addWorkingDays(today, 1) : !completed ? nextDueDate : undefined,
        blockedBy: outcome === 'blocked' ? blockedBy : undefined,
        scheduledAt: completed && task.task === 'post_3' && partStatus === 'not_installed' && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        contactResult: postDelivery ? contactResult : undefined,
        partStatus: postDelivery && directContact ? partStatus : undefined,
        communication: postDelivery ? { channel, warrantyWarningGiven: directContact && warrantyWarningGiven, ...(channel !== 'call' ? { screenshots } : {}) } : undefined,
        settlement: verifiedSettlement,
        preparation: verifiedPreparation,
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
    {task.task !== 'delivery' && <p className="text-sm">Estado logístico: {ORDER_STATUS_LABELS[task.order.status]}.</p>}
    {task.regularization && <p className="text-sm text-amber-600">Orden ya entregada: documenta la gestión histórica real. No se cambiará su fecha de entrega.</p>}
    {postDelivery && <section className="rounded-xl bg-[var(--bg-card-subtle)] p-4 space-y-4">
      <label className={field}>Canal de comunicación<select disabled={busy || uploading} value={channel} onChange={event => {
        const next = event.target.value as FollowupCommunication['channel'];
        setChannel(next); setScreenshots([]); changeContact(next === 'call' ? 'answered' : 'sms_replied'); setCopied(false);
      }}><option value="call">Llamada</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option></select></label>
      <label className={field}>Respuesta del cliente<select disabled={busy} value={contactResult} onChange={event => changeContact(event.target.value as FollowupCallResult)}>
        {channel === 'call' ? <><option value="answered">Contestó la llamada</option><option value="no_answer">No contestó / buzón</option><option value="busy">Ocupado</option></>
          : <><option value="sms_replied">Respondió al mensaje</option><option value="sms_sent">Enviado · esperando respuesta</option><option value="sms_no_reply">Mensaje sin respuesta</option></>}
        <option value="wrong_number">Número incorrecto</option>
      </select></label>
      {!directContact && <p className="text-sm">Solo se registra el intento. No se confirma el estado de la pieza ni se modifica la garantía.
        {contactResult === 'wrong_number' ? ' Indica quién conseguirá el teléfono actualizado.' : ' Reintento al siguiente día hábil.'}</p>}
      {channel !== 'call' && <details className="space-y-3"><summary className="cursor-pointer font-semibold">Plantilla de seguimiento</summary>
        <label className={field}>Idioma de la plantilla<select value={templateLanguage} onChange={event => { setTemplateLanguage(event.target.value as 'es' | 'en'); setCopied(false); }}>
          <option value="es">Español</option><option value="en">English</option></select></label>
        <p className="text-sm whitespace-pre-wrap">{template}</p>
        <button type="button" className="cyber-btn-secondary px-3 py-2" onClick={() => {
          void navigator.clipboard.writeText(template).then(() => setCopied(true)).catch(() => setError('No se pudo copiar la plantilla. Selecciona el texto y cópialo manualmente.'));
        }}>Copiar plantilla</button>
        {copied && <p role="status">Plantilla copiada. Esto no registra un envío ni una respuesta.</p>}
      </details>}
      {channel !== 'call' && <OrderImageFields onUpload={file => uploadDownpaymentReceipt(task.order.id, file)} photos={screenshots} onChange={setScreenshots}
        label="Capturas de la conversación (opcional)" description="Puedes registrar la gestión sin capturas o adjuntar una o varias imágenes de WhatsApp o SMS."
        imageLabel="Ver captura de conversación" disabled={busy}
        onUploadingChange={value => { uploadInFlight.current = value; setUploading(value); }} />}
    </section>}
    {task.task !== 'delivery' && <label className={field}>Resultado
      <select disabled={busy || uploading} value={outcome} onChange={event => setOutcome(event.target.value as WorkflowAction['outcome'])}>
        {task.task !== 'incident' && <option value="completed" disabled={postDelivery && !directContact}>{postDelivery ? 'Objetivo confirmado por el cliente' : 'Objetivo confirmado con evidencia'}</option>}
        <option value="no_response" disabled={postDelivery && (directContact || contactResult === 'wrong_number')}>Sin respuesta · reintentar</option>
        <option value="blocked">Bloqueada por un tercero</option>
        <option value="incident">Incidencia · requiere gestión del caso</option>
      </select>
    </label>}
    {deliverySettlement && <div className="space-y-4">
      {paymentError ? <><p role="alert" className="text-red-600">{paymentError}</p><button type="button" onClick={reloadPayments}>Recargar cobros</button></>
        : !paymentDetail ? <p role="status">Cargando cobros…</p> : <OrderPaymentFields orderId={task.order.id} detail={{ ...paymentDetail, remainingMethodsOnly: true }} value={settlement} onChange={value => { setSettlement(value); setPaymentsVerified(false); }} disabled={busy || uploading} onUploadingChange={value => { uploadInFlight.current = value; setUploading(value); }} />}
      {settlement.payments.length > 0 && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={paymentsVerified} onChange={event => setPaymentsVerified(event.target.checked)} />Verifiqué la recepción de todos los pagos indicados.</label>}
    </div>}
    {completed && task.task === 'prepare' ? <>
      <p className="text-sm">Saldo actual por informar: <strong>${Math.max(0, task.order.total - task.order.paid).toFixed(2)}</strong>. El acuerdo del core no modifica este saldo.</p>
      <PreparationFields value={preparation} onChange={setPreparation} disabled={busy}
        onUpload={file => uploadDownpaymentReceipt(task.order.id, file)}
        onUploadingChange={value => { uploadInFlight.current = value; setUploading(value); }} />
    </> : deliverySettlement ? <>
      <OrderDeliveryFields orderId={task.order.id} customerName={task.order.customerName || 'Nombre del cliente pendiente de completar'}
        photos={deliveryPhotos} onChange={setDeliveryPhotos} disabled={busy || uploading}
        onUploadingChange={value => { uploadInFlight.current = value; setUploading(value); }} />
      <button
        type="button"
        disabled={busy || uploading}
        onClick={() => setConfirmed(!confirmed)}
        className={`w-full p-4 rounded-2xl border text-left transition-all flex items-start gap-3.5 ${
          confirmed
            ? 'bg-emerald-950/50 border-emerald-500/70 text-emerald-100 shadow-[0_0_20px_rgba(16,185,129,0.15)] ring-1 ring-emerald-500/30'
            : 'bg-slate-900/70 border-slate-700 text-slate-300 hover:border-slate-600 hover:bg-slate-800/60'
        }`}
      >
        <div className={`p-2 rounded-xl shrink-0 ${confirmed ? 'bg-emerald-500 text-slate-950 shadow-sm' : 'bg-slate-800 text-slate-400'}`}>
          <span className="material-symbols-outlined text-xl">
            {confirmed ? 'check_circle' : 'handshake'}
          </span>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm">
              Confirmo la entrega física al cliente y la comunicación de la garantía.
            </span>
            {confirmed && <span className="text-emerald-400 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20">Confirmado</span>}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Pieza inspeccionada en buen estado, plazo de garantía notificado y política de core informada al comprador.
          </p>
        </div>
      </button>
      <label className="hidden">
        <input required type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
        Confirmo la entrega física al cliente y la comunicación de la garantía.
      </label>
    </> : <>
    <label className={field}>Detalle de la gestión
      <textarea required minLength={5} maxLength={5000} rows={3} value={notes} onChange={event => setNotes(event.target.value)} />
    </label>
    {completed && !postDelivery && <label className={field}>Evidencia o referencia verificable
      <textarea required minLength={5} maxLength={5000} rows={2} placeholder="Referencia del mensaje o conversación; indica qué confirmó el cliente." value={evidence} onChange={event => setEvidence(event.target.value)} />
    </label>}
    {completed ? <>
      {task.task === 'post_3' && partStatus === 'not_installed' && <label className={field}>
        Fecha de instalación acordada (hora local)
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
    </>}
    {postDelivery && directContact && <div className="space-y-4">
      <label className={field}>Estado de la pieza<select value={partStatus} onChange={event => setPartStatus(event.target.value as typeof partStatus)}>
        <option value="not_installed">No instalada</option><option value="in_process">En montaje</option><option value="installed_ok">Instalada y funcionando</option><option value="has_issues">Con observaciones</option><option value="defect_claim">Posible defecto</option>
      </select></label>
      {partStatus === 'not_installed' && <div className="rounded-xl border border-amber-500/40 p-4 space-y-3">
        <p className="text-sm">{task.order.warrantyTerms ? `Garantía de ${task.order.warrantyTerms.days} días · Vencimiento: ${
          task.order.warrantyTerms.policy === 'calendar' ? `${warrantyDeadline(task.order.warrantyTerms)} al finalizar el día en Nueva York`
            : new Date(Date.parse(task.order.warrantyTerms.startedAt) + task.order.warrantyTerms.days * 86400000).toLocaleString()}` : 'Consulta las condiciones de garantía registradas en la orden.'}</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" required checked={warrantyWarningGiven} onChange={event => setWarrantyWarningGiven(event.target.checked)} />
          {channel === 'call' ? 'Advertí verbalmente' : 'Informé por escrito'} al cliente que la garantía continúa corriendo aunque se demore la instalación.</label>
        <p className="text-xs text-[var(--text-secondary)]">La fecha de instalación no pausa ni reinicia la garantía.</p>
      </div>}
    </div>}
    {error && <p role="alert" className="text-sm text-red-600">{error} Si la orden cambió, cancela y recarga antes de reintentar.</p>}
    <div className="flex flex-wrap gap-3">
      <button type="submit" disabled={busy || uploading} className="horizon-primary rounded-xl px-4 py-2.5 font-bold">{busy ? 'Registrando…' : 'Registrar gestión'}</button>
      {onCancel && <button type="button" disabled={busy || uploading} onClick={onCancel} className="cyber-btn-secondary px-4 py-2">Cancelar</button>}
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
export const OrderWorkflowPanel: React.FC<{ orderId: string; view?: 'workflow' | 'followup' | 'history' }> = ({ orderId, view = 'workflow' }) => {
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
  const completed = completedWorkflowStages(detail?.events || [], detail?.order);
  const task = detail?.tasks.find(item => view === 'followup' ? item.task.startsWith('post_') : !item.task.startsWith('post_'));
  return <section className="horizon-view-card horizon-workflow-panel space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-bold">{view === 'followup' ? 'Seguimiento post entrega' : view === 'history' ? 'Historial de gestiones' : 'Flujo verificable de la orden'}</h2>
      <button type="button" onClick={() => void reload()} className="cyber-btn-secondary px-3 py-2">Recargar flujo</button>
    </div>
    {error ? <p role="alert" className="text-red-600">{error}</p> : !detail ? <p role="status">Cargando flujo…</p> : <>
      {view === 'workflow' && <><ol className="horizon-workflow-stages grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {WORKFLOW_STAGES.map(stage => <li key={stage.id} className="rounded-2xl p-4 bg-[var(--bg-card-subtle)]" aria-current={task?.task === stage.id ? 'step' : undefined}>
          <strong>{stage.title}</strong>
          {stage.id === 'quote' ? <OrderQuotationSummary order={detail.order} />
            : detail.order.historicalDelivery ? <HistoricalWorkflowStage order={detail.order} stage={stage.id} />
            : stage.id === 'ack' && confirmationPreapproved(detail.order, detail.events) && !detail.events.some(event => event.task === 'ack' && event.outcome === 'completed')
              ? <div className="text-sm mt-2 space-y-1"><p style={{ color: 'var(--positive)' }}>Confirmación preaprobada</p>
                <p>Orden en Pagado al activar los nuevos requisitos. No requiere comprobantes históricos.</p>
                {detail.order.confirmationPolicyAt && <p>Activación: {new Date(detail.order.confirmationPolicyAt).toLocaleString()}</p>}</div>
            : <p className="text-sm mt-2" style={{ color: completed.includes(stage.id) ? 'var(--positive)' : 'var(--text-secondary)' }}>{completed.includes(stage.id) ? 'Completada con evidencia' : 'Pendiente de verificar'}</p>}
        </li>)}
      </ol>
      {detail.order.preparation && (
        <div className="rounded-2xl p-4 sm:p-5 bg-gradient-to-r from-blue-950/30 via-slate-900/40 to-slate-900/60 border border-blue-500/30 text-sm space-y-3.5 shadow-sm">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2.5 border-b border-slate-800/80">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-blue-500/15 text-blue-400">
                <span className="material-symbols-outlined text-xl">event_available</span>
              </div>
              <div>
                <strong className="text-sm sm:text-base text-slate-100">
                  {detail.order.preparation.channel === 'in_person'
                    ? 'Entrega presencial en yarda verificada'
                    : 'Cita y modalidad verificadas'}
                </strong>
                <p className="text-xs text-slate-400">
                  Acuerdos de entrega confirmados con el comprador
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm text-primary-400">
                  {detail.order.preparation.channel === 'call' ? 'phone' : detail.order.preparation.channel === 'sms' ? 'chat' : 'storefront'}
                </span>
                <span>
                  {detail.order.preparation.channel === 'call' ? 'Llamada contestada' : detail.order.preparation.channel === 'sms' ? 'Mensaje / Chat' : 'Presencial en yarda'}
                </span>
              </span>

              <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold border flex items-center gap-1.5 ${
                detail.order.preparation.deliveryType === 'envio_domicilio'
                  ? 'bg-cyan-950/40 text-cyan-300 border-cyan-500/40'
                  : 'bg-emerald-950/40 text-emerald-300 border-emerald-500/40'
              }`}>
                <span className="material-symbols-outlined text-sm">
                  {detail.order.preparation.deliveryType === 'envio_domicilio' ? 'local_shipping' : 'warehouse'}
                </span>
                <span>
                  {detail.order.preparation.deliveryType === 'envio_domicilio' ? 'Delivery / envío' : 'Recogida en yarda'}
                </span>
              </span>
            </div>
          </div>

          {/* Grid of Key Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {/* Date */}
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-amber-400 text-sm">calendar_today</span>
                Fecha acordada
              </span>
              <p className="text-sm font-bold text-slate-200">
                {detail.order.preparation.dateFrom === detail.order.preparation.dateTo
                  ? detail.order.preparation.dateFrom
                  : `${detail.order.preparation.dateFrom} — ${detail.order.preparation.dateTo}`}
              </p>
            </div>

            {/* Core Plan */}
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-violet-400 text-sm">swap_horizontal_circle</span>
                Acuerdo de core
              </span>
              <p className="text-sm font-bold text-slate-200">
                {detail.order.preparation.corePlan === 'return_core'
                  ? '🔄 El cliente lo llevará a la yarda'
                  : '💵 El cliente lo pagará en la liquidación'}
              </p>
              <span className="text-[10px] text-slate-400 block">
                Intención acordada, cobro o recepción al entregar
              </span>
            </div>

            {/* Delivery address or yard note */}
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1 sm:col-span-2 md:col-span-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-cyan-400 text-sm">
                  {detail.order.preparation.deliveryType === 'envio_domicilio' ? 'location_on' : 'store'}
                </span>
                {detail.order.preparation.deliveryType === 'envio_domicilio' ? 'Destino de entrega' : 'Punto de retiro'}
              </span>
              <p className="text-xs sm:text-sm font-medium text-slate-200 break-words">
                {detail.order.preparation.deliveryType === 'envio_domicilio'
                  ? detail.order.preparation.address
                  : 'Mostrador de entregas en patio principal'}
              </p>
            </div>
          </div>

          {/* Customer notes / response bubble if exists */}
          {detail.order.preparation.customerNotes && (
            <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex items-start gap-2.5">
              <span className="material-symbols-outlined text-indigo-400 text-base mt-0.5 shrink-0">forum</span>
              <div className="text-xs space-y-0.5">
                <span className="font-semibold text-slate-300">Respuesta y notas del cliente:</span>
                <p className="text-slate-200 italic leading-relaxed">
                  "{detail.order.preparation.customerNotes}"
                </p>
              </div>
            </div>
          )}

          {/* Screenshots link if exists */}
          {detail.order.preparation.screenshots && detail.order.preparation.screenshots.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-slate-400 font-medium">Evidencias adjuntas:</span>
              {detail.order.preparation.screenshots.map((url, idx) => (
                <a
                  key={idx}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-primary-300 border border-slate-700 flex items-center gap-1 transition-all"
                >
                  <span className="material-symbols-outlined text-xs">image</span>
                  <span>Ver captura {idx + 1}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}</>}
      {view !== 'history' && (task ? <WorkflowActionForm key={`${orderId}-${detail.order.version}-${task.task}`} task={task} onSaved={reload} />
        : <p className="text-sm text-[var(--text-secondary)]">{view === 'followup' ? 'Sin seguimiento pendiente. Los registros se conservan en Historial.' : 'Sin tarea comercial activa. Consulta Seguimiento post entrega o Historial.'}</p>)}
      {view === 'followup' && detail.order.historicalDelivery && !detail.order.deliveredAt && <p role="alert" className="text-sm text-amber-600">Falta la fecha de entrega registrada. Revisa el historial antes de programar seguimientos.</p>}
      {view === 'history' && <>
      <h3 className="font-bold">Historial de gestiones</h3>
      {!detail.events.length && <p className="text-sm text-[var(--text-secondary)]">{detail.order.historicalDelivery
        ? 'Flujo regularizado automáticamente desde el estado Entregado y su historial original. No se agregaron cobros ni gestiones ficticias.'
        : 'Cotización registrada al crear la orden. Aún no hay gestiones de las etapas siguientes.'}</p>}
      {detail.order.historicalDelivery && !detail.order.deliveredAt && <p role="alert" className="text-sm text-amber-600">La entrega no tiene fecha registrada. Revisa el historial antes de programar los seguimientos post-entrega.</p>}
      <div className="space-y-3">{[...detail.events].reverse().map(event => {
        const contact = decodeCommunicationEvidence(event.evidence);
        const reference = contact?.reference ?? event.evidence;
        return <article key={event.id} className="rounded-xl bg-[var(--bg-card-subtle)] p-4 text-sm space-y-2">
        <strong>{event.actorName} · {event.task} · {event.outcome}</strong>
        <p>{new Date(event.createdAt).toLocaleString()}</p><p className="whitespace-pre-wrap">{event.notes}</p>
        {event.task === 'delivery' && readDeliveryPhotos(event.evidence) !== null
          ? <div className="flex flex-wrap gap-3">{readDeliveryPhotos(event.evidence)!.map((url, index) =>
            <a key={`${url}-${index}`} className="underline" href={url} target="_blank" rel="noreferrer">Ver imagen de entrega {index + 1}</a>)}</div>
          : reference && <p className="whitespace-pre-wrap">Evidencia: {reference}</p>}
        {contact && <div className="text-sm space-y-1">
          <p>Canal: {({ call: 'Llamada', sms: 'SMS', whatsapp: 'WhatsApp' })[contact.communication.channel]} · Resultado: {event.contactResult}</p>
          {event.partStatus && <p>Estado confirmado de la pieza: {event.partStatus}</p>}
          {contact.communication.warrantyWarningGiven && <p>Advertencia de garantía comunicada {contact.communication.channel === 'call' ? 'verbalmente' : 'por escrito'}.</p>}
          {contact.communication.screenshots?.map((url, index) =>
            <a key={`${url}-${index}`} className="block underline" href={url} target="_blank" rel="noreferrer">Ver captura de conversación {index + 1}</a>)}
        </div>}
        {event.downpayment?.map((payment, index) => <div key={index} className="space-y-1">
          <p>{DOWNPAYMENT_METHODS[payment.method]} · ${payment.amount.toFixed(2)}{payment.method === 'cash' && ` · Recibió: ${payment.receivedBy}`}</p>
          {payment.receipt && <a className="underline" href={payment.receipt} target="_blank" rel="noreferrer">Ver comprobante {index + 1}</a>}
        </div>)}
        {event.preparation && <div className="space-y-1">
          <p>Comunicación: {event.preparation.channel === 'in_person' ? 'Cliente presente · entrega inmediata en yarda' : event.preparation.channel === 'call' ? 'Llamada contestada' : 'Mensaje de texto tras llamada sin respuesta'}. El cliente confirmó la recepción de la información.</p>
          {event.preparation.channel === 'sms' && <p>Intento de llamada: {event.preparation.failedCallNotes}</p>}
          <p>Modalidad: {event.preparation.deliveryType === 'envio_domicilio' ? 'Delivery / envío' : 'Recogida en yarda'} · Fechas: {event.preparation.dateFrom} — {event.preparation.dateTo}</p>
          {event.preparation.deliveryType === 'envio_domicilio' && <p>Dirección: {event.preparation.address}</p>}
          <p>Saldo informado. Métodos comunicados: efectivo, Cash App o Zelle. Core: {event.preparation.corePlan === 'return_core' ? 'lo llevará' : 'lo pagará'}.</p>
          {event.preparation.screenshots.map((url, index) => <a key={`${url}-${index}`} className="block underline" href={url} target="_blank" rel="noreferrer">Ver captura {index + 1}</a>)}
        </div>}
        {event.nextAction && <p>Próxima acción: {event.nextAction} · {event.nextDueDate}</p>}
        {event.blockedBy && <p>Responsable del bloqueo: {event.blockedBy}</p>}
      </article>;
      })}</div>
      {Boolean(detail.contacts?.length) && <div className="space-y-3">
        <h3 className="font-bold">Registros de contacto post-entrega</h3>
        <p className="text-sm text-[var(--text-secondary)]">Se conserva el historial anterior. Un contacto por sí solo no completa una etapa.</p>
        {detail.contacts?.map(contact => <article key={contact.id} className="rounded-xl bg-[var(--bg-card-subtle)] p-4 text-sm">
          <strong>{contact.actor} · {new Date(contact.createdAt).toLocaleString()}</strong><p className="whitespace-pre-wrap">{contact.notes}</p>
        </article>)}
      </div>}</>}
    </>}
  </section>;
};
