import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export interface CustomerTimelineEvent {
  id: string;
  type: 'call_pbx' | 'call_manual' | 'message_outbox' | 'employee_note';
  timestamp: string;
  authorOrAttendedBy: string;
  title: string;
  summary: string;
  status?: string;
  audioUrl?: string | null;
  durationSeconds?: number;
  qaScore?: number | null;
  qaSummary?: string | null;
  transcript?: string | null;
  orderCode?: string | null;
  orderId?: string | null;
  noteType?: string;
}

export interface CustomerConversationSummary {
  customerId: number;
  customerName: string;
  phone: string;
  whatsapp?: string | null;
  company?: string | null;
  totalOrders: number;
  activeOrders: number;
  isUnregistered?: boolean;
  lastInteractionAt: string | null;
  lastInteractionType: 'call' | 'message' | 'note' | null;
  lastInteractionSummary: string | null;
  lastInteractionAuthor: string | null;
}

const cleanPhoneDigits = (val?: string | null): string => {
  if (!val) return '';
  return val.replace(/\D/g, '');
};

const phoneSuffix = (val?: string | null): string => {
  const digits = cleanPhoneDigits(val);
  return digits.length > 7 ? digits.slice(-8) : digits;
};

/**
 * Busca clientes con resumen de su última interacción
 */
