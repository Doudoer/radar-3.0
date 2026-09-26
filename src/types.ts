export type NavScreen = 
  | 'dashboard'
  | 'ordenes'
  | 'clientes'
  | 'reclamos'
  | 'inventario'
  | 'mis_operaciones'
  | 'relacion_semanal'
  | 'sistema'
  | 'usuarios'
  | 'order-detail'
  | 'taller'
  | 'crm'
  | 'finanzas'
  | 'configuracion'
  | 'ayuda'
  | 'directorio';

// Catálogo Exhaustivo de Estatus en RADAR (13 Estatus)
export type OrderStatus = 
  | 'cotizacion'
  | 'espera_confirmacion'
  | 'pagado'
  | 'en_preparacion'
  | 'listo_despacho'
  | 'listo_retiro'
  | 'en_camino'
  | 'entregado'
  | 'reclamo'
  | 'cancelado'
  | 'solicitud_reembolso'
  | 'reembolsado'
  | 'archivado'
  // Compatibilidad con vistas previas
  | 'en_diagnostico'
  | 'en_reparacion'
  | 'listo_pago'
  | 'detenido_pieza'
  | 'en_proceso'
  | 'facturado'
  | 'pendiente_aprobacion';

// Vistas Segmentadas para Alivio de Carga
export type OrderSegmentView = 
  | 'active'
  | 'ready_pickup'
  | 'expired_warranty'
  | 'cancelled'
  | 'refunds'
  | 'archived';

export interface Vehicle {
  vin: string;
  plate: string;
  make: string;
  model: string;
  year: number;
  trim?: string;
  mileage: string;
  color: string;
  colorHex?: string;
  imageUrl?: string;
  transmission?: string;
}

export interface Customer {
  id: string;
  first_name?: string;
  last_name?: string;
  name: string;
  company?: string;
  type: 'Particular' | 'Empresa' | 'Flota Mantenimiento' | 'VIP' | 'Taller Mecánico';
  email: string;
  phone: string;
  whatsapp?: string;
  location: string;
  initials: string;
  address_shipping?: string;
  shippingAddress?: string;
  zip_code?: string;
  notes?: string;
  createdAt?: string;
  deleted_at?: string | null;
}

export interface OrderItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export type CoreStatus = 
  | 'entregado_tienda'
  | 'deposito_pendiente'
  | 'no_aplica'
  | 'devuelto_reembolsado';

export type AuctionHouse = 'Copart' | 'IAAI' | 'Otra';

export interface AuctionLink {
  id: string;
  url: string;
  auctionHouse?: AuctionHouse;
  auctionDate?: string;
  hasBuyNow?: boolean;
  buyNowPrice?: number;
  notes?: string;
  createdAt?: string;
}

export interface Order {
  id: string; // e.g. "ORD-2026-0142" o "ORD-516560"
  code: string;
  createdAt: string;
  createdAtIso?: string;
  advisor: string;
  status: OrderStatus;
  mainPart: string;
  productSpecs?: string;
  stockNumber?: string;
  customer: Customer;
  vehicle: Vehicle;
  workflowStep: number; // 1 to 4
  financials: {
    partPrice?: number;
    baseMSRP?: number;
    downPayment?: number;
    advancePayment?: number;
    deliveryFee?: number;
    coreFee?: number;
    accessories?: number;
    discount?: number;
    subtotal: number;
    tax?: number;
    total: number;
    balanceDue?: number;
  };
  deliveryType?: 'retiro_tienda' | 'envio_domicilio';
  
  // Garantía y SLA
  warrantyDays?: number; // 30, 60, 90
  deliveredAt?: string; // Fecha de entrega física
  warrantyStarted?: boolean;
  warranty?: {
    planType: string;
    duration: string;
    coverageItems: { title: string; subtitle: string }[];
  };
  
  // Subasta y Cotización de Lotes
  auctionActive?: boolean;
  auctionLinks?: AuctionLink[];

  // Flujo Call Center (4 Etapas Secuenciales)
  termsAttachment?: string; // Comprobante captura de Términos
  callDetail?: string; // Resumen llamada de voz de acuse
  callConfirmed?: boolean;
  termsAckAttachment?: string; // Captura comprobante acuse WhatsApp
  scheduledPickupAt?: string; // Fecha/hora programada de entrega o retiro
  pickupExtensionReason?: string; // Prórroga
  coreStatus?: CoreStatus;
  checklistDelivered?: boolean;
  checklistInvoice?: boolean;

  // Notificaciones y Seguridad
  saleNotified?: boolean; // Regla de disparo único por Wasender
  claimReason?: string;
  notes?: string;
}

export interface SLAMetric {
  id: string;
  name: string;
  status: 'healthy' | 'attention' | 'overdue';
  statusLabel: string;
  value: string;
  target?: string;
}

export interface ActivityItem {
  id: string;
  title: string;
  highlightText?: string;
  description: string;
  timeAgo: string;
  type: 'invoice' | 'workshop' | 'lead' | 'alert' | 'otp' | 'status_change';
  icon: string;
}

export interface PrefillOrderData {
  make?: string;
  model?: string;
  year?: number;
  vin?: string;
  mainPart?: string;
  productSpecs?: string;
  stockNumber?: string;
  partPrice?: number;
  warrantyDays?: number;
  dealerName?: string;
  dealerPhone?: string;
  dealerLocation?: string;
  notes?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  customerType?: 'Particular' | 'Empresa' | 'Flota Mantenimiento' | 'VIP' | 'Taller Mecánico';
  customerAddress?: string;
  customerZipCode?: string;
}

// Sub-módulo de Reclamos y Garantías (/claims)
export type ClaimStatus = 'Pending' | 'In Process' | 'Resolved' | 'Denied';

export interface ClaimCall {
  id: string;
  claimId: string;
  callNumber: number;
  callerName: string;
  callerPhone: string;
  attendedBy: string;
  conversationSummary: string;
  createdAt: string;
  whatsappDispatched: boolean;
  whatsappMessage?: string;
}

export interface Claim {
  id: string; // e.g. "REC-2026-089"
  orderId: string;
  orderCode: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  vehicle: string; // e.g. "2023 Audi Q5 Sportback"
  vin?: string;
  mainPart: string;
  partSpecs?: string;
  claimReason: string;
  type: string; // e.g. "Garantía Tren Motriz", "Defecto de Pieza", "Daño en Transporte"
  priority: 'Alta' | 'Media' | 'Baja';
  status: ClaimStatus;
  previousOrderStatus: OrderStatus;
  advisor: string;
  createdAt: string;
  resolvedAt?: string;
  resolutionNotes?: string;
  calls: ClaimCall[];
  callCount: number;
  warrantyDays?: number;
  supplierName?: string;
  stockNumber?: string;
  refundRequested?: boolean;
}

export interface RefundRequest {
  id: string; // e.g. "REF-2026-0012"
  orderId: string;
  orderCode: string;
  customerName: string;
  customerPhone?: string;
  vehicle: string;
  part: string;
  reason: string;
  amount: number;
  amountType: 'downpayment' | 'total' | 'custom';
  paymentMethod: 'Zelle' | 'CashApp' | 'Efectivo';
  paymentDetails: string;
  status: 'pending' | 'completed' | 'cancelled';
  createdAt: string;
  completedAt?: string;
  completedBy?: string;
}

export interface InventoryPart {
  id: string;
  year: string;
  brand: string;
  model: string;
  partType: string; // 'Motor' | 'Transmisión'
  vin?: string;
  palletNumber?: string;
  status?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

