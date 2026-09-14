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
  cotizacion: ['espera_confirmacion', 'pagado'],
  espera_confirmacion: ['cotizacion', 'pagado'],
  pagado: ['en_preparacion', 'listo_despacho', 'listo_retiro', 'espera_confirmacion', 'cotizacion'],
  en_preparacion: ['listo_despacho', 'listo_retiro', 'pagado', 'espera_confirmacion', 'cotizacion'],
  listo_despacho: ['en_camino', 'entregado', 'en_preparacion', 'espera_confirmacion', 'pagado'],
  listo_retiro: ['entregado', 'pagado', 'espera_confirmacion', 'cotizacion'],
  en_camino: ['entregado', 'listo_despacho'],
  entregado: ['reclamo'],
  reclamo: ['solicitud_reembolso'],
  solicitud_reembolso: ['reembolsado', 'archivado', 'pagado', 'cotizacion'],
  reembolsado: ['archivado'],
  archivado: [],
  cancelado: [],
  en_diagnostico: ['espera_confirmacion', 'pagado'],
  en_reparacion: ['listo_despacho', 'listo_retiro', 'pagado', 'espera_confirmacion', 'cotizacion'],
  listo_pago: ['en_preparacion', 'listo_despacho', 'listo_retiro', 'espera_confirmacion', 'cotizacion'],
  detenido_pieza: ['en_preparacion', 'pagado', 'espera_confirmacion', 'cotizacion'],
  en_proceso: ['listo_despacho', 'listo_retiro', 'pagado', 'espera_confirmacion', 'cotizacion'],
  facturado: ['en_preparacion', 'listo_despacho', 'listo_retiro', 'espera_confirmacion', 'cotizacion'],
  pendiente_aprobacion: ['cotizacion', 'pagado'],
};

export const getAllowedNextStatuses = (status: OrderStatus) => ORDER_STATUS_TRANSITIONS[status] || [];

export const canTransitionOrderStatus = (from: OrderStatus, to: OrderStatus) =>
  from === to || getAllowedNextStatuses(from).includes(to);

export const requiresStatusAuthorization = (from: OrderStatus, to: OrderStatus) =>
  from === 'solicitud_reembolso' && (to === 'pagado' || to === 'cotizacion');