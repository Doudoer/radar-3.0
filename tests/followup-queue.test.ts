import { describe, expect, it } from 'vitest';
import {
  followupQueueUrl,
  followupSummary,
  groupFollowupTasks,
  parseFollowupQueue,
} from '../src/utils/followupQueue';
import type { WorkflowOrder, WorkflowTask } from '../src/utils/orderWorkflow';

const order = (overrides: Partial<WorkflowOrder> = {}): WorkflowOrder => ({
  id: '901',
  code: 'ORD-901',
  userId: 7,
  advisor: 'Ana',
  version: 1,
  createdAt: '2026-11-01T16:00:00Z',
  status: 'pagado',
  deliveredAt: '2026-11-05T16:00:00Z',
  scheduledPickupAt: null,
  total: 1000,
  paid: 1000,
  ...overrides,
});

const task = (overrides: Partial<WorkflowTask> = {}): WorkflowTask => ({
  order: order(),
  task: 'post_3',
  title: 'Post-entrega · Día 3',
  requirement: 'Confirmar recepción.',
  dueDate: '2026-11-08',
  nextAction: 'Confirmar recepción y programación de instalación.',
  blockedBy: null,
  objectiveDueDate: '2026-11-08',
  bucket: 'upcoming',
  overdue: false,
  escalated: false,
  regularization: false,
  needsIncident: false,
  ...overrides,
});

describe('followup queue requests', () => {
  it('scopes the queue to the profile owner for admins', () => {
    expect(followupQueueUrl(115, 'admin')).toBe('/workflow/tasks?operatorId=115');
    expect(followupQueueUrl(115, 'operator')).toBe('/workflow/tasks');
    expect(followupQueueUrl(115, 'vendedor_yarda')).toBe('/workflow/tasks');
  });

  it('tolerates malformed payloads without inventing tasks', () => {
    expect(parseFollowupQueue(null)).toEqual({ tasks: [], today: '' });
    expect(parseFollowupQueue({ tasks: 'nope', today: 3 })).toEqual({ tasks: [], today: '' });
    const parsed = parseFollowupQueue({ tasks: [task()], today: '2026-11-14' });
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.today).toBe('2026-11-14');
  });
});

describe('followup grouping', () => {
  it('separates the three employee follow-up lines and keeps order inside each', () => {
    const groups = groupFollowupTasks([
      task({ task: 'prepare', order: order({ id: '3', code: 'ORD-PREP', yardPieceReady: true }) }),
      task({ task: 'post_14', dueDate: '2026-11-20' }),
      task({ task: 'incident', dueDate: '2026-11-10' }),
      task({ task: 'post_3', dueDate: '2026-11-09' }),
      task({ task: 'quote' }),
    ]);
    expect(groups.map((group) => group.key)).toEqual(['post', 'incident', 'prepare']);
    expect(groups[0].tasks.map((entry) => entry.dueDate)).toEqual(['2026-11-09', '2026-11-20']);
    expect(groups[1].tasks).toHaveLength(1);
    expect(groups[2].tasks[0].order.code).toBe('ORD-PREP');
  });

  it('puts overdue items first regardless of due date', () => {
    const groups = groupFollowupTasks([
      task({ task: 'post_7', dueDate: '2026-11-01', bucket: 'upcoming' }),
      task({ task: 'post_14', dueDate: '2026-11-20', bucket: 'overdue', overdue: true }),
    ]);
    expect(groups[0].tasks.map((entry) => entry.task)).toEqual(['post_14', 'post_7']);
  });

  it('summarizes pending, overdue and ready pieces for the header', () => {
    expect(followupSummary([
      task({ bucket: 'overdue', overdue: true }),
      task({ task: 'prepare', order: order({ yardPieceReady: true }) }),
      task({ task: 'prepare', order: order({ id: '2', yardPieceReady: false }) }),
    ])).toEqual({ total: 3, overdue: 1, readyPieces: 1 });
  });
});
