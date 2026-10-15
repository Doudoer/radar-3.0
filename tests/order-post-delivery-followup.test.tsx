import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OrderPostDeliveryFollowup } from '../src/components/OrderPostDeliveryFollowup';
import { Order } from '../src/types';

const sampleDeliveredOrder: Order = {
  id: '577',
  code: 'ORD-854857',
  customer: {
    id: 'CUST-10',
    name: 'Senor Miguel',
    phone: '9197576858',
    email: 'miguel@example.com',
    shippingAddress: 'Raleigh, NC',
    location: 'Raleigh, NC',
    type: 'Particular',
    initials: 'SM',
  },
  vehicle: {
    make: 'TOYOTA',
    model: 'Corolla',
    year: 2009,
    vin: '1NXBR32E99Z123456',
    transmission: 'AT',
    plate: 'TOY-2009',
    mileage: '120000',
    color: 'Gris',
  },
  mainPart: 'Transmisión',
  status: 'entregado',
  workflowStep: 4,
  deliveredAt: '2026-10-08T20:25:51.000Z',
  warrantyDays: 60,
  warrantyStarted: true,
  financials: {
    partPrice: 1200,
    downPayment: 1200,
    deliveryFee: 0,
    coreFee: 0,
    balanceDue: 0,
    subtotal: 1200,
    total: 1200,
  },
  advisor: 'Favio Andrade',
  deliveryType: 'retiro_tienda',
  createdAt: '2026-09-22T16:34:14.000Z',
};

describe('OrderPostDeliveryFollowup Component', () => {
  it('renders the 14-day warranty verification timeline and advisor', () => {
    const html = renderToStaticMarkup(
      <OrderPostDeliveryFollowup
        order={sampleDeliveredOrder}
        currentUser={{ id: 2, name: 'Favio Andrade', role: 'operador' }}
        userRole="operador"
      />
    );

    expect(html).toContain('SEGUIMIENTO POST-ENTREGA');
    expect(html).toContain('14 DÍAS CLAVE');
    expect(html).toContain('Favio Andrade');
    expect(html).toContain('+ Registrar Llamada');
    expect(html).toContain('Día 1-3: Recepción');
    expect(html).toContain('Día 4-7: Montaje');
    expect(html).toContain('Día 8-14: Rodaje');
    expect(html).toContain('Bitácora de Contactos Realizados');
  });

  it('renders safely without throwing when customer phone is a numeric type from database', () => {
    const orderWithNumericPhone = {
      ...sampleDeliveredOrder,
      customer: {
        ...sampleDeliveredOrder.customer,
        phone: 9197576858 as any,
      },
    };

    expect(() => {
      const html = renderToStaticMarkup(
        <OrderPostDeliveryFollowup
          order={orderWithNumericPhone}
          currentUser={{ id: 2, name: 'Favio Andrade', role: 'operador' }}
          userRole="operador"
        />
      );
      expect(html).toContain('Llamar al cliente (9197576858)');
      expect(html).toContain('WhatsApp');
      expect(html).toContain('+ Registrar Llamada / Mensaje');
    }).not.toThrow();
  });
});

