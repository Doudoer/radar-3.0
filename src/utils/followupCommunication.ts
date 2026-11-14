import { z } from 'zod';
import { warrantyDeadline, type WarrantyTerms } from './aftersales';
import { deliveryPhotosSchema } from './orderDelivery';

export const communicationSchema = z.object({
  channel: z.enum(['call', 'sms', 'whatsapp']),
  warrantyWarningGiven: z.boolean(),
  screenshots: deliveryPhotosSchema.optional(),
}).strict().refine(value => value.channel !== 'call' || !value.screenshots?.length,
  'Las capturas de conversación solo corresponden a SMS.');
export type FollowupCommunication = z.infer<typeof communicationSchema>;
export const hasContactResponse = (result?: string | null) => result === 'answered' || result === 'sms_replied';
export function validateCommunication(communication: FollowupCommunication, result: string | null | undefined, part: string | null | undefined, outcome: string) {
  const allowed = communication.channel === 'call' ? ['answered', 'no_answer', 'busy', 'wrong_number']
    : ['sms_replied', 'sms_sent', 'sms_no_reply', 'wrong_number'];
  if (!result || !allowed.includes(result)) return 'El resultado no corresponde al canal de comunicación.';
  if (result === 'wrong_number' && outcome !== 'blocked') return 'El número incorrecto requiere un bloqueo con responsable.';
  if (!hasContactResponse(result)) {
    if (part || communication.warrantyWarningGiven) return 'Sin respuesta no puedes confirmar el estado de la pieza ni una advertencia recibida.';
    if (outcome === 'completed') return 'Necesitas una respuesta real del cliente para completar el objetivo.';
  } else {
    if (outcome === 'no_response') return 'La respuesta del cliente contradice una gestión sin respuesta.';
    if (!part) return 'Registra el estado de la pieza confirmado por el cliente.';
    if (part === 'not_installed' && !communication.warrantyWarningGiven) return 'Confirma que advertiste al cliente que la garantía continúa corriendo.';
  }
  return null;
}
const storedSchema = z.object({ format: z.literal('followup-contact-v1'), reference: z.string(), communication: communicationSchema }).strict();
export function decodeCommunicationEvidence(evidence: string) {
  if (!evidence.startsWith('{')) return null;
  let value: unknown;
  try { value = JSON.parse(evidence); } catch { return null; }
  const parsed = storedSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export function followupTemplate(stage: string, language: 'es' | 'en', customer: string, code: string, terms?: WarrantyTerms | null) {
  const coverage = terms ? terms.policy === 'calendar' ? `${warrantyDeadline(terms)} (Nueva York / New York)`
    : new Date(Date.parse(terms.startedAt) + terms.days * 86400000).toISOString() : null;
  const objective = stage === 'post_3' ? (language === 'es' ? '¿Recibiste la pieza y para cuándo está prevista la instalación?' : 'Did you receive the part and when is installation scheduled?')
    : stage === 'post_7' ? (language === 'es' ? '¿La pieza ya está instalada y funcionando correctamente?' : 'Is the part installed and working correctly?')
    : language === 'es' ? '¿La pieza sigue funcionando correctamente? ¿Hay alguna observación?' : 'Is the part still working correctly? Do you have any concerns?';
  return language === 'es'
    ? `Hola ${customer}, seguimiento de la orden ${code}. ${objective} ${terms ? `La garantía de ${terms.days} días vence ${coverage}.` : 'Consulta las condiciones de garantía registradas en tu orden.'} La garantía continúa corriendo aunque se demore la instalación. Por favor confirma esta información.`
    : `Hello ${customer}, following up on order ${code}. ${objective} ${terms ? `Your ${terms.days}-day warranty expires ${coverage}.` : 'Please check the warranty terms recorded for your order.'} The warranty continues running even if installation is delayed. Please confirm this information.`;
}
