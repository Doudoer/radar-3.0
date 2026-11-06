import assert from 'node:assert/strict';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import puppeteer from 'puppeteer-core';
import type { Order } from '../src/types';
import { aftersalesActionSchema, coreDeadline, warrantyDeadline, type AftersalesData } from '../src/utils/aftersales';
import { validateWorkflowAction, workflowDate, workflowTasks, type WorkflowAction, type WorkflowEvent, type WorkflowOrder } from '../src/utils/orderWorkflow';

const baseUrl = process.env.WORKFLOW_TEST_URL || 'http://127.0.0.1:4174';
const origin = new URL(baseUrl).origin;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname));
const output = process.env.WORKFLOW_SCREENSHOT_DIR;
assert.ok(output, 'A private screenshot output directory is required.');
await mkdir(output, { recursive: true });
const invoice = `${output}/synthetic-invoice.pdf`;
const pdf = await PDFDocument.create(); pdf.addPage().drawText('Synthetic test invoice - no actual sale');
await writeFile(invoice, await pdf.save());
const conversation = `${output}/synthetic-conversation.png`;
await writeFile(conversation, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64'));
const user = { id: 999, name: 'Test admin', email: 'admin@example.test', role: 'admin', permissions: [] };
const startedAt = new Date().toISOString();
const order: Order = { id: '901', version: 1, code: 'TEST-AFTER-901', userId: 999, advisor: user.name,
  createdAt: startedAt, createdAtIso: startedAt, status: 'entregado', mainPart: 'Test motor',
  customer: { id: '1', name: 'Synthetic client', type: 'Particular', phone: '2025550100', email: 'client@example.test', location: 'Test city', initials: 'SC' },
  vehicle: { make: 'Toyota', model: 'Corolla', year: 2020, vin: '', plate: '', mileage: '', color: '' },
  financials: { partPrice: 1000, coreFee: 150, downPayment: 1150, total: 1150, subtotal: 1150, balanceDue: 0 },
  workflowStep: 4, deliveredAt: startedAt, warrantyStarted: true, warrantyDays: 60,
  warrantyTerms: { startedAt, days: 60, policy: 'calendar' }, inventoryAvailability: { state: 'none', candidates: [], availableCount: 0 } };
const detail: AftersalesData & { version: number } = { version: 1, canAdmin: true, canManage: true,
  warranty: { terms: order.warrantyTerms!, status: 'active', daysLeft: 60, deadline: warrantyDeadline(order.warrantyTerms!) },
  core: { amount: 150, deadline: coreDeadline(startedAt), receivedAt: null, refund: null, reviewRequired: false },
  invoices: [], claims: [], refunds: [], history: [], paid: 1150, refunded: 0, reserved: 0 };
const workflowOrder = (): WorkflowOrder => ({
  id: '901', code: order.code, version: order.version!, userId: 999, advisor: user.name, createdAt: startedAt,
  status: order.status, deliveredAt: startedAt, historicalDelivery: { paidAt: startedAt, readyAt: startedAt, deliveredAt: startedAt },
  scheduledPickupAt: null, total: 1150, paid: 1150, confirmationPolicy: 'documented',
  warrantyTerms: order.warrantyTerms, customerName: order.customer.name,
});
const responses: Record<string, unknown> = {
  '/api/auth/me': { user }, '/api/auth/csrf': { token: 'synthetic-only' }, '/api/customers': [order.customer], '/api/users': [user],
  '/api/activities': [], '/api/analytics/income': [], '/api/claims': [], '/api/refunds': [], '/api/orders/followups/pending': { pending: [], totalCount: 0 },
  '/api/me/notes': { content: '' }, '/api/me/messages': [], '/api/me/message-users': [], '/api/auth/2fa/status': { configured: false },
  '/api/auth/2fa/vault': { unlocked: false }, '/api/orders/901/followups': { followups: [] },
};
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage();
const errors: string[] = [];
const actions: string[] = [];
const workflowEvents: WorkflowEvent[] = [];
page.on('pageerror', reason => errors.push(String(reason)));
await page.evaluateOnNewDocument(() => { sessionStorage.setItem('radar_authenticated', 'true'); localStorage.setItem('radar_theme', 'light'); });
await page.setRequestInterception(true);
page.on('request', request => {
  void (async () => {
    const url = new URL(request.url());
    if (url.origin !== origin && ['http:', 'https:'].includes(url.protocol)) { await request.abort(); return; }
    if (!url.pathname.startsWith('/api/')) { await request.continue(); return; }
    const respond = (body: unknown, status = 200) => request.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/events') { await request.respond({ status: 200, contentType: 'text/event-stream', body: ': synthetic\n\n' }); return; }
    if (request.method() === 'POST' && url.pathname === '/api/upload') {
      const body = JSON.parse(request.postData()!);
      assert.equal(body.orderId, 901);
      if (body.contentType === 'image/png') {
        assert.ok(body.base64.startsWith('data:image/png;base64,'));
        await respond({ url: `/uploads/conversation-${Date.now()}.png` }, 201); return;
      }
      assert.equal(body.contentType, 'application/pdf');
      assert.ok(body.base64.startsWith('data:application/pdf;base64,'));
      await respond({ url: '/uploads/synthetic-invoice.pdf' }, 201); return;
    }
    if (request.method() === 'POST' && url.pathname === '/api/orders/901/workflow') {
      const body: WorkflowAction & { version: number } = JSON.parse(request.postData()!);
      assert.equal(body.version, order.version);
      validateWorkflowAction(workflowOrder(), workflowEvents, body);
      assert.equal(body.evidence, undefined, 'No additional textual reference for followup');
      workflowEvents.push({ id: String(workflowEvents.length + 1), task: body.task, outcome: body.outcome,
        notes: body.notes, evidence: JSON.stringify({ format: 'followup-contact-v1', reference: '', communication: body.communication }),
        actorId: 999, actorName: user.name, createdAt: new Date().toISOString(), nextDueDate: body.nextDueDate || null,
        nextAction: body.nextAction || null, blockedBy: body.blockedBy || null, scheduledAt: null,
        contactResult: body.contactResult || null, partStatus: body.partStatus || null });
      detail.version++; order.version = detail.version;
      await respond({ version: order.version, eventId: workflowEvents.at(-1)!.id }, 201); return;
    }
    if (request.method() === 'POST' && url.pathname === '/api/orders/901/aftersales') {
      const body = JSON.parse(request.postData()!);
      assert.equal(body.version, detail.version);
      assert.match(body.idempotencyKey, /^[0-9a-f-]{36}$/);
      const action = aftersalesActionSchema.parse(body.data);
      actions.push(action.action);
      if (action.action === 'invoice') detail.invoices.unshift({ id: 1, file_url: action.file, actor_name: user.name, created_at: startedAt });
      if (action.action === 'core_receive') detail.core.receivedAt = startedAt;
      if (action.action === 'core_refund') {
        const refund = { id: 1, amount: 150, status: 'completed', review_stage: 'completed', reason: 'Core', refund_scope: 'core',
          claim_id: null, piece_required: 0, execution: action.execution, completed_at: startedAt };
        detail.refunds.push(refund); detail.core.refund = refund; detail.refunded += 150;
      }
      if (action.action === 'claim_create') {
        detail.claims.unshift({ id: 1, status: 'Pending', stage: 'registered', description: action.notes, resolution_notes: null,
          next_review_date: action.nextDate, created_at: startedAt, assigned_user_id: 999, evidence_files: action.files, warranty_snapshot: order.warrantyTerms! });
        order.status = 'reclamo';
      }
      if (action.action === 'claim_update') {
        detail.claims[0].stage = action.stage; detail.claims[0].status = action.stage === 'replacement' ? 'Resolved' : 'In Process';
        if (action.stage === 'replacement') {
          order.status = 'entregado'; detail.warranty.terms = { ...order.warrantyTerms!, startedAt: new Date().toISOString() };
          detail.warranty.deadline = warrantyDeadline(detail.warranty.terms);
        }
      }
      if (action.action === 'refund_create') {
        detail.refunds.unshift({ id: 2, amount: action.amount, status: 'pending', review_stage: 'requested', reason: action.notes,
          refund_scope: 'purchase', claim_id: null, piece_required: Number(action.pieceRequired), execution: null, completed_at: null });
        detail.reserved = action.amount; order.status = 'solicitud_reembolso';
      }
      if (action.action === 'refund_update') {
        const refund = detail.refunds.find(item => item.id === action.id)!; refund.review_stage = action.stage;
        if (action.stage === 'completed') {
          refund.status = 'completed'; refund.execution = action.execution!; refund.completed_at = startedAt;
          detail.reserved = 0; detail.refunded += refund.amount; order.status = 'reembolsado';
        }
      }
      detail.version++; order.version = detail.version;
      await respond({ ok: true }); return;
    }
    if (request.method() !== 'GET') { errors.push(`Unexpected write ${url.pathname}`); await respond({ message: 'Blocked' }, 409); return; }
    if (url.pathname === '/api/orders/901/aftersales') await respond(detail);
    else if (url.pathname === '/api/orders') await respond([order]);
    else if (url.pathname === '/api/orders/901') await respond(order);
    else if (url.pathname === '/api/workflow/tasks') await respond({ tasks: workflowTasks(workflowOrder(), []), today: workflowDate(new Date()), operators: [] });
    else if (url.pathname === '/api/orders/901/workflow') await respond({ order: workflowOrder(), required: true, events: workflowEvents, tasks: workflowTasks(workflowOrder(), workflowEvents), contacts: [] });
    else if (Object.hasOwn(responses, url.pathname)) await respond(responses[url.pathname]);
    else { errors.push(`Unexpected read ${url.pathname}`); await respond({}, 409); }
  })().catch(reason => errors.push(String(reason)));
});
const click = async (label: string, scoped = false) => {
  await page.waitForFunction(({ label, scoped }) => {
    const root = scoped ? document.querySelector('#order-aftersales') : document;
    return Array.from(root?.querySelectorAll<HTMLButtonElement>('button') || []).some(node =>
      node.textContent?.includes(label) && !node.disabled && node.getBoundingClientRect().height > 0);
  }, {}, { label, scoped });
  await page.evaluate(({ label, scoped }) => {
  const root = scoped ? document.querySelector('#order-aftersales')! : document;
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(node => node.textContent?.includes(label) && node.getBoundingClientRect().height > 0);
  if (!button) throw new Error(`Missing button ${label}`);
  button.click();
  }, { label, scoped });
};
const fill = async (label: string, value: string) => page.evaluate(({ label, value }) => {
  const node = Array.from(document.querySelectorAll('#order-aftersales form label, .horizon-workflow-form label')).find(node => node.textContent?.trim().startsWith(label));
  const control = node?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select');
  if (!control) throw new Error(`Missing field ${label}`);
  const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value);
  control.dispatchEvent(new Event('input', { bubbles: true })); control.dispatchEvent(new Event('change', { bubbles: true }));
}, { label, value });
const check = async (text: string) => page.evaluate(text => {
  const node = Array.from(document.querySelectorAll('#order-aftersales form label')).find(node => node.textContent?.includes(text));
  const control = node?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!control) throw new Error(`Missing checkbox ${text}`);
  if (!control.checked) control.click();
}, text);
const save = async () => {
  await click('Confirmar gestión', true);
  await page.waitForSelector('#order-aftersales form', { hidden: true });
};
try {
  await page.setViewport({ width: 1440, height: 1100 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav');
  await click('Mi trabajo de hoy');
  await page.waitForSelector('.horizon-workflow-queue');
  await click('Ver orden'); await page.waitForSelector('#order-aftersales');
  await click('Seguimiento post entrega');
  await page.waitForSelector('[aria-label="Seguimiento post entrega"]');
  await page.waitForSelector('.horizon-workflow-form');
  assert.equal(await page.$$eval('.horizon-workflow-form label', nodes => nodes.some(node => node.textContent?.startsWith('Evidencia o referencia verificable'))), false);
  assert.equal(await page.$('.horizon-workflow-form input[type=file]'), null, 'No call screenshots');
  await fill('Canal de comunicación', 'whatsapp');
  await fill('Respuesta del cliente', 'sms_sent');
  assert.equal(await page.$$eval('.horizon-workflow-form label', nodes => nodes.some(node => node.textContent?.startsWith('Estado de la pieza'))), false, 'No piece assumptions without reply');
  await page.$eval('.horizon-workflow-form details summary', node => (node as HTMLElement).click());
  await fill('Idioma de la plantilla', 'en');
  assert.match(await page.$eval('.horizon-workflow-form details', node => node.textContent || ''), /60-day warranty/);
  await fill('Respuesta del cliente', 'sms_replied');
  assert.match(await page.$eval('.horizon-workflow-form', node => node.textContent || ''), /Informé por escrito/);
  const captures = await page.$('.horizon-workflow-form input[type=file]'); assert.ok(captures);
  await captures.uploadFile(invoice);
  await page.waitForFunction(() => document.querySelector('.horizon-workflow-form [role=alert]')?.textContent?.includes('Selecciona una imagen'));
  await captures.uploadFile(conversation, conversation);
  await page.waitForFunction(() => document.querySelectorAll('.horizon-workflow-form a').length === 2);
  await click('Quitar imagen 2');
  assert.equal(await page.$$('.horizon-workflow-form a').then(nodes => nodes.length), 1);
  await fill('Respuesta del cliente', 'sms_no_reply');
  await fill('Detalle de la gestión', 'Mensaje enviado con captura, sin respuesta del cliente.');
  await fill('Próxima acción', 'Reintentar contacto el siguiente día hábil.');
  await click('Registrar gestión');
  await page.waitForFunction(() => document.querySelector('.horizon-detail-tabs')?.textContent?.includes('Historial'));
  await click('Historial');
  await page.waitForSelector('a[href^="/uploads/conversation-"]');
  assert.equal(workflowEvents.length, 1);
  assert.equal(JSON.parse(workflowEvents[0].evidence).communication.screenshots.length, 1);
  await click('Seguimiento post entrega'); await page.waitForSelector('.horizon-workflow-form');
  await fill('Canal de comunicación', 'sms');
  await fill('Respuesta del cliente', 'sms_sent');
  await fill('Detalle de la gestión', 'SMS enviado sin respuesta y sin capturas.');
  await fill('Próxima acción', 'Reintentar contacto mañana.');
  await click('Registrar gestión');
  await page.waitForFunction(() => !document.querySelector('.horizon-workflow-form button[type=submit]')?.textContent?.includes('Registrando'));
  assert.equal(workflowEvents.length, 2);
  assert.deepEqual(JSON.parse(workflowEvents[1].evidence).communication.screenshots, []);
  await fill('Canal de comunicación', 'call');
  assert.equal(await page.$('.horizon-workflow-form input[type=file]'), null);
  await fill('Respuesta del cliente', 'no_answer');
  await fill('Detalle de la gestión', 'Cliente no contestó la llamada.');
  await fill('Próxima acción', 'Llamar nuevamente mañana.');
  await click('Registrar gestión');
  await page.waitForFunction(() => !document.querySelector('.horizon-workflow-form button[type=submit]')?.textContent?.includes('Registrando'));
  assert.equal(workflowEvents.length, 3);
  assert.equal(JSON.parse(workflowEvents[2].evidence).communication.screenshots, undefined);
  await fill('Canal de comunicación', 'call');
  assert.match(await page.$eval('.horizon-workflow-form', node => node.textContent || ''), /Advertí verbalmente/);
  await fill('Canal de comunicación', 'whatsapp');
  assert.equal(await page.$eval('.horizon-workflow-form input[type=file]', node => (node as HTMLInputElement).required), false);
  assert.equal(await page.$('#order-aftersales'), null, 'Followup is separate from summary');
  assert.equal(await page.$('.horizon-workflow-stages'), null, 'No commercial stages in followup');
  for (const width of [375, 768, 1440]) {
    await page.setViewport({ width, height: 1100 });
    await page.evaluate(() => {
      const close = Array.from(document.querySelectorAll<HTMLButtonElement>('aside button')).find(node => node.textContent?.trim() === 'close');
      if (close && close.getBoundingClientRect().height > 0) close.click();
    });
    await page.$eval('.horizon-detail-tabs', node => node.scrollIntoView({ block: 'start' }));
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.ok(await page.$eval('.horizon-detail-tabs', node => node.getBoundingClientRect().right <= innerWidth + 2), `Tabs fit ${width}`);
    await page.screenshot({ path: `${output}/followup-tab-${width}.png` });
  }
  await click('Historial');
  await page.waitForSelector('[aria-label="Historial de la orden"]');
  assert.equal(await page.$('[aria-label="Seguimiento post entrega"]'), null);
  assert.equal(await page.$('.horizon-workflow-stages'), null, 'History is not the commercial flow');
  await click('Resumen'); await page.waitForSelector('#order-aftersales');
  await page.waitForFunction(() => document.querySelector('#order-aftersales')?.textContent?.includes('Invoice pendiente'));
  assert.equal(await page.$$eval('#order-aftersales section[aria-label]', nodes => nodes.length), 5, 'Five labeled aftersales cards');
  assert.ok(await page.$('#order-aftersales details summary'), 'Conditions are collapsible');
  await page.click('#order-aftersales [aria-label="Garantía de la pieza"] summary');
  assert.ok(await page.$eval('#order-aftersales [aria-label="Garantía de la pieza"] details', node => node.hasAttribute('open')));
  assert.match(await page.$eval('#order-aftersales [aria-label="Garantía de la pieza"] details', node => node.textContent || ''), /Corregir duración de garantía con motivo/);
  await page.click('#order-aftersales [aria-label="Garantía de la pieza"] summary');
  assert.match(await page.$eval('#order-aftersales', node => node.textContent || ''), /Sin reclamos/);
  assert.equal(await page.$$eval('#order-aftersales dl[aria-label="Resumen de reembolsos"] > div', nodes => nodes.length), 3);
  const warrantyMeter = await page.$('#order-aftersales [role=meter][aria-label="Garantía restante"]');
  assert.ok(warrantyMeter, 'Visible accessible warranty countdown');
  const percentage = Number(await warrantyMeter.evaluate(node => node.getAttribute('aria-valuenow')));
  assert.ok(percentage >= 0 && percentage <= 100);
  assert.match(await warrantyMeter.evaluate(node => node.getAttribute('aria-valuetext') || ''), /días? · \d+ h · \d+ min/);
  await warrantyMeter.dispose();
  await click('Adjuntar invoice PDF', true);
  assert.ok(await page.$('#order-aftersales [aria-label="Invoice de entrega"] form input[type="file"]'), 'Invoice upload stays inside its card, not below the panel');
  await page.waitForFunction(() => {
    const input = document.querySelector('#order-aftersales [aria-label="Invoice de entrega"] input[type="file"]');
    const bounds = input?.getBoundingClientRect();
    return bounds && bounds.top >= 0 && bounds.bottom <= innerHeight;
  }, { timeout: 3000 });
  const fileInput = await page.$('#order-aftersales form input[type="file"]'); assert.ok(fileInput);
  assert.equal(await page.$eval('#order-aftersales form button[type=submit]', node => (node as HTMLButtonElement).disabled), true);
  await fileInput.uploadFile(invoice);
  await page.waitForFunction(() => Boolean(document.querySelector('#order-aftersales form a')));
  for (const width of [375, 768, 1440]) {
    await page.setViewport({ width, height: 1100 });
    await page.evaluate(() => {
      const close = Array.from(document.querySelectorAll<HTMLButtonElement>('aside button')).find(node => node.textContent?.trim() === 'close');
      if (close && close.getBoundingClientRect().height > 0) close.click();
    });
    await fileInput.evaluate(node => node.scrollIntoView({ block: 'center' }));
    assert.equal(await page.$eval('#order-aftersales [aria-label="Invoice de entrega"]', node => node.scrollWidth > node.clientWidth + 1), false, `Invoice form fits ${width}`);
    await page.screenshot({ path: `${output}/invoice-upload-${width}.png` });
  }
  await click('Guardar invoice', true);
  await page.waitForSelector('#order-aftersales form', { hidden: true });
  await page.waitForFunction(() => document.querySelector('#order-aftersales')?.textContent?.includes('Invoice actual'));
  assert.match(await page.$eval('#order-aftersales [aria-label="Invoice de entrega"]', node => node.textContent || ''), /Adjunto/);
  await click('Registrar recepción del core', true); await fill('Detalle', 'Core received at yard within allowed deadline'); await check('Recibí físicamente'); await save();
  await page.waitForFunction(() => document.querySelector('#order-aftersales')?.textContent?.includes('Devolver depósito'));
  await click('Devolver depósito del core', true); await fill('Persona que recibe', 'Synthetic client'); await check('dinero ya fue devuelto'); await save();
  assert.equal(order.status, 'entregado'); assert.equal(detail.refunded, 150);
  await click('Abrir reclamo', true); await fill('Detalle', 'Client reports a part problem'); await save();
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('.horizon-detail-tabs button'))
    .some(node => node.textContent === 'Seguimiento post entrega'));
  assert.equal(await page.$$eval('.horizon-detail-tabs button', nodes => nodes.some(node => node.textContent === 'Seguimiento post entrega')), false, 'Claim status hides followup despite recorded delivery');
  await page.waitForFunction(() => document.querySelector('#order-aftersales')?.textContent?.includes('REC-1'));
  await click('Registrar revisión / comunicación', true); await fill('Detalle', 'Called client and inspected reported problem'); await save();
  await click('Preparar resolución', true); await fill('Detalle', 'Replacement approved and client contacted'); await save();
  await click('Entregar reemplazo', true); await fill('Detalle', 'Replacement handed to client with warranty conditions');
  await fill('Identificación', 'SYNTHETIC-STOCK'); await check('Notifiqué'); await check('Confirmo la entrega física'); await save();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.horizon-detail-tabs button'))
    .some(node => node.textContent === 'Seguimiento post entrega'));
  assert.equal(order.status, 'entregado'); assert.equal(detail.warranty.terms?.days, 60);
  for (const width of [375, 768, 1440]) for (const theme of ['light', 'dark']) {
    await page.setViewport({ width, height: 1100 });
    await page.evaluate(theme => { document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(theme); }, theme);
    await page.evaluate(() => document.getElementById('order-aftersales')?.scrollIntoView());
    await new Promise(resolve => setTimeout(resolve, 300));
    const geometry = await page.evaluate(() => ({ width: innerWidth, actual: document.documentElement.scrollWidth }));
    assert.ok(geometry.actual <= geometry.width + 2, `Horizontal overflow ${width}/${theme}`);
    await page.screenshot({ path: `${output}/aftersales-${width}-${theme}.png` });
  }
  await click('Solicitar reembolso de compra', true); await fill('Detalle', 'Purchase refund after earlier core refund'); await fill('Monto solicitado', '1000'); await save();
  assert.match(await page.$eval('#order-aftersales [aria-label="Reembolsos de compra"]', node => node.textContent || ''), /Solicitud pendiente/);
  await click('Iniciar revisión', true); await fill('Detalle', 'Verified collections and previous core refund'); await save();
  await click('Aprobar importe', true); await fill('Detalle', 'Administrator approves remaining purchase amount'); await save();
  assert.equal(detail.refunded, 150, 'Approval must not pay');
  await click('Registrar dinero devuelto', true); await fill('Detalle', 'Cash purchase refund handed to client'); await fill('Persona que recibe', 'Synthetic client');
  await check('dinero ya fue devuelto'); await save();
  assert.equal(detail.refunded, 1150); assert.equal(order.status, 'reembolsado');
  assert.equal(actions.filter(action => action === 'core_refund').length, 1);
  detail.core = { amount: 0, deadline: '2099-01-01', receivedAt: null, refund: null, reviewRequired: false };
  await page.evaluate(() => window.dispatchEvent(new Event('radar:data-changed')));
  await page.waitForFunction(() => document.querySelector('#order-aftersales [aria-label="Depósito del core"]')?.textContent?.includes('No aplica: sin depósito de core'));
  assert.ok(!(await page.$eval('#order-aftersales [aria-label="Depósito del core"]', node => node.textContent || '')).includes('2099-01-01'), 'No deadline for zero core deposit');
  await page.setViewport({ width: 1440, height: 1100 });
  await page.evaluate(() => document.getElementById('order-aftersales')?.scrollIntoView());
  await page.screenshot({ path: `${output}/aftersales-no-core.png`, fullPage: true });
  detail.core.reviewRequired = true;
  await page.evaluate(() => window.dispatchEvent(new Event('radar:data-changed')));
  await page.waitForFunction(() => document.querySelector('#order-aftersales [aria-label="Depósito del core"]')?.textContent?.includes('Requiere revisión histórica'));
  assert.ok(!(await page.$eval('#order-aftersales [aria-label="Depósito del core"]', node => node.textContent || '')).includes('No aplica: sin depósito de core'), 'Unknown historical deposit never presented as zero');
  assert.deepEqual(errors, []);
  console.log('PASS: installed followup has no mandatory textual evidence; optional multi-image message upload rejects PDFs, supports removal and reopens history links; SMS saves without captures and calls save without evidence/upload. Invoice PDF upload, receipt/core cash refund, claim replacement and purchase refund regressions retained; responsive375/768/1440 light/dark without horizontal overflow. All writes intercepted/synthetic; no real API mutations. Pixel regression inconclusive without baseline; full accessibility and Web Vitals not measured.');
} catch (reason) {
  await page.screenshot({ path: `${output}/failure.png` });
  const text = await page.evaluate(() => document.body.innerText.slice(0, 2500));
  throw new Error(`${reason}\n${errors.join('\n')}\n${text}`);
} finally { await browser.close(); await unlink(invoice); await unlink(conversation); }
