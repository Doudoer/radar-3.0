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
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentScreen,
  onNavigate,
  isOpen = false,
  onClose,
  isOpenMobile,
  onCloseMobile,
}) => {
  const isDrawerOpen = isOpen || isOpenMobile || false;
  const handleClose = onClose || onCloseMobile;

  const navItems: { id: NavScreen; label: string; icon: string; aliases?: NavScreen[] }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'grid_view' },
    { id: 'ordenes', label: 'Órdenes', icon: 'inventory_2', aliases: ['taller'] },
    { id: 'clientes', label: 'Clientes', icon: 'group', aliases: ['crm'] },
    { id: 'buscar_piezas', label: 'Buscar Piezas', icon: 'search', aliases: ['inventario', 'stock'] },
    { id: 'reclamos', label: 'Reclamos', icon: 'error_outline' },
    { id: 'mis_operaciones', label: 'Mis Operaciones', icon: 'assignment_ind' },
    { id: 'relacion_semanal', label: 'Relación Semanal', icon: 'domain', aliases: ['finanzas'] },
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
          className="fixed inset-0 bg-black/75 backdrop-blur-sm z-40 md:hidden"
          onClick={handleClose}
        />
      )}

      <aside
        className={`bg-[#0a1120] h-screen w-64 shrink-0 border-r border-[#16233b] flex flex-col py-5 px-3 select-none transition-transform duration-300 ease-in-out fixed md:static inset-y-0 left-0 z-50 md:z-auto ${
          isDrawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Header Logo */}
        <div className="flex items-center justify-between px-3 py-1">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-[#388bfd] shadow-[0_0_10px_#388bfd] shrink-0" />
            <h1 className="font-bold text-[#58a6ff] tracking-[0.2em] text-[15px] leading-none uppercase">
              RADAR V3
            </h1>
          </div>
          {/* Mobile close button */}
          <button
            onClick={handleClose}
            className="md:hidden text-[#94a3b8] hover:text-white p-1 rounded-lg"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Divider */}
        <div className="h-[1px] bg-[#16233b] mt-4 mb-3 w-full" />

        {/* Navigation Items List */}
        <div className="flex flex-col gap-1 flex-1 overflow-y-auto pr-1 custom-scrollbar">
          {navItems.map((item) => {
            const isActive =
              currentScreen === item.id ||
              (item.aliases && item.aliases.includes(currentScreen));

            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`w-full flex items-center gap-3.5 py-2.5 px-3 rounded-r-xl rounded-l-md text-[14px] transition-all duration-150 text-left cursor-pointer group ${
                  isActive
                    ? 'bg-[#13233c] text-[#58a6ff] border-l-[3px] border-[#388bfd] font-semibold shadow-[inset_0_0_12px_rgba(56,139,253,0.12)]'
                    : 'text-[#94a3b8] hover:text-[#f1f5f9] hover:bg-[#121c2e]/60 border-l-[3px] border-transparent font-normal'
                }`}
              >
                <span
                  className={`material-symbols-outlined text-[20px] shrink-0 transition-colors ${
                    isActive
                      ? 'text-[#58a6ff]'
                      : 'text-[#94a3b8] group-hover:text-[#cbd5e1]'
                  }`}
                >
                  {item.icon}
                </span>
                <span className="truncate tracking-wide">{item.label}</span>
              </button>
            );
          })}
        </div>
      </aside>
    </>
  );
};
