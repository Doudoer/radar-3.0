/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { NavScreen, Order, OrderStatus, PrefillOrderData, PendingFollowupItem } from './types';
import { Sidebar } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { DashboardView } from './components/DashboardView';
import { OrdersTableView } from './components/OrdersTableView';
import { PersonalNotesWidget } from './components/PersonalNotesWidget';
import { MobileTabBar } from './components/MobileTabBar';
import { LoadingOverlay } from './components/LoadingOverlay';
import { LoginView } from './components/LoginView';
import { YardLoginView } from './components/YardLoginView';
import { YardPortalView } from './components/YardPortalView';
import { useAuthSession } from './hooks/useAuthSession';

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
const QuickSMSModal = React.lazy(() => import('./components/QuickSMSModal').then((m) => ({ default: m.QuickSMSModal })));
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
import { workflowResponse } from './components/OrderWorkflowPanel';
import type { WorkflowQueue } from './components/WorkflowTasksView';
const WorkflowTasksView = React.lazy(() => import('./components/WorkflowTasksView').then(m => ({ default: m.WorkflowTasksView })));

export default function App() {
  useTheme(); // Initialize theme on mount
  const isHostYard = typeof window !== 'undefined' && (
    window.location.hostname.toLowerCase().startsWith('yard.') ||
    window.location.hostname.toLowerCase().includes('yard.localhost') ||
    window.location.pathname.toLowerCase().startsWith('/yard')
  );
  const [yardPortalActive, setYardPortalActive] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const hostname = window.location.hostname.toLowerCase();
    const pathname = window.location.pathname.toLowerCase();
    const search = window.location.search;
    return hostname.startsWith('yard.') || hostname.includes('yard.localhost') || search.includes('portal=yard') || pathname.startsWith('/yard');
  });
  const [currentScreen, setCurrentScreen] = useState<NavScreen>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
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
  } = useRadarData(authenticated && !authChecking);
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
  const [smsModalData, setSmsModalData] = useState<{ isOpen: boolean; customerName: string; phone: string; order?: Order | null }>({
    isOpen: false,
    customerName: '',
    phone: '',
    order: null,
  });

  // Follow-up modal & pending items
  const [isFollowupModalOpen, setIsFollowupModalOpen] = useState(false);
  const [pendingFollowupItems, setPendingFollowupItems] = useState<PendingFollowupItem[]>([]);
  const [pendingFollowupsCount, setPendingFollowupsCount] = useState<number>(0);
  const [overdueFollowupsCount, setOverdueFollowupsCount] = useState<number>(0);
  const lastCheckedAuthUserIdRef = useRef<number | null | 'unauthenticated'>('unauthenticated');

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

        const relevantItems = items;

        const relevantOverdue = relevantItems.filter((i) => i.urgency === 'atrasada').length;
        const relevantActionable = relevantItems.filter((i) => i.urgency === 'atrasada' || i.urgency === 'hoy').length;

        // Pending followups badge reflects actionable orders needing attention (atrasadas + hoy)
        const workflowActionable = workflow.tasks.filter(task => task.bucket === 'overdue' || task.bucket === 'today' || task.escalated).length;
        setPendingFollowupsCount(relevantActionable + workflowActionable);
        setOverdueFollowupsCount(relevantOverdue + workflow.tasks.filter(task => task.escalated || task.bucket === 'overdue').length);

        // Auto open on login session every time an operator/admin logs in if there are pending orders
        if (autoOpenOnLogin && workflowActionable > 0) {
          setCurrentScreen('mi_trabajo');
        } else if (autoOpenOnLogin && relevantActionable > 0) {
          setIsFollowupModalOpen(true);
        }
      } else throw new Error('No se pudo actualizar el seguimiento histórico.');
    } catch (err) {
      console.error('Error fetching pending followups:', err);
      setDatabaseMessage(err instanceof Error ? err.message : 'No se pudo actualizar la bandeja de trabajo.');
    }
  }, [setDatabaseMessage]);

  useEffect(() => {
    if (authenticated && authUser && !authChecking) {
      if (lastCheckedAuthUserIdRef.current !== authUser.id) {
        lastCheckedAuthUserIdRef.current = authUser.id;
        void fetchPendingFollowups(true);
      }
    } else if (!authenticated) {
      lastCheckedAuthUserIdRef.current = 'unauthenticated';
      setIsFollowupModalOpen(false);
    }
  }, [authenticated, authUser, authChecking, fetchPendingFollowups]);

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

  // Navigation handlers
  const handleNavigate = (screen: NavScreen) => {
    if ((screen === 'relacion_semanal' || screen === 'finanzas') && userRole !== 'admin') {
      setCurrentScreen('dashboard');
      return;
    }
    setCurrentScreen(screen);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectOrder = (orderId: string) => {
    setSelectedOrderId(orderId);
    setCurrentScreen('order-detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

  const handleCloseNewOrderModal = useCallback(() => {
    setIsNewOrderModalOpen(false);
    setEditingOrder(null);
    setPrefillOrderData(null);
  }, []);

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
  if (yardPortalActive || isHostYard || userRole === 'vendedor_yarda') {
    return (
      <YardPortalView
        orders={orders}
        currentUser={authUser}
        onLogout={() => { void logout(); }}
        onRefreshOrders={() => fetchAllData({ silent: true })}
        onUpdateOrder={handleUpdateOrder}
        onToggleOffice={() => setYardPortalActive(false)}
      />
    );
  }

  return (
    <div className="horizon-app flex h-screen h-[100dvh] w-full overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] antialiased font-sans relative cyber-grid-bg">
      <LoadingOverlay visible={dataLoading || viewLoading} />

      {/* Ambient Neon Backlight Orbs - Lightweight GPU footprint */}
      <div className="absolute top-0 left-1/4 w-[28rem] h-[28rem] bg-cyan-500/6 rounded-full blur-[80px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[28rem] h-[28rem] bg-emerald-500/6 rounded-full blur-[80px] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[36rem] h-[36rem] bg-blue-600/5 rounded-full blur-[100px] pointer-events-none" />

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
          userName={authUser?.name || 'Usuario'}
          userAvatar={authUser?.avatar_url}
          userRole={userRole}
          onToggleYardPortal={() => setYardPortalActive(true)}
          onOpenNewOrder={() => {
            setPrefillOrderData(null);
            setIsNewOrderModalOpen(true);
          }}
          onToggleMobileMenu={() => setIsSidebarOpen(!isSidebarOpen)}
        />

        {databaseMessage && (
          <div className="mx-3 mt-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-300 md:mx-5 shadow-[0_0_12px_rgba(245,158,11,0.2)] flex items-center gap-2">
            <span className="material-symbols-outlined text-[17px]">info</span>
            <span>{databaseMessage}</span>
          </div>
        )}

        {/* Scrollable Main Screen Container */}
        <main className="flex-1 min-w-0 overflow-y-auto p-3 sm:p-4 md:p-5 lg:p-6 pb-24 md:pb-6 custom-scrollbar">
          <React.Suspense fallback={<ViewFallback />}>
            {currentScreen === 'mi_trabajo' && <WorkflowTasksView orders={orders} onSelectOrder={handleSelectOrder} onNavigateIncident={handleNavigate} userRole={userRole}
              onLegacyFollowups={() => setIsFollowupModalOpen(true)} />}
            {currentScreen === 'dashboard' && (
              <DashboardView
                orders={orders}
                slaMetrics={[]}
                activities={activities}
                onSelectOrder={handleSelectOrder}
                onNavigateTaller={() => handleNavigate('ordenes')}
                onRefresh={() => fetchAllData({ silent: true })}
              />
            )}

            {(currentScreen === 'ordenes' || currentScreen === 'taller') && (
              <OrdersTableView
                orders={orders}
                onSelectOrder={handleSelectOrder}
                onEditOrder={(order) => {
                  setEditingOrder(order);
                  setIsNewOrderModalOpen(true);
                }}
                onOpenNewOrder={() => {
                  setPrefillOrderData(null);
                  setIsNewOrderModalOpen(true);
                }}
                onExport={() => setIsExportModalOpen(true)}
                onStatusRequest={() => setIsStatusRequestOpen(true)}
                onUpdateStatus={(orderId, status) => {
                  if (status === 'entregado') {
                    setDeliveryPaymentOrderId(orderId);
                    handleSelectOrder(orderId);
                    return;
                  }
                  void updateOrderStatus(orderId, status).catch((error) =>
                    setDatabaseMessage(error instanceof Error ? error.message : 'No se pudo guardar el estado.')
                  );
                }}
                onRefresh={() => fetchAllData({ silent: false })}
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
                onOpenSMS={(customerName, phone) =>
                  setSmsModalData({ isOpen: true, customerName, phone, order: null })
                }
                onRefreshCustomers={refreshCustomers}
              />
            )}

            {currentScreen === 'reclamos' && (
              <ClaimsView
                orders={orders}
                onUpdateOrder={handleUpdateOrder}
                userRole={userRole}
                onSelectOrder={handleSelectOrder}
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
                    <span className="material-symbols-outlined text-[32px]">lock</span>
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
              <SystemSettingsView
                userRole={userRole}
                onOpenChangePassword={() => setIsChangePasswordOpen(true)}
              />
            )}

            {(currentScreen === 'usuarios' || currentScreen === 'directorio') && (
              <UsersManagementView currentUserId={authUser.id} />
            )}

            {currentScreen === 'order-detail' && selectedOrder && (
              <OrderDetailView
                openDeliveryPayment={deliveryPaymentOrderId === selectedOrder.id}
                onDeliveryPaymentOpened={() => setDeliveryPaymentOrderId(null)}
                order={selectedOrder}
                onBack={() => handleNavigate('ordenes')}
                onOpenSMS={(customerName, phone, order) =>
                  setSmsModalData({ isOpen: true, customerName, phone, order })
                }
                onUpdateOrder={handleUpdateOrder}
                onCreateClaim={createOrderClaim}
                currentUser={authUser}
                userRole={userRole}
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
          pendingTasksCount={overdueFollowupsCount + pendingFollowupsCount}
        />
      </div>

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

        {smsModalData.isOpen && (
          <QuickSMSModal
            isOpen={smsModalData.isOpen}
            customerName={smsModalData.customerName}
            phone={smsModalData.phone}
            order={smsModalData.order || undefined}
            onClose={() => setSmsModalData({ isOpen: false, customerName: '', phone: '', order: null })}
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
        <div className="hidden md:block">
          <PersonalNotesWidget />
        </div>
      </React.Suspense>
    </div>
  );
}
