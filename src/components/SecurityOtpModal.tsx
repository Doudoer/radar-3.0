import React, { useState } from 'react';

interface SecurityOtpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  actionTitle: string;
  actionDescription: string;
  orderCode: string;
  destinationPhone?: string;
}

export const SecurityOtpModal: React.FC<SecurityOtpModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  actionTitle,
  actionDescription,
  orderCode,
  destinationPhone = '+58 412 730 7933',
}) => {
  const [otpCode, setOtpCode] = useState('');
  const [generatedOtp, setGeneratedOtp] = useState('739201');
  const [otpSent, setOtpSent] = useState(false);
  const [isSuperAdminBypass, setIsSuperAdminBypass] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSendOtp = () => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setGeneratedOtp(code);
    setOtpSent(true);
    setError('');
  };

  const handleVerify = () => {
    if (isSuperAdminBypass) {
      setIsSubmitting(true);
      setTimeout(() => {
        setIsSubmitting(false);
        onSuccess();
        onClose();
      }, 500);
      return;
    }

    if (otpCode.trim() !== generatedOtp) {
      setError(`Código inválido. Introduce el código enviado a Wasender.`);
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      onSuccess();
      onClose();
    }, 500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-fade-in">
      <div className="bg-[#070c18]/95 backdrop-blur-2xl border border-cyan-500/30 rounded-3xl w-full max-w-md p-6 shadow-[0_20px_60px_rgba(0,0,0,0.85)] flex flex-col gap-5 text-slate-200 relative overflow-hidden">
        {/* Laser Hairline */}
        <div className="cyber-laser-bar absolute top-0 left-0 right-0 z-20" />

        {/* Header */}
        <div className="flex items-start justify-between border-b border-cyan-500/20 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center shadow-[0_0_12px_rgba(244,63,94,0.25)] shrink-0">
              <span className="material-symbols-outlined text-[22px]">security</span>
            </div>
            <div>
              <h3 className="font-bold text-base sm:text-lg text-slate-100">{actionTitle}</h3>
              <p className="text-xs text-cyan-400 font-mono font-bold mt-0.5">Orden #{orderCode}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Description */}
        <div className="bg-[#050914]/80 border border-cyan-500/20 rounded-xl p-3.5 text-xs text-slate-300 leading-relaxed shadow-inner">
          <p className="font-bold text-slate-100 mb-1 flex items-center gap-1.5 text-cyan-400 font-mono text-[11px] uppercase tracking-wider">
            <span className="material-symbols-outlined text-[14px]">verified_user</span>
            <span>Protocolo de Seguridad RADAR:</span>
          </p>
          <p>{actionDescription}</p>
        </div>

        {/* Super Admin Bypass Toggle */}
        <div className="flex items-center justify-between bg-[#080e1c] border border-cyan-500/20 p-3.5 rounded-xl">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
              <span className="material-symbols-outlined text-[16px]">shield_person</span>
            </div>
            <div>
              <span className="text-xs font-bold text-slate-100 block">Bypass Super Admin</span>
              <span className="text-[11px] text-slate-400">Autorización directa de alto nivel</span>
            </div>
          </div>
          <input
            type="checkbox"
            checked={isSuperAdminBypass}
            onChange={(e) => {
              setIsSuperAdminBypass(e.target.checked);
              setError('');
            }}
            className="w-4 h-4 rounded text-cyan-500 accent-cyan-500 cursor-pointer"
          />
        </div>

        {/* OTP Entry Section (if not Super Admin) */}
        {!isSuperAdminBypass && (
          <div className="flex flex-col gap-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 font-medium">
                Destinatario Wasender:
              </span>
              <span className="font-mono text-xs font-bold text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded-md border border-emerald-500/30">
                {destinationPhone}
              </span>
            </div>

            {!otpSent ? (
              <button
                type="button"
                onClick={handleSendOtp}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-[0_0_15px_rgba(6,182,212,0.35)] active:scale-95"
              >
                <span className="material-symbols-outlined text-[16px]">send</span>
                <span>Enviar Código OTP por Wasender</span>
              </button>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="bg-emerald-950/30 border border-emerald-500/30 p-3 rounded-xl flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-emerald-400">
                    <span className="material-symbols-outlined text-[16px]">mark_email_read</span>
                    <span>Código simulado: <strong className="font-mono text-sm tracking-wider text-emerald-300 font-black">{generatedOtp}</strong></span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOtpCode(generatedOtp)}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 hover:underline font-bold cursor-pointer"
                  >
                    Autocompletar
                  </button>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5 font-mono">
                    Ingresar Código de 6 Dígitos:
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => {
                      setOtpCode(e.target.value.replace(/[^0-9]/g, ''));
                      setError('');
                    }}
                    placeholder="• • • • • •"
                    className="w-full bg-[#050914] border border-cyan-500/30 rounded-xl py-3 text-center font-mono text-xl font-bold tracking-[0.3em] text-cyan-300 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 shadow-inner"
                  />
                </div>
              </div>
            )}

            {error && (
              <p className="text-xs text-rose-400 font-medium flex items-center gap-1.5 bg-rose-950/30 border border-rose-500/30 p-2.5 rounded-xl">
                <span className="material-symbols-outlined text-[16px] text-rose-400">error</span>
                <span>{error}</span>
              </p>
            )}
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-cyan-500/20">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleVerify}
            disabled={!isSuperAdminBypass && (!otpSent || otpCode.length < 6) || isSubmitting}
            className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-600 text-slate-950 font-black text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-[0_0_15px_rgba(16,185,129,0.35)] disabled:cursor-not-allowed disabled:shadow-none active:scale-95"
          >
            {isSubmitting ? (
              <span>Validando...</span>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                <span>{isSuperAdminBypass ? 'Aprobar como Super Admin' : 'Confirmar con OTP'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
