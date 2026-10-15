import crypto from 'node:crypto';

// RFC 4648 Base32 alphabet
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encodes a buffer to RFC 4648 Base32 string (without padding for cleaner QR codes).
 */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Decodes an RFC 4648 Base32 string into a Buffer.
 */
export function base32Decode(input: string): Buffer {
  const cleanInput = input.toUpperCase().replace(/[\s-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleanInput.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleanInput[i]);
    if (idx === -1) {
      continue; // Skip invalid chars or padding '='
    }

    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generates a cryptographically secure Base32 TOTP secret (20 bytes = 160 bits = 32 chars).
 */
export function generateTotpSecret(byteLength = 20): string {
  const randomBytes = crypto.randomBytes(byteLength);
  return base32Encode(randomBytes);
}

/**
 * Computes the 6-digit TOTP code for a given secret and timestamp (RFC 6238 / RFC 4226).
 */
export function generateTotpCode(
  secret: string,
  timestampMs: number = Date.now(),
  periodSeconds: number = 30,
  digits: number = 6
): string {
  const counter = Math.floor(timestampMs / 1000 / periodSeconds);
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeBigUInt64BE(BigInt(counter));

  const keyBuffer = base32Decode(secret);
  const hmac = crypto.createHmac('sha1', keyBuffer).update(timeBuffer).digest();

  // Dynamic Truncation
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binary % Math.pow(10, digits);
  return otp.toString().padStart(digits, '0');
}

/**
 * Verifies a user-provided 6-digit TOTP code against the secret.
 * Allows a configurable time step window (default = 1, meaning current ±30s step)
 * to accommodate slight mobile clock skew.
 */
export function verifyTotpCode(
  secret: string,
  token: string,
  windowSteps: number = 1,
  timestampMs: number = Date.now(),
  periodSeconds: number = 30,
  digits: number = 6
): boolean {
  if (!secret || !token) return false;
  const cleanToken = token.trim();
  if (cleanToken.length !== digits || !/^\d+$/.test(cleanToken)) {
    return false;
  }

  const currentCounter = Math.floor(timestampMs / 1000 / periodSeconds);

  for (let offset = -windowSteps; offset <= windowSteps; offset++) {
    const stepCounter = currentCounter + offset;
    const timeBuffer = Buffer.alloc(8);
    timeBuffer.writeBigUInt64BE(BigInt(stepCounter));

    const keyBuffer = base32Decode(secret);
    const hmac = crypto.createHmac('sha1', keyBuffer).update(timeBuffer).digest();

    const dynOffset = hmac[hmac.length - 1] & 0x0f;
    const binary =
      ((hmac[dynOffset] & 0x7f) << 24) |
      ((hmac[dynOffset + 1] & 0xff) << 16) |
      ((hmac[dynOffset + 2] & 0xff) << 8) |
      (hmac[dynOffset + 3] & 0xff);

    const expectedOtp = (binary % Math.pow(10, digits)).toString().padStart(digits, '0');

    // Timing-safe buffer comparison to prevent timing attacks
    if (
      crypto.timingSafeEqual(
        Buffer.from(cleanToken, 'utf-8'),
        Buffer.from(expectedOtp, 'utf-8')
      )
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Builds the standard `otpauth://totp/...` URI used by Google Authenticator,
 * Microsoft Authenticator, Authy, etc.
 */
export function getTotpUri(
  secret: string,
  accountName: string,
  issuer: string = 'Radar 3.0'
): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const params = new URLSearchParams({
    secret: secret.replace(/\s+/g, '').toUpperCase(),
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });

  return `otpauth://totp/${label}?${params.toString()}`;
}

export interface BackupCodeItem {
  code: string;
  used: boolean;
  usedAt: string | null;
}

/**
 * Generates an array of `count` secure, human-friendly 8-digit backup codes.
 * Format: "XXXX-XXXX" (e.g., "4829-1053")
 */
export function generateBackupCodes(count: number = 8): BackupCodeItem[] {
  const codes: BackupCodeItem[] = [];
  const usedSet = new Set<string>();

  while (codes.length < count) {
    const rawNumber = crypto.randomInt(10000000, 99999999).toString();
    const formatted = `${rawNumber.slice(0, 4)}-${rawNumber.slice(4)}`;
    if (!usedSet.has(formatted)) {
      usedSet.add(formatted);
      codes.push({
        code: formatted,
        used: false,
        usedAt: null,
      });
    }
  }

  return codes;
}

/**
 * Verifies and redeems a backup code from the list of codes.
 * Returns { valid: boolean, updatedCodes: BackupCodeItem[], matchedCode?: string }
 */
export function verifyAndConsumeBackupCode(
  codes: BackupCodeItem[],
  providedCode: string
): { valid: boolean; updatedCodes: BackupCodeItem[]; matchedCode?: string } {
  if (!Array.isArray(codes) || !providedCode) {
    return { valid: false, updatedCodes: codes || [] };
  }

  const cleanProvided = providedCode.replace(/[\s-]/g, '').toUpperCase();
  let matchedIndex = -1;

  for (let i = 0; i < codes.length; i++) {
    const item = codes[i];
    if (item.used) continue;
    const cleanItem = item.code.replace(/[\s-]/g, '').toUpperCase();
    if (cleanItem === cleanProvided) {
      matchedIndex = i;
      break;
    }
  }

  if (matchedIndex === -1) {
    return { valid: false, updatedCodes: codes };
  }

  const updatedCodes = codes.map((c, i) =>
    i === matchedIndex
      ? { ...c, used: true, usedAt: new Date().toISOString() }
      : c
  );

  return {
    valid: true,
    updatedCodes,
    matchedCode: codes[matchedIndex].code,
  };
}
