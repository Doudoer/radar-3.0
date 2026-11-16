import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../services/apiFetch';

interface CallLogRow {
  id: number;
  uniqueid: string;
  direction: 'inbound' | 'outbound' | 'internal';
  status: 'ringing' | 'answered' | 'missed' | 'ended';
  callerNumber: string;
  callerName: string | null;
  destination: string | null;
  answeredByExt: string | null;
  clientId: number | null;
  clientName: string | null;
  orderId: string | null;
  orderCode: string | null;
  durationSeconds: number;
  billsecSeconds: number;
  startedAt: string;
}

interface CallSummary {
  total: number;
  inbound: number;
  outbound: number;
  missed: number;
  answered: number;
}

interface CallsLogViewProps {
  onSelectOrder?: (orderId: string) => void;
}

const formatDuration = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds || 0));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return mins > 0 ? `${mins}m ${String(rem).padStart(2, '0')}s` : `${rem}s`;
};

const formatDateTime = (iso: string): string => {
  try {
    return new Intl.DateTimeFormat('es-HN', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
};

const STATUS_BADGE: Record<CallLogRow['status'], { label: string; className: string }> = {
  ringing: { label: 'Sonando', className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30' },
  answered: { label: 'Contestada', className: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30' },
  ended: { label: 'Finalizada', className: 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30' },
  missed: { label: 'Perdida', className: 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/30' },
};

const DIRECTION_LABEL: Record<CallLogRow['direction'], { label: string; icon: string }> = {
  inbound: { label: 'Entrante', icon: 'call_received' },
  outbound: { label: 'Saliente', icon: 'call_made' },
  internal: { label: 'Interna', icon: 'call_split' },
};

export const CallsLogView: React.FC<CallsLogViewProps> = ({ onSelectOrder }) => {
  const [calls, setCalls] = useState<CallLogRow[]>([]);
  const [summary, setSummary] = useState<CallSummary>({ total: 0, inbound: 0, outbound: 0, missed: 0, answered: 0 });
  const [direction, setDirection] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCalls = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (direction) params.set('direction', direction);
      if (status) params.set('status', status);
      if (search.trim()) params.set('search', search.trim());
      params.set('limit', '120');

      const res = await apiFetch(`/pbx/calls?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'No se pudo cargar el registro de llamadas.');
      setCalls(Array.isArray(data.calls) ? data.calls : []);
      if (data.summary) setSummary(data.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar llamadas.');
    } finally {
      setLoading(false);
    }
  }, [direction, status, search]);

  useEffect(() => {
    void loadCalls();
  }, [loadCalls]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-[var(--text-heading)]">Registro de Llamadas (Issabel PBX)</h1>
          <p className="text-xs text-[var(--text-muted)]">
            Monitoreo pasivo de llamadas entrantes, salientes y perdidas. Tus asesores siguen atendiendo desde PortSIP.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void loadCalls(); }}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] cursor-pointer"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">refresh</span>
          Actualizar
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Total registradas</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-[var(--text-heading)]">{summary.total}</p>
        </div>
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Entrantes</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-emerald-600 dark:text-emerald-400">{summary.inbound}</p>
        </div>
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Salientes</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-cyan-600 dark:text-cyan-400">{summary.outbound}</p>
        </div>
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Perdidas</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-rose-600 dark:text-rose-400">{summary.missed}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar número, cliente o extensión…"
          className="min-w-[200px] flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--brand-solid)]"
        />
        <select
          aria-label="Filtrar por dirección"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
        >
          <option value="">Todas las direcciones</option>
          <option value="inbound">Entrantes</option>
          <option value="outbound">Salientes</option>
          <option value="internal">Internas</option>
        </select>
        <select
          aria-label="Filtrar por estado"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
        >
          <option value="">Todos los estados</option>
          <option value="ringing">Sonando</option>
          <option value="answered">Contestadas</option>
          <option value="missed">Perdidas</option>
          <option value="ended">Finalizadas</option>
        </select>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Número / Cliente</th>
                <th className="px-4 py-3">Extensión / Destino</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Duración</th>
                <th className="px-4 py-3">Fecha y hora</th>
                <th className="px-4 py-3 text-right">Orden</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {loading && !calls.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Cargando registro de llamadas…
                  </td>
                </tr>
              ) : !calls.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Aún no hay llamadas registradas desde Issabel PBX.
                  </td>
                </tr>
              ) : (
                calls.map((call) => {
                  const dir = DIRECTION_LABEL[call.direction] || DIRECTION_LABEL.inbound;
                  const badge = STATUS_BADGE[call.status] || STATUS_BADGE.ended;
                  return (
                    <tr key={call.uniqueid} className="hover:bg-[var(--bg-surface)]/60">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 font-bold text-[var(--text-heading)]">
                          <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-[var(--brand-solid)]">
                            {dir.icon}
                          </span>
                          {dir.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-bold text-[var(--text-heading)]">
                          {call.clientName || call.callerName || call.callerNumber}
                        </p>
                        <p className="font-mono text-[11px] text-[var(--text-muted)]">{call.callerNumber}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-[var(--text-secondary)]">
                        {call.answeredByExt || call.destination || '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10.5px] font-bold ${badge.className}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-[var(--text-secondary)]">
                        {call.status === 'answered' && !call.billsecSeconds && !call.durationSeconds
                          ? 'En curso'
                          : formatDuration(call.billsecSeconds || call.durationSeconds)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-[var(--text-muted)]">
                        {formatDateTime(call.startedAt)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {call.orderId && onSelectOrder ? (
                          <button
                            type="button"
                            onClick={() => onSelectOrder(call.orderId!)}
                            className="rounded-lg border border-[var(--border-subtle)] px-2.5 py-1 text-[11px] font-mono font-bold text-[var(--brand-solid)] hover:bg-[var(--bg-surface)] cursor-pointer"
                          >
                            {call.orderCode || 'Abrir'}
                          </button>
                        ) : (
                          <span className="text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
