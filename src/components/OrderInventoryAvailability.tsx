import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { InventoryAvailability, Order } from '../types';
import { inventoryAvailabilityLabel } from '../utils/inventoryMatching';
import { ordersApi } from '../services/ordersApi';

export function InventoryAvailabilityBadge({ availability, compact = false }: { availability?: InventoryAvailability; compact?: boolean }) {
  if (!availability) return null;
  const color = availability.state === 'available' || availability.state === 'linked' ? 'var(--positive)'
    : availability.state === 'possible' || availability.state === 'reserved' ? 'var(--warning)' : 'var(--text-secondary)';
  const label = inventoryAvailabilityLabel(availability);
  if (compact) {
    return <span className="inline-flex shrink-0 items-center" style={{ color }} title={label} aria-label={label}>
      <span aria-hidden="true" className="material-symbols-outlined text-[15px]">inventory_2</span>
    </span>;
  }
  return <span className="inline-flex items-center gap-1 text-[11px] font-semibold mt-1" style={{ color }}
    title={label}>
    <span aria-hidden="true" className="material-symbols-outlined text-[15px]">inventory_2</span>
    {label}
  </span>;
}

export function OrderInventoryAvailability({ order, userRole }: { order: Order; userRole?: string }) {
  const [current, setCurrent] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    try {
      const saved = await ordersApi.get(order.id);
      if (request === generation.current) { setCurrent(saved); setError(''); }
    } catch (reason) {
      if (request === generation.current) {
        setCurrent(null);
        setError(reason instanceof Error ? reason.message : 'No se pudo consultar la disponibilidad.');
      }
    }
  }, [order.id]);
  useEffect(() => {
    setCurrent(null);
    setSelectedId('');
    setConfirmed(false);
    void reload();
    window.addEventListener('radar:inventory-updated', reload);
    window.addEventListener('radar:data-changed', reload);
    return () => {
      generation.current++;
      window.removeEventListener('radar:inventory-updated', reload);
      window.removeEventListener('radar:data-changed', reload);
    };
  }, [reload, order.version]);

  const availability = current?.inventoryAvailability;
  const canReserve = current && !current.inventoryPartId &&
    ['admin', 'operator', 'operador', 'vendedor_yarda'].includes(userRole || '') &&
    ['cotizacion', 'espera_confirmacion', 'pagado', 'en_preparacion', 'listo_despacho', 'listo_retiro', 'en_camino'].includes(current.status);
  const reserve = async () => {
    if (busy.current || !current?.version || !selectedId || !confirmed) return;
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      const saved = await ordersApi.linkInventory(current.id, Number(selectedId), current.version);
      generation.current++;
      setCurrent(saved);
      setSelectedId('');
      setConfirmed(false);
      window.dispatchEvent(new Event('radar:data-changed'));
      window.dispatchEvent(new Event('radar:inventory-updated'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo reservar la pieza.');
      setSelectedId('');
      setConfirmed(false);
    } finally { busy.current = false; setSaving(false); }
  };
  return <section className="cyber-card p-4 sm:p-5 mb-4" aria-label="Disponibilidad en inventario">
    <div className="flex flex-wrap justify-between gap-3 items-center">
      <div>
        <h3 className="font-bold text-base">Disponibilidad en inventario</h3>
        {availability ? <InventoryAvailabilityBadge availability={availability} />
          : <p className="text-sm text-slate-400">{error ? 'Disponibilidad no disponible' : 'Verificando inventario…'}</p>}
      </div>
      <div className="flex gap-2">
        <button type="button" className="px-3 py-2 rounded-xl text-sm bg-cyan-500/10" onClick={() => void reload()} disabled={saving}>Actualizar disponibilidad</button>
        {!!availability?.candidates.length && <button type="button" className="horizon-primary px-3 py-2 rounded-xl text-sm"
          onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
          {expanded ? 'Ocultar coincidencias' : 'Ver coincidencias'}
        </button>}
      </div>
    </div>
    {error && <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
    {availability?.state === 'linked' && <p className="mt-3 text-sm text-slate-400">
      Pieza #{current?.inventoryPartId} · {availability.linkedPart
        ? `${availability.linkedPart.partType} ${availability.linkedPart.brand} ${availability.linkedPart.model} · Paleta: ${availability.linkedPart.palletNumber || 'Sin registrar'} · Estado: ${availability.linkedPart.status}`
        : 'No se pudo encontrar la ficha activa de la pieza vinculada.'}
    </p>}
    {expanded && !!availability?.candidates.length && <div className="mt-4 space-y-3">
      <p className="text-sm text-slate-400">Son sugerencias, no una garantía de compatibilidad. Verifica especificaciones y códigos de intercambio antes de reservar.</p>
      {availability.candidates.map(candidate => <div key={candidate.part.id}
        className="rounded-2xl p-4 border border-slate-200" style={{ background: 'var(--bg-card-subtle)' }}>
        <div className="flex flex-wrap justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">#{candidate.part.id} · {candidate.part.partType} · {candidate.part.brand} {candidate.part.model || 'Modelo sin registrar'} · {candidate.part.year}</p>
            <p className="text-sm mt-1">{candidate.part.engineSpecs || 'Sin especificaciones'} · Paleta: {candidate.part.palletNumber || 'Sin registrar'} · {candidate.part.status}</p>
            <p className="text-xs text-slate-400 mt-2">{candidate.reasons.join(' · ')}</p>
            {candidate.pendingChecks.map(check => <p key={check} className="text-xs mt-1" style={{ color: 'var(--warning)' }}>{check}</p>)}
          </div>
          {canReserve && candidate.part.status === 'disponible' && <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" name={`inventory-part-${order.id}`} checked={selectedId === candidate.part.id} disabled={saving}
              onChange={() => { setSelectedId(candidate.part.id); setConfirmed(false); }} />
            Seleccionar pieza #{candidate.part.id}
          </label>}
        </div>
      </div>)}
      {canReserve && <div className="space-y-3 pt-2">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={confirmed} disabled={!selectedId || saving} onChange={event => setConfirmed(event.target.checked)} />
          Revisé la compatibilidad mecánica de la pieza seleccionada y confirmo su reserva para esta orden.
        </label>
        <button type="button" onClick={() => void reserve()} disabled={!selectedId || !confirmed || saving}
          className="horizon-primary px-4 py-2.5 rounded-xl font-semibold text-sm disabled:opacity-50">
          {saving ? 'Reservando…' : 'Vincular y reservar pieza'}
        </button>
      </div>}
    </div>}
  </section>;
}
