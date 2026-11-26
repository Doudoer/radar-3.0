import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from '../services/apiFetch';
import { RegisterCallModal } from './RegisterCallModal';

export interface CustomerSummaryItem {
  customerId: number;
  customerName: string;
  phone: string;
  whatsapp?: string | null;
  company?: string | null;
  totalOrders: number;
  activeOrders: number;
  isUnregistered?: boolean;
  lastInteractionAt: string | null;
  lastInteractionType: 'call' | 'message' | 'note' | null;
  lastInteractionSummary: string | null;
  lastInteractionAuthor: string | null;
}

export interface TimelineEventItem {
  id: string;
  type: 'call_pbx' | 'call_manual' | 'message_outbox' | 'employee_note';
  timestamp: string;
  authorOrAttendedBy: string;
  title: string;
  summary: string;
  status?: string;
  audioUrl?: string | null;
  durationSeconds?: number;
  qaScore?: number | null;
  qaSummary?: string | null;
  transcript?: string | null;
  orderCode?: string | null;
  orderId?: string | null;
  noteType?: string;
}

interface CustomerConversationsPanelProps {
  onSelectOrder?: (orderId: string) => void;
  initialCustomerId?: number | null;
}

const getNowLocalString = (): string => {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
};

const formatRelativeTime = (isoString?: string | null): string => {
  if (!isoString) return '';
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSec < 60) return 'Hace un momento';
    if (diffMin < 60) return `Hace ${diffMin} min`;
    if (diffHours < 24) return `Hace ${diffHours} h`;
    if (diffDays === 1) return 'Ayer';
    if (diffDays < 7) return `Hace ${diffDays} días`;
    return new Date(isoString).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  } catch {
    return '';
  }
};

