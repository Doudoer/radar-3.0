import React from 'react';
import type { Order } from '../types';
import { OrderAftersalesPanel } from './OrderAftersales';

interface RefundRequestViewProps {
  order: Order;
  onBack: () => void;
  onUpdateOrder?: (updatedOrder: Order) => Promise<Order | void>;
  onSuccess?: (msg: string) => void;
  embedded?: boolean;
}

export const RefundRequestView: React.FC<RefundRequestViewProps> = ({ order, onBack, onSuccess, embedded = false }) => {
  const panel = <OrderAftersalesPanel order={order} onCompleted={(message) => onSuccess?.(message)} />;

  if (embedded) return panel;

  return (
    <div className="radar-view horizon-view space-y-4 pb-10">
      <div className="horizon-view-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] text-[var(--text-primary)] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors cursor-pointer"
            title="Volver a la orden"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">arrow_back</span>
          </button>
          <div>
            <h1 className="text-lg sm:text-xl font-black text-[var(--text-primary)]">
              Solicitud de reembolso · <span className="font-mono text-[var(--brand)]">#{order.code}</span>
            </h1>
            <p className="text-xs text-[var(--text-secondary)]">
              {order.customer?.name} · {order.vehicle?.year} {order.vehicle?.make} {order.vehicle?.model} ({order.mainPart})
            </p>
          </div>
        </div>
        <button type="button" className="cyber-btn-secondary rounded-xl px-4 py-2 text-xs font-bold cursor-pointer" onClick={onBack}>
          Volver a la orden
        </button>
      </div>
      {panel}
    </div>
  );
};
