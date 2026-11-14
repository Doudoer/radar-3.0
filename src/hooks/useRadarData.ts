import { useEffect, useState, useCallback, useRef } from 'react';
import { ActivityItem, Customer, Order } from '../types';
import { ordersApi } from '../services/ordersApi';
import { apiFetch } from '../services/apiFetch';
import {
  mergeYardOrders,
  YARD_QUEUE_MAX_PAGE_SIZE,
  YARD_QUEUE_PAGE_SIZE,
  type YardQueueCounts,
  type YardQueuePage,
} from '../utils/yardQueue';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export const useRadarData = (authenticated: boolean, role?: string) => {
  const isYardRole = role === 'vendedor_yarda';
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [databaseMessage, setDatabaseMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [yardCounts, setYardCounts] = useState<YardQueueCounts | null>(null);
  const [yardNextOffset, setYardNextOffset] = useState<number | null>(null);
  const [isLoadingMoreYard, setIsLoadingMoreYard] = useState(false);
  const [isSearchingYard, setIsSearchingYard] = useState(false);

  const isMountedRef = useRef(true);
  const lastFetchTimeRef = useRef<number>(Date.now());
  const generationRef = useRef(0);
  const authenticatedRef = useRef(authenticated);
  const yardQueryRef = useRef('');
  const yardLoadedCountRef = useRef(0);
  const yardRequestRef = useRef(0);
  const sessionRef = useRef({ authenticated, generation: 0 });
  if (sessionRef.current.authenticated !== authenticated) {
    sessionRef.current = { authenticated, generation: sessionRef.current.generation + 1 };
  }
  const sessionGeneration = sessionRef.current.generation;
  authenticatedRef.current = authenticated;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchAllData = useCallback(async (options?: { silent?: boolean }): Promise<boolean> => {
    if (!authenticated) return false;
    const generation = ++generationRef.current;
    lastFetchTimeRef.current = Date.now();
    const isSilent = options?.silent ?? false;
    if (!isSilent) {
      setLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setDatabaseMessage(null);

    try {
      if (isYardRole) {
        const yardRequestId = ++yardRequestRef.current;
        try {
          const limit = Math.min(Math.max(yardLoadedCountRef.current, YARD_QUEUE_PAGE_SIZE), YARD_QUEUE_MAX_PAGE_SIZE);
          const params = new URLSearchParams({ limit: String(limit) });
          if (yardQueryRef.current) params.set('q', yardQueryRef.current);
          const response = await apiFetch(`/yard/orders?${params.toString()}`);
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.message || 'No se pudo cargar la cola de patio.');
          }
          const page = await response.json() as YardQueuePage;
          if (!isMountedRef.current || !authenticatedRef.current || generation !== generationRef.current
            || yardRequestId !== yardRequestRef.current) return;
          yardLoadedCountRef.current = page.orders.length;
          setOrders(page.orders);
          setYardCounts(page.counts);
          setYardNextOffset(page.nextOffset);
          setActivities([]);
          setCustomers([]);
          setSelectedOrderId((current) =>
            current && page.orders.some((o) => o.id === current) ? current : page.orders[0]?.id || null
          );
          setLastSyncedAt(new Date());
          return true;
        } catch (error) {
          if (!(error instanceof Error && error.message === 'Sesión expirada')) {
            setDatabaseMessage(error instanceof Error ? error.message : 'No se pudo cargar la cola de patio.');
          }
          return false;
        }
      }

      const [ordersResult, activitiesResult, customersResult] = await Promise.allSettled([
        ordersApi.list(),
        apiFetch('/activities').then((response) => (response.ok ? response.json() : Promise.reject())),
        apiFetch('/customers').then((response) => (response.ok ? response.json() : Promise.reject())),
      ]);

      if (!isMountedRef.current || !authenticatedRef.current || generation !== generationRef.current) return;

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

      if ([ordersResult, activitiesResult, customersResult].every((result) => result.status === 'fulfilled')) {
        setLastSyncedAt(new Date());
      } else {
        setDatabaseMessage('Sincronización incompleta. No se pudieron actualizar todos los datos.');
      }
      return [ordersResult, activitiesResult, customersResult].every((result) => result.status === 'fulfilled');
    } finally {
      if (isMountedRef.current && authenticatedRef.current && generation === generationRef.current) {
        if (!isSilent) setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [authenticated, isYardRole]);

  // Initial load
  useEffect(() => {
    if (!authenticated) {
      generationRef.current++;
      setOrders([]);
      setCustomers([]);
      setActivities([]);
      setSelectedOrderId(null);
      setLastSyncedAt(null);
      setLoading(false);
      setIsRefreshing(false);
      setDatabaseMessage(null);
      setYardCounts(null);
      setYardNextOffset(null);
      setIsLoadingMoreYard(false);
      setIsSearchingYard(false);
      yardLoadedCountRef.current = 0;
      yardQueryRef.current = '';
      return;
    }
    void fetchAllData();
    const refresh = () => { void fetchAllData({ silent: true }); };
    window.addEventListener('radar:data-changed', refresh);
    return () => {
      generationRef.current++;
      window.removeEventListener('radar:data-changed', refresh);
    };
  }, [authenticated, fetchAllData]);

  // Automatic background refresh every 5 minutes (300,000 ms)
  useEffect(() => {
    if (!authenticated) return;

    const intervalId = setInterval(() => {
      fetchAllData({ silent: true });
    }, FIVE_MINUTES_MS);

    // Refresh silently when browser tab returns to focus with 60s cooldown
    const VISIBILITY_COOLDOWN_MS = 60_000;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        if (now - lastFetchTimeRef.current >= VISIBILITY_COOLDOWN_MS) {
          fetchAllData({ silent: true });
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [authenticated, fetchAllData]);

  const loadMoreYardOrders = useCallback(async (): Promise<boolean> => {
    if (!isYardRole || yardNextOffset === null || isLoadingMoreYard) return false;
    const yardRequestId = ++yardRequestRef.current;
    setIsLoadingMoreYard(true);
    try {
      const params = new URLSearchParams({
        limit: String(YARD_QUEUE_PAGE_SIZE),
        offset: String(yardNextOffset),
      });
      if (yardQueryRef.current) params.set('q', yardQueryRef.current);
      const response = await apiFetch(`/yard/orders?${params.toString()}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || 'No se pudieron cargar más órdenes de patio.');
      }
      const page = await response.json() as YardQueuePage;
      if (!isMountedRef.current || !authenticatedRef.current
        || yardRequestId !== yardRequestRef.current) return false;
      setOrders((previous) => {
        const merged = mergeYardOrders(previous, page.orders);
        yardLoadedCountRef.current = merged.length;
        return merged;
      });
      setYardCounts(page.counts);
      setYardNextOffset(page.nextOffset);
      setLastSyncedAt(new Date());
      return true;
    } catch (error) {
      if (!(error instanceof Error && error.message === 'Sesión expirada')) {
        setDatabaseMessage(error instanceof Error ? error.message : 'No se pudieron cargar más órdenes de patio.');
      }
      return false;
    } finally {
      if (isMountedRef.current) setIsLoadingMoreYard(false);
    }
  }, [isYardRole, yardNextOffset, isLoadingMoreYard]);

  const searchYardOrders = useCallback(async (query: string): Promise<boolean> => {
    if (!isYardRole) return false;
    const nextQuery = query.trim();
    if (nextQuery === yardQueryRef.current) return true;
    yardQueryRef.current = nextQuery;
    const yardRequestId = ++yardRequestRef.current;
    setIsSearchingYard(true);
    try {
      const params = new URLSearchParams({ limit: String(YARD_QUEUE_PAGE_SIZE) });
      if (nextQuery) params.set('q', nextQuery);
      const response = await apiFetch(`/yard/orders?${params.toString()}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || 'No se pudo buscar en la cola de patio.');
      }
      const page = await response.json() as YardQueuePage;
      if (!isMountedRef.current || !authenticatedRef.current
        || yardRequestId !== yardRequestRef.current) return false;
      yardLoadedCountRef.current = page.orders.length;
      setOrders(page.orders);
      setYardCounts(page.counts);
      setYardNextOffset(page.nextOffset);
      setSelectedOrderId((current) =>
        current && page.orders.some((o) => o.id === current) ? current : null
      );
      return true;
    } catch (error) {
      if (!(error instanceof Error && error.message === 'Sesión expirada')) {
        setDatabaseMessage(error instanceof Error ? error.message : 'No se pudo buscar en la cola de patio.');
      }
      return false;
    } finally {
      if (isMountedRef.current) setIsSearchingYard(false);
    }
  }, [isYardRole]);

  const replaceOrder = (savedOrder: Order) => {
    if (!authenticatedRef.current || sessionRef.current.generation !== sessionGeneration) return;
    setOrders((previousOrders) => previousOrders.map((order) => order.id === savedOrder.id ? savedOrder : order));
    setDatabaseMessage(null);
  };

  const prependOrder = (savedOrder: Order) => {
    if (!authenticatedRef.current || sessionRef.current.generation !== sessionGeneration) return;
    setOrders((previousOrders) => [savedOrder, ...previousOrders]);
    setSelectedOrderId(savedOrder.id);
    setDatabaseMessage(null);
  };

  const refreshCustomers = async () => {
    const generation = generationRef.current;
      const response = await apiFetch('/customers');
      if (!response.ok) throw new Error('No se pudieron actualizar los clientes.');
      const data = await response.json();
      if (isMountedRef.current && authenticatedRef.current && generation === generationRef.current &&
        sessionRef.current.generation === sessionGeneration) setCustomers(data);
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
    yardCounts,
    yardNextOffset,
    isLoadingMoreYard,
    isSearchingYard,
    loadMoreYardOrders,
    searchYardOrders,
    replaceOrder,
    prependOrder,
    refreshCustomers,
    fetchAllData,
  };
};
