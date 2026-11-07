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
    <div className="rounded-2xl bg-[#030610]/90 border border-cyan-500/20 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-mono text-cyan-300">
        <span className="material-symbols-outlined text-[16px]">manage_accounts</span>
        <span>Reasignación Post-Entrega (Supervisión)</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={advisor}
          disabled={busy}
          onChange={(event) => setAdvisor(event.target.value)}
          className="flex-1 min-w-[200px] text-xs py-1.5 px-3 rounded-xl bg-[#070c18] border border-cyan-500/30 text-white focus:outline-none focus:border-cyan-400 font-mono"
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
      {error && <p role="alert" className="text-xs text-rose-400 font-mono">{error}</p>}
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

const getTaskCategoryIcon = (taskKey: string): string => {
  if (taskKey.startsWith('post_')) return 'contact_phone';
  if (taskKey === 'downpayment') return 'payments';
  if (taskKey === 'confirmation') return 'verified_user';
  if (taskKey === 'preparation') return 'inventory_2';
  if (taskKey === 'ready_pickup') return 'storefront';
  if (taskKey === 'delivery') return 'local_shipping';
  if (taskKey === 'incident') return 'gavel';
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
    return matchesBucket && (operator === 'all' || String(workflowTaskAssignee(task.order, task.task).userId) === operator);
  });

  return (
    <div className="radar-view horizon-view horizon-workflow-queue pb-8 space-y-6">
      {/* Cyber Header Card */}
      <div className="horizon-view-header">
        <div className="flex items-center gap-3.5">
          <div className="relative w-12 h-12 rounded-2xl bg-[#040814] border border-cyan-500/40 text-cyan-300 flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.3)] shrink-0">
            <span className="material-symbols-outlined text-[26px]">task_alt</span>
            <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">Mi trabajo de hoy</h1>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Órdenes desde el 21 de octubre de 2026. Primera gestión y reintento en días hábiles; hitos post-entrega 3, 7 y 14.
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
        <div role="alert" className="p-4 rounded-2xl bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs font-mono flex items-center gap-2">
          <span className="material-symbols-outlined text-base">error</span>
          <span>{error}</span>
        </div>
      )}

      {!queue && !error && (
        <div role="status" className="p-8 rounded-3xl bg-[#070c18]/90 border border-cyan-500/20 text-center text-slate-400 text-xs font-mono flex items-center justify-center gap-2">
          <span className="material-symbols-outlined text-cyan-400 animate-spin">progress_activity</span>
          <span>Cargando tareas del servidor…</span>
        </div>
      )}

      {queue && (
        <>
          {/* Cyber Metric Cards */}
          <div className="horizon-view-metrics grid gap-4 grid-cols-2 lg:grid-cols-4">
            {/* Tareas Activas */}
            <div className="relative rounded-2xl bg-[#070c18]/90 border border-cyan-500/25 p-4 shadow-[0_4px_20px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col justify-between">
              <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#22d3ee]" />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-400 font-mono font-medium">Tareas Activas</span>
                <span className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                  <span className="material-symbols-outlined text-[16px]">assignment</span>
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <strong className="text-2xl md:text-3xl font-black text-white font-mono">{queue.tasks.length}</strong>
                <span className="text-[10px] text-cyan-400 font-mono">en cola</span>
              </div>
            </div>

            {/* Vencidas */}
            <div className="relative rounded-2xl bg-[#070c18]/90 border border-rose-500/25 p-4 shadow-[0_4px_20px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col justify-between">
              <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-rose-500 to-transparent shadow-[0_0_8px_#f43f5e]" />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-400 font-mono font-medium">Vencidas</span>
                <span className="w-7 h-7 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400">
                  <span className="material-symbols-outlined text-[16px]">warning</span>
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <strong className="text-2xl md:text-3xl font-black text-rose-400 font-mono">
                  {queue.tasks.filter((t) => t.overdue && t.bucket !== 'blocked').length}
                </strong>
                <span className="text-[10px] text-rose-400 font-mono">prioridad alta</span>
              </div>
            </div>

            {/* Escaladas */}
            <div className="relative rounded-2xl bg-[#070c18]/90 border border-amber-500/25 p-4 shadow-[0_4px_20px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col justify-between">
              <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_8px_#fbbf24]" />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-400 font-mono font-medium">Escaladas</span>
                <span className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <span className="material-symbols-outlined text-[16px]">priority_high</span>
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <strong className="text-2xl md:text-3xl font-black text-amber-400 font-mono">
                  {queue.tasks.filter((t) => t.escalated).length}
                </strong>
                <span className="text-[10px] text-amber-400 font-mono">supervisión</span>
              </div>
            </div>

            {/* Bloqueos Externos */}
            <div className="relative rounded-2xl bg-[#070c18]/90 border border-purple-500/25 p-4 shadow-[0_4px_20px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col justify-between">
              <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-purple-400 to-transparent shadow-[0_0_8px_#c084fc]" />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-400 font-mono font-medium">Bloqueadas</span>
                <span className="w-7 h-7 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
                  <span className="material-symbols-outlined text-[16px]">lock</span>
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <strong className="text-2xl md:text-3xl font-black text-purple-400 font-mono">
                  {queue.tasks.filter((t) => t.bucket === 'blocked').length}
                </strong>
                <span className="text-[10px] text-purple-400 font-mono">externas</span>
              </div>
            </div>
          </div>

          {/* Filter Toolbar */}
          <div className="horizon-view-toolbar flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {Object.entries(buckets).map(([key, label]) => {
                const count =
                  key === 'all'
                    ? queue.tasks.length
                    : key === 'overdue'
                    ? queue.tasks.filter((t) => t.overdue && t.bucket !== 'blocked').length
                    : queue.tasks.filter((t) => t.bucket === key).length;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={filter === key}
                    onClick={() => setFilter(key as keyof typeof buckets)}
                    className={`px-3 py-2 rounded-xl text-xs font-mono font-bold transition-all flex items-center gap-2 cursor-pointer ${
                      filter === key
                        ? 'bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.4)]'
                        : 'bg-[#040814]/80 text-slate-300 hover:text-white border border-cyan-500/20 hover:border-cyan-500/40'
                    }`}
                  >
                    <span>{label}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                        filter === key ? 'bg-slate-950/30 text-slate-950 font-black' : 'bg-slate-800 text-cyan-300'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {userRole === 'admin' && (
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-slate-400 text-[18px]">filter_alt</span>
                <select
                  aria-label="Operador de tareas"
                  value={operator}
                  onChange={(event) => setOperator(event.target.value)}
                  className="text-xs py-2 px-3 rounded-xl bg-[#040814] border border-cyan-500/30 text-white focus:outline-none focus:border-cyan-400 font-mono cursor-pointer"
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

          {/* Empty State */}
          {!tasks.length && (
            <div className="rounded-3xl bg-[#070c18]/90 border border-cyan-500/20 p-10 text-center space-y-2">
              <span className="material-symbols-outlined text-4xl text-cyan-400/50">task_alt</span>
              <p className="text-sm font-bold text-slate-200">No hay tareas pendientes en este filtro</p>
              <p className="text-xs text-slate-400">Todas las tareas para el criterio seleccionado están al día.</p>
            </div>
          )}

          {/* Modern Visual Tasks Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {tasks.map((task) => {
              const assignee = workflowTaskAssignee(task.order, task.task);
              const isUnassigned = assignee.userId === null;
              const isOverdue = task.overdue && task.bucket !== 'blocked';
              const categoryIcon = getTaskCategoryIcon(task.task);
              const dueInfo = formatDueDate(task.dueDate, queue.today);

              return (
                <article
                  key={task.order.id}
                  className={`relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.5)] overflow-hidden transition-all duration-300 hover:border-cyan-400/50 hover:shadow-[0_10px_35px_rgba(6,182,212,0.15)] flex flex-col justify-between gap-4 group ${
                    isOverdue
                      ? 'border-rose-500/30'
                      : task.escalated
                      ? 'border-amber-500/30'
                      : task.bucket === 'blocked'
                      ? 'border-purple-500/30'
                      : 'border-cyan-500/25'
                  }`}
                >
                  {/* Glowing Top Accent Line */}
                  <div
                    className={`absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r ${
                      isOverdue
                        ? 'from-transparent via-rose-500 to-transparent shadow-[0_0_12px_#f43f5e]'
                        : task.escalated
                        ? 'from-transparent via-amber-400 to-transparent shadow-[0_0_12px_#fbbf24]'
                        : task.bucket === 'blocked'
                        ? 'from-transparent via-purple-400 to-transparent shadow-[0_0_12px_#c084fc]'
                        : 'from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#22d3ee]'
                    }`}
                  />

                  <div className="space-y-3.5">
                    {/* Top Bar: Code, Customer & Status Badges */}
                    <div className="flex flex-wrap items-start justify-between gap-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-3 py-1 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 font-mono font-bold text-xs tracking-wider flex items-center gap-1.5 shadow-[0_0_10px_rgba(6,182,212,0.15)]">
                          <span className="material-symbols-outlined text-[15px]">receipt_long</span>
                          <span>{task.order.code}</span>
                        </span>

                        {task.order.customerName && (
                          <span className="px-2.5 py-1 rounded-xl bg-slate-800/60 border border-slate-700/60 text-slate-300 text-xs font-medium flex items-center gap-1 max-w-[200px] truncate">
                            <span className="material-symbols-outlined text-[14px] text-slate-400">person</span>
                            <span className="truncate">{task.order.customerName}</span>
                          </span>
                        )}

                        {task.order.isYardSale && (
                          <span className="px-2 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 font-mono text-[10px] font-bold">
                            Yarda
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* Bucket / Due Date Badge */}
                        <span
                          className={`px-2.5 py-1 rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 ${
                            task.bucket === 'overdue' || isOverdue
                              ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30 shadow-[0_0_10px_rgba(244,63,94,0.2)]'
                              : task.bucket === 'today'
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                              : task.bucket === 'waiting'
                              ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                              : task.bucket === 'blocked'
                              ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30 shadow-[0_0_10px_rgba(192,132,252,0.2)]'
                              : 'bg-slate-800/80 text-slate-300 border border-slate-700/60'
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
                      <div className="w-10 h-10 rounded-2xl bg-[#040814] border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.15)] shrink-0 mt-0.5">
                        <span className="material-symbols-outlined text-[20px]">{categoryIcon}</span>
                      </div>
                      <div>
                        <h2 className="text-base font-bold text-white tracking-tight leading-snug group-hover:text-cyan-300 transition-colors">
                          {task.title}
                        </h2>
                        {task.requirement && (
                          <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                            {task.requirement}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Operational Assignee & Context Pills */}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <div
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-mono border ${
                          isUnassigned
                            ? 'bg-amber-950/40 border-amber-500/40 text-amber-300'
                            : 'bg-[#040814] border-cyan-500/20 text-slate-300'
                        }`}
                      >
                        <span className="w-5 h-5 rounded-lg bg-cyan-500/20 text-cyan-300 flex items-center justify-center text-[10px] font-black shrink-0">
                          {getInitials(assignee.name)}
                        </span>
                        <span>{assignee.name}</span>
                        {isUnassigned && (
                          <span className="text-[10px] text-amber-400 font-bold">(Sin Asignar)</span>
                        )}
                      </div>

                      {task.order.deliveredAt && task.order.advisor && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-[#040814] border border-slate-700/50 text-slate-400 text-xs font-mono">
                          <span className="material-symbols-outlined text-[13px] text-slate-500">storefront</span>
                          <span>Venta: {task.order.advisor}</span>
                        </span>
                      )}
                    </div>

                    {/* Highlighted Action Callout Box ("Próxima Acción") */}
                    <div className="relative rounded-2xl bg-[#040814]/90 border border-cyan-500/25 p-3.5 space-y-1 overflow-hidden">
                      <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-cyan-400">
                        <span className="material-symbols-outlined text-[14px]">play_circle</span>
                        <span>Próxima Gestión Operativa</span>
                      </div>
                      <p className="text-xs text-slate-200 font-medium leading-relaxed">
                        {task.nextAction}
                      </p>
                    </div>

                    {/* Visual Alerts: Escalated / Blocked / Regularization */}
                    {task.escalated && (
                      <div className="p-2.5 rounded-xl bg-red-950/40 border border-red-500/30 text-red-300 text-xs font-mono flex items-center gap-2">
                        <span className="material-symbols-outlined text-[16px] text-red-400 shrink-0">priority_high</span>
                        <span>Aviso a supervisión: Al menos un día hábil de retraso.</span>
                      </div>
                    )}

                    {task.blockedBy && (
                      <div className="p-2.5 rounded-xl bg-purple-950/40 border border-purple-500/30 text-purple-300 text-xs font-mono flex items-center gap-2">
                        <span className="material-symbols-outlined text-[16px] text-purple-400 shrink-0">lock</span>
                        <span>Bloqueo externo: {task.blockedBy} · Revisión: {task.dueDate}</span>
                      </div>
                    )}

                    {task.regularization && (
                      <div className="p-2.5 rounded-xl bg-amber-950/40 border border-amber-500/30 text-amber-300 text-xs font-mono flex items-center gap-2">
                        <span className="material-symbols-outlined text-[16px] text-amber-400 shrink-0">history_edu</span>
                        <span>Regularización de evidencia histórica pendiente.</span>
                      </div>
                    )}

                    {/* Super Admin Followup Assignment Control */}
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
                  <div className="flex flex-wrap items-center gap-2.5 pt-3 border-t border-cyan-500/15">
                    <button
                      type="button"
                      onClick={() => setSelected(task)}
                      className="cyber-btn-primary px-4 py-2 text-xs font-black flex items-center gap-1.5 flex-1 justify-center cursor-pointer shadow-[0_0_12px_rgba(6,182,212,0.3)]"
                    >
                      <span className="material-symbols-outlined text-[16px]">tune</span>
                      <span>Gestionar Tarea</span>
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
                        className="px-3 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
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
            <section className="relative rounded-3xl bg-[#070c18]/90 backdrop-blur-2xl border border-cyan-500/25 p-5 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.6)] overflow-hidden space-y-4">
              <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_10px_#22d3ee]" />

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-cyan-500/15 pb-3">
                <div>
                  <h2 className="text-base font-black text-white uppercase font-mono tracking-wider flex items-center gap-2">
                    <span className="material-symbols-outlined text-cyan-400 text-[20px]">supervisor_account</span>
                    <span>Supervisión y Rendimiento por Operador</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Cumplimiento de objetivos confirmados en plazo. Los intentos y bloqueos se contabilizan de forma independiente.
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left font-mono">
                  <thead>
                    <tr className="border-b border-cyan-500/20 text-slate-400 text-[11px] uppercase tracking-wider">
                      <th className="py-3 px-3">Operador</th>
                      <th className="py-3 px-3 text-center">Confirmados</th>
                      <th className="py-3 px-3 text-center">Cumplimiento</th>
                      <th className="py-3 px-3 text-center">Intentos</th>
                      <th className="py-3 px-3 text-center text-rose-400">Vencidas</th>
                      <th className="py-3 px-3 text-center text-amber-400">Escaladas</th>
                      <th className="py-3 px-3 text-center text-purple-400">Bloqueadas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cyan-500/10">
                    {queue.operators.map((item) => {
                      const percentage = item.completed ? Math.round((item.onTime / item.completed) * 100) : null;
                      return (
                        <tr key={String(item.userId)} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-3 px-3 font-bold text-white flex items-center gap-2">
                            <span className="w-6 h-6 rounded-lg bg-cyan-500/20 text-cyan-300 flex items-center justify-center text-[10px] font-black">
                              {getInitials(item.name)}
                            </span>
                            <span>{item.name}</span>
                          </td>
                          <td className="py-3 px-3 text-center text-slate-200">{item.completed}</td>
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
                              <span className="text-slate-500 text-[10px]">Sin datos</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-center text-slate-300">{item.attempts}</td>
                          <td className="py-3 px-3 text-center font-bold text-rose-400">{item.overdue}</td>
                          <td className="py-3 px-3 text-center font-bold text-amber-400">{item.escalated}</td>
                          <td className="py-3 px-3 text-center font-bold text-purple-400">{item.blocked}</td>
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
          className="horizon-modal fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-label="Gestionar tarea de orden"
        >
          <div
            ref={dialog}
            className="relative w-full max-w-2xl rounded-3xl bg-[#070c18]/95 backdrop-blur-2xl border border-cyan-500/30 p-6 md:p-8 shadow-[0_20px_60px_rgba(0,0,0,0.8)] overflow-hidden"
          >
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#22d3ee]" />
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
