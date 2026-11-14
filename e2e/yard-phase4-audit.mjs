/**
 * Fase 4 del PLAN_AUDITORIA_UI_UX: capturas responsive del portal de patio
 * (390/768/1280/1440/1920) y barrido de accesibilidad equivalente a axe.
 *
 * Requisitos: stack local arriba (radar-desktop-*). Siembra un usuario
 * vendedor_yarda temporal y lo elimina al terminar.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { removeLocalUser, seedLocalUser } from './seed-local.mjs';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const CHROME =
  process.env.E2E_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const EMAIL = process.env.E2E_EMAIL || 'yard-phase4@local.test';
const PASSWORD = process.env.E2E_PASSWORD || 'yard-phase4-local';
// Captures show real customers: keep them out of the repo.
const OUT = process.env.E2E_CAPTURE_DIR || path.join(os.tmpdir(), 'radar-capturas-fase4');

const VIEWPORTS = [
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '768', width: 768, height: 1024 },
  { name: '1280', width: 1280, height: 800 },
  { name: '1440', width: 1440, height: 900 },
  { name: '1920', width: 1920, height: 1080 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;

async function newSession(viewport) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setViewport({
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 2,
    isMobile: Boolean(viewport.mobile),
    hasTouch: Boolean(viewport.mobile),
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
  await sleep(500);
  return { page, errors, context };
}

async function shot(page, name) {
  await sleep(250);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}

async function openFirstSheet(page) {
  await page.evaluate(() => {
    const card = document.querySelector('.yard-card');
    const trigger = card?.querySelector('button') || card;
    trigger?.click();
  });
  await page.waitForSelector('.yard-sheet', { timeout: 5000 });
  await sleep(350);
}

async function closeSheet(page) {
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => !document.querySelector('.yard-sheet'), { timeout: 5000 });
  await sleep(200);
}

const auditFn = () => {
  const results = {
    unnamedControls: [],
    smallTargets: [],
    lowContrast: [],
    imagesWithoutAlt: [],
    dialogs: [],
    notes: [],
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return (
      r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0
    );
  };
  const textOf = (el) =>
    (el.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 48);
  const accName = (el) => {
    const aria = (el.getAttribute('aria-label') || '').trim();
    if (aria) return aria;
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const t = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ')
        .trim();
      if (t) return t;
    }
    const own = (el.textContent || '').trim();
    if (own) return own;
    const title = (el.getAttribute('title') || '').trim();
    if (title) return title;
    const img = el.querySelector('img[alt]');
    return (img?.getAttribute('alt') || '').trim();
  };
  const parseColor = (value) => {
    const m = value.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const blend = (fg, bg) => {
    const a = fg.a;
    return {
      r: fg.r * a + bg.r * (1 - a),
      g: fg.g * a + bg.g * (1 - a),
      b: fg.b * a + bg.b * (1 - a),
      a: 1,
    };
  };
  const luminance = ({ r, g, b }) => {
    const ch = [r, g, b].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const ratio = (a, b) => {
    const l1 = luminance(a);
    const l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const effectiveBackground = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const s = getComputedStyle(node);
      if (s.backgroundImage && s.backgroundImage !== 'none') return null;
      const c = parseColor(s.backgroundColor);
      if (c && c.a > 0.05) return c;
      node = node.parentElement;
    }
    const body = getComputedStyle(document.body).backgroundColor;
    return parseColor(body) || { r: 255, g: 255, b: 255, a: 1 };
  };

  const scope = document.querySelector('.yard-app') || document.body;

  const controls = Array.from(
    scope.querySelectorAll(
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="link"], [role="switch"]'
    )
  );
  for (const el of controls) {
    if (!visible(el)) continue;
    const name = accName(el);
    const tag = el.tagName.toLowerCase();
    const isIconBtn = el.classList.contains('yard-icon-btn') || el.querySelector('.material-symbols-outlined');
    if (!name) {
      results.unnamedControls.push({ tag, html: el.outerHTML.slice(0, 140) });
    }
    const inlineLink = tag === 'a' && getComputedStyle(el).display === 'inline';
    if (inlineLink || el.type === 'file') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) {
      results.smallTargets.push({
        tag,
        name: name.slice(0, 40),
        w: Math.round(r.width),
        h: Math.round(r.height),
        iconOnly: Boolean(isIconBtn),
      });
    }
  }

  const textNodes = Array.from(scope.querySelectorAll('*')).filter((el) => {
    if (!visible(el)) return false;
    if (['SCRIPT', 'STYLE', 'SVG', 'OPTION'].includes(el.tagName)) return false;
    return Array.from(el.childNodes).some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim().length > 1
    );
  });
  for (const el of textNodes) {
    const s = getComputedStyle(el);
    const fg = parseColor(s.color);
    const bg = effectiveBackground(el);
    if (!fg || !bg) continue;
    const composed = fg.a < 1 ? blend(fg, bg) : fg;
    const size = parseFloat(s.fontSize);
    const bold = Number(s.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const req = large ? 3 : 4.5;
    const cr = ratio(composed, bg);
    if (cr < req) {
      results.lowContrast.push({
        text: textOf(el),
        color: s.color,
        bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
        size,
        bold,
        ratio: Math.round(cr * 100) / 100,
        required: req,
        cls: String(el.className).slice(0, 60),
      });
    }
  }

  for (const img of Array.from(scope.querySelectorAll('img'))) {
    if (!visible(img)) continue;
    if (!(img.getAttribute('alt') || '').trim()) {
      results.imagesWithoutAlt.push(img.getAttribute('src')?.slice(0, 80) || '(sin src)');
    }
  }

  for (const dialog of Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))) {
    if (!visible(dialog)) continue;
    const name = accName(dialog);
    const focusInside = dialog.contains(document.activeElement);
    results.dialogs.push({
      name: name.slice(0, 60),
      ariaModal: dialog.getAttribute('aria-modal'),
      focusInside,
    });
  }

  results.notes.push(`viewport=${window.innerWidth}x${window.innerHeight}`);
  results.notes.push(`docScrollWidth=${document.documentElement.scrollWidth}`);
  return results;
};

async function focusTrapCheck(page) {
  return page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const result = { openedFocusInside: false, cyclesStayedInside: true, closedFocusRestored: false, target: null };
    const cardButton = document.querySelector('.yard-card button');
    const target = cardButton || document.querySelector('.yard-card');
    target?.focus();
    result.target = target ? (target.getAttribute('aria-label') || target.textContent.trim().slice(0, 30)) : null;
    target?.click();
    await sleep(400);
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (!dialog) return { ...result, error: 'dialog not found' };
    result.openedFocusInside = dialog.contains(document.activeElement);
    for (let i = 0; i < 12; i += 1) {
      const focusables = Array.from(
        dialog.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      const idx = focusables.indexOf(document.activeElement);
      const next = focusables[(idx + 1) % focusables.length];
      next?.focus();
      if (!dialog.contains(document.activeElement)) result.cyclesStayedInside = false;
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await sleep(400);
    const closed = !document.querySelector('.yard-sheet');
    result.closedFocusRestored = closed && document.activeElement === target;
    return result;
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (!process.env.E2E_EMAIL) seedLocalUser({ email: EMAIL, password: PASSWORD, role: 'vendedor_yarda' });
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: process.env.E2E_HEADLESS !== '0',
    args: ['--no-sandbox'],
  });

  const report = { viewports: {}, a11y: {}, focus: {}, dark: {}, reducedMotion: {}, errors: {} };

  for (const vp of VIEWPORTS) {
    const { page, errors, context } = await newSession(vp);
    const overflow = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      cards: document.querySelectorAll('.yard-card').length,
      headerVisible: !!document.querySelector('.yard-app h1, .yard-app header'),
      tabbar: (() => {
        const nav = document.querySelector('.yard-nav');
        if (!nav) return null;
        const r = nav.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight };
      })(),
    }));
    await shot(page, `yard-${vp.name}-queue`);

    await openFirstSheet(page);
    await shot(page, `yard-${vp.name}-sheet`);
    const sheetMetrics = await page.evaluate(() => {
      const sheet = document.querySelector('.yard-sheet');
      const r = sheet ? sheet.getBoundingClientRect() : null;
      return r
        ? {
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            width: Math.round(r.width),
            height: Math.round(r.height),
            vh: window.innerHeight,
            bg: getComputedStyle(sheet).backgroundColor,
            fullBleed: Math.round(r.width) >= window.innerWidth - 2,
            anchoredBottom: Math.abs(r.bottom - window.innerHeight) < 3,
          }
        : null;
    });
    await closeSheet(page);

    report.viewports[vp.name] = { overflow, sheet: sheetMetrics };
    report.errors[vp.name] = errors;

    if (vp.name === '390' || vp.name === '1440') {
      report.a11y[vp.name] = await page.evaluate(auditFn);
      await openFirstSheet(page);
      report.a11y[`${vp.name}-sheet`] = await page.evaluate(auditFn);
      await closeSheet(page);
    }
    if (vp.name === '1440') {
      report.focus = await focusTrapCheck(page);
      await page.evaluate(() => {
        document.documentElement.classList.remove('light');
        document.documentElement.classList.add('dark');
      });
      await sleep(200);
      const island = await page.evaluate(() => {
        const app = document.querySelector('.yard-app');
        const card = document.querySelector('.yard-card');
        const chip = document.querySelector('.yard-chip');
        const status = document.querySelector('.yard-status');
        const read = (el) => (el ? getComputedStyle(el).backgroundColor : null);
        return { app: read(app), card: read(card), chip: read(chip), status: read(status) };
      });
      await shot(page, 'yard-1440-dark-injected-queue');
      await openFirstSheet(page);
      const sheetDark = await page.evaluate(() => {
        const sheet = document.querySelector('.yard-sheet');
        const sel = document.querySelector('.yard-sheet .yard-select');
        return {
          sheet: sheet ? getComputedStyle(sheet).backgroundColor : null,
          select: sel ? getComputedStyle(sel).backgroundColor : null,
        };
      });
      await shot(page, 'yard-1440-dark-injected-sheet');
      report.dark = { island, sheetDark };
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
      });
    }
    await context.close();
  }

  {
    const { page, context } = await newSession(VIEWPORTS[0]);
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(600);
    report.reducedMotion = await page.evaluate(() => {
      const card = document.querySelector('.yard-card');
      const btn = document.querySelector('.yard-btn');
      return {
        media: matchMedia('(prefers-reduced-motion: reduce)').matches,
        cardTransition: card ? getComputedStyle(card).transitionDuration : null,
        btnTransition: btn ? getComputedStyle(btn).transitionDuration : null,
      };
    });
    await context.close();
  }

  writeFileSync(path.join(OUT, 'reporte-fase4.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error('AUDIT FAILED', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    if (!process.env.E2E_EMAIL) removeLocalUser(EMAIL);
  });
