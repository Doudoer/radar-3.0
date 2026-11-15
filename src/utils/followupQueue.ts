import type { WorkflowTask } from './orderWorkflow';

export interface FollowupQueuePayload {
  tasks: WorkflowTask[];
  today: string;
}

export type FollowupGroupKey = 'post' | 'incident' | 'prepare';

export interface FollowupGroup {
  key: FollowupGroupKey;
  title: string;
  subtitle: string;
  tasks: WorkflowTask[];
}

const FOLLOWUP_GROUPS: { key: FollowupGroupKey; title: string; subtitle: string }[] = [
  { key: 'post', title: 'Seguimientos post-entrega', subtitle: 'Hitos de los días 3, 7 y 14 posteriores a la entrega.' },
  { key: 'incident', title: 'Reclamos', subtitle: 'Casos abiertos asignados al colaborador.' },
  { key: 'prepare', title: 'Piezas listas para entregar', subtitle: 'Piezas en patio por notificar y pasar a retiro.' },
];

export const followupQueueUrl = (targetUserId: number, viewerRole: string) =>
  viewerRole === 'admin' ? `/workflow/tasks?operatorId=${targetUserId}` : '/workflow/tasks';

export const parseFollowupQueue = (payload: unknown): FollowupQueuePayload => {
  const source = payload as { tasks?: unknown; today?: unknown } | null;
  return {
    tasks: Array.isArray(source?.tasks) ? (source.tasks as WorkflowTask[]) : [],
    today: typeof source?.today === 'string' ? source.today : '',
  };
};

const groupKeyForTask = (task: WorkflowTask): FollowupGroupKey | null => {
  if (task.task === 'incident') return 'incident';
  if (task.task === 'prepare') return 'prepare';
  if (task.task.startsWith('post_')) return 'post';
  return null;
};

const urgencyRank = (task: WorkflowTask) => {
  if (task.bucket === 'overdue' || task.overdue) return 0;
  if (task.bucket === 'today') return 1;
  if (task.bucket === 'blocked') return 2;
  if (task.bucket === 'waiting') return 3;
  return 4;
};

export const groupFollowupTasks = (tasks: WorkflowTask[]): FollowupGroup[] =>
  FOLLOWUP_GROUPS.map((group) => ({
    ...group,
    tasks: tasks
      .filter((task) => groupKeyForTask(task) === group.key)
      .sort((a, b) => urgencyRank(a) - urgencyRank(b) || a.dueDate.localeCompare(b.dueDate)),
  }));

export const followupSummary = (tasks: WorkflowTask[]) => ({
  total: tasks.length,
  overdue: tasks.filter((task) => task.bucket === 'overdue' || task.overdue).length,
  readyPieces: tasks.filter((task) => task.task === 'prepare' && task.order.yardPieceReady).length,
});
