import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../services/apiFetch';
import { useDialogAccessibility } from '../hooks/useDialogAccessibility';

export interface CustomerDuplicateMember {
  id: number;
  firstName: string;
  lastName?: string;
  name: string;
  phone: string;
  whatsapp?: string;
  email?: string;
  addressShipping?: string;
  zipCode?: string;
  company?: string;
  type: string;
  createdAt: string;
  orderCount: number;
  callCount: number;
}

export interface CustomerDuplicateGroup {
  clusterId: string;
  matchType: 'phone' | 'email' | 'name';
  matchValue: string;
  customers: CustomerDuplicateMember[];
}

export interface CustomerDuplicatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMerged: () => void;
}

export const CustomerDuplicatesModal: React.FC<CustomerDuplicatesModalProps> = ({
  isOpen,
  onClose,
  onMerged,
}) => {
  const [groups, setGroups] = useState<CustomerDuplicateGroup[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState(false);
  const [selectedPrimaryId, setSelectedPrimaryId] = useState<number | null>(null);
  const [copyMissing, setCopyMissing] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchDuplicates = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/customers/duplicates');
      if (!res.ok) throw new Error('No se pudieron consultar los clientes duplicados');
      const data: CustomerDuplicateGroup[] = await res.json();
      setGroups(data);
      setCurrentIndex(0);
      if (data.length > 0 && data[0].customers.length > 0) {
        setSelectedPrimaryId(data[0].customers[0].id);
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error al cargar duplicados',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void fetchDuplicates();
    }
  }, [isOpen, fetchDuplicates]);

  const currentGroup = groups[currentIndex];

  useEffect(() => {
    if (currentGroup && currentGroup.customers.length > 0) {
      setSelectedPrimaryId(currentGroup.customers[0].id);
    }
  }, [currentIndex, currentGroup]);

  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogAccessibility({ open: isOpen, dialogRef, onEscape: onClose });

  if (!isOpen) return null;

  const handleMerge = async () => {
    if (!currentGroup || !selectedPrimaryId || merging) return;

    const duplicateIds = currentGroup.customers
      .map((c) => c.id)
      .filter((id) => id !== selectedPrimaryId);

    if (duplicateIds.length === 0) return;

    setMerging(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/customers/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryId: selectedPrimaryId,
          duplicateIds,
          copyMissingFields: copyMissing,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error al fusionar clientes');

      setFeedback({
        type: 'success',
        text: data.message || `Fusión completada con éxito (#${selectedPrimaryId})`,
      });

      onMerged();

      // Remove the merged group from the list
      const updatedGroups = groups.filter((_, idx) => idx !== currentIndex);
      setGroups(updatedGroups);

      if (updatedGroups.length === 0) {
        // All done!
        setTimeout(() => {
          onClose();
        }, 1500);
      } else if (currentIndex >= updatedGroups.length) {
        setCurrentIndex(Math.max(0, updatedGroups.length - 1));
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error durante la fusión',
      });
    } finally {
      setMerging(false);
    }
  };

  const handleNext = () => {
    if (currentIndex < groups.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setFeedback(null);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
      setFeedback(null);
    }
  };

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="horizon-modal fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in outline-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="merge-modal-title"
    >
      <div className="relative w-full max-w-4xl max-h-[92vh] rounded-3xl bg-[#070c18]/95 backdrop-blur-2xl border border-cyan-500/30 p-6 md:p-8 shadow-[0_20px_60px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col justify-between space-y-5 text-slate-200">
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#22d3ee]" />

        {/* Header Bar */}
        <div className="flex items-start justify-between gap-4 border-b border-cyan-500/15 pb-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.25)] shrink-0">
              <span aria-hidden="true" className="material-symbols-outlined text-[26px]">merge_type</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] tracking-widest font-mono font-bold text-cyan-400 uppercase">
                  Auditoría CRM & Integridad
                </span>
                {groups.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                    Sugerencia {currentIndex + 1} de {groups.length}
                  </span>
                )}
              </div>
              <h2 id="merge-modal-title" className="text-lg md:text-xl font-black text-white">
                Fusión de Contactos y Clientes Duplicados
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors"
            title="Cerrar modal"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="p-12 text-center space-y-3 font-mono">
            <span aria-hidden="true" className="material-symbols-outlined text-4xl text-cyan-400 animate-spin">
              progress_activity
            </span>
            <p className="text-xs text-slate-400">Analizando base de datos para detectar clientes duplicados…</p>
          </div>
        )}

        {/* Empty / All Resolved State */}
        {!loading && groups.length === 0 && (
          <div className="p-10 text-center space-y-3 font-mono">
            <div className="w-16 h-16 mx-auto rounded-3xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.3)]">
              <span aria-hidden="true" className="material-symbols-outlined text-3xl">verified</span>
            </div>
            <h3 className="text-base font-bold text-white">¡Base de datos limpia y sin duplicados!</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
              No se encontraron clientes con teléfonos, correos o nombres duplicados. Todos los registros son únicos.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={onClose}
                className="cyber-btn-secondary px-5 py-2 text-xs font-bold"
              >
                Cerrar Asistente
              </button>
            </div>
          </div>
        )}

        {/* Main Duplicate Comparison Content */}
        {!loading && currentGroup && (
          <div className="space-y-4 overflow-y-auto max-h-[62vh] pr-1">
            {/* Match Reason Banner */}
            <div className="p-3 rounded-2xl bg-cyan-950/40 border border-cyan-500/30 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
              <div className="flex items-center gap-2 text-cyan-300">
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                  {currentGroup.matchType === 'phone'
                    ? 'call'
                    : currentGroup.matchType === 'email'
                    ? 'mail'
                    : 'person'}
                </span>
                <span>
                  Coincidencia detectada por{' '}
                  <strong className="text-white uppercase font-bold">
                    {currentGroup.matchType === 'phone'
                      ? 'Teléfono'
                      : currentGroup.matchType === 'email'
                      ? 'Correo Electrónico'
                      : 'Nombre Completo'}
                  </strong>
                  : <code className="text-cyan-200 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-500/40">{currentGroup.matchValue}</code>
                </span>
              </div>
              <span className="text-[11px] text-slate-400">
                Selecciona cuál registro conservar como <strong>Principal</strong>
              </span>
            </div>

            {feedback && (
              <div
                className={`p-3 rounded-2xl text-xs font-mono flex items-center gap-2 ${
                  feedback.type === 'success'
                    ? 'bg-emerald-500/10 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                    : 'bg-[var(--state-urgency-tint)] border border-[var(--state-urgency-border)] text-[var(--state-urgency-text)]'
                }`}
              >
                <span aria-hidden="true" className="material-symbols-outlined text-base">
                  {feedback.type === 'success' ? 'check_circle' : 'error'}
                </span>
                <span>{feedback.text}</span>
              </div>
            )}

            {/* Side-by-Side Customer Comparison Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {currentGroup.customers.map((c) => {
                const isSelected = selectedPrimaryId === c.id;

                return (
                  <div
                    key={c.id}
                    onClick={() => setSelectedPrimaryId(c.id)}
                    className={`relative rounded-3xl p-5 border transition-all cursor-pointer flex flex-col justify-between gap-4 ${
                      isSelected
                        ? 'bg-[#091326] border-cyan-400 shadow-[0_0_25px_rgba(6,182,212,0.3)] ring-1 ring-cyan-400/50'
                        : 'bg-[#040814]/90 border-slate-800 hover:border-slate-700 opacity-80 hover:opacity-100'
                    }`}
                  >
                    <div className="space-y-3">
                      {/* Top Header inside Card */}
                      <div className="flex items-center justify-between gap-2 border-b border-cyan-500/10 pb-2.5">
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`primary-${currentGroup.clusterId}`}
                            checked={isSelected}
                            onChange={() => setSelectedPrimaryId(c.id)}
                            className="w-4 h-4 text-cyan-500 focus:ring-cyan-400 bg-slate-900 border-slate-700 cursor-pointer"
                          />
                          <span
                            className={`text-xs font-mono font-black ${
                              isSelected ? 'text-cyan-300' : 'text-slate-400'
                            }`}
                          >
                            Cliente #{c.id}
                          </span>
                        </div>

                        {isSelected ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[var(--brand-soft)] text-[var(--brand)] border border-[var(--brand)]/40 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--brand)]" />
                            Registro Principal
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[var(--bg-card-subtle)] text-[var(--text-secondary)] border border-[var(--border-color)] flex items-center gap-1">
                            <span aria-hidden="true" className="material-symbols-outlined text-[12px]">archive</span>
                            Se archivará
                          </span>
                        )}
                      </div>

                      {/* Customer Name & Orders Badge */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="text-base font-bold text-white tracking-tight">
                            {c.name || 'Sin Nombre'}
                          </h4>
                          {c.company && (
                            <p className="text-xs text-cyan-300 font-mono mt-0.5 flex items-center gap-1">
                              <span aria-hidden="true" className="material-symbols-outlined text-[13px]">apartment</span>
                              <span>{c.company}</span>
                            </p>
                          )}
                        </div>

                        <div className="flex flex-col items-end gap-1">
                          <span className="px-2.5 py-1 rounded-xl text-xs font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                            <span aria-hidden="true" className="material-symbols-outlined text-[14px]">receipt_long</span>
                            <span>{c.orderCount} Órdenes</span>
                          </span>
                          {c.callCount > 0 && (
                            <span className="text-[10px] font-mono text-slate-400">
                              {c.callCount} llamadas
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Detailed Fields List */}
                      <div className="space-y-1.5 text-xs font-mono pt-1">
                        <div className="flex justify-between py-1 border-b border-slate-800/60">
                          <span className="text-slate-400">Teléfono:</span>
                          <span className="text-slate-200 font-bold">{c.phone || '—'}</span>
                        </div>
                        <div className="flex justify-between py-1 border-b border-slate-800/60">
                          <span className="text-slate-400">Teléfono alternativo:</span>
                          <span className="text-slate-200">{c.whatsapp || '—'}</span>
                        </div>
                        <div className="flex justify-between py-1 border-b border-slate-800/60">
                          <span className="text-slate-400">Correo:</span>
                          <span className="text-slate-200 truncate max-w-[200px]" title={c.email || ''}>
                            {c.email || '—'}
                          </span>
                        </div>
                        <div className="flex justify-between py-1 border-b border-slate-800/60">
                          <span className="text-slate-400">Dirección:</span>
                          <span className="text-slate-200 truncate max-w-[200px]" title={c.addressShipping || ''}>
                            {c.addressShipping || '—'}
                          </span>
                        </div>
                        <div className="flex justify-between py-1 border-b border-slate-800/60">
                          <span className="text-slate-400">Código Postal:</span>
                          <span className="text-slate-200">{c.zipCode || '—'}</span>
                        </div>
                        <div className="flex justify-between py-1">
                          <span className="text-slate-400">Fecha de alta:</span>
                          <span className="text-slate-400">
                            {c.createdAt ? new Date(c.createdAt).toLocaleDateString('es-ES') : '—'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPrimaryId(c.id);
                        }}
                        className={`w-full py-2 rounded-xl text-xs font-bold font-mono transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                          isSelected
                            ? 'bg-cyan-500 text-slate-950 font-black shadow-[0_0_12px_rgba(6,182,212,0.4)]'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                        }`}
                      >
                        <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
                          {isSelected ? 'check_circle' : 'radio_button_unchecked'}
                        </span>
                        <span>{isSelected ? 'Seleccionado como Principal' : 'Hacer Principal'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Merge Options */}
            <div className="p-3 rounded-2xl bg-[#040814] border border-cyan-500/20 flex items-center gap-2.5">
              <input
                id="copy-missing-checkbox"
                type="checkbox"
                checked={copyMissing}
                onChange={(e) => setCopyMissing(e.target.checked)}
                className="w-4 h-4 rounded text-cyan-500 focus:ring-cyan-400 bg-slate-900 border-slate-700 cursor-pointer"
              />
              <label
                htmlFor="copy-missing-checkbox"
                className="text-xs text-slate-300 font-mono cursor-pointer select-none"
              >
                Copiar automáticamente al registro principal los datos que le falten (ej. dirección, email o notas de los duplicados).
              </label>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        {!loading && currentGroup && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-cyan-500/15">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrev}
                disabled={currentIndex === 0 || merging}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                ◀ Anterior
              </button>
              <button
                type="button"
                onClick={handleNext}
                disabled={currentIndex >= groups.length - 1 || merging}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                Siguiente ▶
              </button>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={merging}
                className="px-4 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors cursor-pointer"
              >
                Cerrar
              </button>
              <button
                type="button"
                disabled={merging || !selectedPrimaryId}
                onClick={() => void handleMerge()}
                className="cyber-btn-primary px-5 py-2.5 text-xs font-black flex items-center gap-2 disabled:opacity-50 cursor-pointer shadow-[0_0_15px_rgba(6,182,212,0.4)]"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                  {merging ? 'sync' : 'merge_type'}
                </span>
                <span>{merging ? 'Fusionando Clientes...' : 'Fusionar Clientes'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
