import { describe, expect, it } from 'vitest';
import { buildDeliveryMessages, cleanPhoneDigits, formatPrice, getPartHeader } from '../src/components/QuickSMSModal';
import { Order } from '../src/types';

describe('QuickSMSModal delivery message formatting', () => {
  it('formats clean phone digits', () => {
    expect(cleanPhoneDigits('(919) 888-3853')).toBe('9198883853');
    expect(cleanPhoneDigits('919-888-3853')).toBe('9198883853');
    expect(cleanPhoneDigits('9198883853')).toBe('9198883853');
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
      '*Nota:* Solicitar el core usado al cliente al entregar. En caso de no tenerlo listo, cobrar $150 de depósito extra reembolsable.',
    ].join('\n');

    expect(messages.english).toBe(expectedEnglish);
    expect(messages.spanish).toBe(expectedSpanish);
  });

  it('includes address when order has home delivery', () => {
    const mockOrder: Order = {
      id: 'ORD-102',
      code: 'ORD-102',
      createdAt: '2026-10-07',
      advisor: 'Admin',
      status: 'en_camino',
      mainPart: 'Motor',
      productSpecs: '3.5L V6',
      deliveryType: 'envio_domicilio',
      customer: {
        id: 'cust-2',
        name: 'Maria Perez',
        type: 'Particular',
        email: 'maria@example.com',
        phone: '7865551234',
        location: 'Miami',
        initials: 'MP',
        shippingAddress: '123 Ocean Dr, Miami FL 33139',
      },
      vehicle: {
        vin: '2T1BR32E88C222222',
        plate: 'MIA456',
        make: 'TOYOTA',
        model: 'Camry',
        year: 2015,
        trim: '3.5L',
        mileage: '85k',
        color: 'White',
      },
      workflowStep: 3,
      financials: {
        partPrice: 1200,
        subtotal: 1200,
        deliveryFee: 50,
        total: 1250,
        downPayment: 500,
        balanceDue: 750,
      },
      notes: 'Llamar 30 mins antes',
    };

    const messages = buildDeliveryMessages({ order: mockOrder });

    expect(messages.english).toContain('Address: 123 Ocean Dr, Miami FL 33139');
    expect(messages.english).toContain('Remaining Balance: *$750*');
    expect(messages.english).toContain('*Note:* Llamar 30 mins antes');

    expect(messages.spanish).toContain('Dirección: 123 Ocean Dr, Miami FL 33139');
    expect(messages.spanish).toContain('Balance Pendiente: *$750*');
    expect(messages.spanish).toContain('*Nota:* Llamar 30 mins antes');
  });
});
