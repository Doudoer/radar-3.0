import { promises as fs } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { RowDataPacket, createConnection, Pool } from 'mysql2/promise';
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
const uploadsBackupsDirectory = path.resolve(process.cwd(), 'uploads', 'backups');

export const ensureBackupRecordsTable = async () => {
  try {
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
  } catch (err) {
    console.warn('[Backups] Advertencia al verificar/crear tabla system_backup_records:', err);
  }
};

export const ensureBackupsDirectory = async () => {
  await fs.mkdir(backupsDirectory, { recursive: true });
  await fs.mkdir(uploadsBackupsDirectory, { recursive: true });
  await ensureBackupRecordsTable();
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

export const saveBackupSnapshot = async (options: { tag?: string; customFilename?: string } = {}) => {
  const isNestedSnapshot = options.tag === 'pre_restore';
  if (!isNestedSnapshot && !acquireBackupLock()) {
    throw new Error('Una operación de respaldo o restauración ya se encuentra en ejecución');
  }
  try {
    await ensureBackupsDirectory();
    const sql = await createDatabaseBackup();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tagPart = options.tag ? `_${options.tag}` : '';
    const filename = options.customFilename || `backup_${timestamp}${tagPart}.sql`;
    
    const primaryPath = path.join(backupsDirectory, filename);
    const uploadsPath = path.join(uploadsBackupsDirectory, filename);
    const sizeBytes = Buffer.byteLength(sql, 'utf8');
    const backupType = options.tag || 'manual';

    // 1. Dual disk write (both backups/ and uploads/backups/)
    await fs.writeFile(primaryPath, sql, 'utf8');
    try {
      await fs.writeFile(uploadsPath, sql, 'utf8');
    } catch {
      // ignore
    }

    // 2. Compress with gzip and store in uploads/backups/
    const gzippedBuffer = zlib.gzipSync(Buffer.from(sql, 'utf8'));
    try {
      await fs.writeFile(path.join(uploadsBackupsDirectory, `${filename}.gz`), gzippedBuffer);
    } catch {
      // ignore
    }

    // 3. Persist record and compressed blob in MySQL system_backup_records table
    try {
      await pool.query(
        `INSERT INTO system_backup_records (filename, file_path, size_bytes, backup_type, created_at, content_compressed)
         VALUES (?, ?, ?, ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE file_path=VALUES(file_path), size_bytes=VALUES(size_bytes), content_compressed=VALUES(content_compressed)`,
        [filename, primaryPath, sizeBytes, backupType, gzippedBuffer]
      );
    } catch (dbErr) {
      console.warn('⚠️ No se pudo registrar el respaldo en la tabla MySQL system_backup_records:', dbErr);
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
    if (!isNestedSnapshot) {
      releaseBackupLock();
    }
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
  } catch {
    // ignore
  }
};

export const ensureBackupFileOnDisk = async (filename: string): Promise<string | null> => {
  const safeName = path.basename(filename);
  const primaryPath = path.join(backupsDirectory, safeName);
  const uploadsPath = path.join(uploadsBackupsDirectory, safeName);
  const rootPath = path.join(process.cwd(), safeName);

  for (const p of [primaryPath, uploadsPath, rootPath]) {
    try {
      await fs.access(p);
      return p;
    } catch {}
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
  } catch (err) {
    console.warn(`[ensureBackupFileOnDisk] Error materializing backup from DB for ${safeName}:`, err);
  }

  return null;
};

export const listBackups = async (): Promise<BackupItem[]> => {
  await ensureBackupsDirectory();
  const items: BackupItem[] = [];
  const seenFiles = new Set<string>();

  // 1. Query records from MySQL table system_backup_records
  try {
    const [dbRows] = await pool.query<RowDataPacket[]>(
      'SELECT id, filename, file_path, size_bytes, backup_type, created_at, (content_compressed IS NOT NULL) AS has_blob FROM system_backup_records ORDER BY created_at DESC'
    );

    for (const row of dbRows) {
      const filename = String(row.filename);
      seenFiles.add(filename);

      const primaryPath = path.join(backupsDirectory, filename);
      const uploadsPath = path.join(uploadsBackupsDirectory, filename);
      let fileExistsOnDisk = false;

      try {
        await fs.access(primaryPath);
        fileExistsOnDisk = true;
      } catch {
        try {
          await fs.access(uploadsPath);
          fileExistsOnDisk = true;
        } catch {
          fileExistsOnDisk = false;
        }
      }

      // If missing from disk (e.g. container was destroyed & restarted), re-materialize from DB blob!
      if (!fileExistsOnDisk && row.has_blob) {
        try {
          const [blobRows] = await pool.query<RowDataPacket[]>(
            'SELECT content_compressed FROM system_backup_records WHERE filename = ?',
            [filename]
          );
          const compressed = blobRows[0]?.content_compressed as Buffer | undefined;
          if (compressed && Buffer.isBuffer(compressed)) {
            const decompressed = zlib.gunzipSync(compressed).toString('utf8');
            await fs.writeFile(primaryPath, decompressed, 'utf8').catch(() => {});
            await fs.writeFile(uploadsPath, decompressed, 'utf8').catch(() => {});
            fileExistsOnDisk = true;
          }
        } catch (restoreErr) {
          console.warn(`[Backups] No se pudo re-materializar archivo ${filename} desde DB:`, restoreErr);
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
  } catch (err) {
    console.warn('Advertencia al consultar system_backup_records:', err);
  }

  // 2. Scan backups/ folder
  try {
    const backupFiles = await fs.readdir(backupsDirectory);
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

      syncFileToDb(file, fullPath, stat.size, stat.mtime).catch(() => {});
    }
  } catch {
    // Ignore error
  }

  // 3. Scan uploads/backups/ folder
  try {
    const uploadFiles = await fs.readdir(uploadsBackupsDirectory);
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

      syncFileToDb(file, fullPath, stat.size, stat.mtime).catch(() => {});
    }
  } catch {
    // Ignore error
  }

  // 4. Scan project root for .sql backups (e.g. backup_*.sql or radar-*.sql)
  try {
    const rootFiles = await fs.readdir(process.cwd());
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

      syncFileToDb(file, fullPath, stat.size, stat.mtime).catch(() => {});
    }
  } catch {
    // Ignore error
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

export const restoreDatabaseBackup = async (
  sqlContent: string,
  options: { createSafetySnapshot?: boolean; sourceName?: string } = {}
): Promise<RestoreResult> => {
  const trimmedSql = sqlContent.trim();
  if (!trimmedSql) {
    throw new Error('El contenido del archivo SQL está vacío');
  }

  if (!acquireBackupLock()) {
    throw new Error('Una operación de respaldo o restauración ya se encuentra en ejecución');
  }

  let connection: any = null;
  try {
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
    connection = await createConnection({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'radar_app',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'radar_v3',
      multipleStatements: true,
    });

    await connection.query('SET FOREIGN_KEY_CHECKS = 0;');
    await connection.query('SET UNIQUE_CHECKS = 0;');

    // 3. Preserve current users, inventory and backup records in memory before restoring
    const preservedUsers = await fetchCurrentUsers(connection);
    const preservedUsersCount = preservedUsers.length;

    const preservedInventoryParts = await fetchCurrentInventoryParts(connection);
    const preservedInventoryCount = preservedInventoryParts.length;

    const preservedBackupRecords = await fetchCurrentBackupRecords(connection);

    // 4. Wipe / clear all tables in the database except preserved tables (users, inventory_parts, system_backup_records)
    const clearedTables = await clearDatabaseExceptUsers(connection);

    // 5. Execute new SQL backup statements into the blank database
    await connection.query(trimmedSql);

    // 6. Guarantee that preserved users exist and are active
    if (preservedUsersCount > 0) {
      await restorePreservedUsers(connection, preservedUsers);
    }

    // 7. Guarantee that preserved inventory parts exist and are restored
    if (preservedInventoryCount > 0) {
      await restorePreservedInventoryParts(connection, preservedInventoryParts);
    } else {
      await ensureInventoryPartsTable(connection);
    }

    // 8. Guarantee that backup records exist and are restored
    if (preservedBackupRecords.length > 0) {
      await restorePreservedBackupRecords(connection, preservedBackupRecords);
    } else {
      await ensureBackupRecordsTable();
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
      message: `Base de datos restaurada exitosamente (${clearedTables.length} tablas operativas vaciadas, ${restoredTables.length} tablas activas, ${preservedUsersCount} usuarios conservados, ${preservedInventoryCount} piezas de inventario conservadas)`,
      restoredTables,
      clearedTables,
      preservedUsersCount,
      preservedInventoryCount,
      safetySnapshot: safetySnapshotName,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  } finally {
    if (connection) {
      await connection.end().catch(() => {});
    }
    releaseBackupLock();
  }
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
      if (hour === '03' && minute === '00' && lastDispatchedDate !== todayStr) {
        lastDispatchedDate = todayStr;
        console.log(`[Daily Backup Scheduler] ⏰ Ejecutando respaldo automático diario (03:00 AM Eastern Time)...`);
        const result = await saveBackupSnapshot({ tag: 'cron_daily' });
        console.log(`[Daily Backup Scheduler] ✅ Respaldo generado: ${result.filename} (${result.sizeBytes} bytes)`);

        const appBaseUrl = (process.env.APP_URL && !process.env.APP_URL.includes('radar-rsy.site') && !process.env.APP_URL.includes('localhost'))
          ? process.env.APP_URL.replace(/\/+$/, '')
          : 'https://radar-rsy.store';

        const backupDownloadUrl = `${appBaseUrl}/api/uploads/backups/${result.filename}`;

        try {
          const { formatRespaldoAutomaticoMessage } = await import('../integrations/wasender/notificationTemplates');
          const { dispatchSystemNotification } = await import('../integrations/wasender/notificationService');
          const backupMsg = formatRespaldoAutomaticoMessage({ downloadUrl: backupDownloadUrl });
          await dispatchSystemNotification(poolInstance, wasenderInstance, 'RESPALDO_AUTOMATICO', backupMsg);
          console.log(`[Daily Backup Scheduler] 📱 Notificación de respaldo automático despachada a Super Admin.`);
        } catch (notifErr) {
          console.warn('[Daily Backup Scheduler] ⚠️ No se pudo enviar notificación de respaldo:', notifErr);
        }
      }
    } catch (err) {
      console.error('[Daily Backup Scheduler] Error al ejecutar respaldo programado:', err);
    }
  };

  const interval = setInterval(checkAndRun, 30_000);
  return interval;
};

