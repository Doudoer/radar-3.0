import { describe, expect, it } from 'vitest';
import { summarizeWorkload } from '../src/utils/workloadSummary';

describe('summarizeWorkload', () => {
  it('counts actionable followups and workflow tasks without double counting overdue work', () => {
    const summary = summarizeWorkload(
      [{ urgency: 'atrasada' }, { urgency: 'hoy' }, { urgency: 'proxima' }],
      [
        { bucket: 'overdue', escalated: false },
        { bucket: 'today', escalated: false },
        { bucket: 'upcoming', escalated: false },
        { bucket: 'waiting', escalated: false },
      ]
    );

    expect(summary).toEqual({ pending: 4, overdue: 2, followups: 2, workflow: 2 });
  });

  it('keeps overdue as a subset of pending when tasks are escalated', () => {
    const summary = summarizeWorkload(
      [{ urgency: 'hoy' }],
      [
        { bucket: 'upcoming', escalated: true },
        { bucket: 'blocked', escalated: false },
      ]
    );

    expect(summary.pending).toBe(2);
    expect(summary.overdue).toBe(1);
    expect(summary.overdue).toBeLessThanOrEqual(summary.pending);
  });

  it('returns zeroes with an empty queue', () => {
    expect(summarizeWorkload([], [])).toEqual({ pending: 0, overdue: 0, followups: 0, workflow: 0 });
  });
});
