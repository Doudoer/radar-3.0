import { Order } from '../types';
import { apiFetch } from './apiFetch';

const readResponse = async <T>(response: Response): Promise<T> => {
  if (response.status === 401) throw new Error('Sesión expirada');
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || body.error || (response.status === 409
      ? 'La orden cambió. Actualiza los datos antes de volver a guardar.'
      : 'No fue posible guardar los cambios en radar_db.'));
  }
  return response.json() as Promise<T>;
};
const request = async <T>(path: string, options?: RequestInit): Promise<T> =>
  readResponse<T>(await apiFetch(path, options));

export const ordersApi = {
  list: async (): Promise<Order[]> => {
    const orders: Order[] = [];
    let offset = 0;
    for (;;) {
      const response = await apiFetch(`/orders?limit=1000&offset=${offset}`);
      const page = await readResponse<Order[]>(response);
      orders.push(...page);
      const next = response.headers.get('X-Next-Offset');
      if (next === null || next === '') break;
      const nextOffset = Number(next);
      if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset) throw new Error('Paginación de órdenes inválida.');
      offset = nextOffset;
    }
    return orders;
  },
  get: (orderId: string | number) => request<Order>(`/orders/${orderId}`),
  search: (q: string, limit = 30) => request<Order[]>(`/orders?q=${encodeURIComponent(q)}&limit=${limit}`),
  linkInventory: (orderId: string, inventoryPartId: number, version: number) =>
    request<Order>(`/orders/${orderId}/inventory`, {
      method: 'POST', body: JSON.stringify({ inventoryPartId, version, confirmedCompatibility: true }),
    }),
  create: (order: Order) => request<Order>('/orders', { method: 'POST', body: JSON.stringify(order) }),
  update: (order: Order) => request<Order>(`/orders/${order.id}`, { method: 'PUT', body: JSON.stringify(order) }),
  updateDeliveryDate: (orderId: string | number, payload: { deliveredAt: string; version?: number; reason: string }) => {
    if (!Number.isSafeInteger(payload.version) || Number(payload.version) < 1) {
      return Promise.reject(new Error('Actualiza la orden para obtener su versión antes de modificar la fecha.'));
    }
    return request<{ ok: boolean; deliveredAt: string; message: string }>(
      `/orders/${orderId}/delivery-date`,
      { method: 'PUT', body: JSON.stringify({ deliveredAt: payload.deliveredAt, version: payload.version, reason: payload.reason }) }
    );
  },
  requestRevertToPaidOtp: (orderId: string | number, payload: { reason: string }) =>
    request<{ ok: boolean; message: string; cooldownSeconds: number; targetPhoneMasked?: string }>(
      `/orders/${orderId}/revert-to-paid/request-otp`,
      { method: 'POST', body: JSON.stringify(payload) }
    ),
  revertToPaid: (orderId: string | number, payload: { code: string; reason: string; version?: number }) =>
    request<{ ok: boolean; message: string; newStatus: string }>(
      `/orders/${orderId}/revert-to-paid`,
      { method: 'POST', body: JSON.stringify(payload) }
    ),
  requestCancelOrderOtp: (orderId: string | number, payload: { reason: string; paymentMethod?: string }) =>
    request<{ ok: boolean; message: string; cooldownSeconds: number; targetPhoneMasked?: string; netPaidToRefund?: number }>(
      `/orders/${orderId}/cancel-admin/request-otp`,
      { method: 'POST', body: JSON.stringify(payload) }
    ),
  cancelOrderAdmin: (orderId: string | number, payload: { code: string; reason: string; paymentMethod?: string; version?: number }) =>
    request<{ ok: boolean; message: string; newStatus: string; netRefunded?: number }>(
      `/orders/${orderId}/cancel-admin`,
      { method: 'POST', body: JSON.stringify(payload) }
    ),
};