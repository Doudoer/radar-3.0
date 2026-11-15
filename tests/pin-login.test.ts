import { describe, expect, it } from 'vitest';
import { pinLoginSchema, userCreateSchema, userUpdateSchema } from '../src/server/schemas';
import { rateLimit } from '../src/server/security';

describe('PIN login schema', () => {
  it('accepts exactly four digits', () => {
    expect(pinLoginSchema.parse({ pin: '1234' })).toEqual({ pin: '1234' });
    expect(pinLoginSchema.parse({ pin: ' 0042 ' })).toEqual({ pin: '0042' });
  });

  it('rejects anything that is not four digits', () => {
    for (const pin of ['123', '12345', '12a4', 'abc', '', '  ', '12 4']) {
      expect(pinLoginSchema.safeParse({ pin }).success).toBe(false);
    }
    expect(pinLoginSchema.safeParse({}).success).toBe(false);
  });

  it('keeps the PIN optional on user create and update, and allows clearing it', () => {
    const baseUser = {
      name: 'Jefe',
      email: 'jefe@radar.invalid',
      password: 'Aa1!aaaaaa',
      role: 'vendedor_yarda' as const,
      permissions: [],
      active: true,
    };
    expect(userCreateSchema.safeParse(baseUser).success).toBe(true);
    expect(userCreateSchema.safeParse({ ...baseUser, pin: '4821' }).success).toBe(true);
    expect(userCreateSchema.safeParse({ ...baseUser, pin: '482' }).success).toBe(false);
    expect(userUpdateSchema.safeParse(baseUser).success).toBe(true);
    expect(userUpdateSchema.safeParse({ ...baseUser, pin: null }).success).toBe(true);
    expect(userUpdateSchema.safeParse({ ...baseUser, pin: '' }).success).toBe(false);
  });
});

describe('PIN rate limiting', () => {
  it('allows five attempts per window and blocks the sixth', () => {
    const key = 'pin-test:basic';
    const start = 1_000_000;
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect(rateLimit(key, 5, 15 * 60_000, start)).toBe(0);
    }
    expect(rateLimit(key, 5, 15 * 60_000, start + 1)).toBeGreaterThan(0);
  });

  it('resets once the window expires', () => {
    const key = 'pin-test:window';
    const start = 2_000_000;
    for (let attempt = 1; attempt <= 5; attempt++) {
      rateLimit(key, 5, 15 * 60_000, start);
    }
    expect(rateLimit(key, 5, 15 * 60_000, start + 15 * 60_000)).toBe(0);
  });

  it('charges the global bucket independently of the per-IP bucket', () => {
    const now = 3_000_000;
    for (let attempt = 1; attempt <= 40; attempt++) {
      expect(rateLimit('pin-test:global', 40, 15 * 60_000, now)).toBe(0);
    }
    expect(rateLimit('pin-test:global', 40, 15 * 60_000, now)).toBeGreaterThan(0);
    expect(rateLimit('pin-test:ip-fresh', 5, 15 * 60_000, now)).toBe(0);
  });
});
