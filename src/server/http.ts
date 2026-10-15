import { promises as fs } from 'node:fs';
import path from 'node:path';
import { IncomingMessage, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { frontendRoot, maxBodyBytes } from './config';

export const readBody = async (request: IncomingMessage, maxBytes: number = maxBodyBytes) => {
  const contentType = String(request.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw Object.assign(new Error('Content-Type debe ser application/json'), { statusCode: 415 });
  }
  const contentLength = Number(request.headers['content-length'] || 0);
  if (contentLength > maxBytes) {
    throw Object.assign(new Error('Payload demasiado grande'), { statusCode: 413 });
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += Buffer.byteLength(chunk);
    if (totalBytes > maxBytes) {
      throw Object.assign(new Error('Payload demasiado grande'), { statusCode: 413 });
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  } catch {
    throw Object.assign(new Error('JSON invalido'), { statusCode: 400 });
  }
};

export const sendJson = (response: ServerResponse, status: number, data: unknown) => {
  const json = JSON.stringify(data);
  const acceptEncoding = String((response.req as IncomingMessage)?.headers?.['accept-encoding'] || '').toLowerCase();

  // Comprimir con Gzip si el cliente lo acepta y el payload supera 1 KB
  if (acceptEncoding.includes('gzip') && json.length > 1024) {
    try {
      const gzipped = gzipSync(Buffer.from(json, 'utf-8'));
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Encoding': 'gzip',
        'Vary': 'Accept-Encoding',
        'Content-Length': String(gzipped.length),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      });
      response.end(gzipped);
      return;
    } catch {
      // Fallback a respuesta sin comprimir si falla zlib
    }
  }

  const buffer = Buffer.from(json, 'utf-8');
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(buffer.length),
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  });
  response.end(buffer);
};

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

const compressibleExtensions = new Set(['.html', '.js', '.css', '.json', '.svg']);

interface CachedStaticFile {
  body: Buffer;
  gzipped: Buffer | null;
  mtime: number;
  etag: string;
  contentType: string;
}

const staticFileCache = new Map<string, CachedStaticFile>();

export const serveFrontend = async (request: IncomingMessage, response: ServerResponse) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;

  const requestPath = new URL(request.url || '/', 'http://localhost').pathname;
  const requestedFile = requestPath === '/' ? 'index.html' : requestPath.slice(1);
  const candidate = path.resolve(frontendRoot, requestedFile);
  const isInsideFrontend = candidate === frontendRoot || candidate.startsWith(`${frontendRoot}${path.sep}`);
  const filePath = isInsideFrontend ? candidate : path.join(frontendRoot, 'index.html');

  let resolvedPath = filePath;
  let fileStats;
  try {
    fileStats = await fs.stat(resolvedPath);
    if (!fileStats.isFile()) throw new Error('Not a file');
  } catch {
    resolvedPath = path.join(frontendRoot, 'index.html');
    try {
      fileStats = await fs.stat(resolvedPath);
    } catch {
      return false;
    }
  }

  try {
    const extension = path.extname(resolvedPath).toLowerCase();
    const contentType = contentTypes[extension] || 'application/octet-stream';
    const mtime = fileStats.mtimeMs;

    let cached = staticFileCache.get(resolvedPath);
    if (!cached || cached.mtime !== mtime) {
      const body = await fs.readFile(resolvedPath);
      let gzipped: Buffer | null = null;
      if (compressibleExtensions.has(extension) && body.length > 512) {
        try {
          gzipped = gzipSync(body);
        } catch {
          gzipped = null;
        }
      }
      cached = {
        body,
        gzipped,
        mtime,
        etag: `W/"${fileStats.size.toString(16)}-${Math.floor(mtime).toString(16)}"`,
        contentType,
      };
      staticFileCache.set(resolvedPath, cached);
    }

    // Soporte para ETag (304 Not Modified)
    const clientEtag = request.headers['if-none-match'];
    if (clientEtag && clientEtag === cached.etag) {
      response.writeHead(304, {
        'ETag': cached.etag,
        'Cache-Control': extension === '.html' ? 'no-cache, must-revalidate' : 'public, max-age=31536000, immutable',
      });
      response.end();
      return true;
    }

    const acceptEncoding = String(request.headers['accept-encoding'] || '').toLowerCase();
    const canGzip = acceptEncoding.includes('gzip') && cached.gzipped !== null;
    const bodyToSend = canGzip ? cached.gzipped! : cached.body;

    const headers: Record<string, string> = {
      'Content-Type': cached.contentType,
      'Content-Length': String(bodyToSend.length),
      'ETag': cached.etag,
      'Cache-Control': extension === '.html' ? 'no-cache, must-revalidate' : 'public, max-age=31536000, immutable',
    };

    if (canGzip) {
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = 'Accept-Encoding';
    }

    response.writeHead(200, headers);
    if (request.method === 'HEAD') {
      response.end();
      return true;
    }

    response.end(bodyToSend);
    return true;
  } catch {
    return false;
  }
};
