import React from 'react';

export const FinanceView: React.FC = () => {
  return (
    <div className="w-full max-w-[1600px] mx-auto flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="font-headline-md text-2xl md:text-3xl font-bold text-[#dfe2ef] tracking-tight mb-1">
            Finanzas & Facturación
          </h2>
          <p className="font-body-md text-[14px] text-[#c2c6d6]">
            Control de cobros, anticipos, saldos pendientes y facturas fiscales emitidas.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-card rounded-xl p-5 shadow-sm">
          <p className="font-data-label text-xs text-[#c2c6d6] uppercase tracking-wider mb-1">
            Total Facturado Este Mes
          </p>
          <p className="font-display-lg font-data-mono text-2xl lg:text-3xl font-extrabold text-[#4edea3]">
            $ 1,485,200.00
          </p>
          <span className="text-xs text-[#4edea3] flex items-center gap-1 mt-2">
            <span className="material-symbols-outlined text-sm">trending_up</span> +14.2% vs mes anterior
          </span>
        </div>

        <div className="glass-card rounded-xl p-5 shadow-sm">
          <p className="font-data-label text-xs text-[#c2c6d6] uppercase tracking-wider mb-1">
            Saldos por Cobrar (Pendiente)
          </p>
          <p className="font-display-lg font-data-mono text-2xl lg:text-3xl font-extrabold text-[#f59e0b]">
            $ 248,500.00
          </p>
          <span className="text-xs text-[#c2c6d6] mt-2 block">
            8 órdenes pendientes de liquidación
          </span>
        </div>

        <div className="glass-card rounded-xl p-5 shadow-sm">
          <p className="font-data-label text-xs text-[#c2c6d6] uppercase tracking-wider mb-1">
            Margen Operativo Promedio
          </p>
          <p className="font-display-lg font-data-mono text-2xl lg:text-3xl font-extrabold text-[#4d8eff]">
            38.4 %
          </p>
          <span className="text-xs text-[#4d8eff] flex items-center gap-1 mt-2">
            <span className="material-symbols-outlined text-sm">check</span> Objetivo superado (35%)
          </span>
        </div>
      </div>

      {/* Transactions list */}
      <div className="glass-card rounded-xl shadow-lg p-5">
        <h3 className="font-headline-sm text-base font-bold text-[#dfe2ef] mb-3">
          Últimas Transacciones Registradas
        </h3>
        <div className="space-y-2 text-xs">
          {[
            { id: 'FAC-901', client: 'Roberto Sánchez', order: 'ORD-8924A', amount: 1473200, status: 'Pre-aprobado', date: 'Hoy, 14:32' },
            { id: 'FAC-900', client: 'Transportes Ruta Sur', order: 'ORD-8915', amount: 112000, status: 'Facturado', date: 'Ayer, 18:10' },
            { id: 'FAC-899', client: 'Laura Álvarez', order: 'ORD-8918', amount: 10000, status: 'Anticipo Pagado', date: '23 Oct, 11:20' },
            { id: 'FAC-898', client: 'Martín Rodríguez', order: 'ORD-8921', amount: 45200, status: 'Pendiente', date: '22 Oct, 16:45' },
          ].map((tx) => (
            <div key={tx.id} className="p-3 bg-[#0a0e17] rounded-lg border border-[rgba(255,255,255,0.06)] flex justify-between items-center">
              <div>
                <span className="font-data-mono font-bold text-[#4d8eff] mr-2">{tx.id}</span>
                <span className="text-[#dfe2ef] font-medium">{tx.client}</span>
                <span className="text-[#c2c6d6] text-[11px] ml-2">({tx.order})</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-data-mono font-bold text-[#dfe2ef]">
                  ${tx.amount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                </span>
                <span className="px-2 py-0.5 rounded text-[11px] bg-[#31353f] text-[#c2c6d6]">
                  {tx.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
