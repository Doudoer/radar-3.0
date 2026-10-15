import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateTotpCode,
  generateTotpSecret,
  getTotpUri,
  verifyTotpCode,
  generateBackupCodes,
  verifyAndConsumeBackupCode,
} from '../src/server/totp';

describe('TOTP (RFC 6238) Engine for Backup 2FA', () => {
  it('generates a valid 32-character base32 secret', () => {
    const secret = generateTotpSecret(20);
    expect(secret).toHaveLength(32);
    expect(secret).toMatch(/^[A-Z2-7]+$/);
  });

  it('correctly encodes and decodes base32 buffers symmetrically', () => {
    const original = Buffer.from('Radar3.0-SuperAdmin-Secret-Key', 'utf-8');
    const encoded = base32Encode(original);
    const decoded = base32Decode(encoded);
    expect(decoded.toString('utf-8')).toBe(original.toString('utf-8'));
  });

  it('generates a 6-digit numeric TOTP code', () => {
    const secret = generateTotpSecret();
    const code = generateTotpCode(secret);
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('verifies a valid code generated at the current timestamp', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = generateTotpCode(secret, now);

    const isValid = verifyTotpCode(secret, code, 1, now);
    expect(isValid).toBe(true);
  });

  it('accepts code within allowable window of +/- 30 seconds for clock drift', () => {
    const secret = generateTotpSecret();
    const now = Date.now();

    // Code generated 25 seconds ago (step might be same or -1)
    const pastCode = generateTotpCode(secret, now - 25 * 1000);
    expect(verifyTotpCode(secret, pastCode, 1, now)).toBe(true);

    // Code generated 25 seconds in future (step might be same or +1)
    const futureCode = generateTotpCode(secret, now + 25 * 1000);
    expect(verifyTotpCode(secret, futureCode, 1, now)).toBe(true);
  });

  it('rejects an expired code beyond the +/- 1 window (e.g., 95 seconds ago)', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const oldCode = generateTotpCode(secret, now - 95 * 1000);

    expect(verifyTotpCode(secret, oldCode, 1, now)).toBe(false);
  });

  it('rejects an invalid code or wrong secret', () => {
    const secret = generateTotpSecret();
    const otherSecret = generateTotpSecret();
    const code = generateTotpCode(secret);

    expect(verifyTotpCode(otherSecret, code)).toBe(false);
    expect(verifyTotpCode(secret, '000000')).toBe(false);
    expect(verifyTotpCode(secret, '12345')).toBe(false); // too short
    expect(verifyTotpCode(secret, 'abcdef')).toBe(false); // non-digits
  });

  it('constructs a compliant otpauth://totp URI for Google Authenticator', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const uri = getTotpUri(secret, 'superadmin@radar.com', 'Radar 3.0');

    expect(uri).toContain('otpauth://totp/Radar%203.0:superadmin%40radar.com');
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=Radar+3.0');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  // RFC 6238 Appendix B test vectors for HMAC-SHA1
  // Secret is ASCII "12345678901234567890" -> Base32 "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
  it('conforms to standard RFC 6238 test vectors', () => {
    const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

    // T = 59s -> timestampMs = 59000 -> Expected OTP = 287082
    expect(generateTotpCode(rfcSecret, 59 * 1000)).toBe('287082');

    // T = 1111111109s -> Expected OTP = 081804
    expect(generateTotpCode(rfcSecret, 1111111109 * 1000)).toBe('081804');

    // T = 1111111111s -> Expected OTP = 050471
    expect(generateTotpCode(rfcSecret, 1111111111 * 1000)).toBe('050471');

    // T = 2000000000s -> Expected OTP = 279037
    expect(generateTotpCode(rfcSecret, 2000000000 * 1000)).toBe('279037');
  });
});

describe('2FA Emergency Backup Codes Engine', () => {
  it('generates exactly 8 unique, formatted 8-digit backup codes', () => {
    const codes = generateBackupCodes(8);
    expect(codes).toHaveLength(8);

    const codeSet = new Set<string>();
    for (const item of codes) {
      expect(item.code).toMatch(/^\d{4}-\d{4}$/);
      expect(item.used).toBe(false);
      expect(item.usedAt).toBeNull();
      codeSet.add(item.code);
    }
    expect(codeSet.size).toBe(8); // all must be unique
  });

  it('validates and consumes a backup code successfully (single use)', () => {
    const codes = generateBackupCodes(8);
    const targetCode = codes[2].code;

    // First use: valid
    const result1 = verifyAndConsumeBackupCode(codes, targetCode);
    expect(result1.valid).toBe(true);
    expect(result1.matchedCode).toBe(targetCode);
    expect(result1.updatedCodes[2].used).toBe(true);
    expect(result1.updatedCodes[2].usedAt).not.toBeNull();

    // Second use: must be rejected (single use only)
    const result2 = verifyAndConsumeBackupCode(result1.updatedCodes, targetCode);
    expect(result2.valid).toBe(false);
  });

  it('accepts backup codes with or without hyphens and spaces', () => {
    const codes = generateBackupCodes(8);
    const rawDigits = codes[0].code.replace('-', '');

    // User inputs raw 8 digits without hyphen
    const resultWithoutHyphen = verifyAndConsumeBackupCode(codes, `  ${rawDigits}  `);
    expect(resultWithoutHyphen.valid).toBe(true);
    expect(resultWithoutHyphen.matchedCode).toBe(codes[0].code);
  });

  it('rejects an invalid, incorrect, or empty backup code', () => {
    const codes = generateBackupCodes(8);
    expect(verifyAndConsumeBackupCode(codes, '9999-9999').valid).toBe(false);
    expect(verifyAndConsumeBackupCode(codes, '').valid).toBe(false);
    expect(verifyAndConsumeBackupCode(codes, '12345').valid).toBe(false);
  });
});
