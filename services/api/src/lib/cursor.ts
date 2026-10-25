import { ApiError } from './problem.ts';
import { hmac, safeEqual } from './crypto.ts';

/**
 * Keyset pagination cursors: `(sortValue, id)` of the last row, signed so a
 * client cannot craft one. Opaque to clients.
 */
export interface Cursor { at: string; id: string }

export function encodeCursor(secret: string, c: Cursor): string {
  const body = Buffer.from(JSON.stringify([c.at, c.id])).toString('base64url');
  return `${body}.${hmac(secret, body).slice(0, 16)}`;
}

export function decodeCursor(secret: string, raw: string | undefined): Cursor | null {
  if (!raw) return null;
  const [body, sig] = raw.split('.');
  if (!body || !sig || !safeEqual(sig, hmac(secret, body).slice(0, 16))) throw new ApiError('BAD_REQUEST', 'Invalid cursor.');
  try {
    const [at, id] = JSON.parse(Buffer.from(body, 'base64url').toString()) as [string, string];
    if (typeof at !== 'string' || typeof id !== 'string') throw new Error();
    return { at, id };
  } catch {
    throw new ApiError('BAD_REQUEST', 'Invalid cursor.');
  }
}

/** Slices one extra row to know whether there is a next page. */
export function pageOf<T>(rows: T[], limit: number, secret: string, key: (row: T) => Cursor) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(secret, key(last)) : null };
}
