import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RowDataPacket } from 'mysql2/promise';
import { pool } from './config';
import { requireRole, type Claims } from './auth';
import { sendJson } from './http';
import { financeDateKey, sumMoney, type FinanceMovement } from '../utils/finance';

export async function handleAnalyticsRequest(request: IncomingMessage, response: ServerResponse, pathname: string, claims: Claims | null) {
  if (pathname !== '/api/analytics/income' || request.method !== 'GET') return false;
  if (!requireRole(response, claims, 'admin')) return true;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT kind,amount,effective_at FROM finance_movements
     WHERE source <> 'legacy_baseline' AND effective_at IS NOT NULL ORDER BY id`,
  );
  const totals = new Map<string, FinanceMovement>();
  for (const row of rows) {
    const date = row.effective_at instanceof Date ? row.effective_at : new Date(row.effective_at);
    const day = financeDateKey(date);
    const id = `${day}-${row.kind}`;
    const previous = totals.get(id);
    totals.set(id, {
      id, orderId: '', kind: row.kind, amount: sumMoney([previous?.amount ?? 0, Number(row.amount)]),
      effectiveAt: day, source: 'daily_aggregate',
    });
  }
  response.setHeader('Cache-Control', 'no-store');
  sendJson(response, 200, [...totals.values()]);
  return true;
}
