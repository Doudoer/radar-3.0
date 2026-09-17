import { useEffect, useState } from 'react';
import { ActivityItem, Customer, Order } from '../types';
import { INITIAL_ORDERS } from '../data/mockData';
import { ordersApi } from '../services/ordersApi';
import { apiFetch } from '../services/apiFetch';

export const useRadarData = (authenticated: boolean) => {
  const [orders, setOrders] = useState<Order[]>(INITIAL_ORDERS);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(INITIAL_ORDERS[0]?.id || 'ORD-516560');
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [databaseMessage, setDatabaseMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authenticated) return;
    setDatabaseMessage(null);
    setLoading(true);

    const ordersRequest = ordersApi.list()
      .then((databaseOrders) => {
        if (databaseOrders.length > 0) {
          setOrders(databaseOrders);
          setSelectedOrderId(databaseOrders[0].id);
        }
      })
      .catch((error) => {
        setDatabaseMessage(error instanceof Error && error.message === 'Sesión expirada'
          ? 'La sesión expiró. Inicia sesión nuevamente.'
          : 'No se pudo cargar la base de datos. Mostrando datos locales.');
      });

    const activitiesRequest = apiFetch('/activities')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setActivities)
      .catch(() => setActivities([]));

    const customersRequest = apiFetch('/customers')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setCustomers)
      .catch(() => setCustomers([]));

    Promise.allSettled([ordersRequest, activitiesRequest, customersRequest]).finally(() => setLoading(false));
  }, [authenticated]);

  const replaceOrder = (savedOrder: Order) => {
    setOrders((previousOrders) => previousOrders.map((order) => order.id === savedOrder.id ? savedOrder : order));
    setDatabaseMessage(null);
  };

  const prependOrder = (savedOrder: Order) => {
    setOrders((previousOrders) => [savedOrder, ...previousOrders]);
    setSelectedOrderId(savedOrder.id);
    setDatabaseMessage(null);
  };

  return {
    orders,
    setOrders,
    selectedOrderId,
    setSelectedOrderId,
    activities,
    customers,
    loading,
    databaseMessage,
    setDatabaseMessage,
    replaceOrder,
    prependOrder,
  };
};
