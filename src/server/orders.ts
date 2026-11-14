import { RowDataPacket } from 'mysql2/promise';
import { pool } from './config';
import { mapInventoryPartRow } from './inventory';
import { matchOrderInventory } from '../utils/inventoryMatching';
import { preparationSchema } from '../utils/orderPreparation';
import { warrantyTermsSchema, type WarrantyTerms } from '../utils/aftersales';
import type { Order, OrderStatus } from '../types';

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

export const statusFromDatabase = (value: string): OrderStatus => {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '');
  const aliases: Record<string, string> = {
    en_espera_de_confirmacion: 'espera_confirmacion',
    solicitud_de_reembolso: 'solicitud_reembolso',
    en_espera_confirmacion: 'espera_confirmacion',
    listo_para_despacho: 'listo_despacho',
    listo_para_retiro: 'listo_retiro',
    solicitud_reembolso: 'solicitud_reembolso',
  };
  return (aliases[normalized] || normalized || 'cotizacion') as OrderStatus;
};

const parseJsonColumn = <T = any>(value: unknown): T | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const parseWarrantyTerms = (value: unknown): WarrantyTerms | null => {
  const parsed = parseJsonColumn(value);
  if (!parsed) return null;
  const result = warrantyTermsSchema.safeParse(parsed);
  return result.success ? result.data : null;
};

const parsePreparation = (value: unknown): ReturnType<typeof preparationSchema.parse> | null => {
  const parsed = parseJsonColumn(value);
  if (!parsed) return null;
  const result = preparationSchema.safeParse(parsed);
  return result.success ? result.data : null;
};

export const normalizeTransmissionType = (value?: string | null): 'AT' | 'MT' | null => {
  if (!value) return null;
  const str = String(value).trim().toUpperCase();
  if (str === 'AT' || str === 'MT') return str;
  if (/MANUAL|MT|ESTANDAR|ESTÁNDAR|MECANICA|MECÁNICA/.test(str)) return 'MT';
  if (/AUTO|AT|AUTOMATICA|AUTOMÁTICA|CVT|DCT|SPEED/.test(str)) return 'AT';
  return null;
};

export function warrantyFromRow(row: RowDataPacket): WarrantyTerms | null {
  if (row.warranty_terms) {
    const parsed = parseWarrantyTerms(row.warranty_terms);
    if (parsed) return parsed;
  }
  const deliveredAt = row.delivered_at || row.delivery_log_at;
  return deliveredAt ? { startedAt: new Date(deliveredAt).toISOString(), days: Number(row.warranty_days ?? 60), policy: 'elapsed' } : null;
}

