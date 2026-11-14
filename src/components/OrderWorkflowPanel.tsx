import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../services/apiFetch';
import {
  addWorkingDays, completedWorkflowStages, confirmationPreapproved, shiftWorkflowDate, WORKFLOW_STAGES, workflowDate, workflowTaskAssignee,
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
import { VaultUnlockModal } from './VaultUnlockModal';
import { useFeedback } from './FeedbackProvider';

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
  const { confirm } = useFeedback();
  const [lines, setLines] = useState<DownpaymentLine[]>([{ method: 'cash', amount: task.order.paid, receivedBy: '', receipt: null }]);
  const [uploading, setUploading] = useState(false);
  const uploadInFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const exemptingRef = useRef(false);
  const [vaultPrompt, setVaultPrompt] = useState(false);
  const vaultRetryRef = useRef<null | (() => void)>(null);
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
  const exemptAsAdmin = async () => {
    if (exemptingRef.current || uploadInFlight.current) return;
    const confirmed = await confirm({
      title: `¿Exonerar el anticipo de la orden #${task.order.code}?`,
      message: 'La orden pasará a Pagado para iniciar preparación. El 100% se cobrará al entregar.',
      confirmLabel: 'Exonerar anticipo',
      tone: 'danger',
    });
    if (!confirmed) return;
    exemptingRef.current = true;
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch(`/orders/${task.order.id}/exempt-downpayment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'Anticipo exonerado por Administrador. Cobro contra entrega.' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.code === 'FINANCE_LOCKED') {
          vaultRetryRef.current = () => { void exemptAsAdmin(); };
          setVaultPrompt(true);
          return;
        }
        throw new Error(data.message || 'No se pudo exonerar el anticipo.');
      }
      window.dispatchEvent(new Event('radar:data-changed'));
      window.dispatchEvent(new CustomEvent('radar:followup-updated', { detail: { orderId: task.order.id } }));
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error exonerando anticipo');
    } finally {
      exemptingRef.current = false;
      setBusy(false);
    }
  };
  return <>
  <form onSubmit={submit} className="horizon-workflow-form space-y-4">
    <h3 className="text-lg font-bold">Confirmación · {task.order.code}</h3>
    <DownpaymentFields paid={task.order.paid} value={lines} onChange={setLines} disabled={busy}
      onUpload={file => uploadDownpaymentReceipt(task.order.id, file)} onUploadingChange={value => { uploadInFlight.current = value; setUploading(value); }} />
    {task.order.paid <= 0 && (
      <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs space-y-2">
        <p role="alert" className="text-amber-400 font-semibold flex items-center gap-1.5">
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">info</span>
          Sin abono registrado ($0.00). Primero registra el abono desde Registrar cobro.
        </p>
        <button
          type="button"
          disabled={busy || uploading}
          onClick={() => void exemptAsAdmin()}
          className="px-3 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-mono font-bold flex items-center gap-1.5 transition cursor-pointer"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">handshake</span>
          <span>Exonerar Anticipo como Administrador (Cobro Contra Entrega)</span>
        </button>
      </div>
    )}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <div className="flex flex-wrap gap-3">
      <button type="submit" className="cyber-btn-primary px-4 py-3" disabled={busy || uploading || task.order.paid <= 0}>{busy ? 'Guardando…' : 'Guardar confirmación'}</button>
      {onCancel && <button type="button" className="cyber-btn-secondary px-4 py-3" disabled={busy || uploading} onClick={onCancel}>Cancelar</button>}
    </div>
  </form>
  <VaultUnlockModal
    isOpen={vaultPrompt}
    title="Desbloquear bóveda para exonerar el anticipo"
    description="La exoneración del anticipo pasa la orden a Pagado y afecta el estado financiero. Desbloquea la bóveda durante 15 minutos para continuar."
    onClose={() => { setVaultPrompt(false); vaultRetryRef.current = null; }}
    onSuccess={() => {
      setVaultPrompt(false);
      const retry = vaultRetryRef.current;
      vaultRetryRef.current = null;
      if (retry) setTimeout(retry, 100);
    }}
  />
  </>;
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
  const [partStatus, setPartStatus] = useState<'not_installed' | 'in_process' | 'installed_ok' | 'has_issues' | 'defect_claim'>(
    task.task === 'post_7' || task.task === 'post_14' ? 'installed_ok' : 'not_installed'
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const completed = outcome === 'completed';
  const postDelivery = task.task.startsWith('post_');
  const directContact = hasContactResponse(contactResult);
  const applyPostDeliveryOutcome = (
    nextResult: FollowupCallResult,
    nextPartStatus: typeof partStatus
  ) => {
    if (!postDelivery) return;
    if (!hasContactResponse(nextResult)) {
      if (nextResult === 'wrong_number') {
        setOutcome('blocked');
        setBlockedBy(prev => prev.trim() || 'Cliente / número telefónico por actualizar');
        setNextAction(prev => prev.trim() || 'Confirmar teléfono correcto del cliente para retomar seguimiento');
      } else {
        setOutcome('no_response');
        setNextAction(prev => prev.trim() || 'Reintentar contacto al siguiente día hábil');
        setNextDueDate(addWorkingDays(today, 1));
      }
      return;
    }
    if (nextPartStatus === 'has_issues' || nextPartStatus === 'defect_claim') {
      setOutcome('incident');
      setNextAction(prev => prev.trim() || 'Dar seguimiento técnico / gestionar caso en Reclamos de garantía');
      setNextDueDate(prev => (prev && prev > today ? prev : addWorkingDays(today, 1)));
      return;
    }
    const requiresInstalledOk = task.task === 'post_7' || task.task === 'post_14';
    if (requiresInstalledOk && nextPartStatus !== 'installed_ok') {
      setOutcome('blocked');
      setBlockedBy(prev => prev.trim() || 'Taller mecánico del cliente (instalación pendiente de concluir)');
      setNextAction(prev => prev.trim() || 'Confirmar conclusión del montaje y funcionamiento de la pieza');
      setNextDueDate(prev => (prev && prev > today ? prev : addWorkingDays(today, 2)));
      return;
    }
    if (task.objectiveDueDate > today) {
      setOutcome('blocked');
      setBlockedBy(prev => prev.trim() || `En espera de la fecha programada del hito (${task.objectiveDueDate})`);
      setNextAction(prev => prev.trim() || `Confirmar cierre del hito a partir del ${task.objectiveDueDate}`);
      setNextDueDate(task.objectiveDueDate);
      return;
    }
    setOutcome('completed');
  };
  const changeContact = (result: FollowupCallResult) => {
    setContactResult(result); setWarrantyWarningGiven(false); setConfirmed(false);
    if (postDelivery) {
      applyPostDeliveryOutcome(result, partStatus);
    } else if (!hasContactResponse(result)) {
      setOutcome(result === 'wrong_number' ? 'blocked' : 'no_response');
    } else if (outcome === 'no_response') {
      setOutcome('completed');
    }
  };
  const changePartStatus = (nextStatus: typeof partStatus) => {
    setPartStatus(nextStatus);
    if (nextStatus !== 'not_installed') setWarrantyWarningGiven(false);
    applyPostDeliveryOutcome(contactResult, nextStatus);
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
    {task.task !== 'delivery' && !postDelivery && <p className="text-sm">Estado logístico: {ORDER_STATUS_LABELS[task.order.status]}.</p>}
    {task.regularization && <p className="text-sm text-amber-600">Orden ya entregada: documenta la gestión histórica real. No se cambiará su fecha de entrega.</p>}
    {postDelivery && (
      <div className="space-y-4">
        {task.objectiveDueDate > today && (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs flex items-start gap-2.5">
            <span aria-hidden="true" className="material-symbols-outlined text-amber-400 text-[18px] shrink-0">event_upcoming</span>
            <div className="space-y-0.5">
              <strong className="text-amber-300 font-bold block">
                Hito programado para el {task.objectiveDueDate}
              </strong>
              <p className="text-[var(--text-secondary)]">
                La confirmación definitiva de este hito se habilita en su fecha objetivo ({task.objectiveDueDate}). Si contactas antes al cliente, el avance quedará agendado para esa fecha.
              </p>
            </div>
          </div>
        )}

        {/* Paso 1: Canal y Respuesta del Cliente */}
        <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)]/60 p-4 space-y-4">
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-[var(--border-color)]">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 text-xs font-black flex items-center justify-center">1</span>
              <strong className="text-sm font-bold text-[var(--text-primary)]">Canal y respuesta del cliente</strong>
            </div>
            <span className="text-[11px] font-mono text-[var(--text-secondary)]">
              Fecha objetivo: {task.objectiveDueDate}
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Canal */}
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] block">
                Canal utilizado
              </span>
              <label className="sr-only">
                Canal de comunicación
                <select
                  disabled={busy || uploading}
                  value={channel}
                  onChange={event => {
                    const next = event.target.value as FollowupCommunication['channel'];
                    setChannel(next);
                    setScreenshots([]);
                    changeContact(next === 'call' ? 'answered' : 'sms_replied');
                    setCopied(false);
                  }}
                >
                  <option value="call">Llamada</option>
                  <option value="sms">SMS</option>
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { id: 'call', label: 'Llamada', icon: 'call' },
                  { id: 'sms', label: 'SMS', icon: 'sms' },
                ] as const).map(item => {
                  const active = channel === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={busy || uploading}
                      onClick={() => {
                        setChannel(item.id);
                        setScreenshots([]);
                        changeContact(item.id === 'call' ? 'answered' : 'sms_replied');
                        setCopied(false);
                      }}
                      className={`px-3 py-2.5 rounded-xl border text-xs font-semibold transition-all flex flex-col items-center justify-center gap-1 ${
                        active
                          ? 'bg-cyan-500/20 border-cyan-500 text-[var(--text-primary)] ring-1 ring-cyan-500/40 shadow-sm'
                          : 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <span aria-hidden="true" className={`material-symbols-outlined text-[18px] ${active ? 'text-cyan-400' : ''}`}>{item.icon}</span>
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Respuesta */}
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] block">
                Respuesta obtenida
              </span>
              <label className="sr-only">
                Respuesta del cliente
                <select disabled={busy} value={contactResult} onChange={event => changeContact(event.target.value as FollowupCallResult)}>
                  {channel === 'call' ? (
                    <>
                      <option value="answered">Contestó la llamada</option>
                      <option value="no_answer">No contestó / buzón</option>
                      <option value="busy">Ocupado</option>
                    </>
                  ) : (
                    <>
                      <option value="sms_replied">Respondió al mensaje</option>
                      <option value="sms_sent">Enviado · esperando respuesta</option>
                      <option value="sms_no_reply">Mensaje sin respuesta</option>
                    </>
                  )}
                  <option value="wrong_number">Número incorrecto</option>
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(channel === 'call'
                  ? ([
                      { id: 'answered', label: 'Contestó', icon: 'check_circle', tone: 'emerald' },
                      { id: 'no_answer', label: 'No contestó / Buzón', icon: 'phone_missed', tone: 'amber' },
                      { id: 'busy', label: 'Línea ocupada', icon: 'phone_Paused', tone: 'amber' },
                      { id: 'wrong_number', label: 'Número equivocado', icon: 'wrong_location', tone: 'rose' },
                    ] as const)
                  : ([
                      { id: 'sms_replied', label: 'Respondió mensaje', icon: 'mark_chat_read', tone: 'emerald' },
                      { id: 'sms_sent', label: 'Enviado · en espera', icon: 'schedule_send', tone: 'amber' },
                      { id: 'sms_no_reply', label: 'Sin respuesta', icon: 'chat_bubble_outline', tone: 'amber' },
                      { id: 'wrong_number', label: 'Número equivocado', icon: 'wrong_location', tone: 'rose' },
                    ] as const)
                ).map(opt => {
                  const selected = contactResult === opt.id;
                  const activeClasses =
                    opt.tone === 'emerald'
                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400 ring-1 ring-emerald-500/40'
                      : opt.tone === 'rose'
                        ? 'bg-rose-500/20 border-rose-500 text-rose-400 ring-1 ring-rose-500/40'
                        : 'bg-amber-500/20 border-amber-500 text-amber-400 ring-1 ring-amber-500/40';
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={busy}
                      onClick={() => changeContact(opt.id)}
                      className={`px-2.5 py-2 rounded-xl border text-xs font-semibold transition-all flex items-center gap-1.5 text-left ${
                        selected
                          ? activeClasses
                          : 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[16px] shrink-0">{opt.icon}</span>
                      <span className="truncate">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {!directContact && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs flex items-center gap-2 text-amber-400">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px] shrink-0">schedule</span>
              <span>
                {contactResult === 'wrong_number'
                  ? 'Se registrará un bloqueo para actualizar el número del cliente antes de volver a llamar.'
                  : `Solo se registra el intento de contacto. El sistema programará automáticamente el reintento para el siguiente día hábil (${addWorkingDays(today, 1)}).`}
              </span>
            </div>
          )}

          {channel !== 'call' && (
            <div className="grid gap-3 pt-1">
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-cyan-400">description</span>
                    <span>Plantilla sugerida de mensaje</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => { setTemplateLanguage('es'); setCopied(false); }}
                      className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border ${
                        templateLanguage === 'es' ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400' : 'border-[var(--border-color)] text-[var(--text-secondary)]'
                      }`}
                    >
                      ES
                    </button>
                    <button
                      type="button"
                      onClick={() => { setTemplateLanguage('en'); setCopied(false); }}
                      className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border ${
                        templateLanguage === 'en' ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400' : 'border-[var(--border-color)] text-[var(--text-secondary)]'
                      }`}
                    >
                      EN
                    </button>
                    <button
                      type="button"
                      className="cyber-btn-secondary px-2.5 py-1 text-xs font-semibold flex items-center gap-1"
                      onClick={() => {
                        void navigator.clipboard.writeText(template).then(() => setCopied(true)).catch(() => setError('No se pudo copiar la plantilla. Selecciona el texto y cópialo manualmente.'));
                      }}
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[14px]">{copied ? 'check' : 'content_copy'}</span>
                      <span>{copied ? 'Copiada' : 'Copiar mensaje'}</span>
                    </button>
                  </div>
                </div>
                <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed bg-[var(--bg-card-subtle)] p-2.5 rounded-lg border border-[var(--border-color)]">
                  {template}
                </p>
              </div>

              <OrderImageFields
                onUpload={file => uploadDownpaymentReceipt(task.order.id, file)}
                photos={screenshots}
                onChange={setScreenshots}
                label="Capturas de la conversación (opcional)"
                description="Puedes registrar la gestión sin capturas o adjuntar imágenes de SMS."
                imageLabel="Ver captura de conversación"
                disabled={busy}
                onUploadingChange={value => { uploadInFlight.current = value; setUploading(value); }}
              />
            </div>
          )}
        </section>

        {/* Paso 2: Estado de la pieza (solo cuando el cliente respondió) */}
        {directContact && (
          <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)]/60 p-4 space-y-3.5">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-xs font-black flex items-center justify-center">2</span>
                <strong className="text-sm font-bold text-[var(--text-primary)]">Estado actual de la pieza confirmado por el cliente</strong>
              </div>
            </div>

            <label className="sr-only">
              Estado de la pieza
              <select value={partStatus} onChange={event => changePartStatus(event.target.value as typeof partStatus)}>
                <option value="not_installed">No instalada</option>
                <option value="in_process">En montaje</option>
                <option value="installed_ok">Instalada y funcionando</option>
                <option value="has_issues">Con observaciones</option>
                <option value="defect_claim">Posible defecto</option>
              </select>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {([
                {
                  id: 'installed_ok',
                  title: 'Instalada y funcionando',
                  desc: 'Montada en el vehículo y operando sin fallas',
                  icon: 'verified',
                  tone: 'emerald',
                },
                {
                  id: 'in_process',
                  title: 'En proceso de montaje',
                  desc: 'El taller mecánico la está instalando ahora',
                  icon: 'build_circle',
                  tone: 'cyan',
                },
                {
                  id: 'not_installed',
                  title: 'Aún no instalada',
                  desc: 'Recibida, esperando turno de instalación',
                  icon: 'schedule',
                  tone: 'amber',
                },
                {
                  id: 'has_issues',
                  title: 'Con observaciones',
                  desc: 'Instalada pero presenta detalle a vigilar',
                  icon: 'warning',
                  tone: 'amber',
                },
                {
                  id: 'defect_claim',
                  title: 'Posible defecto / Reclamo',
                  desc: 'Falla reportada; requiere abrir reclamo',
                  icon: 'report_problem',
                  tone: 'rose',
                },
              ] as const).map(card => {
                const selected = partStatus === card.id;
                const toneClasses =
                  card.tone === 'emerald'
                    ? 'bg-emerald-500/15 border-emerald-500 text-emerald-400 ring-1 ring-emerald-500/30'
                    : card.tone === 'cyan'
                      ? 'bg-cyan-500/15 border-cyan-500 text-cyan-400 ring-1 ring-cyan-500/30'
                      : card.tone === 'rose'
                        ? 'bg-rose-500/15 border-rose-500 text-rose-400 ring-1 ring-rose-500/30'
                        : 'bg-amber-500/15 border-amber-500 text-amber-400 ring-1 ring-amber-500/30';
                return (
                  <button
                    key={card.id}
                    type="button"
                    disabled={busy}
                    onClick={() => changePartStatus(card.id)}
                    className={`p-3 rounded-xl border text-left transition-all flex items-start gap-2.5 ${
                      selected
                        ? toneClasses
                        : 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[20px] shrink-0 mt-0.5">{card.icon}</span>
                    <div className="min-w-0">
                      <strong className="text-xs font-bold block text-[var(--text-primary)]">{card.title}</strong>
                      <span className="text-[11px] text-[var(--text-secondary)] leading-snug block mt-0.5">{card.desc}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {partStatus === 'not_installed' && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 space-y-2.5">
                <p className="text-xs font-semibold text-amber-400">
                  {task.order.warrantyTerms
                    ? `🛡️ Garantía de ${task.order.warrantyTerms.days} días · Vencimiento: ${
                        task.order.warrantyTerms.policy === 'calendar'
                          ? `${warrantyDeadline(task.order.warrantyTerms)} (NY)`
                          : new Date(Date.parse(task.order.warrantyTerms.startedAt) + task.order.warrantyTerms.days * 86400000).toLocaleDateString()
                      }`
                    : '🛡️ Consulta las condiciones de garantía registradas en la orden.'}
                </p>
                <label className="flex items-start gap-2 text-xs font-medium text-[var(--text-primary)] cursor-pointer">
                  <input
                    type="checkbox"
                    required
                    checked={warrantyWarningGiven}
                    onChange={event => setWarrantyWarningGiven(event.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    {channel === 'call' ? 'Advertí verbalmente' : 'Informé por escrito'} al cliente que la garantía continúa corriendo aunque se demore la instalación.
                  </span>
                </label>
                {completed && task.task === 'post_3' && (
                  <label className="flex flex-col gap-1.5 text-xs font-semibold text-[var(--text-primary)] pt-1">
                    <span>Fecha estimada de instalación acordada con el cliente *</span>
                    <input
                      required
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={event => setScheduledAt(event.target.value)}
                    />
                  </label>
                )}
              </div>
            )}

            {(task.task === 'post_7' || task.task === 'post_14') && (partStatus === 'not_installed' || partStatus === 'in_process') && (
              <div className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-3 text-xs text-cyan-300 flex items-start gap-2">
                <span aria-hidden="true" className="material-symbols-outlined text-[18px] shrink-0">event_repeat</span>
                <span>
                  Para cerrar el hito de {task.title} se requiere que la pieza ya esté instalada y probada. Se agendará una reprogramación para volver a verificar cuando el taller termine el montaje.
                </span>
              </div>
            )}
          </section>
        )}
      </div>
    )}
    {task.task !== 'delivery' && !postDelivery && <label className={field}>Resultado
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
          <span aria-hidden="true" className="material-symbols-outlined text-xl">
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
    <div className="space-y-2">
      {postDelivery && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-[var(--text-secondary)]">Notas rápidas:</span>
          {(directContact
            ? partStatus === 'installed_ok'
              ? [
                  'Cliente confirma pieza instalada y funcionando al 100% sin fallas.',
                  'Montaje completado en taller; motor/transmisión operando correctamente.',
                ]
              : partStatus === 'in_process'
                ? [
                    'Pieza en taller mecánico en proceso de instalación.',
                    'Mecánico realizando el montaje; se dará seguimiento al concluir.',
                  ]
                : partStatus === 'not_installed'
                  ? [
                      'Cliente recibió la pieza conforme; tiene turno programado en su taller.',
                      'Pieza aún sin montar; se recordó vigencia de garantía.',
                    ]
                  : [
                      'Cliente reporta observación en el funcionamiento; se canaliza a revisión.',
                    ]
            : [
                'Llamada sin respuesta / buzón de voz; se dejó mensaje de seguimiento.',
                'Se envió mensaje de seguimiento por SMS; en espera de confirmación.',
              ]
          ).map((quickNote, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setNotes(quickNote)}
              className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-cyan-500/50 transition-all"
            >
              + {quickNote}
            </button>
          ))}
        </div>
      )}
      <label className={field}>Detalle de la gestión
        <textarea required minLength={5} maxLength={5000} rows={3} placeholder="Resume lo conversado con el cliente o el resultado del intento de contacto…" value={notes} onChange={event => setNotes(event.target.value)} />
      </label>
    </div>
    {completed && !postDelivery && <label className={field}>Evidencia o referencia verificable
      <textarea required minLength={5} maxLength={5000} rows={2} placeholder="Referencia del mensaje o conversación; indica qué confirmó el cliente." value={evidence} onChange={event => setEvidence(event.target.value)} />
    </label>}
    {completed ? <>
      <label className="flex items-start gap-2.5 text-sm p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 cursor-pointer">
        <input required type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-0.5" />
        <span className="font-medium text-[var(--text-primary)]">
          Confirmo que realicé el contacto real con el cliente y verifiqué los datos registrados en este hito.
        </span>
      </label>
    </> : <>
      {!(postDelivery && outcome === 'no_response') && (
        <div className="grid gap-3 sm:grid-cols-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)]/50 p-3.5">
          <label className={field}>Próxima acción
            <input required maxLength={1000} value={nextAction} onChange={event => setNextAction(event.target.value)} />
          </label>
          <label className={field}>Próxima fecha de revisión
            <input required type="date" min={addWorkingDays(today, 1)} value={outcome === 'no_response' ? addWorkingDays(today, 1) : nextDueDate} readOnly={outcome === 'no_response'} onChange={event => setNextDueDate(event.target.value)} />
          </label>
          {outcome === 'blocked' && (
            <label className={`${field} sm:col-span-2`}>Quién o qué mantiene en espera la verificación
              <input required maxLength={200} value={blockedBy} onChange={event => setBlockedBy(event.target.value)} placeholder="Taller mecánico, cliente de viaje, actualización de teléfono…" />
            </label>
          )}
        </div>
      )}
      {outcome === 'incident' && <p role="note" className="text-sm text-amber-500 font-medium">⚠️ Este registro marca la alerta técnica. Si procede abrir garantía o devolución, regístralo también en la sección de Garantía y Reclamos de la orden.</p>}
    </>}
    </>}
    {error && <p role="alert" className="text-sm text-red-600">{error} Si la orden cambió, cancela y recarga antes de reintentar.</p>}
    <div className="flex flex-wrap gap-3">
      <button type="submit" disabled={busy || uploading} className="horizon-primary rounded-xl px-4 py-2.5 font-bold">{busy ? 'Registrando…' : 'Registrar gestión'}</button>
      {onCancel && <button type="button" disabled={busy || uploading} onClick={onCancel} className="cyber-btn-secondary px-4 py-2">Cancelar</button>}
    </div>
  </form>;
};
export const OrderQuotationSummary: React.FC<{ order: WorkflowOrder }> = ({ order }) => <>
  <p className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 mt-2.5">
    <span aria-hidden="true" className="material-symbols-outlined text-[14px]">check_circle</span>
    <span>Completada al crear la orden</span>
  </p>
  <dl className="text-xs mt-3 space-y-2 rounded-xl bg-[var(--bg-card)]/70 border border-[var(--border-color)] p-2.5">
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-medium text-[var(--text-secondary)]">Fecha de creación de la cotización</dt>
      <dd className="font-semibold text-[var(--text-primary)] tabular-nums"><time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleString('es', { timeZone: 'America/New_York' })}</time></dd>
    </div>
    <div className="flex flex-col gap-0.5 pt-1.5 border-t border-[var(--border-color)]">
      <dt className="text-[11px] font-medium text-[var(--text-secondary)]">Agente que atendió</dt>
      <dd className="font-semibold text-[var(--text-primary)]">{order.quoteCreatedBy || 'No registrado'}</dd>
    </div>
  </dl>
