import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Tokens } from '../types.ts';

/**
 * Grace window for concurrent refreshes (two tabs presenting the same refresh token): for a
 * short time after a rotation, the old token yields the successor pair that was already issued
 * instead of counting as reuse. Successors are kept AES-256-GCM encrypted, keyed by the hash of
 * the token they replaced, in `users.attributes[ATTR_REFRESH_GRACE]` (no column for them exists).
 */
export const REFRESH_GRACE_MS = 15_000;
export const ATTR_REFRESH_GRACE = 'idp:refresh_grace';

interface GraceEntry {
  /** Encrypted successor tokens, base64url(iv | tag | ciphertext). */
  t: string;
  /** Window end, ms since the epoch. */
  until: number;
}
type GraceMap = Record<string, GraceEntry>;

export const graceKey = (secret: string | Uint8Array): Buffer =>
  createHash('sha256').update('idp-refresh-grace:').update(secret).digest();

function parse(raw: string | undefined): GraceMap {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' ? (v as GraceMap) : {};
  } catch {
    return {};
  }
}

function seal(key: Buffer, tokens: Tokens): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
}

function open(key: Buffer, sealed: string): Tokens | null {
  try {
    const buf = Buffer.from(sealed, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    const v = JSON.parse(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8')) as Tokens;
    return typeof v.accessToken === 'string' && typeof v.refreshToken === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** The attribute value after recording `successor` for `rotatedHash`; expired entries are dropped. */
export function addGrace(key: Buffer, raw: string | undefined, rotatedHash: Buffer, successor: Tokens, nowMs: number): string {
  const map = Object.fromEntries(Object.entries(parse(raw)).filter(([, e]) => e && typeof e.until === 'number' && e.until > nowMs));
  map[rotatedHash.toString('hex')] = { t: seal(key, successor), until: nowMs + REFRESH_GRACE_MS };
  return JSON.stringify(map);
}

/** The successor issued for `rotatedHash` if its window is still open, else null. */
export function findGrace(key: Buffer, raw: string | undefined, rotatedHash: Buffer, nowMs: number): Tokens | null {
  const entry = parse(raw)[rotatedHash.toString('hex')];
  if (!entry || typeof entry.until !== 'number' || entry.until <= nowMs || typeof entry.t !== 'string') return null;
  return open(key, entry.t);
}
