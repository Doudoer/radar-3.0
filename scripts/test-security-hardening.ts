import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../src/server/config';
import { generateTotpCode, generateTotpSecret } from '../src/server/totp';
import { csrfHeaders } from './securityHttp';

if (process.env.DB_NAME !== 'radar_security_validation') throw new Error('Solo se permite radar_security_validation');
const base = process.env.TEST_API_URL;
const secret = process.env.JWT_SECRET;
if (!base || !secret) throw new Error('TEST_API_URL y JWT_SECRET son obligatorios');
const origin = 'https://security.test';
const transport = { 'X-Forwarded-Proto': 'https', Origin: origin };
interface Session { cookies: Map<string, string>; ip: string; token?: string }
const session = (ip: string): Session => ({ cookies: new Map(), ip });
const anonymous = session('192.0.2.1');
const admin = session('192.0.2.2');
const operator = session('192.0.2.3');
const password = `Fixture-${crypto.randomUUID()}!`;
let totpSecret = generateTotpSecret(20);
let checks = 0;
const cookie = (user: Session) => [...user.cookies].map(([key, value]) => `${key}=${value}`).join('; ');
const headers = (user: Session) => ({ ...transport, 'X-Real-IP': user.ip,
  ...(user.token ? { Authorization: `Bearer ${user.token}` } : {}), Cookie: cookie(user) });

