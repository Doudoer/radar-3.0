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
    `).then(() => pool.query(`
      CREATE TABLE IF NOT EXISTS personal_messages (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        sender_id INT NOT NULL,
        recipient_id INT NOT NULL,
        subject VARCHAR(160) NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        read_at TIMESTAMP NULL DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX personal_messages_recipient (recipient_id, created_at),
        INDEX personal_messages_sender (sender_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)).then(() => undefined);
  }
  return tableReady;
};

export const getMessageUsers = async (currentUserId: string | number) => {
  await ensureNotesTable();
  const [rows] = await pool.query('SELECT id, name, email FROM users WHERE id <> ? AND active = 1 AND deleted_at IS NULL ORDER BY name', [currentUserId]);
  return rows;
};

export const getPersonalMessages = async (userId: string | number) => {
  await ensureNotesTable();
  const [rows] = await pool.query(`
    SELECT m.id, m.subject, m.content, m.read_at, m.created_at,
      sender.name AS sender_name, sender.email AS sender_email,
      recipient.name AS recipient_name, recipient.email AS recipient_email
    FROM personal_messages m
    INNER JOIN users sender ON sender.id = m.sender_id
    INNER JOIN users recipient ON recipient.id = m.recipient_id
    WHERE m.sender_id = ? OR m.recipient_id = ?
    ORDER BY m.created_at DESC
    LIMIT 100
  `, [userId, userId]);
  return rows;
};

export const sendPersonalMessage = async (senderId: string | number, recipientId: number, subject: string, content: string) => {
  await ensureNotesTable();
  const [result] = await pool.execute<import('mysql2/promise').ResultSetHeader>(
    `INSERT INTO personal_messages (sender_id, recipient_id, subject, content)
     SELECT ?, id, ?, ? FROM users WHERE id = ? AND active = 1 AND deleted_at IS NULL`,
    [senderId, subject, content, recipientId]
  );
  if (result.affectedRows === 0) throw Object.assign(new Error('El usuario destinatario no está disponible'), { statusCode: 404 });
  return result.insertId;
};

export const markPersonalMessageRead = async (userId: string | number, messageId: number) => {
  await ensureNotesTable();
  await pool.execute('UPDATE personal_messages SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND recipient_id = ?', [messageId, userId]);
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
