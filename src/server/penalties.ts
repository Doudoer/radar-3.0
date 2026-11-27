import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  PENALTY_PERCENT_PER_UNIT,
  payPeriodFor,
  latestCutoff,
  localDateKey,
  postDeliveryAccrual,
  readyPieceAccrual,
  summarizePenalties,
  type PenaltyPause,
} from '../utils/penalties';
import { ACK_NOTIFICATION_CUTOFF, POST_DELIVERY_FOLLOWUP_CUTOFF } from '../utils/orderWorkflow';
import { isYardEmployee, settleEmployeeCompensation, type EmployeeCommissionsSummary, type EmployeeSettlementSummary } from '../utils/commissions';
import { getUserCommissionsSummary, getUserCarryoverDebt, saveUserCarryoverDebt } from './commissions';
import { isDuringPbxBusinessHours, parseRejectedExts } from './pbxCalls';

const LOOKBACK_DAYS = 90;
const OPEN_CLAIM_STATUSES = ['Pending', 'In Process'];

export interface PenaltySettings {
  enabled: boolean;
  enabledSince: string | null;
  accrualSince: string | null;
  updatedAt: string | null;
  updatedBy: number | null;
}

export interface PenaltySourceSummary {
  source: 'post_delivery' | 'ready_piece' | 'ack_notification' | 'claim' | 'call_missed' | 'call_rejected';
  units: number;
  percent: number;
  amount: number;
}

export interface PenaltyOrderLine extends PenaltySourceSummary {
  orderId: number;
  orderCode: string;
  customerName: string;
  date: string | null;
  nextDueDate: string | null;
}

export interface PenaltyHistoryEntry {
  periodEnd: string;
  units: number;
  percent: number;
  amount: number;
  cutAt: string;
  status: string;
}

export interface UserPenaltySnapshot {
  userId: number;
  weeklySalary: number | null;
  rate: number;
  enabled: boolean;
  period: { start: string; end: string; label: string; cutoffLabel: string };
  open: { units: number; percent: number; amount: number; lines: PenaltySourceSummary[] };
  details: PenaltyOrderLine[];
  history: PenaltyHistoryEntry[];
  commissions?: EmployeeCommissionsSummary;
  carryoverDebt?: { totalDebt: number; lastPeriodEnd: string | null };
  settlement?: EmployeeSettlementSummary;
}

const toSqlDate = (date: Date) => date.toISOString().slice(0, 19).replace('T', ' ');

const parseDate = (value: unknown): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const parseWorkflowData = (value: unknown): Record<string, unknown> => {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
};

const customerName = (row: RowDataPacket) =>
  [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || 'Cliente';

const salaryForRow = (row: RowDataPacket): number | null =>
  row.weekly_salary === null || row.weekly_salary === undefined ? null : Number(row.weekly_salary);

const lookbackStart = (now: Date): Date =>
  new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);

export const readPenaltySettings = async (pool: Pool): Promise<PenaltySettings> => {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT setting_key, setting_value, updated_at, updated_by FROM app_settings WHERE setting_key IN (?, ?, ?)',
    ['penalties.enabled', 'penalties.enabled_since', 'penalties.accrual_since'],
  );
  const map = new Map(rows.map(row => [String(row.setting_key), row]));
  const enabled = String(map.get('penalties.enabled')?.setting_value ?? '1') === '1';
  return {
    enabled,
    enabledSince: parseDate(map.get('penalties.enabled_since')?.setting_value),
    accrualSince: parseDate(map.get('penalties.accrual_since')?.setting_value),
    updatedAt: parseDate(map.get('penalties.enabled')?.updated_at),
    updatedBy: map.get('penalties.enabled')?.updated_by ? Number(map.get('penalties.enabled').updated_by) : null,
  };
};

