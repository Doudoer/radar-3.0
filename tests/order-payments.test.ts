import { describe, expect, it } from 'vitest';
import { settlementSchema, previewSettlement } from '../src/utils/orderPayments';

const order = { price: 900, shipping: 0, core: 100, paid: 200, coreReceived: false };
const payment = (amount: number, method = 'cash', reference = '') => ({ amount, method, reference, confirmed: true });
const settlement = (payments = [payment(800)]) => ({ payments, coreAction: 'keep' as const, coreReference: '', coreConfirmed: false });

describe('split collection and core settlement', () => {
  it('adds split payments to historic collections without replacing them', () => {
    const input = settlementSchema.parse(settlement([payment(300), payment(500, 'zelle', 'TEST-REFERENCE')]));
    expect(previewSettlement(order, input)).toEqual({ total: 1000, paid: 1000, balance: 0, received: 800, coreCredit: 0 });
  });
  it('accepts partial payments without claiming delivery', () => {
    expect(previewSettlement(order, settlementSchema.parse(settlement([payment(25.15)])))).toMatchObject({ paid: 225.15, balance: 774.85 });
  });
  it('removes core only on confirmed physical receipt and preserves cash already collected', () => {
    const input = settlementSchema.parse({ ...settlement([payment(700)]), coreAction: 'received', coreReference: 'CORE-RECEIPT-TEST', coreConfirmed: true });
    expect(previewSettlement(order, input)).toEqual({ total: 900, paid: 900, balance: 0, received: 700, coreCredit: 100 });
  });
  it('supports core-only receipt without creating a payment', () => {
    const input = settlementSchema.parse({ ...settlement([]), coreAction: 'received', coreReference: 'CORE-TEST', coreConfirmed: true });
    expect(previewSettlement(order, input)).toMatchObject({ total: 900, paid: 200, received: 0, balance: 700 });
  });
  it('rejects duplicate core receipt, missing core charge and core refunds disguised as discounts', () => {
    const input = settlementSchema.parse({ ...settlement([]), coreAction: 'received', coreReference: 'CORE-TEST', coreConfirmed: true });
    expect(() => previewSettlement({ ...order, coreReceived: true }, input)).toThrow(/registrada/);
    expect(() => previewSettlement({ ...order, core: 0 }, input)).toThrow(/cargo/);
    expect(() => previewSettlement({ ...order, paid: 1000 }, input)).toThrow(/devolución/);
  });
  it('uses cents and rejects overpayment instead of silently clamping', () => {
    expect(previewSettlement({ ...order, price: 0.3, paid: 0.1, core: 0 }, settlementSchema.parse(settlement([payment(0.2)])))).toMatchObject({ balance: 0, paid: 0.3 });
    expect(() => previewSettlement(order, settlementSchema.parse(settlement([payment(800.01)])))).toThrow(/supera/);
  });
  it.each(['cashapp', 'zelle', 'cashier_check', 'card', 'cash'])('accepts the approved method %s', method => {
    expect(settlementSchema.safeParse(settlement([payment(50, method, 'TEST-REF')])).success).toBe(true);
  });
  it('requires confirmed receipts and references for noncash methods', () => {
    for (const value of [
      settlement([{ ...payment(1), confirmed: false }]),
      settlement([payment(1, 'zelle')]),
      settlement([payment(-1)]), settlement([payment(0)]), settlement([payment(1.001)]),
      settlement([payment(1, 'unknown', 'TEST')]),
      { ...settlement([]), coreAction: 'received', coreReference: 'TEST', coreConfirmed: false },
      { ...settlement([]), actorId: 99 },
    ]) expect(settlementSchema.safeParse(value).success).toBe(false);
  });
  it('rejects invalid stored amounts rather than calculating a success-shaped balance', () => {
    expect(() => previewSettlement({ ...order, paid: NaN }, settlementSchema.parse(settlement([])))).toThrow(/importe/);
  });
});
