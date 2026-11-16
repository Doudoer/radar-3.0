import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../services/apiFetch';

interface CallLogRow {
  id: number;
  uniqueid: string;
  direction: 'inbound' | 'outbound' | 'internal';
  status: 'ringing' | 'answered' | 'missed' | 'ended';
  callerNumber: string;
  callerName: string | null;
  ivrLanguage?: string | null;
  destination: string | null;
  queueName?: string | null;
  answeredByExt: string | null;
  rejectedByExts?: string[];
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
  internal: number;
  missed: number;
  answered: number;
  businessHoursCalls: number;
  businessHoursAnswered: number;
  businessHoursMissed: number;
  afterHoursCalls: number;
  totalBillsecSeconds: number;
  avgBillsecSeconds: number;
}

interface DailyAnalyticsRow {
  date: string;
  totalCalls: number;
  inboundCalls: number;
  outboundCalls: number;
  internalCalls: number;
  answeredCalls: number;
  missedCalls: number;
  answerRate: number;
  businessHoursCalls: number;
  businessHoursAnswered: number;
  businessHoursMissed: number;
  afterHoursCalls: number;
  totalBillsecSeconds: number;
  avgBillsecSeconds: number;
  isClosed: boolean;
}

interface EmployeeCallPerformance {
  userId: number | null;
  userName: string;
  pbxExtension: string;
  answeredCount: number;
  rejectedCount: number;
  totalTalkSeconds: number;
  avgTalkSeconds: number;
}

interface ExtensionPresenceEvent {
  status: 'online' | 'offline';
  reason: string | null;
  occurredAt: string;
}

interface ExtensionPresenceRow {
  extension: string;
  userId: number | null;
  userName: string;
  liveStatus: 'online' | 'offline' | 'in_call' | 'unknown';
  firstConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  connectedWorkdaySeconds: number;
  workdayElapsedSeconds: number;
  availabilityPct: number;
  events: ExtensionPresenceEvent[];
}

interface CallsLogViewProps {
  onSelectOrder?: (orderId: string) => void;
}

const VENEZUELA_TZ = 'America/Caracas';

const getBusinessToday = (): string => new Intl.DateTimeFormat('en-CA', {
  timeZone: VENEZUELA_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const formatDuration = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds || 0));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return mins > 0 ? `${mins}m ${String(rem).padStart(2, '0')}s` : `${rem}s`;
};

