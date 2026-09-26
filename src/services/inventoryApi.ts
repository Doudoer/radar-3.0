import { InventoryPart } from '../types';
import { apiFetch } from './apiFetch';

const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await apiFetch(path, options);
  if (response.status === 401) throw new Error('Sesión expirada');
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || 'No fue posible completar la operación en el inventario.');
  }
  return response.json() as Promise<T>;
};

export const inventoryApi = {
  list: () => request<InventoryPart[]>('/inventory'),
  get: (id: string | number) => request<InventoryPart>(`/inventory/${id}`),
  create: (data: Partial<InventoryPart>) =>
    request<InventoryPart>('/inventory', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string | number, data: Partial<InventoryPart>) =>
    request<InventoryPart>(`/inventory/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string | number) =>
    request<{ ok: boolean; id: number }>(`/inventory/${id}`, {
      method: 'DELETE',
    }),
};
