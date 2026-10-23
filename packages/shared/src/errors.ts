import { z } from 'zod';

/**
 * Stable machine-readable error codes. The API returns them in the `code`
 * field of an RFC 9457 problem document; the web app switches on them.
 */
export const ERROR_CODES = [
  // generic
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'GONE',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'INTERNAL',
  // tenancy and edge
  'TENANT_NOT_FOUND',
  'TENANT_SUSPENDED',
  'WRONG_HOST',
  'CSRF_FAILED',
  'ORIGIN_REJECTED',
  'STALE_CATALOG_VERSION',
  // auth
  'INVALID_CREDENTIALS',
  'EMAIL_NOT_VERIFIED',
  'CODE_INVALID',
  'CODE_EXPIRED',
  'PASSWORD_POLICY',
  'MFA_REQUIRED',
  'MFA_INVALID',
  'CHALLENGE_EXPIRED',
  'ACCOUNT_DISABLED',
  'SESSION_EXPIRED',
  // domain
  'DISCOUNT_EXCEEDS_CAP',
  'SAUNA_NOT_ASSIGNABLE',
  'SAUNA_NOT_OFFERED',
  'OPTION_RULES_VIOLATED',
  'CONFIGURATION_LOCKED',
  'CONFIGURATION_NOT_LOCKED',
  'REQUEST_EXISTS',
  'INVALID_TRANSITION',
  'QUOTE_EXPIRED',
  'QUOTE_MISSING',
  'SHARE_LINK_EXPIRED',
  'SHARE_LINK_REVOKED',
  'SLUG_RESERVED',
  'SLUG_TAKEN',
  'SLUG_INVALID',
  'EMAIL_TAKEN',
  'UPLOAD_INVALID',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.enum(ERROR_CODES),
  detail: z.string().optional(),
  requestId: z.string().optional(),
  /** Field errors for VALIDATION_FAILED, keyed by dotted path. */
  errors: z.record(z.string(), z.array(z.string())).optional(),
  /** Extra machine-readable context, e.g. `currentVersion` for STALE_CATALOG_VERSION. */
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type Problem = z.infer<typeof problemSchema>;

export const ERROR_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GONE: 410,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INTERNAL: 500,
  TENANT_NOT_FOUND: 404,
  TENANT_SUSPENDED: 404,
  WRONG_HOST: 404,
  CSRF_FAILED: 403,
  ORIGIN_REJECTED: 403,
  STALE_CATALOG_VERSION: 409,
  INVALID_CREDENTIALS: 401,
  EMAIL_NOT_VERIFIED: 403,
  CODE_INVALID: 400,
  CODE_EXPIRED: 400,
  PASSWORD_POLICY: 422,
  MFA_REQUIRED: 401,
  MFA_INVALID: 401,
  CHALLENGE_EXPIRED: 401,
  ACCOUNT_DISABLED: 403,
  SESSION_EXPIRED: 401,
  DISCOUNT_EXCEEDS_CAP: 422,
  SAUNA_NOT_ASSIGNABLE: 422,
  SAUNA_NOT_OFFERED: 404,
  OPTION_RULES_VIOLATED: 422,
  CONFIGURATION_LOCKED: 409,
  CONFIGURATION_NOT_LOCKED: 409,
  REQUEST_EXISTS: 409,
  INVALID_TRANSITION: 409,
  QUOTE_EXPIRED: 409,
  QUOTE_MISSING: 409,
  SHARE_LINK_EXPIRED: 410,
  SHARE_LINK_REVOKED: 410,
  SLUG_RESERVED: 422,
  SLUG_TAKEN: 409,
  SLUG_INVALID: 422,
  EMAIL_TAKEN: 409,
  UPLOAD_INVALID: 422,
};
