import type { Order } from '../types';

const matchesOrderQuery = (order: Order, query: string) =>
  Boolean(
    (order.code && order.code.toLowerCase().includes(query)) ||
    (order.customer?.name && order.customer.name.toLowerCase().includes(query)) ||
    (order.vehicle?.make && order.vehicle.make.toLowerCase().includes(query)) ||
    (order.vehicle?.model && order.vehicle.model.toLowerCase().includes(query)) ||
    (order.vehicle?.plate && order.vehicle.plate.toLowerCase().includes(query)) ||
    (order.vehicle?.vin && order.vehicle.vin.toLowerCase().includes(query)) ||
    (order.mainPart && order.mainPart.toLowerCase().includes(query)) ||
    (order.stockNumber && order.stockNumber.toLowerCase().includes(query)) ||
    (order.vehicle?.year && String(order.vehicle.year).includes(query))
  );

export const mergeOrderSearchResults = (
  localOrders: Order[],
  serverOrders: Order[],
  rawQuery: string,
  limit = 30,
): Order[] => {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return localOrders.slice(0, 4);

  const results: Order[] = [];
  const seen = new Set<string>();
  for (const order of localOrders) {
    if (results.length >= limit) break;
    if (!seen.has(order.id) && matchesOrderQuery(order, query)) {
      seen.add(order.id);
      results.push(order);
    }
  }
  for (const order of serverOrders) {
    if (results.length >= limit) break;
    if (!seen.has(order.id)) {
      seen.add(order.id);
      results.push(order);
    }
  }
  return results;
};
