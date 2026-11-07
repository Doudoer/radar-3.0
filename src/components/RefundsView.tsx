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

const fieldClass =
  'rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] px-3.5 py-2 text-xs sm:text-sm text-[var(--text-primary)] focus:outline-none focus:border-cyan-400 transition-colors';
const buttonClass =
  'cyber-btn-secondary rounded-xl px-3.5 py-2 text-xs font-bold disabled:opacity-50 cursor-pointer transition-all';

const STAGE_BADGES: Record<string, { label: string; cls: string }> = {
  requested: { label: '1. Solicitado', cls: 'bg-amber-500/15 border-amber-500/35 text-amber-500' },
  pending: { label: 'Pendiente de revisión', cls: 'bg-amber-500/15 border-amber-500/35 text-amber-500' },
  review: { label: '2. En revisión', cls: 'bg-cyan-500/15 border-cyan-500/35 text-cyan-400' },
  approved: { label: '3. Aprobado · Listo para devolver', cls: 'bg-emerald-500/15 border-emerald-500/35 text-emerald-500' },
  completed: { label: '4. Dinero devuelto', cls: 'bg-emerald-500/15 border-emerald-500/35 text-emerald-500' },
  rejected: { label: 'Rechazado', cls: 'bg-rose-500/15 border-rose-500/35 text-rose-400' },
  cancelled: { label: 'Cancelado', cls: 'bg-rose-500/15 border-rose-500/35 text-rose-400' },
};

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
  const [scopeFilter, setScopeFilter] = useState<'all' | 'purchase' | 'core'>('all');

  const load = useCallback(async () => {
    const requestId = ++generation.current;
    try {
      const response = await apiFetch('/refunds');
      if (!response.ok) throw new Error('No se pudieron cargar las solicitudes de reembolso.');
      const data = await response.json();
      if (requestId === generation.current) {
        setRefunds(data);
        setHasLoaded(true);
        setError('');
      }
    } catch (error) {
      if (requestId === generation.current)
        setError(error instanceof Error ? error.message : 'No se pudieron cargar los reembolsos.');
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => {
      void load();
    };
    window.addEventListener('radar:data-changed', refresh);
    return () => {
      generation.current++;
      window.removeEventListener('radar:data-changed', refresh);
    };
  }, [load, orders]);

  const filtered = useMemo(
    () =>
      refunds.filter((refund) => {
        const matchesStatus = status === 'all' || refund.status === status;
        const isCore = refund.refundScope === 'core';
        const matchesScope =
          scopeFilter === 'all' || (scopeFilter === 'core' ? isCore : !isCore);
        const matchesSearch = [
          refund.id,
          refund.orderCode,
          refund.customerName,
          refund.vehicle,
          refund.part,
          refund.reason,
        ]
          .join(' ')
          .toLowerCase()
          .includes(search.toLowerCase());
        return matchesStatus && matchesScope && matchesSearch;
      }),
    [refunds, search, status, scopeFilter]
  );

  const stats = useMemo(() => {
    const pendingList = refunds.filter((r) => r.status === 'pending');
    const completedList = refunds.filter((r) => r.status === 'completed');
    const pendingAmount = pendingList.reduce((acc, r) => acc + Number(r.amount || 0), 0);
    const completedAmount = completedList.reduce((acc, r) => acc + Number(r.amount || 0), 0);
    return {
      totalCount: refunds.length,
      pendingCount: pendingList.length,
      pendingAmount,
      completedCount: completedList.length,
      completedAmount,
    };
  }, [refunds]);

  const legacyOrders = useMemo(
    () =>
      orders.filter(
        (order) =>
          order.status === 'reembolsado' &&
          !refunds.some((refund) => String(refund.orderId) === String(order.id) || refund.orderCode === order.code)
      ),
    [orders, refunds]
  );

  const selectedOrder = orders.find((order) => String(order.id) === selectedOrderId);

  if (creating && selectedOrder) {
    return (
      <RefundRequestView
        key={selectedOrder.id}
        order={selectedOrder}
        onBack={() => {
          setCreating(false);
          setSelectedOrderId('');
        }}
        onSuccess={(message) => {
          setMessage(message);
          setCreating(false);
          setSelectedOrderId('');
        }}
      />
    );
  }

  const managingOrder = orders.find((order) => String(order.id) === managingId);
  if (managingOrder) {
    return (
      <div className="radar-view horizon-view space-y-4 pb-10">
        <div className="horizon-view-card flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="p-2 rounded-xl bg-[var(--bg-card-subtle)] border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 transition-all cursor-pointer"
              onClick={() => setManagingId('')}
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            </button>
            <div>
              <h1 className="text-lg sm:text-xl font-black text-[var(--text-primary)]">
                Gestión de reembolso · <span className="font-mono text-cyan-400">#{managingOrder.code}</span>
              </h1>
              <p className="text-xs text-[var(--text-secondary)]">
                {managingOrder.customer?.name} · {managingOrder.vehicle?.make} {managingOrder.vehicle?.model}
              </p>
            </div>
          </div>
          <button type="button" className={buttonClass} onClick={() => setManagingId('')}>
            Volver a reembolsos
          </button>
        </div>
        <OrderAftersalesPanel order={managingOrder} />
      </div>
    );
  }

  return (
    <div className="radar-view horizon-view space-y-5 pb-10 text-[var(--text-primary)]">
      {/* Header */}
      <header className="horizon-view-header flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl bg-cyan-500/15 border border-cyan-500/35 text-cyan-400 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[24px]">currency_exchange</span>
          </span>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-[var(--text-primary)]">Reembolsos</h1>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
              Solicitudes de devolución de compra, depósitos de Core y pagos registrados
            </p>
          </div>
        </div>
        <button
          type="button"
          className="horizon-primary rounded-xl px-4 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
          onClick={() => setCreating(true)}
        >
          <span className="material-symbols-outlined text-[16px]">add_circle</span>
          <span>Nueva solicitud</span>
        </button>
      </header>

      {error && (
        <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs sm:text-sm font-semibold text-red-500">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs sm:text-sm font-semibold text-emerald-500">
          {message}
        </p>
      )}

      {/* New Refund Order Selector Card */}
      {creating && (
        <section className="horizon-view-card rounded-2xl border-2 border-cyan-500/40 p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-[var(--text-primary)]">
                Selecciona la orden para solicitar un reembolso
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Al elegir la orden se abrirá su panel de posventa con su saldo cobrado disponible.
              </p>
            </div>
            <button type="button" className={buttonClass} onClick={() => setCreating(false)}>
              Volver
            </button>
          </div>
          <select
            className={`${fieldClass} w-full`}
            aria-label="Orden a reembolsar"
            value={selectedOrderId}
            onChange={(event) => setSelectedOrderId(event.target.value)}
          >
            <option value="">Selecciona una orden</option>
            {orders
              .filter((order) => !['reembolsado', 'solicitud_reembolso'].includes(order.status))
              .map((order) => (
                <option key={order.id} value={order.id}>
                  {order.code} · {order.customer.name}
                </option>
              ))}
          </select>
        </section>
      )}

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="horizon-view-card p-4 flex items-center justify-between gap-3">
          <div>
            <span className="text-xs text-[var(--text-secondary)] block">Solicitudes pendientes</span>
            <strong className="text-xl sm:text-2xl font-black text-amber-500 tabular-nums">
              {stats.pendingCount} · ${stats.pendingAmount.toFixed(2)}
            </strong>
          </div>
          <span className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-500 flex items-center justify-center">
            <span className="material-symbols-outlined text-[20px]">hourglass_top</span>
          </span>
        </div>

        <div className="horizon-view-card p-4 flex items-center justify-between gap-3">
          <div>
            <span className="text-xs text-[var(--text-secondary)] block">Reembolsos completados</span>
            <strong className="text-xl sm:text-2xl font-black text-emerald-500 tabular-nums">
              {stats.completedCount} · ${stats.completedAmount.toFixed(2)}
            </strong>
          </div>
          <span className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 flex items-center justify-center">
            <span className="material-symbols-outlined text-[20px]">paid</span>
          </span>
        </div>

        <div className="horizon-view-card p-4 flex items-center justify-between gap-3">
          <div>
            <span className="text-xs text-[var(--text-secondary)] block">Total solicitudes registradas</span>
            <strong className="text-xl sm:text-2xl font-black text-[var(--text-primary)] tabular-nums">
              {stats.totalCount}
            </strong>
          </div>
          <span className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 flex items-center justify-center">
            <span className="material-symbols-outlined text-[20px]">receipt_long</span>
          </span>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="horizon-view-toolbar horizon-view-card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            className={`${fieldClass} flex-1 min-w-[240px]`}
            aria-label="Buscar reembolsos"
            placeholder="Buscar por orden, cliente, pieza o motivo..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            className={fieldClass}
            aria-label="Estado del reembolso"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">Todos</option>
            <option value="pending">Pendientes</option>
            <option value="completed">Completados</option>
            <option value="cancelled">Cancelados</option>
          </select>
        </div>

        {/* 1-Click Filter Pills */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--border-color)]">
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'all', label: 'Todos los estados' },
              { id: 'pending', label: '⏳ Pendientes' },
              { id: 'completed', label: '✅ Completados' },
              { id: 'cancelled', label: '🚫 Cancelados' },
            ].map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setStatus(pill.id)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
                  status === pill.id
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-400 shadow-sm'
                    : 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: 'Tipo: Todos' },
                { id: 'purchase', label: '🛒 Compra' },
                { id: 'core', label: '⚙️ Depósito Core' },
              ] as const
            ).map((sc) => (
              <button
                key={sc.id}
                type="button"
                onClick={() => setScopeFilter(sc.id)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                  scopeFilter === sc.id
                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-400'
                    : 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {sc.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Refund Cards List */}
      <div className="space-y-3">
        {filtered.map((refund) => {
          const isCore = refund.refundScope === 'core';
          const stageKey = refund.reviewStage || refund.status;
          const badge = STAGE_BADGES[stageKey] || {
            label: stageKey,
            cls: 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] text-[var(--text-secondary)]',
          };

          return (
            <article
              key={refund.id}
              className="horizon-view-card rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 sm:p-5 space-y-3.5 shadow-sm"
            >
              {/* Card Header */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--border-color)]">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="font-mono text-sm font-black text-cyan-400">
                    {refund.id} · {refund.orderCode} · {isCore ? 'Core' : 'Compra'}
                  </strong>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                      isCore
                        ? 'bg-purple-500/15 border-purple-500/35 text-purple-400'
                        : 'bg-cyan-500/15 border-cyan-500/35 text-cyan-400'
                    }`}
                  >
                    {isCore ? '⚙️ Depósito de Core' : '🛒 Reembolso de Compra'}
                  </span>
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${badge.cls}`}>
                    {badge.label}
                  </span>
                </div>

                <span className="text-lg sm:text-xl font-black font-mono text-[var(--text-primary)] tabular-nums">
                  ${Number(refund.amount).toFixed(2)}
                </span>
              </div>

              {/* Details Grid */}
              <div className="grid gap-3 md:grid-cols-3 text-xs">
                <div className="rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] p-3 space-y-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block">
                    Cliente y pieza
                  </span>
                  <strong className="font-bold text-[var(--text-primary)] block">
                    {refund.customerName}
                  </strong>
                  <p className="text-cyan-400 font-semibold">
                    {refund.vehicle} · {refund.part}
                  </p>
                </div>

                <div className="rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] p-3 space-y-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block">
                    Motivo registrado
                  </span>
                  <p className="text-[var(--text-primary)] leading-relaxed">{refund.reason}</p>
                </div>

                <div className="rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] p-3 space-y-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block">
                    Método y referencia
                  </span>
                  <p className="font-semibold text-[var(--text-primary)]">
                    ${Number(refund.amount).toFixed(2)} · {refund.paymentMethod} · {refund.paymentDetails}
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex flex-wrap gap-2">
                  {onSelectOrder && (
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={() => onSelectOrder(String(refund.orderId))}
                    >
                      Ver orden
                    </button>
                  )}
                </div>
                {userRole === 'admin' && refund.status === 'pending' && (
                  <button
                    type="button"
                    className="horizon-primary rounded-xl px-4 py-2 text-xs font-bold cursor-pointer"
                    onClick={() => setManagingId(String(refund.orderId))}
                  >
                    Gestionar revisión, aprobación y devolución
                  </button>
                )}
              </div>
            </article>
          );
        })}

        {!filtered.length && (
          <div className="horizon-view-card p-8 text-center text-sm text-[var(--text-secondary)]">
            No hay solicitudes para estos filtros.
          </div>
        )}
      </div>

      {/* Legacy Informative Accordion */}
      {hasLoaded && (status === 'all' || status === 'completed') && legacyOrders.length > 0 && (
        <section className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-amber-500">inventory</span>
            <h2 className="font-bold text-sm text-amber-500">Histórico legado — solo informativo</h2>
          </div>
          <p className="text-xs text-[var(--text-secondary)]">
            Órdenes reembolsadas sin solicitud registrada. No representan solicitudes ni permiten acciones de pago.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-xs pt-1">
            {legacyOrders
              .filter((order) => `${order.code} ${order.customer.name}`.toLowerCase().includes(search.toLowerCase()))
              .map((order) => (
                <div
                  key={order.id}
                  className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] px-3 py-2 font-medium text-[var(--text-primary)]"
                >
                  {order.code} · {order.customer.name} · Reembolsado (legado)
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  );
};
