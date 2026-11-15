import React, { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '../services/apiFetch';

interface YardLoginViewProps {
  onAuthenticated: (user: { role: string; name?: string; email?: string }) => void;
}

const PIN_LENGTH = 4;

const keypadDigits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export const YardLoginView: React.FC<YardLoginViewProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'pin' | 'password'>('pin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handlePinLogin = async (pinValue: string) => {
    if (pinValue.length !== PIN_LENGTH || submitting) return;
    setError('');
    setSubmitting(true);
    try {
      const response = await apiFetch('/auth/pin-login', {
        method: 'POST',
        body: JSON.stringify({ pin: pinValue }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'PIN incorrecto.');
      sessionStorage.setItem('radar_authenticated', 'true');
      onAuthenticated(payload.user);
    } catch (err) {
      setPin('');
      setError(err instanceof Error ? err.message : 'No se pudo validar el PIN.');
    } finally {
      setSubmitting(false);
    }
  };

  const pressDigit = (digit: string) => {
    if (submitting) return;
    setError('');
    setPin((prev) => (prev.length >= PIN_LENGTH ? prev : prev + digit));
  };

  const pressBackspace = () => {
    if (submitting) return;
    setError('');
    setPin((prev) => prev.slice(0, -1));
  };

  useEffect(() => {
    if (mode !== 'pin') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        pressDigit(event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        pressBackspace();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        void handlePinLogin(pin);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, pin, submitting]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const response = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'Credenciales incorrectas.');
      sessionStorage.setItem('radar_authenticated', 'true');
      onAuthenticated(payload.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main data-auth-gate="true" className="flex min-h-screen min-h-[100dvh] items-center justify-center bg-[#070b14] px-4 py-8 text-slate-100 relative overflow-hidden font-sans">
      {/* Ambient background glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-amber-500/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-80 h-80 bg-orange-600/10 rounded-full blur-[90px] pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        {/* Card */}
        <div className="rounded-2xl border border-amber-500/30 bg-[#0d1424]/90 p-6 sm:p-8 shadow-[0_0_50px_rgba(245,158,11,0.15)] backdrop-blur-xl">
          {/* Header */}
          <div className="text-center mb-5">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/15 border border-amber-500/40 text-amber-400 mb-3 shadow-[0_0_20px_rgba(245,158,11,0.25)]">
              <span aria-hidden="true" className="material-symbols-outlined text-3xl">agriculture</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center justify-center gap-2">
              <span>RADAR</span>
              <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-400 border border-amber-500/40 text-xs font-mono font-bold tracking-wider uppercase">
                Yarda
              </span>
            </h1>
            <p className="text-xs text-slate-400 mt-1 font-mono">
              Portal de Operaciones de Patio · {typeof window !== 'undefined' ? window.location.host : 'Radar Yarda'}
            </p>
          </div>

          {/* Método de acceso */}
          <div
            role="group"
            aria-label="Método de acceso"
            className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-slate-700 bg-slate-900/60 p-1"
          >
            <button
              type="button"
              aria-pressed={mode === 'pin'}
              onClick={() => { setMode('pin'); setError(''); }}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-mono font-bold transition-all cursor-pointer ${
                mode === 'pin'
                  ? 'bg-amber-500 text-slate-950 shadow-[0_0_14px_rgba(245,158,11,0.35)]'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">dialpad</span>
              <span>Entrar con PIN</span>
            </button>
            <button
              type="button"
              aria-pressed={mode === 'password'}
              onClick={() => { setMode('password'); setError(''); }}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-mono font-bold transition-all cursor-pointer ${
                mode === 'password'
                  ? 'bg-amber-500 text-slate-950 shadow-[0_0_14px_rgba(245,158,11,0.35)]'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">badge</span>
              <span>Usuario y clave</span>
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 rounded-xl border border-red-500/50 bg-red-950/40 p-3 text-xs text-red-300 font-mono flex items-center gap-2"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">error</span>
              <span>{error}</span>
            </div>
          )}

          {mode === 'pin' ? (
            <div>
              <div className="text-center mb-5">
                <p className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300 mb-3">
                  Marca tu PIN de 4 dígitos
                </p>
                <div className="flex items-center justify-center gap-3" aria-hidden="true">
                  {Array.from({ length: PIN_LENGTH }).map((_, index) => (
                    <span
                      key={index}
                      className={`h-4 w-4 rounded-full border-2 transition-all ${
                        index < pin.length
                          ? 'border-amber-400 bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.6)]'
                          : 'border-slate-600 bg-transparent'
                      }`}
                    />
                  ))}
                </div>
                <p role="status" aria-live="polite" className="sr-only">
                  {pin.length} de {PIN_LENGTH} dígitos
                </p>
              </div>

              <div role="group" aria-label="Teclado numérico del PIN" className="grid grid-cols-3 gap-2.5">
                {keypadDigits.map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    onClick={() => pressDigit(digit)}
                    disabled={submitting}
                    aria-label={`Dígito ${digit}`}
                    className="h-14 rounded-xl border border-slate-700 bg-slate-900/80 text-xl font-mono font-bold text-white transition-all active:scale-[0.97] active:bg-amber-500/20 hover:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50 cursor-pointer"
                  >
                    {digit}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPin('')}
                  disabled={submitting || pin.length === 0}
                  aria-label="Borrar todo el PIN"
                  className="h-14 rounded-xl border border-slate-700 bg-slate-900/60 text-slate-300 transition-all active:scale-[0.97] hover:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-40 cursor-pointer flex items-center justify-center"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[20px]">delete_sweep</span>
                </button>
                <button
                  type="button"
                  onClick={() => pressDigit('0')}
                  disabled={submitting}
                  aria-label="Dígito 0"
                  className="h-14 rounded-xl border border-slate-700 bg-slate-900/80 text-xl font-mono font-bold text-white transition-all active:scale-[0.97] active:bg-amber-500/20 hover:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50 cursor-pointer"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={pressBackspace}
                  disabled={submitting || pin.length === 0}
                  aria-label="Borrar el último dígito"
                  className="h-14 rounded-xl border border-slate-700 bg-slate-900/60 text-slate-300 transition-all active:scale-[0.97] hover:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-40 cursor-pointer flex items-center justify-center"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[20px]">backspace</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => void handlePinLogin(pin)}
                disabled={submitting || pin.length !== PIN_LENGTH}
                className="w-full mt-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-bold py-3 text-sm flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(245,158,11,0.3)] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none font-mono tracking-wider"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">login</span>
                <span>{submitting ? 'Validando...' : 'Entrar a Yarda'}</span>
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-mono font-bold uppercase tracking-wider text-slate-300 mb-1.5">
                  Usuario / Correo Electrónico
                </label>
                <div className="relative">
                  <span aria-hidden="true" className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">
                    person
                  </span>
                  <input
                    type="text"
                    required
                    autoFocus
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="empleado@yarda.com o usuario"
                    disabled={submitting}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900/80 pl-10 pr-4 py-3 text-sm text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono font-bold uppercase tracking-wider text-slate-300 mb-1.5">
                  Contraseña
                </label>
                <div className="relative">
                  <span aria-hidden="true" className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">
                    key
                  </span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    disabled={submitting}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900/80 pl-10 pr-11 py-3 text-sm text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[20px]">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full mt-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-bold py-3 text-sm flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(245,158,11,0.3)] transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed font-mono tracking-wider"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">login</span>
                <span>{submitting ? 'Ingresando...' : 'Entrar a Yarda'}</span>
              </button>
            </form>
          )}

          {/* Footer note */}
          <div className="mt-6 pt-4 border-t border-slate-800 text-center">
            <p className="text-[11px] text-slate-400 font-mono">
              Acceso exclusivo para personal de patio y supervisión.
            </p>
            {mode === 'pin' && (
              <p className="text-[11px] text-slate-500 font-mono mt-1">
                ¿Olvidaste tu PIN? El administrador puede restablecerlo.
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
};
