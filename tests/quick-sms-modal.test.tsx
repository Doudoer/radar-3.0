import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  QuickSMSModal,
  buildDeliveryMessages,
  cleanPhoneDigits,
  formatPrice,
  getPartHeader,
} from '../src/components/QuickSMSModal';
import { Order } from '../src/types';

describe('QuickSMSModal delivery message formatting', () => {
  it('formats clean phone digits', () => {
    expect(cleanPhoneDigits('(919) 888-3853')).toBe('9198883853');
    expect(cleanPhoneDigits('919-888-3853')).toBe('9198883853');
    expect(cleanPhoneDigits('9198883853')).toBe('9198883853');
    expect(cleanPhoneDigits(null)).toBe('');
    expect(cleanPhoneDigits(undefined)).toBe('');
  });

  it('formats currency values correctly without unnecessary trailing zeros for integers', () => {
    expect(formatPrice(700)).toBe('$700');
    expect(formatPrice(700.5)).toBe('$700.50');
    expect(formatPrice(0)).toBe('$0');
  });

  it('extracts part headers and displacement properly', () => {
    expect(getPartHeader('Motor', '2.5')).toBe('*ENGINE* 2.5');
    expect(getPartHeader('ENGINE', '3.5L')).toBe('*ENGINE* 3.5L');
    expect(getPartHeader('Transmisión', '4x4')).toBe('*TRANSMISSION* 4x4');
    expect(getPartHeader('Alternator')).toBe('*ALTERNATOR*');
  });

  it('matches the exact sample from user reference image', () => {
    const mockOrder: Order = {
      id: 'ORD-101',
      code: 'ORD-101',
      createdAt: '2026-10-07',
      advisor: 'Admin',
      status: 'listo_retiro',
      mainPart: 'ENGINE',
      productSpecs: '2.5L, w/o hybrid; (VIN A, 4th digit, QR25DE), Federal emissions',
      deliveryType: 'retiro_tienda',
      customer: {
        id: 'cust-1',
        name: 'Chino Rufino S y L',
        type: 'Particular',
        email: 'chino@example.com',
        phone: '9198883853',
        location: 'NC',
        initials: 'CR',
      },
      vehicle: {
        vin: '1N4AL21E88C111111',
        plate: 'XYZ123',
        make: 'NISSAN',
        model: 'Altima',
        year: 2008,
        trim: '2.5',
        mileage: '120k',
        color: 'Silver',
      },
      workflowStep: 2,
      financials: {
        partPrice: 700,
        subtotal: 700,
        total: 700,
        downPayment: 0,
        balanceDue: 700,
        coreFee: 150,
      },
    };

    const messages = buildDeliveryMessages({ order: mockOrder });

    const expectedEnglish = [
      '*Chino Rufino S y L*',
      '*Phone:* 9198883853',
      'NISSAN Altima 2008',
      '*ENGINE* 2.5',
      '2.5L, w/o hybrid; (VIN A, 4th digit, QR25DE), Federal emissions',
      'Remaining Balance: *$700*',
      '*Note:* Collect old core from customer upon delivery. If customer does not have core, collect an additional refundable $150 deposit.',
    ].join('\n');

    const expectedSpanish = [
      '*Chino Rufino S y L*',
      '*Teléfono:* 9198883853',
      'NISSAN Altima 2008',
      '*ENGINE* 2.5',
      '2.5L, w/o hybrid; (VIN A, 4th digit, QR25DE), Federal emissions',
      'Balance Pendiente: *$700*',
      '*Note:* Solicitar el core usado al cliente al entregar. En caso de no tenerlo listo, cobrar $150 de depósito extra reembolsable.',
    ].join('\n');

    expect(messages.english).toBe(expectedEnglish);
    expect(messages.spanish).toContain('*Chino Rufino S y L*');
    expect(messages.spanish).toContain('Balance Pendiente: *$700*');
  });

  it('renders QuickSMSModal cleanly without hook violations when closed or open', () => {
    const mockOrder: Order = {
      id: 'ORD-101',
      code: 'ORD-101',
      createdAt: '2026-10-07',
      advisor: 'Admin',
      status: 'listo_retiro',
      mainPart: 'ENGINE',
      customer: {
        id: 'cust-1',
        name: 'Chino Rufino S y L',
        type: 'Particular',
        email: 'chino@example.com',
        phone: '9198883853',
        location: 'NC',
        initials: 'CR',
      },
      vehicle: {
        vin: '1N4AL21E88C111111',
        plate: 'XYZ123',
        make: 'NISSAN',
        model: 'Altima',
        year: 2008,
      },
      workflowStep: 2,
      financials: {
        partPrice: 700,
        subtotal: 700,
        total: 700,
        downPayment: 0,
        balanceDue: 700,
      },
    };

    // Render closed
    const closedHtml = renderToStaticMarkup(
      <QuickSMSModal
        isOpen={false}
        onClose={() => {}}
        customerName="Chino"
        phone="9198883853"
        order={mockOrder}
      />
    );
    expect(closedHtml).toBe('');

    // Render open
    const openHtml = renderToStaticMarkup(
      <QuickSMSModal
        isOpen={true}
        onClose={() => {}}
        customerName="Chino"
        phone="9198883853"
        order={mockOrder}
      />
    );
    expect(openHtml).toContain('Notificación &amp; Despacho WhatsApp');
    expect(openHtml).toContain('ORD-101');
    expect(openHtml).toContain('Wasender');
  });
});
