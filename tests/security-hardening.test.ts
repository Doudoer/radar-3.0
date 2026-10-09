import { describe, expect, it, vi } from 'vitest';
import { ServerResponse } from 'node:http';
import { clearSessionCookie, setSessionCookie, isLoginRateLimited, recordLoginFailure, resetLoginAttempts } from '../src/server/auth';
import { getOrders } from '../src/server/orders';
import { pool } from '../src/server/config';

describe('Security Hardening & Protection Tests (Phase 1)', () => {
  describe('Session Cookies Security', () => {
    it('sets HttpOnly, SameSite=Lax and Path=/ on session cookie', () => {
      const headers: Record<string, string> = {};
      const mockResponse = {
        setHeader: vi.fn((key: string, value: string) => {
          headers[key] = value;
        }),
      } as unknown as ServerResponse;

      setSessionCookie(mockResponse, 'mock-jwt-token-12345');

      expect(headers['Set-Cookie']).toBeDefined();
      expect(headers['Set-Cookie']).toContain('radar_session=mock-jwt-token-12345');
      expect(headers['Set-Cookie']).toContain('HttpOnly');
      expect(headers['Set-Cookie']).toContain('SameSite=Lax');
      expect(headers['Set-Cookie']).toContain('Path=/');
    });

    it('clears session cookie with Max-Age=0, HttpOnly and SameSite=Lax', () => {
      const headers: Record<string, string> = {};
      const mockResponse = {
        setHeader: vi.fn((key: string, value: string) => {
          headers[key] = value;
        }),
      } as unknown as ServerResponse;

      clearSessionCookie(mockResponse);

      expect(headers['Set-Cookie']).toBeDefined();
      expect(headers['Set-Cookie']).toContain('radar_session=;');
      expect(headers['Set-Cookie']).toContain('Max-Age=0');
      expect(headers['Set-Cookie']).toContain('HttpOnly');
      expect(headers['Set-Cookie']).toContain('SameSite=Lax');
    });
  });

  describe('Login Brute-Force Rate Limiting', () => {
    it('locks out after 10 failed login attempts per IP/Key', () => {
      const testKey = 'test-ip-192.168.1.100';
      resetLoginAttempts(testKey);

      for (let i = 0; i < 9; i++) {
        expect(isLoginRateLimited(testKey)).toBe(false);
        recordLoginFailure(testKey);
      }

      // 10th failure
      recordLoginFailure(testKey);
      expect(isLoginRateLimited(testKey)).toBe(true);

      // Reset unlocks
      resetLoginAttempts(testKey);
      expect(isLoginRateLimited(testKey)).toBe(false);
    });
  });

  describe('Orders Query Bounding & Parameterization', () => {
    it('enforces default and maximum query limits preventing memory exhaustion', async () => {
      const querySpy = vi.spyOn(pool, 'query').mockResolvedValueOnce([[], []] as any);

      await getOrders({ limit: 20000 }); // Asking for 20,000 should be capped at 10,000

      expect(querySpy).toHaveBeenCalled();
      const calledArgs = querySpy.mock.calls[0];
      const sqlQuery = String(calledArgs[0]);
      const sqlParams = calledArgs[1] as any[];

      expect(sqlQuery).toContain('LIMIT ?');
      expect(sqlParams).toContain(10000); // capped at 10000

      querySpy.mockRestore();
    });

    it('safely applies startDate and endDate filters as parameterized placeholders', async () => {
      const querySpy = vi.spyOn(pool, 'query').mockResolvedValueOnce([[], []] as any);

      await getOrders({ startDate: '2026-01-01', endDate: '2026-03-31', limit: 50 });

      expect(querySpy).toHaveBeenCalled();
      const calledArgs = querySpy.mock.calls[0];
      const sqlQuery = String(calledArgs[0]);
      const sqlParams = calledArgs[1] as any[];

      expect(sqlQuery).toContain('o.created_at >= ?');
      expect(sqlQuery).toContain('o.created_at <= ?');
      expect(sqlParams).toContain('2026-01-01');
      expect(sqlParams).toContain('2026-03-31');
      expect(sqlParams).toContain(50);

      querySpy.mockRestore();
    });
  });
});
