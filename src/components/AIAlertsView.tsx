import React, { useState } from 'react';

export const AIAlertsView: React.FC = () => {
  const [selectedSeverity, setSelectedSeverity] = useState('Todas');

  const alerts = [
    {
      id: 'ALT-AI-801',
      severity: 'Crítica',
      title: 'Desviación SLA Taller - Espera de Refacción',
      description: 'La orden #ORD-7712B tiene un retraso previsto de 36 horas en la entrega del módulo ABS desde almacén central. Se recomienda activar proveedor alterno.',
      target: 'ORD-7712B (BMW Serie 3)',
      confidence: '96.4% precisión',
      suggestedAction: 'Pedir pieza a Proveedor Express Local (Stock disponible a 12km)',
      timestamp: 'Hace 12 min',
    },
    {
      id: 'ALT-AI-802',
      severity: 'Media',
      title: 'Oportunidad de Venta Adicional Detectada',
      description: 'El perfil del cliente Roberto Sánchez (VIP) tiene historial de reemplazo preventivo de amortiguadores cada 45,000 km. Su Audi Q5 ya superó los 46,200 km.',
      target: 'Cliente: Roberto Sánchez',
      confidence: '89.1% probabilidad de aceptación',
      suggestedAction: 'Enviar sugerencia de inspección de suspensión vía WhatsApp/SMS',
      timestamp: 'Hace 45 min',
    },
    {
      id: 'ALT-AI-803',
      severity: 'Baja',
      title: 'Optimización de Bahías de Trabajo',
      description: 'La bahía 02 estará desocupada de 14:00 a 16:30. Se sugiere reasignar la alineación del Porsche Macan para adelantar la entrega 2 horas.',
      target: 'Bahía #02 & Bahía #04',
      confidence: '92.0% eficiencia',
      suggestedAction: 'Reasignar turno en calendario operativo con 1 clic',
      timestamp: 'Hace 1 hora',
    },
    {
      id: 'ALT-AI-804',
      severity: 'Crítica',
      title: 'Alerta de Margen Financiero en Cotización',
      description: 'El descuento acumulado en la cotización #COT-441 reduce el margen bruto por debajo del umbral mínimo del 22%.',
      target: 'Cotización #COT-441',
      confidence: '99.9% cálculo',
      suggestedAction: 'Ajustar mano de obra o solicitar autorización de gerencia',
      timestamp: 'Hace 2 horas',
    },
  ];

  const filtered = alerts.filter(
    (a) => selectedSeverity === 'Todas' || a.severity === selectedSeverity
  );

  return (
    <div className="flex flex-col gap-6 animate-fade-in max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#111827]/80 p-5 rounded-xl border border-[#1e293b] backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[#58a6ff] text-[26px]">notifications_active</span>
            <h1 className="text-xl font-bold text-[#f1f5f9] tracking-tight">Motor de Alertas Inteligentes (Radar AI)</h1>
          </div>
          <p className="text-xs text-[#94a3b8] mt-1">
            Detección predictiva de cuellos de botella, riesgos de SLA, anomalías financieras y recomendaciones proactivas.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-[#0b1329] px-3.5 py-1.5 rounded-lg border border-[#1e293b] text-xs">
            <span className="w-2 h-2 rounded-full bg-[#388bfd] animate-pulse" />
            <span className="text-[#cbd5e1]">Modelo Gemini 2.0 Operativo</span>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2">
        {['Todas', 'Crítica', 'Media', 'Baja'].map((sev) => (
          <button
            key={sev}
            onClick={() => setSelectedSeverity(sev)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              selectedSeverity === sev
                ? 'bg-[#388bfd] text-[#0a1120]'
                : 'bg-[#1e293b] text-[#94a3b8] hover:text-[#f1f5f9]'
            }`}
          >
            {sev}
          </button>
        ))}
      </div>

      {/* Alerts Grid */}
      <div className="flex flex-col gap-4">
        {filtered.map((alert) => {
          let badgeBorder = 'border-[#388bfd]/30 bg-[#388bfd]/10 text-[#58a6ff]';
          let borderCard = 'border-[#1e293b] hover:border-[#388bfd]/50';

          if (alert.severity === 'Crítica') {
            badgeBorder = 'border-[#ef4444]/40 bg-[#ef4444]/15 text-[#f87171]';
            borderCard = 'border-[#ef4444]/30 hover:border-[#ef4444]/60';
          } else if (alert.severity === 'Media') {
            badgeBorder = 'border-[#f59e0b]/40 bg-[#f59e0b]/15 text-[#fbbf24]';
            borderCard = 'border-[#f59e0b]/30 hover:border-[#f59e0b]/60';
          }

          return (
            <div
              key={alert.id}
              className={`bg-[#0f172a] border ${borderCard} p-5 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-5 transition-all shadow-md`}
            >
              <div className="flex-1">
                <div className="flex items-center gap-2.5 mb-1.5">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${badgeBorder}`}>
                    {alert.severity}
                  </span>
                  <span className="font-mono text-xs text-[#94a3b8]">{alert.id}</span>
                  <span className="text-[#64748b]">•</span>
                  <span className="text-xs text-[#94a3b8]">{alert.timestamp}</span>
                </div>

                <h3 className="font-bold text-sm text-[#f1f5f9] mb-1">{alert.title}</h3>
                <p className="text-xs text-[#cbd5e1] leading-relaxed max-w-3xl">{alert.description}</p>

                <div className="flex flex-wrap items-center gap-3 mt-3 text-xs">
                  <span className="text-[#94a3b8]">Objetivo: <strong className="text-[#58a6ff]">{alert.target}</strong></span>
                  <span className="text-[#64748b]">|</span>
                  <span className="text-[#10b981] font-medium flex items-center gap-1">
                    <span className="material-symbols-outlined text-[15px]">verified</span>
                    {alert.confidence}
                  </span>
                </div>
              </div>

              {/* Action */}
              <div className="bg-[#0b1329] p-3.5 rounded-lg border border-[#1e293b] md:max-w-xs w-full flex flex-col gap-2.5 shrink-0">
                <span className="text-[10px] uppercase font-bold text-[#f59e0b] flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px]">lightbulb</span>
                  Acción Sugerida
                </span>
                <p className="text-xs text-[#e2e8f0] font-medium leading-snug">{alert.suggestedAction}</p>
                <button className="w-full py-1.5 px-3 bg-[#388bfd] hover:bg-[#2563eb] text-[#0a1120] font-bold text-xs rounded transition-colors cursor-pointer text-center">
                  Ejecutar Recomendación
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
