import type { MiddlewareHandler } from 'hono';
import type { AppEnv, Ctx, Principal } from '../context.ts';
import type { Pool, Tokens } from '../adapters/types.ts';
import { IdpError } from '../adapters/errors.ts';
import { clearCookie, readCookie, writeCookie } from '../lib/cookies.ts';
import { hmac, randomToken, safeEqual } from '../lib/crypto.ts';
import { platformTx, tenantTx } from '../lib/db.ts';
import { ApiError } from '../lib/problem.ts';

const BROWSER_ID_MAX_AGE = 400 * 24 * 3600;
const REFRESH_MAX_AGE = 30 * 24 * 3600;
const POOLS: Record<string, Pool> = { CUSTOMER: 'CUSTOMER', STAFF: 'STAFF' };

/**
 * Backend-for-frontend session (design 6.1): the browser only ever holds
 * HttpOnly cookies; tokens never reach JavaScript. The access token is
 * verified on every request and mapped to a principal of THIS host's tenant.
 * Refresh is an explicit call (single-flight on the client), never implicit,
 * because concurrent implicit rotations would trip refresh-token reuse
 * detection and log the user out.
 */
export const session: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { config } = c.get('deps');
  let browserId = readCookie(c, config, 'anon');
  if (!browserId || !/^[A-Za-z0-9_-]{32,64}$/.test(browserId)) {
    browserId = randomToken(32);
    writeCookie(c, config, 'anon', browserId, BROWSER_ID_MAX_AGE);
  }
  c.set('browserId', browserId);
  c.set('principal', { kind: 'anonymous' });
  c.set('sessionExpired', false);

  const pool = POOLS[readCookie(c, config, 'pool') ?? ''];
  const accessToken = readCookie(c, config, 'at');
  if (pool && accessToken) {
    try {
      const verified = await c.get('deps').adapters.identity.verifyAccessToken(pool, accessToken);
      const principal = await loadPrincipal(c, pool, verified.sub);
      if (principal) c.set('principal', principal);
    } catch (err) {
      if (!(err instanceof IdpError)) throw err;
      c.set('sessionExpired', Boolean(readCookie(c, config, 'rt')));
    }
  }
  await next();
};

/** Maps an identity-provider subject to a principal valid on the current host, or null. */
export async function loadPrincipal(c: Ctx, pool: Pool, sub: string): Promise<Principal | null> {
  const host = c.get('host');
  if (pool === 'CUSTOMER') {
    if (host.kind !== 'storefront') return null;
    // RLS scopes this to the host's tenant: a customer of another reseller is simply not found.
    const row = await tenantTx(c, async db => (await db.query<{ id: string; email: string; first_name: string; last_name: string; locale: string }>(
      `select id, email, first_name, last_name, locale from customers where id = $1 and status = 'ACTIVE'`, [sub])).rows[0]);
    return row ? { kind: 'customer', customerId: row.id, email: row.email, firstName: row.first_name, lastName: row.last_name, locale: row.locale } : null;
  }
  if (host.kind === 'storefront') {
    const row = await tenantTx(c, async db => (await db.query<{ staff_user_id: string; email: string; display_name: string; role: 'OWNER' | 'ADMIN' }>(
      `select staff_user_id, email, display_name, role from staff_principal_for_reseller($1, $2)`, [sub, c.get('tenant')!.id])).rows[0]);
    return row ? { kind: 'staff', staffId: row.staff_user_id, email: row.email, displayName: row.display_name, scope: 'RESELLER', role: row.role, manufacturerId: null } : null;
  }
  if (host.kind === 'manufacturer') {
    const row = await platformTx(c, async db => (await db.query<{ staff_user_id: string; email: string; display_name: string; manufacturer_id: string }>(
      `select staff_user_id, email, display_name, manufacturer_id from staff_principal_for_manufacturer($1)`, [sub])).rows[0]);
    return row ? { kind: 'staff', staffId: row.staff_user_id, email: row.email, displayName: row.display_name, scope: 'MANUFACTURER', role: 'MANUFACTURER_ADMIN', manufacturerId: row.manufacturer_id } : null;
  }
  return null;
}

export function setSessionCookies(c: Ctx, pool: Pool, tokens: Tokens): void {
  const { config } = c.get('deps');
  writeCookie(c, config, 'at', tokens.accessToken, tokens.expiresIn);
  writeCookie(c, config, 'rt', tokens.refreshToken, REFRESH_MAX_AGE);
  writeCookie(c, config, 'pool', pool, REFRESH_MAX_AGE);
}

export function clearSessionCookies(c: Ctx): void {
  const { config } = c.get('deps');
  clearCookie(c, config, 'at');
  clearCookie(c, config, 'rt');
  clearCookie(c, config, 'pool');
}

export function csrfTokenFor(c: Ctx): string {
  return hmac(c.get('deps').config.APP_SECRET, `csrf:${c.get('host').name}:${c.get('browserId')}`);
}

/**
 * CSRF (review C6): every state-changing request carries `X-CSRF-Token`,
 * an HMAC of the host-bound browser id that only our own pages can read
 * (from GET /api/auth/session). Cross-site forms cannot set the header and
 * sibling subdomains cannot plant the `__Host-` cookie it is derived from.
 */
export const csrf: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const sent = c.req.header('x-csrf-token') ?? '';
    if (!safeEqual(sent, csrfTokenFor(c))) throw new ApiError('CSRF_FAILED', 'Missing or invalid CSRF token. Reload the page and try again.');
  }
  await next();
};
