import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import {
  DOWNPAYMENT_COMMISSION_AMOUNT,
  DELIVERY_CLOSED_COMMISSION_AMOUNT,
  YARD_VERIFICATION_HOURS,
  isYardEmployee,
  type EmployeeCommissionItem,
  type EmployeeCommissionsSummary,
} from '../utils/commissions';

const toSqlDate = (date: Date) => date.toISOString().slice(0, 19).replace('T', ' ');

export const recordDownpaymentCommission = async (
  pool: Pool | PoolConnection,
  params: {
    orderId: number;
    userId: number;
    isYardSale?: boolean;
    createdAt?: Date;
  },
): Promise<boolean> => {
  const { orderId, userId, isYardSale = false, createdAt = new Date() } = params;
  if (!orderId || !userId || isYardSale) return false;

  // Verify that the user is not a yard employee
  const [userRows] = await pool.query<RowDataPacket[]>(
    'SELECT role FROM users WHERE id=? AND deleted_at IS NULL LIMIT 1',
    [userId],
  );
  if (!userRows[0] || isYardEmployee(userRows[0].role)) return false;

  const availableAt = new Date(createdAt.getTime() + YARD_VERIFICATION_HOURS * 3_600_000);

  try {
    await pool.execute(
      `INSERT INTO employee_commissions
         (user_id, order_id, type, amount, status, available_at, created_at)
       VALUES (?, ?, 'downpayment_sale', ?, 'pending_yard_check', ?, ?)
       ON DUPLICATE KEY UPDATE updated_at=CURRENT_TIMESTAMP`,
      [userId, orderId, DOWNPAYMENT_COMMISSION_AMOUNT, toSqlDate(availableAt), toSqlDate(createdAt)],
    );
    return true;
  } catch (err) {
    console.warn('[Commissions] Failed to record downpayment commission:', err);
    return false;
  }
};

export const recordDeliveryCommission = async (
  pool: Pool | PoolConnection,
  params: {
    orderId: number;
    userId: number;
    isYardSale?: boolean;
    deliveredAt?: Date;
  },
): Promise<boolean> => {
  const { orderId, userId, isYardSale = false, deliveredAt = new Date() } = params;
  if (!orderId || !userId || isYardSale) return false;

  const [userRows] = await pool.query<RowDataPacket[]>(
    'SELECT role FROM users WHERE id=? AND deleted_at IS NULL LIMIT 1',
    [userId],
  );
  if (!userRows[0] || isYardEmployee(userRows[0].role)) return false;

  try {
    await pool.execute(
      `INSERT INTO employee_commissions
         (user_id, order_id, type, amount, status, available_at, earned_at, created_at)
       VALUES (?, ?, 'delivered_closed', ?, 'earned', ?, ?, ?)
       ON DUPLICATE KEY UPDATE updated_at=CURRENT_TIMESTAMP`,
      [
        userId,
        orderId,
        DELIVERY_CLOSED_COMMISSION_AMOUNT,
        toSqlDate(deliveredAt),
        toSqlDate(deliveredAt),
        toSqlDate(deliveredAt),
      ],
    );
    return true;
  } catch (err) {
    console.warn('[Commissions] Failed to record delivery commission:', err);
    return false;
  }
};

/**
 * Checks all commissions pending yard verification (12-hour window).
 * If the order was canceled due to availability within the 12h, void the commission.
 * If 12 hours have elapsed and the order was not canceled by availability, automatically release the $5.
 */
