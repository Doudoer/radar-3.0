import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/server/config', () => ({
  pool: { query: vi.fn(), getConnection: vi.fn() },
  jwtSecret: 'test-signing-key-that-is-at-least-thirty-two-characters',
}));

import { assertOrderMutationAccess, canMutateOrder } from '../src/server/orderAccess';

describe('order mutation access', () => {
  it('lets admin mutate any order', () => {
    expect(canMutateOrder({ role: 'admin', sub: 1 }, { user_id: 99, followup_user_id: 77 })).toBe(true);
  });

  it('lets the owner mutate the order regardless of role casing', () => {
    expect(canMutateOrder({ role: 'OPERATOR', sub: '42' }, { user_id: 42, followup_user_id: null })).toBe(true);
    expect(canMutateOrder({ role: 'vendedor_yarda', sub: 42 }, { user_id: '42' })).toBe(true);
  });

  it('lets an advisor with an assigned followup mutate the order', () => {
    expect(canMutateOrder({ role: 'operator', sub: 7 }, { user_id: 42, followup_user_id: 7 })).toBe(true);
  });

  it('blocks advisors who are neither owner nor followup', () => {
    expect(canMutateOrder({ role: 'operator', sub: 7 }, { user_id: 42, followup_user_id: 8 })).toBe(false);
    expect(canMutateOrder({ role: 'vendedor_yarda', sub: 7 }, { user_id: null, followup_user_id: null })).toBe(false);
  });

  it('blocks requests without claims or with an invalid subject', () => {
    expect(canMutateOrder(null, { user_id: 1 })).toBe(false);
    expect(canMutateOrder(undefined, { user_id: 1 })).toBe(false);
    expect(canMutateOrder({ role: 'operator', sub: 'not-a-number' }, { user_id: 1 })).toBe(false);
  });

  it('throws a 403 for unauthorized advisors and allows authorized ones', () => {
    let caught: { statusCode?: number; message?: string } | null = null;
    try {
      assertOrderMutationAccess({ role: 'operator', sub: 7 }, { user_id: 42, followup_user_id: 8 });
    } catch (error) {
      caught = error as { statusCode?: number; message?: string };
    }
    expect(caught?.statusCode).toBe(403);
    expect(caught?.message).toContain('puede modificar esta orden');

    expect(() => assertOrderMutationAccess({ role: 'admin', sub: 1 }, { user_id: 42 })).not.toThrow();
    expect(() => assertOrderMutationAccess({ role: 'operator', sub: 42 }, { user_id: 42 })).not.toThrow();
  });
});
