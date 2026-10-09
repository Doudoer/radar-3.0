import { describe, expect, it } from 'vitest';
import {
  generateOfficialDeliveriesPdf,
  generateWeeklySalesPdf,
  generateGeneralRelationPdf,
} from '../src/utils/weeklyRelationPdf';
import { Order } from '../src/types';
import { OfficeEmployee, RecurringExpense } from '../src/components/WeeklyRelationView';

const mockOrder = (id: string, customer: string, part: string, total: number): Order => ({
  id,
  code: `ORD-${id}`,
  createdAt: '2026-10-08T10:00:00Z',
  advisor: 'Douglas',
  status: 'entregado',
  mainPart: part,
  productSpecs: '5.0L V8 4x4 Automatic OEM',
  workflowStep: 4,
  customer: {
    id: `CUST-${id}`,
    name: customer,
    phone: '+1 555-0199',
    type: 'Particular',
    email: 'client@example.com',
    location: 'Miami, FL',
    initials: 'JP',
  },
  vehicle: {
    vin: '1FTFW1ED8JFA12345',
    plate: 'FL-9921',
    year: 2018,
    make: 'Ford',
    model: 'F-150',
    trim: 'XLT',
    transmission: 'Automatic',
    mileage: '45,000 mi',
    color: 'Oxford White',
  },
  deliveryType: 'envio_domicilio',
  financials: {
    partPrice: total,
    subtotal: total,
    total,
    downPayment: total * 0.5,
  },
});

const mockEmployees: OfficeEmployee[] = [
  { id: 'EMP-1', name: 'Douglas', weeklySalary: 150.0, role: 'Supervisor' },
  { id: 'EMP-2', name: 'Favio', weeklySalary: 120.0, role: 'Asesor Comercial' },
  { id: 'EMP-3', name: 'Williana', weeklySalary: 90.0, role: 'Asesor Peddle' },
  { id: 'EMP-4', name: 'Maggie', weeklySalary: 75.0, role: 'Asesor Wheelzy' },
];

const mockRecurringExpenses: RecurringExpense[] = [
  {
    id: 'REC-1',
    name: 'Alquiler de Local y Oficina',
    category: 'Alquiler de Oficina / Patio',
    amount: 150.0,
    frequency: 'monthly',
    monthlyDay: 30,
    advanceIfWeekend: true,
    active: true,
    paymentMethod: 'Transferencia',
  },
];

describe('Weekly Relation PDF Generator (pdf-lib standalone)', () => {
  it('generates a valid Formato Oficial de Entregas PDF binary', async () => {
    const orders = [
      mockOrder('1', 'Juan Perez', 'Motor 5.0L', 1200),
      mockOrder('2', 'Carlos Gomez', 'Transmision 4x4', 850),
    ];

    const pdfBytes = await generateOfficialDeliveriesPdf({
      orders,
      commissionPercentage: 2,
      commissionAmount: (1200 + 850) * 0.02,
      employees: mockEmployees,
      recurringExpenses: mockRecurringExpenses,
      totalPayout: (1200 + 850) * 0.02 + 435 + 150,
      subtotalDeliveries: 2050,
      weekLabel: 'Semana del 05 al 11 de Octubre, 2026',
    });

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000);

    // PDF Magic Number header check "%PDF-"
    const header = String.fromCharCode(...pdfBytes.slice(0, 5));
    expect(header).toBe('%PDF-');
  });

  it('generates Formato Oficial PDF even when there are 0 orders', async () => {
    const pdfBytes = await generateOfficialDeliveriesPdf({
      orders: [],
      commissionPercentage: 2,
      commissionAmount: 0,
      employees: mockEmployees,
      recurringExpenses: [],
      totalPayout: 435,
      subtotalDeliveries: 0,
    });

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000);
  });

  it('generates a valid Ventas de la Semana PDF binary', async () => {
    const orders = [
      mockOrder('101', 'Pedro Ramirez', 'Motor 3.5L EcoBoost', 1500),
      mockOrder('102', 'Maria Fernandez', 'Caja Automatica 6R80', 950),
    ];

    const pdfBytes = await generateWeeklySalesPdf({
      orders,
      totalSales: 2450,
      weekLabel: 'Semana Actual · 2 ventas',
    });

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000);
    const header = String.fromCharCode(...pdfBytes.slice(0, 5));
    expect(header).toBe('%PDF-');
  });

  it('generates a valid Relacion General de Entregas y Gastos PDF binary', async () => {
    const pdfBytes = await generateGeneralRelationPdf({
      income: 3500,
      operationalCosts: 625,
      netBalance: 2875,
      commission: 70,
      expenses: [
        { date: '2026-10-08', category: 'Comisiones', description: 'Comisión 2% Gerencia', method: 'Cálculo', amount: 70 },
        { date: '2026-10-08', category: 'Nómina', description: 'Douglas (Supervisor)', method: 'Transferencia', amount: 150 },
      ],
      weekLabel: 'Relación General Semana 41',
    });

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000);
    const header = String.fromCharCode(...pdfBytes.slice(0, 5));
    expect(header).toBe('%PDF-');
  });
});
