import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool, port, allowedOrigins, isAllowedLocalOrigin, jwtSecret } from './src/server/config';
import { clearSessionCookie, isLoginRateLimited, recordLoginFailure, resetLoginAttempts, requireRole, userIsActive, verifyToken, setSessionCookie, Claims } from './src/server/auth';
import {
  changePasswordSchema,
  claimCallCreateSchema,
  claimSchema,
  claimUpdateSchema,
  customerSchema,
  loginSchema,
  orderPayloadSchema,
  personalMessageSchema,
  personalNoteSchema,
  refundCreateSchema,
  refundUpdateSchema,
  uploadPayloadSchema,
  userCreateSchema,
  userUpdateSchema,
  userProfileUpdateSchema,
  wasenderDispatchSchema,
  backupRestoreSchema,
  backupSnapshotCreateSchema,
  inventoryPartSchema,
  inventoryPartUpdateSchema,
  notificationConfigUpdateSchema,
  externalContactSchema,
  externalContactUpdateSchema,
  notificationTestDispatchSchema,
  verifyOtpSchema,
  updateDeliveryDateSchema,
} from './src/server/schemas';
import { readBody, sendJson, serveFrontend } from './src/server/http';
import { getOrders, mapOrder, normalizeTransmissionType, statusFromDatabase, statusToDatabase, toMysqlDateTime } from './src/server/orders';
import { getClaims } from './src/server/claims';
import {
  createDatabaseBackup,
  listBackups,
  saveBackupSnapshot,
  restoreDatabaseBackup,
  getBackupFileContent,
} from './src/server/backup';
import {
  ensureAuditTable,
  recordAuditLog,
  getAuditLogs,
} from './src/server/audit';
import { getMessageUsers, getPersonalMessages, getPersonalNote, markPersonalMessageRead, savePersonalNote, sendPersonalMessage } from './src/server/notes';
import { wasender, formatWasenderPhone } from './src/integrations/wasender/client';
import {
  getNotificationConfig,
  updateNotificationChannels,
  createExternalContact,
  updateExternalContact,
  deleteExternalContact,
  dispatchSystemNotification,
  ensureNotificationTables,
  startDailyClaimsReportScheduler,
} from './src/integrations/wasender/notificationService';
import {
  formatNuevaVentaMessage,
  formatBusquedaSubastasMessage,
  formatNuevoReclamoMessage,
  formatSeguimientoReclamoMessage,
  formatRespaldoAutomaticoMessage,
  formatListaReclamosMessage,
  formatOrdenCanceladaMessage,
  formatSolicitudReembolsoMessage,
  formatCambioEstatusMessage,
  formatOtp2FAMessage,
  formatAlertaSeguridadMessage,
  PendingClaimItem,
} from './src/integrations/wasender/notificationTemplates';

// In-memory single-use 2FA OTP state for Financial Module (1 minute expiration)
interface Financial2FAState {
  code: string;
  expiresAt: number;
  used: boolean;
  requestedAt: number;
  requestedByUserId: number;
  targetPhone: string;
}
let activeFinancial2FA: Financial2FAState | null = null;
const twoFactorFailures = new Map<string, number>();

// In-memory 2FA OTP state for Delivery Date modifications (5 minute expiration)
interface DeliveryDate2FAState {
  code: string;
  expiresAt: number;
  orderId: number;
  requestedByUserId: number;
  targetPhone: string;
}
const activeDeliveryDateOtps = new Map<string, DeliveryDate2FAState>();

const MIME_EXTENSION_MAP: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/jpg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt', '.log'],
  'text/csv': ['.csv'],
};

const validateFileMagicBytes = (buffer: Buffer, mimeType: string): boolean => {
  if (buffer.length < 4) return false;
  if (mimeType === 'image/png') {
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  }
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/gif') {
    return buffer.slice(0, 4).toString('ascii') === 'GIF8';
  }
  if (mimeType === 'image/webp') {
    return buffer.length >= 12 && buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP';
  }
  if (mimeType === 'application/pdf') {
    return buffer.slice(0, 4).toString('ascii') === '%PDF';
  }
  if (mimeType === 'text/plain' || mimeType === 'text/csv') {
    return !buffer.includes(0x00);
  }
  return false;
};

const parsePermissions = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((permission): permission is string => typeof permission === 'string');
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((permission): permission is string => typeof permission === 'string') : [];
  } catch {
    return [];
  }
};

const mapCustomerRow = (row: RowDataPacket) => {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Cliente sin nombre';
  return {
    id: String(row.id),
    first_name: row.first_name || '',
    last_name: row.last_name || '',
    name,
    company: row.company || '',
    type: row.type || 'Particular',
    email: row.email || '',
    phone: row.phone || '',
    whatsapp: row.whatsapp || '',
    location: row.address_shipping || 'Sin dirección registrada',
    address_shipping: row.address_shipping || '',
    shippingAddress: row.address_shipping || '',
    zip_code: row.zip_code || '',
    initials: name.split(' ').map((part: string) => part[0]).join('').slice(0, 2).toUpperCase(),
    notes: row.notes || '',
    createdAt: row.created_at,
    deleted_at: row.deleted_at,
    order_count: Number(row.order_count || 0),
  };
};

const mapInventoryPartRow = (row: RowDataPacket) => {
  return {
    id: String(row.id),
    year: String(row.year || ''),
    yearFrom: row.year_from ? String(row.year_from) : '',
    yearTo: row.year_to ? String(row.year_to) : '',
    isExactYearOnly: Boolean(row.is_exact_year_only),
    brand: row.brand || '',
    model: row.model || '',
    partType: row.part_type || 'Motor',
    vin: row.vin || '',
    palletNumber: row.pallet_number || '',
    engineSpecs: row.engine_specs || '',
    status: (row.status || 'disponible').toLowerCase(),
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    soldAt: row.sold_at || null,
  };
};

