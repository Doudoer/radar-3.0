import { z } from 'zod';
import crypto from 'node:crypto';
import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { orderPayloadSchema } from './schemas';
import { canTransitionOrderStatus } from '../utils/orderStatusRules';
import { OrderStatus } from '../types';
import { statusFromDatabase } from './orders';

export const fail = (statusCode: number, message: string): never => {
  throw Object.assign(new Error(message), { statusCode });
};

export const cents = (value: unknown) => Math.round(Number(value ?? 0) * 100);
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => [key,canonical(item)]));
  }
  return value;
}
export async function beginIdempotentRequest(connection: PoolConnection, operation: string, key: string, userId: number, payload: unknown) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
  await connection.execute(
    'INSERT IGNORE INTO api_idempotency (operation,request_key,user_id,request_hash) VALUES (?,?,?,?)',
    [operation,key,userId,hash],
  );
  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT * FROM api_idempotency WHERE operation=? AND request_key=? FOR UPDATE', [operation,key],
  );
  if (Number(rows[0].user_id) !== userId || rows[0].request_hash !== hash) fail(409, 'Esta clave ya corresponde a otra operación');
  return rows[0].resource_id ? Number(rows[0].resource_id) : null;
}
export async function finishIdempotentRequest(connection: PoolConnection, operation: string, key: string, id: number) {
  await connection.execute('UPDATE api_idempotency SET resource_id=? WHERE operation=? AND request_key=?', [id,operation,key]);
}
type Payload = z.infer<typeof orderPayloadSchema>;

export function validateOrder(order: Payload, previous?: RowDataPacket, role = 'admin') {
  if (!order.customer || !order.vehicle || !order.financials || !order.mainPart || !order.status) {
    fail(400, 'La orden completa es obligatoria');
  }
  const financials = order.financials!;
  const total = cents(financials.partPrice) + cents(financials.coreFee) + cents(financials.deliveryFee);
  const paid = cents(financials.downPayment);
  const oldStatus = previous ? statusFromDatabase(previous.status) : undefined;
  const changedStatus = oldStatus !== order.status;
  const enteringPaid = order.status === 'pagado' && oldStatus !== 'pagado';
  if (order.deliveredAt && Date.parse(order.deliveredAt) > Date.now()) fail(400, 'La fecha de entrega no puede ser futura');
  if (!previous?.delivered_at && order.status !== 'entregado' && (order.deliveredAt || order.warrantyStarted)) {
    fail(400, 'La garantía y fecha de entrega solo se registran con la entrega física');
  }
  if (paid > total) fail(400, 'El importe cobrado no puede superar el total');
  if (enteringPaid && paid <= 0) {
    fail(400, 'Pagado requiere registrar el downpayment recibido');
  }
  if (order.deliveryType === 'envio_domicilio' && !order.customer!.shippingAddress?.trim()) {
    fail(400, 'La dirección de entrega es obligatoria');
  }
  if (previous) {
    if (order.version !== Number(previous.version)) fail(409, 'La orden cambió. Actualiza los datos antes de guardar');
    if (changedStatus && !canTransitionOrderStatus(oldStatus as OrderStatus, order.status!)) {
      fail(409, 'Transición de estado no permitida');
    }
    if (changedStatus && ['reclamo', 'solicitud_reembolso', 'reembolsado'].includes(order.status!)) {
      fail(400, 'Usa la vista de Reclamos o Reembolsos para registrar esta operación');
    }
    if (changedStatus && ['reclamo','solicitud_reembolso'].includes(oldStatus!)) {
      fail(400, 'Cierra la incidencia desde la vista de Reclamos o Reembolsos');
    }
    if (previous.delivered_at && (!order.deliveredAt ||
        new Date(previous.delivered_at).getTime() !== Date.parse(order.deliveredAt))) {
      fail(400, 'Corrige la fecha de entrega desde su accion administrativa con motivo y version');
    }
    if (role !== 'admin') {
      const financialChange = cents(previous.price) !== cents(financials.partPrice) ||
        cents(previous.core_fee) !== cents(financials.coreFee) ||
        cents(previous.shipping_cost) !== cents(financials.deliveryFee) ||
        cents(previous.down_payment) !== paid;
      const assigned = order.userId ?? previous.user_id;
      if (financialChange || Number(assigned) !== Number(previous.user_id) ||
          Boolean(order.isYardSale) !== Boolean(previous.is_yard_sale) ||
          (changedStatus && (order.status === 'cancelado' || ['cancelado', 'archivado'].includes(oldStatus!)))) {
        fail(403, 'Solo administración puede cambiar finanzas, asignación, cancelación o reactivación');
      }
      if (previous.delivered_at && order.deliveredAt &&
          new Date(previous.delivered_at).getTime() !== Date.parse(order.deliveredAt)) {
        fail(403, 'Solo administración puede modificar la fecha de entrega');
      }
    }
    if (order.customer!.id !== String(previous.customer_id)) {
      fail(400, 'El cliente de una orden no se puede sustituir mediante una edición');
    }
  } else if (['reclamo', 'solicitud_reembolso', 'reembolsado'].includes(order.status!)) {
    fail(400, 'Registra primero la orden y después la incidencia o devolución');
  }
  const newDelivery = order.status === 'entregado' && oldStatus !== 'entregado';
  if (newDelivery && paid !== total) {
    fail(400, 'Para marcar Entregado, liquida el saldo pendiente antes de la entrega');
  }
  if (newDelivery && !order.deliveredAt) order.deliveredAt = new Date().toISOString();
  if (newDelivery && Date.parse(order.deliveredAt!) > Date.now()) fail(400, 'La entrega no puede ser futura');
  if (newDelivery) order.warrantyStarted = true;
  return order;
}