export const mapOrder = (row: RowDataPacket, auctionLinks: any[] = []): Order => {
  const customerName = row.contact_name ?? ([row.first_name, row.last_name].filter(Boolean).join(' ') || 'Cliente sin nombre');
  const price = Number(row.price || 0);
  const deliveryFee = Number(row.shipping_cost || 0);
  const coreFee = Number(row.core_fee || 0);
  const downPayment = Number(row.down_payment || 0);
  const deliveredAt = row.delivered_at ?? row.delivery_log_at;
  const warrantyStarted = Boolean(row.delivery_log_at || (Number(row.warranty_started) === 1 && deliveredAt));

  return {
    id: String(row.id),
    version: Number(row.version ?? 1),
    inventoryPartId: row.inventory_part_id ? Number(row.inventory_part_id) : undefined,
    code: row.order_code,
    createdAt: new Date(row.created_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }),
    createdAtIso: new Date(row.created_at).toISOString(),
    advisor: row.advisor || 'Sin asignar',
    advisorRole: row.advisor_role || undefined,
    userId: row.user_id ? Number(row.user_id) : undefined,
    isYardSale: Boolean(row.is_yard_sale || row.advisor_role === 'vendedor_yarda'),
    status: statusFromDatabase(row.status),
    mainPart: row.product_type || 'Refacción',
    productSpecs: row.product_specs || '',
    stockNumber: row.stock_nr || '',
    workflowStep: row.workflow_step || 1,
    scheduledPickupAt: row.scheduled_pickup_at ? new Date(row.scheduled_pickup_at).toISOString().slice(0, 16) : undefined,
    customer: {
      id: String(row.customer_id || ''),
      name: customerName,
      type: row.type || 'Particular',
      company: row.company || '',
      email: row.contact_email ?? row.email ?? '',
      phone: row.contact_phone ?? row.phone ?? '',
      location: row.shipping_address ?? row.address_shipping ?? '',
      shippingAddress: row.shipping_address ?? row.address_shipping ?? '',
      zip_code: row.shipping_zip_code ?? row.zip_code ?? '',
      language: (row.customer_language || row.customer_crm_language || row.language || 'es') as 'es' | 'en',
      initials: customerName.split(' ').map((name: string) => name[0]).join('').slice(0, 2).toUpperCase(),
    },
    customerLanguage: (row.customer_language || row.customer_crm_language || row.language || 'es') as 'es' | 'en',
    vehicle: {
      vin: row.vin_nr || '',
      plate: '',
      make: row.brand || '',
      model: row.model || '',
      year: row.year || new Date().getFullYear(),
      trim: row.sub_model || '',
      transmission: row.transmission_type || '',
      mileage: row.mileage !== undefined && row.mileage !== null ? String(row.mileage) : '',
      color: row.color || '',
    },
    financials: {
      partPrice: price,
      baseMSRP: price,
      downPayment,
      advancePayment: downPayment,
      deliveryFee,
      coreFee,
      coreReceivedAt: row.core_received_at ? new Date(row.core_received_at).toISOString() : undefined,
      coreReceivedAmount: row.core_received_amount === null || row.core_received_amount === undefined ? undefined : Number(row.core_received_amount),
      subtotal: price + deliveryFee + coreFee,
      total: price + deliveryFee + coreFee,
      balanceDue: Math.max(0, price + deliveryFee + coreFee - downPayment),
    },
    deliveryType: row.shipping_toggle ? 'envio_domicilio' : 'retiro_tienda',
    warrantyDays: row.warranty_days ?? 60,
    deliveredAt: deliveredAt ? new Date(deliveredAt).toISOString() : undefined,
    warrantyStarted,
    warrantyTerms: parseWarrantyTerms(row.warranty_terms),
    claimReason: row.claim_reason || undefined,
    notes: row.description || '',
    auctionActive: (statusFromDatabase(row.status) === 'pagado') && (Boolean(row.auction_search_active) || (auctionLinks && auctionLinks.length > 0)),
    auctionLinks: auctionLinks || [],
    ...(parseJsonColumn<Record<string, unknown>>(row.workflow_data) || {}),
    preparation: row.preparation_details ? parsePreparation(row.preparation_details) : null,
    yardPieceReady: Boolean(row.yard_piece_ready),
    yardPieceReadyAt: row.yard_piece_ready_at ? new Date(row.yard_piece_ready_at).toISOString() : undefined,
    yardPieceReadyBy: row.yard_piece_ready_by ? Number(row.yard_piece_ready_by) : undefined,
    yardPieceReadyAckAt: row.yard_piece_ready_ack_at ? new Date(row.yard_piece_ready_ack_at).toISOString() : undefined,
    yardPieceReadyAckBy: row.yard_piece_ready_ack_by ? Number(row.yard_piece_ready_ack_by) : undefined,
    downpaymentVerified: Boolean(row.downpayment_verified),
    downpaymentVerifiedAt: row.downpayment_verified_at ? new Date(row.downpayment_verified_at).toISOString() : undefined,
    downpaymentVerifiedBy: row.downpayment_verified_by ? Number(row.downpayment_verified_by) : undefined,
    yardCompatibility: parseJsonColumn(row.yard_compatibility) ?? undefined,
  };
};

export const toMysqlDateTime = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString().slice(0, 19).replace('T', ' ');
};

export const YARD_QUEUE_STATUSES = ['Pagado', 'Reclamo'];
export const YARD_QUEUE_MAX_LIMIT = 200;

export interface YardQueueCounts {
  all: number;
  pending_yard: number;
  yard_ready: number;
  claims: number;
  yard_sales: number;
}

const parseYardWorkflowData = (value: unknown): Record<string, unknown> => {
  if (!value) return {};
  try {
    return typeof value === 'string' ? JSON.parse(value) : value as Record<string, unknown>;
  } catch {
    return {};
  }
};

const escapeLikePattern = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

