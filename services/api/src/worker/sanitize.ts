const EMAIL = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+/g;
const MAX_ERROR_LENGTH = 500;

/**
 * Turns an error into a short message safe to store in `last_error` and to log:
 * e-mail addresses (providers echo recipients in errors) are masked, control
 * characters removed, length capped.
 */
export function safeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const clean = raw.replace(EMAIL, '[email]').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return clean.length > MAX_ERROR_LENGTH ? `${clean.slice(0, MAX_ERROR_LENGTH - 1)}…` : clean;
}

/** The error's code/name only, for log lines. */
export function errorKind(err: unknown): string {
  if (err && typeof err === 'object') {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code) return code;
    const name = (err as { name?: unknown }).name;
    if (typeof name === 'string' && name) return name;
  }
  return 'Error';
}
