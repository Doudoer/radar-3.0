import type { OrderStatus } from '../types';

export const YARD_ACTION_STATUSES: ReadonlySet<OrderStatus> = new Set(['pagado']);
export const YARD_REVERT_STATUSES: ReadonlySet<OrderStatus> = new Set(['pagado', 'en_preparacion']);
