import crypto from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';

export type PbxCallDirection = 'inbound' | 'outbound' | 'internal';
export type PbxCallStatus = 'ringing' | 'answered' | 'missed' | 'ended';
export type PbxCallQaStatus = 'pending' | 'correct' | 'incorrect' | 'error';

export interface PbxCallQaChecklistItem {
  passed: boolean | null;
  note: string;
}

export interface PbxCallQaResult {
  verdict: 'correcta' | 'incorrecta';
  score: number;
  summary: string;
  failureReasons: string[];
  checklist: {
    officialGreeting: PbxCallQaChecklistItem;
    askedNeed: PbxCallQaChecklistItem;
    realInventorySearch: PbxCallQaChecklistItem;
    priceAndMilesIfAvailable: PbxCallQaChecklistItem;
    courteousGoodbye: PbxCallQaChecklistItem;
  };
  transcript: string;
  model?: string;
}

export interface PbxCallEventInput {
  uniqueid: string;
  event: PbxCallStatus;
  direction?: PbxCallDirection;
  caller_number: string;
  caller_name?: string | null;
  ivr_language?: string | null;
  destination?: string | null;
  queue_name?: string | null;
  answered_by_ext?: string | null;
  rejected_by_exts?: string[] | null;
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
  ivrLanguage: string | null;
  destination: string | null;
  queueName: string | null;
  answeredByExt: string | null;
  rejectedByExts: string[];
  clientId: number | null;
  clientName: string | null;
  orderId: string | null;
  orderCode: string | null;
  durationSeconds: number;
  billsecSeconds: number;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  recordingUrl: string | null;
  recordingMimeType: string | null;
  recordingUploadedAt: string | null;
  qaStatus: PbxCallQaStatus | null;
  qaScore: number | null;
  qaResult: PbxCallQaResult | null;
  qaAnalyzedAt: string | null;
}

export interface PbxCallSummary {
  total: number;
  inbound: number;
  outbound: number;
  internal: number;
  missed: number;
  answered: number;
  businessHoursCalls: number;
  businessHoursAnswered: number;
  businessHoursMissed: number;
  afterHoursCalls: number;
  totalBillsecSeconds: number;
  avgBillsecSeconds: number;
}

export interface PbxDailyAnalyticsRow {
  date: string;
  totalCalls: number;
  inboundCalls: number;
  outboundCalls: number;
  internalCalls: number;
  answeredCalls: number;
  missedCalls: number;
  answerRate: number;
  businessHoursCalls: number;
  businessHoursAnswered: number;
  businessHoursMissed: number;
  afterHoursCalls: number;
  totalBillsecSeconds: number;
  avgBillsecSeconds: number;
  isClosed: boolean;
}

export interface PbxEmployeeDailyBreakdown {
  date: string;
  receivedCount: number;
  answeredCount: number;
  missedCount: number;
  rejectedCount: number;
  outboundCount: number;
  outboundAnsweredCount: number;
  answerRate: number;
  totalTalkSeconds: number;
  avgTalkSeconds: number;
}

export interface PbxEmployeeCallPerformance {
  userId: number | null;
  userName: string;
  pbxExtension: string;
  receivedCount: number;
  answeredCount: number;
  missedCount: number;
  rejectedCount: number;
  outboundCount: number;
  outboundAnsweredCount: number;
  answerRate: number;
  totalTalkSeconds: number;
  avgTalkSeconds: number;
  dailyBreakdown: PbxEmployeeDailyBreakdown[];
}

export interface PbxExtensionPresenceEvent {
  status: 'online' | 'offline';
  reason: string | null;
  occurredAt: string;
}

export interface PbxExtensionPresenceReportRow {
  extension: string;
  userId: number | null;
  userName: string;
  liveStatus: 'online' | 'offline' | 'in_call' | 'unknown';
  firstConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  connectedWorkdaySeconds: number;
  workdayElapsedSeconds: number;
  availabilityPct: number;
  events: PbxExtensionPresenceEvent[];
}

export type PbxHealthStatus = 'online' | 'error' | 'offline' | 'waiting' | 'disabled' | 'misconfigured';

export interface PbxSettingsSnapshot {
  enabled: boolean;
  liveAlertsEnabled: boolean;
  secretConfigured: boolean;
  amiSecretConfigured: boolean;
  geminiApiKeyConfigured: boolean;
  amiSecretValue?: string;
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
  amiSecret?: string;
  webhookSecret?: string;
  geminiApiKey?: string;
  ringTimeoutSeconds?: number;
}

