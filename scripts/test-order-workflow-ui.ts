import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import type { Order } from '../src/types';
import { validateWorkflowAction, workflowDate, workflowTasks, type WorkflowAction, type WorkflowEvent, type WorkflowOrder } from '../src/utils/orderWorkflow';
import { previewSettlement, settlementSchema, type Settlement } from '../src/utils/orderPayments';

const baseUrl = process.env.WORKFLOW_TEST_URL || 'http://127.0.0.1:3000';
const target = new URL(baseUrl);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname), 'Workflow UI tests only accept local frontends.');
const output = process.env.WORKFLOW_SCREENSHOT_DIR;
if (output) await mkdir(output, { recursive: true });
const user = { id: 999, name: 'Operador de prueba', email: 'workflow@example.test', role: 'admin', permissions: [] };
const order: Order = {
  id: '901', code: 'ORD-WORKFLOW-901', version: 1, userId: user.id, advisor: user.name,
  createdAt: '2026-10-21T16:00:00Z', createdAtIso: '2026-10-21T16:00:00Z',
  status: 'listo_retiro', mainPart: 'Motor de prueba',
  customer: { id: '901', name: 'Cliente de prueba', type: 'Particular', email: 'client@example.test', phone: '2025550100', location: 'Ciudad de prueba', initials: 'CP' },
  vehicle: { make: 'Toyota', model: 'Corolla', year: 2020, vin: '', plate: '', mileage: '50000', color: 'Blanco' },
  financials: { partPrice: 900, coreFee: 100, downPayment: 200, total: 1000, subtotal: 1000, balanceDue: 800 },
  deliveryType: 'retiro_tienda', workflowStep: 1, warrantyStarted: false, warrantyDays: 30,
  inventoryAvailability: { state: 'none', availableCount: 0, candidates: [] },
};
const events: WorkflowEvent[] = [];
const workflowOrder = (): WorkflowOrder => ({
  id: order.id, code: order.code, version: order.version!, userId: user.id, advisor: user.name,
  createdAt: order.createdAtIso!, quoteCreatedBy: 'Agente original de prueba', status: order.status, deliveredAt: order.deliveredAt || null,
  scheduledPickupAt: order.scheduledPickupAt || null,
  total: (order.financials.partPrice || 0) + (order.financials.coreFee || 0), paid: order.financials.downPayment || 0,
});
const paymentOrder = () => ({ price: order.financials.partPrice || 0, shipping: 0, core: order.financials.coreFee || 0, paid: order.financials.downPayment || 0, coreReceived: Boolean(order.financials.coreReceivedAt) });
const payments: { id: string; amount: number; method: string | null; reference: string | null; date: string | null; actor: string | null }[] = [{ id: 'legacy', amount: 200, method: null, reference: null, date: null, actor: null }];
let coreReceipt: { amount: number; reference: string; actor: string; date: string } | null = null;
const applySettlement = (input: Settlement) => {
  const summary = previewSettlement(paymentOrder(), input);
  order.financials.downPayment = summary.paid; order.financials.total = summary.total; order.financials.balanceDue = summary.balance;
  for (const payment of input.payments) payments.push({ id: String(payments.length + 1), ...payment, date: new Date().toISOString(), actor: user.name });
  if (input.coreAction === 'received') {
    order.financials.coreFee = 0; order.financials.coreReceivedAt = new Date().toISOString();
    coreReceipt = { amount: summary.coreCredit, reference: input.coreReference, actor: user.name, date: new Date().toISOString() };
  }
};
const tasks = () => workflowTasks(workflowOrder(), events);
const responses: Record<string, unknown> = {
  '/api/auth/me': { user }, '/api/customers': [order.customer], '/api/activities': [], '/api/users': [user],
  '/api/analytics/income': [],
  '/api/claims': [],
  '/api/orders/followups/pending': { pending: [], totalCount: 0 },
  '/api/me/notes': { content: '' }, '/api/me/messages': [], '/api/me/message-users': [],
  '/api/auth/2fa/status': { configured: false }, '/api/auth/2fa/vault': { unlocked: false },
  '/api/auth/csrf': { token: 'synthetic-workflow-csrf' },
  '/api/orders/901/followups': { followups: [] },
};
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage();
const errors: string[] = [];
let simulateConflict = false;
let writes = 0;
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error' && message.text().includes('Error fetching')) errors.push(message.text()); });
await page.evaluateOnNewDocument(() => {
  sessionStorage.setItem('radar_authenticated', 'true');
  localStorage.setItem('radar_theme', 'light');
});
await page.setRequestInterception(true);
page.on('request', request => {
  void (async () => {
    const url = new URL(request.url());
    if (url.origin !== target.origin && ['http:', 'https:'].includes(url.protocol)) { await request.abort(); return; }
    if (!url.pathname.startsWith('/api/')) { await request.continue(); return; }
    if (url.pathname === '/api/events') { await request.respond({ status: 200, contentType: 'text/event-stream', body: ': synthetic workflow test\n\n' }); return; }
    const respond = (body: unknown, status = 200) => request.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (request.method() === 'POST' && url.pathname === '/api/orders/901/workflow') {
      if (simulateConflict) {
        simulateConflict = false; order.version!++;
        await respond({ message: 'La orden cambió; recarga antes de registrar la gestión.' }, 409); return;
      }
      const action = JSON.parse(request.postData() || '{}') as WorkflowAction & { version: number; settlement?: Settlement };
      if (action.version !== order.version) { await respond({ message: 'La orden cambió; recarga.' }, 409); return; }
      try {
        const summary = action.settlement ? previewSettlement(paymentOrder(), settlementSchema.parse(action.settlement)) : null;
        validateWorkflowAction({ ...workflowOrder(), ...(summary ? { total: summary.total, paid: summary.paid } : {}) }, events, action);
      }
      catch (reason) { await respond({ message: reason instanceof Error ? reason.message : 'Gestión inválida' }, 409); return; }
      if (action.settlement) applySettlement(action.settlement);
      writes++;
      events.push({
        id: String(writes), task: action.task, outcome: action.outcome, notes: action.notes, evidence: action.evidence || '',
        actorId: user.id, actorName: user.name, createdAt: new Date().toISOString(),
        nextDueDate: action.nextDueDate || null, nextAction: action.nextAction || null, blockedBy: action.blockedBy || null,
        scheduledAt: action.scheduledAt || null, contactResult: action.contactResult || null, partStatus: action.partStatus || null,
      });
      order.version!++;
      if (action.task === 'delivery' && action.outcome === 'completed') {
        order.status = 'entregado'; order.deliveredAt = new Date().toISOString(); order.warrantyStarted = true;
      }
      await respond({ ok: true, version: order.version, eventId: String(writes) }, 201); return;
    }
    if (request.method() === 'POST' && url.pathname === '/api/orders/901/payments') {
      const action = JSON.parse(request.postData() || '{}') as { version: number; settlement: Settlement };
      if (action.version !== order.version) { await respond({ message: 'La orden cambió; recarga.' }, 409); return; }
      applySettlement(settlementSchema.parse(action.settlement)); order.version!++;
      await respond({ ok: true, version: order.version }, 201); return;
    }
    if (request.method() !== 'GET') { errors.push(`Forbidden synthetic mutation: ${request.method()} ${url.pathname}`); await respond({ message: 'Mutation blocked' }, 409); return; }
    if (url.pathname === '/api/workflow/tasks') {
      await respond({ tasks: tasks(), today: workflowDate(new Date()), operators: [{ userId: user.id, name: user.name, completed: events.filter(event => event.outcome === 'completed').length, onTime: 0, attempts: events.filter(event => event.outcome === 'no_response').length, overdue: tasks().filter(task => task.overdue).length, escalated: tasks().filter(task => task.escalated).length, blocked: tasks().filter(task => task.bucket === 'blocked').length, unassigned: 0 }] });
    } else if (url.pathname === '/api/orders/901/workflow') {
      await respond({ order: workflowOrder(), required: true, events, tasks: tasks(), contacts: [] });
    } else if (url.pathname === '/api/orders/901/payments') {
      await respond({ version: order.version, order: paymentOrder(), canRecord: true, coreReceipt, payments });
    } else if (url.pathname === '/api/orders') await respond([order]);
    else if (url.pathname === '/api/orders/901') await respond(order);
    else if (Object.hasOwn(responses, url.pathname)) await respond(responses[url.pathname]);
    else { errors.push(`Unexpected API request: ${url.pathname}`); await respond({ message: 'Unexpected API request' }, 409); }
  })().catch(reason => { errors.push(String(reason)); });
});
const click = async (label: string) => {
  await page.evaluate(text => {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes(text) && button.getBoundingClientRect().height > 0);
    if (!button) throw new Error(`Button not found: ${text}`);
    button.click();
  }, label);
};
const fill = async (label: string, value: string) => {
  await page.evaluate(({ label, value }) => {
    const node = Array.from(document.querySelectorAll('form label')).find(node => node.textContent?.trim().startsWith(label));
    const control = node?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select');
    if (!control) throw new Error(`Field missing: ${label}`);
    const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true })); control.dispatchEvent(new Event('change', { bubbles: true }));
  }, { label, value });
};
const check = async (label: string) => {
  await page.evaluate(text => {
    const node = Array.from(document.querySelectorAll('label')).find(node => node.textContent?.trim().startsWith(text));
    const input = node?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!input) throw new Error(`Checkbox missing: ${text}`);
    if (!input.checked) input.click();
  }, label);
};
const submit = async () => {
  await click('Registrar gestión');
  await page.waitForSelector('[role="dialog"]', { hidden: true });
};
try {
  await page.setViewport({ width: 1440, height: 1050 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.horizon-workflow-queue');
  await click('Ver orden'); await page.waitForSelector('.horizon-order-detail');
  await click('Flujo verificable');
  await page.waitForSelector('.horizon-workflow-panel');
  await page.waitForFunction(() => document.querySelector('.horizon-workflow-stages')?.textContent?.includes('Completada al crear la orden'));
  const quotation = await page.$eval('.horizon-workflow-stages li', element => element.textContent || '');
  assert.match(quotation, /Fecha de creación de la cotización/);
  assert.match(quotation, /Agente original de prueba/);
  assert.ok(!quotation.includes('Pendiente'));
  assert.match(await page.$eval('.horizon-workflow-form h3', element => element.textContent || ''), /Confirmación/);
  assert.equal(writes, 0);
  await page.select('select[aria-label="Estado de orden"]', 'entregado');
  await page.waitForSelector('.horizon-payment-overlay');
  await page.waitForFunction(() => document.body.textContent?.includes('Tratamiento del core'));
  assert.equal(order.status, 'listo_retiro'); assert.equal(writes, 0);
  await fill('Tratamiento del core', 'received'); await fill('Referencia de recepción del core', 'CORE-FORM-PREVIEW');
  await check('Confirmo que recibimos físicamente');
  await click('Agregar método de pago'); await fill('Importe 1', '300');
  await click('Agregar método de pago'); await fill('Método 2', 'zelle'); await fill('Importe 2', '400'); await fill('Referencia 2', 'ZELLE-FORM-PREVIEW');
  for (const width of [1440, 375]) for (const theme of ['light', 'dark']) {
    await page.setViewport({ width, height: 900 });
    await page.evaluate(value => { document.documentElement.classList.toggle('dark', value === 'dark'); document.documentElement.classList.toggle('light', value === 'light'); }, theme);
    assert.equal(await page.$eval('.horizon-payment-overlay [role="dialog"]', panel => panel.scrollWidth > panel.clientWidth + 1), false);
    if (output) await page.screenshot({ path: `${output}/payment-entry-${width}-${theme}.png` });
  }
  await page.keyboard.press('Escape'); await page.waitForSelector('.horizon-payment-overlay', { hidden: true });
  assert.equal(order.financials.downPayment, 200); assert.equal(order.financials.coreFee, 100);
  await page.setViewport({ width: 1440, height: 1050 });
  await click('Mi trabajo de hoy'); await page.waitForSelector('.horizon-workflow-queue');
  await click('Gestionar tarea');
  await page.waitForSelector('[role="dialog"]');
  await page.select('form select', 'no_response');
  await fill('Detalle de la gestión', 'Cliente no respondió; reintentar en el plazo.');
  await fill('Próxima acción', 'Volver a llamar al cliente');
  simulateConflict = true;
  await click('Registrar gestión');
  await page.waitForSelector('form [role="alert"]');
  assert.equal(writes, 0);
  assert.match(await page.$eval('form [role="alert"]', element => element.textContent || ''), /cambió/);
  await click('Cancelar');
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/workflow/tasks')), click('Actualizar tareas')]);
  await click('Gestionar tarea');
  await page.select('form select', 'no_response');
  await fill('Detalle de la gestión', 'Sin respuesta, se registra nuevo intento.');
  await fill('Próxima acción', 'Llamar el próximo día hábil');
  await submit();
  assert.equal(events[0].outcome, 'no_response'); assert.equal(tasks()[0].task, 'ack'); assert.equal(tasks()[0].escalated, true);
  await click('Vencidas');
  assert.ok(await page.$('article button'));
  for (const task of ['ack', 'prepare', 'delivery']) {
    await click('Todas');
    await click('Gestionar tarea');
    await fill('Detalle de la gestión', `Gestión confirmada: ${task}`);
    await fill('Evidencia o referencia verificable', `Referencia verificable para ${task}`);
    if (task === 'prepare') await fill('Retiro o entrega acordada', new Date(Date.now() + 86400000).toISOString().slice(0, 16));
    if (task === 'delivery') {
      await page.waitForFunction(() => document.body.textContent?.includes('Tratamiento del core'));
      await fill('Tratamiento del core', 'received');
      await fill('Referencia de recepción del core', 'CORE-TEST-RECEIPT');
      await check('Confirmo que recibimos físicamente');
      await click('Agregar método de pago'); await fill('Importe 1', '300');
      await click('Agregar método de pago'); await fill('Método 2', 'zelle'); await fill('Importe 2', '400'); await fill('Referencia 2', 'ZELLE-TEST-REFERENCE');
      await check('Verifiqué la recepción de todos');
    }
    await check('Confirmo que realicé');
    await submit();
  }
  assert.equal(events.filter(event => event.outcome === 'completed').length, 3);
  assert.equal(tasks()[0].task, 'post_3');
  assert.equal(order.warrantyStarted, true);
  assert.equal(order.financials.downPayment, 900); assert.equal(order.financials.coreFee, 0);
  assert.deepEqual(payments.map(item => item.method), [null, 'cash', 'zelle']);
  await click('Ver orden');
  await page.waitForSelector('.horizon-order-detail');
  await click('Flujo verificable');
  await page.waitForSelector('.horizon-workflow-panel');
  assert.equal(await page.$$eval('.horizon-workflow-stages li', nodes => nodes.filter(node => node.textContent?.includes('Completada con evidencia')).length), 3);
  assert.ok((await page.$eval('.horizon-workflow-panel', element => element.textContent || '')).includes('Sin respuesta, se registra nuevo intento.'));
  for (const width of [1440, 1150, 768, 375]) {
    for (const theme of ['light', 'dark']) {
      await page.setViewport({ width, height: 1050 });
      await page.evaluate(value => { document.documentElement.classList.toggle('dark', value === 'dark'); document.documentElement.classList.toggle('light', value === 'light'); }, theme);
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>('.horizon-workflow-panel')!;
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1, font: getComputedStyle(panel).fontFamily, panelWidth: panel.getBoundingClientRect().width, width: innerWidth };
      });
      assert.equal(geometry.overflow, false, `${width}/${theme}: horizontal overflow`);
      assert.match(geometry.font, /DM Sans/);
      if (output) await page.screenshot({ path: `${output}/workflow-${width}-${theme}.png`, fullPage: true });
    }
  }
  await page.setViewport({ width: 1440, height: 1050 });
  await click('Mi trabajo de hoy');
  await page.waitForSelector('.horizon-workflow-queue');
  await click('Gestionar tarea');
  await page.waitForSelector('[role="dialog"]');
  await page.select('form select', 'blocked');
  await fill('Detalle de la gestión', 'El cliente espera al taller para la instalación.');
  await fill('Próxima acción', 'Confirmar instalación con el taller');
  await fill('Quién debe resolver el bloqueo', 'Taller del cliente');
  for (const width of [1440, 1150, 768, 375]) {
    for (const theme of ['light', 'dark']) {
      await page.setViewport({ width, height: 1050 });
      await page.evaluate(value => { document.documentElement.classList.toggle('dark', value === 'dark'); document.documentElement.classList.toggle('light', value === 'light'); }, theme);
      const geometry = await page.$eval('[role="dialog"]', panel => {
        const bounds = panel.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width: innerWidth, height: innerHeight, font: getComputedStyle(panel).fontFamily };
      });
      assert.ok(geometry.left >= 0 && geometry.right <= geometry.width && geometry.top >= 0 && geometry.bottom <= geometry.height, `${width}/${theme}: dialog must fit viewport`);
      assert.match(geometry.font, /DM Sans/);
      if (output) await page.screenshot({ path: `${output}/workflow-modal-${width}-${theme}.png` });
    }
  }
  await submit();
  assert.equal(tasks()[0].bucket, 'blocked'); assert.equal(tasks()[0].escalated, false);
  await click('Bloqueadas');
  await click('Gestionar tarea');
  await page.waitForSelector('[role="dialog"]');
  await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Cancelar');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { hidden: true });
  await click('Ver orden'); await page.waitForSelector('.horizon-order-detail');
  await click('Resumen');
  await click('Registrar cobro / ver pagos y core');
  await page.waitForSelector('.horizon-payment-overlay');
  await page.waitForFunction(() => document.body.textContent?.includes('Historial de cobros y core'));
  await page.click('.horizon-payment-overlay summary');
  assert.ok((await page.$eval('.horizon-payment-overlay', element => element.textContent || '')).includes('Método no registrado'));
  assert.ok((await page.$eval('.horizon-payment-overlay', element => element.textContent || '')).includes('CORE-TEST-RECEIPT'));
  for (const width of [1440, 768, 375]) for (const theme of ['light', 'dark']) {
    await page.setViewport({ width, height: 900 });
    await page.evaluate(value => { document.documentElement.classList.toggle('dark', value === 'dark'); document.documentElement.classList.toggle('light', value === 'light'); }, theme);
    const geometry = await page.$eval('.horizon-payment-overlay [role="dialog"]', panel => {
      const bounds = panel.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, overflow: panel.scrollWidth > panel.clientWidth + 1, width: innerWidth, height: innerHeight, background: getComputedStyle(panel).backgroundColor };
    });
    assert.ok(geometry.left >= 0 && geometry.right <= geometry.width && geometry.top >= 0 && geometry.bottom <= geometry.height);
    assert.equal(geometry.overflow, false);
    assert.notEqual(geometry.background, 'rgba(0, 0, 0, 0)', 'Payment dialog must have an opaque surface');
    if (output) await page.screenshot({ path: `${output}/payments-${width}-${theme}.png` });
  }
  await page.keyboard.press('Escape'); await page.waitForSelector('.horizon-payment-overlay', { hidden: true });
  order.financials.downPayment = 850; order.version!++;
  await page.setViewport({ width: 1440, height: 1050 });
  await click('Registrar cobro / ver pagos y core');
  await page.waitForFunction(() => document.body.textContent?.includes('Agregar método de pago'));
  await click('Agregar método de pago'); await fill('Importe 1', '50');
  await click('Guardar cobro sin entregar');
  await page.waitForFunction(() => document.body.textContent?.includes('Confirma que verificaste'));
  assert.equal(order.financials.downPayment, 850);
  await check('Verifiqué la recepción de todos');
  const originalDelivery = order.deliveredAt;
  await click('Guardar cobro sin entregar');
  await page.waitForSelector('.horizon-payment-overlay', { hidden: true });
  assert.equal(order.financials.downPayment, 900); assert.equal(order.deliveredAt, originalDelivery);
  assert.deepEqual(errors, []);
  console.log('PASS: isolated workflow and payments UI; split collection, core receipt, atomic delivery payload, confirmed-money guard, historical methods, standalone collection preserving delivery, light/dark responsive modals and keyboard dismissal. No real API mutations.');
} catch (reason) {
  console.error('Workflow UI failure:', { errors, body: await page.evaluate(() => document.body.innerText.slice(0, 2000)) });
  if (output) await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  throw reason;
} finally { await browser.close(); }
