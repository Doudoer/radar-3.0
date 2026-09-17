import React from 'react';

interface LoadingOverlayProps {
  visible: boolean;
  label?: string;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ visible, label = 'Cargando RADAR' }) => {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#080d19]/95 backdrop-blur-sm" role="status" aria-live="polite">
      <div className="flex min-w-48 flex-col items-center gap-4 rounded-2xl border border-[#243653] bg-[#0d1728]/95 px-8 py-7 shadow-[0_0_45px_rgba(56,139,253,0.16)]">
        <div className="relative h-12 w-12" aria-hidden="true">
          <div className="absolute inset-0 rounded-full border-2 border-[#1e3a5f]" />
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-[#58a6ff] border-r-[#4edea3]" />
          <div className="absolute inset-[13px] rounded-full bg-[#58a6ff] shadow-[0_0_16px_rgba(88,166,255,0.75)]" />
        </div>
        <span className="text-xs font-semibold tracking-[0.18em] text-[#cbd5e1] uppercase">{label}</span>
      </div>
    </div>
  );
};
