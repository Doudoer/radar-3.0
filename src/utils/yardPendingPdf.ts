import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { Order } from '../types';
import { expandYearRangesInText } from './compatibilityFormat';

const isYardPendingOrder = (order: Order): boolean =>
  order.status === 'pagado' && !order.yardPieceReady;

const cleanPdfText = (val: string | null | undefined, maxLen = 900): string => {
  if (!val) return '-';
  return String(val)
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\r?\n+/g, ' ')
    .replace(/[^\x20-\x7EÀ-ÿ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen) || '-';
};

const formatCompatibilityBullets = (raw: string | null | undefined): string => {
  if (!raw || !raw.trim()) return '-';
  const expanded = expandYearRangesInText(raw)
    .replace(/^compatibilidad\s*:?\s*/i, '')
    .replace(/[^\x20-\x7EÀ-ÿ\n]/g, '')
    .trim();
  const segments = expanded
    .split(/\s*\*\s*|\r?\n+/)
    .map((s) => s.replace(/\.$/, '').trim())
    .filter(Boolean);
  if (!segments.length) return '-';
  return segments.map((seg) => `- ${seg}`).join('\n');
};

const wrapText = (
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
  maxLines = 8,
): string[] => {
  const rawParagraphs = String(text || '').split(/\r?\n/);
  const lines: string[] = [];

  for (const para of rawParagraphs) {
    const cleaned = cleanPdfText(para, 900);
    if (cleaned === '-' && rawParagraphs.length > 1) continue;
    if (cleaned === '-') return ['-'];
    const words = cleaned.split(' ');
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current) {
          lines.push(current);
          if (lines.length >= maxLines) return lines;
        }
        let trimmed = word;
        while (trimmed.length > 1 && font.widthOfTextAtSize(`${trimmed}...`, size) > maxWidth) {
          trimmed = trimmed.slice(0, -1);
        }
        current = trimmed === word ? word : `${trimmed}...`;
      }
    }
    if (current) {
      lines.push(current);
      if (lines.length >= maxLines) return lines;
    }
  }
  return lines.length ? lines : ['-'];
};

export const sortYardPendingOrdersFifo = (orders: Order[]): Order[] =>
  orders
    .filter(isYardPendingOrder)
    .sort((a, b) => {
      const aTime = Date.parse(a.paidAtIso || a.createdAtIso || '');
      const bTime = Date.parse(b.paidAtIso || b.createdAtIso || '');
      return (Number.isFinite(aTime) ? aTime : 0) - (Number.isFinite(bTime) ? bTime : 0);
    });

