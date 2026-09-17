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
        { label: 'En proceso', count: orders.filter((order) => inProgressStatuses.has(order.status)).length, color: '#4d8eff' },
        { label: 'Ventas cerradas', count: orders.filter((order) => paidStatuses.has(order.status)).length, color: '#4edea3' },
        { label: 'Esperando acción', count: orders.filter((order) => pendingStatuses.has(order.status)).length, color: '#f59e0b' },
        { label: 'Incidencias', count: orders.filter((order) => issueStatuses.has(order.status)).length, color: '#ef4444' },
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
    <div className="radar-view">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="font-headline-md text-2xl md:text-3xl font-bold text-[#dfe2ef] tracking-tight mb-1">
            Panorama General
          </h2>
          <div className="flex items-center gap-2">
            <p className="font-body-sm text-[13px] text-[#c2c6d6]">
              Resumen operativo del día. Última actualización: {lastUpdated}
            </p>
            <button
              onClick={handleRefresh}
              className={`p-1 text-[#c2c6d6] hover:text-[#4d8eff] rounded-md transition-colors cursor-pointer ${
                isRefreshing ? 'animate-spin text-[#4d8eff]' : ''
              }`}
              title="Actualizar datos"
            >
              <span className="material-symbols-outlined text-[16px]">refresh</span>
            </button>
          </div>
        </div>

        {/* Date Filter & Control Buttons */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setActiveDateFilter(activeDateFilter === 'Hoy' ? 'Últimos 7 días' : 'Hoy')}
              className="glass-card px-3.5 py-2 rounded-lg font-body-sm text-[13px] text-[#dfe2ef] hover:bg-[#31353f] transition-colors flex items-center gap-2 cursor-pointer shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px] text-[#4d8eff]">calendar_month</span>
              <span>{activeDateFilter}</span>
            </button>
          </div>

          <button
            onClick={() => setTimeRange(timeRange === '30D' ? '7D' : '30D')}
            className="glass-card px-3.5 py-2 rounded-lg font-body-sm text-[13px] text-[#dfe2ef] hover:bg-[#31353f] transition-colors flex items-center gap-2 cursor-pointer shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px] text-[#adc6ff]">filter_list</span>
            <span>Filtros ({timeRange})</span>
          </button>
        </div>
      </div>

      {/* 4 KPIs Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Ventas Netas */}
        <div className="glass-card p-4 rounded-xl glow-hover transition-all duration-300 relative overflow-hidden group">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-[#4edea3]/10 rounded-full blur-xl group-hover:bg-[#4edea3]/20 transition-colors pointer-events-none" />
          <div className="flex justify-between items-start mb-3 relative z-10">
            <span className="font-body-sm text-[13px] text-[#c2c6d6]">Ventas Netas (M)</span>
            <span className="material-symbols-outlined text-[#4edea3] bg-[#4edea3]/10 p-1.5 rounded-lg text-[20px]">
              trending_up
            </span>
          </div>
          <div className="relative z-10">
            <span className="font-display-lg font-data-mono text-3xl lg:text-4xl font-extrabold text-[#dfe2ef] tracking-tight">
              ${dashboardMetrics.sales.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </span>
            <div className="flex items-center gap-1 mt-1.5 text-[#4edea3]">
              <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
              <span className="font-body-sm font-data-mono text-[12px] font-medium">
                {orders.filter((order) => ['pagado', 'facturado', 'entregado'].includes(order.status)).length} ventas registradas
              </span>
            </div>
          </div>
        </div>

        {/* KPI 2: Órdenes Activas */}
        <div
          onClick={onNavigateTaller}
          className="glass-card p-4 rounded-xl glow-hover transition-all duration-300 relative overflow-hidden group cursor-pointer border hover:border-[#4d8eff]/50"
        >
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-[#4d8eff]/10 rounded-full blur-xl group-hover:bg-[#4d8eff]/20 transition-colors pointer-events-none" />
          <div className="flex justify-between items-start mb-3 relative z-10">
            <span className="font-body-sm text-[13px] text-[#c2c6d6]">Órdenes Activas</span>
            <span className="material-symbols-outlined text-[#4d8eff] bg-[#4d8eff]/10 p-1.5 rounded-lg text-[20px]">
              shopping_cart
            </span>
          </div>
          <div className="relative z-10">
            <span className="font-display-lg font-data-mono text-3xl lg:text-4xl font-extrabold text-[#dfe2ef] tracking-tight">
              {dashboardMetrics.activeOrders}
            </span>
            <div className="flex items-center gap-1 mt-1.5 text-[#adc6ff]">
              <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
              <span className="font-body-sm font-data-mono text-[12px] font-medium">En seguimiento operativo</span>
            </div>
          </div>
        </div>

        {/* KPI 3: Reclamos Pendientes */}
        <div className="glass-card p-4 rounded-xl glow-hover transition-all duration-300 relative overflow-hidden group border-[#f59e0b]/30">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-[#f59e0b]/10 rounded-full blur-xl group-hover:bg-[#f59e0b]/20 transition-colors pointer-events-none" />
          <div className="flex justify-between items-start mb-3 relative z-10">
            <span className="font-body-sm text-[13px] text-[#c2c6d6]">Reclamos Pendientes</span>
            <span className="material-symbols-outlined text-[#f59e0b] bg-[#f59e0b]/10 p-1.5 rounded-lg text-[20px]">
              warning
            </span>
          </div>
          <div className="relative z-10">
            <span className="font-display-lg font-data-mono text-3xl lg:text-4xl font-extrabold text-[#dfe2ef] tracking-tight">
              {dashboardMetrics.claims}
            </span>
            <div className="flex items-center gap-1 mt-1.5 text-[#f59e0b]">
              <span className="material-symbols-outlined text-[14px]">arrow_downward</span>
              <span className="font-body-sm font-data-mono text-[12px] font-medium">Requieren resolución</span>
            </div>
          </div>
        </div>

        {/* KPI 4: Alertas SLA */}
        <div className="glass-card p-4 rounded-xl glow-hover transition-all duration-300 relative overflow-hidden group border-[#ef4444]/30">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-[#ef4444]/10 rounded-full blur-xl group-hover:bg-[#ef4444]/20 transition-colors pointer-events-none" />
          <div className="flex justify-between items-start mb-3 relative z-10">
            <span className="font-body-sm text-[13px] text-[#c2c6d6]">Alertas SLA</span>
            <span className="material-symbols-outlined text-[#ef4444] bg-[#ef4444]/10 p-1.5 rounded-lg text-[20px]">
              timer_off
            </span>
          </div>
          <div className="relative z-10">
            <span className="font-display-lg font-data-mono text-3xl lg:text-4xl font-extrabold text-[#dfe2ef] tracking-tight">
              {dashboardMetrics.overdueSlas}
            </span>
            <div className="flex items-center gap-1 mt-1.5 text-[#ef4444]">
              <span className="material-symbols-outlined text-[14px]">priority_high</span>
              <span className="font-body-sm font-data-mono text-[12px] font-medium">
                Requieren atención
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Bento Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Tendencia de Ventas */}
        <div className="glass-card rounded-xl lg:col-span-2 flex flex-col glow-hover transition-all">
          <div className="p-4 border-b border-[rgba(255,255,255,0.08)] flex justify-between items-center">
            <div>
              <h3 className="font-headline-sm text-[18px] font-bold text-[#dfe2ef]">Tendencia de Ventas</h3>
              <p className="font-body-sm text-[13px] text-[#c2c6d6]">
                Volumen diario últimos {timeRange === '30D' ? '30 días' : timeRange === '7D' ? '7 días' : '90 días'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {hoveredBar && (
                <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded bg-[#0a0e17] border border-[#4d8eff]/30 text-xs font-data-mono">
                  <span className="text-[#c2c6d6]">{hoveredBar.day}:</span>
                  <span className="text-[#4edea3] font-bold">{hoveredBar.amount}</span>
                  <span className="text-[#adc6ff]">({hoveredBar.count} órdenes)</span>
                </div>
              )}
              <div className="flex bg-[#0f131c] rounded-lg p-0.5 border border-[rgba(255,255,255,0.08)]">
                {(['7D', '30D', '90D'] as const).map((range) => (
                  <button
                    key={range}
                    onClick={() => setTimeRange(range)}
                    className={`px-2 py-1 text-xs font-data-mono rounded cursor-pointer transition-colors ${
                      timeRange === range
                        ? 'bg-[#4d8eff] text-[#00285d] font-bold'
                        : 'text-[#c2c6d6] hover:text-[#dfe2ef]'
                    }`}
                  >
                    {range}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Area / Bars Representation */}
          <div className="p-4 flex-1 relative min-h-[260px] flex items-end justify-between gap-1.5 sm:gap-3 overflow-hidden">
            {/* Gradient backdrop */}
            <div
              className="w-full h-full absolute inset-0 opacity-20 pointer-events-none"
              style={{
                background: 'linear-gradient(to top, #4d8eff 0%, transparent 100%)',
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
                  className={`w-full rounded-t transition-all duration-200 ${
                    bar.isLatest
                      ? 'bg-[#4d8eff]/60 group-hover:bg-[#4d8eff] border-t-2 border-[#adc6ff] shadow-[0_0_12px_rgba(77,142,255,0.4)]'
                      : 'bg-[#4d8eff]/30 group-hover:bg-[#4d8eff]/60'
                  }`}
                />
              </div>
            ))}
          </div>

          {/* X-Axis labels */}
          <div className="px-4 pb-3 flex justify-between font-data-label text-[11px] text-[#c2c6d6] border-t border-[rgba(255,255,255,0.08)] pt-2 tracking-wider">
            <span>01 Nov</span>
            <span>15 Nov</span>
            <span>30 Nov</span>
          </div>
        </div>

        {/* Distribución por Estado */}
        <div className="glass-card rounded-xl flex flex-col glow-hover transition-all">
          <div className="p-4 border-b border-[rgba(255,255,255,0.08)] flex justify-between items-center">
            <h3 className="font-headline-sm text-[18px] font-bold text-[#dfe2ef]">Distribución por Estado</h3>
            <span className="material-symbols-outlined text-[#c2c6d6] text-[20px]">pie_chart</span>
          </div>

          <div className="p-4 flex flex-col gap-4 flex-1 justify-center">
            {dashboardMetrics.distribution.map((item) => (
              <div key={item.label} className="w-full">
                <div className="flex justify-between font-body-sm text-[13px] mb-1.5">
                  <span className="text-[#dfe2ef] font-medium">{item.label}</span>
                  <span className="font-data-mono font-bold" style={{ color: item.color }}>
                    {item.percentage}% <span className="text-[#c2c6d6] font-normal">({item.count})</span>
                  </span>
                </div>
                <div className="h-2 w-full bg-[#31353f] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${item.percentage}%`, backgroundColor: item.color, boxShadow: `0 0 8px ${item.color}` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Secondary Section: SLAs & Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Monitor de SLAs (Taller & CRM) */}
        <div className="glass-card rounded-xl flex flex-col overflow-hidden">
          <div className="p-4 border-b border-[rgba(255,255,255,0.08)] flex justify-between items-center">
            <h3 className="font-headline-sm text-[18px] font-bold text-[#dfe2ef]">
              Monitor de SLAs (Taller & CRM)
            </h3>
            <span className="text-xs font-data-label px-2 py-0.5 rounded bg-[#31353f] text-[#adc6ff]">
              EN VIVO
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#181b25] font-data-label text-[11px] text-[#c2c6d6] uppercase tracking-wider">
                  <th className="p-3 font-semibold border-b border-[rgba(255,255,255,0.08)]">Métrica</th>
                  <th className="p-3 font-semibold border-b border-[rgba(255,255,255,0.08)] text-center">Estado</th>
                  <th className="p-3 font-semibold border-b border-[rgba(255,255,255,0.08)] text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="font-body-sm text-[13px] divide-y divide-[rgba(255,255,255,0.08)]">
                {(slaMetrics || []).map((sla) => {
                  let badgeStyles = 'bg-[#4edea3]/10 text-[#4edea3] border-[#4edea3]/25';
                  let dotStyles = 'bg-[#4edea3] shadow-[0_0_4px_rgba(78,222,163,0.8)]';

                  if (sla.status === 'attention') {
                    badgeStyles = 'bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/25';
                    dotStyles = 'bg-[#f59e0b] shadow-[0_0_4px_rgba(245,158,11,0.8)]';
                  } else if (sla.status === 'overdue') {
                    badgeStyles = 'bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/25';
                    dotStyles = 'bg-[#ef4444] shadow-[0_0_4px_rgba(239,68,68,0.8)]';
                  }

                  return (
                    <tr
                      key={sla.id}
                      onClick={onNavigateTaller}
                      className="hover:bg-[#31353f]/40 transition-colors cursor-pointer"
                    >
                      <td className="p-3 text-[#dfe2ef] font-medium">{sla.name}</td>
                      <td className="p-3 text-center">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${badgeStyles}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${dotStyles}`} />
                          {sla.statusLabel}
                        </span>
                      </td>
                      <td className="p-3 text-right font-data-mono text-[#c2c6d6] font-medium">
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
        <div className="glass-card rounded-xl flex flex-col max-h-[420px]">
          <div className="p-4 border-b border-[rgba(255,255,255,0.08)] flex justify-between items-center">
            <h3 className="font-headline-sm text-[18px] font-bold text-[#dfe2ef]">Actividad Reciente</h3>
          </div>

          <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-2.5">
            {(activities || []).slice(0, 4).map((item) => {
              let iconBg = 'bg-[#4d8eff] text-[#00285d]';
              if (item.type === 'workshop') {
                iconBg = 'bg-[#f59e0b]/20 text-[#f59e0b] border border-[#f59e0b]/30';
              } else if (item.type === 'lead') {
                iconBg = 'bg-[#4edea3]/20 text-[#4edea3] border border-[#4edea3]/30';
              } else if (item.type === 'alert') {
                iconBg = 'bg-[#ef4444]/20 text-[#ef4444] border border-[#ef4444]/30';
              }

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    if (item.id === 'act-1') onSelectOrder('ORD-8924A');
                    else onNavigateTaller();
                  }}
                  className="flex gap-3 p-2 rounded-lg hover:bg-[#31353f]/50 transition-colors cursor-pointer group"
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${iconBg}`}
                  >
                    <span className="material-symbols-outlined text-[16px]">{item.icon}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-body-sm text-[13px] text-[#dfe2ef] leading-snug group-hover:text-white transition-colors">
                      {item.title}
                    </p>
                    <span className="font-data-label text-[11px] text-[#c2c6d6] block mt-0.5 opacity-80">
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