const formatFullDate = (isoString: string): string => {
  try {
    return new Date(isoString).toLocaleString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
};

interface ParsedCallSummary {
  direction: 'inbound' | 'outbound' | null;
  customerSaid: string;
  agentSaid: string;
  agreement: string;
}

const parseCallSummary = (text: string): ParsedCallSummary | null => {
  if (!text) return null;
  const hasCustomer = text.includes('🗣️ CLIENTE DIJO:');
  const hasAgent = text.includes('👤 OPERADOR RESPONDIÓ:');
  if (!hasCustomer && !hasAgent) return null;

  let direction: 'inbound' | 'outbound' | null = null;
  if (text.includes('[LLAMADA ENTRANTE]') || text.includes('Llamada Entrante')) direction = 'inbound';
  else if (text.includes('[LLAMADA SALIENTE]') || text.includes('Llamada Saliente')) direction = 'outbound';

  let customerSaid = '';
  let agentSaid = '';
  let agreement = '';

  const custIdx = text.indexOf('🗣️ CLIENTE DIJO:\n');
  const agentIdx = text.indexOf('👤 OPERADOR RESPONDIÓ:\n');
  const agreeIdx = text.indexOf('🤝 ACUERDO / SIGUIENTE PASO:\n');

  if (custIdx !== -1) {
    const end = agentIdx !== -1 ? agentIdx : agreeIdx !== -1 ? agreeIdx : text.length;
    customerSaid = text.substring(custIdx + '🗣️ CLIENTE DIJO:\n'.length, end).trim();
  }
  if (agentIdx !== -1) {
    const end = agreeIdx !== -1 ? agreeIdx : text.length;
    agentSaid = text.substring(agentIdx + '👤 OPERADOR RESPONDIÓ:\n'.length, end).trim();
  }
  if (agreeIdx !== -1) {
    agreement = text.substring(agreeIdx + '🤝 ACUERDO / SIGUIENTE PASO:\n'.length).trim();
  }

  return { direction, customerSaid, agentSaid, agreement };
};

export const CustomerConversationsPanel: React.FC<CustomerConversationsPanelProps> = ({
  onSelectOrder,
  initialCustomerId,
}) => {
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<CustomerSummaryItem[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(initialCustomerId || null);
  const [selectedCustomerPhone, setSelectedCustomerPhone] = useState<string>('');
  const [customerListTab, setCustomerListTab] = useState<'all' | 'unregistered'>('all');

  // Modal para agregar número desconocido a contactos
  const [saveContactModalOpen, setSaveContactModalOpen] = useState(false);
  const [contactPhoneToSave, setContactPhoneToSave] = useState('');
  const [contactFirstName, setContactFirstName] = useState('');
  const [contactLastName, setContactLastName] = useState('');
  const [contactCompany, setContactCompany] = useState('');
  const [savingContact, setSavingContact] = useState(false);
  const [saveContactError, setSaveContactError] = useState<string | null>(null);

  // Selected Customer Timeline State
  const [timelineCustomer, setTimelineCustomer] = useState<any | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEventItem[]>([]);
  const [timelineOrders, setTimelineOrders] = useState<any[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'call_summaries' | 'pbx' | 'notes'>('all');

  // Mode: Structured Call Summary vs Quick Note
  const [entryMode, setEntryMode] = useState<'call_summary' | 'quick_note'>('call_summary');

  // Structured Call Summary State
  const [callDirection, setCallDirection] = useState<'inbound' | 'outbound'>('inbound');
  const [callDate, setCallDate] = useState<string>(getNowLocalString());
  const [whatCustomerSaid, setWhatCustomerSaid] = useState('');
  const [whatAgentSaid, setWhatAgentSaid] = useState('');
  const [agreement, setAgreement] = useState('');
  const [callOrderId, setCallOrderId] = useState<string>('');

  // Quick Note State
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newNoteType, setNewNoteType] = useState<'nota' | 'acuerdo'>('nota');
  const [newNoteOrderId, setNewNoteOrderId] = useState<string>('');

  const [savingNote, setSavingNote] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedTranscripts, setExpandedTranscripts] = useState<Record<string, boolean>>({});
  const [registerModalOpen, setRegisterModalOpen] = useState(false);

  // 1. Cargar lista de clientes con conversaciones
  const loadCustomers = useCallback(async (q: string = '') => {
    setLoadingCustomers(true);
    try {
      const res = await apiFetch(`/communications/customers?q=${encodeURIComponent(q)}&limit=60`);
      if (res.ok) {
        const data = await res.json();
        const list: CustomerSummaryItem[] = Array.isArray(data.customers) ? data.customers : [];
        setCustomers(list);
        if (!selectedCustomerId && list.length > 0 && !initialCustomerId) {
          setSelectedCustomerId(list[0].customerId);
          setSelectedCustomerPhone(list[0].phone || '');
        }
      }
    } catch {
      // Ignorar errores transitorios
    } finally {
      setLoadingCustomers(false);
    }
  }, [selectedCustomerId, initialCustomerId]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadCustomers(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, loadCustomers]);

  // 2. Cargar Timeline del cliente seleccionado
  const loadTimeline = useCallback(async (cId: number, phoneStr?: string) => {
    setLoadingTimeline(true);
    try {
      const phoneParam = phoneStr || selectedCustomerPhone;
      const url = phoneParam
        ? `/communications/customers/${cId}/timeline?phone=${encodeURIComponent(phoneParam)}`
        : `/communications/customers/${cId}/timeline`;
      const res = await apiFetch(url);
      if (res.ok) {
        const data = await res.json();
        setTimelineCustomer(data.customer || null);
        setTimelineEvents(Array.isArray(data.events) ? data.events : []);
        setTimelineOrders(Array.isArray(data.orders) ? data.orders : []);
      }
    } catch {
      // Fallo de carga
    } finally {
      setLoadingTimeline(false);
    }
  }, [selectedCustomerPhone]);

  useEffect(() => {
    if (selectedCustomerId) {
      void loadTimeline(selectedCustomerId);
    }
  }, [selectedCustomerId, loadTimeline]);

  const openSaveContactModal = (phone: string, defaultName: string = '') => {
    setContactPhoneToSave(phone);
    setContactFirstName(defaultName && defaultName !== 'Número no registrado' ? defaultName : '');
    setContactLastName('');
    setContactCompany('');
    setSaveContactError(null);
    setSaveContactModalOpen(true);
  };

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactFirstName.trim() || !contactPhoneToSave.trim() || savingContact) return;
    setSavingContact(true);
    setSaveContactError(null);

    try {
      const res = await apiFetch('/communications/contacts/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: contactFirstName.trim(),
          lastName: contactLastName.trim() || null,
          phone: contactPhoneToSave.trim(),
          company: contactCompany.trim() || null,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setSaveContactModalOpen(false);
        setSelectedCustomerId(data.customerId);
        setSelectedCustomerPhone(contactPhoneToSave);
        await loadCustomers(search);
        void loadTimeline(data.customerId, contactPhoneToSave);
      } else {
        const err = await res.json().catch(() => ({}));
        setSaveContactError(err.message || 'No fue posible guardar el contacto.');
      }
    } catch {
      setSaveContactError('Error al guardar el contacto.');
    } finally {
      setSavingContact(false);
    }
  };

  // 3. Guardar resumen de llamada estructurado o nota rápida
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerId || savingNote) return;
    setErrorMessage(null);

    if (entryMode === 'call_summary') {
      if (!whatCustomerSaid.trim() && !whatAgentSaid.trim()) {
        setErrorMessage('Por favor escribe lo que dijo el cliente o lo que se le respondió.');
        return;
      }

      setSavingNote(true);
      try {
        const res = await apiFetch(`/communications/customers/${selectedCustomerId}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            noteType: 'call_summary',
            callDirection,
            callDate: callDate ? new Date(callDate).toISOString() : new Date().toISOString(),
            whatCustomerSaid: whatCustomerSaid.trim(),
            whatAgentSaid: whatAgentSaid.trim(),
            agreement: agreement.trim(),
            orderId: callOrderId ? Number(callOrderId) : null,
          }),
        });

        if (res.ok) {
          setWhatCustomerSaid('');
          setWhatAgentSaid('');
          setAgreement('');
          setCallOrderId('');
          setCallDate(getNowLocalString());
          await loadTimeline(selectedCustomerId);
          void loadCustomers(search);
        } else {
          const err = await res.json().catch(() => ({}));
          setErrorMessage(err.error || 'No fue posible registrar el resumen de llamada.');
        }
      } catch {
        setErrorMessage('Error de conexión al guardar el resumen.');
      } finally {
        setSavingNote(false);
      }
    } else {
      if (!newNoteContent.trim()) {
        setErrorMessage('El contenido de la nota no puede estar vacío.');
        return;
      }

      setSavingNote(true);
      try {
        const res = await apiFetch(`/communications/customers/${selectedCustomerId}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: newNoteContent.trim(),
            noteType: newNoteType,
            orderId: newNoteOrderId ? Number(newNoteOrderId) : null,
          }),
        });

        if (res.ok) {
          setNewNoteContent('');
          setNewNoteOrderId('');
          await loadTimeline(selectedCustomerId);
          void loadCustomers(search);
        } else {
          const err = await res.json().catch(() => ({}));
          setErrorMessage(err.error || 'No fue posible registrar la nota.');
        }
      } catch {
        setErrorMessage('Error de conexión al guardar la nota.');
      } finally {
        setSavingNote(false);
      }
    }
  };

  const filteredEvents = useMemo(() => {
    if (filterType === 'all') return timelineEvents;
    if (filterType === 'call_summaries') {
      return timelineEvents.filter((ev) => ev.noteType === 'call_summary' || ev.summary?.includes('🗣️ CLIENTE DIJO:'));
    }
    if (filterType === 'pbx') {
      return timelineEvents.filter((ev) => ev.type === 'call_pbx' || ev.type === 'call_manual');
    }
    if (filterType === 'notes') {
      return timelineEvents.filter(
        (ev) => ev.type === 'employee_note' && ev.noteType !== 'call_summary' && !ev.summary?.includes('🗣️ CLIENTE DIJO:')
      );
    }
    return timelineEvents;
  }, [timelineEvents, filterType]);

  const unregisteredCount = useMemo(() => customers.filter((c) => c.isUnregistered).length, [customers]);
  const displayedCustomers = useMemo(() => {
    if (customerListTab === 'unregistered') return customers.filter((c) => c.isUnregistered);
    return customers;
  }, [customers, customerListTab]);

  const toggleTranscript = (id: string) => {
    setExpandedTranscripts((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[calc(100vh-190px)] min-h-[580px]">
      {/* ============================================================== */}
      {/* COLUMNA IZQUIERDA: LISTA Y BUSCADOR DE CLIENTES                */}
      {/* ============================================================== */}
      <div className="lg:col-span-4 flex flex-col rounded-2xl bg-[var(--bg-card)] border border-cyan-500/20 overflow-hidden shadow-lg">
        {/* Header buscador */}
        <div className="p-3.5 border-b border-cyan-500/20 bg-slate-900/60 backdrop-blur-md space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span aria-hidden="true" className="material-symbols-outlined text-cyan-400 text-[20px]">forum</span>
              <h2 className="text-sm font-black font-mono tracking-tight text-white uppercase truncate">Clientes & Conversaciones</h2>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10.5px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                {customers.length}
              </span>
              <button
                type="button"
                onClick={() => setRegisterModalOpen(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-[11px] font-mono font-black shadow-[0_0_10px_rgba(6,182,212,0.3)] transition active:scale-95 cursor-pointer"
                title="Registrar resumen de conversación con cliente"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[14px]">add_call</span>
                <span>Registrar</span>
              </button>
            </div>
          </div>

          <div className="relative">
            <span aria-hidden="true" className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">search</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por cliente, teléfono u orden..."
              className="w-full bg-[#030712] border border-cyan-500/30 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-cyan-400 font-sans"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[15px]">close</span>
              </button>
            )}
          </div>

          {/* Subtabs para filtrar clientes y llamadas no registradas */}
          <div className="flex items-center gap-1.5 text-xs font-mono pt-0.5">
            <button
              type="button"
              onClick={() => setCustomerListTab('all')}
              className={`px-2.5 py-1 rounded-lg text-[10.5px] font-bold transition cursor-pointer ${
                customerListTab === 'all'
                  ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400'
                  : 'text-slate-400 hover:text-white border border-transparent'
              }`}
            >
              Todos ({customers.length})
            </button>
            <button
              type="button"
              onClick={() => setCustomerListTab('unregistered')}
              className={`px-2.5 py-1 rounded-lg text-[10.5px] font-bold transition cursor-pointer flex items-center gap-1.5 ${
                customerListTab === 'unregistered'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-400'
                  : 'text-slate-400 hover:text-amber-300 border border-transparent'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
              <span>No registrados ({unregisteredCount})</span>
            </button>
          </div>
        </div>

        {/* Lista de clientes */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60 custom-scrollbar">
          {loadingCustomers && customers.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
              <span aria-hidden="true" className="material-symbols-outlined text-cyan-400 text-2xl animate-spin">sync</span>
              <span>Buscando clientes y llamadas…</span>
            </div>
          ) : displayedCustomers.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 space-y-1">
              <span aria-hidden="true" className="material-symbols-outlined text-3xl text-slate-500 mb-1">person_search</span>
              <p className="font-bold text-slate-300">
                {customerListTab === 'unregistered' ? 'No hay llamadas no registradas' : 'No se encontraron clientes'}
              </p>
              <p className="text-[11px] text-slate-400">
                {customerListTab === 'unregistered'
                  ? 'Todos los números de llamadas entrantes están guardados en contactos'
                  : 'Prueba buscando por nombre, teléfono o # de orden'}
              </p>
            </div>
          ) : (
            displayedCustomers.map((c) => {
              const isSelected = c.customerId === selectedCustomerId;
              const isUnreg = Boolean(c.isUnregistered);

              return (
                <button
                  key={`${c.customerId}-${c.phone}`}
                  type="button"
                  onClick={() => {
                    setSelectedCustomerId(c.customerId);
                    setSelectedCustomerPhone(c.phone);
                    void loadTimeline(c.customerId, c.phone);
                  }}
                  className={`w-full text-left p-3.5 transition-all flex items-start gap-3 cursor-pointer ${
                    isSelected
                      ? isUnreg
                        ? 'bg-amber-500/15 border-l-4 border-amber-400 shadow-inner'
                        : 'bg-cyan-500/15 border-l-4 border-cyan-400 shadow-inner'
                      : 'hover:bg-slate-800/40 border-l-4 border-transparent'
                  }`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold font-mono text-xs shrink-0 ${
                    isSelected
                      ? isUnreg
                        ? 'bg-amber-500 text-slate-950 shadow-[0_0_12px_rgba(245,158,11,0.5)]'
                        : 'bg-cyan-500 text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.5)]'
                      : isUnreg
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        : 'bg-slate-800 text-cyan-300 border border-cyan-500/30'
                  }`}>
                    {isUnreg ? (
                      <span aria-hidden="true" className="material-symbols-outlined text-[18px]">contact_phone</span>
                    ) : (
                      c.customerName.slice(0, 2).toUpperCase()
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <strong className={`text-xs truncate ${
                          isSelected
                            ? isUnreg ? 'text-amber-200 font-black' : 'text-cyan-200 font-black'
                            : 'text-slate-200'
                        }`}>
                          {isUnreg && c.customerName === 'Número no registrado' ? c.phone : c.customerName}
                        </strong>
                        {isUnreg && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                            No registrado
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {isUnreg && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openSaveContactModal(c.phone, c.customerName !== 'Número no registrado' ? c.customerName : '');
                            }}
                            className="px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-slate-950 border border-amber-500/40 transition cursor-pointer"
                            title="Agregar a contactos"
                          >
                            + Contacto
                          </button>
                        )}
                        {c.lastInteractionAt && (
                          <span className="text-[10px] text-slate-400 font-mono">
                            {formatRelativeTime(c.lastInteractionAt)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                      <span>{c.phone || 'Sin teléfono'}</span>
                      {c.activeOrders > 0 && (
                        <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          {c.activeOrders} activa{c.activeOrders > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>

                    {c.lastInteractionSummary && (
                      <p className="text-[11px] text-slate-400 truncate mt-1 flex items-center gap-1">
                        <span aria-hidden="true" className="material-symbols-outlined text-[13px] text-cyan-400 shrink-0">
                          {c.lastInteractionType === 'call' ? 'call' : 'edit_note'}
                        </span>
                        <span className="truncate">{c.lastInteractionSummary}</span>
                      </p>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ============================================================== */}
      {/* COLUMNA DERECHA: EXPEDIENTE Y TIMELINE DE CONVERSACIONES        */}
      {/* ============================================================== */}
      <div className="lg:col-span-8 flex flex-col rounded-2xl bg-[var(--bg-card)] border border-cyan-500/20 overflow-hidden shadow-xl">
        {!selectedCustomerId || !timelineCustomer ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400 space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <span aria-hidden="true" className="material-symbols-outlined text-3xl">question_answer</span>
            </div>
            <div className="max-w-sm space-y-1">
              <h3 className="text-base font-bold text-slate-200">Selecciona un cliente o llamada</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Elige cualquier cliente de la lista o llamada no registrada para consultar su historial de llamadas PBX, resúmenes de llamadas, notas y órdenes activas.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRegisterModalOpen(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-mono font-black shadow-[0_0_15px_rgba(6,182,212,0.4)] transition active:scale-95 cursor-pointer"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">add_call</span>
              <span>+ Registrar Llamada / Conversación</span>
            </button>
          </div>
        ) : (
          <>
            {timelineCustomer.is_unregistered && (
              <div className="bg-gradient-to-r from-amber-500/20 to-orange-500/20 border-b border-amber-500/30 px-4 py-3 flex flex-wrap items-center justify-between gap-3 backdrop-blur-md">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center shrink-0">
                    <span aria-hidden="true" className="material-symbols-outlined text-[20px]">person_add</span>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-amber-200">
                      Número no registrado: <span className="font-mono font-black">{timelineCustomer.phone}</span>
                    </p>
                    <p className="text-[11px] text-amber-300/80">
                      Este número no está guardado en tus contactos. Puedes agregarlo ahora para registrar su nombre e historial permanentemente.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => openSaveContactModal(timelineCustomer.phone)}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 text-xs font-mono font-black flex items-center gap-1.5 shadow-[0_0_12px_rgba(245,158,11,0.3)] transition active:scale-95 cursor-pointer shrink-0"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">person_add</span>
                  <span>Agregar a Contactos</span>
                </button>
              </div>
            )}

            {/* Cabecera del Cliente Seleccionado */}
            <div className="p-4 border-b border-cyan-500/20 bg-slate-900/80 backdrop-blur-md flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black font-mono text-base shadow-md shrink-0 ${
                  timelineCustomer.is_unregistered
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-gradient-to-br from-cyan-500 to-blue-600 text-slate-950'
                }`}>
                  {timelineCustomer.is_unregistered ? (
                    <span aria-hidden="true" className="material-symbols-outlined text-[24px]">contact_phone</span>
                  ) : (
                    <>{timelineCustomer.first_name?.[0] || 'C'}{timelineCustomer.last_name?.[0] || ''}</>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-black text-white truncate">
                      {timelineCustomer.is_unregistered
                        ? timelineCustomer.phone
                        : `${timelineCustomer.first_name} ${timelineCustomer.last_name || ''}`}
                    </h2>
                    {timelineCustomer.is_unregistered ? (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        No registrado
                      </span>
                    ) : timelineCustomer.company ? (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                        {timelineCustomer.company}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono mt-0.5">
                    <span className="flex items-center gap-1 text-cyan-300 font-bold">
                      <span aria-hidden="true" className="material-symbols-outlined text-[14px]">call</span>
                      {timelineCustomer.phone || 'Sin número'}
                    </span>
                    {timelineCustomer.address_shipping && (
                      <>
                        <span>•</span>
                        <span className="truncate max-w-[200px]" title={timelineCustomer.address_shipping}>
                          {timelineCustomer.address_shipping}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Botones de acción directa */}
              <div className="flex items-center gap-2">
                {timelineCustomer.is_unregistered && (
                  <button
                    type="button"
                    onClick={() => openSaveContactModal(timelineCustomer.phone)}
                    className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 text-xs font-mono font-black flex items-center gap-1.5 shadow-[0_0_12px_rgba(245,158,11,0.3)] transition active:scale-95 cursor-pointer"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">person_add</span>
                    <span>Agregar a Contactos</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setRegisterModalOpen(true)}
                  className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-mono font-black flex items-center gap-1.5 shadow-[0_0_12px_rgba(6,182,212,0.3)] transition active:scale-95 cursor-pointer"
                  title="Registrar llamada o conversación con este cliente"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">add_call</span>
                  <span>Registrar Llamada</span>
                </button>

                {timelineCustomer.phone && (
                  <a
                    href={`tel:${timelineCustomer.phone}`}
                    className="px-3.5 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-mono font-bold flex items-center gap-1.5 transition"
                    title="Llamar al cliente"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">call</span>
                    <span>Llamar al cliente</span>
                  </a>
                )}
              </div>
            </div>

            {/* Órdenes del cliente en tarjetas horizontales compactas */}
            {timelineOrders.length > 0 && (
              <div className="px-4 py-2 bg-slate-950/40 border-b border-cyan-500/10 flex items-center gap-2 overflow-x-auto custom-scrollbar">
                <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider shrink-0 flex items-center gap-1">
                  <span aria-hidden="true" className="material-symbols-outlined text-[13px] text-cyan-400">inventory_2</span>
                  Órdenes ({timelineOrders.length}):
                </span>
                {timelineOrders.map((o) => (
                  <div
                    key={o.id}
                    className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[var(--bg-card-subtle)] border border-cyan-500/20 text-xs font-mono shrink-0 hover:border-cyan-400/50 transition cursor-pointer"
                    onClick={() => onSelectOrder?.(String(o.id))}
                    title="Ver detalle completo de esta orden"
                  >
                    <strong className="text-cyan-300 font-bold">#{o.order_code}</strong>
                    <span className="text-[11px] text-slate-300 truncate max-w-[130px]">
                      {o.year} {o.brand} {o.model}
                    </span>
                    <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-slate-800 text-slate-300 uppercase">
                      {o.status}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Filtros del Timeline */}
            <div className="px-4 py-2 border-b border-cyan-500/10 bg-slate-900/40 flex items-center justify-between gap-2 text-xs font-mono">
              <span className="text-[11px] text-slate-400">
                Historial de interacciones ({filteredEvents.length})
              </span>
              <div className="flex items-center gap-1">
                {(
                  [
                    { key: 'all', label: 'Todos' },
                    { key: 'call_summaries', label: '📞 Resúmenes de Llamada' },
                    { key: 'pbx', label: '🎙️ PBX' },
                    { key: 'notes', label: '📝 Notas & Acuerdos' },
                  ] as const
                ).map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilterType(key)}
                    className={`px-2.5 py-1 rounded-lg text-[10.5px] font-bold transition cursor-pointer ${
                      filterType === key
                        ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400'
                        : 'text-slate-400 hover:text-white border border-transparent'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Timeline Scrollable Events Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-slate-950/20">
              {loadingTimeline ? (
                <div className="py-12 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
                  <span aria-hidden="true" className="material-symbols-outlined text-cyan-400 text-2xl animate-spin">sync</span>
                  <span>Cargando expediente del cliente…</span>
                </div>
              ) : filteredEvents.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400 space-y-1">
                  <span aria-hidden="true" className="material-symbols-outlined text-3xl text-slate-600 mb-1">chat_bubble_outline</span>
                  <p className="font-bold text-slate-300">Sin interacciones registradas aún</p>
                  <p className="text-[11px] text-slate-400">Las llamadas PBX, resúmenes de llamadas internas y notas que escribas aparecerán aquí.</p>
                </div>
              ) : (
                filteredEvents.map((event) => {
                  const isPbx = event.type === 'call_pbx' || event.type === 'call_manual';
                  const parsedSummary = parseCallSummary(event.summary);
                  const isCallSummary = Boolean(parsedSummary) || event.noteType === 'call_summary';

                  return (
                    <div
                      key={event.id}
                      className={`p-3.5 rounded-2xl border transition-all space-y-2.5 ${
                        isCallSummary
                          ? 'bg-slate-900/80 border-cyan-500/35 hover:border-cyan-500/50 shadow-md'
                          : isPbx
                            ? 'bg-slate-900/50 border-cyan-500/20 hover:border-cyan-500/35'
                            : 'bg-amber-950/20 border-amber-500/25 hover:border-amber-500/40'
                      }`}
                    >
                      {/* Cabecera del evento */}
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                            isCallSummary
                              ? 'bg-cyan-500/20 text-cyan-300'
                              : isPbx
                                ? 'bg-indigo-500/20 text-indigo-300'
                                : 'bg-amber-500/20 text-amber-300'
                          }`}>
                            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
                              {isCallSummary ? 'record_voice_over' : isPbx ? 'call' : 'edit_note'}
                            </span>
                          </span>

                          <div>
                            <strong className="text-white text-xs">{event.title}</strong>
                            <span className="text-slate-400 text-[11px] ml-2">por {event.authorOrAttendedBy}</span>
                          </div>

                          {/* Badge de llamada entrante/saliente */}
                          {parsedSummary?.direction && (
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              parsedSummary.direction === 'inbound'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                            }`}>
                              {parsedSummary.direction === 'inbound' ? '📲 Entrante' : '📞 Saliente'}
                            </span>
                          )}

                          {/* Badge de orden vinculada si existe */}
                          {event.orderCode && (
                            <button
                              type="button"
                              onClick={() => event.orderId && onSelectOrder?.(event.orderId)}
                              className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 hover:border-cyan-400 cursor-pointer"
                              title="Ver orden asociada"
                            >
                              Orden #{event.orderCode}
                            </button>
                          )}
                        </div>

                        <span className="text-[10.5px] text-slate-400 font-mono">
                          {formatFullDate(event.timestamp)}
                        </span>
                      </div>

                      {/* Contenido / Cuerpo estructurado */}
                      {parsedSummary ? (
                        <div className="space-y-2 pl-9 pt-1">
                          {parsedSummary.customerSaid && (
                            <div className="rounded-xl p-2.5 bg-slate-800/80 border border-slate-700/70 space-y-1">
                              <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-amber-300">
                                <span className="text-sm">🗣️</span>
                                <span>¿Qué dijo el cliente?</span>
                              </div>
                              <p className="text-xs text-slate-100 whitespace-pre-wrap leading-relaxed pl-5 font-sans">
                                {parsedSummary.customerSaid}
                              </p>
                            </div>
                          )}

                          {parsedSummary.agentSaid && (
                            <div className="rounded-xl p-2.5 bg-cyan-950/40 border border-cyan-500/30 space-y-1">
                              <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-cyan-300">
                                <span className="text-sm">👤</span>
                                <span>¿Qué se le respondió / explicó al cliente?</span>
                              </div>
                              <p className="text-xs text-cyan-50 whitespace-pre-wrap leading-relaxed pl-5 font-sans">
                                {parsedSummary.agentSaid}
                              </p>
                            </div>
                          )}

                          {parsedSummary.agreement && (
                            <div className="rounded-xl p-2.5 bg-emerald-950/40 border border-emerald-500/30 space-y-1">
                              <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-emerald-300">
                                <span className="text-sm">🤝</span>
                                <span>Acuerdo / Próximo paso:</span>
                              </div>
                              <p className="text-xs text-emerald-100 whitespace-pre-wrap leading-relaxed pl-5 font-sans">
                                {parsedSummary.agreement}
                              </p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-200 leading-relaxed pl-9 whitespace-pre-wrap font-sans">
                          {event.summary}
                        </p>
                      )}

                      {/* Si es llamada PBX con audio disponible */}
                      {event.audioUrl && (
                        <div className="pl-9 pt-1">
                          <audio src={event.audioUrl} controls className="w-full max-w-md h-8 rounded-lg" preload="none" />
                        </div>
                      )}

                      {/* Si tiene análisis IA o transcripción */}
                      {(event.qaScore != null || event.transcript) && (
                        <div className="pl-9 pt-1 space-y-1.5">
                          <div className="flex items-center gap-2">
                            {event.qaScore != null && (
                              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                                event.qaScore >= 80 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                              }`}>
                                Calificación IA: {event.qaScore}/100
                              </span>
                            )}
                            {event.transcript && (
                              <button
                                type="button"
                                onClick={() => toggleTranscript(event.id)}
                                className="text-[10.5px] font-mono text-cyan-400 hover:text-cyan-200 underline cursor-pointer"
                              >
                                {expandedTranscripts[event.id] ? 'Ocultar transcripción' : 'Ver transcripción de llamada'}
                              </button>
                            )}
                          </div>
                          {expandedTranscripts[event.id] && event.transcript && (
                            <div className="p-2.5 rounded-xl bg-black/40 border border-cyan-500/20 text-[11px] font-mono text-slate-300 whitespace-pre-wrap max-h-40 overflow-y-auto custom-scrollbar">
                              {event.transcript}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* ============================================================== */}
            {/* CUADRO INFERIOR: REGISTRAR RESUMEN DE LLAMADA O NOTA            */}
            {/* ============================================================== */}
            <form onSubmit={handleSave} className="p-3.5 border-t border-cyan-500/20 bg-slate-900/95 backdrop-blur-md space-y-3">
              {/* Selector de modo y cabecera de formulario */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-500/10 pb-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEntryMode('call_summary')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-mono font-black transition flex items-center gap-1.5 cursor-pointer ${
                      entryMode === 'call_summary'
                        ? 'bg-cyan-500 text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.4)]'
                        : 'bg-slate-800 text-slate-300 hover:text-white'
                    }`}
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">call</span>
                    <span>Registrar Resumen de Llamada</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEntryMode('quick_note')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition flex items-center gap-1.5 cursor-pointer ${
                      entryMode === 'quick_note'
                        ? 'bg-cyan-500 text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.4)]'
                        : 'bg-slate-800 text-slate-300 hover:text-white'
                    }`}
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">edit_note</span>
                    <span>Nota Rápida / Acuerdo</span>
                  </button>
                </div>

                <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">
                  {entryMode === 'call_summary' ? 'Resumen visible para todos los operadores' : 'Bitácora interna'}
                </span>
              </div>

              {errorMessage && (
                <div className="px-3 py-1.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-mono flex items-center gap-2">
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">error</span>
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* MODO 1: RESUMEN DE LLAMADA ESTRUCTURADO */}
              {entryMode === 'call_summary' ? (
                <div className="space-y-2.5">
                  {/* Fila de metadatos: Dirección, Fecha/Hora, Orden vinculada */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-mono">
                    {/* Dirección */}
                    <div className="flex items-center gap-1 bg-slate-950/70 p-1.5 rounded-xl border border-cyan-500/20">
                      <span className="text-[11px] text-slate-400 pl-1 shrink-0">Tipo:</span>
                      <button
                        type="button"
                        onClick={() => setCallDirection('inbound')}
                        className={`flex-1 py-1 rounded-lg text-[10.5px] font-bold transition cursor-pointer text-center ${
                          callDirection === 'inbound'
                            ? 'bg-emerald-500 text-slate-950 shadow-sm'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        📲 Entrante
                      </button>
                      <button
                        type="button"
                        onClick={() => setCallDirection('outbound')}
                        className={`flex-1 py-1 rounded-lg text-[10.5px] font-bold transition cursor-pointer text-center ${
                          callDirection === 'outbound'
                            ? 'bg-blue-500 text-slate-950 shadow-sm'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        📞 Saliente
                      </button>
                    </div>

                    {/* Fecha y hora */}
                    <div className="flex items-center gap-1.5 bg-slate-950/70 px-2 py-1.5 rounded-xl border border-cyan-500/20">
                      <span className="text-[11px] text-slate-400 shrink-0">Fecha y hora:</span>
                      <input
                        type="datetime-local"
                        value={callDate}
                        onChange={(e) => setCallDate(e.target.value)}
                        className="bg-transparent text-cyan-200 text-xs focus:outline-none w-full"
                      />
                    </div>

                    {/* Orden vinculada */}
                    <div className="flex items-center gap-1.5 bg-slate-950/70 px-2 py-1.5 rounded-xl border border-cyan-500/20">
                      <span className="text-[11px] text-slate-400 shrink-0">Orden:</span>
                      <select
                        value={callOrderId}
                        onChange={(e) => setCallOrderId(e.target.value)}
                        className="bg-transparent text-cyan-200 text-xs focus:outline-none w-full cursor-pointer"
                      >
                        <option value="" className="bg-slate-950 text-white">General (Sin orden específica)</option>
                        {timelineOrders.map((o) => (
                          <option key={o.id} value={o.id} className="bg-slate-950 text-white">
                            #{o.order_code} - {o.brand} {o.model}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Fila de Textareas: Lo que dijo el cliente & Lo que se le respondió */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[11px] font-mono font-bold text-amber-300 flex items-center gap-1">
                        <span>🗣️</span>
                        <span>¿Qué dijo el cliente?</span>
                      </label>
                      <textarea
                        value={whatCustomerSaid}
                        onChange={(e) => setWhatCustomerSaid(e.target.value)}
                        placeholder="Detalla lo que el cliente consultó, pidió, informó o reclamó..."
                        rows={3}
                        className="w-full bg-[#030712] border border-cyan-500/30 rounded-xl p-2.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-cyan-400 font-sans resize-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-mono font-bold text-cyan-300 flex items-center gap-1">
                        <span>👤</span>
                        <span>¿Qué se le respondió / explicó al cliente?</span>
                      </label>
                      <textarea
                        value={whatAgentSaid}
                        onChange={(e) => setWhatAgentSaid(e.target.value)}
                        placeholder="Detalla la respuesta, precio, solución o información dada..."
                        rows={3}
                        className="w-full bg-[#030712] border border-cyan-500/30 rounded-xl p-2.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-cyan-400 font-sans resize-none"
                      />
                    </div>
                  </div>

                  {/* Fila de Acuerdo y Botón de envío */}
                  <div className="flex flex-col sm:flex-row items-center gap-2">
                    <div className="flex-1 w-full relative">
                      <input
                        type="text"
                        value={agreement}
                        onChange={(e) => setAgreement(e.target.value)}
                        placeholder="🤝 Acuerdo / Siguiente paso (opcional, ej: Se prometió llamar mañana a las 10am...)"
                        className="w-full bg-[#030712] border border-cyan-500/30 rounded-xl px-3 py-2 text-xs text-emerald-200 placeholder-slate-400 focus:outline-none focus:border-emerald-400 font-sans"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={savingNote || (!whatCustomerSaid.trim() && !whatAgentSaid.trim())}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-mono font-black flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(6,182,212,0.3)] transition active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[16px]">save</span>
                      <span>{savingNote ? 'Guardando resumen…' : 'Guardar Resumen de Llamada'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* MODO 2: NOTA RÁPIDA O ACUERDO */
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-400">Tipo de apunte:</span>
                      {(['nota', 'acuerdo'] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setNewNoteType(t)}
                          className={`px-2.5 py-1 rounded-lg text-[10.5px] font-bold transition cursor-pointer ${
                            newNoteType === t
                              ? 'bg-cyan-500 text-slate-950 shadow-sm'
                              : 'bg-slate-800 text-slate-300 hover:text-white'
                          }`}
                        >
                          {t === 'nota' ? 'Nota interna' : 'Acuerdo directo'}
                        </button>
                      ))}
                    </div>

                    {timelineOrders.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-400">Orden vinculada:</span>
                        <select
                          value={newNoteOrderId}
                          onChange={(e) => setNewNoteOrderId(e.target.value)}
                          className="bg-slate-950 border border-cyan-500/30 text-cyan-200 text-xs rounded-lg px-2.5 py-1 focus:outline-none"
                        >
                          <option value="">General (Sin orden específica)</option>
                          {timelineOrders.map((o) => (
                            <option key={o.id} value={o.id}>
                              #{o.order_code} - {o.brand} {o.model}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <textarea
                      value={newNoteContent}
                      onChange={(e) => setNewNoteContent(e.target.value)}
                      placeholder="Escribe la nota interna o recordatorio para los operadores..."
                      rows={2}
                      className="flex-1 bg-[#030712] border border-cyan-500/30 rounded-xl p-2.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-cyan-400 font-sans resize-none"
                    />
                    <button
                      type="submit"
                      disabled={savingNote || !newNoteContent.trim()}
                      className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-mono font-black flex items-center gap-1.5 shadow-[0_0_15px_rgba(6,182,212,0.3)] transition active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[16px]">send</span>
                      <span>{savingNote ? 'Guardando…' : 'Guardar Nota'}</span>
                    </button>
                  </div>
                </div>
              )}
            </form>
          </>
        )}
      </div>

      <RegisterCallModal
        isOpen={registerModalOpen}
        onClose={() => setRegisterModalOpen(false)}
        onSuccess={() => {
          setRegisterModalOpen(false);
          if (selectedCustomerId) {
            void loadTimeline(selectedCustomerId);
          }
          void loadCustomers(search);
        }}
        initialCustomerId={selectedCustomerId && selectedCustomerId > 0 ? selectedCustomerId : null}
      />

      {saveContactModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Agregar número a contactos"
          className="horizon-modal fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto"
        >
          <div className="w-full max-w-md rounded-3xl border border-amber-500/30 bg-[var(--bg-card)] shadow-2xl overflow-hidden my-auto">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-amber-500/20 px-5 py-4 bg-slate-900/90 backdrop-blur-md">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-300 flex items-center justify-center shrink-0">
                  <span aria-hidden="true" className="material-symbols-outlined text-[22px]">person_add</span>
                </div>
                <div>
                  <h3 className="text-sm font-black text-white font-mono uppercase tracking-tight">
                    Agregar a Contactos
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Guardar y vincular este número a un cliente
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSaveContactModalOpen(false)}
                className="w-8 h-8 rounded-xl border border-slate-700/60 bg-slate-800/60 text-slate-400 hover:text-white flex items-center justify-center cursor-pointer transition"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {/* Formulario */}
            <form onSubmit={handleSaveContact} className="p-5 space-y-3.5">
              {saveContactError && (
                <div className="px-3 py-2 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-mono flex items-center gap-2">
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px] shrink-0">error</span>
                  <span>{saveContactError}</span>
                </div>
              )}

              <div>
                <label className="text-[11px] font-mono text-slate-300 block mb-1">
                  Número de teléfono:
                </label>
                <input
                  type="text"
                  value={contactPhoneToSave}
                  readOnly
                  className="w-full bg-slate-950/70 border border-slate-700/60 rounded-xl px-3 py-2 text-xs font-mono text-amber-300 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-mono text-slate-300 block mb-1">
                    Nombre: <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={contactFirstName}
                    onChange={(e) => setContactFirstName(e.target.value)}
                    placeholder="Ej: Roberto"
                    className="w-full bg-[#030712] border border-cyan-500/30 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-cyan-400"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-mono text-slate-300 block mb-1">
                    Apellido:
                  </label>
                  <input
                    type="text"
                    value={contactLastName}
                    onChange={(e) => setContactLastName(e.target.value)}
                    placeholder="Ej: Pérez"
                    className="w-full bg-[#030712] border border-cyan-500/30 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-cyan-400"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-mono text-slate-300 block mb-1">
                  Empresa / Taller (opcional):
                </label>
                <input
                  type="text"
                  value={contactCompany}
                  onChange={(e) => setContactCompany(e.target.value)}
                  placeholder="Ej: Taller Mecánico Central"
                  className="w-full bg-[#030712] border border-cyan-500/30 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-cyan-500/10">
                <button
                  type="button"
                  onClick={() => setSaveContactModalOpen(false)}
                  disabled={savingContact}
                  className="px-4 py-2 rounded-xl text-xs font-mono text-slate-400 hover:text-white cursor-pointer transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingContact || !contactFirstName.trim()}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 text-xs font-mono font-black flex items-center gap-1.5 shadow-[0_0_12px_rgba(245,158,11,0.3)] transition active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">person_add</span>
                  <span>{savingContact ? 'Guardando…' : 'Guardar Contacto'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