export const generateYardPendingPdf = async (
  orders: Order[],
  generatedBy?: string,
): Promise<Uint8Array> => {
  const pending = sortYardPendingOrdersFifo(orders);
  const doc = await PDFDocument.create();
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Letter Landscape (792 x 612) -> contentWidth = 728
  const pageWidth = 792;
  const pageHeight = 612;
  const marginX = 32;
  const contentWidth = pageWidth - marginX * 2;
  const bottomLimit = 44;

  const cols = [
    { key: 'idx', label: 'LISTO / #', width: 42 },
    { key: 'code', label: 'ORDEN', width: 74 },
    { key: 'year', label: 'AÑO', width: 34 },
    { key: 'make', label: 'MARCA', width: 66 },
    { key: 'model', label: 'MODELO', width: 80 },
    { key: 'part', label: 'TIPO DE PIEZA', width: 86 },
    { key: 'desc', label: 'DESCRIPCIÓN', width: 151 },
    { key: 'compat', label: 'COMPATIBILIDAD', width: 195 },
  ];

  const drawHeader = (page: PDFPage, isFirstPage: boolean): number => {
    let y = pageHeight - 36;
    if (isFirstPage) {
      page.drawRectangle({
        x: marginX,
        y: y - 34,
        width: contentWidth,
        height: 44,
        color: rgb(0.06, 0.09, 0.16),
      });
      page.drawText('RADAR · PATIO / YARD', {
        x: marginX + 12,
        y: y - 4,
        size: 8,
        font: fontBold,
        color: rgb(0.22, 0.74, 0.97),
      });
      page.drawText('LISTA DE PIEZAS PENDIENTES POR PREPARAR', {
        x: marginX + 12,
        y: y - 21,
        size: 13,
        font: fontBold,
        color: rgb(1, 1, 1),
      });
      const totalLabel = `Total pendientes: ${pending.length}`;
      const totalWidth = fontBold.widthOfTextAtSize(totalLabel, 10);
      page.drawText(totalLabel, {
        x: marginX + contentWidth - totalWidth - 12,
        y: y - 14,
        size: 10,
        font: fontBold,
        color: rgb(0.98, 0.75, 0.14),
      });

      const meta = `Generado: ${new Date().toLocaleString('es-VE')}${generatedBy ? ` · Por: ${cleanPdfText(generatedBy, 32)}` : ''} · Orden FIFO (mas antiguo primero)`;
      page.drawText(meta, {
        x: marginX,
        y: y - 48,
        size: 8,
        font: fontRegular,
        color: rgb(0.35, 0.4, 0.48),
      });
      y -= 62;
    } else {
      page.drawText('RADAR · Lista de Piezas Pendientes en Patio (continuacion)', {
        x: marginX,
        y,
        size: 10,
        font: fontBold,
        color: rgb(0.15, 0.2, 0.3),
      });
      y -= 18;
    }

    page.drawRectangle({
      x: marginX,
      y: y - 18,
      width: contentWidth,
      height: 20,
      color: rgb(0.93, 0.95, 0.98),
      borderColor: rgb(0.8, 0.84, 0.9),
      borderWidth: 0.5,
    });
    let cursorX = marginX + 5;
    for (const col of cols) {
      page.drawText(col.label, {
        x: cursorX,
        y: y - 11,
        size: 7,
        font: fontBold,
        color: rgb(0.25, 0.3, 0.4),
      });
      cursorX += col.width;
    }
    return y - 22;
  };

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = drawHeader(page, true);

  if (pending.length === 0) {
    page.drawText('No hay piezas pendientes en patio en este momento.', {
      x: marginX + 12,
      y: y - 24,
      size: 10,
      font: fontRegular,
      color: rgb(0.35, 0.4, 0.48),
    });
  } else {
    const lineHeight = 10.5;
    pending.forEach((order, index) => {
      const yearStr = order.vehicle?.year ? String(order.vehicle.year) : '-';
      const makeStr = order.vehicle?.make || '-';
      const modelStr = order.vehicle?.model || '-';
      const partStr = order.mainPart || '-';
      const descStr = order.productSpecs || (order.stockNumber ? `Stock: ${order.stockNumber}` : '-');
      const compatRaw = formatCompatibilityBullets(order.yardCompatibility?.compatibilityList);

      const cellTexts = [
        `[ ] ${index + 1}`,
        order.code || `#${order.id}`,
        yearStr,
        makeStr,
        modelStr,
        partStr,
        descStr,
        compatRaw,
      ];

      const wrappedCells = cellTexts.map((txt, colIdx) => {
        const col = cols[colIdx];
        const font = colIdx === 1 || colIdx === 5 ? fontBold : fontRegular;
        const size = colIdx === 0 || colIdx === 1 || colIdx === 7 ? 7.5 : 8;
        const maxLines = colIdx === 7 ? 10 : colIdx === 6 ? 5 : 2;
        return wrapText(txt, font, size, col.width - 8, maxLines);
      });

      const maxLinesInRow = Math.max(...wrappedCells.map((lines) => lines.length));
      const rowHeight = Math.max(24, maxLinesInRow * lineHeight + 10);

      if (y - rowHeight < bottomLimit) {
        page = doc.addPage([pageWidth, pageHeight]);
        y = drawHeader(page, false);
      }

      if (index % 2 === 1) {
        page.drawRectangle({
          x: marginX,
          y: y - rowHeight + 4,
          width: contentWidth,
          height: rowHeight,
          color: rgb(0.98, 0.99, 1),
        });
      }

      page.drawLine({
        start: { x: marginX, y: y - rowHeight + 4 },
        end: { x: marginX + contentWidth, y: y - rowHeight + 4 },
        thickness: 0.4,
        color: rgb(0.86, 0.89, 0.93),
      });

      let cursorX = marginX + 5;
      wrappedCells.forEach((lines, colIdx) => {
        const col = cols[colIdx];
        const font = colIdx === 1 || colIdx === 5 ? fontBold : fontRegular;
        const size = colIdx === 0 || colIdx === 1 || colIdx === 7 ? 7.5 : 8;
        lines.forEach((line, lineIdx) => {
          page.drawText(line, {
            x: cursorX,
            y: y - 11 - lineIdx * lineHeight,
            size,
            font,
            color: rgb(0.12, 0.16, 0.24),
          });
        });
        cursorX += col.width;
      });

      y -= rowHeight;
    });
  }

  const pages = doc.getPages();
  pages.forEach((p, idx) => {
    const footerText = `Pagina ${idx + 1} de ${pages.length}`;
    const width = fontRegular.widthOfTextAtSize(footerText, 8);
    p.drawText(footerText, {
      x: pageWidth - marginX - width,
      y: 22,
      size: 8,
      font: fontRegular,
      color: rgb(0.45, 0.5, 0.58),
    });
  });

  return doc.save();
};

export const downloadYardPendingPdf = async (
  orders: Order[],
  generatedBy?: string,
): Promise<void> => {
  const bytes = await generateYardPendingPdf(orders, generatedBy);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const objectUrl = URL.createObjectURL(blob);
  const dateTag = new Date().toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = `yard-piezas-pendientes-${dateTag}.pdf`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 15_000);
};
