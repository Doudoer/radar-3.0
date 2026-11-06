import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../services/apiFetch';
import type { Order } from '../types';
import { aftersalesActionSchema, type AftersalesAction, type AftersalesData, type RefundExecution } from '../utils/aftersales';
import { workflowDate } from '../utils/orderWorkflow';
import { WarrantyCountdown } from './WarrantyCountdown';
import { uploadOrderFile } from '../services/orderFiles';

const field = 'flex flex-col gap-2 text-sm';
const button = 'cyber-btn-secondary rounded-xl px-4 py-2 disabled:opacity-50';
const card = 'min-w-0 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 sm:p-5 space-y-4';
const dateLabel = (value: string) => value.split('-').reverse().join('/');
function StatusBadge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'positive' | 'warning' | 'danger' }) {
  const color = tone === 'neutral' ? 'var(--text-secondary)' : `var(--${tone})`;
  return <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold"
    style={{ color, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}>
    <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />{children}
  </span>;
}
function CardHeading({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3">
    <h3 className="flex items-center gap-2 font-bold"><span aria-hidden="true" className="material-symbols-outlined text-[var(--text-secondary)]">{icon}</span>{title}</h3>
    {children}
  </div>;
}
const stamp = (value: string | null) => value ? new Date(value).toLocaleString('es', { timeZone: 'America/New_York' }) : 'No registrada';
const stageLabel: Record<string, string> = {
  registered: 'Registrado', review: 'En revisión', resolution: 'Resolución pendiente', resolved: 'Resuelto',
  denied: 'Rechazado', replacement: 'Reemplazo entregado', requested: 'Solicitado', approved: 'Aprobado',
  rejected: 'Rechazado', completed: 'Dinero devuelto', pending: 'Pendiente', cancelled: 'Cancelado', refunded: 'Resuelto por reembolso',
};
export const uploadAftersalesFile = (orderId: string, file: File) => uploadOrderFile(orderId, file, true);
const SupportFields: React.FC<{ orderId: string; value: string[]; onChange: (value: string[]) => void; pdfOnly?: boolean; onBusy: (busy: boolean) => void }> =
  ({ orderId, value, onChange, pdfOnly, onBusy }) => {
    const [error, setError] = useState('');
    const [uploading, setUploading] = useState(false);
    const lock = useRef(false);
    const upload = async (file: File) => {
      if (lock.current) return;
      if (pdfOnly && file.type !== 'application/pdf') { setError('El invoice debe ser PDF.'); return; }
      if (value.length >= 10) { setError('Máximo 10 soportes por gestión.'); return; }
      lock.current = true; setUploading(true); onBusy(true); setError('');
      try { onChange([...value, await uploadAftersalesFile(orderId, file)]); }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Error al subir el soporte.'); }
      finally { lock.current = false; setUploading(false); onBusy(false); }
    };
    return <div className="space-y-2"><label className={field}>{pdfOnly ? 'Invoice PDF' : 'Soportes PDF o imágenes'}
      <input type="file" className="min-w-0 w-full max-w-full" disabled={uploading} accept={pdfOnly ? 'application/pdf' : 'application/pdf,image/jpeg,image/png,image/webp,image/gif'}
        onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void upload(file); }} /></label>
      {value.map((url, index) => <div key={url} className="flex flex-wrap gap-3"><a className="underline" href={url} target="_blank" rel="noreferrer">Ver soporte {index + 1}</a>
        <button type="button" disabled={uploading} onClick={() => onChange(value.filter(item => item !== url))}>Quitar</button></div>)}
      {uploading && <p role="status">Subiendo soporte…</p>}{error && <p role="alert" className="text-red-600">{error}</p>}</div>;
  };
