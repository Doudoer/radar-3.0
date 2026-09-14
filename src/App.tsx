/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { NavScreen, Order, OrderStatus, AuctionBid, PrefillOrderData, ActivityItem, Customer } from './types';
import { INITIAL_ORDERS, KPI_CARDS, RECENT_ACTIVITIES, MONTHLY_SALES_DATA, SLA_METRICS } from './data/mockData';
import { Sidebar } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { DashboardView } from './components/DashboardView';
import { OrdersTableView } from './components/OrdersTableView';
import { OrderDetailView } from './components/OrderDetailView';
import { InventoryView } from './components/InventoryView';
import { CarPartSearchModule } from './components/CarPartSearchModule';
import { FinanceView } from './components/FinanceView';
import { ReportsView } from './components/ReportsView';
import { DirectoryView } from './components/DirectoryView';
import { CalendarView } from './components/CalendarView';
import { ClientsView } from './components/ClientsView';
import { ClaimsView } from './components/ClaimsView';
import { CallLogsView } from './components/CallLogsView';
import { OperationsView } from './components/OperationsView';
import { WeeklyRelationView } from './components/WeeklyRelationView';
import { AIAlertsView } from './components/AIAlertsView';
import { AIReportsView } from './components/AIReportsView';
import { SystemSettingsView } from './components/SystemSettingsView';
import { UsersManagementView } from './components/UsersManagementView';
import { NewOrderModal } from './components/NewOrderModal';
import { QuickSMSModal } from './components/QuickSMSModal';
import { SearchModal } from './components/SearchModal';
import { NotificationsDrawer } from './components/NotificationsDrawer';
import { ExportModal } from './components/ExportModal';
import { ordersApi } from './services/ordersApi';
import { canTransitionOrderStatus } from './utils/orderStatusRules';
import { apiFetch } from './services/apiFetch';
import { LoginView } from './components/LoginView';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<NavScreen>('dashboard');
  const [orders, setOrders] = useState<Order[]>(INITIAL_ORDERS);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(INITIAL_ORDERS[0]?.id || 'ORD-516560');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [databaseMessage, setDatabaseMessage] = useState<string | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('radar_token'));
  const [authUser, setAuthUser] = useState<{ role: string } | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

  useEffect(() => {
    if (!authToken) {
      setAuthChecking(false);
      return;
    }
    apiFetch('/auth/me')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => setAuthUser(payload.user))
      .catch(() => {
        localStorage.removeItem('radar_token');
        setAuthToken(null);
      })
      .finally(() => setAuthChecking(false));
  }, [authToken]);

  useEffect(() => {
    if (!authToken) return;
    ordersApi.list()
      .then((databaseOrders) => {
        if (databaseOrders.length > 0) {
          setOrders(databaseOrders);
          setSelectedOrderId(databaseOrders[0].id);
        }
      })
      .catch(() => setDatabaseMessage('No se pudo cargar radar_db. Mostrando datos locales.'));
    apiFetch('/activities')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setActivities)
      .catch(() => setActivities([]));
    apiFetch('/customers')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setCustomers)
      .catch(() => setCustomers([]));
  }, [authToken]);

  // Global settings & Access Control
  const [carpartEnabled, setCarpartEnabled] = useState(true);
  const userRole: 'admin' | 'operador' = authUser?.role?.toLowerCase() === 'admin' ? 'admin' : 'operador';

  // Prefill Data for Order Creation from Car-Part
  const [prefillOrderData, setPrefillOrderData] = useState<PrefillOrderData | null>(null);

  // Modals state
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [smsModalData, setSmsModalData] = useState<{ isOpen: boolean; customerName: string; phone: string; order?: Order | null }>({
    isOpen: false,
    customerName: '',
    phone: '',
    order: null,
  });
  // Selected Order object
  const selectedOrder = orders.find((o) => o.id === selectedOrderId) || orders[0];

  // Navigation handlers
  const handleNavigate = (screen: NavScreen) => {
    setCurrentScreen(screen);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectOrder = (orderId: string) => {
    setSelectedOrderId(orderId);
    setCurrentScreen('order-detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCreateOrder = async (newOrder: Order) => {
    try {
      const savedOrder = await ordersApi.create(newOrder);
      setOrders((previousOrders) => [savedOrder, ...previousOrders]);
      setSelectedOrderId(savedOrder.id);
      setPrefillOrderData(null);
      setIsNewOrderModalOpen(false);
      setCurrentScreen('order-detail');
      setDatabaseMessage(null);
    } catch {
      setDatabaseMessage('No se pudo guardar la orden en radar_db.');
    }
  };

  const handleCreateOrderFromCustomer = (customer: any) => {
    setPrefillOrderData({
      customerName: customer.name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
      customerPhone: customer.phone,
      customerEmail: customer.email,
      customerType: customer.type,
      customerAddress: customer.address_shipping || customer.shippingAddress,
      customerZipCode: customer.zip_code,
      make: 'Ford',
      model: '',
      year: 2023,
      mainPart: '',
      partPrice: 1000,
      warrantyDays: 60,
    });
    setIsNewOrderModalOpen(true);
  };

  const handleCreateOrderFromPart = (prefillData: PrefillOrderData) => {
    setPrefillOrderData(prefillData);
    setIsNewOrderModalOpen(true);
  };

  const handleUpdateOrder = async (updatedOrder: Order) => {
    try {
      const savedOrder = await ordersApi.update(updatedOrder);
      setOrders((previousOrders) =>
        previousOrders.map((order) => (order.id === savedOrder.id ? savedOrder : order))
      );
      setDatabaseMessage(null);
    } catch {
      setDatabaseMessage('No se pudieron guardar los cambios en radar_db.');
    }
  };

  const handleUpdateOrderStatus = (orderId: string, newStatus: OrderStatus) => {
    const order = orders.find((currentOrder) => currentOrder.id === orderId);
    if (order && canTransitionOrderStatus(order.status, newStatus)) void handleUpdateOrder({ ...order, status: newStatus });
  };

  const handleCreateOrderClaim = async (orderId: string, reason: string) => {
    const response = await apiFetch('/claims', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, description: reason }),
    });

    if (!response.ok) throw new Error('No se pudo crear el reclamo en radar_db.');

    setOrders((previousOrders) =>
      previousOrders.map((order) =>
        order.id === orderId ? { ...order, status: 'reclamo', claimReason: reason } : order
      )
    );
    setDatabaseMessage(null);
  };

  if (authChecking) return <div className="flex min-h-screen items-center justify-center bg-[#080d19] text-slate-300">Cargando sesión...</div>;
  if (!authToken || !authUser) {
    return <LoginView onAuthenticated={(token, user) => { setAuthToken(token); setAuthUser(user); }} />;
  }

  const handleUpdateWorkflowStep = (orderId: string, newStep: number) => {
    const order = orders.find((currentOrder) => currentOrder.id === orderId);
    if (order) void handleUpdateOrder({ ...order, workflowStep: newStep });
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#080d19] text-[#dfe2ef] antialiased select-none font-sans">
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
      />
      <button
        type="button"
        className="fixed right-4 top-4 z-40 rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs text-slate-300 shadow-lg hover:text-white"
        onClick={() => { localStorage.removeItem('radar_token'); setAuthToken(null); setAuthUser(null); }}
      >
        Cerrar sesión
      </button>

      {/* Main Content Column */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[#0a0f1d]">
        {/* Sticky Top Header */}
        <TopHeader
          currentScreen={currentScreen}
          selectedOrderCode={selectedOrder ? selectedOrder.code : undefined}
          onNavigate={handleNavigate}
          onOpenSearch={() => setIsSearchModalOpen(true)}
          onOpenNotifications={() => setIsNotificationsOpen(true)}
          onOpenHistory={() => setIsNotificationsOpen(true)}
          onOpenNewOrder={() => {
            setPrefillOrderData(null);
            setIsNewOrderModalOpen(true);
          }}
          onToggleMobileMenu={() => setIsSidebarOpen(!isSidebarOpen)}
        />

        {databaseMessage && (
          <div className="mx-3 mt-3 rounded-md border border-[#f59e0b]/40 bg-[#f59e0b]/10 px-3 py-2 text-xs text-[#fbbf24] md:mx-6">
            {databaseMessage}
          </div>
        )}

        {/* Scrollable Main Screen Container */}
        <main className="flex-1 min-w-0 overflow-y-auto p-3 sm:p-4 md:p-6 lg:p-7 custom-scrollbar">
          {currentScreen === 'dashboard' && (
            <DashboardView
              orders={orders}
              slaMetrics={SLA_METRICS}
              activities={activities}
              onSelectOrder={handleSelectOrder}
              onNavigateTaller={() => handleNavigate('ordenes')}
              onOpenActivitiesModal={() => setIsNotificationsOpen(true)}
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
              onUpdateStatus={handleUpdateOrderStatus}
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
            />
          )}

          {(currentScreen === 'buscar_piezas' || currentScreen === 'inventario' || currentScreen === 'stock') && (
            <CarPartSearchModule
              carpartEnabled={carpartEnabled}
              userRole={userRole}
              onCreateOrderFromPart={handleCreateOrderFromPart}
              onNavigateToSettings={() => handleNavigate('sistema')}
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

          {currentScreen === 'registro_llamadas' && (
            <CallLogsView onCreateOrderFromCall={handleCreateOrderFromPart} />
          )}

          {currentScreen === 'mis_operaciones' && (
            <OperationsView
              orders={orders}
              onSelectOrder={handleSelectOrder}
              onUpdateOrder={handleUpdateOrder}
              userRole={userRole}
            />
          )}

          {(currentScreen === 'relacion_semanal' || currentScreen === 'finanzas') && (
            <WeeklyRelationView orders={orders} userRole={userRole} />
          )}

          {currentScreen === 'alertas_ia' && <AIAlertsView />}

          {(currentScreen === 'reportes_ia' || currentScreen === 'reportes') && (
            <AIReportsView />
          )}

          {(currentScreen === 'sistema' || currentScreen === 'configuracion' || currentScreen === 'ayuda') && (
            <SystemSettingsView
              carpartEnabled={carpartEnabled}
              onToggleCarpartEnabled={setCarpartEnabled}
              userRole={userRole}
            />
          )}

          {(currentScreen === 'usuarios' || currentScreen === 'directorio') && (
            <UsersManagementView />
          )}

          {currentScreen === 'order-detail' && selectedOrder && (
            <OrderDetailView
              order={selectedOrder}
              onBack={() => handleNavigate('ordenes')}
              onOpenSMS={(customerName, phone, order) =>
                setSmsModalData({ isOpen: true, customerName, phone, order })
              }
              onUpdateOrder={handleUpdateOrder}
              onCreateClaim={handleCreateOrderClaim}
            />
          )}

          {currentScreen === 'calendario' && <CalendarView />}
        </main>
      </div>

      {/* Global Modals */}
      <NewOrderModal
        isOpen={isNewOrderModalOpen}
        onClose={() => {
          setIsNewOrderModalOpen(false);
          setEditingOrder(null);
          setPrefillOrderData(null);
        }}
        onCreateOrder={handleCreateOrder}
        onUpdateOrder={(updatedOrder) => {
          void handleUpdateOrder(updatedOrder);
          setIsNewOrderModalOpen(false);
          setEditingOrder(null);
        }}
        editingOrder={editingOrder}
        initialPrefillData={prefillOrderData || undefined}
        existingCustomers={customers}
      />

      <QuickSMSModal
        isOpen={smsModalData.isOpen}
        customerName={smsModalData.customerName}
        phone={smsModalData.phone}
        order={smsModalData.order || undefined}
        onClose={() => setSmsModalData({ isOpen: false, customerName: '', phone: '', order: null })}
      />

      <SearchModal
        isOpen={isSearchModalOpen}
        onClose={() => setIsSearchModalOpen(false)}
        orders={orders}
        onSelectOrder={handleSelectOrder}
        onNavigate={handleNavigate}
      />

      <NotificationsDrawer
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
        activities={activities}
        onSelectOrder={handleSelectOrder}
      />

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        orders={orders}
      />
    </div>
  );
}

