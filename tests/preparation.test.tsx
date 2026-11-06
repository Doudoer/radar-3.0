import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { preparationSchema, validatePreparation, emptyPreparation } from '../src/utils/orderPreparation';
import { PreparationFields } from '../src/components/OrderPreparation';

const ready = {
  yardNotified: true, channel: 'call', failedCall: false, failedCallNotes: '',
  customerConfirmed: true, dateFrom: '2099-01-02', dateTo: '2099-01-02',
  balanceNotified: true, paymentMethodsNotified: true, corePlan: 'return_core',
  deliveryType: 'retiro_tienda', address: '', screenshots: [],
};
describe('verified preparation and appointment', () => {
  it('records an immediate yard handover without inventing calls or an appointment range', () => {
    const immediate = { ...ready, channel: 'in_person', dateFrom: '2099-01-02', dateTo: '2099-01-02' };
    expect(preparationSchema.safeParse(immediate).success).toBe(true);
    expect(() => validatePreparation(preparationSchema.parse(immediate), '2099-01-02')).not.toThrow();
    for (const patch of [{ deliveryType: 'envio_domicilio', address: '123 Test Street' },
      { failedCall: true }, { failedCallNotes: 'Invented call' }]) {
      expect(preparationSchema.safeParse({ ...immediate, ...patch }).success).toBe(false);
    }
    expect(() => validatePreparation(preparationSchema.parse(immediate), '2099-01-01')).toThrow(/hoy/i);
    const html = renderToStaticMarkup(<PreparationFields value={{ ...emptyPreparation(), channel: 'in_person' }}
      onChange={() => {}} onUpload={async () => '/uploads/test.png'} />);
    expect(html).toContain('cliente está presente');
    expect(html).not.toContain('El patio notificó');
    expect(html).not.toContain('Fecha acordada desde');
  });
  it('accepts a confirmed phone call with an exact day or a valid tentative range', () => {
    expect(() => validatePreparation(preparationSchema.parse(ready), '2099-01-01')).not.toThrow();
    expect(() => validatePreparation(preparationSchema.parse({ ...ready, dateTo: '2099-01-04' }), '2099-01-01')).not.toThrow();
    expect(preparationSchema.safeParse(emptyPreparation()).success).toBe(false);
  });
  it('requires every communicated condition, valid dates and a core intention', () => {
    for (const patch of [{ yardNotified: false }, { customerConfirmed: false }, { balanceNotified: false },
      { paymentMethodsNotified: false }, { corePlan: '' }, { corePlan: 'received' }, { dateFrom: '2099-02-31' },
      { dateTo: '' }, { dateTo: '2099-01-01' }, { receivedMoney: true }]) {
      expect(preparationSchema.safeParse({ ...ready, ...patch }).success, JSON.stringify(patch)).toBe(false);
    }
    expect(() => validatePreparation(preparationSchema.parse(ready), '2099-01-03')).toThrow(/fecha/i);
  });
  it('allows SMS only after an unsuccessful call and requires client response with one or more screenshots', () => {
    const sms = { ...ready, channel: 'sms', failedCall: true, failedCallNotes: 'Cliente no contestó la llamada', screenshots: ['/uploads/client.png', '/uploads/reply.jpg'] };
    expect(preparationSchema.safeParse(sms).success).toBe(true);
    for (const patch of [{ failedCall: false }, { failedCallNotes: '' }, { customerConfirmed: false },
      { screenshots: [] }, { screenshots: ['https://other.example/test.png'] }, { screenshots: ['/uploads/test.pdf'] },
      { screenshots: Array(21).fill('/uploads/test.png') }]) {
      expect(preparationSchema.safeParse({ ...sms, ...patch }).success).toBe(false);
    }
    expect(preparationSchema.safeParse({ ...ready, screenshots: ['/uploads/client.png'] }).success).toBe(false);
  });
  it('requires a delivery address without changing core or money at preparation', () => {
    expect(preparationSchema.safeParse({ ...ready, deliveryType: 'envio_domicilio', address: '' }).success).toBe(false);
    expect(preparationSchema.safeParse({ ...ready, deliveryType: 'envio_domicilio', address: '123 Test Street, Test City', corePlan: 'pay_core' }).success).toBe(true);
  });
  it('renders phone versus SMS evidence and pickup versus delivery fields consistently', () => {
    const props = { onChange: () => {}, onUpload: async () => '/uploads/test.png' };
    const call = renderToStaticMarkup(<PreparationFields {...props} value={emptyPreparation()} />);
    expect(call).toContain('Cash App');
    expect(call).toContain('Zelle');
    expect(call).toContain('efectivo');
    expect(call).not.toContain('type="file"');
    expect(call).not.toContain('Dirección de entrega');
    const sms = renderToStaticMarkup(<PreparationFields {...props} value={{ ...emptyPreparation(), channel: 'sms', deliveryType: 'envio_domicilio' }} />);
    expect(sms).toContain('type="file"');
    expect(sms).toContain('multiple=""');
    expect(sms).toContain('Intenté llamar');
    expect(sms).toContain('Dirección de entrega');
  });
});
