import React, { useState, useMemo, useEffect } from 'react';
import { Customer, Order } from '../types';

interface ClientsViewProps {
  orders: Order[];
  customers: Customer[];
  onSelectOrder: (orderId: string) => void;
  onOpenSMS?: (customerName: string, phone: string) => void;
  userRole?: 'admin' | 'operador';
  onOpenNewOrderWithCustomer?: (customer: Customer) => void;
}

export const ClientsView: React.FC<ClientsViewProps> = ({
  orders,
  customers,
  onSelectOrder,
  onOpenSMS,
  userRole = 'admin',
  onOpenNewOrderWithCustomer,
}) => {
  // Master Customers State
  const [customerRecords, setCustomerRecords] = useState<Customer[]>(customers);

  useEffect(() => setCustomerRecords(customers), [customers]);

  // Search & Filter State with Debounce
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('Todos');
  const [showTrash, setShowTrash] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

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

  // Customer Orders Quick Drawer Modal
  const [viewingOrdersCustomer, setViewingOrdersCustomer] = useState<Customer | null>(null);

  // Success Feedback Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Debounce Search Effect (300ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setCurrentPage(1); // Reset to page 1 on search
    }, 300);
    return () => clearTimeout(handler);
  }, [searchInput]);

  // Compute metrics from real orders for each customer
  const customerStatsMap = useMemo(() => {
    const map = new Map<
      string,
      { activeOrdersCount: number; totalOrdersCount: number; totalSpent: number; lastOrder: Order | null }
    >();

    customerRecords.forEach((cust) => {
      const custOrders = orders.filter((o) => {
        if (!o.customer) return false;
        if (o.customer.id && o.customer.id === cust.id) return true;
        if (o.customer.name && cust.name && o.customer.name.toLowerCase() === cust.name.toLowerCase()) return true;
        if (o.customer.phone && cust.phone && o.customer.phone.replace(/\D/g, '') === cust.phone.replace(/\D/g, '')) return true;
        return false;
      });

      const activeOrders = custOrders.filter(
        (o) =>
          o.status !== 'entregado' &&
          o.status !== 'cancelado' &&
          o.status !== 'reembolsado' &&
          o.status !== 'archivado'
      );

      const totalSpent = custOrders.reduce((sum, o) => {
        const amt = o.financials?.total || o.financials?.partPrice || 0;
        return sum + amt;
      }, 0);

      const lastOrder = custOrders[0] || null;

      map.set(cust.id, {
        activeOrdersCount: activeOrders.length,
        totalOrdersCount: custOrders.length,
        totalSpent,
        lastOrder,
      });
    });

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
      if (filterType !== 'Todos' && cust.type !== filterType) {
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

  // Overall Global KPI counts
  const totalActiveCustomers = customerRecords.filter((c) => !c.deleted_at).length;
  const totalTalleres = customerRecords.filter((c) => !c.deleted_at && c.type === 'Taller Mecánico').length;
  const totalVIP = customerRecords.filter((c) => !c.deleted_at && c.type === 'VIP').length;
  const totalEmpresas = customerRecords.filter((c) => !c.deleted_at && (c.type === 'Empresa' || c.type === 'Flota Mantenimiento')).length;
  const totalDeleted = customerRecords.filter((c) => Boolean(c.deleted_at)).length;

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
    setEditingCustomer({ ...customer });
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
  const handleSaveCustomer = () => {
    const errors: { [key: string]: string } = {};
    if (!editingCustomer.phone?.trim()) {
      errors.phone = 'El teléfono principal es obligatorio para coordinación y fletes.';
    }
    setFormErrors(errors);

    if (Object.keys(errors).length > 0) return;

    const firstName = (editingCustomer.first_name || '').trim();
    const lastName = (editingCustomer.last_name || '').trim();
    const fullName = firstName && lastName ? `${firstName} ${lastName}` : firstName || editingCustomer.name || 'Cliente sin nombre';
    const initials =
      `${firstName[0] || ''}${lastName[0] || firstName[1] || ''}`.toUpperCase() || 'CL';

    const cleanWhatsapp = editingCustomer.whatsapp
      ? editingCustomer.whatsapp.replace(/\D/g, '')
      : editingCustomer.phone?.replace(/\D/g, '') || '';

    const finalCustomer: Customer = {
      id: editingCustomer.id || `CUST-${Math.floor(1000 + Math.random() * 9000)}`,
      first_name: firstName,
      last_name: lastName,
      name: fullName,
      company: editingCustomer.company || '',
      type: (editingCustomer.type as any) || 'Particular',
      email: editingCustomer.email || '',
      phone: editingCustomer.phone || '',
      whatsapp: cleanWhatsapp,
      location: editingCustomer.location || 'Raleigh, NC',
      address_shipping: editingCustomer.address_shipping || '',
      shippingAddress: editingCustomer.address_shipping || '',
      zip_code: editingCustomer.zip_code || '27604',
      notes: editingCustomer.notes || '',
      initials: initials,
      createdAt: editingCustomer.createdAt || new Date().toISOString().split('T')[0],
      deleted_at: null,
    };

    if (wizardMode === 'create') {
      setCustomerRecords([finalCustomer, ...customerRecords]);
      showToast(`Cliente "${finalCustomer.name}" registrado exitosamente.`);
    } else {
      setCustomerRecords(customerRecords.map((c) => (c.id === finalCustomer.id ? finalCustomer : c)));
      showToast(`Ficha de "${finalCustomer.name}" actualizada con éxito.`);
    }

    setIsWizardOpen(false);
  };

  // Perform Soft Delete (Admin Protected)
  const handleConfirmSoftDelete = () => {
    if (!customerToDelete) return;
    if (userRole !== 'admin') {
      alert('Acción denegada: Solo los administradores tienen permiso para eliminar clientes.');
      setCustomerToDelete(null);
      return;
    }

    setCustomerRecords((prev) =>
      prev.map((c) =>
        c.id === customerToDelete.id
          ? { ...c, deleted_at: new Date().toISOString() }
          : c
      )
    );

    showToast(`Cliente "${customerToDelete.name}" enviado a la papelera (Soft Delete).`);
    setCustomerToDelete(null);
  };

  // Restore Soft Deleted Customer
  const handleRestoreCustomer = (customerId: string) => {
    setCustomerRecords((prev) =>
      prev.map((c) => (c.id === customerId ? { ...c, deleted_at: null } : c))
    );
    showToast('Cliente restaurado al directorio activo.');
  };

  // Helper for quick WhatsApp Link
  const buildWhatsAppLink = (customer: Customer) => {
    const rawPhone = customer.whatsapp || customer.phone || '';
    const cleanDigits = rawPhone.replace(/\D/g, '');
    const phoneWithCountry = cleanDigits.startsWith('1')
      ? cleanDigits
      : cleanDigits.length === 10
      ? `1${cleanDigits}`
      : cleanDigits;
    const greeting = encodeURIComponent(
      `Hola ${customer.first_name || customer.name}, le saludamos de RADAR Salvage Yard respecto a su cotización y repuestos.`
    );
    return `https://wa.me/${phoneWithCountry}?text=${greeting}`;
  };

  return (
    <div className="radar-view select-none">
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#10b981] text-[#042f2e] font-bold text-xs py-3 px-5 rounded-xl shadow-[0_10px_25px_rgba(16,185,129,0.4)] flex items-center gap-2.5 animate-bounce">
          <span className="material-symbols-outlined text-[20px]">check_circle</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header Bar */}
      <div className="bg-[#111827]/90 border border-[#1e293b] rounded-2xl p-5 md:p-6 backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-5 shadow-lg">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#388bfd]/30 to-[#1d4ed8]/40 border border-[#388bfd]/50 flex items-center justify-center text-[#58a6ff] shadow-inner">
              <span className="material-symbols-outlined text-[24px]">group</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl md:text-2xl font-black text-[#f1f5f9] tracking-tight">
                  Directorio de Clientes
                </h1>
                <span className="text-[11px] font-mono font-bold bg-[#1e293b] text-[#58a6ff] border border-[#388bfd]/30 px-2 py-0.5 rounded-full">
                  /customers
                </span>
              </div>
              <p className="text-xs text-[#94a3b8] mt-0.5">
                CRM operativo centralizado para talleres mecánicos, flotas comerciales y particulares.
              </p>
            </div>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Admin Trash Toggle */}
          {userRole === 'admin' && (
            <button
              onClick={() => {
                setShowTrash(!showTrash);
                setCurrentPage(1);
              }}
              className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border ${
                showTrash
                  ? 'bg-[#ef4444]/15 border-[#ef4444]/40 text-[#fca5a5]'
                  : 'bg-[#1e293b]/70 border-[#334155]/60 text-[#94a3b8] hover:text-white'
              }`}
              title="Ver registros eliminados lógicamente (Soft Delete)"
            >
              <span className="material-symbols-outlined text-[17px]">
                {showTrash ? 'restore_from_trash' : 'delete_outline'}
              </span>
              <span>{showTrash ? 'Ver Activos' : `Papelera (${totalDeleted})`}</span>
            </button>
          )}

          {/* Grid / Table View Switcher */}
          <div className="flex items-center bg-[#0b1329] border border-[#1e293b] rounded-xl p-0.5">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-[#1e293b] text-[#58a6ff] shadow-sm'
                  : 'text-[#64748b] hover:text-[#cbd5e1]'
              }`}
              title="Vista en Tarjetas"
            >
              <span className="material-symbols-outlined text-[19px]">grid_view</span>
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-[#1e293b] text-[#58a6ff] shadow-sm'
                  : 'text-[#64748b] hover:text-[#cbd5e1]'
              }`}
              title="Vista en Tabla"
            >
              <span className="material-symbols-outlined text-[19px]">table_rows</span>
            </button>
          </div>

          {/* New Customer Button */}
          <button
            onClick={handleOpenCreateWizard}
            className="bg-gradient-to-r from-[#388bfd] to-[#2563eb] hover:from-[#2563eb] hover:to-[#1d4ed8] text-[#0a1120] hover:text-white font-bold text-xs py-2.5 px-4 rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-[0_0_15px_rgba(56,139,253,0.35)]"
          >
            <span className="material-symbols-outlined text-[18px]">person_add</span>
            <span>Nuevo Cliente</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[#111827]/70 border border-[#1e293b] rounded-xl p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#388bfd]/10 text-[#388bfd] flex items-center justify-center">
            <span className="material-symbols-outlined text-[20px]">badge</span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-[#64748b] block">Directorio Total</span>
            <span className="text-base font-mono font-bold text-[#f1f5f9]">{totalActiveCustomers} Clientes</span>
          </div>
        </div>

        <div className="bg-[#111827]/70 border border-[#1e293b] rounded-xl p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#6366f1]/15 text-[#818cf8] flex items-center justify-center">
            <span className="material-symbols-outlined text-[20px]">build</span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-[#64748b] block">Talleres Aliados</span>
            <span className="text-base font-mono font-bold text-[#818cf8]">{totalTalleres} Registrados</span>
          </div>
        </div>

        <div className="bg-[#111827]/70 border border-[#1e293b] rounded-xl p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#10b981]/15 text-[#34d399] flex items-center justify-center">
            <span className="material-symbols-outlined text-[20px]">local_shipping</span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-[#64748b] block">Empresas & Flotas</span>
            <span className="text-base font-mono font-bold text-[#34d399]">{totalEmpresas} Cuentas</span>
          </div>
        </div>

        <div className="bg-[#111827]/70 border border-[#1e293b] rounded-xl p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#f59e0b]/15 text-[#fbbf24] flex items-center justify-center">
            <span className="material-symbols-outlined text-[20px]">workspace_premium</span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-[#64748b] block">Cuentas VIP</span>
            <span className="text-base font-mono font-bold text-[#fbbf24]">{totalVIP} Cuentas</span>
          </div>
        </div>
      </div>

      {/* Reactive Search & Filter Toolbar */}
      <div className="bg-[#0f172a]/95 border border-[#1e293b] rounded-xl p-3.5 flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Search Bar with Debounce 300ms */}
        <div className="relative w-full md:w-96">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8] text-[18px]">
            search
          </span>
          <input
            type="text"
            placeholder="Buscar por Nombre, Teléfono, WhatsApp, Correo, ZIP..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full bg-[#0b1329] border border-[#1e293b] rounded-xl py-2 pl-9 pr-8 text-xs text-[#f1f5f9] placeholder:text-[#64748b] focus:outline-none focus:border-[#388bfd] transition-all font-sans"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-white p-0.5 rounded"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          )}
        </div>

        {/* Client Type Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0 custom-scrollbar">
          {['Todos', 'Taller Mecánico', 'VIP', 'Empresa', 'Flota Mantenimiento', 'Particular'].map(
            (type) => (
              <button
                key={type}
                onClick={() => {
                  setFilterType(type);
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  filterType === type
                    ? 'bg-[#1e293b] text-[#58a6ff] border border-[#388bfd]/50 shadow-[0_0_10px_rgba(56,139,253,0.2)]'
                    : 'text-[#94a3b8] hover:text-[#f1f5f9] bg-[#0b1329]/60 hover:bg-[#1e293b]/50 border border-transparent'
                }`}
              >
                {type}
              </button>
            )
          )}
        </div>
      </div>

      {/* Results Header Info */}
      <div className="flex items-center justify-between text-xs text-[#94a3b8] px-1">
        <div>
          {showTrash ? (
            <span className="text-[#fca5a5] font-bold">
              Mostrando clientes en la papelera ({filteredCustomers.length})
            </span>
          ) : (
            <span>
              Mostrando <strong className="text-white">{filteredCustomers.length}</strong> clientes
              {debouncedSearch && ` para la búsqueda "${debouncedSearch}"`}
            </span>
          )}
        </div>
        <span className="font-mono text-[11px] text-[#64748b]">
          Página {currentPage} de {totalPages} · Límite de 12 por página
        </span>
      </div>

      {/* Content: Cards Grid or Table View */}
      {paginatedCustomers.length === 0 ? (
        <div className="bg-[#111827]/40 border border-dashed border-[#1e293b] rounded-2xl p-12 text-center flex flex-col items-center justify-center gap-3">
          <div className="w-14 h-14 rounded-full bg-[#1e293b]/70 flex items-center justify-center text-[#64748b]">
            <span className="material-symbols-outlined text-[32px]">person_search</span>
          </div>
          <h3 className="text-sm font-bold text-[#e2e8f0]">No se encontraron clientes</h3>
          <p className="text-xs text-[#94a3b8] max-w-md">
            {debouncedSearch
              ? `No hay registros que coincidan con "${debouncedSearch}". Intenta con otro término o código postal.`
              : 'No hay clientes registrados en este filtro.'}
          </p>
          <button
            onClick={handleOpenCreateWizard}
            className="mt-2 bg-[#388bfd]/20 hover:bg-[#388bfd]/30 text-[#58a6ff] border border-[#388bfd]/40 text-xs font-semibold py-2 px-4 rounded-xl flex items-center gap-2 cursor-pointer transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            <span>Registrar Nuevo Cliente</span>
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        /* GRID VIEW (Cards) */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {paginatedCustomers.map((client) => {
            const stats = customerStatsMap.get(client.id) || {
              activeOrdersCount: 0,
              totalOrdersCount: 0,
              totalSpent: 0,
              lastOrder: null,
            };

            let badgeStyle = 'bg-slate-800/80 text-slate-300 border-slate-700';
            if (client.type === 'VIP')
              badgeStyle = 'bg-amber-500/15 text-amber-300 border-amber-500/40';
            else if (client.type === 'Taller Mecánico')
              badgeStyle = 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40';
            else if (client.type === 'Flota Mantenimiento')
              badgeStyle = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
            else if (client.type === 'Empresa')
              badgeStyle = 'bg-blue-500/15 text-blue-300 border-blue-500/40';

            return (
              <div
                key={client.id}
                className="bg-[#0f172a]/90 border border-[#1e293b] hover:border-[#388bfd]/50 rounded-2xl p-4.5 flex flex-col justify-between gap-3.5 transition-all duration-200 hover:shadow-[0_8px_24px_rgba(0,0,0,0.4)] group relative"
              >
                {/* Card Top Section */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-[#1e293b] to-[#334155] border border-[#475569]/60 flex items-center justify-center text-[#f1f5f9] font-black text-sm shadow-inner shrink-0">
                      {client.initials || 'CL'}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-bold text-sm text-[#f1f5f9] group-hover:text-[#58a6ff] transition-colors truncate">
                          {client.name}
                        </h3>
                      </div>
                      <p className="text-[11px] text-[#94a3b8] truncate font-medium">
                        {client.company || 'Particular'}
                      </p>
                      <span className="text-[10px] font-mono text-[#64748b]">ID: {client.id}</span>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${badgeStyle}`}
                  >
                    {client.type}
                  </span>
                </div>

                {/* Location & Contact Info */}
                <div className="flex flex-col gap-1.5 text-xs text-[#cbd5e1] border-t border-[#1e293b] pt-2.5">
                  <div className="flex items-center justify-between text-[#94a3b8]">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="material-symbols-outlined text-[15px] text-[#58a6ff]">call</span>
                      <span className="font-mono text-white text-[12px]">{client.phone}</span>
                    </div>
                    {client.zip_code && (
                      <span className="text-[10px] font-mono bg-[#1e293b] text-[#94a3b8] px-1.5 py-0.5 rounded border border-[#334155]/60">
                        📍 ZIP: {client.zip_code}
                      </span>
                    )}
                  </div>

                  {client.email && (
                    <div className="flex items-center gap-1.5 text-[#94a3b8] truncate">
                      <span className="material-symbols-outlined text-[15px]">mail</span>
                      <span className="truncate">{client.email}</span>
                    </div>
                  )}

                  {client.address_shipping && (
                    <div className="flex items-start gap-1.5 text-[#94a3b8] text-[11px]">
                      <span className="material-symbols-outlined text-[15px] shrink-0 mt-0.5">
                        local_shipping
                      </span>
                      <span className="line-clamp-1">{client.address_shipping}</span>
                    </div>
                  )}

                  {client.notes && (
                    <div className="bg-[#0b1329]/90 border border-[#1e293b] rounded-lg p-2 text-[11px] text-[#94a3b8] mt-1 line-clamp-2 italic">
                      "{client.notes}"
                    </div>
                  )}
                </div>

                {/* Real-time Order Stats */}
                <div className="bg-[#0b1329] p-2.5 rounded-xl border border-[#1e293b] flex justify-between items-center text-xs">
                  <div>
                    <span className="text-[9px] text-[#64748b] uppercase font-bold block">
                      Órdenes Activas
                    </span>
                    <button
                      onClick={() => setViewingOrdersCustomer(client)}
                      className="font-bold text-[#388bfd] hover:underline cursor-pointer flex items-center gap-1"
                    >
                      <span>{stats.activeOrdersCount} activas</span>
                      <span className="text-[10px] text-[#64748b]">({stats.totalOrdersCount} tot.)</span>
                    </button>
                  </div>
                  <div className="text-right">
                    <span className="text-[9px] text-[#64748b] uppercase font-bold block">
                      Inversión Histórica
                    </span>
                    <span className="font-mono font-bold text-[#10b981]">
                      ${stats.totalSpent.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                    </span>
                  </div>
                </div>

                {/* Action Bar (Direct WhatsApp, Call, Email, Edit, Delete) */}
                <div className="flex items-center gap-1.5 pt-1 border-t border-[#1e293b]">
                  {/* WhatsApp Quick Action */}
                  <a
                    href={buildWhatsAppLink(client)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-1.5 px-2 rounded-lg bg-[#10b981]/15 hover:bg-[#10b981]/25 text-[#34d399] border border-[#10b981]/30 text-xs font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer"
                    title="Abrir chat directo en WhatsApp Web / App"
                  >
                    <span className="material-symbols-outlined text-[16px]">chat</span>
                    <span>WhatsApp</span>
                  </a>

                  {/* Phone Call */}
                  <a
                    href={`tel:${client.phone.replace(/\D/g, '')}`}
                    className="p-1.5 rounded-lg bg-[#1e293b] hover:bg-[#334155] text-[#cbd5e1] hover:text-white transition-colors cursor-pointer border border-[#334155]/60"
                    title="Llamar directamente"
                  >
                    <span className="material-symbols-outlined text-[17px]">call</span>
                  </a>

                  {/* Email */}
                  {client.email ? (
                    <a
                      href={`mailto:${client.email}?subject=RADAR%20Salvage%20Yard%20-%20Informaci%C3%B3n%20de%20su%20repuesto`}
                      className="p-1.5 rounded-lg bg-[#1e293b] hover:bg-[#334155] text-[#cbd5e1] hover:text-white transition-colors cursor-pointer border border-[#334155]/60"
                      title="Enviar Correo"
                    >
                      <span className="material-symbols-outlined text-[17px]">mail</span>
                    </a>
                  ) : null}

                  {/* Edit / View Wizard */}
                  <button
                    onClick={() => handleOpenEditWizard(client)}
                    className="p-1.5 rounded-lg bg-[#388bfd]/15 hover:bg-[#388bfd]/25 text-[#58a6ff] border border-[#388bfd]/30 transition-colors cursor-pointer"
                    title="Ver Ficha / Editar en Asistente de 2 Pasos"
                  >
                    <span className="material-symbols-outlined text-[17px]">edit</span>
                  </button>

                  {/* Soft Delete or Restore */}
                  {client.deleted_at ? (
                    <button
                      onClick={() => handleRestoreCustomer(client.id)}
                      className="p-1.5 rounded-lg bg-[#10b981]/20 hover:bg-[#10b981]/30 text-[#34d399] border border-[#10b981]/40 transition-colors cursor-pointer"
                      title="Restaurar Cliente"
                    >
                      <span className="material-symbols-outlined text-[17px]">restore_from_trash</span>
                    </button>
                  ) : userRole === 'admin' ? (
                    <button
                      onClick={() => setCustomerToDelete(client)}
                      className="p-1.5 rounded-lg bg-[#ef4444]/10 hover:bg-[#ef4444]/20 text-[#f87171] border border-[#ef4444]/20 transition-colors cursor-pointer"
                      title="Eliminar Cliente (Soft Delete)"
                    >
                      <span className="material-symbols-outlined text-[17px]">delete</span>
                    </button>
                  ) : (
                    <button
                      disabled
                      className="p-1.5 rounded-lg bg-[#1e293b]/40 text-[#475569] border border-transparent cursor-not-allowed"
                      title="Solo Administradores pueden eliminar clientes"
                    >
                      <span className="material-symbols-outlined text-[17px]">lock</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* TABLE VIEW */
        <div className="bg-[#0f172a]/90 border border-[#1e293b] rounded-2xl overflow-hidden shadow-lg">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[#111827] text-[#94a3b8] uppercase font-bold text-[10px] border-b border-[#1e293b]">
                <tr>
                  <th className="p-3.5 pl-4">Cliente / Contacto</th>
                  <th className="p-3.5">Empresa / Taller</th>
                  <th className="p-3.5">Tipo</th>
                  <th className="p-3.5">Teléfono / WhatsApp</th>
                  <th className="p-3.5">Ubicación / ZIP</th>
                  <th className="p-3.5 text-center">Órdenes</th>
                  <th className="p-3.5 text-right">Inversión</th>
                  <th className="p-3.5 pr-4 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e293b] text-[#cbd5e1]">
                {paginatedCustomers.map((client) => {
                  const stats = customerStatsMap.get(client.id) || {
                    activeOrdersCount: 0,
                    totalOrdersCount: 0,
                    totalSpent: 0,
                    lastOrder: null,
                  };

                  return (
                    <tr
                      key={client.id}
                      className="hover:bg-[#1e293b]/40 transition-colors group cursor-pointer"
                      onClick={() => handleOpenEditWizard(client)}
                    >
                      <td className="p-3.5 pl-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-[#1e293b] border border-[#334155] flex items-center justify-center font-black text-[#f1f5f9] text-xs shrink-0">
                            {client.initials}
                          </div>
                          <div>
                            <strong className="text-white block group-hover:text-[#58a6ff] transition-colors">
                              {client.name}
                            </strong>
                            <span className="text-[10px] text-[#64748b] font-mono">
                              ID: {client.id}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="p-3.5 text-[#94a3b8] font-medium">
                        {client.company || '—'}
                      </td>
                      <td className="p-3.5">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-[#1e293b] text-[#94a3b8] border-[#334155]/60">
                          {client.type}
                        </span>
                      </td>
                      <td className="p-3.5">
                        <div className="font-mono text-white text-xs">{client.phone}</div>
                        {client.email && (
                          <span className="text-[11px] text-[#64748b] block truncate max-w-[150px]">
                            {client.email}
                          </span>
                        )}
                      </td>
                      <td className="p-3.5">
                        <div className="text-white">{client.location}</div>
                        {client.zip_code && (
                          <span className="text-[10px] font-mono text-[#58a6ff]">
                            ZIP: {client.zip_code}
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 text-center">
                        <span className="font-bold text-[#388bfd]">
                          {stats.activeOrdersCount} activas
                        </span>
                      </td>
                      <td className="p-3.5 text-right font-mono font-bold text-[#10b981]">
                        ${stats.totalSpent.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td
                        className="p-3.5 pr-4 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-center gap-1.5">
                          <a
                            href={buildWhatsAppLink(client)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg bg-[#10b981]/15 hover:bg-[#10b981]/25 text-[#34d399] border border-[#10b981]/30 transition-colors"
                            title="WhatsApp"
                          >
                            <span className="material-symbols-outlined text-[16px]">chat</span>
                          </a>
                          <button
                            onClick={() => handleOpenEditWizard(client)}
                            className="p-1.5 rounded-lg bg-[#388bfd]/15 hover:bg-[#388bfd]/25 text-[#58a6ff] border border-[#388bfd]/30 transition-colors"
                            title="Editar Ficha"
                          >
                            <span className="material-symbols-outlined text-[16px]">edit</span>
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
      )}

      {/* Pagination Navigation Bar */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#111827]/80 border border-[#1e293b] rounded-xl p-3.5">
          <span className="text-xs text-[#94a3b8]">
            Mostrando página <strong className="text-white">{currentPage}</strong> de{' '}
            <strong className="text-white">{totalPages}</strong> ({filteredCustomers.length} clientes en total)
          </span>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-lg bg-[#0b1329] border border-[#1e293b] text-xs font-semibold text-[#cbd5e1] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#1e293b] transition-colors cursor-pointer flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[16px]">chevron_left</span>
              <span>Anterior</span>
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
              <button
                key={pageNum}
                onClick={() => setCurrentPage(pageNum)}
                className={`w-8 h-8 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  currentPage === pageNum
                    ? 'bg-[#388bfd] text-[#0a1120] shadow-[0_0_10px_rgba(56,139,253,0.3)]'
                    : 'bg-[#0b1329] border border-[#1e293b] text-[#94a3b8] hover:text-white hover:bg-[#1e293b]'
                }`}
              >
                {pageNum}
              </button>
            ))}

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded-lg bg-[#0b1329] border border-[#1e293b] text-xs font-semibold text-[#cbd5e1] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#1e293b] transition-colors cursor-pointer flex items-center gap-1"
            >
              <span>Siguiente</span>
              <span className="material-symbols-outlined text-[16px]">chevron_right</span>
            </button>
          </div>
        </div>
      )}

      {/* ========================================================== */}
      {/* 2-STEP CUSTOMER WIZARD MODAL (PERFIL & CONTACTO/ENVÍO)    */}
      {/* ========================================================== */}
      {isWizardOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="bg-[#111827] border-b border-[#1e293b] p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#388bfd]/15 border border-[#388bfd]/40 flex items-center justify-center text-[#58a6ff]">
                  <span className="material-symbols-outlined text-[22px]">
                    {wizardMode === 'create' ? 'person_add' : 'manage_accounts'}
                  </span>
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">
                    {wizardMode === 'create' ? 'Registrar Nuevo Cliente' : 'Ficha de Cliente'}
                  </h3>
                  <p className="text-xs text-[#94a3b8]">
                    Asistente en 2 pasos para perfil, comunicación y direcciones de flete.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsWizardOpen(false)}
                className="text-[#94a3b8] hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* 2-Step Progress Indicator Tabs */}
            <div className="grid grid-cols-2 border-b border-[#1e293b] bg-[#0b1329]">
              <button
                type="button"
                onClick={() => setWizardStep(1)}
                className={`py-3 px-4 text-xs font-bold flex items-center justify-center gap-2 border-b-2 transition-all cursor-pointer ${
                  wizardStep === 1
                    ? 'border-[#388bfd] text-[#58a6ff] bg-[#111827]'
                    : 'border-transparent text-[#64748b] hover:text-[#94a3b8]'
                }`}
              >
                <span className="w-5 h-5 rounded-full bg-[#388bfd]/20 text-[#58a6ff] text-[11px] flex items-center justify-center font-mono">
                  1
                </span>
                <span>1. PERFIL & IDENTIDAD</span>
              </button>

              <button
                type="button"
                onClick={handleNextStep}
                className={`py-3 px-4 text-xs font-bold flex items-center justify-center gap-2 border-b-2 transition-all cursor-pointer ${
                  wizardStep === 2
                    ? 'border-[#388bfd] text-[#58a6ff] bg-[#111827]'
                    : 'border-transparent text-[#64748b] hover:text-[#94a3b8]'
                }`}
              >
                <span className="w-5 h-5 rounded-full bg-[#10b981]/20 text-[#34d399] text-[11px] flex items-center justify-center font-mono">
                  2
                </span>
                <span>2. CONTACTO & ENVÍO</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto flex-1 custom-scrollbar space-y-4">
              {wizardStep === 1 ? (
                /* STEP 1: PERFIL */
                <div className="space-y-4">
                  {/* Dynamic Avatar and ID Banner */}
                  <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-[#388bfd] to-[#1e293b] border-2 border-[#58a6ff]/50 flex items-center justify-center text-white font-black text-xl shadow-lg shrink-0">
                      {`${editingCustomer.first_name?.[0] || 'C'}${
                        editingCustomer.last_name?.[0] || editingCustomer.first_name?.[1] || 'L'
                      }`.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-[#58a6ff] bg-[#0b1329] border border-[#388bfd]/30 px-2 py-0.5 rounded">
                          ID: #{editingCustomer.id || 'NUEVO'}
                        </span>
                        <span className="text-[11px] text-[#94a3b8]">CRM RADAR</span>
                      </div>
                      <p className="text-xs text-[#cbd5e1] mt-1">
                        Ingrese los datos comerciales y clasifique el tipo de cliente.
                      </p>
                    </div>
                  </div>

                  {/* Name Fields */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-bold text-[#cbd5e1] mb-1">
                        Nombre de Pila o Razón Social <span className="text-[#ef4444]">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="Ej. Juan o Simon Auto Sales"
                        value={editingCustomer.first_name || ''}
                        onChange={(e) => {
                          setEditingCustomer({ ...editingCustomer, first_name: e.target.value });
                          if (formErrors.first_name) setFormErrors({});
                        }}
                        className={`w-full bg-[#0b1329] border rounded-xl py-2.5 px-3 text-xs text-white placeholder:text-[#64748b] focus:outline-none ${
                          formErrors.first_name
                            ? 'border-[#ef4444] focus:border-[#ef4444]'
                            : 'border-[#1e293b] focus:border-[#388bfd]'
                        }`}
                      />
                      {formErrors.first_name && (
                        <span className="text-[11px] text-[#ef4444] mt-1 block">
                          {formErrors.first_name}
                        </span>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-[#cbd5e1] mb-1">
                        Apellido / Sufijo (Opcional)
                      </label>
                      <input
                        type="text"
                        placeholder="Ej. Pérez o LLC"
                        value={editingCustomer.last_name || ''}
                        onChange={(e) =>
                          setEditingCustomer({ ...editingCustomer, last_name: e.target.value })
                        }
                        className="w-full bg-[#0b1329] border border-[#1e293b] rounded-xl py-2.5 px-3 text-xs text-white placeholder:text-[#64748b] focus:outline-none focus:border-[#388bfd]"
                      />
                    </div>
                  </div>

                  {/* Company & Client Type */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-bold text-[#cbd5e1] mb-1">
                        Taller Mecánico / Empresa Aliada
                      </label>
                      <input
                        type="text"
                        placeholder="Ej. Taller El Patrón o RSA Logistics"
                        value={editingCustomer.company || ''}
                        onChange={(e) =>
                          setEditingCustomer({ ...editingCustomer, company: e.target.value })
                        }
                        className="w-full bg-[#0b1329] border border-[#1e293b] rounded-xl py-2.5 px-3 text-xs text-white placeholder:text-[#64748b] focus:outline-none focus:border-[#388bfd]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-[#cbd5e1] mb-1">
                        Tipo de Cliente
                      </label>
                      <select
                        value={editingCustomer.type || 'Taller Mecánico'}
                        onChange={(e) =>
                          setEditingCustomer({
                            ...editingCustomer,
                            type: e.target.value as any,
                          })
                        }
                        className="w-full bg-[#0b1329] border border-[#1e293b] rounded-xl py-2.5 px-3 text-xs text-white focus:outline-none focus:border-[#388bfd]"
                      >
                        <option value="Taller Mecánico">Taller Mecánico</option>
                        <option value="VIP">Cliente VIP</option>
                        <option value="Empresa">Empresa</option>
                        <option value="Flota Mantenimiento">Flota Mantenimiento</option>
                        <option value="Particular">Particular</option>
                      </select>
                    </div>
                  </div>

                  {/* Internal Notes */}
                  <div>
                    <label className="block text-xs font-bold text-[#cbd5e1] mb-1 flex items-center justify-between">
                      <span>Notas Internas del Equipo</span>
                      <span className="text-[10px] text-[#64748b] font-normal">Privado</span>
                    </label>
                    <textarea
                      rows={3}
                      placeholder="Ej. 'Taller mecánico con descuento recurrente del 5%', 'Llamar preferentemente por las mañanas', 'Requiere fotos de garantía antes de despachar'..."
                      value={editingCustomer.notes || ''}
                      onChange={(e) =>
                        setEditingCustomer({ ...editingCustomer, notes: e.target.value })
                      }
                      className="w-full bg-[#0b1329] border border-[#1e293b] rounded-xl p-3 text-xs text-white placeholder:text-[#64748b] focus:outline-none focus:border-[#388bfd] custom-scrollbar"
                    />
                  </div>
                </div>
              ) : (
                /* STEP 2: CONTACTO & ENVÍO */
                <div className="space-y-4">
                  {/* Phone & WhatsApp */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-bold text-[#cbd5e1] mb-1">
                        Teléfono Principal (Llamadas) <span className="text-[#ef4444]">*</span>
                      </label>
                      <div className="relative">
                        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#58a6ff] text-[18px]">
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
                          className={`w-full bg-[#0b1329] border rounded-xl py-2.5 pl-9 pr-3 text-xs text-white placeholder:text-[#64748b] focus:outline-none font-mono ${
                            formErrors.phone
                              ? 'border-[#ef4444] focus:border-[#ef4444]'
                              : 'border-[#1e293b] focus:border-[#388bfd]'
                          }`}
                        />
                      </div>
                      {formErrors.phone && (
                        <span className="text-[11px] text-[#ef4444] mt-1 block">
                          {formErrors.phone}
                        </span>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-[#cbd5e1] mb-1">
                        Número de WhatsApp (Cotizaciones & Fotos)
                      </label>
                      <div className="relative">
                        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#10b981] text-[18px]">
                          chat
                        </span>
                        <input
                          type="text"
                          placeholder="Ej. 19195550192 o +1 (919)..."
                          value={editingCustomer.whatsapp || ''}
                          onChange={(e) =>
                            setEditingCustomer({ ...editingCustomer, whatsapp: e.target.value })
                          }
                          className="w-full bg-[#0b1329] border border-[#1e293b] rounded-xl py-2.5 pl-9 pr-3 text-xs text-white placeholder:text-[#64748b] focus:outline-none focus:border-[#388bfd] font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Email & Zip Code */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-bold text-[#cbd5e1] mb-1">
                        Correo Electrónico (Facturas & Recibos)
                      </label>
                      <div className="relative">
                        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8] text-[18px]">
                          mail
                        </span>
                        <input
                          type="email"
                          placeholder="cliente@ejemplo.com"
                          value={editingCustomer.email || ''}
                          onChange={(e) =>
                            setEditingCustomer({ ...editingCustomer, email: e.target.value })
                          }
                          className="w-full bg-[#0b1329] border border-[#1e293b] rounded-xl py-2.5 pl-9 pr-3 text-xs text-white placeholder:text-[#64748b] focus:outline-none focus:border-[#388bfd]"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-[#cbd5e1] mb-1">
                        Código Postal (ZIP) <span className="text-[10px] text-[#58a6ff] font-normal">Fletes Car-Part</span>
                      </label>
                      <div className="relative">
                        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8] text-[18px]">
                          pin_drop
                        </span>
                        <input
                          type="text"
                          placeholder="Ej. 27520 o 27604"
                          value={editingCustomer.zip_code || ''}
                          onChange={(e) =>
                            setEditingCustomer({ ...editingCustomer, zip_code: e.target.value })
                          }
                          className="w-full bg-[#0b1329] border border-[#1e293b] rounded-xl py-2.5 pl-9 pr-3 text-xs text-white placeholder:text-[#64748b] focus:outline-none focus:border-[#388bfd] font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Shipping Address */}
                  <div>
                    <label className="block text-xs font-bold text-[#cbd5e1] mb-1">
                      Dirección Física de Entrega / Taller Mecánico
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Calle, Número, Edificio / Taller, Ciudad, Estado (Ej. 1420 US Hwy 70 W, Clayton, NC 27520)"
                      value={editingCustomer.address_shipping || ''}
                      onChange={(e) =>
                        setEditingCustomer({
                          ...editingCustomer,
                          address_shipping: e.target.value,
                        })
                      }
                      className="w-full bg-[#0b1329] border border-[#1e293b] rounded-xl p-3 text-xs text-white placeholder:text-[#64748b] focus:outline-none focus:border-[#388bfd]"
                    />
                  </div>

                  {/* Summary Callout */}
                  <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-3 text-xs text-[#94a3b8] flex items-center justify-between">
                    <span>
                      Cliente: <strong className="text-white">{editingCustomer.first_name || 'Sin nombre'} {editingCustomer.last_name || ''}</strong>
                    </span>
                    <span className="text-[#34d399] font-bold">
                      {editingCustomer.type || 'Particular'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer Controls */}
            <div className="bg-[#111827] border-t border-[#1e293b] p-4 flex items-center justify-between">
              {wizardStep === 1 ? (
                <div>
                  <button
                    type="button"
                    onClick={() => setIsWizardOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-[#94a3b8] hover:text-white transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setWizardStep(1)}
                  className="px-4 py-2 rounded-xl bg-[#1e293b] hover:bg-[#334155] text-xs font-bold text-[#cbd5e1] hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                  <span>Anterior: Perfil</span>
                </button>
              )}

              <div className="flex items-center gap-2">
                {wizardStep === 1 ? (
                  <button
                    type="button"
                    onClick={handleNextStep}
                    className="px-5 py-2.5 rounded-xl bg-[#388bfd] hover:bg-[#2563eb] text-[#0a1120] hover:text-white text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shadow-[0_0_12px_rgba(56,139,253,0.3)]"
                  >
                    <span>Siguiente: Contacto y Envío</span>
                    <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSaveCustomer}
                    className="px-5 py-2.5 rounded-xl bg-[#10b981] hover:bg-[#059669] text-[#042f2e] hover:text-white text-xs font-black flex items-center gap-2 transition-all cursor-pointer shadow-[0_0_15px_rgba(16,185,129,0.35)]"
                  >
                    <span className="material-symbols-outlined text-[18px]">save</span>
                    <span>Guardar Cliente</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================== */}
      {/* SOFT DELETE CONFIRMATION MODAL (ADMIN ONLY)               */}
      {/* ========================================================== */}
      {customerToDelete && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-[#ef4444]/40 rounded-2xl p-6 max-w-md w-full shadow-2xl flex flex-col gap-4">
            <div className="flex items-center gap-3 text-[#ef4444]">
              <div className="w-10 h-10 rounded-xl bg-[#ef4444]/15 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[24px]">warning</span>
              </div>
              <div>
                <h3 className="font-bold text-base text-white">¿Eliminar este cliente?</h3>
                <span className="text-[11px] text-[#fca5a5]">Borrado Lógico Protegido (Soft Delete)</span>
              </div>
            </div>

            <p className="text-xs text-[#cbd5e1] leading-relaxed">
              El cliente <strong className="text-white">"{customerToDelete.name}"</strong> será marcado
              como inactivo en el directorio. Las órdenes pasadas y registros contables históricos{' '}
              <strong className="text-[#34d399]">permanecerán intactos</strong> para auditoría.
            </p>

            <div className="bg-[#0b1329] p-3 rounded-xl border border-[#1e293b] text-[11px] text-[#94a3b8]">
              📍 Teléfono: <strong className="text-white">{customerToDelete.phone}</strong> · ID:{' '}
              {customerToDelete.id}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setCustomerToDelete(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[#94a3b8] hover:text-white transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmSoftDelete}
                className="px-4 py-2 rounded-xl bg-[#ef4444] hover:bg-[#dc2626] text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-[0_0_12px_rgba(239,68,68,0.3)]"
              >
                <span className="material-symbols-outlined text-[16px]">delete_forever</span>
                <span>Confirmar Soft Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================== */}
      {/* CUSTOMER ORDERS DRAWER / MODAL                            */}
      {/* ========================================================== */}
      {viewingOrdersCustomer && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-[#1e293b] rounded-2xl w-full max-w-xl max-h-[85vh] shadow-2xl flex flex-col overflow-hidden">
            <div className="bg-[#111827] border-b border-[#1e293b] p-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#388bfd]/20 text-[#58a6ff] flex items-center justify-center font-bold">
                  {viewingOrdersCustomer.initials}
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">
                    Historial de Órdenes: {viewingOrdersCustomer.name}
                  </h3>
                  <span className="text-[10px] text-[#94a3b8]">{viewingOrdersCustomer.company || viewingOrdersCustomer.type}</span>
                </div>
              </div>
              <button
                onClick={() => setViewingOrdersCustomer(null)}
                className="text-[#94a3b8] hover:text-white p-1"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-2.5 custom-scrollbar">
              {(() => {
                const custOrders = orders.filter((o) => {
                  if (o.customer?.id === viewingOrdersCustomer.id) return true;
                  if (o.customer?.name && viewingOrdersCustomer.name && o.customer.name.toLowerCase() === viewingOrdersCustomer.name.toLowerCase()) return true;
                  return false;
                });

                if (custOrders.length === 0) {
                  return (
                    <div className="text-center py-8 text-xs text-[#94a3b8]">
                      No hay órdenes registradas para este cliente todavía.
                    </div>
                  );
                }

                return custOrders.map((ord) => (
                  <div
                    key={ord.id}
                    className="bg-[#111827] border border-[#1e293b] hover:border-[#388bfd]/50 rounded-xl p-3 flex items-center justify-between gap-3 transition-colors cursor-pointer"
                    onClick={() => {
                      setViewingOrdersCustomer(null);
                      onSelectOrder(ord.id);
                    }}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs text-[#58a6ff]">{ord.code}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#1e293b] text-[#94a3b8]">
                          {ord.status}
                        </span>
                      </div>
                      <p className="text-xs text-white font-medium mt-0.5">
                        {ord.vehicle.year} {ord.vehicle.make} {ord.vehicle.model} · {ord.mainPart}
                      </p>
                      <span className="text-[10px] text-[#64748b]">{ord.createdAt}</span>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="font-mono font-bold text-xs text-[#10b981] block">
                        ${(ord.financials?.total || ord.financials?.partPrice || 0).toFixed(2)} USD
                      </span>
                      <span className="text-[10px] text-[#388bfd] flex items-center justify-end gap-0.5 mt-0.5">
                        <span>Ver Orden</span>
                        <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                      </span>
                    </div>
                  </div>
                ));
              })()}
            </div>

            <div className="bg-[#111827] border-t border-[#1e293b] p-3 text-right">
              <button
                onClick={() => setViewingOrdersCustomer(null)}
                className="px-4 py-1.5 rounded-xl bg-[#1e293b] hover:bg-[#334155] text-xs font-semibold text-white cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
