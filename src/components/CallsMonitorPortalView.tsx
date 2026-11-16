import React, { useEffect, useState } from 'react';
import { apiFetch } from '../services/apiFetch';
import { CallsLogView } from './CallsLogView';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const CallsMonitorPortalView: React.FC = () => {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [code, setCode] = useState('');
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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleaned = code.trim();
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
  };

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
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-[var(--bg-primary)] text-[var(--text-primary)] p-4">
        <div className="w-full max-w-md rounded-3xl border border-[var(--border-color)] bg-[var(--bg-card)] p-6 sm:p-8 shadow-2xl space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/15 border border-cyan-500/35 text-cyan-400 flex items-center justify-center shrink-0">
              <span aria-hidden="true" className="material-symbols-outlined text-[26px]">call</span>
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-400 block">
                URL Dedicada · /llamadas
              </span>
              <h1 className="text-xl font-black text-[var(--text-primary)]">Monitor de Llamadas</h1>
            </div>
          </div>

          <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed">
            Vista exclusiva de monitoreo telefónico en vivo. Ingresa el código configurado en Configuración del Sistema.
          </p>

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
                className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] px-4 py-3 text-center text-lg font-mono tracking-[0.25em] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              />
            </label>

            {error && (
              <p role="alert" className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-400">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !code.trim()}
              className="cyber-btn-primary w-full py-3 font-bold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">lock_open</span>
              <span>{busy ? 'Verificando código…' : 'Entrar al Monitor de Llamadas'}</span>
            </button>
          </form>
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
