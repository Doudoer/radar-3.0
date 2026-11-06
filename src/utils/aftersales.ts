import { z } from 'zod';
import { shiftWorkflowDate, workflowDate } from './orderWorkflow';

export const warrantyTermsSchema = z.object({
  startedAt: z.string().datetime(),
  days: z.number().int().min(0).max(3650),
  policy: z.enum(['calendar', 'elapsed']),
});
export type WarrantyTerms = z.infer<typeof warrantyTermsSchema>;
export const fileEvidenceSchema = z.string().regex(/^\/uploads\/[a-zA-Z0-9._-]+\.(?:pdf|png|jpe?g|webp|gif)$/i);
export const coreDeadline = (deliveredAt?: string | Date | null) =>
  deliveredAt ? shiftWorkflowDate(workflowDate(deliveredAt), 15) : null;
export const warrantyDeadline = (terms: WarrantyTerms) => shiftWorkflowDate(workflowDate(terms.startedAt), terms.days);
export const refundExecutionSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('cash'), recipient: z.string().trim().min(2).max(200), confirmed: z.literal(true) }).strict(),
  z.object({ method: z.literal('square'), last4: z.string().regex(/^\d{4}$/), reference: z.string().trim().min(2).max(200),
    receipt: fileEvidenceSchema, confirmed: z.literal(true) }).strict(),
  z.object({ method: z.enum(['zelle', 'cashapp', 'transfer']), reference: z.string().trim().min(2).max(200),
    receipt: fileEvidenceSchema, confirmed: z.literal(true) }).strict(),
]);
export type RefundExecution = z.infer<typeof refundExecutionSchema>;
export const validateRefundBudget = (paid: number, completed: number, reserved: number, requested: number) =>
  Math.round(requested * 100) <= 0 || Math.round((completed + reserved) * 100) + Math.round(requested * 100) > Math.round(paid * 100)
    ? 'El reembolso excede el dinero cobrado disponible, incluyendo solicitudes pendientes.' : null;

const notes = z.string().trim().min(5).max(5000);
const files = z.array(fileEvidenceSchema).max(10).default([]);
export const aftersalesActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('invoice'), file: fileEvidenceSchema.refine(value => /\.pdf$/i.test(value), 'Selecciona un PDF') }),
  z.object({ action: z.literal('warranty_correct'), days: z.number().int().min(0).max(3650), notes }),
  z.object({ action: z.literal('claim_create'), notes, files, assignedUserId: z.number().int().positive().optional(),
    nextDate: z.string().date() }),
  z.object({ action: z.literal('claim_update'), id: z.number().int().positive(),
    stage: z.enum(['review', 'resolution', 'resolved', 'denied', 'replacement']),
    notes, notified: z.boolean().default(false), files,
    nextDate: z.string().date().optional(),
    replacementStock: z.string().trim().min(1).max(200).optional(), confirmed: z.boolean().optional() }),
  z.object({ action: z.literal('refund_create'), amount: z.number().finite().positive().max(9999999).multipleOf(0.01),
    notes: notes.max(255), files, claimId: z.number().int().positive().optional(), pieceRequired: z.boolean().default(false) }),
  z.object({ action: z.literal('refund_update'), id: z.number().int().positive(),
    stage: z.enum(['review', 'approved', 'rejected', 'completed']), notes,
    pieceReceived: z.boolean().default(false), execution: refundExecutionSchema.optional() }),
  z.object({ action: z.literal('core_receive'), notes, files, confirmed: z.literal(true) }),
  z.object({ action: z.literal('core_refund'), execution: refundExecutionSchema.refine(value => ['cash', 'square'].includes(value.method),
    'El core se devuelve únicamente en efectivo o por Square') }),
]);
export type AftersalesAction = z.infer<typeof aftersalesActionSchema>;
export interface AftersalesClaim {
  id: number; status: string; stage: string | null; description: string; resolution_notes: string | null;
  next_review_date: string | null; created_at: string; assigned_user_id: number | null;
  evidence_files: string[]; warranty_snapshot: WarrantyTerms | null;
}
export interface AftersalesRefund {
  id: number; amount: number; status: string; review_stage: string | null; reason: string;
  refund_scope: string | null; claim_id: number | null; piece_required: number;
  execution: RefundExecution | null; completed_at: string | null;
}
export interface AftersalesData {
  canManage: boolean; canAdmin: boolean;
  warranty: { terms: WarrantyTerms | null; status: string; daysLeft: number; deadline: string | null };
  core: { amount: number; deadline: string | null; receivedAt: string | null; refund: AftersalesRefund | null; reviewRequired: boolean };
  invoices: { id: number; file_url: string; actor_name: string; created_at: string }[];
  claims: AftersalesClaim[]; refunds: AftersalesRefund[];
  history: { id: number; action: string; notes: string; actor_name: string; created_at: string; details: AftersalesAction }[];
  paid: number; refunded: number; reserved: number;
}
