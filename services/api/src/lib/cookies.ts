import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Config } from '../config.ts';

/**
 * Session cookies (review C6): `__Host-` prefixed, so they are bound to the
 * exact host, Secure, Path=/ and cannot be set by a sibling subdomain.
 * Without COOKIE_SECURE (plain http in some test setups) the prefix is
 * dropped, since browsers reject `__Host-` cookies that are not Secure.
 */
export type CookieKey = 'at' | 'rt' | 'pool' | 'anon';

export function cookieName(cfg: Config, key: CookieKey): string {
  return cfg.COOKIE_SECURE ? `__Host-sk_${key}` : `sk_${key}`;
}

export function readCookie(c: Context, cfg: Config, key: CookieKey): string | undefined {
  return getCookie(c, cookieName(cfg, key));
}

export function writeCookie(c: Context, cfg: Config, key: CookieKey, value: string, maxAgeSeconds: number): void {
  setCookie(c, cookieName(cfg, key), value, {
    path: '/',
    httpOnly: true,
    secure: cfg.COOKIE_SECURE,
    sameSite: 'Lax',
    maxAge: maxAgeSeconds,
  });
}

export function clearCookie(c: Context, cfg: Config, key: CookieKey): void {
  deleteCookie(c, cookieName(cfg, key), { path: '/', secure: cfg.COOKIE_SECURE });
}
