import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createPool } from 'mysql2/promise';

const envPath = path.resolve(process.cwd(), '.env');
if (existsSync(envPath)) loadEnvFile(envPath);

export const port = Number(process.env.PORT || process.env.API_PORT || 3000);
const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));
export const frontendRoot = path.basename(runtimeDirectory) === 'dist'
  ? runtimeDirectory
  : path.resolve(runtimeDirectory, '../../dist');
export const maxBodyBytes = 1024 * 1024;

export const allowedOrigins = new Set([
  ...(process.env.NODE_ENV === 'production' ? [] : [
    'http://localhost:3000',
    'http://localhost:4173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:4173',
    'http://yard.localhost:3000',
    'http://yard.localhost',
    'http://yard.localhost.com:3000',
    'http://yard.localhost.com',
  ]),
  process.env.CORS_ORIGIN,
  process.env.APP_URL,
].filter(Boolean));

export const isAllowedLocalOrigin = (origin?: string): boolean => {
  if (typeof origin !== 'string') return false;
  // Local development: allow localhost, 127.0.0.1, and subdomains like yard.localhost, yard.localhost.com on any port
  if (process.env.NODE_ENV !== 'production') {
    if (/^https?:\/\/([a-zA-Z0-9.-]+\.)?(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
    if (/^https?:\/\/([a-zA-Z0-9.-]+\.)?localhost\.com(:\d+)?$/.test(origin)) return true;
  }

  // Subdomains of configured APP_URL or CORS_ORIGIN (e.g. yard.radar-rsy.store)
  if (process.env.APP_URL) {
    try {
      const appHost = new URL(process.env.APP_URL).hostname;
      const originHost = new URL(origin).hostname;
      if (originHost === appHost || originHost.endsWith(`.${appHost}`)) return true;
    } catch {}
  }
  return false;
};

export const pool = createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'radar_app',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'radar_v3',
  waitForConnections: true,
  connectionLimit: 8,
  timezone: 'Z',
});

if (process.env.NODE_ENV === 'production') {
  for (const variable of ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET', 'APP_URL']) {
    if (!process.env[variable]) throw new Error(`${variable} es obligatorio en produccion`);
  }
  if ((process.env.JWT_SECRET || '').length < 32) {
    throw new Error('JWT_SECRET debe tener al menos 32 caracteres en producción');
  }
  if (/desktop-only|change.?me|replace.?me|example|your[-_ ]?secret/i.test(process.env.JWT_SECRET || '')) {
    throw new Error('JWT_SECRET no puede ser una clave de ejemplo o desarrollo en produccion');
  }
  if (process.env.DB_USER?.toLowerCase() === 'root') throw new Error('No uses root como usuario de la aplicacion');
  for (const origin of allowedOrigins) {
    const url = new URL(origin!);
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) {
      throw new Error('APP_URL y CORS_ORIGIN deben ser origenes HTTPS exactos en produccion');
    }
  }
  if (['--inspect', '--inspect-brk', '--debug'].some(flag => process.execArgv.some(arg => arg.startsWith(flag)) || process.env.NODE_OPTIONS?.includes(flag))) {
    throw new Error('El depurador no esta permitido en produccion');
  }
}

export const jwtSecret = process.env.JWT_SECRET || '';
