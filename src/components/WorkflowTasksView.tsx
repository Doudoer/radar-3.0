import React, { useCallback, useEffect, useRef, useState } from 'react';
import { WorkflowActionForm, workflowResponse } from './OrderWorkflowPanel';
import { workflowTaskAssignee, type WorkflowTask } from '../utils/orderWorkflow';
import { apiFetch } from '../services/apiFetch';

export interface WorkflowQueue {
  followupAdvisors?: { id: number; name: string }[];
  today: string; tasks: WorkflowTask[];
  operators: { userId: number | null; name: string; completed: number; onTime: number; attempts: number; overdue: number; escalated: number; blocked: number; unassigned: number }[];
}
const FollowupAssignment: React.FC<{ task: WorkflowTask; advisors: { id: number; name: string }[]; onSaved: () => Promise<void> }> =
  ({ task, advisors, onSaved }) => {
    const [advisor, setAdvisor] = useState(task.order.followupUserId ? String(task.order.followupUserId) : '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const lock = useRef(false);
    const save = async () => {
      if (lock.current) return;
      lock.current = true; setBusy(true); setError('');
      try {
        const result = await workflowResponse<{ ok: boolean; version: number }>(await apiFetch(`/orders/${task.order.id}/workflow/assignee`, {
          method: 'POST', body: JSON.stringify({ version: task.order.version, advisorId: advisor ? Number(advisor) : null }),
        }));
        if (!result.ok || result.version !== task.order.version + 1) throw new Error('Respuesta de asignación inválida; actualiza antes de reintentar.');
        window.dispatchEvent(new Event('radar:data-changed'));
        await onSaved();
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo asignar el seguimiento.'); }
      finally { lock.current = false; setBusy(false); }
    };
    return <section className="rounded-xl border border-[var(--border-color)] p-3 space-y-2">
      <p className="text-sm">Responsable post-entrega independiente del vendedor original.</p>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm">Asesor de seguimiento<select value={advisor} disabled={busy} onChange={event => setAdvisor(event.target.value)}>
          <option value="">{task.order.isYardSale ? 'Pendiente de asignación' : 'Asesor original de la venta'}</option>
          {task.order.followupUserId && !advisors.some(user => user.id === task.order.followupUserId) &&
            <option value={String(task.order.followupUserId)} disabled>{task.order.followupAdvisor || 'Asesor asignado'} (no disponible)</option>}
          {advisors.map(user => <option key={user.id} value={String(user.id)}>{user.name}</option>)}
        </select></label>
        <button type="button" disabled={busy} className="cyber-btn-secondary px-3 py-2" onClick={() => void save()}>{busy ? 'Asignando…' : 'Guardar responsable'}</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </section>;
  };
const buckets = { all: 'Todas', overdue: 'Vencidas', today: 'Para hoy', waiting: 'Esperando respuesta', blocked: 'Bloqueadas', upcoming: 'Próximas' } as const;
export const WorkflowTasksView: React.FC<{
  onSelectOrder: (id: string) => void; onNavigateIncident: (screen: 'reclamos' | 'reembolsos') => void; userRole: string; onLegacyFollowups?: () => void;
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
    } catch (reason) { if (request === generation.current) { setQueue(null); setError(reason instanceof Error ? reason.message : 'No se pudo cargar la bandeja.'); } }
  }, []);
  useEffect(() => {
    void reload();
    window.addEventListener('radar:data-changed', reload);
    return () => { generation.current++; window.removeEventListener('radar:data-changed', reload); };
  }, [reload]);
  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel: HTMLDivElement | null = dialog.current;
    panel?.querySelector<HTMLElement>('select, input, textarea, button')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !panel?.querySelector('button[type="submit"]:disabled')) setSelected(null);
      if (event.key !== 'Tab' || !panel) return;
      const controls = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'));
      const destination = event.shiftKey && document.activeElement === controls[0] ? controls[controls.length - 1]
        : !event.shiftKey && document.activeElement === controls[controls.length - 1] ? controls[0] : null;
      if (destination) { event.preventDefault(); destination.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, [selected?.order.id]);
  const tasks = (queue?.tasks || []).filter(task => {
    const matchesBucket = filter === 'all' || (filter === 'overdue' ? task.overdue && task.bucket !== 'blocked' : task.bucket === filter);
    return matchesBucket && (operator === 'all' || String(workflowTaskAssignee(task.order, task.task).userId) === operator);
  });
  return <div className="radar-view horizon-view horizon-workflow-queue pb-8">
    <header className="horizon-view-header">
      <div><h1>Mi trabajo de hoy</h1><p>Órdenes desde el 21 de octubre de 2026. Primera gestión y reintento en días hábiles; hitos post-entrega 3, 7 y 14.</p></div>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => void reload()} className="cyber-btn-secondary px-4 py-2">Actualizar tareas</button>
        {onLegacyFollowups && <button type="button" onClick={onLegacyFollowups} className="cyber-btn-secondary px-4 py-2">Seguimiento histórico</button>}
      </div>
    </header>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {!queue && !error && <p role="status">Cargando tareas del servidor…</p>}
    {queue && <>
      <div className="horizon-view-metrics grid gap-4 grid-cols-2 lg:grid-cols-4">
        {[['Tareas activas', queue.tasks.length], ['Vencidas', queue.tasks.filter(task => task.overdue && task.bucket !== 'blocked').length],
          ['Escaladas al supervisor', queue.tasks.filter(task => task.escalated).length], ['Bloqueos externos', queue.tasks.filter(task => task.bucket === 'blocked').length]].map(([label, value]) =>
          <div key={String(label)}><p className="text-sm text-[var(--text-secondary)]">{label}</p><strong className="text-2xl">{value}</strong></div>)}
      </div>
      <div className="horizon-view-toolbar flex flex-wrap gap-3">
        {Object.entries(buckets).map(([key, label]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key as keyof typeof buckets)}
          className={filter === key ? 'horizon-primary rounded-xl px-3 py-2' : 'cyber-btn-secondary px-3 py-2'}>{label}</button>)}
        {userRole === 'admin' && <select aria-label="Operador de tareas" value={operator} onChange={event => setOperator(event.target.value)}>
          <option value="all">Todos los operadores</option>{queue.operators.map(item => <option key={String(item.userId)} value={String(item.userId)}>{item.name}</option>)}
        </select>}
      </div>
      {!tasks.length && <p className="horizon-view-card">No hay tareas para este filtro.</p>}
      <div className="space-y-4">{tasks.map(task => <article key={task.order.id} className="horizon-view-card space-y-3">
        <div className="flex flex-wrap justify-between gap-3"><h2 className="font-bold text-lg">{task.order.code} · {task.title}</h2><span className="text-sm">{buckets[task.bucket]} · {task.dueDate}</span></div>
        <p className="text-sm">Responsable: {workflowTaskAssignee(task.order, task.task).name}
          {workflowTaskAssignee(task.order, task.task).userId === null && ' · Administración debe asignar el seguimiento.'}</p>
        {task.order.deliveredAt && <p className="text-xs text-[var(--text-secondary)]">Vendedor original: {task.order.advisor}{task.order.isYardSale && ' · Venta de yarda'}</p>}
        {userRole === 'admin' && <FollowupAssignment key={`${task.order.id}-${task.order.version}`}
          task={task} advisors={queue.followupAdvisors || []} onSaved={reload} />}
        <p className="text-sm text-[var(--text-secondary)]">{task.nextAction}</p>
        {task.escalated && <p className="text-sm text-red-600">Aviso interno al supervisor: al menos un día hábil de atraso.</p>}
        {task.blockedBy && <p className="text-sm text-amber-600">Bloqueo externo: {task.blockedBy} · próxima revisión {task.dueDate}</p>}
        {task.regularization && <p className="text-sm text-amber-600">Regularización de evidencia histórica pendiente; no se reinicia la garantía.</p>}
        <div className="flex flex-wrap gap-3">
          <button type="button" className="horizon-primary rounded-xl px-4 py-2" onClick={() => setSelected(task)}>Gestionar tarea</button>
          <button type="button" className="cyber-btn-secondary px-4 py-2" onClick={() => onSelectOrder(task.order.id)}>Ver orden</button>
          {task.needsIncident && <button type="button" className="cyber-btn-secondary px-4 py-2" onClick={() => onNavigateIncident(task.order.status === 'solicitud_reembolso' ? 'reembolsos' : 'reclamos')}>Gestionar incidencia</button>}
        </div>
      </article>)}</div>
      {userRole === 'admin' && <section className="horizon-view-card space-y-4">
        <h2 className="text-xl font-bold">Supervisión por operador</h2>
        <p className="text-sm text-[var(--text-secondary)]">Cumplimiento: objetivos confirmados dentro del plazo. Los intentos y bloqueos se contabilizan por separado; no son objetivos cumplidos.</p>
        <div className="overflow-x-auto"><table className="w-full text-sm text-left">
          <thead><tr>{['Operador', 'Confirmados', 'Dentro del plazo', 'Intentos', 'Vencidas', 'Escaladas', 'Bloqueadas'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead>
          <tbody>{queue.operators.map(item => <tr key={String(item.userId)}><td className="p-3">{item.name}</td><td className="p-3">{item.completed}</td>
            <td className="p-3">{item.completed ? `${Math.round(item.onTime / item.completed * 100)}%` : 'Sin objetivos confirmados'}</td>
            <td className="p-3">{item.attempts}</td><td className="p-3">{item.overdue}</td><td className="p-3">{item.escalated}</td><td className="p-3">{item.blocked}</td></tr>)}</tbody>
        </table></div>
      </section>}
    </>}
    {selected && <div className="horizon-modal fixed inset-0 flex items-center justify-center p-4">
      <div ref={dialog} role="dialog" aria-modal="true" aria-label="Gestionar tarea de orden" className="w-full max-w-2xl p-6"><WorkflowActionForm key={`${selected.order.id}-${selected.order.version}`} task={selected} onSaved={async () => { await reload(); setSelected(null); }} onCancel={() => setSelected(null)} /></div>
    </div>}
  </div>;
};
