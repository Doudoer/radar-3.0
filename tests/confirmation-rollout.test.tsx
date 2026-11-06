import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { completedWorkflowStages, validateWorkflowAction, workflowTasks, type WorkflowOrder, type WorkflowEvent } from '../src/utils/orderWorkflow';
import { WorkflowActionForm } from '../src/components/OrderWorkflowPanel';
import { workflowOrderFromRow } from '../src/server/orderWorkflow';
import type { RowDataPacket } from 'mysql2/promise';

const order: WorkflowOrder = {
  id: '1', code: 'TEST', userId: 7, advisor: 'Test operator', version: 1,
  createdAt: '2026-10-21T16:00:00Z', status: 'pagado', deliveredAt: null,
  scheduledPickupAt: null, total: 100, paid: 100,
  confirmationPolicy: 'preapproved', confirmationPolicyAt: '2026-11-05T16:00:00Z',
};
const legacy = { ...order, confirmationPolicy: 'legacy' as const };
const management = { task: 'ack' as const, outcome: 'completed' as const, notes: 'Cliente confirma', evidence: 'Conversation reference', confirmed: true, nextDueDate: '2026-11-06' };
describe('one-time confirmation rollout policy', () => {
  it('preapproves the confirmation step only, not payment status, preparation or delivery', () => {
    expect(completedWorkflowStages([], order)).toEqual(['quote', 'ack']);
    expect(workflowTasks(order, [], '2026-11-05')[0]).toMatchObject({ task: 'prepare', dueDate: '2026-11-06' });
    expect(order.status).toBe('pagado');
    expect(() => validateWorkflowAction(order, [], management, '2026-11-05')).toThrow(/etapa/);
  });
  it('keeps the snapshot decision even if a historical order later changes status or receives money', () => {
    expect(completedWorkflowStages([], { ...order, status: 'cotizacion' })).toContain('ack');
    expect(completedWorkflowStages([], { ...legacy, status: 'pagado', paid: 100 })).toEqual(['quote']);
    expect(() => validateWorkflowAction(legacy, [], management, '2026-11-05')).not.toThrow();
    expect(() => validateWorkflowAction(legacy, [], { ...management, nextDueDate: undefined }, '2026-11-05')).toThrow(/fecha/);
    expect(() => validateWorkflowAction(legacy, [], { ...management, evidence: '' }, '2026-11-05')).toThrow(/evidencia/);
  });
  it('requires new documentation only for post-rollout orders regardless of current paid status', () => {
    const fresh = { ...order, confirmationPolicy: 'documented' as const, confirmationPolicyAt: null };
    expect(completedWorkflowStages([], fresh)).toEqual(['quote']);
    expect(() => validateWorkflowAction(fresh, [], management, '2026-11-05')).toThrow();
    expect(() => validateWorkflowAction(fresh, [], { task: 'ack', outcome: 'completed', notes: '', downpayment: [{ method: 'zelle', amount: 100, receipt: '/uploads/test.png' }] }, '2026-11-05')).not.toThrow();
  });
  it('does not use preapproval to bypass an explicit reopening', () => {
    const reopened: WorkflowEvent = {
      id: '1', task: 'ack', outcome: 'reopened', notes: 'Order reactivated', evidence: '',
      actorId: 7, actorName: 'Test operator', createdAt: '2026-11-06T16:00:00Z',
      nextDueDate: '2026-11-09', nextAction: null, blockedBy: null, scheduledAt: null, contactResult: null, partStatus: null,
    };
    expect(completedWorkflowStages([reopened], order)).toEqual(['quote']);
    expect(workflowTasks(order, [reopened], '2026-11-06')[0].task).toBe('ack');
    expect(() => validateWorkflowAction(order, [reopened], { ...management, nextDueDate: '2026-11-09' }, '2026-11-06')).not.toThrow();
  });
  it('shows the old form for historical non-preapproved orders and the new form for new orders', () => {
    const oldHtml = renderToStaticMarkup(<WorkflowActionForm task={workflowTasks(legacy, [], '2026-11-05')[0]} onSaved={async () => {}} />);
    expect(oldHtml).toContain('Detalle de la gestión');
    expect(oldHtml).not.toContain('type="file"');
    const newHtml = renderToStaticMarkup(<WorkflowActionForm task={workflowTasks({ ...order, confirmationPolicy: 'documented' }, [], '2026-11-05')[0]} onSaved={async () => {}} />);
    expect(newHtml).toContain('Guardar confirmación');
    expect(newHtml).not.toContain('Detalle de la gestión');
  });
  it('maps only server rollout metadata, rejecting unknown policies', () => {
    const row = { id: 1, order_code: 'TEST', version: 1, created_at: order.createdAt, status: 'Pagado', confirmation_policy: 'preapproved', confirmation_policy_at: order.confirmationPolicyAt } as RowDataPacket;
    expect(workflowOrderFromRow(row)).toMatchObject({ confirmationPolicy: 'preapproved', confirmationPolicyAt: new Date(order.confirmationPolicyAt!).toISOString() });
    expect(workflowOrderFromRow({ ...row, confirmation_policy: null, confirmation_policy_at: null } as RowDataPacket).confirmationPolicy).toBe('documented');
    expect(() => workflowOrderFromRow({ ...row, confirmation_policy: 'invalid' } as RowDataPacket)).toThrow(/confirmación/i);
  });
});
