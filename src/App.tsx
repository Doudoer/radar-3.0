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
import { ClientsView } from './components/ClientsView';
import { ClaimsView } from './components/ClaimsView';
import { OperationsView } from './components/OperationsView';
import { InventoryView } from './components/InventoryView';
import { WeeklyRelationView } from './components/WeeklyRelationView';
import { SystemSettingsView } from './components/SystemSettingsView';
import { UsersManagementView } from './components/UsersManagementView';
import { NewOrderModal } from './components/NewOrderModal';
import { QuickSMSModal } from './components/QuickSMSModal';
import { SearchModal } from './components/SearchModal';
import { ExportModal } from './components/ExportModal';
import { StatusRequestModal } from './components/StatusRequestModal';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { PersonalNotesWidget } from './components/PersonalNotesWidget';
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
    refreshCustomers,
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
  const [isStatusRequestOpen, setIsStatusRequestOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
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

  const handleCreateOrderFromPart = (prefill: PrefillOrderData) => {
    setPrefillOrderData(prefill);
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
    <div className="flex h-screen w-screen overflow-hidden bg-[#050811] text-[#dfe2ef] antialiased select-none font-sans relative cyber-grid-bg">
      <LoadingOverlay visible={dataLoading || viewLoading} />

      {/* Ambient Neon Backlight Orbs */}
      <div className="absolute top-0 left-1/4 w-[36rem] h-[36rem] bg-cyan-500/8 rounded-full blur-[160px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[36rem] h-[36rem] bg-emerald-500/8 rounded-full blur-[160px] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[45rem] h-[45rem] bg-blue-600/6 rounded-full blur-[180px] pointer-events-none" />

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
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[#070c18]/80 backdrop-blur-3xl z-10">
        {/* Sticky Top Header */}
        <TopHeader
          currentScreen={currentScreen}
          selectedOrderCode={selectedOrder ? selectedOrder.code : undefined}
          onNavigate={handleNavigate}
          onOpenSearch={() => setIsSearchModalOpen(true)}
          onLogout={() => { void logout(); }}
          onOpenChangePassword={() => setIsChangePasswordOpen(true)}
          userName={authUser?.name || 'Usuario'}
          onOpenNewOrder={() => {
            setPrefillOrderData(null);
            setIsNewOrderModalOpen(true);
          }}
          onToggleMobileMenu={() => setIsSidebarOpen(!isSidebarOpen)}
        />

        {databaseMessage && (
          <div className="mx-3 mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300 md:mx-6 shadow-[0_0_15px_rgba(245,158,11,0.2)] flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">info</span>
            <span>{databaseMessage}</span>
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
              onStatusRequest={() => setIsStatusRequestOpen(true)}
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
              order={selectedOrder}
              onBack={() => handleNavigate('ordenes')}
              onOpenSMS={(customerName, phone, order) =>
                setSmsModalData({ isOpen: true, customerName, phone, order })
              }
              onUpdateOrder={handleUpdateOrder}
              onCreateClaim={createOrderClaim}
            />
          )}
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
        userRole={userRole}
      />

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        orders={orders}
      />
      <StatusRequestModal isOpen={isStatusRequestOpen} orders={orders} onClose={() => setIsStatusRequestOpen(false)} />
      <ChangePasswordModal isOpen={isChangePasswordOpen} onClose={() => setIsChangePasswordOpen(false)} />
      <PersonalNotesWidget />
    </div>
  );
}
