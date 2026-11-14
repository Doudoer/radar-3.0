import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogAccessibility } from '../hooks/useDialogAccessibility';
import {
  INSTALL_PROMPT_STORAGE_PREFIX,
  detectMobileDevice,
  isStandaloneDisplay,
  readInstallPromptRecord,
  shouldOfferInstall,
  writeInstallPromptRecord,
  type MobileDevice,
} from '../utils/installPrompt';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

type InstallMode = 'ios' | 'android-native' | 'android-manual' | 'in-app';

const IOS_STEPS = [
  { icon: 'ios_share', text: 'Toca el botón Compartir en la barra de Safari.' },
  { icon: 'add_to_home_screen', text: 'Elige «Añadir a pantalla de inicio».' },
  { icon: 'check_circle', text: 'Confirma con «Añadir».' },
];

const ANDROID_STEPS = [
  { icon: 'more_vert', text: 'Abre el menú del navegador.' },
  { icon: 'install_mobile', text: 'Toca «Instalar aplicación» o «Añadir a pantalla de inicio».' },
  { icon: 'check_circle', text: 'Confirma la instalación.' },
];

const APP_NAMES = { yard: 'RADAR Patio', office: 'RADAR' } as const;

interface InstallAppPromptProps {
  variant: 'yard' | 'office';
}

