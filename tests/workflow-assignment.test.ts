import { describe, expect, it } from 'vitest';
import { workflowTaskAssignee, type WorkflowOrder } from '../src/utils/orderWorkflow';
import { assertWorkflowAssignee, workflowOrderFromRow } from '../src/server/orderWorkflow';
import { assertPaymentAccess } from '../src/server/orderPayments';
import type { RowDataPacket } from 'mysql2/promise';

const order: WorkflowOrder = {
  id: '1', code: 'TEST', userId: 7, advisor: 'Seller', version: 1, createdAt: '2026-11-01T16:00:00Z',
  status: 'entregado', deliveredAt: '2026-11-02T16:00:00Z', total: 100, paid: 100, scheduledPickupAt: null,
};
describe('independent followup assignment', () => {
  it('keeps commercial ownership and routes delivered followup and incidents to the designated advisor', () => {
    const assigned = { ...order, followupUserId: 8, followupAdvisor: 'Followup advisor' };
    expect(workflowTaskAssignee(assigned, 'prepare')).toEqual({ userId: 7, name: 'Seller' });
    expect(workflowTaskAssignee(assigned, 'post_3')).toEqual({ userId: 8, name: 'Followup advisor' });
    expect(workflowTaskAssignee({ ...assigned, status: 'reclamo' }, 'incident')).toEqual({ userId: 8, name: 'Followup advisor' });
    expect(() => assertWorkflowAssignee(assigned, { sub: '8', role: 'operator' }, 'post_3')).not.toThrow();
    expect(() => assertWorkflowAssignee(assigned, { sub: '7', role: 'operator' }, 'post_3')).toThrow(/asignado/);
    expect(() => assertWorkflowAssignee(assigned, { sub: '8', role: 'operator' }, 'prepare')).toThrow(/asignado/);
    expect(() => assertWorkflowAssignee(assigned, { sub: '9', role: 'admin' }, 'post_3')).not.toThrow();
  });
  it('leaves yard sales unassigned until admin chooses an advisor; normal sales default to their seller', () => {
    expect(workflowTaskAssignee(order, 'post_7')).toEqual({ userId: 7, name: 'Seller' });
    expect(workflowTaskAssignee({ ...order, isYardSale: true }, 'post_7')).toEqual({ userId: null, name: 'Pendiente de asignación' });
    expect(workflowTaskAssignee({ ...order, isYardSale: true }, 'prepare')).toEqual({ userId: 7, name: 'Seller' });
    expect(workflowTaskAssignee({ ...order, followupUserId: 8 }, 'post_14')).toEqual({ userId: 8, name: 'Asesor asignado' });
    expect(workflowTaskAssignee({ ...order, followupUserId: 8, deliveredAt: null, status: 'reclamo' }, 'incident')).toEqual({ userId: 7, name: 'Seller' });
    expect(workflowTaskAssignee({ ...order, followupUserId: 8, deliveredAt: null, status: 'pagado' }, 'post_3')).toEqual({ userId: 7, name: 'Seller' });
  });
  it('maps followup identity independently without modifying sales or warranty metadata', () => {
    const row = { id: 1, order_code: 'TEST', version: 2, created_at: order.createdAt, delivered_at: order.deliveredAt,
      status: 'Entregado', user_id: 7, advisor: 'Seller', is_yard_sale: 1, followup_user_id: 8, followup_advisor: 'Advisor' } as RowDataPacket;
    expect(workflowOrderFromRow(row)).toMatchObject({ userId: 7, advisor: 'Seller', followupUserId: 8, followupAdvisor: 'Advisor', isYardSale: true });
    expect(workflowOrderFromRow({ ...row, is_yard_sale: 0, advisor_role: 'vendedor_yarda' } as RowDataPacket).isYardSale).toBe(true);
  });
  it('grants the assigned advisor read/upload access after delivery, never collection rights or access before delivery', () => {
    const row = { user_id: 7, followup_user_id: 8, delivered_at: order.deliveredAt } as RowDataPacket;
    expect(() => assertPaymentAccess(row, { sub: '8', role: 'operator' }, true)).not.toThrow();
    expect(() => assertPaymentAccess(row, { sub: '8', role: 'operator' })).toThrow();
    expect(() => assertPaymentAccess({ ...row, delivered_at: null } as RowDataPacket, { sub: '8', role: 'operator' }, true)).toThrow();
    expect(() => assertPaymentAccess({ ...row, delivered_at: null, delivery_log_at: order.deliveredAt } as RowDataPacket, { sub: '8', role: 'operator' }, true)).not.toThrow();
  });
});
