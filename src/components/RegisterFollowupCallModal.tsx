import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FollowupCallResult, FollowupPartStatus, FollowupContactChannel } from '../types';
import { apiFetch } from '../services/apiFetch';

export interface RegisterFollowupCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  orderCode: string;
  customerName: string;
  customerPhone: string;
  customerLanguage?: 'es' | 'en';
  vehicle?: string;
  mainPart?: string;
  daysSinceDelivery?: number;
  assignedAdvisor?: string;
  currentOperatorName?: string;
  initialContactChannel?: FollowupContactChannel;
  initialCallResult?: FollowupCallResult;
  initialPartStatus?: FollowupPartStatus;
  initialWarrantyWarning?: boolean;
  initialPromisedDate?: string;
  onSuccess?: () => void | Promise<void>;
}

export const RegisterFollowupCallModal: React.FC<RegisterFollowupCallModalProps> = ({
  isOpen,
  onClose,
  orderId,
  orderCode,
  customerName,
  customerPhone,
  customerLanguage = 'es',
  vehicle,
  mainPart,
  daysSinceDelivery,
  assignedAdvisor,
  currentOperatorName,
  initialContactChannel,
  initialCallResult,
  initialPartStatus,
  initialWarrantyWarning,
  initialPromisedDate,
  onSuccess,
}) => {
  const [channel, setChannel] = useState<FollowupContactChannel>(initialContactChannel || 'call');
  const [callResult, setCallResult] = useState<FollowupCallResult>(initialCallResult || 'answered');
  const [partStatus, setPartStatus] = useState<FollowupPartStatus>(initialPartStatus || 'not_installed');
  const [warrantyWarningGiven, setWarrantyWarningGiven] = useState<boolean>(initialWarrantyWarning || false);
  const [promisedInstallDate, setPromisedInstallDate] = useState<string>(initialPromisedDate || '');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string>('');
  const [formSuccess, setFormSuccess] = useState<string>('');
  const [copiedTemplate, setCopiedTemplate] = useState<boolean>(false);
  const [templateStage, setTemplateStage] = useState<'estandar' | 'recepcion' | 'rodaje'>('estandar');
  const [templateLanguage, setTemplateLanguage] = useState<'es' | 'en'>(customerLanguage || 'es');

  useEffect(() => {
    if (isOpen) {
      const initialChan = initialContactChannel || 'call';
      setChannel(initialChan);
      setCallResult(initialCallResult || (initialChan === 'call' ? 'answered' : 'sms_replied'));
      setPartStatus(initialPartStatus || 'not_installed');
      setWarrantyWarningGiven(initialWarrantyWarning || false);
      setPromisedInstallDate(initialPromisedDate || '');
      setNotes('');
      setFormError('');
      setFormSuccess('');
      setCopiedTemplate(false);
      setTemplateStage('estandar');
      setTemplateLanguage(customerLanguage || 'es');
    }
  }, [isOpen, customerLanguage, initialContactChannel, initialCallResult, initialPartStatus, initialWarrantyWarning, initialPromisedDate]);

  // Handle ESC key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isCall = channel === 'call';
  const isDirectContact = callResult === 'answered' || callResult === 'sms_replied';

  const handleChannelChange = (newChannel: FollowupContactChannel) => {
    setChannel(newChannel);
    setFormError('');

    if (newChannel === 'call') {
      if (callResult === 'sms_replied') {
        setCallResult('answered');
      } else if (callResult === 'sms_sent' || callResult === 'sms_no_reply') {
        setCallResult('no_answer');
      }
    } else {
      if (callResult === 'answered') {
        setCallResult('sms_replied');
      } else if (callResult === 'no_answer' || callResult === 'busy') {
        setCallResult('sms_sent');
      }
    }
  };

  const clientNameStr =
    typeof customerName === 'object' && customerName !== null
      ? (customerName as any).name || 'Cliente'
      : customerName !== undefined && customerName !== null && String(customerName).trim()
      ? String(customerName).trim()
      : 'Cliente';

  const vehicleStr =
    typeof vehicle === 'object' && vehicle !== null
      ? `${(vehicle as any).year || ''} ${(vehicle as any).make || ''} ${(vehicle as any).model || ''}`.trim()
      : vehicle !== undefined && vehicle !== null
      ? String(vehicle).trim()
      : '';

  const partStr =
    typeof mainPart === 'object' && mainPart !== null
      ? (mainPart as any).name || (mainPart as any).description || (mainPart as any).product_type || 'Pieza'
      : mainPart !== undefined && mainPart !== null
      ? String(mainPart).trim()
      : '';

  const phoneStr = customerPhone !== undefined && customerPhone !== null ? String(customerPhone).trim() : '';
  const cleanPhone = phoneStr.replace(/\D/g, '');

  const getPartDisplayName = (part?: any) => {
    const raw = typeof part === 'object' && part !== null ? (part.name || part.description || '') : part;
    if (!raw) return 'repuesto';
    const lower = String(raw).toLowerCase();
    if (lower.includes('trans')) return 'transmission';
    if (lower.includes('motor') || lower.includes('engine')) return 'motor';
    return lower;
  };

  const getEnglishPart = (part?: any) => {
    const raw = typeof part === 'object' && part !== null ? (part.name || part.description || '') : part;
    if (!raw) return 'part';
    const lower = String(raw).toLowerCase();
    if (lower.includes('trans')) return 'transmission';
    if (lower.includes('motor') || lower.includes('engine')) return 'engine';
    return lower;
  };

  const getSuggestedTemplate = (
    stageOverride?: 'estandar' | 'recepcion' | 'rodaje',
    langOverride?: 'es' | 'en'
  ) => {
    const cName = clientNameStr;
    const orderRef = orderCode ? `${orderCode} ` : '';
    const activeLang = langOverride || templateLanguage || 'es';
    const activeStage = stageOverride || templateStage || 'estandar';

    if (activeLang === 'en') {
      const partWordEn = getEnglishPart(partStr);
      const partCapitalized = partWordEn.charAt(0).toUpperCase() + partWordEn.slice(1);
      const specStrEn =
        vehicleStr && partStr
          ? `${vehicleStr} - ${partCapitalized}`
          : vehicleStr || partCapitalized || 'part';

      if (activeStage === 'recepcion') {
        return `Hello ${cName}, this is Rodriguez Salvage Yard regarding your order ${orderRef}(${specStrEn}). We wanted to confirm if the shop has already received your ${partWordEn} and how everything is going with the installation schedule. Please remember that if you have any questions or concerns you can reach out, and we are happy to help you with anything you need. Best regards.`;
      }

      if (activeStage === 'rodaje') {
        return `Hello ${cName}, this is Rodriguez Salvage Yard regarding your order ${orderRef}(${specStrEn}). We wanted to check in and see how the vehicle has been running and how everything is going with your ${partWordEn}. Please remember that if you have any questions or concerns you can reach out, and we are happy to help you with anything you need. Best regards.`;
      }

      // Default 'estandar'
      return `Hello ${cName}, this is Rodriguez Salvage Yard regarding your order ${orderRef}(${specStrEn}). We wanted to check in and see how everything is going with your ${partWordEn}. Please remember that if you have any questions or concerns you can reach out, and we are happy to help you with anything you need. Best regards.`;
    }

    // Default 'es' (Spanish)
    const partWord = getPartDisplayName(partStr);
    const specStr =
      vehicleStr && partStr
        ? `${vehicleStr} - ${partStr}`
        : vehicleStr || partStr || 'repuesto';

    if (activeStage === 'recepcion') {
      return `Hola ${cName}, le escribimos de Rodriguez Salvage Yard, sobre su orden ${orderRef}(${specStr}). Queremos confirmar si ya recibió su ${partWord} en el taller y cómo va todo con la programación para instalarla. Recuerde que cualquier observación o duda puede notificarnos y estamos aqui con gusto para ayudarle en lo que necesite. Saludos.`;
    }

    if (activeStage === 'rodaje') {
      return `Hola ${cName}, le escribimos de Rodriguez Salvage Yard, sobre su orden ${orderRef}(${specStr}). Queremos consultar cómo ha sentido el vehículo y cómo va todo con su ${partWord}. Recuerde que cualquier observación o duda puede notificarnos y estamos aqui con gusto para ayudarle en lo que necesite. Saludos.`;
    }

    // Default 'estandar' - Exact text requested by user
    return `Hola ${cName}, le escribimos de Rodriguez Salvage Yard, sobre su orden ${orderRef}(${specStr}). Queremos consultar cómo va todo con su ${partWord}. Recuerde que cualquier observación o duda puede notificarnos y estamos aqui con gusto para ayudarle en lo que necesite. Saludos.`;
  };

  const getWhatsAppUrl = (phone: any, text: string) => {
    let digits = phone !== undefined && phone !== null ? String(phone).replace(/\D/g, '') : '';
    if (!digits) return '';
    if (digits.length === 10) {
      digits = `1${digits}`;
    } else if (digits.length === 11 && digits.startsWith('0')) {
      digits = `58${digits.slice(1)}`;
    }
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  };

  const handleCopyTemplate = () => {
    const tmpl = getSuggestedTemplate(templateStage, templateLanguage);
    if (navigator?.clipboard?.writeText) {
      void navigator.clipboard.writeText(tmpl);
      setCopiedTemplate(true);
      setTimeout(() => setCopiedTemplate(false), 2200);
    }
  };

  const handleUseTemplateInNotes = () => {
    const tmpl = getSuggestedTemplate(templateStage, templateLanguage);
    const prefix = channel === 'whatsapp' ? '[WhatsApp Enviado]: ' : '[SMS Enviado]: ';
    setNotes(notes ? `${notes}\n${prefix}${tmpl}` : `${prefix}${tmpl}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (notes.trim().length < 5) {
      setFormError(
        isDirectContact
          ? 'Las notas de la conversación deben contener al menos 5 caracteres.'
          : 'Debe escribir el motivo o detalle del intento de llamada (mínimo 5 caracteres) para registrar su gestión.'
      );
      return;
    }

    if (isDirectContact && partStatus === 'not_installed' && !warrantyWarningGiven) {
      setFormError(
        isCall
          ? 'Si el cliente aún no instala, es obligatorio advertirle verbalmente que el reloj de garantía de 60 días continúa corriendo.'
          : 'Si el cliente aún no instala, es obligatorio informarle por mensaje que el reloj de garantía de 60 días continúa corriendo.'
      );
      return;
    }

    setIsSubmitting(true);
    setFormError('');

    try {
      const opName = currentOperatorName || assignedAdvisor || 'Operador';
      const response = await apiFetch(`/orders/${orderId}/followups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactChannel: channel,
          callResult,
          partStatus: isDirectContact ? partStatus : (initialPartStatus || 'not_installed'),
          warrantyWarningGiven: isDirectContact ? warrantyWarningGiven : false,
          promisedInstallDate: isDirectContact && partStatus === 'not_installed' && promisedInstallDate ? promisedInstallDate : null,
          notes: notes.trim(),
          operatorName: opName,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Error al registrar la llamada de seguimiento');
      }

      setFormSuccess(
        isDirectContact
          ? isCall
            ? '✅ Llamada registrada exitosamente.'
            : '✅ Respuesta de mensaje registrada exitosamente.'
          : isCall
          ? '✅ Intento de llamada registrado exitosamente en la bitácora.'
          : '✅ Envío de mensaje registrado exitosamente en la bitácora.'
      );

      if (onSuccess) {
        await onSuccess();
      }

      // Dispatch local event & cross-tab broadcast for instant UI reactivity
      window.dispatchEvent(new CustomEvent('radar:followup-updated', { detail: { orderId } }));
      if (typeof BroadcastChannel !== 'undefined') {
        try {
          const bc = new BroadcastChannel('radar_realtime');
          bc.postMessage({ type: 'followup:updated', orderId });
          bc.close();
        } catch {}
      }

      setTimeout(() => {
        onClose();
        setFormSuccess('');
      }, 700);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error inesperado al registrar llamada');
    } finally {
      setIsSubmitting(false);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/80 dark:bg-black/85 backdrop-blur-md animate-fade-in overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Registrar llamada de seguimiento"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="cyber-card relative w-full max-w-lg max-h-[min(90vh,760px)] my-auto flex flex-col shadow-2xl rounded-2xl overflow-hidden border border-cyan-500/40 bg-[var(--bg-card)] text-[var(--text-primary)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Laser Hairline Header Accent */}
        {/* Laser Hairline Header Accent */}
        <div className="cyber-laser-bar absolute top-0 left-0 right-0 z-20" />

        {/* Modal Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-cyan-500/25 bg-[var(--bg-card-subtle)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm border ${
                channel === 'whatsapp'
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-600 dark:text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
                  : channel === 'sms'
                  ? 'bg-sky-500/20 border-sky-500/50 text-sky-600 dark:text-sky-400 shadow-[0_0_12px_rgba(14,165,233,0.3)]'
                  : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.25)]'
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">
                {channel === 'whatsapp' ? 'chat' : channel === 'sms' ? 'sms' : 'phone_in_talk'}
              </span>
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold text-[var(--text-heading)] text-sm sm:text-base tracking-wide truncate">
                  Registrar Seguimiento Post-Entrega
                </h3>
                <span className="font-mono text-[10px] text-cyan-600 dark:text-cyan-300 bg-cyan-500/15 dark:bg-cyan-950/60 border border-cyan-500/35 px-2 py-0.5 rounded-full font-bold">
                  {orderCode}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-0.5">
                <p className="text-xs text-[var(--text-secondary)] font-mono truncate">
                  Cliente: <strong className="text-[var(--text-primary)]">{clientNameStr}</strong>
                </p>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border flex items-center gap-1 ${
                    (customerLanguage || 'es') === 'en'
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40'
                      : 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/35'
                  }`}
                  title={(customerLanguage || 'es') === 'en' ? 'Cliente registrado con idioma Inglés' : 'Cliente registrado con idioma Español'}
                >
                  <span>{(customerLanguage || 'es') === 'en' ? '🇺🇸 Habla Inglés' : '🇪🇸 Habla Español'}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {cleanPhone && isCall && (
              <a
                href={`tel:${cleanPhone}`}
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-600 dark:text-emerald-300 text-xs font-mono font-bold transition-all shadow-sm active:scale-95"
                title="Llamar directamente al cliente"
              >
                <span className="material-symbols-outlined text-[15px]">call</span>
                <span>Llamar</span>
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-cyan-500/10 flex items-center justify-center cursor-pointer transition-colors"
              title="Cerrar ventana"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>

        {/* Quick Context Sub-Banner */}
        <div className="px-4 py-2 bg-cyan-500/5 dark:bg-cyan-950/25 border-b border-cyan-500/15 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono shrink-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--text-secondary)]">
            {vehicleStr && (
              <span className="flex items-center gap-1 text-[var(--text-primary)]">
                <span className="material-symbols-outlined text-[14px] text-amber-500">directions_car</span>
                <span>{vehicleStr}</span>
              </span>
            )}
            {partStr && (
              <span className="text-cyan-600 dark:text-cyan-300 font-bold">
                [{partStr}]
              </span>
            )}
            {typeof daysSinceDelivery === 'number' && !isNaN(daysSinceDelivery) && (
              <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 dark:bg-cyan-950/40 text-cyan-600 dark:text-cyan-300 font-semibold border border-cyan-500/20">
                Día {daysSinceDelivery} de 14
              </span>
            )}
          </div>

          <div className="text-[var(--text-secondary)] text-[10.5px]">
            Asesor: <strong className="text-[var(--text-primary)]">{assignedAdvisor || currentOperatorName || 'Operador'}</strong>
          </div>
        </div>

        {/* Channel Selection Toggle */}
        <div className="px-4 pt-3 pb-2 bg-[var(--bg-card)] border-b border-cyan-500/10 shrink-0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-mono font-bold text-[var(--text-secondary)] uppercase tracking-wider">
              Canal de Comunicación:
            </span>
            {phoneStr && (
              <span className="text-[11px] font-mono text-[var(--text-primary)] font-semibold">
                📱 {phoneStr}
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => handleChannelChange('call')}
              className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-mono font-bold border transition-all cursor-pointer ${
                channel === 'call'
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-700 dark:text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.25)]'
                  : 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-cyan-500/40'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">call</span>
              <span>Llamada</span>
            </button>

            <button
              type="button"
              onClick={() => handleChannelChange('whatsapp')}
              className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-mono font-bold border transition-all cursor-pointer ${
                channel === 'whatsapp'
                  ? 'bg-emerald-600/25 border-emerald-500 text-emerald-700 dark:text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.25)]'
                  : 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-cyan-500/40'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">chat</span>
              <span>WhatsApp</span>
            </button>

            <button
              type="button"
              onClick={() => handleChannelChange('sms')}
              className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-mono font-bold border transition-all cursor-pointer ${
                channel === 'sms'
                  ? 'bg-sky-500/20 border-sky-400 text-sky-700 dark:text-sky-300 shadow-[0_0_12px_rgba(14,165,233,0.25)]'
                  : 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-cyan-500/40'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">sms</span>
              <span>SMS (Texto)</span>
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 custom-scrollbar">
          {formError && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-700 dark:text-rose-300 text-xs font-mono flex items-start gap-2 animate-fade-in shadow-sm">
              <span className="material-symbols-outlined text-[18px] text-rose-500 shrink-0 mt-0.5">error</span>
              <span className="leading-relaxed">{formError}</span>
            </div>
          )}

          {formSuccess && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 text-xs font-mono flex items-center gap-2 animate-fade-in shadow-sm">
              <span className="material-symbols-outlined text-[18px] text-emerald-500 shrink-0">check_circle</span>
              <span className="font-bold">{formSuccess}</span>
            </div>
          )}

          {/* Quick WhatsApp / SMS Assistant Box */}
          {!isCall && (
            <div className="p-3 rounded-xl bg-cyan-500/5 dark:bg-cyan-950/20 border border-cyan-500/30 space-y-2.5 animate-fade-in">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                <span className="font-bold text-cyan-600 dark:text-cyan-300 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px]">quickphrase</span>
                  <span>Plantilla de Mensaje Sugerida ({channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}):</span>
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Language Selector */}
                  <div className="flex items-center gap-0.5 bg-[var(--bg-surface)] p-0.5 rounded-lg border border-cyan-500/30">
                    <button
                      type="button"
                      onClick={() => setTemplateLanguage('es')}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all cursor-pointer flex items-center gap-1 ${
                        templateLanguage === 'es'
                          ? 'bg-cyan-500 text-slate-950 shadow-sm'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                      title="Generar mensaje en Español"
                    >
                      <span>🇪🇸 ES</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTemplateLanguage('en')}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all cursor-pointer flex items-center gap-1 ${
                        templateLanguage === 'en'
                          ? 'bg-amber-500 text-slate-950 shadow-sm'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                      title="Generar mensaje en Inglés"
                    >
                      <span>🇺🇸 EN</span>
                    </button>
                  </div>

                  {/* Stage Selector */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setTemplateStage('estandar')}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer ${
                        templateStage === 'estandar'
                          ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                          : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-cyan-500/20'
                      }`}
                    >
                      {templateLanguage === 'en' ? 'Standard' : 'Estándar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setTemplateStage('recepcion')}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer ${
                        templateStage === 'recepcion'
                          ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                          : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-cyan-500/20'
                      }`}
                    >
                      {templateLanguage === 'en' ? 'Delivery' : 'Recepción'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setTemplateStage('rodaje')}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer ${
                        templateStage === 'rodaje'
                          ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                          : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-cyan-500/20'
                      }`}
                    >
                      {templateLanguage === 'en' ? 'Break-in' : 'Rodaje'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-[var(--bg-card-subtle)] border border-cyan-500/20 text-xs font-mono text-[var(--text-primary)] leading-relaxed italic select-all">
                "{getSuggestedTemplate(templateStage, templateLanguage)}"
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                {channel === 'whatsapp' && cleanPhone && (
                  <a
                    href={getWhatsAppUrl(customerPhone, getSuggestedTemplate(templateStage, templateLanguage))}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold shadow-sm transition-all active:scale-95"
                  >
                    <span className="material-symbols-outlined text-[15px]">send</span>
                    <span>Abrir en WhatsApp</span>
                  </a>
                )}

                <button
                  type="button"
                  onClick={handleCopyTemplate}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] hover:bg-cyan-500/15 border border-cyan-500/30 text-xs font-mono text-[var(--text-primary)] transition-all cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {copiedTemplate ? 'check' : 'content_copy'}
                  </span>
                  <span>{copiedTemplate ? '¡Copiado!' : 'Copiar Texto'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleUseTemplateInNotes}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] hover:bg-cyan-500/15 border border-cyan-500/30 text-xs font-mono text-cyan-600 dark:text-cyan-300 transition-all cursor-pointer"
                  title="Pegar esta plantilla en el campo de notas"
                >
                  <span className="material-symbols-outlined text-[14px]">edit_note</span>
                  <span>Insertar en Notas</span>
                </button>
              </div>
            </div>
          )}

          {/* Outcome Result Selector */}
          <div>
            <label className="block text-xs font-mono font-bold text-[var(--text-heading)] mb-1.5 flex items-center justify-between">
              <span>
                {isCall
                  ? 'Resultado de la Llamada Telefónica *'
                  : channel === 'whatsapp'
                  ? 'Resultado del Seguimiento por WhatsApp *'
                  : 'Resultado del Mensaje de Texto *'}
              </span>
              <span className="text-[10px] text-[var(--text-secondary)] font-normal">Obligatorio</span>
            </label>
            <select
              value={callResult}
              onChange={(e) => setCallResult(e.target.value as FollowupCallResult)}
              className="cyber-input w-full cursor-pointer text-xs font-mono font-medium"
              required
            >
              {isCall ? (
                <>
                  <option value="answered">📞 Contestó el cliente</option>
                  <option value="no_answer">📵 No contestó / Buzón de voz</option>
                  <option value="busy">⏳ Ocupado</option>
                  <option value="wrong_number">❌ Número equivocado / Fuera de servicio</option>
                </>
              ) : (
                <>
                  <option value="sms_replied">💬 Cliente respondió el mensaje</option>
                  <option value="sms_sent">📤 Mensaje enviado (Esperando respuesta)</option>
                  <option value="sms_no_reply">⏳ Mensaje enviado (Sin respuesta del cliente)</option>
                  <option value="wrong_number">❌ Número equivocado / Fuera de servicio</option>
                </>
              )}
            </select>
          </div>

          {/* Part Status & Warranty Warning - only displayed when client answered or replied */}
          {isDirectContact ? (
            <>
              {/* Part Status */}
              <div>
                <label className="block text-xs font-mono font-bold text-[var(--text-heading)] mb-1.5 flex items-center justify-between">
                  <span>Estado Físico / Montaje de la Pieza *</span>
                  <span className="text-[10px] text-[var(--text-secondary)] font-normal">Revisión en taller</span>
                </label>
                <select
                  value={partStatus}
                  onChange={(e) => setPartStatus(e.target.value as FollowupPartStatus)}
                  className="cyber-input w-full cursor-pointer text-xs font-mono font-medium"
                  required
                >
                  <option value="not_installed">🔴 Aún no la ha instalado</option>
                  <option value="in_process">🟡 En proceso de instalación en el taller</option>
                  <option value="installed_ok">🟢 Instalada y funcionando 100% OK</option>
                  <option value="has_issues">🟠 Presenta observaciones leves / dudas</option>
                  <option value="defect_claim">🚨 Reporta falla / Solicita reclamo de garantía</option>
                </select>
              </div>

              {/* Delayed install warning & date reschedule */}
              {partStatus === 'not_installed' && (
                <div className="p-3.5 rounded-xl border-2 border-amber-500/50 bg-amber-500/10 dark:bg-amber-950/35 space-y-3 animate-fade-in shadow-sm">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={warrantyWarningGiven}
                      onChange={(e) => setWarrantyWarningGiven(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-amber-500 text-amber-600 focus:ring-amber-500 cursor-pointer shrink-0"
                    />
                    <span className="text-xs font-mono text-amber-950 dark:text-amber-100 font-medium leading-relaxed">
                      <strong className="text-amber-700 dark:text-amber-300 font-bold block mb-0.5 flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[17px] text-amber-500">warning</span>
                        Advertencia Verbal de Garantía Obligatoria:
                      </strong>
                      {isCall
                        ? 'He advertido verbalmente al cliente que el tiempo de garantía continúa corriendo y no se detiene por demora en su taller mecánico.'
                        : 'He informado y advertido al cliente por mensaje de texto que el tiempo de garantía continúa corriendo y no se detiene por demora en su taller mecánico.'}
                    </span>
                  </label>

                  <div className="pt-2 border-t border-amber-500/25">
                    <label className="block text-[11px] font-mono font-bold text-amber-900 dark:text-amber-300 mb-1">
                      ¿Para qué fecha prometió instalar? (Reprogramación de {isCall ? 'llamada' : 'seguimiento'}):
                    </label>
                    <input
                      type="date"
                      value={promisedInstallDate}
                      onChange={(e) => setPromisedInstallDate(e.target.value)}
                      className="cyber-input w-full text-xs font-mono border-amber-500/40 text-[var(--text-primary)]"
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Informative Banner when client did not answer, line is busy, wrong number, or SMS is pending response */
            <div className="p-3.5 rounded-xl bg-cyan-500/10 dark:bg-cyan-950/35 border border-cyan-500/30 text-xs font-mono text-[var(--text-secondary)] flex items-start gap-2.5 animate-fade-in shadow-sm">
              <span className="material-symbols-outlined text-[18px] text-cyan-600 dark:text-cyan-400 shrink-0 mt-0.5">info</span>
              <div className="leading-relaxed">
                {isCall ? (
                  <>
                    <strong className="block text-cyan-700 dark:text-cyan-300 font-bold mb-0.5">
                      Sin contacto directo con el cliente:
                    </strong>
                    No se modifica el estado de la pieza ni el plazo de garantía. Para registrar y certificar su llamada, describa detalladamente a continuación qué ocurrió durante el intento.
                  </>
                ) : callResult === 'sms_sent' ? (
                  <>
                    <strong className="block text-cyan-700 dark:text-cyan-300 font-bold mb-0.5">
                      Mensaje de seguimiento enviado:
                    </strong>
                    Queda registrado el despacho del mensaje para certificar su gestión activa. Si el cliente responde más adelante, podrá registrar una nueva entrada con el estado de la pieza.
                  </>
                ) : callResult === 'sms_no_reply' ? (
                  <>
                    <strong className="block text-cyan-700 dark:text-cyan-300 font-bold mb-0.5">
                      Sin respuesta al mensaje de texto:
                    </strong>
                    El cliente no ha contestado el mensaje enviado. Deje constancia del intento para la bitácora y reprogramar un nuevo contacto.
                  </>
                ) : (
                  <>
                    <strong className="block text-rose-700 dark:text-rose-300 font-bold mb-0.5">
                      Número equivocado o inválido:
                    </strong>
                    El número de teléfono registrado no recibe mensajes o es incorrecto. Deje constancia para solicitar un número actualizado.
                  </>
                )}
              </div>
            </div>
          )}

          {/* Conversation Notes / Attempt Notes */}
          <div>
            <label className="block text-xs font-mono font-bold text-[var(--text-heading)] mb-1.5 flex items-center justify-between">
              <span>
                {isDirectContact
                  ? 'Resumen de la Conversación (Bitácora) *'
                  : 'Detalle del Intento de Contacto (Obligatorio) *'}
              </span>
              <span className="text-[10px] text-[var(--text-secondary)] font-normal">
                {isDirectContact ? 'Mínimo 5 caracteres' : 'Explique lo sucedido (mín. 5 car.)'}
              </span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder={
                isDirectContact
                  ? isCall
                    ? 'Detallar lo conversado con el cliente (estado del mecánico, fecha tentativa de encendido, observaciones de la pieza, etc.)...'
                    : 'Detallar la respuesta del cliente por mensaje (observaciones del mecánico, fecha de encendido, dudas del cliente, etc.)...'
                  : isCall
                  ? callResult === 'no_answer'
                    ? 'Indicar qué ocurrió al llamar (ej: Timbró varias veces y cayó en buzón de voz, se reprogramará nuevo intento más tarde)...'
                    : callResult === 'busy'
                    ? 'Indicar qué ocurrió al llamar (ej: Tono ocupado continuamente en repetidos intentos, teléfono apagado o fuera del área)...'
                    : 'Indicar qué ocurrió al llamar (ej: Atendió persona ajena indicando número equivocado o que no conoce al cliente)...'
                  : callResult === 'sms_sent'
                  ? 'Describa el mensaje enviado o copie la plantilla (ej: Se envió mensaje de texto recordando validación de instalación y garantía)...'
                  : callResult === 'sms_no_reply'
                  ? 'Detalle que se envió mensaje anteriormente pero el cliente no ha emitido respuesta...'
                  : 'Detalle la falla con el número (ej: Mensaje no entregado, número suspendido o inválido)...'
              }
              className="cyber-input w-full text-xs font-mono leading-relaxed resize-y placeholder:text-[var(--text-secondary)]/70"
              required
            />
            {!isDirectContact && (
              <p className="text-[10.5px] font-mono text-cyan-600 dark:text-cyan-400 mt-1 flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">edit_note</span>
                <span>
                  {isCall
                    ? 'Es obligatorio dejar constancia escrita de la llamada no concretada.'
                    : 'Es obligatorio dejar constancia escrita de la gestión de mensaje de texto.'}
                </span>
              </p>
            )}
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-cyan-500/20 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="cyber-btn-secondary text-xs font-mono cursor-pointer"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="cyber-btn-primary text-xs font-mono font-black cursor-pointer shadow-lg disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">save</span>
              <span>{isSubmitting ? 'Guardando...' : 'Guardar Registro'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(modalContent, document.body);
  }

  return modalContent;
};
