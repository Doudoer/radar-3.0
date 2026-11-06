import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getWarrantyCountdown } from '../src/utils/orderWarranty';
import { WarrantyCountdown } from '../src/components/WarrantyCountdown';

describe('warranty countdown', () => {
  it('counts down to the midnight after the final New York day across DST', () => {
    const terms = { startedAt: '2026-10-25T18:00:00Z', days: 15, policy: 'calendar' as const };
    const remaining = getWarrantyCountdown(terms, Date.parse('2026-11-10T04:30:00Z'));
    expect(remaining.remainingMs).toBe(30 * 60000);
    expect(remaining.endsAt).toBe('2026-11-10T05:00:00.000Z');
    expect(remaining.percentRemaining).toBeGreaterThan(0);
    expect(getWarrantyCountdown(terms, Date.parse(remaining.endsAt)).remainingMs).toBe(0);
    const spring = getWarrantyCountdown({ ...terms, startedAt: '2027-03-13T17:00:00Z', days: 1 }, Date.parse('2027-03-15T03:00:00Z'));
    expect(spring.endsAt).toBe('2027-03-15T04:00:00.000Z');
  });
  it('preserves elapsed-hour policies, clamps progress and handles zero coverage', () => {
    const terms = { startedAt: '2026-11-05T18:00:00Z', days: 2, policy: 'elapsed' as const };
    expect(getWarrantyCountdown(terms, Date.parse('2026-11-06T18:00:00Z'))).toMatchObject({ remainingMs: 86400000, percentRemaining: 50 });
    expect(getWarrantyCountdown(terms, Date.parse('2026-11-04T18:00:00Z')).percentRemaining).toBe(100);
    expect(getWarrantyCountdown({ ...terms, days: 0 }).remainingMs).toBe(0);
    expect(getWarrantyCountdown(terms, Date.parse('2026-11-09T18:00:00Z')).percentRemaining).toBe(0);
  });
  it('renders an accessible remaining-time meter or an explicit not-started state', () => {
    const html = renderToStaticMarkup(<WarrantyCountdown terms={{ startedAt: '2026-11-05T18:00:00Z', days: 2, policy: 'elapsed' }}
      now={Date.parse('2026-11-06T18:00:00Z')} />);
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('1 día');
    expect(renderToStaticMarkup(<WarrantyCountdown terms={null} />)).toContain('Comienza con la entrega física');
    const expired = renderToStaticMarkup(<WarrantyCountdown terms={{ startedAt: '2026-11-05T18:00:00Z', days: 0, policy: 'calendar' }} />);
    expect(expired).toContain('Garantía vencida');
    expect(expired).toContain('aria-valuenow="0"');
    expect(renderToStaticMarkup(<WarrantyCountdown terms={{ startedAt: '2026-11-05T18:00:00Z', days: 1, policy: 'elapsed' }}
      now={Date.parse('2026-11-06T17:59:30Z')} />)).toContain('0 días · 0 h · 1 min');
  });
});
