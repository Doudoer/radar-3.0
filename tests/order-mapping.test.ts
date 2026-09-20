import { describe, expect, it } from 'vitest';
import { mapOrder, statusFromDatabase, toMysqlDateTime } from '../src/server/orders';

describe('database order mapping', () => {
  it('normalizes database status labels', () => {
    expect(statusFromDatabase('En Espera Confirmación')).toBe('espera_confirmacion');
    expect(statusFromDatabase('Listo para Despacho')).toBe('listo_despacho');
    expect(statusFromDatabase('Reembolsado')).toBe('reembolsado');
  });

  it('maps financial totals and delivery fields', () => {
    const order = mapOrder({
      id: 8,
      order_code: 'ORD-8',
      created_at: new Date('2026-09-18T12:00:00Z'),
      status: 'Pagado',
      product_type: 'Motor',
      workflow_step: 2,
      customer_id: 3,
      first_name: 'Ana',
      last_name: 'Torres',
      price: '1000.00',
      shipping_cost: '75.00',
      core_fee: '100.00',
      down_payment: '300.00',
      shipping_toggle: 1,
      warranty_days: 90,
    } as never);

    expect(order.customer.name).toBe('Ana Torres');
    expect(order.status).toBe('pagado');
    expect(order.deliveryType).toBe('envio_domicilio');
    expect(order.financials.total).toBe(1175);
    expect(order.financials.balanceDue).toBe(875);
  });

  it('returns null for empty or invalid SQL dates', () => {
    expect(toMysqlDateTime()).toBeNull();
    expect(toMysqlDateTime('not-a-date')).toBeNull();
    expect(toMysqlDateTime('2026-09-18T14:30:45')).toMatch(/^2026-09-18 14:30:45$/);
  });
});
