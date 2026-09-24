import React, { useMemo, useState } from 'react';
import { SLAMetric, ActivityItem, Order } from '../types';

interface DashboardViewProps {
  orders: Order[];
  slaMetrics: SLAMetric[];
  activities: ActivityItem[];
  onSelectOrder: (orderId: string) => void;
  onNavigateTaller: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  orders = [],
  slaMetrics = [],
  activities = [],
  onSelectOrder,
  onNavigateTaller,
}) => {
  const [timeRange, setTimeRange] = useState<'30D' | '7D' | '90D'>('30D');
  const [activeDateFilter, setActiveDateFilter] = useState('Hoy');
  const [hoveredBar, setHoveredBar] = useState<{ day: string; amount: string; count: number } | null>(null);
  const [lastUpdated, setLastUpdated] = useState(() =>
    new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date())
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  const dashboardMetrics = useMemo(() => {
    const activeStatuses = new Set([
      'cotizacion',
      'espera_confirmacion',
      'pagado',
      'en_preparacion',
      'listo_despacho',
      'listo_retiro',
      'en_camino',
      'en_diagnostico',
      'en_reparacion',
      'listo_pago',
      'detenido_pieza',
      'en_proceso',
      'facturado',
      'pendiente_aprobacion',
    ]);
    const inProgressStatuses = new Set([
      'pagado',
      'en_preparacion',
      'listo_despacho',
      'listo_retiro',
      'en_camino',
      'en_reparacion',
      'en_proceso',
    ]);
    const paidStatuses = new Set(['pagado', 'facturado', 'entregado']);
    const pendingStatuses = new Set(['cotizacion', 'espera_confirmacion', 'pendiente_aprobacion', 'listo_pago']);
    const issueStatuses = new Set(['reclamo', 'cancelado', 'solicitud_reembolso', 'reembolsado']);

    const activeOrders = orders.filter((order) => activeStatuses.has(order.status));
    const sales = orders
      .filter((order) => paidStatuses.has(order.status))
      .reduce((total, order) => total + (order.financials.partPrice ?? order.financials.total ?? 0), 0);
    const claims = orders.filter((order) => order.status === 'reclamo' || order.status === 'solicitud_reembolso').length;
    const totalOrders = Math.max(orders.length, 1);

    return {
      activeOrders: activeOrders.length,
      sales,
      claims,
      overdueSlas: slaMetrics.filter((sla) => sla.status === 'overdue').length,
      distribution: [
        { label: 'En proceso', count: orders.filter((order) => inProgressStatuses.has(order.status)).length, color: '#22d3ee' },
        { label: 'Ventas cerradas', count: orders.filter((order) => paidStatuses.has(order.status)).length, color: '#34d399' },
        { label: 'Esperando acción', count: orders.filter((order) => pendingStatuses.has(order.status)).length, color: '#fbbf24' },
        { label: 'Incidencias', count: orders.filter((order) => issueStatuses.has(order.status)).length, color: '#f87171' },
      ].map((item) => ({ ...item, percentage: Math.round((item.count / totalOrders) * 100) })),
    };
  }, [orders, slaMetrics]);

  // Sales Trend Bars data
  const trendBars = [
    { day: '01 Nov', height: '80%', amount: '$14,200', count: 18 },
    { day: '04 Nov', height: '60%', amount: '$10,800', count: 14 },
    { day: '08 Nov', height: '75%', amount: '$13,400', count: 17 },
    { day: '12 Nov', height: '40%', amount: '$7,900', count: 9 },
    { day: '15 Nov', height: '90%', amount: '$16,500', count: 22 },
    { day: '19 Nov', height: '85%', amount: '$15,100', count: 20 },
    { day: '23 Nov', height: '65%', amount: '$11,600', count: 15 },
    { day: '27 Nov', height: '50%', amount: '$9,200', count: 12 },
    { day: '30 Nov', height: '95%', amount: '$17,800', count: 24, isLatest: true },
  ];

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setLastUpdated(
        new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date())
      );
      setIsRefreshing(false);
    }, 600);
  };

  return (
    <div className="radar-view select-none pb-8">
      {/* Page Header with Cyber HUD Badge */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#040b17]/90 border border-cyan-400/40 text-[10px] font-mono font-bold tracking-[0.2em] text-cyan-300 uppercase mb-2 shadow-[0_0_12px_rgba(6,182,212,0.25)]">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399] animate-ping" />
            <span>TELEMETRÍA EN VIVO • RADAR 3.0</span>
          </div>
          <h2 className="text-2xl md:text-3xl font-black text-white tracking-tight drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
            Panorama Operativo & Finanzas
          </h2>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-xs text-slate-400 font-mono">
              Sincronización en tiempo real • Última captura: <span className="text-cyan-300">{lastUpdated}</span>
            </p>
            <button
              onClick={handleRefresh}
              className={`p-1 text-slate-400 hover:text-cyan-400 rounded-lg transition cursor-pointer hover:bg-slate-800/60 ${
                isRefreshing ? 'animate-spin text-cyan-400' : ''
              }`}
              title="Actualizar telemetría"
            >
              <span className="material-symbols-outlined text-[16px]">refresh</span>
            </button>
          </div>
        </div>

        {/* Date Filter & Control Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setActiveDateFilter(activeDateFilter === 'Hoy' ? 'Últimos 7 días' : 'Hoy')}
            className="px-3.5 py-2 rounded-2xl bg-[#060e1d]/90 border border-cyan-500/30 text-xs font-mono font-bold text-slate-200 hover:border-cyan-400 hover:bg-[#09152b] transition-all flex items-center gap-2 cursor-pointer shadow-[0_0_15px_rgba(6,182,212,0.15)]"
          >
            <span className="material-symbols-outlined text-[17px] text-cyan-400">calendar_month</span>
            <span>{activeDateFilter}</span>
          </button>

          <button
            onClick={() => setTimeRange(timeRange === '30D' ? '7D' : '30D')}
            className="px-3.5 py-2 rounded-2xl bg-[#060e1d]/90 border border-cyan-500/30 text-xs font-mono font-bold text-slate-200 hover:border-cyan-400 hover:bg-[#09152b] transition-all flex items-center gap-2 cursor-pointer shadow-[0_0_15px_rgba(6,182,212,0.15)]"
          >
            <span className="material-symbols-outlined text-[17px] text-emerald-400">tune</span>
            <span>Rango ({timeRange})</span>
          </button>
        </div>
      </div>

      {/* 4 KPIs Cyber HUD Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Ventas Totales */}
        <div className="relative rounded-2xl bg-[#070c18]/90 backdrop-blur-2xl border border-emerald-500/35 p-5 shadow-[0_15px_35px_rgba(0,0,0,0.7),0_0_30px_rgba(16,185,129,0.15)] overflow-hidden group hover:border-emerald-400 transition-all">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_12px_#34d399]" />
          <div className="flex justify-between items-start mb-3 relative z-10">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-emerald-400/90">
              Ventas Consolidadas
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-400/40 flex items-center justify-center text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.3)]">
              <span className="material-symbols-outlined text-[18px]">trending_up</span>
            </div>
          </div>
          <div className="relative z-10">
            <span className="font-mono text-3xl lg:text-4xl font-black text-white tracking-tight drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">
              ${dashboardMetrics.sales.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </span>
            <div className="flex items-center gap-1.5 mt-2 text-emerald-300 text-xs font-mono font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>{orders.filter((order) => ['pagado', 'facturado', 'entregado'].includes(order.status)).length} ventas cerradas</span>
            </div>
          </div>
        </div>

        {/* KPI 2: Órdenes Activas */}
        <div
          onClick={onNavigateTaller}
          className="relative rounded-2xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/35 p-5 shadow-[0_15px_35px_rgba(0,0,0,0.7),0_0_30px_rgba(6,182,212,0.15)] overflow-hidden group hover:border-cyan-400 transition-all cursor-pointer"
        >
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#22d3ee]" />
          <div className="flex justify-between items-start mb-3 relative z-10">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-cyan-400/90">
              Órdenes Activas
            </span>
            <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center text-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.3)]">
              <span className="material-symbols-outlined text-[18px]">inventory_2</span>
            </div>
          </div>
          <div className="relative z-10">
            <span className="font-mono text-3xl lg:text-4xl font-black text-white tracking-tight drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">
              {dashboardMetrics.activeOrders}
            </span>
            <div className="flex items-center gap-1.5 mt-2 text-cyan-300 text-xs font-mono font-semibold">
              <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
              <span>En seguimiento operativo</span>
            </div>
          </div>
        </div>

        {/* KPI 3: Reclamos Pendientes */}
        <div className="relative rounded-2xl bg-[#070c18]/90 backdrop-blur-2xl border border-amber-500/35 p-5 shadow-[0_15px_35px_rgba(0,0,0,0.7),0_0_30px_rgba(245,158,11,0.15)] overflow-hidden group hover:border-amber-400 transition-all">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_12px_#fbbf24]" />
          <div className="flex justify-between items-start mb-3 relative z-10">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-amber-400/90">
              Reclamos Abiertos
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-400/40 flex items-center justify-center text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.3)]">
              <span className="material-symbols-outlined text-[18px]">warning</span>
            </div>
          </div>
          <div className="relative z-10">
            <span className="font-mono text-3xl lg:text-4xl font-black text-white tracking-tight drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">
              {dashboardMetrics.claims}
            </span>
            <div className="flex items-center gap-1.5 mt-2 text-amber-300 text-xs font-mono font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>Requieren resolución</span>
            </div>
          </div>
        </div>

        {/* KPI 4: Alertas SLA */}
        <div className="relative rounded-2xl bg-[#070c18]/90 backdrop-blur-2xl border border-red-500/35 p-5 shadow-[0_15px_35px_rgba(0,0,0,0.7),0_0_30px_rgba(239,68,68,0.15)] overflow-hidden group hover:border-red-400 transition-all">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-red-400 to-transparent shadow-[0_0_12px_#f87171]" />
          <div className="flex justify-between items-start mb-3 relative z-10">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-red-400/90">
              Alertas de Tiempo SLA
            </span>
            <div className="w-8 h-8 rounded-xl bg-red-500/15 border border-red-400/40 flex items-center justify-center text-red-400 shadow-[0_0_12px_rgba(239,68,68,0.3)]">
              <span className="material-symbols-outlined text-[18px]">timer_off</span>
            </div>
          </div>
          <div className="relative z-10">
            <span className="font-mono text-3xl lg:text-4xl font-black text-white tracking-tight drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">
              {dashboardMetrics.overdueSlas}
            </span>
            <div className="flex items-center gap-1.5 mt-2 text-red-300 text-xs font-mono font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              <span>Fuera de rango estándar</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Bento Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Tendencia de Ventas (HUD Graph) */}
        <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.7)] lg:col-span-2 flex flex-col overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 shadow-[0_0_12px_#22d3ee]" />

          <div className="pb-4 border-b border-cyan-500/15 flex flex-wrap justify-between items-center gap-3">
            <div>
              <h3 className="text-lg font-black text-white">Tendencia de Volumen Comercial</h3>
              <p className="text-xs text-slate-400 font-mono">
                Actividad y picos de venta en los últimos {timeRange === '30D' ? '30 días' : timeRange === '7D' ? '7 días' : '90 días'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {hoveredBar && (
                <div className="flex items-center gap-2 px-3 py-1 rounded-xl bg-[#040814] border border-cyan-400/40 text-xs font-mono shadow-[0_0_12px_rgba(6,182,212,0.25)]">
                  <span className="text-slate-400">{hoveredBar.day}:</span>
                  <span className="text-emerald-400 font-black">{hoveredBar.amount}</span>
                  <span className="text-cyan-300">({hoveredBar.count} órdenes)</span>
                </div>
              )}
              <div className="flex bg-[#040814] rounded-xl p-1 border border-cyan-500/30">
                {(['7D', '30D', '90D'] as const).map((range) => (
                  <button
                    key={range}
                    onClick={() => setTimeRange(range)}
                    className={`px-2.5 py-1 text-xs font-mono font-bold rounded-lg cursor-pointer transition-all ${
                      timeRange === range
                        ? 'bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 shadow-[0_0_10px_rgba(6,182,212,0.4)]'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {range}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Area / Bars Representation */}
          <div className="py-6 flex-1 relative min-h-[220px] flex items-end justify-between gap-2 sm:gap-4 overflow-hidden">
            <div
              className="w-full h-full absolute inset-0 opacity-15 pointer-events-none"
              style={{
                background: 'linear-gradient(to top, #22d3ee 0%, transparent 100%)',
              }}
            />

            {trendBars.map((bar, idx) => (
              <div
                key={idx}
                onMouseEnter={() => setHoveredBar(bar)}
                onMouseLeave={() => setHoveredBar(null)}
                className="relative z-10 w-full flex flex-col justify-end items-center h-full group cursor-pointer"
              >
                <div
                  style={{ height: bar.height }}
                  className={`w-full rounded-t-xl transition-all duration-300 ${
                    bar.isLatest
                      ? 'bg-gradient-to-t from-cyan-500 via-blue-500 to-emerald-400 group-hover:scale-105 shadow-[0_0_20px_rgba(34,211,238,0.5)] border-t-2 border-white'
                      : 'bg-gradient-to-t from-cyan-500/30 to-blue-500/50 group-hover:from-cyan-400 group-hover:to-emerald-400 group-hover:shadow-[0_0_15px_rgba(6,182,212,0.4)]'
                  }`}
                />
              </div>
            ))}
          </div>

          {/* X-Axis labels */}
          <div className="pt-3 flex justify-between font-mono text-[11px] text-slate-400 border-t border-cyan-500/15 tracking-wider">
            <span>01 Nov</span>
            <span>15 Nov</span>
            <span>30 Nov</span>
          </div>
        </div>

        {/* Distribución por Estado */}
        <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.7)] flex flex-col overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#22d3ee]" />

          <div className="pb-4 border-b border-cyan-500/15 flex justify-between items-center">
            <h3 className="text-lg font-black text-white">Distribución de Órdenes</h3>
            <span className="material-symbols-outlined text-cyan-400 text-[20px]">pie_chart</span>
          </div>

          <div className="py-4 flex flex-col gap-4 flex-1 justify-center">
            {dashboardMetrics.distribution.map((item) => (
              <div key={item.label} className="w-full">
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-slate-200 font-bold">{item.label}</span>
                  <span className="font-black" style={{ color: item.color }}>
                    {item.percentage}% <span className="text-slate-400 font-normal">({item.count})</span>
                  </span>
                </div>
                <div className="h-2 w-full bg-[#040814] rounded-full overflow-hidden border border-slate-800">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${item.percentage}%`, backgroundColor: item.color, boxShadow: `0 0 10px ${item.color}` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Secondary Section: SLAs & Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Monitor de SLAs */}
        <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.7)] flex flex-col overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#22d3ee]" />

          <div className="pb-4 border-b border-cyan-500/15 flex justify-between items-center">
            <h3 className="text-lg font-black text-white">Monitor de Tiempos SLA</h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 font-bold">
              ● EN LÍNEA
            </span>
          </div>

          <div className="overflow-x-auto mt-2">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="font-mono text-[10px] text-cyan-400/80 uppercase tracking-wider border-b border-cyan-500/20">
                  <th className="py-2.5 px-3 font-bold">Métrica</th>
                  <th className="py-2.5 px-3 font-bold text-center">Estado</th>
                  <th className="py-2.5 px-3 font-bold text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="text-xs divide-y divide-cyan-500/10">
                {(slaMetrics || []).map((sla) => {
                  let badgeStyles = 'bg-emerald-500/15 text-emerald-300 border-emerald-400/40 shadow-[0_0_8px_rgba(16,185,129,0.25)]';
                  let dotStyles = 'bg-emerald-400 shadow-[0_0_6px_#34d399]';

                  if (sla.status === 'attention') {
                    badgeStyles = 'bg-amber-500/15 text-amber-300 border-amber-400/40 shadow-[0_0_8px_rgba(245,158,11,0.25)]';
                    dotStyles = 'bg-amber-400 shadow-[0_0_6px_#fbbf24]';
                  } else if (sla.status === 'overdue') {
                    badgeStyles = 'bg-red-500/15 text-red-300 border-red-400/40 shadow-[0_0_8px_rgba(239,68,68,0.25)]';
                    dotStyles = 'bg-red-400 shadow-[0_0_6px_#f87171]';
                  }

                  return (
                    <tr
                      key={sla.id}
                      onClick={onNavigateTaller}
                      className="hover:bg-cyan-500/5 transition cursor-pointer group"
                    >
                      <td className="py-3 px-3 text-slate-200 font-medium group-hover:text-cyan-300">{sla.name}</td>
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold border ${badgeStyles}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${dotStyles}`} />
                          {sla.statusLabel}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-300 font-bold">
                        {sla.value}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Actividad Reciente Feed */}
        <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.7)] flex flex-col overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#22d3ee]" />

          <div className="pb-4 border-b border-cyan-500/15 flex justify-between items-center">
            <h3 className="text-lg font-black text-white">Actividad Reciente en Taller</h3>
          </div>

          <div className="pt-3 overflow-y-auto flex-1 flex flex-col gap-2.5">
            {(activities || []).slice(0, 4).map((item) => {
              let iconBg = 'bg-cyan-500/15 border-cyan-400/40 text-cyan-400';
              if (item.type === 'workshop') {
                iconBg = 'bg-amber-500/15 border-amber-400/40 text-amber-400';
              } else if (item.type === 'lead') {
                iconBg = 'bg-emerald-500/15 border-emerald-400/40 text-emerald-400';
              } else if (item.type === 'alert') {
                iconBg = 'bg-red-500/15 border-red-400/40 text-red-400';
              }

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    if (item.id === 'act-1') onSelectOrder('ORD-8924A');
                    else onNavigateTaller();
                  }}
                  className="flex items-center gap-3 p-2.5 rounded-2xl bg-[#040814]/70 border border-cyan-500/15 hover:border-cyan-400/50 hover:bg-[#081326] transition-all cursor-pointer group"
                >
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border shadow-[0_0_10px_rgba(6,182,212,0.2)] ${iconBg}`}
                  >
                    <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-200 font-medium group-hover:text-cyan-300 transition leading-snug">
                      {item.title}
                    </p>
                    <span className="text-[10px] font-mono text-slate-400 block mt-0.5">
                      {item.timeAgo}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