export const InstallAppPrompt: React.FC<InstallAppPromptProps> = ({ variant }) => {
  const [device, setDevice] = useState<MobileDevice | null>(null);
  const [mode, setMode] = useState<InstallMode | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const promptEventRef = useRef<BeforeInstallPromptEvent | null>(null);
  const storageKey = `${INSTALL_PROMPT_STORAGE_PREFIX}${variant}`;

  const remember = useCallback((record: { dismissedAt?: number; installedAt?: number }) => {
    writeInstallPromptRecord(typeof window === 'undefined' ? null : window.localStorage, storageKey, record);
  }, [storageKey]);

  const dismiss = useCallback(() => {
    remember({ dismissedAt: Date.now() });
    setOpen(false);
  }, [remember]);

  useDialogAccessibility({ open, dialogRef, onEscape: dismiss });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const detected = detectMobileDevice(navigator.userAgent, navigator.maxTouchPoints);
    if (!detected) return;
    const standalone = isStandaloneDisplay(
      (query) => window.matchMedia(query).matches,
      (navigator as Navigator & { standalone?: boolean }).standalone,
    );
    const record = readInstallPromptRecord(window.localStorage, storageKey);
    if (!shouldOfferInstall(detected, { standalone, record, now: Date.now() })) return;
    setDevice(detected);

    const onInstalled = () => {
      remember({ installedAt: Date.now() });
      setOpen(false);
    };
    window.addEventListener('appinstalled', onInstalled);

    let openTimer: number | undefined;
    let promptListener: ((event: Event) => void) | undefined;

    if (detected.inAppBrowser) {
      setMode('in-app');
      setOpen(true);
    } else if (detected.platform === 'ios') {
      setMode('ios');
      openTimer = window.setTimeout(() => setOpen(true), 900);
    } else {
      promptListener = (event: Event) => {
        event.preventDefault();
        promptEventRef.current = event as BeforeInstallPromptEvent;
        setMode('android-native');
        setOpen(true);
      };
      window.addEventListener('beforeinstallprompt', promptListener);
      openTimer = window.setTimeout(() => {
        if (!promptEventRef.current) {
          setMode('android-manual');
          setOpen(true);
        }
      }, 2500);
    }

    return () => {
      window.removeEventListener('appinstalled', onInstalled);
      if (promptListener) window.removeEventListener('beforeinstallprompt', promptListener);
      if (openTimer) window.clearTimeout(openTimer);
    };
  }, [remember, storageKey]);

  const handleInstall = useCallback(async () => {
    const promptEvent = promptEventRef.current;
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    promptEventRef.current = null;
    if (choice.outcome === 'accepted') {
      remember({ installedAt: Date.now() });
    } else {
      remember({ dismissedAt: Date.now() });
    }
    setOpen(false);
  }, [remember]);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, []);

  if (!open || !mode || !device || typeof document === 'undefined') return null;

  const appName = APP_NAMES[variant];
  const yard = variant === 'yard';
  const steps = mode === 'ios' ? IOS_STEPS : ANDROID_STEPS;
  const showSteps = mode === 'ios' || mode === 'android-manual';
  const title = mode === 'in-app'
    ? `Abre ${appName} en tu navegador`
    : `Instala ${appName} en tu ${device.deviceName}`;
  const description = mode === 'in-app'
    ? 'Estás dentro de otra aplicación. Para instalar RADAR como app, abre este enlace en Safari (iPhone) o Chrome (Android).'
    : mode === 'android-native'
      ? 'Acceso directo desde la pantalla de inicio, a pantalla completa y sin abrir el navegador.'
      : 'Añádelo a tu pantalla de inicio para abrirlo como una app, a pantalla completa y sin pasar por el navegador.';

  const overlay = (
    <div className={`fixed inset-0 z-[150] flex items-end justify-center sm:items-center sm:p-6 ${yard ? 'bg-black/45' : 'bg-black/70'} backdrop-blur-sm animate-fade-in`}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-app-title"
        tabIndex={-1}
        className={`w-full font-sans animate-sheet-up outline-none sm:max-w-md ${
          yard
            ? 'yard-app yard-sheet px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-yard-ink sm:rounded-3xl'
            : 'rounded-t-3xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-[var(--text-primary)] shadow-[0_24px_80px_rgba(0,0,0,0.55)] sm:rounded-3xl'
        }`}
      >
        <div className={`mx-auto mb-3 h-1.5 w-12 rounded-full sm:hidden ${yard ? 'bg-yard-line-strong' : 'bg-[var(--border-hover)]'}`} />
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={`material-symbols-outlined flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[24px] ${
              yard
                ? 'bg-yard-accent-soft text-yard-accent-strong'
                : 'border border-[color:var(--state-info)]/40 bg-[color:var(--state-info)]/10 text-[color:var(--state-info)]'
            }`}
          >
            {device.platform === 'ios' ? 'phone_iphone' : 'smartphone'}
          </span>
          <div className="min-w-0 flex-1">
            <p className={`text-[10px] font-mono font-bold uppercase tracking-[0.12em] ${yard ? 'text-yard-muted' : 'text-[var(--text-secondary)]'}`}>
              {device.deviceName} detectado
            </p>
            <h2 id="install-app-title" className="mt-0.5 text-[17px] font-bold leading-snug">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Cerrar aviso de instalación"
            className={`-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              yard ? 'text-yard-muted hover:bg-yard-sunken' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]'
            }`}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <p className={`mt-3 text-[13px] leading-relaxed ${yard ? 'text-yard-muted' : 'text-[var(--text-secondary)]'}`}>
          {description}
        </p>

        {showSteps && (
          <ol className="mt-4 space-y-2.5">
            {steps.map((step, index) => (
              <li key={step.icon} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${
                    yard
                      ? 'border-yard-line bg-yard-raised text-yard-accent-strong'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[color:var(--state-info)]'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">{step.icon}</span>
                </span>
                <span className="pt-1 text-[13px] leading-snug">
                  <span className={`mr-1 font-mono text-[11px] font-bold ${yard ? 'text-yard-faint' : 'text-[var(--text-secondary)]'}`}>{index + 1}.</span>
                  {step.text}
                </span>
              </li>
            ))}
          </ol>
        )}

        <div className="mt-5 flex gap-2">
          {mode === 'android-native' ? (
            <>
              <button
                type="button"
                onClick={dismiss}
                className={`flex-1 rounded-xl px-4 py-3 text-[13px] font-bold ${
                  yard ? 'text-yard-muted hover:bg-yard-sunken' : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]'
                }`}
              >
                Ahora no
              </button>
              <button
                type="button"
                onClick={() => { void handleInstall(); }}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-[13px] font-bold ${
                  yard ? 'bg-yard-accent text-yard-accent-ink' : 'bg-[var(--brand-solid)] text-[color:#ffffff]'
                }`}
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">download</span>
                Instalar app
              </button>
            </>
          ) : mode === 'in-app' ? (
            <>
              <button
                type="button"
                onClick={dismiss}
                className={`flex-1 rounded-xl px-4 py-3 text-[13px] font-bold ${
                  yard ? 'text-yard-muted hover:bg-yard-sunken' : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]'
                }`}
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => { void handleCopyLink(); }}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-[13px] font-bold ${
                  yard ? 'bg-yard-accent text-yard-accent-ink' : 'bg-[var(--brand-solid)] text-[color:#ffffff]'
                }`}
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{copied ? 'check' : 'link'}</span>
                {copied ? 'Enlace copiado' : 'Copiar enlace'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={dismiss}
              className={`w-full rounded-xl px-4 py-3 text-[13px] font-bold ${
                yard ? 'bg-yard-accent text-yard-accent-ink' : 'bg-[var(--brand-solid)] text-[color:#ffffff]'
              }`}
            >
              Entendido
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.getElementById('root') ?? document.body);
};
