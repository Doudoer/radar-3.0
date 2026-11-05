import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import puppeteer, { type Page } from 'puppeteer-core';
import { type Claim, type Customer, type InventoryPart, type Order, type RefundRequest } from '../src/types';
import { type FinanceState } from '../src/hooks/useFinanceState';
import { financeDateKey, shiftDateKey } from '../src/utils/finance';
import { getWeekRange } from '../src/utils/orderAnalytics';

const baseUrl = process.env.HORIZON_TEST_URL || 'http://127.0.0.1:3000';
const target = new URL(baseUrl);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname), 'Visual checks must run against a local frontend only.');
const output = process.env.HORIZON_SCREENSHOT_DIR;
if (output) await mkdir(output, { recursive: true });

const user = { id: 999, name: 'Administrador de prueba', email: 'visual@example.test', role: 'admin', permissions: [] };
const customer: Customer = {
  id: '901', name: 'Cliente de prueba', type: 'Particular', email: 'cliente@example.test',
  phone: '2025550100', location: 'Ciudad de prueba', initials: 'CP',
};
const order: Order = {
  id: '901', version: 1, code: 'ORD-PRUEBA-901', createdAt: new Date().toISOString(),
  advisor: user.name, userId: user.id, status: 'en_preparacion', mainPart: 'Motor',
  customer, vehicle: { vin: '', plate: '', make: 'Toyota', model: 'Corolla', year: 2020, mileage: '50000', color: 'Blanco' },
  workflowStep: 1, financials: { partPrice: 1000, downPayment: 200, subtotal: 1000, total: 1000, balanceDue: 800 },
  inventoryAvailability: { state: 'none', availableCount: 0, candidates: [] },
  warrantyDays: 30, warrantyStarted: false, deliveryType: 'retiro_tienda',
};
const claim: Claim = {
  id: 'REC-PRUEBA-901', orderId: order.id, orderCode: order.code,
  customerName: customer.name, customerPhone: customer.phone, vehicle: '2020 Toyota Corolla',
  mainPart: order.mainPart, claimReason: 'Revisión de la pieza de prueba', type: 'Garantía',
  priority: 'Media', status: 'Pending', previousOrderStatus: 'entregado', advisor: user.name,
  createdAt: order.createdAt, calls: [], callCount: 0,
};
const refund: RefundRequest = {
  id: 'REF-PRUEBA-901', orderId: order.id, orderCode: order.code, customerName: customer.name,
  vehicle: claim.vehicle, part: order.mainPart, reason: 'Solicitud de prueba', amount: 200,
  amountType: 'downpayment', paymentMethod: 'Zelle', paymentDetails: 'Cuenta de prueba',
  status: 'pending', createdAt: order.createdAt,
};
const inventoryPart: InventoryPart = {
  id: '901', year: '2020', brand: 'Toyota', model: 'Corolla', partType: 'Motor',
  status: 'Disponible', palletNumber: 'PAL-PRUEBA', engineSpecs: '2.0L', price: 1000,
};
const financeState: FinanceState = {
  version: 1, employees: [{ id: '901', name: 'Colaborador de prueba', weeklySalary: 500, role: 'Operaciones' }],
  recurringExpenses: [], otherExpenses: [],
};
const responses: Record<string, unknown> = {
  '/api/auth/me': { user },
  '/api/orders': [order],
  '/api/orders/901': order,
  '/api/orders/901/followups': [],
  '/api/customers': [customer],
  '/api/activities': [],
  '/api/analytics/income': [
    { id: 901, orderId: '901', kind: 'payment', amount: 200, effectiveAt: financeDateKey(getWeekRange(0).start), source: 'order_payment' },
    { id: 902, orderId: '901', kind: 'refund', amount: 50, effectiveAt: shiftDateKey(financeDateKey(getWeekRange(0).start), 1), source: 'refund_payment' },
  ],
  '/api/orders/followups/pending': { items: [], pendingCount: 0, overdueCount: 0 },
  '/api/workflow/tasks': { tasks: [], today: financeDateKey(new Date()), operators: [] },
  '/api/users': [user],
  '/api/claims': [claim],
  '/api/refunds': [refund],
  '/api/claims/REC-PRUEBA-901/calls': [],
  '/api/inventory': [inventoryPart],
  '/api/finance/state': financeState,
  '/api/finance/movements': [],
  '/api/me/notes': { content: '' },
  '/api/me/message-users': [],
  '/api/me/messages': [],
  '/api/auth/2fa/status': { configured: false },
  '/api/auth/2fa/vault': { unlocked: false },
  '/api/wasender/status': { configured: false, connected: false },
  '/api/wasender/channels': [],
  '/api/wasender/external-contacts': [],
  '/api/wasender/notifications/config': { channels: [], operators: [], externalContacts: [], sandboxInfo: null },
  '/api/system/backups': [],
};

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const errors: string[] = [];
const page = await browser.newPage();
const pending = new Set<string>();
let stage = 'initial dashboard';
page.on('pageerror', error => errors.push(String(error)));
await page.setRequestInterception(true);
page.on('request', request => {
  const url = new URL(request.url());
  pending.add(url.pathname);
  if (url.origin === target.origin && url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/events') {
      void request.respond({ status: 200, contentType: 'text/event-stream', body: ': isolated visual test\n\n' });
    } else if (url.pathname === '/api/finance/vault/status') {
      void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ unlocked: false }) });
    } else if (request.method() !== 'GET' || !(url.pathname in responses)) {
      errors.push(`Unexpected API request: ${request.method()} ${url.pathname}`);
      void request.respond({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: 'Unexpected request in isolated visual test' }) });
    } else {
      void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(responses[url.pathname]) });
    }
  } else if (url.origin !== target.origin && request.resourceType() === 'image') {
    void request.respond({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#e9e3ff"/><circle cx="20" cy="15" r="6" fill="#422afb"/><path d="M8 36a12 12 0 0 1 24 0" fill="#422afb"/></svg>' });
  } else if (url.origin !== target.origin && ['http:', 'https:'].includes(url.protocol)) {
    void request.abort();
  } else {
    void request.continue();
  }
});
page.on('requestfinished', request => pending.delete(new URL(request.url()).pathname));
page.on('requestfailed', request => pending.delete(new URL(request.url()).pathname));
await page.evaluateOnNewDocument(() => {
  sessionStorage.setItem('radar_authenticated', 'true');
  localStorage.setItem('radar_theme', 'light');
});

