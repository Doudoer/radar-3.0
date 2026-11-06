import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DownpaymentFields } from '../src/components/DownpaymentConfirmation';

describe('simplified confirmation fields', () => {
  const line = { method: 'cash' as const, amount: 200, receivedBy: '', receipt: null };
  it('shows existing amount, method and receiver, without a cash upload or editable date', () => {
    const html = renderToStaticMarkup(<DownpaymentFields paid={200} value={[line]} onChange={() => {}} onUpload={async () => '/uploads/test.png'} />);
    expect(html).toContain('Monto pagado');
    expect(html).toContain('Persona que recibió el dinero');
    expect(html).toContain('TDD/TDC');
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain('Detalle de la gestión');
    expect(html).toContain('no vuelve a sumarse');
  });
  it('renders required image upload for noncash', () => {
    const html = renderToStaticMarkup(<DownpaymentFields paid={200} value={[{ ...line, method: 'zelle' }]} onChange={() => {}} onUpload={async () => '/uploads/test.png'} />);
    expect(html).toContain('type="file"');
    expect(html).toContain('image/jpeg,image/png,image/webp,image/gif');
    expect(html).toContain('Comprobante');
    expect(html).not.toContain('Persona que recibió el dinero');
  });
  it('only asks the cash receiver when methods are split', () => {
    const html = renderToStaticMarkup(<DownpaymentFields paid={200} value={[line, { ...line, method: 'card' }]} onChange={() => {}} onUpload={async () => '/uploads/test.png'} />);
    expect(html).toContain('Persona que recibió el dinero 1');
    expect(html).not.toContain('Persona que recibió el dinero 2');
  });
});
