import { useEffect, useState, useCallback, useRef } from 'react';
import { ActivityItem, Customer, Order } from '../types';
import { ordersApi } from '../services/ordersApi';
import { apiFetch } from '../services/apiFetch';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export const useRadarData = (authenticated: boolean) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [databaseMessage, setDatabaseMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchAllData = useCallback(async (options?: { silent?: boolean }) => {
    if (!authenticated) return;
    const isSilent = options?.silent ?? false;
    if (!isSilent) {
      setLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setDatabaseMessage(null);

    try {
      const [ordersResult, activitiesResult, customersResult] = await Promise.allSettled([
        ordersApi.list(),
        apiFetch('/activities').then((response) => (response.ok ? response.json() : Promise.reject())),
        apiFetch('/customers').then((response) => (response.ok ? response.json() : Promise.reject())),
      ]);

      if (!isMountedRef.current) return;

      if (ordersResult.status === 'fulfilled') {
        const databaseOrders = ordersResult.value;
        setOrders(databaseOrders);
        setSelectedOrderId((current) =>
          current && databaseOrders.some((o) => o.id === current) ? current : databaseOrders[0]?.id || null
        );
      } else {
        const error = ordersResult.reason;
        if (!(error instanceof Error && error.message === 'Sesión expirada')) {
          if (!isSilent) {
            setDatabaseMessage('No se pudo conectar con la base de datos.');
          }
        }
      }

      if (activitiesResult.status === 'fulfilled') {
        setActivities(activitiesResult.value);
      }

      if (customersResult.status === 'fulfilled') {
        setCustomers(customersResult.value);
      }

      setLastSyncedAt(new Date());
    } finally {
      if (isMountedRef.current) {
        if (!isSilent) setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [authenticated]);

  // Initial load
  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // Automatic background refresh every 5 minutes (300,000 ms)
  useEffect(() => {
    if (!authenticated) return;

    const intervalId = setInterval(() => {
      fetchAllData({ silent: true });
    }, FIVE_MINUTES_MS);

    // Refresh silently when browser tab returns to focus
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchAllData({ silent: true });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [authenticated, fetchAllData]);

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
    isRefreshing,
    lastSyncedAt,
    databaseMessage,
    setDatabaseMessage,
    replaceOrder,
    prependOrder,
    refreshCustomers,
    fetchAllData,
  };
};
