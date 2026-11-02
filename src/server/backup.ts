import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runScheduledJob } from './scheduledJobs';
import zlib from 'node:zlib';
import { RowDataPacket, Pool } from 'mysql2/promise';
import { pool } from './config';

const escapeIdentifier = (value: string) => `\`${value.replace(/`/g, '``')}\``;

const escapeValue = (value: unknown) => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') throw new Error('No se puede respaldar un número no finito');
  if (value instanceof Date && !Number.isFinite(value.getTime())) {
    throw new Error('No se puede respaldar una fecha inválida');
  }

  const text = Buffer.isBuffer(value)
    ? `x'${value.toString('hex')}'`
    : (value instanceof Date
      ? value.toISOString().slice(0, 23).replace('T', ' ')
      : typeof value === 'object' ? JSON.stringify(value) : String(value))
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
const uploadsBackupsDirectory = path.resolve(process.cwd(), 'uploads', 'backups');

export const ensureBackupRecordsTable = async () => {
  await pool.query(`
      CREATE TABLE IF NOT EXISTS system_backup_records (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        filename VARCHAR(150) NOT NULL UNIQUE,
        file_path VARCHAR(255) NOT NULL,
        size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
        backup_type VARCHAR(40) NOT NULL DEFAULT 'manual',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        content_compressed LONGBLOB NULL,
        INDEX system_backup_created_idx (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
};

export const ensureBackupsDirectory = async () => {
  await fs.mkdir(backupsDirectory, { recursive: true });
  await fs.mkdir(uploadsBackupsDirectory, { recursive: true });
};

export const createDatabaseBackup = async (): Promise<string> => {
  const connection = await pool.getConnection();
  let originalTimezone: string | undefined;
  let reusable = true;
  try {
    const [sessionRows] = await connection.query<RowDataPacket[]>('SELECT @@session.time_zone AS time_zone');
    originalTimezone = String(sessionRows[0].time_zone);
    await connection.query("SET time_zone = '+00:00'");
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    const [tableRows] = await connection.query<RowDataPacket[]>(
      "SELECT TABLE_NAME AS table_name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
    );
    if (tableRows.length === 0) throw new Error('No se encontraron tablas para respaldar');
    for (const row of tableRows) {
      if (String(row.engine).toLowerCase() !== 'innodb') {
        throw new Error(`Snapshot consistente no soportado para tabla ${row.table_name} (${row.engine})`);
      }
    }
    const chunks = [
      '-- Radar 3.0 database backup\n',
      `-- Generated: ${new Date().toISOString()}\n`,
      '-- Snapshot de datos InnoDB; no ejecutar migraciones DDL durante la exportación.\n',
      "SET NAMES utf8mb4;\nSET @RADAR_OLD_TIME_ZONE=@@TIME_ZONE;\nSET TIME_ZONE='+00:00';\n",
      "SET @RADAR_OLD_SQL_MODE=@@SQL_MODE;\nSET FOREIGN_KEY_CHECKS=0;\nSET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\n\n",
    ];

    for (const tableRow of tableRows) {
      const tableName = String(tableRow.table_name);
      const identifier = escapeIdentifier(tableName);
      const [createRows] = await connection.query<RowDataPacket[]>(`SHOW CREATE TABLE ${identifier}`);
      const ddl = createRows[0]?.['Create Table'];
      if (typeof ddl !== 'string' || !ddl.trim()) throw new Error(`No se pudo respaldar el esquema de ${tableName}`);
      const createStatement = ddl.replace(/;?$/, ';');

      chunks.push(`DROP TABLE IF EXISTS ${identifier};\n${createStatement}\n\n`);
      // Keep the catalogue schema, not previous dumps (which recursively contain more dumps).
      if (tableName.toLowerCase() === 'system_backup_records') continue;
      const [columnRows] = await connection.query<RowDataPacket[]>(`SHOW FULL COLUMNS FROM ${identifier}`);
      const columnNames = columnRows
        .filter((column) => !/\b(VIRTUAL|STORED|PERSISTENT)\s+GENERATED\b/i.test(String(column.Extra)))
        .map((column) => String(column.Field));
      if (!columnNames.length) throw new Error(`No hay columnas exportables en ${tableName}`);
      const columns = columnNames.map(escapeIdentifier).join(', ');
      const [dataRows] = await connection.query<RowDataPacket[]>({
        sql: `SELECT ${columns} FROM ${identifier}`,
        // Avoid timezone conversion, truncated microseconds and unsafe BIGINT rounding by the driver.
        typeCast: (field, next) => ['DATE', 'NEWDATE', 'DATETIME', 'TIMESTAMP', 'JSON', 'LONGLONG', 'NEWDECIMAL']
          .includes(field.type) ? field.string() : next(),
      });

      if (dataRows.length > 0) {
        for (const row of dataRows) {
          const values = columnNames.map((column) => escapeValue(row[column])).join(', ');
          chunks.push(`INSERT INTO ${identifier} (${columns}) VALUES (${values});\n`);
        }
        chunks.push('\n');
      }
    }

    chunks.push('SET FOREIGN_KEY_CHECKS=1;\nSET TIME_ZONE=@RADAR_OLD_TIME_ZONE;\nSET SQL_MODE=@RADAR_OLD_SQL_MODE;\n');
    await connection.commit();
    return chunks.join('');
  } finally {
    try {
      await connection.rollback();
      if (originalTimezone !== undefined) await connection.query('SET time_zone = ?', [originalTimezone]);
    } catch {
      reusable = false;
      connection.destroy();
    }
    if (reusable) connection.release();
  }
};

let isBackupOperationInProgress = false;

export const acquireBackupLock = (): boolean => {
  if (isBackupOperationInProgress) return false;
  isBackupOperationInProgress = true;
  return true;
};

export const releaseBackupLock = (): void => {
  isBackupOperationInProgress = false;
};

export const isBackupLocked = (): boolean => isBackupOperationInProgress;

const writeBackupFile = async (filename: string, content: string | Buffer) => {
  const pendingPath = `${filename}.partial`;
  try {
    await fs.writeFile(pendingPath, content, { mode: 0o600, flag: 'wx' });
    // Publishing a hard link is atomic and refuses to overwrite an existing backup.
    await fs.link(pendingPath, filename);
  } finally {
    await fs.unlink(pendingPath).catch(() => {});
  }
};

export const saveBackupSnapshot = async (options: { tag?: string; customFilename?: string } = {}) => {
  if (!acquireBackupLock()) {
    throw new Error('Una operación de respaldo o restauración ya se encuentra en ejecución');
  }
  try {
    await ensureBackupsDirectory();
    const sql = await createDatabaseBackup();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tagPart = options.tag ? `_${options.tag}` : '';
    const filename = options.customFilename || `backup_${timestamp}${tagPart}.sql`;
    if (filename !== path.basename(filename) || !/^[a-zA-Z0-9_.-]+\.sql$/.test(filename)) {
      throw new Error('Nombre de respaldo inválido');
    }
    
    const primaryPath = path.join(backupsDirectory, filename);
    const uploadsPath = path.join(uploadsBackupsDirectory, filename);
    const sizeBytes = Buffer.byteLength(sql, 'utf8');
    const backupType = options.tag || 'manual';

    // 1. Dual disk write (both backups/ and uploads/backups/)
    await writeBackupFile(primaryPath, sql);
    await writeBackupFile(uploadsPath, sql);

    // 2. Compress with gzip and store in uploads/backups/
    const gzippedBuffer = zlib.gzipSync(Buffer.from(sql, 'utf8'));
    await writeBackupFile(path.join(uploadsBackupsDirectory, `${filename}.gz`), gzippedBuffer);

    // 3. Persist record and compressed blob in MySQL system_backup_records table
    try {
      await pool.query(
        `INSERT INTO system_backup_records (filename, file_path, size_bytes, backup_type, created_at, content_compressed)
         VALUES (?, ?, ?, ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE file_path=VALUES(file_path), size_bytes=VALUES(size_bytes), content_compressed=VALUES(content_compressed)`,
        [filename, primaryPath, sizeBytes, backupType, gzippedBuffer]
      );
    } catch (dbErr) {
      throw new Error('El respaldo no se completó: no se pudo registrar la copia en MySQL', { cause: dbErr });
    }

    // 4. Rotate backups keeping the last 50 backups on disk
    try {
      const files = await fs.readdir(backupsDirectory);
      const sqlFiles = files.filter((f) => f.endsWith('.sql'));
      if (sqlFiles.length > 50) {
        const stats = await Promise.all(
          sqlFiles.map(async (f) => ({
            filename: f,
            path: path.join(backupsDirectory, f),
            mtime: (await fs.stat(path.join(backupsDirectory, f))).mtimeMs,
          }))
        );
        stats.sort((a, b) => b.mtime - a.mtime);
        const toDelete = stats.slice(50);
        for (const item of toDelete) {
          await fs.unlink(item.path).catch(() => {});
        }
      }
    } catch {
      // Ignore rotation error
    }

    return { filename, path: primaryPath, sizeBytes };
  } finally {
    releaseBackupLock();
  }
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

const syncFileToDb = async (filename: string, fullPath: string, size: number, mtime: Date) => {
  try {
    let gzippedBuffer: Buffer | null = null;
    if (filename.endsWith('.sql')) {
      const content = await fs.readFile(fullPath, 'utf8');
      gzippedBuffer = zlib.gzipSync(Buffer.from(content, 'utf8'));
    } else if (filename.endsWith('.gz')) {
      gzippedBuffer = await fs.readFile(fullPath);
    }
    await pool.query(
      `INSERT IGNORE INTO system_backup_records (filename, file_path, size_bytes, backup_type, created_at, content_compressed)
       VALUES (?, ?, ?, 'imported', ?, ?)`,
      [filename, fullPath, size, mtime, gzippedBuffer]
    );
  } catch (error) {
    throw new Error(`No se pudo sincronizar el catálogo del respaldo ${filename}`, { cause: error });
  }
};

const isMissingFile = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

const backupFileExists = async (filename: string): Promise<boolean> => {
  try {
    await fs.access(filename);
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
};

const readBackupDirectory = async (directory: string): Promise<string[]> => {
  try {
    return await fs.readdir(directory);
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
};

export const ensureBackupFileOnDisk = async (filename: string): Promise<string | null> => {
  const safeName = path.basename(filename);
  const primaryPath = path.join(backupsDirectory, safeName);
  const uploadsPath = path.join(uploadsBackupsDirectory, safeName);
  const rootPath = path.join(process.cwd(), safeName);

  for (const p of [primaryPath, uploadsPath, rootPath]) {
    if (await backupFileExists(p)) return p;
  }

  // Check in MySQL system_backup_records
  try {
    const baseLookup = safeName.replace(/\.gz$/, '');
    const [blobRows] = await pool.query<RowDataPacket[]>(
      'SELECT filename, content_compressed FROM system_backup_records WHERE filename = ? OR filename = ? LIMIT 1',
      [safeName, baseLookup]
    );
    const row = blobRows[0];
    if (row && row.content_compressed && Buffer.isBuffer(row.content_compressed)) {
      await ensureBackupsDirectory();
      if (safeName.endsWith('.gz')) {
        await fs.writeFile(uploadsPath, row.content_compressed);
        return uploadsPath;
      } else {
        const decompressed = zlib.gunzipSync(row.content_compressed).toString('utf8');
        await fs.writeFile(primaryPath, decompressed, 'utf8');
        await fs.writeFile(uploadsPath, decompressed, 'utf8');
        return primaryPath;
      }
    }
  } catch (error) {
    throw new Error(`No se pudo recuperar el respaldo ${safeName} desde el catálogo`, { cause: error });
  }

  return null;
};

export const listBackups = async (): Promise<BackupItem[]> => {
  await ensureBackupsDirectory();
  const items: BackupItem[] = [];
  const seenFiles = new Set<string>();

  // 1. Query records from MySQL table system_backup_records
    const [dbRows] = await pool.query<RowDataPacket[]>(
      'SELECT id, filename, file_path, size_bytes, backup_type, created_at, (content_compressed IS NOT NULL) AS has_blob FROM system_backup_records ORDER BY created_at DESC'
    );

    for (const row of dbRows) {
      const filename = String(row.filename);
      seenFiles.add(filename);

      const primaryPath = path.join(backupsDirectory, filename);
      const uploadsPath = path.join(uploadsBackupsDirectory, filename);
      const fileExistsOnDisk = await backupFileExists(primaryPath) || await backupFileExists(uploadsPath);

      // If missing from disk (e.g. container was destroyed & restarted), re-materialize from DB blob!
      if (!fileExistsOnDisk && row.has_blob) {
        const materialized = await ensureBackupFileOnDisk(filename);
        if (!materialized) {
          throw new Error(`El catálogo no pudo recuperar el respaldo ${filename}`);
        }
      }

      const size = Number(row.size_bytes) || 0;
      items.push({
        filename,
        sizeBytes: size,
        formattedSize: formatBytes(size),
        createdAt: new Date(row.created_at).toISOString(),
        isSafetySnapshot: filename.includes('pre_restore') || filename.includes('snapshot'),
        isRootFile: false,
      });
    }

  // 2. Scan backups/ folder
    const backupFiles = await readBackupDirectory(backupsDirectory);
    for (const file of backupFiles) {
      if (!file.endsWith('.sql') && !file.endsWith('.sql.gz')) continue;
      if (seenFiles.has(file)) continue;
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

      await syncFileToDb(file, fullPath, stat.size, stat.mtime);
    }

  // 3. Scan uploads/backups/ folder
    const uploadFiles = await readBackupDirectory(uploadsBackupsDirectory);
    for (const file of uploadFiles) {
      if (!file.endsWith('.sql') && !file.endsWith('.sql.gz')) continue;
      if (seenFiles.has(file)) continue;
      const fullPath = path.join(uploadsBackupsDirectory, file);
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

      await syncFileToDb(file, fullPath, stat.size, stat.mtime);
    }

  // 4. Scan project root for .sql backups (e.g. backup_*.sql or radar-*.sql)
    const rootFiles = await readBackupDirectory(process.cwd());
    for (const file of rootFiles) {
      if (!file.endsWith('.sql') || seenFiles.has(file)) continue;
      const fullPath = path.join(process.cwd(), file);
      const stat = await fs.stat(fullPath);
      if (!stat.isFile()) continue;
      seenFiles.add(file);
      items.push({
        filename: file,
        sizeBytes: stat.size,
        formattedSize: formatBytes(stat.size),
        createdAt: stat.mtime.toISOString(),
        isSafetySnapshot: file.includes('pre_restore') || file.includes('snapshot'),
        isRootFile: true,
      });

      await syncFileToDb(file, fullPath, stat.size, stat.mtime);
    }

  // Sort newest first
  return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
};

export const resolveBackupPath = (filename: string): string => {
  const safeName = path.basename(filename);
  if (!safeName.endsWith('.sql') && !safeName.endsWith('.sql.gz')) {
    throw new Error('Solo se permiten archivos con extensión .sql o .sql.gz');
  }

  const inBackups = path.join(backupsDirectory, safeName);
  const inUploads = path.join(uploadsBackupsDirectory, safeName);
  const inRoot = path.join(process.cwd(), safeName);

  return path.resolve(inBackups);
};

export const getBackupFileContent = async (filename: string): Promise<{ sql: string; resolvedPath: string }> => {
  const safeName = path.basename(filename);
  if (!safeName.endsWith('.sql') && !safeName.endsWith('.sql.gz')) {
    throw new Error('Solo se permiten archivos con extensión .sql o .sql.gz');
  }

  const diskPath = await ensureBackupFileOnDisk(safeName);
  if (!diskPath) {
    throw new Error(`El archivo de respaldo "${safeName}" no existe`);
  }

  if (diskPath.endsWith('.gz')) {
    const raw = await fs.readFile(diskPath);
    const sql = zlib.gunzipSync(raw).toString('utf8');
    return { sql, resolvedPath: diskPath };
  }

  const sql = await fs.readFile(diskPath, 'utf8');
  return { sql, resolvedPath: diskPath };
};

export interface RestoreResult {
  ok: boolean;
  message: string;
  restoredTables: string[];
  clearedTables: string[];
  preservedUsersCount: number;
  preservedInventoryCount: number;
  safetySnapshot?: string;
  durationMs: number;
  timestamp: string;
}

const PRESERVED_TABLES = new Set(['users', 'inventory_parts', 'system_backup_records']);

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
 * Reads all rows currently in the `inventory_parts` table.
 */
export const fetchCurrentInventoryParts = async (
  connection: { query: (sql: string) => Promise<unknown> }
): Promise<RowDataPacket[]> => {
  try {
    const [tableCheck] = (await connection.query(
      "SHOW TABLES LIKE 'inventory_parts'"
    )) as [RowDataPacket[], unknown];
    if (tableCheck.length === 0) {
      return [];
    }
    const [rows] = (await connection.query('SELECT * FROM `inventory_parts`')) as [RowDataPacket[], unknown];
    return rows || [];
  } catch {
    return [];
  }
};

/**
 * Wipes/clears all tables in the database except for preserved tables (`users` and `inventory_parts`).
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
    if (PRESERVED_TABLES.has(tableName.toLowerCase())) {
      continue; // Preserve users and inventory_parts tables!
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

export const clearDatabaseExceptPreserved = clearDatabaseExceptUsers;

/**
 * Reads all rows currently in the `system_backup_records` table.
 */
export const fetchCurrentBackupRecords = async (
  connection: { query: (sql: string) => Promise<unknown> }
): Promise<RowDataPacket[]> => {
  try {
    const [tableCheck] = (await connection.query(
      "SHOW TABLES LIKE 'system_backup_records'"
    )) as [RowDataPacket[], unknown];
    if (tableCheck.length === 0) return [];
    const [rows] = (await connection.query('SELECT * FROM `system_backup_records`')) as [RowDataPacket[], unknown];
    return rows || [];
  } catch {
    return [];
  }
};

/**
 * Re-inserts or merges preserved backup records into `system_backup_records` table.
 */
export const restorePreservedBackupRecords = async (
  connection: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  records: RowDataPacket[]
): Promise<number> => {
  if (!records || records.length === 0) return 0;
  let count = 0;
  for (const r of records) {
    try {
      await connection.query(
        `INSERT INTO \`system_backup_records\` (\`id\`, \`filename\`, \`file_path\`, \`size_bytes\`, \`backup_type\`, \`created_at\`, \`content_compressed\`)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE \`file_path\` = VALUES(\`file_path\`), \`size_bytes\` = VALUES(\`size_bytes\`), \`content_compressed\` = VALUES(\`content_compressed\`);`,
        [r.id, r.filename, r.file_path, r.size_bytes, r.backup_type, r.created_at, r.content_compressed]
      );
      count++;
    } catch {
      // ignore
    }
  }
  return count;
};

