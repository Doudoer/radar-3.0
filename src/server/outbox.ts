import { Pool, RowDataPacket } from 'mysql2/promise';
import { WasenderClient } from '../integrations/wasender/client';

export interface DeliveryPayload {
  to: string;
  text: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'file';
  filename?: string;
}

export async function deliver(wasender: WasenderClient, payload: DeliveryPayload) {
  if (payload.mediaUrl && payload.mediaType === 'image') {
    return wasender.sendImage({ to: payload.to, url: payload.mediaUrl, caption: payload.text });
  }
  if (payload.mediaUrl && payload.mediaType === 'file') {
    return wasender.sendFile({ to: payload.to, url: payload.mediaUrl, caption: payload.text, filename: payload.filename || 'archivo' });
  }
  return wasender.sendText({ to: payload.to, text: payload.text });
}

export function startNotificationOutbox(pool: Pool, wasender: WasenderClient) {
  let busy = false;
  const run = async () => {
    if (busy || !wasender.configured) return;
    busy = true;
    try {
      const connection = await pool.getConnection();
      let row: RowDataPacket | undefined;
      try {
        await connection.beginTransaction();
        const [rows] = await connection.query<RowDataPacket[]>(
          "SELECT id,payload FROM notification_outbox WHERE status IN ('pending','retry') AND available_at<=UTC_TIMESTAMP() ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED",
        );
        row = rows[0];
        if (row) await connection.execute("UPDATE notification_outbox SET status='processing',attempts=attempts+1,available_at=UTC_TIMESTAMP()+INTERVAL 5 MINUTE WHERE id=?", [row.id]);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally { connection.release(); }
      if (!row) return;
      try {
        const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
        if (payload.kind === 'event') {
          const { dispatchSystemNotification } = await import('../integrations/wasender/notificationService');
          const result = await dispatchSystemNotification(pool, wasender, payload.eventKey, payload.messageText, { ...payload.context, outboxEventId: Number(row.id) });
          await pool.execute('UPDATE notification_outbox SET status=?,last_error=? WHERE id=?', [
            result.totalResolved ? 'expanded' : 'skipped', result.skippedReason || null, row.id,
          ]);
        } else {
          await deliver(wasender, payload);
          await pool.execute("UPDATE notification_outbox SET status='sent',last_error=NULL WHERE id=?", [row.id]);
        }
      } catch (error) {
        console.error('[Outbox] Entrega pendiente:', error);
        await pool.execute("UPDATE notification_outbox SET status=IF(attempts>=10,'failed','retry'),last_error=?,available_at=UTC_TIMESTAMP()+INTERVAL 1 MINUTE WHERE id=?", [error instanceof Error ? error.message : String(error), row.id]);
      }
    } finally { busy = false; }
  };
  const tick = () => {
    void pool.execute("UPDATE notification_outbox SET status='retry' WHERE status='processing' AND available_at<UTC_TIMESTAMP()")
      .then(run).catch(error => console.error('[Outbox] No se pudo procesar la cola:', error));
  };
  tick();
  const timer = setInterval(tick, 6000);
  timer.unref();
}
