/**
 * Arnés e2e de los overlays de /yard en Chrome real.
 *
 * Requisitos:
 * - Stack local arriba en E2E_BASE_URL (por defecto http://127.0.0.1:3000).
 * - Al menos una orden en /yard con fotos de referencia.
 *
 * Uso: npm run test:e2e
 * Credenciales: E2E_EMAIL / E2E_PASSWORD. Si no se definen, siembra y limpia
 * un usuario vendedor_yarda en el contenedor local radar-desktop-db-*.
 */
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import puppeteer from 'puppeteer-core';
import { removeLocalUser, seedLocalUser } from './seed-local.mjs';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const CHROME =
  process.env.E2E_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const EMAIL = process.env.E2E_EMAIL || 'yard-e2e@local.test';
const PASSWORD = process.env.E2E_PASSWORD || 'yard-e2e-local';
const SEEDED = !process.env.E2E_EMAIL;

let browser;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const detailOpen = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.yard-sheet')].some((sheet) =>
      sheet.textContent.includes('Detalle de patio')
    )
  );

beforeAll(async () => {
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health?.ok) {
    throw new Error(
      `No responde ${BASE}/health. Levanta el stack local: docker compose -f compose.desktop.yml up -d`
    );
  }
  if (!existsSync(CHROME)) {
    throw new Error(`No se encontró Chrome en ${CHROME}. Define E2E_CHROME con la ruta correcta.`);
  }
  if (SEEDED) seedLocalUser({ email: EMAIL, password: PASSWORD });
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: process.env.E2E_HEADLESS !== '0',
    args: ['--no-sandbox'],
  });
}, 120000);

afterAll(async () => {
  await browser?.close();
  if (SEEDED) removeLocalUser(EMAIL);
});

async function newSession() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.setViewport({
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await page.evaluateOnNewDocument(() => localStorage.setItem('radar_theme', 'light'));
  await page.goto(`${BASE}/yard`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('form input[type="text"]', { timeout: 15000 });
  await page.type('form input[type="text"]', EMAIL);
  await page.type('form input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForFunction(
    () => !!document.querySelector('input[placeholder="Buscar orden, VIN o pieza"]'),
    { timeout: 20000 }
  );
  await sleep(400);
  return { context, page, errors };
}

async function findOrderWithPhotos(page) {
  const code = await page.evaluate(async () => {
    let offset = 0;
    for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
      const response = await fetch(`/api/yard/orders?limit=50&offset=${offset}`);
      if (!response.ok) throw new Error(`La cola de patio respondió ${response.status}`);
      const data = await response.json();
      const match = data.orders.find(
        (order) => (order.yardCompatibility?.referenceImages?.length || 0) > 0
      );
      if (match) return match.code;
      if (data.nextOffset == null) break;
      offset = data.nextOffset;
    }
    return null;
  });
  if (!code) {
    throw new Error(
      'No hay órdenes con fotos de referencia en /yard. Agrega una foto desde Compatibilidad para ejecutar el arnés.'
    );
  }
  return code;
}

async function openOrder(page, code) {
  await page.type('input[placeholder="Buscar orden, VIN o pieza"]', code);
  await sleep(900);
  const opened = await page.evaluate((needle) => {
    const card = [...document.querySelectorAll('article.yard-card')].find((article) =>
      article.textContent.includes(needle)
    );
    if (!card) return false;
    card.click();
    return true;
  }, code);
  expect(opened).toBe(true);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.yard-sheet')].some((sheet) =>
        sheet.textContent.includes('Detalle de patio')
      ),
    { timeout: 10000 }
  );
  await sleep(400);
}

async function openLightbox(page) {
  const opened = await page.evaluate(() => {
    const thumbnail = document.querySelector(
      '.yard-sheet button[aria-label^="Ver foto de referencia 1"]'
    );
    if (!thumbnail) return false;
    thumbnail.click();
    return true;
  });
  expect(opened).toBe(true);
  await page.waitForFunction(() => !!document.querySelector('.yard-lightbox'), { timeout: 10000 });
  await sleep(300);
}

describe('overlays de /yard en navegador real', () => {
  it('Escape cierra solo el visor de fotos y deja el detalle abierto', async () => {
    const { context, page, errors } = await newSession();
    try {
      const code = await findOrderWithPhotos(page);
      await openOrder(page, code);
      await openLightbox(page);
      expect(await page.evaluate(() => !!document.querySelector('.yard-lightbox'))).toBe(true);
      expect(await detailOpen(page)).toBe(true);

      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.yard-lightbox'), { timeout: 5000 });
      expect(await detailOpen(page)).toBe(true);

      await page.keyboard.press('Escape');
      await page.waitForFunction(
        () =>
          ![...document.querySelectorAll('.yard-sheet')].some((sheet) =>
            sheet.textContent.includes('Detalle de patio')
          ),
        { timeout: 5000 }
      );
      expect(await page.evaluate(() => !!document.querySelector('.yard-lightbox'))).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it('el visor mantiene fondo negro y controles blancos en tema claro', async () => {
    const { context, page, errors } = await newSession();
    try {
      expect(await page.evaluate(() => document.documentElement.classList.contains('light'))).toBe(
        true
      );
      const code = await findOrderWithPhotos(page);
      await openOrder(page, code);
      await openLightbox(page);

      const styles = await page.evaluate(() => {
        const root = document.querySelector('.yard-lightbox');
        const close = root.querySelector('button[aria-label="Cerrar visor"]');
        const rootStyle = getComputedStyle(root);
        const closeStyle = getComputedStyle(close);
        const closeRect = close.getBoundingClientRect();
        return {
          background: rootStyle.backgroundColor,
          color: rootStyle.color,
          backdropFilter: rootStyle.backdropFilter,
          closeColor: closeStyle.color,
          closeWidth: Math.round(closeRect.width),
          closeHeight: Math.round(closeRect.height),
        };
      });

      const background = styles.background.match(/[\d.]+/g).map(Number);
      expect(background.slice(0, 3)).toEqual([0, 0, 0]);
      expect(background[3] ?? 1).toBeGreaterThanOrEqual(0.7);
      expect(styles.backdropFilter).toBe('none');
      expect(styles.color).toBe('rgb(255, 255, 255)');

      const closeColor = styles.closeColor.match(/[\d.]+/g).map(Number);
      expect(closeColor.slice(0, 3).every((channel) => channel >= 200)).toBe(true);
      expect(styles.closeWidth).toBe(44);
      expect(styles.closeHeight).toBe(44);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
