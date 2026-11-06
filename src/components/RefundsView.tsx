import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Order, RefundRequest } from '../types';
import { apiFetch } from '../services/apiFetch';
import { RefundRequestView } from './RefundRequestView';
import { OrderAftersalesPanel } from './OrderAftersales';

interface RefundsViewProps {
  orders: Order[];
  userRole?: string;
  onSelectOrder?: (orderId: string) => void;
}

const fieldClass = 'bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-white';
const buttonClass = 'rounded-xl border border-cyan-700 px-4 py-2 text-sm disabled:opacity-50';

export const RefundsView: React.FC<RefundsViewProps> = ({ orders, userRole = 'operador', onSelectOrder }) => {
  const [refunds, setRefunds] = useState<RefundRequest[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [creating, setCreating] = useState(false);
  const [managingId, setManagingId] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const requestId = ++generation.current;
    try {
      const response = await apiFetch('/refunds');
      if (!response.ok) throw new Error('No se pudieron cargar las solicitudes de reembolso.');
      const data = await response.json();
      if (requestId === generation.current) { setRefunds(data); setHasLoaded(true); setError(''); }
    } catch (error) {
      if (requestId === generation.current) setError(error instanceof Error ? error.message : 'No se pudieron cargar los reembolsos.');
    }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => { void load(); };
    window.addEventListener('radar:data-changed', refresh);
    return () => { generation.current++; window.removeEventListener('radar:data-changed', refresh); };
  }, [load, orders]);

  const filtered = useMemo(() => refunds.filter((refund) =>
    (status === 'all' || refund.status === status) &&
    [refund.id, refund.orderCode, refund.customerName, refund.vehicle, refund.part, refund.reason].join(' ').toLowerCase().includes(search.toLowerCase())
  ), [refunds, search, status]);
  const legacyOrders = useMemo(() => orders.filter((order) => order.status === 'reembolsado' &&
    !refunds.some((refund) => String(refund.orderId) === String(order.id) || refund.orderCode === order.code)), [orders, refunds]);
  const selectedOrder = orders.find((order) => String(order.id) === selectedOrderId);
  const update = async (refund: RefundRequest, nextStatus: 'completed' | 'cancelled') => {
    if (userRole !== 'admin' || busyRef.current) return;
    busyRef.current = true;
    setBusyId(refund.id);
    setError('');
    setMessage('');
    try {
      const response = await apiFetch(`/refunds/${refund.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: nextStatus }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || 'No se pudo actualizar el reembolso.');
      }
      window.dispatchEvent(new Event('radar:data-changed'));
      setMessage(nextStatus === 'completed' ? 'Reembolso confirmado.' : 'Solicitud cancelada.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo guardar el reembolso.');
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
  };

  if (creating && selectedOrder) return <RefundRequestView key={selectedOrder.id} order={selectedOrder}
    onBack={() => { setCreating(false); setSelectedOrderId(''); }}
    onSuccess={(message) => { setMessage(message); setCreating(false); setSelectedOrderId(''); }} />;
  const managingOrder = orders.find(order => String(order.id) === managingId);
  if (managingOrder) return <div className="radar-view horizon-view space-y-4"><button className={buttonClass} onClick={() => setManagingId('')}>Volver a reembolsos</button>
    <h1>{managingOrder.code}</h1><OrderAftersalesPanel order={managingOrder} /></div>;

  return <div className="radar-view horizon-view space-y-5 pb-10 text-slate-100">
    <header className="horizon-view-header"><div><h1 className="text-2xl font-black">Reembolsos</h1><p className="text-slate-400">Solicitudes y pagos registrados</p></div>
      <button className={buttonClass} onClick={() => setCreating(true)}>Nueva solicitud</button></header>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {message && <p role="status" className="text-emerald-300">{message}</p>}
    {creating && <section className="space-y-3 rounded-xl border border-slate-700 p-4">
      <h2>Selecciona la orden para solicitar un reembolso</h2>
      <select className={fieldClass} aria-label="Orden a reembolsar" value={selectedOrderId} onChange={(event) => setSelectedOrderId(event.target.value)}>
        <option value="">Selecciona una orden</option>
        {orders.filter((order) => !['reembolsado', 'solicitud_reembolso'].includes(order.status)).map((order) =>
          <option key={order.id} value={order.id}>{order.code} · {order.customer.name}</option>)}
      </select>
      <button className={buttonClass} onClick={() => setCreating(false)}>Volver</button>
    </section>}
    <div className="horizon-view-toolbar flex flex-wrap gap-3">
      <input className={fieldClass} aria-label="Buscar reembolsos" placeholder="Orden, cliente, pieza o motivo" value={search} onChange={(event) => setSearch(event.target.value)} />
      <select className={fieldClass} aria-label="Estado del reembolso" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="all">Todos</option><option value="pending">Pendientes</option><option value="completed">Completados</option><option value="cancelled">Cancelados</option>
      </select>
    </div>
    <div className="space-y-3">{filtered.map((refund) => <article key={refund.id} className="horizon-view-card rounded-2xl border border-slate-700 bg-slate-900 p-4 space-y-2">
      <div className="flex flex-wrap justify-between gap-2"><strong>{refund.id} · {refund.orderCode} · {refund.refundScope === 'core' ? 'Core' : 'Compra'}</strong><span>{refund.reviewStage || refund.status}</span></div>
      <p>{refund.customerName} · {refund.vehicle} · {refund.part}</p><p>{refund.reason}</p>
      <p>${Number(refund.amount).toFixed(2)} · {refund.paymentMethod} · {refund.paymentDetails}</p>
      <div className="flex flex-wrap gap-2">
        {onSelectOrder && <button className={buttonClass} onClick={() => onSelectOrder(String(refund.orderId))}>Ver orden</button>}
        {userRole === 'admin' && refund.status === 'pending' && <>
          <button className={buttonClass} onClick={() => setManagingId(String(refund.orderId))}>Gestionar revisión, aprobación y devolución</button>
        </>}
      </div>
    </article>)}
      {!filtered.length && <p className="p-6 text-slate-400">No hay solicitudes para estos filtros.</p>}
    </div>
    {hasLoaded && (status === 'all' || status === 'completed') && legacyOrders.length > 0 && <section className="rounded-xl border border-amber-900 p-4 space-y-2">
      <h2 className="font-bold text-amber-300">Histórico legado — solo informativo</h2>
      <p className="text-sm text-slate-400">Órdenes reembolsadas sin solicitud registrada. No representan solicitudes ni permiten acciones de pago.</p>
      {legacyOrders.filter((order) => `${order.code} ${order.customer.name}`.toLowerCase().includes(search.toLowerCase())).map((order) =>
        <p key={order.id}>{order.code} · {order.customer.name} · Reembolsado (legado)</p>)}
    </section>}
  </div>;
};
