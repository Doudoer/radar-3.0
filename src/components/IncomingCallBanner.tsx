import React, { useEffect, useState } from 'react';
import { apiFetch } from '../services/apiFetch';

export interface ActiveIncomingCall {
  id: number;
  uniqueid: string;
  direction: 'inbound' | 'outbound' | 'internal';
  status: 'ringing' | 'answered' | 'missed' | 'ended';
  callerNumber: string;
  callerName: string | null;
  ivrLanguage?: string | null;
  destination: string | null;
  queueName?: string | null;
  clientId: number | null;
  clientName: string | null;
  orderId: string | null;
  orderCode: string | null;
  startedAt: string;
}

interface IncomingCallBannerProps {
  onSelectOrder?: (orderId: string) => void;
  onOpenCallLog?: () => void;
  onEnabledChange?: (enabled: boolean) => void;
}

export const IncomingCallBanner: React.FC<IncomingCallBannerProps> = ({
  onSelectOrder,
  onOpenCallLog,
  onEnabledChange,
}) => {
  const [activeCalls, setActiveCalls] = useState<ActiveIncomingCall[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Record<string, boolean>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let closed = false;
    let pollTimer: number | null = null;

    const loadActive = async () => {
      try {
        const res = await apiFetch('/pbx/calls/active');
        if (!res.ok || closed) return;
        const data = await res.json().catch(() => ({}));
        if (!closed && typeof data.enabled === 'boolean') {
          onEnabledChange?.(data.enabled);
        }
        if (!closed && Array.isArray(data.active)) {
          setActiveCalls(data.active);
        }
      } catch {
        // Ignore transient network errors
      }
    };

    void loadActive();

    let source: EventSource | null = null;
    if (typeof EventSource !== 'undefined') {
      source = new EventSource('/api/pbx/stream', { withCredentials: true });
      source.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (typeof parsed.enabled === 'boolean') {
            onEnabledChange?.(parsed.enabled);
          }
          if (Array.isArray(parsed.active)) {
            setActiveCalls(parsed.active);
          }
        } catch {
          // Ignore malformed SSE frames
        }
      };
      source.onerror = () => {
        if (!pollTimer && !closed) {
          pollTimer = window.setInterval(() => {
            void loadActive();
          }, 5000);
        }
      };
    } else {
      pollTimer = window.setInterval(() => {
        void loadActive();
      }, 5000);
    }

    const tick = window.setInterval(() => setNowMs(Date.now()), 1000);

    return () => {
      closed = true;
      source?.close();
      if (pollTimer) window.clearInterval(pollTimer);
      window.clearInterval(tick);
    };
  }, []);

  const visibleCalls = activeCalls.filter((call) => !dismissedIds[call.uniqueid]);
  if (!visibleCalls.length) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[120] flex w-[calc(100vw-2rem)] max-w-md flex-col gap-2.5 sm:bottom-6 sm:right-6"
    >
      {visibleCalls.map((call) => {
        const elapsed = Math.max(0, Math.floor((nowMs - new Date(call.startedAt).getTime()) / 1000));
        return (
          <div
            key={call.uniqueid}
            className="rounded-2xl border border-emerald-500/40 bg-[var(--bg-card)] p-4 shadow-2xl ring-1 ring-emerald-500/20 animate-fade-in"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500">
                  <span aria-hidden="true" className="material-symbols-outlined text-[22px] animate-pulse">
                    call
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-300">
                      Llamada entrante · {elapsed}s
                    </span>
                    {(call.queueName || call.destination) && (
                      <span className="text-[11px] font-mono text-[var(--text-muted)]">
                        {call.queueName ? `Cola ${call.queueName}` : `Ext. ${call.destination}`}
                      </span>
                    )}
                    {call.ivrLanguage && (
                      <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 text-[10px] font-bold text-[var(--text-secondary)]">
                        {call.ivrLanguage}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-sm font-black text-[var(--text-heading)]">
                    {call.clientName || call.callerName || call.callerNumber}
                  </p>
                  <p className="truncate text-xs font-mono text-[var(--text-secondary)]">
                    {call.callerNumber}
                  </p>
                  {call.orderCode && (
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                      Última orden: <span className="font-mono font-bold text-[var(--text-primary)]">{call.orderCode}</span>
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDismissedIds((prev) => ({ ...prev, [call.uniqueid]: true }))}
                aria-label="Ocultar alerta de llamada"
                className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-heading)] cursor-pointer"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            {(call.orderId && onSelectOrder) || onOpenCallLog ? (
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-2.5">
                {onOpenCallLog && (
                  <button
                    type="button"
                    onClick={onOpenCallLog}
                    className="rounded-lg border border-[var(--border-subtle)] px-2.5 py-1 text-[11px] font-bold text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] cursor-pointer"
                  >
                    Ver registro
                  </button>
                )}
                {call.orderId && onSelectOrder && (
                  <button
                    type="button"
                    onClick={() => onSelectOrder(call.orderId!)}
                    className="rounded-lg bg-[var(--brand-solid)] px-3 py-1 text-[11px] font-bold text-white hover:opacity-90 cursor-pointer"
                  >
                    Ver orden {call.orderCode || ''}
                  </button>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
