export interface WasenderTestMessageInput {
  timeLabel: string;
  operatorName: string;
  sessionName?: string | null;
  connectedPhone?: string | null;
}

export const buildWasenderTestMessage = ({
  timeLabel,
  operatorName,
  sessionName,
  connectedPhone,
}: WasenderTestMessageInput): string => {
  const session = sessionName?.trim();
  const phone = connectedPhone?.trim();
  const sessionLine = session ? `\n🛡️ *Sesión:* ${session}${phone ? ` (${phone})` : ''}` : '';

  return [
    '🛰️ *RADAR V3 • Prueba de Conexión Wasender*',
    '',
    '✅ Enlace con WasenderAPI verificado exitosamente.',
    `⏰ *Hora:* ${timeLabel}`,
    `👤 *Operador:* ${operatorName.trim() || 'Administrador'}${sessionLine}`,
  ].join('\n');
};
