import React, { useState } from 'react';
import { Order, OrderStatus } from '../types';
import { apiFetch } from '../services/apiFetch';

interface RefundRequestViewProps {
  order: Order;
  onBack: () => void;
  onUpdateOrder?: (updatedOrder: Order) => void;
  onSuccess?: (msg: string) => void;
}

export const RefundRequestView: React.FC<RefundRequestViewProps> = ({
  order,
  onBack,
  onUpdateOrder,
  onSuccess,
}) => {
  const partPrice = order.financials.partPrice ?? order.financials.baseMSRP ?? 0;
  const deliveryFee = order.financials.deliveryFee ?? 0;
  const coreFee = order.financials.coreFee ?? 0;
  const downPayment = order.financials.downPayment ?? order.financials.advancePayment ?? 0;
  const grossSubtotal = partPrice + deliveryFee + coreFee;
  const totalPayable = Math.max(0, grossSubtotal - downPayment);

  const [amountType, setAmountType] = useState<'downpayment' | 'total' | 'custom'>(
    downPayment > 0 ? 'downpayment' : 'total'
  );
  const [customAmount, setCustomAmount] = useState<string>(
    downPayment > 0 ? String(downPayment) : String(grossSubtotal)
  );
  const [paymentMethod, setPaymentMethod] = useState<'Zelle' | 'CashApp' | 'Efectivo' | 'Transferencia' | 'Tarjeta'>('Zelle');
  const [paymentDetails, setPaymentDetails] = useState<string>(order.customer.email || order.customer.phone || '');
  const [beneficiaryName, setBeneficiaryName] = useState<string>(order.customer.name || '');
  const [reason, setReason] = useState<string>('Pieza descontinuada / Sin stock de reemplazo');
  const [customReason, setCustomReason] = useState<string>('');
  const [internalNotes, setInternalNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const calculateEffectiveAmount = (): number => {
    if (amountType === 'downpayment') return downPayment;
    if (amountType === 'total') return grossSubtotal;
    const parsed = parseFloat(customAmount);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const effectiveAmount = calculateEffectiveAmount();

  const handleSelectPresetReason = (preset: string) => {
    setReason(preset);
    if (preset !== 'Otro motivo...') {
      setCustomReason('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const finalAmount = calculateEffectiveAmount();
    if (finalAmount <= 0) {
      setError('El monto a reembolsar debe ser mayor a $0.00 USD');
      return;
    }

    const finalReason = reason === 'Otro motivo...' ? customReason.trim() : reason.trim();
    if (!finalReason || finalReason.length < 3) {
      setError('Por favor especifica un motivo válido para la solicitud de reembolso.');
      return;
    }

    setIsSubmitting(true);

    try {
      // Numerical order ID fallback
      const numericOrderId = parseInt(String(order.id).replace(/\D/g, ''), 10) || 1;

      const fullDetails = [
        beneficiaryName ? `Titular: ${beneficiaryName.trim()}` : '',
        paymentDetails ? `Cuenta/Destino: ${paymentDetails.trim()}` : '',
        internalNotes ? `Notas: ${internalNotes.trim()}` : '',
      ]
        .filter(Boolean)
        .join(' | ');

      const response = await apiFetch('/refunds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: numericOrderId,
          amount: finalAmount,
          amountType,
          paymentMethod,
          paymentDetails: fullDetails || null,
          reason: finalReason,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.message || 'Error al registrar la solicitud de reembolso');
      }

      const createdRefund = await response.json();

      // Update Order Status locally and through handler
      if (onUpdateOrder) {
        const auditLog = `[${new Date().toLocaleDateString('es-MX')}] Solicitud de reembolso ${createdRefund.id || ''} por $${finalAmount.toFixed(2)} USD vía ${paymentMethod}. Motivo: ${finalReason}`;
        onUpdateOrder({
          ...order,
          status: 'solicitud_reembolso' as OrderStatus,
          notes: order.notes ? `${order.notes}\n${auditLog}` : auditLog,
        });
      }

      if (onSuccess) {
        onSuccess(
          `💼 Solicitud de Reembolso ${createdRefund.id || ''} registrada exitosamente por $${finalAmount.toFixed(2)} USD vía ${paymentMethod}.`
        );
      }
    } catch (err: any) {
      setError(err.message || 'Error inesperado al conectar con el servidor');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="radar-view text-[#dfe2ef] pb-10 space-y-6 animate-fade-in">
      {/* Top Breadcrumb & Navigation Bar */}
      <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-amber-500/30 p-5 md:p-6 shadow-[0_10px_30px_rgba(245,158,11,0.15)] overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-[2.5px] bg-gradient-to-r from-amber-500 via-orange-400 to-amber-300 shadow-[0_0_15px_#f59e0b]" />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <button
              type="button"
              onClick={onBack}
              className="mt-1 rounded-xl p-2.5 bg-[#040814] border border-amber-500/30 text-amber-400 hover:text-white hover:bg-amber-500/20 transition-all shadow-[0_0_12px_rgba(245,158,11,0.2)] cursor-pointer active:scale-95"
              title="Volver al detalle de la orden"
            >
              <span className="material-symbols-outlined text-[22px]">arrow_back</span>
            </button>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">
                  Solicitud de Reembolso y Devolución
                </h1>
                <span className="rounded-lg border border-amber-500/40 bg-amber-950/50 px-2.5 py-0.5 font-mono text-xs font-bold text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.3)]">
                  #{order.code}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold font-mono border border-amber-500/40 bg-amber-500/10 text-amber-300 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  <span>Trámite Financiero</span>
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400 flex flex-wrap items-center gap-2">
                <span>Cliente: <strong className="text-amber-200 font-semibold">{order.customer.name}</strong></span>
                <span>•</span>
                <span>Tel: <strong className="text-slate-300 font-mono">{order.customer.phone}</strong></span>
                <span>•</span>
                <span>Vehículo: <strong className="text-slate-300">{order.vehicle.year} {order.vehicle.make} {order.vehicle.model}</strong></span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 pl-12 sm:pl-0">
            <button
              type="button"
              onClick={onBack}
              className="cyber-btn-secondary px-4 py-2 text-xs font-bold flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
              <span>Cancelar</span>
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-red-950/80 border border-red-500/50 text-red-200 text-xs flex items-center gap-3 shadow-[0_0_20px_rgba(239,68,68,0.25)] animate-shake">
          <span className="material-symbols-outlined text-[22px] text-red-400 shrink-0">error</span>
          <div className="flex-1">
            <strong className="block text-red-300 font-bold">Atención:</strong>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Main Grid: Form (2 Cols) + Summary & Actions Sidebar (1 Col) */}
      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-6">
          {/* Card 1: Balance Contable de la Orden */}
          <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#22d3ee]" />

            <div className="flex items-center justify-between mb-4">
              <h2 className="flex items-center gap-2 text-sm font-bold text-white uppercase tracking-wider font-mono">
                <span className="material-symbols-outlined text-cyan-400 text-[20px]">account_balance</span>
                <span>Estado de Cuenta de la Orden</span>
              </h2>
              <span className="text-[11px] font-mono text-cyan-300 bg-cyan-950/50 px-2.5 py-1 rounded-lg border border-cyan-500/30">
                Moneda: USD
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
              <div className="p-3.5 rounded-2xl bg-[#040814] border border-cyan-500/15">
                <span className="text-[10px] text-slate-400 block uppercase">Pieza / Refacción</span>
                <strong className="text-sm sm:text-base text-slate-200 font-bold">${partPrice.toFixed(2)}</strong>
                <span className="block text-[9px] text-slate-500 mt-0.5 truncate">{order.mainPart}</span>
              </div>

              <div className="p-3.5 rounded-2xl bg-[#040814] border border-cyan-500/15">
                <span className="text-[10px] text-slate-400 block uppercase">Total Cargos</span>
                <strong className="text-sm sm:text-base text-white font-bold">${grossSubtotal.toFixed(2)}</strong>
                <span className="block text-[9px] text-slate-500 mt-0.5">Envío: ${deliveryFee.toFixed(2)} · Casco: ${coreFee.toFixed(2)}</span>
              </div>

              <div className="p-3.5 rounded-2xl bg-emerald-950/30 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.15)]">
                <span className="text-[10px] text-emerald-400 block uppercase font-bold">Total Abonado</span>
                <strong className="text-sm sm:text-base text-emerald-300 font-bold">${downPayment.toFixed(2)}</strong>
                <span className="block text-[9px] text-emerald-500 mt-0.5">Anticipo registrado</span>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-700/50">
                <span className="text-[10px] text-slate-400 block uppercase">Saldo Pendiente</span>
                <strong className="text-sm sm:text-base text-slate-300 font-bold">${totalPayable.toFixed(2)}</strong>
                <span className="block text-[9px] text-slate-500 mt-0.5">Por liquidar</span>
              </div>
            </div>
          </div>

          {/* Card 2: Configuración del Monto a Reembolsar */}
          <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-amber-500/25 p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_8px_#f59e0b]" />

            <h2 className="flex items-center gap-2 text-sm font-bold text-white uppercase tracking-wider font-mono mb-4">
              <span className="material-symbols-outlined text-amber-400 text-[20px]">attach_money</span>
              <span>1. Definir Monto a Reembolsar</span>
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Option 1: Solo Abono */}
              <button
                type="button"
                onClick={() => {
                  setAmountType('downpayment');
                  setCustomAmount(String(downPayment));
                }}
                className={`p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  amountType === 'downpayment'
                    ? 'bg-amber-500/15 border-amber-400 text-white shadow-[0_0_15px_rgba(245,158,11,0.25)] ring-1 ring-amber-400/50'
                    : 'bg-[#040814] border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-mono font-bold uppercase text-amber-300">Solo Anticipo</span>
                    <span className="material-symbols-outlined text-[18px] text-amber-400">
                      {amountType === 'downpayment' ? 'radio_button_checked' : 'radio_button_unchecked'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">Reembolsar únicamente el abono pagado por el cliente</p>
                </div>
                <div className="mt-3 pt-2 border-t border-slate-800/80">
                  <span className="text-base sm:text-lg font-mono font-black text-amber-300">${downPayment.toFixed(2)}</span>
                </div>
              </button>

              {/* Option 2: Total Completo */}
              <button
                type="button"
                onClick={() => {
                  setAmountType('total');
                  setCustomAmount(String(grossSubtotal));
                }}
                className={`p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  amountType === 'total'
                    ? 'bg-amber-500/15 border-amber-400 text-white shadow-[0_0_15px_rgba(245,158,11,0.25)] ring-1 ring-amber-400/50'
                    : 'bg-[#040814] border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-mono font-bold uppercase text-amber-300">Total de la Orden</span>
                    <span className="material-symbols-outlined text-[18px] text-amber-400">
                      {amountType === 'total' ? 'radio_button_checked' : 'radio_button_unchecked'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">Reembolsar el valor comercial completo de la transacción</p>
                </div>
                <div className="mt-3 pt-2 border-t border-slate-800/80">
                  <span className="text-base sm:text-lg font-mono font-black text-amber-300">${grossSubtotal.toFixed(2)}</span>
                </div>
              </button>

              {/* Option 3: Monto Personalizado */}
              <button
                type="button"
                onClick={() => setAmountType('custom')}
                className={`p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  amountType === 'custom'
                    ? 'bg-amber-500/15 border-amber-400 text-white shadow-[0_0_15px_rgba(245,158,11,0.25)] ring-1 ring-amber-400/50'
                    : 'bg-[#040814] border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-mono font-bold uppercase text-amber-300">Personalizado</span>
                    <span className="material-symbols-outlined text-[18px] text-amber-400">
                      {amountType === 'custom' ? 'radio_button_checked' : 'radio_button_unchecked'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">Ingresar una cifra parcial o específica acordada</p>
                </div>
                <div className="mt-3 pt-2 border-t border-slate-800/80">
                  <span className="text-base sm:text-lg font-mono font-black text-amber-300">
                    ${effectiveAmount.toFixed(2)}
                  </span>
                </div>
              </button>
            </div>

            {/* Dynamic Custom Amount Input */}
            {amountType === 'custom' && (
              <div className="mt-4 p-4 rounded-2xl bg-[#040814] border border-amber-500/30 space-y-2 animate-fade-in">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-amber-300 uppercase font-mono">
                    Ingresar Monto Exacto en USD *
                  </label>
                  <span className="text-[11px] text-slate-400 font-mono">
                    Máximo sugerido: ${grossSubtotal.toFixed(2)}
                  </span>
                </div>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-bold text-amber-400 font-mono">
                    $
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    max={grossSubtotal * 2}
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    placeholder="0.00"
                    className="cyber-input w-full pl-9 pr-4 py-2.5 text-sm sm:text-base font-mono font-black text-white focus:border-amber-400 focus:ring-amber-400/30"
                    required
                  />
                </div>
              </div>
            )}
          </div>

          {/* Card 3: Método de Devolución & Cuenta Destino */}
          <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#22d3ee]" />

            <h2 className="flex items-center gap-2 text-sm font-bold text-white uppercase tracking-wider font-mono mb-4">
              <span className="material-symbols-outlined text-cyan-400 text-[20px]">payments</span>
              <span>2. Canal y Datos de Destino del Pago</span>
            </h2>

            <div className="space-y-4">
              {/* Payment Method Selector */}
              <div>
                <label className="text-xs font-bold text-slate-300 uppercase font-mono tracking-wider block mb-2">
                  Método de Reembolso *
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {(['Zelle', 'CashApp', 'Transferencia', 'Efectivo', 'Tarjeta'] as const).map((method) => {
                    const isSelected = paymentMethod === method;
                    const iconMap = {
                      Zelle: 'bolt',
                      CashApp: 'attach_money',
                      Transferencia: 'account_balance',
                      Efectivo: 'local_atm',
                      Tarjeta: 'credit_card',
                    };
                    return (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setPaymentMethod(method)}
                        className={`p-3 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-1.5 ${
                          isSelected
                            ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-bold shadow-[0_0_12px_rgba(6,182,212,0.3)]'
                            : 'bg-[#040814] border-slate-800 text-slate-400 hover:border-slate-700 hover:text-white'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[20px]">{iconMap[method]}</span>
                        <span className="text-xs font-mono font-bold">{method}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Destination Details Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-300 uppercase font-mono tracking-wider block mb-1.5">
                    Nombre del Titular / Beneficiario *
                  </label>
                  <input
                    type="text"
                    value={beneficiaryName}
                    onChange={(e) => setBeneficiaryName(e.target.value)}
                    placeholder="Ej. Juan Pérez"
                    className="cyber-input w-full text-xs font-medium"
                    required
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-300 uppercase font-mono tracking-wider block mb-1.5">
                    {paymentMethod === 'Zelle'
                      ? 'Correo o Teléfono Zelle *'
                      : paymentMethod === 'CashApp'
                      ? '$Cashtag de CashApp *'
                      : paymentMethod === 'Transferencia'
                      ? 'Banco y Número de Cuenta *'
                      : paymentMethod === 'Tarjeta'
                      ? 'Últimos 4 dígitos / Pasarela *'
                      : 'Referencia / Entrega en caja *'}
                  </label>
                  <input
                    type="text"
                    value={paymentDetails}
                    onChange={(e) => setPaymentDetails(e.target.value)}
                    placeholder={
                      paymentMethod === 'Zelle'
                        ? 'correo@ejemplo.com o +1 (555) 000-0000'
                        : paymentMethod === 'CashApp'
                        ? '$UsuarioCashApp'
                        : paymentMethod === 'Transferencia'
                        ? 'Banco Chase - Acct: 123456789'
                        : paymentMethod === 'Tarjeta'
                        ? 'Reversión Tarjeta terminada en 4242'
                        : 'Entregar efectivo en mostrador a cliente'
                    }
                    className="cyber-input w-full text-xs font-mono"
                    required
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Card 4: Motivo & Justificación */}
          <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#22d3ee]" />

            <h2 className="flex items-center gap-2 text-sm font-bold text-white uppercase tracking-wider font-mono mb-4">
              <span className="material-symbols-outlined text-cyan-400 text-[20px]">assignment_late</span>
              <span>3. Causa y Justificación de la Devolución</span>
            </h2>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-300 uppercase font-mono tracking-wider block mb-2">
                  Motivo Principal *
                </label>
                <div className="flex flex-wrap gap-2">
                  {[
                    'Pieza descontinuada / Sin stock de reemplazo',
                    'Cancelación solicitada por el cliente',
                    'Retraso excesivo en logística / despacho',
                    'Incompatibilidad técnica / Refacción errónea',
                    'Falla de garantía sin repuesto sustituto',
                    'Otro motivo...',
                  ].map((preset) => {
                    const isSelected = reason === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => handleSelectPresetReason(preset)}
                        className={`px-3 py-2 rounded-xl text-xs font-medium border transition-all cursor-pointer flex items-center gap-1.5 ${
                          isSelected
                            ? 'bg-amber-500/20 border-amber-400 text-amber-200 font-bold shadow-[0_0_10px_rgba(245,158,11,0.25)]'
                            : 'bg-[#040814] border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {isSelected ? 'check_circle' : 'circle'}
                        </span>
                        <span>{preset}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {reason === 'Otro motivo...' && (
                <div className="space-y-1.5 animate-fade-in">
                  <label className="text-xs font-bold text-amber-300 uppercase font-mono">
                    Describe el motivo específico *
                  </label>
                  <textarea
                    rows={2}
                    value={customReason}
                    onChange={(e) => setCustomReason(e.target.value)}
                    placeholder="Explica detalladamente la causa de la cancelación o reembolso..."
                    className="cyber-input w-full resize-none text-xs"
                    required
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 uppercase font-mono flex items-center justify-between">
                  <span>Notas Adicionales / Bitácora de Acuerdo (Opcional)</span>
                  <span className="text-[10px] text-slate-500 font-normal">Visible en la auditoría de la orden</span>
                </label>
                <textarea
                  rows={2}
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  placeholder="Detalles sobre el acuerdo telefónico, número de caso, autorización gerencial, etc..."
                  className="cyber-input w-full resize-none text-xs"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right Sidebar: Summary, Impact, and Final Actions */}
        <div className="space-y-6">
          {/* Summary Audit Card */}
          <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-amber-500/30 p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-[2.5px] bg-gradient-to-r from-amber-500 via-orange-400 to-amber-300 shadow-[0_0_15px_#f59e0b]" />

            <h3 className="text-xs font-bold uppercase font-mono tracking-wider text-amber-400 flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-[18px]">fact_check</span>
              <span>Resumen de la Transacción</span>
            </h3>

            <div className="space-y-3 text-xs divide-y divide-slate-800/80">
              <div className="flex justify-between items-center pb-2">
                <span className="text-slate-400">Orden:</span>
                <span className="font-mono font-bold text-cyan-300">#{order.code}</span>
              </div>

              <div className="flex justify-between items-center py-2">
                <span className="text-slate-400">Cliente:</span>
                <span className="font-semibold text-white">{order.customer.name}</span>
              </div>

              <div className="flex justify-between items-center py-2">
                <span className="text-slate-400">Vehículo:</span>
                <span className="text-slate-300 font-mono text-[11px]">{order.vehicle.year} {order.vehicle.make} {order.vehicle.model}</span>
              </div>

              <div className="flex justify-between items-center py-2">
                <span className="text-slate-400">Refacción:</span>
                <span className="text-slate-300 text-[11px] max-w-[150px] truncate text-right">{order.mainPart}</span>
              </div>

              <div className="flex justify-between items-center py-2">
                <span className="text-slate-400">Método de Reembolso:</span>
                <span className="font-mono font-bold text-cyan-400">{paymentMethod}</span>
              </div>

              <div className="flex justify-between items-center py-2">
                <span className="text-slate-400">Destino / Cuenta:</span>
                <span className="font-mono text-slate-200 text-[11px] max-w-[150px] truncate text-right">
                  {paymentDetails || 'Sin especificar'}
                </span>
              </div>

              <div className="pt-3 flex justify-between items-baseline">
                <span className="text-xs font-bold text-amber-300 uppercase font-mono">Monto a Reembolsar:</span>
                <div className="text-right">
                  <span className="text-2xl font-black font-mono text-amber-400">
                    ${effectiveAmount.toFixed(2)}
                  </span>
                  <span className="block text-[10px] text-slate-400 font-mono">USD</span>
                </div>
              </div>
            </div>

            {/* Impact Notification */}
            <div className="mt-5 p-3.5 rounded-2xl bg-amber-950/40 border border-amber-500/30 text-[11px] text-amber-200/90 leading-relaxed space-y-1.5">
              <div className="flex items-center gap-1.5 font-bold text-amber-300">
                <span className="material-symbols-outlined text-[16px]">info</span>
                <span>Efecto en el Sistema:</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-slate-300 pl-1">
                <li>La orden cambiará su estatus a <strong>Solicitud Reembolso</strong>.</li>
                <li>Se registrará un ticket oficial en el módulo de reembolsos.</li>
                <li>Se creará una entrada de auditoría con fecha y usuario responsable.</li>
              </ul>
            </div>

            {/* Action Buttons */}
            <div className="mt-6 space-y-2.5">
              <button
                type="submit"
                disabled={isSubmitting || effectiveAmount <= 0}
                className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs sm:text-sm uppercase tracking-wider font-mono shadow-[0_0_25px_rgba(245,158,11,0.45)] cursor-pointer active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                    <span>Procesando Solicitud...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[20px]">verified</span>
                    <span>Confirmar Solicitud (${effectiveAmount.toFixed(2)})</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={onBack}
                disabled={isSubmitting}
                className="w-full py-2.5 px-4 rounded-2xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700/60 text-slate-300 font-bold text-xs uppercase font-mono transition-colors cursor-pointer text-center"
              >
                Cancelar y Volver
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};
