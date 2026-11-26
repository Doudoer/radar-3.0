import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Pool, RowDataPacket } from 'mysql2/promise';

/**
 * Aplica automáticamente cualquier migración SQL pendiente en ./migrations
 * de forma idempotente al iniciar el servidor (tanto local como en producción).
 */
export async function autoApplyPendingMigrations(pool: Pool): Promise<void> {
  const migrationsDirectory = path.resolve(process.cwd(), 'migrations');

  try {
    // 1. Asegurar tabla de control de migraciones
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 2. Leer archivos en migrations/
    let files: string[] = [];
    try {
      files = (await fs.readdir(migrationsDirectory)).filter((f) => f.endsWith('.sql')).sort();
    } catch {
      // Si la carpeta migrations no está disponible en este entorno
      return;
    }

    if (files.length === 0) return;

    const [rows] = await pool.query<RowDataPacket[]>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => String(r.name)));

    for (const file of files) {
      if (applied.has(file)) continue;

      const fullPath = path.join(migrationsDirectory, file);
      const sql = await fs.readFile(fullPath, 'utf8');

      // Dividir por declaraciones SQL individuales
      const statements = sql
        .split(/;\s*[\r\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('--'));

      for (const statement of statements) {
        if (!statement) continue;
        try {
          await pool.query(statement);
        } catch (stmtErr: any) {
          // Ignorar si la tabla o índice ya existía
          if (stmtErr?.code !== 'ER_TABLE_EXISTS_ERROR' && stmtErr?.code !== 'ER_DUP_KEYNAME') {
            console.warn(`[AutoMigrate] Statement warning in ${file}:`, stmtErr?.message || stmtErr);
          }
        }
      }

      await pool.execute('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      console.log(`[AutoMigrate] Migración aplicada exitosamente: ${file}`);
    }
  } catch (err) {
    console.warn('[AutoMigrate] Error ejecutando migraciones automáticas:', err);
  }
}
