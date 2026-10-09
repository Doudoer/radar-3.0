import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../services/apiFetch';
import {
  NotificationChannelConfig,
  NotificationChannelKey,
  ExternalContact,
  OperatorContact,
  NotificationConfigResponse,
} from '../integrations/wasender/notificationTypes';

interface WasenderNotificationsManagerProps {
  userRole?: 'admin' | 'operador';
}

export const WasenderNotificationsManager: React.FC<WasenderNotificationsManagerProps> = ({
  userRole = 'admin',
}) => {
  const isSuperAdmin = userRole === 'admin';

  // Config State
  const [channels, setChannels] = useState<NotificationChannelConfig[]>([]);
  const [operators, setOperators] = useState<OperatorContact[]>([]);
  const [externalContacts, setExternalContacts] = useState<ExternalContact[]>([]);
  const [sandboxInfo, setSandboxInfo] = useState<{
    isTestMode: boolean;
    designatedTestPhone: string;
    sessionName: string;
    connectedPhone: string;
    accountName: string;
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'channels' | 'operators' | 'external' | 'simulator'>('channels');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // External Contact Modal State
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<ExternalContact | null>(null);
  const [contactForm, setContactForm] = useState<{
    name: string;
    phone: string;
    label: string;
    notes: string;
    isActive: boolean;
    subscribedChannels: NotificationChannelKey[];
  }>({
    name: '',
    phone: '',
    label: '',
    notes: '',
    isActive: true,
    subscribedChannels: ['NUEVA_VENTA', 'NUEVO_RECLAMO', 'LISTA_RECLAMOS'],
  });
  const [savingContact, setSavingContact] = useState(false);

  // Simulator State
  const [simulatorChannel, setSimulatorChannel] = useState<NotificationChannelKey>('NUEVA_VENTA');
  const [simulatorCustomText, setSimulatorCustomText] = useState('');
  const [simulatorStatus, setSimulatorStatus] = useState('Listo para Retiro');
  const [simulatorCreatorPhone, setSimulatorCreatorPhone] = useState('584145550000');
  const [simulating, setSimulating] = useState(false);
  const [simulatorResult, setSimulatorResult] = useState<any | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/wasender/notifications/config');
      if (res.ok) {
        const data: NotificationConfigResponse = await res.json();
        setChannels(data.channels || []);
        setOperators(data.operators || []);
        setExternalContacts(data.externalContacts || []);
        setSandboxInfo(data.sandboxInfo || null);
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error al cargar la configuración de notificaciones',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  // Channel update handler
  const handleToggleChannelEnabled = (key: NotificationChannelKey) => {
    setChannels((prev) =>
      prev.map((ch) => (ch.key === key ? { ...ch, isEnabled: !ch.isEnabled } : ch))
    );
  };

  const handleToggleSuperadmin = (key: NotificationChannelKey) => {
    setChannels((prev) =>
      prev.map((ch) => (ch.key === key ? { ...ch, superadminEnabled: !ch.superadminEnabled } : ch))
    );
  };

  const handleToggleOperator = (channelKey: NotificationChannelKey, operatorId: number) => {
    setChannels((prev) =>
      prev.map((ch) => {
        if (ch.key !== channelKey) return ch;
        const exists = ch.operatorIds.includes(operatorId);
        const newIds = exists
          ? ch.operatorIds.filter((id) => id !== operatorId)
          : [...ch.operatorIds, operatorId];
        return { ...ch, operatorIds: newIds };
      })
    );
  };

  const handleToggleExternalContact = (channelKey: NotificationChannelKey, contactId: number) => {
    setChannels((prev) =>
      prev.map((ch) => {
        if (ch.key !== channelKey) return ch;
        const exists = ch.externalContactIds.includes(contactId);
        const newIds = exists
          ? ch.externalContactIds.filter((id) => id !== contactId)
          : [...ch.externalContactIds, contactId];
        return { ...ch, externalContactIds: newIds };
      })
    );
  };

  const handleSaveChannelsConfig = async () => {
    if (!isSuperAdmin) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/wasender/notifications/config', {
        method: 'PUT',
        body: JSON.stringify({ channels }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error al guardar configuración');

      setFeedback({
        type: 'success',
        text: '¡Configuración de enrutamiento de notificaciones WhatsApp guardada exitosamente!',
      });
      if (data.config) {
        setChannels(data.config.channels);
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error inesperado al guardar',
      });
    } finally {
      setSaving(false);
    }
  };

  // External Contact Handlers
  const openNewContactModal = () => {
    setEditingContact(null);
    setContactForm({
      name: '',
      phone: '',
      label: '',
      notes: '',
      isActive: true,
      subscribedChannels: ['NUEVA_VENTA', 'NUEVO_RECLAMO', 'LISTA_RECLAMOS'],
    });
    setIsContactModalOpen(true);
  };

  const openEditContactModal = (contact: ExternalContact) => {
    setEditingContact(contact);
    setContactForm({
      name: contact.name,
      phone: contact.phone,
      label: contact.label || '',
      notes: contact.notes || '',
      isActive: contact.isActive,
      subscribedChannels: contact.subscribedChannels || [],
    });
    setIsContactModalOpen(true);
  };

  const handleSaveContact = async () => {
    if (!contactForm.name.trim() || !contactForm.phone.trim()) {
      setFeedback({ type: 'error', text: 'El nombre y el teléfono son obligatorios.' });
      return;
    }

    setSavingContact(true);
    try {
      if (editingContact) {
        const res = await apiFetch(`/wasender/notifications/external-contacts/${editingContact.id}`, {
          method: 'PUT',
          body: JSON.stringify(contactForm),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || 'Error al actualizar contacto');
        }
      } else {
        const res = await apiFetch('/wasender/notifications/external-contacts', {
          method: 'POST',
          body: JSON.stringify(contactForm),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || 'Error al registrar contacto');
        }
      }

      setIsContactModalOpen(false);
      setFeedback({
        type: 'success',
        text: editingContact
          ? 'Contacto externo actualizado con éxito.'
          : 'Nuevo número externo registrado con éxito.',
      });
      await fetchConfig();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error al guardar contacto',
      });
    } finally {
      setSavingContact(false);
    }
  };

  const handleDeleteContact = async (id: number) => {
    if (!window.confirm('¿Seguro que deseas eliminar este número de las notificaciones?')) return;
    try {
      const res = await apiFetch(`/wasender/notifications/external-contacts/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Error al eliminar contacto');
      setFeedback({ type: 'success', text: 'Contacto externo eliminado del sistema.' });
      await fetchConfig();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error al eliminar contacto',
      });
    }
  };

  // Simulator Handler
  const handleExecuteSimulation = async () => {
    setSimulating(true);
    setSimulatorResult(null);
    try {
      const res = await apiFetch('/wasender/notifications/dispatch-test', {
        method: 'POST',
        body: JSON.stringify({
          channelKey: simulatorChannel,
          customMessage: simulatorCustomText.trim() || undefined,
          orderStatus: simulatorStatus,
          creatorPhone: simulatorCreatorPhone.trim() || undefined,
        }),
      });
      const data = await res.json();
      setSimulatorResult(data);
    } catch (err) {
      setSimulatorResult({
        ok: false,
        skippedReason: err instanceof Error ? err.message : 'Error al simular despacho',
      });
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col gap-5">
      <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 shadow-[0_0_12px_#22d3ee]" />

      {/* Header & Sub-Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-cyan-500/15 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500/20 to-emerald-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.25)]">
              <span className="material-symbols-outlined text-[20px]">mark_chat_unread</span>
            </div>
            <div>
              <h2 className="text-base font-black text-white uppercase font-mono tracking-wider flex items-center gap-2">
                <span>Gestión de Notificaciones WhatsApp (Wasender)</span>
                <span className="text-[10px] bg-cyan-950/80 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full font-mono">
                  8 Canales Activos
                </span>
              </h2>
            </div>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Enrutamiento granular de mensajes: configura qué operadores y números externos reciben cada tipo de alerta.
          </p>
        </div>

        {/* Action Button */}
        {isSuperAdmin && activeTab === 'channels' && (
          <button
            type="button"
            onClick={handleSaveChannelsConfig}
            disabled={saving || loading}
            className="cyber-btn-primary px-4 py-2.5 text-xs font-black flex items-center gap-2 disabled:opacity-50 cursor-pointer self-start sm:self-auto shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">
              {saving ? 'sync' : 'save'}
            </span>
            <span>{saving ? 'Guardando...' : 'Guardar Configuración'}</span>
          </button>
        )}

        {isSuperAdmin && activeTab === 'external' && (
          <button
            type="button"
            onClick={openNewContactModal}
            className="cyber-btn-primary px-4 py-2.5 text-xs font-black flex items-center gap-2 cursor-pointer self-start sm:self-auto shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">person_add</span>
            <span>+ Registrar Número Externo</span>
          </button>
        )}
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex flex-wrap items-center gap-2 p-1.5 bg-[#040814] rounded-2xl border border-cyan-500/20">
        <button
          type="button"
          onClick={() => setActiveTab('channels')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'channels'
              ? 'bg-cyan-500/20 border border-cyan-400 text-white shadow-[0_0_12px_rgba(6,182,212,0.3)]'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">hub</span>
          <span>Canales de Notificación (8 Tipos)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('operators')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'operators'
              ? 'bg-cyan-500/20 border border-cyan-400 text-white shadow-[0_0_12px_rgba(6,182,212,0.3)]'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">badge</span>
          <span>Operadores Registrados ({operators.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('external')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'external'
              ? 'bg-cyan-500/20 border border-cyan-400 text-white shadow-[0_0_12px_rgba(6,182,212,0.3)]'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">contact_phone</span>
          <span>Números Externos ({externalContacts.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('simulator')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'simulator'
              ? 'bg-emerald-500/20 border border-emerald-400 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
              : 'text-slate-400 hover:text-emerald-300 hover:bg-slate-800/50'
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">play_circle</span>
          <span>Simulador & Pruebas en Vivo</span>
        </button>
      </div>

      {/* Global Feedback Banner */}
      {feedback && (
        <div
          className={`p-3 rounded-2xl text-xs font-mono flex items-center justify-between gap-2 animate-fade-in ${
            feedback.type === 'success'
              ? 'bg-emerald-950/50 border border-emerald-500/40 text-emerald-300'
              : 'bg-rose-950/50 border border-rose-500/40 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">
              {feedback.type === 'success' ? 'check_circle' : 'error'}
            </span>
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* TAB 1: NOTIFICATION CHANNELS MATRIX */}
      {activeTab === 'channels' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {channels.map((ch) => {
              const isExclusiveAdmin = ch.targetType === 'superadmin_only';
              const isDynamicCreator = ch.targetType === 'creator_dynamic';
              const isMulticast = ch.targetType === 'configurable_multicast';

              return (
                <div
                  key={ch.key}
                  className={`rounded-2xl border p-4 flex flex-col justify-between gap-3.5 transition-all ${
                    !ch.isEnabled
                      ? 'bg-[#040814]/60 border-slate-800 opacity-60'
                      : isExclusiveAdmin
                      ? 'bg-[#050b18] border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.05)]'
                      : isDynamicCreator
                      ? 'bg-[#050b18] border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.05)]'
                      : 'bg-[#050b18] border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.05)]'
                  }`}
                >
                  <div>
                    {/* Card Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            isExclusiveAdmin
                              ? 'bg-amber-500/15 border border-amber-500/30 text-amber-300'
                              : isDynamicCreator
                              ? 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-300'
                              : 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[18px]">{ch.icon || 'notifications'}</span>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-white text-xs font-mono">{ch.name}</h3>
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono">{ch.category}</span>
                        </div>
                      </div>

                      {/* Enable/Disable Channel Switch */}
                      <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          checked={ch.isEnabled}
                          onChange={() => handleToggleChannelEnabled(ch.key)}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500" />
                      </label>
                    </div>

                    {/* Rule Badge & Trigger Description */}
                    <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`text-[9.5px] font-mono font-bold px-2 py-0.5 rounded-md border ${
                          isExclusiveAdmin
                            ? 'bg-amber-950/60 border-amber-500/40 text-amber-300'
                            : isDynamicCreator
                            ? 'bg-cyan-950/60 border-cyan-500/40 text-cyan-300'
                            : 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                        }`}
                      >
                        {ch.badgeLabel}
                      </span>
                    </div>

                    <p className="mt-2 text-[11px] text-slate-300 leading-relaxed font-sans">
                      {ch.description}
                    </p>

                    {ch.triggerNotes && (
                      <div className="mt-2 p-2 rounded-xl bg-[#030610] border border-cyan-500/15 text-[10.5px] text-slate-400 font-mono flex items-start gap-1.5">
                        <span className="material-symbols-outlined text-cyan-400 text-[14px] shrink-0 mt-0.5">
                          info
                        </span>
                        <span>{ch.triggerNotes}</span>
                      </div>
                    )}
                  </div>

                  {/* Recipient Configuration Controls */}
                  {isMulticast && ch.isEnabled && (
                    <div className="pt-2 border-t border-cyan-500/15 space-y-2.5">
                      {/* Super Admin toggle */}
                      <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer bg-[#030610] p-2 rounded-lg border border-cyan-500/10">
                        <div className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-amber-400 text-[15px]">shield_person</span>
                          <span className="text-[11px] font-mono">Enviar a Super Administrador</span>
                        </div>
                        <input
                          type="checkbox"
                          checked={ch.superadminEnabled}
                          onChange={() => handleToggleSuperadmin(ch.key)}
                          className="rounded border-cyan-500/40 bg-slate-900 text-cyan-500 focus:ring-cyan-400 w-3.5 h-3.5 cursor-pointer"
                        />
                      </label>

                      {/* Selectable Operators */}
                      <div>
                        <span className="text-[10px] text-slate-400 font-mono block mb-1">
                          Operadores Registrados con Acceso:
                        </span>
                        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto custom-scrollbar p-1 bg-[#030610] rounded-lg border border-cyan-500/10">
                          {operators.map((op) => {
                            const isSelected = ch.operatorIds.includes(op.id);
                            return (
                              <button
                                key={op.id}
                                type="button"
                                onClick={() => handleToggleOperator(ch.key, op.id)}
                                className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all flex items-center gap-1 cursor-pointer ${
                                  isSelected
                                    ? 'bg-cyan-500/30 border border-cyan-400 text-white font-bold'
                                    : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                <span>{isSelected ? '✓' : '+'}</span>
                                <span className="truncate max-w-[120px]">{op.name}</span>
                                {op.phone && <span className="text-[8.5px] opacity-75">({op.phone})</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Selectable External Contacts */}
                      {externalContacts.length > 0 && (
                        <div>
                          <span className="text-[10px] text-slate-400 font-mono block mb-1">
                            Números Externos Asignados:
                          </span>
                          <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto custom-scrollbar p-1 bg-[#030610] rounded-lg border border-cyan-500/10">
                            {externalContacts.map((ext) => {
                              const isSelected = ch.externalContactIds.includes(ext.id);
                              return (
                                <button
                                  key={ext.id}
                                  type="button"
                                  onClick={() => handleToggleExternalContact(ch.key, ext.id)}
                                  className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all flex items-center gap-1 cursor-pointer ${
                                    isSelected
                                      ? 'bg-emerald-500/30 border border-emerald-400 text-emerald-200 font-bold'
                                      : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
                                  }`}
                                >
                                  <span>{isSelected ? '✓' : '+'}</span>
                                  <span className="truncate max-w-[120px]">{ext.name}</span>
                                  <span className="text-[8.5px] opacity-75">({ext.phone})</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: OPERATORS DIRECTORY */}
      {activeTab === 'operators' && (
        <div className="space-y-3">
          <div className="p-3 rounded-xl bg-[#040814] border border-cyan-500/20 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="text-slate-300 font-mono">
              👥 Directorio de operadores y números registrados en sus perfiles de usuario.
            </span>
            <span className="text-[11px] text-cyan-400 font-mono">
              Total: {operators.length} cuentas registradas
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {operators.map((op) => (
              <div
                key={op.id}
                className="p-3.5 rounded-2xl bg-[#050b18] border border-cyan-500/20 flex flex-col justify-between gap-3 shadow-inner"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-900 border border-cyan-500/30 flex items-center justify-center text-cyan-300 font-bold text-sm shrink-0 overflow-hidden">
                    {op.avatarUrl ? (
                      <img src={op.avatarUrl} alt={op.name} className="w-full h-full object-cover" />
                    ) : (
                      <span>{op.name.charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <h4 className="font-bold text-white text-xs truncate font-mono">{op.name}</h4>
                      <span
                        className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-bold uppercase ${
                          op.role === 'admin'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                        }`}
                      >
                        {op.role}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 block truncate">{op.email}</span>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[14px] text-emerald-400">call</span>
                      <span className="font-mono text-[11px] font-bold text-slate-200">
                        {op.phone || (
                          <span className="text-amber-400/80 font-normal italic">Sin teléfono asignado</span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Subscribed channels indicator */}
                <div className="pt-2 border-t border-cyan-500/10">
                  <span className="text-[9.5px] font-mono text-slate-400 block mb-1">
                    Canales configurados:
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {channels
                      .filter((ch) => ch.operatorIds.includes(op.id))
                      .map((ch) => (
                        <span
                          key={ch.key}
                          className="px-1.5 py-0.2 rounded bg-cyan-950/80 border border-cyan-500/30 text-[8.5px] font-mono text-cyan-300"
                        >
                          {ch.name}
                        </span>
                      ))}
                    {channels.filter((ch) => ch.operatorIds.includes(op.id)).length === 0 && (
                      <span className="text-[9px] font-mono text-slate-500 italic">
                        Sin canales asignados
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: EXTERNAL NUMBERS DIRECTORY */}
      {activeTab === 'external' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-xl bg-[#040814] border border-cyan-500/20 text-xs">
            <span className="text-slate-300 font-mono">
              📞 Números de teléfono externos (Gerencia, Socios, Despachadores externos) para recibir notificaciones automáticas.
            </span>
            <button
              type="button"
              onClick={openNewContactModal}
              className="px-3 py-1 rounded-lg bg-emerald-500/20 border border-emerald-400 text-emerald-300 font-mono text-xs font-bold hover:bg-emerald-500/30 cursor-pointer"
            >
              + Agregar Número
            </button>
          </div>

          {externalContacts.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs font-mono bg-[#050b18] rounded-2xl border border-cyan-500/15">
              No hay números externos registrados. Haz clic en "+ Registrar Número Externo" para añadir el primero.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {externalContacts.map((contact) => (
                <div
                  key={contact.id}
                  className="p-4 rounded-2xl bg-[#050b18] border border-emerald-500/25 flex flex-col justify-between gap-3 shadow-inner"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-bold text-white text-xs font-mono flex items-center gap-1.5">
                          <span>{contact.name}</span>
                          {contact.label && (
                            <span className="text-[9px] bg-emerald-950 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.2 rounded">
                              {contact.label}
                            </span>
                          )}
                        </h4>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="material-symbols-outlined text-emerald-400 text-[14px]">phone_iphone</span>
                          <span className="font-mono text-xs font-bold text-emerald-300">{contact.phone}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditContactModal(contact)}
                          className="p-1 rounded-lg bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
                          title="Editar"
                        >
                          <span className="material-symbols-outlined text-[15px]">edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteContact(contact.id)}
                          className="p-1 rounded-lg bg-red-950/40 text-red-400 hover:text-red-300 border border-red-500/30 cursor-pointer"
                          title="Eliminar"
                        >
                          <span className="material-symbols-outlined text-[15px]">delete</span>
                        </button>
                      </div>
                    </div>

                    {contact.notes && (
                      <p className="mt-2 text-[10.5px] text-slate-400 font-sans">{contact.notes}</p>
                    )}
                  </div>

                  {/* Subscribed channels */}
                  <div className="pt-2 border-t border-emerald-500/15">
                    <span className="text-[9.5px] font-mono text-slate-400 block mb-1">
                      Canales suscritos:
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {contact.subscribedChannels.map((cKey) => (
                        <span
                          key={cKey}
                          className="px-1.5 py-0.2 rounded bg-emerald-950/80 border border-emerald-500/30 text-[8.5px] font-mono text-emerald-300"
                        >
                          {cKey}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: SIMULATOR & LIVE DISPATCH TEST */}
      {activeTab === 'simulator' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-[#040814] border border-cyan-500/30 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-cyan-500/15 pb-3">
              <div>
                <h3 className="font-bold text-xs text-white uppercase font-mono tracking-wider flex items-center gap-2">
                  <span className="material-symbols-outlined text-emerald-400 text-[18px]">terminal</span>
                  <span>Simulador de Enrutamiento & Despacho por Canal</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Prueba en tiempo real cómo resuelve los destinatarios cada uno de los 9 tipos de mensajes y dispara una prueba real a Wasender.
                </p>
              </div>

              {sandboxInfo && (
                <span className="px-2.5 py-1 rounded-full text-[10.5px] font-mono font-bold bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 flex items-center gap-1.5 self-start sm:self-auto">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Prueba Segura: {sandboxInfo.designatedTestPhone}
                </span>
              )}
            </div>

            {/* Selector Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-mono text-slate-300 block mb-1">
                  Tipo de Mensaje / Canal:
                </label>
                <select
                  value={simulatorChannel}
                  onChange={(e) => setSimulatorChannel(e.target.value as NotificationChannelKey)}
                  className="w-full rounded-xl bg-[#080e1c] border border-cyan-500/30 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-400 font-mono"
                >
                  <option value="NUEVA_VENTA">🚀 Nueva Venta (Multidestino)</option>
                  <option value="BUSQUEDA_SUBASTAS">🚗 Búsquedas en Subastas (Super Admin)</option>
                  <option value="NUEVO_RECLAMO">⚠️ Nuevo Reclamo (Multidestino)</option>
                  <option value="SEGUIMIENTO_RECLAMO">🚨 Seguimiento de Reclamo (Multidestino)</option>
                  <option value="RESPALDO_AUTOMATICO">💾 Respaldo Automático (Super Admin)</option>
                  <option value="LISTA_RECLAMOS">📋 Lista de Reclamos (Multidestino)</option>
                  <option value="ORDEN_CANCELADA">❌ Orden Cancelada (Super Admin)</option>
                  <option value="SOLICITUD_REEMBOLSO">💸 Solicitud de Reembolso (Super Admin)</option>
                  <option value="CAMBIO_ESTATUS">🔔 Cambio de Estatus / Pieza Lista (Dinámica: Creador)</option>
                </select>
              </div>

              {simulatorChannel === 'CAMBIO_ESTATUS' && (
                <>
                  <div>
                    <label className="text-[11px] font-mono text-slate-300 block mb-1">
                      Estatus de Prueba de la Pieza:
                    </label>
                    <select
                      value={simulatorStatus}
                      onChange={(e) => setSimulatorStatus(e.target.value)}
                      className="w-full rounded-xl bg-[#080e1c] border border-cyan-500/30 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-400 font-mono"
                    >
                      <option value="Listo para Retiro">Listo para Retiro (Dispara)</option>
                      <option value="Listo para Despacho">Listo para Despacho (Dispara)</option>
                      <option value="Cotización">Cotización (Debe Omitir)</option>
                      <option value="En Proceso">En Proceso (Debe Omitir)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-mono text-slate-300 block mb-1">
                      Teléfono Operador Creador:
                    </label>
                    <input
                      type="text"
                      value={simulatorCreatorPhone}
                      onChange={(e) => setSimulatorCreatorPhone(e.target.value)}
                      placeholder="58412xxxxxxx"
                      className="w-full rounded-xl bg-[#080e1c] border border-cyan-500/30 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-400 font-mono"
                    />
                  </div>
                </>
              )}
            </div>

            <div>
              <label className="text-[11px] font-mono text-slate-300 block mb-1">
                Texto Personalizado (Opcional - dejar vacío para plantilla automática del canal):
              </label>
              <textarea
                value={simulatorCustomText}
                onChange={(e) => setSimulatorCustomText(e.target.value)}
                placeholder="Escribe un mensaje de prueba personalizado..."
                rows={2}
                className="w-full rounded-xl bg-[#080e1c] border border-cyan-500/30 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-400 font-mono"
              />
            </div>

            <button
              type="button"
              onClick={handleExecuteSimulation}
              disabled={simulating}
              className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(16,185,129,0.3)] cursor-pointer transition-all active:scale-95 disabled:opacity-50"
            >
              {simulating ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>Transmitiendo y Verificando Enrutamiento...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[16px]">send</span>
                  <span>Ejecutar Prueba de Notificación en Vivo</span>
                </>
              )}
            </button>
          </div>

          {/* Simulation Outcome Report */}
          {simulatorResult && (
            <div className="p-4 rounded-2xl bg-[#040814] border border-cyan-500/30 space-y-3 animate-fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`material-symbols-outlined text-[20px] ${
                      simulatorResult.ok ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {simulatorResult.ok ? 'check_circle' : 'info'}
                  </span>
                  <h4 className="font-bold text-xs text-white font-mono">
                    Resultado del Enrutamiento: {simulatorResult.channelName || simulatorChannel}
                  </h4>
                </div>

                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                    simulatorResult.ok
                      ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                      : 'bg-amber-950/60 border-amber-500/40 text-amber-300'
                  }`}
                >
                  {simulatorResult.ok ? 'DESPACHADO' : 'OMITIDO / REGLA'}
                </span>
              </div>

              {simulatorResult.skippedReason && (
                <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs font-mono text-amber-300 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px]">warning</span>
                  <span>{simulatorResult.skippedReason}</span>
                </div>
              )}

              {simulatorResult.recipients && simulatorResult.recipients.length > 0 && (
                <div>
                  <span className="text-[10.5px] font-mono text-slate-400 block mb-1">
                    Destinatarios Resueltos ({simulatorResult.recipients.length}):
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {simulatorResult.recipients.map((rec: any, idx: number) => (
                      <div
                        key={idx}
                        className="p-2 rounded-xl bg-[#080e1c] border border-cyan-500/20 text-[11px] font-mono flex items-center justify-between"
                      >
                        <div>
                          <span className="font-bold text-white block truncate">{rec.name}</span>
                          <span className="text-[10px] text-slate-400">{rec.roleOrLabel}</span>
                        </div>
                        <span className="text-cyan-300 font-bold">{rec.phone}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {simulatorResult.deliveryResults && simulatorResult.deliveryResults.length > 0 && (
                <div>
                  <span className="text-[10.5px] font-mono text-slate-400 block mb-1">
                    Transmisión WasenderAPI:
                  </span>
                  <div className="space-y-1.5">
                    {simulatorResult.deliveryResults.map((dr: any, idx: number) => (
                      <div
                        key={idx}
                        className={`p-2 rounded-xl border text-[11px] font-mono flex items-center justify-between ${
                          dr.success
                            ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                            : 'bg-rose-950/30 border-rose-500/30 text-rose-300'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[14px]">
                            {dr.success ? 'done_all' : 'error'}
                          </span>
                          <span>
                            {dr.name} ({dr.phone})
                          </span>
                        </div>
                        <span className="text-[10px]">
                          {dr.success
                            ? `Entregado • MsgId: ${dr.data?.data?.msgId || 'OK'}`
                            : `Error: ${dr.error}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* EXTERNAL CONTACT MODAL */}
      {isContactModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-fade-in overflow-y-auto">
          <div className="bg-[#070c18]/95 backdrop-blur-2xl border border-cyan-500/40 rounded-2xl w-full max-w-md shadow-[0_15px_50px_rgba(6,182,212,0.3)] overflow-hidden flex flex-col text-xs text-slate-300 relative my-auto">
            <div className="h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#22d3ee] absolute top-0 inset-x-0" />

            {/* Modal Header */}
            <div className="px-4 py-3 border-b border-cyan-500/20 bg-cyan-950/30 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                  <span className="material-symbols-outlined text-[18px]">person_add</span>
                </div>
                <h3 className="font-black text-white text-xs uppercase font-mono">
                  {editingContact ? 'Editar Número Externo' : 'Registrar Nuevo Número Externo'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsContactModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-3.5">
              <div>
                <label className="text-[11px] font-mono text-slate-300 block mb-1">
                  Nombre Completo / Destinatario: <span className="text-cyan-400">*</span>
                </label>
                <input
                  type="text"
                  value={contactForm.name}
                  onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                  placeholder="ej: Lic. Carlos Mendoza - Gerencia"
                  className="w-full rounded-xl bg-[#040814] border border-cyan-500/30 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-400 font-mono"
                />
              </div>

              <div>
                <label className="text-[11px] font-mono text-slate-300 block mb-1">
                  Número Telefónico (WhatsApp): <span className="text-cyan-400">*</span>
                </label>
                <input
                  type="text"
                  value={contactForm.phone}
                  onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                  placeholder="+58 412 1234567 o 04121234567"
                  className="w-full rounded-xl bg-[#040814] border border-cyan-500/30 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-400 font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[11px] font-mono text-slate-300 block mb-1">
                    Etiqueta / Rol:
                  </label>
                  <input
                    type="text"
                    value={contactForm.label}
                    onChange={(e) => setContactForm({ ...contactForm, label: e.target.value })}
                    placeholder="ej: Gerencia / Taller"
                    className="w-full rounded-xl bg-[#040814] border border-cyan-500/30 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-400 font-mono"
                  />
                </div>

                <div className="flex items-center pt-5">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={contactForm.isActive}
                      onChange={(e) => setContactForm({ ...contactForm, isActive: e.target.checked })}
                      className="rounded border-cyan-500/40 bg-slate-900 text-cyan-500 focus:ring-cyan-400 w-4 h-4 cursor-pointer"
                    />
                    <span className="text-xs font-mono text-slate-200">Contacto Activo</span>
                  </label>
                </div>
              </div>

              {/* Subscribed channels checkboxes */}
              <div>
                <label className="text-[11px] font-mono text-slate-300 block mb-1.5">
                  Canales a los que se suscribe este número:
                </label>
                <div className="space-y-1.5 bg-[#040814] p-2.5 rounded-xl border border-cyan-500/20">
                  {[
                    { key: 'NUEVA_VENTA', label: '🛒 Nueva Venta (Alerta de cobro)' },
                    { key: 'NUEVO_RECLAMO', label: '⚠️ Nuevo Reclamo (Alerta de garantía)' },
                    { key: 'LISTA_RECLAMOS', label: '📋 Lista de Reclamos (Reporte consolidado)' },
                  ].map((ch) => {
                    const isChecked = contactForm.subscribedChannels.includes(
                      ch.key as NotificationChannelKey
                    );
                    return (
                      <label key={ch.key} className="flex items-center gap-2 cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            const next = isChecked
                              ? contactForm.subscribedChannels.filter((k) => k !== ch.key)
                              : [...contactForm.subscribedChannels, ch.key as NotificationChannelKey];
                            setContactForm({ ...contactForm, subscribedChannels: next });
                          }}
                          className="rounded border-cyan-500/40 bg-slate-900 text-cyan-500 focus:ring-cyan-400 w-3.5 h-3.5 cursor-pointer"
                        />
                        <span className="font-mono text-slate-200 text-[11px]">{ch.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-mono text-slate-300 block mb-1">
                  Notas / Observaciones:
                </label>
                <textarea
                  value={contactForm.notes}
                  onChange={(e) => setContactForm({ ...contactForm, notes: e.target.value })}
                  placeholder="Información adicional..."
                  rows={2}
                  className="w-full rounded-xl bg-[#040814] border border-cyan-500/30 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-400 font-mono"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-3 border-t border-cyan-500/20 bg-[#0a1022] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsContactModalOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-[#040814] text-slate-300 hover:text-white cursor-pointer text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveContact}
                disabled={savingContact}
                className="cyber-btn-primary px-4 py-1.5 text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[15px]">
                  {savingContact ? 'sync' : 'save'}
                </span>
                <span>{savingContact ? 'Guardando...' : 'Guardar Contacto'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
