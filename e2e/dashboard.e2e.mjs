/**
 * Arnés e2e del dashboard en Chrome real.
 *
 * Requisitos:
 * - Stack local arriba en E2E_BASE_URL (por defecto http://127.0.0.1:3000).
 * - Datos locales con tareas accionables (los fixtures ORD-TEST-* las generan).
 *
 * Uso: npm run test:e2e
 * Siembra y elimina usuarios admin/operator temporales en radar-desktop-db-*.
 */
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import puppeteer from 'puppeteer-core';
import { removeLocalUser, seedLocalUser } from './seed-local.mjs';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const CHROME =
  process.env.E2E_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const ADMIN = {
  email: 'dashboard-admin-e2e@local.test',
  password: 'dashboard-admin-e2e',
  role: 'admin',
  name: 'Admin Dashboard E2E',
};
const OPERATOR = {
  email: 'dashboard-operator-e2e@local.test',
  password: 'dashboard-operator-e2e',
  role: 'operator',
  name: 'Operador Dashboard E2E',
};

let browser;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openSession(credentials, viewport = { width: 1440, height: 900 }) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  const responses = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('response', (response) => {
    if (response.url().includes('/api/')) {
      responses.push({ url: response.url(), status: response.status() });
    }
  });
  await page.setViewport(viewport);
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('form input[type="email"]', { timeout: 20000 });
  await page.type('form input[type="email"]', credentials.email);
  await page.type('form input[type="password"]', credentials.password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('header.horizon-topbar', { timeout: 30000 });
  return { context, page, errors, responses };
}

async function goToDashboard(page) {
  if (await page.$('.horizon-dashboard')) return;
  const clicked = await page.evaluate(() => {
    const target = [...document.querySelectorAll('button, a')].find(
      (element) => element.textContent?.trim() === 'Dashboard',
    );
    if (!target) return false;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  });
  if (!clicked) {
    await page.keyboard.down('Meta');
    await page.keyboard.press('k');
    await page.keyboard.up('Meta');
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
    await page.evaluate(() => {
      const target = [...document.querySelectorAll('[role="dialog"] button')].find((element) =>
        element.textContent?.includes('Panorama General'),
      );
      target?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }
  await page.waitForSelector('.horizon-dashboard', { timeout: 20000 });
}

beforeAll(async () => {
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health?.ok) {
    throw new Error(
      `No responde ${BASE}/health. Levanta el stack local: docker compose -f compose.desktop.yml up -d`,
    );
  }
  if (!existsSync(CHROME)) {
    throw new Error(`No se encontró Chrome en ${CHROME}. Define E2E_CHROME con la ruta correcta.`);
  }
  seedLocalUser(ADMIN);
  seedLocalUser(OPERATOR);
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: process.env.E2E_HEADLESS !== '0',
    args: ['--no-sandbox'],
  });
}, 120000);

afterAll(async () => {
  await browser?.close();
  removeLocalUser(ADMIN.email);
  removeLocalUser(OPERATOR.email);
});

describe('dashboard en navegador real', () => {
  it('el asesor ve la vista operativa sin llamar a finanzas ni mostrar ceros falsos', async () => {
    const { context, page, errors, responses } = await openSession(OPERATOR);
    await goToDashboard(page);
    await page.waitForFunction(
      () => document.querySelector('.horizon-dashboard')?.textContent?.includes('Vista operativa'),
      { timeout: 20000 },
    );
    const text = await page.$eval('.horizon-dashboard', (element) => element.textContent || '');
    expect(text).toContain('Vista operativa');
    expect(text).not.toContain('Ingresos netos del período');
    expect(text).not.toContain('Cobros del período');
    expect(text).not.toContain('No disponible');
    const financeCalls = responses.filter((response) => response.url.includes('/analytics/income'));
    expect(financeCalls.filter((call) => call.status === 403)).toEqual([]);
    expect(financeCalls).toHaveLength(0);
    expect(errors).toEqual([]);
    await context.close();
  });

  it('el admin con tareas pendientes ve el aviso de jornada y vuelve al dashboard', async () => {
    const { context, page, errors } = await openSession(ADMIN);
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('[role="status"]')].some((element) =>
          /Tienes \d+ tareas pendientes/.test(element.textContent || ''),
        ),
      { timeout: 25000 },
    );
    const hasDashboardLink = await page.evaluate(() =>
      [...document.querySelectorAll('button')].some(
        (element) => element.textContent?.trim() === 'Ir al dashboard',
      ),
    );
    expect(hasDashboardLink).toBe(true);
    await page.evaluate(() => {
      const target = [...document.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === 'Ir al dashboard',
      );
      target?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForSelector('.horizon-dashboard', { timeout: 20000 });
    expect(errors).toEqual([]);
    await context.close();
  });

  it('el header no desborda y la búsqueda sigue accesible a 390 y 320 px', async () => {
    const { context, page, errors } = await openSession(ADMIN, {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    for (const width of [390, 320]) {
      await page.setViewport({
        width,
        height: 844,
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      });
      await sleep(350);
      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        headerRight: document.querySelector('header.horizon-topbar')?.getBoundingClientRect().right ?? 0,
      }));
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
      expect(metrics.headerRight).toBeLessThanOrEqual(metrics.innerWidth + 1);
    }
    const searchVisible = await page.evaluate(() =>
      [...document.querySelectorAll('[aria-label="Buscar"]')].some((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= window.innerWidth + 1;
      }),
    );
    expect(searchVisible).toBe(true);
    await page.evaluate(() => {
      const target = [...document.querySelectorAll('[aria-label="Buscar"]')].find(
        (element) => element.getBoundingClientRect().width > 0,
      );
      target?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
    await context.close();
  });
});