export async function listCustomerConversations(
  pool: Pool,
  query: string = '',
  limit: number = 50,
): Promise<CustomerConversationSummary[]> {
  const term = query.trim();
  const searchPattern = `%${term}%`;
  const digits = cleanPhoneDigits(term);
  const digitPattern = digits ? `%${digits}%` : '';

  let sql = `
    SELECT c.id, c.first_name, c.last_name, c.phone, c.whatsapp, c.company,
           COUNT(DISTINCT o.id) AS total_orders,
           SUM(CASE WHEN o.id IS NOT NULL AND o.status NOT IN ('entregado', 'cancelado', 'reembolsado', 'archivado') THEN 1 ELSE 0 END) AS active_orders
      FROM customers c
      LEFT JOIN orders o ON o.customer_id = c.id AND o.deleted_at IS NULL
     WHERE c.deleted_at IS NULL
  `;
  const params: unknown[] = [];

  if (term) {
    sql += `
      AND (
        c.first_name LIKE ? OR c.last_name LIKE ? OR CONCAT(c.first_name, ' ', COALESCE(c.last_name, '')) LIKE ?
        OR c.company LIKE ?
        ${digitPattern ? 'OR c.phone LIKE ? OR c.whatsapp LIKE ?' : ''}
        OR o.order_code LIKE ?
      )
    `;
    params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    if (digitPattern) {
      params.push(digitPattern, digitPattern);
    }
    params.push(searchPattern);
  }

  sql += `
     GROUP BY c.id
     ORDER BY c.created_at DESC
     LIMIT ?
  `;
  params.push(Math.min(100, Math.max(1, limit)));

  // Cargar todos los sufijos de teléfonos de clientes registrados para evitar falsos "no registrados"
  const registeredPhoneSuffixes = new Set<string>();
  const phoneToCustomerMap = new Map<string, { id: number; fullName: string }>();
  try {
    const [allCustPhones] = await pool.query<RowDataPacket[]>(
      'SELECT id, first_name, last_name, phone, whatsapp FROM customers WHERE deleted_at IS NULL AND (phone IS NOT NULL OR whatsapp IS NOT NULL)'
    );
    for (const cp of allCustPhones) {
      const fn = [cp.first_name, cp.last_name].filter(Boolean).join(' ').trim() || 'Cliente';
      const s1 = phoneSuffix(cp.phone);
      if (s1 && s1.length >= 5) {
        registeredPhoneSuffixes.add(s1);
        phoneToCustomerMap.set(s1, { id: Number(cp.id), fullName: fn });
      }
      const s2 = phoneSuffix(cp.whatsapp);
      if (s2 && s2.length >= 5) {
        registeredPhoneSuffixes.add(s2);
        phoneToCustomerMap.set(s2, { id: Number(cp.id), fullName: fn });
      }
    }
  } catch {
    // Continuar si falla lectura masiva
  }

  const [customerRows] = await pool.query<RowDataPacket[]>(sql, params);
  const results: CustomerConversationSummary[] = [];

  for (const row of customerRows) {
    const cId = Number(row.id);
    const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Cliente sin nombre';
    const rawPhone = String(row.phone || row.whatsapp || '');
    const pSuffix = phoneSuffix(rawPhone);
    if (pSuffix) registeredPhoneSuffixes.add(pSuffix);

    // Obtener la última interacción rápida de notas, llamadas PBX o registros manuales
    let lastAt: string | null = null;
    let lastType: 'call' | 'message' | 'note' | null = null;
    let lastSummary: string | null = null;
    let lastAuthor: string | null = null;

    // 1. Última nota de conversación
    try {
      const [noteRows] = await pool.query<RowDataPacket[]>(
        `SELECT content, author_name, created_at, note_type
           FROM customer_conversation_notes
          WHERE customer_id = ?
          ORDER BY created_at DESC LIMIT 1`,
        [cId],
      );
      if (noteRows.length > 0) {
        lastAt = new Date(noteRows[0].created_at).toISOString();
        lastType = 'note';
        lastSummary = String(noteRows[0].content).slice(0, 100);
        lastAuthor = String(noteRows[0].author_name);
      }
    } catch {
      // Ignorar si la tabla aún no está lista
    }

    // 2. Última llamada PBX
    try {
      if (pSuffix) {
        const [callRows] = await pool.query<RowDataPacket[]>(
          `SELECT started_at, answered_by_ext, status, direction, duration_seconds, qa_result
             FROM pbx_call_logs
            WHERE (client_id = ? OR caller_number LIKE ?)
            ORDER BY started_at DESC LIMIT 1`,
          [cId, `%${pSuffix}`],
        );
        if (callRows.length > 0) {
          const callDate = new Date(callRows[0].started_at).toISOString();
          if (!lastAt || new Date(callDate) > new Date(lastAt)) {
            lastAt = callDate;
            lastType = 'call';
            const statusLabel = callRows[0].status === 'answered' ? 'Llamada contestada' : 'Llamada no contestada';
            const dur = Number(callRows[0].duration_seconds || 0);
            const ext = callRows[0].answered_by_ext ? `Ext ${callRows[0].answered_by_ext}` : 'Sin contestar';
            lastSummary = `${statusLabel} (${dur}s) · ${ext}`;
            lastAuthor = ext;
          }
        }
      }
    } catch {
      // Ignorar fallos de tabla
    }

    results.push({
      customerId: cId,
      customerName: fullName,
      phone: rawPhone,
      whatsapp: row.whatsapp || null,
      company: row.company || null,
      totalOrders: Number(row.total_orders || 0),
      activeOrders: Number(row.active_orders || 0),
      isUnregistered: false,
      lastInteractionAt: lastAt,
      lastInteractionType: lastType,
      lastInteractionSummary: lastSummary,
      lastInteractionAuthor: lastAuthor,
    });
  }

  // 3. Incluir llamadas externas de números NO registrados en customers
  try {
    const [unregCallRows] = await pool.query<RowDataPacket[]>(
      `SELECT id, caller_number, caller_name, started_at, status, direction, duration_seconds, answered_by_ext
         FROM pbx_call_logs
        WHERE client_id IS NULL
          AND CHAR_LENGTH(caller_number) >= 7
          AND caller_number NOT IN ('169014', '9844004618')
        ORDER BY started_at DESC
        LIMIT 200`,
    );

    const seenUnregSuffixes = new Set<string>();
    let unregCounter = -1;

    for (const call of unregCallRows) {
      const rawNum = String(call.caller_number || '');
      const pSuff = phoneSuffix(rawNum);
      if (!pSuff || pSuff.length < 5) continue;

      // Si pertenece a un cliente registrado en la BD, vincular el call_log y no mostrarlo como desconocido
      const existingCustomer = phoneToCustomerMap.get(pSuff);
      if (existingCustomer) {
        pool.execute(
          'UPDATE pbx_call_logs SET client_id = ?, client_name = ? WHERE id = ?',
          [existingCustomer.id, existingCustomer.fullName, call.id],
        ).catch(() => {});
        continue;
      }

      if (registeredPhoneSuffixes.has(pSuff) || seenUnregSuffixes.has(pSuff)) continue;

      if (term) {
        const matchTerm = rawNum.toLowerCase().includes(term.toLowerCase()) ||
          (call.caller_name && String(call.caller_name).toLowerCase().includes(term.toLowerCase()));
        if (!matchTerm) continue;
      }

      seenUnregSuffixes.add(pSuff);

      const statusLabel = call.status === 'answered' ? 'Llamada contestada' : 'Llamada no contestada';
      const dur = Number(call.duration_seconds || 0);
      const ext = call.answered_by_ext ? `Ext ${call.answered_by_ext}` : 'Sin contestar';

      results.push({
        customerId: unregCounter--,
        customerName: call.caller_name || 'Número no registrado',
        phone: rawNum,
        whatsapp: null,
        company: null,
        totalOrders: 0,
        activeOrders: 0,
        isUnregistered: true,
        lastInteractionAt: new Date(call.started_at).toISOString(),
        lastInteractionType: 'call',
        lastInteractionSummary: `${statusLabel} (${dur}s) · ${ext}`,
        lastInteractionAuthor: ext,
      });
    }
  } catch {
    // Ignorar si falla lectura de llamadas no registradas
  }

  // Ordenar por última interacción más reciente si existe
  results.sort((a, b) => {
    if (!a.lastInteractionAt && !b.lastInteractionAt) return 0;
    if (!a.lastInteractionAt) return 1;
    if (!b.lastInteractionAt) return -1;
    return new Date(b.lastInteractionAt).getTime() - new Date(a.lastInteractionAt).getTime();
  });

  return results;
}

