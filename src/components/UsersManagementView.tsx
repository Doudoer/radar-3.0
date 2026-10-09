import React, { useEffect, useState } from 'react';
import { apiFetch } from '../services/apiFetch';
import { PRESET_AVATARS, DEFAULT_AVATAR } from './UserProfileModal';

type ManagedUser = {
  id: number;
  name: string;
  email: string;
  phone?: string;
  avatar_url?: string;
  role: string;
  permissions: string[];
  active: number;
  updated_at: string;
};

const permissionOptions = [
  ['orders:view', 'Consultar órdenes'],
  ['orders:edit', 'Editar órdenes'],
  ['customers:view', 'Consultar clientes'],
  ['customers:edit', 'Editar clientes'],
  ['claims:view', 'Consultar reclamos'],
  ['claims:manage', 'Gestionar reclamos'],
  ['reports:view', 'Consultar reportes'],
  ['users:manage', 'Gestionar usuarios'],
  ['settings:manage', 'Gestionar configuración'],
] as const;

interface UsersManagementViewProps {
  currentUserId?: number;
}

export const UsersManagementView: React.FC<UsersManagementViewProps> = ({ currentUserId }) => {
  const [usersList, setUsersList] = useState<ManagedUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);
  const [modalMode, setModalMode] = useState<'edit' | 'permissions' | null>(null);
  const [draft, setDraft] = useState({
    name: '',
    email: '',
    phone: '',
    avatar_url: '',
    password: '',
    role: 'operator',
    active: true,
    permissions: [] as string[],
  });

  // New User State
  const [isNewUserModalOpen, setIsNewUserModalOpen] = useState(false);
  const [newUserDraft, setNewUserDraft] = useState({
    name: '',
    email: '',
    phone: '',
    avatar_url: DEFAULT_AVATAR,
    password: '',
    role: 'operator' as 'operator' | 'admin',
    active: true,
    permissions: ['orders:view', 'orders:edit', 'customers:view', 'claims:view'] as string[],
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const fetchUsers = () => {
    apiFetch('/users')
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then(setUsersList)
      .catch(() => setUsersList([]));
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const openEditor = (user: ManagedUser, mode: 'edit' | 'permissions') => {
    setSelectedUser(user);
    setModalMode(mode);
    setError(null);
    setDraft({
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      avatar_url: user.avatar_url || DEFAULT_AVATAR,
      password: '',
      role: user.role,
      active: Boolean(user.active),
      permissions: user.permissions || [],
    });
  };

  const closeEditor = () => {
    if (saving) return;
    setSelectedUser(null);
    setModalMode(null);
    setError(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, isNew: boolean) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('La imagen no debe superar los 2MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        if (isNew) {
          setNewUserDraft((prev) => ({ ...prev, avatar_url: reader.result as string }));
        } else {
          setDraft((prev) => ({ ...prev, avatar_url: reader.result as string }));
        }
        setError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const saveUser = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedUser) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, any> = {
        name: draft.name.trim(),
        email: draft.email.trim().toLowerCase(),
        phone: draft.phone.trim() || null,
        avatar_url: draft.avatar_url.trim() || null,
        role: draft.role,
        active: draft.active,
        permissions: draft.permissions,
      };

      if (draft.password.trim()) {
        payload.password = draft.password.trim();
      }

      const response = await apiFetch(`/users/${selectedUser.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'No se pudo actualizar el usuario.');
      setUsersList((currentUsers) => currentUsers.map((user) => (user.id === selectedUser.id ? data : user)));
      showToast(`Usuario "${data.name}" actualizado correctamente.`);
      closeEditor();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No se pudo actualizar el usuario.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateNewUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify({
          name: newUserDraft.name.trim(),
          email: newUserDraft.email.trim().toLowerCase(),
          phone: newUserDraft.phone.trim() || null,
          avatar_url: newUserDraft.avatar_url.trim() || null,
          password: newUserDraft.password,
          role: newUserDraft.role,
          active: newUserDraft.active,
          permissions: newUserDraft.permissions,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'No se pudo crear el usuario.');
      setUsersList((currentUsers) => [payload, ...currentUsers]);
      showToast(`Colaborador "${payload.name}" creado con éxito.`);
      setIsNewUserModalOpen(false);
      setNewUserDraft({
        name: '',
        email: '',
        phone: '',
        avatar_url: DEFAULT_AVATAR,
        password: '',
        role: 'operator',
        active: true,
        permissions: ['orders:view', 'orders:edit', 'customers:view', 'claims:view'],
      });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'No se pudo crear el usuario.');
    } finally {
      setSaving(false);
    }
  };

  const togglePermission = (permission: string) => {
    setDraft((currentDraft) => ({
      ...currentDraft,
      permissions: currentDraft.permissions.includes(permission)
        ? currentDraft.permissions.filter((item) => item !== permission)
        : [...currentDraft.permissions, permission],
    }));
  };

  const toggleNewUserPermission = (permission: string) => {
    setNewUserDraft((currentDraft) => ({
      ...currentDraft,
      permissions: currentDraft.permissions.includes(permission)
        ? currentDraft.permissions.filter((item) => item !== permission)
        : [...currentDraft.permissions, permission],
    }));
  };

  const deleteUser = async (user: ManagedUser) => {
    if (user.id === currentUserId) return;
    if (!window.confirm(`¿Eliminar al usuario ${user.name}? Esta acción desactivará su cuenta y lo retirará del listado.`)) return;
    setError(null);
    try {
      const response = await apiFetch(`/users/${user.id}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'No se pudo eliminar el usuario.');
      setUsersList((currentUsers) => currentUsers.filter((currentUser) => currentUser.id !== user.id));
      showToast(`Usuario "${user.name}" desactivado.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'No se pudo eliminar el usuario.');
    }
  };

  return (
    <div className="radar-view space-y-6">
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 bg-emerald-400 text-slate-950 font-black text-xs py-2.5 px-4 rounded-2xl shadow-[0_0_25px_rgba(16,185,129,0.5)] flex items-center gap-2 animate-bounce border border-emerald-300">
          <span className="material-symbols-outlined text-[18px]">verified</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Cyber Header Card */}
      <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-indigo-500 shadow-[0_0_12px_#22d3ee]" />

        <div className="flex items-center gap-3.5">
          <div className="relative w-12 h-12 rounded-2xl bg-[#040814] border border-cyan-500/40 text-cyan-300 flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.3)] shrink-0">
            <span className="material-symbols-outlined text-[26px]">manage_accounts</span>
            <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">Gestión de Usuarios y Accesos</h1>
              <span className="text-[11px] font-mono font-bold bg-cyan-950/60 text-cyan-300 border border-cyan-500/30 px-2.5 py-0.5 rounded-full shadow-[0_0_8px_rgba(6,182,212,0.25)]">
                Super Admin
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Administración integral de cuentas de colaboradores, teléfonos, correos, fotos de perfil y permisos.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setIsNewUserModalOpen(true);
            }}
            className="cyber-btn-primary px-4 py-2.5 text-xs font-black flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">person_add</span>
            <span>Nuevo Colaborador</span>
          </button>
        </div>
      </div>

      {/* Users Table */}
      <div className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.6)]">
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#22d3ee]" />

        <div className="table-responsive-wrapper custom-scrollbar">
          <table className="w-full text-left text-xs min-w-[760px]">
            <thead className="bg-[#040814] text-cyan-400/80 uppercase text-[10px] tracking-wider border-b border-cyan-500/20 font-mono">
              <tr>
                <th className="py-3.5 px-4">Colaborador / Perfil</th>
                <th className="py-3.5 px-4">Contacto Directo</th>
                <th className="py-3.5 px-4">Rol & Permisos</th>
                <th className="py-3.5 px-4">Última Actualización</th>
                <th className="py-3.5 px-4">Estado</th>
                <th className="py-3.5 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cyan-500/10 text-slate-300">
              {usersList.map((user) => (
                <tr key={user.id} className="hover:bg-cyan-500/5 transition-colors">
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl overflow-hidden bg-[#040814] border border-cyan-500/40 shadow-[0_0_10px_rgba(6,182,212,0.25)] shrink-0">
                        <img
                          src={user.avatar_url || DEFAULT_AVATAR}
                          alt={user.name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = DEFAULT_AVATAR;
                          }}
                        />
                      </div>
                      <div>
                        <div className="font-bold text-white text-sm">{user.name}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="space-y-0.5">
                      <div className="font-mono text-[11.5px] text-cyan-300 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px] text-cyan-400">phone</span>
                        <span>{user.phone || 'Sin registrar'}</span>
                      </div>
                      <div className="font-mono text-[10.5px] text-slate-400">
                        {user.email}
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-xs font-bold px-2.5 py-0.5 rounded-lg border ${
                        user.role === 'admin'
                          ? 'bg-purple-950/70 border-purple-500/40 text-purple-300'
                          : 'bg-cyan-950/60 border-cyan-500/30 text-cyan-300'
                      }`}>
                        {user.role === 'admin' ? 'Super Admin' : 'Operador'}
                      </span>
                      <span className="text-[10.5px] font-mono text-slate-400">
                        ({user.permissions?.length || 0} permisos)
                      </span>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-[11px] text-slate-400">
                    {user.updated_at ? new Date(user.updated_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : 'N/A'}
                  </td>
                  <td className="py-3.5 px-4">
                    <span className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 w-fit ${user.active ? 'neon-badge-emerald' : 'neon-badge-red'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${user.active ? 'bg-emerald-400' : 'bg-red-400'}`} />
                      {user.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => openEditor(user, 'edit')}
                      className="text-slate-400 hover:text-cyan-300 font-semibold cursor-pointer mr-3 transition-colors text-xs"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditor(user, 'permissions')}
                      className="text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer mr-3 transition-colors text-xs"
                    >
                      Permisos
                    </button>
                    {user.id !== currentUserId && (
                      <button
                        type="button"
                        onClick={() => void deleteUser(user)}
                        className="text-red-400 hover:text-red-300 font-semibold cursor-pointer transition-colors text-xs"
                      >
                        Eliminar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {usersList.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-400 font-mono">No hay usuarios disponibles en radar_db.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Editar Usuario / Permisos */}
      {selectedUser && modalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-4 backdrop-blur-md animate-fade-in">
          <form onSubmit={saveUser} className="relative w-full max-w-lg max-h-[min(94vh,720px)] flex flex-col rounded-3xl border border-cyan-500/30 bg-[#070c18]/95 backdrop-blur-2xl p-5 sm:p-6 shadow-[0_20px_60px_rgba(0,0,0,0.8)] overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-indigo-500 shadow-[0_0_12px_#22d3ee]" />

            <div className="mb-4 flex items-start justify-between gap-4 shrink-0">
              <div>
                <p className="text-[10px] font-bold uppercase font-mono tracking-[0.18em] text-cyan-400">
                  {modalMode === 'edit' ? 'Editar cuenta de usuario' : 'Editar permisos de acceso'}
                </p>
                <h2 className="mt-1 text-lg font-bold text-white">{selectedUser.name}</h2>
                <p className="mt-1 text-xs text-slate-400">Modifica datos de perfil, teléfono, avatar y credenciales.</p>
              </div>
              <button type="button" onClick={closeEditor} className="p-1 rounded-xl text-slate-400 hover:text-white hover:bg-cyan-500/20 transition-all cursor-pointer" aria-label="Cerrar">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1 space-y-3.5">
              {modalMode === 'edit' && (
                <>
                  {/* Avatar Picker */}
                  <div className="p-3 bg-[#040814] border border-cyan-500/25 rounded-2xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono uppercase text-slate-300 font-bold">Avatar de Perfil</span>
                      <label className="text-[10.5px] font-mono text-cyan-400 hover:text-cyan-200 cursor-pointer flex items-center gap-1">
                        <span className="material-symbols-outlined text-[13px]">upload</span>
                        <span>Subir</span>
                        <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, false)} className="hidden" />
                      </label>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl overflow-hidden border border-cyan-400 shadow-[0_0_10px_#22d3ee] bg-slate-900 shrink-0">
                        <img src={draft.avatar_url || DEFAULT_AVATAR} alt="Avatar" className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 flex flex-wrap gap-1.5">
                        {PRESET_AVATARS.slice(0, 6).map((av) => (
                          <button
                            key={av.id}
                            type="button"
                            onClick={() => setDraft({ ...draft, avatar_url: av.url })}
                            className={`w-7 h-7 rounded-lg overflow-hidden border transition-all cursor-pointer ${
                              draft.avatar_url === av.url ? 'border-cyan-400 scale-105 ring-1 ring-cyan-400' : 'border-slate-700 opacity-60 hover:opacity-100'
                            }`}
                          >
                            <img src={av.url} alt={av.label} className="w-full h-full object-cover" />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <label className="text-xs text-slate-300 font-mono uppercase text-[10px] block">
                    Nombre Completo
                    <input
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400"
                      required
                    />
                  </label>

                  <label className="text-xs text-slate-300 font-mono uppercase text-[10px] block">
                    Correo Electrónico
                    <input
                      type="email"
                      value={draft.email}
                      onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                      className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400 font-mono"
                      required
                    />
                  </label>

                  <label className="text-xs text-slate-300 font-mono uppercase text-[10px] block">
                    Teléfono / WhatsApp
                    <input
                      type="tel"
                      value={draft.phone}
                      onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
                      placeholder="Ej. +1 (919) 555-0199"
                      className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400 font-mono"
                    />
                  </label>

                  <label className="text-xs text-slate-300 font-mono uppercase text-[10px] block">
                    Restablecer Contraseña (opcional)
                    <input
                      type="password"
                      value={draft.password}
                      onChange={(event) => setDraft({ ...draft, password: event.target.value })}
                      placeholder="Dejar en blanco para mantener la actual"
                      className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400 font-mono"
                    />
                  </label>

                  <label className="text-xs text-slate-300 font-mono uppercase text-[10px] block">
                    Rol
                    <select
                      value={draft.role}
                      onChange={(event) => setDraft({ ...draft, role: event.target.value })}
                      className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400"
                    >
                      <option value="operator">Operador / Vendedor</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </label>

                  <label className="flex items-center gap-2.5 text-xs text-slate-300 pt-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.active}
                      onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
                      className="h-4 w-4 accent-cyan-400 rounded cursor-pointer"
                    />
                    <span>Cuenta activa</span>
                  </label>
                </>
              )}

              {modalMode === 'permissions' && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {permissionOptions.map(([permission, label]) => (
                    <label key={permission} className="flex cursor-pointer items-center gap-2 rounded-xl border border-cyan-500/20 bg-[#040814] px-3 py-2 text-xs text-slate-300 hover:border-cyan-500/50 transition-colors">
                      <input
                        type="checkbox"
                        checked={draft.permissions.includes(permission)}
                        onChange={() => togglePermission(permission)}
                        className="h-4 w-4 accent-cyan-400 rounded"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {error && <p className="mt-4 rounded-xl border border-red-500/40 bg-red-950/20 px-3.5 py-2 text-xs text-red-300 shrink-0">{error}</p>}
            <div className="mt-4 pt-3 border-t border-cyan-500/20 flex justify-end gap-2.5 shrink-0">
              <button type="button" onClick={closeEditor} className="cyber-btn-secondary px-4 py-2 text-xs font-bold">Cancelar</button>
              <button type="submit" disabled={saving} className="cyber-btn-primary px-4 py-2 text-xs font-black disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Crear Nuevo Colaborador */}
      {isNewUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-4 backdrop-blur-md animate-fade-in">
          <form onSubmit={handleCreateNewUser} className="relative w-full max-w-lg max-h-[min(94vh,740px)] flex flex-col rounded-3xl border border-cyan-500/30 bg-[#070c18]/95 backdrop-blur-2xl p-5 sm:p-6 shadow-[0_20px_60px_rgba(0,0,0,0.8)] overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 shadow-[0_0_12px_#22d3ee]" />

            <div className="mb-4 flex items-start justify-between gap-4 shrink-0">
              <div>
                <p className="text-[10px] font-bold uppercase font-mono tracking-[0.18em] text-cyan-400">Nuevo Colaborador</p>
                <h2 className="mt-1 text-lg font-bold text-white">Registrar cuenta de personal</h2>
                <p className="mt-1 text-xs text-slate-400">Crea el acceso con perfil completo, avatar, teléfono y contraseña segura.</p>
              </div>
              <button type="button" onClick={() => setIsNewUserModalOpen(false)} className="p-1 rounded-xl text-slate-400 hover:text-white hover:bg-cyan-500/20 transition-all cursor-pointer" aria-label="Cerrar">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="grid gap-3 flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
              {/* Avatar Selector */}
              <div className="p-3 bg-[#040814] border border-cyan-500/25 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase text-slate-300 font-bold">Avatar Inicial</span>
                  <label className="text-[10.5px] font-mono text-cyan-400 hover:text-cyan-200 cursor-pointer flex items-center gap-1">
                    <span className="material-symbols-outlined text-[13px]">upload</span>
                    <span>Subir Foto</span>
                    <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, true)} className="hidden" />
                  </label>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl overflow-hidden border border-cyan-400 shadow-[0_0_10px_#22d3ee] bg-slate-900 shrink-0">
                    <img src={newUserDraft.avatar_url || DEFAULT_AVATAR} alt="Avatar" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 flex flex-wrap gap-1.5">
                    {PRESET_AVATARS.slice(0, 6).map((av) => (
                      <button
                        key={av.id}
                        type="button"
                        onClick={() => setNewUserDraft({ ...newUserDraft, avatar_url: av.url })}
                        className={`w-7 h-7 rounded-lg overflow-hidden border transition-all cursor-pointer ${
                          newUserDraft.avatar_url === av.url ? 'border-cyan-400 scale-105 ring-1 ring-cyan-400' : 'border-slate-700 opacity-60 hover:opacity-100'
                        }`}
                      >
                        <img src={av.url} alt={av.label} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <label className="text-xs text-slate-300 font-mono uppercase text-[10px]">
                Nombre Completo *
                <input
                  value={newUserDraft.name}
                  onChange={(event) => setNewUserDraft({ ...newUserDraft, name: event.target.value })}
                  placeholder="Ej. Carlos Mendoza"
                  className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400"
                  required
                />
              </label>

              <label className="text-xs text-slate-300 font-mono uppercase text-[10px]">
                Correo Electrónico *
                <input
                  type="email"
                  value={newUserDraft.email}
                  onChange={(event) => setNewUserDraft({ ...newUserDraft, email: event.target.value })}
                  placeholder="carlos@empresa.com"
                  className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400 font-mono"
                  required
                />
              </label>

              <label className="text-xs text-slate-300 font-mono uppercase text-[10px]">
                Teléfono / WhatsApp
                <input
                  type="tel"
                  value={newUserDraft.phone}
                  onChange={(event) => setNewUserDraft({ ...newUserDraft, phone: event.target.value })}
                  placeholder="+1 (919) 555-0122"
                  className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400 font-mono"
                />
              </label>

              <div>
                <label className="text-xs text-slate-300 font-mono uppercase text-[10px]">
                  Contraseña de Acceso (mínimo 8 caracteres) *
                  <input
                    type="password"
                    value={newUserDraft.password}
                    onChange={(event) => setNewUserDraft({ ...newUserDraft, password: event.target.value })}
                    placeholder="••••••••"
                    className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400 font-mono"
                    required
                    minLength={8}
                  />
                </label>
                {newUserDraft.password.length > 0 && (
                  <div className="mt-2.5 p-3 bg-[#040814] border border-cyan-500/20 rounded-2xl space-y-1.5 text-[10px]">
                    {[
                      { label: '8+ caracteres', met: newUserDraft.password.length >= 8 },
                      { label: 'Mayúscula (A-Z)', met: /[A-Z]/.test(newUserDraft.password) },
                      { label: 'Minúscula (a-z)', met: /[a-z]/.test(newUserDraft.password) },
                      { label: 'Dígito (0-9)', met: /[0-9]/.test(newUserDraft.password) },
                      { label: 'Signo o punto (. ! @ # etc.)', met: /[^a-zA-Z0-9]/.test(newUserDraft.password) },
                    ].map((item, i) => (
                      <div key={i} className={`flex items-center gap-1.5 ${item.met ? 'text-emerald-400' : 'text-slate-500'}`}>
                        <span className="material-symbols-outlined text-[14px]">{item.met ? 'check_circle' : 'radio_button_unchecked'}</span>
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <label className="text-xs text-slate-300 font-mono uppercase text-[10px]">
                Rol en el Sistema
                <select
                  value={newUserDraft.role}
                  onChange={(event) => setNewUserDraft({ ...newUserDraft, role: event.target.value as 'operator' | 'admin' })}
                  className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400"
                >
                  <option value="operator">Operador / Vendedor</option>
                  <option value="admin">Administrador</option>
                </select>
              </label>

              <div className="mt-1">
                <p className="text-xs font-semibold text-slate-200 mb-2 font-mono uppercase text-[10px]">Permisos Asignados:</p>
                <div className="grid gap-2 sm:grid-cols-2 max-h-32 overflow-y-auto pr-1 custom-scrollbar">
                  {permissionOptions.map(([permission, label]) => (
                    <label key={permission} className="flex cursor-pointer items-center gap-2 rounded-xl border border-cyan-500/20 bg-[#040814] px-3 py-1.5 text-[11px] text-slate-300 hover:border-cyan-500/50 transition-colors">
                      <input
                        type="checkbox"
                        checked={newUserDraft.permissions.includes(permission)}
                        onChange={() => toggleNewUserPermission(permission)}
                        className="h-3.5 w-3.5 accent-cyan-400 rounded"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {error && <p className="mt-4 rounded-xl border border-red-500/40 bg-red-950/20 px-3.5 py-2 text-xs text-red-300 shrink-0">{error}</p>}
            <div className="mt-4 pt-3 border-t border-cyan-500/20 flex justify-end gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsNewUserModalOpen(false)}
                className="cyber-btn-secondary px-4 py-2 text-xs font-bold"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={
                  saving ||
                  newUserDraft.password.length < 8 ||
                  !/[A-Z]/.test(newUserDraft.password) ||
                  !/[a-z]/.test(newUserDraft.password) ||
                  !/[0-9]/.test(newUserDraft.password) ||
                  !/[^a-zA-Z0-9]/.test(newUserDraft.password)
                }
                className="cyber-btn-primary px-4 py-2 text-xs font-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Creando...' : 'Crear Colaborador'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
