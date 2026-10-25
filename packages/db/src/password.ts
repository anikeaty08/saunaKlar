/**
 * Password hashing for the local identity provider (schema idp), shared with the API.
 *
 * Format (idp.users.password_hash):  scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
 *   N = 16384, r = 8, p = 1, 16-byte random salt, 64-byte derived key (standard base64, padded).
 * Verification reads N/r/p from the stored string, so parameters can be raised later without
 * invalidating existing hashes.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

export const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keyLength: 64, saltLength: 16 } as const;

function scrypt(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFKC'), salt, keyLength, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function memFor(N: number, r: number): number {
  return 128 * N * r * 2 + 1024 * 1024;
}

export async function hashPassword(password: string): Promise<string> {
  const { N, r, p, keyLength, saltLength } = SCRYPT_PARAMS;
  const salt = randomBytes(saltLength);
  const key = await scrypt(password, salt, keyLength, { N, r, p, maxmem: memFor(N, r) });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![N, r, p].every(n => Number.isSafeInteger(n) && n > 0) || N > 1 << 20 || r > 32 || p > 16) return false;
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const expected = Buffer.from(parts[5] ?? '', 'base64');
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = await scrypt(password, salt, expected.length, { N, r, p, maxmem: memFor(N, r) });
  return timingSafeEqual(actual, expected);
}
