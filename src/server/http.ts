import { promises as fs } from 'node:fs';
import path from 'node:path';
import { IncomingMessage, ServerResponse } from 'node:http';
import { frontendRoot, maxBodyBytes } from './config';

export const readBody = async (request: IncomingMessage) => {
  const contentType = String(request.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw Object.assign(new Error('Content-Type debe ser application/json'), { statusCode: 415 });
  }
  const contentLength = Number(request.headers['content-length'] || 0);
  if (contentLength > maxBodyBytes) {
    throw Object.assign(new Error('Payload demasiado grande'), { statusCode: 413 });
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += Buffer.byteLength(chunk);
    if (totalBytes > maxBodyBytes) {
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
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
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
};

export const serveFrontend = async (request: IncomingMessage, response: ServerResponse) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;

  const requestPath = new URL(request.url || '/', 'http://localhost').pathname;
  const requestedFile = requestPath === '/' ? 'index.html' : requestPath.slice(1);
  const candidate = path.resolve(frontendRoot, requestedFile);
  const isInsideFrontend = candidate === frontendRoot || candidate.startsWith(`${frontendRoot}${path.sep}`);
  const filePath = isInsideFrontend ? candidate : path.join(frontendRoot, 'index.html');

  let resolvedPath = filePath;
  try {
    const fileStats = await fs.stat(resolvedPath);
    if (!fileStats.isFile()) throw new Error('Not a file');
  } catch {
    resolvedPath = path.join(frontendRoot, 'index.html');
  }

  try {
    const body = await fs.readFile(resolvedPath);
    const extension = path.extname(resolvedPath).toLowerCase();
    response.writeHead(200, {
      'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      'Content-Type': contentTypes[extension] || 'application/octet-stream',
    });
    if (request.method === 'HEAD') {
      response.end();
      return true;
    }
    response.end(body);
    return true;
  } catch {
    return false;
  }
};
