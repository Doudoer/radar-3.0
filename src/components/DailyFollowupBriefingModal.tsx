import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { PendingFollowupItem } from '../types';
import { RegisterFollowupCallModal } from './RegisterFollowupCallModal';
import { useDialogAccessibility } from '../hooks/useDialogAccessibility';

interface DailyFollowupBriefingModalProps {
  isOpen: boolean;
  onClose: () => void;
  pendingItems: PendingFollowupItem[];
  onSelectOrder: (orderId: string) => void;
  onRefreshPending: () => Promise<void>;
  currentUserName?: string;
  userRole?: string;
}

export const DailyFollowupBriefingModal: React.FC<DailyFollowupBriefingModalProps> = ({
  isOpen,
  onClose,
  pendingItems,
  onSelectOrder,
  onRefreshPending,
  currentUserName,
  userRole,
}) => {
  const [selectedItemForCall, setSelectedItemForCall] = useState<PendingFollowupItem | null>(null);
  const [advisorFilter, setAdvisorFilter] = useState<string>('all');
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefreshPending();
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  // Auto-refresh pending list when an update event is received from any operator
  useEffect(() => {
    if (!isOpen) return;
    const handleUpdate = () => {
      void onRefreshPending();
    };
    window.addEventListener('radar:followup-updated', handleUpdate);
    return () => {
      window.removeEventListener('radar:followup-updated', handleUpdate);
    };
  }, [isOpen, onRefreshPending]);

  // Periodic fallback refresh every 8 seconds while modal is open
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      void onRefreshPending();
    }, 8_000);
    return () => clearInterval(interval);
  }, [isOpen, onRefreshPending]);

  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogAccessibility({
    open: isOpen && !selectedItemForCall,
    dialogRef,
    onEscape: onClose,
  });

  if (!isOpen) return null;

  // Get unique advisors from items for filter
  const advisorList = Array.from(new Set(pendingItems.map((i) => i.advisor).filter(Boolean)));

  // Filter items
  const filteredItems = pendingItems.filter((item) => {
    if (advisorFilter === 'all') return true;
    if (advisorFilter === 'mine' && currentUserName) {
      return item.advisor.trim().toLowerCase() === currentUserName.trim().toLowerCase();
    }
    return item.advisor.trim().toLowerCase() === advisorFilter.trim().toLowerCase();
  });

  const overdueCount = filteredItems.filter((i) => i.urgency === 'atrasada').length;
  const todayCount = filteredItems.filter((i) => i.urgency === 'hoy').length;
  const upcomingCount = filteredItems.filter((i) => i.urgency === 'proxima').length;

  const handleCopyPhone = (phone: string, id: string) => {
    if (navigator?.clipboard?.writeText) {
      void navigator.clipboard.writeText(phone);
      setCopiedPhone(id);
      setTimeout(() => setCopiedPhone(null), 2000);
    }
  };

  const handleOpenCallModal = (item: PendingFollowupItem) => {
    setSelectedItemForCall(item);
  };

  const modalContent = (
    <div className="horizon-modal horizon-followup-portal horizon-followup-briefing fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="daily-followup-title" aria-describedby="daily-followup-description" className="horizon-followup-panel relative w-full max-w-5xl max-h-[92dvh] flex flex-col rounded-3xl overflow-hidden outline-none">
        {/* Modal Header */}
        <div className="horizon-followup-header px-4 py-4 sm:px-6 sm:py-5 flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div className="horizon-followup-icon w-11 h-11 rounded-2xl flex items-center justify-center shrink-0">
              <span aria-hidden="true" className="material-symbols-outlined text-[24px]">phone_in_talk</span>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="daily-followup-title" className="text-base sm:text-xl font-bold">
                  Seguimiento Post-Entrega Obligatorio
                </h2>
                <span className="horizon-followup-required px-2.5 py-1 rounded-full text-[10px] font-bold">
                  Atención requerida
                </span>
              </div>
              <p id="daily-followup-description" className="text-xs text-slate-400 mt-1 leading-relaxed">
                Garantía Temprana (14 Días) • Atención por llamada o mensaje de texto (SMS) asignada al asesor de venta
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800/60 transition-colors cursor-pointer"
              title="Cerrar (Permanecerá accesible en barra superior)"
              aria-label="Cerrar seguimiento post-entrega"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        {/* Operational Filter & KPI Bar */}
        <div className="horizon-followup-toolbar px-4 py-4 sm:px-6 flex flex-wrap items-center justify-between gap-4 shrink-0">
          {/* Quick Metrics */}
          <div className="horizon-followup-metrics grid grid-cols-3 gap-2 w-full sm:w-auto">
            <div className="horizon-followup-metric flex items-center gap-1.5 px-3 py-2.5 rounded-2xl text-xs" data-urgency="atrasada">
              <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-rose-400">error</span>
              <span>Atrasadas:</span>
              <strong className="text-lg font-bold">{overdueCount}</strong>
            </div>

            <div className="horizon-followup-metric flex items-center gap-1.5 px-3 py-2.5 rounded-2xl text-xs" data-urgency="hoy">
              <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-amber-400">schedule</span>
              <span>Hoy:</span>
              <strong className="text-lg font-bold">{todayCount}</strong>
            </div>

            <div className="horizon-followup-metric flex items-center gap-1.5 px-3 py-2.5 rounded-2xl text-xs" data-urgency="proxima">
              <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-cyan-400">event</span>
              <span>Próximas:</span>
              <strong className="text-lg font-bold">{upcomingCount}</strong>
            </div>
          </div>

          {/* Controls: Advisor Selector / Filter + Primary Refresh Button */}
          <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <label htmlFor="followup-advisor" className="text-xs text-slate-400 flex items-center gap-1">
                <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-cyan-400">person</span>
                <span className="hidden sm:inline">Asesor:</span>
              </label>
              <select
                id="followup-advisor"
                value={advisorFilter}
                onChange={(e) => setAdvisorFilter(e.target.value)}
                className="min-w-0 w-full sm:w-auto text-xs rounded-xl px-3 py-2.5 cursor-pointer"
              >
                <option value="all">Todas las Órdenes ({pendingItems.length})</option>
                {currentUserName && (
                  <option value="mine">Mis Órdenes ({pendingItems.filter((i) => i.advisor.trim().toLowerCase() === currentUserName.trim().toLowerCase()).length})</option>
                )}
                {advisorList.map((adv) => (
                  <option key={adv} value={adv}>
                    {adv} ({pendingItems.filter((i) => i.advisor === adv).length})
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="horizon-followup-secondary inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold disabled:opacity-50 cursor-pointer"
              title="Actualizar lista de órdenes de seguimiento ahora"
            >
              <span aria-hidden="true" className={`material-symbols-outlined text-[16px] ${isRefreshing ? 'animate-spin text-cyan-300' : 'text-cyan-400'}`}>
                refresh
              </span>
              <span>{isRefreshing ? 'Actualizando...' : 'Actualizar'}</span>
            </button>
          </div>
        </div>

        {/* Scrollable List of Pending Followups */}
        <div className="horizon-followup-list flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4 custom-scrollbar">
          {filteredItems.length === 0 ? (
            <div className="p-8 text-center bg-cyan-950/20 border border-cyan-500/30 rounded-xl">
              <span aria-hidden="true" className="material-symbols-outlined text-[48px] text-emerald-400 mb-2">verified</span>
              <h3 className="text-sm sm:text-base font-bold text-white font-mono">¡Excelente trabajo!</h3>
              <p className="text-xs text-slate-300 font-mono mt-1">
                No tienes llamadas de seguimiento pendientes ni atrasadas en este momento.
              </p>
            </div>
          ) : (
            filteredItems.map((item) => {
              const isOverdue = item.urgency === 'atrasada';
              const isToday = item.urgency === 'hoy';

              return (
                <div
                  key={item.orderId}
                  className="horizon-followup-item p-4 sm:p-5 rounded-2xl"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    {/* Left details */}
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm font-mono font-black text-white">{item.orderCode}</strong>
                        <span
                          className="horizon-followup-badge px-2.5 py-1 rounded-full text-[10px] font-semibold"
                          data-urgency={item.urgency}
                        >
                          {isOverdue ? 'ATRASADA' : isToday ? 'LLAMAR HOY' : 'PRÓXIMA'}
                        </span>
                        <span className="text-[11px] font-mono text-cyan-300 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-500/30">
                          Día {item.daysSinceDelivery} de 14
                        </span>
                        <span className="text-[11px] font-mono text-slate-300">
                          Asesor: <strong className="text-white">{item.advisor}</strong>
                        </span>
                      </div>

                      {/* Customer & Vehicle */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono">
                        <div className="flex items-center gap-1.5 text-slate-200">
                          <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-cyan-400">person</span>
                          <strong className="text-white">{item.customerName}</strong>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold border ${
                              item.customerLanguage === 'en'
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                                : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/35'
                            }`}
                            title={`El cliente prefiere comunicación en ${item.customerLanguage === 'en' ? 'Inglés' : 'Español'}`}
                          >
                            {item.customerLanguage === 'en' ? '🇺🇸 EN' : '🇪🇸 ES'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 text-slate-300">
                          <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-amber-400">directions_car</span>
                          <span>{item.vehicle}</span>
                          <span className="text-cyan-400 font-bold">({item.mainPart})</span>
                        </div>
                      </div>

                      {/* Phone & Click-to-call */}
                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        <a
                          href={`tel:${item.customerPhone.replace(/\D/g, '')}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-mono font-black transition-all cursor-pointer shadow-[0_0_10px_rgba(16,185,129,0.2)] active:scale-95"
                          title="Llamar directamente desde teléfono o softphone"
                        >
                          <span aria-hidden="true" className="material-symbols-outlined text-[15px]">call</span>
                          <span>{item.customerPhone || 'Sin teléfono'}</span>
                        </a>

                        {item.customerPhone && (
                          <button
                            type="button"
                            onClick={() => handleCopyPhone(item.customerPhone, item.orderId)}
                            className="p-1 rounded bg-[#0b162c] hover:bg-cyan-500/20 border border-cyan-500/30 text-slate-300 hover:text-white transition-colors cursor-pointer"
                            title="Copiar número"
                          >
                            <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
                              {copiedPhone === item.orderId ? 'check' : 'content_copy'}
                            </span>
                          </button>
                        )}

                        <span className="text-[11px] font-mono text-amber-300/90 ml-1">
                          {item.milestoneLabel}
                        </span>
                      </div>

                      {/* Previous contact summary if exists */}
                      {item.lastFollowup && (
                        <div className="mt-1 p-2 rounded-lg bg-[#040814] border border-cyan-500/15 text-[11px] font-mono text-slate-300">
                          <span className="text-cyan-400 font-bold">Último contacto:</span> {item.lastFollowup.notes}
                          {item.lastFollowup.promisedInstallDate && (
                            <span className="text-amber-300 ml-2 font-bold">
                              (Fecha prometida: {item.lastFollowup.promisedInstallDate})
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Right Action Buttons */}
                    <div className="horizon-followup-actions flex flex-wrap sm:flex-col items-center sm:items-end gap-2 shrink-0 pt-2 sm:pt-0">
                      <button
                        type="button"
                        onClick={() => handleOpenCallModal(item)}
                        className="horizon-followup-primary w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer"
                      >
                        <span aria-hidden="true" className="material-symbols-outlined text-[16px]">phone_callback</span>
                        <span>Registrar Llamada / SMS</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onSelectOrder(item.orderId);
                        }}
                        className="w-full sm:w-auto inline-flex items-center justify-center gap-1 px-3 py-1 rounded-xl bg-[#0b162c] hover:bg-[#102042] border border-cyan-500/40 text-cyan-300 text-xs font-mono font-bold transition-all cursor-pointer"
                      >
                        <span aria-hidden="true" className="material-symbols-outlined text-[14px]">visibility</span>
                        <span>Ver Orden</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer Instructions & Dismiss */}
        <div className="horizon-followup-footer px-4 py-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400 text-center sm:text-left">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-amber-400 shrink-0">info</span>
            <span>
              <strong>Regla Operativa:</strong> El seguimiento post-entrega debe realizarse de forma directa (llamada o mensaje SMS) por el asesor que realizó la venta.
            </span>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="horizon-followup-secondary w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer shrink-0"
            >
              Continuar a RADAR
            </button>
          </div>
        </div>
      </div>

      {/* Register Followup Call Dedicated Modal */}
      {selectedItemForCall && (
        <RegisterFollowupCallModal
          isOpen={Boolean(selectedItemForCall)}
          onClose={() => setSelectedItemForCall(null)}
          orderId={String(selectedItemForCall.orderId || '')}
          orderCode={String(selectedItemForCall.orderCode || '')}
          customerName={typeof selectedItemForCall.customerName === 'string' ? selectedItemForCall.customerName : String(selectedItemForCall.customerName || 'Cliente')}
          customerPhone={selectedItemForCall.customerPhone !== undefined && selectedItemForCall.customerPhone !== null ? String(selectedItemForCall.customerPhone) : ''}
          customerLanguage={selectedItemForCall.customerLanguage || 'es'}
          vehicle={typeof selectedItemForCall.vehicle === 'object' && selectedItemForCall.vehicle ? `${(selectedItemForCall.vehicle as any).year || ''} ${(selectedItemForCall.vehicle as any).make || ''} ${(selectedItemForCall.vehicle as any).model || ''}`.trim() : String(selectedItemForCall.vehicle || '')}
          mainPart={typeof selectedItemForCall.mainPart === 'object' && selectedItemForCall.mainPart ? (selectedItemForCall.mainPart as any).name || (selectedItemForCall.mainPart as any).description || 'Pieza' : String(selectedItemForCall.mainPart || '')}
          daysSinceDelivery={selectedItemForCall.daysSinceDelivery}
          assignedAdvisor={selectedItemForCall.advisor}
          currentOperatorName={currentUserName}
          initialPartStatus={selectedItemForCall.lastFollowup?.partStatus || 'not_installed'}
          initialWarrantyWarning={selectedItemForCall.lastFollowup?.warrantyWarningGiven || false}
          initialPromisedDate={selectedItemForCall.lastFollowup?.promisedInstallDate || ''}
          onSuccess={async () => {
            await onRefreshPending();
          }}
        />
      )}
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(modalContent, document.body);
  }

  return modalContent;
};
