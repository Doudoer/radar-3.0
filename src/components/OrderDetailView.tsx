import React, { useState } from 'react';
import { Order, OrderStatus, CoreStatus } from '../types';
import { SecurityOtpModal } from './SecurityOtpModal';
import { InvoiceModal } from './InvoiceModal';
import { DispatchLabelModal } from './DispatchLabelModal';
import { canTransitionOrderStatus, getAllowedNextStatuses, ORDER_STATUS_LABELS, requiresStatusAuthorization } from '../utils/orderStatusRules';

interface OrderDetailViewProps {
  order: Order;
  onBack: () => void;
  onOpenSMS: (customerName: string, phone: string, order?: Order) => void;
  onOpenAuctionModal?: (order: Order) => void;
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
  const [previewStep, setPreviewStep] = useState<number | null>(null);
  const recordedStep = Math.min(4, Math.max(1, order.workflowStep || 1));
  const currentStep = previewStep ?? recordedStep;
  const [stockAssigned, setStockAssigned] = useState<string | null>(order.stockNumber || null);
  const [copiedNotification, setCopiedNotification] = useState<string | null>(null);
  const [messageLang, setMessageLang] = useState<'ES' | 'EN'>('ES');

  // Workflow state fields
  const [termsAttachment, setTermsAttachment] = useState<string>(order.termsAttachment || '');
  const [callSummary, setCallSummary] = useState<string>(order.callDetail || '');
  const [callConfirmed, setCallConfirmed] = useState<boolean>(order.callConfirmed || false);
  const [scheduledPickup, setScheduledPickup] = useState<string>(order.scheduledPickupAt || '');
  const [extensionReason, setExtensionReason] = useState<string>(order.pickupExtensionReason || '');
  const [showExtensionModal, setShowExtensionModal] = useState<boolean>(false);
  const [coreStatus, setCoreStatus] = useState<CoreStatus>(order.coreStatus || 'deposito_pendiente');
  const [checklistDelivered, setChecklistDelivered] = useState<boolean>(order.checklistDelivered || false);
  const [checklistInvoice, setChecklistInvoice] = useState<boolean>(order.checklistInvoice || false);

