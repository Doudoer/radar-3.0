import React, { useState, useEffect } from 'react';
import { Order, OrderStatus } from '../types';
import { ordersApi } from '../services/ordersApi';

interface CancelOrderModalProps {
  order: Order;
  isOpen: boolean;
  isSuperAdmin: boolean;
  onClose: () => void;
  onOrderCancelled?: (updatedOrder: Order) => void;
  onToast?: (message: string) => void;
}

export const CancelOrderModal: React.FC<CancelOrderModalProps> = ({
  order,
  isOpen,
  isSuperAdmin,
  onClose,
  onOrderCancelled,
  onToast,
}) => {
  const [reason, setReason] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'square' | 'zelle' | 'cashapp' | 'cash'>('square');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [targetPhoneMasked, setTargetPhoneMasked] = useState('');
  const [netPaidToRefund, setNetPaidToRefund] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Auto-detect payment method or downpayment
  const downPayment = Number(order.financials?.downPayment ?? order.financials?.advancePayment ?? 0);

  useEffect(() => {
    if (!isOpen) {
      setReason('');
      setCode('');
      setLoading(false);
      setOtpSent(false);
      setCooldown(0);
      setTargetPhoneMasked('');
      setNetPaidToRefund(null);
      setError('');
      setSuccessMsg('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (!isOpen || !isSuperAdmin) return null;

  const handleRequestOtp = async () => {
    if (reason.trim().length < 5) {
      setError('Por favor ingresa un motivo detallado (mínimo 5 caracteres).');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await ordersApi.requestCancelOrderOtp(order.id, {
        reason: reason.trim(),
        paymentMethod,
      });
      setOtpSent(true);
      setCooldown(res.cooldownSeconds || 30);
      if (res.targetPhoneMasked) setTargetPhoneMasked(res.targetPhoneMasked);
      if (res.netPaidToRefund !== undefined) setNetPaidToRefund(res.netPaidToRefund);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible enviar el código de seguridad.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) {
      setError('El código de seguridad debe tener exactamente 6 dígitos numéricos.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await ordersApi.cancelOrderAdmin(order.id, {
        code: code.trim(),
        reason: reason.trim(),
        paymentMethod,
        version: order.version,
      });
      setSuccessMsg(res.message || 'Orden cancelada exitosamente.');
      setTimeout(async () => {
        onClose();
        if (onOrderCancelled) {
          onOrderCancelled({
            ...order,
            status: 'cancelado' as OrderStatus,
            scheduledPickupAt: undefined,
            version: (order.version || 1) + 1,
          });
        }
        window.dispatchEvent(new Event('radar:data-changed'));
        if (onToast) {
          onToast('Orden cancelada por administrador y devolución procesada.');
        }
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al verificar el código o cancelar la orden.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="horizon-modal fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="cyber-card w-full max-w-lg p-6 border-red-500/60 shadow-[0_0_50px_rgba(239,68,68,0.35)] space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-red-500/20 pb-3">
          <div className="flex items-center gap-2 text-red-400 font-mono font-bold text-sm">
            <span className="material-symbols-outlined text-[22px]">block</span>
            <span>Cancelar Orden Administrativamente · #{order.code}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {successMsg ? (
          <div className="p-4 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono text-xs text-center flex items-center justify-center gap-2">
            <span className="material-symbols-outlined text-[20px]">check_circle</span>
            <span>{successMsg}</span>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Warning and explanation banner */}
            <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-500/30 text-xs font-mono space-y-2 text-red-200">
              <p className="font-bold flex items-center gap-1.5 text-red-300">
                <span className="material-symbols-outlined text-[18px]">verified_user</span>
                Regla especial de cancelación · Exclusivo Super Administrador
              </p>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Al cancelar esta orden se procesará automáticamente la <strong>devolución total de los fondos</strong> cobrados (anticipo/downpayment) asumiendo el reembolso inmediato al mismo método con el que pagó el cliente.
              </p>
              <ul className="text-[11px] text-slate-300 space-y-1 list-disc list-inside">
                <li>Liberación inmediata de la pieza de inventario a estado <strong>Disponible</strong>.</li>
                <li>Registro automático de la devolución en el balance financiero.</li>
                <li>Marcado permanente en el historial y bitácora de auditoría con código OTP.</li>
              </ul>
            </div>

            {/* Financial summary card */}
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono flex items-center justify-between">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Cliente</span>
                <span className="text-white font-medium">{order.customer?.name || 'Cliente'}</span>
              </div>
              <div className="text-right">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Anticipo cobrado</span>
                <span className="text-amber-400 font-bold text-sm">
                  ${(netPaidToRefund !== null ? netPaidToRefund : downPayment).toFixed(2)} USD
                </span>
              </div>
            </div>

            {/* Origin Payment Method Selection */}
            <div>
              <label className="text-xs font-mono font-bold text-[var(--text-secondary)] uppercase block mb-1.5">
                Método de pago del cliente (se asume devuelto a la misma vía):
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: 'square', label: 'Tarjeta (Square)', icon: 'credit_card' },
                  { id: 'zelle', label: 'Zelle', icon: 'account_balance' },
                  { id: 'cashapp', label: 'Cash App', icon: 'payments' },
                  { id: 'cash', label: 'Efectivo', icon: 'attach_money' },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={loading || otpSent}
                    onClick={() => setPaymentMethod(m.id as any)}
                    className={`p-2.5 rounded-xl border text-left flex flex-col gap-1 transition-all ${
                      paymentMethod === m.id
                        ? 'border-red-500 bg-red-500/15 text-red-300 font-bold shadow-[0_0_12px_rgba(239,68,68,0.2)]'
                        : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-white'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">{m.icon}</span>
                    <span className="text-[11px] font-mono leading-tight">{m.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <p role="alert" className="p-2.5 rounded-lg bg-red-950/50 border border-red-500/50 text-red-300 text-xs font-mono">
                {error}
              </p>
            )}

            {/* Reason */}
            <div>
              <label className="text-xs font-mono font-bold text-[var(--text-secondary)] uppercase block mb-1.5">
                Motivo de la cancelación (obligatorio):
              </label>
              <textarea
                required
                rows={2}
                placeholder="Explica detalladamente por qué se cancela la orden..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={loading || otpSent}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs font-mono text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
              />
            </div>

            {!otpSent ? (
              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  disabled={loading}
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl border border-slate-700 text-xs font-mono text-slate-400 hover:text-white cursor-pointer"
                >
                  Regresar
                </button>
                <button
                  type="button"
                  disabled={loading || reason.trim().length < 5}
                  onClick={handleRequestOtp}
                  className="px-4 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 text-xs font-mono font-bold flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_15px_rgba(239,68,68,0.2)]"
                >
                  <span className="material-symbols-outlined text-[16px]">sms</span>
                  <span>{loading ? 'Enviando código...' : 'Solicitar código por SMS/WhatsApp'}</span>
                </button>
              </div>
            ) : (
              <form onSubmit={handleConfirmCancel} className="space-y-4 pt-1">
                <div className="p-3.5 rounded-xl bg-slate-950 border border-red-500/40 space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-emerald-400 flex items-center gap-1 font-bold">
                      <span className="material-symbols-outlined text-[16px]">mark_chat_read</span>
                      Código enviado al Super Admin
                      {targetPhoneMasked && <span className="text-slate-400">({targetPhoneMasked})</span>}
                    </span>
                    {cooldown > 0 && (
                      <span className="text-slate-400 text-[11px]">Reenviar en {cooldown}s</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 font-mono">
                    Ingresa el código único de 6 dígitos recibido para autorizar la cancelación y la devolución automática:
                  </p>
                  <input
                    required
                    type="text"
                    maxLength={6}
                    pattern="\d{6}"
                    placeholder="123456"
                    autoFocus
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    className="w-full text-center text-2xl font-mono font-black tracking-widest rounded-xl border border-red-500/50 bg-slate-900 p-2 text-red-300 focus:border-red-400 focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-between gap-2.5 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    disabled={loading || cooldown > 0}
                    onClick={handleRequestOtp}
                    className="text-xs font-mono text-cyan-400 hover:text-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {cooldown > 0 ? `Reenviar código (${cooldown}s)` : 'Reenviar código'}
                  </button>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={onClose}
                      className="px-3 py-1.5 rounded-xl border border-slate-700 text-xs font-mono text-slate-400 hover:text-white cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={loading || code.length !== 6}
                      className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-mono font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-lg shadow-red-950 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="material-symbols-outlined text-[16px]">gavel</span>
                      <span>{loading ? 'Cancelando...' : 'Confirmar Cancelación'}</span>
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

