import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { IdpError } from '../errors.ts';

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

/** `scrypt$N$r$p$saltB64$hashB64`, the format the seed writes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const cost = Number(n);
  const blockSize = Number(r);
  const parallel = Number(p);
  // Bound parameters so a corrupted row cannot make us allocate gigabytes.
  if (![cost, blockSize, parallel].every(Number.isSafeInteger) || cost > 2 ** 20 || blockSize > 32 || parallel > 16) return false;
  const expected = Buffer.from(hashB64, 'base64');
  if (expected.length < 16) return false;
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: cost,
    r: blockSize,
    p: parallel,
    maxmem: 256 * 1024 * 1024,
  });
  return timingSafeEqual(actual, expected);
}

/** A hash of a random password, compared against for unknown users to keep timing uniform. */
let dummyHash: Promise<string> | undefined;
export const getDummyHash = (): Promise<string> => (dummyHash ??= hashPassword(randomBytes(16).toString('hex')));

export const PASSWORD_MIN_LENGTH = 10;

/** Cognito-style policy: at least 10 characters with upper case, lower case and a digit. */
export function checkPasswordPolicy(password: string): void {
  const ok =
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= 256 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password);
  if (!ok) {
    throw new IdpError('PASSWORD_POLICY', `Password must be at least ${PASSWORD_MIN_LENGTH} characters with upper case, lower case and a digit.`);
  }
}

/** A policy-compliant temporary password without look-alike characters. */
export function generateTemporaryPassword(length = 16): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const pick = (set: string) => set[randomInt(set.length)]!;
  const chars = [pick(upper), pick(lower), pick(digits)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}
