import type { Pool, RowDataPacket } from 'mysql2/promise';
import { payPeriodFor, localDateKey } from '../utils/penalties';
import { statusFromDatabase } from './orders';
import { saleStatuses } from '../utils/orderAnalytics';

const WEEKDAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const toSqlDate = (date: Date) => date.toISOString().slice(0, 19).replace('T', ' ');

const orderAmount = (row: RowDataPacket) =>
  Number(row.price || 0) + Number(row.shipping_cost || 0) + Number(row.core_fee || 0);

interface EmployeeMetrics {
  userId: number;
  name: string;
  role: string;
  salesCount: number;
  salesAmount: number;
  closures: number;
  resolutions: number;
}

export interface PerformanceSnapshot {
  period: { start: string; end: string; label: string };
  me: EmployeeMetrics & { rank: number; totalEmployees: number };
  team: {
    totalEmployees: number;
    averageSalesAmount: number;
    averageSalesCount: number;
    averageClosures: number;
    averageResolutions: number;
  };
  series: Array<{ date: string; label: string; amount: number; count: number }>;
  ranking: Array<EmployeeMetrics & { isMe: boolean }>;
}

export const getWeeklyPerformance = async (pool: Pool, targetUserId: number, now = new Date()): Promise<PerformanceSnapshot> => {
  const period = payPeriodFor(now);
  const start = new Date(period.start);
  const end = new Date(period.end);
  const startSql = toSqlDate(start);
  const endSql = toSqlDate(end);

  const [userRows] = await pool.query<RowDataPacket[]>(
    "SELECT id, name, role FROM users WHERE deleted_at IS NULL AND active=1 ORDER BY name",
  );
  const employees = new Map<number, EmployeeMetrics>(
    userRows.map(row => [Number(row.id), {
      userId: Number(row.id),
      name: String(row.name),
      role: String(row.role),
      salesCount: 0,
      salesAmount: 0,
      closures: 0,
      resolutions: 0,
    }]),
  );
  if (!employees.has(targetUserId)) {
    const [targetRows] = await pool.query<RowDataPacket[]>(
      'SELECT id, name, role FROM users WHERE id=? AND deleted_at IS NULL LIMIT 1',
      [targetUserId],
    );
    if (targetRows[0]) {
      employees.set(targetUserId, {
        userId: Number(targetRows[0].id),
        name: String(targetRows[0].name),
        role: String(targetRows[0].role),
        salesCount: 0,
        salesAmount: 0,
        closures: 0,
        resolutions: 0,
      });
    }
  }

  const [salesRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, user_id, status, created_at, price, shipping_cost, core_fee
       FROM orders
      WHERE deleted_at IS NULL AND created_at >= ? AND created_at < ?`,
    [startSql, endSql],
  );
  const daily = new Map<string, { amount: number; count: number }>();
  for (let cursor = new Date(start); cursor < end; cursor = new Date(cursor.getTime() + 86_400_000)) {
    daily.set(localDateKey(cursor), { amount: 0, count: 0 });
  }
  for (const row of salesRows) {
    const status = statusFromDatabase(String(row.status));
    if (!saleStatuses.has(status)) continue;
    const userId = Number(row.user_id || 0);
    const metrics = employees.get(userId);
    if (!metrics) continue;
    const amount = orderAmount(row);
    metrics.salesCount += 1;
    metrics.salesAmount += amount;
    if (userId === targetUserId) {
      const key = localDateKey(new Date(row.created_at));
      const bucket = daily.get(key);
      if (bucket) {
        bucket.amount += amount;
        bucket.count += 1;
      }
    }
  }

  const [closureRows] = await pool.query<RowDataPacket[]>(
    `SELECT o.user_id, COUNT(*) AS total
       FROM status_orders so
       JOIN orders o ON o.id=so.order_id
      WHERE LOWER(TRIM(so.status))='pagado' AND so.created_at >= ? AND so.created_at < ?
        AND o.deleted_at IS NULL
      GROUP BY o.user_id`,
    [startSql, endSql],
  );
  for (const row of closureRows) {
    const metrics = employees.get(Number(row.user_id));
    if (metrics) metrics.closures = Number(row.total);
  }

  const [claimRows] = await pool.query<RowDataPacket[]>(
    `SELECT resolved_by, COUNT(*) AS total FROM claims
      WHERE resolved_by IS NOT NULL AND resolved_at >= ? AND resolved_at < ? AND deleted_at IS NULL
      GROUP BY resolved_by`,
    [startSql, endSql],
  );
  for (const row of claimRows) {
    const metrics = employees.get(Number(row.resolved_by));
    if (metrics) metrics.resolutions += Number(row.total);
  }

  const [eventRows] = await pool.query<RowDataPacket[]>(
    `SELECT actor_id, COUNT(*) AS total FROM order_workflow_events
      WHERE outcome='completed' AND created_at >= ? AND created_at < ?
      GROUP BY actor_id`,
    [startSql, endSql],
  );
  for (const row of eventRows) {
    const metrics = employees.get(Number(row.actor_id));
    if (metrics) metrics.resolutions += Number(row.total);
  }

  const ranking = [...employees.values()].sort((left, right) =>
    right.salesAmount - left.salesAmount ||
    right.closures - left.closures ||
    right.resolutions - left.resolutions ||
    left.name.localeCompare(right.name),
  );
  const rank = Math.max(1, ranking.findIndex(entry => entry.userId === targetUserId) + 1);
  const me = employees.get(targetUserId) || {
    userId: targetUserId, name: '', role: '', salesCount: 0, salesAmount: 0, closures: 0, resolutions: 0,
  };
  const totals = ranking.reduce((acc, entry) => ({
    salesAmount: acc.salesAmount + entry.salesAmount,
    salesCount: acc.salesCount + entry.salesCount,
    closures: acc.closures + entry.closures,
    resolutions: acc.resolutions + entry.resolutions,
  }), { salesAmount: 0, salesCount: 0, closures: 0, resolutions: 0 });
  const count = Math.max(1, ranking.length);

  return {
    period: { start: period.start, end: period.end, label: period.label },
    me: { ...me, rank, totalEmployees: ranking.length },
    team: {
      totalEmployees: ranking.length,
      averageSalesAmount: Math.round((totals.salesAmount / count) * 100) / 100,
      averageSalesCount: Math.round((totals.salesCount / count) * 10) / 10,
      averageClosures: Math.round((totals.closures / count) * 10) / 10,
      averageResolutions: Math.round((totals.resolutions / count) * 10) / 10,
    },
    series: [...daily.entries()].map(([date, value]) => ({
      date,
      label: WEEKDAY_LABELS[new Date(`${date}T12:00:00Z`).getUTCDay()],
      amount: Math.round(value.amount * 100) / 100,
      count: value.count,
    })),
    ranking: ranking.map(entry => ({ ...entry, isMe: entry.userId === targetUserId })),
  };
};
