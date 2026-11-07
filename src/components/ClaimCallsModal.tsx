import React, { useEffect, useState } from 'react';
import { Claim, ClaimCall } from '../types';
import { apiFetch } from '../services/apiFetch';

interface ClaimCallsModalProps {
  claim: Claim;
  isOpen: boolean;
  onClose: () => void;
  onCallAdded: (call: ClaimCall) => void;
}

const CALL_QUICK_NOTES = [
  'Se contactó al cliente; enviará fotos o video de la falla por WhatsApp.',
  'Cliente informa que el mecánico está revisando la pieza en el taller.',
  'Se explicó diagnóstico técnico y pasos de garantía al cliente.',
  'Llamada sin respuesta; se dejó mensaje de voz y WhatsApp de seguimiento.',
  'Se acordó con el cliente la solución del reclamo y fecha de seguimiento.',
];

export const ClaimCallsModal: React.FC<ClaimCallsModalProps> = ({ claim, isOpen, onClose, onCallAdded }) => {
  const [calls, setCalls] = useState<ClaimCall[]>(claim.calls || []);
  const [callerName, setCallerName] = useState(claim.customerName);
  const [callerPhone, setCallerPhone] = useState(claim.customerPhone);
  const [attendedBy, setAttendedBy] = useState(claim.advisor || 'Sin asignar');
  const [conversationSummary, setConversationSummary] = useState('');
  const [showContactFields, setShowContactFields] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setCalls(claim.calls || []);
    setCallerName(claim.customerName);
    setCallerPhone(claim.customerPhone);
    setAttendedBy(claim.advisor || 'Sin asignar');
    setConversationSummary('');
    setShowContactFields(false);
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

      const created = (await response.json()) as ClaimCall;
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
    <div
      className="horizon-modal fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Bitácora de llamadas"
    >
      <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] shadow-2xl">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border-color)] bg-[var(--bg-card-subtle)] p-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/35 text-cyan-400 flex items-center justify-center">
                <span className="material-symbols-outlined text-[18px]">phone_in_talk</span>
              </span>
              <h2 className="text-base font-bold text-[var(--text-primary)]">Bitácora de llamadas</h2>
              <span className="rounded-lg border border-cyan-500/30 bg-cyan-500/15 px-2.5 py-0.5 font-mono text-xs font-bold text-cyan-400">
                {claim.id}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {claim.orderCode} · {claim.customerName} · {claim.customerPhone}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] cursor-pointer"
            aria-label="Cerrar bitácora"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 custom-scrollbar">
          {calls.length >= 3 && (
            <div className="flex gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-400">
              <span className="material-symbols-outlined text-rose-400">warning</span>
              <div>
                <strong className="block text-[var(--text-primary)]">
                  Seguimiento prioritario: {calls.length} conversaciones
                </strong>
                Este reclamo continúa abierto y requiere una próxima acción concreta.
              </div>
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            className="space-y-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-xs font-bold text-cyan-400">
                <span className="material-symbols-outlined text-[17px]">add_call</span>
                <span>Registrar seguimiento</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowContactFields((prev) => !prev)}
                className="text-[11px] font-semibold text-[var(--text-secondary)] hover:text-cyan-400 cursor-pointer"
              >
                {showContactFields ? 'Ocultar datos de contacto' : `Contacto: ${callerName} (${callerPhone}) · Editar`}
              </button>
            </div>

            {showContactFields && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 pt-1">
                <label className="text-[11px] font-semibold text-[var(--text-secondary)]">
                  Contacto
                  <input
                    required
                    value={callerName}
                    onChange={(event) => setCallerName(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-xs text-[var(--text-primary)] outline-none focus:border-cyan-400"
                  />
                </label>
                <label className="text-[11px] font-semibold text-[var(--text-secondary)]">
                  Teléfono
                  <input
                    required
                    value={callerPhone}
                    onChange={(event) => setCallerPhone(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-xs text-[var(--text-primary)] outline-none focus:border-cyan-400"
                  />
                </label>
                <label className="text-[11px] font-semibold text-[var(--text-secondary)]">
                  Atendió
                  <input
                    required
                    value={attendedBy}
                    onChange={(event) => setAttendedBy(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-xs text-[var(--text-primary)] outline-none focus:border-cyan-400"
                  />
                </label>
              </div>
            )}

            {/* Quick Note Chips */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold text-[var(--text-secondary)] block">
                Notas rápidas (1 clic):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {CALL_QUICK_NOTES.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() =>
                      setConversationSummary((prev) =>
                        prev.trim() ? `${prev.trim()} ${chip}` : chip
                      )
                    }
                    className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:border-cyan-400/50 hover:text-[var(--text-primary)] cursor-pointer transition-colors text-left"
                  >
                    + {chip}
                  </button>
                ))}
              </div>
            </div>

            <label className="block text-xs font-semibold text-[var(--text-secondary)]">
              Resumen, acuerdos y próxima acción
              <textarea
                required
                rows={3}
                value={conversationSummary}
                onChange={(event) => setConversationSummary(event.target.value)}
                placeholder="Ej. El cliente llamó por seguimiento. Se acordó confirmar diagnóstico mañana antes de las 3:00 PM."
                className="mt-1 w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] p-3 text-xs leading-relaxed text-[var(--text-primary)] outline-none focus:border-cyan-400"
              />
            </label>
            {error && (
              <p className="rounded-lg border border-rose-500/35 bg-rose-500/10 p-2 text-xs font-semibold text-rose-400">
                {error}
              </p>
            )}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isSaving}
                className="horizon-primary flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold cursor-pointer disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[17px]">save</span>
                {isSaving ? 'Guardando...' : 'Guardar conversación'}
              </button>
            </div>
          </form>

          <section>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
              Historial de conversaciones ({calls.length})
            </h3>
            {calls.length === 0 ? (
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] p-6 text-center text-xs text-[var(--text-secondary)]">
                Aún no hay conversaciones posteriores a la apertura del reclamo.
              </div>
            ) : (
              <div className="space-y-2.5">
                {calls.map((call, index) => (
                  <article
                    key={call.id}
                    className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] p-3.5 text-xs space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md border border-cyan-500/30 bg-cyan-500/15 px-2 py-0.5 font-mono font-bold text-cyan-400">
                          Llamada #{call.callNumber || calls.length - index}
                        </span>
                        <strong className="text-[var(--text-primary)]">{call.callerName}</strong>
                        <span className="font-mono text-[var(--text-secondary)]">{call.callerPhone}</span>
                      </div>
                      <time className="text-[11px] text-[var(--text-secondary)] tabular-nums">
                        {new Date(call.createdAt).toLocaleString('es-ES', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </time>
                    </div>
                    <p className="border-l-2 border-cyan-400 pl-3 leading-relaxed text-[var(--text-primary)]">
                      {call.conversationSummary}
                    </p>
                    <p className="text-[11px] text-[var(--text-secondary)]">
                      Atendido por <strong className="text-emerald-500">{call.attendedBy}</strong>
                    </p>
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
