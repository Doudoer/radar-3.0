import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../services/apiFetch';

interface CallQaChecklistItem {
  passed: boolean | null;
  note: string;
}

interface CallQaResult {
  verdict: 'correcta' | 'incorrecta';
  score: number;
  summary: string;
  failureReasons: string[];
  checklist: {
    officialGreeting: CallQaChecklistItem;
    askedNeed: CallQaChecklistItem;
    realInventorySearch: CallQaChecklistItem;
    priceAndMilesIfAvailable: CallQaChecklistItem;
    courteousGoodbye: CallQaChecklistItem;
  };
  transcript: string;
  model?: string;
}

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
  recordingUrl?: string | null;
  recordingMimeType?: string | null;
  recordingUploadedAt?: string | null;
  qaStatus?: 'pending' | 'correct' | 'incorrect' | 'error' | null;
  qaScore?: number | null;
  qaResult?: CallQaResult | null;
  qaAnalyzedAt?: string | null;
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
  mobileAppMode?: boolean;
  activeTab?: 'daily' | 'analytics';
  onTabChange?: (tab: 'daily' | 'analytics') => void;
  refreshTick?: number;
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

export const CallsLogView: React.FC<CallsLogViewProps> = ({
  onSelectOrder,
  mobileAppMode = false,
  activeTab,
  onTabChange,
  refreshTick = 0,
}) => {
  const [internalTab, setInternalTab] = useState<'daily' | 'analytics'>('daily');
  const tab = activeTab ?? internalTab;
  const setTab = useCallback((next: 'daily' | 'analytics') => {
    setInternalTab(next);
    onTabChange?.(next);
  }, [onTabChange]);
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
  const [uploadingUniqueId, setUploadingUniqueId] = useState<string | null>(null);
  const [analyzingUniqueId, setAnalyzingUniqueId] = useState<string | null>(null);
  const [qaModalCall, setQaModalCall] = useState<CallLogRow | null>(null);
  const [qaActionError, setQaActionError] = useState<string | null>(null);

  const readFileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo de audio.'));
    reader.readAsDataURL(file);
  });

  const patchCallInList = (updated: CallLogRow) => {
    setCalls((prev) => prev.map((item) => (item.uniqueid === updated.uniqueid ? { ...item, ...updated } : item)));
    setQaModalCall((prev) => (prev && prev.uniqueid === updated.uniqueid ? { ...prev, ...updated } : prev));
  };

  const handleUploadCallAudio = async (call: CallLogRow, file: File) => {
    setUploadingUniqueId(call.uniqueid);
    setQaActionError(null);
    try {
      const base64 = await readFileAsDataUrl(file);
      const res = await apiFetch(`/pbx/calls/${encodeURIComponent(call.uniqueid)}/recording`, {
        method: 'POST',
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || undefined,
          base64,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || 'No se pudo subir o analizar el audio.');
      }
      if (data.call) {
        patchCallInList(data.call);
        if (data.call.qaStatus === 'incorrect') {
          setQaModalCall(data.call);
        }
      }
      if (data.qaError) {
        setQaActionError(String(data.qaError));
      }
    } catch (err) {
      setQaActionError(err instanceof Error ? err.message : 'Error al subir el audio.');
    } finally {
      setUploadingUniqueId(null);
    }
  };

  const handleReanalyzeCall = async (call: CallLogRow) => {
    setAnalyzingUniqueId(call.uniqueid);
    setQaActionError(null);
    try {
      const res = await apiFetch(`/pbx/calls/${encodeURIComponent(call.uniqueid)}/qa`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || 'No se pudo analizar el audio con Gemini.');
      }
      if (data.call) {
        patchCallInList(data.call);
        if (data.call.qaStatus === 'incorrect') {
          setQaModalCall(data.call);
        }
      }
      if (data.qaError) {
        setQaActionError(String(data.qaError));
      }
    } catch (err) {
      setQaActionError(err instanceof Error ? err.message : 'Error al analizar con IA.');
    } finally {
      setAnalyzingUniqueId(null);
    }
  };

  const renderAudioQaControls = (call: CallLogRow, compact = false) => {
    const isBusy = uploadingUniqueId === call.uniqueid || analyzingUniqueId === call.uniqueid;
    const inputId = `call-audio-${compact ? 'm' : 'd'}-${call.uniqueid.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    return (
      <div className={compact ? 'mt-2 space-y-1.5' : 'flex flex-col gap-1.5 min-w-[210px]'}>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            id={inputId}
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void handleUploadCallAudio(call, file);
            }}
          />
          <label
            htmlFor={inputId}
            className={`inline-flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-[10.5px] font-bold text-[var(--text-secondary)] hover:text-[var(--text-heading)] cursor-pointer transition ${
              isBusy ? 'opacity-50 pointer-events-none' : ''
            }`}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
              {isBusy ? 'hourglass_top' : call.recordingUrl ? 'swap_horiz' : 'upload_file'}
            </span>
            <span>{isBusy ? 'Analizando…' : call.recordingUrl ? 'Otro audio' : 'Subir audio'}</span>
          </label>

          {call.qaStatus === 'correct' && (
            <button
              type="button"
              onClick={() => setQaModalCall(call)}
              className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 cursor-pointer"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[13px]">check_circle</span>
              <span>Correcta {call.qaScore != null ? `(${call.qaScore}%)` : ''}</span>
            </button>
          )}

          {call.qaStatus === 'incorrect' && (
            <button
              type="button"
              onClick={() => setQaModalCall(call)}
              className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-300 cursor-pointer animate-pulse"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[13px]">warning</span>
              <span>No correcta {call.qaScore != null ? `(${call.qaScore}%)` : ''}</span>
            </button>
          )}

          {call.recordingUrl && (call.qaStatus === 'error' || call.qaStatus === 'pending' || !call.qaStatus) && !isBusy && (
            <button
              type="button"
              onClick={() => { void handleReanalyzeCall(call); }}
              className="inline-flex items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300 cursor-pointer"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[13px]">psychology</span>
              <span>{call.qaStatus === 'error' ? 'Reintentar IA' : 'Analizar IA'}</span>
            </button>
          )}
        </div>

        {call.recordingUrl && (
          <audio
            controls
            preload="none"
            src={call.recordingUrl}
            className="h-8 w-full max-w-[260px]"
          />
        )}
      </div>
    );
  };

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

  useEffect(() => {
    if (!refreshTick) return;
    if (tab === 'daily') {
      void loadCalls();
      void loadPresence();
    } else {
      void loadAnalytics();
      void loadPresence();
    }
  }, [refreshTick, tab, loadCalls, loadPresence, loadAnalytics]);

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
    <div className={mobileAppMode ? 'space-y-3' : 'space-y-4'}>
      {!mobileAppMode && (
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
      )}

      {tab === 'daily' ? (
        <>
          {mobileAppMode ? (
            <div className="flex items-center justify-between gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0 ${
                  isViewingToday
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'bg-slate-500/15 text-slate-700 dark:text-slate-300'
                }`}>
                  {isViewingToday ? 'Hoy' : 'Historial'}
                </span>
                <span className="text-xs font-bold text-[var(--text-heading)] truncate">
                  {formatDayLabel(selectedDate)}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <input
                  type="date"
                  aria-label="Seleccionar fecha de llamadas"
                  value={selectedDate}
                  max={todayDate}
                  onChange={(e) => {
                    if (e.target.value) setSelectedDate(e.target.value);
                  }}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-primary)] outline-none"
                />
                {!isViewingToday && (
                  <button
                    type="button"
                    onClick={() => setSelectedDate(todayDate)}
                    className="rounded-xl bg-[var(--brand-solid)]/15 px-2.5 py-1 text-[11px] font-bold text-[var(--brand-solid)]"
                  >
                    Hoy
                  </button>
                )}
              </div>
            </div>
          ) : (
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
          )}

          {presenceExtensions.length > 0 && (
            mobileAppMode ? (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                {presenceExtensions.filter((e) => e.userId !== null || e.liveStatus !== 'unknown').map((ext) => {
                  const dotClass = ext.liveStatus === 'in_call'
                    ? 'bg-amber-500'
                    : ext.liveStatus === 'online'
                      ? 'bg-emerald-500'
                      : ext.liveStatus === 'offline'
                        ? 'bg-rose-500'
                        : 'bg-slate-400';
                  const firstName = ext.userName ? ext.userName.split(' ')[0] : '';
                  return (
                    <div
                      key={ext.extension}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2.5 py-1 text-[11px] shrink-0"
                    >
                      <span className={`h-2 w-2 rounded-full ${dotClass}`} />
                      <span className="font-mono font-bold text-[var(--text-heading)]">{ext.extension}</span>
                      {ext.userId !== null && firstName && (
                        <span className="font-medium text-[var(--text-secondary)]">{firstName}</span>
                      )}
                      <span className="font-mono text-[10px] text-[var(--text-muted)]">
                        {formatHoursMins(ext.connectedWorkdaySeconds)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
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
            )
          )}

          {mobileAppMode ? (
            <div className="grid grid-cols-4 divide-x divide-[var(--border-subtle)] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] py-2.5 text-center">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Total</p>
                <p className="mt-0.5 text-lg font-black tabular-nums text-[var(--text-heading)]">{summary.total}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Entr.</p>
                <p className="mt-0.5 text-lg font-black tabular-nums text-emerald-600 dark:text-emerald-400">{summary.inbound}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Sal.</p>
                <p className="mt-0.5 text-lg font-black tabular-nums text-cyan-600 dark:text-cyan-400">{summary.outbound}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Perd.</p>
                <p className="mt-0.5 text-lg font-black tabular-nums text-rose-600 dark:text-rose-400">{summary.missed}</p>
              </div>
            </div>
          ) : (
            <>
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
            </>
          )}

          {mobileAppMode ? (
            <div className="space-y-2">
              <div className="relative">
                <span aria-hidden="true" className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-[var(--text-muted)]">
                  search
                </span>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar número, cliente o extensión…"
                  className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] pl-9 pr-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--brand-solid)]"
                />
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                {[
                  { key: 'all', label: 'Todas', active: !direction && !status, onClick: () => { setDirection(''); setStatus(''); } },
                  { key: 'inbound', label: 'Entrantes', active: direction === 'inbound' && !status, onClick: () => { setDirection('inbound'); setStatus(''); } },
                  { key: 'outbound', label: 'Salientes', active: direction === 'outbound' && !status, onClick: () => { setDirection('outbound'); setStatus(''); } },
                  { key: 'missed', label: 'Perdidas', active: status === 'missed', onClick: () => { setDirection(''); setStatus('missed'); } },
                  { key: 'answered', label: 'Contestadas', active: status === 'answered', onClick: () => { setDirection(''); setStatus('answered'); } },
                ].map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={chip.onClick}
                    className={`rounded-full px-3 py-1 text-[11px] font-bold whitespace-nowrap transition-all ${
                      chip.active
                        ? 'bg-[var(--brand-solid)] text-white shadow-sm'
                        : 'border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar número, cliente o extensión…"
              className="w-full sm:min-w-[200px] sm:flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--brand-solid)]"
            />
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
              <select
                aria-label="Filtrar por dirección"
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                className="w-full sm:w-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
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
                className="w-full sm:w-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
              >
                <option value="">Todos los estados</option>
                <option value="ringing">Sonando</option>
                <option value="answered">Contestadas</option>
                <option value="missed">Perdidas</option>
                <option value="ended">Finalizadas</option>
              </select>
            </div>
          </div>
          )}

          {error && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-300">
              {error}
            </div>
          )}

          {qaActionError && (
            <div role="alert" className="flex items-center justify-between gap-2 rounded-2xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
              <span>{qaActionError}</span>
              <button
                type="button"
                onClick={() => setQaActionError(null)}
                className="font-bold underline cursor-pointer shrink-0"
              >
                Cerrar
              </button>
            </div>
          )}

          <div className="md:hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--border-subtle)]">
            {loading && !calls.length ? (
              <div className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">
                Cargando registro de llamadas…
              </div>
            ) : !calls.length ? (
              <div className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">
                No hay llamadas registradas para {formatDayLabel(selectedDate)}.
              </div>
            ) : (
              calls.map((call) => {
                const dir = DIRECTION_LABEL[call.direction] || DIRECTION_LABEL.inbound;
                const badge = STATUS_BADGE[call.status] || STATUS_BADGE.ended;
                const durationLabel =
                  call.status === 'answered' && !call.billsecSeconds && !call.durationSeconds
                    ? 'En curso'
                    : formatDuration(call.billsecSeconds || call.durationSeconds);
                const extDestinationLabel =
                  call.status === 'missed' || call.status === 'ringing'
                    ? (call.queueName ? `Cola ${call.queueName}` : (call.destination || '—'))
                    : (call.answeredByExt
                        ? `Ext. ${call.answeredByExt}${extensionUsers[call.answeredByExt] ? ` · ${extensionUsers[call.answeredByExt]}` : ''}`
                        : (call.queueName ? `Cola ${call.queueName}` : call.destination || '—'));
                const iconRingClass =
                  call.status === 'missed'
                    ? 'bg-rose-500/15 text-rose-500 border-rose-500/30'
                    : call.status === 'ringing'
                      ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30 animate-pulse'
                      : call.direction === 'outbound'
                        ? 'bg-cyan-500/15 text-cyan-500 border-cyan-500/30'
                        : 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30';

                return (
                  <div
                    key={call.uniqueid}
                    className="px-3.5 py-3 flex items-start gap-3 active:bg-[var(--bg-surface)]/70"
                  >
                    <div className={`w-9 h-9 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${iconRingClass}`}>
                      <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                        {dir.icon}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-[13px] font-bold text-[var(--text-heading)] truncate">
                              {call.clientName || call.callerName || call.callerNumber}
                            </p>
                            {call.ivrLanguage && (
                              <span className="rounded-md bg-[var(--bg-surface)] px-1.5 py-0.5 text-[9.5px] font-bold text-[var(--text-muted)] shrink-0">
                                {call.ivrLanguage}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-[var(--text-muted)] truncate">
                            <span className="font-mono">{call.callerNumber}</span>
                            {' · '}
                            <span className="font-medium text-[var(--text-secondary)]">{extDestinationLabel}</span>
                          </p>
                        </div>

                        <div className="flex flex-col items-end gap-0.5 shrink-0 text-right">
                          <span className="text-[10.5px] text-[var(--text-muted)] whitespace-nowrap">
                            {formatTimeOnly(call.startedAt)}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[10.5px] font-semibold tabular-nums text-[var(--text-secondary)]">
                              {durationLabel}
                            </span>
                            <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[9.5px] font-bold leading-none ${badge.className}`}>
                              {badge.label}
                            </span>
                          </div>
                        </div>
                      </div>

                      {(Array.isArray(call.rejectedByExts) && call.rejectedByExts.length > 0 || (call.orderId && onSelectOrder)) && (
                        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                          {Array.isArray(call.rejectedByExts) && call.rejectedByExts.length > 0 ? (
                            <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[9.5px] font-bold text-amber-700 dark:text-amber-300">
                              Rechazó: {call.rejectedByExts.map((ext) => extensionUsers[ext] ? `${ext} (${extensionUsers[ext]})` : ext).join(', ')}
                            </span>
                          ) : <span />}
                          {call.orderId && onSelectOrder && (
                            <button
                              type="button"
                              onClick={() => onSelectOrder(call.orderId!)}
                              className="rounded-lg border border-[var(--border-subtle)] px-2 py-0.5 text-[10.5px] font-mono font-bold text-[var(--brand-solid)]"
                            >
                              {call.orderCode || 'Abrir'}
                            </button>
                          )}
                        </div>
                      )}

                      {renderAudioQaControls(call, true)}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="hidden md:block overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
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
                    <th className="px-4 py-3">Audio / Auditoría IA</th>
                    <th className="px-4 py-3 text-right">Orden</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {loading && !calls.length ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-[var(--text-muted)]">
                        Cargando registro de llamadas…
                      </td>
                    </tr>
                  ) : !calls.length ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-[var(--text-muted)]">
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
                          <td className="px-4 py-3">
                            {renderAudioQaControls(call)}
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
        <div className="space-y-3 sm:space-y-4">
          {mobileAppMode ? (
            <div className="grid grid-cols-4 divide-x divide-[var(--border-subtle)] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] py-2.5 text-center">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Días</p>
                <p className="mt-0.5 text-lg font-black tabular-nums text-[var(--text-heading)]">{analyticsTotals.activeDays}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">30 días</p>
                <p className="mt-0.5 text-lg font-black tabular-nums text-cyan-600 dark:text-cyan-400">{analyticsTotals.total}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">7AM–6PM</p>
                <p className="mt-0.5 text-lg font-black tabular-nums text-emerald-600 dark:text-emerald-400">{analyticsTotals.bhAnswerRate}%</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Prom.</p>
                <p className="mt-0.5 text-lg font-black tabular-nums text-[var(--text-heading)]">{formatDuration(analyticsTotals.avgDuration)}</p>
              </div>
            </div>
          ) : (
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
          )}

          {presenceExtensions.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2.5">
                <h2 className="text-xs font-black uppercase tracking-wider text-[var(--text-heading)]">
                  Conexión y Jornada · {formatDayLabel(selectedDate)}
                </h2>
                <span className="hidden sm:inline text-[11px] text-[var(--text-muted)]">
                  Haz clic en una extensión para ver su historial de conexión/desconexión
                </span>
              </div>

              <div className="md:hidden divide-y divide-[var(--border-subtle)]">
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
                    <div key={ext.extension} className="px-3.5 py-2.5">
                      <button
                        type="button"
                        onClick={() => setExpandedPresenceExt(isExpanded ? null : ext.extension)}
                        className="w-full flex items-center justify-between gap-2 text-left"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[var(--text-heading)] truncate">{ext.userName}</p>
                          <p className="font-mono text-[11px] text-[var(--text-muted)]">
                            Ext. {ext.extension} · 1ra: {formatTimeOnly(ext.firstConnectedAt)}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>
                            {badge.label}
                          </span>
                          <span className="font-mono text-[11px] font-bold text-[var(--text-heading)]">
                            {formatHoursMins(ext.connectedWorkdaySeconds)}
                            {ext.workdayElapsedSeconds > 0 && (
                              <span className="ml-1 font-normal text-[var(--text-muted)]">({ext.availabilityPct}%)</span>
                            )}
                          </span>
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="mt-2 pt-2 border-t border-[var(--border-subtle)] text-[11px]">
                          {ext.events.length === 0 ? (
                            <p className="text-[var(--text-muted)]">Sin cambios de conexión registrados todavía.</p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {ext.events.map((ev, idx) => (
                                <span
                                  key={`${ev.occurredAt}-${idx}`}
                                  className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold ${
                                    ev.status === 'online'
                                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                      : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                                  }`}
                                >
                                  {ev.status === 'online' ? 'ON' : 'OFF'} · {formatTimeOnly(ev.occurredAt)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="hidden md:block overflow-x-auto">
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

          <div className="md:hidden overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] divide-y divide-[var(--border-subtle)]">
            <div className="bg-[var(--bg-surface)] px-4 py-2.5">
              <h2 className="text-xs font-black uppercase tracking-wider text-[var(--text-heading)]">
                Historial diario (30 días)
              </h2>
            </div>
            {analyticsLoading && !analyticsDays.length ? (
              <div className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">
                Cargando analíticas diarias…
              </div>
            ) : !analyticsDays.length ? (
              <div className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">
                Aún no hay historial diario registrado.
              </div>
            ) : (
              analyticsDays.map((day) => (
                <button
                  key={day.date}
                  type="button"
                  onClick={() => {
                    setSelectedDate(day.date);
                    setTab('daily');
                  }}
                  className="w-full px-3.5 py-3 flex items-center justify-between gap-2 text-left active:bg-[var(--bg-surface)]/70"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[var(--text-heading)]">{formatDayLabel(day.date)}</p>
                    <p className="mt-0.5 text-[11px] font-mono text-[var(--text-muted)]">
                      Entr: <span className="text-emerald-500 font-bold">{day.inboundCalls}</span>
                      {' · '}Sal: <span className="text-cyan-500 font-bold">{day.outboundCalls}</span>
                      {' · '}Perd: <span className="text-rose-500 font-bold">{day.missedCalls}</span>
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="font-mono text-sm font-black text-[var(--text-heading)]">{day.totalCalls}</span>
                    <span className="text-[10px] font-mono text-[var(--text-muted)]">
                      {day.answerRate}% · {formatDuration(day.avgBillsecSeconds)}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="hidden md:block overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
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

      {qaModalCall && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Auditoría IA de llamada"
          className="horizon-modal fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-3 sm:p-4"
        >
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-2xl">
            <div className={`flex items-start justify-between gap-3 border-b px-5 py-4 ${
              qaModalCall.qaStatus === 'incorrect'
                ? 'border-rose-500/30 bg-rose-500/10'
                : 'border-emerald-500/30 bg-emerald-500/10'
            }`}>
              <div className="flex items-start gap-3 min-w-0">
                <div className={`w-10 h-10 rounded-2xl border flex items-center justify-center shrink-0 ${
                  qaModalCall.qaStatus === 'incorrect'
                    ? 'border-rose-500/40 bg-rose-500/15 text-rose-500'
                    : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-500'
                }`}>
                  <span aria-hidden="true" className="material-symbols-outlined text-[22px]">
                    {qaModalCall.qaStatus === 'incorrect' ? 'warning' : 'verified'}
                  </span>
                </div>
                <div className="min-w-0">
                  <span className={`text-[10.5px] font-black uppercase tracking-wider ${
                    qaModalCall.qaStatus === 'incorrect' ? 'text-rose-500' : 'text-emerald-500'
                  }`}>
                    {qaModalCall.qaStatus === 'incorrect' ? 'Alerta: Llamada No Correcta' : 'Llamada Aprobada por IA'}
                    {qaModalCall.qaScore != null ? ` · Puntaje ${qaModalCall.qaScore}/100` : ''}
                  </span>
                  <h3 className="text-base font-black text-[var(--text-heading)] truncate">
                    {qaModalCall.clientName || qaModalCall.callerName || qaModalCall.callerNumber}
                  </h3>
                  <p className="text-[11px] font-mono text-[var(--text-muted)]">
                    {qaModalCall.callerNumber}
                    {qaModalCall.answeredByExt ? ` · Ext. ${qaModalCall.answeredByExt}${extensionUsers[qaModalCall.answeredByExt] ? ` (${extensionUsers[qaModalCall.answeredByExt]})` : ''}` : ''}
                    {' · '}{formatDateTime(qaModalCall.startedAt)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setQaModalCall(null)}
                aria-label="Cerrar alerta de llamada"
                className="w-8 h-8 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-heading)] flex items-center justify-center shrink-0 cursor-pointer"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              {qaModalCall.recordingUrl && (
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 space-y-1.5">
                  <span className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-muted)] block">
                    Grabación de la llamada
                  </span>
                  <audio controls src={qaModalCall.recordingUrl} className="w-full h-9" />
                </div>
              )}

              {qaModalCall.qaResult && (
                <>
                  <div className={`rounded-2xl border p-3.5 space-y-2 ${
                    qaModalCall.qaStatus === 'incorrect'
                      ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200'
                      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                  }`}>
                    <p className="font-bold text-sm">{qaModalCall.qaResult.summary}</p>
                    {qaModalCall.qaResult.failureReasons.length > 0 && (
                      <ul className="list-disc pl-4 space-y-1 text-xs">
                        {qaModalCall.qaResult.failureReasons.map((reason, idx) => (
                          <li key={idx}>{reason}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-[11px] font-black uppercase tracking-wider text-[var(--text-muted)]">
                      Evaluación del protocolo (Rodriguez Salvage Yard)
                    </h4>
                    <div className="divide-y divide-[var(--border-subtle)] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
                      {[
                        { label: '1. Saludo oficial (Rodriguez Salvage Yard)', item: qaModalCall.qaResult.checklist.officialGreeting },
                        { label: '2. Preguntó pieza y vehículo', item: qaModalCall.qaResult.checklist.askedNeed },
                        { label: '3. Búsqueda real en inventario / Car-Part', item: qaModalCall.qaResult.checklist.realInventorySearch },
                        { label: '4. Precio y millas (si había existencia)', item: qaModalCall.qaResult.checklist.priceAndMilesIfAvailable },
                        { label: '5. Despedida cordial', item: qaModalCall.qaResult.checklist.courteousGoodbye },
                      ].map((row) => (
                        <div key={row.label} className="px-3.5 py-2.5 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-bold text-[var(--text-heading)]">{row.label}</p>
                            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{row.item.note}</p>
                          </div>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0 ${
                            row.item.passed === true
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                              : row.item.passed === false
                                ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300'
                                : 'bg-slate-500/15 text-slate-500'
                          }`}>
                            {row.item.passed === true ? 'Cumplió' : row.item.passed === false ? 'Falló' : 'N/A'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {qaModalCall.qaResult.transcript && (
                    <div className="space-y-1.5">
                      <h4 className="text-[11px] font-black uppercase tracking-wider text-[var(--text-muted)]">
                        Transcripción detectada
                      </h4>
                      <pre className="whitespace-pre-wrap rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 font-sans text-xs text-[var(--text-secondary)] leading-relaxed">
                        {qaModalCall.qaResult.transcript}
                      </pre>
                    </div>
                  )}
                </>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  disabled={analyzingUniqueId === qaModalCall.uniqueid}
                  onClick={() => { void handleReanalyzeCall(qaModalCall); }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-bold text-[var(--text-heading)] hover:bg-[var(--bg-card)] disabled:opacity-50 cursor-pointer"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">psychology</span>
                  <span>{analyzingUniqueId === qaModalCall.uniqueid ? 'Analizando…' : 'Re-analizar con IA'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setQaModalCall(null)}
                  className="rounded-xl bg-[var(--brand-solid)] px-4 py-2 text-xs font-bold text-white cursor-pointer"
                >
                  Entendido
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
