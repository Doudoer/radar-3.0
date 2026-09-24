import { OrderStatus } from '../types';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  cotizacion: 'Cotización',
  espera_confirmacion: 'En Espera de Confirmación',
  pagado: 'Pagado',
  en_preparacion: 'Preparación',
  listo_despacho: 'Listo para Despacho',
  listo_retiro: 'Listo para Retiro',
  en_camino: 'En Camino',
  entregado: 'Entregado',
  reclamo: 'Reclamo',
  solicitud_reembolso: 'Solicitud de Reembolso',
  reembolsado: 'Reembolsado',
  archivado: 'Archivado',
  cancelado: 'Cancelado',
  en_diagnostico: 'Cotización',
  en_reparacion: 'Preparación',
  listo_pago: 'Pagado',
  detenido_pieza: 'Preparación',
  en_proceso: 'Preparación',
  facturado: 'Pagado',
  pendiente_aprobacion: 'En Espera de Confirmación',
};

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  cotizacion: ['espera_confirmacion', 'pagado', 'reclamo', 'cancelado'],
  espera_confirmacion: ['cotizacion', 'pagado', 'reclamo', 'cancelado'],
  pagado: ['en_preparacion', 'listo_despacho', 'listo_retiro', 'espera_confirmacion', 'cotizacion', 'reclamo', 'cancelado'],
  en_preparacion: ['listo_despacho', 'listo_retiro', 'pagado', 'espera_confirmacion', 'cotizacion', 'reclamo', 'cancelado'],
  listo_despacho: ['en_camino', 'entregado', 'en_preparacion', 'espera_confirmacion', 'pagado', 'reclamo', 'cancelado'],
  listo_retiro: ['entregado', 'pagado', 'espera_confirmacion', 'cotizacion', 'reclamo', 'cancelado'],
  en_camino: ['entregado', 'listo_despacho', 'reclamo', 'cancelado'],
  entregado: ['reclamo', 'en_preparacion', 'solicitud_reembolso', 'archivado'],
  reclamo: [
    'en_preparacion',
    'listo_despacho',
    'listo_retiro',
    'en_camino',
    'entregado',
    'solicitud_reembolso',
    'pagado',
    'cotizacion',
    'cancelado',
    'archivado',
  ],
  solicitud_reembolso: ['reembolsado', 'archivado', 'pagado', 'cotizacion', 'reclamo', 'cancelado'],
  reembolsado: ['archivado'],
  archivado: [],
  cancelado: ['cotizacion', 'pagado', 'en_preparacion'],
  en_diagnostico: ['espera_confirmacion', 'pagado', 'reclamo', 'cancelado'],
  en_reparacion: ['listo_despacho', 'listo_retiro', 'pagado', 'espera_confirmacion', 'cotizacion', 'reclamo', 'cancelado'],
  listo_pago: ['en_preparacion', 'listo_despacho', 'listo_retiro', 'espera_confirmacion', 'cotizacion', 'reclamo', 'cancelado'],
  detenido_pieza: ['en_preparacion', 'pagado', 'espera_confirmacion', 'cotizacion', 'reclamo', 'cancelado'],
  en_proceso: ['listo_despacho', 'listo_retiro', 'pagado', 'espera_confirmacion', 'cotizacion', 'reclamo', 'cancelado'],
  facturado: ['en_preparacion', 'listo_despacho', 'listo_retiro', 'espera_confirmacion', 'cotizacion', 'reclamo', 'cancelado'],
  pendiente_aprobacion: ['cotizacion', 'pagado', 'reclamo', 'cancelado'],
};

export const getAllowedNextStatuses = (status: OrderStatus) => ORDER_STATUS_TRANSITIONS[status] || [];

export const canTransitionOrderStatus = (from: OrderStatus, to: OrderStatus) =>
  from === to || getAllowedNextStatuses(from).includes(to);

export const requiresStatusAuthorization = (from: OrderStatus, to: OrderStatus) =>
  from === 'solicitud_reembolso' && (to === 'pagado' || to === 'cotizacion');