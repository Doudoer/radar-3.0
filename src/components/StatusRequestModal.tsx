import React, { useEffect, useMemo, useState } from 'react';
import { PDFDocument, PDFFont, PDFPage, RGB, StandardFonts, rgb } from 'pdf-lib';
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

const drawLabel = (
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  textColor: RGB,
  backgroundColor: RGB,
  borderColor?: RGB,
) => {
  const size = 7;
  const paddingX = 4;
  const width = font.widthOfTextAtSize(text, size) + paddingX * 2;
  page.drawRectangle({ x, y, width, height: 13, color: backgroundColor, borderColor, borderWidth: borderColor ? 0.6 : 0 });
  page.drawText(text, { x: x + paddingX, y: y + 3.4, size, font, color: textColor });
  return width;
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
      const margin = 22;
      const columns = [62, 108, 39, 72, 75, 39, 203, 56, 143];
      const tableWidth = columns.reduce((total, width) => total + width, 0);
      const headers = ['FECHA', 'CLIENTE', 'AÑO', 'MARCA', 'MODELO', 'TIPO', 'SPECS', 'TIPO\nORDEN', 'NOTAS / STATUS PATIO'];
      const navy = rgb(0.08, 0.12, 0.2);
      const headerBlue = rgb(0.11, 0.16, 0.25);
      const grid = rgb(0.77, 0.82, 0.89);
      const paleYellow = rgb(1, 0.98, 0.84);
      const stripeBlue = rgb(0.96, 0.98, 1);
      const tagYellow = rgb(1, 0.87, 0.31);
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
      selectedOrders.forEach((order, rowIndex) => {
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
        const lines = values.map((value, index) => {
          if ([5, 7].includes(index)) return [value];
          return wrapText(value, index === 1 ? bold : regular, 7.3, columns[index] - 10);
        });
        const highlighted = /buscar en yarda|cambio urgente/i.test(values[8]);
        const usesLongYardLabel = /disponible/i.test(values[8]);
        const highlightedHeight = highlighted ? (type === 'CAMBIO' || usesLongYardLabel ? 39 : 29) : 0;
        const rowHeight = Math.max(24, highlightedHeight, Math.max(...lines.map((cellLines) => cellLines.length)) * 9 + 10);
        const reservedBottom = rowIndex === selectedOrders.length - 1 ? margin + 29 : margin;
        if (y - rowHeight < reservedBottom) {
          page = pdf.addPage(pageSize);
          startPage();
        }

        const rowColor = highlighted ? paleYellow : rowIndex % 2 ? stripeBlue : rgb(1, 1, 1);
        page.drawRectangle({ x: margin, y: y - rowHeight, width: tableWidth, height: rowHeight, color: rowColor, borderColor: grid, borderWidth: 0.6 });
        let x = margin;
        lines.forEach((cellLines, index) => {
          if (index > 0) page.drawLine({ start: { x, y }, end: { x, y: y - rowHeight }, thickness: 0.6, color: grid });
          if (index === 5) {
            const isEngine = values[index] === 'ENG';
            const labelWidth = bold.widthOfTextAtSize(values[index], 7) + 8;
            drawLabel(
              page,
              values[index],
              x + (columns[index] - labelWidth) / 2,
              y - 18,
              bold,
              isEngine ? rgb(0.05, 0.36, 0.57) : rgb(0.72, 0.37, 0.02),
              isEngine ? rgb(0.82, 0.94, 1) : rgb(1, 0.94, 0.7),
            );
            x += columns[index];
            return;
          }
          if (index === 7) {
            const isSale = type === 'VENTA';
            const labelWidth = bold.widthOfTextAtSize(type, 7) + 8;
            drawLabel(
              page,
              type,
              x + (columns[index] - labelWidth) / 2,
              y - 18,
              bold,
              isSale ? rgb(0.02, 0.48, 0.32) : rgb(0.8, 0.08, 0.08),
              isSale ? rgb(0.88, 1, 0.95) : rgb(1, 0.9, 0.9),
              isSale ? rgb(0.43, 0.88, 0.69) : rgb(1, 0.62, 0.62),
            );
            x += columns[index];
            return;
          }
          if (index === 8 && highlighted) {
            const note = cleanText(values[index]);
            const urgentPrefix = type === 'CAMBIO' ? 'Cambio urgente /' : '';
            const searchLabel = /disponible/i.test(note) ? 'Disponible - Buscar en yarda' : 'Buscar en yarda';
            let noteY = y - 13;
            if (urgentPrefix) {
              page.drawText(urgentPrefix, { x: x + 5, y: noteY, size: 7.3, font: bold, color: rgb(0.78, 0.06, 0.06) });
              noteY -= 13;
            }
            const labelWidth = drawLabel(page, searchLabel, x + 5, noteY - 3.4, bold, rgb(0.48, 0.31, 0.02), tagYellow, rgb(0.94, 0.65, 0.02));
            const delivery = order.deliveryType === 'envio_domicilio' ? '/ Envío' : '/ Retiro';
            const deliveryWidth = regular.widthOfTextAtSize(delivery, 7.3);
            const deliveryX = x + labelWidth + 8;
            const deliveryFits = deliveryX + deliveryWidth <= x + columns[index] - 5;
            page.drawText(delivery, {
              x: deliveryFits ? deliveryX : x + 5,
              y: deliveryFits ? noteY : noteY - 13,
              size: 7.3,
              font: regular,
              color: navy,
            });
            x += columns[index];
            return;
          }
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

      const instructionPrefix = 'Instrucción de Patio:';
      const instructionStart = ' Las piezas con etiqueta ';
      const instructionTag = 'Disponible - Buscar en yarda';
      const instructionEnd = ' están confirmadas en inventario físico pero pendientes de localización/desmonte en el lote. Priorizar los Cambios urgentes.';
      if (y - 29 < margin) {
        page = pdf.addPage(pageSize);
        startPage();
      }
      page.drawRectangle({ x: margin, y: y - 29, width: tableWidth, height: 23, color: rgb(0.96, 0.97, 0.99), borderColor: grid, borderWidth: 0.6 });
      const instructionY = y - 20;
      let instructionX = margin + 7;
      page.drawText(instructionPrefix, { x: instructionX, y: instructionY, size: 7.5, font: bold, color: rgb(0.25, 0.32, 0.42) });
      instructionX += bold.widthOfTextAtSize(instructionPrefix, 7.5);
      page.drawText(instructionStart, { x: instructionX, y: instructionY, size: 7.5, font: regular, color: rgb(0.25, 0.32, 0.42) });
      instructionX += regular.widthOfTextAtSize(instructionStart, 7.5);
      instructionX += drawLabel(page, instructionTag, instructionX, instructionY - 3.5, bold, rgb(0.48, 0.31, 0.02), rgb(1, 0.91, 0.48), rgb(0.94, 0.65, 0.02)) + 2;
      page.drawText(instructionEnd, { x: instructionX, y: instructionY, size: 7.5, font: regular, color: rgb(0.25, 0.32, 0.42) });

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
