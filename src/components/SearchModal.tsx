import React, { useState, useEffect, useMemo, useRef, useDeferredValue } from 'react';
import { Order, NavScreen } from '../types';
import { ordersApi } from '../services/ordersApi';
import { mergeOrderSearchResults } from '../utils/orderSearch';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  orders: Order[];
  onSelectOrder: (orderId: string, order?: Order) => void;
  onNavigate: (screen: NavScreen) => void;
  userRole?: string;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  orders,
  onSelectOrder,
  onNavigate,
  userRole = 'operador',
}) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [serverOrders, setServerOrders] = useState<Order[]>([]);
  const [searchingServer, setSearchingServer] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setServerOrders([]);
    setSearchingServer(false);
    setSearchError(false);
    setActiveIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      restoreFocusRef.current?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    const trimmed = deferredQuery.trim();
    if (!isOpen || trimmed.length < 2) {
      setServerOrders([]);
      setSearchingServer(false);
      setSearchError(false);
      return;
    }
    let cancelled = false;
    setSearchingServer(true);
    setSearchError(false);
    const timer = window.setTimeout(() => {
      void ordersApi
        .search(trimmed, 30)
        .then((remote) => {
          if (!cancelled && Array.isArray(remote)) setServerOrders(remote);
        })
        .catch(() => {
          if (!cancelled) {
            setServerOrders([]);
            setSearchError(true);
          }
        })
        .finally(() => {
          if (!cancelled) setSearchingServer(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isOpen, deferredQuery, retryToken]);

  const filteredOrders = useMemo(
    () => mergeOrderSearchResults(orders, serverOrders, deferredQuery),
    [orders, serverOrders, deferredQuery],
  );

  const isSuperAdmin = userRole.toLowerCase() === 'admin';

  const quickNavs = useMemo<{ id: NavScreen; label: string; icon: string }[]>(
    () => [
      { id: 'dashboard', label: 'Panorama General (Dashboard)', icon: 'dashboard' },
      { id: 'taller', label: 'Lista de Órdenes', icon: 'inventory_2' },
      { id: 'mi_trabajo', label: 'Mi trabajo de hoy', icon: 'task_alt' },
      { id: 'crm', label: 'CRM Ventas & Clientes VIP', icon: 'person_search' },
      { id: 'reclamos', label: 'Reclamos', icon: 'error_outline' },
      { id: 'reembolsos', label: 'Reembolsos', icon: 'currency_exchange' },
      ...(isSuperAdmin
        ? [{ id: 'finanzas' as NavScreen, label: 'Finanzas & Relación Semanal', icon: 'payments' }]
        : []),
    ],
    [isSuperAdmin]
  );

  const totalItems = filteredOrders.length + quickNavs.length;

  useEffect(() => {
    if (!isOpen) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-search-item="${activeIndex}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isOpen]);

  if (!isOpen) return null;

  const selectOrder = (order: Order) => {
    onSelectOrder(order.id);
    onClose();
  };

  const selectNav = (nav: { id: NavScreen }) => {
    onNavigate(nav.id);
    onClose();
  };

  const handleDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (totalItems === 0) return;
      e.preventDefault();
      setActiveIndex((prev) =>
        e.key === 'ArrowDown' ? (prev + 1) % totalItems : (prev - 1 + totalItems) % totalItems
      );
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex < filteredOrders.length) {
        const order = filteredOrders[activeIndex];
        if (order) selectOrder(order);
      } else {
        const nav = quickNavs[activeIndex - filteredOrders.length];
        if (nav) selectNav(nav);
      }
      return;
    }

    if (e.key === 'Tab') {
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'input, button, [href], [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div
      className="horizon-modal fixed inset-0 z-50 flex items-start justify-center pt-6 sm:pt-12 p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Búsqueda global"
        onKeyDown={handleDialogKeyDown}
        className="bg-[#070c18] border border-cyan-500/30 rounded-3xl w-full max-w-2xl max-h-[min(88vh,620px)] shadow-[0_20px_60px_rgba(0,0,0,0.85)] overflow-hidden flex flex-col relative"
      >
        {/* Laser Hairline */}
        <div className="cyber-laser-bar absolute top-0 left-0 right-0 z-20" />

        {/* Search Bar Input */}
        <div className="p-3.5 sm:p-4 border-b border-cyan-500/20 flex items-center gap-3 bg-[#0a1022] shrink-0">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">search</span>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder="Buscar órdenes, clientes, piezas, VIN o módulos... (Cmd+K)"
            aria-label="Buscar órdenes, clientes o módulos"
            className="w-full bg-transparent text-slate-100 text-xs sm:text-sm focus:outline-none placeholder:text-slate-500 font-medium"
          />
          <kbd className="font-mono text-[10px] border border-cyan-500/30 rounded-md px-2 py-0.5 bg-cyan-950/40 text-cyan-300 font-bold shadow-inner">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="p-3.5 sm:p-4 flex-1 min-h-0 overflow-y-auto custom-scrollbar flex flex-col gap-3.5 text-xs"
        >
          {/* Orders Section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span
                role="status"
                aria-live="polite"
                className="text-[10px] text-cyan-400 uppercase tracking-wider font-mono font-bold flex items-center gap-1.5"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                Órdenes Coincidentes ({filteredOrders.length})
                {searchingServer ? ' · Buscando…' : ''}:
              </span>
              <span className="hidden sm:inline text-[10px] text-slate-500 font-mono">
                ↑↓ navegar · Enter abrir
              </span>
            </div>
            {searchError && (
              <div
                role="alert"
                className="mb-2 p-3 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-200 flex items-center justify-between gap-3"
              >
                <span>No se pudo consultar el servidor. Se muestran solo coincidencias locales.</span>
                <button
                  type="button"
                  onClick={() => setRetryToken((value) => value + 1)}
                  className="shrink-0 font-semibold underline underline-offset-2 hover:text-amber-100"
                >
                  Reintentar
                </button>
              </div>
            )}
            <div className="space-y-2">
              {filteredOrders.map((order, index) => {
                const isActive = index === activeIndex;
                return (
                  <button
                    type="button"
                    key={order.id}
                    data-search-item={index}
                    onClick={() => selectOrder(order)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`w-full text-left p-3 rounded-xl border flex items-center justify-between transition-all cursor-pointer group shadow-sm ${
                      isActive
                        ? 'bg-cyan-950/50 border-cyan-500/60'
                        : 'bg-[#090f1f] hover:bg-cyan-950/40 border-cyan-500/20 hover:border-cyan-500/50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="font-mono font-bold text-cyan-400 group-hover:text-cyan-300 transition-colors shrink-0">
                        #{order.code}
                      </span>
                      <span className="text-slate-200 font-semibold truncate">{order.customer.name}</span>
                      <span className="text-slate-400 text-[11px] truncate hidden sm:inline">
                        • {order.vehicle.make} {order.vehicle.model} ({order.vehicle.plate || order.mainPart})
                      </span>
                    </div>
                    <span className="font-mono text-emerald-400 font-bold text-xs shrink-0 ml-2">
                      ${order.financials.total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                    </span>
                  </button>
                );
              })}
              {filteredOrders.length === 0 && (
                <div className="p-6 text-center text-slate-500 bg-[#090f1f]/40 border border-slate-800 rounded-xl">
                  {searchingServer
                    ? 'Buscando órdenes…'
                    : searchError
                      ? 'Sin coincidencias locales. Reintenta la búsqueda en el servidor.'
                      : `No se encontraron órdenes para "${query}"`}
                </div>
              )}
            </div>
          </div>

          {/* Quick Navigation Section */}
          <div>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-2 font-mono font-bold">
              Módulos del Sistema:
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {quickNavs.map((nav, index) => {
                const itemIndex = filteredOrders.length + index;
                const isActive = itemIndex === activeIndex;
                return (
                  <button
                    type="button"
                    key={nav.id}
                    data-search-item={itemIndex}
                    onClick={() => selectNav(nav)}
                    onMouseEnter={() => setActiveIndex(itemIndex)}
                    className={`p-2.5 rounded-xl border flex items-center gap-2.5 text-left text-slate-200 transition-all cursor-pointer group ${
                      isActive
                        ? 'bg-cyan-950/50 border-cyan-500/60'
                        : 'bg-[#090f1f] hover:bg-cyan-950/40 border-cyan-500/20 hover:border-cyan-500/50'
                    }`}
                  >
                    <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 group-hover:text-cyan-300 shrink-0">
                      <span aria-hidden="true" className="material-symbols-outlined text-[17px]">
                        {nav.icon}
                      </span>
                    </div>
                    <span className="truncate text-xs font-medium">{nav.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
