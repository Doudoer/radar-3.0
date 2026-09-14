import React from 'react';

interface SystemSettingsViewProps {
  carpartEnabled?: boolean;
  onToggleCarpartEnabled?: (enabled: boolean) => void;
  userRole?: 'admin' | 'operador';
}

export const SystemSettingsView: React.FC<SystemSettingsViewProps> = ({
  carpartEnabled = true,
  onToggleCarpartEnabled,
  userRole = 'admin',
}) => {
  return (
    <div className="flex flex-col gap-6 animate-fade-in max-w-7xl mx-auto">
      <div className="bg-[#111827]/80 p-5 rounded-xl border border-[#1e293b] backdrop-blur-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[#58a6ff] text-[26px]">settings</span>
            <h1 className="text-xl font-bold text-[#f1f5f9] tracking-tight">Configuración del Sistema (Radar Core)</h1>
          </div>
          <p className="text-xs text-[#94a3b8] mt-1">
            Parámetros globales de la plataforma, control de módulos de prospección y roles de usuario.
          </p>
        </div>

      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Module Control: Car-Part Scraper & VIN Decoder */}
        <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-[#f1f5f9] flex items-center gap-2">
              <span className="material-symbols-outlined text-[#388bfd] text-[18px]">search_check</span>
              <span>Módulo Buscar Piezas (Car-Part & VIN)</span>
            </h3>
            {onToggleCarpartEnabled && (
              <button
                onClick={() => onToggleCarpartEnabled(!carpartEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                  carpartEnabled ? 'bg-[#10b981]' : 'bg-[#334155]'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    carpartEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            )}
          </div>
          <p className="text-xs text-[#94a3b8]">
            Habilita o pausa el acceso global al motor de prospección de autopartes y decodificador de VIN para los operadores.
          </p>
          <div className="flex flex-col gap-2.5 text-xs bg-[#090d16] p-3 rounded-xl border border-[#1e293b]">
            <div className="flex justify-between items-center">
              <span className="text-[#94a3b8]">Estado del Módulo:</span>
              <span
                className={`font-bold flex items-center gap-1.5 ${
                  carpartEnabled ? 'text-[#10b981]' : 'text-[#f59e0b]'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    carpartEnabled ? 'bg-[#10b981]' : 'bg-[#f59e0b]'
                  }`}
                />
                {carpartEnabled ? 'Activo para Toda la Empresa' : 'Pausado (Solo Super Admin)'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[#94a3b8]">Arquitectura de Extracción:</span>
              <span className="font-mono text-[#58a6ff]">Dual (Extensión Chrome + Puppeteer)</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[#94a3b8]">Cola Concurrente VPS:</span>
              <span className="font-mono text-[#cbd5e1]">Máximo 2 Sesiones / 30s Timeout</span>
            </div>
          </div>
        </div>

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
              <span className="text-[#10b981] font-semibold">Conectado (Sesión Activa)</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-[#1e293b]">
              <span className="text-[#94a3b8]">NHTSA VIN Decoder API</span>
              <span className="text-[#10b981] font-semibold">Sincronizado</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-[#1e293b]">
              <span className="text-[#94a3b8]">Car-Part Scraper Service</span>
              <span className="text-[#10b981] font-semibold">Operativo (Puppeteer Stealth)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
