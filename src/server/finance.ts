import { IncomingMessage, ServerResponse } from 'node:http';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { z } from 'zod';
import { pool } from './config';
import { Claims, requireRole } from './auth';
import { readBody, sendJson } from './http';
import { fail } from './business';
import { financeVaultExpiry } from './financeVault';

const money = z.number().finite().min(0).max(10_000_000).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001);
const employee = z.object({ id: z.string().min(1).max(100), name: z.string().min(1).max(200), weeklySalary: money, role: z.string().max(200).optional() });
const recurring = z.object({
  id: z.string().min(1).max(100), name: z.string().min(1).max(200), category: z.string().max(100),
  amount: money, frequency: z.enum(['monthly', 'weekly']), monthlyDay: z.number().int().min(1).max(31).optional(),
  advanceIfWeekend: z.boolean().optional(), active: z.boolean(), notes: z.string().max(5000).optional(),
  paymentMethod: z.string().max(40),
});
const expense = z.object({
  id: z.string().min(1).max(100), description: z.string().min(1).max(1000), category: z.string().max(100),
  amount: money, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), paymentMethod: z.string().max(40),
  receiptNr: z.string().max(200).optional(),
});
export const financeStateSchema = z.object({
  version: z.number().int().positive(),
  employees: z.array(employee).max(1000),
  recurringExpenses: z.array(recurring).max(5000),
  otherExpenses: z.array(expense).max(10000),
}).superRefine((data, ctx) => {
  for (const key of ['employees', 'recurringExpenses', 'otherExpenses'] as const) {
    if (new Set(data[key].map(item => item.id)).size !== data[key].length) {
      ctx.addIssue({ code: 'custom', path: [key], message: 'Identificadores duplicados' });
    }
  }
});

export async function handleFinanceRequest(request: IncomingMessage, response: ServerResponse, pathname: string, claims: Claims | null) {
  if (!pathname.startsWith('/api/finance/')) return false;
  if (!requireRole(response, claims, 'admin')) return true;
  if (!financeVaultExpiry(request, claims)) {
    sendJson(response, 403, { code: 'FINANCE_LOCKED', message: 'Desbloquea la bóveda con autenticación en dos pasos' });
    return true;
  }
  if (pathname === '/api/finance/state' && request.method === 'GET') {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT version,payload FROM finance_state WHERE id=1');
    if (!rows[0]) fail(503, 'Ejecuta las migraciones financieras antes de continuar');
    const payload = typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
    sendJson(response, 200, { ...payload, version: Number(rows[0].version) });
    return true;
  }
  if (pathname === '/api/finance/state' && request.method === 'PUT') {
    const { version, ...payload } = financeStateSchema.parse(await readBody(request));
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<ResultSetHeader>(
        'UPDATE finance_state SET payload=?,version=version+1 WHERE id=1 AND version=?', [JSON.stringify(payload), version],
      );
      if (!result.affectedRows) fail(409, 'Las finanzas cambiaron en otro equipo. Recarga antes de guardar');
      await connection.execute(
        "INSERT INTO audit_logs (user_id,action,resource_type,resource_id,details) VALUES (?,'FINANCE_UPDATED','finance_state','1',?)",
        [claims!.sub, JSON.stringify({ previousVersion: version, version: version + 1,
          employees: payload.employees.length, recurringExpenses: payload.recurringExpenses.length, otherExpenses: payload.otherExpenses.length })],
      );
      await connection.commit();
      sendJson(response, 200, { ...payload, version: version + 1 });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
    return true;
  }
  if (pathname === '/api/finance/movements' && request.method === 'GET') {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id,order_id AS orderId,kind,amount,effective_at AS effectiveAt,source FROM finance_movements ORDER BY id',
    );
    sendJson(response, 200, rows.map(row => ({ ...row, amount: Number(row.amount) })));
    return true;
  }
  if (pathname === '/api/finance/closures' && request.method === 'GET') {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM finance_closures ORDER BY week_start DESC');
    sendJson(response, 200, rows);
    return true;
  }
  // Closing a period needs reconciled payments, not a client-supplied estimate.
  if (pathname === '/api/finance/closures' && request.method === 'POST') {
    fail(409, 'El cierre requiere conciliación de movimientos históricos. Los reportes son provisionales y no constituyen un cierre contable');
  }
  fail(404, 'Ruta financiera no encontrada');
}
