import { describe, expect, it } from 'vitest';
import { downpaymentSchema, validateDownpayment } from '../src/utils/downpaymentConfirmation';

const cash = { method: 'cash', amount: 100, receivedBy: 'Persona que recibió', receipt: null };
describe('existing downpayment documentation', () => {
  it('documents split methods only when the exact already-recorded amount matches', () => {
    const lines = downpaymentSchema.parse([cash, { ...cash, method: 'zelle', amount: 50, receipt: '/uploads/receipt.png' }]);
    expect(() => validateDownpayment(150, lines)).not.toThrow();
    expect(() => validateDownpayment(149.99, lines)).toThrow(/coincidir/);
    expect(() => validateDownpayment(150.01, lines)).toThrow(/coincidir/);
    expect(() => validateDownpayment(0, lines)).toThrow(/abono/);
  });
  it('requires an image for every non-cash line and never accepts one for cash', () => {
    expect(downpaymentSchema.safeParse([cash]).success).toBe(true);
    expect(downpaymentSchema.safeParse([{ ...cash, receipt: '/uploads/receipt.png' }]).success).toBe(false);
    for (const method of ['card', 'cashapp', 'zelle']) {
      expect(downpaymentSchema.safeParse([{ method, amount: 100, receipt: '/uploads/receipt.jpg' }]).success).toBe(true);
      expect(downpaymentSchema.safeParse([{ ...cash, method, receivedBy: '', receipt: '/uploads/receipt.jpg' }]).success).toBe(true);
      expect(downpaymentSchema.safeParse([{ ...cash, method }]).success).toBe(false);
      expect(downpaymentSchema.safeParse([{ ...cash, method, receipt: '/uploads/receipt.jpg' }]).success).toBe(true);
      expect(downpaymentSchema.safeParse([{ ...cash, method, receipt: 'https://other.example/receipt.jpg' }]).success).toBe(false);
    }
  });
  it('rejects invalid amounts, missing receivers, unsupported methods and extra client dates', () => {
    for (const patch of [{ amount: 0 }, { amount: -1 }, { amount: 0.001 }, { amount: NaN }, { receivedBy: '' },
      { method: 'cashier_check' }, { date: '2020-01-01' }, { receipt: '/uploads/../private.png' }]) {
      expect(downpaymentSchema.safeParse([{ ...cash, ...patch }]).success).toBe(false);
    }
    expect(downpaymentSchema.safeParse([]).success).toBe(false);
    expect(downpaymentSchema.safeParse(Array(21).fill(cash)).success).toBe(false);
    expect(() => validateDownpayment(0.3, downpaymentSchema.parse([{ ...cash, amount: 0.1 }, { ...cash, amount: 0.2 }]))).not.toThrow();
  });
});
