import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OrderQuotationSummary } from '../src/components/OrderWorkflowPanel';
import type { WorkflowOrder } from '../src/utils/orderWorkflow';

const order: WorkflowOrder = {
  id: '901', code: 'TEST', userId: 7, advisor: 'Current assignee', version: 1,
  createdAt: '2026-10-21T16:00:00Z', status: 'cotizacion', deliveredAt: null,
  scheduledPickupAt: null, total: 100, paid: 0,
};
describe('automatic quotation summary', () => {
  it('shows creation date and original agent without a quotation form', () => {
    const html = renderToStaticMarkup(<OrderQuotationSummary order={{ ...order, quoteCreatedBy: 'Original agent' }} />);
    expect(html).toContain('Completada al crear la orden');
    expect(html).toContain('Fecha de creación de la cotización');
    expect(html).toMatch(/datetime="2026-10-21T16:00:00Z"/i);
    expect(html).toContain('Original agent');
    expect(html).not.toContain('Current assignee');
    expect(html).not.toMatch(/<form|<input|<textarea/);
  });
  it('does not attribute historical creation to the current assignee when the creator is unknown', () => {
    const html = renderToStaticMarkup(<OrderQuotationSummary order={order} />);
    expect(html).toContain('No registrado');
    expect(html).not.toContain('Current assignee');
  });
});
