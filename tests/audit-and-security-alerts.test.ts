import { describe, expect, it, vi } from 'vitest';
import {
  ensureAuditTable,
  recordAuditLog,
  getAuditLogs,
} from '../src/server/audit';
import {
  formatAlertaSeguridadMessage,
  formatOtp2FAMessage,
} from '../src/integrations/wasender/notificationTemplates';

describe('Fase 4: Audit Logging & Security Alerts', () => {
  describe('ensureAuditTable', () => {
    it('creates audit_logs table with indexes if it does not exist', async () => {
      const executedQueries: string[] = [];
      const mockPool = {
        query: vi.fn(async (sql: string) => {
          executedQueries.push(sql);
          return [{}, null];
        }),
      };

      await ensureAuditTable(mockPool as any);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
      expect(executedQueries[0]).toContain('CREATE TABLE IF NOT EXISTS audit_logs');
      expect(executedQueries[0]).toContain('INDEX audit_logs_action (action)');
      expect(executedQueries[0]).toContain('INDEX audit_logs_user (user_id)');
      expect(executedQueries[0]).toContain('INDEX audit_logs_created_at (created_at)');
    });
  });

  describe('recordAuditLog', () => {
    it('records an audit log entry with JSON serialized details and truncated user agent', async () => {
      let executedSql = '';
      let executedParams: any[] = [];

      const mockPool = {
        query: vi.fn(async (sql: string, params: any[]) => {
          executedSql = sql;
          executedParams = params;
          return [{ insertId: 101 }, null];
        }),
      };

      await recordAuditLog(mockPool as any, {
        userId: 5,
        username: 'operator@radarsy.com',
        action: 'ORDER_CREATED',
        resourceType: 'order',
        resourceId: 'ORD-998822',
        details: { customer: 'Carlos Mendoza', amount: 450.0 },
        ipAddress: '190.202.10.5',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      });

      expect(executedSql).toContain('INSERT INTO audit_logs');
      expect(executedParams[0]).toBe(5);
      expect(executedParams[1]).toBe('operator@radarsy.com');
      expect(executedParams[2]).toBe('ORDER_CREATED');
      expect(executedParams[3]).toBe('order');
      expect(executedParams[4]).toBe('ORD-998822');
      expect(executedParams[5]).toBe(JSON.stringify({ customer: 'Carlos Mendoza', amount: 450.0 }));
      expect(executedParams[6]).toBe('190.202.10.5');
      expect(executedParams[7]).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    });

    it('does not throw or fail business flow when database insertion fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockPool = {
        query: vi.fn(async () => {
          throw new Error('Database connection lost');
        }),
      };

      await expect(
        recordAuditLog(mockPool as any, {
          action: 'LOGIN_FAILED',
          username: 'attacker@badactor.com',
          ipAddress: '45.33.32.1',
        })
      ).resolves.not.toThrow();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('getAuditLogs', () => {
    it('queries audit logs with pagination and filters and parses JSON details', async () => {
      const mockPool = {
        query: vi.fn(async (sql: string, params: any[]) => {
          if (sql.includes('COUNT(*)')) {
            return [[{ total: 2 }], null];
          }
          return [
            [
              {
                id: 1,
                user_id: 1,
                username: 'admin@radarsy.com',
                action: '2FA_VERIFIED',
                resource_type: '2fa',
                resource_id: null,
                details: JSON.stringify({ verified: true }),
                ip_address: '192.168.1.50',
                user_agent: 'Chrome/120',
                created_at: new Date('2026-10-08T15:30:00Z'),
              },
              {
                id: 2,
                user_id: null,
                username: 'unknown@test.com',
                action: 'LOGIN_FAILED',
                resource_type: 'auth',
                resource_id: null,
                details: 'Raw text reason',
                ip_address: '186.24.50.11',
                user_agent: 'Firefox/115',
                created_at: new Date('2026-10-08T16:00:00Z'),
              },
            ],
            null,
          ];
        }),
      };

      const result = await getAuditLogs(mockPool as any, {
        limit: 10,
        offset: 0,
        action: '2FA_VERIFIED',
        userId: 1,
      });

      expect(result.total).toBe(2);
      expect(result.logs.length).toBe(2);
      expect(result.logs[0].action).toBe('2FA_VERIFIED');
      expect(result.logs[0].details).toEqual({ verified: true });
      expect(result.logs[1].details).toBe('Raw text reason');
    });
  });

  describe('Security Notification Formatting', () => {
    it('formats 2FA OTP message with 1-minute expiration notice', () => {
      const msg = formatOtp2FAMessage({
        code: '748291',
        userName: 'Douglas Rodriguez',
        moduleName: 'Relación Semanal & Finanzas',
      });

      expect(msg).toContain('🔐 *RADAR V3 • Bóveda Financiera (2FA)*');
      expect(msg).toContain('*748291*');
      expect(msg).toContain('Relación Semanal & Finanzas');
      expect(msg).toContain('1 minuto (60 seg)');
    });

    it('formats critical security alert with IP, user, and event description', () => {
      const alert = formatAlertaSeguridadMessage({
        event: 'Múltiples intentos fallidos de 2FA',
        username: 'operador_prueba@radarsy.com',
        ipAddress: '190.202.10.5',
        details: 'Se alcanzaron 3 intentos fallidos consecutivos.',
        timestamp: '08/10/2026, 10:45:00 PM',
      });

      expect(alert).toContain('🚨 *ALERTA DE SEGURIDAD • RADAR 3.0*');
      expect(alert).toContain('Múltiples intentos fallidos de 2FA');
      expect(alert).toContain('operador_prueba@radarsy.com');
      expect(alert).toContain('`190.202.10.5`');
      expect(alert).toContain('Se alcanzaron 3 intentos fallidos consecutivos.');
      expect(alert).toContain('08/10/2026, 10:45:00 PM');
    });
  });
});
