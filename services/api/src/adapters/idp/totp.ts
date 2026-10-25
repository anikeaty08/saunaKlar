import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { base32Encode } from './base32.ts';

/** RFC 6238 TOTP, the parameters every authenticator app supports. */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

export type TotpAlgorithm = 'sha1' | 'sha256' | 'sha512';

/** RFC 4226 HOTP value for one counter. */
export function hotp(secret: Uint8Array, counter: bigint, digits = TOTP_DIGITS, algorithm: TotpAlgorithm = 'sha1'): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(counter);
  const mac = createHmac(algorithm, secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return binary.toString().padStart(digits, '0');
}

export const totpStep = (unixSeconds: number, period = TOTP_PERIOD_SECONDS): bigint =>
  BigInt(Math.floor(unixSeconds / period));

export function totp(secret: Uint8Array, unixSeconds: number, opts: { digits?: number; algorithm?: TotpAlgorithm } = {}): string {
  return hotp(secret, totpStep(unixSeconds), opts.digits ?? TOTP_DIGITS, opts.algorithm ?? 'sha1');
}

/**
 * Verifies a code within ±`window` steps. Returns the matched step (for replay protection:
 * callers reject a step that is not greater than the last accepted one) or null.
 */
export function verifyTotp(secret: Uint8Array, code: string, unixSeconds: number, window = 1): bigint | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = totpStep(unixSeconds);
  const given = Buffer.from(code);
  let matched: bigint | null = null;
  // Check every candidate to keep timing independent of which one matched.
  for (let d = -window; d <= window; d++) {
    const step = now + BigInt(d);
    if (step < 0n) continue;
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), given) && matched === null) matched = step;
  }
  return matched;
}

/** 160-bit secret, the RFC 4226 recommended length (and what Cognito issues). */
export const generateTotpSecret = (): Buffer => randomBytes(20);

export function otpauthUri(input: { secret: Uint8Array; issuer: string; account: string }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  const params = new URLSearchParams({
    secret: base32Encode(input.secret),
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
