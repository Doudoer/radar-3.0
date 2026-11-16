import { describe, expect, it, vi } from 'vitest';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import {
  listActiveIncomingCalls,
  listPbxCallLogs,
  normalizePhoneDigits,
  readPbxSettings,
  recordPbxHeartbeat,
  sanitizePbxSettingsForClient,
  upsertPbxCallEvent,
  verifyPbxWebhookSecret,
  writePbxEnabled,
} from '../src/server/pbxCalls';
import { createPbxAmiManager } from '../src/server/pbxAmiClient';

const createMockPool = (queryHandler: (sql: string, params?: unknown[]) => unknown[]) => {
  const execute = vi.fn(async () => [{ affectedRows: 1 }, []]);
  const query = vi.fn(async (sql: string, params?: unknown[]) => [queryHandler(sql, params) as RowDataPacket[], []]);
  return { pool: { execute, query } as unknown as Pool, execute, query };
};

describe('pbxCalls helpers', () => {
  it('normalizes phone digits and verifies webhook secrets safely', () => {
    expect(normalizePhoneDigits('+1 (919) 555-0199')).toBe('19195550199');
    expect(normalizePhoneDigits(null)).toBe('');
    expect(verifyPbxWebhookSecret('secret-123', 'secret-123')).toBe(true);
    expect(verifyPbxWebhookSecret('secret-124', 'secret-123')).toBe(false);
    expect(verifyPbxWebhookSecret(undefined, 'secret-123')).toBe(false);
  });

  it('upserts ringing inbound call with matched client and order', async () => {
    const { pool, execute } = createMockPool((sql) => {
      if (sql.includes('FROM customers')) return [{ id: 42, name: 'Juan Pérez' }];
      if (sql.includes('FROM orders')) return [{ id: 'ord-99', order_code: 'RAD-0099' }];
      if (sql.includes('FROM pbx_call_logs WHERE uniqueid')) {
        return [{
          id: 1,
          uniqueid: '1700000001.12',
          direction: 'inbound',
          status: 'ringing',
          caller_number: '99990000',
          caller_name: 'Juan',
          destination: '501',
          answered_by_ext: null,
          client_id: 42,
          client_name: 'Juan Pérez',
          order_id: 'ord-99',
          order_code: 'RAD-0099',
          duration_seconds: 0,
          billsec_seconds: 0,
          started_at: '2026-11-15T20:00:00.000Z',
          answered_at: null,
          ended_at: null,
        }];
      }
      return [];
    });

    const record = await upsertPbxCallEvent(pool, {
      uniqueid: '1700000001.12',
      event: 'ringing',
      direction: 'inbound',
      caller_number: '+504 9999-0000',
      caller_name: 'Juan',
      destination: '501',
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(record.clientId).toBe(42);
    expect(record.orderCode).toBe('RAD-0099');
    expect(record.status).toBe('ringing');
  });

  it('expires stale ringing calls and lists active incoming calls', async () => {
    const { pool, execute } = createMockPool((sql) => {
      if (sql.includes("status = 'ringing'")) {
        return [{
          id: 2,
          uniqueid: '1700000002.15',
          direction: 'inbound',
          status: 'ringing',
          caller_number: '88881111',
          caller_name: null,
          destination: '501',
          answered_by_ext: null,
          client_id: null,
          client_name: null,
          order_id: null,
          order_code: null,
          duration_seconds: 0,
          billsec_seconds: 0,
          started_at: '2026-11-15T20:01:00.000Z',
          answered_at: null,
          ended_at: null,
        }];
      }
      return [];
    });

    const active = await listActiveIncomingCalls(pool);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("SET status = 'missed'"), [120]);
    expect(active).toHaveLength(1);
    expect(active[0].callerNumber).toBe('88881111');
  });

  it('returns call log list and summary totals', async () => {
    const { pool } = createMockPool((sql) => {
      if (sql.includes('COUNT(*) AS total')) {
        return [{ total: 10, inbound: 6, outbound: 4, missed: 2, answered: 8 }];
      }
      return [];
    });

    const result = await listPbxCallLogs(pool, { direction: 'inbound', limit: 50 });
    expect(result.summary).toEqual({
      total: 10,
      inbound: 6,
      outbound: 4,
      missed: 2,
      answered: 8,
    });
  });

  it('computes PBX health status for online, error, and disabled states', async () => {
    const prevSecret = process.env.PBX_WEBHOOK_SECRET;
    process.env.PBX_WEBHOOK_SECRET = 'test-secret';
    try {
      const now = new Date('2026-11-16T01:30:00.000Z');
      const onlinePool = createMockPool((sql) => {
        if (sql.includes('FROM app_settings')) {
          return [
            { setting_key: 'pbx.enabled', setting_value: '1' },
            { setting_key: 'pbx.bridge_status', setting_value: 'online' },
            { setting_key: 'pbx.last_heartbeat_at', setting_value: '2026-11-16T01:29:30.000Z' },
          ];
        }
        return [{ totalCalls: 5, activeCount: 1 }];
      });
      const online = await readPbxSettings(onlinePool.pool, now);
      expect(online.healthStatus).toBe('online');
      expect(online.enabled).toBe(true);

      const errorPool = createMockPool((sql) => {
        if (sql.includes('FROM app_settings')) {
          return [
            { setting_key: 'pbx.enabled', setting_value: '1' },
            { setting_key: 'pbx.bridge_status', setting_value: 'error' },
            { setting_key: 'pbx.last_error', setting_value: 'Authentication failed' },
          ];
        }
        return [{ totalCalls: 5, activeCount: 0 }];
      });
      const errSnap = await readPbxSettings(errorPool.pool, now);
      expect(errSnap.healthStatus).toBe('error');
      expect(errSnap.lastError).toBe('Authentication failed');

      const disabledPool = createMockPool((sql) => {
        if (sql.includes('FROM app_settings')) {
          return [{ setting_key: 'pbx.enabled', setting_value: '0' }];
        }
        return [{ totalCalls: 5, activeCount: 0 }];
      });
      const dis = await writePbxEnabled(disabledPool.pool, false, 1);
      expect(dis.healthStatus).toBe('disabled');
      expect(disabledPool.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO app_settings'),
        ['pbx.enabled', '0', 1],
      );

      await recordPbxHeartbeat(onlinePool.pool, { status: 'error', error: 'ECONNREFUSED' });
      expect(onlinePool.execute).toHaveBeenCalledWith(
        expect.stringContaining("'pbx.last_error'"),
        ['ECONNREFUSED'],
      );
      expect(sanitizePbxSettingsForClient({ ...online, amiSecretValue: 'secret' })).not.toHaveProperty('amiSecretValue');
    } finally {
      if (prevSecret === undefined) delete process.env.PBX_WEBHOOK_SECRET;
      else process.env.PBX_WEBHOOK_SECRET = prevSecret;
    }
  });

  it('skips AMI socket when disabled or missing AMI secret and stops cleanly', async () => {
    const { pool } = createMockPool((sql) => {
      if (sql.includes('FROM app_settings')) {
        return [{ setting_key: 'pbx.enabled', setting_value: '0' }];
      }
      return [{ totalCalls: 0, activeCount: 0 }];
    });
    const manager = createPbxAmiManager(pool, vi.fn());
    await manager.refresh();
    manager.stop();
  });
});