  // Modals state
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showDispatchModal, setShowDispatchModal] = useState(false);
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
  const calculateWarrantyRemaining = (): { daysLeft: number; statusClass: string; label: string } => {
    if (order.status !== 'entregado' || !order.deliveredAt) {
      return {
        daysLeft: order.warrantyDays || 60,
        statusClass: 'text-[#94a3b8] bg-[#94a3b8]/10 border-[#94a3b8]/30',
        label: 'Inicia al entregar físicamente',
      };
    }
    const deliveredDate = new Date(order.deliveredAt).getTime();
    const elapsedDays = Math.floor((Date.now() - deliveredDate) / (1000 * 60 * 60 * 24));
    const daysLeft = Math.max(0, (order.warrantyDays || 60) - elapsedDays);

    if (daysLeft > 10) {
      return {
        daysLeft,
        statusClass: 'text-[#34d399] bg-[#10b981]/15 border-[#10b981]/30',
        label: `🟢 Vigente (${daysLeft} días restantes)`,
      };
    } else if (daysLeft > 0) {
      return {
        daysLeft,
        statusClass: 'text-[#facc15] bg-[#eab308]/15 border-[#eab308]/30',
        label: `🟡 Crítica (${daysLeft} días restantes)`,
      };
    } else {
      return {
        daysLeft: 0,
        statusClass: 'text-[#f87171] bg-[#ef4444]/15 border-[#ef4444]/30',
        label: '🔴 Garantía Expirada',
      };
    }
  };

  const warrantyInfo = calculateWarrantyRemaining();

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedNotification(label);
    setTimeout(() => setCopiedNotification(null), 2500);
  };

  const handleAssignStock = () => {
    const newStock = `STK-2026-${Math.floor(100 + Math.random() * 900)}`;
    setStockAssigned(newStock);
    if (onUpdateOrder) {
      onUpdateOrder({ ...order, stockNumber: newStock });
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
      setClaimModal({ isOpen: false, reason: '', isSaving: false, error: '' });
    } catch {
      setClaimModal((previous) => ({ ...previous, isSaving: false, error: 'No se pudo crear el reclamo en radar_db.' }));
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
    },
    {
      num: 2,
      title: 'Acuse de Términos',
      sub: 'Llamada o Chat (2-3 días)',
      desc: 'Confirmación verbal o comprobante digital de acuse recibido por el cliente.',
    },
    {
      num: 3,
      title: 'Coordinación de Cita',
      sub: 'Pieza Lista & Agenda',
      desc: 'Programación de fecha/hora de retiro o delivery con gestión de prórrogas.',
    },
    {
      num: 4,
      title: 'Cierre Operativo',
      sub: 'Checklist & Garantía',
      desc: 'Verificación física, factura emitida, control de CORE e inicio de garantía.',
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

  const templateMessageES = `Fecha de la orden: ${new Date().toLocaleDateString('es-ES')}
Vehículo: ${vehicleName} ${order.vehicle.year}
Pieza: ${partType}
VIN: ${order.vehicle.vin}
Stock #: ${stockAssigned || order.stockNumber || 'STK-2026-098'}

DESGLOSE FINANCIERO:
• Monto de la Parte: $${partPrice.toFixed(2)}
• Abono / Downpayment: -$${downPayment.toFixed(2)}
• Monto de Delivery: $${deliveryFee.toFixed(2)}
• Monto del Core Fee: $${coreFee.toFixed(2)}
────────────────────────────────
TOTAL: $${totalPayable.toFixed(2)}

Métodos de pago: Zelle, CashApp, Tarjeta, Efectivo
Garantía: ${order.warrantyDays || 60} días (a partir de la entrega física)
Tipo de Entrega: ${isHomeDelivery ? 'Envío' : 'Retiro en Tienda Principal RADAR'}`;

  const templateMessageEN = `Order Date: ${new Date().toLocaleDateString('en-US')}
Vehicle: ${vehicleName} ${order.vehicle.year}
Part: ${partType}
VIN: ${order.vehicle.vin}
Stock #: ${stockAssigned || order.stockNumber || 'STK-2026-098'}

FINANCIAL SUMMARY:
• Part Price: $${partPrice.toFixed(2)}
• Downpayment: -$${downPayment.toFixed(2)}
• Delivery Fee: $${deliveryFee.toFixed(2)}
• Core Fee: $${coreFee.toFixed(2)}
────────────────────────────────
TOTAL: $${totalPayable.toFixed(2)}

Payment Methods: Zelle, CashApp, Card, Cash
Warranty: ${order.warrantyDays || 60} days (effective upon physical delivery)
Delivery Type: ${isHomeDelivery ? 'Home Delivery' : 'Pickup at RADAR Main Store'}`;

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col gap-5 animate-fade-in text-[#dfe2ef] pb-8">
      {/* 1. TOP HEADER & BREADCRUMB ROW */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={onBack}
              className="hover:text-[#58a6ff] text-[#94a3b8] transition-colors cursor-pointer mr-1"
              title="Volver"
            >
              <span className="material-symbols-outlined text-[24px]">arrow_back</span>
            </button>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#f1f5f9] tracking-tight flex items-center gap-2">
              <span>Orden</span>
              <span className="text-[#388bfd] font-mono">#{order.code}</span>
            </h1>

            {/* Interactive Status Selector Dropdown */}
            <select
              value={order.status}
              onChange={(e) => handleStatusChange(e.target.value as OrderStatus)}
              className="bg-[#0b1329] border border-[#388bfd]/50 text-[#58a6ff] font-bold text-xs rounded-full px-3.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#388bfd] cursor-pointer shadow-sm uppercase tracking-wider"
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status === order.status ? `Actual: ${ORDER_STATUS_LABELS[status]}` : ORDER_STATUS_LABELS[status]}
                </option>
              ))}
            </select>

            {downPayment === 0 ? (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#ef4444]/15 text-[#f87171] border border-[#ef4444]/30">
                Sin Abono ($0.00)
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#10b981]/15 text-[#34d399] border border-[#10b981]/30">
                Abono: ${downPayment.toFixed(2)}
              </span>
            )}
          </div>

          <p className="text-xs sm:text-sm text-[#94a3b8] mt-1 font-medium pl-8">
            Creada el {order.createdAt || '24 Oct 2026, 14:32'} • Asesor:{' '}
            <strong className="text-[#e2e8f0]">{order.advisor || 'Carlos Mendoza'}</strong>
          </p>
        </div>

        {/* Top Right Segmented Tabs */}
        <div className="flex items-center bg-[#0b1329] border border-[#1e293b] p-1.5 rounded-xl shadow-lg self-start sm:self-auto overflow-x-auto max-w-full">
          <button
            onClick={() => setActiveTab('resumen')}
            className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-bold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'resumen'
                ? 'bg-[#1e293b] text-[#58a6ff] shadow-md border border-[#388bfd]/30'
                : 'text-[#94a3b8] hover:text-[#f1f5f9]'
            }`}
          >
            1. Resumen
          </button>
          <button
            onClick={() => setActiveTab('workflow')}
            className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-bold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'workflow'
                ? 'bg-[#1e293b] text-[#58a6ff] shadow-md border border-[#388bfd]/30'
                : 'text-[#94a3b8] hover:text-[#f1f5f9]'
            }`}
          >
            2. Flujo
          </button>
          <button
            onClick={() => setActiveTab('historial')}
            className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-bold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'historial'
                ? 'bg-[#1e293b] text-[#58a6ff] shadow-md border border-[#388bfd]/30'
                : 'text-[#94a3b8] hover:text-[#f1f5f9]'
            }`}
          >
            3. Historial
          </button>
        </div>
      </div>

      {order.status === 'reclamo' && (
        <div className="rounded-2xl border border-[#ef4444]/40 bg-[#ef4444]/10 p-4 shadow-[0_0_24px_rgba(239,68,68,0.12)]">
          <div className="flex flex-col sm:flex-row sm:items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#ef4444]/20 border border-[#ef4444]/40 text-[#f87171] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[22px]">report_problem</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-black uppercase tracking-wider text-[#fecaca]">Reclamo abierto</h2>
                <span className="rounded-full border border-[#ef4444]/40 bg-[#ef4444]/15 px-2 py-0.5 text-[10px] font-bold text-[#fca5a5]">
                  Pendiente en Reclamos
                </span>
              </div>
              <p className="mt-1 text-xs text-[#fca5a5]">
                Esta orden tiene un reclamo activo y requiere seguimiento antes de continuar el proceso normal.
              </p>
              {order.claimReason && (
                <div className="mt-3 rounded-xl border border-[#ef4444]/30 bg-[#080e1e]/80 p-3 text-xs text-[#fee2e2]">
                  <span className="font-bold text-[#fca5a5]">Motivo:</span> {order.claimReason}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. WORKFLOW CALL CENTER STEPPER (4 PROGRESSIVE STAGES) */}
      <div className="bg-[#0b1329] border border-[#1e293b] rounded-2xl p-5 sm:p-6 shadow-xl flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold tracking-widest text-[#94a3b8] uppercase">
            <span className="material-symbols-outlined text-[#388bfd] text-[18px]">headset_mic</span>
            <span>FLUJO GUIADO CALL CENTER RADAR (4 ETAPAS)</span>
          </div>
          <span className="font-mono text-xs font-bold text-[#58a6ff] bg-[#388bfd]/10 px-2.5 py-1 rounded-lg border border-[#388bfd]/25">
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
                className={`p-4 rounded-xl border transition-all flex flex-col items-center text-center gap-2.5 relative ${
                  isCurrent
                    ? 'bg-[#111f38] border-[#388bfd] shadow-[0_0_15px_rgba(56,139,253,0.3)]'
                    : isCompleted
                    ? 'bg-[#0f172a] border-[#10b981]/40'
                    : 'bg-[#080e1e] border-[#1e293b] opacity-50'
                }`}
              >
                {/* Step Circle Node */}
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm transition-transform ${
                    isCompleted
                      ? 'bg-[#10b981] text-[#0a1120] shadow-[0_0_10px_rgba(16,185,129,0.4)]'
                      : isCurrent
                      ? 'border-2 border-[#388bfd] bg-[#0b1329] text-[#58a6ff] shadow-[0_0_12px_#388bfd]'
                      : 'bg-[#1e293b] text-[#64748b]'
                  }`}
                >
                  {isCompleted ? (
                    <span className="material-symbols-outlined text-[20px] font-black">check</span>
                  ) : isLocked ? (
                    <span className="material-symbols-outlined text-[16px] text-[#64748b]">lock</span>
                  ) : (
                    <span>{step.num}</span>
                  )}
                </div>

                <div>
                  <h4
                    className={`font-bold text-xs sm:text-sm tracking-tight ${
                      isCurrent ? 'text-[#58a6ff]' : isCompleted ? 'text-[#34d399]' : 'text-[#cbd5e1]'
                    }`}
                  >
                    {step.title}
                  </h4>
                  <span className="text-[11px] text-[#64748b] block">{step.sub}</span>
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
        <div className="flex flex-col gap-5">
          {/* Main 3 Column Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Card 1: Refacción y Vehículo */}
            <div className="bg-[#0b1329] border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between gap-4 relative overflow-hidden group">
              {/* Vehicle Banner Background image */}
              <div className="relative h-36 rounded-xl overflow-hidden bg-gradient-to-t from-[#0b1329] via-[#0b1329]/60 to-transparent flex items-end p-4 border border-[#1e293b]/60">
                <img
                  src={partImageUrl}
                  alt={isTransmission ? 'Transmisión automotriz' : 'Motor automotriz'}
                  className="absolute inset-0 w-full h-full object-cover object-center opacity-40 group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0b1329] via-transparent to-transparent" />
                <div className="relative z-10">
                  <h3 className="text-xl font-bold text-[#f1f5f9] tracking-tight">{vehicleName}</h3>
                  <p className="text-xs text-[#94a3b8] font-medium">{vehicleDetails}</p>
                </div>
              </div>

              {/* Specs Grid */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider block">
                    VIN
                  </span>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="font-mono font-bold text-[#f1f5f9] truncate">
                      {order.vehicle.vin}
                    </span>
                    <button
                      onClick={() => handleCopy(order.vehicle.vin, 'VIN')}
                      className="text-[#94a3b8] hover:text-[#58a6ff] cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[14px]">content_copy</span>
                    </button>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider block">
                    STOCK #
                  </span>
                  <div className="mt-0.5">
                    {stockAssigned ? (
                      <span className="font-mono font-bold text-[#34d399]">{stockAssigned}</span>
                    ) : (
                      <button
                        onClick={handleAssignStock}
                        className="text-[#f59e0b] hover:text-[#fbbf24] font-bold cursor-pointer transition-colors text-xs"
                      >
                        + Asignar Stock
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider block">
                    PIEZA PRINCIPAL
                  </span>
                  <span className="font-bold text-[#58a6ff] block mt-0.5">{partType}</span>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider block">
                    TIPO DE ENTREGA
                  </span>
                  <span className="inline-flex items-center gap-1.5 bg-[#080e1e] border border-[#1e293b] text-xs font-bold text-[#f1f5f9] rounded-lg px-2 py-1 mt-0.5">
                    <span className="material-symbols-outlined text-[15px] text-[#58a6ff]">
                      {isHomeDelivery ? 'local_shipping' : 'storefront'}
                    </span>
                    {isHomeDelivery ? 'Envío' : 'Retiro en Tienda'}
                  </span>
                </div>
              </div>

              {/* Technical Description Box */}
              <div className="bg-[#080e1e] border border-[#1e293b] rounded-xl p-3 text-xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748b] block mb-1">
                  ESPECIFICACIONES & DESCRIPCIÓN TÉCNICA
                </span>
                <p className="text-[#cbd5e1] font-mono text-[11px] leading-relaxed">
                  {order.notes || order.productSpecs || '2.4 • 2.4L (VIN B, 8th digit), engine ID ED6 (Federal)'}
                </p>
              </div>
            </div>

            {/* Card 2: Perfil del Cliente */}
            <div className="bg-[#0b1329] border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between gap-4">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#58a6ff] text-[20px]">person</span>
                    <h3 className="font-bold text-base text-[#f1f5f9]">Datos de Cliente</h3>
                  </div>
                  <div className="w-9 h-9 rounded-full bg-[#1e293b] border border-[#334155] text-[#58a6ff] font-extrabold text-xs flex items-center justify-center shadow-inner">
                    {order.customer.initials || 'SA'}
                  </div>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748b] block mt-0.5">
                  CLIENTE REGISTRADO (CRM)
                </span>

                <div className="flex flex-col gap-3 mt-4 text-xs">
                  <div className="flex items-center gap-2.5 text-[#cbd5e1]">
                    <span className="material-symbols-outlined text-[16px] text-[#94a3b8]">badge</span>
                    <span className="font-semibold text-[#f1f5f9]">{order.customer.name}</span>
                  </div>

                  <div className="flex items-center gap-2.5 text-[#cbd5e1]">
                    <span className="material-symbols-outlined text-[16px] text-[#94a3b8]">call</span>
                    <span className="font-mono font-bold text-[#f1f5f9]">{order.customer.phone}</span>
                  </div>

                  {order.customer.shippingAddress?.trim() && (
                    <div className="flex items-center gap-2.5 text-[#cbd5e1]">
                      <span className="material-symbols-outlined text-[16px] text-[#94a3b8]">location_on</span>
                      <span>{order.customer.shippingAddress}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Button: SMS */}
              <div className="pt-2 border-t border-[#1e293b]">
                <button
                  onClick={() => onOpenSMS(order.customer.name, order.customer.phone, order)}
                  className="w-full py-2.5 px-3 rounded-xl bg-[#1e293b] hover:bg-[#334155] text-xs font-bold text-[#f1f5f9] flex items-center justify-center gap-2 transition-colors cursor-pointer border border-[#334155]"
                >
                  <span className="material-symbols-outlined text-[16px] text-[#58a6ff]">chat</span>
                  <span>SMS</span>
                </button>
              </div>
            </div>

            {/* Card 3: Resumen Financiero */}
            <div className="bg-[#0b1329] border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between gap-4">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#10b981] text-[20px]">account_balance_wallet</span>
                    <h3 className="font-bold text-base text-[#f1f5f9]">Resumen Financiero</h3>
                  </div>
                  <span className="text-[10px] font-mono text-[#34d399] font-bold bg-[#10b981]/10 px-2 py-0.5 rounded border border-[#10b981]/25">
                    FÓRMULA RADAR
                  </span>
                </div>

                <div className="flex flex-col gap-2 mt-4 text-xs">
                  {/* 1. Monto de la Parte */}
                  <div className="flex justify-between items-center text-[#cbd5e1]">
                    <span className="font-medium">Monto de la Parte</span>
                    <span className="font-mono font-bold text-[#f1f5f9]">${partPrice.toFixed(2)}</span>
                  </div>

                  {/* 2. Abono o Downpayment */}
                  <div className="flex justify-between items-center text-[#f59e0b]">
                    <span className="font-medium">Abono / Downpayment</span>
                    <span className="font-mono font-bold">
                      {downPayment > 0 ? `-$${downPayment.toFixed(2)}` : '$0.00'}
                    </span>
                  </div>

                  {/* 3. Monto de Delivery */}
                  <div className="flex justify-between items-center text-[#cbd5e1]">
                    <span className="font-medium">Monto de Delivery</span>
                    <span className="font-mono font-bold text-[#f1f5f9]">${deliveryFee.toFixed(2)}</span>
                  </div>

                  {/* 4. Monto del Core Fee */}
                  <div className="flex justify-between items-center text-[#cbd5e1]">
                    <span className="font-medium">Monto del Core Fee</span>
                    <span className="font-mono font-bold text-[#f1f5f9]">${coreFee.toFixed(2)}</span>
                  </div>

                  <div className="h-px bg-[#1e293b] my-1" />

                  {/* Subtotal de Cargos */}
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[#94a3b8]">Subtotal de Cargos</span>
                    <span className="font-mono font-bold text-[#94a3b8]">${grossSubtotal.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* 5. Glowing Big Total Box */}
              <div className="border-t border-[#1e293b] pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider block">
                    {downPayment > 0 ? 'TOTAL A PAGAR (BALANCE)' : 'TOTAL ESTIMADO'}
                  </span>
                  {downPayment > 0 && (
                    <span className="text-[10px] font-mono text-[#34d399] font-bold">
                      Abono Aplicado: ${downPayment.toFixed(2)}
                    </span>
                  )}
                </div>
                <h2 className="text-2xl sm:text-3xl font-black text-[#58a6ff] tracking-tight font-mono drop-shadow-[0_0_15px_rgba(56,139,253,0.6)] mt-0.5">
                  ${totalPayable.toFixed(2)}
                </h2>
              </div>
            </div>
          </div>

          {/* Bottom Section: Cobertura de Garantía con Semáforo & Emisión de Documentos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Card 1: Cobertura de Garantía & Semáforo */}
            <div className="bg-[#0b1329] border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between gap-4">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#10b981] text-[20px]">verified_user</span>
                    <h3 className="font-bold text-base text-[#f1f5f9]">Semáforo de Garantía</h3>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border font-mono ${warrantyInfo.statusClass}`}>
                    {warrantyInfo.label}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div className="bg-[#080e1e] border border-[#1e293b] p-3 rounded-xl">
                    <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider block">
                      PLAN ASIGNADO
                    </span>
                    <span className="text-xs font-bold text-[#34d399] mt-0.5 block">
                      {order.warrantyDays || 60} Días de Garantía RADAR
                    </span>
                  </div>

                  <div className="bg-[#080e1e] border border-[#1e293b] p-3 rounded-xl">
                    <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider block">
                      FECHA ENTREGA
                    </span>
                    <span className="text-xs font-mono font-bold text-[#f1f5f9] mt-0.5 block">
                      {order.deliveredAt ? new Date(order.deliveredAt).toLocaleDateString() : 'Pendiente Entrega'}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-2.5 mt-3 text-xs text-[#cbd5e1]">
                  <div className="flex items-start gap-2">
                    <span className="material-symbols-outlined text-[16px] text-[#10b981] shrink-0 mt-0.5">
                      check_circle
                    </span>
                    <div>
                      <strong className="text-[#f1f5f9] block">Tren Motriz Completo</strong>
                      <span className="text-[11px] text-[#94a3b8]">Motor, inyección, bloque, empaques y accesorios mecánicos</span>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <span className="material-symbols-outlined text-[16px] text-[#10b981] shrink-0 mt-0.5">
                      check_circle
                    </span>
                    <div>
                      <strong className="text-[#f1f5f9] block">Garantía Activa Post-Entrega</strong>
                      <span className="text-[11px] text-[#94a3b8]">Válida presentando recibo y número de orden #{order.code}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 2: Documentación Oficial & Despacho */}
            <div className="bg-[#0b1329] border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between gap-4">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#388bfd] text-[20px]">description</span>
                    <h3 className="font-bold text-base text-[#f1f5f9]">Documentación Oficial & Despacho</h3>
                  </div>
                  <span className="text-[10px] font-mono text-[#58a6ff] font-bold bg-[#388bfd]/10 px-2 py-0.5 rounded border border-[#388bfd]/25">
                    RADAR DOCS
                  </span>
                </div>

                <p className="text-xs text-[#94a3b8] mt-2">
                  Generación e impresión de comprobantes fiscales, desglose de montos y rotulado para taller o paquetería.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <div className="bg-[#080e1e] border border-[#1e293b] p-3 rounded-xl flex flex-col justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider block">
                        COMPROBANTE
                      </span>
                      <strong className="text-xs text-[#f1f5f9] block mt-0.5">Factura / Invoice</strong>
                      <span className="text-[11px] text-[#94a3b8]">Desglose con CORE y Downpayment</span>
                    </div>
                    <button
                      type="button"
                      disabled
                      className="w-full py-2 rounded-xl bg-[#1e293b]/60 text-xs font-bold text-[#94a3b8] flex items-center justify-center gap-1.5 border border-[#334155]/60 opacity-60 cursor-not-allowed"
                    >
                      <span className="material-symbols-outlined text-[15px] text-[#388bfd]">receipt</span>
                      <span>Ver Factura</span>
                    </button>
                  </div>

                  <div className="bg-[#080e1e] border border-[#1e293b] p-3 rounded-xl flex flex-col justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider block">
                        LOGÍSTICA
                      </span>
                      <strong className="text-xs text-[#f1f5f9] block mt-0.5">Etiqueta 4x6"</strong>
                      <span className="text-[11px] text-[#94a3b8]">Rótulo con QR y tipo de entrega</span>
                    </div>
                    <button
                      type="button"
                      disabled
                      className="w-full py-2 rounded-xl bg-[#1e293b]/60 text-xs font-bold text-[#94a3b8] flex items-center justify-center gap-1.5 border border-[#334155]/60 opacity-60 cursor-not-allowed"
                    >
                      <span className="material-symbols-outlined text-[15px] text-[#34d399]">qr_code_2</span>
                      <span>Imprimir 4x6</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-[#080e1e] border border-[#1e293b] p-3 rounded-xl flex items-center justify-between text-xs text-[#94a3b8]">
                <span className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-[#58a6ff]">local_shipping</span>
                  <span>Modo: <strong className="text-[#f1f5f9]">{isHomeDelivery ? 'Envío' : 'Retiro en Tienda'}</strong></span>
                </span>
                <span className="font-mono text-[11px] text-[#64748b]">ID: #{order.code}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: FLUJO SIMPLIFICADO                                                */}
      {/* ========================================================================= */}
      {activeTab === 'workflow' && (
        <div className="bg-[#0b1329] border border-[#1e293b] rounded-2xl p-6 shadow-xl flex flex-col gap-5">
          <div className="flex items-center justify-between border-b border-[#1e293b] pb-4">
            <div>
              <span className="text-xs font-mono text-[#58a6ff] uppercase font-bold tracking-wider">
                Flujo operativo de la orden
              </span>
              <h2 className="text-lg font-bold text-[#f1f5f9] mt-0.5">
                Marca cada paso para habilitar el siguiente
              </h2>
            </div>
            <span className="rounded-lg border border-[#388bfd]/30 bg-[#388bfd]/10 px-3 py-1.5 text-xs font-mono font-bold text-[#58a6ff]">
              Paso activo: {currentStep} de 4
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {workflowSteps.map((step) => {
              const isChecked = step.num < currentStep || (step.num === 4 && order.status === 'entregado');
              const isEnabled = step.num <= currentStep;

              return (
                <label
                  key={step.num}
                  className={`flex items-center gap-4 rounded-2xl border p-4 transition-all ${
                    isEnabled
                      ? 'border-[#263b61] bg-[#101c30] hover:border-[#388bfd]/60 cursor-pointer'
                      : 'border-[#1e293b] bg-[#080e1e]/70 opacity-50 cursor-not-allowed'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={!isEnabled || isChecked}
                    onChange={() => handleWorkflowStepCheck(step.num)}
                    className="h-5 w-5 rounded accent-[#10b981] disabled:opacity-60"
                  />
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#334155] bg-[#0b1329] text-sm font-black text-[#58a6ff]">
                    {isChecked ? <span className="material-symbols-outlined text-[20px] text-[#34d399]">check</span> : step.num}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                      <h3 className="font-bold text-sm text-[#f1f5f9]">{step.title}</h3>
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${
                        isChecked ? 'text-[#34d399]' : isEnabled ? 'text-[#58a6ff]' : 'text-[#64748b]'
                      }`}>
                        {isChecked ? 'Completado' : isEnabled ? 'Disponible' : 'Bloqueado'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[#94a3b8]">{step.desc}</p>
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
        <div className="bg-[#0b1329] border border-[#1e293b] rounded-2xl p-6 shadow-xl flex flex-col gap-4">
          <div className="flex items-center gap-2 text-sm font-bold text-[#f1f5f9]">
            <span className="material-symbols-outlined text-[#388bfd] text-[20px]">history</span>
            <span>Bitácora de Eventos de la Orden #{order.code}</span>
          </div>

          <div className="flex flex-col gap-3 relative pl-6 before:absolute before:left-3 before:top-4 before:bottom-4 before:w-[2px] before:bg-[#1e293b]">
            <div className="bg-[#080e1e] border border-[#1e293b] rounded-xl p-4 flex flex-col gap-1 relative">
              <div className="absolute -left-[27px] top-4 w-6 h-6 rounded-full bg-[#388bfd]/20 text-[#58a6ff] flex items-center justify-center text-[12px] border border-[#1e293b]">
                <span className="material-symbols-outlined text-[14px]">inventory_2</span>
              </div>
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs text-[#f1f5f9]">Creación de orden #{order.code}</h4>
                <span className="font-mono text-[11px] text-[#94a3b8]">{order.createdAt || '24 Oct 2026, 14:32'}</span>
              </div>
              <p className="text-xs text-[#cbd5e1]">
                Vehículo: {vehicleName} • Cliente: {order.customer.name} • Monto Total: ${grossSubtotal.toFixed(2)}
              </p>
            </div>

            <div className="bg-[#080e1e] border border-[#1e293b] rounded-xl p-4 flex flex-col gap-1 relative">
              <div className="absolute -left-[27px] top-4 w-6 h-6 rounded-full bg-[#10b981]/20 text-[#34d399] flex items-center justify-center text-[12px] border border-[#1e293b]">
                <span className="material-symbols-outlined text-[14px]">send</span>
              </div>
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs text-[#f1f5f9]">Notificación de Nueva Venta disparada (Wasender)</h4>
                <span className="font-mono text-[11px] text-[#94a3b8]">Disparo Único</span>
              </div>
              <p className="text-xs text-[#cbd5e1]">Alerta transmitida exitosamente a gerencia y taller.</p>
            </div>

            {order.deliveredAt && (
              <div className="bg-[#080e1e] border border-[#1e293b] rounded-xl p-4 flex flex-col gap-1 relative">
                <div className="absolute -left-[27px] top-4 w-6 h-6 rounded-full bg-[#14b8a6]/20 text-[#2dd4bf] flex items-center justify-center text-[12px] border border-[#1e293b]">
                  <span className="material-symbols-outlined text-[14px]">verified</span>
                </div>
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-xs text-[#f1f5f9]">Entrega Física y Comienzo de Garantía</h4>
                  <span className="font-mono text-[11px] text-[#94a3b8]">{new Date(order.deliveredAt).toLocaleDateString()}</span>
                </div>
                <p className="text-xs text-[#cbd5e1]">
                  Garantía activa de {order.warrantyDays || 60} días. Reloj en conteo regresivo.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Extension Modal */}
      {showExtensionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#0b1329] border border-[#1e293b] rounded-2xl w-full max-w-md p-6 shadow-2xl flex flex-col gap-4 text-[#dfe2ef]">
            <h3 className="font-bold text-base text-[#f1f5f9] flex items-center gap-2">
              <span className="material-symbols-outlined text-[#facc15]">more_time</span>
              <span>Registrar Prórroga de Retiro</span>
            </h3>
            <textarea
              rows={3}
              value={extensionReason}
              onChange={(e) => setExtensionReason(e.target.value)}
              placeholder="Motivo de la prórroga (ej: Cliente solicitó retirar el fin de semana por motivos laborales)..."
              className="w-full bg-[#080e1e] border border-[#1e293b] rounded-xl p-3 text-xs text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowExtensionModal(false)}
                className="px-4 py-2 bg-[#1e293b] hover:bg-[#334155] rounded-xl text-xs font-bold cursor-pointer"
              >
                Cerrar
              </button>
              <button
                onClick={() => setShowExtensionModal(false)}
                className="px-4 py-2 bg-[#388bfd] hover:bg-[#2563eb] text-[#0a1120] font-black rounded-xl text-xs cursor-pointer"
              >
                Guardar Prórroga
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Claim Creation Modal */}
      {claimModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <form onSubmit={handleSubmitClaim} className="bg-[#0b1329] border border-[#1e293b] rounded-2xl w-full max-w-lg p-6 shadow-2xl flex flex-col gap-4 text-[#dfe2ef]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-base text-[#f1f5f9] flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#f87171]">report_problem</span>
                  <span>Crear Reclamo Pendiente</span>
                </h3>
                <p className="mt-1 text-xs text-[#94a3b8]">
                  Orden #{order.code} · {order.customer.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setClaimModal({ isOpen: false, reason: '', isSaving: false, error: '' })}
                className="rounded-lg p-1.5 text-[#94a3b8] hover:bg-[#1e293b] hover:text-white cursor-pointer"
                disabled={claimModal.isSaving}
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="rounded-xl border border-[#ef4444]/30 bg-[#ef4444]/10 p-3 text-xs text-[#fecaca]">
              Al guardar, la orden pasará a estatus Reclamo y se creará un reclamo pendiente en el módulo de Reclamos.
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-[#f1f5f9]">Motivo del reclamo *</label>
              <textarea
                rows={5}
                value={claimModal.reason}
                onChange={(event) => setClaimModal((previous) => ({ ...previous, reason: event.target.value, error: '' }))}
                placeholder="Describe el problema reportado por el cliente, síntomas, pieza afectada y cualquier detalle operativo..."
                className="w-full resize-none rounded-xl border border-[#1e293b] bg-[#080e1e] p-3 text-xs text-[#f1f5f9] focus:border-[#ef4444] focus:outline-none"
                disabled={claimModal.isSaving}
              />
            </div>

            {claimModal.error && (
              <div className="rounded-lg border border-[#ef4444]/40 bg-[#ef4444]/10 px-3 py-2 text-xs font-bold text-[#fca5a5]">
                {claimModal.error}
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-[#1e293b] pt-3">
              <button
                type="button"
                onClick={() => setClaimModal({ isOpen: false, reason: '', isSaving: false, error: '' })}
                className="rounded-xl bg-[#1e293b] px-4 py-2 text-xs font-bold text-[#cbd5e1] hover:bg-[#334155] cursor-pointer disabled:opacity-50"
                disabled={claimModal.isSaving}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-xl bg-[#ef4444] px-4 py-2 text-xs font-black text-white hover:bg-[#dc2626] cursor-pointer disabled:opacity-50"
                disabled={claimModal.isSaving}
              >
                {claimModal.isSaving ? 'Guardando...' : 'Crear Reclamo'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Invoice Modal */}
      <InvoiceModal
        isOpen={showInvoiceModal}
        onClose={() => setShowInvoiceModal(false)}
        order={order}
      />

      {/* Dispatch 4x6 Label Modal */}
      <DispatchLabelModal
        isOpen={showDispatchModal}
        onClose={() => setShowDispatchModal(false)}
        order={order}
      />

      {/* Security OTP Modal */}
      <SecurityOtpModal
        isOpen={securityModal.isOpen}
        onClose={() => setSecurityModal((prev) => ({ ...prev, isOpen: false }))}
        onSuccess={handleSecuritySuccess}
        actionTitle={securityModal.actionTitle}
        actionDescription={securityModal.actionDescription}
        orderCode={order.code}
      />

      {/* Toast */}
      {copiedNotification && (
        <div className="fixed bottom-6 right-6 bg-[#388bfd] text-[#0a1120] font-black px-4 py-2.5 rounded-xl shadow-2xl text-xs flex items-center gap-2 z-50 animate-bounce">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          <span>{copiedNotification} copiado al portapapeles</span>
        </div>
      )}
    </div>
  );
};
