/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { NavScreen, Order, OrderStatus, PrefillOrderData } from './types';
import { SLA_METRICS } from './data/mockData';
import { Sidebar } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { DashboardView } from './components/DashboardView';
import { OrdersTableView } from './components/OrdersTableView';
import { OrderDetailView } from './components/OrderDetailView';
import { InventoryView } from './components/InventoryView';
import { FinanceView } from './components/FinanceView';
import { DirectoryView } from './components/DirectoryView';
import { CalendarView } from './components/CalendarView';
import { ClientsView } from './components/ClientsView';
import { ClaimsView } from './components/ClaimsView';
import { OperationsView } from './components/OperationsView';
import { WeeklyRelationView } from './components/WeeklyRelationView';
import { SystemSettingsView } from './components/SystemSettingsView';
import { UsersManagementView } from './components/UsersManagementView';
import { NewOrderModal } from './components/NewOrderModal';
import { QuickSMSModal } from './components/QuickSMSModal';
import { SearchModal } from './components/SearchModal';
import { ExportModal } from './components/ExportModal';
import { LoadingOverlay } from './components/LoadingOverlay';
import { LoginView } from './components/LoginView';
import { useAuthSession } from './hooks/useAuthSession';
import { useRadarData } from './hooks/useRadarData';
import { useOrderActions } from './hooks/useOrderActions';
import { useViewLoading } from './hooks/useViewLoading';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<NavScreen>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { authenticated, checking: authChecking, user: authUser, role: userRole, login, logout } = useAuthSession();
  const {
    orders,
    setOrders,
    selectedOrderId,
    setSelectedOrderId,
    activities,
    customers,
    loading: dataLoading,
    databaseMessage,
    setDatabaseMessage,
    replaceOrder,
    prependOrder,
  } = useRadarData(authenticated && !authChecking);
  const { createOrder, updateOrder, updateOrderStatus, createOrderClaim } = useOrderActions({
    orders,
    setOrders,
    setDatabaseMessage,
    replaceOrder,
    prependOrder,
  });
  const viewLoading = useViewLoading(currentScreen);

  // Global settings & Access Control

  // Prefill data for order creation from customer records
  const [prefillOrderData, setPrefillOrderData] = useState<PrefillOrderData | null>(null);

  // Modals state
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
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
    const savedOrder = await createOrder(newOrder);
    if (savedOrder) {
      setPrefillOrderData(null);
      setIsNewOrderModalOpen(false);
      setCurrentScreen('order-detail');
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

  const handleUpdateOrder = async (updatedOrder: Order) => {
    await updateOrder(updatedOrder);
  };

  if (authChecking) return <LoadingOverlay visible label="Validando sesión" />;
  if (!authenticated || !authUser) {
    return <LoginView onAuthenticated={login} />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#080d19] text-[#dfe2ef] antialiased select-none font-sans">
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
      />
      {/* Main Content Column */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[#0a0f1d]">
        {/* Sticky Top Header */}
        <TopHeader
          currentScreen={currentScreen}
          selectedOrderCode={selectedOrder ? selectedOrder.code : undefined}
          onNavigate={handleNavigate}
          onOpenSearch={() => setIsSearchModalOpen(true)}
          onLogout={() => { void logout(); }}
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
              onUpdateStatus={updateOrderStatus}
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

          {currentScreen === 'reclamos' && (
            <ClaimsView
              orders={orders}
              onUpdateOrder={handleUpdateOrder}
              userRole={userRole}
              onSelectOrder={handleSelectOrder}
            />
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

          {(currentScreen === 'sistema' || currentScreen === 'configuracion' || currentScreen === 'ayuda') && (
            <SystemSettingsView
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
              onCreateClaim={createOrderClaim}
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

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        orders={orders}
      />
    </div>
  );
}

