import { fail } from './business';

export interface AuthScope {
  role?: string;
  sub?: string | number;
}

export interface OrderMutationRow {
  user_id?: unknown;
  followup_user_id?: unknown;
  [column: string]: unknown;
}

export const canMutateOrder = (
  claims: AuthScope | null | undefined,
  row: OrderMutationRow
): boolean => {
  if (!claims) return false;
  if (String(claims.role || '').toLowerCase() === 'admin') return true;
  const userId = Number(claims.sub);
  if (!Number.isFinite(userId)) return false;
  if (row.user_id != null && Number(row.user_id) === userId) return true;
  return row.followup_user_id != null && Number(row.followup_user_id) === userId;
};

export const assertOrderMutationAccess = (
  claims: AuthScope | null | undefined,
  row: OrderMutationRow
) => {
  if (!canMutateOrder(claims, row)) {
    fail(403, 'Solo el asesor asignado, un asesor con seguimiento o administración puede modificar esta orden.');
  }
};
