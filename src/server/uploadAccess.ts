import type { Claims } from './auth';
import { statusFromDatabase, YARD_QUEUE_STATUSES } from './orders';

const yardStatusScope = new Set(YARD_QUEUE_STATUSES.map((status) => statusFromDatabase(status)));

export const isYardScopedStatus = (status?: string | null) =>
  Boolean(status) && yardStatusScope.has(statusFromDatabase(String(status)));

/**
 * Adjuntos sin orden (avatares, logos) quedan visibles para cualquier sesión válida.
 * Oficina mantiene la lectura compartida de órdenes; yarda solo ve adjuntos de su cola.
 */
export const canReadOrderUpload = (
  claims: Pick<Claims, 'role'> | null,
  orderStatus?: string | null
): boolean => {
  if (!claims) return false;
  const role = String(claims.role || '').toLowerCase();
  if (role === 'admin' || role === 'operator') return true;
  if (role !== 'vendedor_yarda') return false;
  if (!orderStatus) return true;
  return isYardScopedStatus(orderStatus);
};
