import crypto from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';

export type PbxCallDirection = 'inbound' | 'outbound' | 'internal';
export type PbxCallStatus = 'ringing' | 'answered' | 'missed' | 'ended';

export interface PbxCallEventInput {
  uniqueid: string;
  event: PbxCallStatus;
  direction?: PbxCallDirection;
  caller_number: string;
  caller_name?: string | null;
  destination?: string | null;
  answered_by_ext?: string | null;
  duration_seconds?: number;
  billsec_seconds?: number;
  timestamp?: string | null;
}

export interface PbxClientMatch {
  clientId: number;
  clientName: string;
  orderId: string | null;
  orderCode: string | null;
}

export interface PbxCallRecord {
  id: number;
  uniqueid: string;
  direction: PbxCallDirection;
  status: PbxCallStatus;
  callerNumber: string;
  callerName: string | null;
  destination: string | null;
  answeredByExt: string | null;
  clientId: number | null;
  clientName: string | null;
  orderId: string | null;
  orderCode: string | null;
  durationSeconds: number;
  billsecSeconds: number;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
}

export interface PbxCallSummary {
  total: number;
  inbound: number;
  outbound: number;
  missed: number;
  answered: number;
}

export type PbxHealthStatus = 'online' | 'error' | 'offline' | 'waiting' | 'disabled' | 'misconfigured';

export interface PbxSettingsSnapshot {
  enabled: boolean;
  liveAlertsEnabled: boolean;
  secretConfigured: boolean;
  secretSource: 'db' | 'env' | 'none';
  webhookPath: string;
  amiHost: string;
  amiPort: number;
  amiUser: string;
  ringTimeoutSeconds: number;
  healthStatus: PbxHealthStatus;
  bridgeStatus: 'online' | 'error' | 'offline';
  lastHeartbeatAt: string | null;
  lastEventAt: string | null;
  lastError: string | null;
  totalCalls: number;
  activeCount: number;
}

export interface PbxSettingsUpdateInput {
  enabled?: boolean;
  liveAlertsEnabled?: boolean;
  amiHost?: string;
  amiPort?: number;
  amiUser?: string;
  webhookSecret?: string;
  ringTimeoutSeconds?: number;
}

const HEARTBEAT_TTL_MS = 90_000;
const PBX_SETTING_KEYS = [
  'pbx.enabled',
  'pbx.live_alerts_enabled',
  'pbx.ami_host',
  'pbx.ami_port',
  'pbx.ami_user',
  'pbx.webhook_secret',
  'pbx.ring_timeout_seconds',
  'pbx.last_heartbeat_at',
  'pbx.last_event_at',
  'pbx.bridge_status',
  'pbx.last_error',
];

export const getExpectedPbxWebhookSecret = async (pool: Pool): Promise<string | undefined> => {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT setting_value FROM app_settings WHERE setting_key = 'pbx.webhook_secret' LIMIT 1",
  );
  const dbSecret = String(rows[0]?.setting_value ?? '').trim();
  if (dbSecret) return dbSecret;
  const envSecret = String(process.env.PBX_WEBHOOK_SECRET ?? '').trim();
  return envSecret || undefined;
};

