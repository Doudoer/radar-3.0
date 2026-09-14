import { Order } from '../types';
import { apiFetch } from './apiFetch';

const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await apiFetch(path, options);
  if (!response.ok) throw new Error('No fue posible guardar los cambios en radar_db.');
  return response.json() as Promise<T>;
};

export const ordersApi = {
  list: () => request<Order[]>('/orders'),
  create: (order: Order) => request<Order>('/orders', { method: 'POST', body: JSON.stringify(order) }),
  update: (order: Order) => request<Order>(`/orders/${order.id}`, { method: 'PUT', body: JSON.stringify(order) }),
};