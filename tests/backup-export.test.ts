import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getConnection: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn(),
  link: vi.fn(),
  unlink: vi.fn(),
  access: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('../src/server/config', () => ({
  pool: { query: mocks.query, getConnection: mocks.getConnection },
}));
vi.mock('node:fs', () => ({
  promises: {
    mkdir: mocks.mkdir, writeFile: mocks.writeFile, readdir: mocks.readdir,
    link: mocks.link, unlink: mocks.unlink, access: mocks.access, readFile: mocks.readFile, stat: mocks.stat,
  },
}));

import {
  acquireBackupLock, createDatabaseBackup, isBackupLocked, releaseBackupLock,
  restoreDatabaseBackup, saveBackupSnapshot,
  ensureBackupFileOnDisk, listBackups,
} from '../src/server/backup';
import { WasenderClient } from '../src/integrations/wasender/client';

const row = {
  id: '9007199254740993',
  created_at: new Date('2026-11-02T15:04:05.123Z'),
  precise_date: '2026-11-02 15:04:05.123456',
  settings: { recipients: ['synthetic'], enabled: true },
  json_text: '{"quoted":"O\'Brien","path":"C:\\\\data"}',
  binary: Buffer.from([0, 0xff, 0x27, 0x5c]),
  missing: null,
};

const makeConnection = () => ({
  query: vi.fn(async (input: string | { sql: string; typeCast: Function }) => {
    const sql = typeof input === 'string' ? input : input.sql;
    if (sql.startsWith('SELECT @@session')) return [[{ time_zone: 'SYSTEM' }], []];
    if (sql.includes('information_schema.TABLES')) return [[
      { table_name: 'orders', engine: 'InnoDB' },
      { table_name: 'system_backup_records', engine: 'InnoDB' },
    ], []];
    if (sql.startsWith('SHOW CREATE TABLE')) {
      return [[{ 'Create Table': `CREATE TABLE ${sql.slice('SHOW CREATE TABLE '.length)} (id BIGINT)` }], []];
    }
    if (sql.startsWith('SHOW FULL COLUMNS')) {
      return [[...Object.keys(row).map((Field) => ({ Field, Extra: '' })),
        { Field: 'computed', Extra: 'STORED GENERATED' }], []];
    }
    if (sql.startsWith('SELECT `')) return [[row], []];
    return [[], []];
  }),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  destroy: vi.fn(),
});

beforeEach(() => {
  vi.resetAllMocks();
  releaseBackupLock();
  mocks.readdir.mockResolvedValue([]);
  mocks.unlink.mockResolvedValue(undefined);
});
afterEach(() => {
  releaseBackupLock();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Actual backup exporter', () => {
  it('exports SQL dates, JSON, escaped text, binary and null without recursive dumps or generated values', async () => {
    const connection = makeConnection();
    mocks.getConnection.mockResolvedValue(connection);
    const sql = await createDatabaseBackup();
    expect(sql).toContain("'2026-11-02 15:04:05.123'");
    expect(sql).toContain("'2026-11-02 15:04:05.123456'");
    expect(sql).toContain(`'{"recipients":["synthetic"],"enabled":true}'`);
    expect(sql).toContain('O\\\'Brien');
    expect(sql).toContain("x'00ff275c'");
    expect(sql).toContain(', NULL);');
    expect(sql).not.toContain('[object Object]');
    expect(sql).not.toContain('`computed`');
    expect(sql).toContain('CREATE TABLE `system_backup_records`');
    expect(sql).not.toContain('INSERT INTO `system_backup_records`');
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.getConnection).toHaveBeenCalledTimes(1);
    const queries = connection.query.mock.calls.map(([input]) => typeof input === 'string' ? input : input.sql);
    expect(queries.indexOf('START TRANSACTION WITH CONSISTENT SNAPSHOT'))
      .toBeLessThan(queries.findIndex((query) => query.startsWith('SELECT `')));
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();

    const options = connection.query.mock.calls.map(([input]) => input)
      .find((input) => typeof input !== 'string') as { typeCast: Function };
    for (const type of ['DATE', 'DATETIME', 'TIMESTAMP', 'JSON', 'LONGLONG', 'NEWDECIMAL']) {
      expect(options.typeCast({ type, string: () => 'raw-exact-value' }, () => 'converted')).toBe('raw-exact-value');
    }
  });

  it('rolls back and rejects partial exports when a table read fails', async () => {
    const connection = makeConnection();
    const original = connection.query.getMockImplementation()!;
    connection.query.mockImplementation(async (input) => {
      if (typeof input !== 'string') throw new Error('read failed');
      return original(input);
    });
    mocks.getConnection.mockResolvedValue(connection);
    await expect(createDatabaseBackup()).rejects.toThrow('read failed');
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.query).toHaveBeenLastCalledWith('SET time_zone = ?', ['SYSTEM']);
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it('rejects nontransactional tables rather than claiming a consistent backup', async () => {
    const connection = makeConnection();
    const original = connection.query.getMockImplementation()!;
    connection.query.mockImplementation(async (input) => {
      if (typeof input === 'string' && input.includes('information_schema.TABLES')) {
        return [[{ table_name: 'orders', engine: 'MyISAM' }], []];
      }
      return original(input);
    });
    mocks.getConnection.mockResolvedValue(connection);
    await expect(createDatabaseBackup()).rejects.toThrow('Snapshot consistente no soportado');
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it('propagates backup storage failures and releases its lock', async () => {
    mocks.getConnection.mockResolvedValue(makeConnection());
    mocks.writeFile.mockRejectedValueOnce(new Error('disk full'));
    await expect(saveBackupSnapshot()).rejects.toThrow('disk full');
    expect(isBackupLocked()).toBe(false);
  });

  it('does not silently succeed when backup record persistence fails', async () => {
    mocks.getConnection.mockResolvedValue(makeConnection());
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO system_backup_records')) throw new Error('DB unavailable');
      return [[], []];
    });
    await expect(saveBackupSnapshot()).rejects.toThrow('no se pudo registrar');
    expect(isBackupLocked()).toBe(false);
  });

  it('does not let pre_restore bypass a concurrent backup lock', async () => {
    acquireBackupLock();
    await expect(saveBackupSnapshot({ tag: 'pre_restore' })).rejects.toThrow('ya se encuentra');
    expect(mocks.getConnection).not.toHaveBeenCalled();
    expect(isBackupLocked()).toBe(true);
  });
});

