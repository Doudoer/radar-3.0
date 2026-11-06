import { describe, expect, it } from 'vitest';
import { getOrderWarrantyInfo } from '../src/utils/orderWarranty';
import { coreDeadline, refundExecutionSchema, validateRefundBudget, warrantyTermsSchema } from '../src/utils/aftersales';

describe('aftersales time and money contract', () => {
  it('keeps new calendar warranty active through its final local day across DST', () => {
    const order = { warrantyStarted: true, deliveredAt: '2026-10-25T18:00:00Z', warrantyDays: 15,
      warrantyTerms: { startedAt: '2026-10-25T18:00:00Z', days: 15, policy: 'calendar' as const } };
    expect(getOrderWarrantyInfo(order, Date.parse('2026-11-10T04:59:59Z')).status).not.toBe('expired');
    expect(getOrderWarrantyInfo(order, Date.parse('2026-11-10T05:00:00Z')).status).toBe('expired');
  });
  it('preserves legacy exact 24-hour expiry', () => {
    const order = { warrantyStarted: true, deliveredAt: '2026-10-25T18:00:00Z', warrantyDays: 15 };
    expect(getOrderWarrantyInfo(order, Date.parse('2026-11-09T18:00:00Z')).status).toBe('expired');
  });
  it('starts replacement coverage without changing original delivery or core deadline', () => {
    const order = { warrantyStarted: true, deliveredAt: '2026-10-01T18:00:00Z', warrantyDays: 15,
      warrantyTerms: { startedAt: '2026-11-05T18:00:00Z', days: 15, policy: 'calendar' as const } };
    expect(getOrderWarrantyInfo(order, Date.parse('2026-11-10T18:00:00Z')).status).not.toBe('expired');
    expect(coreDeadline(order.deliveredAt)).toBe('2026-10-16');
    expect(coreDeadline(null)).toBeNull();
    expect(warrantyTermsSchema.safeParse({ startedAt: 'invalid', days: 15, policy: 'calendar' }).success).toBe(false);
  });
  it('requires Square last four and receipt, but cash acknowledgment instead of card data', () => {
    expect(refundExecutionSchema.safeParse({ method: 'square', last4: '1234', reference: 'SQ-TEST',
      receipt: '/uploads/receipt.png', confirmed: true }).success).toBe(true);
    for (const data of [
      { method: 'square', last4: '123', reference: 'SQ-TEST', receipt: '/uploads/receipt.png', confirmed: true },
      { method: 'square', last4: '1234567812345678', reference: 'SQ-TEST', receipt: '/uploads/receipt.png', confirmed: true },
      { method: 'square', last4: '1234', reference: 'SQ-TEST', confirmed: true },
      { method: 'cash', last4: '1234', recipient: 'Test recipient', confirmed: true },
      { method: 'cash', recipient: '', confirmed: true },
    ]) expect(refundExecutionSchema.safeParse(data).success).toBe(false);
    expect(refundExecutionSchema.safeParse({ method: 'cash', recipient: 'Test recipient', confirmed: true }).success).toBe(true);
  });
  it('reserves pending refunds, prevents core double refund and never exceeds collected money', () => {
    expect(validateRefundBudget(1000, 100, 150, 750)).toBeNull();
    expect(validateRefundBudget(1000, 100, 150, 750.01)).toBeTruthy();
    expect(validateRefundBudget(1000, 1000, 0, 150)).toBeTruthy();
  });
});
