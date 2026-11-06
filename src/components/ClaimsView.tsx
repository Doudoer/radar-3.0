import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Claim, ClaimStatus, Order } from '../types';
import { apiFetch } from '../services/apiFetch';
import { ClaimDetailView } from './ClaimDetailView';
import { getClaimWarrantyError } from '../utils/orderWarranty';
import { OrderAftersalesPanel } from './OrderAftersales';

interface ClaimsViewProps {
  orders?: Order[];
  onUpdateOrder?: (order: Order) => Promise<Order | void>;
  userRole?: string;
  onSelectOrder?: (orderId: string) => void;
}

const fieldClass = 'bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-white';
const buttonClass = 'rounded-xl border border-cyan-700 px-4 py-2 text-sm disabled:opacity-50';

export const ClaimsView: React.FC<ClaimsViewProps> = ({ orders = [], userRole = 'operador', onSelectOrder }) => {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('Todos');
  const [priority, setPriority] = useState('Todas');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [managingId, setManagingId] = useState('');
  const [creating, setCreating] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const busyRef = useRef(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++generation.current;
    try {
      const response = await apiFetch('/claims');
      if (!response.ok) throw new Error('No se pudieron cargar los reclamos.');
      const data = await response.json();
      if (requestId === generation.current) {
        setClaims(data);
        setError('');
      }
    } catch (error) {
      if (requestId === generation.current) setError(error instanceof Error ? error.message : 'Error al cargar reclamos.');
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => { void load(); };
    window.addEventListener('radar:data-changed', refresh);
    return () => {
      generation.current++;
      window.removeEventListener('radar:data-changed', refresh);
    };
  }, [load, orders]);

  const filtered = useMemo(() => claims.filter((claim) => {
    const text = [claim.id, claim.orderCode, claim.customerName, claim.customerPhone, claim.vehicle, claim.mainPart, claim.claimReason].join(' ').toLowerCase();
    return text.includes(search.toLowerCase()) && (status === 'Todos' || claim.status === status) &&
      (priority === 'Todas' || claim.priority === priority);
  }), [claims, search, status, priority]);
  const selectedClaim = claims.find((claim) => claim.id === selectedId);

  const mutate = async (path: string, method: string, body: object, success: string) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await apiFetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.message || 'No se pudo guardar el reclamo.');
      }
      window.dispatchEvent(new Event('radar:data-changed'));
      setMessage(success);
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo guardar el reclamo.');
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!orderId) return setError('Selecciona una orden.');
    const selectedOrder = orders.find((order) => String(order.id) === String(orderId));
    const warrantyError = selectedOrder && getClaimWarrantyError(selectedOrder);
    if (warrantyError) return setError(warrantyError);
    setManagingId(orderId);
    setCreating(false);
  };

  const changeStatus = async (claim: Claim, targetStatus: ClaimStatus) => {
    setManagingId(String(claim.orderId));
  };
  const managingOrder = orders.find(order => String(order.id) === managingId);
  if (managingOrder) return <div className="radar-view horizon-view space-y-4">
    <button className={buttonClass} onClick={() => setManagingId('')}>Volver a reclamos</button><h1>{managingOrder.code}</h1>
    <OrderAftersalesPanel order={managingOrder} /></div>;

  return (
    <div className="radar-view horizon-view space-y-5 pb-10 text-slate-100">
      {error && <p role="alert" className="rounded-xl border border-red-500 p-3 text-red-300">{error}</p>}
      {message && <p role="status" className="text-emerald-300">{message}</p>}
      {selectedClaim ? <ClaimDetailView
        claim={selectedClaim}
        order={orders.find((order) => String(order.id) === String(selectedClaim.orderId) || order.code === selectedClaim.orderCode)}
        onBack={() => setSelectedId(null)}
        onCallAdded={(call) => setClaims((previous) => previous.map((claim) => claim.id === selectedId
          ? { ...claim, calls: [call, ...(claim.calls || [])], callCount: (claim.callCount || 0) + 1 } : claim))}
        onResolve={() => { void changeStatus(selectedClaim, 'Resolved'); }}
      /> : <>
        <header className="horizon-view-header">
          <div><h1 className="text-2xl font-black">Reclamos</h1><p className="text-slate-400">Garantías, seguimiento y llamadas</p></div>
          <div className="flex gap-2">
            <button className={buttonClass} onClick={() => window.print()}>Imprimir</button>
            <button className={buttonClass} onClick={() => setCreating(true)}>Nuevo reclamo</button>
          </div>
        </header>
        <div className="horizon-view-toolbar flex flex-wrap gap-3">
          <input className={fieldClass} aria-label="Buscar reclamos" placeholder="Orden, cliente, vehículo o motivo" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select className={fieldClass} aria-label="Estado del reclamo" value={status} onChange={(event) => setStatus(event.target.value)}>
            {['Todos', 'Pending', 'In Process', 'Resolved', 'Denied'].map((value) => <option key={value}>{value}</option>)}
          </select>
          <select className={fieldClass} aria-label="Prioridad" value={priority} onChange={(event) => setPriority(event.target.value)}>
            {['Todas', 'Alta', 'Media', 'Baja'].map((value) => <option key={value}>{value}</option>)}
          </select>
        </div>
        <div className="space-y-3">
          {filtered.map((claim) => <article key={claim.id} className="horizon-view-card rounded-2xl border border-slate-700 bg-slate-900 p-4 space-y-2">
            <div className="flex justify-between gap-3"><button className="font-bold text-cyan-300" onClick={() => setSelectedId(claim.id)}>{claim.id} · {claim.orderCode}</button><span>{claim.status} · {claim.priority}</span></div>
            <p>{claim.customerName} · {claim.vehicle} · {claim.mainPart}</p>
            <p className="text-slate-300">{claim.claimReason}</p>
            <p className="text-xs text-slate-400">{claim.callCount || 0} llamadas · {claim.advisor}</p>
            <div className="flex flex-wrap gap-2">
              <button className={buttonClass} onClick={() => setSelectedId(claim.id)}>Detalle y llamadas</button>
              {onSelectOrder && <button className={buttonClass} onClick={() => {
                const order = orders.find((order) => String(order.id) === String(claim.orderId) || order.code === claim.orderCode);
                if (order) onSelectOrder(order.id);
              }}>Ver orden</button>}
              {claim.status !== 'Resolved' && claim.status !== 'Denied' && <>
                <button className={buttonClass} disabled={busy} onClick={() => { void changeStatus(claim, 'In Process'); }}>En proceso</button>
                <button className={buttonClass} disabled={busy} onClick={() => { void changeStatus(claim, 'Resolved'); }}>Resolver</button>
                {userRole === 'admin' && <button className={buttonClass} disabled={busy} onClick={() => { void changeStatus(claim, 'Denied'); }}>Denegar garantía</button>}
              </>}
            </div>
          </article>)}
          {!filtered.length && <p className="p-6 text-slate-400">No hay reclamos para estos filtros.</p>}
        </div>
      </>}
      {creating && <div className="horizon-modal fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
        <form onSubmit={create} className="bg-slate-900 border border-cyan-800 rounded-2xl p-6 w-full max-w-xl space-y-4">
          <h2 className="text-xl font-bold">Nuevo reclamo</h2>
          <select required className={`${fieldClass} w-full`} aria-label="Orden del reclamo" value={orderId} onChange={(event) => setOrderId(event.target.value)}>
            <option value="">Selecciona una orden</option>
            {orders.map((order) => {
              const warrantyError = getClaimWarrantyError(order);
              return (
                <option key={order.id} value={order.id} disabled={Boolean(warrantyError)}>
                  {order.code} · {order.customer.name}{warrantyError ? ' · Garantía expirada' : ''}
                </option>
              );
            })}
          </select>
          <p>En el siguiente paso registrarás el motivo, soportes y próxima revisión.</p>
          {error && <p role="alert" className="text-red-300">{error}</p>}
          <div className="flex gap-3">
            <button type="button" className={buttonClass} disabled={busy} onClick={() => setCreating(false)}>Volver</button>
            <button className={buttonClass} disabled={busy}>Continuar al flujo verificable</button>
          </div>
        </form>
      </div>}
    </div>
  );
};
