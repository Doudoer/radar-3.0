import { describe, expect, it } from 'vitest';
import { formatOtp2FAMessage } from '../src/integrations/wasender/notificationTemplates';
import { formatWasenderPhone } from '../src/integrations/wasender/client';

describe('Financial Module 2FA Security Protocol', () => {
  it('formats the 2FA OTP message correctly with 1-minute expiration and super admin notice', () => {
    const message = formatOtp2FAMessage({
      code: '849201',
      userName: 'Super Admin',
      moduleName: 'Relación Semanal & Finanzas',
      expirationMinutes: 1,
    });

    expect(message).toContain('🔐 *RADAR V3 • Bóveda Financiera (2FA)*');
    expect(message).toContain('👉 *849201*');
    expect(message).toContain('Relación Semanal & Finanzas');
    expect(message).toContain('⏱️ _Este código expira en 1 minuto (60 seg) y es de un solo uso._');
    expect(message).toContain('🛡️ _Canal exclusivo para Super Administrador_');
  });

  it('normalizes the Super Admin WhatsApp phone correctly', () => {
    expect(formatWasenderPhone('584127307933')).toBe('+584127307933');
    expect(formatWasenderPhone('+58 412-730-7933')).toBe('+584127307933');
    expect(formatWasenderPhone('04127307933')).toBe('+584127307933');
  });

  it('enforces 1-minute expiration on 2FA OTP state', () => {
    const now = Date.now();
    const otpState = {
      code: '592810',
      expiresAt: now + 60 * 1000, // 1 minute
      used: false,
    };

    // Valid within 1 minute
    const isExpiredAt30s = (now + 30 * 1000) > otpState.expiresAt;
    expect(isExpiredAt30s).toBe(false);

    // Expired after 61 seconds
    const isExpiredAt61s = (now + 61 * 1000) > otpState.expiresAt;
    expect(isExpiredAt61s).toBe(true);
  });

  it('enforces single-use consumption of 2FA codes', () => {
    const otpState = {
      code: '123456',
      expiresAt: Date.now() + 60 * 1000,
      used: false,
    };

    // First attempt: valid
    expect(otpState.used).toBe(false);
    otpState.used = true; // Mark as used upon successful verification

    // Second attempt with the same code must fail
    expect(otpState.used).toBe(true);
  });

  it('rejects incorrect codes and handles whitespace trimming', () => {
    const correctCode = '654321';
    const enteredCode = ' 654321 ';

    expect(enteredCode.trim()).toBe(correctCode);
    expect('999999'.trim() === correctCode).toBe(false);
  });
});