async function screenshot(name: string) {
  await page.evaluate(() => { const main = document.querySelector('main'); if (main) main.scrollTop = 0; });
  if (output) await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: false });
}
async function clickText(selector: string, text: string) {
  await page.waitForFunction((selector, text) => Array.from(document.querySelectorAll(selector))
    .some(node => node.textContent?.includes(text)), {}, selector, text);
  await page.evaluate((selector, text) => {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>(selector)).find(node => node.textContent?.includes(text));
    if (!button) throw new Error(`Button not found: ${text}`);
    button.click();
  }, selector, text);
}
async function settled() {
  await page.waitForFunction(() => !document.querySelector('[role="status"][aria-live="polite"]'));
  await page.waitForFunction(() => !document.querySelector('main')?.textContent?.includes('Cargando módulo...'));
  await page.waitForNetworkIdle({ idleTime: 150 });
}
async function style(selector: string) {
  return page.$eval(selector, element => {
    const css = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return {
      background: css.backgroundColor, color: css.color, radius: css.borderRadius,
      font: css.fontFamily, width: bounds.width, height: bounds.height, top: bounds.top, bottom: bounds.bottom,
    };
  });
}
async function noViewportOverflow(page: Page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Page must not overflow horizontally.');
  assert.ok(await page.$eval('.horizon-topbar', header => Array.from(header.querySelectorAll('button'))
    .filter(button => button.getBoundingClientRect().width > 0)
    .every(button => {
      const bounds = button.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= innerWidth;
    })), 'Header actions must stay visible, not clipped.');
}
async function switchTheme(theme: 'light' | 'dark') {
  await page.click(`button[aria-label="Activar modo ${theme === 'light' ? 'claro' : 'oscuro'}"]`);
  await page.waitForFunction((theme) => {
    const card = document.querySelector('.horizon-kpis > div');
    return !card || getComputedStyle(card).backgroundColor === (theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(17, 28, 68)');
  }, {}, theme);
  await page.waitForFunction(() => document.getAnimations().every(animation => !(animation instanceof CSSTransition)));
}
async function closeModal() {
  await page.keyboard.press('Escape');
  if (await page.$('.horizon-modal')) {
    await page.evaluate(() => {
      const close = Array.from(document.querySelectorAll<HTMLButtonElement>('.horizon-modal button'))
        .find(button => ['close', 'Volver', 'Cerrar'].includes(button.textContent?.trim() || '') || button.textContent?.includes('Cancelar'));
      if (!close) throw new Error('Modal close control missing');
      close.click();
    });
  }
  await page.waitForFunction(() => !document.querySelector('.horizon-modal'));
}

try {
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.horizon-sidebar');
  await settled();
  await page.evaluate(() => document.fonts.ready);
  assert.ok(await page.evaluate(() => document.fonts.check('16px "DM Sans Variable"') &&
    document.fonts.check('24px "Material Symbols Outlined Variable"')), 'Self-hosted content and icon fonts must load.');
  assert.equal(await page.$$('.horizon-stat-icon').then(nodes => nodes.length), 6, 'Main Dashboard must have six real Radar statistics.');
  assert.ok(await page.$eval('.horizon-stat', card => {
    const icon = card.querySelector('.horizon-stat-icon')!.getBoundingClientRect();
    const value = card.querySelector('.horizon-stat-value')!.getBoundingClientRect();
    return icon.right <= value.left && card.getBoundingClientRect().height <= 110 && card.getBoundingClientRect().top < 180;
  }), 'Statistics must place icons beside values, not retain the old tall HUD layout.');
  assert.ok(await page.$eval('.horizon-kpis', grid =>
    new Set([...grid.children].map(child => Math.round(child.getBoundingClientRect().top))).size === 1), 'Desktop statistics must occupy one row like the reference.');
  assert.ok(await page.$eval('.horizon-chart-grid', grid => {
    const [left, right] = [...grid.children].map(child => child.getBoundingClientRect());
    return Math.abs(left.width - right.width) <= 2 && Math.abs(left.top - right.top) <= 2;
  }), 'Primary charts must have equal width like Main Dashboard.');
  assert.ok(await page.$eval('.horizon-dashboard-lower', grid => grid.getBoundingClientRect().top < 650), 'Table and pie modules must be above the fold at desktop scale.');
  assert.ok(await page.$('.horizon-net-line'));
  assert.ok(await page.$('.horizon-income-chart [data-income="positive"]'));
  assert.ok(await page.$('.horizon-income-chart [data-income="negative"]'));
  await screenshot('before-or-after-dashboard');
  assert.equal((await style('main')).background, 'rgb(244, 247, 254)', 'Horizon workspace must use the pale background, not the card background.');
  assert.ok((await style('main')).width > 500 && (await style('main')).height > 500, 'The workspace must remain visible.');
  assert.equal((await style('.horizon-sidebar')).width, 270);
  assert.equal((await style('.horizon-nav-item[aria-current="page"]')).background, 'rgba(0, 0, 0, 0)');
  assert.ok((await style('.horizon-topbar')).font.includes('DM Sans'));
  assert.ok((await style('.horizon-topbar .material-symbols-outlined')).font.includes('Material Symbols Outlined'));
  const primary = await style('.horizon-topbar .horizon-primary');
  assert.equal(primary.background, 'rgb(66, 42, 251)');
  assert.equal(primary.color, 'rgb(255, 255, 255)');
  await noViewportOverflow(page);
  await page.setViewport({ width: 1150, height: 1000 });
  await noViewportOverflow(page);
  assert.ok(await page.$eval('.horizon-kpis', grid =>
    new Set([...grid.children].map(child => Math.round(child.getBoundingClientRect().top))).size === 1), 'The shared 1150px Mac window must retain the six-statistic reference row.');
  assert.ok(await page.$$eval('.horizon-stat', cards => cards.every(card => card.getBoundingClientRect().height <= 110)), 'Reference statistics must stay compact at the actual Mac window width.');
  assert.ok(await page.$$eval('.horizon-stat-value', values => values.every(value => value.scrollWidth <= value.clientWidth)), 'Test currency values must not wrap or clip in the real Mac window.');
  assert.ok(await page.$eval('.horizon-chart-grid', grid => {
    const [left, right] = [...grid.children].map(child => child.getBoundingClientRect());
    return Math.abs(left.top - right.top) <= 2 && Math.abs(left.width - right.width) <= 2;
  }), 'The shared 1150px Mac window must show two charts side by side.');
  await screenshot('dashboard-1150');
  await page.setViewport({ width: 1440, height: 1000 });
  stage = 'dashboard period controls';
  await clickText('.horizon-period-tabs button', 'Mes');
  await settled();
  assert.equal(await page.$eval('.horizon-period-tabs button[aria-pressed="true"]', button => button.textContent?.includes('Mes')), true);
  await page.click('button[title="Período anterior"]');
  await settled();
  await page.click('button[title="Volver a la semana operativa actual en curso"]');
  await settled();
  assert.equal(await page.$eval('button[title="Período siguiente"]', button => (button as HTMLButtonElement).disabled), true);
  await clickText('.horizon-period-tabs button', 'Año');
  await settled();
  await page.click('button[title="Volver a la semana operativa actual en curso"]');
  await settled();

  for (const destination of ['Lista de Órdenes', 'Inventario & HOLD', 'Clientes CRM', 'Reclamos', 'Reembolsos', 'Mis Operaciones', 'Relación Semanal', 'Sistema', 'Usuarios', 'Dashboard']) {
    stage = destination;
    await clickText('aside button', destination);
    await settled();
    if (destination !== 'Dashboard') {
      assert.ok(await page.$('.horizon-view, .horizon-vault'), `${destination} must participate in the shared Horizon view layout.`);
    }
    assert.equal(await page.$$eval('[aria-current="page"]', nodes => nodes.length), 1);
    await noViewportOverflow(page);
    if (destination === 'Lista de Órdenes') {
      assert.equal(await page.$eval('main h2', node => node.textContent?.trim()), 'Gestión de órdenes');
      assert.equal(await page.$$('.horizon-order-segments button[aria-pressed="true"]').then(nodes => nodes.length), 1);
      await clickText('.horizon-order-segments button', 'Archivadas');
      await settled();
      assert.equal(await page.$eval('.horizon-order-segments button[aria-pressed="true"]', node => node.textContent?.includes('Archivadas')), true);
      await clickText('.horizon-order-segments button', 'Órdenes Activas');
      await settled();
    }
    await screenshot(`view-${destination.toLowerCase().replace(/[^a-z]+/g, '-')}`);
  }

  stage = 'order detail';
  await clickText('aside button', 'Lista de Órdenes');
  await page.waitForSelector('tbody tr');
  await page.click('tbody tr');
  await settled();
  assert.ok(await page.$('.horizon-order-detail'));
  assert.equal((await style('.horizon-detail-tabs button[aria-pressed="true"]')).background, 'rgba(0, 0, 0, 0)');
  assert.equal((await style('.horizon-detail-tabs button[aria-pressed="true"]')).color, 'rgb(66, 42, 251)');
  assert.equal((await style('.horizon-detail-grid')).width > 500, true);
  assert.ok(await page.$eval('.horizon-detail-grid', grid => {
    const cards = [...grid.children].map(card => card.getBoundingClientRect());
    return cards.every(card => Math.abs(card.top - cards[0].top) < 2);
  }), 'Order summary must use the shared Horizon card grid.');
  await screenshot('order-detail');
  await noViewportOverflow(page);
  await clickText('aside button', 'Dashboard');
  await settled();

  stage = 'new order dialog';
  await clickText('header button', 'Nueva Orden');
  await page.waitForSelector('.horizon-modal');
  assert.equal((await style('.horizon-modal > div')).radius, '20px');
  assert.equal((await style('.horizon-modal > div')).background, 'rgb(255, 255, 255)');
  await screenshot('new-order-light');
  assert.ok(await page.$eval('.horizon-order-dialog form .horizon-order-fieldset', section =>
    Number.parseFloat(getComputedStyle(section).paddingLeft) >= 16), 'Form fields must have inner spacing.');
  await closeModal();
  stage = 'profile dialog';
  await page.click('button[title^="Mi Perfil"]');
  await page.waitForSelector('.horizon-modal');
  assert.equal(await page.$eval('.horizon-modal h3', heading => getComputedStyle(heading).textTransform), 'none');
  await screenshot('profile-light');
  await closeModal();
  stage = 'search dialog';
  await page.click('.horizon-topbar input');
  await page.waitForSelector('.horizon-modal');
  await screenshot('search-light');
  await closeModal();
  stage = 'followup dialog';
  await clickText('header button', 'Seguimiento');
  await page.waitForSelector('.horizon-workflow-queue');
  await clickText('main button', 'Seguimiento histórico');
  await page.waitForSelector('.horizon-followup-portal');
  assert.equal((await style('.horizon-followup-panel')).background, 'rgb(255, 255, 255)');
  await screenshot('followups-light');
  await closeModal();
  await clickText('.horizon-sidebar button', 'Dashboard');
  await settled();

  stage = 'dark mode';
  await switchTheme('dark');
  assert.equal((await style('main')).background, 'rgb(11, 20, 55)');
  assert.equal((await style('.horizon-kpis > div')).background, 'rgb(17, 28, 68)');
  await screenshot('dashboard-dark');
  await clickText('header button', 'Nueva Orden');
  await page.waitForSelector('.horizon-modal');
  assert.equal((await style('.horizon-modal > div')).background, 'rgb(17, 28, 68)');
  await screenshot('new-order-dark');
  await closeModal();

  for (const width of [768, 375]) {
    stage = `viewport ${width}`;
    await page.setViewport({ width, height: 900 });
    await page.waitForFunction(() => innerWidth >= 768 || document.querySelector('aside')!.getBoundingClientRect().right <= 0);
    await switchTheme('light');
    await noViewportOverflow(page);
    await screenshot(`dashboard-${width}`);
    assert.ok(await page.$eval('button[title="Actualizar telemetría"]', button => button.getBoundingClientRect().width > 0), 'Dashboard refresh must remain available at every breakpoint.');
    if (width === 375) {
      await page.click('button[aria-label="Abrir menú"]');
      assert.ok((await style('.horizon-sidebar')).width <= width);
      await clickText('aside button', 'Lista de Órdenes');
      await page.waitForFunction(() => document.querySelector('aside')!.getBoundingClientRect().right <= 0);
      await settled();
      await noViewportOverflow(page);
    }
    if (width >= 1024) await page.click('.horizon-topbar input');
    else await page.click('button[aria-label="Buscar"]');
    await page.waitForSelector('.horizon-modal');
    const modal = await style('.horizon-modal > div');
    assert.ok(modal.width <= width && modal.top >= 0 && modal.bottom <= 900);
    await screenshot(`search-${width}`);
    await closeModal();
    if (width === 375) {
      stage = 'mobile new order';
      await clickText('main button', 'Crear Orden');
      await page.waitForSelector('.horizon-modal');
      const form = await style('.horizon-modal > div');
      assert.ok(form.width <= width && form.top >= 0 && form.bottom <= 900);
      assert.ok(await page.$eval('.horizon-modal form', form => form.scrollHeight > form.clientHeight), 'The mobile form must remain scrollable.');
      await screenshot('new-order-375');
      await closeModal();
    }
    await switchTheme('dark');
  }
  responses['/api/auth/2fa/vault'] = { unlocked: true, expiresAt: Date.now() + 30 * 60 * 1000 };
  const destinations = ['Lista de Órdenes', 'Inventario & HOLD', 'Clientes CRM', 'Reclamos', 'Reembolsos', 'Mis Operaciones', 'Relación Semanal', 'Sistema', 'Usuarios', 'Dashboard'];
  async function navigate(destination: string) {
    stage = destination;
    await clickText('aside button', destination);
    await settled();
    if (destination === 'Relación Semanal') await page.waitForSelector('.horizon-view-header');
  }
  async function checkDialog(name: string, theme: 'light' | 'dark', width: number) {
    stage = `${name} ${theme} ${width}`;
    await page.waitForSelector('.horizon-modal');
    await settled();
    const panel = await style('.horizon-modal > :is(div, form)');
    assert.equal((await style('.horizon-modal')).width, width, `${name}: overlay must cover the viewport, not only the view`);
    assert.equal(panel.background, theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(17, 28, 68)', `${name}: shared panel surface`);
    assert.ok(panel.width <= width && panel.top >= 0 && panel.bottom <= 900, `${name}: panel must fit viewport`);
    assert.ok(await page.$eval('.horizon-modal', modal => modal.scrollWidth <= modal.clientWidth), `${name}: no horizontal modal overflow`);
    assert.ok(await page.$eval('.horizon-modal > :is(div, form)', panel => {
      const bounds = panel.getBoundingClientRect();
      return [...panel.querySelectorAll('button')].every(button => {
        const rect = button.getBoundingClientRect();
        return rect.width === 0 || (rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1);
      });
    }), `${name}: actions must not extend past the dialog panel`);
    assert.ok(await page.$$eval('.horizon-modal :is(h2, h3)', headings => headings.every(heading =>
      getComputedStyle(heading).fontFamily.includes('DM Sans') && getComputedStyle(heading).textTransform === 'none')), `${name}: Horizon heading typography`);
    await screenshot(`${name}-${theme}-${width}`);
    await closeModal();
  }
  for (const theme of ['light', 'dark'] as const) {
    await switchTheme(theme);
    for (const width of [1440, 1150, 768, 375]) {
      await page.setViewport({ width, height: 900 });
      for (const destination of destinations) {
        await navigate(destination);
        await noViewportOverflow(page);
        await screenshot(`global-${destination.toLowerCase().replace(/[^a-z]+/g, '-')}-${theme}-${width}`);
      }
      await navigate('Lista de Órdenes');
      await page.waitForSelector('tbody tr');
      await page.click('tbody tr');
      await settled();
      await noViewportOverflow(page);
      await screenshot(`detail-${theme}-${width}`);
      for (const tab of ['Flujo', 'Historial', 'Resumen']) {
        await clickText('.horizon-detail-tabs button', tab);
        await settled();
        assert.equal(await page.$eval('.horizon-detail-tabs button[aria-pressed="true"]', (button, tab) => button.textContent?.includes(tab), tab), true);
        await noViewportOverflow(page);
      }
      if (width === 1150 || width === 375) {
        await page.click('button[title="Modificar o reasignar el asesor de esta orden (Super Admin)"]');
        await checkDialog('reassign-advisor', theme, width);
        await page.click('button[title="Enviar WhatsApp o SMS al cliente"]');
        await checkDialog('messaging', theme, width);
        await page.click('button[title="Solicitar reembolso"]');
        await settled();
        await noViewportOverflow(page);
        await screenshot(`refund-form-${theme}-${width}`);

        await navigate('Clientes CRM');
        await clickText('main button', 'Nuevo Cliente');
        await checkDialog('new-client', theme, width);
        await page.click('button[title="Ver Ficha / Editar en Asistente de 2 Pasos"]');
        await checkDialog('edit-client', theme, width);

        await navigate('Inventario & HOLD');
        await clickText('main button', 'Agregar Pieza');
        await checkDialog('new-inventory', theme, width);
        await page.click('button[title="Editar pieza"]');
        await checkDialog('edit-inventory', theme, width);
        await page.click('tr[title^="Clic para ver ficha"]');
        await checkDialog('inventory-detail', theme, width);
        await clickText('main button', 'Imprimir por Marcas');
        await checkDialog('inventory-print', theme, width);

        await navigate('Reclamos');
        await clickText('main button', 'Nuevo reclamo');
        await checkDialog('new-claim', theme, width);
        await clickText('main button', 'Detalle y llamadas');
        await settled();
        await noViewportOverflow(page);
        await screenshot(`claim-detail-${theme}-${width}`);
        await clickText('main button', 'Ver Bitácora');
        await checkDialog('claim-calls', theme, width);

        await navigate('Usuarios');
        await clickText('main button', 'Nuevo Colaborador');
        await checkDialog('new-user', theme, width);

        await navigate('Mis Operaciones');
        await clickText('main button', 'Traspaso de Venta');
        await checkDialog('transfer-order', theme, width);

        await navigate('Relación Semanal');
        await clickText('main button', 'Nómina Empleados');
        await checkDialog('payroll', theme, width);
        await clickText('main button', 'Gastos Recurrentes');
        await checkDialog('recurring-expenses', theme, width);
        await clickText('.horizon-view-tabs button', 'Relación General');
        await clickText('main button', 'Nuevo Gasto');
        await checkDialog('new-expense', theme, width);
      }
      await navigate('Dashboard');
    }
  }
  assert.deepEqual(errors, [], 'No runtime errors or unexpected API calls.');
  console.log('PASS: all 10 destinations plus order/claim/refund subviews at 1440/1150/768/375px in both themes; 15 additional dialog variants at 1150/375px; locked/unlocked finance fixtures; no API mutations.');
} catch (error) {
  console.error(`Visual check failed at ${stage}. Pending paths: ${[...pending].join(', ')}. Runtime/API errors: ${errors.join('; ')}`);
  await screenshot('failed-check');
  throw error;
} finally {
  await browser.close();
}
