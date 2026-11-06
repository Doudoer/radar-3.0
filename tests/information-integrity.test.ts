import { describe, expect, it } from 'vitest';
import { mapOrder, statusFromDatabase, toMysqlDateTime } from '../src/server/orders';
import { validateOrder } from '../src/server/business';
import { orderPayloadSchema, refundCreateSchema } from '../src/server/schemas';
import { businessDate, businessDaysBetween } from '../src/server/businessTime';
import type { RowDataPacket } from 'mysql2/promise';

const payload = () => orderPayloadSchema.parse({
  version: 1, status: 'cotizacion', mainPart: 'Motor', warrantyDays: 0,
  customer: { id: '1', name: 'Cliente', shippingAddress: 'Dirección B' },
  vehicle: { make: 'Marca' }, financials: { partPrice: 100, downPayment: 10, deliveryFee: 20, coreFee: 5 },
});
const previous = () => ({
  version: 1, status: 'Cotización', customer_id: 1, user_id: 1, is_yard_sale: 0,
  price: 100, down_payment: 10, shipping_cost: 20, core_fee: 5,
}) as RowDataPacket;

describe('information integrity', () => {
  it('preserves a zero-day warranty and the order delivery snapshot', () => {
    const mapped = mapOrder({
      id: 1, customer_id: 1, status: 'Cotización', created_at: new Date(), version: 3, warranty_days: 0,
      shipping_address: 'B', address_shipping: 'A', contact_name: 'Cliente original', first_name: 'Cliente cambiado',
    } as RowDataPacket);
    expect(mapped.warrantyDays).toBe(0);
    expect(mapped.customer.shippingAddress).toBe('B');
    expect(mapped.customer.name).toBe('Cliente original');
    expect(mapped.version).toBe(3);
  });
  it('rejects overpayment and permits Pagado after a down payment', () => {
    expect(() => validateOrder({ ...payload(), financials: { ...payload().financials, downPayment: 136 } })).toThrow(/superar/);
    expect(() => validateOrder({ ...payload(), status: 'pagado' })).toThrow(/Cotización/);
    expect(() => validateOrder({ ...payload(), status: 'pagado' }, previous())).not.toThrow();
    expect(() => validateOrder({
      ...payload(), status: 'pagado', financials: { ...payload().financials, downPayment: 0 },
    })).toThrow(/downpayment/i);
    expect(() => validateOrder({
      ...payload(), status: 'pagado', financials: { ...payload().financials, downPayment: 125 },
    }, previous())).not.toThrow();
  });
  it('rejects stale versions and unauthorized financial changes', () => {
    expect(() => validateOrder({ ...payload(), version: 2 }, previous(), 'admin')).toThrow(/cambió/);
    expect(() => validateOrder({ ...payload(), financials: { ...payload().financials, partPrice: 110 } }, previous(), 'operator')).toThrow(/administración/);
    expect(() => validateOrder(payload(), previous(), 'operator')).not.toThrow();
  });
  it('does not allow swapping the CRM customer through an order update', () => {
    expect(() => validateOrder({ ...payload(), customer: { id: '2', name: 'Otro' } }, previous())).toThrow(/cliente/);
  });
  it('only starts warranty on actual delivery and does not backfill legacy dates', () => {
    const order = {
      ...payload(), status: 'entregado' as const,
      financials: { ...payload().financials, downPayment: 125 },
    };
    const result = validateOrder(order, { ...previous(), status: 'En Camino' } as RowDataPacket);
    expect(result.deliveredAt).toBeTruthy();
    expect(result.warrantyStarted).toBe(true);
    const legacy = validateOrder(orderPayloadSchema.parse({ ...payload(), status: 'entregado' }), { ...previous(), status: 'Entregado' } as RowDataPacket);
    expect(legacy.deliveredAt).toBeUndefined();
  });
  it('requires full payment when an order is delivered, but does not block later edits to legacy deliveries', () => {
    const order = { ...payload(), status: 'entregado' as const };
    expect(() => validateOrder(order, { ...previous(), status: 'En Camino' } as RowDataPacket)).toThrow(/liquida el saldo/i);
    expect(() => validateOrder({
      ...order, financials: { ...order.financials, downPayment: 125 },
    }, { ...previous(), status: 'En Camino' } as RowDataPacket)).not.toThrow();
    expect(() => validateOrder({ ...order, deliveredAt: '2026-01-01T10:00:00Z' }, {
      ...previous(), status: 'Entregado', delivered_at: new Date('2026-01-01T10:00:00Z'), warranty_days: 0,
    } as RowDataPacket)).not.toThrow();
  });
  it('normalizes known aliases without guessing unknown historical states', () => {
    expect(statusFromDatabase('En espera de confirmación')).toBe('espera_confirmacion');
    expect(statusFromDatabase('Actualización')).toBe('actualizacion');
  });
  it('uses UTC persistence and New York calendar days including DST', () => {
    expect(toMysqlDateTime('2026-03-08T03:30:00-04:00')).toBe('2026-03-08 07:30:00');
    expect(businessDate('2026-03-09T01:00:00Z')).toBe('2026-03-08');
    expect(businessDaysBetween('2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z')).toBe(1);
  });
  it('requires idempotency for refunds and validates all supported payment methods', () => {
    expect(refundCreateSchema.safeParse({ orderId: 1, amount: 10, reason: 'Devolución' }).success).toBe(false);
    for (const paymentMethod of ['Zelle','CashApp','Efectivo','Transferencia','Tarjeta']) {
      expect(refundCreateSchema.safeParse({ idempotencyKey: crypto.randomUUID(), orderId: 1, amount: 10, reason: 'Devolución', paymentMethod }).success).toBe(true);
    }
  });
});
