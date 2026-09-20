import { describe, expect, it } from 'vitest';
import { canTransitionOrderStatus, getAllowedNextStatuses, requiresStatusAuthorization } from '../src/utils/orderStatusRules';

describe('order status rules', () => {
  it('allows normal forward transitions and unchanged statuses', () => {
    expect(canTransitionOrderStatus('cotizacion', 'pagado')).toBe(true);
    expect(canTransitionOrderStatus('en_preparacion', 'listo_despacho')).toBe(true);
    expect(canTransitionOrderStatus('pagado', 'pagado')).toBe(true);
  });

  it('blocks transitions not declared by the workflow', () => {
    expect(canTransitionOrderStatus('cotizacion', 'entregado')).toBe(false);
    expect(canTransitionOrderStatus('archivado', 'pagado')).toBe(false);
    expect(getAllowedNextStatuses('archivado')).toEqual([]);
  });

  it('requires authorization when reversing a refund request', () => {
    expect(requiresStatusAuthorization('solicitud_reembolso', 'pagado')).toBe(true);
    expect(requiresStatusAuthorization('solicitud_reembolso', 'cotizacion')).toBe(true);
    expect(requiresStatusAuthorization('solicitud_reembolso', 'reembolsado')).toBe(false);
  });
});
