import React, { useEffect, useMemo, useState } from 'react';
import { Order, Claim, ClaimCall, RefundRequest, ClaimStatus } from '../types';
import { apiFetch } from '../services/apiFetch';
import { ClaimDetailView } from './ClaimDetailView';
import { RefundRequestView } from './RefundRequestView';

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

  const fetchClaimsAndRefunds = () => {
    apiFetch('/claims')
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then(setClaims)
      .catch(() => setClaims([]));

    apiFetch('/refunds')
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then(setRefundRequests)
      .catch(() => setRefundRequests([]));
  };

  useEffect(() => {
    fetchClaimsAndRefunds();
  }, []);

  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('Todos');
  const [priorityFilter, setPriorityFilter] = useState<string>('Todas');
  const [showRefundsDrawer, setShowRefundsDrawer] = useState(true);

  // Modals & View State
  const [isNewClaimModalOpen, setIsNewClaimModalOpen] = useState(false);
  const [isNewRefundModalOpen, setIsNewRefundModalOpen] = useState(false);
  const [selectedOrderForRefund, setSelectedOrderForRefund] = useState<Order | null>(null);
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
  const handleCreateClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetOrder = orders.find((o) => o.id === newClaimOrderId || o.code === newClaimOrderId);
    if (!targetOrder) {
      showToast('Por favor selecciona una orden válida para el reclamo.');
      return;
    }

    try {
      const response = await apiFetch('/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: targetOrder.id,
          description: newClaimReason,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || 'Error al crear reclamo');
      }

      const createdClaim = await response.json();
      setClaims((prev) => [createdClaim, ...prev]);

      if (onUpdateOrder) {
        onUpdateOrder({
          ...targetOrder,
          status: 'reclamo',
          claimReason: newClaimReason,
        });
      }

      setIsNewClaimModalOpen(false);
      setNewClaimReason('');
      setNewClaimOrderId('');

      showToast(`🚨 Reclamo ${createdClaim.id} creado en radar_db. Orden ${targetOrder.code} pasó a estatus 'Reclamo'.`);
    } catch (err: any) {
      showToast(`Error: ${err.message || 'No se pudo crear el reclamo'}`);
    }
  };

  // 2. ATOMIC WORKFLOW: Mark Claim as Resolved (Restore Order Status)
  const handleResolveClaim = async (claim: Claim) => {
    try {
      const response = await apiFetch(`/claims/${claim.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'Resolved',
          orderId: Number(claim.orderId),
          previousOrderStatus: claim.previousOrderStatus || 'entregado',
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || 'No se pudo resolver el reclamo');
      }

      setClaims((currentClaims) =>
        currentClaims.map((c) =>
          c.id === claim.id
            ? {
                ...c,
                status: 'Resolved' as ClaimStatus,
                resolvedAt: new Date().toISOString(),
                resolutionNotes: `Resuelto y orden restaurada a '${claim.previousOrderStatus || 'entregado'}'.`,
              }
            : c
        )
      );
      setSelectedClaimDetail(null);
      setSelectedClaimForCalls(null);

      const targetOrder = orders.find((o) => o.id === claim.orderId || o.code === claim.orderCode);
      if (targetOrder && onUpdateOrder) {
        onUpdateOrder({
          ...targetOrder,
          status: claim.previousOrderStatus || 'entregado',
          claimReason: undefined,
        });
      }

      showToast(`🟢 Reclamo ${claim.id} resuelto. Orden ${claim.orderCode} restaurada atómicamente a '${claim.previousOrderStatus || 'Entregado'}'.`);
    } catch (err: any) {
      showToast(`Error: ${err.message || 'No se pudo resolver el reclamo'}`);
    }
  };

  // 3. ATOMIC WORKFLOW: Deny Claim
  const handleDenyClaim = async (claim: Claim) => {
    if (!window.confirm(`¿Estás seguro de denegar la garantía del reclamo ${claim.id}? Esta acción anula la póliza por incumplimiento de términos.`)) {
      return;
    }

    try {
      const response = await apiFetch(`/claims/${claim.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'Denied',
          orderId: Number(claim.orderId),
          previousOrderStatus: claim.previousOrderStatus || 'entregado',
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || 'Error al denegar el reclamo');
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
    } catch (err: any) {
      showToast(`Error: ${err.message || 'No se pudo denegar el reclamo'}`);
    }
  };

  // 4. ATOMIC WORKFLOW: Update Claim Status
  const handleUpdateClaimStatus = async (claimId: string, newStatus: ClaimStatus) => {
    const claim = claims.find((c) => c.id === claimId);
    if (!claim) return;

    if (newStatus === 'Resolved') {
      void handleResolveClaim(claim);
      return;
    }

    if (newStatus === 'Denied') {
      void handleDenyClaim(claim);
      return;
    }

    try {
      const response = await apiFetch(`/claims/${claimId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          orderId: Number(claim.orderId),
          previousOrderStatus: claim.previousOrderStatus || 'entregado',
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || 'Error al actualizar estatus');
      }

      const updated = claims.map((c) => (c.id === claimId ? { ...c, status: newStatus } : c));
      setClaims(updated);
      showToast(`ℹ️ Reclamo ${claimId} actualizado a '${newStatus}'.`);
    } catch (err: any) {
      showToast(`Error: ${err.message || 'No se pudo actualizar el estatus'}`);
    }
  };

  // 5. CALL REGISTER WORKFLOW: Add Call Log with Wasender Dispatch
  const handleAddCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClaimForCalls) return;

    const newCallNumber = (selectedClaimForCalls.callCount || 0) + 1;
    const wasenderMsg = `📢 Reclamo ${selectedClaimForCalls.orderCode} - Llamada #${newCallNumber}${
      newCallNumber >= 3 ? ' (🔥 ALTA PRIORIDAD / CLIENTE INSATISFECHO)' : ''
    } | Cliente: ${callerName || selectedClaimForCalls.customerName} (${callerPhone || selectedClaimForCalls.customerPhone}) | Atendió: ${attendedBy} | Detalle: ${callSummary}`;

    try {
      const response = await apiFetch(`/claims/${selectedClaimForCalls.id}/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callerName: callerName || selectedClaimForCalls.customerName,
          callerPhone: callerPhone || selectedClaimForCalls.customerPhone,
          attendedBy,
          conversationSummary: callSummary,
          whatsappDispatched: true,
          whatsappMessage: wasenderMsg,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || 'Error al registrar llamada');
      }

      const newCall: ClaimCall = await response.json();

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
      showToast(`📞 Llamada #${newCallNumber} registrada en base de datos.`);
    } catch (err: any) {
      showToast(`Error: ${err.message || 'No se pudo registrar la llamada'}`);
    }
  };

  // 6. REFUND WORKFLOW: Complete Refund Request
  const handleCompleteRefund = async (refund: RefundRequest) => {
    try {
      const response = await apiFetch(`/refunds/${refund.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || 'Error al procesar reembolso');
      }

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

      const targetOrder = orders.find((o) => o.id === refund.orderId || o.code === refund.orderCode);
      if (targetOrder && onUpdateOrder) {
        onUpdateOrder({
          ...targetOrder,
          status: 'reembolsado',
        });
      }

      showToast(`💼 Reembolso ${refund.id} completado ($${refund.amount.toFixed(2)} vía ${refund.paymentMethod}). Orden ${refund.orderCode} pasó a 'Reembolsado'.`);
    } catch (err: any) {
      showToast(`Error: ${err.message || 'No se pudo completar el reembolso'}`);
    }
  };

  // 7. CREATE NEW REFUND REQUEST
  const handleCreateRefundRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetOrder = orders.find((o) => o.id === newRefundOrderId || o.code === newRefundOrderId);
    if (!targetOrder) {
      showToast('Por favor selecciona una orden válida para el reembolso.');
      return;
    }

    const amountNum = parseFloat(newRefundAmount) || 0;

    try {
      const response = await apiFetch('/refunds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: Number(targetOrder.id),
          amount: amountNum,
          amountType: newRefundAmountType,
          paymentMethod: newRefundMethod,
          paymentDetails: newRefundDetails || null,
          reason: newRefundReason,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || 'Error al registrar solicitud de reembolso');
      }

      const createdRef = await response.json();
      const newRef: RefundRequest = {
        id: createdRef.id,
        orderId: targetOrder.id,
        orderCode: targetOrder.code,
        customerName: targetOrder.customer.name,
        customerPhone: targetOrder.customer.phone,
        vehicle: `${targetOrder.vehicle.year} ${targetOrder.vehicle.make} ${targetOrder.vehicle.model}`,
        part: targetOrder.mainPart,
        reason: newRefundReason,
        amount: amountNum,
        amountType: newRefundAmountType,
        paymentMethod: newRefundMethod,
        paymentDetails: newRefundDetails || 'Por verificar con cliente',
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      setRefundRequests([newRef, ...refundRequests]);

      if (onUpdateOrder) {
        onUpdateOrder({
          ...targetOrder,
          status: 'solicitud_reembolso',
        });
      }

      setIsNewRefundModalOpen(false);
      setNewRefundReason('');
      setNewRefundDetails('');
      showToast(`💼 Solicitud de reembolso ${newRef.id} registrada en base de datos por $${amountNum.toFixed(2)} USD.`);
    } catch (err: any) {
      showToast(`Error: ${err.message || 'No se pudo registrar el reembolso'}`);
    }
  };

  if (selectedOrderForRefund) {
    return (
      <RefundRequestView
        order={selectedOrderForRefund}
        onBack={() => setSelectedOrderForRefund(null)}
        onUpdateOrder={(updated) => {
          if (onUpdateOrder) onUpdateOrder(updated);
          void fetchClaimsAndRefunds();
        }}
        onSuccess={(msg) => {
          showToast(msg);
          setSelectedOrderForRefund(null);
          void fetchClaimsAndRefunds();
        }}
      />
    );
  }

  if (selectedClaimDetail) {
    const detailOrder = orders.find((order) => order.id === selectedClaimDetail.orderId || order.code === selectedClaimDetail.orderCode);
    return (
      <ClaimDetailView
        claim={selectedClaimDetail}
        order={detailOrder}
        onBack={() => setSelectedClaimDetail(null)}
        onOpenCalls={() => {
          setSelectedClaimForCalls(selectedClaimDetail);
          setCallerName(selectedClaimDetail.customerName);
          setCallerPhone(selectedClaimDetail.customerPhone);
        }}
        onResolve={() => void handleResolveClaim(selectedClaimDetail)}
      />
    );
  }

  return (
    <div className="radar-view relative pb-16">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 bg-[#10b981] text-[#064e3b] font-bold text-xs py-2.5 px-4 rounded-xl shadow-[0_0_25px_rgba(16,185,129,0.4)] flex items-center gap-2 animate-bounce border border-[#34d399]">
          <span className="material-symbols-outlined text-[18px]">verified</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header Card */}
      <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-red-400 to-cyan-400 shadow-[0_0_12px_#ef4444]" />
        
        <div>
          <div className="flex items-center gap-3.5">
            <div className="relative w-12 h-12 rounded-2xl bg-[#040814] border border-red-500/40 text-red-400 flex items-center justify-center shadow-[0_0_20px_rgba(239,68,68,0.3)] shrink-0">
              <span className="material-symbols-outlined text-[26px]">verified_user</span>
              <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-400 shadow-[0_0_8px_#ef4444] animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">
                  Reclamos & Garantías
                </h1>
                <span className="text-[11px] font-mono font-bold bg-cyan-950/60 text-cyan-300 border border-cyan-500/30 px-2.5 py-0.5 rounded-full shadow-[0_0_8px_rgba(6,182,212,0.25)]">
                  /claims
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
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
            className="cyber-btn-secondary px-3.5 py-2.5 text-xs font-bold flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px] text-cyan-400">print</span>
            <span>Imprimir PDF Reclamos</span>
          </button>

          <button
            type="button"
            onClick={() => setIsNewRefundModalOpen(true)}
            className="bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-[0_0_15px_rgba(245,158,11,0.2)] active:scale-95"
          >
            <span className="material-symbols-outlined text-[18px]">currency_exchange</span>
            <span>+ Solicitud Reembolso</span>
          </button>

          <button
            type="button"
            onClick={() => setIsNewClaimModalOpen(true)}
            className="bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-400 hover:to-rose-500 text-white font-black text-xs py-2.5 px-4 rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-[0_0_25px_rgba(239,68,68,0.5)] active:scale-95"
          >
            <span className="material-symbols-outlined text-[18px]">add_alert</span>
            <span>+ Nuevo Reclamo</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="relative rounded-2xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-3.5 flex flex-col justify-between shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#22d3ee]" />
          <span className="text-[10px] font-mono font-bold text-slate-400 uppercase">Total Casos</span>
          <span className="text-xl font-mono font-black text-white mt-1">{stats.total}</span>
          <span className="text-[10px] text-cyan-400 font-mono mt-0.5">{stats.totalCalls} llamadas reg.</span>
        </div>

        <div className="relative rounded-2xl bg-[#070c18]/90 backdrop-blur-2xl border border-amber-500/30 p-3.5 flex flex-col justify-between shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_8px_#fbbf24]" />
          <span className="text-[10px] font-mono font-bold text-amber-300 uppercase flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Pendientes
          </span>
          <span className="text-xl font-mono font-black text-amber-300 mt-1">{stats.pending}</span>
          <span className="text-[10px] text-amber-400/80 mt-0.5">En espera evaluación</span>
        </div>

        <div className="relative rounded-2xl bg-[#070c18]/90 backdrop-blur-2xl border border-blue-500/30 p-3.5 flex flex-col justify-between shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-blue-400 to-transparent shadow-[0_0_8px_#60a5fa]" />
          <span className="text-[10px] font-mono font-bold text-blue-300 uppercase">En Proceso</span>
          <span className="text-xl font-mono font-black text-blue-300 mt-1">{stats.inProcess}</span>
          <span className="text-[10px] text-blue-400/80 mt-0.5">En pruebas / Yarda</span>
        </div>

        <div className="relative rounded-2xl bg-[#070c18]/90 backdrop-blur-2xl border border-emerald-500/30 p-3.5 flex flex-col justify-between shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_8px_#34d399]" />
          <span className="text-[10px] font-mono font-bold text-emerald-300 uppercase">Resueltos</span>
          <span className="text-xl font-mono font-black text-emerald-300 mt-1">{stats.resolved}</span>
          <span className="text-[10px] text-emerald-400/80 mt-0.5">Orden restaurada</span>
        </div>

        <div className="relative rounded-2xl bg-[#070c18]/90 backdrop-blur-2xl border border-red-500/30 p-3.5 flex flex-col justify-between shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-red-400 to-transparent shadow-[0_0_8px_#ef4444]" />
          <span className="text-[10px] font-mono font-bold text-red-300 uppercase">Denegados</span>
          <span className="text-xl font-mono font-black text-red-300 mt-1">{stats.denied}</span>
          <span className="text-[10px] text-red-400/80 mt-0.5">Términos violados</span>
        </div>

        <div className="relative rounded-2xl bg-[#070c18]/90 backdrop-blur-2xl border border-purple-500/30 p-3.5 flex flex-col justify-between shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-purple-400 to-transparent shadow-[0_0_8px_#c084fc]" />
          <span className="text-[10px] font-mono font-bold text-purple-300 uppercase flex items-center gap-1">
            <span className="material-symbols-outlined text-[13px]">currency_exchange</span>
            Reembolsos
          </span>
          <span className="text-xl font-mono font-black text-purple-300 mt-1">{stats.pendingRefunds}</span>
          <span className="text-[10px] text-purple-400/80 mt-0.5">Pendientes de pago</span>
        </div>
      </div>

      {/* SECTION 5: Sub-módulo de Solicitudes de Reembolso (Refund Requests) */}
      <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-amber-500/30 overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.6)]">
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_10px_#fbbf24]" />
        
        <div className="p-4 bg-[#040814]/80 border-b border-amber-500/20 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-300 flex items-center justify-center border border-amber-500/40 shadow-[0_0_10px_rgba(245,158,11,0.3)]">
              <span className="material-symbols-outlined text-[18px]">currency_exchange</span>
            </div>
            <div>
              <h2 className="font-mono font-bold text-sm text-white flex items-center gap-2">
                <span>SOLICITUDES DE REEMBOLSO (REFUND REQUESTS)</span>
                <span className="text-[10px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2.5 py-0.5 rounded-full font-bold">
                  {refundRequests.filter((r) => r.status === 'pending').length} Pendientes
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                Devoluciones monetarias por piezas no disponibles o garantías aprobadas sin stock de recambio.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowRefundsDrawer(!showRefundsDrawer)}
              className="text-xs text-slate-300 hover:text-white px-3 py-1.5 rounded-xl bg-[#040814] border border-cyan-500/30 flex items-center gap-1 transition-all cursor-pointer hover:border-cyan-400"
            >
              <span className="material-symbols-outlined text-[16px]">
                {showRefundsDrawer ? 'expand_less' : 'expand_more'}
              </span>
              <span>{showRefundsDrawer ? 'Ocultar Panel' : 'Mostrar Panel'}</span>
            </button>
          </div>
        </div>

        {showRefundsDrawer && (
          <div className="p-5 flex flex-col gap-3">
            {refundRequests.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4 font-mono">No hay solicitudes de reembolso en este momento.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {refundRequests.map((refund) => (
                  <div
                    key={refund.id}
                    className={`rounded-2xl p-4.5 border transition-all flex flex-col justify-between gap-3 ${
                      refund.status === 'pending'
                        ? 'bg-[#040814] border-amber-500/40 shadow-[0_0_20px_rgba(245,158,11,0.12)]'
                        : 'bg-[#040814]/50 border-cyan-500/15 opacity-70'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-xs text-cyan-300 bg-cyan-950/50 px-2.5 py-0.5 rounded-lg border border-cyan-500/30">
                            {refund.orderCode}
                          </span>
                          <span className="text-xs font-bold text-white">{refund.customerName}</span>
                        </div>

                        <span
                          className={`text-[10px] font-mono px-2.5 py-0.5 rounded-full font-bold uppercase ${
                            refund.status === 'pending'
                              ? 'neon-badge-amber'
                              : 'neon-badge-emerald'
                          }`}
                        >
                          {refund.status === 'pending' ? '🟡 En Espera' : '🟢 Liquidado'}
                        </span>
                      </div>

                      <div className="mt-2.5 text-xs text-slate-300">
                        <span className="font-semibold text-white">{refund.vehicle}</span> · <span className="text-cyan-300">{refund.part}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1 italic">Motivo: {refund.reason}</div>
                    </div>

                    <div className="bg-[#070c18] p-3 rounded-xl border border-cyan-500/20 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div>
                        <span className="text-[10px] text-slate-400 uppercase font-mono block">Monto a Liquidar</span>
                        <strong className="text-base font-mono text-amber-300">
                          ${refund.amount.toFixed(2)} USD{' '}
                          <span className="text-[10px] text-slate-400 font-normal">
                            ({refund.amountType === 'downpayment' ? 'Anticipo' : refund.amountType === 'total' ? 'Total' : 'Personalizado'})
                          </span>
                        </strong>
                      </div>

                      <div>
                        <span className="text-[10px] text-slate-400 uppercase font-mono block">Método de Pago</span>
                        <span className="font-mono text-slate-200 font-bold">
                          {refund.paymentMethod}: <span className="text-cyan-300">{refund.paymentDetails}</span>
                        </span>
                      </div>

                      {refund.status === 'pending' ? (
                        <button
                          type="button"
                          onClick={() => handleCompleteRefund(refund)}
                          className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 text-xs font-black transition-all flex items-center gap-1 shadow-[0_0_15px_rgba(16,185,129,0.35)] cursor-pointer active:scale-95"
                        >
                          <span className="material-symbols-outlined text-[16px]">check_circle</span>
                          <span>✔ Marcar Resuelto</span>
                        </button>
                      ) : (
                        <span className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1 font-mono">
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
      <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.6)] flex flex-col">
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#22d3ee]" />
        
        {/* Table Filter Toolbar */}
        <div className="p-4 bg-[#040814]/80 border-b border-cyan-500/20 flex flex-wrap items-center justify-between gap-3">
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
                    ? 'bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-black shadow-[0_0_15px_rgba(6,182,212,0.4)]'
                    : 'bg-[#040814] text-slate-400 hover:text-white border border-cyan-500/20 hover:border-cyan-500/40'
                }`}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                      statusFilter === tab.id ? 'bg-slate-950/40 text-slate-950 font-black' : 'bg-cyan-950/60 text-cyan-300'
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
              className="bg-[#040814] border border-cyan-500/30 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-semibold focus:outline-none focus:border-cyan-400"
            >
              <option value="Todas">Prioridad: Todas</option>
              <option value="Alta">Prioridad: Alta</option>
              <option value="Media">Prioridad: Media</option>
              <option value="Baja">Prioridad: Baja</option>
            </select>

            <div className="relative flex-1 sm:w-64">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-cyan-400 text-[18px]">
                search
              </span>
              <input
                type="text"
                placeholder="Buscar ticket, orden, cliente, pieza..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-[#040814] border border-cyan-500/30 rounded-xl py-1.5 pl-9 pr-7 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs cursor-pointer"
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
            <thead className="bg-[#040814] text-cyan-400/80 uppercase text-[10px] tracking-wider border-b border-cyan-500/20 font-mono">
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
            <tbody className="divide-y divide-cyan-500/10 text-slate-300">
              {filteredClaims.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400 font-mono">
                    <div className="flex flex-col items-center gap-2">
                      <span className="material-symbols-outlined text-[36px] text-slate-600">verified</span>
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
                      className="hover:bg-cyan-500/5 transition-colors group cursor-pointer"
                    >
                      {/* Ticket & Order */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col">
                          <span className="font-mono font-bold text-xs text-cyan-300 drop-shadow-[0_0_5px_rgba(6,182,212,0.4)]">{claim.id}</span>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onSelectOrder && onSelectOrder(claim.orderId);
                            }}
                            className="text-[11px] font-mono text-slate-400 hover:text-cyan-400 text-left underline underline-offset-2 mt-0.5"
                          >
                            {claim.orderCode}
                          </button>
                        </div>
                      </td>

                      {/* Customer Info */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-white">{claim.customerName}</div>
                        <a
                          href={`tel:${claim.customerPhone}`}
                          className="text-[11px] font-mono text-slate-400 hover:text-cyan-300 flex items-center gap-1 mt-0.5"
                        >
                          <span className="material-symbols-outlined text-[13px] text-cyan-400">call</span>
                          {claim.customerPhone}
                        </a>
                      </td>

                      {/* Vehicle & Part */}
                      <td className="py-3.5 px-4 max-w-xs">
                        <div className="font-semibold text-white truncate">{claim.vehicle}</div>
                        <div className="text-[11px] text-cyan-300 font-medium truncate mt-0.5">{claim.mainPart}</div>
                        {claim.stockNumber && (
                          <span className="text-[10px] font-mono text-emerald-400">Stock #{claim.stockNumber}</span>
                        )}
                      </td>

                      {/* Claim Reason & Priority */}
                      <td className="py-3.5 px-4 max-w-sm">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              claim.priority === 'Alta'
                                ? 'neon-badge-red'
                                : claim.priority === 'Media'
                                ? 'neon-badge-amber'
                                : 'neon-badge-emerald'
                            }`}
                          >
                            {claim.priority}
                          </span>
                          <span className="text-[10px] text-slate-400 font-medium">{claim.type}</span>
                        </div>
                        <p className="text-[11px] text-slate-300 line-clamp-2">{claim.claimReason}</p>
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
                              ? 'bg-[#040814] border-cyan-500/20 text-slate-400 hover:text-white hover:border-cyan-500/40'
                              : callCount >= 1 && callCount <= 2
                              ? 'bg-amber-500/15 border-amber-500/50 text-amber-300 hover:bg-amber-500/25 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                              : 'bg-red-500/20 border-red-500 text-red-300 animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.4)]'
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
                              ? 'neon-badge-amber'
                              : claim.status === 'In Process'
                              ? 'neon-badge-cyan'
                              : claim.status === 'Resolved'
                              ? 'neon-badge-emerald'
                              : 'neon-badge-red'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              claim.status === 'Pending'
                                ? 'bg-amber-400'
                                : claim.status === 'In Process'
                                ? 'bg-cyan-400'
                                : claim.status === 'Resolved'
                                ? 'bg-emerald-400'
                                : 'bg-red-400'
                            }`}
                          />
                          <span>{claim.status}</span>
                        </span>
                      </td>

                      {/* Advisor */}
                      <td className="py-3.5 px-4 text-xs text-slate-400">
                        <span className="text-slate-200 font-medium block">{claim.advisor}</span>
                        <span className="text-[10px] text-slate-500 font-mono">
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
                              className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold transition-all cursor-pointer shadow-[0_0_8px_rgba(16,185,129,0.25)]"
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
                            className="p-1.5 rounded-lg bg-[#040814] hover:bg-cyan-950 text-slate-300 hover:text-cyan-300 border border-cyan-500/25 transition-all cursor-pointer"
                            title="Ver bitácora de llamadas"
                          >
                            <span className="material-symbols-outlined text-[16px]">history</span>
                          </button>

                          {/* Status changer dropdown */}
                          <select
                            value={claim.status}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(e) => handleUpdateClaimStatus(claim.id, e.target.value as ClaimStatus)}
                            className="bg-[#040814] border border-cyan-500/30 rounded-lg px-2 py-1 text-[11px] text-slate-200 focus:outline-none cursor-pointer"
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



      {/* MODAL 1: Bitácora y Registro de Llamadas del Cliente */}
      {selectedClaimForCalls && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="relative rounded-3xl bg-[#070c18]/95 backdrop-blur-2xl border border-cyan-500/30 w-full max-w-2xl shadow-[0_20px_60px_rgba(0,0,0,0.8)] flex min-h-0 flex-col overflow-hidden max-h-[calc(100dvh-2rem)]">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 shadow-[0_0_12px_#22d3ee]" />
            
            {/* Modal Header */}
            <div className="p-5 bg-[#040814]/90 border-b border-cyan-500/20 flex shrink-0 justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-cyan-500/15 text-cyan-300 flex items-center justify-center border border-cyan-400/40 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
                  <span className="material-symbols-outlined text-[22px]">phone_in_talk</span>
                </div>
                <div>
                  <h3 className="font-bold text-base text-white flex items-center gap-2">
                    <span>Bitácora de Llamadas: {selectedClaimForCalls.orderCode}</span>
                    <span className="text-xs font-mono bg-cyan-950/60 text-cyan-300 px-2 py-0.5 rounded border border-cyan-500/30">
                      {selectedClaimForCalls.id}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    {selectedClaimForCalls.customerName} ({selectedClaimForCalls.customerPhone}) · {selectedClaimForCalls.vehicle}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedClaimForCalls(null)}
                className="p-1 rounded-xl text-slate-400 hover:text-white hover:bg-cyan-500/20 transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Modal Body: Scrollable Call History + Add Call Form */}
            <div className="min-h-0 flex-1 p-6 flex flex-col gap-5 overflow-y-auto custom-scrollbar">
              {/* Criticality Banner if >= 3 Calls */}
              {(selectedClaimForCalls.callCount || 0) >= 3 && (
                <div className="bg-red-950/30 border border-red-500/50 rounded-2xl p-4 flex items-start gap-3 text-xs text-red-200 shadow-[0_0_20px_rgba(239,68,68,0.2)]">
                  <span className="material-symbols-outlined text-red-400 text-[24px] shrink-0 mt-0.5 animate-bounce">
                    warning
                  </span>
                  <div>
                    <strong className="text-white font-bold block text-sm font-mono">
                      SEMAFORO ROJO: Alta Prioridad / Cliente Insatisfecho ({selectedClaimForCalls.callCount} llamadas)
                    </strong>
                    <p className="text-red-200 mt-1 leading-relaxed">
                      Este cliente ha llamado más de 2 veces solicitando resolución. Por política de calidad RADAR, se requiere confirmación inmediata de fecha de entrega o aprobación de reemplazo.
                    </p>
                  </div>
                </div>
              )}

              {/* Add New Call Form */}
              <form onSubmit={handleAddCall} className="bg-[#040814] border border-cyan-500/25 rounded-2xl p-4.5 flex flex-col gap-3">
                <h4 className="font-bold text-xs text-cyan-300 uppercase font-mono tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px]">add_call</span>
                  <span>Registrar Nueva Llamada de Seguimiento</span>
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-1 font-mono text-[10px] uppercase">Nombre Contacto</label>
                    <input
                      type="text"
                      required
                      value={callerName}
                      onChange={(e) => setCallerName(e.target.value)}
                      placeholder="Ej. Juan Pérez"
                      className="w-full bg-[#070c18] border border-cyan-500/25 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-400"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1 font-mono text-[10px] uppercase">Teléfono</label>
                    <input
                      type="text"
                      required
                      value={callerPhone}
                      onChange={(e) => setCallerPhone(e.target.value)}
                      placeholder="9195550199"
                      className="w-full bg-[#070c18] border border-cyan-500/25 rounded-xl p-2.5 text-white font-mono focus:outline-none focus:border-cyan-400"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1 font-mono text-[10px] uppercase">Atendió</label>
                    <select
                      value={attendedBy}
                      onChange={(e) => setAttendedBy(e.target.value)}
                      className="w-full bg-[#070c18] border border-cyan-500/25 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-400"
                    >
                      <option value="Carlos Mendoza">Carlos Mendoza</option>
                      <option value="Favio Andrade">Favio Andrade</option>
                      <option value="Marcos Rivas">Marcos Rivas</option>
                      <option value="Valeria Salas">Valeria Salas</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-slate-400 text-xs block mb-1 font-mono text-[10px] uppercase">
                    Resumen de lo Conversado / Acuerdos Técnicos *
                  </label>
                  <textarea
                    rows={2}
                    required
                    value={callSummary}
                    onChange={(e) => setCallSummary(e.target.value)}
                    placeholder="Se le informó al cliente que la yarda despachó el repuesto de reemplazo y llegará mañana a las 2:00 PM..."
                    className="w-full bg-[#070c18] border border-cyan-500/25 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                {/* Wasender Live Notification Preview */}
                <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-xl p-3 text-[11px] text-emerald-300 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-emerald-400 text-[18px]">chat</span>
                    <span>
                      <strong>Alerta WhatsApp Automática:</strong> Se enviará un mensaje Wasender al equipo de Customer Success al guardar.
                    </span>
                  </div>
                  <button
                    type="submit"
                    className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 font-black text-xs transition-all cursor-pointer shadow-[0_0_15px_rgba(6,182,212,0.4)] flex items-center gap-1 active:scale-95 shrink-0"
                  >
                    <span className="material-symbols-outlined text-[16px]">save</span>
                    <span>Guardar & Notificar</span>
                  </button>
                </div>
              </form>

              {/* Calls History Log */}
              <div>
                <h4 className="font-bold text-xs text-slate-300 uppercase font-mono tracking-wider mb-3 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-cyan-400">list_alt</span>
                  <span>Historial Cronológico ({selectedClaimForCalls.calls?.length || 0} Registros)</span>
                </h4>

                {(!selectedClaimForCalls.calls || selectedClaimForCalls.calls.length === 0) ? (
                  <div className="bg-[#040814] border border-cyan-500/20 rounded-2xl p-6 text-center text-xs text-slate-400 font-mono">
                    No se han registrado llamadas para este reclamo aún.
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {selectedClaimForCalls.calls.map((call) => (
                      <div
                        key={call.id}
                        className="bg-[#040814] border border-cyan-500/20 rounded-2xl p-3.5 flex flex-col gap-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-bold font-mono text-cyan-300 bg-cyan-950/60 px-2.5 py-0.5 rounded-lg text-[11px] border border-cyan-500/30">
                              Llamada #{call.callNumber}
                            </span>
                            <span className="font-bold text-white">{call.callerName}</span>
                            <span className="text-slate-400 font-mono">({call.callerPhone})</span>
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {new Date(call.createdAt).toLocaleString('es-ES', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>

                        <p className="text-xs text-slate-300 pl-2 border-l-2 border-cyan-400">
                          {call.conversationSummary}
                        </p>

                        <div className="flex items-center justify-between pt-1 text-[10px] text-slate-400">
                          <span>Atendido por: <strong className="text-emerald-400">{call.attendedBy}</strong></span>
                          {call.whatsappDispatched && (
                            <span className="text-emerald-400 flex items-center gap-1 font-semibold font-mono">
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

            <div className="p-4 bg-[#040814]/90 border-t border-cyan-500/20 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedClaimForCalls(null)}
                className="cyber-btn-secondary px-4 py-2 text-xs font-bold"
              >
                Cerrar Bitácora
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Crear Nuevo Reclamo */}
      {isNewClaimModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="relative rounded-3xl bg-[#070c18]/95 backdrop-blur-2xl border border-red-500/30 w-full max-w-xl shadow-[0_20px_60px_rgba(0,0,0,0.8)] flex min-h-0 flex-col overflow-hidden max-h-[calc(100dvh-2rem)]">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-red-400 to-rose-500 shadow-[0_0_12px_#ef4444]" />
            
            <div className="p-5 bg-[#040814]/90 border-b border-red-500/20 flex justify-between items-start gap-4 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-red-500/15 text-red-400 flex items-center justify-center border border-red-500/40 shadow-[0_0_15px_rgba(239,68,68,0.3)]">
                  <span className="material-symbols-outlined text-[22px]">add_alert</span>
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">Registrar Nuevo Reclamo</h3>
                  <p className="text-xs text-slate-400">Apertura de caso de garantía con transición atómica de la orden</p>
                </div>
              </div>
              <button
                onClick={() => setIsNewClaimModalOpen(false)}
                className="p-1 rounded-xl text-slate-400 hover:text-white hover:bg-red-500/20 transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form onSubmit={handleCreateClaim} className="p-6 flex min-h-0 flex-col gap-4 overflow-y-auto custom-scrollbar text-xs text-slate-300">
              {/* Select Order */}
              <div>
                <label className="text-slate-200 block mb-1 font-semibold font-mono text-[11px] uppercase">Seleccionar Orden Vinculada *</label>
                <select
                  required
                  value={newClaimOrderId}
                  onChange={(e) => setNewClaimOrderId(e.target.value)}
                  className="w-full bg-[#040814] border border-cyan-500/30 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-400"
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
                  <label className="text-slate-200 block mb-1 font-semibold font-mono text-[11px] uppercase">Tipo de Inconformidad</label>
                  <select
                    value={newClaimType}
                    onChange={(e) => setNewClaimType(e.target.value)}
                    className="w-full bg-[#040814] border border-cyan-500/30 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-400"
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
                  <label className="text-slate-200 block mb-1 font-semibold font-mono text-[11px] uppercase">Nivel de Prioridad</label>
                  <select
                    value={newClaimPriority}
                    onChange={(e) => setNewClaimPriority(e.target.value as any)}
                    className="w-full bg-[#040814] border border-cyan-500/30 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-400"
                  >
                    <option value="Alta">🔴 Alta (Cliente Detenido)</option>
                    <option value="Media">🟡 Media (En Taller)</option>
                    <option value="Baja">🟢 Baja (Detalle Cosmético)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-slate-200 block mb-1 font-semibold font-mono text-[11px] uppercase">Descripción del Fallo / Causa Reportada *</label>
                <textarea
                  rows={3}
                  required
                  value={newClaimReason}
                  onChange={(e) => setNewClaimReason(e.target.value)}
                  placeholder="Detallar claramente el problema técnico (ej. Ruido en transmisión, fuga de aceite, sensores incompatibles)..."
                  className="w-full bg-[#040814] border border-cyan-500/30 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div>
                <label className="text-slate-200 block mb-1 font-semibold font-mono text-[11px] uppercase">Especialista / Asesor Asignado</label>
                <select
                  value={newClaimAdvisor}
                  onChange={(e) => setNewClaimAdvisor(e.target.value)}
                  className="w-full bg-[#040814] border border-cyan-500/30 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-400"
                >
                  <option value="Carlos Mendoza">Carlos Mendoza</option>
                  <option value="Favio Andrade">Favio Andrade</option>
                  <option value="Marcos Rivas">Marcos Rivas</option>
                  <option value="Valeria Salas">Valeria Salas</option>
                </select>
              </div>

              {/* Atomic Impact Notice */}
              <div className="bg-red-950/30 border border-red-500/40 rounded-2xl p-3.5 text-[11px] text-red-200 flex items-start gap-2.5">
                <span className="material-symbols-outlined text-red-400 text-[18px] shrink-0 mt-0.5">
                  info
                </span>
                <p>
                  <strong>Impacto Atómico en Base de Datos:</strong> Al crear este reclamo, la orden seleccionada cambiará inmediatamente a estatus <strong>'Reclamo'</strong> y se guardará su estatus original para permitir su restauración al resolver el caso.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-cyan-500/20">
                <button
                  type="button"
                  onClick={() => setIsNewClaimModalOpen(false)}
                  className="cyber-btn-secondary px-4 py-2 text-xs font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-400 hover:to-rose-500 text-white font-black text-xs shadow-[0_0_20px_rgba(239,68,68,0.5)] transition-all cursor-pointer active:scale-95"
                >
                  Crear Reclamo & Notificar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Seleccionar Orden para Reembolso (Vista) */}
      {isNewRefundModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="relative rounded-3xl bg-[#070c18]/95 backdrop-blur-2xl border border-amber-500/30 w-full max-w-lg shadow-[0_20px_60px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_12px_#fbbf24]" />
            
            <div className="p-5 bg-[#040814]/90 border-b border-amber-500/20 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/15 text-amber-300 flex items-center justify-center border border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.3)]">
                  <span className="material-symbols-outlined text-[22px]">currency_exchange</span>
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">Solicitud de Reembolso</h3>
                  <p className="text-xs text-slate-400">Selecciona la orden a reembolsar para abrir la vista dedicada</p>
                </div>
              </div>
              <button
                onClick={() => setIsNewRefundModalOpen(false)}
                className="p-1 rounded-xl text-slate-400 hover:text-white hover:bg-amber-500/20 transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const match = orders.find((o) => o.id === newRefundOrderId);
                if (match) {
                  setIsNewRefundModalOpen(false);
                  setSelectedOrderForRefund(match);
                } else if (orders.length > 0) {
                  setIsNewRefundModalOpen(false);
                  setSelectedOrderForRefund(orders[0]);
                }
              }}
              className="p-6 flex flex-col gap-4 text-xs text-slate-300"
            >
              <div>
                <label className="text-slate-200 block mb-1.5 font-semibold font-mono text-[11px] uppercase">
                  Seleccionar Orden Destino *
                </label>
                <select
                  required
                  value={newRefundOrderId}
                  onChange={(e) => setNewRefundOrderId(e.target.value)}
                  className="w-full bg-[#040814] border border-cyan-500/30 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-cyan-400 cursor-pointer"
                >
                  <option value="">-- Seleccionar Orden --</option>
                  {orders.map((ord) => (
                    <option key={ord.id} value={ord.id}>
                      #{ord.code} · {ord.customer.name} · {ord.vehicle.make} {ord.vehicle.model} (${ord.financials.total} USD)
                    </option>
                  ))}
                </select>
              </div>

              <div className="p-3.5 rounded-2xl bg-amber-950/20 border border-amber-500/20 text-xs text-amber-200/90 flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[20px] text-amber-400 shrink-0">info</span>
                <span>Al seleccionar la orden se abrirá la vista completa de desglose financiero, selección de método y confirmación contable.</span>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-amber-500/20">
                <button
                  type="button"
                  onClick={() => setIsNewRefundModalOpen(false)}
                  className="cyber-btn-secondary px-4 py-2 text-xs font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!newRefundOrderId && orders.length === 0}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black text-xs shadow-[0_0_20px_rgba(245,158,11,0.4)] transition-all cursor-pointer active:scale-95 flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                  <span>Abrir Vista de Reembolso</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: SECTION 6 - Exportación e Impresión de Reportes PDF */}
      {isPrintReportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="relative rounded-3xl bg-[#070c18]/95 backdrop-blur-2xl border border-cyan-500/30 w-full max-w-4xl shadow-[0_20px_60px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden max-h-[95vh]">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 shadow-[0_0_12px_#22d3ee]" />
            
            <div className="p-5 bg-[#040814]/90 border-b border-cyan-500/20 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-cyan-500/15 text-cyan-300 flex items-center justify-center border border-cyan-400/40 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
                  <span className="material-symbols-outlined text-[22px]">print</span>
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">Reporte de Auditoría y Taller (PDF Reclamos)</h3>
                  <p className="text-xs text-slate-400">Vista previa formateada para impresión horizontal y archivo físico</p>
                </div>
              </div>
              <button
                onClick={() => setIsPrintReportModalOpen(false)}
                className="p-1 rounded-xl text-slate-400 hover:text-white hover:bg-cyan-500/20 transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Date Range Bar */}
            <div className="p-4 bg-[#040814] border-b border-cyan-500/20 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <label className="text-slate-400 font-mono text-[11px] uppercase font-semibold">Rango de Fechas:</label>
                <input
                  type="date"
                  value={printDateFrom}
                  onChange={(e) => setPrintDateFrom(e.target.value)}
                  className="bg-[#070c18] border border-cyan-500/30 rounded-xl px-2.5 py-1 text-xs text-white focus:outline-none focus:border-cyan-400"
                />
                <span className="text-slate-500 font-mono">al</span>
                <input
                  type="date"
                  value={printDateTo}
                  onChange={(e) => setPrintDateTo(e.target.value)}
                  className="bg-[#070c18] border border-cyan-500/30 rounded-xl px-2.5 py-1 text-xs text-white focus:outline-none focus:border-cyan-400"
                />
              </div>

              <button
                type="button"
                onClick={() => window.print()}
                className="cyber-btn-primary px-4 py-2 text-xs font-black flex items-center gap-1.5"
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

            <div className="p-4 bg-[#040814]/90 border-t border-cyan-500/20 flex justify-end">
              <button
                type="button"
                onClick={() => setIsPrintReportModalOpen(false)}
                className="cyber-btn-secondary px-4 py-2 text-xs font-bold"
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