export const readPbxSettings = async (pool: Pool, now = new Date()): Promise<PbxSettingsSnapshot> => {
  const placeholders = PBX_SETTING_KEYS.map(() => '?').join(', ');
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (${placeholders})`,
    PBX_SETTING_KEYS,
  );
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(String(row.setting_key), String(row.setting_value ?? ''));
  }

  const enabled = (map.get('pbx.enabled') ?? '1') === '1';
  const liveAlertsEnabled = (map.get('pbx.live_alerts_enabled') ?? '1') === '1';
  const dbSecret = (map.get('pbx.webhook_secret') || '').trim();
  const envSecret = (process.env.PBX_WEBHOOK_SECRET || '').trim();
  const secretSource: 'db' | 'env' | 'none' = dbSecret ? 'db' : envSecret ? 'env' : 'none';
  const secretConfigured = secretSource !== 'none';
  const amiHost = (map.get('pbx.ami_host') || '5.161.82.204').trim();
  const amiPortRaw = Number(map.get('pbx.ami_port') || 5038);
  const amiPort = Number.isFinite(amiPortRaw) && amiPortRaw > 0 ? amiPortRaw : 5038;
  const amiUser = (map.get('pbx.ami_user') || 'radar_monitor').trim();
  const ringRaw = Number(map.get('pbx.ring_timeout_seconds') || STALE_RINGING_SECONDS);
  const ringTimeoutSeconds = Number.isFinite(ringRaw) && ringRaw >= 15 ? Math.min(300, Math.round(ringRaw)) : STALE_RINGING_SECONDS;

  const lastHeartbeatAt = map.get('pbx.last_heartbeat_at') || null;
  const lastEventAt = map.get('pbx.last_event_at') || null;
  const rawBridge = map.get('pbx.bridge_status') || 'offline';
  const bridgeStatus: 'online' | 'error' | 'offline' = rawBridge === 'online' || rawBridge === 'error' ? rawBridge : 'offline';
  const lastError = map.get('pbx.last_error') || null;

  const [countRows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS totalCalls, SUM(CASE WHEN direction = 'inbound' AND status = 'ringing' THEN 1 ELSE 0 END) AS activeCount FROM pbx_call_logs",
  );
  const totalCalls = Number(countRows[0]?.totalCalls || 0);
  const activeCount = Number(countRows[0]?.activeCount || 0);

  let healthStatus: PbxHealthStatus;
  if (!enabled) {
    healthStatus = 'disabled';
  } else if (!secretConfigured) {
    healthStatus = 'misconfigured';
  } else if (bridgeStatus === 'error' && lastError) {
    healthStatus = 'error';
  } else if (lastHeartbeatAt && now.getTime() - new Date(lastHeartbeatAt).getTime() <= HEARTBEAT_TTL_MS) {
    healthStatus = 'online';
  } else if (lastHeartbeatAt || lastEventAt) {
    healthStatus = 'offline';
  } else {
    healthStatus = 'waiting';
  }

  return {
    enabled,
    liveAlertsEnabled,
    secretConfigured,
    secretSource,
    webhookPath: '/api/pbx/events',
    amiHost,
    amiPort,
    amiUser,
    ringTimeoutSeconds,
    healthStatus,
    bridgeStatus,
    lastHeartbeatAt,
    lastEventAt,
    lastError,
    totalCalls,
    activeCount,
  };
};

export const writePbxSettings = async (
  pool: Pool,
  input: PbxSettingsUpdateInput,
  userId: number,
): Promise<PbxSettingsSnapshot> => {
  const entries: Array<[string, string]> = [];
  if (typeof input.enabled === 'boolean') entries.push(['pbx.enabled', input.enabled ? '1' : '0']);
  if (typeof input.liveAlertsEnabled === 'boolean') entries.push(['pbx.live_alerts_enabled', input.liveAlertsEnabled ? '1' : '0']);
  if (typeof input.amiHost === 'string' && input.amiHost.trim()) entries.push(['pbx.ami_host', input.amiHost.trim().slice(0, 120)]);
  if (typeof input.amiPort === 'number' && Number.isFinite(input.amiPort) && input.amiPort > 0) entries.push(['pbx.ami_port', String(Math.round(input.amiPort))]);
  if (typeof input.amiUser === 'string' && input.amiUser.trim()) entries.push(['pbx.ami_user', input.amiUser.trim().slice(0, 64)]);
  if (typeof input.webhookSecret === 'string' && input.webhookSecret.trim()) entries.push(['pbx.webhook_secret', input.webhookSecret.trim().slice(0, 200)]);
  if (typeof input.ringTimeoutSeconds === 'number' && Number.isFinite(input.ringTimeoutSeconds)) {
    entries.push(['pbx.ring_timeout_seconds', String(Math.max(15, Math.min(300, Math.round(input.ringTimeoutSeconds))))]);
  }

  for (const [key, value] of entries) {
    await pool.execute(
      'INSERT INTO app_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value), updated_by=VALUES(updated_by)',
      [key, value, userId],
    );
  }
  return readPbxSettings(pool);
};

export const writePbxEnabled = async (pool: Pool, enabled: boolean, userId: number): Promise<PbxSettingsSnapshot> =>
  writePbxSettings(pool, { enabled }, userId);

export const recordPbxHeartbeat = async (
  pool: Pool,
  input: { status: 'online' | 'error'; error?: string | null; now?: Date },
): Promise<PbxSettingsSnapshot> => {
  const timestamp = (input.now || new Date()).toISOString();
  await pool.execute(
    "INSERT INTO app_settings (setting_key, setting_value) VALUES ('pbx.bridge_status', ?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)",
    [input.status],
  );
  if (input.status === 'online') {
    await pool.execute(
      "INSERT INTO app_settings (setting_key, setting_value) VALUES ('pbx.last_heartbeat_at', ?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)",
      [timestamp],
    );
    await pool.execute(
      "INSERT INTO app_settings (setting_key, setting_value) VALUES ('pbx.last_error', '') ON DUPLICATE KEY UPDATE setting_value=''",
    );
  } else if (input.error) {
    await pool.execute(
      "INSERT INTO app_settings (setting_key, setting_value) VALUES ('pbx.last_error', ?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)",
      [input.error.slice(0, 500)],
    );
  }
  return readPbxSettings(pool);
};

const STALE_RINGING_SECONDS = 120;

export const normalizePhoneDigits = (value: string | null | undefined): string => {
  if (!value) return '';
  return String(value).replace(/\D+/g, '');
};

export const verifyPbxWebhookSecret = (
  providedSecret: string | undefined,
  expectedSecret: string | undefined,
): boolean => {
  if (!expectedSecret || !providedSecret) return false;
  const a = Buffer.from(providedSecret, 'utf8');
  const b = Buffer.from(expectedSecret, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

const toMysqlDatetime = (isoOrNull?: string | null, fallback = new Date()): string => {
  const parsed = isoOrNull ? new Date(isoOrNull) : fallback;
  const target = Number.isNaN(parsed.getTime()) ? fallback : parsed;
  return target.toISOString().slice(0, 19).replace('T', ' ');
};

export const matchClientAndOrderByPhone = async (
  pool: Pool,
  phone: string,
): Promise<PbxClientMatch | null> => {
  const digits = normalizePhoneDigits(phone);
  if (digits.length < 7) return null;
  const suffix = digits.slice(-8);

  const [clientRows] = await pool.query<RowDataPacket[]>(
    `SELECT id,
            COALESCE(NULLIF(TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))), ''), company, phone) AS name
     FROM customers
     WHERE deleted_at IS NULL
       AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone, ''), '-', ''), ' ', ''), '(', ''), ')', ''), '+', '') LIKE ?
     ORDER BY id DESC
     LIMIT 1`,
    [`%${suffix}`],
  );
  if (!clientRows.length) return null;

  const clientId = Number(clientRows[0].id);
  const clientName = String(clientRows[0].name || '');

  const [orderRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, order_code
     FROM orders
     WHERE customer_id = ? AND deleted_at IS NULL
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [clientId],
  );

  return {
    clientId,
    clientName,
    orderId: orderRows.length ? String(orderRows[0].id) : null,
    orderCode: orderRows.length && orderRows[0].order_code ? String(orderRows[0].order_code) : null,
  };
};

const mapCallRow = (row: RowDataPacket): PbxCallRecord => ({
  id: Number(row.id),
  uniqueid: String(row.uniqueid),
  direction: (row.direction || 'inbound') as PbxCallDirection,
  status: (row.status || 'ringing') as PbxCallStatus,
  callerNumber: String(row.caller_number || ''),
  callerName: row.caller_name ? String(row.caller_name) : null,
  destination: row.destination ? String(row.destination) : null,
  answeredByExt: row.answered_by_ext ? String(row.answered_by_ext) : null,
  clientId: row.client_id != null ? Number(row.client_id) : null,
  clientName: row.client_name ? String(row.client_name) : null,
  orderId: row.order_id ? String(row.order_id) : null,
  orderCode: row.order_code ? String(row.order_code) : null,
  durationSeconds: Number(row.duration_seconds || 0),
  billsecSeconds: Number(row.billsec_seconds || 0),
  startedAt: row.started_at ? new Date(row.started_at).toISOString() : new Date().toISOString(),
  answeredAt: row.answered_at ? new Date(row.answered_at).toISOString() : null,
  endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
});

export const upsertPbxCallEvent = async (
  pool: Pool,
  input: PbxCallEventInput,
): Promise<PbxCallRecord> => {
  const uniqueid = input.uniqueid.trim().slice(0, 64);
  const direction: PbxCallDirection = input.direction || 'inbound';
  const callerNumber = input.caller_number.trim().slice(0, 64) || 'Desconocido';
  const callerName = input.caller_name ? input.caller_name.trim().slice(0, 120) : null;
  const destination = input.destination ? input.destination.trim().slice(0, 64) : null;
  const answeredByExt = input.answered_by_ext ? input.answered_by_ext.trim().slice(0, 32) : null;
  const durationSeconds = Math.max(0, Math.round(Number(input.duration_seconds || 0)));
  const billsecSeconds = Math.max(0, Math.round(Number(input.billsec_seconds || 0)));
  const eventAt = toMysqlDatetime(input.timestamp);

  const lookupPhone = direction === 'outbound' && destination ? destination : callerNumber;
  const match = await matchClientAndOrderByPhone(pool, lookupPhone);

  const answeredAt = input.event === 'answered' ? eventAt : null;
  const endedAt = input.event === 'missed' || input.event === 'ended' ? eventAt : null;

  await pool.execute(
    `INSERT INTO pbx_call_logs (
      uniqueid, direction, status, caller_number, caller_name, destination, answered_by_ext,
      client_id, client_name, order_id, order_code, duration_seconds, billsec_seconds,
      started_at, answered_at, ended_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      status = CASE
        WHEN VALUES(status) = 'ringing' AND status IN ('answered', 'missed', 'ended') THEN status
        WHEN VALUES(status) = 'ended' AND status = 'missed' THEN 'missed'
        ELSE VALUES(status)
      END,
      caller_name = COALESCE(VALUES(caller_name), caller_name),
      destination = COALESCE(VALUES(destination), destination),
      answered_by_ext = COALESCE(VALUES(answered_by_ext), answered_by_ext),
      client_id = COALESCE(client_id, VALUES(client_id)),
      client_name = COALESCE(client_name, VALUES(client_name)),
      order_id = COALESCE(order_id, VALUES(order_id)),
      order_code = COALESCE(order_code, VALUES(order_code)),
      duration_seconds = GREATEST(duration_seconds, VALUES(duration_seconds)),
      billsec_seconds = GREATEST(billsec_seconds, VALUES(billsec_seconds)),
      answered_at = COALESCE(answered_at, VALUES(answered_at)),
      ended_at = COALESCE(VALUES(ended_at), ended_at)`,
    [
      uniqueid,
      direction,
      input.event,
      callerNumber,
      callerName,
      destination,
      answeredByExt,
      match?.clientId ?? null,
      match?.clientName ?? null,
      match?.orderId ?? null,
      match?.orderCode ?? null,
      durationSeconds,
      billsecSeconds,
      eventAt,
      answeredAt,
      endedAt,
    ],
  );

  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM pbx_call_logs WHERE uniqueid = ? LIMIT 1',
    [uniqueid],
  );
  await pool.execute(
    "INSERT INTO app_settings (setting_key, setting_value) VALUES ('pbx.last_event_at', ?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)",
    [new Date().toISOString()],
  ).catch(() => {});
  return mapCallRow(rows[0]);
};

export const listActiveIncomingCalls = async (pool: Pool): Promise<PbxCallRecord[]> => {
  await pool.execute(
    `UPDATE pbx_call_logs
     SET status = 'missed', ended_at = COALESCE(ended_at, UTC_TIMESTAMP())
     WHERE status = 'ringing'
       AND started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? SECOND)`,
    [STALE_RINGING_SECONDS],
  );

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT *
     FROM pbx_call_logs
     WHERE direction = 'inbound' AND status = 'ringing'
     ORDER BY started_at DESC, id DESC
     LIMIT 10`,
  );
  return rows.map(mapCallRow);
};

