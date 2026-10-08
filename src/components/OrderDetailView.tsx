import React, { useState, useEffect } from 'react';
import { Order, OrderStatus, Claim, ClaimCall, ClaimStatus, AuctionLink, AuctionHouse } from '../types';
import { SecurityOtpModal } from './SecurityOtpModal';
import { InvoiceView } from './InvoiceView';
import { DispatchLabelView } from './DispatchLabelView';
import { RefundRequestView } from './RefundRequestView';
import { canTransitionOrderStatus, getAllowedNextStatuses, ORDER_STATUS_LABELS, requiresStatusAuthorization } from '../utils/orderStatusRules';
import { apiFetch } from '../services/apiFetch';

interface OrderDetailViewProps {
  order: Order;
  onBack: () => void;
  onOpenSMS: (customerName: string, phone: string, order?: Order) => void;
  onUpdateOrder?: (updatedOrder: Order) => void;
  onCreateClaim?: (orderId: string, reason: string) => Promise<void>;
}

export const OrderDetailView: React.FC<OrderDetailViewProps> = ({
  order,
  onBack,
  onOpenSMS,
  onUpdateOrder,
  onCreateClaim,
}) => {
  const [activeTab, setActiveTab] = useState<'resumen' | 'workflow' | 'historial'>('resumen');
  const [subView, setSubView] = useState<'detail' | 'refund' | 'invoice' | 'dispatch'>('detail');
  const [previewStep, setPreviewStep] = useState<number | null>(null);
  const recordedStep = Math.min(4, Math.max(1, order.workflowStep || 1));
  const currentStep = previewStep ?? recordedStep;
  const [stockAssigned, setStockAssigned] = useState<string | null>(order.stockNumber || null);
  const [copiedNotification, setCopiedNotification] = useState<string | null>(null);

  // Auction Search & Refund State
  const [isAuctionActive, setIsAuctionActive] = useState<boolean>(
    Boolean(order.auctionActive || (order.auctionLinks && order.auctionLinks.length > 0))
  );
  const [auctionLinks, setAuctionLinks] = useState<AuctionLink[]>(order.auctionLinks || []);
  const [newAuctionUrl, setNewAuctionUrl] = useState<string>('');
  const [newAuctionHouse, setNewAuctionHouse] = useState<AuctionHouse>('Copart');
  const [newAuctionDate, setNewAuctionDate] = useState<string>('');
  const [newHasBuyNow, setNewHasBuyNow] = useState<boolean>(false);
  const [newBuyNowPrice, setNewBuyNowPrice] = useState<string>('');
  const [showAuctionPanel, setShowAuctionPanel] = useState<boolean>(false);

  // Claim Tracking & Follow-up State
  const [associatedClaim, setAssociatedClaim] = useState<Claim | null>(null);
  const [isLoadingClaim, setIsLoadingClaim] = useState<boolean>(false);
  const [isCallModalOpen, setIsCallModalOpen] = useState<boolean>(false);
  const [showCallHistory, setShowCallHistory] = useState<boolean>(false);
  const [isResolveModalOpen, setIsResolveModalOpen] = useState<boolean>(false);

  const [callForm, setCallForm] = useState({
    callerName: order.customer.name || '',
    callerPhone: order.customer.phone || '',
    attendedBy: order.advisor || 'Carlos Mendoza',
    summary: '',
    sendWhatsApp: true,
    isSubmitting: false,
    error: '',
  });

  const [resolveForm, setResolveForm] = useState<{
    targetStatus: OrderStatus;
    notes: string;
    isSubmitting: boolean;
  }>({
    targetStatus: 'entregado',
    notes: '',
    isSubmitting: false,
  });

  // Workflow state fields
  const [extensionReason, setExtensionReason] = useState<string>(order.pickupExtensionReason || '');
  const [showExtensionModal, setShowExtensionModal] = useState<boolean>(false);

  // Modals state
  const [claimModal, setClaimModal] = useState({ isOpen: false, reason: '', isSaving: false, error: '' });
  const [securityModal, setSecurityModal] = useState<{
    isOpen: boolean;
    targetStatus: OrderStatus;
    actionTitle: string;
    actionDescription: string;
  }>({
    isOpen: false,
    targetStatus: 'pagado',
    actionTitle: '',
    actionDescription: '',
  });

  const vehicleName = `${order.vehicle.make} ${order.vehicle.model}`;
  const vehicleDetails = `${order.vehicle.year} • ${order.vehicle.trim || order.productSpecs || '2.4L Engine'}`;
  const partType = order.mainPart || 'Engine (Motor 2.4L)';
  const isHomeDelivery = order.deliveryType === 'envio_domicilio' && Boolean(order.customer.shippingAddress?.trim());
  const partPrice = order.financials.partPrice ?? order.financials.baseMSRP ?? 1000.0;
  const downPayment = order.financials.downPayment ?? order.financials.advancePayment ?? 0.0;
  const deliveryFee = order.financials.deliveryFee ?? 0.0;
  const coreFee = order.financials.coreFee ?? 0.0;

  // Total sum of charges
  const grossSubtotal = partPrice + deliveryFee + coreFee;
  // Total payable after downpayment
  const totalPayable = Math.max(0, grossSubtotal - downPayment);

  // Warranty Days Remaining Calculation
  const calculateWarrantyRemaining = (): { daysLeft: number; badgeClass: string; label: string } => {
    if (order.status !== 'entregado' || !order.deliveredAt) {
      return {
        daysLeft: order.warrantyDays || 60,
        badgeClass: 'neon-badge-cyan',
        label: 'Inicia al entregar físicamente',
      };
    }
    const deliveredDate = new Date(order.deliveredAt).getTime();
    const elapsedDays = Math.floor((Date.now() - deliveredDate) / (1000 * 60 * 60 * 24));
    const daysLeft = Math.max(0, (order.warrantyDays || 60) - elapsedDays);

    if (daysLeft > 10) {
      return {
        daysLeft,
        badgeClass: 'neon-badge-emerald',
        label: `🟢 Vigente (${daysLeft}d restantes)`,
      };
    } else if (daysLeft > 0) {
      return {
        daysLeft,
        badgeClass: 'neon-badge-amber',
        label: `🟡 Crítica (${daysLeft}d restantes)`,
      };
    } else {
      return {
        daysLeft: 0,
        badgeClass: 'neon-badge-red',
        label: '🔴 Garantía Expirada',
      };
    }
  };

  const warrantyInfo = calculateWarrantyRemaining();

  const fetchAssociatedClaim = async () => {
    try {
      setIsLoadingClaim(true);
      const res = await apiFetch('/claims');
      if (res.ok) {
        const claims: Claim[] = await res.json();
        const match = claims.find((c) => String(c.orderId) === String(order.id) || c.orderCode === order.code);
        if (match) {
          setAssociatedClaim(match);
          setResolveForm((prev) => ({
            ...prev,
            targetStatus: (match.previousOrderStatus as OrderStatus) || 'entregado',
          }));
        }
      }
    } catch {
      // silent catch
    } finally {
      setIsLoadingClaim(false);
    }
  };

  useEffect(() => {
    fetchAssociatedClaim();
  }, [order.id, order.code]);

  const handleCopy = (text: string, label: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedNotification(`¡${label} copiado al portapapeles!`);
      setTimeout(() => setCopiedNotification(null), 2500);
    }
  };

  const handleToast = (msg: string) => {
    setCopiedNotification(msg);
    setTimeout(() => setCopiedNotification(null), 3000);
  };

  const handleToggleAuction = () => {
    setShowAuctionPanel(!showAuctionPanel);
  };

  const handleUrlChange = (val: string) => {
    setNewAuctionUrl(val);
    if (/copart\.com/i.test(val)) {
      setNewAuctionHouse('Copart');
    } else if (/iaai\.com/i.test(val)) {
      setNewAuctionHouse('IAAI');
    }
  };

  const handleAddAuctionLink = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newAuctionUrl.trim()) return;

    let formattedUrl = newAuctionUrl.trim();
    if (!/^https?:\/\//i.test(formattedUrl)) {
      formattedUrl = `https://${formattedUrl}`;
    }

    const parsedBuyNow = newHasBuyNow ? parseFloat(newBuyNowPrice) || 0 : undefined;

    const newLink: AuctionLink = {
      id: String(Date.now()),
      url: formattedUrl,
      auctionHouse: newAuctionHouse,
      auctionDate: newAuctionDate || undefined,
      hasBuyNow: newHasBuyNow,
      buyNowPrice: parsedBuyNow,
      createdAt: new Date().toISOString(),
    };

    const updatedLinks = [...auctionLinks, newLink];
    setAuctionLinks(updatedLinks);
    setIsAuctionActive(true);
    setNewAuctionUrl('');
    setNewAuctionDate('');
    setNewHasBuyNow(false);
    setNewBuyNowPrice('');

    if (onUpdateOrder) {
      onUpdateOrder({
        ...order,
        auctionActive: true,
        auctionLinks: updatedLinks,
      });
    }

    handleToast(`✅ Enlace de subasta (${newAuctionHouse}) agregado`);
  };

  const handleRemoveAuctionLink = (linkId: string) => {
    const updatedLinks = auctionLinks.filter((l) => l.id !== linkId);
    setAuctionLinks(updatedLinks);
    if (onUpdateOrder) {
      onUpdateOrder({
        ...order,
        auctionLinks: updatedLinks,
      });
    }
    handleToast('Enlace de subasta eliminado');
  };

  const handleAssignStock = () => {
    const newStock = `STK-2026-${Math.floor(100 + Math.random() * 900)}`;
    setStockAssigned(newStock);
    if (onUpdateOrder) {
      onUpdateOrder({ ...order, stockNumber: newStock });
    }
  };

  const handleRegisterCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!callForm.summary.trim()) {
      setCallForm((prev) => ({ ...prev, error: 'Ingresa el resumen de la llamada.' }));
      return;
    }

    setCallForm((prev) => ({ ...prev, isSubmitting: true, error: '' }));
    const claimTargetId = associatedClaim?.id?.replace('REC-', '') || order.id;
    const newCallNumber = ((associatedClaim?.callCount || associatedClaim?.calls?.length) || 0) + 1;
    const wasenderMsg = `📢 Reclamo Orden #${order.code} - Llamada #${newCallNumber} | Cliente: ${callForm.callerName || order.customer.name} (${callForm.callerPhone || order.customer.phone}) | Atendió: ${callForm.attendedBy} | Detalle: ${callForm.summary}`;

    try {
      const res = await apiFetch(`/claims/${claimTargetId}/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callerName: callForm.callerName || order.customer.name,
          callerPhone: callForm.callerPhone || order.customer.phone,
          attendedBy: callForm.attendedBy || order.advisor,
          conversationSummary: callForm.summary,
          whatsappDispatched: callForm.sendWhatsApp,
          whatsappMessage: wasenderMsg,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al registrar llamada');
      }

      const newCall: ClaimCall = await res.json();
      setAssociatedClaim((prev) => {
        if (!prev) {
          return {
            id: `REC-${claimTargetId}`,
            orderId: order.id,
            orderCode: order.code,
            customerName: order.customer.name,
            customerPhone: order.customer.phone,
            vehicle: `${order.vehicle.year} ${order.vehicle.make} ${order.vehicle.model}`,
            mainPart: order.mainPart,
            claimReason: order.claimReason || 'Reclamo en curso',
            type: 'Reclamo de orden',
            priority: 'Media',
            status: 'Pending',
            previousOrderStatus: 'entregado',
            advisor: order.advisor || 'Carlos Mendoza',
            createdAt: new Date().toISOString(),
            callCount: 1,
            calls: [newCall],
          };
        }
        return {
          ...prev,
          calls: [newCall, ...(prev.calls || [])],
          callCount: (prev.callCount || 0) + 1,
        };
      });

      setIsCallModalOpen(false);
      setCallForm((prev) => ({ ...prev, summary: '', isSubmitting: false }));
      handleToast(`📞 Llamada #${newCallNumber} registrada en bitácora.`);
    } catch (err: any) {
      setCallForm((prev) => ({ ...prev, isSubmitting: false, error: err.message || 'Error al guardar la llamada.' }));
    }
  };

  const handleResolveClaimFromDetail = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const claimTargetId = associatedClaim?.id?.replace('REC-', '');
    setResolveForm((prev) => ({ ...prev, isSubmitting: true }));

    try {
      if (claimTargetId) {
        const res = await apiFetch(`/claims/${claimTargetId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'Resolved',
            orderId: Number(order.id),
            previousOrderStatus: resolveForm.targetStatus,
          }),
        });
        if (!res.ok) throw new Error('No se pudo resolver el reclamo en el servidor');
      }

      if (onUpdateOrder) {
        onUpdateOrder({
          ...order,
          status: resolveForm.targetStatus,
          claimReason: undefined,
          deliveredAt: resolveForm.targetStatus === 'entregado' ? (order.deliveredAt || new Date().toISOString()) : order.deliveredAt,
        });
      }

      setAssociatedClaim((prev) =>
        prev
          ? {
              ...prev,
              status: 'Resolved' as ClaimStatus,
              resolvedAt: new Date().toISOString(),
            }
          : null
      );

      setIsResolveModalOpen(false);
      handleToast(`🟢 Reclamo resuelto. Orden restaurada a '${ORDER_STATUS_LABELS[resolveForm.targetStatus]}'.`);
    } catch {
      alert('No se pudo completar la resolución del reclamo.');
    } finally {
      setResolveForm((prev) => ({ ...prev, isSubmitting: false }));
    }
  };

  const handleDenyClaimFromDetail = async () => {
    if (!window.confirm(`¿Confirmas denegar la garantía del reclamo asociado a la orden #${order.code}?`)) {
      return;
    }
    const claimTargetId = associatedClaim?.id?.replace('REC-', '');
    try {
      if (claimTargetId) {
        await apiFetch(`/claims/${claimTargetId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'Denied',
            orderId: Number(order.id),
          }),
        });
      }
      setAssociatedClaim((prev) => (prev ? { ...prev, status: 'Denied' as ClaimStatus } : null));
      handleToast(`🔴 Garantía denegada para reclamo.`);
    } catch {
      alert('Error al denegar la garantía.');
    }
  };

  const handleStatusChange = (newStatus: OrderStatus) => {
    if (!canTransitionOrderStatus(order.status, newStatus)) return;

    if (newStatus === 'reclamo') {
      setClaimModal({ isOpen: true, reason: order.claimReason || '', isSaving: false, error: '' });
      return;
    }

    if (requiresStatusAuthorization(order.status, newStatus)) {
      setSecurityModal({
        isOpen: true,
        targetStatus: newStatus,
        actionTitle: 'Autorizar cambio de reembolso',
        actionDescription: 'Volver una solicitud de reembolso a pagado o cotización requiere autorización.',
      });
      return;
    }

    if (order.status === 'archivado' && newStatus !== 'archivado') {
      setSecurityModal({
        isOpen: true,
        targetStatus: newStatus,
        actionTitle: 'Desarchivar Orden',
        actionDescription: 'Extraer esta orden del histórico requiere verificación de seguridad Wasender.',
      });
      return;
    }
    if (order.status === 'cancelado' && newStatus !== 'cancelado') {
      setSecurityModal({
        isOpen: true,
        targetStatus: newStatus,
        actionTitle: 'Reactivar Orden Cancelada',
        actionDescription: 'Reactivar una orden cancelada requiere autorización de seguridad Wasender.',
      });
      return;
    }

    if (onUpdateOrder) {
      onUpdateOrder({
        ...order,
        status: newStatus,
        deliveredAt: newStatus === 'entregado' ? (order.deliveredAt || new Date().toISOString()) : order.deliveredAt,
      });
    }
    handleToast(`Estado actualizado a ${ORDER_STATUS_LABELS[newStatus]}`);
  };

  const handleConfirmClaimCreation = async () => {
    if (!claimModal.reason.trim()) {
      setClaimModal((previous) => ({ ...previous, error: 'Debes indicar el motivo del reclamo.' }));
      return;
    }

    try {
      setClaimModal((previous) => ({ ...previous, isSaving: true, error: '' }));
      if (onCreateClaim) {
        await onCreateClaim(order.id, claimModal.reason.trim());
      } else if (onUpdateOrder) {
        onUpdateOrder({
          ...order,
          status: 'reclamo',
          claimReason: claimModal.reason.trim(),
        });
      }
      setClaimModal({ isOpen: false, reason: '', isSaving: false, error: '' });
      handleToast('⚠️ Reclamo aperturado exitosamente');
      fetchAssociatedClaim();
    } catch {
      setClaimModal((previous) => ({ ...previous, isSaving: false, error: 'No se pudo crear el reclamo en la base de datos.' }));
    }
  };

  const statusOptions = [order.status, ...getAllowedNextStatuses(order.status)];

  const handleSecuritySuccess = () => {
    if (onUpdateOrder) {
      onUpdateOrder({
        ...order,
        status: securityModal.targetStatus,
      });
    }
    handleToast(`Autorización exitosa: ${ORDER_STATUS_LABELS[securityModal.targetStatus]}`);
  };

  const workflowSteps = [
    { num: 1, title: 'Cotización', sub: 'Términos & Cotización', icon: 'verified_user' },
    { num: 2, title: 'Acuse', sub: 'Acuse de Recibo (2-3d)', icon: 'support_agent' },
    { num: 3, title: 'Cita', sub: 'Retiro / Delivery', icon: 'calendar_month' },
    { num: 4, title: 'Cierre', sub: 'Entrega & Garantía', icon: 'task_alt' },
  ];

  const handleWorkflowStepCheck = (stepNumber: number) => {
    if (!onUpdateOrder || stepNumber > currentStep) return;

    const nextStep = Math.min(4, Math.max(order.workflowStep || 1, stepNumber + 1));
    onUpdateOrder({
      ...order,
      workflowStep: nextStep,
      ...(stepNumber === 4
        ? {
            status: 'entregado' as OrderStatus,
            deliveredAt: order.deliveredAt || new Date().toISOString(),
            warrantyStarted: true,
          }
        : {}),
    });
    handleToast(`Paso ${stepNumber} completado en flujo`);
  };

  if (subView === 'refund') {
    return (
      <RefundRequestView
        order={order}
        onBack={() => setSubView('detail')}
        onUpdateOrder={onUpdateOrder}
        onSuccess={(msg) => {
          handleToast(msg);
          setSubView('detail');
        }}
      />
    );
  }

  if (subView === 'invoice') {
    return (
      <InvoiceView
        order={order}
        onBack={() => setSubView('detail')}
      />
    );
  }

  if (subView === 'dispatch') {
    return (
      <DispatchLabelView
        order={order}
        onBack={() => setSubView('detail')}
      />
    );
  }

  return (
    <div className="radar-view text-[var(--text-primary)] pb-4 space-y-2.5">
      {/* Toast Floating Notification */}
      {copiedNotification && (
        <div className="fixed top-16 right-6 z-50 px-4 py-2 rounded-xl bg-cyan-950/95 border border-cyan-400 text-cyan-200 text-xs font-mono font-bold shadow-[0_0_20px_rgba(6,182,212,0.5)] flex items-center gap-2 animate-fade-in">
          <span className="material-symbols-outlined text-[16px] text-cyan-400 animate-spin">sync</span>
          <span>{copiedNotification}</span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. ULTRA-COMPACT CONTROL HEADER (ALL KEY CONTROLS IN 1 TIGHT HUD BAR)    */}
      {/* ========================================================================= */}
      <div className="cyber-card p-2.5 sm:p-3 shadow-md relative overflow-hidden">
        <div className="cyber-laser-bar" />

        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Left: Back button + Order code + Status Selector + Abono */}
          <div className="flex items-center flex-wrap gap-2 sm:gap-2.5">
            <button
              type="button"
              onClick={onBack}
              className="p-1.5 rounded-lg bg-[var(--bg-card-subtle)] border border-cyan-500/30 text-cyan-400 hover:text-cyan-200 hover:bg-cyan-500/20 transition-all cursor-pointer shadow-sm"
              title="Volver a la lista de órdenes"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            </button>

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[var(--text-secondary)] font-mono font-semibold">ORDEN:</span>
              <h1 className="text-base sm:text-lg font-black text-cyan-400 font-mono tracking-tight flex items-center gap-1">
                #{order.code}
              </h1>
            </div>

            {/* Inline Status Dropdown */}
            <div className="relative inline-flex items-center">
              <select
                value={order.status}
                onChange={(e) => handleStatusChange(e.target.value as OrderStatus)}
                aria-label="Estado de orden"
                className="appearance-none bg-[var(--bg-card-subtle)] border border-cyan-500/40 text-cyan-300 font-mono font-black text-[11px] rounded-lg pl-2.5 pr-6 py-1 focus:outline-none focus:border-cyan-400 cursor-pointer uppercase tracking-wider shadow-inner"
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status} className="bg-[#070c18] text-white">
                    {ORDER_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
              <span className="material-symbols-outlined text-cyan-400 text-[16px] absolute right-1.5 pointer-events-none">
                arrow_drop_down
              </span>
            </div>

            {/* Downpayment Badge */}
            {downPayment === 0 ? (
              <span className="px-2 py-0.5 rounded-md text-[10.5px] font-mono font-bold neon-badge-red flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                <span>Sin Abono ($0)</span>
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-md text-[10.5px] font-mono font-bold neon-badge-emerald flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Abono: ${downPayment.toFixed(0)}</span>
              </span>
            )}

            {/* Asesor & Delivery metadata chips */}
            <div className="hidden md:flex items-center gap-2 text-[11px] font-mono text-[var(--text-secondary)] border-l border-cyan-500/20 pl-2.5">
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px] text-cyan-400">person</span>
                <strong className="text-[var(--text-primary)] font-semibold">{order.advisor || 'Carlos M.'}</strong>
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px] text-cyan-400">
                  {isHomeDelivery ? 'local_shipping' : 'storefront'}
                </span>
                <span>{isHomeDelivery ? 'Envío' : 'Retiro'}</span>
              </span>
            </div>
          </div>

          {/* Right: Quick Action Buttons & Tabs */}
          <div className="flex items-center flex-wrap gap-1.5">
            {/* Quick SMS/WhatsApp Button */}
            <button
              type="button"
              onClick={() => onOpenSMS(order.customer.name, order.customer.phone, order)}
              className="cyber-btn-primary px-2.5 py-1 text-[11px] font-black font-mono shadow-sm flex items-center gap-1"
              title="Enviar WhatsApp o SMS al cliente"
            >
              <span className="material-symbols-outlined text-[15px]">chat</span>
              <span>WhatsApp / SMS</span>
            </button>

            {/* Quick Factura Button */}
            <button
              type="button"
              onClick={() => setSubView('invoice')}
              className="cyber-btn-secondary px-2.5 py-1 text-[11px] font-bold font-mono flex items-center gap-1"
              title="Ver o imprimir Factura"
            >
              <span className="material-symbols-outlined text-[15px] text-cyan-400">receipt</span>
              <span>Factura</span>
            </button>

            {/* Quick Etiqueta 4x6 Button */}
            <button
              type="button"
              onClick={() => setSubView('dispatch')}
              className="cyber-btn-secondary px-2.5 py-1 text-[11px] font-bold font-mono flex items-center gap-1"
              title="Imprimir etiqueta térmica 4x6"
            >
              <span className="material-symbols-outlined text-[15px] text-emerald-400">qr_code_2</span>
              <span>Rótulo 4x6</span>
            </button>

            {/* Quick Subasta Toggle Button */}
            <button
              type="button"
              onClick={handleToggleAuction}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold font-mono flex items-center gap-1 transition-all cursor-pointer border ${
                isAuctionActive || showAuctionPanel
                  ? 'bg-amber-500/20 border-amber-400 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                  : 'cyber-btn-secondary text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
              title="Ver o gestionar búsqueda en subasta"
            >
              <span className="material-symbols-outlined text-[15px] text-amber-400">gavel</span>
              <span>Subasta{auctionLinks.length > 0 ? ` (${auctionLinks.length})` : ''}</span>
            </button>

            {/* Quick Reembolso Button */}
            <button
              type="button"
              onClick={() => setSubView('refund')}
              className="cyber-btn-secondary px-2 py-1 text-[11px] font-bold font-mono text-amber-300 border-amber-500/30 hover:border-amber-400 hover:text-amber-200"
              title="Solicitar reembolso"
            >
              <span className="material-symbols-outlined text-[15px] text-amber-400">account_balance_wallet</span>
              <span className="hidden sm:inline">Reembolso</span>
            </button>

            {/* Segmented View Tabs */}
            <div className="flex items-center bg-[var(--bg-card-subtle)] border border-cyan-500/30 p-0.5 rounded-lg shadow-inner ml-1">
              <button
                type="button"
                onClick={() => setActiveTab('resumen')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-bold whitespace-nowrap transition-all cursor-pointer ${
                  activeTab === 'resumen'
                    ? 'bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-black shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                1. Resumen
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('workflow')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-bold whitespace-nowrap transition-all cursor-pointer ${
                  activeTab === 'workflow'
                    ? 'bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-black shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                2. Flujo ({currentStep}/4)
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('historial')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-bold whitespace-nowrap transition-all cursor-pointer ${
                  activeTab === 'historial'
                    ? 'bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-black shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                3. Historial
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. CALL CENTER WORKFLOW 4-STEP RIBBON (COMPACT SLIM BAR)                  */}
      {/* ========================================================================= */}
      <div className="cyber-card px-3 py-1.5 shadow-sm flex items-center justify-between gap-2 overflow-x-auto custom-scrollbar">
        <div className="flex items-center gap-1.5 text-[10.5px] font-mono font-bold text-cyan-400 shrink-0">
          <span className="material-symbols-outlined text-[15px]">headset_mic</span>
          <span>FLUJO RADAR:</span>
        </div>

        <div className="flex items-center gap-2 flex-1 min-w-[520px] justify-between">
          {workflowSteps.map((step, index) => {
            const isCompleted = currentStep > step.num;
            const isCurrent = currentStep === step.num;
            const isLocked = currentStep < step.num;

            return (
              <React.Fragment key={step.num}>
                <button
                  type="button"
                  onClick={() => setPreviewStep(step.num === currentStep ? null : step.num)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-mono font-bold transition-all cursor-pointer border ${
                    isCurrent
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.3)]'
                      : isCompleted
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                      : 'bg-[var(--bg-card-subtle)] border-cyan-500/10 text-[var(--text-secondary)] opacity-60'
                  }`}
                  title={`${step.title} - ${step.sub}`}
                >
                  <span
                    className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black ${
                      isCompleted
                        ? 'bg-emerald-500 text-slate-950'
                        : isCurrent
                        ? 'bg-cyan-400 text-slate-950'
                        : 'bg-slate-700 text-slate-300'
                    }`}
                  >
                    {isCompleted ? '✓' : isLocked ? '🔒' : step.num}
                  </span>
                  <span className="truncate">{step.num}. {step.title}</span>
                </button>
                {index < workflowSteps.length - 1 && (
                  <span className="text-cyan-500/40 text-xs font-mono">→</span>
                )}
              </React.Fragment>
            );
          })}
        </div>

        <span className="text-[10px] font-mono text-cyan-300 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-500/30 shrink-0">
          Etapa {currentStep}/4
        </span>
      </div>

      {/* ========================================================================= */}
      {/* 3. CONTEXTUAL CLAIM ALERT BANNER (IF IN CLAIM)                            */}
      {/* ========================================================================= */}
      {(order.status === 'reclamo' || (associatedClaim && associatedClaim.status !== 'Resolved')) && (
        <div className="p-2.5 sm:p-3 rounded-2xl bg-red-950/40 border border-red-500/40 shadow-[0_0_15px_rgba(239,68,68,0.2)] flex flex-col gap-2 animate-fade-in">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-red-400">warning</span>
              <div>
                <div className="flex items-center gap-2">
                  <strong className="text-xs font-mono font-bold text-red-200">
                    RECLAMO ACTIVO #{associatedClaim?.id || order.code}
                  </strong>
                  <span className="px-2 py-0.2 rounded text-[10px] font-mono neon-badge-red">
                    {associatedClaim?.status || 'Pendiente'}
                  </span>
                </div>
                {(order.claimReason || associatedClaim?.claimReason) && (
                  <p className="text-[11px] text-red-300 font-mono mt-0.5">
                    Motivo: <strong>{order.claimReason || associatedClaim?.claimReason}</strong>
                  </p>
                )}
              </div>
            </div>

            {/* Claim Action Buttons */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsCallModalOpen(true)}
                className="px-2.5 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 text-xs font-mono font-bold flex items-center gap-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[14px]">phone_in_talk</span>
                <span>Registrar Llamada</span>
              </button>

              <button
                type="button"
                onClick={() => setShowCallHistory(!showCallHistory)}
                className="px-2.5 py-1 rounded-lg bg-[var(--bg-card-subtle)] border border-cyan-500/30 text-cyan-300 text-xs font-mono font-bold flex items-center gap-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[14px]">history</span>
                <span>Bitácora ({associatedClaim?.calls?.length || associatedClaim?.callCount || 0})</span>
              </button>

              <button
                type="button"
                onClick={() => setIsResolveModalOpen(true)}
                className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-xs font-mono font-bold flex items-center gap-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[14px]">check_circle</span>
                <span>Resolver</span>
              </button>

              <button
                type="button"
                onClick={handleDenyClaimFromDetail}
                className="px-2 py-1 rounded-lg bg-red-900/40 hover:bg-red-900/60 border border-red-700/40 text-red-300 text-xs font-mono font-bold cursor-pointer"
              >
                Denegar
              </button>
            </div>
          </div>

          {/* Expandable Call History in Claim */}
          {showCallHistory && (
            <div className="mt-1 pt-2 border-t border-red-500/20 space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
              {!associatedClaim?.calls || associatedClaim.calls.length === 0 ? (
                <p className="text-xs font-mono text-slate-400 py-1">No hay llamadas registradas aún.</p>
              ) : (
                associatedClaim.calls.map((call, idx) => (
                  <div key={call.id || idx} className="p-2 rounded-lg bg-[var(--bg-card-subtle)] border border-red-500/20 text-xs font-mono">
                    <div className="flex justify-between text-[10.5px] text-cyan-300 font-bold">
                      <span>📞 Llamada #{call.callNumber || idx + 1} · {call.attendedBy || 'Operador'}</span>
                      <span className="text-[var(--text-secondary)]">{call.createdAt ? new Date(call.createdAt).toLocaleString('es-ES') : ''}</span>
                    </div>
                    <p className="text-[var(--text-primary)] mt-1">{call.conversationSummary}</p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. CONTEXTUAL AUCTION PANEL (EXPANDABLE)                                  */}
      {/* ========================================================================= */}
      {showAuctionPanel && (
        <div className="cyber-card p-3 shadow-md flex flex-col gap-2.5 animate-fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-amber-400">gavel</span>
              <strong className="text-xs font-mono font-bold text-amber-300">Búsqueda en Subasta ({auctionLinks.length})</strong>
            </div>
            <button
              type="button"
              onClick={() => setShowAuctionPanel(false)}
              className="text-slate-400 hover:text-white p-1 text-xs"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>

          {/* Inline Add Auction Link Form */}
          <form onSubmit={handleAddAuctionLink} className="flex flex-wrap items-center gap-2 bg-[var(--bg-card-subtle)] p-2 rounded-xl border border-cyan-500/20">
            <select
              value={newAuctionHouse}
              onChange={(e) => setNewAuctionHouse(e.target.value as AuctionHouse)}
              className="cyber-input py-1 px-2 text-xs font-mono w-28"
            >
              <option value="Copart">🔵 Copart</option>
              <option value="IAAI">🟡 IAAI</option>
              <option value="Otra">🏛️ Otra</option>
            </select>

            <input
              type="text"
              value={newAuctionUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="https://www.copart.com/lot/..."
              className="cyber-input py-1 px-2 text-xs font-mono flex-1 min-w-[200px]"
            />

            <input
              type="date"
              value={newAuctionDate}
              onChange={(e) => setNewAuctionDate(e.target.value)}
              className="cyber-input py-1 px-2 text-xs font-mono w-32"
            />

            <button
              type="submit"
              disabled={!newAuctionUrl.trim()}
              className="cyber-btn-primary py-1 px-3 text-xs font-bold font-mono"
            >
              + Agregar Link
            </button>
          </form>

          {/* Links List */}
          {auctionLinks.length > 0 && (
            <div className="space-y-1.5 max-h-36 overflow-y-auto custom-scrollbar">
              {auctionLinks.map((link) => (
                <div key={link.id} className="p-2 rounded-lg bg-[var(--bg-card-subtle)] border border-cyan-500/15 flex items-center justify-between gap-2 text-xs font-mono">
                  <div className="flex items-center gap-2 truncate">
                    <span className="font-bold text-amber-300">{link.auctionHouse}:</span>
                    <a href={link.url} target="_blank" rel="noreferrer" className="text-cyan-300 hover:underline truncate">
                      {link.url}
                    </a>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={() => handleCopy(link.url, 'Link')} className="p-1 text-slate-400 hover:text-white">
                      <span className="material-symbols-outlined text-[14px]">content_copy</span>
                    </button>
                    <button type="button" onClick={() => handleRemoveAuctionLink(link.id)} className="p-1 text-red-400 hover:text-red-200">
                      <span className="material-symbols-outlined text-[14px]">delete</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. TAB 1: RESUMEN — ULTRA-COMPACT 3-COLUMN UNIFIED HUD GRID               */}
      {/* ========================================================================= */}
      {activeTab === 'resumen' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 sm:gap-3">
          {/* COLUMN 1: VEHÍCULO & REFACCIÓN */}
          <div className="cyber-card p-3 sm:p-3.5 flex flex-col justify-between gap-2.5 shadow-sm">
            <div className="cyber-laser-bar" />

            <div>
              {/* Card Header: Vehicle + Part pill */}
              <div className="flex items-start justify-between gap-2 pb-2 border-b border-cyan-500/15">
                <div>
                  <span className="text-[10px] font-mono font-bold text-[var(--text-secondary)] uppercase tracking-wider block">
                    VEHÍCULO & PIEZA
                  </span>
                  <h3 className="text-sm sm:text-base font-black text-[var(--text-heading)] tracking-tight leading-tight mt-0.5">
                    {vehicleName}
                  </h3>
                  <p className="text-[11px] text-cyan-400 font-mono font-medium">
                    {vehicleDetails}
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-cyan-950/60 text-cyan-300 border border-cyan-500/30 shrink-0">
                  {partType}
                </span>
              </div>

              {/* Compact 2x2 Specs Grid */}
              <div className="grid grid-cols-2 gap-2 text-xs font-mono mt-2.5">
                {/* VIN */}
                <div className="p-2 rounded-xl bg-[var(--bg-card-subtle)] border border-cyan-500/15">
                  <span className="text-[9.5px] font-bold text-[var(--text-secondary)] uppercase block">VIN</span>
                  <div className="flex items-center justify-between gap-1 mt-0.5">
                    <span className="font-bold text-[var(--text-heading)] truncate text-[11px]">{order.vehicle.vin}</span>
                    <button
                      type="button"
                      onClick={() => handleCopy(order.vehicle.vin, 'VIN')}
                      className="text-cyan-400 hover:text-cyan-200 cursor-pointer p-0.5"
                      title="Copiar VIN"
                    >
                      <span className="material-symbols-outlined text-[13px]">content_copy</span>
                    </button>
                  </div>
                </div>

                {/* STOCK # */}
                <div className="p-2 rounded-xl bg-[var(--bg-card-subtle)] border border-cyan-500/15">
                  <span className="text-[9.5px] font-bold text-[var(--text-secondary)] uppercase block">STOCK #</span>
                  <div className="mt-0.5">
                    {stockAssigned ? (
                      <span className="font-bold text-emerald-400 text-[11px] truncate block">{stockAssigned}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleAssignStock}
                        className="text-amber-400 hover:text-amber-300 font-bold cursor-pointer text-[10.5px]"
                      >
                        + Asignar Stock
                      </button>
                    )}
                  </div>
                </div>

                {/* TIPO ENTREGA */}
                <div className="p-2 rounded-xl bg-[var(--bg-card-subtle)] border border-cyan-500/15">
                  <span className="text-[9.5px] font-bold text-[var(--text-secondary)] uppercase block">ENTREGA</span>
                  <span className="inline-flex items-center gap-1 font-bold text-[var(--text-heading)] text-[11px] mt-0.5">
                    <span className="material-symbols-outlined text-[13px] text-cyan-400">
                      {isHomeDelivery ? 'local_shipping' : 'storefront'}
                    </span>
                    <span>{isHomeDelivery ? 'Envío Domicilio' : 'Retiro Tienda'}</span>
                  </span>
                </div>

                {/* GARANTÍA */}
                <div className="p-2 rounded-xl bg-[var(--bg-card-subtle)] border border-cyan-500/15">
                  <span className="text-[9.5px] font-bold text-[var(--text-secondary)] uppercase block">GARANTÍA</span>
                  <span className="text-emerald-400 font-bold text-[11px] block mt-0.5 truncate">
                    {order.warrantyDays || 60} Días ({warrantyInfo.label.split(' ')[0]})
                  </span>
                </div>
              </div>
            </div>

            {/* Technical Specs & Notes Box */}
            <div className="bg-[var(--bg-card-subtle)] border border-cyan-500/15 rounded-xl p-2 text-xs">
              <span className="text-[9.5px] font-bold uppercase tracking-wider text-[var(--text-secondary)] font-mono block mb-0.5">
                ESPECIFICACIÓN TÉCNICA
              </span>
              <p className="text-[var(--text-secondary)] font-mono text-[10.5px] leading-relaxed line-clamp-2">
                {order.notes || order.productSpecs || '2.4 • 2.4L (VIN B, 8th digit), engine ID ED6'}
              </p>
            </div>
          </div>

          {/* COLUMN 2: CLIENTE CRM & CONTACTO DIRECTO */}
          <div className="cyber-card p-3 sm:p-3.5 flex flex-col justify-between gap-2.5 shadow-sm">
            <div className="cyber-laser-bar" />

            <div>
              {/* Card Header: Client avatar + name */}
              <div className="flex items-start justify-between gap-2 pb-2 border-b border-cyan-500/15">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 font-mono font-black text-xs flex items-center justify-center shrink-0">
                    {order.customer.initials || 'CL'}
                  </div>
                  <div>
                    <span className="text-[10px] font-mono font-bold text-[var(--text-secondary)] uppercase tracking-wider block">
                      CLIENTE CRM
                    </span>
                    <h3 className="text-sm font-black text-[var(--text-heading)] tracking-tight leading-tight">
                      {order.customer.name}
                    </h3>
                  </div>
                </div>

                <span className="px-2 py-0.5 rounded-md text-[9.5px] font-mono font-bold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                  {order.customer.type || 'Individual'}
                </span>
              </div>

              {/* Contact Information Fields */}
              <div className="flex flex-col gap-2 mt-2.5 text-xs font-mono">
                {/* Phone */}
                <div className="p-2 rounded-xl bg-[var(--bg-card-subtle)] border border-cyan-500/15 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-emerald-400">call</span>
                    <div>
                      <span className="text-[9.5px] text-[var(--text-secondary)] block">Teléfono de Contacto</span>
                      <strong className="text-cyan-300 text-xs">{order.customer.phone}</strong>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(order.customer.phone, 'Teléfono')}
                    className="text-slate-400 hover:text-white p-1"
                    title="Copiar teléfono"
                  >
                    <span className="material-symbols-outlined text-[13px]">content_copy</span>
                  </button>
                </div>

                {/* Shipping Address */}
                {order.customer.shippingAddress?.trim() ? (
                  <div className="p-2 rounded-xl bg-[var(--bg-card-subtle)] border border-cyan-500/15 flex items-start gap-2">
                    <span className="material-symbols-outlined text-[16px] text-amber-400 shrink-0 mt-0.5">location_on</span>
                    <div className="min-w-0">
                      <span className="text-[9.5px] text-[var(--text-secondary)] block">Dirección de Envío</span>
                      <span className="text-[var(--text-primary)] text-[11px] leading-tight block line-clamp-2">
                        {order.customer.shippingAddress}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="p-2 rounded-xl bg-[var(--bg-card-subtle)] border border-cyan-500/15 flex items-center gap-2 text-[var(--text-secondary)] text-[11px]">
                    <span className="material-symbols-outlined text-[16px] text-cyan-400">storefront</span>
                    <span>Retiro personal en tienda / almacén</span>
                  </div>
                )}
              </div>
            </div>

            {/* Direct WhatsApp / SMS Action button */}
            <div className="pt-2 border-t border-cyan-500/15">
              <button
                type="button"
                onClick={() => onOpenSMS(order.customer.name, order.customer.phone, order)}
                className="cyber-btn-primary w-full py-2 px-3 text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">chat</span>
                <span>Enviar Mensaje WhatsApp / SMS</span>
              </button>
            </div>
          </div>

          {/* COLUMN 3: FÓRMULA FINANCIERA & DOCUMENTACIÓN OFICIAL */}
          <div className="cyber-card p-3 sm:p-3.5 flex flex-col justify-between gap-2.5 shadow-sm">
            <div className="cyber-laser-bar" />

            <div>
              {/* Card Header */}
              <div className="flex items-center justify-between pb-2 border-b border-cyan-500/15">
                <div>
                  <span className="text-[10px] font-mono font-bold text-[var(--text-secondary)] uppercase tracking-wider block">
                    FÓRMULA FINANCIERA RADAR
                  </span>
                  <h3 className="text-sm font-black text-[var(--text-heading)] tracking-tight">
                    Desglose & Liquidación
                  </h3>
                </div>
                <span className="text-[9.5px] font-mono text-emerald-400 font-bold bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
                  USD
                </span>
              </div>

              {/* Compact Breakdown */}
              <div className="flex flex-col gap-1.5 mt-2.5 text-xs font-mono">
                <div className="flex justify-between items-center px-2 py-1 rounded-lg bg-[var(--bg-card-subtle)] border border-cyan-500/10">
                  <span className="text-[var(--text-secondary)] text-[11px]">Monto Pieza (Base):</span>
                  <strong className="text-[var(--text-primary)]">${partPrice.toFixed(2)}</strong>
                </div>

                <div className="flex justify-between items-center px-2 py-1 rounded-lg bg-[var(--bg-card-subtle)] border border-amber-500/20 text-amber-400">
                  <span className="text-[11px]">Abono / Downpayment:</span>
                  <strong>{downPayment > 0 ? `-$${downPayment.toFixed(2)}` : '$0.00'}</strong>
                </div>

                <div className="flex justify-between items-center px-2 py-1 rounded-lg bg-[var(--bg-card-subtle)] border border-cyan-500/10">
                  <span className="text-[var(--text-secondary)] text-[11px]">Delivery & Flete:</span>
                  <strong className="text-[var(--text-primary)]">${deliveryFee.toFixed(2)}</strong>
                </div>

                <div className="flex justify-between items-center px-2 py-1 rounded-lg bg-[var(--bg-card-subtle)] border border-cyan-500/10">
                  <span className="text-[var(--text-secondary)] text-[11px]">Core Fee (Casco):</span>
                  <strong className="text-[var(--text-primary)]">${coreFee.toFixed(2)}</strong>
                </div>
              </div>
            </div>

            {/* Total Balance Block */}
            <div className="pt-2 border-t border-cyan-500/20">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider font-mono">
                  {downPayment > 0 ? 'BALANCE PENDIENTE' : 'TOTAL ESTIMADO'}
                </span>
                <span className="text-xl sm:text-2xl font-black text-cyan-300 font-mono tracking-tight drop-shadow-[0_0_10px_rgba(6,182,212,0.5)]">
                  ${totalPayable.toFixed(2)}{' '}
                  <span className="text-xs font-normal text-[var(--text-secondary)]">USD</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. TAB 2: FLUJO OPERATIVO CALL CENTER                                    */}
      {/* ========================================================================= */}
      {activeTab === 'workflow' && (
        <div className="cyber-card p-4 shadow-sm flex flex-col gap-3">
          <div className="cyber-laser-bar" />

          <div className="flex items-center justify-between pb-2 border-b border-cyan-500/15">
            <div>
              <span className="text-[11px] font-mono text-cyan-400 font-bold uppercase">
                FLUJO OPERATIVO CALL CENTER (4 ETAPAS)
              </span>
              <h3 className="text-sm font-bold text-[var(--text-heading)]">
                Marca cada paso para avanzar la orden y habilitar garantías
              </h3>
            </div>
            <span className="rounded-lg border border-cyan-500/30 bg-cyan-950/60 px-2.5 py-1 text-xs font-mono font-bold text-cyan-300">
              Paso Activo: {currentStep} de 4
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {workflowSteps.map((step) => {
              const isCompleted = (order.workflowStep || 1) > step.num;
              const isCurrent = (order.workflowStep || 1) === step.num;

              return (
                <div
                  key={step.num}
                  className={`p-3 rounded-xl border flex flex-col justify-between gap-2 transition-all ${
                    isCurrent
                      ? 'bg-cyan-500/15 border-cyan-400 shadow-sm'
                      : isCompleted
                      ? 'bg-emerald-500/10 border-emerald-500/30'
                      : 'bg-[var(--bg-card-subtle)] border-cyan-500/10 opacity-60'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="material-symbols-outlined text-[20px] text-cyan-400">{step.icon}</span>
                    <div>
                      <strong className="text-xs text-[var(--text-heading)] block">{step.num}. {step.title}</strong>
                      <span className="text-[10.5px] text-[var(--text-secondary)] font-mono">{step.sub}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleWorkflowStepCheck(step.num)}
                    disabled={step.num > (order.workflowStep || 1)}
                    className={`w-full py-1.5 px-2 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                      isCompleted
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : isCurrent
                        ? 'cyber-btn-primary'
                        : 'bg-slate-800/40 text-slate-500 border border-slate-700/40 cursor-not-allowed'
                    }`}
                  >
                    {isCompleted ? '✓ Completado' : isCurrent ? 'Completar Paso' : 'Bloqueado'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 7. TAB 3: HISTORIAL DE ACTIVIDADES                                       */}
      {/* ========================================================================= */}
      {activeTab === 'historial' && (
        <div className="cyber-card p-4 shadow-sm flex flex-col gap-3">
          <div className="cyber-laser-bar" />

          <div className="flex items-center justify-between pb-2 border-b border-cyan-500/15">
            <span className="text-xs font-mono text-cyan-400 font-bold uppercase">
              HISTORIAL DE ACTIVIDAD & AUDITORÍA
            </span>
            <span className="text-xs font-mono text-[var(--text-secondary)]">Orden #{order.code}</span>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar text-xs font-mono">
            <div className="p-2.5 rounded-xl bg-[var(--bg-card-subtle)] border border-cyan-500/15 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-[var(--text-primary)]">Creación de la orden en el sistema</span>
              </div>
              <span className="text-[var(--text-secondary)]">{order.createdAt || 'Fecha registrada'}</span>
            </div>

            {order.deliveredAt && (
              <div className="p-2.5 rounded-xl bg-[var(--bg-card-subtle)] border border-cyan-500/15 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400" />
                  <span className="text-[var(--text-primary)]">Entrega física confirmada e inicio de garantía</span>
                </div>
                <span className="text-[var(--text-secondary)]">{new Date(order.deliveredAt).toLocaleDateString('es-ES')}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 8. GLOBAL MODALS & DIALOGS                                               */}
      {/* ========================================================================= */}

      {/* Modal: Apertura de Reclamo */}
      {claimModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="cyber-card w-full max-w-md p-5 border-red-500/50 shadow-[0_0_40px_rgba(239,68,68,0.3)]">
            <div className="flex items-center justify-between border-b border-red-500/20 pb-3 mb-3">
              <div className="flex items-center gap-2 text-red-400 font-mono font-bold text-sm">
                <span className="material-symbols-outlined text-[20px]">warning</span>
                <span>Aperturar Reclamo - Orden #{order.code}</span>
              </div>
              <button
                type="button"
                onClick={() => setClaimModal({ isOpen: false, reason: '', isSaving: false, error: '' })}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-mono font-bold text-[var(--text-secondary)] uppercase block mb-1">
                  Motivo o Falla Reportada por el Cliente
                </label>
                <textarea
                  value={claimModal.reason}
                  onChange={(e) => setClaimModal((prev) => ({ ...prev, reason: e.target.value }))}
                  placeholder="Describe la falla técnica, código OBD o problema reportado..."
                  className="cyber-input w-full h-24 text-xs font-mono"
                  autoFocus
                />
              </div>

              {claimModal.error && (
                <p className="text-xs text-red-400 font-mono font-bold">{claimModal.error}</p>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-cyan-500/15">
                <button
                  type="button"
                  onClick={() => setClaimModal({ isOpen: false, reason: '', isSaving: false, error: '' })}
                  className="cyber-btn-secondary px-3 py-1.5 text-xs font-mono"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmClaimCreation}
                  disabled={claimModal.isSaving || !claimModal.reason.trim()}
                  className="px-4 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-mono font-bold text-xs shadow-md disabled:opacity-40"
                >
                  {claimModal.isSaving ? 'Guardando...' : 'Aperturar Reclamo'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Registrar Llamada en Bitácora */}
      {isCallModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="cyber-card w-full max-w-lg p-5 border-cyan-500/50 shadow-[0_0_40px_rgba(6,182,212,0.3)]">
            <div className="flex items-center justify-between border-b border-cyan-500/20 pb-3 mb-3">
              <div className="flex items-center gap-2 text-cyan-400 font-mono font-bold text-sm">
                <span className="material-symbols-outlined text-[20px]">phone_in_talk</span>
                <span>Registrar Interacción Telefónica</span>
              </div>
              <button
                type="button"
                onClick={() => setIsCallModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleRegisterCall} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-mono text-[var(--text-secondary)] uppercase block mb-1">Cliente</label>
                  <input
                    type="text"
                    value={callForm.callerName}
                    onChange={(e) => setCallForm((prev) => ({ ...prev, callerName: e.target.value }))}
                    className="cyber-input w-full text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-[var(--text-secondary)] uppercase block mb-1">Teléfono</label>
                  <input
                    type="text"
                    value={callForm.callerPhone}
                    onChange={(e) => setCallForm((prev) => ({ ...prev, callerPhone: e.target.value }))}
                    className="cyber-input w-full text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-mono text-[var(--text-secondary)] uppercase block mb-1">Resumen de la Conversación</label>
                <textarea
                  value={callForm.summary}
                  onChange={(e) => setCallForm((prev) => ({ ...prev, summary: e.target.value }))}
                  placeholder="Detalles acordados con el cliente durante la llamada..."
                  className="cyber-input w-full h-24 text-xs font-mono"
                  required
                  autoFocus
                />
              </div>

              {callForm.error && (
                <p className="text-xs text-red-400 font-mono">{callForm.error}</p>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-cyan-500/15">
                <button
                  type="button"
                  onClick={() => setIsCallModalOpen(false)}
                  className="cyber-btn-secondary px-3 py-1.5 text-xs font-mono"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={callForm.isSubmitting || !callForm.summary.trim()}
                  className="cyber-btn-primary px-4 py-1.5 text-xs font-mono font-bold disabled:opacity-40"
                >
                  {callForm.isSubmitting ? 'Guardando...' : 'Guardar en Bitácora'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Resolver Reclamo */}
      {isResolveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="cyber-card w-full max-w-md p-5 border-emerald-500/50 shadow-[0_0_40px_rgba(16,185,129,0.3)]">
            <div className="flex items-center justify-between border-b border-emerald-500/20 pb-3 mb-3">
              <div className="flex items-center gap-2 text-emerald-400 font-mono font-bold text-sm">
                <span className="material-symbols-outlined text-[20px]">check_circle</span>
                <span>Resolver Reclamo - Orden #{order.code}</span>
              </div>
              <button
                type="button"
                onClick={() => setIsResolveModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleResolveClaimFromDetail} className="space-y-3">
              <div>
                <label className="text-xs font-mono font-bold text-[var(--text-secondary)] uppercase block mb-1">
                  Restaurar Orden a Estado:
                </label>
                <select
                  value={resolveForm.targetStatus}
                  onChange={(e) => setResolveForm((prev) => ({ ...prev, targetStatus: e.target.value as OrderStatus }))}
                  className="cyber-input w-full text-xs font-mono"
                >
                  <option value="entregado">🟢 Entregado (Garantía Activa)</option>
                  <option value="despachado">🚚 Despachado</option>
                  <option value="pagado">💳 Pagado</option>
                  <option value="cotizacion">📋 Cotización</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-cyan-500/15">
                <button
                  type="button"
                  onClick={() => setIsResolveModalOpen(false)}
                  className="cyber-btn-secondary px-3 py-1.5 text-xs font-mono"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={resolveForm.isSubmitting}
                  className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold text-xs shadow-md"
                >
                  {resolveForm.isSubmitting ? 'Procesando...' : 'Confirmar Resolución'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Autorización OTP Wasender para estados protegidos */}
      <SecurityOtpModal
        isOpen={securityModal.isOpen}
        onClose={() => setSecurityModal((prev) => ({ ...prev, isOpen: false }))}
        onSuccess={handleSecuritySuccess}
        actionTitle={securityModal.actionTitle}
        actionDescription={securityModal.actionDescription}
      />
    </div>
  );
};
