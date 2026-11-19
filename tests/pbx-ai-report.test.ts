import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { generatePbxAiCallReport } from '../src/server/pbxAiReport';

const createMockPool = (opts?: { geminiKey?: string | null }) => {
  const geminiKey = opts && 'geminiKey' in opts ? opts.geminiKey : 'test-gemini-key';
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("setting_key = 'pbx.gemini_api_key'")) {
      return [[geminiKey ? { setting_value: geminiKey } : undefined].filter(Boolean)];
    }
    if (sql.includes('FROM users')) {
      return [[
        { id: 3, name: 'Darrel Machado', pbx_extension: '204' },
        { id: 4, name: 'Favio Andrade', pbx_extension: '202' },
      ]];
    }
    if (sql.includes('FROM pbx_daily_summaries')) {
      return [[
        {
          summary_date: '2026-11-18',
          total_calls: 4,
          inbound_calls: 3,
          outbound_calls: 1,
          internal_calls: 0,
          answered_calls: 3,
          missed_calls: 1,
          business_hours_calls: 4,
          business_hours_answered: 3,
          business_hours_missed: 1,
          after_hours_calls: 0,
          total_billsec_seconds: 180,
          avg_billsec_seconds: 60,
        },
      ]];
    }
    if (sql.includes('answered_by_ext, rejected_by_exts')) {
      return [[
        {
          direction: 'inbound',
          status: 'ended',
          caller_number: '5551234',
          destination: '204',
          answered_by_ext: '204',
          rejected_by_exts: '202',
          billsec_seconds: 95,
          duration_seconds: 100,
          started_at: '2026-11-18T15:00:00.000Z',
          answered_at: '2026-11-18T15:00:05.000Z',
        },
        {
          direction: 'outbound',
          status: 'ended',
          caller_number: '204',
          destination: '5559999',
          answered_by_ext: null,
          rejected_by_exts: null,
          billsec_seconds: 40,
          duration_seconds: 45,
          started_at: '2026-11-18T16:00:00.000Z',
          answered_at: '2026-11-18T16:00:05.000Z',
        },
        {
          direction: 'inbound',
          status: 'missed',
          caller_number: '5557777',
          destination: '202',
          answered_by_ext: null,
          rejected_by_exts: null,
          billsec_seconds: 0,
          duration_seconds: 15,
          started_at: '2026-11-18T17:00:00.000Z',
          answered_at: null,
        },
      ]];
    }
    return [[]];
  });
  const execute = vi.fn(async () => [{ affectedRows: 1 }]);
  return { query, execute } as unknown as Pool;
};

describe('pbxAiReport', () => {
  it('throws when GEMINI_API_KEY is missing', async () => {
    const prevEnv = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const pool = createMockPool({ geminiKey: null });
      await expect(generatePbxAiCallReport(pool, { days: 7 })).rejects.toThrow(/GEMINI_API_KEY/i);
    } finally {
      if (prevEnv !== undefined) process.env.GEMINI_API_KEY = prevEnv;
    }
  });

  it('calls Gemini generateContent and normalizes structured report', async () => {
    const pool = createMockPool();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                title: 'Informe Semanal de Llamadas',
                executiveSummary: 'El equipo atendió 3 de 4 llamadas.',
                highlights: ['Darrel Machado mantuvo 100% de atención.'],
                alerts: ['Favio Andrade registró 1 llamada perdida y 1 rechazada.'],
                employeeInsights: [
                  { userName: 'Darrel Machado', pbxExtension: '204', rating: 'Excelente', summary: 'Excelente gestión.' },
                  { userName: 'Favio Andrade', pbxExtension: '202', rating: 'Atención', summary: 'Revisar rechazos.' },
                ],
                recommendations: ['Reforzar cobertura en horas pico.'],
              }),
            }],
          },
        }],
      }),
    })) as unknown as typeof fetch;

    const result = await generatePbxAiCallReport(pool, {
      startDate: '2026-11-16',
      endDate: '2026-11-22',
      periodLabel: 'Semana Actual',
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.periodLabel).toBe('Semana Actual');
    expect(result.report.title).toBe('Informe Semanal de Llamadas');
    expect(result.report.highlights).toHaveLength(1);
    expect(result.report.alerts).toHaveLength(1);
    expect(result.report.employeeInsights).toHaveLength(2);
    expect(result.report.recommendations).toHaveLength(1);
    expect(result.employeePerformance.find((e) => e.pbxExtension === '204')).toMatchObject({
      answeredCount: 1,
      outboundCount: 1,
      outboundAnsweredCount: 1,
    });
  });

  it('throws clear errors on Gemini HTTP failures or invalid JSON', async () => {
    const pool = createMockPool();
    const failFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => 'overloaded',
    })) as unknown as typeof fetch;

    await expect(
      generatePbxAiCallReport(pool, { days: 7, fetchImpl: failFetch }),
    ).rejects.toThrow(/Gemini API respondió 503/);

    const badJsonFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'not-json' }] } }],
      }),
    })) as unknown as typeof fetch;

    await expect(
      generatePbxAiCallReport(pool, { days: 7, fetchImpl: badJsonFetch }),
    ).rejects.toThrow(/interpretar la respuesta JSON/);
  });
});
