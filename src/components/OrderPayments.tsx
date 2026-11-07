import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../services/apiFetch';
import { emptySettlement, isBalancePaymentMethod, PAYMENT_METHODS, previewSettlement, settlementSchema, validateCollectionEvidence, type PaymentDetail, type Settlement } from '../utils/orderPayments';
import { DownpaymentFields, uploadDownpaymentReceipt } from './DownpaymentConfirmation';
import { downpaymentSchema, validateDownpayment, type DownpaymentLine } from '../utils/downpaymentConfirmation';
import { PreparationFields } from './OrderPreparation';
import { emptyPreparation, preparationSchema } from '../utils/orderPreparation';
import { completedWorkflowStages, type WorkflowOrder, type WorkflowEvent } from '../utils/orderWorkflow';
import { OrderDeliveryFields } from './OrderDeliveryFields';

const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
export async function paymentResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'No se pudo registrar el cobro.');
  return data;
}
export function usePaymentDetail(orderId: string, version?: number, enabled = true) {
  const [detail, setDetail] = useState<PaymentDetail | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setDetail(null); setError('');
    void (async () => {
      try {
        const data = await paymentResponse<PaymentDetail>(await apiFetch(`/orders/${orderId}/payments`));
        if (version !== undefined && data.version !== version) throw new Error('La orden cambió; recarga la orden o la tarea antes de registrar un cobro.');
        if (active) setDetail(data);
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : 'No se pudieron cargar los cobros.'); }
    })();
    return () => { active = false; };
  }, [orderId, version, attempt, enabled]);
  return { detail, error, reload: () => setAttempt(value => value + 1) };
}
export const OrderPaymentFields: React.FC<{
  orderId: string; detail: PaymentDetail; value: Settlement; onChange: (value: Settlement) => void; disabled?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
}> = ({ orderId, detail, value, onChange, disabled, onUploadingChange }) => {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const uploadingRef = useRef(false);
  let summary: ReturnType<typeof previewSettlement> | null = null;
  let previewError = '';
  try { summary = previewSettlement(detail.order, value); }
  catch (reason) { previewError = reason instanceof Error ? reason.message : 'Liquidación inválida'; }
  const updatePayment = (index: number, patch: Partial<Settlement['payments'][number]>) =>
    onChange({ ...value, payments: value.payments.map((item, i) => i === index ? { ...item, ...patch } : item) });
  const currentCore = value.coreAction === 'charge' && value.coreAmount !== undefined && value.coreAmount !== null
    ? value.coreAmount
    : value.coreAction === 'none'
      ? 0
      : detail.order.core;
  const saleTotal = (Math.round(detail.order.price * 100) + Math.round(detail.order.shipping * 100) + Math.round(currentCore * 100)) / 100;
  const previousBalance = (Math.round(saleTotal * 100) - Math.round(detail.order.paid * 100)) / 100;
  const amountRow = (label: string, amount: string, emphasized = false) => <div className={`flex flex-wrap justify-between gap-x-4 gap-y-1 ${emphasized ? 'border-t border-[var(--border-color)] pt-3 font-bold' : ''}`}>
    <dt>{label}</dt><dd className="font-semibold tabular-nums">{amount}</dd>
  </div>;
  const upload = async (index: number, file: File) => {
    if (uploadingRef.current) return;
    uploadingRef.current = true; setUploading(true); onUploadingChange?.(true); setUploadError('');
    try { updatePayment(index, { receipt: await uploadDownpaymentReceipt(orderId, file) }); }
    catch (reason) { setUploadError(reason instanceof Error ? reason.message : 'No se pudo subir el comprobante.'); }
    finally { uploadingRef.current = false; setUploading(false); onUploadingChange?.(false); }
  };
  return <section className="space-y-4">
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 text-sm">
      <div className="rounded-xl bg-[var(--bg-card-subtle)] p-3">
        <span className="text-xs text-[var(--text-secondary)] block">Total venta</span>
        <strong className="block text-base">{money(saleTotal)}</strong>
      </div>
      <div className="rounded-xl bg-[var(--bg-card-subtle)] p-3">
        <span className="text-xs text-[var(--text-secondary)] block">Cobrado anterior</span>
        <strong className="block text-base">{money(detail.order.paid)}</strong>
      </div>
      <div className="rounded-xl bg-[var(--bg-card-subtle)] p-3">
        <span className="text-xs text-[var(--text-secondary)] block">Cargo de core</span>
        <strong className="block text-base">{money(currentCore)}</strong>
      </div>
      <div className="rounded-xl bg-[var(--bg-card-subtle)] p-3 border border-cyan-500/40 bg-cyan-950/20">
        <span className="text-xs text-cyan-400 font-semibold block">Saldo pendiente</span>
        <strong className="block text-base text-cyan-300">{money(summary ? summary.balance : previousBalance)}</strong>
      </div>
    </div>
    {!detail.canRecord && <p className="text-sm text-amber-600">Solo administración puede registrar cobros y recibir el core. Puedes confirmar una entrega ya liquidada.</p>}
    {detail.remainingMethodsOnly && <p className="text-sm">Saldo pendiente: únicamente efectivo, Cash App o Zelle, según lo informado al cliente.</p>}
    <fieldset disabled={disabled || uploading || !detail.canRecord} className="rounded-xl border border-[var(--border-color)] p-4 space-y-3.5 bg-[var(--bg-card-subtle)]/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <legend className="font-bold text-sm text-[var(--text-primary)]">Core / pieza usada</legend>
        {detail.order.core > 0 ? (
          <span className="text-xs px-2 py-0.5 rounded bg-cyan-950/70 border border-cyan-500/30 text-cyan-300 font-mono">Core inicial: {money(detail.order.core)}</span>
        ) : (
          <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">Sin core inicial en orden</span>
        )}
      </div>
      {detail.order.coreReceived ? (
        <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-950/30 border border-emerald-500/30 rounded-lg p-3">
          <span className="material-symbols-outlined text-base">check_circle</span>
          <div>
            <p className="font-semibold">Core recibido físicamente</p>
            <p className="text-xs text-[var(--text-secondary)]">La pieza usada ya fue verificada y recibida. No hay cargo de core pendiente por liquidar.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3.5">
          {/* Visual Interactive Cards for Core Decision */}
          <div className="space-y-2">
            <span className="font-semibold text-xs sm:text-sm uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <span className="material-symbols-outlined text-cyan-400 text-base">swap_horizontal_circle</span>
              Tratamiento del core
            </span>

            {/* Accessible / test compatibility hidden select */}
            <label className="sr-only">
              Tratamiento del core
              <select
                value={
                  value.coreAction === 'charge' ? 'charge'
                  : value.coreAction === 'received' ? 'received'
                  : value.coreAction === 'none' ? 'none'
                  : detail.order.core > 0 ? 'keep' : 'none'
                }
                onChange={event => {
                  const action = event.target.value as 'keep' | 'charge' | 'received' | 'none';
                  if (action === 'charge') {
                    onChange({
                      ...value,
                      coreAction: 'charge',
                      coreAmount: value.coreAmount !== undefined && value.coreAmount > 0 ? value.coreAmount : 150,
                      coreReference: '',
                      coreConfirmed: false,
                    });
                  } else if (action === 'keep') {
                    onChange({
                      ...value,
                      coreAction: 'keep',
                      coreAmount: detail.order.core > 0 ? detail.order.core : 150,
                      coreReference: '',
                      coreConfirmed: false,
                    });
                  } else if (action === 'received') {
                    onChange({
                      ...value,
                      coreAction: 'received',
                      coreAmount: undefined,
                      coreReference: value.coreReference || '',
                      coreConfirmed: value.coreConfirmed || false,
                    });
                  } else if (action === 'none') {
                    onChange({
                      ...value,
                      coreAction: 'none',
                      coreAmount: 0,
                      coreReference: '',
                      coreConfirmed: false,
                    });
                  }
                }}
              >
                <option value={detail.order.core > 0 ? 'keep' : 'charge'}>
                  {detail.order.core > 0
                    ? `El cliente paga el core · conservar cargo (${money(detail.order.core)})`
                    : 'El cliente no trajo la pieza usada y pagará el core'}
                </option>
                <option value="received">
                  Recibimos la pieza usada · eliminar cargo {detail.order.core > 0 ? `(-${money(detail.order.core)})` : ''}
                </option>
                <option value="none">
                  Sin cargo de core (no aplica para esta pieza / exento)
                </option>
              </select>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {/* Option 1: Charge / Keep Core */}
              <button
                type="button"
                onClick={() => {
                  if (detail.order.core > 0) {
                    onChange({
                      ...value,
                      coreAction: 'keep',
                      coreAmount: detail.order.core,
                      coreReference: '',
                      coreConfirmed: false,
                    });
                  } else {
                    onChange({
                      ...value,
                      coreAction: 'charge',
                      coreAmount: value.coreAmount !== undefined && value.coreAmount > 0 ? value.coreAmount : 150,
                      coreReference: '',
                      coreConfirmed: false,
                    });
                  }
                }}
                className={`p-3.5 rounded-xl border text-left transition-all flex items-start gap-3 ${
                  (value.coreAction === 'charge' || (value.coreAction === 'keep' && (detail.order.core > 0 || detail.preparationPlan === 'pay_core')))
                    ? 'bg-cyan-500/15 border-cyan-500 text-white shadow-[0_0_15px_rgba(6,182,212,0.2)] ring-1 ring-cyan-500/40'
                    : 'bg-slate-900/60 border-slate-700/80 text-slate-300 hover:border-slate-600 hover:bg-slate-800/50'
                }`}
              >
                <div className={`p-1.5 rounded-lg shrink-0 ${
                  (value.coreAction === 'charge' || (value.coreAction === 'keep' && (detail.order.core > 0 || detail.preparationPlan === 'pay_core')))
                    ? 'bg-cyan-500 text-slate-950 font-bold'
                    : 'bg-slate-800 text-slate-400'
                }`}>
                  <span className="material-symbols-outlined text-lg">payments</span>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-xs sm:text-sm">Cliente pagará core</span>
                    {(value.coreAction === 'charge' || (value.coreAction === 'keep' && (detail.order.core > 0 || detail.preparationPlan === 'pay_core'))) && (
                      <span className="text-cyan-400 material-symbols-outlined text-sm">check_circle</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">
                    {detail.order.core > 0
                      ? `Conserva el cargo (${money(detail.order.core)})`
                      : 'No trajo pieza usada; se suma depósito'}
                  </p>
                </div>
              </button>

              {/* Option 2: Received Physical Core */}
              <button
                type="button"
                onClick={() => {
                  if (detail.order.core > 0) {
                    onChange({
                      ...value,
                      coreAction: 'received',
                      coreAmount: undefined,
                      coreReference: value.coreReference || '',
                      coreConfirmed: value.coreConfirmed || false,
                    });
                  } else {
                    onChange({
                      ...value,
                      coreAction: 'none',
                      coreAmount: 0,
                      coreReference: '',
                      coreConfirmed: false,
                    });
                  }
                }}
                className={`p-3.5 rounded-xl border text-left transition-all flex items-start gap-3 ${
                  value.coreAction === 'received'
                    ? 'bg-emerald-500/15 border-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.2)] ring-1 ring-emerald-500/40'
                    : 'bg-slate-900/60 border-slate-700/80 text-slate-300 hover:border-slate-600 hover:bg-slate-800/50'
                }`}
              >
                <div className={`p-1.5 rounded-lg shrink-0 ${
                  value.coreAction === 'received' ? 'bg-emerald-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-400'
                }`}>
                  <span className="material-symbols-outlined text-lg">swap_horiz</span>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-xs sm:text-sm">Recibimos pieza usada</span>
                    {value.coreAction === 'received' && (
                      <span className="text-emerald-400 material-symbols-outlined text-sm">check_circle</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">
                    {detail.order.core > 0 ? `Eliminar cargo (-${money(detail.order.core)})` : 'Entregó casco físico'}
                  </p>
                </div>
              </button>

              {/* Option 3: None / Exempt */}
              <button
                type="button"
                onClick={() => {
                  onChange({
                    ...value,
                    coreAction: 'none',
                    coreAmount: 0,
                    coreReference: '',
                    coreConfirmed: false,
                  });
                }}
                className={`p-3.5 rounded-xl border text-left transition-all flex items-start gap-3 ${
                  value.coreAction === 'none'
                    ? 'bg-slate-700/40 border-slate-400 text-white shadow-sm ring-1 ring-slate-400/40'
                    : 'bg-slate-900/60 border-slate-700/80 text-slate-300 hover:border-slate-600 hover:bg-slate-800/50'
                }`}
              >
                <div className={`p-1.5 rounded-lg shrink-0 ${
                  value.coreAction === 'none' ? 'bg-slate-400 text-slate-950 font-bold' : 'bg-slate-800 text-slate-400'
                }`}>
                  <span className="material-symbols-outlined text-lg">do_not_disturb_on</span>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-xs sm:text-sm">Sin cargo / Exento</span>
                    {value.coreAction === 'none' && (
                      <span className="text-slate-300 material-symbols-outlined text-sm">check_circle</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">
                    No aplica core para esta pieza
                  </p>
                </div>
              </button>
            </div>
          </div>

          {/* Conditional Detail Card based on Selection */}
          {(value.coreAction === 'charge' || (value.coreAction === 'keep' && (detail.order.core > 0 || detail.preparationPlan === 'pay_core'))) && (
            <div className="rounded-xl bg-cyan-950/20 p-4 border border-cyan-500/40 space-y-2">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-semibold text-cyan-300">
                  {detail.order.core === 0 ? 'Monto a cobrar por el core (USD)' : 'Monto del cargo de core (USD)'}
                </span>
                <div className="flex items-stretch rounded-xl overflow-hidden border border-cyan-500/50 bg-[var(--bg-card)] focus-within:ring-2 focus-within:ring-cyan-500 shadow-sm">
                  <span className="flex items-center justify-center px-4 bg-cyan-950/50 text-cyan-400 font-bold text-base border-r border-cyan-500/30 select-none">
                    $
                  </span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    max="99999999"
                    required
                    className="w-full bg-transparent px-3.5 py-2.5 text-base font-bold text-[var(--text-primary)] placeholder-slate-400 focus:outline-none font-mono"
                    placeholder="150.00"
                    value={value.coreAmount !== undefined && value.coreAmount !== null ? value.coreAmount : (detail.order.core > 0 ? detail.order.core : 150)}
                    onChange={event => {
                      const val = event.target.value === '' ? undefined : Number(event.target.value);
                      onChange({
                        ...value,
                        coreAction: 'charge',
                        coreAmount: val,
                      });
                    }}
                  />
                </div>
              </label>
              <p className="text-xs text-slate-400 leading-relaxed">
                {detail.order.core === 0
                  ? 'El cliente pagará este importe por el core. Se sumará al total a liquidar y queda registrado como depósito de core para posventa.'
                  : 'Cargo incluido en la liquidación de la orden. Se registra como depósito de core reembolsable si el cliente entrega la pieza durante la garantía.'}
              </p>
            </div>
          )}

          {value.coreAction === 'received' && (
            <div className="rounded-xl bg-emerald-950/20 p-4 border border-emerald-500/40 space-y-3">
              {detail.order.core > 0 ? (
                <div className="flex items-center gap-2 text-xs sm:text-sm text-emerald-300 font-medium">
                  <span className="material-symbols-outlined text-base">check_circle</span>
                  <span>Se aplicará un ajuste de <strong>-{money(detail.order.core)}</strong> al total por recibir la pieza usada física.</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs sm:text-sm text-emerald-300 font-medium">
                  <span className="material-symbols-outlined text-base">check_circle</span>
                  <span>El cliente entregó la pieza usada acordada. No se genera cargo de core.</span>
                </div>
              )}
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Referencia de recepción del core
                </span>
                <input
                  required
                  minLength={5}
                  maxLength={1000}
                  className="w-full bg-slate-950/90 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  value={value.coreReference}
                  onChange={event => onChange({ ...value, coreReference: event.target.value })}
                  placeholder="Comprobante y descripción de la pieza recibida"
                />
              </label>

              <button
                type="button"
                onClick={() => onChange({ ...value, coreConfirmed: !value.coreConfirmed })}
                className={`w-full p-3 rounded-xl border text-left transition-all flex items-center gap-3 ${
                  value.coreConfirmed
                    ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-100'
                    : 'bg-slate-900/60 border-slate-700 text-slate-300 hover:border-slate-600'
                }`}
              >
                <div className={`p-1 rounded-md shrink-0 ${value.coreConfirmed ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-500'}`}>
                  <span className="material-symbols-outlined text-base">
                    {value.coreConfirmed ? 'check' : 'touch_app'}
                  </span>
                </div>
                <span className="text-xs sm:text-sm">
                  Confirmo que recibimos físicamente la pieza usada. No es una promesa de devolución.
                </span>
              </button>
              <input
                type="checkbox"
                required
                className="sr-only"
                checked={value.coreConfirmed}
                onChange={event => onChange({ ...value, coreConfirmed: event.target.checked })}
              />
            </div>
          )}

          {value.coreAction === 'none' && (
            <p className="text-xs text-slate-400 italic bg-slate-900/40 p-3 rounded-xl border border-slate-800">
              Esta orden no tiene cargo de core ni requiere entrega de pieza usada.
            </p>
          )}

          <p className="text-[11px] text-slate-400">
            Si el core ya fue cobrado y corresponde devolver dinero, tramita una devolución desde Reembolsos.
          </p>
        </div>
      )}

      {/* Modern Payments Section */}
      <div className="space-y-4 pt-2">
        <div className="flex flex-wrap justify-between items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary-400 text-lg">account_balance_wallet</span>
            <strong className="text-sm sm:text-base text-slate-100">Pagos recibidos ahora</strong>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {summary && summary.balance > 0 && (
              <button
                type="button"
                className="text-xs px-3 py-1.5 rounded-xl bg-cyan-950/80 border border-cyan-500/50 text-cyan-300 hover:bg-cyan-900/70 transition-all font-semibold flex items-center gap-1.5 shadow-sm"
                onClick={() => {
                  const bal = summary!.balance;
                  if (!value.payments.length) {
                    onChange({ ...value, payments: [{ amount: bal, method: 'cash', reference: '', confirmed: true }] });
                  } else {
                    updatePayment(value.payments.length - 1, { amount: bal });
                  }
                }}
              >
                <span className="material-symbols-outlined text-sm">bolt</span>
                Completar saldo ({money(summary.balance)})
              </button>
            )}
            <button
              type="button"
              className="text-xs px-3 py-1.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-semibold transition-all flex items-center gap-1.5 shadow-sm"
              disabled={value.payments.length >= 20}
              onClick={() => onChange({ ...value, payments: [...value.payments, { amount: 0, method: 'cash', reference: '', confirmed: true }] })}
            >
              <span className="material-symbols-outlined text-sm">add</span>
              Agregar método de pago
            </button>
          </div>
        </div>

        {!value.payments.length && (
          <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 text-xs sm:text-sm text-slate-400 text-center">
            Sin cobros nuevos. Agrega solo dinero recibido ahora; no repitas los pagos anteriores. Si ya está liquidada, puedes entregar sin cobrar otra vez.
          </div>
        )}

        {/* Payment Line Cards */}
        <div className="space-y-3.5">
          {value.payments.map((payment, index) => {
            const allowedMethods = Object.entries(PAYMENT_METHODS).filter(([key]) => !detail.remainingMethodsOnly || isBalancePaymentMethod(key));
            return (
              <div
                key={index}
                className="rounded-2xl bg-slate-900/80 border border-slate-700/80 p-4 sm:p-5 space-y-4 shadow-md transition-all hover:border-slate-600"
              >
                {/* Payment Card Header */}
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-primary-500/20 text-primary-300 border border-primary-500/30">
                      Pago #{index + 1}
                    </span>
                    <span className="text-xs text-slate-400">
                      {payment.method ? PAYMENT_METHODS[payment.method] : 'Método'}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="text-xs px-2.5 py-1 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-950/40 border border-red-500/20 transition-all flex items-center gap-1"
                    onClick={() => onChange({ ...value, payments: value.payments.filter((_, i) => i !== index) })}
                  >
                    <span className="material-symbols-outlined text-xs">delete</span>
                    <span>Quitar pago {index + 1}</span>
                  </button>
                </div>

                {/* Method Selector Pills */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Método {index + 1}
                  </label>
                  {/* Hidden accessible select ensuring static tests/forms continue matching */}
                  <select
                    className="sr-only"
                    value={payment.method}
                    onChange={event => updatePayment(index, { method: event.target.value as typeof payment.method, receipt: null, receivedBy: '' })}
                  >
                    {allowedMethods.map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>

                  <div className="flex flex-wrap gap-2">
                    {allowedMethods.map(([key, label]) => {
                      const isSelected = payment.method === key;
                      const icon = key === 'cash' ? 'payments' : key === 'zelle' ? 'send_to_mobile' : key === 'cashapp' ? 'attach_money' : key === 'card' ? 'credit_card' : 'account_balance';
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => updatePayment(index, { method: key as typeof payment.method, receipt: null, receivedBy: '' })}
                          className={`px-3 py-2 rounded-xl text-xs font-medium border transition-all flex items-center gap-2 ${
                            isSelected
                              ? 'bg-primary-500/20 border-primary-500 text-white font-bold ring-1 ring-primary-500/40 shadow-sm'
                              : 'bg-slate-950/60 border-slate-700/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                          }`}
                        >
                          <span className="material-symbols-outlined text-sm">{icon}</span>
                          <span>{label}</span>
                          {isSelected && <span className="material-symbols-outlined text-xs text-primary-400">check</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Amount and Contextual Fields */}
                <div className="grid gap-3.5 sm:grid-cols-2 pt-1">
                  {/* Amount Field */}
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      Importe {index + 1} (USD)
                    </span>
                    <div className="flex items-stretch rounded-xl overflow-hidden border border-slate-700 bg-[var(--bg-card)] focus-within:ring-2 focus-within:ring-primary-500 shadow-sm">
                      <span className="flex items-center justify-center px-4 bg-slate-800/40 text-slate-400 font-bold text-sm border-r border-slate-700 select-none">
                        $
                      </span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        max="99999999"
                        className="w-full bg-transparent px-3.5 py-2.5 text-sm font-semibold text-[var(--text-primary)] placeholder-slate-500 focus:outline-none font-mono"
                        placeholder="0.00"
                        value={payment.amount || ''}
                        onChange={event => updatePayment(index, { amount: Number(event.target.value) })}
                      />
                    </div>
                  </label>

                  {/* Cash Receiver or Non-Cash Receipt */}
                  {payment.method === 'cash' ? (
                    <label className="flex flex-col gap-1.5 text-sm">
                      <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                        Persona que recibió el dinero {index + 1}
                      </span>
                      <div className="relative">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 material-symbols-outlined text-base">badge</span>
                        <input
                          required
                          minLength={2}
                          maxLength={200}
                          className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                          placeholder="Nombre del personal en yarda"
                          value={payment.receivedBy || ''}
                          onChange={event => updatePayment(index, { receivedBy: event.target.value })}
                        />
                      </div>
                    </label>
                  ) : (
                    <div className="flex flex-col gap-1.5 text-sm">
                      <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                        Comprobante {index + 1} (imagen obligatoria)
                      </span>
                      <label className="relative flex items-center justify-between p-2.5 rounded-xl border border-dashed border-slate-700 hover:border-primary-500 bg-slate-950 cursor-pointer transition-all">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="material-symbols-outlined text-primary-400 text-lg">cloud_upload</span>
                          <span className="text-xs text-slate-300 truncate">
                            {payment.receipt ? 'Comprobante adjunto' : 'Subir imagen del voucher'}
                          </span>
                        </div>
                        <input
                          type="file"
                          className="sr-only"
                          required={!payment.receipt}
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          onChange={event => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            if (file) void upload(index, file);
                          }}
                        />
                        <span className="text-[11px] px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 font-medium">
                          Explorar
                        </span>
                      </label>
                      {payment.receipt && (
                        <a
                          className="text-xs text-primary-400 hover:underline flex items-center gap-1 mt-0.5"
                          href={payment.receipt}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <span className="material-symbols-outlined text-xs">visibility</span>
                          Ver comprobante subido
                        </a>
                      )}
                    </div>
                  )}
                </div>

                {/* Reference */}
                <label className="flex flex-col gap-1.5 text-sm pt-1">
                  <span className="text-xs font-medium text-slate-400">
                    Referencia {index + 1} (opcional)
                  </span>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 material-symbols-outlined text-base">tag</span>
                    <input
                      maxLength={200}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      value={payment.reference}
                      onChange={event => updatePayment(index, { reference: event.target.value })}
                      placeholder="Referencia de transacción, cheque o recibo; nunca datos de tarjeta"
                    />
                  </div>
                </label>
              </div>
            );
          })}
        </div>

        {value.payments.length > 0 && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 text-amber-300 text-xs">
            <span className="material-symbols-outlined text-base shrink-0">shield</span>
            <span>Registra solo dinero recibido y verificado. Un cheque o transferencia pendiente de confirmar no cuenta como cobrado. No guardes números de tarjeta ni CVV.</span>
          </div>
        )}
      </div>
    </fieldset>
    {uploading && <p role="status">Subiendo comprobante… Espera a que termine antes de guardar.</p>}
    {uploadError && <p role="alert" className="text-sm text-red-600">{uploadError}</p>}
    {previewError && <p role="alert" className="text-red-600 text-sm">{previewError}</p>}
    {summary && <div className="rounded-xl bg-[var(--bg-card-subtle)] p-4 text-sm space-y-2" aria-live="polite">
      <h3 className="font-bold text-base">Desglose de venta y cobro</h3>
      <dl className="space-y-3">
        {amountRow('Precio de la pieza', money(detail.order.price))}
        {amountRow('Delivery / envío', money(detail.order.shipping))}
        {amountRow('Cargo de core', money(currentCore))}
        {amountRow('Monto total de la venta', money(saleTotal), true)}
        {amountRow('Downpayment / pagos anteriores', money(detail.order.paid))}
        {amountRow('Monto restante antes de este cobro', money(previousBalance))}
        {amountRow('Ajuste por core recibido', summary.coreCredit ? `-${money(summary.coreCredit)}` : money(0))}
        {amountRow('Monto total a liquidar', money(summary.total), true)}
        {amountRow('Cobro nuevo', money(summary.received))}
        {amountRow('Acumulado cobrado', money(summary.paid))}
        {amountRow('Monto restante por cobrar', money(summary.balance), true)}
      </dl>
      <p className="text-xs text-[var(--text-secondary)]">Downpayment / pagos anteriores incluye el abono y cualquier pago posterior ya registrado; no es un cobro nuevo. Total de venta = pieza + delivery + core. El ajuste de core se descuenta una sola vez.</p>
      {!detail.order.shipping && <p className="text-xs text-[var(--text-secondary)]">Esta orden no tiene un cargo de delivery registrado.</p>}
      {(value.coreAction === 'charge' || (detail.order.core > 0 && value.coreAction === 'keep')) && <p>{summary.balance === 0 ? 'Core incluido en la liquidación.' : 'El cargo de core sigue incluido en el saldo pendiente.'}</p>}
      {summary.balance === 0 ? (
        <p className="text-sm font-semibold text-emerald-400">✓ Saldo liquidado exactamente. Listo para registrar la entrega.</p>
      ) : (
        <p className="text-sm font-medium text-amber-400">Saldo pendiente por cobrar: {money(summary.balance)}</p>
      )}
    </div>}
    <details className="text-sm space-y-3"><summary className="cursor-pointer font-bold">Historial de cobros y core</summary>
      {!detail.payments.length && <p>Sin cobros registrados.</p>}
      {detail.payments.map(payment => <article key={payment.id} className="rounded-xl bg-[var(--bg-card-subtle)] p-3 mt-2">
        <strong>{money(payment.amount)} · {payment.method ? PAYMENT_METHODS[payment.method] : 'Método no registrado'}</strong>
        <p>{payment.date ? new Date(payment.date).toLocaleString() : 'Fecha histórica no registrada'} · {payment.actor || 'Operador no registrado'}</p>
        {payment.reference && <p className="break-words">Referencia: {payment.reference}</p>}
        {payment.receivedBy && <p>Recibió: {payment.receivedBy}</p>}
        {payment.receipt && <a className="underline" href={payment.receipt} target="_blank" rel="noreferrer">Ver comprobante del cobro</a>}
      </article>)}
      {detail.coreReceipt && <p className="break-words">Core recibido: {money(detail.coreReceipt.amount)} · {detail.coreReceipt.reference} · {detail.coreReceipt.actor} · {new Date(detail.coreReceipt.date).toLocaleString()}</p>}
    </details>
  </section>;
};

export const OrderPaymentsModal: React.FC<{
  orderId: string; code: string; customerName: string; managed: boolean; initialDelivery?: boolean; allowDelivery?: boolean; onClose: () => void;
}> = ({ orderId, code, customerName, managed, initialDelivery = false, allowDelivery = true, onClose }) => {
  const { detail, error: loadError, reload } = usePaymentDetail(orderId);
  const [value, setValue] = useState(emptySettlement);
  const [delivery, setDelivery] = useState(initialDelivery);
  const [deliveryPhotos, setDeliveryPhotos] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [verifiedPayments, setVerifiedPayments] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadInFlight = useRef(false);
  const onUploadingChange = (active: boolean) => { uploadInFlight.current = active; setUploading(active); };
  const [workflow, setWorkflow] = useState<{ order: WorkflowOrder; events: WorkflowEvent[] } | null>(null);
  const [workflowError, setWorkflowError] = useState('');
  const [workflowAttempt, setWorkflowAttempt] = useState(0);
  const [downpayment, setDownpayment] = useState<DownpaymentLine[]>([]);
  const [preparation, setPreparation] = useState(emptyPreparation);
  useEffect(() => {
    if (!managed) return;
    let active = true;
    setWorkflow(null); setWorkflowError('');
    void (async () => {
      try {
        const data = await paymentResponse<{ order: WorkflowOrder; events: WorkflowEvent[] }>(await apiFetch(`/orders/${orderId}/workflow`));
        if (active) {
          setWorkflow(data); setDownpayment([{ method: 'cash', amount: data.order.paid, receivedBy: '', receipt: null }]);
          if (data.order.preparation?.corePlan === 'pay_core') {
            setValue(prev => {
              if (prev.coreAction === 'keep' && !prev.coreAmount) {
                return {
                  ...prev,
                  coreAction: 'charge',
                  coreAmount: (data.order.core || 0) > 0 ? data.order.core! : 150,
                };
              }
              return prev;
            });
          }
        }
      } catch (reason) { if (active) setWorkflowError(reason instanceof Error ? reason.message : 'No se pudo cargar el flujo.'); }
    })();
    return () => { active = false; };
  }, [orderId, managed, workflowAttempt]);
  const completed = workflow ? completedWorkflowStages(workflow.events, workflow.order) : [];
  const needsConfirmation = managed && workflow && !completed.includes('ack');
  const needsPreparation = managed && workflow && !completed.includes('prepare');
  const needsDownpayment = needsConfirmation && workflow.order.paid > 0;
  const saving = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving.current && !uploadInFlight.current) close.current();
      if (event.key !== 'Tab') return;
      const allControls: HTMLElement[] = dialog.current ? Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary')) : [];
      const controls = allControls.filter(item => item.getClientRects().length);
      const target = event.shiftKey && document.activeElement === controls[0] ? controls.at(-1)
        : !event.shiftKey && document.activeElement === controls.at(-1) ? controls[0] : null;
      if (target) { event.preventDefault(); target.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, []);
  const save = async (deliver: boolean) => {
    if (!detail || saving.current || uploadInFlight.current) return;
    setError('');
    if (deliver && !allowDelivery) { setError('Esta orden no permite registrar otra entrega. Revisa su estado e historial.'); return; }
    const input = settlementSchema.safeParse(value);
    if (!input.success) { setError(input.error.issues[0]?.message || 'Revisa los importes y referencias.'); return; }
    try { validateCollectionEvidence(input.data); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Revisa los comprobantes.'); return; }
    if (value.payments.length && !verifiedPayments) { setError('Confirma que verificaste la recepción de todos los pagos.'); return; }
    if (deliver && !confirmed) { setError('Confirma la entrega física y la comunicación de la garantía.'); return; }
    saving.current = true; setBusy(true);
    try {
      let completion: { downpayment?: DownpaymentLine[]; preparation?: ReturnType<typeof preparationSchema.parse> } | undefined;
      if (deliver) {
        if (previewSettlement(detail.order, input.data).balance !== 0) throw new Error('Liquida el saldo pendiente antes de confirmar la entrega.');
        if (input.data.payments.some(payment => !isBalancePaymentMethod(payment.method))) throw new Error('El saldo de entrega solo admite efectivo, Cash App o Zelle.');
        if (managed) {
          if (!workflow) throw new Error(workflowError || 'Espera a que se cargue el flujo.');
          if (workflow.order.version !== detail.version) throw new Error('La orden cambió; cierra y vuelve a abrir el modal.');
          completion = {};
          if (needsDownpayment) {
            completion.downpayment = downpaymentSchema.parse(downpayment);
            validateDownpayment(workflow.order.paid, completion.downpayment);
          }
          if (needsPreparation) completion.preparation = preparationSchema.parse(preparation);
        }
      }
      const body = deliver && managed
        ? { version: detail.version, settlement: input.data, task: 'delivery', outcome: 'completed', deliveryPhotos, confirmed, completion }
        : { version: detail.version, settlement: input.data, ...(deliver ? { delivery: { photos: deliveryPhotos, confirmed } } : {}) };
      const result = await paymentResponse<{ ok: boolean; version: number }>(await apiFetch(`/orders/${orderId}/${deliver && managed ? 'workflow' : 'payments'}`, { method: 'POST', body: JSON.stringify(body) }));
      if (!result.ok || result.version !== detail.version + 1) throw new Error('Respuesta inválida; recarga para comprobar el cobro antes de reintentar.');
      window.dispatchEvent(new Event('radar:data-changed'));
      window.dispatchEvent(new CustomEvent('radar:followup-updated', { detail: { orderId } }));
      close.current();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se guardó el cobro.'); }
    finally { saving.current = false; setBusy(false); }
  };
  return createPortal(<div className="horizon-modal horizon-payment-overlay fixed inset-0 z-[160] bg-black/50 flex items-center justify-center p-3">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="order-payment-title" className="horizon-workflow-form horizon-view-card w-full max-w-2xl max-h-[92dvh] overflow-y-auto p-5 space-y-4">
      <div className="flex items-start justify-between gap-3"><h2 id="order-payment-title" className="text-xl font-bold">{delivery ? 'Registrar entrega' : 'Registrar cobro / ver pagos y core'} · {code}</h2>
        <button type="button" disabled={busy || uploading} onClick={onClose} aria-label="Cerrar cobros">Cerrar</button></div>
      {loadError ? <><p role="alert" className="text-red-600">{loadError}</p><button type="button" onClick={reload}>Recargar cobros</button></>
        : !detail ? <p role="status">Cargando cobros…</p> : <form onSubmit={event => { event.preventDefault(); void save(delivery); }} className="space-y-4">
          <OrderPaymentFields orderId={orderId} detail={{ ...detail, remainingMethodsOnly: detail.remainingMethodsOnly || delivery }} value={value} onChange={next => { setValue(next); setVerifiedPayments(false); }} disabled={busy || uploading} onUploadingChange={onUploadingChange} />
          {value.payments.length > 0 && <label className="flex gap-2 text-sm"><input type="checkbox" disabled={busy} checked={verifiedPayments} onChange={event => setVerifiedPayments(event.target.checked)} />Verifiqué la recepción de todos los pagos indicados.</label>}
          {!initialDelivery && allowDelivery && <label className="flex gap-2 text-sm"><input type="checkbox" disabled={busy || uploading} checked={delivery} onChange={event => setDelivery(event.target.checked)} />Registrar también la entrega física</label>}
          {delivery && <fieldset disabled={busy || uploading} className="space-y-3">
            <p className="text-sm">Al confirmar se guardan juntos los pagos, las verificaciones pendientes y la entrega. La orden queda Entregada y finaliza el flujo comercial; los seguimientos post-entrega continúan. La fecha y hora son automáticas.</p>
            <p className="text-sm">Los pagos anteriores ya están incluidos. Si el saldo es cero, no agregues otro cobro. La garantía y el plazo de devolución del core comienzan con la entrega. Después podrás adjuntar el invoice PDF en la sección de posventa; si falta, quedará pendiente.</p>
            {managed && (workflowError ? <><p role="alert" className="text-red-600">{workflowError}</p><button type="button" onClick={() => setWorkflowAttempt(value => value + 1)}>Recargar flujo</button></>
              : !workflow ? <p role="status">Cargando verificaciones pendientes…</p> : <>
                {needsDownpayment && <section><h3 className="font-bold">Confirmación del abono anterior</h3><DownpaymentFields paid={workflow.order.paid} value={downpayment} onChange={setDownpayment} disabled={busy || uploading} onUpload={file => uploadDownpaymentReceipt(orderId, file)} onUploadingChange={onUploadingChange} /></section>}
                {needsConfirmation && !workflow.order.paid && <p>Sin abono anterior: la confirmación se documentará con los pagos recibidos ahora, sin volver a cobrarlos.</p>}
                {needsPreparation && <section><h3 className="font-bold">Preparación y cita pendientes</h3><PreparationFields allowInPerson value={preparation} onChange={setPreparation} disabled={busy || uploading} onUpload={file => uploadDownpaymentReceipt(orderId, file)} onUploadingChange={onUploadingChange} /></section>}
              </>)}
            <OrderDeliveryFields orderId={orderId} customerName={customerName} photos={deliveryPhotos} onChange={setDeliveryPhotos}
              disabled={busy || uploading} onUploadingChange={onUploadingChange} />
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
          </fieldset>}
          {error && <p role="alert" className="text-red-600">{error}</p>}
          <div className="flex flex-wrap gap-3">
            {!initialDelivery && <button type="button" disabled={busy || uploading || !detail.canRecord} className="cyber-btn-secondary px-4 py-2" onClick={() => void save(false)}>Guardar cobro sin entregar</button>}
            {delivery && <button type="submit" disabled={busy || uploading || managed && !workflow} className="horizon-primary rounded-xl px-4 py-2">{busy ? 'Guardando…' : 'Confirmar entrega y cerrar flujo comercial'}</button>}
          </div>
        </form>}
    </div>
  </div>, document.body);
};