describe('Disabled restore boundary', () => {
  it.each(['', 'INVALID SQL', 'DROP DATABASE radar_v3;', 'CREATE TABLE users (id INT);'])(
    'rejects all SQL without reading files, opening connections or mutating the database: %s',
    async (sql) => {
      await expect(restoreDatabaseBackup(sql, { createSafetySnapshot: false }))
        .rejects.toMatchObject({ statusCode: 409, code: 'RESTORE_DISABLED' });
      expect(mocks.query).not.toHaveBeenCalled();
      expect(mocks.getConnection).not.toHaveBeenCalled();
      expect(mocks.writeFile).not.toHaveBeenCalled();
      expect(isBackupLocked()).toBe(false);
    },
  );
});

describe('Backup catalogue and filesystem failures', () => {
  it('rejects listing rather than returning an empty success when the database is unavailable', async () => {
    mocks.query.mockRejectedValue(new Error('database unavailable'));
    await expect(listBackups()).rejects.toThrow('database unavailable');
  });

  it('returns an empty list only when the catalogue and directories are genuinely empty or absent', async () => {
    mocks.query.mockResolvedValue([[], []]);
    mocks.readdir.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    await expect(listBackups()).resolves.toEqual([]);
  });

  it('surfaces directory permission errors', async () => {
    mocks.query.mockResolvedValue([[], []]);
    mocks.readdir.mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }));
    await expect(listBackups()).rejects.toThrow('permission denied');
  });

  it('awaits catalogue synchronization and rejects its failure', async () => {
    mocks.query.mockResolvedValueOnce([[], []]).mockRejectedValueOnce(new Error('insert failed'));
    mocks.readdir.mockResolvedValueOnce(['synthetic.sql']);
    mocks.stat.mockResolvedValue({ size: 12, mtime: new Date(), isFile: () => true });
    mocks.readFile.mockResolvedValue('SELECT 1;');
    await expect(listBackups()).rejects.toThrow('No se pudo sincronizar el catálogo');
  });

  it('does not disguise an unreadable backup as a missing file', async () => {
    mocks.access.mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }));
    await expect(ensureBackupFileOnDisk('synthetic.sql')).rejects.toThrow('permission denied');
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('allows missing disk files but rejects database retrieval failures', async () => {
    mocks.access.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    mocks.query.mockRejectedValue(new Error('database unavailable'));
    await expect(ensureBackupFileOnDisk('synthetic.sql')).rejects.toThrow('No se pudo recuperar el respaldo');
    mocks.query.mockResolvedValue([[], []]);
    await expect(ensureBackupFileOnDisk('synthetic.sql')).resolves.toBeNull();
  });

  it('rejects failed rematerialization instead of listing a recovered backup', async () => {
    mocks.access.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    mocks.query
      .mockResolvedValueOnce([[{ filename: 'synthetic.sql.gz', has_blob: 1 }], []])
      .mockResolvedValueOnce([[{ content_compressed: Buffer.from('synthetic gzip') }], []]);
    mocks.writeFile.mockRejectedValue(new Error('disk full'));
    await expect(listBackups()).rejects.toThrow('No se pudo recuperar el respaldo');
  });
});

describe('Wasender fails closed', () => {
  it('has no credential or recipient fallback and never sends without configuration', async () => {
    vi.stubEnv('WASENDER_API_KEY', '');
    vi.stubEnv('WASENDER_TEST_PHONE', '');
    vi.stubEnv('WASENDER_ENABLED', 'true');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const client = new WasenderClient();
    expect(client.configured).toBe(false);
    expect(client.designatedTestPhone).toBe('');
    await expect(client.sendText({ to: '5550100', text: 'synthetic' }))
      .rejects.toMatchObject({ code: 'CONFIGURATION' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('disables every outbound method even with explicitly supplied credentials', async () => {
    vi.stubEnv('WASENDER_ENABLED', 'false');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const client = new WasenderClient({ apiKey: 'synthetic-test-key' });
    expect(client.configured).toBe(false);
    await expect(client.sendText({ to: '5550100', text: 'synthetic' })).rejects.toMatchObject({ code: 'CONFIGURATION' });
    await expect(client.sendImage({ to: '5550100', url: 'https://example.invalid/synthetic' })).rejects.toMatchObject({ code: 'CONFIGURATION' });
    await expect(client.sendFile({ to: '5550100', url: 'https://example.invalid/synthetic' })).rejects.toMatchObject({ code: 'CONFIGURATION' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
