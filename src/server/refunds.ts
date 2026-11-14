import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RowDataPacket } from 'mysql2/promise';
import { pool } from './config';
import { requireRole, type Claims } from './auth';
import { sendJson } from './http';

const paymentMethodLabels: Record<string, string> = {
  zelle: 'Zelle',
  cashapp: 'CashApp',
  cash: 'Efectivo',
};

export const mapRefundRow = (row: Record<string, any>) => ({
  id: `REF-${row.id}`,
  orderId: String(row.order_id),
  orderCode: row.order_code || `ORD-${row.order_id}`,
  customerName: [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Cliente en Reembolso',
  customerPhone: row.customer_phone || '',
  vehicle: [row.year, row.brand, row.model].filter(Boolean).join(' ') || 'Vehículo',
  part: row.product_type || 'Refacción',
  reason: row.reason || '',
  amount: Number(row.amount || 0),
  amountType: row.amount_type || 'downpayment',
  paymentMethod: paymentMethodLabels[row.payment_method] || row.payment_method,
  paymentDetails: row.payment_contact || row.payment_details || '',
  status: row.status || 'pending',
  reviewStage: row.review_stage || undefined,
  refundScope: row.refund_scope || 'purchase',
  createdAt: row.created_at,
  completedAt: row.completed_at || undefined,
  completedBy: row.completed_by || undefined,
});

export const handleRefundsListRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  claims: Claims | null
): Promise<boolean> => {
  if (request.method !== 'GET' || pathname !== '/api/refunds') return false;
  if (!claims) {
    sendJson(response, 401, { message: 'Autenticación requerida' });
    return true;
  }
  if (!requireRole(response, claims, 'admin', 'operator')) return true;
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT r.*, o.order_code, o.brand, o.model, o.year, o.product_type,
           c.first_name, c.last_name, c.phone AS customer_phone
    FROM refund_requests r
    LEFT JOIN orders o ON o.id = r.order_id
    LEFT JOIN customers c ON c.id = o.customer_id
    ORDER BY r.created_at DESC
  `);
  sendJson(response, 200, rows.map(mapRefundRow));
  return true;
};