export const releaseOrVoidYardCommissions = async (pool: Pool, now = new Date()): Promise<void> => {
  const nowSql = toSqlDate(now);

  const [pending] = await pool.query<RowDataPacket[]>(
    `SELECT c.id, c.order_id, c.available_at, c.created_at,
            o.status, o.workflow_data, o.auction_search_active
       FROM employee_commissions c
       JOIN orders o ON o.id = c.order_id
      WHERE c.status = 'pending_yard_check'`,
  );

  for (const row of pending) {
    const commissionId = Number(row.id);
    const availableAt = new Date(row.available_at);

    let workflowData: Record<string, unknown> = {};
    try {
      workflowData = typeof row.workflow_data === 'string'
        ? JSON.parse(row.workflow_data || '{}')
        : (row.workflow_data || {});
    } catch {
      workflowData = {};
    }

    const orderStatus = String(row.status || '').toLowerCase().trim();
    const isYardUnavailable = workflowData.yardPieceUnavailable === true;
    const isCanceled = orderStatus === 'cancelado' || orderStatus === 'cancelada';

    // If order was canceled due to yard unavailability during the 12h window:
    if (isYardUnavailable || (isCanceled && (isYardUnavailable || row.auction_search_active === 1))) {
      await pool.execute(
        `UPDATE employee_commissions
            SET status = 'voided_availability', voided_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [commissionId],
      );
      continue;
    }

    // If 12 hours have elapsed and NOT canceled by availability:
    if (availableAt.getTime() <= now.getTime()) {
      await pool.execute(
        `UPDATE employee_commissions
            SET status = 'earned', earned_at = available_at
          WHERE id = ?`,
        [commissionId],
      );
    }
  }
};

export const COMMISSIONS_EFFECTIVE_DATE = '2026-11-23 00:00:00';

export const syncCommissionsSinceDate = async (
  pool: Pool,
  sinceDate = COMMISSIONS_EFFECTIVE_DATE,
  now = new Date(),
): Promise<void> => {
  try {
    // 1. Sync downpayment commissions for all eligible non-yard sales
    const [downpaymentRows] = await pool.query<RowDataPacket[]>(
      `SELECT o.id, o.user_id, o.is_yard_sale, o.created_at, o.downpayment_verified_at, o.down_payment, o.status
         FROM orders o
        WHERE o.deleted_at IS NULL
          AND (o.is_yard_sale = 0 OR o.is_yard_sale IS NULL)
          AND o.user_id IS NOT NULL
          AND (o.created_at >= ? OR o.downpayment_verified_at >= ?)
          AND (o.down_payment > 0 OR o.downpayment_verified = 1 OR LOWER(TRIM(o.status)) = 'pagado')`,
      [sinceDate, sinceDate],
    );

    for (const row of downpaymentRows) {
      const orderDate = row.created_at ? new Date(row.created_at) : new Date();
      await recordDownpaymentCommission(pool, {
        orderId: Number(row.id),
        userId: Number(row.user_id),
        isYardSale: Boolean(row.is_yard_sale),
        createdAt: orderDate,
      });
    }

    // 2. Sync delivery closed commissions
    const [deliveryRows] = await pool.query<RowDataPacket[]>(
      `SELECT o.id, o.user_id, o.is_yard_sale, o.delivered_at, o.updated_at
         FROM orders o
        WHERE o.deleted_at IS NULL
          AND (o.is_yard_sale = 0 OR o.is_yard_sale IS NULL)
          AND o.user_id IS NOT NULL
          AND (
            (o.delivered_at IS NOT NULL AND o.delivered_at >= ?)
            OR (LOWER(TRIM(o.status)) = 'entregado' AND o.updated_at >= ?)
          )`,
      [sinceDate, sinceDate],
    );

    for (const row of deliveryRows) {
      const deliveredDate = row.delivered_at ? new Date(row.delivered_at) : (row.updated_at ? new Date(row.updated_at) : new Date());
      await recordDeliveryCommission(pool, {
        orderId: Number(row.id),
        userId: Number(row.user_id),
        isYardSale: Boolean(row.is_yard_sale),
        deliveredAt: deliveredDate,
      });
    }

    // 3. Auto-release (after 12h) or void (if canceled by yard)
    await releaseOrVoidYardCommissions(pool, now);
  } catch (err) {
    console.warn('[Commissions] Failed to sync retroactive commissions:', err);
  }
};

export const getUserCommissionsSummary = async (
  pool: Pool,
  userId: number,
  period: { start: string; end: string },
  now = new Date(),
): Promise<EmployeeCommissionsSummary> => {
  // First, auto-sync and auto-release/void pending commissions since effective start date
  await syncCommissionsSinceDate(pool, COMMISSIONS_EFFECTIVE_DATE, now);

  const startSql = toSqlDate(new Date(period.start));
  const endSql = toSqlDate(new Date(period.end));

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.id, c.user_id, c.order_id, c.type, c.amount, c.status,
            c.available_at, c.earned_at, c.voided_at, c.created_at,
            o.order_code, o.year, o.brand, o.model,
            cust.first_name, cust.last_name
       FROM employee_commissions c
       JOIN orders o ON o.id = c.order_id
       LEFT JOIN customers cust ON cust.id = o.customer_id
      WHERE c.user_id = ?
        AND (
          (c.status = 'earned' AND c.earned_at >= ? AND c.earned_at <= ?)
          OR c.status = 'pending_yard_check'
          OR (c.status = 'voided_availability' AND c.voided_at >= ? AND c.voided_at <= ?)
        )
      ORDER BY c.created_at DESC`,
    [userId, startSql, endSql, startSql, endSql],
  );

  const items: EmployeeCommissionItem[] = rows.map((r) => {
    const avail = new Date(r.available_at);
    const msRemaining = avail.getTime() - now.getTime();
    const minutesRemaining = msRemaining > 0 ? Math.ceil(msRemaining / 60_000) : 0;
    const vehicle = [r.year, r.brand, r.model].filter(Boolean).join(' ');
    const customerName = [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || 'Cliente';

    return {
      id: Number(r.id),
      userId: Number(r.user_id),
      orderId: Number(r.order_id),
      orderCode: String(r.order_code || ''),
      type: r.type,
      amount: Number(r.amount),
      status: r.status,
      availableAt: r.available_at ? new Date(r.available_at).toISOString() : '',
      earnedAt: r.earned_at ? new Date(r.earned_at).toISOString() : null,
      voidedAt: r.voided_at ? new Date(r.voided_at).toISOString() : null,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
      customerName,
      vehicle,
      minutesRemaining,
    };
  });

  const earnedItems = items.filter((i) => i.status === 'earned');
  const pendingItems = items.filter((i) => i.status === 'pending_yard_check');
  const voidedItems = items.filter((i) => i.status === 'voided_availability');

  const earnedAmount = Math.round(earnedItems.reduce((acc, i) => acc + i.amount, 0) * 100) / 100;
  const pendingYardAmount = Math.round(pendingItems.reduce((acc, i) => acc + i.amount, 0) * 100) / 100;
  const voidedAmount = Math.round(voidedItems.reduce((acc, i) => acc + i.amount, 0) * 100) / 100;

  return {
    userId,
    periodStart: period.start,
    periodEnd: period.end,
    earnedAmount,
    pendingYardAmount,
    voidedAmount,
    earnedCount: earnedItems.length,
    pendingYardCount: pendingItems.length,
    voidedCount: voidedItems.length,
    items,
  };
};

export const getUserCarryoverDebt = async (
  pool: Pool,
  userId: number,
): Promise<{ totalDebt: number; lastPeriodEnd: string | null }> => {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT carryover_amount, covered_amount, period_end
       FROM employee_penalty_carryover
      WHERE user_id = ? AND status = 'pending'
      ORDER BY id DESC LIMIT 1`,
    [userId],
  );

  if (!rows[0]) return { totalDebt: 0, lastPeriodEnd: null };
  const netDebt = Math.max(0, Number(rows[0].carryover_amount || 0) - Number(rows[0].covered_amount || 0));
  return {
    totalDebt: Math.round(netDebt * 100) / 100,
    lastPeriodEnd: rows[0].period_end ? String(rows[0].period_end) : null,
  };
};

export const saveUserCarryoverDebt = async (
  pool: Pool,
  userId: number,
  periodEnd: string,
  newDebtAmount: number,
  coveredAmount: number,
): Promise<void> => {
  const status = newDebtAmount <= 0 ? 'cleared' : 'pending';
  await pool.execute(
    `INSERT INTO employee_penalty_carryover
       (user_id, period_end, carryover_amount, covered_amount, status)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       carryover_amount = VALUES(carryover_amount),
       covered_amount = VALUES(covered_amount),
       status = VALUES(status),
       updated_at = CURRENT_TIMESTAMP`,
    [userId, periodEnd.slice(0, 32), newDebtAmount, coveredAmount, status],
  );
};
