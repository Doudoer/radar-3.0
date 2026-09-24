import React, { useState } from 'react';
import { Order } from '../types';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  orders: Order[];
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  orders,
}) => {
  const [format, setFormat] = useState<'csv' | 'json' | 'pdf'>('csv');
  const [downloaded, setDownloaded] = useState(false);

  if (!isOpen) return null;

  const handleExport = () => {
    if (format === 'csv') {
      const headers = 'Código,Cliente,Vehículo,Placa,Pieza Principal,Estado,Total MXN\n';
      const rows = orders
        .map(
          (o) =>
            `"${o.code}","${o.customer.name}","${o.vehicle.make} ${o.vehicle.model}","${o.vehicle.plate}","${o.mainPart}","${o.status}",${o.financials.total}`
        )
        .join('\n');
      const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `radar3_ordenes_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else if (format === 'json') {
      const blob = new Blob([JSON.stringify(orders, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `radar3_ordenes_${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    setDownloaded(true);
    setTimeout(() => {
      setDownloaded(false);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-fade-in">
      <div className="bg-[#070c18]/95 backdrop-blur-2xl border border-cyan-500/30 rounded-3xl w-full max-w-md shadow-[0_20px_60px_rgba(0,0,0,0.85)] overflow-hidden flex flex-col relative">
        {/* Laser Hairline */}
        <div className="cyber-laser-bar absolute top-0 left-0 right-0 z-20" />

        {/* Header */}
        <div className="p-4.5 border-b border-cyan-500/20 flex justify-between items-center bg-[#0a1022]/80 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <span className="material-symbols-outlined text-[20px]">download</span>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100">
                Exportar Reporte de Órdenes
              </h3>
              <p className="text-[11px] text-cyan-400 font-mono">Consolidación de datos</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4 text-xs text-slate-300">
          <p className="text-slate-400 leading-relaxed">
            Se generará un archivo consolidado con las <strong className="text-cyan-400 font-mono">{orders.length}</strong> órdenes activas del taller, despacho y CRM.
          </p>

          <div>
            <label className="text-[10px] text-cyan-400 uppercase tracking-wider block mb-2 font-mono font-bold">
              Formato de Exportación:
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { id: 'csv', label: 'CSV / Excel', icon: 'table_chart' },
                { id: 'json', label: 'JSON Data', icon: 'data_object' },
                { id: 'pdf', label: 'Impresión / PDF', icon: 'picture_as_pdf' },
              ].map((fmt) => (
                <button
                  key={fmt.id}
                  type="button"
                  onClick={() => setFormat(fmt.id as any)}
                  className={`p-3 rounded-2xl border flex flex-col items-center gap-2 transition-all cursor-pointer ${
                    format === fmt.id
                      ? 'bg-cyan-950/40 border-cyan-500/60 text-cyan-300 font-bold shadow-[0_0_15px_rgba(6,182,212,0.2)]'
                      : 'bg-[#050914] border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <span className="material-symbols-outlined text-[22px]">{fmt.icon}</span>
                  <span className="text-[11px]">{fmt.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2.5 pt-3 border-t border-cyan-500/20">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-xs transition-all flex items-center gap-1.5 cursor-pointer shadow-[0_0_15px_rgba(6,182,212,0.35)] active:scale-95"
            >
              <span className="material-symbols-outlined text-[16px]">file_download</span>
              <span>{downloaded ? 'Descargando...' : 'Descargar Archivo'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
