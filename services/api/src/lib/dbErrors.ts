import { ERROR_CODES, type ErrorCode } from '@saunaklar/shared';
import { ApiError } from './problem.ts';

const KNOWN = new Set<string>(ERROR_CODES);

/** Maps a constraint name to a domain error where a raw constraint error is the expected signal. */
const CONSTRAINTS: Record<string, ErrorCode> = {
  resellers_slug_key: 'SLUG_TAKEN',
  configuration_requests_configuration_id_key: 'REQUEST_EXISTS',
};

interface PgError { code?: string; message?: string; constraint?: string; hint?: string; detail?: string }

/**
 * Database triggers raise `P0001` with a message prefixed by a machine code
 * (`DISCOUNT_EXCEEDS_CAP: ...`). This turns those, and the standard integrity
 * errors, into ApiErrors. Returns null for anything that is a real server bug.
 */
export function mapDbError(err: unknown): ApiError | null {
  if (!err || typeof err !== 'object' || !('code' in err)) return null;
  const e = err as PgError;
  if (e.code === 'P0001' && e.message) {
    const m = /^([A-Z_]+):\s*(.*)$/s.exec(e.message);
    const code = m?.[1] ?? e.hint;
    if (code && KNOWN.has(code)) return new ApiError(code as ErrorCode, m?.[2] ?? e.message);
    return new ApiError('CONFLICT', e.message);
  }
  if (e.constraint && CONSTRAINTS[e.constraint]) return new ApiError(CONSTRAINTS[e.constraint]!);
  switch (e.code) {
    case '23505': return new ApiError('CONFLICT', 'This already exists.');
    case '23503': return new ApiError('CONFLICT', 'A referenced record does not exist or is still in use.');
    case '23514': return new ApiError('VALIDATION_FAILED', 'A value is outside the allowed range.');
    case '22P02': return new ApiError('BAD_REQUEST', 'Malformed identifier.');
    case '42501': return new ApiError('FORBIDDEN');
    case '40001': case '40P01': return new ApiError('CONFLICT', 'Concurrent update, please retry.');
    default: return null;
  }
}
