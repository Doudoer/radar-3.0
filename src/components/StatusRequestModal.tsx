import React, { useEffect, useMemo, useState } from 'react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Order, OrderStatus } from '../types';

const reportStatuses: Array<{ id: OrderStatus; label: string }> = [
  { id: 'cotizacion', label: 'Cotización' },
  { id: 'pagado', label: 'Pagado' },
  { id: 'en_preparacion', label: 'En preparación' },
  { id: 'espera_confirmacion', label: 'En espera de confirmación' },
];

interface StatusRequestModalProps {
  isOpen: boolean;
  orders: Order[];
  onClose: () => void;
}

const orderDate = (order: Order) => {
  const value = order.createdAtIso || order.createdAt;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const cleanText = (value: string, max = 70) => value.replace(/\s+/g, ' ').trim().slice(0, max);

const partType = (order: Order) => /tra|transmisi|transmission|caja|gearbox/i.test(order.mainPart) ? 'TRA' : 'ENG';

export const StatusRequestModal: React.FC<StatusRequestModalProps> = ({ isOpen, orders, onClose }) => {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState<OrderStatus[]>(reportStatuses.map((status) => status.id));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const matchingOrders = useMemo(() => orders.filter((order) => {
    const date = orderDate(order);
    if (!date || !selectedStatuses.includes(order.status)) return false;
    const dateOnly = date.toISOString().slice(0, 10);
    return (!fromDate || dateOnly >= fromDate) && (!toDate || dateOnly <= toDate);
  }), [orders, fromDate, toDate, selectedStatuses]);

  useEffect(() => {
    setSelectedIds(matchingOrders.map((order) => order.id));
  }, [matchingOrders]);

  if (!isOpen) return null;

  const toggleStatus = (status: OrderStatus) => {
    setSelectedStatuses((current) => current.includes(status) ? current.filter((item) => item !== status) : [...current, status]);
  };

  const toggleOrder = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const selectAll = () => setSelectedIds(selectedIds.length === matchingOrders.length ? [] : matchingOrders.map((order) => order.id));

  const generatePdf = async () => {
    if (!fromDate || !toDate) return setError('Selecciona el rango de fechas antes de emitir el reporte.');
    if (fromDate > toDate) return setError('La fecha inicial no puede ser posterior a la fecha final.');
    const selectedOrders = matchingOrders.filter((order) => selectedIds.includes(order.id));
    if (!selectedOrders.length) return setError('Selecciona al menos una orden para emitir el reporte.');

    setGenerating(true);
    setError('');
    try {
      const pdf = await PDFDocument.create();
      const regular = await pdf.embedFont(StandardFonts.Helvetica);
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      const blue = rgb(0.12, 0.32, 0.58);
      let page = pdf.addPage([612, 792]);
      let y = 748;
      const addPageIfNeeded = () => { if (y < 70) { page = pdf.addPage([612, 792]); y = 748; } };
      page.drawText('SOLICITUD DE ESTATUS', { x: 42, y, size: 18, font: bold, color: blue });
      y -= 28;
      page.drawText(`Rango: ${fromDate} a ${toDate}  |  Ordenes: ${selectedOrders.length}`, { x: 42, y, size: 9, font: regular, color: rgb(0.3, 0.3, 0.3) });
      y -= 26;
      page.drawLine({ start: { x: 42, y }, end: { x: 570, y }, thickness: 1, color: blue });
      y -= 22;

      selectedOrders.forEach((order, index) => {
        addPageIfNeeded();
        const details = [
          `${index + 1}. ${cleanText(order.customer.name, 52)} | ${order.vehicle.year || '-'} ${cleanText(order.vehicle.make, 20)} ${cleanText(order.vehicle.model, 24)}`,
          `Tipo: ${partType(order)}    Orden: ${cleanText(order.code, 28)}    Estatus: ${cleanText(order.status, 24)}`,
          `Descripcion: ${cleanText(order.productSpecs || order.mainPart || '-', 90)}`,
          `VIN: ${cleanText(order.vehicle.vin || 'No registrado', 70)}`,
        ];
        page.drawText(details[0], { x: 42, y, size: 10, font: bold, color: rgb(0.08, 0.12, 0.2) });
        y -= 16;
        details.slice(1).forEach((line) => { page.drawText(line, { x: 52, y, size: 9, font: regular, color: rgb(0.2, 0.23, 0.28) }); y -= 14; });
        y -= 10;
        page.drawLine({ start: { x: 52, y }, end: { x: 570, y }, thickness: 0.5, color: rgb(0.82, 0.84, 0.88) });
        y -= 14;
      });

      const bytes = await pdf.save();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `solicitud_estatus_${fromDate}_${toDate}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch {
      setError('No se pudo generar el PDF. Intenta nuevamente.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl min-h-0 flex-col overflow-hidden rounded-2xl border border-[#2b466e] bg-[#111827] shadow-2xl">
        <div className="flex shrink-0 items-start justify-between border-b border-[#2b3a58] bg-[#182338] p-5">
          <div><h2 className="flex items-center gap-2 text-lg font-bold text-[#f1f5f9]"><span className="material-symbols-outlined text-[#58a6ff]">assignment</span>Solicitud de estatus</h2><p className="mt-1 text-xs text-[#94a3b8]">Selecciona el rango y las órdenes que la yarda debe actualizar.</p></div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-[#94a3b8] hover:bg-[#1e293b] hover:text-white"><span className="material-symbols-outlined">close</span></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-[#cbd5e1]">Desde<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="mt-1 w-full rounded-lg border border-[#2b3a58] bg-[#080d19] px-3 py-2 text-sm text-white" /></label><label className="text-xs text-[#cbd5e1]">Hasta<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="mt-1 w-full rounded-lg border border-[#2b3a58] bg-[#080d19] px-3 py-2 text-sm text-white" /></label></div>
          <div className="mt-5"><p className="mb-2 text-xs font-bold uppercase tracking-wider text-[#94a3b8]">Estatus incluidos</p><div className="grid gap-2 sm:grid-cols-2">{reportStatuses.map((status) => <label key={status.id} className="flex items-center gap-2 rounded-lg border border-[#1e293b] bg-[#0b1329] p-2 text-xs text-[#cbd5e1]"><input type="checkbox" checked={selectedStatuses.includes(status.id)} onChange={() => toggleStatus(status.id)} className="h-4 w-4 accent-[#388bfd]" />{status.label}</label>)}</div></div>
          <div className="mt-5 overflow-hidden rounded-xl border border-[#263653]"><div className="flex items-center justify-between border-b border-[#263653] bg-[#0b1329] px-3 py-2"><span className="text-xs font-bold text-[#f1f5f9]">Órdenes encontradas: {matchingOrders.length}</span><button type="button" onClick={selectAll} className="text-xs font-semibold text-[#58a6ff]">{selectedIds.length === matchingOrders.length && matchingOrders.length ? 'Quitar todas' : 'Seleccionar todas'}</button></div><div className="max-h-64 overflow-y-auto">{matchingOrders.map((order) => <label key={order.id} className="flex cursor-pointer items-start gap-3 border-b border-[#1e293b] px-3 py-3 text-xs hover:bg-[#13233c]"><input type="checkbox" checked={selectedIds.includes(order.id)} onChange={() => toggleOrder(order.id)} className="mt-1 h-4 w-4 accent-[#388bfd]" /><span><strong className="text-[#f1f5f9]">{order.code} · {order.customer.name}</strong><span className="block text-[#94a3b8]">{order.vehicle.year} {order.vehicle.make} {order.vehicle.model} · {partType(order)} · {order.status}</span></span></label>)}{!matchingOrders.length && <p className="p-6 text-center text-xs text-[#64748b]">No hay órdenes con esos filtros y fechas.</p>}</div></div>
          {error && <p className="mt-3 rounded-lg border border-[#ef4444]/30 bg-[#ef4444]/10 px-3 py-2 text-xs text-[#fca5a5]">{error}</p>}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-[#2b3a58] bg-[#182338] p-4"><button type="button" onClick={onClose} className="rounded-lg bg-[#1e293b] px-4 py-2 text-xs font-bold text-[#cbd5e1]">Cancelar</button><button type="button" onClick={() => void generatePdf()} disabled={generating} className="rounded-lg bg-[#388bfd] px-4 py-2 text-xs font-bold text-[#07111f] disabled:opacity-50">{generating ? 'Generando...' : 'Emitir reporte PDF'}</button></div>
      </div>
    </div>
  );
};
