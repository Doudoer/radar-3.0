import { z } from 'zod';
import { deliveryPhotosSchema } from './orderDelivery';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Indica una fecha válida.').refine(value => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Indica una fecha válida.');
export const preparationSchema = z.object({
  yardNotified: z.literal(true, { error: 'Confirma que el patio notificó que la pieza está lista.' }),
  channel: z.enum(['call', 'sms', 'in_person']),
  failedCall: z.boolean(),
  failedCallNotes: z.string().trim().max(1000),
  customerConfirmed: z.literal(true, { error: 'El cliente debe confirmar la recepción de la información.' }),
  dateFrom: date, dateTo: date,
  balanceNotified: z.literal(true, { error: 'Confirma que notificaste el saldo restante.' }),
  paymentMethodsNotified: z.literal(true, { error: 'Informa que el saldo se paga solo en efectivo, Cash App o Zelle.' }),
  corePlan: z.enum(['return_core', 'pay_core']),
  deliveryType: z.enum(['retiro_tienda', 'envio_domicilio']),
  address: z.string().trim().max(500),
  screenshots: deliveryPhotosSchema,
}).strict()
  .refine(value => value.dateTo >= value.dateFrom, 'La fecha final no puede ser anterior a la inicial.')
  .refine(value => value.channel !== 'sms' || value.failedCall && value.failedCallNotes.length >= 5,
    'El mensaje de texto solo se permite después de una llamada sin respuesta; documenta el intento.')
  .refine(value => value.channel === 'sms' ? value.screenshots.length > 0 : value.screenshots.length === 0,
    'El mensaje de texto requiere una o más capturas; la llamada no requiere capturas.')
  .refine(value => value.deliveryType !== 'envio_domicilio' || value.address.length >= 5, 'La dirección de entrega es obligatoria.')
  .refine(value => value.channel !== 'in_person' || value.deliveryType === 'retiro_tienda' && !value.failedCall && !value.failedCallNotes,
    'La atención presencial corresponde a recogida en yarda, sin registrar intentos de llamada.');
export type Preparation = z.infer<typeof preparationSchema>;
export type PreparationDraft = Omit<Preparation, 'yardNotified' | 'customerConfirmed' | 'balanceNotified' | 'paymentMethodsNotified' | 'corePlan'> & {
  yardNotified: boolean; customerConfirmed: boolean; balanceNotified: boolean; paymentMethodsNotified: boolean;
  corePlan: Preparation['corePlan'] | '';
};
export const emptyPreparation = (): PreparationDraft => ({
  yardNotified: false, channel: 'call', failedCall: false, failedCallNotes: '', customerConfirmed: false,
  dateFrom: '', dateTo: '', balanceNotified: false, paymentMethodsNotified: false, corePlan: '',
  deliveryType: 'retiro_tienda', address: '', screenshots: [],
});
export function validatePreparation(value: Preparation, today: string) {
  if (value.dateFrom < today) throw new Error('La fecha acordada no puede ser anterior a hoy.');
  if (value.channel === 'in_person' && (value.dateFrom !== today || value.dateTo !== today)) {
    throw new Error('La entrega inmediata en yarda debe corresponder a hoy.');
  }
}
