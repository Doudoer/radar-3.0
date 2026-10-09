import React, { useState, useMemo } from 'react';
import { Order } from '../types';
import { generateOrdersReportPdf } from '../utils/ordersReportPdf';
import { downloadPdfBytes } from '../utils/weeklyRelationPdf';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  orders: Order[];
}

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Todos los Estatus' },
  { value: 'cotizacion', label: 'Cotización' },
  { value: 'espera_confirmacion', label: 'En espera de confirmación' },
  { value: 'pagado', label: 'Pagado' },
  { value: 'en_preparacion', label: 'En preparación' },
  { value: 'listo_despacho', label: 'Listo para despacho' },
  { value: 'listo_retiro', label: 'Listo para retiro' },
  { value: 'en_camino', label: 'En camino' },
  { value: 'entregado', label: 'Entregado' },
  { value: 'reclamo', label: 'Reclamo' },
  { value: 'cancelado', label: 'Cancelado' },
  { value: 'solicitud_reembolso', label: 'Solicitud de reembolso' },
  { value: 'reembolsado', label: 'Reembolsado' },
  { value: 'archivado', label: 'Archivado' },
];

const STATUS_LABELS: Record<string, string> = {
  all: 'Todos los Estatus',
  cotizacion: 'Cotización',
  espera_confirmacion: 'En espera de confirmación',
  pagado: 'Pagado',
  en_preparacion: 'En preparación',
  listo_despacho: 'Listo para despacho',
  listo_retiro: 'Listo para retiro',
  en_camino: 'En camino',
  entregado: 'Entregado',
  reclamo: 'Reclamo',
  cancelado: 'Cancelado',
  solicitud_reembolso: 'Solicitud de reembolso',
  reembolsado: 'Reembolsado',
  archivado: 'Archivado',
};

