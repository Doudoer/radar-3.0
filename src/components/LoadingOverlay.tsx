import React from 'react';

interface LoadingOverlayProps {
  visible: boolean;
  label?: string;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ visible, label = 'Cargando RADAR V3' }) => {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#050811]/92 backdrop-blur-md" role="status" aria-live="polite">
      <div className="flex min-w-52 flex-col items-center gap-4 rounded-3xl border border-cyan-500/40 bg-[#070c18]/95 px-8 py-7 shadow-[0_0_50px_rgba(6,182,212,0.25)]">
        <div className="relative h-14 w-14 flex items-center justify-center" aria-hidden="true">
          <div className="absolute -inset-2 rounded-full border border-dashed border-cyan-500/30 animate-cyber-orbit" />
          <div className="absolute inset-0 rounded-full border-2 border-cyan-500/20" />
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-cyan-400 border-r-emerald-400" />
          <div className="h-6 w-6 rounded-full bg-gradient-to-br from-cyan-400 to-emerald-400 shadow-[0_0_20px_rgba(34,211,238,0.8)]" />
        </div>
        <span className="text-[11px] font-mono font-bold tracking-[0.2em] text-cyan-300 uppercase">{label}</span>
      </div>
    </div>
  );
};
