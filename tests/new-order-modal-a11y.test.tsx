import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NewOrderModal } from '../src/components/NewOrderModal';

describe('NewOrderModal accessibility contract', () => {
  it('renders as a labelled modal dialog with focusable container', () => {
    const html = renderToStaticMarkup(
      <NewOrderModal isOpen onClose={() => {}} onCreateOrder={async () => {}} />
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="new-order-title"');
    expect(html).toContain('id="new-order-title"');
    expect(html).toContain('tabindex="-1"');
  });
});
