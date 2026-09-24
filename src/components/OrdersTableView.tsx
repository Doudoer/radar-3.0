import React, { useState, useMemo } from 'react';
import { Order, OrderStatus, OrderSegmentView } from '../types';

interface OrdersTableViewProps {
  orders: Order[];
  onSelectOrder: (orderId: string) => void;
  onOpenNewOrder: () => void;
  onEditOrder?: (order: Order) => void;
  onExport: () => void;
  onStatusRequest: () => void;
  onUpdateStatus?: (orderId: string, newStatus: OrderStatus) => void;
}

export const OrdersTableView: React.FC<OrdersTableViewProps> = ({
  orders,
  onSelectOrder,
  onOpenNewOrder,
  onEditOrder,
  onExport,
  onStatusRequest,
  onUpdateStatus,
}) => {
  const [segmentView, setSegmentView] = useState<OrderSegmentView>('active');
  const [subFilterStatus, setSubFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [activeActionMenu, setActiveActionMenu] = useState<string | null>(null);

  // Helper to check if an order's warranty is expired
  const isWarrantyExpired = (order: Order): boolean => {
    if (order.status !== 'entregado') return false;
    if (!order.deliveredAt) return false;
    const deliveredDate = new Date(order.deliveredAt).getTime();
    const daysSinceDelivery = (Date.now() - deliveredDate) / (1000 * 60 * 60 * 24);
    const limit = order.warrantyDays || 60;
    return daysSinceDelivery > limit;
  };

  // Segment Counts
  const counts = useMemo(() => {
    let active = 0;
    let readyPickup = 0;
    let expiredWarranty = 0;
    let cancelled = 0;
    let refunds = 0;
    let archived = 0;

    orders.forEach((o) => {
      if (o.status === 'listo_retiro') {
        readyPickup++;
      }
      if (o.status === 'archivado') {
        archived++;
      } else if (o.status === 'cancelado') {
        cancelled++;
      } else if (o.status === 'solicitud_reembolso' || o.status === 'reembolsado') {
        refunds++;
      } else if (isWarrantyExpired(o)) {
        expiredWarranty++;
      } else {
        active++;
      }
    });

    return { active, readyPickup, expiredWarranty, cancelled, refunds, archived, total: orders.length };
  }, [orders]);

  // Filtered orders by Segment View & Search
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      // 1. Segment View Filter
      if (segmentView === 'ready_pickup') {
        if (order.status !== 'listo_retiro') return false;
      } else if (segmentView === 'archived') {
        if (order.status !== 'archivado') return false;
      } else if (segmentView === 'cancelled') {
        if (order.status !== 'cancelado') return false;
      } else if (segmentView === 'refunds') {
        if (order.status !== 'solicitud_reembolso' && order.status !== 'reembolsado') return false;
      } else if (segmentView === 'expired_warranty') {
        if (!isWarrantyExpired(order)) return false;
      } else if (segmentView === 'active') {
        if (
          order.status === 'archivado' ||
          order.status === 'cancelado' ||
          order.status === 'solicitud_reembolso' ||
          order.status === 'reembolsado' ||
          isWarrantyExpired(order)
        ) {
          return false;
        }
      }

      // 2. Sub-filter by specific status
      if (subFilterStatus !== 'all' && order.status !== subFilterStatus) {
        return false;
      }

      // 3. Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesCode = order.code.toLowerCase().includes(query);
        const matchesCustomer = order.customer.name.toLowerCase().includes(query) || (order.customer.phone && order.customer.phone.includes(query));
        const matchesVehicle = (order.vehicle.make && order.vehicle.make.toLowerCase().includes(query)) ||
          (order.vehicle.model && order.vehicle.model.toLowerCase().includes(query)) ||
          (order.vehicle.vin && order.vehicle.vin.toLowerCase().includes(query));
        const matchesPart = order.mainPart && order.mainPart.toLowerCase().includes(query);
        const matchesStock = order.stockNumber && order.stockNumber.toLowerCase().includes(query);

        return matchesCode || matchesCustomer || matchesVehicle || matchesPart || matchesStock;
      }

      return true;
    });
  }, [orders, segmentView, subFilterStatus, searchQuery]);

  // Render Status Badge with Cyberpunk Glow
  const renderStatusBadge = (status: OrderStatus) => {
    switch (status) {
      case 'entregado':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.3)]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Entregado
          </span>
        );
      case 'en_camino':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-cyan-500/15 border border-cyan-400/40 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.3)]">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            En Camino
          </span>
        );
      case 'listo_despacho':
      case 'listo_retiro':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-purple-500/15 border border-purple-400/40 text-purple-300 shadow-[0_0_10px_rgba(168,85,247,0.3)]">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
            Listo para Retiro
          </span>
        );
      case 'pagado':
      case 'facturado':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-blue-500/15 border border-blue-400/40 text-blue-300 shadow-[0_0_10px_rgba(59,130,246,0.3)]">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            Pagado / Facturado
          </span>
        );
      case 'cotizacion':
      case 'espera_confirmacion':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-amber-500/15 border border-amber-400/40 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.3)]">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            Cotización
          </span>
        );
      case 'reclamo':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-red-500/15 border border-red-400/40 text-red-300 shadow-[0_0_10px_rgba(239,68,68,0.3)] animate-pulse">
            <span className="material-symbols-outlined text-[13px]">warning</span>
            Reclamo
          </span>
        );
      case 'cancelado':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-slate-800/80 border border-slate-700 text-slate-400">
            Cancelado
          </span>
        );
      case 'solicitud_reembolso':
      case 'reembolsado':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-amber-500/15 border border-amber-400/40 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.3)]">
            <span className="material-symbols-outlined text-[13px]">paid</span>
            Reembolso
          </span>
        );
      case 'archivado':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-slate-800/80 border border-slate-700 text-slate-400">
            <span className="material-symbols-outlined text-[13px]">archive</span>
            Archivado
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono bg-slate-800 text-slate-300 border border-slate-700">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="radar-view select-none pb-8">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#040b17]/90 border border-cyan-400/40 text-[10px] font-mono font-bold tracking-[0.2em] text-cyan-300 uppercase mb-2 shadow-[0_0_12px_rgba(6,182,212,0.25)]">
            <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_#22d3ee] animate-pulse" />
            <span>MATRIZ DE SEGUIMIENTO OPERATIVO</span>
          </div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl md:text-3xl font-black text-white tracking-tight drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
              Órdenes & Taller
            </h2>
            <span className="inline-flex items-center justify-center bg-emerald-500/15 border border-emerald-400/40 rounded-full px-3 py-0.5 font-mono text-emerald-300 text-xs font-black shadow-[0_0_10px_rgba(16,185,129,0.25)]">
              {counts.active} Activas
            </span>
          </div>
          <p className="text-xs text-slate-400 font-mono mt-1">
            Control de inventario, despacho, VIN y balance financiero por orden.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={onExport}
            className="px-3.5 py-2 rounded-2xl bg-[#060e1d]/90 border border-cyan-500/30 text-xs font-mono font-bold text-slate-200 hover:border-cyan-400 hover:bg-[#09152b] transition-all flex items-center gap-1.5 cursor-pointer shadow-[0_0_15px_rgba(6,182,212,0.15)]"
          >
            <span className="material-symbols-outlined text-[16px] text-cyan-400">download</span>
            <span>Exportar CSV</span>
          </button>

          <button
            type="button"
            onClick={onStatusRequest}
            className="px-3.5 py-2 rounded-2xl bg-[#060e1d]/90 border border-cyan-500/30 text-xs font-mono font-bold text-cyan-300 hover:border-cyan-400 hover:bg-[#09152b] transition-all flex items-center gap-1.5 cursor-pointer shadow-[0_0_15px_rgba(6,182,212,0.15)]"
          >
            <span className="material-symbols-outlined text-[16px]">assignment</span>
            <span>Solicitar status</span>
          </button>

          <button
            onClick={onOpenNewOrder}
            className="px-4 py-2 rounded-2xl bg-gradient-to-r from-cyan-400 via-blue-500 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 text-xs font-black tracking-wider uppercase transition-all shadow-[0_0_20px_rgba(6,182,212,0.4)] flex items-center gap-1.5 cursor-pointer active:scale-95"
          >
            <span className="material-symbols-outlined text-[18px]">add_circle</span>
            <span>Crear Orden</span>
          </button>
        </div>
      </div>

      {/* Segmented Views & Search Filter Bar */}
      <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-4 shadow-[0_15px_35px_rgba(0,0,0,0.6)] flex flex-col gap-3 overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-[1.5px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_10px_#22d3ee]" />

        <div className="flex flex-col lg:flex-row gap-3 justify-between items-start lg:items-center">
          {/* Segment Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Activas */}
            <button
              onClick={() => {
                setSegmentView('active');
                setSubFilterStatus('all');
              }}
              className={`text-xs py-1.5 px-3.5 rounded-xl transition-all font-mono font-bold flex items-center gap-2 cursor-pointer ${
                segmentView === 'active'
                  ? 'bg-emerald-500/20 border-2 border-emerald-400 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.35)]'
                  : 'bg-[#040814] border border-cyan-500/20 text-slate-300 hover:border-cyan-400/50 hover:text-white'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>🟢 Órdenes Activas</span>
              <span className="text-[10px] bg-[#02050c] px-2 py-0.5 rounded-md border border-cyan-500/25 text-white">
                {counts.active}
              </span>
            </button>

            {/* Listo para Retiro */}
            <button
              onClick={() => {
                setSegmentView('ready_pickup');
                setSubFilterStatus('all');
              }}
              className={`text-xs py-1.5 px-3.5 rounded-xl transition-all font-mono font-bold flex items-center gap-2 cursor-pointer ${
                segmentView === 'ready_pickup'
                  ? 'bg-purple-500/20 border-2 border-purple-400 text-purple-300 shadow-[0_0_15px_rgba(168,85,247,0.35)]'
                  : 'bg-[#040814] border border-cyan-500/20 text-slate-300 hover:border-cyan-400/50 hover:text-white'
              }`}
            >
              <span>🏪 Listo para Retiro</span>
              <span className="text-[10px] bg-[#02050c] px-2 py-0.5 rounded-md border border-cyan-500/25 text-white">
                {counts.readyPickup}
              </span>
            </button>

            {/* Garantías Vencidas */}
            <button
              onClick={() => {
                setSegmentView('expired_warranty');
                setSubFilterStatus('all');
              }}
              className={`text-xs py-1.5 px-3.5 rounded-xl transition-all font-mono font-bold flex items-center gap-2 cursor-pointer ${
                segmentView === 'expired_warranty'
                  ? 'bg-amber-500/20 border-2 border-amber-400 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.35)]'
                  : 'bg-[#040814] border border-cyan-500/20 text-slate-300 hover:border-cyan-400/50 hover:text-white'
              }`}
            >
              <span>⏳ Garantías Vencidas</span>
              <span className="text-[10px] bg-[#02050c] px-2 py-0.5 rounded-md border border-cyan-500/25 text-white">
                {counts.expiredWarranty}
              </span>
            </button>

            {/* Canceladas */}
            <button
              onClick={() => {
                setSegmentView('cancelled');
                setSubFilterStatus('all');
              }}
              className={`text-xs py-1.5 px-3.5 rounded-xl transition-all font-mono font-bold flex items-center gap-2 cursor-pointer ${
                segmentView === 'cancelled'
                  ? 'bg-red-500/20 border-2 border-red-400 text-red-300 shadow-[0_0_15px_rgba(239,68,68,0.35)]'
                  : 'bg-[#040814] border border-cyan-500/20 text-slate-300 hover:border-cyan-400/50 hover:text-white'
              }`}
            >
              <span>🚫 Canceladas</span>
              <span className="text-[10px] bg-[#02050c] px-2 py-0.5 rounded-md border border-cyan-500/25 text-white">
                {counts.cancelled}
              </span>
            </button>

            {/* Reembolsos */}
            <button
              onClick={() => {
                setSegmentView('refunds');
                setSubFilterStatus('all');
              }}
              className={`text-xs py-1.5 px-3.5 rounded-xl transition-all font-mono font-bold flex items-center gap-2 cursor-pointer ${
                segmentView === 'refunds'
                  ? 'bg-amber-500/20 border-2 border-amber-400 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.35)]'
                  : 'bg-[#040814] border border-cyan-500/20 text-slate-300 hover:border-cyan-400/50 hover:text-white'
              }`}
            >
              <span>💸 Reembolsos</span>
              <span className="text-[10px] bg-[#02050c] px-2 py-0.5 rounded-md border border-cyan-500/25 text-white">
                {counts.refunds}
              </span>
            </button>

            {/* Archivadas */}
            <button
              onClick={() => {
                setSegmentView('archived');
                setSubFilterStatus('all');
              }}
              className={`text-xs py-1.5 px-3.5 rounded-xl transition-all font-mono font-bold flex items-center gap-2 cursor-pointer ${
                segmentView === 'archived'
                  ? 'bg-slate-700/40 border-2 border-slate-500 text-slate-200'
                  : 'bg-[#040814] border border-cyan-500/20 text-slate-300 hover:border-cyan-400/50 hover:text-white'
              }`}
            >
              <span>📦 Archivadas</span>
              <span className="text-[10px] bg-[#02050c] px-2 py-0.5 rounded-md border border-cyan-500/25 text-white">
                {counts.archived}
              </span>
            </button>
          </div>

          {/* Search Box */}
          <div className="relative w-full lg:w-80 group">
            <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-cyan-400/70 text-[18px] group-focus-within:text-cyan-300 transition-colors pointer-events-none">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por código, cliente, VIN..."
              className="w-full bg-[#040814]/90 border border-cyan-500/25 rounded-2xl py-2 pl-10 pr-9 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/30 transition-all shadow-[inset_0_0_12px_rgba(0,0,0,0.6)]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-[15px]">close</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Glassmorphic Data Table */}
      <div className="relative rounded-3xl bg-[#070c18]/92 backdrop-blur-3xl border border-cyan-500/25 shadow-[0_25px_70px_rgba(0,0,0,0.75)] overflow-hidden flex flex-col">
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 shadow-[0_0_12px_#22d3ee]" />

        <div className="overflow-x-auto">
          <table className="w-full text-left whitespace-nowrap border-collapse">
            <thead className="bg-[#040814]/90 border-b border-cyan-500/20">
              <tr className="font-mono text-[10.5px] text-cyan-400/80 uppercase tracking-wider">
                <th className="px-5 py-3.5 font-bold">Código & Fecha</th>
                <th className="px-5 py-3.5 font-bold">Cliente</th>
                <th className="px-5 py-3.5 font-bold">Vehículo & VIN</th>
                <th className="px-5 py-3.5 font-bold">Refacción Solicitada</th>
                <th className="px-5 py-3.5 font-bold">Tipo Entrega</th>
                <th className="px-5 py-3.5 font-bold">Estatus</th>
                <th className="px-5 py-3.5 font-bold text-right">Balance Financiero</th>
                <th className="px-5 py-3.5 font-bold text-center w-16">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cyan-500/10 text-xs">
              {filteredOrders.map((order) => {
                const partPrice = order.financials.partPrice ?? order.financials.baseMSRP ?? 1000;
                const downPayment = order.financials.downPayment ?? order.financials.advancePayment ?? 0;
                const deliveryFee = order.financials.deliveryFee ?? 0;
                const coreFee = order.financials.coreFee ?? 0;
                const grossSubtotal = partPrice + deliveryFee + coreFee;
                const totalPayable = Math.max(0, grossSubtotal - downPayment);

                return (
                  <tr
                    key={order.id}
                    className="hover:bg-cyan-500/5 transition-all group cursor-pointer"
                    onClick={() => onSelectOrder(order.id)}
                  >
                    {/* Código & Fecha */}
                    <td className="px-5 py-4">
                      <div className="flex flex-col">
                        <span className="font-mono font-black text-sm text-cyan-300 group-hover:text-cyan-200 group-hover:underline drop-shadow-[0_0_8px_rgba(34,211,238,0.4)]">
                          {order.code}
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono mt-0.5">
                          {order.createdAt}
                        </span>
                      </div>
                    </td>

                    {/* Cliente */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-[#0b162b] flex items-center justify-center text-cyan-300 font-bold text-xs border border-cyan-400/30 shrink-0 shadow-[0_0_8px_rgba(6,182,212,0.2)]">
                          {order.customer.initials}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-white font-bold leading-tight group-hover:text-cyan-200">
                            {order.customer.name}
                          </span>
                          <span className="text-slate-400 text-[11px] font-mono">
                            {order.customer.phone}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Vehículo & VIN */}
                    <td className="px-5 py-4">
                      <div className="flex flex-col">
                        <span className="text-slate-200 font-medium leading-tight">
                          {order.vehicle.year} {order.vehicle.make} {order.vehicle.model}
                        </span>
                        <span className="font-mono text-[11px] text-slate-400 truncate max-w-[170px]">
                          VIN: {order.vehicle.vin}
                        </span>
                      </div>
                    </td>

                    {/* Refacción */}
                    <td className="px-5 py-4">
                      <div className="flex flex-col">
                        <span className="text-slate-100 font-semibold">{order.mainPart}</span>
                        {order.stockNumber && (
                          <span className="font-mono text-[10px] text-emerald-400 font-bold">
                            Stock: {order.stockNumber}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Tipo Entrega */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            order.deliveryType === 'envio_domicilio'
                              ? 'bg-cyan-400 shadow-[0_0_6px_#22d3ee]'
                              : 'bg-emerald-400 shadow-[0_0_6px_#34d399]'
                          }`}
                        />
                        <span className="text-xs font-mono text-slate-300">
                          {order.deliveryType === 'envio_domicilio' ? 'Envío Domicilio' : 'Retiro Tienda'}
                        </span>
                      </div>
                    </td>

                    {/* Estatus */}
                    <td className="px-5 py-4">
                      {renderStatusBadge(order.status)}
                    </td>

                    {/* Finanzas */}
                    <td className="px-5 py-4 text-right">
                      <div className="flex flex-col items-end">
                        <span className="font-mono text-sm font-black text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.3)]">
                          ${totalPayable.toFixed(2)}
                        </span>
                        {downPayment > 0 ? (
                          <span className="font-mono text-[11px] text-emerald-400 font-semibold">
                            Abono: ${downPayment.toFixed(2)}
                          </span>
                        ) : (
                          <span className="font-mono text-[11px] text-red-400">
                            Sin Abono ($0.00)
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Acciones */}
                    <td className="px-5 py-4 text-center relative" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setActiveActionMenu(activeActionMenu === order.id ? null : order.id)}
                        className="text-slate-400 hover:text-cyan-300 p-1.5 rounded-xl hover:bg-slate-800 transition cursor-pointer"
                        title="Opciones"
                      >
                        <span className="material-symbols-outlined text-[18px]">more_vert</span>
                      </button>

                      {/* Dropdown Menu */}
                      {activeActionMenu === order.id && (
                        <div className="absolute right-4 top-10 w-52 bg-[#060c18] border border-cyan-500/30 rounded-2xl shadow-[0_15px_40px_rgba(0,0,0,0.85)] z-30 py-2 text-left text-xs overflow-hidden backdrop-blur-2xl">
                          <button
                            onClick={() => {
                              if (onEditOrder) onEditOrder(order);
                              else onSelectOrder(order.id);
                              setActiveActionMenu(null);
                            }}
                            className="w-full px-4 py-2 hover:bg-cyan-500/15 text-white flex items-center gap-2.5 cursor-pointer font-medium transition"
                          >
                            <span className="material-symbols-outlined text-[16px] text-cyan-400">edit</span>
                            <span>Editar Orden</span>
                          </button>
                          <button
                            disabled={order.status === 'archivado' || !onUpdateStatus}
                            onClick={() => {
                              if (onUpdateStatus) onUpdateStatus(order.id, 'archivado');
                              setActiveActionMenu(null);
                            }}
                            className="w-full px-4 py-2 hover:bg-amber-500/15 text-amber-300 flex items-center gap-2.5 cursor-pointer font-bold border-t border-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-40 transition"
                          >
                            <span className="material-symbols-outlined text-[16px]">archive</span>
                            <span>Archivar</span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}

              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-14 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <span className="material-symbols-outlined text-5xl text-cyan-400/50">search_off</span>
                      <p className="font-bold text-white text-sm">No se encontraron órdenes en esta vista.</p>
                      <p className="text-xs text-slate-400 font-mono">Prueba seleccionando otra de las vistas segmentadas o ajusta tu búsqueda.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer */}
        <div className="bg-[#040814]/95 border-t border-cyan-500/20 px-5 py-3 flex items-center justify-between">
          <span className="font-mono text-xs text-slate-400">
            Mostrando <strong className="text-cyan-300">{filteredOrders.length}</strong> órdenes en vista <strong className="text-white font-bold">{segmentView.toUpperCase()}</strong>
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 disabled:opacity-30 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">chevron_left</span>
            </button>
            <span className="text-xs text-white font-mono px-3 py-1 rounded-xl bg-[#0a152b] border border-cyan-500/30">
              Página {currentPage}
            </span>
            <button
              onClick={() => setCurrentPage(currentPage + 1)}
              className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">chevron_right</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
