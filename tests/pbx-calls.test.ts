import { EventEmitter } from 'node:events';
import net from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import {
  getPbxExtensionsPresenceReport,
  getUtcRangeForPbxDate,
  isDuringPbxBusinessHours,
  listActiveIncomingCalls,
  listPbxCallLogs,
  listPbxDailyAnalytics,
  normalizePhoneDigits,
  readPbxSettings,
  recordPbxExtensionPresence,
  recordPbxHeartbeat,
  sanitizePbxSettingsForClient,
  savePbxDailySummary,
  upsertPbxCallEvent,
  verifyPbxWebhookSecret,
  writePbxEnabled,
} from '../src/server/pbxCalls';
import { createPbxAmiManager, inferDirection, parseAmiBlock } from '../src/server/pbxAmiClient';

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

  it('returns call log list and daily summary totals with business hours breakdown', async () => {
    const { pool } = createMockPool((sql) => {
      if (sql.includes('SELECT direction, status, billsec_seconds')) {
        return [
          { direction: 'inbound', status: 'ended', billsec_seconds: 90, duration_seconds: 95, started_at: '2026-11-15T15:00:00.000Z' }, // 10:00 AM ET
          { direction: 'outbound', status: 'missed', billsec_seconds: 0, duration_seconds: 10, started_at: '2026-11-16T00:30:00.000Z' }, // 7:30 PM ET (after hours)
        ];
      }
      return [];
    });

    const result = await listPbxCallLogs(pool, { direction: 'inbound', date: '2026-11-15', limit: 50 });
    expect(result.date).toBe('2026-11-15');
    expect(result.summary).toEqual({
      total: 2,
      inbound: 1,
      outbound: 1,
      internal: 0,
      missed: 1,
      answered: 1,
      businessHoursCalls: 1,
      businessHoursAnswered: 1,
      businessHoursMissed: 0,
      afterHoursCalls: 1,
      totalBillsecSeconds: 90,
      avgBillsecSeconds: 90,
    });
  });

  it('detects 7am-6pm Venezuela (America/Caracas) business hours and persists daily summaries for analytics', async () => {
    expect(isDuringPbxBusinessHours('2026-11-15T11:00:00.000Z')).toBe(true); // 07:00 VET (UTC-4)
    expect(isDuringPbxBusinessHours('2026-11-15T21:59:00.000Z')).toBe(true); // 17:59 VET (UTC-4)
    expect(isDuringPbxBusinessHours('2026-11-15T22:00:00.000Z')).toBe(false); // 18:00 VET (UTC-4)
    const range = getUtcRangeForPbxDate('2026-11-15');
    expect(range.startUtc).toBe('2026-11-15 04:00:00');
    expect(range.endUtc).toBe('2026-11-16 04:00:00');

    const { pool, execute } = createMockPool((sql) => {
      if (sql.includes('FROM users')) {
        return [
          { id: 1, name: 'Admin', pbx_extension: '501' },
          { id: 2, name: 'Favio Andrade', pbx_extension: '202' },
          { id: 3, name: 'Darrel Machado', pbx_extension: '204' },
        ];
      }
      if (sql.includes('FROM pbx_daily_summaries')) {
        return [{
          summary_date: '2026-11-14',
          total_calls: 5,
          inbound_calls: 4,
          outbound_calls: 1,
          internal_calls: 0,
          answered_calls: 4,
          missed_calls: 1,
          business_hours_calls: 4,
          business_hours_answered: 4,
          business_hours_missed: 0,
          after_hours_calls: 1,
          total_billsec_seconds: 240,
          avg_billsec_seconds: 60,
        }];
      }
      if (sql.includes('SELECT status, answered_by_ext, rejected_by_exts')) {
        return [
          { status: 'ended', answered_by_ext: '204', rejected_by_exts: '202', billsec_seconds: 45, duration_seconds: 50 },
        ];
      }
      if (sql.includes('SELECT direction, status, billsec_seconds')) {
        return [
          { direction: 'inbound', status: 'ended', billsec_seconds: 40, duration_seconds: 45, started_at: '2026-11-15T16:00:00.000Z' },
        ];
      }
      return [];
    });

    const saved = await savePbxDailySummary(pool, '2026-11-15');
    expect(saved.totalCalls).toBe(1);
    expect(saved.isClosed).toBe(true);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO pbx_daily_summaries'), expect.any(Array));

    const analytics = await listPbxDailyAnalytics(pool, 7);
    expect(analytics.businessHours).toEqual({ start: '07:00', end: '18:00', timeZone: 'America/Caracas' });
    expect(analytics.days.length).toBeGreaterThanOrEqual(2);
    expect(analytics.employeePerformance.find((e) => e.pbxExtension === '204')).toMatchObject({
      userName: 'Darrel Machado',
      answeredCount: 1,
    });
    expect(analytics.employeePerformance.find((e) => e.pbxExtension === '202')).toMatchObject({
      userName: 'Favio Andrade',
      rejectedCount: 1,
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

  it('parses AMI blocks, infers call directions, and processes AMI socket lifecycle events', async () => {
    const parsed = parseAmiBlock('Event: DialBegin\r\nCallerIDNum: 50499990000\r\nInvalidLine\r\n');
    expect(parsed).toEqual({ Event: 'DialBegin', CallerIDNum: '50499990000' });

    expect(inferDirection({ Context: 'from-trunk' })).toBe('inbound');
    expect(inferDirection({ Context: 'from-internal', DestChannel: 'PJSIP/trunk-1' })).toBe('outbound');
    expect(inferDirection({ Context: 'from-internal', Channel: 'PJSIP/501', DestCallerIDNum: '50499990000' })).toBe('outbound');
    expect(inferDirection({ Context: 'from-internal', Channel: 'PJSIP/501', DestCallerIDNum: '502' })).toBe('internal');
    expect(inferDirection({ Context: 'custom-ctx' })).toBe('inbound');

    class FakeSocket extends EventEmitter {
      destroyed = false;
      writes: string[] = [];
      setTimeout = vi.fn();
      write = vi.fn((chunk: string) => {
        this.writes.push(chunk);
        return true;
      });
      destroy = vi.fn(() => {
        this.destroyed = true;
      });
    }

    const fakeSocket = new FakeSocket();
    const spy = vi.spyOn(net, 'createConnection').mockImplementation(((_opts: unknown, cb?: () => void) => {
      queueMicrotask(() => {
        fakeSocket.emit('connect');
        cb?.();
      });
      return fakeSocket as unknown as net.Socket;
    }) as typeof net.createConnection);

    try {
      const { pool } = createMockPool((sql) => {
        if (sql.includes('FROM app_settings')) {
          return [
            { setting_key: 'pbx.enabled', setting_value: '1' },
            { setting_key: 'pbx.ami_host', setting_value: '5.161.82.204' },
            { setting_key: 'pbx.ami_port', setting_value: '5038' },
            { setting_key: 'pbx.ami_user', setting_value: 'radar_monitor' },
            { setting_key: 'pbx.ami_secret', setting_value: 'secret123' },
            { setting_key: 'pbx.live_alerts_enabled', setting_value: '1' },
          ];
        }
        if (sql.includes('FROM pbx_call_logs WHERE uniqueid')) {
          return [{
            id: 1,
            uniqueid: 'u-1',
            direction: 'inbound',
            status: 'ringing',
            caller_number: '99990000',
            started_at: '2026-11-16T00:00:00.000Z',
          }];
        }
        if (sql.includes('COUNT(*) AS totalCalls')) {
          return [{ totalCalls: 1, activeCount: 1 }];
        }
        return [];
      });

      const onActiveChanged = vi.fn();
      const manager = createPbxAmiManager(pool, onActiveChanged);
      await manager.refresh();
      await new Promise((r) => setTimeout(r, 10));

      expect(fakeSocket.writes.some((w) => w.includes('Action: Login'))).toBe(true);

      // Timeout after connect sends Ping
      fakeSocket.emit('timeout');
      expect(fakeSocket.writes.some((w) => w.includes('Action: Ping'))).toBe(true);

      // Auth success + error
      fakeSocket.emit('data', Buffer.from('Response: Success\r\nMessage: Authentication accepted\r\n\r\n'));
      fakeSocket.emit('data', Buffer.from('Response: Error\r\nMessage: Bad auth\r\n\r\n'));

      // Call lifecycle: DialBegin -> root trunk BridgeEnter (ignored) -> secondary Local Hangup (ignored) -> extension BridgeEnter (real 2-party) -> root Hangup -> Cdr
      fakeSocket.emit('data', Buffer.from('Event: DialBegin\r\nUniqueid: u-1\r\nLinkedid: u-1\r\nContext: from-trunk\r\nCallerIDNum: 99990000\r\nExten: 501\r\n\r\n'));
      fakeSocket.emit('data', Buffer.from('Event: BridgeEnter\r\nUniqueid: u-1\r\nLinkedid: u-1\r\nChannel: PJSIP/Telnyx-0001\r\nBridgeNumChannels: 2\r\nCallerIDNum: 99990000\r\n\r\n'));
      fakeSocket.emit('data', Buffer.from('Event: Hangup\r\nUniqueid: u-1-local\r\nLinkedid: u-1\r\n\r\n'));
      fakeSocket.emit('data', Buffer.from('Event: BridgeEnter\r\nUniqueid: u-1-ext\r\nLinkedid: u-1\r\nChannel: PJSIP/501-0002\r\nBridgeNumChannels: 2\r\nCallerIDNum: 501\r\n\r\n'));
      fakeSocket.emit('data', Buffer.from('Event: Hangup\r\nUniqueid: u-1\r\nLinkedid: u-1\r\n\r\n'));
      fakeSocket.emit('data', Buffer.from('Event: Cdr\r\nUniqueid: u-1\r\nLinkedid: u-1\r\nDisposition: ANSWERED\r\nDuration: 20\r\nBillableSeconds: 15\r\n\r\n'));

      // Missed call via root Hangup (DialEnd CANCEL alone does not close before Hangup)
      fakeSocket.emit('data', Buffer.from('Event: DialBegin\r\nUniqueid: u-2\r\nContext: from-trunk\r\nCallerIDNum: 88881111\r\nExten: 502\r\n\r\n'));
      fakeSocket.emit('data', Buffer.from('Event: DialEnd\r\nUniqueid: u-2\r\nDialStatus: CANCEL\r\n\r\n'));
      fakeSocket.emit('data', Buffer.from('Event: Hangup\r\nUniqueid: u-2\r\nLinkedid: u-2\r\n\r\n'));

      // Issabel Queue 101 Ring-All flow: QueueCallerJoin -> ext 201 rejects (Cause 17) -> ext 204 AgentConnect -> ext Hangup
      fakeSocket.emit('data', Buffer.from('Event: QueueCallerJoin\r\nUniqueid: q-1\r\nLinkedid: q-1\r\nQueue: 101\r\nChannel: PJSIP/Telnyx-0010\r\nCallerIDNum: +19844004618\r\nCallerIDName: English:+19844004618\r\n\r\n'));
      fakeSocket.emit('data', Buffer.from('Event: DialBegin\r\nUniqueid: q-1-201\r\nLinkedid: q-1\r\nDestChannel: PJSIP/201-0001\r\nDestCallerIDNum: 201\r\n\r\n'));
      fakeSocket.emit('data', Buffer.from('Event: Hangup\r\nUniqueid: q-1-201\r\nLinkedid: q-1\r\nChannel: PJSIP/201-0001\r\nCause: 17\r\n\r\n'));
      fakeSocket.emit('data', Buffer.from('Event: AgentConnect\r\nUniqueid: q-1-204\r\nLinkedid: q-1\r\nInterface: PJSIP/204-0002\r\n\r\n'));
      fakeSocket.emit('data', Buffer.from('Event: Hangup\r\nUniqueid: q-1-204\r\nLinkedid: q-1\r\nChannel: PJSIP/204-0002\r\n\r\n'));

      // Issabel Queue 101 abandoned call -> missed with queue 101 (never 501)
      fakeSocket.emit('data', Buffer.from('Event: QueueCallerJoin\r\nUniqueid: q-2\r\nLinkedid: q-2\r\nQueue: 101\r\nChannel: PJSIP/Telnyx-0011\r\nCallerIDNum: +19844004618\r\nCallerIDName: Español:+19844004618\r\n\r\n'));
      fakeSocket.emit('data', Buffer.from('Event: QueueCallerAbandon\r\nUniqueid: q-2\r\nLinkedid: q-2\r\nQueue: 101\r\n\r\n'));

      // Extension presence events (ContactStatus, ContactList, DeviceStateChange, PeerStatus, EndpointList, PeerEntry)
      fakeSocket.emit('data', Buffer.from('Event: ContactStatus\r\nAOR: 204\r\nContactStatus: Reachable\r\n\r\n'));
      fakeSocket.emit('data', Buffer.from('Event: ContactList\r\nEndpoint: 203\r\nStatus: Reachable\r\n\r\n'));
      fakeSocket.emit('data', Buffer.from('Event: DeviceStateChange\r\nDevice: PJSIP/301\r\nState: UNAVAILABLE\r\n\r\n'));
      fakeSocket.emit('data', Buffer.from('Event: PeerStatus\r\nPeer: SIP/1000\r\nPeerStatus: Unregistered\r\n\r\n'));
      fakeSocket.emit('data', Buffer.from('Event: EndpointList\r\nObjectName: 202\r\nDeviceState: Not in use\r\n\r\n'));
      fakeSocket.emit('data', Buffer.from('Event: PeerEntry\r\nObjectName: 501\r\nStatus: OK (12 ms)\r\n\r\n'));
      expect(manager.getExtensionLiveStatuses()).toMatchObject({
        '204': 'online',
        '203': 'online',
        '301': 'offline',
        '1000': 'offline',
        '202': 'online',
        '501': 'online',
      });

      fakeSocket.emit('error', new Error('ECONNRESET'));
      fakeSocket.emit('close');
      await new Promise((r) => setTimeout(r, 20));
      manager.stop();
    } finally {
      spy.mockRestore();
    }
  });

  it('records extension presence changes without duplicates and computes workday availability', async () => {
    const { pool: dedupPool, execute: dedupExec } = createMockPool((sql) => {
      if (sql.includes('FROM pbx_extension_presence_logs')) return [{ status: 'online' }];
      return [];
    });
    expect(await recordPbxExtensionPresence(dedupPool, '204', 'online', 'ContactStatus')).toBe(false);
    expect(dedupExec).not.toHaveBeenCalled();

    const { pool, execute } = createMockPool((sql) => {
      if (sql.includes('FROM users')) {
        return [{ id: 3, name: 'Favio Andrade', pbx_extension: '204' }];
      }
      if (sql.includes('WHERE occurred_at >= ? AND occurred_at < ?')) {
        return [
          { extension: '204', status: 'online', reason: 'ContactStatus:Reachable', occurred_at: '2026-11-15T11:00:00.000Z' }, // 07:00 VET
          { extension: '204', status: 'offline', reason: 'ContactStatus:Removed', occurred_at: '2026-11-15T13:00:00.000Z' }, // 09:00 VET (2h)
        ];
      }
      return [];
    });
    expect(await recordPbxExtensionPresence(pool, '204', 'online', 'ContactStatus')).toBe(true);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO pbx_extension_presence_logs'), expect.any(Array));

    const now = new Date('2026-11-15T15:00:00.000Z'); // 11:00 VET (4h elapsed in workday 07:00-11:00)
    const report = await getPbxExtensionsPresenceReport(pool, '2026-11-15', { '204': 'offline' }, now);
    expect(report.extensions[0]).toMatchObject({
      extension: '204',
      userName: 'Favio Andrade',
      liveStatus: 'offline',
      connectedWorkdaySeconds: 7200, // 2h connected out of 4h elapsed = 50%
      workdayElapsedSeconds: 14400,
      availabilityPct: 50,
    });
  });
});
