import React, { useState, useMemo, useEffect } from 'react';
import { Order, OrderStatus, YardCompatibility } from '../types';
import { apiFetch } from '../services/apiFetch';
import { CancelOrderModal } from './CancelOrderModal';
import { YardCompatibilityModal } from './YardCompatibilityModal';
import { YardPhotoGallery } from './YardPhotoGallery';

interface YardPortalViewProps {
  orders: Order[];
  currentUser?: { id?: number; name?: string; email?: string; role?: string } | null;
  onLogout: () => void;
  onRefreshOrders?: () => void;
  onUpdateOrder?: (updatedOrder: Order) => Promise<Order | void>;
  onToggleOffice?: () => void;
}

export const YardPortalView: React.FC<YardPortalViewProps> = ({
  orders,
  currentUser,
  onLogout,
  onRefreshOrders,
  onUpdateOrder,
  onToggleOffice,
}) => {
  const isSuperAdmin = currentUser?.role === 'admin';
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'pending_yard' | 'yard_ready' | 'claims' | 'yard_sales'>('pending_yard');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [orderToCancel, setOrderToCancel] = useState<Order | null>(null);
  const [markingReadyId, setMarkingReadyId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [orderForCompatibility, setOrderForCompatibility] = useState<Order | null>(null);
  const [isCompatibilityModalOpen, setIsCompatibilityModalOpen] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleCompatibilitySaved = async (orderId: string, updatedCompat: YardCompatibility) => {
    const orderToUpdate = orders.find((o) => o.id === orderId);
    if (orderToUpdate) {
      const updated = {
        ...orderToUpdate,
        yardCompatibility: updatedCompat,
      };
      if (onUpdateOrder) {
        await onUpdateOrder(updated);
      }
      if (selectedOrder && selectedOrder.id === orderId) {
        setSelectedOrder(updated);
      }
    }
  };

  // Helper: Solo órdenes pagadas o con reclamos deben aparecer en esta vista
  const isYardEligible = (o: Order) => o.status === 'pagado' || o.status === 'reclamo';

  // Base list of orders eligible for yard
  const eligibleOrders = useMemo(() => {
    return orders.filter(isYardEligible);
  }, [orders]);

  // Filter orders
  const filteredOrders = useMemo(() => {
    let result = eligibleOrders;

    // Tab filter
    if (filterTab === 'pending_yard') {
      result = result.filter((o) => o.status === 'pagado' && !o.yardPieceReady);
    } else if (filterTab === 'yard_ready') {
      result = result.filter((o) => o.status === 'pagado' && Boolean(o.yardPieceReady));
    } else if (filterTab === 'claims') {
      result = result.filter((o) => o.status === 'reclamo');
    } else if (filterTab === 'yard_sales') {
      result = result.filter((o) => Boolean(o.isYardSale || o.advisorRole === 'vendedor_yarda'));
    }

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((o) => {
        const code = (o.code || '').toLowerCase();
        const vin = (o.vehicle?.vin || '').toLowerCase();
        const part = (o.mainPart || '').toLowerCase();
        const customer = (o.customer?.name || '').toLowerCase();
        const phone = (o.customer?.phone || '').toLowerCase();
        const stock = (o.stockNumber || '').toLowerCase();
        const makeModel = `${o.vehicle?.year || ''} ${o.vehicle?.make || ''} ${o.vehicle?.model || ''}`.toLowerCase();
        return (
          code.includes(q) ||
          vin.includes(q) ||
          part.includes(q) ||
          customer.includes(q) ||
          phone.includes(q) ||
          stock.includes(q) ||
          makeModel.includes(q)
        );
      });
    }

    return result;
  }, [eligibleOrders, filterTab, searchQuery]);

  // Counts for tabs (computed strictly over eligible orders)
  const counts = useMemo(() => {
    return {
      all: eligibleOrders.length,
      pending_yard: eligibleOrders.filter((o) => o.status === 'pagado' && !o.yardPieceReady).length,
      yard_ready: eligibleOrders.filter((o) => o.status === 'pagado' && Boolean(o.yardPieceReady)).length,
      claims: eligibleOrders.filter((o) => o.status === 'reclamo').length,
      yard_sales: eligibleOrders.filter((o) => Boolean(o.isYardSale || o.advisorRole === 'vendedor_yarda')).length,
    };
  }, [eligibleOrders]);

  // Action: mark piece as ready in yard
  const handleMarkYardReady = async (order: Order) => {
    setMarkingReadyId(order.id);
    try {
      const response = await apiFetch(`/orders/${order.id}/yard-ready`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo marcar la pieza en yarda.');

      const updated = {
        ...order,
        yardPieceReady: true,
        yardPieceReadyAt: new Date().toISOString(),
        yardPieceReadyBy: currentUser?.id,
        yardCompatibility: data.cleanedImagesCount > 0 && order.yardCompatibility
          ? { ...order.yardCompatibility, referenceImages: [] }
          : order.yardCompatibility,
      };

      if (onUpdateOrder) {
        await onUpdateOrder(updated);
      }
      if (selectedOrder && selectedOrder.id === order.id) {
        setSelectedOrder(updated);
      }
      showToast(
        data.cleanedImagesCount > 0
          ? `¡Pieza de #${order.code} lista en patio y se eliminaron ${data.cleanedImagesCount} fotos para ahorrar espacio!`
          : `¡Pieza de orden #${order.code} confirmada como lista en patio!`
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al marcar pieza en yarda');
    } finally {
      setMarkingReadyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col font-sans antialiased selection:bg-amber-500 selection:text-black">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 rounded-xl bg-emerald-500/95 text-slate-950 font-bold px-4 py-2.5 text-xs font-mono shadow-[0_0_25px_rgba(16,185,129,0.4)] flex items-center gap-2 animate-fade-in">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 bg-[#0d1424]/95 border-b border-amber-500/20 backdrop-blur-md px-4 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center shadow-[0_0_15px_rgba(245,158,11,0.2)]">
            <span className="material-symbols-outlined text-2xl">agriculture</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-black text-lg tracking-tight text-white">RADAR</span>
              <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-400 border border-amber-500/40 text-[10px] font-mono font-bold uppercase tracking-wider">
                Yarda
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono hidden sm:block">
              Gestión física y ventas de patio · yard.localhost.com
            </p>
          </div>
        </div>

        {/* Right side user info & actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Admin badge if Super Admin */}
          {isSuperAdmin && (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-mono font-bold">
              <span className="material-symbols-outlined text-[16px] text-red-400">admin_panel_settings</span>
              <span>Modo Administrador</span>
            </div>
          )}

          {/* User info */}
          <div className="text-right hidden sm:block">
            <div className="text-xs font-bold text-white font-mono">{currentUser?.name || 'Empleado Yarda'}</div>
            <div className="text-[10px] text-amber-400 font-mono uppercase tracking-wider">
              {currentUser?.role === 'admin' ? 'Super Admin' : currentUser?.role === 'vendedor_yarda' ? 'Vendedor Yarda' : 'Operador'}
            </div>
          </div>

          {/* Refresh button */}
          {onRefreshOrders && (
            <button
              type="button"
              onClick={onRefreshOrders}
              title="Actualizar datos"
              className="p-2 rounded-xl border border-slate-700 bg-slate-800/60 hover:bg-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px]">refresh</span>
            </button>
          )}

          {/* Switch to Office version if admin */}
          {isSuperAdmin && (
            <button
              type="button"
              onClick={onToggleOffice ? onToggleOffice : () => { window.location.href = 'http://localhost:3000'; }}
              title="Ir a Radar Oficina"
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 text-xs font-mono font-bold transition-all cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">domain</span>
              <span>Oficina</span>
            </button>
          )}

          {/* Logout */}
          <button
            type="button"
            onClick={onLogout}
            title="Cerrar sesión"
            className="p-2 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 transition-all cursor-pointer flex items-center gap-1 text-xs font-mono font-bold"
          >
            <span className="material-symbols-outlined text-[18px]">logout</span>
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5 space-y-4 pb-28 md:pb-8">
        {/* Search bar & quick filters */}
        <div className="bg-[#0d1424] border border-slate-800 rounded-2xl p-3 sm:p-4 shadow-sm space-y-3">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por orden #, VIN, cliente, pallet, stock o pieza..."
              className="w-full rounded-xl border border-slate-700 bg-slate-900/90 pl-11 pr-4 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none font-mono"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            )}
          </div>

          {/* Desktop horizontal filter tabs (hidden on mobile, replaced by bottom bar) */}
          <div className="hidden md:flex items-center gap-2 overflow-x-auto pb-1 custom-scrollbar text-xs font-mono">
            {[
              { id: 'pending_yard', label: 'Por preparar en patio', count: counts.pending_yard, icon: 'build_circle' },
              { id: 'yard_ready', label: 'Listas en patio', count: counts.yard_ready, icon: 'check_circle' },
              { id: 'claims', label: 'Con Reclamo', count: counts.claims, icon: 'report_problem' },
              { id: 'yard_sales', label: 'Ventas de Yarda', count: counts.yard_sales, icon: 'point_of_sale' },
              { id: 'all', label: 'Todas las órdenes', count: counts.all, icon: 'list_alt' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterTab(tab.id as any)}
                className={`px-3 py-2 rounded-xl border font-bold flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer ${
                  filterTab === tab.id
                    ? 'border-amber-500 bg-amber-500/20 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                    : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-white'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
                <span>{tab.label}</span>
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 border border-slate-700 text-slate-300">
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Orders Grid / List */}
        {filteredOrders.length === 0 ? (
          <div className="bg-[#0d1424] border border-slate-800 rounded-2xl p-10 text-center space-y-3">
            <span className="material-symbols-outlined text-4xl text-slate-600">inbox</span>
            <p className="text-sm font-mono text-slate-400">No hay órdenes que coincidan con los filtros seleccionados.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {filteredOrders.map((order) => {
              const price = Number(order.financials?.partPrice || 0);
              const downPayment = Number(order.financials?.downPayment || 0);
              const balanceDue = Number(order.financials?.balanceDue ?? Math.max(0, price - downPayment));
              const isReadyInYard = Boolean(order.yardPieceReady);

              return (
                <div
                  key={order.id}
                  className={`rounded-2xl border transition-all flex flex-col justify-between p-4 bg-[#0d1424]/90 backdrop-blur-sm ${
                    isReadyInYard
                      ? 'border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                      : 'border-amber-500/30 hover:border-amber-500/60 shadow-sm'
                  }`}
                >
                  <div className="space-y-3">
                    {/* Header: Order Code & Status badge */}
                    <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2.5">
                      <div>
                        <span className="text-amber-400 font-mono font-black text-sm tracking-wide">
                          #{order.code}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400 block mt-0.5">
                          {order.createdAt}
                        </span>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {order.status === 'reclamo' ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider border border-rose-500/50 bg-rose-500/20 text-rose-300 flex items-center gap-1 shadow-[0_0_10px_rgba(244,63,94,0.25)]">
                            <span className="material-symbols-outlined text-[13px]">report_problem</span>
                            RECLAMO
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider border border-emerald-500/40 bg-emerald-500/20 text-emerald-300 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[13px]">check_circle</span>
                            PAGADO
                          </span>
                        )}
                        {(order.isYardSale || order.advisorRole === 'vendedor_yarda') && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            🚜 Venta Yarda
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Part & Vehicle Highlight */}
                    <div>
                      <h3 className="font-bold text-white text-base leading-snug">
                        {order.mainPart}
                      </h3>
                      <p className="text-xs text-amber-300/90 font-mono mt-0.5">
                        {order.vehicle?.year} {order.vehicle?.make} {order.vehicle?.model} {order.vehicle?.trim}
                      </p>
                    </div>

                    {/* Technical details grid */}
                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80">
                      <div>
                        <span className="text-slate-400 block text-[9px] uppercase font-bold">VIN</span>
                        <span className="text-slate-200 font-bold truncate block" title={order.vehicle?.vin}>
                          {order.vehicle?.vin ? order.vehicle.vin.slice(-8) : 'N/D'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[9px] uppercase font-bold">Stock / Pallet</span>
                        <span className="text-amber-400 font-bold truncate block">
                          {order.stockNumber || 'Sin pallet asignado'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[9px] uppercase font-bold">Cliente</span>
                        <span className="text-slate-200 truncate block">{order.customer?.name}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[9px] uppercase font-bold">Saldo Pendiente</span>
                        <span className={`font-bold block ${balanceDue > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                          ${balanceDue.toFixed(2)} USD
                        </span>
                      </div>
                    </div>

                    {/* Preparation or Yard Note */}
                    {order.preparation && (
                      <div className="p-2 rounded-lg bg-cyan-950/30 border border-cyan-500/30 text-[10px] font-mono text-cyan-200 flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[14px] text-cyan-400">schedule</span>
                        <span>
                          {order.preparation.deliveryType === 'retiro_tienda' ? 'Recogida en yarda' : 'Envío'}:{' '}
                          {order.preparation.dateFrom}
                        </span>
                      </div>
                    )}

                    {/* Claim Notification Banner */}
                    {order.status === 'reclamo' && (
                      <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-500/40 text-[11px] font-mono text-rose-200 space-y-1">
                        <div className="flex items-center gap-1.5 font-bold text-rose-400">
                          <span className="material-symbols-outlined text-[16px]">report_problem</span>
                          <span>Orden con Reclamo Activo</span>
                        </div>
                        {order.claimReason && (
                          <p className="text-[10px] text-rose-300">
                            <strong className="text-rose-400">Motivo:</strong> {order.claimReason}
                          </p>
                        )}
                        {order.notes && !order.claimReason && (
                          <p className="text-[10px] text-rose-300 truncate">
                            <strong className="text-rose-400">Nota:</strong> {order.notes}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Compatibility list snippet */}
                    {order.yardCompatibility?.compatibilityList && (
                      <div className="p-2.5 rounded-xl bg-amber-950/20 border border-amber-500/30 text-[11px] font-mono text-amber-200 space-y-1">
                        <div className="flex items-center gap-1.5 font-bold text-amber-400">
                          <span className="material-symbols-outlined text-[15px]">swap_horiz</span>
                          <span>Compatibilidad</span>
                        </div>
                        <p className="text-[10px] text-slate-300 line-clamp-2 whitespace-pre-line">
                          {order.yardCompatibility.compatibilityList}
                        </p>
                      </div>
                    )}

                    {/* Reference Photos Gallery */}
                    {order.yardCompatibility?.referenceImages && order.yardCompatibility.referenceImages.length > 0 && (
                      <div className="space-y-1 pt-1">
                        <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold">
                          <span className="flex items-center gap-1 text-amber-400">
                            <span className="material-symbols-outlined text-[14px]">photo_library</span>
                            <span>Fotos de Referencia ({order.yardCompatibility.referenceImages.length})</span>
                          </span>
                        </div>
                        <YardPhotoGallery images={order.yardCompatibility.referenceImages} maxThumbnails={4} />
                      </div>
                    )}
                  </div>

                  {/* Actions footer */}
                  <div className="mt-4 pt-3 border-t border-slate-800 flex flex-col gap-2">
                    {/* Admin Button: Compatibilidad & Fotos */}
                    {isSuperAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setOrderForCompatibility(order);
                          setIsCompatibilityModalOpen(true);
                        }}
                        title="Gestionar lista de compatibilidad y fotos de referencia"
                        className="w-full py-1.5 px-3 rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 font-mono text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <span className="material-symbols-outlined text-[16px]">swap_horiz</span>
                        <span>
                          {order.yardCompatibility?.compatibilityList || (order.yardCompatibility?.referenceImages && order.yardCompatibility.referenceImages.length > 0)
                            ? 'Editar Compatibilidad & Fotos'
                            : '+ Agregar Compatibilidad & Fotos'}
                        </span>
                      </button>
                    )}

                    {/* Main Yard Status Action */}
                    {!isReadyInYard ? (
                      <button
                        type="button"
                        disabled={markingReadyId === order.id}
                        onClick={() => handleMarkYardReady(order)}
                        className="w-full py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-bold text-xs flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(245,158,11,0.25)] transition-all cursor-pointer disabled:opacity-60"
                      >
                        <span className="material-symbols-outlined text-[18px]">build_circle</span>
                        <span>{markingReadyId === order.id ? 'Marcando...' : 'Confirmar Pieza Lista en Patio'}</span>
                      </button>
                    ) : (
                      <div className="w-full py-2 px-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-mono font-bold text-xs flex items-center justify-center gap-2">
                        <span className="material-symbols-outlined text-[18px] text-emerald-400">check_circle</span>
                        <span>Pieza Lista en Patio</span>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedOrder(order)}
                        className="flex-1 py-1.5 px-3 rounded-xl border border-slate-700 bg-slate-800/60 hover:bg-slate-700 text-slate-300 hover:text-white font-mono text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[16px]">visibility</span>
                        <span>Ver Orden</span>
                      </button>

                      {/* Admin Cancel Button */}
                      {isSuperAdmin && order.status !== 'cancelado' && (
                        <button
                          type="button"
                          onClick={() => {
                            setOrderToCancel(order);
                            setIsCancelModalOpen(true);
                          }}
                          title="Cancelar orden administrativamente (Super Admin)"
                          className="py-1.5 px-2.5 rounded-xl border border-red-500/40 bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs font-mono font-bold transition-all cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[16px]">block</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Detail Modal for Yard Workers */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="bg-[#0d1424] border border-amber-500/40 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 sm:p-6 shadow-[0_0_50px_rgba(245,158,11,0.2)] space-y-4 font-mono text-xs">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-amber-400 font-black text-lg">#{selectedOrder.code}</span>
                  {selectedOrder.status === 'reclamo' ? (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-rose-500/20 border border-rose-500/40 text-rose-300 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px]">report_problem</span>
                      RECLAMO
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px]">check_circle</span>
                      PAGADO
                    </span>
                  )}
                </div>
                <p className="text-slate-400 text-[11px] mt-0.5">Asesor: {selectedOrder.advisor || 'Sin asignar'}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-[22px]">close</span>
              </button>
            </div>

            {/* Claim Details if Reclamo */}
            {selectedOrder.status === 'reclamo' && (
              <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/40 space-y-2">
                <div className="flex items-center gap-2 text-rose-400 font-bold text-xs uppercase">
                  <span className="material-symbols-outlined text-[18px]">report_problem</span>
                  <span>Detalle del Reclamo Activo</span>
                </div>
                {selectedOrder.claimReason && (
                  <div className="bg-rose-900/30 p-2.5 rounded-lg border border-rose-500/30 text-rose-200">
                    <strong className="text-rose-300 block text-[10px] uppercase mb-1">Motivo:</strong>
                    <p className="text-xs">{selectedOrder.claimReason}</p>
                  </div>
                )}
                {selectedOrder.notes && (
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 text-slate-300">
                    <strong className="text-slate-400 block text-[10px] uppercase mb-1">Notas:</strong>
                    <p className="text-xs">{selectedOrder.notes}</p>
                  </div>
                )}
              </div>
            )}

            {/* Vehicle & Part */}
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <span className="text-slate-400 uppercase font-bold text-[10px] block">Vehículo y Pieza</span>
              <p className="text-base text-white font-bold">{selectedOrder.mainPart}</p>
              <p className="text-amber-300">
                {selectedOrder.vehicle?.year} {selectedOrder.vehicle?.make} {selectedOrder.vehicle?.model} {selectedOrder.vehicle?.trim}
              </p>
              {selectedOrder.productSpecs && (
                <p className="text-slate-300 text-[11px] italic bg-slate-900 p-2 rounded-lg border border-slate-800">
                  {selectedOrder.productSpecs}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 pt-1 text-slate-300">
                <div>VIN: <strong>{selectedOrder.vehicle?.vin || 'No registrado'}</strong></div>
                <div>Transmisión: <strong>{selectedOrder.vehicle?.transmission || 'N/D'}</strong></div>
                <div>Stock/Pallet: <strong className="text-amber-400">{selectedOrder.stockNumber || 'Pendiente'}</strong></div>
                <div>Garantía: <strong>{selectedOrder.warrantyDays || 60} días</strong></div>
              </div>
            </div>

            {/* Compatibility & Reference Photos Section */}
            <div className="p-3.5 rounded-xl bg-slate-950 border border-amber-500/40 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-400 font-bold text-xs uppercase">
                  <span className="material-symbols-outlined text-[18px]">swap_horiz</span>
                  <span>Compatibilidad Vehicular & Fotos de Referencia</span>
                </div>
                {isSuperAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      setOrderForCompatibility(selectedOrder);
                      setIsCompatibilityModalOpen(true);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[13px]">edit</span>
                    <span>Editar</span>
                  </button>
                )}
              </div>

              {/* Compatibility text box */}
              {selectedOrder.yardCompatibility?.compatibilityList ? (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    Modelos y Años Compatibles:
                  </span>
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs font-mono whitespace-pre-line leading-relaxed shadow-inner">
                    {selectedOrder.yardCompatibility.compatibilityList}
                  </div>
                </div>
              ) : (
                <p className="text-slate-500 italic text-[11px]">
                  No se ha registrado lista de compatibilidad para esta pieza.
                </p>
              )}

              {/* Reference Photos Gallery with WhatsApp style & Lightbox zoom */}
              {selectedOrder.yardCompatibility?.referenceImages && selectedOrder.yardCompatibility.referenceImages.length > 0 ? (
                <div className="space-y-1.5 pt-1">
                  <span className="text-slate-400 text-[10px] uppercase font-bold block flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px] text-amber-400">photo_library</span>
                    <span>Fotos de la pieza ({selectedOrder.yardCompatibility.referenceImages.length}) · Toca una foto para ampliar</span>
                  </span>
                  <YardPhotoGallery images={selectedOrder.yardCompatibility.referenceImages} maxThumbnails={4} />
                </div>
              ) : (
                <p className="text-slate-500 italic text-[11px]">
                  No hay fotos de referencia adjuntas.
                </p>
              )}
            </div>

            {/* Customer Details */}
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <span className="text-slate-400 uppercase font-bold text-[10px] block">Cliente</span>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white font-bold text-sm">{selectedOrder.customer?.name}</p>
                  <p className="text-slate-400">{selectedOrder.customer?.phone || 'Sin teléfono'}</p>
                </div>
                {selectedOrder.customer?.phone && (
                  <a
                    href={`tel:${selectedOrder.customer.phone}`}
                    className="px-3 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 font-bold"
                  >
                    <span className="material-symbols-outlined text-[16px]">call</span>
                    <span>Llamar</span>
                  </a>
                )}
              </div>
            </div>

            {/* Financial Summary */}
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
              <span className="text-slate-400 uppercase font-bold text-[10px] block">Información de Cobro</span>
              <div className="flex justify-between text-slate-300">
                <span>Precio pieza:</span>
                <span>${(selectedOrder.financials?.partPrice || 0).toFixed(2)} USD</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Anticipo cobrado:</span>
                <span className="text-emerald-400">${(selectedOrder.financials?.downPayment || 0).toFixed(2)} USD</span>
              </div>
              <div className="flex justify-between text-white font-bold border-t border-slate-800 pt-1">
                <span>Saldo por cobrar en patio:</span>
                <span className="text-amber-400 text-sm">
                  ${(selectedOrder.financials?.balanceDue ?? Math.max(0, (selectedOrder.financials?.partPrice || 0) - (selectedOrder.financials?.downPayment || 0))).toFixed(2)} USD
                </span>
              </div>
            </div>

            {/* Action buttons inside modal */}
            <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="px-4 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-white"
              >
                Cerrar
              </button>

              {!selectedOrder.yardPieceReady && (
                <button
                  type="button"
                  disabled={markingReadyId === selectedOrder.id}
                  onClick={() => handleMarkYardReady(selectedOrder)}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[16px]">check_circle</span>
                  <span>{markingReadyId === selectedOrder.id ? 'Marcando...' : 'Confirmar Pieza Lista en Patio'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation Bar (PWA / Mobile Web App style) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0d1424]/95 border-t border-amber-500/20 backdrop-blur-xl px-1.5 py-1.5 flex items-center justify-around shadow-[0_-5px_25px_rgba(0,0,0,0.6)] safe-bottom">
        {[
          { id: 'pending_yard', label: 'Pendientes', count: counts.pending_yard, icon: 'build_circle', color: 'text-amber-400' },
          { id: 'yard_ready', label: 'Listas', count: counts.yard_ready, icon: 'check_circle', color: 'text-emerald-400' },
          { id: 'claims', label: 'Reclamos', count: counts.claims, icon: 'report_problem', color: 'text-rose-400' },
          { id: 'yard_sales', label: 'Ventas', count: counts.yard_sales, icon: 'point_of_sale', color: 'text-cyan-400' },
          { id: 'all', label: 'Todas', count: counts.all, icon: 'list_alt', color: 'text-slate-300' },
        ].map((tab) => {
          const isActive = filterTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setFilterTab(tab.id as any);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className={`flex-1 flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all relative ${
                isActive
                  ? 'bg-amber-500/15 text-amber-300 font-bold shadow-[0_0_12px_rgba(245,158,11,0.2)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="relative">
                <span className={`material-symbols-outlined text-[22px] ${isActive ? tab.color : 'text-slate-400'}`}>
                  {tab.icon}
                </span>
                {tab.count > 0 && (
                  <span
                    className={`absolute -top-1 -right-2.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-mono font-bold flex items-center justify-center ${
                      isActive ? 'bg-amber-500 text-slate-950 font-black' : 'bg-slate-800 text-slate-300 border border-slate-700'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-mono mt-0.5 tracking-tight">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Cancel Order Admin Modal */}
      {isSuperAdmin && isCancelModalOpen && orderToCancel && (
        <CancelOrderModal
          order={orderToCancel}
          isOpen={isCancelModalOpen}
          isSuperAdmin={isSuperAdmin}
          onClose={() => {
            setIsCancelModalOpen(false);
            setOrderToCancel(null);
          }}
          onOrderCancelled={async (updatedOrder) => {
            if (onUpdateOrder) {
              await onUpdateOrder(updatedOrder);
            }
          }}
          onToast={showToast}
        />
      )}

      {/* Compatibility & Reference Images Admin Modal */}
      {isSuperAdmin && isCompatibilityModalOpen && orderForCompatibility && (
        <YardCompatibilityModal
          order={orderForCompatibility}
          isOpen={isCompatibilityModalOpen}
          onClose={() => {
            setIsCompatibilityModalOpen(false);
            setOrderForCompatibility(null);
          }}
          onSaved={(newCompat) => handleCompatibilitySaved(orderForCompatibility.id, newCompat)}
          onToast={showToast}
        />
      )}
    </div>
  );
};
