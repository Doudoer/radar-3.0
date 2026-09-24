import { z } from 'zod';

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
  code: z.string().trim().min(1).max(80).optional(),
  userId: z.coerce.number().int().positive().optional().nullable(),
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
  }).optional(),
  vehicle: z.object({
    vin: z.string().max(40).optional().nullable(),
    make: z.string().max(100).optional().nullable(),
    model: z.string().max(100).optional().nullable(),
    trim: z.string().max(100).optional().nullable(),
    year: z.coerce.number().int().min(1886).max(2200).optional().nullable(),
    color: z.string().max(80).optional().nullable(),
    transmission: z.string().max(100).optional().nullable(),
  }).optional(),
  financials: z.object({
    partPrice: z.coerce.number().finite().min(0).max(10_000_000).optional(),
    coreFee: z.coerce.number().finite().min(0).max(10_000_000).optional(),
    downPayment: z.coerce.number().finite().min(0).max(10_000_000).optional(),
    deliveryFee: z.coerce.number().finite().min(0).max(10_000_000).optional(),
  }).optional(),
  deliveryType: z.enum(['retiro_tienda', 'envio_domicilio']).optional(),
  scheduledPickupAt: z.string().max(80).optional().nullable(),
  deliveredAt: z.string().max(80).optional().nullable(),
  warrantyStarted: z.boolean().optional(),
  notes: z.string().max(5000).optional().nullable(),
  claimReason: z.string().max(5000).optional().nullable(),
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
  notes: z.string().max(5000).optional().nullable(),
});

export const refundCreateSchema = z.object({
  orderId: z.coerce.number().int().positive(),
  amount: z.coerce.number().finite().positive().max(10_000_000),
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
  .refine((val) => /[A-Z]/.test(val), 'Debe incluir al menos una letra mayúscula (A-Z)')
  .refine((val) => /[a-z]/.test(val), 'Debe incluir al menos una letra minúscula (a-z)')
  .refine((val) => /[0-9]/.test(val), 'Debe incluir al menos un dígito (0-9)')
  .refine((val) => /[^a-zA-Z0-9]/.test(val), 'Debe incluir al menos un símbolo o punto (. ! @ # $ etc.)');

export const userCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254),
  password: passwordPolicySchema,
  role: z.enum(['admin', 'operator']).default('operator'),
  permissions: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  active: z.boolean().default(true),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254),
  password: passwordPolicySchema.optional(),
  role: z.string().trim().min(1).max(40),
  permissions: z.array(z.string().trim().min(1).max(80)).max(100),
  active: z.boolean(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
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
  base64: z.string().min(1).max(15_000_000),
});

export const wasenderDispatchSchema = z.object({
  phone: z.string().trim().min(4).max(40),
  message: z.string().trim().min(1).max(5000),
  mediaUrl: z.string().url().max(1000).optional().nullable(),
  mediaType: z.enum(['image', 'file']).optional().nullable(),
  orderId: z.coerce.number().int().positive().optional().nullable(),
});

export const backupSnapshotCreateSchema = z.object({
  tag: z.string().trim().max(50).optional(),
});

export const backupRestoreSchema = z.object({
  filename: z.string().trim().min(1).max(255).optional(),
  sqlContent: z.string().min(1).max(100_000_000).optional(),
  createSafetySnapshot: z.boolean().default(true),
}).refine((data) => Boolean(data.filename || data.sqlContent), {
  message: 'Debes proporcionar un nombre de archivo o el contenido SQL a restaurar',
});
