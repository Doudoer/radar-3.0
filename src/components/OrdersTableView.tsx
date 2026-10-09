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

const PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100] as const;

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
  const [isArchivedView, setIsArchivedView] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [operatorFilter, setOperatorFilter] = useState<string>('all');
  const [makeFilter, setMakeFilter] = useState<string>('all');
  const [partTypeFilter, setPartTypeFilter] = useState<string>('all');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [activeActionMenu, setActiveActionMenu] = useState<string | null>(null);

  const handleToggleArchived = () => {
    if (isArchivedView) {
      setIsArchivedView(false);
      setSegmentView('active');
      setStatusFilter('all');
    } else {
      setIsArchivedView(true);
      setSegmentView('archived');
      setStatusFilter('all');
    }
    setCurrentPage(1);
  };

  const handleSegmentChange = (newSegment: OrderSegmentView) => {
    setSegmentView(newSegment);
    if (newSegment === 'archived') {
      setIsArchivedView(true);
    } else {
      setIsArchivedView(false);
    }
    setStatusFilter('all');
    setCurrentPage(1);
  };

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    setCurrentPage(1);
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
  };

  const handleClearFilters = () => {
    setStatusFilter('all');
    setOperatorFilter('all');
    setMakeFilter('all');
    setPartTypeFilter('all');
    setFromDate('');
    setToDate('');
    setSearchQuery('');
    setIsArchivedView(false);
    setSegmentView('active');
    setCurrentPage(1);
  };

  // Helper to robustly extract order date as YYYY-MM-DD
  const getOrderDateYMD = (order: Order): string => {
    if (order.createdAtIso) {
      const d = new Date(order.createdAtIso);
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      }
    }
    const raw = (order.createdAt || '').trim();
    if (!raw) return '';

    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      return raw.substring(0, 10);
    }

    const slashMatch = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slashMatch) {
      const day = slashMatch[1].padStart(2, '0');
      const month = slashMatch[2].padStart(2, '0');
      const year = slashMatch[3];
      return `${year}-${month}-${day}`;
    }

    const spanishMonths: Record<string, string> = {
      ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06',
      jul: '07', ago: '08', sep: '09', oct: '10', nov: '11', dic: '12',
      enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
      julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
    };
    const match = raw.match(/(\d{1,2})\s+([a-zA-ZáéíóúÁÉÍÓÚ]+)\.?\s+(\d{4})/i);
    if (match) {
      const day = match[1].padStart(2, '0');
      const mKey = match[2].toLowerCase().slice(0, 3);
      const month = spanishMonths[mKey] || '01';
      const year = match[3];
      return `${year}-${month}-${day}`;
    }

    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const day = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

    return '';
  };

  // Helper to check if an order's warranty is expired
  const isWarrantyExpired = (order: Order): boolean => {
    if (order.status !== 'entregado') return false;
    if (!order.deliveredAt) return false;
    const deliveredDate = new Date(order.deliveredAt).getTime();
    const daysSinceDelivery = (Date.now() - deliveredDate) / (1000 * 60 * 60 * 24);
    const limit = order.warrantyDays || 60;
    return daysSinceDelivery > limit;
  };

  // Unique lists for dynamic dropdown filters
  const uniqueOperators = useMemo(() => {
    const set = new Set<string>();
    orders.forEach((o) => {
      const adv = o.advisor?.trim();
      if (adv) set.add(adv);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }, [orders]);

  const uniqueMakes = useMemo(() => {
    const set = new Set<string>();
    orders.forEach((o) => {
      const mk = o.vehicle?.make?.trim();
      if (mk) set.add(mk);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }, [orders]);

  const uniquePartTypes = useMemo(() => {
    const set = new Set<string>();
    orders.forEach((o) => {
      const pt = o.mainPart?.trim();
      if (pt) set.add(pt);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }, [orders]);

  // Active filters count
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (statusFilter !== 'all') count++;
    if (operatorFilter !== 'all') count++;
    if (makeFilter !== 'all') count++;
    if (partTypeFilter !== 'all') count++;
    if (fromDate) count++;
    if (toDate) count++;
    return count;
  }, [statusFilter, operatorFilter, makeFilter, partTypeFilter, fromDate, toDate]);

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

  // Filtered orders by Segment View, Dropdown Filters, Date Range & Search
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      // 1. Archived View vs Status & Segment Filter
      if (isArchivedView) {
        if (order.status !== 'archivado') return false;
      } else {
        if (statusFilter !== 'all') {
          if (order.status !== statusFilter) return false;
        } else {
          // Segment View Filter
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
        }
      }

      // 2. Operator Filter
      if (operatorFilter !== 'all') {
        const adv = (order.advisor || '').toLowerCase().trim();
        if (adv !== operatorFilter.toLowerCase().trim()) return false;
      }

      // 3. Make Filter
      if (makeFilter !== 'all') {
        const mk = (order.vehicle?.make || '').toLowerCase().trim();
        if (mk !== makeFilter.toLowerCase().trim()) return false;
      }

      // 4. Part Type Filter
      if (partTypeFilter !== 'all') {
        const pt = (order.mainPart || '').toLowerCase().trim();
        if (pt !== partTypeFilter.toLowerCase().trim()) return false;
      }

      // 5. Date Range Filter
      if (fromDate || toDate) {
        const orderDate = getOrderDateYMD(order);
        if (fromDate && (!orderDate || orderDate < fromDate)) return false;
        if (toDate && (!orderDate || orderDate > toDate)) return false;
      }

      // 6. Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesCode = (order.code || '').toLowerCase().includes(query) || (order.id || '').toLowerCase().includes(query);
        const matchesCustomer = (order.customer?.name || '').toLowerCase().includes(query) ||
          (order.customer?.phone || '').includes(query) ||
          (order.customer?.whatsapp || '').includes(query);
        const matchesVehicle = (order.vehicle?.make || '').toLowerCase().includes(query) ||
          (order.vehicle?.model || '').toLowerCase().includes(query) ||
          (order.vehicle?.year ? String(order.vehicle.year).includes(query) : false) ||
          (order.vehicle?.vin || '').toLowerCase().includes(query);
        const matchesPart = (order.mainPart || '').toLowerCase().includes(query) ||
          (order.productSpecs || '').toLowerCase().includes(query);
        const matchesStock = (order.stockNumber || '').toLowerCase().includes(query);

        if (!matchesCode && !matchesCustomer && !matchesVehicle && !matchesPart && !matchesStock) {
          return false;
        }
      }

      return true;
    });
  }, [
    orders,
    isArchivedView,
    statusFilter,
    segmentView,
    operatorFilter,
    makeFilter,
    partTypeFilter,
    fromDate,
    toDate,
    searchQuery,
  ]);

  // Pagination Computations
  const totalOrders = filteredOrders.length;
  const totalPages = Math.max(1, Math.ceil(totalOrders / pageSize));
  const validCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const startIndex = (validCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalOrders);

  const paginatedOrders = useMemo(() => {
    return filteredOrders.slice(startIndex, endIndex);
  }, [filteredOrders, startIndex, endIndex]);

  const visiblePages = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    if (validCurrentPage <= 4) {
      return [1, 2, 3, 4, 5, '...', totalPages];
    }
    if (validCurrentPage >= totalPages - 3) {
      return [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    }
    return [1, '...', validCurrentPage - 1, validCurrentPage, validCurrentPage + 1, '...', totalPages];
  }, [totalPages, validCurrentPage]);

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

      {/* Segmented Quick Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Activas */}
        <button
          onClick={() => handleSegmentChange('active')}
          className={`text-xs py-1.5 px-3.5 rounded-xl transition-all font-mono font-bold flex items-center gap-2 cursor-pointer ${
            segmentView === 'active' && !isArchivedView
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
          onClick={() => handleSegmentChange('ready_pickup')}
          className={`text-xs py-1.5 px-3.5 rounded-xl transition-all font-mono font-bold flex items-center gap-2 cursor-pointer ${
            segmentView === 'ready_pickup' && !isArchivedView
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
          onClick={() => handleSegmentChange('expired_warranty')}
          className={`text-xs py-1.5 px-3.5 rounded-xl transition-all font-mono font-bold flex items-center gap-2 cursor-pointer ${
            segmentView === 'expired_warranty' && !isArchivedView
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
          onClick={() => handleSegmentChange('cancelled')}
          className={`text-xs py-1.5 px-3.5 rounded-xl transition-all font-mono font-bold flex items-center gap-2 cursor-pointer ${
            segmentView === 'cancelled' && !isArchivedView
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
          onClick={() => handleSegmentChange('refunds')}
          className={`text-xs py-1.5 px-3.5 rounded-xl transition-all font-mono font-bold flex items-center gap-2 cursor-pointer ${
            segmentView === 'refunds' && !isArchivedView
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
          onClick={() => handleSegmentChange('archived')}
          className={`text-xs py-1.5 px-3.5 rounded-xl transition-all font-mono font-bold flex items-center gap-2 cursor-pointer ${
            isArchivedView || segmentView === 'archived'
              ? 'bg-slate-700/60 border-2 border-cyan-400 text-white shadow-[0_0_15px_rgba(6,182,212,0.3)]'
              : 'bg-[#040814] border border-cyan-500/20 text-slate-300 hover:border-cyan-400/50 hover:text-white'
          }`}
        >
          <span>📦 Archivadas</span>
          <span className="text-[10px] bg-[#02050c] px-2 py-0.5 rounded-md border border-cyan-500/25 text-white">
            {counts.archived}
          </span>
        </button>
      </div>

      {/* Main Search & Filters Bar (Matching Screenshot UI) */}
      <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-4 shadow-[0_15px_35px_rgba(0,0,0,0.6)] flex flex-col gap-3.5 overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-[1.5px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_10px_#22d3ee]" />

        {/* Row 1: Ver Archivadas | Search Bar | Filtros Button */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Ver Archivadas Button */}
          <button
            type="button"
            onClick={handleToggleArchived}
            className={`px-4 py-2.5 rounded-2xl border text-xs font-mono font-bold flex items-center justify-center gap-2 cursor-pointer transition-all shrink-0 ${
              isArchivedView
                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.35)]'
                : 'bg-[#060e1d]/90 border-slate-700/80 text-slate-200 hover:border-cyan-400/60 hover:text-white hover:bg-[#09152b]'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">
              {isArchivedView ? 'visibility' : 'inventory_2'}
            </span>
            <span>{isArchivedView ? 'Ver Activas' : 'Ver Archivadas'}</span>
            {counts.archived > 0 && !isArchivedView && (
              <span className="text-[10px] bg-[#02050c] px-1.5 py-0.5 rounded border border-cyan-500/30 text-slate-300">
                {counts.archived}
              </span>
            )}
          </button>

          {/* Center Search Input */}
          <div className="relative flex-1 group">
            <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-cyan-400/70 text-[19px] group-focus-within:text-cyan-300 transition-colors pointer-events-none">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Buscar por nombre, teléfono, marca, modelo, año o tipo de pieza..."
              className="w-full bg-[#040814]/90 border border-slate-700/80 group-focus-within:border-cyan-400 text-xs text-white placeholder:text-slate-400 rounded-2xl py-2.5 pl-10 pr-9 focus:outline-none focus:ring-2 focus:ring-cyan-400/30 transition-all shadow-[inset_0_0_12px_rgba(0,0,0,0.6)]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => handleSearchChange('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-800 transition cursor-pointer"
                title="Limpiar búsqueda"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            )}
          </div>

          {/* Filtros Toggle Button */}
          <button
            type="button"
            onClick={() => setShowFilters((prev) => !prev)}
            className={`px-4 py-2.5 rounded-2xl border text-xs font-mono font-bold flex items-center justify-center gap-2 cursor-pointer transition-all shrink-0 ${
              showFilters || activeFiltersCount > 0
                ? 'bg-blue-600/20 border-blue-400 text-blue-300 shadow-[0_0_15px_rgba(59,130,246,0.35)]'
                : 'bg-[#060e1d]/90 border-slate-700/80 text-slate-200 hover:border-cyan-400/60 hover:text-white hover:bg-[#09152b]'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">
              {showFilters ? 'tune' : 'filter_alt'}
            </span>
            <span>Filtros</span>
            {activeFiltersCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-cyan-400 text-slate-950 font-black text-[10px] flex items-center justify-center shadow-[0_0_8px_#22d3ee]">
                {activeFiltersCount}
              </span>
            )}
          </button>
        </div>

        {/* Row 2: Filter Grid (ESTADO, OPERADOR, MARCA, TIPO DE PIEZA, DESDE, HASTA) */}
        {showFilters && (
          <div className="pt-2 border-t border-cyan-500/15 animate-in fade-in duration-200">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {/* 1. ESTADO */}
              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-slate-400 tracking-wider mb-1.5">
                  ESTADO
                </label>
                <div className="relative">
                  <select
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="w-full appearance-none bg-[#040814]/90 border border-slate-700/80 hover:border-cyan-500/40 focus:border-cyan-400 text-xs text-white rounded-xl pl-3 pr-8 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-400/40 transition cursor-pointer"
                  >
                    <option value="all" className="bg-[#060c18] text-white">Todos</option>
                    <option value="cotizacion" className="bg-[#060c18] text-amber-300">Cotización</option>
                    <option value="espera_confirmacion" className="bg-[#060c18] text-amber-300">En espera de confirmación</option>
                    <option value="pagado" className="bg-[#060c18] text-blue-300">Pagado</option>
                    <option value="en_preparacion" className="bg-[#060c18] text-cyan-300">En preparación</option>
                    <option value="listo_despacho" className="bg-[#060c18] text-purple-300">Listo para despacho</option>
                    <option value="listo_retiro" className="bg-[#060c18] text-purple-300">Listo para retiro</option>
                    <option value="en_camino" className="bg-[#060c18] text-cyan-300">En camino</option>
                    <option value="entregado" className="bg-[#060c18] text-emerald-300">Entregado</option>
                    <option value="reclamo" className="bg-[#060c18] text-red-300">Reclamo</option>
                    <option value="cancelado" className="bg-[#060c18] text-slate-400">Cancelado</option>
                    <option value="solicitud_reembolso" className="bg-[#060c18] text-amber-300">Solicitud de reembolso</option>
                    <option value="reembolsado" className="bg-[#060c18] text-amber-300">Reembolsado</option>
                    <option value="archivado" className="bg-[#060c18] text-slate-400">Archivado</option>
                  </select>
                  <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[16px] pointer-events-none">
                    expand_more
                  </span>
                </div>
              </div>

              {/* 2. OPERADOR */}
              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-slate-400 tracking-wider mb-1.5">
                  OPERADOR
                </label>
                <div className="relative">
                  <select
                    value={operatorFilter}
                    onChange={(e) => {
                      setOperatorFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="w-full appearance-none bg-[#040814]/90 border border-slate-700/80 hover:border-cyan-500/40 focus:border-cyan-400 text-xs text-white rounded-xl pl-3 pr-8 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-400/40 transition cursor-pointer"
                  >
                    <option value="all" className="bg-[#060c18] text-white">Todos los Operadores</option>
                    {uniqueOperators.map((op) => (
                      <option key={op} value={op} className="bg-[#060c18] text-white">
                        {op}
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[16px] pointer-events-none">
                    expand_more
                  </span>
                </div>
              </div>

              {/* 3. MARCA */}
              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-slate-400 tracking-wider mb-1.5">
                  MARCA
                </label>
                <div className="relative">
                  <select
                    value={makeFilter}
                    onChange={(e) => {
                      setMakeFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="w-full appearance-none bg-[#040814]/90 border border-slate-700/80 hover:border-cyan-500/40 focus:border-cyan-400 text-xs text-white rounded-xl pl-3 pr-8 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-400/40 transition cursor-pointer"
                  >
                    <option value="all" className="bg-[#060c18] text-white">Todas</option>
                    {uniqueMakes.map((mk) => (
                      <option key={mk} value={mk} className="bg-[#060c18] text-white">
                        {mk}
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[16px] pointer-events-none">
                    expand_more
                  </span>
                </div>
              </div>

              {/* 4. TIPO DE PIEZA */}
              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-slate-400 tracking-wider mb-1.5">
                  TIPO DE PIEZA
                </label>
                <div className="relative">
                  <select
                    value={partTypeFilter}
                    onChange={(e) => {
                      setPartTypeFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="w-full appearance-none bg-[#040814]/90 border border-slate-700/80 hover:border-cyan-500/40 focus:border-cyan-400 text-xs text-white rounded-xl pl-3 pr-8 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-400/40 transition cursor-pointer"
                  >
                    <option value="all" className="bg-[#060c18] text-white">Todos</option>
                    {uniquePartTypes.map((pt) => (
                      <option key={pt} value={pt} className="bg-[#060c18] text-white">
                        {pt}
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[16px] pointer-events-none">
                    expand_more
                  </span>
                </div>
              </div>

              {/* 5. DESDE */}
              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-slate-400 tracking-wider mb-1.5">
                  DESDE
                </label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => {
                    setFromDate(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full bg-[#040814]/90 border border-slate-700/80 hover:border-cyan-500/40 focus:border-cyan-400 text-xs text-white rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-400/40 transition [color-scheme:dark]"
                />
              </div>

              {/* 6. HASTA */}
              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-slate-400 tracking-wider mb-1.5">
                  HASTA
                </label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => {
                    setToDate(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full bg-[#040814]/90 border border-slate-700/80 hover:border-cyan-500/40 focus:border-cyan-400 text-xs text-white rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-400/40 transition [color-scheme:dark]"
                />
              </div>
            </div>

            {/* Active filters summary and clear button */}
            {(activeFiltersCount > 0 || searchQuery.trim() !== '' || isArchivedView) && (
              <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-cyan-500/10 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-cyan-300 font-mono text-[11px] font-bold">
                    {filteredOrders.length} {filteredOrders.length === 1 ? 'orden encontrada' : 'órdenes encontradas'}
                  </span>
                  {activeFiltersCount > 0 && (
                    <span className="text-slate-400 text-[10.5px] font-mono">
                      ({activeFiltersCount} {activeFiltersCount === 1 ? 'filtro activo' : 'filtros activos'})
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 text-[11px] font-mono font-bold flex items-center gap-1 transition cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[14px]">restart_alt</span>
                  <span>Limpiar filtros</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Glassmorphic Data Table */}
      <div className="relative rounded-3xl bg-[#070c18]/94 backdrop-blur-2xl border border-cyan-500/25 shadow-[0_20px_50px_rgba(0,0,0,0.75)] overflow-hidden flex flex-col">
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 shadow-[0_0_12px_#22d3ee]" />

        <div className="table-responsive-wrapper custom-scrollbar">
          <table className="w-full text-left whitespace-nowrap border-collapse min-w-[920px]">
            <thead className="bg-[#040814]/95 border-b border-cyan-500/20 sticky top-0 z-10">
              <tr className="font-mono text-[10px] sm:text-[10.5px] text-cyan-400/80 uppercase tracking-wider">
                <th className="px-4 py-3 font-bold">Código & Fecha</th>
                <th className="px-4 py-3 font-bold">Cliente</th>
                <th className="px-4 py-3 font-bold">Vehículo & VIN</th>
                <th className="px-4 py-3 font-bold">Refacción Solicitada</th>
                <th className="px-4 py-3 font-bold">Tipo Entrega</th>
                <th className="px-4 py-3 font-bold">Estatus</th>
                <th className="px-4 py-3 font-bold text-right">Balance Financiero</th>
                <th className="px-4 py-3 font-bold text-center w-14">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cyan-500/10 text-xs">
              {paginatedOrders.map((order) => {
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
                    <td className="px-4 py-3 sm:px-5 sm:py-3.5">
                      <div className="flex flex-col">
                        <span className="font-mono font-black text-xs sm:text-sm text-cyan-300 group-hover:text-cyan-200 group-hover:underline drop-shadow-[0_0_8px_rgba(34,211,238,0.4)]">
                          {order.code}
                        </span>
                        <span className="text-[10.5px] text-slate-400 font-mono mt-0.5">
                          {order.createdAt}
                        </span>
                      </div>
                    </td>

                    {/* Cliente */}
                    <td className="px-4 py-3 sm:px-5 sm:py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-[#0b162b] flex items-center justify-center text-cyan-300 font-bold text-[11px] sm:text-xs border border-cyan-400/30 shrink-0 shadow-[0_0_8px_rgba(6,182,212,0.2)]">
                          {order.customer.initials}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-white font-bold leading-tight group-hover:text-cyan-200 truncate">
                            {order.customer.name}
                          </span>
                          <span className="text-slate-400 text-[10.5px] font-mono truncate">
                            {order.customer.phone}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Vehículo & VIN */}
                    <td className="px-4 py-3 sm:px-5 sm:py-3.5">
                      <div className="flex flex-col">
                        <span className="text-slate-200 font-medium leading-tight">
                          {order.vehicle.year} {order.vehicle.make} {order.vehicle.model}
                        </span>
                        <span className="font-mono text-[10.5px] text-slate-400 truncate max-w-[170px]">
                          {order.vehicle.vin ? `VIN: ${order.vehicle.vin}` : 'Sin VIN'}
                        </span>
                      </div>
                    </td>

                    {/* Refacción */}
                    <td className="px-4 py-3 sm:px-5 sm:py-3.5">
                      <div className="flex flex-col">
                        <span className="text-slate-100 font-semibold">{order.mainPart}</span>
                        {order.stockNumber && (
                          <span className="font-mono text-[9.5px] text-emerald-400 font-bold">
                            Stock: {order.stockNumber}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Tipo Entrega */}
                    <td className="px-4 py-3 sm:px-5 sm:py-3.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            order.deliveryType === 'envio_domicilio'
                              ? 'bg-cyan-400 shadow-[0_0_6px_#22d3ee]'
                              : 'bg-emerald-400 shadow-[0_0_6px_#34d399]'
                          }`}
                        />
                        <span className="text-[11.5px] font-mono text-slate-300">
                          {order.deliveryType === 'envio_domicilio' ? 'Envío Domicilio' : 'Retiro Tienda'}
                        </span>
                      </div>
                    </td>

                    {/* Estatus */}
                    <td className="px-4 py-3 sm:px-5 sm:py-3.5">
                      {renderStatusBadge(order.status)}
                    </td>

                    {/* Finanzas */}
                    <td className="px-4 py-3 sm:px-5 sm:py-3.5 text-right">
                      <div className="flex flex-col items-end">
                        <span className="font-mono text-xs sm:text-sm font-black text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.3)]">
                          ${totalPayable.toFixed(2)}
                        </span>
                        {downPayment > 0 ? (
                          <span className="font-mono text-[10.5px] text-emerald-400 font-semibold">
                            Abono: ${downPayment.toFixed(2)}
                          </span>
                        ) : (
                          <span className="font-mono text-[10.5px] text-red-400">
                            Sin Abono ($0.00)
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Acciones */}
                    <td className="px-3 py-3 sm:px-4 sm:py-3.5 text-center relative" onClick={(e) => e.stopPropagation()}>
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

        {/* Table Footer with Pagination & Page Size Selector */}
        <div className="bg-[#040814]/95 border-t border-cyan-500/20 px-5 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Left: Summary info */}
          <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
            <span>
              Mostrando{' '}
              <strong className="text-cyan-300 font-bold">
                {totalOrders === 0 ? 0 : startIndex + 1} - {endIndex}
              </strong>{' '}
              de <strong className="text-white font-bold">{totalOrders}</strong> órdenes
            </span>
            <span className="hidden md:inline-block text-slate-600">|</span>
            <span className="hidden md:inline-block text-[11px] text-slate-400">
              Vista: <strong className="text-cyan-400 uppercase">{segmentView}</strong>
            </span>
          </div>

          {/* Right: Controls (Page Size Selector + Pagination) */}
          <div className="flex flex-wrap items-center gap-4">
            {/* Page Size Selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-mono">Mostrar:</span>
              <div className="relative">
                <select
                  value={pageSize}
                  onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                  className="appearance-none bg-[#070e1c] border border-cyan-500/30 hover:border-cyan-400 text-cyan-300 rounded-xl pl-3 pr-8 py-1.5 text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-cyan-400/50 cursor-pointer shadow-[0_0_12px_rgba(6,182,212,0.15)] transition"
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size} className="bg-[#060c18] text-white">
                      {size} por pág.
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-cyan-400 text-[16px] pointer-events-none">
                  expand_more
                </span>
              </div>
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center gap-1 bg-[#02050e]/80 p-1 rounded-2xl border border-cyan-500/20">
              {/* First Page */}
              <button
                onClick={() => setCurrentPage(1)}
                disabled={validCurrentPage === 1}
                className="p-1.5 rounded-xl hover:bg-cyan-500/10 text-slate-400 hover:text-cyan-300 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition cursor-pointer disabled:cursor-not-allowed"
                title="Primera página"
              >
                <span className="material-symbols-outlined text-[16px]">first_page</span>
              </button>

              {/* Previous Page */}
              <button
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={validCurrentPage === 1}
                className="p-1.5 rounded-xl hover:bg-cyan-500/10 text-slate-400 hover:text-cyan-300 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition cursor-pointer disabled:cursor-not-allowed"
                title="Página anterior"
              >
                <span className="material-symbols-outlined text-[16px]">chevron_left</span>
              </button>

              {/* Page Number Buttons */}
              <div className="flex items-center gap-1 px-1">
                {visiblePages.map((page, index) => {
                  if (page === '...') {
                    return (
                      <span
                        key={`ellipsis-${index}`}
                        className="px-2 py-1 text-slate-500 text-xs font-mono select-none"
                      >
                        ...
                      </span>
                    );
                  }
                  const pageNum = Number(page);
                  const isActive = pageNum === validCurrentPage;
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`min-w-[28px] h-7 px-2 rounded-xl font-mono text-xs font-bold transition flex items-center justify-center cursor-pointer ${
                        isActive
                          ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-black shadow-[0_0_12px_rgba(6,182,212,0.45)]'
                          : 'text-slate-300 hover:bg-cyan-500/10 hover:text-cyan-300'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>

              {/* Next Page */}
              <button
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={validCurrentPage >= totalPages}
                className="p-1.5 rounded-xl hover:bg-cyan-500/10 text-slate-400 hover:text-cyan-300 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition cursor-pointer disabled:cursor-not-allowed"
                title="Página siguiente"
              >
                <span className="material-symbols-outlined text-[16px]">chevron_right</span>
              </button>

              {/* Last Page */}
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={validCurrentPage >= totalPages}
                className="p-1.5 rounded-xl hover:bg-cyan-500/10 text-slate-400 hover:text-cyan-300 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition cursor-pointer disabled:cursor-not-allowed"
                title="Última página"
              >
                <span className="material-symbols-outlined text-[16px]">last_page</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
