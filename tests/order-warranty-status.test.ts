import { describe, expect, it } from 'vitest';
import { getClaimWarrantyError, getOrderWarrantyInfo } from '../src/utils/orderWarranty';

describe('getOrderWarrantyInfo', () => {
  const now = Date.parse('2026-11-04T12:00:00.000Z');

  it('marks a delivered order expired once the full warranty period has elapsed', () => {
    expect(getOrderWarrantyInfo({
      status: 'entregado',
      deliveredAt: '2026-10-05T12:00:00.000Z',
      warrantyDays: 30,
      warrantyStarted: true,
    }, now)).toEqual({ status: 'expired', daysLeft: 0 });
  });

  it('uses the delivery log to mark an expired order even after its status changes to a claim', () => {
    expect(getOrderWarrantyInfo({
      status: 'reclamo',
      deliveredAt: '2026-07-20T11:38:15.000Z',
      warrantyDays: 30,
      warrantyStarted: true,
    }, now)).toEqual({ status: 'expired', daysLeft: 0 });
  });

  it('expires the 30-day warranty exactly 30 days after its logged delivery time', () => {
    expect(getOrderWarrantyInfo({
      status: 'reclamo',
      deliveredAt: '2026-07-20T11:38:15.000Z',
      warrantyDays: 30,
      warrantyStarted: true,
    }, Date.parse('2026-08-19T11:38:15.000Z'))).toEqual({ status: 'expired', daysLeft: 0 });
    expect(getOrderWarrantyInfo({
      status: 'reclamo',
      deliveredAt: '2026-07-20T11:38:15.000Z',
      warrantyDays: 30,
      warrantyStarted: true,
    }, Date.parse('2026-08-19T11:38:14.999Z'))).toEqual({ status: 'critical', daysLeft: 1 });
  });

  it('does not start warranty from a date unless the delivery was actually marked complete', () => {
    expect(getOrderWarrantyInfo({
      status: 'en_preparacion',
      deliveredAt: '2026-07-20T12:00:00.000Z',
      warrantyDays: 30,
      warrantyStarted: false,
    }, now)).toEqual({ status: 'not_started', daysLeft: 30 });
  });

  it('rejects a claim when the warranty has expired', () => {
    expect(getClaimWarrantyError({
      deliveredAt: '2026-07-20T12:00:00.000Z',
      warrantyDays: 30,
      warrantyStarted: true,
    }, now)).toBe('No se puede registrar un reclamo: la garantía de la orden expiró.');
  });

  it('allows a claim while a logged warranty is still active', () => {
    expect(getClaimWarrantyError({
      deliveredAt: '2026-10-25T12:00:00.000Z',
      warrantyDays: 30,
      warrantyStarted: true,
    }, now)).toBeNull();
  });

  it('keeps the warranty unexpired until the full warranty period elapses', () => {
    expect(getOrderWarrantyInfo({
      status: 'entregado',
      deliveredAt: '2026-10-05T12:00:01.000Z',
      warrantyDays: 30,
      warrantyStarted: true,
    }, now)).toEqual({ status: 'critical', daysLeft: 1 });
  });

  it('does not start warranty when the order has no delivery log', () => {
    expect(getOrderWarrantyInfo({
      status: 'en_preparacion',
      warrantyDays: 30,
      warrantyStarted: false,
    }, now).status).toBe('not_started');
  });

  it('treats a zero-day warranty as expired at delivery', () => {
    expect(getOrderWarrantyInfo({
      status: 'entregado',
      deliveredAt: '2026-11-04T12:00:00.000Z',
      warrantyDays: 0,
      warrantyStarted: true,
    }, now)).toEqual({ status: 'expired', daysLeft: 0 });
  });

  it('does not mark a warranty expired when the delivery date is missing or invalid', () => {
    expect(getOrderWarrantyInfo({
      status: 'entregado',
      warrantyDays: 30,
      warrantyStarted: true,
    }, now).status).toBe('not_started');
    expect(getOrderWarrantyInfo({
      status: 'entregado',
      deliveredAt: 'invalid-date',
      warrantyDays: 30,
      warrantyStarted: true,
    }, now).status).toBe('not_started');
  });
});
