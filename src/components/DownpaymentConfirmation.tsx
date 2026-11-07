import React, { useRef, useState } from 'react';
import { DOWNPAYMENT_METHODS, type DownpaymentLine } from '../utils/downpaymentConfirmation';
import { uploadOrderFile } from '../services/orderFiles';

export const uploadDownpaymentReceipt = (orderId: string, file: File) => uploadOrderFile(orderId, file);

export const DownpaymentFields: React.FC<{
  paid: number; value: DownpaymentLine[]; onChange: (value: DownpaymentLine[]) => void;
  onUpload: (file: File) => Promise<string>; disabled?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
}> = ({ paid, value, onChange, onUpload, disabled, onUploadingChange }) => {
  const [uploading, setUploading] = useState<number | null>(null);
  const uploadInFlight = useRef(false);
  const [error, setError] = useState('');
  const update = (index: number, patch: Partial<DownpaymentLine>) => onChange(value.map((item, i) => i === index ? { ...item, ...patch } : item));
  const total = value.reduce((sum, item) => sum + Math.round(item.amount * 100), 0) / 100;
  const upload = async (index: number, file: File) => {
    if (uploadInFlight.current) return;
    uploadInFlight.current = true;
    setUploading(index); onUploadingChange?.(true); setError('');
    try { update(index, { receipt: await onUpload(file) }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo subir el comprobante.'); }
    finally { uploadInFlight.current = false; setUploading(null); onUploadingChange?.(false); }
  };
  return <section className="space-y-4">
    <p className="text-sm">Downpayment ya registrado: <strong>${paid.toFixed(2)}</strong>. Este monto no vuelve a sumarse al saldo cobrado.</p>
    <p className="text-sm text-[var(--text-secondary)]">La fecha se registra automáticamente al guardar. Agrega una línea por cada método si el pago fue dividido.</p>
    <fieldset disabled={disabled || uploading !== null} className="space-y-4">
      {value.map((line, index) => <div key={index} className="rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-subtle)] p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm font-medium">Tipo de pago {value.length > 1 ? index + 1 : ''}
            <select value={line.method} onChange={event => update(index, { method: event.target.value as DownpaymentLine['method'], receipt: null, receivedBy: '', senderName: '' })}>
              {Object.entries(DOWNPAYMENT_METHODS).map(([method, label]) => <option key={method} value={method}>{label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium">Monto pagado {value.length > 1 ? index + 1 : ''} (USD)
            <input required type="number" min="0.01" step="0.01" max="99999999" value={line.amount || ''} onChange={event => update(index, { amount: Number(event.target.value) })} />
          </label>
        </div>

        {line.method === 'cash' && (
          <div className="space-y-1.5">
            <label className="flex flex-col gap-2 text-sm font-medium">Persona que recibió el dinero {value.length > 1 ? index + 1 : ''}
              <input required minLength={2} maxLength={200} placeholder="Nombre de quien recibió el efectivo en la yarda" value={line.receivedBy || ''} onChange={event => update(index, { receivedBy: event.target.value })} />
            </label>
            <p className="text-xs text-emerald-400 font-mono">💵 Depósito en efectivo: solo requiere indicar el receptor físico en yarda.</p>
          </div>
        )}

        {line.method === 'card' && (
          <div className="space-y-2">
            <label className="flex flex-col gap-2 text-sm font-medium">Comprobante {value.length > 1 ? index + 1 : ''} (imagen obligatoria)
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" required={!line.receipt} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(index, file); }} />
              {line.receipt && <a href={line.receipt} target="_blank" rel="noreferrer" className="underline text-cyan-400 text-xs">Ver voucher subido</a>}
            </label>
            <p className="text-xs text-emerald-400 font-mono">⚡ Procesado por Square: no requiere nombre del titular ni verificación del administrador.</p>
          </div>
        )}

        {(line.method === 'zelle' || line.method === 'cashapp') && (
          <div className="space-y-3">
            <label className="flex flex-col gap-2 text-sm font-medium">Nombre de quien envía el pago (Titular de la cuenta {line.method === 'zelle' ? 'Zelle' : 'Cash App'}) {value.length > 1 ? index + 1 : ''}
              <input minLength={2} maxLength={200} placeholder="Ej. Carlos Mendoza (titular de la cuenta remitente)" value={line.senderName || ''} onChange={event => update(index, { senderName: event.target.value })} />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">Comprobante {value.length > 1 ? index + 1 : ''} (imagen obligatoria)
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" required={!line.receipt} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(index, file); }} />
              {line.receipt && <a href={line.receipt} target="_blank" rel="noreferrer" className="underline text-cyan-400 text-xs">Ver captura subida</a>}
            </label>
            <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 space-y-1">
              <p className="font-bold flex items-center gap-1.5"><span className="material-symbols-outlined text-[15px]">notifications_active</span> Alerta automática por WhatsApp:</p>
              <p>Al guardar, el sistema enviará de inmediato un mensaje al Administrador con la captura y nombre del titular para su confirmación bancaria.</p>
            </div>
          </div>
        )}

        {value.length > 1 && <button type="button" className="text-sm text-red-600" onClick={() => onChange(value.filter((_, i) => i !== index))}>Quitar método {index + 1}</button>}
      </div>)}
      <button type="button" className="cyber-btn-secondary px-3 py-2" disabled={value.length >= 20} onClick={() => onChange([...value, { method: 'cash', amount: Math.max(0, Math.round((paid - total) * 100) / 100), receivedBy: '', senderName: '', receipt: null }])}>Agregar método de pago</button>
    </fieldset>
    <p className="text-sm" aria-live="polite">Total documentado: ${total.toFixed(2)} / ${paid.toFixed(2)}</p>
    {uploading !== null && <p role="status">Subiendo comprobante… Espera a que termine antes de guardar.</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </section>;
};