/**
 * Ensures the `inventory_parts` table structure and schema exist.
 */
export const ensureInventoryPartsTable = async (
  connection: { query: (sql: string) => Promise<unknown> }
): Promise<void> => {
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`inventory_parts\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`year\` VARCHAR(50) NOT NULL,
        \`year_from\` VARCHAR(50) NULL,
        \`year_to\` VARCHAR(50) NULL,
        \`is_exact_year_only\` TINYINT(1) NOT NULL DEFAULT 0,
        \`brand\` VARCHAR(100) NOT NULL,
        \`model\` VARCHAR(100) NOT NULL,
        \`part_type\` VARCHAR(50) NOT NULL DEFAULT 'Motor',
        \`vin\` VARCHAR(50) NULL,
        \`pallet_number\` VARCHAR(50) NULL,
        \`tag_code\` VARCHAR(80) NULL,
        \`engine_specs\` VARCHAR(150) NULL,
        \`held_for\` VARCHAR(200) NULL,
        \`held_by\` VARCHAR(150) NULL,
        \`hold_until\` DATE NULL,
        \`tag_date\` VARCHAR(50) NULL,
        \`status\` VARCHAR(40) NOT NULL DEFAULT 'disponible',
        \`price\` DECIMAL(12,2) NOT NULL DEFAULT 0,
        \`cost\` DECIMAL(12,2) NOT NULL DEFAULT 0,
        \`location\` VARCHAR(150) NULL,
        \`photo_url\` TEXT NULL,
        \`notes\` TEXT NULL,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        \`sold_at\` TIMESTAMP NULL DEFAULT NULL,
        \`deleted_at\` TIMESTAMP NULL DEFAULT NULL,
        INDEX inventory_parts_status (\`status\`),
        INDEX inventory_parts_brand_model (\`brand\`, \`model\`),
        INDEX inventory_parts_vin (\`vin\`),
        INDEX inventory_parts_pallet (\`pallet_number\`),
        INDEX inventory_parts_deleted (\`deleted_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    try {
      const [cols] = (await connection.query('SHOW COLUMNS FROM `inventory_parts` LIKE "year_from"')) as [
        RowDataPacket[],
        unknown
      ];
      if (cols.length === 0) {
        await connection.query('ALTER TABLE `inventory_parts` ADD COLUMN `year_from` VARCHAR(50) NULL AFTER `year`');
        await connection.query('ALTER TABLE `inventory_parts` ADD COLUMN `year_to` VARCHAR(50) NULL AFTER `year_from`');
        await connection.query('ALTER TABLE `inventory_parts` ADD COLUMN `is_exact_year_only` TINYINT(1) NOT NULL DEFAULT 0 AFTER `year_to`');
      }
    } catch {
      // Table may have already been created with columns
    }

    try {
      const [soldCols] = (await connection.query('SHOW COLUMNS FROM `inventory_parts` LIKE "sold_at"')) as [
        RowDataPacket[],
        unknown
      ];
      if (soldCols.length === 0) {
        await connection.query('ALTER TABLE `inventory_parts` ADD COLUMN `sold_at` TIMESTAMP NULL DEFAULT NULL AFTER `updated_at`');
      }
    } catch {
      // Table may have already been created with columns
    }
  } catch (error) {
    console.warn('[Backup Restore] Advertencia al verificar/crear tabla inventory_parts:', error);
  }
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

/**
 * Re-inserts or merges preserved inventory parts into the `inventory_parts` table after restoring SQL statements.
 * This guarantees that existing inventory is never lost even if the SQL backup dropped the table or did not have inventory data.
 */
export const restorePreservedInventoryParts = async (
  connection: { query: (sql: string) => Promise<unknown> },
  preservedParts: RowDataPacket[]
): Promise<number> => {
  if (!preservedParts || preservedParts.length === 0) return 0;

  await ensureInventoryPartsTable(connection);

  const [tableCheck] = (await connection.query("SHOW TABLES LIKE 'inventory_parts'")) as [RowDataPacket[], unknown];
  if (tableCheck.length === 0) {
    return 0;
  }

  let restoredCount = 0;
  for (const part of preservedParts) {
    const columns = Object.keys(part);
    const columnList = columns.map(escapeIdentifier).join(', ');
    const updateClauses = columns
      .filter((c) => c !== 'id')
      .map((c) => `${escapeIdentifier(c)} = VALUES(${escapeIdentifier(c)})`)
      .join(', ');

    const values = columns.map((col) => escapeValue(part[col])).join(', ');
    const query = updateClauses
      ? `INSERT INTO \`inventory_parts\` (${columnList}) VALUES (${values}) ON DUPLICATE KEY UPDATE ${updateClauses};`
      : `INSERT IGNORE INTO \`inventory_parts\` (${columnList}) VALUES (${values});`;

    try {
      await connection.query(query);
      restoredCount++;
    } catch (err) {
      console.warn(`[Backup Restore] Advertencia al re-insertar pieza de inventario #${part.id}:`, err);
    }
  }

  return restoredCount;
};

