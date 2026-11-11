import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Order, OrderStatus, YardCompatibility } from '../types';
import { apiFetch } from '../services/apiFetch';
import { CancelOrderModal } from './CancelOrderModal';
import { YardCompatibilityModal } from './YardCompatibilityModal';
import { YardPhotoGallery } from './YardPhotoGallery';
import { expandYearRangesInText } from '../utils/compatibilityFormat';

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
  const [copiedVin, setCopiedVin] = useState(false);

  // Pull-to-refresh mobile gesture state
  const [pullStartY, setPullStartY] = useState(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Bottom-sheet swipe-down to dismiss gesture state
  const [sheetStartY, setSheetStartY] = useState(0);
  const [sheetTranslateY, setSheetTranslateY] = useState(0);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const triggerHaptic = (ms = 15) => {
    if (typeof window !== 'undefined' && 'navigator' in window && navigator.vibrate) {
      try {
        navigator.vibrate(ms);
      } catch {
        // Ignore haptic failures
      }
    }
  };

  // Close detail with Android back button synchronization
  const handleCloseDetail = useCallback(() => {
    triggerHaptic(10);
    if (window.history.state?.modal === 'yard-order-detail') {
      window.history.back();
    } else {
      setSelectedOrder(null);
    }
  }, []);

  // Handle hardware / gesture back button on Android
  useEffect(() => {
    if (selectedOrder) {
      window.history.pushState({ modal: 'yard-order-detail' }, '');
      const handlePopState = () => {
        setSelectedOrder(null);
      };
      window.addEventListener('popstate', handlePopState);
      return () => {
        window.removeEventListener('popstate', handlePopState);
      };
    }
  }, [selectedOrder]);

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

  // Solo órdenes pagadas o con reclamos deben aparecer en esta vista
  const isYardEligible = (o: Order) => o.status === 'pagado' || o.status === 'reclamo';

  const eligibleOrders = useMemo(() => {
    return orders.filter(isYardEligible);
  }, [orders]);

  // Filtrado de órdenes
  const filteredOrders = useMemo(() => {
    let result = eligibleOrders;

    if (filterTab === 'pending_yard') {
      result = result.filter((o) => o.status === 'pagado' && !o.yardPieceReady);
    } else if (filterTab === 'yard_ready') {
      result = result.filter((o) => o.status === 'pagado' && Boolean(o.yardPieceReady));
    } else if (filterTab === 'claims') {
      result = result.filter((o) => o.status === 'reclamo');
    } else if (filterTab === 'yard_sales') {
      result = result.filter((o) => Boolean(o.isYardSale || o.advisorRole === 'vendedor_yarda'));
    }

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

  // Contadores para pestañas
  const counts = useMemo(() => {
    return {
      all: eligibleOrders.length,
      pending_yard: eligibleOrders.filter((o) => o.status === 'pagado' && !o.yardPieceReady).length,
      yard_ready: eligibleOrders.filter((o) => o.status === 'pagado' && Boolean(o.yardPieceReady)).length,
      claims: eligibleOrders.filter((o) => o.status === 'reclamo').length,
      yard_sales: eligibleOrders.filter((o) => Boolean(o.isYardSale || o.advisorRole === 'vendedor_yarda')).length,
    };
  }, [eligibleOrders]);

  // Confirmar pieza lista en patio
  const handleMarkYardReady = async (order: Order) => {
    setMarkingReadyId(order.id);
    triggerHaptic(20);
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
          ? `¡Pieza #${order.code} lista! Se limpiaron ${data.cleanedImagesCount} fotos para liberar espacio.`
          : `¡Pieza #${order.code} confirmada como lista en patio!`
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al marcar pieza en yarda');
    } finally {
      setMarkingReadyId(null);
    }
  };

  // Copiar VIN al portapapeles
  const handleCopyVin = (vinText?: string) => {
    if (!vinText) return;
    navigator.clipboard.writeText(vinText);
    setCopiedVin(true);
    triggerHaptic(15);
    setTimeout(() => setCopiedVin(false), 2000);
  };

  // Pull-to-refresh touch handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY === 0) {
      setPullStartY(e.touches[0].clientY);
    } else {
      setPullStartY(0);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (pullStartY > 0 && window.scrollY === 0) {
      const currentY = e.touches[0].clientY;
      const diff = currentY - pullStartY;
      if (diff > 0) {
        setPullDistance(Math.min(diff * 0.4, 85));
      }
    }
  };

  const handleTouchEnd = async () => {
    if (pullDistance >= 60 && onRefreshOrders && !isRefreshing) {
      setIsRefreshing(true);
      triggerHaptic(25);
      try {
        await onRefreshOrders();
        showToast('Órdenes actualizadas');
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
        setPullStartY(0);
      }
    } else {
      setPullDistance(0);
      setPullStartY(0);
    }
  };

  // Bottom Sheet drag handlers (Swipe down to dismiss)
  const handleSheetTouchStart = (e: React.TouchEvent) => {
    setSheetStartY(e.touches[0].clientY);
  };

  const handleSheetTouchMove = (e: React.TouchEvent) => {
    if (sheetStartY > 0) {
      const diff = e.touches[0].clientY - sheetStartY;
      if (diff > 0) {
        setSheetTranslateY(diff);
      }
    }
  };

  const handleSheetTouchEnd = () => {
    if (sheetTranslateY > 110) {
      handleCloseDetail();
    }
    setSheetTranslateY(0);
    setSheetStartY(0);
  };

  return (
    <div
      className="yard-mobile-shell min-h-screen min-h-[100dvh] bg-[#070b14] text-slate-100 flex flex-col font-sans select-none antialiased"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 rounded-2xl bg-emerald-500 text-slate-950 font-black px-4 py-3 text-xs font-mono shadow-[0_10px_30px_rgba(16,185,129,0.4)] flex items-center gap-2 animate-sheet-up border border-emerald-400">
          <span className="material-symbols-outlined text-[20px]">check_circle</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Pull-to-refresh Visual Indicator */}
      {pullDistance > 0 && (
        <div
          style={{ height: `${pullDistance}px` }}
          className="flex items-center justify-center overflow-hidden transition-all duration-75 bg-[#0d1424]/90 border-b border-amber-500/20"
        >
          <div className="flex items-center gap-2 text-xs font-mono font-bold text-amber-400">
            <span
              className="material-symbols-outlined text-[22px] transition-transform"
              style={{ transform: `rotate(${pullDistance * 4}deg)` }}
            >
              autorenew
            </span>
            <span>{pullDistance >= 60 ? 'Suelta para actualizar' : 'Desliza para actualizar'}</span>
          </div>
        </div>
      )}

      {/* App Bar / Header Nativo con Safe Areas */}
      <header className="sticky top-0 z-40 bg-[#0d1424]/95 border-b border-amber-500/20 backdrop-blur-xl px-4 py-2.5 safe-top-padded flex items-center justify-between shadow-md">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center shadow-[0_0_15px_rgba(245,158,11,0.2)]">
            <span className="material-symbols-outlined text-[22px]">agriculture</span>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-black text-base tracking-tight text-white">RADAR</span>
              <span className="px-1.5 py-0.2 rounded-md bg-amber-500/20 text-amber-400 border border-amber-500/40 text-[9px] font-mono font-black uppercase tracking-wider">
                YARDA
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-slate-400 font-mono">
                {currentUser?.name ? currentUser.name.split(' ')[0] : 'Operador'} · En línea
              </span>
            </div>
          </div>
        </div>

        {/* Action icons right */}
        <div className="flex items-center gap-1.5">
          {/* Admin badge if Super Admin */}
          {isSuperAdmin && (
            <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-[10px] font-mono font-bold">
              <span className="material-symbols-outlined text-[14px] text-red-400">admin_panel_settings</span>
              <span>Admin</span>
            </div>
          )}

          {/* Manual Refresh button */}
          {onRefreshOrders && (
            <button
              type="button"
              onClick={async () => {
                triggerHaptic(10);
                setIsRefreshing(true);
                try {
                  await onRefreshOrders();
                  showToast('Órdenes actualizadas');
                } finally {
                  setIsRefreshing(false);
                }
              }}
              title="Actualizar datos"
              className="w-9 h-9 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-all flex items-center justify-center active:scale-95 touch-manipulation cursor-pointer"
            >
              <span className={`material-symbols-outlined text-[19px] ${isRefreshing ? 'animate-spin text-amber-400' : ''}`}>
                refresh
              </span>
            </button>
          )}

          {/* Switch to Office if admin */}
          {isSuperAdmin && (
            <button
              type="button"
              onClick={onToggleOffice ? onToggleOffice : () => { window.location.href = 'http://localhost:3000'; }}
              title="Ir a Radar Oficina"
              className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 text-[11px] font-mono font-bold transition-all active:scale-95 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">domain</span>
              <span>Oficina</span>
            </button>
          )}

          {/* Logout button */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic(10);
              onLogout();
            }}
            title="Cerrar sesión"
            className="w-9 h-9 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 transition-all flex items-center justify-center active:scale-95 touch-manipulation cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">logout</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-3 sm:p-5 space-y-3.5 pb-28">
        
        {/* Search Bar Spotlight */}
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por pallet, orden #, VIN o pieza..."
            className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 pl-11 pr-10 py-3 text-xs sm:text-sm text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none font-mono shadow-sm transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                triggerHaptic(10);
                setSearchQuery('');
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
            >
              <span className="material-symbols-outlined text-[18px]">cancel</span>
            </button>
          )}
        </div>

        {/* Quick Horizontal Filter Pills */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5 text-xs font-mono">
          {[
            { id: 'pending_yard', label: 'Por Preparar', count: counts.pending_yard, icon: 'build_circle' },
            { id: 'yard_ready', label: 'Listas en Patio', count: counts.yard_ready, icon: 'check_circle' },
            { id: 'claims', label: 'Reclamos', count: counts.claims, icon: 'report_problem' },
            { id: 'yard_sales', label: 'Ventas Patio', count: counts.yard_sales, icon: 'point_of_sale' },
            { id: 'all', label: 'Todas', count: counts.all, icon: 'list_alt' },
          ].map((tab) => {
            const isActive = filterTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  setFilterTab(tab.id as any);
                }}
                className={`px-3 py-2 rounded-xl border font-bold flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer active:scale-95 ${
                  isActive
                    ? 'border-amber-500 bg-amber-500/20 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.25)]'
                    : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-white'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
                <span>{tab.label}</span>
                <span
                  className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                    isActive
                      ? 'bg-amber-500 text-slate-950 font-black'
                      : 'bg-slate-800 border border-slate-700 text-slate-300'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Orders Feed */}
        {filteredOrders.length === 0 ? (
          <div className="bg-[#0d1424] border border-slate-800 rounded-2xl p-8 text-center space-y-3 shadow-sm">
            <span className="material-symbols-outlined text-5xl text-slate-600">inbox</span>
            <p className="text-sm font-mono text-slate-400">No hay órdenes que coincidan con los filtros seleccionados.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredOrders.map((order) => {
              const isReadyInYard = Boolean(order.yardPieceReady);
              const refImages = order.yardCompatibility?.referenceImages || [];

              return (
                <div
                  key={order.id}
                  onClick={() => {
                    triggerHaptic(10);
                    setSelectedOrder(order);
                  }}
                  className={`group rounded-2xl border transition-all p-4 bg-[#0d1424] active:scale-[0.98] touch-manipulation cursor-pointer shadow-md ${
                    isReadyInYard
                      ? 'border-emerald-500/40 bg-gradient-to-br from-[#0d1424] to-emerald-950/20'
                      : 'border-slate-800 hover:border-amber-500/50'
                  }`}
                >
                  <div className="space-y-3">
                    
                    {/* Header Card: Order # + Status Badge */}
                    <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-amber-400 font-mono font-black text-base tracking-wide">
                          #{order.code}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">
                          {order.createdAt}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {order.status === 'reclamo' ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider border border-rose-500/50 bg-rose-500/20 text-rose-300 flex items-center gap-1 shadow-[0_0_10px_rgba(244,63,94,0.25)]">
                            <span className="material-symbols-outlined text-[14px]">report_problem</span>
                            RECLAMO
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider border border-emerald-500/40 bg-emerald-500/20 text-emerald-300 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px]">check_circle</span>
                            PAGADO
                          </span>
                        )}
                        {(order.isYardSale || order.advisorRole === 'vendedor_yarda') && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            🚜 Patio
                          </span>
                        )}
                      </div>
                    </div>

                    {/* PALLET / UBICACIÓN: EL DATO MÁS IMPORTANTE PARA EL PATIO */}
                    <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-amber-500/15 border-2 border-amber-500/50 shadow-sm">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-amber-400 text-[20px]">shelves</span>
                        <span className="text-[11px] font-mono font-bold uppercase text-amber-300">
                          Ubicación / Pallet:
                        </span>
                      </div>
                      <span className="text-sm sm:text-base font-black font-mono text-white tracking-wider bg-amber-500/30 px-3 py-0.5 rounded-lg border border-amber-400/50">
                        {order.stockNumber ? order.stockNumber.toUpperCase() : 'PENDIENTE'}
                      </span>
                    </div>

                    {/* PIEZA Y VEHÍCULO */}
                    <div>
                      <h3 className="font-black text-white text-base sm:text-lg leading-snug tracking-tight">
                        {order.mainPart}
                      </h3>
                      <p className="text-sm font-bold text-amber-300/90 font-mono mt-0.5">
                        {order.vehicle?.year} {order.vehicle?.make} {order.vehicle?.model} {order.vehicle?.trim}
                      </p>
                    </div>

                    {/* CHIPS DE ESPECIFICACIÓN TÉCNICA */}
                    <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-mono">
                      {order.vehicle?.transmission && (
                        <span className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-700 text-slate-300 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[12px] text-cyan-400">settings</span>
                          <span>{order.vehicle.transmission}</span>
                        </span>
                      )}
                      {order.vehicle?.vin && (
                        <span className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-700 text-slate-400 flex items-center gap-1">
                          <span className="text-slate-500">VIN:</span>
                          <span>{order.vehicle.vin.slice(-8)}</span>
                        </span>
                      )}
                      {order.yardCompatibility?.compatibilityList && (
                        <span className="px-2 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[12px]">swap_horiz</span>
                          <span>Compatible</span>
                        </span>
                      )}
                    </div>

                    {/* DESCRIPCIÓN RÁPIDA DE LA REFACCIÓN */}
                    {order.productSpecs && (
                      <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] font-mono text-slate-300">
                        <span className="text-slate-400 block text-[9.5px] uppercase font-bold mb-0.5">Descripción:</span>
                        <p className="line-clamp-2 leading-relaxed italic">{order.productSpecs}</p>
                      </div>
                    )}

                    {/* TIRA DE FOTOS VISIBLE DIRECTAMENTE EN LA TARJETA */}
                    {refImages.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                          <span className="flex items-center gap-1 text-amber-400 font-bold">
                            <span className="material-symbols-outlined text-[15px]">photo_library</span>
                            <span>Fotos de la pieza ({refImages.length})</span>
                          </span>
                          <span className="text-[10px] text-slate-500">Toca para abrir detalle</span>
                        </div>
                        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
                          {refImages.slice(0, 4).map((url, idx) => (
                            <div
                              key={idx}
                              className="relative w-16 h-16 rounded-xl overflow-hidden border border-amber-500/30 bg-slate-950 flex-shrink-0 shadow-sm"
                            >
                              <img src={url} alt={`Foto ${idx + 1}`} className="w-full h-full object-cover" />
                              {idx === 3 && refImages.length > 4 && (
                                <div className="absolute inset-0 bg-black/70 flex items-center justify-center font-bold text-xs text-amber-300 font-mono">
                                  +{refImages.length - 4}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* BOTÓN DE ACCIÓN: CONFIRMAR PIEZA LISTA */}
                    <div className="pt-2">
                      {!isReadyInYard ? (
                        <button
                          type="button"
                          disabled={markingReadyId === order.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMarkYardReady(order);
                          }}
                          className="w-full min-h-[48px] py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(245,158,11,0.25)] transition-all cursor-pointer active:scale-95"
                        >
                          <span className="material-symbols-outlined text-[18px]">build_circle</span>
                          <span>{markingReadyId === order.id ? 'Confirmando...' : 'Confirmar Pieza Lista en Patio'}</span>
                        </button>
                      ) : (
                        <div className="w-full py-2.5 px-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-mono font-bold text-xs flex items-center justify-center gap-2">
                          <span className="material-symbols-outlined text-[18px] text-emerald-400">check_circle</span>
                          <span>Pieza Confirmada Lista en Patio</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* DETALLE DE ORDEN: NATIVE MOBILE BOTTOM SHEET */}
      {selectedOrder && (
        <div className="horizon-modal fixed inset-0 z-50 flex flex-col justify-end bg-black/85 backdrop-blur-md animate-fade-in font-mono">
          <div
            style={{
              transform: sheetTranslateY > 0 ? `translateY(${sheetTranslateY}px)` : undefined,
              transition: sheetTranslateY > 0 ? 'none' : 'transform 0.2s ease-out',
            }}
            className="bg-[#0d1424] border-t-2 border-x border-amber-500/40 rounded-t-3xl max-h-[92dvh] w-full max-w-2xl mx-auto flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.85)] animate-sheet-up"
          >
            {/* Grabber Bar con Soporte de Deslizamiento hacia Abajo */}
            <div
              onTouchStart={handleSheetTouchStart}
              onTouchMove={handleSheetTouchMove}
              onTouchEnd={handleSheetTouchEnd}
              className="pt-3 pb-1 cursor-grab active:cursor-grabbing flex flex-col items-center select-none"
            >
              <div className="w-12 h-1.5 rounded-full bg-slate-600 hover:bg-amber-400 transition-colors" />
            </div>

            {/* Header del Bottom Sheet con Botones de Salida Claros */}
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              {/* Botón Atrás Superior Izquierdo */}
              <button
                type="button"
                onClick={handleCloseDetail}
                className="px-3 py-1.5 rounded-xl bg-slate-800/90 border border-slate-700 text-slate-200 hover:text-white flex items-center gap-1 font-bold text-xs active:scale-95 transition-all cursor-pointer shadow-sm"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                <span>Atrás</span>
              </button>

              <div className="text-center">
                <span className="text-amber-400 font-black text-base">#{selectedOrder.code}</span>
                <p className="text-[10px] text-slate-400">Detalle de Patio</p>
              </div>

              {/* Botón Cerrar Superior Derecho */}
              <button
                type="button"
                onClick={handleCloseDetail}
                className="w-8 h-8 rounded-full bg-slate-800/90 border border-slate-700 text-slate-300 hover:text-white flex items-center justify-center active:scale-95 transition-all cursor-pointer shadow-sm"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {/* Contenido Desplazable del Detalle */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar text-xs">
              
              {/* Detalle de Reclamo Activo (si aplica) */}
              {selectedOrder.status === 'reclamo' && (
                <div className="p-3.5 rounded-2xl bg-rose-950/50 border border-rose-500/50 space-y-2">
                  <div className="flex items-center gap-2 text-rose-400 font-bold text-xs uppercase">
                    <span className="material-symbols-outlined text-[18px]">report_problem</span>
                    <span>Reclamo Activo Urgente</span>
                  </div>
                  {selectedOrder.claimReason && (
                    <div className="bg-rose-900/30 p-2.5 rounded-xl border border-rose-500/30 text-rose-200">
                      <strong className="text-rose-300 block text-[10px] uppercase mb-0.5">Motivo del reclamo:</strong>
                      <p className="text-xs">{selectedOrder.claimReason}</p>
                    </div>
                  )}
                  {selectedOrder.notes && (
                    <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800 text-slate-300">
                      <strong className="text-slate-400 block text-[10px] uppercase mb-0.5">Notas adicionales:</strong>
                      <p className="text-xs">{selectedOrder.notes}</p>
                    </div>
                  )}
                </div>
              )}

              {/* UBICACIÓN Y PALLET DESTACADO */}
              <div className="p-4 rounded-2xl bg-amber-500/15 border-2 border-amber-500/50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-amber-300 uppercase flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[18px] text-amber-400">shelves</span>
                    <span>Ubicación en Patio / Pallet</span>
                  </span>
                  <span className="text-base font-black text-white bg-amber-500/40 px-3 py-1 rounded-xl border border-amber-400/50">
                    {selectedOrder.stockNumber ? selectedOrder.stockNumber.toUpperCase() : 'PENDIENTE'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Asesor responsable: <strong className="text-slate-200">{selectedOrder.advisor || 'Sin asignar'}</strong>
                </p>
              </div>

              {/* VEHÍCULO Y PIEZA */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <span className="text-slate-400 uppercase font-bold text-[10px] block">Vehículo y Pieza</span>
                <div>
                  <h2 className="text-lg text-white font-black">{selectedOrder.mainPart}</h2>
                  <p className="text-amber-300 font-bold text-sm mt-0.5">
                    {selectedOrder.vehicle?.year} {selectedOrder.vehicle?.make} {selectedOrder.vehicle?.model} {selectedOrder.vehicle?.trim}
                  </p>
                </div>

                {/* VIN con botón de copiado rápido */}
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="text-[11px] text-slate-300">
                    <span className="text-slate-500 block text-[9.5px]">VIN:</span>
                    <strong className="font-mono">{selectedOrder.vehicle?.vin || 'No registrado'}</strong>
                  </div>
                  {selectedOrder.vehicle?.vin && (
                    <button
                      type="button"
                      onClick={() => handleCopyVin(selectedOrder.vehicle?.vin)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold flex items-center gap-1 active:scale-95 transition-all cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {copiedVin ? 'check' : 'content_copy'}
                      </span>
                      <span>{copiedVin ? '¡Copiado!' : 'Copiar VIN'}</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 text-slate-300 text-[11px]">
                  <div>Transmisión: <strong>{selectedOrder.vehicle?.transmission || 'N/D'}</strong></div>
                  <div>Garantía: <strong>{selectedOrder.warrantyDays || 60} días</strong></div>
                </div>

                {selectedOrder.productSpecs && (
                  <div className="space-y-1 pt-1 border-t border-slate-800">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Descripción Técnica:</span>
                    <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono whitespace-pre-line leading-relaxed shadow-inner">
                      {selectedOrder.productSpecs}
                    </div>
                  </div>
                )}
              </div>

              {/* FOTOS DE REFERENCIA Y COMPATIBILIDAD */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-amber-500/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-amber-400 font-bold text-xs uppercase">
                    <span className="material-symbols-outlined text-[18px]">photo_library</span>
                    <span>Fotos de la Pieza & Compatibilidad</span>
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

                {/* Galería de fotos con zoom táctil */}
                {selectedOrder.yardCompatibility?.referenceImages && selectedOrder.yardCompatibility.referenceImages.length > 0 ? (
                  <div className="space-y-2">
                    <span className="text-slate-400 text-[10px] uppercase font-bold block">
                      Fotos adjuntas ({selectedOrder.yardCompatibility.referenceImages.length}) · Toca una foto para ampliar con zoom
                    </span>
                    <YardPhotoGallery images={selectedOrder.yardCompatibility.referenceImages} maxThumbnails={4} />
                  </div>
                ) : (
                  <p className="text-slate-500 italic text-[11px]">
                    No hay fotos de referencia adjuntas para esta orden.
                  </p>
                )}

                {/* Modelos compatibles */}
                {selectedOrder.yardCompatibility?.compatibilityList ? (
                  <div className="space-y-1.5 pt-2 border-t border-slate-800">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">
                      Modelos y Años Compatibles:
                    </span>
                    <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs font-mono whitespace-pre-line leading-relaxed shadow-inner">
                      {expandYearRangesInText(selectedOrder.yardCompatibility.compatibilityList)}
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-500 italic text-[11px] pt-1">
                    No se ha registrado lista de compatibilidad para esta refacción.
                  </p>
                )}
              </div>
            </div>

            {/* Barra de Acciones Fija al fondo del Bottom Sheet */}
            <div className="sticky bottom-0 bg-[#0d1424] border-t border-slate-800 px-4 py-3 safe-bottom-padded flex items-center gap-2.5 shadow-lg">
              {/* Botón Salir / Volver Secundario abajo (al alcance del pulgar) */}
              <button
                type="button"
                onClick={handleCloseDetail}
                className="py-3 px-3.5 rounded-xl border border-slate-700 bg-slate-800/90 text-slate-300 hover:text-white font-mono font-bold text-xs flex items-center justify-center gap-1 active:scale-95 transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                <span>Volver</span>
              </button>

              {/* Botón Cancelar (Super Admin) */}
              {isSuperAdmin && selectedOrder.status !== 'cancelado' && (
                <button
                  type="button"
                  onClick={() => {
                    const toCancel = selectedOrder;
                    setSelectedOrder(null);
                    setOrderToCancel(toCancel);
                    setIsCancelModalOpen(true);
                  }}
                  title="Cancelar orden"
                  className="py-3 px-3 rounded-xl border border-red-500/40 bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs font-mono font-bold flex items-center justify-center gap-1 active:scale-95 transition-all cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">block</span>
                </button>
              )}

              {/* Botón Confirmar Pieza Lista (Primario) */}
              {!selectedOrder.yardPieceReady ? (
                <button
                  type="button"
                  disabled={markingReadyId === selectedOrder.id}
                  onClick={() => handleMarkYardReady(selectedOrder)}
                  className="flex-1 py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(245,158,11,0.3)] active:scale-95 transition-all cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px]">check_circle</span>
                  <span>{markingReadyId === selectedOrder.id ? 'Marcando...' : 'Confirmar Pieza Lista en Patio'}</span>
                </button>
              ) : (
                <div className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono font-bold text-xs flex items-center justify-center gap-1.5">
                  <span className="material-symbols-outlined text-[18px] text-emerald-400">check_circle</span>
                  <span>Pieza Lista en Patio</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab Bar Inferior Ergonómico (iOS / Android PWA Style) */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[#0d1424]/95 border-t border-amber-500/20 backdrop-blur-xl px-1.5 py-1.5 flex items-center justify-around shadow-[0_-5px_25px_rgba(0,0,0,0.7)] safe-bottom-padded">
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
                triggerHaptic(10);
                setFilterTab(tab.id as any);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className={`flex-1 flex flex-col items-center justify-center py-2 px-1 rounded-2xl transition-all relative active:scale-95 touch-manipulation cursor-pointer ${
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

      {/* Cancel Order Modal */}
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

      {/* Compatibility & Reference Images Modal */}
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
