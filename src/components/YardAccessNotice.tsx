import React from 'react';

interface YardAccessNoticeProps {
  userName?: string;
  userRole?: string;
  onLogout: () => void;
}

export const YardAccessNotice: React.FC<YardAccessNoticeProps> = ({ userName, userRole, onLogout }) => (
  <main className="min-h-screen min-h-[100dvh] bg-[#070b14] text-slate-100 flex items-center justify-center px-5 py-10 font-sans antialiased">
    <div className="w-full max-w-md rounded-2xl border-2 border-amber-500/60 bg-amber-950/90 px-5 py-6 shadow-[0_0_30px_rgba(245,158,11,0.25)] space-y-4">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="material-symbols-outlined text-[30px] text-amber-400">agriculture</span>
        <div>
          <p className="font-mono font-black text-xs uppercase tracking-widest text-amber-300">Radar Yarda</p>
          <h1 className="text-lg font-black text-white leading-tight">Acceso de patio restringido</h1>
        </div>
      </div>

      <p className="text-sm text-amber-100/90 leading-relaxed">
        Tu rol no tiene permiso para usar la cola de patio. Este portal es solo para administración y vendedores de yarda.
      </p>

      <div className="rounded-xl border border-amber-500/40 bg-slate-950/60 px-3.5 py-3 text-[11px] font-mono text-amber-200 space-y-1">
        <p>Usuario: <strong>{userName || 'Sin identificar'}</strong></p>
        <p>Rol actual: <strong>{userRole || 'No registrado'}</strong></p>
      </div>

      <p className="text-xs text-amber-200/80 leading-relaxed">
        Ingresa a Radar Oficina con tu cuenta habitual. Si necesitas operar el patio, pide a un administrador que actualice tu rol.
      </p>

      <button
        type="button"
        onClick={onLogout}
        className="w-full rounded-xl border border-amber-500/60 bg-amber-500/20 px-4 py-3 font-mono font-black text-xs uppercase tracking-wide text-amber-100 hover:bg-amber-500/30 active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-2"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[18px]">logout</span>
        <span>Cerrar sesión</span>
      </button>
    </div>
  </main>
);
