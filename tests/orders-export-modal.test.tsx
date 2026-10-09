import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ExportModal } from '../src/components/ExportModal';
import { generateOrdersReportPdf } from '../src/utils/ordersReportPdf';
import { Order } from '../src/types';

const sampleOrders: Order[] = [
  {
    id: 'ORD-101',
    code: 'ORD-101',
    createdAt: '2026-10-01',
    createdAtIso: '2026-10-01T10:00:00.000Z',
    advisor: 'Carlos Mendoza',
    status: 'pagado',
    mainPart: 'Motor 2.0L Turbo',
    customer: {
      id: 'CUST-1',
      name: 'Alejandro Ramos',
      phone: '555-1234',
      email: 'alex@example.com',
      location: 'Caracas',
      type: 'Particular',
      initials: 'AR',
    },
    vehicle: {
      make: 'Toyota',
      model: 'Corolla',
      year: 2022,
      vin: '1N4AL3AP8JC123456',
      plate: 'ABC-123',
      mileage: '45000',
      color: 'Plata',
    },
    workflowStep: 2,
    financials: {
      partPrice: 1200,
      downPayment: 500,
      subtotal: 1200,
      total: 1200,
    },
  },
  {
    id: 'ORD-102',
    code: 'ORD-102',
    createdAt: '2026-10-05',
    createdAtIso: '2026-10-05T14:30:00.000Z',
    advisor: 'María Gómez',
    status: 'listo_retiro',
    mainPart: 'Caja Automática',
    customer: {
      id: 'CUST-2',
      name: 'Beatriz Silva',
      phone: '555-9876',
      email: 'bea@example.com',
      location: 'Valencia',
      type: 'Empresa',
      initials: 'BS',
    },
    vehicle: {
      make: 'Ford',
      model: 'Explorer',
      year: 2019,
      vin: '2FMDK48C2EBA78901',
      plate: 'XYZ-789',
      mileage: '80000',
      color: 'Azul',
    },
    workflowStep: 3,
    financials: {
      partPrice: 2000,
      downPayment: 2000,
      subtotal: 2000,
      total: 2000,
    },
  },
];

describe('ExportModal & Orders Report PDF', () => {
  it('renders status selector and date range inputs when open', () => {
    const html = renderToStaticMarkup(
      <ExportModal isOpen orders={sampleOrders} onClose={vi.fn()} />
    );

    expect(html).toContain('Exportar Reporte de Órdenes');
    expect(html).toContain('ESTATUS DE LAS ÓRDENES:');
    expect(html).toContain('DESDE:');
    expect(html).toContain('HASTA:');
    expect(html).toContain('CSV / Excel');
    expect(html).toContain('JSON Data');
    expect(html).toContain('Impresión / PDF');
    expect(html).toContain('Pagado');
  });

  it('generates a valid PDF with filtered orders and metadata', async () => {
    const filtered = sampleOrders.filter((o) => o.status === 'pagado');
    const pdfBytes = await generateOrdersReportPdf({
      orders: filtered,
      statusFilterLabel: 'Pagado',
      dateRangeLabel: '01/10/2026 al 08/10/2026',
      totalOrders: 1,
      totalAmount: 1200,
    });

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(500);

    const pdfString = Buffer.from(pdfBytes).toString('latin1');
    expect(pdfString).toContain('%PDF');
  });
});
