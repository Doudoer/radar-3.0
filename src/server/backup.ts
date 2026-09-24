import { promises as fs } from 'node:fs';
import path from 'node:path';
import { RowDataPacket, createConnection } from 'mysql2/promise';
import { pool } from './config';

const escapeIdentifier = (value: string) => `\`${value.replace(/`/g, '``')}\``;

const escapeValue = (value: unknown) => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';

  const text = Buffer.isBuffer(value)
    ? `x'${value.toString('hex')}'`
    : String(value)
      .replace(/\\/g, '\\\\')
      .replace(/\0/g, '\\0')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/'/g, "\\'")
      .replace(/\x1a/g, '\\Z');

  return Buffer.isBuffer(value) ? text : `'${text}'`;
};

const getTableName = (row: RowDataPacket) => String(row[Object.keys(row)[0]]);

const backupsDirectory = path.resolve(process.cwd(), 'backups');

export const ensureBackupsDirectory = async () => {
  await fs.mkdir(backupsDirectory, { recursive: true });
};

export const createDatabaseBackup = async (): Promise<string> => {
  const [tableRows] = await pool.query<RowDataPacket[]>('SHOW FULL TABLES WHERE Table_type = \'BASE TABLE\'');
  const chunks = [
    '-- Radar 3.0 database backup\n',
    `-- Generated: ${new Date().toISOString()}\n`,
    'SET FOREIGN_KEY_CHECKS=0;\nSET SQL_MODE=\'NO_AUTO_VALUE_ON_ZERO\';\n\n',
  ];

  for (const tableRow of tableRows) {
    const tableName = getTableName(tableRow);
    const identifier = escapeIdentifier(tableName);
    const [createRows] = await pool.query<RowDataPacket[]>(`SHOW CREATE TABLE ${identifier}`);
    const createStatement = String(createRows[0]?.['Create Table'] || '').replace(/;?$/, ';');
    if (!createStatement) continue;

    chunks.push(`DROP TABLE IF EXISTS ${identifier};\n${createStatement}\n\n`);
    const [dataRows] = await pool.query<RowDataPacket[]>(`SELECT * FROM ${identifier}`);
    const columns = dataRows[0] ? Object.keys(dataRows[0]).map(escapeIdentifier).join(', ') : '';

    if (columns && dataRows.length > 0) {
      for (const row of dataRows) {
        const values = Object.keys(row).map((column) => escapeValue(row[column])).join(', ');
        chunks.push(`INSERT INTO ${identifier} (${columns}) VALUES (${values});\n`);
      }
      chunks.push('\n');
    }
  }

  chunks.push('SET FOREIGN_KEY_CHECKS=1;\n');
  return chunks.join('');
};

export const saveBackupSnapshot = async (options: { tag?: string; customFilename?: string } = {}) => {
  await ensureBackupsDirectory();
  const sql = await createDatabaseBackup();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tagPart = options.tag ? `_${options.tag}` : '';
  const filename = options.customFilename || `backup_${timestamp}${tagPart}.sql`;
  const filePath = path.join(backupsDirectory, filename);

  await fs.writeFile(filePath, sql, 'utf8');

  // Rotate backups keeping the last 20 backups
  try {
    const files = await fs.readdir(backupsDirectory);
    const sqlFiles = files.filter((f) => f.endsWith('.sql'));
    if (sqlFiles.length > 20) {
      const stats = await Promise.all(
        sqlFiles.map(async (f) => ({
          filename: f,
          path: path.join(backupsDirectory, f),
          mtime: (await fs.stat(path.join(backupsDirectory, f))).mtimeMs,
        }))
      );
      stats.sort((a, b) => b.mtime - a.mtime);
      const toDelete = stats.slice(20);
      for (const item of toDelete) {
        await fs.unlink(item.path).catch(() => {});
      }
    }
  } catch {
    // Ignore rotation error
  }

  return { filename, path: filePath, sizeBytes: Buffer.byteLength(sql, 'utf8') };
};

