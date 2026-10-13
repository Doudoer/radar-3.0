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
  {
    id: 'ORD-004',
    code: 'ORD-004',
    createdAt: '2026-10-08',
    createdAtIso: '2026-10-08T12:00:00.000Z',
    advisor: 'Carlos Mendoza',
    status: 'cancelado',
    mainPart: 'Faro LED Delantero',
    customer: {
      id: 'CUST-4',
      name: 'Carlos Ruiz',
      phone: '555-4444',
      email: 'carlos@example.com',
      location: 'Barquisimeto',
      type: 'Particular',
      initials: 'CR',
    },
    vehicle: {
      make: 'Nissan',
      model: 'Sentra',
      year: 2021,
      vin: '4N1AB7AP6KL999888',
      plate: 'BAR-444',
      mileage: '50000',
      color: 'Gris',
    },
    workflowStep: 1,
    financials: {
      partPrice: 350,
      downPayment: 0,
      subtotal: 350,
      total: 350,
    },
  },
  {
    id: 'ORD-005',
    code: 'ORD-005',
    createdAt: '2026-10-09',
    createdAtIso: '2026-10-09T09:00:00.000Z',
    advisor: 'María Gómez',
    status: 'reembolsado',
    mainPart: 'Bomba de Gasolina',
    customer: {
      id: 'CUST-5',
      name: 'Patricia Morales',
      phone: '555-7777',
      email: 'patricia@example.com',
      location: 'Mérida',
      type: 'Particular',
      initials: 'PM',
    },
    vehicle: {
      make: 'Jeep',
      model: 'Cherokee',
      year: 2018,
      vin: '1C4PJLCB3KD111222',
      plate: 'MER-777',
      mileage: '95000',
      color: 'Rojo',
    },
    workflowStep: 4,
    financials: {
      partPrice: 600,
      downPayment: 600,
      subtotal: 600,
      total: 600,
    },
  },
  {
    id: 'ORD-006',
    code: 'ORD-006',
    createdAt: '2026-05-01',
    createdAtIso: '2026-05-01T10:00:00.000Z',
    advisor: 'Carlos Mendoza',
    status: 'entregado',
    deliveredAt: '2026-05-10T12:00:00.000Z',
    warrantyDays: 30,
    mainPart: 'Compresor de Aire Acondicionado',
    customer: {
      id: 'CUST-6',
      name: 'Gustavo Perez',
      phone: '555-8888',
      email: 'gustavo@example.com',
      location: 'San Cristóbal',
      type: 'Particular',
      initials: 'GP',
    },
    vehicle: {
      make: 'Honda',
      model: 'Civic',
      year: 2017,
      vin: '2HGFC2F59HH333444',
      plate: 'SC-888',
      mileage: '110000',
      color: 'Blanco',
    },
    workflowStep: 4,
    financials: {
      partPrice: 750,
      downPayment: 750,
      subtotal: 750,
      total: 750,
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

  it('hides archived, cancelled, refunded and expired-warranty orders when search is empty (default active view)', () => {
    const html = renderToStaticMarkup(
      <OrdersTableView
        orders={sampleOrders}
        onSelectOrder={vi.fn()}
        onOpenNewOrder={vi.fn()}
        onExport={vi.fn()}
        onStatusRequest={vi.fn()}
      />
    );

    // Active order is shown
    expect(html).toContain('ORD-001');
    expect(html).toContain('Alejandro Ramos');

    // Archived, cancelled, refunded and expired-warranty orders are excluded from default active view
    expect(html).not.toContain('ORD-003'); // archivado
    expect(html).not.toContain('ORD-004'); // cancelado
    expect(html).not.toContain('ORD-005'); // reembolsado
    expect(html).not.toContain('ORD-006'); // garantia vencida
  });

  it('finds an archived order across all statuses when using the search box', () => {
    const html = renderToStaticMarkup(
      <OrdersTableView
        orders={sampleOrders}
        initialSearchQuery="Daniel Torres"
        onSelectOrder={vi.fn()}
        onOpenNewOrder={vi.fn()}
        onExport={vi.fn()}
        onStatusRequest={vi.fn()}
      />
    );

    expect(html).toContain('ORD-003');
    expect(html).toContain('Daniel Torres');
    expect(html).toContain('Archivado');
    expect(html).toContain('Alternador 12V');
    expect(html).toContain('Búsqueda global en todos los estatus');
  });

  it('finds a cancelled order across all statuses when searching by part or code', () => {
    const html = renderToStaticMarkup(
      <OrdersTableView
        orders={sampleOrders}
        initialSearchQuery="Faro LED"
        onSelectOrder={vi.fn()}
        onOpenNewOrder={vi.fn()}
        onExport={vi.fn()}
        onStatusRequest={vi.fn()}
      />
    );

    expect(html).toContain('ORD-004');
    expect(html).toContain('Carlos Ruiz');
    expect(html).toContain('Cancelado');
    expect(html).toContain('Nissan');
  });

  it('finds a refunded order across all statuses when searching by customer or VIN', () => {
    const html = renderToStaticMarkup(
      <OrdersTableView
        orders={sampleOrders}
        initialSearchQuery="1C4PJLCB3KD111222"
        onSelectOrder={vi.fn()}
        onOpenNewOrder={vi.fn()}
        onExport={vi.fn()}
        onStatusRequest={vi.fn()}
      />
    );

    expect(html).toContain('ORD-005');
    expect(html).toContain('Patricia Morales');
    expect(html).toContain('Reembolso');
    expect(html).toContain('Jeep');
  });

  it('finds an expired warranty order across all statuses when searching by phone', () => {
    const html = renderToStaticMarkup(
      <OrdersTableView
        orders={sampleOrders}
        initialSearchQuery="555-8888"
        onSelectOrder={vi.fn()}
        onOpenNewOrder={vi.fn()}
        onExport={vi.fn()}
        onStatusRequest={vi.fn()}
      />
    );

    expect(html).toContain('ORD-006');
    expect(html).toContain('Gustavo Perez');
    expect(html).toContain('Compresor de Aire Acondicionado');
    expect(html).toContain('Entregado');
  });
});
