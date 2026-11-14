/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { NavScreen, Order, OrderStatus, PrefillOrderData, PendingFollowupItem } from './types';
import { Sidebar } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { DashboardView } from './components/DashboardView';
import { OrdersTableView } from './components/OrdersTableView';
import { PersonalNotesWidget } from './components/PersonalNotesWidget';
import { MobileTabBar } from './components/MobileTabBar';
import { YardReadyAlertBar } from './components/YardReadyAlertBar';
import { LoadingOverlay } from './components/LoadingOverlay';
import { LoginView } from './components/LoginView';
import { YardLoginView } from './components/YardLoginView';
import { YardPortalView } from './components/YardPortalView';
import { YardAccessNotice } from './components/YardAccessNotice';
import { canAccessYardPortal, stripYardPortalFromUrl } from './utils/yardPortal';
import { useAuthSession } from './hooks/useAuthSession';
import { ordersApi } from './services/ordersApi';

// Code-splitting con React.lazy para pantallas secundarias y modales pesados
const OrderDetailView = React.lazy(() => import('./components/OrderDetailView').then((m) => ({ default: m.OrderDetailView })));
const ClientsView = React.lazy(() => import('./components/ClientsView').then((m) => ({ default: m.ClientsView })));
const ClaimsView = React.lazy(() => import('./components/ClaimsView').then((m) => ({ default: m.ClaimsView })));
const RefundsView = React.lazy(() => import('./components/RefundsView').then((m) => ({ default: m.RefundsView })));
const OperationsView = React.lazy(() => import('./components/OperationsView').then((m) => ({ default: m.OperationsView })));
const InventoryView = React.lazy(() => import('./components/InventoryView').then((m) => ({ default: m.InventoryView })));
const WeeklyRelationView = React.lazy(() => import('./components/WeeklyRelationView').then((m) => ({ default: m.WeeklyRelationView })));
const SystemSettingsView = React.lazy(() => import('./components/SystemSettingsView').then((m) => ({ default: m.SystemSettingsView })));
const UsersManagementView = React.lazy(() => import('./components/UsersManagementView').then((m) => ({ default: m.UsersManagementView })));
const NewOrderModal = React.lazy(() => import('./components/NewOrderModal').then((m) => ({ default: m.NewOrderModal })));
const SearchModal = React.lazy(() => import('./components/SearchModal').then((m) => ({ default: m.SearchModal })));
const ExportModal = React.lazy(() => import('./components/ExportModal').then((m) => ({ default: m.ExportModal })));
const StatusRequestModal = React.lazy(() => import('./components/StatusRequestModal').then((m) => ({ default: m.StatusRequestModal })));
const ChangePasswordModal = React.lazy(() => import('./components/ChangePasswordModal').then((m) => ({ default: m.ChangePasswordModal })));
const UserProfileModal = React.lazy(() => import('./components/UserProfileModal').then((m) => ({ default: m.UserProfileModal })));
const DailyFollowupBriefingModal = React.lazy(() => import('./components/DailyFollowupBriefingModal').then((m) => ({ default: m.DailyFollowupBriefingModal })));

const ViewFallback: React.FC = () => (
  <div className="flex flex-col items-center justify-center p-12 min-h-[350px] animate-fade-in text-slate-400">
    <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mb-3 shadow-[0_0_15px_rgba(6,182,212,0.3)]" />
    <span className="text-xs font-mono text-cyan-300 tracking-wider">Cargando módulo...</span>
  </div>
);
import { useRadarData } from './hooks/useRadarData';
import { useOrderActions } from './hooks/useOrderActions';
import { useViewLoading } from './hooks/useViewLoading';
import { useTheme } from './hooks/useTheme';
import { apiFetch } from './services/apiFetch';
import { canManageYardAlert, isClaimPieceReadyAlert, isYardReadyAlert, yardReadyAgeMinutes } from './utils/yardAlerts';
import { summarizeWorkload } from './utils/workloadSummary';
import { workflowResponse } from './components/OrderWorkflowPanel';
import type { WorkflowQueue } from './components/WorkflowTasksView';
const WorkflowTasksView = React.lazy(() => import('./components/WorkflowTasksView').then(m => ({ default: m.WorkflowTasksView })));