export const listPbxCallLogs = async (
  pool: Pool,
  filters: { direction?: string; status?: string; search?: string; limit?: number } = {},
): Promise<{ calls: PbxCallRecord[]; summary: PbxCallSummary }> => {
  const limit = Math.min(200, Math.max(1, Number(filters.limit || 100)));
  const where: string[] = [];
  const params: Array<string | number> = [];

  if (filters.direction && ['inbound', 'outbound', 'internal'].includes(filters.direction)) {
    where.push('direction = ?');
    params.push(filters.direction);
  }
  if (filters.status && ['ringing', 'answered', 'missed', 'ended'].includes(filters.status)) {
    where.push('status = ?');
    params.push(filters.status);
  }
  if (filters.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    where.push('(caller_number LIKE ? OR caller_name LIKE ? OR client_name LIKE ? OR destination LIKE ? OR answered_by_ext LIKE ?)');
    params.push(q, q, q, q, q);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM pbx_call_logs ${whereSql} ORDER BY started_at DESC, id DESC LIMIT ?`,
    [...params, limit],
  );

  const [summaryRows] = await pool.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END) AS inbound,
       SUM(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END) AS outbound,
       SUM(CASE WHEN status = 'missed' THEN 1 ELSE 0 END) AS missed,
       SUM(CASE WHEN status IN ('answered', 'ended') THEN 1 ELSE 0 END) AS answered
     FROM pbx_call_logs`,
  );

  const s = (summaryRows[0] || {}) as Partial<Record<string, unknown>>;
  return {
    calls: rows.map(mapCallRow),
    summary: {
      total: Number(s.total || 0),
      inbound: Number(s.inbound || 0),
      outbound: Number(s.outbound || 0),
      missed: Number(s.missed || 0),
      answered: Number(s.answered || 0),
    },
  };
};