export const writePenaltySettings = async (pool: Pool, enabled: boolean, userId: number, now = new Date()) => {
  const current = await readPenaltySettings(pool);
  if (current.enabled === enabled) return current;
  await pool.execute(
    "INSERT INTO app_settings (setting_key, setting_value, updated_by) VALUES ('penalties.enabled', ?, ?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value), updated_by=VALUES(updated_by)",
    [enabled ? '1' : '0', userId],
  );
  if (enabled) {
    const since = now.toISOString().slice(0, 19).replace('T', ' ');
    await pool.execute(
      "INSERT INTO app_settings (setting_key, setting_value, updated_by) VALUES ('penalties.enabled_since', ?, ?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value), updated_by=VALUES(updated_by)",
      [since, userId],
    );
  }
  return readPenaltySettings(pool);
};

const ensureAccrualSince = async (pool: Pool, settings: PenaltySettings, now: Date): Promise<string> => {
  if (settings.accrualSince) return settings.accrualSince;
  const since = now.toISOString().slice(0, 19).replace('T', ' ');
  await pool.execute(
    "INSERT INTO app_settings (setting_key, setting_value) VALUES ('penalties.accrual_since', ?) ON DUPLICATE KEY UPDATE setting_value=setting_value",
    [since],
  );
  return new Date(`${since.replace(' ', 'T')}Z`).toISOString();
};

