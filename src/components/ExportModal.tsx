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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
      <div className="bg-[#181b25] border border-[rgba(255,255,255,0.12)] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        <div className="p-4 border-b border-[rgba(255,255,255,0.08)] flex justify-between items-center bg-[#1c1f29]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#4d8eff] text-[20px]">download</span>
            <h3 className="font-headline-sm text-base font-bold text-[#dfe2ef]">
              Exportar Reporte de Órdenes
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-[#c2c6d6] hover:text-white p-1 rounded hover:bg-[#31353f] transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4 text-xs text-[#dfe2ef]">
          <p className="text-[#c2c6d6]">
            Se generará un archivo consolidado con las {orders.length} órdenes activas del taller y CRM.
          </p>

          <div>
            <label className="font-data-label text-[10px] text-[#adc6ff] uppercase tracking-wider block mb-2 font-semibold">
              Formato de Exportación:
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'csv', label: 'CSV / Excel', icon: 'table_chart' },
                { id: 'json', label: 'JSON Data', icon: 'data_object' },
                { id: 'pdf', label: 'Impresión / PDF', icon: 'picture_as_pdf' },
              ].map((fmt) => (
                <button
                  key={fmt.id}
                  type="button"
                  onClick={() => setFormat(fmt.id as any)}
                  className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all cursor-pointer ${
                    format === fmt.id
                      ? 'bg-[#4d8eff]/20 border-[#4d8eff] text-[#adc6ff] font-semibold'
                      : 'bg-[#0a0e17] border-[rgba(255,255,255,0.08)] text-[#c2c6d6] hover:bg-[#31353f]'
                  }`}
                >
                  <span className="material-symbols-outlined text-[20px]">{fmt.icon}</span>
                  <span className="text-[11px]">{fmt.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-[rgba(255,255,255,0.08)]">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-[#31353f] text-[#c2c6d6] hover:text-white transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="px-4 py-1.5 rounded-lg bg-[#4d8eff] text-[#00285d] font-bold hover:bg-[#3b7cee] transition-all flex items-center gap-1.5 cursor-pointer shadow-[0_0_10px_rgba(77,142,255,0.4)]"
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
