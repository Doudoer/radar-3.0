import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../services/apiFetch';

export interface PbxDailyAnalyticsRow {
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

export interface PbxEmployeeDailyBreakdown {
  date: string;
  receivedCount: number;
  answeredCount: number;
  missedCount: number;
  rejectedCount: number;
  outboundCount: number;
  outboundAnsweredCount: number;
  answerRate: number;
  totalTalkSeconds: number;
  avgTalkSeconds: number;
}

export interface PbxEmployeeCallPerformance {
  userId: number | null;
  userName: string;
  pbxExtension: string;
  receivedCount: number;
  answeredCount: number;
  missedCount: number;
  rejectedCount: number;
  outboundCount: number;
  outboundAnsweredCount: number;
  answerRate: number;
  totalTalkSeconds: number;
  avgTalkSeconds: number;
  dailyBreakdown?: PbxEmployeeDailyBreakdown[];
}

interface PbxCallAnalyticsPanelProps {
  /** Optional Monday–Sunday week range when embedded in Relación Semanal */
  weekStartDate?: string;
  weekEndDate?: string;
  weekLabel?: string;
}

interface AiEmployeeInsight {
  userName: string;
  pbxExtension: string;
  rating: 'Excelente' | 'Bueno' | 'Atención' | 'Crítico';
  summary: string;
}

interface AiCallReportPayload {
  generatedAt: string;
  periodLabel: string;
  startDate: string;
  endDate: string;
  report: {
    title: string;
    executiveSummary: string;
    highlights: string[];
    alerts: string[];
    employeeInsights: AiEmployeeInsight[];
    recommendations: string[];
    model: string;
  };
  days: PbxDailyAnalyticsRow[];
  employeePerformance: PbxEmployeeCallPerformance[];
}

const formatDuration = (sec: number): string => {
  const s = Math.max(0, Math.round(sec || 0));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
};

const formatDayLabel = (dateStr: string): string => {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12, 0, 0));
    return new Intl.DateTimeFormat('es-ES', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC',
    }).format(dt);
  } catch {
    return dateStr;
  }
};

