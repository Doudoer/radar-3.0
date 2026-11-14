import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Claim, ClaimStatus, Order } from '../types';
import { apiFetch } from '../services/apiFetch';
import { ClaimDetailView, type ClaimQuickAction } from './ClaimDetailView';
import { FlowDialog } from './FlowDialog';
import { getClaimWarrantyError } from '../utils/orderWarranty';
import { OrderAftersalesPanel } from './OrderAftersales';
import { Icon } from './Icon';

interface ClaimsViewProps {
  orders?: Order[];
  onUpdateOrder?: (order: Order) => Promise<Order | void>;
  userRole?: string;
  onSelectOrder?: (orderId: string) => void;
  focusOrderId?: string | null;
}

const fieldClass =
  'rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] px-3.5 py-2 text-xs sm:text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand)] transition-colors';
const buttonClass =
  'cyber-btn-secondary rounded-xl px-3.5 py-2 text-xs font-bold disabled:opacity-50 cursor-pointer transition-all';

const STATUS_META: Record<string, { label: string; cls: string; icon: string }> = {
  Pending: {
    label: 'Nuevo',
    cls: 'bg-[var(--state-urgency-tint)] border-[var(--state-urgency-border)] text-[var(--state-urgency-text)]',
    icon: 'inbox',
  },
  'In Process': {
    label: 'En revisión',
    cls: 'bg-[var(--brand-soft)] border-[var(--brand)] text-[var(--brand)]',
    icon: 'build_circle',
  },
  Resolved: {
    label: 'Resuelto',
    cls: 'bg-[var(--bg-card-subtle)] border-[var(--positive)] text-[var(--positive)]',
    icon: 'check_circle',
  },
  Denied: {
    label: 'Denegado',
    cls: 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] text-[var(--text-secondary)]',
    icon: 'cancel',
  },
};

type ClaimPriority = 'Alta' | 'Media' | 'Baja';
type ClaimViewMode = 'board' | 'list';
type SlaTone = 'overdue' | 'soon' | 'ok' | 'closed' | 'none';

const PRIORITY_META: Record<ClaimPriority, { label: string; dot: string; text: string; chip: string }> = {
  Alta: {
    label: 'Alta',
    dot: 'bg-[var(--state-urgency)]',
    text: 'text-[var(--state-urgency-text)]',
    chip: 'border-[var(--state-urgency-border)] bg-[var(--state-urgency-tint)] text-[var(--state-urgency-text)]',
  },
  Media: {
    label: 'Media',
    dot: 'bg-[var(--warning)]',
    text: 'text-[var(--text-secondary)]',
    chip: 'border-[var(--border-color)] bg-[var(--bg-card-subtle)] text-[var(--warning)]',
  },
  Baja: {
    label: 'Baja',
    dot: 'bg-[var(--text-secondary)]',
    text: 'text-[var(--text-secondary)]',
    chip: 'border-[var(--border-color)] bg-[var(--bg-card-subtle)] text-[var(--text-secondary)]',
  },
};

const SLA_TONE_CLASS: Record<SlaTone, string> = {
  overdue: 'border-[var(--state-urgency-border)] bg-[var(--state-urgency-tint)] text-[var(--state-urgency-text)]',
  soon: 'border-[var(--state-urgency-border)] bg-[var(--state-urgency-tint)] text-[var(--state-urgency-text)]',
  ok: 'border-[var(--border-color)] bg-[var(--bg-card-subtle)] text-[var(--text-secondary)]',
  closed: 'border-[var(--border-color)] bg-[var(--bg-card-subtle)] text-[var(--text-secondary)]',
  none: 'border-[var(--border-color)] bg-[var(--bg-card-subtle)] text-[var(--text-secondary)]',
};

const SLA_TARGET_HOURS: Record<'Pending' | 'In Process', number> = {
  Pending: 48,
  'In Process': 168,
};

const BOARD_COLUMNS: { id: string; label: string; icon: string; statuses: ClaimStatus[]; empty: string }[] = [
  { id: 'nuevo', label: 'Nuevo', icon: 'inbox', statuses: ['Pending'], empty: 'Sin reclamos nuevos' },
  { id: 'revision', label: 'En revisión', icon: 'build_circle', statuses: ['In Process'], empty: 'Sin reclamos en revisión' },
  { id: 'resuelto', label: 'Resuelto', icon: 'task_alt', statuses: ['Resolved', 'Denied'], empty: 'Sin reclamos cerrados' },
];

