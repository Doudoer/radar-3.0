import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../services/apiFetch';
import { emptySettlement, PAYMENT_METHODS, previewSettlement, settlementSchema, type PaymentDetail, type Settlement } from '../utils/orderPayments';

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
  detail: PaymentDetail; value: Settlement; onChange: (value: Settlement) => void; disabled?: boolean;
}> = ({ detail, value, onChange, disabled }) => {
  let summary: ReturnType<typeof previewSettlement> | null = null;
  let previewError = '';
  try { summary = previewSettlement(detail.order, value); }
  catch (reason) { previewError = reason instanceof Error ? reason.message : 'Liquidación inválida'; }
  const updatePayment = (index: number, patch: Partial<Settlement['payments'][number]>) =>
    onChange({ ...value, payments: value.payments.map((item, i) => i === index ? { ...item, ...patch } : item) });
  return <section className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-3 text-sm">
      <p>Total anterior<strong className="block">{money(detail.order.price + detail.order.shipping + detail.order.core)}</strong></p>
      <p>Cobrado anteriormente<strong className="block">{money(detail.order.paid)}</strong></p>
      <p>Cargo de core<strong className="block">{money(detail.order.core)}</strong></p>
    </div>
    {!detail.canRecord && <p className="text-sm text-amber-600">Solo administración puede registrar cobros y recibir el core. Puedes confirmar una entrega ya liquidada.</p>}
    <fieldset disabled={disabled || !detail.canRecord} className="space-y-4">
      <legend className="font-bold mb-2">Core / pieza usada</legend>
      {detail.order.coreReceived ? <p className="text-sm">Core recibido. El cargo ya fue eliminado.</p> : detail.order.core > 0 ? <>
        <label className="flex flex-col gap-2 text-sm">Tratamiento del core
          <select value={value.coreAction} onChange={event => onChange({ ...value, coreAction: event.target.value as Settlement['coreAction'] })}>
            <option value="keep">El cliente paga el core · conservar cargo</option>
            <option value="received">Recibimos la pieza usada · eliminar cargo</option>
          </select>
        </label>
        {value.coreAction === 'received' && <>
          <label className="flex flex-col gap-2 text-sm">Referencia de recepción del core
            <input maxLength={1000} value={value.coreReference} onChange={event => onChange({ ...value, coreReference: event.target.value })} placeholder="Comprobante y descripción de la pieza recibida" />
          </label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={value.coreConfirmed} onChange={event => onChange({ ...value, coreConfirmed: event.target.checked })} />
            Confirmo que recibimos físicamente la pieza usada. No es una promesa de devolución.</label>
        </>}
        <p className="text-xs text-[var(--text-secondary)]">Si el core ya fue cobrado y corresponde devolver dinero, tramita una devolución desde Reembolsos.</p>
      </> : <p className="text-sm">Sin cargo de core.</p>}
      <div className="flex flex-wrap justify-between items-center gap-2">
        <strong>Pagos recibidos ahora</strong>
        <button type="button" className="cyber-btn-secondary px-3 py-2" disabled={value.payments.length >= 20} onClick={() => onChange({ ...value, payments: [...value.payments, { amount: 0, method: 'cash', reference: '', confirmed: true }] })}>Agregar método de pago</button>
      </div>
      {!value.payments.length && <p className="text-sm text-[var(--text-secondary)]">Sin cobros nuevos. Agrega una línea por cada método utilizado.</p>}
      {value.payments.map((payment, index) => <div key={index} className="rounded-xl bg-[var(--bg-card-subtle)] p-3 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm">Método {index + 1}
            <select value={payment.method} onChange={event => updatePayment(index, { method: event.target.value as typeof payment.method })}>
              {Object.entries(PAYMENT_METHODS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm">Importe {index + 1} (USD)
            <input type="number" min="0.01" step="0.01" max="99999999" value={payment.amount || ''} onChange={event => updatePayment(index, { amount: Number(event.target.value) })} />
          </label>
        </div>
        <label className="flex flex-col gap-2 text-sm">Referencia {index + 1}{payment.method === 'cash' ? ' (opcional)' : ' (obligatoria)'}
          <input maxLength={200} value={payment.reference} onChange={event => updatePayment(index, { reference: event.target.value })} placeholder="Referencia de transacción, cheque o recibo; nunca datos de tarjeta" />
        </label>
        <button type="button" className="text-sm text-red-600" onClick={() => onChange({ ...value, payments: value.payments.filter((_, i) => i !== index) })}>Quitar pago {index + 1}</button>
      </div>)}
      {value.payments.length > 0 && <p className="text-sm text-amber-600">Registra solo dinero recibido y verificado. Un cheque o transferencia pendiente de confirmar no cuenta como cobrado. No guardes números de tarjeta ni CVV.</p>}
    </fieldset>
    {previewError && <p role="alert" className="text-red-600 text-sm">{previewError}</p>}
    {summary && <div className="rounded-xl bg-[var(--bg-card-subtle)] p-4 text-sm space-y-2" aria-live="polite">
      <p>Ajuste por core recibido: <strong>-{money(summary.coreCredit)}</strong></p>
      <p>Total ajustado: <strong>{money(summary.total)}</strong></p>
      <p>Cobro nuevo: <strong>{money(summary.received)}</strong></p>
      <p>Acumulado cobrado: <strong>{money(summary.paid)}</strong></p>
      <p>Saldo final: <strong>{money(summary.balance)}</strong></p>
      {detail.order.core > 0 && value.coreAction === 'keep' && <p>{summary.balance === 0 ? 'Core incluido en la liquidación.' : 'El cargo de core sigue incluido en el saldo pendiente.'}</p>}
    </div>}
    <details className="text-sm space-y-3"><summary className="cursor-pointer font-bold">Historial de cobros y core</summary>
      {!detail.payments.length && <p>Sin cobros registrados.</p>}
      {detail.payments.map(payment => <article key={payment.id} className="rounded-xl bg-[var(--bg-card-subtle)] p-3 mt-2">
        <strong>{money(payment.amount)} · {payment.method ? PAYMENT_METHODS[payment.method] : 'Método no registrado'}</strong>
        <p>{payment.date ? new Date(payment.date).toLocaleString() : 'Fecha histórica no registrada'} · {payment.actor || 'Operador no registrado'}</p>
        {payment.reference && <p className="break-words">Referencia: {payment.reference}</p>}
      </article>)}
      {detail.coreReceipt && <p className="break-words">Core recibido: {money(detail.coreReceipt.amount)} · {detail.coreReceipt.reference} · {detail.coreReceipt.actor} · {new Date(detail.coreReceipt.date).toLocaleString()}</p>}
    </details>
  </section>;
};

export const OrderPaymentsModal: React.FC<{
  orderId: string; code: string; managed: boolean; initialDelivery?: boolean; onClose: () => void;
}> = ({ orderId, code, managed, initialDelivery = false, onClose }) => {
  const { detail, error: loadError, reload } = usePaymentDetail(orderId);
  const [value, setValue] = useState(emptySettlement);
  const [delivery, setDelivery] = useState(initialDelivery);
  const [notes, setNotes] = useState('');
  const [evidence, setEvidence] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [verifiedPayments, setVerifiedPayments] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving.current) close.current();
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
    if (!detail || saving.current) return;
    setError('');
    const input = settlementSchema.safeParse(value);
    if (!input.success) { setError(input.error.issues[0]?.message || 'Revisa los importes y referencias.'); return; }
    if (value.payments.length && !verifiedPayments) { setError('Confirma que verificaste la recepción de todos los pagos.'); return; }
    if (deliver && (notes.trim().length < 5 || evidence.trim().length < 5 || !confirmed)) { setError('Indica el detalle, la evidencia y confirma la entrega física.'); return; }
    saving.current = true; setBusy(true);
    try {
      const body = deliver && managed
        ? { version: detail.version, settlement: input.data, task: 'delivery', outcome: 'completed', notes, evidence, confirmed }
        : { version: detail.version, settlement: input.data, ...(deliver ? { delivery: { notes, evidence, confirmed } } : {}) };
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
      <div className="flex items-start justify-between gap-3"><h2 id="order-payment-title" className="text-xl font-bold">Registrar cobro y entrega · {code}</h2>
        <button type="button" disabled={busy} onClick={onClose} aria-label="Cerrar cobros">Cerrar</button></div>
      {loadError ? <><p role="alert" className="text-red-600">{loadError}</p><button type="button" onClick={reload}>Recargar cobros</button></>
        : !detail ? <p role="status">Cargando cobros…</p> : <form onSubmit={event => { event.preventDefault(); void save(delivery); }} className="space-y-4">
          <OrderPaymentFields detail={detail} value={value} onChange={next => { setValue(next); setVerifiedPayments(false); }} disabled={busy} />
          {value.payments.length > 0 && <label className="flex gap-2 text-sm"><input type="checkbox" disabled={busy} checked={verifiedPayments} onChange={event => setVerifiedPayments(event.target.checked)} />Verifiqué la recepción de todos los pagos indicados.</label>}
          <label className="flex gap-2 text-sm"><input type="checkbox" disabled={busy} checked={delivery} onChange={event => setDelivery(event.target.checked)} />Registrar también la entrega física</label>
          {delivery && <fieldset disabled={busy} className="space-y-3">
            {managed && <p className="text-sm text-[var(--text-secondary)]">Las etapas anteriores del flujo deben estar verificadas. Si faltan, puedes guardar solo el cobro y completarlas después.</p>}
            <label className="flex flex-col gap-2 text-sm">Detalle de la entrega<textarea minLength={5} maxLength={5000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
            <label className="flex flex-col gap-2 text-sm">Evidencia de entrega<textarea minLength={5} maxLength={5000} value={evidence} onChange={event => setEvidence(event.target.value)} /></label>
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Confirmo la entrega física, el comprobante y la comunicación de la garantía.</label>
          </fieldset>}
          {error && <p role="alert" className="text-red-600">{error}</p>}
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={busy || !detail.canRecord} className="cyber-btn-secondary px-4 py-2" onClick={() => void save(false)}>Guardar cobro sin entregar</button>
            {delivery && <button type="submit" disabled={busy} className="horizon-primary rounded-xl px-4 py-2">{busy ? 'Guardando…' : 'Confirmar cobro y entrega'}</button>}
          </div>
        </form>}
    </div>
  </div>, document.body);
};
