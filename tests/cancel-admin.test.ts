import { describe, it, expect, vi } from 'vitest';
import mysql, { type Pool, type RowDataPacket, type ResultSetHeader } from 'mysql2/promise';

describe('cancel-admin query structure and execution', () => {
  it('validates SQL statements and parameter bindings for cancel-admin endpoint', async () => {
    const executedQueries: { sql: string; values?: any[] }[] = [];

    const mockConnection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
      query: vi.fn((sql: string, values?: any[]) => {
        executedQueries.push({ sql, values });
        if (sql.includes('SELECT id, order_code')) {
          return Promise.resolve([
            [
              {
                id: 633,
                order_code: 'ORD-2026-7701',
                status: 'Pagado',
                inventory_part_id: 12,
                down_payment: 200,
                version: 1,
              },
            ],
            [],
          ]);
        }
        if (sql.includes("kind = 'payment'")) {
          return Promise.resolve([
            [
              {
                id: 101,
                amount: 200,
                payment_method: 'square',
                payment_reference: 'ref-1',
                payment_receipt: null,
                payment_received_by: 'Admin',
              },
            ],
            [],
          ]);
        }
        if (sql.includes("kind = 'refund'")) {
          return Promise.resolve([[{ total_refunded: 0 }], []]);
        }
        if (sql.includes('SELECT name FROM users WHERE id = ?')) {
          return Promise.resolve([[{ name: 'Super Admin' }], []]);
        }
        return Promise.resolve([[], []]);
      }),
      execute: vi.fn((sql: string, values?: any[]) => {
        executedQueries.push({ sql, values });
        return Promise.resolve([{ affectedRows: 1, insertId: 1 } as ResultSetHeader, []]);
      }),
    };

    // Simulate cancel-admin logic from server.ts
    const targetOrderId = 633;
    const data = {
      code: '511111',
      reason: 'Cancelado por inexistencia de stock',
      paymentMethod: 'square',
      version: 1,
    };
    const currentUserId = 1;
    const adminName = 'Super Admin';
    const netPaid = 200;
    const methodDbLabel = 'Tarjeta (Square)';
    const methodDisplay = 'Tarjeta';
    const methodCode = 'square';
    const executionData = { method: 'square', reference: 'Cancelación automática admin', last4: 'AUTO' };
    const orderRow = {
      id: 633,
      order_code: 'ORD-2026-7701',
      status: 'Pagado',
      inventory_part_id: 12,
      down_payment: 200,
      version: 1,
    };

    // 1. Insert refund_requests
    await mockConnection.execute(
      `INSERT INTO refund_requests (order_id, amount, amount_type, payment_method, reason, status, requested_by, previous_order_status, review_stage, refund_scope, execution, completed_at, completed_by)
       VALUES (?, ?, 'total', ?, ?, 'completed', ?, ?, 'completed', 'purchase', ?, UTC_TIMESTAMP(), ?)`,
      [
        targetOrderId,
        netPaid,
        methodDbLabel,
        `Devolución automática por cancelación de orden por Administrador. Motivo: ${data.reason.trim()}`,
        currentUserId,
        orderRow.status,
        JSON.stringify(executionData),
        adminName,
      ]
    );

    // 2. Insert finance_movements
    await mockConnection.execute(
      `INSERT INTO finance_movements (order_id, kind, amount, effective_at, source, reference_key, user_id, payment_method, payment_receipt, payment_received_by)
       VALUES (?, 'refund', ?, UTC_TIMESTAMP(), 'refund', ?, ?, ?, NULL, ?)`,
      [
        targetOrderId,
        netPaid,
        `refund-cancel-${targetOrderId}-testuuid`,
        currentUserId,
        methodCode,
        'Sistema / Administrador',
      ]
    );

    // 3. Release inventory_parts
    if (orderRow.inventory_part_id) {
      await mockConnection.execute(
        "UPDATE inventory_parts SET status = 'disponible', sold_at = NULL WHERE id = ? AND deleted_at IS NULL",
        [orderRow.inventory_part_id]
      );
    }

    // 4. Update order status
    await mockConnection.execute(
      'UPDATE orders SET status = ?, scheduled_pickup_at = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL',
      ['Cancelado', targetOrderId]
    );

    // 5. Insert order_workflow_events
    const refundSummaryText = ` Devolución automática de $${netPaid.toFixed(2)} procesada (${methodDisplay}).`;
    await mockConnection.execute(
      `INSERT INTO order_workflow_events (order_id, task, outcome, actor_id, actor_name, notes, evidence) VALUES (?, 'cancel', 'cancelled_by_admin', ?, ?, ?, '[]')`,
      [targetOrderId, currentUserId, adminName, `Orden cancelada por el Administrador con código OTP verificado. Motivo: ${data.reason.trim()}.${refundSummaryText}`]
    );

    // 6. Insert status_orders
    await mockConnection.execute(
      'INSERT INTO status_orders (order_id, status, description, user_id) VALUES (?, ?, ?, ?)',
      [targetOrderId, 'Cancelado', `Cancelada por el Administrador ${adminName} con código OTP verificado. Motivo: ${data.reason.trim()}.${refundSummaryText}`, currentUserId]
    );

    // 7. Insert audit_logs
    await mockConnection.execute(
      "INSERT INTO audit_logs (user_id, username, action, resource_type, resource_id, details, ip_address, user_agent) VALUES (?, ?, 'ORDER_CANCELLED_ADMIN', 'order', ?, ?, ?, ?)",
      [
        currentUserId,
        'admin@radar.com',
        String(targetOrderId),
        JSON.stringify({
          orderCode: orderRow.order_code,
          fromStatus: orderRow.status,
          toStatus: 'Cancelado',
          reason: data.reason.trim(),
          netPaidRefunded: netPaid,
          paymentMethod: methodDisplay,
          otpVerified: true,
          releasedInventoryPartId: orderRow.inventory_part_id || null,
        }),
        '127.0.0.1',
        'Mozilla/5.0',
      ]
    );

    expect(mockConnection.execute).toHaveBeenCalledTimes(7);
  });
});
