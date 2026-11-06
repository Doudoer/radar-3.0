import { z } from 'zod';
const moneySchema = z.coerce.number().finite().min(0).max(10_000_000).multipleOf(0.01);
const avatarSchema = z.string().trim().max(500_000).refine(value =>
  !value || /^\/uploads\/[a-zA-Z0-9._-]+$/.test(value) ||
  /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ||
  (() => {
    try { return new URL(value).protocol === 'https:'; } catch { return false; }
  })(), 'Usa una imagen PNG, JPEG, GIF o WebP, un adjunto propio o una URL HTTPS');

export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

export const claimSchema = z.object({
  orderId: z.coerce.number().int().positive(),
  description: z.string().trim().min(3).max(5000),
  assignedUserId: z.coerce.number().int().positive().optional().nullable(),
});

export const orderStatusSchema = z.enum([
  'cotizacion', 'espera_confirmacion', 'pagado', 'en_preparacion', 'listo_despacho',
  'listo_retiro', 'en_camino', 'entregado', 'reclamo', 'cancelado',
  'solicitud_reembolso', 'reembolsado', 'archivado', 'en_diagnostico',
  'en_reparacion', 'listo_pago', 'detenido_pieza', 'en_proceso',
  'facturado', 'pendiente_aprobacion',
]);

export const orderPayloadSchema = z.object({
  version: z.number().int().positive().optional(),
  idempotencyKey: z.string().uuid().optional(),
  inventoryPartId: z.coerce.number().int().positive().optional().nullable(),
  code: z.string().trim().min(1).max(80).optional(),
  userId: z.coerce.number().int().positive().optional().nullable(),
  advisor: z.string().trim().max(200).optional().nullable(),
  isYardSale: z.boolean().optional(),
  status: orderStatusSchema.optional(),
  mainPart: z.string().trim().min(1).max(200).optional(),
  productSpecs: z.string().max(5000).optional().nullable(),
  stockNumber: z.string().max(120).optional().nullable(),
  workflowStep: z.coerce.number().int().min(1).max(10).optional(),
  warrantyDays: z.coerce.number().int().min(0).max(3650).optional(),
  customer: z.object({
    id: z.string().max(40).optional(),
    name: z.string().trim().min(1).max(200),
    phone: z.string().max(40).optional().nullable(),
    email: z.string().email().max(254).optional().nullable().or(z.literal('')),
    shippingAddress: z.string().max(500).optional().nullable(),
    zip_code: z.string().max(20).optional().nullable(),
    language: z.enum(['es', 'en']).optional(),
    company: z.string().trim().max(150).optional().nullable(),
    type: z.enum(['Particular', 'Empresa', 'Flota Mantenimiento', 'VIP', 'Taller Mecánico']).optional(),
  }).optional(),
  vehicle: z.object({
    vin: z.string().max(40).optional().nullable(),
    make: z.string().max(100).optional().nullable(),
    model: z.string().max(100).optional().nullable(),
    trim: z.string().max(100).optional().nullable(),
    year: z.coerce.number().int().min(1886).max(2200).optional().nullable(),
    color: z.string().max(80).optional().nullable(),
    transmission: z.string().max(100).optional().nullable(),
    mileage: z.string().max(60).optional().nullable(),
  }).optional(),
  financials: z.object({
    partPrice: moneySchema.optional(),
    coreFee: moneySchema.optional(),
    downPayment: moneySchema.optional(),
    deliveryFee: moneySchema.optional(),
  }).optional(),
  deliveryType: z.enum(['retiro_tienda', 'envio_domicilio']).optional(),
  scheduledPickupAt: z.string().max(80).refine(v => !v || Number.isFinite(Date.parse(v)), 'Fecha inválida').optional().nullable(),
  deliveredAt: z.string().max(80).refine(v => !v || Number.isFinite(Date.parse(v)), 'Fecha inválida').optional().nullable(),
  warrantyStarted: z.boolean().optional(),
  notes: z.string().max(5000).optional().nullable(),
  claimReason: z.string().max(5000).optional().nullable(),
  customerLanguage: z.enum(['es', 'en']).optional(),
}).passthrough();

export const claimUpdateSchema = z.object({
  status: z.enum(['Pending', 'In Process', 'Resolved', 'Denied']),
  orderId: z.coerce.number().int().positive().optional(),
  previousOrderStatus: z.string().min(1).max(80).optional(),
  resolutionNotes: z.string().max(5000).optional().nullable(),
});

export const claimCallCreateSchema = z.object({
  callerName: z.string().trim().max(200).optional().nullable(),
  callerPhone: z.string().trim().max(40).optional().nullable(),
  attendedBy: z.string().trim().max(200).optional().nullable(),
  conversationSummary: z.string().trim().min(2).max(5000),
  whatsappDispatched: z.boolean().optional().default(false),
  whatsappMessage: z.string().max(5000).optional().nullable(),
});

