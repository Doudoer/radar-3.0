import React, { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '../services/apiFetch';
import { useTheme } from '../hooks/useTheme';

interface LoginViewProps {
  onAuthenticated: (user: { role: string }) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onAuthenticated }) => {
  const { isDark, toggleTheme } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Wait for web fonts and icons to be ready to avoid Flash of Unstyled Text / Ligatures
    if (typeof document !== 'undefined' && 'fonts' in document) {
      document.fonts.ready
        .then(() => {
          setIsReady(true);
        })
        .catch(() => {
          setIsReady(true);
        });
      // Safety timer so loading state never blocks the user
      const timer = setTimeout(() => setIsReady(true), 350);
      return () => clearTimeout(timer);
    } else {
      setIsReady(true);
    }
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const response = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'No se pudo iniciar sesión.');
      sessionStorage.setItem('radar_authenticated', 'true');
      onAuthenticated(payload.user);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'No se pudo iniciar sesión.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isReady) {
    return (
      <main className="flex min-h-screen min-h-[100dvh] items-center justify-center bg-[#050811] px-4 py-8 text-[#dfe2ef] relative overflow-hidden cyber-grid-bg">
        {/* Ambient Neon Backlight Orbs */}
        <div className="absolute top-1/3 left-1/3 -translate-x-1/2 -translate-y-1/2 w-72 h-72 bg-cyan-500/15 rounded-full blur-[80px] pointer-events-none" />
        <div className="absolute bottom-1/3 right-1/3 translate-x-1/2 translate-y-1/2 w-72 h-72 bg-emerald-500/15 rounded-full blur-[80px] pointer-events-none" />

        <div className="relative flex flex-col items-center justify-center text-center z-10 animate-pulse">
          {/* Holographic Radar Scanner Emblem */}
          <div className="relative mb-5 flex items-center justify-center">
            {/* Outer Orbit Ring */}
            <div className="absolute -inset-4 rounded-full border border-dashed border-cyan-500/40 animate-cyber-orbit pointer-events-none" />
            {/* Counter Orbit Ring */}
            <div className="absolute -inset-7 rounded-full border border-dotted border-emerald-400/30 animate-cyber-orbit-reverse pointer-events-none" />
            {/* Glow Aura */}
            <div className="absolute inset-0 rounded-2xl bg-cyan-500/25 blur-xl" />

            {/* Core Shield Pod with SVG Radar (zero font loading dependency) */}
            <div className="relative w-18 h-18 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-[#0c1a30] via-[#060c18] to-[#040812] border-2 border-cyan-400/70 flex items-center justify-center text-cyan-400 shadow-[0_0_30px_rgba(6,182,212,0.5),inset_0_0_15px_rgba(6,182,212,0.3)] overflow-hidden">
              <div className="absolute inset-x-0 h-[2px] bg-cyan-400 shadow-[0_0_10px_#22d3ee] animate-cyber-scan pointer-events-none" />
              <svg
                className="w-10 h-10 text-cyan-400 animate-spin"
                style={{ animationDuration: '4s' }}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" strokeOpacity="0.35" />
                <path d="M12 2a10 10 0 0 1 10 10" />
                <circle cx="12" cy="12" r="6" strokeOpacity="0.55" />
                <path d="M12 6a6 6 0 0 1 6 6" />
                <circle cx="12" cy="12" r="2" fill="currentColor" />
              </svg>
            </div>
          </div>

          {/* Pill Badge */}
          <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-[#040b17]/95 border border-cyan-400/40 text-[10.5px] font-mono font-bold tracking-[0.2em] text-cyan-300 uppercase shadow-[0_0_16px_rgba(6,182,212,0.25)]">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-ping" />
            <span>CARGANDO RADAR V3...</span>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen min-h-[100dvh] items-center justify-center bg-[#050811] px-4 py-6 sm:py-8 text-[#dfe2ef] relative overflow-y-auto custom-scrollbar cyber-grid-bg transition-opacity duration-300">
      {/* Top right theme toggle */}
      <button
        type="button"
        onClick={toggleTheme}
        className="fixed top-4 right-4 z-50 p-2 rounded-xl border border-cyan-500/30 bg-[#070c18]/90 hover:bg-cyan-500/20 text-cyan-300 transition-all cursor-pointer flex items-center gap-1.5 shadow-md font-mono text-xs"
        title={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      >
        <span className="material-symbols-outlined text-[18px]">{isDark ? 'light_mode' : 'dark_mode'}</span>
        <span className="hidden sm:inline font-bold">{isDark ? 'CLARO' : 'OSCURO'}</span>
      </button>

      {/* Ambient Neon Backlight Orbs - Lightweight */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-cyan-500/10 rounded-full blur-[80px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-80 h-80 bg-emerald-500/10 rounded-full blur-[80px] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-600/8 rounded-full blur-[90px] pointer-events-none" />

      {/* Main Glassmorphic Login Card */}
      <div className="relative max-w-md w-full rounded-3xl bg-[#070c18]/94 backdrop-blur-2xl border border-cyan-500/35 p-6 sm:p-8 shadow-[0_20px_60px_rgba(0,0,0,0.85),0_0_40px_rgba(6,182,212,0.15)] flex flex-col items-center text-center overflow-hidden my-auto">
        {/* Top Laser Edge Light Line */}
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 shadow-[0_0_14px_#22d3ee]" />

        {/* Holographic Radar Scanner Emblem */}
        <div className="relative mb-4 flex items-center justify-center">
          {/* Outer Orbit Ring */}
          <div className="absolute -inset-3 rounded-full border border-dashed border-cyan-500/30 animate-cyber-orbit pointer-events-none" />
          {/* Counter Orbit Ring */}
          <div className="absolute -inset-5 rounded-full border border-dotted border-emerald-400/25 animate-cyber-orbit-reverse pointer-events-none" />
          {/* Glow Aura */}
          <div className="absolute inset-0 rounded-2xl bg-cyan-500/20 blur-lg animate-pulse" />

          {/* Core Shield Pod */}
          <div className="relative w-16 h-16 sm:w-18 sm:h-18 rounded-2xl bg-gradient-to-br from-[#0c1a30] via-[#060c18] to-[#040812] border-2 border-cyan-400/60 flex items-center justify-center text-cyan-400 shadow-[0_0_25px_rgba(6,182,212,0.4),inset_0_0_15px_rgba(6,182,212,0.25)] overflow-hidden">
            {/* Laser Scanline Beam */}
            <div className="absolute inset-x-0 h-[2px] bg-cyan-400 shadow-[0_0_10px_#22d3ee] animate-cyber-scan pointer-events-none" />
            <span className="material-symbols-outlined text-[32px] sm:text-[36px] drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">
              radar
            </span>
          </div>
        </div>

        {/* Security Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#040b17]/90 border border-cyan-400/40 text-[9.5px] sm:text-[10px] font-mono font-bold tracking-[0.2em] text-cyan-300 uppercase mb-2.5 shadow-[0_0_12px_rgba(6,182,212,0.2)]">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-ping" />
          <span>RADAR V3 • ACCESO SEGURO</span>
        </div>

        {/* Title */}
        <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
          Iniciar Sesión
        </h1>
        <p className="text-[11.5px] sm:text-xs text-slate-400 mt-1 leading-relaxed max-w-xs">
          Ingresa tus credenciales autorizadas para acceder a la plataforma central de Radar 3.0.
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} className="w-full mt-5 text-left">
          {/* Email field */}
          <div className="mb-3.5">
            <label className="block text-[10.5px] font-mono uppercase tracking-wider text-cyan-300/90 font-bold mb-1">
              Correo Electrónico
            </label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-cyan-400/70 text-[18px]">
                alternate_email
              </span>
              <input
                className="w-full rounded-2xl border border-cyan-500/25 bg-[#040814]/90 pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/30 shadow-[inset_0_0_12px_rgba(0,0,0,0.6)]"
                type="email"
                placeholder="usuario@radar.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
              />
            </div>
          </div>

          {/* Password field */}
          <div className="mb-4">
            <label className="block text-[11px] font-mono uppercase tracking-wider text-cyan-300/90 font-bold mb-1.5">
              Contraseña
            </label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-cyan-400/70 text-[18px]">
                lock
              </span>
              <input
                className="w-full rounded-2xl border border-cyan-500/25 bg-[#040814]/90 pl-10 pr-11 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/30 shadow-[inset_0_0_12px_rgba(0,0,0,0.6)]"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••••••"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-cyan-300 transition cursor-pointer"
                title={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
              >
                <span className="material-symbols-outlined text-[19px]">
                  {showPassword ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="mb-4 p-3 rounded-2xl border border-red-500/40 bg-red-500/15 text-xs text-red-200 flex items-center gap-2.5 animate-shake shadow-[0_0_20px_rgba(239,68,68,0.2)]">
              <span className="material-symbols-outlined text-[18px] text-red-400 shrink-0">error</span>
              <span className="font-mono">{error}</span>
            </div>
          )}

          {/* Submit Button */}
          <button
            className="w-full mt-2 bg-gradient-to-r from-cyan-400 via-blue-500 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 font-black tracking-wider uppercase text-xs py-3.5 px-5 rounded-2xl transition-all cursor-pointer shadow-[0_0_30px_rgba(6,182,212,0.45)] hover:shadow-[0_0_40px_rgba(16,185,129,0.6)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-[0.98]"
            type="submit"
            disabled={submitting}
          >
            {submitting ? (
              <>
                <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                <span>VALIDANDO CREDENCIALES...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[20px]">login</span>
                <span>INGRESAR AL SISTEMA</span>
              </>
            )}
          </button>
        </form>

        {/* Footer Security Matrix */}
        <div className="mt-6 pt-4 border-t border-cyan-500/15 w-full flex items-center justify-center gap-2 text-[10px] font-mono text-cyan-400/70 uppercase tracking-widest">
          <span className="material-symbols-outlined text-[14px] text-emerald-400">verified_user</span>
          <span>SHA-256 E2EE • PROTOCOLO RADAR V3</span>
        </div>

        {/* Copyright Notice */}
        <div className="mt-3 text-[10.5px] font-mono text-slate-400/90 tracking-wider">
          Derechos reservados para{' '}
          <a
            href="https://soviwebs.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 hover:text-cyan-300 font-bold underline underline-offset-2 transition-colors"
          >
            soviwebs.com
          </a>
        </div>
      </div>
    </main>
  );
};
