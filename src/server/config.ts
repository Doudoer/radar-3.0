import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from 'mysql2/promise';

export const port = Number(process.env.PORT || process.env.API_PORT || 3000);
const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));
export const frontendRoot = path.basename(runtimeDirectory) === 'dist'
  ? runtimeDirectory
  : path.resolve(runtimeDirectory, '../../dist');
export const maxBodyBytes = 1024 * 1024;

export const allowedOrigins = new Set([
  'http://localhost:3000',
  'http://localhost:4173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:4173',
  process.env.CORS_ORIGIN,
  process.env.APP_URL,
].filter(Boolean));

export const isAllowedLocalOrigin = (origin?: string) =>
  typeof origin === 'string' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);

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
  for (const variable of ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET']) {
    if (!process.env[variable]) throw new Error(`${variable} es obligatorio en produccion`);
  }
}

export const jwtSecret = process.env.JWT_SECRET || '';
