import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { deliveryPhotosSchema, readDeliveryPhotos } from '../src/utils/orderDelivery';
import { OrderDeliveryFields } from '../src/components/OrderDeliveryFields';
import { PreparationFields } from '../src/components/OrderPreparation';
import { emptyPreparation } from '../src/utils/orderPreparation';

describe('optional delivery piece photos', () => {
  it('retains mandatory SMS preparation captures separately from optional delivery images', () => {
    const props = { onChange: () => {}, onUpload: async () => '/uploads/capture.png' };
    const empty = renderToStaticMarkup(<PreparationFields {...props} value={{ ...emptyPreparation(), channel: 'sms' }} />);
    expect(empty).toMatch(/type="file"[^>]*required=""/);
    const captured = renderToStaticMarkup(<PreparationFields {...props}
      value={{ ...emptyPreparation(), channel: 'sms', screenshots: ['/uploads/capture.png'] }} />);
    expect(captured).not.toMatch(/type="file"[^>]*required=""/);
    expect(captured).toContain('Ver captura 1');
    expect(captured).toContain('Quitar captura 1');
  });
  it('accepts zero, one or multiple own-upload image paths and rejects non-images and excess files', () => {
    for (const files of [[], ['/uploads/front.png'], ['/uploads/front.jpg', '/uploads/back.webp']]) {
      expect(deliveryPhotosSchema.parse(files)).toEqual(files);
      expect(readDeliveryPhotos(JSON.stringify(files))).toEqual(files);
    }
    for (const files of [['https://example.test/a.png'], ['/uploads/../a.png'], ['/uploads/invoice.pdf'], Array(21).fill('/uploads/a.png')]) {
      expect(deliveryPhotosSchema.safeParse(files).success).toBe(false);
    }
  });
  it('preserves historical textual evidence without treating it as photo links', () => {
    for (const evidence of ['Signed reference', '[not valid JSON', '["https://example.test/a.png"]', '{"photos":[]}']) {
      expect(readDeliveryPhotos(evidence)).toBeNull();
    }
  });
  it('uses the customer name as readonly text and renders optional multiple images without delivery detail', () => {
    const html = renderToStaticMarkup(<OrderDeliveryFields orderId="901" customerName="Cliente Prueba" photos={['/uploads/piece.png']}
      onChange={() => {}} onUploadingChange={() => {}} />);
    expect(html).toContain('Cliente Prueba');
    expect(html).toContain('multiple=""');
    expect(html).toContain('opcional');
    expect(html).toContain('Ver imagen de entrega 1');
    expect(html).not.toContain('textarea');
    expect(html).not.toContain('required=""');
    expect(html).not.toContain('type="text"');
  });
});
