import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../services/apiFetch';

export interface RegisterCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialCall?: {
    callerNumber?: string | null;
    callerName?: string | null;
    direction?: 'inbound' | 'outbound' | 'internal';
    startedAt?: string | null;
    clientId?: number | null;
    clientName?: string | null;
    orderId?: string | null;
    orderCode?: string | null;
  } | null;
  initialCustomerId?: number | null;
}

const getNowLocalString = (): string => {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
};

const toLocalDatetime = (isoString?: string | null): string => {
  if (!isoString) return getNowLocalString();
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return getNowLocalString();
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
  } catch {
    return getNowLocalString();
  }
};

export const RegisterCallModal: React.FC<RegisterCallModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialCall,
  initialCustomerId,
}) => {
  // Selected Customer
  const [selectedCustomer, setSelectedCustomer] = useState<{
    id: number;
    name: string;
    phone: string;
    company?: string | null;
  } | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);

  // Quick customer creation
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  // Form Fields
  const [callDirection, setCallDirection] = useState<'inbound' | 'outbound'>('inbound');
  const [callDate, setCallDate] = useState<string>(getNowLocalString());
  const [customerOrders, setCustomerOrders] = useState<any[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [whatCustomerSaid, setWhatCustomerSaid] = useState('');
  const [whatAgentSaid, setWhatAgentSaid] = useState('');
  const [agreement, setAgreement] = useState('');

  // Status
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Cargar órdenes del cliente seleccionado
  const loadCustomerOrders = useCallback(async (cId: number) => {
    try {
      const res = await apiFetch(`/communications/customers/${cId}/timeline`);
      if (res.ok) {
        const data = await res.json();
        setCustomerOrders(Array.isArray(data.orders) ? data.orders : []);
        if (data.customer && !selectedCustomer) {
          setSelectedCustomer({
            id: data.customer.id,
            name: `${data.customer.first_name || ''} ${data.customer.last_name || ''}`.trim() || 'Cliente',
            phone: data.customer.phone || '',
            company: data.customer.company || null,
          });
        }
      }
    } catch {
      // Ignorar fallo de carga de órdenes
    }
  }, [selectedCustomer]);

  // Inicializar estado cada vez que se abre el modal
  useEffect(() => {
    if (!isOpen) return;

    setErrorMessage(null);
    setWhatCustomerSaid('');
    setWhatAgentSaid('');
    setAgreement('');
    setShowCreateCustomer(false);
    setShowSearchDropdown(false);

    // Dirección y fecha de la llamada
    const dir = initialCall?.direction === 'outbound' ? 'outbound' : 'inbound';
    setCallDirection(dir);
    setCallDate(toLocalDatetime(initialCall?.startedAt));
    setSelectedOrderId(initialCall?.orderId ? String(initialCall.orderId) : '');

    const targetCustomerId = initialCustomerId || initialCall?.clientId || null;

    if (targetCustomerId) {
      setSelectedCustomer({
        id: targetCustomerId,
        name: initialCall?.clientName || 'Cliente',
        phone: initialCall?.callerNumber || '',
      });
      void loadCustomerOrders(targetCustomerId);
    } else if (initialCall?.callerNumber) {
      // Intentar buscar cliente automáticamente por número telefónico
      const phoneClean = initialCall.callerNumber.replace(/\D/g, '');
      setNewCustPhone(initialCall.callerNumber);
      setNewCustName(initialCall.callerName || '');
      setSelectedCustomer(null);

      void (async () => {
        try {
          const res = await apiFetch(`/communications/customers?q=${encodeURIComponent(phoneClean)}&limit=5`);
          if (res.ok) {
            const data = await res.json();
            const list = Array.isArray(data.customers) ? data.customers : [];
            if (list.length === 1) {
              const matched = list[0];
              setSelectedCustomer({
                id: matched.customerId,
                name: matched.customerName,
                phone: matched.phone,
                company: matched.company,
              });
              void loadCustomerOrders(matched.customerId);
            } else if (list.length > 1) {
              setSearchResults(list);
              setShowSearchDropdown(true);
            }
          }
        } catch {
          // Ignorar
        }
      })();
    } else {
      setSelectedCustomer(null);
      setCustomerOrders([]);
    }
  }, [isOpen, initialCall, initialCustomerId, loadCustomerOrders]);

  // Búsqueda de clientes
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiFetch(`/communications/customers?q=${encodeURIComponent(searchQuery)}&limit=8`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(Array.isArray(data.customers) ? data.customers : []);
          setShowSearchDropdown(true);
        }
      } catch {
        // Ignorar
      } finally {
        setSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Crear cliente rápido si no existe
  const handleQuickCreateCustomer = async () => {
    if (!newCustName.trim() || !newCustPhone.trim() || creatingCustomer) return;
    setCreatingCustomer(true);
    setErrorMessage(null);

    try {
      const parts = newCustName.trim().split(' ');
      const firstName = parts[0] || 'Cliente';
      const lastName = parts.slice(1).join(' ') || '';

      const res = await apiFetch('/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          phone: newCustPhone.trim(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const createdId = data.id || data.customerId;
        setSelectedCustomer({
          id: createdId,
          name: newCustName.trim(),
          phone: newCustPhone.trim(),
        });
        setShowCreateCustomer(false);
        setCustomerOrders([]);
      } else {
        const err = await res.json().catch(() => ({}));
        setErrorMessage(err.message || err.error || 'No fue posible registrar el nuevo cliente.');
      }
    } catch {
      setErrorMessage('Error al crear el cliente.');
    } finally {
      setCreatingCustomer(false);
    }
  };

  // Guardar resumen de llamada
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!selectedCustomer) {
      setErrorMessage('Debes seleccionar o crear un cliente para vincular la llamada.');
      return;
    }

    if (!whatCustomerSaid.trim() && !whatAgentSaid.trim()) {
      setErrorMessage('Debes escribir qué dijo el cliente o qué se le respondió.');
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch(`/communications/customers/${selectedCustomer.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteType: 'call_summary',
          callDirection,
          callDate: callDate ? new Date(callDate).toISOString() : new Date().toISOString(),
          whatCustomerSaid: whatCustomerSaid.trim(),
          whatAgentSaid: whatAgentSaid.trim(),
          agreement: agreement.trim(),
          orderId: selectedOrderId ? Number(selectedOrderId) : null,
        }),
      });

      if (res.ok) {
        onSuccess?.();
        onClose();
      } else {
        const err = await res.json().catch(() => ({}));
        setErrorMessage(err.message || err.error || 'No fue posible guardar el resumen de llamada.');
      }
    } catch {
      setErrorMessage('Error de red al guardar la llamada.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Registrar Resumen de Llamada"
      className="horizon-modal fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto"
    >
      <div className="w-full max-w-2xl rounded-3xl border border-cyan-500/30 bg-[var(--bg-card)] shadow-2xl overflow-hidden my-auto">
        {/* Header Modal */}
        <div className="flex items-center justify-between border-b border-cyan-500/20 px-6 py-4 bg-slate-900/90 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 flex items-center justify-center shrink-0">
              <span aria-hidden="true" className="material-symbols-outlined text-[22px]">add_call</span>
            </div>
            <div>
              <h3 className="text-base font-black text-white font-mono uppercase tracking-tight">
                Registrar Resumen de Llamada
              </h3>
              <p className="text-[11px] text-slate-400">
                Historial interno visible para todo el equipo de operadores
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar modal"
            className="w-8 h-8 rounded-xl border border-slate-700/60 bg-slate-800/60 text-slate-400 hover:text-white flex items-center justify-center shrink-0 cursor-pointer transition"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorMessage && (
            <div className="px-3.5 py-2 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-mono flex items-center gap-2">
              <span aria-hidden="true" className="material-symbols-outlined text-[16px] shrink-0">error</span>
              <span>{errorMessage}</span>
            </div>
          )}

          {/* 1. SELECCIÓN O ASIGNACIÓN DEL CLIENTE */}
          <div className="rounded-2xl border border-cyan-500/20 bg-slate-900/40 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-cyan-400">person</span>
                <span>Cliente asociado a la llamada:</span>
              </label>

              {selectedCustomer && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCustomer(null);
                    setCustomerOrders([]);
                    setSelectedOrderId('');
                  }}
                  className="text-[10.5px] font-mono text-cyan-400 hover:text-cyan-200 underline cursor-pointer"
                >
                  Cambiar cliente
                </button>
              )}
            </div>

            {selectedCustomer ? (
              <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500 text-slate-950 flex items-center justify-center font-black font-mono text-xs shrink-0">
                    {selectedCustomer.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-black text-white truncate">{selectedCustomer.name}</p>
                    <p className="text-[10.5px] font-mono text-cyan-300">
                      {selectedCustomer.phone || 'Sin teléfono'}
                      {selectedCustomer.company ? ` · ${selectedCustomer.company}` : ''}
                    </p>
                  </div>
                </div>

                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0">
                  ✓ Seleccionado
                </span>
              </div>
            ) : showCreateCustomer ? (
              /* Subformulario para crear cliente nuevo */
              <div className="space-y-2.5 pt-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10.5px] text-slate-400 font-mono block mb-1">Nombre completo:</label>
                    <input
                      type="text"
                      value={newCustName}
                      onChange={(e) => setNewCustName(e.target.value)}
                      placeholder="Ej: Carlos Méndez"
                      className="w-full bg-[#030712] border border-cyan-500/30 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                  <div>
                    <label className="text-[10.5px] text-slate-400 font-mono block mb-1">Número de teléfono:</label>
                    <input
                      type="text"
                      value={newCustPhone}
                      onChange={(e) => setNewCustPhone(e.target.value)}
                      placeholder="Ej: 9841234567"
                      className="w-full bg-[#030712] border border-cyan-500/30 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-cyan-400 font-mono"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowCreateCustomer(false)}
                    className="px-3 py-1.5 rounded-xl text-xs font-mono text-slate-400 hover:text-white cursor-pointer"
                  >
                    Volver al buscador
                  </button>
                  <button
                    type="button"
                    disabled={creatingCustomer || !newCustName.trim() || !newCustPhone.trim()}
                    onClick={() => { void handleQuickCreateCustomer(); }}
                    className="px-3.5 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-mono font-bold cursor-pointer disabled:opacity-40"
                  >
                    {creatingCustomer ? 'Creando…' : 'Crear y vincular cliente'}
                  </button>
                </div>
              </div>
            ) : (
              /* Buscador de cliente */
              <div className="relative space-y-1.5">
                <div className="relative">
                  <span aria-hidden="true" className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">
                    search
                  </span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Escribe nombre, teléfono o número de orden del cliente..."
                    className="w-full bg-[#030712] border border-cyan-500/30 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-cyan-400 font-sans"
                  />
                  {searching && (
                    <span aria-hidden="true" className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-cyan-400 text-[16px] animate-spin">
                      sync
                    </span>
                  )}
                </div>

                {/* Dropdown de resultados de búsqueda */}
                {showSearchDropdown && searchResults.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-48 overflow-y-auto rounded-xl bg-slate-900 border border-cyan-500/30 shadow-2xl divide-y divide-slate-800 custom-scrollbar">
                    {searchResults.map((c) => (
                      <button
                        key={c.customerId}
                        type="button"
                        onClick={() => {
                          setSelectedCustomer({
                            id: c.customerId,
                            name: c.customerName,
                            phone: c.phone,
                            company: c.company,
                          });
                          setShowSearchDropdown(false);
                          setSearchQuery('');
                          void loadCustomerOrders(c.customerId);
                        }}
                        className="w-full text-left p-2.5 hover:bg-cyan-500/15 flex items-center justify-between gap-2 cursor-pointer transition"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white truncate">{c.customerName}</p>
                          <p className="text-[10.5px] font-mono text-slate-400">
                            {c.phone} {c.company ? `· ${c.company}` : ''}
                          </p>
                        </div>
                        {c.activeOrders > 0 && (
                          <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 shrink-0">
                            {c.activeOrders} activa(s)
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10.5px] text-slate-400 font-mono">
                    ¿El cliente no está registrado aún?
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateCustomer(true);
                      setShowSearchDropdown(false);
                    }}
                    className="text-[11px] font-mono font-bold text-cyan-400 hover:text-cyan-200 underline cursor-pointer"
                  >
                    + Registrar cliente nuevo
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 2. METADATOS DE LA LLAMADA (Tipo, Fecha/Hora, Orden) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs font-mono">
            {/* Tipo / Dirección */}
            <div className="bg-slate-900/40 p-2 rounded-xl border border-cyan-500/20 space-y-1">
              <span className="text-[10.5px] text-slate-400 block font-bold">Tipo de llamada:</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCallDirection('inbound')}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer text-center ${
                    callDirection === 'inbound'
                      ? 'bg-emerald-500 text-slate-950 shadow-sm'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  📲 Entrante
                </button>
                <button
                  type="button"
                  onClick={() => setCallDirection('outbound')}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer text-center ${
                    callDirection === 'outbound'
                      ? 'bg-blue-500 text-slate-950 shadow-sm'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  📞 Saliente
                </button>
              </div>
            </div>

            {/* Fecha y hora */}
            <div className="bg-slate-900/40 p-2 rounded-xl border border-cyan-500/20 space-y-1">
              <span className="text-[10.5px] text-slate-400 block font-bold">Fecha y hora:</span>
              <input
                type="datetime-local"
                value={callDate}
                onChange={(e) => setCallDate(e.target.value)}
                className="w-full bg-[#030712] border border-cyan-500/30 rounded-lg px-2 py-1 text-xs text-cyan-200 focus:outline-none"
              />
            </div>

            {/* Orden vinculada */}
            <div className="bg-slate-900/40 p-2 rounded-xl border border-cyan-500/20 space-y-1">
              <span className="text-[10.5px] text-slate-400 block font-bold">Orden vinculada:</span>
              <select
                value={selectedOrderId}
                onChange={(e) => setSelectedOrderId(e.target.value)}
                className="w-full bg-[#030712] border border-cyan-500/30 rounded-lg px-2 py-1 text-xs text-cyan-200 focus:outline-none cursor-pointer"
              >
                <option value="">General (Sin orden)</option>
                {customerOrders.map((o) => (
                  <option key={o.id} value={o.id}>
                    #{o.order_code} - {o.brand} {o.model}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 3. LO QUE DIJO EL CLIENTE */}
          <div className="space-y-1">
            <label className="text-xs font-mono font-bold text-amber-300 flex items-center gap-1.5">
              <span className="text-sm">🗣️</span>
              <span>¿Qué dijo el cliente?</span>
            </label>
            <textarea
              value={whatCustomerSaid}
              onChange={(e) => setWhatCustomerSaid(e.target.value)}
              placeholder="Detalla lo que el cliente preguntó, pidió, informó o reclamó..."
              rows={3}
              className="w-full bg-[#030712] border border-cyan-500/30 rounded-xl p-3 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-cyan-400 font-sans resize-none leading-relaxed"
            />
          </div>

          {/* 4. LO QUE SE LE RESPONDIÓ / EXPLICÓ */}
          <div className="space-y-1">
            <label className="text-xs font-mono font-bold text-cyan-300 flex items-center gap-1.5">
              <span className="text-sm">👤</span>
              <span>¿Qué se le respondió / explicó al cliente?</span>
            </label>
            <textarea
              value={whatAgentSaid}
              onChange={(e) => setWhatAgentSaid(e.target.value)}
              placeholder="Detalla la respuesta dada, precio acordado, explicación o solución..."
              rows={3}
              className="w-full bg-[#030712] border border-cyan-500/30 rounded-xl p-3 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-cyan-400 font-sans resize-none leading-relaxed"
            />
          </div>

          {/* 5. ACUERDO / PRÓXIMO PASO (OPCIONAL) */}
          <div className="space-y-1">
            <label className="text-xs font-mono font-bold text-emerald-300 flex items-center gap-1.5">
              <span className="text-sm">🤝</span>
              <span>Acuerdo / Próximo paso (opcional):</span>
            </label>
            <input
              type="text"
              value={agreement}
              onChange={(e) => setAgreement(e.target.value)}
              placeholder="Ej: Se le prometió llamar mañana a las 11:00 am / Esperando fotos del VIN..."
              className="w-full bg-[#030712] border border-cyan-500/30 rounded-xl px-3 py-2 text-xs text-emerald-200 placeholder-slate-400 focus:outline-none focus:border-emerald-400 font-sans"
            />
          </div>

          {/* Botones de acción */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-cyan-500/10">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-mono text-slate-400 hover:text-white cursor-pointer transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || (!whatCustomerSaid.trim() && !whatAgentSaid.trim())}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-mono font-black flex items-center gap-2 shadow-[0_0_15px_rgba(6,182,212,0.3)] transition active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[17px]">save</span>
              <span>{saving ? 'Guardando resumen…' : 'Guardar Resumen de Llamada'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
