import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../services/apiFetch';
import type { Order } from '../types';
import { aftersalesActionSchema, type AftersalesAction, type AftersalesData, type RefundExecution } from '../utils/aftersales';
import { workflowDate } from '../utils/orderWorkflow';
import { WarrantyCountdown } from './WarrantyCountdown';
import { uploadOrderFile } from '../services/orderFiles';

const field = 'flex flex-col gap-1.5 text-xs sm:text-sm font-medium text-[var(--text-primary)]';
const inputCls = 'rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-cyan-400 transition-colors';
const button = 'cyber-btn-secondary rounded-xl px-3.5 py-2 text-xs font-bold disabled:opacity-50 cursor-pointer transition-all';
const primaryButton = 'horizon-primary rounded-xl px-4 py-2 text-xs font-bold disabled:opacity-50 cursor-pointer transition-all';
const card = 'min-w-0 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 sm:p-5 space-y-4 shadow-sm';
const dateLabel = (value: string) => value.split('-').reverse().join('/');

function StatusBadge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'positive' | 'warning' | 'danger' }) {
  const color = tone === 'neutral' ? 'var(--text-secondary)' : `var(--${tone})`;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold border"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 32%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}

function CardHeading({ icon, title, subtitle, children }: { icon: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-[var(--border-color)]">
      <div className="flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 flex items-center justify-center shrink-0">
          <span aria-hidden="true" className="material-symbols-outlined text-[19px]">{icon}</span>
        </span>
        <div>
          <h3 className="font-bold text-sm sm:text-base text-[var(--text-primary)] leading-tight">{title}</h3>
          {subtitle && <p className="text-xs text-[var(--text-secondary)] mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

const stamp = (value: string | null) =>
  value ? new Date(value).toLocaleString('es', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) : 'No registrada';

const stageLabel: Record<string, string> = {
  registered: 'Registrado',
  review: 'En revisión',
  resolution: 'Resolución pendiente',
  resolved: 'Resuelto',
  denied: 'Rechazado',
  replacement: 'Reemplazo entregado',
  requested: 'Solicitado',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  completed: 'Dinero devuelto',
  pending: 'Pendiente',
  cancelled: 'Cancelado',
  refunded: 'Resuelto por reembolso',
};

const MODE_META: Record<string, { title: string; subtitle: string; icon: string }> = {
  warranty_correct: {
    title: 'Corregir duración de garantía',
    subtitle: 'Ajusta los días de cobertura dejando constancia auditable del motivo.',
    icon: 'edit_calendar',
  },
  claim_create: {
    title: 'Abrir nuevo reclamo de garantía',
    subtitle: 'Registra el reporte del cliente, adjunta evidencias y programa la fecha de revisión.',
    icon: 'report_problem',
  },
  claim_review: {
    title: 'Registrar revisión / comunicación de reclamo',
    subtitle: 'Documenta el contacto con el cliente o el diagnóstico del taller mecánico.',
    icon: 'manage_search',
  },
  claim_resolution: {
    title: 'Preparar resolución técnica del reclamo',
    subtitle: 'Define el dictamen técnico antes de entregar reemplazo, resolver o reembolsar.',
    icon: 'build_circle',
  },
  claim_resolved: {
    title: 'Cerrar reclamo sin reemplazo',
    subtitle: 'Confirma que la incidencia quedó solucionada y que el cliente fue notificado.',
    icon: 'task_alt',
  },
  claim_replacement: {
    title: 'Confirmar entrega de pieza de reemplazo',
    subtitle: 'Registra el Stock # de reemplazo. Iniciará automáticamente una nueva cobertura de garantía.',
    icon: 'swap_horiz',
  },
  claim_denied: {
    title: 'Denegar reclamo de garantía',
    subtitle: 'Registra el motivo técnico por el cual no procede la cobertura y confirma aviso al cliente.',
    icon: 'cancel',
  },
  refund_create: {
    title: 'Solicitar reembolso de compra',
    subtitle: 'Reserva el monto solicitado dentro del saldo cobrado disponible para su revisión y aprobación.',
    icon: 'currency_exchange',
  },
  refund_review: {
    title: 'Iniciar revisión de reembolso',
    subtitle: 'Valida el motivo de devolución, estado de la pieza y saldo cobrado en la orden.',
    icon: 'fact_check',
  },
  refund_approved: {
    title: 'Aprobar importe de reembolso',
    subtitle: 'Autoriza el monto para que administración pueda ejecutar y registrar la devolución del dinero.',
    icon: 'verified',
  },
  refund_completed: {
    title: 'Registrar dinero devuelto al cliente',
    subtitle: 'Registra el método de devolución, receptor o comprobante bancario para cerrar el reembolso.',
    icon: 'payments',
  },
  refund_rejected: {
    title: 'Rechazar solicitud de reembolso',
    subtitle: 'Libera el saldo reservado y deja constancia del motivo del rechazo.',
    icon: 'block',
  },
  core_receive: {
    title: 'Registrar recepción física del Core (Casco)',
    subtitle: 'Confirma que el cliente entregó la pieza usada en yarda para habilitar la devolución de su depósito.',
    icon: 'inventory_2',
  },
  core_refund: {
    title: 'Devolver depósito del Core al cliente',
    subtitle: 'El depósito de Core se devuelve únicamente en Efectivo o mediante tarjeta en Square.',
    icon: 'published_with_changes',
  },
};

const QUICK_NOTES_BY_MODE: Record<string, string[]> = {
  claim_create: [
    'Cliente reporta falla o ruido en la pieza tras el montaje.',
    'Taller del cliente reporta código de falla; se solicita evidencia.',
    'Incidencia de compatibilidad reportada durante la instalación.',
  ],
  claim_review: [
    'Se habló con el cliente y se solicitó video/diagnóstico del mecánico.',
    'Evidencia recibida; en validación técnica con encargado de yarda.',
    'Se intentó contactar al cliente para seguimiento; pendiente de respuesta.',
  ],
  claim_resolution: [
    'Se autoriza cambio físico de pieza por garantía vigente.',
    'Falla descartada por taller; la pieza opera dentro de parámetros.',
    'Sin stock para reemplazo; se procede a gestionar reembolso.',
  ],
  claim_resolved: [
    'Cliente confirma que la pieza quedó funcionando correctamente tras ajuste.',
    'Incidencia resuelta satisfactoriamente en revisión con el cliente.',
  ],
  claim_replacement: [
    'Se entrega pieza de reemplazo verificada en yarda y se notifica al cliente.',
  ],
  claim_denied: [
    'Garantía denegada por manipulación externa o instalación fuera de norma.',
    'Reclamo improcedente tras verificación técnica de los sellos de garantía.',
  ],
  refund_create: [
    'Sin stock disponible para reemplazo de pieza en garantía.',
    'Cancelación de orden acordada con el cliente antes de entrega.',
    'Devolución autorizada tras diagnóstico de reclamo de garantía.',
  ],
  refund_review: [
    'Solicitud en revisión financiera y verificación de recepción de pieza.',
  ],
  refund_approved: [
    'Importe verificado contra cobros registrados; autorizado para devolución.',
  ],
  refund_completed: [
    'Devolución de dinero ejecutada y comprobante entregado al cliente.',
  ],
  refund_rejected: [
    'Solicitud rechazada por no cumplir condiciones de devolución de pieza.',
  ],
  core_receive: [
    'Casco (Core) recibido físicamente en yarda en condiciones aceptables.',
  ],
};

export const uploadAftersalesFile = (orderId: string, file: File) => uploadOrderFile(orderId, file, true);

const SupportFields: React.FC<{
  orderId: string;
  value: string[];
  onChange: (value: string[]) => void;
  pdfOnly?: boolean;
  onBusy: (busy: boolean) => void;
}> = ({ orderId, value, onChange, pdfOnly, onBusy }) => {
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const lock = useRef(false);
  const upload = async (file: File) => {
    if (lock.current) return;
    if (pdfOnly && file.type !== 'application/pdf') {
      setError('El invoice debe ser PDF.');
      return;
    }
    if (value.length >= 10) {
      setError('Máximo 10 soportes por gestión.');
      return;
    }
    lock.current = true;
    setUploading(true);
    onBusy(true);
    setError('');
    try {
      onChange([...value, await uploadAftersalesFile(orderId, file)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Error al subir el soporte.');
    } finally {
      lock.current = false;
      setUploading(false);
      onBusy(false);
    }
  };
  return (
    <div className="space-y-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3">
      <label className={field}>
        <span className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-primary)]">
          <span className="material-symbols-outlined text-[16px] text-cyan-400">attach_file</span>
          <span>{pdfOnly ? 'Invoice PDF' : 'Soportes PDF o imágenes (opcional)'}</span>
        </span>
        <input
          type="file"
          className="min-w-0 w-full max-w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-cyan-500/15 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-cyan-400 hover:file:bg-cyan-500/25 cursor-pointer"
          disabled={uploading}
          accept={pdfOnly ? 'application/pdf' : 'application/pdf,image/jpeg,image/png,image/webp,image/gif'}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void upload(file);
          }}
        />
      </label>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {value.map((url, index) => (
            <div
              key={url}
              className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-xs"
            >
              <a className="font-semibold text-cyan-400 hover:underline" href={url} target="_blank" rel="noreferrer">
                Ver soporte {index + 1}
              </a>
              <button
                type="button"
                className="text-rose-400 hover:text-rose-300 font-bold cursor-pointer"
                disabled={uploading}
                onClick={() => onChange(value.filter((item) => item !== url))}
              >
                Quitar
              </button>
            </div>
          ))}
        </div>
      )}
      {uploading && <p role="status" className="text-xs text-cyan-400 font-semibold">Subiendo soporte…</p>}
      {error && <p role="alert" className="text-xs text-red-500 font-semibold">{error}</p>}
    </div>
  );
};

