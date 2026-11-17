import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { PBX_RECORDINGS_DIR } from './pbxAudioQa';

export const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
export const BACKUPS_DIR = path.resolve(process.cwd(), 'backups');
const DAY_MS = 24 * 60 * 60 * 1000;
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;

export interface MaintenanceSettings {
  autoEnabled: boolean;
  deliveredGraceDays: number;
  refundedRetentionDays: number;
  pbxAudioRetentionDays: number;
  backupsRetentionDays: number;
  alertsEnabled: boolean;
  ramAlertThresholdPct: number;
  diskAlertThresholdPct: number;
  cpuAlertThresholdPct: number;
  dockerPruneUrl: string;
  dockerPruneSecretConfigured: boolean;
  lastRunAt: string | null;
  lastAlertAt: string | null;
  lastSummary: MaintenanceRunSummary | null;
}

export interface VpsStats {
  hostname: string;
  platform: string;
  uptimeSeconds: number;
  cpuCount: number;
  cpuModel: string;
  loadAvg1m: number;
  loadAvg5m: number;
  loadAvg15m: number;
  cpuLoadPct: number;
  ramTotalBytes: number;
  ramUsedBytes: number;
  ramFreeBytes: number;
  ramUsedPct: number;
  processRssBytes: number;
  diskTotalBytes: number;
  diskUsedBytes: number;
  diskFreeBytes: number;
  diskUsedPct: number;
  sampledAt: string;
}

export interface StorageStats {
  orderFilesCount: number;
  orderBytes: number;
  pbxAudioCount: number;
  pbxAudioBytes: number;
  backupsFilesCount: number;
  backupsBytes: number;
  totalBytes: number;
}

export interface MaintenanceCategoryReport {
  ordersCount: number;
  filesCount: number;
  bytes: number;
}

export interface MaintenanceRunSummary {
  dryRun: boolean;
  executedAt: string;
  deliveredExpired: MaintenanceCategoryReport;
  refundedExpired: MaintenanceCategoryReport;
  cancelledImmediate: MaintenanceCategoryReport;
  pbxAudios: MaintenanceCategoryReport;
  backupsExpired: MaintenanceCategoryReport;
  orphans: MaintenanceCategoryReport;
  totalFiles: number;
  totalBytesFreed: number;
}

const SETTING_KEYS = [
  'maintenance.auto_enabled',
  'maintenance.delivered_grace_days',
  'maintenance.refunded_retention_days',
  'maintenance.pbx_audio_retention_days',
  'maintenance.backups_retention_days',
  'maintenance.alerts_enabled',
  'maintenance.ram_alert_threshold_pct',
  'maintenance.disk_alert_threshold_pct',
  'maintenance.cpu_alert_threshold_pct',
  'maintenance.docker_prune_url',
  'maintenance.docker_prune_secret',
  'maintenance.last_run_at',
  'maintenance.last_alert_at',
  'maintenance.last_summary',
];

const parseJsonSafe = <T>(raw: unknown): T | null => {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return null;
  }
};

export const extractUploadFilenamesFromValue = (raw: unknown): string[] => {
  if (!raw) return [];
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  const matches = text.match(/\/uploads\/([a-zA-Z0-9._-]+)/g) || [];
  return [...new Set(matches.map((m) => path.basename(m)).filter(Boolean))];
};

export const isOrderWarrantyExpiredForCleanup = (
  row: {
    status?: string | null;
    delivered_at?: string | Date | null;
    delivery_log_at?: string | Date | null;
    warranty_days?: number | null;
    warranty_terms?: unknown;
    open_claims?: number | null;
  },
  graceDays = 0,
  now = new Date(),
): boolean => {
  if (String(row.status || '').trim().toLowerCase() !== 'entregado') return false;
  if (Number(row.open_claims || 0) > 0) return false;
  const deliveredRaw = row.delivered_at || row.delivery_log_at;
  if (!deliveredRaw) return false;
  const deliveredMs = new Date(deliveredRaw).getTime();
  if (!Number.isFinite(deliveredMs)) return false;

  const terms = parseJsonSafe<{ days?: number; endsAt?: string }>(row.warranty_terms);
  let expiryMs: number;
  if (terms?.endsAt && Number.isFinite(Date.parse(terms.endsAt))) {
    expiryMs = Date.parse(terms.endsAt);
  } else {
    const days = Number.isFinite(Number(terms?.days))
      ? Number(terms?.days)
      : Number.isFinite(Number(row.warranty_days))
        ? Number(row.warranty_days)
        : 60;
    expiryMs = deliveredMs + Math.max(0, days) * DAY_MS;
  }

  return now.getTime() > expiryMs + Math.max(0, graceDays) * DAY_MS;
};

