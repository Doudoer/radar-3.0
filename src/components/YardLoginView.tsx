import React, { FormEvent, useState } from 'react';
import { apiFetch } from '../services/apiFetch';

interface YardLoginViewProps {
  onAuthenticated: (user: { role: string; name?: string; email?: string }) => void;
}

export const YardLoginView: React.FC<YardLoginViewProps> = ({ onAuthenticated }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
    <main className="flex min-h-screen min-h-[100dvh] items-center justify-center bg-[#070b14] px-4 py-8 text-slate-100 relative overflow-hidden font-sans">
      {/* Ambient background glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-amber-500/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-80 h-80 bg-orange-600/10 rounded-full blur-[90px] pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        {/* Card */}
        <div className="rounded-2xl border border-amber-500/30 bg-[#0d1424]/90 p-6 sm:p-8 shadow-[0_0_50px_rgba(245,158,11,0.15)] backdrop-blur-xl">
          {/* Header */}
          <div className="text-center mb-6">
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

          {error && (
            <div
              role="alert"
              className="mb-5 rounded-xl border border-red-500/50 bg-red-950/40 p-3 text-xs text-red-300 font-mono flex items-center gap-2"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">error</span>
              <span>{error}</span>
            </div>
          )}

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

          {/* Footer note */}
          <div className="mt-6 pt-4 border-t border-slate-800 text-center">
            <p className="text-[11px] text-slate-400 font-mono">
              Acceso exclusivo para personal de patio y administradores.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
};