const evidencePauses = async (pool: Pool, now: Date): Promise<Map<string, PenaltyPause[]>> => {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT order_id, task, status, created_at, reviewed_at FROM followup_evidence
      WHERE created_at >= ? AND (status = 'pending' OR reviewed_at IS NOT NULL)`,
    [toSqlDate(lookbackStart(now))],
  );
  const pauses = new Map<string, PenaltyPause[]>();
  const sourceForTask = (task: string) =>
    task.startsWith('post_') ? 'post_delivery' : task === 'ready_piece' ? 'ready_piece' : task === 'claim' ? 'claim' : null;
  for (const row of rows) {
    const source = sourceForTask(String(row.task));
    if (!source || row.status === 'approved') continue;
    const from = parseDate(row.created_at);
    if (!from) continue;
    const key = `${Number(row.order_id)}:${source}`;
    const list = pauses.get(key) || [];
    list.push({ from, to: row.status === 'rejected' ? parseDate(row.reviewed_at) : null });
    pauses.set(key, list);
  }
  return pauses;
};

const userRows = async (pool: Pool) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, name, weekly_salary FROM users WHERE deleted_at IS NULL',
  );
  return new Map(rows.map(row => [Number(row.id), row]));
};

const dueDateFor = (row: RowDataPacket, source: string, milestone: number) => {
  const base = parseDate(source === 'claim' ? row.claim_piece_ready_at : row.yard_piece_ready_at);
  if (!base) return null;
  if (source === 'post_delivery') {
    const date = new Date(base);
    date.setUTCDate(date.getUTCDate() + milestone);
    return date.toISOString();
  }
  return new Date(new Date(base).getTime() + 86_400_000).toISOString();
};

interface AccrualCase {
  orderId: number;
  orderCode: string;
  customerName: string;
  source: PenaltySourceSummary['source'];
  referenceKey: string;
  units: number;
  userId: number;
  date: string | null;
  nextDueDate: string | null;
}

/**
 * Internal and exempt numbers that must NEVER generate call penalties.
 * Specifically includes internal extension numbers, short extension codes,
 * and test/internal lines: 169014 and 9844004618.
 */
export const isExemptFromCallPenalties = (
  callerNumber: string | null | undefined,
  callerName?: string | null,
  direction?: string | null,
  userExtensions?: Set<string>,
): boolean => {
  if (direction === 'internal' || direction === 'outbound') return true;

  const raw = String(callerNumber || '').trim();
  const rawName = String(callerName || '').trim();
  if (!raw && !rawName) return true;

  const digits = raw.replace(/\D/g, '');
  const digitsName = rawName.replace(/\D/g, '');

  // 1. Direct checks for internal lines / test numbers: 169014 and 9844004618
  if (raw === '169014' || rawName.includes('169014') || digits === '169014' || digitsName.includes('169014')) {
    return true;
  }
  if (digits.endsWith('9844004618') || digitsName.endsWith('9844004618')) {
    return true;
  }

  // 2. Known user PBX extensions (e.g. 201, 202, 204, 501)
  if (userExtensions) {
    if (userExtensions.has(raw)) return true;
    if (digits.length <= 4 && userExtensions.has(digits)) return true;
  }

  // 3. Any internal extension format (<= 4 digits)
  if (digits.length >= 2 && digits.length <= 4) {
    return true;
  }

  return false;
};

/**
 * Removes and cleans up any existing penalties in order_penalties generated by
 * exempt or internal numbers (169014, 9844004618, internal extensions).
 */
export const cleanExemptCallPenalties = async (pool: Pool): Promise<number> => {
  try {
    const [result] = await pool.execute<ResultSetHeader>(
      `DELETE FROM order_penalties
        WHERE source IN ('call_missed', 'call_rejected')
          AND (
            reference_key LIKE '%169014%'
            OR reference_key LIKE '%9844004618%'
            OR SUBSTRING_INDEX(SUBSTRING_INDEX(reference_key, '-', 2), '-', -1) IN (
              SELECT CAST(id AS CHAR) FROM pbx_call_logs
               WHERE caller_number LIKE '%169014%'
                  OR caller_number LIKE '%9844004618%'
                  OR caller_name LIKE '%169014%'
                  OR caller_name LIKE '%9844004618%'
                  OR direction = 'internal'
                  OR CHAR_LENGTH(caller_number) <= 4
            )
          )`,
    );
    return result.affectedRows || 0;
  } catch (err) {
    console.warn('[Penalties] Failed to delete exempt call penalties:', err);
    return 0;
  }
};

export const syncPenalties = async (pool: Pool, now = new Date()): Promise<void> => {
  const settings = await readPenaltySettings(pool);
  const cutoff = latestCutoff(now);
  await pool.execute(
    "UPDATE order_penalties SET status='liquidated', liquidated_at=period_end WHERE status='pending' AND period_end <= ?",
    [toSqlDate(cutoff)],
  );
  if (!settings.enabled) return;

  const accrualSince = await ensureAccrualSince(pool, settings, now);
  const accrualStart = new Date(accrualSince);
  const period = payPeriodFor(now);
  const periodStart = new Date(period.start);
  const periodEnd = new Date(period.end);
  const pauses = await evidencePauses(pool, now);
  const users = await userRows(pool);
  const cases: AccrualCase[] = [];
  const since = lookbackStart(now);

  const [postRows] = await pool.query<RowDataPacket[]>(
    `SELECT o.id AS order_id, o.order_code, o.user_id, o.delivered_at, o.followup_closed_at,
            f.advisor_id AS followup_user_id, c.first_name, c.last_name
       FROM orders o
       LEFT JOIN order_followup_assignments f ON f.order_id=o.id
       LEFT JOIN customers c ON c.id=o.customer_id
      WHERE o.deleted_at IS NULL AND LOWER(TRIM(o.status))='entregado'
        AND o.delivered_at IS NOT NULL AND o.delivered_at > ? AND o.delivered_at >= ?
        AND o.followup_closed_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM order_workflow_events e WHERE e.order_id=o.id AND e.task='post_14' AND e.outcome='completed')
        AND NOT EXISTS (SELECT 1 FROM order_workflow_events e WHERE e.order_id=o.id AND e.task='post_3' AND e.part_status='installed_ok' AND e.outcome='completed')`,
    [toSqlDate(new Date(POST_DELIVERY_FOLLOWUP_CUTOFF)), toSqlDate(since)],
  );
  for (const row of postRows) {
    const userId = Number(row.followup_user_id || row.user_id || 0);
    if (!userId) continue;
    const deliveredAt = parseDate(row.delivered_at);
    if (!deliveredAt) continue;
    const start = new Date(deliveredAt).getTime() > accrualStart.getTime() ? deliveredAt : accrualStart.toISOString();
    const accrual = postDeliveryAccrual({
      deliveredAt: start,
      asOf: now,
      closedAt: parseDate(row.followup_closed_at),
      paused: pauses.get(`${Number(row.order_id)}:post_delivery`),
    });
    if (!accrual.totalUnits) continue;
    const delivered = new Date(deliveredAt);
    for (const milestone of [3, 7, 14] as const) {
      const units = milestone === 3 ? accrual.day3 : milestone === 7 ? accrual.day7 : accrual.day14Daily + accrual.day14OneTime;
      if (!units) continue;
      cases.push({
        orderId: Number(row.order_id),
        orderCode: String(row.order_code || ''),
        customerName: customerName(row),
        source: 'post_delivery',
        referenceKey: `post_${milestone}`,
        units,
        userId,
        date: deliveredAt,
        nextDueDate: dueDateFor({ ...row, delivered_at: deliveredAt }, 'post_delivery', milestone),
      });
    }
  }

  const [readyRows] = await pool.query<RowDataPacket[]>(
    `SELECT o.id AS order_id, o.order_code, o.user_id, o.yard_piece_ready_at, o.yard_piece_ready_ack_at,
            o.followup_closed_at, f.advisor_id AS followup_user_id, c.first_name, c.last_name
       FROM orders o
       LEFT JOIN order_followup_assignments f ON f.order_id=o.id
       LEFT JOIN customers c ON c.id=o.customer_id
      WHERE o.deleted_at IS NULL AND o.yard_piece_ready=1 AND o.yard_piece_ready_at IS NOT NULL
        AND o.yard_piece_ready_ack_at IS NULL AND o.followup_closed_at IS NULL
        AND LOWER(TRIM(o.status)) IN ('pagado','en preparación','en preparacion')
        AND o.yard_piece_ready_at >= ?
        AND NOT EXISTS (SELECT 1 FROM order_workflow_events e WHERE e.order_id=o.id AND e.task='prepare' AND e.outcome='completed')`,
    [toSqlDate(since)],
  );
  for (const row of readyRows) {
    const userId = Number(row.followup_user_id || row.user_id || 0);
    if (!userId) continue;
    const readyAt = parseDate(row.yard_piece_ready_at);
    if (!readyAt) continue;
    const start = new Date(readyAt).getTime() > accrualStart.getTime() ? readyAt : accrualStart.toISOString();
    const units = readyPieceAccrual({
      startedAt: start,
      asOf: now,
      closedAt: parseDate(row.followup_closed_at) || parseDate(row.yard_piece_ready_ack_at),
      paused: pauses.get(`${Number(row.order_id)}:ready_piece`),
    });
    if (!units) continue;
    cases.push({
      orderId: Number(row.order_id),
      orderCode: String(row.order_code || ''),
      customerName: customerName(row),
      source: 'ready_piece',
      referenceKey: `ready_piece-${localDateKey(new Date(readyAt))}`,
      units,
      userId,
      date: readyAt,
      nextDueDate: dueDateFor(row, 'ready_piece', 1),
    });
  }

  const [ackRows] = await pool.query<RowDataPacket[]>(
    `SELECT o.id AS order_id, o.order_code, o.user_id, o.created_at, o.downpayment_verified_at,
            o.followup_closed_at, f.advisor_id AS followup_user_id, c.first_name, c.last_name
       FROM orders o
       LEFT JOIN order_followup_assignments f ON f.order_id=o.id
       LEFT JOIN customers c ON c.id=o.customer_id
       LEFT JOIN order_confirmation_rollout r ON r.order_id=o.id
      WHERE o.deleted_at IS NULL
        AND o.created_at >= ?
        AND o.followup_closed_at IS NULL
        AND COALESCE(r.confirmation_policy, 'documented') <> 'preapproved'
        AND (o.downpayment_verified = 1 OR LOWER(TRIM(o.status)) IN ('pagado', 'espera de confirmación', 'espera de confirmacion'))
        AND NOT EXISTS (
          SELECT 1 FROM order_workflow_events e
           WHERE e.order_id=o.id AND e.task='ack' AND e.outcome='completed' AND e.evidence LIKE '%ack-notification-v1%'
        )`,
    [toSqlDate(new Date(ACK_NOTIFICATION_CUTOFF))],
  );
  for (const row of ackRows) {
    const userId = Number(row.followup_user_id || row.user_id || 0);
    if (!userId) continue;
    const paidAt = parseDate(row.downpayment_verified_at) || parseDate(row.created_at);
    if (!paidAt) continue;
    const start = new Date(paidAt).getTime() > accrualStart.getTime() ? paidAt : accrualStart.toISOString();
    const units = readyPieceAccrual({
      startedAt: start,
      asOf: now,
      closedAt: parseDate(row.followup_closed_at),
      paused: pauses.get(`${Number(row.order_id)}:ack_notification`),
      graceHours: 24,
    });
    if (!units) continue;
    cases.push({
      orderId: Number(row.order_id),
      orderCode: String(row.order_code || ''),
      customerName: customerName(row),
      source: 'ack_notification',
      referenceKey: `ack_notification-${localDateKey(new Date(paidAt))}`,
      units,
      userId,
      date: paidAt,
      nextDueDate: null,
    });
  }

  const [claimRows] = await pool.query<RowDataPacket[]>(
    `SELECT cl.id AS claim_id, cl.assigned_user_id, cl.resolved_at,
            o.id AS order_id, o.order_code, o.user_id, o.workflow_data, o.followup_closed_at,
            c.first_name, c.last_name
       FROM claims cl
       JOIN orders o ON o.id=cl.order_id
       LEFT JOIN customers c ON c.id=o.customer_id
      WHERE cl.deleted_at IS NULL AND cl.status IN (?)
        AND o.deleted_at IS NULL AND LOWER(TRIM(o.status))='reclamo'
        AND o.workflow_data IS NOT NULL`,
    [OPEN_CLAIM_STATUSES],
  );
  for (const row of claimRows) {
    const data = parseWorkflowData(row.workflow_data);
    if (data.claimPieceReady !== true) continue;
    const readyAt = parseDate(data.claimPieceReadyAt);
    if (!readyAt) continue;
    const userId = Number(row.assigned_user_id || row.user_id || 0);
    if (!userId) continue;
    const start = new Date(readyAt).getTime() > accrualStart.getTime() ? readyAt : accrualStart.toISOString();
    const units = readyPieceAccrual({
      startedAt: start,
      asOf: now,
      closedAt: parseDate(row.followup_closed_at) || parseDate(row.resolved_at),
      paused: pauses.get(`${Number(row.order_id)}:claim`),
    });
    if (!units) continue;
    cases.push({
      orderId: Number(row.order_id),
      orderCode: String(row.order_code || ''),
      customerName: customerName(row),
      source: 'claim',
      referenceKey: `claim-${Number(row.claim_id)}-${localDateKey(new Date(readyAt))}`,
      units,
      userId,
      date: readyAt,
      nextDueDate: dueDateFor({ ...row, claim_piece_ready_at: readyAt }, 'claim', 1),
    });
  }

  // --- PBX Inbound Call Penalties (Missed & Rejected - Business Hours Only) ---
  try {
    // First, remove any historical penalties from exempt numbers
    await cleanExemptCallPenalties(pool);

    const callScanStart = accrualStart.getTime() > periodStart.getTime() ? accrualStart : periodStart;

    const [callRows] = await pool.query<RowDataPacket[]>(
      `SELECT id, caller_number, caller_name, direction, destination, answered_by_ext, rejected_by_exts,
              status, started_at
         FROM pbx_call_logs
        WHERE direction = 'inbound' AND started_at >= ? AND started_at <= ?`,
      [toSqlDate(callScanStart), toSqlDate(now)],
    );

    const [extUserRows] = await pool.query<RowDataPacket[]>(
      `SELECT id, pbx_extension, role FROM users
        WHERE deleted_at IS NULL AND pbx_extension IS NOT NULL AND pbx_extension <> ''`,
    );
    const userByExt = new Map<string, number>();
    const allKnownExtensions = new Set<string>();
    const callCenterAdvisors: number[] = [];
    for (const ur of extUserRows) {
      const ext = String(ur.pbx_extension).trim();
      const uId = Number(ur.id);
      userByExt.set(ext, uId);
      allKnownExtensions.add(ext);
      if (ext !== '501' && !isYardEmployee(ur.role)) {
        callCenterAdvisors.push(uId);
      }
    }

    for (const call of callRows) {
      if (!call.started_at) continue;
      const callDate = new Date(call.started_at);
      // Strict rule: Penalties apply ONLY within business hours. Outside business hours = 0 penalty.
      if (!isDuringPbxBusinessHours(callDate)) continue;

      // Strict rule: Calls from internal numbers, 169014, and 9844004618 never generate penalties
      if (isExemptFromCallPenalties(call.caller_number, call.caller_name, call.direction, allKnownExtensions)) {
        continue;
      }

      const callId = Number(call.id);
      const callerNum = String(call.caller_number || call.caller_name || 'Desconocido');
      const callDateIso = callDate.toISOString();

      // 1. Calls rejected / hung up while ringing
      const rejectedExts = parseRejectedExts(call.rejected_by_exts);
      for (const rejExt of rejectedExts) {
        if (rejExt === '501') continue;
        const targetUserId = userByExt.get(rejExt);
        if (targetUserId) {
          cases.push({
            orderId: 0,
            orderCode: `CALL-${callId}`,
            customerName: `Llamada colgada (${rejExt}): ${callerNum}`,
            source: 'call_rejected',
            referenceKey: `call_rej-${callId}-${rejExt}`,
            units: 1,
            userId: targetUserId,
            date: callDateIso,
            nextDueDate: null,
          });
        }
      }

      // 2. Missed total call (nobody answered)
      const wasAnswered = call.status === 'answered' || call.status === 'ended' || Boolean(call.answered_by_ext);
      if (call.status === 'missed' && !wasAnswered) {
        for (const advisorId of callCenterAdvisors) {
          cases.push({
            orderId: 0,
            orderCode: `CALL-${callId}`,
            customerName: `Llamada no contestada en horario: ${callerNum}`,
            source: 'call_missed',
            referenceKey: `call_miss-${callId}-${advisorId}`,
            units: 1,
            userId: advisorId,
            date: callDateIso,
            nextDueDate: null,
          });
        }
      }
    }
  } catch {
    // Si la tabla pbx_call_logs no existe o está mockeada parcialmente en pruebas unitarias
  }

  for (const entry of cases) {
    const user = users.get(entry.userId);
    if (!user) continue;
    const rate = PENALTY_PERCENT_PER_UNIT;
    const salary = salaryForRow(user);
    const percent = summarizePenalties(salary, rate, [{ source: entry.source, units: entry.units }]).percent;
    const amount = Math.round(salary ? salary * (percent / 100) * 100 : 0) / 100;
    await pool.execute(
      `INSERT INTO order_penalties
         (order_id,user_id,source,reference_key,units,rate,percent,weekly_salary,amount,period_start,period_end,cutoff_at,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pending')
       ON DUPLICATE KEY UPDATE user_id=VALUES(user_id), units=VALUES(units), rate=VALUES(rate),
         percent=VALUES(percent), weekly_salary=VALUES(weekly_salary), amount=VALUES(amount),
         status=IF(status IN ('liquidated', 'void'), status, 'pending'), updated_at=CURRENT_TIMESTAMP`,
      [entry.orderId, entry.userId, entry.source, entry.referenceKey, entry.units, rate, percent, salary, amount,
        toSqlDate(periodStart), toSqlDate(periodEnd), toSqlDate(cutoff)],
    );
  }
};

let lastSyncAt = 0;

export const syncPenaltiesThrottled = async (pool: Pool, now = new Date(), minIntervalMs = 60_000) => {
  if (Date.now() - lastSyncAt < minIntervalMs) return;
  lastSyncAt = Date.now();
  try {
    await syncPenalties(pool, now);
  } catch (err) {
    console.warn('[Penalties] syncPenalties failed in background:', err);
  }
};

export const getUserPenaltySnapshot = async (pool: Pool, userId: number, now = new Date()): Promise<UserPenaltySnapshot> => {
  const settings = await readPenaltySettings(pool);
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, weekly_salary FROM users WHERE id=? AND deleted_at IS NULL LIMIT 1',
    [userId],
  );
  const user = rows[0];
  const salary = user ? salaryForRow(user) : null;
  const rate = PENALTY_PERCENT_PER_UNIT;
  const period = payPeriodFor(now);
  const cutoff = latestCutoff(now);

  const [detailRows] = await pool.query<RowDataPacket[]>(
    `SELECT p.source, p.reference_key, p.units, p.percent, p.amount, p.period_end, p.cutoff_at, p.status,
            p.order_id, o.order_code, c.first_name, c.last_name, o.delivered_at,
            o.yard_piece_ready_at, o.workflow_data
       FROM order_penalties p
       LEFT JOIN orders o ON o.id=p.order_id
       LEFT JOIN customers c ON c.id=o.customer_id
      WHERE p.user_id=? AND p.period_end=?
      ORDER BY p.amount DESC, p.id DESC`,
    [userId, toSqlDate(new Date(period.end))],
  );
  const details: PenaltyOrderLine[] = detailRows
    .filter(row => row.status !== 'void' && row.status !== 'rejected')
    .map(row => {
      const data = parseWorkflowData(row.workflow_data);
      const isCall = row.source === 'call_missed' || row.source === 'call_rejected';
      const fallbackName = row.source === 'call_rejected'
        ? 'Llamada rechazada por asesor'
        : isCall
          ? 'Llamada no contestada en horario'
          : 'Cliente';
      const orderCode = String(row.order_code || (isCall ? row.reference_key : ''));
      const customer = row.order_id > 0 ? customerName(row) : fallbackName;

      return {
        source: row.source,
        units: Number(row.units),
        percent: Number(row.percent),
        amount: Number(row.amount),
        orderId: Number(row.order_id || 0),
        orderCode,
        customerName: customer,
        date: parseDate(
          row.source === 'claim'
            ? data.claimPieceReadyAt
            : row.source === 'ready_piece'
              ? row.yard_piece_ready_at
              : row.delivered_at || row.cutoff_at,
        ),
        nextDueDate: null,
      };
    });
  const open = summarizePenalties(salary, rate, (['post_delivery', 'ready_piece', 'ack_notification', 'claim', 'call_missed', 'call_rejected'] as const).map(source => ({
    source,
    units: details.filter(line => line.source === source).reduce((total, line) => total + line.units, 0),
  })));

  // Commissions, previous carryover debt and salary-protected settlement
  let commissions: EmployeeCommissionsSummary | undefined;
  let carryoverDebt: { totalDebt: number; lastPeriodEnd: string | null } = { totalDebt: 0, lastPeriodEnd: null };
  let settlement: EmployeeSettlementSummary | undefined;

  try {
    commissions = await getUserCommissionsSummary(pool, userId, period, now);
    carryoverDebt = await getUserCarryoverDebt(pool, userId);
    settlement = settleEmployeeCompensation(
      salary,
      commissions.earnedAmount,
      open.amount,
      carryoverDebt.totalDebt,
    );
  } catch {
    // Si la tabla de comisiones no está inicializada o mockeada en tests
  }

  const [historyRows] = await pool.query<RowDataPacket[]>(
    `SELECT period_end, SUM(units) AS units, SUM(amount) AS amount, MAX(cutoff_at) AS cutoff_at, status
       FROM order_penalties
      WHERE user_id=? AND period_end <= ? AND status IN ('liquidated','pending')
      GROUP BY period_end, status
      ORDER BY period_end DESC
      LIMIT 16`,
    [userId, toSqlDate(cutoff)],
  );
  const history: PenaltyHistoryEntry[] = historyRows.map(row => ({
    periodEnd: parseDate(row.period_end) || '',
    units: Number(row.units),
    percent: Number((Number(row.units) * rate).toFixed(2)),
    amount: Number(row.amount),
    cutAt: parseDate(row.cutoff_at) || '',
    status: String(row.status),
  }));

  return {
    userId,
    weeklySalary: salary,
    rate,
    enabled: settings.enabled,
    period: {
      start: period.start,
      end: period.end,
      label: `Sábado ${localDateKey(new Date(period.end)).slice(8, 10)}`,
      cutoffLabel: `Se descuenta el sábado ${localDateKey(new Date(period.end)).slice(8, 10)} a las 6:00 p. m.`,
    },
    open,
    details,
    history,
    commissions,
    carryoverDebt,
    settlement,
  };
};
