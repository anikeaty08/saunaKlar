import type { Hono } from 'hono';
import { routes, type Session } from '@saunaklar/shared';
import type { ClientMetadata } from '../adapters/types.ts';
import { IdpError } from '../adapters/errors.ts';
import { originFor } from '../config.ts';
import type { AppEnv, Ctx, Db, Principal } from '../context.ts';
import { readCookie } from '../lib/cookies.ts';
import { tenantTx } from '../lib/db.ts';
import { ApiError } from '../lib/problem.ts';
import { mount } from '../lib/route.ts';
import { clearSessionCookies, csrfTokenFor, loadPrincipal, setSessionCookies } from '../middleware/session.ts';
import { templates } from '../adapters/mail/templates.ts';

/** Versions of the legal texts a customer accepts at sign-up (bump when the texts change). */
export const CONSENT_VERSIONS = { TERMS: '2026-10', PRIVACY: '2026-10', MARKETING: '2026-10' } as const;
const PENDING_REPLACE_AFTER_MS = 24 * 3600 * 1000;

interface CustomerRow { id: string; status: 'PENDING' | 'ACTIVE'; created_at: Date }

export function sessionBody(c: Ctx, principal: Principal = c.get('principal')): Session {
  const csrfToken = csrfTokenFor(c);
  if (principal.kind === 'customer') {
    return { kind: 'customer', csrfToken, customer: { id: principal.customerId, email: principal.email, firstName: principal.firstName, lastName: principal.lastName, locale: principal.locale } };
  }
  if (principal.kind === 'staff') {
    return { kind: 'staff', csrfToken, staff: { id: principal.staffId, email: principal.email, displayName: principal.displayName, scope: principal.scope, role: principal.role } };
  }
  return { kind: 'anonymous', csrfToken };
}

/** Reseller branding passed to the IdP for branded verification and reset mails. */
export async function clientMetadata(c: Ctx, db: Db, locale?: string): Promise<ClientMetadata> {
  const tenant = c.get('tenant')!;
  const { rows } = await db.query<{ display_name: string; primary_color: string; support_email: string | null }>(
    'select display_name, primary_color, support_email from reseller_branding where reseller_id = $1', [tenant.id]);
  const b = rows[0];
  return {
    resellerId: tenant.id,
    brandName: b?.display_name ?? tenant.slug,
    ...(b?.primary_color ? { primaryColor: b.primary_color } : {}),
    ...(b?.support_email ? { supportEmail: b.support_email } : {}),
    storefrontUrl: originFor(c.get('deps').config, c.get('host').name),
    ...(locale ? { locale } : {}),
  };
}

async function findCustomer(db: Db, email: string): Promise<CustomerRow | undefined> {
  const { rows } = await db.query<CustomerRow>(
    `select id, status, created_at from customers where lower(email) = lower($1) and status in ('PENDING', 'ACTIVE')`, [email]);
  return rows[0];
}

/** Deletes a local IdP user; in AWS the Cognito user is removed the same way through the adapter. */
async function deleteIdpUser(c: Ctx, username: string): Promise<void> {
  try {
    await c.get('deps').adapters.identity.adminDeleteUser('CUSTOMER', username);
  } catch (err) {
    if (!(err instanceof IdpError)) throw err;
  }
}

