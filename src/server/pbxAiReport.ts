import type { Pool } from 'mysql2/promise';
import {
  getGeminiApiKey,
  listPbxDailyAnalytics,
  type PbxDailyAnalyticsRow,
  type PbxEmployeeCallPerformance,
} from './pbxCalls.js';

export const GEMINI_REPORT_MODEL = 'gemini-2.5-flash';

export interface PbxAiEmployeeInsight {
  userName: string;
  pbxExtension: string;
  rating: 'Excelente' | 'Bueno' | 'Atención' | 'Crítico';
  summary: string;
}

export interface PbxAiCallReport {
  title: string;
  executiveSummary: string;
  highlights: string[];
  alerts: string[];
  employeeInsights: PbxAiEmployeeInsight[];
  recommendations: string[];
  model: string;
}

export interface PbxAiReportResponse {
  generatedAt: string;
  periodLabel: string;
  startDate: string;
  endDate: string;
  report: PbxAiCallReport;
  days: PbxDailyAnalyticsRow[];
  employeePerformance: PbxEmployeeCallPerformance[];
}

const GEMINI_REPORT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    executiveSummary: { type: 'STRING' },
    highlights: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    alerts: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    employeeInsights: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          userName: { type: 'STRING' },
          pbxExtension: { type: 'STRING' },
          rating: {
            type: 'STRING',
            enum: ['Excelente', 'Bueno', 'Atención', 'Crítico'],
          },
          summary: { type: 'STRING' },
        },
        required: ['userName', 'pbxExtension', 'rating', 'summary'],
      },
    },
    recommendations: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
  },
  required: [
    'title',
    'executiveSummary',
    'highlights',
    'alerts',
    'employeeInsights',
    'recommendations',
  ],
};

const formatDurationShort = (sec: number): string => {
  const s = Math.max(0, Math.round(sec || 0));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
};

const extractGeminiText = (data: unknown): string => {
  const candidates = (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })?.candidates;
  if (!Array.isArray(candidates) || !candidates.length) return '';
  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => String(p?.text ?? '')).join('').trim();
};

