import type { Order } from '../types';

export type OrderWarrantyStatus = 'not_started' | 'active' | 'critical' | 'expired';

export interface OrderWarrantyInfo {
  status: OrderWarrantyStatus;
  daysLeft: number;
}

type WarrantyOrder = {
  deliveredAt?: string | Date | null;
  warrantyDays?: number;
  status?: Order['status'];
  warrantyStarted?: boolean;
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
  const warrantyDays = order.warrantyDays ?? 60;

  if (!order.warrantyStarted || !order.deliveredAt) {
    return { status: 'not_started', daysLeft: warrantyDays };
  }

  const deliveredAt = order.deliveredAt instanceof Date
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
