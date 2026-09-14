import { Order } from '../types';
import { API_URL } from './apiBase';

const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!response.ok) throw new Error('No fue posible guardar los cambios en radar_db.');
  return response.json() as Promise<T>;
};

export const ordersApi = {
  list: () => request<Order[]>('/orders'),
  create: (order: Order) => request<Order>('/orders', { method: 'POST', body: JSON.stringify(order) }),
  update: (order: Order) => request<Order>(`/orders/${order.id}`, { method: 'PUT', body: JSON.stringify(order) }),
};