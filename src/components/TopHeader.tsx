import React from 'react';
import { NavScreen } from '../types';

interface TopHeaderProps {
  currentScreen: NavScreen;
  onNavigate: (screen: NavScreen) => void;
  onOpenSearch: () => void;
  onOpenNotifications: () => void;
  onOpenHistory: () => void;
  onToggleMobileMenu: () => void;
  unreadCount?: number;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  currentScreen,
  onNavigate,
  onOpenSearch,
  onOpenNotifications,
  onOpenHistory,
  onToggleMobileMenu,
  unreadCount = 3,
}) => {
  return (
    <header className="sticky top-0 z-30 shrink-0 w-full h-16 bg-[#0a1120]/95 border-b border-[#16233b] backdrop-blur-md flex justify-between items-center px-4 md:px-6 transition-all duration-300">
      {/* Left: Mobile Menu Toggle & Brand (Hidden on Desktop) */}
      <div className="flex md:hidden items-center gap-3">
        <button
          onClick={onToggleMobileMenu}
          className="text-[#c2c6d6] hover:text-[#adc6ff] p-1.5 rounded-lg hover:bg-[#31353f]/50 transition-colors cursor-pointer"
          aria-label="Abrir menú"
        >
          <span className="material-symbols-outlined text-[24px]">menu</span>
        </button>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-[#388bfd] shadow-[0_0_8px_#388bfd]" />
          <span className="font-bold text-[#58a6ff] text-[16px] tracking-wider uppercase">RADAR V2</span>
        </div>
      </div>

      {/* Center/Left Desktop: Context Links & Search Bar */}
      <div className="hidden md:flex items-center gap-6 flex-1 max-w-3xl">
        {/* Search Bar */}
        <div className="relative w-full max-w-md group">
          <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[#c2c6d6] text-[18px] group-focus-within:text-[#4d8eff] transition-colors pointer-events-none">
            search
          </span>
          <input
            type="text"
            onClick={onOpenSearch}
            readOnly
            placeholder="Buscar órdenes, clientes, piezas..."
            className="w-full bg-[#0a0e17] border border-[rgba(255,255,255,0.08)] rounded-full py-1.5 pl-10 pr-14 text-[13px] text-[#dfe2ef] placeholder:text-[#c2c6d6]/60 focus:outline-none focus:border-[#4d8eff]/60 focus:ring-1 focus:ring-[#4d8eff]/60 transition-all cursor-pointer shadow-inner"
          />
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 pointer-events-none opacity-60">
            <kbd className="font-data-mono text-[10px] border border-[rgba(255,255,255,0.15)] rounded px-1 bg-[#31353f]/80 text-[#c2c6d6]">
              ⌘
            </kbd>
            <kbd className="font-data-mono text-[10px] border border-[rgba(255,255,255,0.15)] rounded px-1 bg-[#31353f]/80 text-[#c2c6d6]">
              K
            </kbd>
          </div>
        </div>
      </div>

      {/* Right Side: Trailing Actions */}
      <div className="flex items-center gap-2">
        {/* Mobile Search Button */}
        <button
          onClick={onOpenSearch}
          className="md:hidden p-2 text-[#c2c6d6] hover:text-[#adc6ff] hover:bg-[#31353f]/50 rounded-full transition-colors cursor-pointer"
          aria-label="Buscar"
        >
          <span className="material-symbols-outlined text-[20px]">search</span>
        </button>

        {/* Notificaciones Pill Button */}
        <button
          onClick={onOpenNotifications}
          className="hidden sm:flex items-center gap-1.5 bg-[#adc6ff]/10 text-[#adc6ff] border border-[#adc6ff]/25 hover:bg-[#adc6ff]/20 font-body-sm text-[13px] rounded-full py-1 px-3.5 transition-all cursor-pointer shadow-[0_0_10px_rgba(77,142,255,0.15)]"
        >
          <span className="w-2 h-2 rounded-full bg-[#4d8eff] animate-pulse" />
          <span>Notificaciones</span>
          {unreadCount > 0 && (
            <span className="ml-0.5 text-[11px] font-data-mono font-semibold bg-[#4d8eff] text-[#00285d] px-1.5 rounded-full">
              {unreadCount}
            </span>
          )}
        </button>

        {/* Icon Action Buttons */}
        <div className="flex items-center gap-1 md:border-l border-[rgba(255,255,255,0.08)] md:pl-3 ml-1">
          <button
            onClick={onOpenNotifications}
            className="p-2 text-[#c2c6d6] hover:text-[#adc6ff] hover:bg-[#31353f]/50 rounded-full transition-all duration-200 relative cursor-pointer"
            title="Alertas & Notificaciones"
          >
            <span className="material-symbols-outlined text-[20px]">notifications</span>
            {unreadCount > 0 && (
              <span className="absolute top-2 right-2 w-2 h-2 bg-[#ef4444] rounded-full ring-2 ring-[#0f131c]" />
            )}
          </button>

          <button
            onClick={onOpenHistory}
            className="p-2 text-[#c2c6d6] hover:text-[#adc6ff] hover:bg-[#31353f]/50 rounded-full transition-all duration-200 cursor-pointer"
            title="Historial de Auditoría"
          >
            <span className="material-symbols-outlined text-[20px]">history</span>
          </button>

          {/* User Profile Pill */}
          <div className="flex items-center gap-2 pl-2 pr-3 py-1 bg-[#1c1f29]/80 border border-[rgba(255,255,255,0.08)] rounded-full hover:border-[#adc6ff]/40 transition-colors ml-1 cursor-pointer">
            <div className="w-6 h-6 rounded-full overflow-hidden border border-[rgba(255,255,255,0.15)] shrink-0">
              <img
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuCfNwUngK43UCstlkPA-MEV8fWnymADHhVe1b8wB-DtIJm8JQ-NL1v-6X4X2XUvkZr26Qx57UkNBun9zZzdraF0ztNLn9aNrTlsVGiNNbAg91EafQE-tJG3P_rrxXJgimduPeKuCtBm05Uj2Dt5111IqGG_-I2tnWnbgob7acuPw_Rnl7pISKzZEjtbImC4uy-zJLObeuI-ysYeEzGxVnEiSMugRHsT8Q7OcgE4Q7-zyEPgcYb2rzT6"
                alt="Usuario"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80';
                }}
              />
            </div>
            <span className="hidden xl:inline-block font-body-sm text-[13px] text-[#dfe2ef] font-medium">
              Usuario Administrador
            </span>
          </div>
        </div>
      </div>
    </header>
  );
};
