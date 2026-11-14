import type { PendingFollowupItem } from '../types';
import type { WorkflowTask } from './orderWorkflow';

export interface WorkloadSummary {
  /** Tareas accionables de hoy o vencidas (incluye escaladas). */
  pending: number;
  /** Subconjunto vencido de `pending`. */
  overdue: number;
  /** Seguimientos posventa accionables. */
  followups: number;
  /** Tareas accionables del flujo operativo. */
  workflow: number;
}

export const summarizeWorkload = (
  followupItems: ReadonlyArray<Pick<PendingFollowupItem, 'urgency'>>,
  workflowTasks: ReadonlyArray<Pick<WorkflowTask, 'bucket' | 'escalated'>>
): WorkloadSummary => {
  const followups = followupItems.filter(
    (item) => item.urgency === 'atrasada' || item.urgency === 'hoy'
  ).length;
  const followupsOverdue = followupItems.filter(
    (item) => item.urgency === 'atrasada'
  ).length;

  const workflow = workflowTasks.filter(
    (task) => task.bucket === 'overdue' || task.bucket === 'today' || task.escalated
  ).length;
  const workflowOverdue = workflowTasks.filter(
    (task) => task.bucket === 'overdue' || task.escalated
  ).length;

  return {
    pending: followups + workflow,
    overdue: followupsOverdue + workflowOverdue,
    followups,
    workflow,
  };
};
