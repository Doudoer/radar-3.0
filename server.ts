import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createPool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const port = Number(process.env.API_PORT || 3001);
const allowedOrigins = new Set([
  'http://localhost:3000',
  'http://localhost:4173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:4173',
  process.env.CORS_ORIGIN,
  process.env.APP_URL,
].filter(Boolean));
const isAllowedLocalOrigin = (origin?: string) =>
  typeof origin === 'string' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
const pool = createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'radar_app',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'radar_v3',
  waitForConnections: true,
  connectionLimit: 8,
});
const jwtSecret = process.env.JWT_SECRET || '';
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

const getBearerToken = (request: IncomingMessage) => {
  const authorization = request.headers.authorization || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
};

const verifyToken = (request: IncomingMessage) => {
  if (!jwtSecret) return null;
  const token = getBearerToken(request);
  if (!token) return null;
  try {
    return jwt.verify(token, jwtSecret) as jwt.JwtPayload;
  } catch {
    return null;
  }
};

const isLoginRateLimited = (key: string) => {
  const now = Date.now();
  const attempt = loginAttempts.get(key);
  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.set(key, { count: 0, resetAt: now + 15 * 60 * 1000 });
    return false;
  }
  return attempt.count >= 10;
};

const recordLoginFailure = (key: string) => {
  const attempt = loginAttempts.get(key) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
  attempt.count += 1;
  loginAttempts.set(key, attempt);
};

const statusToDatabase: Record<string, string> = {
  cotizacion: 'Cotización',
  espera_confirmacion: 'En Espera Confirmación',
  pagado: 'Pagado',
  en_preparacion: 'En Preparación',
  listo_despacho: 'Listo para Despacho',
  listo_retiro: 'Listo para Retiro',
  en_camino: 'En Camino',
  entregado: 'Entregado',
  reclamo: 'Reclamo',
  cancelado: 'Cancelado',
  solicitud_reembolso: 'Solicitud Reembolso',
  reembolsado: 'Reembolsado',
  archivado: 'Archivado',
};

const statusFromDatabase = (value: string) => {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '');
  const aliases: Record<string, string> = {
    en_espera_confirmacion: 'espera_confirmacion',
    listo_para_despacho: 'listo_despacho',
    listo_para_retiro: 'listo_retiro',
    solicitud_reembolso: 'solicitud_reembolso',
  };
  return aliases[normalized] || normalized || 'cotizacion';
};

const mapOrder = (row: RowDataPacket) => {
  const customerName = [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Cliente sin nombre';
  const price = Number(row.price || 0);
  const deliveryFee = Number(row.shipping_cost || 0);
  const coreFee = Number(row.core_fee || 0);
  const downPayment = Number(row.down_payment || 0);

  return {
    id: String(row.id),
    code: row.order_code,
    createdAt: new Date(row.created_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }),
    advisor: row.advisor || 'Sin asignar',
    status: statusFromDatabase(row.status),
    mainPart: row.product_type || 'Refacción',
    productSpecs: row.product_specs || '',
    stockNumber: row.stock_nr || '',
    workflowStep: row.workflow_step || 1,
    scheduledPickupAt: row.scheduled_pickup_at ? new Date(row.scheduled_pickup_at).toISOString().slice(0, 16) : undefined,
    customer: {
      id: String(row.customer_id || ''),
      name: customerName,
      type: 'Particular',
      email: row.email || '',
      phone: row.phone || '',
      location: row.address_shipping || 'Sin dirección registrada',
      shippingAddress: row.address_shipping || '',
      zip_code: row.zip_code || '',
      initials: customerName.split(' ').map((name: string) => name[0]).join('').slice(0, 2).toUpperCase(),
    },
    vehicle: {
      vin: row.vin_nr || '',
      plate: '',
      make: row.brand || '',
      model: row.model || '',
      year: row.year || new Date().getFullYear(),
      trim: row.sub_model || '',
      transmission: row.transmission_type || '',
      mileage: '',
      color: row.color || '',
    },
    financials: {
      partPrice: price,
      baseMSRP: price,
      downPayment,
      advancePayment: downPayment,
      deliveryFee,
      coreFee,
      subtotal: price + deliveryFee + coreFee,
      total: price + deliveryFee + coreFee,
      balanceDue: Math.max(0, price + deliveryFee + coreFee - downPayment),
    },
    deliveryType: row.shipping_toggle ? 'envio_domicilio' : 'retiro_tienda',
    warrantyDays: row.warranty_days || 60,
    deliveredAt: row.delivered_at ? new Date(row.delivered_at).toISOString() : undefined,
    warrantyStarted: Boolean(row.warranty_started),
    claimReason: row.claim_reason || undefined,
    notes: row.description || '',
  };
};

const readBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
};

const sendJson = (response: ServerResponse, status: number, data: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(data));
};

const toMysqlDateTime = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const pad = (number: number) => number.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

const getOrders = async () => {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT o.*, c.first_name, c.last_name, c.phone, c.email, c.address_shipping, c.zip_code, u.name AS advisor
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN users u ON u.id = o.user_id
    WHERE o.deleted_at IS NULL
    ORDER BY o.created_at DESC
  `);
  return rows.map(mapOrder);
};

const mapClaimStatus = (status: string) => {
  const normalized = status.toLowerCase();
  if (normalized.includes('resolved') || normalized.includes('resuelt')) return 'Resolved';
  if (normalized.includes('denied') || normalized.includes('deneg') || normalized.includes('rechaz')) return 'Denied';
  if (normalized.includes('in process') || normalized.includes('proceso')) return 'In Process';
  return 'Pending';
};

const getClaims = async () => {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT cl.*, o.order_code, o.vin_nr, o.brand, o.model, o.year, o.product_type, o.product_specs, o.stock_nr,
      o.status AS order_status, o.warranty_days, c.first_name, c.last_name, c.phone, c.email, u.name AS advisor,
      (SELECT so.status FROM status_orders so WHERE so.order_id = cl.order_id AND so.status <> 'Reclamo' ORDER BY so.created_at DESC, so.id DESC LIMIT 1) AS previous_status,
      (SELECT COUNT(*) FROM call_register cr WHERE cr.order_id = cl.order_id) AS call_count
    FROM claims cl
    LEFT JOIN orders o ON o.id = cl.order_id
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN users u ON u.id = cl.assigned_user_id
    WHERE cl.deleted_at IS NULL
    ORDER BY cl.created_at DESC
  `);
  return rows.map((row) => ({
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
    type: 'Reclamo de orden',
    priority: 'Media',
    status: mapClaimStatus(row.status || ''),
    previousOrderStatus: statusFromDatabase(row.previous_status || (row.order_status === 'Reclamo' ? 'entregado' : row.order_status) || 'entregado'),
    advisor: row.advisor || 'Sin asignar',
    createdAt: row.created_at,
    resolvedAt: mapClaimStatus(row.status || '') === 'Resolved' ? row.updated_at : undefined,
    callCount: Number(row.call_count || 0),
    calls: [],
    warrantyDays: row.warranty_days || 0,
    stockNumber: row.stock_nr || '',
  }));
};