const formatShortDayHeader = (dateStr: string): string => {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12, 0, 0));
    const wd = new Intl.DateTimeFormat('es-ES', { weekday: 'short', timeZone: 'UTC' }).format(dt);
    return `${wd.replace('.', '')} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  } catch {
    return dateStr;
  }
};

const rateBarClass = (rate: number) => {
  if (rate >= 80) return 'bg-emerald-500';
  if (rate >= 50) return 'bg-amber-500';
  return 'bg-rose-500';
};

const rateTextClass = (rate: number) => {
  if (rate >= 80) return 'text-emerald-600 dark:text-emerald-400';
  if (rate >= 50) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
};

export const PbxCallAnalyticsPanel: React.FC<PbxCallAnalyticsPanelProps> = ({
  weekStartDate,
  weekEndDate,
  weekLabel,
}) => {
  const hasWeekProp = Boolean(weekStartDate && weekEndDate);
  const [periodMode, setPeriodMode] = useState<'selected_week' | 'day' | '7d' | '30d'>(
    hasWeekProp ? 'selected_week' : '7d',
  );
  const [subView, setSubView] = useState<'overview' | 'daily_employee' | 'weekly_matrix'>('overview');
  const [selectedEmployeeExt, setSelectedEmployeeExt] = useState<string>('all');
  const [daysData, setDaysData] = useState<PbxDailyAnalyticsRow[]>([]);
  const [employees, setEmployees] = useState<PbxEmployeeCallPerformance[]>([]);
  const [todayDate, setTodayDate] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [aiReportLoading, setAiReportLoading] = useState<boolean>(false);
  const [aiReportError, setAiReportError] = useState<string | null>(null);
  const [aiReportModal, setAiReportModal] = useState<AiCallReportPayload | null>(null);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = '/pbx/analytics?days=7';
      if (periodMode === 'selected_week' && weekStartDate && weekEndDate) {
        query = `/pbx/analytics?startDate=${encodeURIComponent(weekStartDate)}&endDate=${encodeURIComponent(weekEndDate)}`;
      } else if (periodMode === 'day') {
        query = '/pbx/analytics?days=1';
      } else if (periodMode === '30d') {
        query = '/pbx/analytics?days=30';
      }
      const res = await apiFetch(query);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'No se pudieron cargar las analíticas de llamadas.');
      }
      setDaysData(Array.isArray(data.days) ? data.days : []);
      setEmployees(Array.isArray(data.employeePerformance) ? data.employeePerformance : []);
      if (typeof data.today === 'string') setTodayDate(data.today);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar analíticas.');
    } finally {
      setLoading(false);
    }
  }, [periodMode, weekStartDate, weekEndDate]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const teamTotals = useMemo(() => {
    const received = employees.reduce((acc, e) => acc + (e.receivedCount || 0), 0);
    const answered = employees.reduce((acc, e) => acc + (e.answeredCount || 0), 0);
    const missed = employees.reduce((acc, e) => acc + (e.missedCount || 0), 0);
    const rejected = employees.reduce((acc, e) => acc + (e.rejectedCount || 0), 0);
    const outbound = employees.reduce((acc, e) => acc + (e.outboundCount || 0), 0);
    const outboundAnswered = employees.reduce((acc, e) => acc + (e.outboundAnsweredCount || 0), 0);
    const totalTalkSeconds = employees.reduce((acc, e) => acc + (e.totalTalkSeconds || 0), 0);
    const convs = answered + outboundAnswered;
    const pbxTotal = daysData.reduce((acc, d) => acc + (d.totalCalls || 0), 0);
    const pbxAnswered = daysData.reduce((acc, d) => acc + (d.answeredCalls || 0), 0);
    const pbxMissed = daysData.reduce((acc, d) => acc + (d.missedCalls || 0), 0);
    return {
      received,
      answered,
      missed,
      rejected,
      outbound,
      outboundAnswered,
      answerRate: received > 0 ? Math.round((answered / received) * 100) : (pbxTotal > 0 ? Math.round((pbxAnswered / pbxTotal) * 100) : 0),
      totalTalkSeconds,
      avgTalkSeconds: convs > 0 ? Math.round(totalTalkSeconds / convs) : 0,
      pbxTotal,
      pbxAnswered,
      pbxMissed,
    };
  }, [employees, daysData]);

  const dailyEmployeeDates = useMemo(() => {
    const dateSet = new Set<string>();
    for (const emp of employees) {
      for (const d of emp.dailyBreakdown || []) {
        dateSet.add(d.date);
      }
    }
    if (dateSet.size === 0) {
      for (const d of daysData) dateSet.add(d.date);
    }
    return [...dateSet].sort((a, b) => b.localeCompare(a));
  }, [employees, daysData]);

  const weeklyDatesAsc = useMemo(() => {
    return dailyEmployeeDates.slice(0, 7).sort((a, b) => a.localeCompare(b));
  }, [dailyEmployeeDates]);

  const daysAsc = useMemo(() => {
    return [...daysData].sort((a, b) => a.date.localeCompare(b.date));
  }, [daysData]);

  const maxEmployeeActivity = useMemo(() => {
    return Math.max(
      1,
      ...employees.map((e) => (e.answeredCount || 0) + (e.outboundCount || 0) + (e.missedCount || 0) + (e.rejectedCount || 0)),
    );
  }, [employees]);

  const periodDescription = useMemo(() => {
    if (periodMode === 'selected_week' && weekLabel) return weekLabel;
    if (periodMode === 'day') return 'Hoy';
    if (periodMode === '30d') return 'Últimos 30 días';
    return 'Últimos 7 días';
  }, [periodMode, weekLabel]);

  const handleExportCsv = () => {
    const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines: string[] = [];
    lines.push(['ANALÍTICAS DETALLADAS DE LLAMADAS POR EMPLEADO', periodDescription].map(esc).join(','));
    lines.push('');
    lines.push([
      'Empleado', 'Extensión', 'Recibidas', 'Contestadas', 'Perdidas',
      'Rechazadas', 'Realizadas', '% Atención', 'Tiempo Hablado', 'Prom. Conversación',
    ].map(esc).join(','));
    for (const emp of employees) {
      lines.push([
        emp.userName,
        `Ext. ${emp.pbxExtension}`,
        emp.receivedCount ?? 0,
        emp.answeredCount ?? 0,
        emp.missedCount ?? 0,
        emp.rejectedCount ?? 0,
        emp.outboundCount ?? 0,
        `${emp.answerRate ?? 0}%`,
        formatDuration(emp.totalTalkSeconds ?? 0),
        formatDuration(emp.avgTalkSeconds ?? 0),
      ].map(esc).join(','));
    }
    lines.push('');
    lines.push(['DESGLOSE DÍA POR DÍA POR EMPLEADO'].map(esc).join(','));
    lines.push([
      'Fecha', 'Empleado', 'Extensión', 'Recibidas', 'Contestadas',
      'Perdidas', 'Rechazadas', 'Realizadas', '% Atención', 'Tiempo Hablado',
    ].map(esc).join(','));
    for (const dateStr of dailyEmployeeDates) {
      for (const emp of employees) {
        const d = (emp.dailyBreakdown || []).find((row) => row.date === dateStr);
        if (!d) continue;
        lines.push([
          dateStr,
          emp.userName,
          `Ext. ${emp.pbxExtension}`,
          d.receivedCount,
          d.answeredCount,
          d.missedCount,
          d.rejectedCount,
          d.outboundCount,
          `${d.answerRate}%`,
          formatDuration(d.totalTalkSeconds),
        ].map(esc).join(','));
      }
    }
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analiticas-llamadas-${todayDate || 'reporte'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleGenerateAiReport = async () => {
    setAiReportLoading(true);
    setAiReportError(null);
    try {
      const payload: Record<string, unknown> = {
        periodLabel: periodDescription,
      };
      if (periodMode === 'selected_week' && weekStartDate && weekEndDate) {
        payload.startDate = weekStartDate;
        payload.endDate = weekEndDate;
      } else if (periodMode === 'day') {
        payload.days = 1;
      } else if (periodMode === '30d') {
        payload.days = 30;
      } else {
        payload.days = 7;
      }
      const res = await apiFetch('/pbx/analytics/ai-report', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo generar el informe con Gemini.');
      }
      setAiReportModal(data as AiCallReportPayload);
    } catch (err) {
      setAiReportError(err instanceof Error ? err.message : 'Error generando el informe con IA.');
    } finally {
      setAiReportLoading(false);
    }
  };

  const handlePrintAiReport = (data: AiCallReportPayload) => {
    const escHtml = (s: string | number) =>
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const ratingBadge = (rating: string) => {
      if (rating === 'Excelente') return '<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:999px;font-weight:700;font-size:11px;">Excelente</span>';
      if (rating === 'Bueno') return '<span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:999px;font-weight:700;font-size:11px;">Bueno</span>';
      if (rating === 'Atención') return '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:999px;font-weight:700;font-size:11px;">Atención</span>';
      return '<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:999px;font-weight:700;font-size:11px;">Crítico</span>';
    };

    const empRows = data.employeePerformance.map((emp) => `
      <tr>
        <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;font-weight:700;">${escHtml(emp.userName)} <span style="color:#64748b;font-weight:400;">(Ext. ${escHtml(emp.pbxExtension)})</span></td>
        <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;text-align:center;">${emp.receivedCount}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;text-align:center;color:#059669;font-weight:700;">${emp.answeredCount}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;text-align:center;color:#dc2626;font-weight:700;">${emp.missedCount}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;text-align:center;color:#d97706;font-weight:700;">${emp.rejectedCount}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;text-align:center;color:#0284c7;font-weight:700;">${emp.outboundCount}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;">${emp.answerRate}%</td>
        <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${escHtml(formatDuration(emp.totalTalkSeconds))}</td>
      </tr>
    `).join('');

    const insightCards = data.report.employeeInsights.map((ins) => `
      <div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:8px;break-inside:avoid;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <strong style="font-size:13px;color:#0f172a;">${escHtml(ins.userName)} (Ext. ${escHtml(ins.pbxExtension)})</strong>
          ${ratingBadge(ins.rating)}
        </div>
        <p style="margin:0;font-size:12px;color:#334155;line-height:1.45;">${escHtml(ins.summary)}</p>
      </div>
    `).join('');

    const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${escHtml(data.report.title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 28px; line-height: 1.5; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: #334155; border-bottom: 2px solid #e2e8f0; padding-bottom: 4px; margin: 18px 0 8px; }
    .meta { font-size: 12px; color: #64748b; margin-bottom: 16px; }
    .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; font-size: 13px; color: #1e293b; white-space: pre-line; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 10px; }
    ul { margin: 6px 0 0 18px; padding: 0; font-size: 12px; color: #334155; }
    li { margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
    th { background: #f1f5f9; padding: 8px; text-align: left; font-size: 10.5px; text-transform: uppercase; color: #475569; border-bottom: 2px solid #cbd5e1; }
    @media print { body { margin: 14mm; } }
  </style>
</head>
<body>
  <h1>${escHtml(data.report.title)}</h1>
  <div class="meta">
    Período: <strong>${escHtml(data.periodLabel)}</strong> (${escHtml(data.startDate)} al ${escHtml(data.endDate)}) · Generado por Gemini IA (${escHtml(data.report.model)}) el ${escHtml(new Date(data.generatedAt).toLocaleString('es-ES'))}
  </div>

  <h2>Resumen Ejecutivo</h2>
  <div class="box">${escHtml(data.report.executiveSummary)}</div>

  <div class="grid2">
    <div style="border:1px solid #bbf7d0;background:#f0fdf4;border-radius:10px;padding:10px 12px;">
      <strong style="font-size:12px;color:#166534;">Puntos Destacados</strong>
      <ul>${data.report.highlights.map((h) => `<li>${escHtml(h)}</li>`).join('')}</ul>
    </div>
    <div style="border:1px solid #fecaca;background:#fef2f2;border-radius:10px;padding:10px 12px;">
      <strong style="font-size:12px;color:#991b1b;">Alertas y Focos de Atención</strong>
      <ul>${data.report.alerts.map((a) => `<li>${escHtml(a)}</li>`).join('')}</ul>
    </div>
  </div>

  <h2>Tabla Comparativa por Empleado</h2>
  <table>
    <thead>
      <tr>
        <th>Empleado</th>
        <th style="text-align:center;">Recibidas</th>
        <th style="text-align:center;">Contestadas</th>
        <th style="text-align:center;">Perdidas</th>
        <th style="text-align:center;">Rechazadas</th>
        <th style="text-align:center;">Realizadas</th>
        <th style="text-align:center;">% Atención</th>
        <th style="text-align:right;">Tiempo</th>
      </tr>
    </thead>
    <tbody>${empRows}</tbody>
  </table>

  <h2>Evaluación Individual por Empleado (IA)</h2>
  ${insightCards}

  <h2>Recomendaciones para Administración</h2>
  <div class="box">
    <ul style="margin-top:0;">${data.report.recommendations.map((r) => `<li>${escHtml(r)}</li>`).join('')}</ul>
  </div>
</body>
</html>`;

    const printWin = window.open('', '_blank', 'width=960,height=800');
    if (!printWin) {
      window.print();
      return;
    }
    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => {
      printWin.print();
    }, 250);
  };

  return (
    <div className="space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-[var(--brand-solid)]">
              analytics
            </span>
            <h2 className="text-sm font-black uppercase tracking-wider text-[var(--text-heading)]">
              Analíticas Detalladas de Llamadas
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Rendimiento y carga de trabajo por empleado · <strong>{periodDescription}</strong>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <div className="inline-flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1">
            {hasWeekProp && (
              <button
                type="button"
                onClick={() => setPeriodMode('selected_week')}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition cursor-pointer ${
                  periodMode === 'selected_week'
                    ? 'bg-[var(--brand-solid)] !text-white shadow-sm'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-heading)]'
                }`}
              >
                Semana Relación
              </button>
            )}
            {[
              { id: 'day' as const, label: 'Hoy' },
              { id: '7d' as const, label: '7 días' },
              { id: '30d' as const, label: '30 días' },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriodMode(p.id)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition cursor-pointer ${
                  periodMode === p.id
                    ? 'bg-[var(--brand-solid)] !text-white shadow-sm'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-heading)]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void loadAnalytics()}
            className="inline-flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--bg-card)] cursor-pointer"
            title="Actualizar estadísticas"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">refresh</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={employees.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-bold text-[var(--text-heading)] hover:bg-[var(--bg-card)] disabled:opacity-40 cursor-pointer"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">download</span>
            CSV
          </button>

          <button
            type="button"
            onClick={() => void handleGenerateAiReport()}
            disabled={aiReportLoading || loading}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-3 py-1.5 text-xs font-bold !text-white shadow-sm hover:brightness-110 disabled:opacity-50 cursor-pointer"
            title="Generar informe ejecutivo con Gemini IA listo para imprimir"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
              {aiReportLoading ? 'hourglass_top' : 'auto_awesome'}
            </span>
            {aiReportLoading ? 'Generando informe IA…' : 'Informe IA (Imprimir)'}
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-bold text-[var(--text-heading)] hover:bg-[var(--bg-card)] cursor-pointer"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">print</span>
            Vista rápida
          </button>
        </div>
      </div>

      {(error || aiReportError) && (
        <div role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs font-semibold text-rose-700 dark:text-rose-300">
          {aiReportError || error}
        </div>
      )}

      {/* Executive KPI Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            <span>Recibidas (Asesores)</span>
            <span aria-hidden="true" className="material-symbols-outlined text-[17px] text-slate-400">call_received</span>
          </div>
          <p className="mt-1.5 text-2xl font-black tabular-nums text-[var(--text-heading)]">{teamTotals.received}</p>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            PBX total: <strong className="text-[var(--text-secondary)]">{teamTotals.pbxTotal}</strong>
          </p>
        </div>

        <div className="rounded-2xl border border-emerald-500/25 bg-[var(--bg-card)] p-4">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            <span>Contestadas</span>
            <span aria-hidden="true" className="material-symbols-outlined text-[17px] text-emerald-500">call</span>
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <p className="text-2xl font-black tabular-nums text-emerald-600 dark:text-emerald-400">{teamTotals.answered}</p>
            <span className={`text-xs font-black ${rateTextClass(teamTotals.answerRate)}`}>{teamTotals.answerRate}%</span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-surface)]">
            <div className={`h-full rounded-full ${rateBarClass(teamTotals.answerRate)}`} style={{ width: `${Math.min(100, teamTotals.answerRate)}%` }} />
          </div>
        </div>

        <div className="rounded-2xl border border-rose-500/25 bg-[var(--bg-card)] p-4">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            <span>Perdidas / Rechaz.</span>
            <span aria-hidden="true" className="material-symbols-outlined text-[17px] text-rose-500">call_missed</span>
          </div>
          <p className="mt-1.5 text-2xl font-black tabular-nums text-rose-600 dark:text-rose-400">
            {teamTotals.pbxMissed}
            <span className="ml-1.5 text-sm font-bold text-amber-500">/ {teamTotals.rejected} rech.</span>
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            Directas perdidas: <strong className="text-[var(--text-secondary)]">{teamTotals.missed}</strong>
          </p>
        </div>

        <div className="rounded-2xl border border-cyan-500/25 bg-[var(--bg-card)] p-4">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            <span>Realizadas (Salientes)</span>
            <span aria-hidden="true" className="material-symbols-outlined text-[17px] text-cyan-500">call_made</span>
          </div>
          <p className="mt-1.5 text-2xl font-black tabular-nums text-cyan-600 dark:text-cyan-400">{teamTotals.outbound}</p>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            Atendidas: <strong className="text-[var(--text-secondary)]">{teamTotals.outboundAnswered}</strong>
          </p>
        </div>

        <div className="col-span-2 sm:col-span-1 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            <span>Tiempo Hablado</span>
            <span aria-hidden="true" className="material-symbols-outlined text-[17px] text-indigo-400">schedule</span>
          </div>
          <p className="mt-1.5 text-2xl font-black tabular-nums text-[var(--text-heading)]">
            {formatDuration(teamTotals.totalTalkSeconds)}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            Prom. por llamada: <strong className="text-[var(--text-secondary)]">{formatDuration(teamTotals.avgTalkSeconds)}</strong>
          </p>
        </div>
      </div>

      {/* Sub-view Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-1">
          {[
            { key: 'overview' as const, label: 'Comparativa y Carga', icon: 'leaderboard' },
            { key: 'daily_employee' as const, label: 'Detalle Diario por Empleado', icon: 'calendar_month' },
            { key: 'weekly_matrix' as const, label: 'Matriz Semanal (Lun–Dom)', icon: 'grid_on' },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSubView(tab.key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                subView === tab.key
                  ? 'bg-[var(--brand-solid)] !text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-heading)]'
              }`}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[15px]">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {subView === 'daily_employee' && employees.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-bold text-[var(--text-muted)]" htmlFor="pbx-emp-select">
              Empleado:
            </label>
            <select
              id="pbx-emp-select"
              value={selectedEmployeeExt}
              onChange={(e) => setSelectedEmployeeExt(e.target.value)}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-semibold text-[var(--text-heading)] outline-none"
            >
              <option value="all">Todos los empleados</option>
              {employees.map((emp) => (
                <option key={emp.pbxExtension} value={emp.pbxExtension}>
                  {emp.userName} (Ext. {emp.pbxExtension})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {loading && employees.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-12 text-center text-xs text-[var(--text-muted)]">
          Cargando estadísticas de llamadas…
        </div>
      ) : subView === 'overview' ? (
        <div className="space-y-4">
          {/* Daily Volume Stacked Bar Chart */}
          {daysAsc.length > 0 && (
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-[var(--text-heading)]">
                    Volumen Diario de Llamadas (PBX)
                  </h3>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Distribución diaria entre contestadas, salientes y perdidas
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold text-[var(--text-secondary)]">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Contestadas</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-cyan-500" /> Salientes</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-rose-500" /> Perdidas</span>
                </div>
              </div>

              <div className="overflow-x-auto pb-1">
                {(() => {
                  const maxDay = Math.max(1, ...daysAsc.map((d) => d.answeredCalls + d.outboundCalls + d.missedCalls));
                  return (
                    <div className="flex items-end gap-2 min-w-max h-36 pt-4">
                      {daysAsc.map((d) => {
                        const ansH = Math.round((d.answeredCalls / maxDay) * 100);
                        const outH = Math.round((d.outboundCalls / maxDay) * 100);
                        const missH = Math.round((d.missedCalls / maxDay) * 100);
                        return (
                          <div key={d.date} className="flex flex-col items-center gap-1 w-12">
                            <span className="text-[10px] font-mono font-black text-[var(--text-heading)]">{d.totalCalls}</span>
                            <div
                              className="w-7 h-20 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex flex-col justify-end overflow-hidden"
                              title={`${formatDayLabel(d.date)} · Total: ${d.totalCalls} · Contestadas: ${d.answeredCalls} · Salientes: ${d.outboundCalls} · Perdidas: ${d.missedCalls}`}
                            >
                              {missH > 0 && <div className="w-full bg-rose-500" style={{ height: `${missH}%` }} />}
                              {outH > 0 && <div className="w-full bg-cyan-500" style={{ height: `${outH}%` }} />}
                              {ansH > 0 && <div className="w-full bg-emerald-500" style={{ height: `${ansH}%` }} />}
                            </div>
                            <span className="text-[9.5px] font-mono text-[var(--text-muted)]">{formatShortDayHeader(d.date)}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Employee Workload Visual Ranking + Full Table */}
          <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-[var(--text-heading)]">
                  Carga de Trabajo y Rendimiento por Empleado
                </h3>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Haz clic en cualquier empleado para ver su actividad día por día
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[10.5px] font-semibold text-[var(--text-muted)]">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Contestadas</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-cyan-500" /> Realizadas</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Rechazadas</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> Perdidas</span>
              </div>
            </div>

            {employees.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-[var(--text-muted)]">
                No hay extensiones ni llamadas registradas en este período.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[var(--border-subtle)] text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    <tr>
                      <th className="px-4 py-2.5">Empleado</th>
                      <th className="px-3 py-2.5 min-w-[160px]">Carga Visual</th>
                      <th className="px-3 py-2.5 text-center">Recibidas</th>
                      <th className="px-3 py-2.5 text-center">Contestadas</th>
                      <th className="px-3 py-2.5 text-center">Perdidas</th>
                      <th className="px-3 py-2.5 text-center">Rechazadas</th>
                      <th className="px-3 py-2.5 text-center">Realizadas</th>
                      <th className="px-3 py-2.5 min-w-[110px]">% Atención</th>
                      <th className="px-3 py-2.5">Tiempo</th>
                      <th className="px-4 py-2.5 text-right">Prom.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {employees.map((emp) => {
                      const ansW = Math.round(((emp.answeredCount || 0) / maxEmployeeActivity) * 100);
                      const outW = Math.round(((emp.outboundCount || 0) / maxEmployeeActivity) * 100);
                      const rejW = Math.round(((emp.rejectedCount || 0) / maxEmployeeActivity) * 100);
                      const missW = Math.round(((emp.missedCount || 0) / maxEmployeeActivity) * 100);
                      const rate = emp.answerRate ?? 0;
                      return (
                        <tr
                          key={emp.pbxExtension}
                          onClick={() => {
                            setSelectedEmployeeExt(emp.pbxExtension);
                            setSubView('daily_employee');
                          }}
                          className="cursor-pointer hover:bg-[var(--bg-surface)]/70 transition"
                        >
                          <td className="px-4 py-3 whitespace-nowrap">
                            <p className="font-bold text-[var(--text-heading)]">{emp.userName}</p>
                            <p className="font-mono text-[10.5px] text-[var(--text-muted)]">Ext. {emp.pbxExtension}</p>
                          </td>
                          <td className="px-3 py-3">
                            <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--bg-surface)] flex border border-[var(--border-subtle)]">
                              {ansW > 0 && <div className="h-full bg-emerald-500" style={{ width: `${ansW}%` }} title={`Contestadas: ${emp.answeredCount}`} />}
                              {outW > 0 && <div className="h-full bg-cyan-500" style={{ width: `${outW}%` }} title={`Realizadas: ${emp.outboundCount}`} />}
                              {rejW > 0 && <div className="h-full bg-amber-500" style={{ width: `${rejW}%` }} title={`Rechazadas: ${emp.rejectedCount}`} />}
                              {missW > 0 && <div className="h-full bg-rose-500" style={{ width: `${missW}%` }} title={`Perdidas: ${emp.missedCount}`} />}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-center font-mono font-bold text-[var(--text-heading)]">{emp.receivedCount ?? 0}</td>
                          <td className="px-3 py-3 text-center font-mono font-bold text-emerald-600 dark:text-emerald-400">{emp.answeredCount ?? 0}</td>
                          <td className="px-3 py-3 text-center font-mono font-bold text-rose-600 dark:text-rose-400">{emp.missedCount ?? 0}</td>
                          <td className="px-3 py-3 text-center font-mono font-bold text-amber-600 dark:text-amber-400">{emp.rejectedCount ?? 0}</td>
                          <td className="px-3 py-3 text-center font-mono font-bold text-cyan-600 dark:text-cyan-400">{emp.outboundCount ?? 0}</td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-surface)]">
                                <div className={`h-full rounded-full ${rateBarClass(rate)}`} style={{ width: `${Math.min(100, rate)}%` }} />
                              </div>
                              <span className={`font-mono text-[11px] font-black ${rateTextClass(rate)}`}>{rate}%</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 font-mono text-[var(--text-secondary)] whitespace-nowrap">{formatDuration(emp.totalTalkSeconds ?? 0)}</td>
                          <td className="px-4 py-3 text-right font-mono text-[var(--text-secondary)] whitespace-nowrap">{formatDuration(emp.avgTalkSeconds ?? 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t-2 border-[var(--border-subtle)] bg-[var(--bg-surface)]/80 font-black">
                    <tr>
                      <td className="px-4 py-2.5 text-[var(--text-heading)]" colSpan={2}>Total Equipo ({employees.length})</td>
                      <td className="px-3 py-2.5 text-center font-mono text-[var(--text-heading)]">{teamTotals.received}</td>
                      <td className="px-3 py-2.5 text-center font-mono text-emerald-600 dark:text-emerald-400">{teamTotals.answered}</td>
                      <td className="px-3 py-2.5 text-center font-mono text-rose-600 dark:text-rose-400">{teamTotals.missed}</td>
                      <td className="px-3 py-2.5 text-center font-mono text-amber-600 dark:text-amber-400">{teamTotals.rejected}</td>
                      <td className="px-3 py-2.5 text-center font-mono text-cyan-600 dark:text-cyan-400">{teamTotals.outbound}</td>
                      <td className="px-3 py-2.5 font-mono text-[var(--text-heading)]">{teamTotals.answerRate}%</td>
                      <td className="px-3 py-2.5 font-mono text-[var(--text-heading)]">{formatDuration(teamTotals.totalTalkSeconds)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-[var(--text-heading)]">{formatDuration(teamTotals.avgTalkSeconds)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : subView === 'daily_employee' ? (
        <div className="space-y-4">
          {selectedEmployeeExt !== 'all' && (() => {
            const emp = employees.find((e) => e.pbxExtension === selectedEmployeeExt);
            if (!emp) return null;
            const empDaysAsc = [...(emp.dailyBreakdown || [])].sort((a, b) => a.date.localeCompare(b.date));
            const maxBar = Math.max(1, ...empDaysAsc.map((d) => d.answeredCount + d.outboundCount + d.missedCount + d.rejectedCount));
            return (
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-black text-[var(--text-heading)]">
                      {emp.userName} · Ext. {emp.pbxExtension}
                    </h3>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Desempeño diario en {periodDescription} · Tasa de atención: <strong className={rateTextClass(emp.answerRate)}>{emp.answerRate}%</strong>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                    <span className="rounded-lg bg-emerald-500/15 px-2.5 py-1 font-bold text-emerald-700 dark:text-emerald-300">Contestadas: {emp.answeredCount}</span>
                    <span className="rounded-lg bg-cyan-500/15 px-2.5 py-1 font-bold text-cyan-700 dark:text-cyan-300">Realizadas: {emp.outboundCount}</span>
                    <span className="rounded-lg bg-rose-500/15 px-2.5 py-1 font-bold text-rose-700 dark:text-rose-300">Perdidas: {emp.missedCount}</span>
                    <span className="rounded-lg bg-amber-500/15 px-2.5 py-1 font-bold text-amber-700 dark:text-amber-300">Rechazadas: {emp.rejectedCount}</span>
                  </div>
                </div>

                {empDaysAsc.length > 0 && (
                  <div className="overflow-x-auto pb-1">
                    <div className="flex items-end gap-2 min-w-max h-32 pt-3">
                      {empDaysAsc.map((d) => {
                        const ansH = Math.round((d.answeredCount / maxBar) * 100);
                        const outH = Math.round((d.outboundCount / maxBar) * 100);
                        const missH = Math.round(((d.missedCount + d.rejectedCount) / maxBar) * 100);
                        const totalDay = d.receivedCount + d.outboundCount;
                        return (
                          <div key={d.date} className="flex flex-col items-center gap-1 w-12">
                            <span className="text-[10px] font-mono font-bold text-[var(--text-heading)]">{totalDay}</span>
                            <div
                              className="w-6 h-20 rounded-lg bg-[var(--bg-surface)] flex flex-col justify-end overflow-hidden border border-[var(--border-subtle)]"
                              title={`${formatDayLabel(d.date)}: Recibidas ${d.receivedCount} · Contestadas ${d.answeredCount} · Realizadas ${d.outboundCount} · Perdidas ${d.missedCount} · Rechazadas ${d.rejectedCount}`}
                            >
                              {missH > 0 && <div className="w-full bg-rose-500" style={{ height: `${missH}%` }} />}
                              {outH > 0 && <div className="w-full bg-cyan-500" style={{ height: `${outH}%` }} />}
                              {ansH > 0 && <div className="w-full bg-emerald-500" style={{ height: `${ansH}%` }} />}
                            </div>
                            <span className="text-[9.5px] font-mono text-[var(--text-muted)]">{formatShortDayHeader(d.date)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
            <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2.5">
              <h3 className="text-xs font-black uppercase tracking-wider text-[var(--text-heading)]">
                Detalle Día por Día por Empleado
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[var(--border-subtle)] text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  <tr>
                    <th className="px-4 py-2.5">Fecha</th>
                    <th className="px-3 py-2.5">Empleado</th>
                    <th className="px-3 py-2.5 text-center">Recibidas</th>
                    <th className="px-3 py-2.5 text-center">Contestadas</th>
                    <th className="px-3 py-2.5 text-center">Perdidas</th>
                    <th className="px-3 py-2.5 text-center">Rechazadas</th>
                    <th className="px-3 py-2.5 text-center">Realizadas</th>
                    <th className="px-3 py-2.5 text-center">% Atención</th>
                    <th className="px-4 py-2.5 text-right">Tiempo hablado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {(() => {
                    const targetEmps = selectedEmployeeExt === 'all'
                      ? employees
                      : employees.filter((e) => e.pbxExtension === selectedEmployeeExt);
                    const rows: Array<{ date: string; emp: PbxEmployeeCallPerformance; d: PbxEmployeeDailyBreakdown }> = [];
                    for (const dateStr of dailyEmployeeDates) {
                      for (const emp of targetEmps) {
                        const d = (emp.dailyBreakdown || []).find((x) => x.date === dateStr);
                        if (!d) continue;
                        if (selectedEmployeeExt === 'all' && d.receivedCount === 0 && d.outboundCount === 0 && d.rejectedCount === 0 && d.missedCount === 0) {
                          continue;
                        }
                        rows.push({ date: dateStr, emp, d });
                      }
                    }
                    if (rows.length === 0) {
                      return (
                        <tr>
                          <td colSpan={9} className="px-4 py-8 text-center text-[var(--text-muted)]">
                            No hay actividad diaria registrada para este filtro.
                          </td>
                        </tr>
                      );
                    }
                    return rows.map(({ date, emp, d }) => (
                      <tr key={`${date}-${emp.pbxExtension}`} className="hover:bg-[var(--bg-surface)]/50">
                        <td className="px-4 py-2 font-mono font-semibold text-[var(--text-heading)] whitespace-nowrap">{formatDayLabel(date)}</td>
                        <td className="px-3 py-2 font-bold text-[var(--text-heading)] whitespace-nowrap">
                          {emp.userName} <span className="font-mono font-normal text-[var(--text-muted)]">({emp.pbxExtension})</span>
                        </td>
                        <td className="px-3 py-2 text-center font-mono font-bold text-[var(--text-heading)]">{d.receivedCount}</td>
                        <td className="px-3 py-2 text-center font-mono font-bold text-emerald-600 dark:text-emerald-400">{d.answeredCount}</td>
                        <td className="px-3 py-2 text-center font-mono font-bold text-rose-600 dark:text-rose-400">{d.missedCount}</td>
                        <td className="px-3 py-2 text-center font-mono font-bold text-amber-600 dark:text-amber-400">{d.rejectedCount}</td>
                        <td className="px-3 py-2 text-center font-mono font-bold text-cyan-600 dark:text-cyan-400">{d.outboundCount}</td>
                        <td className={`px-3 py-2 text-center font-mono font-bold ${rateTextClass(d.answerRate)}`}>{d.answerRate}%</td>
                        <td className="px-4 py-2 text-right font-mono text-[var(--text-secondary)]">{formatDuration(d.totalTalkSeconds)}</td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-[var(--text-heading)]">
              Matriz Semanal por Empleado ({weeklyDatesAsc[0] || ''} al {weeklyDatesAsc[weeklyDatesAsc.length - 1] || ''})
            </h3>
            <p className="text-[11px] text-[var(--text-muted)]">
              Cada celda muestra: <strong className="text-emerald-600 dark:text-emerald-400">Contestadas</strong> / Recibidas · <strong className="text-cyan-600 dark:text-cyan-400">+Salientes</strong> · Perdidas / Rechazadas
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--border-subtle)] text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                <tr>
                  <th className="px-4 py-2.5">Empleado</th>
                  {weeklyDatesAsc.map((d) => (
                    <th key={d} className="px-2.5 py-2.5 text-center whitespace-nowrap">{formatShortDayHeader(d)}</th>
                  ))}
                  <th className="px-4 py-2.5 text-right">Total Semana</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {employees.map((emp) => {
                  const weekRows = weeklyDatesAsc.map((d) =>
                    (emp.dailyBreakdown || []).find((x) => x.date === d) || {
                      date: d,
                      receivedCount: 0,
                      answeredCount: 0,
                      missedCount: 0,
                      rejectedCount: 0,
                      outboundCount: 0,
                      outboundAnsweredCount: 0,
                      answerRate: 0,
                      totalTalkSeconds: 0,
                      avgTalkSeconds: 0,
                    },
                  );
                  const wRec = weekRows.reduce((s, r) => s + r.receivedCount, 0);
                  const wAns = weekRows.reduce((s, r) => s + r.answeredCount, 0);
                  const wMiss = weekRows.reduce((s, r) => s + r.missedCount, 0);
                  const wRej = weekRows.reduce((s, r) => s + r.rejectedCount, 0);
                  const wOut = weekRows.reduce((s, r) => s + r.outboundCount, 0);
                  const wRate = wRec > 0 ? Math.round((wAns / wRec) * 100) : 0;
                  return (
                    <tr key={emp.pbxExtension} className="hover:bg-[var(--bg-surface)]/50">
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <p className="font-bold text-[var(--text-heading)]">{emp.userName}</p>
                        <p className="font-mono text-[10px] text-[var(--text-muted)]">Ext. {emp.pbxExtension}</p>
                      </td>
                      {weekRows.map((r) => (
                        <td key={r.date} className="px-2.5 py-2 text-center font-mono">
                          {r.receivedCount === 0 && r.outboundCount === 0 ? (
                            <span className="text-[var(--text-muted)]">—</span>
                          ) : (
                            <div className="inline-flex flex-col items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/70 px-2 py-1 leading-tight">
                              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                {r.answeredCount}<span className="text-[var(--text-muted)] font-normal">/{r.receivedCount}</span>
                              </span>
                              {r.outboundCount > 0 && (
                                <span className="text-[10px] font-semibold text-cyan-600 dark:text-cyan-400">+{r.outboundCount} sal</span>
                              )}
                              {(r.missedCount > 0 || r.rejectedCount > 0) && (
                                <span className="text-[9.5px] text-rose-500">
                                  {r.missedCount > 0 ? `${r.missedCount}p ` : ''}{r.rejectedCount > 0 ? `${r.rejectedCount}r` : ''}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      ))}
                      <td className="px-4 py-2.5 text-right font-mono whitespace-nowrap">
                        <p className="font-black text-[var(--text-heading)]">
                          {wAns}/{wRec} <span className={rateTextClass(wRate)}>({wRate}%)</span>
                        </p>
                        <p className="text-[10px] text-[var(--text-muted)]">
                          Sal: <strong className="text-cyan-600 dark:text-cyan-400">{wOut}</strong> · Perd: <strong className="text-rose-500">{wMiss}</strong> · Rech: <strong className="text-amber-500">{wRej}</strong>
                        </p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de Vista Previa e Impresión del Informe IA (Gemini) */}
      {aiReportModal && (
        <div className="horizon-modal fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-5 print:hidden">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Informe Ejecutivo de Llamadas generado por IA"
            className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-2xl"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-3.5 shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-violet-500">auto_awesome</span>
                  <h3 className="text-sm font-black text-[var(--text-heading)]">{aiReportModal.report.title}</h3>
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">
                  {aiReportModal.periodLabel} ({aiReportModal.startDate} al {aiReportModal.endDate}) · Gemini ({aiReportModal.report.model})
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePrintAiReport(aiReportModal)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-3.5 py-2 text-xs font-bold !text-white shadow-sm hover:brightness-110 cursor-pointer"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">print</span>
                  Imprimir / Guardar PDF
                </button>
                <button
                  type="button"
                  onClick={() => setAiReportModal(null)}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            </div>

            <div className="overflow-y-auto p-5 space-y-5 text-xs">
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                <h4 className="text-[11px] font-black uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                  Resumen Ejecutivo
                </h4>
                <p className="text-sm leading-relaxed text-[var(--text-heading)] whitespace-pre-line">
                  {aiReportModal.report.executiveSummary}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-4 space-y-2">
                  <h4 className="text-[11px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    Puntos Destacados
                  </h4>
                  <ul className="list-disc pl-4 space-y-1 text-[var(--text-primary)]">
                    {aiReportModal.report.highlights.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-2xl border border-rose-500/25 bg-rose-500/5 p-4 space-y-2">
                  <h4 className="text-[11px] font-black uppercase tracking-wider text-rose-600 dark:text-rose-400">
                    Alertas y Focos de Atención
                  </h4>
                  <ul className="list-disc pl-4 space-y-1 text-[var(--text-primary)]">
                    {aiReportModal.report.alerts.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-[11px] font-black uppercase tracking-wider text-[var(--text-muted)]">
                  Evaluación por Empleado
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {aiReportModal.report.employeeInsights.map((ins, idx) => {
                    const badgeCls =
                      ins.rating === 'Excelente'
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                        : ins.rating === 'Bueno'
                          ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30'
                          : ins.rating === 'Atención'
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
                            : 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30';
                    return (
                      <div key={idx} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-[var(--text-heading)]">
                            {ins.userName} <span className="font-mono font-normal text-[var(--text-muted)]">(Ext. {ins.pbxExtension})</span>
                          </span>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${badgeCls}`}>
                            {ins.rating}
                          </span>
                        </div>
                        <p className="text-[var(--text-secondary)] leading-relaxed">{ins.summary}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-indigo-500/25 bg-indigo-500/5 p-4 space-y-2">
                <h4 className="text-[11px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  Recomendaciones para Administración
                </h4>
                <ul className="list-disc pl-4 space-y-1 text-[var(--text-primary)]">
                  {aiReportModal.report.recommendations.map((rec, idx) => (
                    <li key={idx}>{rec}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
