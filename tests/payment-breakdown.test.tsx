import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OrderPaymentFields } from '../src/components/OrderPayments';
import { emptySettlement, type PaymentDetail, type Settlement } from '../src/utils/orderPayments';

const detail: PaymentDetail = {
  version: 1, canRecord: true, order: { price: 900, shipping: 75, core: 150, paid: 200, coreReceived: false },
  payments: [], coreReceipt: null,
};
const markup = (value: Settlement = emptySettlement(), data = detail) => renderToStaticMarkup(
  <OrderPaymentFields orderId="901" detail={data} value={value} onChange={() => {}} />,
);
const expectRow = (html: string, label: string, amount: string) => {
  expect(html).toContain(`<dt>${label}</dt><dd`);
  expect(html.match(new RegExp(`${label}</dt><dd[^>]*>([^<]+)</dd>`))?.[1]).toBe(amount);
};

describe('collection financial breakdown', () => {
  it('itemizes piece, delivery, core, total, existing downpayment and remaining amount together', () => {
    const html = markup();
    for (const [label, amount] of [
      ['Precio de la pieza', '$900.00'], ['Delivery / envío', '$75.00'], ['Cargo de core', '$150.00'],
      ['Monto total de la venta', '$1,125.00'], ['Downpayment / pagos anteriores', '$200.00'],
      ['Monto restante antes de este cobro', '$925.00'], ['Cobro nuevo', '$0.00'],
      ['Acumulado cobrado', '$200.00'], ['Monto restante por cobrar', '$925.00'],
    ]) expectRow(html, label, amount);
    expect(html).toContain('incluye el abono y cualquier pago posterior ya registrado');
  });
  it('updates core adjustment, adjusted total and remainder without counting previous payments twice', () => {
    const html = markup({ ...emptySettlement(), coreAction: 'received', coreConfirmed: true, coreReference: 'CORE-TEST',
      payments: [{ amount: 775, method: 'cash', receivedBy: 'Cajero', reference: '', confirmed: true }] });
    expectRow(html, 'Ajuste por core recibido', '-$150.00');
    expectRow(html, 'Monto total a liquidar', '$975.00');
    expectRow(html, 'Cobro nuevo', '$775.00');
    expectRow(html, 'Acumulado cobrado', '$975.00');
    expectRow(html, 'Monto restante por cobrar', '$0.00');
  });
  it('keeps zero delivery/core explicit and supports cents and a fully paid sale', () => {
    const html = markup(emptySettlement(), { ...detail, order: { price: 100.15, shipping: 0, core: 0, paid: 100.15, coreReceived: true } });
    expectRow(html, 'Delivery / envío', '$0.00');
    expectRow(html, 'Cargo de core', '$0.00');
    expectRow(html, 'Monto restante por cobrar', '$0.00');
  });
  it('correctly adapts breakdown when customer promised core at creation but decides to pay it at delivery', () => {
    const zeroCoreDetail: PaymentDetail = {
      version: 1, canRecord: true,
      order: { price: 1200, shipping: 0, core: 0, paid: 200, coreReceived: false },
      payments: [], coreReceipt: null,
    };
    const settlementWithCore: Settlement = {
      payments: [{ amount: 1150, method: 'cash', receivedBy: 'Favio', reference: '', confirmed: true }],
      coreAction: 'charge',
      coreAmount: 150,
      coreReference: '',
      coreConfirmed: false,
    };
    const html = markup(settlementWithCore, zeroCoreDetail);
    expectRow(html, 'Cargo de core', '$150.00');
    expectRow(html, 'Monto total de la venta', '$1,350.00');
    expectRow(html, 'Downpayment / pagos anteriores', '$200.00');
    expectRow(html, 'Monto restante antes de este cobro', '$1,150.00');
    expectRow(html, 'Monto total a liquidar', '$1,350.00');
    expectRow(html, 'Cobro nuevo', '$1,150.00');
    expectRow(html, 'Acumulado cobrado', '$1,350.00');
    expectRow(html, 'Monto restante por cobrar', '$0.00');
    expect(html).toContain('El cliente no trajo la pieza usada y pagará el core');
    expect(html).toContain('Monto a cobrar por el core (USD)');
    expect(html).toContain('value="150"');
    expect(html).toContain('Saldo liquidado exactamente');
  });
});
