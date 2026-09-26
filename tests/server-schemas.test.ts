import { describe, expect, it } from 'vitest';
import {
  changePasswordSchema,
  claimCallCreateSchema,
  claimSchema,
  customerSchema,
  loginSchema,
  orderPayloadSchema,
  personalMessageSchema,
  refundCreateSchema,
  uploadPayloadSchema,
  userCreateSchema,
  wasenderDispatchSchema,
  inventoryPartSchema,
  inventoryPartUpdateSchema,
} from '../src/server/schemas';

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

  it('validates customer creation schema', () => {
    const customer = customerSchema.parse({
      first_name: 'Juan',
      last_name: 'Pérez',
      phone: '9195551234',
      email: 'juan@test.com',
      type: 'Taller Mecánico',
    });
    expect(customer.first_name).toBe('Juan');
    expect(customer.type).toBe('Taller Mecánico');
    expect(() => customerSchema.parse({ phone: '12' })).toThrow();
  });

  it('validates refund request schema', () => {
    const refund = refundCreateSchema.parse({
      orderId: '42',
      amount: '350.50',
      amountType: 'downpayment',
      paymentMethod: 'Zelle',
      reason: 'Garantía denegada por falta de stock',
    });
    expect(refund.orderId).toBe(42);
    expect(refund.amount).toBe(350.50);
    expect(() => refundCreateSchema.parse({ orderId: 0, amount: -10, reason: 'x' })).toThrow();
  });

  it('validates call register schema', () => {
    const call = claimCallCreateSchema.parse({
      callerName: 'Maria Rodriguez',
      conversationSummary: 'Cliente reporta fuga de aceite en transmisión.',
    });
    expect(call.conversationSummary).toContain('fuga');
    expect(() => claimCallCreateSchema.parse({ conversationSummary: '' })).toThrow();
  });

  it('enforces password policy (min 8 chars, uppercase, lowercase, digit, symbol/dot)', () => {
    // Too short (< 8 chars)
    expect(() => userCreateSchema.parse({
      name: 'Nuevo Usuario',
      email: 'nuevo@radar.local',
      password: 'Rad.1',
    })).toThrow();

    // Missing uppercase
    expect(() => userCreateSchema.parse({
      name: 'Nuevo Usuario',
      email: 'nuevo@radar.local',
      password: 'radar.pass123',
    })).toThrow();

    // Missing lowercase
    expect(() => userCreateSchema.parse({
      name: 'Nuevo Usuario',
      email: 'nuevo@radar.local',
      password: 'RADAR.PASS123',
    })).toThrow();

    // Missing digit
    expect(() => userCreateSchema.parse({
      name: 'Nuevo Usuario',
      email: 'nuevo@radar.local',
      password: 'Radar.Password!',
    })).toThrow();

    // Missing symbol or dot
    expect(() => userCreateSchema.parse({
      name: 'Nuevo Usuario',
      email: 'nuevo@radar.local',
      password: 'RadarPassword123',
    })).toThrow();

    // Valid passwords
    const validUserWithDot = userCreateSchema.parse({
      name: 'Nuevo Usuario',
      email: 'nuevo@radar.local',
      password: 'Radar.2026',
    });
    expect(validUserWithDot.email).toBe('nuevo@radar.local');

    const validUserWithSymbol = userCreateSchema.parse({
      name: 'Nuevo Usuario',
      email: 'nuevo@radar.local',
      password: 'Admin#Password1',
    });
    expect(validUserWithSymbol.email).toBe('nuevo@radar.local');
  });

  it('validates password change requirements', () => {
    expect(() => changePasswordSchema.parse({
      currentPassword: 'old',
      newPassword: 'short',
    })).toThrow();

    expect(() => changePasswordSchema.parse({
      currentPassword: 'password_actual_123',
      newPassword: 'invalidpasswordwithoutupper',
    })).toThrow();

    const validChange = changePasswordSchema.parse({
      currentPassword: 'password_actual_123',
      newPassword: 'Radar.NewPassword2026!',
    });
    expect(validChange.newPassword).toBe('Radar.NewPassword2026!');
  });

  it('validates file upload payload', () => {
    const validUpload = uploadPayloadSchema.parse({
      filename: 'evidencia.png',
      contentType: 'image/png',
      base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    });
    expect(validUpload.filename).toBe('evidencia.png');
    expect(validUpload.contentType).toBe('image/png');
    expect(() => uploadPayloadSchema.parse({
      filename: 'evidencia.exe',
      contentType: 'application/x-msdownload',
      base64: 'abc',
    })).toThrow();
  });

  it('validates wasender dispatch payload', () => {
    const validDispatch = wasenderDispatchSchema.parse({
      phone: '9195551234',
      message: 'Tu orden está lista para entrega.',
      orderId: '5',
    });
    expect(validDispatch.phone).toBe('9195551234');
    expect(validDispatch.orderId).toBe(5);
    expect(() => wasenderDispatchSchema.parse({ phone: '', message: '' })).toThrow();
  });

  it('validates inventory part schema (year, brand, model, partType, vin, palletNumber, engineSpecs, notes)', () => {
    const part = inventoryPartSchema.parse({
      year: '2017',
      brand: 'Chevrolet',
      model: 'Malibu',
      partType: 'Motor',
      vin: '1G1BE5SM8H7123456',
      palletNumber: 'PAL-104',
      engineSpecs: '1.5L Turbo',
      notes: 'Probado con alternador y compresor',
    });
    expect(part.year).toBe('2017');
    expect(part.brand).toBe('Chevrolet');
    expect(part.model).toBe('Malibu');
    expect(part.partType).toBe('Motor');
    expect(part.vin).toBe('1G1BE5SM8H7123456');
    expect(part.palletNumber).toBe('PAL-104');
    expect(part.engineSpecs).toBe('1.5L Turbo');
    expect(part.notes).toBe('Probado con alternador y compresor');
    expect(() => inventoryPartSchema.parse({ year: '', brand: 'Chevrolet', model: 'Malibu' })).toThrow();
  });
});
