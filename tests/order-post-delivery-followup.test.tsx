import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkflowActionForm } from '../src/components/OrderWorkflowPanel';
import { workflowTasks, type WorkflowOrder } from '../src/utils/orderWorkflow';

const delivered: WorkflowOrder = {
  id: '577', code: 'ORD-TEST', userId: 7, advisor: 'Test operator', version: 1,
  createdAt: '2026-10-22T16:00:00Z', status: 'entregado', deliveredAt: '2026-11-01T16:00:00Z',
  historicalDelivery: { paidAt: '2026-10-22T16:00:00Z', readyAt: null, deliveredAt: '2026-11-01T16:00:00Z' },
  scheduledPickupAt: null, total: 100, paid: 100,
};
describe('current post-delivery followup', () => {
  it('renders the verified pending milestone rather than the superseded contact-only timeline', () => {
    const task = workflowTasks(delivered, [], '2026-11-05')[0];
    const html = renderToStaticMarkup(<WorkflowActionForm task={task} onSaved={async () => {}} />);
    expect(html).toContain('Post-entrega · Día 3');
    expect(html).toContain('Canal de comunicación');
    expect(html).toContain('Detalle de la gestión');
    expect(html).toContain('Advertí verbalmente');
    expect(html).not.toContain('Evidencia o referencia verificable');
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain('14 DÍAS CLAVE');
  });
  it('does not invent milestones for orders outside the approved historical cutoff', () => {
    expect(workflowTasks({ ...delivered, createdAt: '2026-09-22T16:00:00Z' }, [], '2026-11-05')).toEqual([]);
  });
});
