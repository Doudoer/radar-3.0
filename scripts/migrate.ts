import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { pool } from '../src/server/config';
import { ensureAuditTable } from '../src/server/audit';
import { ensureNotificationTables } from '../src/integrations/wasender/notificationService';
import { ensureBackupRecordsTable } from '../src/server/backup';

const database = process.env.DB_NAME || 'radar_v3';
const migrationsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

const connectionOptions = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'radar_app',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true,
};

const run = async () => {
  const bootstrap = await mysql.createConnection(connectionOptions);
  await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${database.replace(/`/g, '``')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await bootstrap.end();

  const connection = await mysql.createConnection({ ...connectionOptions, database });
  try {
    const [lock] = await connection.query<mysql.RowDataPacket[]>("SELECT GET_LOCK('radar-schema-migrations', 30) AS acquired");
    if (Number(lock[0].acquired) !== 1) throw new Error('Otro proceso está ejecutando migraciones');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const files = (await fs.readdir(migrationsDirectory)).filter((file) => file.endsWith('.sql')).sort();
    const [rows] = await connection.query<mysql.RowDataPacket[]>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((row) => String(row.name)));
    if (process.argv.includes('--baseline-legacy')) {
      if (applied.size) throw new Error('El baseline solo se permite cuando no existen migraciones registradas');
      const [columns] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME IN ('orders','customers','refund_requests','inventory_parts','order_delivery_followups')",
        [database],
      );
      const present = new Set(columns.map(row => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));
      for (const required of ['orders.customer_language','orders.is_yard_sale','customers.language','refund_requests.order_id','inventory_parts.sold_at','order_delivery_followups.contact_channel']) {
        if (!present.has(required)) throw new Error(`Esquema legacy no reconocido: falta ${required}`);
      }
      for (const file of files.filter(name => name < '018_')) {
        await connection.execute('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
        applied.add(file);
      }
      console.log('Baseline legacy registrado explícitamente; no se modificaron datos históricos');
    }

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await fs.readFile(path.join(migrationsDirectory, file), 'utf8');
      await connection.query(sql);
      await connection.execute('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      console.log(`Applied ${file}`);
    }

    await ensureAuditTable(pool);
    await ensureNotificationTables(pool);
    await ensureBackupRecordsTable();
    console.log(files.length === applied.size ? 'Database is up to date' : 'Migrations complete');
  } finally {
    await connection.query("SELECT RELEASE_LOCK('radar-schema-migrations')");
    await connection.end();
    await pool.end();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
