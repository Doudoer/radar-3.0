import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Claim, ClaimCall, Order } from '../types';
import { ClaimCallsModal } from './ClaimCallsModal';
import { apiFetch } from '../services/apiFetch';
import { uploadAftersalesFile } from './OrderAftersales';
import { workflowResponse } from './OrderWorkflowPanel';
import { workflowDate } from '../utils/orderWorkflow';

export type ClaimQuickAction =
  | ''
  | 'claim_review'
  | 'claim_resolution'
  | 'claim_resolved'
  | 'claim_replacement'
  | 'claim_denied'
  | 'refund_create';

interface ClaimDetailViewProps {
  claim: Claim;
  order?: Order;
  userRole?: string;
  initialAction?: ClaimQuickAction;
  onBack: () => void;
  onCallAdded: (call: ClaimCall) => void;
  onResolve: () => void;
  onReloadClaims?: () => Promise<void> | void;
  onSelectOrder?: (orderId: string) => void;
  embedded?: boolean;
}

interface OrderAftersalesSummary {
  version: number;
  canManage: boolean;
  canAdmin: boolean;
  paid: number;
  refunded: number;
  reserved: number;
  claims: {
    id: number;
    status: string;
    stage: string | null;
    description: string;
    resolution_notes: string | null;
    next_review_date: string | null;
    evidence_files: string[];
    assigned_user_id: number | null;
  }[];
}

const ACTION_QUICK_NOTES: Record<Exclude<ClaimQuickAction, ''>, string[]> = {
  claim_review: [
    'Se contactó al cliente y se solicitó evidencia fotográfica/video de la falla.',
    'Caso en evaluación con el equipo de yarda para diagnóstico técnico.',
    'Cliente llevará el vehículo al mecánico para confirmar códigos de diagnóstico.',
  ],
  claim_resolution: [
    'Se confirma aplicación de garantía; en preparación de pieza o acuerdo con cliente.',
    'Se coordina ingreso de pieza a yarda para validación física final.',
  ],
  claim_resolved: [
    'Incidencia resuelta satisfactoriamente en revisión técnica con el cliente.',
    'Falla descartada tras ajuste de instalación; pieza operando correctamente.',
  ],
  claim_replacement: [
    'Se entrega pieza de reemplazo verificada en yarda y se notifica al cliente.',
  ],
  claim_denied: [
    'Garantía denegada por manipulación externa o instalación fuera de norma.',
    'Reclamo improcedente tras verificación técnica de los sellos de garantía.',
  ],
  refund_create: [
    'Sin stock disponible para reemplazo de pieza en garantía; se solicita devolución.',
    'Devolución acordada tras diagnóstico definitivo del reclamo de garantía.',
  ],
};

const CALL_QUICK_NOTES = [
  'Se contactó al cliente; enviará fotos o video de la falla.',
  'Cliente informa que el mecánico está revisando la pieza en el taller.',
  'Se explicó diagnóstico técnico y pasos de garantía al cliente.',
  'Llamada sin respuesta; se dejó mensaje de voz y mensaje de texto de seguimiento.',
  'Se acordó con el cliente la solución del reclamo y fecha de seguimiento.',
];

const STATUS_BADGE: Record<string, { label: string; cls: string; icon: string }> = {
  Pending: {
    label: 'Pendiente de revisión',
    cls: 'bg-[var(--state-urgency-tint)] border-[var(--state-urgency-border)] text-[var(--state-urgency-text)]',
    icon: 'schedule',
  },
  'In Process': {
    label: 'En revisión técnica',
    cls: 'bg-[var(--brand-soft)] border-[var(--brand)] text-[var(--brand)]',
    icon: 'build_circle',
  },
  Resolved: {
    label: 'Resuelto',
    cls: 'bg-[var(--bg-card-subtle)] border-[var(--positive)] text-[var(--positive)]',
    icon: 'check_circle',
  },
  Denied: {
    label: 'Garantía denegada',
    cls: 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] text-[var(--text-secondary)]',
    icon: 'cancel',
  },
};

const STAGE_LABELS: Record<string, string> = {
  registered: '1. Apertura registrada',
  review: '2. En revisión y diagnóstico',
  resolution: '2. En preparación de solución',
  resolved: '3. Resuelto sin reemplazo',
  replacement: '3. Resuelto con pieza de reemplazo',
  refunded: '3. Resuelto mediante reembolso',
  denied: '3. Garantía denegada',
};

const addDaysIso = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return workflowDate(d);
};

const safeFileUrl = (url: string): string => {
  const trimmed = String(url || '').trim();
  if (trimmed.startsWith('/uploads/') || trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed;
  }
  return '#';
};

