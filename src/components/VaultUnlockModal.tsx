import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../services/apiFetch';
import { useDialogAccessibility } from '../hooks/useDialogAccessibility';

type Method = 'whatsapp' | 'totp' | 'backup';

export interface VaultUnlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (expiresAt: number) => void;
  title?: string;
  description?: string;
}

export const VaultUnlockModal: React.FC<VaultUnlockModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  title = 'Desbloquear Bóveda de Seguridad (2FA)',
  description = 'Esta sección contiene funciones críticas (respaldos de base de datos, rollbacks y usuarios). Requiere autorización en dos pasos (2FA) para habilitar el acceso durante 15 minutos.',
}) => {
  const [method, setMethod] = useState<Method>('whatsapp');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setCode('');
      setError('');
      setNotice('');
      setBusy(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((val) => Math.max(0, val - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogAccessibility({ open: isOpen, dialogRef, onEscape: onClose });

  if (!isOpen) return null;

  const handleRequestOtp = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await apiFetch('/auth/2fa/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'No se pudo enviar el código por WhatsApp');
      }
      setCooldown(data.cooldownSeconds || 60);
      if (data.devCode) {
        setCode(data.devCode);
        setNotice(`[Modo Local] PIN generado: ${data.devCode} (auto-completado)`);
      } else {
        setNotice(data.message || 'Código de 6 dígitos enviado a tu WhatsApp');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al solicitar código OTP');
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const cleanCode = code.trim();
    const requiredLength = method === 'backup' ? 8 : 6;
    if (cleanCode.length !== requiredLength) {
      setError(`El código debe tener ${requiredLength} dígitos`);
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await apiFetch('/auth/2fa/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: cleanCode, method }),
      });
      const data = await response.json();
      if (!response.ok || !data.verified) {
        throw new Error(data.message || 'Código de verificación incorrecto o expirado');
      }
      onSuccess(data.expiresAt || Date.now() + 15 * 60 * 1000);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al verificar el código');
    } finally {
      setBusy(false);
    }
  };

  const digits = method === 'backup' ? 8 : 6;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="horizon-modal fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in outline-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vault-modal-title"
    >
      <div className="relative w-full max-w-md rounded-3xl bg-[#070c18]/95 backdrop-blur-2xl border border-cyan-500/30 p-6 md:p-8 shadow-[0_20px_60px_rgba(0,0,0,0.8)] overflow-hidden space-y-5 text-center text-slate-200">
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#22d3ee]" />

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors"
          title="Cerrar"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
        </button>

        {/* Icon & Heading */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.25)]">
            <span aria-hidden="true" className="material-symbols-outlined text-[32px]">shield_lock</span>
          </div>
          <span className="text-[10px] tracking-widest font-mono font-bold text-cyan-400 uppercase">
            Autenticación en Dos Pasos (2FA)
          </span>
          <h2 id="vault-modal-title" className="text-xl font-black text-white">
            {title}
          </h2>
          <p className="text-xs text-slate-400 leading-relaxed max-w-sm">
            {description}
          </p>
        </div>

        {/* Method Switcher */}
        <div className="flex gap-1.5 rounded-xl bg-[#030610] border border-cyan-500/20 p-1">
          {([
            ['whatsapp', 'WhatsApp'],
            ['totp', 'Authenticator'],
            ['backup', '8 Códigos'],
          ] as const).map(([val, label]) => (
            <button
              key={val}
              type="button"
              disabled={busy}
              onClick={() => {
                setMethod(val);
                setCode('');
                setError('');
                setNotice('');
              }}
              className={`flex-1 rounded-lg py-2 text-xs font-bold transition-all cursor-pointer ${
                method === val
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Method Detail */}
        {method === 'whatsapp' ? (
          <div className="rounded-2xl bg-[#040814] border border-cyan-500/25 p-3.5 space-y-2.5">
            <div className="flex items-center justify-center gap-1.5 text-emerald-400 text-xs font-bold font-mono">
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">chat</span>
              <span>Canal Seguro WhatsApp</span>
            </div>
            <p className="text-[11px] text-slate-400">
              El PIN se envía al teléfono del Super Administrador y expira en 1 minuto.
            </p>
            <button
              type="button"
              disabled={busy || cooldown > 0}
              onClick={() => void handleRequestOtp()}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs disabled:opacity-50 transition-all shadow-[0_0_12px_rgba(6,182,212,0.3)] cursor-pointer"
            >
              {cooldown > 0 ? `Reenviar en ${cooldown}s` : 'Solicitar Código por WhatsApp'}
            </button>
          </div>
        ) : method === 'totp' ? (
          <div className="rounded-2xl bg-[#040814] border border-cyan-500/25 p-3.5 text-xs text-slate-400 space-y-1">
            <p className="text-cyan-300 font-bold font-mono text-[11px]">Google Authenticator</p>
            <p className="text-[11px]">Ingresa el código dinámico de 6 dígitos generado en tu aplicación.</p>
          </div>
        ) : (
          <div className="rounded-2xl bg-[#040814] border border-cyan-500/25 p-3.5 text-xs text-slate-400 space-y-1">
            <p className="text-cyan-300 font-bold font-mono text-[11px]">Código de Emergencia</p>
            <p className="text-[11px]">Ingresa uno de tus códigos de un solo uso de 8 dígitos.</p>
          </div>
        )}

        {/* Code Input Form */}
        <form onSubmit={(e) => void handleVerify(e)} className="space-y-4">
          <div>
            <label htmlFor="vault-pin-input" className="block text-[11px] font-mono font-bold text-cyan-400 mb-2">
              PIN DE SEGURIDAD ({digits} DÍGITOS)
            </label>
            <div className="relative flex justify-center gap-2">
              <input
                id="vault-pin-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={digits}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, digits))}
                disabled={busy}
                placeholder={'•'.repeat(digits)}
                className="w-full text-center tracking-[0.5em] text-xl font-mono py-2.5 px-4 rounded-xl bg-[#030610] border border-cyan-500/40 text-cyan-300 placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30"
              />
            </div>
          </div>

          {error && (
            <div className="p-2.5 rounded-xl bg-red-950/50 border border-red-500/40 text-red-300 text-xs font-mono">
              {error}
            </div>
          )}

          {notice && (
            <div className="p-2.5 rounded-xl bg-emerald-950/50 border border-emerald-500/40 text-emerald-300 text-xs font-mono">
              {notice}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy || code.trim().length !== digits}
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-black transition-all shadow-[0_0_15px_rgba(6,182,212,0.4)] disabled:opacity-40 cursor-pointer"
            >
              {busy ? 'Verificando...' : 'Desbloquear Bóveda'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