export default function App() {
  useTheme(); // Initialize theme on mount
  const isYardHostname = typeof window !== 'undefined' && (
    window.location.hostname.toLowerCase().startsWith('yard.') ||
    window.location.hostname.toLowerCase().includes('yard.localhost')
  );
  const isYardPath = typeof window !== 'undefined' && window.location.pathname.toLowerCase().startsWith('/yard');
  const isHostYard = isYardHostname || isYardPath;
  const [yardPortalActive, setYardPortalActive] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const hostname = window.location.hostname.toLowerCase();
    const pathname = window.location.pathname.toLowerCase();
    const search = window.location.search;
    return hostname.startsWith('yard.') || hostname.includes('yard.localhost') || search.includes('portal=yard') || pathname.startsWith('/yard');
  });
  const exitYardPortal = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.history.replaceState(window.history.state, '', stripYardPortalFromUrl(window.location.href));
    }
    setYardPortalActive(false);
  }, []);
  const [currentScreen, setCurrentScreen] = useState<NavScreen>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [claimsFocusOrderId, setClaimsFocusOrderId] = useState<string | null>(null);
  const { authenticated, checking: authChecking, user: authUser, role: userRole, login, updateUser, logout } = useAuthSession();
  const {
    orders,
    setOrders,
    selectedOrderId,
    setSelectedOrderId,
    activities,
    customers,
    loading: dataLoading,
    isRefreshing,
    lastSyncedAt,
    databaseMessage,
    setDatabaseMessage,
    replaceOrder,
    prependOrder,
    refreshCustomers,
    fetchAllData,
    yardCounts,
    yardNextOffset,
    isLoadingMoreYard,
    isSearchingYard,
    loadMoreYardOrders,
    searchYardOrders,
  } = useRadarData(authenticated && !authChecking, authUser?.role);
  const isYardRole = userRole === 'vendedor_yarda';
  const canUseYardPortal = canAccessYardPortal(userRole);
  const { createOrder, updateOrder, updateOrderStatus, createOrderClaim } = useOrderActions({
    orders,
    setOrders,
    setDatabaseMessage,
    replaceOrder,
    prependOrder,
    refreshCustomers,
  });
  const viewLoading = useViewLoading(currentScreen);

  // Global settings & Access Control

  // Prefill data for order creation from customer records
  const [prefillOrderData, setPrefillOrderData] = useState<PrefillOrderData | null>(null);

  // Modals state
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [deliveryPaymentOrderId, setDeliveryPaymentOrderId] = useState<string | null>(null);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isStatusRequestOpen, setIsStatusRequestOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  // Follow-up modal & pending items
  const [isFollowupModalOpen, setIsFollowupModalOpen] = useState(false);
  const [pendingFollowupItems, setPendingFollowupItems] = useState<PendingFollowupItem[]>([]);
  const [pendingFollowupsCount, setPendingFollowupsCount] = useState<number>(0);
  const [overdueFollowupsCount, setOverdueFollowupsCount] = useState<number>(0);
  const [yardAlertNow, setYardAlertNow] = useState(() => Date.now());
  const [orderDetailTab, setOrderDetailTab] = useState<'resumen' | 'workflow'>('resumen');
  const [orderDetailTabRequest, setOrderDetailTabRequest] = useState(0);
  const ordersInitialRangeRef = useRef<{ from: string; to: string } | null>(null);
  const lastCheckedAuthUserIdRef = useRef<number | null | 'unauthenticated'>('unauthenticated');

  useEffect(() => {
    if (!authenticated) return;
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k' || event.repeat) return;
      event.preventDefault();
      setIsSearchModalOpen((prev) => !prev);
    };
    window.addEventListener('keydown', handleSearchShortcut);
    return () => window.removeEventListener('keydown', handleSearchShortcut);
  }, [authenticated]);

  const fetchPendingFollowups = useCallback(async (autoOpenOnLogin = false) => {
    try {
      const [response, workflow] = await Promise.all([
        apiFetch(`/orders/followups/pending?all=true&_t=${Date.now()}`),
        apiFetch('/workflow/tasks').then(workflowResponse<WorkflowQueue>),
      ]);
      if (response.ok) {
        const data = await response.json();
        const items: PendingFollowupItem[] = data.pending || [];
        setPendingFollowupItems(items);

        const workload = summarizeWorkload(items, workflow.tasks);
        setPendingFollowupsCount(workload.pending);
        setOverdueFollowupsCount(workload.overdue);

        // Auto open on login session every time an operator/admin logs in if there are pending orders
        if (autoOpenOnLogin && workload.workflow > 0) {
          setCurrentScreen('mi_trabajo');
        } else if (autoOpenOnLogin && workload.followups > 0) {
          setIsFollowupModalOpen(true);
        }
      } else throw new Error('No se pudo actualizar el seguimiento histórico.');
    } catch (err) {
      console.error('Error fetching pending followups:', err);
      setDatabaseMessage(err instanceof Error ? err.message : 'No se pudo actualizar la bandeja de trabajo.');
    }
  }, [setDatabaseMessage]);

  useEffect(() => {
    if (authenticated && authUser && userRole !== 'vendedor_yarda' && !authChecking) {
      if (lastCheckedAuthUserIdRef.current !== authUser.id) {
        lastCheckedAuthUserIdRef.current = authUser.id;
        void fetchPendingFollowups(true);
      }
    } else if (!authenticated) {
      lastCheckedAuthUserIdRef.current = 'unauthenticated';
      setIsFollowupModalOpen(false);
    }
  }, [authenticated, authUser, authChecking, fetchPendingFollowups, userRole]);

  // 1. Server-Sent Events (SSE) for Real-Time Multi-Operator Sync
  useEffect(() => {
    if (!authenticated || !authUser || authChecking) return;

    let eventSource: EventSource | null = null;
    let reconnectTimeout: any = null;
    let isCancelled = false;

    const connectSSE = () => {
      if (isCancelled) return;
      try {
        eventSource = new EventSource('/api/events', { withCredentials: true });

        eventSource.addEventListener('followup:updated', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            void fetchPendingFollowups(false);
            window.dispatchEvent(new CustomEvent('radar:followup-updated', { detail: data }));
          } catch {
            void fetchPendingFollowups(false);
          }
        });

        eventSource.addEventListener('order:updated', () => {
          void fetchPendingFollowups(false);
          window.dispatchEvent(new Event('radar:data-changed'));
        });
        eventSource.addEventListener('inventory:updated', () => {
          window.dispatchEvent(new Event('radar:inventory-updated'));
          window.dispatchEvent(new Event('radar:data-changed'));
        });

        eventSource.onerror = () => {
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          if (!isCancelled) {
            reconnectTimeout = setTimeout(connectSSE, 4000);
          }
        };
      } catch (err) {
        if (!isCancelled) {
          reconnectTimeout = setTimeout(connectSSE, 5000);
        }
      }
    };

    connectSSE();

    return () => {
      isCancelled = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };
  }, [authenticated, authUser, authChecking, fetchPendingFollowups]);

  // 2. Cross-tab BroadcastChannel, window focus & periodic sync fallback
  useEffect(() => {
    if (!authenticated) return;

    const handleLocalFollowupUpdate = () => {
      void fetchPendingFollowups(false);
    };
    window.addEventListener('radar:followup-updated', handleLocalFollowupUpdate);

    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        bc = new BroadcastChannel('radar_realtime');
        bc.onmessage = (event) => {
          if (event.data?.type === 'followup:updated') {
            void fetchPendingFollowups(false);
          }
        };
      } catch {}
    }

    const handleSync = () => {
      if (authenticated && !document.hidden) {
        void fetchPendingFollowups(false);
      }
    };

    const interval = setInterval(handleSync, 20_000);
    document.addEventListener('visibilitychange', handleSync);
    window.addEventListener('focus', handleSync);

    return () => {
      window.removeEventListener('radar:followup-updated', handleLocalFollowupUpdate);
      document.removeEventListener('visibilitychange', handleSync);
      window.removeEventListener('focus', handleSync);
      clearInterval(interval);
      if (bc) bc.close();
    };
  }, [authenticated, fetchPendingFollowups]);
  // Selected Order object
  const selectedOrder = orders.find((o) => o.id === selectedOrderId) || orders[0];

  const yardReadyAlerts = useMemo(
    () => orders
      .filter(isYardReadyAlert)
      .filter((order) => canManageYardAlert(order, userRole, authUser?.id))
      .sort((a, b) => (Date.parse(a.yardPieceReadyAt || '') || 0) - (Date.parse(b.yardPieceReadyAt || '') || 0)),
    [orders, userRole, authUser?.id]
  );
  const claimReadyAlerts = useMemo(
    () => orders
      .filter(isClaimPieceReadyAlert)
      .filter((order) => canManageYardAlert(order, userRole, authUser?.id))
      .sort((a, b) => (Date.parse(a.claimPieceReadyAt || '') || 0) - (Date.parse(b.claimPieceReadyAt || '') || 0)),
    [orders, userRole, authUser?.id]
  );
  const yardReadyOldestMinutes = yardReadyAlerts.length
    ? yardReadyAgeMinutes(yardReadyAlerts[0], yardAlertNow)
    : null;
  const claimReadyOldestMinutes = claimReadyAlerts.length
    ? yardReadyAgeMinutes({ yardPieceReadyAt: claimReadyAlerts[0].claimPieceReadyAt }, yardAlertNow)
    : null;
  const pendingCustomerAlertCount = yardReadyAlerts.length + claimReadyAlerts.length;
  useEffect(() => {
    if (pendingCustomerAlertCount === 0) return;
    setYardAlertNow(Date.now());
    const timer = window.setInterval(() => setYardAlertNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [pendingCustomerAlertCount]);

  // Roles without yard access are sent back to the office and the portal URL is normalized,
  // so a reload cannot trap them in /yard. Dedicated yard hosts show an explicit notice instead.
  useEffect(() => {
    if (!authenticated || !authUser || canUseYardPortal || isYardHostname) return;
    if (!yardPortalActive && !isYardPath) return;
    exitYardPortal();
  }, [authenticated, authUser, canUseYardPortal, isYardHostname, isYardPath, yardPortalActive, exitYardPortal]);

  const handleOpenClaims = useCallback((orderId?: string) => {
    if (orderId) setClaimsFocusOrderId(orderId);
    setCurrentScreen('reclamos');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleOpenYardReadyWorkflow = useCallback((orderId: string) => {
    setSelectedOrderId(orderId);
    setOrderDetailTab('workflow');
    setOrderDetailTabRequest((value) => value + 1);
    setCurrentScreen('order-detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Navigation handlers
  const handleNavigate = (screen: NavScreen) => {
    if ((screen === 'relacion_semanal' || screen === 'finanzas') && userRole !== 'admin') {
      setCurrentScreen('dashboard');
      return;
    }
    ordersInitialRangeRef.current = null;
    setCurrentScreen(screen);
    if (screen === 'reclamos') setClaimsFocusOrderId(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectOrder = (orderId: string) => {
    setSelectedOrderId(orderId);
    setOrderDetailTab('resumen');
    setOrderDetailTabRequest((value) => value + 1);
    setCurrentScreen('order-detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (!orders.some((o) => o.id === orderId)) {
      ordersApi.get(orderId).then((fetched) => {
        if (!fetched) return;
        setOrders((prev) => (prev.some((o) => o.id === fetched.id) ? prev : [fetched, ...prev]));
      }).catch(() => undefined);
    }
  };

  const handleCreateOrder = useCallback(async (newOrder: Order) => {
    const savedOrder = await createOrder(newOrder);
    if (savedOrder) {
      setPrefillOrderData(null);
      setIsNewOrderModalOpen(false);
      setCurrentScreen('order-detail');
    }
    return savedOrder;
  }, [createOrder]);

  const handleCreateOrderFromCustomer = (customer: any) => {
    setPrefillOrderData({
      customerId: Number(customer.id),
      customerName: customer.name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
      customerPhone: customer.phone,
      customerEmail: customer.email,
      customerType: customer.type,
      customerAddress: customer.address_shipping || customer.shippingAddress,
      customerZipCode: customer.zip_code,
      make: '',
      model: '',
      year: undefined,
      mainPart: '',
      partPrice: 1000,
      warrantyDays: 60,
    });
    setIsNewOrderModalOpen(true);
  };

  const handleCreateOrderFromPart = (prefill: PrefillOrderData) => {
    setPrefillOrderData(prefill);
    setIsNewOrderModalOpen(true);
  };

  const handleUpdateOrder = useCallback(async (updatedOrder: Order) => {
    return await updateOrder(updatedOrder);
  }, [updateOrder]);

  const handleOpenNewOrder = useCallback(() => {
    setPrefillOrderData(null);
    setEditingOrder(null);
    setIsNewOrderModalOpen(true);
  }, []);

  const handleEditOrder = useCallback((order: Order) => {
    setEditingOrder(order);
    setIsNewOrderModalOpen(true);
  }, []);

  const handleOpenExport = useCallback(() => {
    setIsExportModalOpen(true);
  }, []);

  const handleOpenStatusRequest = useCallback(() => {
    setIsStatusRequestOpen(true);
  }, []);

  const handleStatusUpdate = useCallback((orderId: string, status: OrderStatus) => {
    if (status === 'entregado') {
      setDeliveryPaymentOrderId(orderId);
      handleSelectOrder(orderId);
      return;
    }
    void updateOrderStatus(orderId, status).catch((error) =>
      setDatabaseMessage(error instanceof Error ? error.message : 'No se pudo guardar el estado.')
    );
  }, [updateOrderStatus, handleSelectOrder, setDatabaseMessage]);

  const handleTableRefresh = useCallback(() => {
    void fetchAllData({ silent: false });
  }, [fetchAllData]);

  const handleDashboardRefresh = useCallback(() => {
    void fetchAllData({ silent: true });
  }, [fetchAllData]);

  const handleNavigateOrders = useCallback((range?: { from: string; to: string }) => {
    ordersInitialRangeRef.current = range ?? null;
    setCurrentScreen('ordenes');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleCloseNewOrderModal = useCallback(() => {
    setIsNewOrderModalOpen(false);
    setEditingOrder(null);
    setPrefillOrderData(null);
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const handleShortcuts = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (event.key === '/' ) {
        event.preventDefault();
        setIsSearchModalOpen(true);
        return;
      }
      if ((event.key === 'n' || event.key === 'N') && userRole !== 'vendedor_yarda' && !isNewOrderModalOpen && !editingOrder) {
        event.preventDefault();
        handleOpenNewOrder();
      }
    };
    window.addEventListener('keydown', handleShortcuts);
    return () => window.removeEventListener('keydown', handleShortcuts);
  }, [authenticated, userRole, isNewOrderModalOpen, editingOrder, handleOpenNewOrder]);

  const handleUpdateNewOrderModal = useCallback(async (updatedOrder: Order) => {
    const savedOrder = await handleUpdateOrder(updatedOrder);
    setIsNewOrderModalOpen(false);
    setEditingOrder(null);
    return savedOrder;
  }, [handleUpdateOrder]);

  if (authChecking) return <LoadingOverlay visible label="Validando sesión" />;
  if (!authenticated || !authUser) {
    if (yardPortalActive || isHostYard) {
      return <YardLoginView onAuthenticated={login} />;
    }
    return <LoginView onAuthenticated={login} />;
  }

  // Active Yard Portal mode or assigned Yard Role
  const yardRequested = yardPortalActive || isHostYard;
  if ((yardRequested || isYardRole) && canUseYardPortal) {
    return (
      <>
        <LoadingOverlay visible={dataLoading} />
        <YardPortalView
          orders={orders}
          currentUser={authUser}
          onLogout={() => { void logout(); }}
          onRefreshOrders={() => fetchAllData({ silent: true })}
          onUpdateOrder={handleUpdateOrder}
          onToggleOffice={exitYardPortal}
          loadError={databaseMessage}
          serverCounts={isYardRole ? yardCounts : null}
          hasMoreYardOrders={isYardRole && yardNextOffset !== null}
          isLoadingMoreYardOrders={isLoadingMoreYard}
          isSearchingYardOrders={isSearchingYard}
          onLoadMoreYardOrders={isYardRole ? loadMoreYardOrders : undefined}
          onSearchYardOrders={isYardRole ? searchYardOrders : undefined}
        />
      </>
    );
  }

  if (yardRequested && !canUseYardPortal && isYardHostname) {
    return (
      <YardAccessNotice
        userName={authUser.name}
        userRole={userRole || undefined}
        onLogout={() => { void logout(); }}
      />
    );
  }

  return (
    <div className="horizon-app flex h-screen h-[100dvh] w-full overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] antialiased font-sans relative cyber-grid-bg">
      <LoadingOverlay visible={dataLoading || viewLoading} />

      {/* Left Sidebar */}
      <Sidebar
        currentScreen={currentScreen}
        onNavigate={(screen) => {
          handleNavigate(screen);
          setIsSidebarOpen(false);
        }}
        activeOrdersCount={orders.length}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        userRole={userRole}
      />
      {/* Main Content Column */}
      <div className="horizon-workspace flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[var(--bg-surface)] backdrop-blur-2xl z-10">
        {/* Sticky Top Header */}
        <TopHeader
          currentScreen={currentScreen}
          selectedOrderCode={selectedOrder ? selectedOrder.code : undefined}
          onNavigate={handleNavigate}
          onOpenSearch={() => setIsSearchModalOpen(true)}
          onLogout={() => { void logout(); }}
          onOpenProfile={() => setIsProfileModalOpen(true)}
          onOpenChangePassword={() => setIsChangePasswordOpen(true)}
          onOpenFollowups={() => handleNavigate('mi_trabajo')}
          pendingFollowupsCount={pendingFollowupsCount}
          overdueFollowupsCount={overdueFollowupsCount}
          yardReadyCount={yardReadyAlerts.length}
          yardReadyOldestMinutes={yardReadyOldestMinutes}
          onOpenYardReady={yardReadyAlerts.length
            ? () => handleOpenYardReadyWorkflow(yardReadyAlerts[0].id)
            : undefined}
          claimReadyCount={claimReadyAlerts.length}
          claimReadyOldestMinutes={claimReadyOldestMinutes}
          onOpenClaims={claimReadyAlerts.length ? () => handleOpenClaims(claimReadyAlerts[0].id) : undefined}
          userName={authUser?.name || 'Usuario'}
          userAvatar={authUser?.avatar_url}
          userRole={userRole}
          onToggleYardPortal={() => setYardPortalActive(true)}
          onOpenNewOrder={handleOpenNewOrder}
          onToggleMobileMenu={() => setIsSidebarOpen(!isSidebarOpen)}
        />

        {yardReadyAlerts.length > 0 && !(currentScreen === 'order-detail' && selectedOrder?.id === yardReadyAlerts[0].id) && (
          <YardReadyAlertBar
            alerts={yardReadyAlerts}
            now={yardAlertNow}
            onOpenOrder={handleSelectOrder}
            onNotifyCustomer={handleOpenYardReadyWorkflow}
          />
        )}

        {claimReadyAlerts.length > 0 && currentScreen !== 'reclamos' && (
          <YardReadyAlertBar
            variant="claim"
            alerts={claimReadyAlerts}
            now={yardAlertNow}
            onOpenOrder={handleSelectOrder}
            onNotifyCustomer={handleOpenClaims}
          />
        )}

        {databaseMessage && (
          <div className="mx-3 mt-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-300 md:mx-5 shadow-[0_0_12px_rgba(245,158,11,0.2)] flex items-center gap-2">
            <span aria-hidden="true" className="material-symbols-outlined text-[17px]">info</span>
            <span>{databaseMessage}</span>
          </div>
        )}

        {/* Scrollable Main Screen Container */}
        <main className="flex-1 min-w-0 overflow-y-auto p-3 sm:p-4 md:p-5 lg:p-6 pb-24 md:pb-6 custom-scrollbar">
          <React.Suspense fallback={<ViewFallback />}>
            {currentScreen === 'mi_trabajo' && pendingFollowupsCount > 0 && (
              <div role="status" className="mb-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className="material-symbols-outlined text-[17px]">notifications_active</span>
                  <span>
                    Tienes {pendingFollowupsCount} {pendingFollowupsCount === 1 ? 'tarea pendiente' : 'tareas pendientes'}
                    {overdueFollowupsCount > 0 ? ` · ${overdueFollowupsCount} ${overdueFollowupsCount === 1 ? 'vencida' : 'vencidas'}` : ''}; abrimos tu jornada para que no pierdas el seguimiento.
                  </span>
                </span>
                <button type="button" onClick={() => handleNavigate('dashboard')} className="px-2.5 py-1 rounded-lg border border-amber-400/50 font-mono font-bold hover:bg-amber-500/20 transition">
                  Ir al dashboard
                </button>
              </div>
            )}
            {currentScreen === 'mi_trabajo' && <WorkflowTasksView orders={orders} onSelectOrder={handleSelectOrder} onNavigateIncident={handleNavigate} userRole={userRole}
              onLegacyFollowups={() => setIsFollowupModalOpen(true)} />}
            {currentScreen === 'dashboard' && (
              <DashboardView
                orders={orders}
                userRole={userRole}
                activities={activities}
                onSelectOrder={handleSelectOrder}
                onNavigateTaller={handleNavigateOrders}
                onRefresh={handleDashboardRefresh}
              />
            )}

            {(currentScreen === 'ordenes' || currentScreen === 'taller') && (
              <OrdersTableView
                orders={orders}
                initialFromDate={ordersInitialRangeRef.current?.from ?? ''}
                initialToDate={ordersInitialRangeRef.current?.to ?? ''}
                onSelectOrder={handleSelectOrder}
                onEditOrder={handleEditOrder}
                onOpenNewOrder={handleOpenNewOrder}
                onExport={handleOpenExport}
                onStatusRequest={handleOpenStatusRequest}
                onUpdateStatus={handleStatusUpdate}
                onRefresh={handleTableRefresh}
                isRefreshing={isRefreshing}
                lastSyncedAt={lastSyncedAt}
              />
            )}

            {(currentScreen === 'clientes' || currentScreen === 'crm') && (
              <ClientsView
                orders={orders}
                customers={customers}
                userRole={userRole}
                onSelectOrder={handleSelectOrder}
                onOpenNewOrderWithCustomer={handleCreateOrderFromCustomer}
                onRefreshCustomers={refreshCustomers}
              />
            )}

            {currentScreen === 'reclamos' && (
              <ClaimsView
                orders={orders}
                onUpdateOrder={handleUpdateOrder}
                userRole={userRole}
                onSelectOrder={handleSelectOrder}
                focusOrderId={claimsFocusOrderId}
              />
            )}
            {currentScreen === 'reembolsos' && (
              <RefundsView orders={orders} userRole={userRole} onSelectOrder={handleSelectOrder} />
            )}

            {(currentScreen === 'inventario' || (currentScreen as any) === 'piezas' || (currentScreen as any) === 'hold') && (
              <InventoryView
                onOpenNewOrderWithPart={handleCreateOrderFromPart}
                userRole={userRole}
              />
            )}

            {currentScreen === 'mis_operaciones' && (
              <OperationsView
                orders={orders}
                onSelectOrder={handleSelectOrder}
                onUpdateOrder={handleUpdateOrder}
                userRole={userRole}
                currentUser={authUser}
              />
            )}

            {(currentScreen === 'relacion_semanal' || currentScreen === 'finanzas') && (
              userRole === 'admin' ? (
                <WeeklyRelationView
                  orders={orders}
                  onBackToDashboard={() => handleNavigate('dashboard')}
                />
              ) : (
                <div className="flex flex-col items-center justify-center p-12 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-[#ef4444]/15 border border-[#ef4444]/30 flex items-center justify-center text-[#fca5a5] mb-4">
                    <span aria-hidden="true" className="material-symbols-outlined text-[32px]">lock</span>
                  </div>
                  <h2 className="text-lg font-bold text-[#f1f5f9]">Acceso Restringido</h2>
                  <p className="text-xs text-[#94a3b8] max-w-sm mt-1.5">
                    El módulo de Relación Semanal y Finanzas está reservado exclusivamente para la administración del sistema.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleNavigate('dashboard')}
                    className="mt-5 px-4 py-2 rounded-xl bg-[#1e293b] hover:bg-[#334155] text-xs font-semibold text-[#cbd5e1] transition-colors cursor-pointer"
                  >
                    Volver al Dashboard
                  </button>
                </div>
              )
            )}

            {(currentScreen === 'sistema' || currentScreen === 'configuracion' || currentScreen === 'ayuda') && (
              userRole === 'admin' ? (
                <SystemSettingsView
                  userRole={userRole}
                  onOpenChangePassword={() => setIsChangePasswordOpen(true)}
                />
              ) : (
                <div className="flex flex-col items-center justify-center p-12 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-[#f59e0b]/15 border border-[#f59e0b]/30 flex items-center justify-center text-[#fbbf24] mb-4">
                    <span aria-hidden="true" className="material-symbols-outlined text-[32px]">lock</span>
                  </div>
                  <h2 className="text-lg font-bold text-[#f1f5f9]">Acceso Restringido</h2>
                  <p className="text-xs text-[#94a3b8] max-w-sm mt-1.5">
                    El módulo Sistema está reservado para la administración. Puedes cambiar tu contraseña desde tu perfil.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleNavigate('dashboard')}
                    className="mt-5 px-4 py-2 rounded-xl bg-[#1e293b] hover:bg-[#334155] text-xs font-semibold text-[#cbd5e1] transition-colors cursor-pointer"
                  >
                    Volver al Dashboard
                  </button>
                </div>
              )
            )}

            {(currentScreen === 'usuarios' || currentScreen === 'directorio') && (
              userRole === 'admin'
                ? <UsersManagementView currentUserId={authUser.id} />
                : (
                  <div className="horizon-card p-8 text-center text-sm text-slate-300">
                    Acceso restringido. Solo administración puede gestionar usuarios y permisos.
                  </div>
                )
            )}

            {currentScreen === 'order-detail' && selectedOrder && (
              <OrderDetailView
                openDeliveryPayment={deliveryPaymentOrderId === selectedOrder.id}
                onDeliveryPaymentOpened={() => setDeliveryPaymentOrderId(null)}
                order={selectedOrder}
                onBack={() => handleNavigate('ordenes')}
                onUpdateOrder={handleUpdateOrder}
                onCreateClaim={createOrderClaim}
                currentUser={authUser}
                userRole={userRole}
                initialTab={orderDetailTab}
                tabRequestId={orderDetailTabRequest}
              />
            )}
          </React.Suspense>
        </main>

        {/* Native-like Mobile Bottom Navigation Bar */}
        <MobileTabBar
          currentScreen={currentScreen}
          onNavigate={handleNavigate}
          onOpenNewOrder={() => {
            setPrefillOrderData(null);
            setIsNewOrderModalOpen(true);
          }}
          onToggleMenu={() => setIsSidebarOpen(!isSidebarOpen)}
          activeOrdersCount={orders.length}
          pendingTasksCount={pendingFollowupsCount}
        />
      </div>

      <PersonalNotesWidget />

      {/* Global Modals con Suspense y carga condicional */}
      <React.Suspense fallback={null}>
        {isNewOrderModalOpen && (
          <NewOrderModal
            isOpen={isNewOrderModalOpen}
            onClose={handleCloseNewOrderModal}
            onCreateOrder={handleCreateOrder}
            onUpdateOrder={handleUpdateNewOrderModal}
            editingOrder={editingOrder}
            initialPrefillData={prefillOrderData || undefined}
            existingCustomers={customers}
            currentUser={authUser}
          />
        )}

        {isSearchModalOpen && (
          <SearchModal
            isOpen={isSearchModalOpen}
            onClose={() => setIsSearchModalOpen(false)}
            orders={orders}
            onSelectOrder={handleSelectOrder}
            onNavigate={handleNavigate}
            userRole={userRole}
          />
        )}

        {isExportModalOpen && (
          <ExportModal
            isOpen={isExportModalOpen}
            onClose={() => setIsExportModalOpen(false)}
            orders={orders}
          />
        )}
        {isStatusRequestOpen && (
          <StatusRequestModal isOpen={isStatusRequestOpen} orders={orders} onClose={() => setIsStatusRequestOpen(false)} />
        )}
        {isChangePasswordOpen && (
          <ChangePasswordModal isOpen={isChangePasswordOpen} onClose={() => setIsChangePasswordOpen(false)} />
        )}
        {isProfileModalOpen && (
          <UserProfileModal
            isOpen={isProfileModalOpen}
            onClose={() => setIsProfileModalOpen(false)}
            user={authUser}
            onUserUpdated={(updated) => updateUser(updated)}
          />
        )}
        {isFollowupModalOpen && (
          <DailyFollowupBriefingModal
            isOpen={isFollowupModalOpen}
            onClose={() => setIsFollowupModalOpen(false)}
            pendingItems={pendingFollowupItems}
            onSelectOrder={handleSelectOrder}
            onRefreshPending={() => fetchPendingFollowups(false)}
            currentUserName={authUser?.name}
            userRole={userRole}
          />
        )}
      </React.Suspense>
    </div>
  );
}
