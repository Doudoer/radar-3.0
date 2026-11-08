import React, { useState, useMemo } from 'react';
import { Order, OrderStatus, OrderSegmentView } from '../types';
import { InventoryAvailabilityBadge } from './OrderInventoryAvailability';

interface OrdersTableViewProps {
  orders: Order[];
  onSelectOrder: (orderId: string) => void;
  onOpenNewOrder: () => void;
  onEditOrder?: (order: Order) => void;
  onExport: () => void;
  onStatusRequest: () => void;
  onUpdateStatus?: (orderId: string, newStatus: OrderStatus) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  lastSyncedAt?: Date | null;
  initialSearchQuery?: string;
}

const PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100] as const;

type QuickFilterType = 'all' | 'pending_balance' | 'with_core' | 'ready' | 'auction';

const QUICK_FILTER_LABELS: Record<Exclude<QuickFilterType, 'all'>, string> = {
  pending_balance: 'Con saldo pendiente',
  with_core: 'Con core por cobrar',
  ready: 'Listos para retiro / envío',
  auction: 'Subasta activa',
};

const STATUS_LABELS: Record<string, string> = {
  cotizacion: 'Cotización',
  espera_confirmacion: 'En espera de confirmación',
  pagado: 'Pagado',
  en_preparacion: 'En preparación',
  listo_despacho: 'Listo para despacho',
  listo_retiro: 'Listo para retiro',
  en_camino: 'En camino',
  entregado: 'Entregado',
  reclamo: 'Reclamo',
  cancelado: 'Cancelado',
  solicitud_reembolso: 'Solicitud de reembolso',
  reembolsado: 'Reembolsado',
  archivado: 'Archivado',
};

const PIPELINE_STEP_NAMES = ['Cotización', 'Anticipo', 'Preparación', 'Entrega'] as const;