export const customerSchema = z.object({
  first_name: z.string().trim().min(1).max(120).optional(),
  last_name: z.string().trim().max(120).optional().nullable(),
  name: z.string().trim().max(250).optional(),
  phone: z.string().trim().min(4).max(40),
  whatsapp: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email().max(254).optional().nullable().or(z.literal('')),
  company: z.string().trim().max(150).optional().nullable(),
  type: z.enum(['Particular', 'Empresa', 'Flota Mantenimiento', 'VIP', 'Taller Mecánico']).optional().default('Particular'),
  address_shipping: z.string().trim().max(500).optional().nullable(),
  shippingAddress: z.string().trim().max(500).optional().nullable(),
  zip_code: z.string().trim().max(20).optional().nullable(),
  language: z.enum(['es', 'en']).optional().default('es'),
  notes: z.string().max(5000).optional().nullable(),
});

export const refundCreateSchema = z.object({
  idempotencyKey: z.string().uuid(),
  orderId: z.coerce.number().int().positive(),
  amount: moneySchema.positive(),
  amountType: z.enum(['downpayment', 'total', 'custom']).default('downpayment'),
  paymentMethod: z.enum(['Zelle', 'CashApp', 'Efectivo', 'Transferencia', 'Tarjeta']).default('Zelle'),
  paymentDetails: z.string().max(1000).optional().nullable(),
  reason: z.string().trim().min(3).max(255),
});

export const refundUpdateSchema = z.object({
  status: z.enum(['pending', 'completed', 'cancelled']),
  completedBy: z.string().trim().max(200).optional().nullable(),
});

export const passwordPolicySchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(200)
  .refine(val => new TextEncoder().encode(val).length <= 72, 'La contraseña no puede superar 72 bytes UTF-8')
  .refine((val) => /[A-Z]/.test(val), 'Debe incluir al menos una letra mayúscula (A-Z)')
  .refine((val) => /[a-z]/.test(val), 'Debe incluir al menos una letra minúscula (a-z)')
  .refine((val) => /[0-9]/.test(val), 'Debe incluir al menos un dígito (0-9)')
  .refine((val) => /[^a-zA-Z0-9]/.test(val), 'Debe incluir al menos un símbolo o punto (. ! @ # $ etc.)');

export const userCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(50).optional().nullable(),
  avatar_url: avatarSchema.optional().nullable(),
  password: passwordPolicySchema,
  role: z.enum(['admin', 'operator', 'vendedor_yarda']).default('operator'),
  permissions: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  active: z.boolean().default(true),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(50).optional().nullable(),
  avatar_url: avatarSchema.optional().nullable(),
  password: passwordPolicySchema.optional().or(z.literal('')),
  role: z.enum(['admin', 'operator', 'vendedor_yarda']),
  permissions: z.array(z.string().trim().min(1).max(80)).max(100),
  active: z.boolean(),
});

export const userProfileUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(50).optional().nullable(),
  avatar_url: avatarSchema.optional().nullable(),
  currentPassword: z.string().max(200).optional(),
  newPassword: passwordPolicySchema.optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordPolicySchema,
});

export const personalNoteSchema = z.object({
  content: z.string().max(100_000),
});

export const personalMessageSchema = z.object({
  recipientId: z.coerce.number().int().positive(),
  subject: z.string().trim().max(160).default(''),
  content: z.string().trim().min(1).max(10_000),
});

export const uploadPayloadSchema = z.object({
  orderId: z.coerce.number().int().positive().optional(),
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'text/plain',
    'text/csv',
  ]),
  base64: z.string().min(1).max(15_000_000).refine(value => {
    const encoded = value.replace(/^data:[^;,]+;base64,/, '');
    return encoded.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded);
  }, 'Contenido base64 invalido'),
});

export const wasenderDispatchSchema = z.object({
  phone: z.string().trim().min(4).max(40),
  message: z.string().trim().min(1).max(5000),
  mediaUrl: z.string().url().max(1000).optional().nullable(),
  mediaType: z.enum(['image', 'file']).optional().nullable(),
  orderId: z.coerce.number().int().positive().optional().nullable(),
});

export const backupSnapshotCreateSchema = z.object({
  tag: z.string().trim().max(50).regex(/^[a-zA-Z0-9_-]*$/).optional(),
});

export const backupRestoreSchema = z.object({
  filename: z.string().trim().min(1).max(255).optional(),
  sqlContent: z.string().min(1).max(100_000_000).optional(),
  createSafetySnapshot: z.boolean().default(true),
}).refine((data) => Boolean(data.filename || data.sqlContent), {
  message: 'Debes proporcionar un nombre de archivo o el contenido SQL a restaurar',
});

