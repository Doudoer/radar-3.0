import { expect, it } from 'vitest';
import { getOrderWarrantyInfo } from '../src/utils/orderWarranty';

it('honors replacement terms and the final calendar day rather than original delivery elapsed hours', () => {
  const replacement = { warrantyStarted: true, deliveredAt: '2026-10-01T18:00:00Z', warrantyDays: 15,
    warrantyTerms: { startedAt: '2026-11-05T18:00:00Z', days: 15, policy: 'calendar' as const } };
  expect(getOrderWarrantyInfo(replacement, Date.parse('2026-11-10T18:00:00Z')).status).not.toBe('expired');
  const original = { ...replacement, warrantyTerms: { ...replacement.warrantyTerms, startedAt: '2026-10-25T18:00:00Z' } };
  expect(getOrderWarrantyInfo(original, Date.parse('2026-11-10T04:59:59Z')).status).not.toBe('expired');
  expect(getOrderWarrantyInfo(original, Date.parse('2026-11-10T05:00:00Z')).status).toBe('expired');
});
