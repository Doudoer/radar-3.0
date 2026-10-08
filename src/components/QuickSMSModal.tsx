import React, { useMemo, useState } from 'react';
import { Order } from '../types';

interface QuickSMSModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerName: string;
  phone: string;
  order?: Order;
}

export const formatPrice = (amount: number): string => {
  if (Number.isInteger(amount)) {
    return `$${amount}`;
  }
  return `$${amount.toFixed(2)}`;
};

export const cleanPhoneDigits = (phoneStr: string): string => {
  const digits = phoneStr.replace(/\D/g, '');
  return digits.length >= 7 ? digits : phoneStr.trim();
};

export const getPartHeader = (mainPart?: string, vehicleTrim?: string, specs?: string): string => {
  const part = mainPart?.trim() || 'PIEZA';
  let type = part;
  if (/motor|engine|eng/i.test(part)) {
    type = 'ENGINE';
  } else if (/transmisi|transmission|caja|gearbox|tra/i.test(part)) {
    type = 'TRANSMISSION';
  } else {
    type = type.toUpperCase();
  }

  // Extract displacement or engine size (e.g. 2.5, 3.5L, 2.4, etc.)
  let displacement = vehicleTrim?.trim() || '';
  if (!displacement && specs) {
    const match = specs.match(/\b\d+\.\d+L?\b/i);
    if (match) displacement = match[0];
  }
  if (!displacement && part) {
    const match = part.match(/\b\d+\.\d+L?\b/i);
    if (match) displacement = match[0];
  }

  if (displacement && !type.includes(displacement)) {
    return `*${type}* ${displacement}`;
  }
  return `*${type}*`;
};

export interface DeliveryMessageOptions {
  order?: Order;
  fallbackName?: string;
  fallbackPhone?: string;
}

