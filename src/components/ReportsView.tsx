import React from 'react';

export const ReportsView: React.FC = () => {
  return (
    <div className="radar-view">
      <div>
        <h2 className="font-headline-md text-2xl md:text-3xl font-bold text-[#dfe2ef] tracking-tight mb-1">
          Reportes & Analítica Operativa
        </h2>
        <p className="font-body-md text-[14px] text-[#c2c6d6]">
          Métricas de cumplimiento de SLAs, rotación de bahías y tiempos de respuesta.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-card rounded-xl p-5 shadow-sm">
          <h3 className="font-headline-sm text-base font-bold text-[#dfe2ef] mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-[#4d8eff] text-lg">timer</span>
            Cumplimiento de SLAs de Taller
          </h3>
          <div className="space-y-4 text-xs">
            <div>
              <div className="flex justify-between text-[#dfe2ef] mb-1">
                <span>Diagnóstico Inicial (&lt; 4 hrs)</span>
                <span className="font-data-mono font-bold text-[#4edea3]">94.2%</span>
              </div>
              <div className="w-full h-2 bg-[#0a0e17] rounded-full overflow-hidden">
                <div className="h-full bg-[#4edea3]" style={{ width: '94.2%' }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[#dfe2ef] mb-1">
                <span>Cotización y Presupuesto (&lt; 12 hrs)</span>
                <span className="font-data-mono font-bold text-[#4d8eff]">88.7%</span>
              </div>
              <div className="w-full h-2 bg-[#0a0e17] rounded-full overflow-hidden">
                <div className="h-full bg-[#4d8eff]" style={{ width: '88.7%' }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[#dfe2ef] mb-1">
                <span>Entrega en Fecha Prometida</span>
                <span className="font-data-mono font-bold text-[#f59e0b]">82.1%</span>
              </div>
              <div className="w-full h-2 bg-[#0a0e17] rounded-full overflow-hidden">
                <div className="h-full bg-[#f59e0b]" style={{ width: '82.1%' }} />
              </div>
            </div>
          </div>
        </div>

        <div className="glass-card rounded-xl p-5 shadow-sm">
          <h3 className="font-headline-sm text-base font-bold text-[#dfe2ef] mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-[#4edea3] text-lg">workspace_premium</span>
            Satisfacción del Cliente (CSAT)
          </h3>
          <div className="flex items-center justify-center p-6 flex-col">
            <span className="font-display-lg font-data-mono text-5xl font-extrabold text-[#4edea3]">
              4.9 / 5.0
            </span>
            <p className="text-xs text-[#c2c6d6] mt-2">Basado en 320 encuestas de salida automáticas</p>
          </div>
        </div>
      </div>
    </div>
  );
};
