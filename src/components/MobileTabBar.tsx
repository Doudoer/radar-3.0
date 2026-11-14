import React from 'react';
import { NavScreen } from '../types';

interface MobileTabBarProps {
  currentScreen: NavScreen;
  onNavigate: (screen: NavScreen) => void;
  onOpenNewOrder: () => void;
  onToggleMenu: () => void;
  activeOrdersCount?: number;
  pendingTasksCount?: number;
}

export const MobileTabBar: React.FC<MobileTabBarProps> = ({
  currentScreen,
  onNavigate,
  onOpenNewOrder,
  onToggleMenu,
  activeOrdersCount = 0,
  pendingTasksCount = 0,
}) => {
  const isOrdersActive = currentScreen === 'ordenes' || currentScreen === 'taller';
  const isDashboardActive = currentScreen === 'dashboard';
  const isTasksActive = currentScreen === 'mi_trabajo';
  const isClientsActive = currentScreen === 'clientes' || currentScreen === 'crm';

  return (
    <nav
      aria-label="Navegación Móvil"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[#070c18]/95 backdrop-blur-2xl border-t border-cyan-500/25 px-2 pt-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] flex items-center justify-around shadow-[0_-10px_30px_rgba(0,0,0,0.85)]"
    >
      {/* 1. Dashboard */}
      <button
        type="button"
        onClick={() => onNavigate('dashboard')}
        className={`flex flex-col items-center justify-center flex-1 py-1 transition-all active:scale-95 cursor-pointer ${
          isDashboardActive ? 'text-cyan-400 font-bold' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[22px]">space_dashboard</span>
        <span className="text-[10px] font-mono leading-tight mt-0.5">Inicio</span>
        {isDashboardActive && (
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-0.5 shadow-[0_0_6px_#22d3ee]" />
        )}
      </button>

      {/* 2. Órdenes */}
      <button
        type="button"
        onClick={() => onNavigate('ordenes')}
        className={`relative flex flex-col items-center justify-center flex-1 py-1 transition-all active:scale-95 cursor-pointer ${
          isOrdersActive ? 'text-cyan-400 font-bold' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <div className="relative flex items-center justify-center">
          <span aria-hidden="true" className="material-symbols-outlined text-[22px]">receipt_long</span>
          {activeOrdersCount > 0 && (
            <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-cyan-400 text-slate-950 font-black text-[9px] font-mono flex items-center justify-center shadow-[0_0_8px_#22d3ee]">
              {activeOrdersCount > 99 ? '99+' : activeOrdersCount}
            </span>
          )}
        </div>
        <span className="text-[10px] font-mono leading-tight mt-0.5">Órdenes</span>
        {isOrdersActive && (
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-0.5 shadow-[0_0_6px_#22d3ee]" />
        )}
      </button>

      {/* 3. CENTER ELEVATED FAB: Nueva Orden */}
      <div className="flex flex-col items-center justify-center px-1">
        <button
          type="button"
          onClick={onOpenNewOrder}
          aria-label="Crear Nueva Orden"
          className="relative -top-3.5 w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-400 via-blue-500 to-indigo-500 text-slate-950 flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.65)] border border-cyan-200/50 active:scale-90 transition-all cursor-pointer"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[28px] font-black">add</span>
        </button>
        <span className="text-[9.5px] font-mono font-bold text-cyan-300 -mt-2">Nueva</span>
      </div>

      {/* 4. Mi Trabajo */}
      <button
        type="button"
        onClick={() => onNavigate('mi_trabajo')}
        className={`relative flex flex-col items-center justify-center flex-1 py-1 transition-all active:scale-95 cursor-pointer ${
          isTasksActive ? 'text-cyan-400 font-bold' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <div className="relative flex items-center justify-center">
          <span aria-hidden="true" className="material-symbols-outlined text-[22px]">task_alt</span>
          {pendingTasksCount > 0 && (
            <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-amber-400 text-slate-950 font-black text-[9px] font-mono flex items-center justify-center shadow-[0_0_8px_#fbbf24]">
              {pendingTasksCount > 99 ? '99+' : pendingTasksCount}
            </span>
          )}
        </div>
        <span className="text-[10px] font-mono leading-tight mt-0.5">Tareas</span>
        {isTasksActive && (
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-0.5 shadow-[0_0_6px_#22d3ee]" />
        )}
      </button>

      {/* 5. Clientes o Menú Lateral */}
      <button
        type="button"
        onClick={() => onNavigate('clientes')}
        className={`flex flex-col items-center justify-center flex-1 py-1 transition-all active:scale-95 cursor-pointer ${
          isClientsActive ? 'text-cyan-400 font-bold' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[22px]">group</span>
        <span className="text-[10px] font-mono leading-tight mt-0.5">Clientes</span>
        {isClientsActive && (
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-0.5 shadow-[0_0_6px_#22d3ee]" />
        )}
      </button>

      {/* 6. Menú Hamburguesa Completo */}
      <button
        type="button"
        onClick={onToggleMenu}
        aria-label="Abrir Menú Completo"
        className="flex flex-col items-center justify-center flex-1 py-1 text-slate-400 hover:text-cyan-300 transition-all active:scale-95 cursor-pointer"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[22px]">menu</span>
        <span className="text-[10px] font-mono leading-tight mt-0.5">Más</span>
      </button>
    </nav>
  );
};

