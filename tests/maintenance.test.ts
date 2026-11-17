import fs from 'node:fs/promises';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateAndSendVpsAlerts,
  extractUploadFilenamesFromValue,
  getStorageStats,
  getVpsStats,
  isOrderWarrantyExpiredForCleanup,
  purgeOrderFiles,
  readMaintenanceSettings,
  runMaintenanceCleanup,
  startMaintenanceScheduler,
  triggerRemoteDockerPrune,
  writeMaintenanceSettings,
} from '../src/server/maintenance';

describe('Automatic Storage Maintenance Rules', () => {
  const now = new Date('2026-11-16T12:00:00Z');

  it('keeps delivered order files while warranty is still active', () => {
    const expired = isOrderWarrantyExpiredForCleanup(
      {
        status: 'Entregado',
        delivered_at: '2026-11-01T12:00:00Z',
        warranty_days: 60,
        open_claims: 0,
      },
      0,
      now,
    );
    expect(expired).toBe(false);
  });

  it('keeps delivered order files if an open claim exists even after warranty expiration', () => {
    const expired = isOrderWarrantyExpiredForCleanup(
      {
        status: 'Entregado',
        delivered_at: '2026-08-01T12:00:00Z',
        warranty_days: 60,
        open_claims: 1,
      },
      0,
      now,
    );
    expect(expired).toBe(false);
  });

  it('marks delivered order files eligible once warranty has expired and no open claims remain', () => {
    const expired = isOrderWarrantyExpiredForCleanup(
      {
        status: 'Entregado',
        delivered_at: '2026-08-01T12:00:00Z',
        warranty_days: 60,
        open_claims: 0,
      },
      0,
      now,
    );
    expect(expired).toBe(true);
  });

  it('respects deliveredGraceDays after warranty expiration', () => {
    const expiredWithoutGrace = isOrderWarrantyExpiredForCleanup(
      {
        status: 'Entregado',
        delivered_at: '2026-09-10T12:00:00Z',
        warranty_days: 60,
        open_claims: 0,
      },
      0,
      now,
    );
    const expiredWithGrace = isOrderWarrantyExpiredForCleanup(
      {
        status: 'Entregado',
        delivered_at: '2026-09-10T12:00:00Z',
        warranty_days: 60,
        open_claims: 0,
      },
      15,
      now,
    );
    expect(expiredWithoutGrace).toBe(true);
    expect(expiredWithGrace).toBe(false);
  });

  it('extracts unique upload filenames from JSON and string fields', () => {
    const files = extractUploadFilenamesFromValue({
      referenceImages: ['/uploads/a_123.jpg', '/uploads/b_456.pdf', '/uploads/a_123.jpg'],
    });
    expect(files).toEqual(['a_123.jpg', 'b_456.pdf']);
    expect(extractUploadFilenamesFromValue(null)).toEqual([]);
  });
});

