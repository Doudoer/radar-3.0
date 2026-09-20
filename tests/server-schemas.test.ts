import { describe, expect, it } from 'vitest';
import { claimSchema, loginSchema, orderPayloadSchema, personalMessageSchema } from '../src/server/schemas';

describe('server input schemas', () => {
  it('normalizes valid login credentials', () => {
    expect(loginSchema.parse({ email: '  ADMIN@example.com ', password: 'secret' })).toEqual({
      email: 'ADMIN@example.com',
      password: 'secret',
    });
  });

  it('rejects invalid claim identifiers and short descriptions', () => {
    expect(() => claimSchema.parse({ orderId: 0, description: 'no' })).toThrow();
  });

  it('rejects negative financial amounts and invalid workflow steps', () => {
    expect(() => orderPayloadSchema.parse({
      workflowStep: 0,
      financials: { partPrice: -1 },
    })).toThrow();
  });

  it('accepts a complete order payload and coerces numeric fields', () => {
    const order = orderPayloadSchema.parse({
      status: 'pagado',
      mainPart: 'Motor 2.4L',
      workflowStep: '2',
      warrantyDays: '60',
      customer: { name: 'Cliente Prueba', email: '' },
      vehicle: { year: '2018', make: 'Jeep', model: 'Compass' },
      financials: { partPrice: '1200', downPayment: '300' },
      deliveryType: 'retiro_tienda',
    });

    expect(order.workflowStep).toBe(2);
    expect(order.vehicle?.year).toBe(2018);
    expect(order.financials?.partPrice).toBe(1200);
  });

  it('requires a message body and bounds its subject', () => {
    expect(() => personalMessageSchema.parse({ recipientId: 2, subject: 'x'.repeat(161), content: 'Hola' })).toThrow();
    expect(() => personalMessageSchema.parse({ recipientId: 2, content: '   ' })).toThrow();
  });
});