const STATUS_FILTERS = [
  { id: 'Todos', label: 'Todos' },
  { id: 'Pending', label: 'Nuevo' },
  { id: 'In Process', label: 'En revisión' },
  { id: 'Resolved', label: 'Resuelto' },
  { id: 'Denied', label: 'Denegado' },
];

const parseClaimDate = (value?: string): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const endOfDay = (value: Date): Date => {
  const copy = new Date(value);
  copy.setHours(23, 59, 59, 999);
  return copy;
};

const formatSlaDistance = (hours: number): string => {
  if (hours >= 48) return `${Math.floor(hours / 24)} d`;
  if (hours >= 24) return '1 d';
  return `${Math.max(1, Math.round(hours))} h`;
};

const getSlaChipClass = (claim: Claim, sla: { tone: SlaTone }): string =>
  claim.status === 'Resolved'
    ? 'border-[var(--positive)] bg-[var(--bg-card-subtle)] text-[var(--positive)]'
    : SLA_TONE_CLASS[sla.tone];

const getClaimSla = (claim: Claim, now: number = Date.now()): { tone: SlaTone; label: string } => {
  if (claim.status === 'Resolved') return { tone: 'closed', label: 'Resuelto' };
  if (claim.status === 'Denied') return { tone: 'closed', label: 'Denegado' };
  const reviewDate = parseClaimDate(claim.nextReviewDate);
  const createdDate = parseClaimDate(claim.createdAt);
  const target = reviewDate
    ? endOfDay(reviewDate)
    : createdDate
      ? new Date(createdDate.getTime() + SLA_TARGET_HOURS[claim.status === 'In Process' ? 'In Process' : 'Pending'] * 3_600_000)
      : null;
  if (!target) return { tone: 'none', label: 'Sin fecha de revisión' };
  const remainingHours = (target.getTime() - now) / 3_600_000;
  if (remainingHours < 0) return { tone: 'overdue', label: `Vencido hace ${formatSlaDistance(Math.abs(remainingHours))}` };
  if (remainingHours <= 24) return { tone: 'soon', label: `Vence en ${formatSlaDistance(remainingHours)}` };
  return { tone: 'ok', label: `SLA en ${formatSlaDistance(remainingHours)}` };
};

const getClaimPriority = (claim: Claim, sla: { tone: SlaTone } = getClaimSla(claim), now: number = Date.now()): ClaimPriority => {
  if (claim.status === 'Resolved' || claim.status === 'Denied') return claim.priority;
  if (sla.tone === 'overdue' || sla.tone === 'soon') return 'Alta';
  const createdDate = parseClaimDate(claim.createdAt);
  if (claim.status === 'Pending' && createdDate && now - createdDate.getTime() <= 12 * 3_600_000) return 'Baja';
  return 'Media';
};

const getNextAction = (claim: Claim): string => {
  if (claim.status === 'Pending') {
    return claim.callCount > 0 ? 'Evaluar evidencia y diagnosticar' : 'Contactar al cliente y pedir evidencia';
  }
  if (claim.status === 'In Process') return 'Confirmar diagnóstico con yarda';
  if (claim.status === 'Resolved') return 'Cerrar bitácora y archivar';
  return 'Notificar la decisión al cliente';
};

const ClaimBoardCard: React.FC<{ claim: Claim; onOpen: (claim: Claim) => void }> = ({ claim, onOpen }) => {
  const sla = getClaimSla(claim);
  const priority = PRIORITY_META[getClaimPriority(claim, sla)];
  return (
    <button
      type="button"
      onClick={() => onOpen(claim)}
      className="group w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2.5 text-left transition-colors hover:border-[var(--brand)] hover:bg-[var(--bg-card-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      title={`${claim.id} · ${claim.customerName} · Asesor: ${claim.advisor} · ${claim.callCount || 0} llamadas`}
    >
      <span className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-[10.5px] font-bold text-[var(--brand)]">
          {claim.id}
          <span className="font-semibold text-[var(--text-secondary)]"> · {claim.orderCode}</span>
        </span>
        <span className={`inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wide ${priority.text}`}>
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${priority.dot}`} />
          {priority.label}
        </span>
      </span>
      <span className="mt-0.5 flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight text-[var(--text-primary)]">
          {claim.customerName}
        </span>
        <span className="max-w-[42%] shrink-0 truncate text-[10.5px] text-[var(--text-secondary)]">{claim.mainPart}</span>
      </span>
      <span className="mt-1.5 flex min-w-0 items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-1.5">
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${getSlaChipClass(claim, sla)}`}>
          <Icon name={sla.tone === 'overdue' ? 'timer_off' : 'timer'} size={12} />
          {sla.label}
        </span>
        <span className="inline-flex min-w-0 items-center gap-1 text-[10px] font-semibold text-[var(--text-secondary)]">
          <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-[13px]">arrow_forward</span>
          <span className="truncate">{getNextAction(claim)}</span>
        </span>
      </span>
    </button>
  );
};