function ExecutionFields({ orderId, core, value, onChange, onBusy }: {
  orderId: string; core: boolean; value: Partial<RefundExecution>; onChange: (value: Partial<RefundExecution>) => void; onBusy: (busy: boolean) => void;
}) {
  const method = value.method || 'cash';
  return <section className="space-y-3">
    <label className={field}>Método de devolución<select value={method} onChange={event => onChange({ method: event.target.value as RefundExecution['method'], confirmed: true })}>
      <option value="cash">Efectivo</option><option value="square">Tarjeta mediante Square</option>
      {!core && <><option value="zelle">Zelle</option><option value="cashapp">Cash App</option><option value="transfer">Transferencia</option></>}
    </select></label>
    {method === 'cash' ? <label className={field}>Persona que recibe el efectivo<input required minLength={2} maxLength={200}
      value={'recipient' in value ? value.recipient || '' : ''} onChange={event => onChange({ method: 'cash', recipient: event.target.value, confirmed: true })} /></label>
      : <><p>Realiza la devolución en el proveedor antes de confirmarla aquí. Radar solo registra la operación.</p>
        {method === 'square' && <label className={field}>Últimos 4 dígitos de la tarjeta utilizada<input required inputMode="numeric" pattern="[0-9]{4}" maxLength={4}
          value={'last4' in value ? value.last4 || '' : ''} onChange={event => onChange({ ...value, last4: event.target.value } as Partial<RefundExecution>)} /></label>}
        <label className={field}>Referencia de la devolución<input required minLength={2} maxLength={200} value={'reference' in value ? value.reference || '' : ''}
          onChange={event => onChange({ ...value, reference: event.target.value } as Partial<RefundExecution>)} /></label>
        <SupportFields orderId={orderId} value={'receipt' in value && value.receipt ? [value.receipt] : []} onBusy={onBusy}
          onChange={files => onChange({ ...value, receipt: files[files.length - 1] } as Partial<RefundExecution>)} /></>}
  </section>;
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
      if (requestId === generation.current) { setDetail(body); setError(''); }
    } catch (reason) { if (requestId === generation.current) setError(reason instanceof Error ? reason.message : 'Error al cargar la posventa.'); }
  }, [order.id]);
  useEffect(() => {
    void load();
    const refresh = () => { void load(); };
    window.addEventListener('radar:data-changed', refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { generation.current++; window.clearInterval(timer); window.removeEventListener('radar:data-changed', refresh); };
  }, [load]);
  const open = (action: string, id = 0) => {
    setMode(action); setTarget(id); setNotes(''); setFiles([]); setNotified(false); setConfirmed(false);
    setStock(''); setAmount(''); setPieceRequired(false); setExecution({ method: 'cash', confirmed: true });
    key.current = null; setError(''); setMessage('');
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (lock.current || uploading || !detail) return;
    let data: unknown;
    if (mode === 'invoice') data = { action: mode, file: files[0] };
    if (mode === 'warranty_correct') data = { action: mode, days: Number(amount), notes };
    if (mode === 'claim_create') data = { action: mode, notes, files, nextDate };
    if (mode.startsWith('claim_') && mode !== 'claim_create') data = { action: 'claim_update', id: target,
      stage: mode.slice(6), notes, files, notified, nextDate, replacementStock: stock || undefined, confirmed };
    if (mode === 'refund_create') data = { action: mode, amount: Number(amount), notes, files, pieceRequired };
    if (mode.startsWith('refund_') && mode !== 'refund_create') data = { action: 'refund_update', id: target,
      stage: mode.slice(7), notes, pieceReceived: confirmed, execution: mode === 'refund_completed' ? execution : undefined };
    if (mode === 'core_receive') data = { action: mode, notes, files, confirmed };
    if (mode === 'core_refund') data = { action: mode, execution };
    const parsed = aftersalesActionSchema.safeParse(data);
    if (!parsed.success) { setError(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(' · ')); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const response = await apiFetch(`/orders/${order.id}/aftersales`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: detail.version, idempotencyKey: key.current ??= crypto.randomUUID(), data: parsed.data }) });
      const body = await response.json();
      if (!response.ok) { key.current = null; throw new Error(body.message || 'No se pudo guardar la gestión.'); }
      setMode(''); setMessage('Gestión registrada. Fecha, hora y responsable guardados automáticamente.');
      window.dispatchEvent(new Event('radar:data-changed'));
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Error al guardar.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const actionButton = (text: string, action: string, id = 0) => <button type="button" className={button} disabled={busy || uploading} onClick={() => open(action, id)}>{text}</button>;
  return <section id="order-aftersales" className="horizon-view-card space-y-5 scroll-mt-6">
    <h2 className="text-xl font-bold">Garantía, reclamos y devoluciones</h2>
    {error && <p role="alert" className="text-red-600">{error} <button type="button" className="underline" onClick={() => void load()}>Actualizar</button></p>}
    {message && <p role="status">{message}</p>}
    {!detail ? <p>Cargando posventa…</p> : <>
      <section aria-label="Garantía de la pieza" className={card}>
        <CardHeading icon="verified_user" title="Garantía de la pieza">
          <StatusBadge tone={detail.warranty.status === 'expired' ? 'danger' : detail.warranty.status === 'critical' ? 'warning' : detail.warranty.status === 'active' ? 'positive' : 'neutral'}>
            {({ not_started: 'Sin iniciar', active: 'Vigente', critical: 'Próxima a vencer', expired: 'Vencida' } as Record<string, string>)[detail.warranty.status]}
          </StatusBadge>
        </CardHeading>
        <WarrantyCountdown terms={detail.warranty.terms} />
        {order.status === 'reembolsado' && <p>Compra reembolsada. La cobertura se muestra como registro histórico; no permite abrir otro reclamo de esta venta.</p>}
        {detail.warranty.terms && <dl className="grid gap-4 sm:grid-cols-3 text-sm">
          <div><dt className="text-[var(--text-secondary)]">Duración</dt><dd className="mt-1 font-bold">{detail.warranty.terms.days} días</dd></div>
          <div><dt className="text-[var(--text-secondary)]">Inicio</dt><dd className="mt-1 font-semibold">{stamp(detail.warranty.terms.startedAt)}</dd></div>
          <div><dt className="text-[var(--text-secondary)]">Vencimiento</dt><dd className="mt-1 font-semibold">{detail.warranty.terms.policy === 'calendar'
            ? <>{detail.warranty.deadline ? dateLabel(detail.warranty.deadline) : 'Sin fecha verificable'}<span className="block text-xs font-normal text-[var(--text-secondary)]">Al finalizar el día · Nueva York</span></>
            : stamp(new Date(Date.parse(detail.warranty.terms.startedAt) + detail.warranty.terms.days * 86400000).toISOString())}</dd></div>
        </dl>}
        <details className="text-sm space-y-3">
          <summary className="cursor-pointer font-semibold text-[var(--text-secondary)]">Ver condiciones y administración</summary>
          <p>Un reclamo registrado a tiempo sigue atendible aunque la garantía venza durante su revisión. Un reemplazo entregado inicia una nueva cobertura de igual duración.</p>
          {detail.canAdmin && detail.warranty.terms && actionButton('Corregir duración de garantía con motivo', 'warranty_correct')}
        </details>
      </section>
      <div className="grid items-start gap-4 lg:grid-cols-2">
      <section aria-label="Invoice de entrega" className={card}>
        <CardHeading icon="description" title="Invoice de entrega">
          <StatusBadge tone={detail.invoices.length ? 'positive' : order.deliveredAt ? 'warning' : 'neutral'}>
            {detail.invoices.length ? 'Adjunto' : order.deliveredAt ? 'Pendiente' : 'Sin entrega'}
          </StatusBadge>
        </CardHeading>
        {!detail.invoices.length && <p>{order.deliveredAt ? 'Invoice pendiente de adjuntar' : 'Disponible después de la entrega física'}</p>}
        {order.deliveredAt && mode !== 'invoice' && actionButton('Adjuntar invoice PDF', 'invoice')}
        {mode === 'invoice' && <form ref={invoiceForm} aria-label="Adjuntar invoice PDF" onSubmit={event => void save(event)}
          className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] p-3 space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">Selecciona el PDF enviado al cliente (máximo 10 MB) y guarda el invoice para adjuntarlo a esta orden.</p>
          <fieldset className="min-w-0" disabled={busy || uploading}>
            <SupportFields orderId={order.id} value={files} onChange={setFiles} pdfOnly onBusy={setUploading} />
          </fieldset>
          {error && <p role="alert" className="text-red-600">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={button} disabled={busy || uploading || !files.length}>{busy ? 'Guardando…' : 'Guardar invoice'}</button>
            <button type="button" className={button} disabled={busy || uploading} onClick={() => setMode('')}>Cancelar</button>
          </div>
        </form>}
        {detail.invoices.map((invoice, index) => <p key={invoice.id}><a className="underline" href={invoice.file_url} target="_blank" rel="noreferrer">
          {index === 0 ? 'Invoice actual' : 'Invoice anterior'} · Ver / descargar PDF</a> · {invoice.actor_name} · {stamp(invoice.created_at)}</p>)}
      </section>
      <section aria-label="Reclamos" className={card}>
        <CardHeading icon="build" title="Reclamos">
          <StatusBadge tone={detail.claims.some(claim => !['Resolved', 'Denied'].includes(claim.status)) ? 'warning' : 'neutral'}>
            {detail.claims.length ? `${detail.claims.filter(claim => !['Resolved', 'Denied'].includes(claim.status)).length} abiertos · ${detail.claims.length} total` : 'Sin reclamos'}
          </StatusBadge>
        </CardHeading>
        {detail.canManage && actionButton('Abrir reclamo', 'claim_create')}
        {detail.claims.map(claim => <article key={claim.id} className="rounded-xl border border-[var(--border-color)] p-3 space-y-2">
          <p><strong>REC-{claim.id} · {stageLabel[claim.stage || ''] || claim.status}</strong> · {claim.description}</p>
          <p>Responsable #{claim.assigned_user_id || 'Sin asignar'} · Próxima revisión: {claim.next_review_date?.slice(0, 10) || 'No programada'}</p>
          {claim.resolution_notes && <p>{claim.resolution_notes}</p>}
          {claim.evidence_files.map((url, index) => <a key={url} className="underline mr-3" href={url} target="_blank" rel="noreferrer">Evidencia {index + 1}</a>)}
          {detail.canManage && !['Resolved', 'Denied'].includes(claim.status) && <div className="flex flex-wrap gap-2">
            {actionButton('Registrar revisión / comunicación', 'claim_review', claim.id)}
            {actionButton('Preparar resolución', 'claim_resolution', claim.id)}
            {actionButton('Resolver sin reemplazo', 'claim_resolved', claim.id)}
            {detail.canAdmin && <>{actionButton('Entregar reemplazo', 'claim_replacement', claim.id)}{actionButton('Rechazar reclamo', 'claim_denied', claim.id)}</>}
            {actionButton('Solicitar reembolso', 'refund_create')}
          </div>}
        </article>)}
      </section>
      <section aria-label="Reembolsos de compra" className={card}>
        <CardHeading icon="payments" title="Reembolsos de compra">
          <StatusBadge tone={detail.refunds.some(refund => refund.refund_scope !== 'core' && refund.status === 'pending') ? 'warning' : 'neutral'}>
            {detail.refunds.some(refund => refund.refund_scope !== 'core' && refund.status === 'pending') ? 'Solicitud pendiente'
              : detail.refunds.some(refund => refund.refund_scope !== 'core') ? 'Ver historial' : 'Sin solicitudes'}
          </StatusBadge>
        </CardHeading>
        <dl aria-label="Resumen de reembolsos" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {([['Cobrado', detail.paid], ['Devuelto', detail.refunded], ['Reservado', detail.reserved]] as const).map(([label, amount]) =>
            <div key={label} className="min-w-0 rounded-xl bg-[var(--bg-card-subtle)] p-3">
              <dt className="text-xs text-[var(--text-secondary)]">{label}</dt>
              <dd className="mt-1 text-lg font-bold tabular-nums break-all">${amount.toFixed(2)}</dd>
            </div>)}
        </dl>
        {detail.canManage && actionButton('Solicitar reembolso de compra', 'refund_create')}
        {detail.refunds.filter(refund => refund.refund_scope !== 'core').map(refund => <article key={refund.id} className="rounded-xl border border-[var(--border-color)] p-3 space-y-2">
          <p><strong>REF-{refund.id} · ${Number(refund.amount).toFixed(2)} · {stageLabel[refund.review_stage || refund.status] || refund.status}</strong></p><p>{refund.reason}</p>
          {refund.claim_id && <p>Vinculado a REC-{refund.claim_id}</p>}
          {refund.execution && <p>{refund.execution.method === 'cash' ? `Efectivo recibido por ${refund.execution.recipient}` :
            `${refund.execution.method === 'square' ? `Square · tarjeta ****${refund.execution.last4}` : refund.execution.method} · ${refund.execution.reference}`} · {stamp(refund.completed_at)}</p>}
          {detail.canAdmin && refund.status === 'pending' && <div className="flex flex-wrap gap-2">
            {(!refund.review_stage || refund.review_stage === 'requested') && actionButton('Iniciar revisión', 'refund_review', refund.id)}
            {refund.review_stage === 'review' && actionButton('Aprobar importe', 'refund_approved', refund.id)}
            {refund.review_stage === 'approved' && actionButton('Registrar dinero devuelto', 'refund_completed', refund.id)}
            {actionButton('Rechazar solicitud', 'refund_rejected', refund.id)}
          </div>}
        </article>)}
      </section>
      <section aria-label="Depósito del core" className={card}>
        <CardHeading icon="published_with_changes" title="Depósito del core">
          <StatusBadge tone={detail.core.reviewRequired ? 'warning' : detail.core.refund ? 'positive' : detail.core.amount <= 0 ? 'neutral'
            : !detail.core.receivedAt && detail.core.deadline && workflowDate(new Date()) > detail.core.deadline ? 'danger' : 'warning'}>
            {detail.core.reviewRequired ? 'Revisar historial' : detail.core.refund ? 'Devuelto' : detail.core.amount <= 0 ? 'No aplica'
              : detail.core.receivedAt ? 'Devolución pendiente'
              : detail.core.deadline && workflowDate(new Date()) > detail.core.deadline ? 'Plazo vencido' : 'Esperando core'}
          </StatusBadge>
        </CardHeading>
        {detail.core.reviewRequired ? <p>Requiere revisión histórica: no se inventará un depósito ni una fecha.</p>
          : detail.core.amount <= 0 ? <p className="text-sm text-[var(--text-secondary)]">No aplica: sin depósito de core</p>
          : <dl className="grid gap-4 sm:grid-cols-2 text-sm">
            <div><dt className="text-[var(--text-secondary)]">Depósito cobrado</dt><dd className="mt-1 text-2xl font-bold tabular-nums">${detail.core.amount.toFixed(2)}</dd></div>
            <div><dt className="text-[var(--text-secondary)]">Fecha límite · 15 días desde la entrega</dt><dd className="mt-1 font-semibold">{detail.core.deadline ? dateLabel(detail.core.deadline) : 'Sin entrega registrada'}</dd>
              {detail.core.deadline && <dd className="text-xs text-[var(--text-secondary)]">Fin del día · Nueva York</dd>}</div>
          </dl>}
        {detail.core.deadline && !detail.core.receivedAt && detail.core.amount > 0 && <p>Días restantes: {Math.max(0, Math.round((Date.parse(detail.core.deadline) - Date.parse(workflowDate(new Date()))) / 86400000))}</p>}
        {detail.core.receivedAt && <p>Core recibido: {stamp(detail.core.receivedAt)}</p>}
        {detail.core.refund && <p>Devolución: {stamp(detail.core.refund.completed_at)} · {detail.core.refund.execution?.method === 'square' ?
          `Square · tarjeta ****${detail.core.refund.execution.last4}` : 'Efectivo'}</p>}
        {detail.canAdmin && !detail.core.reviewRequired && detail.core.amount > 0 && !detail.core.refund && <div className="flex flex-wrap gap-2">
          {!detail.core.receivedAt ? actionButton('Registrar recepción del core', 'core_receive') : actionButton('Devolver depósito del core', 'core_refund')}
        </div>}
      </section>
      </div>
      {mode && mode !== 'invoice' && <form onSubmit={event => void save(event)} className="rounded-xl border border-[var(--border-color)] p-4 space-y-4">
        <h3 className="font-bold">Registrar gestión verificable</h3>
        <fieldset disabled={busy || uploading} className="space-y-4">
          {!['invoice', 'core_refund'].includes(mode) && <label className={field}>Detalle / motivo / comunicación<textarea required minLength={5} maxLength={5000} value={notes} onChange={event => setNotes(event.target.value)} /></label>}
          {mode === 'warranty_correct' && <label className={field}>Duración corregida (días)<input required type="number" min="0" max="3650" value={amount} onChange={event => setAmount(event.target.value)} /></label>}
          {(mode.startsWith('claim_') || mode === 'refund_create' || mode === 'core_receive') &&
            <SupportFields orderId={order.id} value={files} onChange={setFiles} onBusy={setUploading} />}
          {['claim_create', 'claim_review', 'claim_resolution'].includes(mode) && <label className={field}>Próxima revisión<input required type="date" min={workflowDate(new Date())} value={nextDate} onChange={event => setNextDate(event.target.value)} /></label>}
          {['claim_resolved', 'claim_denied', 'claim_replacement'].includes(mode) && <label className="flex gap-2"><input required type="checkbox" checked={notified} onChange={event => setNotified(event.target.checked)} />Notifiqué la resolución y condiciones al cliente.</label>}
          {mode === 'claim_replacement' && <><label className={field}>Identificación / stock de la pieza de reemplazo<input required value={stock} onChange={event => setStock(event.target.value)} /></label>
            <label className="flex gap-2"><input required type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Confirmo la entrega física del reemplazo. Se inicia una garantía nueva de igual duración.</label></>}
          {mode === 'refund_create' && <><label className={field}>Monto solicitado<input required type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></label>
            <label className="flex gap-2"><input type="checkbox" checked={pieceRequired} onChange={event => setPieceRequired(event.target.checked)} />Requiere devolución de la pieza antes del reembolso.</label></>}
          {mode === 'core_receive' && <label className="flex gap-2"><input required type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Recibí físicamente el core.</label>}
          {mode === 'refund_completed' && <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Recibí la pieza devuelta, si es requisito.</label>}
          {['refund_completed', 'core_refund'].includes(mode) && <><ExecutionFields orderId={order.id} core={mode === 'core_refund'} value={execution} onChange={setExecution} onBusy={setUploading} />
            <label className="flex gap-2"><input required type="checkbox" />Confirmo que el dinero ya fue devuelto y el cliente recibió la constancia.</label></>}
        </fieldset>
        <div className="flex flex-wrap gap-2"><button type="submit" className={button} disabled={busy || uploading}>{busy ? 'Guardando…' : 'Confirmar gestión'}</button>
          <button type="button" className={button} disabled={busy || uploading} onClick={() => setMode('')}>Cancelar</button></div>
      </form>}
      <details><summary className="cursor-pointer font-bold">Historial de posventa y soportes</summary>
        {detail.history.map(item => <div key={item.id} className="py-2">
          <p>{stamp(item.created_at)} · {item.actor_name} · {item.notes}</p>
          {'replacementStock' in item.details && item.details.replacementStock && <p>Reemplazo: {item.details.replacementStock}</p>}
          {'files' in item.details && item.details.files.map((url, index) => <a key={url} className="underline mr-3" href={url} target="_blank" rel="noreferrer">Soporte {index + 1}</a>)}
          {'execution' in item.details && item.details.execution && 'receipt' in item.details.execution &&
            <a className="underline" href={item.details.execution.receipt} target="_blank" rel="noreferrer">Comprobante de devolución</a>}
        </div>)}
      </details>
    </>}
  </section>;
};