const getAnalytics = async () => {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT
      COUNT(*) AS totalOrders,
      SUM(CASE WHEN status IN ('Pagado', 'Facturado', 'Entregado') THEN price ELSE 0 END) AS sales,
      SUM(CASE WHEN status NOT IN ('Cancelado', 'Archivado', 'Entregado', 'Reembolsado') THEN 1 ELSE 0 END) AS activeOrders,
      SUM(CASE WHEN status IN ('Reclamo', 'Solicitud Reembolso', 'Reembolsado') THEN 1 ELSE 0 END) AS incidents,
      AVG(CASE WHEN status IN ('Pagado', 'Facturado', 'Entregado') THEN price END) AS averageTicket
    FROM orders WHERE deleted_at IS NULL
  `);
  const [dailySales] = await pool.query<RowDataPacket[]>(`
    SELECT DATE(created_at) AS date, COUNT(*) AS orders, COALESCE(SUM(price), 0) AS amount
    FROM orders WHERE deleted_at IS NULL AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    GROUP BY DATE(created_at) ORDER BY date
  `);
  return { ...rows[0], dailySales };
};

createServer(async (request, response) => {
  const origin = request.headers.origin;
  const allowedOrigin = (typeof origin === 'string' && allowedOrigins.has(origin)) || isAllowedLocalOrigin(origin)
    ? origin
    : undefined;

  if (allowedOrigin) response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (request.method === 'OPTIONS') return response.end();

  try {
    if (request.method === 'GET' && request.url === '/health') {
      await pool.query('SELECT 1');
      return sendJson(response, 200, { ok: true, service: 'radar-3.0-api', database: 'connected' });
    }

    if (request.method === 'POST' && request.url === '/api/auth/login') {
      if (!jwtSecret) return sendJson(response, 503, { message: 'JWT_SECRET no está configurado' });
      const ip = request.socket.remoteAddress || 'unknown';
      if (isLoginRateLimited(ip)) return sendJson(response, 429, { message: 'Demasiados intentos. Intenta más tarde.' });
      const credentials = await readBody(request);
      const email = String(credentials.email || '').trim().toLowerCase();
      const password = String(credentials.password || '');
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
      loginAttempts.delete(ip);
      const token = jwt.sign({ sub: user.id, role: user.role, email: user.email }, jwtSecret, { expiresIn: '8h' });
      return sendJson(response, 200, {
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role, permissions: user.permissions, theme: user.theme },
      });
    }

    if (request.method === 'GET' && request.url === '/api/auth/me') {
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

    const authenticatedClaims = request.url?.startsWith('/api/') ? verifyToken(request) : null;
    if (request.url?.startsWith('/api/') && !authenticatedClaims) {
      return sendJson(response, 401, { message: 'Autenticación requerida' });
    }

    if (request.method === 'GET' && request.url === '/api/orders') {
      return sendJson(response, 200, await getOrders());
    }

    if (request.method === 'GET' && request.url === '/api/users') {
      if (authenticatedClaims?.role !== 'admin') return sendJson(response, 403, { message: 'Se requiere rol admin' });
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id, name, email, role, permissions, theme, active, created_at, updated_at FROM users WHERE deleted_at IS NULL ORDER BY name'
      );
      return sendJson(response, 200, rows);
    }

    if (request.method === 'GET' && request.url === '/api/customers') {
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

    if (request.method === 'GET' && request.url === '/api/claims') {
      return sendJson(response, 200, await getClaims());
    }

    if (request.method === 'POST' && request.url === '/api/claims') {
      const claim = await readBody(request);
      const orderId = Number(claim.orderId);
      const description = String(claim.description || claim.claimReason || '').trim();

      if (!orderId || !description) {
        return sendJson(response, 400, { message: 'Orden y descripción del reclamo son obligatorias' });
      }

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

    const claimId = request.url?.match(/^\/api\/claims\/REC-(\d+)$/)?.[1] || request.url?.match(/^\/api\/claims\/(\d+)$/)?.[1];
    if (request.method === 'PUT' && claimId) {
      const claim = await readBody(request);
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

    if (request.method === 'GET' && request.url === '/api/calls') {
      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT cr.*, c.first_name, c.last_name, o.order_code, u.name AS agent
        FROM call_register cr
        LEFT JOIN customers c ON c.id = cr.customer_id
        LEFT JOIN orders o ON o.id = cr.order_id
        LEFT JOIN users u ON u.id = cr.user_id
        ORDER BY cr.created_at DESC
      `);
      return sendJson(response, 200, rows);
    }

    if (request.method === 'POST' && request.url === '/api/calls') {
      const call = await readBody(request);
      const [result] = await pool.execute<ResultSetHeader>(
        'INSERT INTO call_register (phone, contact_name, description, is_claim, created_at) VALUES (?, ?, ?, ?, NOW())',
        [call.phone, call.contactName, call.description, Boolean(call.isClaim)]
      );
      return sendJson(response, 201, { id: result.insertId, ...call, created_at: new Date().toISOString() });
    }

    if (request.method === 'GET' && request.url === '/api/notifications') {
      const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM notifications ORDER BY created_at DESC');
      return sendJson(response, 200, rows);
    }

    if (request.method === 'GET' && request.url === '/api/reports') {
      const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM ai_reports ORDER BY created_at DESC');
      return sendJson(response, 200, rows);
    }

    if (request.method === 'GET' && request.url === '/api/inventory') {
      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT li.*, ll.name AS list_name, o.order_code, o.product_type, o.stock_nr
        FROM logistics_items li
        LEFT JOIN logistics_lists ll ON ll.id = li.list_id
        LEFT JOIN orders o ON o.id = li.order_id
        ORDER BY li.created_at DESC
      `);
      return sendJson(response, 200, rows);
    }

    if (request.method === 'GET' && request.url === '/api/analytics') {
      return sendJson(response, 200, await getAnalytics());
    }

    if (request.method === 'GET' && request.url === '/api/activities') {
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

    if (request.method === 'POST' && request.url === '/api/orders') {
      const order = await readBody(request);
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

    const orderId = request.url?.match(/^\/api\/orders\/(\d+)$/)?.[1];
    if (request.method === 'PUT' && orderId) {
      const order = await readBody(request);
      const customerName = String(order.customer?.name || '').trim().split(/\s+/);
      if (order.customer?.id) {
        await pool.execute(
          `UPDATE customers SET first_name = ?, last_name = ?, phone = ?, whatsapp = ?, email = ?, address_shipping = ?, zip_code = ? WHERE id = ?`,
          [customerName[0] || 'Cliente', customerName.slice(1).join(' '), order.customer.phone || null, order.customer.phone || null, order.customer.email || null, order.customer.shippingAddress || null, order.customer.zip_code || null, order.customer.id]
        );
      }
      await pool.execute(
        `UPDATE orders SET vin_nr = ?, brand = ?, model = ?, sub_model = ?, year = ?, color = ?, product_type = ?, transmission_type = ?, product_specs = ?, stock_nr = ?, price = ?, core_fee = ?, down_payment = ?, shipping_toggle = ?, shipping_address = ?, shipping_cost = ?, warranty_days = ?, status = ?, workflow_step = ?, scheduled_pickup_at = ?, delivered_at = ?, warranty_started = ?, description = ?, claim_reason = ? WHERE id = ?`,
        [order.vehicle?.vin || null, order.vehicle?.make || null, order.vehicle?.model || null, order.vehicle?.trim || null, order.vehicle?.year || null, order.vehicle?.color || null, order.mainPart || null, order.vehicle?.transmission || null, order.productSpecs || null, order.stockNumber || null, order.financials?.partPrice || 0, order.financials?.coreFee || 0, order.financials?.downPayment || 0, order.deliveryType === 'envio_domicilio', order.customer?.shippingAddress || null, order.financials?.deliveryFee || 0, order.warrantyDays || 60, statusToDatabase[order.status] || order.status, order.workflowStep || 1, toMysqlDateTime(order.scheduledPickupAt), toMysqlDateTime(order.deliveredAt), Boolean(order.warrantyStarted), order.notes || null, order.claimReason || null, orderId]
      );
      await pool.execute('INSERT INTO status_orders (order_id, status, description) VALUES (?, ?, ?)', [orderId, statusToDatabase[order.status] || order.status, 'Orden actualizada desde RADAR 3.0']);
      const orders = await getOrders();
      const updatedOrder = orders.find((order) => order.id === orderId);
      return updatedOrder ? sendJson(response, 200, updatedOrder) : sendJson(response, 404, { message: 'Orden no encontrada' });
    }

    return sendJson(response, 404, { message: 'Ruta no encontrada' });
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, { message: 'No fue posible comunicarse con radar_db' });
  }
}).listen(port, '0.0.0.0', () => console.log(`RADAR API disponible en http://0.0.0.0:${port}`));