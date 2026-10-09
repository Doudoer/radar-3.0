export interface NuevaVentaTemplateData {
  orderCode: string;
  customerName: string;
  customerPhone?: string | null;
  vehicleYear?: string | number | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vin?: string | null;
  mainPart?: string | null;
  productSpecs?: string | null;
  totalPrice: number;
  downPayment?: number;
  deliveryType?: 'retiro_tienda' | 'envio_domicilio' | string | null;
  shippingAddress?: string | null;
  baseUrl?: string;
}

export function formatNuevaVentaMessage(data: NuevaVentaTemplateData): string {
  const cleanOrderCode = (data.orderCode || 'ORD-000000').replace(/^#+/, '');
  const clientPhone = data.customerPhone ? ` (${data.customerPhone})` : '';
  const vehicle = [data.vehicleYear, data.vehicleMake, data.vehicleModel].filter(Boolean).join(' ') || 'Vehículo no especificado';
  const vinStr = data.vin || 'Sin VIN registrado';
  const pieceStr = data.mainPart || 'Pieza';
  const specsStr = data.productSpecs ? ` – *(${data.productSpecs})*` : '';
  const total = Number(data.totalPrice || 0);
  const downPayment = Number(data.downPayment || 0);
  const pending = Math.max(0, total - downPayment);
  const isDelivery = data.deliveryType === 'envio_domicilio' || Boolean(data.shippingAddress);
  const logistics = isDelivery
    ? `Envío a Domicilio${data.shippingAddress ? `: ${data.shippingAddress}` : ''}`
    : 'Retiro en Tienda / Local';

  return `🚀 *NUEVA VENTA* | \`#${cleanOrderCode}\`

👤 *Cliente:* ${data.customerName || 'Cliente'}${clientPhone}
🚘 *Auto:* ${vehicle}
🔢 *VIN:* \`${vinStr}\`
⚙️ *Pieza:* ${pieceStr}${specsStr}
💰 *Monto:* $${total.toFixed(2)} *(Pendiente: $${pending.toFixed(2)})*
📍 *Logística:* ${logistics}`;
}

export interface BusquedaSubastasTemplateData {
  customerName: string;
  saleDate?: string | null;
  totalPrice: number;
  vehicleYear?: string | number | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  mainPart?: string | null;
  vin?: string | null;
  description?: string | null;
  auctionLinks?: Array<{
    house: 'Copart' | 'IAA' | string;
    date?: string | null;
    url: string;
  }>;
}

export function formatBusquedaSubastasMessage(data: BusquedaSubastasTemplateData): string {
  const autoPart = [data.vehicleYear, data.vehicleMake, data.vehicleModel, data.mainPart].filter(Boolean).join(' ') || 'Vehículo / Pieza';
  const saleDateStr = data.saleDate || new Date().toLocaleDateString('es-VE');
  const vinStr = data.vin || 'N/A';
  const descStr = data.description || 'Sin descripción adicional';

  let linksBlock = '';
  if (data.auctionLinks && data.auctionLinks.length > 0) {
    const list = data.auctionLinks.map((link, idx) => {
      const house = link.house || 'Subasta';
      const date = link.date ? ` Fecha: ${link.date}` : '';
      return `${idx + 1}. [${house}]${date}\n🔗 ${link.url}`;
    });
    linksBlock = `\n\n*Enlaces de subasta:*\n${list.join('\n\n')}`;
  } else {
    linksBlock = '\n\n*Enlaces de subasta:*\n_Sin lotes registrados actualmente._';
  }

  return `🚗 *BÚSQUEDA SUBASTA*🚗 

🔹 Cliente: ${data.customerName || 'Cliente'}
🔹 Fecha venta: ${saleDateStr}
🔹 Total: $${Number(data.totalPrice || 0).toFixed(2)}
🔹 ${autoPart}
🔹 VIN: ${vinStr}
🔹 Descripción: ${descStr}${linksBlock}`;
}

export interface NuevoReclamoTemplateData {
  orderCode: string;
  customerName: string;
  customerPhone?: string | null;
  vehicleYear?: string | number | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vin?: string | null;
  mainPart?: string | null;
  productSpecs?: string | null;
  claimReason: string;
  baseUrl?: string;
}

export function formatNuevoReclamoMessage(data: NuevoReclamoTemplateData): string {
  const cleanOrderCode = (data.orderCode || 'ORD-000000').replace(/^#+/, '');
  const clientPhone = data.customerPhone ? ` (${data.customerPhone})` : '';
  const vehicle = [data.vehicleYear, data.vehicleMake, data.vehicleModel].filter(Boolean).join(' ') || 'Vehículo';
  const vinStr = data.vin || 'N/A';
  const pieceStr = data.mainPart || 'Pieza';
  const specsStr = data.productSpecs ? ` – *(${data.productSpecs})*` : '';

  return `⚠️ *NUEVO RECLAMO* | \`#${cleanOrderCode}\`

👤 *Cliente:* ${data.customerName || 'Cliente'}${clientPhone}
🚘 *Auto:* ${vehicle}
🔢 *VIN:* \`${vinStr}\`
⚙️ *Pieza:* ${pieceStr}${specsStr}
📝 *Motivo:* ${data.claimReason || 'Sin motivo especificado'}`;
}

export interface SeguimientoReclamoTemplateData {
  orderCode: string;
  callNumber: number;
  customerName: string;
  customerPhone?: string | null;
  vehicleYear?: string | number | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  mainPart?: string | null;
  productSpecs?: string | null;
  originalClaimReason?: string | null;
  callNotes: string;
  attendantName?: string | null;
  baseUrl?: string;
}

export function formatSeguimientoReclamoMessage(data: SeguimientoReclamoTemplateData): string {
  const cleanOrderCode = (data.orderCode || 'ORD-000000').replace(/^#+/, '');
  const clientPhone = data.customerPhone ? ` (${data.customerPhone})` : '';
  const vehicle = [data.vehicleYear, data.vehicleMake, data.vehicleModel].filter(Boolean).join(' ') || 'Vehículo';
  const pieceStr = data.mainPart || 'Pieza';
  const specsStr = data.productSpecs ? ` – *(${data.productSpecs})*` : '';
  const originalReason = data.originalClaimReason || 'Sin motivo original registrado';
  const attendant = data.attendantName || 'Asesor de Garantías';

  return `🚨 *SEGUIMIENTO RECLAMO* | \`#${cleanOrderCode}\` *(Llamada #${data.callNumber || 1})*

👤 *Cliente:* ${data.customerName || 'Cliente'}${clientPhone}
🚘 *Auto:* ${vehicle}
⚙️ *Pieza:* ${pieceStr}${specsStr}
⚠️ *Reclamo Original:* ${originalReason}

💬 *Última Interacción (Llamada #${data.callNumber || 1}):*
_"${data.callNotes || 'Registro de llamada sin observaciones adicionales'}"_
👨‍💼 *Atendió:* ${attendant}`;
}

export interface RespaldoAutomaticoTemplateData {
  downloadUrl: string;
}

export function formatRespaldoAutomaticoMessage(data: RespaldoAutomaticoTemplateData): string {
  return `*Respaldo Automático Diario*

Se ha generado exitosamente la copia de seguridad de la base de datos.

Puedes descargar el archivo desde el siguiente enlace seguro (el enlace expira pronto y tiene un nombre encriptado):
${data.downloadUrl}

*Nota:* Guárdalo en un lugar seguro.`;
}

export interface PendingClaimItem {
  index: number;
  orderCode: string;
  customerName: string;
  customerPhone?: string | null;
  vehicleYear?: string | number | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  mainPart?: string | null;
  productSpecs?: string | null;
  claimReason?: string | null;
  daysElapsed: number;
  callCount: number;
}

export interface ListaReclamosTemplateData {
  dateFormatted?: string;
  claims: PendingClaimItem[];
  baseUrl?: string;
}

export function formatListaReclamosMessage(data: ListaReclamosTemplateData): string {
  const dateStr = data.dateFormatted || new Date().toLocaleDateString('es-VE');
  const total = data.claims.length;

  if (total === 0) {
    return `📋 *REPORTE DIARIO DE RECLAMOS PENDIENTES*
📅 *Fecha:* ${dateStr} - 08:00 AM (Hora Venezuela)
✅ *Total pendientes por atención:* 0

_No hay reclamos pendientes en este momento. Todas las garantías se encuentran al día._`;
  }

  const itemsFormatted = data.claims.map((item) => {
    const cleanOrder = (item.orderCode || 'ORD-000000').replace(/^#+/, '');
    const client = item.customerName || 'Cliente';
    const phone = item.customerPhone || 'Sin teléfono';
    const vehicle = [item.vehicleYear, item.vehicleMake, item.vehicleModel].filter(Boolean).join(' ') || 'Vehículo';
    const part = item.mainPart || 'Pieza';
    const specs = item.productSpecs ? ` (${item.productSpecs})` : '';
    const reason = item.claimReason || 'Sin observaciones';

    return `*${item.index}. Orden:* ${cleanOrder} | 👤 *${client}*
📞 *Teléfono:* ${phone}
🚗 *Vehículo:* ${vehicle}
⚙️ *Pieza:* ${part}${specs}
📝 *Motivo Reclamo:* "${reason}"
⏱️ *Días transcurridos:* ${item.daysElapsed} días
📞 *Llamadas del cliente:* ${item.callCount} `;
  });

  return `📋 *REPORTE DIARIO DE RECLAMOS PENDIENTES*
📅 *Fecha:* ${dateStr} - 08:00 AM (Hora Venezuela)
⚠️ *Total pendientes por atención:* ${total}
────────────────────────
${itemsFormatted.join('\n────────────────────────\n')}
────────────────────────`;
}

export interface OrdenCanceladaTemplateData {
  orderCode: string;
  customerName: string;
  vehicleYear?: string | number | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  mainPart?: string | null;
  productSpecs?: string | null;
  refundAmount: number;
  baseUrl?: string;
}

export function formatOrdenCanceladaMessage(data: OrdenCanceladaTemplateData): string {
  const cleanOrderCode = (data.orderCode || 'ORD-000000').replace(/^#+/, '');
  const vehiclePartSpecs = [
    data.vehicleYear,
    data.vehicleMake,
    data.vehicleModel,
    data.mainPart,
    data.productSpecs,
  ].filter(Boolean).join(', ') || 'Vehículo / Pieza';
  const refundStr = Number(data.refundAmount || 0).toFixed(2);

  return `Tipo: Orden cancelada - Reembolso pendiente
*Reembolso pendiente para orden ${cleanOrderCode}*
La orden de ${data.customerName || 'Cliente'} para ${vehiclePartSpecs}, fue cancelada. Verificar y emitir reembolso por $${refundStr}.`;
}

export interface SolicitudReembolsoTemplateData {
  orderCode: string;
  beneficiaryName: string;
  amount: number;
  reason: string;
}

export function formatSolicitudReembolsoMessage(data: SolicitudReembolsoTemplateData): string {
  const cleanOrderCode = (data.orderCode || 'ORD-000000').replace(/^#+/, '');
  const amountStr = Number(data.amount || 0).toFixed(2);

  return `💸 *RADAR V3 • Solicitud de Reembolso*

🔒 *Autorización Requerida (Super Admin)*
📄 *Orden:* #${cleanOrderCode}
👤 *Beneficiario:* ${data.beneficiaryName || 'Cliente / Taller'}
💵 *Monto:* $${amountStr}
📝 *Causa:* ${data.reason || 'Sin causa especificada'}

_🛡️ Canal exclusivo para Super Administrador_`;
}

export interface CambioEstatusTemplateData {
  orderCode: string;
  vehicleYear?: string | number | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  mainPart?: string | null;
  customerName: string;
  customerPhone?: string | null;
  newStatus: string;
  advisorName?: string | null;
}

export function formatCambioEstatusMessage(data: CambioEstatusTemplateData): string {
  const cleanOrderCode = (data.orderCode || 'ORD-000000').replace(/^#+/, '');
  const vehicle = [data.vehicleYear, data.vehicleMake, data.vehicleModel].filter(Boolean).join(' ') || 'Vehículo';
  const piece = data.mainPart || 'Pieza';
  const clientPhone = data.customerPhone ? ` (${data.customerPhone})` : '';
  const client = `${data.customerName || 'Cliente'}${clientPhone}`;
  const status = data.newStatus || 'Listo para Retiro';
  const advisor = data.advisorName || 'Asesor Asignado';

  return `🔔 *ACTUALIZACIÓN DE ORDEN / PIEZA LISTA*

📦 *Orden:* #${cleanOrderCode}
🚗 *Vehículo:* ${vehicle}
⚙️ *Pieza:* ${piece}
👤 *Cliente:* ${client}
📍 *Nuevo Estado:* ${status}
👨‍💼 *Asesor Asignado:* ${advisor}

_La pieza se encuentra lista. Por favor coordinar la entrega o despacho con el cliente._`;
}

export interface Otp2FATemplateData {
  code: string;
  userName?: string | null;
  moduleName?: string;
  expirationMinutes?: number;
}

export function formatOtp2FAMessage(data: Otp2FATemplateData): string {
  const module = data.moduleName || 'Relación Semanal & Finanzas';
  return `🔐 *RADAR V3 • Bóveda Financiera (2FA)*

Tu código de acceso de un solo uso es:
👉 *${data.code}*

📍 *Módulo:* ${module}
⏱️ _Este código expira en 1 minuto (60 seg) y es de un solo uso._
🛡️ _Canal exclusivo para Super Administrador_`;
}

export interface AlertaSeguridadTemplateData {
  event: string;
  ipAddress?: string | null;
  username?: string | null;
  details?: string | null;
  timestamp?: string;
}

export function formatAlertaSeguridadMessage(data: AlertaSeguridadTemplateData): string {
  const time = data.timestamp || new Date().toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'medium' });
  const user = data.username ? `👤 *Usuario:* ${data.username}\n` : '';
  const ip = data.ipAddress ? `🌐 *IP Origen:* \`${data.ipAddress}\`\n` : '';
  const detail = data.details ? `📝 *Detalle:* ${data.details}\n` : '';

  return `🚨 *ALERTA DE SEGURIDAD • RADAR 3.0*

⚠️ *Evento:* ${data.event}
${user}${ip}${detail}⏰ *Hora:* ${time}

🛡️ _Esta es una alerta preventiva del sistema enviada automáticamente al Super Administrador._`;
}

