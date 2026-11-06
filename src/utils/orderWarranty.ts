import type { Order } from '../types';
import { warrantyDeadline, type WarrantyTerms } from './aftersales';
import { workflowDate } from './orderWorkflow';

export type OrderWarrantyStatus = 'not_started' | 'active' | 'critical' | 'expired';

export interface OrderWarrantyInfo {
  status: OrderWarrantyStatus;
  daysLeft: number;
}

export function getWarrantyCountdown(terms: WarrantyTerms, now = Date.now()) {
  const start = Date.parse(terms.startedAt);
  let end = start + terms.days * 86400000;
  if (terms.policy === 'calendar' && terms.days > 0) {
    const deadline = warrantyDeadline(terms);
    // Locate the first instant after the final business day, including DST changes.
    let low = Date.parse(`${deadline}T00:00:00Z`);
    let high = low + 48 * 3600000;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (workflowDate(new Date(middle)) <= deadline) low = middle;
      else high = middle;
    }
    end = high;
  }
  const remainingMs = terms.days === 0 ? 0 : Math.max(0, end - Math.max(start, now));
  const duration = end - start;
  return { endsAt: new Date(end).toISOString(), remainingMs,
    percentRemaining: duration > 0 ? Math.min(100, Math.max(0, remainingMs / duration * 100)) : 0 };
}

type WarrantyOrder = {
  deliveredAt?: string | Date | null;
  warrantyDays?: number;
  status?: Order['status'];
  warrantyStarted?: boolean;
  warrantyTerms?: WarrantyTerms | null;
};

export const getClaimWarrantyError = (
  order: WarrantyOrder,
  now = Date.now(),
): string | null =>
  getOrderWarrantyInfo(order, now).status === 'expired'
    ? 'No se puede registrar un reclamo: la garantía de la orden expiró.'
    : null;

export const getOrderWarrantyInfo = (
  order: WarrantyOrder,
  now = Date.now(),
): OrderWarrantyInfo => {
  const warrantyDays = order.warrantyTerms?.days ?? order.warrantyDays ?? 60;

  if (!order.warrantyStarted || !order.deliveredAt) {
    return { status: 'not_started', daysLeft: warrantyDays };
  }

  if (order.warrantyTerms?.policy === 'calendar') {
    const today = workflowDate(new Date(now));
    const deadline = warrantyDeadline(order.warrantyTerms);
    if (today > deadline || warrantyDays === 0) return { status: 'expired', daysLeft: 0 };
    const daysLeft = Math.max(0, Math.round((Date.parse(deadline) - Date.parse(today)) / 86400000));
    return { status: daysLeft > 10 ? 'active' : 'critical', daysLeft };
  }
  const deliveredAt = order.warrantyTerms ? Date.parse(order.warrantyTerms.startedAt) : order.deliveredAt instanceof Date
    ? order.deliveredAt.getTime()
    : Date.parse(order.deliveredAt);
  if (!Number.isFinite(deliveredAt)) {
    return { status: 'not_started', daysLeft: warrantyDays };
  }

  const elapsedDays = Math.floor((now - deliveredAt) / (1000 * 60 * 60 * 24));
  const daysLeft = Math.max(0, warrantyDays - elapsedDays);

  if (daysLeft === 0) return { status: 'expired', daysLeft };
  return { status: daysLeft > 10 ? 'active' : 'critical', daysLeft };
};