export async function recordPaymentChange(connection: PoolConnection, orderId: number, paid: number, previousPaid: number, userId: number) {
  const difference = cents(paid) - cents(previousPaid);
  if (difference < 0) fail(400, 'No reduzcas cobros existentes: registra una devolución');
  if (!difference) return;
  await connection.execute(
    `INSERT INTO finance_movements (order_id,kind,amount,effective_at,source,reference_key,user_id)
     VALUES (?,'payment',?,UTC_TIMESTAMP(),'order_payment',?,?)`,
    [orderId, difference / 100, `payment-${orderId}-${crypto.randomUUID()}`, userId],
  );
}

export async function syncInventory(connection: PoolConnection, orderId: number, inventoryPartId: number | null | undefined, status: string) {
  if (!inventoryPartId) return;
  const [parts] = await connection.query<RowDataPacket[]>(
    'SELECT id,status FROM inventory_parts WHERE id=? AND deleted_at IS NULL FOR UPDATE', [inventoryPartId],
  );
  if (!parts[0]) fail(404, 'Pieza de inventario no encontrada');
  const [other] = await connection.query<RowDataPacket[]>(
    "SELECT id FROM orders WHERE inventory_part_id=? AND id<>? AND deleted_at IS NULL AND status NOT IN ('Cancelado','Reembolsado') LIMIT 1",
    [inventoryPartId, orderId],
  );
  if (other.length) fail(409, 'Esta pieza ya está reservada o vendida en otra orden');
  const nextStatus = status === 'cancelado' ? 'disponible' : status === 'entregado' ? 'vendido' : 'reservado';
  if (parts[0].status === 'vendido' && nextStatus === 'reservado') fail(409, 'La pieza ya fue vendida');
  await connection.execute(
    "UPDATE inventory_parts SET status=?, sold_at=IF(?='vendido',COALESCE(sold_at,UTC_TIMESTAMP()),sold_at) WHERE id=?",
    [nextStatus, nextStatus, inventoryPartId],
  );
}
