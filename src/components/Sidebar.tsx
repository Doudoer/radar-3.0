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
  const normalizedRole = userRole.toLowerCase();
  const isSuperAdmin = normalizedRole === 'admin';
  const roleLabel = isSuperAdmin ? 'SUPER ADMIN' : normalizedRole === 'vendedor_yarda' ? 'VENDEDOR YARDA' : 'OPERADOR';

  const navItems: { id: NavScreen; label: string; icon: string; aliases?: NavScreen[] }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'grid_view' },
    { id: 'ordenes', label: 'Lista de Órdenes', icon: 'inventory_2', aliases: ['taller'] },
    { id: 'mi_trabajo', label: 'Mi trabajo de hoy', icon: 'task_alt' },
    { id: 'inventario', label: 'Inventario & HOLD', icon: 'sell', aliases: ['piezas', 'hold'] },
    { id: 'clientes', label: 'Clientes CRM', icon: 'group', aliases: ['crm'] },
    { id: 'reclamos', label: 'Reclamos', icon: 'error_outline' },
    { id: 'reembolsos', label: 'Reembolsos', icon: 'currency_exchange' },
    { id: 'mis_operaciones', label: 'Mis Operaciones', icon: 'assignment_ind' },
    ...(isSuperAdmin
      ? [{ id: 'relacion_semanal' as NavScreen, label: 'Relación Semanal', icon: 'domain', aliases: ['finanzas' as NavScreen] }]
      : []),
    ...(isSuperAdmin
      ? [
          { id: 'sistema' as NavScreen, label: 'Sistema', icon: 'settings', aliases: ['configuracion' as NavScreen, 'ayuda' as NavScreen] },
          { id: 'usuarios' as NavScreen, label: 'Usuarios', icon: 'manage_accounts', aliases: ['directorio' as NavScreen] },
        ]
      : []),
  ];
  const adminNavIds = new Set<NavScreen>(['relacion_semanal', 'sistema', 'usuarios']);
  const navGroups = [
    { label: 'Operación', items: navItems.filter((item) => !adminNavIds.has(item.id)) },
    { label: 'Administración', items: navItems.filter((item) => adminNavIds.has(item.id)) },
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
          className="horizon-drawer-backdrop fixed inset-0 bg-black/80 backdrop-blur-md z-40 md:hidden"
          onClick={handleClose}
        />
      )}

      <aside
        aria-label="Navegación principal"
        className={`horizon-sidebar h-screen h-[100dvh] w-60 lg:w-64 shrink-0 flex flex-col py-6 px-4 select-none transition-transform duration-300 ease-in-out fixed md:static inset-y-0 left-0 z-50 md:z-auto ${
          isDrawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="flex items-center justify-between px-2 py-2">
          <div className="flex items-center gap-2.5">
            <div className="horizon-brand-mark w-10 h-10 rounded-2xl flex items-center justify-center shrink-0">
              <span aria-hidden="true" className="material-symbols-outlined text-[24px]">
                radar
              </span>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <p className="font-black text-white tracking-tight text-xl leading-none uppercase">
                  RADAR <span className="text-cyan-400">3.0</span>
                </p>
              </div>
              <span className="text-[9px] font-bold tracking-wider text-slate-400 uppercase mt-1.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                SISTEMA EN LÍNEA
              </span>
            </div>
          </div>

          {/* Mobile close button */}
          <button
            onClick={handleClose}
            aria-label="Cerrar menú"
            className="md:hidden text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="horizon-sidebar-divider my-6" />
        <div className="horizon-nav-groups flex-1 overflow-y-auto custom-scrollbar">
          {navGroups.map(group => (
            <nav key={group.label} aria-label={group.label} className="horizon-nav-group">
              <p className="horizon-nav-label">{group.label}</p>
              {group.items.map((item) => {
                const isActive =
                  currentScreen === item.id ||
                  (item.aliases && item.aliases.includes(currentScreen));

                return (
                  <button
                    key={item.id}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => handleNavClick(item.id)}
                    onMouseEnter={() => {
                      if (item.id === 'usuarios') {
                        void import('./UsersManagementView');
                      }
                    }}
                    className="horizon-nav-item w-full flex items-center gap-3 py-3 px-3 rounded-xl text-[13px] transition-colors text-left cursor-pointer group relative"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[21px] shrink-0">
                      {item.icon}
                    </span>
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          ))}
        </div>

        <div className="mt-auto pt-4">
          <div className="horizon-sidebar-account rounded-2xl p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-emerald-400">
                shield
              </span>
              <span className="text-[9.5px] font-mono text-slate-300 uppercase font-bold">
                {roleLabel}
              </span>
            </div>
            <span className="px-1.5 py-0.5 rounded text-[8.5px] font-mono font-bold uppercase bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 shadow-[0_0_6px_rgba(16,185,129,0.3)]">
              ACTIVO
            </span>
          </div>
        </div>
      </aside>
    </>
  );
};
