import React, { useEffect, useState } from 'react';
import { API_URL } from '../services/apiBase';

export const AIReportsView: React.FC = () => {
  const [analytics, setAnalytics] = useState<{ totalOrders: number; sales: string; activeOrders: string; incidents: string; averageTicket: string } | null>(null);
  const [reports, setReports] = useState<Array<{ id: number; week_code: string; title: string; summary: string; created_at: string }>>([]);

  useEffect(() => {
    fetch(`${API_URL}/analytics`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setAnalytics)
      .catch(() => setAnalytics(null));
    fetch(`${API_URL}/reports`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setReports)
      .catch(() => setReports([]));
  }, []);

  const latestReport = reports[0];
  const money = (value: string | number | undefined) => Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  return (
    <div className="flex flex-col gap-6 animate-fade-in max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#111827]/80 p-5 rounded-xl border border-[#1e293b] backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[#388bfd] text-[26px]">smart_toy</span>
            <h1 className="text-xl font-bold text-[#f1f5f9] tracking-tight">Reportes Ejecutivos Generados por IA</h1>
          </div>
          <p className="text-xs text-[#94a3b8] mt-1">
            Síntesis narrativa automatizada, diagnóstico de rentabilidad y proyecciones estratégicas.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button className="bg-[#388bfd] hover:bg-[#2563eb] text-[#0a1120] font-bold text-xs py-2 px-4 rounded-lg flex items-center gap-2 transition-all cursor-pointer shadow-[0_0_12px_rgba(56,139,253,0.3)]">
            <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
            <span>Generar Nuevo Análisis</span>
          </button>
        </div>
      </div>

      {/* Featured AI Executive Summary Card */}
      <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl p-6 shadow-xl flex flex-col gap-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1e293b] pb-4">
          <div>
            <span className="text-[11px] font-mono text-[#58a6ff] uppercase tracking-wider block">
              {latestReport ? `Informe almacenado · ${latestReport.week_code}` : 'Analítica operativa en tiempo real'}
            </span>
            <h2 className="text-lg font-bold text-[#f1f5f9] mt-0.5">
              {latestReport?.title || 'Resumen de ventas y operación de RADAR'}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded bg-[#10b981]/15 text-[#34d399] text-xs font-semibold border border-[#10b981]/30">
              Ventas: {money(analytics?.sales)}
            </span>
          </div>
        </div>

        {/* Narrative Blocks */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#0b1329] p-4 rounded-lg border border-[#1e293b] flex flex-col gap-2">
            <span className="text-xs font-bold text-[#58a6ff] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">speed</span>
              Rendimiento en Taller
            </span>
            <p className="text-xs text-[#cbd5e1] leading-relaxed">
              <strong>{Number(analytics?.activeOrders || 0)}</strong> órdenes siguen en operación de un total de <strong>{Number(analytics?.totalOrders || 0)}</strong> órdenes registradas.
            </p>
          </div>

          <div className="bg-[#0b1329] p-4 rounded-lg border border-[#1e293b] flex flex-col gap-2">
            <span className="text-xs font-bold text-[#10b981] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">trending_up</span>
              Ticket Promedio & Margen
            </span>
            <p className="text-xs text-[#cbd5e1] leading-relaxed">
              El ticket promedio de las ventas cerradas es <strong>{money(analytics?.averageTicket)}</strong>, calculado desde las órdenes Pagadas, Facturadas y Entregadas.
            </p>
          </div>

          <div className="bg-[#0b1329] p-4 rounded-lg border border-[#1e293b] flex flex-col gap-2">
            <span className="text-xs font-bold text-[#f59e0b] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">inventory_2</span>
              Gestión de Inventario
            </span>
            <p className="text-xs text-[#cbd5e1] leading-relaxed">
              Hay <strong>{Number(analytics?.incidents || 0)}</strong> órdenes con reclamo o reembolso. Este indicador usa el estado actual de las órdenes en radar_db.
            </p>
          </div>
        </div>

        {/* Detailed Insights */}
        <div className="bg-[#0b1329]/80 border border-[#1e293b] rounded-lg p-4 flex flex-col gap-2 text-xs text-[#94a3b8]">
          <h4 className="font-bold text-[#f1f5f9] text-xs uppercase tracking-wider flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-[#388bfd]">psychology</span>
            Conclusiones Estratégicas de la IA
          </h4>
          <p className="leading-relaxed text-[#cbd5e1]">
            {latestReport?.summary || 'No hay informes IA guardados todavía. Las métricas mostradas arriba se generan directamente a partir de los registros operativos actuales.'}
          </p>
        </div>
      </div>
    </div>
  );
};