const server = createServer(async (request, response) => {
  request.setTimeout(30_000, () => {
    if (!response.headersSent) response.writeHead(408).end();
    request.destroy();
  });
  const pathname = new URL(request.url || '/', 'http://localhost').pathname;
  const origin = request.headers.origin;
  const allowedOrigin = (typeof origin === 'string' && allowedOrigins.has(origin)) || isAllowedLocalOrigin(origin)
    ? origin
    : undefined;

  if (allowedOrigin) response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  response.setHeader('Vary', 'Origin');
  if (allowedOrigin) response.setHeader('Access-Control-Allow-Credentials', 'true');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  const devConnectSrc = process.env.NODE_ENV === 'production'
    ? "connect-src 'self' https://vpic.nhtsa.dot.gov"
    : "connect-src 'self' https://vpic.nhtsa.dot.gov http://localhost:* http://127.0.0.1:* ws: wss:";
  response.setHeader('Content-Security-Policy', `default-src 'self'; ${devConnectSrc}; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`);
  if (process.env.NODE_ENV === 'production') {
    response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (request.method === 'OPTIONS') return response.end();

  try {
    if (request.method === 'GET' && pathname === '/health') {
      await pool.query('SELECT 1');
      return sendJson(response, 200, { ok: true, service: 'radar-3.0-api', database: 'connected' });
    }

    if (request.method === 'POST' && pathname === '/api/auth/login') {
      if (!jwtSecret) return sendJson(response, 503, { message: 'JWT_SECRET no está configurado' });
      const ip = request.socket.remoteAddress || 'unknown';
      const userAgent = request.headers['user-agent'] || null;
      if (isLoginRateLimited(ip)) {
        void recordAuditLog(pool, {
          action: 'LOGIN_FAILED',
          resourceType: 'auth',
          details: { reason: 'Rate limit excedido por IP' },
          ipAddress: ip,
          userAgent,
        });
        return sendJson(response, 429, { message: 'Demasiados intentos. Intenta más tarde.' });
      }
      const credentials = loginSchema.parse(await readBody(request));
      const email = credentials.email.toLowerCase();
      const password = credentials.password;
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id, name, email, phone, avatar_url, role, permissions, theme, active, password FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1',
        [email]
      );
      const user = rows[0];
      const validPassword = user ? await bcrypt.compare(password, String(user.password || '')) : false;
      if (!user || !validPassword || !user.active) {
        recordLoginFailure(ip);
        void recordAuditLog(pool, {
          username: email,
          action: 'LOGIN_FAILED',
          resourceType: 'auth',
          details: { reason: !user ? 'Usuario inexistente' : !user.active ? 'Usuario desactivado' : 'Contraseña incorrecta' },
          ipAddress: ip,
          userAgent,
        });
        return sendJson(response, 401, { message: 'Correo o contraseña incorrectos' });
      }
      resetLoginAttempts(ip);
      const token = jwt.sign({ sub: user.id, role: user.role, email: user.email }, jwtSecret, { expiresIn: '8h' });
      setSessionCookie(response, token);
      void recordAuditLog(pool, {
        userId: user.id,
        username: user.email,
        action: 'LOGIN_SUCCESS',
        resourceType: 'auth',
        details: { role: user.role },
        ipAddress: ip,
        userAgent,
      });
      return sendJson(response, 200, {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone || '',
          avatar_url: user.avatar_url || '',
          role: user.role,
          permissions: parsePermissions(user.permissions),
          theme: user.theme,
        },
      });
    }

    if (request.method === 'POST' && pathname === '/api/auth/logout') {
      const maybeClaims = verifyToken(request);
      if (maybeClaims?.sub) {
        void recordAuditLog(pool, {
          userId: Number(maybeClaims.sub),
          username: maybeClaims.email,
          action: 'LOGOUT',
          resourceType: 'auth',
          ipAddress: request.socket.remoteAddress || 'unknown',
          userAgent: request.headers['user-agent'] || null,
        });
      }
      clearSessionCookie(response);
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === 'GET' && pathname === '/api/auth/me') {
      const claims = verifyToken(request);
      if (!claims?.sub) return sendJson(response, 401, { message: 'Sesión no válida' });
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id, name, email, phone, avatar_url, role, permissions, theme, active FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
        [claims.sub]
      );
      return rows[0]?.active
        ? sendJson(response, 200, {
            user: {
              ...rows[0],
              phone: rows[0].phone || '',
              avatar_url: rows[0].avatar_url || '',
              permissions: parsePermissions(rows[0].permissions),
            },
          })
        : sendJson(response, 401, { message: 'Usuario inactivo' });
    }

    const authenticatedClaims = pathname.startsWith('/api/') ? verifyToken(request) as Claims | null : null;
    if (pathname.startsWith('/api/') && !authenticatedClaims) {
      return sendJson(response, 401, { message: 'Autenticación requerida' });
    }

    if (authenticatedClaims?.sub) {
      if (!await userIsActive(authenticatedClaims)) return sendJson(response, 401, { message: 'Sesión no válida o revocada' });
    }

    // ==========================================
    // 2FA OTP SECURITY GATE (RELACIÓN SEMANAL & FINANZAS)
    // ==========================================
    if (authenticatedClaims?.sub && request.method === 'POST' && pathname === '/api/auth/2fa/request-otp') {
      const now = Date.now();
      if (activeFinancial2FA && (now - activeFinancial2FA.requestedAt) < 5000 && !activeFinancial2FA.used) {
        const remaining = Math.max(1, Math.ceil((activeFinancial2FA.expiresAt - now) / 1000));
        return sendJson(response, 429, {
          ok: false,
          message: 'Por favor espera unos segundos antes de solicitar otro código.',
          cooldownSeconds: remaining,
        });
      }

      // 1. Generate single-use 6-digit random code
      const otpCode = crypto.randomInt(100000, 1000000).toString();

      // 2. Lookup Super Admin phone number
      const [adminRows] = await pool.query<RowDataPacket[]>(
        "SELECT id, name, phone FROM users WHERE role = 'admin' AND active = 1 AND deleted_at IS NULL ORDER BY id ASC LIMIT 1"
      );
      const adminUser = adminRows[0];
      const targetPhone = adminUser?.phone ? formatWasenderPhone(adminUser.phone) : (wasender.designatedTestPhone || '+584127307933');

      // 3. Store active 2FA state with strictly 1-minute (60s) expiration and single-use flag
      activeFinancial2FA = {
        code: otpCode,
        expiresAt: now + 60 * 1000, // 1 minute expiration
        used: false,
        requestedAt: now,
        requestedByUserId: Number(authenticatedClaims.sub),
        targetPhone,
      };

      // 4. Send via WhatsApp / Wasender
      const textMessage = formatOtp2FAMessage({
        code: otpCode,
        userName: adminUser?.name || 'Super Admin',
        moduleName: 'Relación Semanal & Finanzas',
        expirationMinutes: 1,
      });

      let dispatched = false;
      let warning: string | undefined;
      if (wasender.configured) {
        try {
          await wasender.sendText({ to: targetPhone, text: textMessage });
          dispatched = true;
        } catch (err) {
          warning = err instanceof Error ? err.message : 'Error al despachar mensaje WhatsApp';
          console.error('[2FA OTP] Error enviando WhatsApp a Super Admin:', err);
        }
      }

      console.log(`[2FA OTP] PIN transmitido al Super Admin (${targetPhone}): ${otpCode} (expira en 60s)`);

      void recordAuditLog(pool, {
        userId: Number(authenticatedClaims.sub),
        username: authenticatedClaims.email,
        action: '2FA_REQUESTED',
        resourceType: '2fa',
        details: { targetPhoneMasked: '+58 412-***7933' },
        ipAddress: request.socket.remoteAddress || 'unknown',
        userAgent: request.headers['user-agent'] || null,
      });

      return sendJson(response, 200, {
        ok: true,
        dispatched,
        message: 'Código de verificación transmitido por WhatsApp al Super Admin (+58 412-***7933)',
        cooldownSeconds: 60,
        expiresInSeconds: 60,
        targetPhoneMasked: '+58 412-***7933',
        warning,
      });
    }

    if (authenticatedClaims?.sub && request.method === 'POST' && pathname === '/api/auth/2fa/verify-otp') {
      const data = verifyOtpSchema.parse(await readBody(request));
      const cleanCode = data.code.trim();
      const now = Date.now();
      const ip = request.socket.remoteAddress || 'unknown';
      const userAgent = request.headers['user-agent'] || null;
      const userKey = String(authenticatedClaims.sub);

      const handleFailed2FA = (reason: string) => {
        const failCount = (twoFactorFailures.get(userKey) || 0) + 1;
        twoFactorFailures.set(userKey, failCount);

        void recordAuditLog(pool, {
          userId: Number(authenticatedClaims.sub),
          username: authenticatedClaims.email,
          action: '2FA_FAILED',
          resourceType: '2fa',
          details: { attempt: failCount, reason },
          ipAddress: ip,
          userAgent,
        });

        if (failCount >= 3) {
          const alertMsg = formatAlertaSeguridadMessage({
            event: 'Múltiples intentos fallidos de verificación 2FA',
            username: authenticatedClaims.email,
            ipAddress: ip,
            details: `Se registraron ${failCount} intentos fallidos consecutivos de código 2FA.`,
          });
          void dispatchSystemNotification(pool, wasender, 'ALERTA_SEGURIDAD', alertMsg).catch((err) => {
            console.error('[Alerta Seguridad Dispatch] Error:', err);
          });
          void recordAuditLog(pool, {
            userId: Number(authenticatedClaims.sub),
            username: authenticatedClaims.email,
            action: 'SECURITY_ALERT_TRIGGERED',
            resourceType: '2fa',
            details: { consecutiveFailures: failCount, alertSentTo: 'Super Admin' },
            ipAddress: ip,
            userAgent,
          });
        }
      };

      if (!activeFinancial2FA) {
        handleFailed2FA('No hay código activo');
        return sendJson(response, 400, {
          ok: false,
          verified: false,
          message: 'No hay un código de verificación activo. Por favor pulsa "Solicitar Código".',
        });
      }

      if (activeFinancial2FA.used) {
        handleFailed2FA('Código ya utilizado');
        return sendJson(response, 400, {
          ok: false,
          verified: false,
          message: 'Este código de verificación ya fue utilizado. Por favor solicita un nuevo código.',
        });
      }

      if (now > activeFinancial2FA.expiresAt) {
        handleFailed2FA('Código expirado');
        return sendJson(response, 400, {
          ok: false,
          verified: false,
          message: 'El código de verificación ha expirado (tiempo límite de 1 minuto). Por favor solicita un nuevo PIN.',
        });
      }

      if (activeFinancial2FA.code !== cleanCode) {
        handleFailed2FA('Código incorrecto');
        return sendJson(response, 400, {
          ok: false,
          verified: false,
          message: 'Código de verificación incorrecto. Revisa el mensaje de WhatsApp recibido.',
        });
      }

      // Mark single-use code as used immediately and reset failure count
      activeFinancial2FA.used = true;
      twoFactorFailures.delete(userKey);

      void recordAuditLog(pool, {
        userId: Number(authenticatedClaims.sub),
        username: authenticatedClaims.email,
        action: '2FA_VERIFIED',
        resourceType: '2fa',
        details: { verified: true },
        ipAddress: ip,
        userAgent,
      });

      return sendJson(response, 200, {
        ok: true,
        verified: true,
        message: 'Sesión financiera 2FA desbloqueada exitosamente.',
      });
    }

    if (authenticatedClaims?.sub && request.method === 'PUT' && pathname === '/api/auth/profile') {

      const payload = userProfileUpdateSchema.parse(await readBody(request));
      const currentUserId = authenticatedClaims.sub;

      const [existing] = await pool.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE email = ? AND id != ? AND deleted_at IS NULL LIMIT 1',
        [payload.email.toLowerCase(), currentUserId]
      );
      if (existing.length > 0) {
        return sendJson(response, 409, { message: 'El correo electrónico ya está en uso por otro usuario' });
      }

      let passwordClause = '';
      const params: any[] = [
        payload.name,
        payload.email.toLowerCase(),
        payload.phone ? payload.phone.trim() : null,
        payload.avatar_url ? payload.avatar_url.trim() : null,
      ];

      if (payload.newPassword) {
        if (!payload.currentPassword) {
          return sendJson(response, 400, { message: 'Debes ingresar tu contraseña actual para cambiarla' });
        }
        const [userRows] = await pool.query<RowDataPacket[]>('SELECT password FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1', [currentUserId]);
        if (!userRows[0]) return sendJson(response, 404, { message: 'Usuario no encontrado' });
        const valid = await bcrypt.compare(payload.currentPassword, String(userRows[0].password || ''));
        if (!valid) return sendJson(response, 400, { message: 'La contraseña actual no es correcta' });

        const newHash = await bcrypt.hash(payload.newPassword, 10);
        passwordClause = ', password = ?';
        params.push(newHash);
      }

      params.push(currentUserId);

      await pool.execute(
        `UPDATE users SET name = ?, email = ?, phone = ?, avatar_url = ? ${passwordClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL`,
        params
      );

      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id, name, email, phone, avatar_url, role, permissions, theme, active, created_at, updated_at FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
        [currentUserId]
      );
      if (!rows[0]) return sendJson(response, 404, { message: 'Usuario no encontrado' });
      void recordAuditLog(pool, {
        userId: Number(currentUserId),
        username: payload.email,
        action: 'USER_UPDATED',
        resourceType: 'profile',
        details: { name: payload.name, email: payload.email, passwordChanged: Boolean(payload.newPassword) },
        ipAddress: request.socket.remoteAddress || 'unknown',
        userAgent: request.headers['user-agent'] || null,
      });
      return sendJson(response, 200, {
        user: {
          ...rows[0],
          phone: rows[0].phone || '',
          avatar_url: rows[0].avatar_url || '',
          permissions: parsePermissions(rows[0].permissions),
        },
        message: 'Perfil actualizado exitosamente',
      });
    }

    if (authenticatedClaims?.sub && request.method === 'POST' && pathname === '/api/auth/change-password') {
      const payload = changePasswordSchema.parse(await readBody(request));
      const [rows] = await pool.query<RowDataPacket[]>('SELECT password FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1', [authenticatedClaims.sub]);
      if (!rows[0]) return sendJson(response, 404, { message: 'Usuario no encontrado' });
      const valid = await bcrypt.compare(payload.currentPassword, String(rows[0].password || ''));
      if (!valid) return sendJson(response, 400, { message: 'La contraseña actual no es correcta' });

      const newHash = await bcrypt.hash(payload.newPassword, 10);
      await pool.execute('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newHash, authenticatedClaims.sub]);
      void recordAuditLog(pool, {
        userId: Number(authenticatedClaims.sub),
        username: authenticatedClaims.email,
        action: 'PASSWORD_CHANGED',
        resourceType: 'auth',
        ipAddress: request.socket.remoteAddress || 'unknown',
        userAgent: request.headers['user-agent'] || null,
      });
      return sendJson(response, 200, { ok: true, message: 'Contraseña actualizada exitosamente' });
    }

    if (authenticatedClaims?.sub && request.method === 'GET' && pathname === '/api/me/notes') {
      return sendJson(response, 200, { content: await getPersonalNote(authenticatedClaims.sub) });
    }

    if (authenticatedClaims?.sub && request.method === 'PUT' && pathname === '/api/me/notes') {
      const note = personalNoteSchema.parse(await readBody(request));
      await savePersonalNote(authenticatedClaims.sub, note.content);
      return sendJson(response, 200, { ok: true, content: note.content });
    }

    if (authenticatedClaims?.sub && request.method === 'GET' && pathname === '/api/me/message-users') {
      return sendJson(response, 200, await getMessageUsers(authenticatedClaims.sub));
    }

    if (authenticatedClaims?.sub && request.method === 'GET' && pathname === '/api/me/messages') {
      return sendJson(response, 200, await getPersonalMessages(authenticatedClaims.sub));
    }

    if (authenticatedClaims?.sub && request.method === 'POST' && pathname === '/api/me/messages') {
      const message = personalMessageSchema.parse(await readBody(request));
      const id = await sendPersonalMessage(authenticatedClaims.sub, message.recipientId, message.subject, message.content);
      return sendJson(response, 201, { ok: true, id });
    }

    const messageId = pathname.match(/^\/api\/me\/messages\/(\d+)\/read$/)?.[1];
    if (authenticatedClaims?.sub && request.method === 'PUT' && messageId) {
      await markPersonalMessageRead(authenticatedClaims.sub, Number(messageId));
      return sendJson(response, 200, { ok: true });
    }

    // ==========================================
    // SYSTEM BACKUPS & DISASTER RECOVERY (SUPER ADMIN ONLY)
    // ==========================================
    if (request.method === 'GET' && pathname === '/api/system/backups') {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const backups = await listBackups();
      return sendJson(response, 200, backups);
    }

    if (request.method === 'POST' && pathname === '/api/system/backup/create') {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const payload = backupSnapshotCreateSchema.parse(await readBody(request));
      const result = await saveBackupSnapshot({ tag: payload.tag || 'manual' });

      const backupDownloadUrl = `https://radar-rsy.site/api/uploads/backups/${result.filename}`;
      const backupMsg = formatRespaldoAutomaticoMessage({
        downloadUrl: backupDownloadUrl,
      });

      void dispatchSystemNotification(pool, wasender, 'RESPALDO_AUTOMATICO', backupMsg).catch((err) => {
        console.error('[Notification Dispatch] Error dispatching RESPALDO_AUTOMATICO:', err);
      });

      void recordAuditLog(pool, {
        userId: Number(authenticatedClaims.sub),
        username: authenticatedClaims.email,
        action: 'BACKUP_CREATED',
        resourceType: 'system_backup',
        resourceId: result.filename,
        details: { filename: result.filename, sizeBytes: result.sizeBytes, tag: payload.tag || 'manual' },
        ipAddress: request.socket.remoteAddress || 'unknown',
        userAgent: request.headers['user-agent'] || null,
      });

      return sendJson(response, 201, {
        ok: true,
        message: 'Respaldo automático generado con éxito',
        filename: result.filename,
        sizeBytes: result.sizeBytes,
      });
    }

    if (request.method === 'POST' && pathname === '/api/system/backup/restore') {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const body = await readBody(request, 60 * 1024 * 1024);
      const payload = backupRestoreSchema.parse(body);

      let sqlToExecute = '';
      if (payload.filename) {
        const { sql } = await getBackupFileContent(payload.filename);
        sqlToExecute = sql;
      } else if (payload.sqlContent) {
        if (payload.sqlContent.startsWith('data:') || /^[A-Za-z0-9+/=\s]+$/.test(payload.sqlContent.slice(0, 100)) && payload.sqlContent.includes('base64')) {
          const cleanBase64 = payload.sqlContent.replace(/^data:.*?;base64,/, '');
          sqlToExecute = Buffer.from(cleanBase64, 'base64').toString('utf8');
        } else {
          sqlToExecute = payload.sqlContent;
        }
      }

      const result = await restoreDatabaseBackup(sqlToExecute, {
        createSafetySnapshot: payload.createSafetySnapshot,
        sourceName: payload.filename || 'uploaded_backup.sql',
      });

      void recordAuditLog(pool, {
        userId: Number(authenticatedClaims.sub),
        username: authenticatedClaims.email,
        action: 'BACKUP_RESTORED',
        resourceType: 'system_backup',
        resourceId: payload.filename || 'uploaded_backup.sql',
        details: { source: payload.filename || 'uploaded_backup.sql', success: result.ok },
        ipAddress: request.socket.remoteAddress || 'unknown',
        userAgent: request.headers['user-agent'] || null,
      });

      return sendJson(response, 200, result);
    }

    if (request.method === 'GET' && (pathname === '/api/system/backup' || pathname === '/api/system/backup/download')) {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const url = new URL(request.url || '/', 'http://localhost');
      const targetFile = url.searchParams.get('file');

      let backupSql = '';
      let downloadFilename = '';

      if (targetFile) {
        const { sql, resolvedPath } = await getBackupFileContent(targetFile);
        backupSql = sql;
        downloadFilename = path.basename(resolvedPath);
      } else {
        backupSql = await createDatabaseBackup();
        const date = new Date().toISOString().replace(/[:.]/g, '-');
        downloadFilename = `radar-v3-backup-${date}.sql`;
      }

      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/sql; charset=utf-8',
        'Content-Disposition': `attachment; filename="${downloadFilename}"`,
      });
      response.end(backupSql);
      return;
    }

    // ==========================================
    // SYSTEM AUDIT LOGS (ADMIN & SUPER ADMIN ONLY)
    // ==========================================
    if (request.method === 'GET' && pathname === '/api/system/audit-logs') {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const url = new URL(request.url || '/', 'http://localhost');
      const limitParam = url.searchParams.get('limit');
      const offsetParam = url.searchParams.get('offset');
      const actionParam = url.searchParams.get('action') || undefined;
      const userIdParam = url.searchParams.get('userId') || undefined;
      const startDateParam = url.searchParams.get('startDate') || undefined;
      const endDateParam = url.searchParams.get('endDate') || undefined;

      const result = await getAuditLogs(pool, {
        limit: limitParam ? parseInt(limitParam, 10) : 50,
        offset: offsetParam ? parseInt(offsetParam, 10) : 0,
        action: actionParam,
        userId: userIdParam ? parseInt(userIdParam, 10) : undefined,
        startDate: startDateParam,
        endDate: endDateParam,
      });

      return sendJson(response, 200, result);
    }

    // ==========================================
    // ORDERS
    // ==========================================
    if (request.method === 'GET' && pathname === '/api/orders') {
      return sendJson(response, 200, await getOrders());
    }

    if (request.method === 'POST' && pathname === '/api/orders') {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator')) return;
      const order = orderPayloadSchema.parse(await readBody(request));
      if (!order.customer || !order.vehicle || !order.financials || !order.mainPart) {
        return sendJson(response, 400, { message: 'Cliente, vehículo, pieza y datos financieros son obligatorios' });
      }
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // 1. Resolve Customer ID safely (existing numeric ID or create new customer)
        let customerId: number | null = null;
        const rawCustomerId = String(order.customer.id || '').trim();
        const parsedCustomerId = Number(rawCustomerId);

        if (rawCustomerId && !Number.isNaN(parsedCustomerId) && Number.isInteger(parsedCustomerId) && parsedCustomerId > 0 && !rawCustomerId.startsWith('CUST-')) {
          const [existing] = await connection.query<RowDataPacket[]>('SELECT id FROM customers WHERE id = ? AND deleted_at IS NULL LIMIT 1', [parsedCustomerId]);
          if (existing.length > 0) {
            customerId = existing[0].id;
          }
        }

        if (!customerId) {
          const customerNameParts = String(order.customer.name || '').trim().split(/\s+/);
          const [customerResult] = await connection.execute<ResultSetHeader>(
            'INSERT INTO customers (first_name, last_name, phone, whatsapp, email, address_shipping, zip_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
              customerNameParts[0] || 'Cliente',
              customerNameParts.slice(1).join(' ') || null,
              order.customer.phone || null,
              order.customer.phone || null,
              order.customer.email || null,
              order.customer.shippingAddress || null,
              order.customer.zip_code || null,
            ]
          );
          customerId = customerResult.insertId;
        }

        // 2. Resolve User ID (Advisor) safely
        let assignedUserId: number | null = null;
        if (order.userId && Number.isInteger(Number(order.userId)) && Number(order.userId) > 0) {
          const [userRows] = await connection.query<RowDataPacket[]>('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1', [order.userId]);
          if (userRows.length > 0) assignedUserId = userRows[0].id;
        }
        if (!assignedUserId && authenticatedClaims?.sub) {
          const authSubNum = Number(authenticatedClaims.sub);
          if (Number.isInteger(authSubNum) && authSubNum > 0) {
            const [userRows] = await connection.query<RowDataPacket[]>('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1', [authSubNum]);
            if (userRows.length > 0) assignedUserId = userRows[0].id;
          }
        }
        if (!assignedUserId && order.advisor && order.advisor !== 'Sin asignar') {
          const [userRows] = await connection.query<RowDataPacket[]>('SELECT id FROM users WHERE name = ? AND deleted_at IS NULL LIMIT 1', [order.advisor]);
          if (userRows.length > 0) assignedUserId = userRows[0].id;
        }
        if (!assignedUserId) {
          const [firstUser] = await connection.query<RowDataPacket[]>('SELECT id FROM users WHERE deleted_at IS NULL ORDER BY id ASC LIMIT 1');
          if (firstUser.length > 0) assignedUserId = firstUser[0].id;
        }

        // 3. Resolve unique Order Code (VARCHAR(20))
        let orderCode = (order.code || '').trim().slice(0, 20);
        if (!orderCode) {
          orderCode = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;
        }
        const [existingCode] = await connection.query<RowDataPacket[]>('SELECT id FROM orders WHERE order_code = ? LIMIT 1', [orderCode]);
        if (existingCode.length > 0) {
          orderCode = `ORD-${Date.now().toString().slice(-6)}`;
        }

        // 4. Normalize Transmission Type for ENUM('AT','MT') / VARCHAR
        const transmissionType = normalizeTransmissionType(order.vehicle.transmission);

        // 5. Insert Order
        const [orderResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO orders (order_code, vin_nr, brand, model, sub_model, year, color, mileage, product_type, transmission_type, product_specs, stock_nr, customer_id, user_id, price, core_fee, down_payment, shipping_toggle, shipping_address, shipping_cost, warranty_days, status, workflow_step, description)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            orderCode,
            order.vehicle.vin || null,
            order.vehicle.make || null,
            order.vehicle.model || null,
            order.vehicle.trim || null,
            order.vehicle.year || null,
            order.vehicle.color || null,
            order.vehicle.mileage || null,
            order.mainPart,
            transmissionType,
            order.productSpecs || null,
            order.stockNumber || null,
            customerId,
            assignedUserId,
            order.financials.partPrice || 0,
            order.financials.coreFee || 0,
            order.financials.downPayment || 0,
            order.deliveryType === 'envio_domicilio',
            order.customer.shippingAddress || null,
            order.financials.deliveryFee || 0,
            order.warrantyDays || 60,
            statusToDatabase[order.status || 'cotizacion'] || order.status || 'Cotización',
            order.workflowStep || 1,
            order.notes || null,
          ]
        );

        const statusUserId = assignedUserId || Number(authenticatedClaims?.sub) || 1;
        await connection.execute(
          'INSERT INTO status_orders (order_id, status, description, user_id) VALUES (?, ?, ?, ?)',
          [orderResult.insertId, statusToDatabase[order.status || 'cotizacion'] || order.status || 'Cotización', 'Orden creada desde RADAR 3.0', statusUserId]
        );

        await connection.commit();
        const [rows] = await connection.query<RowDataPacket[]>(
          'SELECT o.*, c.first_name, c.last_name, c.phone, c.email, c.address_shipping, c.zip_code, u.name AS advisor, u.phone AS advisor_phone FROM orders o LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = o.user_id WHERE o.id = ?',
          [orderResult.insertId]
        );
        const createdOrderRow = rows[0];

        // Dispatch NUEVA_VENTA notification ONLY if order is created directly with "Pagado" status
        const initialStatusStr = statusToDatabase[order.status || 'cotizacion'] || order.status || 'Cotización';
        const isInitiallyPaid = /pagad/i.test(initialStatusStr) || order.status === 'pagado';

        if (isInitiallyPaid) {
          const orderCodeStr = createdOrderRow?.order_code || orderCode;
          const clientFullName = [createdOrderRow?.first_name, createdOrderRow?.last_name].filter(Boolean).join(' ') || order.customer.name || 'Cliente';
          const clientPhone = createdOrderRow?.phone || order.customer.phone || '';
          const advisorNameStr = createdOrderRow?.advisor || order.advisor || 'Asesor Asignado';

          const newSaleMsg = formatNuevaVentaMessage({
            orderCode: orderCodeStr,
            customerName: clientFullName,
            customerPhone: clientPhone,
            vehicleYear: order.vehicle.year,
            vehicleMake: order.vehicle.make,
            vehicleModel: order.vehicle.model,
            vin: order.vehicle.vin,
            mainPart: order.mainPart,
            productSpecs: order.productSpecs,
            totalPrice: order.financials.partPrice || 0,
            downPayment: order.financials.downPayment || 0,
            deliveryType: order.deliveryType,
            shippingAddress: order.customer.shippingAddress,
          });

          void dispatchSystemNotification(pool, wasender, 'NUEVA_VENTA', newSaleMsg, {
            creatorUserId: assignedUserId ? Number(assignedUserId) : undefined,
            creatorPhone: createdOrderRow?.advisor_phone || undefined,
            creatorName: advisorNameStr,
            orderStatus: initialStatusStr,
          }).catch((err) => {
            console.error('[Notification Dispatch] Error dispatching NUEVA_VENTA:', err);
          });
        }

        void recordAuditLog(pool, {
          userId: Number(authenticatedClaims?.sub),
          username: authenticatedClaims?.email,
          action: 'ORDER_CREATED',
          resourceType: 'order',
          resourceId: createdOrderRow?.order_code || `ORD-${orderResult.insertId}`,
          details: {
            customer: [createdOrderRow?.first_name, createdOrderRow?.last_name].filter(Boolean).join(' ') || order.customer.name,
            totalPrice: order.financials.partPrice || 0,
            status: initialStatusStr,
          },
          ipAddress: request.socket.remoteAddress || 'unknown',
          userAgent: request.headers['user-agent'] || null,
        });

        return sendJson(response, 201, mapOrder(createdOrderRow));
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }

    // ==========================================
    // DELIVERY DATE 2FA FOR DELIVERED ORDERS
    // ==========================================
    const deliveryDateOtpMatch = pathname.match(/^\/api\/orders\/(\d+)\/delivery-date\/request-otp$/);
    if (request.method === 'POST' && deliveryDateOtpMatch) {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const targetOrderId = Number(deliveryDateOtpMatch[1]);
      const [orderRows] = await pool.query<RowDataPacket[]>(
        'SELECT id, order_code, status, delivered_at FROM orders WHERE id = ? AND deleted_at IS NULL LIMIT 1',
        [targetOrderId]
      );
      if (!orderRows[0]) {
        return sendJson(response, 404, { ok: false, message: 'Orden no encontrada' });
      }
      const orderRow = orderRows[0];
      const isDelivered = orderRow.status === 'Entregado' || orderRow.status === 'entregado';
      if (!isDelivered) {
        return sendJson(response, 400, {
          ok: false,
          message: 'La modificación de fecha de entrega solo está permitida para órdenes con estatus Entregado',
        });
      }

      const otpCode = crypto.randomInt(100000, 1000000).toString();
      const now = Date.now();
      const [adminRows] = await pool.query<RowDataPacket[]>(
        "SELECT id, name, phone FROM users WHERE role = 'admin' AND active = 1 AND deleted_at IS NULL ORDER BY id ASC LIMIT 1"
      );
      const adminUser = adminRows[0];
      const targetPhone = adminUser?.phone ? formatWasenderPhone(adminUser.phone) : (wasender.designatedTestPhone || '+584127307933');

      activeDeliveryDateOtps.set(String(targetOrderId), {
        code: otpCode,
        expiresAt: now + 5 * 60 * 1000, // 5 minutes
        orderId: targetOrderId,
        requestedByUserId: Number(authenticatedClaims.sub),
        targetPhone,
      });

      const textMessage = `🛡️ *RADAR V3 • Autorización de Fecha de Entrega*\n\nSe ha solicitado modificar la fecha de entrega física de la Orden *#${orderRow.order_code || targetOrderId}* (Estatus: Entregado).\n\nTu código PIN de verificación es:\n👉 *${otpCode}*\n\n⏰ *Válido por:* 5 minutos\n_(Transmitido vía WasenderAPI)_`;

      let dispatched = false;
      let warning: string | undefined;
      if (wasender.configured) {
        try {
          await wasender.sendText({ to: targetPhone, text: textMessage });
          dispatched = true;
        } catch (err) {
          warning = err instanceof Error ? err.message : 'Error al despachar mensaje WhatsApp';
          console.error('[Delivery Date OTP] Error enviando WhatsApp:', err);
        }
      }

      console.log(`[Delivery Date OTP] PIN transmitido al Super Admin (${targetPhone}) para Orden #${targetOrderId}: ${otpCode}`);

      void recordAuditLog(pool, {
        userId: Number(authenticatedClaims.sub),
        username: authenticatedClaims.email,
        action: '2FA_REQUESTED',
        resourceType: 'order',
        resourceId: targetOrderId,
        details: { purpose: 'ORDER_DELIVERY_DATE', orderId: targetOrderId, orderCode: orderRow.order_code },
        ipAddress: request.socket.remoteAddress || 'unknown',
        userAgent: request.headers['user-agent'] || null,
      });

      return sendJson(response, 200, {
        ok: true,
        dispatched,
        message: 'Código de verificación transmitido por WhatsApp al Super Admin',
        targetPhoneMasked: targetPhone.replace(/(\+\d{2})(\d{3})(\d{3})(\d{4})/, '$1 $2-***$4'),
        warning,
      });
    }

    const deliveryDateUpdateMatch = pathname.match(/^\/api\/orders\/(\d+)\/delivery-date$/);
    if (request.method === 'PUT' && deliveryDateUpdateMatch) {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const targetOrderId = Number(deliveryDateUpdateMatch[1]);
      const data = updateDeliveryDateSchema.parse(await readBody(request));

      const [orderRows] = await pool.query<RowDataPacket[]>(
        'SELECT id, order_code, status, delivered_at FROM orders WHERE id = ? AND deleted_at IS NULL LIMIT 1',
        [targetOrderId]
      );
      if (!orderRows[0]) {
        return sendJson(response, 404, { ok: false, message: 'Orden no encontrada' });
      }
      const orderRow = orderRows[0];
      const isDelivered = orderRow.status === 'Entregado' || orderRow.status === 'entregado';
      if (!isDelivered) {
        return sendJson(response, 400, {
          ok: false,
          message: 'La modificación de fecha de entrega solo está permitida para órdenes con estatus Entregado',
        });
      }

      const activeOtp = activeDeliveryDateOtps.get(String(targetOrderId));
      const now = Date.now();
      const cleanCode = data.otpCode.trim();

      const isValidOtp = activeOtp && activeOtp.code === cleanCode && now < activeOtp.expiresAt;
      if (!isValidOtp) {
        void recordAuditLog(pool, {
          userId: Number(authenticatedClaims.sub),
          username: authenticatedClaims.email,
          action: '2FA_FAILED',
          resourceType: 'order',
          resourceId: targetOrderId,
          details: { purpose: 'ORDER_DELIVERY_DATE', attemptedCode: cleanCode },
          ipAddress: request.socket.remoteAddress || 'unknown',
          userAgent: request.headers['user-agent'] || null,
        });
        return sendJson(response, 400, {
          ok: false,
          message: 'Código OTP inválido o expirado. Solicita un nuevo código por WhatsApp.',
        });
      }

      // Consume OTP
      activeDeliveryDateOtps.delete(String(targetOrderId));

      const previousDeliveredAt = orderRow.delivered_at;
      const newDeliveredMysql = toMysqlDateTime(data.deliveredAt);

      await pool.execute(
        'UPDATE orders SET delivered_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL',
        [newDeliveredMysql, targetOrderId]
      );

      void recordAuditLog(pool, {
        userId: Number(authenticatedClaims.sub),
        username: authenticatedClaims.email,
        action: 'ORDER_DELIVERY_DATE_UPDATED',
        resourceType: 'order',
        resourceId: targetOrderId,
        details: {
          orderId: targetOrderId,
          orderCode: orderRow.order_code,
          previousDeliveredAt: previousDeliveredAt ? new Date(previousDeliveredAt).toISOString() : null,
          newDeliveredAt: data.deliveredAt,
          reason: data.reason || 'Modificación de fecha autorizada por Super Admin',
        },
        ipAddress: request.socket.remoteAddress || 'unknown',
        userAgent: request.headers['user-agent'] || null,
      });

      return sendJson(response, 200, {
        ok: true,
        deliveredAt: data.deliveredAt,
        message: 'Fecha de entrega física modificada y validada con éxito',
      });
    }

    const orderId = pathname.match(/^\/api\/orders\/(\d+)$/)?.[1];
    if (request.method === 'PUT' && orderId) {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator')) return;
      const order = orderPayloadSchema.parse(await readBody(request));
      const customerName = String(order.customer?.name || '').trim().split(/\s+/);
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // 1. Fetch previous order state and advisor details
        const [prevRows] = await connection.query<RowDataPacket[]>(
          `SELECT o.order_code, o.status, o.user_id, o.brand, o.model, o.year, o.product_type, o.price, o.down_payment,
                  c.first_name, c.last_name, c.phone AS customer_phone,
                  u.id AS advisor_user_id, u.name AS advisor_name, u.phone AS advisor_phone
           FROM orders o
           LEFT JOIN customers c ON c.id = o.customer_id
           LEFT JOIN users u ON u.id = o.user_id
           WHERE o.id = ? LIMIT 1`,
          [orderId]
        );
        const prevOrder = prevRows[0];

        const rawCustId = String(order.customer?.id || '').trim();
        const parsedCustId = Number(rawCustId);
        if (rawCustId && !Number.isNaN(parsedCustId) && Number.isInteger(parsedCustId) && parsedCustId > 0 && !rawCustId.startsWith('CUST-')) {
          await connection.execute(
            `UPDATE customers SET first_name = ?, last_name = ?, phone = ?, whatsapp = ?, email = ?, address_shipping = ?, zip_code = ? WHERE id = ?`,
            [customerName[0] || 'Cliente', customerName.slice(1).join(' ') || null, order.customer?.phone || null, order.customer?.phone || null, order.customer?.email || null, order.customer?.shippingAddress || null, order.customer?.zip_code || null, parsedCustId]
          );
        }

        let assignedUserId: number | null | undefined = order.userId;
        if (assignedUserId === undefined && order.advisor && order.advisor !== 'Sin asignar') {
          const [userRows] = await connection.query<RowDataPacket[]>('SELECT id FROM users WHERE name = ? AND deleted_at IS NULL LIMIT 1', [order.advisor]);
          if (userRows[0]) assignedUserId = userRows[0].id;
        }

        const transmissionType = normalizeTransmissionType(order.vehicle?.transmission);
        const newDbStatus = statusToDatabase[order.status || ''] || order.status || '';

        await connection.execute(
          `UPDATE orders SET vin_nr = ?, brand = ?, model = ?, sub_model = ?, year = ?, color = ?, mileage = ?, product_type = ?, transmission_type = ?, product_specs = ?, stock_nr = ?, price = ?, core_fee = ?, down_payment = ?, shipping_toggle = ?, shipping_address = ?, shipping_cost = ?, warranty_days = ?, status = ?, workflow_step = ?, scheduled_pickup_at = ?, delivered_at = ?, warranty_started = ?, description = ?, claim_reason = ? ${assignedUserId !== undefined ? ', user_id = ?' : ''} WHERE id = ?`,
          [
            order.vehicle?.vin || null, order.vehicle?.make || null, order.vehicle?.model || null, order.vehicle?.trim || null, order.vehicle?.year || null, order.vehicle?.color || null, order.vehicle?.mileage || null, order.mainPart || null, transmissionType, order.productSpecs || null, order.stockNumber || null, order.financials?.partPrice || 0, order.financials?.coreFee || 0, order.financials?.downPayment || 0, order.deliveryType === 'envio_domicilio', order.customer?.shippingAddress || null, order.financials?.deliveryFee || 0, order.warrantyDays || 60, newDbStatus, order.workflowStep || 1, toMysqlDateTime(order.scheduledPickupAt), toMysqlDateTime(order.deliveredAt), Boolean(order.warrantyStarted), order.notes || null, order.claimReason || null,
            ...(assignedUserId !== undefined ? [assignedUserId] : []),
            orderId,
          ]
        );
        const currentUserId = (assignedUserId !== undefined && assignedUserId !== null) ? assignedUserId : (Number(authenticatedClaims?.sub) || 1);
        await connection.execute(
          'INSERT INTO status_orders (order_id, status, description, user_id) VALUES (?, ?, ?, ?)',
          [orderId, newDbStatus || 'Actualizada', 'Orden actualizada desde RADAR 3.0', currentUserId]
        );
        await connection.commit();

        // 2. Dispatch Automated WhatsApp Notifications for Status Changes
        const clientFullName = [
          order.customer?.name || (prevOrder ? [prevOrder.first_name, prevOrder.last_name].filter(Boolean).join(' ') : 'Cliente'),
        ].filter(Boolean).join(' ');
        const clientPhone = order.customer?.phone || prevOrder?.customer_phone || '';
        const orderCode = prevOrder?.order_code || `ORD-${orderId}`;
        const targetUserId = (assignedUserId !== undefined && assignedUserId !== null) ? assignedUserId : prevOrder?.user_id;
        const operatorName = prevOrder?.advisor_name || order.advisor || 'Operador Asignado';

        // A) Transition to "Pagado" (Venta Confirmada)
        const prevStatusStr = prevOrder?.status || '';
        const isNowPaid = /pagad/i.test(newDbStatus) || order.status === 'pagado';
        const wasAlreadyPaid = /pagad/i.test(prevStatusStr);

        if (isNowPaid && !wasAlreadyPaid) {
          const newSaleMsg = formatNuevaVentaMessage({
            orderCode,
            customerName: clientFullName,
            customerPhone: clientPhone,
            vehicleYear: order.vehicle?.year || prevOrder?.year,
            vehicleMake: order.vehicle?.make || prevOrder?.brand,
            vehicleModel: order.vehicle?.model || prevOrder?.model,
            vin: order.vehicle?.vin || prevOrder?.vin_nr || null,
            mainPart: order.mainPart || prevOrder?.product_type,
            productSpecs: order.productSpecs || prevOrder?.product_specs || null,
            totalPrice: Number(order.financials?.partPrice || prevOrder?.price || 0),
            downPayment: Number(order.financials?.downPayment || prevOrder?.down_payment || 0),
            deliveryType: order.deliveryType,
            shippingAddress: order.customer?.shippingAddress,
          });

          void dispatchSystemNotification(pool, wasender, 'NUEVA_VENTA', newSaleMsg, {
            creatorUserId: targetUserId ? Number(targetUserId) : undefined,
            creatorPhone: prevOrder?.advisor_phone || undefined,
            creatorName: operatorName,
            orderStatus: newDbStatus,
          }).catch((err) => {
            console.error('[Notification Dispatch] Error dispatching NUEVA_VENTA upon status change to Pagado:', err);
          });
        }

        // B) Ready for Pickup or Delivery ("Listo para Retiro" / "Listo para Despacho")
        const isReadyForPickupOrDelivery =
          /retiro|despacho|envio|envío/i.test(newDbStatus) ||
          /retiro|despacho|envio|envío/i.test(order.status || '');

        if (isReadyForPickupOrDelivery) {
          const statusMsg = formatCambioEstatusMessage({
            orderCode,
            vehicleYear: order.vehicle?.year || prevOrder?.year,
            vehicleMake: order.vehicle?.make || prevOrder?.brand,
            vehicleModel: order.vehicle?.model || prevOrder?.model,
            mainPart: order.mainPart || prevOrder?.product_type,
            customerName: clientFullName,
            customerPhone: clientPhone,
            newStatus: newDbStatus,
            advisorName: operatorName,
          });

          void dispatchSystemNotification(pool, wasender, 'CAMBIO_ESTATUS', statusMsg, {
            creatorUserId: targetUserId ? Number(targetUserId) : undefined,
            creatorPhone: prevOrder?.advisor_phone || undefined,
            creatorName: operatorName,
            orderStatus: newDbStatus,
          }).catch((err) => {
            console.error('[Notification Dispatch] Error dispatching CAMBIO_ESTATUS:', err);
          });
        }

        // C) Cancelled ("Cancelado")
        if (/cancelad/i.test(newDbStatus) || /cancelad/i.test(order.status || '')) {
          const refundAmt = Number(order.financials?.partPrice || prevOrder?.price || 0);
          const cancelMsg = formatOrdenCanceladaMessage({
            orderCode,
            customerName: clientFullName,
            vehicleYear: order.vehicle?.year || prevOrder?.year,
            vehicleMake: order.vehicle?.make || prevOrder?.brand,
            vehicleModel: order.vehicle?.model || prevOrder?.model,
            mainPart: order.mainPart || prevOrder?.product_type,
            productSpecs: order.productSpecs || null,
            refundAmount: refundAmt,
          });

          void dispatchSystemNotification(pool, wasender, 'ORDEN_CANCELADA', cancelMsg, {
            orderStatus: 'Cancelado',
          }).catch((err) => {
            console.error('[Notification Dispatch] Error dispatching ORDEN_CANCELADA:', err);
          });
        }

        // D) Solicitud de Reembolso ("Solicitud Reembolso")
        const isRefundRequest =
          /solicitud.*reembolso/i.test(newDbStatus) ||
          /solicitud.*reembolso/i.test(order.status || '');
        const wasAlreadyRefundRequest = /solicitud.*reembolso/i.test(prevStatusStr);

        if (isRefundRequest && !wasAlreadyRefundRequest) {
          const refundAmt = Number(
            order.financials?.downPayment ||
            order.financials?.partPrice ||
            prevOrder?.down_payment ||
            prevOrder?.price ||
            0
          );
          const refundReason = order.notes || 'Solicitud de reembolso registrada desde orden';
          const refundAmountType = (order.financials?.downPayment || prevOrder?.down_payment) ? 'downpayment' : 'total';
          const refundContact = clientPhone || prevOrder?.customer_phone || null;

          // Ensure a record exists in refund_requests so it is immediately manageable in ClaimsView
          const [existingRefund] = await connection.query<RowDataPacket[]>(
            "SELECT id FROM refund_requests WHERE order_id = ? AND status = 'pending' LIMIT 1",
            [orderId]
          );
          if (existingRefund.length === 0) {
            await connection.execute<ResultSetHeader>(
              `INSERT INTO refund_requests (order_id, amount, amount_type, payment_method, payment_contact, reason, status)
               VALUES (?, ?, ?, 'Zelle', ?, ?, 'pending')`,
              [orderId, refundAmt, refundAmountType, refundContact, refundReason]
            );
          }

          const refundMsg = formatSolicitudReembolsoMessage({
            orderCode,
            beneficiaryName: clientFullName,
            amount: refundAmt,
            reason: refundReason,
          });

          void dispatchSystemNotification(pool, wasender, 'SOLICITUD_REEMBOLSO', refundMsg, {
            orderStatus: newDbStatus,
          }).catch((err) => {
            console.error('[Notification Dispatch] Error dispatching SOLICITUD_REEMBOLSO on order status change:', err);
          });
        }

        const orders = await getOrders();
        const updatedOrder = orders.find((currentOrder) => currentOrder.id === orderId);

        if (updatedOrder) {
          void recordAuditLog(pool, {
            userId: Number(authenticatedClaims?.sub),
            username: authenticatedClaims?.email,
            action: 'ORDER_UPDATED',
            resourceType: 'order',
            resourceId: updatedOrder.code || `ORD-${orderId}`,
            details: {
              status: order.status,
              customer: order.customer?.name,
              totalPrice: order.financials?.partPrice,
            },
            ipAddress: request.socket.remoteAddress || 'unknown',
            userAgent: request.headers['user-agent'] || null,
          });
        }

        return updatedOrder ? sendJson(response, 200, updatedOrder) : sendJson(response, 404, { message: 'Orden no encontrada' });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }

    // ==========================================
    // CUSTOMERS (CRUD)
    // ==========================================
    if (request.method === 'GET' && pathname === '/api/customers') {
      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT c.*, COUNT(o.id) AS order_count
        FROM customers c
        LEFT JOIN orders o ON o.customer_id = c.id AND o.deleted_at IS NULL
        WHERE c.deleted_at IS NULL
        GROUP BY c.id
        ORDER BY c.created_at DESC
      `);
      return sendJson(response, 200, rows.map(mapCustomerRow));
    }

    if (request.method === 'POST' && pathname === '/api/customers') {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator')) return;
      const data = customerSchema.parse(await readBody(request));
      const firstName = data.first_name || data.name?.split(/\s+/)[0] || 'Cliente';
      const lastName = data.last_name || (data.name ? data.name.split(/\s+/).slice(1).join(' ') : null);
      const shipping = data.address_shipping || data.shippingAddress || null;

      const [result] = await pool.execute<ResultSetHeader>(
        `INSERT INTO customers (first_name, last_name, phone, whatsapp, email, address_shipping, zip_code, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [firstName, lastName, data.phone, data.whatsapp || data.phone, data.email || null, shipping, data.zip_code || null, data.notes || null]
      );

      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT c.*, 0 AS order_count FROM customers c WHERE c.id = ? LIMIT 1',
        [result.insertId]
      );
      return sendJson(response, 201, mapCustomerRow(rows[0]));
    }

    const customerId = pathname.match(/^\/api\/customers\/(\d+)$/)?.[1];
    if (request.method === 'PUT' && customerId) {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator')) return;
      const data = customerSchema.parse(await readBody(request));
      const firstName = data.first_name || data.name?.split(/\s+/)[0] || 'Cliente';
      const lastName = data.last_name || (data.name ? data.name.split(/\s+/).slice(1).join(' ') : null);
      const shipping = data.address_shipping || data.shippingAddress || null;

      await pool.execute(
        `UPDATE customers SET first_name = ?, last_name = ?, phone = ?, whatsapp = ?, email = ?, address_shipping = ?, zip_code = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND deleted_at IS NULL`,
        [firstName, lastName, data.phone, data.whatsapp || data.phone, data.email || null, shipping, data.zip_code || null, data.notes || null, customerId]
      );

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT c.*, COUNT(o.id) AS order_count
         FROM customers c
         LEFT JOIN orders o ON o.customer_id = c.id AND o.deleted_at IS NULL
         WHERE c.id = ? AND c.deleted_at IS NULL
         GROUP BY c.id LIMIT 1`,
        [customerId]
      );
      if (!rows[0]) return sendJson(response, 404, { message: 'Cliente no encontrado' });
      return sendJson(response, 200, mapCustomerRow(rows[0]));
    }

    if (request.method === 'DELETE' && customerId) {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const [result] = await pool.execute<ResultSetHeader>(
        'UPDATE customers SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL',
        [customerId]
      );
      if (result.affectedRows === 0) return sendJson(response, 404, { message: 'Cliente no encontrado' });
      return sendJson(response, 200, { ok: true, id: Number(customerId) });
    }

    // ==========================================
    // CLAIMS & CALLS
    // ==========================================
    if (request.method === 'GET' && pathname === '/api/claims') {
      return sendJson(response, 200, await getClaims());
    }

    if (request.method === 'POST' && pathname === '/api/claims') {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator')) return;
      const claim = claimSchema.parse(await readBody(request));
      const orderIdVal = claim.orderId;
      const description = claim.description;

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [result] = await connection.execute<ResultSetHeader>(
          'INSERT INTO claims (order_id, description, status, assigned_user_id) VALUES (?, ?, ?, ?)',
          [orderIdVal, description, 'Pending', claim.assignedUserId || authenticatedClaims?.sub || null]
        );
        await connection.execute(
          'UPDATE orders SET status = ?, claim_reason = ? WHERE id = ?',
          [statusToDatabase.reclamo, description, orderIdVal]
        );
        const currentUserId = Number(authenticatedClaims?.sub) || 1;
        await connection.execute(
          'INSERT INTO status_orders (order_id, status, description, user_id) VALUES (?, ?, ?, ?)',
          [orderIdVal, statusToDatabase.reclamo, `Reclamo REC-${result.insertId} registrado: ${description}`, currentUserId]
        );
        await connection.commit();
        const claimsList = await getClaims();
        const createdClaim = claimsList.find((c) => c.id === `REC-${result.insertId}`);

        // Fetch order details for notification
        const [claimOrderRows] = await pool.query<RowDataPacket[]>(
          `SELECT o.order_code, o.brand, o.model, o.year, o.vin_nr, o.product_type, o.product_specs,
                  c.first_name, c.last_name, c.phone AS customer_phone,
                  u.name AS advisor_name
           FROM orders o
           LEFT JOIN customers c ON c.id = o.customer_id
           LEFT JOIN users u ON u.id = o.user_id
           WHERE o.id = ? LIMIT 1`,
          [orderIdVal]
        );
        const claimOrder = claimOrderRows[0];
        const clientFullName = [claimOrder?.first_name, claimOrder?.last_name].filter(Boolean).join(' ') || 'Cliente';

        const claimMsg = formatNuevoReclamoMessage({
          orderCode: claimOrder?.order_code || `ORD-${orderIdVal}`,
          customerName: clientFullName,
          customerPhone: claimOrder?.customer_phone,
          vehicleYear: claimOrder?.year,
          vehicleMake: claimOrder?.brand,
          vehicleModel: claimOrder?.model,
          vin: claimOrder?.vin_nr,
          mainPart: claimOrder?.product_type,
          productSpecs: claimOrder?.product_specs,
          claimReason: description,
        });

        void dispatchSystemNotification(pool, wasender, 'NUEVO_RECLAMO', claimMsg).catch((err) => {
          console.error('[Notification Dispatch] Error dispatching NUEVO_RECLAMO:', err);
        });

        void recordAuditLog(pool, {
          userId: Number(authenticatedClaims?.sub),
          username: authenticatedClaims?.email,
          action: 'CLAIM_CREATED',
          resourceType: 'claim',
          resourceId: `REC-${result.insertId}`,
          details: { orderId: orderIdVal, reason: description },
          ipAddress: request.socket.remoteAddress || 'unknown',
          userAgent: request.headers['user-agent'] || null,
        });

        return sendJson(response, 201, createdClaim || { id: `REC-${result.insertId}`, orderId: String(orderIdVal), claimReason: description, status: 'Pending' });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }

    const claimId = pathname.match(/^\/api\/claims\/REC-(\d+)$/)?.[1] || pathname.match(/^\/api\/claims\/(\d+)$/)?.[1];

    const claimCallsMatch = pathname.match(/^\/api\/claims\/(?:REC-)?(\d+)\/calls$/);
    if (request.method === 'POST' && claimCallsMatch) {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator')) return;
      const cId = claimCallsMatch[1];
      const callData = claimCallCreateSchema.parse(await readBody(request));
      const [claimRows] = await pool.query<RowDataPacket[]>('SELECT order_id, description FROM claims WHERE id = ? AND deleted_at IS NULL LIMIT 1', [cId]);
      if (!claimRows[0]) return sendJson(response, 404, { message: 'Reclamo no encontrado' });
      const ordId = claimRows[0].order_id;
      const origClaimReason = claimRows[0].description;

      const [result] = await pool.execute<ResultSetHeader>(
        `INSERT INTO call_register (order_id, claim_id, caller_name, caller_phone, attended_by, conversation_summary, whatsapp_dispatched, whatsapp_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [ordId, cId, callData.callerName || null, callData.callerPhone || null, callData.attendedBy || null, callData.conversationSummary, callData.whatsappDispatched ? 1 : 0, callData.whatsappMessage || null]
      );

      // Count total calls for this claim
      const [callCountRows] = await pool.query<RowDataPacket[]>(
        'SELECT COUNT(id) AS total_calls FROM call_register WHERE claim_id = ? AND deleted_at IS NULL',
        [cId]
      );
      const callNumber = Number(callCountRows[0]?.total_calls || 1);

      // Fetch order details for notification
      const [ordRows] = await pool.query<RowDataPacket[]>(
        `SELECT o.order_code, o.brand, o.model, o.year, o.product_type, o.product_specs,
                c.first_name, c.last_name, c.phone AS customer_phone
         FROM orders o
         LEFT JOIN customers c ON c.id = o.customer_id
         WHERE o.id = ? LIMIT 1`,
        [ordId]
      );
      const ordDetail = ordRows[0];
      const clientName = [ordDetail?.first_name, ordDetail?.last_name].filter(Boolean).join(' ') || callData.callerName || 'Cliente';

      const followupMsg = formatSeguimientoReclamoMessage({
        orderCode: ordDetail?.order_code || `ORD-${ordId}`,
        callNumber,
        customerName: clientName,
        customerPhone: ordDetail?.customer_phone || callData.callerPhone,
        vehicleYear: ordDetail?.year,
        vehicleMake: ordDetail?.brand,
        vehicleModel: ordDetail?.model,
        mainPart: ordDetail?.product_type,
        productSpecs: ordDetail?.product_specs,
        originalClaimReason: origClaimReason,
        callNotes: callData.conversationSummary,
        attendantName: callData.attendedBy || authenticatedClaims?.name || 'Asesor de Garantías',
      });

      void dispatchSystemNotification(pool, wasender, 'SEGUIMIENTO_RECLAMO', followupMsg).catch((err) => {
        console.error('[Notification Dispatch] Error dispatching SEGUIMIENTO_RECLAMO:', err);
      });

      return sendJson(response, 201, {
        id: `CALL-${result.insertId}`,
        claimId: `REC-${cId}`,
        callerName: callData.callerName || '',
        callerPhone: callData.callerPhone || '',
        attendedBy: callData.attendedBy || '',
        conversationSummary: callData.conversationSummary,
        createdAt: new Date().toISOString(),
        whatsappDispatched: Boolean(callData.whatsappDispatched),
        whatsappMessage: callData.whatsappMessage || '',
      });
    }

    if (request.method === 'PUT' && claimId) {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator')) return;
      const claim = claimUpdateSchema.parse(await readBody(request));
      const status = String(claim.status || '').trim();

      const [existingClaims] = await pool.query<RowDataPacket[]>('SELECT id, order_id, status FROM claims WHERE id = ? AND deleted_at IS NULL LIMIT 1', [claimId]);
      if (!existingClaims[0]) return sendJson(response, 404, { message: 'Reclamo no encontrado' });
      const targetOrderId = claim.orderId || existingClaims[0].order_id;

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute('UPDATE claims SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, claimId]);

        const currentUserId = Number(authenticatedClaims?.sub) || 1;
        if (status === 'Resolved' && targetOrderId) {
          const previousStatus = statusToDatabase[claim.previousOrderStatus || ''] || statusToDatabase.entregado;
          await connection.execute(
            'UPDATE orders SET status = ?, claim_reason = NULL WHERE id = ?',
            [previousStatus, targetOrderId]
          );
          await connection.execute(
            'INSERT INTO status_orders (order_id, status, description, user_id) VALUES (?, ?, ?, ?)',
            [targetOrderId, previousStatus, `Reclamo REC-${claimId} resuelto. Orden restaurada a ${previousStatus}.`, currentUserId]
          );
        } else if (status === 'Denied' && targetOrderId) {
          await connection.execute(
            'INSERT INTO status_orders (order_id, status, description, user_id) VALUES (?, ?, ?, ?)',
            [targetOrderId, statusToDatabase.reclamo, `Reclamo REC-${claimId} marcado como Denegado.`, currentUserId]
          );
        }

        await connection.commit();
        return sendJson(response, 200, { id: `REC-${claimId}`, status });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }

    // ==========================================
    // REFUNDS
    // ==========================================
    // REFUND REQUESTS
    // ==========================================
    if (request.method === 'GET' && pathname === '/api/refunds') {
      try {
        await pool.query(`
          INSERT INTO refund_requests (order_id, amount, amount_type, payment_method, payment_contact, reason, status)
          SELECT o.id,
                 COALESCE(NULLIF(o.down_payment, 0), NULLIF(o.price, 0), 0),
                 IF(o.down_payment > 0, 'downpayment', 'total'),
                 'Zelle',
                 c.phone,
                 COALESCE(NULLIF(o.claim_reason, ''), NULLIF(o.description, ''), 'Solicitud de reembolso registrada'),
                 'pending'
          FROM orders o
          LEFT JOIN customers c ON c.id = o.customer_id
          WHERE o.status = 'Solicitud Reembolso' AND o.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM refund_requests r WHERE r.order_id = o.id AND r.status = 'pending')
        `);
      } catch (syncErr) {
        console.error('[GET /api/refunds] Auto-sync error:', syncErr);
      }


      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT r.*, o.order_code, o.brand, o.model, o.year, o.product_type,
               c.first_name, c.last_name, c.phone AS customer_phone
        FROM refund_requests r
        LEFT JOIN orders o ON o.id = r.order_id
        LEFT JOIN customers c ON c.id = o.customer_id
        ORDER BY r.created_at DESC
      `);
      return sendJson(response, 200, rows.map((row) => ({
        id: `REF-${row.id}`,
        orderId: String(row.order_id),
        orderCode: row.order_code || `ORD-${row.order_id}`,
        customerName: [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Cliente en Reembolso',
        customerPhone: row.customer_phone || '',
        vehicle: [row.year, row.brand, row.model].filter(Boolean).join(' ') || 'Vehículo',
        part: row.product_type || 'Refacción',
        reason: row.reason || '',
        amount: Number(row.amount || 0),
        amountType: row.amount_type || 'downpayment',
        paymentMethod: row.payment_method || 'Zelle',
        paymentDetails: row.payment_contact || row.payment_details || '',
        status: row.status || 'pending',
        createdAt: row.created_at,
        completedAt: row.completed_at || undefined,
        completedBy: row.completed_by || undefined,
      })));
    }

    if (request.method === 'POST' && pathname === '/api/refunds') {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator')) return;
      const refund = refundCreateSchema.parse(await readBody(request));
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // 1. Resolve actual order row by PK id or order_code
        const [targetOrderRows] = await connection.query<RowDataPacket[]>(
          `SELECT o.id, o.order_code, o.brand, o.model, o.year, o.product_type,
                  c.first_name, c.last_name, c.phone AS customer_phone,
                  u.name AS advisor_name
           FROM orders o
           LEFT JOIN customers c ON c.id = o.customer_id
           LEFT JOIN users u ON u.id = o.user_id
           WHERE o.id = ? OR o.order_code = ? OR o.order_code = ?
           LIMIT 1`,
          [refund.orderId, String(refund.orderId), `ORD-${refund.orderId}`]
        );
        const refundOrder = targetOrderRows[0];
        const actualOrderId = refundOrder ? Number(refundOrder.id) : refund.orderId;

        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO refund_requests (order_id, amount, amount_type, payment_method, payment_contact, reason, status)
           VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
          [actualOrderId, refund.amount, refund.amountType, refund.paymentMethod, refund.paymentDetails || null, refund.reason]
        );
        await connection.execute(
          'UPDATE orders SET status = ? WHERE id = ?',
          [statusToDatabase.solicitud_reembolso, actualOrderId]
        );
        const currentUserId = Number(authenticatedClaims?.sub) || 1;
        await connection.execute(
          'INSERT INTO status_orders (order_id, status, description, user_id) VALUES (?, ?, ?, ?)',
          [actualOrderId, statusToDatabase.solicitud_reembolso, `Solicitud de reembolso REF-${result.insertId} registrada por $${refund.amount}`, currentUserId]
        );
        await connection.commit();

        const beneficiaryName = [refundOrder?.first_name, refundOrder?.last_name].filter(Boolean).join(' ') || 'Cliente / Beneficiario';

        const refundMsg = formatSolicitudReembolsoMessage({
          orderCode: refundOrder?.order_code || `ORD-${actualOrderId}`,
          beneficiaryName,
          amount: refund.amount,
          reason: refund.reason,
        });

        void dispatchSystemNotification(pool, wasender, 'SOLICITUD_REEMBOLSO', refundMsg).catch((err) => {
          console.error('[Notification Dispatch] Error dispatching SOLICITUD_REEMBOLSO:', err);
        });

        return sendJson(response, 201, { id: `REF-${result.insertId}`, orderId: String(actualOrderId), status: 'pending', amount: refund.amount });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }

    const refundId = pathname.match(/^\/api\/refunds\/REF-(\d+)$/)?.[1] || pathname.match(/^\/api\/refunds\/(\d+)$/)?.[1];
    if (request.method === 'PUT' && refundId) {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const refund = refundUpdateSchema.parse(await readBody(request));
      const [rows] = await pool.query<RowDataPacket[]>('SELECT order_id, amount FROM refund_requests WHERE id = ? LIMIT 1', [refundId]);
      if (!rows[0]) return sendJson(response, 404, { message: 'Reembolso no encontrado' });
      const orderIdVal = rows[0].order_id;

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const completedByUserId = Number(authenticatedClaims?.sub) || null;
        await connection.execute(
          `UPDATE refund_requests SET status = ?, completed_by = ?, completed_at = ${refund.status === 'completed' ? 'CURRENT_TIMESTAMP' : 'NULL'}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [refund.status, completedByUserId, refundId]
        );

        if (refund.status === 'completed' && orderIdVal) {
          await connection.execute('UPDATE orders SET status = ? WHERE id = ?', [statusToDatabase.reembolsado, orderIdVal]);
          const currentUserId = Number(authenticatedClaims?.sub) || 1;
          await connection.execute(
            'INSERT INTO status_orders (order_id, status, description, user_id) VALUES (?, ?, ?, ?)',
            [orderIdVal, statusToDatabase.reembolsado, `Reembolso REF-${refundId} completado exitosamente.`, currentUserId]
          );
        }
        await connection.commit();
        return sendJson(response, 200, { id: `REF-${refundId}`, status: refund.status });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }

    // ==========================================
    // USERS (CRUD)
    // ==========================================
    if (request.method === 'GET' && pathname === '/api/users') {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator')) return;
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id, name, email, phone, avatar_url, role, permissions, theme, active, created_at, updated_at FROM users WHERE deleted_at IS NULL ORDER BY name'
      );
      return sendJson(
        response,
        200,
        rows.map((row) => ({
          ...row,
          phone: row.phone || '',
          avatar_url: row.avatar_url || '',
          permissions: parsePermissions(row.permissions),
        }))
      );
    }

    if (request.method === 'POST' && pathname === '/api/users') {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const userData = userCreateSchema.parse(await readBody(request));
      const passwordHash = await bcrypt.hash(userData.password, 10);
      try {
        const [result] = await pool.execute<ResultSetHeader>(
          `INSERT INTO users (name, email, phone, avatar_url, password, role, permissions, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userData.name,
            userData.email.toLowerCase(),
            userData.phone ? userData.phone.trim() : null,
            userData.avatar_url ? userData.avatar_url.trim() : null,
            passwordHash,
            userData.role,
            JSON.stringify(userData.permissions),
            userData.active ? 1 : 0,
          ]
        );
        const [rows] = await pool.query<RowDataPacket[]>(
          'SELECT id, name, email, phone, avatar_url, role, permissions, theme, active, created_at, updated_at FROM users WHERE id = ? LIMIT 1',
          [result.insertId]
        );
        void recordAuditLog(pool, {
          userId: Number(authenticatedClaims.sub),
          username: authenticatedClaims.email,
          action: 'USER_CREATED',
          resourceType: 'user',
          resourceId: result.insertId,
          details: { name: userData.name, email: userData.email, role: userData.role },
          ipAddress: request.socket.remoteAddress || 'unknown',
          userAgent: request.headers['user-agent'] || null,
        });
        return sendJson(response, 201, {
          ...rows[0],
          phone: rows[0].phone || '',
          avatar_url: rows[0].avatar_url || '',
          permissions: parsePermissions(rows[0].permissions),
        });
      } catch (error) {
        if (typeof error === 'object' && error && 'code' in error && error.code === 'ER_DUP_ENTRY') {
          return sendJson(response, 409, { message: 'El correo electrónico ya está registrado' });
        }
        throw error;
      }
    }

    const userId = pathname.match(/^\/api\/users\/(\d+)$/)?.[1];
    if (request.method === 'PUT' && userId) {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const user = userUpdateSchema.parse(await readBody(request));
      const currentUserId = String(authenticatedClaims?.sub || '');
      if (currentUserId === userId && (user.role.toLowerCase() !== 'admin' || !user.active)) {
        return sendJson(response, 400, { message: 'No puedes degradar o desactivar tu propia cuenta de administrador' });
      }

      try {
        let passwordUpdateClause = '';
        const params: any[] = [
          user.name,
          user.email.toLowerCase(),
          user.phone ? user.phone.trim() : null,
          user.avatar_url ? user.avatar_url.trim() : null,
          user.role,
          JSON.stringify(user.permissions),
          user.active ? 1 : 0,
        ];
        if (user.password) {
          const hash = await bcrypt.hash(user.password, 10);
          passwordUpdateClause = ', password = ?';
          params.push(hash);
        }
        params.push(userId);

        await pool.execute(
          `UPDATE users SET name = ?, email = ?, phone = ?, avatar_url = ?, role = ?, permissions = ?, active = ? ${passwordUpdateClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL`,
          params
        );
      } catch (error) {
        if (typeof error === 'object' && error && 'code' in error && error.code === 'ER_DUP_ENTRY') {
          return sendJson(response, 409, { message: 'El correo ya está asociado a otro usuario' });
        }
        throw error;
      }

      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id, name, email, phone, avatar_url, role, permissions, theme, active, created_at, updated_at FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
        [userId]
      );
      if (!rows[0]) return sendJson(response, 404, { message: 'Usuario no encontrado' });
      void recordAuditLog(pool, {
        userId: Number(authenticatedClaims.sub),
        username: authenticatedClaims.email,
        action: 'USER_UPDATED',
        resourceType: 'user',
        resourceId: userId,
        details: { name: user.name, email: user.email, role: user.role, active: user.active },
        ipAddress: request.socket.remoteAddress || 'unknown',
        userAgent: request.headers['user-agent'] || null,
      });
      return sendJson(response, 200, {
        ...rows[0],
        phone: rows[0].phone || '',
        avatar_url: rows[0].avatar_url || '',
        permissions: parsePermissions(rows[0].permissions),
      });
    }

    if (request.method === 'DELETE' && userId) {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const currentUserId = String(authenticatedClaims?.sub || '');
      if (currentUserId === userId) {
        return sendJson(response, 400, { message: 'No puedes eliminar tu propio usuario' });
      }

      const [result] = await pool.execute<ResultSetHeader>(
        'UPDATE users SET deleted_at = CURRENT_TIMESTAMP, active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL',
        [userId]
      );
      if (result.affectedRows === 0) return sendJson(response, 404, { message: 'Usuario no encontrado' });
      void recordAuditLog(pool, {
        userId: Number(authenticatedClaims.sub),
        username: authenticatedClaims.email,
        action: 'USER_DELETED',
        resourceType: 'user',
        resourceId: userId,
        ipAddress: request.socket.remoteAddress || 'unknown',
        userAgent: request.headers['user-agent'] || null,
      });
      return sendJson(response, 200, { ok: true, id: Number(userId) });
    }

    // ==========================================
    // INVENTORY (HOLD & STOCK PARTS)
    // ==========================================
    if (request.method === 'GET' && pathname === '/api/inventory') {
      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT * FROM inventory_parts
        WHERE deleted_at IS NULL
        ORDER BY created_at DESC
      `);
      return sendJson(response, 200, rows.map(mapInventoryPartRow));
    }

    if (request.method === 'POST' && pathname === '/api/inventory') {
      const payload = inventoryPartSchema.parse(await readBody(request));
      const isSold = (payload.status || 'disponible').toLowerCase() === 'vendido';
      const soldAtValue = payload.soldAt !== undefined
        ? (payload.soldAt ? new Date(payload.soldAt) : null)
        : (isSold ? new Date() : null);
      
      const [result] = await pool.execute<ResultSetHeader>(`
        INSERT INTO inventory_parts (
          year, year_from, year_to, is_exact_year_only, brand, model, part_type, vin, pallet_number, engine_specs, status, notes, sold_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        payload.year,
        payload.yearFrom || null,
        payload.yearTo || null,
        payload.isExactYearOnly ? 1 : 0,
        payload.brand,
        payload.model || '',
        payload.partType || 'Motor',
        payload.vin || null,
        payload.palletNumber || null,
        payload.engineSpecs || null,
        payload.status || 'disponible',
        payload.notes || null,
        soldAtValue,
      ]);

      const [createdRows] = await pool.query<RowDataPacket[]>('SELECT * FROM inventory_parts WHERE id = ?', [result.insertId]);
      return sendJson(response, 201, mapInventoryPartRow(createdRows[0]));
    }

    const inventoryIdMatch = pathname.match(/^\/api\/inventory\/(\d+)$/);
    if (inventoryIdMatch && request.method === 'GET') {
      const partId = Number(inventoryIdMatch[1]);
      const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM inventory_parts WHERE id = ? AND deleted_at IS NULL', [partId]);
      if (rows.length === 0) return sendJson(response, 404, { message: 'Pieza de inventario no encontrada' });
      return sendJson(response, 200, mapInventoryPartRow(rows[0]));
    }

    if (inventoryIdMatch && request.method === 'PUT') {
      const partId = Number(inventoryIdMatch[1]);
      const payload = inventoryPartUpdateSchema.parse(await readBody(request));
      
      const updates: string[] = [];
      const values: any[] = [];
      
      if (payload.year !== undefined) { updates.push('year = ?'); values.push(payload.year); }
      if (payload.yearFrom !== undefined) { updates.push('year_from = ?'); values.push(payload.yearFrom || null); }
      if (payload.yearTo !== undefined) { updates.push('year_to = ?'); values.push(payload.yearTo || null); }
      if (payload.isExactYearOnly !== undefined) { updates.push('is_exact_year_only = ?'); values.push(payload.isExactYearOnly ? 1 : 0); }
      if (payload.brand !== undefined) { updates.push('brand = ?'); values.push(payload.brand); }
      if (payload.model !== undefined) { updates.push('model = ?'); values.push(payload.model); }
      if (payload.partType !== undefined) { updates.push('part_type = ?'); values.push(payload.partType); }
      if (payload.vin !== undefined) { updates.push('vin = ?'); values.push(payload.vin); }
      if (payload.palletNumber !== undefined) { updates.push('pallet_number = ?'); values.push(payload.palletNumber); }
      if (payload.engineSpecs !== undefined) { updates.push('engine_specs = ?'); values.push(payload.engineSpecs); }
      if (payload.status !== undefined) { updates.push('status = ?'); values.push(payload.status); }
      if (payload.soldAt !== undefined) {
        updates.push('sold_at = ?');
        values.push(payload.soldAt ? new Date(payload.soldAt) : null);
      } else if (payload.status !== undefined) {
        if (payload.status.toLowerCase() === 'vendido') {
          updates.push('sold_at = IFNULL(sold_at, CURRENT_TIMESTAMP)');
        } else if (payload.status.toLowerCase() === 'disponible') {
          updates.push('sold_at = NULL');
        }
      }
      if (payload.notes !== undefined) { updates.push('notes = ?'); values.push(payload.notes); }
      
      if (updates.length > 0) {
        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(partId);
        const [result] = await pool.execute<ResultSetHeader>(
          `UPDATE inventory_parts SET ${updates.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
          values
        );
        if (result.affectedRows === 0) return sendJson(response, 404, { message: 'Pieza de inventario no encontrada' });
      }

      const [updatedRows] = await pool.query<RowDataPacket[]>('SELECT * FROM inventory_parts WHERE id = ?', [partId]);
      return sendJson(response, 200, mapInventoryPartRow(updatedRows[0]));
    }

    if (inventoryIdMatch && request.method === 'DELETE') {
      const partId = Number(inventoryIdMatch[1]);
      const [result] = await pool.execute<ResultSetHeader>(
        'UPDATE inventory_parts SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL',
        [partId]
      );
      if (result.affectedRows === 0) return sendJson(response, 404, { message: 'Pieza no encontrada' });
      return sendJson(response, 200, { ok: true, id: partId });
    }

    if (request.method === 'GET' && pathname === '/api/activities') {
      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT so.id, so.status, so.description, so.created_at, o.order_code
        FROM status_orders so
        LEFT JOIN orders o ON o.id = so.order_id
        ORDER BY so.created_at DESC LIMIT 20
      `);
      return sendJson(response, 200, rows.map((row) => ({
        id: `activity-${row.id}`,
        title: `${row.order_code || 'Orden'}: ${row.status}`,
        description: row.description || 'Actualización registrada en la orden.',
        timeAgo: new Date(row.created_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }),
        type: String(row.status).toLowerCase().includes('reclamo') ? 'alert' : 'status_change',
        icon: String(row.status).toLowerCase().includes('reclamo') ? 'error' : 'sync',
        orderCode: row.order_code || '',
      })));
    }

    // ==========================================
    // UPLOADS & FILE SERVING
    // ==========================================
    if (request.method === 'GET' && pathname.startsWith('/uploads/')) {
      const filename = path.basename(pathname);
      const filePath = path.resolve(process.cwd(), 'uploads', filename);
      if (!existsSync(filePath)) {
        return sendJson(response, 404, { message: 'Archivo no encontrado' });
      }
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.csv': 'text/csv',
      };
      response.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      });
      createReadStream(filePath).pipe(response);
      return;
    }

    if (request.method === 'POST' && pathname === '/api/upload') {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator')) return;
      const data = uploadPayloadSchema.parse(await readBody(request));
      const buffer = Buffer.from(data.base64.replace(/^data:.*?;base64,/, ''), 'base64');
      if (buffer.length > 10 * 1024 * 1024) {
        return sendJson(response, 400, { message: 'El archivo excede el límite máximo de 10MB' });
      }

      const ext = path.extname(data.filename).toLowerCase();
      const allowedExts = MIME_EXTENSION_MAP[data.contentType];
      if (!allowedExts || !allowedExts.includes(ext)) {
        return sendJson(response, 400, {
          message: `La extensión "${ext || 'ninguna'}" no coincide con el tipo de contenido (${data.contentType})`,
        });
      }

      // Block dangerous secondary extensions (e.g., shell.php.png, malware.exe.jpg)
      const baseNameWithoutExt = path.basename(data.filename, ext);
      if (/\.(php|phtml|exe|sh|bat|cmd|js|vbs|jar|py|cgi|pl|dll|so)$/i.test(baseNameWithoutExt)) {
        return sendJson(response, 400, {
          message: 'El archivo contiene una extensión secundaria no permitida por seguridad',
        });
      }

      if (!validateFileMagicBytes(buffer, data.contentType)) {
        return sendJson(response, 400, {
          message: 'El contenido binario del archivo no coincide con su tipo de contenido declarado',
        });
      }

      const uploadDir = path.resolve(process.cwd(), 'uploads');
      await fs.mkdir(uploadDir, { recursive: true });

      const safeBaseName = path.basename(data.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
      const uniqueName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeBaseName}`;
      const targetPath = path.join(uploadDir, uniqueName);
      await fs.writeFile(targetPath, buffer);

      return sendJson(response, 201, {
        ok: true,
        url: `/uploads/${uniqueName}`,
        filename: uniqueName,
        size: buffer.length,
        contentType: data.contentType,
      });
    }

    // ==========================================
    // WASENDER / WHATSAPP DISPATCH & STATUS
    // ==========================================
    if (request.method === 'GET' && pathname === '/api/wasender/status') {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator')) return;
      return sendJson(response, 200, {
        configured: wasender.configured,
        isTestMode: wasender.isTestMode,
        designatedTestPhone: wasender.designatedTestPhone,
        sessionName: 'Douglas Movistar',
        connectedPhone: '+584145380654',
        accountName: 'Control Rodriguez Salvage Yard',
        service: 'WasenderAPI (wasenderapi.com)',
      });
    }

    if (request.method === 'POST' && pathname === '/api/wasender/test-ping') {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator')) return;
      const body = (await readBody(request).catch(() => ({}))) as { message?: string; phone?: string };
      const targetPhone = body.phone || wasender.designatedTestPhone || '584127307933';
      const nowStr = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const testText =
        body.message ||
        `🛰️ *RADAR V3 • Prueba de Conexión Wasender*\n\n✅ Enlace con WasenderAPI verificado exitosamente.\n⏰ *Hora:* ${nowStr}\n👤 *Operador:* ${authenticatedClaims?.name || 'Administrador'}\n🛡️ *Sesión:* Douglas Movistar (+58 414-5380654)`;

      try {
        const res = await wasender.sendText({ to: targetPhone, text: testText });
        return sendJson(response, 200, {
          ok: true,
          dispatched: true,
          recipientUsed: res.recipientUsed,
          originalRecipient: res.originalRecipient,
          isTestRedirect: res.isTestRedirect,
          data: res.data,
          message: 'Mensaje de prueba transmitido con éxito a WhatsApp',
        });
      } catch (error) {
        return sendJson(response, 400, {
          ok: false,
          dispatched: false,
          error: error instanceof Error ? error.message : 'Error al enviar mensaje vía Wasender',
        });
      }
    }

    if (request.method === 'POST' && pathname === '/api/wasender/send') {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator')) return;
      const data = wasenderDispatchSchema.parse(await readBody(request));

      let result: any = { ok: true };
      if (wasender.configured) {
        try {
          let wasenderRes;
          if (data.mediaUrl && data.mediaType === 'image') {
            wasenderRes = await wasender.sendImage({ to: data.phone, url: data.mediaUrl, caption: data.message });
          } else if (data.mediaUrl && data.mediaType === 'file') {
            wasenderRes = await wasender.sendFile({ to: data.phone, url: data.mediaUrl, caption: data.message });
          } else {
            wasenderRes = await wasender.sendText({ to: data.phone, text: data.message });
          }
          result.dispatched = true;
          result.recipientUsed = wasenderRes.recipientUsed;
          result.originalRecipient = wasenderRes.originalRecipient;
          result.isTestRedirect = wasenderRes.isTestRedirect;
          result.data = wasenderRes.data;
        } catch (error) {
          result.dispatched = false;
          result.warning = error instanceof Error ? error.message : 'Error al contactar Wasender';
        }
      } else {
        result.dispatched = false;
        result.simulated = true;
        result.whatsappUrl = `https://api.whatsapp.com/send?phone=${encodeURIComponent(data.phone.replace(/[^0-9+]/g, ''))}&text=${encodeURIComponent(data.message)}`;
      }

      if (data.orderId) {
        try {
          await pool.execute(
            `INSERT INTO call_register (order_id, caller_phone, attended_by, conversation_summary, whatsapp_dispatched, whatsapp_message)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              data.orderId,
              data.phone,
              authenticatedClaims?.name || 'Sistema Radar',
              'Mensaje de WhatsApp despachado vía Wasender',
              result.dispatched ? 1 : 0,
              data.message,
            ]
          );
        } catch (e) {
          console.error('Error al registrar llamada/mensaje en call_register:', e);
        }
      }

      return sendJson(response, 200, result);
    }

    // ==========================================
    // NOTIFICATION CONFIGURATION & MULTICAST
    // ==========================================
    if (request.method === 'GET' && pathname === '/api/wasender/notifications/config') {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator')) return;
      const config = await getNotificationConfig(pool, wasender);
      return sendJson(response, 200, config);
    }

    if (request.method === 'PUT' && pathname === '/api/wasender/notifications/config') {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const data = notificationConfigUpdateSchema.parse(await readBody(request));
      await updateNotificationChannels(pool, data.channels as any);
      const updatedConfig = await getNotificationConfig(pool, wasender);
      return sendJson(response, 200, {
        ok: true,
        message: 'Configuración de canales de notificación actualizada con éxito',
        config: updatedConfig,
      });
    }

    if (request.method === 'POST' && pathname === '/api/wasender/notifications/external-contacts') {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const data = externalContactSchema.parse(await readBody(request));
      const created = await createExternalContact(pool, data as any);
      return sendJson(response, 201, {
        ok: true,
        message: 'Contacto externo registrado exitosamente',
        contact: created,
      });
    }

    const extContactId = pathname.match(/^\/api\/wasender\/notifications\/external-contacts\/(\d+)$/)?.[1];
    if (request.method === 'PUT' && extContactId) {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const data = externalContactUpdateSchema.parse(await readBody(request));
      await updateExternalContact(pool, Number(extContactId), data as any);
      return sendJson(response, 200, {
        ok: true,
        message: 'Contacto externo actualizado con éxito',
      });
    }

    if (request.method === 'DELETE' && extContactId) {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      await deleteExternalContact(pool, Number(extContactId));
      return sendJson(response, 200, {
        ok: true,
        message: 'Contacto externo eliminado del sistema',
      });
    }

    if (request.method === 'POST' && pathname === '/api/wasender/notifications/dispatch-test') {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator')) return;
      const data = notificationTestDispatchSchema.parse(await readBody(request));

      const defaultSampleMessages: Record<string, string> = {
        NUEVA_VENTA: formatNuevaVentaMessage({
          orderCode: 'ORD-524932',
          customerName: 'Ricardo Santiago',
          customerPhone: '+19103053788',
          vehicleYear: 2016,
          vehicleMake: 'NISSAN',
          vehicleModel: 'Sentra',
          vin: '3N1AB7AP6GY311454',
          mainPart: 'Transmission',
          productSpecs: 'AT, (CVT), (1.8L)',
          totalPrice: 1500,
          downPayment: 200,
          deliveryType: 'retiro_tienda',
        }),
        BUSQUEDA_SUBASTAS: formatBusquedaSubastasMessage({
          customerName: "G' Black Tires",
          saleDate: '6/8/2026',
          totalPrice: 2700,
          vehicleYear: 2015,
          vehicleMake: 'RAM',
          vehicleModel: '1500',
          mainPart: 'Engine',
          vin: '1C6RR7GG3FS524370',
          description: '3.6L (VIN G, 8th digit), w/o automatic engine stop and start',
          auctionLinks: [
            { house: 'Copart', date: '28/9/2026', url: 'https://www.copart.com/lot/69789446/salvage-2016-ram-1500-slt-nc-lumberton' },
            { house: 'Copart', date: '29/9/2026', url: 'https://www.copart.com/lot/69602096/salvage-2017-ram-1500-st-nc-lagrange' },
            { house: 'IAA', date: '30/9/2026', url: 'https://www.iaai.com/VehicleDetail/46252312~US' },
          ],
        }),
        NUEVO_RECLAMO: formatNuevoReclamoMessage({
          orderCode: 'ORD-900283',
          customerName: 'Dan Diggf',
          customerPhone: '9197535676',
          vehicleYear: 2012,
          vehicleMake: 'CHEVROLET',
          vehicleModel: 'Traverse',
          vin: '1GNKVJEDXCJ12534',
          mainPart: 'Transmission',
          productSpecs: 'AT, AWD',
          claimReason: 'El taller le dijo que la transmisión está dañada. El corporativo de GM no pudo reprogramarla/acceder a ella y confirmaron una falla interna.',
        }),
        SEGUIMIENTO_RECLAMO: formatSeguimientoReclamoMessage({
          orderCode: 'ORD-044700',
          callNumber: 1,
          customerName: 'Casimiro Figueroa',
          customerPhone: '9192626168',
          vehicleYear: 2005,
          vehicleMake: 'CHEVROLET',
          vehicleModel: 'Silverado',
          mainPart: 'Transmission',
          productSpecs: 'AT, 5.3L, 4x4,',
          originalClaimReason: 'El señor refiere que la transmission no le queda a la camioneta. Tambien es mala; estaba leakeando agua.',
          callNotes: 'La transmision pues no esta quedando, el convertidor es diferente, de la parte de atras donde entra el transfer case no entra tampoco (tiene 5 tornillos y debe tener 6 tornillos), 4L60E, cuando le estaba poniendo se le estaba saliendo agua y estaba como leche, el shifter esta bien durisimo no se quiere mover, se oxidan por dentro',
          attendantName: 'Favio Andrade',
        }),
        RESPALDO_AUTOMATICO: formatRespaldoAutomaticoMessage({
          downloadUrl: 'https://radar-rsy.site/api/uploads/backups/backup_2026-09-20_434df2a7f1ccfe86.sql.gz',
        }),
        LISTA_RECLAMOS: formatListaReclamosMessage({
          dateFormatted: '12/09/2026',
          claims: [
            {
              index: 1,
              orderCode: 'ORD-869013',
              customerName: 'Javier Cedillos',
              customerPhone: '9802307137',
              vehicleYear: 2014,
              vehicleMake: 'CHEVROLET',
              vehicleModel: 'Silverado',
              mainPart: 'Transmission',
              productSpecs: 'AT, 4x4, 5.3L, w/o tow package',
              claimReason: 'La convertidora no le sirve y asi no puede venderla. La transmision da golpes y necesita cambiarla. La llevo con su mecanico y le informo que cambiar la convertidora es muy caro',
              daysElapsed: 9,
              callCount: 0,
            },
            {
              index: 2,
              orderCode: 'ORD-758892',
              customerName: "G' Black Tires",
              customerPhone: '9196260002',
              vehicleYear: 2015,
              vehicleMake: 'RAM',
              vehicleModel: '1500',
              mainPart: 'Engine',
              productSpecs: '3.6L, 4x2',
              claimReason: 'Falla de presión de aceite al encender el motor en frío',
              daysElapsed: 3,
              callCount: 1,
            },
          ],
        }),
        ORDEN_CANCELADA: formatOrdenCanceladaMessage({
          orderCode: 'ORD-690538',
          customerName: "Luca's Auto",
          vehicleYear: 2013,
          vehicleMake: 'NISSAN',
          vehicleModel: 'Rogue',
          mainPart: 'Transmission',
          productSpecs: 'AT, (CVT), 4x2 (FWD), w/o tow package',
          refundAmount: 950.0,
        }),
        SOLICITUD_REEMBOLSO: formatSolicitudReembolsoMessage({
          orderCode: 'ORD-10398',
          beneficiaryName: 'Taller Mecánico San Rafael',
          amount: 320.0,
          reason: 'Pieza no compatible con modelo del cliente',
        }),
        CAMBIO_ESTATUS: formatCambioEstatusMessage({
          orderCode: 'ORD-358924',
          vehicleYear: 2008,
          vehicleMake: 'FORD',
          vehicleModel: 'Explorer Sport Trac',
          mainPart: 'Transmission',
          customerName: 'Shadetree  Auto',
          customerPhone: '4345751490',
          newStatus: 'Listo para Retiro',
          advisorName: 'Favio Andrade',
        }),
        ALERTA_SEGURIDAD: formatAlertaSeguridadMessage({
          event: 'Múltiples intentos fallidos de 2FA (Prueba de Alerta)',
          username: 'admin@radarsy.com',
          ipAddress: '192.168.1.100',
          details: 'Mensaje de validación del canal de alertas críticas.',
        }),
      };

      const messageText = data.customMessage?.trim() || defaultSampleMessages[data.channelKey] || `Notificación de prueba: ${data.channelKey}`;

      const result = await dispatchSystemNotification(pool, wasender, data.channelKey, messageText, {
        creatorUserId: data.creatorUserId,
        creatorPhone: data.creatorPhone,
        orderStatus: data.orderStatus || 'Listo para Retiro',
      });

      return sendJson(response, 200, result);
    }

    if (!pathname.startsWith('/api/')) {
      const served = await serveFrontend(request, response);
      if (served) return;
    }

    return sendJson(response, 404, { message: 'Ruta no encontrada' });
  } catch (error) {
    const statusCode = error instanceof z.ZodError
      ? 400
      : typeof error === 'object' && error && 'statusCode' in error
      ? Number((error as { statusCode?: number }).statusCode)
      : 500;
    if (statusCode >= 500) console.error(error);
    return sendJson(response, statusCode >= 400 && statusCode < 500 ? statusCode : 500, {
      message: error instanceof z.ZodError
        ? `Payload inválido: ${error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        : statusCode >= 400 && statusCode < 500 && error instanceof Error
          ? error.message
        : 'No fue posible completar la solicitud',
    });
  }
});

const ensureDatabaseTables = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inventory_parts (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        year VARCHAR(50) NOT NULL,
        year_from VARCHAR(50) NULL,
        year_to VARCHAR(50) NULL,
        is_exact_year_only TINYINT(1) NOT NULL DEFAULT 0,
        brand VARCHAR(100) NOT NULL,
        model VARCHAR(100) NOT NULL,
        part_type VARCHAR(50) NOT NULL DEFAULT 'Motor',
        vin VARCHAR(50) NULL,
        pallet_number VARCHAR(50) NULL,
        tag_code VARCHAR(80) NULL,
        engine_specs VARCHAR(150) NULL,
        held_for VARCHAR(200) NULL,
        held_by VARCHAR(150) NULL,
        hold_until DATE NULL,
        tag_date VARCHAR(50) NULL,
        status VARCHAR(40) NOT NULL DEFAULT 'disponible',
        price DECIMAL(12,2) NOT NULL DEFAULT 0,
        cost DECIMAL(12,2) NOT NULL DEFAULT 0,
        location VARCHAR(150) NULL,
        photo_url TEXT NULL,
        notes TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        sold_at TIMESTAMP NULL DEFAULT NULL,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        INDEX inventory_parts_status (status),
        INDEX inventory_parts_brand_model (brand, model),
        INDEX inventory_parts_vin (vin),
        INDEX inventory_parts_pallet (pallet_number),
        INDEX inventory_parts_deleted (deleted_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Auto-migration for existing database instances: check if columns exist
    try {
      const [cols] = await pool.query<RowDataPacket[]>('SHOW COLUMNS FROM inventory_parts LIKE "year_from"');
      if (cols.length === 0) {
        await pool.query('ALTER TABLE inventory_parts ADD COLUMN year_from VARCHAR(50) NULL AFTER year');
        await pool.query('ALTER TABLE inventory_parts ADD COLUMN year_to VARCHAR(50) NULL AFTER year_from');
        await pool.query('ALTER TABLE inventory_parts ADD COLUMN is_exact_year_only TINYINT(1) NOT NULL DEFAULT 0 AFTER year_to');
      }
    } catch {
      // Table may have just been created with columns above
    }

    try {
      const [soldCols] = await pool.query<RowDataPacket[]>('SHOW COLUMNS FROM inventory_parts LIKE "sold_at"');
      if (soldCols.length === 0) {
        await pool.query('ALTER TABLE inventory_parts ADD COLUMN sold_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at');
      }
    } catch {
      // Table may have just been created with columns above
    }

    try {
      const [mileageCols] = await pool.query<RowDataPacket[]>('SHOW COLUMNS FROM orders LIKE "mileage"');
      if (mileageCols.length === 0) {
        await pool.query('ALTER TABLE orders ADD COLUMN mileage VARCHAR(60) NULL AFTER color');
      }
    } catch {
      // orders table check handled safely
    }

    try {
      const [phoneCols] = await pool.query<RowDataPacket[]>('SHOW COLUMNS FROM users LIKE "phone"');
      if (phoneCols.length === 0) {
        await pool.query('ALTER TABLE users ADD COLUMN phone VARCHAR(50) NULL AFTER email');
      }
    } catch {
      // users phone check handled safely
    }

    try {
      const [avatarCols] = await pool.query<RowDataPacket[]>('SHOW COLUMNS FROM users LIKE "avatar_url"');
      if (avatarCols.length === 0) {
        await pool.query('ALTER TABLE users ADD COLUMN avatar_url TEXT NULL AFTER phone');
      }
    } catch {
      // users avatar_url check handled safely
    }

    await ensureAuditTable(pool);
    await ensureNotificationTables(pool);
  } catch (error) {
    console.error('Error al verificar/inicializar tablas de base de datos:', error);
  }
};

server.listen(port, '0.0.0.0', () => {
  console.log(`RADAR API disponible en http://0.0.0.0:${port}`);
  void ensureDatabaseTables().then(() => {
    startDailyClaimsReportScheduler(pool, wasender);
  });
});