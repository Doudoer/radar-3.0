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
  const orderTotal = order?.financials.total ?? 0;
  const orderBalance = order?.financials.balanceDue ?? Math.max(0, orderTotal - (order?.financials.downPayment ?? 0));

  return (
    <div className="radar-view text-[#dfe2ef] pb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <button type="button" onClick={onBack} className="mt-1 rounded-lg p-1 text-[#94a3b8] hover:bg-[#1e293b] hover:text-white" title="Volver a reclamos"><span className="material-symbols-outlined text-[24px]">arrow_back</span></button>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-extrabold text-[#f1f5f9]">Detalle de Reclamo</h1><span className="rounded border border-[#2b3a58] bg-[#1e293b] px-2 py-0.5 font-mono text-xs text-[#58a6ff]">{claim.id}</span><span className="rounded-full border border-[#f59e0b]/50 bg-[#f59e0b]/15 px-2.5 py-1 text-xs font-bold text-[#fbbf24]">{claim.status}</span></div>
            <p className="mt-1 text-xs text-[#94a3b8]">Orden {claim.orderCode} · {claim.customerName}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pl-10 sm:pl-0"><button type="button" onClick={onOpenCalls} className="rounded-xl border border-[#334155] bg-[#1e293b] px-4 py-2.5 text-xs font-bold text-[#f1f5f9] hover:bg-[#334155]">Ver bitácora</button>{claim.status !== 'Resolved' && <button type="button" onClick={onResolve} className="rounded-xl border border-[#10b981]/40 bg-[#10b981]/20 px-4 py-2.5 text-xs font-black text-[#34d399] hover:bg-[#10b981]/30">Marcar como resuelto</button>}</div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="flex flex-col gap-5">
          <section className="radar-panel p-5"><h2 className="flex items-center gap-2 text-sm font-bold text-[#f1f5f9]"><span className="material-symbols-outlined text-[#58a6ff]">inventory_2</span>Detalles de la Orden</h2><div className="mt-4 grid grid-cols-1 gap-3 text-xs text-[#cbd5e1] sm:grid-cols-2"><div><span className="text-[#94a3b8]">Código:</span> <strong className="font-mono text-[#f1f5f9]">{claim.orderCode}</strong></div><div><span className="text-[#94a3b8]">Estatus anterior:</span> <strong className="text-[#34d399]">{claim.previousOrderStatus}</strong></div><div><span className="text-[#94a3b8]">Vehículo:</span> <strong>{claim.vehicle}</strong></div><div><span className="text-[#94a3b8]">VIN:</span> <strong className="font-mono">{claim.vin || order?.vehicle.vin || '-'}</strong></div><div><span className="text-[#94a3b8]">Pieza:</span> <strong className="text-[#58a6ff]">{claim.mainPart}</strong></div><div><span className="text-[#94a3b8]">Stock:</span> <strong className="font-mono text-[#34d399]">{claim.stockNumber || '-'}</strong></div><div><span className="text-[#94a3b8]">Total:</span> <strong>${orderTotal.toFixed(2)}</strong></div><div><span className="text-[#94a3b8]">Balance:</span> <strong className="text-[#f87171]">${orderBalance.toFixed(2)}</strong></div></div></section>
          <section className="radar-panel p-5"><h2 className="flex items-center gap-2 text-sm font-bold text-[#f1f5f9]"><span className="material-symbols-outlined text-[#f87171]">report_problem</span>Seguimiento del Reclamo</h2><div className="mt-4 rounded-xl border border-[#ef4444]/30 bg-[#ef4444]/10 p-3 text-xs text-[#fecaca]"><span className="font-bold">Motivo reportado:</span> {claim.claimReason}</div><div className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-3"><div className="rounded-xl border border-[#1e293b] bg-[#080e1e] p-3"><span className="block text-[#94a3b8]">Prioridad</span><strong className="text-[#fbbf24]">{claim.priority}</strong></div><div className="rounded-xl border border-[#1e293b] bg-[#080e1e] p-3"><span className="block text-[#94a3b8]">Llamadas</span><strong className="text-[#58a6ff]">{claim.callCount || 0}</strong></div><div className="rounded-xl border border-[#1e293b] bg-[#080e1e] p-3"><span className="block text-[#94a3b8]">Creado</span><strong className="text-[#f1f5f9]">{new Date(claim.createdAt).toLocaleDateString('es-ES')}</strong></div></div></section>
        </div>
        <section className="radar-panel p-5"><h2 className="flex items-center gap-2 text-sm font-bold text-[#f1f5f9]"><span className="material-symbols-outlined text-[#58a6ff]">person</span>Datos del Cliente</h2><div className="mt-4 flex flex-col gap-3 text-xs text-[#cbd5e1]"><div><span className="text-[#94a3b8]">Nombre:</span> <strong>{claim.customerName}</strong></div><div><span className="text-[#94a3b8]">Teléfono:</span> <strong className="font-mono">{claim.customerPhone}</strong></div>{claim.customerEmail && <div><span className="text-[#94a3b8]">Email:</span> {claim.customerEmail}</div>}<div><span className="text-[#94a3b8]">Asesor:</span> {claim.advisor}</div></div></section>
      </div>
    </div>
  );
};
