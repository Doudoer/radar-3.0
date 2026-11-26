import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from '../services/apiFetch';

export interface CustomerSummaryItem {
  customerId: number;
  customerName: string;
  phone: string;
  whatsapp?: string | null;
  company?: string | null;
  totalOrders: number;
  activeOrders: number;
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

const formatSeconds = (sec: number = 0): string => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s < 10 ? `0${s}` : s}s`;
};

export const CustomerConversationsPanel: React.FC<CustomerConversationsPanelProps> = ({
  onSelectOrder,
  initialCustomerId,
}) => {
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<CustomerSummaryItem[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(initialCustomerId || null);

  // Selected Customer Timeline State
  const [timelineCustomer, setTimelineCustomer] = useState<any | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEventItem[]>([]);
  const [timelineOrders, setTimelineOrders] = useState<any[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'calls' | 'messages' | 'notes'>('all');

  // New Note State
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newNoteType, setNewNoteType] = useState<'nota' | 'acuerdo' | 'llamada_manual'>('nota');
  const [newNoteOrderId, setNewNoteOrderId] = useState<string>('');
  const [savingNote, setSavingNote] = useState(false);
  const [expandedTranscripts, setExpandedTranscripts] = useState<Record<string, boolean>>({});

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
  const loadTimeline = useCallback(async (cId: number) => {
    setLoadingTimeline(true);
    try {
      const res = await apiFetch(`/communications/customers/${cId}/timeline`);
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
  }, []);

  useEffect(() => {
    if (selectedCustomerId) {
      void loadTimeline(selectedCustomerId);
    }
  }, [selectedCustomerId, loadTimeline]);

  // 3. Enviar nueva nota / acuerdo
  const handleSaveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerId || !newNoteContent.trim() || savingNote) return;

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
      }
    } catch {
      // Fallo al guardar
    } finally {
      setSavingNote(false);
    }
  };

  const filteredEvents = useMemo(() => {
    if (filterType === 'all') return timelineEvents;
    if (filterType === 'calls') return timelineEvents.filter((ev) => ev.type === 'call_pbx' || ev.type === 'call_manual');
    if (filterType === 'messages') return timelineEvents.filter((ev) => ev.type === 'message_outbox');
    if (filterType === 'notes') return timelineEvents.filter((ev) => ev.type === 'employee_note');
    return timelineEvents;
  }, [timelineEvents, filterType]);

  const toggleTranscript = (id: string) => {
    setExpandedTranscripts((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const cleanPhone = timelineCustomer?.phone ? timelineCustomer.phone.replace(/\D/g, '') : '';
  const waUrl = cleanPhone ? `https://wa.me/${cleanPhone.length === 10 ? `1${cleanPhone}` : cleanPhone}` : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[calc(100vh-190px)] min-h-[580px]">
      {/* ============================================================== */}
      {/* COLUMNA IZQUIERDA: LISTA Y BUSCADOR DE CLIENTES                */}
      {/* ============================================================== */}
      <div className="lg:col-span-4 flex flex-col rounded-2xl bg-[var(--bg-card)] border border-cyan-500/20 overflow-hidden shadow-lg">
        {/* Header buscador */}
        <div className="p-3.5 border-b border-cyan-500/20 bg-slate-900/60 backdrop-blur-md space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="material-symbols-outlined text-cyan-400 text-[20px]">forum</span>
              <h2 className="text-sm font-black font-mono tracking-tight text-white uppercase">Clientes & Conversaciones</h2>
            </div>
            <span className="text-[10.5px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
              {customers.length}
            </span>
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
        </div>

        {/* Lista de clientes */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60 custom-scrollbar">
          {loadingCustomers && customers.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
              <span aria-hidden="true" className="material-symbols-outlined text-cyan-400 text-2xl animate-spin">sync</span>
              <span>Buscando clientes y conversaciones…</span>
            </div>
          ) : customers.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 space-y-1">
              <span aria-hidden="true" className="material-symbols-outlined text-3xl text-slate-500 mb-1">person_search</span>
              <p className="font-bold text-slate-300">No se encontraron clientes</p>
              <p className="text-[11px] text-slate-400">Prueba buscando por nombre, teléfono o # de orden</p>
            </div>
          ) : (
            customers.map((c) => {
              const isSelected = c.customerId === selectedCustomerId;
              return (
                <button
                  key={c.customerId}
                  type="button"
                  onClick={() => setSelectedCustomerId(c.customerId)}
                  className={`w-full text-left p-3.5 transition-all flex items-start gap-3 cursor-pointer ${
                    isSelected
                      ? 'bg-cyan-500/15 border-l-4 border-cyan-400 shadow-inner'
                      : 'hover:bg-slate-800/40 border-l-4 border-transparent'
                  }`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold font-mono text-xs shrink-0 ${
                    isSelected
                      ? 'bg-cyan-500 text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.5)]'
                      : 'bg-slate-800 text-cyan-300 border border-cyan-500/30'
                  }`}>
                    {c.customerName.slice(0, 2).toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <strong className={`text-xs truncate ${isSelected ? 'text-cyan-200 font-black' : 'text-slate-200'}`}>
                        {c.customerName}
                      </strong>
                      {c.lastInteractionAt && (
                        <span className="text-[10px] text-slate-400 font-mono shrink-0">
                          {formatRelativeTime(c.lastInteractionAt)}
                        </span>
                      )}
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
                          {c.lastInteractionType === 'call' ? 'call' : c.lastInteractionType === 'message' ? 'chat' : 'edit_note'}
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
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400 space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <span aria-hidden="true" className="material-symbols-outlined text-3xl">question_answer</span>
            </div>
            <div className="max-w-sm space-y-1">
              <h3 className="text-base font-bold text-slate-200">Selecciona un cliente</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Elige cualquier cliente de la lista para consultar su historial unificado de llamadas, mensajes de WhatsApp, notas de otros asesores y órdenes activas.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Cabecera del Cliente Seleccionado */}
            <div className="p-4 border-b border-cyan-500/20 bg-slate-900/80 backdrop-blur-md flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center font-black font-mono text-slate-950 text-base shadow-md shrink-0">
                  {timelineCustomer.first_name?.[0] || 'C'}{timelineCustomer.last_name?.[0] || ''}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-black text-white truncate">
                      {timelineCustomer.first_name} {timelineCustomer.last_name || ''}
                    </h2>
                    {timelineCustomer.company && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                        {timelineCustomer.company}
                      </span>
                    )}
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
                {timelineCustomer.phone && (
                  <a
                    href={`tel:${timelineCustomer.phone}`}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 text-xs font-mono font-bold flex items-center gap-1.5 transition"
                    title="Llamar al cliente"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">call</span>
                    <span className="hidden sm:inline">Llamar</span>
                  </a>
                )}
                {waUrl && (
                  <a
                    href={waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-xs font-mono font-bold flex items-center gap-1.5 transition shadow-[0_0_12px_rgba(16,185,129,0.2)]"
                    title="Abrir chat de WhatsApp"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-emerald-400">chat</span>
                    <span>WhatsApp</span>
                  </a>
                )}
              </div>
            </div>

            {/* Órdenes del cliente en tarjetas horizontales compactas */}
            {timelineOrders.length > 0 && (
              <div className="px-4 py-2.5 bg-slate-950/40 border-b border-cyan-500/10 flex items-center gap-2 overflow-x-auto custom-scrollbar">
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
                {(['all', 'calls', 'messages', 'notes'] as const).map((tabKey) => {
                  const labels = { all: 'Todos', calls: '📞 Llamadas', messages: '💬 Mensajes', notes: '📝 Notas' };
                  return (
                    <button
                      key={tabKey}
                      type="button"
                      onClick={() => setFilterType(tabKey)}
                      className={`px-2.5 py-1 rounded-lg text-[10.5px] font-bold transition cursor-pointer ${
                        filterType === tabKey
                          ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400'
                          : 'text-slate-400 hover:text-white border border-transparent'
                      }`}
                    >
                      {labels[tabKey]}
                    </button>
                  );
                })}
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
                  <p className="text-[11px] text-slate-400">Las llamadas PBX, mensajes de WhatsApp y notas que escribas aparecerán aquí.</p>
                </div>
              ) : (
                filteredEvents.map((event) => {
                  const isCall = event.type === 'call_pbx' || event.type === 'call_manual';
                  const isMsg = event.type === 'message_outbox';
                  const isNote = event.type === 'employee_note';

                  return (
                    <div
                      key={event.id}
                      className={`p-3.5 rounded-2xl border transition-all space-y-2 ${
                        isCall
                          ? 'bg-slate-900/60 border-cyan-500/25 hover:border-cyan-500/40'
                          : isMsg
                            ? 'bg-emerald-950/20 border-emerald-500/25 hover:border-emerald-500/40'
                            : 'bg-amber-950/20 border-amber-500/25 hover:border-amber-500/40'
                      }`}
                    >
                      {/* Cabecera del evento */}
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                        <div className="flex items-center gap-2">
                          <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                            isCall
                              ? 'bg-cyan-500/20 text-cyan-400'
                              : isMsg
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-amber-500/20 text-amber-400'
                          }`}>
                            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
                              {isCall ? 'call' : isMsg ? 'chat' : 'edit_note'}
                            </span>
                          </span>
                          <div>
                            <strong className="text-white text-xs">{event.title}</strong>
                            <span className="text-slate-400 text-[11px] ml-2">por {event.authorOrAttendedBy}</span>
                          </div>
                        </div>

                        <span className="text-[10.5px] text-slate-400 font-mono">
                          {formatFullDate(event.timestamp)}
                        </span>
                      </div>

                      {/* Contenido / Resumen */}
                      <p className="text-xs text-slate-200 leading-relaxed pl-9">
                        {event.summary}
                      </p>

                      {/* Si es llamada con audio disponible */}
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

            {/* Cuadro Inferior: Agregar Nota de Conversación para el equipo */}
            <form onSubmit={handleSaveNote} className="p-3.5 border-t border-cyan-500/20 bg-slate-900/90 backdrop-blur-md space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono font-bold text-slate-300">Tipo:</span>
                  {(['nota', 'acuerdo', 'llamada_manual'] as const).map((t) => {
                    const tLabels = { nota: 'Nota interna', acuerdo: 'Acuerdo', llamada_manual: 'Llamada telefónica' };
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setNewNoteType(t)}
                        className={`px-2 py-0.5 rounded text-[10.5px] font-mono font-bold transition cursor-pointer ${
                          newNoteType === t
                            ? 'bg-cyan-500 text-slate-950 shadow-sm'
                            : 'bg-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {tLabels[t]}
                      </button>
                    );
                  })}
                </div>

                {timelineOrders.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs font-mono">
                    <span className="text-[11px] text-slate-400">Orden vinculada:</span>
                    <select
                      value={newNoteOrderId}
                      onChange={(e) => setNewNoteOrderId(e.target.value)}
                      className="bg-slate-950 border border-cyan-500/30 text-cyan-300 text-[11px] rounded px-2 py-0.5 focus:outline-none"
                    >
                      <option value="">General (Sin orden específica)</option>
                      {timelineOrders.map((o) => (
                        <option key={o.id} value={o.id}>#{o.order_code} - {o.brand} {o.model}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <textarea
                  value={newNoteContent}
                  onChange={(e) => setNewNoteContent(e.target.value)}
                  placeholder="Escribe lo conversado o acordado con el cliente para que todo el equipo esté enterado..."
                  rows={2}
                  className="flex-1 bg-[#030712] border border-cyan-500/30 rounded-xl p-2.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-cyan-400 font-sans resize-none"
                />
                <button
                  type="submit"
                  disabled={savingNote || !newNoteContent.trim()}
                  className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-mono font-black flex items-center gap-1.5 shadow-[0_0_15px_rgba(6,182,212,0.3)] transition active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">send</span>
                  <span>{savingNote ? 'Guardando…' : 'Guardar'}</span>
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
};
