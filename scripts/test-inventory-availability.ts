import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../src/server/config';
import { csrfHeaders } from './securityHttp';

if (process.env.DB_NAME !== 'radar_inventory_validation') throw new Error('Solo se permite radar_inventory_validation');
const base = process.env.TEST_API_URL;
const secret = process.env.JWT_SECRET;
if (!base || !secret) throw new Error('TEST_API_URL y JWT_SECRET son obligatorios');
async function createUser(role: string) {
  const [row] = await pool.execute<ResultSetHeader>(
    'INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)',
    [`Inventario ${role}`, `${crypto.randomUUID()}@test.invalid`, await bcrypt.hash(crypto.randomUUID(), 10), role],
  );
  return { id: row.insertId, token: jwt.sign({ sub: String(row.insertId), role }, secret, { expiresIn: '10m' }) };
}
try {
  const admin = await createUser('admin');
  const operator = await createUser('operator');
  const yard = await createUser('vendedor_yarda');
  const intruder = await createUser('invitado');
  const request = async (path: string, method = 'GET', body?: unknown, token = admin.token) => {
    const response = await fetch(`${base}/api${path}`, {
      method, headers: { Authorization: `Bearer ${token}`,
        ...(method !== 'GET' ? await csrfHeaders(base, `Bearer ${token}`) : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    return { status: response.status, data };
  };
  const customer = await request('/customers', 'POST', { name: 'Cliente inventario', phone: '5551234567' });
  assert.equal(customer.status, 201);
  const piece = await request('/inventory', 'POST', {
    year: '2020', brand: 'Toyota', model: 'Camry', partType: 'Motor', engineSpecs: '2.4L AWD',
    status: 'disponible', price: 100, cost: 45, notes: '=1+1',
  });
  assert.equal(piece.status, 201, JSON.stringify(piece));
  const body = {
    userId: operator.id, mainPart: 'Motor', productSpecs: '2.4L AWD', status: 'cotizacion',
    vehicle: { make: 'Toyota', model: 'Camry', year: 2020 },
    customer: { id: customer.data.id, name: 'Cliente inventario', phone: '5551234567' },
    financials: { partPrice: 100, downPayment: 0, deliveryFee: 0, coreFee: 0 },
  };
  const createOrder = () => request('/orders', 'POST', { ...body, idempotencyKey: crypto.randomUUID() });
  const first = await createOrder();
  const second = await createOrder();
  assert.equal(first.status, 201, JSON.stringify(first));
  assert.equal(second.status, 201);
  assert.equal(first.data.inventoryAvailability.state, 'available');
  assert.equal(first.data.inventoryAvailability.availableCount, 1);
  assert.equal('cost' in first.data.inventoryAvailability.candidates[0].part, false);
  const before = await request(`/inventory/${piece.data.id}`);
  assert.equal(before.data.status, 'disponible', 'Consultar/crear no debe reservar');
  assert.equal((await fetch(`${base}/api/inventory/${piece.data.id}`)).status, 401);
  assert.equal((await request(`/inventory/${piece.data.id}`, 'GET', undefined, intruder.token)).status, 403);
  assert.equal((await request('/inventory', 'GET', undefined, intruder.token)).status, 403);
  const yardDetail = await request(`/inventory/${piece.data.id}`, 'GET', undefined, yard.token);
  assert.equal(yardDetail.status, 200);
  assert.equal('cost' in yardDetail.data, false);
  assert.equal((await request('/inventory', 'GET', undefined, yard.token)).status, 200);
  const link = { inventoryPartId: Number(piece.data.id), version: first.data.version, confirmedCompatibility: true };
  assert.equal((await request(`/orders/${first.data.id}/inventory`, 'POST', { ...link, confirmedCompatibility: false })).status, 400);
  assert.equal((await request(`/orders/${first.data.id}/inventory`, 'POST', { ...link, version: 999 })).status, 409);
  const unauth = await fetch(`${base}/api/orders/${first.data.id}/inventory`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...await csrfHeaders(base) }, body: JSON.stringify(link),
  });
  assert.equal(unauth.status, 401);
  const race = await Promise.all([first, second].map(order => request(
    `/orders/${order.data.id}/inventory`, 'POST', { ...link, version: order.data.version }, operator.token,
  )));
  assert.deepEqual(race.map(result => result.status).sort(), [200, 409], JSON.stringify(race));
  const winner = race.find(result => result.status === 200)!.data;
  assert.equal(winner.inventoryPartId, Number(piece.data.id));
  assert.equal(winner.inventoryAvailability.state, 'linked');
  assert.equal(winner.version, 2);
  assert.equal((await request(`/inventory/${piece.data.id}`)).data.status, 'reservado');
  const [audits] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM audit_logs WHERE action='ORDER_INVENTORY_LINKED' AND resource_id=?", [winner.id],
  );
  assert.equal(audits.length, 1);
  assert.equal(Number(audits[0].user_id), operator.id);
  const loser = first.data.id === winner.id ? second.data : first.data;
  assert.equal((await request(`/orders/${loser.id}`)).data.inventoryAvailability.state, 'reserved');
  const [linked] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM orders WHERE inventory_part_id=?', [piece.data.id]);
  assert.equal(Number(linked[0].n), 1);
  const conflicting = await request('/inventory', 'POST', {
    year: '2020', brand: 'Ford', model: 'F150', partType: 'Motor', status: 'disponible',
  });
  assert.equal(conflicting.status, 201);
  assert.equal((await request(`/orders/${loser.id}/inventory`, 'POST', {
    inventoryPartId: Number(conflicting.data.id), version: loser.version, confirmedCompatibility: true,
  })).status, 409);
  const csv = async (token: string, query = '') => {
    const response = await fetch(`${base}/api/inventory/export.csv${query}`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Content-Type') || '', /text\/csv/);
    assert.match(response.headers.get('Content-Disposition') || '', /attachment/);
    return response.text();
  };
  const adminCsv = await csv(admin.token);
  assert.match(adminCsv, /Costo interno USD/);
  assert.match(adminCsv, /"'=1\+1"/);
  const operatorCsv = await csv(operator.token);
  assert.doesNotMatch(operatorCsv, /Costo interno USD/);
  const filtered = await csv(operator.token, '?query=Toyota&type=Motor&status=reservado');
  assert.match(filtered, /Toyota/);
  assert.doesNotMatch(filtered, /Ford/);
  assert.equal((await fetch(`${base}/api/inventory/export.csv`)).status, 401);
  const cancelled = await request(`/orders/${winner.id}`, 'PUT', { ...winner, status: 'cancelado' });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled));
  assert.equal((await request(`/inventory/${piece.data.id}`)).data.status, 'disponible');
  assert.equal((await request(`/orders/${loser.id}`)).data.inventoryAvailability.state, 'available');
  console.log('Inventario HTTP: coincidencias, lectura sin reserva, validación, permisos, versión, carrera 200/409, auditoría, filtros CSV, costos y liberación verificados.');
} finally { await pool.end(); }
