import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool, port, allowedOrigins, isAllowedLocalOrigin, jwtSecret } from './src/server/config';
import { clearSessionCookie, isLoginRateLimited, recordLoginFailure, resetLoginAttempts, requireRole, userIsActive, verifyToken, setSessionCookie, Claims } from './src/server/auth';
import { claimSchema, claimUpdateSchema, loginSchema, orderPayloadSchema, personalMessageSchema, personalNoteSchema, userUpdateSchema } from './src/server/schemas';
import { readBody, sendJson, serveFrontend } from './src/server/http';
import { getOrders, mapOrder, statusFromDatabase, statusToDatabase, toMysqlDateTime } from './src/server/orders';
import { getClaims } from './src/server/claims';
import { createDatabaseBackup } from './src/server/backup';
import { getMessageUsers, getPersonalMessages, getPersonalNote, markPersonalMessageRead, savePersonalNote, sendPersonalMessage } from './src/server/notes';

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
  response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' https://vpic.nhtsa.dot.gov; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
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
        user: { id: user.id, name: user.name, email: user.email, role: user.role, permissions: user.permissions, theme: user.theme },
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
        ? sendJson(response, 200, { user: rows[0] })
        : sendJson(response, 401, { message: 'Usuario inactivo' });
    }

    const authenticatedClaims = pathname.startsWith('/api/') ? verifyToken(request) as Claims | null : null;
    if (pathname.startsWith('/api/') && !authenticatedClaims) {
      return sendJson(response, 401, { message: 'Autenticación requerida' });
    }

    if (authenticatedClaims?.sub) {
      if (!await userIsActive(authenticatedClaims)) return sendJson(response, 401, { message: 'Sesión no válida o revocada' });
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

    if (request.method === 'GET' && pathname === '/api/system/backup') {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const backup = await createDatabaseBackup();
      const date = new Date().toISOString().replace(/[:.]/g, '-');
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/sql; charset=utf-8',
        'Content-Disposition': `attachment; filename="radar-v3-backup-${date}.sql"`,
      });
      response.end(backup);
      return;
    }

    if (request.method === 'GET' && pathname === '/api/orders') {
      return sendJson(response, 200, await getOrders());
    }

    if (request.method === 'GET' && pathname === '/api/users') {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id, name, email, role, permissions, theme, active, created_at, updated_at FROM users WHERE deleted_at IS NULL ORDER BY name'
      );
      return sendJson(response, 200, rows.map((row) => ({ ...row, permissions: parsePermissions(row.permissions) })));
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
        await pool.execute(
          'UPDATE users SET name = ?, email = ?, role = ?, permissions = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL',
          [user.name, user.email.toLowerCase(), user.role, JSON.stringify(user.permissions), user.active ? 1 : 0, userId]
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

    if (request.method === 'GET' && pathname === '/api/customers') {
      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT c.*, COUNT(o.id) AS order_count
        FROM customers c
        LEFT JOIN orders o ON o.customer_id = c.id AND o.deleted_at IS NULL
        GROUP BY c.id
        ORDER BY c.created_at DESC
      `);
      return sendJson(response, 200, rows.map((row) => {
        const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Cliente sin nombre';
        return {
          id: String(row.id), first_name: row.first_name || '', last_name: row.last_name || '', name,
          company: '', type: 'Particular', email: row.email || '', phone: row.phone || '', whatsapp: row.whatsapp || '',
          location: row.address_shipping || 'Sin dirección registrada', address_shipping: row.address_shipping || '',
          shippingAddress: row.address_shipping || '', zip_code: row.zip_code || '',
          initials: name.split(' ').map((part: string) => part[0]).join('').slice(0, 2).toUpperCase(),
          notes: row.notes || '', createdAt: row.created_at, deleted_at: row.deleted_at,
        };
      }));
    }

    if (request.method === 'GET' && pathname === '/api/claims') {
      return sendJson(response, 200, await getClaims());
    }

    if (request.method === 'POST' && pathname === '/api/claims') {
      if (!requireRole(response, authenticatedClaims, 'admin', 'operator')) return;
      const claim = claimSchema.parse(await readBody(request));
      const orderId = claim.orderId;
      const description = claim.description;

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [result] = await connection.execute<ResultSetHeader>(
          'INSERT INTO claims (order_id, description, status, assigned_user_id) VALUES (?, ?, ?, ?)',
            [orderId, description, 'Pending', claim.assignedUserId || null]
        );
        await connection.execute(
          'UPDATE orders SET status = ?, claim_reason = ? WHERE id = ?',
          [statusToDatabase.reclamo, description, orderId]
        );
        await connection.execute(
          'INSERT INTO status_orders (order_id, status, description) VALUES (?, ?, ?)',
          [orderId, statusToDatabase.reclamo, `Reclamo pendiente creado desde detalle: ${description}`]
        );
        await connection.commit();
        return sendJson(response, 201, { id: `REC-${result.insertId}`, orderId: String(orderId), claimReason: description, status: 'Pending' });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }

    const claimId = pathname.match(/^\/api\/claims\/REC-(\d+)$/)?.[1] || pathname.match(/^\/api\/claims\/(\d+)$/)?.[1];
    if (request.method === 'PUT' && claimId) {
      if (!requireRole(response, authenticatedClaims, 'admin')) return;
      const claim = z.object({
        status: z.enum(['Pending', 'In Process', 'Resolved', 'Denied']),
        orderId: z.coerce.number().int().positive(),
        previousOrderStatus: z.string().min(1).max(80),
      }).parse(await readBody(request));
      const status = String(claim.status || '').trim();
      const previousStatus = statusToDatabase[claim.previousOrderStatus] || statusToDatabase.entregado;

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute('UPDATE claims SET status = ? WHERE id = ?', [status, claimId]);

        if (status === 'Resolved' && claim.orderId) {
          await connection.execute(
            'UPDATE orders SET status = ?, claim_reason = NULL WHERE id = ?',
            [previousStatus, claim.orderId]
          );
          await connection.execute(
            'INSERT INTO status_orders (order_id, status, description) VALUES (?, ?, ?)',
            [claim.orderId, previousStatus, `Reclamo REC-${claimId} resuelto. Orden restaurada a ${previousStatus}.`]
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

    if (request.method === 'GET' && pathname === '/api/gomotive/vehicles') {
      return sendJson(response, 501, { message: 'Integración Gomotive no configurada', vehicles: [] });
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
        const customerName = String(order.customer.name || '').trim().split(/\s+/);
        const [customerResult] = await connection.execute<ResultSetHeader>(
          'INSERT INTO customers (first_name, last_name, phone, whatsapp, email, address_shipping, zip_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [customerName[0] || 'Cliente', customerName.slice(1).join(' '), order.customer.phone || null, order.customer.phone || null, order.customer.email || null, order.customer.shippingAddress || null, order.customer.zip_code || null]
        );
        const [orderResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO orders (order_code, vin_nr, brand, model, sub_model, year, color, product_type, transmission_type, product_specs, stock_nr, customer_id, price, core_fee, down_payment, shipping_toggle, shipping_address, shipping_cost, warranty_days, status, workflow_step, description)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [order.code, order.vehicle.vin || null, order.vehicle.make || null, order.vehicle.model || null, order.vehicle.trim || null, order.vehicle.year || null, order.vehicle.color || null, order.mainPart, order.vehicle.transmission || null, order.productSpecs || null, order.stockNumber || null, customerResult.insertId, order.financials.partPrice || 0, order.financials.coreFee || 0, order.financials.downPayment || 0, order.deliveryType === 'envio_domicilio', order.customer.shippingAddress || null, order.financials.deliveryFee || 0, order.warrantyDays || 60, statusToDatabase[order.status] || order.status, order.workflowStep || 1, order.notes || null]
        );
        await connection.execute('INSERT INTO status_orders (order_id, status, description) VALUES (?, ?, ?)', [orderResult.insertId, statusToDatabase[order.status] || order.status, 'Orden creada desde RADAR 3.0']);
        await connection.commit();
        const [rows] = await connection.query<RowDataPacket[]>('SELECT o.*, c.first_name, c.last_name, c.phone, c.email, c.address_shipping, c.zip_code, NULL AS advisor FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = ?', [orderResult.insertId]);
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
        await connection.execute(
          `UPDATE orders SET vin_nr = ?, brand = ?, model = ?, sub_model = ?, year = ?, color = ?, product_type = ?, transmission_type = ?, product_specs = ?, stock_nr = ?, price = ?, core_fee = ?, down_payment = ?, shipping_toggle = ?, shipping_address = ?, shipping_cost = ?, warranty_days = ?, status = ?, workflow_step = ?, scheduled_pickup_at = ?, delivered_at = ?, warranty_started = ?, description = ?, claim_reason = ? WHERE id = ?`,
          [order.vehicle?.vin || null, order.vehicle?.make || null, order.vehicle?.model || null, order.vehicle?.trim || null, order.vehicle?.year || null, order.vehicle?.color || null, order.mainPart || null, order.vehicle?.transmission || null, order.productSpecs || null, order.stockNumber || null, order.financials?.partPrice || 0, order.financials?.coreFee || 0, order.financials?.downPayment || 0, order.deliveryType === 'envio_domicilio', order.customer?.shippingAddress || null, order.financials?.deliveryFee || 0, order.warrantyDays || 60, statusToDatabase[order.status] || order.status, order.workflowStep || 1, toMysqlDateTime(order.scheduledPickupAt), toMysqlDateTime(order.deliveredAt), Boolean(order.warrantyStarted), order.notes || null, order.claimReason || null, orderId]
        );
        await connection.execute('INSERT INTO status_orders (order_id, status, description) VALUES (?, ?, ?)', [orderId, statusToDatabase[order.status] || order.status, 'Orden actualizada desde RADAR 3.0']);
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
        ? 'Payload inválido'
        : statusCode >= 400 && statusCode < 500 && error instanceof Error
          ? error.message
        : 'No fue posible completar la solicitud',
    });
  }
}).listen(port, '0.0.0.0', () => console.log(`RADAR API disponible en http://0.0.0.0:${port}`));