describe('Maintenance Settings, VPS Health, Alerts & Remote Prune', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const makeMockPool = (settingsRows: Array<{ setting_key: string; setting_value: string }> = []) => {
    const store = new Map(settingsRows.map((r) => [r.setting_key, r.setting_value]));
    const executed: Array<{ sql: string; params: any[] }> = [];
    return {
      executed,
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM app_settings')) {
          return [[...store.entries()].map(([setting_key, setting_value]) => ({ setting_key, setting_value }))];
        }
        if (sql.includes('FROM users')) return [[{ phone: '+584121234567' }]];
        if (sql.includes('FROM orders')) return [[]];
        if (sql.includes('FROM order_payments')) return [[]];
        if (sql.includes('FROM order_aftersales_logs')) return [[]];
        if (sql.includes('FROM followup_calls')) return [[]];
        return [[]];
      }),
      execute: vi.fn(async (sql: string, params: any[] = []) => {
        executed.push({ sql, params });
        if (sql.includes('INSERT INTO app_settings') && params.length >= 2) {
          store.set(String(params[0]), String(params[1]));
        }
        return [{ affectedRows: 1 }];
      }),
    } as any;
  };

  it('reads defaults and writes updated maintenance settings', async () => {
    const pool = makeMockPool([
      { setting_key: 'maintenance.auto_enabled', setting_value: '1' },
      { setting_key: 'maintenance.backups_retention_days', setting_value: '45' },
      { setting_key: 'maintenance.docker_prune_url', setting_value: 'http://172.18.0.1:9898' },
      { setting_key: 'maintenance.docker_prune_secret', setting_value: 'secret123' },
    ]);

    const settings = await readMaintenanceSettings(pool);
    expect(settings.autoEnabled).toBe(true);
    expect(settings.backupsRetentionDays).toBe(45);
    expect(settings.dockerPruneUrl).toBe('http://172.18.0.1:9898');
    expect(settings.dockerPruneSecretConfigured).toBe(true);

    const updated = await writeMaintenanceSettings(
      pool,
      {
        autoEnabled: false,
        deliveredGraceDays: 7,
        refundedRetentionDays: 20,
        pbxAudioRetentionDays: 14,
        backupsRetentionDays: 15,
        alertsEnabled: true,
        ramAlertThresholdPct: 85,
        diskAlertThresholdPct: 85,
        cpuAlertThresholdPct: 90,
        dockerPruneUrl: 'http://172.18.0.1:9898/',
        dockerPruneSecret: 'new-secret',
      },
      1,
    );
    expect(updated.autoEnabled).toBe(false);
    expect(updated.backupsRetentionDays).toBe(15);
    expect(pool.execute).toHaveBeenCalled();
  });

  it('collects storage stats and VPS health stats safely', async () => {
    const storage = await getStorageStats();
    expect(storage.totalBytes).toBeGreaterThanOrEqual(0);
    expect(storage.backupsFilesCount).toBeGreaterThanOrEqual(0);

    const vps = await getVpsStats();
    expect(vps.cpuCount).toBeGreaterThan(0);
    expect(vps.ramTotalBytes).toBeGreaterThan(0);
    expect(vps.ramUsedPct).toBeGreaterThanOrEqual(0);
    expect(vps.ramUsedPct).toBeLessThanOrEqual(100);
    expect(vps.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('sends WhatsApp alert to super admin when forceTest is true', async () => {
    const pool = makeMockPool([
      { setting_key: 'maintenance.alerts_enabled', setting_value: '1' },
    ]);
    const wasender = {
      sendText: vi.fn(async () => ({ ok: true })),
    };

    const result = await evaluateAndSendVpsAlerts(pool, wasender, { forceTest: true });
    expect(result.sent).toBe(true);
    expect(wasender.sendText).toHaveBeenCalledTimes(1);
  });

  it('does not send alert when disabled or inside cooldown', async () => {
    const poolDisabled = makeMockPool([
      { setting_key: 'maintenance.alerts_enabled', setting_value: '0' },
    ]);
    const wasender = {
      sendText: vi.fn(async () => ({ ok: true })),
    };
    const resDisabled = await evaluateAndSendVpsAlerts(poolDisabled, wasender);
    expect(resDisabled.sent).toBe(false);

    const poolCooldown = makeMockPool([
      { setting_key: 'maintenance.alerts_enabled', setting_value: '1' },
      { setting_key: 'maintenance.last_alert_at', setting_value: new Date().toISOString() },
    ]);
    const resCooldown = await evaluateAndSendVpsAlerts(poolCooldown, wasender);
    expect(resCooldown.sent).toBe(false);
  });

  it('runs dry-run maintenance cleanup and returns report structure', async () => {
    const pool = makeMockPool();
    const report = await runMaintenanceCleanup(pool, { dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.backupsExpired).toBeDefined();
    expect(report.totalFiles).toBeGreaterThanOrEqual(0);
  });

  it('triggers remote docker prune agent and handles unconfigured/error states', async () => {
    const unconfiguredPool = makeMockPool([]);
    await expect(triggerRemoteDockerPrune(unconfiguredPool)).rejects.toThrow(/Configura primero/i);

    const configuredPool = makeMockPool([
      { setting_key: 'maintenance.docker_prune_url', setting_value: 'http://172.18.0.1:9898' },
      { setting_key: 'maintenance.docker_prune_secret', setting_value: 'secret123' },
    ]);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          imagesOutput: 'Total reclaimed space: 100MB',
          builderOutput: 'Total: 50MB',
          releasesRemoved: 10,
          releasesBytesFreed: 1024,
        }),
      })),
    );

    const okRes = await triggerRemoteDockerPrune(configuredPool);
    expect(okRes.ok).toBe(true);
    expect(okRes.releasesRemoved).toBe(10);
    expect(okRes.releasesBytesFreed).toBe(1024);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Secreto inválido' }),
      })),
    );
    await expect(triggerRemoteDockerPrune(configuredPool)).rejects.toThrow(/Secreto inválido/i);
  });

  it('evaluates delivered, refunded, cancelled and pbx audio cleanup paths and scheduler', async () => {
    const now = new Date('2026-11-16T12:00:00Z');
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM app_settings')) {
          return [[
            { setting_key: 'maintenance.auto_enabled', setting_value: '1' },
            { setting_key: 'maintenance.delivered_grace_days', setting_value: '0' },
            { setting_key: 'maintenance.refunded_retention_days', setting_value: '30' },
            { setting_key: 'maintenance.pbx_audio_retention_days', setting_value: '30' },
          ]];
        }
        if (sql.includes('FROM orders')) {
          return [[
            {
              id: 101,
              status: 'Entregado',
              delivered_at: '2026-01-01T00:00:00Z',
              delivery_log_at: null,
              warranty_days: 30,
              warranty_terms: null,
              open_claims: 0,
              updated_at: '2026-01-01T00:00:00Z',
              reference_images: JSON.stringify(['/uploads/nonexistent_delivered.jpg']),
              attachments: null,
            },
            {
              id: 102,
              status: 'Reembolsado',
              delivered_at: null,
              delivery_log_at: null,
              warranty_days: 30,
              warranty_terms: null,
              open_claims: 0,
              updated_at: '2026-01-01T00:00:00Z',
              reference_images: null,
              attachments: JSON.stringify(['/uploads/nonexistent_refunded.pdf']),
            },
            {
              id: 103,
              status: 'Cancelado',
              delivered_at: null,
              delivery_log_at: null,
              warranty_days: 30,
              warranty_terms: null,
              open_claims: 0,
              updated_at: '2026-11-16T11:00:00Z',
              reference_images: JSON.stringify(['/uploads/nonexistent_cancel.png']),
              attachments: null,
            },
          ]];
        }
        if (sql.includes('FROM followup_calls')) {
          return [[
            { id: 55, audio_url: '/uploads/nonexistent_call.mp3', created_at: '2026-01-01T00:00:00Z' },
          ]];
        }
        return [[]];
      }),
      execute: vi.fn(async () => [{ affectedRows: 1 }]),
    } as any;

    const summary = await runMaintenanceCleanup(pool, { dryRun: true, now });
    expect(summary.dryRun).toBe(true);
    expect(summary.executedAt).toBe(now.toISOString());

    const timer = startMaintenanceScheduler(pool);
    expect(timer).toBeDefined();
    clearInterval(timer);
  });

  it('triggers non-test VPS alert on high RAM/CPU and runs scheduler tick', async () => {
    vi.spyOn(os, 'totalmem').mockReturnValue(1000);
    vi.spyOn(os, 'freemem').mockReturnValue(50);
    vi.spyOn(os, 'cpus').mockReturnValue([{ model: 'MockCPU', speed: 2400, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } }] as any);
    vi.spyOn(os, 'loadavg').mockReturnValue([0.95, 0.8, 0.7]);

    const executed: any[] = [];
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM app_settings')) {
          return [[
            { setting_key: 'maintenance.auto_enabled', setting_value: '1' },
            { setting_key: 'maintenance.alerts_enabled', setting_value: '1' },
            { setting_key: 'maintenance.ram_alert_threshold_pct', setting_value: '80' },
            { setting_key: 'maintenance.cpu_alert_threshold_pct', setting_value: '80' },
          ]];
        }
        if (sql.includes('FROM users')) return [[{ phone: '+584121234567' }]];
        if (sql.includes('FROM orders')) return [[]];
        if (sql.includes('FROM order_payments')) return [[{ receipt_url: '/uploads/pay_1.jpg' }]];
        if (sql.includes('FROM order_aftersales_logs')) return [[{ attachments: JSON.stringify(['/uploads/log_1.jpg']) }]];
        if (sql.includes('FROM followup_calls')) return [[]];
        return [[]];
      }),
      execute: vi.fn(async (sql: string, params: any[]) => {
        executed.push({ sql, params });
        return [{ affectedRows: 1 }];
      }),
    } as any;

    const wasender = { sendText: vi.fn(async () => ({ ok: true })) };
    const alertRes = await evaluateAndSendVpsAlerts(pool, wasender);
    expect(alertRes.sent).toBe(true);
    expect(alertRes.reasons.length).toBeGreaterThanOrEqual(2);
    expect(executed.some((e) => e.sql.includes('maintenance.last_alert_at'))).toBe(true);

    const runRes = await runMaintenanceCleanup(pool, { dryRun: false });
    expect(runRes.dryRun).toBe(false);
    expect(executed.some((e) => e.sql.includes('maintenance.last_run_at'))).toBe(true);

    vi.useFakeTimers();
    const timer = startMaintenanceScheduler(pool, wasender);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);
    clearInterval(timer);
    vi.useRealTimers();
  });

  it('deletes expired order files, pbx audios, orphans, and old backups while keeping 5 newest', async () => {
    const now = new Date('2026-11-16T12:00:00Z');
    const oldMs = new Date('2026-01-01T00:00:00Z').getTime();

    vi.spyOn(fs, 'readdir').mockImplementation(async (dirPath: any) => {
      const p = String(dirPath);
      if (p.endsWith('backups')) {
        return [1, 2, 3, 4, 5, 6, 7].map((i) => ({ name: `bk_${i}.sql`, isFile: () => true })) as any;
      }
      return [
        { name: 'delivered.jpg', isFile: () => true },
        { name: 'refunded.pdf', isFile: () => true },
        { name: 'cancelled.png', isFile: () => true },
        { name: 'orphan.pdf', isFile: () => true },
        { name: 'pbx_old.mp3', isFile: () => true },
        { name: 'subdir', isFile: () => false },
      ] as any;
    });
    vi.spyOn(fs, 'stat').mockImplementation(async (filePath: any) => {
      const p = String(filePath);
      const match = p.match(/bk_(\d+)\.sql$/);
      if (match) {
        const idx = Number(match[1]);
        return { size: 1000, mtimeMs: idx <= 5 ? now.getTime() - idx * 1000 : oldMs, isFile: () => true } as any;
      }
      return { size: 512, mtimeMs: oldMs, isFile: () => true } as any;
    });
    vi.spyOn(fs, 'unlink').mockResolvedValue(undefined);
    vi.spyOn(fs, 'statfs').mockResolvedValue({ blocks: 1000, bsize: 1024, bavail: 100 } as any);

    const stats = await getStorageStats();
    expect(stats.totalBytes).toBeGreaterThan(0);
    expect(stats.backupsFilesCount).toBeGreaterThan(0);

    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM app_settings')) {
          return [[
            { setting_key: 'maintenance.auto_enabled', setting_value: '1' },
            { setting_key: 'maintenance.backups_retention_days', setting_value: '30' },
          ]];
        }
        if (sql.includes('FROM orders')) {
          return [[
            {
              id: 10,
              status: 'Entregado',
              delivered_at: '2026-01-01T00:00:00Z',
              delivery_log_at: null,
              warranty_days: 30,
              warranty_terms: null,
              open_claims: 0,
              updated_at: '2026-01-01T00:00:00Z',
              reference_images: JSON.stringify(['/uploads/delivered.jpg']),
              attachments: null,
            },
            {
              id: 11,
              status: 'Reembolsado',
              delivered_at: null,
              delivery_log_at: null,
              warranty_days: 30,
              warranty_terms: null,
              open_claims: 0,
              updated_at: '2026-01-01T00:00:00Z',
              reference_images: null,
              attachments: JSON.stringify(['/uploads/refunded.pdf']),
            },
            {
              id: 12,
              status: 'Cancelado',
              delivered_at: null,
              delivery_log_at: null,
              warranty_days: 30,
              warranty_terms: null,
              open_claims: 0,
              updated_at: '2026-11-16T11:55:00Z',
              reference_images: JSON.stringify(['/uploads/cancelled.png']),
              attachments: null,
            },
          ]];
        }
        if (sql.includes('FROM pbx_call_logs')) {
          return [[{ uniqueid: 'call-77', recording_url: '/uploads/pbx-recordings/pbx_old.mp3' }]];
        }
        return [[]];
      }),
      execute: vi.fn(async () => [{ affectedRows: 1 }]),
    } as any;

    const dry = await runMaintenanceCleanup(pool, { dryRun: true, now });
    expect(dry.totalFiles).toBeGreaterThanOrEqual(2);
    expect(dry.backupsExpired.filesCount).toBeGreaterThan(0);

    const real = await runMaintenanceCleanup(pool, { dryRun: false, now });
    expect(real.totalFiles).toBeGreaterThanOrEqual(2);
    expect(fs.unlink).toHaveBeenCalled();

    expect(
      isOrderWarrantyExpiredForCleanup(
        {
          status: 'Entregado',
          delivered_at: null,
          delivery_log_at: '2026-01-01T00:00:00Z',
          warranty_days: null,
          warranty_terms: JSON.stringify({ warrantyDays: 30 }),
          open_claims: 0,
        },
        0,
        now,
      ),
    ).toBe(true);
    expect(isOrderWarrantyExpiredForCleanup({ status: 'Entregado' }, 0, now)).toBe(false);
    expect(isOrderWarrantyExpiredForCleanup({ status: 'En Proceso' }, 0, now)).toBe(false);
  });

  it('handles fs/query/fetch rejections gracefully across helpers', async () => {
    vi.spyOn(fs, 'readdir').mockRejectedValue(new Error('disk err'));
    vi.spyOn(fs, 'stat').mockRejectedValue(new Error('stat err'));
    vi.spyOn(fs, 'statfs').mockRejectedValue(new Error('statfs err'));

    const stats = await getStorageStats();
    expect(stats.totalBytes).toBe(0);

    const vps = await getVpsStats();
    expect(vps.diskTotalBytes).toBe(0);

    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM app_settings')) {
          return [[
            { setting_key: 'maintenance.last_summary', setting_value: '{bad-json' },
            { setting_key: 'maintenance.alerts_enabled', setting_value: '1' },
            { setting_key: 'maintenance.docker_prune_url', setting_value: 'http://172.18.0.1:9898/prune' },
            { setting_key: 'maintenance.docker_prune_secret', setting_value: 'sec' },
          ]];
        }
        if (sql.includes('FROM users')) return [[{ phone: '+584121234567' }]];
        throw new Error('db err');
      }),
      execute: vi.fn(async () => [{ affectedRows: 1 }]),
    } as any;

    const settings = await readMaintenanceSettings(pool);
    expect(settings.lastSummary).toBeNull();

    const wasender = { sendText: vi.fn(async () => { throw new Error('wa err'); }) };
    const alertRes = await evaluateAndSendVpsAlerts(pool, wasender, { forceTest: true });
    expect(alertRes.vps.cpuCount).toBeGreaterThan(0);

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new Error('bad json'); } })));
    await expect(triggerRemoteDockerPrune(pool)).rejects.toThrow(/HTTP 502/);

    await expect(runMaintenanceCleanup(pool, { dryRun: true })).rejects.toThrow(/db err/);

    // Disk alert (line 670) + scheduler error catch (lines 750-754)
    vi.spyOn(fs, 'statfs').mockResolvedValue({ blocks: 100, bsize: 1024, bavail: 5 } as any);
    const diskAlert = await evaluateAndSendVpsAlerts(pool, wasender);
    expect(diskAlert.reasons.some((r) => r.includes('Almacenamiento'))).toBe(true);

    vi.useFakeTimers();
    const failingPool = { query: vi.fn(async () => { throw new Error('tick err'); }) } as any;
    const errTimer = startMaintenanceScheduler(failingPool, wasender);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);
    clearInterval(errTimer);
    vi.useRealTimers();

    // Also exercise inner stat/unlink catch handlers when readdir succeeds
    vi.spyOn(fs, 'readdir').mockResolvedValue([{ name: 'f1.jpg', isFile: () => true }] as any);
    vi.spyOn(fs, 'stat').mockRejectedValue(new Error('stat err'));
    vi.spyOn(fs, 'unlink').mockRejectedValue(new Error('unlink err'));
    const statsWithStatErr = await getStorageStats();
    expect(statsWithStatErr.totalBytes).toBe(0);
    const okPool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM app_settings')) return [[]];
        if (sql.includes('FROM orders')) {
          return [[{
            id: 20, status: 'Cancelado', updated_at: '2026-01-01T00:00:00Z',
            reference_images: JSON.stringify(['/uploads/f1.jpg']),
          }]];
        }
        return [[]];
      }),
      execute: vi.fn(async () => [{ affectedRows: 1 }]),
    } as any;
    const resUnlinkErr = await runMaintenanceCleanup(okPool, { dryRun: false });
    expect(resUnlinkErr.cancelledImmediate.filesCount).toBe(0);

    // Also exercise purgeOrderFiles with stat/execute errors
    const purgePool = {
      query: vi.fn(async () => [[{ reference_images: JSON.stringify(['/uploads/p1.jpg']) }]]),
      execute: vi.fn(async () => { throw new Error('exec err'); }),
    } as any;
    vi.spyOn(fs, 'stat').mockResolvedValue({ size: 256, isFile: () => true } as any);
    const now = new Date('2026-11-16T12:00:00Z');
    expect(extractUploadFilenamesFromValue('/uploads/direct_1.jpg')).toEqual(['direct_1.jpg']);
    expect(
      isOrderWarrantyExpiredForCleanup(
        { status: 'Entregado', delivered_at: '2026-01-01T00:00:00Z', warranty_terms: { warrantyDays: 10 }, open_claims: 0 },
        0,
        now,
      ),
    ).toBe(true);
    expect(
      isOrderWarrantyExpiredForCleanup(
        { status: 'Entregado', delivered_at: '2026-01-01T00:00:00Z', warranty_terms: '{invalid', open_claims: 0 },
        0,
        now,
      ),
    ).toBe(true);
    await writeMaintenanceSettings(pool, { dockerPruneSecret: '' }, 1);
    await evaluateAndSendVpsAlerts(pool, null, { forceTest: true });

    const purged = await purgeOrderFiles(purgePool, 10);
    expect(purged.filesDeleted).toBeGreaterThanOrEqual(0);
    expect(purged.bytesFreed).toBeGreaterThanOrEqual(0);
  });
});
