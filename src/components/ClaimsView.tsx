import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Claim, ClaimStatus, Order } from '../types';
import { apiFetch } from '../services/apiFetch';
import { ClaimDetailView, type ClaimQuickAction } from './ClaimDetailView';
import { getClaimWarrantyError } from '../utils/orderWarranty';
import { OrderAftersalesPanel } from './OrderAftersales';

interface ClaimsViewProps {
  orders?: Order[];
  onUpdateOrder?: (order: Order) => Promise<Order | void>;
  userRole?: string;
  onSelectOrder?: (orderId: string) => void;
}

const fieldClass =
  'rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] px-3.5 py-2 text-xs sm:text-sm text-[var(--text-primary)] focus:outline-none focus:border-cyan-400 transition-colors';
const buttonClass =
  'cyber-btn-secondary rounded-xl px-3.5 py-2 text-xs font-bold disabled:opacity-50 cursor-pointer transition-all';

const STATUS_META: Record<string, { label: string; cls: string; icon: string }> = {
  Pending: {
    label: 'Pendiente',
    cls: 'bg-amber-500/15 border-amber-500/35 text-amber-500',
    icon: 'schedule',
  },
  'In Process': {
    label: 'En proceso',
    cls: 'bg-cyan-500/15 border-cyan-500/35 text-cyan-400',
    icon: 'build_circle',
  },
  Resolved: {
    label: 'Resuelto',
    cls: 'bg-emerald-500/15 border-emerald-500/35 text-emerald-500',
    icon: 'check_circle',
  },
  Denied: {
    label: 'Denegado',
    cls: 'bg-rose-500/15 border-rose-500/35 text-rose-400',
    icon: 'cancel',
  },
};

const PRIORITY_META: Record<string, { label: string; cls: string }> = {
  Alta: { label: '🔥 Prioridad Alta', cls: 'bg-rose-500/15 border-rose-500/35 text-rose-400' },
  Media: { label: '⚡ Prioridad Media', cls: 'bg-amber-500/15 border-amber-500/35 text-amber-500' },
  Baja: { label: '🟢 Prioridad Baja', cls: 'bg-emerald-500/15 border-emerald-500/35 text-emerald-500' },
};

