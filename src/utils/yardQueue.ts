import type { Order } from '../types';

export const YARD_QUEUE_PAGE_SIZE = 50;
export const YARD_QUEUE_MAX_PAGE_SIZE = 200;

export type YardQueueTab = 'all' | 'pending_yard' | 'yard_ready' | 'claims' | 'yard_sales';

export interface YardQueueCounts {
  all: number;
  pending_yard: number;
  yard_ready: number;
  claims: number;
  yard_sales: number;
}

export interface YardQueuePage {
  orders: Order[];
  counts: YardQueueCounts;
  nextOffset: number | null;
}

export const yardQueueCountsFromOrders = (orders: Order[]): YardQueueCounts => ({
  all: orders.length,
  pending_yard: orders.filter((order) => order.status === 'pagado' && !order.yardPieceReady).length,
  yard_ready: orders.filter((order) => order.status === 'pagado' && Boolean(order.yardPieceReady)).length,
  claims: orders.filter((order) => order.status === 'reclamo').length,
  yard_sales: orders.filter((order) => Boolean(order.isYardSale || order.advisorRole === 'vendedor_yarda')).length,
});

export const mergeYardOrders = (current: Order[], incoming: Order[]): Order[] => {
  const seen = new Set(current.map((order) => order.id));
  return [...current, ...incoming.filter((order) => !seen.has(order.id))];
};
