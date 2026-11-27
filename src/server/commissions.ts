import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import {
  DOWNPAYMENT_COMMISSION_AMOUNT,
  DELIVERY_CLOSED_COMMISSION_AMOUNT,
  YARD_VERIFICATION_HOURS,
  isYardEmployee,
  type EmployeeCommissionItem,
  type EmployeeCommissionsSummary,
} from '../utils/commissions';
import { payPeriodFor } from '../utils/penalties';

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

  // The order MUST have been sold (created) in the same week period as delivery!
  const [orderRows] = await pool.query<RowDataPacket[]>(
    'SELECT created_at FROM orders WHERE id=? LIMIT 1',
    [orderId],
  );
  if (!orderRows[0] || !orderRows[0].created_at) return false;

  const orderCreatedAt = new Date(orderRows[0].created_at);
  const period = payPeriodFor(deliveredAt);
  const periodStart = new Date(period.start);
  const periodEnd = new Date(period.end);

  if (orderCreatedAt.getTime() < periodStart.getTime() || orderCreatedAt.getTime() > periodEnd.getTime()) {
    // If order was created prior to this week, do not award delivery commission.
    // Clean up any stale delivered_closed record for this order if present.
    await pool.execute(
      "DELETE FROM employee_commissions WHERE order_id = ? AND type = 'delivered_closed'",
      [orderId],
    );
    return false;
  }

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
    // MUST BE: both sold/created this week AND delivered this week!
    const [deliveryRows] = await pool.query<RowDataPacket[]>(
      `SELECT o.id, o.user_id, o.is_yard_sale, o.delivered_at, o.updated_at, o.created_at
         FROM orders o
        WHERE o.deleted_at IS NULL
          AND (o.is_yard_sale = 0 OR o.is_yard_sale IS NULL)
          AND o.user_id IS NOT NULL
          AND (
            (o.delivered_at IS NOT NULL AND o.delivered_at >= ?)
            OR (LOWER(TRIM(o.status)) = 'entregado' AND o.updated_at >= ?)
          )
          AND o.created_at >= ?`,
      [sinceDate, sinceDate, sinceDate],
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

    // Clean up any existing delivered_closed commissions where order was created before sinceDate
    await pool.execute(
      `DELETE c FROM employee_commissions c
         JOIN orders o ON o.id = c.order_id
        WHERE c.type = 'delivered_closed'
          AND o.created_at < ?`,
      [sinceDate],
    );

    // 3. Auto-release (after 12h) or void (if canceled by yard)
    await releaseOrVoidYardCommissions(pool, now);

    // 4. Sync commission voiding or deductions for refunded orders
    await syncRefundCommissions(pool, now);
  } catch (err) {
    console.warn('[Commissions] Failed to sync retroactive commissions:', err);
  }
};

/**
 * Processes refund requests on orders and applies commission voiding rules:
 * - Escenario A: Reembolso solicitado en la MISMA semana de entrega (o antes de entrega):
 *   Se descuentan ambas comisiones ($5 venta + $2 cierre).
 * - Escenario B: Reembolso solicitado en una SEMANA POSTERIOR a la entrega:
 *   SOLO se descuentan los $2 del cierre. Los $5 de la venta se conservan intactos.
 */
