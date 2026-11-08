import React, { useMemo, useState } from 'react';
import { SLAMetric, ActivityItem, Order } from '../types';
import { useFinanceMovements } from '../hooks/useFinanceState';
import { financeDateKey, FINANCE_TIME_ZONE, movementIncome, movementsInPeriod, parseFinanceDate, shiftDateKey, sumMoney } from '../utils/finance';
import { getMonthRange, getWeekRange, getYearRange, operationalDistribution, orderBalance, parseOrderDate, saleStatuses, scaleNetBars, workshopStatuses } from '../utils/orderAnalytics';
export { getMonthRange, getWeekRange, getYearRange, parseOrderDate } from '../utils/orderAnalytics';

interface DashboardViewProps {
  orders: Order[];
  slaMetrics?: SLAMetric[];
  activities: ActivityItem[];
  onSelectOrder: (orderId: string) => void;
  onNavigateTaller: () => void;
  onRefresh?: () => Promise<void>;
}

export type PeriodType = 'semana' | 'mes' | 'ano';

export const DashboardView: React.FC<DashboardViewProps> = ({
  orders = [],
  slaMetrics = [],
  activities = [],
  onSelectOrder,
  onNavigateTaller,
  onRefresh,
}) => {
  const income = useFinanceMovements(true, 'dashboard');
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
      const startStr = start.toLocaleDateString('es-ES', { timeZone: FINANCE_TIME_ZONE, day: '2-digit', month: 'short' });
      const endStr = end.toLocaleDateString('es-ES', { timeZone: FINANCE_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' });
      const isCurrent = weekOffset === 0;
      return {
        title: `Semana: Lun ${startStr} — Dom ${endStr}`,
        subtitle: isCurrent ? 'Semana operativa actual' : 'Semana seleccionada · sin cierre auditado',
        isCurrent,
      };
    }
    if (periodType === 'mes') {
      const { start } = currentPeriodRange;
      const monthName = start.toLocaleDateString('es-ES', { timeZone: FINANCE_TIME_ZONE, month: 'long', year: 'numeric' });
      const capitalized = monthName.charAt(0).toUpperCase() + monthName.slice(1);
      const isCurrent = monthOffset === 0;
      return {
        title: `Mes: ${capitalized}`,
        subtitle: isCurrent ? 'Mes en curso' : 'Mes seleccionado · sin cierre auditado',
        isCurrent,
      };
    }
    const { start } = currentPeriodRange;
    const year = financeDateKey(start).slice(0, 4);
    const isCurrent = yearOffset === 0;
    return {
      title: `Año Operativo: ${year}`,
      subtitle: isCurrent ? 'Año en curso' : 'Año seleccionado · sin cierre auditado',
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
    const salesOrders = periodOrders.filter((order) => saleStatuses.has(order.status));
    const periodMovements = movementsInPeriod(income.movements, currentPeriodRange);
    const totalSales = movementIncome(periodMovements);
    const totalAdvanceCollected = sumMoney(periodMovements.filter(movement => movement.kind === 'payment').map(movement => movement.amount));
    const totalBalanceDue = sumMoney(salesOrders.map(orderBalance));

    const activeInWorkshop = periodOrders.filter((order) => workshopStatuses.has(order.status)).length;
    const claimsCount = periodOrders.filter(
      (order) => order.status === 'reclamo' || order.status === 'solicitud_reembolso'
    ).length;

    const effectiveDeliveryRate = periodOrders.length > 0
      ? Math.round(((periodOrders.length - claimsCount) / periodOrders.length) * 100)
      : 100;

    return {
      totalOrders: periodOrders.length,
      salesOrdersCount: salesOrders.length,
      totalSales,
      totalAdvanceCollected,
      totalBalanceDue,
      activeInWorkshop,
      claimsCount,
      effectiveDeliveryRate,
      overdueSlas: slaMetrics.filter((sla) => sla.status === 'overdue').length,
      distribution: operationalDistribution(periodOrders),
    };
  }, [periodOrders, slaMetrics, income.movements, currentPeriodRange]);

  // Dynamic Commercial Volume Bar Chart
  const trendBars = useMemo(() => {
    const paidSaleStatuses = saleStatuses;

    const today = new Date();

    if (periodType === 'semana') {
      // 7 bars: Monday to Sunday of the active operative week
      const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
      const fullDayNames = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
      const result = [];
      const { start } = currentPeriodRange;

      for (let i = 0; i < 7; i++) {
        const dayKey = shiftDateKey(financeDateKey(start), i);
        const dayDate = parseFinanceDate(dayKey)!;
        const dayOrders = periodOrders.filter((order) => {
          const d = parseOrderDate(order);
          return (
            d &&
            financeDateKey(d) === dayKey
          );
        });

        const daySalesOrders = dayOrders.filter((o) => paidSaleStatuses.has(o.status));
        const dayAmount = movementIncome(movementsInPeriod(income.movements, currentPeriodRange)
          .filter((movement) => financeDateKey(parseFinanceDate(movement.effectiveAt)!) === dayKey));

        const isToday =
          dayKey === financeDateKey(today);

        result.push({
          label: `${dayNames[i]} ${dayKey.slice(8, 10)}`,
          fullLabel: `${fullDayNames[i]} ${dayKey.slice(8, 10)} de ${dayDate.toLocaleDateString('es-ES', { timeZone: FINANCE_TIME_ZONE, month: 'short' })}`,
          rawAmount: dayAmount,
          amount: `$${dayAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          count: dayOrders.length,
          salesCount: daySalesOrders.length,
          isHighlight: isToday,
        });
      }

      return scaleNetBars(result);
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
          const day = d ? Number(financeDateKey(d).slice(8, 10)) : 0;
          return day >= seg.startDay && day <= seg.endDay;
        });
        const segSales = segOrders.filter((o) => paidSaleStatuses.has(o.status));
        const segAmount = movementIncome(movementsInPeriod(income.movements, currentPeriodRange)
          .filter((movement) => {
            const day = Number(financeDateKey(parseFinanceDate(movement.effectiveAt)!).slice(8, 10));
            return day >= seg.startDay && day <= seg.endDay;
          }));
        const isCurrent =
          monthOffset === 0 &&
          Number(financeDateKey(today).slice(8, 10)) >= seg.startDay &&
          Number(financeDateKey(today).slice(8, 10)) <= seg.endDay;

        return {
          label: `${seg.label} (${seg.startDay}-${seg.endDay})`,
          fullLabel: `${seg.label} · ${seg.rangeStr}`,
          rawAmount: segAmount,
          amount: `$${segAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          count: segOrders.length,
          salesCount: segSales.length,
          isHighlight: isCurrent,
        };
      });

      return scaleNetBars(result);
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
        return d && Number(financeDateKey(d).slice(5, 7)) === mIdx + 1;
      });
      const mSales = mOrders.filter((o) => paidSaleStatuses.has(o.status));
      const mAmount = movementIncome(movementsInPeriod(income.movements, currentPeriodRange)
        .filter((movement) => Number(financeDateKey(parseFinanceDate(movement.effectiveAt)!).slice(5, 7)) === mIdx + 1));
      const isCurrent = yearOffset === 0 && Number(financeDateKey(today).slice(5, 7)) === mIdx + 1;

      return {
        label: name,
        fullLabel: `${fullMonthNames[mIdx]} (${financeDateKey(currentPeriodRange.start).slice(0, 4)})`,
        rawAmount: mAmount,
        amount: `$${mAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        count: mOrders.length,
        salesCount: mSales.length,
        isHighlight: isCurrent,
      };
    });

    return scaleNetBars(result);
  }, [periodType, periodOrders, currentPeriodRange, monthOffset, yearOffset, income.movements]);
  const hasNegativeIncome = trendBars.some(bar => bar.rawAmount < 0);
  const cumulativeIncome = useMemo(() => {
    let total = 0;
    return trendBars.map(bar => {
      total = sumMoney([total, bar.rawAmount]);
      return { ...bar, cumulative: total };
    });
  }, [trendBars]);
  const lineMinimum = Math.min(0, ...cumulativeIncome.map(bar => bar.cumulative));
  const lineMaximum = Math.max(0, ...cumulativeIncome.map(bar => bar.cumulative));
  const lineRange = lineMaximum - lineMinimum || 1;
  const lineY = (amount: number) => 180 - ((amount - lineMinimum) / lineRange) * 150;
  const linePoints = cumulativeIncome.map((bar, index) =>
    `${20 + index * (460 / Math.max(1, cumulativeIncome.length - 1))},${lineY(bar.cumulative)}`
  ).join(' ');
  const distributionColors = ['#4318ff', '#6ad2ff', '#a3aed0', '#f6ad55', '#c4b5fd'];
  let distributionEnd = 0;
  const pieBackground = dashboardMetrics.totalOrders
    ? `conic-gradient(${dashboardMetrics.distribution.map((item, index) => {
      const start = distributionEnd;
      distributionEnd += item.percentage;
      return `${distributionColors[index]} ${start}% ${distributionEnd}%`;
    }).join(', ')})`
    : 'var(--bg-card-subtle)';

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const [incomeUpdated] = await Promise.all([income.refresh(), onRefresh?.()]);
      if (incomeUpdated) setLastUpdated(
        new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date())
      );
    } finally { setIsRefreshing(false); }
  };

  const resetToCurrentWeek = () => {
    setPeriodType('semana');
    setWeekOffset(0);
    setMonthOffset(0);
    setYearOffset(0);
  };

  return (
    <div className="radar-view horizon-dashboard pb-8">
      <div className="horizon-dashboard-toolbar">
        <div>
          <h2 className="sr-only">
            Panorama Operativo & Finanzas
          </h2>
          <div className="flex items-center gap-2 mt-1">
            <p className="horizon-capture text-xs text-slate-400 font-mono">
              {periodLabel.subtitle} • Captura: <span className="text-cyan-300">{lastUpdated}</span>
            </p>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
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
        <div className="horizon-period-controls flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-2.5">
          {/* Granularity segmented buttons: Semana (Default) | Mes | Año */}
          <div className="horizon-period-tabs flex rounded-2xl p-1">
            <button
              type="button"
              aria-pressed={periodType === 'semana'}
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
              aria-pressed={periodType === 'mes'}
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
              aria-pressed={periodType === 'ano'}
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
          <div className="horizon-period-navigator flex flex-wrap items-center gap-1.5 max-w-full">
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
              <span className="font-bold text-white">{periodLabel.title}</span>
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

      {/* Control del Supervisor y Telemetría Operativa */}
      <div className="relative rounded-3xl bg-gradient-to-r from-[#0c1a30]/90 via-[#070c18]/95 to-[#040812] border border-cyan-500/30 p-4 shadow-[0_15px_40px_rgba(0,0,0,0.6)] overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-amber-400 shadow-[0_0_12px_#22d3ee]" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/15 border border-cyan-400/40 text-cyan-300 flex items-center justify-center shrink-0 shadow-[0_0_12px_rgba(6,182,212,0.25)]">
              <span className="material-symbols-outlined text-[22px]">monitoring</span>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-black text-white font-mono">
                  Telemetría y Control Operativo
                </h3>
                <span className="text-[10px] font-mono font-bold bg-cyan-500/15 text-cyan-300 px-2 py-0.5 rounded-full border border-cyan-400/40">
                  Flujo del Período
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                Monitoreo continuo de efectividad en servicio, entregas y órdenes en taller.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Ventas Registradas */}
            <div className="bg-[#030712]/80 px-3.5 py-2 rounded-2xl border border-cyan-500/20 text-right">
              <span className="text-[9.5px] font-mono uppercase text-cyan-400 block font-bold">
                Ventas Registradas
              </span>
              <span className="text-base font-mono font-black text-cyan-300">
                ${dashboardMetrics.totalSales.toFixed(2)} USD
              </span>
            </div>

            {/* Efectividad SLA */}
            <div className="bg-[#030712]/80 px-3.5 py-2 rounded-2xl border border-cyan-500/20 text-right">
              <span className="text-[9.5px] font-mono uppercase text-emerald-400 block font-bold">
                Efectividad sin Reclamos
              </span>
              <span className="text-base font-mono font-black text-emerald-300">
                {dashboardMetrics.effectiveDeliveryRate}%
              </span>
            </div>

            {/* Cuellos de Botella Taller */}
            <div
              onClick={onNavigateTaller}
              className="bg-[#030712]/80 hover:bg-[#061226] px-3.5 py-2 rounded-2xl border border-cyan-500/20 text-right cursor-pointer transition"
              title="Ir a taller para revisar órdenes activas"
            >
              <span className="text-[9.5px] font-mono uppercase text-cyan-400 block font-bold flex items-center justify-end gap-1">
                <span>Taller en Proceso</span>
                <span className="material-symbols-outlined text-[12px]">arrow_forward</span>
              </span>
              <span className="text-base font-mono font-black text-cyan-300">
                {dashboardMetrics.activeInWorkshop} activas
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="horizon-kpis">
        {[
          { label: 'Ingresos netos del período', icon: 'trending_up', tone: 'positive',
            value: income.loaded ? `$${dashboardMetrics.totalSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'No disponible',
            note: 'Pagos − reembolsos por fecha efectiva. No incluye saldos legacy sin fecha.' },
          { label: 'Órdenes Operativas', icon: 'inventory_2', tone: 'brand',
            value: dashboardMetrics.totalOrders,
            note: `${dashboardMetrics.activeInWorkshop} activas en taller / proceso`, onClick: onNavigateTaller },
          { label: 'Cobros del período', icon: 'payments', tone: 'brand',
            value: income.loaded ? `$${dashboardMetrics.totalAdvanceCollected.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'No disponible',
            note: `Saldo actual de ventas creadas en el período: $${dashboardMetrics.totalBalanceDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
          { label: 'Reclamos & Incidencias', icon: 'warning', tone: 'warning',
            value: dashboardMetrics.claimsCount,
            note: slaMetrics.length ? `${dashboardMetrics.overdueSlas} alertas de tiempo SLA` : 'SLA no disponible' },
          { label: 'En taller / proceso', icon: 'build', tone: 'brand',
            value: dashboardMetrics.activeInWorkshop,
            note: 'Órdenes creadas en el período que siguen activas en taller / proceso.', onClick: onNavigateTaller },
          { label: 'Saldo pendiente', icon: 'account_balance_wallet', tone: 'brand',
            value: `$${dashboardMetrics.totalBalanceDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            note: 'Saldo actual de ventas creadas en el período, no ingresos cobrados.' },
        ].map(metric => (
          <div key={metric.label} className="horizon-stat" data-tone={metric.tone}
            title={`${metric.label}: ${metric.value}. ${metric.note}`}
            role={metric.onClick ? 'button' : undefined}
            tabIndex={metric.onClick ? 0 : undefined}
            aria-label={metric.label}
            onClick={metric.onClick}
            onKeyDown={metric.onClick ? event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                metric.onClick();
              }
            } : undefined}>
            <div className="horizon-stat-icon">
              <span className="material-symbols-outlined">{metric.icon}</span>
            </div>
            <div className="horizon-stat-content">
              <p className="horizon-stat-label">{metric.label}</p>
              <p className="horizon-stat-value">{metric.value}</p>
              <p className="horizon-stat-note sr-only">{metric.note}</p>
            </div>
          </div>
        ))}
      </div>

      {periodOrders.length === 0 && <p role="status" className="horizon-empty-period">
        No hay órdenes creadas en este período. Selecciona un período anterior para consultar el histórico.
      </p>}
      <div className="horizon-chart-grid">
        <section className="horizon-dashboard-card horizon-cumulative-card" aria-label="Ingresos netos acumulados">
          <div className="horizon-card-heading">
            <span className="horizon-chart-period"><span className="material-symbols-outlined">calendar_today</span>{periodLabel.subtitle}</span>
            <span className="material-symbols-outlined horizon-card-symbol">bar_chart</span>
          </div>
          <div className="horizon-cumulative-body">
            <div className="horizon-cumulative-summary">
              <h3>Ingresos netos acumulados</h3>
              <p className="horizon-chart-total">{income.loaded ? `$${dashboardMetrics.totalSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'No disponible'}</p>
              <p>Pagos − reembolsos</p>
              <span className="horizon-chart-legend"><span />Fecha efectiva</span>
            </div>
            <div className="horizon-net-line">
              {!income.loaded ? <p role={income.error ? 'alert' : 'status'}>{income.error || 'Cargando movimientos…'}</p> :
                !trendBars.some(bar => bar.rawAmount !== 0) ? <p role="status">Sin ingresos netos registrados en este período</p> :
                  <svg viewBox="0 0 500 210" role="img" aria-label="Evolución acumulada de pagos menos reembolsos por fecha efectiva">
                    <line x1="20" y1={lineY(0)} x2="480" y2={lineY(0)} className="horizon-chart-zero" />
                    <polyline points={linePoints} fill="none" stroke="var(--brand-solid)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                    {cumulativeIncome.map((bar, index) => (
                      <circle key={bar.label} cx={20 + index * (460 / Math.max(1, cumulativeIncome.length - 1))} cy={lineY(bar.cumulative)} r="4" fill="var(--bg-card)" stroke="var(--brand-solid)" strokeWidth="2">
                        <title>{`${bar.fullLabel}: $${bar.cumulative.toFixed(2)} acumulados`}</title>
                      </circle>
                    ))}
                  </svg>}
              <div className="horizon-line-labels">{cumulativeIncome.map(bar => <span key={bar.label}>{bar.label}</span>)}</div>
            </div>
          </div>
        </section>
        {/* Tendencia de Ventas (Dynamic HUD Graph) */}
        <div className="horizon-dashboard-card horizon-revenue-card flex flex-col overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 shadow-[0_0_12px_#22d3ee]" />

          <div className="horizon-card-heading flex flex-wrap justify-between items-center gap-3">
            <div>
              <h3 className="text-lg font-black text-white">Ingresos netos por fecha efectiva</h3>
              {!income.loaded && <p role={income.error ? 'alert' : 'status'} className="text-amber-300 text-xs">{income.error || 'Cargando movimientos…'} No se infieren cobros del estado de la orden.</p>}
              <p className="sr-only">
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
                  <span className={hoveredBar.amount.includes('-') ? 'text-rose-400 font-black' : 'text-emerald-400 font-black'}>{hoveredBar.amount}</span>
                  <span className="text-cyan-300">
                    ({hoveredBar.salesCount} comerciales • {hoveredBar.count} órdenes creadas)
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Area / Dynamic Bars Representation */}
          <div className="horizon-income-chart relative flex items-end justify-between gap-1.5 sm:gap-3 overflow-hidden">
            <div
              className="w-full h-full absolute inset-0 opacity-15 pointer-events-none"
              style={{
                background: 'linear-gradient(to top, var(--brand-soft) 0%, transparent 100%)',
              }}
            />
            {income.loaded && !trendBars.some(bar => bar.rawAmount !== 0) && (
              <p role="status" className="absolute inset-0 flex items-center justify-center text-sm text-slate-400 text-center">
                Sin ingresos netos registrados en este período
              </p>
            )}
            {income.loaded && hasNegativeIncome && (
              <div aria-hidden="true" className="absolute inset-x-0 top-1/2 border-t border-slate-400">
                <span className="text-[10px] text-slate-400">$0</span>
              </div>
            )}

            {(income.loaded ? trendBars : []).map((bar, idx) => (
              <div
                key={idx}
                onMouseEnter={() => setHoveredBar(bar)}
                onMouseLeave={() => setHoveredBar(null)}
                onFocus={() => setHoveredBar(bar)}
                onBlur={() => setHoveredBar(null)}
                tabIndex={0}
                aria-label={`${bar.fullLabel}: ${bar.amount}`}
                className="relative z-10 w-full flex flex-col justify-end items-center h-full group cursor-pointer"
              >
                {/* Bar hover tooltip for mobile / quick click */}
                <div
                  style={{
                    height: hasNegativeIncome ? `${Number.parseFloat(bar.height) / 2}%` : bar.height,
                    ...(hasNegativeIncome ? {
                      position: 'absolute',
                      ...(bar.rawAmount < 0 ? { top: '50%' } : { bottom: '50%' }),
                    } : {}),
                  }}
                  title={`${bar.fullLabel}: ${bar.amount}`}
                  data-income={bar.rawAmount < 0 ? 'negative' : bar.rawAmount > 0 ? 'positive' : 'zero'}
                  className={`w-full ${bar.rawAmount < 0 ? 'rounded-b-xl' : 'rounded-t-xl'} transition-all duration-300 ${
                    bar.rawAmount < 0
                      ? 'bg-rose-500'
                      : bar.isHighlight && bar.rawAmount > 0
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
          <div className="horizon-line-labels flex justify-between text-[10px] sm:text-[11px] text-slate-400 overflow-x-auto">
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
      </div>
      <div className="horizon-dashboard-lower">
        <section className="horizon-dashboard-card horizon-period-orders" aria-label="Órdenes del período">
          <div className="horizon-card-heading">
            <h3>Órdenes del período</h3>
            <button type="button" onClick={onNavigateTaller} aria-label="Ver todas las órdenes" className="horizon-card-action"><span className="material-symbols-outlined">more_horiz</span></button>
          </div>
          <div className="table-responsive-wrapper">
            <table>
              <thead><tr><th>Orden / cliente</th><th>Vehículo</th><th>Estado</th></tr></thead>
              <tbody>{periodOrders.slice(0, 5).map(order => (
                <tr key={order.id}>
                  <td><button type="button" onClick={() => onSelectOrder(order.id)} className="horizon-order-link">{order.code}</button><span className="horizon-table-secondary">{order.customer.name}</span></td>
                  <td>{order.vehicle.make} {order.vehicle.model}<span className="horizon-table-secondary">{order.vehicle.year}</span></td>
                  <td><span className="horizon-table-status">{order.status.replace(/_/g, ' ')}</span></td>
                </tr>
              ))}</tbody>
            </table>
            {!periodOrders.length && <p className="horizon-card-empty">Sin órdenes creadas en este período.</p>}
          </div>
        </section>
        <section className="horizon-dashboard-card horizon-order-volume" aria-label="Volumen de órdenes">
          <div className="horizon-card-heading"><h3>Órdenes creadas</h3><span className="material-symbols-outlined horizon-card-symbol">bar_chart</span></div>
          <p className="horizon-chart-total">{dashboardMetrics.totalOrders}<span> en el período</span></p>
          <div className="horizon-volume-bars">
            {trendBars.map(bar => (
              <div key={bar.label} className="horizon-volume-column">
                <div style={{ height: `${bar.count / (Math.max(...trendBars.map(item => item.count)) || 1) * 100}%` }} title={`${bar.fullLabel}: ${bar.count} órdenes`} />
                <span>{bar.label}</span>
              </div>
            ))}
          </div>
        </section>
        <div className="horizon-dashboard-card horizon-distribution-card flex flex-col overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#22d3ee]" />

          <div className="horizon-card-heading flex justify-between items-center">
            <div>
              <h3 className="text-lg font-black text-white">Distribución Operativa</h3>
              <p className="text-[11px] text-slate-400 font-mono">
                {dashboardMetrics.totalOrders} órdenes registradas en este período
              </p>
            </div>
            <span className="material-symbols-outlined text-cyan-400 text-[20px]">pie_chart</span>
          </div>

          <div className="horizon-distribution-pie" role="img" aria-label={dashboardMetrics.totalOrders ? dashboardMetrics.distribution.map(item => `${item.label}: ${item.count} (${item.percentage.toFixed(1)}%)`).join(', ') : 'Sin órdenes en el período'} style={{ background: pieBackground }} />
          <div className="horizon-distribution-legend">
            {dashboardMetrics.distribution.map((item, index) => (
              <div key={item.label} className="w-full">
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-slate-200 font-bold"><i style={{ background: distributionColors[index] }} />{item.label}</span>
                  <span className="font-black">
                    {item.percentage.toFixed(1)}% <span className="text-slate-400 font-normal">({item.count})</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Secondary Section: SLAs & Activity Feed */}
      <div className="horizon-dashboard-secondary grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5">
        {/* Monitor de SLAs */}
        <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.7)] flex flex-col overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#22d3ee]" />

          <div className="pb-4 border-b border-cyan-500/15 flex justify-between items-center">
            <h3 className="text-lg font-black text-white">Monitor de Tiempos SLA</h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 font-bold">
              {slaMetrics.length ? 'DATOS RECIBIDOS' : 'NO DISPONIBLE'}
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
                {!slaMetrics.length && <tr><td colSpan={3} className="py-4 text-slate-400">Sin métricas SLA verificadas.</td></tr>}
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
