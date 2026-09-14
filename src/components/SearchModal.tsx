import React, { useState, useEffect } from 'react';
import { Order, NavScreen } from '../types';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  orders: Order[];
  onSelectOrder: (orderId: string) => void;
  onNavigate: (screen: NavScreen) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  orders,
  onSelectOrder,
  onNavigate,
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

  const quickNavs: { id: NavScreen; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Panorama General (Dashboard)', icon: 'dashboard' },
    { id: 'taller', label: 'Mesa Central de Gestión de Órdenes', icon: 'build' },
    { id: 'crm', label: 'CRM Ventas & Clientes VIP', icon: 'person_search' },
    { id: 'inventario', label: 'Inventario de Vehículos y Stock', icon: 'directions_car' },
    { id: 'finanzas', label: 'Finanzas & Facturación', icon: 'payments' },
    { id: 'reportes', label: 'Reportes y Analíticas de SLAs', icon: 'analytics' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/75 backdrop-blur-md">
      <div className="bg-[#181b25] border border-[rgba(255,255,255,0.12)] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Search Bar Input */}
        <div className="p-4 border-b border-[rgba(255,255,255,0.08)] flex items-center gap-3 bg-[#1c1f29]">
          <span className="material-symbols-outlined text-[#4d8eff] text-[22px]">search</span>
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar órdenes, clientes, piezas, placas, VIN o módulos..."
            className="w-full bg-transparent text-[#dfe2ef] text-sm focus:outline-none placeholder:text-[#c2c6d6]/60"
          />
          <kbd className="font-data-mono text-[10px] border border-[rgba(255,255,255,0.15)] rounded px-1.5 py-0.5 bg-[#31353f] text-[#c2c6d6]">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="p-4 max-h-[60vh] overflow-y-auto flex flex-col gap-4 text-xs">
          {/* Orders Section */}
          <div>
            <span className="font-data-label text-[10px] text-[#adc6ff] uppercase tracking-wider block mb-2 font-semibold">
              Órdenes Registradas ({filteredOrders.length}):
            </span>
            <div className="space-y-1.5">
              {filteredOrders.map((order) => (
                <div
                  key={order.id}
                  onClick={() => {
                    onSelectOrder(order.id);
                    onClose();
                  }}
                  className="p-2.5 rounded-lg bg-[#0a0e17] hover:bg-[#31353f]/60 border border-[rgba(255,255,255,0.06)] flex items-center justify-between transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="font-data-mono font-bold text-[#4d8eff] group-hover:underline">
                      #{order.code}
                    </span>
                    <span className="text-[#dfe2ef] font-medium">{order.customer.name}</span>
                    <span className="text-[#c2c6d6] text-[11px]">
                      • {order.vehicle.make} {order.vehicle.model} ({order.vehicle.plate})
                    </span>
                  </div>
                  <span className="font-data-mono text-[#4edea3] font-semibold">
                    ${order.financials.total.toLocaleString('es-MX')}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Navigation Section */}
          <div>
            <span className="font-data-label text-[10px] text-[#c2c6d6] uppercase tracking-wider block mb-2 font-semibold">
              Módulos del Sistema:
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {quickNavs.map((nav) => (
                <button
                  key={nav.id}
                  onClick={() => {
                    onNavigate(nav.id);
                    onClose();
                  }}
                  className="p-2.5 rounded-lg bg-[#0a0e17] hover:bg-[#31353f]/60 border border-[rgba(255,255,255,0.06)] flex items-center gap-2 text-left text-[#dfe2ef] transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px] text-[#adc6ff]">
                    {nav.icon}
                  </span>
                  <span className="truncate">{nav.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
