import React, { useState } from 'react';
import { Order } from '../types';
import { ordersApi } from '../services/ordersApi';

interface DeliveryDateOtpModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order;
  onSuccess: (newDeliveredAt: string) => void;
}

export const DeliveryDateOtpModal: React.FC<DeliveryDateOtpModalProps> = ({
  isOpen,
  onClose,
  order,
  onSuccess,
}) => {
  const initialDate = order.deliveredAt
    ? new Date(order.deliveredAt).toISOString().slice(0, 16)
    : new Date().toISOString().slice(0, 16);

  const [newDate, setNewDate] = useState<string>(initialDate);
  const [reason, setReason] = useState<string>('Corrección autorizada de fecha de entrega');
  const [otpCode, setOtpCode] = useState<string>('');
  const [isRequestingOtp, setIsRequestingOtp] = useState<boolean>(false);
  const [otpRequested, setOtpRequested] = useState<boolean>(false);
  const [otpDispatchInfo, setOtpDispatchInfo] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const isDelivered = order.status === 'entregado';

  const handleRequestOtp = async () => {
    try {
      setIsRequestingOtp(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      const res = await ordersApi.requestDeliveryDateOtp(order.id);
      setOtpRequested(true);
      if (res.targetPhoneMasked) {
        setOtpDispatchInfo(`Código transmitido vía WhatsApp al Super Admin (${res.targetPhoneMasked})`);
      } else {
        setOtpDispatchInfo('Código transmitido vía WhatsApp al Super Admin');
      }
      setSuccessMessage('Código PIN de 6 dígitos enviado por WhatsApp. Válido por 5 minutos.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al solicitar código WhatsApp';
      setErrorMessage(msg);
    } finally {
      setIsRequestingOtp(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDate) {
      setErrorMessage('Debes seleccionar una fecha y hora válida');
      return;
    }
    if (!otpCode.trim() || otpCode.trim().length !== 6) {
      setErrorMessage('Debes ingresar el código PIN de 6 dígitos recibido por WhatsApp');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      const isoDate = new Date(newDate).toISOString();
      const res = await ordersApi.updateDeliveryDate(order.id, {
        deliveredAt: isoDate,
        otpCode: otpCode.trim(),
        reason: reason.trim(),
      });

      setSuccessMessage('¡Fecha de entrega actualizada correctamente!');
      setTimeout(() => {
        onSuccess(res.deliveredAt || isoDate);
        onClose();
      }, 700);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al validar código o actualizar fecha';
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-xl animate-fade-in">
      <div className="bg-[#070c18]/95 backdrop-blur-2xl border border-amber-500/40 rounded-3xl w-full max-w-lg max-h-[min(94vh,680px)] overflow-y-auto custom-scrollbar p-5 sm:p-6 shadow-[0_20px_60px_rgba(245,158,11,0.2)] flex flex-col gap-4 sm:gap-5 text-slate-200 relative">
        {/* Laser Hairline */}
        <div className="cyber-laser-bar absolute top-0 left-0 right-0 z-20 !bg-gradient-to-r !from-amber-500 !via-cyan-400 !to-emerald-400" />

        {/* Header */}
        <div className="flex items-start justify-between border-b border-amber-500/20 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shadow-[0_0_12px_rgba(245,158,11,0.25)] shrink-0">
              <span className="material-symbols-outlined text-[22px]">verified</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base sm:text-lg text-slate-100">Modificar Fecha de Entrega</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold uppercase tracking-wider">
                  2FA WhatsApp
                </span>
              </div>
              <p className="text-xs text-cyan-400 font-mono font-bold mt-0.5">
                Orden #{order.code} • {order.customer?.name || 'Cliente'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Security / Role Notice */}
        <div className="bg-[#050914]/90 border border-amber-500/20 rounded-xl p-3.5 text-xs text-slate-300 leading-relaxed shadow-inner space-y-1.5">
          <div className="flex items-center gap-1.5 text-amber-400 font-mono text-[11px] font-bold uppercase tracking-wider">
            <span className="material-symbols-outlined text-[15px]">lock</span>
            <span>Protocolo Exclusivo Super Administrador</span>
          </div>
          <p className="text-[11px] text-slate-400">
            La modificación de la fecha de entrega física altera los días de garantía activos y los registros de auditoría fiscal. Solo se permite en órdenes con estatus <strong className="text-emerald-400">Entregado</strong> y requiere código de autorización OTP enviado por WhatsApp.
          </p>
        </div>

        {!isDelivered ? (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono">
            ⚠️ Esta orden tiene estatus actual <strong>{order.status}</strong>. Solo las órdenes en estatus <strong>Entregado</strong> pueden modificar su fecha de entrega física.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Current vs New Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-[var(--bg-card-subtle)] border border-cyan-500/15">
                <span className="text-[10px] font-mono uppercase text-slate-400 block mb-1">
                  Fecha Actual Registrada
                </span>
                <span className="text-xs font-mono text-cyan-300 font-bold block">
                  {order.deliveredAt ? new Date(order.deliveredAt).toLocaleString('es-ES') : 'No establecida'}
                </span>
              </div>

              <div>
                <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1 font-bold">
                  Nueva Fecha y Hora de Entrega *
                </label>
                <input
                  type="datetime-local"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="cyber-input w-full text-xs font-mono text-white"
                  required
                />
              </div>
            </div>

            {/* Motivo */}
            <div>
              <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1 font-bold">
                Motivo del Cambio (Auditoría)
              </label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej. Corrección por reporte de cliente / ajuste de garantía"
                className="cyber-input w-full text-xs font-mono"
              />
            </div>

            {/* WhatsApp 2FA Dispatch Section */}
            <div className="p-4 rounded-xl bg-[#080f1e] border border-cyan-500/25 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <span className="text-xs font-bold text-slate-100 flex items-center gap-1.5 font-mono">
                    <span className="material-symbols-outlined text-emerald-400 text-[18px]">chat</span>
                    <span>Autorización 2FA por WhatsApp</span>
                  </span>
                  <span className="text-[11px] text-slate-400 block mt-0.5">
                    Envía un PIN de 6 dígitos al teléfono del Super Admin
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleRequestOtp}
                  disabled={isRequestingOtp}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-mono font-bold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isRequestingOtp ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                      <span>Enviando...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[16px]">send</span>
                      <span>{otpRequested ? 'Reenviar Código' : 'Solicitar PIN WhatsApp'}</span>
                    </>
                  )}
                </button>
              </div>

              {otpDispatchInfo && (
                <div className="text-[11px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 p-2 rounded-lg flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px]">check_circle</span>
                  <span>{otpDispatchInfo}</span>
                </div>
              )}

              {/* OTP Input Field */}
              <div>
                <label className="text-[10px] font-mono uppercase text-slate-300 block mb-1 font-bold">
                  Código PIN de 6 dígitos (WhatsApp) *
                </label>
                <input
                  type="text"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="Ej. 849201"
                  className="cyber-input w-full text-center text-lg tracking-[0.4em] font-mono font-bold text-amber-300 bg-[#050914]"
                  autoComplete="one-time-code"
                />
              </div>
            </div>

            {/* Error / Success Messages */}
            {errorMessage && (
              <div className="p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-mono flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px]">error</span>
                <span>{errorMessage}</span>
              </div>
            )}

            {successMessage && (
              <div className="p-2.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-mono flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                <span>{successMessage}</span>
              </div>
            )}

            {/* Footer Actions */}
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-cyan-500/15">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl text-xs font-mono text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Cancelar
              </button>

              <button
                type="submit"
                disabled={isSubmitting || !otpCode || otpCode.length !== 6}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-emerald-500 text-slate-950 font-mono font-bold text-xs flex items-center gap-2 hover:opacity-95 transition-all shadow-[0_0_20px_rgba(245,158,11,0.35)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                    <span>Verificando 2FA...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[16px]">check</span>
                    <span>Verificar y Actualizar Fecha</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
