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
  refreshCustomers?: () => Promise<void> | void;
}

export const useOrderActions = ({
  orders,
  setOrders,
  setDatabaseMessage,
  replaceOrder,
  prependOrder,
  refreshCustomers,
}: UseOrderActionsOptions) => {
  const createOrder = async (order: Order) => {
    try {
      const savedOrder = await ordersApi.create(order);
      prependOrder(savedOrder);
      void Promise.resolve().then(() => refreshCustomers?.()).catch(() => setDatabaseMessage('Orden guardada; no se pudieron actualizar los clientes.'));
      return savedOrder;
    } catch (error) {
      setDatabaseMessage(error instanceof Error ? error.message : 'No se pudo guardar la orden en radar_db.');
      throw error;
    }
  };

  const updateOrder = async (order: Order) => {
    try {
      const savedOrder = await ordersApi.update(order);
      replaceOrder(savedOrder);
      void Promise.resolve().then(() => refreshCustomers?.()).catch(() => setDatabaseMessage('Orden guardada; no se pudieron actualizar los clientes.'));
      return savedOrder;
    } catch (error) {
      setDatabaseMessage(error instanceof Error ? error.message : 'No se pudieron guardar los cambios en radar_db.');
      throw error;
    }
  };

  const updateOrderStatus = async (orderId: string, newStatus: OrderStatus) => {
    const order = orders.find((currentOrder) => currentOrder.id === orderId);
    if (order && canTransitionOrderStatus(order.status, newStatus)) {
      return await updateOrder({ ...order, status: newStatus });
    }
  };

  const createOrderClaim = async (orderId: string, reason: string) => {
    try {
      const response = await apiFetch('/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, description: reason }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || 'No se pudo crear el reclamo en radar_db.');
      }

      window.dispatchEvent(new Event('radar:data-changed'));
      setDatabaseMessage(null);
    } catch (error) {
      setDatabaseMessage(error instanceof Error ? error.message : 'No se pudo crear el reclamo.');
      throw error;
    }
  };

  return { createOrder, updateOrder, updateOrderStatus, createOrderClaim };
};
