import React from 'react';
import { Claim, Order } from '../types';

interface ClaimDetailViewProps {
  claim: Claim;
  order?: Order;
  onBack: () => void;
  onOpenCalls: () => void;
  onResolve: () => void;
}

export const ClaimDetailView: React.FC<ClaimDetailViewProps> = ({ claim, order, onBack, onOpenCalls, onResolve }) => {
  const orderTotal = order?.financials?.total ?? 0;
  const orderBalance = order?.financials?.balanceDue ?? Math.max(0, orderTotal - (order?.financials?.downPayment ?? 0));

  return (
    <div className="radar-view text-[#dfe2ef] pb-8 space-y-6">
      {/* Cyber Header Card */}
      <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-red-400 to-cyan-400 shadow-[0_0_12px_#ef4444]" />
        
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <button
              type="button"
              onClick={onBack}
              className="mt-1 rounded-xl p-2 bg-[#040814] border border-cyan-500/30 text-cyan-400 hover:text-white hover:bg-cyan-500/20 transition-all shadow-[0_0_10px_rgba(6,182,212,0.2)] cursor-pointer"
              title="Volver a reclamos"
            >
              <span className="material-symbols-outlined text-[22px]">arrow_back</span>
            </button>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">Detalle de Reclamo</h1>
                <span className="rounded-lg border border-cyan-500/40 bg-cyan-950/40 px-2.5 py-0.5 font-mono text-xs font-bold text-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.3)]">
                  {claim.id}
                </span>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold font-mono border ${
                  claim.status === 'Pending'
                    ? 'neon-badge-amber'
                    : claim.status === 'In Process'
                    ? 'neon-badge-cyan'
                    : claim.status === 'Resolved'
                    ? 'neon-badge-emerald'
                    : 'neon-badge-red'
                }`}>
                  {claim.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400 flex items-center gap-2">
                <span>Orden <strong className="font-mono text-cyan-300">{claim.orderCode}</strong></span>
                <span>•</span>
                <span>{claim.customerName}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5 pl-12 sm:pl-0">
            <button
              type="button"
              onClick={onOpenCalls}
              className="cyber-btn-secondary px-4 py-2.5 text-xs font-bold flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[17px]">phone_in_talk</span>
              <span>Ver Bitácora de Llamadas</span>
            </button>
            {claim.status !== 'Resolved' && (
              <button
                type="button"
                onClick={onResolve}
                className="bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 shadow-[0_0_20px_rgba(16,185,129,0.45)] cursor-pointer active:scale-95 transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">verified</span>
                <span>Marcar como Resuelto</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="flex flex-col gap-5">
          {/* Order Details Panel */}
          <section className="relative rounded-2xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#22d3ee]" />
            <h2 className="flex items-center gap-2 text-sm font-bold text-white uppercase tracking-wider font-mono">
              <span className="material-symbols-outlined text-cyan-400 text-[20px]">inventory_2</span>
              Detalles de la Orden
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-3 text-xs text-slate-300 sm:grid-cols-2">
              <div className="p-2.5 rounded-xl bg-[#040814] border border-cyan-500/15">
                <span className="text-slate-400 block text-[10px] font-mono uppercase">Código Orden:</span>
                <strong className="font-mono text-cyan-300 text-sm">{claim.orderCode}</strong>
              </div>
              <div className="p-2.5 rounded-xl bg-[#040814] border border-cyan-500/15">
                <span className="text-slate-400 block text-[10px] font-mono uppercase">Estatus anterior:</span>
                <strong className="text-emerald-400 text-xs font-mono">{claim.previousOrderStatus || 'N/A'}</strong>
              </div>
              <div className="p-2.5 rounded-xl bg-[#040814] border border-cyan-500/15">
                <span className="text-slate-400 block text-[10px] font-mono uppercase">Vehículo:</span>
                <strong className="text-white text-xs">{claim.vehicle}</strong>
              </div>
              <div className="p-2.5 rounded-xl bg-[#040814] border border-cyan-500/15">
                <span className="text-slate-400 block text-[10px] font-mono uppercase">VIN:</span>
                <strong className="font-mono text-slate-200 text-xs">{claim.vin || order?.vehicle?.vin || '-'}</strong>
              </div>
              <div className="p-2.5 rounded-xl bg-[#040814] border border-cyan-500/15">
                <span className="text-slate-400 block text-[10px] font-mono uppercase">Pieza / Repuesto:</span>
                <strong className="text-cyan-300 text-xs">{claim.mainPart}</strong>
              </div>
              <div className="p-2.5 rounded-xl bg-[#040814] border border-cyan-500/15">
                <span className="text-slate-400 block text-[10px] font-mono uppercase">Stock:</span>
                <strong className="font-mono text-emerald-400 text-xs">{claim.stockNumber || '-'}</strong>
              </div>
              <div className="p-2.5 rounded-xl bg-[#040814] border border-cyan-500/15">
                <span className="text-slate-400 block text-[10px] font-mono uppercase">Total Facturado:</span>
                <strong className="text-white font-mono text-xs">${orderTotal.toFixed(2)} USD</strong>
              </div>
              <div className="p-2.5 rounded-xl bg-[#040814] border border-cyan-500/15">
                <span className="text-slate-400 block text-[10px] font-mono uppercase">Balance Pendiente:</span>
                <strong className="text-red-400 font-mono text-xs">${orderBalance.toFixed(2)} USD</strong>
              </div>
            </div>
          </section>

          {/* Follow-up Section */}
          <section className="relative rounded-2xl bg-[#070c18]/90 backdrop-blur-2xl border border-red-500/25 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-red-400 to-transparent shadow-[0_0_8px_#ef4444]" />
            <h2 className="flex items-center gap-2 text-sm font-bold text-white uppercase tracking-wider font-mono">
              <span className="material-symbols-outlined text-red-400 text-[20px]">report_problem</span>
              Seguimiento del Reclamo & Diagnóstico
            </h2>
            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-950/20 p-3.5 text-xs text-red-200 shadow-[inset_0_0_15px_rgba(239,68,68,0.15)]">
              <span className="font-bold text-red-400 block uppercase font-mono text-[10px] mb-1">Motivo reportado por cliente:</span>
              <p className="leading-relaxed">{claim.claimReason}</p>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
              <div className="rounded-xl border border-cyan-500/20 bg-[#040814] p-3">
                <span className="block text-[10px] font-mono uppercase text-slate-400">Prioridad</span>
                <strong className="text-amber-400 font-mono text-sm">{claim.priority}</strong>
              </div>
              <div className="rounded-xl border border-cyan-500/20 bg-[#040814] p-3">
                <span className="block text-[10px] font-mono uppercase text-slate-400">Llamadas Registradas</span>
                <strong className="text-cyan-300 font-mono text-sm">{claim.callCount || 0} llamadas</strong>
              </div>
              <div className="rounded-xl border border-cyan-500/20 bg-[#040814] p-3">
                <span className="block text-[10px] font-mono uppercase text-slate-400">Fecha de Apertura</span>
                <strong className="text-slate-200 font-mono text-sm">{new Date(claim.createdAt).toLocaleDateString('es-ES')}</strong>
              </div>
            </div>
          </section>
        </div>

        {/* Customer Sidebar */}
        <section className="relative rounded-2xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden h-fit">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#22d3ee]" />
          <h2 className="flex items-center gap-2 text-sm font-bold text-white uppercase tracking-wider font-mono">
            <span className="material-symbols-outlined text-cyan-400 text-[20px]">person</span>
            Datos del Cliente
          </h2>
          <div className="mt-4 flex flex-col gap-3 text-xs text-slate-300">
            <div className="p-2.5 rounded-xl bg-[#040814] border border-cyan-500/15">
              <span className="text-slate-400 block text-[10px] font-mono uppercase">Nombre / Razón Social:</span>
              <strong className="text-white text-sm">{claim.customerName}</strong>
            </div>
            <div className="p-2.5 rounded-xl bg-[#040814] border border-cyan-500/15">
              <span className="text-slate-400 block text-[10px] font-mono uppercase">Teléfono de Contacto:</span>
              <strong className="font-mono text-cyan-300 text-sm">{claim.customerPhone}</strong>
            </div>
            {claim.customerEmail && (
              <div className="p-2.5 rounded-xl bg-[#040814] border border-cyan-500/15">
                <span className="text-slate-400 block text-[10px] font-mono uppercase">Correo Electrónico:</span>
                <span className="text-slate-200">{claim.customerEmail}</span>
              </div>
            )}
            <div className="p-2.5 rounded-xl bg-[#040814] border border-cyan-500/15">
              <span className="text-slate-400 block text-[10px] font-mono uppercase">Asesor Asignado:</span>
              <strong className="text-emerald-400">{claim.advisor}</strong>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

