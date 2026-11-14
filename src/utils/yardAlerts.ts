import type { Order } from '../types';
import { YARD_REVERT_STATUSES } from './yardStatuses';

export const YARD_READY_URGENT_MINUTES = 15;

export const isYardReadyAlert = (order: Order) =>
  Boolean(order.yardPieceReady) && YARD_REVERT_STATUSES.has(order.status);

export const canRevertYardReady = (order: Order) => isYardReadyAlert(order);

export const isClaimPieceReadyAlert = (order: Order) =>
  order.status === 'reclamo' && Boolean(order.claimPieceReady);

export const canManageYardAlert = (order: Order, role?: string | null, userId?: number | null) =>
  role === 'admin' || (Boolean(order.userId) && order.userId === userId);

export const yardReadyAgeMinutes = (order: { yardPieceReadyAt?: string | null }, now = Date.now()): number | null => {
  if (!order.yardPieceReadyAt) return null;
  const readyAt = Date.parse(order.yardPieceReadyAt);
  if (!Number.isFinite(readyAt)) return null;
  return Math.max(0, Math.floor((now - readyAt) / 60_000));
};

export const formatYardReadyElapsed = (minutes: number | null) => {
  if (minutes === null) return 'recién marcada';
  if (minutes < 1) return 'hace menos de 1 min';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} d`;
};

export const isYardReadyUrgent = (minutes: number | null) =>
  minutes !== null && minutes >= YARD_READY_URGENT_MINUTES;
