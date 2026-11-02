import fs from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';

if (fs.existsSync('.env')) loadEnvFile('.env');
const production = process.env.NODE_ENV === 'production';
let failures = 0;
const check = (status: 'PASS' | 'WARN' | 'FAIL', name: string) => {
  console.log(`${status} ${name}`);
  if (status === 'FAIL') failures++;
};
const ignored = fs.existsSync('.gitignore') ? fs.readFileSync('.gitignore', 'utf8') : '';
check(ignored.includes('.env*') && ignored.includes('backups/') && ignored.includes('uploads/') ? 'PASS' : 'FAIL',
  'Entornos, respaldos y adjuntos excluidos de Git (no demuestra limpieza del historial)');
check('WARN',
  fs.existsSync('.git') ? 'Historial Git disponible: requiere escaneo independiente de todas las referencias' : 'Sin historial Git: no se puede certificar ausencia de secretos en commits');
check(production ? 'PASS' : 'WARN', production ? 'NODE_ENV=production' : 'Modo local: HTTP permitido; no utilizar esta configuracion en Internet');
const secret = process.env.JWT_SECRET || '';
check(secret.length >= 32 && !/desktop-only|change.?me|replace.?me|example/i.test(secret) ? 'PASS' : production ? 'FAIL' : 'WARN',
  'JWT_SECRET: longitud y ausencia de marcadores de ejemplo; la entropia no se puede certificar por longitud');
check(process.env.DB_USER && process.env.DB_USER.toLowerCase() !== 'root' ? 'PASS' : production ? 'FAIL' : 'WARN',
  'Usuario de base de datos no root; comprobar GRANTS DML en el servidor');
check(process.env.DB_PASSWORD ? 'PASS' : production ? 'FAIL' : 'WARN', 'Contraseña de base de datos configurada (valor omitido)');
for (const name of ['APP_URL', 'CORS_ORIGIN']) {
  const value = process.env[name];
  let valid = false;
  try {
    const url = new URL(value || '');
    valid = url.origin === value && (url.protocol === 'https:' || !production && url.protocol === 'http:');
  } catch { valid = false; }
  check(valid || name === 'CORS_ORIGIN' && !value ? 'PASS' : production ? 'FAIL' : 'WARN', `${name}: origen exacto sin comodines ni rutas`);
}
check(process.env.TRUST_PROXY === '1' ? 'WARN' : 'PASS',
  process.env.TRUST_PROXY === '1' ? 'TRUST_PROXY=1: restringir ingreso a Node al proxy confiable y sobrescribir cabeceras' : 'No se confia en cabeceras reenviadas');
check(process.env.WASENDER_FORCE_TEST_RECIPIENT === 'true' ? 'WARN' : 'PASS', 'El modo de destinatario de prueba no permite OTP WhatsApp');
for (const file of fs.readdirSync('.').filter(name => /^\.env(?:\.|$)/.test(name) && name !== '.env.example')) {
  check((fs.statSync(file).mode & 0o077) === 0 ? 'PASS' : 'WARN', `Permisos privados del archivo ${file} (recomendado 600)`);
}
const files: string[] = [];
function walk(directory: string) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(tsx?|jsx?|html|json)$/.test(file)) files.push(file);
  }
}
walk('src');
walk('dist/assets');
const secretPattern = /AIza[0-9A-Za-z_-]{30,}|sk_live_[0-9A-Za-z]+|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  if (secretPattern.test(content)) check('FAIL', `Patron de secreto detectado en ${file}; contenido omitido`);
  if (!file.includes('/server/') && !file.includes('/integrations/') && /import\.meta\.env\.VITE_(?!API_URL\b)[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)/.test(content)) {
    check('FAIL', `Variable publica sensible en ${file}; contenido omitido`);
  }
}
check('WARN', 'Escaneo por patrones no exhaustivo: revisar proveedores, archivos excluidos e historial antes del despliegue');
console.log(`Diagnostico local terminado: ${failures} fallos. No sustituye pruebas HTTP ni una auditoria externa.`);
process.exitCode = failures ? 1 : 0;
