import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { createPool } from 'mysql2/promise';

// Native or fallback .env loader for production environments
try {
  if (typeof (process as any).loadEnvFile === 'function') {
    (process as any).loadEnvFile();
  }
} catch {
  // If native loader fails (e.g. older node or cwd differences), load manually
  try {
    const candidatePaths = [
      path.resolve(process.cwd(), '.env'),
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env'),
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env'),
    ];
    for (const envPath of candidatePaths) {
      if (existsSync(envPath)) {
        const content = readFileSync(envPath, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const k = trimmed.slice(0, eqIdx).trim();
            let v = trimmed.slice(eqIdx + 1).trim();
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
              v = v.slice(1, -1);
            }
            if (!process.env[k]) {
              process.env[k] = v;
            }
          }
        }
        break;
      }
    }
  } catch {
    // Ignore
  }
}

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
  if ((process.env.JWT_SECRET || '').length < 32) {
    throw new Error('JWT_SECRET debe tener al menos 32 caracteres en producción');
  }
}

export const jwtSecret = process.env.JWT_SECRET || '';
