import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { UploadInput, StoredFile, UploadKind } from './types';

const defaultAllowedFiles = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/zip',
]);

const allowedImages = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const maxFileBytes = Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024);
const uploadRoot = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'storage', 'uploads'));

const sanitizeExtension = (originalName: string, mimeType: string) => {
  const extension = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, '');
  if (extension.length <= 10) return extension;
  const fallback = mimeType.split('/')[1]?.replace(/[^a-z0-9]/g, '').slice(0, 8);
  return fallback ? `.${fallback}` : '';
};

const getKind = (input: UploadInput): UploadKind => input.kind || (input.mimeType.startsWith('image/') ? 'image' : 'file');

const validateUpload = (input: UploadInput) => {
  const kind = getKind(input);
  const allowed = kind === 'image' ? allowedImages : defaultAllowedFiles;
  if (!allowed.has(input.mimeType)) throw new Error(`Tipo de archivo no permitido: ${input.mimeType}`);
  if (input.buffer.byteLength === 0) throw new Error('El archivo está vacío');
  if (input.buffer.byteLength > maxFileBytes) throw new Error('El archivo supera el tamaño máximo permitido');
  return kind;
};

export const saveUpload = async (input: UploadInput): Promise<StoredFile> => {
  const kind = validateUpload(input);
  const id = randomUUID();
  const extension = sanitizeExtension(input.originalName, input.mimeType);
  const storedName = `${id}${extension}`;
  const folder = path.join(uploadRoot, kind === 'image' ? 'images' : 'files');
  const absolutePath = path.join(folder, storedName);
  await fs.mkdir(folder, { recursive: true, mode: 0o750 });
  await fs.writeFile(absolutePath, input.buffer, { flag: 'wx', mode: 0o640 });

  return {
    id,
    originalName: path.basename(input.originalName),
    storedName,
    mimeType: input.mimeType,
    size: input.buffer.byteLength,
    kind,
    relativePath: path.relative(uploadRoot, absolutePath),
    absolutePath,
  };
};

export const saveUploads = async (inputs: UploadInput[]): Promise<StoredFile[]> => {
  if (inputs.length === 0) return [];
  if (inputs.length > 20) throw new Error('No se pueden subir más de 20 archivos por operación');
  const saved: StoredFile[] = [];
  try {
    for (const input of inputs) saved.push(await saveUpload(input));
    return saved;
  } catch (error) {
    await Promise.allSettled(saved.map((file) => fs.unlink(file.absolutePath)));
    throw error;
  }
};

export const removeUpload = async (file: StoredFile) => {
  const resolved = path.resolve(file.absolutePath);
  if (!resolved.startsWith(`${uploadRoot}${path.sep}`)) throw new Error('Ruta de archivo inválida');
  await fs.unlink(resolved);
};

export const uploadConfig = { uploadRoot, maxFileBytes };
