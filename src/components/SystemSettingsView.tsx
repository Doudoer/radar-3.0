import React, { useState } from 'react';
import { apiFetch } from '../services/apiFetch';

interface SystemSettingsViewProps {
  userRole?: 'admin' | 'operador';
}

export const SystemSettingsView: React.FC<SystemSettingsViewProps> = ({
  userRole = 'admin',
}) => {
  const [backupState, setBackupState] = useState<'idle' | 'loading' | 'error'>('idle');

  const downloadBackup = async () => {
    setBackupState('loading');
    try {
      const response = await apiFetch('/system/backup');
      if (!response.ok) throw new Error('No se pudo generar el respaldo.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || 'radar-v3-backup.sql';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setBackupState('idle');
    } catch {
      setBackupState('error');
    }
  };

  return (
    <div className="radar-view">
      <div className="radar-view-header flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[#58a6ff] text-[26px]">settings</span>
            <h1 className="text-xl font-bold text-[#f1f5f9] tracking-tight">Configuración del Sistema (Radar Core)</h1>
          </div>
          <p className="text-xs text-[#94a3b8] mt-1">
            Parámetros globales de la plataforma, seguridad y roles de usuario.
          </p>
        </div>

      </div>

      {userRole === 'admin' && (
        <div className="radar-panel flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold text-[#f1f5f9]">
                <span className="material-symbols-outlined text-[20px] text-[#58a6ff]">database</span>
                Respaldo total de la base de datos
              </h2>
              <p className="mt-1 text-xs text-[#94a3b8]">Incluye estructura y datos de órdenes, clientes, reclamos, usuarios y todas las tablas activas.</p>
            </div>
            <button
              type="button"
              onClick={() => void downloadBackup()}
              disabled={backupState === 'loading'}
              className="mt-2 inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#388bfd] px-4 py-2 text-xs font-bold text-[#07111f] transition hover:bg-[#58a6ff] disabled:cursor-not-allowed disabled:opacity-50 sm:mt-0"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              {backupState === 'loading' ? 'Generando respaldo...' : 'Descargar respaldo SQL'}
            </button>
          </div>
          {backupState === 'error' && <p className="text-xs text-[#fca5a5]">No se pudo generar el respaldo. Verifica la conexión de base de datos e inténtalo nuevamente.</p>}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Database & Server Health */}
        <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl p-5 flex flex-col gap-4">
          <h3 className="font-bold text-sm text-[#f1f5f9] flex items-center gap-2">
            <span className="material-symbols-outlined text-[#388bfd] text-[18px]">dns</span>
            <span>Conexión de Base de Datos y Servidor</span>
          </h3>
          <div className="flex flex-col gap-3 text-xs">
            <div className="flex justify-between items-center py-2 border-b border-[#1e293b]">
              <span className="text-[#94a3b8]">Estado del Servidor</span>
              <span className="text-[#10b981] font-semibold flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#10b981]" />
                En Línea (Cloud Run Container)
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-[#1e293b]">
              <span className="text-[#94a3b8]">Puerto Activo</span>
              <span className="font-mono text-[#cbd5e1]">3000 (Reverse Proxy SSL)</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-[#1e293b]">
              <span className="text-[#94a3b8]">Latencia Media</span>
              <span className="font-mono text-[#58a6ff]">18 ms</span>
            </div>
          </div>
        </div>

        {/* Security & MFA */}
        <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl p-5 flex flex-col gap-4">
          <h3 className="font-bold text-sm text-[#f1f5f9] flex items-center gap-2">
            <span className="material-symbols-outlined text-[#388bfd] text-[18px]">security</span>
            <span>Seguridad & Permisos</span>
          </h3>
          <div className="flex flex-col gap-3 text-xs">
            <div className="flex justify-between items-center py-2 border-b border-[#1e293b]">
              <span className="text-[#94a3b8]">Autenticación Multifactor (MFA)</span>
              <span className="text-[#10b981] font-semibold">Activado para Administradores</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-[#1e293b]">
              <span className="text-[#94a3b8]">Encriptación en Reposo</span>
              <span className="text-[#cbd5e1]">AES-256 GCM</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-[#1e293b]">
              <span className="text-[#94a3b8]">Auditoría en Tiempo Real</span>
              <span className="text-[#10b981] font-semibold">Habilitada</span>
            </div>
          </div>
        </div>

        {/* Wasender & API Integrations */}
        <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl p-5 flex flex-col gap-4">
          <h3 className="font-bold text-sm text-[#f1f5f9] flex items-center gap-2">
            <span className="material-symbols-outlined text-[#388bfd] text-[18px]">hub</span>
            <span>Integraciones Externas & Mensajería</span>
          </h3>
          <div className="flex flex-col gap-3 text-xs">
            <div className="flex justify-between items-center py-2 border-b border-[#1e293b]">
              <span className="text-[#94a3b8]">Wasender Gateway (WhatsApp)</span>
              <span className="text-[#f59e0b] font-semibold">Preparado (configurable)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
