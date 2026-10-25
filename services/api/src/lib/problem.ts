import { ERROR_STATUS, type ErrorCode, type Problem } from '@saunaklar/shared';

/** Throw this anywhere in a handler; the error middleware turns it into problem+json. */
export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    detail?: string,
    readonly extra: { errors?: Record<string, string[]>; meta?: Record<string, unknown>; status?: number } = {},
  ) {
    super(detail ?? code);
    this.name = 'ApiError';
    this.status = extra.status ?? ERROR_STATUS[code];
  }
}

const TITLES: Partial<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: 'The request is not valid.',
  UNAUTHENTICATED: 'Please sign in.',
  FORBIDDEN: 'You are not allowed to do this.',
  NOT_FOUND: 'Not found.',
  INTERNAL: 'Something went wrong on our side.',
};

export function toProblem(err: ApiError, requestId: string): Problem {
  return {
    type: `https://saunaklar.dev/problems/${err.code.toLowerCase().replaceAll('_', '-')}`,
    title: TITLES[err.code] ?? err.code.toLowerCase().replaceAll('_', ' '),
    status: err.status,
    code: err.code,
    ...(err.message && err.message !== err.code ? { detail: err.message } : {}),
    requestId,
    ...(err.extra.errors ? { errors: err.extra.errors } : {}),
    ...(err.extra.meta ? { meta: err.extra.meta } : {}),
  };
}

export const notFound = (what = 'Resource') => new ApiError('NOT_FOUND', `${what} not found.`);
