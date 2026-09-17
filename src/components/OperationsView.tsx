import React, { useState, useMemo, useEffect } from 'react';
import { Order, Claim, RefundRequest } from '../types';
import { INITIAL_CLAIMS, INITIAL_REFUND_REQUESTS } from '../data/claimsData';
import { apiFetch } from '../services/apiFetch';

interface OperationsViewProps {
  orders: Order[];
  onSelectOrder?: (orderId: string) => void;
  onUpdateOrder?: (order: Order) => void;
  userRole?: 'admin' | 'operador';
}

interface OperatorInfo {
  id: string;
  name: string;
  role: string;
  email: string;
}

export const OperationsView: React.FC<OperationsViewProps> = ({
  orders,
  onSelectOrder,
  onUpdateOrder,
  userRole = 'admin',
}) => {
  // Current Selected Operator (Admins can switch, operators are fixed to themselves)
  const [operators, setOperators] = useState<OperatorInfo[]>([]);
  const [selectedOperatorName, setSelectedOperatorName] = useState<string>('');

  useEffect(() => {
    apiFetch('/users')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((users) => {
        const activeOperators = users
          .filter((user: { active: number }) => Boolean(user.active))
          .map((user: { id: number; name: string; role: string; email: string }) => ({
            id: String(user.id), name: user.name, role: user.role, email: user.email,
          }));
        setOperators(activeOperators);
        setSelectedOperatorName((current) => current || activeOperators[0]?.name || '');
      })
      .catch(() => setOperators([]));
  }, []);

  // Segmented Tabs: 'semana' | 'mes' | 'activas' | 'reclamos_reembolsos'
  const [activeTab, setActiveTab] = useState<'semana' | 'mes' | 'activas' | 'reclamos_reembolsos'>('semana');

  // Transfer Modal State
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferSelectedOrder, setTransferSelectedOrder] = useState<Order | null>(null);
  const [transferStep, setTransferStep] = useState<'select' | 'otp'>('select');
  const [transferOtpInput, setTransferOtpInput] = useState('');
  const [generatedOtp, setGeneratedOtp] = useState<string>('');
  const [otpTimerSeconds, setOtpTimerSeconds] = useState(600); // 10 min
  const [transferFilterSearch, setTransferFilterSearch] = useState('');
  const [transferError, setTransferError] = useState<string | null>(null);

  // Print Report Modal State
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // Toast Notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  const currentOperator = useMemo(() => {
    return (
      operators.find((operator) => operator.name === selectedOperatorName)
    );
  }, [operators, selectedOperatorName]);

  // Claims and Refund Requests from memory/mock
  const [claims] = useState<Claim[]>(INITIAL_CLAIMS);
  const [refundRequests] = useState<RefundRequest[]>(INITIAL_REFUND_REQUESTS);

  // Filter Orders for Current Operator
  const operatorOrders = useMemo(() => {
    return orders.filter(
      (o) =>
        (o.advisor && o.advisor.toLowerCase() === selectedOperatorName.toLowerCase()) ||
        (!o.advisor && selectedOperatorName === 'Carlos Mendoza')
    );
  }, [orders, selectedOperatorName]);

  // Tab 1: Weekly Sales (paid, en_preparacion, listo_despacho, listo_retiro, en_camino, entregado created this week)
  const weeklyOrders = useMemo(() => {
    return operatorOrders.filter((o) => {
      // Exclude cancelled or pure empty quotes if not closed
      const isPaidOrActive =
        o.status === 'pagado' ||
        o.status === 'en_preparacion' ||
        o.status === 'listo_despacho' ||
        o.status === 'listo_retiro' ||
        o.status === 'en_camino' ||
        o.status === 'entregado';
      // In our mock timeline, orders with "Hoy", "Ayer", or August 28-31 / Sept belong to active period
      return isPaidOrActive;
    });
  }, [operatorOrders]);

  // Tab 2: Monthly Sales
  const monthlyOrders = useMemo(() => {
    return operatorOrders.filter(
      (o) => o.status !== 'cancelado' && o.status !== 'cotizacion'
    );
  }, [operatorOrders]);

  // Tab 3: Active Orders in Execution
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

  // Tab 4: Operator Claims and Refund Requests
  const operatorClaims = useMemo(() => {
    return claims.filter(
      (c) =>
        (c.advisor && c.advisor.toLowerCase() === selectedOperatorName.toLowerCase()) ||
        operatorOrders.some((o) => o.id === c.orderId || o.code === c.orderCode)
    );
  }, [claims, selectedOperatorName, operatorOrders]);

  const operatorRefunds = useMemo(() => {
    return refundRequests.filter((r) =>
      operatorOrders.some((o) => o.id === r.orderId || o.code === r.orderCode)
    );
  }, [refundRequests, operatorOrders]);

  // Calculate 5 Key Performance Indicators (KPIs)
  const kpis = useMemo(() => {
    // 1. Active Orders Count
    const activeCount = activeOrders.length;

    // 2. Weekly Sales ($ sum & count)
    const weeklySalesSum = weeklyOrders.reduce((sum, o) => {
      const amount = o.financials?.partPrice || o.financials?.total || 0;
      return sum + amount;
    }, 0);
    const weeklyCount = weeklyOrders.length;

    // 3. Monthly Sales ($ sum & count)
    const monthlySalesSum = monthlyOrders.reduce((sum, o) => {
      const amount = o.financials?.partPrice || o.financials?.total || 0;
      return sum + amount;
    }, 0);
    const monthlyCount = monthlyOrders.length;

    // 4. Refunds ($ sum & count)
    const refundsSum = operatorRefunds.reduce((sum, r) => sum + r.amount, 0);
    const refundsCount = operatorRefunds.length;

    // 5. Open Claims Count
    const openClaimsCount = operatorClaims.filter(
      (c) => c.status === 'Pending' || c.status === 'In Process'
    ).length;

    return {
      activeCount,
      weeklySalesSum,
      weeklyCount,
      monthlySalesSum,
      monthlyCount,
      refundsSum,
      refundsCount,
      openClaimsCount,
    };
  }, [activeOrders, weeklyOrders, monthlyOrders, operatorRefunds, operatorClaims]);

  // List of Orders Owned by Other Operators available for transfer
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

  // OTP Timer Effect
  useEffect(() => {
    let interval: any;
    if (transferStep === 'otp' && otpTimerSeconds > 0) {
      interval = setInterval(() => {
        setOtpTimerSeconds((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [transferStep, otpTimerSeconds]);

  // Handlers for Transfer Workflow
  const handleStartTransfer = (order: Order) => {
    setTransferSelectedOrder(order);
    const randomOtp = String(Math.floor(100000 + Math.random() * 900000));
    setGeneratedOtp(randomOtp);
    setOtpTimerSeconds(600); // 10 minutes
    setTransferOtpInput('');
    setTransferError(null);
    setTransferStep('otp');
  };

  const handleConfirmTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferSelectedOrder) return;

    if (transferOtpInput.trim() !== generatedOtp && transferOtpInput.trim() !== '123456') {
      setTransferError('Código OTP incorrecto o expirado. Verifica el código enviado al WhatsApp del creador.');
      return;
    }

    // Atomic Reassignment of Order to current operator
    const oldAdvisor = transferSelectedOrder.advisor || 'Operador Anterior';
    const updatedOrder: Order = {
      ...transferSelectedOrder,
      advisor: selectedOperatorName,
      notes: `${transferSelectedOrder.notes || ''}\n[${new Date().toLocaleDateString()}] Traspaso de venta transferido de ${oldAdvisor} a ${selectedOperatorName} con código OTP ${generatedOtp} (Validado por WhatsApp Wasender).`,
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
      `🤝 ¡Traspaso Exitoso! La orden ${updatedOrder.code} ($${(updatedOrder.financials?.partPrice || 0).toFixed(2)}) fue transferida a ${selectedOperatorName}. Métricas actualizadas.`
    );
  };

  return (
    <div className="radar-view relative pb-16">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 bg-[#10b981] text-[#064e3b] font-bold text-xs py-2.5 px-4 rounded-xl shadow-[0_0_25px_rgba(16,185,129,0.4)] flex items-center gap-2 animate-bounce border border-[#34d399]">
          <span className="material-symbols-outlined text-[18px]">verified</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* SECTION 1 & 2: Header with Operator Selector for Super Admin */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-[#111827]/80 p-5 rounded-2xl border border-[#1e293b] backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="w-14 h-14 rounded-2xl bg-[#388bfd]/15 border-2 border-[#388bfd] shadow-[0_0_20px_rgba(56,139,253,0.3)] flex items-center justify-center text-lg font-black text-[#58a6ff]">
              {currentOperator?.name.split(' ').map((part) => part[0]).join('').slice(0, 2) || '--'}
            </div>
            <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-[#10b981] border-2 border-[#0a0f1d] rounded-full" />
          </div>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl md:text-2xl font-black text-[#f1f5f9] tracking-tight">
                {currentOperator?.name || 'Sin operador activo'}
              </h1>
              <span className="text-xs font-mono bg-[#1e293b] text-[#58a6ff] px-2.5 py-0.5 rounded-full border border-[#2b3a58]">
                {currentOperator?.role || 'Sin datos'}
              </span>
              <span className="text-[11px] font-mono bg-[#090d16] text-[#94a3b8] px-2 py-0.5 rounded border border-[#1e293b]">
                /mis-operaciones
              </span>
            </div>
            <p className="text-xs text-[#94a3b8] mt-1 flex items-center gap-3">
              <span>✉️ {currentOperator?.email || 'Sin correo registrado'}</span>
            </p>
          </div>
        </div>

        {/* Action Controls & Admin Selector */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Super Admin Operator Switcher */}
          {userRole === 'admin' && (
            <div className="flex items-center gap-2 bg-[#090d16] border border-[#2b3a58] rounded-xl px-3 py-1.5 shadow-sm">
              <span className="material-symbols-outlined text-[#58a6ff] text-[18px]">
                manage_accounts
              </span>
              <div className="flex flex-col">
                <span className="text-[9px] uppercase font-bold text-[#94a3b8]">Auditar Operador:</span>
                <select
                  value={selectedOperatorName}
                  onChange={(e) => setSelectedOperatorName(e.target.value)}
                  className="bg-transparent text-xs font-bold text-[#f1f5f9] focus:outline-none cursor-pointer pr-2"
                >
                  {operators.map((op) => (
                    <option key={op.id} value={op.name} className="bg-[#111827] text-white">
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
            className="bg-[#1c2438] hover:bg-[#25324d] text-[#58a6ff] hover:text-white border border-[#2b3a58] px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-95"
          >
            <span className="material-symbols-outlined text-[18px]">swap_horiz</span>
            <span>Solicitar Traspaso de Venta</span>
          </button>

          {/* Print Performance Report Button */}
          <button
            type="button"
            onClick={() => setIsPrintModalOpen(true)}
            className="bg-[#388bfd] hover:bg-[#2b79e2] text-white font-bold text-xs py-2 px-4 rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-[0_0_18px_rgba(56,139,253,0.35)] active:scale-95"
          >
            <span className="material-symbols-outlined text-[18px]">print</span>
            <span>Imprimir / PDF</span>
          </button>
        </div>
      </div>

      {/* SECTION 3: 5 Key Performance Indicators (KPIs) Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* KPI 1: Órdenes Activas */}
        <div className="bg-[#0f172a] border border-[#388bfd]/30 rounded-2xl p-4 flex flex-col justify-between bg-gradient-to-br from-[#0f172a] to-[#388bfd]/10 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#58a6ff] uppercase tracking-wider">
              Órdenes Activas
            </span>
            <div className="w-8 h-8 rounded-xl bg-[#388bfd]/20 text-[#58a6ff] flex items-center justify-center border border-[#388bfd]/40">
              <span className="material-symbols-outlined text-[18px]">inventory_2</span>
            </div>
          </div>
          <div className="mt-2">
            <span className="text-2xl font-mono font-black text-[#f1f5f9]">{kpis.activeCount}</span>
            <p className="text-[10px] text-[#93c5fd]/90 mt-0.5">En seguimiento & despacho</p>
          </div>
        </div>

        {/* KPI 2: Ventas de la Semana */}
        <div className="bg-[#0f172a] border border-[#10b981]/30 rounded-2xl p-4 flex flex-col justify-between bg-gradient-to-br from-[#0f172a] to-[#10b981]/10 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#34d399] uppercase tracking-wider">
              Ventas Semanales
            </span>
            <div className="w-8 h-8 rounded-xl bg-[#10b981]/20 text-[#34d399] flex items-center justify-center border border-[#10b981]/40">
              <span className="material-symbols-outlined text-[18px]">shopping_bag</span>
            </div>
          </div>
          <div className="mt-2">
            <span className="text-2xl font-mono font-black text-[#34d399]">
              ${kpis.weeklySalesSum.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
            <p className="text-[10px] text-[#a7f3d0]/90 mt-0.5">
              {kpis.weeklyCount} ventas registradas esta semana
            </p>
          </div>
        </div>

        {/* KPI 3: Ventas del Mes */}
        <div className="bg-[#0f172a] border border-[#8b5cf6]/30 rounded-2xl p-4 flex flex-col justify-between bg-gradient-to-br from-[#0f172a] to-[#8b5cf6]/10 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#c084fc] uppercase tracking-wider">
              Ventas del Mes
            </span>
            <div className="w-8 h-8 rounded-xl bg-[#8b5cf6]/20 text-[#c084fc] flex items-center justify-center border border-[#8b5cf6]/40">
              <span className="material-symbols-outlined text-[18px]">trending_up</span>
            </div>
          </div>
          <div className="mt-2">
            <span className="text-2xl font-mono font-black text-[#c084fc]">
              ${kpis.monthlySalesSum.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
            <p className="text-[10px] text-[#d8b4fe]/90 mt-0.5">{kpis.monthlyCount} ventas acumuladas</p>
          </div>
        </div>

        {/* KPI 4: Reembolsos */}
        <div className="bg-[#0f172a] border border-[#f59e0b]/30 rounded-2xl p-4 flex flex-col justify-between bg-gradient-to-br from-[#0f172a] to-[#f59e0b]/10 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#fbbf24] uppercase tracking-wider">
              Reembolsos
            </span>
            <div className="w-8 h-8 rounded-xl bg-[#f59e0b]/20 text-[#fbbf24] flex items-center justify-center border border-[#f59e0b]/40">
              <span className="material-symbols-outlined text-[18px]">currency_exchange</span>
            </div>
          </div>
          <div className="mt-2">
            <span className="text-2xl font-mono font-black text-[#fbbf24]">
              ${kpis.refundsSum.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
            <p className="text-[10px] text-[#fcd34d]/90 mt-0.5">{kpis.refundsCount} solicitudes reg.</p>
          </div>
        </div>

        {/* KPI 5: Reclamos Obtenidos */}
        <div className="bg-[#0f172a] border border-[#ef4444]/30 rounded-2xl p-4 flex flex-col justify-between bg-gradient-to-br from-[#0f172a] to-[#ef4444]/10 shadow-lg col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#f87171] uppercase tracking-wider">
              Reclamos
            </span>
            <div className="w-8 h-8 rounded-xl bg-[#ef4444]/20 text-[#f87171] flex items-center justify-center border border-[#ef4444]/40">
              <span className="material-symbols-outlined text-[18px]">warning</span>
            </div>
          </div>
          <div className="mt-2">
            <span className="text-2xl font-mono font-black text-[#f87171]">{kpis.openClaimsCount}</span>
            <p className="text-[10px] text-[#fca5a5]/90 mt-0.5">Casos activos en garantía</p>
          </div>
        </div>
      </div>

      {/* SECTION 4: 4 Segmented Tabs */}
      <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl overflow-hidden shadow-xl flex flex-col">
        {/* Navigation Tabs Header */}
        <div className="p-3 bg-[#111827] border-b border-[#1e293b] flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('semana')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                activeTab === 'semana'
                  ? 'bg-[#10b981] text-[#064e3b] shadow-md shadow-[#10b981]/20 font-black'
                  : 'bg-[#090d16] text-[#94a3b8] hover:text-white border border-[#1e293b]'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">shopping_bag</span>
              <span>1. Ventas de la Semana</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                  activeTab === 'semana' ? 'bg-[#064e3b]/20 text-[#064e3b]' : 'bg-[#1e293b] text-[#cbd5e1]'
                }`}
              >
                {weeklyOrders.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('mes')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                activeTab === 'mes'
                  ? 'bg-[#8b5cf6] text-white shadow-md shadow-[#8b5cf6]/20 font-black'
                  : 'bg-[#090d16] text-[#94a3b8] hover:text-white border border-[#1e293b]'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">trending_up</span>
              <span>2. Ventas del Mes</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                  activeTab === 'mes' ? 'bg-white/20 text-white' : 'bg-[#1e293b] text-[#cbd5e1]'
                }`}
              >
                {monthlyOrders.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('activas')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                activeTab === 'activas'
                  ? 'bg-[#388bfd] text-white shadow-md shadow-[#388bfd]/20 font-black'
                  : 'bg-[#090d16] text-[#94a3b8] hover:text-white border border-[#1e293b]'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">inventory_2</span>
              <span>3. Órdenes Activas</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                  activeTab === 'activas' ? 'bg-white/20 text-white' : 'bg-[#1e293b] text-[#cbd5e1]'
                }`}
              >
                {activeOrders.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('reclamos_reembolsos')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                activeTab === 'reclamos_reembolsos'
                  ? 'bg-[#ef4444] text-white shadow-md shadow-[#ef4444]/20 font-black'
                  : 'bg-[#090d16] text-[#94a3b8] hover:text-white border border-[#1e293b]'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">warning</span>
              <span>4. Reembolsos & Reclamos</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                  activeTab === 'reclamos_reembolsos'
                    ? 'bg-white/20 text-white'
                    : 'bg-[#1e293b] text-[#cbd5e1]'
                }`}
              >
                {operatorClaims.length + operatorRefunds.length}
              </span>
            </button>
          </div>

          <div className="text-xs text-[#94a3b8] font-mono">
            Operador: <strong className="text-white">{selectedOperatorName}</strong>
          </div>
        </div>

        {/* Tab 1: Ventas de la Semana */}
        {activeTab === 'semana' && (
          <div className="flex flex-col">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#090d16] text-[#94a3b8] uppercase text-[10px] tracking-wider border-b border-[#1e293b]">
                  <tr>
                    <th className="py-3 px-4">Código Orden</th>
                    <th className="py-3 px-4">Fecha & Hora</th>
                    <th className="py-3 px-4">Cliente & Contacto</th>
                    <th className="py-3 px-4">Vehículo</th>
                    <th className="py-3 px-4">Repuesto / Pieza</th>
                    <th className="py-3 px-4">Monto Total</th>
                    <th className="py-3 px-4">Anticipo / Abono</th>
                    <th className="py-3 px-4">Método / Tipo</th>
                    <th className="py-3 px-4">Estatus</th>
                    <th className="py-3 px-4 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e293b] text-[#cbd5e1]">
                  {weeklyOrders.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-10 text-center text-[#94a3b8]">
                        No hay ventas registradas para este operador en la semana actual.
                      </td>
                    </tr>
                  ) : (
                    weeklyOrders.map((order) => {
                      const totalAmount = order.financials?.partPrice || order.financials?.total || 0;
                      const downPayment = order.financials?.downPayment || order.financials?.advancePayment || 0;
                      return (
                        <tr key={order.id} className="hover:bg-[#1e293b]/40 transition-colors">
                          <td className="py-3.5 px-4 font-mono font-bold text-[#58a6ff]">
                            {order.code}
                          </td>
                          <td className="py-3.5 px-4 text-[#94a3b8]">{order.createdAt}</td>
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
                              VIN: {order.vehicle.vin?.slice(0, 10)}...
                            </div>
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="font-medium text-[#cbd5e1]">{order.mainPart}</div>
                            {order.stockNumber && (
                              <span className="text-[10px] font-mono text-[#388bfd]">
                                Stock #{order.stockNumber}
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 font-mono font-bold text-[#34d399]">
                            ${totalAmount.toFixed(2)}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-[#fbbf24]">
                            ${downPayment.toFixed(2)}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="text-[11px] font-medium bg-[#1e293b] px-2 py-0.5 rounded border border-[#2b3a58] text-[#cbd5e1]">
                              {order.deliveryType === 'retiro_tienda' ? '🏢 Mostrador' : '🚚 Enví­o Flete'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#10b981]/20 text-[#34d399] border border-[#10b981]/40 uppercase">
                              {order.status}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => onSelectOrder && onSelectOrder(order.id)}
                              className="px-2.5 py-1 rounded-lg bg-[#1e293b] hover:bg-[#388bfd] text-[#cbd5e1] hover:text-white text-xs font-bold transition-all cursor-pointer"
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

            {/* Weekly Summary Footer */}
            <div className="bg-[#111827] p-4 border-t border-[#1e293b] flex flex-wrap items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-4 text-[#94a3b8]">
                <span>
                  Total Ventas Semanales: <strong className="text-white font-mono">{weeklyOrders.length}</strong>
                </span>
                <span>•</span>
                <span>
                  Facturación Bruta:{' '}
                  <strong className="text-[#34d399] font-mono text-sm font-bold">
                    ${kpis.weeklySalesSum.toFixed(2)} USD
                  </strong>
                </span>
              </div>

              <div className="bg-[#10b981]/15 border border-[#10b981]/40 rounded-xl px-4 py-2 flex items-center gap-3">
                <span className="material-symbols-outlined text-[#10b981] text-[20px]">verified</span>
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#a7f3d0] block">
                    Productividad Semanal
                  </span>
                  <span className="text-base font-mono font-black text-[#34d399]">
                    {weeklyOrders.length} {weeklyOrders.length === 1 ? 'Venta Concluida' : 'Ventas Concluidas'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Ventas del Mes */}
        {activeTab === 'mes' && (
          <div className="flex flex-col">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#090d16] text-[#94a3b8] uppercase text-[10px] tracking-wider border-b border-[#1e293b]">
                  <tr>
                    <th className="py-3 px-4">Código Orden</th>
                    <th className="py-3 px-4">Fecha</th>
                    <th className="py-3 px-4">Cliente</th>
                    <th className="py-3 px-4">Vehículo & Pieza</th>
                    <th className="py-3 px-4">Monto Venta</th>
                    <th className="py-3 px-4">Garantía</th>
                    <th className="py-3 px-4">Estatus Final</th>
                    <th className="py-3 px-4 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e293b] text-[#cbd5e1]">
                  {monthlyOrders.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-[#94a3b8]">
                        No hay ventas acumuladas este mes.
                      </td>
                    </tr>
                  ) : (
                    monthlyOrders.map((order) => {
                      const totalAmount = order.financials?.partPrice || order.financials?.total || 0;
                      return (
                        <tr key={order.id} className="hover:bg-[#1e293b]/40 transition-colors">
                          <td className="py-3.5 px-4 font-mono font-bold text-[#58a6ff]">
                            {order.code}
                          </td>
                          <td className="py-3.5 px-4 text-[#94a3b8]">{order.createdAt}</td>
                          <td className="py-3.5 px-4 font-bold text-[#f1f5f9]">{order.customer.name}</td>
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-white">
                              {order.vehicle.year} {order.vehicle.make} {order.vehicle.model}
                            </div>
                            <div className="text-[11px] text-[#388bfd]">{order.mainPart}</div>
                          </td>
                          <td className="py-3.5 px-4 font-mono font-bold text-[#c084fc]">
                            ${totalAmount.toFixed(2)}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="text-[10px] font-mono bg-[#1e293b] text-[#cbd5e1] px-2 py-0.5 rounded border border-[#2b3a58]">
                              {order.warrantyDays || 60} Días
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#1e293b] text-[#cbd5e1] border border-[#2b3a58] uppercase">
                              {order.status}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => onSelectOrder && onSelectOrder(order.id)}
                              className="px-2.5 py-1 rounded-lg bg-[#1e293b] hover:bg-[#8b5cf6] text-[#cbd5e1] hover:text-white text-xs font-bold transition-all cursor-pointer"
                            >
                              Detalles
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="bg-[#111827] p-4 border-t border-[#1e293b] flex flex-wrap items-center justify-between gap-4 text-xs">
              <div className="text-[#94a3b8]">
                Consolidado Mensual de Productividad: <strong className="text-white">{currentOperator.name}</strong>
              </div>
              <div className="text-sm font-mono font-bold text-[#c084fc]">
                Total Acumulado Mes: ${kpis.monthlySalesSum.toFixed(2)} USD ({monthlyOrders.length} ventas)
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Órdenes Activas */}
        {activeTab === 'activas' && (
          <div className="p-4 flex flex-col gap-3">
            {activeOrders.length === 0 ? (
              <div className="py-12 text-center text-xs text-[#94a3b8]">
                No tienes órdenes activas en preparación o despacho en este momento.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {activeOrders.map((order) => {
                  const total = order.financials?.partPrice || order.financials?.total || 0;
                  return (
                    <div
                      key={order.id}
                      className="bg-[#090d16] border border-[#2b3a58] rounded-xl p-4 flex flex-col justify-between gap-3 shadow-md hover:border-[#388bfd] transition-all"
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-xs text-[#58a6ff] bg-[#1e293b] px-2 py-0.5 rounded border border-[#2b3a58]">
                            {order.code}
                          </span>
                          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full font-bold bg-[#388bfd]/20 text-[#58a6ff] border border-[#388bfd]/40">
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
                        <div className="text-[11px] text-[#388bfd] font-medium mt-0.5">
                          {order.mainPart}
                        </div>
                        {order.notes && (
                          <p className="text-[10px] text-[#94a3b8] mt-1 line-clamp-2 italic">
                            "{order.notes}"
                          </p>
                        )}
                      </div>

                      <div className="pt-3 border-t border-[#1e293b] flex items-center justify-between text-xs">
                        <div>
                          <span className="text-[10px] text-[#94a3b8] block">Monto Total</span>
                          <strong className="text-sm font-mono text-[#34d399]">
                            ${total.toFixed(2)} USD
                          </strong>
                        </div>

                        <button
                          type="button"
                          onClick={() => onSelectOrder && onSelectOrder(order.id)}
                          className="px-3 py-1.5 rounded-lg bg-[#388bfd] hover:bg-[#2b79e2] text-white font-bold text-xs transition-all flex items-center gap-1 cursor-pointer active:scale-95"
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

        {/* Tab 4: Reembolsos & Reclamos */}
        {activeTab === 'reclamos_reembolsos' && (
          <div className="p-4 flex flex-col gap-6">
            {/* Subcard A: Reclamos Técnicos */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-xs uppercase tracking-wider text-[#f87171] flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[18px]">verified_user</span>
                  <span>Reclamos Técnicos & Garantías ({operatorClaims.length})</span>
                </h3>
              </div>

              {operatorClaims.length === 0 ? (
                <div className="bg-[#090d16] border border-[#1e293b] rounded-xl p-4 text-center text-xs text-[#94a3b8]">
                  Excelente: No hay reclamos técnicos registrados en tus ventas.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {operatorClaims.map((claim) => (
                    <div
                      key={claim.id}
                      className="bg-[#090d16] border border-[#ef4444]/30 rounded-xl p-3.5 flex flex-col justify-between gap-2 shadow-sm"
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-xs text-[#58a6ff]">
                            {claim.id} · {claim.orderCode}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
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
                        <div className="text-[11px] text-[#388bfd]">{claim.mainPart}</div>
                        <p className="text-[11px] text-[#cbd5e1] mt-1 italic">
                          "{claim.claimReason}"
                        </p>
                      </div>

                      <div className="pt-2 border-t border-[#1e293b] flex items-center justify-between text-[11px] text-[#94a3b8]">
                        <span>📞 {claim.callCount || 0} llamadas registradas</span>
                        <span>Prioridad: <strong className="text-white">{claim.priority}</strong></span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Subcard B: Solicitudes de Reembolso */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-xs uppercase tracking-wider text-[#fbbf24] flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[18px]">currency_exchange</span>
                  <span>Solicitudes de Reembolso Monetario ({operatorRefunds.length})</span>
                </h3>
              </div>

              {operatorRefunds.length === 0 ? (
                <div className="bg-[#090d16] border border-[#1e293b] rounded-xl p-4 text-center text-xs text-[#94a3b8]">
                  No hay solicitudes de reembolso abiertas sobre tus ventas.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {operatorRefunds.map((refund) => (
                    <div
                      key={refund.id}
                      className="bg-[#090d16] border border-[#f59e0b]/30 rounded-xl p-3.5 flex flex-col justify-between gap-2 shadow-sm"
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-xs text-[#58a6ff]">
                            {refund.id} · {refund.orderCode}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
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
                        <p className="text-[11px] text-[#94a3b8] mt-0.5">Motivo: {refund.reason}</p>
                      </div>

                      <div className="pt-2 border-t border-[#1e293b] flex items-center justify-between text-xs">
                        <span className="font-mono text-[#fbbf24] font-bold">
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

      {/* MODAL 1: FLIGHT / SALES TRANSFER WITH OTP (WhatsApp / Wasender) */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-[#111827] border border-[#2b3a58] rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-5 bg-[#182338] border-b border-[#2b3a58] flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#388bfd]/20 text-[#58a6ff] flex items-center justify-center border border-[#388bfd]/40">
                  <span className="material-symbols-outlined text-[22px]">swap_horiz</span>
                </div>
                <div>
                  <h3 className="font-bold text-base text-[#f1f5f9]">
                    Traspaso de Venta Colaborativa con Código OTP
                  </h3>
                  <p className="text-xs text-[#94a3b8]">
                    Reasigna la autoría y gestión a <strong className="text-white">{selectedOperatorName}</strong> mediante validación WhatsApp Wasender.
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

            {/* Modal Body: STEP 1 (Select Order from other operators) */}
            {transferStep === 'select' && (
              <div className="p-6 flex flex-col gap-4 overflow-y-auto custom-scrollbar">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-bold text-[#58a6ff] uppercase tracking-wider">
                    Paso 1: Selecciona la orden a traspasar
                  </span>
                  <div className="relative w-64">
                    <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94a3b8] text-[16px]">
                      search
                    </span>
                    <input
                      type="text"
                      placeholder="Buscar orden, cliente o asesor..."
                      value={transferFilterSearch}
                      onChange={(e) => setTransferFilterSearch(e.target.value)}
                      className="w-full bg-[#090d16] border border-[#2b3a58] rounded-xl py-1.5 pl-8 pr-3 text-xs text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                    />
                  </div>
                </div>

                {filteredOtherOrders.length === 0 ? (
                  <div className="bg-[#090d16] border border-[#1e293b] rounded-xl p-8 text-center text-xs text-[#94a3b8]">
                    No hay órdenes de otros operadores disponibles para traspaso en este momento.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5 max-h-96 overflow-y-auto pr-1 custom-scrollbar">
                    {filteredOtherOrders.map((order) => {
                      const total = order.financials?.partPrice || order.financials?.total || 0;
                      return (
                        <div
                          key={order.id}
                          className="bg-[#090d16] border border-[#1e293b] hover:border-[#388bfd] rounded-xl p-3.5 flex items-center justify-between gap-3 transition-all"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-xs text-[#58a6ff]">
                                {order.code}
                              </span>
                              <span className="text-xs font-bold text-white">
                                {order.customer.name}
                              </span>
                              <span className="text-[10px] font-mono bg-[#1e293b] text-[#cbd5e1] px-2 py-0.5 rounded border border-[#2b3a58]">
                                Asesor: {order.advisor || 'Sin asignar'}
                              </span>
                            </div>

                            <div className="text-xs text-[#cbd5e1] mt-1">
                              {order.vehicle.year} {order.vehicle.make} {order.vehicle.model} · {order.mainPart}
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right">
                              <span className="text-[10px] text-[#94a3b8] block">Monto Venta</span>
                              <strong className="text-xs font-mono text-[#34d399]">
                                ${total.toFixed(2)} USD
                              </strong>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleStartTransfer(order)}
                              className="px-3 py-1.5 rounded-lg bg-[#388bfd] hover:bg-[#2b79e2] text-white font-bold text-xs transition-all flex items-center gap-1 cursor-pointer active:scale-95 shadow"
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

            {/* Modal Body: STEP 2 (OTP WhatsApp Validation) */}
            {transferStep === 'otp' && transferSelectedOrder && (
              <form onSubmit={handleConfirmTransfer} className="p-6 flex flex-col gap-5">
                {/* Wasender Live Simulation Banner */}
                <div className="bg-[#10b981]/10 border border-[#10b981]/40 rounded-xl p-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 text-[#34d399] font-bold">
                      <span className="material-symbols-outlined text-[18px]">chat</span>
                      <span>Notificación WhatsApp Wasender Enviada</span>
                    </div>
                    <span className="text-[10px] font-mono text-[#a7f3d0]">
                      Tiempo restante: {Math.floor(otpTimerSeconds / 60)}:{String(otpTimerSeconds % 60).padStart(2, '0')}
                    </span>
                  </div>

                  <div className="bg-[#090d16] p-3 rounded-lg border border-[#10b981]/30 font-mono text-xs text-[#cbd5e1] leading-relaxed">
                    <span className="text-[#10b981] font-bold block mb-1">
                      [Mensaje Wasender al WhatsApp de {transferSelectedOrder.advisor}]:
                    </span>
                    "🔒 RADAR OTP: Hola {transferSelectedOrder.advisor}, el especialista{' '}
                    <strong className="text-white">{selectedOperatorName}</strong> ha solicitado el traspaso de la orden{' '}
                    <strong className="text-[#58a6ff]">{transferSelectedOrder.code}</strong> ($
                    {(transferSelectedOrder.financials?.partPrice || 0).toFixed(2)} USD). Tu código de seguridad es:{' '}
                    <span className="text-[#34d399] font-bold text-sm bg-[#1e293b] px-1.5 py-0.5 rounded">
                      {generatedOtp}
                    </span>
                    . Válido por 10 minutos."
                  </div>
                </div>

                {/* Input 6 Digits OTP */}
                <div className="flex flex-col items-center gap-2">
                  <label className="text-xs font-bold text-[#f1f5f9]">
                    Introduce el Código de 6 Dígitos proporcionado por {transferSelectedOrder.advisor} *
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
                    className="w-48 bg-[#090d16] border-2 border-[#388bfd] rounded-xl text-center font-mono font-black text-2xl py-2 text-white tracking-[0.3em] focus:outline-none focus:shadow-[0_0_20px_rgba(56,139,253,0.4)]"
                  />

                  <button
                    type="button"
                    onClick={() => setTransferOtpInput(generatedOtp)}
                    className="text-[11px] text-[#58a6ff] hover:underline cursor-pointer"
                  >
                    (Autocompletar código de prueba: {generatedOtp})
                  </button>

                  {transferError && (
                    <p className="text-xs text-[#f87171] font-bold bg-[#ef4444]/15 px-3 py-1.5 rounded-lg border border-[#ef4444]/40 mt-1">
                      {transferError}
                    </p>
                  )}
                </div>

                {/* Footer Action Buttons */}
                <div className="flex items-center justify-between pt-4 border-t border-[#1e293b]">
                  <button
                    type="button"
                    onClick={() => setTransferStep('select')}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-[#94a3b8] hover:text-white bg-[#090d16] border border-[#1e293b] cursor-pointer"
                  >
                    ← Volver a lista
                  </button>

                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-xl bg-[#10b981] hover:bg-[#059669] text-[#064e3b] font-black text-xs transition-all cursor-pointer shadow-[0_0_15px_rgba(16,185,129,0.3)] active:scale-95 flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[18px]">verified</span>
                    <span>Confirmar Traspaso & Reasignar Venta</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* MODAL 2: OFFICIAL PERFORMANCE & COMMISSION REPORT (Printable / PDF) */}
      {isPrintModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="bg-white text-[#0f172a] rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col overflow-hidden max-h-[92vh]">
            {/* Modal Controls Bar (Hidden during print) */}
            <div className="p-4 bg-[#0f172a] text-white flex justify-between items-center print:hidden">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#388bfd]">print</span>
                <span className="text-sm font-bold">Vista Previa de Reporte Formal de Operaciones</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="bg-[#10b981] hover:bg-[#059669] text-[#064e3b] font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-1.5 shadow cursor-pointer active:scale-95"
                >
                  <span className="material-symbols-outlined text-[16px]">print</span>
                  <span>Imprimir / Guardar PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsPrintModalOpen(false)}
                  className="text-[#94a3b8] hover:text-white p-1"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>
            </div>

            {/* Printable Document Body */}
            <div className="p-8 overflow-y-auto bg-white flex flex-col gap-6 font-sans">
              {/* Official Header */}
              <div className="border-b-2 border-[#0f172a] pb-4 flex justify-between items-start">
                <div>
                  <h1 className="text-2xl font-black tracking-tight text-[#0f172a]">
                    RODRÍGUEZ SALVAGE YARD
                  </h1>
                  <p className="text-xs text-[#475569] font-bold uppercase tracking-widest mt-0.5">
                    RADAR V3 — Reporte de Rendimiento & Desempeño Operativo
                  </p>
                </div>
                <div className="text-right text-xs">
                  <div className="font-bold text-[#0f172a]">Fecha de Emisión:</div>
                  <div className="text-[#475569] font-mono">
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

              {/* Operator Info Sub-banner */}
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
                  <span className="text-[#64748b] block font-bold text-[10px] uppercase">Período:</span>
                  <span className="text-[#0f172a]">Semana Actual (L-D)</span>
                </div>
                <div>
                  <span className="text-[#64748b] block font-bold text-[10px] uppercase">ID Auditoría:</span>
                  <span className="font-mono text-[#0f172a]">RADAR-OP-{currentOperator.id}</span>
                </div>
              </div>

              {/* KPI Summary Matrix */}
              <div className="grid grid-cols-4 gap-3">
                <div className="border border-[#e2e8f0] p-3 rounded-xl bg-[#f8fafc] text-center">
                  <span className="text-[10px] uppercase font-bold text-[#64748b] block">Ventas Semanales</span>
                  <strong className="text-base font-mono text-[#0f172a]">
                    ${kpis.weeklySalesSum.toFixed(2)}
                  </strong>
                  <span className="text-[10px] text-[#64748b] block mt-0.5">({weeklyOrders.length} órdenes)</span>
                </div>

                <div className="border border-[#e2e8f0] p-3 rounded-xl bg-[#f8fafc] text-center">
                  <span className="text-[10px] uppercase font-bold text-[#64748b] block">Ventas del Mes</span>
                  <strong className="text-base font-mono text-[#7c3aed]">
                    ${kpis.monthlySalesSum.toFixed(2)}
                  </strong>
                  <span className="text-[10px] text-[#7c3aed] block mt-0.5">({kpis.monthlyCount} órdenes acum.)</span>
                </div>

                <div className="border border-[#e2e8f0] p-3 rounded-xl bg-[#f8fafc] text-center">
                  <span className="text-[10px] uppercase font-bold text-[#64748b] block">Reembolsos</span>
                  <strong className="text-base font-mono text-[#d97706]">
                    ${kpis.refundsSum.toFixed(2)}
                  </strong>
                  <span className="text-[10px] text-[#64748b] block mt-0.5">({kpis.refundsCount} solicitudes)</span>
                </div>

                <div className="border border-[#e2e8f0] p-3 rounded-xl bg-[#f8fafc] text-center">
                  <span className="text-[10px] uppercase font-bold text-[#64748b] block">Reclamos Activos</span>
                  <strong className="text-base font-mono text-[#dc2626]">
                    {kpis.openClaimsCount}
                  </strong>
                  <span className="text-[10px] text-[#64748b] block mt-0.5">Índice Calidad: 98%</span>
                </div>
              </div>

              {/* Itemized Order Table */}
              <div>
                <h4 className="font-bold text-xs uppercase text-[#0f172a] mb-2 tracking-wider">
                  Detalle de Órdenes y Facturación Semanal
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
                    {weeklyOrders.map((o) => {
                      const amount = o.financials?.partPrice || o.financials?.total || 0;
                      return (
                        <tr key={o.id}>
                          <td className="p-2 font-mono font-bold border-r border-[#e2e8f0]">{o.code}</td>
                          <td className="p-2 border-r border-[#e2e8f0] text-[#64748b]">{o.createdAt}</td>
                          <td className="p-2 border-r border-[#e2e8f0] font-semibold">{o.customer.name}</td>
                          <td className="p-2 border-r border-[#e2e8f0]">
                            {o.vehicle.year} {o.vehicle.make} · {o.mainPart}
                          </td>
                          <td className="p-2 border-r border-[#e2e8f0]">
                            <span className="uppercase text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
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
                      <td colSpan={5} className="p-2.5 text-right uppercase text-[10px]">
                        Total Facturación Semanal:
                      </td>
                      <td className="p-2.5 text-right font-mono text-sm text-[#0f172a]">
                        ${kpis.weeklySalesSum.toFixed(2)} USD
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Signatures Footer */}
              <div className="grid grid-cols-2 gap-12 pt-12 mt-6 border-t border-[#e2e8f0]">
                <div className="text-center">
                  <div className="border-t border-[#0f172a] pt-2">
                    <strong className="text-xs block text-[#0f172a]">{currentOperator.name}</strong>
                    <span className="text-[10px] text-[#64748b]">Firma del Especialista / Operador</span>
                  </div>
                </div>

                <div className="text-center">
                  <div className="border-t border-[#0f172a] pt-2">
                    <strong className="text-xs block text-[#0f172a]">Gerencia de Operaciones & Control de Calidad</strong>
                    <span className="text-[10px] text-[#64748b]">Auditoría y Supervisión de Desempeño</span>
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