async function request(user: Session, path: string, method = 'GET', body?: unknown) {
  const secure = ['GET', 'HEAD', 'OPTIONS'].includes(method) ? {} :
    await csrfHeaders(base!, user.token ? `Bearer ${user.token}` : '', cookie(user), headers(user));
  const response = await fetch(`${base}${path}`, {
    method, headers: { ...headers(user), ...secure, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(';')[0];
    const index = pair.indexOf('=');
    user.cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }
  return response;
}
async function status(user: Session, path: string, expected: number, method = 'GET', body?: unknown) {
  const response = await request(user, path, method, body);
  assert.equal(response.status, expected, `${method} ${path}`);
  return response;
}
async function check(name: string, work: () => Promise<void>) {
  await work();
  checks++;
  console.log(`PASS ${name}`);
}

try {
  const [existing] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM users');
  assert.equal(Number(existing[0].n), 0, 'Se requiere una base desechable vacia');
  const fixtures: Record<string, number> = {};
  for (const role of ['admin', 'operator', 'admin_target', 'admin_throttled']) {
    const [result] = await pool.execute<ResultSetHeader>(
      'INSERT INTO users (name,email,password,role,phone,totp_secret) VALUES (?,?,?,?,?,?)',
      [`Security ${role}`, `${role}@security.invalid`, await bcrypt.hash(password, 10),
        role.startsWith('admin') ? 'admin' : role, '+15555550123', role === 'admin' ? totpSecret : null],
    );
    fixtures[role] = result.insertId;
  }

  await check('HTTPS obligatorio y cabeceras restrictivas', async () => {
    assert.equal((await fetch(`${base}/api/auth/csrf`)).status, 426);
    const res = await status(anonymous, '/api/auth/csrf', 200);
    assert.match(res.headers.get('content-security-policy')!, /script-src 'self';/);
    assert.doesNotMatch(res.headers.get('content-security-policy')!, /unsafe-eval/);
    assert.match(res.headers.get('strict-transport-security')!, /max-age=31536000/);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.getSetCookie()[0], /HttpOnly; SameSite=Strict;.*Secure/);
  });
  await check('Archivos privados y codigo del servidor no se publican', async () => {
    for (const path of ['/.env', '/.git/config', '/server.js', '/migrate.js', '/package.json', '/assets/private.js.map', '/backups/database.sql']) {
      await status(anonymous, path, 404);
    }
    await status(anonymous, '/uploads/private.pdf', 401);
    await status(anonymous, '/api/uploads/backups/private.sql', 401, 'HEAD');
    await status(anonymous, '/api/orders', 401);
  });
  await check('CORS cerrado y solicitudes cross-site rechazadas', async () => {
    const evil = await fetch(`${base}/api/auth/csrf`, { headers: { ...transport, Origin: 'https://evil.invalid' } });
    assert.equal(evil.status, 403);
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
    const cross = await fetch(`${base}/api/auth/csrf`, { headers: { ...transport, 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(cross.status, 403);
    const preflight = await fetch(`${base}/api/orders`, { method: 'OPTIONS', headers: transport });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  });
  await check('CSRF obligatorio incluso en inicio de sesion', async () => {
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST',
      headers: { ...transport, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@security.invalid', password }) });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'CSRF_INVALID');
  });
  await check('Login real y cookies de sesion de produccion', async () => {
    const res = await status(admin, '/api/auth/login', 200, 'POST', { email: 'admin@security.invalid', password });
    const body = await res.json();
    assert.equal(body.token, undefined);
    assert.equal(body.user.password, undefined);
    assert.match(res.headers.getSetCookie().find(value => value.startsWith('radar_session='))!, /HttpOnly; SameSite=Lax;.*Secure/);
    await status(operator, '/api/auth/login', 200, 'POST', { email: 'operator@security.invalid', password });
  });
  await check('Respaldos, auditoria y administracion exigen boveda, agregados siguen disponibles', async () => {
    for (const path of ['/api/finance/state', '/api/finance/movements', '/api/system/backups',
      '/api/system/backup', '/api/system/backup/download', '/api/system/audit-logs']) await status(admin, path, 403);
    for (const path of ['/api/uploads/backups/private.sql', '/uploads/backups/private.sql']) await status(admin, path, 403, 'HEAD');
    await status(admin, '/api/users', 403, 'POST', {});
    await status(admin, '/api/analytics/income', 200);
    await status(operator, '/api/analytics/income', 403);
    await status(operator, '/api/system/audit-logs', 403);
  });
  const profile = { name: 'Security admin', email: 'admin@security.invalid', phone: '+15555550199', currentPassword: password };
  await check('Telefono OTP y altas de administradores no eluden el factor existente', async () => {
    await status(admin, '/api/auth/profile', 403, 'PUT', profile);
    await status(admin, `/api/users/${fixtures.admin_target}`, 403, 'PUT', { ...profile, role: 'admin', active: true, permissions: [] });
    await status(admin, '/api/auth/2fa/request-otp', 503, 'POST', {});
    const [rows] = await pool.query<RowDataPacket[]>('SELECT phone FROM users WHERE id=?', [fixtures.admin]);
    assert.equal(rows[0].phone, '+15555550123');
  });
  const unlock = async () => {
    const res = await status(admin, '/api/auth/2fa/verify-otp', 200, 'POST', { code: generateTotpCode(totpSecret) });
    assert.equal((await res.json()).verified, true);
    assert.match(res.headers.getSetCookie().find(value => value.startsWith('radar_finance='))!, /HttpOnly; SameSite=Strict;.*Secure/);
  };
  await check('TOTP real desbloquea solo la sesion autorizada', async () => {
    await unlock();
    await status(admin, '/api/finance/state', 200);
    const copied = session('192.0.2.20');
    copied.cookies = new Map(operator.cookies);
    copied.cookies.set('radar_finance', admin.cookies.get('radar_finance')!);
    await status(copied, '/api/finance/state', 403);
    const forged = session('192.0.2.21');
    forged.token = jwt.sign({ sub: String(fixtures.operator), role: 'admin', sessionVersion: 1 }, secret!, { expiresIn: '10m' });
    await status(forged, '/api/system/backups', 403);
  });
  await check('Respaldo completo autorizado y variantes sin bypass', async () => {
    const backup = await status(admin, '/api/system/backup/download', 200);
    assert.match(backup.headers.get('cache-control')!, /no-store/);
    assert.match(await backup.text(), /CREATE TABLE/);
    const snapshot = await status(admin, '/api/system/backup/create', 201, 'POST', { tag: 'security-test' });
    const { filename } = await snapshot.json();
    await status(admin, `/api/uploads/backups/${filename}`, 200, 'HEAD');
    await status(operator, `/api/uploads/backups/${filename}`, 403, 'HEAD');
  });
  await check('Auditoria financiera registra metadata sin nomina ni gastos completos', async () => {
    const state = await (await status(admin, '/api/finance/state', 200)).json();
    await status(admin, '/api/finance/state', 200, 'PUT', { ...state, employees: [{ id: 'secret', name: 'PRIVATE_FINANCE_MARKER', weeklySalary: 123.45 }] });
    const logs = await (await status(admin, '/api/system/audit-logs', 200)).json();
    assert.equal(JSON.stringify(logs).includes('PRIVATE_FINANCE_MARKER'), false);
  });
  await check('Cambio de telefono exige contraseña y revoca sesiones/bovedas previas', async () => {
    await status(admin, '/api/auth/profile', 400, 'PUT', { ...profile, currentPassword: 'wrong-password' });
    const old = session('192.0.2.22');
    old.cookies = new Map(admin.cookies);
    await status(admin, '/api/auth/profile', 200, 'PUT', profile);
    await status(old, '/api/auth/me', 401);
    await status(admin, '/api/finance/state', 403);
    await unlock();
  });
  await check('Cambios administrativos revocan tokens y contraseñas nuevas usan bcrypt', async () => {
    const old = session('192.0.2.23');
    old.token = jwt.sign({ sub: String(fixtures.admin_target), role: 'admin', sessionVersion: 1 }, secret!, { expiresIn: '10m' });
    await status(old, '/api/auth/me', 200);
    const nextPassword = `${password}-new`;
    await status(admin, `/api/users/${fixtures.admin_target}`, 200, 'PUT', {
      name: 'Target', email: 'admin_target@security.invalid', phone: '+15555550123', password: nextPassword,
      role: 'operator', active: true, permissions: [],
    });
    await status(old, '/api/auth/me', 401);
    const [rows] = await pool.query<RowDataPacket[]>('SELECT password FROM users WHERE id=?', [fixtures.admin_target]);
    assert.equal(bcrypt.getRounds(rows[0].password), 12);
    assert.equal(await bcrypt.compare(nextPassword, rows[0].password), true);
  });
  await check('Validacion de JSON, tamaño y formularios en servidor', async () => {
    const secure = await csrfHeaders(base!, '', cookie(admin), headers(admin));
    for (const [body, contentType, expected] of [['{bad', 'application/json', 400], ['{}', 'text/plain', 415],
      [JSON.stringify({ content: 'a'.repeat(1024 * 1024) }), 'application/json', 413]] as const) {
      const res = await fetch(`${base}/api/me/notes`, { method: 'PUT', headers: { ...headers(admin), ...secure, 'Content-Type': contentType }, body });
      assert.equal(res.status, expected);
    }
    await status(admin, '/api/orders?offset=0%20OR%201=1', 400);
    await status(admin, '/api/orders', 400, 'POST', { financials: { partPrice: -1 } });
    await status(admin, '/api/orders/1/delivery-date/request-otp', 410, 'POST', {});
  });
  await check('Adjuntos limitados por MIME, extension, firma y tamaño; lectura privada', async () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    for (const body of [
      { filename: 'attack.svg', contentType: 'image/svg+xml', base64: png.toString('base64') },
      { filename: 'attack.js.png', contentType: 'image/png', base64: png.toString('base64') },
      { filename: 'fake.png', contentType: 'image/png', base64: Buffer.from('<script>alert(1)</script>').toString('base64') },
      { filename: 'large.png', contentType: 'image/png', base64: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64') },
    ]) await status(admin, '/api/upload', 400, 'POST', body);
    const uploaded = await (await status(admin, '/api/upload', 201, 'POST',
      { filename: 'safe.png', contentType: 'image/png', base64: png.toString('base64') })).json();
    await status(anonymous, uploaded.url, 401);
    const res = await status(admin, uploaded.url, 200);
    assert.match(res.headers.get('cache-control')!, /no-store/);
    assert.match(res.headers.get('content-security-policy')!, /sandbox/);
    await res.arrayBuffer();
  });
  await check('Costos internos privados y CSV sin formulas ejecutables', async () => {
    const body = { year: '2020', brand: 'Toyota', model: 'Camry', partType: 'Motor', price: 100, cost: 45, notes: '=1+1' };
    const part = await (await status(admin, '/api/inventory', 201, 'POST', body)).json();
    const detail = await (await status(operator, `/api/inventory/${part.id}`, 200)).json();
    assert.equal('cost' in detail, false);
    const list = await (await status(operator, '/api/inventory', 200)).json();
    assert.equal(list.some((item: object) => 'cost' in item), false);
    await status(operator, `/api/inventory/${part.id}`, 403, 'PUT', { cost: 1 });
    const csv = await (await status(operator, '/api/inventory/export.csv', 200)).text();
    assert.equal(csv.includes('Costo interno'), false);
    assert.equal(csv.includes(`"'=1+1"`), true);
  });
  await check('Regenerar factores revoca concesiones anteriores sin exponer codigos en auditoria', async () => {
    await status(admin, '/api/auth/2fa/backup-codes-reset', 200, 'POST', {});
    await status(admin, '/api/finance/state', 403);
    await unlock();
    const reset = await (await status(admin, '/api/auth/2fa/totp-reset', 200, 'POST', {})).json();
    totpSecret = reset.secret;
    await status(admin, '/api/finance/state', 403);
    await unlock();
  });
  await check('Logout revoca el JWT en servidor, no solamente la cookie', async () => {
    const old = session('192.0.2.24');
    old.cookies = new Map(admin.cookies);
    await status(admin, '/api/auth/logout', 200, 'POST', {});
    await status(old, '/api/auth/me', 401);
    await status(old, '/api/finance/state', 401);
  });
  await check('Limite de intentos por cuenta funciona incluso cambiando IP', async () => {
    for (let i = 0; i < 10; i++) {
      const attempt = session(`192.0.2.${100 + i}`);
      await status(attempt, '/api/auth/login', 401, 'POST', { email: 'admin_target@security.invalid', password: 'wrong-password' });
    }
    await status(session('192.0.2.120'), '/api/auth/login', 429, 'POST', { email: 'admin_target@security.invalid', password });
  });
  await check('Cinco fallos de segundo factor no desbloquean y activan cooldown', async () => {
    const limited = session('192.0.2.121');
    await status(limited, '/api/auth/login', 200, 'POST', { email: 'admin_throttled@security.invalid', password });
    for (let i = 0; i < 5; i++) await status(limited, '/api/auth/2fa/verify-otp', 400, 'POST', { code: '000000' });
    await status(limited, '/api/auth/2fa/verify-otp', 429, 'POST', { code: '000000' });
    assert.equal((await (await status(limited, '/api/auth/2fa/vault', 200)).json()).unlocked, false);
  });
  await check('Limite global devuelve 429 y Retry-After', async () => {
    let response: Response | undefined;
    for (let i = 0; i < 601; i++) {
      response = await fetch(`${base}/api/auth/csrf`, { headers: { ...transport, 'X-Real-IP': '192.0.2.200' } });
      await response.text();
    }
    assert.equal(response!.status, 429);
    assert.ok(Number(response!.headers.get('retry-after')) > 0);
  });
  await check('Actividad sospechosa persistida sin claves ni tokens', async () => {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT action,details FROM audit_logs');
    assert.ok(rows.some(row => row.action === 'LOGIN_FAILED'));
    assert.ok(rows.some(row => row.action === 'SECURITY_ALERT_TRIGGERED'));
    assert.equal(JSON.stringify(rows).includes(password), false);
    assert.equal(JSON.stringify(rows).includes(totpSecret), false);
  });
  await check('Produccion rechaza configuracion insegura antes de escuchar', async () => {
    for (const patch of [{ JWT_SECRET: 'short' }, { APP_URL: 'http://security.test' }, { DB_USER: 'root' },
      { CORS_ORIGIN: '*' }, { NODE_OPTIONS: '--inspect=127.0.0.1:0' }]) {
      const child = spawnSync('node', ['dist/server.js'], {
        env: { ...process.env, NODE_ENV: 'production', APP_URL: origin, DB_USER: 'radar_local', ...patch },
        timeout: 5000, encoding: 'utf8',
      });
      assert.notEqual(child.status, 0);
      assert.equal(child.error, undefined, 'La configuracion debe fallar inmediatamente');
    }
  });
  console.log(`Security HTTP acceptance: ${checks} groups passed; disposable database only.`);
} finally {
  await pool.end();
}
