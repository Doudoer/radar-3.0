import React, { useMemo, useState } from 'react';
import { Order } from '../types';

interface QuickSMSModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerName: string;
  phone: string;
  order?: Order;
}

export const QuickSMSModal: React.FC<QuickSMSModalProps> = ({
  isOpen,
  onClose,
  customerName,
  phone,
  order,
}) => {
  const [copied, setCopied] = useState<string | null>(null);

  const orderCode = order?.code || 'ORDEN';
  const vehicle = order?.vehicle;
  const financials = order?.financials;
  const partPrice = financials?.partPrice ?? financials?.baseMSRP ?? 0;
  const downPayment = financials?.downPayment ?? financials?.advancePayment ?? 0;
  const deliveryFee = financials?.deliveryFee ?? 0;
  const coreFee = financials?.coreFee ?? 0;
  const total = financials?.total ?? partPrice + deliveryFee + coreFee;
  const balanceDue = financials?.balanceDue ?? Math.max(0, total - downPayment);
  const isHomeDelivery = order?.deliveryType === 'envio_domicilio';
  const deliveryMode = isHomeDelivery ? 'Envío a Domicilio' : 'Retiro en Tienda';
  const deliveryAddress = order?.customer.shippingAddress?.trim();

  const spanishMessage = useMemo(() => {
    if (!order) return `Cliente: ${customerName}\nTeléfono: ${phone}`;

    return [
      `*${order.customer.name}*`,
      `*Teléfono:* ${order.customer.phone || phone}`,
      `${order.vehicle.make} ${order.vehicle.model} ${order.vehicle.year}`,
      `*${order.mainPart}*`,
      order.stockNumber ? `Stock #: ${order.stockNumber}` : '',
      `Tipo de entrega: ${deliveryMode}`,
      deliveryAddress ? `Dirección: ${deliveryAddress}` : '',
      `Monto parte: $${partPrice.toFixed(2)}`,
      `Abono: $${downPayment.toFixed(2)}`,
      `Flete: $${deliveryFee.toFixed(2)}`,
      `Core fee: $${coreFee.toFixed(2)}`,
      `Balance pendiente: $${balanceDue.toFixed(2)}`,
    ].filter(Boolean).join('\n');
  }, [balanceDue, coreFee, customerName, deliveryAddress, deliveryFee, deliveryMode, downPayment, order, partPrice, phone]);

  const englishMessage = useMemo(() => {
    if (!order) return `Customer: ${customerName}\nPhone: ${phone}`;

    return [
      `*${order.customer.name}*`,
      `*Phone:* ${order.customer.phone || phone}`,
      `${order.vehicle.make} ${order.vehicle.model} ${order.vehicle.year}`,
      `*${order.mainPart}*`,
      order.stockNumber ? `Stock #: ${order.stockNumber}` : '',
      `Delivery type: ${isHomeDelivery ? 'Delivery' : 'Store Pickup'}`,
      deliveryAddress ? `Address: ${deliveryAddress}` : '',
      `Part price: $${partPrice.toFixed(2)}`,
      `Downpayment: $${downPayment.toFixed(2)}`,
      `Delivery: $${deliveryFee.toFixed(2)}`,
      `Core fee: $${coreFee.toFixed(2)}`,
      `Balance due: $${balanceDue.toFixed(2)}`,
    ].filter(Boolean).join('\n');
  }, [balanceDue, coreFee, customerName, deliveryAddress, deliveryFee, downPayment, isHomeDelivery, order, partPrice, phone]);

  if (!isOpen) return null;

  const copyText = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1800);
  };

  const openWhatsApp = (text: string) => {
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`, '_blank');
  };

  const summaryText = `${spanishMessage}\n\n${englishMessage}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/75 backdrop-blur-md">
      <div className="bg-[#111827] border border-[#263750] rounded-2xl w-full max-w-3xl max-h-[92vh] shadow-2xl overflow-hidden flex flex-col text-xs text-[#cbd5e1]">
        <div className="px-4 py-3 border-b border-[#263750] bg-[#10213a] flex items-center justify-between">
          <div>
            <h3 className="font-bold text-[#f1f5f9] text-sm">Vista Rápida Compartible - {orderCode}</h3>
            <p className="text-[11px] text-[#9fb2cf] mt-0.5">Resumen para SMS, entrega y seguimiento del cliente</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-lg border border-[#3b4d6a] text-[#cbd5e1] hover:text-white hover:bg-[#1e293b] flex items-center justify-center cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="p-4 overflow-y-auto custom-scrollbar flex flex-col gap-4">
          <section className="rounded-xl border border-[#24508f] bg-[#102543] p-3">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2 text-[#8ec5ff] font-bold text-[11px]">
                <span className="material-symbols-outlined text-[16px]">local_shipping</span>
                Formato para Mensaje de Entrega / Delivery
              </div>
              <span className="rounded-full border border-[#7c3aed]/50 bg-[#7c3aed]/20 px-2 py-1 text-[10px] text-[#d8b4fe]">
                {deliveryMode}{!deliveryAddress && !isHomeDelivery ? ' (sin dirección)' : ''}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-lg bg-[#0b1324] p-3 border border-[#1d3354]">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-[11px] text-[#8ec5ff]">Formato (English)</span>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => copyText('English', englishMessage)} className="px-2 py-1 rounded-md bg-[#1e293b] text-[10px] font-bold text-white border border-[#334155] cursor-pointer">Copiar</button>
                    <button type="button" onClick={() => openWhatsApp(englishMessage)} className="px-2 py-1 rounded-md bg-[#22c55e] text-[10px] font-bold text-[#062711] cursor-pointer">WA</button>
                  </div>
                </div>
                <pre className="whitespace-pre-wrap rounded-md bg-[#172033] p-2 text-[11px] leading-relaxed text-[#f8fafc] font-mono min-h-40">{englishMessage}</pre>
              </div>

              <div className="rounded-lg bg-[#0b1324] p-3 border border-[#1d3354]">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-[11px] text-[#fbbf24]">Formato (Español)</span>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => copyText('Español', spanishMessage)} className="px-2 py-1 rounded-md bg-[#1e293b] text-[10px] font-bold text-white border border-[#334155] cursor-pointer">Copiar</button>
                    <button type="button" onClick={() => openWhatsApp(spanishMessage)} className="px-2 py-1 rounded-md bg-[#22c55e] text-[10px] font-bold text-[#062711] cursor-pointer">WA</button>
                  </div>
                </div>
                <pre className="whitespace-pre-wrap rounded-md bg-[#172033] p-2 text-[11px] leading-relaxed text-[#f8fafc] font-mono min-h-40">{spanishMessage}</pre>
              </div>
            </div>
          </section>

          <div className="flex items-center justify-between gap-3 border-t border-[#263750] pt-3">
            <span className="font-bold text-[#dfe2ef]">Ficha Técnica Completa de la Orden</span>
            <button
              type="button"
              onClick={() => copyText('Resumen completo', summaryText)}
              className="rounded-lg border border-[#334155] bg-[#0b1324] px-3 py-2 text-[11px] font-bold text-[#f1f5f9] hover:bg-[#1e293b] cursor-pointer"
            >
              Copiar Resumen Completo
            </button>
          </div>

          <section className="rounded-xl border border-[#475569] bg-[#1f2937]/70 p-4">
            <h4 className="font-bold text-[#f8fafc] mb-3">Detalles del Vehículo</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-[#475569]/50 pt-3">
              <div><strong>Unidad:</strong> {vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : '-'}</div>
              <div><strong>Tipo de pieza:</strong> <span className="text-[#58a6ff]">{order?.mainPart || '-'}</span></div>
              <div><strong>VIN:</strong> <span className="font-mono">{vehicle?.vin || '-'}</span></div>
              <div><strong>Stock #:</strong> <span className="font-mono text-[#34d399]">{order?.stockNumber || '-'}</span></div>
              <div className="sm:col-span-2"><strong>Descripción:</strong> {order?.productSpecs || order?.notes || '-'}</div>
            </div>
          </section>

          <section className="rounded-xl border border-[#475569] bg-[#1f2937]/70 p-4">
            <h4 className="font-bold text-[#f8fafc] mb-3">Detalles del Cliente</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-[#475569]/50 pt-3">
              <div><strong>Nombre:</strong> {order?.customer.name || customerName}</div>
              <div><strong>Teléfono:</strong> <span className="font-mono">{order?.customer.phone || phone}</span></div>
              {deliveryAddress && <div className="sm:col-span-2"><strong>Dirección:</strong> {deliveryAddress}</div>}
            </div>
          </section>

          <section className="rounded-xl border border-[#475569] bg-[#1f2937]/70 p-4">
            <h4 className="font-bold text-[#f8fafc] mb-3">Detalles de Finanzas</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-[#475569]/50 pt-3">
              <div><strong>Precio pieza:</strong> ${partPrice.toFixed(2)}</div>
              <div><strong>Core fee:</strong> ${coreFee.toFixed(2)}</div>
              <div><strong>Total:</strong> ${total.toFixed(2)}</div>
              <div><strong>Abono:</strong> <span className="text-[#34d399]">${downPayment.toFixed(2)}</span></div>
              <div><strong>Pendiente:</strong> <span className="text-[#f87171]">${balanceDue.toFixed(2)}</span></div>
              <div><strong>Método:</strong> Por definir</div>
            </div>
          </section>

          {copied && (
            <div className="rounded-lg border border-[#34d399]/40 bg-[#10b981]/10 px-3 py-2 text-[#86efac] font-bold">
              {copied} copiado al portapapeles.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
