import { useEffect, useState, useCallback } from 'react';
import { ActivityItem, Customer, Order } from '../types';
import { ordersApi } from '../services/ordersApi';
import { apiFetch } from '../services/apiFetch';

export const useRadarData = (authenticated: boolean) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [databaseMessage, setDatabaseMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchAllData = useCallback(() => {
    if (!authenticated) return;
    setDatabaseMessage(null);
    setLoading(true);

    const ordersRequest = ordersApi.list()
      .then((databaseOrders) => {
        setOrders(databaseOrders);
        setSelectedOrderId((current) => current && databaseOrders.some((o) => o.id === current) ? current : databaseOrders[0]?.id || null);
      })
      .catch((error) => {
        if (error instanceof Error && error.message === 'Sesión expirada') {
          return;
        }
        setDatabaseMessage('No se pudo conectar con la base de datos.');
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

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const replaceOrder = (savedOrder: Order) => {
    setOrders((previousOrders) => previousOrders.map((order) => order.id === savedOrder.id ? savedOrder : order));
    setDatabaseMessage(null);
  };

  const prependOrder = (savedOrder: Order) => {
    setOrders((previousOrders) => [savedOrder, ...previousOrders]);
    setSelectedOrderId(savedOrder.id);
    setDatabaseMessage(null);
  };

  const refreshCustomers = async () => {
    try {
      const response = await apiFetch('/customers');
      if (response.ok) {
        const data = await response.json();
        setCustomers(data);
      }
    } catch {
      // ignore
    }
  };

  return {
    orders,
    setOrders,
    selectedOrderId,
    setSelectedOrderId,
    activities,
    customers,
    setCustomers,
    loading,
    databaseMessage,
    setDatabaseMessage,
    replaceOrder,
    prependOrder,
    refreshCustomers,
    fetchAllData,
  };
};
