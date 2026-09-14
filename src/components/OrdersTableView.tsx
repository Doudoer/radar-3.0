import React, { useState, useMemo } from 'react';
import { Order, OrderStatus, OrderSegmentView } from '../types';

interface OrdersTableViewProps {
  orders: Order[];
  onSelectOrder: (orderId: string) => void;
  onOpenNewOrder: () => void;
  onEditOrder?: (order: Order) => void;
  onExport: () => void;
  onUpdateStatus?: (orderId: string, newStatus: OrderStatus) => void;
}

export const OrdersTableView: React.FC<OrdersTableViewProps> = ({
  orders,
  onSelectOrder,
  onOpenNewOrder,
  onEditOrder,
  onExport,
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
        const q = searchQuery.toLowerCase();
        const matchesCode = order.code.toLowerCase().includes(q);
        const matchesName = order.customer.name.toLowerCase().includes(q);
        const matchesCompany = order.customer.company?.toLowerCase().includes(q) || false;
        const matchesVehicle = `${order.vehicle.make} ${order.vehicle.model}`.toLowerCase().includes(q);
        const matchesPlate = order.vehicle.plate.toLowerCase().includes(q);
        const matchesPart = order.mainPart.toLowerCase().includes(q);
        const matchesStock = order.stockNumber?.toLowerCase().includes(q) || false;
        return matchesCode || matchesName || matchesCompany || matchesVehicle || matchesPlate || matchesPart || matchesStock;
      }

      return true;
    });
  }, [orders, segmentView, subFilterStatus, searchQuery]);

  // Render Status Badge matching the 13 RADAR statuses
  const renderStatusBadge = (status: OrderStatus) => {
    switch (status) {
      case 'cotizacion':
      case 'en_diagnostico':
        return (
          <span className="inline-flex items-center gap-1.5 bg-[#94a3b8]/15 text-[#cbd5e1] font-data-label text-[11px] px-2.5 py-0.5 rounded-full border border-[#94a3b8]/30 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-[#94a3b8]" />
            Cotización
          </span>
        );
      case 'espera_confirmacion':
      case 'pendiente_aprobacion':
        return (
          <span className="inline-flex items-center gap-1.5 bg-[#eab308]/15 text-[#facc15] font-data-label text-[11px] px-2.5 py-0.5 rounded-full border border-[#eab308]/30 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-[#eab308]" />
            En Espera Confirmación
          </span>
        );
      case 'pagado':
      case 'listo_pago':
      case 'facturado':
        return (
          <span className="inline-flex items-center gap-1.5 bg-[#10b981]/15 text-[#34d399] font-data-label text-[11px] px-2.5 py-0.5 rounded-full border border-[#10b981]/30 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
            Pagado
          </span>
        );
      case 'en_preparacion':
      case 'en_reparacion':
      case 'en_proceso':
        return (
          <span className="inline-flex items-center gap-1.5 bg-[#3b82f6]/15 text-[#60a5fa] font-data-label text-[11px] px-2.5 py-0.5 rounded-full border border-[#3b82f6]/30 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] animate-pulse" />
            En Preparación
          </span>
        );
      case 'listo_despacho':
        return (
          <span className="inline-flex items-center gap-1.5 bg-[#06b6d4]/15 text-[#22d3ee] font-data-label text-[11px] px-2.5 py-0.5 rounded-full border border-[#06b6d4]/30 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-[#06b6d4]" />
            Listo para Despacho
          </span>
        );
      case 'listo_retiro':
        return (
          <span className="inline-flex items-center gap-1.5 bg-[#8b5cf6]/15 text-[#a78bfa] font-data-label text-[11px] px-2.5 py-0.5 rounded-full border border-[#8b5cf6]/30 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6]" />
            Listo para Retiro
          </span>
        );
      case 'en_camino':
        return (
          <span className="inline-flex items-center gap-1.5 bg-[#f97316]/15 text-[#fb923c] font-data-label text-[11px] px-2.5 py-0.5 rounded-full border border-[#f97316]/30 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-[#f97316] animate-pulse" />
            En Camino
          </span>
        );
      case 'entregado':
        return (
          <span className="inline-flex items-center gap-1.5 bg-[#14b8a6]/15 text-[#2dd4bf] font-data-label text-[11px] px-2.5 py-0.5 rounded-full border border-[#14b8a6]/30 font-medium">
            <span className="material-symbols-outlined text-[13px]">verified</span>
            Entregado (Garantía Activa)
          </span>
        );
      case 'reclamo':
        return (
          <span className="inline-flex items-center gap-1.5 bg-[#ef4444]/15 text-[#f87171] font-data-label text-[11px] px-2.5 py-0.5 rounded-full border border-[#ef4444]/30 font-medium">
            <span className="material-symbols-outlined text-[13px]">report_problem</span>
            Reclamo
          </span>
        );
      case 'cancelado':
        return (
          <span className="inline-flex items-center gap-1.5 bg-[#ef4444]/15 text-[#f87171] font-data-label text-[11px] px-2.5 py-0.5 rounded-full border border-[#ef4444]/30 font-medium">
            <span className="material-symbols-outlined text-[13px]">cancel</span>
            Cancelado
          </span>
        );
      case 'solicitud_reembolso':
        return (
          <span className="inline-flex items-center gap-1.5 bg-[#f97316]/15 text-[#fb923c] font-data-label text-[11px] px-2.5 py-0.5 rounded-full border border-[#f97316]/30 font-medium">
            <span className="material-symbols-outlined text-[13px]">currency_exchange</span>
            Solicitud Reembolso
          </span>
        );
      case 'reembolsado':
        return (
          <span className="inline-flex items-center gap-1.5 bg-[#f59e0b]/15 text-[#fbbf24] font-data-label text-[11px] px-2.5 py-0.5 rounded-full border border-[#f59e0b]/30 font-medium">
            <span className="material-symbols-outlined text-[13px]">paid</span>
            Reembolsado
          </span>
        );
      case 'archivado':
        return (
          <span className="inline-flex items-center gap-1.5 bg-[#64748b]/15 text-[#94a3b8] font-data-label text-[11px] px-2.5 py-0.5 rounded-full border border-[#64748b]/30 font-medium">
            <span className="material-symbols-outlined text-[13px]">archive</span>
            Archivado
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 bg-[#31353f] text-[#c2c6d6] font-data-label text-[11px] px-2.5 py-0.5 rounded-full">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto flex flex-col gap-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h2 className="font-headline-md text-2xl md:text-3xl font-bold text-[#dfe2ef] tracking-tight">
              ORDENES
            </h2>
            <span className="inline-flex items-center justify-center bg-[#10b981]/15 border border-[#10b981]/30 rounded-full px-3 py-0.5 font-data-mono text-[#34d399] text-xs font-bold shadow-sm">
              {counts.active} Activas Operativas
            </span>
          </div>
          <p className="font-body-md text-xs sm:text-[14px] text-[#94a3b8]">
            Gestión y Seguimiento
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onExport}
            className="bg-[#1c1f29] border border-[rgba(255,255,255,0.08)] text-[#dfe2ef] hover:text-white hover:bg-[#31353f] font-body-sm text-[13px] py-2 px-3.5 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            <span>Exportar CSV</span>
          </button>

          <button
            onClick={onOpenNewOrder}
            className="bg-[#388bfd] hover:bg-[#2563eb] text-[#0a1120] font-body-sm text-[13px] font-extrabold py-2 px-4 rounded-xl transition-all duration-200 shadow-[0_0_15px_rgba(56,139,253,0.35)] flex items-center gap-1.5 cursor-pointer active:scale-95"
          >
            <span className="material-symbols-outlined text-[18px] font-bold">add</span>
            <span>Crear Orden</span>
          </button>
        </div>
      </div>

      {/* 5 Segmented Views Bar (Alivio de Carga Operativa) */}
      <div className="glass-card rounded-2xl p-3.5 shadow-md flex flex-col gap-3">
        <div className="flex flex-col lg:flex-row gap-3 justify-between items-start lg:items-center">
          {/* Main 5 Segment Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {/* 1. Activas */}
            <button
              onClick={() => {
                setSegmentView('active');
                setSubFilterStatus('all');
              }}
              className={`text-xs py-1.5 px-3.5 rounded-xl transition-all font-bold flex items-center gap-2 cursor-pointer ${
                segmentView === 'active'
                  ? 'bg-[#10b981]/20 border border-[#10b981]/50 text-[#34d399] shadow-sm'
                  : 'bg-[#1c1f29] border border-[rgba(255,255,255,0.08)] text-[#cbd5e1] hover:text-white hover:bg-[#31353f]'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse" />
              <span>🟢 Órdenes Activas</span>
              <span className="font-mono text-[11px] bg-[#0b1329] px-2 py-0.5 rounded-full border border-[rgba(255,255,255,0.1)]">
                {counts.active}
              </span>
            </button>

            {/* 2. Listo para Retiro */}
            <button
              onClick={() => {
                setSegmentView('ready_pickup');
                setSubFilterStatus('all');
              }}
              className={`text-xs py-1.5 px-3.5 rounded-xl transition-all font-bold flex items-center gap-2 cursor-pointer ${
                segmentView === 'ready_pickup'
                  ? 'bg-[#8b5cf6]/20 border border-[#8b5cf6]/50 text-[#c084fc] shadow-sm'
                  : 'bg-[#1c1f29] border border-[rgba(255,255,255,0.08)] text-[#cbd5e1] hover:text-white hover:bg-[#31353f]'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-[#8b5cf6]" />
              <span>🏪 Listo para Retiro</span>
              <span className="font-mono text-[11px] bg-[#0b1329] px-2 py-0.5 rounded-full border border-[rgba(255,255,255,0.1)]">
                {counts.readyPickup}
              </span>
            </button>

            {/* 3. Garantías Vencidas */}
            <button
              onClick={() => {
                setSegmentView('expired_warranty');
                setSubFilterStatus('all');
              }}
              className={`text-xs py-1.5 px-3.5 rounded-xl transition-all font-bold flex items-center gap-2 cursor-pointer ${
                segmentView === 'expired_warranty'
                  ? 'bg-[#eab308]/20 border border-[#eab308]/50 text-[#facc15] shadow-sm'
                  : 'bg-[#1c1f29] border border-[rgba(255,255,255,0.08)] text-[#cbd5e1] hover:text-white hover:bg-[#31353f]'
              }`}
            >
              <span>⏳ Garantías Vencidas</span>
              <span className="font-mono text-[11px] bg-[#0b1329] px-2 py-0.5 rounded-full border border-[rgba(255,255,255,0.1)]">
                {counts.expiredWarranty}
              </span>
            </button>

            {/* 3. Canceladas */}
            <button
              onClick={() => {
                setSegmentView('cancelled');
                setSubFilterStatus('all');
              }}
              className={`text-xs py-1.5 px-3.5 rounded-xl transition-all font-bold flex items-center gap-2 cursor-pointer ${
                segmentView === 'cancelled'
                  ? 'bg-[#ef4444]/20 border border-[#ef4444]/50 text-[#f87171] shadow-sm'
                  : 'bg-[#1c1f29] border border-[rgba(255,255,255,0.08)] text-[#cbd5e1] hover:text-white hover:bg-[#31353f]'
              }`}
            >
              <span>🚫 Canceladas</span>
              <span className="font-mono text-[11px] bg-[#0b1329] px-2 py-0.5 rounded-full border border-[rgba(255,255,255,0.1)]">
                {counts.cancelled}
              </span>
            </button>

            {/* 4. Reembolsos */}
            <button
              onClick={() => {
                setSegmentView('refunds');
                setSubFilterStatus('all');
              }}
              className={`text-xs py-1.5 px-3.5 rounded-xl transition-all font-bold flex items-center gap-2 cursor-pointer ${
                segmentView === 'refunds'
                  ? 'bg-[#f97316]/20 border border-[#f97316]/50 text-[#fb923c] shadow-sm'
                  : 'bg-[#1c1f29] border border-[rgba(255,255,255,0.08)] text-[#cbd5e1] hover:text-white hover:bg-[#31353f]'
              }`}
            >
              <span>💸 Reembolsos</span>
              <span className="font-mono text-[11px] bg-[#0b1329] px-2 py-0.5 rounded-full border border-[rgba(255,255,255,0.1)]">
                {counts.refunds}
              </span>
            </button>

            {/* 5. Archivadas */}
            <button
              onClick={() => {
                setSegmentView('archived');
                setSubFilterStatus('all');
              }}
              className={`text-xs py-1.5 px-3.5 rounded-xl transition-all font-bold flex items-center gap-2 cursor-pointer ${
                segmentView === 'archived'
                  ? 'bg-[#64748b]/20 border border-[#64748b]/50 text-[#cbd5e1] shadow-sm'
                  : 'bg-[#1c1f29] border border-[rgba(255,255,255,0.08)] text-[#cbd5e1] hover:text-white hover:bg-[#31353f]'
              }`}
            >
              <span>📦 Archivadas</span>
              <span className="font-mono text-[11px] bg-[#0b1329] px-2 py-0.5 rounded-full border border-[rgba(255,255,255,0.1)]">
                {counts.archived}
              </span>
            </button>
          </div>

          {/* Search Box */}
          <div className="relative w-full lg:w-72 group">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8] text-[18px] group-focus-within:text-[#388bfd] transition-colors pointer-events-none">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por código, cliente, VIN, refacción..."
              className="w-full bg-[#080e1e] border border-[rgba(255,255,255,0.08)] rounded-xl py-2 pl-9 pr-8 text-xs text-[#dfe2ef] placeholder:text-[#94a3b8]/60 focus:outline-none focus:border-[#388bfd] focus:ring-1 focus:ring-[#388bfd] transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-white"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Data Table */}
      <div className="glass-card rounded-2xl shadow-xl overflow-hidden flex flex-col border border-[rgba(255,255,255,0.08)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left whitespace-nowrap border-collapse">
            <thead className="bg-[#0b1329] border-b border-[rgba(255,255,255,0.08)]">
              <tr className="font-data-label text-[11px] text-[#94a3b8] uppercase tracking-wider">
                <th className="px-5 py-3.5 font-bold">Código & Fecha</th>
                <th className="px-5 py-3.5 font-bold">Cliente</th>
                <th className="px-5 py-3.5 font-bold">Vehículo & VIN</th>
                <th className="px-5 py-3.5 font-bold">Refacción Solicitada</th>
                <th className="px-5 py-3.5 font-bold">Tipo Entrega</th>
                <th className="px-5 py-3.5 font-bold">Estatus</th>
                <th className="px-5 py-3.5 font-bold text-right">Desglose Financiero</th>
                <th className="px-5 py-3.5 font-bold text-center w-16">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(255,255,255,0.06)] font-body-sm text-[13px]">
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
                    className="hover:bg-[#1e293b]/40 transition-colors group cursor-pointer"
                    onClick={() => onSelectOrder(order.id)}
                  >
                    {/* Código & Fecha */}
                    <td className="px-5 py-4">
                      <div className="flex flex-col">
                        <span className="font-mono font-black text-sm text-[#388bfd] group-hover:underline">
                          {order.code}
                        </span>
                        <span className="text-[11px] text-[#94a3b8] font-mono mt-0.5">
                          {order.createdAt}
                        </span>
                      </div>
                    </td>

                    {/* Cliente */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-[#1e293b] flex items-center justify-center text-[#58a6ff] font-bold text-xs border border-[#334155] shrink-0">
                          {order.customer.initials}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[#f1f5f9] font-bold leading-tight group-hover:text-white">
                            {order.customer.name}
                          </span>
                          <span className="text-[#94a3b8] text-[11px] font-mono">
                            {order.customer.phone}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Vehículo & VIN */}
                    <td className="px-5 py-4">
                      <div className="flex flex-col">
                        <span className="text-[#f1f5f9] font-medium leading-tight">
                          {order.vehicle.year} {order.vehicle.make} {order.vehicle.model}
                        </span>
                        <span className="font-mono text-[11px] text-[#94a3b8] truncate max-w-[170px]">
                          VIN: {order.vehicle.vin}
                        </span>
                      </div>
                    </td>

                    {/* Refacción */}
                    <td className="px-5 py-4">
                      <div className="flex flex-col">
                        <span className="text-[#e2e8f0] font-semibold">{order.mainPart}</span>
                        {order.stockNumber && (
                          <span className="font-mono text-[10px] text-[#34d399]">
                            {order.stockNumber}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Tipo Entrega */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            order.deliveryType === 'envio_domicilio' ? 'bg-[#388bfd]' : 'bg-[#10b981]'
                          }`}
                        />
                        <span className="text-xs font-medium text-[#cbd5e1]">
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
                        <span className="font-mono text-sm font-bold text-[#58a6ff]">
                          ${totalPayable.toFixed(2)}
                        </span>
                        {downPayment > 0 ? (
                          <span className="font-mono text-[11px] text-[#34d399]">
                            Abono: ${downPayment.toFixed(2)}
                          </span>
                        ) : (
                          <span className="font-mono text-[11px] text-[#f87171]">
                            Sin Abono ($0.00)
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Acciones */}
                    <td className="px-5 py-4 text-center relative" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setActiveActionMenu(activeActionMenu === order.id ? null : order.id)}
                        className="text-[#94a3b8] hover:text-[#58a6ff] p-1.5 rounded-lg hover:bg-[#1e293b] transition-colors cursor-pointer"
                        title="Opciones"
                      >
                        <span className="material-symbols-outlined text-[18px]">more_vert</span>
                      </button>

                      {/* Dropdown Menu */}
                      {activeActionMenu === order.id && (
                        <div className="absolute right-4 top-10 w-56 bg-[#0b1329] border border-[#1e293b] rounded-xl shadow-2xl z-30 py-2 text-left text-xs">
                          <button
                            onClick={() => {
                              if (onEditOrder) onEditOrder(order);
                              else onSelectOrder(order.id);
                              setActiveActionMenu(null);
                            }}
                            className="w-full px-3.5 py-2 hover:bg-[#1e293b] text-[#f1f5f9] flex items-center gap-2 cursor-pointer font-medium"
                          >
                            <span className="material-symbols-outlined text-[16px] text-[#388bfd]">edit</span>
                            <span>Editar</span>
                          </button>
                          <button
                            disabled={order.status === 'archivado' || !onUpdateStatus}
                            onClick={() => {
                              if (onUpdateStatus) onUpdateStatus(order.id, 'archivado');
                              setActiveActionMenu(null);
                            }}
                            className="w-full px-3.5 py-2 hover:bg-[#1e293b] text-[#f59e0b] flex items-center gap-2 cursor-pointer font-bold border-t border-[#1e293b] disabled:cursor-not-allowed disabled:opacity-40"
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
                  <td colSpan={8} className="px-5 py-12 text-center text-[#94a3b8]">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <span className="material-symbols-outlined text-4xl opacity-50">search_off</span>
                      <p className="font-semibold text-sm">No se encontraron órdenes en esta vista.</p>
                      <p className="text-xs text-[#64748b]">Prueba seleccionando otra de las 5 vistas segmentadas o ajusta tu búsqueda.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="bg-[#0b1329] border-t border-[rgba(255,255,255,0.08)] px-5 py-3 flex items-center justify-between">
          <span className="font-body-sm text-xs text-[#94a3b8]">
            Mostrando {filteredOrders.length} órdenes en vista <strong>{segmentView.toUpperCase()}</strong>
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="p-1.5 rounded-lg hover:bg-[#1e293b] text-[#94a3b8] disabled:opacity-40 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">chevron_left</span>
            </button>
            <span className="text-xs text-[#f1f5f9] font-mono px-2 py-0.5 rounded bg-[#1e293b]">
              {currentPage}
            </span>
            <button
              onClick={() => setCurrentPage(currentPage + 1)}
              className="p-1.5 rounded-lg hover:bg-[#1e293b] text-[#94a3b8] cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">chevron_right</span>
            </button>
          </div>
        </div>
      </div>

    </div>
  );
};
