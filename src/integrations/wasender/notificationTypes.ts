export type NotificationChannelKey =
  | 'NUEVA_VENTA'
  | 'NUEVO_RECLAMO'
  | 'SEGUIMIENTO_RECLAMO'
  | 'SOLICITUD_REEMBOLSO'
  | 'CAMBIO_ESTATUS'
  | 'ORDEN_CANCELADA'
  | 'RESPALDO_AUTOMATICO'
  | 'BUSQUEDA_SUBASTAS'
  | 'LISTA_RECLAMOS'
  | 'ALERTA_SEGURIDAD';

export type NotificationTargetType = 'superadmin_only' | 'creator_dynamic' | 'configurable_multicast';

export interface NotificationChannelConfig {
  key: NotificationChannelKey;
  name: string;
  category: string;
  description: string;
  targetType: NotificationTargetType;
  isEnabled: boolean;
  superadminEnabled: boolean;
  operatorIds: number[];
  externalContactIds: number[];
  triggerNotes: string;
  badgeLabel: string;
  icon: string;
}

export interface ExternalContact {
  id: number;
  name: string;
  phone: string;
  label?: string;
  notes?: string;
  isActive: boolean;
  subscribedChannels: NotificationChannelKey[];
  createdAt?: string;
  updatedAt?: string;
}

export interface OperatorContact {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  avatarUrl?: string | null;
}

export interface NotificationConfigResponse {
  channels: NotificationChannelConfig[];
  operators: OperatorContact[];
  externalContacts: ExternalContact[];
  sandboxInfo: {
    isTestMode: boolean;
    designatedTestPhone: string;
    sessionName: string;
    connectedPhone: string;
    accountName: string;
  };
}

