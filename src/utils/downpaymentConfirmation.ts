import { z } from 'zod';
import { imageEvidenceSchema } from './orderDelivery';

export const DOWNPAYMENT_METHODS = { cash: 'Cash / efectivo', zelle: 'Zelle', cashapp: 'Cash App', card: 'TDD/TDC · tarjeta de débito/crédito' } as const;
export const downpaymentSchema = z.array(z.object({
  method: z.enum(['cash', 'zelle', 'cashapp', 'card']),
  amount: z.number().positive().max(99999999).multipleOf(0.01),
  receivedBy: z.string().trim().max(200).optional(),
  senderName: z.string().trim().max(200).optional(),
  receipt: imageEvidenceSchema.nullable(),
}).strict().refine(value => value.method !== 'cash' || (value.receivedBy?.length || 0) >= 2,
  'Escribe el nombre de la persona que recibió el dinero en cash.')
  .refine(value => value.method === 'cash' ? value.receipt === null : Boolean(value.receipt),
  'Los pagos no efectivos requieren imagen del comprobante; cash no admite comprobante.')).min(1).max(20);

export type DownpaymentLine = z.infer<typeof downpaymentSchema>[number];

export function validateDownpayment(paid: number, lines: DownpaymentLine[]) {
  if (!Number.isFinite(paid) || paid <= 0) throw new Error('Primero registra el abono desde Registrar cobro; aquí solo se documenta dinero ya registrado.');
  const total = lines.reduce((sum, line) => sum + Math.round(line.amount * 100), 0);
  if (total !== Math.round(paid * 100)) throw new Error('Los montos deben coincidir exactamente con el downpayment ya registrado.');
}
