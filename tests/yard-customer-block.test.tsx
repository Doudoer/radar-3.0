import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { YardCustomerBlock } from '../src/components/YardCustomerBlock';

const customer = {
  name: 'Ana Torres',
  phone: '(555) 010-0100',
  type: 'Taller Mecánico' as const,
  company: 'Taller Norte',
};

describe('yard detail customer block', () => {
  it('shows the customer name, type, company and a dialable phone with a copy button', () => {
    const html = renderToStaticMarkup(
      <YardCustomerBlock customer={customer} phoneCopied={false} onCopyPhone={() => {}} />
    );
    expect(html).toContain('Cliente');
    expect(html).toContain('Ana Torres');
    expect(html).toContain('Taller Mecánico');
    expect(html).toContain('Taller Norte');
    expect(html).toContain('href="tel:5550100100"');
    expect(html).toContain('(555) 010-0100');
    expect(html).toContain('aria-label="Copiar teléfono de Ana Torres"');
    expect(html).toContain('Copiar');
  });

  it('confirms when the phone was copied', () => {
    const html = renderToStaticMarkup(
      <YardCustomerBlock customer={customer} phoneCopied onCopyPhone={() => {}} />
    );
    expect(html).toContain('¡Copiado!');
    expect(html).toContain('check');
  });

  it('states clearly when the customer has no phone instead of offering a broken call link', () => {
    const html = renderToStaticMarkup(
      <YardCustomerBlock customer={{ ...customer, phone: '' }} onCopyPhone={() => {}} />
    );
    expect(html).toContain('Sin teléfono registrado');
    expect(html).not.toContain('tel:');
    expect(html).not.toContain('Copiar teléfono');
  });

  it('falls back to a neutral name when the order has no linked customer', () => {
    const html = renderToStaticMarkup(<YardCustomerBlock customer={null} />);
    expect(html).toContain('Cliente sin nombre');
    expect(html).toContain('Sin teléfono registrado');
  });
});
