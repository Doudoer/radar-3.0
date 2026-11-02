import { Pool, RowDataPacket } from 'mysql2/promise';

export async function runScheduledJob(pool: Pool, key: string, work: () => Promise<void>) {
  const connection = await pool.getConnection();
  let id: number;
  try {
    await connection.beginTransaction();
    await connection.execute(
      "INSERT IGNORE INTO notification_outbox (payload,status,dedupe_key) VALUES (?,'job_ready',?)",
      [JSON.stringify({ kind: 'scheduled_job', key }), `job:${key}`],
    );
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT id,status,available_at<=UTC_TIMESTAMP() AS available FROM notification_outbox WHERE dedupe_key=? FOR UPDATE', [`job:${key}`],
    );
    const row = rows[0];
    if (row.status === 'job_complete' || !row.available) {
      await connection.rollback();
      return;
    }
    id = Number(row.id);
    await connection.execute(
      "UPDATE notification_outbox SET status='job_running',attempts=attempts+1,available_at=UTC_TIMESTAMP()+INTERVAL 30 MINUTE WHERE id=?", [id],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
  try {
    await work();
    await pool.execute("UPDATE notification_outbox SET status='job_complete',last_error=NULL WHERE id=?", [id]);
  } catch (error) {
    await pool.execute(
      "UPDATE notification_outbox SET status='job_failed',last_error=?,available_at=UTC_TIMESTAMP()+INTERVAL 5 MINUTE WHERE id=?",
      [error instanceof Error ? error.message : String(error), id],
    );
    throw error;
  }
}
