import { z } from 'zod';
import { imageEvidenceSchema } from './orderDelivery';

export const PAYMENT_METHODS = {
  cashapp: 'Cash App', zelle: 'Zelle', cashier_check: 'Cashier check', card: 'Tarjeta', cash: 'Efectivo',
} as const;
export const isBalancePaymentMethod = (method: string) => ['cash', 'cashapp', 'zelle'].includes(method);
export const settlementSchema = z.object({
  payments: z.array(z.object({
    amount: z.number().positive().max(99999999).multipleOf(0.01),
    method: z.enum(['cashapp', 'zelle', 'cashier_check', 'card', 'cash']),
    reference: z.string().trim().max(200),
    receivedBy: z.string().trim().max(200).optional(),
    receipt: imageEvidenceSchema.nullable().optional(),
    confirmed: z.literal(true),
  }).strict().refine(value => value.method === 'cash' || Boolean(value.receipt) || value.reference.length >= 3, 'Adjunta el comprobante del pago confirmado.')).max(20),
  coreAction: z.enum(['keep', 'received', 'charge', 'none']),
  coreAmount: z.number().min(0).max(99999999).multipleOf(0.01).nullable().optional(),
  coreReference: z.string().trim().max(1000),
  coreConfirmed: z.boolean(),
}).strict().refine(value => value.coreAction !== 'received' || value.coreConfirmed && value.coreReference.length >= 5,
  'Confirma la recepción física del core e indica su referencia (mínimo 5 caracteres).');
export type Settlement = z.infer<typeof settlementSchema>;
export const emptySettlement = (): Settlement => ({ payments: [], coreAction: 'keep', coreReference: '', coreConfirmed: false });
export function validateCollectionEvidence(input: Settlement) {
  for (const payment of input.payments) {
    if (payment.method === 'cash') {
      if ((payment.receivedBy?.trim().length || 0) < 2) throw new Error('Escribe el nombre de la persona que recibió el dinero en cash.');
      if (payment.receipt) throw new Error('Cash no admite imagen de comprobante.');
    } else {
      if (!payment.receipt) throw new Error('Los pagos no efectivos requieren imagen del comprobante.');
      if (payment.receivedBy?.trim()) throw new Error('La persona que recibió el dinero solo corresponde a cash.');
    }
  }
}
export interface SettlementOrder { price: number; shipping: number; core: number; paid: number; coreReceived: boolean }
export function previewSettlement(order: SettlementOrder, input: Settlement) {
  if ([order.price, order.shipping, order.core, order.paid].some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error('La orden contiene un importe inválido; requiere revisión administrativa.');
  }
  const cents = (value: number) => Math.round(value * 100);
  let effectiveCore = cents(order.core);
  if (input.coreAction === 'charge') {
    effectiveCore = input.coreAmount !== undefined && input.coreAmount !== null ? cents(input.coreAmount) : cents(order.core);
  } else if (input.coreAction === 'none') {
    effectiveCore = 0;
  } else if (input.coreAction === 'keep' && order.core === 0 && input.coreAmount) {
    effectiveCore = cents(input.coreAmount);
  }
  const coreCredit = input.coreAction === 'received' ? cents(order.core) : 0;
  if (input.coreAction === 'received') {
    if (order.coreReceived) throw new Error('La recepción del core ya está registrada.');
    if (!coreCredit) throw new Error('Esta orden no tiene un cargo de core pendiente.');
    if (cents(order.paid) > cents(order.price) + cents(order.shipping)) {
      throw new Error('El core ya tiene cobros que requieren devolución; tramítala desde Reembolsos, sin borrar cobros.');
    }
  }
  if (input.coreAction === 'none' && cents(order.core) > 0) {
    if (cents(order.paid) > cents(order.price) + cents(order.shipping)) {
      throw new Error('El core ya tiene cobros que requieren devolución; tramítala desde Reembolsos, sin borrar cobros.');
    }
  }
  const total = cents(order.price) + cents(order.shipping) + effectiveCore - coreCredit;
  const received = input.payments.reduce((sum, payment) => sum + cents(payment.amount), 0);
  const paid = cents(order.paid) + received;
  if (paid > total) throw new Error('El cobro supera el saldo pendiente.');
  return { total: total / 100, paid: paid / 100, balance: (total - paid) / 100, received: received / 100, coreCredit: coreCredit / 100 };
}
export interface PaymentDetail {
  version: number; order: SettlementOrder; canRecord: boolean;
  remainingMethodsOnly?: boolean;
  coreReceipt: { amount: number; reference: string; actor: string; date: string } | null;
  payments: { id: string; amount: number; method: keyof typeof PAYMENT_METHODS | null; reference: string | null; date: string | null; actor: string | null; receipt?: string | null; receivedBy?: string | null }[];
}
