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
  wasenderDispatchSchema,
  backupRestoreSchema,
  backupSnapshotCreateSchema,
} from './src/server/schemas';
import { readBody, sendJson, serveFrontend } from './src/server/http';
import { getOrders, mapOrder, statusFromDatabase, statusToDatabase, toMysqlDateTime } from './src/server/orders';
import { getClaims } from './src/server/claims';
import {
  createDatabaseBackup,
  listBackups,
  saveBackupSnapshot,
  restoreDatabaseBackup,
  getBackupFileContent,
} from './src/server/backup';
import { getMessageUsers, getPersonalMessages, getPersonalNote, markPersonalMessageRead, savePersonalNote, sendPersonalMessage } from './src/server/notes';
import { wasender } from './src/integrations/wasender/client';

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

createServer(async (request, response) => {
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
      if (isLoginRateLimited(ip)) return sendJson(response, 429, { message: 'Demasiados intentos. Intenta más tarde.' });
      const credentials = loginSchema.parse(await readBody(request));
      const email = credentials.email.toLowerCase();
      const password = credentials.password;
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id, name, email, role, permissions, theme, active, password FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1',
        [email]
      );
      const user = rows[0];
      const validPassword = user ? await bcrypt.compare(password, String(user.password || '')) : false;
      if (!user || !validPassword || !user.active) {
        recordLoginFailure(ip);
        return sendJson(response, 401, { message: 'Correo o contraseña incorrectos' });
      }
      resetLoginAttempts(ip);
      const token = jwt.sign({ sub: user.id, role: user.role, email: user.email }, jwtSecret, { expiresIn: '8h' });
      setSessionCookie(response, token);
      return sendJson(response, 200, {
        user: { id: user.id, name: user.name, email: user.email, role: user.role, permissions: parsePermissions(user.permissions), theme: user.theme },
      });
    }

    if (request.method === 'POST' && pathname === '/api/auth/logout') {
      clearSessionCookie(response);
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === 'GET' && pathname === '/api/auth/me') {
      const claims = verifyToken(request);
      if (!claims?.sub) return sendJson(response, 401, { message: 'Sesión no válida' });
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id, name, email, role, permissions, theme, active FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
        [claims.sub]
      );
      return rows[0]?.active
        ? sendJson(response, 200, { user: { ...rows[0], permissions: parsePermissions(rows[0].permissions) } })
        : sendJson(response, 401, { message: 'Usuario inactivo' });
    }

    const authenticatedClaims = pathname.startsWith('/api/') ? verifyToken(request) as Claims | null : null;
    if (pathname.startsWith('/api/') && !authenticatedClaims) {
      return sendJson(response, 401, { message: 'Autenticación requerida' });
    }

    if (authenticatedClaims?.sub) {
      if (!await userIsActive(authenticatedClaims)) return sendJson(response, 401, { message: 'Sesión no válida o revocada' });
    }

    if (authenticatedClaims?.sub && request.method === 'POST' && pathname === '/api/auth/change-password') {
      const payload = changePasswordSchema.parse(await readBody(request));
      const [rows] = await pool.query<RowDataPacket[]>('SELECT password FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1', [authenticatedClaims.sub]);
      if (!rows[0]) return sendJson(response, 404, { message: 'Usuario no encontrado' });
      const valid = await bcrypt.compare(payload.currentPassword, String(rows[0].password || ''));
      if (!valid) return sendJson(response, 400, { message: 'La contraseña actual no es correcta' });

      const newHash = await bcrypt.hash(payload.newPassword, 10);
      await pool.execute('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newHash, authenticatedClaims.sub]);
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
        let customerId: number | string = order.customer.id || '';
        if (!customerId) {
          const customerNameParts = String(order.customer.name || '').trim().split(/\s+/);
          const [customerResult] = await connection.execute<ResultSetHeader>(
            'INSERT INTO customers (first_name, last_name, phone, whatsapp, email, address_shipping, zip_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [customerNameParts[0] || 'Cliente', customerNameParts.slice(1).join(' '), order.customer.phone || null, order.customer.phone || null, order.customer.email || null, order.customer.shippingAddress || null, order.customer.zip_code || null]
          );
          customerId = customerResult.insertId;
        }

        const [orderResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO orders (order_code, vin_nr, brand, model, sub_model, year, color, product_type, transmission_type, product_specs, stock_nr, customer_id, user_id, price, core_fee, down_payment, shipping_toggle, shipping_address, shipping_cost, warranty_days, status, workflow_step, description)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [order.code, order.vehicle.vin || null, order.vehicle.make || null, order.vehicle.model || null, order.vehicle.trim || null, order.vehicle.year || null, order.vehicle.color || null, order.mainPart, order.vehicle.transmission || null, order.productSpecs || null, order.stockNumber || null, customerId, order.userId || authenticatedClaims?.sub || null, order.financials.partPrice || 0, order.financials.coreFee || 0, order.financials.downPayment || 0, order.deliveryType === 'envio_domicilio', order.customer.shippingAddress || null, order.financials.deliveryFee || 0, order.warrantyDays || 60, statusToDatabase[order.status || 'cotizacion'] || order.status || 'Cotización', order.workflowStep || 1, order.notes || null]
        );
        const currentUserId = Number(authenticatedClaims?.sub) || 1;
        await connection.execute(
          'INSERT INTO status_orders (order_id, status, description, user_id) VALUES (?, ?, ?, ?)',
          [orderResult.insertId, statusToDatabase[order.status || 'cotizacion'] || order.status || 'Cotización', 'Orden creada desde RADAR 3.0', currentUserId]
        );
        await connection.commit();
        const [rows] = await connection.query<RowDataPacket[]>('SELECT o.*, c.first_name, c.last_name, c.phone, c.email, c.address_shipping, c.zip_code, u.name AS advisor FROM orders o LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = o.user_id WHERE o.id = ?', [orderResult.insertId]);
        return sendJson(response, 201, mapOrder(rows[0]));
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }

    const orderId = pathname.match(/^\/api\/orders\/(\d+)$/)?.[1];
    if (request.method === 'PUT' && orderId) {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator')) return;
      const order = orderPayloadSchema.parse(await readBody(request));
      const customerName = String(order.customer?.name || '').trim().split(/\s+/);
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        if (order.customer?.id) {
          await connection.execute(
            `UPDATE customers SET first_name = ?, last_name = ?, phone = ?, whatsapp = ?, email = ?, address_shipping = ?, zip_code = ? WHERE id = ?`,
            [customerName[0] || 'Cliente', customerName.slice(1).join(' '), order.customer.phone || null, order.customer.phone || null, order.customer.email || null, order.customer.shippingAddress || null, order.customer.zip_code || null, order.customer.id]
          );
        }

        let assignedUserId: number | null | undefined = order.userId;
        if (assignedUserId === undefined && order.advisor && order.advisor !== 'Sin asignar') {
          const [userRows] = await connection.query<RowDataPacket[]>('SELECT id FROM users WHERE name = ? AND deleted_at IS NULL LIMIT 1', [order.advisor]);
          if (userRows[0]) assignedUserId = userRows[0].id;
        }

        await connection.execute(
          `UPDATE orders SET vin_nr = ?, brand = ?, model = ?, sub_model = ?, year = ?, color = ?, product_type = ?, transmission_type = ?, product_specs = ?, stock_nr = ?, price = ?, core_fee = ?, down_payment = ?, shipping_toggle = ?, shipping_address = ?, shipping_cost = ?, warranty_days = ?, status = ?, workflow_step = ?, scheduled_pickup_at = ?, delivered_at = ?, warranty_started = ?, description = ?, claim_reason = ? ${assignedUserId !== undefined ? ', user_id = ?' : ''} WHERE id = ?`,
          [
            order.vehicle?.vin || null, order.vehicle?.make || null, order.vehicle?.model || null, order.vehicle?.trim || null, order.vehicle?.year || null, order.vehicle?.color || null, order.mainPart || null, order.vehicle?.transmission || null, order.productSpecs || null, order.stockNumber || null, order.financials?.partPrice || 0, order.financials?.coreFee || 0, order.financials?.downPayment || 0, order.deliveryType === 'envio_domicilio', order.customer?.shippingAddress || null, order.financials?.deliveryFee || 0, order.warrantyDays || 60, statusToDatabase[order.status || ''] || order.status || '', order.workflowStep || 1, toMysqlDateTime(order.scheduledPickupAt), toMysqlDateTime(order.deliveredAt), Boolean(order.warrantyStarted), order.notes || null, order.claimReason || null,
            ...(assignedUserId !== undefined ? [assignedUserId] : []),
            orderId,
          ]
        );
        const currentUserId = Number(authenticatedClaims?.sub) || 1;
        await connection.execute(
          'INSERT INTO status_orders (order_id, status, description, user_id) VALUES (?, ?, ?, ?)',
          [orderId, statusToDatabase[order.status || ''] || order.status || 'Actualizada', 'Orden actualizada desde RADAR 3.0', currentUserId]
        );
        await connection.commit();
        const orders = await getOrders();
        const updatedOrder = orders.find((currentOrder) => currentOrder.id === orderId);
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
      const [claimRows] = await pool.query<RowDataPacket[]>('SELECT order_id FROM claims WHERE id = ? AND deleted_at IS NULL LIMIT 1', [cId]);
      if (!claimRows[0]) return sendJson(response, 404, { message: 'Reclamo no encontrado' });
      const ordId = claimRows[0].order_id;

      const [result] = await pool.execute<ResultSetHeader>(
        `INSERT INTO call_register (order_id, claim_id, caller_name, caller_phone, attended_by, conversation_summary, whatsapp_dispatched, whatsapp_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [ordId, cId, callData.callerName || null, callData.callerPhone || null, callData.attendedBy || null, callData.conversationSummary, callData.whatsappDispatched ? 1 : 0, callData.whatsappMessage || null]
      );

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
        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO refund_requests (order_id, amount, amount_type, payment_method, payment_contact, reason, status)
           VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
          [refund.orderId, refund.amount, refund.amountType, refund.paymentMethod, refund.paymentDetails || null, refund.reason]
        );
        await connection.execute(
          'UPDATE orders SET status = ? WHERE id = ?',
          [statusToDatabase.solicitud_reembolso, refund.orderId]
        );
        const currentUserId = Number(authenticatedClaims?.sub) || 1;
        await connection.execute(
          'INSERT INTO status_orders (order_id, status, description, user_id) VALUES (?, ?, ?, ?)',
          [refund.orderId, statusToDatabase.solicitud_reembolso, `Solicitud de reembolso REF-${result.insertId} registrada por $${refund.amount}`, currentUserId]
        );
        await connection.commit();
        return sendJson(response, 201, { id: `REF-${result.insertId}`, orderId: String(refund.orderId), status: 'pending', amount: refund.amount });
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
        'SELECT id, name, email, role, permissions, theme, active, created_at, updated_at FROM users WHERE deleted_at IS NULL ORDER BY name'
      );
      return sendJson(response, 200, rows.map((row) => ({ ...row, permissions: parsePermissions(row.permissions) })));
    }

    if (request.method === 'POST' && pathname === '/api/users') {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const userData = userCreateSchema.parse(await readBody(request));
      const passwordHash = await bcrypt.hash(userData.password, 10);
      try {
        const [result] = await pool.execute<ResultSetHeader>(
          `INSERT INTO users (name, email, password, role, permissions, active)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [userData.name, userData.email.toLowerCase(), passwordHash, userData.role, JSON.stringify(userData.permissions), userData.active ? 1 : 0]
        );
        const [rows] = await pool.query<RowDataPacket[]>(
          'SELECT id, name, email, role, permissions, theme, active, created_at, updated_at FROM users WHERE id = ? LIMIT 1',
          [result.insertId]
        );
        return sendJson(response, 201, { ...rows[0], permissions: parsePermissions(rows[0].permissions) });
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
        const params: any[] = [user.name, user.email.toLowerCase(), user.role, JSON.stringify(user.permissions), user.active ? 1 : 0];
        if (user.password) {
          const hash = await bcrypt.hash(user.password, 10);
          passwordUpdateClause = ', password = ?';
          params.push(hash);
        }
        params.push(userId);

        await pool.execute(
          `UPDATE users SET name = ?, email = ?, role = ?, permissions = ?, active = ? ${passwordUpdateClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL`,
          params
        );
      } catch (error) {
        if (typeof error === 'object' && error && 'code' in error && error.code === 'ER_DUP_ENTRY') {
          return sendJson(response, 409, { message: 'El correo ya está asociado a otro usuario' });
        }
        throw error;
      }

      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id, name, email, role, permissions, theme, active, created_at, updated_at FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
        [userId]
      );
      if (!rows[0]) return sendJson(response, 404, { message: 'Usuario no encontrado' });
      return sendJson(response, 200, { ...rows[0], permissions: parsePermissions(rows[0].permissions) });
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
      return sendJson(response, 200, { ok: true, id: Number(userId) });
    }

    // ==========================================
    // LOGISTICS & ACTIVITIES
    // ==========================================
    if (request.method === 'GET' && pathname === '/api/inventory') {
      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT li.*, ll.name AS list_name, o.order_code, o.product_type, o.stock_nr
        FROM logistics_items li
        LEFT JOIN logistics_lists ll ON ll.id = li.list_id
        LEFT JOIN orders o ON o.id = li.order_id
        ORDER BY li.created_at DESC
      `);
      return sendJson(response, 200, rows);
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
    // WASENDER / WHATSAPP DISPATCH
    // ==========================================
    if (request.method === 'POST' && pathname === '/api/wasender/send') {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator')) return;
      const data = wasenderDispatchSchema.parse(await readBody(request));

      let result: any = { ok: true };
      if (wasender.configured) {
        try {
          if (data.mediaUrl && data.mediaType === 'image') {
            await wasender.sendImage({ to: data.phone, url: data.mediaUrl, caption: data.message });
          } else if (data.mediaUrl && data.mediaType === 'file') {
            await wasender.sendFile({ to: data.phone, url: data.mediaUrl, caption: data.message });
          } else {
            await wasender.sendText({ to: data.phone, text: data.message });
          }
          result.dispatched = true;
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
        await pool.execute(
          `INSERT INTO call_register (order_id, caller_phone, attended_by, conversation_summary, whatsapp_dispatched, whatsapp_message)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [data.orderId, data.phone, authenticatedClaims?.name || 'Sistema Radar', 'Mensaje de WhatsApp despachado', result.dispatched ? 1 : 0, data.message]
        );
      }

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
}).listen(port, '0.0.0.0', () => console.log(`RADAR API disponible en http://0.0.0.0:${port}`));