export const syncRefundCommissions = async (
  pool: Pool,
  now = new Date(),
): Promise<void> => {
  try {
    const [refundRows] = await pool.query<RowDataPacket[]>(
      `SELECT r.id AS refund_id, r.order_id, r.created_at AS refund_created_at, r.status AS refund_status,
              o.delivered_at, o.created_at AS order_created_at
         FROM refund_requests r
         JOIN orders o ON o.id = r.order_id
        WHERE r.status IN ('pending', 'completed')
          AND COALESCE(r.refund_scope, 'purchase') = 'purchase'`,
    );

    for (const row of refundRows) {
      const orderId = Number(row.order_id);
      const refundCreatedAt = row.refund_created_at ? new Date(row.refund_created_at) : now;
      const deliveredAt = row.delivered_at ? new Date(row.delivered_at) : null;
      const refundSql = toSqlDate(refundCreatedAt);

      if (deliveredAt) {
        const deliveryPeriod = payPeriodFor(deliveredAt);
        const refundPeriod = payPeriodFor(refundCreatedAt);
        const isSameWeek = deliveryPeriod.start === refundPeriod.start;

        if (isSameWeek) {
          // Escenario A: Misma semana de entrega -> se descuentan AMBAS comisiones ($5 venta y $2 cierre)
          await pool.execute(
            `UPDATE employee_commissions
                SET status = 'voided_availability', notes = 'voided_refund', voided_at = ?
              WHERE order_id = ?
                AND status IN ('earned', 'pending_yard_check')`,
            [refundSql, orderId],
          );
        } else {
          // Escenario B: Semana posterior a la entrega -> SOLO se descuentan los $2 del cierre
          await pool.execute(
            `UPDATE employee_commissions
                SET status = 'voided_availability', notes = 'voided_refund', voided_at = ?
              WHERE order_id = ?
                AND type = 'delivered_closed'
                AND status IN ('earned', 'pending_yard_check')`,
            [refundSql, orderId],
          );
          // Los $5 de venta NO se descuentan; si estaban marcados como voided_refund, se restauran a earned
          await pool.execute(
            `UPDATE employee_commissions
                SET status = 'earned', notes = NULL, voided_at = NULL
              WHERE order_id = ?
                AND type = 'downpayment_sale'
                AND notes = 'voided_refund'`,
            [orderId],
          );
        }
      } else {
        // Orden no entregada (cancelada o reembolsada en preparación) -> anular comisión de venta
        await pool.execute(
          `UPDATE employee_commissions
              SET status = 'voided_availability', notes = 'voided_refund', voided_at = ?
            WHERE order_id = ?
              AND status IN ('earned', 'pending_yard_check')`,
          [refundSql, orderId],
        );
      }
    }

    // Restaurar comisiones si la solicitud de reembolso fue cancelada o rechazada
    await pool.execute(
      `UPDATE employee_commissions c
          SET c.status = 'earned', c.notes = NULL, c.voided_at = NULL
        WHERE c.notes = 'voided_refund'
          AND NOT EXISTS (
            SELECT 1 FROM refund_requests r
             WHERE r.order_id = c.order_id
               AND r.status IN ('pending', 'completed')
               AND COALESCE(r.refund_scope, 'purchase') = 'purchase'
          )`,
    );
  } catch (err) {
    console.warn('[Commissions] Failed to sync refund commissions:', err);
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
    `SELECT c.id, c.user_id, c.order_id, c.type, c.amount, c.status, c.notes,
            c.available_at, c.earned_at, c.voided_at, c.created_at,
            o.order_code, o.year, o.brand, o.model, o.created_at AS order_created_at,
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
        AND (
          c.type != 'delivered_closed'
          OR c.notes = 'voided_refund'
          OR (o.created_at >= ? AND o.created_at <= ?)
        )
      ORDER BY c.created_at DESC`,
    [userId, startSql, endSql, startSql, endSql, startSql, endSql],
  );

  const items: EmployeeCommissionItem[] = rows.map((r) => {
    const avail = new Date(r.available_at);
    const msRemaining = avail.getTime() - now.getTime();
    const minutesRemaining = msRemaining > 0 ? Math.ceil(msRemaining / 60_000) : 0;
    const vehicle = [r.year, r.brand, r.model].filter(Boolean).join(' ');
    const customerName = [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || 'Cliente';
    const status: EmployeeCommissionItem['status'] = r.notes === 'voided_refund' ? 'voided_refund' : r.status;

    return {
      id: Number(r.id),
      userId: Number(r.user_id),
      orderId: Number(r.order_id),
      orderCode: String(r.order_code || ''),
      type: r.type,
      amount: Number(r.amount),
      status,
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
  const voidedItems = items.filter((i) => i.status === 'voided_availability' || i.status === 'voided_refund');

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
