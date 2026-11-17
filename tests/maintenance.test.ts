import { describe, expect, it } from 'vitest';
import {
  extractUploadFilenamesFromValue,
  isOrderWarrantyExpiredForCleanup,
} from '../src/server/maintenance';

describe('Automatic Storage Maintenance Rules', () => {
  const now = new Date('2026-11-16T12:00:00Z');

  it('keeps delivered order files while warranty is still active', () => {
    const expired = isOrderWarrantyExpiredForCleanup(
      {
        status: 'Entregado',
        delivered_at: '2026-11-01T12:00:00Z',
        warranty_days: 60,
        open_claims: 0,
      },
      0,
      now,
    );
    expect(expired).toBe(false);
  });

  it('keeps delivered order files if an open claim exists even after warranty expiration', () => {
    const expired = isOrderWarrantyExpiredForCleanup(
      {
        status: 'Entregado',
        delivered_at: '2026-08-01T12:00:00Z',
        warranty_days: 60,
        open_claims: 1,
      },
      0,
      now,
    );
    expect(expired).toBe(false);
  });

  it('marks delivered order files eligible once warranty has expired and no open claims remain', () => {
    const expired = isOrderWarrantyExpiredForCleanup(
      {
        status: 'Entregado',
        delivered_at: '2026-08-01T12:00:00Z',
        warranty_days: 60,
        open_claims: 0,
      },
      0,
      now,
    );
    expect(expired).toBe(true);
  });

  it('respects deliveredGraceDays after warranty expiration', () => {
    const expiredWithoutGrace = isOrderWarrantyExpiredForCleanup(
      {
        status: 'Entregado',
        delivered_at: '2026-09-10T12:00:00Z',
        warranty_days: 60,
        open_claims: 0,
      },
      0,
      now,
    );
    const expiredWithGrace = isOrderWarrantyExpiredForCleanup(
      {
        status: 'Entregado',
        delivered_at: '2026-09-10T12:00:00Z',
        warranty_days: 60,
        open_claims: 0,
      },
      15,
      now,
    );
    expect(expiredWithoutGrace).toBe(true);
    expect(expiredWithGrace).toBe(false);
  });

  it('extracts unique upload filenames from JSON and string fields', () => {
    const files = extractUploadFilenamesFromValue({
      referenceImages: ['/uploads/a_123.jpg', '/uploads/b_456.pdf', '/uploads/a_123.jpg'],
    });
    expect(files).toEqual(['a_123.jpg', 'b_456.pdf']);
    expect(extractUploadFilenamesFromValue(null)).toEqual([]);
  });
});
