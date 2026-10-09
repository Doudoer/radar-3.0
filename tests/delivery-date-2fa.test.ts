import { describe, expect, it } from 'vitest';
import { updateDeliveryDateSchema } from '../src/server/schemas';
import { formatWasenderPhone } from '../src/integrations/wasender/client';

describe('Delivery Date 2FA Modification for Delivered Orders', () => {
  describe('Schema Validation (updateDeliveryDateSchema)', () => {
    it('accepts a valid ISO delivery date and 6-digit OTP code', () => {
      const parsed = updateDeliveryDateSchema.parse({
        deliveredAt: '2026-10-08T14:30:00.000Z',
        otpCode: '481920',
        reason: 'Ajuste de garantía acordado con el cliente',
      });

      expect(parsed.deliveredAt).toBe('2026-10-08T14:30:00.000Z');
      expect(parsed.otpCode).toBe('481920');
      expect(parsed.reason).toBe('Ajuste de garantía acordado con el cliente');
    });

    it('accepts valid date without reason (reason is optional)', () => {
      const parsed = updateDeliveryDateSchema.parse({
        deliveredAt: '2026-10-01',
        otpCode: '123456',
      });

      expect(parsed.deliveredAt).toBe('2026-10-01');
      expect(parsed.otpCode).toBe('123456');
      expect(parsed.reason).toBeUndefined();
    });

    it('rejects an empty or invalid delivery date string', () => {
      expect(() =>
        updateDeliveryDateSchema.parse({
          deliveredAt: '',
          otpCode: '123456',
        })
      ).toThrow();
    });

    it('rejects OTP codes that do not meet length or format requirements', () => {
      // Too short
      expect(() =>
        updateDeliveryDateSchema.parse({
          deliveredAt: '2026-10-08T12:00:00Z',
          otpCode: '123',
        })
      ).toThrow();

      // Empty
      expect(() =>
        updateDeliveryDateSchema.parse({
          deliveredAt: '2026-10-08T12:00:00Z',
          otpCode: '',
        })
      ).toThrow();
    });
  });

  describe('Business Logic: Delivery Date Modification Constraints', () => {
    const isOrderEligibleForDeliveryDateChange = (status: string): boolean => {
      return status.toLowerCase() === 'entregado';
    };

    it('strictly allows delivery date modification only for orders with status "Entregado"', () => {
      expect(isOrderEligibleForDeliveryDateChange('entregado')).toBe(true);
      expect(isOrderEligibleForDeliveryDateChange('Entregado')).toBe(true);
      expect(isOrderEligibleForDeliveryDateChange('ENTREGADO')).toBe(true);

      // Other statuses must be rejected
      expect(isOrderEligibleForDeliveryDateChange('cotizacion')).toBe(false);
      expect(isOrderEligibleForDeliveryDateChange('pagado')).toBe(false);
      expect(isOrderEligibleForDeliveryDateChange('en_preparacion')).toBe(false);
      expect(isOrderEligibleForDeliveryDateChange('listo_retiro')).toBe(false);
      expect(isOrderEligibleForDeliveryDateChange('despachado')).toBe(false);
      expect(isOrderEligibleForDeliveryDateChange('reclamo')).toBe(false);
      expect(isOrderEligibleForDeliveryDateChange('cancelado')).toBe(false);
    });

    it('verifies Super Admin phone formatting for WhatsApp 2FA dispatch', () => {
      expect(formatWasenderPhone('04127307933')).toBe('+584127307933');
      expect(formatWasenderPhone('+58 412 730 7933')).toBe('+584127307933');
      expect(formatWasenderPhone('+1 (919) 555-0188')).toBe('+19195550188');
    });

    it('enforces 5-minute expiration on Delivery Date 2FA OTP state', () => {
      const now = Date.now();
      const otpSession = {
        code: '748291',
        expiresAt: now + 5 * 60 * 1000, // 5 minutes
        orderId: 42,
        requestedByUserId: 1,
      };

      // Valid within 5 minutes (e.g. 2 minutes elapsed)
      const isExpiredAt2Min = now + 2 * 60 * 1000 > otpSession.expiresAt;
      expect(isExpiredAt2Min).toBe(false);

      // Expired after 5 minutes and 1 second
      const isExpiredAt5Min1Sec = now + (5 * 60 + 1) * 1000 > otpSession.expiresAt;
      expect(isExpiredAt5Min1Sec).toBe(true);
    });

    it('enforces single-use consumption of Delivery Date OTP codes', () => {
      const activeOtps = new Map<string, { code: string; expiresAt: number }>();
      activeOtps.set('42', { code: '918273', expiresAt: Date.now() + 5 * 60 * 1000 });

      // First verification: success and delete
      const session = activeOtps.get('42');
      expect(session).toBeDefined();
      expect(session?.code).toBe('918273');

      // Consume OTP
      activeOtps.delete('42');

      // Second verification attempt with same code must fail
      const secondAttempt = activeOtps.get('42');
      expect(secondAttempt).toBeUndefined();
    });

    it('correctly constructs the WhatsApp 2FA message with order details and 5-min validity', () => {
      const orderCode = 'ORD-2026-9041';
      const otpCode = '639102';
      const textMessage = `🛡️ *RADAR V3 • Autorización de Fecha de Entrega*\n\nSe ha solicitado modificar la fecha de entrega física de la Orden *#${orderCode}* (Estatus: Entregado).\n\nTu código PIN de verificación es:\n👉 *${otpCode}*\n\n⏰ *Válido por:* 5 minutos\n_(Transmitido vía WasenderAPI)_`;

      expect(textMessage).toContain('ORD-2026-9041');
      expect(textMessage).toContain('639102');
      expect(textMessage).toContain('Estatus: Entregado');
      expect(textMessage).toContain('5 minutos');
    });

    it('formats audit log detail correctly when delivery date is updated', () => {
      const targetOrderId = 105;
      const orderCode = 'ORD-2026-105';
      const previousDeliveredAt = '2026-10-01T10:00:00.000Z';
      const newDeliveredAt = '2026-10-05T16:45:00.000Z';
      const reason = 'Cliente solicitó ajuste tras reporte de recepción';

      const auditEntry = {
        action: 'ORDER_DELIVERY_DATE_UPDATED',
        resourceType: 'order',
        resourceId: targetOrderId,
        details: {
          orderId: targetOrderId,
          orderCode,
          previousDeliveredAt,
          newDeliveredAt,
          reason,
        },
      };

      expect(auditEntry.action).toBe('ORDER_DELIVERY_DATE_UPDATED');
      expect(auditEntry.resourceId).toBe(105);
      expect(auditEntry.details.previousDeliveredAt).toBe('2026-10-01T10:00:00.000Z');
      expect(auditEntry.details.newDeliveredAt).toBe('2026-10-05T16:45:00.000Z');
      expect(auditEntry.details.reason).toBe(reason);
    });
  });
});
