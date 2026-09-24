import React from 'react';
import { NavScreen } from '../types';

interface SidebarProps {
  currentScreen: NavScreen;
  onNavigate: (screen: NavScreen) => void;
  onOpenNewOrder?: () => void;
  isOpen?: boolean;
  onClose?: () => void;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
  activeOrdersCount?: number;
  userRole?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentScreen,
  onNavigate,
  isOpen = false,
  onClose,
  isOpenMobile,
  onCloseMobile,
  userRole = 'operador',
}) => {
  const isDrawerOpen = isOpen || isOpenMobile || false;
  const handleClose = onClose || onCloseMobile;
  const isSuperAdmin = userRole.toLowerCase() === 'admin';

  const navItems: { id: NavScreen; label: string; icon: string; aliases?: NavScreen[] }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'grid_view' },
    { id: 'ordenes', label: 'Órdenes', icon: 'inventory_2', aliases: ['taller'] },
    { id: 'clientes', label: 'Clientes CRM', icon: 'group', aliases: ['crm'] },
    { id: 'reclamos', label: 'Reclamos', icon: 'error_outline' },
    { id: 'mis_operaciones', label: 'Mis Operaciones', icon: 'assignment_ind' },
    ...(isSuperAdmin
      ? [{ id: 'relacion_semanal' as NavScreen, label: 'Relación Semanal', icon: 'domain', aliases: ['finanzas' as NavScreen] }]
      : []),
    { id: 'sistema', label: 'Sistema', icon: 'settings', aliases: ['configuracion', 'ayuda'] },
    { id: 'usuarios', label: 'Usuarios', icon: 'manage_accounts', aliases: ['directorio'] },
  ];

  const handleNavClick = (screen: NavScreen) => {
    onNavigate(screen);
    if (handleClose) handleClose();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isDrawerOpen && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-md z-40 md:hidden"
          onClick={handleClose}
        />
      )}

      <aside
        className={`bg-[#060b17]/95 backdrop-blur-2xl h-screen w-64 shrink-0 border-r border-cyan-500/20 flex flex-col py-5 px-3 select-none transition-transform duration-300 ease-in-out fixed md:static inset-y-0 left-0 z-50 md:z-auto shadow-[10px_0_30px_rgba(0,0,0,0.6)] ${
          isDrawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Header Logo with Cyber Holographic Pulse */}
        <div className="flex items-center justify-between px-2.5 py-1">
          <div className="flex items-center gap-3">
            <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-[#0c1a30] via-[#060c18] to-[#040812] border border-cyan-400/60 flex items-center justify-center text-cyan-400 shadow-[0_0_18px_rgba(6,182,212,0.45)]">
              <div className="absolute -inset-1 rounded-xl border border-dashed border-cyan-500/30 animate-cyber-orbit pointer-events-none" />
              <span className="material-symbols-outlined text-[20px] drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]">
                radar
              </span>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="font-black text-white tracking-[0.18em] text-[15px] leading-none uppercase drop-shadow-[0_0_10px_rgba(255,255,255,0.4)]">
                  RADAR <span className="text-cyan-400 font-mono">3.0</span>
                </h1>
              </div>
              <span className="text-[9px] font-mono font-bold tracking-[0.2em] text-emerald-400 uppercase block mt-1 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399] animate-ping" />
                SISTEMA EN LÍNEA
              </span>
            </div>
          </div>

          {/* Mobile close button */}
          <button
            onClick={handleClose}
            className="md:hidden text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Laser Divider */}
        <div className="relative my-4">
          <div className="h-[1px] bg-gradient-to-r from-transparent via-cyan-500/40 to-transparent w-full" />
          <div className="absolute top-0 left-1/4 right-1/4 h-[1px] bg-cyan-400 shadow-[0_0_8px_#22d3ee]" />
        </div>

        {/* Navigation Items List */}
        <div className="flex flex-col gap-1.5 flex-1 overflow-y-auto pr-1 custom-scrollbar">
          {navItems.map((item) => {
            const isActive =
              currentScreen === item.id ||
              (item.aliases && item.aliases.includes(currentScreen));

            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`w-full flex items-center gap-3.5 py-2.5 px-3 rounded-xl text-[13.5px] transition-all duration-200 text-left cursor-pointer group relative overflow-hidden ${
                  isActive
                    ? 'bg-gradient-to-r from-cyan-500/20 via-blue-500/10 to-transparent text-cyan-300 font-bold border-l-4 border-cyan-400 shadow-[inset_0_0_15px_rgba(6,182,212,0.15)]'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-cyan-500/5 border-l-4 border-transparent font-medium'
                }`}
              >
                {isActive && (
                  <div className="absolute right-2 w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] animate-pulse" />
                )}
                <span
                  className={`material-symbols-outlined text-[20px] shrink-0 transition-all duration-200 ${
                    isActive
                      ? 'text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.8)] scale-110'
                      : 'text-slate-400 group-hover:text-cyan-300 group-hover:scale-105'
                  }`}
                >
                  {item.icon}
                </span>
                <span className="truncate tracking-wide">{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Bottom Sentinel Security Badge */}
        <div className="mt-auto pt-3 border-t border-cyan-500/15">
          <div className="bg-[#040814]/90 border border-cyan-500/20 rounded-xl p-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px] text-emerald-400">
                shield
              </span>
              <span className="text-[10px] font-mono text-slate-300 uppercase font-bold">
                {isSuperAdmin ? 'SUPER ADMIN' : 'OPERADOR'}
              </span>
            </div>
            <span className="px-2 py-0.5 rounded-md text-[9px] font-mono font-bold uppercase bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.3)]">
              ACTIVO
            </span>
          </div>
        </div>
      </aside>
    </>
  );
};
