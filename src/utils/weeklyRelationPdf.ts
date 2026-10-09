import { PDFDocument, PDFFont, PDFPage, RGB, StandardFonts, rgb } from 'pdf-lib';
import { Order } from '../types';
import { OfficeEmployee, RecurringExpense } from '../components/WeeklyRelationView';

// ============================================================================
// TYPES
// ============================================================================

export interface OfficialDeliveriesPdfData {
  orders: Order[];
  commissionPercentage: number;
  commissionAmount: number;
  employees: OfficeEmployee[];
  recurringExpenses: RecurringExpense[];
  totalPayout: number;
  subtotalDeliveries: number;
  weekLabel?: string;
}

export interface WeeklySalesPdfData {
  orders: Order[];
  totalSales: number;
  weekLabel?: string;
}

export interface WeeklyDeliveriesDetailPdfData {
  orders: Order[];
  totalCollected: number;
  weekLabel?: string;
}

export interface GeneralRelationPdfData {
  income: number;
  operationalCosts: number;
  netBalance: number;
  commission: number;
  expenses: Array<{
    date: string;
    category: string;
    description: string;
    method: string;
    amount: number;
  }>;
  weekLabel?: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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

/**
 * Truncates text so it fits within maxWidth
 */
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

// ============================================================================
// 1. GENERATE OFFICIAL DELIVERIES PDF (FORMATO OFICIAL ENTREGAS)
// ============================================================================

export const generateOfficialDeliveriesPdf = async (
  data: OfficialDeliveriesPdfData
): Promise<Uint8Array> => {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 612; // US Letter portrait
  const pageHeight = 792;
  const margin = 36;
  const contentWidth = pageWidth - margin * 2; // 540 pt

  // Colors
  const darkNavy = rgb(0.06, 0.09, 0.16); // #0f172a
  const tableHeaderBg = rgb(0.01, 0.52, 0.78); // #0284c7
  const borderGray = rgb(0.80, 0.84, 0.90);
  const zebraBg = rgb(0.97, 0.98, 1.0);
  const subtotalBg = rgb(0.94, 0.96, 0.99);
  const textMuted = rgb(0.35, 0.40, 0.50);
  const textDark = rgb(0.05, 0.08, 0.15);

  // Columns: Total 540
  const cols = [
    { header: 'CLIENTE', width: 110, align: 'left' as const },
    { header: 'AÑO', width: 38, align: 'left' as const },
    { header: 'MARCA', width: 62, align: 'left' as const },
    { header: 'MODELO', width: 75, align: 'left' as const },
    { header: 'TIPO PIEZA', width: 85, align: 'left' as const },
    { header: 'SPECS', width: 100, align: 'left' as const },
    { header: 'PRECIO', width: 70, align: 'right' as const },
  ];

  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const drawHeader = (isFirstPage = true) => {
    if (isFirstPage) {
      // Document Title
      const title = 'Entregas de esta semana';
      const titleSize = 18;
      const titleWidth = bold.widthOfTextAtSize(title, titleSize);
      page.drawText(title, {
        x: (pageWidth - titleWidth) / 2,
        y: y - 10,
        size: titleSize,
        font: bold,
        color: darkNavy,
      });

      if (data.weekLabel) {
        const sub = cleanPdfText(data.weekLabel);
        const subSize = 8.5;
        const subWidth = regular.widthOfTextAtSize(sub, subSize);
        page.drawText(sub, {
          x: (pageWidth - subWidth) / 2,
          y: y - 24,
          size: subSize,
          font: regular,
          color: textMuted,
        });
        y -= 38;
      } else {
        y -= 30;
      }
    } else {
      y -= 10;
    }

    // Table Header Bar
    const headerHeight = 22;
    page.drawRectangle({
      x: margin,
      y: y - headerHeight,
      width: contentWidth,
      height: headerHeight,
      color: tableHeaderBg,
    });

    let currentX = margin;
    cols.forEach((col) => {
      const text = col.header;
      const size = 7.5;
      const textWidth = bold.widthOfTextAtSize(text, size);
      const textX = col.align === 'right'
        ? currentX + col.width - textWidth - 6
        : currentX + 6;

      page.drawText(text, {
        x: textX,
        y: y - 14.5,
        size,
        font: bold,
        color: rgb(1, 1, 1),
      });

      currentX += col.width;
    });

    y -= headerHeight;
  };

  drawHeader(true);

  const rowHeight = 20;

  if (data.orders.length === 0) {
    const emptyHeight = 35;
    page.drawRectangle({
      x: margin,
      y: y - emptyHeight,
      width: contentWidth,
      height: emptyHeight,
      color: rgb(1, 1, 1),
      borderColor: borderGray,
      borderWidth: 0.5,
    });
    const emptyMsg = 'No se registran entregas en esta semana.';
    const emptyWidth = regular.widthOfTextAtSize(emptyMsg, 9);
    page.drawText(emptyMsg, {
      x: (pageWidth - emptyWidth) / 2,
      y: y - 21,
      size: 9,
      font: regular,
      color: textMuted,
    });
    y -= emptyHeight;
  } else {
    data.orders.forEach((order, index) => {
      // Check for page overflow
      if (y - rowHeight < margin + 140) {
        page = pdf.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
        drawHeader(false);
      }

      const rowBg = index % 2 === 1 ? zebraBg : rgb(1, 1, 1);
      page.drawRectangle({
        x: margin,
        y: y - rowHeight,
        width: contentWidth,
        height: rowHeight,
        color: rowBg,
        borderColor: borderGray,
        borderWidth: 0.5,
      });

      const price = order.financials?.total || order.financials?.partPrice || 0;
      const specs = order.productSpecs || `${order.vehicle.trim || ''} ${order.vehicle.transmission || ''}`.trim() || '—';

      const cellValues = [
        { text: fitText(order.customer.name, bold, 7.5, cols[0].width - 12), font: bold, size: 7.5 },
        { text: fitText(String(order.vehicle.year || '—'), regular, 7.5, cols[1].width - 12), font: regular, size: 7.5 },
        { text: fitText(order.vehicle.make, regular, 7.5, cols[2].width - 12), font: regular, size: 7.5 },
        { text: fitText(order.vehicle.model, regular, 7.5, cols[3].width - 12), font: regular, size: 7.5 },
        { text: fitText(order.mainPart, bold, 7.5, cols[4].width - 12), font: bold, size: 7.5 },
        { text: fitText(specs, regular, 7, cols[5].width - 12), font: regular, size: 7 },
        { text: formatMoney(price), font: bold, size: 8 },
      ];

      let cellX = margin;
      cellValues.forEach((cell, colIdx) => {
        const col = cols[colIdx];
        const textWidth = cell.font.widthOfTextAtSize(cell.text, cell.size);
        const textX = col.align === 'right'
          ? cellX + col.width - textWidth - 6
          : cellX + 6;

        page.drawText(cell.text, {
          x: textX,
          y: y - 13.5,
          size: cell.size,
          font: cell.font,
          color: textDark,
        });

        cellX += col.width;
      });

      y -= rowHeight;
    });
  }

  // Subtotal Row
  const subtotalHeight = 22;
  page.drawRectangle({
    x: margin,
    y: y - subtotalHeight,
    width: contentWidth,
    height: subtotalHeight,
    color: subtotalBg,
    borderColor: darkNavy,
    borderWidth: 1,
  });

  const subtotalVal = formatMoney(data.subtotalDeliveries);
  const subtotalValWidth = bold.widthOfTextAtSize(subtotalVal, 9);

  page.drawText(subtotalVal, {
    x: margin + contentWidth - subtotalValWidth - 6,
    y: y - 15,
    size: 9,
    font: bold,
    color: darkNavy,
  });

  y -= subtotalHeight + 16;

  // Check room for Financial Breakdown box (needs ~120pt)
  const breakdownRowsCount = 1 + data.employees.length + data.recurringExpenses.length + 1;
  const breakdownBoxHeight = breakdownRowsCount * 14 + 20;

  if (y - breakdownBoxHeight < margin) {
    page = pdf.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin - 20;
  }

  // Right-aligned Financial Breakdown
  const boxWidth = 220;
  const boxX = margin + contentWidth - boxWidth;
  let lineY = y;

  // 1. Commission 2%
  page.drawText(`Comision (${data.commissionPercentage || 2}%)`, {
    x: boxX,
    y: lineY,
    size: 8.5,
    font: regular,
    color: textDark,
  });
  const commVal = formatMoney(data.commissionAmount);
  const commValWidth = bold.widthOfTextAtSize(commVal, 8.5);
  page.drawText(commVal, {
    x: boxX + boxWidth - commValWidth,
    y: lineY,
    size: 8.5,
    font: bold,
    color: textDark,
  });
  lineY -= 14;

  // 2. Employees (Sorted from highest to lowest salary)
  const sortedEmployees = [...data.employees].sort((a, b) => b.weeklySalary - a.weeklySalary);
  sortedEmployees.forEach((emp) => {
    page.drawText(cleanPdfText(emp.name, 25), {
      x: boxX,
      y: lineY,
      size: 8.5,
      font: regular,
      color: textDark,
    });
    const salaryVal = formatMoney(emp.weeklySalary);
    const salaryValWidth = bold.widthOfTextAtSize(salaryVal, 8.5);
    page.drawText(salaryVal, {
      x: boxX + boxWidth - salaryValWidth,
      y: lineY,
      size: 8.5,
      font: bold,
      color: textDark,
    });
    lineY -= 14;
  });

  // 3. Recurring Expenses (e.g. Alquiler)
  data.recurringExpenses.forEach((rec) => {
    page.drawText(cleanPdfText(rec.name, 25), {
      x: boxX,
      y: lineY,
      size: 8.5,
      font: regular,
      color: textDark,
    });
    const expVal = formatMoney(rec.amount);
    const expValWidth = bold.widthOfTextAtSize(expVal, 8.5);
    page.drawText(expVal, {
      x: boxX + boxWidth - expValWidth,
      y: lineY,
      size: 8.5,
      font: bold,
      color: textDark,
    });
    lineY -= 14;
  });

  // Divider Line
  lineY += 2;
  page.drawLine({
    start: { x: boxX, y: lineY },
    end: { x: boxX + boxWidth, y: lineY },
    thickness: 1.5,
    color: darkNavy,
  });
  lineY -= 14;

  // TOTAL A PAGAR
  const totalLabel = 'TOTAL A PAGAR';
  page.drawText(totalLabel, {
    x: boxX,
    y: lineY,
    size: 10.5,
    font: bold,
    color: darkNavy,
  });
  const totalVal = formatMoney(data.totalPayout);
  const totalValWidth = bold.widthOfTextAtSize(totalVal, 11);
  page.drawText(totalVal, {
    x: boxX + boxWidth - totalValWidth,
    y: lineY,
    size: 11,
    font: bold,
    color: darkNavy,
  });

  return pdf.save();
};

// ============================================================================
// 2. GENERATE WEEKLY SALES PDF (FORMATO VENTAS DE LA SEMANA)
// ============================================================================

export const generateWeeklySalesPdf = async (
  data: WeeklySalesPdfData
): Promise<Uint8Array> => {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 36;
  const contentWidth = pageWidth - margin * 2; // 540 pt

  const darkNavy = rgb(0.06, 0.09, 0.16);
  const tableHeaderBg = rgb(0.06, 0.72, 0.50); // Emerald #10b981
  const borderGray = rgb(0.80, 0.84, 0.90);
  const zebraBg = rgb(0.96, 0.99, 0.98);
  const subtotalBg = rgb(0.93, 0.98, 0.95);
  const textMuted = rgb(0.35, 0.40, 0.50);
  const textDark = rgb(0.05, 0.08, 0.15);

  const cols = [
    { header: 'CLIENTE', width: 110, align: 'left' as const },
    { header: 'AÑO', width: 38, align: 'left' as const },
    { header: 'MARCA', width: 62, align: 'left' as const },
    { header: 'MODELO', width: 75, align: 'left' as const },
    { header: 'TIPO PIEZA', width: 85, align: 'left' as const },
    { header: 'SPECS', width: 100, align: 'left' as const },
    { header: 'MONTO', width: 70, align: 'right' as const },
  ];

  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const drawHeader = (isFirstPage = true) => {
    if (isFirstPage) {
      const title = 'VENTAS DE LA SEMANA';
      const titleSize = 18;
      const titleWidth = bold.widthOfTextAtSize(title, titleSize);
      page.drawText(title, {
        x: (pageWidth - titleWidth) / 2,
        y: y - 10,
        size: titleSize,
        font: bold,
        color: darkNavy,
      });

      const sub = data.weekLabel || `Semana Actual · ${data.orders.length} ventas`;
      const subSize = 8.5;
      const subWidth = regular.widthOfTextAtSize(sub, subSize);
      page.drawText(sub, {
        x: (pageWidth - subWidth) / 2,
        y: y - 24,
        size: subSize,
        font: regular,
        color: textMuted,
      });
      y -= 38;
    } else {
      y -= 10;
    }

    const headerHeight = 22;
    page.drawRectangle({
      x: margin,
      y: y - headerHeight,
      width: contentWidth,
      height: headerHeight,
      color: tableHeaderBg,
    });

    let currentX = margin;
    cols.forEach((col) => {
      const text = col.header;
      const size = 7.5;
      const textWidth = bold.widthOfTextAtSize(text, size);
      const textX = col.align === 'right'
        ? currentX + col.width - textWidth - 6
        : currentX + 6;

      page.drawText(text, {
        x: textX,
        y: y - 14.5,
        size,
        font: bold,
        color: rgb(1, 1, 1),
      });

      currentX += col.width;
    });

    y -= headerHeight;
  };

  drawHeader(true);

  const rowHeight = 20;

  if (data.orders.length === 0) {
    const emptyHeight = 35;
    page.drawRectangle({
      x: margin,
      y: y - emptyHeight,
      width: contentWidth,
      height: emptyHeight,
      color: rgb(1, 1, 1),
      borderColor: borderGray,
      borderWidth: 0.5,
    });
    const emptyMsg = 'No se registran ventas en el rango de la semana actual.';
    const emptyWidth = regular.widthOfTextAtSize(emptyMsg, 9);
    page.drawText(emptyMsg, {
      x: (pageWidth - emptyWidth) / 2,
      y: y - 21,
      size: 9,
      font: regular,
      color: textMuted,
    });
    y -= emptyHeight;
  } else {
    data.orders.forEach((order, index) => {
      if (y - rowHeight < margin + 50) {
        page = pdf.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
        drawHeader(false);
      }

      const rowBg = index % 2 === 1 ? zebraBg : rgb(1, 1, 1);
      page.drawRectangle({
        x: margin,
        y: y - rowHeight,
        width: contentWidth,
        height: rowHeight,
        color: rowBg,
        borderColor: borderGray,
        borderWidth: 0.5,
      });

      const amount = order.financials?.total || order.financials?.partPrice || 0;
      const specs = order.productSpecs || `${order.vehicle.trim || ''} ${order.vehicle.transmission || ''}`.trim() || '—';

      const cellValues = [
        { text: fitText(order.customer.name, bold, 7.5, cols[0].width - 12), font: bold, size: 7.5 },
        { text: fitText(String(order.vehicle.year || '—'), regular, 7.5, cols[1].width - 12), font: regular, size: 7.5 },
        { text: fitText(order.vehicle.make, regular, 7.5, cols[2].width - 12), font: regular, size: 7.5 },
        { text: fitText(order.vehicle.model, regular, 7.5, cols[3].width - 12), font: regular, size: 7.5 },
        { text: fitText(order.mainPart, bold, 7.5, cols[4].width - 12), font: bold, size: 7.5 },
        { text: fitText(specs, regular, 7, cols[5].width - 12), font: regular, size: 7 },
        { text: formatMoney(amount), font: bold, size: 8 },
      ];

      let cellX = margin;
      cellValues.forEach((cell, colIdx) => {
        const col = cols[colIdx];
        const textWidth = cell.font.widthOfTextAtSize(cell.text, cell.size);
        const textX = col.align === 'right'
          ? cellX + col.width - textWidth - 6
          : cellX + 6;

        page.drawText(cell.text, {
          x: textX,
          y: y - 13.5,
          size: cell.size,
          font: cell.font,
          color: textDark,
        });

        cellX += col.width;
      });

      y -= rowHeight;
    });
  }

  // Subtotal Row
  const subtotalHeight = 22;
  page.drawRectangle({
    x: margin,
    y: y - subtotalHeight,
    width: contentWidth,
    height: subtotalHeight,
    color: subtotalBg,
    borderColor: tableHeaderBg,
    borderWidth: 1,
  });

  const subtotalLabel = 'SUBTOTAL VENTAS:';
  page.drawText(subtotalLabel, {
    x: margin + 12,
    y: y - 15,
    size: 8.5,
    font: bold,
    color: darkNavy,
  });

  const subtotalVal = formatMoney(data.totalSales);
  const subtotalValWidth = bold.widthOfTextAtSize(subtotalVal, 9.5);
  page.drawText(subtotalVal, {
    x: margin + contentWidth - subtotalValWidth - 6,
    y: y - 15,
    size: 9.5,
    font: bold,
    color: rgb(0.04, 0.58, 0.40),
  });

  return pdf.save();
};

// ============================================================================
// 3. GENERATE GENERAL RELATION PDF (RELACIÓN GENERAL Y BALANCE)
// ============================================================================

export const generateGeneralRelationPdf = async (
  data: GeneralRelationPdfData
): Promise<Uint8Array> => {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 36;
  const contentWidth = pageWidth - margin * 2;

  const darkNavy = rgb(0.06, 0.09, 0.16);
  const tableHeaderBg = rgb(0.92, 0.60, 0.06); // Amber #f59e0b
  const borderGray = rgb(0.80, 0.84, 0.90);
  const zebraBg = rgb(0.99, 0.98, 0.96);
  const textMuted = rgb(0.35, 0.40, 0.50);
  const textDark = rgb(0.05, 0.08, 0.15);

  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  // Title
  const title = 'Relación General de Entregas y Gastos';
  const titleSize = 17;
  const titleWidth = bold.widthOfTextAtSize(title, titleSize);
  page.drawText(title, {
    x: (pageWidth - titleWidth) / 2,
    y: y - 10,
    size: titleSize,
    font: bold,
    color: darkNavy,
  });

  const sub = data.weekLabel || 'Control de Balance Operativo Semanal';
  const subSize = 8.5;
  const subWidth = regular.widthOfTextAtSize(sub, subSize);
  page.drawText(sub, {
    x: (pageWidth - subWidth) / 2,
    y: y - 24,
    size: subSize,
    font: regular,
    color: textMuted,
  });
  y -= 40;

  // 3 KPI Boxes in 1 Row
  const kpiWidth = (contentWidth - 16) / 3;
  const kpiHeight = 44;

  // KPI 1: Ingresos
  page.drawRectangle({
    x: margin,
    y: y - kpiHeight,
    width: kpiWidth,
    height: kpiHeight,
    color: rgb(0.95, 0.99, 0.96),
    borderColor: rgb(0.65, 0.90, 0.75),
    borderWidth: 0.8,
  });
  page.drawText('INGRESOS POR ENTREGAS', {
    x: margin + 8,
    y: y - 14,
    size: 7,
    font: bold,
    color: rgb(0.04, 0.58, 0.40),
  });
  page.drawText(formatMoney(data.income), {
    x: margin + 8,
    y: y - 32,
    size: 13,
    font: bold,
    color: rgb(0.04, 0.58, 0.40),
  });

  // KPI 2: Gastos
  const kpi2X = margin + kpiWidth + 8;
  page.drawRectangle({
    x: kpi2X,
    y: y - kpiHeight,
    width: kpiWidth,
    height: kpiHeight,
    color: rgb(0.99, 0.95, 0.95),
    borderColor: rgb(0.95, 0.70, 0.70),
    borderWidth: 0.8,
  });
  page.drawText('GASTOS + COMISIONES', {
    x: kpi2X + 8,
    y: y - 14,
    size: 7,
    font: bold,
    color: rgb(0.85, 0.15, 0.15),
  });
  page.drawText(formatMoney(data.operationalCosts), {
    x: kpi2X + 8,
    y: y - 32,
    size: 13,
    font: bold,
    color: rgb(0.85, 0.15, 0.15),
  });

  // KPI 3: Balance
  const kpi3X = kpi2X + kpiWidth + 8;
  const isPositive = data.netBalance >= 0;
  page.drawRectangle({
    x: kpi3X,
    y: y - kpiHeight,
    width: kpiWidth,
    height: kpiHeight,
    color: isPositive ? rgb(0.95, 0.99, 0.96) : rgb(0.99, 0.95, 0.95),
    borderColor: isPositive ? rgb(0.65, 0.90, 0.75) : rgb(0.95, 0.70, 0.70),
    borderWidth: 0.8,
  });
  page.drawText('BALANCE NETO SEMANAL', {
    x: kpi3X + 8,
    y: y - 14,
    size: 7,
    font: bold,
    color: isPositive ? rgb(0.04, 0.58, 0.40) : rgb(0.85, 0.15, 0.15),
  });
  page.drawText(formatMoney(data.netBalance), {
    x: kpi3X + 8,
    y: y - 32,
    size: 13,
    font: bold,
    color: isPositive ? rgb(0.04, 0.58, 0.40) : rgb(0.85, 0.15, 0.15),
  });

  y -= kpiHeight + 16;

  // Expenses Breakdown Table
  const cols = [
    { header: 'FECHA', width: 70, align: 'left' as const },
    { header: 'CATEGORÍA', width: 120, align: 'left' as const },
    { header: 'DESCRIPCIÓN / CONCEPTO', width: 190, align: 'left' as const },
    { header: 'MÉTODO', width: 80, align: 'left' as const },
    { header: 'MONTO', width: 80, align: 'right' as const },
  ];

  const headerHeight = 22;
  page.drawRectangle({
    x: margin,
    y: y - headerHeight,
    width: contentWidth,
    height: headerHeight,
    color: tableHeaderBg,
  });

  let currentX = margin;
  cols.forEach((col) => {
    const text = col.header;
    const size = 7.5;
    const textWidth = bold.widthOfTextAtSize(text, size);
    const textX = col.align === 'right'
      ? currentX + col.width - textWidth - 6
      : currentX + 6;

    page.drawText(text, {
      x: textX,
      y: y - 14.5,
      size,
      font: bold,
      color: rgb(1, 1, 1),
    });

    currentX += col.width;
  });

  y -= headerHeight;

  const rowHeight = 20;

  data.expenses.forEach((item, index) => {
    if (y - rowHeight < margin + 40) {
      page = pdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin - 20;
    }

    const rowBg = index % 2 === 1 ? zebraBg : rgb(1, 1, 1);
    page.drawRectangle({
      x: margin,
      y: y - rowHeight,
      width: contentWidth,
      height: rowHeight,
      color: rowBg,
      borderColor: borderGray,
      borderWidth: 0.5,
    });

    const cellValues = [
      { text: fitText(item.date, regular, 7.5, cols[0].width - 12), font: regular, size: 7.5 },
      { text: fitText(item.category, bold, 7.5, cols[1].width - 12), font: bold, size: 7.5 },
      { text: fitText(item.description, regular, 7.5, cols[2].width - 12), font: regular, size: 7.5 },
      { text: fitText(item.method, regular, 7.5, cols[3].width - 12), font: regular, size: 7.5 },
      { text: `-${formatMoney(item.amount)}`, font: bold, size: 8 },
    ];

    let cellX = margin;
    cellValues.forEach((cell, colIdx) => {
      const col = cols[colIdx];
      const textWidth = cell.font.widthOfTextAtSize(cell.text, cell.size);
      const textX = col.align === 'right'
        ? cellX + col.width - textWidth - 6
        : cellX + 6;

      page.drawText(cell.text, {
        x: textX,
        y: y - 13.5,
        size: cell.size,
        font: cell.font,
        color: colIdx === 4 ? rgb(0.85, 0.15, 0.15) : textDark,
      });

      cellX += col.width;
    });

    y -= rowHeight;
  });

  // Footer Total Egresos
  const totalHeight = 22;
  page.drawRectangle({
    x: margin,
    y: y - totalHeight,
    width: contentWidth,
    height: totalHeight,
    color: rgb(0.99, 0.95, 0.95),
    borderColor: rgb(0.85, 0.15, 0.15),
    borderWidth: 1,
  });

  page.drawText('TOTAL EGRESOS OFICINA + COMISIONES:', {
    x: margin + 12,
    y: y - 15,
    size: 8.5,
    font: bold,
    color: darkNavy,
  });

  const totalEgVal = `-${formatMoney(data.operationalCosts)}`;
  const totalEgValWidth = bold.widthOfTextAtSize(totalEgVal, 9.5);
  page.drawText(totalEgVal, {
    x: margin + contentWidth - totalEgValWidth - 6,
    y: y - 15,
    size: 9.5,
    font: bold,
    color: rgb(0.85, 0.15, 0.15),
  });

  return pdf.save();
};

// ============================================================================
// BROWSER DOWNLOAD HELPER
// ============================================================================

export const downloadPdfBytes = (bytes: Uint8Array, filename: string): void => {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