export class RestoreDisabledError extends Error {
  readonly statusCode = 409;
  readonly code = 'RESTORE_DISABLED';

  constructor() {
    super('Restauración deshabilitada: requiere una base staging aislada, validación y un procedimiento de cambio/rollback verificado. La base activa no fue modificada.');
    this.name = 'RestoreDisabledError';
  }
}

export const restoreDatabaseBackup = async (
  _sqlContent: string,
  _options: { createSafetySnapshot?: boolean; sourceName?: string } = {}
): Promise<RestoreResult> => {
  throw new RestoreDisabledError();
};

/**
 * Starts a background scheduler checking every 30s to dispatch the Daily Automatic Database Backup at 03:00 AM (Eastern Time).
 */
export const startDailyBackupScheduler = (
  poolInstance: Pool,
  wasenderInstance: any
): NodeJS.Timeout => {
  let lastDispatchedDate = '';

  const checkAndRun = async () => {
    try {
      const now = new Date();
      // Format in America/New_York (North Carolina / Eastern Time)
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const parts = formatter.formatToParts(now);
      const hour = parts.find((p) => p.type === 'hour')?.value;
      const minute = parts.find((p) => p.type === 'minute')?.value;
      const year = parts.find((p) => p.type === 'year')?.value;
      const month = parts.find((p) => p.type === 'month')?.value;
      const day = parts.find((p) => p.type === 'day')?.value;

      const todayStr = `${year}-${month}-${day}`;

      // Run daily at 03:00 AM (Eastern Time)
      if (Number(hour) >= 3 && lastDispatchedDate !== todayStr) {
        await runScheduledJob(poolInstance, `daily-backup:${todayStr}`, async () => {
        console.log(`[Daily Backup Scheduler] ⏰ Ejecutando respaldo automático diario (03:00 AM Eastern Time)...`);
        const result = await saveBackupSnapshot({ tag: 'cron_daily' });
        console.log(`[Daily Backup Scheduler] ✅ Respaldo generado: ${result.filename} (${result.sizeBytes} bytes)`);

        const appBaseUrl = (process.env.APP_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');

        const backupDownloadUrl = `${appBaseUrl}/api/uploads/backups/${result.filename}`;

        try {
          const { formatRespaldoAutomaticoMessage } = await import('../integrations/wasender/notificationTemplates');
          const { dispatchSystemNotification } = await import('../integrations/wasender/notificationService');
          const backupMsg = formatRespaldoAutomaticoMessage({ downloadUrl: backupDownloadUrl });
          const delivery = await dispatchSystemNotification(poolInstance, wasenderInstance, 'RESPALDO_AUTOMATICO', backupMsg);
          console.log(`[Daily Backup Scheduler] Notificación: ${delivery.dispatchedCount} entregas; ${delivery.skippedReason || 'procesada'}`);
        } catch (notifErr) {
          console.warn('[Daily Backup Scheduler] ⚠️ No se pudo enviar notificación de respaldo:', notifErr);
        }
        });
        lastDispatchedDate = todayStr;
      }
    } catch (err) {
      console.error('[Daily Backup Scheduler] Error al ejecutar respaldo programado:', err);
    }
  };

  const interval = setInterval(checkAndRun, 30_000);
  return interval;
};