export const readMaintenanceSettings = async (pool: Pool): Promise<MaintenanceSettings> => {
  const placeholders = SETTING_KEYS.map(() => '?').join(', ');
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (${placeholders})`,
    SETTING_KEYS,
  );
  const map = new Map(rows.map((r) => [String(r.setting_key), String(r.setting_value ?? '')]));
  const clampDays = (val: string | undefined, fallback: number, min = 0) => {
    const n = Number(val);
    return Number.isFinite(n) && n >= min ? Math.min(3650, Math.round(n)) : fallback;
  };
  return {
    autoEnabled: (map.get('maintenance.auto_enabled') ?? '0') === '1',
    deliveredGraceDays: clampDays(map.get('maintenance.delivered_grace_days'), 0, 0),
    refundedRetentionDays: clampDays(map.get('maintenance.refunded_retention_days'), 30, 1),
    pbxAudioRetentionDays: clampDays(map.get('maintenance.pbx_audio_retention_days'), 30, 1),
    backupsRetentionDays: clampDays(map.get('maintenance.backups_retention_days'), 30, 1),
    alertsEnabled: (map.get('maintenance.alerts_enabled') ?? '1') === '1',
    ramAlertThresholdPct: clampDays(map.get('maintenance.ram_alert_threshold_pct'), 85, 50),
    diskAlertThresholdPct: clampDays(map.get('maintenance.disk_alert_threshold_pct'), 85, 50),
    cpuAlertThresholdPct: clampDays(map.get('maintenance.cpu_alert_threshold_pct'), 90, 50),
    dockerPruneUrl: (map.get('maintenance.docker_prune_url') || '').trim(),
    dockerPruneSecretConfigured: Boolean((map.get('maintenance.docker_prune_secret') || '').trim()),
    lastRunAt: map.get('maintenance.last_run_at') || null,
    lastAlertAt: map.get('maintenance.last_alert_at') || null,
    lastSummary: parseJsonSafe<MaintenanceRunSummary>(map.get('maintenance.last_summary')),
  };
};

export const writeMaintenanceSettings = async (
  pool: Pool,
  input: Partial<Pick<
    MaintenanceSettings,
    | 'autoEnabled'
    | 'deliveredGraceDays'
    | 'refundedRetentionDays'
    | 'pbxAudioRetentionDays'
    | 'backupsRetentionDays'
    | 'alertsEnabled'
    | 'ramAlertThresholdPct'
    | 'diskAlertThresholdPct'
    | 'cpuAlertThresholdPct'
    | 'dockerPruneUrl'
  >> & { dockerPruneSecret?: string },
  userId: number,
): Promise<MaintenanceSettings> => {
  const entries: Array<[string, string]> = [];
  if (typeof input.autoEnabled === 'boolean') {
    entries.push(['maintenance.auto_enabled', input.autoEnabled ? '1' : '0']);
  }
  if (typeof input.deliveredGraceDays === 'number' && Number.isFinite(input.deliveredGraceDays)) {
    entries.push(['maintenance.delivered_grace_days', String(Math.max(0, Math.min(365, Math.round(input.deliveredGraceDays))))]);
  }
  if (typeof input.refundedRetentionDays === 'number' && Number.isFinite(input.refundedRetentionDays)) {
    entries.push(['maintenance.refunded_retention_days', String(Math.max(1, Math.min(3650, Math.round(input.refundedRetentionDays))))]);
  }
  if (typeof input.pbxAudioRetentionDays === 'number' && Number.isFinite(input.pbxAudioRetentionDays)) {
    entries.push(['maintenance.pbx_audio_retention_days', String(Math.max(1, Math.min(3650, Math.round(input.pbxAudioRetentionDays))))]);
  }
  if (typeof input.backupsRetentionDays === 'number' && Number.isFinite(input.backupsRetentionDays)) {
    entries.push(['maintenance.backups_retention_days', String(Math.max(1, Math.min(3650, Math.round(input.backupsRetentionDays))))]);
  }
  if (typeof input.alertsEnabled === 'boolean') {
    entries.push(['maintenance.alerts_enabled', input.alertsEnabled ? '1' : '0']);
  }
  if (typeof input.ramAlertThresholdPct === 'number' && Number.isFinite(input.ramAlertThresholdPct)) {
    entries.push(['maintenance.ram_alert_threshold_pct', String(Math.max(50, Math.min(99, Math.round(input.ramAlertThresholdPct))))]);
  }
  if (typeof input.diskAlertThresholdPct === 'number' && Number.isFinite(input.diskAlertThresholdPct)) {
    entries.push(['maintenance.disk_alert_threshold_pct', String(Math.max(50, Math.min(99, Math.round(input.diskAlertThresholdPct))))]);
  }
  if (typeof input.cpuAlertThresholdPct === 'number' && Number.isFinite(input.cpuAlertThresholdPct)) {
    entries.push(['maintenance.cpu_alert_threshold_pct', String(Math.max(50, Math.min(100, Math.round(input.cpuAlertThresholdPct))))]);
  }
  if (typeof input.dockerPruneUrl === 'string') {
    entries.push(['maintenance.docker_prune_url', input.dockerPruneUrl.trim().slice(0, 300)]);
  }
  if (typeof input.dockerPruneSecret === 'string' && input.dockerPruneSecret.trim()) {
    entries.push(['maintenance.docker_prune_secret', input.dockerPruneSecret.trim().slice(0, 200)]);
  }
  for (const [key, value] of entries) {
    await pool.execute(
      `INSERT INTO app_settings (setting_key, setting_value, updated_by)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value), updated_by=VALUES(updated_by)`,
      [key, value, userId || null],
    );
  }
  return readMaintenanceSettings(pool);
};

export const getStorageStats = async (): Promise<StorageStats> => {
  let orderFilesCount = 0;
  let orderBytes = 0;
  let pbxAudioCount = 0;
  let pbxAudioBytes = 0;

  try {
    const entries = await fs.readdir(UPLOADS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const stat = await fs.stat(path.join(UPLOADS_DIR, entry.name)).catch(() => null);
      if (stat) {
        orderFilesCount += 1;
        orderBytes += stat.size;
      }
    }
  } catch {
    // Directory may not exist yet
  }

  try {
    const audioEntries = await fs.readdir(PBX_RECORDINGS_DIR, { withFileTypes: true });
    for (const entry of audioEntries) {
      if (!entry.isFile()) continue;
      const stat = await fs.stat(path.join(PBX_RECORDINGS_DIR, entry.name)).catch(() => null);
      if (stat) {
        pbxAudioCount += 1;
        pbxAudioBytes += stat.size;
      }
    }
  } catch {
    // Directory may not exist yet
  }

  let backupsFilesCount = 0;
  let backupsBytes = 0;
  for (const dir of [BACKUPS_DIR, path.join(UPLOADS_DIR, 'backups')]) {
    try {
      const bEntries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of bEntries) {
        if (!entry.isFile()) continue;
        const stat = await fs.stat(path.join(dir, entry.name)).catch(() => null);
        if (stat) {
          backupsFilesCount += 1;
          backupsBytes += stat.size;
        }
      }
    } catch {
      // Directory may not exist yet
    }
  }

  return {
    orderFilesCount,
    orderBytes,
    pbxAudioCount,
    pbxAudioBytes,
    backupsFilesCount,
    backupsBytes,
    totalBytes: orderBytes + pbxAudioBytes + backupsBytes,
  };
};

const collectFilenamesForOrder = async (pool: Pool, orderId: number): Promise<string[]> => {
  const filenames = new Set<string>();

  const [ufRows] = await pool.query<RowDataPacket[]>(
    'SELECT filename FROM uploaded_files WHERE order_id = ?',
    [orderId],
  );
  for (const row of ufRows) {
    if (row.filename) filenames.add(path.basename(String(row.filename)));
  }

  const [orderRows] = await pool.query<RowDataPacket[]>(
    'SELECT yard_compatibility FROM orders WHERE id = ? LIMIT 1',
    [orderId],
  );
  if (orderRows[0]) {
    for (const fn of extractUploadFilenamesFromValue(orderRows[0].yard_compatibility)) {
      filenames.add(fn);
    }
  }

  const queries: Array<[string, string[]]> = [
    ['SELECT file_url AS val FROM order_invoices WHERE order_id = ?', ['val']],
    ['SELECT file_url AS val FROM order_core_receipts WHERE order_id = ?', ['val']],
    ['SELECT file_url AS val FROM followup_evidence WHERE order_id = ?', ['val']],
    ['SELECT evidence_files AS val FROM claims WHERE order_id = ?', ['val']],
    ['SELECT evidence_files AS val FROM refund_requests WHERE order_id = ?', ['val']],
    ['SELECT payment_receipt AS val FROM finance_movements WHERE order_id = ?', ['val']],
    ['SELECT evidence AS val FROM order_workflow_events WHERE order_id = ?', ['val']],
  ];

  for (const [sql] of queries) {
    try {
      const [rows] = await pool.query<RowDataPacket[]>(sql, [orderId]);
      for (const row of rows) {
        for (const fn of extractUploadFilenamesFromValue(row.val)) {
          filenames.add(fn);
        }
      }
    } catch {
      // Table may not exist in older schemas
    }
  }

  return [...filenames];
};

const measureUploadFiles = async (filenames: string[]): Promise<{ existingCount: number; bytes: number }> => {
  let existingCount = 0;
  let bytes = 0;
  for (const fn of filenames) {
    const filePath = path.resolve(UPLOADS_DIR, path.basename(fn));
    if (!filePath.startsWith(UPLOADS_DIR + path.sep)) continue;
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat?.isFile()) {
      existingCount += 1;
      bytes += stat.size;
    }
  }
  return { existingCount, bytes };
};

export const purgeOrderFiles = async (
  pool: Pool,
  orderId: number,
): Promise<{ filesDeleted: number; bytesFreed: number }> => {
  const filenames = await collectFilenamesForOrder(pool, orderId);
  let filesDeleted = 0;
  let bytesFreed = 0;

  for (const fn of filenames) {
    const safeName = path.basename(fn);
    const filePath = path.resolve(UPLOADS_DIR, safeName);
    if (!filePath.startsWith(UPLOADS_DIR + path.sep)) continue;
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat?.isFile()) {
      await fs.unlink(filePath).catch(() => {});
      filesDeleted += 1;
      bytesFreed += stat.size;
    }
  }

  await pool.execute('DELETE FROM uploaded_files WHERE order_id = ?', [orderId]).catch(() => {});
  await pool.execute('DELETE FROM order_invoices WHERE order_id = ?', [orderId]).catch(() => {});
  await pool.execute('DELETE FROM order_core_receipts WHERE order_id = ?', [orderId]).catch(() => {});
  await pool.execute('UPDATE followup_evidence SET file_url = "" WHERE order_id = ?', [orderId]).catch(() => {});
  await pool.execute('UPDATE claims SET evidence_files = NULL WHERE order_id = ?', [orderId]).catch(() => {});
  await pool.execute('UPDATE refund_requests SET evidence_files = NULL WHERE order_id = ?', [orderId]).catch(() => {});
  await pool.execute('UPDATE finance_movements SET payment_receipt = NULL WHERE order_id = ?', [orderId]).catch(() => {});
  await pool.execute('UPDATE orders SET yard_compatibility = NULL WHERE id = ?', [orderId]).catch(() => {});

  return { filesDeleted, bytesFreed };
};

export const runMaintenanceCleanup = async (
  pool: Pool,
  options: { dryRun: boolean; now?: Date; triggeredByUserId?: number | null },
): Promise<MaintenanceRunSummary> => {
  const now = options.now ?? new Date();
  const settings = await readMaintenanceSettings(pool);

  const deliveredExpired: MaintenanceCategoryReport = { ordersCount: 0, filesCount: 0, bytes: 0 };
  const refundedExpired: MaintenanceCategoryReport = { ordersCount: 0, filesCount: 0, bytes: 0 };
  const cancelledImmediate: MaintenanceCategoryReport = { ordersCount: 0, filesCount: 0, bytes: 0 };
  const pbxAudios: MaintenanceCategoryReport = { ordersCount: 0, filesCount: 0, bytes: 0 };
  const backupsExpired: MaintenanceCategoryReport = { ordersCount: 0, filesCount: 0, bytes: 0 };
  const orphans: MaintenanceCategoryReport = { ordersCount: 0, filesCount: 0, bytes: 0 };

  const [candidateOrders] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT o.id, o.status, o.delivered_at, o.warranty_days, o.warranty_terms, o.updated_at,
       (SELECT MIN(created_at) FROM status_orders WHERE order_id = o.id AND LOWER(status) = 'entregado') AS delivery_log_at,
       (SELECT MAX(created_at) FROM status_orders WHERE order_id = o.id AND LOWER(status) = 'reembolsado') AS refunded_log_at,
       (SELECT COUNT(*) FROM claims c WHERE c.order_id = o.id AND c.status NOT IN ('Resolved', 'Denied')) AS open_claims
     FROM orders o
     WHERE LOWER(o.status) IN ('entregado', 'reembolsado', 'cancelado')
       AND (
         EXISTS (SELECT 1 FROM uploaded_files uf WHERE uf.order_id = o.id)
         OR o.yard_compatibility IS NOT NULL
         OR EXISTS (SELECT 1 FROM order_invoices oi WHERE oi.order_id = o.id)
         OR EXISTS (SELECT 1 FROM order_core_receipts ocr WHERE ocr.order_id = o.id)
         OR EXISTS (SELECT 1 FROM followup_evidence fe WHERE fe.order_id = o.id AND fe.file_url <> '')
         OR EXISTS (SELECT 1 FROM claims cl WHERE cl.order_id = o.id AND cl.evidence_files IS NOT NULL)
         OR EXISTS (SELECT 1 FROM refund_requests rr WHERE rr.order_id = o.id AND rr.evidence_files IS NOT NULL)
       )`,
  );

  const refundedCutoffMs = now.getTime() - settings.refundedRetentionDays * DAY_MS;

  for (const row of candidateOrders) {
    const orderId = Number(row.id);
    const statusLower = String(row.status || '').trim().toLowerCase();
    let bucket: MaintenanceCategoryReport | null = null;

    if (statusLower === 'cancelado') {
      bucket = cancelledImmediate;
    } else if (statusLower === 'reembolsado') {
      const refRaw = row.refunded_log_at || row.updated_at;
      const refMs = refRaw ? new Date(refRaw).getTime() : NaN;
      if (Number.isFinite(refMs) && refMs <= refundedCutoffMs) {
        bucket = refundedExpired;
      }
    } else if (statusLower === 'entregado') {
      if (isOrderWarrantyExpiredForCleanup(row as Record<string, any>, settings.deliveredGraceDays, now)) {
        bucket = deliveredExpired;
      }
    }

    if (!bucket) continue;
    const filenames = await collectFilenamesForOrder(pool, orderId);
    const measured = await measureUploadFiles(filenames);
    if (measured.existingCount === 0 && filenames.length === 0) continue;

    if (options.dryRun) {
      bucket.ordersCount += 1;
      bucket.filesCount += measured.existingCount;
      bucket.bytes += measured.bytes;
    } else {
      const purged = await purgeOrderFiles(pool, orderId);
      bucket.ordersCount += 1;
      bucket.filesCount += purged.filesDeleted;
      bucket.bytes += purged.bytesFreed;
    }
  }

  // PBX Audio Recordings older than pbxAudioRetentionDays
  try {
    const audioCutoff = new Date(now.getTime() - settings.pbxAudioRetentionDays * DAY_MS);
    const [audioRows] = await pool.query<RowDataPacket[]>(
      `SELECT uniqueid, recording_url
       FROM pbx_call_logs
       WHERE recording_url IS NOT NULL AND recording_url <> ''
         AND COALESCE(recording_uploaded_at, started_at) <= ?`,
      [audioCutoff],
    );
    for (const row of audioRows) {
      const filename = path.basename(String(row.recording_url));
      const filePath = path.resolve(PBX_RECORDINGS_DIR, filename);
      if (!filePath.startsWith(PBX_RECORDINGS_DIR + path.sep)) continue;
      const stat = await fs.stat(filePath).catch(() => null);
      const size = stat?.isFile() ? stat.size : 0;
      if (options.dryRun) {
        if (stat?.isFile()) {
          pbxAudios.ordersCount += 1;
          pbxAudios.filesCount += 1;
          pbxAudios.bytes += size;
        }
      } else {
        if (stat?.isFile()) {
          await fs.unlink(filePath).catch(() => {});
          pbxAudios.filesCount += 1;
          pbxAudios.bytes += size;
        }
        pbxAudios.ordersCount += 1;
        await pool.execute(
          'UPDATE pbx_call_logs SET recording_url = NULL, recording_mime_type = NULL WHERE uniqueid = ?',
          [String(row.uniqueid)],
        );
      }
    }
  } catch {
    // Ignore if recording_url column does not exist yet
  }

  // Orphan files in uploads/ (> 24h old and not referenced anywhere)
  try {
    const referenced = new Set<string>();
    const [ufAll] = await pool.query<RowDataPacket[]>('SELECT filename FROM uploaded_files');
    for (const r of ufAll) if (r.filename) referenced.add(path.basename(String(r.filename)));
    const [avatarRows] = await pool.query<RowDataPacket[]>('SELECT avatar_url FROM users WHERE avatar_url IS NOT NULL');
    for (const r of avatarRows) extractUploadFilenamesFromValue(r.avatar_url).forEach((f) => referenced.add(f));
    const [invRows] = await pool.query<RowDataPacket[]>('SELECT photo_url FROM inventory_parts WHERE photo_url IS NOT NULL');
    for (const r of invRows) extractUploadFilenamesFromValue(r.photo_url).forEach((f) => referenced.add(f));

    const entries = await fs.readdir(UPLOADS_DIR, { withFileTypes: true });
    const minAgeMs = now.getTime() - DAY_MS;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (referenced.has(entry.name)) continue;
      const filePath = path.join(UPLOADS_DIR, entry.name);
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat || stat.mtimeMs > minAgeMs) continue;
      if (options.dryRun) {
        orphans.filesCount += 1;
        orphans.bytes += stat.size;
      } else {
        await fs.unlink(filePath).catch(() => {});
        orphans.filesCount += 1;
        orphans.bytes += stat.size;
      }
    }
  } catch {
    // Ignore transient scan errors
  }

  // Old SQL backups in backups/ and uploads/backups/ (always keep at least 5 newest)
  try {
    const backupCutoffMs = now.getTime() - settings.backupsRetentionDays * DAY_MS;
    const allBackups: Array<{ filePath: string; mtimeMs: number; size: number }> = [];
    for (const dir of [BACKUPS_DIR, path.join(UPLOADS_DIR, 'backups')]) {
      const bEntries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of bEntries) {
        if (!entry.isFile()) continue;
        const filePath = path.join(dir, entry.name);
        const stat = await fs.stat(filePath).catch(() => null);
        if (stat) allBackups.push({ filePath, mtimeMs: stat.mtimeMs, size: stat.size });
      }
    }
    allBackups.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const removableBackups = allBackups.slice(5).filter((b) => b.mtimeMs <= backupCutoffMs);
    for (const b of removableBackups) {
      if (!options.dryRun) {
        await fs.unlink(b.filePath).catch(() => {});
      }
      backupsExpired.filesCount += 1;
      backupsExpired.bytes += b.size;
    }
  } catch {
    // Ignore transient backup scan errors
  }

  const totalFiles =
    deliveredExpired.filesCount +
    refundedExpired.filesCount +
    cancelledImmediate.filesCount +
    pbxAudios.filesCount +
    backupsExpired.filesCount +
    orphans.filesCount;
  const totalBytesFreed =
    deliveredExpired.bytes +
    refundedExpired.bytes +
    cancelledImmediate.bytes +
    pbxAudios.bytes +
    backupsExpired.bytes +
    orphans.bytes;

  const summary: MaintenanceRunSummary = {
    dryRun: options.dryRun,
    executedAt: now.toISOString(),
    deliveredExpired,
    refundedExpired,
    cancelledImmediate,
    pbxAudios,
    backupsExpired,
    orphans,
    totalFiles,
    totalBytesFreed,
  };

  if (!options.dryRun) {
    const uid = options.triggeredByUserId || null;
    await pool.execute(
      `INSERT INTO app_settings (setting_key, setting_value, updated_by)
       VALUES ('maintenance.last_run_at', ?, ?), ('maintenance.last_summary', ?, ?)
       ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value), updated_by=VALUES(updated_by)`,
      [summary.executedAt, uid, JSON.stringify(summary), uid],
    );
  }

  return summary;
};