</>;
const STAGE_ICONS: Record<WorkflowStage, string> = {
  quote: 'request_quote',
  ack: 'verified',
  prepare: 'event_available',
  delivery: 'local_shipping',
};
const STAGE_CAPTIONS: Record<Exclude<WorkflowStage, 'quote'>, { done: string; active: string; pending: string }> = {
  ack: {
    done: 'Abono inicial y método de pago respaldados.',
    active: 'En espera de verificar método y comprobante del abono.',
    pending: 'Se habilita al registrar el abono inicial.',
  },
  prepare: {
    done: 'Pieza lista y modalidad de retiro o envío acordada.',
    active: 'En espera de confirmar cita o modalidad con el cliente.',
    pending: 'Requiere completar la confirmación de pago.',
  },
  delivery: {
    done: 'Pieza entregada, saldo liquidado y garantía comunicada.',
    active: 'Lista para liquidar saldo en yarda y confirmar entrega.',
    pending: 'Se habilita al concluir la preparación y cita.',
  },
};
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
    <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--border-color)]">
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 flex items-center justify-center shrink-0">
          <span aria-hidden="true" className="material-symbols-outlined text-[22px]">
            {view === 'followup' ? 'support_agent' : view === 'history' ? 'history' : 'account_tree'}
          </span>
        </span>
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-[var(--text-primary)] leading-tight">
            {view === 'followup' ? 'Seguimiento post entrega' : view === 'history' ? 'Historial de gestiones' : 'Flujo verificable de la orden'}
          </h2>
          <p className="text-xs text-[var(--text-secondary)]">
            {view === 'followup'
              ? 'Verificación de recepción, montaje y funcionamiento en los días 3, 7 y 14'
              : view === 'history'
                ? 'Bitácora cronológica de verificaciones comerciales, entregas y contactos post-venta'
                : 'Progreso de etapas comerciales y acuerdos verificados con el cliente'}
          </p>
        </div>
      </div>
      <button type="button" onClick={() => void reload()} className="cyber-btn-secondary px-3.5 py-2 text-xs font-bold flex items-center gap-1.5">
        <span aria-hidden="true" className="material-symbols-outlined text-[16px]">sync</span>
        <span>Recargar flujo</span>
      </button>
    </div>
    {error ? <p role="alert" className="text-red-600">{error}</p> : !detail ? <p role="status">Cargando flujo…</p> : <>
      {view === 'workflow' && <><ol className="horizon-workflow-stages grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {WORKFLOW_STAGES.map((stage, index) => {
          const preapprovedAck = stage.id === 'ack' && confirmationPreapproved(detail.order, detail.events) && !detail.events.some(event => event.task === 'ack' && event.outcome === 'completed');
          const isDone = stage.id === 'quote' || Boolean(detail.order.historicalDelivery) || completed.includes(stage.id) || preapprovedAck;
          const isCurrent = !isDone && task?.task === stage.id;
          const stageEvent = stage.id !== 'quote' ? [...detail.events].reverse().find(event => event.task === stage.id && event.outcome === 'completed') : undefined;
          return (
            <li
              key={stage.id}
              aria-current={task?.task === stage.id ? 'step' : undefined}
              className={`rounded-2xl p-4 border transition-all flex flex-col justify-between ${
                isDone
                  ? 'bg-emerald-500/5 border-emerald-500/35 shadow-sm'
                  : isCurrent
                    ? 'bg-cyan-500/10 border-cyan-500/60 ring-1 ring-cyan-500/30 shadow-sm'
                    : 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] opacity-85'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[var(--border-color)]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-7 h-7 rounded-xl text-xs font-black flex items-center justify-center shrink-0 border ${
                      isDone
                        ? 'bg-emerald-500/20 text-emerald-500 border-emerald-500/40'
                        : isCurrent
                          ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50'
                          : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border-color)]'
                    }`}>
                      {index + 1}
                    </span>
                    <strong className="text-sm font-bold text-[var(--text-primary)] truncate">{stage.title}</strong>
                  </div>
                  <span aria-hidden="true" className={`material-symbols-outlined text-[18px] shrink-0 ${
                    isDone ? 'text-emerald-500' : isCurrent ? 'text-cyan-400' : 'text-[var(--text-secondary)]'
                  }`}>
                    {STAGE_ICONS[stage.id]}
                  </span>
                </div>

                {stage.id === 'quote' ? (
                  <OrderQuotationSummary order={detail.order} />
                ) : detail.order.historicalDelivery ? (
                  <HistoricalWorkflowStage order={detail.order} stage={stage.id} />
                ) : preapprovedAck ? (
                  <div className="text-xs mt-2.5 space-y-2">
                    <p className="inline-flex items-center gap-1.5 font-semibold px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-500">
                      <span aria-hidden="true" className="material-symbols-outlined text-[14px]">verified</span>
                      <span>Confirmación preaprobada</span>
                    </p>
                    <p className="text-[var(--text-secondary)] leading-relaxed">Orden en Pagado al activar los nuevos requisitos. No requiere comprobantes históricos.</p>
                    {detail.order.confirmationPolicyAt && <p className="text-[11px] font-medium text-[var(--text-primary)]">Activación: {new Date(detail.order.confirmationPolicyAt).toLocaleString()}</p>}
                  </div>
                ) : (
                  <div className="mt-2.5 space-y-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${
                          isDone
                            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-500'
                            : isCurrent
                              ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400'
                              : 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-secondary)]'
                        }`}
                      >
                        <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
                          {isDone ? 'check_circle' : isCurrent ? 'pending_actions' : 'schedule'}
                        </span>
                        <span>{isDone ? 'Completada con evidencia' : 'Pendiente de verificar'}</span>
                      </p>
                      {isCurrent && (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                          Paso actual
                        </span>
                      )}
                    </div>

                    {stageEvent ? (
                      <dl className="text-xs space-y-1.5 rounded-xl bg-[var(--bg-card)]/70 border border-[var(--border-color)] p-2.5">
                        <div className="flex flex-col gap-0.5">
                          <dt className="text-[11px] font-medium text-[var(--text-secondary)]">Fecha de verificación</dt>
                          <dd className="font-semibold text-[var(--text-primary)] tabular-nums">
                            {new Date(stageEvent.createdAt).toLocaleString('es', { timeZone: 'America/New_York' })}
                          </dd>
                        </div>
                        <div className="flex flex-col gap-0.5 pt-1.5 border-t border-[var(--border-color)]">
                          <dt className="text-[11px] font-medium text-[var(--text-secondary)]">Verificado por</dt>
                          <dd className="font-semibold text-[var(--text-primary)]">{stageEvent.actorName || 'Operador'}</dd>
                        </div>
                      </dl>
                    ) : (
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                        {isDone
                          ? STAGE_CAPTIONS[stage.id].done
                          : isCurrent
                            ? STAGE_CAPTIONS[stage.id].active
                            : STAGE_CAPTIONS[stage.id].pending}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {detail.order.preparation && (
        <div className="rounded-2xl p-4 sm:p-5 bg-gradient-to-r from-blue-950/30 via-slate-900/40 to-slate-900/60 border border-blue-500/30 text-sm space-y-3.5 shadow-sm">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2.5 border-b border-slate-800/80">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-blue-500/15 text-blue-400">
                <span aria-hidden="true" className="material-symbols-outlined text-xl">event_available</span>
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
                <span aria-hidden="true" className="material-symbols-outlined text-sm text-primary-400">
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
                <span aria-hidden="true" className="material-symbols-outlined text-sm">
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
                <span aria-hidden="true" className="material-symbols-outlined text-amber-400 text-sm">calendar_today</span>
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
                <span aria-hidden="true" className="material-symbols-outlined text-violet-400 text-sm">swap_horizontal_circle</span>
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
                <span aria-hidden="true" className="material-symbols-outlined text-cyan-400 text-sm">
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
              <span aria-hidden="true" className="material-symbols-outlined text-indigo-400 text-base mt-0.5 shrink-0">forum</span>
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
                  <span aria-hidden="true" className="material-symbols-outlined text-xs">image</span>
                  <span>Ver captura {idx + 1}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}</>}
      {view === 'followup' && (() => {
        const postMilestones = [
          {
            id: 'post_3' as const,
            day: 3,
            title: 'Día 3 · Recepción y Montaje',
            icon: 'inventory',
            caption: 'Confirmar que el cliente recibió la pieza y cuándo la instala su mecánico.',
          },
          {
            id: 'post_7' as const,
            day: 7,
            title: 'Día 7 · Verificación de Montaje',
            icon: 'build_circle',
            caption: 'Verificar que la pieza ya fue instalada y opera sin códigos ni fugas.',
          },
          {
            id: 'post_14' as const,
            day: 14,
            title: 'Día 14 · Cierre de Conformidad',
            icon: 'verified',
            caption: 'Confirmar satisfacción final y funcionamiento continuo dentro de garantía.',
          },
        ];
        const PART_STATUS_LABELS: Record<string, string> = {
          not_installed: 'Aún no instalada',
          in_process: 'En montaje',
          installed_ok: 'Instalada y funcionando',
          has_issues: 'Con observaciones',
          defect_claim: 'Posible defecto / Reclamo',
        };
        const assignee = workflowTaskAssignee(detail.order, 'post_3');
        const deliveredDateStr = detail.order.deliveredAt ? workflowDate(detail.order.deliveredAt) : null;
        const autoFinalized = Boolean(detail.order.postDeliveryFinalized);
        return (
          <div className="space-y-4">
            {autoFinalized && (
              <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-500 flex items-center justify-center shrink-0">
                    <span aria-hidden="true" className="material-symbols-outlined text-[22px]">task_alt</span>
                  </span>
                  <div className="space-y-0.5">
                    <strong className="text-sm font-bold text-[var(--text-primary)] block">
                      Seguimiento post-entrega finalizado correctamente por el sistema
                    </strong>
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                      Esta orden fue entregada antes de la activación del nuevo flujo de seguimiento post-entrega. Sus hitos quedaron cerrados automáticamente sin requerir llamadas pendientes.
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/35 px-3 py-1 text-xs font-bold text-emerald-500">
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px]">verified</span>
                  <span>Finalizado por sistema</span>
                </span>
              </div>
            )}

            {/* Post-Delivery Header Summary Card */}
            <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)]/50 p-4 grid gap-3 sm:grid-cols-3 text-xs">
              <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] p-3 flex items-center gap-3">
                <span className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                  <span aria-hidden="true" className="material-symbols-outlined text-[20px]">local_shipping</span>
                </span>
                <div className="min-w-0">
                  <span className="text-[11px] font-medium text-[var(--text-secondary)] block">Fecha de entrega</span>
                  <strong className="text-sm font-bold text-[var(--text-primary)] block truncate">
                    {detail.order.deliveredAt
                      ? new Date(detail.order.deliveredAt).toLocaleString('es', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })
                      : 'Pendiente de entregar'}
                  </strong>
                </div>
              </div>

              <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] p-3 flex items-center gap-3">
                <span className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 flex items-center justify-center shrink-0">
                  <span aria-hidden="true" className="material-symbols-outlined text-[20px]">verified_user</span>
                </span>
                <div className="min-w-0">
                  <span className="text-[11px] font-medium text-[var(--text-secondary)] block">Cobertura de garantía</span>
                  <strong className="text-sm font-bold text-[var(--text-primary)] block truncate">
                    {detail.order.warrantyTerms
                      ? `${detail.order.warrantyTerms.days} días · Vence ${
                          detail.order.warrantyTerms.policy === 'calendar'
                            ? warrantyDeadline(detail.order.warrantyTerms)
                            : new Date(Date.parse(detail.order.warrantyTerms.startedAt) + detail.order.warrantyTerms.days * 86400000).toLocaleDateString()
                        }`
                      : 'Inicia al registrar la entrega'}
                  </strong>
                </div>
              </div>

              <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] p-3 flex items-center gap-3">
                <span className="w-9 h-9 rounded-xl bg-purple-500/15 border border-purple-500/30 text-purple-400 flex items-center justify-center shrink-0">
                  <span aria-hidden="true" className="material-symbols-outlined text-[20px]">support_agent</span>
                </span>
                <div className="min-w-0">
                  <span className="text-[11px] font-medium text-[var(--text-secondary)] block">Responsable de seguimiento</span>
                  <strong className="text-sm font-bold text-[var(--text-primary)] block truncate">
                    {assignee.name || 'Por asignar'}
                  </strong>
                </div>
              </div>
            </div>

            {/* 3 Post-Delivery Milestone Cards */}
            <ol className="grid gap-3 sm:grid-cols-3">
              {postMilestones.map((m, idx) => {
                const doneEvent = [...detail.events].reverse().find(event => event.task === m.id && event.outcome === 'completed');
                const latestAttempt = [...detail.events].reverse().find(event => event.task === m.id);
                const isDone = Boolean(doneEvent) || autoFinalized;
                const isCurrent = !isDone && task?.task === m.id;
                const targetDate = deliveredDateStr ? shiftWorkflowDate(deliveredDateStr, m.day) : null;
                return (
                  <li
                    key={m.id}
                    aria-current={isCurrent ? 'step' : undefined}
                    className={`rounded-2xl p-4 border transition-all flex flex-col justify-between ${
                      isDone
                        ? 'bg-emerald-500/5 border-emerald-500/35 shadow-sm'
                        : isCurrent
                          ? 'bg-cyan-500/10 border-cyan-500/60 ring-1 ring-cyan-500/30 shadow-sm'
                          : 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] opacity-85'
                    }`}
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[var(--border-color)]">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`w-7 h-7 rounded-xl text-xs font-black flex items-center justify-center shrink-0 border ${
                            isDone
                              ? 'bg-emerald-500/20 text-emerald-500 border-emerald-500/40'
                              : isCurrent
                                ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50'
                                : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border-color)]'
                          }`}>
                            {idx + 1}
                          </span>
                          <strong className="text-sm font-bold text-[var(--text-primary)] truncate">{m.title}</strong>
                        </div>
                        <span aria-hidden="true" className={`material-symbols-outlined text-[18px] shrink-0 ${
                          isDone ? 'text-emerald-500' : isCurrent ? 'text-cyan-400' : 'text-[var(--text-secondary)]'
                        }`}>
                          {m.icon}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
                            isDone
                              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-500'
                              : isCurrent
                                ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400'
                                : 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-secondary)]'
                          }`}
                        >
                          <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
                            {isDone ? 'check_circle' : isCurrent ? 'pending_actions' : 'schedule'}
                          </span>
                          <span>
                            {doneEvent ? 'Verificado' : autoFinalized ? 'Finalizado por sistema' : isCurrent ? 'En seguimiento' : 'Pendiente'}
                          </span>
                        </span>
                        {targetDate && (
                          <span className="text-[11px] font-mono text-[var(--text-secondary)]">
                            Meta: {targetDate}
                          </span>
                        )}
                      </div>

                      {doneEvent ? (
                        <dl className="text-xs space-y-1.5 rounded-xl bg-[var(--bg-card)]/70 border border-[var(--border-color)] p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <dt className="text-[11px] text-[var(--text-secondary)]">Estado pieza</dt>
                            <dd className="font-bold text-emerald-400">
                              {doneEvent.partStatus ? PART_STATUS_LABELS[doneEvent.partStatus] || doneEvent.partStatus : 'Verificado'}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-2 pt-1 border-t border-[var(--border-color)]">
                            <dt className="text-[11px] text-[var(--text-secondary)]">Atendió</dt>
                            <dd className="font-semibold text-[var(--text-primary)] truncate">{doneEvent.actorName || 'Operador'}</dd>
                          </div>
                          <div className="flex items-center justify-between gap-2 pt-1 border-t border-[var(--border-color)]">
                            <dt className="text-[11px] text-[var(--text-secondary)]">Fecha</dt>
                            <dd className="font-mono text-[11px] text-[var(--text-primary)]">
                              {new Date(doneEvent.createdAt).toLocaleDateString('es', { timeZone: 'America/New_York' })}
                            </dd>
                          </div>
                        </dl>
                      ) : autoFinalized ? (
                        <dl className="text-xs space-y-1.5 rounded-xl bg-[var(--bg-card)]/70 border border-[var(--border-color)] p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <dt className="text-[11px] text-[var(--text-secondary)]">Estado</dt>
                            <dd className="font-bold text-emerald-500">Finalizado correctamente</dd>
                          </div>
                          <div className="flex items-center justify-between gap-2 pt-1 border-t border-[var(--border-color)]">
                            <dt className="text-[11px] text-[var(--text-secondary)]">Resolución</dt>
                            <dd className="font-semibold text-[var(--text-primary)] truncate">Cierre automático del sistema</dd>
                          </div>
                          <div className="flex items-center justify-between gap-2 pt-1 border-t border-[var(--border-color)]">
                            <dt className="text-[11px] text-[var(--text-secondary)]">Entrega</dt>
                            <dd className="font-mono text-[11px] text-[var(--text-primary)]">
                              {detail.order.deliveredAt
                                ? new Date(detail.order.deliveredAt).toLocaleDateString('es', { timeZone: 'America/New_York' })
                                : 'Registrada'}
                            </dd>
                          </div>
                        </dl>
                      ) : (
                        <div className="space-y-1.5">
                          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{m.caption}</p>
                          {latestAttempt && latestAttempt.outcome !== 'completed' && (
                            <p className="text-[11px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1.5">
                              Último intento ({latestAttempt.outcome === 'no_response' ? 'Sin respuesta' : latestAttempt.outcome === 'blocked' ? 'En espera / Taller' : 'Incidencia'}): próxima revisión {latestAttempt.nextDueDate || 'pendiente'}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })()}
      {view !== 'history' && (task ? <WorkflowActionForm key={`${orderId}-${detail.order.version}-${task.task}`} task={task} onSaved={reload} />
        : <p className="text-sm text-[var(--text-secondary)]">{view === 'followup' ? (detail.order.postDeliveryFinalized ? 'Seguimiento post-entrega finalizado correctamente por el sistema. Los registros históricos se conservan en Historial.' : 'Sin seguimiento pendiente. Los registros se conservan en Historial.') : 'Sin tarea comercial activa. Consulta Seguimiento post entrega o Historial.'}</p>)}
      {view === 'followup' && detail.order.historicalDelivery && !detail.order.deliveredAt && <p role="alert" className="text-sm text-amber-600">Falta la fecha de entrega registrada. Revisa el historial antes de programar seguimientos.</p>}
      {view === 'history' && (() => {
        const TASK_LABELS: Record<string, { label: string; icon: string }> = {
          quote: { label: 'Cotización inicial', icon: 'request_quote' },
          ack: { label: 'Confirmación de abono', icon: 'verified' },
          prepare: { label: 'Preparación y cita', icon: 'event_available' },
          delivery: { label: 'Entrega física', icon: 'local_shipping' },
          post_3: { label: 'Seguimiento · Día 3', icon: 'inventory' },
          post_7: { label: 'Seguimiento · Día 7', icon: 'build_circle' },
          post_14: { label: 'Seguimiento · Día 14', icon: 'verified_user' },
          incident: { label: 'Gestión de incidencia', icon: 'report_problem' },
        };
        const OUTCOME_BADGES: Record<string, { label: string; cls: string; icon: string }> = {
          completed: { label: 'Completada con evidencia', cls: 'bg-emerald-500/15 border-emerald-500/35 text-emerald-500', icon: 'check_circle' },
          no_response: { label: 'Sin respuesta · Reintento', cls: 'bg-amber-500/15 border-amber-500/35 text-amber-500', icon: 'phone_missed' },
          blocked: { label: 'En espera / Reprogramada', cls: 'bg-cyan-500/15 border-cyan-500/35 text-cyan-400', icon: 'schedule' },
          incident: { label: 'Incidencia / Alerta', cls: 'bg-rose-500/15 border-rose-500/35 text-rose-400', icon: 'warning' },
          reopened: { label: 'Etapa reabierta', cls: 'bg-purple-500/15 border-purple-500/35 text-purple-400', icon: 'restart_alt' },
        };
        const PART_STATUS_NAMES: Record<string, string> = {
          not_installed: 'Aún no instalada',
          in_process: 'En proceso de montaje',
          installed_ok: 'Instalada y funcionando',
          has_issues: 'Con observaciones',
          defect_claim: 'Posible defecto / Reclamo',
        };
        const CONTACT_RESULT_NAMES: Record<string, string> = {
          answered: 'Contestó la llamada',
          no_answer: 'No contestó / Buzón',
          busy: 'Línea ocupada',
          sms_replied: 'Respondió el mensaje',
          sms_sent: 'Mensaje enviado (en espera)',
          sms_no_reply: 'Mensaje sin respuesta',
          wrong_number: 'Número equivocado',
        };

        return (
          <div className="space-y-4">
            {detail.order.historicalDelivery && !detail.order.deliveredAt && (
              <p role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs font-semibold text-amber-500">
                La entrega no tiene fecha registrada. Revisa el historial antes de programar los seguimientos post-entrega.
              </p>
            )}

            {detail.order.postDeliveryFinalized && (
              <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-3.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-emerald-500">verified</span>
                  <div className="text-xs">
                    <strong className="font-bold text-emerald-500 block">5. Seguimiento Post-Entrega: Finalizado correctamente por el sistema</strong>
                    <span className="text-[11px] text-[var(--text-secondary)]">Orden entregada antes de la activación del nuevo flujo de seguimiento post-entrega.</span>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-500">
                  <span aria-hidden="true" className="material-symbols-outlined text-[13px]">check_circle</span>
                  <span>Finalizado por sistema</span>
                </span>
              </div>
            )}

            {!detail.events.length && (
              <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)]/50 p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                      detail.order.historicalDelivery
                        ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-500'
                        : 'bg-cyan-500/15 border-cyan-500/35 text-cyan-400'
                    }`}>
                      <span aria-hidden="true" className="material-symbols-outlined text-[20px]">
                        {detail.order.historicalDelivery ? 'verified' : 'fact_check'}
                      </span>
                    </span>
                    <div className="space-y-1">
                      <strong className="text-sm sm:text-base font-bold text-[var(--text-primary)] block">
                        {detail.order.historicalDelivery
                          ? 'Orden regularizada automáticamente por entrega histórica'
                          : 'Cotización inicial registrada al crear la orden'}
                      </strong>
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                        {detail.order.historicalDelivery
                          ? 'Flujo regularizado automáticamente desde el estado Entregado y su historial original. No se agregaron cobros ni gestiones ficticias.'
                          : 'Cotización registrada al crear la orden. Aún no hay gestiones de las etapas siguientes.'}
                      </p>
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border ${
                    detail.order.historicalDelivery
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-500'
                      : 'bg-cyan-500/15 border-cyan-500/30 text-cyan-400'
                  }`}>
                    <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
                      {detail.order.historicalDelivery ? 'check_circle' : 'schedule'}
                    </span>
                    <span>{detail.order.historicalDelivery ? 'Entregada en historial' : 'En etapa inicial'}</span>
                  </span>
                </div>

                {/* Summary grid of historical or initial timestamps */}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                  <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] p-3 space-y-1">
                    <span className="text-[11px] font-medium text-[var(--text-secondary)] flex items-center gap-1">
                      <span aria-hidden="true" className="material-symbols-outlined text-[14px] text-cyan-400">request_quote</span>
                      <span>1. Cotización</span>
                    </span>
                    <strong className="font-bold text-[var(--text-primary)] block tabular-nums">
                      {new Date(detail.order.createdAt).toLocaleString('es', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })}
                    </strong>
                    <span className="text-[11px] text-[var(--text-secondary)] block">
                      Agente: {detail.order.quoteCreatedBy || detail.order.advisor || 'No registrado'}
                    </span>
                  </div>

                  {detail.order.historicalDelivery && (
                    <>
                      <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] p-3 space-y-1">
                        <span className="text-[11px] font-medium text-[var(--text-secondary)] flex items-center gap-1">
                          <span aria-hidden="true" className="material-symbols-outlined text-[14px] text-emerald-500">payments</span>
                          <span>2. Estado Pagado</span>
                        </span>
                        <strong className="font-bold text-[var(--text-primary)] block tabular-nums">
                          {detail.order.historicalDelivery.paidAt
                            ? new Date(detail.order.historicalDelivery.paidAt).toLocaleString('es', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })
                            : 'Registrado en orden'}
                        </strong>
                        <span className="text-[11px] text-emerald-500 font-medium block">Respaldo histórico</span>
                      </div>

                      <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] p-3 space-y-1">
                        <span className="text-[11px] font-medium text-[var(--text-secondary)] flex items-center gap-1">
                          <span aria-hidden="true" className="material-symbols-outlined text-[14px] text-emerald-500">inventory_2</span>
                          <span>3. Preparación</span>
                        </span>
                        <strong className="font-bold text-[var(--text-primary)] block tabular-nums">
                          {detail.order.historicalDelivery.readyAt
                            ? new Date(detail.order.historicalDelivery.readyAt).toLocaleString('es', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })
                            : 'Regularizada al entregar'}
                        </strong>
                        <span className="text-[11px] text-emerald-500 font-medium block">Pieza verificada</span>
                      </div>

                      <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] p-3 space-y-1">
                        <span className="text-[11px] font-medium text-[var(--text-secondary)] flex items-center gap-1">
                          <span aria-hidden="true" className="material-symbols-outlined text-[14px] text-emerald-500">local_shipping</span>
                          <span>4. Entrega física</span>
                        </span>
                        <strong className="font-bold text-[var(--text-primary)] block tabular-nums">
                          {detail.order.historicalDelivery.deliveredAt
                            ? new Date(detail.order.historicalDelivery.deliveredAt).toLocaleString('es', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })
                            : 'Fecha en registro'}
                        </strong>
                        <span className="text-[11px] text-emerald-500 font-medium block">Flujo comercial cerrado</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {detail.events.length > 0 && (
              <div className="space-y-3">
                {[...detail.events].reverse().map(event => {
                  const contact = decodeCommunicationEvidence(event.evidence);
                  const reference = contact?.reference ?? event.evidence;
                  const taskMeta = TASK_LABELS[event.task] || { label: event.task, icon: 'event_note' };
                  const outcomeMeta = OUTCOME_BADGES[event.outcome] || {
                    label: event.outcome,
                    cls: 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-secondary)]',
                    icon: 'info',
                  };
                  const deliveryPhotosList = event.task === 'delivery' ? readDeliveryPhotos(event.evidence) : null;

                  return (
                    <article
                      key={event.id}
                      className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)]/60 p-4 text-sm space-y-3 shadow-sm"
                    >
                      {/* Event Card Header */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[var(--border-color)]">
                        <div className="flex items-center gap-2.5">
                          <span className="w-8 h-8 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] text-cyan-400 flex items-center justify-center shrink-0">
                            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{taskMeta.icon}</span>
                          </span>
                          <div>
                            <strong className="font-bold text-[var(--text-primary)] block leading-tight">
                              {taskMeta.label}
                            </strong>
                            <span className="text-xs text-[var(--text-secondary)]">
                              Registrado por <strong className="text-[var(--text-primary)]">{event.actorName || 'Operador'}</strong> · {new Date(event.createdAt).toLocaleString('es', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })}
                            </span>
                          </div>
                        </div>

                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${outcomeMeta.cls}`}>
                          <span aria-hidden="true" className="material-symbols-outlined text-[14px]">{outcomeMeta.icon}</span>
                          <span>{outcomeMeta.label}</span>
                        </span>
                      </div>

                      {/* Event Notes */}
                      {event.notes && (
                        <p className="text-xs sm:text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-3">
                          {event.notes}
                        </p>
                      )}

                      {/* Delivery Photos or Text Evidence */}
                      {deliveryPhotosList !== null ? (
                        <div className="flex flex-wrap gap-2">
                          {deliveryPhotosList.map((url, index) => (
                            <a
                              key={`${url}-${index}`}
                              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] text-cyan-400 hover:border-cyan-500/50 transition-all"
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <span aria-hidden="true" className="material-symbols-outlined text-[15px]">photo_camera</span>
                              <span>Ver imagen de entrega {index + 1}</span>
                            </a>
                          ))}
                        </div>
                      ) : (
                        reference && (
                          <div className="text-xs text-[var(--text-secondary)] bg-[var(--bg-card)]/70 border border-[var(--border-color)] rounded-xl p-2.5">
                            <strong className="text-[var(--text-primary)]">Evidencia / Referencia:</strong> {reference}
                          </div>
                        )
                      )}

                      {/* Post-Delivery Contact Metadata */}
                      {contact && (
                        <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] p-3 text-xs space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2.5 py-1 rounded-lg bg-[var(--bg-card-subtle)] border border-[var(--border-color)] font-semibold text-[var(--text-primary)]">
                              Canal: {({ call: '📞 Llamada', sms: '📱 SMS', whatsapp: '💬 WhatsApp' })[contact.communication.channel]}
                            </span>
                            {event.contactResult && (
                              <span className="px-2.5 py-1 rounded-lg bg-[var(--bg-card-subtle)] border border-[var(--border-color)] font-semibold text-[var(--text-primary)]">
                                Respuesta: {CONTACT_RESULT_NAMES[event.contactResult] || event.contactResult}
                              </span>
                            )}
                            {event.partStatus && (
                              <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 font-semibold text-emerald-500">
                                Pieza: {PART_STATUS_NAMES[event.partStatus] || event.partStatus}
                              </span>
                            )}
                          </div>
                          {contact.communication.warrantyWarningGiven && (
                            <p className="text-[var(--text-secondary)]">
                              🛡️ Advertencia de garantía comunicada {contact.communication.channel === 'call' ? 'verbalmente' : 'por escrito'}.
                            </p>
                          )}
                          {Boolean(contact.communication.screenshots?.length) && (
                            <div className="flex flex-wrap gap-2 pt-1">
                              {contact.communication.screenshots?.map((url, index) => (
                                <a
                                  key={`${url}-${index}`}
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-400 hover:underline"
                                  href={url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <span aria-hidden="true" className="material-symbols-outlined text-[14px]">image</span>
                                  <span>Ver captura de conversación {index + 1}</span>
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Downpayment Metadata */}
                      {Boolean(event.downpayment?.length) && (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {event.downpayment?.map((payment, index) => (
                            <div key={index} className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] p-2.5 text-xs flex items-center justify-between gap-2">
                              <div>
                                <strong className="text-[var(--text-primary)]">{DOWNPAYMENT_METHODS[payment.method]} · ${payment.amount.toFixed(2)}</strong>
                                {payment.method === 'cash' && <span className="block text-[var(--text-secondary)]">Recibió: {payment.receivedBy}</span>}
                              </div>
                              {payment.receipt && (
                                <a className="text-cyan-400 font-semibold hover:underline" href={payment.receipt} target="_blank" rel="noreferrer">
                                  Ver comprobante {index + 1}
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Preparation Metadata */}
                      {event.preparation && (
                        <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] p-3 text-xs space-y-1.5">
                          <p className="font-semibold text-[var(--text-primary)]">
                            {event.preparation.channel === 'in_person'
                              ? '🏪 Cliente presente · entrega inmediata en yarda'
                              : event.preparation.channel === 'call'
                                ? '📞 Llamada contestada'
                                : '💬 Mensaje de texto tras llamada sin respuesta'}
                          </p>
                          {event.preparation.channel === 'sms' && <p className="text-[var(--text-secondary)]">Intento de llamada: {event.preparation.failedCallNotes}</p>}
                          <p className="text-[var(--text-secondary)]">
                            Modalidad: <strong className="text-[var(--text-primary)]">{event.preparation.deliveryType === 'envio_domicilio' ? 'Delivery / envío' : 'Recogida en yarda'}</strong> · Fechas: {event.preparation.dateFrom} — {event.preparation.dateTo}
                          </p>
                          {event.preparation.deliveryType === 'envio_domicilio' && <p className="text-[var(--text-secondary)]">Dirección: {event.preparation.address}</p>}
                          <p className="text-[var(--text-secondary)]">
                            Core acordado: <strong className="text-[var(--text-primary)]">{event.preparation.corePlan === 'return_core' ? 'El cliente lo llevará' : 'El cliente lo pagará'}</strong>
                          </p>
                          {Boolean(event.preparation.screenshots.length) && (
                            <div className="flex flex-wrap gap-2 pt-1">
                              {event.preparation.screenshots.map((url, index) => (
                                <a key={`${url}-${index}`} className="text-cyan-400 font-semibold hover:underline" href={url} target="_blank" rel="noreferrer">
                                  Ver captura {index + 1}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {(event.nextAction || event.blockedBy) && (
                        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)] pt-1">
                          {event.nextAction && (
                            <span>
                              <strong className="text-[var(--text-primary)]">Próxima acción:</strong> {event.nextAction} {event.nextDueDate ? `(${event.nextDueDate})` : ''}
                            </span>
                          )}
                          {event.blockedBy && (
                            <span>
                              <strong className="text-[var(--text-primary)]">En espera de:</strong> {event.blockedBy}
                            </span>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            {Boolean(detail.contacts?.length) && (
              <div className="space-y-2.5 pt-2">
                <h3 className="text-sm font-bold text-[var(--text-primary)]">Registros de contacto post-entrega anteriores</h3>
                {detail.contacts?.map(contact => (
                  <article key={contact.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] p-3.5 text-xs space-y-1">
                    <strong className="text-[var(--text-primary)]">{contact.actor} · {new Date(contact.createdAt).toLocaleString()}</strong>
                    <p className="text-[var(--text-secondary)] whitespace-pre-wrap">{contact.notes}</p>
                  </article>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </>}
  </section>;
};
