import React, { useState, useEffect, useRef } from 'react';
import { Order, OrderStatus, Claim, ClaimCall, ClaimStatus, AuctionLink, AuctionHouse } from '../types';
import { ordersApi } from '../services/ordersApi';
import { InvoiceView } from './InvoiceView';
import { DispatchLabelView } from './DispatchLabelView';
import { RefundRequestView } from './RefundRequestView';
import { ORDER_STATUS_LABELS } from '../utils/orderStatusRules';
import { apiFetch } from '../services/apiFetch';
import { OrderInventoryAvailability } from './OrderInventoryAvailability';
import { getClaimWarrantyError, getOrderWarrantyInfo } from '../utils/orderWarranty';
import { workflowRequired } from '../utils/orderWorkflow';
import { OrderWorkflowPanel } from './OrderWorkflowPanel';
import { OrderPaymentsModal } from './OrderPayments';
import { OrderAftersalesPanel } from './OrderAftersales';
import { CancelOrderModal } from './CancelOrderModal';

interface OrderDetailViewProps {
  order: Order;
  onBack: () => void;
  onOpenSMS: (customerName: string, phone: string, order?: Order) => void;
  onUpdateOrder?: (updatedOrder: Order) => Promise<Order | void>;
  onCreateClaim?: (orderId: string, reason: string) => Promise<void>;
  currentUser?: { id?: number; name?: string; email?: string; role?: string } | null;
  userRole?: 'admin' | 'operador' | 'vendedor_yarda' | string;
  openDeliveryPayment?: boolean;
  onDeliveryPaymentOpened?: () => void;
}

