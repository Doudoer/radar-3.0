import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

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
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const files = (await fs.readdir(migrationsDirectory)).filter((file) => file.endsWith('.sql')).sort();
    const [rows] = await connection.query<mysql.RowDataPacket[]>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((row) => String(row.name)));

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await fs.readFile(path.join(migrationsDirectory, file), 'utf8');
      await connection.query(sql);
      await connection.execute('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      console.log(`Applied ${file}`);
    }

    console.log(files.length === applied.size ? 'Database is up to date' : 'Migrations complete');
  } finally {
    await connection.end();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
