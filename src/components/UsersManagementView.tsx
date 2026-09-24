import React, { useEffect, useState } from 'react';
import { apiFetch } from '../services/apiFetch';

type ManagedUser = {
  id: number;
  name: string;
  email: string;
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
  const [draft, setDraft] = useState({ name: '', email: '', role: 'operator', active: true, permissions: [] as string[] });

  // New User State
  const [isNewUserModalOpen, setIsNewUserModalOpen] = useState(false);
  const [newUserDraft, setNewUserDraft] = useState({
    name: '',
    email: '',
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

  const saveUser = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedUser) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch(`/users/${selectedUser.id}`, {
        method: 'PUT',
        body: JSON.stringify(draft),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'No se pudo actualizar el usuario.');
      setUsersList((currentUsers) => currentUsers.map((user) => user.id === selectedUser.id ? payload : user));
      showToast(`Usuario "${payload.name}" actualizado correctamente.`);
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
        body: JSON.stringify(newUserDraft),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'No se pudo crear el usuario.');
      setUsersList((currentUsers) => [payload, ...currentUsers]);
      showToast(`Colaborador "${payload.name}" creado con éxito.`);
      setIsNewUserModalOpen(false);
      setNewUserDraft({
        name: '',
        email: '',
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
                /users
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Administración de cuentas de personal, roles, permisos y credenciales de acceso al sistema.
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
        
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#040814] text-cyan-400/80 uppercase text-[10px] tracking-wider border-b border-cyan-500/20 font-mono">
              <tr>
                <th className="py-3.5 px-4">Usuario</th>
                <th className="py-3.5 px-4">Rol en Radar</th>
                <th className="py-3.5 px-4">Departamento</th>
                <th className="py-3.5 px-4">Actualización</th>
                <th className="py-3.5 px-4">Estado</th>
                <th className="py-3.5 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cyan-500/10 text-slate-300">
              {usersList.map((user) => (
                <tr key={user.id} className="hover:bg-cyan-500/5 transition-colors">
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-2xl bg-[#040814] border border-cyan-500/30 flex items-center justify-center text-[11px] font-black text-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.25)]">
                        {user.name.split(' ').map((name) => name[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-bold text-white">{user.name}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="font-mono text-xs font-bold text-cyan-300 bg-cyan-950/60 px-2.5 py-0.5 rounded-lg border border-cyan-500/30">
                      {user.role}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-slate-300 font-medium">{user.role === 'admin' ? 'Administración' : 'Operaciones'}</td>
                  <td className="py-3.5 px-4 font-mono text-[11px] text-slate-400">{user.updated_at ? new Date(user.updated_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : 'N/A'}</td>
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
                      className="text-slate-400 hover:text-cyan-300 font-semibold cursor-pointer mr-3 transition-colors"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditor(user, 'permissions')}
                      className="text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer mr-3 transition-colors"
                    >
                      Permisos
                    </button>
                    {user.id !== currentUserId && (
                      <button
                        type="button"
                        onClick={() => void deleteUser(user)}
                        className="text-red-400 hover:text-red-300 font-semibold cursor-pointer transition-colors"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md animate-fade-in">
          <form onSubmit={saveUser} className="relative w-full max-w-lg rounded-3xl border border-cyan-500/30 bg-[#070c18]/95 backdrop-blur-2xl p-6 shadow-[0_20px_60px_rgba(0,0,0,0.8)] overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-indigo-500 shadow-[0_0_12px_#22d3ee]" />
            
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase font-mono tracking-[0.18em] text-cyan-400">{modalMode === 'edit' ? 'Editar cuenta' : 'Editar permisos'}</p>
                <h2 className="mt-1 text-lg font-bold text-white">{selectedUser.name}</h2>
                <p className="mt-1 text-xs text-slate-400">Los cambios se guardan en la base de datos.</p>
              </div>
              <button type="button" onClick={closeEditor} className="p-1 rounded-xl text-slate-400 hover:text-white hover:bg-cyan-500/20 transition-all cursor-pointer" aria-label="Cerrar">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {modalMode === 'edit' && (
              <div className="grid gap-3.5">
                <label className="text-xs text-slate-300 font-mono uppercase text-[10px]">Nombre
                  <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400" required />
                </label>
                <label className="text-xs text-slate-300 font-mono uppercase text-[10px]">Correo
                  <input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400" required />
                </label>
                <label className="text-xs text-slate-300 font-mono uppercase text-[10px]">Rol
                  <select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400">
                    <option value="operator">Operador</option>
                    <option value="admin">Administrador</option>
                  </select>
                </label>
                <label className="flex items-center gap-2.5 text-xs text-slate-300 pt-1 cursor-pointer">
                  <input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} className="h-4 w-4 accent-cyan-400 rounded cursor-pointer" />
                  <span>Cuenta activa</span>
                </label>
              </div>
            )}

            {modalMode === 'permissions' && (
              <div className="grid gap-2 sm:grid-cols-2">
                {permissionOptions.map(([permission, label]) => (
                  <label key={permission} className="flex cursor-pointer items-center gap-2 rounded-xl border border-cyan-500/20 bg-[#040814] px-3 py-2 text-xs text-slate-300 hover:border-cyan-500/50 transition-colors">
                    <input type="checkbox" checked={draft.permissions.includes(permission)} onChange={() => togglePermission(permission)} className="h-4 w-4 accent-cyan-400 rounded" />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            )}

            {error && <p className="mt-4 rounded-xl border border-red-500/40 bg-red-950/20 px-3.5 py-2 text-xs text-red-300">{error}</p>}
            <div className="mt-6 flex justify-end gap-2.5">
              <button type="button" onClick={closeEditor} className="cyber-btn-secondary px-4 py-2 text-xs font-bold">Cancelar</button>
              <button type="submit" disabled={saving} className="cyber-btn-primary px-4 py-2 text-xs font-black disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar cambios'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Crear Nuevo Colaborador */}
      {isNewUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md animate-fade-in">
          <form onSubmit={handleCreateNewUser} className="relative w-full max-w-lg rounded-3xl border border-cyan-500/30 bg-[#070c18]/95 backdrop-blur-2xl p-6 shadow-[0_20px_60px_rgba(0,0,0,0.8)] overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 shadow-[0_0_12px_#22d3ee]" />
            
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase font-mono tracking-[0.18em] text-cyan-400">Nuevo Colaborador</p>
                <h2 className="mt-1 text-lg font-bold text-white">Registrar cuenta de personal</h2>
                <p className="mt-1 text-xs text-slate-400">Crea el acceso inicial con contraseña segura de al menos 8 caracteres.</p>
              </div>
              <button type="button" onClick={() => setIsNewUserModalOpen(false)} className="p-1 rounded-xl text-slate-400 hover:text-white hover:bg-cyan-500/20 transition-all cursor-pointer" aria-label="Cerrar">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="grid gap-3.5">
              <label className="text-xs text-slate-300 font-mono uppercase text-[10px]">
                Nombre Completo
                <input
                  value={newUserDraft.name}
                  onChange={(event) => setNewUserDraft({ ...newUserDraft, name: event.target.value })}
                  placeholder="Ej. Carlos Mendoza"
                  className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400"
                  required
                />
              </label>
              <label className="text-xs text-slate-300 font-mono uppercase text-[10px]">
                Correo Electrónico
                <input
                  type="email"
                  value={newUserDraft.email}
                  onChange={(event) => setNewUserDraft({ ...newUserDraft, email: event.target.value })}
                  placeholder="usuario@empresa.com"
                  className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400"
                  required
                />
              </label>
              <div>
                <label className="text-xs text-slate-300 font-mono uppercase text-[10px]">
                  Contraseña Temporal (mínimo 8 caracteres)
                  <input
                    type="password"
                    value={newUserDraft.password}
                    onChange={(event) => setNewUserDraft({ ...newUserDraft, password: event.target.value })}
                    placeholder="••••••••"
                    className="mt-1 w-full rounded-xl border border-cyan-500/30 bg-[#040814] px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-400"
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

              <div className="mt-2">
                <p className="text-xs font-semibold text-slate-200 mb-2 font-mono uppercase text-[10px]">Permisos Asignados:</p>
                <div className="grid gap-2 sm:grid-cols-2 max-h-36 overflow-y-auto pr-1 custom-scrollbar">
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

            {error && <p className="mt-4 rounded-xl border border-red-500/40 bg-red-950/20 px-3.5 py-2 text-xs text-red-300">{error}</p>}
            <div className="mt-6 flex justify-end gap-2.5">
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