export const OrderDetailView: React.FC<OrderDetailViewProps> = ({
  order,
  onBack,
  onOpenSMS,
  onUpdateOrder,
  onCreateClaim,
  currentUser,
  userRole,
  openDeliveryPayment,
  onDeliveryPaymentOpened,
}) => {
  const [activeTab, setActiveTab] = useState<'resumen' | 'workflow' | 'historial' | 'followup'>('resumen');
  useEffect(() => {
    if (activeTab === 'followup' && order.status !== 'entregado') setActiveTab('resumen');
  }, [activeTab, order.status]);
  const [subView, setSubView] = useState<'detail' | 'refund' | 'invoice' | 'dispatch'>('detail');
  const [previewStep, setPreviewStep] = useState<number | null>(null);
  const recordedStep = Math.min(4, Math.max(1, order.workflowStep || 1));
  const currentStep = previewStep ?? recordedStep;
  const managedWorkflow = Boolean(order.createdAtIso && workflowRequired(order.createdAtIso));
  const showVerifiedWorkflow = managedWorkflow || order.status === 'entregado';
  const canRegisterDelivery = !order.deliveredAt && !['entregado', 'cancelado', 'reembolsado', 'archivado', 'reclamo', 'solicitud_reembolso'].includes(order.status);
  const [stockAssigned, setStockAssigned] = useState<string | null>(order.stockNumber || null);
  const [copiedNotification, setCopiedNotification] = useState<string | null>(null);

  // Auction Search & Refund State - Solo disponible para órdenes pagadas
  const [isAuctionActive, setIsAuctionActive] = useState<boolean>(
    order.status === 'pagado' && Boolean(order.auctionActive || (order.auctionLinks && order.auctionLinks.length > 0))
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
  const [isDeliveryDateModalOpen, setIsDeliveryDateModalOpen] = useState<boolean>(false);
  const [deliveryDateInput, setDeliveryDateInput] = useState('');
  const [deliveryDateReason, setDeliveryDateReason] = useState('');
  const [deliveryDateSaving, setDeliveryDateSaving] = useState(false);
  const deliveryDateSavingRef = useRef(false);
  const [actionError, setActionError] = useState('');
  const [paymentModal, setPaymentModal] = useState<'deliver' | null>(null);
  useEffect(() => {
    if (openDeliveryPayment) { if (canRegisterDelivery) setPaymentModal('deliver'); onDeliveryPaymentOpened?.(); }
  }, [openDeliveryPayment, onDeliveryPaymentOpened, canRegisterDelivery]);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const persistOrder = async (updated: Order): Promise<boolean> => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setIsSaving(true);
    setActionError('');
    try {
      if (!onUpdateOrder) throw new Error('No hay un guardado disponible.');
      await onUpdateOrder(updated);
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudieron guardar los cambios.');
      return false;
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const isSuperAdmin = userRole === 'admin' || currentUser?.role?.toLowerCase() === 'admin';

  // Reassign Advisor State (Super Admin)
  const [usersList, setUsersList] = useState<Array<{ id: number; name: string; role: string; active: number }>>([]);
  const [isReassignModalOpen, setIsReassignModalOpen] = useState(false);
  const [selectedReassignUserId, setSelectedReassignUserId] = useState<number | ''>('');
  const [reassignIsYardSale, setReassignIsYardSale] = useState<boolean>(false);
  const [isReassignSubmitting, setIsReassignSubmitting] = useState(false);
  const [reassignSuccessMsg, setReassignSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isSuperAdmin) return;
    apiFetch('/users')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data)) {
          setUsersList(data.filter((u: any) => Boolean(u.active)));
        }
      })
      .catch(() => {});
  }, [isSuperAdmin]);

  useEffect(() => {
    if (isReassignModalOpen) {
      const currentUid = order.userId ? Number(order.userId) : (usersList.find((u) => u.name === order.advisor)?.id ?? '');
      setSelectedReassignUserId(currentUid);
      setReassignIsYardSale(Boolean(order.isYardSale || order.advisorRole === 'vendedor_yarda'));
      setReassignSuccessMsg(null);
    }
  }, [isReassignModalOpen, order, usersList]);

  const handleConfirmReassignAdvisor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin || !selectedReassignUserId || isReassignSubmitting) return;
    const selectedUser = usersList.find((u) => u.id === Number(selectedReassignUserId));
    if (!selectedUser || !onUpdateOrder) return;

    setIsReassignSubmitting(true);
    try {
      const isYard = reassignIsYardSale || selectedUser.role === 'vendedor_yarda';
      await onUpdateOrder({
        ...order,
        advisor: selectedUser.name,
        userId: selectedUser.id,
        isYardSale: isYard,
        advisorRole: selectedUser.role,
      });
      setReassignSuccessMsg(`Asesor reasignado con éxito a ${selectedUser.name}`);
      setTimeout(() => {
        setIsReassignModalOpen(false);
        setIsReassignSubmitting(false);
      }, 900);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudo reasignar la orden.');
      setIsReassignSubmitting(false);
    }
  };

  // Revert from listo_retiro to pagado (Super Admin + WhatsApp OTP)
  const [isRevertToPaidModalOpen, setIsRevertToPaidModalOpen] = useState(false);
  const [isCancelOrderModalOpen, setIsCancelOrderModalOpen] = useState(false);
  const [revertReason, setRevertReason] = useState('');
  const [revertCode, setRevertCode] = useState('');
  const [revertLoading, setRevertLoading] = useState(false);
  const [revertOtpSent, setRevertOtpSent] = useState(false);
  const [revertCooldown, setRevertCooldown] = useState(0);
  const [revertTargetPhoneMasked, setRevertTargetPhoneMasked] = useState('');
  const [revertError, setRevertError] = useState('');
  const [revertSuccessMsg, setRevertSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (revertCooldown <= 0) return;
    const timer = setTimeout(() => setRevertCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [revertCooldown]);

  const closeRevertToPaidModal = () => {
    setIsRevertToPaidModalOpen(false);
    setRevertReason('');
    setRevertCode('');
    setRevertOtpSent(false);
    setRevertCooldown(0);
    setRevertTargetPhoneMasked('');
    setRevertError('');
    setRevertSuccessMsg(null);
  };

  const handleRequestRevertOtp = async () => {
    if (revertReason.trim().length < 5) {
      setRevertError('Por favor ingresa un motivo detallado (mínimo 5 caracteres).');
      return;
    }
    setRevertLoading(true);
    setRevertError('');
    try {
      const res = await ordersApi.requestRevertToPaidOtp(order.id, { reason: revertReason.trim() });
      setRevertOtpSent(true);
      setRevertCooldown(res.cooldownSeconds || 30);
      if (res.targetPhoneMasked) setRevertTargetPhoneMasked(res.targetPhoneMasked);
    } catch (err) {
      setRevertError(err instanceof Error ? err.message : 'No fue posible enviar el código WhatsApp.');
    } finally {
      setRevertLoading(false);
    }
  };

  const handleConfirmRevertToPaid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (revertCode.length !== 6) {
      setRevertError('El código debe tener 6 dígitos numéricos.');
      return;
    }
    setRevertLoading(true);
    setRevertError('');
    try {
      const res = await ordersApi.revertToPaid(order.id, {
        code: revertCode.trim(),
        reason: revertReason.trim(),
        version: order.version,
      });
      setRevertSuccessMsg(res.message || 'Orden devuelta a estado Pagado con éxito.');
      setTimeout(async () => {
        closeRevertToPaidModal();
        if (onUpdateOrder) {
          await onUpdateOrder({
            ...order,
            status: 'pagado' as OrderStatus,
            scheduledPickupAt: null,
            version: (order.version || 1) + 1,
          });
        }
        window.dispatchEvent(new Event('radar:data-changed'));
        handleToast('Orden devuelta a Pagado exitosamente.');
      }, 1500);
    } catch (err) {
      setRevertError(err instanceof Error ? err.message : 'Error al verificar el código o revertir la orden.');
    } finally {
      setRevertLoading(false);
    }
  };

  const handleSaveDeliveryDate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isSuperAdmin || deliveryDateSavingRef.current) return;
    deliveryDateSavingRef.current = true;
    setDeliveryDateSaving(true);
    setActionError('');
    try {
      if (!order.version) throw new Error('Actualiza la orden para obtener su versión antes de modificar la fecha.');
      if (!deliveryDateInput) throw new Error('Indica la fecha real de entrega.');
      await ordersApi.updateDeliveryDate(order.id, {
        deliveredAt: new Date(deliveryDateInput).toISOString(), version: order.version, reason: deliveryDateReason.trim(),
      });
      window.dispatchEvent(new Event('radar:data-changed'));
      setIsDeliveryDateModalOpen(false);
      setDeliveryDateInput('');
      setDeliveryDateReason('');
      handleToast('Fecha real de entrega actualizada.');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudo actualizar la fecha.');
    } finally {
      deliveryDateSavingRef.current = false;
      setDeliveryDateSaving(false);
    }
  };

  const [verifyingDownpayment, setVerifyingDownpayment] = useState(false);
  const handleVerifyDownpayment = async () => {
    if (verifyingDownpayment) return;
    setVerifyingDownpayment(true);
    try {
      const res = await apiFetch(`/orders/${order.id}/verify-downpayment`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'No se pudo verificar el anticipo');
      }
      onUpdateOrder({
        ...order,
        status: 'pagado' as OrderStatus,
        downpaymentVerified: true,
      });
      handleToast('Anticipo verificado en banco y orden pasada a Pagado.');
      window.dispatchEvent(new Event('radar:data-changed'));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error verificando anticipo');
    } finally {
      setVerifyingDownpayment(false);
    }
  };

  const [showExemptModal, setShowExemptModal] = useState(false);
  const [exemptNotes, setExemptNotes] = useState('');
  const [exemptingDownpayment, setExemptingDownpayment] = useState(false);
  const handleExemptDownpayment = async () => {
    if (exemptingDownpayment) return;
    setExemptingDownpayment(true);
    try {
      const res = await apiFetch(`/orders/${order.id}/exempt-downpayment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: exemptNotes.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'No se pudo exonerar el anticipo');
      }
      onUpdateOrder({
        ...order,
        status: 'pagado' as OrderStatus,
        downpaymentVerified: true,
      });
      handleToast('Anticipo exonerado por Administrador. Orden pasada a Pagado.');
      setShowExemptModal(false);
      window.dispatchEvent(new Event('radar:data-changed'));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error exonerando anticipo');
    } finally {
      setExemptingDownpayment(false);
    }
  };

  const [markingYardReady, setMarkingYardReady] = useState(false);
  const handleMarkYardReady = async () => {
    if (markingYardReady) return;
    setMarkingYardReady(true);
    try {
      const res = await apiFetch(`/orders/${order.id}/yard-ready`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'No se pudo marcar la pieza en yarda');
      }
      onUpdateOrder({
        ...order,
        yardPieceReady: true,
      });
      handleToast('Pieza confirmada como lista en yarda.');
      window.dispatchEvent(new Event('radar:data-changed'));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error marcando pieza en yarda');
    } finally {
      setMarkingYardReady(false);
    }
  };

  const vehicleName = `${order.vehicle.make} ${order.vehicle.model}`;
  const vehicleMileageText = order.vehicle.mileage ? `${Number(order.vehicle.mileage).toLocaleString()} mi` : null;
  const vehicleDetails = [
    order.vehicle.year,
    vehicleMileageText,
    order.vehicle.trim || order.productSpecs || '2.4L Engine'
  ].filter(Boolean).join(' • ');
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

  const warrantyInfo = getOrderWarrantyInfo(order);
  const warrantyLabel = {
    not_started: 'Inicia al entregar físicamente',
    active: `🟢 Vigente (${warrantyInfo.daysLeft}d restantes)`,
    critical: `🟡 Crítica (${warrantyInfo.daysLeft}d restantes)`,
    expired: 'Garantía expirada',
  }[warrantyInfo.status];

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

  const handleAddAuctionLink = async (e?: React.FormEvent) => {
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
    if (!await persistOrder({ ...order, auctionActive: true, auctionLinks: updatedLinks })) return;
    setAuctionLinks(updatedLinks);
    setIsAuctionActive(true);
    setNewAuctionUrl('');
    setNewAuctionDate('');
    setNewHasBuyNow(false);
    setNewBuyNowPrice('');

    handleToast(`✅ Enlace de subasta (${newAuctionHouse}) agregado`);
  };

  const handleRemoveAuctionLink = async (linkId: string) => {
    const updatedLinks = auctionLinks.filter((l) => l.id !== linkId);
    if (!await persistOrder({ ...order, auctionLinks: updatedLinks })) return;
    setAuctionLinks(updatedLinks);
    handleToast('Enlace de subasta eliminado');
  };

  const handleAssignStock = async () => {
    const newStock = `STK-2026-${Math.floor(100 + Math.random() * 900)}`;
    if (!await persistOrder({ ...order, stockNumber: newStock })) return;
    setStockAssigned(newStock);
  };

  const handleRegisterCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!associatedClaim?.id) {
      setCallForm((previous) => ({ ...previous, error: 'No se encontró el reclamo asociado. Actualiza los datos antes de registrar llamadas.' }));
      return;
    }
    if (!callForm.summary.trim()) {
      setCallForm((prev) => ({ ...prev, error: 'Ingresa el resumen de la llamada.' }));
      return;
    }

    setCallForm((prev) => ({ ...prev, isSubmitting: true, error: '' }));
    const claimTargetId = associatedClaim.id;
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
        if (!prev) return null;
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
          }),
        });
        if (!res.ok) {
          const result = await res.json().catch(() => ({}));
          throw new Error(result.message || 'No se pudo resolver el reclamo en el servidor');
        }
      } else throw new Error('No se encontró el reclamo asociado. Actualiza los datos.');
      window.dispatchEvent(new Event('radar:data-changed'));

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
      handleToast('Reclamo resuelto. La orden se restauró al estado histórico verificado por el servidor.');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudo completar la resolución del reclamo.');
    } finally {
      setResolveForm((prev) => ({ ...prev, isSubmitting: false }));
    }
  };

  const handleDenyClaimFromDetail = async () => {
    if (!isSuperAdmin) return setActionError('Solo un administrador puede denegar garantías.');
    if (!window.confirm(`¿Confirmas denegar la garantía del reclamo asociado a la orden #${order.code}?`)) {
      return;
    }
    const claimTargetId = associatedClaim?.id?.replace('REC-', '');
    try {
      if (claimTargetId) {
        const response = await apiFetch(`/claims/${claimTargetId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'Denied',
            orderId: Number(order.id),
          }),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.message || 'No se pudo denegar la garantía.');
        }
      } else throw new Error('No se encontró el reclamo asociado.');
      window.dispatchEvent(new Event('radar:data-changed'));
      setAssociatedClaim((prev) => (prev ? { ...prev, status: 'Denied' as ClaimStatus } : null));
      handleToast(`🔴 Garantía denegada para reclamo.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Error al denegar la garantía.');
    }
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
      } else throw new Error('No hay un servicio de reclamos disponible.');
      setClaimModal({ isOpen: false, reason: '', isSaving: false, error: '' });
      handleToast('⚠️ Reclamo aperturado exitosamente');
      fetchAssociatedClaim();
    } catch (error) {
      setClaimModal((previous) => ({ ...previous, isSaving: false, error: error instanceof Error ? error.message : 'No se pudo crear el reclamo en la base de datos.' }));
    }
  };

  const statusOptions = [order.status];

  const workflowSteps = [
    { num: 1, title: 'Cotización', sub: 'Términos & Cotización', icon: 'verified_user' },
    { num: 2, title: 'Acuse', sub: 'Acuse de Recibo (2-3d)', icon: 'support_agent' },
    { num: 3, title: 'Cita', sub: 'Retiro / Delivery', icon: 'calendar_month' },
    { num: 4, title: 'Cierre', sub: 'Entrega & Garantía', icon: 'task_alt' },
  ];

  const handleWorkflowStepCheck = async (stepNumber: number) => {
    if (!onUpdateOrder || stepNumber > currentStep) return;

    const nextStep = Math.min(4, Math.max(order.workflowStep || 1, stepNumber + 1));
    if (!await persistOrder({
      ...order,
      workflowStep: nextStep,
      ...(stepNumber === 4
        ? {
            status: 'entregado' as OrderStatus,
            deliveredAt: order.deliveredAt || new Date().toISOString(),
            warrantyStarted: true,
          }
        : {}),
    })) return;
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
    <div className="radar-view horizon-view horizon-order-detail text-[var(--text-primary)] pb-4 space-y-2.5">
      {paymentModal && <OrderPaymentsModal orderId={order.id} code={order.code} customerName={order.customer.name} managed={managedWorkflow} allowDelivery={canRegisterDelivery} initialDelivery onClose={() => setPaymentModal(null)} />}
      {actionError && <p role="alert" className="rounded-xl border border-red-500 p-3 text-red-300">{actionError}</p>}
      {isSaving && <p role="status">Guardando…</p>}
      {/* Toast Floating Notification */}
      {copiedNotification && (
        <div className="fixed top-16 right-6 z-50 px-4 py-2 rounded-xl bg-cyan-950/95 border border-cyan-400 text-cyan-200 text-xs font-mono font-bold shadow-[0_0_20px_rgba(6,182,212,0.5)] flex items-center gap-2 animate-fade-in">
          <span className="material-symbols-outlined text-[16px] text-cyan-400 animate-spin">sync</span>
          <span>{copiedNotification}</span>
        </div>
      )}

      <div className="horizon-detail-header">
        <div className="horizon-detail-heading flex flex-wrap items-center justify-between gap-2.5">
          {/* Left: Back button + Order code + Status Selector + Abono */}
          <div className="horizon-detail-overview flex items-center flex-wrap gap-2 sm:gap-2.5">
            <button
              type="button"
              onClick={onBack}
              className="p-1.5 rounded-lg bg-[var(--bg-card-subtle)] border border-cyan-500/30 text-cyan-400 hover:text-cyan-200 hover:bg-cyan-500/20 transition-all cursor-pointer shadow-sm"
              title="Volver a la lista de órdenes"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            </button>

            <div className="flex items-center gap-1.5">
              <h1 className="horizon-detail-title text-base sm:text-lg font-black text-cyan-400 font-mono tracking-tight flex items-center gap-1">
                #{order.code}
              </h1>
            </div>

            {/* Inline Status Dropdown */}
            <div className="relative inline-flex items-center">
              <select
                disabled
                title="El estado se actualiza automáticamente desde el flujo verificable"
                value={order.status}
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
              <span className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px] text-cyan-400">person</span>
                <strong className="text-[var(--text-primary)] font-semibold">{order.advisor || 'Carlos M.'}</strong>
                {(order.isYardSale || order.advisorRole === 'vendedor_yarda') && (
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    🚜 Yarda
                  </span>
                )}
                {isSuperAdmin && (
                  <button
                    type="button"
                    onClick={() => setIsReassignModalOpen(true)}
                    className="p-1 rounded hover:bg-cyan-500/20 text-cyan-400 hover:text-cyan-200 transition-colors"
                    title="Modificar asesor de venta (Super Admin)"
                  >
                    <span className="material-symbols-outlined text-[13px]">edit</span>
                  </button>
                )}
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
          <div className="horizon-detail-actions flex items-center flex-wrap gap-1.5">
            {order.status === 'entregado' || order.deliveredAt ? <div className="text-xs">
              <strong>Entrega registrada</strong>
              {order.deliveredAt && <span> · {new Date(order.deliveredAt).toLocaleString('es-ES')}</span>}
              <button type="button" className="underline ml-2" onClick={() => setActiveTab('historial')}>Ver constancia y responsable</button>
            </div> : canRegisterDelivery && <button
              type="button" className="horizon-primary rounded-xl px-3 py-2 text-xs font-bold"
              onClick={() => setPaymentModal('deliver')}>Registrar entrega</button>}
            {/* Quick SMS/WhatsApp Button */}
            <button
              type="button"
              onClick={() => onOpenSMS(order.customer?.name || '', order.customer?.phone || '', order)}
              className="cyber-btn-primary px-2.5 py-1 text-[11px] font-black font-mono shadow-sm flex items-center gap-1"
              title="Enviar WhatsApp o SMS al cliente"
            >
              <span className="material-symbols-outlined text-[15px]">chat</span>
              <span>WhatsApp / SMS</span>
            </button>



            {/* Quick Subasta Toggle Button - Solo órdenes pagadas */}
            {order.status === 'pagado' && (
              <button
                type="button"
                onClick={handleToggleAuction}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold font-mono flex items-center gap-1 transition-all cursor-pointer border ${
                  isAuctionActive || showAuctionPanel
                    ? 'bg-amber-100 dark:bg-amber-500/20 border-amber-500 dark:border-amber-400 text-amber-900 dark:text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.25)]'
                    : 'cyber-btn-secondary text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                title="Ver o gestionar búsqueda en subasta"
              >
                <span className="material-symbols-outlined text-[15px] text-amber-600 dark:text-amber-400">gavel</span>
                <span>Subasta{auctionLinks.length > 0 ? ` (${auctionLinks.length})` : ''}</span>
              </button>
            )}

            {/* Super Admin: Aprobar Anticipo Bancario (Zelle / Cash App) */}
            {isSuperAdmin && (order.status === 'espera_confirmacion' || (!order.downpaymentVerified && order.status === 'espera_confirmacion')) && (
              <button
                type="button"
                onClick={handleVerifyDownpayment}
                disabled={verifyingDownpayment}
                className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-mono font-bold flex items-center gap-1 transition-all cursor-pointer shadow-[0_0_12px_rgba(16,185,129,0.25)] active:scale-95 animate-pulse"
                title="Confirmar que el dinero fue recibido en banco y pasar a Pagado"
              >
                <span className="material-symbols-outlined text-[15px] text-emerald-400">verified</span>
                <span>{verifyingDownpayment ? 'Verificando…' : 'Aprobar Anticipo (Banco)'}</span>
              </button>
            )}

            {/* Super Admin: Exonerar Anticipo (Cobro Contra Entrega) */}
            {isSuperAdmin && ['cotizacion', 'espera_confirmacion'].includes(order.status) && (
              <button
                type="button"
                onClick={() => setShowExemptModal(true)}
                className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] font-mono font-bold flex items-center gap-1 transition-all cursor-pointer shadow-[0_0_12px_rgba(245,158,11,0.25)] active:scale-95"
                title="Exonerar anticipo ($0 inicial) y pasar a Pagado para preparar en patio (Cobro 100% al entregar)"
              >
                <span className="material-symbols-outlined text-[15px] text-amber-400">handshake</span>
                <span>Exonerar Anticipo (Contra Entrega)</span>
              </button>
            )}

            {/* Super Admin: Marcar Pieza Lista en Yarda */}
            {isSuperAdmin && !order.yardPieceReady && ['pagado', 'en_preparacion'].includes(order.status) && (
              <button
                type="button"
                onClick={handleMarkYardReady}
                disabled={markingYardReady}
                className="px-2.5 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-[11px] font-mono font-bold flex items-center gap-1 transition-all cursor-pointer shadow-[0_0_12px_rgba(6,182,212,0.25)] active:scale-95"
                title="Notificar a los asesores que el patio ya desmontó la pieza y está lista"
              >
                <span className="material-symbols-outlined text-[15px] text-cyan-400">factory</span>
                <span>{markingYardReady ? 'Marcando…' : 'Marcar Pieza Lista en Yarda'}</span>
              </button>
            )}

            {/* Insignia: Pieza Lista en Yarda */}
            {order.yardPieceReady && (
              <span className="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[11px] font-mono font-bold flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px] text-emerald-400">check_circle</span>
                <span>Pieza Lista en Yarda</span>
              </span>
            )}

            {/* Insignia: Pieza No Disponible en Patio */}
            {order.yardPieceUnavailable && (
              <span className="px-2.5 py-0.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[11px] font-mono font-bold flex items-center gap-1 shadow-[0_0_12px_rgba(244,63,94,0.25)] animate-pulse">
                <span className="material-symbols-outlined text-[14px] text-rose-400">production_quantity_limits</span>
                <span>No Disponible en Patio · En Subasta</span>
              </span>
            )}

            {/* Quick Reembolso Button */}
            <button
              type="button"
              onClick={() => setSubView('refund')}
              className="cyber-btn-secondary px-2 py-1 text-[11px] font-bold font-mono text-amber-700 dark:text-amber-300 border-amber-400/40 dark:border-amber-500/30 hover:border-amber-500 hover:text-amber-900 dark:hover:text-amber-200"
              title="Solicitar reembolso"
            >
              <span className="material-symbols-outlined text-[15px] text-amber-600 dark:text-amber-400">account_balance_wallet</span>
              <span className="hidden sm:inline">Reembolso</span>
            </button>

            {/* Administrative correction of a recorded delivery. */}
            {order.status === 'entregado' && isSuperAdmin && (
              <button
                type="button"
                onClick={() => setIsDeliveryDateModalOpen(true)}
                className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] font-mono font-bold flex items-center gap-1 transition-all cursor-pointer shadow-[0_0_12px_rgba(245,158,11,0.25)] active:scale-95"
                title="Corregir fecha real de entrega (administrador)"
              >
                <span className="material-symbols-outlined text-[15px] text-amber-400">edit_calendar</span>
                <span>Modificar Fecha</span>
              </button>
            )}

            {/* Quick Super Admin Advisor Reassignment Button */}
            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => setIsReassignModalOpen(true)}
                className="px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 text-[11px] font-mono font-bold flex items-center gap-1 transition-all cursor-pointer shadow-sm active:scale-95"
                title="Modificar o reasignar el asesor de esta orden (Super Admin)"
              >
                <span className="material-symbols-outlined text-[15px] text-cyan-400">manage_accounts</span>
                <span className="hidden sm:inline">Reasignar Asesor</span>
              </button>
            )}

            {/* Super Admin Reversion from Listo para Retiro to Pagado with WhatsApp OTP */}
            {order.status === 'listo_retiro' && isSuperAdmin && (
              <button
                type="button"
                onClick={() => setIsRevertToPaidModalOpen(true)}
                className="px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/40 text-[11px] font-mono font-bold flex items-center gap-1 transition-all cursor-pointer shadow-[0_0_12px_rgba(244,63,94,0.2)] active:scale-95"
                title="Devolver orden a estado Pagado con código de seguridad WhatsApp (Super Admin)"
              >
                <span className="material-symbols-outlined text-[15px] text-rose-400">history</span>
                <span>Revertir a Pagado</span>
              </button>
            )}

            {/* Super Admin Special Cancellation with SMS/WhatsApp OTP */}
            {isSuperAdmin && order.status !== 'cancelado' && (
              <button
                type="button"
                onClick={() => setIsCancelOrderModalOpen(true)}
                className="px-2.5 py-1 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/40 text-[11px] font-mono font-bold flex items-center gap-1 transition-all cursor-pointer shadow-sm active:scale-95"
                title="Cancelar orden y registrar devolución automática con código OTP (Super Admin)"
              >
                <span className="material-symbols-outlined text-[15px] text-red-400">block</span>
                <span>Cancelar Orden</span>
              </button>
            )}

          </div>
        </div>

        {/* ALERTA DE PATIO: PIEZA NO DISPONIBLE EN PATIO Y BÚSQUEDA EN SUBASTA ACTIVADA */}
        {order.yardPieceUnavailable && (
          <div className="rounded-2xl border-2 border-rose-500/50 bg-gradient-to-r from-rose-950/60 via-slate-900/95 to-amber-950/40 p-4 shadow-[0_0_25px_rgba(244,63,94,0.25)] flex flex-col md:flex-row items-start md:items-center justify-between gap-4 font-mono animate-in fade-in duration-200 mb-2">
            <div className="flex items-start gap-3.5 flex-1 min-w-0">
              <div className="w-11 h-11 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center shrink-0 shadow-[0_0_12px_rgba(244,63,94,0.3)]">
                <span className="material-symbols-outlined text-[26px] text-rose-400 animate-pulse">production_quantity_limits</span>
              </div>
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 rounded-md bg-rose-500 text-slate-950 font-black text-[11px] uppercase tracking-wider">
                    ⚠️ Alerta de Patio
                  </span>
                  <span className="text-white font-bold text-sm tracking-tight">
                    Pieza no disponible en patio físico · Búsqueda en Subasta Activada
                  </span>
                </div>
                <p className="text-xs text-rose-200/90">
                  <strong>Motivo reportado:</strong> {order.yardPieceUnavailableReason || 'No encontrada en inventario físico'}
                  {order.yardPieceUnavailableAt && (
                    <span className="text-slate-400 text-[11px] ml-2">
                      ({new Date(order.yardPieceUnavailableAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })})
                    </span>
                  )}
                </p>
                <p className="text-[11.5px] text-amber-200/90 leading-relaxed">
                  👉 <strong>Instrucción para Asesor y Administrador:</strong> Contactar al cliente urgentemente para acordar:
                  <span className="text-white"> 1) Extensión de tiempo (mientras se ubica en subasta Copart/IAAI)</span>,
                  <span className="text-white"> 2) Cancelación de orden</span> o
                  <span className="text-white"> 3) Reembolso del anticipo o core</span>.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0 w-full md:w-auto pt-2 md:pt-0 border-t md:border-t-0 border-rose-500/20">
              {/* Botón WhatsApp al Cliente */}
              {order.customer?.phone && (
                <a
                  href={`https://wa.me/${order.customer.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
                    `Hola ${order.customer.name}, le saludamos de RADAR Autopartes sobre su orden #${order.orderCode} (${order.partType} para ${order.vehicle?.year || ''} ${order.vehicle?.make || ''} ${order.vehicle?.model || ''}). Le informamos que estamos gestionando la búsqueda de su pieza en subasta y quisiéramos consultar si nos permite una extensión de tiempo o si prefiere la cancelación y reembolso correspondiente.`
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 transition-all shadow-[0_0_12px_rgba(16,185,129,0.3)] active:scale-95 cursor-pointer"
                  title="Abrir chat de WhatsApp con plantilla de notificación al cliente"
                >
                  <span className="material-symbols-outlined text-[16px]">chat</span>
                  <span>Notificar WhatsApp</span>
                </a>
              )}

              {/* Botón Ver Subastas */}
              <button
                type="button"
                onClick={() => {
                  setShowAuctionPanel(true);
                  const el = document.getElementById('auction-panel-section');
                  if (el) el.scrollIntoView({ behavior: 'smooth' });
                }}
                className="px-3 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
              >
                <span className="material-symbols-outlined text-[16px]">search</span>
                <span>Ver Subasta</span>
              </button>

              {/* Botón Reembolso */}
              <button
                type="button"
                onClick={() => setSubView('refund')}
                className="px-3 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
              >
                <span className="material-symbols-outlined text-[16px]">account_balance_wallet</span>
                <span>Reembolso</span>
              </button>

              {/* Botón Cancelar Orden (Super Admin) */}
              {isSuperAdmin && order.status !== 'cancelado' && (
                <button
                  type="button"
                  onClick={() => setIsCancelOrderModalOpen(true)}
                  className="px-3 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
                >
                  <span className="material-symbols-outlined text-[16px]">block</span>
                  <span>Cancelar</span>
                </button>
              )}
            </div>
          </div>
        )}

            <div className="horizon-detail-tabs horizon-view-tabs flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('resumen')}
                aria-pressed={activeTab === 'resumen'}
                className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-bold whitespace-nowrap transition-all cursor-pointer ${
                  activeTab === 'resumen'
                    ? 'bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-black shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Resumen
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('workflow')}
                aria-pressed={activeTab === 'workflow'}
                className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-bold whitespace-nowrap transition-all cursor-pointer ${
                  activeTab === 'workflow'
                    ? 'bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-black shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {showVerifiedWorkflow ? 'Flujo verificable' : `Flujo (${currentStep}/4)`}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('historial')}
                aria-pressed={activeTab === 'historial'}
                className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-bold whitespace-nowrap transition-all cursor-pointer ${
                  activeTab === 'historial'
                    ? 'bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-black shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Historial
              </button>
              {order.status === 'entregado' && <button type="button"
                onClick={() => setActiveTab('followup')} aria-pressed={activeTab === 'followup'}
                className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-bold whitespace-nowrap transition-all cursor-pointer ${
                  activeTab === 'followup' ? 'bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-black shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}>Seguimiento post entrega</button>}
        </div>
      </div>

      {!showVerifiedWorkflow && <div className="horizon-detail-workflow cyber-card px-3 py-1.5 shadow-sm flex items-center justify-between gap-2 overflow-x-auto custom-scrollbar">
        <div className="flex items-center gap-1.5 text-[10.5px] font-mono font-bold text-cyan-400 shrink-0">
          <span className="material-symbols-outlined text-[15px]">headset_mic</span>
          <span>Seguimiento</span>
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
                  aria-current={isCurrent ? 'step' : undefined}
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
      </div>}

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
                {warrantyInfo.status === 'expired' && (
                  <p className="text-[11px] text-red-300 font-mono font-bold mt-0.5">
                    Garantía expirada. No se pueden registrar nuevos reclamos para esta orden.
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
                onClick={() => document.getElementById('order-aftersales')?.scrollIntoView({ behavior: 'smooth' })}
                className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-xs font-mono font-bold flex items-center gap-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[14px]">check_circle</span>
                <span>Resolver</span>
              </button>

              <button
                type="button"
                onClick={() => document.getElementById('order-aftersales')?.scrollIntoView({ behavior: 'smooth' })}
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
      {/* 4. CONTEXTUAL AUCTION PANEL (EXPANDABLE - SOLO ÓRDENES PAGADAS)           */}
      {/* ========================================================================= */}
      {showAuctionPanel && order.status === 'pagado' && (
        <div className="cyber-card p-3 shadow-md flex flex-col gap-2.5 animate-fade-in">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-[18px] text-amber-600 dark:text-amber-400">gavel</span>
              <strong className="text-xs font-mono font-bold text-amber-900 dark:text-amber-300">Búsqueda en Subasta ({auctionLinks.length})</strong>
              <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px] font-mono font-bold text-amber-900 dark:text-amber-200 bg-amber-100/90 dark:bg-amber-500/15 px-2.5 py-1 rounded-lg border border-amber-400/80 dark:border-amber-500/30 shadow-sm transition-colors hover:bg-amber-200/70 dark:hover:bg-amber-500/25">
                <input
                  type="checkbox"
                  checked={isAuctionActive}
                  onChange={async (e) => {
                    const active = e.target.checked;
                    if (!await persistOrder({ ...order, auctionActive: active, auctionLinks })) return;
                    setIsAuctionActive(active);
                    handleToast(active ? 'Marcada para búsqueda en subasta' : 'Desmarcada de búsqueda en subasta');
                  }}
                  className="rounded border-amber-500/60 text-amber-600 focus:ring-0 accent-amber-500 bg-white dark:bg-[#070e1c] cursor-pointer"
                />
                <span className="font-bold text-amber-950 dark:text-amber-200">{isAuctionActive ? 'Activa para Subasta' : 'Marcar para Subasta'}</span>
              </label>
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
      {/* 4.5 POST-DELIVERY 14-DAY FOLLOWUP MODULE FOR DELIVERED ORDERS              */}
      {/* ========================================================================= */}
      {activeTab === 'followup' && order.status === 'entregado' && (
        <section aria-label="Seguimiento post entrega">
          <OrderWorkflowPanel orderId={order.id} view="followup" />
        </section>
      )}

      {activeTab === 'resumen' && canRegisterDelivery && <OrderInventoryAvailability order={order} userRole={userRole || currentUser?.role} />}
      {activeTab === 'resumen' && (
        <div className="horizon-detail-grid grid grid-cols-1 md:grid-cols-3 gap-2.5 sm:gap-3">
          {/* COLUMN 1: VEHÍCULO & REFACCIÓN */}
          <div className="cyber-card p-3 sm:p-3.5 flex flex-col justify-between gap-2.5 shadow-sm">
            <div className="cyber-laser-bar" />

            <div>
              {/* Card Header: Vehicle + Part pill */}
              <div className="flex items-start justify-between gap-2 pb-2 border-b border-cyan-500/15">
                <div>
                  <span className="text-[10px] font-mono font-bold text-[var(--text-secondary)] uppercase tracking-wider block">
                    Vehículo y pieza
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
                    <span className="font-bold text-[var(--text-heading)] truncate text-[11px]">{order.vehicle.vin || 'Sin VIN'}</span>
                    {order.vehicle.vin ? (
                      <button
                        type="button"
                        onClick={() => handleCopy(order.vehicle.vin, 'VIN')}
                        className="text-cyan-400 hover:text-cyan-200 cursor-pointer p-0.5"
                        title="Copiar VIN"
                      >
                        <span className="material-symbols-outlined text-[13px]">content_copy</span>
                      </button>
                    ) : null}
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
                  <div className="flex items-center justify-between">
                    <span className="text-[9.5px] font-bold text-[var(--text-secondary)] uppercase block">ENTREGA</span>
                    {isSuperAdmin && order.status === 'entregado' && (
                      <button
                        type="button"
                        onClick={() => setIsDeliveryDateModalOpen(true)}
                        className="text-[9.5px] font-mono text-amber-400 hover:text-amber-300 underline font-bold cursor-pointer"
                        title="Corregir fecha real de entrega (administrador)"
                      >
                        Editar fecha
                      </button>
                    )}
                  </div>
                  <span className="inline-flex items-center gap-1 font-bold text-[var(--text-heading)] text-[11px] mt-0.5">
                    <span className="material-symbols-outlined text-[13px] text-cyan-400">
                      {isHomeDelivery ? 'local_shipping' : 'storefront'}
                    </span>
                    <span>
                      {isHomeDelivery ? 'Envío Domicilio' : 'Retiro Tienda'}
                      {order.deliveredAt && ` (${new Date(order.deliveredAt).toLocaleDateString('es-ES')})`}
                    </span>
                  </span>
                </div>

                {/* GARANTÍA */}
                <div className="p-2 rounded-xl bg-[var(--bg-card-subtle)] border border-cyan-500/15">
                  <span className="text-[9.5px] font-bold text-[var(--text-secondary)] uppercase block">GARANTÍA</span>
                  <span className="text-emerald-400 font-bold text-[11px] block mt-0.5">
                    {order.warrantyDays ?? 60} Días
                  </span>
                  {warrantyInfo.status === 'expired' ? (
                    <span
                      role="status"
                      className="inline-flex items-center gap-1 mt-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-400"
                    >
                      🔴 {warrantyLabel}
                    </span>
                  ) : (
                    <span className="text-[10px] text-[var(--text-secondary)]">{warrantyLabel}</span>
                  )}
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

                <div className="flex items-center gap-1.5">
                  <span
                    className={`px-2 py-0.5 rounded-md text-[9.5px] font-mono font-bold border flex items-center gap-1 ${
                      (order.customerLanguage || order.customer?.language) === 'en'
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                        : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/35'
                    }`}
                    title={`Idioma preferido del cliente: ${(order.customerLanguage || order.customer?.language) === 'en' ? 'Inglés' : 'Español'}`}
                  >
                    <span>{(order.customerLanguage || order.customer?.language) === 'en' ? '🇺🇸 Inglés' : '🇪🇸 Español'}</span>
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[9.5px] font-mono font-bold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                    {order.customer.type || 'Individual'}
                  </span>
                </div>
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
                {order.preparation && <div className="p-2 rounded-xl bg-[var(--bg-card-subtle)] border border-cyan-500/15 text-[11px]">
                  <strong>{order.preparation.channel === 'in_person' ? `Entrega presencial en yarda: ${order.preparation.dateFrom}` : `Cita acordada: ${order.preparation.dateFrom} — ${order.preparation.dateTo}`}</strong>
                  <p>Core: {order.preparation.corePlan === 'return_core' ? 'el cliente lo llevará' : 'el cliente lo pagará'}.</p>
                </div>}
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
                onClick={() => onOpenSMS(order.customer?.name || '', order.customer?.phone || '', order)}
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
                  <div className="flex items-center gap-2">
                    <strong className="text-[var(--text-primary)]">${coreFee.toFixed(2)}</strong>
                    {order.status === 'entregado' && coreFee > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const el = document.getElementById('order-aftersales');
                          el?.scrollIntoView({ behavior: 'smooth' });
                          window.dispatchEvent(new CustomEvent('radar:open-core-aftersales', { detail: { orderId: order.id } }));
                        }}
                        className="text-[10px] px-2 py-0.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 font-bold font-mono transition cursor-pointer"
                        title="Gestionar recepción física y devolución del core en Posventa"
                      >
                        ⚙️ Gestionar Core
                      </button>
                    )}
                  </div>
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
      {showVerifiedWorkflow && activeTab === 'workflow' && <OrderWorkflowPanel orderId={order.id} />}
      {activeTab === 'resumen' && <OrderAftersalesPanel order={order} />}
      {activeTab === 'resumen' && showVerifiedWorkflow && <div className="horizon-view-card flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">Esta orden requiere gestiones con evidencia, responsable y próxima acción.</p>
        <button type="button" className="horizon-primary rounded-xl px-4 py-2" onClick={() => setActiveTab('workflow')}>Gestionar flujo verificable</button>
      </div>}
      {activeTab === 'workflow' && !showVerifiedWorkflow && (
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
        <section aria-label="Historial de la orden" className="space-y-4">
          {showVerifiedWorkflow && <OrderWorkflowPanel orderId={order.id} view="history" />}

          <div className="horizon-view-card p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[20px]">verified_user</span>
                </span>
                <div>
                  <h3 className="text-base font-bold text-[var(--text-primary)] leading-tight">
                    Hitos de Auditoría del Sistema
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Trazabilidad de creación, asignación y entrega física de la orden #{order.code}
                  </p>
                </div>
              </div>
              <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-full bg-[var(--bg-card-subtle)] border border-[var(--border-color)] text-[var(--text-secondary)]">
                Orden #{order.code}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {/* Hito 1: Creación */}
              <div className="p-3.5 rounded-2xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[18px]">add_task</span>
                  </span>
                  <div className="min-w-0">
                    <strong className="text-xs sm:text-sm font-bold text-[var(--text-primary)] block truncate">
                      Creación de la orden en el sistema
                    </strong>
                    <span className="text-xs text-[var(--text-secondary)] block truncate">
                      Asesor asignado: {order.sellerName || 'Operador'}
                    </span>
                  </div>
                </div>
                <span className="text-xs font-semibold tabular-nums text-[var(--text-primary)] shrink-0">
                  {order.createdAt || 'Fecha registrada'}
                </span>
              </div>

              {/* Hito 2: Entrega física */}
              {order.deliveredAt ? (
                <div className="p-3.5 rounded-2xl bg-emerald-500/5 border border-emerald-500/30 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-500 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-[18px]">local_shipping</span>
                    </span>
                    <div className="min-w-0">
                      <strong className="text-xs sm:text-sm font-bold text-[var(--text-primary)] block truncate">
                        Entrega física confirmada e inicio de garantía
                      </strong>
                      <span className="text-xs text-emerald-500 font-medium block truncate">
                        {warrantyLabel}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-bold tabular-nums text-[var(--text-primary)]">
                      {new Date(order.deliveredAt).toLocaleDateString('es-ES')}
                    </span>
                    {isSuperAdmin && order.status === 'entregado' && (
                      <button
                        type="button"
                        onClick={() => setIsDeliveryDateModalOpen(true)}
                        className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-500 text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
                        title="Corregir fecha real de entrega (administrador)"
                      >
                        <span className="material-symbols-outlined text-[14px]">edit</span>
                        <span>Modificar fecha</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-3.5 rounded-2xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] flex items-center justify-between gap-3 opacity-80">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-8 h-8 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-secondary)] flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-[18px]">schedule</span>
                    </span>
                    <div className="min-w-0">
                      <strong className="text-xs sm:text-sm font-bold text-[var(--text-primary)] block truncate">
                        Entrega física pendiente
                      </strong>
                      <span className="text-xs text-[var(--text-secondary)] block truncate">
                        La garantía iniciará al confirmar la entrega de la pieza
                      </span>
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-[var(--text-secondary)] shrink-0">
                    En curso
                  </span>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ========================================================================= */}
      {/* 8. GLOBAL MODALS & DIALOGS                                               */}
      {/* ========================================================================= */}

      {/* Modal: Apertura de Reclamo */}
      {claimModal.isOpen && (
        <div className="horizon-modal fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
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
                  onClick={() => { setClaimModal(previous => ({ ...previous, isOpen: false })); document.getElementById('order-aftersales')?.scrollIntoView({ behavior: 'smooth' }); }}
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
        <div className="horizon-modal fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
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
        <div className="horizon-modal fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
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
                <p className="text-sm">El servidor restaurará únicamente el estado anterior verificable. Si falta historial, la resolución será rechazada sin inventar una entrega o un pago.</p>
                {actionError && <p role="alert" className="text-red-300">{actionError}</p>}
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

      {isSuperAdmin && isDeliveryDateModalOpen && <div className="horizon-modal fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
        <form onSubmit={handleSaveDeliveryDate} className="bg-slate-900 rounded-2xl border border-cyan-700 p-6 space-y-4 w-full max-w-lg">
          <h2 className="text-xl font-bold">Corregir fecha real de entrega</h2>
          <p className="text-sm text-slate-400">Acción administrativa verificada por el servidor. No registra ni inventa un cobro.</p>
          <input required type="datetime-local" aria-label="Fecha real de entrega" value={deliveryDateInput} onChange={(event) => setDeliveryDateInput(event.target.value)} className="bg-slate-950 border border-slate-700 rounded-xl p-3 w-full" />
          <textarea required aria-label="Motivo de corrección" value={deliveryDateReason} onChange={(event) => setDeliveryDateReason(event.target.value)} className="bg-slate-950 border border-slate-700 rounded-xl p-3 w-full" />
          {actionError && <p role="alert" className="text-red-300">{actionError}</p>}
          <div className="flex gap-3">
            <button type="button" disabled={deliveryDateSaving} onClick={() => setIsDeliveryDateModalOpen(false)}>Volver</button>
            <button disabled={deliveryDateSaving}>{deliveryDateSaving ? 'Guardando…' : 'Guardar corrección'}</button>
          </div>
        </form>
      </div>}

      {/* Modal: Reasignar Asesor de Venta (Super Admin) */}
      {isReassignModalOpen && (
        <div className="horizon-modal fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="cyber-card w-full max-w-md p-5 border-cyan-500/50 shadow-[0_0_40px_rgba(6,182,212,0.3)]">
            <div className="flex items-center justify-between border-b border-cyan-500/20 pb-3 mb-3">
              <div className="flex items-center gap-2 text-cyan-400 font-mono font-bold text-sm">
                <span className="material-symbols-outlined text-[20px]">manage_accounts</span>
                <span>Reasignar Asesor - Orden #{order.code}</span>
              </div>
              <button
                type="button"
                onClick={() => setIsReassignModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {reassignSuccessMsg ? (
              <div className="p-4 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono text-xs text-center flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-[18px]">check_circle</span>
                <span>{reassignSuccessMsg}</span>
              </div>
            ) : (
              <form onSubmit={handleConfirmReassignAdvisor} className="space-y-4">
                {actionError && <p role="alert" className="text-red-300">{actionError}</p>}
                <div className="p-2.5 rounded-xl bg-[var(--bg-card-subtle)] border border-cyan-500/15 text-xs font-mono space-y-1">
                  <div className="flex justify-between">
                    <span className="text-[var(--text-secondary)]">Cliente:</span>
                    <strong className="text-[var(--text-primary)]">{order.customer?.name}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-secondary)]">Asesor Actual:</span>
                    <strong className="text-cyan-300">
                      {order.advisor || 'No asignado'}
                      {(order.isYardSale || order.advisorRole === 'vendedor_yarda') && ' (🚜 Yarda)'}
                    </strong>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-mono font-bold text-[var(--text-secondary)] uppercase block mb-1.5">
                    Nuevo Asesor de Venta:
                  </label>
                  <select
                    value={selectedReassignUserId}
                    onChange={(e) => {
                      const uid = Number(e.target.value);
                      setSelectedReassignUserId(uid);
                      const user = usersList.find((u) => u.id === uid);
                      if (user?.role === 'vendedor_yarda') {
                        setReassignIsYardSale(true);
                      }
                    }}
                    required
                    className="cyber-input w-full text-xs font-mono py-2"
                  >
                    <option value="">-- Seleccionar Asesor --</option>
                    {usersList.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.role === 'vendedor_yarda' ? '🚜 [Vendedor Yarda] ' : u.role === 'admin' ? '⭐ [Super Admin] ' : '👤 [Asesor Oficina] '}
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-mono font-bold text-amber-900 dark:text-amber-200">
                    <input
                      type="checkbox"
                      checked={reassignIsYardSale}
                      onChange={(e) => setReassignIsYardSale(e.target.checked)}
                      className="rounded border-amber-500/50 text-amber-600 focus:ring-0 accent-amber-500 bg-white dark:bg-[#070e1c] cursor-pointer"
                    />
                    <span className="font-bold">🚜 Venta originada en Yarda / Patio</span>
                  </label>
                  <p className="text-[10px] text-amber-800 dark:text-amber-400/80 font-mono mt-1.5 leading-relaxed">
                    Las ventas de empleados de la yarda quedan identificadas y <strong>exentas del 2% de comisiones de la oficina</strong> en la Relación Semanal.
                  </p>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-cyan-500/15">
                  <button
                    type="button"
                    onClick={() => setIsReassignModalOpen(false)}
                    className="cyber-btn-secondary px-3.5 py-1.5 text-xs font-mono"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isReassignSubmitting || !selectedReassignUserId}
                    className="px-4 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-mono font-bold text-xs shadow-md disabled:opacity-50"
                  >
                    {isReassignSubmitting ? 'Guardando...' : 'Guardar Reasignación'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Modal: Revertir Orden de Listo para Retiro a Pagado (Super Admin + WhatsApp OTP) */}
      {isSuperAdmin && isRevertToPaidModalOpen && (
        <div className="horizon-modal fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="cyber-card w-full max-w-lg p-6 border-rose-500/50 shadow-[0_0_40px_rgba(244,63,94,0.3)] space-y-4">
            <div className="flex items-center justify-between border-b border-rose-500/20 pb-3">
              <div className="flex items-center gap-2 text-rose-400 font-mono font-bold text-sm">
                <span className="material-symbols-outlined text-[20px]">history</span>
                <span>Revertir Orden a Pagado · #{order.code}</span>
              </div>
              <button
                type="button"
                onClick={closeRevertToPaidModal}
                disabled={revertLoading}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {revertSuccessMsg ? (
              <div className="p-4 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono text-xs text-center flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-[18px]">check_circle</span>
                <span>{revertSuccessMsg}</span>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs font-mono space-y-1.5 text-rose-200">
                  <p className="font-bold flex items-center gap-1.5 text-rose-300">
                    <span className="material-symbols-outlined text-[16px]">security</span>
                    Operación protegida con código WhatsApp
                  </p>
                  <p className="text-[11px] text-slate-300">
                    Esta acción devolverá la orden del estado <strong>Listo para Retiro</strong> al estado <strong>Pagado</strong>. La cita de entrega programada será anulada y la preparación volverá a quedar pendiente en el flujo comercial.
                  </p>
                </div>

                {revertError && (
                  <p role="alert" className="p-2.5 rounded-lg bg-red-950/40 border border-red-500/40 text-red-300 text-xs font-mono">
                    {revertError}
                  </p>
                )}

                <div>
                  <label className="text-xs font-mono font-bold text-[var(--text-secondary)] uppercase block mb-1.5">
                    Motivo de la reversión (obligatorio):
                  </label>
                  <textarea
                    required
                    rows={2}
                    placeholder="Explica detalladamente por qué se regresa la orden a Pagado..."
                    value={revertReason}
                    onChange={(e) => setRevertReason(e.target.value)}
                    disabled={revertLoading || revertOtpSent}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs font-mono text-white placeholder-slate-500 focus:border-rose-500 focus:outline-none"
                  />
                </div>

                {!revertOtpSent ? (
                  <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-800">
                    <button
                      type="button"
                      disabled={revertLoading}
                      onClick={closeRevertToPaidModal}
                      className="px-4 py-2 rounded-xl border border-slate-700 text-xs font-mono text-slate-400 hover:text-white"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={revertLoading || revertReason.trim().length < 5}
                      onClick={handleRequestRevertOtp}
                      className="px-4 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-mono font-bold flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="material-symbols-outlined text-[16px]">send</span>
                      <span>{revertLoading ? 'Enviando código...' : 'Solicitar código por WhatsApp'}</span>
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleConfirmRevertToPaid} className="space-y-4 pt-1">
                    <div className="p-3 rounded-xl bg-slate-950 border border-cyan-500/30 space-y-2">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-emerald-400 flex items-center gap-1 font-bold">
                          <span className="material-symbols-outlined text-[16px]">mark_chat_read</span>
                          Código enviado a tu WhatsApp
                          {revertTargetPhoneMasked && <span className="text-slate-400">({revertTargetPhoneMasked})</span>}
                        </span>
                        {revertCooldown > 0 && (
                          <span className="text-slate-400 text-[11px]">Reenviar en {revertCooldown}s</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 font-mono">
                        Ingresa el código único de 6 dígitos recibido por WhatsApp para autorizar la reversión:
                      </p>
                      <input
                        required
                        type="text"
                        maxLength={6}
                        pattern="\d{6}"
                        placeholder="123456"
                        autoFocus
                        value={revertCode}
                        onChange={(e) => setRevertCode(e.target.value.replace(/\D/g, ''))}
                        className="w-full text-center text-2xl font-mono font-black tracking-widest rounded-xl border border-rose-500/50 bg-slate-900 p-2 text-rose-300 focus:border-rose-400 focus:outline-none"
                      />
                    </div>

                    <div className="flex items-center justify-between gap-2.5 pt-2 border-t border-slate-800">
                      <button
                        type="button"
                        disabled={revertLoading || revertCooldown > 0}
                        onClick={handleRequestRevertOtp}
                        className="text-xs font-mono text-cyan-400 hover:text-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {revertCooldown > 0 ? `Reenviar código (${revertCooldown}s)` : 'Reenviar código WhatsApp'}
                      </button>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={revertLoading}
                          onClick={closeRevertToPaidModal}
                          className="px-3 py-1.5 rounded-xl border border-slate-700 text-xs font-mono text-slate-400 hover:text-white"
                        >
                          Cancelar
                        </button>
                        <button
                          type="submit"
                          disabled={revertLoading || revertCode.length !== 6}
                          className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-mono font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-lg shadow-rose-950 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <span className="material-symbols-outlined text-[16px]">verified_user</span>
                          <span>{revertLoading ? 'Verificando...' : 'Confirmar reversión'}</span>
                        </button>
                      </div>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {/* Modal: Cancelación especial de orden con devolución automática (Super Admin + SMS/WhatsApp OTP) */}
      {isSuperAdmin && isCancelOrderModalOpen && (
        <CancelOrderModal
          order={order}
          isOpen={isCancelOrderModalOpen}
          isSuperAdmin={isSuperAdmin}
          onClose={() => setIsCancelOrderModalOpen(false)}
          onOrderCancelled={async (updatedOrder) => {
            if (onUpdateOrder) {
              await onUpdateOrder(updatedOrder);
            }
          }}
          onToast={handleToast}
        />
      )}

      {/* Modal: Exonerar Anticipo (Super Admin) */}
      {isSuperAdmin && showExemptModal && (
        <div className="horizon-modal fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-lg bg-[#070c18] border border-amber-500/40 rounded-3xl p-6 shadow-[0_20px_50px_rgba(0,0,0,0.9)] space-y-5">
            <div className="flex items-center justify-between border-b border-amber-500/20 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <span className="material-symbols-outlined text-2xl">handshake</span>
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Exonerar Anticipo · #{order.code}</h3>
                  <p className="text-xs text-amber-400 font-mono">Cobro completo contra entrega (100%)</p>
                </div>
              </div>
              <button
                type="button"
                disabled={exemptingDownpayment}
                onClick={() => setShowExemptModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 text-xs text-slate-300 space-y-2">
              <p className="font-bold text-amber-300 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">admin_panel_settings</span>
                Regla especial exclusiva de Super Administrador
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-300">
                <li>El anticipo se registrará en <strong>$0.00 USD (Exonerado)</strong>.</li>
                <li>La orden avanza directamente a <strong>Pagado / Facturado</strong>.</li>
                <li>El patio iniciará la <strong>búsqueda y preparación</strong> de la refacción de inmediato.</li>
                <li>El <strong>100% del total (${totalPayable.toFixed(2)} USD)</strong> será exigido y cobrado al momento de la entrega física.</li>
              </ul>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider">
                Motivo / Justificación (opcional):
              </label>
              <textarea
                value={exemptNotes}
                onChange={(e) => setExemptNotes(e.target.value)}
                placeholder="Ej: Cliente recurrente de confianza, pagará completo en efectivo al recibir la pieza en su taller..."
                disabled={exemptingDownpayment}
                rows={3}
                className="w-full bg-[#030712] border border-cyan-500/30 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 font-sans"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={exemptingDownpayment}
                onClick={() => setShowExemptModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono font-bold transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={exemptingDownpayment}
                onClick={handleExemptDownpayment}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-mono font-black flex items-center gap-1.5 transition shadow-[0_0_20px_rgba(245,158,11,0.4)] cursor-pointer disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">verified</span>
                <span>{exemptingDownpayment ? 'Aprobando…' : 'Aprobar a Pagado (Exonerar)'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
