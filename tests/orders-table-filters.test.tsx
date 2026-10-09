import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OrdersTableView } from '../src/components/OrdersTableView';
import { Order } from '../src/types';

const sampleOrders: Order[] = [
  {
    id: 'ORD-001',
    code: 'ORD-001',
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
    id: 'ORD-002',
    code: 'ORD-002',
    createdAt: '2026-10-05',
    createdAtIso: '2026-10-05T14:30:00.000Z',
    advisor: 'María Gómez',
    status: 'listo_retiro',
    mainPart: 'Caja Automática 6 Velocidades',
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
  {
    id: 'ORD-003',
    code: 'ORD-003',
    createdAt: '2026-10-07',
    createdAtIso: '2026-10-07T16:00:00.000Z',
    advisor: 'Carlos Mendoza',
    status: 'archivado',
    mainPart: 'Alternador 12V',
    customer: {
      id: 'CUST-3',
      name: 'Daniel Torres',
      phone: '555-5555',
      email: 'daniel@example.com',
      location: 'Maracaibo',
      type: 'Taller Mecánico',
      initials: 'DT',
    },
    vehicle: {
      make: 'Chevrolet',
      model: 'Tahoe',
      year: 2015,
      vin: '3GNAXKEV5FL543210',
      plate: 'MAR-555',
      mileage: '120000',
      color: 'Negro',
    },
    workflowStep: 4,
    financials: {
      partPrice: 400,
      downPayment: 400,
      subtotal: 400,
      total: 400,
    },
  },
];

describe('OrdersTableView Search & Filter UI', () => {
  it('renders top bar buttons and search input with required placeholder', () => {
    const html = renderToStaticMarkup(
      <OrdersTableView
        orders={sampleOrders}
        onSelectOrder={vi.fn()}
        onOpenNewOrder={vi.fn()}
        onExport={vi.fn()}
        onStatusRequest={vi.fn()}
      />
    );

    expect(html).toContain('Lista de Órdenes');
    expect(html).toContain('Auto-sync 5 min');
    expect(html).toContain('Ver Archivadas');
    expect(html).toContain('Buscar por nombre, teléfono, marca, modelo, año o tipo de pieza...');
    expect(html).toContain('Filtros');
  });

  it('renders the 6 filter fields with labels and options', () => {
    const html = renderToStaticMarkup(
      <OrdersTableView
        orders={sampleOrders}
        onSelectOrder={vi.fn()}
        onOpenNewOrder={vi.fn()}
        onExport={vi.fn()}
        onStatusRequest={vi.fn()}
      />
    );

    // Labels
    expect(html).toContain('ESTADO');
    expect(html).toContain('OPERADOR');
    expect(html).toContain('MARCA');
    expect(html).toContain('TIPO DE PIEZA');
    expect(html).toContain('DESDE');
    expect(html).toContain('HASTA');

    // Dynamic Options extracted from sample orders
    expect(html).toContain('Carlos Mendoza');
    expect(html).toContain('María Gómez');
    expect(html).toContain('Toyota');
    expect(html).toContain('Ford');
    expect(html).toContain('Motor 2.0L Turbo');
    expect(html).toContain('Caja Automática 6 Velocidades');
  });
});
