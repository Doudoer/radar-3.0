import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../services/apiFetch';
import { CallsLogView } from './CallsLogView';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const KEYPAD_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export const CallsMonitorPortalView: React.FC = () => {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [code, setCode] = useState('');
  const [useTextInput, setUseTextInput] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [activeTab, setActiveTab] = useState<'daily' | 'analytics'>('daily');
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const previousManifestHref = manifestLink?.getAttribute('href') || null;
    if (manifestLink) {
      manifestLink.setAttribute('href', '/manifest-calls.json');
    }

    const appleTitle = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    const previousAppleTitle = appleTitle?.getAttribute('content') || null;
    if (appleTitle) {
      appleTitle.setAttribute('content', 'Llamadas');
    }

    const previousTitle = document.title;
    document.title = 'RADAR · Monitor de Llamadas';

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      if (manifestLink && previousManifestHref) {
        manifestLink.setAttribute('href', previousManifestHref);
      }
      if (appleTitle && previousAppleTitle) {
        appleTitle.setAttribute('content', previousAppleTitle);
      }
      document.title = previousTitle;
    };
  }, []);

  const triggerInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const result = await installPrompt.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
    if (result.outcome === 'accepted') {
      setInstallPrompt(null);
    }
  };

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const res = await apiFetch('/pbx/monitor-session');
        const data = await res.json().catch(() => ({}));
        if (active) setAuthenticated(Boolean(res.ok && data.authenticated));
      } catch {
        if (active) setAuthenticated(false);
      } finally {
        if (active) setChecking(false);
      }
    };
    void check();
    return () => { active = false; };
  }, []);

  const submitCode = useCallback(async (rawCode: string) => {
    const cleaned = rawCode.trim();
    if (!cleaned) {
      setError('Ingresa el código de acceso.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch('/pbx/monitor-auth', {
        method: 'POST',
        body: JSON.stringify({ code: cleaned }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || 'Código incorrecto.');
      }
      setCode('');
      setAuthenticated(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo validar el código.');
    } finally {
      setBusy(false);
    }
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitCode(code);
  };

  const pressDigit = useCallback((digit: string) => {
    if (busy) return;
    setError('');
    setCode((prev) => (prev.length >= 12 ? prev : `${prev}${digit}`));
  }, [busy]);

  const pressBackspace = useCallback(() => {
    if (busy) return;
    setError('');
    setCode((prev) => prev.slice(0, -1));
  }, [busy]);

  useEffect(() => {
    if (checking || authenticated || useTextInput) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        pressDigit(event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        pressBackspace();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setCode('');
        setError('');
      } else if (event.key === 'Enter' && code.trim().length > 0) {
        event.preventDefault();
        void submitCode(code);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [checking, authenticated, useTextInput, code, pressDigit, pressBackspace, submitCode]);

  const logout = async () => {
    try {
      await apiFetch('/pbx/monitor-logout', { method: 'POST' });
    } catch { /* ignore */ }
    setAuthenticated(false);
  };

  if (checking) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-[var(--bg-primary)] text-[var(--text-secondary)] text-sm">
        Verificando acceso al Monitor de Llamadas…
      </div>
    );
  }

  if (!authenticated) {
    const dotCount = Math.max(4, code.length);
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-[var(--bg-primary)] text-[var(--text-primary)] p-4">
        <div className="w-full max-w-md rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-6 sm:p-8 shadow-2xl space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/15 border border-cyan-500/35 text-cyan-500 flex items-center justify-center shrink-0">
              <span aria-hidden="true" className="material-symbols-outlined text-[26px]">call</span>
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-500 block">
                Portal Calls · calls.radar-rsy.store
              </span>
              <h1 className="text-xl font-black text-[var(--text-heading)]">Monitor de Llamadas</h1>
            </div>
          </div>

          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Ingresa el código global de Llamadas configurado en Seguridad &amp; Control de Acceso.
          </p>

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-500 dark:text-rose-300 font-mono flex items-center gap-2"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">error</span>
              <span>{error}</span>
            </div>
          )}

          {!useTextInput ? (
            <div className="space-y-4">
              <div className="text-center">
                <p className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-3">
                  Marca el código de acceso
                </p>
                <div className="flex items-center justify-center gap-3 flex-wrap" aria-hidden="true">
                  {Array.from({ length: dotCount }).map((_, index) => (
                    <span
                      key={index}
                      className={`h-4 w-4 rounded-full border-2 transition-all ${
                        index < code.length
                          ? 'border-[var(--brand-solid)] bg-[var(--brand-solid)] shadow-[0_0_10px_rgba(79,70,229,0.45)]'
                          : 'border-[var(--border-subtle)] bg-transparent'
                      }`}
                    />
                  ))}
                </div>
                <p role="status" aria-live="polite" className="sr-only">
                  {code.length} dígitos ingresados
                </p>
              </div>

              <div role="group" aria-label="Teclado numérico del código de llamadas" className="grid grid-cols-3 gap-2.5">
                {KEYPAD_DIGITS.map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    onClick={() => pressDigit(digit)}
                    disabled={busy}
                    aria-label={`Dígito ${digit}`}
                    className="h-14 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xl font-mono font-bold text-[var(--text-heading)] transition-all active:scale-[0.97] hover:border-[var(--brand-solid)] focus:outline-none disabled:opacity-50 cursor-pointer"
                  >
                    {digit}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { setCode(''); setError(''); }}
                  disabled={busy || code.length === 0}
                  aria-label="Borrar todo el código"
                  className="h-14 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] transition-all active:scale-[0.97] hover:border-[var(--brand-solid)] focus:outline-none disabled:opacity-40 cursor-pointer flex items-center justify-center"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[20px]">delete_sweep</span>
                </button>
                <button
                  type="button"
                  onClick={() => pressDigit('0')}
                  disabled={busy}
                  aria-label="Dígito 0"
                  className="h-14 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xl font-mono font-bold text-[var(--text-heading)] transition-all active:scale-[0.97] hover:border-[var(--brand-solid)] focus:outline-none disabled:opacity-50 cursor-pointer"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={pressBackspace}
                  disabled={busy || code.length === 0}
                  aria-label="Borrar el último dígito"
                  className="h-14 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] transition-all active:scale-[0.97] hover:border-[var(--brand-solid)] focus:outline-none disabled:opacity-40 cursor-pointer flex items-center justify-center"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[20px]">backspace</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => { void submitCode(code); }}
                disabled={busy || code.trim().length < 4}
                className="w-full rounded-xl bg-[var(--brand-solid)] hover:bg-[var(--brand-hover)] !text-white font-bold py-3 text-sm flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">lock_open</span>
                <span>{busy ? 'Verificando código…' : 'Entrar al Monitor de Llamadas'}</span>
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                  Código de acceso
                </span>
                <input
                  type="password"
                  autoFocus
                  autoComplete="one-time-code"
                  maxLength={64}
                  value={code}
                  disabled={busy}
                  onChange={event => setCode(event.target.value)}
                  placeholder="Ingresa el código del monitor"
                  className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 text-center text-lg font-mono tracking-[0.25em] text-[var(--text-heading)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-solid)]/40"
                />
              </label>

              <button
                type="submit"
                disabled={busy || !code.trim()}
                className="w-full rounded-xl bg-[var(--brand-solid)] hover:bg-[var(--brand-hover)] !text-white font-bold py-3 text-sm flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">lock_open</span>
                <span>{busy ? 'Verificando código…' : 'Entrar al Monitor de Llamadas'}</span>
              </button>
            </form>
          )}

          <div className="pt-1 text-center">
            <button
              type="button"
              onClick={() => { setUseTextInput((v) => !v); setCode(''); setError(''); }}
              className="text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-heading)] underline-offset-2 hover:underline cursor-pointer"
            >
              {useTextInput ? 'Usar pad numérico' : '¿Código con letras? Usar teclado completo'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[var(--bg-primary)] text-[var(--text-primary)] flex flex-col">
      <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]/95 backdrop-blur-xl px-3.5 sm:px-6 pt-[env(safe-area-inset-top)]">
        <div className="h-14 max-w-[1600px] mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-500/35 text-cyan-400 flex items-center justify-center shrink-0">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">call</span>
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-sm sm:text-base font-black text-[var(--text-primary)] truncate">
                Monitor PBX
              </h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/35 px-2 py-0.5 text-[9.5px] font-bold text-emerald-400 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                EN VIVO
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {installPrompt && (
              <button
                type="button"
                onClick={() => { void triggerInstall(); }}
                title="Instalar App"
                aria-label="Instalar App"
                className="h-9 px-2.5 rounded-xl border border-cyan-500/35 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 text-xs font-bold flex items-center gap-1 transition-all"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[17px]">install_mobile</span>
                <span className="hidden sm:inline">Instalar</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setRefreshTick((t) => t + 1)}
              title="Actualizar"
              aria-label="Actualizar llamadas"
              className="w-9 h-9 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center transition-all"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">refresh</span>
            </button>
            <button
              type="button"
              onClick={() => { void logout(); }}
              title="Bloquear / Salir"
              aria-label="Bloquear y salir"
              className="w-9 h-9 sm:w-auto sm:px-3 rounded-xl border border-rose-500/35 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 text-xs font-bold flex items-center justify-center gap-1.5 transition-all"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[17px]">lock</span>
              <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-3 pt-2.5 pb-[calc(4.75rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-4 sm:pb-24 max-w-[1600px] w-full mx-auto">
        <CallsLogView
          mobileAppMode
          activeTab={activeTab}
          onTabChange={setActiveTab}
          refreshTick={refreshTick}
        />
      </main>

      <nav
        aria-label="Navegación del monitor de llamadas"
        className="fixed bottom-0 inset-x-0 z-30 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
      >
        <div className="h-14 max-w-md mx-auto grid grid-cols-2">
          <button
            type="button"
            onClick={() => setActiveTab('daily')}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold transition-colors ${
              activeTab === 'daily'
                ? 'text-[var(--brand-solid)]'
                : 'text-[var(--text-muted)]'
            }`}
          >
            <span className={`px-4 py-0.5 rounded-full transition-colors ${activeTab === 'daily' ? 'bg-[var(--brand-solid)]/15' : ''}`}>
              <span aria-hidden="true" className="material-symbols-outlined text-[20px] block">call</span>
            </span>
            <span>En vivo</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('analytics')}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold transition-colors ${
              activeTab === 'analytics'
                ? 'text-[var(--brand-solid)]'
                : 'text-[var(--text-muted)]'
            }`}
          >
            <span className={`px-4 py-0.5 rounded-full transition-colors ${activeTab === 'analytics' ? 'bg-[var(--brand-solid)]/15' : ''}`}>
              <span aria-hidden="true" className="material-symbols-outlined text-[20px] block">bar_chart</span>
            </span>
            <span>Analíticas</span>
          </button>
        </div>
      </nav>
    </div>
  );
};