export const getYardOrders = async (options: { limit?: number; offset?: number; q?: string } = {}) => {
  // One extra row lets callers detect whether another page exists.
  const limit = Math.min(Math.max(1, Math.trunc(options.limit ?? 50)), YARD_QUEUE_MAX_LIMIT + 1);
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const conditions = ['o.deleted_at IS NULL', 'o.status IN (?)'];
  const params: (string | number | string[])[] = [YARD_QUEUE_STATUSES];
  const search = options.q?.trim();
  if (search) {
    const like = `%${escapeLikePattern(search)}%`;
    conditions.push(`(o.order_code LIKE ? OR o.vin_nr LIKE ? OR o.stock_nr LIKE ? OR o.product_type LIKE ?
      OR CONCAT_WS(' ', c.first_name, c.last_name) LIKE ? OR c.phone LIKE ?
      OR CONCAT_WS(' ', o.year, o.brand, o.model, o.sub_model) LIKE ?)`);
    params.push(like, like, like, like, like, like, like);
  }

  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT o.id, o.version, o.order_code, o.customer_id, o.is_yard_sale, o.status, o.product_type, o.product_specs,
      o.stock_nr, o.workflow_step, o.warranty_days, o.created_at, o.claim_reason, o.description,
      o.vin_nr, o.brand, o.model, o.sub_model, o.year, o.transmission_type, o.color, o.mileage,
      o.yard_piece_ready, o.yard_piece_ready_at, o.yard_compatibility, o.workflow_data,
      o.yard_piece_ready_ack_at, o.yard_piece_ready_ack_by,
      o.auction_search_active,
      c.first_name, c.last_name, c.phone, c.company, c.type,
      u.name AS advisor, u.role AS advisor_role,
      (SELECT MIN(so.created_at) FROM status_orders so
       WHERE so.order_id = o.id AND LOWER(so.status) = 'pagado') AS paid_log_at,
      (SELECT MAX(so.created_at) FROM status_orders so
       WHERE so.order_id = o.id AND LOWER(so.status) = 'reclamo') AS claim_log_at
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN users u ON u.id = o.user_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY COALESCE(paid_log_at, o.created_at) ASC, o.id ASC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  return rows.map((row) => {
    const workflow = parseYardWorkflowData(row.workflow_data);
    const customerName = [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Cliente sin nombre';
    const paidAt = row.paid_log_at || row.created_at;
    return {
      id: String(row.id),
      version: Number(row.version ?? 1),
      code: row.order_code,
      createdAt: new Date(row.created_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }),
      createdAtIso: new Date(row.created_at).toISOString(),
      paidAtIso: paidAt ? new Date(paidAt).toISOString() : undefined,
      claimLoggedAt: row.claim_log_at ? new Date(row.claim_log_at).toISOString() : undefined,
      advisor: row.advisor || 'Sin asignar',
      advisorRole: row.advisor_role || undefined,
      isYardSale: Boolean(row.is_yard_sale || row.advisor_role === 'vendedor_yarda'),
      status: statusFromDatabase(row.status),
      mainPart: row.product_type || 'Refacción',
      productSpecs: row.product_specs || '',
      stockNumber: row.stock_nr || '',
      workflowStep: row.workflow_step || 1,
      customer: {
        id: row.customer_id ? String(row.customer_id) : '',
        name: customerName,
        type: row.type || 'Particular',
        email: '',
        phone: row.phone || '',
        location: '',
        shippingAddress: '',
        zip_code: '',
        company: row.company || '',
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
        mileage: row.mileage === null || row.mileage === undefined ? '' : String(row.mileage),
        color: row.color || '',
      },
      warrantyDays: row.warranty_days ?? 60,
      claimReason: row.claim_reason || undefined,
      notes: row.description || '',
      auctionActive: Boolean(row.auction_search_active || workflow.yardPieceUnavailable),
      yardPieceReady: Boolean(row.yard_piece_ready),
      yardPieceReadyAt: row.yard_piece_ready_at ? new Date(row.yard_piece_ready_at).toISOString() : undefined,
      yardPieceReadyAckAt: row.yard_piece_ready_ack_at ? new Date(row.yard_piece_ready_ack_at).toISOString() : undefined,
      yardPieceReadyAckBy: row.yard_piece_ready_ack_by ? Number(row.yard_piece_ready_ack_by) : undefined,
      yardPieceUnavailable: Boolean(workflow.yardPieceUnavailable),
      yardPieceUnavailableAt: typeof workflow.yardPieceUnavailableAt === 'string' ? workflow.yardPieceUnavailableAt : undefined,
      yardPieceUnavailableReason: typeof workflow.yardPieceUnavailableReason === 'string' ? workflow.yardPieceUnavailableReason : undefined,
      claimPieceReady: workflow.claimPieceReady === true,
      claimPieceReadyAt: typeof workflow.claimPieceReadyAt === 'string' ? workflow.claimPieceReadyAt : undefined,
      yardCompatibility: parseJsonColumn(row.yard_compatibility) ?? undefined,
    };
  });
};

