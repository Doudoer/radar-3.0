import React, { useMemo, useState } from 'react';
import { SLAMetric, ActivityItem, Order } from '../types';

interface DashboardViewProps {
  orders: Order[];
  slaMetrics: SLAMetric[];
  activities: ActivityItem[];
  onSelectOrder: (orderId: string) => void;
  onNavigateTaller: () => void;
}

export type PeriodType = 'semana' | 'mes' | 'ano';

/**
 * Robust date parser supporting ISO strings, Spanish locale strings, DD/MM/YYYY, Hoy, and Ayer.
 */
export const parseOrderDate = (order: Order): Date | null => {
  const raw = order.createdAtIso || order.createdAt;
  if (!raw) return null;
  const str = String(raw).trim();
  if (!str) return null;

  if (str.toLowerCase().startsWith('hoy')) {
    return new Date();
  }
  if (str.toLowerCase().startsWith('ayer')) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday;
  }

  // Prioritize Slash formatted DD/MM/YYYY (e.g. "12/10/2026, 14:15") before direct parse
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const day = parseInt(slashMatch[1], 10);
    const month = parseInt(slashMatch[2], 10) - 1;
    const year = parseInt(slashMatch[3], 10);
    return new Date(year, month, day, 12, 0, 0);
  }

  // Check direct parse (e.g. ISO string "2026-10-12T10:30:00Z")
  const direct = new Date(str);
  if (!isNaN(direct.getTime()) && direct.getFullYear() > 2000) {
    return direct;
  }

  // Regex matching "DD [mes] YYYY"
  const spanishMonths: Record<string, number> = {
    ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5,
    jul: 6, ago: 7, sep: 8, oct: 9, nov: 10, dic: 11,
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
  };
  const match = str.match(/(\d{1,2})\s+([a-zA-ZáéíóúÁÉÍÓÚ]+)\.?\s+(\d{4})/i);
  if (match) {
    const day = parseInt(match[1], 10);
    const monthStr = match[2].toLowerCase().slice(0, 3);
    const year = parseInt(match[3], 10);
    const month = spanishMonths[monthStr] ?? 0;
    return new Date(year, month, day, 12, 0, 0);
  }

  return null;
};

/**
 * Operative Week Range: Monday 00:00:00.000 to Sunday 23:59:59.999
 */
export const getWeekRange = (weekOffset = 0) => {
  const now = new Date();
  now.setDate(now.getDate() + weekOffset * 7);
  const day = now.getDay(); // 0 is Sunday, 1 is Monday ... 6 is Saturday
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const start = new Date(now);
  start.setDate(now.getDate() + diffToMonday);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
};

/**
 * Operative Month Range: 1st 00:00:00.000 to last day of month 23:59:59.999
 */
export const getMonthRange = (monthOffset = 0) => {
  const now = new Date();
  now.setMonth(now.getMonth() + monthOffset);
  const year = now.getFullYear();
  const month = now.getMonth();

  const start = new Date(year, month, 1, 0, 0, 0, 0);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);

  return { start, end, year, month };
};

/**
 * Operative Year Range: Jan 1 00:00:00.000 to Dec 31 23:59:59.999
 */
export const getYearRange = (yearOffset = 0) => {
  const now = new Date();
  const year = now.getFullYear() + yearOffset;

  const start = new Date(year, 0, 1, 0, 0, 0, 0);
  const end = new Date(year, 11, 31, 23, 59, 59, 999);

  return { start, end, year };
};

