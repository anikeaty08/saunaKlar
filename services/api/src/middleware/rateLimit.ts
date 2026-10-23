import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../context.ts';
import { ApiError } from '../lib/problem.ts';

/**
 * Fixed-window limiter keyed by client IP and route group. In AWS the WAF's
 * rate-based rules do this at the edge (design 15.1); this keeps local and
 * single-node deployments honest and makes the behaviour testable.
 */
export function rateLimit(opts: { windowMs: number; max: number; group: string }): MiddlewareHandler<AppEnv> {
  const hits = new Map<string, { start: number; count: number }>();
  return async (c, next) => {
    const { config, now } = c.get('deps');
    if (!config.RATE_LIMIT) return next();
    const ip = c.req.header('cloudfront-viewer-address')?.split(':')[0] ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    const key = `${opts.group}:${ip}`;
    const t = now().getTime();
    const cur = hits.get(key);
    if (!cur || t - cur.start >= opts.windowMs) hits.set(key, { start: t, count: 1 });
    else if (++cur.count > opts.max) {
      c.header('retry-after', String(Math.ceil((cur.start + opts.windowMs - t) / 1000)));
      throw new ApiError('RATE_LIMITED', 'Too many requests. Try again shortly.');
    }
    if (hits.size > 50_000) hits.clear();
    await next();
  };
}
