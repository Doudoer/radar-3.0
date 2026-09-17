import { pool } from './config';

let tableReady: Promise<void> | null = null;

const ensureNotesTable = () => {
  if (!tableReady) {
    tableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS personal_notes (
        user_id INT NOT NULL PRIMARY KEY,
        content LONGTEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX personal_notes_updated_at (updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `).then(() => undefined);
  }
  return tableReady;
};

export const getPersonalNote = async (userId: string | number) => {
  await ensureNotesTable();
  const [rows] = await pool.query<Array<{ content: string } & import('mysql2/promise').RowDataPacket>>(
    'SELECT content FROM personal_notes WHERE user_id = ? LIMIT 1',
    [userId]
  );
  return rows[0]?.content || '';
};

export const savePersonalNote = async (userId: string | number, content: string) => {
  await ensureNotesTable();
  await pool.execute(
    `INSERT INTO personal_notes (user_id, content) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE content = VALUES(content), updated_at = CURRENT_TIMESTAMP`,
    [userId, content]
  );
};