export const getVpsStats = async (): Promise<VpsStats> => {
  const cpus = os.cpus();
  const cpuCount = Math.max(1, cpus.length);
  const cpuModel = cpus[0]?.model?.trim() || 'CPU';
  const [loadAvg1m, loadAvg5m, loadAvg15m] = os.loadavg();
  const cpuLoadPct = Math.min(100, Math.max(0, Math.round((loadAvg1m / cpuCount) * 100)));

  const ramTotalBytes = os.totalmem();
  const ramFreeBytes = os.freemem();
  const ramUsedBytes = Math.max(0, ramTotalBytes - ramFreeBytes);
  const ramUsedPct = ramTotalBytes > 0 ? Math.round((ramUsedBytes / ramTotalBytes) * 100) : 0;
  const processRssBytes = process.memoryUsage().rss;

  let diskTotalBytes = 0;
  let diskFreeBytes = 0;
  let diskUsedBytes = 0;
  let diskUsedPct = 0;

  try {
    const targetPath = await fs.stat(UPLOADS_DIR).then(() => UPLOADS_DIR).catch(() => process.cwd());
    const stat = await fs.statfs(targetPath);
    diskTotalBytes = Number(stat.blocks) * Number(stat.bsize);
    diskFreeBytes = Number(stat.bavail) * Number(stat.bsize);
    diskUsedBytes = Math.max(0, diskTotalBytes - diskFreeBytes);
    diskUsedPct = diskTotalBytes > 0 ? Math.round((diskUsedBytes / diskTotalBytes) * 100) : 0;
  } catch {
    // Ignore if statfs unavailable
  }

  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    uptimeSeconds: Math.round(os.uptime()),
    cpuCount,
    cpuModel,
    loadAvg1m: Math.round(loadAvg1m * 100) / 100,
    loadAvg5m: Math.round(loadAvg5m * 100) / 100,
    loadAvg15m: Math.round(loadAvg15m * 100) / 100,
    cpuLoadPct,
    ramTotalBytes,
    ramUsedBytes,
    ramFreeBytes,
    ramUsedPct,
    processRssBytes,
    diskTotalBytes,
    diskUsedBytes,
    diskFreeBytes,
    diskUsedPct,
    sampledAt: new Date().toISOString(),
  };
};

