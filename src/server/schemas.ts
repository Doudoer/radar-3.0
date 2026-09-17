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
  orderId: z.coerce.number().int().positive(),
  previousOrderStatus: z.string().min(1).max(80),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254),
  role: z.string().trim().min(1).max(40),
  permissions: z.array(z.string().trim().min(1).max(80)).max(100),
  active: z.boolean(),
});

export const personalNoteSchema = z.object({
  content: z.string().max(100_000),
});