const formatHoursMins = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${String(mins).padStart(2, '0')}m`;
  return `${mins}m`;
};

const formatTimeOnly = (iso: string | null): string => {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('es-VE', {
      timeZone: VENEZUELA_TZ,
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
};

const formatDateTime = (iso: string): string => {
  try {
    return new Intl.DateTimeFormat('es-VE', {
      timeZone: VENEZUELA_TZ,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
};

const formatDayLabel = (dateStr: string): string => {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Intl.DateTimeFormat('es-ES', {
      timeZone: 'UTC',
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(Date.UTC(y, m - 1, d)));
  } catch {
    return dateStr;
  }
};

const EMPTY_SUMMARY: CallSummary = {
  total: 0,
  inbound: 0,
  outbound: 0,
  internal: 0,
  missed: 0,
  answered: 0,
  businessHoursCalls: 0,
  businessHoursAnswered: 0,
  businessHoursMissed: 0,
  afterHoursCalls: 0,
  totalBillsecSeconds: 0,
  avgBillsecSeconds: 0,
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
  const [tab, setTab] = useState<'daily' | 'analytics'>('daily');
  const [selectedDate, setSelectedDate] = useState<string>(() => getBusinessToday());
  const [todayDate, setTodayDate] = useState<string>(() => getBusinessToday());
  const [calls, setCalls] = useState<CallLogRow[]>([]);
  const [summary, setSummary] = useState<CallSummary>(EMPTY_SUMMARY);
  const [direction, setDirection] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [analyticsDays, setAnalyticsDays] = useState<DailyAnalyticsRow[]>([]);
  const [employeePerformance, setEmployeePerformance] = useState<EmployeeCallPerformance[]>([]);
  const [extensionUsers, setExtensionUsers] = useState<Record<string, string>>({});
  const [presenceExtensions, setPresenceExtensions] = useState<ExtensionPresenceRow[]>([]);
  const [expandedPresenceExt, setExpandedPresenceExt] = useState<string | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const loadCalls = useCallback(async (dateOverride?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('date', dateOverride || selectedDate);
      if (direction) params.set('direction', direction);
      if (status) params.set('status', status);
      if (search.trim()) params.set('search', search.trim());
      params.set('limit', '150');

      const res = await apiFetch(`/pbx/calls?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'No se pudo cargar el registro de llamadas.');
      setCalls(Array.isArray(data.calls) ? data.calls : []);
      if (data.summary) setSummary({ ...EMPTY_SUMMARY, ...data.summary });
      if (data.extensionUsers && typeof data.extensionUsers === 'object') {
        setExtensionUsers(data.extensionUsers);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar llamadas.');
    } finally {
      setLoading(false);
    }
  }, [selectedDate, direction, status, search]);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const res = await apiFetch('/pbx/analytics?days=30');
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.days)) {
        setAnalyticsDays(data.days);
        if (Array.isArray(data.employeePerformance)) {
          setEmployeePerformance(data.employeePerformance);
        }
        if (typeof data.today === 'string') setTodayDate(data.today);
      }
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  const loadPresence = useCallback(async (dateOverride?: string) => {
    try {
      const res = await apiFetch(`/pbx/presence?date=${encodeURIComponent(dateOverride || selectedDate)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.extensions)) {
        setPresenceExtensions(data.extensions);
      }
    } catch {
      // Ignore transient errors
    }
  }, [selectedDate]);

  useEffect(() => {
    void loadCalls();
    void loadPresence();
  }, [loadCalls, loadPresence]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadPresence();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [loadPresence]);

  useEffect(() => {
    if (tab === 'analytics') {
      void loadAnalytics();
    }
  }, [tab, loadAnalytics]);

  // Auto-rollover at 12:00 AM Eastern Time if the tab stays open overnight
  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = getBusinessToday();
      if (current !== todayDate) {
        const wasOnPreviousToday = selectedDate === todayDate;
        setTodayDate(current);
        if (wasOnPreviousToday) {
          setSelectedDate(current);
        }
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [todayDate, selectedDate]);

  const analyticsTotals = useMemo(() => {
    const total = analyticsDays.reduce((acc, d) => acc + d.totalCalls, 0);
    const answered = analyticsDays.reduce((acc, d) => acc + d.answeredCalls, 0);
    const bhTotal = analyticsDays.reduce((acc, d) => acc + d.businessHoursCalls, 0);
    const bhAnswered = analyticsDays.reduce((acc, d) => acc + d.businessHoursAnswered, 0);
    const totalSec = analyticsDays.reduce((acc, d) => acc + d.totalBillsecSeconds, 0);
    return {
      activeDays: analyticsDays.filter((d) => d.totalCalls > 0).length,
      total,
      answerRate: total > 0 ? Math.round((answered / total) * 100) : 0,
      bhAnswerRate: bhTotal > 0 ? Math.round((bhAnswered / bhTotal) * 100) : 0,
      avgDuration: answered > 0 ? Math.round(totalSec / answered) : 0,
    };
  }, [analyticsDays]);

  const isViewingToday = selectedDate === todayDate;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-[var(--text-heading)]">Registro de Llamadas (Issabel PBX)</h1>
          <p className="text-xs text-[var(--text-muted)]">
            Registro diario con corte automático a las 12:00 AM (Venezuela) · Horario de atención: 7:00 AM – 6:00 PM.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-1">
            <button
              type="button"
              onClick={() => setTab('daily')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                tab === 'daily'
                  ? 'bg-[var(--brand-solid)] text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]'
              }`}
            >
              Registro del día
            </button>
            <button
              type="button"
              onClick={() => setTab('analytics')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                tab === 'analytics'
                  ? 'bg-[var(--brand-solid)] text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]'
              }`}
            >
              Historial y Analíticas Diarias
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              if (tab === 'daily') {
                void loadCalls();
                void loadPresence();
              } else {
                void loadAnalytics();
                void loadPresence();
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] cursor-pointer"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">refresh</span>
            Actualizar
          </button>
        </div>
      </div>

      {tab === 'daily' ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                isViewingToday
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'bg-slate-500/15 text-slate-700 dark:text-slate-300'
              }`}>
                {isViewingToday ? 'Día actual (en curso)' : 'Día cerrado (historial)'}
              </span>
              <span className="text-xs font-semibold text-[var(--text-heading)]">
                {formatDayLabel(selectedDate)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="date"
                aria-label="Seleccionar fecha de llamadas"
                value={selectedDate}
                max={todayDate}
                onChange={(e) => {
                  if (e.target.value) setSelectedDate(e.target.value);
                }}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] outline-none"
              />
              {!isViewingToday && (
                <button
                  type="button"
                  onClick={() => setSelectedDate(todayDate)}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-bold text-[var(--brand-solid)] hover:bg-[var(--bg-card)] cursor-pointer"
                >
                  Ir a Hoy
                </button>
              )}
            </div>
          </div>

          {presenceExtensions.length > 0 && (
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Estado de Extensiones (En vivo · Jornada 7 AM – 6 PM)
                </span>
                <button
                  type="button"
                  onClick={() => setTab('analytics')}
                  className="text-[11px] font-bold text-[var(--brand-solid)] hover:underline cursor-pointer"
                >
                  Ver historial completo
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {presenceExtensions.filter((e) => e.userId !== null || e.liveStatus !== 'unknown').map((ext) => {
                  const dotClass = ext.liveStatus === 'in_call'
                    ? 'bg-amber-500'
                    : ext.liveStatus === 'online'
                      ? 'bg-emerald-500'
                      : ext.liveStatus === 'offline'
                        ? 'bg-rose-500'
                        : 'bg-slate-400';
                  const statusLabel = ext.liveStatus === 'in_call'
                    ? 'En llamada'
                    : ext.liveStatus === 'online'
                      ? 'Conectada'
                      : ext.liveStatus === 'offline'
                        ? 'Desconectada'
                        : 'Sin datos';
                  return (
                    <div
                      key={ext.extension}
                      title={`${ext.userName} (Ext. ${ext.extension}) · ${statusLabel} · ${formatHoursMins(ext.connectedWorkdaySeconds)} conectado hoy`}
                      className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs"
                    >
                      <span className={`h-2 w-2 rounded-full ${dotClass}`} />
                      <span className="font-mono font-bold text-[var(--text-heading)]">{ext.extension}</span>
                      {ext.userId !== null && (
                        <span className="text-[11px] font-semibold text-[var(--text-secondary)]">{ext.userName}</span>
                      )}
                      <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
                        {formatHoursMins(ext.connectedWorkdaySeconds)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Total del día</p>
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

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2 text-[11px] text-[var(--text-secondary)]">
            <span>
              <strong>Horario 7:00 AM – 6:00 PM:</strong> {summary.businessHoursCalls} llamadas ({summary.businessHoursAnswered} contestadas · {summary.businessHoursMissed} perdidas)
            </span>
            <span>
              <strong>Fuera de horario:</strong> {summary.afterHoursCalls} · <strong>Promedio hablado:</strong> {formatDuration(summary.avgBillsecSeconds)}
            </span>
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
                        No hay llamadas registradas para {formatDayLabel(selectedDate)}.
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
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="font-bold text-[var(--text-heading)]">
                                {call.clientName || call.callerName || call.callerNumber}
                              </p>
                              {call.ivrLanguage && (
                                <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 text-[10px] font-bold text-[var(--text-secondary)]">
                                  {call.ivrLanguage}
                                </span>
                              )}
                            </div>
                            <p className="font-mono text-[11px] text-[var(--text-muted)]">{call.callerNumber}</p>
                          </td>
                          <td className="px-4 py-3 font-mono text-[var(--text-secondary)]">
                            {call.status === 'missed' || call.status === 'ringing' ? (
                              <span>{call.queueName ? `Cola ${call.queueName}` : (call.destination || '—')}</span>
                            ) : (
                              <div>
                                <span className="font-bold text-[var(--text-heading)]">
                                  {call.answeredByExt
                                    ? `Ext. ${call.answeredByExt}${extensionUsers[call.answeredByExt] ? ` · ${extensionUsers[call.answeredByExt]}` : ''}`
                                    : (call.queueName ? `Cola ${call.queueName}` : call.destination || '—')}
                                </span>
                                {call.queueName && call.answeredByExt && (
                                  <p className="text-[10px] text-[var(--text-muted)]">Cola {call.queueName}</p>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex flex-col items-start gap-1">
                              <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10.5px] font-bold ${badge.className}`}>
                                {badge.label}
                              </span>
                              {Array.isArray(call.rejectedByExts) && call.rejectedByExts.length > 0 && (
                                <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                                  Rechazó: {call.rejectedByExts.map((ext) => extensionUsers[ext] ? `${ext} (${extensionUsers[ext]})` : ext).join(', ')}
                                </span>
                              )}
                            </div>
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
        </>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Días con actividad</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-[var(--text-heading)]">{analyticsTotals.activeDays}</p>
            </div>
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Llamadas (30 días)</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-cyan-600 dark:text-cyan-400">{analyticsTotals.total}</p>
            </div>
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Atención 7AM–6PM</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-emerald-600 dark:text-emerald-400">{analyticsTotals.bhAnswerRate}%</p>
            </div>
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Duración promedio</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-[var(--text-heading)]">{formatDuration(analyticsTotals.avgDuration)}</p>
            </div>
          </div>

          {presenceExtensions.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2.5">
                <h2 className="text-xs font-black uppercase tracking-wider text-[var(--text-heading)]">
                  Conexión y Jornada Laboral (7:00 AM – 6:00 PM · {formatDayLabel(selectedDate)})
                </h2>
                <span className="text-[11px] text-[var(--text-muted)]">
                  Haz clic en una extensión para ver su historial de conexión/desconexión
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[var(--border-subtle)] text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    <tr>
                      <th className="px-4 py-2.5">Asesor</th>
                      <th className="px-4 py-2.5">Extensión</th>
                      <th className="px-4 py-2.5">Estado</th>
                      <th className="px-4 py-2.5">1ra Conexión</th>
                      <th className="px-4 py-2.5">Últ. Desconexión</th>
                      <th className="px-4 py-2.5">Tiempo conectado</th>
                      <th className="px-4 py-2.5 text-right">Eventos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {presenceExtensions.map((ext) => {
                      const isExpanded = expandedPresenceExt === ext.extension;
                      const badge = ext.liveStatus === 'in_call'
                        ? { label: 'En llamada', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30' }
                        : ext.liveStatus === 'online'
                          ? { label: 'Conectada', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' }
                          : ext.liveStatus === 'offline'
                            ? { label: 'Desconectada', cls: 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/30' }
                            : { label: 'Sin datos', cls: 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30' };
                      return (
                        <React.Fragment key={ext.extension}>
                          <tr
                            onClick={() => setExpandedPresenceExt(isExpanded ? null : ext.extension)}
                            className="cursor-pointer hover:bg-[var(--bg-surface)]/50"
                          >
                            <td className="px-4 py-2.5 font-bold text-[var(--text-heading)]">{ext.userName}</td>
                            <td className="px-4 py-2.5 font-mono text-[var(--text-secondary)]">Ext. {ext.extension}</td>
                            <td className="px-4 py-2.5">
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>
                                {badge.label}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-[var(--text-secondary)]">{formatTimeOnly(ext.firstConnectedAt)}</td>
                            <td className="px-4 py-2.5 font-mono text-[var(--text-secondary)]">{formatTimeOnly(ext.lastDisconnectedAt)}</td>
                            <td className="px-4 py-2.5 font-mono font-bold text-[var(--text-heading)]">
                              {formatHoursMins(ext.connectedWorkdaySeconds)}
                              {ext.workdayElapsedSeconds > 0 && (
                                <span className="ml-1.5 text-[10.5px] font-normal text-[var(--text-muted)]">
                                  ({ext.availabilityPct}%)
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-[var(--brand-solid)]">
                              {ext.events.length} {isExpanded ? '▲' : '▼'}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-[var(--bg-surface)]/60">
                              <td colSpan={7} className="px-4 py-3">
                                {ext.events.length === 0 ? (
                                  <p className="text-[11px] text-[var(--text-muted)]">
                                    Sin cambios de conexión registrados en este día todavía.
                                  </p>
                                ) : (
                                  <div className="flex flex-wrap gap-2">
                                    {ext.events.map((ev, idx) => (
                                      <span
                                        key={`${ev.occurredAt}-${idx}`}
                                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-mono ${
                                          ev.status === 'online'
                                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                            : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                                        }`}
                                      >
                                        <span className="font-bold">{formatTimeOnly(ev.occurredAt)}</span>
                                        <span>{ev.status === 'online' ? 'Conectó' : 'Desconectó'}</span>
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {employeePerformance.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
              <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2.5">
                <h2 className="text-xs font-black uppercase tracking-wider text-[var(--text-heading)]">
                  Rendimiento por Asesor (PBX · Últimos 30 días)
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[var(--border-subtle)] text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    <tr>
                      <th className="px-4 py-2.5">Asesor</th>
                      <th className="px-4 py-2.5">Extensión</th>
                      <th className="px-4 py-2.5">Contestadas</th>
                      <th className="px-4 py-2.5">Rechazadas</th>
                      <th className="px-4 py-2.5">Tiempo total</th>
                      <th className="px-4 py-2.5 text-right">Prom. conversación</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {employeePerformance.map((emp) => (
                      <tr key={emp.pbxExtension} className="hover:bg-[var(--bg-surface)]/50">
                        <td className="px-4 py-2.5 font-bold text-[var(--text-heading)]">{emp.userName}</td>
                        <td className="px-4 py-2.5 font-mono text-[var(--text-secondary)]">Ext. {emp.pbxExtension}</td>
                        <td className="px-4 py-2.5 font-mono font-bold text-emerald-600 dark:text-emerald-400">{emp.answeredCount}</td>
                        <td className="px-4 py-2.5 font-mono font-bold text-amber-600 dark:text-amber-400">{emp.rejectedCount}</td>
                        <td className="px-4 py-2.5 font-mono text-[var(--text-secondary)]">{formatDuration(emp.totalTalkSeconds)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-[var(--text-secondary)]">{formatDuration(emp.avgTalkSeconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  <tr>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3">Total</th>
                    <th className="px-4 py-3">Entrantes</th>
                    <th className="px-4 py-3">Salientes</th>
                    <th className="px-4 py-3">Contestadas</th>
                    <th className="px-4 py-3">Perdidas</th>
                    <th className="px-4 py-3">7AM–6PM</th>
                    <th className="px-4 py-3">Fuera horario</th>
                    <th className="px-4 py-3">Prom.</th>
                    <th className="px-4 py-3 text-right">Cierre</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {analyticsLoading && !analyticsDays.length ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-[var(--text-muted)]">
                        Cargando analíticas diarias…
                      </td>
                    </tr>
                  ) : !analyticsDays.length ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-[var(--text-muted)]">
                        Aún no hay historial diario registrado.
                      </td>
                    </tr>
                  ) : (
                    analyticsDays.map((day) => (
                      <tr
                        key={day.date}
                        onClick={() => {
                          setSelectedDate(day.date);
                          setTab('daily');
                        }}
                        className="cursor-pointer hover:bg-[var(--bg-surface)]/70"
                      >
                        <td className="px-4 py-3 font-bold text-[var(--text-heading)] whitespace-nowrap">
                          {formatDayLabel(day.date)}
                        </td>
                        <td className="px-4 py-3 font-mono font-bold tabular-nums">{day.totalCalls}</td>
                        <td className="px-4 py-3 font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{day.inboundCalls}</td>
                        <td className="px-4 py-3 font-mono tabular-nums text-cyan-600 dark:text-cyan-400">{day.outboundCalls}</td>
                        <td className="px-4 py-3 font-mono tabular-nums">{day.answeredCalls} ({day.answerRate}%)</td>
                        <td className="px-4 py-3 font-mono tabular-nums text-rose-600 dark:text-rose-400">{day.missedCalls}</td>
                        <td className="px-4 py-3 font-mono tabular-nums">{day.businessHoursCalls}</td>
                        <td className="px-4 py-3 font-mono tabular-nums text-[var(--text-muted)]">{day.afterHoursCalls}</td>
                        <td className="px-4 py-3 font-mono tabular-nums">{formatDuration(day.avgBillsecSeconds)}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                            day.isClosed
                              ? 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30'
                              : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30'
                          }`}>
                            {day.isClosed ? 'Guardado 12 AM' : 'En curso'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
