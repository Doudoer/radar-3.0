import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Icon } from '../src/components/Icon';
import { YardReadyAlertBar } from '../src/components/YardReadyAlertBar';
import type { Order } from '../src/types';

const now = Date.parse('2026-11-13T18:00:00.000Z');
const order = (overrides: Partial<Order> = {}) => ({
  id: 'ORD-901',
  code: 'ORD-901',
  status: 'pagado',
  customer: { name: 'Ana Torres' },
  yardPieceReady: true,
  yardPieceReadyAt: '2026-11-13T17:40:00.000Z',
  ...overrides,
} as Order);

describe('icon accessibility', () => {
  it('marks decorative icons as hidden from assistive tech by default', () => {
    const html = renderToStaticMarkup(<Icon name="grid_view" />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('material-symbols-outlined');
    expect(html).toContain('grid_view');
  });

  it('keeps a custom size without exposing the ligature', () => {
    const html = renderToStaticMarkup(<Icon name="search" size={28} />);
    expect(html).toContain('font-size:28px');
    expect(html).toContain('aria-hidden="true"');
  });
});

describe('operational alert strip', () => {
  it('stays amber, compact and pulse-free', () => {
    const html = renderToStaticMarkup(
      <YardReadyAlertBar alerts={[order()]} now={now} onOpenOrder={() => undefined} onNotifyCustomer={() => undefined} />
    );
    expect(html).toContain('bg-amber-400');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('animate-pulse');
    expect(html).toContain('truncate');
    expect(html).toContain('h-10');
  });

  it('keeps the actionable wording for both variants', () => {
    const sale = renderToStaticMarkup(
      <YardReadyAlertBar alerts={[order()]} now={now} onOpenOrder={() => undefined} onNotifyCustomer={() => undefined} />
    );
    expect(sale).toContain('Notificar cliente');
    const claim = renderToStaticMarkup(
      <YardReadyAlertBar
        variant="claim"
        alerts={[order({ status: 'reclamo', claimPieceReady: true, claimPieceReadyAt: '2026-11-13T17:00:00.000Z' })]}
        now={now}
        onOpenOrder={() => undefined}
        onNotifyCustomer={() => undefined}
      />
    );
    expect(claim).toContain('Atender');
  });
});