const fmtGb = (bytes: number): string => `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;

export const evaluateAndSendVpsAlerts = async (
  pool: Pool,
  wasender: any,
  options: { forceTest?: boolean } = {},
): Promise<{ sent: boolean; reasons: string[]; vps: VpsStats }> => {
  const [settings, vps] = await Promise.all([readMaintenanceSettings(pool), getVpsStats()]);
  const reasons: string[] = [];

  if (vps.ramUsedPct >= settings.ramAlertThresholdPct) {
    reasons.push(`RAM crítica al ${vps.ramUsedPct}% (${fmtGb(vps.ramUsedBytes)} / ${fmtGb(vps.ramTotalBytes)})`);
  }
  if (vps.diskUsedPct >= settings.diskAlertThresholdPct) {
    reasons.push(`Almacenamiento crítico al ${vps.diskUsedPct}% (${fmtGb(vps.diskUsedBytes)} / ${fmtGb(vps.diskTotalBytes)})`);
  }
  if (vps.cpuLoadPct >= settings.cpuAlertThresholdPct) {
    reasons.push(`CPU sobrecargado al ${vps.cpuLoadPct}% (load ${vps.loadAvg1m} en ${vps.cpuCount} núcleos)`);
  }

  if (!options.forceTest) {
    if (!settings.alertsEnabled || reasons.length === 0) {
      return { sent: false, reasons, vps };
    }
    if (settings.lastAlertAt && Date.now() - Date.parse(settings.lastAlertAt) < ALERT_COOLDOWN_MS) {
      return { sent: false, reasons, vps };
    }
  }

  const header = options.forceTest
    ? '🧪 *PRUEBA DE ALERTA VPS · RADAR*'
    : '🚨 *ALERTA CRÍTICA DE SERVIDOR VPS · RADAR*';
  const alertBody = reasons.length > 0
    ? reasons.map((r) => `• ${r}`).join('\n')
    : '• Prueba manual de monitoreo (recursos dentro de rango normal).';
  const message = [
    header,
    '',
    alertBody,
    '',
    `🖥️ *CPU:* ${vps.cpuLoadPct}% (Load ${vps.loadAvg1m} · ${vps.cpuCount} cores)`,
    `🧠 *RAM:* ${vps.ramUsedPct}% (${fmtGb(vps.ramUsedBytes)} / ${fmtGb(vps.ramTotalBytes)})`,
    `💾 *Disco:* ${vps.diskUsedPct}% (${fmtGb(vps.diskUsedBytes)} / ${fmtGb(vps.diskTotalBytes)})`,
    `🕒 *Fecha:* ${new Date().toLocaleString('es-VE')}`,
  ].join('\n');

  let sent = false;
  if (wasender) {
    try {
      const { dispatchSystemNotification } = await import('../integrations/wasender/notificationService');
      const delivery = await dispatchSystemNotification(pool, wasender, 'ALERTA_SEGURIDAD', message);
      if (delivery?.dispatchedCount > 0) sent = true;
    } catch {
      // Fall through to direct admin phones
    }

    if (!sent && typeof wasender.sendText === 'function') {
      try {
        const [admins] = await pool.query<RowDataPacket[]>(
          "SELECT phone FROM users WHERE role = 'admin' AND active = 1 AND deleted_at IS NULL AND phone IS NOT NULL AND phone <> ''",
        );
        for (const admin of admins) {
          const phone = String(admin.phone || '').trim();
          if (!phone) continue;
          await wasender.sendText(phone, message).catch(() => {});
          sent = true;
        }
      } catch {
        // Ignore direct fallback errors
      }
    }
  }

  if (sent && !options.forceTest) {
    await pool.execute(
      `INSERT INTO app_settings (setting_key, setting_value)
       VALUES ('maintenance.last_alert_at', ?)
       ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`,
      [new Date().toISOString()],
    );
  }

  return { sent, reasons, vps };
};

export const startMaintenanceScheduler = (pool: Pool, wasender?: any): NodeJS.Timeout => {
  const tick = async () => {
    try {
      const settings = await readMaintenanceSettings(pool);
      if (settings.autoEnabled) {
        if (!settings.lastRunAt || Date.now() - Date.parse(settings.lastRunAt) >= 23 * 60 * 60 * 1000) {
          await runMaintenanceCleanup(pool, { dryRun: false });
        }
      }
      if (wasender) {
        await evaluateAndSendVpsAlerts(pool, wasender);
      }
    } catch (err) {
      console.error('[Maintenance] Error en limpieza/monitoreo automático:', err);
    }
  };

  const bootTimer = setTimeout(() => { void tick(); }, 5 * 60 * 1000);
  bootTimer.unref?.();

  const interval = setInterval(() => { void tick(); }, 5 * 60 * 1000);
  interval.unref?.();
  return interval;
};

export const triggerRemoteDockerPrune = async (
  pool: Pool,
): Promise<{
  ok: boolean;
  imagesOutput?: string;
  builderOutput?: string;
  releasesRemoved?: number;
  releasesBytesFreed?: number;
  message?: string;
}> => {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('maintenance.docker_prune_url', 'maintenance.docker_prune_secret')",
  );
  const map = new Map(rows.map((r) => [String(r.setting_key), String(r.setting_value ?? '')]));
  const baseUrl = (map.get('maintenance.docker_prune_url') || '').trim().replace(/\/+$/, '');
  const secret = (map.get('maintenance.docker_prune_secret') || '').trim();
  if (!baseUrl || !secret) {
    throw new Error('Configura primero la URL y el Secreto del Agente Docker en el VPS.');
  }
  const targetUrl = baseUrl.endsWith('/prune') ? baseUrl : `${baseUrl}/prune`;
  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'x-maintenance-secret': secret },
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await res.json().catch(() => ({})) as Record<string, any>;
  if (!res.ok) {
    throw new Error(payload?.message || `El agente Docker respondió HTTP ${res.status}`);
  }
  return {
    ok: true,
    imagesOutput: String(payload.imagesOutput || ''),
    builderOutput: String(payload.builderOutput || ''),
    releasesRemoved: Number(payload.releasesRemoved || 0),
    releasesBytesFreed: Number(payload.releasesBytesFreed || 0),
  };
};