export const OrdersTableView: React.FC<OrdersTableViewProps> = ({
  orders,
  onSelectOrder,
  onOpenNewOrder,
  onEditOrder,
  onExport,
  onStatusRequest,
  onUpdateStatus,
  onRefresh,
  isRefreshing = false,
  lastSyncedAt,
  initialSearchQuery = '',
}) => {
  const [segmentView, setSegmentView] = useState<OrderSegmentView>('active');
  const [isArchivedView, setIsArchivedView] = useState(false);
  const [showFilters, setShowFilters] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('radar_orders_show_filters');
      if (saved !== null) return saved === 'true';
      if (window.innerWidth < 768) return false;
    }
    return false;
  });

  const handleToggleFilters = () => {
    setShowFilters((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('radar_orders_show_filters', String(next));
      }
      return next;
    });
  };
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [operatorFilter, setOperatorFilter] = useState<string>('all');
  const [makeFilter, setMakeFilter] = useState<string>('all');
  const [partTypeFilter, setPartTypeFilter] = useState<string>('all');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [quickFilter, setQuickFilter] = useState<QuickFilterType>('all');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('radar_orders_view_mode');
      if (saved === 'cards' || saved === 'table') {
        if (window.innerWidth < 768) return 'cards';
        return saved;
      }
      if (window.innerWidth < 768) return 'cards';
    }
    return 'cards';
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [activeActionMenu, setActiveActionMenu] = useState<string | null>(null);
  const [copiedVinId, setCopiedVinId] = useState<string | null>(null);

  const handleViewModeChange = (mode: 'cards' | 'table') => {
    setViewMode(mode);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('radar_orders_view_mode', mode);
      } catch {
        // ignore storage errors
      }
    }
  };

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
    setQuickFilter('all');
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
    setQuickFilter('all');
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

  const handleQuickFilterToggle = (filter: Exclude<QuickFilterType, 'all'>) => {
    setQuickFilter((prev) => (prev === filter ? 'all' : filter));
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
    setQuickFilter('all');
    setIsArchivedView(false);
    setSegmentView('active');
    setCurrentPage(1);
  };

  const handleCopyVin = (e: React.MouseEvent, vin: string, orderId: string) => {
    e.stopPropagation();
    if (!vin) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(vin).catch(() => {});
    }
    setCopiedVinId(orderId);
    setTimeout(() => {
      setCopiedVinId((prev) => (prev === orderId ? null : prev));
    }, 1800);
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

  // Financial snapshot per order (same formula used historically by this table)
  const getOrderFinancials = (order: Order) => {
    const partPrice = order.financials.partPrice ?? order.financials.baseMSRP ?? 1000;
    const downPayment = order.financials.downPayment ?? order.financials.advancePayment ?? 0;
    const deliveryFee = order.financials.deliveryFee ?? 0;
    const coreFee = order.financials.coreFee ?? 0;
    const grossSubtotal = partPrice + deliveryFee + coreFee;
    const totalPayable = Math.max(0, grossSubtotal - downPayment);
    const paidPercentage = grossSubtotal > 0 ? Math.min(100, Math.round((downPayment / grossSubtotal) * 100)) : 100;
    return { downPayment, coreFee, grossSubtotal, totalPayable, paidPercentage };
  };

  const hasCoreCommitment = (order: Order): boolean => {
    const prep = (order as unknown as { preparation?: { coreOption?: string } | null }).preparation;
    return (order.financials.coreFee ?? 0) > 0 || prep?.coreOption === 'pay_core';
  };

  // Workflow pipeline stage (1..4) derived from status
  const getOrderPipeline = (order: Order): { step: number; label: string; isDone: boolean; isHalted: boolean } => {
    switch (order.status) {
      case 'entregado':
        return { step: 4, label: 'Entregado', isDone: true, isHalted: false };
      case 'listo_retiro':
      case 'listo_despacho':
      case 'en_camino':
        return { step: 4, label: 'Entrega y liquidación', isDone: false, isHalted: false };
      case 'en_preparacion':
        return { step: 3, label: 'Preparación y cita', isDone: false, isHalted: false };
      case 'pagado':
      case 'facturado':
        return order.workflowStep >= 3
          ? { step: 3, label: 'Preparación y cita', isDone: false, isHalted: false }
          : { step: 2, label: 'Confirmación de anticipo', isDone: false, isHalted: false };
      case 'cancelado':
      case 'archivado':
      case 'solicitud_reembolso':
      case 'reembolsado':
      case 'reclamo':
        return {
          step: Math.min(4, Math.max(1, order.workflowStep || 1)),
          label: STATUS_LABELS[order.status] || order.status,
          isDone: false,
          isHalted: true,
        };
      default:
        return { step: 1, label: 'Cotización', isDone: false, isHalted: false };
    }
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
    if (quickFilter !== 'all') count++;
    return count;
  }, [statusFilter, operatorFilter, makeFilter, partTypeFilter, fromDate, toDate, quickFilter]);

  // Helper to check if order has auction search active or has links (solo órdenes pagadas)
  const isOrderAuction = (o: Order) => o.status === 'pagado' && Boolean(o.auctionActive || (o.auctionLinks && o.auctionLinks.length > 0));

  // Segment Counts
  const counts = useMemo(() => {
    let active = 0;
    let readyPickup = 0;
    let expiredWarranty = 0;
    let cancelled = 0;
    let refunds = 0;
    let archived = 0;
    let auction = 0;

    orders.forEach((o) => {
      if (isOrderAuction(o) && o.status !== 'archivado' && o.status !== 'cancelado') {
        auction++;
      }
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

    return { active, readyPickup, expiredWarranty, cancelled, refunds, archived, auction, total: orders.length };
  }, [orders]);

  // Base filtered orders before applying quick-filter pills (to calculate accurate dynamic live counts)
  const baseSegmentOrders = useMemo(() => {
    const isSearching = Boolean(searchQuery.trim());

    return orders.filter((order) => {
      // 1. Status, Archived & Segment Filter
      if (!isSearching) {
        if (isArchivedView) {
          if (order.status !== 'archivado') return false;
        } else {
          if (statusFilter !== 'all') {
            if (order.status !== statusFilter) return false;
          } else {
            // Segment View Filter
            if (segmentView === 'ready_pickup') {
              if (order.status !== 'listo_retiro') return false;
            } else if (segmentView === 'auction') {
              if (!isOrderAuction(order) || order.status === 'archivado') return false;
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
      if (isSearching) {
        const query = searchQuery.toLowerCase().trim();
        const matchesCode = (order.code || '').toLowerCase().includes(query) || (order.id || '').toLowerCase().includes(query);
        const matchesCustomer = (order.customer?.name || '').toLowerCase().includes(query) ||
          (order.customer?.phone || '').includes(query) ||
          (order.customer?.whatsapp || '').includes(query) ||
          (order.customer?.email || '').toLowerCase().includes(query);
        const matchesVehicle = (order.vehicle?.make || '').toLowerCase().includes(query) ||
          (order.vehicle?.model || '').toLowerCase().includes(query) ||
          (order.vehicle?.year ? String(order.vehicle.year).includes(query) : false) ||
          (order.vehicle?.vin || '').toLowerCase().includes(query) ||
          (order.vehicle?.plate || '').toLowerCase().includes(query);
        const matchesPart = (order.mainPart || '').toLowerCase().includes(query) ||
          (order.productSpecs || '').toLowerCase().includes(query);
        const matchesStock = (order.stockNumber || '').toLowerCase().includes(query);
        const matchesAdvisor = (order.advisor || '').toLowerCase().includes(query);
        const matchesAuction = (query === 'subasta' && isOrderAuction(order)) ||
          (order.auctionLinks || []).some((l) => (l.auctionHouse || '').toLowerCase().includes(query) || (l.url || '').toLowerCase().includes(query));

        if (!matchesCode && !matchesCustomer && !matchesVehicle && !matchesPart && !matchesStock && !matchesAdvisor && !matchesAuction) {
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

  // Live counters for quick-filter pills based on current segment
  const quickFilterCounts = useMemo(() => {
    let pendingBalance = 0;
    let withCore = 0;
    let ready = 0;
    let auction = 0;

    baseSegmentOrders.forEach((order) => {
      if (getOrderFinancials(order).totalPayable > 0) pendingBalance++;
      if (hasCoreCommitment(order)) withCore++;
      if (order.status === 'listo_retiro' || order.status === 'listo_despacho' || order.status === 'en_camino') ready++;
      if (isOrderAuction(order)) auction++;
    });

    return {
      all: baseSegmentOrders.length,
      pending_balance: pendingBalance,
      with_core: withCore,
      ready,
      auction,
    };
  }, [baseSegmentOrders]);

  // Filtered orders with quickFilter applied
  const filteredOrders = useMemo(() => {
    if (quickFilter === 'all') return baseSegmentOrders;

    return baseSegmentOrders.filter((order) => {
      if (quickFilter === 'pending_balance') {
        return getOrderFinancials(order).totalPayable > 0;
      }
      if (quickFilter === 'with_core') {
        return hasCoreCommitment(order);
      }
      if (quickFilter === 'ready') {
        return order.status === 'listo_retiro' || order.status === 'listo_despacho' || order.status === 'en_camino';
      }
      if (quickFilter === 'auction') {
        return isOrderAuction(order);
      }
      return true;
    });
  }, [baseSegmentOrders, quickFilter]);

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
      case 'en_preparacion':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-cyan-500/15 border border-cyan-400/40 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.3)]">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            En Preparación
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

  const renderDismissChip = (label: string, onDismiss: () => void, tone: string) => (
    <span className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-lg border font-mono text-[10.5px] ${tone}`}>
      {label}
      <button
        type="button"
        onClick={() => {
          onDismiss();
          setCurrentPage(1);
        }}
        aria-label={`Quitar filtro ${label}`}
        className="w-4 h-4 rounded-md flex items-center justify-center hover:bg-white/10 hover:text-white cursor-pointer"
      >
        <span className="material-symbols-outlined text-[12px]">close</span>
      </button>
    </span>
  );

  const quickFilterButtons: {
    id: Exclude<QuickFilterType, 'all'>;
    icon: string;
    active: string;
    idle: string;
    iconColor: string;
    countKey: 'pending_balance' | 'with_core' | 'ready' | 'auction';
  }[] = [
    {
      id: 'pending_balance',
      icon: 'payments',
      active: 'bg-amber-500/20 border-amber-400 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.35)]',
      idle: 'hover:border-amber-400/50',
      iconColor: 'text-amber-400',
      countKey: 'pending_balance',
    },
    {
      id: 'with_core',
      icon: 'autorenew',
      active: 'bg-purple-500/20 border-purple-400 text-purple-300 shadow-[0_0_12px_rgba(168,85,247,0.35)]',
      idle: 'hover:border-purple-400/50',
      iconColor: 'text-purple-400',
      countKey: 'with_core',
    },
    {
      id: 'ready',
      icon: 'local_shipping',
      active: 'bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.35)]',
      idle: 'hover:border-emerald-400/50',
      iconColor: 'text-emerald-400',
      countKey: 'ready',
    },
    {
      id: 'auction',
      icon: 'gavel',
      active: 'bg-amber-500/20 border-amber-400 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.35)]',
      idle: 'hover:border-amber-400/50',
      iconColor: 'text-amber-400',
      countKey: 'auction',
    },
  ];

  return (
    <div className="radar-view horizon-view horizon-orders select-none pb-8">
      {/* Page Header */}
      <div className="horizon-orders-heading flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="horizon-section-title">
              Gestión de órdenes
            </h2>
            <span className="inline-flex items-center justify-center bg-emerald-500/15 border border-emerald-400/40 rounded-full px-3 py-0.5 font-mono text-emerald-300 text-xs font-black shadow-[0_0_10px_rgba(16,185,129,0.25)]">
              {counts.active} Activas
            </span>
            {searchQuery.trim() && (
              <span className="inline-flex items-center gap-1.5 justify-center bg-cyan-500/15 border border-cyan-400/40 rounded-full px-3 py-0.5 font-mono text-cyan-300 text-xs font-bold shadow-[0_0_10px_rgba(6,182,212,0.25)]">
                <span className="material-symbols-outlined text-[13px]">search</span>
                <span>{filteredOrders.length} {filteredOrders.length === 1 ? 'coincidencia' : 'coincidencias'} (todos los estatus)</span>
              </span>
            )}
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-950/50 border border-cyan-500/30 text-[10px] font-mono text-cyan-300 font-semibold shadow-sm"
              title="Sincronización automática de órdenes activa cada 5 minutos"
            >
              <span className={`w-1.5 h-1.5 rounded-full bg-cyan-400 ${isRefreshing ? 'animate-ping' : 'animate-pulse'}`} />
              <span>{isRefreshing ? 'Sincronizando...' : 'Auto-sync 5 min'}</span>
            </span>
          </div>
          <p className="text-xs text-slate-400 font-mono mt-1">
            Control de inventario, despacho, VIN y balance financiero por orden.
          </p>
        </div>

        {/* Action Controls */}
        <div className="horizon-order-actions flex items-center gap-2.5 flex-wrap">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              title="Sincronizar y actualizar lista de órdenes ahora"
              className="px-3 py-2 rounded-2xl bg-[#060e1d]/90 border border-cyan-500/30 text-xs font-mono font-bold text-slate-200 hover:border-cyan-400 hover:bg-[#09152b] transition-all flex items-center gap-1.5 cursor-pointer shadow-[0_0_15px_rgba(6,182,212,0.15)] disabled:opacity-50 active:scale-95"
            >
              <span className={`material-symbols-outlined text-[16px] text-cyan-400 ${isRefreshing ? 'animate-spin' : ''}`}>
                refresh
              </span>
              <span className="hidden sm:inline">Actualizar</span>
            </button>
          )}

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
      <nav aria-label="Estatus de órdenes" className="horizon-order-segments flex items-center gap-2 overflow-x-auto flex-nowrap scrollbar-none py-1 -mx-2 px-2 sm:mx-0 sm:px-0 touch-pan-x">
        {/* Activas */}
        <button
          onClick={() => handleSegmentChange('active')}
          aria-pressed={segmentView === 'active' && !isArchivedView}
          className={`shrink-0 text-xs py-1.5 px-3.5 rounded-xl transition-all font-mono font-bold flex items-center gap-2 cursor-pointer ${
            segmentView === 'active' && !isArchivedView
              ? 'bg-emerald-500/20 border-2 border-emerald-400 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.35)]'
              : 'bg-[#040814] border border-cyan-500/20 text-slate-300 hover:border-cyan-400/50 hover:text-white'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">inventory_2</span>
          <span>Órdenes Activas</span>
          <span className="text-[10px] bg-[#02050c] px-2 py-0.5 rounded-md border border-cyan-500/25 text-white">
            {counts.active}
          </span>
        </button>

        {/* Búsqueda Subasta */}
        <button
          onClick={() => handleSegmentChange('auction')}
          aria-pressed={segmentView === 'auction' && !isArchivedView}
          className={`shrink-0 text-xs py-1.5 px-3.5 rounded-xl transition-all font-mono font-bold flex items-center gap-2 cursor-pointer ${
            segmentView === 'auction' && !isArchivedView
              ? 'bg-amber-100 dark:bg-amber-500/20 border-2 border-amber-500 dark:border-amber-400 text-amber-950 dark:text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.35)]'
              : 'bg-white dark:bg-[#040814] border border-slate-200 dark:border-cyan-500/20 text-slate-700 dark:text-slate-300 hover:border-amber-400/50 hover:text-amber-900 dark:hover:text-white'
          }`}
          title="Ver solo órdenes marcadas para búsqueda en subasta"
        >
          <span className="material-symbols-outlined text-[15px] text-amber-600 dark:text-amber-400">gavel</span>
          <span>Búsqueda Subasta</span>
          <span className="text-[10px] bg-amber-50 dark:bg-[#02050c] px-2 py-0.5 rounded-md border border-amber-300 dark:border-amber-500/30 text-amber-900 dark:text-amber-300 font-bold">
            {counts.auction}
          </span>
        </button>

        {/* Listo para Retiro */}
        <button
          onClick={() => handleSegmentChange('ready_pickup')}
          aria-pressed={segmentView === 'ready_pickup' && !isArchivedView}
          className={`shrink-0 text-xs py-1.5 px-3.5 rounded-xl transition-all font-mono font-bold flex items-center gap-2 cursor-pointer ${
            segmentView === 'ready_pickup' && !isArchivedView
              ? 'bg-purple-500/20 border-2 border-purple-400 text-purple-300 shadow-[0_0_15px_rgba(168,85,247,0.35)]'
              : 'bg-[#040814] border border-cyan-500/20 text-slate-300 hover:border-cyan-400/50 hover:text-white'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">storefront</span>
          <span>Listo para Retiro</span>
          <span className="text-[10px] bg-[#02050c] px-2 py-0.5 rounded-md border border-cyan-500/25 text-white">
            {counts.readyPickup}
          </span>
        </button>

        {/* Garantías Vencidas */}
        <button
          onClick={() => handleSegmentChange('expired_warranty')}
          aria-pressed={segmentView === 'expired_warranty' && !isArchivedView}
          className={`shrink-0 text-xs py-1.5 px-3.5 rounded-xl transition-all font-mono font-bold flex items-center gap-2 cursor-pointer ${
            segmentView === 'expired_warranty' && !isArchivedView
              ? 'bg-amber-500/20 border-2 border-amber-400 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.35)]'
              : 'bg-[#040814] border border-cyan-500/20 text-slate-300 hover:border-cyan-400/50 hover:text-white'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">hourglass_empty</span>
          <span>Garantías Vencidas</span>
          <span className="text-[10px] bg-[#02050c] px-2 py-0.5 rounded-md border border-cyan-500/25 text-white">
            {counts.expiredWarranty}
          </span>
        </button>

        {/* Canceladas */}
        <button
          onClick={() => handleSegmentChange('cancelled')}
          aria-pressed={segmentView === 'cancelled' && !isArchivedView}
          className={`shrink-0 text-xs py-1.5 px-3.5 rounded-xl transition-all font-mono font-bold flex items-center gap-2 cursor-pointer ${
            segmentView === 'cancelled' && !isArchivedView
              ? 'bg-red-500/20 border-2 border-red-400 text-red-300 shadow-[0_0_15px_rgba(239,68,68,0.35)]'
              : 'bg-[#040814] border border-cyan-500/20 text-slate-300 hover:border-cyan-400/50 hover:text-white'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">cancel</span>
          <span>Canceladas</span>
          <span className="text-[10px] bg-[#02050c] px-2 py-0.5 rounded-md border border-cyan-500/25 text-white">
            {counts.cancelled}
          </span>
        </button>

        {/* Reembolsos */}
        <button
          onClick={() => handleSegmentChange('refunds')}
          aria-pressed={segmentView === 'refunds' && !isArchivedView}
          className={`shrink-0 text-xs py-1.5 px-3.5 rounded-xl transition-all font-mono font-bold flex items-center gap-2 cursor-pointer ${
            segmentView === 'refunds' && !isArchivedView
              ? 'bg-amber-500/20 border-2 border-amber-400 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.35)]'
              : 'bg-[#040814] border border-cyan-500/20 text-slate-300 hover:border-cyan-400/50 hover:text-white'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">currency_exchange</span>
          <span>Reembolsos</span>
          <span className="text-[10px] bg-[#02050c] px-2 py-0.5 rounded-md border border-cyan-500/25 text-white">
            {counts.refunds}
          </span>
        </button>

        {/* Archivadas */}
        <button
          onClick={() => handleSegmentChange('archived')}
          aria-pressed={isArchivedView || segmentView === 'archived'}
          className={`shrink-0 text-xs py-1.5 px-3.5 rounded-xl transition-all font-mono font-bold flex items-center gap-2 cursor-pointer ${
            isArchivedView || segmentView === 'archived'
              ? 'bg-slate-700/60 border-2 border-cyan-400 text-white shadow-[0_0_15px_rgba(6,182,212,0.3)]'
              : 'bg-[#040814] border border-cyan-500/20 text-slate-300 hover:border-cyan-400/50 hover:text-white'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">archive</span>
          <span>Archivadas</span>
          <span className="text-[10px] bg-[#02050c] px-2 py-0.5 rounded-md border border-cyan-500/25 text-white">
            {counts.archived}
          </span>
        </button>
      </nav>

      {/* Main Search & Filters Card */}
      <div className="horizon-order-filters relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-4 shadow-[0_15px_35px_rgba(0,0,0,0.6)] flex flex-col gap-3.5 overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-[1.5px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_10px_#22d3ee]" />

        {/* Row 1: Search Bar & Quick Controls (Mobile App-first responsive flow) */}
        <div className="flex flex-col gap-2.5">
          {/* Top Full-width Mobile Search Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="relative flex-1 group">
              <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-cyan-400 text-[18px] group-focus-within:text-cyan-300 pointer-events-none transition-colors">
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

            {/* Controls Bar: Ver Archivadas, Filtros Toggle, View Mode Switcher */}
            <div className="flex items-center justify-between sm:justify-end gap-2 overflow-x-auto scrollbar-none py-0.5">
              <div className="flex items-center gap-2 shrink-0">
                {/* Ver Archivadas Button */}
                <button
                  type="button"
                  onClick={handleToggleArchived}
                  className={`px-3 py-2 rounded-xl border text-xs font-mono font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all shrink-0 ${
                    isArchivedView
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.35)]'
                      : 'bg-[#060e1d]/90 border-slate-700/80 text-slate-200 hover:border-cyan-400/60 hover:text-white hover:bg-[#09152b]'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {isArchivedView ? 'visibility' : 'inventory_2'}
                  </span>
                  <span>{isArchivedView ? 'Ver Activas' : 'Ver Archivadas'}</span>
                  {counts.archived > 0 && !isArchivedView && (
                    <span className="text-[10px] bg-[#02050c] px-1.5 py-0.2 rounded border border-cyan-500/30 text-slate-300">
                      {counts.archived}
                    </span>
                  )}
                </button>

                {/* Filtros Toggle Button (Accordion Trigger) */}
                <button
                  type="button"
                  onClick={handleToggleFilters}
                  aria-expanded={showFilters}
                  className={`px-3 py-2 rounded-xl border text-xs font-mono font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all shrink-0 ${
                    showFilters || activeFiltersCount > 0
                      ? 'bg-blue-600/20 border-blue-400 text-blue-300 shadow-[0_0_15px_rgba(59,130,246,0.35)]'
                      : 'bg-[#060e1d]/90 border-slate-700/80 text-slate-200 hover:border-cyan-400/60 hover:text-white hover:bg-[#09152b]'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {showFilters ? 'tune' : 'filter_alt'}
                  </span>
                  <span>Filtros</span>
                  {activeFiltersCount > 0 && (
                    <span className="w-4 h-4 rounded-full bg-cyan-400 text-slate-950 font-black text-[9px] flex items-center justify-center shadow-[0_0_8px_#22d3ee]">
                      {activeFiltersCount}
                    </span>
                  )}
                  <span className={`material-symbols-outlined text-[15px] transition-transform duration-300 ${showFilters ? 'rotate-180' : ''}`}>
                    expand_more
                  </span>
                </button>
              </div>

              {/* View Mode Toggle: Cards vs Table */}
              <div className="flex items-center gap-1 bg-[#040814]/90 p-1 rounded-xl border border-slate-700/80 shrink-0">
                <button
                  type="button"
                  onClick={() => handleViewModeChange('cards')}
                  className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 text-xs font-mono font-bold cursor-pointer ${
                    viewMode === 'cards'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.3)]'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                  }`}
                  title="Vista de Cuadrícula de Tarjetas"
                >
                  <span className="material-symbols-outlined text-[16px]">grid_view</span>
                  <span className="text-[11px]">Tarjetas</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewModeChange('table')}
                  className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 text-xs font-mono font-bold cursor-pointer ${
                    viewMode === 'table'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.3)]'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                  }`}
                  title="Vista en Tabla Compacta"
                >
                  <span className="material-symbols-outlined text-[16px]">table_rows</span>
                  <span className="text-[11px]">Tabla</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Row 2: Quick Filter Pills (1-click Swipeable Strip) with Live Counters */}
        <div className="flex items-center gap-2 overflow-x-auto flex-nowrap scrollbar-none py-1 -mx-2 px-2 touch-pan-x" role="group" aria-label="Filtros rápidos">
          <span className="text-[10px] font-mono font-bold uppercase text-slate-400 mr-1 flex items-center gap-1 shrink-0">
            <span className="material-symbols-outlined text-[14px] text-cyan-400">bolt</span>
            Filtros rápidos:
          </span>

          {/* Pill: Todos */}
          <button
            type="button"
            aria-pressed={quickFilter === 'all'}
            onClick={() => {
              setQuickFilter('all');
              setCurrentPage(1);
            }}
            className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 transition cursor-pointer border ${
              quickFilter === 'all'
                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.35)]'
                : 'bg-[#040814] border-slate-700/80 text-slate-300 hover:text-white hover:border-cyan-400/50'
            }`}
          >
            <span className="material-symbols-outlined text-[14px] text-cyan-400">format_list_bulleted</span>
            <span>Todos</span>
            <span
              className={`ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-mono font-black ${
                quickFilter === 'all'
                  ? 'bg-cyan-400/30 text-cyan-200 border border-cyan-400/50'
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}
            >
              {quickFilterCounts.all}
            </span>
          </button>

          {quickFilterButtons.map((qf) => {
            const isActive = quickFilter === qf.id;
            const count = quickFilterCounts[qf.countKey];
            return (
              <button
                key={qf.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => handleQuickFilterToggle(qf.id)}
                className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 transition cursor-pointer border ${
                  isActive
                    ? qf.active
                    : `bg-[#040814] border-slate-700/80 text-slate-300 hover:text-white ${qf.idle}`
                }`}
              >
                <span className={`material-symbols-outlined text-[14px] ${qf.iconColor}`}>{qf.icon}</span>
                <span>{QUICK_FILTER_LABELS[qf.id]}</span>
                <span
                  className={`ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-mono font-black ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  {count}
                </span>
                {isActive && <span className="material-symbols-outlined text-[13px] ml-0.5">close</span>}
              </button>
            );
          })}
        </div>

        {/* Row 3: Filter Grid Accordion Header & Collapsible Body */}
        <div className="border-t border-cyan-500/15 pt-2">
          {/* Accordion Toggle Header Bar */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleToggleFilters}
              aria-expanded={showFilters}
              aria-controls="orders-filter-accordion-body"
              className="flex items-center gap-2 text-xs font-mono font-bold text-slate-300 hover:text-cyan-300 transition-colors py-1 cursor-pointer group select-none"
            >
              <div className="w-5 h-5 rounded-md bg-slate-800/80 border border-slate-700/80 group-hover:border-cyan-400/50 flex items-center justify-center transition">
                <span className={`material-symbols-outlined text-[15px] text-cyan-400 transition-transform duration-300 ${showFilters ? 'rotate-180' : ''}`}>
                  expand_more
                </span>
              </div>
              <span>{showFilters ? 'Ocultar Filtros Detallados' : 'Mostrar Filtros Detallados'}</span>
              {activeFiltersCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-cyan-400 text-slate-950 font-black text-[9.5px] shadow-[0_0_8px_#22d3ee]">
                  {activeFiltersCount} {activeFiltersCount === 1 ? 'filtro activo' : 'filtros activos'}
                </span>
              )}
            </button>

            {activeFiltersCount > 0 && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="text-[11px] font-mono text-amber-400 hover:text-amber-300 flex items-center gap-1 transition-colors cursor-pointer py-1"
                title="Restablecer todos los filtros"
              >
                <span className="material-symbols-outlined text-[14px]">filter_alt_off</span>
                <span>Limpiar filtros</span>
              </button>
            )}
          </div>

          {/* Accordion Body with 6 Filter Controls */}
          <div
            id="orders-filter-accordion-body"
            className={`transition-all duration-300 ease-in-out ${
              showFilters ? 'block opacity-100 pt-3' : 'hidden opacity-0'
            }`}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 pt-1">
              {/* 1. ESTADO */}
              <div>
                <label className="flex items-center gap-1 text-[10px] font-mono font-bold uppercase text-slate-400 tracking-wider mb-1.5">
                  <span className="material-symbols-outlined text-[13px] text-cyan-400">flag</span>
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
                <label className="flex items-center gap-1 text-[10px] font-mono font-bold uppercase text-slate-400 tracking-wider mb-1.5">
                  <span className="material-symbols-outlined text-[13px] text-cyan-400">person</span>
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
                    <option value="all" className="bg-[#060c18] text-white">Todos</option>
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
                <label className="flex items-center gap-1 text-[10px] font-mono font-bold uppercase text-slate-400 tracking-wider mb-1.5">
                  <span className="material-symbols-outlined text-[13px] text-cyan-400">directions_car</span>
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
                <label className="flex items-center gap-1 text-[10px] font-mono font-bold uppercase text-slate-400 tracking-wider mb-1.5">
                  <span className="material-symbols-outlined text-[13px] text-cyan-400">settings</span>
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
                <label className="flex items-center gap-1 text-[10px] font-mono font-bold uppercase text-slate-400 tracking-wider mb-1.5">
                  <span className="material-symbols-outlined text-[13px] text-cyan-400">event</span>
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
                <label className="flex items-center gap-1 text-[10px] font-mono font-bold uppercase text-slate-400 tracking-wider mb-1.5">
                  <span className="material-symbols-outlined text-[13px] text-cyan-400">event</span>
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
          </div>
        </div>

        {/* Active filters: summary + dismissible chips + clear button (visible even when grid is collapsed) */}
        {(activeFiltersCount > 0 || searchQuery.trim() !== '' || isArchivedView) && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-2.5 border-t border-cyan-500/10 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-cyan-300 font-mono text-[11px] font-bold">
                {filteredOrders.length} {filteredOrders.length === 1 ? 'orden encontrada' : 'órdenes encontradas'}
              </span>
              {activeFiltersCount > 0 && (
                <span className="text-slate-400 text-[10.5px] font-mono">
                  ({activeFiltersCount} {activeFiltersCount === 1 ? 'filtro activo' : 'filtros activos'})
                </span>
              )}
              {searchQuery.trim() !== '' && (
                <span className="text-cyan-400/90 text-[10.5px] font-mono">
                  • Búsqueda global en todos los estatus
                </span>
              )}

              {statusFilter !== 'all' &&
                renderDismissChip(`Estado: ${STATUS_LABELS[statusFilter] || statusFilter}`, () => setStatusFilter('all'), 'bg-blue-500/15 border-blue-400/30 text-blue-300')}
              {operatorFilter !== 'all' &&
                renderDismissChip(`Operador: ${operatorFilter}`, () => setOperatorFilter('all'), 'bg-purple-500/15 border-purple-400/30 text-purple-300')}
              {makeFilter !== 'all' &&
                renderDismissChip(`Marca: ${makeFilter}`, () => setMakeFilter('all'), 'bg-cyan-500/15 border-cyan-400/30 text-cyan-300')}
              {partTypeFilter !== 'all' &&
                renderDismissChip(`Pieza: ${partTypeFilter}`, () => setPartTypeFilter('all'), 'bg-cyan-500/15 border-cyan-400/30 text-cyan-300')}
              {fromDate &&
                renderDismissChip(`Desde: ${fromDate}`, () => setFromDate(''), 'bg-slate-500/15 border-slate-400/30 text-slate-300')}
              {toDate &&
                renderDismissChip(`Hasta: ${toDate}`, () => setToDate(''), 'bg-slate-500/15 border-slate-400/30 text-slate-300')}
              {quickFilter !== 'all' &&
                renderDismissChip(QUICK_FILTER_LABELS[quickFilter], () => setQuickFilter('all'), 'bg-amber-500/15 border-amber-400/30 text-amber-300')}
            </div>
            <button
              type="button"
              onClick={handleClearFilters}
              className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 text-[11px] font-mono font-bold flex items-center gap-1 transition cursor-pointer shrink-0"
            >
              <span className="material-symbols-outlined text-[14px]">restart_alt</span>
              <span>Limpiar filtros</span>
            </button>
          </div>
        )}
      </div>

      {/* Main Glassmorphic Container (Cards Grid or Table) */}
      <div className="horizon-orders-table relative rounded-3xl bg-[#070c18]/94 backdrop-blur-2xl border border-cyan-500/25 shadow-[0_20px_50px_rgba(0,0,0,0.75)] overflow-hidden flex flex-col">
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 shadow-[0_0_12px_#22d3ee]" />

        {/* View Mode: Cards Grid */}
        {viewMode === 'cards' && (
          <div className="p-4 sm:p-5 custom-scrollbar min-h-[400px]">
            {paginatedOrders.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {paginatedOrders.map((order) => {
                  const { downPayment, coreFee, totalPayable, paidPercentage } = getOrderFinancials(order);
                  const pipeline = getOrderPipeline(order);
                  const coreCommitted = hasCoreCommitment(order);
                  const waDigits = (order.customer?.whatsapp || order.customer?.phone || '').replace(/\D/g, '');

                  return (
                    <div
                      key={order.id}
                      onClick={() => onSelectOrder(order.id)}
                      className="group relative rounded-2xl bg-[#040814]/90 border border-slate-800/90 hover:border-cyan-400/60 transition-all duration-300 hover:shadow-[0_10px_30px_rgba(6,182,212,0.15)] flex flex-col justify-between p-4 cursor-pointer overflow-hidden active:scale-[0.99] touch-manipulation"
                    >
                      {/* Top cyber accent line on hover */}
                      <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400/0 to-transparent group-hover:via-cyan-400 transition-all duration-300" />

                      {/* Header: Code, Delivery Type, Status, Auction */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex flex-col gap-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono text-xs font-black text-cyan-300 bg-cyan-500/10 border border-cyan-400/30 px-2.5 py-0.5 rounded-lg group-hover:text-cyan-200 group-hover:border-cyan-400/70 transition shadow-[0_0_8px_rgba(6,182,212,0.15)]">
                              {order.code}
                            </span>
                            <div className="flex items-center gap-1 text-[11px] font-mono text-slate-400">
                              <span className={`material-symbols-outlined text-[14px] ${order.deliveryType === 'envio_domicilio' ? 'text-cyan-400' : 'text-emerald-400'}`}>
                                {order.deliveryType === 'envio_domicilio' ? 'local_shipping' : 'storefront'}
                              </span>
                              <span className="hidden sm:inline">{order.deliveryType === 'envio_domicilio' ? 'Envío' : 'Retiro'}</span>
                            </div>
                          </div>
                          <span className="text-[10.5px] font-mono text-slate-400 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[12px] text-slate-500">calendar_today</span>
                            {order.createdAt}
                          </span>
                        </div>
                        <div className="shrink-0 flex flex-col items-end gap-1">
                          {renderStatusBadge(order.status)}
                          {isOrderAuction(order) && (
                            <span
                              className="text-amber-900 dark:text-amber-400 font-mono text-[9.5px] font-bold inline-flex items-center gap-0.5 bg-amber-100/90 dark:bg-amber-500/15 px-1.5 py-0.5 rounded border border-amber-400/70 dark:border-amber-500/30 shrink-0"
                              title="Requiere búsqueda en subasta (Copart/IAAI)"
                            >
                              <span className="material-symbols-outlined text-[11px] text-amber-600 dark:text-amber-400">gavel</span>
                              <span>Subasta</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Customer Row */}
                      <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-900/60 border border-slate-800/80 mb-3">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-500/25 to-blue-600/25 flex items-center justify-center text-cyan-300 font-bold text-xs border border-cyan-400/30 shrink-0 shadow-[0_0_8px_rgba(6,182,212,0.2)]">
                            {order.customer?.initials || 'CL'}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="text-white font-bold text-xs truncate group-hover:text-cyan-200 transition">
                              {order.customer?.name || 'Cliente sin nombre'}
                            </span>
                            <span className="text-slate-400 text-[10.5px] font-mono truncate">
                              {order.customer?.phone || 'Sin teléfono'}
                            </span>
                          </div>
                        </div>

                        {/* Direct Mobile Quick Actions: WhatsApp & Call */}
                        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                          {waDigits && (
                            <a
                              href={`https://wa.me/${waDigits.startsWith('1') ? waDigits : '1' + waDigits}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-8 h-8 rounded-xl flex items-center justify-center text-emerald-400 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 hover:border-emerald-400 transition active:scale-95"
                              title="WhatsApp directo con el cliente"
                              aria-label={`WhatsApp a ${order.customer?.name}`}
                            >
                              <span className="material-symbols-outlined text-[17px]">chat</span>
                            </a>
                          )}
                          {order.customer?.phone && (
                            <a
                              href={`tel:${order.customer.phone.replace(/\D/g, '')}`}
                              className="w-8 h-8 rounded-xl flex items-center justify-center text-cyan-400 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 hover:border-cyan-400 transition active:scale-95"
                              title="Llamar directamente"
                              aria-label={`Llamar a ${order.customer?.name}`}
                            >
                              <span className="material-symbols-outlined text-[17px]">call</span>
                            </a>
                          )}
                        </div>
                      </div>

                      {/* Vehicle & Part Information */}
                      <div className="space-y-2 mb-3 bg-[#02050e]/60 p-2.5 rounded-xl border border-slate-800/60">
                        {/* Vehicle + VIN */}
                        <div className="flex items-start gap-1.5">
                          <span className="material-symbols-outlined text-[16px] text-cyan-400 shrink-0 mt-0.5">directions_car</span>
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-slate-200 text-xs font-semibold leading-tight truncate">
                              {order.vehicle?.year} {order.vehicle?.make} {order.vehicle?.model}
                            </span>
                            {order.vehicle?.vin ? (
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="font-mono text-[10px] text-slate-400 truncate">
                                  VIN: {order.vehicle.vin}
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => handleCopyVin(e, order.vehicle?.vin || '', order.id)}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center gap-0.5 transition cursor-pointer ${
                                    copiedVinId === order.id
                                      ? 'text-emerald-300 bg-emerald-500/20 border border-emerald-400/40'
                                      : 'text-slate-400 hover:text-cyan-300 bg-slate-800/80 hover:bg-cyan-500/10 border border-slate-700/50'
                                  }`}
                                  title={copiedVinId === order.id ? 'VIN copiado al portapapeles' : 'Copiar VIN'}
                                >
                                  <span className="material-symbols-outlined text-[11px]">
                                    {copiedVinId === order.id ? 'check' : 'content_copy'}
                                  </span>
                                  <span>{copiedVinId === order.id ? 'Copiado' : 'Copiar'}</span>
                                </button>
                              </div>
                            ) : (
                              <span className="font-mono text-[10px] text-slate-500">Sin VIN</span>
                            )}
                          </div>
                        </div>

                        {/* Part + Stock */}
                        <div className="flex items-start gap-1.5 pt-1.5 border-t border-slate-800/60">
                          <span className="material-symbols-outlined text-[16px] text-emerald-400 shrink-0 mt-0.5">build</span>
                          <div className="flex flex-col min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-white text-xs font-semibold">{order.mainPart}</span>
                              <InventoryAvailabilityBadge availability={order.inventoryAvailability} />
                            </div>
                            {order.stockNumber && (
                              <span className="font-mono text-[9.5px] text-emerald-400 font-bold mt-0.5">
                                Stock: {order.stockNumber}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Pipeline Stepper Compact */}
                      <div className="p-2 rounded-xl bg-slate-900/40 border border-slate-800/60 mb-3 flex items-center justify-between gap-2">
                        <div className="flex items-center">
                          {PIPELINE_STEP_NAMES.map((name, idx) => {
                            const stepNum = idx + 1;
                            const isDone = pipeline.isDone || stepNum < pipeline.step;
                            const isCurrent = !pipeline.isDone && stepNum === pipeline.step;
                            const dotClass = pipeline.isHalted
                              ? isDone || isCurrent
                                ? 'bg-slate-600 text-slate-200 border border-slate-500'
                                : 'bg-slate-800 text-slate-600 border border-slate-700'
                              : isDone
                              ? 'bg-emerald-500 text-slate-950 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                              : isCurrent
                              ? 'bg-cyan-400 text-slate-950 ring-2 ring-cyan-400/40 shadow-[0_0_8px_rgba(6,182,212,0.6)]'
                              : 'bg-slate-800 text-slate-500 border border-slate-700';
                            return (
                              <div key={name} className="flex items-center">
                                <div
                                  className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8.5px] font-mono font-black ${dotClass}`}
                                  title={`${stepNum}. ${name}`}
                                >
                                  {isDone && !pipeline.isHalted ? '✓' : stepNum}
                                </div>
                                {stepNum < PIPELINE_STEP_NAMES.length && (
                                  <div
                                    className={`w-2.5 h-0.5 ${
                                      !pipeline.isHalted && (pipeline.isDone || stepNum < pipeline.step)
                                        ? 'bg-emerald-400'
                                        : 'bg-slate-700'
                                    }`}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <span className={`text-[10px] font-mono font-bold truncate ${pipeline.isHalted ? 'text-slate-500' : pipeline.isDone ? 'text-emerald-300' : 'text-cyan-300'}`}>
                          {pipeline.label}
                        </span>
                      </div>

                      {/* Financial Progress Box */}
                      <div className="p-2.5 rounded-xl bg-gradient-to-br from-[#060c18] to-[#040814] border border-cyan-500/20 mb-3 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-[11px] font-mono text-slate-400">Balance</span>
                          {totalPayable <= 0 ? (
                            <span className="inline-flex items-center gap-1 font-mono text-[11px] font-black text-emerald-300 bg-emerald-500/15 border border-emerald-400/40 px-2 py-0.5 rounded-lg">
                              <span className="material-symbols-outlined text-[13px]">check_circle</span>
                              Liquidado
                            </span>
                          ) : (
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-amber-400/90 font-mono">Saldo:</span>
                              <span className="font-mono text-xs font-black text-amber-300 drop-shadow-[0_0_6px_rgba(245,158,11,0.3)]">
                                ${totalPayable.toFixed(2)}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Visual Progress Bar */}
                        <div className="w-full h-2 bg-slate-800/90 rounded-full overflow-hidden p-0.5">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              paidPercentage >= 100
                                ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'
                                : paidPercentage > 0
                                ? 'bg-gradient-to-r from-emerald-400 to-cyan-400'
                                : 'bg-red-400/60'
                            }`}
                            style={{ width: `${Math.max(paidPercentage, 4)}%` }}
                          />
                        </div>

                        <div className="flex items-center justify-between text-[10.5px] font-mono">
                          <span className="text-emerald-400 font-semibold">
                            Abono: ${downPayment.toFixed(2)} ({paidPercentage}%)
                          </span>
                          {coreCommitted ? (
                            <span className="text-purple-300 font-bold flex items-center gap-0.5">
                              <span className="material-symbols-outlined text-[11px]">autorenew</span>
                              {coreFee > 0 ? `Core $${coreFee.toFixed(2)}` : 'Core pactado'}
                            </span>
                          ) : (
                            <span className="text-slate-500 font-mono">
                              Total: ${(order.financials?.total || order.financials?.partPrice || 0).toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Card Footer: Advisor + Action buttons */}
                      <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-xs relative">
                        <div className="flex items-center gap-1 text-slate-400 font-mono text-[10.5px]">
                          <span className="material-symbols-outlined text-[13px] text-slate-500">badge</span>
                          <span className="truncate max-w-[120px]" title={`Asesor: ${order.advisor || 'Sin asignar'}`}>
                            {order.advisor || 'Sin asesor'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => onSelectOrder(order.id)}
                            className="px-3 py-1.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/30 border border-cyan-400/40 hover:border-cyan-300 text-cyan-300 text-xs font-mono font-bold flex items-center gap-1 transition cursor-pointer shadow-[0_0_10px_rgba(6,182,212,0.15)]"
                          >
                            <span>Abrir</span>
                            <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveActionMenu(activeActionMenu === order.id ? null : order.id)}
                            className="text-slate-400 hover:text-cyan-300 p-1.5 rounded-xl hover:bg-slate-800 transition cursor-pointer"
                            title="Opciones"
                            aria-haspopup="menu"
                            aria-expanded={activeActionMenu === order.id}
                          >
                            <span className="material-symbols-outlined text-[16px]">more_vert</span>
                          </button>
                        </div>

                        {/* Dropdown Menu in Card */}
                        {activeActionMenu === order.id && (
                          <div className="absolute right-0 bottom-11 w-48 bg-[#060c18] border border-cyan-500/30 rounded-2xl shadow-[0_15px_40px_rgba(0,0,0,0.85)] z-30 py-2 text-left text-xs overflow-hidden backdrop-blur-2xl" onClick={(e) => e.stopPropagation()}>
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
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-14 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
                <span className="material-symbols-outlined text-5xl text-cyan-400/50">search_off</span>
                <p className="font-bold text-white text-sm">
                  {searchQuery.trim()
                    ? `No se encontraron órdenes con el término "${searchQuery}".`
                    : 'No se encontraron órdenes en esta vista.'}
                </p>
                <p className="text-xs text-slate-400 font-mono">
                  {searchQuery.trim()
                    ? 'Prueba con otro término de búsqueda (nombre, teléfono, VIN o pieza) o limpia el buscador.'
                    : 'Prueba seleccionando otra de las vistas segmentadas o ajusta tu búsqueda.'}
                </p>
                {(activeFiltersCount > 0 || searchQuery.trim() !== '') && (
                  <button
                    type="button"
                    onClick={handleClearFilters}
                    className="mt-2 px-3 py-1.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-[11px] font-mono font-bold flex items-center gap-1 transition cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[14px]">restart_alt</span>
                    Limpiar filtros y búsqueda
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* View Mode: Table Compact */}
        {viewMode === 'table' && (
        <div className="table-responsive-wrapper custom-scrollbar">
          <table className="w-full text-left whitespace-nowrap border-collapse min-w-[1080px]">
            <thead className="bg-[#040814]/95 border-b border-cyan-500/20 sticky top-0 z-10">
              <tr className="font-mono text-[10px] sm:text-[10.5px] text-cyan-400/80 uppercase tracking-wider">
                <th className="px-4 py-3 font-bold">Código & Fecha</th>
                <th className="px-4 py-3 font-bold">Cliente</th>
                <th className="px-4 py-3 font-bold">Vehículo & VIN</th>
                <th className="px-4 py-3 font-bold">Refacción Solicitada</th>
                <th className="px-4 py-3 font-bold text-center">Flujo</th>
                <th className="px-4 py-3 font-bold">Tipo Entrega</th>
                <th className="px-4 py-3 font-bold">Estatus</th>
                <th className="px-4 py-3 font-bold text-right">Balance Financiero</th>
                <th className="px-4 py-3 font-bold text-center w-28">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cyan-500/10 text-xs">
              {paginatedOrders.map((order) => {
                const { downPayment, coreFee, totalPayable, paidPercentage } = getOrderFinancials(order);
                const pipeline = getOrderPipeline(order);
                const coreCommitted = hasCoreCommitment(order);
                const waDigits = (order.customer.whatsapp || order.customer.phone || '').replace(/\D/g, '');

                return (
                  <tr
                    key={order.id}
                    className="hover:bg-cyan-500/5 transition-all group cursor-pointer"
                    onClick={() => onSelectOrder(order.id)}
                  >
                    {/* Código & Fecha */}
                    <td className="px-4 py-3 sm:px-5 sm:py-3.5">
                      <div className="flex flex-col gap-1">
                        <span className="inline-flex w-fit items-center font-mono text-[11.5px] font-black text-cyan-300 bg-cyan-500/10 border border-cyan-400/30 px-2 py-0.5 rounded-lg group-hover:text-cyan-200 group-hover:border-cyan-400/60 transition">
                          {order.code}
                        </span>
                        <span className="text-slate-400 text-[10.5px] font-mono flex items-center gap-1">
                          <span className="material-symbols-outlined text-[12px] text-slate-500">calendar_today</span>
                          {order.createdAt}
                        </span>
                        {order.advisor && (
                          <span className="text-slate-400 text-[10px] font-mono flex items-center gap-1" title={`Asesor: ${order.advisor}`}>
                            <span className="material-symbols-outlined text-[12px] text-slate-500">person</span>
                            <span className="truncate max-w-[120px]">{order.advisor}</span>
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Cliente */}
                    <td className="px-4 py-3 sm:px-5 sm:py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-gradient-to-br from-cyan-500/25 to-blue-600/25 flex items-center justify-center text-cyan-300 font-bold text-[11px] sm:text-xs border border-cyan-400/30 shrink-0 shadow-[0_0_8px_rgba(6,182,212,0.2)]">
                          {order.customer.initials}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-white font-bold leading-tight group-hover:text-cyan-200 truncate max-w-[160px]">
                            {order.customer.name}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-400 text-[10.5px] font-mono truncate">
                              {order.customer.phone}
                            </span>
                            {waDigits && (
                              <a
                                href={`https://wa.me/${waDigits}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="w-5 h-5 rounded-md flex items-center justify-center text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/15 transition"
                                title="Abrir WhatsApp del cliente"
                                aria-label={`WhatsApp a ${order.customer.name}`}
                              >
                                <span className="material-symbols-outlined text-[14px]">chat</span>
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Vehículo & VIN */}
                    <td className="px-4 py-3 sm:px-5 sm:py-3.5">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-slate-200 font-medium leading-tight">
                          {order.vehicle.year} {order.vehicle.make} {order.vehicle.model}
                        </span>
                        {order.vehicle.vin ? (
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-[10.5px] text-slate-400 truncate max-w-[150px]">
                              VIN: {order.vehicle.vin}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => handleCopyVin(e, order.vehicle.vin || '', order.id)}
                              className={`w-5 h-5 rounded-md flex items-center justify-center transition cursor-pointer ${
                                copiedVinId === order.id
                                  ? 'text-emerald-400 bg-emerald-500/15'
                                  : 'text-slate-500 hover:text-cyan-300 hover:bg-cyan-500/10'
                              }`}
                              title={copiedVinId === order.id ? 'VIN copiado' : 'Copiar VIN'}
                              aria-label="Copiar VIN"
                            >
                              <span className="material-symbols-outlined text-[13px]">
                                {copiedVinId === order.id ? 'check' : 'content_copy'}
                              </span>
                            </button>
                          </div>
                        ) : (
                          <span className="font-mono text-[10.5px] text-slate-500">Sin VIN</span>
                        )}
                      </div>
                    </td>

                    {/* Refacción */}
                    <td className="px-4 py-3 sm:px-5 sm:py-3.5">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-slate-100 font-semibold">{order.mainPart}</span>
                          <InventoryAvailabilityBadge availability={order.inventoryAvailability} />
                          {isOrderAuction(order) && (
                            <span
                              className="text-amber-900 dark:text-amber-400 font-mono text-[9.5px] font-bold inline-flex items-center gap-0.5 bg-amber-100/90 dark:bg-amber-500/15 px-1.5 py-0.5 rounded border border-amber-400/70 dark:border-amber-500/30 shrink-0"
                              title="Requiere búsqueda en subasta (Copart/IAAI)"
                            >
                              <span className="material-symbols-outlined text-[11px] text-amber-600 dark:text-amber-400">gavel</span>
                              <span>Subasta</span>
                            </span>
                          )}
                        </div>
                        {order.stockNumber && (
                          <span className="font-mono text-[9.5px] text-emerald-400 font-bold">
                            Stock: {order.stockNumber}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Flujo (pipeline stepper) */}
                    <td className="px-4 py-3 sm:px-5 sm:py-3.5">
                      <div className="flex flex-col items-center gap-1" title={`Etapa: ${pipeline.label}`}>
                        <div className="flex items-center">
                          {PIPELINE_STEP_NAMES.map((name, idx) => {
                            const stepNum = idx + 1;
                            const isDone = pipeline.isDone || stepNum < pipeline.step;
                            const isCurrent = !pipeline.isDone && stepNum === pipeline.step;
                            const dotClass = pipeline.isHalted
                              ? isDone || isCurrent
                                ? 'bg-slate-600 text-slate-200 border border-slate-500'
                                : 'bg-slate-800 text-slate-600 border border-slate-700'
                              : isDone
                              ? 'bg-emerald-500 text-slate-950 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                              : isCurrent
                              ? 'bg-cyan-400 text-slate-950 ring-2 ring-cyan-400/40 shadow-[0_0_8px_rgba(6,182,212,0.6)]'
                              : 'bg-slate-800 text-slate-500 border border-slate-700';
                            return (
                              <div key={name} className="flex items-center">
                                <div
                                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-mono font-black ${dotClass}`}
                                  title={`${stepNum}. ${name}`}
                                >
                                  {isDone && !pipeline.isHalted ? '✓' : stepNum}
                                </div>
                                {stepNum < PIPELINE_STEP_NAMES.length && (
                                  <div
                                    className={`w-3 h-0.5 ${
                                      !pipeline.isHalted && (pipeline.isDone || stepNum < pipeline.step)
                                        ? 'bg-emerald-400'
                                        : 'bg-slate-700'
                                    }`}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <span className={`text-[10px] font-mono font-medium ${pipeline.isHalted ? 'text-slate-500' : pipeline.isDone ? 'text-emerald-300' : 'text-cyan-300'}`}>
                          {pipeline.label}
                        </span>
                      </div>
                    </td>

                    {/* Tipo Entrega */}
                    <td className="px-4 py-3 sm:px-5 sm:py-3.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`material-symbols-outlined text-[15px] ${order.deliveryType === 'envio_domicilio' ? 'text-cyan-400' : 'text-emerald-400'}`}>
                          {order.deliveryType === 'envio_domicilio' ? 'local_shipping' : 'storefront'}
                        </span>
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
                      <div className="flex flex-col items-end gap-1">
                        {totalPayable <= 0 ? (
                          <span className="inline-flex items-center gap-1 font-mono text-xs font-black text-emerald-300 bg-emerald-500/15 border border-emerald-400/40 px-2 py-0.5 rounded-lg">
                            <span className="material-symbols-outlined text-[13px]">check_circle</span>
                            Liquidado
                          </span>
                        ) : (
                          <span className="font-mono text-xs sm:text-sm font-black text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.3)]" title="Saldo pendiente por cobrar">
                            ${totalPayable.toFixed(2)}
                          </span>
                        )}
                        <div className="flex items-center gap-1.5">
                          <div className="w-14 h-1.5 bg-slate-800 rounded-full overflow-hidden" title={`${paidPercentage}% cubierto`}>
                            <div
                              className={`h-full rounded-full ${paidPercentage >= 100 ? 'bg-emerald-400' : paidPercentage > 0 ? 'bg-gradient-to-r from-emerald-400 to-cyan-400' : 'bg-red-400/60'}`}
                              style={{ width: `${Math.max(paidPercentage, 4)}%` }}
                            />
                          </div>
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
                        {coreCommitted && (
                          <span className="inline-flex items-center gap-0.5 text-[9.5px] font-mono font-bold text-purple-300 bg-purple-500/15 border border-purple-400/30 px-1.5 py-0.5 rounded">
                            <span className="material-symbols-outlined text-[11px]">autorenew</span>
                            {coreFee > 0 ? `Core: $${coreFee.toFixed(2)}` : 'Core pactado'}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Acciones */}
                    <td className="px-3 py-3 sm:px-4 sm:py-3.5 text-center relative" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => onSelectOrder(order.id)}
                          className="px-2.5 py-1.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/25 border border-cyan-500/30 hover:border-cyan-400 text-cyan-300 text-[11px] font-mono font-bold flex items-center gap-1 transition cursor-pointer"
                          title="Abrir la orden y su flujo"
                        >
                          <span>Abrir</span>
                          <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveActionMenu(activeActionMenu === order.id ? null : order.id)}
                          className="text-slate-400 hover:text-cyan-300 p-1.5 rounded-xl hover:bg-slate-800 transition cursor-pointer"
                          title="Opciones"
                          aria-haspopup="menu"
                          aria-expanded={activeActionMenu === order.id}
                        >
                          <span className="material-symbols-outlined text-[18px]">more_vert</span>
                        </button>
                      </div>

                      {/* Dropdown Menu */}
                      {activeActionMenu === order.id && (
                        <div className="absolute right-4 top-12 w-52 bg-[#060c18] border border-cyan-500/30 rounded-2xl shadow-[0_15px_40px_rgba(0,0,0,0.85)] z-30 py-2 text-left text-xs overflow-hidden backdrop-blur-2xl">
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
                  <td colSpan={9} className="px-5 py-14 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <span className="material-symbols-outlined text-5xl text-cyan-400/50">search_off</span>
                      <p className="font-bold text-white text-sm">
                        {searchQuery.trim()
                          ? `No se encontraron órdenes con el término "${searchQuery}".`
                          : 'No se encontraron órdenes en esta vista.'}
                      </p>
                      <p className="text-xs text-slate-400 font-mono">
                        {searchQuery.trim()
                          ? 'Prueba con otro término de búsqueda (nombre, teléfono, VIN o pieza) o limpia el buscador.'
                          : 'Prueba seleccionando otra de las vistas segmentadas o ajusta tu búsqueda.'}
                      </p>
                      {(activeFiltersCount > 0 || searchQuery.trim() !== '') && (
                        <button
                          type="button"
                          onClick={handleClearFilters}
                          className="mt-2 px-3 py-1.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-[11px] font-mono font-bold flex items-center gap-1 transition cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[14px]">restart_alt</span>
                          Limpiar filtros y búsqueda
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}

        {/* Table/Cards Footer with Pagination & Page Size Pills */}
        <div className="sticky bottom-0 z-10 bg-[#040814]/95 backdrop-blur-xl border-t border-cyan-500/20 px-5 py-3.5 flex flex-col lg:flex-row items-center justify-between gap-4">
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
              Página <strong className="text-cyan-400">{validCurrentPage}</strong> de <strong className="text-white">{totalPages}</strong>
            </span>
          </div>

          {/* Right: Controls (Page Size Pills + Pagination) */}
          <div className="flex flex-wrap items-center justify-center gap-4">
            {/* Page Size Pills */}
            <div className="flex items-center gap-1 bg-[#02050e]/80 p-1 rounded-2xl border border-cyan-500/20" role="group" aria-label="Órdenes por página">
              <span className="text-[10.5px] text-slate-400 font-mono px-1.5">Por pág.</span>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <button
                  key={size}
                  type="button"
                  aria-pressed={pageSize === size}
                  onClick={() => handlePageSizeChange(size)}
                  className={`min-w-[30px] h-7 px-2 rounded-xl text-xs font-mono font-bold transition cursor-pointer ${
                    pageSize === size
                      ? 'bg-cyan-500 text-slate-950 font-black shadow-[0_0_10px_rgba(6,182,212,0.4)]'
                      : 'text-slate-400 hover:text-cyan-300 hover:bg-cyan-500/10'
                  }`}
                >
                  {size}
                </button>
              ))}
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
                      aria-current={isActive ? 'page' : undefined}
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
