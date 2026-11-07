import React from 'react';
import type { Order } from '../types';
import { OrderAftersalesPanel } from './OrderAftersales';

interface RefundRequestViewProps {
  order: Order;
  onBack: () => void;
  onUpdateOrder?: (updatedOrder: Order) => Promise<Order | void>;
  onSuccess?: (msg: string) => void;
}

export const RefundRequestView: React.FC<RefundRequestViewProps> = ({ order, onBack }) => (
  <div className="radar-view horizon-view space-y-4 pb-10">
    <div className="horizon-view-card flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="p-2 rounded-xl bg-[var(--bg-card-subtle)] border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 transition-all cursor-pointer"
          title="Volver a la orden"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
        </button>
        <div>
          <h1 className="text-lg sm:text-xl font-black text-[var(--text-primary)]">
            Solicitud de reembolso · <span className="font-mono text-cyan-400">#{order.code}</span>
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
    <OrderAftersalesPanel order={order} />
  </div>
);
