import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createConnection, createPool, type Connection, type Pool, type RowDataPacket } from 'mysql2/promise';

const host = process.env.BACKUP_TEST_DB_HOST;
const allowedHosts = new Set(['localhost', '127.0.0.1', '::1', 'db', 'radar-desktop-db-1']);
if (host && !allowedHosts.has(host)) throw new Error('Backup integration tests only accept local database hosts');

describe.skipIf(!host)('SQL backup round-trip on disposable local schemas', () => {
  const suffix = `${Date.now()}_${process.pid}`;
  const sourceName = `radar_backup_test_source_${suffix}`;
  const targetName = `radar_backup_test_target_${suffix}`;
  let admin: Connection;
  let target: Connection;
  let source: Pool;
  let originalParent: unknown;
  let originalChild: unknown;
  let dump: string;

  beforeAll(async () => {
    const options = {
      host,
      port: Number(process.env.BACKUP_TEST_DB_PORT || 3306),
      user: process.env.BACKUP_TEST_DB_USER || 'root',
      password: process.env.BACKUP_TEST_DB_PASSWORD || '',
      timezone: 'Z',
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
    };
    admin = await createConnection(options);
    await admin.query(`CREATE DATABASE \`${sourceName}\` CHARACTER SET utf8mb4`);
    await admin.query(`CREATE DATABASE \`${targetName}\` CHARACTER SET utf8mb4`);
    source = createPool({ ...options, database: sourceName, connectionLimit: 3 });
    target = await createConnection({ ...options, database: targetName, multipleStatements: true });
    await source.query(`CREATE TABLE a_parent (
      id BIGINT PRIMARY KEY, payload JSON, raw_bytes LONGBLOB,
      day_value DATE, datetime_value DATETIME(6), timestamp_value TIMESTAMP(6) NULL,
      amount DECIMAL(20,6), nullable_value TEXT,
      doubled BIGINT AS (id * 2) STORED
    ) ENGINE=InnoDB`);
    await source.query(`CREATE TABLE b_child (
      id INT PRIMARY KEY, parent_id BIGINT,
      FOREIGN KEY (parent_id) REFERENCES a_parent(id)
    ) ENGINE=InnoDB`);
    await source.query('CREATE TABLE system_backup_records (id INT, content_compressed LONGBLOB) ENGINE=InnoDB');
    await source.query('INSERT INTO system_backup_records VALUES (1, ?)', [Buffer.from('previous backup must not recurse')]);
    await source.query(
      'INSERT INTO a_parent (id,payload,raw_bytes,day_value,datetime_value,timestamp_value,amount,nullable_value) VALUES (?,?,?,?,?,?,?,?)',
      ['9007199254740993', JSON.stringify({ text: "O'Brien\\path\n😀", array: [true, null, 2] }),
        Buffer.from([0, 0xff, 0x27, 0x5c, 0x1a]), '2026-11-02', '2026-11-02 12:34:56.123456',
        '2026-11-02 12:34:56.654321', '12345678901234.123456', null],
    );
    await source.query('INSERT INTO b_child VALUES (1, ?)', ['9007199254740993']);
    [originalParent] = await source.query('SELECT * FROM a_parent');
    [originalChild] = await source.query('SELECT * FROM b_child');

    vi.doMock('../src/server/config', () => ({ pool: source }));
    const { createDatabaseBackup } = await import('../src/server/backup');
    const getConnection = source.getConnection.bind(source);
    vi.spyOn(source, 'getConnection').mockImplementation(async () => {
      const connection = await getConnection();
      const query = connection.query.bind(connection);
      connection.query = (async (...args: Parameters<typeof query>) => {
        const result = await query(...args);
        const request = args[0] as unknown as string | { sql: string };
        const sql = typeof request === 'string' ? request : request.sql;
        if (sql.startsWith('SELECT `') && sql.includes('FROM `a_parent`')) {
          // A separate writer commits between table reads; the export must retain its old snapshot.
          const writer = await getConnection();
          try {
            await writer.query('INSERT INTO b_child VALUES (2, ?)', ['9007199254740993']);
          } finally {
            writer.release();
          }
        }
        return result;
      }) as typeof connection.query;
      return connection;
    });
    dump = await createDatabaseBackup();
    vi.restoreAllMocks();
    await target.query(dump);
  }, 30_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    vi.doUnmock('../src/server/config');
    await target?.end();
    await source?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS \`${targetName}\``);
      await admin.query(`DROP DATABASE IF EXISTS \`${sourceName}\``);
      await admin.end();
    }
  });

  it('restores exact dates, JSON, blobs, nulls, large numbers, generated fields and relations', async () => {
    const [parent] = await target.query('SELECT * FROM a_parent');
    const [child] = await target.query('SELECT * FROM b_child');
    expect(parent).toEqual(originalParent);
    expect(child).toEqual(originalChild);
    for (const table of ['a_parent', 'b_child', 'system_backup_records']) {
      const [sourceSchema] = await source.query(`SHOW CREATE TABLE \`${table}\``);
      const [targetSchema] = await target.query(`SHOW CREATE TABLE \`${table}\``);
      expect(targetSchema).toEqual(sourceSchema);
    }
    const [records] = await target.query('SELECT * FROM system_backup_records');
    expect(records).toEqual([]);
    expect(dump).not.toContain('previous backup must not recurse');
  });

  it('does not include a child committed after its consistent snapshot', async () => {
    const [active] = await source.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM b_child');
    const [restored] = await target.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM b_child');
    expect(Number(active[0].count)).toBe(2);
    expect(Number(restored[0].count)).toBe(1);
  });
});
