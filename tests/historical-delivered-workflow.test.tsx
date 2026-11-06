import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RowDataPacket } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { workflowOrderFromRow } from '../src/server/orderWorkflow';
import { completedWorkflowStages, workflowTasks } from '../src/utils/orderWorkflow';
import { HistoricalWorkflowStage } from '../src/components/OrderWorkflowPanel';
import { OrderDetailView } from '../src/components/OrderDetailView';
import { mapOrder } from '../src/server/orders';
import type { Order } from '../src/types';

const row = { id: 1, order_code: 'TEST', version: 1, created_at: '2026-10-22T16:00:00Z',
  status: 'Entregado', delivered_at: null, delivery_log_at: '2026-11-01T18:35:12Z',
  historical_paid_at: '2026-10-25T14:12:34Z', historical_ready_at: null,
  price: 100, down_payment: 100 } as RowDataPacket;
describe('automatically regularized delivered orders', () => {
  it('completes all commercial stages from delivered status without creating workflow events or collecting money', () => {
    const order = workflowOrderFromRow(row);
    expect(completedWorkflowStages([], order)).toEqual(['quote', 'ack', 'prepare', 'delivery']);
    expect(order.deliveredAt).toBe('2026-11-01T18:35:12.000Z');
    expect(order.historicalDelivery?.paidAt).toBe('2026-10-25T14:12:34.000Z');
    expect(workflowTasks(order, [], '2026-11-05')[0]).toMatchObject({ task: 'post_3', objectiveDueDate: '2026-11-04' });
  });
  it('prefers the physical delivery timestamp and never invents missing historical dates', () => {
    const physical = workflowOrderFromRow({ ...row, delivered_at: '2026-11-01T17:01:02Z' } as RowDataPacket);
    expect(physical.historicalDelivery?.deliveredAt).toBe('2026-11-01T17:01:02.000Z');
    const missing = workflowOrderFromRow({ ...row, delivery_log_at: null, historical_paid_at: null } as RowDataPacket);
    expect(completedWorkflowStages([], missing)).toHaveLength(4);
    expect(missing.historicalDelivery).toEqual({ paidAt: null, readyAt: null, deliveredAt: null });
    expect(workflowTasks(missing, [], '2026-11-05')).toEqual([]);
    const html = renderToStaticMarkup(<HistoricalWorkflowStage order={missing} stage="ack" />);
    expect(html).toContain('Fecha no registrada');
    expect(html).not.toContain('Invalid Date');
  });
  it('shows the real paid and delivery timestamps, identifying preparation as historical rather than invented contact', () => {
    const order = workflowOrderFromRow(row);
    const confirmation = renderToStaticMarkup(<HistoricalWorkflowStage order={order} stage="ack" />);
    expect(confirmation).toContain('2026-10-25T14:12:34.000Z');
    const delivery = renderToStaticMarkup(<HistoricalWorkflowStage order={order} stage="delivery" />);
    expect(delivery).toContain('2026-11-01T18:35:12.000Z');
    const preparation = renderToStaticMarkup(<HistoricalWorkflowStage order={order} stage="prepare" />);
    expect(preparation).toContain('Regularizada por entrega histórica');
    expect(preparation).not.toContain('Llamada contestada');
  });
  it('keeps unpaid/ready orders subject to their existing checks and exposes the verified flow even for older delivered orders', () => {
    const ready = workflowOrderFromRow({ ...row, status: 'Listo para Retiro' } as RowDataPacket);
    expect(ready.historicalDelivery).toBeNull();
    expect(completedWorkflowStages([], ready)).toEqual(['quote']);
    const old = { ...row, created_at: '2026-09-01T16:00:00Z' } as RowDataPacket;
    expect(completedWorkflowStages([], workflowOrderFromRow(old))).toHaveLength(4);
    const html = renderToStaticMarkup(<OrderDetailView order={mapOrder(old) as Order} onBack={() => {}} onOpenSMS={() => {}} userRole="admin" />);
    expect(html).toContain('Flujo verificable');
    expect(html).toContain('Gestionar flujo verificable');
  });
});