export const getYardQueueCounts = async (): Promise<YardQueueCounts> => {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT COUNT(*) AS total,
      COALESCE(SUM(LOWER(o.status) = 'pagado' AND COALESCE(o.yard_piece_ready, 0) = 0), 0) AS pending_yard,
      COALESCE(SUM(LOWER(o.status) = 'pagado' AND COALESCE(o.yard_piece_ready, 0) = 1), 0) AS yard_ready,
      COALESCE(SUM(LOWER(o.status) = 'reclamo'), 0) AS claims,
      COALESCE(SUM(COALESCE(o.is_yard_sale, 0) = 1 OR LOWER(u.role) = 'vendedor_yarda'), 0) AS yard_sales
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    WHERE o.deleted_at IS NULL AND o.status IN (?)
  `, [YARD_QUEUE_STATUSES]);
  const row = rows[0] as RowDataPacket | undefined;
  return {
    all: Number(row?.total) || 0,
    pending_yard: Number(row?.pending_yard) || 0,
    yard_ready: Number(row?.yard_ready) || 0,
    claims: Number(row?.claims) || 0,
    yard_sales: Number(row?.yard_sales) || 0,
  };
};

export const getOrders = async (options: { limit?: number; offset?: number; id?: number; startDate?: string; endDate?: string; q?: string } = {}) => {
  const maxLimit = Math.min(Math.max(1, options.limit || 5000), 10000);
  const conditions: string[] = ['o.deleted_at IS NULL'];
  const params: (string | number)[] = [];
  if (options.id) {
    conditions.push('o.id = ?');
    params.push(options.id);
  }

  if (options.startDate) {
    conditions.push('o.created_at >= ?');
    params.push(options.startDate);
  }
  if (options.endDate) {
    conditions.push('o.created_at <= ?');
    params.push(options.endDate);
  }
  const search = options.q?.trim();
  if (search) {
    const like = `%${escapeLikePattern(search)}%`;
    conditions.push(`(o.order_code LIKE ? OR o.vin_nr LIKE ? OR o.stock_nr LIKE ? OR o.product_type LIKE ?
      OR CONCAT_WS(' ', c.first_name, c.last_name) LIKE ? OR c.phone LIKE ?
      OR CONCAT_WS(' ', o.year, o.brand, o.model, o.sub_model) LIKE ?)`);
    params.push(like, like, like, like, like, like, like);
  }

  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT o.*, c.first_name, c.last_name, c.company, c.type, c.phone, c.email, c.address_shipping, c.zip_code, c.language AS customer_crm_language, u.name AS advisor, u.role AS advisor_role,
      (SELECT MIN(so.created_at) FROM status_orders so
       WHERE so.order_id = o.id AND LOWER(so.status) = 'entregado') AS delivery_log_at
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN users u ON u.id = o.user_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT ? OFFSET ?
  `, [...params, maxLimit, Math.max(0, options.offset || 0)]);

  if (!rows.length) return [];
  const linksByOrderId = new Map<number, any[]>();
    const [linkRows] = await pool.query<RowDataPacket[]>(
      'SELECT id, order_id, url, auction_date, auction_type, status, created_at FROM order_auction_links WHERE order_id IN (?) ORDER BY id ASC',
      [rows.length ? rows.map(row => row.id) : [0]]
    );
    for (const l of linkRows) {
      const arr = linksByOrderId.get(Number(l.order_id)) || [];
      arr.push({
        id: String(l.id),
        url: l.url,
        auctionHouse: l.auction_type === 'IAA' ? 'IAAI' : (l.auction_type || 'Copart'),
        auctionDate: l.auction_date ? new Date(l.auction_date).toISOString().slice(0, 10) : undefined,
        createdAt: l.created_at ? new Date(l.created_at).toISOString() : undefined,
        status: l.status || 'active',
      });
      linksByOrderId.set(Number(l.order_id), arr);
    }
  const [inventoryRows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM inventory_parts WHERE deleted_at IS NULL',
  );
  const inventory = inventoryRows.map(mapInventoryPartRow);
  return rows.map((row) => {
    const order = mapOrder(row, linksByOrderId?.get(Number(row.id)));
    return { ...order, inventoryAvailability: matchOrderInventory(order, inventory) };
  });
};