export const inventoryPartSchema = z.object({
  price: z.number().finite().min(0).max(10_000_000).optional(),
  cost: z.number().finite().min(0).max(10_000_000).optional(),
  year: z.string().trim().min(1, 'El año es requerido').max(50),
  brand: z.string().trim().min(1, 'La marca es requerida').max(100),
  model: z.string().trim().max(100).optional().nullable().default(''),
  partType: z.string().trim().min(1, 'El tipo de pieza es requerido').max(100).default('Motor'),
  vin: z.string().trim().max(50).optional().nullable(),
  palletNumber: z.string().trim().max(50).optional().nullable(),
  engineSpecs: z.string().trim().max(150).optional().nullable(),
  status: z.enum(['disponible', 'reservado', 'vendido', 'en_revision']).optional().default('disponible'),
  notes: z.string().max(5000).optional().nullable(),
  yearFrom: z.string().trim().max(50).optional().nullable().default(''),
  yearTo: z.string().trim().max(50).optional().nullable().default(''),
  isExactYearOnly: z.boolean().optional().default(false),
  soldAt: z.string().trim().max(100).optional().nullable(),
});

export const inventoryPartUpdateSchema = inventoryPartSchema.partial();

export const notificationChannelUpdateSchema = z.object({
  key: z.enum([
    'NUEVA_VENTA',
    'NUEVO_RECLAMO',
    'SEGUIMIENTO_RECLAMO',
    'SOLICITUD_REEMBOLSO',
    'CAMBIO_ESTATUS',
    'ORDEN_CANCELADA',
    'RESPALDO_AUTOMATICO',
    'BUSQUEDA_SUBASTAS',
    'LISTA_RECLAMOS',
    'ALERTA_SEGURIDAD',
  ]),
  name: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  targetType: z.enum(['superadmin_only', 'creator_dynamic', 'configurable_multicast']).optional(),
  isEnabled: z.boolean(),
  superadminEnabled: z.boolean().default(true),
  operatorIds: z.array(z.number()).default([]),
  externalContactIds: z.array(z.number()).default([]),
  triggerNotes: z.string().optional(),
  badgeLabel: z.string().optional(),
  icon: z.string().optional(),
});

export const notificationConfigUpdateSchema = z.object({
  channels: z.array(notificationChannelUpdateSchema),
});

export const externalContactSchema = z.object({
  name: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres'),
  phone: z.string().trim().min(7, 'El teléfono debe tener al menos 7 dígitos'),
  label: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  isActive: z.boolean().default(true),
  subscribedChannels: z.array(z.string()).default([]),
});

export const externalContactUpdateSchema = externalContactSchema.partial();

export const notificationTestDispatchSchema = z.object({
  channelKey: z.enum([
    'NUEVA_VENTA',
    'NUEVO_RECLAMO',
    'SEGUIMIENTO_RECLAMO',
    'SOLICITUD_REEMBOLSO',
    'CAMBIO_ESTATUS',
    'ORDEN_CANCELADA',
    'RESPALDO_AUTOMATICO',
    'BUSQUEDA_SUBASTAS',
    'LISTA_RECLAMOS',
    'ALERTA_SEGURIDAD',
  ]),
  customMessage: z.string().optional(),
  creatorUserId: z.number().optional(),
  creatorPhone: z.string().optional(),
  orderStatus: z.string().optional(),
});

export const verifyOtpSchema = z.object({
  code: z
    .string()
    .trim()
    .refine(
      (val) => {
        const clean = val.replace(/[\s-]/g, '');
        return /^[0-9]{6}$/.test(clean) || /^[a-zA-Z0-9]{8}$/.test(clean);
      },
      { message: 'El código debe tener 6 dígitos (OTP) o ser un código de respaldo de 8 caracteres' }
    ),
});

export const updateDeliveryDateSchema = z.object({
  version: z.number().int().positive(),
  deliveredAt: z.string().min(1, 'La fecha de entrega es obligatoria').refine(v => Number.isFinite(Date.parse(v)) && Date.parse(v) <= Date.now(), 'Fecha inválida o futura'),
  reason: z.string().trim().min(5, 'Explica el motivo de la correccion').max(255),
});

export const revertToPaidOtpRequestSchema = z.object({
  reason: z.string().trim().min(5, 'Explica el motivo de la reversión a Pagado').max(500),
});

export const revertToPaidSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'El código de seguridad debe tener 6 dígitos numéricos'),
  reason: z.string().trim().min(5, 'Explica el motivo de la reversión a Pagado').max(500),
  version: z.number().int().positive().optional(),
});

export const orderDeliveryFollowupSchema = z.object({
  contactChannel: z.enum(['call', 'sms', 'whatsapp']).default('call'),
  callResult: z
    .enum(['answered', 'no_answer', 'busy', 'wrong_number', 'sms_sent', 'sms_replied', 'sms_no_reply'])
    .default('answered'),
  partStatus: z.enum(['not_installed', 'in_process', 'installed_ok', 'has_issues', 'defect_claim']).default('not_installed'),
  warrantyWarningGiven: z.boolean().default(false),
  promisedInstallDate: z.string().max(80).optional().nullable(),
  notes: z.string().trim().min(5, 'Las notas de la llamada deben contener al menos 5 caracteres').max(5000),
  operatorName: z.string().trim().max(200).optional().nullable(),
});
