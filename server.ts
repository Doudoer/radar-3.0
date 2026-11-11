import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool, port, jwtSecret } from './src/server/config';
import { clientAddress, isSecureRequest, isUnsafeMethod, issueCsrfToken, rateLimit, requestOriginAllowed, securityHeaders, validCsrfToken } from './src/server/security';
import { beginIdempotentRequest, finishIdempotentRequest, cents, fail, recordPaymentChange, syncInventory, validateOrder } from './src/server/business';
import { handleFinanceRequest } from './src/server/finance';
import { handleAnalyticsRequest } from './src/server/analytics';
import { enforceWorkflowUpdate, handleWorkflowRequest, recordWorkflowReopening } from './src/server/orderWorkflow';
import { assertPaymentAccess, enforceCollectionUpdate, handlePaymentRequest } from './src/server/orderPayments';
import { handleAftersalesRequest, parseStoredJson } from './src/server/aftersales';
import { warrantyTermsSchema } from './src/utils/aftersales';
import { workflowRequired } from './src/utils/orderWorkflow';
import { inventoryForRole, mapInventoryPartRow } from './src/server/inventory';
import { matchOrderInventory } from './src/utils/inventoryMatching';
import { filterInventory, inventoryCsv } from './src/utils/inventoryExport';
import { financeVaultExpiry, lockFinanceVault, revokeFinanceVaults, unlockFinanceVault } from './src/server/financeVault';
import { businessDate, businessDaysBetween, isEligibleForDeliveryFollowup } from './src/server/businessTime';
import { startNotificationOutbox } from './src/server/outbox';
import { clearSessionCookie, isLoginRateLimited, recordLoginFailure, resetLoginAttempts, requireRole, roleIs, userIsActive, verifyToken, setSessionCookie, Claims } from './src/server/auth';
import QRCode from 'qrcode';
import {
  generateTotpSecret,
  getTotpUri,
  verifyTotpCode,
  generateBackupCodes,
  verifyAndConsumeBackupCode,
  BackupCodeItem,
} from './src/server/totp';
import { OrderDeliveryFollowup, PendingFollowupItem } from './src/types';
import {
  changePasswordSchema,
  claimCallCreateSchema,
  claimSchema,
  claimUpdateSchema,
  customerSchema,
  customerMergeSchema,
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
  revertToPaidOtpRequestSchema,
  revertToPaidSchema,
  cancelOrderOtpRequestSchema,
  cancelOrderSchema,
  orderDeliveryFollowupSchema,
} from './src/server/schemas';
import { readBody, sendJson, serveFrontend } from './src/server/http';
import { getOrders, mapOrder, normalizeTransmissionType, statusFromDatabase, statusToDatabase, toMysqlDateTime } from './src/server/orders';
import { getClaims } from './src/server/claims';
import { getClaimWarrantyError } from './src/utils/orderWarranty';
import {
  createDatabaseBackup,
  listBackups,
  saveBackupSnapshot,
  restoreDatabaseBackup,
  getBackupFileContent,
  ensureBackupFileOnDisk,
  startDailyBackupScheduler,
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
  queueSystemNotification,
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

// In-memory single-use OTP state for order reversion from listo_retiro to pagado (3 min expiration)
interface RevertToPaidOtpState {
  orderId: number;
  code: string;
  expiresAt: number;
  requestedAt: number;
  requestedByUserId: number;
  targetPhone: string;
  reason?: string;
}
const activeRevertToPaidOtps = new Map<number, RevertToPaidOtpState>();

// In-memory single-use OTP state for special order cancellation by administrator (3 min expiration)
interface CancelOrderOtpState {
  orderId: number;
  code: string;
  expiresAt: number;
  requestedAt: number;
  requestedByUserId: number;
  targetPhone: string;
  reason?: string;
  paymentMethod?: string;
}
const activeCancelOrderOtps = new Map<number, CancelOrderOtpState>();

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
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/gif') {
    return ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
  }
  if (mimeType === 'image/webp') {
    return buffer.length >= 12 && buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP';
  }
  if (mimeType === 'application/pdf') {
    return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
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
    language: (row.language || 'es') as 'es' | 'en',
    initials: name.split(' ').map((part: string) => part[0]).join('').slice(0, 2).toUpperCase(),
    notes: row.notes || '',
    createdAt: row.created_at,
    deleted_at: row.deleted_at,
    order_count: Number(row.order_count || 0),
  };
};

// ============================================================================
// REAL-TIME SERVER-SENT EVENTS (SSE) BROADCASTER
// ============================================================================
interface RealtimeSSEClient {
  id: string;
  userId?: number | string;
  response: ServerResponse;
  claims: Claims;
}
const realtimeClients = new Set<RealtimeSSEClient>();

export const broadcastRealtimeEvent = (eventType: string, data: Record<string, unknown> = {}) => {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of realtimeClients) {
    if (Number(client.claims.exp) * 1000 <= Date.now()) {
      client.response.end();
      realtimeClients.delete(client);
      continue;
    }
    try {
      client.response.write(payload);
    } catch {
      realtimeClients.delete(client);
    }
  }
};

// Periodic keep-alive ping for SSE connections (every 25 seconds)
setInterval(async () => {
  for (const client of realtimeClients) {
    try {
      if (Number(client.claims.exp) * 1000 <= Date.now() || !await userIsActive(client.claims)) {
        client.response.end();
        realtimeClients.delete(client);
        continue;
      }
      client.response.write(':keep-alive\n\n');
    } catch (error) {
      console.error('[SSE] No fue posible verificar la sesion:', error);
      client.response.end();
      realtimeClients.delete(client);
    }
  }
}, 25_000);

