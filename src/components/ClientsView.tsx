import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Customer, Order } from '../types';
import { apiFetch } from '../services/apiFetch';
import { CustomerDuplicatesModal } from './CustomerDuplicatesModal';
import { useFeedback, type ToastTone } from './FeedbackProvider';
import { useDialogAccessibility } from '../hooks/useDialogAccessibility';

interface ClientsViewProps {
  orders: Order[];
  customers: Customer[];
  onSelectOrder: (orderId: string) => void;
  userRole?: 'admin' | 'operador';
  onOpenNewOrderWithCustomer?: (customer: Customer) => void;
  onRefreshCustomers?: () => void;
}

const TYPE_FILTERS: Array<{ id: string; label: string }> = [
  { id: 'Todos', label: 'Todos' },
  { id: 'Taller Mecánico', label: 'Talleres' },
  { id: 'Empresa', label: 'Empresa' },
  { id: 'Flota Mantenimiento', label: 'Flotas' },
  { id: 'VIP', label: 'VIP' },
  { id: 'Particular', label: 'Particulares' },
];

const phoneDigits = (value?: string) => (value || '').replace(/\D/g, '');

const whatsappHref = (client: Customer): string | null => {
  const digits = phoneDigits(client.whatsapp || client.phone);
  if (!digits) return null;
  return `https://wa.me/${digits.length === 10 ? `1${digits}` : digits}`;
};

const typeShortLabel = (type?: string): string => {
  if (type === 'Taller Mecánico') return 'Taller';
  if (type === 'Flota Mantenimiento') return 'Flota';
  return type || 'Particular';
};

const typeBadgeClasses = (type?: string): string => {
  if (type === 'VIP') return 'border-[var(--brand)]/30 bg-[var(--brand-soft)] text-[var(--brand)]';
  if (type === 'Taller Mecánico') return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300';
  if (type === 'Flota Mantenimiento') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (type === 'Empresa') return 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300';
  return 'border-[var(--border-color)] bg-[var(--bg-card-subtle)] text-[var(--text-secondary)]';
};

