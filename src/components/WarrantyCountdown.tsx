import React, { useEffect, useState } from 'react';
import type { WarrantyTerms } from '../utils/aftersales';
import { getWarrantyCountdown } from '../utils/orderWarranty';

export const WarrantyCountdown: React.FC<{ terms: WarrantyTerms | null; now?: number }> = ({ terms, now }) => {
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    if (now !== undefined) return;
    const refresh = () => setClock(Date.now());
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [now]);
  if (!terms) return <p className="text-sm text-[var(--text-secondary)]">Comienza con la entrega física.</p>;
  const { remainingMs, percentRemaining } = getWarrantyCountdown(terms, now ?? clock);
  const minutes = Math.ceil(remainingMs / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  const label = remainingMs > 0
    ? `${days} ${days === 1 ? 'día' : 'días'} · ${hours} h · ${minutes % 60} min`
    : 'Garantía vencida';
  const color = remainingMs === 0 ? '#dc2626' : remainingMs <= 10 * 86400000 ? '#b45309' : '#059669';
  return <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] p-4 space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <span aria-hidden="true" className="material-symbols-outlined text-3xl" style={{ color }}>timer</span>
      <div><p className="text-xs text-[var(--text-secondary)]">Tiempo restante de garantía</p>
        <p className="text-xl font-bold tabular-nums">{label}</p></div>
    </div>
    <div role="meter" aria-label="Garantía restante" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(percentRemaining)} aria-valuetext={label}
      className="h-3 overflow-hidden rounded-full bg-[var(--border-color)]">
      <div className="h-full rounded-full" style={{ width: `${percentRemaining}%`, backgroundColor: color }} />
    </div>
    <p className="text-xs text-[var(--text-secondary)]">{remainingMs > 0
      ? 'La barra disminuye hasta el vencimiento. Se actualiza automáticamente.'
      : 'Sin tiempo de cobertura restante. Los reclamos abiertos a tiempo conservan su gestión.'}</p>
  </div>;
};
