import React, { useState } from 'react';
import { Order, OrderStatus } from '../types';
import { apiFetch } from '../services/apiFetch';

interface RefundModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order;
  onUpdateOrder?: (updatedOrder: Order) => void;
  onSuccessToast?: (msg: string) => void;
}

export const RefundModal: React.FC<RefundModalProps> = ({
  isOpen,
  onClose,
  order,
  onUpdateOrder,
  onSuccessToast,
}) => {
  if (!isOpen) return null;

  const partPrice = order.financials.partPrice ?? order.financials.baseMSRP ?? 0;
  const deliveryFee = order.financials.deliveryFee ?? 0;
  const coreFee = order.financials.coreFee ?? 0;
  const downPayment = order.financials.downPayment ?? order.financials.advancePayment ?? 0;
  const grossSubtotal = partPrice + deliveryFee + coreFee;

  const [amountType, setAmountType] = useState<'downpayment' | 'total' | 'custom'>('downpayment');
  const [customAmount, setCustomAmount] = useState<string>(downPayment > 0 ? String(downPayment) : String(grossSubtotal));
  const [paymentMethod, setPaymentMethod] = useState<'Zelle' | 'CashApp' | 'Efectivo' | 'Transferencia' | 'Tarjeta'>('Zelle');
  const [paymentDetails, setPaymentDetails] = useState<string>(order.customer.email || order.customer.phone || '');
  const [reason, setReason] = useState<string>('Pieza descontinuada / Sin stock de reemplazo');
  const [customReason, setCustomReason] = useState<string>('');
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
      setError('El monto a reembolsar debe ser mayor a $0.00');
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

      const response = await apiFetch('/refunds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: numericOrderId,
          amount: finalAmount,
          amountType,
          paymentMethod,
          paymentDetails: paymentDetails.trim() || null,
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
        onUpdateOrder({
          ...order,
          status: 'solicitud_reembolso' as OrderStatus,
          notes: order.notes
            ? `${order.notes}\n[${new Date().toLocaleDateString('es-MX')}] Solicitud de reembolso ${createdRefund.id || ''} por $${finalAmount.toFixed(2)} (${paymentMethod}). Motivo: ${finalReason}`
            : `Solicitud de reembolso ${createdRefund.id || ''} por $${finalAmount.toFixed(2)} (${paymentMethod}). Motivo: ${finalReason}`,
        });
      }

      if (onSuccessToast) {
        onSuccessToast(
          `💼 Solicitud de Reembolso ${createdRefund.id || ''} registrada por $${finalAmount.toFixed(2)} vía ${paymentMethod}. Orden en 'Solicitud Reembolso'.`
        );
      }

      onClose();
    } catch (err: any) {
      setError(err.message || 'Error inesperado al conectar con el servidor');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-xl animate-fade-in">
      <div className="bg-[#070c18]/95 backdrop-blur-2xl border border-amber-500/30 rounded-3xl w-full max-w-xl shadow-[0_20px_60px_rgba(245,158,11,0.25)] flex flex-col text-slate-100 relative overflow-hidden max-h-[92vh]">
        {/* Amber Glow Hairline */}
        <div className="absolute top-0 inset-x-0 h-[2.5px] bg-gradient-to-r from-amber-500 via-orange-400 to-amber-300 shadow-[0_0_15px_#f59e0b] z-20" />

        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-amber-500/20 bg-[#0a1022]/80 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/15 border border-amber-500/35 flex items-center justify-center text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.3)]">
              <span className="material-symbols-outlined text-[22px]">account_balance_wallet</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-base sm:text-lg text-white tracking-tight">
                  Solicitar Reembolso
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-950/80 text-amber-300 border border-amber-500/30">
                  #{order.code}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                Cliente: <strong className="text-amber-200">{order.customer.name}</strong> • Tel: {order.customer.phone}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800/60 cursor-pointer transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Modal Body / Form */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto custom-scrollbar space-y-4">
          {error && (
            <div className="p-3 rounded-2xl bg-red-950/70 border border-red-500/40 text-red-300 text-xs flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-red-400">error</span>
              <span>{error}</span>
            </div>
          )}

          {/* Quick Financial Overview Card */}
          <div className="grid grid-cols-3 gap-2.5 p-3.5 rounded-2xl bg-[#040814] border border-cyan-500/20 text-center font-mono">
            <div className="p-2 rounded-xl bg-[#070c18] border border-slate-800">
              <span className="text-[10px] text-slate-400 block uppercase">Total Orden</span>
              <strong className="text-xs sm:text-sm text-white font-bold">${grossSubtotal.toFixed(2)}</strong>
            </div>
            <div className="p-2 rounded-xl bg-emerald-950/30 border border-emerald-500/20">
              <span className="text-[10px] text-emerald-400 block uppercase">Abonado</span>
              <strong className="text-xs sm:text-sm text-emerald-300 font-bold">${downPayment.toFixed(2)}</strong>
            </div>
            <div className="p-2 rounded-xl bg-amber-950/30 border border-amber-500/20">
              <span className="text-[10px] text-amber-400 block uppercase">A Reembolsar</span>
              <strong className="text-xs sm:text-sm text-amber-300 font-bold">${effectiveAmount.toFixed(2)}</strong>
            </div>
          </div>

          {/* Amount Type Selection */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-300 uppercase font-mono tracking-wider block">
              1. Seleccionar Monto a Reembolsar
            </label>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <button
                type="button"
                onClick={() => setAmountType('downpayment')}
                className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center gap-1 ${
                  amountType === 'downpayment'
                    ? 'bg-amber-500/20 border-amber-400 text-amber-200 font-bold shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                    : 'bg-[#040814] border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <span className="text-[10px] uppercase font-mono">Solo Abono</span>
                <span className="text-xs sm:text-sm font-black text-white font-mono">${downPayment.toFixed(2)}</span>
              </button>

              <button
                type="button"
                onClick={() => setAmountType('total')}
                className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center gap-1 ${
                  amountType === 'total'
                    ? 'bg-amber-500/20 border-amber-400 text-amber-200 font-bold shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                    : 'bg-[#040814] border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <span className="text-[10px] uppercase font-mono">Total Orden</span>
                <span className="text-xs sm:text-sm font-black text-white font-mono">${grossSubtotal.toFixed(2)}</span>
              </button>

              <button
                type="button"
                onClick={() => setAmountType('custom')}
                className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center gap-1 ${
                  amountType === 'custom'
                    ? 'bg-amber-500/20 border-amber-400 text-amber-200 font-bold shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                    : 'bg-[#040814] border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <span className="text-[10px] uppercase font-mono">Personalizado</span>
                <span className="text-xs sm:text-sm font-black text-white font-mono">Editar $</span>
              </button>
            </div>

            {amountType === 'custom' && (
              <div className="pt-1">
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-amber-400 font-mono font-bold">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={grossSubtotal}
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    placeholder="0.00"
                    className="cyber-input w-full pl-8 pr-4 text-xs font-mono text-white focus:border-amber-400 focus:ring-amber-400/30"
                    required
                  />
                </div>
              </div>
            )}
          </div>

          {/* Payment Method Selector */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-300 uppercase font-mono tracking-wider block">
              2. Método de Reembolso
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 text-xs font-mono">
              {(['Zelle', 'CashApp', 'Efectivo', 'Transferencia', 'Tarjeta'] as const).map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setPaymentMethod(method)}
                  className={`px-2 py-2 rounded-xl border text-center text-xs font-bold transition-all cursor-pointer ${
                    paymentMethod === method
                      ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 border-amber-300 font-black shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                      : 'bg-[#040814] border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                  }`}
                >
                  {method}
                </button>
              ))}
            </div>
          </div>

          {/* Payment Contact / Details */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-300 uppercase font-mono tracking-wider block">
              3. Datos de Destino / Cuenta ({paymentMethod})
            </label>
            <input
              type="text"
              value={paymentDetails}
              onChange={(e) => setPaymentDetails(e.target.value)}
              placeholder={`Ej: ${paymentMethod === 'Zelle' ? 'correo@cliente.com o (555) 000-0000' : 'Detalles de la cuenta o titular'}`}
              className="cyber-input w-full text-xs font-mono text-white focus:border-amber-400 focus:ring-amber-400/30"
            />
          </div>

          {/* Reason Section */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-300 uppercase font-mono tracking-wider block">
              4. Motivo del Reembolso
            </label>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {[
                'Pieza descontinuada / Sin stock de reemplazo',
                'Cancelación solicitada por el cliente',
                'Garantía aprobada con devolución de dinero',
                'Incompatibilidad técnica / Error de catálogo',
                'Otro motivo...',
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleSelectPresetReason(preset)}
                  className={`px-2.5 py-1 rounded-lg border text-left transition-all cursor-pointer ${
                    reason === preset
                      ? 'bg-amber-950/80 border-amber-400 text-amber-200 font-bold'
                      : 'bg-[#040814] border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>

            {reason === 'Otro motivo...' && (
              <textarea
                rows={2}
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Describe detalladamente el motivo del reembolso..."
                className="cyber-input w-full resize-none text-xs focus:border-amber-400 focus:ring-amber-400/30 mt-1"
                required
              />
            )}
          </div>

          {/* Modal Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 border-t border-amber-500/20 pt-4 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="cyber-btn-secondary px-4 py-2 text-xs font-semibold cursor-pointer"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={isSubmitting || effectiveAmount <= 0}
              className="px-4 py-2 rounded-xl text-xs font-black bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-400 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.4)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 active:scale-95 transition-all"
            >
              <span className="material-symbols-outlined text-[16px]">
                {isSubmitting ? 'sync' : 'verified'}
              </span>
              <span>
                {isSubmitting
                  ? 'Registrando...'
                  : `Confirmar Reembolso ($${effectiveAmount.toFixed(2)})`}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
