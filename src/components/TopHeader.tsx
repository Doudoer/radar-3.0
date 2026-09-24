import React from 'react';
import { NavScreen } from '../types';

interface TopHeaderProps {
  currentScreen: NavScreen;
  selectedOrderCode?: string;
  onNavigate: (screen: NavScreen) => void;
  onOpenSearch: () => void;
  onLogout: () => void;
  onToggleMobileMenu: () => void;
  onOpenChangePassword?: () => void;
  onOpenNewOrder?: () => void;
  userName?: string;
  unreadCount?: number;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  currentScreen,
  selectedOrderCode,
  onNavigate,
  onOpenSearch,
  onLogout,
  onToggleMobileMenu,
  onOpenChangePassword,
  onOpenNewOrder,
  userName = 'Usuario Administrador',
}) => {
  return (
    <header className="sticky top-0 z-30 shrink-0 w-full h-16 bg-[#060a16]/92 border-b border-cyan-500/25 backdrop-blur-2xl flex justify-between items-center px-4 md:px-6 transition-all duration-300 relative shadow-[0_4px_30px_rgba(0,0,0,0.6)]">
      {/* Bottom Laser Line */}
      <div className="absolute bottom-0 inset-x-0 h-[1.5px] bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 shadow-[0_0_10px_#22d3ee]" />

      {/* Left: Mobile Menu Toggle & Brand (Hidden on Desktop) */}
      <div className="flex md:hidden items-center gap-3">
        <button
          onClick={onToggleMobileMenu}
          className="text-slate-300 hover:text-cyan-400 p-2 rounded-xl hover:bg-slate-800/60 transition-colors cursor-pointer"
          aria-label="Abrir menú"
        >
          <span className="material-symbols-outlined text-[24px]">menu</span>
        </button>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] animate-pulse" />
          <span className="font-black text-white text-[15px] tracking-wider uppercase">RADAR 3.0</span>
        </div>
      </div>

      {/* Center/Left Desktop: Search Bar */}
      <div className="hidden md:flex items-center gap-6 flex-1 max-w-2xl">
        {/* Terminal Query Search Bar */}
        <div className="relative w-full max-w-md group">
          <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-cyan-400/70 text-[19px] group-focus-within:text-cyan-300 transition-colors pointer-events-none drop-shadow-[0_0_6px_rgba(34,211,238,0.5)]">
            search
          </span>
          <input
            type="text"
            onClick={onOpenSearch}
            readOnly
            placeholder="Buscar órdenes, clientes, piezas, VIN..."
            className="w-full bg-[#040814]/90 border border-cyan-500/25 rounded-2xl py-2 pl-10 pr-14 text-[13px] text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/30 transition-all cursor-pointer shadow-[inset_0_0_15px_rgba(0,0,0,0.6)] hover:border-cyan-500/40"
          />
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
            <kbd className="font-mono text-[10px] border border-cyan-500/30 rounded px-1.5 py-0.5 bg-[#0a1426] text-cyan-300 shadow-[0_0_6px_rgba(6,182,212,0.2)]">
              ⌘K
            </kbd>
          </div>
        </div>

        {/* Selected Order Breadcrumb if viewing detail */}
        {currentScreen === 'order-detail' && selectedOrderCode && (
          <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-xl bg-cyan-500/10 border border-cyan-400/30 text-xs font-mono text-cyan-300">
            <span>ÓRDEN:</span>
            <strong className="text-white font-bold">{selectedOrderCode}</strong>
          </div>
        )}
      </div>

      {/* Right Side: Actions & Profile */}
      <div className="flex items-center gap-3">
        {/* New Order CTA */}
        {onOpenNewOrder && (
          <button
            type="button"
            onClick={onOpenNewOrder}
            className="hidden sm:inline-flex items-center gap-1.5 py-1.5 px-3.5 rounded-xl text-xs font-black tracking-wide bg-gradient-to-r from-cyan-400 via-blue-500 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 shadow-[0_0_20px_rgba(6,182,212,0.4)] transition-all cursor-pointer active:scale-95"
          >
            <span className="material-symbols-outlined text-[17px]">add_circle</span>
            <span>Nueva Orden</span>
          </button>
        )}

        {/* Mobile Search Icon Button */}
        <button
          onClick={onOpenSearch}
          className="md:hidden p-2 text-slate-300 hover:text-cyan-400 hover:bg-slate-800/60 rounded-xl transition-colors cursor-pointer"
          aria-label="Buscar"
        >
          <span className="material-symbols-outlined text-[20px]">search</span>
        </button>

        {/* User Profile Pill */}
        <div className="flex items-center gap-2 pl-2 border-l border-cyan-500/20">
          <button
            type="button"
            onClick={onOpenChangePassword}
            title="Cambiar contraseña y perfil de seguridad"
            className="flex items-center gap-2.5 pl-2 pr-3.5 py-1.5 bg-[#050c18]/90 border border-cyan-500/30 rounded-2xl hover:border-cyan-400 hover:bg-[#09152b] transition-all cursor-pointer group shadow-[0_0_15px_rgba(6,182,212,0.15)]"
          >
            <div className="w-7 h-7 rounded-xl overflow-hidden border border-cyan-400/50 shadow-[0_0_10px_rgba(34,211,238,0.4)] shrink-0 bg-slate-800">
              <img
                src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80"
                alt="Usuario"
                className="w-full h-full object-cover"
              />
            </div>
            <span className="hidden xl:inline-block text-[13px] text-slate-200 font-semibold group-hover:text-cyan-300">
              {userName}
            </span>
            <span className="material-symbols-outlined text-[16px] text-cyan-400/70 group-hover:text-cyan-300">
              key
            </span>
          </button>

          {/* Logout Button */}
          <button
            type="button"
            onClick={onLogout}
            title="Cerrar sesión segura"
            className="p-2 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-300 hover:text-red-200 text-xs font-semibold transition cursor-pointer flex items-center justify-center shadow-[0_0_12px_rgba(239,68,68,0.15)]"
          >
            <span className="material-symbols-outlined text-[18px]">logout</span>
          </button>
        </div>
      </div>
    </header>
  );
};
