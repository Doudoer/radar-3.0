import { PDFDocument, PDFFont, PDFPage, RGB, StandardFonts, rgb } from 'pdf-lib';
import { Order } from '../types';

export interface OrdersReportPdfData {
  orders: Order[];
  statusFilterLabel?: string;
  dateRangeLabel?: string;
  totalOrders: number;
  totalAmount: number;
}

const cleanPdfText = (val: string | null | undefined, maxLen = 80): string => {
  if (!val) return '—';
  return String(val)
    .replace(/[–—]/g, '-')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/[^\x20-\x7EÀ-ÿ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
};

const formatMoney = (amount: number): string => {
  return `$ ${Number(amount || 0).toFixed(2)}`;
};

const fitText = (
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string => {
  const cleaned = cleanPdfText(text);
  if (font.widthOfTextAtSize(cleaned, size) <= maxWidth) {
    return cleaned;
  }
  let current = cleaned;
  while (current.length > 0 && font.widthOfTextAtSize(`${current}...`, size) > maxWidth) {
    current = current.slice(0, -1);
  }
  return current ? `${current}...` : '—';
};

const STATUS_DISPLAY: Record<string, string> = {
  cotizacion: 'Cotización',
  espera_confirmacion: 'En espera confirmación',
  pagado: 'Pagado',
  en_preparacion: 'En preparación',
  listo_despacho: 'Listo para despacho',
  listo_retiro: 'Listo para retiro',
  en_camino: 'En camino',
  entregado: 'Entregado',
  reclamo: 'Reclamo',
  cancelado: 'Cancelado',
  solicitud_reembolso: 'Solicitud reembolso',
  reembolsado: 'Reembolsado',
  archivado: 'Archivado',
};

/**
 * Generates a high-quality multi-page PDF Report of Orders (Landscape US Letter)
 */
export const generateOrdersReportPdf = async (
  data: OrdersReportPdfData
): Promise<Uint8Array> => {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 792; // US Letter landscape
  const pageHeight = 612;
  const margin = 32;
  const contentWidth = pageWidth - margin * 2; // 728 pt

  // Colors
  const darkNavy: RGB = rgb(0.04, 0.09, 0.18);
  const cyanBlue: RGB = rgb(0.08, 0.45, 0.75);
  const lightBg: RGB = rgb(0.96, 0.98, 1.0);
  const altRowBg: RGB = rgb(0.98, 0.99, 1.0);
  const borderColor: RGB = rgb(0.85, 0.9, 0.95);
  const textDark: RGB = rgb(0.12, 0.15, 0.2);
  const textMuted: RGB = rgb(0.4, 0.45, 0.52);

  const tableCols = [
    { label: 'CÓDIGO', width: 75, align: 'left' as const },
    { label: 'FECHA', width: 65, align: 'left' as const },
    { label: 'CLIENTE', width: 130, align: 'left' as const },
    { label: 'VEHÍCULO', width: 125, align: 'left' as const },
    { label: 'REFACCIÓN', width: 135, align: 'left' as const },
    { label: 'ESTATUS', width: 105, align: 'center' as const },
    { label: 'TOTAL', width: 93, align: 'right' as const },
  ];

  let pages: PDFPage[] = [];
  let currentPage: PDFPage = pdf.addPage([pageWidth, pageHeight]);
  pages.push(currentPage);

  let y = pageHeight - margin;

  const drawHeader = (page: PDFPage, isFirstPage: boolean) => {
    // Top banner
    page.drawRectangle({
      x: margin,
      y: pageHeight - margin - 32,
      width: contentWidth,
      height: 32,
      color: darkNavy,
    });

    page.drawText('RADAR 3.0  |  REPORTE CONSOLIDADO DE ÓRDENES', {
      x: margin + 12,
      y: pageHeight - margin - 21,
      size: 11,
      font: bold,
      color: rgb(1, 1, 1),
    });

    const printDateStr = `Emisión: ${new Date().toLocaleDateString('es-ES')} ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
    const printDateWidth = regular.widthOfTextAtSize(printDateStr, 8);
    page.drawText(printDateStr, {
      x: margin + contentWidth - printDateWidth - 12,
      y: pageHeight - margin - 20,
      size: 8,
      font: regular,
      color: rgb(0.8, 0.88, 0.96),
    });

    if (isFirstPage) {
      // Summary metadata card
      const summaryCardHeight = 44;
      const summaryY = pageHeight - margin - 32 - summaryCardHeight - 6;

      page.drawRectangle({
        x: margin,
        y: summaryY,
        width: contentWidth,
        height: summaryCardHeight,
        color: lightBg,
        borderColor: borderColor,
        borderWidth: 1,
      });

      // Filter Status
      page.drawText('ESTATUS SELECCIONADO:', {
        x: margin + 12,
        y: summaryY + 28,
        size: 7.5,
        font: bold,
        color: textMuted,
      });
      page.drawText(cleanPdfText(data.statusFilterLabel || 'Todos los Estatus', 30), {
        x: margin + 12,
        y: summaryY + 12,
        size: 9.5,
        font: bold,
        color: cyanBlue,
      });

      // Date Range
      page.drawText('RANGO DE FECHAS:', {
        x: margin + 200,
        y: summaryY + 28,
        size: 7.5,
        font: bold,
        color: textMuted,
      });
      page.drawText(cleanPdfText(data.dateRangeLabel || 'Histórico Completo', 35), {
        x: margin + 200,
        y: summaryY + 12,
        size: 9.5,
        font: regular,
        color: textDark,
      });

      // Total Orders
      page.drawText('TOTAL ÓRDENES:', {
        x: margin + 420,
        y: summaryY + 28,
        size: 7.5,
        font: bold,
        color: textMuted,
      });
      page.drawText(`${data.totalOrders} órdenes`, {
        x: margin + 420,
        y: summaryY + 12,
        size: 9.5,
        font: bold,
        color: darkNavy,
      });

      // Total Amount
      page.drawText('TOTAL FACTURADO:', {
        x: margin + 570,
        y: summaryY + 28,
        size: 7.5,
        font: bold,
        color: textMuted,
      });
      page.drawText(formatMoney(data.totalAmount), {
        x: margin + 570,
        y: summaryY + 12,
        size: 10,
        font: bold,
        color: rgb(0.05, 0.6, 0.35),
      });

      y = summaryY - 12;
    } else {
      y = pageHeight - margin - 42;
    }

    // Table Header Row
    const headerHeight = 20;
    page.drawRectangle({
      x: margin,
      y: y - headerHeight,
      width: contentWidth,
      height: headerHeight,
      color: rgb(0.9, 0.94, 0.98),
      borderColor: borderColor,
      borderWidth: 0.5,
    });

    let hX = margin;
    tableCols.forEach((col) => {
      const textWidth = bold.widthOfTextAtSize(col.label, 8);
      const textX = col.align === 'right'
        ? hX + col.width - textWidth - 6
        : col.align === 'center'
        ? hX + (col.width - textWidth) / 2
        : hX + 6;

      page.drawText(col.label, {
        x: textX,
        y: y - 13.5,
        size: 8,
        font: bold,
        color: darkNavy,
      });

      hX += col.width;
    });

    y -= headerHeight;
  };

  // Draw first page header
  drawHeader(currentPage, true);

  // Draw Order Rows
  const rowHeight = 18;
  const bottomMarginLimit = margin + 35; // leave room for summary / page number

  data.orders.forEach((order, idx) => {
    // Check if new page is needed
    if (y - rowHeight < bottomMarginLimit) {
      currentPage = pdf.addPage([pageWidth, pageHeight]);
      pages.push(currentPage);
      drawHeader(currentPage, false);
    }

    const isEven = idx % 2 === 0;
    currentPage.drawRectangle({
      x: margin,
      y: y - rowHeight,
      width: contentWidth,
      height: rowHeight,
      color: isEven ? rgb(1, 1, 1) : altRowBg,
      borderColor: borderColor,
      borderWidth: 0.5,
    });

    const totalVal = order.financials?.total ?? order.financials?.partPrice ?? 0;
    const clientName = order.customer?.name || '—';
    const vehicleStr = `${order.vehicle?.year || ''} ${order.vehicle?.make || ''} ${order.vehicle?.model || ''}`.trim() || '—';
    const partStr = order.mainPart || order.productSpecs || '—';
    const statusStr = STATUS_DISPLAY[order.status] || order.status;

    const rowCells = [
      { text: cleanPdfText(order.code || order.id, 16), width: 75, align: 'left' as const, isBold: true },
      { text: cleanPdfText(order.createdAt || '', 12), width: 65, align: 'left' as const, isBold: false },
      { text: fitText(clientName, regular, 7.5, 118), width: 130, align: 'left' as const, isBold: false },
      { text: fitText(vehicleStr, regular, 7.5, 115), width: 125, align: 'left' as const, isBold: false },
      { text: fitText(partStr, regular, 7.5, 125), width: 135, align: 'left' as const, isBold: false },
      { text: fitText(statusStr, bold, 7, 95), width: 105, align: 'center' as const, isBold: true, isStatus: true, status: order.status },
      { text: formatMoney(totalVal), width: 93, align: 'right' as const, isBold: true },
    ];

    let cX = margin;
    rowCells.forEach((cell) => {
      const font = cell.isBold ? bold : regular;
      const fontSize = 7.5;
      const textWidth = font.widthOfTextAtSize(cell.text, fontSize);
      const textX = cell.align === 'right'
        ? cX + cell.width - textWidth - 6
        : cell.align === 'center'
        ? cX + (cell.width - textWidth) / 2
        : cX + 6;

      let textColor = textDark;
      if (cell.align === 'right') textColor = darkNavy;
      if (cell.isStatus) {
        if (cell.status === 'entregado' || cell.status === 'pagado') textColor = rgb(0.05, 0.55, 0.3);
        else if (cell.status === 'cancelado' || cell.status === 'reclamo') textColor = rgb(0.8, 0.15, 0.15);
        else textColor = cyanBlue;
      }

      currentPage.drawText(cell.text, {
        x: textX,
        y: y - 12.5,
        size: fontSize,
        font: font,
        color: textColor,
      });

      cX += cell.width;
    });

    y -= rowHeight;
  });

  // Check if we need space for final total row
  if (data.orders.length > 0) {
    if (y - 22 < margin + 25) {
      currentPage = pdf.addPage([pageWidth, pageHeight]);
      pages.push(currentPage);
      drawHeader(currentPage, false);
    }

    // Grand Total Row
    const totalRowHeight = 22;
    currentPage.drawRectangle({
      x: margin,
      y: y - totalRowHeight,
      width: contentWidth,
      height: totalRowHeight,
      color: rgb(0.92, 0.96, 1.0),
      borderColor: cyanBlue,
      borderWidth: 1,
    });

    currentPage.drawText(`TOTAL GENERAL (${data.totalOrders} ÓRDENES):`, {
      x: margin + 12,
      y: y - 15,
      size: 8.5,
      font: bold,
      color: darkNavy,
    });

    const grandTotalStr = formatMoney(data.totalAmount);
    const grandTotalWidth = bold.widthOfTextAtSize(grandTotalStr, 10);
    currentPage.drawText(grandTotalStr, {
      x: margin + contentWidth - grandTotalWidth - 6,
      y: y - 15,
      size: 10,
      font: bold,
      color: rgb(0.05, 0.6, 0.35),
    });
  } else {
    // Empty state
    currentPage.drawText('No se encontraron órdenes para el estatus y rango de fechas seleccionado.', {
      x: margin + 20,
      y: y - 25,
      size: 9,
      font: regular,
      color: textMuted,
    });
  }

  // Draw Page Numbers on all pages
  const totalPagesCount = pages.length;
  pages.forEach((pg, pageIndex) => {
    const pageNumStr = `Página ${pageIndex + 1} de ${totalPagesCount}`;
    const pWidth = regular.widthOfTextAtSize(pageNumStr, 8);
    pg.drawText(pageNumStr, {
      x: margin + contentWidth - pWidth,
      y: margin - 14 > 10 ? margin - 14 : 15,
      size: 8,
      font: regular,
      color: textMuted,
    });

    pg.drawText('RADAR 3.0  -  Sistema de Gestión y Seguimiento Operativo', {
      x: margin,
      y: margin - 14 > 10 ? margin - 14 : 15,
      size: 7.5,
      font: regular,
      color: textMuted,
    });
  });

  return pdf.save();
};
