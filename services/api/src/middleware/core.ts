import type { ErrorHandler, MiddlewareHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { randomUUID } from 'node:crypto';
import type { AppEnv } from '../context.ts';
import { safeEqual } from '../lib/crypto.ts';
import { ApiError, toProblem } from '../lib/problem.ts';
import { mapDbError } from '../lib/dbErrors.ts';
import { isAdapterError } from '../adapters/errors.ts';

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Request id (honours a well-formed incoming one), timing and one access-log line. */
export const requestContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  const incoming = c.req.header('x-request-id');
  const id = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  c.set('requestId', id);
  c.header('x-request-id', id);
  const started = performance.now();
  await next();
  const { log } = c.get('deps');
  log.info('request', {
    requestId: id,
    method: c.req.method,
    // Share tokens are credentials: never log them.
    route: c.req.routePath?.replace(/\/shared\/:token/, '/shared/:token') ?? 'unmatched',
    status: c.res.status,
    ms: Math.round(performance.now() - started),
    tenant: c.get('tenant')?.slug ?? null,
    principal: c.get('principal')?.kind ?? 'anonymous',
  });
};

/** Security headers on every API response; the edge adds the page-level ones. */
export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header('x-content-type-options', 'nosniff');
  c.header('referrer-policy', 'strict-origin-when-cross-origin');
  c.header('cross-origin-resource-policy', 'same-origin');
  if (!c.res.headers.has('cache-control')) c.header('cache-control', 'no-store');
};

/** Only CloudFront may call the API in production (design 15.1 "origin lock"). */
export const originLock: MiddlewareHandler<AppEnv> = async (c, next) => {
  const secret = c.get('deps').config.ORIGIN_SECRET;
  if (secret) {
    const got = c.req.header('x-origin-secret') ?? '';
    if (!safeEqual(got, secret)) throw new ApiError('ORIGIN_REJECTED');
  }
  await next();
};

export const onError: ErrorHandler<AppEnv> = (err, c) => {
  const requestId = c.get('requestId') ?? 'unknown';
  let apiErr: ApiError;
  if (err instanceof ApiError) apiErr = err;
  else if (isAdapterError(err)) apiErr = new ApiError(err.code, err.message === err.code ? undefined : err.message);
  else if (err instanceof HTTPException) apiErr = new ApiError(err.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST', err.message);
  else apiErr = mapDbError(err) ?? new ApiError('INTERNAL');
  if (apiErr.status >= 500) {
    c.get('deps')?.log.error('unhandled error', { requestId, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err), stack: err instanceof Error ? err.stack : undefined });
  }
  return c.json(toProblem(apiErr, requestId), apiErr.status as 400, { 'content-type': 'application/problem+json', 'cache-control': 'no-store' });
};

export const notFoundHandler: NotFoundHandler<AppEnv> = c =>
  c.json(toProblem(new ApiError('NOT_FOUND', 'No such endpoint.'), c.get('requestId') ?? 'unknown'), 404, { 'content-type': 'application/problem+json' });
