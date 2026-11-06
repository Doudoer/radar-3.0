import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import type { Order } from '../src/types';
import { completedWorkflowStages, validateWorkflowAction, workflowDate, workflowTasks, workflowTaskAssignee, type WorkflowAction, type WorkflowEvent, type WorkflowOrder } from '../src/utils/orderWorkflow';
import { previewSettlement, settlementSchema, validateCollectionEvidence, type Settlement } from '../src/utils/orderPayments';
import { downpaymentSchema } from '../src/utils/downpaymentConfirmation';

const baseUrl = process.env.WORKFLOW_TEST_URL || 'http://127.0.0.1:3000';
const target = new URL(baseUrl);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname), 'Workflow UI tests only accept local frontends.');
const output = process.env.WORKFLOW_SCREENSHOT_DIR;
if (output) await mkdir(output, { recursive: true });
const user = { id: 999, name: 'Operador de prueba', email: 'workflow@example.test', role: 'admin', permissions: [] };
const order: Order = {
  id: '901', code: 'ORD-WORKFLOW-901', version: 1, userId: user.id, advisor: user.name,
  createdAt: '2026-10-21T16:00:00Z', createdAtIso: '2026-10-21T16:00:00Z',
  status: 'cotizacion', mainPart: 'Motor de prueba',
  customer: { id: '901', name: 'Cliente de prueba', type: 'Particular', email: 'client@example.test', phone: '2025550100', location: 'Ciudad de prueba', initials: 'CP' },
  vehicle: { make: 'Toyota', model: 'Corolla', year: 2020, vin: '', plate: '', mileage: '50000', color: 'Blanco' },
  financials: { partPrice: 900, coreFee: 100, downPayment: 200, total: 1000, subtotal: 1000, balanceDue: 800 },
  deliveryType: 'retiro_tienda', workflowStep: 1, warrantyStarted: false, warrantyDays: 30,
  inventoryAvailability: { state: 'none', availableCount: 0, candidates: [] },
};
const events: WorkflowEvent[] = [];
let confirmationPolicy: WorkflowOrder['confirmationPolicy'] = 'documented';
let historicalDelivery: WorkflowOrder['historicalDelivery'] = null;
let isYardSale = false;
let followupUserId: number | null = null;
let assignmentWrites = 0;
let assignmentConflict = false;
const workflowOrder = (): WorkflowOrder => ({
  customerName: order.customer.name,
  id: order.id, code: order.code, version: order.version!, userId: order.userId!, advisor: order.advisor!,
  isYardSale, followupUserId, followupAdvisor: followupUserId ? 'Asesor de seguimiento de prueba' : null,
  createdAt: order.createdAtIso!, quoteCreatedBy: 'Agente original de prueba', status: order.status, deliveredAt: order.deliveredAt || historicalDelivery?.deliveredAt || null,
  scheduledPickupAt: order.scheduledPickupAt || null,
  total: (order.financials.partPrice || 0) + (order.financials.coreFee || 0), paid: order.financials.downPayment || 0,
  confirmationPolicy, confirmationPolicyAt: confirmationPolicy === 'documented' ? null : new Date().toISOString(), preparation: order.preparation,
  historicalDelivery,
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
let failUpload = false;
let uploads = 0;
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
    if (request.method() === 'POST' && url.pathname === '/api/upload') {
      uploads++;
      const payload = JSON.parse(request.postData() || '{}');
      assert.equal(payload.orderId, 901);
      assert.equal(payload.contentType, 'image/png');
      if (failUpload) { failUpload = false; await respond({ message: 'No se pudo subir la imagen de prueba.' }, 500); return; }
      await respond({ url: `/uploads/test-receipt-${uploads}.png` }); return;
    }
    if (request.method() === 'POST' && url.pathname === '/api/orders/901/workflow/assignee') {
      assert.equal(user.role, 'admin');
      const input = JSON.parse(request.postData() || '{}');
      if (assignmentConflict) {
        assignmentConflict = false; order.version!++;
        await respond({ message: 'La orden cambió; actualiza antes de asignar el seguimiento.' }, 409); return;
      }
      assert.equal(input.version, order.version);
      assert.ok(input.advisorId === 8 || input.advisorId === null);
      followupUserId = input.advisorId; order.version!++; assignmentWrites++;
      await respond({ ok: true, version: order.version }); return;
    }
    if (request.method() === 'POST' && url.pathname === '/api/orders/901/workflow') {
      if (simulateConflict) {
        simulateConflict = false; order.version!++;
        await respond({ message: 'La orden cambió; recarga antes de registrar la gestión.' }, 409); return;
      }
      const action = JSON.parse(request.postData() || '{}') as WorkflowAction & { version: number; settlement?: Settlement; completion?: { downpayment?: WorkflowAction['downpayment']; preparation?: WorkflowAction['preparation'] } };
      if (action.version !== order.version) { await respond({ message: 'La orden cambió; recarga.' }, 409); return; }
      if (action.deliveryPhotos !== undefined) {
        action.notes = `Recibe la pieza: ${order.customer.name}`;
        action.evidence = JSON.stringify(action.deliveryPhotos);
      }
      const planned: WorkflowAction[] = [];
      if (action.completion) {
        const completed = completedWorkflowStages(events, workflowOrder());
        if (!completed.includes('ack')) planned.push({ task: 'ack', outcome: 'completed', notes: action.notes,
          downpayment: action.completion.downpayment || downpaymentSchema.parse(action.settlement?.payments.map(payment => ({
            method: payment.method, amount: payment.amount, receivedBy: payment.receivedBy, receipt: payment.receipt || null,
          }))) });
        if (!completed.includes('prepare')) planned.push({ task: 'prepare', outcome: 'completed', notes: '', preparation: action.completion.preparation });
      }
      planned.push(action);
      try {
        const summary = action.settlement ? previewSettlement(paymentOrder(), settlementSchema.parse(action.settlement)) : null;
        if (action.settlement) validateCollectionEvidence(action.settlement);
        const checkedEvents = [...events];
        for (const step of planned) {
          validateWorkflowAction({ ...workflowOrder(), ...(summary ? { total: summary.total, paid: step.task === 'ack' && order.financials.downPayment ? order.financials.downPayment : summary.paid } : {}) }, checkedEvents, step);
          checkedEvents.push({ ...step, id: 'check', createdAt: new Date().toISOString() } as WorkflowEvent);
        }
      }
      catch (reason) { await respond({ message: reason instanceof Error ? reason.message : 'Gestión inválida' }, 409); return; }
      if (action.settlement) applySettlement(action.settlement);
      writes++;
      for (const action of planned) {
      events.push({
        id: `${writes}-${action.task}`, task: action.task, outcome: action.outcome, notes: action.notes, evidence: action.evidence || '',
        actorId: user.id, actorName: user.name, createdAt: new Date().toISOString(),
        nextDueDate: action.nextDueDate || null, nextAction: action.nextAction || null, blockedBy: action.blockedBy || null,
        scheduledAt: action.scheduledAt || null, contactResult: action.contactResult || null, partStatus: action.partStatus || null,
        downpayment: action.downpayment || null,
        preparation: action.preparation || null,
      });
      if (action.task === 'ack' && action.outcome === 'completed') order.status = 'pagado';
      if (action.preparation) {
        order.preparation = action.preparation; order.deliveryType = action.preparation.deliveryType;
        if (order.deliveryType === 'envio_domicilio') order.customer.shippingAddress = action.preparation.address;
        order.scheduledPickupAt = `${action.preparation.dateFrom}T16:00:00Z`;
        order.status = order.deliveryType === 'envio_domicilio' ? 'listo_despacho' : 'listo_retiro';
      }
      if (action.task === 'delivery' && action.outcome === 'completed') {
        order.status = 'entregado'; order.deliveredAt = new Date().toISOString(); order.warrantyStarted = true;
      }
      }
      order.version!++;
      await respond({ ok: true, version: order.version, eventId: String(writes) }, 201); return;
    }
    if (request.method() === 'POST' && url.pathname === '/api/orders/901/payments') {
      const action = JSON.parse(request.postData() || '{}') as { version: number; settlement: Settlement };
      if (action.version !== order.version) { await respond({ message: 'La orden cambió; recarga.' }, 409); return; }
      validateCollectionEvidence(action.settlement);
      applySettlement(settlementSchema.parse(action.settlement)); order.version!++;
      await respond({ ok: true, version: order.version }, 201); return;
    }
    if (request.method() !== 'GET') { errors.push(`Forbidden synthetic mutation: ${request.method()} ${url.pathname}`); await respond({ message: 'Mutation blocked' }, 409); return; }
    if (url.pathname === '/api/workflow/tasks') {
      const responsible = workflowTaskAssignee(workflowOrder(), tasks()[0]?.task || 'post_3');
      await respond({ tasks: tasks().filter(task => user.role === 'admin' || workflowTaskAssignee(task.order, task.task).userId === user.id),
        followupAdvisors: user.role === 'admin' ? [{ id: 8, name: 'Asesor de seguimiento de prueba' }] : [],
        today: workflowDate(new Date()), operators: [{ userId: responsible.userId, name: responsible.name, completed: events.filter(event => event.outcome === 'completed').length, onTime: 0, attempts: events.filter(event => event.outcome === 'no_response').length, overdue: tasks().filter(task => task.overdue).length, escalated: tasks().filter(task => task.escalated).length, blocked: tasks().filter(task => task.bucket === 'blocked').length, unassigned: responsible.userId === null ? tasks().length : 0 }] });
    } else if (url.pathname === '/api/orders/901/workflow') {
      await respond({ order: workflowOrder(), required: true, events, tasks: tasks(), contacts: [] });
    } else if (url.pathname === '/api/orders/901/payments') {
      await respond({ version: order.version, order: paymentOrder(), canRecord: true, coreReceipt, payments, remainingMethodsOnly: Boolean(order.preparation) });
    } else if (url.pathname === '/api/orders/901/aftersales') {
      await respond({ version: order.version, canManage: true, canAdmin: true,
        warranty: { terms: null, status: 'not_started', daysLeft: 30, deadline: null },
        core: { amount: 0, deadline: null, receivedAt: null, refund: null, reviewRequired: false },
        invoices: [], claims: [], refunds: [], history: [], paid: order.financials.downPayment || 0, refunded: 0, reserved: 0 });
    } else if (url.pathname === '/api/orders') await respond([order]);
    else if (url.pathname === '/api/orders/901') await respond(order);
    else if (Object.hasOwn(responses, url.pathname)) await respond(responses[url.pathname]);
    else { errors.push(`Unexpected API request: ${url.pathname}`); await respond({ message: 'Unexpected API request' }, 409); }
  })().catch(reason => { errors.push(String(reason)); });
});
const click = async (label: string) => {
  await page.waitForFunction(text => {
    const root = document.querySelector('[aria-modal="true"]') || document;
    return Array.from(root.querySelectorAll('button')).some(button => button.textContent?.includes(text) && button.getBoundingClientRect().height > 0);
  }, {}, label);
  await page.evaluate(text => {
    const root = document.querySelector('[aria-modal="true"]') || document;
    const button = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes(text) && button.getBoundingClientRect().height > 0);
    if (!button) throw new Error(`Button not found: ${text}`);
    button.click();
  }, label);
};
const fill = async (label: string, value: string) => {
  await page.evaluate(({ label, value }) => {
    const root = document.querySelector('[aria-modal="true"]') || document;
    const node = Array.from(root.querySelectorAll('form label')).find(node => node.textContent?.trim().startsWith(label));
    const control = node?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select');
    if (!control) throw new Error(`Field missing: ${label}`);
    const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true })); control.dispatchEvent(new Event('change', { bubbles: true }));
  }, { label, value });
};
const check = async (label: string) => {
  await page.evaluate(text => {
    const root = document.querySelector('[aria-modal="true"]') || document;
    const node = Array.from(root.querySelectorAll('label')).find(node => node.textContent?.trim().startsWith(text));
    const input = node?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!input) throw new Error(`Checkbox missing: ${text}`);
    if (!input.checked) input.click();
  }, label);
};
const uploadReceipt = async (label: string) => {
  await page.evaluate(text => {
    const root = document.querySelector('[aria-modal="true"]') || document;
    const node = Array.from(root.querySelectorAll('form label')).find(node => node.textContent?.trim().startsWith(text));
    const input = node?.querySelector<HTMLInputElement>('input[type=file]');
    if (!input) throw new Error(`Missing upload: ${text}`);
    const files = new DataTransfer(); files.items.add(new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'payment.png', { type: 'image/png' }));
    input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  }, label);
  await page.waitForFunction(text => {
    const root = document.querySelector('[aria-modal="true"]') || document;
    return Array.from(root.querySelectorAll('form label')).find(node => node.textContent?.trim().startsWith(text))?.querySelector('a');
  }, {}, label);
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
  assert.equal(await page.$eval('select[aria-label="Estado de orden"]', node => (node as HTMLSelectElement).disabled), true);
  assert.deepEqual(await page.$$eval('select[aria-label="Estado de orden"] option', nodes => nodes.map(node => node.textContent)), ['Cotización']);
  await click('Resumen');
  assert.equal(await page.$$eval('button', nodes => nodes.some(node => node.textContent === 'Registrar cobro / ver pagos y core')), false);
  assert.ok(await page.$('[aria-label="Disponibilidad en inventario"]'));
  await click('Registrar entrega');
  await page.waitForSelector('.horizon-payment-overlay');
  await page.waitForFunction(() => document.body.textContent?.includes('Tratamiento del core'));
  assert.equal(order.status, 'cotizacion'); assert.equal(writes, 0);
  await fill('Tratamiento del core', 'received'); await fill('Referencia de recepción del core', 'CORE-FORM-PREVIEW');
  await check('Confirmo que recibimos físicamente');
  await click('Agregar método de pago');
  assert.deepEqual(await page.$$eval('form label', nodes => {
    const label = nodes.filter(node => node.textContent?.trim().startsWith('Método 1')).at(-1);
    return Array.from(label?.querySelectorAll('option') || []).map(option => option.value);
  }), ['cashapp', 'zelle', 'cash']); await fill('Importe 1', '300');
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
  assert.equal(await page.$('form input[type="file"]'), null, 'Cash never exposes an upload');
  assert.equal(await page.$('form textarea, form input[type="date"], form input[type="datetime-local"], form input[type="checkbox"]'), null);
  await fill('Persona que recibió el dinero 1', 'Cash receiver');
  simulateConflict = true;
  await click('Guardar confirmación');
  await page.waitForSelector('form [role="alert"]');
  assert.equal(writes, 0);
  assert.match(await page.$eval('form [role="alert"]', element => element.textContent || ''), /cambió/);
  await click('Cancelar');
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/workflow/tasks')), click('Actualizar tareas')]);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.horizon-workflow-queue');
  await click('Gestionar tarea');
  await fill('Persona que recibió el dinero 1', 'Cash receiver');
  await fill('Monto pagado 1', '150');
  await click('Guardar confirmación');
  await page.waitForFunction(() => document.querySelector('form [role="alert"]')?.textContent?.includes('exactamente'));
  assert.equal(writes, 0);
  await fill('Monto pagado 1', '200');
  const attach = () => page.$eval('form input[type="file"]', node => {
    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'test.png', { type: 'image/png' });
    const files = new DataTransfer(); files.items.add(file);
    (node as HTMLInputElement).files = files.files; node.dispatchEvent(new Event('change', { bubbles: true }));
  });
  for (const method of ['zelle', 'cashapp', 'card']) {
    await fill('Tipo de pago 1', method);
    assert.equal(await page.$('form input[minlength="2"]'), null, 'Electronic payments never request a receiver');
    assert.ok(await page.$('form input[type="file"][required]'));
    if (method === 'zelle') {
      failUpload = true; await attach();
      await page.waitForFunction(() => document.querySelector('form [role="alert"]')?.textContent?.includes('imagen de prueba'));
      assert.equal(writes, 0);
    }
    await attach();
    await page.waitForFunction(() => document.querySelector('form a')?.textContent?.includes('Ver comprobante subido'));
    await fill('Tipo de pago 1', 'cash');
    assert.equal(await page.$('form input[type="file"]'), null);
    assert.equal(await page.$('form a'), null, 'Switching to cash removes the receipt');
  }
  await fill('Persona que recibió el dinero 1', 'Cash receiver');
  await fill('Monto pagado 1', '80');
  await click('Agregar método de pago');
  await fill('Tipo de pago 2', 'zelle');
  assert.equal(await page.$$eval('form input[minlength="2"]', nodes => nodes.length), 1, 'Split payment asks only the cash receiver');
  await attach();
  await page.waitForFunction(() => document.querySelector('form a')?.textContent?.includes('Ver comprobante subido'));
  for (const width of [1440, 768, 375]) for (const theme of ['light', 'dark']) {
    await page.setViewport({ width, height: 1050 });
    await page.evaluate(async value => {
      document.documentElement.classList.toggle('dark', value === 'dark');
      document.documentElement.classList.toggle('light', value === 'light');
      await Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished));
    }, theme);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width}/${theme}: confirmation overflow`);
    assert.equal(await page.$eval('[aria-modal="true"]', modal => {
      const bounds = modal.getBoundingClientRect();
      return Boolean(document.elementFromPoint(bounds.left + 30, bounds.top + 30)?.closest('[aria-modal="true"]'));
    }), true, `${width}/${theme}: confirmation must not be obscured`);
    if (output) await page.screenshot({ path: `${output}/confirmation-${width}-${theme}.png`, fullPage: true });
  }
  await page.setViewport({ width: 1440, height: 1050 });
  await click('Guardar confirmación');
  await page.waitForSelector('[role="dialog"]', { hidden: true });
  assert.equal(events[0].task, 'ack');
  assert.equal(order.status, 'pagado');
  assert.deepEqual(events[0].downpayment?.map(line => [line.method, line.amount]), [['cash', 80], ['zelle', 120]]);
  assert.equal(order.financials.downPayment, 200); assert.equal(payments.length, 1, 'Confirmation never duplicates money');
  await click('Todas'); await click('Gestionar tarea');
  await page.select('form select', 'no_response');
  await fill('Detalle de la gestión', 'Sin respuesta, se registra nuevo intento.');
  await fill('Próxima acción', 'Llamar el próximo día hábil');
  await submit();
  assert.equal(events[1].outcome, 'no_response'); assert.equal(tasks()[0].task, 'prepare');
  await click('Todas');
  assert.ok(await page.$('article button'));
  for (const task of ['prepare', 'delivery']) {
    await click('Todas');
    await click('Gestionar tarea');
    if (task === 'prepare') {
      await check('El patio notificó');
      await fill('Tipo de comunicación con el cliente', 'sms');
      await check('Intenté llamar');
      await fill('Detalle del intento de llamada sin respuesta', 'No contestó la llamada de prueba.');
      await check('El cliente confirmó');
      await fill('Modalidad acordada', 'envio_domicilio');
      await fill('Dirección de entrega', '123 Test Street, Test City');
      await fill('Fecha acordada desde', workflowDate(new Date()));
      await fill('Fecha acordada hasta', workflowDate(new Date(Date.now() + 2 * 86400000)));
      await check('Informé al cliente el monto');
      await check('Informé que el saldo');
      await fill('Acuerdo del core', 'return_core');
      const before = writes;
      await click('Registrar gestión');
      assert.equal(writes, before, 'SMS without screenshots cannot advance');
      await page.$eval('form input[type="file"]', node => {
        const files = new DataTransfer();
        for (const name of ['conversation.png', 'reply.png']) files.items.add(new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' }));
        (node as HTMLInputElement).files = files.files; node.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForFunction(() => Array.from(document.querySelectorAll('form a')).some(node => node.textContent === 'Ver captura 2'));
      for (const width of [1440, 768, 375]) for (const theme of ['light', 'dark']) {
        await page.setViewport({ width, height: 1050 });
        await page.evaluate(async value => {
          document.documentElement.classList.toggle('dark', value === 'dark'); document.documentElement.classList.toggle('light', value === 'light');
          await Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished));
        }, theme);
        assert.equal(await page.$eval('[aria-modal="true"]', modal => modal.scrollWidth > modal.clientWidth + 1), false, `${width}/${theme}: preparation overflow`);
        if (output) await page.screenshot({ path: `${output}/preparation-${width}-${theme}.png`, fullPage: true });
      }
      await page.setViewport({ width: 1440, height: 1050 });
    } else if (task !== 'delivery') {
      await fill('Detalle de la gestión', `Gestión confirmada: ${task}`);
      await fill('Evidencia o referencia verificable', `Referencia verificable para ${task}`);
    }
    if (task === 'delivery') {
      await page.waitForFunction(() => document.body.textContent?.includes('Tratamiento del core'));
      await fill('Tratamiento del core', 'received');
      await fill('Referencia de recepción del core', 'CORE-TEST-RECEIPT');
      await check('Confirmo que recibimos físicamente');
      await click('Agregar método de pago'); await fill('Importe 1', '300');
      await fill('Persona que recibió el dinero 1', 'Test receiver');
      assert.deepEqual(await page.$$eval('form label', nodes => {
        const label = nodes.find(node => node.textContent?.trim().startsWith('Método 1'));
        return Array.from(label?.querySelectorAll('option') || []).map(option => option.value);
      }), ['cashapp', 'zelle', 'cash']);
      await click('Agregar método de pago'); await fill('Método 2', 'zelle'); await fill('Importe 2', '400'); await fill('Referencia 2', 'ZELLE-TEST-REFERENCE');
      await uploadReceipt('Comprobante 2');
      await check('Verifiqué la recepción de todos');
    }
    if (task === 'delivery') await check('Confirmo la entrega física');
    else if (task !== 'prepare') await check('Confirmo que realicé');
    await submit();
    if (task === 'prepare') {
      assert.equal(order.status, 'listo_despacho'); assert.equal(order.deliveryType, 'envio_domicilio');
      assert.equal(order.customer.shippingAddress, '123 Test Street, Test City');
      assert.equal(order.financials.downPayment, 200); assert.equal(order.financials.coreFee, 100);
      assert.equal(order.warrantyStarted, false); assert.equal(order.deliveredAt, undefined);
      assert.equal(events.find(event => event.preparation)?.preparation?.screenshots.length, 2);
    }
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
  await click('Seguimiento post entrega');
  await page.waitForSelector('.horizon-workflow-form');
  assert.equal(await page.$('.horizon-workflow-stages'), null);
  await click('Historial');
  await page.waitForFunction(() => document.querySelector('.horizon-workflow-panel')?.textContent?.includes('Cash receiver'));
  assert.ok((await page.$eval('.horizon-workflow-panel', element => element.textContent || '')).includes('Sin respuesta, se registra nuevo intento.'));
  assert.ok((await page.$eval('.horizon-workflow-panel', element => element.textContent || '')).includes('Cash receiver'));
  assert.ok(await page.$('.horizon-workflow-panel a[href^="/uploads/test-receipt-"]'));
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
  await fill('Resultado', 'blocked');
  await fill('Detalle de la gestión', 'El cliente espera al taller para la instalación.');
  await check('Advertí verbalmente');
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
  assert.equal(await page.$$eval('button', nodes => nodes.some(node => node.textContent === 'Registrar cobro / ver pagos y core')), false);
  assert.equal(await page.$('[aria-label="Disponibilidad en inventario"]'), null);
  order.financials.downPayment = 900; order.version!++;
  await page.setViewport({ width: 1440, height: 1050 });
  events.length = 0; order.status = 'pagado'; order.deliveredAt = undefined; order.preparation = null; order.warrantyStarted = false; confirmationPolicy = 'preapproved';
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav'); await click('Mi trabajo de hoy');
  await page.waitForSelector('.horizon-workflow-queue');
  await click('Ver orden'); await page.waitForSelector('.horizon-order-detail'); await click('Flujo verificable');
  await page.waitForFunction(() => document.querySelector('.horizon-workflow-stages')?.textContent?.includes('Confirmación preaprobada'));
  assert.equal(tasks()[0].task, 'prepare');
  assert.equal(await page.$('form input[type=file]'), null);
  assert.equal(order.status, 'pagado'); assert.equal(order.financials.downPayment, 900);
  await check('El patio notificó'); await check('El cliente confirmó');
  await fill('Fecha acordada desde', workflowDate(new Date())); await fill('Fecha acordada hasta', workflowDate(new Date()));
  await check('Informé al cliente el monto'); await check('Informé que el saldo');
  await fill('Acuerdo del core', 'pay_core');
  await click('Registrar gestión');
  await page.waitForFunction(() => document.querySelector('.horizon-workflow-form h3')?.textContent?.startsWith('Entrega'));
  assert.equal(order.status, 'listo_retiro'); assert.equal(order.deliveryType, 'retiro_tienda');
  assert.equal(order.financials.downPayment, 900); assert.equal(order.warrantyStarted, false);
  assert.equal(events[0].preparation?.channel, 'call'); assert.equal(events[0].preparation?.screenshots.length, 0);
  events.length = 0; order.preparation = null;
  confirmationPolicy = 'legacy'; order.status = 'cotizacion';
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav'); await click('Mi trabajo de hoy');
  await page.waitForSelector('.horizon-workflow-queue');
  await click('Ver orden'); await page.waitForSelector('.horizon-order-detail'); await click('Flujo verificable');
  await page.waitForSelector('.horizon-workflow-form');
  assert.match(await page.$eval('.horizon-workflow-form', element => element.textContent || ''), /Guardar confirmación/);
  assert.equal(await page.$('form textarea, form input[type=date], form input[type=checkbox]'), null,
    'Pending historical confirmation never asks management detail, reference, preparation date or extra checks');
  assert.equal(await page.$('form input[type=file]'), null, 'Cash has no proof upload');
  await fill('Tipo de pago 1', 'card');
  for (const width of [1440, 768, 375]) for (const theme of ['light', 'dark']) {
    await page.setViewport({ width, height: 1050 });
    await page.evaluate(value => {
      document.documentElement.classList.toggle('dark', value === 'dark');
      document.documentElement.classList.toggle('light', value === 'light');
    }, theme);
    assert.equal(await page.$eval('.horizon-workflow-form', form => form.scrollWidth > form.clientWidth + 1), false);
    if (output) await page.screenshot({ path: `${output}/historical-simple-confirmation-${width}-${theme}.png`, fullPage: true });
  }
  await uploadReceipt('Comprobante 1');
  const beforeLegacySave = order.financials.downPayment;
  await click('Guardar confirmación');
  await page.waitForFunction(() => document.querySelector('.horizon-workflow-form h3')?.textContent?.startsWith('Preparación'));
  assert.equal(order.financials.downPayment, beforeLegacySave);
  assert.equal(events[0].downpayment?.[0].method, 'card');
  assert.equal(events[0].nextDueDate, null);
  assert.deepEqual(errors, []);
  events.length = 0; order.status = 'entregado'; order.deliveredAt = undefined; order.preparation = null;
  historicalDelivery = { paidAt: '2026-10-25T14:12:34.000Z', readyAt: null, deliveredAt: '2026-11-01T18:35:12.000Z' };
  const beforeHistory = writes;
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent?.includes('Mi trabajo de hoy')));
  await click('Mi trabajo de hoy');
  await page.waitForSelector('.horizon-workflow-queue'); await click('Ver orden');
  await page.waitForSelector('.horizon-order-detail'); await click('Flujo verificable');
  await page.waitForFunction(() => document.querySelector('.horizon-workflow-stages')?.textContent?.includes('Regularizada por entrega histórica'));
  assert.equal(await page.$$eval('.horizon-workflow-stages time[datetime="2026-10-25T14:12:34.000Z"]', nodes => nodes.length), 1);
  assert.equal(await page.$$eval('.horizon-workflow-stages time[datetime="2026-11-01T18:35:12.000Z"]', nodes => nodes.length), 1);
  assert.equal(await page.$$eval('.horizon-workflow-stages li', nodes => nodes.filter(node => node.textContent?.includes('Pendiente')).length), 0);
  assert.equal(writes, beforeHistory); assert.equal(events.length, 0);
  events.length = 0; historicalDelivery = null; confirmationPolicy = 'legacy';
  order.status = 'cotizacion'; order.deliveredAt = undefined; order.warrantyStarted = false; order.preparation = null;
  order.financials.downPayment = 200; order.financials.coreFee = 100; order.financials.coreReceivedAt = undefined; coreReceipt = null;
  order.version!++;
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('nav'); await click('Mi trabajo de hoy');
  await page.waitForSelector('.horizon-workflow-queue'); await click('Ver orden'); await page.waitForSelector('.horizon-order-detail');
  await click('Resumen'); await click('Registrar entrega');
  await page.waitForFunction(() => document.body.textContent?.includes('Confirmar entrega y cerrar flujo comercial'));
  assert.equal(await page.$$eval('.horizon-payment-overlay button', nodes => nodes.some(node => node.textContent === 'Guardar cobro sin entregar')), false);
  await page.waitForFunction(() => document.body.textContent?.includes('Confirmación del abono anterior'));
  await click('Agregar método de pago'); await fill('Método 1', 'zelle'); await fill('Importe 1', '800');
  assert.equal(await page.$$eval('.horizon-payment-overlay label', nodes => nodes.filter(node => node.textContent?.trim().startsWith('Persona que recibió el dinero')).length), 1, 'Only existing cash advance exposes receiver, not new Zelle');
  await fill('Persona que recibió el dinero 1', 'Previous cash receiver');
  await check('El patio notificó'); await check('El cliente confirmó');
  await fill('Fecha acordada desde', workflowDate(new Date())); await fill('Fecha acordada hasta', workflowDate(new Date()));
  await check('Informé al cliente el monto'); await check('Informé que el saldo'); await fill('Acuerdo del core', 'pay_core');
  assert.equal(await page.$$eval('.horizon-payment-overlay label', nodes => nodes.some(node => node.textContent?.startsWith('Detalle de la entrega'))), false);
  assert.ok(await page.$eval('.horizon-payment-overlay', node => node.textContent?.includes('Persona que recibe la pieza: Cliente de prueba')));
  await check('Confirmo la entrega física'); await check('Verifiqué la recepción de todos');
  const beforeModal = writes;
  await click('Confirmar entrega y cerrar flujo comercial'); assert.equal(writes, beforeModal, 'Missing electronic image cannot save any stage');
  await uploadReceipt('Comprobante 1');
  await check('Verifiqué la recepción de todos');
  for (const width of [1440, 768, 375]) for (const theme of ['light', 'dark']) {
    await page.setViewport({ width, height: 1050 });
    await page.evaluate(async value => {
      document.documentElement.classList.toggle('dark', value === 'dark'); document.documentElement.classList.toggle('light', value === 'light');
      await Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished));
    }, theme);
    assert.equal(await page.$eval('.horizon-payment-overlay [role=dialog]', modal => modal.scrollWidth > modal.clientWidth + 1), false);
    if (output) await page.screenshot({ path: `${output}/complete-modal-${width}-${theme}.png`, fullPage: true });
  }
  await click('Confirmar entrega y cerrar flujo comercial'); await page.waitForSelector('.horizon-payment-overlay', { hidden: true });
  assert.equal(writes, beforeModal + 1); assert.equal(order.status, 'entregado');
  assert.equal(order.financials.downPayment, 1000); assert.equal(order.financials.coreFee, 100);
  assert.deepEqual(events.map(event => event.task), ['ack', 'prepare', 'delivery']);
  assert.equal(events[0].downpayment?.[0].amount, 200); assert.equal(order.warrantyStarted, true); assert.equal(tasks()[0].task, 'post_3');
  assert.match(events.at(-1)!.notes, /Recibe la pieza: Cliente de prueba/);
  await page.waitForFunction(() => document.querySelector('.horizon-detail-actions')?.textContent?.includes('Entrega registrada'));
  const hasDeliveryButton = () => page.$$eval('.horizon-detail-actions button', nodes => nodes.some(node => node.textContent === 'Registrar entrega'));
  assert.equal(await hasDeliveryButton(), false, 'Delivered orders do not offer a second handover');
  assert.equal(await page.$$eval('button', nodes => nodes.some(node => node.textContent === 'Registrar cobro / ver pagos y core')), false);
  assert.equal(await page.$('[aria-label="Disponibilidad en inventario"]'), null);

  // A fully paid order reuses its documented stages without adding another payment.
  order.status = 'listo_retiro'; order.deliveredAt = undefined; order.warrantyStarted = false;
  events.pop(); order.version!++;
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('nav'); await click('Mi trabajo de hoy');
  await page.waitForSelector('.horizon-workflow-queue'); await click('Ver orden'); await page.waitForSelector('.horizon-order-detail');
  await click('Registrar entrega'); await page.waitForFunction(() => document.body.textContent?.includes('Persona que recibe la pieza'));
  const breakdown = await page.$$eval('.horizon-payment-overlay dl > div', nodes => Object.fromEntries(nodes.map(node => [
    node.querySelector('dt')?.textContent, node.querySelector('dd')?.textContent,
  ])));
  assert.deepEqual(breakdown, {
    'Precio de la pieza': '$900.00', 'Delivery / envío': '$0.00', 'Cargo de core': '$100.00',
    'Monto total de la venta': '$1,000.00', 'Downpayment / pagos anteriores': '$1,000.00',
    'Monto restante antes de este cobro': '$0.00', 'Ajuste por core recibido': '$0.00',
    'Monto total a liquidar': '$1,000.00', 'Cobro nuevo': '$0.00', 'Acumulado cobrado': '$1,000.00',
    'Monto restante por cobrar': '$0.00',
  }, 'Fully paid sale displays complete itemized breakdown without inventing original downpayment');
  assert.equal(await page.$$eval('.horizon-payment-overlay input[type=number]', nodes => nodes.length), 0);
  assert.equal(await page.$$eval('.horizon-payment-overlay h3', nodes => nodes.some(node => node.textContent?.includes('pendientes'))), false);
  assert.equal(await page.$$eval('.horizon-payment-overlay textarea', nodes => nodes.length), 0, 'No delivery-detail or textual-evidence input');
  assert.equal(await page.$$eval('.horizon-payment-overlay input:not([type]),.horizon-payment-overlay input[type=text]', nodes => nodes.length), 0, 'Recipient is automatic, not editable');
  if (output) {
    await page.$eval('.horizon-payment-overlay [role=dialog]', modal => { modal.scrollTop = modal.scrollHeight; });
    await page.screenshot({ path: `${output}/optional-photos-375-dark.png`, fullPage: true });
    await page.$eval('.horizon-payment-overlay dl', node => node.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `${output}/payment-breakdown-375.png`, fullPage: true });
  }
  await check('Confirmo la entrega física');
  const paidBefore = order.financials.downPayment; const paymentCount = payments.length;
  await click('Confirmar entrega y cerrar flujo comercial'); await page.waitForSelector('.horizon-payment-overlay', { hidden: true });
  assert.equal(order.status, 'entregado'); assert.equal(order.financials.downPayment, paidBefore); assert.equal(payments.length, paymentCount);

  // A walk-in sale documents real in-person readiness, not a fictional call or appointment.
  events.length = 0; order.status = 'cotizacion'; order.deliveredAt = undefined; order.preparation = null;
  order.financials.downPayment = 0; order.warrantyStarted = false; order.version!++;
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('nav'); await click('Mi trabajo de hoy');
  await page.waitForSelector('.horizon-workflow-queue'); await click('Ver orden'); await page.waitForSelector('.horizon-order-detail');
  await click('Registrar entrega'); await page.waitForFunction(() => document.body.textContent?.includes('Preparación y cita pendientes'));
  await fill('Tipo de comunicación con el cliente', 'in_person');
  await check('Verifiqué en yarda'); await check('El cliente confirmó');
  await check('Informé al cliente el monto'); await check('Informé que el saldo'); await fill('Acuerdo del core', 'pay_core');
  assert.equal(await page.$$eval('.horizon-payment-overlay input[type=date]', nodes => nodes.length), 0);
  await click('Agregar método de pago'); await fill('Importe 1', '1000'); await fill('Persona que recibió el dinero 1', 'Cajero de yarda');
  await check('Verifiqué la recepción de todos');
  await page.$$eval('.horizon-payment-overlay label', nodes => {
    const input = nodes.find(node => node.textContent?.startsWith('Evidencia de entrega'))?.querySelector('input');
    if (!input) throw new Error('Missing optional multi-image delivery input');
    const files = new DataTransfer();
    for (const name of ['piece-front.png', 'piece-back.png']) files.items.add(new File([new Uint8Array([137,80,78,71,13,10,26,10])], name, { type: 'image/png' }));
    input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => document.body.textContent?.includes('Ver imagen de entrega 2'));
  await check('Confirmo la entrega física'); await click('Confirmar entrega y cerrar flujo comercial');
  await page.waitForSelector('.horizon-payment-overlay', { hidden: true });
  assert.equal(order.status, 'entregado'); assert.equal(order.financials.downPayment, 1000);
  assert.equal(events.find(event => event.task === 'prepare')?.preparation?.channel, 'in_person');
  assert.equal(order.preparation?.dateFrom, workflowDate(new Date()));
  await click('Historial');
  await page.waitForFunction(() => document.body.textContent?.includes('Comunicación: Cliente presente'));
  await page.waitForFunction(() => Array.from(document.querySelectorAll('a')).some(node => node.textContent === 'Ver imagen de entrega 2'));
  assert.equal(JSON.parse(events.at(-1)!.evidence).length, 2);
  const savedSales = JSON.stringify({ sellerId: order.userId, advisor: order.advisor, status: order.status,
    deliveredAt: order.deliveredAt, financials: order.financials, warrantyStarted: order.warrantyStarted, events });
  isYardSale = true;
  await click('Mi trabajo de hoy'); await page.waitForSelector('.horizon-workflow-queue');
  await page.waitForFunction(() => document.querySelector('.horizon-workflow-queue')?.textContent?.includes('Pendiente de asignación'));
  const chooseAdvisor = async (value: string) => {
    await page.$eval('.horizon-workflow-queue article label select', (node, value) => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(node, value);
      node.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  };
  await chooseAdvisor('8'); assignmentConflict = true;
  await click('Guardar responsable'); await page.waitForSelector('article [role=alert]');
  assert.match(await page.$eval('article [role=alert]', node => node.textContent || ''), /cambió/);
  assert.equal(assignmentWrites, 0);
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/workflow/tasks')), click('Actualizar tareas')]);
  await chooseAdvisor('8'); await click('Guardar responsable');
  await page.waitForFunction(() => document.querySelector('.horizon-workflow-queue article')?.textContent?.includes('Responsable: Asesor de seguimiento de prueba'));
  assert.equal(assignmentWrites, 1); assert.equal(order.userId, 999);
  await page.select('[aria-label="Operador de tareas"]', '8');
  assert.equal(await page.$$eval('.horizon-workflow-queue article', nodes => nodes.length), 1, 'Filter uses effective assignee, not seller');
  for (const width of [1440, 768, 375]) for (const theme of ['light', 'dark']) {
    await page.setViewport({ width, height: 1050 });
    await page.evaluate(value => {
      document.documentElement.classList.toggle('dark', value === 'dark'); document.documentElement.classList.toggle('light', value === 'light');
    }, theme);
    assert.equal(await page.$eval('.horizon-workflow-queue', node => node.scrollWidth > node.clientWidth + 1), false);
    if (output) await page.screenshot({ path: `${output}/followup-assignment-${width}-${theme}.png`, fullPage: true });
  }
  user.role = 'operator'; user.id = 8;
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('nav'); await click('Mi trabajo de hoy');
  await page.waitForSelector('.horizon-workflow-queue article');
  assert.equal(await page.$$eval('button', nodes => nodes.some(node => node.textContent === 'Guardar responsable')), false);
  assert.match(await page.$eval('.horizon-workflow-queue article', node => node.textContent || ''), /Responsable: Asesor de seguimiento de prueba/);
  user.id = 999;
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('nav'); await click('Mi trabajo de hoy');
  await page.waitForFunction(() => document.querySelector('.horizon-workflow-queue')?.textContent?.includes('No hay tareas para este filtro'));
  assert.equal(await page.$$eval('.horizon-workflow-queue article', nodes => nodes.length), 0);
  user.role = 'admin';
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('nav'); await click('Mi trabajo de hoy');
  await page.waitForSelector('.horizon-workflow-queue article');
  await chooseAdvisor(''); await click('Guardar responsable');
  await page.waitForFunction(() => document.querySelector('.horizon-workflow-queue article')?.textContent?.includes('Responsable: Pendiente de asignación'));
  assert.equal(assignmentWrites, 2);
  assert.equal(JSON.stringify({ sellerId: order.userId, advisor: order.advisor, status: order.status,
    deliveredAt: order.deliveredAt, financials: order.financials, warrantyStarted: order.warrantyStarted, events }), savedSales);
  console.log('PASS: assignment UI handles stale version visibly, assigns/reset yard responsibility without changing sale/history, filters by actual advisor, hides foreign tasks and assignment controls from advisors; 375/768/1440 light/dark without horizontal overflow. All API writes intercepted.');
  assert.deepEqual(errors, []);
  console.log('PASS: Registrar entrega automatically uses the customer name without editable recipient or delivery-detail text; zero-photo closure succeeds and multiple optional piece photos upload and reopen as history links. Electronic payment image remains mandatory; fully paid delivery collects no extra money; immediate yard sale and duplicate-delivery guards retained. Original cash/electronic/core/workflow regressions and responsive375/768/1440 light/dark PASS. UI writes synthetic/intercepted, no real mutations. Pixel regression inconclusive without baseline; full accessibility and Web Vitals not measured.');
} catch (reason) {
  console.error('Workflow UI failure:', { errors, body: await page.evaluate(() => document.body.innerText.slice(0, 2000)),
    validation: await page.evaluate(() => ({
      alerts: Array.from(document.querySelectorAll('form [role="alert"]')).map(node => node.textContent),
      invalid: Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('form input:invalid,form select:invalid,form textarea:invalid'))
        .map(node => ({ field: node.closest('label')?.textContent?.trim(), message: node.validationMessage })),
    })),
  });
  if (output) await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  throw reason;
} finally { await browser.close(); }