export const DEFAULT_NOTIFICATION_CHANNELS: NotificationChannelConfig[] = [
  {
    key: 'NUEVA_VENTA',
    name: 'Nueva Venta',
    category: 'Ventas & Facturación',
    description: 'Notificación enviada cuando una orden pasa al estatus de Pagado (confirmación de venta definitiva).',
    targetType: 'configurable_multicast',
    isEnabled: true,
    superadminEnabled: true,
    operatorIds: [],
    externalContactIds: [],
    triggerNotes: 'Se dispara automáticamente cuando la orden se coloca en estatus "Pagado". No se envía durante la cotización inicial.',
    badgeLabel: 'Multidestino Configurable',
    icon: 'point_of_sale',
  },
  {
    key: 'NUEVO_RECLAMO',
    name: 'Nuevo Reclamo',
    category: 'Garantías & Calidad',
    description: 'Alerta prioritaria cuando se radica un nuevo reclamo de garantía sobre una orden.',
    targetType: 'configurable_multicast',
    isEnabled: true,
    superadminEnabled: true,
    operatorIds: [],
    externalContactIds: [],
    triggerNotes: 'Se envía al Super Administrador y a los números de atención/postventa asignados.',
    badgeLabel: 'Multidestino Configurable',
    icon: 'warning',
  },
  {
    key: 'SEGUIMIENTO_RECLAMO',
    name: 'Seguimiento de Reclamo (Nueva Llamada/Nota)',
    category: 'Garantías & Calidad',
    description: 'Notificación cuando se anexa una nueva llamada o nota de seguimiento a un reclamo en curso.',
    targetType: 'configurable_multicast',
    isEnabled: true,
    superadminEnabled: true,
    operatorIds: [],
    externalContactIds: [],
    triggerNotes: 'Se envía al Super Administrador y a los números configurados cuando se registra una llamada o interacción.',
    badgeLabel: 'Multidestino Configurable',
    icon: 'support_agent',
  },
  {
    key: 'SOLICITUD_REEMBOLSO',
    name: 'Solicitud de Reembolso',
    category: 'Finanzas & Tesorería',
    description: 'Alerta financiera cuando un operador o cliente solicita la devolución de dinero.',
    targetType: 'superadmin_only',
    isEnabled: true,
    superadminEnabled: true,
    operatorIds: [],
    externalContactIds: [],
    triggerNotes: 'Exclusivo: Este mensaje solo se envía al usuario Super Administrador para control financiero.',
    badgeLabel: '🔒 Exclusivo Super Admin',
    icon: 'currency_exchange',
  },
  {
    key: 'CAMBIO_ESTATUS',
    name: 'Cambios de Status (Listo para Retiro / Despacho)',
    category: 'Taller & Operaciones',
    description: 'Aviso al asesor cuando una pieza o repuesto pasa a estar listo para entrega o despacho.',
    targetType: 'creator_dynamic',
    isEnabled: true,
    superadminEnabled: false,
    operatorIds: [],
    externalContactIds: [],
    triggerNotes: 'Regla Dinámica: Se envía al número del operador que creó la orden SOLO cuando una pieza se coloca en "Listo para Retiro" o "Listo para Envio / Despacho".',
    badgeLabel: '⚡ Regla Dinámica (Creador)',
    icon: 'sync_alt',
  },
  {
    key: 'ORDEN_CANCELADA',
    name: 'Orden Cancelada',
    category: 'Control Operativo',
    description: 'Aviso de auditoría cuando una orden existente es anulada o cancelada.',
    targetType: 'superadmin_only',
    isEnabled: true,
    superadminEnabled: true,
    operatorIds: [],
    externalContactIds: [],
    triggerNotes: 'Exclusivo: Solo se envía al Super Administrador para supervisión de cancelaciones.',
    badgeLabel: '🔒 Exclusivo Super Admin',
    icon: 'cancel',
  },
  {
    key: 'RESPALDO_AUTOMATICO',
    name: 'Respaldo Automático de Base de Datos',
    category: 'Seguridad & Disaster Recovery',
    description: 'Envío de copia completa de seguridad SQL con todos los datos para resguardo fuera de línea.',
    targetType: 'superadmin_only',
    isEnabled: true,
    superadminEnabled: true,
    operatorIds: [],
    externalContactIds: [],
    triggerNotes: 'Exclusivo: Solo se envía la copia de la base de datos al Super Administrador para descargar y resguardar.',
    badgeLabel: '🔒 Exclusivo Super Admin (SQL Backup)',
    icon: 'cloud_download',
  },
  {
    key: 'BUSQUEDA_SUBASTAS',
    name: 'Búsquedas en Subastas',
    category: 'Adquisición & Lotes',
    description: 'Notificación con los hallazgos de piezas y vehículos localizados en subastas Copart/IAAI.',
    targetType: 'superadmin_only',
    isEnabled: true,
    superadminEnabled: true,
    operatorIds: [],
    externalContactIds: [],
    triggerNotes: 'Exclusivo: Solo se envía al Super Administrador para evaluación de compras en subasta.',
    badgeLabel: '🔒 Exclusivo Super Admin',
    icon: 'travel_explore',
  },
  {
    key: 'LISTA_RECLAMOS',
    name: 'Lista de Reclamos',
    category: 'Auditoría & Garantías',
    description: 'Resumen consolidado y reporte de reclamos pendientes y resueltos del período.',
    targetType: 'configurable_multicast',
    isEnabled: true,
    superadminEnabled: true,
    operatorIds: [],
    externalContactIds: [],
    triggerNotes: 'Se envía al Super Administrador y a todos los destinatarios configurados manualmente.',
    badgeLabel: 'Multidestino Configurable',
    icon: 'format_list_bulleted',
  },
  {
    key: 'ALERTA_SEGURIDAD',
    name: 'Alertas de Seguridad & Anomalías',
    category: 'Seguridad & Auditoría',
    description: 'Alertas automáticas ante múltiples fallos de 2FA, intentos de acceso no autorizado o eventos de riesgo.',
    targetType: 'superadmin_only',
    isEnabled: true,
    superadminEnabled: true,
    operatorIds: [],
    externalContactIds: [],
    triggerNotes: 'Exclusivo: Notificación inmediata de alta prioridad enviada al WhatsApp del Super Administrador.',
    badgeLabel: '🚨 Alta Prioridad (Super Admin)',
    icon: 'security',
  },
];
