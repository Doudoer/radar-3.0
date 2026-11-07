import React from 'react';
import { NavScreen } from '../types';
import { useTheme } from '../hooks/useTheme';
import { DEFAULT_AVATAR } from './UserProfileModal';

interface TopHeaderProps {
  currentScreen: NavScreen;
  selectedOrderCode?: string;
  onNavigate: (screen: NavScreen) => void;
  onOpenSearch: () => void;
  onLogout: () => void;
  onToggleMobileMenu: () => void;
  onOpenProfile?: () => void;
  onOpenChangePassword?: () => void;
  onOpenNewOrder?: () => void;
  onOpenFollowups?: () => void;
  pendingFollowupsCount?: number;
  overdueFollowupsCount?: number;
  userName?: string;
  userAvatar?: string;
  userRole?: string;
  unreadCount?: number;
}

const SCREEN_METADATA: Record<string, { title: string; category: string; icon: string }> = {
  dashboard: { title: 'Dashboard', category: 'General', icon: 'grid_view' },
  ordenes: { title: 'Lista de Órdenes', category: 'Operaciones', icon: 'inventory_2' },
  taller: { title: 'Lista de Órdenes', category: 'Operaciones', icon: 'inventory_2' },
  mi_trabajo: { title: 'Mi trabajo de hoy', category: 'Operaciones', icon: 'task_alt' },
  inventario: { title: 'Inventario & HOLD', category: 'Almacén', icon: 'sell' },
  piezas: { title: 'Inventario & HOLD', category: 'Almacén', icon: 'sell' },
  hold: { title: 'Inventario & HOLD', category: 'Almacén', icon: 'sell' },
  clientes: { title: 'Clientes CRM', category: 'Comercial', icon: 'group' },
  crm: { title: 'Clientes CRM', category: 'Comercial', icon: 'group' },
  reclamos: { title: 'Reclamos', category: 'Atención', icon: 'error_outline' },
  reembolsos: { title: 'Reembolsos', category: 'Finanzas', icon: 'currency_exchange' },
  mis_operaciones: { title: 'Mis Operaciones', category: 'Operaciones', icon: 'assignment_ind' },
  relacion_semanal: { title: 'Relación Semanal', category: 'Finanzas & Nómina', icon: 'domain' },
  finanzas: { title: 'Relación Semanal', category: 'Finanzas & Nómina', icon: 'domain' },
  sistema: { title: 'Sistema', category: 'Administración', icon: 'settings' },
  configuracion: { title: 'Sistema', category: 'Administración', icon: 'settings' },
  ayuda: { title: 'Sistema', category: 'Administración', icon: 'help_outline' },
  usuarios: { title: 'Usuarios', category: 'Seguridad', icon: 'manage_accounts' },
  directorio: { title: 'Usuarios', category: 'Seguridad', icon: 'manage_accounts' },
  'order-detail': { title: 'Detalle de Orden', category: 'Operaciones', icon: 'receipt_long' },
};

