import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const chromePath = process.env.E2E_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const publicDir = path.resolve('public');
const sourceSvg = fs.readFileSync(path.join(publicDir, 'icon-yard-512.svg'), 'utf8');

const targets = [
  { size: 180, file: 'icon-yard-180.png', padding: 0 },
  { size: 192, file: 'icon-yard-192.png', padding: 0 },
  { size: 512, file: 'icon-yard-512.png', padding: 0 },
  { size: 512, file: 'icon-yard-maskable-512.png', padding: 0.1 },
];

const browser = await puppeteer.launch({ executablePath: chromePath, headless: true });
try {
  for (const { size, file, padding } of targets) {
    const page = await browser.newPage();
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    const inner = Math.round(size * (1 - padding * 2));
    const offset = Math.round((size - inner) / 2);
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(sourceSvg).toString('base64')}`;
    await page.setContent(`<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;background:#070b14;overflow:hidden">
      <img src="${dataUrl}" width="${inner}" height="${inner}" style="display:block;margin:${offset}px auto 0;border-radius:${padding ? Math.round(inner * 0.2) : 0}px" />
    </body></html>`);
    await page.screenshot({ path: path.join(publicDir, file), type: 'png' });
    await page.close();
    console.log(`generated public/${file} (${size}x${size})`);
  }
} finally {
  await browser.close();
}