export interface BackupItem {
  filename: string;
  sizeBytes: number;
  formattedSize: string;
  createdAt: string;
  isSafetySnapshot: boolean;
  isRootFile: boolean;
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

export const listBackups = async (): Promise<BackupItem[]> => {
  await ensureBackupsDirectory();
  const items: BackupItem[] = [];
  const seenFiles = new Set<string>();

  // 1. Scan backups/ folder
  try {
    const backupFiles = await fs.readdir(backupsDirectory);
    for (const file of backupFiles) {
      if (!file.endsWith('.sql')) continue;
      const fullPath = path.join(backupsDirectory, file);
      const stat = await fs.stat(fullPath);
      seenFiles.add(file);
      items.push({
        filename: file,
        sizeBytes: stat.size,
        formattedSize: formatBytes(stat.size),
        createdAt: stat.mtime.toISOString(),
        isSafetySnapshot: file.includes('pre_restore') || file.includes('snapshot'),
        isRootFile: false,
      });
    }
  } catch {
    // Ignore error
  }

  // 2. Scan project root for .sql backups (e.g. backup_*.sql or radar-*.sql)
  try {
    const rootFiles = await fs.readdir(process.cwd());
    for (const file of rootFiles) {
      if (!file.endsWith('.sql') || seenFiles.has(file)) continue;
      const fullPath = path.join(process.cwd(), file);
      const stat = await fs.stat(fullPath);
      if (!stat.isFile()) continue;
      items.push({
        filename: file,
        sizeBytes: stat.size,
        formattedSize: formatBytes(stat.size),
        createdAt: stat.mtime.toISOString(),
        isSafetySnapshot: file.includes('pre_restore') || file.includes('snapshot'),
        isRootFile: true,
      });
    }
  } catch {
    // Ignore error
  }

  // Sort newest first
  return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
};

export const resolveBackupPath = (filename: string): string => {
  const safeName = path.basename(filename);
  if (!safeName.endsWith('.sql')) {
    throw new Error('Solo se permiten archivos con extensión .sql');
  }

  const backupDirFile = path.join(backupsDirectory, safeName);
  const rootDirFile = path.join(process.cwd(), safeName);

  return path.resolve(backupDirFile);
};

export const getBackupFileContent = async (filename: string): Promise<{ sql: string; resolvedPath: string }> => {
  const safeName = path.basename(filename);
  if (!safeName.endsWith('.sql')) {
    throw new Error('Solo se permiten archivos con extensión .sql');
  }

  const inBackupsDir = path.join(backupsDirectory, safeName);
  const inRootDir = path.join(process.cwd(), safeName);

  let targetPath = inBackupsDir;
  try {
    await fs.access(inBackupsDir);
  } catch {
    try {
      await fs.access(inRootDir);
      targetPath = inRootDir;
    } catch {
      throw new Error(`El archivo de respaldo "${safeName}" no existe`);
    }
  }

  const sql = await fs.readFile(targetPath, 'utf8');
  return { sql, resolvedPath: targetPath };
};

export interface RestoreResult {
  ok: boolean;
  message: string;
  restoredTables: string[];
  clearedTables: string[];
  preservedUsersCount: number;
  safetySnapshot?: string;
  durationMs: number;
  timestamp: string;
}

/**
 * Reads all rows currently in the `users` table.
 */
export const fetchCurrentUsers = async (
  connection: { query: (sql: string) => Promise<unknown> }
): Promise<RowDataPacket[]> => {
  try {
    const [userRows] = (await connection.query('SELECT * FROM `users`')) as [RowDataPacket[], unknown];
    return userRows || [];
  } catch {
    return [];
  }
};

/**
 * Wipes/clears all tables in the database except for `users`.
 */
export const clearDatabaseExceptUsers = async (
  connection: { query: (sql: string) => Promise<unknown> }
): Promise<string[]> => {
  const [tableRows] = (await connection.query(
    "SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'"
  )) as [RowDataPacket[], unknown];

  const clearedTables: string[] = [];

  for (const tableRow of tableRows) {
    const tableName = getTableName(tableRow);
    if (tableName.toLowerCase() === 'users') {
      continue; // Preserve users table!
    }

    const identifier = escapeIdentifier(tableName);
    try {
      await connection.query(`TRUNCATE TABLE ${identifier}`);
      clearedTables.push(tableName);
    } catch {
      await connection.query(`DELETE FROM ${identifier}`);
      clearedTables.push(tableName);
    }
  }

  return clearedTables;
};

/**
 * Re-inserts or merges preserved users into the `users` table after restoring SQL statements.
 * This guarantees that current credentials and users are preserved even if the SQL backup dropped or had different users.
 */
export const restorePreservedUsers = async (
  connection: { query: (sql: string) => Promise<unknown> },
  preservedUsers: RowDataPacket[]
): Promise<number> => {
  if (!preservedUsers || preservedUsers.length === 0) return 0;

  const [tableCheck] = (await connection.query("SHOW TABLES LIKE 'users'")) as [RowDataPacket[], unknown];
  if (tableCheck.length === 0) {
    return 0;
  }

  let restoredCount = 0;
  const sample = preservedUsers[0];
  const columns = Object.keys(sample);
  const columnList = columns.map(escapeIdentifier).join(', ');
  const updateClauses = columns
    .filter((c) => c !== 'id' && c !== 'email')
    .map((c) => `${escapeIdentifier(c)} = VALUES(${escapeIdentifier(c)})`)
    .join(', ');

  for (const user of preservedUsers) {
    const values = columns.map((col) => escapeValue(user[col])).join(', ');
    const query = updateClauses
      ? `INSERT INTO \`users\` (${columnList}) VALUES (${values}) ON DUPLICATE KEY UPDATE ${updateClauses};`
      : `INSERT IGNORE INTO \`users\` (${columnList}) VALUES (${values});`;

    try {
      await connection.query(query);
      restoredCount++;
    } catch (err) {
      console.warn(`[Backup Restore] Advertencia al re-insertar usuario ${user.email || user.id}:`, err);
    }
  }

  return restoredCount;
};

export const restoreDatabaseBackup = async (
  sqlContent: string,
  options: { createSafetySnapshot?: boolean; sourceName?: string } = {}
): Promise<RestoreResult> => {
  const trimmedSql = sqlContent.trim();
  if (!trimmedSql) {
    throw new Error('El contenido del archivo SQL está vacío');
  }

  const startTime = Date.now();
  let safetySnapshotName: string | undefined;

  // 1. Create safety snapshot before restoring if requested
  if (options.createSafetySnapshot !== false) {
    try {
      const snapshot = await saveBackupSnapshot({ tag: 'pre_restore' });
      safetySnapshotName = snapshot.filename;
    } catch (snapshotError) {
      console.warn('Advertencia: No se pudo crear el respaldo previo de seguridad:', snapshotError);
    }
  }

  // 2. Dedicated connection with multipleStatements: true
  const connection = await createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'radar_app',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'radar_v3',
    multipleStatements: true,
  });

  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0;');
    await connection.query('SET UNIQUE_CHECKS = 0;');

    // 3. Preserve current users in memory
    const preservedUsers = await fetchCurrentUsers(connection);
    const preservedUsersCount = preservedUsers.length;

    // 4. Wipe / clear all tables in the database except `users`
    const clearedTables = await clearDatabaseExceptUsers(connection);

    // 5. Execute new SQL backup statements into the blank database
    await connection.query(trimmedSql);

    // 6. Guarantee that preserved users exist and are active
    if (preservedUsersCount > 0) {
      await restorePreservedUsers(connection, preservedUsers);
    }

    await connection.query('SET FOREIGN_KEY_CHECKS = 1;');
    await connection.query('SET UNIQUE_CHECKS = 1;');

    const [tableRows] = (await connection.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'")) as [
      RowDataPacket[],
      unknown
    ];
    const restoredTables = tableRows.map((row) => getTableName(row));

    const durationMs = Date.now() - startTime;

    return {
      ok: true,
      message: `Base de datos vaciada (${clearedTables.length} tablas) y restaurada exitosamente (${restoredTables.length} tablas activas, ${preservedUsersCount} usuarios conservados)`,
      restoredTables,
      clearedTables,
      preservedUsersCount,
      safetySnapshot: safetySnapshotName,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  } finally {
    await connection.end();
  }
};