// Helper to extract YYYY-MM-DD from order
const getOrderDateYMD = (order: Order): string => {
  if (order.createdAtIso) {
    const d = new Date(order.createdAtIso);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  }
  const raw = (order.createdAt || '').trim();
  if (!raw) return '';

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.substring(0, 10);
  }

  const slashMatch = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const day = slashMatch[1].padStart(2, '0');
    const month = slashMatch[2].padStart(2, '0');
    const year = slashMatch[3];
    return `${year}-${month}-${day}`;
  }

  const spanishMonths: Record<string, string> = {
    ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06',
    jul: '07', ago: '08', sep: '09', oct: '10', nov: '11', dic: '12',
    enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
    julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
  };
  const match = raw.match(/(\d{1,2})\s+([a-zA-ZáéíóúÁÉÍÓÚ]+)\.?\s+(\d{4})/i);
  if (match) {
    const day = match[1].padStart(2, '0');
    const mKey = match[2].toLowerCase().slice(0, 3);
    const month = spanishMonths[mKey] || '01';
    const year = match[3];
    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  return '';
};

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  orders,
}) => {
  const [format, setFormat] = useState<'csv' | 'json' | 'pdf'>('csv');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  // Filter orders according to selected status and date range
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      // 1. Status filter
      if (statusFilter !== 'all' && order.status !== statusFilter) {
        return false;
      }

      // 2. Date Range Filter
      if (fromDate || toDate) {
        const orderDate = getOrderDateYMD(order);
        if (fromDate && (!orderDate || orderDate < fromDate)) return false;
        if (toDate && (!orderDate || orderDate > toDate)) return false;
      }

      return true;
    });
  }, [orders, statusFilter, fromDate, toDate]);

  const totalAmount = useMemo(() => {
    return filteredOrders.reduce(
      (sum, o) => sum + (o.financials?.total ?? o.financials?.partPrice ?? 0),
      0
    );
  }, [filteredOrders]);

  if (!isOpen) return null;

  const handleClearFilters = () => {
    setStatusFilter('all');
    setFromDate('');
    setToDate('');
  };

  const handleExport = async () => {
    if (filteredOrders.length === 0) return;

    const dateSuffix = fromDate && toDate 
      ? `_${fromDate}_al_${toDate}` 
      : fromDate 
        ? `_desde_${fromDate}` 
        : toDate 
          ? `_hasta_${toDate}` 
          : `_${new Date().toISOString().slice(0, 10)}`;
    const statusSuffix = statusFilter !== 'all' ? `_${statusFilter}` : '';

    if (format === 'csv') {
      const headers = 'Código,Fecha,Cliente,Teléfono,Vehículo,Placa,VIN,Pieza Principal,Estado,Total USD\n';
      const rows = filteredOrders
        .map(
          (o) =>
            `"${o.code}","${o.createdAt || ''}","${o.customer?.name || ''}","${o.customer?.phone || ''}","${o.vehicle?.make || ''} ${o.vehicle?.model || ''}","${o.vehicle?.plate || ''}","${o.vehicle?.vin || ''}","${o.mainPart || ''}","${STATUS_LABELS[o.status] || o.status}",${o.financials?.total ?? o.financials?.partPrice ?? 0}`
        )
        .join('\n');
      const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `radar3_ordenes${statusSuffix}${dateSuffix}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else if (format === 'json') {
      const blob = new Blob([JSON.stringify(filteredOrders, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `radar3_ordenes${statusSuffix}${dateSuffix}.json`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else if (format === 'pdf') {
      setIsGenerating(true);
      try {
        const dateRangeLabel = fromDate && toDate 
          ? `${fromDate} al ${toDate}` 
          : fromDate 
            ? `Desde ${fromDate}` 
            : toDate 
              ? `Hasta ${toDate}` 
              : 'Histórico Completo';

        const pdfBytes = await generateOrdersReportPdf({
          orders: filteredOrders,
          statusFilterLabel: STATUS_LABELS[statusFilter] || statusFilter,
          dateRangeLabel,
          totalOrders: filteredOrders.length,
          totalAmount,
        });

        downloadPdfBytes(pdfBytes, `radar3_reporte_ordenes${statusSuffix}${dateSuffix}.pdf`);
      } catch (err) {
        console.error('Error generating PDF:', err);
      } finally {
        setIsGenerating(false);
      }
    }

    setDownloaded(true);
    setTimeout(() => {
      setDownloaded(false);
      onClose();
    }, 1200);
  };

  const hasActiveFilters = statusFilter !== 'all' || fromDate !== '' || toDate !== '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-xl animate-fade-in">
      <div className="bg-[#070c18]/95 backdrop-blur-2xl border border-cyan-500/30 rounded-3xl w-full max-w-lg max-h-[min(94vh,680px)] shadow-[0_20px_60px_rgba(0,0,0,0.85)] overflow-hidden flex flex-col relative">
        {/* Laser Hairline */}
        <div className="cyber-laser-bar absolute top-0 left-0 right-0 z-20" />

        {/* Header */}
        <div className="p-4 sm:p-4.5 border-b border-cyan-500/20 flex justify-between items-center bg-[#0a1022]/80 backdrop-blur-md shrink-0">
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

        {/* Modal Body */}
        <div className="p-5 flex flex-col gap-4 text-xs text-slate-300 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          {/* Informational Message */}
          <div className="bg-[#040814]/80 p-3 rounded-2xl border border-cyan-500/20 flex flex-col gap-1">
            <p className="text-slate-300 leading-relaxed">
              Se generará un archivo consolidado con las{' '}
              <strong className="text-cyan-300 font-mono text-sm font-black">
                {filteredOrders.length}
              </strong>{' '}
              órdenes seleccionadas {hasActiveFilters ? `(de ${orders.length} órdenes totales)` : 'activas del taller, despacho y CRM'}.
            </p>
            {filteredOrders.length > 0 && (
              <p className="text-[11px] font-mono text-emerald-400 font-semibold">
                Monto consolidado: ${totalAmount.toFixed(2)} USD
              </p>
            )}
          </div>

          {/* Filters Selection Card */}
          <div className="bg-[#050a16] p-3.5 rounded-2xl border border-slate-800 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <label className="text-[10.5px] text-cyan-400 uppercase tracking-wider font-mono font-bold flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[15px]">filter_list</span>
                <span>Filtros de Exportación</span>
              </label>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="text-[10.5px] font-mono text-red-400 hover:text-red-300 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[13px]">restart_alt</span>
                  <span>Limpiar</span>
                </button>
              )}
            </div>

            {/* 1. Status Filter */}
            <div>
              <label className="block text-[10px] font-mono font-bold uppercase text-slate-400 tracking-wider mb-1.5">
                ESTATUS DE LAS ÓRDENES:
              </label>
              <div className="relative">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full appearance-none bg-[#070e1c] border border-slate-700/80 hover:border-cyan-500/50 focus:border-cyan-400 text-xs text-white rounded-xl pl-3 pr-8 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-400/40 transition cursor-pointer"
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-[#060c18] text-white">
                      {opt.label}
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[16px] pointer-events-none">
                  expand_more
                </span>
              </div>
            </div>

            {/* 2. Date Range Filter */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-slate-400 tracking-wider mb-1.5">
                  DESDE:
                </label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full bg-[#070e1c] border border-slate-700/80 hover:border-cyan-500/50 focus:border-cyan-400 text-xs text-white rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-400/40 transition [color-scheme:dark]"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-slate-400 tracking-wider mb-1.5">
                  HASTA:
                </label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full bg-[#070e1c] border border-slate-700/80 hover:border-cyan-500/50 focus:border-cyan-400 text-xs text-white rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-400/40 transition [color-scheme:dark]"
                />
              </div>
            </div>
          </div>

          {/* Formato de Exportación */}
          <div>
            <label className="text-[10px] text-cyan-400 uppercase tracking-wider block mb-2 font-mono font-bold">
              FORMATO DE EXPORTACIÓN:
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

          {/* Warning if 0 orders found */}
          {filteredOrders.length === 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-2.5 text-amber-300 text-xs flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">warning</span>
              <span>No se encontraron órdenes con el estatus y rango de fechas seleccionado.</span>
            </div>
          )}

          {/* Modal Footer */}
          <div className="flex justify-end gap-2.5 pt-3 border-t border-cyan-500/20 mt-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={filteredOrders.length === 0 || isGenerating}
              onClick={handleExport}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-black text-xs transition-all flex items-center gap-1.5 cursor-pointer shadow-[0_0_15px_rgba(6,182,212,0.35)] active:scale-95"
            >
              <span className="material-symbols-outlined text-[16px]">
                {isGenerating ? 'hourglass_top' : 'file_download'}
              </span>
              <span>
                {isGenerating
                  ? 'Generando PDF...'
                  : downloaded
                  ? 'Descargado'
                  : 'Descargar Archivo'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
