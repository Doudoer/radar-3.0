import React, { useEffect, useState } from 'react';
import { API_URL } from '../services/apiBase';

export const UsersManagementView: React.FC = () => {
  const [usersList, setUsersList] = useState<Array<{ id: number; name: string; email: string; role: string; active: number; updated_at: string }>>([]);

  useEffect(() => {
    fetch(`${API_URL}/users`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setUsersList)
      .catch(() => setUsersList([]));
  }, []);

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
                    <button className="text-[#94a3b8] hover:text-[#f1f5f9] font-medium cursor-pointer mr-3">
                      Editar
                    </button>
                    <button className="text-[#ef4444] hover:text-[#f87171] font-medium cursor-pointer">
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
    </div>
  );
};
