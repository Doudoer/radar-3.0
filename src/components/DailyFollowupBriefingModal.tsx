import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { PendingFollowupItem } from '../types';
import { RegisterFollowupCallModal } from './RegisterFollowupCallModal';

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

  if (!isOpen) return null;

  const isSuperAdmin = userRole === 'admin';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 bg-slate-950/85 backdrop-blur-md animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-[#070d1e] border-2 border-cyan-500/50 rounded-2xl shadow-[0_0_50px_rgba(6,182,212,0.35)] overflow-hidden">
        {/* Glowing top line */}
        <div className="h-1.5 w-full bg-gradient-to-r from-rose-500 via-amber-400 to-cyan-400 shadow-[0_0_15px_#22d3ee]" />

        {/* Modal Header */}
        <div className="px-4 py-3.5 sm:px-6 sm:py-4 bg-[#0a142c] border-b border-cyan-500/25 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500/30 to-amber-500/30 border border-amber-400/50 flex items-center justify-center text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.3)] shrink-0">
              <span className="material-symbols-outlined text-[24px] animate-pulse">phone_in_talk</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-white tracking-wide uppercase font-mono">
                  Seguimiento Post-Entrega Obligatorio
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">
                  ALERTA DE SESIÓN
                </span>
              </div>
              <p className="text-xs text-slate-300 font-mono mt-0.5">
                Garantía Temprana (14 Días) • Atención por llamada o mensaje de texto (WhatsApp/SMS) asignada al asesor de venta
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800/60 transition-colors"
            title="Cerrar (Permanecerá accesible en barra superior)"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Operational Filter & KPI Bar */}
        <div className="px-4 py-3 sm:px-6 bg-[#040816] border-b border-cyan-500/20 flex flex-wrap items-center justify-between gap-3 shrink-0">
          {/* Quick Metrics */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs font-mono font-bold shadow-[0_0_10px_rgba(244,63,94,0.2)]">
              <span className="material-symbols-outlined text-[16px] text-rose-400">error</span>
              <span>Atrasadas:</span>
              <strong className="text-white text-sm font-black">{overdueCount}</strong>
            </div>

            <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-300 text-xs font-mono font-bold">
              <span className="material-symbols-outlined text-[16px] text-amber-400">schedule</span>
              <span>Llamar Hoy:</span>
              <strong className="text-white text-sm font-black">{todayCount}</strong>
            </div>

            <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-cyan-300 text-xs font-mono font-bold">
              <span className="material-symbols-outlined text-[16px] text-cyan-400">event</span>
              <span>Próximas:</span>
              <strong className="text-white text-sm font-black">{upcomingCount}</strong>
            </div>
          </div>

          {/* Advisor Selector / Filter */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-mono text-slate-400 flex items-center gap-1">
              <span className="material-symbols-outlined text-[15px] text-cyan-400">person</span>
              <span>Asesor:</span>
            </label>
            <select
              value={advisorFilter}
              onChange={(e) => setAdvisorFilter(e.target.value)}
              className="bg-[#0b162c] border border-cyan-500/40 text-cyan-200 text-xs font-mono rounded-lg px-2.5 py-1 focus:outline-none focus:border-cyan-400 cursor-pointer"
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
        </div>

        {/* Scrollable List of Pending Followups */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 custom-scrollbar">
          {filteredItems.length === 0 ? (
            <div className="p-8 text-center bg-cyan-950/20 border border-cyan-500/30 rounded-xl">
              <span className="material-symbols-outlined text-[48px] text-emerald-400 mb-2">verified</span>
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
                  className={`p-3.5 sm:p-4 rounded-xl border transition-all duration-200 ${
                    isOverdue
                      ? 'bg-rose-950/25 border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.15)] hover:border-rose-400'
                      : isToday
                      ? 'bg-amber-950/25 border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.15)] hover:border-amber-400'
                      : 'bg-[#081226]/80 border-cyan-500/30 hover:border-cyan-400'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    {/* Left details */}
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm font-mono font-black text-white">{item.orderCode}</strong>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider uppercase ${
                            isOverdue
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/50'
                              : isToday
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                              : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                          }`}
                        >
                          {isOverdue ? '🚨 ATRASADA' : isToday ? '🟡 LLAMAR HOY' : '⏳ PRÓXIMA'}
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
                          <span className="material-symbols-outlined text-[15px] text-cyan-400">person</span>
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
                          <span className="material-symbols-outlined text-[15px] text-amber-400">directions_car</span>
                          <span>{item.vehicle}</span>
                          <span className="text-cyan-400 font-bold">({item.mainPart})</span>
                        </div>
                      </div>

                      {/* Phone, WhatsApp & Click-to-call */}
                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        <a
                          href={`tel:${item.customerPhone.replace(/\D/g, '')}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-mono font-black transition-all cursor-pointer shadow-[0_0_10px_rgba(16,185,129,0.2)] active:scale-95"
                          title="Llamar directamente desde teléfono o softphone"
                        >
                          <span className="material-symbols-outlined text-[15px]">call</span>
                          <span>{item.customerPhone || 'Sin teléfono'}</span>
                        </a>

                        {item.customerPhone && (
                          <a
                            href={`https://wa.me/${item.customerPhone.replace(/\D/g, '').length === 10 ? '1' + item.customerPhone.replace(/\D/g, '') : item.customerPhone.replace(/\D/g, '').startsWith('0') ? '58' + item.customerPhone.replace(/\D/g, '').slice(1) : item.customerPhone.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 text-xs font-mono font-bold transition-all cursor-pointer"
                            title="Abrir chat de WhatsApp"
                          >
                            <span className="material-symbols-outlined text-[14px]">chat</span>
                            <span>WhatsApp</span>
                          </a>
                        )}

                        {item.customerPhone && (
                          <button
                            type="button"
                            onClick={() => handleCopyPhone(item.customerPhone, item.orderId)}
                            className="p-1 rounded bg-[#0b162c] hover:bg-cyan-500/20 border border-cyan-500/30 text-slate-300 hover:text-white transition-colors cursor-pointer"
                            title="Copiar número"
                          >
                            <span className="material-symbols-outlined text-[14px]">
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
                    <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0 pt-2 sm:pt-0">
                      <button
                        type="button"
                        onClick={() => handleOpenCallModal(item)}
                        className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 text-xs font-mono font-black shadow-[0_0_12px_rgba(6,182,212,0.35)] transition-all cursor-pointer active:scale-95"
                      >
                        <span className="material-symbols-outlined text-[16px]">phone_callback</span>
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
                        <span className="material-symbols-outlined text-[14px]">visibility</span>
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
        <div className="px-4 py-3 sm:px-6 bg-[#040816] border-t border-cyan-500/20 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400 text-center sm:text-left">
            <span className="material-symbols-outlined text-[18px] text-amber-400 shrink-0">info</span>
            <span>
              <strong>Regla Operativa:</strong> El seguimiento post-entrega debe realizarse de forma directa (llamada o mensaje WhatsApp/SMS) por el asesor que realizó la venta.
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-1.5 rounded-xl bg-[#0b162c] hover:bg-[#12244a] border border-cyan-500/40 text-slate-200 hover:text-white text-xs font-mono font-bold transition-all cursor-pointer shrink-0"
          >
            Continuar a RADAR
          </button>
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