export const generatePbxAiCallReport = async (
  pool: Pool,
  options: {
    days?: number;
    startDate?: string;
    endDate?: string;
    periodLabel?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<PbxAiReportResponse> => {
  const apiKey = await getGeminiApiKey(pool);
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY no configurada. Configúrala en Configuración del Sistema → PBX.');
  }

  const analytics = await listPbxDailyAnalytics(
    pool,
    options.days ?? 7,
    options.startDate,
    options.endDate,
  );

  const periodLabel = options.periodLabel?.trim()
    || `${analytics.startDate} al ${analytics.endDate}`;

  const totalCalls = analytics.days.reduce((s, d) => s + d.totalCalls, 0);
  const totalAnswered = analytics.days.reduce((s, d) => s + d.answeredCalls, 0);
  const totalMissed = analytics.days.reduce((s, d) => s + d.missedCalls, 0);
  const totalOutbound = analytics.days.reduce((s, d) => s + d.outboundCalls, 0);
  const totalInbound = analytics.days.reduce((s, d) => s + d.inboundCalls, 0);
  const bhCalls = analytics.days.reduce((s, d) => s + d.businessHoursCalls, 0);
  const bhAnswered = analytics.days.reduce((s, d) => s + d.businessHoursAnswered, 0);

  const promptPayload = {
    periodo: periodLabel,
    rangoFechas: { inicio: analytics.startDate, fin: analytics.endDate },
    horarioLaboral: '8:00 AM - 5:00 PM Carolina del Norte',
    resumenPbx: {
      totalLlamadas: totalCalls,
      entrantes: totalInbound,
      salientes: totalOutbound,
      contestadas: totalAnswered,
      perdidas: totalMissed,
      tasaAtencionGeneralPct: totalCalls > 0 ? Math.round((totalAnswered / totalCalls) * 100) : 0,
      horarioLaboralLlamadas: bhCalls,
      horarioLaboralContestadas: bhAnswered,
      tasaAtencionHorarioLaboralPct: bhCalls > 0 ? Math.round((bhAnswered / bhCalls) * 100) : 0,
    },
    porDia: [...analytics.days]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        fecha: d.date,
        total: d.totalCalls,
        entrantes: d.inboundCalls,
        salientes: d.outboundCalls,
        contestadas: d.answeredCalls,
        perdidas: d.missedCalls,
        tasaAtencionPct: d.answerRate,
        tiempoPromedio: formatDurationShort(d.avgBillsecSeconds),
      })),
    porEmpleado: analytics.employeePerformance.map((emp) => ({
      nombre: emp.userName,
      extension: emp.pbxExtension,
      recibidas: emp.receivedCount,
      contestadas: emp.answeredCount,
      perdidas: emp.missedCount,
      rechazadas: emp.rejectedCount,
      realizadasSalientes: emp.outboundCount,
      salientesAtendidas: emp.outboundAnsweredCount,
      tasaAtencionPct: emp.answerRate,
      tiempoTotalHablado: formatDurationShort(emp.totalTalkSeconds),
      promedioConversacion: formatDurationShort(emp.avgTalkSeconds),
      diasConActividad: (emp.dailyBreakdown || [])
        .filter((d) => d.receivedCount > 0 || d.outboundCount > 0 || d.missedCount > 0 || d.rejectedCount > 0)
        .map((d) => ({
          fecha: d.date,
          recibidas: d.receivedCount,
          contestadas: d.answeredCount,
          perdidas: d.missedCount,
          rechazadas: d.rejectedCount,
          realizadas: d.outboundCount,
        })),
    })),
  };

  const systemPrompt = [
    'Eres un director de operaciones y analista senior de call center para una empresa de autopartes (Radar / RSY).',
    'Tu tarea es redactar un informe ejecutivo en español claro, directo y accionable para el administrador sobre el desempeño telefónico del equipo.',
    'Reglas estrictas:',
    '1. Usa ÚNICAMENTE los números reales entregados en el JSON; nunca inventes cifras ni fechas.',
    '2. Evalúa el volumen de trabajo de cada empleado (recibidas, contestadas, perdidas, rechazadas, realizadas y tiempo hablado).',
    '3. Si un empleado tiene 0 llamadas o muy baja tasa de atención o muchas rechazadas/perdidas, señálalo con objetividad.',
    '4. Incluye un resumen ejecutivo conciso, puntos destacados, alertas críticas, análisis por empleado y recomendaciones prácticas.',
  ].join('\n');

  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_REPORT_MODEL}:generateContent`;

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Genera el informe ejecutivo imprimible para este período usando los siguientes datos reales:\n${JSON.stringify(promptPayload)}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.25,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_REPORT_SCHEMA,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Gemini API respondió ${response.status}: ${errText.slice(0, 200) || response.statusText}`);
  }

  const json = await response.json();
  const rawText = extractGeminiText(json);
  if (!rawText) {
    throw new Error('Gemini no devolvió contenido para el informe.');
  }

  let parsed: Partial<PbxAiCallReport>;
  try {
    parsed = JSON.parse(rawText) as Partial<PbxAiCallReport>;
  } catch {
    throw new Error('No se pudo interpretar la respuesta JSON de Gemini.');
  }

  const report: PbxAiCallReport = {
    title: String(parsed.title || `Informe Ejecutivo de Llamadas (${periodLabel})`),
    executiveSummary: String(parsed.executiveSummary || ''),
    highlights: Array.isArray(parsed.highlights) ? parsed.highlights.map(String) : [],
    alerts: Array.isArray(parsed.alerts) ? parsed.alerts.map(String) : [],
    employeeInsights: Array.isArray(parsed.employeeInsights)
      ? parsed.employeeInsights.map((item) => ({
          userName: String(item.userName || ''),
          pbxExtension: String(item.pbxExtension || ''),
          rating: (['Excelente', 'Bueno', 'Atención', 'Crítico'].includes(String(item.rating))
            ? item.rating
            : 'Bueno') as PbxAiEmployeeInsight['rating'],
          summary: String(item.summary || ''),
        }))
      : [],
    recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.map(String) : [],
    model: GEMINI_REPORT_MODEL,
  };

  return {
    generatedAt: new Date().toISOString(),
    periodLabel,
    startDate: analytics.startDate,
    endDate: analytics.endDate,
    report,
    days: analytics.days,
    employeePerformance: analytics.employeePerformance,
  };
};
