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
  const isTransmission = /transmi|transmission|gearbox|caja de cambios/i.test(partType);
  const partImageUrl = isTransmission
    ? 'https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?w=800&auto=format&fit=crop&q=80'
    : 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?w=800&auto=format&fit=crop&q=80';
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
        label: `🟢 Vigente (${daysLeft} días restantes)`,
      };
    } else if (daysLeft > 0) {
      return {
        daysLeft,
        badgeClass: 'neon-badge-amber',
        label: `🟡 Crítica (${daysLeft} días restantes)`,
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
    void fetchAssociatedClaim();
  }, [order.id, order.code, order.status]);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    handleToast(`${label} copiado al portapapeles`);
  };

  const handleToast = (msg: string) => {
    setCopiedNotification(msg);
    setTimeout(() => setCopiedNotification(null), 3000);
  };

  const handleToggleAuction = () => {
    const nextState = !isAuctionActive;
    setIsAuctionActive(nextState);
    if (onUpdateOrder) {
      onUpdateOrder({
        ...order,
        auctionActive: nextState,
        auctionLinks,
      });
    }
    if (nextState) {
      handleToast('🔨 Búsqueda en Subasta activada');
    } else {
      handleToast('Búsqueda en Subasta desactivada');
    }
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

    handleToast(`✅ Enlace de subasta (${newAuctionHouse}) agregado con éxito`);
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
      setCopiedNotification(`📞 Llamada #${newCallNumber} registrada en bitácora.`);
      setTimeout(() => setCopiedNotification(null), 3000);
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
      setCopiedNotification(`🟢 Reclamo resuelto. Orden restaurada a '${ORDER_STATUS_LABELS[resolveForm.targetStatus]}'.`);
      setTimeout(() => setCopiedNotification(null), 3500);
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
      setCopiedNotification(`🔴 Garantía denegada para reclamo.`);
      setTimeout(() => setCopiedNotification(null), 3000);
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

    // Direct transition out of reclamo from dropdown
    if (order.status === 'reclamo') {
      if (associatedClaim?.id) {
        const claimNum = associatedClaim.id.replace('REC-', '');
        apiFetch(`/claims/${claimNum}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'Resolved',
            orderId: Number(order.id),
            previousOrderStatus: newStatus,
          }),
        }).catch(() => {});
        setAssociatedClaim((prev) => (prev ? { ...prev, status: 'Resolved' as ClaimStatus } : null));
      }
      if (onUpdateOrder) {
        onUpdateOrder({
          ...order,
          status: newStatus,
          claimReason: undefined,
          deliveredAt: newStatus === 'entregado' ? (order.deliveredAt || new Date().toISOString()) : order.deliveredAt,
        });
      }
      setCopiedNotification(`ℹ️ Estatus cambiado a '${ORDER_STATUS_LABELS[newStatus]}'.`);
      setTimeout(() => setCopiedNotification(null), 3000);
      return;
    }

    if (onUpdateOrder) {
      onUpdateOrder({
        ...order,
        status: newStatus,
        deliveredAt: newStatus === 'entregado' ? new Date().toISOString() : order.deliveredAt,
      });
    }
  };

  const handleSubmitClaim = async (event: React.FormEvent) => {
    event.preventDefault();
    const reason = claimModal.reason.trim();
    if (!reason) {
      setClaimModal((previous) => ({ ...previous, error: 'Escribe el motivo del reclamo antes de continuar.' }));
      return;
    }

    setClaimModal((previous) => ({ ...previous, isSaving: true, error: '' }));
    try {
      if (onCreateClaim) {
        await onCreateClaim(order.id, reason);
      } else if (onUpdateOrder) {
        onUpdateOrder({ ...order, status: 'reclamo', claimReason: reason });
      }
      void fetchAssociatedClaim();
      setClaimModal({ isOpen: false, reason: '', isSaving: false, error: '' });
      setCopiedNotification('🚨 Reclamo creado con éxito.');
      setTimeout(() => setCopiedNotification(null), 3000);
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
  };

  const workflowSteps = [
    {
      num: 1,
      title: 'Términos y Condiciones',
      sub: 'Notificación & Comprobante',
      desc: 'Envío de cotización formal, términos de garantía y registro de captura de envío.',
      icon: 'verified_user',
    },
    {
      num: 2,
      title: 'Acuse de Términos',
      sub: 'Llamada o Chat (2-3 días)',
      desc: 'Confirmación verbal o comprobante digital de acuse recibido por el cliente.',
      icon: 'support_agent',
    },
    {
      num: 3,
      title: 'Coordinación de Cita',
      sub: 'Pieza Lista & Agenda',
      desc: 'Programación de fecha/hora de retiro o delivery con gestión de prórrogas.',
      icon: 'calendar_month',
    },
    {
      num: 4,
      title: 'Cierre Operativo',
      sub: 'Checklist & Garantía',
      desc: 'Verificación física, factura emitida, control de CORE e inicio de garantía.',
      icon: 'task_alt',
    },
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
    <div className="radar-view text-[#dfe2ef] pb-10 select-none space-y-6">
      {/* 1. TOP HEADER & BREADCRUMB ROW (CYBER HUD CARD) */}
      <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 shadow-[0_0_14px_#22d3ee]" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex items-start gap-4">
            <button
              type="button"
              onClick={onBack}
              className="mt-1 p-2.5 rounded-xl bg-[#040814] border border-cyan-500/30 text-cyan-400 hover:text-white hover:bg-cyan-500/20 hover:border-cyan-400 transition-all cursor-pointer shadow-[0_0_12px_rgba(6,182,212,0.2)]"
              title="Volver al listado"
            >
              <span className="material-symbols-outlined text-[20px]">arrow_back</span>
            </button>

            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center gap-2">
                  <span>Orden</span>
                  <span className="text-cyan-400 font-mono drop-shadow-[0_0_12px_rgba(34,211,238,0.4)]">
                    #{order.code}
                  </span>
                </h1>

                {/* Status Dropdown */}
                <div className="relative inline-flex items-center">
                  <select
                    value={order.status}
                    onChange={(e) => handleStatusChange(e.target.value as OrderStatus)}
                    aria-label="Estado actual de la orden"
                    className="appearance-none bg-[#040814]/90 border border-cyan-500/40 text-cyan-300 font-mono font-bold text-xs rounded-xl pl-3.5 pr-8 py-1.5 focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/30 cursor-pointer shadow-[0_0_12px_rgba(6,182,212,0.2)] uppercase tracking-wider"
                  >
                    {statusOptions.map((status) => (
                      <option key={status} value={status} className="bg-[#070c18] text-white">
                        {status === order.status ? `● ${ORDER_STATUS_LABELS[status]}` : ORDER_STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined text-cyan-400 text-[18px] absolute right-2 pointer-events-none">
                    arrow_drop_down
                  </span>
                </div>

                {/* Downpayment Badge */}
                {downPayment === 0 ? (
                  <span className="px-3 py-1 rounded-xl text-xs font-mono font-bold neon-badge-red flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                    <span>Sin Abono ($0.00)</span>
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-xl text-xs font-mono font-bold neon-badge-emerald flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Abono: ${downPayment.toFixed(2)}</span>
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs text-slate-400 mt-2 font-mono">
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[15px] text-cyan-400">schedule</span>
                  <span>{order.createdAt || '24 Oct 2026, 14:32'}</span>
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[15px] text-cyan-400">person</span>
                  <span>Asesor: <strong className="text-cyan-300">{order.advisor || 'Carlos Mendoza'}</strong></span>
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[15px] text-cyan-400">
                    {isHomeDelivery ? 'local_shipping' : 'storefront'}
                  </span>
                  <span>{isHomeDelivery ? 'Envío a Domicilio' : 'Retiro en Tienda'}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Top Right Action & Segmented Tabs */}
          <div className="flex flex-wrap items-center gap-2.5 self-start lg:self-center">
            {/* Action: Buscar en Subasta */}
            <button
              type="button"
              onClick={handleToggleAuction}
              className={`px-3 py-2 rounded-xl text-xs font-bold font-mono flex items-center gap-1.5 transition-all cursor-pointer border ${
                isAuctionActive
                  ? 'bg-amber-500/20 border-amber-400 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.3)]'
                  : 'cyber-btn-secondary text-slate-300 hover:text-white'
              }`}
              title={isAuctionActive ? 'Desactivar Búsqueda en Subasta' : 'Activar Búsqueda en Subasta'}
            >
              <span className="material-symbols-outlined text-[16px] text-amber-400">gavel</span>
              <span className="hidden sm:inline">
                {isAuctionActive ? 'Subasta Activa' : 'Buscar en Subasta'}
              </span>
            </button>

            {/* Action: Solicitar Reembolso */}
            <button
              type="button"
              onClick={() => setSubView('refund')}
              className="cyber-btn-secondary px-3 py-2 text-xs font-bold font-mono flex items-center gap-1.5 text-amber-300 border-amber-500/30 hover:border-amber-400 hover:text-amber-200 shadow-[0_0_10px_rgba(245,158,11,0.15)]"
              title="Solicitar Reembolso de la Orden"
            >
              <span className="material-symbols-outlined text-[16px] text-amber-400">account_balance_wallet</span>
              <span className="hidden sm:inline">Solicitar Reembolso</span>
            </button>


            {/* Segmented Tabs */}
            <div className="flex items-center bg-[#040814] border border-cyan-500/30 p-1 rounded-2xl shadow-inner">
              <button
                type="button"
                onClick={() => setActiveTab('resumen')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold whitespace-nowrap transition-all cursor-pointer ${
                  activeTab === 'resumen'
                    ? 'bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-black shadow-[0_0_15px_rgba(6,182,212,0.4)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                1. Resumen
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('workflow')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold whitespace-nowrap transition-all cursor-pointer ${
                  activeTab === 'workflow'
                    ? 'bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-black shadow-[0_0_15px_rgba(6,182,212,0.4)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                2. Flujo
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('historial')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold whitespace-nowrap transition-all cursor-pointer ${
                  activeTab === 'historial'
                    ? 'bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-black shadow-[0_0_15px_rgba(6,182,212,0.4)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                3. Historial
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* RECLAMO / CLAIMS TRACKING HUD CARD */}
      {(order.status === 'reclamo' || (associatedClaim && associatedClaim.status !== 'Resolved')) && (
        <div className="relative rounded-3xl bg-[#070c18]/95 backdrop-blur-2xl border border-red-500/40 p-5 md:p-6 shadow-[0_10px_35px_rgba(239,68,68,0.25)] overflow-hidden flex flex-col gap-4">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-red-500 to-rose-400 shadow-[0_0_15px_#ef4444]" />

          {/* Top Info Header */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-red-500/20 border border-red-500/40 text-red-400 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(239,68,68,0.3)]">
                <span className="material-symbols-outlined text-[26px]">headset_mic</span>
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-black text-red-200 tracking-tight font-mono">
                    SEGUIMIENTO DE RECLAMO & GARANTÍA
                  </h2>
                  {associatedClaim && (
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold font-mono bg-red-950/80 text-red-300 border border-red-500/30">
                      {associatedClaim.id}
                    </span>
                  )}
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono ${
                      associatedClaim?.status === 'Resolved'
                        ? 'neon-badge-emerald'
                        : associatedClaim?.status === 'Denied'
                        ? 'neon-badge-red'
                        : associatedClaim?.status === 'In Process'
                        ? 'neon-badge-cyan'
                        : 'neon-badge-amber'
                    }`}
                  >
                    {associatedClaim?.status === 'Resolved'
                      ? '🟢 Resuelto'
                      : associatedClaim?.status === 'Denied'
                      ? '🔴 Denegado'
                      : associatedClaim?.status === 'In Process'
                      ? '🔵 En Proceso'
                      : '🟡 Reclamo Pendiente'}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono bg-cyan-950/70 text-cyan-300 border border-cyan-500/30">
                    📞 {(associatedClaim?.calls?.length || associatedClaim?.callCount || 0)} llamadas
                  </span>
                </div>
                <p className="text-xs text-red-300/80 mt-1">
                  Reclamo activo en el sistema. Puedes registrar interacciones telefónicas con el cliente o resolver el reclamo restaurando la orden.
                </p>
              </div>
            </div>

            {/* Quick Actions Buttons */}
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setCallForm({
                    callerName: order.customer.name || '',
                    callerPhone: order.customer.phone || '',
                    attendedBy: order.advisor || 'Carlos Mendoza',
                    summary: '',
                    sendWhatsApp: true,
                    isSubmitting: false,
                    error: '',
                  });
                  setIsCallModalOpen(true);
                }}
                className="px-3.5 py-2 rounded-xl text-xs font-bold bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 hover:text-white border border-cyan-500/40 transition-all cursor-pointer flex items-center gap-1.5 shadow-[0_0_12px_rgba(6,182,212,0.2)]"
              >
                <span className="material-symbols-outlined text-[16px] text-cyan-400">add_call</span>
                <span>Registrar Llamada</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setResolveForm({
                    targetStatus: (associatedClaim?.previousOrderStatus as OrderStatus) || 'entregado',
                    notes: '',
                    isSubmitting: false,
                  });
                  setIsResolveModalOpen(true);
                }}
                className="px-3.5 py-2 rounded-xl text-xs font-black bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 shadow-[0_0_15px_rgba(16,185,129,0.4)] transition-all cursor-pointer flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                <span>Resolver Reclamo</span>
              </button>

              <button
                type="button"
                onClick={() => handleStatusChange('solicitud_reembolso')}
                className="px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 hover:text-white border border-amber-500/40 transition-all cursor-pointer flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px] text-amber-400">currency_exchange</span>
                <span>Solicitar Reembolso</span>
              </button>

              <button
                type="button"
                onClick={handleDenyClaimFromDetail}
                className="px-3 py-2 rounded-xl text-xs font-bold bg-red-950/60 text-red-400 hover:bg-red-900/60 hover:text-red-200 border border-red-500/30 transition-all cursor-pointer flex items-center gap-1"
                title="Denegar reclamo por violación de garantía"
              >
                <span className="material-symbols-outlined text-[15px]">block</span>
                <span className="hidden sm:inline">Denegar</span>
              </button>
            </div>
          </div>

          {/* Reason Reported Card */}
          {(order.claimReason || associatedClaim?.claimReason) && (
            <div className="p-3.5 rounded-2xl bg-[#040814]/90 border border-red-500/30 text-xs text-red-200 font-mono flex flex-col gap-1">
              <span className="text-red-400 uppercase text-[10px] font-bold tracking-wider flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">warning</span>
                <span>Motivo Reportado por el Cliente:</span>
              </span>
              <p className="text-slate-200">{order.claimReason || associatedClaim?.claimReason}</p>
            </div>
          )}

          {/* Call History Expandable Bar */}
          <div className="pt-2 border-t border-red-500/20 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowCallHistory(!showCallHistory)}
                className="text-xs font-mono font-bold text-cyan-300 hover:text-cyan-200 flex items-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">
                  {showCallHistory ? 'expand_less' : 'history'}
                </span>
                <span>
                  {showCallHistory ? 'Ocultar Historial de Bitácora' : `Ver Bitácora de Llamadas (${associatedClaim?.calls?.length || associatedClaim?.callCount || 0})`}
                </span>
              </button>
              <span className="text-[11px] font-mono text-slate-400">
                Cliente: <strong className="text-white">{order.customer.name}</strong> ({order.customer.phone})
              </span>
            </div>

            {showCallHistory && (
              <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-1 animate-fade-in">
                {!associatedClaim?.calls || associatedClaim.calls.length === 0 ? (
                  <div className="p-4 rounded-xl bg-[#040814] border border-cyan-500/20 text-center text-xs text-slate-400 font-mono">
                    No hay llamadas registradas aún para este reclamo. Haz clic en <strong>"Registrar Llamada"</strong> para añadir la primera interacción.
                  </div>
                ) : (
                  associatedClaim.calls.map((call, idx) => (
                    <div
                      key={call.id || idx}
                      className="p-3 rounded-xl bg-[#040814] border border-cyan-500/25 flex flex-col gap-1.5 text-xs text-slate-300 font-mono"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                        <span className="font-bold text-cyan-300">
                          📞 Llamada #{call.callNumber || (associatedClaim.calls.length - idx)} · Atendió: <span className="text-white">{call.attendedBy || 'Operador'}</span>
                        </span>
                        <span>{call.createdAt ? new Date(call.createdAt).toLocaleString('es-ES') : 'Fecha no registrada'}</span>
                      </div>
                      <p className="text-slate-100 text-xs">{call.conversationSummary}</p>
                      {call.whatsappDispatched && (
                        <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-bold">
                          <span className="material-symbols-outlined text-[13px]">check_circle</span>
                          <span>Notificación WhatsApp Wasender Enviada</span>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* AUCTION SEARCH HUD CARD (BÚSQUEDA EN SUBASTA ACTIVA) */}
      {isAuctionActive && (
        <div className="relative rounded-3xl bg-[#070c18]/95 backdrop-blur-2xl border border-cyan-500/35 p-5 md:p-6 shadow-[0_10px_35px_rgba(6,182,212,0.2)] overflow-hidden flex flex-col gap-4 animate-fade-in">
          <div className="absolute top-0 inset-x-0 h-[2.5px] bg-gradient-to-r from-transparent via-cyan-400 to-blue-500 shadow-[0_0_15px_#22d3ee]" />

          {/* Top Info Header */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-cyan-500/15 border border-cyan-500/35 text-cyan-400 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
                <span className="material-symbols-outlined text-[22px]">gavel</span>
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-black text-cyan-200 tracking-tight font-mono flex items-center gap-2">
                  <span className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-cyan-400">link</span>
                    <span>Búsqueda en Subasta Activa</span>
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono bg-cyan-950/80 text-cyan-300 border border-cyan-500/30">
                    {auctionLinks.length} {auctionLinks.length === 1 ? 'enlace registrado' : 'enlaces registrados'}
                  </span>
                </h3>
              </div>
            </div>

            <button
              type="button"
              onClick={handleToggleAuction}
              className="px-3 py-1.5 rounded-xl bg-[#040814] hover:bg-red-950/50 border border-cyan-500/20 hover:border-red-500/40 text-slate-400 hover:text-red-300 text-xs font-mono transition-all cursor-pointer flex items-center gap-1"
              title="Desactivar búsqueda en subasta"
            >
              <span className="material-symbols-outlined text-[15px]">close</span>
              <span className="hidden sm:inline">Desactivar</span>
            </button>
          </div>

          {/* Add Link Form */}
          <form onSubmit={handleAddAuctionLink} className="space-y-3 bg-[#040814]/80 p-3.5 sm:p-4 rounded-2xl border border-cyan-500/20">
            {/* Controls Bar: Auction House Selector & Buy Now Checkbox */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
              {/* Auction House Selector */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1">
                  <span className="material-symbols-outlined text-[15px] text-cyan-400">account_balance</span>
                  <span>Subasta:</span>
                </span>
                <div className="flex items-center gap-1.5 bg-[#070c18] p-1 rounded-xl border border-cyan-500/20">
                  <button
                    type="button"
                    onClick={() => setNewAuctionHouse('Copart')}
                    className={`px-3 py-1 rounded-lg text-xs font-mono font-black transition-all cursor-pointer flex items-center gap-1 ${
                      newAuctionHouse === 'Copart'
                        ? 'bg-blue-600 text-white shadow-[0_0_12px_rgba(37,99,235,0.5)] border border-blue-400'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <span>🔵</span>
                    <span>Copart</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewAuctionHouse('IAAI')}
                    className={`px-3 py-1 rounded-lg text-xs font-mono font-black transition-all cursor-pointer flex items-center gap-1 ${
                      newAuctionHouse === 'IAAI'
                        ? 'bg-amber-600 text-white shadow-[0_0_12px_rgba(217,119,6,0.5)] border border-amber-400'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <span>🟡</span>
                    <span>IAAI</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewAuctionHouse('Otra')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                      newAuctionHouse === 'Otra'
                        ? 'bg-slate-700 text-white border border-slate-500'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Otra
                  </button>
                </div>
              </div>

              {/* Buy Now Checkbox & Price Field */}
              <div className="flex items-center flex-wrap gap-2.5">
                <label className="flex items-center gap-2 cursor-pointer select-none bg-[#070c18] px-3 py-1.5 rounded-xl border border-cyan-500/20 hover:border-emerald-500/40 transition-colors">
                  <input
                    type="checkbox"
                    checked={newHasBuyNow}
                    onChange={(e) => setNewHasBuyNow(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-500 focus:ring-emerald-400/30 accent-emerald-500 cursor-pointer"
                  />
                  <span className="text-xs font-mono font-bold text-emerald-300 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[15px] text-emerald-400">bolt</span>
                    <span>Tiene Compra Rápida (Buy Now)</span>
                  </span>
                </label>

                {newHasBuyNow && (
                  <div className="flex items-center gap-1.5 animate-fade-in">
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-emerald-400 font-mono font-bold text-xs">
                        $
                      </span>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={newBuyNowPrice}
                        onChange={(e) => setNewBuyNowPrice(e.target.value)}
                        placeholder="Monto Buy Now"
                        className="cyber-input pl-6 pr-3 py-1 text-xs font-mono text-emerald-300 focus:border-emerald-400 focus:ring-emerald-400/30 w-36"
                        autoFocus
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* URL Input, Auction Date, and Submit Button */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-7 space-y-1">
                <label className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider block">
                  URL (Link de {newAuctionHouse})
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined text-slate-500 text-[18px] absolute left-3 top-1/2 -translate-y-1/2">
                    link
                  </span>
                  <input
                    type="text"
                    value={newAuctionUrl}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    placeholder={`https://www.${newAuctionHouse.toLowerCase() === 'iaai' ? 'iaai' : 'copart'}.com/lot/...`}
                    className="cyber-input w-full pl-9 pr-3 py-2 text-xs font-mono text-cyan-200 focus:border-cyan-400 focus:ring-cyan-400/30"
                  />
                </div>
              </div>

              <div className="sm:col-span-3 space-y-1">
                <label className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider block">
                  Fecha de Subasta
                </label>
                <input
                  type="date"
                  value={newAuctionDate}
                  onChange={(e) => setNewAuctionDate(e.target.value)}
                  className="cyber-input w-full py-2 px-3 text-xs font-mono text-cyan-200 focus:border-cyan-400 focus:ring-cyan-400/30"
                />
              </div>

              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={!newAuctionUrl.trim()}
                  className="w-full py-2.5 rounded-xl text-xs font-black bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 shadow-[0_0_15px_rgba(6,182,212,0.35)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1 transition-all active:scale-95"
                  title="Añadir enlace de subasta"
                >
                  <span className="material-symbols-outlined text-[18px]">add</span>
                  <span className="font-mono">Añadir</span>
                </button>
              </div>
            </div>
          </form>

          {/* Registered Links List */}
          <div className="border-t border-cyan-500/15 pt-2">
            {auctionLinks.length === 0 ? (
              <p className="text-xs font-mono text-slate-400 py-1 italic">
                No hay enlaces activos registrados.
              </p>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar">
                {auctionLinks.map((link) => (
                  <div
                    key={link.id}
                    className="p-2.5 rounded-xl bg-[#040814] border border-cyan-500/20 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center flex-wrap gap-2.5 min-w-0 flex-1">
                      {/* Auction House Tag */}
                      <span
                        className={`px-2.5 py-0.5 rounded-lg text-[10.5px] font-mono font-black border shrink-0 ${
                          link.auctionHouse === 'IAAI'
                            ? 'bg-amber-950/80 border-amber-500/40 text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.3)]'
                            : link.auctionHouse === 'Copart'
                            ? 'bg-blue-950/80 border-blue-500/40 text-blue-300 shadow-[0_0_8px_rgba(59,130,246,0.3)]'
                            : 'bg-slate-800 border-slate-700 text-slate-300'
                        }`}
                      >
                        {link.auctionHouse === 'IAAI' ? '🟡 IAAI' : link.auctionHouse === 'Copart' ? '🔵 Copart' : '🏛️ Subasta'}
                      </span>

                      {/* URL Anchor */}
                      <div className="flex items-center gap-1 min-w-0 max-w-full sm:max-w-md">
                        <span className="material-symbols-outlined text-[16px] text-cyan-400 shrink-0">
                          open_in_new
                        </span>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-cyan-300 hover:text-cyan-100 underline truncate font-mono text-xs font-medium"
                          title={link.url}
                        >
                          {link.url}
                        </a>
                      </div>

                      {/* Auction Date Badge */}
                      {link.auctionDate && (
                        <span className="px-2.5 py-0.5 rounded-lg bg-cyan-950/80 border border-cyan-500/30 text-[10.5px] font-mono text-cyan-300 shrink-0 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[13px]">calendar_today</span>
                          <span>{link.auctionDate}</span>
                        </span>
                      )}

                      {/* Buy Now Badge */}
                      {link.hasBuyNow && (
                        <span className="px-2.5 py-0.5 rounded-lg bg-emerald-950/90 border border-emerald-500/40 text-[10.5px] font-mono text-emerald-300 font-bold shrink-0 flex items-center gap-1 shadow-[0_0_10px_rgba(16,185,129,0.3)]">
                          <span className="material-symbols-outlined text-[13px] text-emerald-400">bolt</span>
                          <span>
                            Buy Now: <strong className="text-white">${Number(link.buyNowPrice || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
                          </span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopy(link.url, 'Enlace de subasta')}
                        className="p-1.5 rounded-lg bg-[#070c18] border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 cursor-pointer transition-all"
                        title="Copiar URL"
                      >
                        <span className="material-symbols-outlined text-[15px]">content_copy</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveAuctionLink(link.id)}
                        className="p-1.5 rounded-lg bg-[#070c18] border border-red-500/20 text-red-400 hover:text-red-200 hover:bg-red-950/40 cursor-pointer transition-all"
                        title="Eliminar enlace"
                      >
                        <span className="material-symbols-outlined text-[15px]">delete</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. CALL CENTER WORKFLOW STEPPER (4 PROGRESSIVE STAGES) */}
      <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col gap-4">
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_10px_#22d3ee]" />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold tracking-widest text-cyan-300 font-mono uppercase">
            <span className="material-symbols-outlined text-cyan-400 text-[18px]">headset_mic</span>
            <span>FLUJO OPERATIVO CALL CENTER RADAR (4 ETAPAS)</span>
          </div>
          <span className="font-mono text-xs font-bold text-cyan-300 bg-cyan-950/60 px-3 py-1 rounded-xl border border-cyan-500/30 shadow-[0_0_8px_rgba(6,182,212,0.2)]">
            Paso Activo: {currentStep} de 4
          </span>
        </div>

        {/* 4 Steps Stepper Timeline with Progressive Lock icons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 relative">
          {workflowSteps.map((step) => {
            const isCompleted = currentStep > step.num;
            const isCurrent = currentStep === step.num;
            const isLocked = currentStep < step.num;

            return (
              <div
                key={step.num}
                className={`p-4 rounded-2xl border transition-all flex flex-col items-center text-center gap-2.5 relative ${
                  isCurrent
                    ? 'bg-[#091428] border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.3)]'
                    : isCompleted
                    ? 'bg-[#06111f] border-emerald-500/40'
                    : 'bg-[#040814]/70 border-cyan-500/10 opacity-50'
                }`}
              >
                {/* Step Circle Node */}
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-transform ${
                    isCompleted
                      ? 'bg-emerald-500 text-slate-950 shadow-[0_0_15px_rgba(16,185,129,0.5)]'
                      : isCurrent
                      ? 'border-2 border-cyan-400 bg-cyan-950/80 text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.5)] animate-pulse'
                      : 'bg-[#0d182e] text-slate-500 border border-slate-700'
                  }`}
                >
                  {isCompleted ? (
                    <span className="material-symbols-outlined text-[22px] font-black">check</span>
                  ) : isLocked ? (
                    <span className="material-symbols-outlined text-[18px] text-slate-500">lock</span>
                  ) : (
                    <span className="font-mono font-black">{step.num}</span>
                  )}
                </div>

                <div>
                  <h4
                    className={`font-bold text-xs sm:text-sm tracking-tight ${
                      isCurrent ? 'text-cyan-300' : isCompleted ? 'text-emerald-300' : 'text-slate-400'
                    }`}
                  >
                    {step.title}
                  </h4>
                  <span className="text-[11px] text-slate-400 block font-mono mt-0.5">{step.sub}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: RESUMEN                                                           */}
      {/* ========================================================================= */}
      {activeTab === 'resumen' && (
        <div className="flex flex-col gap-6">
          {/* Main 3 Column Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Card 1: Refacción y Vehículo */}
            <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.6)] flex flex-col justify-between gap-4 overflow-hidden group">
              <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#22d3ee]" />

              {/* Vehicle Banner Background image */}
              <div className="relative h-40 rounded-2xl overflow-hidden bg-gradient-to-t from-[#070c18] via-[#070c18]/60 to-transparent flex items-end p-4 border border-cyan-500/20">
                <img
                  src={partImageUrl}
                  alt={isTransmission ? 'Transmisión automotriz' : 'Motor automotriz'}
                  className="absolute inset-0 w-full h-full object-cover object-center opacity-40 group-hover:scale-105 transition-transform duration-700"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#070c18] via-transparent to-transparent" />
                <div className="relative z-10">
                  <h3 className="text-xl font-black text-white tracking-tight">{vehicleName}</h3>
                  <p className="text-xs text-cyan-300 font-mono font-medium mt-0.5">{vehicleDetails}</p>
                </div>
              </div>

              {/* Specs Grid */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 rounded-xl bg-[#040814] border border-cyan-500/15">
                  <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider block">
                    VIN
                  </span>
                  <div className="flex items-center justify-between gap-1 mt-1">
                    <span className="font-mono font-bold text-white truncate text-[11px]">
                      {order.vehicle.vin}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(order.vehicle.vin, 'VIN')}
                      className="text-cyan-400 hover:text-cyan-200 cursor-pointer p-0.5"
                      title="Copiar VIN"
                    >
                      <span className="material-symbols-outlined text-[14px]">content_copy</span>
                    </button>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-[#040814] border border-cyan-500/15">
                  <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider block">
                    STOCK #
                  </span>
                  <div className="mt-1">
                    {stockAssigned ? (
                      <span className="font-mono font-bold text-emerald-300 text-[11px] block truncate">
                        {stockAssigned}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleAssignStock}
                        className="text-amber-400 hover:text-amber-300 font-bold cursor-pointer transition-colors text-[11px] font-mono"
                      >
                        + Asignar Stock
                      </button>
                    )}
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-[#040814] border border-cyan-500/15">
                  <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider block">
                    PIEZA PRINCIPAL
                  </span>
                  <span className="font-bold text-cyan-300 block mt-1 truncate">{partType}</span>
                </div>

                <div className="p-2.5 rounded-xl bg-[#040814] border border-cyan-500/15">
                  <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider block">
                    TIPO DE ENTREGA
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-white mt-1">
                    <span className="material-symbols-outlined text-[15px] text-cyan-400">
                      {isHomeDelivery ? 'local_shipping' : 'storefront'}
                    </span>
                    <span>{isHomeDelivery ? 'Envío' : 'Retiro en Tienda'}</span>
                  </span>
                </div>
              </div>

              {/* Technical Description Box */}
              <div className="bg-[#040814] border border-cyan-500/20 rounded-2xl p-3.5 text-xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono block mb-1">
                  ESPECIFICACIONES & DESCRIPCIÓN TÉCNICA
                </span>
                <p className="text-slate-300 font-mono text-[11px] leading-relaxed">
                  {order.notes || order.productSpecs || '2.4 • 2.4L (VIN B, 8th digit), engine ID ED6 (Federal)'}
                </p>
              </div>
            </div>

            {/* Card 2: Perfil del Cliente */}
            <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.6)] flex flex-col justify-between gap-4 overflow-hidden">
              <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#22d3ee]" />

              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.2)]">
                      <span className="material-symbols-outlined text-[18px]">person</span>
                    </div>
                    <h3 className="font-bold text-base text-white font-mono uppercase tracking-wider">
                      Datos de Cliente
                    </h3>
                  </div>
                  <div className="w-9 h-9 rounded-full bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 font-extrabold text-xs flex items-center justify-center shadow-[0_0_10px_rgba(6,182,212,0.3)]">
                    {order.customer.initials || 'SA'}
                  </div>
                </div>

                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono block mt-2">
                  CLIENTE REGISTRADO (CRM)
                </span>

                <div className="flex flex-col gap-3 mt-4 text-xs">
                  <div className="p-3 rounded-xl bg-[#040814] border border-cyan-500/15 flex items-center gap-3">
                    <span className="material-symbols-outlined text-[18px] text-cyan-400">badge</span>
                    <div>
                      <span className="text-[10px] text-slate-400 block font-mono">Nombre</span>
                      <strong className="text-white text-xs">{order.customer.name}</strong>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-[#040814] border border-cyan-500/15 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-[18px] text-emerald-400">call</span>
                      <div>
                        <span className="text-[10px] text-slate-400 block font-mono">Teléfono</span>
                        <strong className="font-mono text-cyan-300 text-xs">{order.customer.phone}</strong>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy(order.customer.phone, 'Teléfono')}
                      className="text-slate-400 hover:text-white p-1"
                      title="Copiar teléfono"
                    >
                      <span className="material-symbols-outlined text-[14px]">content_copy</span>
                    </button>
                  </div>

                  {order.customer.shippingAddress?.trim() && (
                    <div className="p-3 rounded-xl bg-[#040814] border border-cyan-500/15 flex items-start gap-3">
                      <span className="material-symbols-outlined text-[18px] text-amber-400 shrink-0 mt-0.5">location_on</span>
                      <div>
                        <span className="text-[10px] text-slate-400 block font-mono">Dirección de Envío</span>
                        <span className="text-slate-300 text-xs leading-relaxed">{order.customer.shippingAddress}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Button: SMS */}
              <div className="pt-2 border-t border-cyan-500/15">
                <button
                  type="button"
                  onClick={() => onOpenSMS(order.customer.name, order.customer.phone, order)}
                  className="cyber-btn-primary w-full py-2.5 px-3 text-xs font-black flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px]">chat</span>
                  <span>Enviar Mensaje SMS / WhatsApp</span>
                </button>
              </div>
            </div>

            {/* Card 3: Resumen Financiero */}
            <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.6)] flex flex-col justify-between gap-4 overflow-hidden">
              <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_8px_#10b981]" />

              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                      <span className="material-symbols-outlined text-[18px]">account_balance_wallet</span>
                    </div>
                    <h3 className="font-bold text-base text-white font-mono uppercase tracking-wider">
                      Resumen Financiero
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-300 font-bold bg-emerald-950/60 px-2 py-0.5 rounded-lg border border-emerald-500/30">
                    FÓRMULA RADAR
                  </span>
                </div>

                <div className="flex flex-col gap-2.5 mt-4 text-xs">
                  {/* 1. Monto de la Parte */}
                  <div className="flex justify-between items-center p-2 rounded-xl bg-[#040814] border border-cyan-500/10">
                    <span className="text-slate-300">Monto de la Parte</span>
                    <span className="font-mono font-bold text-white">${partPrice.toFixed(2)}</span>
                  </div>

                  {/* 2. Abono o Downpayment */}
                  <div className="flex justify-between items-center p-2 rounded-xl bg-[#040814] border border-amber-500/20 text-amber-300">
                    <span className="font-medium">Abono / Downpayment</span>
                    <span className="font-mono font-bold">
                      {downPayment > 0 ? `-$${downPayment.toFixed(2)}` : '$0.00'}
                    </span>
                  </div>

                  {/* 3. Monto de Delivery */}
                  <div className="flex justify-between items-center p-2 rounded-xl bg-[#040814] border border-cyan-500/10">
                    <span className="text-slate-300">Monto de Delivery</span>
                    <span className="font-mono font-bold text-white">${deliveryFee.toFixed(2)}</span>
                  </div>

                  {/* 4. Monto del Core Fee */}
                  <div className="flex justify-between items-center p-2 rounded-xl bg-[#040814] border border-cyan-500/10">
                    <span className="text-slate-300">Monto del Core Fee</span>
                    <span className="font-mono font-bold text-white">${coreFee.toFixed(2)}</span>
                  </div>

                  <div className="flex justify-between items-center pt-1 text-xs font-mono">
                    <span className="text-slate-400">Subtotal de Cargos:</span>
                    <span className="font-bold text-slate-300">${grossSubtotal.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* 5. Glowing Big Total Box */}
              <div className="border-t border-cyan-500/20 pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono block">
                    {downPayment > 0 ? 'BALANCE PENDIENTE' : 'TOTAL ESTIMADO'}
                  </span>
                  {downPayment > 0 && (
                    <span className="text-[10px] font-mono text-emerald-300 font-bold">
                      Abono: ${downPayment.toFixed(2)}
                    </span>
                  )}
                </div>
                <h2 className="text-2xl sm:text-3xl font-black text-cyan-300 tracking-tight font-mono drop-shadow-[0_0_15px_rgba(6,182,212,0.6)] mt-1">
                  ${totalPayable.toFixed(2)}{' '}
                  <span className="text-xs font-normal text-slate-400">USD</span>
                </h2>
              </div>
            </div>
          </div>

          {/* Bottom Section: Cobertura de Garantía & Documentación Oficial */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Card 1: Cobertura de Garantía & Semáforo */}
            <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.6)] flex flex-col justify-between gap-4 overflow-hidden">
              <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_8px_#10b981]" />

              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                      <span className="material-symbols-outlined text-[18px]">verified_user</span>
                    </div>
                    <h3 className="font-bold text-base text-white font-mono uppercase tracking-wider">
                      Semáforo de Garantía
                    </h3>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold font-mono border ${warrantyInfo.badgeClass}`}>
                    {warrantyInfo.label}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="bg-[#040814] border border-cyan-500/15 p-3 rounded-2xl">
                    <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider block">
                      PLAN ASIGNADO
                    </span>
                    <span className="text-xs font-bold text-emerald-300 mt-1 block">
                      {order.warrantyDays || 60} Días de Garantía RADAR
                    </span>
                  </div>

                  <div className="bg-[#040814] border border-cyan-500/15 p-3 rounded-2xl">
                    <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider block">
                      FECHA ENTREGA
                    </span>
                    <span className="text-xs font-mono font-bold text-white mt-1 block">
                      {order.deliveredAt ? new Date(order.deliveredAt).toLocaleDateString('es-ES') : 'Pendiente Entrega Física'}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-2.5 mt-4 text-xs text-slate-300">
                  <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-[#040814] border border-cyan-500/10">
                    <span className="material-symbols-outlined text-[16px] text-emerald-400 shrink-0 mt-0.5">
                      check_circle
                    </span>
                    <div>
                      <strong className="text-white block">Tren Motriz Completo</strong>
                      <span className="text-[11px] text-slate-400">Motor, inyección, bloque, empaques y accesorios mecánicos garantizados.</span>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-[#040814] border border-cyan-500/10">
                    <span className="material-symbols-outlined text-[16px] text-emerald-400 shrink-0 mt-0.5">
                      check_circle
                    </span>
                    <div>
                      <strong className="text-white block">Garantía Activa Post-Entrega</strong>
                      <span className="text-[11px] text-slate-400">Válida presentando recibo y número de orden #{order.code}.</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 2: Documentación Oficial & Despacho */}
            <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.6)] flex flex-col justify-between gap-4 overflow-hidden">
              <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#22d3ee]" />

              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.2)]">
                      <span className="material-symbols-outlined text-[18px]">description</span>
                    </div>
                    <h3 className="font-bold text-base text-white font-mono uppercase tracking-wider">
                      Documentación Oficial & Despacho
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono text-cyan-300 font-bold bg-cyan-950/60 px-2 py-0.5 rounded-lg border border-cyan-500/30">
                    RADAR DOCS
                  </span>
                </div>

                <p className="text-xs text-slate-400 mt-2">
                  Generación e impresión de comprobantes oficiales, desglose de montos y rotulado para taller o paquetería.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                  <div className="bg-[#040814] border border-cyan-500/15 p-3.5 rounded-2xl flex flex-col justify-between gap-3">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider block">
                        COMPROBANTE
                      </span>
                      <strong className="text-xs text-white block mt-0.5">Factura / Invoice</strong>
                      <span className="text-[11px] text-slate-400">Desglose con CORE y Downpayment</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSubView('invoice')}
                      className="cyber-btn-secondary w-full py-2 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px] text-cyan-400">receipt</span>
                      <span>Ver Factura</span>
                    </button>
                  </div>

                  <div className="bg-[#040814] border border-cyan-500/15 p-3.5 rounded-2xl flex flex-col justify-between gap-3">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider block">
                        LOGÍSTICA
                      </span>
                      <strong className="text-xs text-white block mt-0.5">Etiqueta 4x6"</strong>
                      <span className="text-[11px] text-slate-400">Rótulo con QR y tipo de entrega</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSubView('dispatch')}
                      className="cyber-btn-secondary w-full py-2 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px] text-emerald-400">qr_code_2</span>
                      <span>Imprimir 4x6</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-[#040814] border border-cyan-500/15 p-3 rounded-2xl flex items-center justify-between text-xs text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-cyan-400">local_shipping</span>
                  <span>Modo: <strong className="text-white">{isHomeDelivery ? 'Envío' : 'Retiro en Tienda'}</strong></span>
                </span>
                <span className="font-mono text-[11px] text-cyan-400">ID: #{order.code}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: FLUJO SIMPLIFICADO                                                */}
      {/* ========================================================================= */}
      {activeTab === 'workflow' && (
        <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] flex flex-col gap-5 overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#22d3ee]" />

          <div className="flex items-center justify-between border-b border-cyan-500/15 pb-4">
            <div>
              <span className="text-xs font-mono text-cyan-400 uppercase font-bold tracking-wider">
                Flujo operativo de la orden
              </span>
              <h2 className="text-lg font-bold text-white mt-0.5">
                Marca cada paso para habilitar el siguiente
              </h2>
            </div>
            <span className="rounded-xl border border-cyan-500/30 bg-cyan-950/60 px-3.5 py-1.5 text-xs font-mono font-bold text-cyan-300">
              Paso activo: {currentStep} de 4
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3.5">
            {workflowSteps.map((step) => {
              const isChecked = step.num < currentStep || (step.num === 4 && order.status === 'entregado');
              const isEnabled = step.num <= currentStep;

              return (
                <label
                  key={step.num}
                  className={`flex items-center gap-4 rounded-2xl border p-4 transition-all ${
                    isEnabled
                      ? 'border-cyan-500/30 bg-[#061122] hover:border-cyan-400 hover:bg-[#091730] cursor-pointer shadow-[0_4px_20px_rgba(0,0,0,0.4)]'
                      : 'border-cyan-500/10 bg-[#040814]/70 opacity-50 cursor-not-allowed'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={!isEnabled || isChecked}
                    onChange={() => handleWorkflowStepCheck(step.num)}
                    className="h-5 w-5 rounded accent-emerald-400 disabled:opacity-60 cursor-pointer"
                  />
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-500/30 bg-[#040814] text-sm font-black text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.2)]">
                    {isChecked ? (
                      <span className="material-symbols-outlined text-[22px] text-emerald-400">check</span>
                    ) : (
                      <span className="font-mono">{step.num}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                      <h3 className="font-bold text-sm text-white">{step.title}</h3>
                      <span className={`text-[10px] font-bold font-mono uppercase tracking-wider ${
                        isChecked ? 'text-emerald-400' : isEnabled ? 'text-cyan-400' : 'text-slate-500'
                      }`}>
                        {isChecked ? 'Completado' : isEnabled ? 'Disponible' : 'Bloqueado'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{step.desc}</p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: HISTORIAL VIEW                                                    */}
      {/* ========================================================================= */}
      {activeTab === 'historial' && (
        <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] flex flex-col gap-5 overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#22d3ee]" />

          <div className="flex items-center gap-2 text-sm font-bold text-white font-mono uppercase tracking-wider">
            <span className="material-symbols-outlined text-cyan-400 text-[20px]">history</span>
            <span>Bitácora de Eventos de la Orden #{order.code}</span>
          </div>

          <div className="flex flex-col gap-3.5 relative pl-6 before:absolute before:left-3 before:top-4 before:bottom-4 before:w-[2px] before:bg-cyan-500/20">
            <div className="bg-[#040814] border border-cyan-500/20 rounded-2xl p-4 flex flex-col gap-1 relative">
              <div className="absolute -left-[27px] top-4 w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-[12px] border border-cyan-500/40">
                <span className="material-symbols-outlined text-[14px]">inventory_2</span>
              </div>
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs text-white">Creación de orden #{order.code}</h4>
                <span className="font-mono text-[11px] text-cyan-400">{order.createdAt || '24 Oct 2026, 14:32'}</span>
              </div>
              <p className="text-xs text-slate-300">
                Vehículo: {vehicleName} • Cliente: {order.customer.name} • Monto Total: ${grossSubtotal.toFixed(2)}
              </p>
            </div>

            <div className="bg-[#040814] border border-cyan-500/20 rounded-2xl p-4 flex flex-col gap-1 relative">
              <div className="absolute -left-[27px] top-4 w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[12px] border border-emerald-500/40">
                <span className="material-symbols-outlined text-[14px]">send</span>
              </div>
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs text-white">Notificación de Nueva Venta disparada (Wasender)</h4>
                <span className="font-mono text-[11px] text-emerald-400">Disparo Único</span>
              </div>
              <p className="text-xs text-slate-300">Alerta transmitida exitosamente a gerencia y taller.</p>
            </div>

            {order.deliveredAt && (
              <div className="bg-[#040814] border border-cyan-500/20 rounded-2xl p-4 flex flex-col gap-1 relative">
                <div className="absolute -left-[27px] top-4 w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[12px] border border-emerald-500/40">
                  <span className="material-symbols-outlined text-[14px]">verified</span>
                </div>
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-xs text-white">Entrega Física y Comienzo de Garantía</h4>
                  <span className="font-mono text-[11px] text-emerald-400">{new Date(order.deliveredAt).toLocaleDateString('es-ES')}</span>
                </div>
                <p className="text-xs text-slate-300">
                  Garantía activa de {order.warrantyDays || 60} días. Reloj en conteo regresivo.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Extension Modal */}
      {showExtensionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-fade-in">
          <div className="bg-[#070c18]/95 backdrop-blur-2xl border border-cyan-500/30 rounded-3xl w-full max-w-md p-6 shadow-2xl flex flex-col gap-4 text-slate-100 relative overflow-hidden">
            <div className="cyber-laser-bar absolute top-0 left-0 right-0 z-20" />
            <h3 className="font-bold text-base text-white flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-400">more_time</span>
              <span>Registrar Prórroga de Retiro</span>
            </h3>
            <textarea
              rows={3}
              value={extensionReason}
              onChange={(e) => setExtensionReason(e.target.value)}
              placeholder="Motivo de la prórroga (ej: Cliente solicitó retirar el fin de semana por motivos laborales)..."
              className="cyber-input w-full resize-none text-xs"
            />
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowExtensionModal(false)}
                className="cyber-btn-secondary px-4 py-2 text-xs"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => setShowExtensionModal(false)}
                className="cyber-btn-primary px-4 py-2 text-xs font-black"
              >
                Guardar Prórroga
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Claim Creation Modal */}
      {claimModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-fade-in">
          <form onSubmit={handleSubmitClaim} className="bg-[#070c18]/95 backdrop-blur-2xl border border-red-500/40 rounded-3xl w-full max-w-lg p-6 shadow-2xl flex flex-col gap-4 text-slate-100 relative overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-red-500 to-transparent shadow-[0_0_12px_#ef4444]" />

            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-base text-white flex items-center gap-2">
                  <span className="material-symbols-outlined text-red-400">report_problem</span>
                  <span>Crear Reclamo Pendiente</span>
                </h3>
                <p className="mt-1 text-xs text-slate-400 font-mono">
                  Orden #{order.code} · {order.customer.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setClaimModal({ isOpen: false, reason: '', isSaving: false, error: '' })}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                disabled={claimModal.isSaving}
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="rounded-2xl border border-red-500/30 bg-red-950/20 p-3.5 text-xs text-red-200">
              Al guardar, la orden pasará a estatus <strong>Reclamo</strong> y se registrará automáticamente en el módulo de Reclamos.
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-200">Motivo del reclamo *</label>
              <textarea
                rows={5}
                value={claimModal.reason}
                onChange={(event) => setClaimModal((previous) => ({ ...previous, reason: event.target.value, error: '' }))}
                placeholder="Describe el problema reportado por el cliente, síntomas, pieza afectada y cualquier detalle operativo..."
                className="cyber-input w-full resize-none text-xs focus:border-red-400 focus:ring-red-400/30"
                disabled={claimModal.isSaving}
              />
            </div>

            {claimModal.error && (
              <div className="rounded-xl border border-red-500/40 bg-red-950/30 px-3.5 py-2 text-xs font-bold text-red-300">
                {claimModal.error}
              </div>
            )}

            <div className="flex justify-end gap-2.5 border-t border-cyan-500/15 pt-4">
              <button
                type="button"
                onClick={() => setClaimModal({ isOpen: false, reason: '', isSaving: false, error: '' })}
                className="cyber-btn-secondary px-4 py-2 text-xs"
                disabled={claimModal.isSaving}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-xs font-black bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-400 hover:to-rose-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)] cursor-pointer disabled:opacity-50"
                disabled={claimModal.isSaving}
              >
                {claimModal.isSaving ? 'Guardando...' : 'Crear Reclamo'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Call Register Modal */}
      {isCallModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-fade-in">
          <form onSubmit={handleRegisterCall} className="bg-[#070c18]/95 backdrop-blur-2xl border border-cyan-500/40 rounded-3xl w-full max-w-lg p-6 shadow-2xl flex flex-col gap-4 text-slate-100 relative overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#22d3ee]" />

            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-base text-white flex items-center gap-2 font-mono">
                  <span className="material-symbols-outlined text-cyan-400">headset_mic</span>
                  <span>Registrar Llamada / Bitácora</span>
                </h3>
                <p className="mt-1 text-xs text-slate-400 font-mono">
                  Orden #{order.code} · Reclamo {associatedClaim?.id || 'Activo'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCallModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                disabled={callForm.isSubmitting}
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-300">Nombre Contacto</label>
                <input
                  type="text"
                  value={callForm.callerName}
                  onChange={(e) => setCallForm({ ...callForm, callerName: e.target.value })}
                  placeholder="Nombre de quien llama..."
                  className="cyber-input w-full text-xs"
                  disabled={callForm.isSubmitting}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-300">Teléfono Contacto</label>
                <input
                  type="text"
                  value={callForm.callerPhone}
                  onChange={(e) => setCallForm({ ...callForm, callerPhone: e.target.value })}
                  placeholder="+1 (555) 000-0000"
                  className="cyber-input w-full text-xs font-mono"
                  disabled={callForm.isSubmitting}
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-300">Atendido por (Operador / Asesor)</label>
              <input
                type="text"
                value={callForm.attendedBy}
                onChange={(e) => setCallForm({ ...callForm, attendedBy: e.target.value })}
                placeholder="Nombre del asesor..."
                className="cyber-input w-full text-xs"
                disabled={callForm.isSubmitting}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-200">Resumen de la Conversación / Acuerdos *</label>
              <textarea
                rows={4}
                value={callForm.summary}
                onChange={(e) => setCallForm({ ...callForm, summary: e.target.value, error: '' })}
                placeholder="Detalla lo acordado con el cliente, pruebas solicitadas, estatus de la pieza..."
                className="cyber-input w-full resize-none text-xs focus:border-cyan-400 focus:ring-cyan-400/30"
                disabled={callForm.isSubmitting}
                required
              />
            </div>

            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-[#040814] border border-cyan-500/20">
              <input
                type="checkbox"
                id="sendWhatsAppLog"
                checked={callForm.sendWhatsApp}
                onChange={(e) => setCallForm({ ...callForm, sendWhatsApp: e.target.checked })}
                className="rounded bg-[#070c18] border-cyan-500/40 text-cyan-500 focus:ring-cyan-400/40 h-4 w-4"
                disabled={callForm.isSubmitting}
              />
              <label htmlFor="sendWhatsAppLog" className="text-xs text-slate-300 cursor-pointer select-none flex items-center gap-1.5">
                <span className="material-symbols-outlined text-emerald-400 text-[16px]">send</span>
                <span>Despachar notificación Wasender a canal de monitoreo interno</span>
              </label>
            </div>

            {callForm.error && (
              <div className="rounded-xl border border-red-500/40 bg-red-950/30 px-3.5 py-2 text-xs font-bold text-red-300">
                {callForm.error}
              </div>
            )}

            <div className="flex justify-end gap-2.5 border-t border-cyan-500/15 pt-4">
              <button
                type="button"
                onClick={() => setIsCallModalOpen(false)}
                className="cyber-btn-secondary px-4 py-2 text-xs"
                disabled={callForm.isSubmitting}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-xs font-black bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 shadow-[0_0_15px_rgba(6,182,212,0.4)] cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                disabled={callForm.isSubmitting}
              >
                <span className="material-symbols-outlined text-[16px]">save</span>
                <span>{callForm.isSubmitting ? 'Guardando...' : 'Guardar Llamada'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Resolve Claim Modal */}
      {isResolveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-fade-in">
          <form onSubmit={handleResolveClaimFromDetail} className="bg-[#070c18]/95 backdrop-blur-2xl border border-emerald-500/40 rounded-3xl w-full max-w-lg p-6 shadow-2xl flex flex-col gap-4 text-slate-100 relative overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_12px_#34d399]" />

            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-base text-white flex items-center gap-2 font-mono">
                  <span className="material-symbols-outlined text-emerald-400">check_circle</span>
                  <span>Resolver Reclamo & Restaurar Orden</span>
                </h3>
                <p className="mt-1 text-xs text-slate-400 font-mono">
                  Orden #{order.code} · Reclamo {associatedClaim?.id || 'Activo'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsResolveModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                disabled={resolveForm.isSubmitting}
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-3.5 text-xs text-emerald-200">
              Al resolver el reclamo, la base de datos marcará el reclamo como <strong>Resolved</strong>, registrará el evento en la bitácora de auditoría y restaurará la orden al estado operativo seleccionado.
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-200">Estatus destino de la orden *</label>
              <select
                value={resolveForm.targetStatus}
                onChange={(e) => setResolveForm({ ...resolveForm, targetStatus: e.target.value as OrderStatus })}
                className="cyber-input w-full text-xs font-mono font-bold uppercase cursor-pointer"
                disabled={resolveForm.isSubmitting}
              >
                <option value="entregado" className="bg-[#070c18] text-emerald-300">● Entregado (Garantía cerrada/conforme)</option>
                <option value="en_preparacion" className="bg-[#070c18] text-cyan-300">● En Preparación (Reemplazo / Repuesto)</option>
                <option value="listo_despacho" className="bg-[#070c18] text-cyan-300">● Listo para Despacho</option>
                <option value="listo_retiro" className="bg-[#070c18] text-cyan-300">● Listo para Retiro</option>
                <option value="en_camino" className="bg-[#070c18] text-cyan-300">● En Camino</option>
                <option value="pagado" className="bg-[#070c18] text-slate-200">● Pagado</option>
                <option value="cotizacion" className="bg-[#070c18] text-slate-200">● Cotización</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-200">Notas de Resolución / Solución Técnica</label>
              <textarea
                rows={3}
                value={resolveForm.notes}
                onChange={(e) => setResolveForm({ ...resolveForm, notes: e.target.value })}
                placeholder="Explica cómo se solventó el reclamo (ej: se ajustó la pieza, se envió repuesto, se acordó con cliente)..."
                className="cyber-input w-full resize-none text-xs focus:border-emerald-400 focus:ring-emerald-400/30"
                disabled={resolveForm.isSubmitting}
              />
            </div>

            <div className="flex justify-end gap-2.5 border-t border-emerald-500/15 pt-4">
              <button
                type="button"
                onClick={() => setIsResolveModalOpen(false)}
                className="cyber-btn-secondary px-4 py-2 text-xs"
                disabled={resolveForm.isSubmitting}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-xs font-black bg-gradient-to-r from-emerald-400 to-teal-500 text-slate-950 shadow-[0_0_15px_rgba(16,185,129,0.4)] cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                disabled={resolveForm.isSubmitting}
              >
                <span className="material-symbols-outlined text-[16px]">verified</span>
                <span>{resolveForm.isSubmitting ? 'Resolviendo...' : 'Resolver Reclamo'}</span>
              </button>
            </div>
          </form>
        </div>
      )}


      {/* Security OTP Modal */}
      <SecurityOtpModal
        isOpen={securityModal.isOpen}
        onClose={() => setSecurityModal((prev) => ({ ...prev, isOpen: false }))}
        onSuccess={handleSecuritySuccess}
        actionTitle={securityModal.actionTitle}
        actionDescription={securityModal.actionDescription}
        orderCode={order.code}
      />

      {/* Floating Toast Notification */}
      {copiedNotification && (
        <div className="fixed bottom-6 right-6 bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-black px-4 py-2.5 rounded-2xl shadow-[0_0_20px_rgba(6,182,212,0.5)] text-xs flex items-center gap-2 z-50 animate-bounce">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          <span>{copiedNotification}</span>
        </div>
      )}
    </div>
  );
};
