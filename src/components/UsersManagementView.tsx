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
  ['calls:manage', 'Gestionar llamadas'],
  ['reports:view', 'Consultar reportes'],
  ['users:manage', 'Gestionar usuarios'],
  ['settings:manage', 'Gestionar configuración'],
] as const;

export const UsersManagementView: React.FC = () => {
  const [usersList, setUsersList] = useState<ManagedUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);
  const [modalMode, setModalMode] = useState<'edit' | 'permissions' | null>(null);
  const [draft, setDraft] = useState({ name: '', email: '', role: 'operator', active: true, permissions: [] as string[] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/users')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setUsersList)
      .catch(() => setUsersList([]));
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
      closeEditor();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No se pudo actualizar el usuario.');
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

  return (
    <div className="flex flex-col gap-6 animate-fade-in max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#111827]/80 p-5 rounded-xl border border-[#1e293b] backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[#58a6ff] text-[26px]">manage_accounts</span>
            <h1 className="text-xl font-bold text-[#f1f5f9] tracking-tight">Gestión de Usuarios y Accesos</h1>
          </div>
          <p className="text-xs text-[#94a3b8] mt-1">
            Administración de cuentas de personal, roles, permisos y credenciales de acceso al sistema.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button className="bg-[#388bfd] hover:bg-[#2563eb] text-[#0a1120] font-bold text-xs py-2 px-4 rounded-lg flex items-center gap-2 transition-all cursor-pointer shadow-[0_0_12px_rgba(56,139,253,0.3)]">
            <span className="material-symbols-outlined text-[18px]">person_add</span>
            <span>Nuevo Colaborador</span>
          </button>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#0b1329] text-[#94a3b8] uppercase text-[10px] tracking-wider border-b border-[#1e293b]">
              <tr>
                <th className="py-3 px-4">Usuario</th>
                <th className="py-3 px-4">Rol en Radar</th>
                <th className="py-3 px-4">Departamento</th>
                <th className="py-3 px-4">Último Acceso</th>
                <th className="py-3 px-4">Estado</th>
                <th className="py-3 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e293b] text-[#cbd5e1]">
              {usersList.map((user) => (
                <tr key={user.id} className="hover:bg-[#1e293b]/40 transition-colors">
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#388bfd]/15 border border-[#388bfd]/30 flex items-center justify-center text-[11px] font-bold text-[#58a6ff]">
                        {user.name.split(' ').map((name) => name[0]).join('').slice(0, 2)}
                      </div>
                      <div>
                        <div className="font-semibold text-[#f1f5f9]">{user.name}</div>
                        <div className="text-[11px] text-[#94a3b8]">{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="font-medium text-[#58a6ff] bg-[#388bfd]/10 px-2 py-0.5 rounded border border-[#388bfd]/25">
                      {user.role}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-[#cbd5e1]">{user.role === 'admin' ? 'Administración' : 'Operaciones'}</td>
                  <td className="py-3.5 px-4 font-mono text-[11px] text-[#94a3b8]">{new Date(user.updated_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td className="py-3.5 px-4">
                    <span className="text-[10px] text-[#10b981] font-semibold bg-[#10b981]/15 px-2 py-0.5 rounded border border-[#10b981]/30 flex items-center gap-1 w-fit">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                      {user.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => openEditor(user, 'edit')}
                      className="text-[#94a3b8] hover:text-[#f1f5f9] font-medium cursor-pointer mr-3"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditor(user, 'permissions')}
                      className="text-[#ef4444] hover:text-[#f87171] font-medium cursor-pointer"
                    >
                      Permisos
                    </button>
                  </td>
                </tr>
              ))}
              {usersList.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[#94a3b8]">No hay usuarios disponibles en radar_db.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedUser && modalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <form onSubmit={saveUser} className="w-full max-w-lg rounded-2xl border border-[#263653] bg-[#0f172a] p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#58a6ff]">{modalMode === 'edit' ? 'Editar cuenta' : 'Editar permisos'}</p>
                <h2 className="mt-1 text-lg font-bold text-[#f1f5f9]">{selectedUser.name}</h2>
                <p className="mt-1 text-xs text-[#94a3b8]">Los cambios se guardan en la base de datos.</p>
              </div>
              <button type="button" onClick={closeEditor} className="text-[#94a3b8] hover:text-white" aria-label="Cerrar">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {modalMode === 'edit' && (
              <div className="grid gap-3">
                <label className="text-xs text-[#cbd5e1]">Nombre<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="mt-1 w-full rounded-lg border border-[#263653] bg-[#080d19] px-3 py-2 text-sm text-white outline-none focus:border-[#388bfd]" required /></label>
                <label className="text-xs text-[#cbd5e1]">Correo<input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} className="mt-1 w-full rounded-lg border border-[#263653] bg-[#080d19] px-3 py-2 text-sm text-white outline-none focus:border-[#388bfd]" required /></label>
                <label className="text-xs text-[#cbd5e1]">Rol<select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} className="mt-1 w-full rounded-lg border border-[#263653] bg-[#080d19] px-3 py-2 text-sm text-white outline-none focus:border-[#388bfd]"><option value="operator">Operador</option><option value="admin">Administrador</option></select></label>
                <label className="flex items-center gap-2 text-xs text-[#cbd5e1]"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} className="h-4 w-4 accent-[#388bfd]" /> Cuenta activa</label>
              </div>
            )}

            {modalMode === 'permissions' && (
              <div className="grid gap-2 sm:grid-cols-2">
                {permissionOptions.map(([permission, label]) => (
                  <label key={permission} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#1e293b] bg-[#080d19] px-3 py-2 text-xs text-[#cbd5e1] hover:border-[#388bfd]/60">
                    <input type="checkbox" checked={draft.permissions.includes(permission)} onChange={() => togglePermission(permission)} className="h-4 w-4 accent-[#388bfd]" />
                    {label}
                  </label>
                ))}
              </div>
            )}

            {error && <p className="mt-4 rounded-lg border border-[#ef4444]/30 bg-[#ef4444]/10 px-3 py-2 text-xs text-[#fca5a5]">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={closeEditor} className="rounded-lg border border-[#263653] px-4 py-2 text-xs font-semibold text-[#cbd5e1] hover:bg-[#1e293b]">Cancelar</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-[#388bfd] px-4 py-2 text-xs font-bold text-[#07111f] disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar cambios'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