export const ClientsView: React.FC<ClientsViewProps> = ({
  orders,
  customers,
  onSelectOrder,
  userRole = 'admin',
  onOpenNewOrderWithCustomer,
  onRefreshCustomers,
}) => {
  const { toast } = useFeedback();

  // Master Customers State
  const [customerRecords, setCustomerRecords] = useState<Customer[]>(customers);

  useEffect(() => setCustomerRecords(customers), [customers]);

  // Search & Filter State with Debounce
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('Todos');
  const [showTrash, setShowTrash] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('table');

  // Pagination (12 customers per page according to manual)
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 12;

  // Modals & Wizards State
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardMode, setWizardMode] = useState<'create' | 'edit'>('create');
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);
  const [editingCustomer, setEditingCustomer] = useState<Partial<Customer>>({});
  const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});

  // Soft Delete Confirmation Dialog
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);

  // Customer Ficha / Historial Drawer
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);

  // Duplicates Merge Modal
  const [isDuplicatesModalOpen, setIsDuplicatesModalOpen] = useState(false);
  const [duplicatesCount, setDuplicatesCount] = useState(0);
  const [duplicatesState, setDuplicatesState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [duplicateIds, setDuplicateIds] = useState<Set<string>>(new Set());

  const drawerRef = useRef<HTMLDivElement>(null);
  const wizardRef = useRef<HTMLDivElement>(null);
  const deleteRef = useRef<HTMLDivElement>(null);

  const showToast = (message: string, tone: ToastTone = 'success') => {
    toast({ title: tone === 'error' ? 'No se pudo completar la acción' : 'Listo', message, tone });
  };

  // Advisory duplicate scan for the alert strip (admin only)
  useEffect(() => {
    if (userRole !== 'admin') {
      setDuplicatesCount(0);
      setDuplicateIds(new Set());
      setDuplicatesState('ready');
      return;
    }
    let cancelled = false;
    setDuplicatesState('loading');
    (async () => {
      try {
        const res = await apiFetch('/customers/duplicates');
        if (!res.ok) throw new Error('duplicates unavailable');
        const groups: Array<{ customers: Array<{ id: number | string }> }> = await res.json();
        if (cancelled) return;
        setDuplicatesCount(groups.length);
        setDuplicateIds(new Set(groups.flatMap((group) => group.customers.map((member) => String(member.id)))));
        setDuplicatesState('ready');
      } catch {
        if (cancelled) return;
        setDuplicatesCount(0);
        setDuplicateIds(new Set());
        setDuplicatesState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userRole, customerRecords]);

  // Debounce Search Effect (300ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setCurrentPage(1); // Reset to page 1 on search
    }, 300);
    return () => clearTimeout(handler);
  }, [searchInput]);

  // Compute metrics from real orders for each customer - Optimizacion O(N + M) indexada
  const customerStatsMap = useMemo(() => {
    const map = new Map<
      string,
      { activeOrdersCount: number; totalOrdersCount: number; totalSpent: number; lastOrder: Order | null; vehicles: string[] }
    >();

    // 1. Indexar ordenes en una sola pasada O(M)
    const ordersByCustId = new Map<string, Order[]>();
    const ordersByPhone = new Map<string, Order[]>();
    const ordersByName = new Map<string, Order[]>();

    for (const o of orders) {
      if (!o.customer) continue;
      if (o.customer.id) {
        let arr = ordersByCustId.get(o.customer.id);
        if (!arr) {
          arr = [];
          ordersByCustId.set(o.customer.id, arr);
        }
        arr.push(o);
      }
      if (o.customer.phone) {
        const cleanPhone = o.customer.phone.replace(/\D/g, '');
        if (cleanPhone) {
          let arr = ordersByPhone.get(cleanPhone);
          if (!arr) {
            arr = [];
            ordersByPhone.set(cleanPhone, arr);
          }
          arr.push(o);
        }
      }
      if (o.customer.name) {
        const cleanName = o.customer.name.trim().toLowerCase();
        if (cleanName) {
          let arr = ordersByName.get(cleanName);
          if (!arr) {
            arr = [];
            ordersByName.set(cleanName, arr);
          }
          arr.push(o);
        }
      }
    }

    // 2. Asociar estadisticas a cada cliente en O(N)
    for (const cust of customerRecords) {
      const orderSet = new Set<Order>();
      if (cust.id && ordersByCustId.has(cust.id)) {
        for (const o of ordersByCustId.get(cust.id)!) orderSet.add(o);
      }
      if (cust.phone) {
        const cleanPhone = cust.phone.replace(/\D/g, '');
        if (cleanPhone && ordersByPhone.has(cleanPhone)) {
          for (const o of ordersByPhone.get(cleanPhone)!) orderSet.add(o);
        }
      }
      if (orderSet.size === 0 && cust.name) {
        const cleanName = cust.name.trim().toLowerCase();
        if (cleanName && ordersByName.has(cleanName)) {
          for (const o of ordersByName.get(cleanName)!) orderSet.add(o);
        }
      }

      let activeOrdersCount = 0;
      let totalSpent = 0;
      let lastOrder: Order | null = null;

      const vehicleSet = new Set<string>();
      for (const o of orderSet) {
        if (!lastOrder) lastOrder = o;
        if (
          o.status !== 'entregado' &&
          o.status !== 'cancelado' &&
          o.status !== 'reembolsado' &&
          o.status !== 'archivado'
        ) {
          activeOrdersCount++;
        }
        const amt = o.financials?.total || o.financials?.partPrice || 0;
        totalSpent += amt;
        if (o.vehicle?.make && o.vehicle?.model) {
          vehicleSet.add(`${o.vehicle.year ? o.vehicle.year + ' ' : ''}${o.vehicle.make} ${o.vehicle.model}`.trim());
        }
      }

      map.set(cust.id, {
        activeOrdersCount,
        totalOrdersCount: orderSet.size,
        totalSpent,
        lastOrder,
        vehicles: Array.from(vehicleSet).slice(0, 3),
      });
    }

    return map;
  }, [customerRecords, orders]);

  // Filtered & Paginated Customers
  const filteredCustomers = useMemo(() => {
    return customerRecords.filter((cust) => {
      // Soft Delete Filter
      const isDeleted = Boolean(cust.deleted_at);
      if (showTrash && !isDeleted) return false;
      if (!showTrash && isDeleted) return false;

      // Filter by Type
      if (filterType === 'Empresas & Flotas') {
        if (cust.type !== 'Empresa' && cust.type !== 'Flota Mantenimiento') return false;
      } else if (filterType !== 'Todos' && cust.type !== filterType) {
        return false;
      }

      // Live Search filter (Indexed in first_name, last_name, phone, whatsapp, email, zip_code, company)
      if (debouncedSearch.trim()) {
        const query = debouncedSearch.toLowerCase().trim();
        const cleanQueryPhone = query.replace(/\D/g, '');
        const cleanCustPhone = (cust.phone || '').replace(/\D/g, '');
        const cleanCustWhatsapp = (cust.whatsapp || '').replace(/\D/g, '');

        const matchName =
          (cust.first_name || '').toLowerCase().includes(query) ||
          (cust.last_name || '').toLowerCase().includes(query) ||
          (cust.name || '').toLowerCase().includes(query);
        const matchEmail = (cust.email || '').toLowerCase().includes(query);
        const matchCompany = (cust.company || '').toLowerCase().includes(query);
        const matchZip = (cust.zip_code || '').includes(query);
        const matchNotes = (cust.notes || '').toLowerCase().includes(query);
        const matchLocation = (cust.location || '').toLowerCase().includes(query);

        const matchPhone =
          (cleanQueryPhone && cleanCustPhone.includes(cleanQueryPhone)) ||
          (cleanQueryPhone && cleanCustWhatsapp.includes(cleanQueryPhone)) ||
          (cust.phone && cust.phone.toLowerCase().includes(query));

        if (
          !matchName &&
          !matchEmail &&
          !matchCompany &&
          !matchZip &&
          !matchNotes &&
          !matchLocation &&
          !matchPhone
        ) {
          return false;
        }
      }

      return true;
    });
  }, [customerRecords, showTrash, filterType, debouncedSearch]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredCustomers.length / PAGE_SIZE));
  const paginatedCustomers = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredCustomers.slice(start, start + PAGE_SIZE);
  }, [filteredCustomers, currentPage]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const pageWindow = useMemo(() => {
    const pages: Array<number | 'gap-left' | 'gap-right'> = [];
    if (totalPages <= 7) {
      for (let p = 1; p <= totalPages; p++) pages.push(p);
      return pages;
    }
    const start = Math.max(2, currentPage - 2);
    const end = Math.min(totalPages - 1, currentPage + 2);
    pages.push(1);
    if (start > 2) pages.push('gap-left');
    for (let p = start; p <= end; p++) pages.push(p);
    if (end < totalPages - 1) pages.push('gap-right');
    pages.push(totalPages);
    return pages;
  }, [currentPage, totalPages]);

  // Overall Global KPI counts
  const totalActiveCustomers = customerRecords.filter((c) => !c.deleted_at).length;
  const totalTalleres = customerRecords.filter((c) => !c.deleted_at && c.type === 'Taller Mecánico').length;
  const totalVIP = customerRecords.filter((c) => !c.deleted_at && c.type === 'VIP').length;
  const totalEmpresas = customerRecords.filter((c) => !c.deleted_at && (c.type === 'Empresa' || c.type === 'Flota Mantenimiento')).length;
  const totalDeleted = customerRecords.filter((c) => Boolean(c.deleted_at)).length;
  const activeWithOrders = useMemo(
    () => customerRecords.filter((c) => !c.deleted_at && (customerStatsMap.get(c.id)?.activeOrdersCount || 0) > 0).length,
    [customerRecords, customerStatsMap],
  );

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of customerRecords) {
      if (c.deleted_at) continue;
      counts.set(c.type || 'Particular', (counts.get(c.type || 'Particular') || 0) + 1);
    }
    return counts;
  }, [customerRecords]);

  const hasActiveFilters = Boolean(searchInput.trim()) || filterType !== 'Todos';
  const clearFilters = () => {
    setSearchInput('');
    setFilterType('Todos');
    setCurrentPage(1);
  };

  const detailOrders = useMemo(() => {
    if (!detailCustomer) return [] as Order[];
    const detailPhone = phoneDigits(detailCustomer.phone);
    const detailName = (detailCustomer.name || '').trim().toLowerCase();
    return orders.filter((o) => {
      if (o.customer?.id && o.customer.id === detailCustomer.id) return true;
      if (detailPhone && phoneDigits(o.customer?.phone) === detailPhone) return true;
      if (detailName && (o.customer?.name || '').trim().toLowerCase() === detailName) return true;
      return false;
    });
  }, [orders, detailCustomer]);

  const closeDrawer = () => setDetailCustomer(null);
  const closeWizard = () => setIsWizardOpen(false);

  useDialogAccessibility({
    open: Boolean(detailCustomer),
    dialogRef: drawerRef,
    onEscape: closeDrawer,
    isBlocked: () =>
      Boolean(
        document.querySelector(
          '[role="dialog"][aria-modal="true"]:not([data-client-drawer]):not(.horizon-followup-portal [role="dialog"])',
        ),
      ),
  });
  useDialogAccessibility({ open: isWizardOpen, dialogRef: wizardRef, onEscape: closeWizard });
  useDialogAccessibility({
    open: Boolean(customerToDelete),
    dialogRef: deleteRef,
    onEscape: () => setCustomerToDelete(null),
  });

  // Open Wizard for New Customer
  const handleOpenCreateWizard = () => {
    const newId = `CUST-${Math.floor(1000 + Math.random() * 9000)}`;
    setEditingCustomer({
      id: newId,
      first_name: '',
      last_name: '',
      name: '',
      company: '',
      type: 'Taller Mecánico',
      email: '',
      phone: '',
      whatsapp: '',
      location: 'Raleigh, NC',
      address_shipping: '',
      zip_code: '27604',
      language: 'es',
      notes: '',
      initials: 'CL',
    });
    setFormErrors({});
    setWizardMode('create');
    setWizardStep(1);
    setIsWizardOpen(true);
  };

  // Open Wizard to Edit Customer
  const handleOpenEditWizard = (customer: Customer) => {
    setEditingCustomer({ ...customer, language: customer.language || 'es' });
    setFormErrors({});
    setWizardMode('edit');
    setWizardStep(1);
    setIsWizardOpen(true);
  };

  // Validation on Step 1
  const handleNextStep = () => {
    const errors: { [key: string]: string } = {};
    if (!editingCustomer.first_name?.trim() && !editingCustomer.name?.trim()) {
      errors.first_name = 'El nombre de pila o razón social es obligatorio.';
    }
    setFormErrors(errors);

    if (Object.keys(errors).length === 0) {
      setWizardStep(2);
    }
  };

  // Save Customer (Step 2 Submission)
  const handleSaveCustomer = async () => {
    const errors: { [key: string]: string } = {};
    if (!editingCustomer.phone?.trim()) {
      errors.phone = 'El teléfono principal es obligatorio para coordinación y fletes.';
    }
    setFormErrors(errors);

    if (Object.keys(errors).length > 0) return;

    const firstName = (editingCustomer.first_name || '').trim();
    const lastName = (editingCustomer.last_name || '').trim();
    const fullName = firstName && lastName ? `${firstName} ${lastName}` : firstName || editingCustomer.name || 'Cliente sin nombre';
    const cleanWhatsapp = editingCustomer.whatsapp
      ? editingCustomer.whatsapp.replace(/\D/g, '')
      : editingCustomer.phone?.replace(/\D/g, '') || '';

    const payload = {
      first_name: firstName || fullName.split(/\s+/)[0] || 'Cliente',
      last_name: lastName || (fullName.includes(' ') ? fullName.split(/\s+/).slice(1).join(' ') : null),
      name: fullName,
      company: editingCustomer.company || '',
      type: editingCustomer.type || 'Particular',
      email: editingCustomer.email || '',
      phone: editingCustomer.phone || '',
      whatsapp: cleanWhatsapp,
      address_shipping: editingCustomer.address_shipping || editingCustomer.shippingAddress || '',
      shippingAddress: editingCustomer.address_shipping || editingCustomer.shippingAddress || '',
      zip_code: editingCustomer.zip_code || '',
      language: editingCustomer.language || 'es',
      notes: editingCustomer.notes || '',
    };

    try {
      if (wizardMode === 'create') {
        const response = await apiFetch('/customers', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.message || 'Error al registrar cliente');
        }
        const created: Customer = await response.json();
        setCustomerRecords([created, ...customerRecords]);
        onRefreshCustomers?.();
        showToast(`Cliente "${created.name}" registrado exitosamente.`);
      } else if (editingCustomer.id) {
        const response = await apiFetch(`/customers/${editingCustomer.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.message || 'Error al actualizar cliente');
        }
        const updated: Customer = await response.json();
        setCustomerRecords(customerRecords.map((c) => (c.id === updated.id ? updated : c)));
        if (detailCustomer?.id === updated.id) setDetailCustomer(updated);
        onRefreshCustomers?.();
        showToast(`Ficha de "${updated.name}" actualizada con éxito.`);
      }
      setIsWizardOpen(false);
    } catch (err: any) {
      showToast(err.message || 'No se pudo guardar el cliente', 'error');
    }
  };

  // Perform Soft Delete (Admin Protected)
  const handleConfirmSoftDelete = async () => {
    if (!customerToDelete) return;
    if (userRole !== 'admin') {
      toast({ title: 'Acción denegada', message: 'Solo los administradores pueden eliminar clientes.', tone: 'error' });
      setCustomerToDelete(null);
      return;
    }

    try {
      const response = await apiFetch(`/customers/${customerToDelete.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.message || 'Error al eliminar cliente');
      }
      setCustomerRecords((prev) => prev.filter((c) => c.id !== customerToDelete.id));
      if (detailCustomer?.id === customerToDelete.id) closeDrawer();
      onRefreshCustomers?.();
      showToast(`Cliente "${customerToDelete.name}" eliminado.`);
    } catch (err: any) {
      showToast(err.message || 'No se pudo eliminar el cliente', 'error');
    } finally {
      setCustomerToDelete(null);
    }
  };

  // Restore Soft Deleted Customer
  const handleRestoreCustomer = async (customerId: string) => {
    if (userRole !== 'admin') {
      toast({ title: 'Acción denegada', message: 'Solo los administradores pueden restaurar clientes.', tone: 'error' });
      return;
    }
    try {
      const response = await apiFetch(`/customers/${customerId}/restore`, { method: 'POST' });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.message || 'Error al restaurar cliente');
      }
      setCustomerRecords((prev) => prev.map((c) => (c.id === customerId ? { ...c, deleted_at: null } : c)));
      onRefreshCustomers?.();
      showToast('Cliente restaurado al directorio activo.');
    } catch (err: any) {
      showToast(err.message || 'No se pudo restaurar el cliente', 'error');
    }
  };

  const renderPagination = () =>
    totalPages > 1 && (
      <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3.5 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-[var(--text-secondary)]">
          Página <strong className="text-[var(--text-heading)]">{currentPage}</strong> de{' '}
          <strong className="text-[var(--text-heading)]">{totalPages}</strong> · {filteredCustomers.length} clientes
        </span>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="flex cursor-pointer items-center gap-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text-heading)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">chevron_left</span>
            <span>Anterior</span>
          </button>

          {pageWindow.map((page) =>
            typeof page === 'number' ? (
              <button
                key={page}
                onClick={() => setCurrentPage(page)}
                aria-current={currentPage === page ? 'page' : undefined}
                className={`h-8 w-8 cursor-pointer rounded-xl text-xs font-bold transition-colors ${
                  currentPage === page
                    ? 'bg-[var(--brand-solid)] text-white'
                    : 'border border-[var(--border-color)] bg-[var(--bg-card-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-heading)]'
                }`}
              >
                {page}
              </button>
            ) : (
              <span key={page} className="px-1 text-xs text-[var(--text-secondary)]">
                …
              </span>
            ),
          )}

          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="flex cursor-pointer items-center gap-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text-heading)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span>Siguiente</span>
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">chevron_right</span>
          </button>
        </div>
      </div>
    );

  const drawer = detailCustomer ? (
    <div className="horizon-modal fixed inset-0 z-[90] flex justify-end">
      <button
        type="button"
        aria-label="Cerrar ficha del cliente"
        onClick={closeDrawer}
        className="horizon-drawer-backdrop absolute inset-0 bg-black/70"
      />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Ficha e historial de ${detailCustomer.name}`}
        data-client-drawer="true"
        tabIndex={-1}
        className="relative flex h-full w-full flex-col overflow-y-auto border-l border-[var(--border-color)] bg-[var(--bg-primary)] outline-none sm:w-[min(560px,94vw)]"
      >
        {/* Drawer header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[var(--border-color)] bg-[var(--bg-card)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-sm font-bold text-[var(--brand)]">
              {detailCustomer.initials || 'CL'}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-base font-bold text-[var(--text-heading)]" title={detailCustomer.name}>
                  {detailCustomer.name}
                </h2>
                {duplicateIds.has(String(detailCustomer.id)) && (
                  <span className="shrink-0 rounded-full border border-[var(--state-urgency-border)] bg-[var(--state-urgency-tint)] px-2 py-0.5 text-[10px] font-bold text-[var(--state-urgency-text)]">
                    Posible duplicado
                  </span>
                )}
              </div>
              <p className="truncate text-[11px] text-[var(--text-secondary)]">
                {detailCustomer.company || detailCustomer.type || 'Particular'} · ID {detailCustomer.id}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Cerrar ficha"
            className="shrink-0 cursor-pointer rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] p-2 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-heading)]"
          >
            <span aria-hidden="true" className="material-symbols-outlined block text-[18px]">close</span>
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 p-5">
          {/* Primary actions */}
          <div className="flex flex-wrap items-center gap-2">
            {onOpenNewOrderWithCustomer && (
              <button
                type="button"
                onClick={() => {
                  onOpenNewOrderWithCustomer(detailCustomer);
                  closeDrawer();
                }}
                className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-[var(--brand-solid)] px-3.5 py-2.5 text-xs font-bold text-white transition-colors hover:bg-[var(--brand-hover)]"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">add_shopping_cart</span>
                <span>Nuevo pedido</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => handleOpenEditWizard(detailCustomer)}
              className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] px-3 py-2.5 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--brand)]/50"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[17px]">edit</span>
              <span>Editar ficha</span>
            </button>
            <a
              href={`tel:${phoneDigits(detailCustomer.phone)}`}
              aria-label="Llamar al cliente"
              title={`Llamar a ${detailCustomer.phone || 'cliente'}`}
              className="flex items-center gap-1.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] px-3 py-2.5 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:border-emerald-500/50 hover:text-emerald-600 dark:hover:text-emerald-300"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[17px]">call</span>
              <span>Llamar</span>
            </a>
            {whatsappHref(detailCustomer) && (
              <a
                href={whatsappHref(detailCustomer!) || '#'}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Abrir WhatsApp del cliente"
                className="flex items-center gap-1.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] px-3 py-2.5 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:border-emerald-500/50 hover:text-emerald-600 dark:hover:text-emerald-300"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[17px]">chat</span>
                <span>WhatsApp</span>
              </a>
            )}
            {detailCustomer.email && (
              <a
                href={`mailto:${detailCustomer.email}?subject=RADAR%20Salvage%20Yard%20-%20Informaci%C3%B3n%20de%20su%20repuesto`}
                aria-label="Enviar correo al cliente"
                className="flex items-center gap-1.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] px-3 py-2.5 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--brand)]/50 hover:text-[var(--brand)]"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[17px]">mail</span>
                <span>Correo</span>
              </a>
            )}
          </div>

          {/* Contact stats */}
          <div className="grid grid-cols-3 gap-2">
            {(() => {
              const stats = customerStatsMap.get(detailCustomer.id);
              return (
                <>
                  <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3">
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Activas</span>
                    <span className="block font-mono text-lg font-black text-[var(--text-heading)]">{stats?.activeOrdersCount || 0}</span>
                  </div>
                  <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3">
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Totales</span>
                    <span className="block font-mono text-lg font-black text-[var(--text-heading)]">{stats?.totalOrdersCount || 0}</span>
                  </div>
                  <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3">
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Inversión</span>
                    <span className="block truncate font-mono text-sm font-black text-[var(--text-heading)]">
                      ${(stats?.totalSpent || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </>
              );
            })()}
          </div>

          {/* Ficha */}
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
            <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
              <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-[var(--brand)]">contact_page</span>
              Ficha del cliente
            </h3>
            <dl className="grid grid-cols-1 gap-2.5 text-xs sm:grid-cols-2">
              {[
                { label: 'Teléfono', value: detailCustomer.phone || '—', mono: true },
                { label: 'WhatsApp', value: detailCustomer.whatsapp || '—', mono: true },
                { label: 'Correo', value: detailCustomer.email || '—' },
                { label: 'Empresa', value: detailCustomer.company || '—' },
                { label: 'Tipo', value: detailCustomer.type || 'Particular' },
                { label: 'Idioma', value: detailCustomer.language === 'en' ? 'Inglés (EN)' : 'Español (ES)' },
                { label: 'Ubicación', value: detailCustomer.location || '—' },
                { label: 'Código postal', value: detailCustomer.zip_code || '—', mono: true },
              ].map((row) => (
                <div key={row.label} className="min-w-0">
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{row.label}</dt>
                  <dd className={`mt-0.5 truncate text-[var(--text-primary)] ${row.mono ? 'font-mono' : ''}`} title={row.value}>
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Dirección de entrega</span>
              <p className="mt-0.5 text-xs text-[var(--text-primary)]">{detailCustomer.address_shipping || '—'}</p>
            </div>
            {detailCustomer.notes && (
              <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card-subtle)] p-2.5">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Notas internas</span>
                <p className="mt-0.5 text-xs italic text-[var(--text-primary)]">“{detailCustomer.notes}”</p>
              </div>
            )}
          </div>

          {/* Historial */}
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
            <h3 className="mb-3 flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-[var(--brand)]">history</span>
                Historial de pedidos
              </span>
              <span className="font-mono text-[10px] normal-case">{detailOrders.length} registros</span>
            </h3>
            {detailOrders.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--border-color)] p-4 text-center text-xs text-[var(--text-secondary)]">
                Este cliente todavía no tiene pedidos registrados.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {detailOrders.map((ord) => (
                  <li key={ord.id}>
                    <button
                      type="button"
                      onClick={() => {
                        closeDrawer();
                        onSelectOrder(ord.id);
                      }}
                      className="w-full cursor-pointer rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] p-3 text-left transition-colors hover:border-[var(--brand)]/50"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold text-[var(--brand)]">{ord.code}</span>
                        <span className="font-mono text-xs font-bold text-[var(--text-heading)]">
                          ${(ord.financials?.total || ord.financials?.partPrice || 0).toFixed(2)}
                        </span>
                      </span>
                      <span className="mt-1 block truncate text-xs text-[var(--text-primary)]">
                        {ord.vehicle?.year} {ord.vehicle?.make} {ord.vehicle?.model} · {ord.mainPart}
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[var(--text-secondary)]">
                        <span className="rounded-full border border-[var(--border-color)] px-1.5 py-0.5">{ord.status}</span>
                        <span>{ord.createdAt}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {userRole === 'admin' && (
            <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-4">
              <span className="text-[10px] text-[var(--text-secondary)]">Los pedidos históricos se conservan al eliminar.</span>
              <button
                type="button"
                onClick={() => setCustomerToDelete(detailCustomer)}
                className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--state-urgency-border)] bg-[var(--state-urgency-tint)] px-3 py-2 text-xs font-semibold text-[var(--state-urgency-text)] transition-colors hover:border-[var(--state-urgency)]"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">delete</span>
                <span>Eliminar cliente</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null;

  const wizard = isWizardOpen ? (
    <div className="horizon-modal fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2.5 sm:p-4">
      <div
        ref={wizardRef}
        role="dialog"
        aria-modal="true"
        aria-label={wizardMode === 'create' ? 'Registrar nuevo cliente' : 'Ficha de cliente'}
        tabIndex={-1}
        className="flex max-h-[min(94vh,700px)] w-full max-w-2xl flex-col overflow-hidden outline-none"
      >
        {/* Modal Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border-color)] p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
              <span aria-hidden="true" className="material-symbols-outlined text-[22px]">
                {wizardMode === 'create' ? 'person_add' : 'manage_accounts'}
              </span>
            </div>
            <div>
              <h3 className="text-base font-bold text-[var(--text-heading)]">
                {wizardMode === 'create' ? 'Registrar Nuevo Cliente' : 'Ficha de Cliente'}
              </h3>
              <p className="text-xs text-[var(--text-secondary)]">
                Asistente en 2 pasos para perfil, comunicación y direcciones de flete.
              </p>
            </div>
          </div>

          <button
            onClick={closeWizard}
            aria-label="Cerrar asistente de cliente"
            className="cursor-pointer rounded-lg p-1.5 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-heading)]"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* 2-Step Progress Indicator Tabs */}
        <div className="grid grid-cols-2 border-b border-[var(--border-color)] bg-[var(--bg-card-subtle)]">
          <button
            type="button"
            onClick={() => setWizardStep(1)}
            aria-pressed={wizardStep === 1}
            className={`flex cursor-pointer items-center justify-center gap-2 border-b-2 px-4 py-3 text-xs font-bold transition-colors ${
              wizardStep === 1
                ? 'border-[var(--brand-solid)] text-[var(--brand)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-heading)]'
            }`}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--brand-soft)] font-mono text-[11px] text-[var(--brand)]">
              1
            </span>
            <span>Perfil & identidad</span>
          </button>

          <button
            type="button"
            onClick={handleNextStep}
            aria-pressed={wizardStep === 2}
            className={`flex cursor-pointer items-center justify-center gap-2 border-b-2 px-4 py-3 text-xs font-bold transition-colors ${
              wizardStep === 2
                ? 'border-[var(--brand-solid)] text-[var(--brand)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-heading)]'
            }`}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 font-mono text-[11px] text-emerald-600 dark:text-emerald-300">
              2
            </span>
            <span>Contacto & envío</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5 custom-scrollbar">
          {wizardStep === 1 ? (
            <div className="space-y-4">
              {/* Dynamic Avatar and ID Banner */}
              <div className="flex items-center gap-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card-subtle)] p-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-xl font-bold text-[var(--brand)]">
                  {`${editingCustomer.first_name?.[0] || 'C'}${
                    editingCustomer.last_name?.[0] || editingCustomer.first_name?.[1] || 'L'
                  }`.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded border border-[var(--brand)]/30 bg-[var(--bg-card)] px-2 py-0.5 font-mono text-xs font-bold text-[var(--brand)]">
                      ID: #{editingCustomer.id || 'NUEVO'}
                    </span>
                    <span className="text-[11px] text-[var(--text-secondary)]">CRM RADAR</span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-primary)]">
                    Ingrese los datos comerciales y clasifique el tipo de cliente.
                  </p>
                </div>
              </div>

              {/* Name Fields */}
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold text-[var(--text-primary)]">
                    Nombre de Pila o Razón Social <span className="text-[var(--state-urgency-text)]">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. Juan o Simon Auto Sales"
                    value={editingCustomer.first_name || ''}
                    onChange={(e) => {
                      setEditingCustomer({ ...editingCustomer, first_name: e.target.value });
                      if (formErrors.first_name) setFormErrors({});
                    }}
                    aria-invalid={Boolean(formErrors.first_name)}
                    className={`w-full rounded-xl border bg-[var(--input-bg)] px-3 py-2.5 text-xs text-[var(--input-text)] outline-none transition-colors placeholder:text-[var(--text-secondary)] ${
                      formErrors.first_name
                        ? 'border-[var(--state-urgency-border)]'
                        : 'border-[var(--input-border)] focus:border-[var(--brand)]'
                    }`}
                  />
                  {formErrors.first_name && (
                    <span className="mt-1 block text-[11px] text-[var(--state-urgency-text)]">{formErrors.first_name}</span>
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-[var(--text-primary)]">Apellido / Sufijo (Opcional)</label>
                  <input
                    type="text"
                    placeholder="Ej. Pérez o LLC"
                    value={editingCustomer.last_name || ''}
                    onChange={(e) => setEditingCustomer({ ...editingCustomer, last_name: e.target.value })}
                    className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5 text-xs text-[var(--input-text)] outline-none transition-colors placeholder:text-[var(--text-secondary)] focus:border-[var(--brand)]"
                  />
                </div>
              </div>

              {/* Company & Client Type & Language */}
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-[var(--text-primary)]">Taller Mecánico / Empresa</label>
                  <input
                    type="text"
                    placeholder="Ej. Taller El Patrón o RSA"
                    value={editingCustomer.company || ''}
                    onChange={(e) => setEditingCustomer({ ...editingCustomer, company: e.target.value })}
                    className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5 text-xs text-[var(--input-text)] outline-none transition-colors placeholder:text-[var(--text-secondary)] focus:border-[var(--brand)]"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-[var(--text-primary)]">Tipo de Cliente</label>
                  <select
                    value={editingCustomer.type || 'Taller Mecánico'}
                    onChange={(e) => setEditingCustomer({ ...editingCustomer, type: e.target.value as any })}
                    className="w-full cursor-pointer rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5 text-xs text-[var(--input-text)] outline-none transition-colors focus:border-[var(--brand)]"
                  >
                    <option value="Taller Mecánico">Taller Mecánico</option>
                    <option value="VIP">Cliente VIP</option>
                    <option value="Empresa">Empresa</option>
                    <option value="Flota Mantenimiento">Flota Mantenimiento</option>
                    <option value="Particular">Particular</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 flex items-center gap-1 text-xs font-bold text-[var(--text-primary)]">
                    <span aria-hidden="true" className="material-symbols-outlined text-[14px] text-[var(--brand)]">translate</span>
                    <span>Idioma de Contacto</span>
                  </label>
                  <div className="flex items-center gap-1 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-1">
                    <button
                      type="button"
                      onClick={() => setEditingCustomer({ ...editingCustomer, language: 'es' })}
                      aria-pressed={(editingCustomer.language || 'es') === 'es'}
                      className={`flex-1 cursor-pointer rounded-lg px-2 py-1.5 text-xs font-bold transition-all ${
                        (editingCustomer.language || 'es') === 'es'
                          ? 'bg-[var(--brand-soft)] text-[var(--brand)]'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-heading)]'
                      }`}
                    >
                      Español
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingCustomer({ ...editingCustomer, language: 'en' })}
                      aria-pressed={editingCustomer.language === 'en'}
                      className={`flex-1 cursor-pointer rounded-lg px-2 py-1.5 text-xs font-bold transition-all ${
                        editingCustomer.language === 'en'
                          ? 'bg-[var(--brand-soft)] text-[var(--brand)]'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-heading)]'
                      }`}
                    >
                      Inglés
                    </button>
                  </div>
                </div>
              </div>

              {/* Internal Notes */}
              <div>
                <label className="mb-1 flex items-center justify-between text-xs font-bold text-[var(--text-primary)]">
                  <span>Notas Internas del Equipo</span>
                  <span className="text-[10px] font-normal text-[var(--text-secondary)]">Privado</span>
                </label>
                <textarea
                  rows={3}
                  placeholder="Ej. 'Taller mecánico con descuento recurrente del 5%', 'Llamar preferentemente por las mañanas', 'Requiere fotos de garantía antes de despachar'..."
                  value={editingCustomer.notes || ''}
                  onChange={(e) => setEditingCustomer({ ...editingCustomer, notes: e.target.value })}
                  className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-3 text-xs text-[var(--input-text)] outline-none transition-colors placeholder:text-[var(--text-secondary)] custom-scrollbar focus:border-[var(--brand)]"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Phone & alternate contact */}
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold text-[var(--text-primary)]">
                    Teléfono Principal (Llamadas) <span className="text-[var(--state-urgency-text)]">*</span>
                  </label>
                  <div className="relative">
                    <span aria-hidden="true" className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-[var(--brand)]">
                      call
                    </span>
                    <input
                      type="text"
                      placeholder="+1 (919) 555-0192"
                      value={editingCustomer.phone || ''}
                      onChange={(e) => {
                        setEditingCustomer({ ...editingCustomer, phone: e.target.value });
                        if (formErrors.phone) setFormErrors({});
                      }}
                      aria-invalid={Boolean(formErrors.phone)}
                      className={`w-full rounded-xl border bg-[var(--input-bg)] py-2.5 pl-9 pr-3 font-mono text-xs text-[var(--input-text)] outline-none transition-colors placeholder:text-[var(--text-secondary)] ${
                        formErrors.phone
                          ? 'border-[var(--state-urgency-border)]'
                          : 'border-[var(--input-border)] focus:border-[var(--brand)]'
                      }`}
                    />
                  </div>
                  {formErrors.phone && (
                    <span className="mt-1 block text-[11px] text-[var(--state-urgency-text)]">{formErrors.phone}</span>
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-[var(--text-primary)]">Teléfono alternativo (opcional)</label>
                  <div className="relative">
                    <span aria-hidden="true" className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-emerald-600 dark:text-emerald-300">
                      phone_iphone
                    </span>
                    <input
                      type="text"
                      placeholder="Ej. 19195550192 o +1 (919)..."
                      value={editingCustomer.whatsapp || ''}
                      onChange={(e) => setEditingCustomer({ ...editingCustomer, whatsapp: e.target.value })}
                      className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] py-2.5 pl-9 pr-3 font-mono text-xs text-[var(--input-text)] outline-none transition-colors placeholder:text-[var(--text-secondary)] focus:border-[var(--brand)]"
                    />
                  </div>
                </div>
              </div>

              {/* Email & Zip Code */}
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold text-[var(--text-primary)]">Correo Electrónico (Facturas & Recibos)</label>
                  <div className="relative">
                    <span aria-hidden="true" className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-[var(--text-secondary)]">
                      mail
                    </span>
                    <input
                      type="email"
                      placeholder="cliente@ejemplo.com"
                      value={editingCustomer.email || ''}
                      onChange={(e) => setEditingCustomer({ ...editingCustomer, email: e.target.value })}
                      className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] py-2.5 pl-9 pr-3 text-xs text-[var(--input-text)] outline-none transition-colors placeholder:text-[var(--text-secondary)] focus:border-[var(--brand)]"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-[var(--text-primary)]">
                    Código Postal (ZIP) <span className="text-[10px] font-normal text-[var(--brand)]">Fletes Car-Part</span>
                  </label>
                  <div className="relative">
                    <span aria-hidden="true" className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-[var(--text-secondary)]">
                      pin_drop
                    </span>
                    <input
                      type="text"
                      placeholder="Ej. 27520 o 27604"
                      value={editingCustomer.zip_code || ''}
                      onChange={(e) => setEditingCustomer({ ...editingCustomer, zip_code: e.target.value })}
                      className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] py-2.5 pl-9 pr-3 font-mono text-xs text-[var(--input-text)] outline-none transition-colors placeholder:text-[var(--text-secondary)] focus:border-[var(--brand)]"
                    />
                  </div>
                </div>
              </div>

              {/* Shipping Address */}
              <div>
                <label className="mb-1 block text-xs font-bold text-[var(--text-primary)]">
                  Dirección Física de Entrega / Taller Mecánico
                </label>
                <textarea
                  rows={2}
                  placeholder="Calle, Número, Edificio / Taller, Ciudad, Estado (Ej. 1420 US Hwy 70 W, Clayton, NC 27520)"
                  value={editingCustomer.address_shipping || ''}
                  onChange={(e) => setEditingCustomer({ ...editingCustomer, address_shipping: e.target.value })}
                  className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-3 text-xs text-[var(--input-text)] outline-none transition-colors placeholder:text-[var(--text-secondary)] focus:border-[var(--brand)]"
                />
              </div>

              {/* Summary Callout */}
              <div className="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card-subtle)] p-3 text-xs text-[var(--text-secondary)]">
                <span>
                  Cliente:{' '}
                  <strong className="text-[var(--text-heading)]">
                    {editingCustomer.first_name || 'Sin nombre'} {editingCustomer.last_name || ''}
                  </strong>
                </span>
                <span className="font-bold text-[var(--brand)]">{editingCustomer.type || 'Particular'}</span>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="flex items-center justify-between border-t border-[var(--border-color)] p-4">
          {wizardStep === 1 ? (
            <button
              type="button"
              onClick={closeWizard}
              className="cursor-pointer rounded-xl px-4 py-2 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text-heading)]"
            >
              Cancelar
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setWizardStep(1)}
              className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] px-4 py-2 text-xs font-bold text-[var(--text-primary)] transition-colors hover:border-[var(--brand)]/50"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">arrow_back</span>
              <span>Anterior: Perfil</span>
            </button>
          )}

          {wizardStep === 1 ? (
            <button
              type="button"
              onClick={handleNextStep}
              className="flex cursor-pointer items-center gap-2 rounded-xl bg-[var(--brand-solid)] px-5 py-2.5 text-xs font-bold text-white transition-colors hover:bg-[var(--brand-hover)]"
            >
              <span>Siguiente: Contacto y Envío</span>
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSaveCustomer}
              className="flex cursor-pointer items-center gap-2 rounded-xl bg-[var(--brand-solid)] px-5 py-2.5 text-xs font-bold text-white transition-colors hover:bg-[var(--brand-hover)]"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">save</span>
              <span>Guardar Cliente</span>
            </button>
          )}
        </div>
      </div>
    </div>
  ) : null;

  const deleteDialog = customerToDelete ? (
    <div className="horizon-modal fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div
        ref={deleteRef}
        role="dialog"
        aria-modal="true"
        aria-label="Confirmar eliminación de cliente"
        tabIndex={-1}
        className="flex w-full max-w-md flex-col gap-4 p-6 outline-none"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--state-urgency-border)] bg-[var(--state-urgency-tint)] text-[var(--state-urgency-text)]">
            <span aria-hidden="true" className="material-symbols-outlined text-[24px]">warning</span>
          </div>
          <div>
            <h3 className="text-base font-bold text-[var(--text-heading)]">¿Eliminar este cliente?</h3>
            <span className="text-[11px] text-[var(--text-secondary)]">Borrado lógico protegido (soft delete)</span>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-[var(--text-primary)]">
          El cliente <strong className="text-[var(--text-heading)]">"{customerToDelete.name}"</strong> será marcado como
          inactivo en el directorio. Las órdenes pasadas y registros contables históricos{' '}
          <strong className="text-[var(--positive)]">permanecerán intactos</strong> para auditoría.
        </p>

        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card-subtle)] p-3 font-mono text-[11px] text-[var(--text-secondary)]">
          Teléfono: <strong className="text-[var(--text-primary)]">{customerToDelete.phone || '—'}</strong> · ID:{' '}
          {customerToDelete.id}
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            onClick={() => setCustomerToDelete(null)}
            className="cursor-pointer rounded-xl px-4 py-2 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text-heading)]"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirmSoftDelete}
            className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-[var(--state-urgency)] px-4 py-2 text-xs font-bold text-[var(--state-urgency-ink)] transition-all hover:brightness-110"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">delete_forever</span>
            <span>Mover a papelera</span>
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="radar-view horizon-view pb-8">
      {/* Header Bar */}
      <div className="horizon-view-header">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
              <span aria-hidden="true" className="material-symbols-outlined text-[24px]">group</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black tracking-tight text-[var(--text-heading)] md:text-2xl">
                  Directorio de Clientes
                </h1>
              </div>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                CRM operativo centralizado para talleres mecánicos, flotas comerciales y particulares.
              </p>
            </div>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {userRole === 'admin' && (
            <button
              type="button"
              onClick={() => setIsDuplicatesModalOpen(true)}
              title="Detectar y fusionar clientes duplicados (por teléfono, email o nombre)"
              className={`flex cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${
                duplicatesCount > 0
                  ? 'border-[var(--state-urgency-border)] bg-[var(--state-urgency-tint)] text-[var(--state-urgency-text)]'
                  : 'border-[var(--border-color)] bg-[var(--bg-card-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-heading)]'
              }`}
            >
              <span aria-hidden="true" className={`material-symbols-outlined text-[17px] ${duplicatesState === 'loading' ? 'animate-spin' : ''}`}>
                {duplicatesState === 'loading' ? 'progress_activity' : 'merge_type'}
              </span>
              <span>{duplicatesState === 'loading' ? 'Revisando…' : 'Duplicados'}</span>
              {duplicatesState === 'ready' && duplicatesCount > 0 && (
                <span className="rounded-full bg-[var(--state-urgency)] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--state-urgency-ink)]">
                  {duplicatesCount}
                </span>
              )}
            </button>
          )}

          {userRole === 'admin' && (
            <button
              onClick={() => {
                setShowTrash(!showTrash);
                setCurrentPage(1);
              }}
              className={`flex cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${
                showTrash
                  ? 'border-[var(--brand)]/40 bg-[var(--brand-soft)] text-[var(--brand)]'
                  : 'border-[var(--border-color)] bg-[var(--bg-card-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-heading)]'
              }`}
              title="Ver registros eliminados lógicamente (Soft Delete)"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[17px]">
                {showTrash ? 'restore_from_trash' : 'delete_outline'}
              </span>
              <span>{showTrash ? 'Ver activos' : 'Papelera'}</span>
              {!showTrash && totalDeleted > 0 && (
                <span className="rounded-full border border-[var(--border-color)] bg-[var(--bg-card)] px-1.5 py-0.5 font-mono text-[10px] font-bold">
                  {totalDeleted}
                </span>
              )}
            </button>
          )}

          <div className="flex items-center gap-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] p-1">
            <button
              onClick={() => setViewMode('table')}
              aria-pressed={viewMode === 'table'}
              aria-label="Vista en tabla"
              title="Vista en tabla"
              className={`cursor-pointer rounded-lg p-1.5 transition-colors ${
                viewMode === 'table'
                  ? 'bg-[var(--brand-soft)] text-[var(--brand)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-heading)]'
              }`}
            >
              <span aria-hidden="true" className="material-symbols-outlined block text-[18px]">table_rows</span>
            </button>
            <button
              onClick={() => setViewMode('grid')}
              aria-pressed={viewMode === 'grid'}
              aria-label="Vista en tarjetas"
              title="Vista en tarjetas"
              className={`cursor-pointer rounded-lg p-1.5 transition-colors ${
                viewMode === 'grid'
                  ? 'bg-[var(--brand-soft)] text-[var(--brand)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-heading)]'
              }`}
            >
              <span aria-hidden="true" className="material-symbols-outlined block text-[18px]">grid_view</span>
            </button>
          </div>

          <button
            onClick={handleOpenCreateWizard}
            className="horizon-primary flex cursor-pointer items-center gap-1.5 px-3.5 py-2.5 text-xs font-bold"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">person_add</span>
            <span>Nuevo cliente</span>
          </button>
        </div>
      </div>

      {/* Duplicate Alert Strip */}
      {userRole === 'admin' && duplicatesState === 'ready' && duplicatesCount > 0 && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-2xl border border-[var(--state-urgency-border)] bg-[var(--state-urgency-tint)] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--state-urgency-border)] bg-[var(--bg-card)] text-[var(--state-urgency-text)]">
              <span aria-hidden="true" className="material-symbols-outlined text-[20px]">merge_type</span>
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-[var(--text-heading)]">
                {duplicatesCount === 1
                  ? '1 grupo de posibles clientes duplicados'
                  : `${duplicatesCount} grupos de posibles clientes duplicados`}
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Coincidencias por teléfono, correo o nombre. Revisa y fusiona para mantener una ficha única por cliente.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsDuplicatesModalOpen(true)}
            className="horizon-primary flex shrink-0 cursor-pointer items-center gap-1.5 px-3.5 py-2.5 text-xs font-bold"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[17px]">rule</span>
            <span>Revisar duplicados</span>
          </button>
        </div>
      )}

      {/* Trash Mode Strip */}
      {showTrash && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-2xl border border-[var(--state-urgency-border)] bg-[var(--state-urgency-tint)] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--state-urgency-border)] bg-[var(--bg-card)] text-[var(--state-urgency-text)]">
              <span aria-hidden="true" className="material-symbols-outlined text-[20px]">delete_outline</span>
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-[var(--text-heading)]">Estás viendo la papelera ({totalDeleted})</p>
              <p className="text-xs text-[var(--text-secondary)]">
                Los clientes eliminados no aparecen en búsquedas del directorio. Restaura cualquiera para volver a operar con él.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowTrash(false);
              setCurrentPage(1);
            }}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] px-3.5 py-2.5 text-xs font-bold text-[var(--text-primary)] transition-colors hover:border-[var(--brand)]/50"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[17px]">arrow_back</span>
            <span>Volver al directorio</span>
          </button>
        </div>
      )}

      {/* KPI Cards Strip */}
      <div className="horizon-view-metrics grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            key: 'Todos',
            label: 'Directorio Total',
            icon: 'badge',
            value: totalActiveCustomers,
            subtext: `${activeWithOrders} con órdenes activas`,
            tone: 'brand',
          },
          {
            key: 'Taller Mecánico',
            label: 'Talleres Aliados',
            icon: 'build',
            value: totalTalleres,
            subtext: `${totalActiveCustomers > 0 ? Math.round((totalTalleres / totalActiveCustomers) * 100) : 0}% del directorio`,
            tone: 'cyan',
          },
          {
            key: 'Empresas & Flotas',
            label: 'Empresas & Flotas',
            icon: 'local_shipping',
            value: totalEmpresas,
            subtext: `${totalActiveCustomers > 0 ? Math.round((totalEmpresas / totalActiveCustomers) * 100) : 0}% del directorio`,
            tone: 'emerald',
          },
          {
            key: 'VIP',
            label: 'Cuentas VIP',
            icon: 'workspace_premium',
            value: totalVIP,
            subtext: `${totalActiveCustomers > 0 ? Math.round((totalVIP / totalActiveCustomers) * 100) : 0}% del directorio`,
            tone: 'blue',
          },
        ].map((kpi) => {
          const active = filterType === kpi.key && !showTrash;
          const toneClasses =
            kpi.tone === 'brand'
              ? {
                  icon: 'border-[var(--brand)]/30 bg-[var(--brand-soft)] text-[var(--brand)]',
                  active: 'border-[var(--brand)]/60 bg-[var(--bg-card)] ring-1 ring-[var(--brand)]/25',
                  hover: 'hover:border-[var(--brand)]/40',
                }
              : kpi.tone === 'cyan'
                ? {
                    icon: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300',
                    active: 'border-cyan-500/60 bg-[var(--bg-card)] ring-1 ring-cyan-500/25',
                    hover: 'hover:border-cyan-500/40',
                  }
                : kpi.tone === 'emerald'
                  ? {
                      icon: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
                      active: 'border-emerald-500/60 bg-[var(--bg-card)] ring-1 ring-emerald-500/25',
                      hover: 'hover:border-emerald-500/40',
                    }
                  : {
                      icon: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300',
                      active: 'border-blue-500/60 bg-[var(--bg-card)] ring-1 ring-blue-500/25',
                      hover: 'hover:border-blue-500/40',
                    };
          return (
            <button
              key={kpi.key}
              type="button"
              onClick={() => {
                setFilterType(active || showTrash ? 'Todos' : kpi.key);
                setShowTrash(false);
                setCurrentPage(1);
              }}
              aria-pressed={active}
              className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
                active ? toneClasses.active : `border-[var(--border-color)] bg-[var(--bg-card)] ${toneClasses.hover}`
              }`}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${toneClasses.icon}`}>
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{kpi.icon}</span>
              </span>
              <span className="min-w-0">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  {kpi.label}
                </span>
                <span className="block font-mono text-lg font-black tabular-nums text-[var(--text-heading)]">{kpi.value}</span>
                <span className="block truncate text-[10px] text-[var(--text-secondary)]">{kpi.subtext}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Reactive Search & Filter Toolbar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3 sm:p-4 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:max-w-sm">
          <span aria-hidden="true" className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-[var(--text-secondary)]">
            search
          </span>
          <input
            type="text"
            placeholder="Buscar por nombre, teléfono, correo, ZIP..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] py-2 pl-9 pr-8 text-xs text-[var(--input-text)] transition-all placeholder:text-[var(--text-secondary)] focus:border-[var(--brand)] focus:outline-none"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput('')}
              aria-label="Limpiar búsqueda"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer rounded p-0.5 text-[var(--text-secondary)] hover:text-[var(--text-heading)]"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">close</span>
            </button>
          )}
        </div>

        <div className="flex w-full flex-wrap items-center gap-1.5 md:w-auto">
          {TYPE_FILTERS.map((type) => {
            const active = filterType === type.id;
            const count = type.id === 'Todos' ? totalActiveCustomers : typeCounts.get(type.id) || 0;
            return (
              <button
                key={type.id}
                onClick={() => {
                  setFilterType(type.id);
                  setCurrentPage(1);
                }}
                aria-pressed={active}
                className={`cursor-pointer whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'border-[var(--brand)]/40 bg-[var(--brand-soft)] text-[var(--brand)]'
                    : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-card-subtle)] hover:text-[var(--text-heading)]'
                }`}
              >
                {type.label} <span className="font-mono text-[10px] opacity-70">{count}</span>
              </button>
            );
          })}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text-heading)]"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[15px]">filter_alt_off</span>
              Limpiar
            </button>
          )}
        </div>
      </div>

      {/* Results Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-[var(--text-secondary)]">
        <div>
          {showTrash ? (
            <span className="font-semibold text-[var(--state-urgency-text)]">
              Clientes en papelera ({filteredCustomers.length})
            </span>
          ) : (
            <span>
              Mostrando <strong className="text-[var(--text-heading)]">{filteredCustomers.length}</strong> clientes
              {debouncedSearch && ` para la búsqueda "${debouncedSearch}"`}
              {filterType !== 'Todos' && ` · ${filterType}`}
            </span>
          )}
        </div>
        <span className="font-mono text-[11px]">Página {currentPage} de {totalPages} · 12 por página</span>
      </div>

      {/* Content: Table or Cards Grid */}
      {paginatedCustomers.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--bg-card)] p-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--bg-card-subtle)] text-[var(--text-secondary)]">
            <span aria-hidden="true" className="material-symbols-outlined text-[32px]">
              {showTrash ? 'delete_sweep' : hasActiveFilters ? 'person_search' : 'group_off'}
            </span>
          </div>
          <h3 className="text-sm font-bold text-[var(--text-heading)]">
            {showTrash
              ? 'La papelera está vacía'
              : hasActiveFilters
                ? 'Sin resultados'
                : 'No hay clientes registrados'}
          </h3>
          <p className="max-w-md text-xs text-[var(--text-secondary)]">
            {showTrash
              ? 'No hay clientes eliminados con los filtros actuales.'
              : hasActiveFilters
                ? `No hay registros que coincidan${debouncedSearch ? ` con "${debouncedSearch}"` : ' con el filtro seleccionado'}. Ajusta la búsqueda o el tipo de cliente.`
                : 'Registra el primer cliente para comenzar a crear pedidos con su ficha y dirección de flete.'}
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] px-4 py-2 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--brand)]/50"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">filter_alt_off</span>
                Limpiar filtros
              </button>
            )}
            <button
              onClick={handleOpenCreateWizard}
              className="horizon-primary flex cursor-pointer items-center gap-1.5 px-4 py-2 text-xs font-bold"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[17px]">person_add</span>
              Nuevo cliente
            </button>
          </div>
        </div>
      ) : viewMode === 'table' ? (
        <div className="overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] shadow-sm">
          <div className="table-responsive-wrapper custom-scrollbar">
            <table className="w-full min-w-[700px] table-fixed border-collapse text-left text-xs">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[22%]" />
                <col className="w-[12%]" />
                <col className="w-[7%]" />
                <col className="w-[14%]" />
                <col className="w-[15%]" />
              </colgroup>
              <thead className="border-b border-[var(--border-color)] bg-[var(--bg-card-subtle)] text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Cliente</th>
                  <th className="px-3 py-3 font-semibold">Contacto</th>
                  <th className="px-3 py-3 font-semibold">Tipo</th>
                  <th className="px-3 py-3 text-center font-semibold">Órdenes</th>
                  <th className="px-3 py-3 text-right font-semibold">Inversión</th>
                  <th className="px-3 py-3 pr-4 text-right font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-primary)]">
                {paginatedCustomers.map((client) => {
                  const stats = customerStatsMap.get(client.id);
                  const isDuplicate = duplicateIds.has(String(client.id));
                  const wa = whatsappHref(client);
                  return (
                    <tr
                      key={client.id}
                      onClick={() => setDetailCustomer(client)}
                      className={`group cursor-pointer border-l-2 transition-colors hover:bg-[var(--bg-card-subtle)] ${
                        isDuplicate ? 'border-l-[var(--state-urgency)]' : 'border-l-transparent'
                      }`}
                    >
                      <td className="min-w-0 px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="horizon-client-avatar flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold">
                            {client.initials || 'CL'}
                          </span>
                          <span className="min-w-0">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span
                                className="block truncate text-[13px] font-bold text-[var(--text-heading)] transition-colors group-hover:text-[var(--brand)]"
                                title={client.name}
                              >
                                {client.name}
                              </span>
                              {isDuplicate && (
                                <span
                                  aria-label="Posible duplicado"
                                  title="Participa en una posible duplicidad"
                                  className="material-symbols-outlined shrink-0 text-[14px] text-[var(--state-urgency-text)]"
                                >
                                  content_copy
                                </span>
                              )}
                            </span>
                            <span className="block truncate text-[10px] text-[var(--text-secondary)]" title={`ID ${client.id}${client.company ? ` · ${client.company}` : ''}`}>
                              ID {client.id}
                              {client.company ? ` · ${client.company}` : ''}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td className="min-w-0 px-3 py-3">
                        <span className="block truncate font-mono text-xs font-medium text-[var(--text-primary)]">
                          {client.phone || '—'}
                        </span>
                        <span className="block truncate text-[10px] text-[var(--text-secondary)]" title={client.email || ''}>
                          {client.email || 'Sin correo'}
                        </span>
                        <span
                          className="block truncate text-[10px] text-[var(--text-secondary)]"
                          title={[client.location, client.zip_code ? `ZIP ${client.zip_code}` : null].filter(Boolean).join(' · ')}
                        >
                          {client.location || '—'}
                          {client.zip_code ? ` · ${client.zip_code}` : ''}
                        </span>
                      </td>
                      <td className="min-w-0 px-3 py-3">
                        <span
                          className={`inline-flex max-w-full items-center truncate rounded-full border px-2 py-0.5 text-[10px] font-bold ${typeBadgeClasses(client.type)}`}
                          title={client.type || 'Particular'}
                        >
                          {typeShortLabel(client.type)}
                        </span>
                        <span className="mt-1 block text-[10px] text-[var(--text-secondary)]">
                          {client.language === 'en' ? 'EN' : 'ES'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className="block font-mono font-bold text-[var(--text-heading)]">{stats?.activeOrdersCount || 0}</span>
                        <span className="block text-[10px] text-[var(--text-secondary)]">de {stats?.totalOrdersCount || 0}</span>
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-bold text-[var(--text-heading)]">
                        ${(stats?.totalSpent || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-3 pr-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-0.5">
                          <a
                            href={`tel:${phoneDigits(client.phone)}`}
                            aria-label={`Llamar a ${client.name}`}
                            title="Llamar"
                            className="rounded-lg p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-card-subtle)] hover:text-emerald-600 dark:hover:text-emerald-300"
                          >
                            <span aria-hidden="true" className="material-symbols-outlined block text-[16px]">call</span>
                          </a>
                          {wa && (
                            <a
                              href={wa}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`WhatsApp de ${client.name}`}
                              title="WhatsApp"
                              className="rounded-lg p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-card-subtle)] hover:text-emerald-600 dark:hover:text-emerald-300"
                            >
                              <span aria-hidden="true" className="material-symbols-outlined block text-[16px]">chat</span>
                            </a>
                          )}
                          {client.email && (
                            <a
                              href={`mailto:${client.email}?subject=RADAR%20Salvage%20Yard%20-%20Informaci%C3%B3n%20de%20su%20repuesto`}
                              aria-label={`Correo a ${client.name}`}
                              title="Correo"
                              className="rounded-lg p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-card-subtle)] hover:text-[var(--brand)]"
                            >
                              <span aria-hidden="true" className="material-symbols-outlined block text-[16px]">mail</span>
                            </a>
                          )}
                          <button
                            onClick={() => handleOpenEditWizard(client)}
                            aria-label={`Editar ficha de ${client.name}`}
                            title="Editar ficha"
                            className="cursor-pointer rounded-lg p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-card-subtle)] hover:text-[var(--brand)]"
                          >
                            <span aria-hidden="true" className="material-symbols-outlined block text-[16px]">edit</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {paginatedCustomers.map((client) => {
            const stats = customerStatsMap.get(client.id) || {
              activeOrdersCount: 0,
              totalOrdersCount: 0,
              totalSpent: 0,
              lastOrder: null,
              vehicles: [],
            };
            const wa = whatsappHref(client);
            return (
              <div
                key={client.id}
                onClick={() => setDetailCustomer(client)}
                className="horizon-client-card group flex cursor-pointer flex-col gap-4 rounded-3xl p-5 text-[var(--text-primary)] transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="horizon-client-avatar flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-bold">
                      {client.initials || 'CL'}
                    </div>
                    <div className="min-w-0">
                      <h3 title={client.name} className="truncate text-sm font-bold text-[var(--text-heading)] transition-colors group-hover:text-[var(--brand)]">
                        {client.name}
                      </h3>
                      <p className="truncate text-[11px] font-medium text-[var(--text-secondary)]">
                        {client.company || 'Particular'}
                      </p>
                      <span className="block text-[10px] text-[var(--text-secondary)]">ID {client.id}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${typeBadgeClasses(client.type)}`}>
                      {client.type || 'Particular'}
                    </span>
                    <span className="text-[10px] font-medium text-[var(--text-secondary)]">
                      {client.language === 'en' ? 'EN' : 'ES'} · ZIP {client.zip_code || '—'}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 text-xs">
                  <span className="flex items-center gap-1.5 text-[var(--text-primary)]">
                    <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-[var(--brand)]">call</span>
                    <span className="font-mono">{client.phone || '—'}</span>
                  </span>
                  {client.email && (
                    <span className="flex items-center gap-1.5 truncate text-[var(--text-secondary)]">
                      <span aria-hidden="true" className="material-symbols-outlined text-[15px]">mail</span>
                      <span className="truncate">{client.email}</span>
                    </span>
                  )}
                  {client.location && (
                    <span className="flex items-center gap-1.5 truncate text-[var(--text-secondary)]">
                      <span aria-hidden="true" className="material-symbols-outlined text-[15px]">pin_drop</span>
                      <span className="truncate">{client.location}</span>
                    </span>
                  )}
                </div>

                <div className="horizon-client-stats mt-auto grid grid-cols-2 gap-3 rounded-2xl p-3 text-xs">
                  <div>
                    <span className="mb-1 block text-[10px] font-medium text-[var(--text-secondary)]">Órdenes activas</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetailCustomer(client);
                      }}
                      className="flex cursor-pointer items-center gap-1 font-bold text-[var(--brand)] hover:underline"
                    >
                      <span>{stats.activeOrdersCount} activas</span>
                      <span className="text-[10px] text-[var(--text-secondary)]">({stats.totalOrdersCount} tot.)</span>
                    </button>
                  </div>
                  <div className="text-right">
                    <span className="mb-1 block text-[10px] font-medium text-[var(--text-secondary)]">Inversión histórica</span>
                    <span className="font-mono text-sm font-bold text-[var(--text-heading)]">
                      ${stats.totalSpent.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                <div
                  className="horizon-client-actions flex flex-wrap items-center gap-2 border-t pt-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  {onOpenNewOrderWithCustomer && (
                    <button
                      type="button"
                      onClick={() => onOpenNewOrderWithCustomer(client)}
                      aria-label={`Crear orden para ${client.name}`}
                      title="Crear nueva orden"
                      className="rounded-lg border border-[var(--brand)]/30 bg-[var(--brand-soft)] px-2.5 py-1.5 text-[var(--brand)]"
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[17px]">add_shopping_cart</span>
                    </button>
                  )}
                  <a href={`tel:${phoneDigits(client.phone)}`} aria-label={`Llamar a ${client.name}`} title="Llamar" className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:text-emerald-600 dark:hover:text-emerald-300">
                    <span aria-hidden="true" className="material-symbols-outlined text-[17px]">call</span>
                  </a>
                  {wa && (
                    <a href={wa} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp de ${client.name}`} title="WhatsApp" className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:text-emerald-600 dark:hover:text-emerald-300">
                      <span aria-hidden="true" className="material-symbols-outlined text-[17px]">chat</span>
                    </a>
                  )}
                  {client.email && (
                    <a
                      href={`mailto:${client.email}?subject=RADAR%20Salvage%20Yard%20-%20Informaci%C3%B3n%20de%20su%20repuesto`}
                      aria-label={`Correo a ${client.name}`}
                      title="Correo"
                      className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:text-[var(--brand)]"
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[17px]">mail</span>
                    </a>
                  )}
                  <button
                    onClick={() => handleOpenEditWizard(client)}
                    aria-label={`Editar ficha de ${client.name}`}
                    title="Editar ficha"
                    className="cursor-pointer rounded-lg p-1.5 text-[var(--text-secondary)] hover:text-[var(--brand)]"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[17px]">edit</span>
                  </button>
                  {client.deleted_at ? (
                    userRole === 'admin' && (
                      <button
                        onClick={() => handleRestoreCustomer(client.id)}
                        aria-label={`Restaurar a ${client.name}`}
                        title="Restaurar cliente"
                        className="cursor-pointer rounded-lg p-1.5 text-[var(--text-secondary)] hover:text-emerald-600 dark:hover:text-emerald-300"
                      >
                        <span aria-hidden="true" className="material-symbols-outlined text-[17px]">restore_from_trash</span>
                      </button>
                    )
                  ) : userRole === 'admin' ? (
                    <button
                      onClick={() => setCustomerToDelete(client)}
                      aria-label={`Eliminar a ${client.name}`}
                      title="Eliminar cliente (soft delete)"
                      className="cursor-pointer rounded-lg p-1.5 text-[var(--text-secondary)] hover:text-[var(--state-urgency-text)]"
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[17px]">delete</span>
                    </button>
                  ) : (
                    <button
                      disabled
                      aria-label="Solo administradores pueden eliminar clientes"
                      title="Solo administradores pueden eliminar clientes"
                      className="cursor-not-allowed rounded-lg p-1.5 text-[var(--text-secondary)] opacity-40"
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[17px]">lock</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {renderPagination()}

      {/* Portaled dialogs (drawer first so nested dialogs stack above it) */}
      {typeof document !== 'undefined' && detailCustomer ? createPortal(drawer, document.body) : drawer}
      {typeof document !== 'undefined' && isWizardOpen ? createPortal(wizard, document.body) : wizard}
      {typeof document !== 'undefined' && customerToDelete ? createPortal(deleteDialog, document.body) : deleteDialog}

      {/* Customer Duplicates Merge Assistant Modal */}
      <CustomerDuplicatesModal
        isOpen={isDuplicatesModalOpen}
        onClose={() => setIsDuplicatesModalOpen(false)}
        onMerged={() => {
          showToast('Clientes fusionados exitosamente.');
          if (onRefreshCustomers) onRefreshCustomers();
        }}
      />
    </div>
  );
};
