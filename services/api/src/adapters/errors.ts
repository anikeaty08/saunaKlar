import type { ErrorCode } from '@saunaklar/shared';

/** An adapter failure the API maps onto a problem document with `code`. */
export class AdapterError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? code, options);
    this.name = 'AdapterError';
    this.code = code;
  }
}

/** Identity provider failure. Codes never reveal whether a username exists. */
export class IdpError extends AdapterError {
  constructor(code: ErrorCode, message?: string, options?: { cause?: unknown }) {
    super(code, message, options);
    this.name = 'IdpError';
  }
}

export const isAdapterError = (e: unknown): e is AdapterError => e instanceof AdapterError;
