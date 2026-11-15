import { describe, expect, it } from 'vitest';
import {
  faultAppealResolveSchema,
  faultAppealSchema,
  faultCatalogSchema,
  faultCatalogUpdateSchema,
  faultCreateSchema,
  userProfileDetailsSchema,
} from '../src/server/schemas';

describe('profile details schema', () => {
  it('accepts contact fields and coerces salary strings', () => {
    const parsed = userProfileDetailsSchema.parse({
      address: 'Colonia Palmira',
      emergency_contact_name: 'María López',
      emergency_contact_phone: '+504 9999-0000',
      hired_on: '2026-11-01',
      weekly_salary: '3500.50',
    });
    expect(parsed.weekly_salary).toBe(3500.5);
  });

  it('allows clearing salary and date with null', () => {
    const parsed = userProfileDetailsSchema.parse({ weekly_salary: null, hired_on: null });
    expect(parsed.weekly_salary).toBeNull();
    expect(parsed.hired_on).toBeNull();
  });

  it('rejects negative salary and impossible dates', () => {
    expect(userProfileDetailsSchema.safeParse({ weekly_salary: -1 }).success).toBe(false);
    expect(userProfileDetailsSchema.safeParse({ hired_on: '2026-02-30' }).success).toBe(false);
    expect(userProfileDetailsSchema.safeParse({ hired_on: '01/11/2026' }).success).toBe(false);
  });
});

describe('fault catalog schema', () => {
  it('defaults new entries to active', () => {
    const parsed = faultCatalogSchema.parse({ name: 'Retardo grave', points: '5', amount: '75.25' });
    expect(parsed.active).toBe(true);
    expect(parsed.points).toBe(5);
    expect(parsed.amount).toBe(75.25);
  });

  it('rejects negative points and names that are too short', () => {
    expect(faultCatalogSchema.safeParse({ name: 'Retardo', points: -1, amount: 0 }).success).toBe(false);
    expect(faultCatalogSchema.safeParse({ name: 'ok', points: 1, amount: 0 }).success).toBe(false);
  });

  it('does not inject the active default on partial updates', () => {
    const parsed = faultCatalogUpdateSchema.parse({ points: 8 });
    expect(parsed).toEqual({ points: 8 });
    expect('active' in parsed).toBe(false);
  });
});

describe('fault registration and appeals', () => {
  it('validates fault dates and registered users', () => {
    expect(faultCreateSchema.safeParse({ user_id: 5, catalog_id: 1, fault_date: '2026-11-14' }).success).toBe(true);
    expect(faultCreateSchema.safeParse({ user_id: 5, catalog_id: 1, fault_date: '2026-13-01' }).success).toBe(false);
    expect(faultCreateSchema.safeParse({ user_id: 0, catalog_id: 1, fault_date: '2026-11-14' }).success).toBe(false);
  });

  it('requires a substantive appeal message', () => {
    expect(faultAppealSchema.safeParse({ message: 'corto' }).success).toBe(false);
    expect(faultAppealSchema.safeParse({ message: 'La pieza llegó dañada antes del turno.' }).success).toBe(true);
  });

  it('only accepts the two resolution decisions', () => {
    expect(faultAppealResolveSchema.safeParse({ decision: 'aceptada' }).success).toBe(true);
    expect(faultAppealResolveSchema.safeParse({ decision: 'rechazada', note: 'Sin evidencia' }).success).toBe(true);
    expect(faultAppealResolveSchema.safeParse({ decision: 'pending' }).success).toBe(false);
  });
});