export const ClaimsView: React.FC<ClaimsViewProps> = ({ orders = [], userRole = 'operador', onSelectOrder, focusOrderId }) => {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('Todos');
  const [priority, setPriority] = useState('Todas');
  const [operator, setOperator] = useState('Todos');
  const [view, setView] = useState<ClaimViewMode>(() => {
    if (typeof window === 'undefined') return 'board';
    try {
      return window.localStorage.getItem('radar.claims.view') === 'list' ? 'list' : 'board';
    } catch {
      return 'board';
    }
  });
  const [loading, setLoading] = useState(true);
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
  const focusHandledRef = useRef<string | null>(null);

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
    } finally {
      if (requestId === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!focusOrderId || focusHandledRef.current === focusOrderId || claims.length === 0) return;
    focusHandledRef.current = focusOrderId;
    const match = claims.find((claim) => String(claim.orderId) === String(focusOrderId) && !['Resolved', 'Denied'].includes(claim.status))
      || claims.find((claim) => String(claim.orderId) === String(focusOrderId));
    if (match) setSelectedId(match.id);
  }, [focusOrderId, claims]);

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
          (priority === 'Todas' || getClaimPriority(claim) === priority) &&
          (operator === 'Todos' || claim.advisor === operator)
        );
      }),
    [claims, search, status, priority, operator]
  );

  const operatorOptions = useMemo(() => {
    const names = new Set<string>();
    claims.forEach((claim) => {
      if (claim.advisor) names.add(claim.advisor);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [claims]);

  const selectedClaim = claims.find((claim) => claim.id === selectedId);

  const stats = useMemo(() => {
    const now = Date.now();
    const openClaims = claims.filter((c) => !['Resolved', 'Denied'].includes(c.status));
    const overdue = openClaims.filter((c) => getClaimSla(c, now).tone === 'overdue').length;
    const high = openClaims.filter((c) => getClaimPriority(c, getClaimSla(c, now), now) === 'Alta').length;
    const resolved = claims.filter((c) => c.status === 'Resolved').length;
    return { total: claims.length, open: openClaims.length, overdue, high, resolved };
  }, [claims]);

  const changeView = (next: ClaimViewMode) => {
    setView(next);
    if (next === 'board') setStatus('Todos');
    try {
      window.localStorage.setItem('radar.claims.view', next);
    } catch {
      // Preference persistence is optional; the view still switches for this session.
    }
  };

  const openClaim = (claim: Claim, action: ClaimQuickAction = '') => {
    setInitialAction(action);
    setSelectedId(claim.id);
  };

  const closeDetail = () => {
    setSelectedId(null);
    setInitialAction('');
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

  const changeStatus = async (claim: Claim, _targetStatus: ClaimStatus) => {
    setManagingId(String(claim.orderId));
  };

  const managingOrder = orders.find((order) => String(order.id) === managingId);
  const drawerClaim = managingOrder ? undefined : selectedClaim;

  if (managingOrder) {
    return (
      <FlowDialog
        open
        onClose={() => setManagingId('')}
        labelledBy="claim-manage-title"
        icon="shield_with_heart"
        title="Gestión de garantía"
        badge={
          <span className="rounded-lg border border-[var(--brand)] bg-[var(--brand-soft)] px-2.5 py-0.5 font-mono text-xs font-bold text-[var(--brand)]">
            #{managingOrder.code}
          </span>
        }
        subtitle={`${managingOrder.customer?.name || ''} · ${managingOrder.vehicle?.make || ''} ${managingOrder.vehicle?.model || ''}`.trim()}
        isBlocked={() => Boolean(document.querySelector('[role="dialog"][aria-modal="true"]:not([data-flow-dialog])'))}
      >
        <OrderAftersalesPanel order={managingOrder} />
      </FlowDialog>
    );
  }

  return (
    <div className="radar-view horizon-view space-y-5 pb-10 text-[var(--text-primary)]">
      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--state-urgency-border)] bg-[var(--state-urgency-tint)] p-3 text-xs sm:text-sm font-semibold text-[var(--state-urgency-text)]">
          <span className="flex items-center gap-2">
            <Icon name="error" size={18} />
            {error}
          </span>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-[var(--state-urgency-border)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-bold transition-colors hover:bg-[var(--bg-card-subtle)] cursor-pointer"
          >
            Reintentar
          </button>
        </div>
      )}
      {message && (
        <p role="status" className="rounded-xl border border-[var(--positive)] bg-[var(--bg-card-subtle)] p-3 text-xs sm:text-sm font-semibold text-[var(--positive)]">
          {message}
        </p>
      )}

      {/* Header */}
      <header className="horizon-view-header flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 shrink-0 rounded-2xl border border-[var(--state-urgency-border)] bg-[var(--state-urgency-tint)] text-[var(--state-urgency-text)] flex items-center justify-center">
            <span aria-hidden="true" className="material-symbols-outlined text-[24px]">build_circle</span>
          </span>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-[var(--text-primary)]">Reclamos</h1>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
              Garantías, seguimiento técnico y bitácora de llamadas
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Formato de vista" className="inline-flex rounded-xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)] p-0.5">
            {([
              { id: 'board', label: 'Tablero', icon: 'view_kanban' },
              { id: 'list', label: 'Lista', icon: 'table_rows' },
            ] as { id: ClaimViewMode; label: string; icon: string }[]).map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={view === option.id}
                onClick={() => changeView(option.id)}
                className={`inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                  view === option.id
                    ? 'bg-[var(--brand-soft)] text-[var(--brand)] shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{option.icon}</span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`${buttonClass} inline-flex items-center gap-1.5`}
            onClick={() => window.print()}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">print</span>
            <span>Imprimir</span>
          </button>
          <button
            type="button"
            className="horizon-primary rounded-xl px-4 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            onClick={() => setCreating(true)}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">add_circle</span>
            <span>Nuevo reclamo</span>
          </button>
        </div>
      </header>

      {/* KPI summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="horizon-view-card p-4 flex items-center justify-between gap-3">
          <div>
            <span className="text-xs text-[var(--text-secondary)] block">Total registrados</span>
            <strong className="text-2xl font-black text-[var(--text-primary)] tabular-nums">{stats.total}</strong>
          </div>
          <span className="w-10 h-10 rounded-xl bg-[var(--brand-soft)] border border-[var(--border-color)] text-[var(--brand)] flex items-center justify-center">
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">folder_special</span>
          </span>
        </div>

        <div className="horizon-view-card p-4 flex items-center justify-between gap-3">
          <div>
            <span className="text-xs text-[var(--text-secondary)] block">Abiertos</span>
            <strong className="text-2xl font-black text-[var(--text-primary)] tabular-nums">{stats.open}</strong>
          </div>
          <span className="w-10 h-10 rounded-xl bg-[var(--brand-soft)] border border-[var(--border-color)] text-[var(--brand)] flex items-center justify-center">
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">pending_actions</span>
          </span>
        </div>

        <div className="horizon-view-card p-4 flex items-center justify-between gap-3">
          <div>
            <span className="text-xs text-[var(--text-secondary)] block">SLA vencidos</span>
            <strong className="text-2xl font-black text-[var(--state-urgency-text)] tabular-nums">{stats.overdue}</strong>
            <span className="block text-[10.5px] text-[var(--text-secondary)]">{stats.high} de prioridad alta</span>
          </div>
          <span className="w-10 h-10 rounded-xl bg-[var(--state-urgency-tint)] border border-[var(--state-urgency-border)] text-[var(--state-urgency-text)] flex items-center justify-center">
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">timer_off</span>
          </span>
        </div>

        <div className="horizon-view-card p-4 flex items-center justify-between gap-3">
          <div>
            <span className="text-xs text-[var(--text-secondary)] block">Casos resueltos</span>
            <strong className="text-2xl font-black text-[var(--positive)] tabular-nums">{stats.resolved}</strong>
          </div>
          <span className="w-10 h-10 rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--positive)] text-[var(--positive)] flex items-center justify-center">
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">task_alt</span>
          </span>
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="horizon-view-toolbar horizon-view-card space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
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
            aria-label="Operador"
            value={operator}
            onChange={(event) => setOperator(event.target.value)}
          >
            <option value="Todos">Operador: todos</option>
            {operatorOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select
            className={fieldClass}
            aria-label="Prioridad"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            <option value="Todas">Prioridad: todas</option>
            <option value="Alta">Alta</option>
            <option value="Media">Media</option>
            <option value="Baja">Baja</option>
          </select>
          {view === 'list' && (
            <select
              className={fieldClass}
              aria-label="Estado del reclamo"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {STATUS_FILTERS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.id === 'Todos' ? 'Estado: todos' : option.label}
                </option>
              ))}
            </select>
          )}
          {(search || operator !== 'Todos' || priority !== 'Todas' || status !== 'Todos') && (
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                setSearch('');
                setOperator('Todos');
                setPriority('Todas');
                setStatus('Todos');
              }}
            >
              Limpiar filtros
            </button>
          )}
        </div>

        {view === 'list' && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--border-color)] pt-2">
            {STATUS_FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setStatus(option.id)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
                  status === option.id
                    ? 'bg-[var(--brand-soft)] border-[var(--brand)] text-[var(--brand)] shadow-sm'
                    : 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {option.label}
              </button>
            ))}
            <span className="ml-auto text-[11px] font-semibold text-[var(--text-secondary)] tabular-nums">
              {filtered.length} de {claims.length}
            </span>
          </div>
        )}
      </div>

      {view === 'board' ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {BOARD_COLUMNS.map((column) => {
            const items = filtered
              .filter((claim) => column.statuses.includes(claim.status))
              .sort((a, b) => {
                const rank = (claim: Claim) => {
                  const tone = getClaimSla(claim).tone;
                  return tone === 'overdue' ? 0 : tone === 'soon' ? 1 : tone === 'ok' ? 2 : 3;
                };
                const byRank = rank(a) - rank(b);
                return byRank !== 0 ? byRank : String(b.createdAt).localeCompare(String(a.createdAt));
              });
            const overdue = items.filter((claim) => getClaimSla(claim).tone === 'overdue').length;
            return (
              <section
                key={column.id}
                className="flex min-h-[220px] flex-col rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card-subtle)]"
              >
                <header className="flex items-center justify-between gap-2 border-b border-[var(--border-color)] px-3.5 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" className="material-symbols-outlined text-[17px] text-[var(--brand)]">{column.icon}</span>
                    <h2 className="truncate text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">{column.label}</h2>
                    <span className="rounded-full border border-[var(--border-color)] bg-[var(--bg-card)] px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums text-[var(--text-primary)]">
                      {items.length}
                    </span>
                  </div>
                  {overdue > 0 && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[10.5px] font-semibold text-[var(--state-urgency-text)]">
                      <Icon name="timer_off" size={13} />
                      {overdue} vencido{overdue === 1 ? '' : 's'}
                    </span>
                  )}
                </header>
                <div className="flex flex-1 flex-col gap-2 p-2.5">
                  {items.map((claim) => (
                    <ClaimBoardCard key={claim.id} claim={claim} onOpen={openClaim} />
                  ))}
                  {!items.length && (
                    <p className="px-2 py-10 text-center text-[11px] text-[var(--text-secondary)]">
                      {loading ? 'Cargando reclamos…' : column.empty}
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="horizon-view-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] table-fixed border-collapse text-left">
              <colgroup>
                <col className="w-[15%]" />
                <col className="w-[26%]" />
                <col className="w-[13%]" />
                <col className="w-[18%]" />
                <col className="w-[10%]" />
                <col className="hidden w-[9%] xl:table-column" />
                <col className="w-[9%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-[var(--border-color)] text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                  <th className="whitespace-nowrap px-3 py-2.5">Reclamo</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Cliente · Pieza</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Estado</th>
                  <th className="whitespace-nowrap px-3 py-2.5">SLA</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Prioridad</th>
                  <th className="hidden whitespace-nowrap px-3 py-2.5 xl:table-cell">Asesor</th>
                  <th className="px-3 py-2.5 text-right">Abrir</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((claim) => {
                  const sla = getClaimSla(claim);
                  const statusMeta = STATUS_META[claim.status] || {
                    label: claim.status,
                    cls: 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] text-[var(--text-secondary)]',
                    icon: 'info',
                  };
                  const priorityMeta = PRIORITY_META[getClaimPriority(claim, sla)];
                  return (
                    <tr
                      key={claim.id}
                      onClick={() => openClaim(claim)}
                      className="cursor-pointer border-b border-[var(--border-subtle)] transition-colors last:border-b-0 hover:bg-[var(--bg-card-subtle)]"
                    >
                      <td className="px-3 py-2.5 align-middle">
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-mono text-[11px] font-bold text-[var(--brand)]">{claim.id}</span>
                          <span className="truncate font-mono text-[10px] text-[var(--text-secondary)]">{claim.orderCode}</span>
                        </div>
                      </td>
                      <td className="min-w-0 px-3 py-2.5 align-middle">
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-xs font-semibold text-[var(--text-primary)]">{claim.customerName}</span>
                          <span className="truncate text-[10px] text-[var(--text-secondary)]" title={`${claim.vehicle} · ${claim.mainPart}`}>
                            {claim.vehicle} · {claim.mainPart}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusMeta.cls}`}>
                          <span aria-hidden="true" className="material-symbols-outlined text-[12px]">{statusMeta.icon}</span>
                          {statusMeta.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${getSlaChipClass(claim, sla)}`}>
                          <Icon name={sla.tone === 'overdue' ? 'timer_off' : 'timer'} size={12} />
                          {sla.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <span className={`inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide ${priorityMeta.text}`}>
                          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${priorityMeta.dot}`} />
                          {priorityMeta.label}
                        </span>
                      </td>
                      <td className="hidden px-3 py-2.5 align-middle xl:table-cell">
                        <span className="block truncate text-[11px] text-[var(--text-secondary)]" title={claim.advisor}>
                          {claim.advisor}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right align-middle">
                        <button
                          type="button"
                          className="rounded-lg border border-[var(--border-color)] px-2 py-1 text-[10.5px] font-bold text-[var(--brand)] transition-colors hover:border-[var(--brand)] cursor-pointer"
                          onClick={(event) => {
                            event.stopPropagation();
                            openClaim(claim);
                          }}
                        >
                          Detalle
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!filtered.length && (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-xs text-[var(--text-secondary)]">
                      {loading ? 'Cargando reclamos…' : 'No hay reclamos para estos filtros.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <FlowDialog
        open={Boolean(drawerClaim)}
        onClose={closeDetail}
        labelledBy="claim-detail-title"
        icon="support_agent"
        title="Detalle de reclamo"
        badge={
          drawerClaim ? (
            <span className="rounded-lg border border-[var(--brand)] bg-[var(--brand-soft)] px-2.5 py-0.5 font-mono text-xs font-bold text-[var(--brand)]">
              {drawerClaim.id}
            </span>
          ) : null
        }
        subtitle={
          drawerClaim
            ? `Orden ${drawerClaim.orderCode} · ${drawerClaim.customerName} · ${drawerClaim.vehicle}`
            : null
        }
        isBlocked={() => Boolean(document.querySelector('[role="dialog"][aria-modal="true"]:not([data-flow-dialog])'))}
      >
        {drawerClaim && (
          <ClaimDetailView
            embedded
            claim={{ ...drawerClaim, priority: getClaimPriority(drawerClaim) }}
            order={orders.find(
              (order) => String(order.id) === String(drawerClaim.orderId) || order.code === drawerClaim.orderCode
            )}
            userRole={userRole}
            initialAction={initialAction}
            onBack={closeDetail}
            onCallAdded={(call) =>
              setClaims((previous) =>
                previous.map((claim) =>
                  claim.id === drawerClaim.id
                    ? { ...claim, calls: [call, ...(claim.calls || [])], callCount: (claim.callCount || 0) + 1 }
                    : claim
                )
              )
            }
            onResolve={() => {
              setSelectedId(null);
              setInitialAction('');
              void changeStatus(drawerClaim, 'Resolved');
            }}
            onReloadClaims={load}
            onSelectOrder={
              onSelectOrder
                ? (selectedOrderId) => {
                    closeDetail();
                    onSelectOrder(selectedOrderId);
                  }
                : undefined
            }
          />
        )}
      </FlowDialog>
      {creating && (
        <div className="horizon-modal fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form
            onSubmit={create}
            className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl p-6 w-full max-w-xl space-y-4 shadow-xl"
          >
            <div className="flex items-center gap-3 pb-3 border-b border-[var(--border-color)]">
              <span className="w-10 h-10 rounded-xl bg-[var(--state-urgency-tint)] border border-[var(--state-urgency-border)] text-[var(--state-urgency-text)] flex items-center justify-center shrink-0">
                <span aria-hidden="true" className="material-symbols-outlined text-[20px]">report_problem</span>
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
            {error && <p role="alert" className="text-xs text-[var(--state-urgency-text)] font-semibold">{error}</p>}
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