export function registerAuth(app: Hono<AppEnv>): void {
  mount(app, routes.session, async ({ c }) => sessionBody(c));

  mount(app, routes.signup, async ({ c, body }) => {
    const { identity, mailer } = c.get('deps').adapters;
    const outcome = await tenantTx(c, async db => {
      const meta = await clientMetadata(c, db, body.locale);
      const existing = await findCustomer(db, body.email);
      if (existing?.status === 'ACTIVE') return { kind: 'exists' as const, meta };
      if (existing) {
        // Review G3: a stale unverified sign-up must not block the address forever.
        if (c.get('deps').now().getTime() - existing.created_at.getTime() < PENDING_REPLACE_AFTER_MS) {
          return { kind: 'pending' as const, meta, id: existing.id };
        }
        await db.query('delete from customers where id = $1', [existing.id]);
        await deleteIdpUser(c, existing.id);
      }
      const { rows } = await db.query<{ id: string }>(
        `insert into customers (reseller_id, email, first_name, last_name, phone, locale, status)
         values ($1, $2, $3, $4, $5, $6, 'PENDING') returning id`,
        [c.get('tenant')!.id, body.email, body.firstName, body.lastName, body.phone ?? null, body.locale]);
      const id = rows[0]!.id;
      const consents: [string, string][] = [['TERMS', CONSENT_VERSIONS.TERMS], ['PRIVACY', CONSENT_VERSIONS.PRIVACY]];
      if (body.consents.marketing) consents.push(['MARKETING', CONSENT_VERSIONS.MARKETING]);
      for (const [type, version] of consents) {
        await db.query(
          `insert into customer_consents (customer_id, reseller_id, consent_type, version, granted_at) values ($1, $2, $3, $4, now())`,
          [id, c.get('tenant')!.id, type, version]);
      }
      // Username is the customer id, not the e-mail: the same e-mail may exist at
      // another reseller (design 6.1). If the IdP rejects, the transaction rolls back.
      await identity.signUp({ pool: 'CUSTOMER', username: id, email: body.email, password: body.password, attributes: { reseller_id: c.get('tenant')!.id }, clientMetadata: meta });
      return { kind: 'created' as const, meta, id };
    });
    if (outcome.kind === 'exists') {
      // Anti-enumeration: same response, but the owner learns someone tried.
      const m = outcome.meta;
      const mail = templates.accountExists(m, { firstName: body.firstName, loginUrl: `${m.storefrontUrl}/account/login`, resetUrl: `${m.storefrontUrl}/account/forgot` }, body.locale);
      await mailer.send({ to: body.email, ...mail, resellerId: m.resellerId!, fromName: m.brandName, ...(m.supportEmail ? { replyTo: m.supportEmail } : {}) });
    } else if (outcome.kind === 'pending') {
      await identity.resendConfirmationCode('CUSTOMER', outcome.id, outcome.meta);
    }
    return { accepted: true as const };
  });

  mount(app, routes.resendCode, async ({ c, body }) => {
    const found = await tenantTx(c, async db => ({ customer: await findCustomer(db, body.email), meta: await clientMetadata(c, db) }));
    if (found.customer?.status === 'PENDING') await c.get('deps').adapters.identity.resendConfirmationCode('CUSTOMER', found.customer.id, found.meta);
    return { accepted: true as const };
  });

  mount(app, routes.confirm, async ({ c, body }) => {
    const customer = await tenantTx(c, db => findCustomer(db, body.email));
    if (!customer) throw new ApiError('CODE_INVALID');
    if (customer.status === 'PENDING') {
      await c.get('deps').adapters.identity.confirmSignUp('CUSTOMER', customer.id, body.code);
      await tenantTx(c, db => db.query(`update customers set status = 'ACTIVE', email_verified_at = now() where id = $1 and status = 'PENDING'`, [customer.id]));
    }
    return sessionBody(c);
  });

  mount(app, routes.login, async ({ c, body }) => {
    const { identity } = c.get('deps').adapters;
    const customer = await tenantTx(c, db => findCustomer(db, body.email));
    // Unknown e-mail: still run a password check against a throwaway username
    // so response time does not reveal whether the account exists.
    const username = customer?.id ?? '00000000-0000-4000-8000-000000000000';
    const result = await identity.initiateAuth('CUSTOMER', username, body.password);
    if (!customer) throw new ApiError('INVALID_CREDENTIALS');
    if (result.kind !== 'TOKENS') throw new ApiError('INVALID_CREDENTIALS');
    if (customer.status === 'PENDING') throw new ApiError('EMAIL_NOT_VERIFIED');
    const principal = await loadPrincipal(c, 'CUSTOMER', customer.id);
    if (!principal) throw new ApiError('INVALID_CREDENTIALS');
    setSessionCookies(c, 'CUSTOMER', result.tokens);
    c.set('principal', principal);
    return sessionBody(c, principal);
  });

  mount(app, routes.forgotPassword, async ({ c, body }) => {
    const found = await tenantTx(c, async db => ({ customer: await findCustomer(db, body.email), meta: await clientMetadata(c, db) }));
    if (found.customer?.status === 'ACTIVE') await c.get('deps').adapters.identity.forgotPassword('CUSTOMER', found.customer.id, found.meta);
    return { accepted: true as const };
  });

  mount(app, routes.resetPassword, async ({ c, body }) => {
    const customer = await tenantTx(c, db => findCustomer(db, body.email));
    if (!customer || customer.status !== 'ACTIVE') throw new ApiError('CODE_INVALID');
    await c.get('deps').adapters.identity.confirmForgotPassword('CUSTOMER', customer.id, body.code, body.newPassword);
    return { ok: true as const };
  });

  mount(app, routes.logout, async ({ c }) => {
    const { config, adapters } = c.get('deps');
    const rt = readCookie(c, config, 'rt');
    const pool = readCookie(c, config, 'pool');
    if (rt && (pool === 'CUSTOMER' || pool === 'STAFF')) {
      await adapters.identity.revoke(pool, rt).catch(() => undefined);
    }
    clearSessionCookies(c);
    return { ok: true as const };
  });

  mount(app, routes.refresh, async ({ c }) => {
    const { config, adapters } = c.get('deps');
    const rt = readCookie(c, config, 'rt');
    const pool = readCookie(c, config, 'pool');
    if (!rt || (pool !== 'CUSTOMER' && pool !== 'STAFF')) throw new ApiError('UNAUTHENTICATED');
    try {
      const tokens = await adapters.identity.refresh(pool, rt);
      const { sub } = await adapters.identity.verifyAccessToken(pool, tokens.accessToken);
      const principal = await loadPrincipal(c, pool, sub);
      if (!principal) throw new ApiError('UNAUTHENTICATED');
      setSessionCookies(c, pool, tokens);
      c.set('principal', principal);
      return sessionBody(c, principal);
    } catch (err) {
      clearSessionCookies(c);
      if (err instanceof IdpError) throw new ApiError('SESSION_EXPIRED');
      throw err;
    }
  });

}
