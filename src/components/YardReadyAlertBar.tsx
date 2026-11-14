import React from 'react';
import type { Order } from '../types';
import { formatYardReadyElapsed, isYardReadyUrgent, yardReadyAgeMinutes } from '../utils/yardAlerts';
import { Icon } from './Icon';

interface YardReadyAlertBarProps {
  alerts: Order[];
  onOpenOrder: (orderId: string) => void;
  onNotifyCustomer: (orderId: string) => void;
  now?: number;
  variant?: 'sale' | 'claim';
}

export const YardReadyAlertBar: React.FC<YardReadyAlertBarProps> = ({
  alerts,
  onOpenOrder,
  onNotifyCustomer,
  now,
  variant = 'sale',
}) => {
  if (alerts.length === 0) return null;
  const isClaim = variant === 'claim';
  const oldest = [...alerts].sort((a, b) => {
    const aTime = Date.parse((isClaim ? a.claimPieceReadyAt : a.yardPieceReadyAt) || '') || 0;
    const bTime = Date.parse((isClaim ? b.claimPieceReadyAt : b.yardPieceReadyAt) || '') || 0;
    return aTime - bTime;
  })[0];
  const ageSource = isClaim ? oldest.claimPieceReadyAt : oldest.yardPieceReadyAt;
  const minutes = yardReadyAgeMinutes({ yardPieceReadyAt: ageSource }, now);
  const urgent = isYardReadyUrgent(minutes);
  const targetLabel = oldest.deliveryType === 'envio_domicilio' ? 'Listo para Despacho' : 'Listo para Retiro';
  const heading = isClaim
    ? (alerts.length === 1 ? 'PIEZA DE RECLAMO LISTA EN YARDA' : `${alerts.length} PIEZAS DE RECLAMO LISTAS EN YARDA`)
    : (alerts.length === 1 ? 'PIEZA LISTA EN YARDA' : `${alerts.length} PIEZAS LISTAS EN YARDA`);
  const instruction = isClaim
    ? `${urgent ? 'ATENCIÓN: ' : ''}Contacta al cliente y cierra el reclamo en Reclamos`
    : `${urgent ? 'ATENCIÓN: ' : ''}Contacta al cliente y pasa la orden a ${targetLabel}`;
  const notifyLabel = isClaim ? 'Atender reclamo' : `Notificar y pasar a ${targetLabel}`;

  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid={isClaim ? 'claim-ready-alert-bar' : 'yard-ready-alert-bar'}
      className="relative z-20 border-b-2 border-amber-300/70 bg-amber-400 text-slate-950 shadow-[0_6px_18px_rgba(0,0,0,0.18)]"
    >
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 px-3 py-2.5 sm:px-6 sm:py-3 min-h-[92px]">
        <span className="hidden sm:flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-950/10">
          <Icon name={isClaim ? 'build_circle' : 'campaign'} size={28} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] sm:text-[17px] font-black leading-tight">{heading}</p>
          <p className="mt-1 truncate text-[11px] sm:text-xs font-bold leading-tight text-slate-900/80">
            #{oldest.code} · {oldest.customer?.name || 'Cliente sin nombre'} · {formatYardReadyElapsed(minutes)}
          </p>
          <p
            className="mt-1 hidden truncate text-[11px] sm:block sm:text-xs font-semibold leading-tight text-slate-900/85"
            title={instruction}
          >
            {instruction}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenOrder(oldest.id)}
            className="inline-flex h-10 sm:h-11 shrink-0 items-center whitespace-nowrap rounded-xl border border-slate-950/70 bg-white px-3 sm:px-4 text-xs sm:text-sm font-black text-amber-900 transition-all hover:bg-amber-50 active:scale-95 cursor-pointer"
          >
            Abrir<span className="hidden sm:inline">&nbsp;orden</span>
          </button>
          <button
            type="button"
            onClick={() => onNotifyCustomer(oldest.id)}
            aria-label={isClaim
              ? `Atender el reclamo de la orden ${oldest.code} en Oficina`
              : `Notificar al cliente y pasar la orden ${oldest.code} a ${targetLabel}`}
            title={isClaim ? 'Atender el reclamo en Oficina' : notifyLabel}
            className="inline-flex h-10 sm:h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-950 bg-slate-950 px-3 sm:px-4 text-xs sm:text-sm font-black text-amber-300 transition-all hover:bg-slate-800 active:scale-95 cursor-pointer"
          >
            <Icon name={isClaim ? 'fact_check' : 'notifications_active'} size={17} />
            <span>{isClaim ? 'Atender' : 'Notificar cliente'}<span className="hidden sm:inline">{isClaim ? ' reclamo' : ` y pasar a ${targetLabel}`}</span></span>
          </button>
        </div>
      </div>
    </div>
  );
};