const server = createServer(async (request, response) => {
  request.setTimeout(30_000, () => {
    if (!response.headersSent) response.writeHead(408).end();
    request.destroy();
  });
  securityHeaders(request, response);
  let pathname: string;
  try {
    pathname = new URL(request.url || '/', 'http://localhost').pathname;
  } catch {
    return sendJson(response, 400, { message: 'Ruta invalida' });
  }
  response.once('finish', () => {
    if ([401, 403, 429].includes(response.statusCode) && pathname.startsWith('/api/')) {
      const ipAddress = clientAddress(request);
      if (rateLimit(`denied-alert:${ipAddress}`, 3, 60_000) === 0) {
        void recordAuditLog(pool, { action: 'SECURITY_ALERT_TRIGGERED', resourceType: 'http',
          details: { method: request.method, path: pathname.slice(0, 200), status: response.statusCode }, ipAddress });
      }
    }
  });

  try {
    if (process.env.NODE_ENV === 'production' && pathname !== '/health' && !isSecureRequest(request)) {
      return sendJson(response, 426, { message: 'HTTPS es obligatorio' });
    }
    const ipAddress = clientAddress(request);
    if (pathname.startsWith('/api/') || pathname.startsWith('/uploads/')) {
      const retryAfter = rateLimit(`requests:${ipAddress}`, 600, 60_000);
      if (retryAfter) {
        response.setHeader('Retry-After', retryAfter);
        if (rateLimit(`rate-alert:${ipAddress}`, 1, 60_000) === 0) {
          void recordAuditLog(pool, { action: 'SECURITY_ALERT_TRIGGERED', resourceType: 'http', details: { reason: 'REQUEST_RATE_LIMIT' }, ipAddress });
        }
        return sendJson(response, 429, { message: 'Demasiadas peticiones. Espera antes de volver a intentar.' });
      }
      if (!requestOriginAllowed(request)) {
        if (rateLimit(`origin-alert:${ipAddress}`, 1, 60_000) === 0) {
          void recordAuditLog(pool, { action: 'SECURITY_ALERT_TRIGGERED', resourceType: 'http', details: { reason: 'ORIGIN_REJECTED' }, ipAddress });
        }
        return sendJson(response, 403, { code: 'ORIGIN_REJECTED', message: 'Origen no autorizado' });
      }
      if (request.method === 'OPTIONS') return response.writeHead(204).end();
      if (isUnsafeMethod(request.method) && !validCsrfToken(request)) {
        if (rateLimit(`csrf-alert:${ipAddress}`, 1, 60_000) === 0) {
          void recordAuditLog(pool, { action: 'SECURITY_ALERT_TRIGGERED', resourceType: 'http', details: { reason: 'CSRF_REJECTED' }, ipAddress });
        }
        return sendJson(response, 403, { code: 'CSRF_INVALID', message: 'Verificacion de seguridad invalida. Recarga e intenta de nuevo.' });
      }
    }
    if (request.method === 'GET' && pathname === '/api/auth/csrf') {
      if (!jwtSecret) return sendJson(response, 503, { message: 'Autenticacion no configurada' });
      return sendJson(response, 200, { token: issueCsrfToken(request, response) });
    }
    if (request.method === 'GET' && pathname === '/health') {
      await pool.query('SELECT 1');
      return sendJson(response, 200, { ok: true, service: 'radar-3.0-api', database: 'connected' });
    }

    if (request.method === 'GET' && pathname === '/api/events') {
      const claims = verifyToken(request);

      if (!claims || !await userIsActive(claims)) {
        return sendJson(response, 401, { ok: false, message: 'No autenticado para eventos en tiempo real' });
      }
      if (realtimeClients.size >= 200 || [...realtimeClients].filter(client => String(client.userId) === String(claims.sub)).length >= 5) {
        return sendJson(response, 429, { message: 'Demasiadas conexiones de eventos abiertas' });
      }

      // Disable request/socket timeouts for long-lived streaming connection
      request.setTimeout(0);
      response.setTimeout(0);

      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const client: RealtimeSSEClient = {
        id: crypto.randomUUID(),
        userId: claims.sub,
        response,
        claims,
      };
      realtimeClients.add(client);

      response.write(`event: connected\ndata: ${JSON.stringify({ ok: true, clientId: client.id, time: Date.now() })}\n\n`);

      request.on('close', () => {
        realtimeClients.delete(client);
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/auth/login') {
      if (!jwtSecret) return sendJson(response, 503, { message: 'JWT_SECRET no está configurado' });
      const ip = clientAddress(request);
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
      const accountKey = `account:${email}`;
      if (isLoginRateLimited(accountKey)) return sendJson(response, 429, { message: 'Demasiados intentos. Intenta mas tarde.' });
      const password = credentials.password;
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id, name, email, phone, avatar_url, role, permissions, theme, active, password, session_version FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1',
        [email]
      );
      const user = rows[0];
      const validPassword = user ? await bcrypt.compare(password, String(user.password || '')) : false;
      if (!user || !validPassword || !user.active) {
        recordLoginFailure(ip);
        recordLoginFailure(accountKey);
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
      resetLoginAttempts(accountKey);
      const token = jwt.sign({ sub: user.id, role: user.role, email: user.email, sessionVersion: Number(user.session_version) }, jwtSecret, { expiresIn: '8h' });
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
      if (maybeClaims?.sub && await userIsActive(maybeClaims)) {
        await pool.execute('UPDATE users SET session_version=session_version+1 WHERE id=?', [maybeClaims.sub]);
        revokeFinanceVaults(maybeClaims.sub);
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
      lockFinanceVault(request, response);
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === 'GET' && pathname === '/api/auth/me') {
      const claims = verifyToken(request);
      if (!claims?.sub) return sendJson(response, 401, { message: 'Sesión no válida' });
      if (!await userIsActive(claims)) return sendJson(response, 401, { message: 'Sesión revocada' });
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

    const isImageUpload = ['GET', 'HEAD'].includes(request.method || '') &&
      pathname.startsWith('/uploads/') &&
      !pathname.startsWith('/uploads/backups/') &&
      ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(path.extname(pathname).toLowerCase());
    const isPublicApiPath = false;
    const protectedPath = (pathname.startsWith('/api/') || pathname.startsWith('/uploads/')) && !isImageUpload;
    const authenticatedClaims = (protectedPath || pathname.startsWith('/uploads/')) ? verifyToken(request) as Claims | null : null;
    if (protectedPath && !isPublicApiPath && !authenticatedClaims) {
      return sendJson(response, 401, { message: 'Autenticación requerida' });
    }

    if (authenticatedClaims?.sub && !isImageUpload) {
      if (!await userIsActive(authenticatedClaims)) return sendJson(response, 401, { message: 'Sesión no válida o revocada' });
    }
    if (['GET', 'HEAD'].includes(request.method || '') && pathname.startsWith('/uploads/backups/')) {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      response.writeHead(308, { Location: `/api${pathname}`, 'Cache-Control': 'no-store' });
      return response.end();
    }
    const isSystemBackupsList = request.method === 'GET' && pathname === '/api/system/backups';
    const sensitiveSystemPath = (pathname.startsWith('/api/system/') && !isSystemBackupsList) ||
      pathname.startsWith('/api/uploads/backups/') || pathname.startsWith('/uploads/backups/');
    const userManagementWrite = /^\/api\/users(?:\/\d+)?$/.test(pathname) && isUnsafeMethod(request.method);
    if (sensitiveSystemPath || userManagementWrite) {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      if (!financeVaultExpiry(request, authenticatedClaims)) {
        return sendJson(response, 403, { code: 'FINANCE_LOCKED', message: 'Desbloquea la boveda antes de acceder a respaldos, auditoria o administrar usuarios' });
      }
    }
    if (authenticatedClaims?.sub && isUnsafeMethod(request.method)) {
      const sensitive = pathname.startsWith('/api/auth/') || pathname.includes('/backup') || pathname === '/api/upload' || pathname.startsWith('/api/wasender/');
      const retryAfter = rateLimit(`writes:${sensitive ? 'sensitive' : 'general'}:${authenticatedClaims.sub}`, sensitive ? 30 : 120, 60_000);
      if (retryAfter) {
        response.setHeader('Retry-After', retryAfter);
        return sendJson(response, 429, { message: 'Demasiadas operaciones. Espera un minuto antes de continuar.' });
      }
    }
    if (await handleAnalyticsRequest(request, response, pathname, authenticatedClaims)) return;
    if (await handleFinanceRequest(request, response, pathname, authenticatedClaims)) return;
    if (authenticatedClaims && await handleWorkflowRequest(request, response, pathname, authenticatedClaims, pool, broadcastRealtimeEvent)) return;
    if (authenticatedClaims && await handlePaymentRequest(request, response, pathname, authenticatedClaims, pool, broadcastRealtimeEvent)) return;
    if (authenticatedClaims && await handleAftersalesRequest(request, response, pathname, authenticatedClaims, pool, broadcastRealtimeEvent)) return;
    if (['POST', 'PUT', 'DELETE'].includes(request.method || '') && /^\/api\/(?:claims|refunds)(?:\/(?:REC-|REF-)?\d+)?$/.test(pathname)) {
      return sendJson(response, 409, { message: 'Gestiona la incidencia desde Garantía, reclamos y devoluciones de la orden. Actualiza la aplicación para usar el flujo verificable.' });
    }
    if (pathname === '/api/auth/2fa/vault' && request.method === 'GET') {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const expiresAt = financeVaultExpiry(request, authenticatedClaims);
      return sendJson(response, 200, { unlocked: Boolean(expiresAt), expiresAt });
    }
    if (pathname === '/api/auth/2fa/lock' && request.method === 'POST') {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      lockFinanceVault(request, response);
      return sendJson(response, 200, { ok: true });
    }

    // ==========================================
    // 2FA OTP SECURITY GATE (RELACIÓN SEMANAL & FINANZAS)
    // ==========================================
    if (authenticatedClaims?.sub && request.method === 'POST' && pathname === '/api/auth/2fa/request-otp') {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const isProduction = process.env.NODE_ENV === 'production';
      if (isProduction && (!wasender.configured || wasender.isTestMode)) {
        return sendJson(response, 503, { message: 'WhatsApp no esta disponible como factor seguro en esta instalacion. Usa Authenticator o un codigo de respaldo existente.' });
      }
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
      const targetPhone = adminUser?.phone ? formatWasenderPhone(adminUser.phone) : '+580000000000';

      // 3. Store active 2FA state with strictly 1-minute (60s) expiration and single-use flag
      activeFinancial2FA = {
        code: otpCode,
        expiresAt: now + 60 * 1000, // 1 minute expiration
        used: false,
        requestedAt: now,
        requestedByUserId: Number(authenticatedClaims.sub),
        targetPhone,
      };

      let dispatched = false;
      let warning: string | undefined;
      if (wasender.configured && !wasender.isTestMode) {
        try {
          const textMessage = formatOtp2FAMessage({
            code: otpCode,
            userName: adminUser?.name || 'Super Admin',
            moduleName: 'Relación Semanal & Finanzas',
            expirationMinutes: 1,
          });
          await wasender.sendText({ to: targetPhone, text: textMessage });
          dispatched = true;
        } catch (err) {
          warning = err instanceof Error ? err.message : 'Error al despachar mensaje WhatsApp';
          console.error('[2FA OTP] Error enviando WhatsApp a Super Admin:', err);
        }
      } else if (!isProduction) {
        dispatched = true;
        console.log(`[2FA OTP LOCAL DEV] PIN generado para Super Admin: ${otpCode}`);
      }

      console.log('[2FA OTP] Solicitud de código procesada; no se registra el secreto');
      if (!dispatched) {
        activeFinancial2FA = null;
        return sendJson(response, 503, { message: 'No se pudo enviar el código por WhatsApp. La bóveda permanece bloqueada.' });
      }

      void recordAuditLog(pool, {
        userId: Number(authenticatedClaims.sub),
        username: authenticatedClaims.email,
        action: '2FA_REQUESTED',
        resourceType: '2fa',
        details: { targetPhoneMasked: `***${targetPhone.slice(-4)}` },
        ipAddress: request.socket.remoteAddress || 'unknown',
        userAgent: request.headers['user-agent'] || null,
      });

      return sendJson(response, 200, {
        ok: true,
        dispatched,
        message: isProduction
          ? 'Código de verificación enviado al administrador por WhatsApp'
          : `[Modo Local] PIN generado: ${otpCode}`,
        cooldownSeconds: 60,
        expiresInSeconds: 60,
        targetPhoneMasked: `***${targetPhone.slice(-4)}`,
        warning,
        ...(!isProduction ? { devCode: otpCode } : {}),
      });
    }

    // ==========================================
    // BACKUP 2FA: GOOGLE AUTHENTICATOR (RFC 6238 TOTP)
    // ==========================================
    if (authenticatedClaims?.sub && request.method === 'GET' && pathname === '/api/auth/2fa/totp-setup') {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;

      const [userRows] = await pool.query<RowDataPacket[]>(
        'SELECT id, name, email, totp_secret, backup_codes FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
        [authenticatedClaims.sub]
      );
      const user = userRows[0];
      if (!user) {
        return sendJson(response, 404, { ok: false, message: 'Usuario no encontrado' });
      }

      // If TOTP is already configured, require unlocked vault to re-view secret/QR
      if (user.totp_secret && !financeVaultExpiry(request, authenticatedClaims)) {
        return sendJson(response, 403, { message: 'Desbloquea la bóveda antes de consultar la configuración de autenticación' });
      }

      let secret = user.totp_secret;
      if (!secret) {
        secret = generateTotpSecret(20);
        await pool.execute('UPDATE users SET totp_secret = ? WHERE id = ?', [secret, user.id]);
      }

      let backupCodes: BackupCodeItem[] = [];
      try {
        if (user.backup_codes) {
          backupCodes = typeof user.backup_codes === 'string' ? JSON.parse(user.backup_codes) : user.backup_codes;
        }
      } catch {
        backupCodes = [];
      }

      if (!Array.isArray(backupCodes) || backupCodes.length === 0) {
        backupCodes = generateBackupCodes(8);
        await pool.execute('UPDATE users SET backup_codes = ? WHERE id = ?', [
          JSON.stringify(backupCodes),
          user.id,
        ]);
      }

      const accountName = user.email || user.name || 'Super Admin';
      const otpUri = getTotpUri(secret, accountName, 'Radar 3.0');
      const qrCodeDataUrl = await QRCode.toDataURL(otpUri, {
        margin: 2,
        width: 280,
        color: { dark: '#040814', light: '#ffffff' },
      });

      return sendJson(response, 200, {
        ok: true,
        secret,
        qrCodeDataUrl,
        otpUri,
        accountName,
        backupCodes,
      });
    }

    if (authenticatedClaims?.sub && request.method === 'POST' && pathname === '/api/auth/2fa/backup-codes-reset') {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      if (!financeVaultExpiry(request, authenticatedClaims)) return sendJson(response, 403, { message: 'Desbloquea la bóveda antes de regenerar códigos' });

      const newBackupCodes = generateBackupCodes(8);
      await pool.execute('UPDATE users SET backup_codes = ? WHERE id = ?', [
        JSON.stringify(newBackupCodes),
        authenticatedClaims.sub,
      ]);
      revokeFinanceVaults(authenticatedClaims.sub);
      lockFinanceVault(request, response);
      if (activeFinancial2FA?.requestedByUserId === Number(authenticatedClaims.sub)) activeFinancial2FA = null;
      void recordAuditLog(pool, { userId: Number(authenticatedClaims.sub), action: '2FA_FACTOR_CHANGED',
        resourceType: '2fa', details: { method: 'backup_codes' }, ipAddress: clientAddress(request) });

      return sendJson(response, 200, {
        ok: true,
        backupCodes: newBackupCodes,
        message: '8 nuevos códigos de seguridad de respaldo generados exitosamente.',
      });
    }

    if (authenticatedClaims?.sub && request.method === 'POST' && pathname === '/api/auth/2fa/totp-reset') {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      if (!financeVaultExpiry(request, authenticatedClaims)) return sendJson(response, 403, { message: 'Desbloquea la bóveda antes de cambiar Authenticator' });

      const newSecret = generateTotpSecret(20);
      await pool.execute('UPDATE users SET totp_secret = ? WHERE id = ?', [newSecret, authenticatedClaims.sub]);
      revokeFinanceVaults(authenticatedClaims.sub);
      lockFinanceVault(request, response);
      if (activeFinancial2FA?.requestedByUserId === Number(authenticatedClaims.sub)) activeFinancial2FA = null;
      void recordAuditLog(pool, { userId: Number(authenticatedClaims.sub), action: '2FA_FACTOR_CHANGED',
        resourceType: '2fa', details: { method: 'totp' }, ipAddress: clientAddress(request) });

      const [userRows] = await pool.query<RowDataPacket[]>(
        'SELECT name, email FROM users WHERE id = ? LIMIT 1',
        [authenticatedClaims.sub]
      );
      const user = userRows[0];
      const accountName = user?.email || user?.name || 'Super Admin';
      const otpUri = getTotpUri(newSecret, accountName, 'Radar 3.0');
      const qrCodeDataUrl = await QRCode.toDataURL(otpUri, {
        margin: 2,
        width: 280,
        color: { dark: '#040814', light: '#ffffff' },
      });

      return sendJson(response, 200, {
        ok: true,
        secret: newSecret,
        qrCodeDataUrl,
        otpUri,
        message: 'Nueva clave de Google Authenticator generada exitosamente.',
      });
    }

    if (authenticatedClaims?.sub && request.method === 'POST' && pathname === '/api/auth/2fa/verify-otp') {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const data = verifyOtpSchema.parse(await readBody(request));
      const cleanCode = data.code.trim();
      const now = Date.now();
      const ip = clientAddress(request);
      const userAgent = request.headers['user-agent'] || null;
      const userKey = String(authenticatedClaims.sub);
      if ((twoFactorFailures.get(userKey) || 0) >= 5) {
        return sendJson(response, 429, { message: 'Demasiados intentos. Espera antes de volver a verificar.' });
      }

      const handleFailed2FA = (reason: string) => {
        const failCount = (twoFactorFailures.get(userKey) || 0) + 1;
        twoFactorFailures.set(userKey, failCount);
        if (failCount === 1) setTimeout(() => twoFactorFailures.delete(userKey), 15 * 60 * 1000).unref();

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

      // 1. Check if code matches Google Authenticator (TOTP RFC 6238) backup
      const [userRows] = await pool.query<RowDataPacket[]>(
        'SELECT id, name, email, role, totp_secret, backup_codes FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
        [authenticatedClaims.sub]
      );
      const callerUser = userRows[0];
      let verifiedViaTotp = false;

      if (callerUser?.totp_secret && verifyTotpCode(callerUser.totp_secret, cleanCode, 1, now)) {
        verifiedViaTotp = true;
      }

      if (verifiedViaTotp) {
        twoFactorFailures.delete(userKey);
        if (activeFinancial2FA) {
          activeFinancial2FA.used = true;
        }

        void recordAuditLog(pool, {
          userId: Number(authenticatedClaims.sub),
          username: authenticatedClaims.email,
          action: '2FA_VERIFIED',
          resourceType: '2fa',
          details: { verified: true, method: 'google_authenticator_totp' },
          ipAddress: ip,
          userAgent,
        });

        // Renovar cookie de sesión fresca al verificar 2FA
        const refreshedToken = jwt.sign(
          { sub: authenticatedClaims.sub, role: authenticatedClaims.role, email: authenticatedClaims.email, sessionVersion: authenticatedClaims.sessionVersion },
          jwtSecret,
          { expiresIn: '8h' }
        );
        setSessionCookie(response, refreshedToken);
        const expiresAt = unlockFinanceVault(response, authenticatedClaims, refreshedToken);

        return sendJson(response, 200, {
          ok: true,
          verified: true,
          method: 'totp',
          expiresAt,
          message: 'Bóveda financiera 2FA desbloqueada exitosamente mediante Google Authenticator.',
        });
      }

      // 2. Check if code matches an Emergency Backup Security Code (One-time use)
      let verifiedViaBackup = false;

      const checkAndRedeemBackupCode = async (targetUser: RowDataPacket) => {
        if (!targetUser?.backup_codes) return false;
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          const [rows] = await connection.query<RowDataPacket[]>('SELECT backup_codes FROM users WHERE id=? FOR UPDATE', [targetUser.id]);
          const storedCodes = rows[0]?.backup_codes;
          const parsedCodes: BackupCodeItem[] = typeof storedCodes === 'string' ? JSON.parse(storedCodes) : storedCodes;
          const { valid, updatedCodes } = verifyAndConsumeBackupCode(parsedCodes, cleanCode);
          if (valid) {
            await connection.execute('UPDATE users SET backup_codes = ? WHERE id = ?', [
              JSON.stringify(updatedCodes),
              targetUser.id,
            ]);
            await connection.commit();
            return true;
          }
          await connection.rollback();
        } catch (err) {
          await connection.rollback();
          throw err;
        } finally { connection.release(); }
        return false;
      };

      if (callerUser && await checkAndRedeemBackupCode(callerUser)) {
        verifiedViaBackup = true;
      }

      if (verifiedViaBackup) {
        twoFactorFailures.delete(userKey);
        if (activeFinancial2FA) {
          activeFinancial2FA.used = true;
        }

        void recordAuditLog(pool, {
          userId: Number(authenticatedClaims.sub),
          username: authenticatedClaims.email,
          action: '2FA_VERIFIED',
          resourceType: '2fa',
          details: { verified: true, method: 'backup_security_code' },
          ipAddress: ip,
          userAgent,
        });

        // Renovar cookie de sesión fresca al verificar 2FA con código de respaldo
        const refreshedToken = jwt.sign(
          { sub: authenticatedClaims.sub, role: authenticatedClaims.role, email: authenticatedClaims.email, sessionVersion: authenticatedClaims.sessionVersion },
          jwtSecret,
          { expiresIn: '8h' }
        );
        setSessionCookie(response, refreshedToken);
        const expiresAt = unlockFinanceVault(response, authenticatedClaims, refreshedToken);

        return sendJson(response, 200, {
          ok: true,
          verified: true,
          method: 'backup_code',
          expiresAt,
          message: 'Bóveda financiera 2FA desbloqueada exitosamente mediante Código de Respaldo de Emergencia.',
        });
      }

      // 3. Check WhatsApp OTP code
      if (!activeFinancial2FA) {
        handleFailed2FA('No hay código activo o código incorrecto');
        return sendJson(response, 400, {
          ok: false,
          verified: false,
          message: 'Código incorrecto. Ingresa el PIN recibido por WhatsApp, el código de Google Authenticator o un código de respaldo.',
        });
      }

      if (activeFinancial2FA.used || activeFinancial2FA.requestedByUserId !== Number(authenticatedClaims.sub)) {
        handleFailed2FA('Código ya utilizado');
        return sendJson(response, 400, {
          ok: false,
          verified: false,
          message: 'Este código de verificación ya fue utilizado. Por favor solicita un nuevo código o usa Google Authenticator.',
        });
      }

      if (now > activeFinancial2FA.expiresAt) {
        handleFailed2FA('Código expirado');
        return sendJson(response, 400, {
          ok: false,
          verified: false,
          message: 'El código de verificación de WhatsApp ha expirado (1 minuto). Solicita uno nuevo o usa Google Authenticator.',
        });
      }

      if (activeFinancial2FA.code !== cleanCode) {
        handleFailed2FA('Código incorrecto');
        return sendJson(response, 400, {
          ok: false,
          verified: false,
          message: 'Código de verificación incorrecto. Revisa el mensaje de WhatsApp o el código de Google Authenticator.',
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
        details: { verified: true, method: 'whatsapp' },
        ipAddress: ip,
        userAgent,
      });

      // Renovar cookie de sesión fresca al verificar 2FA con WhatsApp
      const refreshedToken = jwt.sign(
        { sub: authenticatedClaims.sub, role: authenticatedClaims.role, email: authenticatedClaims.email, sessionVersion: authenticatedClaims.sessionVersion },
        jwtSecret,
        { expiresIn: '8h' }
      );
      setSessionCookie(response, refreshedToken);
      const expiresAt = unlockFinanceVault(response, authenticatedClaims, refreshedToken);

      return sendJson(response, 200, {
        ok: true,
        verified: true,
        method: 'whatsapp',
        expiresAt,
        message: 'Sesión financiera 2FA desbloqueada exitosamente.',
      });
    }

    if (authenticatedClaims?.sub && request.method === 'PUT' && pathname === '/api/auth/profile') {

      const payload = userProfileUpdateSchema.parse(await readBody(request));
      const currentUserId = authenticatedClaims.sub;
      const [currentRows] = await pool.query<RowDataPacket[]>(
        'SELECT email,phone,password FROM users WHERE id=? AND deleted_at IS NULL LIMIT 1', [currentUserId],
      );
      if (!currentRows[0]) return sendJson(response, 404, { message: 'Usuario no encontrado' });
      const phoneChanged = (payload.phone?.trim() || '') !== (currentRows[0].phone || '');
      const emailChanged = payload.email.toLowerCase() !== currentRows[0].email.toLowerCase();
      const factorChanged = authenticatedClaims.role === 'admin' && phoneChanged;
      if (factorChanged && !financeVaultExpiry(request, authenticatedClaims)) {
        return sendJson(response, 403, { code: 'FINANCE_LOCKED', message: 'Desbloquea la boveda con tu factor actual antes de cambiar el telefono de seguridad' });
      }
      if (payload.newPassword || emailChanged || factorChanged) {
        if (!payload.currentPassword || !await bcrypt.compare(payload.currentPassword, String(currentRows[0].password))) {
          return sendJson(response, 400, { message: 'Confirma tu contraseña actual para cambiar correo, contraseña o telefono de seguridad' });
        }
      }

      const [existing] = await pool.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE email = ? AND id != ? AND deleted_at IS NULL LIMIT 1',
        [payload.email.toLowerCase(), currentUserId]
      );
      if (existing.length > 0) {
        return sendJson(response, 409, { message: 'El correo electrónico ya está en uso por otro usuario' });
      }

      let passwordClause = '';
      const params: (string | number | null)[] = [
        payload.name,
        payload.email.toLowerCase(),
        payload.phone ? payload.phone.trim() : null,
        payload.avatar_url ? payload.avatar_url.trim() : null,
      ];

      if (payload.newPassword) {
        const newHash = await bcrypt.hash(payload.newPassword, 12);
        passwordClause = ', password = ?, password_changed_at=CURRENT_TIMESTAMP';
        params.push(newHash);
      }
      const revokeSessions = Boolean(payload.newPassword || emailChanged || factorChanged);
      if (revokeSessions) passwordClause += ', session_version=session_version+1';

      params.push(currentUserId);

      await pool.execute(
        `UPDATE users SET name = ?, email = ?, phone = ?, avatar_url = ? ${passwordClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL`,
        params
      );
      if (revokeSessions) {
        revokeFinanceVaults(currentUserId);
        lockFinanceVault(request, response);
        if (activeFinancial2FA?.requestedByUserId === Number(currentUserId)) activeFinancial2FA = null;
        const token = jwt.sign({
          sub: currentUserId, role: authenticatedClaims.role, email: payload.email.toLowerCase(),
          sessionVersion: Number(authenticatedClaims.sessionVersion) + 1,
        }, jwtSecret, { expiresIn: '8h' });
        setSessionCookie(response, token);
      }

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
        details: { name: payload.name, email: payload.email, passwordChanged: Boolean(payload.newPassword), factorChanged },
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

      const newHash = await bcrypt.hash(payload.newPassword, 12);
      await pool.execute('UPDATE users SET password = ?, password_changed_at = CURRENT_TIMESTAMP, session_version=session_version+1 WHERE id = ?', [newHash, authenticatedClaims.sub]);
      revokeFinanceVaults(authenticatedClaims.sub);
      lockFinanceVault(request, response);
      if (activeFinancial2FA?.requestedByUserId === Number(authenticatedClaims.sub)) activeFinancial2FA = null;

      const refreshedToken = jwt.sign(
        { sub: authenticatedClaims.sub, role: authenticatedClaims.role, email: authenticatedClaims.email, sessionVersion: Number(authenticatedClaims.sessionVersion || 1) + 1 },
        jwtSecret,
        { expiresIn: '8h' }
      );
      setSessionCookie(response, refreshedToken);

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
      try {
        const backups = await listBackups();
        return sendJson(response, 200, backups);
      } catch (err) {
        console.error('[GET /api/system/backups] Failed to list backups:', err);
        return sendJson(response, 200, []);
      }
    }

    if (request.method === 'POST' && pathname === '/api/system/backup/create') {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const payload = backupSnapshotCreateSchema.parse(await readBody(request));
      const result = await saveBackupSnapshot({ tag: payload.tag || 'manual' });

      const appBaseUrl = (process.env.APP_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, '');

      const backupDownloadUrl = `${appBaseUrl}/api/uploads/backups/${result.filename}`;
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
      return sendJson(response, 409, {
        code: 'RESTORE_DISABLED',
        message: 'Restauración directa deshabilitada. Valida el respaldo en una base aislada antes de planificar el reemplazo con mantenimiento y recuperación',
      });
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
      const filters = z.object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        action: z.string().max(100).optional(),
        userId: z.coerce.number().int().positive().optional(),
        startDate: z.iso.date().optional(),
        endDate: z.iso.date().optional(),
      }).parse(Object.fromEntries(url.searchParams));
      const result = await getAuditLogs(pool, filters);

      return sendJson(response, 200, result);
    }

    // ==========================================
    // ORDERS
    // ==========================================
    if (request.method === 'GET' && pathname === '/api/orders') {
      const url = new URL(request.url || '/', 'http://localhost');
      const offset = z.coerce.number().int().min(0).parse(url.searchParams.get('offset') || 0);
      const limit = z.coerce.number().int().min(1).max(1000).parse(url.searchParams.get('limit') || 500);
      const orders = await getOrders({ limit, offset });
      response.setHeader('X-Next-Offset', orders.length === limit ? String(offset + limit) : '');
      return sendJson(response, 200, orders);
    }
    const detailOrderId = pathname.match(/^\/api\/orders\/(\d+)$/)?.[1];
    if (request.method === 'GET' && detailOrderId) {
      const orders = await getOrders({ id: Number(detailOrderId), limit: 1 });
      return orders[0] ? sendJson(response, 200, orders[0]) : sendJson(response, 404, { message: 'Orden no encontrada' });
    }

    if (request.method === 'POST' && pathname === '/api/orders') {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator', 'vendedor_yarda')) return;
      const order = orderPayloadSchema.parse(await readBody(request));
      const requestFingerprint = structuredClone(order);
      validateOrder(order, undefined, String(authenticatedClaims?.role));
      if (workflowRequired(new Date().toISOString())) {
        if (order.status === 'entregado') fail(409, 'Registra la entrega física con evidencia desde el flujo después de crear la orden.');
        order.workflowStep = 1;
      }
      if (!order.idempotencyKey) fail(400, 'La clave de idempotencia es obligatoria');
      if (!order.customer || !order.vehicle || !order.financials || !order.mainPart) {
        return sendJson(response, 400, { message: 'Cliente, vehículo, pieza y datos financieros son obligatorios' });
      }
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const replayId = await beginIdempotentRequest(connection, 'order', order.idempotencyKey!, Number(authenticatedClaims?.sub), requestFingerprint);
        if (replayId) {
          await connection.rollback();
          return sendJson(response, 200, (await getOrders({ id: replayId, limit: 1 }))[0]);
        }
        const [repeated] = await connection.query<RowDataPacket[]>('SELECT id FROM orders WHERE idempotency_key=?', [order.idempotencyKey]);
        if (repeated[0]) {
          await connection.rollback();
          return sendJson(response, 200, (await getOrders({ id: Number(repeated[0].id), limit: 1 }))[0]);
        }

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

        const resolvedCustomerLanguage = ((order as any).customerLanguage || (order.customer as any)?.language || 'es') as 'es' | 'en';

        if (customerId) {
          // Existing customer records are edited only through the CRM.
        }

        if (!customerId) {
          const customerNameParts = String(order.customer.name || '').trim().split(/\s+/);
          const [customerResult] = await connection.execute<ResultSetHeader>(
            'INSERT INTO customers (first_name, last_name, phone, whatsapp, email, address_shipping, zip_code, language, company, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              customerNameParts[0] || 'Cliente',
              customerNameParts.slice(1).join(' ') || null,
              order.customer.phone || null,
              order.customer.phone || null,
              order.customer.email || null,
              order.customer.shippingAddress || null,
              order.customer.zip_code || null,
              resolvedCustomerLanguage,
              order.customer.company || null,
              order.customer.type || 'Particular',
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
        if (!assignedUserId && order.advisor && order.advisor !== 'Sin asignar') {
          const [userRows] = await connection.query<RowDataPacket[]>('SELECT id FROM users WHERE name = ? AND deleted_at IS NULL LIMIT 1', [order.advisor]);
          if (userRows.length > 0) assignedUserId = userRows[0].id;
        }
        if (!assignedUserId && authenticatedClaims?.sub) {
          const authSubNum = Number(authenticatedClaims.sub);
          if (Number.isInteger(authSubNum) && authSubNum > 0) {
            const [userRows] = await connection.query<RowDataPacket[]>('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1', [authSubNum]);
            if (userRows.length > 0) assignedUserId = userRows[0].id;
          }
        }
        if (!assignedUserId) {
          const [firstUser] = await connection.query<RowDataPacket[]>('SELECT id FROM users WHERE deleted_at IS NULL ORDER BY id ASC LIMIT 1');
          if (firstUser.length > 0) assignedUserId = firstUser[0].id;
        }

        let isYardSale = Boolean((order as any).isYardSale);
        if (assignedUserId) {
          const [assignedUserRows] = await connection.query<RowDataPacket[]>('SELECT role FROM users WHERE id = ? LIMIT 1', [assignedUserId]);
          if (assignedUserRows[0]?.role === 'vendedor_yarda') {
            isYardSale = true;
          }
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
        const isAuctionActive = Boolean((order as any).auctionActive || ((order as any).auctionLinks && (order as any).auctionLinks.length > 0));

        // 5. Insert Order
        const [orderResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO orders (order_code, vin_nr, brand, model, sub_model, year, color, mileage, product_type, transmission_type, product_specs, stock_nr, customer_id, user_id, is_yard_sale, auction_search_active, price, core_fee, down_payment, shipping_toggle, shipping_address, shipping_cost, warranty_days, status, workflow_step, description, customer_language)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            isYardSale ? 1 : 0,
            isAuctionActive ? 1 : 0,
            order.financials.partPrice || 0,
            order.financials.coreFee || 0,
            order.financials.downPayment || 0,
            order.deliveryType === 'envio_domicilio',
            order.customer.shippingAddress || null,
            order.financials.deliveryFee || 0,
            order.warrantyDays ?? 60,
            statusToDatabase[order.status || 'cotizacion'] || order.status || 'Cotización',
            order.workflowStep || 1,
            order.notes || null,
            resolvedCustomerLanguage,
          ]
        );
        await connection.execute(
          `UPDATE orders SET idempotency_key=?,inventory_part_id=?,shipping_zip_code=?,contact_name=?,contact_phone=?,contact_email=?,delivered_at=?,warranty_started=? WHERE id=?`,
          [order.idempotencyKey, order.inventoryPartId ?? null, order.customer.zip_code || null, order.customer.name,
            order.customer.phone || null, order.customer.email || null, toMysqlDateTime(order.deliveredAt), Boolean(order.warrantyStarted), orderResult.insertId],
        );
        await syncInventory(connection, orderResult.insertId, order.inventoryPartId, order.status || 'cotizacion');
        await recordPaymentChange(connection, orderResult.insertId, Number(order.financials.downPayment || 0), 0, Number(authenticatedClaims?.sub));

        if (Array.isArray((order as any).auctionLinks)) {
          for (const link of (order as any).auctionLinks) {
            if (link.url) {
              const auctionType = link.auctionHouse === 'IAAI' ? 'IAA' : 'Copart';
              const auctionDate = link.auctionDate ? new Date(link.auctionDate) : new Date();
              const formattedDate = !isNaN(auctionDate.getTime()) ? auctionDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
              await connection.execute(
                'INSERT INTO order_auction_links (order_id, url, auction_type, auction_date, status) VALUES (?, ?, ?, ?, ?)',
                [orderResult.insertId, link.url, auctionType, formattedDate, 'active']
              );
            }
          }
        }

        const statusUserId = Number(authenticatedClaims?.sub);
        await connection.execute(
          'INSERT INTO status_orders (order_id, status, description, user_id) VALUES (?, ?, ?, ?)',
          [orderResult.insertId, statusToDatabase[order.status || 'cotizacion'] || order.status || 'Cotización', 'Orden creada desde RADAR 3.0', statusUserId]
        );
        await finishIdempotentRequest(connection, 'order', order.idempotencyKey!, orderResult.insertId);
        await connection.execute(
          "INSERT INTO audit_logs (user_id,action,resource_type,resource_id,details) VALUES (?,'ORDER_CREATED','order',?,?)",
          [authenticatedClaims?.sub, String(orderResult.insertId), JSON.stringify(order)],
        );
        const [rows] = await connection.query<RowDataPacket[]>(
          'SELECT o.*, c.first_name, c.last_name, c.company, c.type, c.phone, c.email, c.address_shipping, c.zip_code, c.language AS customer_crm_language, u.name AS advisor, u.role AS advisor_role, u.phone AS advisor_phone FROM orders o LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = o.user_id WHERE o.id = ?',
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
            notes: order.notes || (createdOrderRow as any)?.description || null,
            totalPrice: order.financials.partPrice || 0,
            downPayment: order.financials.downPayment || 0,
            deliveryType: order.deliveryType,
            shippingAddress: order.customer.shippingAddress,
          });

          await queueSystemNotification(connection, 'NUEVA_VENTA', newSaleMsg, {
            creatorUserId: assignedUserId ? Number(assignedUserId) : undefined,
            creatorPhone: createdOrderRow?.advisor_phone || undefined,
            creatorName: advisorNameStr,
            orderStatus: initialStatusStr,
          });
        }

        await connection.commit();
        broadcastRealtimeEvent('order:updated', { orderId: orderResult.insertId, action: 'CREATED', timestamp: Date.now() });
        return sendJson(response, 201, (await getOrders({ id: orderResult.insertId, limit: 1 }))[0]);
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }

    // ==========================================
    // Retired OTP flow: corrections use admin authorization, version and reason.
    // ==========================================
    const deliveryDateOtpMatch = pathname.match(/^\/api\/orders\/(\d+)\/delivery-date\/request-otp$/);
    if (request.method === 'POST' && deliveryDateOtpMatch) {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      return sendJson(response, 410, { code: 'DELIVERY_OTP_RETIRED', message: 'El flujo OTP ya no esta disponible. Usa la correccion administrativa con version y motivo.' });
    }

    // ==========================================
    // DELIVERY FOLLOWUPS (GARANTÍA TEMPRANA 14 DÍAS)
    // ==========================================
    if (request.method === 'GET' && pathname === '/api/orders/followups/pending') {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator', 'vendedor_yarda')) return;
      const url = new URL(request.url || '/', 'http://localhost');
      const advisorFilter = url.searchParams.get('advisor');
      const allFilter = url.searchParams.get('all') === 'true';

      // Fetch delivered orders within last 35 days (14 days warranty + extended window for postponed installs)
      const [orderRows] = await pool.query<RowDataPacket[]>(`
        SELECT 
          o.id, 
          o.order_code, 
          o.brand, 
          o.model, 
          o.year, 
          o.product_type, 
          o.status, 
          o.delivered_at, 
          o.updated_at, 
          o.created_at,
          o.customer_language,
          c.first_name, 
          c.last_name, 
          c.phone AS customer_phone,
          c.language AS customer_crm_language,
          u.name AS advisor
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = o.user_id
        WHERE o.deleted_at IS NULL
          AND (o.status = 'Entregado' OR o.status = 'entregado')
          AND o.created_at < '2026-10-21 04:00:00'
          AND o.delivered_at > '2026-11-07 20:05:52'
          AND (? = 'admin' OR o.user_id = ?)
        ORDER BY o.delivered_at DESC, o.id DESC
      `, [authenticatedClaims?.role, Number(authenticatedClaims?.sub)]);

      if (orderRows.length === 0) {
        return sendJson(response, 200, {
          ok: true,
          pending: [],
          totalCount: 0,
          overdueCount: 0,
          todayCount: 0,
          upcomingCount: 0,
        });
      }

      const orderIds = orderRows.map((r) => r.id);
      const [followupRows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM order_delivery_followups WHERE order_id IN (?) ORDER BY created_at ASC`,
        [orderIds]
      );

      const followupsByOrder = new Map<number, any[]>();
      for (const row of followupRows) {
        const list = followupsByOrder.get(row.order_id) || [];
        list.push(row);
        followupsByOrder.set(row.order_id, list);
      }

      const now = new Date();
      const todayStr = businessDate(now);
      const pendingItems: PendingFollowupItem[] = [];

      for (const order of orderRows) {
        const orderFollowups = followupsByOrder.get(order.id) || [];
        const totalCalls = orderFollowups.length;
        const rawLastFollowup = totalCalls > 0 ? orderFollowups[totalCalls - 1] : null;

        const lastFollowup: OrderDeliveryFollowup | null = rawLastFollowup
          ? {
              id: `FOL-${rawLastFollowup.id}`,
              orderId: String(rawLastFollowup.order_id),
              operatorName: rawLastFollowup.operator_name,
              contactChannel: rawLastFollowup.contact_channel || 'call',
              callResult: rawLastFollowup.call_result,
              partStatus: rawLastFollowup.part_status,
              warrantyWarningGiven: Boolean(rawLastFollowup.warranty_warning_given),
              promisedInstallDate: rawLastFollowup.promised_install_date
                ? new Date(rawLastFollowup.promised_install_date).toISOString().slice(0, 10)
                : null,
              notes: rawLastFollowup.notes,
              createdAt: new Date(rawLastFollowup.created_at).toISOString(),
            }
          : null;

        const deliveryDateVal = order.delivered_at;
        if (!isEligibleForDeliveryFollowup(deliveryDateVal)) continue;
        const daysSinceDelivery = deliveryDateVal ? Math.max(0, businessDaysBetween(deliveryDateVal, now)) : 0;

        // If part is confirmed installed and tested OK, follow-up cycle is complete!
        if (lastFollowup && lastFollowup.partStatus === 'installed_ok') {
          continue;
        }

        const lastFollowupDateStr = rawLastFollowup
          ? businessDate(rawLastFollowup.created_at)
          : null;
        const calledToday = lastFollowupDateStr === todayStr;
        const answeredToday = calledToday && ['answered','sms_replied'].includes(rawLastFollowup?.call_result);

        let currentMilestone: 'dia_3' | 'dia_7' | 'dia_14' | 'seguimiento_extra' = 'dia_3';
        let milestoneLabel = 'Hito 1: Recepción & Taller (Día 1-3)';
        let urgency: 'atrasada' | 'hoy' | 'proxima' = 'proxima';

        // Evaluate promised installation date if customer postponed
        if (!deliveryDateVal) {
          milestoneLabel = 'Fecha de entrega sin registrar: requiere revisión';
          urgency = 'atrasada';
        } else if (lastFollowup && lastFollowup.promisedInstallDate) {
          const promisedDate = lastFollowup.promisedInstallDate;
          if (promisedDate < todayStr) {
            currentMilestone = 'seguimiento_extra';
            milestoneLabel = `Fecha prometida vencida (${promisedDate})`;
            urgency = answeredToday ? 'proxima' : 'atrasada';
          } else if (promisedDate === todayStr) {
            currentMilestone = 'seguimiento_extra';
            milestoneLabel = `Instalación prometida (HOY: ${promisedDate})`;
            urgency = answeredToday ? 'proxima' : 'hoy';
          } else {
            currentMilestone = 'seguimiento_extra';
            milestoneLabel = `Instalación agendada para: ${promisedDate}`;
            urgency = 'proxima';
          }
        } else if (daysSinceDelivery <= 3) {
          currentMilestone = 'dia_3';
          milestoneLabel = 'Hito 1: Recepción & Llegada al Taller';
          if (totalCalls === 0) {
            if (daysSinceDelivery >= 3) urgency = 'atrasada';
            else if (daysSinceDelivery >= 2) urgency = 'hoy';
            else urgency = 'proxima';
          } else {
            urgency = 'proxima';
          }
        } else if (daysSinceDelivery <= 7) {
          currentMilestone = 'dia_7';
          milestoneLabel = 'Hito 2: Montaje & Encendido';
          if (totalCalls < 1) {
            urgency = answeredToday ? 'proxima' : 'atrasada';
          } else if (totalCalls === 1) {
            urgency = answeredToday ? 'proxima' : (daysSinceDelivery >= 6 ? 'hoy' : 'proxima');
          } else {
            urgency = 'proxima';
          }
        } else if (daysSinceDelivery <= 14) {
          currentMilestone = 'dia_14';
          milestoneLabel = 'Hito 3: Conformidad & Cierre 14 Días';
          if (totalCalls < 2) {
            urgency = answeredToday ? 'proxima' : 'atrasada';
          } else {
            urgency = answeredToday ? 'proxima' : (daysSinceDelivery >= 12 ? 'hoy' : 'proxima');
          }
        } else {
          currentMilestone = 'seguimiento_extra';
          milestoneLabel = `Seguimiento Extendido (>14 Días: Día ${daysSinceDelivery})`;
          urgency = answeredToday ? 'proxima' : 'atrasada';
        }

        const advisorName = order.advisor || 'Sin asignar';
        const clientFullName = [order.first_name, order.last_name].filter(Boolean).join(' ') || 'Cliente';
        const vehicleStr = [order.year, order.brand, order.model].filter(Boolean).join(' ') || 'Vehículo no especificado';

        pendingItems.push({
          orderId: String(order.id),
          orderCode: order.order_code || `ORD-${order.id}`,
          advisor: advisorName,
          customerName: clientFullName,
          customerPhone: order.customer_phone || '',
          customerLanguage: (order.customer_language || order.customer_crm_language || 'es') as 'es' | 'en',
          vehicle: vehicleStr,
          mainPart: order.product_type || 'Pieza',
          deliveredAt: deliveryDateVal ? new Date(deliveryDateVal).toISOString() : '',
          daysSinceDelivery,
          currentMilestone,
          milestoneLabel,
          urgency,
          lastFollowup,
          totalCalls,
        });
      }

      // Sort pending items: 'atrasada' first, then 'hoy', then 'proxima', descending by daysSinceDelivery
      const urgencyRank: Record<string, number> = { atrasada: 1, hoy: 2, proxima: 3 };
      pendingItems.sort((a, b) => {
        const rankDiff = (urgencyRank[a.urgency] || 9) - (urgencyRank[b.urgency] || 9);
        if (rankDiff !== 0) return rankDiff;
        return b.daysSinceDelivery - a.daysSinceDelivery;
      });

      let filteredItems = pendingItems;
      if (advisorFilter && !allFilter) {
        filteredItems = pendingItems.filter(
          (item) => item.advisor.trim().toLowerCase() === advisorFilter.trim().toLowerCase()
        );
      }

      const overdueCount = filteredItems.filter((i) => i.urgency === 'atrasada').length;
      const todayCount = filteredItems.filter((i) => i.urgency === 'hoy').length;
      const upcomingCount = filteredItems.filter((i) => i.urgency === 'proxima').length;

      return sendJson(response, 200, {
        ok: true,
        pending: filteredItems,
        totalCount: filteredItems.length,
        overdueCount,
        todayCount,
        upcomingCount,
      });
    }

    const orderFollowupsMatch = pathname.match(/^\/api\/orders\/(\d+)\/followups$/);
    if (orderFollowupsMatch) {
      const targetOrderId = Number(orderFollowupsMatch[1]);

      if (request.method === 'GET') {
        if (!requireRole(response, authenticatedClaims, 'admin', 'operator', 'vendedor_yarda')) return;
        const [rows] = await pool.query<RowDataPacket[]>(
          'SELECT * FROM order_delivery_followups WHERE order_id = ? ORDER BY created_at DESC',
          [targetOrderId]
        );
        const followups: OrderDeliveryFollowup[] = rows.map((r) => ({
          id: `FOL-${r.id}`,
          orderId: String(r.order_id),
          operatorName: r.operator_name,
          contactChannel: r.contact_channel || 'call',
          callResult: r.call_result,
          partStatus: r.part_status,
          warrantyWarningGiven: Boolean(r.warranty_warning_given),
          promisedInstallDate: r.promised_install_date ? new Date(r.promised_install_date).toISOString().slice(0, 10) : null,
          notes: r.notes,
          createdAt: new Date(r.created_at).toISOString(),
        }));
        return sendJson(response, 200, { ok: true, followups });
      }

      if (request.method === 'POST') {
        if (!requireRole(response, authenticatedClaims, 'admin', 'operator', 'vendedor_yarda')) return;
        const data = orderDeliveryFollowupSchema.parse(await readBody(request));

        const [orderRows] = await pool.query<RowDataPacket[]>(
          `SELECT o.id, o.order_code, o.status, o.created_at, c.first_name, c.last_name, c.phone, u.name AS advisor
           FROM orders o
           LEFT JOIN customers c ON c.id = o.customer_id
           LEFT JOIN users u ON u.id = o.user_id
           WHERE o.id = ? AND o.deleted_at IS NULL LIMIT 1`,
          [targetOrderId]
        );
        if (!orderRows[0]) {
          return sendJson(response, 404, { ok: false, message: 'Orden no encontrada' });
        }
        const orderRow = orderRows[0];
        if (workflowRequired(new Date(orderRow.created_at).toISOString())) {
          return sendJson(response, 409, { message: 'Registra esta gestión desde el flujo verificable de la orden o Mi trabajo de hoy.' });
        }

        // Operator name defaults to provided name, or authenticated user's name, or order advisor
        let opName = data.operatorName || '';
        if (!opName && authenticatedClaims?.sub) {
          const [uRows] = await pool.query<RowDataPacket[]>('SELECT name FROM users WHERE id = ?', [authenticatedClaims.sub]);
          if (uRows[0]?.name) opName = uRows[0].name;
        }
        if (!opName) opName = orderRow.advisor || 'Operador';

        const connection = await pool.getConnection();
        try {
        await connection.beginTransaction();
        const channel = data.contactChannel || 'call';
        const [insertResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO order_delivery_followups 
            (order_id, operator_name, contact_channel, call_result, part_status, warranty_warning_given, promised_install_date, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            targetOrderId,
            opName,
            channel,
            data.callResult,
            data.partStatus,
            data.warrantyWarningGiven ? 1 : 0,
            data.promisedInstallDate || null,
            data.notes,
          ]
        );

        // Also record in call_register for system-wide call reporting and history
        const clientFullName = [orderRow.first_name, orderRow.last_name].filter(Boolean).join(' ') || 'Cliente';
        const clientPhone = orderRow.phone || '';
        const channelLabel = channel === 'whatsapp' ? 'WHATSAPP' : channel === 'sms' ? 'SMS' : 'LLAMADA';
        const callSummary = `[SEGUIMIENTO 14 DÍAS - ${channelLabel} - ${data.callResult.toUpperCase()}] Estatus Pieza: ${data.partStatus}. ${data.warrantyWarningGiven ? '⚠️ Advertencia de garantía dada. ' : ''}${data.promisedInstallDate ? `Fecha prometida: ${data.promisedInstallDate}. ` : ''}Notas: ${data.notes}`;

          await connection.execute(
            `INSERT INTO call_register (order_id, caller_name, caller_phone, attended_by, conversation_summary, whatsapp_dispatched, whatsapp_message)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              targetOrderId,
              clientFullName,
              clientPhone,
              opName,
              callSummary,
              channel === 'whatsapp' ? 1 : 0,
              channel === 'whatsapp' ? data.notes : null,
            ]
          );
        await connection.execute(
          "INSERT INTO audit_logs (user_id,action,resource_type,resource_id,details) VALUES (?,'ORDER_FOLLOWUP_REGISTERED','order',?,?)",
          [authenticatedClaims?.sub, String(targetOrderId), JSON.stringify(data)],
        );
        await connection.commit();

        const createdFollowup: OrderDeliveryFollowup = {
          id: `FOL-${insertResult.insertId}`,
          orderId: String(targetOrderId),
          operatorName: opName,
          contactChannel: channel,
          callResult: data.callResult,
          partStatus: data.partStatus,
          warrantyWarningGiven: data.warrantyWarningGiven,
          promisedInstallDate: data.promisedInstallDate || null,
          notes: data.notes,
          createdAt: new Date().toISOString(),
        };

        broadcastRealtimeEvent('followup:updated', {
          orderId: targetOrderId,
          operatorName: opName,
          followup: createdFollowup,
          timestamp: Date.now(),
        });

        return sendJson(response, 201, {
          ok: true,
          followup: createdFollowup,
          message: 'Llamada de seguimiento registrada con éxito',
        });
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally { connection.release(); }
      }
    }

    const deliveryDateUpdateMatch = pathname.match(/^\/api\/orders\/(\d+)\/delivery-date$/);
    if (request.method === 'PUT' && deliveryDateUpdateMatch) {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const targetOrderId = Number(deliveryDateUpdateMatch[1]);
      const data = updateDeliveryDateSchema.parse(await readBody(request));
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [orderRows] = await connection.query<RowDataPacket[]>(
          'SELECT id, order_code, status, delivered_at, version, warranty_terms, core_returned_at FROM orders WHERE id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
          [targetOrderId]
        );
        if (!orderRows[0]) {
          fail(404, 'Orden no encontrada');
        }
        const orderRow = orderRows[0];
        const isDelivered = orderRow.status === 'Entregado' || orderRow.status === 'entregado';
        if (!isDelivered) {
          fail(400, 'La modificación de fecha de entrega solo está permitida para órdenes con estatus Entregado');
        }

        const previousDeliveredAt = orderRow.delivered_at;
        const newDeliveredMysql = toMysqlDateTime(data.deliveredAt);
        const [deliveryUpdate] = await connection.execute<ResultSetHeader>(
          'UPDATE orders SET version=version+1, delivered_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version=? AND deleted_at IS NULL',
          [newDeliveredMysql, targetOrderId, data.version]
        );
        if (!deliveryUpdate.affectedRows) fail(409, 'La orden cambió; recarga antes de guardar');
        if (orderRow.warranty_terms) {
          const terms = warrantyTermsSchema.parse(parseStoredJson(orderRow.warranty_terms));
          if (previousDeliveredAt && Date.parse(terms.startedAt) === new Date(previousDeliveredAt).getTime()) {
            await connection.execute('UPDATE orders SET warranty_terms=? WHERE id=?',
              [JSON.stringify({ ...terms, startedAt: new Date(data.deliveredAt).toISOString() }), targetOrderId]);
          }
        }

        await connection.execute(
          "INSERT INTO audit_logs (user_id,username,action,resource_type,resource_id,details,ip_address,user_agent) VALUES (?,?,'ORDER_DELIVERY_DATE_UPDATED','order',?,?,?,?)",
          [
            authenticatedClaims.sub,
            authenticatedClaims.email || null,
            String(targetOrderId),
            JSON.stringify({ orderCode: orderRow.order_code, previousDeliveredAt, newDeliveredAt: data.deliveredAt, reason: data.reason }),
            request.socket.remoteAddress || null,
            request.headers['user-agent']?.slice(0, 255) || null,
          ],
        );
        await connection.commit();
        broadcastRealtimeEvent('order:updated', {
          orderId: targetOrderId,
          action: 'DELIVERY_DATE_UPDATED',
          timestamp: Date.now(),
        });

        return sendJson(response, 200, {
          ok: true,
          deliveredAt: data.deliveredAt,
          version: data.version + 1,
          message: 'Fecha de entrega física modificada y validada con éxito',
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally { connection.release(); }
    }

    // ==========================================
    // REVERT ORDER FROM LISTO_RETIRO TO PAGADO (SUPER ADMIN + WHATSAPP OTP)
    // ==========================================
    const revertToPaidOtpMatch = pathname.match(/^\/api\/orders\/(\d+)\/revert-to-paid\/request-otp$/);
    if (request.method === 'POST' && revertToPaidOtpMatch) {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const targetOrderId = Number(revertToPaidOtpMatch[1]);
      const body = revertToPaidOtpRequestSchema.parse(await readBody(request));

      const [orderRows] = await pool.query<RowDataPacket[]>(
        'SELECT id, order_code, status FROM orders WHERE id = ? AND deleted_at IS NULL LIMIT 1',
        [targetOrderId]
      );
      if (!orderRows[0]) return sendJson(response, 404, { message: 'Orden no encontrada' });
      const orderRow = orderRows[0];
      const curStatus = statusFromDatabase(orderRow.status);
      if (curStatus !== 'listo_retiro' && orderRow.status !== 'listo_retiro') {
        return sendJson(response, 400, { message: 'Solo se pueden revertir a Pagado órdenes en estado Listo para Retiro.' });
      }

      const now = Date.now();
      const existing = activeRevertToPaidOtps.get(targetOrderId);
      if (existing && (now - existing.requestedAt) < 30_000 && existing.expiresAt > now) {
        const remaining = Math.max(1, Math.ceil((30_000 - (now - existing.requestedAt)) / 1000));
        return sendJson(response, 429, {
          ok: false,
          message: 'Por favor espera unos segundos antes de solicitar otro código.',
          cooldownSeconds: remaining,
        });
      }

      const [adminRows] = await pool.query<RowDataPacket[]>(
        "SELECT id, name, phone FROM users WHERE id = ? AND role = 'admin' AND active = 1 AND deleted_at IS NULL LIMIT 1",
        [authenticatedClaims?.sub]
      );
      let adminUser = adminRows[0];
      if (!adminUser?.phone) {
        const [fallbackAdmins] = await pool.query<RowDataPacket[]>(
          "SELECT id, name, phone FROM users WHERE role = 'admin' AND active = 1 AND phone IS NOT NULL AND phone != '' AND deleted_at IS NULL ORDER BY (id = 1) DESC, id ASC LIMIT 1"
        );
        adminUser = fallbackAdmins[0];
      }
      if (!adminUser?.phone) {
        return sendJson(response, 409, { message: 'No hay teléfono configurado para el Super Administrador en el sistema.' });
      }

      const targetPhone = formatWasenderPhone(adminUser.phone);
      const otpCode = crypto.randomInt(100000, 1000000).toString();

      activeRevertToPaidOtps.set(targetOrderId, {
        orderId: targetOrderId,
        code: otpCode,
        expiresAt: now + 3 * 60 * 1000, // 3 minutes
        requestedAt: now,
        requestedByUserId: Number(authenticatedClaims?.sub),
        targetPhone,
        reason: body.reason,
      });

      const messageText = `🔐 *Radar Security Alert · Reversión de Orden*\n\nHola *${adminUser.name || 'Super Admin'}*, se ha solicitado devolver la orden *#${orderRow.order_code || targetOrderId}* del estado 'Listo para Retiro' a 'Pagado'.\n\nMotivo: _${body.reason}_\n\nTu código de seguridad de un solo uso es:\n👉 *${otpCode}* 👈\n\n⏱️ Válido por 3 minutos. Si no solicitaste esta reversión, ignora este mensaje.`;

      if (!wasender.configured || wasender.isTestMode) {
        if (wasender.isTestMode) {
          console.log(`[TEST MODE] OTP para revertir orden ${targetOrderId}: ${otpCode}`);
        } else {
          activeRevertToPaidOtps.delete(targetOrderId);
          return sendJson(response, 503, { message: 'El servicio de WhatsApp (Wasender) no está configurado o disponible.' });
        }
      } else {
        try {
          await wasender.sendText({ to: targetPhone, text: messageText });
        } catch (err) {
          console.error('[Revert to Paid OTP] Error enviando WhatsApp:', err);
          activeRevertToPaidOtps.delete(targetOrderId);
          return sendJson(response, 503, { message: 'Error al enviar el código de seguridad por WhatsApp.' });
        }
      }

      void recordAuditLog(pool, {
        userId: Number(authenticatedClaims?.sub),
        username: authenticatedClaims?.email,
        action: 'ORDER_REVERT_OTP_REQUESTED',
        resourceType: 'order',
        resourceId: String(targetOrderId),
        details: { targetPhoneMasked: `***${targetPhone.slice(-4)}`, reason: body.reason },
        ipAddress: request.socket.remoteAddress || 'unknown',
        userAgent: request.headers['user-agent'] || null,
      });

      return sendJson(response, 200, {
        ok: true,
        message: 'Código de seguridad enviado por WhatsApp exitosamente.',
        cooldownSeconds: 30,
        targetPhoneMasked: `***${targetPhone.slice(-4)}`,
      });
    }

    const revertToPaidMatch = pathname.match(/^\/api\/orders\/(\d+)\/revert-to-paid$/);
    if (request.method === 'POST' && revertToPaidMatch) {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const targetOrderId = Number(revertToPaidMatch[1]);
      const data = revertToPaidSchema.parse(await readBody(request));

      const now = Date.now();
      const activeOtp = activeRevertToPaidOtps.get(targetOrderId);
      if (!activeOtp || activeOtp.expiresAt <= now) {
        activeRevertToPaidOtps.delete(targetOrderId);
        return sendJson(response, 400, { message: 'El código de seguridad ha expirado o no ha sido solicitado. Solicita uno nuevo.' });
      }
      if (activeOtp.code !== data.code.trim()) {
        return sendJson(response, 400, { message: 'El código de seguridad ingresado es incorrecto.' });
      }

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [orderRows] = await connection.query<RowDataPacket[]>(
          'SELECT id, order_code, status, scheduled_pickup_at, preparation_details, version FROM orders WHERE id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
          [targetOrderId]
        );
        if (!orderRows[0]) fail(404, 'Orden no encontrada');
        const orderRow = orderRows[0];
        const curStatus = statusFromDatabase(orderRow.status);
        if (curStatus !== 'listo_retiro' && orderRow.status !== 'listo_retiro') {
          fail(400, 'Solo se pueden revertir a Pagado órdenes en estado Listo para Retiro.');
        }
        if (data.version && Number(data.version) !== Number(orderRow.version)) {
          fail(409, 'La orden cambió; recarga antes de guardar');
        }

        const [orderUpdate] = await connection.execute<ResultSetHeader>(
          'UPDATE orders SET status = ?, scheduled_pickup_at = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL',
          [statusToDatabase.pagado || 'pagado', targetOrderId]
        );
        if (!orderUpdate.affectedRows) fail(409, 'No se pudo actualizar la orden.');

        const currentUserId = Number(authenticatedClaims?.sub);
        const [adminRows] = await connection.query<RowDataPacket[]>(
          'SELECT name FROM users WHERE id = ?',
          [currentUserId]
        );
        const adminName = adminRows[0]?.name || 'Super Admin';
        await connection.execute(
          `INSERT INTO order_workflow_events (order_id, task, outcome, actor_id, actor_name, notes, evidence) VALUES (?, 'prepare', 'reopened', ?, ?, ?, '[]')`,
          [targetOrderId, currentUserId, adminName, `Reversión administrativa de Listo para Retiro a Pagado con OTP verificado. Motivo: ${data.reason.trim()}`]
        );

        await connection.execute(
          'INSERT INTO status_orders (order_id, status, description, user_id) VALUES (?, ?, ?, ?)',
          [targetOrderId, statusToDatabase.pagado || 'pagado', `Reversión administrativa desde Listo para Retiro con OTP verificado. Motivo: ${data.reason.trim()}`, currentUserId]
        );

        await connection.execute(
          "INSERT INTO audit_logs (user_id, username, action, resource_type, resource_id, details, ip_address, user_agent) VALUES (?, ?, 'ORDER_REVERTED_TO_PAID', 'order', ?, ?, ?, ?)",
          [
            currentUserId,
            authenticatedClaims?.email || null,
            String(targetOrderId),
            JSON.stringify({
              orderCode: orderRow.order_code,
              fromStatus: orderRow.status,
              toStatus: 'pagado',
              reason: data.reason.trim(),
              otpVerified: true,
            }),
            request.socket.remoteAddress || null,
            request.headers['user-agent']?.slice(0, 255) || null,
          ]
        );

        await connection.commit();

        // Invalidate OTP only upon confirmed transaction commit
        activeRevertToPaidOtps.delete(targetOrderId);

        broadcastRealtimeEvent('order:updated', {
          orderId: targetOrderId,
          action: 'STATUS_REVERTED_TO_PAID',
          timestamp: Date.now(),
        });

        return sendJson(response, 200, {
          ok: true,
          message: 'Orden devuelta a estado Pagado con éxito.',
          newStatus: 'pagado',
        });
      } catch (error) {
        await connection.rollback();
        console.error('[RevertToPaid Error]:', error);
        throw error;
      } finally {
        connection.release();
      }
    }

    // ==========================================
    // CANCEL ORDER WITH AUTOMATIC REFUND (SUPER ADMIN + WHATSAPP/SMS OTP)
    // ==========================================
    const cancelOrderOtpMatch = pathname.match(/^\/api\/orders\/(\d+)\/cancel-admin\/request-otp$/);
    if (request.method === 'POST' && cancelOrderOtpMatch) {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const targetOrderId = Number(cancelOrderOtpMatch[1]);
      const body = cancelOrderOtpRequestSchema.parse(await readBody(request));

      const [orderRows] = await pool.query<RowDataPacket[]>(
        'SELECT id, order_code, status, down_payment, inventory_part_id FROM orders WHERE id = ? AND deleted_at IS NULL LIMIT 1',
        [targetOrderId]
      );
      if (!orderRows[0]) return sendJson(response, 404, { message: 'Orden no encontrada' });
      const orderRow = orderRows[0];
      const curStatus = statusFromDatabase(orderRow.status);
      if (curStatus === 'cancelado' || orderRow.status === 'Cancelado') {
        return sendJson(response, 400, { message: 'Esta orden ya se encuentra cancelada.' });
      }

      const now = Date.now();
      const existing = activeCancelOrderOtps.get(targetOrderId);
      if (existing && (now - existing.requestedAt) < 30_000 && existing.expiresAt > now) {
        const remaining = Math.max(1, Math.ceil((30_000 - (now - existing.requestedAt)) / 1000));
        return sendJson(response, 429, {
          ok: false,
          message: 'Por favor espera unos segundos antes de solicitar otro código.',
          cooldownSeconds: remaining,
        });
      }

      const [adminRows] = await pool.query<RowDataPacket[]>(
        "SELECT id, name, phone FROM users WHERE id = ? AND role = 'admin' AND active = 1 AND deleted_at IS NULL LIMIT 1",
        [authenticatedClaims?.sub]
      );
      let adminUser = adminRows[0];
      if (!adminUser?.phone) {
        const [fallbackAdmins] = await pool.query<RowDataPacket[]>(
          "SELECT id, name, phone FROM users WHERE role = 'admin' AND active = 1 AND phone IS NOT NULL AND phone != '' AND deleted_at IS NULL ORDER BY (id = 1) DESC, id ASC LIMIT 1"
        );
        adminUser = fallbackAdmins[0];
      }
      if (!adminUser?.phone) {
        return sendJson(response, 409, { message: 'No hay teléfono configurado para el Super Administrador en el sistema.' });
      }

      const [payments] = await pool.query<RowDataPacket[]>(
        "SELECT COALESCE(SUM(amount), 0) AS total_paid FROM finance_movements WHERE order_id = ? AND kind = 'payment'",
        [targetOrderId]
      );
      const [refunds] = await pool.query<RowDataPacket[]>(
        "SELECT COALESCE(SUM(amount), 0) AS total_refunded FROM finance_movements WHERE order_id = ? AND kind = 'refund'",
        [targetOrderId]
      );
      const orderDownPayment = Number(orderRow.down_payment || 0);
      const movementsPaid = Number(payments[0]?.total_paid || 0);
      const totalPaid = Math.max(orderDownPayment, movementsPaid);
      const totalRefunded = Number(refunds[0]?.total_refunded || 0);
      const netPaid = Math.max(0, totalPaid - totalRefunded);

      const targetPhone = formatWasenderPhone(adminUser.phone);
      const otpCode = crypto.randomInt(100000, 1000000).toString();

      activeCancelOrderOtps.set(targetOrderId, {
        orderId: targetOrderId,
        code: otpCode,
        expiresAt: now + 3 * 60 * 1000, // 3 minutes
        requestedAt: now,
        requestedByUserId: Number(authenticatedClaims?.sub),
        targetPhone,
        reason: body.reason,
        paymentMethod: body.paymentMethod,
      });

      const methodLabel = body.paymentMethod ? ` vía ${body.paymentMethod}` : '';
      const messageText = `🚫 *Radar Security Alert · Cancelación de Orden*\n\nHola *${adminUser.name || 'Super Admin'}*, se ha solicitado cancelar la orden *#${orderRow.order_code || targetOrderId}* con devolución automática de $${netPaid.toFixed(2)}${methodLabel}.\n\nMotivo: _${body.reason}_\n\nTu código de seguridad de un solo uso es:\n👉 *${otpCode}* 👈\n\n⏱️ Válido por 3 minutos. Si no solicitaste esta cancelación, ignora este mensaje.`;

      if (!wasender.configured || wasender.isTestMode) {
        if (wasender.isTestMode) {
          console.log(`[TEST MODE] OTP para cancelar orden ${targetOrderId}: ${otpCode}`);
        } else {
          activeCancelOrderOtps.delete(targetOrderId);
          return sendJson(response, 503, { message: 'El servicio de WhatsApp (Wasender) no está configurado o disponible.' });
        }
      } else {
        try {
          await wasender.sendText({ to: targetPhone, text: messageText });
        } catch (err) {
          console.error('[Cancel Order OTP] Error enviando WhatsApp:', err);
          activeCancelOrderOtps.delete(targetOrderId);
          return sendJson(response, 503, { message: 'Error al enviar el código de seguridad por WhatsApp.' });
        }
      }

      void recordAuditLog(pool, {
        userId: Number(authenticatedClaims?.sub),
        username: authenticatedClaims?.email,
        action: 'ORDER_CANCEL_OTP_REQUESTED',
        resourceType: 'order',
        resourceId: String(targetOrderId),
        details: { targetPhoneMasked: `***${targetPhone.slice(-4)}`, reason: body.reason, netPaid },
        ipAddress: request.socket.remoteAddress || 'unknown',
        userAgent: request.headers['user-agent'] || null,
      });

      return sendJson(response, 200, {
        ok: true,
        message: 'Código de seguridad enviado por WhatsApp exitosamente.',
        cooldownSeconds: 30,
        targetPhoneMasked: `***${targetPhone.slice(-4)}`,
        netPaidToRefund: netPaid,
      });
    }

    const cancelOrderMatch = pathname.match(/^\/api\/orders\/(\d+)\/cancel-admin$/);
    if (request.method === 'POST' && cancelOrderMatch) {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const targetOrderId = Number(cancelOrderMatch[1]);
      const data = cancelOrderSchema.parse(await readBody(request));

      const now = Date.now();
      const activeOtp = activeCancelOrderOtps.get(targetOrderId);
      if (!activeOtp || activeOtp.expiresAt <= now) {
        activeCancelOrderOtps.delete(targetOrderId);
        return sendJson(response, 400, { message: 'El código de seguridad ha expirado o no ha sido solicitado. Solicita uno nuevo.' });
      }
      if (activeOtp.code !== data.code.trim()) {
        return sendJson(response, 400, { message: 'El código de seguridad ingresado es incorrecto.' });
      }

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [orderRows] = await connection.query<RowDataPacket[]>(
          'SELECT id, order_code, status, inventory_part_id, down_payment, version FROM orders WHERE id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
          [targetOrderId]
        );
        if (!orderRows[0]) fail(404, 'Orden no encontrada');
        const orderRow = orderRows[0];
        const curStatus = statusFromDatabase(orderRow.status);
        if (curStatus === 'cancelado' || orderRow.status === 'Cancelado') {
          fail(400, 'La orden ya está cancelada');
        }
        if (data.version && Number(data.version) !== Number(orderRow.version)) {
          fail(409, 'La orden cambió; recarga antes de guardar');
        }

        // Calculate paid and refunded movements
        const [payments] = await connection.query<RowDataPacket[]>(
          "SELECT id, amount, payment_method, payment_reference, payment_receipt, payment_received_by FROM finance_movements WHERE order_id = ? AND kind = 'payment'",
          [targetOrderId]
        );
        const [refundMovements] = await connection.query<RowDataPacket[]>(
          "SELECT COALESCE(SUM(amount), 0) AS total_refunded FROM finance_movements WHERE order_id = ? AND kind = 'refund'",
          [targetOrderId]
        );
        const orderDownPayment = Number(orderRow.down_payment || 0);
        const movementsPaid = payments.reduce((acc, p) => acc + Number(p.amount || 0), 0);
        const totalPaid = Math.max(orderDownPayment, movementsPaid);
        const totalRefunded = Number(refundMovements[0]?.total_refunded || 0);
        const netPaid = Math.max(0, totalPaid - totalRefunded);

        const currentUserId = Number(authenticatedClaims?.sub);
        const [adminRows] = await connection.query<RowDataPacket[]>(
          'SELECT name FROM users WHERE id = ?',
          [currentUserId]
        );
        const adminName = adminRows[0]?.name || 'Super Admin';

        // Auto refund execution
        let methodCode = (data.paymentMethod || activeOtp.paymentMethod || payments[0]?.payment_method || 'square').toLowerCase();
        if (methodCode === 'tarjeta' || methodCode === 'card') methodCode = 'square';
        if (methodCode === 'efectivo') methodCode = 'cash';

        let methodDbLabel = 'Tarjeta (Square)';
        let methodDisplay = 'Tarjeta';
        let executionData: Record<string, any> = { method: 'square', reference: 'Cancelación automática admin', last4: 'AUTO' };

        if (methodCode === 'cash') {
          methodDbLabel = 'Efectivo';
          methodDisplay = 'Efectivo';
          executionData = { method: 'cash', recipient: 'Devuelto en mostrador (Cancelación Admin)' };
        } else if (methodCode === 'zelle') {
          methodDbLabel = 'Zelle';
          methodDisplay = 'Zelle';
          executionData = { method: 'zelle', reference: 'Cancelación automática Zelle', recipient: 'Cliente original' };
        } else if (methodCode === 'cashapp') {
          methodDbLabel = 'Cash App';
          methodDisplay = 'Cash App';
          executionData = { method: 'cashapp', reference: 'Cancelación automática Cash App', recipient: 'Cliente original' };
        }

        if (netPaid > 0) {
          const refundReason = `Devolución automática por cancelación de orden por Administrador. Motivo: ${data.reason.trim()}`.slice(0, 255);
          await connection.execute(
            `INSERT INTO refund_requests (order_id, amount, amount_type, payment_method, reason, status, requested_by, previous_order_status, review_stage, refund_scope, execution, completed_at, completed_by)
             VALUES (?, ?, 'total', ?, ?, 'completed', ?, ?, 'completed', 'purchase', ?, UTC_TIMESTAMP(), ?)`,
            [
              targetOrderId,
              netPaid,
              methodDbLabel,
              refundReason,
              currentUserId,
              orderRow.status,
              JSON.stringify(executionData),
              currentUserId,
            ]
          );

          await connection.execute(
            `INSERT INTO finance_movements (order_id, kind, amount, effective_at, source, reference_key, user_id, payment_method, payment_receipt, payment_received_by)
             VALUES (?, 'refund', ?, UTC_TIMESTAMP(), 'refund', ?, ?, ?, NULL, ?)`,
            [
              targetOrderId,
              netPaid,
              `refund-cancel-${targetOrderId}-${crypto.randomUUID().slice(0, 8)}`,
              currentUserId,
              methodCode,
              'Sistema / Administrador',
            ]
          );
        }

        // Release inventory part back to disponible
        if (orderRow.inventory_part_id) {
          await connection.execute(
            "UPDATE inventory_parts SET status = 'disponible', sold_at = NULL WHERE id = ? AND deleted_at IS NULL",
            [orderRow.inventory_part_id]
          );
        }

        // Update order status to Cancelado
        const [orderUpdate] = await connection.execute<ResultSetHeader>(
          'UPDATE orders SET status = ?, scheduled_pickup_at = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL',
          ['Cancelado', targetOrderId]
        );
        if (!orderUpdate.affectedRows) fail(409, 'No se pudo actualizar la orden.');

        const refundSummaryText = netPaid > 0
          ? ` Devolución automática de $${netPaid.toFixed(2)} procesada (${methodDisplay}).`
          : ' Sin cobros pendientes por devolver.';

        await connection.execute(
          `INSERT INTO order_workflow_events (order_id, task, outcome, actor_id, actor_name, notes, evidence) VALUES (?, 'cancel', 'cancelled_by_admin', ?, ?, ?, '[]')`,
          [targetOrderId, currentUserId, adminName, `Orden cancelada por el Administrador con código OTP verificado. Motivo: ${data.reason.trim()}.${refundSummaryText}`]
        );

        await connection.execute(
          'INSERT INTO status_orders (order_id, status, description, user_id) VALUES (?, ?, ?, ?)',
          [targetOrderId, 'Cancelado', `Cancelada por el Administrador ${adminName} con código OTP verificado. Motivo: ${data.reason.trim()}.${refundSummaryText}`, currentUserId]
        );

        await connection.execute(
          "INSERT INTO audit_logs (user_id, username, action, resource_type, resource_id, details, ip_address, user_agent) VALUES (?, ?, 'ORDER_CANCELLED_ADMIN', 'order', ?, ?, ?, ?)",
          [
            currentUserId,
            authenticatedClaims?.email || null,
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
            request.socket.remoteAddress || null,
            request.headers['user-agent']?.slice(0, 255) || null,
          ]
        );

        await connection.commit();
        activeCancelOrderOtps.delete(targetOrderId);

        broadcastRealtimeEvent('order:updated', {
          orderId: targetOrderId,
          action: 'ORDER_CANCELLED_ADMIN',
          timestamp: Date.now(),
        });

        return sendJson(response, 200, {
          ok: true,
          message: 'Orden cancelada exitosamente por el Administrador y devolución procesada.',
          newStatus: 'cancelado',
          netRefunded: netPaid,
        });
      } catch (error) {
        await connection.rollback();
        console.error('[CancelOrderAdmin Error]:', error);
        return sendJson(response, 500, {
          message: error instanceof Error ? `Error al cancelar: ${error.message}` : 'No fue posible completar la solicitud',
        });
      } finally {
        connection.release();
      }
    }

    const inventoryLinkId = pathname.match(/^\/api\/orders\/(\d+)\/inventory$/)?.[1];
    if (request.method === 'POST' && inventoryLinkId) {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator', 'vendedor_yarda')) return;
      const payload = z.object({
        inventoryPartId: z.number().int().positive(),
        version: z.number().int().positive(),
        confirmedCompatibility: z.literal(true),
      }).strict().parse(await readBody(request));
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [orders] = await connection.query<RowDataPacket[]>(
          'SELECT * FROM orders WHERE id=? AND deleted_at IS NULL FOR UPDATE', [inventoryLinkId],
        );
        const row = orders[0];
        if (!row) fail(404, 'Orden no encontrada');
        if (row.version !== payload.version) fail(409, 'La orden cambió. Actualiza antes de reservar');
        if (row.inventory_part_id) fail(409, 'La orden ya tiene una pieza vinculada');
        if (!['cotizacion', 'espera_confirmacion', 'pagado', 'en_preparacion', 'listo_despacho',
          'listo_retiro', 'en_camino'].includes(statusFromDatabase(row.status))) {
          fail(409, 'No se puede reservar inventario en el estado actual de esta orden');
        }
        const [parts] = await connection.query<RowDataPacket[]>(
          'SELECT * FROM inventory_parts WHERE id=? AND deleted_at IS NULL FOR UPDATE', [payload.inventoryPartId],
        );
        if (!parts[0]) fail(404, 'Pieza de inventario no encontrada');
        if (parts[0].status !== 'disponible') fail(409, 'La pieza ya no está disponible');
        const availability = matchOrderInventory(mapOrder(row), [mapInventoryPartRow(parts[0])]);
        if (!availability.candidates.length) fail(409, 'La pieza no coincide con los datos actuales de la orden');
        await syncInventory(connection, Number(inventoryLinkId), payload.inventoryPartId, statusFromDatabase(row.status));
        await connection.execute('UPDATE orders SET inventory_part_id=?,version=version+1 WHERE id=?',
          [payload.inventoryPartId, inventoryLinkId]);
        await connection.execute(
          "INSERT INTO audit_logs (user_id,username,action,resource_type,resource_id,details,ip_address,user_agent) VALUES (?,?,'ORDER_INVENTORY_LINKED','order',?,?,?,?)",
          [authenticatedClaims?.sub, authenticatedClaims?.email || null, inventoryLinkId,
            JSON.stringify({ inventoryPartId: payload.inventoryPartId, confirmedCompatibility: true }),
            request.socket.remoteAddress || null, request.headers['user-agent']?.slice(0, 255) || null],
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally { connection.release(); }
      broadcastRealtimeEvent('order:updated', { orderId: Number(inventoryLinkId), action: 'INVENTORY_LINKED', timestamp: Date.now() });
      return sendJson(response, 200, (await getOrders({ id: Number(inventoryLinkId), limit: 1 }))[0]);
    }

    const orderId = pathname.match(/^\/api\/orders\/(\d+)$/)?.[1];
    if (request.method === 'PUT' && orderId) {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator', 'vendedor_yarda')) return;
      const order = orderPayloadSchema.parse(await readBody(request));
      const customerName = String(order.customer?.name || '').trim().split(/\s+/);
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // 1. Fetch previous order state and advisor details
        const [prevRows] = await connection.query<RowDataPacket[]>(
          `SELECT o.*,
                  c.first_name, c.last_name, c.phone AS customer_phone,
                  u.id AS advisor_user_id, u.name AS advisor_name, u.phone AS advisor_phone
           FROM orders o
           LEFT JOIN customers c ON c.id = o.customer_id
           LEFT JOIN users u ON u.id = o.user_id
           WHERE o.id = ? AND o.deleted_at IS NULL LIMIT 1 FOR UPDATE`,
          [orderId]
        );
        const prevOrder = prevRows[0];
        if (!prevOrder) fail(404, 'Orden no encontrada');
        enforceCollectionUpdate(prevOrder, order);
        await enforceWorkflowUpdate(connection, prevOrder, order, authenticatedClaims || undefined);
        validateOrder(order, prevOrder, String(authenticatedClaims?.role));

        const updateCustomerLanguage = order.customerLanguage || order.customer?.language || null;

        let assignedUserId: number | null | undefined = order.userId;
        if (assignedUserId === undefined && order.advisor && order.advisor !== 'Sin asignar') {
          const [userRows] = await connection.query<RowDataPacket[]>('SELECT id FROM users WHERE name = ? AND deleted_at IS NULL LIMIT 1', [order.advisor]);
          if (userRows[0]) assignedUserId = userRows[0].id;
        }
        if (authenticatedClaims?.role !== 'admin' && assignedUserId !== undefined && Number(assignedUserId) !== Number(prevOrder.user_id)) {
          fail(403, 'Solo administración puede reasignar una orden');
        }

        let isYardSale: boolean | undefined = (order as any).isYardSale !== undefined ? Boolean((order as any).isYardSale) : undefined;
        if (assignedUserId !== undefined && assignedUserId !== null) {
          const [targetUserRows] = await connection.query<RowDataPacket[]>('SELECT id, role FROM users WHERE id = ? LIMIT 1', [assignedUserId]);
          if (targetUserRows[0]?.role === 'vendedor_yarda') {
            isYardSale = true;
          } else if (isYardSale === undefined && targetUserRows[0]?.role && targetUserRows[0].role !== 'vendedor_yarda') {
            isYardSale = false;
          }
        }

        const transmissionType = normalizeTransmissionType(order.vehicle?.transmission);
        const newDbStatus = statusToDatabase[order.status || ''] || order.status || '';

        const isOrderPaid = (order.status === 'pagado') || (/pagad/i.test(newDbStatus));
        const auctionActiveVal = isOrderPaid
          ? ((order as any).auctionActive !== undefined
              ? ((order as any).auctionActive ? 1 : 0)
              : ((order as any).auctionLinks && (order as any).auctionLinks.length > 0 ? 1 : undefined))
          : 0;

        await connection.execute(
          `UPDATE orders SET version=version+1, vin_nr = ?, brand = ?, model = ?, sub_model = ?, year = ?, color = ?, mileage = ?, product_type = ?, transmission_type = ?, product_specs = ?, stock_nr = ?, price = ?, core_fee = ?, down_payment = ?, shipping_toggle = ?, shipping_address = ?, shipping_cost = ?, warranty_days = ?, status = ?, workflow_step = ?, scheduled_pickup_at = ?, delivered_at = ?, warranty_started = ?, description = ?, claim_reason = ? ${updateCustomerLanguage ? ', customer_language = ?' : ''} ${assignedUserId !== undefined ? ', user_id = ?' : ''} ${isYardSale !== undefined ? ', is_yard_sale = ?' : ''} ${auctionActiveVal !== undefined ? ', auction_search_active = ?' : ''} WHERE id = ?`,
          [
            order.vehicle?.vin || null, order.vehicle?.make || null, order.vehicle?.model || null, order.vehicle?.trim || null, order.vehicle?.year || null, order.vehicle?.color || null, order.vehicle?.mileage || null, order.mainPart || null, transmissionType, order.productSpecs || null, order.stockNumber || null, order.financials?.partPrice || 0, order.financials?.coreFee || 0, order.financials?.downPayment || 0, order.deliveryType === 'envio_domicilio', order.customer?.shippingAddress || null, order.financials?.deliveryFee || 0, order.warrantyDays ?? 60, newDbStatus, order.workflowStep || 1, toMysqlDateTime(order.scheduledPickupAt), toMysqlDateTime(order.deliveredAt) || prevOrder.delivered_at, Boolean(order.warrantyStarted || prevOrder.warranty_started), order.notes || null, order.claimReason || null,
            ...(updateCustomerLanguage ? [updateCustomerLanguage] : []),
            ...(assignedUserId !== undefined ? [assignedUserId] : []),
            ...(isYardSale !== undefined ? [isYardSale ? 1 : 0] : []),
            ...(auctionActiveVal !== undefined ? [auctionActiveVal] : []),
            orderId,
          ]
        );
        const workflowData = z.object({
          isCoreCollected: z.boolean().optional(), isPartCollected: z.boolean().optional(),
          isInvoiceSent: z.boolean().optional(), isDeliveryConfirmed: z.boolean().optional(),
          isWarrantySent: z.boolean().optional(), isDataVerified: z.boolean().optional(),
        }).parse(order);
        await connection.execute(
          'UPDATE orders SET shipping_zip_code=?,contact_name=?,contact_phone=?,contact_email=?,workflow_data=? WHERE id=?',
          [order.customer?.zip_code || null, order.customer?.name || null, order.customer?.phone || null, order.customer?.email || null, JSON.stringify(workflowData), orderId],
        );
        await recordPaymentChange(connection, Number(orderId), Number(order.financials?.downPayment || 0), Number(prevOrder.down_payment || 0), Number(authenticatedClaims?.sub));
        if (order.inventoryPartId != null && Number(order.inventoryPartId) !== Number(prevOrder.inventory_part_id)) {
          fail(400, 'La pieza de inventario no se puede sustituir en una orden existente');
        }
        await syncInventory(connection, Number(orderId), prevOrder.inventory_part_id, order.status || '');

        if (Array.isArray((order as any).auctionLinks)) {
          const links = (order as any).auctionLinks;
          const keepIds: number[] = [];
          for (const link of links) {
            const rawId = Number(link.id);
            const isNumericId = Number.isInteger(rawId) && rawId > 0 && String(link.id).length < 10;
            const auctionType = link.auctionHouse === 'IAAI' ? 'IAA' : 'Copart';
            const auctionDate = link.auctionDate ? new Date(link.auctionDate) : new Date();
            const formattedDate = !isNaN(auctionDate.getTime()) ? auctionDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

            if (isNumericId) {
              await connection.execute(
                'UPDATE order_auction_links SET url = ?, auction_type = ?, auction_date = ? WHERE id = ? AND order_id = ?',
                [link.url, auctionType, formattedDate, rawId, orderId]
              );
              keepIds.push(rawId);
            } else if (link.url) {
              const [insResult] = await connection.execute<ResultSetHeader>(
                'INSERT INTO order_auction_links (order_id, url, auction_type, auction_date, status) VALUES (?, ?, ?, ?, ?)',
                [orderId, link.url, auctionType, formattedDate, 'active']
              );
              keepIds.push(insResult.insertId);
            }
          }
          if (keepIds.length > 0) {
            await connection.query(
              `DELETE FROM order_auction_links WHERE order_id = ? AND id NOT IN (${keepIds.map(() => '?').join(',')})`,
              [orderId, ...keepIds]
            );
          } else {
            await connection.execute('DELETE FROM order_auction_links WHERE order_id = ?', [orderId]);
          }
        }
        const currentUserId = Number(authenticatedClaims?.sub);
        await connection.execute(
          'INSERT INTO status_orders (order_id, status, description, user_id) VALUES (?, ?, ?, ?)',
          [orderId, newDbStatus || 'Actualizada', 'Orden actualizada desde RADAR 3.0', currentUserId]
        );
        await connection.execute(
          "INSERT INTO audit_logs (user_id,username,action,resource_type,resource_id,details) VALUES (?,?,'ORDER_UPDATED','order',?,?)",
          [currentUserId, authenticatedClaims?.email || null, orderId, JSON.stringify({ before: prevOrder, after: order })],
        );
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
            notes: order.notes || prevOrder?.description || null,
            totalPrice: Number(order.financials?.partPrice || prevOrder?.price || 0),
            downPayment: Number(order.financials?.downPayment || prevOrder?.down_payment || 0),
            deliveryType: order.deliveryType,
            shippingAddress: order.customer?.shippingAddress,
          });

          await queueSystemNotification(connection, 'NUEVA_VENTA', newSaleMsg, {
            creatorUserId: targetUserId ? Number(targetUserId) : undefined,
            creatorPhone: prevOrder?.advisor_phone || undefined,
            creatorName: operatorName,
            orderStatus: newDbStatus,
          });
        }

        // B) Ready for Pickup or Delivery ("Listo para Retiro" / "Listo para Despacho")
        const isReadyForPickupOrDelivery =
          /retiro|despacho|envio|envío/i.test(newDbStatus) ||
          /retiro|despacho|envio|envío/i.test(order.status || '');

        if (isReadyForPickupOrDelivery && newDbStatus !== prevOrder.status) {
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

          await queueSystemNotification(connection, 'CAMBIO_ESTATUS', statusMsg, {
            creatorUserId: targetUserId ? Number(targetUserId) : undefined,
            creatorPhone: prevOrder?.advisor_phone || undefined,
            creatorName: operatorName,
            orderStatus: newDbStatus,
          });
        }

        // C) Cancelled ("Cancelado")
        if (newDbStatus !== prevOrder.status && /cancelad/i.test(newDbStatus)) {
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

          await queueSystemNotification(connection, 'ORDEN_CANCELADA', cancelMsg, {
            orderStatus: 'Cancelado',
          });
        }

        await connection.commit();
        const orders = await getOrders({ id: Number(orderId), limit: 1 });
        const updatedOrder = orders.find((currentOrder) => currentOrder.id === orderId);

        broadcastRealtimeEvent('order:updated', {
          orderId: Number(orderId),
          action: 'ORDER_UPDATED',
          status: updatedOrder?.status,
          timestamp: Date.now(),
        });

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
        `INSERT INTO customers (first_name, last_name, phone, whatsapp, email, address_shipping, zip_code, language, notes, company, type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [firstName, lastName, data.phone, data.whatsapp || data.phone, data.email || null, shipping, data.zip_code || null, data.language || 'es', data.notes || null, data.company || null, data.type]
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
        `UPDATE customers SET version=version+1, company=?,type=?, first_name = ?, last_name = ?, phone = ?, whatsapp = ?, email = ?, address_shipping = ?, zip_code = ?, language = COALESCE(?, language), notes = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND deleted_at IS NULL`,
        [data.company || null, data.type, firstName, lastName, data.phone, data.whatsapp || data.phone, data.email || null, shipping, data.zip_code || null, data.language || null, data.notes || null, customerId]
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

    if (request.method === 'GET' && pathname === '/api/customers/duplicates') {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator')) return;

      const [allCustomers] = await pool.query<RowDataPacket[]>(`
        SELECT 
          c.id, c.first_name, c.last_name, c.phone, c.whatsapp, c.email, 
          c.address_shipping, c.zip_code, c.company, c.type, c.created_at,
          COUNT(DISTINCT o.id) AS order_count,
          COUNT(DISTINCT cr.id) AS call_count
        FROM customers c
        LEFT JOIN orders o ON o.customer_id = c.id AND o.deleted_at IS NULL
        LEFT JOIN call_register cr ON cr.customer_id = c.id
        WHERE c.deleted_at IS NULL
        GROUP BY c.id
        ORDER BY c.id ASC
      `);

      const clustersMap = new Map<string, {
        matchType: 'phone' | 'email' | 'name';
        matchValue: string;
        customerIds: Set<number>;
      }>();

      for (const row of allCustomers) {
        const id = Number(row.id);
        const phoneClean = String(row.phone || '').replace(/\D/g, '');
        const emailClean = String(row.email || '').trim().toLowerCase();
        const fullName = `${row.first_name || ''} ${row.last_name || ''}`.trim().toLowerCase();

        // 1. Phone cluster (match on clean last 10 digits if longer, or clean phone if >= 7 digits)
        if (phoneClean.length >= 7 && !/^0+$/.test(phoneClean) && phoneClean !== '1234567890') {
          const phoneKey = phoneClean.length >= 10 ? phoneClean.slice(-10) : phoneClean;
          const key = `phone:${phoneKey}`;
          if (!clustersMap.has(key)) {
            clustersMap.set(key, { matchType: 'phone', matchValue: row.phone, customerIds: new Set() });
          }
          clustersMap.get(key)!.customerIds.add(id);
        }

        // 2. Email cluster
        if (emailClean && emailClean.includes('@') && !emailClean.endsWith('@ejemplo.com')) {
          const key = `email:${emailClean}`;
          if (!clustersMap.has(key)) {
            clustersMap.set(key, { matchType: 'email', matchValue: emailClean, customerIds: new Set() });
          }
          clustersMap.get(key)!.customerIds.add(id);
        }

        // 3. Name cluster (> 4 chars, ignore placeholders)
        if (fullName.length >= 5 && !fullName.includes('esperando') && !fullName.includes('cliente')) {
          const key = `name:${fullName}`;
          if (!clustersMap.has(key)) {
            clustersMap.set(key, { matchType: 'name', matchValue: `${row.first_name || ''} ${row.last_name || ''}`.trim(), customerIds: new Set() });
          }
          clustersMap.get(key)!.customerIds.add(id);
        }
      }

      const customerMap = new Map(allCustomers.map((c) => [Number(c.id), c]));
      const duplicateGroups: Array<{
        clusterId: string;
        matchType: 'phone' | 'email' | 'name';
        matchValue: string;
        customers: Array<any>;
      }> = [];

      for (const [clusterId, cluster] of clustersMap.entries()) {
        if (cluster.customerIds.size >= 2) {
          const members = Array.from(cluster.customerIds).map((cid) => {
            const c = customerMap.get(cid)!;
            return {
              id: c.id,
              firstName: c.first_name,
              lastName: c.last_name,
              name: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
              phone: c.phone,
              whatsapp: c.whatsapp,
              email: c.email,
              addressShipping: c.address_shipping,
              zipCode: c.zip_code,
              company: c.company,
              type: c.type,
              createdAt: c.created_at,
              orderCount: Number(c.order_count) || 0,
              callCount: Number(c.call_count) || 0,
            };
          });

          // Sort members: customer with highest order count first
          members.sort((a, b) => b.orderCount - a.orderCount || a.id - b.id);

          duplicateGroups.push({
            clusterId,
            matchType: cluster.matchType,
            matchValue: cluster.matchValue,
            customers: members,
          });
        }
      }

      return sendJson(response, 200, duplicateGroups);
    }

    if (request.method === 'POST' && pathname === '/api/customers/merge') {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator')) return;
      const payload = customerMergeSchema.parse(await readBody(request));
      const { primaryId, duplicateIds, copyMissingFields } = payload;

      if (duplicateIds.includes(primaryId)) {
        return sendJson(response, 400, { message: 'El cliente principal no puede estar entre los duplicados' });
      }

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // 1. Verify primary customer
        const [primaryRows] = await connection.query<RowDataPacket[]>(
          'SELECT * FROM customers WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
          [primaryId]
        );
        const primary = primaryRows[0];
        if (!primary) {
          await connection.rollback();
          return sendJson(response, 404, { message: 'Cliente principal no encontrado o ya eliminado' });
        }

        // 2. Verify duplicate customers
        const [duplicateRows] = await connection.query<RowDataPacket[]>(
          'SELECT * FROM customers WHERE id IN (?) AND deleted_at IS NULL FOR UPDATE',
          [duplicateIds]
        );
        if (duplicateRows.length === 0) {
          await connection.rollback();
          return sendJson(response, 400, { message: 'Ninguno de los clientes a fusionar existe o ya fueron eliminados' });
        }

        // 3. Reassign orders to primary
        const [orderUpdate] = await connection.query<ResultSetHeader>(
          'UPDATE orders SET customer_id = ? WHERE customer_id IN (?)',
          [primaryId, duplicateIds]
        );

        // 4. Reassign call_register to primary
        const [callUpdate] = await connection.query<ResultSetHeader>(
          'UPDATE call_register SET customer_id = ? WHERE customer_id IN (?)',
          [primaryId, duplicateIds]
        );

        // 5. Fill missing fields in primary customer if requested
        if (copyMissingFields) {
          const updates: Record<string, string> = {};
          for (const dup of duplicateRows) {
            if (!primary.phone && dup.phone) updates.phone = dup.phone;
            if (!primary.whatsapp && dup.whatsapp) updates.whatsapp = dup.whatsapp;
            if (!primary.email && dup.email) updates.email = dup.email;
            if (!primary.address_shipping && dup.address_shipping) updates.address_shipping = dup.address_shipping;
            if (!primary.zip_code && dup.zip_code) updates.zip_code = dup.zip_code;
            if (!primary.company && dup.company) updates.company = dup.company;
            if (!primary.notes && dup.notes) updates.notes = dup.notes;
          }

          if (Object.keys(updates).length > 0) {
            const setClause = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
            const setVals = [...Object.values(updates), primaryId];
            await connection.query(`UPDATE customers SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, setVals);
          }
        }

        // 6. Soft-delete duplicate customer records
        await connection.query(
          'UPDATE customers SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id IN (?)',
          [duplicateIds]
        );

        // 7. Audit log
        void recordAuditLog(pool, {
          userId: Number(authenticatedClaims.sub),
          username: authenticatedClaims.email,
          action: 'CUSTOMER_MERGE',
          resourceType: 'customers',
          resourceId: primaryId,
          details: {
            primaryId,
            duplicateIds,
            ordersMoved: orderUpdate.affectedRows,
            callsMoved: callUpdate.affectedRows,
          },
        });

        await connection.commit();

        return sendJson(response, 200, {
          ok: true,
          primaryId,
          mergedCount: duplicateRows.length,
          ordersMoved: orderUpdate.affectedRows,
          callsMoved: callUpdate.affectedRows,
          message: `Se fusionaron ${duplicateRows.length} cliente(s) exitosamente en el cliente #${primaryId}`,
        });
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
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
        const [claimOrderState] = await connection.query<RowDataPacket[]>(
          `SELECT o.status, o.delivered_at, o.warranty_days, o.warranty_started,
            (SELECT MIN(so.created_at) FROM status_orders so
             WHERE so.order_id = o.id AND LOWER(so.status) = 'entregado') AS delivery_log_at
           FROM orders o WHERE o.id=? AND o.deleted_at IS NULL FOR UPDATE`,
          [orderIdVal],
        );
        if (!claimOrderState[0]) fail(404, 'Orden no encontrada');
        const deliveredAt = claimOrderState[0].delivered_at ?? claimOrderState[0].delivery_log_at;
        const warrantyError = getClaimWarrantyError({
          deliveredAt: deliveredAt ?? undefined,
          warrantyDays: Number(claimOrderState[0].warranty_days ?? 60),
          warrantyStarted: Boolean(
            claimOrderState[0].delivery_log_at ||
            (Number(claimOrderState[0].warranty_started) === 1 && deliveredAt)
          ),
        });
        if (warrantyError) fail(409, warrantyError);
        const [openClaims] = await connection.query<RowDataPacket[]>("SELECT id FROM claims WHERE order_id=? AND status IN ('Pending','In Process') AND deleted_at IS NULL", [orderIdVal]);
        if (openClaims.length) fail(409, 'La orden ya tiene un reclamo abierto');
        if (['reclamo', 'solicitud_reembolso', 'reembolsado', 'cancelado', 'archivado'].includes(statusFromDatabase(claimOrderState[0].status))) fail(409, 'La orden no permite abrir un reclamo en su estado actual');
        const [result] = await connection.execute<ResultSetHeader>(
          'INSERT INTO claims (order_id, description, status, assigned_user_id, previous_order_status) VALUES (?, ?, ?, ?, ?)',
          [orderIdVal, description, 'Pending', claim.assignedUserId || authenticatedClaims?.sub || null, claimOrderState[0].status]
        );
        await connection.execute(
          'UPDATE orders SET version=version+1, status = ?, claim_reason = ? WHERE id = ?',
          [statusToDatabase.reclamo, description, orderIdVal]
        );
        const currentUserId = Number(authenticatedClaims?.sub) || 1;
        await connection.execute(
          'INSERT INTO status_orders (order_id, status, description, user_id) VALUES (?, ?, ?, ?)',
          [orderIdVal, statusToDatabase.reclamo, `Reclamo REC-${result.insertId} registrado: ${description}`, currentUserId]
        );
        await connection.execute(
          "INSERT INTO audit_logs (user_id,action,resource_type,resource_id,details) VALUES (?,'CLAIM_CREATED','claim',?,?)",
          [authenticatedClaims?.sub, String(result.insertId), JSON.stringify(claim)],
        );
        // Fetch order details for notification
        const [claimOrderRows] = await connection.query<RowDataPacket[]>(
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

        await queueSystemNotification(connection, 'NUEVO_RECLAMO', claimMsg);
        await connection.commit();
        const claimsList = await getClaims();
        const createdClaim = claimsList.find(c => c.id === `REC-${result.insertId}`);
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
      const connection = await pool.getConnection();
      try {
      await connection.beginTransaction();
      const [claimRows] = await connection.query<RowDataPacket[]>('SELECT order_id, description FROM claims WHERE id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [cId]);
      if (!claimRows[0]) fail(404, 'Reclamo no encontrado');
      const ordId = claimRows[0].order_id;
      const origClaimReason = claimRows[0].description;

      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO call_register (order_id, claim_id, caller_name, caller_phone, attended_by, conversation_summary, whatsapp_dispatched, whatsapp_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [ordId, cId, callData.callerName || null, callData.callerPhone || null, callData.attendedBy || null, callData.conversationSummary, callData.whatsappDispatched ? 1 : 0, callData.whatsappMessage || null]
      );

      // Count total calls for this claim
      const [callCountRows] = await connection.query<RowDataPacket[]>(
        'SELECT COUNT(id) AS total_calls FROM call_register WHERE claim_id = ? AND deleted_at IS NULL',
        [cId]
      );
      const callNumber = Number(callCountRows[0]?.total_calls || 1);

      // Fetch order details for notification
      const [ordRows] = await connection.query<RowDataPacket[]>(
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

      await queueSystemNotification(connection, 'SEGUIMIENTO_RECLAMO', followupMsg);
      await connection.execute(
        "INSERT INTO audit_logs (user_id,action,resource_type,resource_id,details) VALUES (?,'CLAIM_CALL_CREATED','claim',?,?)",
        [authenticatedClaims?.sub, cId, JSON.stringify(callData)],
      );
      await connection.commit();
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
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally { connection.release(); }
    }

    if (request.method === 'PUT' && claimId) {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator')) return;
      const claim = claimUpdateSchema.parse(await readBody(request));
      const status = String(claim.status || '').trim();

      const [existingClaims] = await pool.query<RowDataPacket[]>('SELECT id, order_id, status FROM claims WHERE id = ? AND deleted_at IS NULL LIMIT 1', [claimId]);
      if (!existingClaims[0]) return sendJson(response, 404, { message: 'Reclamo no encontrado' });
      const targetOrderId = existingClaims[0].order_id;
      if (claim.orderId && Number(claim.orderId) !== Number(targetOrderId)) fail(400, 'El reclamo no pertenece a esa orden');

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [lockedOrders] = await connection.query<RowDataPacket[]>('SELECT * FROM orders WHERE id=? FOR UPDATE', [targetOrderId]);
        const [lockedClaims] = await connection.query<RowDataPacket[]>('SELECT * FROM claims WHERE id=? FOR UPDATE', [claimId]);
        const storedClaim = lockedClaims[0];
        if (storedClaim.status === status) {
          await connection.rollback();
          return sendJson(response, 200, { id: `REC-${claimId}`, status });
        }
        if (['Resolved', 'Denied'].includes(storedClaim.status) && storedClaim.status !== status) fail(409, 'El reclamo cerrado no se puede reabrir');
        const closing = status === 'Resolved' || status === 'Denied';
        await connection.execute(
          'UPDATE claims SET status=?, resolution_notes=?, resolved_by=?, resolved_at=IF(?,UTC_TIMESTAMP(),NULL), updated_at=CURRENT_TIMESTAMP WHERE id=?',
          [status, claim.resolutionNotes || null, closing ? Number(authenticatedClaims?.sub) : null, closing, claimId],
        );

        const currentUserId = Number(authenticatedClaims?.sub) || 1;
        if (closing && storedClaim.status !== status && targetOrderId) {
          let previousStatus = storedClaim.previous_order_status;
          if (!previousStatus) {
            const [history] = await connection.query<RowDataPacket[]>(
              "SELECT status FROM status_orders WHERE order_id=? AND created_at<=? AND status NOT IN ('Reclamo','reclamo') ORDER BY created_at DESC,id DESC LIMIT 1",
              [targetOrderId, storedClaim.created_at],
            );
            previousStatus = history[0]?.status;
          }
          if (!previousStatus) fail(409, 'El reclamo histórico no tiene un estado anterior verificable; requiere revisión manual');
          if (statusFromDatabase(lockedOrders[0]?.status || '') !== 'reclamo') fail(409, 'La orden cambió de estado; revisa la incidencia antes de cerrarla');
          if (authenticatedClaims) await recordWorkflowReopening(connection, lockedOrders[0], statusFromDatabase(previousStatus), authenticatedClaims);
          await connection.execute(
            'UPDATE orders SET version=version+1, status = ?, claim_reason = NULL WHERE id = ?',
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

        await connection.execute(
          "INSERT INTO audit_logs (user_id,action,resource_type,resource_id,details) VALUES (?,'CLAIM_UPDATED','claim',?,?)",
          [authenticatedClaims?.sub, claimId, JSON.stringify({ before: storedClaim, after: claim })],
        );
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
        paymentMethod: ({zelle:'Zelle',cashapp:'CashApp',cash:'Efectivo'} as Record<string,string>)[row.payment_method] || row.payment_method,
        paymentDetails: row.payment_contact || row.payment_details || '',
        status: row.status || 'pending',
        reviewStage: row.review_stage || undefined,
        refundScope: row.refund_scope || 'purchase',
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
        const replayId = await beginIdempotentRequest(connection, 'refund', refund.idempotencyKey, Number(authenticatedClaims?.sub), refund);
        if (replayId) {
          const [replay] = await connection.query<RowDataPacket[]>('SELECT * FROM refund_requests WHERE id=?', [replayId]);
          await connection.rollback();
          return sendJson(response, 200, { id:`REF-${replayId}`, orderId:String(replay[0].order_id), status:replay[0].status, amount:Number(replay[0].amount) });
        }

        // 1. Resolve actual order row by PK id or order_code
        const [targetOrderRows] = await connection.query<RowDataPacket[]>(
          `SELECT o.*,
                  c.first_name, c.last_name, c.phone AS customer_phone,
                  u.name AS advisor_name
           FROM orders o
           LEFT JOIN customers c ON c.id = o.customer_id
           LEFT JOIN users u ON u.id = o.user_id
           WHERE o.id = ? AND o.deleted_at IS NULL
           LIMIT 1 FOR UPDATE`,
          [refund.orderId]
        );
        const refundOrder = targetOrderRows[0];
        if (!refundOrder) fail(404, 'Orden no encontrada');
        const actualOrderId = Number(refundOrder.id);
        const [duplicate] = await connection.query<RowDataPacket[]>('SELECT * FROM refund_requests WHERE idempotency_key=?', [refund.idempotencyKey]);
        if (duplicate[0]) {
          if (Number(duplicate[0].order_id) !== actualOrderId || cents(duplicate[0].amount) !== cents(refund.amount)) fail(409, 'La clave ya se utilizó para otra solicitud');
          await connection.rollback();
          return sendJson(response, 200, { id: `REF-${duplicate[0].id}`, orderId: String(actualOrderId), status: duplicate[0].status, amount: Number(duplicate[0].amount) });
        }
        if (['reclamo','archivado','reembolsado'].includes(statusFromDatabase(refundOrder.status))) fail(409, 'La orden no permite una devolución en su estado actual');
        const [pendingRefunds] = await connection.query<RowDataPacket[]>("SELECT id FROM refund_requests WHERE order_id=? AND status='pending'", [actualOrderId]);
        if (pendingRefunds.length) fail(409, 'Ya existe una solicitud pendiente para esta orden');
        const [previousRefunds] = await connection.query<RowDataPacket[]>(
          "SELECT COALESCE(SUM(amount),0) AS reserved FROM refund_requests WHERE order_id=? AND status IN ('pending','completed')", [actualOrderId],
        );
        if (cents(refund.amount) + cents(previousRefunds[0].reserved) > cents(refundOrder.down_payment)) fail(400, 'El reembolso excede el dinero cobrado disponible');

        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO refund_requests (order_id, amount, amount_type, payment_method, payment_contact, reason, status, requested_by, previous_order_status, idempotency_key)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
          [actualOrderId, refund.amount, refund.amountType, refund.paymentMethod, refund.paymentDetails || null, refund.reason, authenticatedClaims?.sub, refundOrder.status, refund.idempotencyKey]
        );
        await connection.execute(
          'UPDATE orders SET version=version+1, status = ? WHERE id = ?',
          [statusToDatabase.solicitud_reembolso, actualOrderId]
        );
        const currentUserId = Number(authenticatedClaims?.sub) || 1;
        await connection.execute(
          'INSERT INTO status_orders (order_id, status, description, user_id) VALUES (?, ?, ?, ?)',
          [actualOrderId, statusToDatabase.solicitud_reembolso, `Solicitud de reembolso REF-${result.insertId} registrada por $${refund.amount}`, currentUserId]
        );
        await finishIdempotentRequest(connection, 'refund', refund.idempotencyKey, result.insertId);
        await connection.execute(
          "INSERT INTO audit_logs (user_id,action,resource_type,resource_id,details) VALUES (?,'REFUND_CREATED','refund',?,?)",
          [authenticatedClaims?.sub, String(result.insertId), JSON.stringify(refund)],
        );
        const beneficiaryName = [refundOrder?.first_name, refundOrder?.last_name].filter(Boolean).join(' ') || 'Cliente / Beneficiario';

        const refundMsg = formatSolicitudReembolsoMessage({
          orderCode: refundOrder?.order_code || `ORD-${actualOrderId}`,
          beneficiaryName,
          amount: refund.amount,
          reason: refund.reason,
        });

        await queueSystemNotification(connection, 'SOLICITUD_REEMBOLSO', refundMsg);
        await connection.commit();
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
        const [lockedOrder] = await connection.query<RowDataPacket[]>('SELECT * FROM orders WHERE id=? FOR UPDATE', [orderIdVal]);
        const [lockedRefund] = await connection.query<RowDataPacket[]>('SELECT * FROM refund_requests WHERE id=? FOR UPDATE', [refundId]);
        const refundRow = lockedRefund[0];
        if (refundRow.status === refund.status) {
          await connection.rollback();
          return sendJson(response, 200, { id: `REF-${refundId}`, status: refund.status });
        }
        if (refundRow.status !== 'pending' || refund.status === 'pending') fail(409, 'Una devolución finalizada no se puede reabrir');
        if (refund.status === 'completed') {
          const [totalRefunds] = await connection.query<RowDataPacket[]>("SELECT COALESCE(SUM(amount),0) AS amount FROM refund_requests WHERE order_id=? AND status='completed'", [orderIdVal]);
          if (cents(totalRefunds[0].amount) + cents(refundRow.amount) > cents(lockedOrder[0].down_payment)) fail(409, 'El dinero cobrado ya no cubre este reembolso');
          await connection.execute(
            "INSERT INTO finance_movements (order_id,kind,amount,effective_at,source,reference_key,user_id) VALUES (?,'refund',?,UTC_TIMESTAMP(),'refund',?,?)",
            [orderIdVal, refundRow.amount, `refund-${refundId}`, authenticatedClaims?.sub],
          );
        }
        const completedByUserId = Number(authenticatedClaims?.sub) || null;
        await connection.execute(
          `UPDATE refund_requests SET status = ?, completed_by = ?, completed_at = ${refund.status === 'completed' ? 'CURRENT_TIMESTAMP' : 'NULL'}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [refund.status, completedByUserId, refundId]
        );

        if (refund.status === 'completed' && orderIdVal) {
          const [refunded] = await connection.query<RowDataPacket[]>("SELECT SUM(amount) AS amount FROM refund_requests WHERE order_id=? AND status='completed'", [orderIdVal]);
          const fullyRefunded = cents(refunded[0].amount) >= cents(lockedOrder[0].down_payment);
          const previousStatus = refundRow.previous_order_status;
          const restoredStatus = fullyRefunded ? statusToDatabase.reembolsado :
            statusFromDatabase(previousStatus || '') === 'pagado' ? statusToDatabase.espera_confirmacion : previousStatus;
          if (!restoredStatus) fail(409, 'La devolución histórica no tiene estado anterior verificable');
          if (authenticatedClaims) await recordWorkflowReopening(connection, lockedOrder[0], statusFromDatabase(restoredStatus), authenticatedClaims);
          await connection.execute('UPDATE orders SET version=version+1,status=? WHERE id=?', [restoredStatus, orderIdVal]);
          const currentUserId = Number(authenticatedClaims?.sub) || 1;
          await connection.execute(
            'INSERT INTO status_orders (order_id, status, description, user_id) VALUES (?, ?, ?, ?)',
            [orderIdVal, restoredStatus, `Reembolso REF-${refundId} completado por $${refundRow.amount}.`, currentUserId]
          );
        } else if (refund.status === 'cancelled') {
          if (!refundRow.previous_order_status) fail(409, 'La devolución histórica requiere revisión: no tiene estado anterior verificable');
          if (authenticatedClaims) await recordWorkflowReopening(connection, lockedOrder[0], statusFromDatabase(refundRow.previous_order_status), authenticatedClaims);
          await connection.execute('UPDATE orders SET version=version+1,status=? WHERE id=?', [refundRow.previous_order_status, orderIdVal]);
        }
        await connection.execute(
          "INSERT INTO audit_logs (user_id,action,resource_type,resource_id,details) VALUES (?,'REFUND_UPDATED','refund',?,?)",
          [authenticatedClaims?.sub, refundId, JSON.stringify({ before: refundRow, status: refund.status })],
        );
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
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator', 'vendedor_yarda')) return;
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
      const passwordHash = await bcrypt.hash(userData.password, 12);
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
        const params: (string | number | null)[] = [
          user.name,
          user.email.toLowerCase(),
          user.phone ? user.phone.trim() : null,
          user.avatar_url ? user.avatar_url.trim() : null,
          user.role,
          JSON.stringify(user.permissions),
          user.active ? 1 : 0,
        ];
        if (user.password && user.password.trim()) {
          const hash = await bcrypt.hash(user.password, 12);
          passwordUpdateClause = ', password = ?, password_changed_at = CURRENT_TIMESTAMP';
          params.push(hash);
        }
        params.push(userId);

        await pool.execute(
          `UPDATE users SET name = ?, email = ?, phone = ?, avatar_url = ?, role = ?, permissions = ?, active = ? ${passwordUpdateClause}, session_version=session_version+1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL`,
          params
        );
      } catch (error) {
        if (typeof error === 'object' && error && 'code' in error && error.code === 'ER_DUP_ENTRY') {
          return sendJson(response, 409, { message: 'El correo ya está asociado a otro usuario' });
        }
        throw error;
      }
      revokeFinanceVaults(userId);
      if (activeFinancial2FA?.requestedByUserId === Number(userId)) activeFinancial2FA = null;
      if (String(authenticatedClaims.sub) === userId) {
        lockFinanceVault(request, response);
        const token = jwt.sign({ sub: userId, role: user.role, email: user.email.toLowerCase(),
          sessionVersion: Number(authenticatedClaims.sessionVersion) + 1 }, jwtSecret, { expiresIn: '8h' });
        setSessionCookie(response, token);
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
      revokeFinanceVaults(userId);
      if (activeFinancial2FA?.requestedByUserId === Number(userId)) activeFinancial2FA = null;
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
    // YARD CASH RECEIVERS (AUTHORIZED YARD EMPLOYEES FOR CASH DELIVERIES)
    // Stored in finance_state (id = 2) so runtime DB user only needs DML privileges
    // ==========================================
    type StoredYardReceiver = {
      id: number;
      name: string;
      roleLabel: string;
      active: boolean;
      createdAt: string;
      updatedAt: string;
    };

    const parseYardReceiversPayload = (payload: unknown): StoredYardReceiver[] => {
      let raw: unknown = payload;
      if (typeof payload === 'string') {
        try {
          raw = JSON.parse(payload);
        } catch {
          raw = [];
        }
      }
      const list = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && Array.isArray((raw as { receivers?: unknown[] }).receivers)
        ? (raw as { receivers: unknown[] }).receivers
        : [];
      return list
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map((r) => ({
          id: Number(r.id) || 0,
          name: String(r.name || '').trim().slice(0, 200),
          roleLabel: r.roleLabel ? String(r.roleLabel).trim().slice(0, 120) : 'Personal de Yarda',
          active: Boolean(r.active),
          createdAt: String(r.createdAt || new Date().toISOString()),
          updatedAt: String(r.updatedAt || new Date().toISOString()),
        }))
        .filter((r) => r.id > 0 && r.name.length >= 2)
        .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
    };

    const loadYardCashReceivers = async (): Promise<StoredYardReceiver[]> => {
      await pool.execute(
        "INSERT IGNORE INTO finance_state (id, version, payload) VALUES (2, 1, '[]')"
      );
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT payload FROM finance_state WHERE id = 2 LIMIT 1'
      );
      if (!rows[0]) return [];
      return parseYardReceiversPayload(rows[0].payload);
    };

    if (request.method === 'GET' && pathname === '/api/yard-cash-receivers') {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator', 'vendedor_yarda')) return;
      const list = await loadYardCashReceivers();
      return sendJson(response, 200, list);
    }

    if (request.method === 'POST' && pathname === '/api/yard-cash-receivers') {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const body = z.object({
        name: z.string().trim().min(2, 'Ingresa al menos 2 caracteres').max(200),
        roleLabel: z.string().trim().max(120).optional().default('Personal de Yarda'),
        active: z.boolean().optional().default(true),
      }).strict().parse(await readBody(request));

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute("INSERT IGNORE INTO finance_state (id, version, payload) VALUES (2, 1, '[]')");
        const [rows] = await connection.query<RowDataPacket[]>(
          'SELECT payload FROM finance_state WHERE id = 2 LIMIT 1 FOR UPDATE'
        );
        const list = rows[0] ? parseYardReceiversPayload(rows[0].payload) : [];
        if (list.length >= 200) fail(400, 'Se alcanzó el límite máximo de empleados de yarda registrados.');
        if (list.some((item) => item.name.toLowerCase() === body.name.toLowerCase())) {
          fail(409, 'Ya existe un empleado de yarda registrado con ese nombre.');
        }
        const nextId = list.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
        const now = new Date().toISOString();
        const created: StoredYardReceiver = {
          id: nextId,
          name: body.name,
          roleLabel: body.roleLabel || 'Personal de Yarda',
          active: Boolean(body.active),
          createdAt: now,
          updatedAt: now,
        };
        const nextList = [...list, created];
        await connection.execute(
          'UPDATE finance_state SET payload = ?, version = version + 1 WHERE id = 2',
          [JSON.stringify(nextList)]
        );
        await connection.commit();
        void recordAuditLog(pool, {
          userId: Number(authenticatedClaims.sub),
          username: authenticatedClaims.email,
          action: 'YARD_RECEIVER_CREATED',
          resourceType: 'yard_receiver',
          resourceId: String(created.id),
          details: { name: created.name, roleLabel: created.roleLabel, active: created.active },
          ipAddress: clientAddress(request),
          userAgent: request.headers['user-agent'] || null,
        });
        return sendJson(response, 201, created);
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    }

    const yardReceiverId = pathname.match(/^\/api\/yard-cash-receivers\/(\d+)$/)?.[1];
    if (request.method === 'PUT' && yardReceiverId) {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const body = z.object({
        name: z.string().trim().min(2).max(200).optional(),
        roleLabel: z.string().trim().max(120).optional(),
        active: z.boolean().optional(),
      }).strict().parse(await readBody(request));

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute("INSERT IGNORE INTO finance_state (id, version, payload) VALUES (2, 1, '[]')");
        const [rows] = await connection.query<RowDataPacket[]>(
          'SELECT payload FROM finance_state WHERE id = 2 LIMIT 1 FOR UPDATE'
        );
        const list = rows[0] ? parseYardReceiversPayload(rows[0].payload) : [];
        const idx = list.findIndex((item) => item.id === Number(yardReceiverId));
        if (idx === -1) {
          await connection.rollback();
          return sendJson(response, 404, { message: 'Empleado de yarda no encontrado' });
        }
        if (
          body.name !== undefined &&
          list.some((item, i) => i !== idx && item.name.toLowerCase() === body.name!.toLowerCase())
        ) {
          fail(409, 'Ya existe otro empleado de yarda con ese nombre.');
        }
        const updated: StoredYardReceiver = {
          ...list[idx],
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.roleLabel !== undefined ? { roleLabel: body.roleLabel || 'Personal de Yarda' } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
          updatedAt: new Date().toISOString(),
        };
        const nextList = list.map((item, i) => (i === idx ? updated : item));
        await connection.execute(
          'UPDATE finance_state SET payload = ?, version = version + 1 WHERE id = 2',
          [JSON.stringify(nextList)]
        );
        await connection.commit();
        void recordAuditLog(pool, {
          userId: Number(authenticatedClaims.sub),
          username: authenticatedClaims.email,
          action: 'YARD_RECEIVER_UPDATED',
          resourceType: 'yard_receiver',
          resourceId: String(updated.id),
          details: { before: list[idx], after: updated },
          ipAddress: clientAddress(request),
          userAgent: request.headers['user-agent'] || null,
        });
        return sendJson(response, 200, updated);
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    }

    if (request.method === 'DELETE' && yardReceiverId) {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute("INSERT IGNORE INTO finance_state (id, version, payload) VALUES (2, 1, '[]')");
        const [rows] = await connection.query<RowDataPacket[]>(
          'SELECT payload FROM finance_state WHERE id = 2 LIMIT 1 FOR UPDATE'
        );
        const list = rows[0] ? parseYardReceiversPayload(rows[0].payload) : [];
        const target = list.find((item) => item.id === Number(yardReceiverId));
        if (!target) {
          await connection.rollback();
          return sendJson(response, 404, { message: 'Empleado de yarda no encontrado' });
        }
        const nextList = list.filter((item) => item.id !== Number(yardReceiverId));
        await connection.execute(
          'UPDATE finance_state SET payload = ?, version = version + 1 WHERE id = 2',
          [JSON.stringify(nextList)]
        );
        await connection.commit();
        void recordAuditLog(pool, {
          userId: Number(authenticatedClaims.sub),
          username: authenticatedClaims.email,
          action: 'YARD_RECEIVER_DELETED',
          resourceType: 'yard_receiver',
          resourceId: String(yardReceiverId),
          details: { deleted: target },
          ipAddress: clientAddress(request),
          userAgent: request.headers['user-agent'] || null,
        });
        return sendJson(response, 200, { ok: true, id: Number(yardReceiverId) });
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    }

    // ==========================================
    // INVENTORY (HOLD & STOCK PARTS)
    // ==========================================
    if (request.method === 'GET' && pathname === '/api/inventory/export.csv') {
      const url = new URL(request.url || '/', 'http://localhost');
      const filters = z.object({
        query: z.string().max(500),
        type: z.enum(['all', 'Motor', 'Transmisión', 'Transfer Case', 'Diferencial']),
        status: z.enum(['all', 'disponible', 'reservado', 'vendido', 'en_revision']),
      }).parse({
        query: url.searchParams.get('query') || '',
        type: url.searchParams.get('type') || 'all',
        status: url.searchParams.get('status') || 'all',
      });
      const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM inventory_parts WHERE deleted_at IS NULL ORDER BY id');
      const parts = filterInventory(rows.map(mapInventoryPartRow), filters);
      response.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="inventario-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      });
      response.end(inventoryCsv(parts, authenticatedClaims?.role === 'admin'));
      return;
    }
    if (request.method === 'GET' && pathname === '/api/inventory') {
      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT * FROM inventory_parts
        WHERE deleted_at IS NULL
        ORDER BY created_at DESC
      `);
      return sendJson(response, 200, rows.map(row => inventoryForRole(row, authenticatedClaims?.role)));
    }

    if (request.method === 'POST' && pathname === '/api/inventory') {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator', 'vendedor_yarda')) return;
      const payload = inventoryPartSchema.parse(await readBody(request));
      if (payload.cost !== undefined && !requireRole(response, authenticatedClaims, 'admin')) return;
      const isSold = (payload.status || 'disponible').toLowerCase() === 'vendido';
      const soldAtValue = payload.soldAt !== undefined
        ? (payload.soldAt ? new Date(payload.soldAt) : null)
        : (isSold ? new Date() : null);
      
      const [result] = await pool.execute<ResultSetHeader>(`
        INSERT INTO inventory_parts (
          year, year_from, year_to, is_exact_year_only, brand, model, part_type, vin, pallet_number, engine_specs, status, notes, sold_at,price,cost
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?,?)
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
        payload.price ?? 0,
        payload.cost ?? 0,
      ]);

      const [createdRows] = await pool.query<RowDataPacket[]>('SELECT * FROM inventory_parts WHERE id = ?', [result.insertId]);
      broadcastRealtimeEvent('inventory:updated', { partId: result.insertId });
      return sendJson(response, 201, inventoryForRole(createdRows[0], authenticatedClaims?.role));
    }

    const inventoryIdMatch = pathname.match(/^\/api\/inventory\/(\d+)$/);
    if (inventoryIdMatch && request.method === 'GET') {
      const partId = Number(inventoryIdMatch[1]);
      const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM inventory_parts WHERE id = ? AND deleted_at IS NULL', [partId]);
      if (rows.length === 0) return sendJson(response, 404, { message: 'Pieza de inventario no encontrada' });
      return sendJson(response, 200, inventoryForRole(rows[0], authenticatedClaims?.role));
    }

    if (inventoryIdMatch && request.method === 'PUT') {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator', 'vendedor_yarda')) return;
      const partId = Number(inventoryIdMatch[1]);
      const payload = inventoryPartUpdateSchema.parse(await readBody(request));
      if (payload.cost !== undefined && !requireRole(response, authenticatedClaims, 'admin')) return;
      const [linked] = await pool.query<RowDataPacket[]>(
        "SELECT id FROM orders WHERE inventory_part_id=? AND deleted_at IS NULL AND status NOT IN ('Cancelado','Reembolsado') LIMIT 1", [partId],
      );
      if (linked.length && (payload.status !== undefined || payload.soldAt !== undefined)) fail(409, 'El estado de esta pieza lo controla la orden vinculada');
      
      const updates: string[] = [];
      const values: any[] = [];
      
      if (payload.year !== undefined) { updates.push('year = ?'); values.push(payload.year); }
      if (payload.price !== undefined) { updates.push('price = ?'); values.push(payload.price); }
      if (payload.cost !== undefined) { updates.push('cost = ?'); values.push(payload.cost); }
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
      broadcastRealtimeEvent('inventory:updated', { partId });
      return sendJson(response, 200, inventoryForRole(updatedRows[0], authenticatedClaims?.role));
    }

    if (inventoryIdMatch && request.method === 'DELETE') {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const partId = Number(inventoryIdMatch[1]);
      const [result] = await pool.execute<ResultSetHeader>(
        "UPDATE inventory_parts SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM orders WHERE inventory_part_id=inventory_parts.id AND deleted_at IS NULL AND status NOT IN ('Cancelado','Reembolsado'))",
        [partId]
      );
      if (result.affectedRows === 0) return sendJson(response, 409, { message: 'La pieza no existe o está vinculada a una orden activa' });
      broadcastRealtimeEvent('inventory:updated', { partId });
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
    // BACKUPS DOWNLOAD (PUBLIC SECURE ACCESS FOR WHATSAPP NOTIFICATIONS)
    // ==========================================
    const isBackupDownloadRoute =
      (request.method === 'GET' || request.method === 'HEAD') &&
      (pathname.startsWith('/api/uploads/backups/') || pathname.startsWith('/uploads/backups/'));

    if (isBackupDownloadRoute) {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const rawFilename = pathname.replace(/^(\/api)?\/uploads\/backups\//, '');
      const filename = path.basename(decodeURIComponent(rawFilename));
      if (!/^[a-zA-Z0-9_.-]+\.sql(?:\.gz)?$/.test(filename)) {
        return sendJson(response, 400, { message: 'Formato de archivo de respaldo inválido' });
      }

      let filePath = path.resolve(process.cwd(), 'backups', filename);
      if (!existsSync(filePath)) {
        filePath = path.resolve(process.cwd(), 'uploads', 'backups', filename);
      }

      if (!existsSync(filePath)) {
        // Si no está en disco (ej. contenedor Docker recreado), reconstruir desde la base de datos
        const reconstructedPath = await ensureBackupFileOnDisk(filename);
        if (reconstructedPath && existsSync(reconstructedPath)) {
          filePath = reconstructedPath;
        } else {
          return sendJson(response, 404, { message: 'Archivo de respaldo no encontrado o expirado' });
        }
      }

      const stat = statSync(filePath);
      const isGz = filename.endsWith('.gz');

      response.writeHead(200, {
        'Content-Type': isGz ? 'application/gzip' : 'application/sql; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': stat.size,
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      createReadStream(filePath).pipe(response);
      return;
    }

    // ==========================================
    // UPLOADS & FILE SERVING
    // ==========================================
    if (['GET', 'HEAD'].includes(request.method || '') && pathname.startsWith('/uploads/')) {
      const filename = path.basename(pathname);
      const filePath = path.resolve(process.cwd(), 'uploads', filename);
      if (!existsSync(filePath)) {
        return sendJson(response, 404, { message: 'Archivo no encontrado' });
      }
      const ext = path.extname(filename).toLowerCase();
      const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);

      // Sensitive non-image files (e.g. PDFs, documents) require authentication and order access check
      if (!isImage) {
        if (!authenticatedClaims) {
          return sendJson(response, 401, { message: 'Autenticación requerida' });
        }
        const [attachedOrders] = await pool.query<RowDataPacket[]>(
          `SELECT o.user_id,o.delivered_at,
            (SELECT MIN(created_at) FROM status_orders WHERE order_id=o.id AND LOWER(status)='entregado') AS delivery_log_at,
            (SELECT advisor_id FROM order_followup_assignments WHERE order_id=o.id) AS followup_user_id
            FROM uploaded_files f JOIN orders o ON o.id=f.order_id WHERE f.filename=?`, [filename]);
        if (attachedOrders[0] && !roleIs(authenticatedClaims, 'admin', 'operator', 'vendedor_yarda')) {
          assertPaymentAccess(attachedOrders[0], authenticatedClaims, true);
        }
      }

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
        'Cache-Control': isImage ? 'public, max-age=86400, stale-while-revalidate=604800' : 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `${isImage ? 'inline' : 'attachment'}; filename="${filename.replace(/"/g, '')}"`,
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      createReadStream(filePath).pipe(response);
      return;
    }

    if (request.method === 'POST' && pathname === '/api/upload') {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator', 'vendedor_yarda')) return;
      const data = uploadPayloadSchema.parse(await readBody(request, 15 * 1024 * 1024));
      if (data.orderId) {
        const [orders] = await pool.query<RowDataPacket[]>(`SELECT o.user_id,o.delivered_at,
          (SELECT MIN(created_at) FROM status_orders WHERE order_id=o.id AND LOWER(status)='entregado') AS delivery_log_at,
          (SELECT advisor_id FROM order_followup_assignments WHERE order_id=o.id) AS followup_user_id
          FROM orders o WHERE o.id=? AND o.deleted_at IS NULL`, [data.orderId]);
        if (!orders[0]) return sendJson(response, 404, { message: 'Orden no encontrada' });
        assertPaymentAccess(orders[0], authenticatedClaims!, true);
      } else if (authenticatedClaims?.role === 'vendedor_yarda') {
        return sendJson(response, 403, { message: 'Selecciona una orden asignada para adjuntar el comprobante.' });
      }
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
      const uniqueName = `${Date.now()}-${crypto.randomBytes(16).toString('hex')}-${safeBaseName.slice(-180)}`;
      const targetPath = path.join(uploadDir, uniqueName);
      await fs.writeFile(targetPath, buffer, { mode: 0o600, flag: 'wx' });
      try {
        await pool.execute(
          'INSERT INTO uploaded_files (filename,original_name,content_type,size_bytes,user_id,order_id) VALUES (?,?,?,?,?,?)',
          [uniqueName, data.filename, data.contentType, buffer.length, authenticatedClaims?.sub, data.orderId || null],
        );
      } catch (error) {
        await fs.unlink(targetPath);
        throw error;
      }

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
        sessionName: process.env.WASENDER_SESSION_NAME || null,
        connectedPhone: process.env.WASENDER_CONNECTED_PHONE || null,
        accountName: process.env.BUSINESS_NAME || null,
        service: 'WasenderAPI (wasenderapi.com)',
      });
    }

    if (request.method === 'POST' && pathname === '/api/wasender/test-ping') {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator')) return;
      const body = z.object({
        message: z.string().trim().min(1).max(5000).optional(),
        phone: z.string().trim().regex(/^\+?[\d ()-]{7,40}$/).optional(),
      }).parse(await readBody(request));
      const targetPhone = body.phone || wasender.designatedTestPhone;
      if (!targetPhone) return sendJson(response, 400, { message: 'Indica un telefono de prueba' });
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
          downloadUrl: 'https://radar-rsy.store/api/uploads/backups/backup_2026-10-12_434df2a7f1ccfe86.sql.gz',
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
    const databaseCode = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
    if (['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ER_CHECKREAD'].includes(databaseCode)) {
      console.warn('[Conflict] La escritura no pudo completarse:', databaseCode);
      return sendJson(response, 409, { message: 'Conflicto de escritura o registro duplicado. Recarga los datos antes de volver a guardar' });
    }
    const statusCode = error instanceof z.ZodError
      ? 400
      : typeof error === 'object' && error && 'statusCode' in error
      ? Number((error as { statusCode?: number }).statusCode)
      : 500;
    if (statusCode >= 500) {
      console.error('[RequestFailure]', {
        path: pathname.slice(0, 200),
        code: databaseCode || 'INTERNAL_ERROR',
        error: error instanceof Error ? error.stack || error.message : error,
      });
    }
    return sendJson(response, statusCode >= 400 && statusCode < 500 ? statusCode : 500, {
      message: error instanceof z.ZodError
        ? `Payload inválido: ${error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        : statusCode >= 400 && statusCode < 500 && error instanceof Error
          ? error.message
        : 'No fue posible completar la solicitud',
    });
  }
});

async function startServer() {
  const [migrations] = await pool.query<RowDataPacket[]>(
    'SELECT name FROM schema_migrations WHERE name=?', ['021_outbox_deduplication.sql'],
  );
  if (!migrations.length) throw new Error('Ejecuta scripts/migrate.ts antes de iniciar la aplicación');
  // Asegurar que ninguna orden entregada conserve la marca de subasta activa
  await pool.query("UPDATE orders SET auction_search_active = 0 WHERE LOWER(TRIM(status)) = 'entregado' OR delivered_at IS NOT NULL").catch((err) => {
    console.error('[Startup] Advertencia al limpiar auction_search_active en entregadas:', err);
  });
  // Asegurar que registros de exoneración en order_workflow_events tengan downpayment_details en NULL
  await pool.query("UPDATE order_workflow_events SET downpayment_details = NULL WHERE downpayment_details LIKE '%\"amount\":0%' OR downpayment_details LIKE '%Exonerado%'").catch((err) => {
    console.error('[Startup] Advertencia al sanear downpayment_details en eventos:', err);
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`RADAR API disponible en http://0.0.0.0:${port}`);
    startDailyClaimsReportScheduler(pool, wasender);
    startDailyBackupScheduler(pool, wasender);
    startNotificationOutbox(pool, wasender);
  });
}
startServer().catch(error => {
  console.error('[Startup] No se inició la aplicación:', error);
  process.exitCode = 1;
  void pool.end();
});