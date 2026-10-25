import type { ErrorCode } from '@saunaklar/shared';
import { IdpError } from '../errors.ts';

/** Where a Cognito call happened; the same exception means different things per step. */
export type CognitoContext = 'signup' | 'auth' | 'code' | 'mfa' | 'challenge' | 'refresh' | 'admin';

const nameOf = (e: unknown): string => (e as { name?: unknown } | null)?.name?.toString() ?? '';
const messageOf = (e: unknown): string => (e as { message?: unknown } | null)?.message?.toString() ?? '';

/** Maps a Cognito exception onto an IdpError code, or null to rethrow the original error. */
export function cognitoErrorCode(e: unknown, ctx: CognitoContext): ErrorCode | null {
  const name = nameOf(e);
  switch (name) {
    case 'InvalidPasswordException':
      return 'PASSWORD_POLICY';
    case 'UsernameExistsException':
    case 'AliasExistsException':
      return 'CONFLICT';
    case 'UserNotConfirmedException':
      return 'EMAIL_NOT_VERIFIED';
    case 'CodeMismatchException':
    case 'EnableSoftwareTokenMFAException':
      return ctx === 'mfa' ? 'MFA_INVALID' : 'CODE_INVALID';
    case 'ExpiredCodeException':
      return ctx === 'mfa' || ctx === 'challenge' ? 'CHALLENGE_EXPIRED' : 'CODE_EXPIRED';
    case 'TooManyRequestsException':
    case 'TooManyFailedAttemptsException':
    case 'LimitExceededException':
      return 'RATE_LIMITED';
    case 'PasswordResetRequiredException':
      return 'INVALID_CREDENTIALS';
    case 'UserNotFoundException':
      // Never reveal that the username does not exist.
      if (ctx === 'auth') return 'INVALID_CREDENTIALS';
      if (ctx === 'code') return 'CODE_INVALID';
      if (ctx === 'refresh') return 'SESSION_EXPIRED';
      if (ctx === 'admin') return 'NOT_FOUND';
      return 'CHALLENGE_EXPIRED';
    case 'NotAuthorizedException': {
      const msg = messageOf(e).toLowerCase();
      if (msg.includes('disabled')) return 'ACCOUNT_DISABLED';
      if (msg.includes('attempts exceeded')) return 'RATE_LIMITED';
      if (ctx === 'refresh') return 'SESSION_EXPIRED';
      if (ctx === 'mfa' || ctx === 'challenge') return msg.includes('session') ? 'CHALLENGE_EXPIRED' : 'MFA_INVALID';
      if (ctx === 'code') return 'CODE_INVALID';
      return 'INVALID_CREDENTIALS';
    }
    default:
      return null;
  }
}

export function toIdpError(e: unknown, ctx: CognitoContext): unknown {
  const code = cognitoErrorCode(e, ctx);
  return code ? new IdpError(code, undefined, { cause: e }) : e;
}
