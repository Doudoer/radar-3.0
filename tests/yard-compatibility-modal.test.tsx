import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { YardCompatibilityModal } from '../src/components/YardCompatibilityModal';
import type { Order } from '../src/types';

const order = {
  id: 'ORD-2026-4230',
  code: 'ORD-2026-4230',
  status: 'pagado',
  mainPart: 'Bomba de dirección hidráulica',
  customer: { name: 'Ana Torres' },
  vehicle: { make: 'Toyota', model: 'Corolla', year: 2018 },
  yardCompatibility: {
    compatibilityList: 'Compatibilidad\n*Toyota Corolla: 2014 – 2019',
    compatibleVehicles: [{ id: 'v1', make: 'Toyota', model: 'Corolla', yearFrom: 2014, yearTo: 2019 }],
    referenceImages: ['/uploads/ref-1.jpg'],
  },
} as Order;

const render = (isOpen = true) =>
  renderToStaticMarkup(
    <YardCompatibilityModal
      order={order}
      isOpen={isOpen}
      onClose={() => undefined}
      onSaved={() => undefined}
      onToast={() => undefined}
    />
  );

describe('yard compatibility modal', () => {
  it('renders nothing while closed', () => {
    expect(render(false)).toBe('');
  });

  it('exposes a named modal with the current photo count announced politely', () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Compatibilidad y fotos de la orden ORD-2026-4230"');
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('1 foto de referencia');
  });

  it('keeps the selector fields enabled while idle', () => {
    const html = render();
    expect(html.match(/<select/g)).toHaveLength(4);
    expect(html).not.toContain('<select disabled');
    expect(html).toContain('Ajustar texto libre');
    expect(html).toContain('Agregar a compatibilidad');
    expect(html).toContain('Copiar vehículo de la orden');
  });

  it('does not ask to discard anything before the person edits', () => {
    const html = render();
    expect(html).not.toContain('¿Descartar cambios?');
    expect(html).not.toContain('Seguir editando');
  });

  it('lets long order details wrap instead of truncating in the header', () => {
    const html = render();
    expect(html).toContain('Bomba de dirección hidráulica');
    expect(html).toContain('break-words');
  });

  it('defers reference photos until they are needed', () => {
    const html = render();
    expect(html).toContain('alt="Referencia 1"');
    expect(html).toContain('loading="lazy"');
  });
});
