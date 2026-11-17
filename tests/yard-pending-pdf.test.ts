import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { Order } from '../src/types';
import { generateYardPendingPdf, sortYardPendingOrdersFifo } from '../src/utils/yardPendingPdf';

const makeOrder = (overrides: Partial<Order>): Order => ({
  id: '1',
  code: 'RSY-1001',
  status: 'pagado',
  mainPart: 'Transmision Automatica',
  deliveryType: 'envio_domicilio',
  createdAt: '2026-11-16',
  createdAtIso: '2026-11-16T10:00:00Z',
  paidAtIso: '2026-11-16T10:05:00Z',
  yardPieceReady: false,
  customer: { id: '1', name: 'Carlos Perez', phone: '555-0101', type: 'Particular', email: '', location: '', initials: 'CP' },
  vehicle: { year: 2015, make: 'Honda', model: 'Civic', vin: '1HGCM82633A004352', plate: '', mileage: '0', color: '' },
  ...overrides,
} as Order);

describe('Yard Pending Parts PDF Generator', () => {
  it('filters only pending yard orders and sorts them FIFO', () => {
    const orders: Order[] = [
      makeOrder({ id: '1', code: 'RSY-NEW', paidAtIso: '2026-11-16T12:00:00Z' }),
      makeOrder({ id: '2', code: 'RSY-READY', yardPieceReady: true }),
      makeOrder({ id: '3', code: 'RSY-OLD', paidAtIso: '2026-11-16T09:00:00Z' }),
      makeOrder({ id: '4', code: 'RSY-DELIVERED', status: 'entregado' }),
    ];

    const sorted = sortYardPendingOrdersFifo(orders);
    expect(sorted.map((o) => o.code)).toEqual(['RSY-OLD', 'RSY-NEW']);
  });

  it('generates a valid multi-page PDF when there are many pending parts', async () => {
    const orders: Order[] = Array.from({ length: 28 }, (_, i) =>
      makeOrder({
        id: String(i + 1),
        code: `RSY-${2000 + i}`,
        mainPart: `Motor / Pieza #${i + 1}`,
        paidAtIso: `2026-11-16T${String(8 + Math.floor(i / 6)).padStart(2, '0')}:00:00Z`,
      }),
    );

    const bytes = await generateYardPendingPdf(orders, 'Admin Patio');
    expect(bytes.length).toBeGreaterThan(1000);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(2);
  });

  it('generates a valid single-page PDF even when there are 0 pending parts', async () => {
    const bytes = await generateYardPendingPdf([], 'Admin Patio');
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });
});
