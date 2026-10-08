import React, { useState, useMemo, useEffect } from 'react';
import { Order, Claim, RefundRequest } from '../types';
import { apiFetch } from '../services/apiFetch';

interface OperationsViewProps {
  orders: Order[];
  onSelectOrder?: (orderId: string) => void;
  onUpdateOrder?: (order: Order) => void;
  userRole?: 'admin' | 'operador';
  currentUser?: { id?: number; name?: string; email?: string; role?: string } | null;
}

interface OperatorInfo {
  id: string;
  name: string;
  role: string;
  email: string;
}

// Helper: robustly parse order creation date into a JS Date object
export const parseOrderDate = (order: Order): Date => {
  if (order.createdAtIso) {
    const d = new Date(order.createdAtIso);
    if (!isNaN(d.getTime())) return d;
  }
  const raw = (order.createdAt || '').trim();
  if (!raw) return new Date();

  const now = new Date();
  if (raw.toLowerCase().startsWith('hoy')) {
    return new Date();
  }
  if (raw.toLowerCase().startsWith('ayer')) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday;
  }

  const spanishMonths: Record<string, number> = {
    ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5,
    jul: 6, ago: 7, sep: 8, oct: 9, nov: 10, dic: 11,
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
  };

  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2000) {
    return parsed;
  }

  // Regex matching "DD [mes] YYYY"
  const match = raw.match(/(\d{1,2})\s+([a-zA-ZáéíóúÁÉÍÓÚ]+)\.?\s+(\d{4})/i);
  if (match) {
    const day = parseInt(match[1], 10);
    const monthStr = match[2].toLowerCase().slice(0, 3);
    const year = parseInt(match[3], 10);
    const month = spanishMonths[monthStr] ?? 0;
    return new Date(year, month, day, 12, 0, 0);
  }

  // Regex matching "DD/MM/YYYY" or "YYYY-MM-DD"
  const slashMatch = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    return new Date(parseInt(slashMatch[3], 10), parseInt(slashMatch[2], 10) - 1, parseInt(slashMatch[1], 10), 12, 0, 0);
  }

  return new Date();
};

// Helper: calculate Monday-Sunday week bounds (Lunes 00:00:00 a Domingo 23:59:59)
export const getWeekRange = (weekOffset = 0) => {
  const now = new Date();
  now.setDate(now.getDate() + weekOffset * 7);
  const day = now.getDay(); // 0 is Sunday, 1 is Monday, ..., 6 is Saturday
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { monday, sunday };
};

// Helper: calculate Month bounds (1st 00:00:00 to last day 23:59:59)
export const getMonthRange = (monthOffset = 0) => {
  const now = new Date();
  now.setMonth(now.getMonth() + monthOffset);
  const year = now.getFullYear();
  const month = now.getMonth();

  const start = new Date(year, month, 1, 0, 0, 0, 0);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);

  return { start, end, year, month };
};

