import React, { useState, useEffect } from 'react';
import { Order, NavScreen } from '../types';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  orders: Order[];
  onSelectOrder: (orderId: string) => void;
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

  if (!isOpen) return null;

  const filteredOrders = query.trim()
    ? orders.filter(
        (o) =>
          o.code.toLowerCase().includes(query.toLowerCase()) ||
          o.customer.name.toLowerCase().includes(query.toLowerCase()) ||
          o.vehicle.make.toLowerCase().includes(query.toLowerCase()) ||
          o.vehicle.model.toLowerCase().includes(query.toLowerCase()) ||
          o.vehicle.plate.toLowerCase().includes(query.toLowerCase()) ||
          o.mainPart.toLowerCase().includes(query.toLowerCase())
      )
    : orders.slice(0, 4);

  const isSuperAdmin = userRole.toLowerCase() === 'admin';

  const quickNavs: { id: NavScreen; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Panorama General (Dashboard)', icon: 'dashboard' },
    { id: 'taller', label: 'Mesa Central de Gestión de Órdenes', icon: 'build' },
    { id: 'crm', label: 'CRM Ventas & Clientes VIP', icon: 'person_search' },
    ...(isSuperAdmin
      ? [{ id: 'finanzas' as NavScreen, label: 'Finanzas & Relación Semanal', icon: 'payments' }]
      : []),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/85 backdrop-blur-xl animate-fade-in">
      <div className="bg-[#070c18]/95 backdrop-blur-2xl border border-cyan-500/30 rounded-3xl w-full max-w-2xl shadow-[0_20px_60px_rgba(0,0,0,0.85)] overflow-hidden flex flex-col relative">
        {/* Laser Hairline */}
        <div className="cyber-laser-bar absolute top-0 left-0 right-0 z-20" />

        {/* Search Bar Input */}
        <div className="p-4.5 border-b border-cyan-500/20 flex items-center gap-3 bg-[#0a1022]/80 backdrop-blur-md">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
            <span className="material-symbols-outlined text-[20px]">search</span>
          </div>
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar órdenes, clientes, piezas, VIN o módulos... (Cmd+K)"
            className="w-full bg-transparent text-slate-100 text-sm focus:outline-none placeholder:text-slate-500 font-medium"
          />
          <kbd className="font-mono text-[10px] border border-cyan-500/30 rounded-md px-2 py-0.5 bg-cyan-950/40 text-cyan-300 font-bold shadow-inner">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="p-4.5 max-h-[60vh] overflow-y-auto custom-scrollbar flex flex-col gap-4 text-xs">
          {/* Orders Section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-cyan-400 uppercase tracking-wider font-mono font-bold flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                Órdenes Registradas ({filteredOrders.length}):
              </span>
            </div>
            <div className="space-y-2">
              {filteredOrders.map((order) => (
                <div
                  key={order.id}
                  onClick={() => {
                    onSelectOrder(order.id);
                    onClose();
                  }}
                  className="p-3 rounded-xl bg-[#090f1f]/80 hover:bg-cyan-950/30 border border-cyan-500/20 hover:border-cyan-500/50 flex items-center justify-between transition-all cursor-pointer group shadow-sm"
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
                </div>
              ))}
              {filteredOrders.length === 0 && (
                <div className="p-6 text-center text-slate-500 bg-[#090f1f]/40 border border-slate-800 rounded-xl">
                  No se encontraron órdenes para "{query}"
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
              {quickNavs.map((nav) => (
                <button
                  key={nav.id}
                  onClick={() => {
                    onNavigate(nav.id);
                    onClose();
                  }}
                  className="p-2.5 rounded-xl bg-[#090f1f]/80 hover:bg-cyan-950/30 border border-cyan-500/20 hover:border-cyan-500/50 flex items-center gap-2.5 text-left text-slate-200 transition-all cursor-pointer group"
                >
                  <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 group-hover:text-cyan-300 shrink-0">
                    <span className="material-symbols-outlined text-[17px]">
                      {nav.icon}
                    </span>
                  </div>
                  <span className="truncate text-xs font-medium">{nav.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