/**
 * Obtiene el timeline omnicanal completo de un cliente
 */
export async function getCustomerTimeline(
  pool: Pool,
  customerId: number,
  customerPhone?: string,
): Promise<{ customer: any; events: CustomerTimelineEvent[]; orders: any[] }> {
  // 1. Datos del cliente
  let customer: any;
  let phone = customerPhone || '';

  // Si customerId <= 0 o negativo pero se tiene teléfono, intentar resolver al cliente registrado real
  if (customerId <= 0 && phone) {
    const pSuff = phoneSuffix(phone);
    if (pSuff && pSuff.length >= 5) {
      try {
        const [matchedCust] = await pool.query<RowDataPacket[]>(
          `SELECT * FROM customers 
            WHERE deleted_at IS NULL AND (phone LIKE ? OR whatsapp LIKE ?) 
            ORDER BY id DESC LIMIT 1`,
          [`%${pSuff}`, `%${pSuff}`],
        );
        if (matchedCust.length > 0) {
          customer = matchedCust[0];
          customerId = Number(customer.id);
          phone = customer.phone || customer.whatsapp || phone;
        }
      } catch {
        // Continuar si falla búsqueda por sufijo
      }
    }
  }

  if (!customer && customerId > 0) {
    const [custRows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM customers WHERE id = ? LIMIT 1',
      [customerId],
    );
    if (custRows.length > 0) {
      customer = custRows[0];
      phone = customerPhone || customer.phone || customer.whatsapp || '';
    }
  }

  if (!customer) {
    // Si no está registrado en customers, extraer el nombre del llamante desde pbx_call_logs si existe
    let displayName = 'Número no registrado';
    if (phone) {
      const pSuff = phoneSuffix(phone);
      if (pSuff) {
        try {
          const [lastCall] = await pool.query<RowDataPacket[]>(
            `SELECT caller_name, client_name FROM pbx_call_logs 
              WHERE caller_number LIKE ? AND (caller_name IS NOT NULL OR client_name IS NOT NULL)
              ORDER BY started_at DESC LIMIT 1`,
            [`%${pSuff}`],
          );
          if (lastCall[0]?.caller_name || lastCall[0]?.client_name) {
            displayName = String(lastCall[0].caller_name || lastCall[0].client_name);
          }
        } catch {
          // Ignorar fallo de búsqueda en pbx_call_logs
        }
      }
    }

    customer = {
      id: customerId,
      first_name: displayName,
      last_name: '',
      phone: phone || 'Sin número',
      company: null,
      address_shipping: null,
      is_unregistered: true,
    };
  }

  const pSuffix = phoneSuffix(phone);
  const events: CustomerTimelineEvent[] = [];

  // 2. Órdenes asociadas al cliente
  let orderRows: RowDataPacket[] = [];
  try {
    if (customerId > 0) {
      const [orders] = await pool.query<RowDataPacket[]>(
        `SELECT o.id, o.order_code, o.brand, o.model, o.year, o.status, o.price AS total_price, o.down_payment, o.created_at, o.delivered_at, u.name AS advisor
           FROM orders o
           LEFT JOIN users u ON u.id = o.user_id
          WHERE o.customer_id = ? AND o.deleted_at IS NULL
          ORDER BY o.created_at DESC`,
        [customerId],
      );
      orderRows = orders;
    } else if (pSuffix && pSuffix.length >= 5) {
      const [orders] = await pool.query<RowDataPacket[]>(
        `SELECT o.id, o.order_code, o.brand, o.model, o.year, o.status, o.price AS total_price, o.down_payment, o.created_at, o.delivered_at, u.name AS advisor
           FROM orders o
           JOIN customers c ON c.id = o.customer_id
           LEFT JOIN users u ON u.id = o.user_id
          WHERE (c.phone LIKE ? OR c.whatsapp LIKE ?) AND o.deleted_at IS NULL
          ORDER BY o.created_at DESC`,
        [`%${pSuffix}`, `%${pSuffix}`],
      );
      orderRows = orders;
    }
  } catch {
    // Ignorar si falla lectura de órdenes
  }

  // 3. Notas de conversación dejadas por empleados
  try {
    const noteParams: unknown[] = [customerId];
    let noteSql = `
      SELECT n.id, n.order_id, n.author_name, n.note_type, n.content, n.created_at, o.order_code
        FROM customer_conversation_notes n
        LEFT JOIN orders o ON o.id = n.order_id
        LEFT JOIN customers c ON c.id = n.customer_id
       WHERE (n.customer_id = ?
    `;
    if (pSuffix && pSuffix.length >= 5) {
      noteSql += ` OR c.phone LIKE ? OR c.whatsapp LIKE ?)`;
      noteParams.push(`%${pSuffix}`, `%${pSuffix}`);
    } else {
      noteSql += `)`;
    }
    noteSql += ` ORDER BY n.created_at DESC`;

    const [noteRows] = await pool.query<RowDataPacket[]>(noteSql, noteParams);
    for (const r of noteRows) {
      events.push({
        id: `note-${r.id}`,
        type: 'employee_note',
        timestamp: new Date(r.created_at).toISOString(),
        authorOrAttendedBy: r.author_name || 'Empleado',
        title: r.note_type === 'call_summary'
          ? 'Resumen de llamada con cliente'
          : r.note_type === 'acuerdo'
            ? 'Acuerdo con cliente'
            : r.note_type === 'llamada_manual'
              ? 'Llamada telefónica'
              : 'Nota interna',
        summary: r.content,
        orderCode: r.order_code || null,
        orderId: r.order_id ? String(r.order_id) : null,
        noteType: r.note_type || 'nota',
      });
    }
  } catch {
    // Si la tabla no existe aún
  }

  // 4. Llamadas de la centralita PBX
  try {
    if (pSuffix) {
      const [pbxRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, direction, status, caller_number, caller_name, answered_by_ext,
                duration_seconds, billsec_seconds, started_at, recording_url,
                qa_score, qa_result, order_code, order_id
           FROM pbx_call_logs
          WHERE (client_id = ? OR caller_number LIKE ?)
          ORDER BY started_at DESC
          LIMIT 100`,
        [customerId, `%${pSuffix}`],
      );

      for (const call of pbxRows) {
        let qaSummaryText: string | null = null;
        let transcriptText: string | null = null;
        if (call.qa_result) {
          try {
            const parsed = typeof call.qa_result === 'string' ? JSON.parse(call.qa_result) : call.qa_result;
            qaSummaryText = parsed.summary || null;
            transcriptText = parsed.transcript || null;
          } catch {
            // Ignorar parse error
          }
        }

        const isAnswered = call.status === 'answered' || Number(call.duration_seconds || 0) > 0;
        const dirLabel = call.direction === 'outbound' ? 'Llamada saliente' : 'Llamada entrante';
        const extLabel = call.answered_by_ext ? `Ext ${call.answered_by_ext}` : 'Sin contestar';

        events.push({
          id: `pbx-${call.id}`,
          type: 'call_pbx',
          timestamp: new Date(call.started_at).toISOString(),
          authorOrAttendedBy: extLabel,
          title: `${dirLabel} (${call.duration_seconds || 0}s)`,
          summary: qaSummaryText || (isAnswered ? `Llamada completada atendida por ${extLabel}` : 'Llamada no contestada o perdida'),
          status: call.status,
          durationSeconds: Number(call.duration_seconds || 0),
          audioUrl: call.recording_url || null,
          qaScore: call.qa_score != null ? Number(call.qa_score) : null,
          qaSummary: qaSummaryText,
          transcript: transcriptText,
          orderCode: call.order_code || null,
          orderId: call.order_id || null,
        });
      }
    }
  } catch {
    // Fallo no crítico en pbx
  }

  // 5. Registros manuales en call_register
  try {
    if (pSuffix) {
      const [regRows] = await pool.query<RowDataPacket[]>(
        `SELECT r.id, r.order_id, COALESCE(r.conversation_summary, r.whatsapp_message, 'Sin descripción') AS description, r.created_at, r.attended_by, r.whatsapp_dispatched, r.whatsapp_message, o.order_code
           FROM call_register r
           LEFT JOIN orders o ON o.id = r.order_id
          WHERE (r.caller_phone LIKE ? OR r.caller_phone LIKE ?)
          ORDER BY r.created_at DESC LIMIT 50`,
        [`%${pSuffix}`, `%${phone}`],
      );
      for (const reg of regRows) {
        events.push({
          id: `callreg-${reg.id}`,
          type: 'call_manual',
          timestamp: new Date(reg.created_at).toISOString(),
          authorOrAttendedBy: reg.attended_by || 'Asesor',
          title: 'Registro de llamada en bitácora',
          summary: reg.description || reg.whatsapp_message || 'Sin descripción detallada',
          orderCode: reg.order_code || null,
          orderId: reg.order_id ? String(reg.order_id) : null,
        });
      }
    }
  } catch {
    // Ignorar si call_register no tiene columnas
  }

  // Ordenar todos los eventos de más reciente a más antiguo
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return {
    customer,
    events,
    orders: orderRows,
  };
}

/**
 * Agrega un resumen de llamada o nota interna para el expediente del cliente
 */
export async function addCustomerConversationNote(
  pool: Pool,
  params: {
    customerId: number;
    orderId?: number | null;
    userId?: number | null;
    authorName: string;
    noteType?: string;
    content: string;
    createdAt?: string | Date | null;
  },
): Promise<{ id: number; createdAt: string }> {
  const noteType = params.noteType || 'call_summary';
  const customDate = params.createdAt ? new Date(params.createdAt) : new Date();
  const sqlDate = Number.isNaN(customDate.getTime()) ? null : customDate.toISOString().slice(0, 19).replace('T', ' ');

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO customer_conversation_notes (customer_id, order_id, user_id, author_name, note_type, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
    [
      params.customerId,
      params.orderId || null,
      params.userId || null,
      params.authorName,
      noteType,
      params.content.trim(),
      sqlDate,
    ],
  );

  return {
    id: result.insertId,
    createdAt: (sqlDate ? new Date(sqlDate + 'Z') : new Date()).toISOString(),
  };
}
