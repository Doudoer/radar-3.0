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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/85 backdrop-blur-xl animate-fade-in">
      <div className="bg-[#070c18]/95 backdrop-blur-2xl border border-cyan-500/30 rounded-3xl w-full max-w-3xl max-h-[92vh] shadow-[0_20px_60px_rgba(0,0,0,0.85)] overflow-hidden flex flex-col text-xs text-slate-300 relative">
        {/* Laser Hairline */}
        <div className="cyber-laser-bar absolute top-0 left-0 right-0 z-20" />

        {/* Header */}
        <div className="px-5 py-4 border-b border-cyan-500/20 bg-[#0a1022]/80 backdrop-blur-md flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <span className="material-symbols-outlined text-[18px]">share</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-100 text-sm">Vista Rápida Compartible</h3>
                <span className="font-mono text-[10px] text-cyan-400 bg-cyan-950/40 border border-cyan-500/30 px-2 py-0.5 rounded-full font-bold">
                  {orderCode}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">Resumen para SMS, despacho y seguimiento con el cliente</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-lg border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center cursor-pointer transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="p-5 overflow-y-auto custom-scrollbar flex flex-col gap-4">
          <section className="rounded-2xl border border-cyan-500/30 bg-[#091024]/70 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-3.5">
              <div className="flex items-center gap-2 text-cyan-300 font-bold text-xs uppercase tracking-wider">
                <span className="material-symbols-outlined text-[18px] text-cyan-400">local_shipping</span>
                <span>Formato de Despacho & Mensaje Rápido</span>
              </div>
              <span className="rounded-full border border-purple-500/40 bg-purple-950/40 px-2.5 py-1 text-[10px] text-purple-300 font-mono font-bold">
                {deliveryMode}{!deliveryAddress && !isHomeDelivery ? ' (sin dirección)' : ''}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {/* English Version */}
              <div className="rounded-xl bg-[#060b17] p-3.5 border border-cyan-500/20">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-[11px] text-cyan-400 font-mono">Formato (English)</span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => copyText('English', englishMessage)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-slate-200 border border-slate-700 cursor-pointer transition-all active:scale-95"
                    >
                      Copiar
                    </button>
                    <button
                      type="button"
                      onClick={() => openWhatsApp(englishMessage)}
                      className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[10px] font-bold text-slate-950 cursor-pointer transition-all active:scale-95 flex items-center gap-1 shadow-[0_0_8px_rgba(16,185,129,0.3)]"
                    >
                      <span>WA</span>
                    </button>
                  </div>
                </div>
                <pre className="whitespace-pre-wrap rounded-lg bg-[#040812] p-2.5 text-[11px] leading-relaxed text-slate-200 font-mono min-h-40 border border-slate-800/80">{englishMessage}</pre>
              </div>

              {/* Spanish Version */}
              <div className="rounded-xl bg-[#060b17] p-3.5 border border-amber-500/20">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-[11px] text-amber-400 font-mono">Formato (Español)</span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => copyText('Español', spanishMessage)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-slate-200 border border-slate-700 cursor-pointer transition-all active:scale-95"
                    >
                      Copiar
                    </button>
                    <button
                      type="button"
                      onClick={() => openWhatsApp(spanishMessage)}
                      className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[10px] font-bold text-slate-950 cursor-pointer transition-all active:scale-95 flex items-center gap-1 shadow-[0_0_8px_rgba(16,185,129,0.3)]"
                    >
                      <span>WA</span>
                    </button>
                  </div>
                </div>
                <pre className="whitespace-pre-wrap rounded-lg bg-[#040812] p-2.5 text-[11px] leading-relaxed text-slate-200 font-mono min-h-40 border border-slate-800/80">{spanishMessage}</pre>
              </div>
            </div>
          </section>

          <div className="flex items-center justify-between gap-3 border-t border-cyan-500/20 pt-3">
            <span className="font-bold text-slate-200 text-xs">Ficha Técnica Consolidada</span>
            <button
              type="button"
              onClick={() => copyText('Resumen completo', summaryText)}
              className="rounded-xl border border-cyan-500/30 bg-cyan-950/30 hover:bg-cyan-950/60 px-3 py-1.5 text-[11px] font-bold text-cyan-300 transition-all cursor-pointer flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[15px]">content_copy</span>
              <span>Copiar Resumen Completo</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            {/* Vehicle Card */}
            <section className="rounded-xl border border-cyan-500/20 bg-[#070e1e] p-3.5 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-cyan-400 font-bold mb-2 pb-1.5 border-b border-cyan-500/20">
                  <span className="material-symbols-outlined text-[16px]">directions_car</span>
                  <span className="text-xs">Vehículo & Pieza</span>
                </div>
                <div className="space-y-1 text-[11px]">
                  <p><strong className="text-slate-400">Unidad:</strong> <span className="text-slate-200 font-semibold">{vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : '-'}</span></p>
                  <p><strong className="text-slate-400">Pieza:</strong> <span className="text-cyan-400 font-bold">{order?.mainPart || '-'}</span></p>
                  <p><strong className="text-slate-400">VIN:</strong> <span className="font-mono text-slate-300">{vehicle?.vin || '-'}</span></p>
                  <p><strong className="text-slate-400">Stock #:</strong> <span className="font-mono text-emerald-400 font-bold">{order?.stockNumber || '-'}</span></p>
                </div>
              </div>
            </section>

            {/* Client Card */}
            <section className="rounded-xl border border-cyan-500/20 bg-[#070e1e] p-3.5 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-emerald-400 font-bold mb-2 pb-1.5 border-b border-cyan-500/20">
                  <span className="material-symbols-outlined text-[16px]">person</span>
                  <span className="text-xs">Datos del Cliente</span>
                </div>
                <div className="space-y-1 text-[11px]">
                  <p><strong className="text-slate-400">Nombre:</strong> <span className="text-slate-200 font-semibold">{order?.customer.name || customerName}</span></p>
                  <p><strong className="text-slate-400">Teléfono:</strong> <span className="font-mono text-emerald-400">{order?.customer.phone || phone}</span></p>
                  {deliveryAddress && <p><strong className="text-slate-400">Dirección:</strong> <span className="text-slate-300">{deliveryAddress}</span></p>}
                </div>
              </div>
            </section>

            {/* Financials Card */}
            <section className="rounded-xl border border-cyan-500/20 bg-[#070e1e] p-3.5 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-amber-400 font-bold mb-2 pb-1.5 border-b border-cyan-500/20">
                  <span className="material-symbols-outlined text-[16px]">account_balance_wallet</span>
                  <span className="text-xs">Estado de Cuenta</span>
                </div>
                <div className="space-y-1 text-[11px]">
                  <p className="flex justify-between"><span className="text-slate-400">Precio Parte:</span> <span className="font-mono text-slate-200">${partPrice.toFixed(2)}</span></p>
                  <p className="flex justify-between"><span className="text-slate-400">Abonado:</span> <span className="font-mono text-emerald-400 font-bold">${downPayment.toFixed(2)}</span></p>
                  <p className="flex justify-between"><span className="text-slate-400">Core Fee:</span> <span className="font-mono text-slate-300">${coreFee.toFixed(2)}</span></p>
                  <p className="flex justify-between border-t border-slate-800 pt-1 mt-1 font-bold">
                    <span className="text-slate-300">Pendiente:</span>
                    <span className="font-mono text-rose-400">${balanceDue.toFixed(2)}</span>
                  </p>
                </div>
              </div>
            </section>
          </div>

          {copied && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-3.5 py-2 text-emerald-300 font-bold flex items-center gap-2 animate-fade-in shadow-[0_0_15px_rgba(16,185,129,0.2)]">
              <span className="material-symbols-outlined text-[18px]">check_circle</span>
              <span>{copied} copiado al portapapeles con éxito.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
