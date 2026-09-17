import { Dispatch, SetStateAction } from 'react';
import { Order, OrderStatus } from '../types';
import { ordersApi } from '../services/ordersApi';
import { apiFetch } from '../services/apiFetch';
import { canTransitionOrderStatus } from '../utils/orderStatusRules';

interface UseOrderActionsOptions {
  orders: Order[];
  setOrders: Dispatch<SetStateAction<Order[]>>;
  setDatabaseMessage: Dispatch<SetStateAction<string | null>>;
  replaceOrder: (order: Order) => void;
  prependOrder: (order: Order) => void;
}

export const useOrderActions = ({
  orders,
  setOrders,
  setDatabaseMessage,
  replaceOrder,
  prependOrder,
}: UseOrderActionsOptions) => {
  const createOrder = async (order: Order) => {
    try {
      const savedOrder = await ordersApi.create(order);
      prependOrder(savedOrder);
      return savedOrder;
    } catch {
      setDatabaseMessage('No se pudo guardar la orden en radar_db.');
      return null;
    }
  };

  const updateOrder = async (order: Order) => {
    try {
      const savedOrder = await ordersApi.update(order);
      replaceOrder(savedOrder);
      return savedOrder;
    } catch {
      setDatabaseMessage('No se pudieron guardar los cambios en radar_db.');
      return null;
    }
  };

  const updateOrderStatus = (orderId: string, newStatus: OrderStatus) => {
    const order = orders.find((currentOrder) => currentOrder.id === orderId);
    if (order && canTransitionOrderStatus(order.status, newStatus)) {
      void updateOrder({ ...order, status: newStatus });
    }
  };

  const createOrderClaim = async (orderId: string, reason: string) => {
    const response = await apiFetch('/claims', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, description: reason }),
    });

    if (!response.ok) throw new Error('No se pudo crear el reclamo en radar_db.');

    setOrders((previousOrders) => previousOrders.map((order) =>
      order.id === orderId ? { ...order, status: 'reclamo', claimReason: reason } : order
    ));
    setDatabaseMessage(null);
  };

  return { createOrder, updateOrder, updateOrderStatus, createOrderClaim };
};