export const OperationsView: React.FC<OperationsViewProps> = ({
  orders,
  onSelectOrder,
  onUpdateOrder,
  userRole = 'admin',
  currentUser,
}) => {
  const isSuperAdmin = userRole === 'admin';

  // 1. Operators List & Selected Operator
  const [operators, setOperators] = useState<OperatorInfo[]>([]);
  const [selectedOperatorName, setSelectedOperatorName] = useState<string>(
    currentUser?.name || ''
  );

  useEffect(() => {
    apiFetch('/users')
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((users) => {
        const activeOperators = users
          .filter((user: { active: number }) => Boolean(user.active))
          .map((user: { id: number; name: string; role: string; email: string }) => ({
            id: String(user.id),
            name: user.name,
            role: user.role,
            email: user.email,
          }));
        setOperators(activeOperators);

        // If not super admin, force operator to logged-in user
        if (!isSuperAdmin) {
          const matched = activeOperators.find(
            (op) =>
              (currentUser?.name && op.name.toLowerCase() === currentUser.name.toLowerCase()) ||
              (currentUser?.id && String(op.id) === String(currentUser.id))
          );
          setSelectedOperatorName(matched ? matched.name : currentUser?.name || 'Operador');
        } else {
          // Super admin: if none selected, select current user or first operator
          setSelectedOperatorName((current) => {
            if (current) return current;
            const myOp = activeOperators.find(
              (op) => currentUser?.name && op.name.toLowerCase() === currentUser.name.toLowerCase()
            );
            return myOp ? myOp.name : activeOperators[0]?.name || '__ALL__';
          });
        }
      })
      .catch(() => {
        if (!isSuperAdmin) {
          setSelectedOperatorName(currentUser?.name || 'Operador');
        }
      });
  }, [isSuperAdmin, currentUser]);

  // 2. Period Filter Engine ('semana' | 'mes' | 'todo')
  const [periodType, setPeriodType] = useState<'semana' | 'mes' | 'todo'>('semana');
  const [weekOffset, setWeekOffset] = useState<number>(0);
  const [monthOffset, setMonthOffset] = useState<number>(0);

  // Active Period Date Range Calculation
  const weekRange = useMemo(() => getWeekRange(weekOffset), [weekOffset]);
  const monthRange = useMemo(() => getMonthRange(monthOffset), [monthOffset]);

  // Formatted Period Labels
  const periodLabel = useMemo(() => {
    if (periodType === 'semana') {
      const startStr = weekRange.monday.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
      const endStr = weekRange.sunday.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
      const isCurrent = weekOffset === 0;
      return {
        title: `Semana: Lun ${startStr} — Dom ${endStr}`,
        subtitle: isCurrent ? 'Semana en curso (Lunes a Domingo)' : 'Semana histórica archivada',
        isCurrent,
      };
    }
    if (periodType === 'mes') {
      const monthName = monthRange.start.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
      const capitalized = monthName.charAt(0).toUpperCase() + monthName.slice(1);
      const isCurrent = monthOffset === 0;
      return {
        title: `Mes: ${capitalized}`,
        subtitle: isCurrent ? 'Mes en curso (1 al último día)' : 'Mes histórico auditado',
        isCurrent,
      };
    }
    return {
      title: 'Consolidado Histórico Total',
      subtitle: 'Todas las operaciones registradas sin filtro de fecha',
      isCurrent: false,
    };
  }, [periodType, weekRange, monthRange, weekOffset, monthOffset]);

  // Current Operator Info Object
  const currentOperator = useMemo(() => {
    if (selectedOperatorName === '__ALL__') {
      return {
        id: 'ALL',
        name: 'Todos los Operadores',
        role: 'Consolidado General',
        email: 'auditoria@radar.com',
      };
    }
    const found = operators.find((op) => op.name.toLowerCase() === selectedOperatorName.toLowerCase());
    return (
      found || {
        id: String(currentUser?.id || '1'),
        name: selectedOperatorName || currentUser?.name || 'Operador',
        role: currentUser?.role || 'Operador de Ventas',
        email: currentUser?.email || 'operador@radar.com',
      }
    );
  }, [operators, selectedOperatorName, currentUser]);

  // Active Main Tabs: 'ventas_periodo' | 'activas' | 'cotizaciones' | 'reclamos_reembolsos'
  const [activeTab, setActiveTab] = useState<'ventas_periodo' | 'activas' | 'cotizaciones' | 'reclamos_reembolsos'>('ventas_periodo');
  const [searchTableQuery, setSearchTableQuery] = useState('');

  // Transfer Modal State
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferSelectedOrder, setTransferSelectedOrder] = useState<Order | null>(null);
  const [transferStep, setTransferStep] = useState<'select' | 'otp'>('select');
  const [transferOtpInput, setTransferOtpInput] = useState('');
  const [generatedOtp, setGeneratedOtp] = useState<string>('');
  const [otpTimerSeconds, setOtpTimerSeconds] = useState(600);
  const [transferFilterSearch, setTransferFilterSearch] = useState('');
  const [transferError, setTransferError] = useState<string | null>(null);

  // Print Report Modal State
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // Toast Notification State
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4500);
  };

  // 3. Claims and Refund Requests from API
  const [claims, setClaims] = useState<Claim[]>([]);
  const [refundRequests, setRefundRequests] = useState<RefundRequest[]>([]);

  useEffect(() => {
    apiFetch('/claims')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setClaims)
      .catch(() => setClaims([]));

    apiFetch('/refunds')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setRefundRequests)
      .catch(() => setRefundRequests([]));
  }, []);

  // 4. Operator-Scoped Orders (Strict matching)
  const operatorOrders = useMemo(() => {
    if (isSuperAdmin && selectedOperatorName === '__ALL__') {
      return orders;
    }
    const targetName = selectedOperatorName.trim().toLowerCase();
    const targetId = currentOperator?.id;

    return orders.filter((o) => {
      const adv = (o.advisor || '').trim().toLowerCase();
      if (adv && (adv === targetName || adv.includes(targetName) || targetName.includes(adv))) {
        return true;
      }
      if (o.userId && targetId && targetId !== 'ALL' && String(o.userId) === String(targetId)) {
        return true;
      }
      if ((!o.advisor || o.advisor === 'Sin asignar') && targetName.includes('carlos')) {
        return true;
      }
      return false;
    });
  }, [orders, selectedOperatorName, isSuperAdmin, currentOperator]);

  // 5. Date-Filtered Orders for the Active Period
  const periodFilteredOrders = useMemo(() => {
    return operatorOrders.filter((order) => {
      if (periodType === 'todo') return true;
      const orderDate = parseOrderDate(order);

      if (periodType === 'semana') {
        return orderDate >= weekRange.monday && orderDate <= weekRange.sunday;
      }
      if (periodType === 'mes') {
        return orderDate >= monthRange.start && orderDate <= monthRange.end;
      }
      return true;
    });
  }, [operatorOrders, periodType, weekRange, monthRange]);

  // Sales Criteria: Confirmed sales with monetary commitment
  const isSaleStatus = (st: string) => {
    return (
      st !== 'cancelado' &&
      st !== 'cotizacion' &&
      st !== 'pendiente_aprobacion'
    );
  };

  // Period Sales (Ventas Concluidas / En Curso del Período)
  const periodSales = useMemo(() => {
    return periodFilteredOrders.filter((o) => isSaleStatus(o.status));
  }, [periodFilteredOrders]);

  // Period Quotes (Cotizaciones del Período)
  const periodQuotes = useMemo(() => {
    return periodFilteredOrders.filter((o) => o.status === 'cotizacion' || o.status === 'espera_confirmacion');
  }, [periodFilteredOrders]);

  // Active Orders in Execution (Current operational pipeline for this operator)
  const activeOrders = useMemo(() => {
    const activeStatuses = [
      'cotizacion',
      'espera_confirmacion',
      'pagado',
      'en_preparacion',
      'listo_despacho',
      'listo_retiro',
      'en_camino',
      'reclamo',
      'solicitud_reembolso',
    ];
    return operatorOrders.filter((o) => activeStatuses.includes(o.status));
  }, [operatorOrders]);

  // Operator Claims & Refunds
  const operatorClaims = useMemo(() => {
    if (isSuperAdmin && selectedOperatorName === '__ALL__') return claims;
    return claims.filter(
      (c) =>
        (c.advisor && c.advisor.toLowerCase() === selectedOperatorName.toLowerCase()) ||
        operatorOrders.some((o) => o.id === c.orderId || o.code === c.orderCode)
    );
  }, [claims, selectedOperatorName, operatorOrders, isSuperAdmin]);

  const operatorRefunds = useMemo(() => {
    if (isSuperAdmin && selectedOperatorName === '__ALL__') return refundRequests;
    return refundRequests.filter((r) =>
      operatorOrders.some((o) => o.id === r.orderId || o.code === r.orderCode)
    );
  }, [refundRequests, operatorOrders, isSuperAdmin]);

  // 6. Comprehensive KPIs Calculation
  const kpis = useMemo(() => {
    // 1. Total Facturado en Ventas ($)
    const salesSum = periodSales.reduce((sum, o) => {
      const amount = o.financials?.partPrice || o.financials?.total || 0;
      return sum + amount;
    }, 0);
    const salesCount = periodSales.length;

    // 2. Anticipos / Cobrado en Mano ($)
    const downPaymentSum = periodSales.reduce((sum, o) => {
      const down = o.financials?.downPayment || o.financials?.advancePayment || 0;
      return sum + down;
    }, 0);

    // 3. Saldo Pendiente por Cobrar ($)
    const balanceDueSum = periodSales.reduce((sum, o) => {
      const bal = o.financials?.balanceDue ?? Math.max(0, (o.financials?.partPrice || o.financials?.total || 0) - (o.financials?.downPayment || o.financials?.advancePayment || 0));
      return sum + bal;
    }, 0);

    // 4. Ticket Promedio
    const averageTicket = salesCount > 0 ? salesSum / salesCount : 0;

    // 5. Tasa de Conversión (Ventas vs Cotizaciones)
    const totalRequests = salesCount + periodQuotes.length;
    const conversionRate = totalRequests > 0 ? (salesCount / totalRequests) * 100 : 0;

    // 6. Reembolsos y Reclamos
    const refundsSum = operatorRefunds.reduce((sum, r) => sum + r.amount, 0);
    const openClaimsCount = operatorClaims.filter(
      (c) => c.status === 'Pending' || c.status === 'In Process'
    ).length;

    return {
      salesSum,
      salesCount,
      downPaymentSum,
      balanceDueSum,
      averageTicket,
      conversionRate,
      quotesCount: periodQuotes.length,
      refundsSum,
      refundsCount: operatorRefunds.length,
      openClaimsCount,
      activeCount: activeOrders.length,
    };
  }, [periodSales, periodQuotes, operatorRefunds, operatorClaims, activeOrders]);

  // 7. Visual Day-by-Day Breakdown for the Week (Lunes a Domingo)
  const weeklyDayBreakdown = useMemo(() => {
    const days = [
      { key: 1, name: 'Lun', full: 'Lunes', count: 0, amount: 0 },
      { key: 2, name: 'Mar', full: 'Martes', count: 0, amount: 0 },
      { key: 3, name: 'Mié', full: 'Miércoles', count: 0, amount: 0 },
      { key: 4, name: 'Jue', full: 'Jueves', count: 0, amount: 0 },
      { key: 5, name: 'Vie', full: 'Viernes', count: 0, amount: 0 },
      { key: 6, name: 'Sáb', full: 'Sábado', count: 0, amount: 0 },
      { key: 0, name: 'Dom', full: 'Domingo', count: 0, amount: 0 },
    ];

    periodSales.forEach((order) => {
      const orderDate = parseOrderDate(order);
      const dayOfWeek = orderDate.getDay(); // 0 is Sun, 1 is Mon, etc.
      const found = days.find((d) => d.key === dayOfWeek);
      if (found) {
        found.count += 1;
        found.amount += order.financials?.partPrice || order.financials?.total || 0;
      }
    });

    const maxAmount = Math.max(...days.map((d) => d.amount), 1);
    return { days, maxAmount };
  }, [periodSales]);

  // 8. Visual Month Breakdown (Semanas del Mes)
  const monthlyWeekBreakdown = useMemo(() => {
    const weeks = [
      { label: 'Sem 1 (01-07)', count: 0, amount: 0 },
      { label: 'Sem 2 (08-14)', count: 0, amount: 0 },
      { label: 'Sem 3 (15-21)', count: 0, amount: 0 },
      { label: 'Sem 4 (22-28)', count: 0, amount: 0 },
      { label: 'Sem 5 (29-31)', count: 0, amount: 0 },
    ];

    periodSales.forEach((order) => {
      const orderDate = parseOrderDate(order);
      const dayOfMonth = orderDate.getDate();
      let index = 0;
      if (dayOfMonth <= 7) index = 0;
      else if (dayOfMonth <= 14) index = 1;
      else if (dayOfMonth <= 21) index = 2;
      else if (dayOfMonth <= 28) index = 3;
      else index = 4;

      weeks[index].count += 1;
      weeks[index].amount += order.financials?.partPrice || order.financials?.total || 0;
    });

    const maxAmount = Math.max(...weeks.map((w) => w.amount), 1);
    return { weeks, maxAmount };
  }, [periodSales]);

  // 9. Delivery Type Breakdown (Mostrador vs Flete)
  const deliveryBreakdown = useMemo(() => {
    let storePickupCount = 0;
    let storePickupSum = 0;
    let shippingCount = 0;
    let shippingSum = 0;

    periodSales.forEach((order) => {
      const amt = order.financials?.partPrice || order.financials?.total || 0;
      if (order.deliveryType === 'retiro_tienda') {
        storePickupCount += 1;
        storePickupSum += amt;
      } else {
        shippingCount += 1;
        shippingSum += amt;
      }
    });

    const total = periodSales.length || 1;
    return {
      storePickupCount,
      storePickupSum,
      storePickupPercent: Math.round((storePickupCount / total) * 100),
      shippingCount,
      shippingSum,
      shippingPercent: Math.round((shippingCount / total) * 100),
    };
  }, [periodSales]);

  // 10. Filtered Sales Table List (with search)
  const displaySalesList = useMemo(() => {
    if (!searchTableQuery.trim()) return periodSales;
    const q = searchTableQuery.toLowerCase();
    return periodSales.filter(
      (o) =>
        o.code.toLowerCase().includes(q) ||
        o.customer.name.toLowerCase().includes(q) ||
        o.customer.phone.toLowerCase().includes(q) ||
        `${o.vehicle.year} ${o.vehicle.make} ${o.vehicle.model}`.toLowerCase().includes(q) ||
        o.mainPart.toLowerCase().includes(q) ||
        (o.advisor && o.advisor.toLowerCase().includes(q))
    );
  }, [periodSales, searchTableQuery]);

  // 11. Orders Owned by Other Operators (for sales transfer)
  const otherOperatorsOrders = useMemo(() => {
    return orders.filter(
      (o) =>
        o.advisor &&
        o.advisor.toLowerCase() !== selectedOperatorName.toLowerCase() &&
        o.status !== 'cancelado'
    );
  }, [orders, selectedOperatorName]);

  const filteredOtherOrders = useMemo(() => {
    if (!transferFilterSearch.trim()) return otherOperatorsOrders;
    const q = transferFilterSearch.toLowerCase();
    return otherOperatorsOrders.filter(
      (o) =>
        o.code.toLowerCase().includes(q) ||
        o.customer.name.toLowerCase().includes(q) ||
        `${o.vehicle.year} ${o.vehicle.make} ${o.vehicle.model}`.toLowerCase().includes(q) ||
        o.mainPart.toLowerCase().includes(q) ||
        (o.advisor && o.advisor.toLowerCase().includes(q))
    );
  }, [otherOperatorsOrders, transferFilterSearch]);

  // OTP Timer countdown
  useEffect(() => {
    let interval: any;
    if (transferStep === 'otp' && otpTimerSeconds > 0) {
      interval = setInterval(() => {
        setOtpTimerSeconds((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [transferStep, otpTimerSeconds]);

  const handleStartTransfer = (order: Order) => {
    setTransferSelectedOrder(order);
    const randomOtp = String(Math.floor(100000 + Math.random() * 900000));
    setGeneratedOtp(randomOtp);
    setOtpTimerSeconds(600);
    setTransferOtpInput('');
    setTransferError(null);
    setTransferStep('otp');
  };

  const handleConfirmTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferSelectedOrder) return;

    if (transferOtpInput.trim() !== generatedOtp) {
      setTransferError('Código OTP incorrecto o expirado. Verifica el código enviado al WhatsApp del creador.');
      return;
    }

    const oldAdvisor = transferSelectedOrder.advisor || 'Operador Anterior';
    const targetOp = operators.find((op) => op.name === selectedOperatorName);

    const updatedOrder: any = {
      ...transferSelectedOrder,
      advisor: selectedOperatorName,
      userId: targetOp ? Number(targetOp.id) : currentUser?.id,
      notes: `${transferSelectedOrder.notes || ''}\n[${new Date().toLocaleDateString()}] Traspaso de venta transferido de ${oldAdvisor} a ${selectedOperatorName} (Código OTP verificado).`,
    };

    if (onUpdateOrder) {
      onUpdateOrder(updatedOrder);
    }

    setIsTransferModalOpen(false);
    setTransferSelectedOrder(null);
    setTransferStep('select');
    setTransferOtpInput('');
    setTransferError(null);

    showToast(
      `🤝 ¡Traspaso Exitoso! La orden ${updatedOrder.code} ($${(updatedOrder.financials?.partPrice || 0).toFixed(2)}) fue transferida a ${selectedOperatorName}.`
    );
  };

  return (
    <div className="radar-view relative pb-16 space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 bg-[#10b981] text-[#064e3b] font-bold text-xs py-2.5 px-4 rounded-xl shadow-[0_0_25px_rgba(16,185,129,0.4)] flex items-center gap-2 animate-bounce border border-[#34d399]">
          <span className="material-symbols-outlined text-[18px]">verified</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* SECTION 1: Header with Operator Profile & Super Admin Auditor Switcher */}
      <div className="relative rounded-3xl bg-[#070c18]/92 backdrop-blur-2xl border border-cyan-500/30 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.75)] flex flex-col lg:flex-row lg:items-center justify-between gap-4 overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 shadow-[0_0_12px_#22d3ee]" />

        {/* Profile Info */}
        <div className="flex items-center gap-4 relative z-10">
          <div className="relative shrink-0">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#0c1a30] via-[#060c18] to-[#040812] border-2 border-cyan-400/60 shadow-[0_0_20px_rgba(6,182,212,0.4)] flex items-center justify-center text-lg font-black text-cyan-300 font-mono">
              {currentOperator.name === 'Todos los Operadores'
                ? 'ALL'
                : currentOperator.name
                    .split(' ')
                    .map((part) => part[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase() || 'OP'}
            </div>
            <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-400 shadow-[0_0_8px_#34d399] border-2 border-[#070c18] rounded-full animate-pulse" />
          </div>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl md:text-2xl font-black text-white tracking-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]">
                {currentOperator.name}
              </h1>
              <span className="text-xs font-mono bg-cyan-500/15 text-cyan-300 px-2.5 py-0.5 rounded-full border border-cyan-400/40 font-bold shadow-[0_0_8px_rgba(6,182,212,0.25)]">
                {currentOperator.role}
              </span>
              <span className="text-[11px] font-mono bg-[#040814] text-slate-400 px-2.5 py-0.5 rounded-md border border-cyan-500/20">
                /mis-operaciones
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-1 flex items-center gap-3">
              <span>✉️ {currentOperator.email}</span>
              {!isSuperAdmin && (
                <span className="text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                  🔒 Mis Ventas Asignadas
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Action Controls & Super Admin Operator Switcher */}
        <div className="flex flex-wrap items-center gap-3 relative z-10">
          {/* Super Admin Operator Switcher Dropdown */}
          {isSuperAdmin && (
            <div className="flex items-center gap-2 bg-[#040814]/95 border border-cyan-500/40 rounded-2xl px-3.5 py-2 shadow-[0_0_15px_rgba(6,182,212,0.2)]">
              <span className="material-symbols-outlined text-cyan-400 text-[20px]">
                manage_accounts
              </span>
              <div className="flex flex-col">
                <span className="text-[9px] uppercase font-mono font-bold text-cyan-400/90 tracking-wider">
                  Auditar Operador (Super Admin):
                </span>
                <select
                  value={selectedOperatorName}
                  onChange={(e) => setSelectedOperatorName(e.target.value)}
                  className="bg-transparent text-xs font-bold text-white focus:outline-none cursor-pointer pr-2 font-mono"
                >
                  <option value="__ALL__" className="bg-[#070c18] text-cyan-300 font-bold">
                    ⭐ Todos los Operadores (Consolidado)
                  </option>
                  {operators.map((op) => (
                    <option key={op.id} value={op.name} className="bg-[#070c18] text-white">
                      {op.name} ({op.role.split(' ')[0]})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Transfer Sales Button */}
          <button
            type="button"
            onClick={() => {
              setTransferStep('select');
              setIsTransferModalOpen(true);
            }}
            className="bg-[#060e1d] hover:bg-[#0a1730] text-cyan-300 hover:text-white border border-cyan-500/30 px-3.5 py-2.5 rounded-2xl text-xs font-mono font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-[0_0_15px_rgba(6,182,212,0.15)] active:scale-95"
          >
            <span className="material-symbols-outlined text-[18px]">swap_horiz</span>
            <span>Traspaso de Venta</span>
          </button>

          {/* Print Performance Report Button */}
          <button
            type="button"
            onClick={() => setIsPrintModalOpen(true)}
            className="bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-slate-950 font-black text-xs py-2.5 px-4 rounded-2xl flex items-center gap-2 transition-all cursor-pointer shadow-[0_0_20px_rgba(6,182,212,0.35)] active:scale-95"
          >
            <span className="material-symbols-outlined text-[18px]">print</span>
            <span>Imprimir Reporte</span>
          </button>
        </div>
      </div>

      {/* SECTION 2: Period Filter Selector & Date Navigator (Semana Lun-Dom vs Mes) */}
      <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-4.5 shadow-[0_15px_40px_rgba(0,0,0,0.6)] flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Period Toggle Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setPeriodType('semana');
              setWeekOffset(0);
            }}
            className={`px-4 py-2.5 rounded-2xl text-xs font-mono font-bold flex items-center gap-2 transition-all cursor-pointer ${
              periodType === 'semana'
                ? 'bg-emerald-500/20 border-2 border-emerald-400 text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.35)]'
                : 'bg-[#040814] text-slate-400 hover:text-white border border-cyan-500/20'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">calendar_view_week</span>
            <span>1. Filtro por Semana (Lun - Dom)</span>
            {periodType === 'semana' && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setPeriodType('mes');
              setMonthOffset(0);
            }}
            className={`px-4 py-2.5 rounded-2xl text-xs font-mono font-bold flex items-center gap-2 transition-all cursor-pointer ${
              periodType === 'mes'
                ? 'bg-purple-500/20 border-2 border-purple-400 text-purple-300 shadow-[0_0_20px_rgba(168,85,247,0.35)]'
                : 'bg-[#040814] text-slate-400 hover:text-white border border-cyan-500/20'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">calendar_month</span>
            <span>2. Filtro por Mes</span>
            {periodType === 'mes' && (
              <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setPeriodType('todo')}
            className={`px-4 py-2.5 rounded-2xl text-xs font-mono font-bold flex items-center gap-2 transition-all cursor-pointer ${
              periodType === 'todo'
                ? 'bg-cyan-500/20 border-2 border-cyan-400 text-cyan-300 shadow-[0_0_20px_rgba(6,182,212,0.35)]'
                : 'bg-[#040814] text-slate-400 hover:text-white border border-cyan-500/20'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">analytics</span>
            <span>3. Todo el Histórico</span>
          </button>
        </div>

        {/* Date Navigator Controls */}
        {periodType !== 'todo' && (
          <div className="flex items-center gap-2 bg-[#040814] border border-cyan-500/30 rounded-2xl p-1.5 shadow-[inset_0_0_12px_rgba(0,0,0,0.6)]">
            <button
              type="button"
              onClick={() => {
                if (periodType === 'semana') setWeekOffset((prev) => prev - 1);
                if (periodType === 'mes') setMonthOffset((prev) => prev - 1);
              }}
              title="Período Anterior"
              className="p-1.5 rounded-xl hover:bg-cyan-500/20 text-cyan-400 hover:text-white transition-all cursor-pointer active:scale-95"
            >
              <span className="material-symbols-outlined text-[20px]">chevron_left</span>
            </button>

            <div className="px-3 text-center">
              <span className="block text-xs font-mono font-bold text-white">
                {periodLabel.title}
              </span>
              <span className="block text-[10px] font-mono text-cyan-400/80">
                {periodLabel.subtitle}
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                if (periodType === 'semana') setWeekOffset((prev) => prev + 1);
                if (periodType === 'mes') setMonthOffset((prev) => prev + 1);
              }}
              title="Período Siguiente"
              className="p-1.5 rounded-xl hover:bg-cyan-500/20 text-cyan-400 hover:text-white transition-all cursor-pointer active:scale-95"
            >
              <span className="material-symbols-outlined text-[20px]">chevron_right</span>
            </button>

            {!periodLabel.isCurrent && (
              <button
                type="button"
                onClick={() => {
                  if (periodType === 'semana') setWeekOffset(0);
                  if (periodType === 'mes') setMonthOffset(0);
                }}
                className="ml-1 px-2.5 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 rounded-xl text-[10.5px] font-mono font-bold transition-all border border-cyan-500/40 cursor-pointer"
              >
                Hoy
              </button>
            )}
          </div>
        )}
      </div>

      {/* SECTION 3: Key Performance Indicators HUD Matrix */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* KPI 1: Facturación Total en Ventas */}
        <div className="relative rounded-2xl bg-[#070c18]/90 backdrop-blur-2xl border border-emerald-500/30 p-4 flex flex-col justify-between shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_10px_#34d399]" />
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold text-emerald-400 uppercase tracking-wider">
              Facturación Ventas
            </span>
            <div className="w-7 h-7 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center border border-emerald-400/30">
              <span className="material-symbols-outlined text-[16px]">payments</span>
            </div>
          </div>
          <div className="mt-2">
            <span className="text-xl lg:text-2xl font-mono font-black text-emerald-300">
              ${kpis.salesSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <p className="text-[10px] font-mono text-slate-400 mt-0.5">
              {kpis.salesCount} {kpis.salesCount === 1 ? 'venta cerrada' : 'ventas cerradas'}
            </p>
          </div>
        </div>

        {/* KPI 2: Ventas Cerradas & Ticket Promedio */}
        <div className="relative rounded-2xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/30 p-4 flex flex-col justify-between shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_10px_#22d3ee]" />
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold text-cyan-400 uppercase tracking-wider">
              Ticket Promedio
            </span>
            <div className="w-7 h-7 rounded-xl bg-cyan-500/15 text-cyan-400 flex items-center justify-center border border-cyan-400/30">
              <span className="material-symbols-outlined text-[16px]">shopping_bag</span>
            </div>
          </div>
          <div className="mt-2">
            <span className="text-xl lg:text-2xl font-mono font-black text-cyan-300">
              ${kpis.averageTicket.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <p className="text-[10px] font-mono text-slate-400 mt-0.5">
              Por orden facturada
            </p>
          </div>
        </div>

        {/* KPI 3: Anticipos Cobrados */}
        <div className="relative rounded-2xl bg-[#070c18]/90 backdrop-blur-2xl border border-teal-500/30 p-4 flex flex-col justify-between shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-teal-400 to-transparent shadow-[0_0_10px_#2dd4bf]" />
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold text-teal-400 uppercase tracking-wider">
              Anticipos en Mano
            </span>
            <div className="w-7 h-7 rounded-xl bg-teal-500/15 text-teal-400 flex items-center justify-center border border-teal-400/30">
              <span className="material-symbols-outlined text-[16px]">savings</span>
            </div>
          </div>
          <div className="mt-2">
            <span className="text-xl lg:text-2xl font-mono font-black text-teal-300">
              ${kpis.downPaymentSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <p className="text-[10px] font-mono text-slate-400 mt-0.5">
              Abonado en el período
            </p>
          </div>
        </div>

        {/* KPI 4: Saldo Pendiente por Cobrar */}
        <div className="relative rounded-2xl bg-[#070c18]/90 backdrop-blur-2xl border border-amber-500/30 p-4 flex flex-col justify-between shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_10px_#fbbf24]" />
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold text-amber-400 uppercase tracking-wider">
              Saldo por Cobrar
            </span>
            <div className="w-7 h-7 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center border border-amber-400/30">
              <span className="material-symbols-outlined text-[16px]">pending_actions</span>
            </div>
          </div>
          <div className="mt-2">
            <span className="text-xl lg:text-2xl font-mono font-black text-amber-300">
              ${kpis.balanceDueSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <p className="text-[10px] font-mono text-slate-400 mt-0.5">
              A liquidar en despacho
            </p>
          </div>
        </div>

        {/* KPI 5: Cotizaciones y Conversión */}
        <div className="relative rounded-2xl bg-[#070c18]/90 backdrop-blur-2xl border border-blue-500/30 p-4 flex flex-col justify-between shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-blue-400 to-transparent shadow-[0_0_10px_#60a5fa]" />
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold text-blue-400 uppercase tracking-wider">
              Cotizaciones
            </span>
            <div className="w-7 h-7 rounded-xl bg-blue-500/15 text-blue-400 flex items-center justify-center border border-blue-400/30">
              <span className="material-symbols-outlined text-[16px]">request_quote</span>
            </div>
          </div>
          <div className="mt-2">
            <span className="text-xl lg:text-2xl font-mono font-black text-blue-300">
              {kpis.quotesCount}
            </span>
            <p className="text-[10px] font-mono text-slate-400 mt-0.5">
              Conversión: {kpis.conversionRate.toFixed(1)}%
            </p>
          </div>
        </div>

        {/* KPI 6: Órdenes Activas en Taller */}
        <div className="relative rounded-2xl bg-[#070c18]/90 backdrop-blur-2xl border border-purple-500/30 p-4 flex flex-col justify-between shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-purple-400 to-transparent shadow-[0_0_10px_#c084fc]" />
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold text-purple-400 uppercase tracking-wider">
              Órdenes Activas
            </span>
            <div className="w-7 h-7 rounded-xl bg-purple-500/15 text-purple-400 flex items-center justify-center border border-purple-400/30">
              <span className="material-symbols-outlined text-[16px]">inventory_2</span>
            </div>
          </div>
          <div className="mt-2">
            <span className="text-xl lg:text-2xl font-mono font-black text-purple-300">
              {kpis.activeCount}
            </span>
            <p className="text-[10px] font-mono text-slate-400 mt-0.5">
              En proceso & despacho
            </p>
          </div>
        </div>
      </div>

      {/* SECTION 4: Visual Sales Distribution Charts & Logistics Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left 2 Cols: Temporal Sales Histogram (Week Lun-Dom or Month) */}
        <div className="lg:col-span-2 rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 shadow-[0_15px_40px_rgba(0,0,0,0.6)] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-cyan-400 text-[20px]">bar_chart</span>
                <h3 className="text-sm font-bold text-white font-mono tracking-tight">
                  {periodType === 'semana'
                    ? 'Distribución Diaria de Ventas (Lunes a Domingo)'
                    : periodType === 'mes'
                    ? 'Distribución Semanal del Mes Seleccionado'
                    : 'Consolidado Global de Ventas'}
                </h3>
              </div>
              <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-xl border border-emerald-500/30">
                ${kpis.salesSum.toFixed(2)} USD
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mb-4">
              {periodType === 'semana'
                ? `Ventas registradas entre el lunes ${weekRange.monday.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })} y el domingo ${weekRange.sunday.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}.`
                : periodType === 'mes'
                ? `Progreso acumulado de ventas durante el mes de ${monthRange.start.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}.`
                : 'Historial completo de ventas generadas por el operador.'}
            </p>
          </div>

          {/* Dynamic Bars Rendering */}
          {periodType === 'semana' ? (
            <div className="grid grid-cols-7 gap-2 pt-4 border-t border-cyan-500/20">
              {weeklyDayBreakdown.days.map((d) => {
                const heightPercent = Math.max(8, Math.round((d.amount / weeklyDayBreakdown.maxAmount) * 100));
                const hasSales = d.count > 0;
                return (
                  <div key={d.key} className="flex flex-col items-center gap-2 group">
                    <span className="text-[10px] font-mono text-emerald-400 font-bold">
                      {d.count > 0 ? `$${Math.round(d.amount)}` : '—'}
                    </span>
                    <div className="w-full bg-[#040814] h-28 rounded-xl border border-cyan-500/20 p-1 flex flex-col justify-end items-center relative overflow-hidden group-hover:border-cyan-400 transition-all">
                      <div
                        style={{ height: `${heightPercent}%` }}
                        className={`w-full rounded-lg transition-all duration-500 ${
                          hasSales
                            ? 'bg-gradient-to-t from-emerald-600 to-cyan-400 shadow-[0_0_12px_rgba(52,211,153,0.5)]'
                            : 'bg-slate-800/40'
                        }`}
                      />
                    </div>
                    <div className="text-center">
                      <span className="text-xs font-mono font-bold text-white block">{d.name}</span>
                      <span className="text-[10px] font-mono text-slate-400 block">
                        {d.count} {d.count === 1 ? 'vta' : 'vtas'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-2 pt-4 border-t border-cyan-500/20">
              {monthlyWeekBreakdown.weeks.map((w, idx) => {
                const heightPercent = Math.max(8, Math.round((w.amount / monthlyWeekBreakdown.maxAmount) * 100));
                const hasSales = w.count > 0;
                return (
                  <div key={idx} className="flex flex-col items-center gap-2 group">
                    <span className="text-[10px] font-mono text-purple-400 font-bold">
                      {w.count > 0 ? `$${Math.round(w.amount)}` : '—'}
                    </span>
                    <div className="w-full bg-[#040814] h-28 rounded-xl border border-cyan-500/20 p-1 flex flex-col justify-end items-center relative overflow-hidden group-hover:border-purple-400 transition-all">
                      <div
                        style={{ height: `${heightPercent}%` }}
                        className={`w-full rounded-lg transition-all duration-500 ${
                          hasSales
                            ? 'bg-gradient-to-t from-purple-600 to-cyan-400 shadow-[0_0_12px_rgba(168,85,247,0.5)]'
                            : 'bg-slate-800/40'
                        }`}
                      />
                    </div>
                    <div className="text-center">
                      <span className="text-xs font-mono font-bold text-white block">{w.label}</span>
                      <span className="text-[10px] font-mono text-slate-400 block">
                        {w.count} {w.count === 1 ? 'vta' : 'vtas'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right 1 Col: Logistics & Delivery Channel Breakdown */}
        <div className="rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 shadow-[0_15px_40px_rgba(0,0,0,0.6)] flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-cyan-400 text-[20px]">local_shipping</span>
              <h3 className="text-sm font-bold text-white font-mono tracking-tight">
                Canal de Entrega & Logística
              </h3>
            </div>
            <p className="text-xs text-slate-400 font-mono mb-4">
              Preferencia de despacho de los clientes en este período.
            </p>
          </div>

          <div className="space-y-4 pt-2 border-t border-cyan-500/20">
            {/* Mostrador / Retiro en Patio */}
            <div>
              <div className="flex items-center justify-between text-xs font-mono mb-1.5">
                <span className="text-slate-300 font-bold flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-cyan-400">store</span>
                  <span>Retiro en Mostrador / Patio</span>
                </span>
                <span className="text-cyan-300 font-bold">
                  {deliveryBreakdown.storePickupCount} ({deliveryBreakdown.storePickupPercent}%)
                </span>
              </div>
              <div className="w-full bg-[#040814] h-2.5 rounded-full overflow-hidden border border-cyan-500/20">
                <div
                  style={{ width: `${deliveryBreakdown.storePickupPercent}%` }}
                  className="h-full bg-cyan-400 rounded-full transition-all duration-500 shadow-[0_0_8px_#22d3ee]"
                />
              </div>
              <span className="text-[10px] font-mono text-slate-400 block mt-1">
                Facturado: ${deliveryBreakdown.storePickupSum.toFixed(2)} USD
              </span>
            </div>

            {/* Envío a Domicilio */}
            <div>
              <div className="flex items-center justify-between text-xs font-mono mb-1.5">
                <span className="text-slate-300 font-bold flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-emerald-400">local_shipping</span>
                  <span>Envío a Domicilio / Flete</span>
                </span>
                <span className="text-emerald-300 font-bold">
                  {deliveryBreakdown.shippingCount} ({deliveryBreakdown.shippingPercent}%)
                </span>
              </div>
              <div className="w-full bg-[#040814] h-2.5 rounded-full overflow-hidden border border-cyan-500/20">
                <div
                  style={{ width: `${deliveryBreakdown.shippingPercent}%` }}
                  className="h-full bg-emerald-400 rounded-full transition-all duration-500 shadow-[0_0_8px_#34d399]"
                />
              </div>
              <span className="text-[10px] font-mono text-slate-400 block mt-1">
                Facturado: ${deliveryBreakdown.shippingSum.toFixed(2)} USD
              </span>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-cyan-500/15 text-center">
            <span className="text-[11px] font-mono text-cyan-400/90 font-bold">
              Total Ventas Despachadas: {periodSales.length}
            </span>
          </div>
        </div>
      </div>

      {/* SECTION 5: Segmented Tabbed Tables (Ventas del Período, Órdenes Activas, Cotizaciones, Reclamos) */}
      <div className="relative rounded-3xl bg-[#070c18]/92 backdrop-blur-3xl border border-cyan-500/25 overflow-hidden shadow-[0_25px_70px_rgba(0,0,0,0.75)] flex flex-col">
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 shadow-[0_0_12px_#22d3ee]" />

        {/* Tab Navigation Header */}
        <div className="p-3.5 bg-[#040814]/90 border-b border-cyan-500/20 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('ventas_periodo')}
              className={`px-4 py-2 rounded-2xl text-xs font-mono font-bold transition-all cursor-pointer flex items-center gap-2 ${
                activeTab === 'ventas_periodo'
                  ? 'bg-emerald-500/20 border-2 border-emerald-400 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.35)]'
                  : 'bg-[#040814] text-slate-400 hover:text-white border border-cyan-500/20'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">shopping_bag</span>
              <span>1. Ventas del Período ({periodType === 'semana' ? 'Semanal' : periodType === 'mes' ? 'Mensual' : 'Total'})</span>
              <span className="text-[10px] px-2 py-0.5 rounded-md font-mono font-bold bg-[#02050c] text-white border border-cyan-500/25">
                {periodSales.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('activas')}
              className={`px-4 py-2 rounded-2xl text-xs font-mono font-bold transition-all cursor-pointer flex items-center gap-2 ${
                activeTab === 'activas'
                  ? 'bg-cyan-500/20 border-2 border-cyan-400 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.35)]'
                  : 'bg-[#040814] text-slate-400 hover:text-white border border-cyan-500/20'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">inventory_2</span>
              <span>2. Órdenes Activas en Curso</span>
              <span className="text-[10px] px-2 py-0.5 rounded-md font-mono font-bold bg-[#02050c] text-white border border-cyan-500/25">
                {activeOrders.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('cotizaciones')}
              className={`px-4 py-2 rounded-2xl text-xs font-mono font-bold transition-all cursor-pointer flex items-center gap-2 ${
                activeTab === 'cotizaciones'
                  ? 'bg-blue-500/20 border-2 border-blue-400 text-blue-300 shadow-[0_0_15px_rgba(96,165,250,0.35)]'
                  : 'bg-[#040814] text-slate-400 hover:text-white border border-cyan-500/20'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">request_quote</span>
              <span>3. Cotizaciones del Período</span>
              <span className="text-[10px] px-2 py-0.5 rounded-md font-mono font-bold bg-[#02050c] text-white border border-cyan-500/25">
                {periodQuotes.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('reclamos_reembolsos')}
              className={`px-4 py-2 rounded-2xl text-xs font-mono font-bold transition-all cursor-pointer flex items-center gap-2 ${
                activeTab === 'reclamos_reembolsos'
                  ? 'bg-red-500/20 border-2 border-red-400 text-red-300 shadow-[0_0_15px_rgba(239,68,68,0.35)]'
                  : 'bg-[#040814] text-slate-400 hover:text-white border border-cyan-500/20'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">warning</span>
              <span>4. Reclamaciones & Reembolsos</span>
              <span className="text-[10px] px-2 py-0.5 rounded-md font-mono font-bold bg-[#02050c] text-white border border-cyan-500/25">
                {operatorClaims.length + operatorRefunds.length}
              </span>
            </button>
          </div>

          {/* Search Box in Active Tab */}
          <div className="relative w-64">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[16px]">
              search
            </span>
            <input
              type="text"
              placeholder="Buscar por código, cliente o pieza..."
              value={searchTableQuery}
              onChange={(e) => setSearchTableQuery(e.target.value)}
              className="w-full bg-[#070e1c] border border-cyan-500/30 rounded-xl py-1.5 pl-8 pr-3 text-xs text-white focus:outline-none focus:border-cyan-400 placeholder:text-slate-500 font-mono"
            />
          </div>
        </div>

        {/* Tab 1: Ventas del Período */}
        {activeTab === 'ventas_periodo' && (
          <div className="flex flex-col">
            <div className="table-responsive-wrapper custom-scrollbar">
              <table className="w-full text-left text-xs border-collapse min-w-[980px]">
                <thead className="bg-[#090d16] text-[#94a3b8] uppercase text-[10px] tracking-wider border-b border-[#1e293b]">
                  <tr>
                    <th className="py-3 px-4">Código Orden</th>
                    <th className="py-3 px-4">Fecha & Hora</th>
                    <th className="py-3 px-4">Cliente & Contacto</th>
                    <th className="py-3 px-4">Vehículo</th>
                    <th className="py-3 px-4">Pieza / Repuesto</th>
                    <th className="py-3 px-4">Monto Venta</th>
                    <th className="py-3 px-4">Anticipo</th>
                    <th className="py-3 px-4">Saldo Restante</th>
                    <th className="py-3 px-4">Entrega</th>
                    <th className="py-3 px-4">Estatus</th>
                    <th className="py-3 px-4 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e293b] text-[#cbd5e1]">
                  {displaySalesList.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-12 text-center text-[#94a3b8] font-mono">
                        No se encontraron ventas para {currentOperator.name} en el período seleccionado (
                        {periodLabel.title}).
                      </td>
                    </tr>
                  ) : (
                    displaySalesList.map((order) => {
                      const totalAmount = order.financials?.partPrice || order.financials?.total || 0;
                      const downPayment = order.financials?.downPayment || order.financials?.advancePayment || 0;
                      const balanceDue = order.financials?.balanceDue ?? Math.max(0, totalAmount - downPayment);
                      return (
                        <tr key={order.id} className="hover:bg-[#1e293b]/40 transition-colors">
                          <td className="py-3.5 px-4 font-mono font-bold text-cyan-400">
                            {order.code}
                          </td>
                          <td className="py-3.5 px-4 text-[#94a3b8] font-mono">{order.createdAt}</td>
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-[#f1f5f9]">{order.customer.name}</div>
                            <div className="text-[11px] font-mono text-[#94a3b8]">
                              {order.customer.phone}
                            </div>
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-[#f1f5f9]">
                              {order.vehicle.year} {order.vehicle.make} {order.vehicle.model}
                            </div>
                            <div className="text-[10px] font-mono text-[#64748b]">
                              {order.vehicle.vin ? `VIN: ${order.vehicle.vin}` : 'Sin VIN'}
                            </div>
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="font-medium text-[#cbd5e1]">{order.mainPart}</div>
                            {order.stockNumber && (
                              <span className="text-[10px] font-mono text-cyan-400">
                                Stock #{order.stockNumber}
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 font-mono font-bold text-emerald-400">
                            ${totalAmount.toFixed(2)}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-teal-300">
                            ${downPayment.toFixed(2)}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-amber-300">
                            ${balanceDue.toFixed(2)}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="text-[11px] font-medium bg-[#1e293b] px-2 py-0.5 rounded border border-[#2b3a58] text-[#cbd5e1]">
                              {order.deliveryType === 'retiro_tienda' ? '🏢 Mostrador' : '🚚 Enví­o Flete'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 uppercase">
                              {order.status}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => onSelectOrder && onSelectOrder(order.id)}
                              className="px-3 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500 text-cyan-300 hover:text-slate-950 font-mono text-xs font-bold transition-all cursor-pointer border border-cyan-500/40 active:scale-95"
                            >
                              Ver Orden
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Table Totals Summary Footer */}
            <div className="bg-[#040814] p-4 border-t border-cyan-500/20 flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
              <div className="flex items-center gap-4 text-slate-300">
                <span>
                  Ventas: <strong className="text-white font-bold">{displaySalesList.length}</strong>
                </span>
                <span>•</span>
                <span>
                  Facturación:{' '}
                  <strong className="text-emerald-400 text-sm font-bold">
                    ${kpis.salesSum.toFixed(2)} USD
                  </strong>
                </span>
                <span>•</span>
                <span>
                  Anticipos Cobrados:{' '}
                  <strong className="text-teal-400 font-bold">
                    ${kpis.downPaymentSum.toFixed(2)} USD
                  </strong>
                </span>
                <span>•</span>
                <span>
                  Saldo por Cobrar:{' '}
                  <strong className="text-amber-400 font-bold">
                    ${kpis.balanceDueSum.toFixed(2)} USD
                  </strong>
                </span>
              </div>

              <div className="bg-emerald-500/15 border border-emerald-500/40 rounded-xl px-4 py-2 flex items-center gap-3">
                <span className="material-symbols-outlined text-emerald-400 text-[20px]">verified</span>
                <div>
                  <span className="text-[10px] uppercase font-bold text-emerald-300 block">
                    Resumen del Período
                  </span>
                  <span className="text-sm font-mono font-black text-emerald-400">
                    {displaySalesList.length} {displaySalesList.length === 1 ? 'Venta Registrada' : 'Ventas Registradas'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Órdenes Activas en Curso */}
        {activeTab === 'activas' && (
          <div className="p-4 flex flex-col gap-3">
            {activeOrders.length === 0 ? (
              <div className="py-12 text-center text-xs text-[#94a3b8] font-mono">
                No tienes órdenes activas en preparación o despacho en este momento.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {activeOrders.map((order) => {
                  const total = order.financials?.partPrice || order.financials?.total || 0;
                  return (
                    <div
                      key={order.id}
                      className="bg-[#090d16] border border-[#2b3a58] rounded-2xl p-4 flex flex-col justify-between gap-3 shadow-md hover:border-cyan-400 transition-all"
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-xs text-cyan-400 bg-[#1e293b] px-2 py-0.5 rounded border border-[#2b3a58]">
                            {order.code}
                          </span>
                          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                            {order.status}
                          </span>
                        </div>

                        <div className="mt-2 text-xs font-bold text-[#f1f5f9]">
                          {order.customer.name} · <span className="font-mono text-[#94a3b8] font-normal">{order.customer.phone}</span>
                        </div>

                        <div className="text-xs text-[#cbd5e1] mt-1">
                          <span className="text-white font-semibold">
                            {order.vehicle.year} {order.vehicle.make} {order.vehicle.model}
                          </span>
                        </div>
                        <div className="text-[11px] text-cyan-400 font-medium mt-0.5">
                          {order.mainPart}
                        </div>
                        {order.notes && (
                          <p className="text-[10px] text-[#94a3b8] mt-1 line-clamp-2 italic font-mono">
                            "{order.notes}"
                          </p>
                        )}
                      </div>

                      <div className="pt-3 border-t border-[#1e293b] flex items-center justify-between text-xs">
                        <div>
                          <span className="text-[10px] text-[#94a3b8] block">Monto Venta</span>
                          <strong className="text-sm font-mono text-emerald-400">
                            ${total.toFixed(2)} USD
                          </strong>
                        </div>

                        <button
                          type="button"
                          onClick={() => onSelectOrder && onSelectOrder(order.id)}
                          className="px-3 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-all flex items-center gap-1 cursor-pointer active:scale-95 shadow"
                        >
                          <span>Gestionar</span>
                          <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Cotizaciones del Período */}
        {activeTab === 'cotizaciones' && (
          <div className="flex flex-col">
            <div className="table-responsive-wrapper custom-scrollbar">
              <table className="w-full text-left text-xs border-collapse min-w-[880px]">
                <thead className="bg-[#090d16] text-[#94a3b8] uppercase text-[10px] tracking-wider border-b border-[#1e293b]">
                  <tr>
                    <th className="py-3 px-4">Código Cotización</th>
                    <th className="py-3 px-4">Fecha</th>
                    <th className="py-3 px-4">Cliente</th>
                    <th className="py-3 px-4">Vehículo & Pieza</th>
                    <th className="py-3 px-4">Monto Estimado</th>
                    <th className="py-3 px-4">Estatus</th>
                    <th className="py-3 px-4 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e293b] text-[#cbd5e1]">
                  {periodQuotes.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-[#94a3b8] font-mono">
                        No hay cotizaciones registradas en este período.
                      </td>
                    </tr>
                  ) : (
                    periodQuotes.map((order) => {
                      const totalAmount = order.financials?.partPrice || order.financials?.total || 0;
                      return (
                        <tr key={order.id} className="hover:bg-[#1e293b]/40 transition-colors">
                          <td className="py-3.5 px-4 font-mono font-bold text-blue-400">
                            {order.code}
                          </td>
                          <td className="py-3.5 px-4 text-[#94a3b8] font-mono">{order.createdAt}</td>
                          <td className="py-3.5 px-4 font-bold text-[#f1f5f9]">{order.customer.name}</td>
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-white">
                              {order.vehicle.year} {order.vehicle.make} {order.vehicle.model}
                            </div>
                            <div className="text-[11px] text-blue-400">{order.mainPart}</div>
                          </td>
                          <td className="py-3.5 px-4 font-mono font-bold text-blue-300">
                            ${totalAmount.toFixed(2)}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40 uppercase">
                              {order.status}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => onSelectOrder && onSelectOrder(order.id)}
                              className="px-3 py-1.5 rounded-xl bg-blue-500/20 hover:bg-blue-500 text-blue-300 hover:text-slate-950 text-xs font-mono font-bold transition-all cursor-pointer border border-blue-500/40 active:scale-95"
                            >
                              Dar Seguimiento
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 4: Reclamaciones & Reembolsos */}
        {activeTab === 'reclamos_reembolsos' && (
          <div className="p-4 flex flex-col gap-6">
            {/* Reclamos Técnicos */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-xs uppercase tracking-wider text-[#f87171] flex items-center gap-1.5 font-mono">
                  <span className="material-symbols-outlined text-[18px]">verified_user</span>
                  <span>Reclamaciones Técnicas & Garantías ({operatorClaims.length})</span>
                </h3>
              </div>

              {operatorClaims.length === 0 ? (
                <div className="bg-[#090d16] border border-[#1e293b] rounded-2xl p-4 text-center text-xs text-[#94a3b8] font-mono">
                  Excelente: No hay reclamos técnicos abiertos vinculados a este operador.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {operatorClaims.map((claim) => (
                    <div
                      key={claim.id}
                      className="bg-[#090d16] border border-[#ef4444]/30 rounded-2xl p-4 flex flex-col justify-between gap-2 shadow-sm"
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-xs text-cyan-400">
                            {claim.id} · {claim.orderCode}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase font-mono ${
                              claim.status === 'Pending'
                                ? 'bg-[#f59e0b]/20 text-[#fbbf24] border border-[#f59e0b]/40'
                                : claim.status === 'In Process'
                                ? 'bg-[#388bfd]/20 text-[#58a6ff] border border-[#388bfd]/40'
                                : claim.status === 'Resolved'
                                ? 'bg-[#10b981]/20 text-[#34d399] border border-[#10b981]/40'
                                : 'bg-[#ef4444]/20 text-[#f87171] border border-[#ef4444]/40'
                            }`}
                          >
                            {claim.status}
                          </span>
                        </div>

                        <div className="text-xs font-bold text-[#f1f5f9] mt-1.5">
                          {claim.customerName} · {claim.vehicle}
                        </div>
                        <div className="text-[11px] text-cyan-400">{claim.mainPart}</div>
                        <p className="text-[11px] text-[#cbd5e1] mt-1 italic font-mono">
                          "{claim.claimReason}"
                        </p>
                      </div>

                      <div className="pt-2 border-t border-[#1e293b] flex items-center justify-between text-[11px] text-[#94a3b8] font-mono">
                        <span>📞 {claim.callCount || 0} llamadas registradas</span>
                        <span>Prioridad: <strong className="text-white">{claim.priority}</strong></span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Solicitudes de Reembolso */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-xs uppercase tracking-wider text-[#fbbf24] flex items-center gap-1.5 font-mono">
                  <span className="material-symbols-outlined text-[18px]">currency_exchange</span>
                  <span>Solicitudes de Reembolso Monetario ({operatorRefunds.length})</span>
                </h3>
              </div>

              {operatorRefunds.length === 0 ? (
                <div className="bg-[#090d16] border border-[#1e293b] rounded-2xl p-4 text-center text-xs text-[#94a3b8] font-mono">
                  No hay solicitudes de reembolso registradas.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {operatorRefunds.map((refund) => (
                    <div
                      key={refund.id}
                      className="bg-[#090d16] border border-[#f59e0b]/30 rounded-2xl p-4 flex flex-col justify-between gap-2 shadow-sm"
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-xs text-cyan-400">
                            {refund.id} · {refund.orderCode}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase font-mono ${
                              refund.status === 'pending'
                                ? 'bg-[#f59e0b]/20 text-[#fbbf24] border border-[#f59e0b]/40'
                                : 'bg-[#10b981]/20 text-[#34d399] border border-[#10b981]/40'
                            }`}
                          >
                            {refund.status === 'pending' ? 'En Espera' : 'Completado'}
                          </span>
                        </div>

                        <div className="text-xs font-bold text-[#f1f5f9] mt-1.5">
                          {refund.customerName} · {refund.vehicle}
                        </div>
                        <p className="text-[11px] text-[#94a3b8] mt-0.5 font-mono">Motivo: {refund.reason}</p>
                      </div>

                      <div className="pt-2 border-t border-[#1e293b] flex items-center justify-between text-xs font-mono">
                        <span className="text-[#fbbf24] font-bold">
                          ${refund.amount.toFixed(2)} USD via {refund.paymentMethod}
                        </span>
                        <span className="text-[11px] text-[#94a3b8]">{refund.paymentDetails}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* MODAL 1: FLIGHT / SALES TRANSFER WITH OTP */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-[#111827] border border-[#2b3a58] rounded-2xl w-full max-w-2xl max-h-[min(94vh,700px)] shadow-2xl flex flex-col overflow-hidden">
            <div className="p-4 sm:p-5 bg-[#182338] border-b border-[#2b3a58] flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#388bfd]/20 text-[#58a6ff] flex items-center justify-center border border-[#388bfd]/40">
                  <span className="material-symbols-outlined text-[22px]">swap_horiz</span>
                </div>
                <div>
                  <h3 className="font-bold text-base text-[#f1f5f9]">
                    Traspaso de Venta Colaborativa con Código OTP
                  </h3>
                  <p className="text-xs text-[#94a3b8]">
                    Reasigna la autoría a <strong className="text-white">{selectedOperatorName}</strong>.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsTransferModalOpen(false);
                  setTransferSelectedOrder(null);
                  setTransferStep('select');
                }}
                className="text-[#94a3b8] hover:text-white p-1"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {transferStep === 'select' && (
              <div className="p-5 sm:p-6 flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider font-mono">
                    Paso 1: Selecciona la orden a traspasar
                  </span>
                  <div className="relative w-64">
                    <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94a3b8] text-[16px]">
                      search
                    </span>
                    <input
                      type="text"
                      placeholder="Buscar orden o cliente..."
                      value={transferFilterSearch}
                      onChange={(e) => setTransferFilterSearch(e.target.value)}
                      className="w-full bg-[#090d16] border border-[#2b3a58] rounded-xl py-1.5 pl-8 pr-3 text-xs text-[#f1f5f9] focus:outline-none focus:border-cyan-400 font-mono"
                    />
                  </div>
                </div>

                {filteredOtherOrders.length === 0 ? (
                  <div className="bg-[#090d16] border border-[#1e293b] rounded-xl p-8 text-center text-xs text-[#94a3b8] font-mono">
                    No hay órdenes de otros operadores disponibles para traspaso en este momento.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5 max-h-96 overflow-y-auto pr-1 custom-scrollbar">
                    {filteredOtherOrders.map((order) => {
                      const total = order.financials?.partPrice || order.financials?.total || 0;
                      return (
                        <div
                          key={order.id}
                          className="bg-[#090d16] border border-[#1e293b] hover:border-cyan-400 rounded-xl p-3.5 flex items-center justify-between gap-3 transition-all"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-xs text-cyan-400">
                                {order.code}
                              </span>
                              <span className="text-xs font-bold text-white">
                                {order.customer.name}
                              </span>
                              <span className="text-[10px] font-mono bg-[#1e293b] text-[#cbd5e1] px-2 py-0.5 rounded border border-[#2b3a58]">
                                Asesor: {order.advisor || 'Sin asignar'}
                              </span>
                            </div>

                            <div className="text-xs text-[#cbd5e1] mt-1 font-mono">
                              {order.vehicle.year} {order.vehicle.make} {order.vehicle.model} · {order.mainPart}
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right">
                              <span className="text-[10px] text-[#94a3b8] block font-mono">Monto Venta</span>
                              <strong className="text-xs font-mono text-emerald-400">
                                ${total.toFixed(2)} USD
                              </strong>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleStartTransfer(order)}
                              className="px-3 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-all flex items-center gap-1 cursor-pointer active:scale-95 shadow"
                            >
                              <span>Solicitar Código</span>
                              <span className="material-symbols-outlined text-[14px]">send</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {transferStep === 'otp' && transferSelectedOrder && (
              <form onSubmit={handleConfirmTransfer} className="p-5 sm:p-6 flex flex-col gap-5 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                <div className="bg-[#10b981]/10 border border-[#10b981]/40 rounded-xl p-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <div className="flex items-center gap-2 text-emerald-400 font-bold">
                      <span className="material-symbols-outlined text-[18px]">chat</span>
                      <span>Notificación WhatsApp Wasender Enviada</span>
                    </div>
                    <span className="text-[10px] text-emerald-300">
                      Tiempo: {Math.floor(otpTimerSeconds / 60)}:{String(otpTimerSeconds % 60).padStart(2, '0')}
                    </span>
                  </div>

                  <div className="bg-[#090d16] p-3 rounded-lg border border-[#10b981]/30 font-mono text-xs text-[#cbd5e1] leading-relaxed">
                    <span className="text-emerald-400 font-bold block mb-1">
                      [Mensaje Wasender a {transferSelectedOrder.advisor}]:
                    </span>
                    "🔒 RADAR OTP: Hola {transferSelectedOrder.advisor}, el especialista{' '}
                    <strong className="text-white">{selectedOperatorName}</strong> ha solicitado el traspaso de la orden{' '}
                    <strong className="text-cyan-400">{transferSelectedOrder.code}</strong> ($
                    {(transferSelectedOrder.financials?.partPrice || 0).toFixed(2)} USD). Tu código de seguridad es:{' '}
                    <span className="text-emerald-300 font-bold text-sm bg-[#1e293b] px-1.5 py-0.5 rounded">
                      {generatedOtp}
                    </span>
                    ."
                  </div>
                </div>

                <div className="flex flex-col items-center gap-2">
                  <label className="text-xs font-bold text-[#f1f5f9] font-mono">
                    Código de 6 Dígitos proporcionado por {transferSelectedOrder.advisor} *
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    required
                    placeholder="000000"
                    value={transferOtpInput}
                    onChange={(e) => {
                      setTransferOtpInput(e.target.value);
                      setTransferError(null);
                    }}
                    className="w-48 bg-[#090d16] border-2 border-cyan-400 rounded-xl text-center font-mono font-black text-2xl py-2 text-white tracking-[0.3em] focus:outline-none focus:shadow-[0_0_20px_rgba(6,182,212,0.4)]"
                  />

                  <button
                    type="button"
                    onClick={() => setTransferOtpInput(generatedOtp)}
                    className="text-[11px] text-cyan-400 hover:underline cursor-pointer font-mono"
                  >
                    (Autocompletar código de prueba: {generatedOtp})
                  </button>

                  {transferError && (
                    <p className="text-xs text-[#f87171] font-bold bg-[#ef4444]/15 px-3 py-1.5 rounded-lg border border-[#ef4444]/40 mt-1 font-mono">
                      {transferError}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-[#1e293b]">
                  <button
                    type="button"
                    onClick={() => setTransferStep('select')}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-[#94a3b8] hover:text-white bg-[#090d16] border border-[#1e293b] cursor-pointer font-mono"
                  >
                    ← Volver
                  </button>

                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black text-xs transition-all cursor-pointer shadow-[0_0_15px_rgba(16,185,129,0.3)] active:scale-95 flex items-center gap-1.5 font-mono"
                  >
                    <span className="material-symbols-outlined text-[18px]">verified</span>
                    <span>Confirmar Traspaso</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* MODAL 2: OFFICIAL PERFORMANCE & COMMISSION REPORT (Printable / PDF) */}
      {isPrintModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="bg-white text-[#0f172a] rounded-2xl w-full max-w-4xl max-h-[min(94vh,740px)] shadow-2xl flex flex-col overflow-hidden">
            <div className="p-4 bg-[#0f172a] text-white flex justify-between items-center shrink-0 print:hidden">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-cyan-400">print</span>
                <span className="text-sm font-bold font-mono">Vista Previa de Reporte de Rendimiento</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-1.5 shadow cursor-pointer active:scale-95 font-mono"
                >
                  <span className="material-symbols-outlined text-[16px]">print</span>
                  <span>Imprimir / Guardar PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsPrintModalOpen(false)}
                  className="text-[#94a3b8] hover:text-white p-1 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>
            </div>

            <div className="p-6 sm:p-8 flex-1 min-h-0 overflow-y-auto custom-scrollbar bg-white flex flex-col gap-6 font-sans">
              <div className="border-b-2 border-[#0f172a] pb-4 flex justify-between items-start">
                <div>
                  <h1 className="text-2xl font-black tracking-tight text-[#0f172a]">
                    RODRÍGUEZ SALVAGE YARD
                  </h1>
                  <p className="text-xs text-[#475569] font-bold uppercase tracking-widest mt-0.5">
                    RADAR V3 — Reporte de Rendimiento & Desempeño Operativo
                  </p>
                </div>
                <div className="text-right text-xs font-mono">
                  <div className="font-bold text-[#0f172a]">Fecha de Emisión:</div>
                  <div className="text-[#475569]">
                    {new Date().toLocaleDateString('es-ES', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
              </div>

              <div className="bg-[#f8fafc] border border-[#e2e8f0] rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-[#64748b] block font-bold text-[10px] uppercase">Especialista:</span>
                  <strong className="text-sm text-[#0f172a]">{currentOperator.name}</strong>
                </div>
                <div>
                  <span className="text-[#64748b] block font-bold text-[10px] uppercase">Cargo / Rol:</span>
                  <span className="text-[#0f172a]">{currentOperator.role}</span>
                </div>
                <div>
                  <span className="text-[#64748b] block font-bold text-[10px] uppercase">Período Auditado:</span>
                  <span className="text-[#0f172a] font-bold">{periodLabel.title}</span>
                </div>
                <div>
                  <span className="text-[#64748b] block font-bold text-[10px] uppercase">ID Auditoría:</span>
                  <span className="font-mono text-[#0f172a]">RADAR-OP-{currentOperator.id}</span>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div className="border border-[#e2e8f0] p-3 rounded-xl bg-[#f8fafc] text-center">
                  <span className="text-[10px] uppercase font-bold text-[#64748b] block">Facturación Total</span>
                  <strong className="text-base font-mono text-[#0f172a]">
                    ${kpis.salesSum.toFixed(2)}
                  </strong>
                  <span className="text-[10px] text-[#64748b] block mt-0.5">({kpis.salesCount} ventas)</span>
                </div>

                <div className="border border-[#e2e8f0] p-3 rounded-xl bg-[#f8fafc] text-center">
                  <span className="text-[10px] uppercase font-bold text-[#64748b] block">Anticipos Cobrados</span>
                  <strong className="text-base font-mono text-teal-700">
                    ${kpis.downPaymentSum.toFixed(2)}
                  </strong>
                  <span className="text-[10px] text-teal-700 block mt-0.5">En mano / caja</span>
                </div>

                <div className="border border-[#e2e8f0] p-3 rounded-xl bg-[#f8fafc] text-center">
                  <span className="text-[10px] uppercase font-bold text-[#64748b] block">Saldo por Cobrar</span>
                  <strong className="text-base font-mono text-amber-600">
                    ${kpis.balanceDueSum.toFixed(2)}
                  </strong>
                  <span className="text-[10px] text-amber-600 block mt-0.5">Al despachar</span>
                </div>

                <div className="border border-[#e2e8f0] p-3 rounded-xl bg-[#f8fafc] text-center">
                  <span className="text-[10px] uppercase font-bold text-[#64748b] block">Ticket Promedio</span>
                  <strong className="text-base font-mono text-blue-700">
                    ${kpis.averageTicket.toFixed(2)}
                  </strong>
                  <span className="text-[10px] text-blue-700 block mt-0.5">USD / venta</span>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-xs uppercase text-[#0f172a] mb-2 tracking-wider font-mono">
                  Detalle de Órdenes Facturadas ({periodSales.length})
                </h4>
                <table className="w-full text-left text-xs border border-[#e2e8f0] border-collapse">
                  <thead className="bg-[#f1f5f9] text-[#475569] uppercase text-[9px] border-b border-[#e2e8f0]">
                    <tr>
                      <th className="p-2 border-r border-[#e2e8f0]">Código</th>
                      <th className="p-2 border-r border-[#e2e8f0]">Fecha</th>
                      <th className="p-2 border-r border-[#e2e8f0]">Cliente</th>
                      <th className="p-2 border-r border-[#e2e8f0]">Vehículo / Pieza</th>
                      <th className="p-2 border-r border-[#e2e8f0]">Estatus</th>
                      <th className="p-2 text-right">Monto Venta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e2e8f0]">
                    {periodSales.map((o) => {
                      const amount = o.financials?.partPrice || o.financials?.total || 0;
                      return (
                        <tr key={o.id}>
                          <td className="p-2 font-mono font-bold border-r border-[#e2e8f0]">{o.code}</td>
                          <td className="p-2 border-r border-[#e2e8f0] text-[#64748b] font-mono">{o.createdAt}</td>
                          <td className="p-2 border-r border-[#e2e8f0] font-semibold">{o.customer.name}</td>
                          <td className="p-2 border-r border-[#e2e8f0]">
                            {o.vehicle.year} {o.vehicle.make} · {o.mainPart}
                          </td>
                          <td className="p-2 border-r border-[#e2e8f0]">
                            <span className="uppercase text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">
                              {o.status}
                            </span>
                          </td>
                          <td className="p-2 text-right font-mono font-bold text-[#0f172a]">
                            ${amount.toFixed(2)} USD
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-[#f8fafc] font-bold border-t-2 border-[#0f172a]">
                    <tr>
                      <td colSpan={5} className="p-2.5 text-right uppercase text-[10px] font-mono">
                        Total Facturación del Período:
                      </td>
                      <td className="p-2.5 text-right font-mono text-sm text-[#0f172a]">
                        ${kpis.salesSum.toFixed(2)} USD
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="grid grid-cols-2 gap-12 pt-12 mt-6 border-t border-[#e2e8f0]">
                <div className="text-center">
                  <div className="border-t border-[#0f172a] pt-2">
                    <strong className="text-xs block text-[#0f172a]">{currentOperator.name}</strong>
                    <span className="text-[10px] text-[#64748b]">Firma del Asesor / Operador</span>
                  </div>
                </div>

                <div className="text-center">
                  <div className="border-t border-[#0f172a] pt-2">
                    <strong className="text-xs block text-[#0f172a]">Supervisión y Control de Operaciones</strong>
                    <span className="text-[10px] text-[#64748b]">Auditoría y Desempeño Comercial</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
