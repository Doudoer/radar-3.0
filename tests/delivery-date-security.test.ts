import { describe, expect, it } from 'vitest';
import type { RowDataPacket } from 'mysql2/promise';
import { orderPayloadSchema, updateDeliveryDateSchema } from '../src/server/schemas';
import { validateOrder } from '../src/server/business';

describe('administrative delivery date correction', () => {
  it('requires a current version and a meaningful reason, not a retired OTP', () => {
    const body = { version: 1, deliveredAt: '2020-10-08T14:30:00Z', reason: 'Fecha real confirmada' };
    expect(updateDeliveryDateSchema.parse(body)).toEqual(body);
    for (const invalid of [{ ...body, version: undefined }, { ...body, reason: undefined },
      { ...body, reason: ' ' }, { ...body, deliveredAt: 'invalid' },
      { ...body, deliveredAt: new Date(Date.now() + 86400000).toISOString() }]) {
      expect(updateDeliveryDateSchema.safeParse(invalid).success).toBe(false);
    }
    expect(updateDeliveryDateSchema.safeParse({ ...body, reason: undefined, otpCode: '123456' }).success).toBe(false);
  });

  it('cannot bypass the correction audit through the general order editor', () => {
    const deliveredAt = '2020-10-08T14:30:00Z';
    const previous = { version: 1, status: 'Entregado', customer_id: 1, delivered_at: deliveredAt } as RowDataPacket;
    const body = orderPayloadSchema.parse({ version: 1, status: 'entregado', mainPart: 'Motor', deliveredAt,
      customer: { id: '1', name: 'Cliente' }, vehicle: {}, financials: { partPrice: 100 } });
    expect(() => validateOrder(body, previous)).not.toThrow();
    expect(() => validateOrder({ ...body, deliveredAt: undefined }, previous)).toThrow(/motivo/);
    expect(() => validateOrder({ ...body, deliveredAt: '2020-10-09T14:30:00Z' }, previous)).toThrow(/motivo/);
  });
});
