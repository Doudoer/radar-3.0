import { RowDataPacket } from 'mysql2/promise';
import { pool } from './config';

export const getAnalytics = async () => {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT
      COUNT(*) AS totalOrders,
      SUM(CASE WHEN status IN ('Pagado', 'Facturado', 'Entregado') THEN price ELSE 0 END) AS sales,
      SUM(CASE WHEN status NOT IN ('Cancelado', 'Archivado', 'Entregado', 'Reembolsado') THEN 1 ELSE 0 END) AS activeOrders,
      SUM(CASE WHEN status IN ('Reclamo', 'Solicitud Reembolso', 'Reembolsado') THEN 1 ELSE 0 END) AS incidents,
      AVG(CASE WHEN status IN ('Pagado', 'Facturado', 'Entregado') THEN price END) AS averageTicket
    FROM orders WHERE deleted_at IS NULL
  `);
  const [dailySales] = await pool.query<RowDataPacket[]>(`
    SELECT DATE(created_at) AS date, COUNT(*) AS orders, COALESCE(SUM(price), 0) AS amount
    FROM orders WHERE deleted_at IS NULL AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    GROUP BY DATE(created_at) ORDER BY date
  `);
  return { ...rows[0], dailySales };
};