export const ClaimDetailView: React.FC<ClaimDetailViewProps> = ({
  claim,
  order,
  userRole = 'operator',
  initialAction = '',
  onBack,
  onCallAdded,
  onResolve,
  onReloadClaims,
  onSelectOrder,
  embedded = false,
}) => {
  const [isCallsOpen, setIsCallsOpen] = useState(false);

  // Live Aftersales state for direct claim management
  const [aftersales, setAftersales] = useState<OrderAftersalesSummary | null>(null);
  const [actionMode, setActionMode] = useState<ClaimQuickAction>(initialAction);
  const [notes, setNotes] = useState('');
  const [nextDate, setNextDate] = useState(() => addDaysIso(1));
  const [notified, setNotified] = useState(true);
  const [replacementStock, setReplacementStock] = useState('');
  const [replacementConfirmed, setReplacementConfirmed] = useState(true);
  const [refundAmount, setRefundAmount] = useState('');
  const [pieceRequired, setPieceRequired] = useState(true);
  const [files, setFiles] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  // Inline Call Log state
  const [calls, setCalls] = useState<ClaimCall[]>(claim.calls || []);
  const [callerName, setCallerName] = useState(claim.customerName);
  const [callerPhone, setCallerPhone] = useState(claim.customerPhone);
  const [attendedBy, setAttendedBy] = useState(claim.advisor || 'Sin asignar');
  const [showContactEdit, setShowContactEdit] = useState(false);
  const [callSummary, setCallSummary] = useState('');
  const [savingCall, setSavingCall] = useState(false);
  const [callError, setCallError] = useState('');
  const [callSuccess, setCallSuccess] = useState('');
  const uploadLock = useRef(false);

  useEffect(() => {
    setCalls(claim.calls || []);
    setCallerName(claim.customerName);
    setCallerPhone(claim.customerPhone);
    setAttendedBy(claim.advisor || 'Sin asignar');
  }, [claim]);

  useEffect(() => {
    if (initialAction) {
      setActionMode(initialAction);
    }
  }, [initialAction]);

  const numericClaimId = Number(String(claim.id).replace(/^REC-/i, ''));

  const loadAftersales = useCallback(async () => {
    if (!claim.orderId) return;
    try {
      const response = await apiFetch(`/orders/${claim.orderId}/aftersales`);
      if (response.ok) {
        const data = (await response.json()) as OrderAftersalesSummary;
        setAftersales(data);
      }
    } catch {
      // Fallback to claim props if aftersales fetch fails
    }
  }, [claim.orderId]);

  useEffect(() => {
    void loadAftersales();
  }, [loadAftersales]);

  const liveClaim = aftersales?.claims.find((c) => Number(c.id) === numericClaimId);
  const liveStatus = liveClaim?.status || claim.status;
  const liveStage =
    liveClaim?.stage ||
    claim.stage ||
    (liveStatus === 'Resolved'
      ? 'resolved'
      : liveStatus === 'Denied'
      ? 'denied'
      : liveStatus === 'In Process'
      ? 'review'
      : 'registered');
  const liveResolutionNotes = liveClaim?.resolution_notes ?? claim.resolutionNotes ?? '';
  const liveNextReview = (liveClaim?.next_review_date || claim.nextReviewDate || '').slice(0, 10);
  const liveEvidence = liveClaim?.evidence_files || claim.evidenceFiles || [];
  const isClosed = ['Resolved', 'Denied'].includes(liveStatus);
  const canAdmin = aftersales ? aftersales.canAdmin : userRole === 'admin';
  const canManage = aftersales ? aftersales.canManage : ['admin', 'operator'].includes(userRole);

  const stepIndex = isClosed
    ? 3
    : liveStage === 'resolution' || liveStage === 'review'
    ? 2
    : 1;

  const orderTotal = order?.financials?.total ?? 0;
  const orderDownPayment = aftersales?.paid ?? order?.financials?.downPayment ?? 0;
  const orderBalance =
    order?.financials?.balanceDue ?? Math.max(0, orderTotal - (order?.financials?.downPayment ?? 0));
  const availableToRefund = aftersales
    ? Math.max(0, Number((aftersales.paid - aftersales.refunded - aftersales.reserved).toFixed(2)))
    : orderDownPayment;

  const selectAction = (nextMode: ClaimQuickAction) => {
    setActionMode(nextMode);
    setActionError('');
    setActionSuccess('');
    setNotes('');
    setFiles([]);
    if (nextMode === 'refund_create' && availableToRefund > 0) {
      setRefundAmount(availableToRefund.toFixed(2));
    }
  };

  const handleUploadEvidence = async (file: File) => {
    if (uploadLock.current || !claim.orderId) return;
    if (files.length >= 10) {
      setActionError('Máximo 10 soportes por gestión.');
      return;
    }
    uploadLock.current = true;
    setUploading(true);
    setActionError('');
    try {
      const uploadedUrl = await uploadAftersalesFile(String(claim.orderId), file);
      setFiles((prev) => [...prev, uploadedUrl]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Error al subir archivo.');
    } finally {
      uploadLock.current = false;
      setUploading(false);
    }
  };

  const postAftersalesStep = async (version: number, payloadData: Record<string, unknown>) => {
    await workflowResponse(
      await apiFetch(`/orders/${claim.orderId}/aftersales`, {
        method: 'POST',
        body: JSON.stringify({
          version,
          idempotencyKey: crypto.randomUUID(),
          data: payloadData,
        }),
      })
    );
  };

  const handleSaveClaimAction = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!actionMode || !claim.orderId) return;
    const cleanNotes = notes.trim();
    if (cleanNotes.length < 8) {
      setActionError('Escribe un detalle o diagnóstico de al menos 8 caracteres (o usa un botón de nota rápida).');
      return;
    }

    setBusyAction(true);
    setActionError('');
    setActionSuccess('');

    try {
      let currentVersion = aftersales?.version ?? order?.version ?? 1;
      const reviewDate = nextDate || addDaysIso(1);

      if (actionMode === 'refund_create') {
        const amt = Number(refundAmount);
        if (!amt || amt <= 0) {
          throw new Error('Indica un importe válido a reembolsar.');
        }
        await postAftersalesStep(currentVersion, {
          action: 'refund_create',
          claimId: numericClaimId,
          amount: amt,
          pieceRequired,
          notes: cleanNotes,
          files,
        });
        setActionSuccess('Solicitud de reembolso creada correctamente.');
      } else {
        const targetStage =
          actionMode === 'claim_review'
            ? 'review'
            : actionMode === 'claim_resolution'
            ? 'resolution'
            : actionMode === 'claim_resolved'
            ? 'resolved'
            : actionMode === 'claim_replacement'
            ? 'replacement'
            : 'denied';

        // Automatically fulfill intermediate stage transitions if the claim is still in 'registered' or 'review'
        let stageCursor = liveStage || 'registered';

        if (stageCursor === 'registered' && targetStage !== 'review') {
          await postAftersalesStep(currentVersion, {
            action: 'claim_update',
            id: numericClaimId,
            stage: 'review',
            notes: cleanNotes,
            nextDate: reviewDate,
            notified: false,
            files: [],
          });
          currentVersion += 1;
          stageCursor = 'review';
        }

        if (stageCursor === 'review' && targetStage === 'replacement') {
          await postAftersalesStep(currentVersion, {
            action: 'claim_update',
            id: numericClaimId,
            stage: 'resolution',
            notes: cleanNotes,
            nextDate: reviewDate,
            notified: false,
            files: [],
          });
          currentVersion += 1;
        }

        const isClosing = ['resolved', 'denied', 'replacement'].includes(targetStage);
        await postAftersalesStep(currentVersion, {
          action: 'claim_update',
          id: numericClaimId,
          stage: targetStage,
          notes: cleanNotes,
          nextDate: isClosing ? undefined : reviewDate,
          notified: isClosing ? notified : false,
          replacementStock: targetStage === 'replacement' ? replacementStock.trim() : undefined,
          confirmed: targetStage === 'replacement' ? replacementConfirmed : undefined,
          files,
        });

        setActionSuccess(
          isClosing
            ? 'Reclamo cerrado y actualizado correctamente.'
            : 'Avance del reclamo guardado correctamente.'
        );
      }

      setActionMode('');
      setNotes('');
      setFiles([]);
      window.dispatchEvent(new Event('radar:data-changed'));
      await loadAftersales();
      await onReloadClaims?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo guardar la gestión del reclamo.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleSaveCall = async (event: React.FormEvent) => {
    event.preventDefault();
    const summary = callSummary.trim();
    if (!summary) {
      setCallError('Escribe o selecciona un resumen de la llamada.');
      return;
    }

    setSavingCall(true);
    setCallError('');
    setCallSuccess('');
    try {
      const response = await apiFetch(`/claims/${claim.id}/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callerName: callerName.trim() || claim.customerName,
          callerPhone: callerPhone.trim() || claim.customerPhone,
          attendedBy: attendedBy.trim() || claim.advisor || 'Asesor de Garantías',
          conversationSummary: summary,
          whatsappDispatched: false,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'No se pudo guardar la llamada.');
      }

      const created = (await response.json()) as ClaimCall;
      const newCall: ClaimCall = {
        ...created,
        callNumber: created.callNumber || calls.length + 1,
      };
      setCalls((prev) => [newCall, ...prev]);
      setCallSummary('');
      setCallSuccess('Llamada registrada en la bitácora.');
      onCallAdded(newCall);
    } catch (err) {
      setCallError(err instanceof Error ? err.message : 'No se pudo guardar la llamada.');
    } finally {
      setSavingCall(false);
    }
  };

  const statusMeta = STATUS_BADGE[liveStatus] || {
    label: liveStatus,
    cls: 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] text-[var(--text-secondary)]',
    icon: 'info',
  };

  const headerActions = (
    <>
      {onSelectOrder && order && (
        <button
          type="button"
          onClick={() => onSelectOrder(order.id)}
          className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] text-[var(--text-primary)] px-3.5 py-2 text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">visibility</span>
          <span>Ver Orden</span>
        </button>
      )}
      <button
        type="button"
        onClick={() => setIsCallsOpen(true)}
        className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] text-[var(--text-primary)] px-3.5 py-2 text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[16px]">phone_in_talk</span>
        <span>Ver Bitácora ({calls.length})</span>
      </button>
      <button
        type="button"
        onClick={onResolve}
        className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] text-[var(--text-primary)] px-3.5 py-2 text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors"
        title="Abrir vista completa de garantías, core e invoice de la orden"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[16px]">shield_with_heart</span>
        <span>Post-venta de la orden</span>
      </button>
    </>
  );

  const statusPill = (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border ${statusMeta.cls}`}
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[14px]">{statusMeta.icon}</span>
      <span>{statusMeta.label}</span>
    </span>
  );

  return (
    <div className={embedded ? 'text-[var(--text-primary)] space-y-5' : 'radar-view horizon-view text-[var(--text-primary)] pb-10 space-y-5'}>
      {/* 1. HEADER */}
      {embedded ? (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {statusPill}
            <span className="rounded-full border border-[var(--border-color)] bg-[var(--bg-card-subtle)] px-2.5 py-0.5 text-xs font-semibold text-[var(--text-secondary)]">
              Prioridad {claim.priority}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">{headerActions}</div>
        </div>
      ) : (
        <div className="horizon-view-header">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between w-full">
            <div className="flex items-start gap-3.5">
              <button
                type="button"
                onClick={onBack}
                className="mt-0.5 rounded-xl p-2 bg-[var(--bg-card-subtle)] border border-[var(--border-color)] text-[var(--brand)] hover:bg-[var(--brand-soft)] transition-all cursor-pointer"
                title="Volver a reclamos"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[20px]">arrow_back</span>
              </button>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl md:text-2xl font-black text-[var(--text-primary)] tracking-tight">
                    Detalle de Reclamo
                  </h1>
                  <span className="rounded-lg border border-[var(--brand)] bg-[var(--brand-soft)] px-2.5 py-0.5 font-mono text-xs font-bold text-[var(--brand)]">
                    {claim.id}
                  </span>
                  {statusPill}
                  <span className="rounded-full border border-[var(--border-color)] bg-[var(--bg-card-subtle)] px-2.5 py-0.5 text-xs font-semibold text-[var(--text-secondary)]">
                    Prioridad {claim.priority}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--text-secondary)] flex flex-wrap items-center gap-2">
                  <span>
                    Orden <strong className="font-mono text-[var(--brand)]">{claim.orderCode}</strong>
                  </span>
                  <span>•</span>
                  <strong className="text-[var(--text-primary)]">{claim.customerName}</strong>
                  <span>•</span>
                  <span>
                    {claim.vehicle} ({claim.mainPart})
                  </span>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pl-11 sm:pl-0">{headerActions}</div>
          </div>
        </div>
      )}

      {/* 2. RUTA VISUAL DE 3 ETAPAS + GESTIÓN DIRECTA DEL RECLAMO */}
      <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-[var(--state-urgency-tint)] border border-[var(--state-urgency-border)] text-[var(--state-urgency-text)] flex items-center justify-center shrink-0">
              <span aria-hidden="true" className="material-symbols-outlined text-[20px]">route</span>
            </span>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-[var(--text-primary)]">
                Progreso y Resolución del Reclamo
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Etapa actual: <strong className="text-[var(--text-primary)]">{STAGE_LABELS[liveStage] || liveStage}</strong>
                {liveNextReview && !isClosed && (
                  <>
                    {' '}
                    · Próxima revisión:{' '}
                    <strong className="text-[var(--brand)] tabular-nums">{liveNextReview}</strong>
                  </>
                )}
              </p>
            </div>
          </div>

          {isClosed && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${
                liveStatus === 'Resolved'
                  ? 'bg-[var(--bg-card-subtle)] border-[var(--positive)] text-[var(--positive)]'
                  : 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] text-[var(--text-secondary)]'
              }`}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[15px]">
                {liveStatus === 'Resolved' ? 'verified' : 'block'}
              </span>
              <span>
                {liveStatus === 'Resolved' ? 'Caso cerrado y resuelto' : 'Caso cerrado (Denegado)'}
              </span>
            </span>
          )}
        </div>

        {/* 3-Step Visual Progress Bar */}
        <div className="grid gap-2.5 sm:grid-cols-3 text-xs">
          {[
            {
              num: 1,
              title: '1. Apertura del Reclamo',
              desc: `Abierto el ${new Date(claim.createdAt).toLocaleDateString('es-ES')} · Estatus previo: ${claim.previousOrderStatus || 'entregado'}`,
              icon: 'flag',
            },
            {
              num: 2,
              title: '2. Revisión y Diagnóstico',
              desc:
                stepIndex >= 2
                  ? `${calls.length} llamada(s) · ${liveResolutionNotes ? 'Diagnóstico registrado' : 'En evaluación técnica'}`
                  : 'Pendiente de registrar revisión técnica o contacto',
              icon: 'biotech',
            },
            {
              num: 3,
              title: '3. Solución Verificable',
              desc: isClosed
                ? STAGE_LABELS[liveStage] || statusMeta.label
                : 'Resolver sin reemplazo, entregar reemplazo, reembolsar o denegar',
              icon: 'verified',
            },
          ].map((step) => {
            const done = stepIndex > step.num || (isClosed && step.num === 3);
            const active = !isClosed && stepIndex === step.num;
            return (
              <div
                key={step.num}
                className={`rounded-xl border p-3.5 space-y-1 transition-all ${
                  done
                    ? 'bg-[var(--bg-card-subtle)] border-[var(--positive)]'
                    : active
                    ? 'bg-[var(--brand-soft)] border-[var(--brand)]'
                    : 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] opacity-75'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <strong
                    className={`font-bold flex items-center gap-1.5 ${
                      done
                        ? 'text-[var(--positive)]'
                        : active
                        ? 'text-[var(--brand)]'
                        : 'text-[var(--text-primary)]'
                    }`}
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{step.icon}</span>
                    <span>{step.title}</span>
                  </strong>
                  <span aria-hidden="true"
                    className={`material-symbols-outlined text-[16px] ${
                      done ? 'text-[var(--positive)]' : active ? 'text-[var(--brand)]' : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    {done ? 'check_circle' : active ? 'radio_button_checked' : 'schedule'}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{step.desc}</p>
              </div>
            );
          })}
        </div>

        {actionSuccess && (
          <div
            role="status"
            className="rounded-xl border border-[var(--positive)] bg-[var(--bg-card-subtle)] p-3 text-xs font-bold text-[var(--positive)] flex items-center gap-2"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">check_circle</span>
            <span>{actionSuccess}</span>
          </div>
        )}

        {/* Direct Action Selector Buttons (When Open) */}
        {canManage && !isClosed && (
          <div className="space-y-3 pt-1 border-t border-[var(--border-color)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-[var(--brand)]">bolt</span>
                <span>Gestionar o resolver este reclamo ahora (1 clic):</span>
              </span>
              {actionMode && (
                <button
                  type="button"
                  onClick={() => selectAction('')}
                  className="text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  Cerrar formulario
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {[
                {
                  id: 'claim_review' as const,
                  label: '1. Registrar revisión / diagnóstico',
                  icon: 'biotech',
                  cls: 'border-[var(--border-color)] bg-[var(--bg-card-subtle)] text-[var(--text-primary)] hover:border-[var(--brand)] hover:text-[var(--brand)]',
                  show: true,
                },
                {
                  id: 'claim_resolution' as const,
                  label: '2. Preparar resolución',
                  icon: 'handyman',
                  cls: 'border-[var(--border-color)] bg-[var(--bg-card-subtle)] text-[var(--text-primary)] hover:border-[var(--brand)] hover:text-[var(--brand)]',
                  show: true,
                },
                {
                  id: 'claim_resolved' as const,
                  label: '3. Resolver sin reemplazo',
                  icon: 'check_circle',
                  cls: 'border-[var(--border-color)] bg-[var(--bg-card-subtle)] text-[var(--text-primary)] hover:border-[var(--brand)] hover:text-[var(--brand)]',
                  show: true,
                },
                {
                  id: 'claim_replacement' as const,
                  label: '3. Entregar reemplazo',
                  icon: 'published_with_changes',
                  cls: 'border-[var(--border-color)] bg-[var(--bg-card-subtle)] text-[var(--text-primary)] hover:border-[var(--brand)] hover:text-[var(--brand)]',
                  show: canAdmin,
                },
                {
                  id: 'refund_create' as const,
                  label: 'Solicitar reembolso',
                  icon: 'currency_exchange',
                  cls: 'border-[var(--state-urgency-border)] bg-[var(--bg-card-subtle)] text-[var(--state-urgency-text)] hover:bg-[var(--state-urgency-tint)]',
                  show: true,
                },
                {
                  id: 'claim_denied' as const,
                  label: 'Denegar garantía',
                  icon: 'cancel',
                  cls: 'border-[var(--state-destructive)] bg-[var(--bg-card-subtle)] text-[var(--state-destructive)] hover:opacity-80',
                  show: canAdmin,
                },
              ]
                .filter((btn) => btn.show)
                .map((btn) => {
                  const selected = actionMode === btn.id;
                  return (
                    <button
                      key={btn.id}
                      type="button"
                      onClick={() => selectAction(selected ? '' : btn.id)}
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-bold transition-all cursor-pointer ${
                        selected
                          ? 'ring-2 ring-[var(--brand)] bg-[var(--brand-soft)] border-[var(--brand)] text-[var(--text-primary)]'
                          : btn.cls
                      }`}
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{btn.icon}</span>
                      <span>{btn.label}</span>
                    </button>
                  );
                })}
            </div>

            {/* Inline Action Form */}
            {actionMode && (
              <form
                onSubmit={handleSaveClaimAction}
                className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] p-4 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[var(--border-color)]">
                  <strong className="text-xs sm:text-sm font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                    <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-[var(--brand)]">edit_note</span>
                    <span>
                      {actionMode === 'claim_review' && 'Registrar revisión técnica / diagnóstico'}
                      {actionMode === 'claim_resolution' && 'Preparar resolución del reclamo'}
                      {actionMode === 'claim_resolved' && 'Cerrar reclamo como Resuelto (sin reemplazo)'}
                      {actionMode === 'claim_replacement' && 'Cerrar reclamo entregando pieza de reemplazo'}
                      {actionMode === 'claim_denied' && 'Cerrar reclamo denegando la garantía'}
                      {actionMode === 'refund_create' && 'Solicitar reembolso de compra por garantía'}
                    </span>
                  </strong>
                  <span className="text-[11px] text-[var(--text-secondary)]">
                    Se actualiza automáticamente en la orden #{claim.orderCode}
                  </span>
                </div>

                {/* Quick Note Chips */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-[var(--text-secondary)] block">
                    Plantillas rápidas (1 clic para rellenar):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {ACTION_QUICK_NOTES[actionMode].map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setNotes((prev) => (prev.trim() ? `${prev.trim()} ${chip}` : chip))}
                        className="inline-flex min-h-8 items-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--brand)] hover:text-[var(--text-primary)] cursor-pointer transition-colors text-left"
                      >
                        + {chip}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Specific fields for Review / Resolution: Next Date with 1-click pills */}
                {(actionMode === 'claim_review' || actionMode === 'claim_resolution') && (
                  <div className="grid gap-3 sm:grid-cols-2 items-end">
                    <label className="block text-xs font-semibold text-[var(--text-secondary)]">
                      Próxima fecha de revisión
                      <input
                        type="date"
                        required
                        min={workflowDate(new Date())}
                        value={nextDate}
                        onChange={(e) => setNextDate(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--brand)]"
                      />
                    </label>
                    <div className="flex flex-wrap gap-1.5 pb-0.5">
                      {[
                        { label: 'Hoy', days: 0 },
                        { label: 'Mañana', days: 1 },
                        { label: 'En 2 días', days: 2 },
                        { label: 'En 3 días', days: 3 },
                        { label: 'Próxima semana', days: 7 },
                      ].map((d) => {
                        const iso = addDaysIso(d.days);
                        return (
                          <button
                            key={d.label}
                            type="button"
                            onClick={() => setNextDate(iso)}
                            className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold cursor-pointer transition-all ${
                              nextDate === iso
                                ? 'bg-[var(--brand-soft)] border-[var(--brand)] text-[var(--brand)]'
                                : 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                            }`}
                          >
                            {d.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Specific fields for Replacement */}
                {actionMode === 'claim_replacement' && (
                  <div className="grid gap-3 sm:grid-cols-2 items-center">
                    <label className="block text-xs font-semibold text-[var(--text-secondary)]">
                      Stock o identificación de la pieza de reemplazo
                      <input
                        type="text"
                        required
                        placeholder="Ej. STK-4920 / VIN donante"
                        value={replacementStock}
                        onChange={(e) => setReplacementStock(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--brand)]"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)] pt-4 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={replacementConfirmed}
                        onChange={(e) => setReplacementConfirmed(e.target.checked)}
                        className="rounded border-[var(--border-color)]"
                      />
                      <span>Confirmo que la pieza de reemplazo fue entregada físicamente</span>
                    </label>
                  </div>
                )}

                {/* Specific fields for Refund Request */}
                {actionMode === 'refund_create' && (
                  <div className="grid gap-3 sm:grid-cols-2 items-end">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-[var(--text-secondary)]">
                        Importe a reembolsar (Disponible: ${availableToRefund.toFixed(2)})
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          max={availableToRefund > 0 ? availableToRefund : undefined}
                          required
                          value={refundAmount}
                          onChange={(e) => setRefundAmount(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2 text-xs font-mono font-bold text-[var(--text-primary)] outline-none focus:border-[var(--brand)]"
                        />
                      </label>
                      {availableToRefund > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => setRefundAmount(availableToRefund.toFixed(2))}
                            className="rounded-lg border border-[var(--brand)] bg-[var(--brand-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--brand)] cursor-pointer"
                          >
                            100% Disponible (${availableToRefund.toFixed(2)})
                          </button>
                          <button
                            type="button"
                            onClick={() => setRefundAmount((availableToRefund / 2).toFixed(2))}
                            className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-secondary)] cursor-pointer"
                          >
                            50% (${(availableToRefund / 2).toFixed(2)})
                          </button>
                        </div>
                      )}
                    </div>

                    <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)] pb-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={pieceRequired}
                        onChange={(e) => setPieceRequired(e.target.checked)}
                        className="rounded border-[var(--border-color)]"
                      />
                      <span>Requiere devolver físicamente la pieza reclamada a yarda</span>
                    </label>
                  </div>
                )}

                {/* Notes Textarea */}
                <label className="block text-xs font-semibold text-[var(--text-secondary)]">
                  Diagnóstico, acuerdos o sustento de la decisión
                  <textarea
                    required
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Describe el diagnóstico técnico, acuerdo con el cliente o motivo de resolución..."
                    className="mt-1 w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--brand)]"
                  />
                </label>

                {/* Closing Notification Checkbox */}
                {['claim_resolved', 'claim_replacement', 'claim_denied'].includes(actionMode) && (
                  <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notified}
                      onChange={(e) => setNotified(e.target.checked)}
                      className="rounded border-[var(--border-color)]"
                    />
                    <span>Confirmo que ya se notificó esta resolución al cliente</span>
                  </label>
                )}

                {/* Optional Evidence Upload */}
                <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3 space-y-2">
                  <label className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-[var(--text-secondary)]">
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-[var(--brand)]">attach_file</span>
                      <span>Adjuntar foto o PDF de evidencia (opcional)</span>
                    </span>
                    <input
                      type="file"
                      disabled={uploading || busyAction}
                      accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
                      onChange={(e) => {
                        const f = e.currentTarget.files?.[0];
                        e.currentTarget.value = '';
                        if (f) void handleUploadEvidence(f);
                      }}
                      className="text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-[var(--brand-soft)] file:px-2.5 file:py-1 file:text-xs file:font-bold file:text-[var(--brand)] cursor-pointer"
                    />
                  </label>
                  {uploading && <p className="text-xs text-[var(--brand)] font-semibold">Subiendo evidencia…</p>}
                  {files.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {files.map((url, idx) => (
                        <span
                          key={url}
                          className="inline-flex items-center gap-2 rounded-lg border border-[var(--brand)] bg-[var(--brand-soft)] px-2.5 py-1 text-xs"
                        >
                          <a href={safeFileUrl(url)} target="_blank" rel="noopener noreferrer" className="font-bold text-[var(--brand)] hover:underline">
                            Evidencia {idx + 1}
                          </a>
                          <button
                            type="button"
                            onClick={() => setFiles((prev) => prev.filter((item) => item !== url))}
                            className="text-[var(--state-destructive)] font-bold cursor-pointer"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {actionError && (
                  <p role="alert" className="rounded-xl border border-[var(--danger)] bg-[var(--bg-card-subtle)] p-2.5 text-xs font-bold text-[var(--danger)]">
                    {actionError}
                  </p>
                )}

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => selectAction('')}
                    className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] text-[var(--text-primary)] px-4 py-2 text-xs font-bold cursor-pointer hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={busyAction || uploading}
                    className="horizon-primary rounded-xl px-5 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">save</span>
                    <span>{busyAction ? 'Guardando…' : 'Confirmar y guardar'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </section>

      {/* 3. MAIN 2-COLUMN WORKSPACE: LEFT (DIAGNÓSTICO + ORDEN + CLIENTE) | RIGHT (BITÁCORA DE LLAMADAS EN VIVO) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
        {/* LEFT COLUMN (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          {/* Motivo Reportado & Diagnóstico */}
          <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5 space-y-4">
            <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
              <span aria-hidden="true" className="material-symbols-outlined text-[var(--warning)] text-[20px]">report_problem</span>
              <span>Seguimiento del Reclamo & Diagnóstico</span>
            </h2>

            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] p-3.5 text-xs space-y-1">
              <span className="font-bold text-[var(--warning)] block uppercase text-[11px]">
                Motivo reportado por el cliente:
              </span>
              <p className="text-[var(--text-primary)] text-xs sm:text-sm font-medium leading-relaxed">
                {claim.claimReason}
              </p>
            </div>

            {liveResolutionNotes && (
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] p-3.5 text-xs space-y-1">
                <span className="font-bold text-[var(--brand)] block uppercase text-[11px]">
                  Último diagnóstico / acuerdo registrado:
                </span>
                <p className="text-[var(--text-primary)] text-xs sm:text-sm font-medium leading-relaxed">
                  {liveResolutionNotes}
                </p>
              </div>
            )}

            {liveEvidence.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold uppercase text-[var(--text-secondary)] block">
                  Soportes y evidencias del reclamo:
                </span>
                <div className="flex flex-wrap gap-2">
                  {liveEvidence.map((url, idx) => (
                    <a
                      key={url}
                      href={safeFileUrl(url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--brand)] bg-[var(--brand-soft)] px-3 py-1.5 text-xs font-bold text-[var(--brand)] hover:underline"
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[15px]">attachment</span>
                      <span>Ver evidencia {idx + 1}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] p-3">
                <span className="block text-[11px] font-medium text-[var(--text-secondary)]">Prioridad</span>
                <strong className="text-[var(--warning)] font-bold text-sm">{claim.priority}</strong>
              </div>
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] p-3">
                <span className="block text-[11px] font-medium text-[var(--text-secondary)]">Llamadas Registradas</span>
                <strong className="text-[var(--brand)] font-bold text-sm">{calls.length} llamadas</strong>
              </div>
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] p-3">
                <span className="block text-[11px] font-medium text-[var(--text-secondary)]">Fecha de Apertura</span>
                <strong className="text-[var(--text-primary)] font-bold text-sm">
                  {new Date(claim.createdAt).toLocaleDateString('es-ES')}
                </strong>
              </div>
            </div>
          </section>

          {/* Detalles de la Orden y Datos del Cliente */}
          <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5 space-y-4">
            <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
              <span aria-hidden="true" className="material-symbols-outlined text-[var(--brand)] text-[20px]">inventory_2</span>
              <span>Detalles de la Orden y Datos del Cliente</span>
            </h2>

            <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
              <div className="p-3 rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)]">
                <span className="text-[var(--text-secondary)] block text-[11px]">Código Orden:</span>
                <strong className="font-mono text-[var(--brand)] text-sm">{claim.orderCode}</strong>
              </div>
              <div className="p-3 rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)]">
                <span className="text-[var(--text-secondary)] block text-[11px]">Estatus anterior:</span>
                <strong className="text-[var(--text-primary)] text-xs font-bold">{claim.previousOrderStatus || 'N/A'}</strong>
              </div>
              <div className="p-3 rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)]">
                <span className="text-[var(--text-secondary)] block text-[11px]">Vehículo:</span>
                <strong className="text-[var(--text-primary)] text-xs font-bold">{claim.vehicle}</strong>
              </div>
              <div className="p-3 rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)]">
                <span className="text-[var(--text-secondary)] block text-[11px]">VIN:</span>
                <strong className="font-mono text-[var(--text-primary)] text-xs">
                  {claim.vin || order?.vehicle?.vin || '-'}
                </strong>
              </div>
              <div className="p-3 rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)]">
                <span className="text-[var(--text-secondary)] block text-[11px]">Pieza / Repuesto:</span>
                <strong className="text-[var(--brand)] text-xs font-bold">{claim.mainPart}</strong>
              </div>
              <div className="p-3 rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)]">
                <span className="text-[var(--text-secondary)] block text-[11px]">Stock:</span>
                <strong className="font-mono text-[var(--text-primary)] text-xs">{claim.stockNumber || '-'}</strong>
              </div>
              <div className="p-3 rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)]">
                <span className="text-[var(--text-secondary)] block text-[11px]">Total Facturado:</span>
                <strong className="text-[var(--text-primary)] font-mono text-xs">${orderTotal.toFixed(2)} USD</strong>
              </div>
              <div className="p-3 rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)]">
                <span className="text-[var(--text-secondary)] block text-[11px]">Balance Pendiente:</span>
                <strong className="text-[var(--text-primary)] font-mono text-xs">${orderBalance.toFixed(2)} USD</strong>
              </div>
            </div>

            {/* Datos del Cliente integrados */}
            <div className="pt-3 border-t border-[var(--border-color)]">
              <h3 className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
                <span aria-hidden="true" className="material-symbols-outlined text-[var(--brand)] text-[16px]">person</span>
                <span>Datos del Cliente</span>
              </h3>
              <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
                <div className="p-3 rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)]">
                  <span className="text-[var(--text-secondary)] block text-[11px]">Nombre / Razón Social:</span>
                  <strong className="text-[var(--text-primary)] text-xs font-bold">{claim.customerName}</strong>
                </div>
                <div className="p-3 rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)]">
                  <span className="text-[var(--text-secondary)] block text-[11px]">Teléfono de Contacto:</span>
                  <strong className="font-mono text-[var(--brand)] text-xs">{claim.customerPhone}</strong>
                </div>
                <div className="p-3 rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)]">
                  <span className="text-[var(--text-secondary)] block text-[11px]">Asesor Asignado:</span>
                  <strong className="text-[var(--text-primary)] text-xs font-bold">{claim.advisor}</strong>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN (5 cols): BITÁCORA DE LLAMADAS Y CONVERSACIONES EN VIVO */}
        <section className="lg:col-span-5 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--border-color)]">
            <div className="flex items-center gap-2">
              <span className="w-9 h-9 rounded-xl bg-[var(--brand-soft)] border border-[var(--brand)] text-[var(--brand)] flex items-center justify-center shrink-0">
                <span aria-hidden="true" className="material-symbols-outlined text-[20px]">phone_in_talk</span>
              </span>
              <div>
                <h2 className="text-sm font-bold text-[var(--text-primary)]">Bitácora de Llamadas en Vivo</h2>
                <p className="text-[11px] text-[var(--text-secondary)]">
                  Registra llamadas y acuerdos sin salir del reclamo
                </p>
              </div>
            </div>
            <span className="rounded-full bg-[var(--brand-soft)] border border-[var(--brand)] px-2.5 py-0.5 text-xs font-bold text-[var(--brand)] tabular-nums">
              {calls.length} {calls.length === 1 ? 'llamada' : 'llamadas'}
            </span>
          </div>

          {calls.length >= 3 && !isClosed && (
            <div className="flex gap-2.5 rounded-xl border border-[var(--state-urgency-border)] bg-[var(--state-urgency-tint)] p-3 text-xs text-[var(--state-urgency-text)]">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px] shrink-0">warning</span>
              <div>
                <strong className="block font-bold">Seguimiento prioritario ({calls.length} llamadas)</strong>
                <span>Este reclamo sigue abierto y requiere definir su resolución.</span>
              </div>
            </div>
          )}

          {/* Formulario Rápido de Llamada */}
          <form
            onSubmit={handleSaveCall}
            className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] p-3.5 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-[var(--brand)] flex items-center gap-1">
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">add_call</span>
                <span>Nueva nota de llamada / mensaje</span>
              </span>
              <button
                type="button"
                onClick={() => setShowContactEdit((prev) => !prev)}
                className="inline-flex min-h-6 items-center text-[11px] font-semibold text-[var(--text-secondary)] hover:text-[var(--brand)] cursor-pointer"
              >
                {showContactEdit ? 'Ocultar contacto' : `${callerName} · ${callerPhone} (Editar)`}
              </button>
            </div>

            {showContactEdit && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input
                  required
                  value={callerName}
                  onChange={(e) => setCallerName(e.target.value)}
                  placeholder="Contacto"
                  className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--brand)]"
                />
                <input
                  required
                  value={callerPhone}
                  onChange={(e) => setCallerPhone(e.target.value)}
                  placeholder="Teléfono"
                  className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--brand)]"
                />
                <input
                  required
                  value={attendedBy}
                  onChange={(e) => setAttendedBy(e.target.value)}
                  placeholder="Atendió"
                  className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--brand)]"
                />
              </div>
            )}

            {/* 1-Click Call Chips */}
            <div className="space-y-1">
              <span className="text-[11px] font-semibold text-[var(--text-secondary)] block">
                Respuestas rápidas (1 clic):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {CALL_QUICK_NOTES.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() =>
                      setCallSummary((prev) => (prev.trim() ? `${prev.trim()} ${chip}` : chip))
                    }
                    className="inline-flex min-h-8 items-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:border-[var(--brand)] hover:text-[var(--text-primary)] cursor-pointer transition-colors text-left"
                  >
                    + {chip}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              required
              rows={3}
              value={callSummary}
              onChange={(e) => setCallSummary(e.target.value)}
              placeholder="Escribe el resumen de la llamada, qué indicó el cliente y el próximo acuerdo..."
              className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--brand)]"
            />

            {callError && (
              <p role="alert" className="text-xs font-semibold text-[var(--danger)]">
                {callError}
              </p>
            )}
            {callSuccess && (
              <p role="status" className="text-xs font-semibold text-[var(--positive)]">
                {callSuccess}
              </p>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingCall}
                className="horizon-primary rounded-xl px-4 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">save</span>
                <span>{savingCall ? 'Guardando…' : 'Registrar llamada'}</span>
              </button>
            </div>
          </form>

          {/* Historial de llamadas */}
          <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
            {calls.length === 0 ? (
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] p-6 text-center text-xs text-[var(--text-secondary)]">
                Aún no hay llamadas registradas en este reclamo. Usa los botones rápidos de arriba para registrar el primer contacto.
              </div>
            ) : (
              calls.map((call, index) => (
                <article
                  key={call.id}
                  className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] p-3.5 text-xs space-y-1.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-[var(--brand-soft)] border border-[var(--brand)] px-2 py-0.5 font-mono text-[11px] font-bold text-[var(--brand)]">
                        Llamada #{call.callNumber || calls.length - index}
                      </span>
                      <strong className="text-[var(--text-primary)]">{call.callerName}</strong>
                    </div>
                    <time className="text-[11px] text-[var(--text-secondary)] tabular-nums">
                      {new Date(call.createdAt).toLocaleString('es-ES', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </time>
                  </div>
                  <p className="border-l-2 border-[var(--brand)] pl-2.5 text-[var(--text-primary)] leading-relaxed">
                    {call.conversationSummary}
                  </p>
                  <p className="text-[11px] text-[var(--text-secondary)]">
                    Atendido por <strong className="text-[var(--text-primary)]">{call.attendedBy}</strong>
                  </p>
                </article>
              ))
            )}
          </div>
        </section>
      </div>

      <ClaimCallsModal
        claim={{ ...claim, calls, callCount: calls.length }}
        isOpen={isCallsOpen}
        onClose={() => setIsCallsOpen(false)}
        onCallAdded={(newCall) => {
          setCalls((prev) => [newCall, ...prev]);
          onCallAdded(newCall);
        }}
      />
    </div>
  );
};
