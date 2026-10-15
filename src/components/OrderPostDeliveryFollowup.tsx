import React, { useState, useEffect } from 'react';
import { Order, OrderDeliveryFollowup, FollowupCallResult, FollowupPartStatus } from '../types';
import { apiFetch } from '../services/apiFetch';
import { RegisterFollowupCallModal } from './RegisterFollowupCallModal';

interface OrderPostDeliveryFollowupProps {
  order: Order;
  currentUser?: { id?: number; name?: string; email?: string; role?: string } | null;
  userRole?: string;
  onCallLogged?: () => void;
}

export const OrderPostDeliveryFollowup: React.FC<OrderPostDeliveryFollowupProps> = ({
  order,
  currentUser,
  userRole,
  onCallLogged,
}) => {
  const [followups, setFollowups] = useState<OrderDeliveryFollowup[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  const fetchFollowups = async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch(`/orders/${order.id}/followups`);
      if (res.ok) {
        const data = await res.json();
        setFollowups(data.followups || []);
      }
    } catch (err) {
      console.error('Error fetching followups:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (order.id) {
      void fetchFollowups();
    }
  }, [order.id]);

  useEffect(() => {
    const handleUpdate = (e: any) => {
      if (!e.detail?.orderId || String(e.detail.orderId) === String(order.id)) {
        void fetchFollowups();
      }
    };
    window.addEventListener('radar:followup-updated', handleUpdate);
    return () => {
      window.removeEventListener('radar:followup-updated', handleUpdate);
    };
  }, [order.id]);

  // Calculate days since delivery
  const deliveryDateVal = order.deliveredAt || order.created_at || new Date().toISOString();
  const deliveryTimestamp = new Date(deliveryDateVal).getTime();
  const daysSinceDelivery = Math.max(0, Math.floor((Date.now() - deliveryTimestamp) / (1000 * 60 * 60 * 24)));
  const progressPercent = Math.min(100, Math.round((Math.min(14, daysSinceDelivery) / 14) * 100));

  const latestFollowup = followups[0] || null;

  const vehicleString =
    typeof order.vehicle === 'object' && order.vehicle
      ? `${order.vehicle.year || ''} ${order.vehicle.make || ''} ${order.vehicle.model || ''}`.trim()
      : String(order.vehicle || '');

  const rawCustomerPhone = order.customer?.phone;
  const customerPhoneStr =
    rawCustomerPhone !== undefined && rawCustomerPhone !== null ? String(rawCustomerPhone).trim() : '';
  const cleanCustomerPhone = customerPhoneStr.replace(/\D/g, '');
  const customerNameStr =
    typeof order.customer?.name === 'string'
      ? order.customer.name
      : typeof order.customer === 'string'
      ? order.customer
      : (order.customer as any)?.name || 'Cliente';
  const mainPartStr =
    typeof order.mainPart === 'object' && order.mainPart !== null
      ? (order.mainPart as any).name || (order.mainPart as any).description || 'Pieza'
      : String(order.mainPart || '');

  const getChannelBadge = (channel?: string) => {
    switch (channel) {
      case 'whatsapp':
        return (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-600/25 text-emerald-300 border border-emerald-500/40 font-bold inline-flex items-center gap-1">
            <span className="material-symbols-outlined text-[12px]">chat</span>
            <span>WhatsApp</span>
          </span>
        );
      case 'sms':
        return (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-sky-500/20 text-sky-300 border border-sky-400/40 font-bold inline-flex items-center gap-1">
            <span className="material-symbols-outlined text-[12px]">sms</span>
            <span>SMS</span>
          </span>
        );
      default:
        return (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 font-bold inline-flex items-center gap-1">
            <span className="material-symbols-outlined text-[12px]">phone</span>
            <span>Llamada</span>
          </span>
        );
    }
  };

  const getCallResultBadge = (result: FollowupCallResult) => {
    switch (result) {
      case 'answered':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">Contestó</span>;
      case 'no_answer':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold">No contestó</span>;
      case 'busy':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">Ocupado</span>;
      case 'wrong_number':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-red-950 text-red-400 border border-red-700 font-bold">Número equivocado</span>;
      case 'sms_sent':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold">Mensaje enviado</span>;
      case 'sms_replied':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">Respondió por texto</span>;
      case 'sms_no_reply':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">Sin respuesta</span>;
    }
  };

  const getPartStatusBadge = (status: FollowupPartStatus) => {
    switch (status) {
      case 'not_installed':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-rose-950/60 text-rose-300 border border-rose-500/30">🔴 No instalada aún</span>;
      case 'in_process':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-950/60 text-amber-300 border border-amber-500/30">🟡 En taller / Montaje</span>;
      case 'installed_ok':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950/60 text-emerald-300 border border-emerald-500/30">🟢 Instalada y funcionando 100% OK</span>;
      case 'has_issues':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/40">🟠 Observaciones leves</span>;
      case 'defect_claim':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-red-600/30 text-red-200 border border-red-500 font-bold">🚨 Reclamo por defecto</span>;
    }
  };

  return (
    <div className="cyber-card p-3 sm:p-4 shadow-md flex flex-col gap-3 animate-fade-in border-cyan-500/30 bg-[var(--bg-card)]">
      {/* Laser Top Line */}
      <div className="cyber-laser-bar bg-gradient-to-r from-emerald-400 via-cyan-400 to-amber-400" />

      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-400/50 flex items-center justify-center text-emerald-600 dark:text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.25)]">
            <span className="material-symbols-outlined text-[20px]">phone_in_talk</span>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-xs sm:text-sm font-mono font-black text-[var(--text-heading)] tracking-wide">
                SEGUIMIENTO POST-ENTREGA • GARANTÍA TEMPRANA
              </strong>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-cyan-500/15 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-300 border border-cyan-500/35">
                14 DÍAS CLAVE
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border flex items-center gap-1 ${
                  (order.customerLanguage || order.customer?.language) === 'en'
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/40'
                    : 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/35'
                }`}
                title={`El cliente prefiere comunicación en ${(order.customerLanguage || order.customer?.language) === 'en' ? 'Inglés' : 'Español'}`}
              >
                <span>{(order.customerLanguage || order.customer?.language) === 'en' ? '🇺🇸 Inglés' : '🇪🇸 Español'}</span>
              </span>
            </div>
            <p className="text-[11px] font-mono text-[var(--text-secondary)]">
              Asesor asignado: <strong className="text-[var(--text-primary)]">{order.advisor || 'Sin asignar'}</strong> — Seguimiento por llamada o mensaje de texto (WhatsApp/SMS).
            </p>
          </div>
        </div>

        {/* Action button */}
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 text-xs font-mono font-black shadow-[0_0_12px_rgba(16,185,129,0.35)] transition-all cursor-pointer active:scale-95"
        >
          <span className="material-symbols-outlined text-[16px]">add_call</span>
          <span>+ Registrar Llamada / Mensaje</span>
        </button>
      </div>

      {/* 14-Day Timeline Bar */}
      <div className="p-3 rounded-xl bg-[var(--bg-card-subtle)] border border-cyan-500/20 space-y-2">
        <div className="flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-secondary)]">Estado del Período de Prueba:</span>
            <strong className="text-cyan-600 dark:text-cyan-300">Día {daysSinceDelivery} de 14</strong>
            {daysSinceDelivery > 14 && (
              <span className="text-amber-600 dark:text-amber-300 text-[10px] bg-amber-500/10 dark:bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-500/30">
                Período temprano concluido (Garantía activa hasta {order.warrantyDays || 60} días)
              </span>
            )}
          </div>
          <span className="text-[var(--text-secondary)] font-bold">{progressPercent}% completado</span>
        </div>

        {/* Progress Bar Container */}
        <div className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-slate-800/80 overflow-hidden relative shadow-inner">
          <div
            className="h-full bg-gradient-to-r from-cyan-400 via-emerald-400 to-amber-400 rounded-full transition-all duration-500 shadow-[0_0_8px_#22d3ee]"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* 3 Milestones markers */}
        <div className="grid grid-cols-3 gap-2 pt-1 text-[10.5px] font-mono">
          <div className={`p-1.5 rounded-lg border ${daysSinceDelivery <= 3 ? 'bg-cyan-500/15 border-cyan-400 text-cyan-700 dark:text-cyan-200 font-bold' : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}>
            <span className="font-bold block">Día 1-3: Recepción</span>
            <span className="text-[9.5px] text-[var(--text-secondary)]">Pieza recibida en taller</span>
          </div>

          <div className={`p-1.5 rounded-lg border ${daysSinceDelivery >= 4 && daysSinceDelivery <= 7 ? 'bg-cyan-500/15 border-cyan-400 text-cyan-700 dark:text-cyan-200 font-bold' : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}>
            <span className="font-bold block">Día 4-7: Montaje</span>
            <span className="text-[9.5px] text-[var(--text-secondary)]">Instalación & Encendido</span>
          </div>

          <div className={`p-1.5 rounded-lg border ${daysSinceDelivery >= 8 && daysSinceDelivery <= 14 ? 'bg-cyan-500/15 border-cyan-400 text-cyan-700 dark:text-cyan-200 font-bold' : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}>
            <span className="font-bold block">Día 8-14: Rodaje</span>
            <span className="text-[9.5px] text-[var(--text-secondary)]">Conformidad final</span>
          </div>
        </div>
      </div>

      {/* Bitácora de Llamadas Realizadas */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-mono">
          <strong className="text-[var(--text-primary)] flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-cyan-500 dark:text-cyan-400">history</span>
            Bitácora de Contactos Realizados ({followups.length})
          </strong>
          {cleanCustomerPhone && (
            <div className="flex items-center gap-3">
              <a
                href={`tel:${cleanCustomerPhone}`}
                className="text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 text-[11px] font-bold"
              >
                <span className="material-symbols-outlined text-[13px]">call</span>
                <span>Llamar al cliente ({customerPhoneStr})</span>
              </a>
              <a
                href={`https://wa.me/${cleanCustomerPhone.length === 10 ? '1' + cleanCustomerPhone : cleanCustomerPhone.startsWith('0') ? '58' + cleanCustomerPhone.slice(1) : cleanCustomerPhone}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-500 dark:text-emerald-400 hover:underline flex items-center gap-1 text-[11px] font-bold"
                title="Abrir chat de WhatsApp con el cliente"
              >
                <span className="material-symbols-outlined text-[13px]">chat</span>
                <span>WhatsApp</span>
              </a>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="p-3 text-center text-xs font-mono text-[var(--text-secondary)]">Cargando bitácora de seguimiento...</div>
        ) : followups.length === 0 ? (
          <div className="p-3 text-center rounded-xl bg-[var(--bg-card-subtle)] border border-cyan-500/15 text-xs font-mono text-[var(--text-secondary)]">
            Aún no se han registrado llamadas de seguimiento post-entrega para esta orden.
          </div>
        ) : (
          <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar">
            {followups.map((f) => (
              <div
                key={f.id}
                className="p-2.5 rounded-xl bg-[var(--bg-card-subtle)] border border-cyan-500/20 text-xs font-mono space-y-1"
              >
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <div className="flex items-center gap-2">
                    {getChannelBadge(f.contactChannel)}
                    <span className="text-cyan-600 dark:text-cyan-400 font-bold">{new Date(f.createdAt).toLocaleString()}</span>
                    <span className="text-[var(--text-secondary)]">por</span>
                    <strong className="text-[var(--text-primary)]">{f.operatorName}</strong>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {getCallResultBadge(f.callResult)}
                    {(f.callResult === 'answered' || f.callResult === 'sms_replied') && getPartStatusBadge(f.partStatus)}
                  </div>
                </div>

                <p className="text-[var(--text-primary)] pl-2 border-l-2 border-cyan-500/40 mt-1 leading-relaxed">
                  {f.notes}
                </p>

                <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                  {f.warrantyWarningGiven && (
                    <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/35 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px]">warning</span>
                      <span>Se advirtió verbalmente plazo de garantía</span>
                    </span>
                  )}
                  {f.promisedInstallDate && (
                    <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px]">event</span>
                      <span>Prometió instalar: {f.promisedInstallDate}</span>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dedicated Followup Call Modal */}
      <RegisterFollowupCallModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        orderId={String(order.id || '')}
        orderCode={String(order.code || '')}
        customerName={customerNameStr}
        customerPhone={customerPhoneStr}
        customerLanguage={order.customerLanguage || order.customer?.language || 'es'}
        vehicle={vehicleString}
        mainPart={mainPartStr}
        daysSinceDelivery={daysSinceDelivery}
        assignedAdvisor={order.advisor}
        currentOperatorName={currentUser?.name}
        initialPartStatus={latestFollowup?.partStatus || 'not_installed'}
        initialWarrantyWarning={latestFollowup?.warrantyWarningGiven || false}
        initialPromisedDate={latestFollowup?.promisedInstallDate || ''}
        onSuccess={async () => {
          await fetchFollowups();
          if (onCallLogged) onCallLogged();
        }}
      />
    </div>
  );
};
