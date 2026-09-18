import React, { useEffect, useMemo, useState } from 'react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Order, OrderStatus } from '../types';

const reportStatuses: Array<{ id: OrderStatus; label: string }> = [
  { id: 'cotizacion', label: 'Cotización' },
  { id: 'pagado', label: 'Pagado' },
  { id: 'en_preparacion', label: 'En preparación' },
  { id: 'espera_confirmacion', label: 'En espera de confirmación' },
  { id: 'reclamo', label: 'Cambio / Reclamo' },
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

const cleanText = (value: string, max = 140) => value
  .replace(/[–—]/g, '-')
  .replace(/[^\x20-\x7EÀ-ÿ]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

const partType = (order: Order) => /tra|transmisi|transmission|caja|gearbox/i.test(order.mainPart) ? 'TRA' : 'ENG';

const displayDate = (value: string) => {
  const [year, month, day] = value.split('-');
  return `${month}/${day}/${year}`;
};

const wrapText = (text: string, font: { widthOfTextAtSize: (value: string, size: number) => number }, size: number, maxWidth: number) => {
  const words = cleanText(text).split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  });
  if (line) lines.push(line);
  return lines.length ? lines : ['-'];
};

const orderType = (order: Order) => order.status === 'reclamo' || Boolean(order.claimReason) ? 'CAMBIO' : 'VENTA';

const yardNotes = (order: Order) => {
  const delivery = order.deliveryType === 'envio_domicilio' ? 'Envío' : 'Retiro en Tienda';
  if (orderType(order) === 'CAMBIO') {
    return `Cambio urgente / ${order.notes || order.claimReason || 'Buscar en yarda'} / ${delivery}`;
  }
  return order.notes || delivery;
};

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
      const pageSize: [number, number] = [841.89, 595.28];
      const margin = 12;
      const tableWidth = pageSize[0] - margin * 2;
      const columns = [64, 112, 40, 77, 80, 40, 213, 57, 134];
      const headers = ['FECHA', 'CLIENTE', 'AÑO', 'MARCA', 'MODELO', 'TIPO', 'SPECS', 'TIPO\nORDEN', 'NOTAS / STATUS PATIO'];
      const navy = rgb(0.08, 0.12, 0.2);
      const headerBlue = rgb(0.11, 0.16, 0.25);
      const grid = rgb(0.77, 0.82, 0.89);
      const paleYellow = rgb(1, 0.98, 0.84);
      let page = pdf.addPage(pageSize);
      let y = 0;

      const drawReportHeader = () => {
        page.drawText('PENDIENTES POR STATUS', { x: margin, y: 564, size: 17, font: bold, color: navy });
        page.drawText('Control y seguimiento de solicitudes de partes a patio', { x: margin, y: 549, size: 8.5, font: regular, color: rgb(0.29, 0.36, 0.47) });
        const range = `Rango: ${displayDate(fromDate)} al ${displayDate(toDate)}  |  Total Registros: ${selectedOrders.length}`;
        const rangeWidth = bold.widthOfTextAtSize(range, 8) + 14;
        page.drawRectangle({ x: pageSize[0] - margin - rangeWidth, y: 551, width: rangeWidth, height: 18, color: rgb(0.95, 0.97, 0.99), borderColor: grid, borderWidth: 0.75 });
        page.drawText(range, { x: pageSize[0] - margin - rangeWidth + 7, y: 557, size: 8, font: bold, color: rgb(0.2, 0.27, 0.37) });
        page.drawLine({ start: { x: margin, y: 541 }, end: { x: pageSize[0] - margin, y: 541 }, thickness: 1.5, color: navy });
        y = 532;
      };

      const drawTableHeader = () => {
        const height = 31;
        page.drawRectangle({ x: margin, y: y - height, width: tableWidth, height, color: headerBlue });
        let x = margin;
        headers.forEach((header, index) => {
          header.split('\n').forEach((line, lineIndex) => {
            const width = bold.widthOfTextAtSize(line, 7.2);
            page.drawText(line, { x: x + Math.max(4, (columns[index] - width) / 2), y: y - 13 - lineIndex * 9, size: 7.2, font: bold, color: rgb(1, 1, 1) });
          });
          x += columns[index];
        });
        y -= height;
      };

      const startPage = () => {
        drawReportHeader();
        drawTableHeader();
      };

      startPage();
      selectedOrders.forEach((order) => {
        const date = orderDate(order);
        const type = orderType(order);
        const values = [
          date ? date.toLocaleDateString('en-US') : '-',
          order.customer.name || '-',
          String(order.vehicle.year || '-'),
          order.vehicle.make || '-',
          order.vehicle.model || '-',
          partType(order),
          order.productSpecs || order.mainPart || '-',
          type,
          yardNotes(order),
        ];
        const lines = values.map((value, index) => wrapText(value, index === 1 ? bold : regular, 7.3, columns[index] - 10));
        const rowHeight = Math.max(24, Math.max(...lines.map((cellLines) => cellLines.length)) * 9 + 10);
        if (y - rowHeight < 48) {
          page = pdf.addPage(pageSize);
          startPage();
        }

        const highlighted = /buscar en yarda|cambio urgente/i.test(values[8]);
        page.drawRectangle({ x: margin, y: y - rowHeight, width: tableWidth, height: rowHeight, color: highlighted ? paleYellow : rgb(1, 1, 1), borderColor: grid, borderWidth: 0.6 });
        let x = margin;
        lines.forEach((cellLines, index) => {
          if (index > 0) page.drawLine({ start: { x, y }, end: { x, y: y - rowHeight }, thickness: 0.6, color: grid });
          const cellFont = index === 1 || (index === 8 && type === 'CAMBIO') ? bold : regular;
          const textColor = index === 8 && type === 'CAMBIO' ? rgb(0.75, 0.08, 0.08) : navy;
          cellLines.forEach((line, lineIndex) => {
            const centered = [0, 2, 5, 7].includes(index);
            const lineWidth = cellFont.widthOfTextAtSize(line, 7.3);
            const textX = centered ? x + Math.max(4, (columns[index] - lineWidth) / 2) : x + 5;
            page.drawText(line, { x: textX, y: y - 14 - lineIndex * 9, size: 7.3, font: cellFont, color: textColor });
          });
          x += columns[index];
        });
        y -= rowHeight;
      });

      const instruction = 'Instrucción de Patio: Revisar las notas/status de cada orden, confirmar ubicación y estado físico de la pieza, y priorizar los cambios urgentes.';
      if (y < 34) {
        page = pdf.addPage(pageSize);
        startPage();
      }
      page.drawRectangle({ x: margin, y: y - 29, width: tableWidth, height: 23, color: rgb(0.96, 0.97, 0.99), borderColor: grid, borderWidth: 0.6 });
      page.drawText(instruction, { x: margin + 7, y: y - 20, size: 7.5, font: bold, color: rgb(0.25, 0.32, 0.42) });

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
