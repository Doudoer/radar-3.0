import React, { useEffect, useState } from 'react';
import { Claim, ClaimCall } from '../types';
import { apiFetch } from '../services/apiFetch';

interface ClaimCallsModalProps {
  claim: Claim;
  isOpen: boolean;
  onClose: () => void;
  onCallAdded: (call: ClaimCall) => void;
}

export const ClaimCallsModal: React.FC<ClaimCallsModalProps> = ({ claim, isOpen, onClose, onCallAdded }) => {
  const [calls, setCalls] = useState<ClaimCall[]>(claim.calls || []);
  const [callerName, setCallerName] = useState(claim.customerName);
  const [callerPhone, setCallerPhone] = useState(claim.customerPhone);
  const [attendedBy, setAttendedBy] = useState(claim.advisor || 'Sin asignar');
  const [conversationSummary, setConversationSummary] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setCalls(claim.calls || []);
    setCallerName(claim.customerName);
    setCallerPhone(claim.customerPhone);
    setAttendedBy(claim.advisor || 'Sin asignar');
    setConversationSummary('');
    setError('');
  }, [claim, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const summary = conversationSummary.trim();
    if (!summary) {
      setError('Escribe un resumen de la conversación.');
      return;
    }

    setIsSaving(true);
    setError('');
    try {
      const response = await apiFetch(`/claims/${claim.id}/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callerName: callerName.trim() || claim.customerName,
          callerPhone: callerPhone.trim() || claim.customerPhone,
          attendedBy: attendedBy.trim() || claim.advisor,
          conversationSummary: summary,
          whatsappDispatched: false,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'No se pudo guardar el seguimiento.');
      }

      const created = await response.json() as ClaimCall;
      const newCall: ClaimCall = {
        ...created,
        callNumber: created.callNumber || calls.length + 1,
      };
      setCalls((current) => [newCall, ...current]);
      setConversationSummary('');
      onCallAdded(newCall);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'No se pudo guardar el seguimiento.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Bitácora de llamadas">
      <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl min-h-0 flex-col overflow-hidden rounded-2xl border border-cyan-500/30 bg-[#070c18]/95 shadow-[0_20px_60px_rgba(0,0,0,0.8)]">
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400" />

        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-cyan-500/20 bg-[#040814]/90 p-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-white">Bitácora de llamadas</h2>
              <span className="rounded border border-cyan-500/30 bg-cyan-950/60 px-2 py-0.5 font-mono text-xs text-cyan-300">{claim.id}</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">{claim.orderCode} · {claim.customerName} · {claim.customerPhone}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-cyan-500/15 hover:text-white" aria-label="Cerrar bitácora">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 custom-scrollbar">
          {(calls.length >= 3) && (
            <div className="flex gap-3 rounded-xl border border-red-500/40 bg-red-950/25 p-3 text-xs text-red-200">
              <span className="material-symbols-outlined text-red-400">warning</span>
              <div><strong className="block text-white">Seguimiento prioritario: {calls.length} conversaciones</strong>Este reclamo continúa abierto y requiere una próxima acción concreta.</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-cyan-500/25 bg-[#040814] p-4">
            <h3 className="flex items-center gap-2 font-mono text-xs font-bold uppercase text-cyan-300">
              <span className="material-symbols-outlined text-[17px]">add_call</span>
              Registrar seguimiento
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="text-[10px] font-mono uppercase text-slate-400">Contacto
                <input required value={callerName} onChange={(event) => setCallerName(event.target.value)} className="mt-1 w-full rounded-lg border border-cyan-500/25 bg-[#070c18] p-2.5 text-xs normal-case text-white outline-none focus:border-cyan-400" />
              </label>
              <label className="text-[10px] font-mono uppercase text-slate-400">Teléfono
                <input required value={callerPhone} onChange={(event) => setCallerPhone(event.target.value)} className="mt-1 w-full rounded-lg border border-cyan-500/25 bg-[#070c18] p-2.5 text-xs normal-case text-white outline-none focus:border-cyan-400" />
              </label>
              <label className="text-[10px] font-mono uppercase text-slate-400">Atendió
                <input required value={attendedBy} onChange={(event) => setAttendedBy(event.target.value)} className="mt-1 w-full rounded-lg border border-cyan-500/25 bg-[#070c18] p-2.5 text-xs normal-case text-white outline-none focus:border-cyan-400" />
              </label>
            </div>
            <label className="block text-[10px] font-mono uppercase text-slate-400">Resumen, acuerdos y próxima acción
              <textarea required rows={4} value={conversationSummary} onChange={(event) => setConversationSummary(event.target.value)} placeholder="Ej. El cliente llamó por seguimiento. Se acordó confirmar diagnóstico mañana antes de las 3:00 PM." className="mt-1 w-full resize-y rounded-lg border border-cyan-500/25 bg-[#070c18] p-3 text-xs normal-case leading-relaxed text-white outline-none focus:border-cyan-400" />
            </label>
            {error && <p className="rounded-lg border border-red-500/30 bg-red-950/25 p-2 text-xs text-red-300">{error}</p>}
            <div className="flex justify-end">
              <button type="submit" disabled={isSaving} className="flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2 text-xs font-black text-slate-950 hover:bg-cyan-300 disabled:cursor-wait disabled:opacity-60">
                <span className="material-symbols-outlined text-[17px]">save</span>
                {isSaving ? 'Guardando...' : 'Guardar conversación'}
              </button>
            </div>
          </form>

          <section>
            <h3 className="mb-3 font-mono text-xs font-bold uppercase text-slate-300">Historial de conversaciones ({calls.length})</h3>
            {calls.length === 0 ? (
              <div className="rounded-xl border border-cyan-500/20 bg-[#040814] p-6 text-center font-mono text-xs text-slate-400">Aún no hay conversaciones posteriores a la apertura del reclamo.</div>
            ) : (
              <div className="space-y-3">
                {calls.map((call, index) => (
                  <article key={call.id} className="rounded-xl border border-cyan-500/20 bg-[#040814] p-4 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded border border-cyan-500/30 bg-cyan-950/50 px-2 py-0.5 font-mono font-bold text-cyan-300">Seguimiento #{call.callNumber || calls.length - index}</span>
                        <strong className="text-white">{call.callerName}</strong>
                        <span className="font-mono text-slate-400">{call.callerPhone}</span>
                      </div>
                      <time className="font-mono text-[10px] text-slate-400">{new Date(call.createdAt).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}</time>
                    </div>
                    <p className="mt-3 border-l-2 border-cyan-400 pl-3 leading-relaxed text-slate-200">{call.conversationSummary}</p>
                    <p className="mt-2 text-[10px] text-slate-400">Atendido por <strong className="text-emerald-400">{call.attendedBy}</strong></p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};