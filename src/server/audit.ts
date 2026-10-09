import { Pool, RowDataPacket } from 'mysql2/promise';

export type AuditAction =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'PASSWORD_CHANGED'
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_DELETED'
  | '2FA_REQUESTED'
  | '2FA_VERIFIED'
  | '2FA_FAILED'
  | 'ORDER_CREATED'
  | 'ORDER_UPDATED'
  | 'ORDER_STATUS_CHANGED'
  | 'CLAIM_CREATED'
  | 'CLAIM_UPDATED'
  | 'RECURRING_EXPENSE_SAVED'
  | 'BACKUP_CREATED'
  | 'BACKUP_RESTORED'
  | 'SECURITY_ALERT_TRIGGERED';

export interface CreateAuditLogInput {
  userId?: number | null;
  username?: string | null;
  action: AuditAction | string;
  resourceType?: string | null;
  resourceId?: string | number | null;
  details?: Record<string, unknown> | string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditLogItem {
  id: number;
  userId: number | null;
  username: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  details: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export const ensureAuditTable = async (pool: Pool): Promise<void> => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NULL,
        username VARCHAR(100) NULL,
        action VARCHAR(100) NOT NULL,
        resource_type VARCHAR(60) NULL,
        resource_id VARCHAR(100) NULL,
        details TEXT NULL,
        ip_address VARCHAR(45) NULL,
        user_agent VARCHAR(255) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX audit_logs_action (action),
        INDEX audit_logs_user (user_id),
        INDEX audit_logs_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  } catch (error) {
    console.error('Error al inicializar tabla audit_logs:', error);
  }
};

export const recordAuditLog = async (
  pool: Pool,
  input: CreateAuditLogInput
): Promise<void> => {
  try {
    const detailsStr =
      input.details === null || input.details === undefined
        ? null
        : typeof input.details === 'string'
        ? input.details
        : JSON.stringify(input.details);

    await pool.query(
      `INSERT INTO audit_logs (user_id, username, action, resource_type, resource_id, details, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.userId || null,
        input.username || null,
        input.action,
        input.resourceType || null,
        input.resourceId !== undefined && input.resourceId !== null ? String(input.resourceId) : null,
        detailsStr,
        input.ipAddress || null,
        input.userAgent ? input.userAgent.slice(0, 255) : null,
      ]
    );
  } catch (error) {
    // Non-blocking catch to ensure business transactions are never disrupted
    console.error('[Audit Log Error]: No fue posible registrar log de auditoría:', error);
  }
};

export const getAuditLogs = async (
  pool: Pool,
  options: {
    limit?: number;
    offset?: number;
    action?: string;
    userId?: number;
    startDate?: string;
    endDate?: string;
  } = {}
): Promise<{ logs: AuditLogItem[]; total: number }> => {
  const limit = Math.min(Math.max(1, options.limit || 50), 200);
  const offset = Math.max(0, options.offset || 0);

  const conditions: string[] = ['1=1'];
  const params: (string | number)[] = [];

  if (options.action) {
    conditions.push('action = ?');
    params.push(options.action);
  }
  if (options.userId) {
    conditions.push('user_id = ?');
    params.push(options.userId);
  }
  if (options.startDate) {
    conditions.push('created_at >= ?');
    params.push(options.startDate);
  }
  if (options.endDate) {
    conditions.push('created_at <= ?');
    params.push(options.endDate);
  }

  const whereClause = conditions.join(' AND ');

  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) as total FROM audit_logs WHERE ${whereClause}`,
    params
  );
  const total = Number(countRows[0]?.total || 0);

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM audit_logs WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const logs: AuditLogItem[] = rows.map((row) => {
    let parsedDetails: unknown = row.details;
    if (typeof row.details === 'string') {
      try {
        parsedDetails = JSON.parse(row.details);
      } catch {
        parsedDetails = row.details;
      }
    }

    return {
      id: Number(row.id),
      userId: row.user_id ? Number(row.user_id) : null,
      username: row.username || null,
      action: row.action,
      resourceType: row.resource_type || null,
      resourceId: row.resource_id || null,
      details: parsedDetails,
      ipAddress: row.ip_address || null,
      userAgent: row.user_agent || null,
      createdAt: new Date(row.created_at).toISOString(),
    };
  });

  return { logs, total };
};