export const TopHeader: React.FC<TopHeaderProps> = ({
  currentScreen,
  selectedOrderCode,
  onNavigate,
  onOpenSearch,
  onLogout,
  onToggleMobileMenu,
  onOpenProfile,
  onOpenChangePassword,
  onOpenNewOrder,
  onOpenFollowups,
  pendingFollowupsCount = 0,
  overdueFollowupsCount = 0,
  userName = 'Usuario Administrador',
  userAvatar,
  userRole,
}) => {
  const { toggleTheme, isDark } = useTheme();

  const meta = SCREEN_METADATA[currentScreen] || {
    title: 'Radar',
    category: 'Sistema',
    icon: 'radar',
  };

  const isOrderDetail = currentScreen === 'order-detail' && Boolean(selectedOrderCode);
  const displayTitle = isOrderDetail ? selectedOrderCode! : meta.title;
  const displayCategory = isOrderDetail ? 'Orden' : meta.category;
  const displayIcon = isOrderDetail ? 'receipt_long' : meta.icon;

  const handleProfileClick = () => {
    if (onOpenProfile) {
      onOpenProfile();
    } else if (onOpenChangePassword) {
      onOpenChangePassword();
    }
  };

  return (
    <header className="horizon-topbar sticky top-0 z-30 shrink-0 w-full flex justify-between items-center px-4 sm:px-6 lg:px-8 transition-all gap-4">
      {/* Left: Mobile Menu Toggle & Brand */}
      <div className="flex md:hidden items-center gap-2.5">
        <button
          type="button"
          onClick={onToggleMobileMenu}
          className="text-[var(--text-secondary)] hover:text-cyan-400 p-2 rounded-xl hover:bg-[var(--bg-card)] transition-colors cursor-pointer"
          aria-label="Abrir menú"
        >
          <span className="material-symbols-outlined text-[24px]">menu</span>
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-sm">
            <span className="material-symbols-outlined text-[18px]">{displayIcon}</span>
          </div>
          <span className="font-bold text-sm text-[var(--text-heading)] truncate">{displayTitle}</span>
        </div>
      </div>

      {/* Left: Desktop Breadcrumb & Title */}
      <div className="horizon-header-title hidden md:flex items-center gap-3.5 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/15 via-blue-500/10 to-indigo-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.18)] shrink-0">
          <span className="material-symbols-outlined text-[22px]">{displayIcon}</span>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)] leading-none mb-1">
            <button
              type="button"
              onClick={() => onNavigate('dashboard')}
              className="hover:text-cyan-400 transition-colors cursor-pointer flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[13px] text-cyan-400">radar</span>
              <span>Radar</span>
            </button>
            <span className="text-[var(--text-tertiary)] opacity-60">/</span>
            <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 font-mono text-[10px] border border-cyan-500/20">
              {displayCategory}
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl lg:text-2xl font-black text-[var(--text-heading)] tracking-tight truncate">
              {displayTitle}
            </h1>
          </div>
        </div>
      </div>

      {/* Right Side: Command Island with Search, Actions & Profile */}
      <div className="horizon-header-tools flex items-center gap-2 sm:gap-2.5 min-w-0">
        {/* Spotlight Query Search Bar */}
        <div className="horizon-header-search hidden lg:block relative w-48 2xl:w-64 group">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-cyan-400/80 text-[18px] group-hover:text-cyan-300 transition-colors pointer-events-none drop-shadow-[0_0_6px_rgba(34,211,238,0.4)]">
            search
          </span>
          <input
            type="text"
            onClick={onOpenSearch}
            readOnly
            aria-label="Búsqueda global"
            placeholder="Buscar en Radar..."
            className="w-full py-2 pl-9 pr-12 cursor-pointer transition-all"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
            <kbd className="font-mono text-[9px] font-bold border border-cyan-500/30 rounded-md px-1.5 py-0.5 bg-[var(--bg-card)] text-cyan-300 shadow-sm">
              ⌘K
            </kbd>
          </div>
        </div>

        {/* Mobile Search Icon Button */}
        <button
          type="button"
          onClick={onOpenSearch}
          className="lg:hidden p-2 text-[var(--text-secondary)] hover:text-cyan-400 hover:bg-[var(--bg-primary)] rounded-xl transition-colors cursor-pointer"
          aria-label="Buscar"
          title="Buscar en Radar"
        >
          <span className="material-symbols-outlined text-[20px]">search</span>
        </button>

        {/* Theme Toggle Button */}
        <button
          type="button"
          onClick={toggleTheme}
          title={isDark ? 'Cambiar a Modo Claro' : 'Cambiar a Modo Oscuro'}
          className="horizon-icon-button hover:rotate-12 transition-transform cursor-pointer"
          aria-label={isDark ? 'Activar modo claro' : 'Activar modo oscuro'}
        >
          <span className="material-symbols-outlined text-[19px]">
            {isDark ? 'light_mode' : 'dark_mode'}
          </span>
        </button>

        {/* Post-Delivery Followup Badge & Modal Opener */}
        {onOpenFollowups && (
          <button
            type="button"
            onClick={onOpenFollowups}
            title="Seguimiento de órdenes · Mi trabajo de hoy"
            aria-label={`Mi trabajo de hoy${pendingFollowupsCount ? `: ${pendingFollowupsCount} pendientes` : ''}`}
            className={`relative inline-flex items-center gap-1.5 py-1.5 px-2.5 sm:px-3 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer active:scale-95 ${
              overdueFollowupsCount > 0
                ? 'bg-rose-500/20 border border-rose-500/60 text-rose-300 hover:bg-rose-500/30 shadow-[0_0_15px_rgba(244,63,94,0.3)] animate-pulse'
                : pendingFollowupsCount > 0
                ? 'bg-amber-500/15 border border-amber-500/50 text-amber-300 hover:bg-amber-500/25 shadow-[0_0_12px_rgba(245,158,11,0.2)]'
                : 'bg-[var(--bg-primary)] border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/15 shadow-sm'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">phone_in_talk</span>
            <span className="sr-only">Seguimiento</span>
            {pendingFollowupsCount > 0 && (
              <span
                className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-black rounded-full shadow-sm ${
                  overdueFollowupsCount > 0 ? 'bg-rose-500 text-white' : 'bg-amber-400 text-slate-950'
                }`}
              >
                {pendingFollowupsCount}
              </span>
            )}
          </button>
        )}

        {/* New Order CTA */}
        {onOpenNewOrder && (
          <button
            type="button"
            onClick={onOpenNewOrder}
            aria-label="Nueva Orden"
            className="hidden sm:inline-flex items-center gap-1.5 py-2 px-3.5 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-primary-600 hover:from-blue-500 hover:to-primary-500 text-white text-xs font-bold transition-all cursor-pointer shadow-[0_0_18px_rgba(79,70,229,0.35)] active:scale-95 hover:shadow-indigo-500/40"
          >
            <span className="material-symbols-outlined text-[17px]">add_circle</span>
            <span>Nueva Orden</span>
          </button>
        )}

        {/* Divider */}
        <div className="h-6 w-px bg-[var(--border-subtle)] mx-0.5" />

        {/* User Profile Pill */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleProfileClick}
            title="Mi Perfil y Seguridad (Click para editar)"
            className="flex items-center gap-2.5 pl-1.5 pr-2.5 py-1 bg-[var(--bg-primary)]/80 border border-cyan-500/30 rounded-xl hover:border-cyan-400 hover:bg-[var(--bg-primary)] transition-all cursor-pointer group shadow-sm"
          >
            <div className="relative w-7 h-7 rounded-lg overflow-hidden border border-cyan-400/50 shadow-[0_0_8px_rgba(34,211,238,0.3)] shrink-0 bg-slate-800">
              <img
                src={userAvatar || DEFAULT_AVATAR}
                alt={userName}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = DEFAULT_AVATAR;
                }}
              />
              <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-[var(--bg-card)]" />
            </div>
            <div className="hidden xl:flex flex-col text-left">
              <span className="text-xs text-[var(--text-primary)] font-bold group-hover:text-cyan-400 transition-colors leading-tight">
                {userName}
              </span>
              {userRole && (
                <span className="text-[9px] font-mono font-bold text-cyan-400 uppercase tracking-wider">
                  {userRole === 'admin' ? 'Super Admin' : 'Operador'}
                </span>
              )}
            </div>
            <span className="material-symbols-outlined text-[16px] text-cyan-400/70 group-hover:text-cyan-300 transition-transform group-hover:translate-y-0.5">
              expand_more
            </span>
          </button>

          {/* Logout Button */}
          <button
            type="button"
            onClick={onLogout}
            title="Cerrar sesión segura"
            aria-label="Cerrar sesión"
            className="w-9 h-9 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 transition-all cursor-pointer flex items-center justify-center shadow-sm active:scale-95"
          >
            <span className="material-symbols-outlined text-[17px]">logout</span>
          </button>
        </div>
      </div>
    </header>
  );
};
