import { InventoryPart } from '../types';
import { apiFetch } from './apiFetch';
import type { InventoryFilters } from '../utils/inventoryExport';

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
  download: async (filters: InventoryFilters = {}) => {
    const query = new URLSearchParams({
      query: filters.query || '', type: filters.type || 'all', status: filters.status || 'all',
    });
    const response = await apiFetch(`/inventory/export.csv?${query}`);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'No se pudo descargar el inventario.');
    }
    if (!response.headers.get('Content-Type')?.startsWith('text/csv')) throw new Error('El servidor no devolvió un archivo CSV.');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = `inventario-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
    } finally { URL.revokeObjectURL(url); }
  },
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
