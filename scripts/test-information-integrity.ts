import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../src/server/config';
import { runScheduledJob } from '../src/server/scheduledJobs';
import { generateBackupCodes, generateTotpCode, generateTotpSecret } from '../src/server/totp';
import { csrfHeaders } from './securityHttp';

if (process.env.DB_NAME !== 'radar_validation_fresh') throw new Error('Esta prueba solo puede ejecutarse contra radar_validation_fresh');
const base = process.env.TEST_API_URL || 'http://radar-validation-api:3000';
const secret = process.env.JWT_SECRET;
if (!secret) throw new Error('JWT_SECRET es obligatorio');
const suffix = crypto.randomUUID();
const [admin] = await pool.execute<import('mysql2/promise').ResultSetHeader>(
  "INSERT INTO users (name,email,password,role) VALUES (?,?,?,'admin')",
  ['Prueba admin', `${suffix}@test.invalid`, await bcrypt.hash(crypto.randomUUID(), 10)],
);
const [operator] = await pool.execute<import('mysql2/promise').ResultSetHeader>(
  "INSERT INTO users (name,email,password,role) VALUES (?,?,?,'operator')",
  ['Prueba operador', `op-${suffix}@test.invalid`, await bcrypt.hash(crypto.randomUUID(), 10)],
);
const token = (id: number, role: string) => jwt.sign({ sub: String(id), role }, secret, { expiresIn: '10m' });
let adminToken = token(admin.insertId, 'admin');
let vaultCookie = '';
const operatorToken = token(operator.insertId, 'operator');
async function request(path: string, method = 'GET', body?: unknown, auth = adminToken) {
  const response = await fetch(`${base}/api${path}`, {
    method, headers: { Authorization: `Bearer ${auth}`, Cookie: vaultCookie,
      ...(method !== 'GET' ? await csrfHeaders(base, `Bearer ${auth}`, vaultCookie) : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  return { status: response.status, data, cookies: response.headers.getSetCookie() };
}
try {
  let checks = 0;
  assert.equal((await request('/finance/state')).status,403);
  assert.equal((await request('/auth/2fa/totp-setup')).status,403);
  assert.equal((await request('/auth/2fa/request-otp','POST',{})).status,503);
  const totpSecret = generateTotpSecret(20);
  await pool.execute('UPDATE users SET totp_secret=? WHERE id=?',[totpSecret,admin.insertId]);
  const verified = await request('/auth/2fa/verify-otp','POST',{code:generateTotpCode(totpSecret)});
  assert.equal(verified.status,200,JSON.stringify(verified));
  adminToken = decodeURIComponent(verified.cookies.find(value=>value.startsWith('radar_session='))!.split(';')[0].slice('radar_session='.length));
  vaultCookie = verified.cookies.find(value=>value.startsWith('radar_finance='))!.split(';')[0];
  assert.equal((await request('/finance/state')).status,200); checks++;
  const customer = await request('/customers','POST',{ name: 'Cliente prueba', phone: '5551234567', company: 'Empresa prueba', type: 'Empresa', shippingAddress: 'A' });
  assert.equal(customer.status,201,JSON.stringify(customer)); checks++;
  assert.equal(customer.data.company,'Empresa prueba'); assert.equal(customer.data.type,'Empresa'); checks++;
  const body = {
    idempotencyKey: crypto.randomUUID(), userId: admin.insertId, mainPart: 'Motor', status:'cotizacion', warrantyDays:0,
    vehicle:{make:'Marca',model:'Modelo',year:2020}, customer:{id:customer.data.id,name:'Cliente prueba',phone:'5551234567',shippingAddress:'B'},
    deliveryType:'envio_domicilio',financials:{partPrice:100,downPayment:40,deliveryFee:20,coreFee:0},
  };
  const created = await request('/orders','POST',body);
  assert.equal(created.status,201,JSON.stringify(created)); checks++;
  const order = created.data;
  assert.equal(order.customer.shippingAddress,'B'); assert.equal(order.warrantyDays,0); assert.equal(order.version,1); checks++;
  const repeated = await request('/orders','POST',body);
  assert.equal(repeated.status,200); assert.equal(repeated.data.id,order.id); checks++;
  const simultaneousBody = {...body,idempotencyKey:crypto.randomUUID()};
  const replayRace = await Promise.all([1,2].map(()=>request('/orders','POST',simultaneousBody)));
  assert.deepEqual(replayRace.map(result=>result.status).sort(),[200,201]);
  assert.equal(replayRace[0].data.id,replayRace[1].data.id); checks++;
  const updated = await request(`/orders/${order.id}`,'PUT',{...order,notes:'Cambio A'});
  assert.equal(updated.status,200,JSON.stringify(updated)); checks++;
  const stale = await request(`/orders/${order.id}`,'PUT',{...order,notes:'Cambio B'});
  assert.equal(stale.status,409,JSON.stringify(stale)); checks++;
  const simultaneous = await Promise.all(['A','B'].map(notes => request(`/orders/${order.id}`,'PUT',{...updated.data,notes})));
  assert.deepEqual(simultaneous.map(result=>result.status).sort(),[200,409]); checks++;
  const latest = (await request(`/orders/${order.id}`)).data;
  const operatorChange = await request(`/orders/${order.id}`,'PUT',{...latest,financials:{...order.financials,partPrice:101}},operatorToken);
  assert.equal(operatorChange.status,403,JSON.stringify(operatorChange)); checks++;
  const unpaid = await request(`/orders/${order.id}`,'PUT',{...latest,status:'pagado'});
  assert.equal(unpaid.status,400,JSON.stringify(unpaid)); checks++;
  const overpaid = await request('/orders','POST',{...body,idempotencyKey:crypto.randomUUID(),financials:{...body.financials,downPayment:9999}});
  assert.equal(overpaid.status,400); checks++;
  const refundBody = {idempotencyKey:crypto.randomUUID(),orderId:Number(order.id),amount:10,paymentMethod:'Tarjeta',reason:'Parcial prueba'};
  const refund = await request('/refunds','POST',refundBody);
  assert.equal(refund.status,201,JSON.stringify(refund)); checks++;
  const repeatedRefund = await request('/refunds','POST',refundBody);
  assert.equal(repeatedRefund.data.id,refund.data.id); checks++;
  const noPrivilege = await request(`/refunds/${refund.data.id}`,'PUT',{status:'completed'},operatorToken);
  assert.equal(noPrivilege.status,403); checks++;
  const cancelled = await request(`/refunds/${refund.data.id}`,'PUT',{status:'cancelled'});
  assert.equal(cancelled.status,200,JSON.stringify(cancelled));
  const refunds = await request('/refunds');
  assert.equal(refunds.data.filter((r: { orderId:string; status:string })=>r.orderId===order.id&&r.status==='pending').length,0); checks++;
  const refund2 = await request('/refunds','POST',{...refundBody,idempotencyKey:crypto.randomUUID()});
  const completed = await request(`/refunds/${refund2.data.id}`,'PUT',{status:'completed'});
  assert.equal(completed.status,200,JSON.stringify(completed));
  const afterRefund = await request(`/orders/${order.id}`);
  assert.equal(afterRefund.data.status,'cotizacion'); checks++;
  const excess = await request('/refunds','POST',{...refundBody,idempotencyKey:crypto.randomUUID(),amount:31});
  assert.equal(excess.status,400,JSON.stringify(excess)); checks++;
  const claim = await request('/claims','POST',{orderId:Number(order.id),description:'Reclamo prueba'});
  assert.equal(claim.status,201,JSON.stringify(claim));
  const resolved = await request(`/claims/${claim.data.id}`,'PUT',{status:'Resolved'});
  assert.equal(resolved.status,200,JSON.stringify(resolved));
  const afterClaim = await request(`/orders/${order.id}`);
  assert.equal(afterClaim.data.status,'cotizacion'); assert.equal(afterClaim.data.deliveredAt,undefined); checks++;
  const deliveryDate=new Date(Date.now()-40*86400000).toISOString();
  const delivered=await request('/orders','POST',{...body,idempotencyKey:crypto.randomUUID(),status:'entregado',deliveredAt:deliveryDate});
  assert.equal(delivered.status,201,JSON.stringify(delivered));
  const followup=await request(`/orders/${delivered.data.id}/followups`,'POST',{contactChannel:'call',callResult:'no_answer',partStatus:'not_installed',warrantyWarningGiven:false,notes:'No respondió a la llamada de seguimiento'});
  assert.equal(followup.status,201,JSON.stringify(followup));
  const pendingFollowups=await request('/orders/followups/pending');
  const overdue=pendingFollowups.data.pending.find((item:{orderId:string})=>item.orderId===delivered.data.id);
  assert.ok(overdue,'El seguimiento no debe desaparecer a los 35 días');
  assert.equal(overdue.urgency,'atrasada'); checks++;
  const correctedDate=new Date(Date.now()-41*86400000).toISOString();
  assert.equal((await request(`/orders/${delivered.data.id}/delivery-date`,'PUT',{version:delivered.data.version,deliveredAt:correctedDate},operatorToken)).status,403);
  const dateCorrection=await request(`/orders/${delivered.data.id}/delivery-date`,'PUT',{version:delivered.data.version,deliveredAt:correctedDate,reason:'Corrección de prueba'});
  assert.equal(dateCorrection.status,200,JSON.stringify(dateCorrection)); checks++;
  assert.equal((await request(`/orders/${delivered.data.id}/delivery-date`,'PUT',{version:delivered.data.version,deliveredAt:deliveryDate,reason:'Correccion obsoleta'})).status,409); checks++;
  const part=await request('/inventory','POST',{year:'2020',brand:'Marca',model:'Modelo',partType:'Motor',price:75,cost:25});
  assert.equal(part.status,201,JSON.stringify(part));
  assert.equal(part.data.price,75); assert.equal(part.data.cost,25); checks++;
  const reservationRace=await Promise.all([1,2].map(()=>request('/orders','POST',{...body,idempotencyKey:crypto.randomUUID(),inventoryPartId:Number(part.data.id)})));
  assert.deepEqual(reservationRace.map(result=>result.status).sort(),[201,409]); checks++;
  const simultaneousRefunds = await Promise.all([1,2].map(()=>request('/refunds','POST',{...refundBody,idempotencyKey:crypto.randomUUID(),amount:20})));
  assert.deepEqual(simultaneousRefunds.map(result=>result.status).sort(),[201,409]); checks++;
  const state = await request('/finance/state');
  assert.equal(state.status,200,JSON.stringify(state));
  const saved = await request('/finance/state','PUT',{...state.data,employees:[{id:suffix,name:'Test',weeklySalary:100,role:'Asesor'}]});
  assert.equal(saved.status,200,JSON.stringify(saved));
  const staleFinance = await request('/finance/state','PUT',state.data);
  assert.equal(staleFinance.status,409); checks++;
  const fakeAdmin = token(operator.insertId,'admin');
  assert.equal((await request('/finance/state','GET',undefined,fakeAdmin)).status,403); checks++;
  const resetPassword=await request(`/users/${operator.insertId}`,'PUT',{name:'Prueba operador',email:`op-${suffix}@test.invalid`,role:'operator',permissions:[],active:true,password:'ChangedOnlyForTest2026!'});
  assert.equal(resetPassword.status,200,JSON.stringify(resetPassword));
  assert.equal((await request('/customers','GET',undefined,operatorToken)).status,401); checks++;
  const unauthorizedBackup = await fetch(`${base}/api/uploads/backups/test.sql`, {method:'HEAD'});
  assert.equal(unauthorizedBackup.status,401); checks++;
  const png = Buffer.alloc(800*1024); Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
  const upload = await request('/upload','POST',{filename:'test.png',contentType:'image/png',base64:png.toString('base64')});
  assert.equal(upload.status,201,JSON.stringify(upload));
  assert.equal((await fetch(`${base}${upload.data.url}`)).status,401); checks++;
  const excessiveUpload = await fetch(`${base}/api/upload`, {method:'POST',headers:{Authorization:`Bearer ${adminToken}`,'Content-Type':'application/json',...await csrfHeaders(base,`Bearer ${adminToken}`,vaultCookie)},body:JSON.stringify({filename:'test.png',contentType:'image/png',base64:Buffer.alloc(10*1024*1024+1).toString('base64')})});
  assert.equal(excessiveUpload.status,400); checks++;
  let scheduledRuns=0;
  const jobKey=`test-job:${suffix}`;
  await Promise.all([1,2].map(()=>runScheduledJob(pool,jobKey,async()=>{scheduledRuns++;})));
  await runScheduledJob(pool,jobKey,async()=>{scheduledRuns++;});
  assert.equal(scheduledRuns,1); checks++;
  const [outbox] = await pool.query<import('mysql2/promise').RowDataPacket[]>(
    "SELECT COUNT(*) AS count FROM notification_outbox WHERE JSON_UNQUOTE(JSON_EXTRACT(payload,'$.kind'))='event'",
  );
  assert.ok(Number(outbox[0].count)>0); checks++;
  const restore = await request('/system/backup/restore','POST',{sqlContent:'DROP TABLE orders'});
  assert.equal(restore.status,409); assert.equal(restore.data.code,'RESTORE_DISABLED'); checks++;
  assert.equal((await request('/auth/2fa/lock','POST',{})).status,200);
  assert.equal((await request('/finance/state')).status,403);
  assert.equal((await request('/finance/movements')).status,403); checks++;
  const backupCodes = generateBackupCodes(8);
  await pool.execute('UPDATE users SET backup_codes=? WHERE id=?',[JSON.stringify(backupCodes),admin.insertId]);
  const backup = await request('/auth/2fa/verify-otp','POST',{code:backupCodes[0].code.replace('-','')});
  assert.equal(backup.status,200,JSON.stringify(backup));
  assert.equal(backup.data.method,'backup_code');
  adminToken = decodeURIComponent(backup.cookies.find(value=>value.startsWith('radar_session='))!.split(';')[0].slice('radar_session='.length));
  vaultCookie = backup.cookies.find(value=>value.startsWith('radar_finance='))!.split(';')[0];
  assert.equal((await request('/finance/state')).status,200);
  assert.equal((await request('/auth/2fa/lock','POST',{})).status,200);
  assert.equal((await request('/auth/2fa/verify-otp','POST',{code:backupCodes[0].code.replace('-','')})).status,400);
  assert.equal((await request('/finance/state')).status,403); checks++;
  if (process.env.BROWSER_TEST_PASSWORD) {
    await pool.execute(
      "INSERT INTO users (name,email,password,role) VALUES ('Browser fixture','browser-test@radar.invalid',?,'admin') ON DUPLICATE KEY UPDATE password=VALUES(password),active=1",
      [await bcrypt.hash(process.env.BROWSER_TEST_PASSWORD,10)],
    );
  }
  console.log(`HTTP integration: ${checks} groups passed against a disposable database`);
} finally {
  await pool.end();
}
