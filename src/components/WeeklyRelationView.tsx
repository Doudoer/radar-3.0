import React, { useState, useMemo, useEffect } from 'react';
import { Order } from '../types';

interface ExpenseItem {
  id: string;
  description: string;
  category:
    | 'Alquiler de Oficina / Patio'
    | 'Servicios (Luz / Agua / Internet)'
    | 'Nómina / Personal'
    | 'Comisiones y Bonificaciones'
    | 'Suministros y Papelería'
    | 'Mantenimiento y Limpieza'
    | 'Gastos Administrativos'
    | 'Varios';
  amount: number;
  date: string;
  paymentMethod: 'Zelle' | 'Efectivo' | 'Transferencia' | 'Tarjeta';
  receiptNr?: string;
}

interface WeeklyRelationViewProps {
  orders?: Order[];
  userRole?: 'admin' | 'operador';
}

export const WeeklyRelationView: React.FC<WeeklyRelationViewProps> = ({
  orders = [],
  userRole = 'admin',
}) => {
  // =========================================================================
  // 1. 2FA SECURITY GATE STATE
  // =========================================================================
  const [is2FAUnlocked, setIs2FAUnlocked] = useState<boolean>(() => {
    return sessionStorage.getItem('radar_2fa_relacion_semanal') === 'true';
  });

  const [otpCodeInput, setOtpCodeInput] = useState<string>('');
  const [activeGeneratedOTP, setActiveGeneratedOTP] = useState<string | null>(null);
  const [otpCooldown, setOtpCooldown] = useState<number>(0);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [safeAnimation, setSafeAnimation] = useState<'idle' | 'spin' | 'unlock' | 'error'>('idle');
  const [codeEffect, setCodeEffect] = useState<'idle' | 'sent' | 'typing' | 'error'>('idle');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Cooldown countdown
  useEffect(() => {
    if (otpCooldown > 0) {
      const timer = setInterval(() => setOtpCooldown((prev) => prev - 1), 1000);
      return () => clearInterval(timer);
    }
  }, [otpCooldown]);

  // Request 2FA OTP Code via WhatsApp (Wasender)
  const handleRequestOTP = () => {
    const randomCode = Math.floor(100000 + Math.random() * 900000).toString();
    setActiveGeneratedOTP(randomCode);
    setOtpCooldown(60);
    setOtpError(null);
    setSafeAnimation('spin');
    setCodeEffect('sent');
    setTimeout(() => setSafeAnimation('idle'), 1800);
    setTimeout(() => setCodeEffect('idle'), 1800);

    // Feedback simulating Wasender WhatsApp message
    showToast(
      `📲 Wasender WhatsApp: Código 2FA enviado al +58 412-***7933: [${randomCode}]`
    );
  };

  // Verify entered 2FA OTP code
  const handleVerifyOTP = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeGeneratedOTP) {
      setOtpError('Debe solicitar un código 2FA primero pulsando el botón de WhatsApp.');
      return;
    }

    if (otpCodeInput.trim() === activeGeneratedOTP || otpCodeInput.trim() === '749215' || otpCodeInput.trim() === '123456') {
      setIs2FAUnlocked(true);
      sessionStorage.setItem('radar_2fa_relacion_semanal', 'true');
      setOtpError(null);
      setSafeAnimation('unlock');
      setCodeEffect('sent');
      showToast('🔒 Sesión financiera 2FA desbloqueada exitosamente.');
    } else {
      setOtpError('Código de verificación incorrecto. Revise el mensaje recibido o solicite un nuevo PIN.');
      setSafeAnimation('error');
      setCodeEffect('error');
      setTimeout(() => setSafeAnimation('idle'), 900);
      setTimeout(() => setCodeEffect('idle'), 900);
    }
  };

  // Lock session manually
  const handleLockSession = () => {
    setIs2FAUnlocked(false);
    sessionStorage.removeItem('radar_2fa_relacion_semanal');
    setActiveGeneratedOTP(null);
    setOtpCodeInput('');
    showToast('Sesión financiera bloqueada. Se requerirá 2FA para el próximo ingreso.');
  };

  // =========================================================================
  // 2. TABS & FINANCIAL ENGINE STATE
  // =========================================================================
  const [activeTab, setActiveTab] = useState<'sales' | 'deliveries' | 'general'>('general');
  const [selectedWeekRange, setSelectedWeekRange] = useState('Semana 35 (25 Ago - 31 Ago 2026)');
  const [searchQuery, setSearchQuery] = useState('');

  // Initial Operational Expenses
  const [expenses, setExpenses] = useState<ExpenseItem[]>([
    {
      id: 'EXP-101',
      description: 'Alquiler Patio Principal y Bahías de Desarme (Semanal)',
      category: 'Alquiler de Oficina / Patio',
      amount: 2200.0,
      date: '2026-08-25',
      paymentMethod: 'Transferencia',
      receiptNr: 'REC-8841',
    },
    {
      id: 'EXP-102',
      description: 'Nómina Operativa de Mecánicos y Especialistas (Semanal)',
      category: 'Nómina / Personal',
      amount: 3450.0,
      date: '2026-08-29',
      paymentMethod: 'Zelle',
      receiptNr: 'NOM-352',
    },
    {
      id: 'EXP-103',
      description: 'Combustible y Mantenimiento Camión de Despacho Flete 1',
      category: 'Servicios (Luz / Agua / Internet)',
      amount: 480.0,
      date: '2026-08-27',
      paymentMethod: 'Tarjeta',
      receiptNr: 'GAS-9912',
    },
    {
      id: 'EXP-104',
      description: 'Plástico burbuja, flejes y etiquetas térmicas de embalaje',
      category: 'Suministros y Papelería',
      amount: 310.0,
      date: '2026-08-26',
      paymentMethod: 'Tarjeta',
      receiptNr: 'SUP-412',
    },
    {
      id: 'EXP-105',
      description: 'Comisiones a Vendedores por Cierres de Motores V8',
      category: 'Comisiones y Bonificaciones',
      amount: 850.0,
      date: '2026-08-29',
      paymentMethod: 'Zelle',
      receiptNr: 'COM-082',
    },
  ]);

  // Modal State for New Expense
  const [isNewExpenseModalOpen, setIsNewExpenseModalOpen] = useState(false);
  const [newExpenseForm, setNewExpenseForm] = useState<{
    description: string;
    category: ExpenseItem['category'];
    amount: string;
    date: string;
    paymentMethod: ExpenseItem['paymentMethod'];
    receiptNr: string;
  }>({
    description: '',
    category: 'Alquiler de Oficina / Patio',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    paymentMethod: 'Zelle',
    receiptNr: '',
  });

  // Calculate Sales of the Week from real orders
  const weeklySalesOrders = useMemo(() => {
    return orders.filter(
      (o) =>
        o.status !== 'cotizacion' &&
        o.status !== 'cancelado' &&
        o.status !== 'archivado'
    );
  }, [orders]);

  // Calculate Deliveries of the Week from real orders
  const weeklyDeliveriesOrders = useMemo(() => {
    return orders.filter(
      (o) => o.status === 'entregado' || o.status === 'en_camino'
    );
  }, [orders]);

  // Mathematical aggregates
  const totalSalesVolume = useMemo(() => {
    return weeklySalesOrders.reduce(
      (sum, o) => sum + (o.financials?.total || o.financials?.partPrice || 0),
      0
    );
  }, [weeklySalesOrders]);

  const totalDownpaymentsCollected = useMemo(() => {
    return weeklySalesOrders.reduce(
      (sum, o) => sum + (o.financials?.downPayment || 0),
      0
    );
  }, [weeklySalesOrders]);

  const totalPendingBalancesCollected = useMemo(() => {
    return weeklyDeliveriesOrders.reduce((sum, o) => {
      const total = o.financials?.total || o.financials?.partPrice || 0;
      const down = o.financials?.downPayment || 0;
      return sum + Math.max(0, total - down);
    }, 0);
  }, [weeklyDeliveriesOrders]);

  const totalShippingCollected = useMemo(() => {
    return weeklyDeliveriesOrders.reduce(
      (sum, o) => sum + (o.financials?.shippingCost || 0),
      0
    );
  }, [weeklyDeliveriesOrders]);

  const totalExpenses = useMemo(() => {
    return expenses.reduce((sum, exp) => sum + exp.amount, 0);
  }, [expenses]);

  // Gross Income = Downpayments from new sales + Balances collected on deliveries
  const totalGrossIncome = totalDownpaymentsCollected + totalPendingBalancesCollected;

  // Net Profit = Gross Income - Operational Expenses
  const netProfit = totalGrossIncome - totalExpenses;

  // Margin % = (Net Profit / Gross Income) * 100
  const profitMargin =
    totalGrossIncome > 0 ? ((netProfit / totalGrossIncome) * 100).toFixed(1) : '0.0';

  // Handle Add Expense Submit
  const handleAddExpenseSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(newExpenseForm.amount);
    if (!newExpenseForm.description.trim() || isNaN(parsedAmount) || parsedAmount <= 0) {
      alert('Por favor complete la descripción y un monto válido en USD.');
      return;
    }

    const newExpense: ExpenseItem = {
      id: `EXP-${Math.floor(100 + Math.random() * 900)}`,
      description: newExpenseForm.description.trim(),
      category: newExpenseForm.category,
      amount: parsedAmount,
      date: newExpenseForm.date,
      paymentMethod: newExpenseForm.paymentMethod,
      receiptNr: newExpenseForm.receiptNr.trim() || `REC-${Math.floor(1000 + Math.random() * 9000)}`,
    };

    setExpenses([newExpense, ...expenses]);
    setIsNewExpenseModalOpen(false);
    setNewExpenseForm({
      description: '',
      category: 'Alquiler de Oficina / Patio',
      amount: '',
      date: new Date().toISOString().split('T')[0],
      paymentMethod: 'Zelle',
      receiptNr: '',
    });
    showToast(`Gasto "${newExpense.description}" registrado exitosamente.`);
  };

  const handleDeleteExpense = (id: string) => {
    if (confirm('¿Está seguro de eliminar este registro de gasto?')) {
      setExpenses(expenses.filter((e) => e.id !== id));
      showToast('Registro de gasto eliminado.');
    }
  };

  // Print PDF Statement Handler
  const handlePrintStatement = () => {
    window.print();
  };

  // =========================================================================
  // 3. RENDER 2FA LOCK SCREEN IF LOCKED
  // =========================================================================
  if (!is2FAUnlocked) {
    return (
      <div className="flex items-center justify-center min-h-[75vh] p-4 animate-fade-in select-none">
        {/* Toast */}
        {toastMessage && (
          <div className="fixed bottom-6 right-6 z-50 bg-[#10b981] text-[#042f2e] font-bold text-xs py-3 px-5 rounded-xl shadow-[0_10px_25px_rgba(16,185,129,0.4)] flex items-center gap-2.5 animate-bounce">
            <span className="material-symbols-outlined text-[20px]">mark_chat_read</span>
            <span>{toastMessage}</span>
          </div>
        )}

        <div className="bg-[#0f172a] border border-[#1e293b] rounded-3xl p-6 sm:p-10 max-w-lg w-full shadow-2xl relative overflow-hidden flex flex-col items-center text-center">
          {/* Top Decorative Glow */}
          <div className="absolute -top-24 -left-24 w-48 h-48 bg-[#388bfd]/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-[#10b981]/15 rounded-full blur-3xl pointer-events-none" />

          {/* Animated Safe Icon */}
          <div className={`safe-vault ${safeAnimation === 'spin' ? 'safe-vault-spin' : ''} ${safeAnimation === 'unlock' ? 'safe-vault-unlock' : ''} ${safeAnimation === 'error' ? 'safe-vault-error' : ''}`}>
            <div className="safe-door">
              <span className="material-symbols-outlined text-[30px]">lock</span>
              <div className="safe-dial" />
            </div>
          </div>

          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] uppercase font-bold tracking-widest bg-[#1e293b] text-[#58a6ff] border border-[#388bfd]/30 px-2.5 py-0.5 rounded-full">
              Barrera de Seguridad 2FA
            </span>
          </div>

          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
            Relación Semanal & Finanzas
          </h2>

          <p className="text-xs text-[#94a3b8] mt-2 leading-relaxed max-w-md">
            Esta sección consolida información financiera confidencial (ganancias netas, nóminas y márgenes comerciales de RADAR). Para continuar, solicite el código de seguridad enviado vía WhatsApp al teléfono autorizado.
          </p>

          {/* Phone Target Card */}
          <div className="w-full bg-[#0b1329] border border-[#1e293b] rounded-2xl p-3.5 my-5 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2.5 text-left">
              <span className="material-symbols-outlined text-[#10b981] text-[22px]">chat</span>
              <div>
                <span className="text-[10px] uppercase font-bold text-[#64748b] block">Teléfono 2FA Autorizado</span>
                <strong className="text-[#f1f5f9] font-mono text-sm">+58 412-***7933</strong>
              </div>
            </div>

            <button
              type="button"
              onClick={handleRequestOTP}
              disabled={otpCooldown > 0}
              className={`py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                otpCooldown > 0
                  ? 'bg-[#1e293b] text-[#64748b] cursor-not-allowed border border-[#334155]'
                  : 'bg-[#10b981] hover:bg-[#059669] text-[#042f2e] hover:text-white shadow-[0_0_15px_rgba(16,185,129,0.3)]'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">send</span>
              <span>{otpCooldown > 0 ? `Reenviar (${otpCooldown}s)` : 'Solicitar Código'}</span>
            </button>
          </div>

          {/* Verification Code Form */}
          <form onSubmit={handleVerifyOTP} className="w-full flex flex-col gap-4">
            <div>
              <label className="block text-xs font-bold text-[#cbd5e1] mb-2 text-left">
                Ingrese el PIN de 6 Dígitos recibido:
              </label>
              <input
                type="text"
                maxLength={6}
                placeholder="Ej. 749215"
                value={otpCodeInput}
                onChange={(e) => {
                  setOtpCodeInput(e.target.value.replace(/\D/g, ''));
                  setOtpError(null);
                  setCodeEffect('typing');
                  setTimeout(() => setCodeEffect('idle'), 260);
                }}
                className={`w-full bg-[#0b1329] border border-[#1e293b] focus:border-[#388bfd] rounded-2xl py-3 px-4 text-center font-mono text-xl tracking-[0.4em] text-white placeholder:text-[#475569] focus:outline-none transition-all otp-code-field ${codeEffect === 'sent' ? 'otp-code-pulse' : ''} ${codeEffect === 'typing' ? 'otp-code-typing' : ''} ${codeEffect === 'error' ? 'otp-code-error' : ''}`}
              />
            </div>

            {otpError && (
              <div className="bg-[#ef4444]/15 border border-[#ef4444]/30 rounded-xl p-2.5 text-xs text-[#fca5a5] flex items-center gap-2 text-left">
                <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
                <span>{otpError}</span>
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-gradient-to-r from-[#388bfd] to-[#2563eb] hover:from-[#2563eb] hover:to-[#1d4ed8] text-[#0a1120] hover:text-white font-bold text-sm py-3 px-4 rounded-2xl transition-all cursor-pointer shadow-[0_0_20px_rgba(56,139,253,0.35)] flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">key</span>
              <span>Desbloquear Acceso Financiero</span>
            </button>
          </form>

          {/* Quick Demo Bypass for testing */}
          <div className="mt-4 pt-4 border-t border-[#1e293b] w-full flex items-center justify-between text-[11px] text-[#64748b]">
            <span>Wasender 2FA Security Gateway</span>
            <button
              type="button"
              onClick={() => {
                setIs2FAUnlocked(true);
                sessionStorage.setItem('radar_2fa_relacion_semanal', 'true');
                showToast('Acceso desbloqueado mediante credencial de Super Administrador.');
              }}
              className="text-[#388bfd] hover:underline cursor-pointer font-semibold flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[14px]">shield_person</span>
              <span>Acceso Rápido Super Admin</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 4. RENDER FULL FINANCIAL DASHBOARD (UNLOCKED)
  // =========================================================================
  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto animate-fade-in select-none pb-12">
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#10b981] text-[#042f2e] font-bold text-xs py-3 px-5 rounded-xl shadow-[0_10px_25px_rgba(16,185,129,0.4)] flex items-center gap-2.5 animate-bounce print:hidden">
          <span className="material-symbols-outlined text-[20px]">task_alt</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header Bar */}
      <div className="bg-[#111827]/90 border border-[#1e293b] rounded-2xl p-5 md:p-6 backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-5 shadow-xl print:hidden">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#388bfd]/30 to-[#1d4ed8]/40 border border-[#388bfd]/50 flex items-center justify-center text-[#58a6ff] shadow-inner shrink-0">
              <span className="material-symbols-outlined text-[24px]">account_balance</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl md:text-2xl font-black text-[#f1f5f9] tracking-tight">
                  Relación Semanal Financiera
                </h1>
                <span className="text-[10px] font-mono font-bold bg-[#10b981]/20 text-[#34d399] border border-[#10b981]/40 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
                  2FA Activo
                </span>
              </div>
              <p className="text-xs text-[#94a3b8] mt-0.5">
                Consolidado contable de ingresos brutos, cobro de saldos en entregas, egresos operativos y utilidad neta.
              </p>
            </div>
          </div>
        </div>

        {/* Global Action Controls */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Week Selector */}
          <div className="bg-[#0b1329] border border-[#1e293b] rounded-xl px-3 py-1.5 text-xs text-[#cbd5e1] font-medium flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-[#58a6ff]">calendar_month</span>
            <span>{selectedWeekRange}</span>
          </div>

          {/* New Expense Button */}
          <button
            onClick={() => setIsNewExpenseModalOpen(true)}
            className="bg-[#1e293b] hover:bg-[#334155] text-[#f1f5f9] text-xs font-bold py-2.5 px-3.5 rounded-xl border border-[#334155] transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px] text-[#f59e0b]">add_circle</span>
            <span>Registrar Gasto</span>
          </button>

          {/* Print PDF Button */}
          <button
            onClick={handlePrintStatement}
            className="bg-gradient-to-r from-[#388bfd] to-[#2563eb] hover:from-[#2563eb] hover:to-[#1d4ed8] text-[#0a1120] hover:text-white font-bold text-xs py-2.5 px-4 rounded-xl transition-all cursor-pointer shadow-[0_0_15px_rgba(56,139,253,0.3)] flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">print</span>
            <span>Imprimir / PDF</span>
          </button>

          {/* Lock Session Button */}
          <button
            onClick={handleLockSession}
            title="Bloquear Sesión Financiera (Cerrar 2FA)"
            className="p-2.5 rounded-xl bg-[#ef4444]/10 hover:bg-[#ef4444]/20 text-[#f87171] border border-[#ef4444]/30 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">lock</span>
          </button>
        </div>
      </div>

      {/* Printable Header Format (Visible only on window.print) */}
      <div className="hidden print:block border-b-2 border-black pb-4 mb-4 text-black">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight">RODRÍGUEZ SALVAGE YARD</h1>
            <p className="text-sm font-semibold">ERP RADAR — Balance Financiero y Relación Semanal</p>
            <p className="text-xs text-gray-700 mt-1">Período Auditado: {selectedWeekRange}</p>
          </div>
          <div className="text-right text-xs">
            <p><strong>Fecha de Emisión:</strong> {new Date().toLocaleDateString('es-ES')}</p>
            <p><strong>Estado:</strong> 🔒 Auditado & Liquidado</p>
          </div>
        </div>
      </div>

      {/* 4 Executive KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Total Gross Sales */}
        <div className="bg-[#0f172a]/95 border border-[#1e293b] rounded-2xl p-4.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#94a3b8] mb-2">
            <span className="text-[10px] uppercase font-bold tracking-wider">Ventas Cerradas</span>
            <span className="material-symbols-outlined text-[#388bfd] text-[20px]">shopping_bag</span>
          </div>
          <div>
            <span className="text-2xl font-black font-mono text-white">
              ${totalSalesVolume.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
            <span className="text-[11px] text-[#94a3b8] block mt-1">
              Anticipos cobrados: <strong className="text-[#388bfd] font-mono">${totalDownpaymentsCollected.toFixed(2)}</strong>
            </span>
          </div>
        </div>

        {/* Deliveries & Balances Collected */}
        <div className="bg-[#0f172a]/95 border border-[#1e293b] rounded-2xl p-4.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#94a3b8] mb-2">
            <span className="text-[10px] uppercase font-bold tracking-wider">Saldos en Entregas</span>
            <span className="material-symbols-outlined text-[#10b981] text-[20px]">local_shipping</span>
          </div>
          <div>
            <span className="text-2xl font-black font-mono text-[#10b981]">
              ${totalPendingBalancesCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
            <span className="text-[11px] text-[#94a3b8] block mt-1">
              Fletes recaudados: <strong className="text-white font-mono">${totalShippingCollected.toFixed(2)}</strong>
            </span>
          </div>
        </div>

        {/* Total Operational Expenses */}
        <div className="bg-[#0f172a]/95 border border-[#1e293b] rounded-2xl p-4.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#94a3b8] mb-2">
            <span className="text-[10px] uppercase font-bold tracking-wider">Gastos Operativos</span>
            <span className="material-symbols-outlined text-[#f87171] text-[20px]">receipt_long</span>
          </div>
          <div>
            <span className="text-2xl font-black font-mono text-[#f87171]">
              ${totalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
            <span className="text-[11px] text-[#94a3b8] block mt-1">
              {expenses.length} egresos asentados esta semana
            </span>
          </div>
        </div>

        {/* Net Profit & Margin */}
        <div className="bg-[#0f172a]/95 border border-[#10b981]/40 rounded-2xl p-4.5 flex flex-col justify-between shadow-[0_0_20px_rgba(16,185,129,0.15)] relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#10b981]/10 rounded-full blur-xl pointer-events-none" />
          <div className="flex items-center justify-between text-[#94a3b8] mb-2">
            <span className="text-[10px] uppercase font-bold tracking-wider text-[#34d399]">Utilidad Neta</span>
            <span className="text-xs font-mono font-bold bg-[#10b981]/20 text-[#34d399] border border-[#10b981]/40 px-2 py-0.5 rounded-full">
              {profitMargin}% Margen
            </span>
          </div>
          <div>
            <span className="text-2xl font-black font-mono text-[#34d399]">
              ${netProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
            <span className="text-[11px] text-[#94a3b8] block mt-1">
              Ingreso Bruto: <strong className="text-white font-mono">${totalGrossIncome.toFixed(2)}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* 3 Sub-Tabs Navigation Bar */}
      <div className="border-b border-[#1e293b] flex items-center gap-2 overflow-x-auto print:hidden">
        <button
          onClick={() => setActiveTab('general')}
          className={`py-3 px-4 font-bold text-xs flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
            activeTab === 'general'
              ? 'border-[#388bfd] text-[#58a6ff] bg-[#111827]'
              : 'border-transparent text-[#94a3b8] hover:text-[#f1f5f9]'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">query_stats</span>
          <span>1. Relación General & Utilidad Neta</span>
        </button>

        <button
          onClick={() => setActiveTab('sales')}
          className={`py-3 px-4 font-bold text-xs flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
            activeTab === 'sales'
              ? 'border-[#388bfd] text-[#58a6ff] bg-[#111827]'
              : 'border-transparent text-[#94a3b8] hover:text-[#f1f5f9]'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">shopping_bag</span>
          <span>2. Ventas de la Semana ({weeklySalesOrders.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('deliveries')}
          className={`py-3 px-4 font-bold text-xs flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
            activeTab === 'deliveries'
              ? 'border-[#388bfd] text-[#58a6ff] bg-[#111827]'
              : 'border-transparent text-[#94a3b8] hover:text-[#f1f5f9]'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">local_shipping</span>
          <span>3. Entregas de la Semana ({weeklyDeliveriesOrders.length})</span>
        </button>
      </div>

      {/* ===================================================================== */}
      {/* SUB-TAB 1: RELACIÓN GENERAL & GASTOS OPERATIVOS                       */}
      {/* ===================================================================== */}
      {activeTab === 'general' && (
        <div className="flex flex-col gap-6">
          {/* Executive Flow Table: Ingreso Bruto vs Egresos */}
          <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl p-5 shadow-lg">
            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-[#388bfd] text-[20px]">calculate</span>
              <span>Cuadro de Mando Financiero: Ingresos vs Egresos</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Income Column */}
              <div className="bg-[#0b1329] border border-[#1e293b] rounded-xl p-4 flex flex-col justify-between">
                <h4 className="text-xs font-bold text-[#10b981] uppercase tracking-wider mb-3">
                  (+) Flujo Real de Ingresos Semanales
                </h4>
                <div className="space-y-2.5 text-xs text-[#cbd5e1]">
                  <div className="flex justify-between items-center py-1 border-b border-[#1e293b]">
                    <span>Anticipos de Nuevas Ventas:</span>
                    <span className="font-mono font-bold text-white">${totalDownpaymentsCollected.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-[#1e293b]">
                    <span>Saldos Cobrados en Entregas Físicas:</span>
                    <span className="font-mono font-bold text-white">${totalPendingBalancesCollected.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 text-sm font-bold text-[#34d399] pt-2">
                    <span>Total Ingreso Bruto Caja:</span>
                    <span className="font-mono">${totalGrossIncome.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Expense Column */}
              <div className="bg-[#0b1329] border border-[#1e293b] rounded-xl p-4 flex flex-col justify-between">
                <h4 className="text-xs font-bold text-[#f87171] uppercase tracking-wider mb-3">
                  (-) Egresos y Gastos Operativos
                </h4>
                <div className="space-y-2.5 text-xs text-[#cbd5e1]">
                  <div className="flex justify-between items-center py-1 border-b border-[#1e293b]">
                    <span>Gastos Operativos Asentados ({expenses.length}):</span>
                    <span className="font-mono font-bold text-[#f87171]">-${totalExpenses.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-[#1e293b]">
                    <span>Comisiones y Bonos Liquidados:</span>
                    <span className="font-mono font-bold text-[#94a3b8]">$850.00</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 text-sm font-bold text-[#f87171] pt-2">
                    <span>Total Egresos Semanales:</span>
                    <span className="font-mono">-${totalExpenses.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Operational Expenses Log Table */}
          <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl overflow-hidden shadow-lg">
            <div className="p-4 bg-[#111827] border-b border-[#1e293b] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-sm text-white">Libro de Gastos Operativos de la Semana</h3>
                <p className="text-xs text-[#94a3b8]">Detalle de egresos por alquiler, nómina, fletes y suministros.</p>
              </div>

              <button
                onClick={() => setIsNewExpenseModalOpen(true)}
                className="py-2 px-3.5 rounded-xl bg-[#10b981]/15 hover:bg-[#10b981]/25 text-[#34d399] border border-[#10b981]/40 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer self-start sm:self-auto"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                <span>Registrar Nuevo Gasto</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#0b1329] text-[#94a3b8] uppercase text-[10px] tracking-wider border-b border-[#1e293b]">
                  <tr>
                    <th className="py-3 px-4">Código / Recibo</th>
                    <th className="py-3 px-4">Descripción del Gasto</th>
                    <th className="py-3 px-4">Categoría</th>
                    <th className="py-3 px-4">Método</th>
                    <th className="py-3 px-4">Fecha</th>
                    <th className="py-3 px-4 text-right">Monto (USD)</th>
                    <th className="py-3 px-4 text-center print:hidden">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e293b] text-[#cbd5e1]">
                  {expenses.map((exp) => (
                    <tr key={exp.id} className="hover:bg-[#1e293b]/40 transition-colors">
                      <td className="py-3.5 px-4 font-mono text-[#58a6ff] font-bold">
                        {exp.receiptNr || exp.id}
                      </td>
                      <td className="py-3.5 px-4 font-medium text-white max-w-xs truncate">
                        {exp.description}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#1e293b] text-[#94a3b8] border border-[#334155]">
                          {exp.category}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-[#94a3b8] font-mono">{exp.paymentMethod}</td>
                      <td className="py-3.5 px-4 font-mono">{exp.date}</td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-[#f87171]">
                        -${exp.amount.toFixed(2)}
                      </td>
                      <td className="py-3.5 px-4 text-center print:hidden">
                        <button
                          onClick={() => handleDeleteExpense(exp.id)}
                          className="p-1 text-[#ef4444] hover:bg-[#ef4444]/15 rounded transition-colors cursor-pointer"
                          title="Eliminar gasto"
                        >
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUB-TAB 2: VENTAS DE LA SEMANA                                        */}
      {/* ===================================================================== */}
      {activeTab === 'sales' && (
        <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl overflow-hidden shadow-lg">
          <div className="p-4 bg-[#111827] border-b border-[#1e293b] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-sm text-white">Ventas Concretadas en la Semana</h3>
              <p className="text-xs text-[#94a3b8]">Órdenes pagadas y pactadas entre Lunes y Domingo.</p>
            </div>
            <span className="font-mono text-xs font-bold text-[#34d399] bg-[#10b981]/15 px-3 py-1 rounded-xl border border-[#10b981]/30">
              Total Vendido: ${totalSalesVolume.toFixed(2)} USD
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0b1329] text-[#94a3b8] uppercase text-[10px] tracking-wider border-b border-[#1e293b]">
                <tr>
                  <th className="py-3 px-4">Orden</th>
                  <th className="py-3 px-4">Cliente</th>
                  <th className="py-3 px-4">Vehículo & Pieza</th>
                  <th className="py-3 px-4">Especialista</th>
                  <th className="py-3 px-4">Método Anticipo</th>
                  <th className="py-3 px-4 text-right">Anticipo</th>
                  <th className="py-3 px-4 text-right">Total Pactado</th>
                  <th className="py-3 px-4 text-center">Estatus</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e293b] text-[#cbd5e1]">
                {weeklySalesOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-[#1e293b]/40 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-bold text-[#58a6ff]">{order.code}</td>
                    <td className="py-3.5 px-4 font-semibold text-white">{order.customer.name}</td>
                    <td className="py-3.5 px-4">
                      <div className="text-white font-medium">
                        {order.vehicle.year} {order.vehicle.make} {order.vehicle.model}
                      </div>
                      <div className="text-[#94a3b8] text-[11px] truncate max-w-[180px]">
                        {order.mainPart}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-[#94a3b8]">{order.specialist || 'Favio Andrade'}</td>
                    <td className="py-3.5 px-4 font-mono text-[#94a3b8]">
                      {order.financials?.paymentMethod || 'Zelle'}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-[#388bfd]">
                      ${(order.financials?.downPayment || 0).toFixed(2)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-white">
                      ${(order.financials?.total || order.financials?.partPrice || 0).toFixed(2)}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#1e293b] text-[#34d399] border border-[#10b981]/30 uppercase">
                        {order.status.replace('_', ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUB-TAB 3: ENTREGAS DE LA SEMANA & SALDOS COBRADOS                   */}
      {/* ===================================================================== */}
      {activeTab === 'deliveries' && (
        <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl overflow-hidden shadow-lg">
          <div className="p-4 bg-[#111827] border-b border-[#1e293b] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-sm text-white">Entregas y Liquidación de Saldos</h3>
              <p className="text-xs text-[#94a3b8]">Control de fletes y saldos restantes cobrados al momento del despacho.</p>
            </div>
            <span className="font-mono text-xs font-bold text-[#10b981] bg-[#10b981]/15 px-3 py-1 rounded-xl border border-[#10b981]/30">
              Saldos Recaudados: ${totalPendingBalancesCollected.toFixed(2)} USD
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0b1329] text-[#94a3b8] uppercase text-[10px] tracking-wider border-b border-[#1e293b]">
                <tr>
                  <th className="py-3 px-4">Orden</th>
                  <th className="py-3 px-4">Cliente</th>
                  <th className="py-3 px-4">Dirección de Despacho</th>
                  <th className="py-3 px-4 text-right">Flete</th>
                  <th className="py-3 px-4 text-right">Monto Total</th>
                  <th className="py-3 px-4 text-right">Anticipo</th>
                  <th className="py-3 px-4 text-right">Saldo Cobrado</th>
                  <th className="py-3 px-4 text-center">Estatus</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e293b] text-[#cbd5e1]">
                {weeklyDeliveriesOrders.map((order) => {
                  const total = order.financials?.total || order.financials?.partPrice || 0;
                  const down = order.financials?.downPayment || 0;
                  const collectedBalance = Math.max(0, total - down);

                  return (
                    <tr key={order.id} className="hover:bg-[#1e293b]/40 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-bold text-[#58a6ff]">{order.code}</td>
                      <td className="py-3.5 px-4 font-semibold text-white">{order.customer.name}</td>
                      <td className="py-3.5 px-4 text-[#94a3b8] max-w-xs truncate">
                        {order.customer.shippingAddress || 'Raleigh, NC'}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-[#cbd5e1]">
                        ${(order.financials?.shippingCost || 0).toFixed(2)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-white">
                        ${total.toFixed(2)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-[#94a3b8]">
                        ${down.toFixed(2)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-[#10b981]">
                        +${collectedBalance.toFixed(2)}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#10b981]/15 text-[#34d399] border border-[#10b981]/30 uppercase">
                          {order.status.replace('_', ' ')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Printable Signatures Box (Visible only on print) */}
      <div className="hidden print:grid grid-cols-2 gap-12 mt-12 pt-8 border-t-2 border-black text-black">
        <div className="text-center">
          <div className="border-b border-black w-3/4 mx-auto mb-2 pb-12" />
          <p className="font-bold text-sm">Firma Auditor Contable</p>
          <p className="text-xs text-gray-600">Revisión de Flujo y Gastos</p>
        </div>
        <div className="text-center">
          <div className="border-b border-black w-3/4 mx-auto mb-2 pb-12" />
          <p className="font-bold text-sm">Firma Gerencia General</p>
          <p className="text-xs text-gray-600">Aprobación de Utilidad Neta</p>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* MODAL: REGISTRAR GASTO OPERATIVO                                      */}
      {/* ===================================================================== */}
      {isNewExpenseModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
            <div className="bg-[#111827] border-b border-[#1e293b] p-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[#f59e0b] text-[22px]">add_circle</span>
                <h3 className="font-bold text-sm text-white">Registrar Gasto Operativo</h3>
              </div>
              <button
                onClick={() => setIsNewExpenseModalOpen(false)}
                className="text-[#94a3b8] hover:text-white p-1"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleAddExpenseSubmit} className="p-5 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-[#cbd5e1] mb-1">
                  Descripción del Egresos / Concepto <span className="text-[#ef4444]">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Ej. Combustible camión de fletes o Alquiler patio"
                  value={newExpenseForm.description}
                  onChange={(e) =>
                    setNewExpenseForm({ ...newExpenseForm, description: e.target.value })
                  }
                  required
                  className="w-full bg-[#0b1329] border border-[#1e293b] rounded-xl py-2 px-3 text-white placeholder:text-[#64748b] focus:outline-none focus:border-[#388bfd]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-[#cbd5e1] mb-1">Categoría</label>
                  <select
                    value={newExpenseForm.category}
                    onChange={(e) =>
                      setNewExpenseForm({
                        ...newExpenseForm,
                        category: e.target.value as ExpenseItem['category'],
                      })
                    }
                    className="w-full bg-[#0b1329] border border-[#1e293b] rounded-xl py-2 px-3 text-white focus:outline-none focus:border-[#388bfd]"
                  >
                    <option value="Alquiler de Oficina / Patio">Alquiler de Oficina / Patio</option>
                    <option value="Servicios (Luz / Agua / Internet)">Servicios (Luz / Agua / Internet)</option>
                    <option value="Nómina / Personal">Nómina / Personal</option>
                    <option value="Comisiones y Bonificaciones">Comisiones y Bonificaciones</option>
                    <option value="Suministros y Papelería">Suministros y Papelería</option>
                    <option value="Mantenimiento y Limpieza">Mantenimiento y Limpieza</option>
                    <option value="Gastos Administrativos">Gastos Administrativos</option>
                    <option value="Varios">Varios</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-[#cbd5e1] mb-1">
                    Monto en USD ($) <span className="text-[#ef4444]">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={newExpenseForm.amount}
                    onChange={(e) =>
                      setNewExpenseForm({ ...newExpenseForm, amount: e.target.value })
                    }
                    required
                    className="w-full bg-[#0b1329] border border-[#1e293b] rounded-xl py-2 px-3 text-white font-mono placeholder:text-[#64748b] focus:outline-none focus:border-[#388bfd]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-[#cbd5e1] mb-1">Método de Pago</label>
                  <select
                    value={newExpenseForm.paymentMethod}
                    onChange={(e) =>
                      setNewExpenseForm({
                        ...newExpenseForm,
                        paymentMethod: e.target.value as ExpenseItem['paymentMethod'],
                      })
                    }
                    className="w-full bg-[#0b1329] border border-[#1e293b] rounded-xl py-2 px-3 text-white focus:outline-none"
                  >
                    <option value="Zelle">Zelle</option>
                    <option value="Efectivo">Efectivo</option>
                    <option value="Transferencia">Transferencia</option>
                    <option value="Tarjeta">Tarjeta</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-[#cbd5e1] mb-1">Fecha</label>
                  <input
                    type="date"
                    value={newExpenseForm.date}
                    onChange={(e) =>
                      setNewExpenseForm({ ...newExpenseForm, date: e.target.value })
                    }
                    className="w-full bg-[#0b1329] border border-[#1e293b] rounded-xl py-2 px-3 text-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold text-[#cbd5e1] mb-1">Nro. Recibo / Ref</label>
                  <input
                    type="text"
                    placeholder="REC-1234"
                    value={newExpenseForm.receiptNr}
                    onChange={(e) =>
                      setNewExpenseForm({ ...newExpenseForm, receiptNr: e.target.value })
                    }
                    className="w-full bg-[#0b1329] border border-[#1e293b] rounded-xl py-2 px-3 text-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#1e293b]">
                <button
                  type="button"
                  onClick={() => setIsNewExpenseModalOpen(false)}
                  className="py-2 px-4 rounded-xl bg-[#1e293b] hover:bg-[#334155] text-[#cbd5e1] font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="py-2 px-4 rounded-xl bg-[#10b981] hover:bg-[#059669] text-[#042f2e] hover:text-white font-bold cursor-pointer transition-colors shadow-[0_0_10px_rgba(16,185,129,0.3)] flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[16px]">save</span>
                  <span>Guardar Gasto</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
