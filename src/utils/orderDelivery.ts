import { z } from 'zod';

export const imageEvidenceSchema = z.string().regex(/^\/uploads\/[a-zA-Z0-9._-]+\.(?:jpe?g|png|webp|gif)$/i,
  'La evidencia debe ser una imagen subida para la orden.');
export const deliveryPhotosSchema = z.array(imageEvidenceSchema).max(20, 'Adjunta un máximo de 20 imágenes.');

export function readDeliveryPhotos(evidence: string): string[] | null {
  if (!evidence.startsWith('[')) return null;
  let value: unknown;
  try { value = JSON.parse(evidence); } catch { return null; }
  const parsed = deliveryPhotosSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
