import React, { useState } from 'react';
import { apiFetch } from '../services/apiFetch';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ isOpen, onClose }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const rules = [
    { label: 'Mínimo 8 caracteres', met: newPassword.length >= 8 },
    { label: 'Al menos una mayúscula (A-Z)', met: /[A-Z]/.test(newPassword) },
    { label: 'Al menos una minúscula (a-z)', met: /[a-z]/.test(newPassword) },
    { label: 'Al menos un dígito numérico (0-9)', met: /[0-9]/.test(newPassword) },
    { label: 'Al menos un signo o punto (. ! @ # $ etc.)', met: /[^a-zA-Z0-9]/.test(newPassword) },
  ];

  const allRulesMet = rules.every((r) => r.met);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentPassword) {
      setError('Debes ingresar tu contraseña actual.');
      return;
    }
    if (!allRulesMet) {
      setError('La nueva contraseña no cumple con todos los requisitos de seguridad.');
      return;
    }
    if (!passwordsMatch) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setLoading(true);
    try {
      const response = await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Error al actualizar la contraseña');
      }

      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        onClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de comunicación con el servidor');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (loading) return;
    setError(null);
    setSuccess(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-fade-in">
      <div className="w-full max-w-md bg-[#070c18]/95 backdrop-blur-2xl border border-cyan-500/30 rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.85)] p-6 text-slate-200 relative overflow-hidden">
        {/* Laser Hairline */}
        <div className="cyber-laser-bar absolute top-0 left-0 right-0 z-20" />

        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-cyan-500/20">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.25)]">
              <span className="material-symbols-outlined text-[20px]">lock_reset</span>
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-100">Cambiar Contraseña</h3>
              <p className="text-xs text-slate-400">Actualiza las credenciales de tu cuenta</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {error && (
            <div className="p-3 bg-rose-950/30 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center gap-2 animate-shake">
              <span className="material-symbols-outlined text-[18px] shrink-0 text-rose-400">error</span>
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3 bg-emerald-950/30 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 flex items-center gap-2 animate-fade-in shadow-[0_0_12px_rgba(16,185,129,0.25)]">
              <span className="material-symbols-outlined text-[18px] shrink-0 text-emerald-400">check_circle</span>
              <span>¡Contraseña actualizada exitosamente!</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Contraseña Actual
            </label>
            <div className="relative">
              <input
                type={showPasswords ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                placeholder="Ingresa tu contraseña actual"
                className="w-full bg-[#050914] border border-cyan-500/30 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 shadow-inner"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Nueva Contraseña (mínimo 8 caracteres)
            </label>
            <div className="relative">
              <input
                type={showPasswords ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                placeholder="Mínimo 8 caracteres (mayús, minús, núm, signos/puntos)"
                className="w-full bg-[#050914] border border-cyan-500/30 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 shadow-inner"
              />
            </div>
          </div>

          {/* Real-time Requirements Checklist */}
          {newPassword.length > 0 && (
            <div className="p-3.5 bg-[#050914]/90 border border-cyan-500/20 rounded-xl space-y-1.5 text-[11px] shadow-inner">
              <p className="font-semibold text-cyan-400 text-[10px] uppercase tracking-wider mb-1 font-mono">
                Requisitos de seguridad requeridos:
              </p>
              {rules.map((rule, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-1.5 transition-colors ${
                    rule.met ? 'text-emerald-400 font-medium' : 'text-slate-500'
                  }`}
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {rule.met ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                  <span>{rule.label}</span>
                </div>
              ))}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Confirmar Nueva Contraseña
            </label>
            <div className="relative">
              <input
                type={showPasswords ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                placeholder="Repite la nueva contraseña"
                className="w-full bg-[#050914] border border-cyan-500/30 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 shadow-inner"
              />
            </div>
            {confirmPassword.length > 0 && (
              <div
                className={`mt-1.5 flex items-center gap-1.5 text-[11px] font-medium ${
                  passwordsMatch ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">
                  {passwordsMatch ? 'check_circle' : 'cancel'}
                </span>
                <span>{passwordsMatch ? 'Las contraseñas coinciden' : 'Las contraseñas no coinciden'}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showPasswords}
                onChange={(e) => setShowPasswords(e.target.checked)}
                className="rounded border-slate-700 bg-[#050914] text-cyan-500 accent-cyan-500 focus:ring-0"
              />
              <span>Mostrar contraseñas</span>
            </label>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-cyan-500/20">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || success || !allRulesMet || !passwordsMatch}
              className="px-5 py-2.5 rounded-xl text-xs font-black text-slate-950 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 transition-all shadow-[0_0_15px_rgba(6,182,212,0.35)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer active:scale-95"
            >
              {loading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>Guardando...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[16px]">save</span>
                  <span>Guardar Contraseña</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
