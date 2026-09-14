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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#0b1329] border border-[#1e293b] rounded-2xl w-full max-w-md p-6 shadow-2xl flex flex-col gap-5 text-[#dfe2ef]">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#1e293b] pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#ef4444]/15 border border-[#ef4444]/30 text-[#f87171] flex items-center justify-center">
              <span className="material-symbols-outlined text-[22px]">security</span>
            </div>
            <div>
              <h3 className="font-bold text-lg text-[#f1f5f9]">{actionTitle}</h3>
              <p className="text-xs text-[#94a3b8]">Orden #{orderCode}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#94a3b8] hover:text-[#f1f5f9] p-1 rounded-lg hover:bg-[#1e293b] transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Description */}
        <div className="bg-[#080e1e] border border-[#1e293b] rounded-xl p-3.5 text-xs text-[#cbd5e1] leading-relaxed">
          <p className="font-medium text-[#f1f5f9] mb-1">Acción protegida por seguridad RADAR:</p>
          <p>{actionDescription}</p>
        </div>

        {/* Super Admin Bypass Toggle */}
        <div className="flex items-center justify-between bg-[#1e293b]/40 border border-[#1e293b] p-3 rounded-xl">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-[#388bfd]">shield_person</span>
            <div>
              <span className="text-xs font-bold text-[#f1f5f9] block">Bypass Super Admin</span>
              <span className="text-[11px] text-[#94a3b8]">Autorización directa sin código OTP</span>
            </div>
          </div>
          <input
            type="checkbox"
            checked={isSuperAdminBypass}
            onChange={(e) => {
              setIsSuperAdminBypass(e.target.checked);
              setError('');
            }}
            className="w-4 h-4 rounded text-[#388bfd] accent-[#388bfd] cursor-pointer"
          />
        </div>

        {/* OTP Entry Section (if not Super Admin) */}
        {!isSuperAdminBypass && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#94a3b8] font-semibold">
                Destinatario Wasender:
              </span>
              <span className="font-mono text-xs font-bold text-[#34d399] bg-[#10b981]/10 px-2 py-0.5 rounded border border-[#10b981]/25">
                {destinationPhone}
              </span>
            </div>

            {!otpSent ? (
              <button
                type="button"
                onClick={handleSendOtp}
                className="w-full py-2.5 rounded-xl bg-[#388bfd] hover:bg-[#2563eb] text-[#0a1120] font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-[0_0_12px_rgba(56,139,253,0.35)]"
              >
                <span className="material-symbols-outlined text-[16px]">send</span>
                <span>Enviar Código OTP por Wasender</span>
              </button>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="bg-[#10b981]/10 border border-[#10b981]/30 p-3 rounded-xl flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-[#34d399]">
                    <span className="material-symbols-outlined text-[16px]">mark_email_read</span>
                    <span>Código simulado: <strong className="font-mono text-sm tracking-wider">{generatedOtp}</strong></span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOtpCode(generatedOtp)}
                    className="text-[11px] text-[#58a6ff] hover:underline font-bold cursor-pointer"
                  >
                    Autocompletar
                  </button>
                </div>

                <div>
                  <label className="text-xs font-bold text-[#94a3b8] uppercase tracking-wider block mb-1.5">
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
                    className="w-full bg-[#080e1e] border border-[#1e293b] rounded-xl py-3 text-center font-mono text-xl font-bold tracking-[0.3em] text-[#58a6ff] focus:outline-none focus:border-[#388bfd] focus:ring-1 focus:ring-[#388bfd]"
                  />
                </div>
              </div>
            )}

            {error && (
              <p className="text-xs text-[#f87171] font-medium flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px]">error</span>
                <span>{error}</span>
              </p>
            )}
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#1e293b]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#1e293b] hover:bg-[#334155] text-xs font-bold text-[#cbd5e1] transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleVerify}
            disabled={!isSuperAdminBypass && (!otpSent || otpCode.length < 6) || isSubmitting}
            className="px-5 py-2 rounded-xl bg-[#10b981] hover:bg-[#059669] disabled:bg-[#1e293b] disabled:text-[#64748b] text-[#0a1120] font-black text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-lg disabled:cursor-not-allowed"
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