export const DashboardView: React.FC<DashboardViewProps> = ({
  orders = [],
  slaMetrics = [],
  activities = [],
  onSelectOrder,
  onNavigateTaller,
}) => {
  // Period filter states: 'semana' (default), 'mes', 'ano'
  const [periodType, setPeriodType] = useState<PeriodType>('semana');
  const [weekOffset, setWeekOffset] = useState<number>(0);
  const [monthOffset, setMonthOffset] = useState<number>(0);
  const [yearOffset, setYearOffset] = useState<number>(0);

  const [hoveredBar, setHoveredBar] = useState<{
    label: string;
    fullLabel: string;
    amount: string;
    count: number;
    salesCount: number;
  } | null>(null);

  const [lastUpdated, setLastUpdated] = useState(() =>
    new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date())
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Active Period Range Calculation
  const currentPeriodRange = useMemo(() => {
    if (periodType === 'semana') {
      return getWeekRange(weekOffset);
    }
    if (periodType === 'mes') {
      return getMonthRange(monthOffset);
    }
    return getYearRange(yearOffset);
  }, [periodType, weekOffset, monthOffset, yearOffset]);

  // Formatted Label for the Active Period
  const periodLabel = useMemo(() => {
    if (periodType === 'semana') {
      const { start, end } = currentPeriodRange;
      const startStr = start.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
      const endStr = end.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
      const isCurrent = weekOffset === 0;
      return {
        title: `Semana: Lun ${startStr} — Dom ${endStr}`,
        subtitle: isCurrent ? 'Semana operativa actual (Lunes a Domingo)' : 'Semana histórica auditada',
        isCurrent,
      };
    }
    if (periodType === 'mes') {
      const { start } = currentPeriodRange;
      const monthName = start.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
      const capitalized = monthName.charAt(0).toUpperCase() + monthName.slice(1);
      const isCurrent = monthOffset === 0;
      return {
        title: `Mes: ${capitalized}`,
        subtitle: isCurrent ? 'Mes en curso (1 al último día)' : 'Mes histórico auditado',
        isCurrent,
      };
    }
    const { start } = currentPeriodRange;
    const year = start.getFullYear();
    const isCurrent = yearOffset === 0;
    return {
      title: `Año Operativo: ${year}`,
      subtitle: isCurrent ? 'Año en curso (Enero a Diciembre)' : 'Año histórico auditado',
      isCurrent,
    };
  }, [periodType, currentPeriodRange, weekOffset, monthOffset, yearOffset]);

  // Filter Orders within the selected period
  const periodOrders = useMemo(() => {
    const { start, end } = currentPeriodRange;
    return orders.filter((order) => {
      const d = parseOrderDate(order);
      if (!d) return false;
      return d >= start && d <= end;
    });
  }, [orders, currentPeriodRange]);

  // Operational & Financial Metrics for the active period
  const dashboardMetrics = useMemo(() => {
    const activeStatuses = new Set([
      'en_preparacion',
      'listo_despacho',
      'listo_retiro',
      'en_camino',
      'en_diagnostico',
      'en_reparacion',
      'en_proceso',
    ]);
    const paidSaleStatuses = new Set([
      'pagado',
      'en_preparacion',
      'listo_despacho',
      'listo_retiro',
      'en_camino',
      'entregado',
      'facturado',
    ]);
    const pendingStatuses = new Set([
      'cotizacion',
      'espera_confirmacion',
      'pendiente_aprobacion',
      'listo_pago',
    ]);
    const issueStatuses = new Set([
      'reclamo',
      'cancelado',
      'solicitud_reembolso',
      'reembolsado',
    ]);

    const salesOrders = periodOrders.filter((order) => paidSaleStatuses.has(order.status));
    const totalSales = salesOrders.reduce((sum, order) => {
      return sum + (order.financials?.partPrice ?? order.financials?.total ?? order.financials?.subtotal ?? 0);
    }, 0);

    const totalAdvanceCollected = periodOrders.reduce((sum, order) => {
      if (order.status === 'pagado' || order.status === 'entregado' || order.status === 'facturado') {
        return sum + (order.financials?.partPrice ?? order.financials?.total ?? 0);
      }
      return sum + (order.financials?.downPayment ?? order.financials?.advancePayment ?? 0);
    }, 0);

    const totalBalanceDue = salesOrders.reduce((sum, order) => {
      const total = order.financials?.partPrice ?? order.financials?.total ?? 0;
      const down = order.financials?.downPayment ?? order.financials?.advancePayment ?? 0;
      return sum + (order.financials?.balanceDue ?? Math.max(0, total - down));
    }, 0);

    const activeInWorkshop = periodOrders.filter((order) => activeStatuses.has(order.status)).length;
    const claimsCount = periodOrders.filter(
      (order) => order.status === 'reclamo' || order.status === 'solicitud_reembolso'
    ).length;

    const totalCount = Math.max(periodOrders.length, 1);
    const avgTicket = salesOrders.length > 0 ? Math.round(totalSales / salesOrders.length) : 0;

    return {
      totalOrders: periodOrders.length,
      salesOrdersCount: salesOrders.length,
      totalSales,
      avgTicket,
      totalAdvanceCollected,
      totalBalanceDue,
      activeInWorkshop,
      claimsCount,
      overdueSlas: slaMetrics.filter((sla) => sla.status === 'overdue').length,
      distribution: [
        {
          label: 'En taller / Proceso',
          count: periodOrders.filter((o) => activeStatuses.has(o.status)).length,
          color: '#22d3ee',
        },
        {
          label: 'Ventas cerradas / Pagadas',
          count: salesOrders.length,
          color: '#34d399',
        },
        {
          label: 'Cotizaciones / Esperando acción',
          count: periodOrders.filter((o) => pendingStatuses.has(o.status)).length,
          color: '#fbbf24',
        },
        {
          label: 'Incidencias / Reclamos',
          count: periodOrders.filter((o) => issueStatuses.has(o.status)).length,
          color: '#f87171',
        },
      ].map((item) => ({
        ...item,
        percentage: periodOrders.length > 0 ? Math.round((item.count / totalCount) * 100) : 0,
      })),
    };
  }, [periodOrders, slaMetrics]);

  // Dynamic Commercial Volume Bar Chart
  const trendBars = useMemo(() => {
    const paidSaleStatuses = new Set([
      'pagado',
      'en_preparacion',
      'listo_despacho',
      'listo_retiro',
      'en_camino',
      'entregado',
      'facturado',
    ]);

    const today = new Date();

    if (periodType === 'semana') {
      // 7 bars: Monday to Sunday of the active operative week
      const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
      const fullDayNames = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
      const result = [];
      const { start } = currentPeriodRange;

      for (let i = 0; i < 7; i++) {
        const dayDate = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12, 0, 0);
        const dayOrders = periodOrders.filter((order) => {
          const d = parseOrderDate(order);
          return (
            d &&
            d.getFullYear() === dayDate.getFullYear() &&
            d.getMonth() === dayDate.getMonth() &&
            d.getDate() === dayDate.getDate()
          );
        });

        const daySalesOrders = dayOrders.filter((o) => paidSaleStatuses.has(o.status));
        const dayAmount = daySalesOrders.reduce(
          (sum, o) => sum + (o.financials?.partPrice ?? o.financials?.total ?? 0),
          0
        );

        const isToday =
          dayDate.getFullYear() === today.getFullYear() &&
          dayDate.getMonth() === today.getMonth() &&
          dayDate.getDate() === today.getDate();

        result.push({
          label: `${dayNames[i]} ${String(dayDate.getDate()).padStart(2, '0')}`,
          fullLabel: `${fullDayNames[i]} ${dayDate.getDate()} de ${dayDate.toLocaleDateString('es-ES', { month: 'short' })}`,
          rawAmount: dayAmount,
          amount: `$${dayAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
          count: dayOrders.length,
          salesCount: daySalesOrders.length,
          isHighlight: isToday,
        });
      }

      const maxAmount = Math.max(...result.map((r) => r.rawAmount), 1);
      return result.map((r) => ({
        ...r,
        height: r.rawAmount > 0 ? `${Math.max(12, Math.round((r.rawAmount / maxAmount) * 100))}%` : '6%',
      }));
    }

    if (periodType === 'mes') {
      // Month breakdown into weekly periods
      const { year, month } = getMonthRange(monthOffset);
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const segments = [
        { label: 'Sem 1', rangeStr: 'Días 1-7', startDay: 1, endDay: 7 },
        { label: 'Sem 2', rangeStr: 'Días 8-14', startDay: 8, endDay: 14 },
        { label: 'Sem 3', rangeStr: 'Días 15-21', startDay: 15, endDay: 21 },
        { label: 'Sem 4', rangeStr: 'Días 22-28', startDay: 22, endDay: 28 },
      ];
      if (daysInMonth > 28) {
        segments.push({
          label: 'Sem 5',
          rangeStr: `Días 29-${daysInMonth}`,
          startDay: 29,
          endDay: daysInMonth,
        });
      }

      const result = segments.map((seg) => {
        const segOrders = periodOrders.filter((order) => {
          const d = parseOrderDate(order);
          return d && d.getDate() >= seg.startDay && d.getDate() <= seg.endDay;
        });
        const segSales = segOrders.filter((o) => paidSaleStatuses.has(o.status));
        const segAmount = segSales.reduce(
          (sum, o) => sum + (o.financials?.partPrice ?? o.financials?.total ?? 0),
          0
        );
        const isCurrent =
          monthOffset === 0 &&
          today.getDate() >= seg.startDay &&
          today.getDate() <= seg.endDay;

        return {
          label: `${seg.label} (${seg.startDay}-${seg.endDay})`,
          fullLabel: `${seg.label} · ${seg.rangeStr}`,
          rawAmount: segAmount,
          amount: `$${segAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
          count: segOrders.length,
          salesCount: segSales.length,
          isHighlight: isCurrent,
        };
      });

      const maxAmount = Math.max(...result.map((r) => r.rawAmount), 1);
      return result.map((r) => ({
        ...r,
        height: r.rawAmount > 0 ? `${Math.max(12, Math.round((r.rawAmount / maxAmount) * 100))}%` : '6%',
      }));
    }

    // periodType === 'ano': 12 months
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const fullMonthNames = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
    ];

    const result = monthNames.map((name, mIdx) => {
      const mOrders = periodOrders.filter((order) => {
        const d = parseOrderDate(order);
        return d && d.getMonth() === mIdx;
      });
      const mSales = mOrders.filter((o) => paidSaleStatuses.has(o.status));
      const mAmount = mSales.reduce(
        (sum, o) => sum + (o.financials?.partPrice ?? o.financials?.total ?? 0),
        0
      );
      const isCurrent = yearOffset === 0 && today.getMonth() === mIdx;

      return {
        label: name,
        fullLabel: `${fullMonthNames[mIdx]} (${currentPeriodRange.start.getFullYear()})`,
        rawAmount: mAmount,
        amount: `$${mAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
        count: mOrders.length,
        salesCount: mSales.length,
        isHighlight: isCurrent,
      };
    });

    const maxAmount = Math.max(...result.map((r) => r.rawAmount), 1);
    return result.map((r) => ({
      ...r,
      height: r.rawAmount > 0 ? `${Math.max(12, Math.round((r.rawAmount / maxAmount) * 100))}%` : '6%',
    }));
  }, [periodType, periodOrders, currentPeriodRange, monthOffset, yearOffset]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setLastUpdated(
        new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date())
      );
      setIsRefreshing(false);
    }, 600);
  };

  const resetToCurrentWeek = () => {
    setPeriodType('semana');
    setWeekOffset(0);
    setMonthOffset(0);
    setYearOffset(0);
  };

  return (
    <div className="radar-view pb-8">
      {/* Page Header with Cyber HUD Badge & Period Selectors */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
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
              {periodLabel.subtitle} • Captura: <span className="text-cyan-300">{lastUpdated}</span>
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

        {/* Period Selector & Navigator Controls */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2.5">
          {/* Granularity segmented buttons: Semana (Default) | Mes | Año */}
          <div className="flex bg-[#040814]/90 rounded-2xl p-1 border border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.15)]">
            <button
              type="button"
              onClick={() => {
                setPeriodType('semana');
                setWeekOffset(0);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                periodType === 'semana'
                  ? 'bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.4)]'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/40'
              }`}
              title="Mostrar datos operativos de la semana (Lunes a Domingo)"
            >
              <span className="material-symbols-outlined text-[16px]">calendar_view_week</span>
              <span>Semana</span>
              {periodType === 'semana' && weekOffset === 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-slate-950" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setPeriodType('mes');
                setMonthOffset(0);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                periodType === 'mes'
                  ? 'bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.4)]'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/40'
              }`}
              title="Consultar datos operativos agrupados por mes"
            >
              <span className="material-symbols-outlined text-[16px]">calendar_month</span>
              <span>Mes</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setPeriodType('ano');
                setYearOffset(0);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                periodType === 'ano'
                  ? 'bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.4)]'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/40'
              }`}
              title="Consultar consolidado operativo anual"
            >
              <span className="material-symbols-outlined text-[16px]">analytics</span>
              <span>Año</span>
            </button>
          </div>

          {/* Period Date Navigator */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (periodType === 'semana') setWeekOffset((w) => w - 1);
                else if (periodType === 'mes') setMonthOffset((m) => m - 1);
                else setYearOffset((y) => y - 1);
              }}
              className="p-2 rounded-xl bg-[#060e1d]/90 border border-cyan-500/30 text-slate-300 hover:text-cyan-300 hover:border-cyan-400 transition-all cursor-pointer shadow-[0_0_10px_rgba(6,182,212,0.1)]"
              title="Período anterior"
            >
              <span className="material-symbols-outlined text-[18px]">chevron_left</span>
            </button>

            <div className="px-3 py-1.5 rounded-xl bg-[#060e1d]/90 border border-cyan-500/30 flex items-center gap-2 text-xs font-mono shadow-[0_0_15px_rgba(6,182,212,0.15)]">
              <span className="material-symbols-outlined text-[16px] text-cyan-400">
                {periodType === 'semana' ? 'event' : periodType === 'mes' ? 'calendar_month' : 'date_range'}
              </span>
              <span className="font-bold text-white whitespace-nowrap">{periodLabel.title}</span>
              {periodLabel.isCurrent && (
                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Actual
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                if (periodType === 'semana') setWeekOffset((w) => w + 1);
                else if (periodType === 'mes') setMonthOffset((m) => m + 1);
                else setYearOffset((y) => y + 1);
              }}
              disabled={periodLabel.isCurrent}
              className={`p-2 rounded-xl bg-[#060e1d]/90 border border-cyan-500/30 text-slate-300 transition-all ${
                periodLabel.isCurrent
                  ? 'opacity-35 cursor-not-allowed'
                  : 'hover:text-cyan-300 hover:border-cyan-400 cursor-pointer shadow-[0_0_10px_rgba(6,182,212,0.1)]'
              }`}
              title="Período siguiente"
            >
              <span className="material-symbols-outlined text-[18px]">chevron_right</span>
            </button>

            {(!periodLabel.isCurrent || periodType !== 'semana') && (
              <button
                type="button"
                onClick={resetToCurrentWeek}
                className="px-2.5 py-1.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-400/40 text-[11px] font-mono text-cyan-300 font-bold flex items-center gap-1 cursor-pointer transition-all shadow-[0_0_10px_rgba(6,182,212,0.15)]"
                title="Volver a la semana operativa actual en curso"
              >
                <span className="material-symbols-outlined text-[14px]">replay</span>
                <span className="hidden sm:inline">Semana Actual</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 4 KPIs Cyber HUD Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
        {/* KPI 1: Ventas Consolidadas del Período */}
        <div className="relative rounded-2xl bg-[#070c18]/90 backdrop-blur-2xl border border-emerald-500/35 p-5 shadow-[0_15px_35px_rgba(0,0,0,0.7),0_0_30px_rgba(16,185,129,0.15)] overflow-hidden group hover:border-emerald-400 transition-all">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_12px_#34d399]" />
          <div className="flex justify-between items-start mb-3 relative z-10">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-emerald-400/90">
              Ventas del Período
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-400/40 flex items-center justify-center text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.3)]">
              <span className="material-symbols-outlined text-[18px]">trending_up</span>
            </div>
          </div>
          <div className="relative z-10">
            <span className="font-mono text-3xl lg:text-4xl font-black text-white tracking-tight drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">
              ${dashboardMetrics.totalSales.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </span>
            <div className="flex items-center gap-1.5 mt-2 text-emerald-300 text-xs font-mono font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>
                {dashboardMetrics.salesOrdersCount} ventas • Ticket prom: ${dashboardMetrics.avgTicket.toLocaleString('en-US')}
              </span>
            </div>
          </div>
        </div>

        {/* KPI 2: Órdenes Operativas en Taller/Proceso */}
        <div
          onClick={onNavigateTaller}
          className="relative rounded-2xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/35 p-5 shadow-[0_15px_35px_rgba(0,0,0,0.7),0_0_30px_rgba(6,182,212,0.15)] overflow-hidden group hover:border-cyan-400 transition-all cursor-pointer"
        >
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#22d3ee]" />
          <div className="flex justify-between items-start mb-3 relative z-10">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-cyan-400/90">
              Órdenes Operativas
            </span>
            <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center text-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.3)]">
              <span className="material-symbols-outlined text-[18px]">inventory_2</span>
            </div>
          </div>
          <div className="relative z-10">
            <span className="font-mono text-3xl lg:text-4xl font-black text-white tracking-tight drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">
              {dashboardMetrics.totalOrders}
            </span>
            <div className="flex items-center gap-1.5 mt-2 text-cyan-300 text-xs font-mono font-semibold">
              <span className="material-symbols-outlined text-[14px]">precision_manufacturing</span>
              <span>{dashboardMetrics.activeInWorkshop} activas en taller / proceso</span>
            </div>
          </div>
        </div>

        {/* KPI 3: Finanzas: Cobrado vs Saldo Pendiente */}
        <div className="relative rounded-2xl bg-[#070c18]/90 backdrop-blur-2xl border border-blue-500/35 p-5 shadow-[0_15px_35px_rgba(0,0,0,0.7),0_0_30px_rgba(59,130,246,0.15)] overflow-hidden group hover:border-blue-400 transition-all">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-blue-400 to-transparent shadow-[0_0_12px_#60a5fa]" />
          <div className="flex justify-between items-start mb-3 relative z-10">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-blue-400/90">
              Cobranza & Abonos
            </span>
            <div className="w-8 h-8 rounded-xl bg-blue-500/15 border border-blue-400/40 flex items-center justify-center text-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.3)]">
              <span className="material-symbols-outlined text-[18px]">payments</span>
            </div>
          </div>
          <div className="relative z-10">
            <span className="font-mono text-3xl lg:text-4xl font-black text-white tracking-tight drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">
              ${dashboardMetrics.totalAdvanceCollected.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </span>
            <div className="flex items-center gap-1.5 mt-2 text-blue-300 text-xs font-mono font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              <span>Por cobrar: ${dashboardMetrics.totalBalanceDue.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
            </div>
          </div>
        </div>

        {/* KPI 4: Reclamos e Incidencias */}
        <div className="relative rounded-2xl bg-[#070c18]/90 backdrop-blur-2xl border border-amber-500/35 p-5 shadow-[0_15px_35px_rgba(0,0,0,0.7),0_0_30px_rgba(245,158,11,0.15)] overflow-hidden group hover:border-amber-400 transition-all">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_12px_#fbbf24]" />
          <div className="flex justify-between items-start mb-3 relative z-10">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-amber-400/90">
              Reclamos & Incidencias
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-400/40 flex items-center justify-center text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.3)]">
              <span className="material-symbols-outlined text-[18px]">warning</span>
            </div>
          </div>
          <div className="relative z-10">
            <span className="font-mono text-3xl lg:text-4xl font-black text-white tracking-tight drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">
              {dashboardMetrics.claimsCount}
            </span>
            <div className="flex items-center gap-1.5 mt-2 text-amber-300 text-xs font-mono font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>{dashboardMetrics.overdueSlas} alertas de tiempo SLA</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Bento Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-5">
        {/* Tendencia de Ventas (Dynamic HUD Graph) */}
        <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.7)] lg:col-span-2 flex flex-col overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 shadow-[0_0_12px_#22d3ee]" />

          <div className="pb-4 border-b border-cyan-500/15 flex flex-wrap justify-between items-center gap-3">
            <div>
              <h3 className="text-lg font-black text-white">Tendencia de Volumen Comercial</h3>
              <p className="text-xs text-slate-400 font-mono">
                {periodType === 'semana'
                  ? 'Actividad diaria de la semana operativa (Lunes a Domingo)'
                  : periodType === 'mes'
                  ? 'Distribución por semanas del mes seleccionado'
                  : 'Volumen consolidado mes a mes del año'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {hoveredBar && (
                <div className="flex items-center gap-2 px-3 py-1 rounded-xl bg-[#040814] border border-cyan-400/40 text-xs font-mono shadow-[0_0_12px_rgba(6,182,212,0.25)]">
                  <span className="text-slate-400">{hoveredBar.fullLabel || hoveredBar.label}:</span>
                  <span className="text-emerald-400 font-black">{hoveredBar.amount}</span>
                  <span className="text-cyan-300">
                    ({hoveredBar.salesCount} ventas • {hoveredBar.count} órdenes)
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Area / Dynamic Bars Representation */}
          <div className="py-6 flex-1 relative min-h-[220px] flex items-end justify-between gap-1.5 sm:gap-3 overflow-hidden">
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
                {/* Bar hover tooltip for mobile / quick click */}
                <div
                  style={{ height: bar.height }}
                  className={`w-full rounded-t-xl transition-all duration-300 ${
                    bar.isHighlight
                      ? 'bg-gradient-to-t from-cyan-500 via-blue-500 to-emerald-400 group-hover:scale-105 shadow-[0_0_20px_rgba(34,211,238,0.5)] border-t-2 border-white'
                      : bar.rawAmount > 0
                      ? 'bg-gradient-to-t from-cyan-500/40 to-emerald-500/60 group-hover:from-cyan-400 group-hover:to-emerald-400 group-hover:shadow-[0_0_15px_rgba(6,182,212,0.4)]'
                      : 'bg-slate-800/40 group-hover:bg-cyan-500/30'
                  }`}
                />
              </div>
            ))}
          </div>

          {/* X-Axis Dynamic labels */}
          <div className="pt-3 flex justify-between font-mono text-[10px] sm:text-[11px] text-slate-400 border-t border-cyan-500/15 tracking-wider overflow-x-auto">
            {trendBars.map((bar, idx) => (
              <span
                key={idx}
                className={`text-center flex-1 ${
                  bar.isHighlight ? 'text-cyan-300 font-bold drop-shadow-[0_0_6px_#22d3ee]' : ''
                }`}
              >
                {bar.label}
              </span>
            ))}
          </div>
        </div>

        {/* Distribución por Estado en el Período */}
        <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.7)] flex flex-col overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#22d3ee]" />

          <div className="pb-4 border-b border-cyan-500/15 flex justify-between items-center">
            <div>
              <h3 className="text-lg font-black text-white">Distribución Operativa</h3>
              <p className="text-[11px] text-slate-400 font-mono">
                {dashboardMetrics.totalOrders} órdenes registradas en este período
              </p>
            </div>
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
                    style={{
                      width: `${item.percentage}%`,
                      backgroundColor: item.color,
                      boxShadow: `0 0 10px ${item.color}`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Secondary Section: SLAs & Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5">
        {/* Monitor de SLAs */}
        <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.7)] flex flex-col overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#22d3ee]" />

          <div className="pb-4 border-b border-cyan-500/15 flex justify-between items-center">
            <h3 className="text-lg font-black text-white">Monitor de Tiempos SLA</h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 font-bold">
              ● EN LÍNEA
            </span>
          </div>

          <div className="table-responsive-wrapper custom-scrollbar mt-2">
            <table className="w-full text-left border-collapse min-w-[340px]">
              <thead>
                <tr className="font-mono text-[10px] text-cyan-400/80 uppercase tracking-wider border-b border-cyan-500/20">
                  <th className="py-2.5 px-3 font-bold">Métrica</th>
                  <th className="py-2.5 px-3 font-bold text-center">Estado</th>
                  <th className="py-2.5 px-3 font-bold text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="text-xs divide-y divide-cyan-500/10">
                {(slaMetrics || []).map((sla) => {
                  let badgeStyles =
                    'bg-emerald-500/15 text-emerald-300 border-emerald-400/40 shadow-[0_0_8px_rgba(16,185,129,0.25)]';
                  let dotStyles = 'bg-emerald-400 shadow-[0_0_6px_#34d399]';

                  if (sla.status === 'attention') {
                    badgeStyles =
                      'bg-amber-500/15 text-amber-300 border-amber-400/40 shadow-[0_0_8px_rgba(245,158,11,0.25)]';
                    dotStyles = 'bg-amber-400 shadow-[0_0_6px_#fbbf24]';
                  } else if (sla.status === 'overdue') {
                    badgeStyles =
                      'bg-red-500/15 text-red-300 border-red-400/40 shadow-[0_0_8px_rgba(239,68,68,0.25)]';
                    dotStyles = 'bg-red-400 shadow-[0_0_6px_#f87171]';
                  }

                  return (
                    <tr
                      key={sla.id}
                      onClick={onNavigateTaller}
                      className="hover:bg-cyan-500/5 transition cursor-pointer group"
                    >
                      <td className="py-3 px-3 text-slate-200 font-medium group-hover:text-cyan-300">
                        {sla.name}
                      </td>
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