function ExecutionFields({
  orderId,
  core,
  customerName,
  value,
  onChange,
  onBusy,
}: {
  orderId: string;
  core: boolean;
  customerName?: string;
  value: Partial<RefundExecution>;
  onChange: (value: Partial<RefundExecution>) => void;
  onBusy: (busy: boolean) => void;
}) {
  const method = value.method || 'cash';
  const methodOptions = [
    { id: 'cash', label: 'Efectivo', icon: 'payments' },
    { id: 'square', label: 'Square (Tarjeta)', icon: 'credit_card' },
    ...(!core
      ? [
          { id: 'zelle', label: 'Zelle', icon: 'bolt' },
          { id: 'cashapp', label: 'Cash App', icon: 'attach_money' },
          { id: 'transfer', label: 'Transferencia', icon: 'account_balance' },
        ]
      : []),
  ] as const;

  return (
    <section className="space-y-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3.5">
      <div className="space-y-2">
        <label className={field}>
          <span>Método de devolución</span>
          <select
            className={inputCls}
            value={method}
            onChange={(event) => onChange({ method: event.target.value as RefundExecution['method'], confirmed: true })}
          >
            <option value="cash">Efectivo</option>
            <option value="square">Tarjeta mediante Square</option>
            {!core && (
              <>
                <option value="zelle">Zelle</option>
                <option value="cashapp">Cash App</option>
                <option value="transfer">Transferencia</option>
              </>
            )}
          </select>
        </label>

        {/* Visual 1-click method selector pills */}
        <div className="flex flex-wrap gap-1.5">
          {methodOptions.map((opt) => {
            const active = method === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChange({ method: opt.id as RefundExecution['method'], confirmed: true })}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                  active
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-400 shadow-sm'
                    : 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span className="material-symbols-outlined text-[15px]">{opt.icon}</span>
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {method === 'cash' ? (
        <div className="space-y-2">
          <label className={field}>
            <span>Persona que recibe el efectivo</span>
            <input
              required
              minLength={2}
              maxLength={200}
              className={inputCls}
              placeholder="Nombre completo de quien recibe el dinero"
              value={'recipient' in value ? value.recipient || '' : ''}
              onChange={(event) => onChange({ method: 'cash', recipient: event.target.value, confirmed: true })}
            />
          </label>
          {customerName && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-[var(--text-secondary)]">Selección rápida:</span>
              <button
                type="button"
                onClick={() => onChange({ method: 'cash', recipient: customerName, confirmed: true })}
                className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 font-semibold text-emerald-500 hover:bg-emerald-500/20 cursor-pointer"
              >
                👤 Cliente: {customerName}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-500 font-medium">
            Realiza la devolución en el proveedor antes de confirmarla aquí. Radar solo registra la operación.
          </p>
          {method === 'square' && (
            <label className={field}>
              <span>Últimos 4 dígitos de la tarjeta utilizada</span>
              <input
                required
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                className={inputCls}
                placeholder="Ej. 1234"
                value={'last4' in value ? value.last4 || '' : ''}
                onChange={(event) => onChange({ ...value, last4: event.target.value } as Partial<RefundExecution>)}
              />
            </label>
          )}
          <label className={field}>
            <span>Referencia de la devolución</span>
            <input
              required
              minLength={2}
              maxLength={200}
              className={inputCls}
              placeholder="ID de transacción o folio del proveedor"
              value={'reference' in value ? value.reference || '' : ''}
              onChange={(event) => onChange({ ...value, reference: event.target.value } as Partial<RefundExecution>)}
            />
          </label>
          <SupportFields
            orderId={orderId}
            value={'receipt' in value && value.receipt ? [value.receipt] : []}
            onBusy={onBusy}
            onChange={(files) => onChange({ ...value, receipt: files[files.length - 1] } as Partial<RefundExecution>)}
          />
        </div>
      )}
    </section>
  );
}

export const OrderAftersalesPanel: React.FC<{ order: Order }> = ({ order }) => {
  const [detail, setDetail] = useState<(AftersalesData & { version: number }) | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mode, setMode] = useState('');
  const [target, setTarget] = useState(0);
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [nextDate, setNextDate] = useState(workflowDate(new Date()));
  const [notified, setNotified] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [stock, setStock] = useState('');
  const [amount, setAmount] = useState('');
  const [pieceRequired, setPieceRequired] = useState(false);
  const [execution, setExecution] = useState<Partial<RefundExecution>>({ method: 'cash', confirmed: true });
  const lock = useRef(false);
  const key = useRef<string | null>(null);
  const generation = useRef(0);
  const invoiceForm = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (mode !== 'invoice') return;
    invoiceForm.current?.scrollIntoView({ block: 'nearest' });
    invoiceForm.current?.querySelector<HTMLInputElement>('input[type="file"]')?.focus({ preventScroll: true });
  }, [mode]);

  const load = useCallback(async () => {
    const requestId = ++generation.current;
    try {
      const response = await apiFetch(`/orders/${order.id}/aftersales`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'No se pudo cargar la posventa.');
      if (requestId === generation.current) {
        setDetail(body);
        setError('');
      }
    } catch (reason) {
      if (requestId === generation.current) setError(reason instanceof Error ? reason.message : 'Error al cargar la posventa.');
    }
  }, [order.id]);

  useEffect(() => {
    void load();
    const refresh = () => {
      void load();
    };
    window.addEventListener('radar:data-changed', refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => {
      generation.current++;
      window.clearInterval(timer);
      window.removeEventListener('radar:data-changed', refresh);
    };
  }, [load]);

  const open = (action: string, id = 0) => {
    setMode(action);
    setTarget(id);
    setNotes('');
    setFiles([]);
    setNotified(false);
    setConfirmed(false);
    setStock('');
    setAmount('');
    setPieceRequired(false);
    setExecution({ method: 'cash', confirmed: true });
    key.current = null;
    setError('');
    setMessage('');
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (lock.current || uploading || !detail) return;
    let data: unknown;
    if (mode === 'invoice') data = { action: mode, file: files[0] };
    if (mode === 'warranty_correct') data = { action: mode, days: Number(amount), notes };
    if (mode === 'claim_create') data = { action: mode, notes, files, nextDate };
    if (mode.startsWith('claim_') && mode !== 'claim_create')
      data = {
        action: 'claim_update',
        id: target,
        stage: mode.slice(6),
        notes,
        files,
        notified,
        nextDate,
        replacementStock: stock || undefined,
        confirmed,
      };
    if (mode === 'refund_create') data = { action: mode, amount: Number(amount), notes, files, pieceRequired };
    if (mode.startsWith('refund_') && mode !== 'refund_create')
      data = {
        action: 'refund_update',
        id: target,
        stage: mode.slice(7),
        notes,
        pieceReceived: confirmed,
        execution: mode === 'refund_completed' ? execution : undefined,
      };
    if (mode === 'core_receive') data = { action: mode, notes, files, confirmed };
    if (mode === 'core_refund') data = { action: mode, execution };
    const parsed = aftersalesActionSchema.safeParse(data);
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' · '));
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(`/orders/${order.id}/aftersales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: detail.version,
          idempotencyKey: (key.current ??= crypto.randomUUID()),
          data: parsed.data,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        key.current = null;
        throw new Error(body.message || 'No se pudo guardar la gestión.');
      }
      setMode('');
      setMessage('Gestión registrada. Fecha, hora y responsable guardados automáticamente.');
      window.dispatchEvent(new Event('radar:data-changed'));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Error al guardar.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const actionButton = (text: string, action: string, id = 0, variant: 'secondary' | 'primary' = 'secondary') => (
    <button
      type="button"
      className={variant === 'primary' ? primaryButton : button}
      disabled={busy || uploading}
      onClick={() => open(action, id)}
    >
      {text}
    </button>
  );

  const availableToRefund = detail ? Math.max(0, Number((detail.paid - detail.refunded - detail.reserved).toFixed(2))) : 0;
  const activeMeta = MODE_META[mode] || {
    title: 'Registrar gestión verificable',
    subtitle: 'Completa los campos requeridos para guardar la gestión con respaldo auditable.',
    icon: 'fact_check',
  };
  const quickNotes = QUICK_NOTES_BY_MODE[mode] || [];

  return (
    <section id="order-aftersales" className="horizon-view-card space-y-5 scroll-mt-6">
      {/* Section Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[21px]">shield_person</span>
          </span>
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-[var(--text-primary)] leading-tight">
              Garantía, reclamos y devoluciones
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Control verificable de cobertura posventa, incidencias técnicas, reembolsos y depósito de Core
            </p>
          </div>
        </div>
        <button
          type="button"
          className="cyber-btn-secondary rounded-xl px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          onClick={() => void load()}
        >
          <span className="material-symbols-outlined text-[15px]">refresh</span>
          <span>Actualizar posventa</span>
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs sm:text-sm font-semibold text-red-500 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" className="underline font-bold" onClick={() => void load()}>
            Actualizar
          </button>
        </p>
      )}
      {message && (
        <p role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs sm:text-sm font-semibold text-emerald-500">
          {message}
        </p>
      )}

      {!detail ? (
        <p className="text-sm text-[var(--text-secondary)]">Cargando posventa…</p>
      ) : (
        <>
          {/* 1. GARANTÍA DE LA PIEZA */}
          <section aria-label="Garantía de la pieza" className={card}>
            <CardHeading
              icon="verified_user"
              title="Garantía de la pieza"
              subtitle="Vigencia calculada a partir de la entrega física confirmada"
            >
              <StatusBadge
                tone={
                  detail.warranty.status === 'expired'
                    ? 'danger'
                    : detail.warranty.status === 'critical'
                      ? 'warning'
                      : detail.warranty.status === 'active'
                        ? 'positive'
                        : 'neutral'
                }
              >
                {
                  ({
                    not_started: 'Sin iniciar',
                    active: 'Vigente',
                    critical: 'Próxima a vencer',
                    expired: 'Vencida',
                  } as Record<string, string>)[detail.warranty.status]
                }
              </StatusBadge>
            </CardHeading>

            <WarrantyCountdown terms={detail.warranty.terms} />

            {order.status === 'reembolsado' && (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500 font-medium">
                Compra reembolsada. La cobertura se muestra como registro histórico; no permite abrir otro reclamo de esta venta.
              </p>
            )}

            {detail.warranty.terms && (
              <dl className="grid gap-3 sm:grid-cols-3 text-xs sm:text-sm">
                <div className="rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] p-3">
                  <dt className="text-xs text-[var(--text-secondary)]">Duración de cobertura</dt>
                  <dd className="mt-1 text-base font-bold text-[var(--text-primary)]">{detail.warranty.terms.days} días</dd>
                </div>
                <div className="rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] p-3">
                  <dt className="text-xs text-[var(--text-secondary)]">Inicio de garantía</dt>
                  <dd className="mt-1 font-semibold text-[var(--text-primary)]">{stamp(detail.warranty.terms.startedAt)}</dd>
                </div>
                <div className="rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] p-3">
                  <dt className="text-xs text-[var(--text-secondary)]">Fecha de vencimiento</dt>
                  <dd className="mt-1 font-semibold text-[var(--text-primary)]">
                    {detail.warranty.terms.policy === 'calendar' ? (
                      <>
                        {detail.warranty.deadline ? dateLabel(detail.warranty.deadline) : 'Sin fecha verificable'}
                        <span className="block text-[11px] font-normal text-[var(--text-secondary)]">
                          Al finalizar el día · Nueva York
                        </span>
                      </>
                    ) : (
                      stamp(new Date(Date.parse(detail.warranty.terms.startedAt) + detail.warranty.terms.days * 86400000).toISOString())
                    )}
                  </dd>
                </div>
              </dl>
            )}

            <details className="text-xs sm:text-sm space-y-2.5 rounded-xl bg-[var(--bg-card-subtle)]/60 border border-[var(--border-color)] p-3">
              <summary className="cursor-pointer font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                Ver condiciones y administración
              </summary>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed pt-1">
                Un reclamo registrado a tiempo sigue atendible aunque la garantía venza durante su revisión. Un reemplazo entregado inicia una nueva cobertura de igual duración.
              </p>
              {detail.canAdmin && detail.warranty.terms && (
                <div className="pt-1">
                  {actionButton('Corregir duración de garantía con motivo', 'warranty_correct')}
                </div>
              )}
            </details>
          </section>

          {/* 2. GRID: INVOICE + DEPÓSITO DEL CORE */}
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {/* INVOICE DE ENTREGA */}
            <section aria-label="Invoice de entrega" className={card}>
              <CardHeading
                icon="description"
                title="Invoice de entrega"
                subtitle="Respaldo documental PDF entregado al cliente"
              >
                <StatusBadge tone={detail.invoices.length ? 'positive' : order.deliveredAt ? 'warning' : 'neutral'}>
                  {detail.invoices.length ? 'Adjunto' : order.deliveredAt ? 'Pendiente' : 'Sin entrega'}
                </StatusBadge>
              </CardHeading>

              {!detail.invoices.length && (
                <div className="rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] p-3 text-xs text-[var(--text-secondary)]">
                  {order.deliveredAt ? 'Invoice pendiente de adjuntar.' : 'Disponible después de confirmar la entrega física.'}
                </div>
              )}

              {order.deliveredAt && mode !== 'invoice' && (
                <div>{actionButton('Adjuntar invoice PDF', 'invoice')}</div>
              )}

              {mode === 'invoice' && (
                <form
                  ref={invoiceForm}
                  aria-label="Adjuntar invoice PDF"
                  onSubmit={(event) => void save(event)}
                  className="rounded-xl border border-cyan-500/30 bg-[var(--bg-card-subtle)] p-3.5 space-y-3"
                >
                  <p className="text-xs text-[var(--text-secondary)]">
                    Selecciona el PDF enviado al cliente (máximo 10 MB) y guarda el invoice para adjuntarlo a esta orden.
                  </p>
                  <fieldset className="min-w-0" disabled={busy || uploading}>
                    <SupportFields orderId={order.id} value={files} onChange={setFiles} pdfOnly onBusy={setUploading} />
                  </fieldset>
                  {error && <p role="alert" className="text-xs text-red-500 font-semibold">{error}</p>}
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" className={primaryButton} disabled={busy || uploading || !files.length}>
                      {busy ? 'Guardando…' : 'Guardar invoice'}
                    </button>
                    <button type="button" className={button} disabled={busy || uploading} onClick={() => setMode('')}>
                      Cancelar
                    </button>
                  </div>
                </form>
              )}

              {detail.invoices.length > 0 && (
                <div className="space-y-2">
                  {detail.invoices.map((invoice, index) => (
                    <div
                      key={invoice.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] p-3 text-xs"
                    >
                      <a
                        className="inline-flex items-center gap-1.5 font-bold text-cyan-400 hover:underline"
                        href={invoice.file_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span className="material-symbols-outlined text-[16px]">picture_as_pdf</span>
                        <span>{index === 0 ? 'Invoice actual' : 'Invoice anterior'} · Ver / descargar PDF</span>
                      </a>
                      <span className="text-[var(--text-secondary)]">
                        {invoice.actor_name} · {stamp(invoice.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* DEPÓSITO DEL CORE */}
            <section aria-label="Depósito del core" className={card}>
              <CardHeading
                icon="published_with_changes"
                title="Depósito del core"
                subtitle="Recepción de pieza usada (15 días) y devolución de depósito"
              >
                <StatusBadge
                  tone={
                    detail.core.reviewRequired
                      ? 'warning'
                      : detail.core.refund
                        ? 'positive'
                        : detail.core.amount <= 0
                          ? 'neutral'
                          : !detail.core.receivedAt && detail.core.deadline && workflowDate(new Date()) > detail.core.deadline
                            ? 'danger'
                            : 'warning'
                  }
                >
                  {detail.core.reviewRequired
                    ? 'Revisar historial'
                    : detail.core.refund
                      ? 'Devuelto'
                      : detail.core.amount <= 0
                        ? 'No aplica'
                        : detail.core.receivedAt
                          ? 'Devolución pendiente'
                          : detail.core.deadline && workflowDate(new Date()) > detail.core.deadline
                            ? 'Plazo vencido'
                            : 'Esperando core'}
                </StatusBadge>
              </CardHeading>

              {detail.core.reviewRequired ? (
                <p className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-500">
                  Requiere revisión histórica: no se inventará un depósito ni una fecha.
                </p>
              ) : detail.core.amount <= 0 ? (
                <p className="rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] p-3 text-xs text-[var(--text-secondary)]">
                  No aplica: sin depósito de core registrado en la orden.
                </p>
              ) : (
                <div className="space-y-3">
                  <dl className="grid gap-3 sm:grid-cols-2 text-xs">
                    <div className="rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] p-3">
                      <dt className="text-[var(--text-secondary)]">Depósito cobrado</dt>
                      <dd className="mt-1 text-xl font-bold tabular-nums text-[var(--text-primary)]">
                        ${detail.core.amount.toFixed(2)}
                      </dd>
                    </div>
                    <div className="rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] p-3">
                      <dt className="text-[var(--text-secondary)]">Fecha límite · 15 días desde la entrega</dt>
                      <dd className="mt-1 font-bold text-[var(--text-primary)]">
                        {detail.core.deadline ? dateLabel(detail.core.deadline) : 'Sin entrega registrada'}
                      </dd>
                      {detail.core.deadline && (
                        <dd className="text-[11px] text-[var(--text-secondary)]">Fin del día · Nueva York</dd>
                      )}
                    </div>
                  </dl>

                  {/* 2-Step Core Pipeline */}
                  <div className="grid gap-2.5 sm:grid-cols-2 text-xs">
                    <div
                      className={`rounded-xl border p-3 space-y-1 ${
                        detail.core.receivedAt
                          ? 'bg-emerald-500/10 border-emerald-500/35'
                          : 'bg-[var(--bg-card-subtle)] border-[var(--border-color)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <strong className="font-bold text-[var(--text-primary)]">1. Recepción física</strong>
                        <span className="material-symbols-outlined text-[16px] text-emerald-500">
                          {detail.core.receivedAt ? 'check_circle' : 'schedule'}
                        </span>
                      </div>
                      {detail.core.receivedAt ? (
                        <p className="text-[var(--text-secondary)]">Core recibido: {stamp(detail.core.receivedAt)}</p>
                      ) : (
                        <p className="text-[var(--text-secondary)]">
                          {detail.core.deadline
                            ? `Días restantes: ${Math.max(0, Math.round((Date.parse(detail.core.deadline) - Date.parse(workflowDate(new Date()))) / 86400000))}`
                            : 'Pendiente de entrega en yarda'}
                        </p>
                      )}
                    </div>

                    <div
                      className={`rounded-xl border p-3 space-y-1 ${
                        detail.core.refund
                          ? 'bg-emerald-500/10 border-emerald-500/35'
                          : 'bg-[var(--bg-card-subtle)] border-[var(--border-color)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <strong className="font-bold text-[var(--text-primary)]">2. Devolución de dinero</strong>
                        <span className="material-symbols-outlined text-[16px] text-emerald-500">
                          {detail.core.refund ? 'paid' : 'hourglass_empty'}
                        </span>
                      </div>
                      {detail.core.refund ? (
                        <p className="text-[var(--text-secondary)]">
                          Devolución: {stamp(detail.core.refund.completed_at)} ·{' '}
                          {detail.core.refund.execution?.method === 'square'
                            ? `Square · tarjeta ****${detail.core.refund.execution.last4}`
                            : 'Efectivo'}
                        </p>
                      ) : (
                        <p className="text-[var(--text-secondary)]">
                          {detail.core.receivedAt ? 'Listo para devolver en Efectivo o Square' : 'Requiere recibir el casco primero'}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {detail.canAdmin && !detail.core.reviewRequired && detail.core.amount > 0 && !detail.core.refund && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {!detail.core.receivedAt
                    ? actionButton('Registrar recepción del core', 'core_receive', 0, 'primary')
                    : actionButton('Devolver depósito del core', 'core_refund', 0, 'primary')}
                </div>
              )}
            </section>
          </div>

          {/* 3. GRID: RECLAMOS + REEMBOLSOS DE COMPRA */}
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {/* RECLAMOS */}
            <section aria-label="Reclamos" className={card}>
              <CardHeading
                icon="build"
                title="Reclamos"
                subtitle="Seguimiento técnico en 3 etapas: Apertura → Revisión → Solución"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    tone={detail.claims.some((claim) => !['Resolved', 'Denied'].includes(claim.status)) ? 'warning' : 'neutral'}
                  >
                    {detail.claims.length
                      ? `${detail.claims.filter((claim) => !['Resolved', 'Denied'].includes(claim.status)).length} abiertos · ${detail.claims.length} total`
                      : 'Sin reclamos'}
                  </StatusBadge>
                  {detail.canManage && actionButton('Abrir reclamo', 'claim_create', 0, 'primary')}
                </div>
              </CardHeading>

              {!detail.claims.length && (
                <div className="rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] p-4 text-xs text-[var(--text-secondary)] text-center">
                  No hay reclamos de garantía registrados en esta orden.
                </div>
              )}

              {detail.claims.map((claim) => {
                const isClosed = ['Resolved', 'Denied'].includes(claim.status);
                const currentStage = claim.stage || 'registered';
                const stepIndex = isClosed
                  ? 3
                  : currentStage === 'resolution'
                    ? 2
                    : currentStage === 'review'
                      ? 2
                      : 1;

                return (
                  <article
                    key={claim.id}
                    className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)]/60 p-4 space-y-3"
                  >
                    {/* Claim Header */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[var(--border-color)]">
                      <div className="flex items-center gap-2">
                        <span className="rounded-lg bg-amber-500/15 border border-amber-500/35 px-2.5 py-0.5 font-mono text-xs font-bold text-amber-500">
                          REC-{claim.id}
                        </span>
                        <strong className="text-xs sm:text-sm font-bold text-[var(--text-primary)]">
                          {stageLabel[claim.stage || ''] || claim.status}
                        </strong>
                      </div>
                      <span className="text-xs text-[var(--text-secondary)]">
                        Responsable #{claim.assigned_user_id || 'Sin asignar'} · Próxima revisión:{' '}
                        <strong className="text-[var(--text-primary)]">{claim.next_review_date?.slice(0, 10) || 'No programada'}</strong>
                      </span>
                    </div>

                    {/* 3-Step Visual Progress Bar */}
                    <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                      {[
                        { num: 1, label: '1. Apertura' },
                        { num: 2, label: '2. En revisión' },
                        { num: 3, label: '3. Solución' },
                      ].map((s) => {
                        const done = stepIndex > s.num || (isClosed && s.num === 3);
                        const active = !isClosed && stepIndex === s.num;
                        return (
                          <div
                            key={s.num}
                            className={`rounded-lg border px-2.5 py-1.5 font-semibold flex items-center justify-between gap-1 ${
                              done
                                ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-500'
                                : active
                                  ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400'
                                  : 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-secondary)] opacity-65'
                            }`}
                          >
                            <span className="truncate">{s.label}</span>
                            <span className="material-symbols-outlined text-[14px]">
                              {done ? 'check_circle' : active ? 'pending' : 'radio_button_unchecked'}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Description & Resolution Notes */}
                    <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] p-3 text-xs space-y-1.5">
                      <p className="text-[var(--text-primary)] leading-relaxed">{claim.description}</p>
                      {claim.resolution_notes && (
                        <p className="pt-1.5 border-t border-[var(--border-color)] text-[var(--text-secondary)]">
                          <strong className="text-[var(--text-primary)]">Última gestión:</strong> {claim.resolution_notes}
                        </p>
                      )}
                    </div>

                    {claim.evidence_files.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {claim.evidence_files.map((url, index) => (
                          <a
                            key={url}
                            className="inline-flex items-center gap-1 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] px-2.5 py-1 text-xs font-semibold text-cyan-400 hover:underline"
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <span className="material-symbols-outlined text-[14px]">attachment</span>
                            <span>Evidencia {index + 1}</span>
                          </a>
                        ))}
                      </div>
                    )}

                    {/* Action Bar */}
                    {detail.canManage && !isClosed && (
                      <div className="space-y-2 pt-1">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block">
                          Acciones disponibles para este reclamo
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {actionButton('Registrar revisión / comunicación', 'claim_review', claim.id)}
                          {actionButton('Preparar resolución', 'claim_resolution', claim.id)}
                          {actionButton('Resolver sin reemplazo', 'claim_resolved', claim.id)}
                          {detail.canAdmin && (
                            <>
                              {actionButton('Entregar reemplazo', 'claim_replacement', claim.id)}
                              {actionButton('Rechazar reclamo', 'claim_denied', claim.id)}
                            </>
                          )}
                          {actionButton('Solicitar reembolso', 'refund_create')}
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </section>

            {/* REEMBOLSOS DE COMPRA */}
            <section aria-label="Reembolsos de compra" className={card}>
              <CardHeading
                icon="payments"
                title="Reembolsos de compra"
                subtitle="Control presupuestal sobre pagos cobrados y etapas de devolución"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    tone={
                      detail.refunds.some((refund) => refund.refund_scope !== 'core' && refund.status === 'pending')
                        ? 'warning'
                        : 'neutral'
                    }
                  >
                    {detail.refunds.some((refund) => refund.refund_scope !== 'core' && refund.status === 'pending')
                      ? 'Solicitud pendiente'
                      : detail.refunds.some((refund) => refund.refund_scope !== 'core')
                        ? 'Ver historial'
                        : 'Sin solicitudes'}
                  </StatusBadge>
                  {detail.canManage && actionButton('Solicitar reembolso de compra', 'refund_create', 0, 'primary')}
                </div>
              </CardHeading>

              {/* Financial Budget Summary */}
              <dl aria-label="Resumen de reembolsos" className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {([
                  ['Cobrado', detail.paid, 'text-[var(--text-primary)]'],
                  ['Devuelto', detail.refunded, 'text-emerald-500'],
                  ['Reservado', detail.reserved, 'text-amber-500'],
                  ['Disponible', availableToRefund, 'text-cyan-400'],
                ] as const).map(([label, val, colorCls]) => (
                  <div
                    key={label}
                    className="min-w-0 rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] p-3"
                  >
                    <dt className="text-[11px] text-[var(--text-secondary)]">{label}</dt>
                    <dd className={`mt-1 text-base sm:text-lg font-bold tabular-nums break-all ${colorCls}`}>
                      ${val.toFixed(2)}
                    </dd>
                  </div>
                ))}
              </dl>

              {detail.refunds.filter((refund) => refund.refund_scope !== 'core').length === 0 && (
                <div className="rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] p-4 text-xs text-[var(--text-secondary)] text-center">
                  No hay solicitudes de reembolso de compra registradas en esta orden.
                </div>
              )}

              {detail.refunds
                .filter((refund) => refund.refund_scope !== 'core')
                .map((refund) => {
                  const stage = refund.review_stage || refund.status;
                  const stepNum =
                    refund.status === 'completed' || stage === 'completed'
                      ? 4
                      : stage === 'approved'
                        ? 3
                        : stage === 'review'
                          ? 2
                          : 1;
                  const isRejected = refund.status === 'cancelled' || stage === 'rejected';

                  return (
                    <article
                      key={refund.id}
                      className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)]/60 p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[var(--border-color)]">
                        <div className="flex items-center gap-2">
                          <span className="rounded-lg bg-cyan-500/15 border border-cyan-500/35 px-2.5 py-0.5 font-mono text-xs font-bold text-cyan-400">
                            REF-{refund.id}
                          </span>
                          <strong className="text-sm sm:text-base font-black font-mono text-[var(--text-primary)]">
                            ${Number(refund.amount).toFixed(2)}
                          </strong>
                        </div>
                        <span className="rounded-full bg-[var(--bg-card)] border border-[var(--border-color)] px-2.5 py-0.5 text-xs font-bold text-[var(--text-primary)]">
                          {stageLabel[stage] || refund.status}
                        </span>
                      </div>

                      {/* 4-Step Refund Progress Bar */}
                      {!isRejected && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[11px]">
                          {[
                            { num: 1, label: '1. Solicitado' },
                            { num: 2, label: '2. Revisión' },
                            { num: 3, label: '3. Aprobado' },
                            { num: 4, label: '4. Devuelto' },
                          ].map((s) => {
                            const done = stepNum > s.num || (stepNum === 4 && s.num === 4);
                            const active = stepNum === s.num && stepNum < 4;
                            return (
                              <div
                                key={s.num}
                                className={`rounded-lg border px-2 py-1 font-semibold flex items-center justify-between gap-1 ${
                                  done
                                    ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-500'
                                    : active
                                      ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400'
                                      : 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-secondary)] opacity-60'
                                }`}
                              >
                                <span className="truncate">{s.label}</span>
                                <span className="material-symbols-outlined text-[13px]">
                                  {done ? 'check_circle' : active ? 'pending' : 'radio_button_unchecked'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] p-3 text-xs space-y-1.5">
                        <p className="text-[var(--text-primary)]">{refund.reason}</p>
                        {refund.claim_id && (
                          <p className="text-amber-500 font-semibold">Vinculado a REC-{refund.claim_id}</p>
                        )}
                        {refund.execution && (
                          <p className="pt-1.5 border-t border-[var(--border-color)] text-emerald-500 font-semibold">
                            {refund.execution.method === 'cash'
                              ? `Efectivo recibido por ${refund.execution.recipient}`
                              : `${
                                  refund.execution.method === 'square'
                                    ? `Square · tarjeta ****${refund.execution.last4}`
                                    : refund.execution.method
                                } · ${refund.execution.reference}`}{' '}
                            · {stamp(refund.completed_at)}
                          </p>
                        )}
                      </div>

                      {detail.canAdmin && refund.status === 'pending' && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {(!refund.review_stage || refund.review_stage === 'requested') &&
                            actionButton('Iniciar revisión', 'refund_review', refund.id, 'primary')}
                          {refund.review_stage === 'review' &&
                            actionButton('Aprobar importe', 'refund_approved', refund.id, 'primary')}
                          {refund.review_stage === 'approved' &&
                            actionButton('Registrar dinero devuelto', 'refund_completed', refund.id, 'primary')}
                          {actionButton('Rechazar solicitud', 'refund_rejected', refund.id)}
                        </div>
                      )}
                    </article>
                  );
                })}
            </section>
          </div>

          {/* 4. GUIDED VERIFIABLE ACTION FORM */}
          {mode && mode !== 'invoice' && (
            <form
              onSubmit={(event) => void save(event)}
              className="rounded-2xl border-2 border-cyan-500/40 bg-[var(--bg-card-subtle)] p-4 sm:p-5 space-y-4 shadow-md"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-[var(--border-color)]">
                <div className="flex items-center gap-2.5">
                  <span className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/35 text-cyan-400 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[19px]">{activeMeta.icon}</span>
                  </span>
                  <div>
                    <h3 className="font-bold text-sm sm:text-base text-[var(--text-primary)]">
                      {activeMeta.title}
                      {target ? ` · #${mode.startsWith('claim_') ? `REC-${target}` : `REF-${target}`}` : ''}
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)]">{activeMeta.subtitle}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                  onClick={() => setMode('')}
                >
                  Cerrar formulario ✕
                </button>
              </div>

              <fieldset disabled={busy || uploading} className="space-y-4">
                {!['invoice', 'core_refund'].includes(mode) && (
                  <div className="space-y-2">
                    <label className={field}>
                      <span>Detalle / motivo / comunicación</span>
                      <textarea
                        required
                        minLength={5}
                        maxLength={5000}
                        rows={3}
                        className={inputCls}
                        placeholder="Describe el motivo verificable, acuerdo con el cliente o dictamen técnico..."
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                      />
                    </label>
                    {quickNotes.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-[var(--text-secondary)]">Plantillas rápidas:</span>
                        {quickNotes.map((tpl) => (
                          <button
                            key={tpl}
                            type="button"
                            onClick={() => setNotes((prev) => (prev ? `${prev} ${tpl}` : tpl))}
                            className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:border-cyan-500/40 hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                          >
                            + {tpl}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {mode === 'warranty_correct' && (
                  <label className={field}>
                    <span>Duración corregida (días)</span>
                    <input
                      required
                      type="number"
                      min="0"
                      max="3650"
                      className={inputCls}
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                    />
                  </label>
                )}

                {(mode.startsWith('claim_') || mode === 'refund_create' || mode === 'core_receive') && (
                  <SupportFields orderId={order.id} value={files} onChange={setFiles} onBusy={setUploading} />
                )}

                {['claim_create', 'claim_review', 'claim_resolution'].includes(mode) && (
                  <label className={field}>
                    <span>Próxima revisión programada</span>
                    <input
                      required
                      type="date"
                      min={workflowDate(new Date())}
                      className={inputCls}
                      value={nextDate}
                      onChange={(event) => setNextDate(event.target.value)}
                    />
                  </label>
                )}

                {['claim_resolved', 'claim_denied', 'claim_replacement'].includes(mode) && (
                  <label className="flex items-center gap-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3 text-xs sm:text-sm font-medium cursor-pointer">
                    <input
                      required
                      type="checkbox"
                      checked={notified}
                      onChange={(event) => setNotified(event.target.checked)}
                    />
                    <span>Notifiqué la resolución y condiciones al cliente.</span>
                  </label>
                )}

                {mode === 'claim_replacement' && (
                  <>
                    <label className={field}>
                      <span>Identificación / stock de la pieza de reemplazo</span>
                      <input
                        required
                        className={inputCls}
                        placeholder="Ej. STK-2026-410"
                        value={stock}
                        onChange={(event) => setStock(event.target.value)}
                      />
                    </label>
                    <label className="flex items-center gap-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3 text-xs sm:text-sm font-medium cursor-pointer">
                      <input
                        required
                        type="checkbox"
                        checked={confirmed}
                        onChange={(event) => setConfirmed(event.target.checked)}
                      />
                      <span>Confirmo la entrega física del reemplazo. Se inicia una garantía nueva de igual duración.</span>
                    </label>
                  </>
                )}

                {mode === 'refund_create' && (
                  <div className="space-y-3">
                    <label className={field}>
                      <span>Monto solicitado (USD)</span>
                      <input
                        required
                        type="number"
                        min="0.01"
                        step="0.01"
                        className={inputCls}
                        placeholder="0.00"
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                      />
                    </label>
                    {availableToRefund > 0 && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-[var(--text-secondary)]">Autocompletar monto:</span>
                        <button
                          type="button"
                          onClick={() => setAmount(availableToRefund.toFixed(2))}
                          className="rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1 font-bold text-cyan-400 hover:bg-cyan-500/20 cursor-pointer"
                        >
                          100% Disponible (${availableToRefund.toFixed(2)})
                        </button>
                        {order.financials?.downPayment && order.financials.downPayment <= availableToRefund ? (
                          <button
                            type="button"
                            onClick={() => setAmount(Number(order.financials.downPayment).toFixed(2))}
                            className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 font-bold text-amber-400 hover:bg-amber-500/20 cursor-pointer"
                          >
                            Abono (${Number(order.financials.downPayment).toFixed(2)})
                          </button>
                        ) : null}
                      </div>
                    )}
                    <label className="flex items-center gap-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3 text-xs sm:text-sm font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={pieceRequired}
                        onChange={(event) => setPieceRequired(event.target.checked)}
                      />
                      <span>Requiere devolución física de la pieza en yarda antes del reembolso.</span>
                    </label>
                  </div>
                )}

                {mode === 'core_receive' && (
                  <label className="flex items-center gap-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3 text-xs sm:text-sm font-medium cursor-pointer">
                    <input
                      required
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    <span>Recibí físicamente el core.</span>
                  </label>
                )}

                {mode === 'refund_completed' && (
                  <label className="flex items-center gap-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3 text-xs sm:text-sm font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    <span>Recibí la pieza devuelta, si es requisito.</span>
                  </label>
                )}

                {['refund_completed', 'core_refund'].includes(mode) && (
                  <>
                    <ExecutionFields
                      orderId={order.id}
                      core={mode === 'core_refund'}
                      customerName={order.customer?.name}
                      value={execution}
                      onChange={setExecution}
                      onBusy={setUploading}
                    />
                    <label className="flex items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs sm:text-sm font-semibold text-emerald-500 cursor-pointer">
                      <input required type="checkbox" />
                      <span>Confirmo que el dinero ya fue devuelto y el cliente recibió la constancia.</span>
                    </label>
                  </>
                )}
              </fieldset>

              <div className="flex flex-wrap gap-2 pt-2">
                <button type="submit" className={primaryButton} disabled={busy || uploading}>
                  {busy ? 'Guardando…' : 'Confirmar gestión'}
                </button>
                <button type="button" className={button} disabled={busy || uploading} onClick={() => setMode('')}>
                  Cancelar
                </button>
              </div>
            </form>
          )}

          {/* 5. POSVENTA AUDIT HISTORY */}
          <details className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)]/50 p-4">
            <summary className="cursor-pointer font-bold text-sm text-[var(--text-primary)] flex items-center justify-between">
              <span className="inline-flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-cyan-400">history</span>
                <span>Historial de posventa y soportes ({detail.history.length})</span>
              </span>
            </summary>
            <div className="mt-3 space-y-2.5">
              {!detail.history.length && (
                <p className="text-xs text-[var(--text-secondary)]">Sin gestiones de posventa registradas todavía.</p>
              )}
              {detail.history.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3 text-xs space-y-1.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="font-bold text-[var(--text-primary)]">{item.actor_name}</strong>
                    <span className="font-mono text-[11px] text-[var(--text-secondary)]">{stamp(item.created_at)}</span>
                  </div>
                  <p className="text-[var(--text-secondary)] leading-relaxed">{item.notes}</p>
                  {'replacementStock' in item.details && item.details.replacementStock && (
                    <p className="font-semibold text-emerald-500">Reemplazo entregado: {item.details.replacementStock}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {'files' in item.details &&
                      item.details.files.map((url, index) => (
                        <a
                          key={url}
                          className="inline-flex items-center gap-1 font-semibold text-cyan-400 hover:underline"
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <span className="material-symbols-outlined text-[14px]">attachment</span>
                          <span>Soporte {index + 1}</span>
                        </a>
                      ))}
                    {'execution' in item.details &&
                      item.details.execution &&
                      'receipt' in item.details.execution && (
                        <a
                          className="inline-flex items-center gap-1 font-semibold text-emerald-500 hover:underline"
                          href={item.details.execution.receipt}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <span className="material-symbols-outlined text-[14px]">receipt_long</span>
                          <span>Comprobante de devolución</span>
                        </a>
                      )}
                  </div>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </section>
  );
};
