import { apiFetch } from './apiFetch';
import { imageEvidenceSchema } from '../utils/orderDelivery';

export async function uploadOrderFile(orderId: string, file: File, allowPdf = false) {
  const pdf = allowPdf && file.type === 'application/pdf';
  if (!pdf && !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
    throw new Error(allowPdf ? 'Selecciona un PDF o imagen JPG, PNG, WebP o GIF.' : 'Selecciona una imagen JPG, PNG, WebP o GIF.');
  }
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('El archivo debe pesar entre 1 byte y 10 MB.');
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('No se pudo leer el archivo.'));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
  const response = await apiFetch('/upload', { method: 'POST',
    body: JSON.stringify({ orderId: Number(orderId), filename: file.name, contentType: file.type, base64 }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || 'No se pudo subir el archivo.');
  if (typeof body.url !== 'string' || (pdf ? !/^\/uploads\/[a-zA-Z0-9._-]+\.pdf$/i.test(body.url) : !imageEvidenceSchema.safeParse(body.url).success)) {
    throw new Error('Respuesta de archivo inválida.');
  }
  return body.url;
}
