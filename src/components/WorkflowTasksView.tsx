import React, { useCallback, useEffect, useRef, useState } from 'react';
import { WorkflowActionForm, workflowResponse } from './OrderWorkflowPanel';
import { workflowTaskAssignee, type WorkflowTask } from '../utils/orderWorkflow';
import { apiFetch } from '../services/apiFetch';

export interface WorkflowQueue {
  followupAdvisors?: { id: number; name: string }[];
  today: string;
  tasks: WorkflowTask[];
  operators: {
    userId: number | null;
    name: string;
    completed: number;
    onTime: number;
    attempts: number;
    overdue: number;
    escalated: number;
    blocked: number;
    unassigned: number;
  }[];
}

const FollowupAssignment: React.FC<{
  task: WorkflowTask;
  advisors: { id: number; name: string }[];
  onSaved: () => Promise<void>;
}> = ({ task, advisors, onSaved }) => {
  const [advisor, setAdvisor] = useState(task.order.followupUserId ? String(task.order.followupUserId) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);

  const save = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await workflowResponse<{ ok: boolean; version: number }>(
        await apiFetch(`/orders/${task.order.id}/workflow/assignee`, {
          method: 'POST',
          body: JSON.stringify({ version: task.order.version, advisorId: advisor ? Number(advisor) : null }),
        })
      );
      if (!result.ok || result.version !== task.order.version + 1) {
        throw new Error('Respuesta de asignación inválida; actualiza antes de reintentar.');
      }
      window.dispatchEvent(new Event('radar:data-changed'));
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo asignar el seguimiento.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-bold text-cyan-400">
        <span className="material-symbols-outlined text-[15px]">manage_accounts</span>
        <span>Reasignación Post-Entrega (Supervisión)</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={advisor}
          disabled={busy}
          onChange={(event) => setAdvisor(event.target.value)}
          className="flex-1 min-w-[200px] text-xs py-1.5 px-3 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] focus:outline-none focus:border-cyan-400"
        >
          <option value="">{task.order.isYardSale ? 'Pendiente de asignación' : 'Asesor original de la venta'}</option>
          {task.order.followupUserId && !advisors.some((user) => user.id === task.order.followupUserId) && (
            <option value={String(task.order.followupUserId)} disabled>
              {task.order.followupAdvisor || 'Asesor asignado'} (no disponible)
            </option>
          )}
          {advisors.map((user) => (
            <option key={user.id} value={String(user.id)}>
              {user.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          className="cyber-btn-secondary px-3 py-1.5 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          onClick={() => void save()}
        >
          <span className="material-symbols-outlined text-[15px]">{busy ? 'sync' : 'check'}</span>
          <span>{busy ? 'Asignando…' : 'Guardar'}</span>
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-rose-400 font-semibold">{error}</p>}
    </div>
  );
};

const buckets = {
  all: 'Todas',
  overdue: 'Vencidas',
  today: 'Para hoy',
  waiting: 'Esperando respuesta',
  blocked: 'Bloqueadas',
  upcoming: 'Próximas',
} as const;

const categories = {
  all: { label: 'Todas las áreas', icon: 'apps' },
  commercial: { label: 'Flujo Comercial', icon: 'storefront' },
  post_delivery: { label: 'Seguimiento Post-Entrega', icon: 'support_agent' },
  incident: { label: 'Incidencias / Garantías', icon: 'shield_with_heart' },
} as const;

const getTaskCategory = (taskKey: string): keyof typeof categories => {
  if (taskKey.startsWith('post_')) return 'post_delivery';
  if (taskKey === 'incident') return 'incident';
  return 'commercial';
};

const getTaskCategoryIcon = (taskKey: string): string => {
  if (taskKey === 'post_3') return 'inventory';
  if (taskKey === 'post_7') return 'build_circle';
  if (taskKey === 'post_14') return 'verified_user';
  if (taskKey === 'quote') return 'request_quote';
  if (taskKey === 'ack') return 'verified';
  if (taskKey === 'prepare') return 'event_available';
  if (taskKey === 'delivery') return 'local_shipping';
  if (taskKey === 'incident') return 'report_problem';
  return 'assignment';
};

const getInitials = (name: string): string => {
  if (!name) return 'OP';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
};

const formatDueDate = (dueDate: string, todayStr?: string) => {
  const today = todayStr || new Date().toISOString().slice(0, 10);
  if (dueDate === today) {
    return { label: 'Vence Hoy', isToday: true, isOverdue: false };
  }
  if (dueDate < today) {
    return { label: `Vencida (${dueDate})`, isToday: false, isOverdue: true };
  }
  return { label: dueDate, isToday: false, isOverdue: false };
};

export const WorkflowTasksView: React.FC<{
  onSelectOrder: (id: string) => void;
  onNavigateIncident: (screen: 'reclamos' | 'reembolsos') => void;
  userRole: string;
  onLegacyFollowups?: () => void;
}> = ({ onSelectOrder, onNavigateIncident, userRole, onLegacyFollowups }) => {
  const [queue, setQueue] = useState<WorkflowQueue | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<keyof typeof buckets>('all');
  const [categoryFilter, setCategoryFilter] = useState<keyof typeof categories>('all');
  const [operator, setOperator] = useState('all');
  const [selected, setSelected] = useState<WorkflowTask | null>(null);
  const generation = useRef(0);
  const dialog = useRef<HTMLDivElement | null>(null);

  const reload = useCallback(async () => {
    const request = ++generation.current;
    setError('');
    try {
      const data = await workflowResponse<WorkflowQueue>(await apiFetch('/workflow/tasks'));
      if (request === generation.current) setQueue(data);
    } catch (reason) {
      if (request === generation.current) {
        setQueue(null);
        setError(reason instanceof Error ? reason.message : 'No se pudo cargar la bandeja.');
      }
    }
  }, []);

  useEffect(() => {
    void reload();
    window.addEventListener('radar:data-changed', reload);
    return () => {
      generation.current++;
      window.removeEventListener('radar:data-changed', reload);
    };
  }, [reload]);

  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel: HTMLDivElement | null = dialog.current;
    panel?.querySelector<HTMLElement>('select, input, textarea, button')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !panel?.querySelector('button[type="submit"]:disabled')) setSelected(null);
      if (event.key !== 'Tab' || !panel) return;
      const controls = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'
        )
      );
      const destination =
        event.shiftKey && document.activeElement === controls[0]
          ? controls[controls.length - 1]
          : !event.shiftKey && document.activeElement === controls[controls.length - 1]
          ? controls[0]
          : null;
      if (destination) {
        event.preventDefault();
        destination.focus();
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('keydown', keyboard);
      previous?.focus();
    };
  }, [selected?.order.id]);

  const tasks = (queue?.tasks || []).filter((task) => {
    const matchesBucket =
      filter === 'all' || (filter === 'overdue' ? task.overdue && task.bucket !== 'blocked' : task.bucket === filter);
    const matchesCategory = categoryFilter === 'all' || getTaskCategory(task.task) === categoryFilter;
    const matchesOperator =
      operator === 'all' || String(workflowTaskAssignee(task.order, task.task).userId) === operator;
    return matchesBucket && matchesCategory && matchesOperator;
  });

  return (
    <div className="radar-view horizon-view horizon-workflow-queue pb-8 space-y-6">
      {/* Header Card */}
      <div className="horizon-view-header">
        <div className="flex items-center gap-3.5">
          <div className="relative w-12 h-12 rounded-2xl bg-cyan-500/15 border border-cyan-500/35 text-cyan-400 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[26px]">task_alt</span>
            <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl md:text-2xl font-black text-[var(--text-primary)] tracking-tight">Mi trabajo de hoy</h1>
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-500">
                <span className="material-symbols-outlined text-[13px]">verified</span>
                <span>Flujo Post-Entrega Activo (Día 3 · 7 · 14)</span>
              </span>
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              Gestión comercial en días hábiles y seguimiento post-entrega para órdenes entregadas a partir de la activación del nuevo flujo. Las entregas previas quedan finalizadas automáticamente por el sistema.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => void reload()}
            className="cyber-btn-secondary px-3.5 py-2 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            title="Recargar tareas desde el servidor"
          >
            <span className="material-symbols-outlined text-[16px]">sync</span>
            <span>Actualizar tareas</span>
          </button>
          {onLegacyFollowups && (
            <button
              type="button"
              onClick={onLegacyFollowups}
              className="cyber-btn-secondary px-3.5 py-2 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              title="Abrir panel de seguimiento histórico"
            >
              <span className="material-symbols-outlined text-[16px]">history</span>
              <span>Seguimiento histórico</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/35 text-rose-400 text-xs font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-base">error</span>
          <span>{error}</span>
        </div>
      )}

      {!queue && !error && (
        <div role="status" className="p-8 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] text-center text-[var(--text-secondary)] text-xs font-semibold flex items-center justify-center gap-2">
          <span className="material-symbols-outlined text-cyan-400 animate-spin">progress_activity</span>
          <span>Cargando tareas del servidor…</span>
        </div>
      )}

      {queue && (
        <>
          {/* KPI Metric Cards */}
          <div className="horizon-view-metrics grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {/* Tareas Activas */}
            <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 flex items-center justify-between gap-3">
              <div>
                <span className="text-xs font-medium text-[var(--text-secondary)] block">Tareas Activas</span>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <strong className="text-2xl font-black text-[var(--text-primary)] tabular-nums">{queue.tasks.length}</strong>
                  <span className="text-[11px] font-semibold text-cyan-400">en cola</span>
                </div>
              </div>
              <span className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
                <span className="material-symbols-outlined text-[20px]">assignment</span>
              </span>
            </div>

            {/* Post-Entrega Activas */}
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center justify-between gap-3">
              <div>
                <span className="text-xs font-medium text-[var(--text-secondary)] block">Post-Entrega</span>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <strong className="text-2xl font-black text-emerald-500 tabular-nums">
                    {queue.tasks.filter((t) => t.task.startsWith('post_')).length}
                  </strong>
                  <span className="text-[11px] font-semibold text-emerald-500">Día 3/7/14</span>
                </div>
              </div>
              <span className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-500 shrink-0">
                <span className="material-symbols-outlined text-[20px]">support_agent</span>
              </span>
            </div>

            {/* Vencidas */}
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 flex items-center justify-between gap-3">
              <div>
                <span className="text-xs font-medium text-[var(--text-secondary)] block">Vencidas</span>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <strong className="text-2xl font-black text-rose-400 tabular-nums">
                    {queue.tasks.filter((t) => t.overdue && t.bucket !== 'blocked').length}
                  </strong>
                  <span className="text-[11px] font-semibold text-rose-400">prioridad alta</span>
                </div>
              </div>
              <span className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
                <span className="material-symbols-outlined text-[20px]">warning</span>
              </span>
            </div>

            {/* Escaladas */}
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-center justify-between gap-3">
              <div>
                <span className="text-xs font-medium text-[var(--text-secondary)] block">Escaladas</span>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <strong className="text-2xl font-black text-amber-500 tabular-nums">
                    {queue.tasks.filter((t) => t.escalated).length}
                  </strong>
                  <span className="text-[11px] font-semibold text-amber-500">supervisión</span>
                </div>
              </div>
              <span className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-500 shrink-0">
                <span className="material-symbols-outlined text-[20px]">priority_high</span>
              </span>
            </div>

            {/* Bloqueos Externos */}
            <div className="rounded-2xl border border-purple-500/30 bg-purple-500/5 p-4 flex items-center justify-between gap-3">
              <div>
                <span className="text-xs font-medium text-[var(--text-secondary)] block">Bloqueadas</span>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <strong className="text-2xl font-black text-purple-400 tabular-nums">
                    {queue.tasks.filter((t) => t.bucket === 'blocked').length}
                  </strong>
                  <span className="text-[11px] font-semibold text-purple-400">en espera</span>
                </div>
              </div>
              <span className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
                <span className="material-symbols-outlined text-[20px]">lock</span>
              </span>
            </div>
          </div>

          {/* Area / Category Filter Bar */}
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                {(Object.entries(categories) as [keyof typeof categories, { label: string; icon: string }][]).map(
                  ([key, meta]) => {
                    const count =
                      key === 'all'
                        ? queue.tasks.length
                        : queue.tasks.filter((t) => getTaskCategory(t.task) === key).length;
                    const active = categoryFilter === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setCategoryFilter(key)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                          active
                            ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400'
                            : 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[15px]">{meta.icon}</span>
                        <span>{meta.label}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums ${
                            active ? 'bg-cyan-500/25 text-cyan-300' : 'bg-[var(--bg-card)] text-[var(--text-secondary)]'
                          }`}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  }
                )}
              </div>

              {userRole === 'admin' && (
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[var(--text-secondary)] text-[18px]">filter_alt</span>
                  <select
                    aria-label="Operador de tareas"
                    value={operator}
                    onChange={(event) => setOperator(event.target.value)}
                    className="text-xs py-1.5 px-3 rounded-xl bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] focus:outline-none focus:border-cyan-400 font-semibold cursor-pointer"
                  >
                    <option value="all">Todos los operadores</option>
                    {queue.operators.map((item) => (
                      <option key={String(item.userId)} value={String(item.userId)}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Bucket Filter Pills */}
            <div className="horizon-view-toolbar flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--border-color)]">
              {Object.entries(buckets).map(([key, label]) => {
                const count =
                  key === 'all'
                    ? queue.tasks.length
                    : key === 'overdue'
                    ? queue.tasks.filter((t) => t.overdue && t.bucket !== 'blocked').length
                    : queue.tasks.filter((t) => t.bucket === key).length;
                const active = filter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setFilter(key as keyof typeof buckets)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                      active
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-500'
                        : 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <span>{label}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums ${
                        active ? 'bg-emerald-500/25 text-emerald-400' : 'bg-[var(--bg-card)] text-[var(--text-secondary)]'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Empty State */}
          {!tasks.length && (
            <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] p-10 text-center space-y-2">
              <span className="material-symbols-outlined text-4xl text-emerald-500/60">task_alt</span>
              <p className="text-sm font-bold text-[var(--text-primary)]">No hay tareas pendientes en este filtro</p>
              <p className="text-xs text-[var(--text-secondary)]">
                Todas las tareas comerciales y de seguimiento post-entrega para el criterio seleccionado están al día.
              </p>
            </div>
          )}

          {/* Modern Visual Tasks Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {tasks.map((task) => {
              const assignee = workflowTaskAssignee(task.order, task.task);
              const isUnassigned = assignee.userId === null;
              const isOverdue = task.overdue && task.bucket !== 'blocked';
              const category = getTaskCategory(task.task);
              const categoryIcon = getTaskCategoryIcon(task.task);
              const dueInfo = formatDueDate(task.dueDate, queue.today);
              const isPostDelivery = category === 'post_delivery';

              const postSteps = [
                { key: 'post_3', label: 'Día 3 · Recepción', done: Boolean(task.order.post3CompletedAt) },
                { key: 'post_7', label: 'Día 7 · Instalación', done: Boolean(task.order.post7CompletedAt) },
                { key: 'post_14', label: 'Día 14 · Cierre Garantía', done: Boolean(task.order.post14CompletedAt) },
              ];

              const commercialSteps = [
                { key: 'quote', label: '1. Cotización', done: Boolean(task.order.quoteCompletedAt) },
                { key: 'ack', label: '2. Confirmación', done: Boolean(task.order.ackCompletedAt) },
                { key: 'prepare', label: '3. Preparación', done: Boolean(task.order.prepareCompletedAt) },
                { key: 'delivery', label: '4. Entrega', done: Boolean(task.order.deliveryCompletedAt || task.order.deliveredAt) },
              ];

              return (
                <article
                  key={task.order.id}
                  className={`rounded-2xl bg-[var(--bg-card)] border p-5 transition-all flex flex-col justify-between gap-4 ${
                    isOverdue
                      ? 'border-rose-500/40'
                      : task.escalated
                      ? 'border-amber-500/40'
                      : task.bucket === 'blocked'
                      ? 'border-purple-500/40'
                      : isPostDelivery
                      ? 'border-emerald-500/30'
                      : 'border-[var(--border-color)]'
                  }`}
                >
                  <div className="space-y-3.5">
                    {/* Top Bar: Code, Customer, Category & Due Date Badge */}
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2.5 py-1 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 font-bold text-xs flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[15px]">receipt_long</span>
                          <span>{task.order.code}</span>
                        </span>

                        {task.order.customerName && (
                          <span className="px-2.5 py-1 rounded-lg bg-[var(--bg-card-subtle)] border border-[var(--border-color)] text-[var(--text-primary)] text-xs font-semibold flex items-center gap-1 max-w-[200px] truncate">
                            <span className="material-symbols-outlined text-[14px] text-[var(--text-secondary)]">person</span>
                            <span className="truncate">{task.order.customerName}</span>
                          </span>
                        )}

                        {isPostDelivery && (
                          <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 text-[11px] font-bold flex items-center gap-1">
                            <span className="material-symbols-outlined text-[13px]">support_agent</span>
                            <span>Post-Entrega</span>
                          </span>
                        )}

                        {task.order.isYardSale && (
                          <span className="px-2 py-0.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-500 text-[11px] font-bold">
                            Yarda
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 border ${
                            task.bucket === 'overdue' || isOverdue
                              ? 'bg-rose-500/15 text-rose-400 border-rose-500/35'
                              : task.bucket === 'today'
                              ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/35'
                              : task.bucket === 'waiting'
                              ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/35'
                              : task.bucket === 'blocked'
                              ? 'bg-purple-500/15 text-purple-400 border-purple-500/35'
                              : 'bg-[var(--bg-card-subtle)] text-[var(--text-secondary)] border-[var(--border-color)]'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            {task.bucket === 'overdue' || isOverdue
                              ? 'warning'
                              : task.bucket === 'today'
                              ? 'today'
                              : task.bucket === 'waiting'
                              ? 'hourglass_top'
                              : task.bucket === 'blocked'
                              ? 'lock'
                              : 'schedule'}
                          </span>
                          <span>{dueInfo.label}</span>
                        </span>
                      </div>
                    </div>

                    {/* Task Title & Icon */}
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 ${
                          isPostDelivery
                            ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-500'
                            : category === 'incident'
                            ? 'bg-rose-500/15 border-rose-500/35 text-rose-400'
                            : 'bg-cyan-500/15 border-cyan-500/35 text-cyan-400'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[20px]">{categoryIcon}</span>
                      </div>
                      <div className="space-y-1 flex-1">
                        <h2 className="text-base font-bold text-[var(--text-primary)] leading-snug">
                          {task.title}
                        </h2>
                        {task.requirement && (
                          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                            {task.requirement}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Visual Step Progress Bar */}
                    {isPostDelivery ? (
                      <div className="rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] p-3 space-y-2">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-bold text-[var(--text-secondary)] flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px] text-emerald-500">route</span>
                            <span>Ruta de Seguimiento Post-Entrega</span>
                          </span>
                          {task.order.deliveredAt && (
                            <span className="text-[var(--text-secondary)] tabular-nums">
                              Entregada: {task.order.deliveredAt.slice(0, 10)}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {postSteps.map((step) => {
                            const active = task.task === step.key;
                            return (
                              <div
                                key={step.key}
                                className={`rounded-lg px-2.5 py-1.5 border text-[11px] font-semibold flex items-center gap-1.5 ${
                                  step.done
                                    ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-500'
                                    : active
                                    ? 'bg-cyan-500/15 border-cyan-500/45 text-cyan-400'
                                    : 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-secondary)]'
                                }`}
                              >
                                <span className="material-symbols-outlined text-[14px]">
                                  {step.done ? 'check_circle' : active ? 'radio_button_checked' : 'schedule'}
                                </span>
                                <span className="truncate">{step.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : category === 'commercial' ? (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                        {commercialSteps.map((step) => {
                          const active = task.task === step.key;
                          return (
                            <div
                              key={step.key}
                              className={`rounded-lg px-2 py-1.5 border text-[11px] font-semibold flex items-center gap-1 ${
                                step.done
                                  ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-500'
                                  : active
                                  ? 'bg-cyan-500/15 border-cyan-500/45 text-cyan-400'
                                  : 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] text-[var(--text-secondary)]'
                              }`}
                            >
                              <span className="material-symbols-outlined text-[13px]">
                                {step.done ? 'check_circle' : active ? 'radio_button_checked' : 'schedule'}
                              </span>
                              <span className="truncate">{step.label}</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    {/* Operational Alerts */}
                    {task.order.yardPieceReady && (
                      <div className="px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/35 text-emerald-500 text-xs font-bold flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px]">check_circle</span>
                        <span>¡PIEZA LISTA EN YARDA! — Contactar al comprador para acordar entrega</span>
                      </div>
                    )}
                    {task.order.status === 'espera_confirmacion' && (
                      <div className="px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/35 text-amber-500 text-xs font-bold flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px]">hourglass_top</span>
                        <span>Anticipo Zelle/Cash App pendiente de verificación en banco por Admin</span>
                      </div>
                    )}

                    {/* Assignee & Sales Context Pills */}
                    <div className="flex flex-wrap items-center gap-2">
                      <div
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                          isUnassigned
                            ? 'bg-amber-500/15 border-amber-500/35 text-amber-500'
                            : 'bg-[var(--bg-card-subtle)] border-[var(--border-color)] text-[var(--text-primary)]'
                        }`}
                      >
                        <span className="w-5 h-5 rounded-md bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-[10px] font-black shrink-0">
                          {getInitials(assignee.name)}
                        </span>
                        <span>{assignee.name}</span>
                        {isUnassigned && <span className="text-[10px] font-bold">(Sin Asignar)</span>}
                      </div>

                      {task.order.deliveredAt && task.order.advisor && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--bg-card-subtle)] border border-[var(--border-color)] text-[var(--text-secondary)] text-xs font-medium">
                          <span className="material-symbols-outlined text-[13px]">storefront</span>
                          <span>Venta: {task.order.advisor}</span>
                        </span>
                      )}
                    </div>

                    {/* Next Action Callout Box */}
                    <div className="rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-color)] p-3 space-y-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-cyan-400">
                        <span className="material-symbols-outlined text-[14px]">play_circle</span>
                        <span>Próxima Gestión Operativa</span>
                      </div>
                      <p className="text-xs text-[var(--text-primary)] font-medium leading-relaxed">
                        {task.nextAction}
                      </p>
                    </div>

                    {/* Visual Alerts: Escalated / Blocked / Regularization */}
                    {task.escalated && (
                      <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-semibold flex items-center gap-2">
                        <span className="material-symbols-outlined text-[16px] shrink-0">priority_high</span>
                        <span>Aviso a supervisión: Al menos un día hábil de retraso.</span>
                      </div>
                    )}

                    {task.blockedBy && (
                      <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 text-xs font-semibold flex items-center gap-2">
                        <span className="material-symbols-outlined text-[16px] shrink-0">lock</span>
                        <span>Bloqueo externo: {task.blockedBy} · Revisión: {task.dueDate}</span>
                      </div>
                    )}

                    {task.regularization && (
                      <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-500 text-xs font-semibold flex items-center gap-2">
                        <span className="material-symbols-outlined text-[16px] shrink-0">history_edu</span>
                        <span>Regularización de evidencia histórica pendiente.</span>
                      </div>
                    )}

                    {/* Admin Followup Assignment Control */}
                    {userRole === 'admin' && task.order.deliveredAt && (
                      <FollowupAssignment
                        key={`${task.order.id}-${task.order.version}`}
                        task={task}
                        advisors={queue.followupAdvisors || []}
                        onSaved={reload}
                      />
                    )}
                  </div>

                  {/* Card Action Buttons */}
                  <div className="flex flex-wrap items-center gap-2.5 pt-3 border-t border-[var(--border-color)]">
                    <button
                      type="button"
                      onClick={() => setSelected(task)}
                      className="cyber-btn-primary px-4 py-2 text-xs font-black flex items-center gap-1.5 flex-1 justify-center cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px]">tune</span>
                      <span>{isPostDelivery ? 'Registrar Seguimiento' : 'Gestionar Tarea'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectOrder(task.order.id)}
                      className="cyber-btn-secondary px-3.5 py-2 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                      title="Abrir detalle completo de la orden"
                    >
                      <span className="material-symbols-outlined text-[16px]">visibility</span>
                      <span>Ver Orden</span>
                    </button>

                    {task.needsIncident && (
                      <button
                        type="button"
                        onClick={() =>
                          onNavigateIncident(task.order.status === 'solicitud_reembolso' ? 'reembolsos' : 'reclamos')
                        }
                        className="px-3 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-500 border border-amber-500/35 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                        title="Gestionar reclamo o devolución"
                      >
                        <span className="material-symbols-outlined text-[16px]">warning_amber</span>
                        <span>Incidencia</span>
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {/* Supervisor Metrics Table (Admin Only) */}
          {userRole === 'admin' && (
            <section className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] p-5 md:p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border-color)] pb-3">
                <div>
                  <h2 className="text-base font-black text-[var(--text-primary)] flex items-center gap-2">
                    <span className="material-symbols-outlined text-cyan-400 text-[20px]">supervisor_account</span>
                    <span>Supervisión y Rendimiento por Operador</span>
                  </h2>
                  <p className="text-xs text-[var(--text-secondary)] mt-1">
                    Cumplimiento de objetivos confirmados en plazo. Los intentos y bloqueos se contabilizan de forma independiente.
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-[var(--border-color)] text-[var(--text-secondary)] text-[11px] uppercase tracking-wider">
                      <th className="py-3 px-3">Operador</th>
                      <th className="py-3 px-3 text-center">Confirmados</th>
                      <th className="py-3 px-3 text-center">Cumplimiento</th>
                      <th className="py-3 px-3 text-center">Intentos</th>
                      <th className="py-3 px-3 text-center text-rose-400">Vencidas</th>
                      <th className="py-3 px-3 text-center text-amber-500">Escaladas</th>
                      <th className="py-3 px-3 text-center text-purple-400">Bloqueadas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-color)]">
                    {queue.operators.map((item) => {
                      const percentage = item.completed ? Math.round((item.onTime / item.completed) * 100) : null;
                      return (
                        <tr key={String(item.userId)} className="hover:bg-[var(--bg-card-subtle)] transition-colors">
                          <td className="py-3 px-3 font-bold text-[var(--text-primary)] flex items-center gap-2">
                            <span className="w-6 h-6 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-[10px] font-black">
                              {getInitials(item.name)}
                            </span>
                            <span>{item.name}</span>
                          </td>
                          <td className="py-3 px-3 text-center text-[var(--text-primary)] tabular-nums">{item.completed}</td>
                          <td className="py-3 px-3 text-center">
                            {percentage !== null ? (
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  percentage >= 80
                                    ? 'neon-badge-emerald'
                                    : percentage >= 50
                                    ? 'neon-badge-amber'
                                    : 'neon-badge-rose'
                                }`}
                              >
                                {percentage}%
                              </span>
                            ) : (
                              <span className="text-[var(--text-secondary)] text-[10px]">Sin datos</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-center text-[var(--text-secondary)] tabular-nums">{item.attempts}</td>
                          <td className="py-3 px-3 text-center font-bold text-rose-400 tabular-nums">{item.overdue}</td>
                          <td className="py-3 px-3 text-center font-bold text-amber-500 tabular-nums">{item.escalated}</td>
                          <td className="py-3 px-3 text-center font-bold text-purple-400 tabular-nums">{item.blocked}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {/* Task Action Modal */}
      {selected && (
        <div
          className="horizon-modal fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Gestionar tarea de orden"
        >
          <div
            ref={dialog}
            className="relative w-full max-w-3xl my-auto rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] p-5 md:p-6 shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
          >
            <WorkflowActionForm
              key={`${selected.order.id}-${selected.order.version}`}
              task={selected}
              onSaved={async () => {
                await reload();
                setSelected(null);
              }}
              onCancel={() => setSelected(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
};
