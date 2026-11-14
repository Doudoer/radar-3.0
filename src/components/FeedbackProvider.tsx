import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useDialogAccessibility } from '../hooks/useDialogAccessibility';

export type ToastTone = 'success' | 'info' | 'error';

export interface ToastOptions {
  title: string;
  message?: string;
  tone?: ToastTone;
  duration?: number;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  requireText?: string;
}

interface ToastItem {
  id: number;
  title: string;
  message?: string;
  tone: ToastTone;
}

interface ConfirmState {
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
}

interface FeedbackApi {
  toast: (options: ToastOptions | string) => void;
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
}

let toastSequence = 0;

const missingProviderFallback: FeedbackApi = {
  toast: () => {},
  confirm: async () => false,
};

const FeedbackContext = createContext<FeedbackApi>(missingProviderFallback);

export const useFeedback = (): FeedbackApi => useContext(FeedbackContext);

const TOAST_ICONS: Record<ToastTone, string> = {
  success: 'check_circle',
  info: 'info',
  error: 'error',
};

const toastToneClasses: Record<ToastTone, string> = {
  success: 'border-[color:var(--state-success)]/45 bg-[var(--bg-card)] text-[var(--text-primary)]',
  info: 'border-[color:var(--state-info)]/45 bg-[var(--bg-card)] text-[var(--text-primary)]',
  error: 'border-[color:var(--state-urgency-border)] bg-[var(--state-urgency-tint)] text-[var(--text-primary)]',
};

const toastIconClasses: Record<ToastTone, string> = {
  success: 'text-[color:var(--state-success)]',
  info: 'text-[color:var(--state-info)]',
  error: 'text-[color:var(--state-urgency-text)]',
};

const ConfirmDialog: React.FC<{ state: ConfirmState; onResolve: (confirmed: boolean) => void }> = ({ state, onResolve }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { options } = state;
  const [typedValue, setTypedValue] = useState('');
  const requiresTyping = Boolean(options.requireText);
  const typedMatches = !requiresTyping || typedValue.trim() === options.requireText;

  useDialogAccessibility({ open: true, dialogRef, onEscape: () => onResolve(false) });

  useEffect(() => {
    const target = requiresTyping ? inputRef.current : dialogRef.current?.querySelector<HTMLButtonElement>('[data-confirm-cancel]');
    target?.focus({ preventScroll: true });
  }, [requiresTyping]);

  return (
    <div className="horizon-modal fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="radar-confirm-title"
        aria-describedby={options.message ? 'radar-confirm-message' : undefined}
        tabIndex={-1}
        className="w-full max-w-md overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-[0_24px_80px_rgba(0,0,0,0.55)] outline-none"
      >
        <div className="flex items-start gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
          <span
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
              options.tone === 'danger'
                ? 'border-[color:var(--state-urgency-border)] bg-[var(--state-urgency-tint)] text-[color:var(--state-urgency-text)]'
                : 'border-[color:var(--state-info)]/40 bg-[color:var(--state-info)]/10 text-[color:var(--state-info)]'
            }`}
          >
            <Icon name={options.tone === 'danger' ? 'warning' : 'help'} size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="radar-confirm-title" className="text-sm font-bold leading-snug">{options.title}</h2>
            {options.message && (
              <p id="radar-confirm-message" className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{options.message}</p>
            )}
          </div>
        </div>

        {requiresTyping && (
          <div className="border-b border-[var(--border-subtle)] px-5 py-4">
            <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]" htmlFor="radar-confirm-typed">
              Escribe <span className="font-mono text-[var(--text-primary)]">{options.requireText}</span> para confirmar
            </label>
            <input
              ref={inputRef}
              id="radar-confirm-typed"
              value={typedValue}
              onChange={(event) => setTypedValue(event.target.value)}
              autoComplete="off"
              className="mt-2 w-full rounded-xl border border-[var(--input-border)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-sm text-[var(--text-primary)] outline-none focus:border-[color:var(--state-info)] focus:ring-2 focus:ring-[color:var(--state-info)]/30"
            />
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            data-confirm-cancel
            onClick={() => onResolve(false)}
            className="h-10 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 text-xs font-bold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] cursor-pointer"
          >
            {options.cancelLabel || 'Cancelar'}
          </button>
          <button
            type="button"
            data-confirm-primary
            disabled={!typedMatches}
            onClick={() => onResolve(true)}
            className={`h-10 rounded-xl px-4 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer ${
              options.tone === 'danger'
                ? 'border border-[color:var(--state-urgency-border)] bg-[var(--state-urgency-tint)] text-[color:var(--state-urgency-text)] hover:brightness-95'
                : 'bg-[var(--brand-solid)] text-white hover:brightness-110'
            }`}
          >
            {options.confirmLabel || 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
};

export const FeedbackProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const timers = useRef(new Map<number, number>());

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback((input: ToastOptions | string) => {
    const options = typeof input === 'string' ? { title: input } : input;
    const tone = options.tone || 'success';
    const id = ++toastSequence;
    setToasts((current) => [...current.slice(-3), { id, title: options.title, message: options.message, tone }]);
    const sticky = tone === 'error' || options.duration === 0;
    if (!sticky) {
      const duration = options.duration ?? 4000;
      timers.current.set(id, window.setTimeout(() => dismissToast(id), duration));
    }
  }, [dismissToast]);

  const confirm = useCallback((input: ConfirmOptions | string) => {
    const options = typeof input === 'string' ? { title: input } : input;
    return new Promise<boolean>((resolve) => {
      setConfirmState((current) => {
        current?.resolve(false);
        return { options, resolve };
      });
    });
  }, []);

  const resolveConfirm = useCallback((confirmed: boolean) => {
    setConfirmState((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }, []);

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
  }, []);

  const api = useMemo<FeedbackApi>(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <FeedbackContext.Provider value={api}>
      {children}

      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[125] flex w-[min(380px,calc(100vw-24px))] flex-col gap-2 xl:right-16"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-[0_16px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl ${toastToneClasses[item.tone]}`}
          >
            <span className={`mt-0.5 shrink-0 ${toastIconClasses[item.tone]}`}>
              <Icon name={TOAST_ICONS[item.tone]} size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold leading-snug">{item.title}</p>
              {item.message && <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">{item.message}</p>}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(item.id)}
              aria-label="Cerrar notificación"
              className="shrink-0 rounded-lg p-1 text-[var(--text-secondary)] transition hover:bg-black/10 hover:text-[var(--text-primary)] cursor-pointer"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
      </div>

      {confirmState && <ConfirmDialog state={confirmState} onResolve={resolveConfirm} />}
    </FeedbackContext.Provider>
  );
};