export const ClaimsView: React.FC<ClaimsViewProps> = ({ orders = [], userRole = 'operador', onSelectOrder }) => {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('Todos');
  const [priority, setPriority] = useState('Todas');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [initialAction, setInitialAction] = useState<ClaimQuickAction>('');
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
      claims.filter((claim) => {
        const text = [
          claim.id,
          claim.orderCode,
          claim.customerName,
          claim.customerPhone,
          claim.vehicle,
          claim.mainPart,
          claim.claimReason,
        ]
          .join(' ')
          .toLowerCase();
        return (
          text.includes(search.toLowerCase()) &&
          (status === 'Todos' || claim.status === status) &&
          (priority === 'Todas' || claim.priority === priority)
        );
      }),
    [claims, search, status, priority]
  );

  const selectedClaim = claims.find((claim) => claim.id === selectedId);

  const stats = useMemo(() => {
    const open = claims.filter((c) => !['Resolved', 'Denied'].includes(c.status)).length;
    const high = claims.filter((c) => c.priority === 'Alta' && !['Resolved', 'Denied'].includes(c.status)).length;
    const resolved = claims.filter((c) => c.status === 'Resolved').length;
    return { total: claims.length, open, high, resolved };
  }, [claims]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!orderId) return setError('Selecciona una orden.');
    const selectedOrder = orders.find((order) => String(order.id) === String(orderId));
    const warrantyError = selectedOrder && getClaimWarrantyError(selectedOrder);
    if (warrantyError) return setError(warrantyError);
    setManagingId(orderId);
    setCreating(false);
  };

  const changeStatus = async (claim: Claim, _targetStatus: ClaimStatus) => {
    setManagingId(String(claim.orderId));
  };

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
                Gestión de garantía · <span className="font-mono text-cyan-400">#{managingOrder.code}</span>
              </h1>
              <p className="text-xs text-[var(--text-secondary)]">
                {managingOrder.customer?.name} · {managingOrder.vehicle?.make} {managingOrder.vehicle?.model}
              </p>
            </div>
          </div>
          <button type="button" className={buttonClass} onClick={() => setManagingId('')}>
            Volver a reclamos
          </button>
        </div>
        <OrderAftersalesPanel order={managingOrder} />
      </div>
    );
  }

  return (
    <div className="radar-view horizon-view space-y-5 pb-10 text-[var(--text-primary)]">
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

      {selectedClaim ? (
        <ClaimDetailView
          claim={selectedClaim}
          order={orders.find(
            (order) => String(order.id) === String(selectedClaim.orderId) || order.code === selectedClaim.orderCode
          )}
          userRole={userRole}
          initialAction={initialAction}
          onBack={() => {
            setSelectedId(null);
            setInitialAction('');
          }}
          onCallAdded={(call) =>
            setClaims((previous) =>
              previous.map((claim) =>
                claim.id === selectedId
                  ? { ...claim, calls: [call, ...(claim.calls || [])], callCount: (claim.callCount || 0) + 1 }
                  : claim
              )
            )
          }
          onResolve={() => {
            void changeStatus(selectedClaim, 'Resolved');
          }}
          onReloadClaims={load}
          onSelectOrder={onSelectOrder}
        />
      ) : (
        <>
          {/* Header */}
          <header className="horizon-view-header flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-500/35 text-amber-500 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[24px]">build_circle</span>
              </span>
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-[var(--text-primary)]">Reclamos</h1>
                <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
                  Garantías, seguimiento técnico y bitácora de llamadas
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`${buttonClass} inline-flex items-center gap-1.5`}
                onClick={() => window.print()}
              >
                <span className="material-symbols-outlined text-[16px]">print</span>
                <span>Imprimir</span>
              </button>
              <button
                type="button"
                className="horizon-primary rounded-xl px-4 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                onClick={() => setCreating(true)}
              >
                <span className="material-symbols-outlined text-[16px]">add_circle</span>
                <span>Nuevo reclamo</span>
              </button>
            </div>
          </header>

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="horizon-view-card p-4 flex items-center justify-between gap-3">
              <div>
                <span className="text-xs text-[var(--text-secondary)] block">Total registrados</span>
                <strong className="text-2xl font-black text-[var(--text-primary)] tabular-nums">{stats.total}</strong>
              </div>
              <span className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 flex items-center justify-center">
                <span className="material-symbols-outlined text-[20px]">folder_Special</span>
              </span>
            </div>

            <div className="horizon-view-card p-4 flex items-center justify-between gap-3">
              <div>
                <span className="text-xs text-[var(--text-secondary)] block">Abiertos / En revisión</span>
                <strong className="text-2xl font-black text-amber-500 tabular-nums">{stats.open}</strong>
              </div>
              <span className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-500 flex items-center justify-center">
                <span className="material-symbols-outlined text-[20px]">pending_actions</span>
              </span>
            </div>

            <div className="horizon-view-card p-4 flex items-center justify-between gap-3">
              <div>
                <span className="text-xs text-[var(--text-secondary)] block">Prioridad alta activa</span>
                <strong className="text-2xl font-black text-rose-400 tabular-nums">{stats.high}</strong>
              </div>
              <span className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center">
                <span className="material-symbols-outlined text-[20px]">priority_high</span>
              </span>
            </div>

            <div className="horizon-view-card p-4 flex items-center justify-between gap-3">
              <div>
                <span className="text-xs text-[var(--text-secondary)] block">Casos resueltos</span>
                <strong className="text-2xl font-black text-emerald-500 tabular-nums">{stats.resolved}</strong>
              </div>
              <span className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 flex items-center justify-center">
                <span className="material-symbols-outlined text-[20px]">task_alt</span>
              </span>
            </div>
          </div>

          {/* Filter Toolbar */}
          <div className="horizon-view-toolbar horizon-view-card p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[240px]">
                <input
                  className={`${fieldClass} w-full`}
                  aria-label="Buscar reclamos"
                  placeholder="Buscar por orden, cliente, vehículo, pieza o motivo..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <select
                className={fieldClass}
                aria-label="Estado del reclamo"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                {['Todos', 'Pending', 'In Process', 'Resolved', 'Denied'].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <select
                className={fieldClass}
                aria-label="Prioridad"
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
              >
                {['Todas', 'Alta', 'Media', 'Baja'].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>

            {/* Quick 1-click Status Pills */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--border-color)]">
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { id: 'Todos', label: 'Todos' },
                  { id: 'Pending', label: '⏳ Pendientes' },
                  { id: 'In Process', label: '🔧 En proceso' },
                  { id: 'Resolved', label: '✅ Resueltos' },
                  { id: 'Denied', label: '🚫 Denegados' },
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
                {['Todas', 'Alta', 'Media', 'Baja'].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                      priority === p
                        ? 'bg-amber-500/20 border-amber-400 text-amber-400'
                        : 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {p === 'Todas' ? 'Prioridad: Todas' : p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Claims Cards List */}
          <div className="space-y-3">
            {filtered.map((claim) => {
              const statusMeta = STATUS_META[claim.status] || {
                label: claim.status,
                cls: 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] text-[var(--text-secondary)]',
                icon: 'info',
              };
              const prioMeta = PRIORITY_META[claim.priority] || {
                label: claim.priority,
                cls: 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] text-[var(--text-secondary)]',
              };

              return (
                <article
                  key={claim.id}
                  className="horizon-view-card rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 sm:p-5 space-y-3.5 shadow-sm"
                >
                  {/* Top Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--border-color)]">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 font-mono text-sm font-black text-cyan-400 hover:underline cursor-pointer"
                        onClick={() => setSelectedId(claim.id)}
                      >
                        <span className="material-symbols-outlined text-[17px]">folder_open</span>
                        <span>
                          {claim.id} · {claim.orderCode}
                        </span>
                      </button>
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${statusMeta.cls}`}>
                        <span className="material-symbols-outlined text-[13px]">{statusMeta.icon}</span>
                        <span>{statusMeta.label}</span>
                      </span>
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${prioMeta.cls}`}>
                        {prioMeta.label}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
                      <span className="inline-flex items-center gap-1 font-semibold">
                        <span className="material-symbols-outlined text-[15px] text-cyan-400">phone_in_talk</span>
                        <span>{claim.callCount || 0} llamadas</span>
                      </span>
                      <span>·</span>
                      <span>Asesor: <strong className="text-[var(--text-primary)]">{claim.advisor}</strong></span>
                    </div>
                  </div>

                  {/* Customer, Vehicle & Reason */}
                  <div className="grid gap-3 md:grid-cols-[1fr_1.4fr] text-xs sm:text-sm">
                    <div className="rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] p-3 space-y-1">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block">
                        Cliente y pieza reclamada
                      </span>
                      <strong className="font-bold text-[var(--text-primary)] block">
                        {claim.customerName}
                      </strong>
                      <p className="text-xs text-cyan-400 font-semibold">
                        {claim.vehicle} · {claim.mainPart}
                      </p>
                    </div>

                    <div className="rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] p-3 space-y-1">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block">
                        Motivo reportado
                      </span>
                      <p className="text-xs sm:text-sm text-[var(--text-primary)] leading-relaxed">
                        {claim.claimReason}
                      </p>
                    </div>
                  </div>

                  {/* 3-Step Visual Progress Bar */}
                  <div className="grid grid-cols-3 gap-2 text-[11px]">
                    {[
                      { num: 1, label: '1. Apertura' },
                      { num: 2, label: '2. Revisión y Diagnóstico' },
                      { num: 3, label: '3. Solución Verificable' },
                    ].map((s) => {
                      const isClosed = claim.status === 'Resolved' || claim.status === 'Denied';
                      const stepIdx = isClosed ? 3 : claim.status === 'In Process' ? 2 : 1;
                      const done = stepIdx > s.num || (isClosed && s.num === 3);
                      const active = !isClosed && stepIdx === s.num;
                      return (
                        <div
                          key={s.num}
                          className={`rounded-lg border px-2.5 py-1.5 font-semibold flex items-center justify-between gap-1 ${
                            done
                              ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-500'
                              : active
                              ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400'
                              : 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] text-[var(--text-secondary)] opacity-70'
                          }`}
                        >
                          <span className="truncate">{s.label}</span>
                          <span className="material-symbols-outlined text-[14px]">
                            {done ? 'check_circle' : active ? 'radio_button_checked' : 'schedule'}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Action Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={buttonClass}
                        onClick={() => {
                          setInitialAction('');
                          setSelectedId(claim.id);
                        }}
                      >
                        Detalle y llamadas
                      </button>
                      {onSelectOrder && (
                        <button
                          type="button"
                          className={buttonClass}
                          onClick={() => {
                            const order = orders.find(
                              (order) => String(order.id) === String(claim.orderId) || order.code === claim.orderCode
                            );
                            if (order) onSelectOrder(order.id);
                          }}
                        >
                          Ver orden
                        </button>
                      )}
                    </div>

                    {claim.status !== 'Resolved' && claim.status !== 'Denied' && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={busy}
                          onClick={() => {
                            setInitialAction('claim_review');
                            setSelectedId(claim.id);
                          }}
                        >
                          En proceso
                        </button>
                        <button
                          type="button"
                          className="horizon-primary rounded-xl px-3.5 py-2 text-xs font-bold disabled:opacity-50 cursor-pointer"
                          disabled={busy}
                          onClick={() => {
                            setInitialAction('claim_resolved');
                            setSelectedId(claim.id);
                          }}
                        >
                          Resolver
                        </button>
                        {userRole === 'admin' && (
                          <button
                            type="button"
                            className={buttonClass}
                            disabled={busy}
                            onClick={() => {
                              setInitialAction('claim_denied');
                              setSelectedId(claim.id);
                            }}
                          >
                            Denegar garantía
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}

            {!filtered.length && (
              <div className="horizon-view-card p-8 text-center text-sm text-[var(--text-secondary)]">
                No hay reclamos para estos filtros.
              </div>
            )}
          </div>
        </>
      )}

      {creating && (
        <div className="horizon-modal fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form
            onSubmit={create}
            className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl p-6 w-full max-w-xl space-y-4 shadow-xl"
          >
            <div className="flex items-center gap-3 pb-3 border-b border-[var(--border-color)]">
              <span className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/35 text-amber-500 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[20px]">report_problem</span>
              </span>
              <div>
                <h2 className="text-lg font-bold text-[var(--text-primary)]">Nuevo reclamo</h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  Selecciona la orden entregada para iniciar el registro verificable de garantía
                </p>
              </div>
            </div>

            <select
              required
              className={`${fieldClass} w-full`}
              aria-label="Orden del reclamo"
              value={orderId}
              onChange={(event) => setOrderId(event.target.value)}
            >
              <option value="">Selecciona una orden</option>
              {orders.map((order) => {
                const warrantyError = getClaimWarrantyError(order);
                return (
                  <option key={order.id} value={order.id} disabled={Boolean(warrantyError)}>
                    {order.code} · {order.customer.name}
                    {warrantyError ? ' · Garantía expirada' : ''}
                  </option>
                );
              })}
            </select>

            <p className="text-xs text-[var(--text-secondary)] rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] p-3">
              En el siguiente paso registrarás el motivo, soportes y próxima revisión.
            </p>
            {error && <p role="alert" className="text-xs text-red-500 font-semibold">{error}</p>}
            <div className="flex justify-end gap-2.5 pt-2">
              <button type="button" className={buttonClass} disabled={busy} onClick={() => setCreating(false)}>
                Volver
              </button>
              <button type="submit" className="horizon-primary rounded-xl px-4 py-2 text-xs font-bold cursor-pointer" disabled={busy}>
                Continuar al flujo verificable
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
