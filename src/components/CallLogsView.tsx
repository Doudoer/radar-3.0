import React, { useEffect, useState } from 'react';
import { PrefillOrderData } from '../types';
import { apiFetch } from '../services/apiFetch';

interface CallLogsViewProps {
  onCreateOrderFromCall?: (prefillData: PrefillOrderData) => void;
}

export const CallLogsView: React.FC<CallLogsViewProps> = ({ onCreateOrderFromCall }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [callTypeFilter, setCallTypeFilter] = useState('Todas');
  const [isRegisterCallModalOpen, setIsRegisterCallModalOpen] = useState(false);
  const [newCallerName, setNewCallerName] = useState('');
  const [newCallerPhone, setNewCallerPhone] = useState('');
  const [newCallerNotes, setNewCallerNotes] = useState('');
  const [newCallerVehicle, setNewCallerVehicle] = useState('Ford F-150');
  const [newCallerPart, setNewCallerPart] = useState('Motor Completo');
  const [createOrderDirectly, setCreateOrderDirectly] = useState(true);

  const [callLogs, setCallLogs] = useState<Array<{
    id: number;
    customer: string;
    phone: string;
    type: string;
    duration: string;
    date: string;
    agent: string;
    sentiment: string;
    summary: string;
    tags: string[];
    vehicleMake: string;
    vehicleModel: string;
    vehicleYear: number;
    part: string;
    partPrice: number;
    recordingUrl: string;
  }>>([]);

  useEffect(() => {
    apiFetch('/calls')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((calls) => setCallLogs(calls.map((call: any) => ({
        id: call.id,
        customer: call.contact_name || [call.first_name, call.last_name].filter(Boolean).join(' ') || 'Contacto sin nombre',
        phone: call.phone || '',
        type: call.is_claim ? 'Reclamo' : 'Entrante',
        duration: 'Sin registro',
        date: new Date(call.created_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }),
        agent: call.agent || 'Sin asignar',
        sentiment: 'Sin analizar',
        summary: call.description || '',
        tags: call.order_code ? [call.order_code] : [],
        vehicleMake: 'Ford', vehicleModel: 'F-150', vehicleYear: 2022, part: 'Refacción', partPrice: 0, recordingUrl: '#',
      }))))
      .catch(() => setCallLogs([]));
  }, []);

  const filtered = callLogs.filter((c) => {
    const matchesSearch =
      c.customer.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.phone.includes(searchTerm) ||
      c.summary.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = callTypeFilter === 'Todas' || c.type === callTypeFilter;
    return matchesSearch && matchesType;
  });

  const handleCreateOrderFromLog = (log: typeof callLogs[0]) => {
    if (onCreateOrderFromCall) {
      onCreateOrderFromCall({
        customerName: log.customer,
        customerPhone: log.phone,
        make: log.vehicleMake,
        model: log.vehicleModel,
        year: log.vehicleYear,
        mainPart: log.part,
        partPrice: log.partPrice,
        warrantyDays: log.partPrice >= 1500 ? 90 : log.partPrice >= 1000 ? 60 : 30,
        notes: `Origen: Llamada ${log.id} (${log.date}) atendida por ${log.agent}. Resumen: ${log.summary}`,
      });
    }
  };

  const handleRegisterCallSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCallerName || !newCallerPhone) return;

    const newLog = {
      id: 0,
      customer: newCallerName,
      phone: newCallerPhone,
      type: 'Entrante',
      duration: '1m 30s',
      date: new Date().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }),
      agent: 'Carlos Mendoza',
      sentiment: 'Positivo',
      summary: `${newCallerNotes || 'Llamada de cliente para solicitud de refacción'} (${newCallerVehicle} - ${newCallerPart})`,
      tags: [newCallerVehicle.split(' ')[0], newCallerPart],
      vehicleMake: newCallerVehicle.split(' ')[0] || 'Ford',
      vehicleModel: newCallerVehicle.split(' ').slice(1).join(' ') || 'F-150',
      vehicleYear: 2022,
      part: newCallerPart,
      partPrice: 950,
      recordingUrl: '#',
    };

    apiFetch('/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: newCallerPhone, contactName: newCallerName, description: newLog.summary, isClaim: false }),
    })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((savedCall) => setCallLogs((currentLogs) => [{ ...newLog, id: savedCall.id }, ...currentLogs]))
      .catch(() => undefined);
    setIsRegisterCallModalOpen(false);

    if (createOrderDirectly && onCreateOrderFromCall) {
      onCreateOrderFromCall({
        customerName: newCallerName,
        customerPhone: newCallerPhone,
        make: newLog.vehicleMake,
        model: newLog.vehicleModel,
        year: 2022,
        mainPart: newCallerPart,
        partPrice: 950,
        warrantyDays: 30,
        notes: `Origen: registro rápido de llamada. Notas: ${newCallerNotes}`,
      });
    }

    setNewCallerName('');
    setNewCallerPhone('');
    setNewCallerNotes('');
  };

  return (
    <div className="radar-view">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#111827]/80 p-5 rounded-xl border border-[#1e293b] backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[#388bfd] text-[26px]">call</span>
            <h1 className="text-xl font-bold text-[#f1f5f9] tracking-tight">Registro y Central de Llamadas (Método C)</h1>
          </div>
          <p className="text-xs text-[#94a3b8] mt-1">
            Recepción telefónica, transcripciones de voz con IA y conversión instantánea a Órdenes de Trabajo.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8] text-[18px]">
              search
            </span>
            <input
              type="text"
              placeholder="Buscar por cliente, teléfono, tema..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-[#0b1329] border border-[#1e293b] rounded-lg py-2 pl-9 pr-4 text-xs text-[#f1f5f9] placeholder:text-[#64748b] focus:outline-none focus:border-[#388bfd] w-64"
            />
          </div>

          <button
            onClick={() => setIsRegisterCallModalOpen(true)}
            className="bg-[#388bfd] hover:bg-[#2563eb] text-[#0a1120] font-bold text-xs py-2 px-4 rounded-lg flex items-center gap-2 transition-all cursor-pointer shadow-[0_0_12px_rgba(56,139,253,0.3)] active:scale-95"
          >
            <span className="material-symbols-outlined text-[18px]">add_call</span>
            <span>+ Registrar Llamada</span>
          </button>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#0f172a] border border-[#1e293b] p-4 rounded-xl flex items-center justify-between">
          <div>
            <span className="text-xs text-[#94a3b8]">Llamadas Atendidas Hoy</span>
            <h3 className="text-2xl font-bold text-[#f1f5f9] mt-1">42</h3>
            <span className="text-[10px] text-[#10b981]">100% contestadas</span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-[#388bfd]/15 border border-[#388bfd]/30 flex items-center justify-center text-[#58a6ff]">
            <span className="material-symbols-outlined text-[22px]">phone_in_talk</span>
          </div>
        </div>

        <div className="bg-[#0f172a] border border-[#1e293b] p-4 rounded-xl flex items-center justify-between">
          <div>
            <span className="text-xs text-[#94a3b8]">Tiempo Promedio en Llamada</span>
            <h3 className="text-2xl font-bold text-[#58a6ff] mt-1">3m 22s</h3>
            <span className="text-[10px] text-[#94a3b8]">Óptimo según SLA</span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-[#10b981]/15 border border-[#10b981]/30 flex items-center justify-center text-[#10b981]">
            <span className="material-symbols-outlined text-[22px]">timer</span>
          </div>
        </div>

        <div className="bg-[#0f172a] border border-[#1e293b] p-4 rounded-xl flex items-center justify-between">
          <div>
            <span className="text-xs text-[#94a3b8]">Sentimiento Positivo</span>
            <h3 className="text-2xl font-bold text-[#10b981] mt-1">88.5%</h3>
            <span className="text-[10px] text-[#10b981]">IA Voice Analysis</span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-[#10b981]/15 border border-[#10b981]/30 flex items-center justify-center text-[#10b981]">
            <span className="material-symbols-outlined text-[22px]">sentiment_satisfied</span>
          </div>
        </div>

        <div className="bg-[#0f172a] border border-[#1e293b] p-4 rounded-xl flex items-center justify-between">
          <div>
            <span className="text-xs text-[#94a3b8]">Conversión a Órdenes</span>
            <h3 className="text-2xl font-bold text-[#34d399] mt-1">74.2%</h3>
            <span className="text-[10px] text-[#34d399]">Ventas cerradas</span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-[#10b981]/15 border border-[#10b981]/30 flex items-center justify-center text-[#10b981]">
            <span className="material-symbols-outlined text-[22px]">shopping_cart_checkout</span>
          </div>
        </div>
      </div>

      {/* Call Logs Table */}
      <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl overflow-hidden shadow-lg">
        <div className="p-4 border-b border-[#1e293b] flex items-center justify-between">
          <h2 className="font-semibold text-sm text-[#f1f5f9]">Historial de Comunicaciones & Conversión Directa</h2>
          <div className="flex gap-2">
            {['Todas', 'Entrante', 'Saliente'].map((t) => (
              <button
                key={t}
                onClick={() => setCallTypeFilter(t)}
                className={`px-3 py-1 rounded text-xs transition-colors cursor-pointer ${
                  callTypeFilter === t
                    ? 'bg-[#388bfd] text-[#0a1120] font-semibold'
                    : 'bg-[#1e293b] text-[#94a3b8] hover:text-[#f1f5f9]'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#0b1329] text-[#94a3b8] uppercase text-[10px] tracking-wider border-b border-[#1e293b]">
              <tr>
                <th className="py-3 px-4">ID</th>
                <th className="py-3 px-4">Cliente / Contacto</th>
                <th className="py-3 px-4">Tipo & Fecha</th>
                <th className="py-3 px-4">Duración</th>
                <th className="py-3 px-4">Resumen IA & Pieza Solicitada</th>
                <th className="py-3 px-4">Sentimiento</th>
                <th className="py-3 px-4">Asesor</th>
                <th className="py-3 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e293b] text-[#cbd5e1]">
              {filtered.map((log) => (
                <tr key={log.id} className="hover:bg-[#1e293b]/40 transition-colors">
                  <td className="py-3 px-4 font-mono text-[#58a6ff] font-bold">{log.id}</td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-[#f1f5f9]">{log.customer}</div>
                    <div className="text-[10px] text-[#94a3b8] font-mono">{log.phone}</div>
                  </td>
                  <td className="py-3 px-4">
                    <span className="flex items-center gap-1 font-medium text-[#e2e8f0]">
                      <span
                        className={`material-symbols-outlined text-[14px] ${
                          log.type === 'Entrante' ? 'text-[#10b981]' : 'text-[#388bfd]'
                        }`}
                      >
                        {log.type === 'Entrante' ? 'call_received' : 'call_made'}
                      </span>
                      {log.type}
                    </span>
                    <span className="text-[10px] text-[#64748b] block">{log.date}</span>
                  </td>
                  <td className="py-3 px-4 font-mono">{log.duration}</td>
                  <td className="py-3 px-4 max-w-sm">
                    <p className="text-[#e2e8f0] text-xs leading-relaxed">{log.summary}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {log.tags.map((tag) => (
                        <span
                          key={tag}
                          className="bg-[#1e293b] text-[#58a6ff] text-[9px] px-2 py-0.5 rounded border border-[#388bfd]/30 font-medium"
                        >
                          {tag}
                        </span>
                      ))}
                      <span className="bg-[#10b981]/15 text-[#34d399] text-[9px] px-2 py-0.5 rounded border border-[#10b981]/30 font-mono font-bold">
                        Cotizado: ${log.partPrice}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        log.sentiment === 'Positivo'
                          ? 'bg-[#10b981]/20 text-[#34d399] border border-[#10b981]/30'
                          : log.sentiment === 'Inconforme'
                          ? 'bg-[#ef4444]/20 text-[#f87171] border border-[#ef4444]/30'
                          : 'bg-[#64748b]/20 text-[#94a3b8] border border-[#64748b]/30'
                      }`}
                    >
                      {log.sentiment}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-[#94a3b8]">{log.agent}</td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleCreateOrderFromLog(log)}
                        title="Crear Orden Directa desde Llamada (Método C)"
                        className="px-2.5 py-1.5 rounded-lg bg-[#388bfd] hover:bg-[#2563eb] text-[#0a1120] font-bold text-[11px] flex items-center gap-1 transition-all cursor-pointer shadow-[0_0_8px_rgba(56,139,253,0.3)] active:scale-95"
                      >
                        <span className="material-symbols-outlined text-[14px]">add_shopping_cart</span>
                        <span>Crear Orden</span>
                      </button>
                      <button
                        title="Escuchar Grabación"
                        className="p-1.5 rounded-lg bg-[#1e293b] hover:bg-[#334155] text-[#94a3b8] hover:text-[#f1f5f9] transition-colors cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Registrar Nueva Llamada con Opción de Crear Orden */}
      {isRegisterCallModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in">
          <div className="bg-[#111827] border border-[#1e293b] rounded-2xl w-full max-w-md p-6 shadow-2xl flex flex-col gap-4 text-xs text-[#cbd5e1]">
            <div className="flex justify-between items-center border-b border-[#1e293b] pb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#388bfd]">phone_forwarded</span>
                <h3 className="font-bold text-base text-[#f1f5f9]">Registrar Nueva Llamada</h3>
              </div>
              <button
                onClick={() => setIsRegisterCallModalOpen(false)}
                className="text-[#94a3b8] hover:text-white p-1"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleRegisterCallSubmit} className="flex flex-col gap-3">
              <div>
                <label className="block mb-1 text-[#94a3b8]">Nombre del Cliente / Taller *</label>
                <input
                  type="text"
                  required
                  value={newCallerName}
                  onChange={(e) => setNewCallerName(e.target.value)}
                  placeholder="Ej. Juan Pérez"
                  className="w-full bg-[#0a0f1d] border border-[#1e293b] rounded-lg p-2 text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                />
              </div>

              <div>
                <label className="block mb-1 text-[#94a3b8]">Teléfono de Contacto *</label>
                <input
                  type="text"
                  required
                  value={newCallerPhone}
                  onChange={(e) => setNewCallerPhone(e.target.value)}
                  placeholder="+1 (919) 555-0199"
                  className="w-full bg-[#0a0f1d] border border-[#1e293b] rounded-lg p-2 text-[#f1f5f9] font-mono focus:outline-none focus:border-[#388bfd]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block mb-1 text-[#94a3b8]">Vehículo Consultado</label>
                  <input
                    type="text"
                    value={newCallerVehicle}
                    onChange={(e) => setNewCallerVehicle(e.target.value)}
                    placeholder="Ej. Ford F-150"
                    className="w-full bg-[#0a0f1d] border border-[#1e293b] rounded-lg p-2 text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-[#94a3b8]">Pieza / Refacción</label>
                  <input
                    type="text"
                    value={newCallerPart}
                    onChange={(e) => setNewCallerPart(e.target.value)}
                    placeholder="Ej. Motor / Transmisión"
                    className="w-full bg-[#0a0f1d] border border-[#1e293b] rounded-lg p-2 text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1 text-[#94a3b8]">Notas y Resumen de la Conversación</label>
                <textarea
                  rows={2}
                  value={newCallerNotes}
                  onChange={(e) => setNewCallerNotes(e.target.value)}
                  placeholder="Detalles de lo conversado, urgencia, presupuesto..."
                  className="w-full bg-[#0a0f1d] border border-[#1e293b] rounded-lg p-2 text-[#f1f5f9] focus:outline-none focus:border-[#388bfd]"
                />
              </div>

              <div className="bg-[#388bfd]/10 border border-[#388bfd]/30 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <strong className="text-[#58a6ff] block text-xs">Crear Orden Directa (Método C)</strong>
                  <span className="text-[10px] text-[#94a3b8]">Abre el formulario de alta con estos datos</span>
                </div>
                <input
                  type="checkbox"
                  checked={createOrderDirectly}
                  onChange={(e) => setCreateOrderDirectly(e.target.checked)}
                  className="w-4 h-4 accent-[#388bfd] cursor-pointer"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#1e293b] mt-2">
                <button
                  type="button"
                  onClick={() => setIsRegisterCallModalOpen(false)}
                  className="px-3 py-2 rounded-lg bg-[#1e293b] text-[#94a3b8] hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#388bfd] hover:bg-[#2563eb] text-[#0a1120] font-bold"
                >
                  Guardar Llamada
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

