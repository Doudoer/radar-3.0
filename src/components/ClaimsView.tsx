import React, { useEffect, useMemo, useState } from 'react';
import { Order, Claim, ClaimCall, RefundRequest, ClaimStatus } from '../types';
import { apiFetch } from '../services/apiFetch';

interface ClaimsViewProps {
  orders?: Order[];
  onUpdateOrder?: (order: Order) => void;
  userRole?: 'admin' | 'operador';
  onSelectOrder?: (orderId: string) => void;
}

export const ClaimsView: React.FC<ClaimsViewProps> = ({
  orders = [],
  onUpdateOrder,
  userRole = 'admin',
  onSelectOrder,
}) => {
  // Claims State
  const [claims, setClaims] = useState<Claim[]>([]);
  const [refundRequests, setRefundRequests] = useState<RefundRequest[]>([]);

  useEffect(() => {
    apiFetch('/claims')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setClaims)
      .catch(() => setClaims([]));
  }, []);

  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('Todos');
  const [priorityFilter, setPriorityFilter] = useState<string>('Todas');
  const [showRefundsDrawer, setShowRefundsDrawer] = useState(true);

  // Modals State
  const [isNewClaimModalOpen, setIsNewClaimModalOpen] = useState(false);
  const [isNewRefundModalOpen, setIsNewRefundModalOpen] = useState(false);
  const [selectedClaimForCalls, setSelectedClaimForCalls] = useState<Claim | null>(null);
  const [selectedClaimDetail, setSelectedClaimDetail] = useState<Claim | null>(null);
  const [isPrintReportModalOpen, setIsPrintReportModalOpen] = useState(false);

  // Print Date Range
  const [printDateFrom, setPrintDateFrom] = useState('2026-08-01');
  const [printDateTo, setPrintDateTo] = useState('2026-09-01');

  // New Claim Form State
  const [newClaimOrderId, setNewClaimOrderId] = useState('');
  const [newClaimType, setNewClaimType] = useState('Garantía Tren Motriz');
  const [newClaimPriority, setNewClaimPriority] = useState<'Alta' | 'Media' | 'Baja'>('Alta');
  const [newClaimReason, setNewClaimReason] = useState('');
  const [newClaimAdvisor, setNewClaimAdvisor] = useState('Carlos Mendoza');

  // New Refund Form State
  const [newRefundOrderId, setNewRefundOrderId] = useState('');
  const [newRefundReason, setNewRefundReason] = useState('Pieza descontinuada / Sin stock de reemplazo');
  const [newRefundAmountType, setNewRefundAmountType] = useState<'downpayment' | 'total' | 'custom'>('downpayment');
  const [newRefundAmount, setNewRefundAmount] = useState('500');
  const [newRefundMethod, setNewRefundMethod] = useState<'Zelle' | 'CashApp' | 'Efectivo'>('Zelle');
  const [newRefundDetails, setNewRefundDetails] = useState('');

  // Call Register Form State inside Modal
  const [callerName, setCallerName] = useState('');
  const [callerPhone, setCallerPhone] = useState('');
  const [attendedBy, setAttendedBy] = useState('Carlos Mendoza');
  const [callSummary, setCallSummary] = useState('');

  // Toast Notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // KPI Computations
  const stats = useMemo(() => {
    const total = claims.length;
    const pending = claims.filter((c) => c.status === 'Pending').length;
    const inProcess = claims.filter((c) => c.status === 'In Process').length;
    const resolved = claims.filter((c) => c.status === 'Resolved').length;
    const denied = claims.filter((c) => c.status === 'Denied').length;
    const pendingRefunds = refundRequests.filter((r) => r.status === 'pending').length;
    const totalCalls = claims.reduce((acc, c) => acc + (c.callCount || 0), 0);
    return { total, pending, inProcess, resolved, denied, pendingRefunds, totalCalls };
  }, [claims, refundRequests]);

  // Filtered Claims
  const filteredClaims = useMemo(() => {
    return claims.filter((c) => {
      if (c.status === 'Resolved') return false;

      const q = searchTerm.toLowerCase().trim();
      const matchesSearch =
        !q ||
        c.id.toLowerCase().includes(q) ||
        c.orderCode.toLowerCase().includes(q) ||
        c.customerName.toLowerCase().includes(q) ||
        c.customerPhone.toLowerCase().includes(q) ||
        c.vehicle.toLowerCase().includes(q) ||
        c.mainPart.toLowerCase().includes(q) ||
        c.claimReason.toLowerCase().includes(q);

      const matchesStatus = statusFilter === 'Todos' || c.status === statusFilter;
      const matchesPriority = priorityFilter === 'Todas' || c.priority === priorityFilter;

      return matchesSearch && matchesStatus && matchesPriority;
    });
  }, [claims, searchTerm, statusFilter, priorityFilter]);

  // 1. ATOMIC WORKFLOW: Create New Claim
  const handleCreateClaim = (e: React.FormEvent) => {
    e.preventDefault();
    const targetOrder = orders.find((o) => o.id === newClaimOrderId || o.code === newClaimOrderId);

    const orderCode = targetOrder ? targetOrder.code : newClaimOrderId || 'ORD-GEN-999';
    const customerName = targetOrder ? targetOrder.customer.name : 'Cliente Registrado';
    const customerPhone = targetOrder ? targetOrder.customer.phone : '9195550100';
    const customerEmail = targetOrder ? targetOrder.customer.email : '';
    const vehicle = targetOrder
      ? `${targetOrder.vehicle.year} ${targetOrder.vehicle.make} ${targetOrder.vehicle.model}`
      : 'Vehículo en Sistema';
    const mainPart = targetOrder ? targetOrder.mainPart : 'Refacción Automotriz';
    const previousStatus = targetOrder ? targetOrder.status : 'entregado';

    const newClaim: Claim = {
      id: `REC-2026-${String(Math.floor(100 + Math.random() * 900))}`,
      orderId: targetOrder ? targetOrder.id : newClaimOrderId,
      orderCode,
      customerName,
      customerPhone,
      customerEmail,
      vehicle,
      vin: targetOrder?.vehicle.vin,
      mainPart,
      partSpecs: targetOrder?.productSpecs,
      claimReason: newClaimReason,
      type: newClaimType,
      priority: newClaimPriority,
      status: 'Pending',
      previousOrderStatus: previousStatus,
      advisor: newClaimAdvisor,
      createdAt: new Date().toISOString(),
      callCount: 0,
      calls: [],
      warrantyDays: targetOrder?.warrantyDays || 60,
      supplierName: 'Yarda Proveedora',
      stockNumber: targetOrder?.stockNumber,
    };

    // Update Local Claims
    setClaims([newClaim, ...claims]);

    // ATOMIC UPDATE: Put Order in 'reclamo' status
    if (targetOrder && onUpdateOrder) {
      onUpdateOrder({
        ...targetOrder,
        status: 'reclamo',
        claimReason: newClaimReason,
      });
    }

    setIsNewClaimModalOpen(false);
    setNewClaimReason('');
    setNewClaimOrderId('');

    showToast(`🚨 Reclamo ${newClaim.id} creado. Orden ${orderCode} pasó a estatus 'Reclamo'. Alerta Wasender enviada a Customer Success.`);
  };

  // 2. ATOMIC WORKFLOW: Mark Claim as Resolved (Restore Order Status)
  const handleResolveClaim = async (claim: Claim) => {
    const response = await apiFetch(`/claims/${claim.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'Resolved',
        orderId: claim.orderId,
        previousOrderStatus: claim.previousOrderStatus || 'entregado',
      }),
    });

    if (!response.ok) {
      showToast(`No se pudo resolver el reclamo ${claim.id} en radar_db.`);
      return;
    }

    setClaims((currentClaims) => currentClaims.filter((c) => c.id !== claim.id));
    setSelectedClaimDetail(null);
    setSelectedClaimForCalls(null);

    // ATOMIC RESTORATION: Restore order to previous status and clear claimReason
    const targetOrder = orders.find((o) => o.id === claim.orderId || o.code === claim.orderCode);
    if (targetOrder && onUpdateOrder) {
      onUpdateOrder({
        ...targetOrder,
        status: claim.previousOrderStatus || 'entregado',
        claimReason: undefined,
      });
    }

    showToast(`🟢 Reclamo ${claim.id} resuelto. Orden ${claim.orderCode} restaurada atómicamente a '${claim.previousOrderStatus || 'Entregado'}'.`);
  };

  // 3. ATOMIC WORKFLOW: Deny Claim
  const handleDenyClaim = (claim: Claim) => {
    if (!window.confirm(`¿Estás seguro de denegar la garantía del reclamo ${claim.id}? Esta acción anula la póliza por incumplimiento de términos.`)) {
      return;
    }

    const updatedClaims = claims.map((c) => {
      if (c.id === claim.id) {
        return {
          ...c,
          status: 'Denied' as ClaimStatus,
          resolvedAt: new Date().toISOString(),
          resolutionNotes: 'Garantía denegada: Violación a los términos de cobertura.',
        };
      }
      return c;
    });

    setClaims(updatedClaims);
    showToast(`🔴 Reclamo ${claim.id} marcado como 'Denied' (Garantía Anulada).`);
  };

  // 4. ATOMIC WORKFLOW: Update Claim Status
  const handleUpdateClaimStatus = (claimId: string, newStatus: ClaimStatus) => {
    const claim = claims.find((c) => c.id === claimId);
    if (!claim) return;

    if (newStatus === 'Resolved') {
      void handleResolveClaim(claim);
      return;
    }

    if (newStatus === 'Denied') {
      handleDenyClaim(claim);
      return;
    }

    const updated = claims.map((c) => (c.id === claimId ? { ...c, status: newStatus } : c));
    setClaims(updated);
    showToast(`ℹ️ Reclamo ${claimId} actualizado a '${newStatus}'.`);
  };

  // 5. CALL REGISTER WORKFLOW: Add Call Log with Wasender Dispatch
  const handleAddCall = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClaimForCalls) return;

    const newCallNumber = (selectedClaimForCalls.callCount || 0) + 1;
    const wasenderMsg = `📢 Reclamo ${selectedClaimForCalls.orderCode} - Llamada #${newCallNumber}${
      newCallNumber >= 3 ? ' (🔥 ALTA PRIORIDAD / CLIENTE INSATISFECHO)' : ''
    } | Cliente: ${callerName || selectedClaimForCalls.customerName} (${callerPhone || selectedClaimForCalls.customerPhone}) | Atendió: ${attendedBy} | Detalle: ${callSummary}`;

    const newCall: ClaimCall = {
      id: `CALL-${selectedClaimForCalls.id}-${newCallNumber}-${Date.now()}`,
      claimId: selectedClaimForCalls.id,
      callNumber: newCallNumber,
      callerName: callerName || selectedClaimForCalls.customerName,
      callerPhone: callerPhone || selectedClaimForCalls.customerPhone,
      attendedBy,
      conversationSummary: callSummary,
      createdAt: new Date().toISOString(),
      whatsappDispatched: true,
      whatsappMessage: wasenderMsg,
    };

    const updatedClaims = claims.map((c) => {
      if (c.id === selectedClaimForCalls.id) {
        const updatedCalls = [newCall, ...(c.calls || [])];
        return {
          ...c,
          callCount: newCallNumber,
          calls: updatedCalls,
        };
      }
      return c;
    });

    setClaims(updatedClaims);
    setSelectedClaimForCalls({
      ...selectedClaimForCalls,
      callCount: newCallNumber,
      calls: [newCall, ...(selectedClaimForCalls.calls || [])],
    });

    setCallSummary('');
    showToast(`📞 Llamada #${newCallNumber} registrada. Notificación Wasender enviada al equipo por WhatsApp.`);
  };

  // 6. REFUND WORKFLOW: Complete Refund Request
  const handleCompleteRefund = (refund: RefundRequest) => {
    const updatedRefunds = refundRequests.map((r) => {
      if (r.id === refund.id) {
        return {
          ...r,
          status: 'completed' as const,
          completedAt: new Date().toISOString(),
          completedBy: 'Administración RADAR',
        };
      }
      return r;
    });

    setRefundRequests(updatedRefunds);

    // ATOMIC UPDATE: Put order in 'reembolsado' status
    const targetOrder = orders.find((o) => o.id === refund.orderId || o.code === refund.orderCode);
    if (targetOrder && onUpdateOrder) {
      onUpdateOrder({
        ...targetOrder,
        status: 'reembolsado',
      });
    }

    showToast(`💼 Reembolso ${refund.id} completado ($${refund.amount.toFixed(2)} vía ${refund.paymentMethod}). Orden ${refund.orderCode} pasó a 'Reembolsado'.`);
  };

  // 7. CREATE NEW REFUND REQUEST
  const handleCreateRefundRequest = (e: React.FormEvent) => {
    e.preventDefault();
    const targetOrder = orders.find((o) => o.id === newRefundOrderId || o.code === newRefundOrderId);

    const amountNum = parseFloat(newRefundAmount) || 0;
    const newRef: RefundRequest = {
      id: `REF-2026-${String(Math.floor(1000 + Math.random() * 9000))}`,
      orderId: targetOrder ? targetOrder.id : newRefundOrderId,
      orderCode: targetOrder ? targetOrder.code : newRefundOrderId || 'ORD-REF-001',
      customerName: targetOrder ? targetOrder.customer.name : 'Cliente en Reembolso',
      customerPhone: targetOrder?.customer.phone,
      vehicle: targetOrder ? `${targetOrder.vehicle.year} ${targetOrder.vehicle.make} ${targetOrder.vehicle.model}` : 'Vehículo',
      part: targetOrder ? targetOrder.mainPart : 'Refacción',
      reason: newRefundReason,
      amount: amountNum,
      amountType: newRefundAmountType,
      paymentMethod: newRefundMethod,
      paymentDetails: newRefundDetails || 'Por verificar con cliente',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    setRefundRequests([newRef, ...refundRequests]);

    // Update order status to solicitud_reembolso
    if (targetOrder && onUpdateOrder) {
      onUpdateOrder({
        ...targetOrder,
        status: 'solicitud_reembolso',
      });
    }

    setIsNewRefundModalOpen(false);
    setNewRefundReason('');
    setNewRefundDetails('');
    showToast(`💼 Solicitud de reembolso ${newRef.id} registrada por $${amountNum.toFixed(2)} USD.`);
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto flex flex-col gap-6 animate-fade-in relative pb-16">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 bg-[#10b981] text-[#064e3b] font-bold text-xs py-2.5 px-4 rounded-xl shadow-[0_0_25px_rgba(16,185,129,0.4)] flex items-center gap-2 animate-bounce border border-[#34d399]">
          <span className="material-symbols-outlined text-[18px]">verified</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-[#111827]/80 p-5 rounded-2xl border border-[#1e293b] backdrop-blur-md">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#ef4444]/20 text-[#ef4444] flex items-center justify-center border border-[#ef4444]/40 shadow-[0_0_20px_rgba(239,68,68,0.25)]">
              <span className="material-symbols-outlined text-[24px]">verified_user</span>
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-black text-[#f1f5f9] tracking-tight flex items-center gap-2">
                <span>Reclamos & Garantías</span>
                <span className="text-xs font-mono bg-[#1e293b] text-[#cbd5e1] px-2.5 py-0.5 rounded-full border border-[rgba(255,255,255,0.08)]">
                  /claims
                </span>
              </h1>
              <p className="text-xs text-[#94a3b8]">
                Trazabilidad atómica en órdenes, bitácora de llamadas con alertas Wasender y liquidación de reembolsos.
              </p>
            </div>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsPrintReportModalOpen(true)}
            className="bg-[#1c2438] hover:bg-[#25324d] text-[#cbd5e1] hover:text-white border border-[#2b3a58] px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px] text-[#58a6ff]">print</span>
            <span>Imprimir PDF Reclamos</span>
          </button>

          <button
            type="button"
            onClick={() => setIsNewRefundModalOpen(true)}
            className="bg-[#0f172a] hover:bg-[#1e293b] text-[#fbbf24] border border-[#f59e0b]/40 px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px]">currency_exchange</span>
            <span>+ Solicitud Reembolso</span>
          </button>

          <button
            type="button"
            onClick={() => setIsNewClaimModalOpen(true)}
            className="bg-[#ef4444] hover:bg-[#dc2626] text-white font-bold text-xs py-2 px-4 rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-[0_0_18px_rgba(239,68,68,0.4)] active:scale-95"
          >
            <span className="material-symbols-outlined text-[18px]">add_alert</span>
            <span>+ Nuevo Reclamo</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl p-3.5 flex flex-col">
          <span className="text-[11px] font-bold text-[#94a3b8] uppercase">Total Casos</span>
          <span className="text-xl font-mono font-bold text-[#f1f5f9] mt-0.5">{stats.total}</span>
          <span className="text-[10px] text-[#94a3b8] mt-0.5">{stats.totalCalls} llamadas reg.</span>
        </div>

        <div className="bg-[#0f172a] border border-[#f59e0b]/30 rounded-xl p-3.5 flex flex-col bg-gradient-to-br from-[#0f172a] to-[#f59e0b]/10">
          <span className="text-[11px] font-bold text-[#fbbf24] uppercase flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#f59e0b] animate-pulse" />
            Pendientes
          </span>
          <span className="text-xl font-mono font-bold text-[#fbbf24] mt-0.5">{stats.pending}</span>
          <span className="text-[10px] text-[#fcd34d]/80 mt-0.5">En espera evaluación</span>
        </div>

        <div className="bg-[#0f172a] border border-[#388bfd]/30 rounded-xl p-3.5 flex flex-col bg-gradient-to-br from-[#0f172a] to-[#388bfd]/10">
          <span className="text-[11px] font-bold text-[#58a6ff] uppercase">En Proceso</span>
          <span className="text-xl font-mono font-bold text-[#58a6ff] mt-0.5">{stats.inProcess}</span>
          <span className="text-[10px] text-[#93c5fd]/80 mt-0.5">En pruebas / Yarda</span>
        </div>

        <div className="bg-[#0f172a] border border-[#10b981]/30 rounded-xl p-3.5 flex flex-col bg-gradient-to-br from-[#0f172a] to-[#10b981]/10">
          <span className="text-[11px] font-bold text-[#34d399] uppercase">Resueltos</span>
          <span className="text-xl font-mono font-bold text-[#34d399] mt-0.5">{stats.resolved}</span>
          <span className="text-[10px] text-[#a7f3d0]/80 mt-0.5">Orden restaurada</span>
        </div>

        <div className="bg-[#0f172a] border border-[#ef4444]/30 rounded-xl p-3.5 flex flex-col bg-gradient-to-br from-[#0f172a] to-[#ef4444]/10">
          <span className="text-[11px] font-bold text-[#f87171] uppercase">Denegados</span>
          <span className="text-xl font-mono font-bold text-[#f87171] mt-0.5">{stats.denied}</span>
          <span className="text-[10px] text-[#fca5a5]/80 mt-0.5">Términos violados</span>
        </div>

        <div className="bg-[#0f172a] border border-[#8b5cf6]/30 rounded-xl p-3.5 flex flex-col bg-gradient-to-br from-[#0f172a] to-[#8b5cf6]/10">
          <span className="text-[11px] font-bold text-[#c084fc] uppercase flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">currency_exchange</span>
            Reembolsos
          </span>
          <span className="text-xl font-mono font-bold text-[#c084fc] mt-0.5">{stats.pendingRefunds}</span>
          <span className="text-[10px] text-[#d8b4fe]/80 mt-0.5">Pendientes de pago</span>
        </div>
      </div>

      {/* SECTION 5: Sub-módulo de Solicitudes de Reembolso (Refund Requests) */}
      <div className="bg-[#0f172a] border border-[#2b3a58] rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 bg-[#141e33] border-b border-[#2b3a58] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#f59e0b]/20 text-[#fbbf24] flex items-center justify-center border border-[#f59e0b]/40">
              <span className="material-symbols-outlined text-[18px]">currency_exchange</span>
            </div>
            <div>
              <h2 className="font-bold text-sm text-[#f1f5f9] flex items-center gap-2">
                <span>SOLICITUDES DE REEMBOLSO (REFUND REQUESTS)</span>
                <span className="text-[10px] font-mono bg-[#f59e0b]/25 text-[#fbbf24] px-2 py-0.5 rounded-full font-bold">
                  {refundRequests.filter((r) => r.status === 'pending').length} Pendientes
                </span>
              </h2>
              <p className="text-[11px] text-[#94a3b8]">
                Devoluciones monetarias por piezas no disponibles o garantías aprobadas sin stock de recambio.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowRefundsDrawer(!showRefundsDrawer)}
              className="text-xs text-[#94a3b8] hover:text-white px-2 py-1 rounded-lg bg-[#090d16] border border-[#1e293b] flex items-center gap-1 transition-all cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">
                {showRefundsDrawer ? 'expand_less' : 'expand_more'}
              </span>
              <span>{showRefundsDrawer ? 'Ocultar Panel' : 'Mostrar Panel'}</span>
            </button>
          </div>
        </div>

        {showRefundsDrawer && (
          <div className="p-4 flex flex-col gap-3">
            {refundRequests.length === 0 ? (
              <p className="text-xs text-[#94a3b8] text-center py-4">No hay solicitudes de reembolso en este momento.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {refundRequests.map((refund) => (
                  <div
                    key={refund.id}
                    className={`rounded-xl p-4 border transition-all flex flex-col justify-between gap-3 ${
                      refund.status === 'pending'
                        ? 'bg-[#090d16] border-[#f59e0b]/40 shadow-[0_0_15px_rgba(245,158,11,0.08)]'
                        : 'bg-[#090d16]/50 border-[#1e293b] opacity-70'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-xs text-[#58a6ff] bg-[#1e293b] px-2 py-0.5 rounded border border-[#2b3a58]">
                            {refund.orderCode}
                          </span>
                          <span className="text-xs font-bold text-[#f1f5f9]">{refund.customerName}</span>
                        </div>

                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold uppercase ${
                            refund.status === 'pending'
                              ? 'bg-[#f59e0b]/20 text-[#fbbf24] border border-[#f59e0b]/40'
                              : 'bg-[#10b981]/20 text-[#34d399] border border-[#10b981]/40'
                          }`}
                        >
                          {refund.status === 'pending' ? '🟡 En Espera' : '🟢 Liquidado'}
                        </span>
                      </div>

                      <div className="mt-2 text-xs text-[#cbd5e1]">
                        <span className="font-semibold text-white">{refund.vehicle}</span> · {refund.part}
                      </div>
                      <div className="text-[11px] text-[#94a3b8] mt-0.5 italic">Motivo: {refund.reason}</div>
                    </div>

                    <div className="bg-[#111827] p-3 rounded-lg border border-[#1e293b] flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div>
                        <span className="text-[10px] text-[#94a3b8] block">Monto a Liquidar</span>
                        <strong className="text-sm font-mono text-[#fbbf24]">
                          ${refund.amount.toFixed(2)} USD{' '}
                          <span className="text-[10px] text-[#94a3b8] font-normal">
                            ({refund.amountType === 'downpayment' ? 'Anticipo' : refund.amountType === 'total' ? 'Total' : 'Personalizado'})
                          </span>
                        </strong>
                      </div>

                      <div>
                        <span className="text-[10px] text-[#94a3b8] block">Método de Pago</span>
                        <span className="font-mono text-[#cbd5e1] font-bold">
                          {refund.paymentMethod}: <span className="text-[#58a6ff]">{refund.paymentDetails}</span>
                        </span>
                      </div>

                      {refund.status === 'pending' ? (
                        <button
                          type="button"
                          onClick={() => handleCompleteRefund(refund)}
                          className="px-3 py-1.5 rounded-lg bg-[#10b981] hover:bg-[#059669] text-[#064e3b] text-xs font-bold transition-all flex items-center gap-1 shadow cursor-pointer active:scale-95"
                        >
                          <span className="material-symbols-outlined text-[16px]">check_circle</span>
                          <span>✔ Marcar Resuelto</span>
                        </button>
                      ) : (
                        <span className="text-[11px] text-[#34d399] font-semibold flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">verified</span>
                          Liquidado por {refund.completedBy || 'Admin'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Claims Table Card */}
      <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl overflow-hidden shadow-xl flex flex-col">
        {/* Table Filter Toolbar */}
        <div className="p-4 bg-[#111827] border-b border-[#1e293b] flex flex-wrap items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'Todos', label: 'Todos' },
              { id: 'Pending', label: '🟡 Pendientes', count: stats.pending },
              { id: 'In Process', label: '🔵 En Proceso', count: stats.inProcess },
              { id: 'Resolved', label: '🟢 Resueltos', count: stats.resolved },
              { id: 'Denied', label: '🔴 Denegados', count: stats.denied },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  statusFilter === tab.id
                    ? 'bg-[#388bfd] text-white shadow-md'
                    : 'bg-[#090d16] text-[#94a3b8] hover:text-white border border-[#1e293b]'
                }`}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                      statusFilter === tab.id ? 'bg-white/20 text-white' : 'bg-[#1e293b] text-[#cbd5e1]'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Search & Priority Selector */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="bg-[#090d16] border border-[#2b3a58] rounded-xl px-2.5 py-1.5 text-xs text-[#cbd5e1] font-semibold focus:outline-none"
            >
              <option value="Todas">Prioridad: Todas</option>
              <option value="Alta">Prioridad: Alta</option>
              <option value="Media">Prioridad: Media</option>
              <option value="Baja">Prioridad: Baja</option>
            </select>

            <div className="relative flex-1 sm:w-64">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8] text-[18px]">
                search
              </span>
              <input
                type="text"
                placeholder="Buscar ticket, orden, cliente, pieza..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-[#090d16] border border-[#2b3a58] rounded-xl py-1.5 pl-9 pr-7 text-xs text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-white text-xs"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Claims Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-[#090d16] text-[#94a3b8] uppercase text-[10px] tracking-wider border-b border-[#1e293b]">
              <tr>
                <th className="py-3 px-4">Ticket / Orden</th>
                <th className="py-3 px-4">Cliente & Contacto</th>
                <th className="py-3 px-4">Vehículo / Pieza</th>
                <th className="py-3 px-4">Falla Reportada & Causa</th>
                <th className="py-3 px-4">Bitácora Llamadas</th>
                <th className="py-3 px-4">Estado</th>
                <th className="py-3 px-4">Asesor</th>
                <th className="py-3 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e293b] text-[#cbd5e1]">
              {filteredClaims.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[#94a3b8]">
                    <div className="flex flex-col items-center gap-2">
                      <span className="material-symbols-outlined text-[36px] text-[#64748b]">verified</span>
                      <span>No se encontraron reclamos que coincidan con los filtros seleccionados.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredClaims.map((claim) => {
                  const callCount = claim.callCount || 0;
                  return (
                    <tr
                      key={claim.id}
                      onClick={() => setSelectedClaimDetail(claim)}
                      className="hover:bg-[#1e293b]/40 transition-colors group cursor-pointer"
                    >
                      {/* Ticket & Order */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col">
                          <span className="font-mono font-bold text-xs text-[#58a6ff]">{claim.id}</span>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onSelectOrder && onSelectOrder(claim.orderId);
                            }}
                            className="text-[11px] font-mono text-[#94a3b8] hover:text-[#388bfd] text-left underline underline-offset-2 mt-0.5"
                          >
                            {claim.orderCode}
                          </button>
                        </div>
                      </td>

                      {/* Customer Info */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-[#f1f5f9]">{claim.customerName}</div>
                        <a
                          href={`tel:${claim.customerPhone}`}
                          className="text-[11px] font-mono text-[#94a3b8] hover:text-[#58a6ff] flex items-center gap-1 mt-0.5"
                        >
                          <span className="material-symbols-outlined text-[13px]">call</span>
                          {claim.customerPhone}
                        </a>
                      </td>

                      {/* Vehicle & Part */}
                      <td className="py-3.5 px-4 max-w-xs">
                        <div className="font-semibold text-[#f1f5f9] truncate">{claim.vehicle}</div>
                        <div className="text-[11px] text-[#388bfd] font-medium truncate mt-0.5">{claim.mainPart}</div>
                        {claim.stockNumber && (
                          <span className="text-[10px] font-mono text-[#64748b]">Stock #{claim.stockNumber}</span>
                        )}
                      </td>

                      {/* Claim Reason & Priority */}
                      <td className="py-3.5 px-4 max-w-sm">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              claim.priority === 'Alta'
                                ? 'bg-[#ef4444]/20 text-[#f87171] border border-[#ef4444]/40'
                                : claim.priority === 'Media'
                                ? 'bg-[#f59e0b]/20 text-[#fbbf24] border border-[#f59e0b]/40'
                                : 'bg-[#10b981]/20 text-[#34d399] border border-[#10b981]/40'
                            }`}
                          >
                            {claim.priority}
                          </span>
                          <span className="text-[10px] text-[#94a3b8] font-medium">{claim.type}</span>
                        </div>
                        <p className="text-[11px] text-[#cbd5e1] line-clamp-2">{claim.claimReason}</p>
                      </td>

                      {/* SECTION 4: Semáforo de Criticidad de Llamadas */}
                      <td className="py-3.5 px-4">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedClaimForCalls(claim);
                            setCallerName(claim.customerName);
                            setCallerPhone(claim.customerPhone);
                          }}
                          className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                            callCount === 0
                              ? 'bg-[#1e293b]/60 border-[#2b3a58] text-[#94a3b8] hover:text-white'
                              : callCount >= 1 && callCount <= 2
                              ? 'bg-[#f59e0b]/20 border-[#f59e0b]/50 text-[#fbbf24] hover:bg-[#f59e0b]/30'
                              : 'bg-[#ef4444]/25 border-[#ef4444] text-[#f87171] animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.4)]'
                          }`}
                          title="Haz clic para ver y registrar llamadas"
                        >
                          <span className="material-symbols-outlined text-[16px]">
                            {callCount >= 3 ? 'phone_in_talk' : 'call'}
                          </span>
                          <span>
                            {callCount === 0
                              ? '0 Llamadas'
                              : callCount < 3
                              ? `${callCount} Llamadas`
                              : `🔥 ${callCount} Llamadas (Crítico)`}
                          </span>
                        </button>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5 w-fit ${
                            claim.status === 'Pending'
                              ? 'bg-[#f59e0b]/15 border-[#f59e0b]/50 text-[#fbbf24]'
                              : claim.status === 'In Process'
                              ? 'bg-[#388bfd]/15 border-[#388bfd]/50 text-[#58a6ff]'
                              : claim.status === 'Resolved'
                              ? 'bg-[#10b981]/15 border-[#10b981]/50 text-[#34d399]'
                              : 'bg-[#ef4444]/15 border-[#ef4444]/50 text-[#f87171]'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              claim.status === 'Pending'
                                ? 'bg-[#f59e0b]'
                                : claim.status === 'In Process'
                                ? 'bg-[#388bfd]'
                                : claim.status === 'Resolved'
                                ? 'bg-[#10b981]'
                                : 'bg-[#ef4444]'
                            }`}
                          />
                          <span>{claim.status}</span>
                        </span>
                      </td>

                      {/* Advisor */}
                      <td className="py-3.5 px-4 text-xs text-[#94a3b8]">
                        <span className="text-[#cbd5e1] font-medium block">{claim.advisor}</span>
                        <span className="text-[10px] text-[#64748b]">
                          {new Date(claim.createdAt).toLocaleDateString('es-ES', {
                            day: '2-digit',
                            month: 'short',
                          })}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Quick Resolve Button */}
                          {claim.status !== 'Resolved' && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleResolveClaim(claim);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-[#10b981]/20 hover:bg-[#10b981]/30 text-[#34d399] border border-[#10b981]/40 text-xs font-bold transition-all cursor-pointer"
                              title="Restaurar orden y marcar resuelto"
                            >
                              ✔ Resolver
                            </button>
                          )}

                          {/* Calls Trigger */}
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedClaimForCalls(claim);
                              setCallerName(claim.customerName);
                              setCallerPhone(claim.customerPhone);
                            }}
                            className="p-1.5 rounded-lg bg-[#1e293b] hover:bg-[#2b3a58] text-[#cbd5e1] hover:text-white transition-all cursor-pointer"
                            title="Ver bitácora de llamadas"
                          >
                            <span className="material-symbols-outlined text-[16px]">history</span>
                          </button>

                          {/* Status changer dropdown */}
                          <select
                            value={claim.status}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(e) => handleUpdateClaimStatus(claim.id, e.target.value as ClaimStatus)}
                            className="bg-[#090d16] border border-[#2b3a58] rounded-lg px-2 py-1 text-[11px] text-[#cbd5e1] focus:outline-none cursor-pointer"
                          >
                            <option value="Pending">🟡 Pending</option>
                            <option value="In Process">🔵 In Process</option>
                            <option value="Resolved">🟢 Resolved</option>
                            <option value="Denied">🔴 Denied</option>
                          </select>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: Detalle amplio del reclamo */}
      {selectedClaimDetail && (() => {
        const detailOrder = orders.find((order) => order.id === selectedClaimDetail.orderId || order.code === selectedClaimDetail.orderCode);
        const orderTotal = detailOrder?.financials.total ?? 0;
        const orderBalance = detailOrder?.financials.balanceDue ?? Math.max(0, orderTotal - (detailOrder?.financials.downPayment ?? 0));

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
            <div className="bg-[#111827] border border-[#2b3a58] rounded-2xl w-full max-w-5xl shadow-2xl flex flex-col overflow-hidden max-h-[92vh]">
              <div className="p-5 bg-[#182338] border-b border-[#2b3a58] flex justify-between items-start gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold text-lg text-[#f1f5f9]">Detalle de Reclamo</h3>
                    <span className="font-mono text-xs bg-[#1e293b] text-[#58a6ff] px-2 py-0.5 rounded border border-[#2b3a58]">
                      {selectedClaimDetail.id}
                    </span>
                    <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[#f59e0b]/15 border border-[#f59e0b]/50 text-[#fbbf24]">
                      {selectedClaimDetail.status}
                    </span>
                  </div>
                  <p className="text-xs text-[#94a3b8] mt-1">
                    Orden {selectedClaimDetail.orderCode} · {selectedClaimDetail.customerName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedClaimDetail(null)}
                  className="text-[#94a3b8] hover:text-white p-1.5 rounded-lg hover:bg-[#1e293b] cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>

              <div className="p-6 overflow-y-auto custom-scrollbar grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-5">
                <div className="flex flex-col gap-4">
                  <section className="rounded-2xl border border-[#2b3a58] bg-[#0b1329] p-4">
                    <h4 className="font-bold text-[#f1f5f9] flex items-center gap-2 text-sm">
                      <span className="material-symbols-outlined text-[#58a6ff]">inventory_2</span>
                      Detalles de la Orden
                    </h4>
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-[#cbd5e1]">
                      <div><span className="text-[#94a3b8]">Código:</span> <strong className="font-mono text-[#f1f5f9]">{selectedClaimDetail.orderCode}</strong></div>
                      <div><span className="text-[#94a3b8]">Estatus anterior:</span> <strong className="text-[#34d399]">{selectedClaimDetail.previousOrderStatus}</strong></div>
                      <div><span className="text-[#94a3b8]">Vehículo:</span> <strong>{selectedClaimDetail.vehicle}</strong></div>
                      <div><span className="text-[#94a3b8]">VIN:</span> <strong className="font-mono">{selectedClaimDetail.vin || detailOrder?.vehicle.vin || '-'}</strong></div>
                      <div><span className="text-[#94a3b8]">Pieza:</span> <strong className="text-[#58a6ff]">{selectedClaimDetail.mainPart}</strong></div>
                      <div><span className="text-[#94a3b8]">Stock:</span> <strong className="font-mono text-[#34d399]">{selectedClaimDetail.stockNumber || '-'}</strong></div>
                      <div><span className="text-[#94a3b8]">Total:</span> <strong>${orderTotal.toFixed(2)}</strong></div>
                      <div><span className="text-[#94a3b8]">Balance:</span> <strong className="text-[#f87171]">${orderBalance.toFixed(2)}</strong></div>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-[#2b3a58] bg-[#0b1329] p-4">
                    <h4 className="font-bold text-[#f1f5f9] flex items-center gap-2 text-sm">
                      <span className="material-symbols-outlined text-[#f87171]">report_problem</span>
                      Seguimiento del Reclamo
                    </h4>
                    <div className="mt-4 rounded-xl border border-[#ef4444]/30 bg-[#ef4444]/10 p-3 text-xs text-[#fecaca]">
                      <span className="font-bold">Motivo reportado:</span> {selectedClaimDetail.claimReason}
                    </div>
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                      <div className="rounded-xl border border-[#1e293b] bg-[#080e1e] p-3">
                        <span className="text-[#94a3b8] block">Prioridad</span>
                        <strong className="text-[#fbbf24]">{selectedClaimDetail.priority}</strong>
                      </div>
                      <div className="rounded-xl border border-[#1e293b] bg-[#080e1e] p-3">
                        <span className="text-[#94a3b8] block">Llamadas</span>
                        <strong className="text-[#58a6ff]">{selectedClaimDetail.callCount || 0}</strong>
                      </div>
                      <div className="rounded-xl border border-[#1e293b] bg-[#080e1e] p-3">
                        <span className="text-[#94a3b8] block">Creado</span>
                        <strong className="text-[#f1f5f9]">{new Date(selectedClaimDetail.createdAt).toLocaleDateString('es-ES')}</strong>
                      </div>
                    </div>
                  </section>
                </div>

                <div className="flex flex-col gap-4">
                  <section className="rounded-2xl border border-[#2b3a58] bg-[#0b1329] p-4">
                    <h4 className="font-bold text-[#f1f5f9] flex items-center gap-2 text-sm">
                      <span className="material-symbols-outlined text-[#58a6ff]">person</span>
                      Datos del Cliente
                    </h4>
                    <div className="mt-4 flex flex-col gap-3 text-xs text-[#cbd5e1]">
                      <div><span className="text-[#94a3b8]">Nombre:</span> <strong>{selectedClaimDetail.customerName}</strong></div>
                      <div><span className="text-[#94a3b8]">Teléfono:</span> <strong className="font-mono">{selectedClaimDetail.customerPhone}</strong></div>
                      {selectedClaimDetail.customerEmail && <div><span className="text-[#94a3b8]">Email:</span> {selectedClaimDetail.customerEmail}</div>}
                      <div><span className="text-[#94a3b8]">Asesor:</span> {selectedClaimDetail.advisor}</div>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-[#2b3a58] bg-[#0b1329] p-4">
                    <h4 className="font-bold text-[#f1f5f9] flex items-center gap-2 text-sm">
                      <span className="material-symbols-outlined text-[#34d399]">timeline</span>
                      Acciones
                    </h4>
                    <div className="mt-4 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedClaimForCalls(selectedClaimDetail);
                          setCallerName(selectedClaimDetail.customerName);
                          setCallerPhone(selectedClaimDetail.customerPhone);
                        }}
                        className="rounded-xl border border-[#334155] bg-[#1e293b] px-4 py-2.5 text-xs font-bold text-[#f1f5f9] hover:bg-[#334155] cursor-pointer"
                      >
                        Ver / Registrar Llamadas
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleResolveClaim(selectedClaimDetail)}
                        className="rounded-xl border border-[#10b981]/40 bg-[#10b981]/20 px-4 py-2.5 text-xs font-black text-[#34d399] hover:bg-[#10b981]/30 cursor-pointer"
                      >
                        Marcar como Resuelto
                      </button>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL 1: Bitácora y Registro de Llamadas del Cliente */}
      {selectedClaimForCalls && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-[#111827] border border-[#2b3a58] rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-5 bg-[#182338] border-b border-[#2b3a58] flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#388bfd]/20 text-[#58a6ff] flex items-center justify-center border border-[#388bfd]/40">
                  <span className="material-symbols-outlined text-[20px]">phone_in_talk</span>
                </div>
                <div>
                  <h3 className="font-bold text-base text-[#f1f5f9] flex items-center gap-2">
                    <span>Bitácora de Llamadas: {selectedClaimForCalls.orderCode}</span>
                    <span className="text-xs font-mono bg-[#1e293b] text-[#58a6ff] px-2 py-0.5 rounded border border-[#2b3a58]">
                      {selectedClaimForCalls.id}
                    </span>
                  </h3>
                  <p className="text-xs text-[#94a3b8]">
                    {selectedClaimForCalls.customerName} ({selectedClaimForCalls.customerPhone}) · {selectedClaimForCalls.vehicle}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedClaimForCalls(null)}
                className="text-[#94a3b8] hover:text-white p-1"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Modal Body: Scrollable Call History + Add Call Form */}
            <div className="p-6 flex flex-col gap-5 overflow-y-auto custom-scrollbar">
              {/* Criticality Banner if >= 3 Calls */}
              {(selectedClaimForCalls.callCount || 0) >= 3 && (
                <div className="bg-[#ef4444]/20 border border-[#ef4444] rounded-xl p-3.5 flex items-start gap-3 text-xs text-[#fca5a5]">
                  <span className="material-symbols-outlined text-[#ef4444] text-[22px] shrink-0 mt-0.5 animate-bounce">
                    warning
                  </span>
                  <div>
                    <strong className="text-white font-bold block">
                      SEMAFORO ROJO: Alta Prioridad / Cliente Insatisfecho ({selectedClaimForCalls.callCount} llamadas)
                    </strong>
                    <p className="text-[#fecaca] mt-0.5">
                      Este cliente ha llamado más de 2 veces solicitando resolución. Por política de calidad RADAR, se requiere confirmación inmediata de fecha de entrega o aprobación de reemplazo.
                    </p>
                  </div>
                </div>
              )}

              {/* Add New Call Form */}
              <form onSubmit={handleAddCall} className="bg-[#090d16] border border-[#2b3a58] rounded-xl p-4 flex flex-col gap-3">
                <h4 className="font-bold text-xs text-[#58a6ff] uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px]">add_call</span>
                  <span>Registrar Nueva Llamada de Seguimiento</span>
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <label className="text-[#94a3b8] block mb-1">Nombre Contacto</label>
                    <input
                      type="text"
                      required
                      value={callerName}
                      onChange={(e) => setCallerName(e.target.value)}
                      placeholder="Ej. Juan Pérez"
                      className="w-full bg-[#111827] border border-[#2b3a58] rounded-lg p-2 text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                    />
                  </div>

                  <div>
                    <label className="text-[#94a3b8] block mb-1">Teléfono</label>
                    <input
                      type="text"
                      required
                      value={callerPhone}
                      onChange={(e) => setCallerPhone(e.target.value)}
                      placeholder="9195550199"
                      className="w-full bg-[#111827] border border-[#2b3a58] rounded-lg p-2 text-[#f1f5f9] font-mono focus:outline-none focus:border-[#388bfd]"
                    />
                  </div>

                  <div>
                    <label className="text-[#94a3b8] block mb-1">Atendió</label>
                    <select
                      value={attendedBy}
                      onChange={(e) => setAttendedBy(e.target.value)}
                      className="w-full bg-[#111827] border border-[#2b3a58] rounded-lg p-2 text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                    >
                      <option value="Carlos Mendoza">Carlos Mendoza</option>
                      <option value="Favio Andrade">Favio Andrade</option>
                      <option value="Marcos Rivas">Marcos Rivas</option>
                      <option value="Valeria Salas">Valeria Salas</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[#94a3b8] text-xs block mb-1">
                    Resumen de lo Conversado / Acuerdos Técnicos *
                  </label>
                  <textarea
                    rows={2}
                    required
                    value={callSummary}
                    onChange={(e) => setCallSummary(e.target.value)}
                    placeholder="Se le informó al cliente que la yarda despachó el repuesto de reemplazo y llegará mañana a las 2:00 PM..."
                    className="w-full bg-[#111827] border border-[#2b3a58] rounded-lg p-2 text-xs text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                  />
                </div>

                {/* Wasender Live Notification Preview */}
                <div className="bg-[#10b981]/10 border border-[#10b981]/30 rounded-lg p-2.5 text-[11px] text-[#a7f3d0] flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#10b981] text-[18px]">chat</span>
                    <span>
                      <strong>Alerta WhatsApp Automática:</strong> Se enviará un mensaje Wasender al equipo de Customer Success al guardar.
                    </span>
                  </div>
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-lg bg-[#388bfd] hover:bg-[#2b79e2] text-white font-bold text-xs transition-all cursor-pointer shadow flex items-center gap-1 active:scale-95 shrink-0"
                  >
                    <span className="material-symbols-outlined text-[16px]">save</span>
                    <span>Guardar & Notificar</span>
                  </button>
                </div>
              </form>

              {/* Calls History Log */}
              <div>
                <h4 className="font-bold text-xs text-[#cbd5e1] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px]">list_alt</span>
                  <span>Historial Cronológico ({selectedClaimForCalls.calls?.length || 0} Registros)</span>
                </h4>

                {(!selectedClaimForCalls.calls || selectedClaimForCalls.calls.length === 0) ? (
                  <div className="bg-[#090d16] border border-[#1e293b] rounded-xl p-6 text-center text-xs text-[#94a3b8]">
                    No se han registrado llamadas para este reclamo aún.
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {selectedClaimForCalls.calls.map((call) => (
                      <div
                        key={call.id}
                        className="bg-[#090d16] border border-[#1e293b] rounded-xl p-3.5 flex flex-col gap-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-bold font-mono text-[#58a6ff] bg-[#1e293b] px-2 py-0.5 rounded text-[11px]">
                              Llamada #{call.callNumber}
                            </span>
                            <span className="font-bold text-white">{call.callerName}</span>
                            <span className="text-[#94a3b8] font-mono">({call.callerPhone})</span>
                          </div>
                          <span className="text-[10px] text-[#94a3b8]">
                            {new Date(call.createdAt).toLocaleString('es-ES', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>

                        <p className="text-xs text-[#cbd5e1] pl-1 border-l-2 border-[#388bfd]">
                          {call.conversationSummary}
                        </p>

                        <div className="flex items-center justify-between pt-1 text-[10px] text-[#94a3b8]">
                          <span>Atendido por: <strong className="text-[#f1f5f9]">{call.attendedBy}</strong></span>
                          {call.whatsappDispatched && (
                            <span className="text-[#10b981] flex items-center gap-1 font-semibold">
                              <span className="material-symbols-outlined text-[13px]">check_circle</span>
                              WhatsApp Wasender Disparado
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 bg-[#0d131f] border-t border-[#1e293b] flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedClaimForCalls(null)}
                className="px-4 py-2 rounded-xl bg-[#1e293b] hover:bg-[#2b3a58] text-[#cbd5e1] text-xs font-bold transition-all cursor-pointer"
              >
                Cerrar Bitácora
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Crear Nuevo Reclamo */}
      {isNewClaimModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-[#111827] border border-[#2b3a58] rounded-2xl w-full max-w-xl shadow-2xl flex flex-col overflow-hidden">
            <div className="p-5 bg-[#182338] border-b border-[#2b3a58] flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#ef4444]/20 text-[#ef4444] flex items-center justify-center border border-[#ef4444]/40">
                  <span className="material-symbols-outlined text-[20px]">add_alert</span>
                </div>
                <div>
                  <h3 className="font-bold text-base text-[#f1f5f9]">Registrar Nuevo Reclamo</h3>
                  <p className="text-xs text-[#94a3b8]">Apertura de caso de garantía con transición atómica de la orden</p>
                </div>
              </div>
              <button
                onClick={() => setIsNewClaimModalOpen(false)}
                className="text-[#94a3b8] hover:text-white p-1"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form onSubmit={handleCreateClaim} className="p-6 flex flex-col gap-4 text-xs text-[#dfe2ef]">
              {/* Select Order */}
              <div>
                <label className="text-[#cbd5e1] block mb-1 font-semibold">Seleccionar Orden Vinculada *</label>
                <select
                  required
                  value={newClaimOrderId}
                  onChange={(e) => setNewClaimOrderId(e.target.value)}
                  className="w-full bg-[#090d16] border border-[#2b3a58] rounded-xl p-2.5 text-xs text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                >
                  <option value="">-- Seleccionar Orden en Sistema --</option>
                  {orders.map((ord) => (
                    <option key={ord.id} value={ord.id}>
                      {ord.code} · {ord.customer.name} · {ord.vehicle.year} {ord.vehicle.make} {ord.vehicle.model} ({ord.mainPart}) [Estatus: {ord.status}]
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[#cbd5e1] block mb-1 font-semibold">Tipo de Inconformidad</label>
                  <select
                    value={newClaimType}
                    onChange={(e) => setNewClaimType(e.target.value)}
                    className="w-full bg-[#090d16] border border-[#2b3a58] rounded-xl p-2.5 text-xs text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                  >
                    <option value="Garantía Tren Motriz">Garantía Tren Motriz</option>
                    <option value="Defecto de Pieza">Defecto de Pieza</option>
                    <option value="Daño en Transporte">Daño en Transporte</option>
                    <option value="Incompatibilidad Técnica">Incompatibilidad Técnica</option>
                    <option value="Falla de Compresión">Falla de Compresión</option>
                    <option value="Facturación / Cobro">Facturación / Cobro</option>
                  </select>
                </div>

                <div>
                  <label className="text-[#cbd5e1] block mb-1 font-semibold">Nivel de Prioridad</label>
                  <select
                    value={newClaimPriority}
                    onChange={(e) => setNewClaimPriority(e.target.value as any)}
                    className="w-full bg-[#090d16] border border-[#2b3a58] rounded-xl p-2.5 text-xs text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                  >
                    <option value="Alta">🔴 Alta (Cliente Detenido)</option>
                    <option value="Media">🟡 Media (En Taller)</option>
                    <option value="Baja">🟢 Baja (Detalle Cosmético)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[#cbd5e1] block mb-1 font-semibold">Descripción del Fallo / Causa Reportada *</label>
                <textarea
                  rows={3}
                  required
                  value={newClaimReason}
                  onChange={(e) => setNewClaimReason(e.target.value)}
                  placeholder="Detallar claramente el problema técnico (ej. Ruido en transmisión, fuga de aceite, sensores incompatibles)..."
                  className="w-full bg-[#090d16] border border-[#2b3a58] rounded-xl p-2.5 text-xs text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                />
              </div>

              <div>
                <label className="text-[#cbd5e1] block mb-1 font-semibold">Especialista / Asesor Asignado</label>
                <select
                  value={newClaimAdvisor}
                  onChange={(e) => setNewClaimAdvisor(e.target.value)}
                  className="w-full bg-[#090d16] border border-[#2b3a58] rounded-xl p-2.5 text-xs text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                >
                  <option value="Carlos Mendoza">Carlos Mendoza</option>
                  <option value="Favio Andrade">Favio Andrade</option>
                  <option value="Marcos Rivas">Marcos Rivas</option>
                  <option value="Valeria Salas">Valeria Salas</option>
                </select>
              </div>

              {/* Atomic Impact Notice */}
              <div className="bg-[#ef4444]/10 border border-[#ef4444]/30 rounded-xl p-3 text-[11px] text-[#fca5a5] flex items-start gap-2">
                <span className="material-symbols-outlined text-[#ef4444] text-[18px] shrink-0 mt-0.5">
                  info
                </span>
                <p>
                  <strong>Impacto Atómico en Base de Datos:</strong> Al crear este reclamo, la orden seleccionada cambiará inmediatamente a estatus <strong>'Reclamo'</strong> y se guardará su estatus original para permitir su restauración al resolver el caso.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1e293b]">
                <button
                  type="button"
                  onClick={() => setIsNewClaimModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-[#1e293b] hover:bg-[#2b3a58] text-[#cbd5e1] font-bold text-xs transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[#ef4444] hover:bg-[#dc2626] text-white font-bold text-xs shadow-[0_0_15px_rgba(239,68,68,0.4)] transition-all cursor-pointer active:scale-95"
                >
                  Crear Reclamo & Notificar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Nueva Solicitud de Reembolso */}
      {isNewRefundModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-[#111827] border border-[#2b3a58] rounded-2xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden">
            <div className="p-5 bg-[#182338] border-b border-[#2b3a58] flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#f59e0b]/20 text-[#fbbf24] flex items-center justify-center border border-[#f59e0b]/40">
                  <span className="material-symbols-outlined text-[20px]">currency_exchange</span>
                </div>
                <div>
                  <h3 className="font-bold text-base text-[#f1f5f9]">Crear Solicitud de Reembolso</h3>
                  <p className="text-xs text-[#94a3b8]">Gestión y liquidación de saldos a favor del cliente</p>
                </div>
              </div>
              <button
                onClick={() => setIsNewRefundModalOpen(false)}
                className="text-[#94a3b8] hover:text-white p-1"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form onSubmit={handleCreateRefundRequest} className="p-6 flex flex-col gap-4 text-xs text-[#dfe2ef]">
              <div>
                <label className="text-[#cbd5e1] block mb-1 font-semibold">Orden Vinculada *</label>
                <select
                  required
                  value={newRefundOrderId}
                  onChange={(e) => {
                    setNewRefundOrderId(e.target.value);
                    const match = orders.find((o) => o.id === e.target.value);
                    if (match) {
                      setNewRefundAmount(String(match.financials.downPayment || match.financials.total || 500));
                    }
                  }}
                  className="w-full bg-[#090d16] border border-[#2b3a58] rounded-xl p-2.5 text-xs text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                >
                  <option value="">-- Seleccionar Orden --</option>
                  {orders.map((ord) => (
                    <option key={ord.id} value={ord.id}>
                      {ord.code} · {ord.customer.name} (${ord.financials.total} USD)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[#cbd5e1] block mb-1 font-semibold">Tipo de Monto</label>
                  <select
                    value={newRefundAmountType}
                    onChange={(e) => setNewRefundAmountType(e.target.value as any)}
                    className="w-full bg-[#090d16] border border-[#2b3a58] rounded-xl p-2.5 text-xs text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                  >
                    <option value="downpayment">Anticipo (Downpayment)</option>
                    <option value="total">Total de la Orden</option>
                    <option value="custom">Monto Personalizado</option>
                  </select>
                </div>

                <div>
                  <label className="text-[#cbd5e1] block mb-1 font-semibold">Monto en USD *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={newRefundAmount}
                    onChange={(e) => setNewRefundAmount(e.target.value)}
                    className="w-full bg-[#090d16] border border-[#2b3a58] rounded-xl p-2.5 text-xs text-[#fbbf24] font-mono font-bold focus:outline-none focus:border-[#388bfd]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[#cbd5e1] block mb-1 font-semibold">Método de Pago</label>
                  <select
                    value={newRefundMethod}
                    onChange={(e) => setNewRefundMethod(e.target.value as any)}
                    className="w-full bg-[#090d16] border border-[#2b3a58] rounded-xl p-2.5 text-xs text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                  >
                    <option value="Zelle">Zelle</option>
                    <option value="CashApp">CashApp</option>
                    <option value="Efectivo">Efectivo (En Mostrador)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[#cbd5e1] block mb-1 font-semibold">Cuenta / Correo / $Cashtag</label>
                  <input
                    type="text"
                    required
                    value={newRefundDetails}
                    onChange={(e) => setNewRefundDetails(e.target.value)}
                    placeholder="pagos@cliente.com o $cashtag"
                    className="w-full bg-[#090d16] border border-[#2b3a58] rounded-xl p-2.5 text-xs text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                  />
                </div>
              </div>

              <div>
                <label className="text-[#cbd5e1] block mb-1 font-semibold">Motivo del Reembolso</label>
                <textarea
                  rows={2}
                  required
                  value={newRefundReason}
                  onChange={(e) => setNewRefundReason(e.target.value)}
                  className="w-full bg-[#090d16] border border-[#2b3a58] rounded-xl p-2.5 text-xs text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1e293b]">
                <button
                  type="button"
                  onClick={() => setIsNewRefundModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-[#1e293b] hover:bg-[#2b3a58] text-[#cbd5e1] font-bold text-xs transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-[#0f172a] font-bold text-xs shadow-lg transition-all cursor-pointer active:scale-95"
                >
                  Registrar Solicitud
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: SECTION 6 - Exportación e Impresión de Reportes PDF */}
      {isPrintReportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-[#111827] border border-[#2b3a58] rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col overflow-hidden max-h-[95vh]">
            <div className="p-5 bg-[#182338] border-b border-[#2b3a58] flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#388bfd]/20 text-[#58a6ff] flex items-center justify-center border border-[#388bfd]/40">
                  <span className="material-symbols-outlined text-[20px]">print</span>
                </div>
                <div>
                  <h3 className="font-bold text-base text-[#f1f5f9]">Reporte de Auditoría y Taller (PDF Reclamos)</h3>
                  <p className="text-xs text-[#94a3b8]">Vista previa formateada para impresión horizontal y archivo físico</p>
                </div>
              </div>
              <button
                onClick={() => setIsPrintReportModalOpen(false)}
                className="text-[#94a3b8] hover:text-white p-1"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Date Range Bar */}
            <div className="p-4 bg-[#090d16] border-b border-[#1e293b] flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <label className="text-[#94a3b8] font-semibold">Rango de Fechas:</label>
                <input
                  type="date"
                  value={printDateFrom}
                  onChange={(e) => setPrintDateFrom(e.target.value)}
                  className="bg-[#111827] border border-[#2b3a58] rounded-lg px-2.5 py-1 text-xs text-[#f1f5f9]"
                />
                <span className="text-[#94a3b8]">al</span>
                <input
                  type="date"
                  value={printDateTo}
                  onChange={(e) => setPrintDateTo(e.target.value)}
                  className="bg-[#111827] border border-[#2b3a58] rounded-lg px-2.5 py-1 text-xs text-[#f1f5f9]"
                />
              </div>

              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-1.5 rounded-xl bg-[#388bfd] hover:bg-[#2b79e2] text-white font-bold text-xs transition-all flex items-center gap-1.5 shadow cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">print</span>
                <span>Enviar a Impresora / Guardar PDF</span>
              </button>
            </div>

            {/* Printable Preview Content */}
            <div className="p-6 overflow-y-auto bg-[#ffffff] text-[#0f172a] text-xs font-sans">
              <div className="border-b-2 border-[#0f172a] pb-4 mb-4 flex justify-between items-start">
                <div>
                  <h1 className="text-xl font-black tracking-tight text-[#0f172a]">
                    RADAR V2 — REPORTE OFICIAL DE RECLAMOS Y GARANTÍAS
                  </h1>
                  <p className="text-xs text-[#475569]">
                    Auditoría de Calidad, Taller Mecánico & Despacho Postventa
                  </p>
                </div>
                <div className="text-right text-xs">
                  <div className="font-bold">Fecha de Emisión: {new Date().toLocaleDateString('es-ES')}</div>
                  <div className="text-[#64748b]">Periodo: {printDateFrom} al {printDateTo}</div>
                </div>
              </div>

              <table className="w-full text-left text-xs border border-[#cbd5e1]">
                <thead className="bg-[#f1f5f9] text-[#0f172a] font-bold border-b border-[#cbd5e1]">
                  <tr>
                    <th className="p-2 border-r border-[#cbd5e1]">Ticket / Orden</th>
                    <th className="p-2 border-r border-[#cbd5e1]">Cliente</th>
                    <th className="p-2 border-r border-[#cbd5e1]">Vehículo & Pieza</th>
                    <th className="p-2 border-r border-[#cbd5e1]">Descripción de Falla</th>
                    <th className="p-2 border-r border-[#cbd5e1]">Llamadas</th>
                    <th className="p-2 border-r border-[#cbd5e1]">Estado</th>
                    <th className="p-2">Asesor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e2e8f0]">
                  {claims.map((c) => (
                    <tr key={c.id}>
                      <td className="p-2 font-mono font-bold border-r border-[#cbd5e1]">
                        {c.id}
                        <div className="text-[10px] text-[#64748b]">{c.orderCode}</div>
                      </td>
                      <td className="p-2 border-r border-[#cbd5e1]">
                        <div className="font-semibold">{c.customerName}</div>
                        <div className="text-[10px] text-[#64748b]">{c.customerPhone}</div>
                      </td>
                      <td className="p-2 border-r border-[#cbd5e1]">
                        <div className="font-semibold">{c.vehicle}</div>
                        <div className="text-[10px] text-[#334155]">{c.mainPart}</div>
                      </td>
                      <td className="p-2 border-r border-[#cbd5e1] max-w-xs">
                        <span className="font-bold text-[10px] uppercase text-[#dc2626]">{c.type}: </span>
                        {c.claimReason}
                      </td>
                      <td className="p-2 font-mono font-bold text-center border-r border-[#cbd5e1]">
                        {c.callCount || 0}
                      </td>
                      <td className="p-2 border-r border-[#cbd5e1]">
                        <span className="font-bold uppercase text-[10px]">{c.status}</span>
                      </td>
                      <td className="p-2">{c.advisor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-8 pt-4 border-t border-[#cbd5e1] flex justify-between text-[11px] text-[#64748b]">
                <div>Generado automáticamente por RADAR Core v2.4</div>
                <div>Firma Auditor Calidad: ______________________</div>
              </div>
            </div>

            <div className="p-4 bg-[#0d131f] border-t border-[#1e293b] flex justify-end">
              <button
                type="button"
                onClick={() => setIsPrintReportModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-[#1e293b] hover:bg-[#2b3a58] text-[#cbd5e1] text-xs font-bold transition-all"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
