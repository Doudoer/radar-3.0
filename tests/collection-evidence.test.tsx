import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OrderPaymentFields } from '../src/components/OrderPayments';
import { emptySettlement, settlementSchema, validateCollectionEvidence, type PaymentDetail } from '../src/utils/orderPayments';

const detail: PaymentDetail = { version: 1, order: { price: 100, shipping: 0, core: 0, paid: 0, coreReceived: false }, canRecord: true, coreReceipt: null, payments: [] };
describe('same payment evidence rules in collection and workflow', () => {
  it('requires cash receiver without a receipt and electronic image without a cash receiver', () => {
    const validate = (payment: Record<string, unknown>) => validateCollectionEvidence(settlementSchema.parse({
      ...emptySettlement(), payments: [{ amount: 10, method: 'cash', reference: '', confirmed: true, ...payment }],
    }));
    expect(() => validate({ receivedBy: 'Receiver', receipt: null })).not.toThrow();
    expect(() => validate({ method: 'zelle', receipt: '/uploads/test.png' })).not.toThrow();
    for (const payment of [{}, { receivedBy: 'Receiver', receipt: '/uploads/test.png' },
      { method: 'zelle', reference: 'TEST' }, { method: 'zelle', receipt: '/uploads/test.png', receivedBy: 'Receiver' },
      { method: 'zelle', receipt: 'https://example.test/test.png' }]) expect(() => validate(payment)).toThrow();
  });
  it('shows only receiver for cash and only image upload for electronic methods, retaining split payments', () => {
    const props = { orderId: '1', detail, onChange: () => {} };
    const cash = renderToStaticMarkup(<OrderPaymentFields {...props} value={{ ...emptySettlement(), payments: [{ amount: 10, method: 'cash', reference: '', confirmed: true }] }} />);
    expect(cash).toContain('Persona que recibió el dinero');
    expect(cash).not.toContain('type="file"');
    const zelle = renderToStaticMarkup(<OrderPaymentFields {...props} value={{ ...emptySettlement(), payments: [{ amount: 10, method: 'zelle', reference: '', confirmed: true, receipt: '/uploads/test.png' }] }} />);
    expect(zelle).not.toContain('Persona que recibió el dinero');
    expect(zelle).toContain('type="file"'); expect(zelle).toContain('Ver comprobante subido');
    expect(zelle).toContain('Agregar método de pago');
  });
});