export const buildDeliveryMessages = ({
  order,
  fallbackName = 'Cliente',
  fallbackPhone = '',
}: DeliveryMessageOptions) => {
  const activeName = order?.customer?.name || fallbackName;
  const activePhone = cleanPhoneDigits(order?.customer?.phone || fallbackPhone);

  if (!order) {
    return {
      english: `*${activeName}*\n*Phone:* ${activePhone}`,
      spanish: `*${activeName}*\n*Teléfono:* ${activePhone}`,
    };
  }

  const partPrice = order.financials?.partPrice ?? order.financials?.baseMSRP ?? 0;
  const downPayment = order.financials?.downPayment ?? order.financials?.advancePayment ?? 0;
  const deliveryFee = order.financials?.deliveryFee ?? 0;
  const coreFee = order.financials?.coreFee ?? 0;
  const total = order.financials?.total ?? partPrice + deliveryFee + coreFee;
  const balanceDue = order.financials?.balanceDue ?? Math.max(0, total - downPayment);

  const isHomeDelivery = order.deliveryType === 'envio_domicilio';
  const deliveryAddress = order.customer?.shippingAddress?.trim();
  const coreDeposit = coreFee > 0 ? (Number.isInteger(coreFee) ? coreFee.toString() : coreFee.toFixed(2)) : '150';

  const partHeader = getPartHeader(order.mainPart, order.vehicle?.trim, order.productSpecs);
  const partDescription = order.productSpecs?.trim() || (order.stockNumber ? `Stock #: ${order.stockNumber}` : '');

  // English Format
  const enLines: string[] = [
    `*${order.customer?.name || activeName}*`,
    `*Phone:* ${cleanPhoneDigits(order.customer?.phone || activePhone)}`,
    `${order.vehicle?.make || ''} ${order.vehicle?.model || ''} ${order.vehicle?.year || ''}`.trim(),
    partHeader,
    partDescription,
  ];

  if (isHomeDelivery && deliveryAddress) {
    enLines.push(`Address: ${deliveryAddress}`);
  }

  enLines.push(`Remaining Balance: *${formatPrice(balanceDue)}*`);

  if (order.notes?.trim()) {
    enLines.push(`*Note:* ${order.notes.trim()}`);
  } else {
    enLines.push(
      `*Note:* Collect old core from customer upon delivery. If customer does not have core, collect an additional refundable $${coreDeposit} deposit.`
    );
  }

  // Spanish Format
  const esLines: string[] = [
    `*${order.customer?.name || activeName}*`,
    `*Teléfono:* ${cleanPhoneDigits(order.customer?.phone || activePhone)}`,
    `${order.vehicle?.make || ''} ${order.vehicle?.model || ''} ${order.vehicle?.year || ''}`.trim(),
    partHeader,
    partDescription,
  ];

  if (isHomeDelivery && deliveryAddress) {
    esLines.push(`Dirección: ${deliveryAddress}`);
  }

  esLines.push(`Balance Pendiente: *${formatPrice(balanceDue)}*`);

  if (order.notes?.trim()) {
    esLines.push(`*Nota:* ${order.notes.trim()}`);
  } else {
    esLines.push(
      `*Nota:* Solicitar el core usado al cliente al entregar. En caso de no tenerlo listo, cobrar $${coreDeposit} de depósito extra reembolsable.`
    );
  }

  return {
    english: enLines.filter(Boolean).join('\n'),
    spanish: esLines.filter(Boolean).join('\n'),
  };
};

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
  const deliveryAddress = order?.customer.shippingAddress?.trim();
  const deliveryModeBadge = isHomeDelivery
    ? '🚚 Envío a Domicilio'
    : '🏬 Retiro en Tienda (Entrega sin dirección)';

  const activePhone = cleanPhoneDigits(order?.customer.phone || phone || '');

  const { english: englishMessage, spanish: spanishMessage } = useMemo(() => {
    return buildDeliveryMessages({
      order,
      fallbackName: customerName,
      fallbackPhone: phone,
    });
  }, [customerName, order, phone]);

  if (!isOpen) return null;

  const copyText = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const openWhatsApp = (text: string) => {
    const cleanNum = activePhone.replace(/[^0-9]/g, '');
    window.open(`https://wa.me/${cleanNum}?text=${encodeURIComponent(text)}`, '_blank');
  };

  const summaryText = `${spanishMessage}\n\n---\n\n${englishMessage}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-black/80 dark:bg-black/85 backdrop-blur-xl animate-fade-in">
      <div className="cyber-card w-full max-w-4xl max-h-[min(94vh,740px)] shadow-2xl overflow-hidden flex flex-col text-xs text-[var(--text-primary)] relative border border-cyan-500/30">
        {/* Laser Hairline */}
        <div className="cyber-laser-bar absolute top-0 left-0 right-0 z-20" />

        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-cyan-500/20 bg-[var(--bg-card-subtle)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
              <span className="material-symbols-outlined text-[18px]">share</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-[var(--text-heading)] text-sm">Vista Rápida Compartible</h3>
                <span className="font-mono text-[10px] text-cyan-400 bg-cyan-950/40 dark:bg-cyan-950/60 border border-cyan-500/30 px-2 py-0.5 rounded-full font-bold">
                  {orderCode}
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">Resumen de entrega y despacho en formato WhatsApp / SMS</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-cyan-500/10 flex items-center justify-center cursor-pointer transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="p-3.5 sm:p-5 overflow-y-auto custom-scrollbar flex-1 min-h-0 flex flex-col gap-4">
          {/* Main Delivery Message Section matching user reference image */}
          <section className="rounded-2xl border border-sky-500/30 bg-sky-950/20 dark:bg-[#0c192c]/80 p-4 shadow-md">
            <div className="flex flex-wrap items-center justify-between gap-2.5 mb-3.5">
              <div className="flex items-center gap-2 text-sky-400 dark:text-sky-300 font-bold text-xs sm:text-sm">
                <span className="material-symbols-outlined text-[20px] text-sky-400">local_shipping</span>
                <span>Formato para Mensaje de Entrega / Delivery</span>
              </div>
              <span className="rounded-full border border-purple-400/40 bg-purple-900/30 dark:bg-purple-950/60 px-3 py-1 text-[11px] text-purple-300 font-medium shadow-sm">
                {deliveryModeBadge}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {/* English Version Card */}
              <div className="rounded-xl bg-[#1e293b]/70 dark:bg-[#131f33] p-3.5 border border-slate-700/60 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="font-bold text-xs text-sky-400 flex items-center gap-1.5">
                    <span>🇺🇸</span>
                    <span>Format (English)</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => copyText('English', englishMessage)}
                      className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 dark:bg-white dark:hover:bg-slate-100 text-[11px] font-bold text-slate-900 border border-slate-200 cursor-pointer transition-all active:scale-95 flex items-center gap-1 shadow-sm"
                    >
                      <span className="material-symbols-outlined text-[13px]">content_copy</span>
                      <span>Copiar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openWhatsApp(englishMessage)}
                      className="px-2.5 py-1 rounded-lg bg-[#22c55e] hover:bg-[#16a34a] text-[11px] font-bold text-white cursor-pointer transition-all active:scale-95 flex items-center gap-1 shadow-[0_0_8px_rgba(34,197,94,0.35)]"
                    >
                      <span className="material-symbols-outlined text-[13px]">chat</span>
                      <span>WA</span>
                    </button>
                  </div>
                </div>
                <pre className="whitespace-pre-wrap rounded-lg bg-slate-950/60 dark:bg-slate-950/80 p-3 text-[11px] leading-relaxed text-slate-200 font-mono min-h-[140px] border border-slate-800 select-all custom-scrollbar">
                  {englishMessage}
                </pre>
              </div>

              {/* Spanish Version Card */}
              <div className="rounded-xl bg-[#1e293b]/70 dark:bg-[#131f33] p-3.5 border border-slate-700/60 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="font-bold text-xs text-sky-400 flex items-center gap-1.5">
                    <span>🇪🇸</span>
                    <span>Formato (Español)</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => copyText('Español', spanishMessage)}
                      className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 dark:bg-white dark:hover:bg-slate-100 text-[11px] font-bold text-slate-900 border border-slate-200 cursor-pointer transition-all active:scale-95 flex items-center gap-1 shadow-sm"
                    >
                      <span className="material-symbols-outlined text-[13px]">content_copy</span>
                      <span>Copiar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openWhatsApp(spanishMessage)}
                      className="px-2.5 py-1 rounded-lg bg-[#22c55e] hover:bg-[#16a34a] text-[11px] font-bold text-white cursor-pointer transition-all active:scale-95 flex items-center gap-1 shadow-[0_0_8px_rgba(34,197,94,0.35)]"
                    >
                      <span className="material-symbols-outlined text-[13px]">chat</span>
                      <span>WA</span>
                    </button>
                  </div>
                </div>
                <pre className="whitespace-pre-wrap rounded-lg bg-slate-950/60 dark:bg-slate-950/80 p-3 text-[11px] leading-relaxed text-slate-200 font-mono min-h-[140px] border border-slate-800 select-all custom-scrollbar">
                  {spanishMessage}
                </pre>
              </div>
            </div>
          </section>

          {/* Ficha Técnica Consolidada Section */}
          <div className="flex items-center justify-between gap-3 border-t border-cyan-500/20 pt-3">
            <span className="font-bold text-[var(--text-heading)] text-xs">Ficha Técnica Consolidada</span>
            <button
              type="button"
              onClick={() => copyText('Resumen completo', summaryText)}
              className="cyber-btn-secondary px-3 py-1.5 text-[11px] font-bold text-cyan-400 flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[15px]">content_copy</span>
              <span>Copiar Resumen Completo</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Vehicle Card */}
            <section className="rounded-xl border border-cyan-500/20 bg-[var(--bg-card-subtle)] p-3 flex flex-col justify-between shadow-sm">
              <div>
                <div className="flex items-center gap-1.5 text-cyan-400 font-bold mb-2 pb-1.5 border-b border-cyan-500/20">
                  <span className="material-symbols-outlined text-[16px]">directions_car</span>
                  <span className="text-xs">Vehículo & Pieza</span>
                </div>
                <div className="space-y-1 text-[11px]">
                  <p><strong className="text-[var(--text-secondary)]">Unidad:</strong> <span className="text-[var(--text-primary)] font-semibold">{vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : '-'}</span></p>
                  <p><strong className="text-[var(--text-secondary)]">Pieza:</strong> <span className="text-cyan-400 font-bold">{order?.mainPart || '-'}</span></p>
                  <p><strong className="text-[var(--text-secondary)]">VIN:</strong> <span className="font-mono text-[var(--text-primary)]">{vehicle?.vin || '-'}</span></p>
                  <p><strong className="text-[var(--text-secondary)]">Stock #:</strong> <span className="font-mono text-emerald-400 font-bold">{order?.stockNumber || '-'}</span></p>
                </div>
              </div>
            </section>

            {/* Client Card */}
            <section className="rounded-xl border border-cyan-500/20 bg-[var(--bg-card-subtle)] p-3 flex flex-col justify-between shadow-sm">
              <div>
                <div className="flex items-center gap-1.5 text-emerald-400 font-bold mb-2 pb-1.5 border-b border-cyan-500/20">
                  <span className="material-symbols-outlined text-[16px]">person</span>
                  <span className="text-xs">Datos del Cliente</span>
                </div>
                <div className="space-y-1 text-[11px]">
                  <p><strong className="text-[var(--text-secondary)]">Nombre:</strong> <span className="text-[var(--text-primary)] font-semibold">{order?.customer.name || customerName}</span></p>
                  <p><strong className="text-[var(--text-secondary)]">Teléfono:</strong> <span className="font-mono text-emerald-400 font-bold">{order?.customer.phone || phone}</span></p>
                  {deliveryAddress && <p><strong className="text-[var(--text-secondary)]">Dirección:</strong> <span className="text-[var(--text-primary)]">{deliveryAddress}</span></p>}
                </div>
              </div>
            </section>

            {/* Financials Card */}
            <section className="rounded-xl border border-cyan-500/20 bg-[var(--bg-card-subtle)] p-3 flex flex-col justify-between shadow-sm">
              <div>
                <div className="flex items-center gap-1.5 text-amber-400 font-bold mb-2 pb-1.5 border-b border-cyan-500/20">
                  <span className="material-symbols-outlined text-[16px]">account_balance_wallet</span>
                  <span className="text-xs">Estado de Cuenta</span>
                </div>
                <div className="space-y-1 text-[11px]">
                  <p className="flex justify-between"><span className="text-[var(--text-secondary)]">Precio Parte:</span> <span className="font-mono text-[var(--text-primary)] font-semibold">${partPrice.toFixed(2)}</span></p>
                  <p className="flex justify-between"><span className="text-[var(--text-secondary)]">Abonado:</span> <span className="font-mono text-emerald-400 font-bold">${downPayment.toFixed(2)}</span></p>
                  <p className="flex justify-between"><span className="text-[var(--text-secondary)]">Core Fee:</span> <span className="font-mono text-[var(--text-primary)]">${coreFee.toFixed(2)}</span></p>
                  <p className="flex justify-between border-t border-cyan-500/20 pt-1 mt-1 font-bold">
                    <span className="text-[var(--text-primary)]">Pendiente:</span>
                    <span className="font-mono text-rose-500 font-black">${balanceDue.toFixed(2)}</span>
                  </p>
                </div>
              </div>
            </section>
          </div>

          {copied && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-emerald-400 font-bold flex items-center gap-2 animate-fade-in shadow-sm">
              <span className="material-symbols-outlined text-[18px]">check_circle</span>
              <span>{copied} copiado al portapapeles con éxito.</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-cyan-500/20 bg-[var(--bg-card-subtle)] flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="cyber-btn-secondary px-4 py-2 text-xs font-bold"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

