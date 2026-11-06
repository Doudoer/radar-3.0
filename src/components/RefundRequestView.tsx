import React from 'react';
import type { Order } from '../types';
import { OrderAftersalesPanel } from './OrderAftersales';

interface RefundRequestViewProps {
  order: Order;
  onBack: () => void;
  onUpdateOrder?: (updatedOrder: Order) => Promise<Order | void>;
  onSuccess?: (msg: string) => void;
}
export const RefundRequestView: React.FC<RefundRequestViewProps> = ({ order, onBack }) =>
  <div className="radar-view horizon-view space-y-4 pb-10">
    <button type="button" className="cyber-btn-secondary px-4 py-2" onClick={onBack}>Volver a la orden</button>
    <h1 className="text-xl font-bold">Solicitud de reembolso · {order.code}</h1>
    <OrderAftersalesPanel order={order} />
  </div>;
