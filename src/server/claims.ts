import type { IncomingMessage, ServerResponse } from 'node:http';
import { RowDataPacket } from 'mysql2/promise';
import { pool } from './config';
import { requireRole, type Claims } from './auth';
import { sendJson } from './http';
import { statusFromDatabase } from './orders';

export const mapClaimStatus = (status: string) => {
  const normalized = status.toLowerCase();
  if (normalized.includes('resolved') || normalized.includes('resuelt')) return 'Resolved';
  if (normalized.includes('denied') || normalized.includes('deneg') || normalized.includes('rechaz')) return 'Denied';
  if (normalized.includes('in process') || normalized.includes('proceso')) return 'In Process';
  return 'Pending';
};

export const getClaims = async () => {  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT cl.*, o.order_code, o.vin_nr, o.brand, o.model, o.year, o.product_type, o.product_specs, o.stock_nr,
      o.status AS order_status, o.warranty_days, c.first_name, c.last_name, c.phone, c.email, u.name AS advisor,
      (SELECT so.status FROM status_orders so WHERE so.order_id = cl.order_id AND so.created_at <= cl.created_at AND so.status <> 'Reclamo' ORDER BY so.created_at DESC, so.id DESC LIMIT 1) AS previous_status
    FROM claims cl
    LEFT JOIN orders o ON o.id = cl.order_id
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN users u ON u.id = cl.assigned_user_id
    WHERE cl.deleted_at IS NULL
    ORDER BY cl.created_at DESC
  `);

  const [callRows] = await pool.query<RowDataPacket[]>(`
    SELECT cr.* FROM call_register cr
    ORDER BY cr.created_at ASC
  `);

  const callsByClaimOrOrder = new Map<string, any[]>();
  for (const call of callRows) {
    const key = call.claim_id ? `claim-${call.claim_id}` : `order-${call.order_id}`;
    const list = callsByClaimOrOrder.get(key) || [];
    list.push({
      id: `CALL-${call.id}`,
      claimId: call.claim_id ? `REC-${call.claim_id}` : '',
      callNumber: list.length + 1,
      callerName: call.caller_name || '',
      callerPhone: call.caller_phone || '',
      attendedBy: call.attended_by || '',
      conversationSummary: call.conversation_summary || '',
      createdAt: call.created_at,
      whatsappDispatched: Boolean(call.whatsapp_dispatched),
      whatsappMessage: call.whatsapp_message || '',
    });
    callsByClaimOrOrder.set(key, list);
  }

  return rows.map((row) => {
    const claimCalls = [
      ...(callsByClaimOrOrder.get(`claim-${row.id}`) || []),
      ...(callsByClaimOrOrder.get(`order-${row.order_id}`) || []),
    ];
    const uniqueCalls = Array.from(new Map(claimCalls.map((c) => [c.id, c])).values());

    let evidenceFiles: string[] = [];
    try {
      if (row.evidence_files) {
        const parsed = typeof row.evidence_files === 'string' ? JSON.parse(row.evidence_files) : row.evidence_files;
        if (Array.isArray(parsed)) evidenceFiles = parsed;
      }
    } catch {
      evidenceFiles = [];
    }

    return {
      id: `REC-${row.id}`,
      orderId: String(row.order_id || ''),
      orderCode: row.order_code || `ORD-${row.order_id}`,
      customerName: [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Cliente sin nombre',
      customerPhone: row.phone || '',
      customerEmail: row.email || '',
      vehicle: [row.year, row.brand, row.model].filter(Boolean).join(' ') || 'Vehículo sin datos',
      vin: row.vin_nr || '',
      mainPart: row.product_type || 'Refacción',
      partSpecs: row.product_specs || '',
      claimReason: row.description || '',
      resolutionNotes: row.resolution_notes || '',
      type: 'Reclamo de orden',
      priority: 'Media' as const,
      status: mapClaimStatus(row.status || ''),
      stage: row.stage || (mapClaimStatus(row.status || '') === 'Resolved' ? 'resolved' : mapClaimStatus(row.status || '') === 'Denied' ? 'denied' : mapClaimStatus(row.status || '') === 'In Process' ? 'review' : 'registered'),
      nextReviewDate: row.next_review_date ? new Date(row.next_review_date).toISOString().slice(0, 10) : undefined,
      evidenceFiles,
      assignedUserId: row.assigned_user_id ? Number(row.assigned_user_id) : null,
      previousOrderStatus: row.previous_order_status || row.previous_status ? statusFromDatabase(row.previous_order_status || row.previous_status) : undefined,
      advisor: row.advisor || 'Sin asignar',
      createdAt: row.created_at,
      resolvedAt: ['Resolved', 'Denied'].includes(mapClaimStatus(row.status || '')) ? row.updated_at : undefined,
      callCount: uniqueCalls.length,
      calls: uniqueCalls,
      warrantyDays: row.warranty_days || 0,
      stockNumber: row.stock_nr || '',
    };
  });
};

export const handleClaimsListRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  claims: Claims | null
): Promise<boolean> => {
  if (request.method !== 'GET' || pathname !== '/api/claims') return false;
  if (!claims) {
    sendJson(response, 401, { message: 'Autenticación requerida' });
    return true;
  }
  if (!requireRole(response, claims, 'admin', 'operator')) return true;
  sendJson(response, 200, await getClaims());
  return true;
};
