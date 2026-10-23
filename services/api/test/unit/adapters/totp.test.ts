import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode } from '../../../src/adapters/idp/base32.ts';
import { generateTotpSecret, hotp, otpauthUri, totp, totpStep, verifyTotp } from '../../../src/adapters/idp/totp.ts';

// RFC 6238 Appendix B: seeds are ASCII "1234567890" repeated to the hash's key length.
const SEED_SHA1 = Buffer.from('12345678901234567890');
const SEED_SHA256 = Buffer.from('12345678901234567890123456789012');
const SEED_SHA512 = Buffer.from('1234567890123456789012345678901234567890123456789012345678901234');

const VECTORS: [number, string, string, string][] = [
  [59, '94287082', '46119246', '90693936'],
  [1111111109, '07081804', '68084774', '25091201'],
  [1111111111, '14050471', '67062674', '99943326'],
  [1234567890, '89005924', '91819424', '93441116'],
  [2000000000, '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826'],
];

describe('TOTP (RFC 6238)', () => {
  it.each(VECTORS)('matches the test vectors at T=%i', (time, sha1, sha256, sha512) => {
    expect(totp(SEED_SHA1, time, { digits: 8 })).toBe(sha1);
    expect(totp(SEED_SHA256, time, { digits: 8, algorithm: 'sha256' })).toBe(sha256);
    expect(totp(SEED_SHA512, time, { digits: 8, algorithm: 'sha512' })).toBe(sha512);
  });

  it('matches the RFC 4226 HOTP vectors', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expected.forEach((code, i) => expect(hotp(SEED_SHA1, BigInt(i))).toBe(code));
  });

  it('accepts ±1 step and returns the matched step', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000;
    const step = totpStep(now);
    expect(verifyTotp(secret, totp(secret, now), now)).toBe(step);
    expect(verifyTotp(secret, totp(secret, now - 30), now)).toBe(step - 1n);
    expect(verifyTotp(secret, totp(secret, now + 30), now)).toBe(step + 1n);
    expect(verifyTotp(secret, totp(secret, now - 60), now)).toBeNull();
    expect(verifyTotp(secret, totp(secret, now + 60), now)).toBeNull();
  });

  it('rejects malformed codes', () => {
    const secret = generateTotpSecret();
    for (const bad of ['', '12345', '1234567', 'abcdef', ' 123456']) expect(verifyTotp(secret, bad, 1_700_000_000)).toBeNull();
  });

  it('builds an otpauth URI authenticator apps understand', () => {
    const secret = Buffer.from('12345678901234567890');
    const uri = new URL(otpauthUri({ secret, issuer: 'Sauna & Co', account: 'a@b.ch' }));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/Sauna & Co:a@b.ch');
    expect(uri.searchParams.get('secret')).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(uri.searchParams.get('issuer')).toBe('Sauna & Co');
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('period')).toBe('30');
  });
});

describe('base32', () => {
  it('encodes the RFC 4648 vectors (unpadded)', () => {
    const cases: [string, string][] = [
      ['', ''],
      ['f', 'MY'],
      ['fo', 'MZXQ'],
      ['foo', 'MZXW6'],
      ['foob', 'MZXW6YQ'],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI'],
    ];
    for (const [plain, encoded] of cases) {
      expect(base32Encode(Buffer.from(plain))).toBe(encoded);
      expect(base32Decode(encoded).toString()).toBe(plain);
    }
  });

  it('round-trips random secrets and tolerates case, spaces and padding', () => {
    const secret = generateTotpSecret();
    const encoded = base32Encode(secret);
    expect(base32Decode(encoded)).toEqual(secret);
    expect(base32Decode(`${encoded.toLowerCase().replace(/(.{4})/g, '$1 ')}====`)).toEqual(secret);
  });

  it('rejects invalid characters', () => {
    expect(() => base32Decode('ABC1')).toThrow();
  });
});
