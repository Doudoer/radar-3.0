import fs from 'node:fs';
import path from 'node:path';
import puppeteer, { Page } from 'puppeteer-core';
import { generateTotpCode } from '../src/server/totp.ts';

const OUTPUT_DIR = path.resolve(process.cwd(), 'capturas_sistema');
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE_URL = 'http://localhost:3000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@radar.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_TOTP_SECRET = 'Q4CAMMFWSRIGVJZHKISONKG3S27MUFQY';

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
} else {
  // Clean all existing files in output dir
  for (const file of fs.readdirSync(OUTPUT_DIR)) {
    fs.unlinkSync(path.join(OUTPUT_DIR, file));
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function takeSnap(page: Page, filename: string, description: string) {
  const filePath = path.join(OUTPUT_DIR, filename);
  await sleep(700); // Allow render/animation to settle
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`📸 [${filename}] ${description}`);
}

async function dismissPopupIfPresent(page: Page) {
  const dismissed = await page.evaluate(() => {
    // Check for "Continuar a RADAR" or close button in briefing modal
    const continueBtn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Continuar a RADAR') || b.title?.includes('Cerrar (Permanecerá accesible')
    );
    if (continueBtn) {
      continueBtn.click();
      return true;
    }

    // Generic close for any unwanted overlay
    const closeBtn = document.querySelector<HTMLButtonElement>('.fixed.inset-0.z-50 button[title*="Cerrar"]');
    if (closeBtn) {
      closeBtn.click();
      return true;
    }
    return false;
  });

  if (dismissed) {
    await sleep(800);
  }
}

async function navigateTo(page: Page, itemLabel: string) {
  await dismissPopupIfPresent(page);
  await page.evaluate((label) => {
    const buttons = Array.from(document.querySelectorAll('aside button'));
    const target = buttons.find((b) => b.textContent?.includes(label));
    if (target) (target as HTMLButtonElement).click();
  }, itemLabel);
  await sleep(1500);
  await dismissPopupIfPresent(page);
}

async function run() {
  console.log('🚀 Iniciando captura automatizada y limpia de todas las vistas...');
  console.log(`📁 Directorio destino: ${OUTPUT_DIR}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1600,1000',
      '--disable-gpu',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 980, deviceScaleFactor: 2 });

  try {
    // -------------------------------------------------------------
    // 1. LOGIN VIEW
    // -------------------------------------------------------------
    console.log('\n--- 1. Vista de Login ---');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await sleep(1500);
    await takeSnap(page, '01_login.png', 'Pantalla de Inicio de Sesión Cyberpunk');

    // Perform Login
    console.log('Iniciando sesión como Super Admin...');
    await page.type('input[type="email"]', ADMIN_EMAIL);
    await page.type('input[type="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');

    // Wait for App to load
    await page.waitForFunction(
      () => !document.querySelector('form') && (document.body.innerText.includes('DASHBOARD') || document.body.innerText.includes('RADAR 3.0')),
      { timeout: 12000 }
    );
    await sleep(2500);

    // -------------------------------------------------------------
    // CAPTURAR EL POPUP DE BRIEFING SEGUIMIENTOS Y LUEGO SALTARLO
    // -------------------------------------------------------------
    console.log('\n--- Captura y salto del Popup Inicial (Briefing de Seguimiento) ---');
    const isBriefingOpen = await page.evaluate(() => {
      return Boolean(document.body.innerText.includes('Seguimiento Post-Entrega Obligatorio'));
    });

    if (isBriefingOpen) {
      console.log('Detectado popup de bienvenida/briefing. Capturando modal...');
      await takeSnap(page, '24_modal_briefing_seguimientos.png', 'Modal Briefing Diario de Seguimientos Post-Entrega Obligatorio');
      
      console.log('Saltando popup para limpiar las vistas...');
      await dismissPopupIfPresent(page);
      await sleep(1000);
    }

    // -------------------------------------------------------------
    // 2. DASHBOARD (100% LIMPIO SIN POPUP)
    // -------------------------------------------------------------
    console.log('\n--- 2. Dashboard Principal Limpio ---');
    await dismissPopupIfPresent(page);
    await takeSnap(page, '02_dashboard.png', 'Dashboard Principal con métricas SLA y KPIs (Completamente limpio)');

    // -------------------------------------------------------------
    // 3. DASHBOARD EN MODO CLARO (LIGHT MODE)
    // -------------------------------------------------------------
    console.log('\n--- 3. Dashboard en Modo Claro ---');
    const themeBtn = await page.$('button[title*="Modo"]');
    if (themeBtn) {
      await themeBtn.click();
      await sleep(800);
      await takeSnap(page, '03_dashboard_modo_claro.png', 'Dashboard en Modo Claro');
      await themeBtn.click();
      await sleep(800);
    }

    // -------------------------------------------------------------
    // 4. LISTA DE ÓRDENES (TALLER)
    // -------------------------------------------------------------
    console.log('\n--- 4. Módulo Órdenes ---');
    await navigateTo(page, 'Lista de Órdenes');
    await takeSnap(page, '04_ordenes_lista.png', 'Módulo Lista de Órdenes con tabla y filtros');

    // -------------------------------------------------------------
    // 5. DETALLE DE ORDEN (RESUMEN, FLUJO, HISTORIAL, REEMBOLSO)
    // -------------------------------------------------------------
    console.log('\n--- 5. Detalle de Orden ---');
    const firstOrderClicked = await page.evaluate(() => {
      const row = document.querySelector('tbody tr');
      if (row) {
        (row as HTMLElement).click();
        return true;
      }
      return false;
    });

    if (firstOrderClicked) {
      await sleep(1800);
      await dismissPopupIfPresent(page);
      await takeSnap(page, '05_orden_detalle_resumen.png', 'Detalle de Orden - Pestaña 1. Resumen');

      // Pestaña Flujo
      await page.evaluate(() => {
        const tab = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Flujo'));
        if (tab) tab.click();
      });
      await sleep(800);
      await takeSnap(page, '06_orden_detalle_flujo.png', 'Detalle de Orden - Pestaña 2. Flujo de Trabajo');

      // Pestaña Historial
      await page.evaluate(() => {
        const tab = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Historial'));
        if (tab) tab.click();
      });
      await sleep(800);
      await takeSnap(page, '07_orden_detalle_historial.png', 'Detalle de Orden - Pestaña 3. Historial');

      // Solicitud de Reembolso
      const refundBtn = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Reembolso'));
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });
      if (refundBtn) {
        await sleep(1000);
        await takeSnap(page, '08_orden_solicitud_reembolso.png', 'Detalle de Orden - Vista de Solicitud de Reembolso');
        await page.evaluate(() => {
          const backBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Volver al Detalle') || b.textContent?.includes('Volver') || b.textContent?.includes('Cancelar'));
          if (backBtn) backBtn.click();
        });
        await sleep(800);
      }
    }

    // -------------------------------------------------------------
    // 6. INVENTARIO & HOLD
    // -------------------------------------------------------------
    console.log('\n--- 6. Inventario & HOLD ---');
    await navigateTo(page, 'Inventario & HOLD');
    await takeSnap(page, '09_inventario_hold.png', 'Módulo Inventario & Piezas en HOLD');

    // -------------------------------------------------------------
    // 7. CLIENTES CRM
    // -------------------------------------------------------------
    console.log('\n--- 7. Clientes CRM ---');
    await navigateTo(page, 'Clientes CRM');
    await takeSnap(page, '10_clientes_crm.png', 'Módulo Clientes CRM con directorio e historial');

    // -------------------------------------------------------------
    // 8. RECLAMOS Y GARANTÍAS
    // -------------------------------------------------------------
    console.log('\n--- 8. Reclamos y Garantías ---');
    await navigateTo(page, 'Reclamos');
    await takeSnap(page, '11_reclamos_garantias.png', 'Módulo Reclamos y Garantías');

    // -------------------------------------------------------------
    // 9. MIS OPERACIONES
    // -------------------------------------------------------------
    console.log('\n--- 9. Mis Operaciones ---');
    await navigateTo(page, 'Mis Operaciones');
    await takeSnap(page, '12_mis_operaciones.png', 'Módulo Mis Operaciones con panel de flujo');

    // -------------------------------------------------------------
    // 10. RELACIÓN SEMANAL & FINANZAS (BLOQUEADO 2FA)
    // -------------------------------------------------------------
    console.log('\n--- 10. Relación Semanal & Finanzas (2FA Bloqueado) ---');
    await navigateTo(page, 'Relación Semanal');
    await takeSnap(page, '13_relacion_semanal_2fa_bloqueado.png', 'Relación Semanal - Pantalla de Bloqueo 2FA');

    // -------------------------------------------------------------
    // 11. RELACIÓN SEMANAL & FINANZAS (DESBLOQUEADO Y SUS 4 SUB-PESTAÑAS)
    // -------------------------------------------------------------
    console.log('\n--- 11. Relación Semanal & Finanzas (Desbloqueado) ---');
    // Switch to Authenticator tab
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Authenticator'));
      if (btn) btn.click();
    });
    await sleep(800);

    const totpCode = generateTotpCode(ADMIN_TOTP_SECRET);
    console.log(`Desbloqueando con TOTP: ${totpCode}`);

    const numericInputs = await page.$$('input[inputmode="numeric"]');
    if (numericInputs.length > 0) {
      await numericInputs[0].focus();
      await page.keyboard.type(totpCode, { delay: 40 });
    }
    await sleep(800);

    await page.evaluate(() => {
      const verifyBtn = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent?.includes('VERIFICAR Y DESBLOQUEAR') || b.textContent?.includes('Verificar') || b.textContent?.includes('Desbloquear')
      );
      if (verifyBtn) verifyBtn.click();
    });

    await sleep(3500);
    await dismissPopupIfPresent(page);
    await takeSnap(page, '14a_relacion_semanal_formato_oficial.png', 'Relación Semanal - Pestaña Formato Oficial Entregas');

    // Tab 2: Ventas de la Semana
    await page.evaluate(() => {
      const tab = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Ventas de la Semana'));
      if (tab) tab.click();
    });
    await sleep(800);
    await takeSnap(page, '14b_relacion_semanal_ventas.png', 'Relación Semanal - Pestaña Ventas de la Semana');

    // Tab 3: Entregas de la Semana
    await page.evaluate(() => {
      const tab = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Entregas de la Semana'));
      if (tab) tab.click();
    });
    await sleep(800);
    await takeSnap(page, '14c_relacion_semanal_entregas.png', 'Relación Semanal - Pestaña Entregas de la Semana');

    // Tab 4: Relación General de Entregas y Gastos
    await page.evaluate(() => {
      const tab = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Relación General'));
      if (tab) tab.click();
    });
    await sleep(800);
    await takeSnap(page, '14d_relacion_semanal_gastos_general.png', 'Relación Semanal - Pestaña Relación General de Entregas y Gastos');

    // Modal 2FA Settings
    console.log('\n--- Modal Configuración y Seguridad 2FA ---');
    const opened2fa = await page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>('button[title*="Seguridad 2FA"]') ||
                  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Seguridad 2FA'));
      if (btn) {
        (btn as HTMLButtonElement).click();
        return true;
      }
      return false;
    });
    if (opened2fa) {
      await sleep(1000);
      await takeSnap(page, '15_modal_configuracion_2fa.png', 'Modal de Configuración y Seguridad 2FA / Códigos de Emergencia');
      await page.keyboard.press('Escape');
      await sleep(500);
    }

    // -------------------------------------------------------------
    // 12. CONFIGURACIÓN DEL SISTEMA
    // -------------------------------------------------------------
    console.log('\n--- 12. Configuración del Sistema ---');
    await navigateTo(page, 'Sistema');
    await takeSnap(page, '16_configuracion_sistema.png', 'Módulo Configuración del Sistema y Diagnóstico');

    // Modal Cambiar Contraseña desde Sistema
    console.log('\n--- Modal Cambiar Contraseña ---');
    const pwdBtnClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Cambiar mi contraseña'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    if (pwdBtnClicked) {
      await sleep(1000);
      await takeSnap(page, '23_modal_cambiar_contrasena.png', 'Modal Cambio Seguro de Contraseña');
      await page.keyboard.press('Escape');
      await sleep(500);
    }

    // -------------------------------------------------------------
    // 13. GESTIÓN DE USUARIOS
    // -------------------------------------------------------------
    console.log('\n--- 13. Gestión de Usuarios ---');
    await navigateTo(page, 'Usuarios');
    await takeSnap(page, '17_gestion_usuarios.png', 'Módulo Gestión de Usuarios y Roles');

    // -------------------------------------------------------------
    // 14. MODAL NUEVA ORDEN
    // -------------------------------------------------------------
    console.log('\n--- 14. Modal Nueva Orden ---');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('header button, aside button')).find((b) => b.textContent?.includes('Nueva Orden'));
      if (btn && btn instanceof HTMLElement) btn.click();
    });
    await sleep(1000);
    await takeSnap(page, '18_modal_nueva_orden.png', 'Modal de Creación de Nueva Orden');
    await page.keyboard.press('Escape');
    await sleep(500);

    // -------------------------------------------------------------
    // 15. MODAL BÚSQUEDA GLOBAL (⌘K)
    // -------------------------------------------------------------
    console.log('\n--- 15. Modal Búsqueda Global ---');
    await page.evaluate(() => {
      const input = document.querySelector('header input[placeholder*="Buscar"]');
      if (input) (input as HTMLElement).click();
    });
    await sleep(1000);
    await takeSnap(page, '19_modal_busqueda_global.png', 'Modal Búsqueda Global (⌘K)');
    await page.keyboard.press('Escape');
    await sleep(500);

    // -------------------------------------------------------------
    // 16. MODAL EXPORTAR CSV / EXCEL
    // -------------------------------------------------------------
    console.log('\n--- 16. Modal Exportar ---');
    await navigateTo(page, 'Lista de Órdenes');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Exportar'));
      if (btn) btn.click();
    });
    await sleep(1000);
    await takeSnap(page, '20_modal_exportar.png', 'Modal de Exportación de Datos');
    await page.keyboard.press('Escape');
    await sleep(500);

    // -------------------------------------------------------------
    // 17. MODAL SOLICITAR ESTATUS
    // -------------------------------------------------------------
    console.log('\n--- 17. Modal Solicitar Estatus ---');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Solicitar status') || b.textContent?.includes('Solicitar estatus'));
      if (btn) btn.click();
    });
    await sleep(1000);
    await takeSnap(page, '21_modal_solicitar_estatus.png', 'Modal Solicitar Estatus a Taller / Proveedores');
    await page.keyboard.press('Escape');
    await sleep(500);

    // -------------------------------------------------------------
    // 18. MODAL PERFIL DE USUARIO
    // -------------------------------------------------------------
    console.log('\n--- 18. Modal Perfil de Usuario ---');
    await page.evaluate(() => {
      const btn = document.querySelector('header button[title*="Perfil"]');
      if (btn) (btn as HTMLElement).click();
    });
    await sleep(1000);
    await takeSnap(page, '22_modal_perfil_usuario.png', 'Modal Mi Perfil y Preferencias');
    await page.keyboard.press('Escape');
    await sleep(500);

    // -------------------------------------------------------------
    // 19. MODAL ENVÍO RÁPIDO SMS / WHATSAPP
    // -------------------------------------------------------------
    console.log('\n--- 19. Modal Envío Rápido SMS / WhatsApp ---');
    await navigateTo(page, 'Lista de Órdenes');
    await page.evaluate(() => {
      const row = document.querySelector('tbody tr');
      if (row) (row as HTMLElement).click();
    });
    await sleep(1500);
    const smsBtnClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('WhatsApp / SMS'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    if (smsBtnClicked) {
      await sleep(1000);
      await takeSnap(page, '25_modal_envio_sms.png', 'Modal de Envío Rápido SMS / WhatsApp al Cliente');
      await page.keyboard.press('Escape');
      await sleep(500);
    }

    console.log('\n🎉 ¡Todas las capturas limpias completadas con éxito!');
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('❌ Error capturando vistas:', err);
  process.exit(1);
});
