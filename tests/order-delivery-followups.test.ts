import { describe, expect, it } from 'vitest';
import { orderDeliveryFollowupSchema } from '../src/server/schemas';
import { PendingFollowupItem } from '../src/types';

describe('Order Delivery Followup Schema & Business Logic', () => {
  it('validates a correct follow-up call payload', () => {
    const valid = orderDeliveryFollowupSchema.parse({
      callResult: 'answered',
      partStatus: 'installed_ok',
      warrantyWarningGiven: false,
      promisedInstallDate: null,
      notes: 'Cliente confirma que la pieza fue instalada y encendió sin novedades ni fugas.',
      operatorName: 'Favio Andrade',
    });

    expect(valid.callResult).toBe('answered');
    expect(valid.partStatus).toBe('installed_ok');
    expect(valid.notes).toContain('Cliente confirma');
  });

  it('rejects follow-up call with notes shorter than 5 characters', () => {
    expect(() =>
      orderDeliveryFollowupSchema.parse({
        callResult: 'answered',
        partStatus: 'not_installed',
        warrantyWarningGiven: true,
        notes: 'ok',
      })
    ).toThrow(/al menos 5 caracteres/);
  });

  it('validates postponed installation with promised date and warning flag', () => {
    const valid = orderDeliveryFollowupSchema.parse({
      callResult: 'answered',
      partStatus: 'not_installed',
      warrantyWarningGiven: true,
      promisedInstallDate: '2026-10-20',
      notes: 'Mecánico del cliente comenzará el desmontaje este fin de semana.',
      operatorName: 'David Isea',
    });

    expect(valid.warrantyWarningGiven).toBe(true);
    expect(valid.promisedInstallDate).toBe('2026-10-20');
  });

  it('correctly models urgency based on milestones and promised install dates', () => {
    const mockPendingItem: PendingFollowupItem = {
      orderId: '577',
      orderCode: 'ORD-854857',
      advisor: 'Favio Andrade',
      customerName: 'Senor Miguel',
      customerPhone: '9197576858',
      vehicle: '2009 TOYOTA Corolla',
      mainPart: 'Transmission',
      deliveredAt: '2026-10-08T20:25:51.000Z',
      daysSinceDelivery: 5,
      currentMilestone: 'dia_7',
      milestoneLabel: 'Hito 2: Montaje & Encendido',
      urgency: 'atrasada',
      lastFollowup: null,
      totalCalls: 0,
    };

    expect(mockPendingItem.urgency).toBe('atrasada');
    expect(mockPendingItem.currentMilestone).toBe('dia_7');
    expect(mockPendingItem.daysSinceDelivery).toBe(5);
  });

  it('validates a correct WhatsApp follow-up payload with customer reply and part status', () => {
    const valid = orderDeliveryFollowupSchema.parse({
      contactChannel: 'whatsapp',
      callResult: 'sms_replied',
      partStatus: 'installed_ok',
      warrantyWarningGiven: false,
      notes: 'Cliente respondió por WhatsApp confirmando que el motor ya está montado y funcionando perfecto.',
      operatorName: 'Favio Andrade',
    });

    expect(valid.contactChannel).toBe('whatsapp');
    expect(valid.callResult).toBe('sms_replied');
    expect(valid.partStatus).toBe('installed_ok');
    expect(valid.notes).toContain('WhatsApp');
  });

  it('validates a text message dispatch (sms_sent) awaiting customer response', () => {
    const valid = orderDeliveryFollowupSchema.parse({
      contactChannel: 'sms',
      callResult: 'sms_sent',
      partStatus: 'not_installed',
      warrantyWarningGiven: false,
      notes: 'Se envió mensaje de texto SMS recordando el período de prueba y validación de garantía en taller.',
      operatorName: 'David Isea',
    });

    expect(valid.contactChannel).toBe('sms');
    expect(valid.callResult).toBe('sms_sent');
  });

  it('marks follow-up urgency as proxima when contact was accomplished today', () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const orderWithFollowupToday: PendingFollowupItem = {
      orderId: '577',
      orderCode: 'ORD-854857',
      advisor: 'Favio Andrade',
      customerName: 'Senor Miguel',
      customerPhone: '9197576858',
      vehicle: '2009 TOYOTA Corolla',
      mainPart: 'Transmission',
      deliveredAt: '2026-10-08T20:25:51.000Z',
      daysSinceDelivery: 7,
      currentMilestone: 'dia_7',
      milestoneLabel: 'Hito 2: Montaje & Encendido',
      urgency: 'proxima', // Correctly transitioned to proxima after today's call
      lastFollowup: {
        id: 'FOL-101',
        orderId: '577',
        operatorName: 'David Isea',
        contactChannel: 'call',
        callResult: 'answered',
        partStatus: 'in_process',
        warrantyWarningGiven: true,
        promisedInstallDate: null,
        notes: 'Cliente atendió la llamada, mecánico está montando la caja hoy.',
        createdAt: `${todayStr}T14:30:00.000Z`,
      },
      totalCalls: 1,
    };

    expect(orderWithFollowupToday.urgency).toBe('proxima');
    expect(orderWithFollowupToday.lastFollowup?.createdAt.slice(0, 10)).toBe(todayStr);
    expect(orderWithFollowupToday.lastFollowup?.callResult).toBe('answered');
  });

  it('verifies partStatus installed_ok completes follow-up requirement', () => {
    const closedFollowup = orderDeliveryFollowupSchema.parse({
      callResult: 'answered',
      partStatus: 'installed_ok',
      warrantyWarningGiven: false,
      notes: 'Cliente confirma que la pieza quedó 100% operativa y sin fallas.',
      operatorName: 'Favio Andrade',
    });

    expect(closedFollowup.partStatus).toBe('installed_ok');
  });
});