const HEARTBEAT_TTL_MS = 90_000;
const PBX_SETTING_KEYS = [
  'pbx.enabled',
  'pbx.live_alerts_enabled',
  'pbx.ami_host',
  'pbx.ami_port',
  'pbx.ami_user',
  'pbx.ami_secret',
  'pbx.webhook_secret',
  'pbx.gemini_api_key',
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

export const getGeminiApiKey = async (pool: Pool): Promise<string | undefined> => {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT setting_value FROM app_settings WHERE setting_key = 'pbx.gemini_api_key' LIMIT 1",
  );
  const dbKey = String(rows[0]?.setting_value ?? '').trim();
  if (dbKey) return dbKey;
  const envKey = String(process.env.GEMINI_API_KEY ?? '').trim();
  return envKey || undefined;
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
  const amiSecretValue = (map.get('pbx.ami_secret') || process.env.PBX_AMI_SECRET || '').trim();
  const amiSecretConfigured = Boolean(amiSecretValue);
  const geminiApiKeyConfigured = Boolean((map.get('pbx.gemini_api_key') || process.env.GEMINI_API_KEY || '').trim());
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
  } else if (!secretConfigured && !amiSecretConfigured) {
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
    amiSecretConfigured,
    geminiApiKeyConfigured,
    amiSecretValue: amiSecretValue || undefined,
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

export const sanitizePbxSettingsForClient = (snapshot: PbxSettingsSnapshot): Omit<PbxSettingsSnapshot, 'amiSecretValue'> => {
  const { amiSecretValue: _omit, ...rest } = snapshot;
  return rest;
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
  if (typeof input.amiSecret === 'string' && input.amiSecret.trim()) entries.push(['pbx.ami_secret', input.amiSecret.trim().slice(0, 200)]);
  if (typeof input.webhookSecret === 'string' && input.webhookSecret.trim()) entries.push(['pbx.webhook_secret', input.webhookSecret.trim().slice(0, 200)]);
  if (typeof input.geminiApiKey === 'string' && input.geminiApiKey.trim()) entries.push(['pbx.gemini_api_key', input.geminiApiKey.trim().slice(0, 255)]);
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

export const parseCallerLanguageAndName = (
  callerNumber: string,
  callerName: string | null | undefined,
): { cleanName: string | null; ivrLanguage: string | null } => {
  const raw = (callerName || '').trim();
  if (!raw || raw === '<unknown>') return { cleanName: null, ivrLanguage: null };
  const match = raw.match(/^(English|Español|Espanol)\s*:\s*(.*)$/i);
  if (!match) return { cleanName: raw.slice(0, 120), ivrLanguage: null };
  const lang = match[1].toLowerCase().startsWith('eng') ? 'English' : 'Español';
  const rest = match[2].trim();
  const numDigits = normalizePhoneDigits(callerNumber);
  const restDigits = normalizePhoneDigits(rest);
  const cleanName = !rest || (numDigits && restDigits === numDigits) ? null : rest.slice(0, 120);
  return { cleanName, ivrLanguage: lang };
};

const parseRejectedExts = (raw: unknown): string[] => {
  if (!raw) return [];
  return [...new Set(String(raw).split(',').map((s) => s.trim()).filter(Boolean))];
};

const parseQaResult = (raw: unknown): PbxCallQaResult | null => {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as PbxCallQaResult;
  try {
    return JSON.parse(String(raw)) as PbxCallQaResult;
  } catch {
    return null;
  }
};

const mapCallRow = (row: RowDataPacket): PbxCallRecord => {
  const callerNumber = String(row.caller_number || '');
  const parsed = parseCallerLanguageAndName(callerNumber, row.caller_name ? String(row.caller_name) : null);
  return {
    id: Number(row.id),
    uniqueid: String(row.uniqueid),
    direction: (row.direction || 'inbound') as PbxCallDirection,
    status: (row.status || 'ringing') as PbxCallStatus,
    callerNumber,
    callerName: parsed.cleanName,
    ivrLanguage: row.ivr_language ? String(row.ivr_language) : parsed.ivrLanguage,
    destination: row.destination ? String(row.destination) : null,
    queueName: row.queue_name ? String(row.queue_name) : null,
    answeredByExt: row.status === 'missed' ? null : (row.answered_by_ext ? String(row.answered_by_ext) : null),
    rejectedByExts: parseRejectedExts(row.rejected_by_exts),
    clientId: row.client_id != null ? Number(row.client_id) : null,
    clientName: row.client_name ? String(row.client_name) : null,
    orderId: row.order_id ? String(row.order_id) : null,
    orderCode: row.order_code ? String(row.order_code) : null,
    durationSeconds: Number(row.duration_seconds || 0),
    billsecSeconds: Number(row.billsec_seconds || 0),
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : new Date().toISOString(),
    answeredAt: row.answered_at ? new Date(row.answered_at).toISOString() : null,
    endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
    recordingUrl: row.recording_url ? `/api/pbx/calls/${encodeURIComponent(String(row.uniqueid))}/recording` : null,
    recordingMimeType: row.recording_mime_type ? String(row.recording_mime_type) : null,
    recordingUploadedAt: row.recording_uploaded_at ? new Date(row.recording_uploaded_at).toISOString() : null,
    qaStatus: row.qa_status ? (String(row.qa_status) as PbxCallQaStatus) : null,
    qaScore: row.qa_score != null ? Number(row.qa_score) : null,
    qaResult: parseQaResult(row.qa_result),
    qaAnalyzedAt: row.qa_analyzed_at ? new Date(row.qa_analyzed_at).toISOString() : null,
  };
};

export const getPbxCallByUniqueId = async (
  pool: Pool,
  uniqueid: string,
): Promise<PbxCallRecord | null> => {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM pbx_call_logs WHERE uniqueid = ? LIMIT 1',
    [uniqueid],
  );
  return rows[0] ? mapCallRow(rows[0]) : null;
};

export const upsertPbxCallEvent = async (
  pool: Pool,
  input: PbxCallEventInput,
): Promise<PbxCallRecord> => {
  const uniqueid = input.uniqueid.trim().slice(0, 64);
  const direction: PbxCallDirection = input.direction || 'inbound';
  const callerNumber = input.caller_number.trim().slice(0, 64) || 'Desconocido';
  const parsedCaller = parseCallerLanguageAndName(callerNumber, input.caller_name);
  const callerName = parsedCaller.cleanName;
  const ivrLanguage = (input.ivr_language || parsedCaller.ivrLanguage || '').trim().slice(0, 24) || null;
  const destination = input.destination ? input.destination.trim().slice(0, 64) : null;
  const queueName = input.queue_name ? input.queue_name.trim().slice(0, 32) : null;
  const answeredByExt = input.event === 'missed'
    ? null
    : (input.answered_by_ext ? input.answered_by_ext.trim().slice(0, 32) : null);
  const rejectedCsv = Array.isArray(input.rejected_by_exts) && input.rejected_by_exts.length
    ? [...new Set(input.rejected_by_exts.map((s) => s.trim()).filter(Boolean))].join(',').slice(0, 255)
    : null;
  const durationSeconds = Math.max(0, Math.round(Number(input.duration_seconds || 0)));
  const billsecSeconds = Math.max(0, Math.round(Number(input.billsec_seconds || 0)));
  const eventAt = toMysqlDatetime(input.timestamp);

  const lookupPhone = direction === 'outbound' && destination ? destination : callerNumber;
  const match = await matchClientAndOrderByPhone(pool, lookupPhone);

  const answeredAt = input.event === 'answered' ? eventAt : null;
  const endedAt = input.event === 'missed' || input.event === 'ended' ? eventAt : null;

  await pool.execute(
    `INSERT INTO pbx_call_logs (
      uniqueid, direction, status, caller_number, caller_name, ivr_language, destination, queue_name,
      answered_by_ext, rejected_by_exts, client_id, client_name, order_id, order_code,
      duration_seconds, billsec_seconds, started_at, answered_at, ended_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      status = CASE
        WHEN VALUES(status) = 'ringing' AND status IN ('answered', 'missed', 'ended') THEN status
        WHEN VALUES(status) = 'ended' AND status = 'missed' THEN 'missed'
        ELSE VALUES(status)
      END,
      caller_name = COALESCE(VALUES(caller_name), caller_name),
      ivr_language = COALESCE(VALUES(ivr_language), ivr_language),
      destination = COALESCE(VALUES(destination), destination),
      queue_name = COALESCE(VALUES(queue_name), queue_name),
      answered_by_ext = CASE
        WHEN VALUES(status) = 'missed' THEN NULL
        ELSE COALESCE(VALUES(answered_by_ext), answered_by_ext)
      END,
      rejected_by_exts = COALESCE(VALUES(rejected_by_exts), rejected_by_exts),
      client_id = COALESCE(client_id, VALUES(client_id)),
      client_name = COALESCE(client_name, VALUES(client_name)),
      order_id = COALESCE(order_id, VALUES(order_id)),
      order_code = COALESCE(order_code, VALUES(order_code)),
      duration_seconds = GREATEST(
        duration_seconds,
        VALUES(duration_seconds),
        CASE WHEN VALUES(ended_at) IS NOT NULL THEN GREATEST(0, TIMESTAMPDIFF(SECOND, started_at, VALUES(ended_at))) ELSE 0 END
      ),
      billsec_seconds = GREATEST(
        billsec_seconds,
        VALUES(billsec_seconds),
        CASE WHEN VALUES(ended_at) IS NOT NULL AND answered_at IS NOT NULL THEN GREATEST(0, TIMESTAMPDIFF(SECOND, answered_at, VALUES(ended_at))) ELSE 0 END
      ),
      answered_at = COALESCE(answered_at, VALUES(answered_at)),
      ended_at = COALESCE(VALUES(ended_at), ended_at)`,
    [
      uniqueid,
      direction,
      input.event,
      callerNumber,
      callerName,
      ivrLanguage,
      destination,
      queueName,
      answeredByExt,
      rejectedCsv,
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

export const closeOrphanedPbxCalls = async (pool: Pool): Promise<void> => {
  await pool.execute(
    `UPDATE pbx_call_logs
     SET status = 'missed',
         answered_by_ext = NULL,
         ended_at = COALESCE(ended_at, UTC_TIMESTAMP())
     WHERE status = 'ringing'
       AND started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? SECOND)`,
    [STALE_RINGING_SECONDS],
  );
  await pool.execute(
    `UPDATE pbx_call_logs
     SET status = 'ended',
         ended_at = COALESCE(ended_at, UTC_TIMESTAMP()),
         duration_seconds = GREATEST(duration_seconds, GREATEST(0, TIMESTAMPDIFF(SECOND, started_at, UTC_TIMESTAMP()))),
         billsec_seconds = GREATEST(billsec_seconds, CASE WHEN answered_at IS NOT NULL THEN GREATEST(0, TIMESTAMPDIFF(SECOND, answered_at, UTC_TIMESTAMP())) ELSE 0 END)
     WHERE status = 'answered'
       AND COALESCE(answered_at, started_at) < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 HOUR)`,
  );
};

export const listActiveIncomingCalls = async (pool: Pool): Promise<PbxCallRecord[]> => {
  await closeOrphanedPbxCalls(pool);

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT *
     FROM pbx_call_logs
     WHERE direction = 'inbound' AND status = 'ringing'
     ORDER BY started_at DESC, id DESC
     LIMIT 10`,
  );
  return rows.map(mapCallRow);
};

export const PBX_BUSINESS_TIMEZONE = 'America/New_York';
export const PBX_BUSINESS_START_HOUR = 8;
export const PBX_BUSINESS_END_HOUR = 17;

const getTimeZoneParts = (date: Date, timeZone = PBX_BUSINESS_TIMEZONE) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  const rawHour = Number(get('hour'));
  const hour = rawHour === 24 ? 0 : rawHour;
  return {
    dateStr: `${get('year')}-${get('month')}-${get('day')}`,
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    second: Number(get('second')),
  };
};

export const getPbxBusinessDate = (value: Date | string = new Date()): string =>
  getTimeZoneParts(typeof value === 'string' ? new Date(value) : value).dateStr;

export const isDuringPbxBusinessHours = (value: Date | string): boolean => {
  const { hour } = getTimeZoneParts(typeof value === 'string' ? new Date(value) : value);
  return hour >= PBX_BUSINESS_START_HOUR && hour < PBX_BUSINESS_END_HOUR;
};

const tzOffsetMinutesAt = (utcMs: number): number => {
  const p = getTimeZoneParts(new Date(utcMs));
  const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((localAsUtc - utcMs) / 60000);
};

export const getUtcRangeForPbxDate = (dateStr: string): { startUtc: string; endUtc: string } => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const startGuess = Date.UTC(y, m - 1, d, 5, 0, 0);
  const startUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0) - tzOffsetMinutesAt(startGuess) * 60000;
  const endGuess = Date.UTC(y, m - 1, d + 1, 5, 0, 0);
  const endUtcMs = Date.UTC(y, m - 1, d + 1, 0, 0, 0) - tzOffsetMinutesAt(endGuess) * 60000;
  return {
    startUtc: new Date(startUtcMs).toISOString().slice(0, 19).replace('T', ' '),
    endUtc: new Date(endUtcMs).toISOString().slice(0, 19).replace('T', ' '),
  };
};

const shiftPbxDate = (dateStr: string, deltaDays: number): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
};

const summarizeCallRows = (rows: RowDataPacket[]): PbxCallSummary => {
  let total = 0;
  let inbound = 0;
  let outbound = 0;
  let internal = 0;
  let missed = 0;
  let answered = 0;
  let businessHoursCalls = 0;
  let businessHoursAnswered = 0;
  let businessHoursMissed = 0;
  let afterHoursCalls = 0;
  let totalBillsecSeconds = 0;

  for (const row of rows) {
    total += 1;
    const dir = String(row.direction || 'inbound');
    const st = String(row.status || 'ringing');
    if (dir === 'inbound') inbound += 1;
    else if (dir === 'outbound') outbound += 1;
    else internal += 1;

    const isAnswered = st === 'answered' || st === 'ended';
    const isMissed = st === 'missed';
    if (isAnswered) {
      answered += 1;
      totalBillsecSeconds += Math.max(0, Number(row.billsec_seconds || row.duration_seconds || 0));
    } else if (isMissed) {
      missed += 1;
    }

    const inHours = row.started_at ? isDuringPbxBusinessHours(new Date(row.started_at)) : false;
    if (inHours) {
      businessHoursCalls += 1;
      if (isAnswered) businessHoursAnswered += 1;
      else if (isMissed) businessHoursMissed += 1;
    } else {
      afterHoursCalls += 1;
    }
  }

  return {
    total,
    inbound,
    outbound,
    internal,
    missed,
    answered,
    businessHoursCalls,
    businessHoursAnswered,
    businessHoursMissed,
    afterHoursCalls,
    totalBillsecSeconds,
    avgBillsecSeconds: answered > 0 ? Math.round(totalBillsecSeconds / answered) : 0,
  };
};

const loadPbxExtensionDirectory = async (
  pool: Pool,
): Promise<{ byExt: Record<string, { userId: number; name: string }>; namesByExt: Record<string, string> }> => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, name, pbx_extension FROM users WHERE deleted_at IS NULL AND pbx_extension IS NOT NULL AND TRIM(pbx_extension) <> ''",
    );
    const byExt: Record<string, { userId: number; name: string }> = {};
    const namesByExt: Record<string, string> = {};
    for (const r of rows) {
      const ext = String(r.pbx_extension || '').trim();
      const name = String(r.name || '').trim();
      if (!ext || !name) continue;
      byExt[ext] = { userId: Number(r.id), name };
      namesByExt[ext] = name;
    }
    return { byExt, namesByExt };
  } catch {
    return { byExt: {}, namesByExt: {} };
  }
};

export const listPbxCallLogs = async (
  pool: Pool,
  filters: { direction?: string; status?: string; search?: string; date?: string; limit?: number } = {},
): Promise<{ calls: PbxCallRecord[]; summary: PbxCallSummary; date: string; extensionUsers: Record<string, string> }> => {
  const limit = Math.min(200, Math.max(1, Number(filters.limit || 100)));
  const rawDate = (filters.date || '').trim();
  const targetDate = rawDate === 'all' ? 'all' : /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : getPbxBusinessDate();

  const where: string[] = [];
  const params: Array<string | number> = [];

  const dateWhere: string[] = [];
  const dateParams: Array<string | number> = [];
  if (targetDate !== 'all') {
    const { startUtc, endUtc } = getUtcRangeForPbxDate(targetDate);
    where.push('started_at >= ? AND started_at < ?');
    params.push(startUtc, endUtc);
    dateWhere.push('started_at >= ? AND started_at < ?');
    dateParams.push(startUtc, endUtc);
  }

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

  const dateWhereSql = dateWhere.length ? `WHERE ${dateWhere.join(' AND ')}` : '';
  const [summaryRows] = await pool.query<RowDataPacket[]>(
    `SELECT direction, status, billsec_seconds, duration_seconds, started_at
     FROM pbx_call_logs ${dateWhereSql}`,
    dateParams,
  );

  const { namesByExt } = await loadPbxExtensionDirectory(pool);

  return {
    calls: rows.map(mapCallRow),
    summary: summarizeCallRows(summaryRows),
    date: targetDate,
    extensionUsers: namesByExt,
  };
};

export const savePbxDailySummary = async (
  pool: Pool,
  dateStr: string,
): Promise<PbxDailyAnalyticsRow> => {
  const { startUtc, endUtc } = getUtcRangeForPbxDate(dateStr);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT direction, status, billsec_seconds, duration_seconds, started_at
     FROM pbx_call_logs
     WHERE started_at >= ? AND started_at < ?`,
    [startUtc, endUtc],
  );
  const s = summarizeCallRows(rows);

  await pool.execute(
    `INSERT INTO pbx_daily_summaries (
      summary_date, total_calls, inbound_calls, outbound_calls, internal_calls,
      answered_calls, missed_calls, business_hours_calls, business_hours_answered,
      business_hours_missed, after_hours_calls, total_billsec_seconds, avg_billsec_seconds, closed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())
    ON DUPLICATE KEY UPDATE
      total_calls = VALUES(total_calls),
      inbound_calls = VALUES(inbound_calls),
      outbound_calls = VALUES(outbound_calls),
      internal_calls = VALUES(internal_calls),
      answered_calls = VALUES(answered_calls),
      missed_calls = VALUES(missed_calls),
      business_hours_calls = VALUES(business_hours_calls),
      business_hours_answered = VALUES(business_hours_answered),
      business_hours_missed = VALUES(business_hours_missed),
      after_hours_calls = VALUES(after_hours_calls),
      total_billsec_seconds = VALUES(total_billsec_seconds),
      avg_billsec_seconds = VALUES(avg_billsec_seconds),
      closed_at = UTC_TIMESTAMP()`,
    [
      dateStr,
      s.total,
      s.inbound,
      s.outbound,
      s.internal,
      s.answered,
      s.missed,
      s.businessHoursCalls,
      s.businessHoursAnswered,
      s.businessHoursMissed,
      s.afterHoursCalls,
      s.totalBillsecSeconds,
      s.avgBillsecSeconds,
    ],
  );

  return {
    date: dateStr,
    totalCalls: s.total,
    inboundCalls: s.inbound,
    outboundCalls: s.outbound,
    internalCalls: s.internal,
    answeredCalls: s.answered,
    missedCalls: s.missed,
    answerRate: s.total > 0 ? Math.round((s.answered / s.total) * 100) : 0,
    businessHoursCalls: s.businessHoursCalls,
    businessHoursAnswered: s.businessHoursAnswered,
    businessHoursMissed: s.businessHoursMissed,
    afterHoursCalls: s.afterHoursCalls,
    totalBillsecSeconds: s.totalBillsecSeconds,
    avgBillsecSeconds: s.avgBillsecSeconds,
    isClosed: true,
  };
};

export const listPbxDailyAnalytics = async (
  pool: Pool,
  days = 30,
  startDateParam?: string,
  endDateParam?: string,
): Promise<{
  today: string;
  startDate: string;
  endDate: string;
  businessHours: { start: string; end: string; timeZone: string };
  days: PbxDailyAnalyticsRow[];
  employeePerformance: PbxEmployeeCallPerformance[];
}> => {
  const today = getPbxBusinessDate();
  const isYmd = (s?: string): s is string => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
  let startDate: string;
  let endDate: string;
  if (isYmd(startDateParam) && isYmd(endDateParam) && startDateParam <= endDateParam) {
    startDate = startDateParam;
    endDate = endDateParam > today ? today : endDateParam;
    if (startDate > endDate) startDate = endDate;
  } else {
    const safeDays = Math.min(90, Math.max(1, Math.round(days || 30)));
    endDate = today;
    startDate = shiftPbxDate(today, -(safeDays - 1));
  }

  // Ensure any past days with calls that haven't been closed yet are persisted
  const pastEndBoundary = endDate < today ? shiftPbxDate(endDate, 1) : today;
  const [savedRows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM pbx_daily_summaries WHERE summary_date >= ? AND summary_date < ? ORDER BY summary_date DESC`,
    [startDate, pastEndBoundary],
  );
  const byDate = new Map<string, PbxDailyAnalyticsRow>();
  for (const r of savedRows) {
    const dateKey = r.summary_date instanceof Date
      ? r.summary_date.toISOString().slice(0, 10)
      : String(r.summary_date).slice(0, 10);
    const totalCalls = Number(r.total_calls || 0);
    const answeredCalls = Number(r.answered_calls || 0);
    byDate.set(dateKey, {
      date: dateKey,
      totalCalls,
      inboundCalls: Number(r.inbound_calls || 0),
      outboundCalls: Number(r.outbound_calls || 0),
      internalCalls: Number(r.internal_calls || 0),
      answeredCalls,
      missedCalls: Number(r.missed_calls || 0),
      answerRate: totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0,
      businessHoursCalls: Number(r.business_hours_calls || 0),
      businessHoursAnswered: Number(r.business_hours_answered || 0),
      businessHoursMissed: Number(r.business_hours_missed || 0),
      afterHoursCalls: Number(r.after_hours_calls || 0),
      totalBillsecSeconds: Number(r.total_billsec_seconds || 0),
      avgBillsecSeconds: Number(r.avg_billsec_seconds || 0),
      isClosed: true,
    });
  }

  // Backfill any past day in range that has calls in pbx_call_logs but wasn't saved yet
  const { startUtc: rangeStartUtc } = getUtcRangeForPbxDate(startDate);
  const { startUtc: pastEndUtc } = getUtcRangeForPbxDate(pastEndBoundary);
  const [pastRawRows] = await pool.query<RowDataPacket[]>(
    `SELECT started_at FROM pbx_call_logs WHERE started_at >= ? AND started_at < ?`,
    [rangeStartUtc, pastEndUtc],
  );
  const missingDates = new Set<string>();
  for (const r of pastRawRows) {
    if (!r.started_at) continue;
    const d = getPbxBusinessDate(new Date(r.started_at));
    if (d < today && d >= startDate && d <= endDate && !byDate.has(d)) missingDates.add(d);
  }
  for (const missing of missingDates) {
    const saved = await savePbxDailySummary(pool, missing);
    byDate.set(missing, saved);
  }

  // Live summary for today (only if today is within [startDate, endDate])
  if (endDate >= today && startDate <= today) {
    const { startUtc: tStart, endUtc: tEnd } = getUtcRangeForPbxDate(today);
    const [todayRows] = await pool.query<RowDataPacket[]>(
      `SELECT direction, status, billsec_seconds, duration_seconds, started_at
       FROM pbx_call_logs WHERE started_at >= ? AND started_at < ?`,
      [tStart, tEnd],
    );
    const todaySum = summarizeCallRows(todayRows);
    byDate.set(today, {
      date: today,
      totalCalls: todaySum.total,
      inboundCalls: todaySum.inbound,
      outboundCalls: todaySum.outbound,
      internalCalls: todaySum.internal,
      answeredCalls: todaySum.answered,
      missedCalls: todaySum.missed,
      answerRate: todaySum.total > 0 ? Math.round((todaySum.answered / todaySum.total) * 100) : 0,
      businessHoursCalls: todaySum.businessHoursCalls,
      businessHoursAnswered: todaySum.businessHoursAnswered,
      businessHoursMissed: todaySum.businessHoursMissed,
      afterHoursCalls: todaySum.afterHoursCalls,
      totalBillsecSeconds: todaySum.totalBillsecSeconds,
      avgBillsecSeconds: todaySum.avgBillsecSeconds,
      isClosed: false,
    });
  }

  const { byExt } = await loadPbxExtensionDirectory(pool);
  const { endUtc: rangeEndUtc } = getUtcRangeForPbxDate(endDate);
  const [perfCallRows] = await pool.query<RowDataPacket[]>(
    `SELECT direction, status, caller_number, destination, answered_by_ext, rejected_by_exts,
            billsec_seconds, duration_seconds, started_at, answered_at
     FROM pbx_call_logs
     WHERE started_at >= ? AND started_at < ?`,
    [rangeStartUtc, rangeEndUtc],
  ).catch(() => [[] as RowDataPacket[]]);

  // Build full list of dates in the requested range (newest first)
  const rangeDates: string[] = [];
  let cursor = endDate;
  for (let i = 0; i < 90 && cursor >= startDate; i++) {
    rangeDates.push(cursor);
    cursor = shiftPbxDate(cursor, -1);
  }

  interface InternalPerfBucket {
    userId: number | null;
    userName: string;
    pbxExtension: string;
    receivedCount: number;
    answeredCount: number;
    missedCount: number;
    rejectedCount: number;
    outboundCount: number;
    outboundAnsweredCount: number;
    totalTalkSeconds: number;
    dailyMap: Map<string, {
      receivedCount: number;
      answeredCount: number;
      missedCount: number;
      rejectedCount: number;
      outboundCount: number;
      outboundAnsweredCount: number;
      totalTalkSeconds: number;
    }>;
  }

  const perfMap = new Map<string, InternalPerfBucket>();
  const createEmptyDay = () => ({
    receivedCount: 0,
    answeredCount: 0,
    missedCount: 0,
    rejectedCount: 0,
    outboundCount: 0,
    outboundAnsweredCount: 0,
    totalTalkSeconds: 0,
  });

  const ensurePerf = (ext: string): InternalPerfBucket => {
    const existing = perfMap.get(ext);
    if (existing) return existing;
    const dailyMap = new Map<string, ReturnType<typeof createEmptyDay>>();
    for (const d of rangeDates) {
      dailyMap.set(d, createEmptyDay());
    }
    const created: InternalPerfBucket = {
      userId: byExt[ext]?.userId ?? null,
      userName: byExt[ext]?.name || `Ext. ${ext}`,
      pbxExtension: ext,
      receivedCount: 0,
      answeredCount: 0,
      missedCount: 0,
      rejectedCount: 0,
      outboundCount: 0,
      outboundAnsweredCount: 0,
      totalTalkSeconds: 0,
      dailyMap,
    };
    perfMap.set(ext, created);
    return created;
  };

  for (const ext of Object.keys(byExt)) {
    ensurePerf(ext);
  }

  const ensureDay = (bucket: InternalPerfBucket, dateKey: string) => {
    let day = bucket.dailyMap.get(dateKey);
    if (!day) {
      day = createEmptyDay();
      bucket.dailyMap.set(dateKey, day);
    }
    return day;
  };

  const isExtensionToken = (val: string) => Boolean(val && (byExt[val] || /^\d{2,6}$/.test(val)));

  for (const row of perfCallRows) {
    if (!row.started_at) continue;
    const dateKey = getPbxBusinessDate(new Date(row.started_at));
    const direction = String(row.direction || 'inbound');
    const st = String(row.status || '');
    const callerExt = row.caller_number ? String(row.caller_number).trim() : '';
    const destExt = row.destination ? String(row.destination).trim() : '';
    const answeredExt = row.answered_by_ext ? String(row.answered_by_ext).trim() : '';
    const rejectedExts = parseRejectedExts(row.rejected_by_exts);
    const talkSeconds = Math.max(0, Number(row.billsec_seconds || row.duration_seconds || 0));

    if (direction === 'outbound') {
      const outExt = (callerExt && byExt[callerExt])
        ? callerExt
        : (answeredExt && byExt[answeredExt])
          ? answeredExt
          : isExtensionToken(callerExt)
            ? callerExt
            : isExtensionToken(answeredExt)
              ? answeredExt
              : '';
      if (outExt) {
        const p = ensurePerf(outExt);
        const day = ensureDay(p, dateKey);
        p.outboundCount += 1;
        day.outboundCount += 1;
        const wasAnswered = Boolean(row.answered_at) || Number(row.billsec_seconds || 0) > 0;
        if (wasAnswered) {
          p.outboundAnsweredCount += 1;
          day.outboundAnsweredCount += 1;
          p.totalTalkSeconds += talkSeconds;
          day.totalTalkSeconds += talkSeconds;
        }
      }
      continue;
    }

    // Inbound or internal call
    const involvedExts = new Set<string>();
    if (answeredExt && (st === 'answered' || st === 'ended')) {
      const p = ensurePerf(answeredExt);
      const day = ensureDay(p, dateKey);
      p.answeredCount += 1;
      day.answeredCount += 1;
      p.totalTalkSeconds += talkSeconds;
      day.totalTalkSeconds += talkSeconds;
      involvedExts.add(answeredExt);
    }

    for (const rej of rejectedExts) {
      const p = ensurePerf(rej);
      const day = ensureDay(p, dateKey);
      p.rejectedCount += 1;
      day.rejectedCount += 1;
      involvedExts.add(rej);
    }

    if (st === 'missed' && isExtensionToken(destExt) && !involvedExts.has(destExt)) {
      const p = ensurePerf(destExt);
      const day = ensureDay(p, dateKey);
      p.missedCount += 1;
      day.missedCount += 1;
      involvedExts.add(destExt);
    }

    for (const ext of involvedExts) {
      const p = ensurePerf(ext);
      const day = ensureDay(p, dateKey);
      p.receivedCount += 1;
      day.receivedCount += 1;
    }
  }

  const employeePerformance: PbxEmployeeCallPerformance[] = [...perfMap.values()]
    .map((p) => {
      const totalConversations = p.answeredCount + p.outboundAnsweredCount;
      const dailyBreakdown: PbxEmployeeDailyBreakdown[] = [...p.dailyMap.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, d]) => {
          const dayConvs = d.answeredCount + d.outboundAnsweredCount;
          return {
            date,
            receivedCount: d.receivedCount,
            answeredCount: d.answeredCount,
            missedCount: d.missedCount,
            rejectedCount: d.rejectedCount,
            outboundCount: d.outboundCount,
            outboundAnsweredCount: d.outboundAnsweredCount,
            answerRate: d.receivedCount > 0 ? Math.round((d.answeredCount / d.receivedCount) * 100) : 0,
            totalTalkSeconds: d.totalTalkSeconds,
            avgTalkSeconds: dayConvs > 0 ? Math.round(d.totalTalkSeconds / dayConvs) : 0,
          };
        });
      return {
        userId: p.userId,
        userName: p.userName,
        pbxExtension: p.pbxExtension,
        receivedCount: p.receivedCount,
        answeredCount: p.answeredCount,
        missedCount: p.missedCount,
        rejectedCount: p.rejectedCount,
        outboundCount: p.outboundCount,
        outboundAnsweredCount: p.outboundAnsweredCount,
        answerRate: p.receivedCount > 0 ? Math.round((p.answeredCount / p.receivedCount) * 100) : 0,
        totalTalkSeconds: p.totalTalkSeconds,
        avgTalkSeconds: totalConversations > 0 ? Math.round(p.totalTalkSeconds / totalConversations) : 0,
        dailyBreakdown,
      };
    })
    .sort((a, b) =>
      (b.answeredCount + b.outboundCount) - (a.answeredCount + a.outboundCount)
      || b.receivedCount - a.receivedCount
      || b.rejectedCount - a.rejectedCount
      || a.pbxExtension.localeCompare(b.pbxExtension),
    );

  const sorted = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  return {
    today,
    startDate,
    endDate,
    businessHours: { start: '08:00', end: '17:00', timeZone: PBX_BUSINESS_TIMEZONE },
    days: sorted,
    employeePerformance,
  };
};

export const recordPbxExtensionPresence = async (
  pool: Pool,
  extension: string,
  status: 'online' | 'offline',
  reason?: string | null,
  occurredAt = new Date(),
): Promise<boolean> => {
  const ext = extension.trim().slice(0, 16);
  if (!ext) return false;
  const [prevRows] = await pool.query<RowDataPacket[]>(
    'SELECT status FROM pbx_extension_presence_logs WHERE extension = ? ORDER BY occurred_at DESC, id DESC LIMIT 1',
    [ext],
  );
  if (prevRows.length && String(prevRows[0].status) === status) {
    return false;
  }
  await pool.execute(
    'INSERT INTO pbx_extension_presence_logs (extension, status, reason, occurred_at) VALUES (?, ?, ?, ?)',
    [ext, status, reason ? reason.trim().slice(0, 64) : null, toMysqlDatetime(occurredAt.toISOString(), occurredAt)],
  );
  return true;
};

export const getPbxExtensionsPresenceReport = async (
  pool: Pool,
  dateStr?: string,
  liveStatusMap: Record<string, 'online' | 'offline' | 'in_call'> = {},
  now = new Date(),
): Promise<{
  date: string;
  today: string;
  workdayStart: string;
  workdayEnd: string;
  extensions: PbxExtensionPresenceReportRow[];
}> => {
  const today = getPbxBusinessDate(now);
  const targetDate = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : today;
  const { startUtc, endUtc } = getUtcRangeForPbxDate(targetDate);
  const dayStartMs = Date.parse(`${startUtc.replace(' ', 'T')}Z`);
  const dayEndMs = Date.parse(`${endUtc.replace(' ', 'T')}Z`);
  const bhStartMs = dayStartMs + PBX_BUSINESS_START_HOUR * 3_600_000;
  const bhEndMs = dayStartMs + PBX_BUSINESS_END_HOUR * 3_600_000;
  const effectiveEndMs = targetDate === today ? Math.min(bhEndMs, now.getTime()) : bhEndMs;
  const workdayElapsedSeconds = effectiveEndMs > bhStartMs ? Math.round((effectiveEndMs - bhStartMs) / 1000) : 0;

  const { byExt } = await loadPbxExtensionDirectory(pool);
  const [dayLogRows] = await pool.query<RowDataPacket[]>(
    `SELECT extension, status, reason, occurred_at
     FROM pbx_extension_presence_logs
     WHERE occurred_at >= ? AND occurred_at < ?
     ORDER BY occurred_at ASC, id ASC`,
    [startUtc, endUtc],
  ).catch(() => [[] as RowDataPacket[]]);

  const [priorRows] = await pool.query<RowDataPacket[]>(
    `SELECT p.extension, p.status
     FROM pbx_extension_presence_logs p
     INNER JOIN (
       SELECT extension, MAX(id) AS max_id
       FROM pbx_extension_presence_logs
       WHERE occurred_at < ?
       GROUP BY extension
     ) latest ON latest.max_id = p.id`,
    [startUtc],
  ).catch(() => [[] as RowDataPacket[]]);

  const priorStatusByExt = new Map<string, 'online' | 'offline'>();
  for (const r of priorRows) {
    const ext = String(r.extension || '').trim();
    if (ext) priorStatusByExt.set(ext, r.status === 'online' ? 'online' : 'offline');
  }

  const eventsByExt = new Map<string, Array<{ status: 'online' | 'offline'; reason: string | null; ms: number; iso: string }>>();
  for (const r of dayLogRows) {
    const ext = String(r.extension || '').trim();
    if (!ext) continue;
    const dt = new Date(r.occurred_at);
    const ms = dt.getTime();
    if (!Number.isFinite(ms)) continue;
    const arr = eventsByExt.get(ext) || [];
    arr.push({
      status: r.status === 'online' ? 'online' : 'offline',
      reason: r.reason ? String(r.reason) : null,
      ms,
      iso: dt.toISOString(),
    });
    eventsByExt.set(ext, arr);
  }

  const allExts = new Set<string>([
    ...Object.keys(byExt),
    ...Object.keys(liveStatusMap),
    ...eventsByExt.keys(),
  ]);

  const rows: PbxExtensionPresenceReportRow[] = [];
  for (const ext of allExts) {
    const evs = eventsByExt.get(ext) || [];
    const liveStatus: PbxExtensionPresenceReportRow['liveStatus'] =
      targetDate === today && liveStatusMap[ext]
        ? liveStatusMap[ext]
        : (evs.length ? evs[evs.length - 1].status : (priorStatusByExt.get(ext) || 'unknown'));

    // Calculate connected seconds during [bhStartMs, effectiveEndMs]
    let connectedMs = 0;
    if (effectiveEndMs > bhStartMs) {
      let curStatus: 'online' | 'offline' = priorStatusByExt.get(ext) || 'offline';
      let cursor = dayStartMs;

      const addSpan = (fromMs: number, toMs: number, st: 'online' | 'offline') => {
        if (st !== 'online') return;
        const overlapStart = Math.max(fromMs, bhStartMs);
        const overlapEnd = Math.min(toMs, effectiveEndMs);
        if (overlapEnd > overlapStart) connectedMs += overlapEnd - overlapStart;
      };

      for (const ev of evs) {
        addSpan(cursor, ev.ms, curStatus);
        curStatus = ev.status;
        cursor = ev.ms;
      }
      const tailEnd = targetDate === today ? Math.min(dayEndMs, now.getTime()) : dayEndMs;
      addSpan(cursor, tailEnd, curStatus);
    }

    const connectedWorkdaySeconds = Math.round(connectedMs / 1000);
    const availabilityPct = workdayElapsedSeconds > 0
      ? Math.min(100, Math.round((connectedWorkdaySeconds / workdayElapsedSeconds) * 100))
      : 0;
    const firstOnline = evs.find((e) => e.status === 'online');
    const lastOffline = [...evs].reverse().find((e) => e.status === 'offline');

    rows.push({
      extension: ext,
      userId: byExt[ext]?.userId ?? null,
      userName: byExt[ext]?.name || `Ext. ${ext}`,
      liveStatus,
      firstConnectedAt: firstOnline ? firstOnline.iso : null,
      lastDisconnectedAt: lastOffline ? lastOffline.iso : null,
      connectedWorkdaySeconds,
      workdayElapsedSeconds,
      availabilityPct,
      events: evs.map((e) => ({ status: e.status, reason: e.reason, occurredAt: e.iso })),
    });
  }

  rows.sort((a, b) => {
    const aAssigned = a.userId !== null ? 0 : 1;
    const bAssigned = b.userId !== null ? 0 : 1;
    if (aAssigned !== bAssigned) return aAssigned - bAssigned;
    return a.extension.localeCompare(b.extension, undefined, { numeric: true });
  });

  return {
    date: targetDate,
    today,
    workdayStart: '07:00',
    workdayEnd: '18:00',
    extensions: rows,
  };
};

export const startPbxDailyRolloverScheduler = (pool: Pool): { stop: () => void } => {
  let lastCheckedBusinessDate = getPbxBusinessDate();

  const runRolloverCheck = async () => {
    try {
      const currentDate = getPbxBusinessDate();
      const yesterday = shiftPbxDate(currentDate, -1);
      if (currentDate !== lastCheckedBusinessDate) {
        lastCheckedBusinessDate = currentDate;
      }
      const [existing] = await pool.query<RowDataPacket[]>(
        'SELECT summary_date FROM pbx_daily_summaries WHERE summary_date = ? LIMIT 1',
        [yesterday],
      );
      if (!existing.length) {
        await savePbxDailySummary(pool, yesterday);
        console.log(`[PBX Daily] Cierre automático guardado para ${yesterday}`);
      }
    } catch (err) {
      console.error('[PBX Daily] Error en cierre automático diario:', err);
    }
  };

  void runRolloverCheck();
  const timer = setInterval(() => {
    void runRolloverCheck();
  }, 60_000);
  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
  };
};
