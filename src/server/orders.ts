import { RowDataPacket } from 'mysql2/promise';
import { pool } from './config';

export const statusToDatabase: Record<string, string> = {
  cotizacion: 'Cotización',
  espera_confirmacion: 'En Espera Confirmación',
  pagado: 'Pagado',
  en_preparacion: 'En Preparación',
  listo_despacho: 'Listo para Despacho',
  listo_retiro: 'Listo para Retiro',
  en_camino: 'En Camino',
  entregado: 'Entregado',
  reclamo: 'Reclamo',
  cancelado: 'Cancelado',
  solicitud_reembolso: 'Solicitud Reembolso',
  reembolsado: 'Reembolsado',
  archivado: 'Archivado',
};

export const statusFromDatabase = (value: string) => {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '');
  const aliases: Record<string, string> = {
    en_espera_confirmacion: 'espera_confirmacion',
    listo_para_despacho: 'listo_despacho',
    listo_para_retiro: 'listo_retiro',
    solicitud_reembolso: 'solicitud_reembolso',
  };
  return aliases[normalized] || normalized || 'cotizacion';
};

export const mapOrder = (row: RowDataPacket) => {
  const customerName = [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Cliente sin nombre';
  const price = Number(row.price || 0);
  const deliveryFee = Number(row.shipping_cost || 0);
  const coreFee = Number(row.core_fee || 0);
  const downPayment = Number(row.down_payment || 0);

  return {
    id: String(row.id),
    code: row.order_code,
    createdAt: new Date(row.created_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }),
    advisor: row.advisor || 'Sin asignar',
    status: statusFromDatabase(row.status),
    mainPart: row.product_type || 'Refacción',
    productSpecs: row.product_specs || '',
    stockNumber: row.stock_nr || '',
    workflowStep: row.workflow_step || 1,
    scheduledPickupAt: row.scheduled_pickup_at ? new Date(row.scheduled_pickup_at).toISOString().slice(0, 16) : undefined,
    customer: {
      id: String(row.customer_id || ''),
      name: customerName,
      type: 'Particular',
      email: row.email || '',
      phone: row.phone || '',
      location: row.address_shipping || 'Sin dirección registrada',
      shippingAddress: row.address_shipping || '',
      zip_code: row.zip_code || '',
      initials: customerName.split(' ').map((name: string) => name[0]).join('').slice(0, 2).toUpperCase(),
    },
    vehicle: {
      vin: row.vin_nr || '',
      plate: '',
      make: row.brand || '',
      model: row.model || '',
      year: row.year || new Date().getFullYear(),
      trim: row.sub_model || '',
      transmission: row.transmission_type || '',
      mileage: '',
      color: row.color || '',
    },
    financials: {
      partPrice: price,
      baseMSRP: price,
      downPayment,
      advancePayment: downPayment,
      deliveryFee,
      coreFee,
      subtotal: price + deliveryFee + coreFee,
      total: price + deliveryFee + coreFee,
      balanceDue: Math.max(0, price + deliveryFee + coreFee - downPayment),
    },
    deliveryType: row.shipping_toggle ? 'envio_domicilio' : 'retiro_tienda',
    warrantyDays: row.warranty_days || 60,
    deliveredAt: row.delivered_at ? new Date(row.delivered_at).toISOString() : undefined,
    warrantyStarted: Boolean(row.warranty_started),
    claimReason: row.claim_reason || undefined,
    notes: row.description || '',
  };
};

export const toMysqlDateTime = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const pad = (number: number) => number.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

export const getOrders = async () => {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT o.*, c.first_name, c.last_name, c.phone, c.email, c.address_shipping, c.zip_code, u.name AS advisor
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN users u ON u.id = o.user_id
    WHERE o.deleted_at IS NULL
    ORDER BY o.created_at DESC
  `);
  return rows.map(mapOrder);
};
