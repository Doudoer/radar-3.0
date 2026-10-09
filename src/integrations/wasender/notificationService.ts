import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { WasenderClient, formatWasenderPhone } from './client';
import {
  NotificationChannelConfig,
  NotificationChannelKey,
  ExternalContact,
  OperatorContact,
  NotificationConfigResponse,
  DEFAULT_NOTIFICATION_CHANNELS,
} from './notificationTypes';
import {
  ListaReclamosTemplateData,
  PendingClaimItem,
  formatListaReclamosMessage,
} from './notificationTemplates';

/**
 * Ensures MySQL tables for WhatsApp notification routing exist and seeds default 8 channels.
 */
export async function ensureNotificationTables(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_notification_settings (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      channel_key VARCHAR(60) NOT NULL UNIQUE,
      channel_name VARCHAR(120) NOT NULL,
      category VARCHAR(80) NOT NULL,
      description TEXT NULL,
      is_enabled TINYINT(1) NOT NULL DEFAULT 1,
      target_type VARCHAR(40) NOT NULL DEFAULT 'configurable_multicast',
      superadmin_enabled TINYINT(1) NOT NULL DEFAULT 1,
      operator_ids JSON NULL,
      external_contact_ids JSON NULL,
      trigger_notes VARCHAR(255) NULL,
      badge_label VARCHAR(80) NULL,
      icon VARCHAR(50) NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_external_contacts (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      phone VARCHAR(50) NOT NULL,
      label VARCHAR(100) NULL,
      notes TEXT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      subscribed_channels JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // Seed default 8 channels if missing
  for (const def of DEFAULT_NOTIFICATION_CHANNELS) {
    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM whatsapp_notification_settings WHERE channel_key = ?',
      [def.key]
    );
    if (existing.length === 0) {
      await pool.query(
        `INSERT INTO whatsapp_notification_settings 
          (channel_key, channel_name, category, description, is_enabled, target_type, superadmin_enabled, operator_ids, external_contact_ids, trigger_notes, badge_label, icon)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          def.key,
          def.name,
          def.category,
          def.description,
          def.isEnabled ? 1 : 0,
          def.targetType,
          def.superadminEnabled ? 1 : 0,
          JSON.stringify(def.operatorIds),
          JSON.stringify(def.externalContactIds),
          def.triggerNotes,
          def.badgeLabel,
          def.icon,
        ]
      );
    }
  }
}

/**
 * Fetches the full notification configuration: channels, registered operators, external contacts, and sandbox status.
 */
export async function getNotificationConfig(
  pool: Pool,
  wasender: WasenderClient
): Promise<NotificationConfigResponse> {
  await ensureNotificationTables(pool);

  // 1. Fetch channels from DB
  const [channelRows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM whatsapp_notification_settings ORDER BY id ASC'
  );

  const channels: NotificationChannelConfig[] = channelRows.map((row) => {
    let operatorIds: number[] = [];
    let externalContactIds: number[] = [];
    try {
      operatorIds = typeof row.operator_ids === 'string' ? JSON.parse(row.operator_ids) : row.operator_ids || [];
    } catch {
      operatorIds = [];
    }
    try {
      externalContactIds =
        typeof row.external_contact_ids === 'string'
          ? JSON.parse(row.external_contact_ids)
          : row.external_contact_ids || [];
    } catch {
      externalContactIds = [];
    }

    return {
      key: row.channel_key as NotificationChannelKey,
      name: row.channel_name,
      category: row.category,
      description: row.description || '',
      targetType: row.target_type,
      isEnabled: Boolean(row.is_enabled),
      superadminEnabled: Boolean(row.superadmin_enabled),
      operatorIds: Array.isArray(operatorIds) ? operatorIds : [],
      externalContactIds: Array.isArray(externalContactIds) ? externalContactIds : [],
      triggerNotes: row.trigger_notes || '',
      badgeLabel: row.badge_label || '',
      icon: row.icon || 'notifications',
    };
  });

  // 2. Fetch operators / users with their phones
  const [userRows] = await pool.query<RowDataPacket[]>(
    'SELECT id, name, email, phone, role, avatar_url FROM users ORDER BY name ASC'
  );

  const operators: OperatorContact[] = userRows.map((u) => ({
    id: Number(u.id),
    name: String(u.name || 'Usuario'),
    email: String(u.email || ''),
    phone: u.phone ? String(u.phone) : null,
    role: String(u.role || 'operator'),
    avatarUrl: u.avatar_url ? String(u.avatar_url) : null,
  }));

  // 3. Fetch external contacts
  const [contactRows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM whatsapp_external_contacts ORDER BY name ASC'
  );

  const externalContacts: ExternalContact[] = contactRows.map((c) => {
    let subscribedChannels: NotificationChannelKey[] = [];
    try {
      subscribedChannels =
        typeof c.subscribed_channels === 'string'
          ? JSON.parse(c.subscribed_channels)
          : c.subscribed_channels || [];
    } catch {
      subscribedChannels = [];
    }

    return {
      id: Number(c.id),
      name: String(c.name),
      phone: String(c.phone),
      label: c.label ? String(c.label) : undefined,
      notes: c.notes ? String(c.notes) : undefined,
      isActive: Boolean(c.is_active),
      subscribedChannels: Array.isArray(subscribedChannels) ? subscribedChannels : [],
      createdAt: c.created_at ? String(c.created_at) : undefined,
      updatedAt: c.updated_at ? String(c.updated_at) : undefined,
    };
  });

  return {
    channels,
    operators,
    externalContacts,
    sandboxInfo: {
      isTestMode: wasender.isTestMode,
      designatedTestPhone: wasender.designatedTestPhone,
      sessionName: 'Douglas Movistar',
      connectedPhone: '+584145380654',
      accountName: 'Control Rodriguez Salvage Yard',
    },
  };
}

/**
 * Saves channel configurations.
 */
export async function updateNotificationChannels(
  pool: Pool,
  channels: NotificationChannelConfig[]
): Promise<void> {
  await ensureNotificationTables(pool);

  for (const ch of channels) {
    await pool.query(
      `UPDATE whatsapp_notification_settings
       SET is_enabled = ?,
           superadmin_enabled = ?,
           operator_ids = ?,
           external_contact_ids = ?
       WHERE channel_key = ?`,
      [
        ch.isEnabled ? 1 : 0,
        ch.superadminEnabled ? 1 : 0,
        JSON.stringify(ch.operatorIds || []),
        JSON.stringify(ch.externalContactIds || []),
        ch.key,
      ]
    );
  }
}

/**
 * External contacts CRUD
 */
export async function createExternalContact(
  pool: Pool,
  contact: Omit<ExternalContact, 'id' | 'createdAt' | 'updatedAt'>
): Promise<ExternalContact> {
  await ensureNotificationTables(pool);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO whatsapp_external_contacts (name, phone, label, notes, is_active, subscribed_channels)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      contact.name,
      contact.phone,
      contact.label || null,
      contact.notes || null,
      contact.isActive !== false ? 1 : 0,
      JSON.stringify(contact.subscribedChannels || []),
    ]
  );

  return {
    ...contact,
    id: result.insertId,
  };
}

export async function updateExternalContact(
  pool: Pool,
  id: number,
  contact: Partial<ExternalContact>
): Promise<void> {
  await ensureNotificationTables(pool);

  const fields: string[] = [];
  const values: any[] = [];

  if (contact.name !== undefined) {
    fields.push('name = ?');
    values.push(contact.name);
  }
  if (contact.phone !== undefined) {
    fields.push('phone = ?');
    values.push(contact.phone);
  }
  if (contact.label !== undefined) {
    fields.push('label = ?');
    values.push(contact.label);
  }
  if (contact.notes !== undefined) {
    fields.push('notes = ?');
    values.push(contact.notes);
  }
  if (contact.isActive !== undefined) {
    fields.push('is_active = ?');
    values.push(contact.isActive ? 1 : 0);
  }
  if (contact.subscribedChannels !== undefined) {
    fields.push('subscribed_channels = ?');
    values.push(JSON.stringify(contact.subscribedChannels));
  }

  if (fields.length > 0) {
    values.push(id);
    await pool.query(`UPDATE whatsapp_external_contacts SET ${fields.join(', ')} WHERE id = ?`, values);
  }
}

export async function deleteExternalContact(pool: Pool, id: number): Promise<void> {
  await ensureNotificationTables(pool);
  await pool.query('DELETE FROM whatsapp_external_contacts WHERE id = ?', [id]);
}

export interface ResolvedRecipient {
  phone: string;
  name: string;
  roleOrLabel: string;
  source: 'superadmin' | 'creator_operator' | 'assigned_operator' | 'external_contact';
}

export interface ResolveRecipientsResult {
  allowed: boolean;
  channelKey: NotificationChannelKey;
  channelName: string;
  recipients: ResolvedRecipient[];
  skippedReason?: string;
}

/**
 * Resolves the phone numbers that must receive a notification based on the channel key and context.
 */
export async function resolveRecipientsForEvent(
  pool: Pool,
  eventKey: NotificationChannelKey,
  context: {
    creatorUserId?: number;
    creatorPhone?: string;
    creatorName?: string;
    orderStatus?: string;
  } = {}
): Promise<ResolveRecipientsResult> {
  await ensureNotificationTables(pool);

  // Fetch channel rule
  const [channelRows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM whatsapp_notification_settings WHERE channel_key = ?',
    [eventKey]
  );

  if (channelRows.length === 0) {
    return {
      allowed: false,
      channelKey: eventKey,
      channelName: eventKey,
      recipients: [],
      skippedReason: `Canal ${eventKey} no encontrado en la configuración`,
    };
  }

  const channel = channelRows[0];
  if (!channel.is_enabled) {
    return {
      allowed: false,
      channelKey: eventKey,
      channelName: channel.channel_name,
      recipients: [],
      skippedReason: `El canal "${channel.channel_name}" se encuentra desactivado globalmente`,
    };
  }

  const recipients: ResolvedRecipient[] = [];
  const addedPhones = new Set<string>();

  const addRecipient = (phone: string | null | undefined, name: string, roleOrLabel: string, source: ResolvedRecipient['source']) => {
    if (!phone) return;
    const normalized = formatWasenderPhone(phone);
    if (!addedPhones.has(normalized)) {
      addedPhones.add(normalized);
      recipients.push({ phone: normalized, name, roleOrLabel, source });
    }
  };

  // 1. SUPERADMIN ONLY CHANNELS (SOLICITUD_REEMBOLSO, ORDEN_CANCELADA, RESPALDO_AUTOMATICO, BUSQUEDA_SUBASTAS)
  if (channel.target_type === 'superadmin_only') {
    const [admins] = await pool.query<RowDataPacket[]>(
      "SELECT id, name, phone FROM users WHERE role = 'admin'"
    );
    for (const a of admins) {
      if (a.phone) {
        addRecipient(a.phone, a.name, 'Super Admin', 'superadmin');
      }
    }
    return {
      allowed: recipients.length > 0,
      channelKey: eventKey,
      channelName: channel.channel_name,
      recipients,
      skippedReason: recipients.length === 0 ? 'No hay administradores con teléfono registrado' : undefined,
    };
  }

  // 2. CREATOR DYNAMIC RULE (CAMBIO_ESTATUS)
  if (channel.target_type === 'creator_dynamic') {
    // Check specific status condition: ONLY "Listo para Retiro" or "Listo para Envio" / "Listo para Despacho"
    const st = (context.orderStatus || '').toLowerCase().trim();
    const isReadyForPickupOrDelivery =
      st.includes('retiro') ||
      st.includes('envio') ||
      st.includes('envío') ||
      st.includes('despacho') ||
      st === 'listo para retiro' ||
      st === 'listo para despacho' ||
      st === 'listo para envio' ||
      st === 'listo_retiro' ||
      st === 'listo_despacho' ||
      st === 'listo_envio';

    if (!isReadyForPickupOrDelivery) {
      return {
        allowed: false,
        channelKey: eventKey,
        channelName: channel.channel_name,
        recipients: [],
        skippedReason: `Regla no aplica: El estatus "${context.orderStatus || 'N/A'}" no corresponde a "Listo para Retiro" ni "Listo para Despacho".`,
      };
    }

    // Lookup creator user phone
    let foundPhone: string | null = null;
    let foundName: string = context.creatorName || 'Operador Creador';

    if (context.creatorUserId) {
      const [creatorRows] = await pool.query<RowDataPacket[]>(
        'SELECT name, phone FROM users WHERE id = ?',
        [context.creatorUserId]
      );
      if (creatorRows.length > 0) {
        if (creatorRows[0].name) foundName = creatorRows[0].name;
        if (creatorRows[0].phone) foundPhone = creatorRows[0].phone;
      }
    }

    if (!foundPhone && context.creatorPhone) {
      foundPhone = context.creatorPhone;
    }

    if (foundPhone) {
      addRecipient(foundPhone, foundName, 'Operador Creador / Asesor', 'creator_operator');
    }

    // Also notify Super Admin if enabled in config
    if (channel.superadmin_enabled) {
      const [admins] = await pool.query<RowDataPacket[]>(
        "SELECT id, name, phone FROM users WHERE role = 'admin' AND deleted_at IS NULL"
      );
      for (const a of admins) {
        if (a.phone) {
          addRecipient(a.phone, a.name, 'Super Admin', 'superadmin');
        }
      }
    }

    // Also notify extra configured operators
    let operatorIds: number[] = [];
    try {
      operatorIds = Array.isArray(channel.operator_ids)
        ? channel.operator_ids
        : JSON.parse(channel.operator_ids || '[]');
    } catch {
      operatorIds = [];
    }
    if (operatorIds.length > 0) {
      const [ops] = await pool.query<RowDataPacket[]>(
        'SELECT id, name, phone FROM users WHERE id IN (?) AND deleted_at IS NULL',
        [operatorIds]
      );
      for (const op of ops) {
        if (op.phone) addRecipient(op.phone, op.name, 'Operador Asignado', 'assigned_operator');
      }
    }

    // Also notify extra configured external contacts
    let contactIds: number[] = [];
    try {
      contactIds = Array.isArray(channel.external_contact_ids)
        ? channel.external_contact_ids
        : JSON.parse(channel.external_contact_ids || '[]');
    } catch {
      contactIds = [];
    }
    if (contactIds.length > 0) {
      const [contacts] = await pool.query<RowDataPacket[]>(
        'SELECT id, name, phone, department FROM whatsapp_external_contacts WHERE id IN (?) AND is_active = 1',
        [contactIds]
      );
      for (const c of contacts) {
        if (c.phone) addRecipient(c.phone, c.name, c.department || 'Contacto Externo', 'external_contact');
      }
    }

    return {
      allowed: recipients.length > 0,
      channelKey: eventKey,
      channelName: channel.channel_name,
      recipients,
      skippedReason:
        recipients.length === 0
          ? 'El operador creador de la orden no tiene un número telefónico registrado en su perfil.'
          : undefined,
    };
  }

  // 3. CONFIGURABLE MULTICAST (NUEVA_VENTA, NUEVO_RECLAMO, LISTA_RECLAMOS)
  // A) Super Admin if enabled
  if (channel.superadmin_enabled) {
    const [admins] = await pool.query<RowDataPacket[]>(
      "SELECT id, name, phone FROM users WHERE role = 'admin'"
    );
    for (const a of admins) {
      if (a.phone) {
        addRecipient(a.phone, a.name, 'Super Admin', 'superadmin');
      }
    }
  }

  // B) Assigned Operators
  let operatorIds: number[] = [];
  try {
    operatorIds =
      typeof channel.operator_ids === 'string'
        ? JSON.parse(channel.operator_ids)
        : channel.operator_ids || [];
  } catch {
    operatorIds = [];
  }

  if (Array.isArray(operatorIds) && operatorIds.length > 0) {
    const [ops] = await pool.query<RowDataPacket[]>(
      'SELECT id, name, phone, role FROM users WHERE id IN (?)',
      [operatorIds]
    );
    for (const op of ops) {
      if (op.phone) {
        addRecipient(op.phone, op.name, 'Operador Asignado', 'assigned_operator');
      }
    }
  }

  // C) Subscribed External Contacts
  let externalContactIds: number[] = [];
  try {
    externalContactIds =
      typeof channel.external_contact_ids === 'string'
        ? JSON.parse(channel.external_contact_ids)
        : channel.external_contact_ids || [];
  } catch {
    externalContactIds = [];
  }

  // Either explicit IDs in channel or contact has eventKey in subscribed_channels
  const [contacts] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM whatsapp_external_contacts WHERE is_active = 1'
  );

  for (const c of contacts) {
    let subs: string[] = [];
    try {
      subs = typeof c.subscribed_channels === 'string' ? JSON.parse(c.subscribed_channels) : c.subscribed_channels || [];
    } catch {
      subs = [];
    }

    const isSubscribed = subs.includes(eventKey) || externalContactIds.includes(Number(c.id));
    if (isSubscribed && c.phone) {
      addRecipient(c.phone, c.name, c.label || 'Contacto Externo', 'external_contact');
    }
  }

  return {
    allowed: recipients.length > 0,
    channelKey: eventKey,
    channelName: channel.channel_name,
    recipients,
    skippedReason:
      recipients.length === 0
        ? 'No hay destinatarios con número telefónico activo para este canal.'
        : undefined,
  };
}

/**
 * Dispatches a notification across all resolved recipients for a given channel.
 */
export async function dispatchSystemNotification(
  pool: Pool,
  wasender: WasenderClient,
  eventKey: NotificationChannelKey,
  messageText: string,
  context: {
    creatorUserId?: number;
    creatorPhone?: string;
    creatorName?: string;
    orderStatus?: string;
    mediaUrl?: string;
    mediaType?: 'image' | 'file';
    mediaFilename?: string;
  } = {}
): Promise<{
  ok: boolean;
  channelKey: NotificationChannelKey;
  channelName: string;
  totalResolved: number;
  dispatchedCount: number;
  recipients: ResolvedRecipient[];
  skippedReason?: string;
  deliveryResults: Array<{ phone: string; name: string; success: boolean; data?: any; error?: string }>;
}> {
  const resolution = await resolveRecipientsForEvent(pool, eventKey, context);

  if (!resolution.allowed || resolution.recipients.length === 0) {
    console.log(`[Wasender Dispatch] Canal "${eventKey}" omitido. Razón: ${resolution.skippedReason || 'Sin destinatarios válidos'}`);
    return {
      ok: false,
      channelKey: eventKey,
      channelName: resolution.channelName,
      totalResolved: 0,
      dispatchedCount: 0,
      recipients: [],
      skippedReason: resolution.skippedReason || 'No se encontraron destinatarios válidos',
      deliveryResults: [],
    };
  }

  console.log(`[Wasender Dispatch] Transmitiendo notificación para canal [${eventKey}] a ${resolution.recipients.length} destinatario(s):`, resolution.recipients.map((r) => `${r.name} (${r.phone})`));

  const deliveryResults: Array<{ phone: string; name: string; success: boolean; data?: any; error?: string }> = [];
  let dispatchedCount = 0;

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  for (let i = 0; i < resolution.recipients.length; i++) {
    const recipient = resolution.recipients[i];
    if (i > 0) {
      // Respect Wasender account protection policy (1 message every 5 seconds)
      await sleep(5100);
    }

    try {
      let res;
      if (context.mediaUrl && context.mediaType === 'image') {
        res = await wasender.sendImage({
          to: recipient.phone,
          url: context.mediaUrl,
          caption: messageText,
        });
      } else if (context.mediaUrl && context.mediaType === 'file') {
        res = await wasender.sendFile({
          to: recipient.phone,
          url: context.mediaUrl,
          caption: messageText,
          filename: context.mediaFilename || 'archivo.sql',
        });
      } else {
        res = await wasender.sendText({
          to: recipient.phone,
          text: messageText,
        });
      }

      dispatchedCount++;
      console.log(`[Wasender Dispatch] ✅ Notificación enviada exitosamente a ${recipient.name} (${recipient.phone})`);
      deliveryResults.push({
        phone: recipient.phone,
        name: recipient.name,
        success: true,
        data: res.data,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Error desconocido al transmitir vía Wasender';
      console.error(`[Wasender Dispatch] ❌ Error enviando a ${recipient.name} (${recipient.phone}):`, errMsg);
      deliveryResults.push({
        phone: recipient.phone,
        name: recipient.name,
        success: false,
        error: errMsg,
      });
    }
  }

  return {
    ok: dispatchedCount > 0,
    channelKey: eventKey,
    channelName: resolution.channelName,
    totalResolved: resolution.recipients.length,
    dispatchedCount,
    recipients: resolution.recipients,
    deliveryResults,
  };
}

/**
 * Builds the structured data for the daily claims report from MySQL database.
 */
export async function buildDailyClaimsReportData(pool: Pool): Promise<ListaReclamosTemplateData> {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT cl.id AS claim_id, cl.description AS claim_reason, cl.created_at AS claim_created_at,
           o.order_code, o.year, o.brand, o.model, o.product_type, o.product_specs,
           c.first_name, c.last_name, c.phone AS customer_phone,
           (SELECT COUNT(cr.id) FROM call_register cr WHERE cr.claim_id = cl.id AND cr.deleted_at IS NULL) AS call_count
    FROM claims cl
    INNER JOIN orders o ON o.id = cl.order_id
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE cl.status IN ('Pending', 'In Process') AND cl.deleted_at IS NULL AND o.deleted_at IS NULL
    ORDER BY cl.created_at ASC
  `);

  const now = Date.now();
  const claims: PendingClaimItem[] = rows.map((r, idx) => {
    const createdAt = r.claim_created_at ? new Date(r.claim_created_at).getTime() : now;
    const daysElapsed = Math.max(0, Math.floor((now - createdAt) / (1000 * 60 * 60 * 24)));
    const fullName = [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Cliente';

    return {
      index: idx + 1,
      orderCode: r.order_code || `ORD-${r.claim_id}`,
      customerName: fullName,
      customerPhone: r.customer_phone,
      vehicleYear: r.year,
      vehicleMake: r.brand,
      vehicleModel: r.model,
      mainPart: r.product_type,
      productSpecs: r.product_specs,
      claimReason: r.claim_reason,
      daysElapsed,
      callCount: Number(r.call_count || 0),
    };
  });

  const dateFormatted = new Intl.DateTimeFormat('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Caracas',
  }).format(new Date());

  return {
    dateFormatted,
    claims,
  };
}

/**
 * Starts a background scheduler checking every 30s to dispatch the Daily Claims Report at 08:00 AM (Eastern Time / Carolina del Norte).
 */
export function startDailyClaimsReportScheduler(pool: Pool, wasender: WasenderClient): NodeJS.Timeout {
  let lastDispatchedDate = '';

  const checkAndRun = async () => {
    try {
      const now = new Date();
      // Format in America/New_York (North Carolina / Eastern Time)
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const parts = formatter.formatToParts(now);
      const hour = parts.find((p) => p.type === 'hour')?.value;
      const minute = parts.find((p) => p.type === 'minute')?.value;
      const year = parts.find((p) => p.type === 'year')?.value;
      const month = parts.find((p) => p.type === 'month')?.value;
      const day = parts.find((p) => p.type === 'day')?.value;

      const todayStr = `${year}-${month}-${day}`;

      if (hour === '08' && minute === '00' && lastDispatchedDate !== todayStr) {
        lastDispatchedDate = todayStr;
        console.log(`[Daily Claims Scheduler] ⏰ Ejecutando reporte diario de reclamos (08:00 AM Eastern Time)...`);
        const reportData = await buildDailyClaimsReportData(pool);
        const reportMsg = formatListaReclamosMessage(reportData);
        await dispatchSystemNotification(pool, wasender, 'LISTA_RECLAMOS', reportMsg);
      }
    } catch (err) {
      console.error('[Daily Claims Scheduler] Error en chequeo de reporte diario:', err);
    }
  };

  const interval = setInterval(checkAndRun, 30_000);
  return interval;
}
