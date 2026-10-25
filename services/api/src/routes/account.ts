import type { Hono } from 'hono';
import { routes, type Address, type Profile } from '@saunaklar/shared';
import { IdpError } from '../adapters/errors.ts';
import type { AppEnv, Db } from '../context.ts';
import { readCookie } from '../lib/cookies.ts';
import { tenantTx } from '../lib/db.ts';
import { requestLocale } from '../lib/locale.ts';
import { ApiError } from '../lib/problem.ts';
import { asCustomer, mount } from '../lib/route.ts';
import { clearSessionCookies } from '../middleware/session.ts';
import { listConfigurationSummaries } from '../domain/configurations.ts';
import { listRequestSummaries } from '../domain/requests.ts';
import { CONSENT_VERSIONS } from './auth.ts';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

interface CustomerRow { id: string; email: string; first_name: string | null; last_name: string | null; phone: string | null; locale: string; email_verified_at: Date | null; created_at: Date }
interface AddressRow { id: string; address_type: Address['addressType']; recipient: string; line1: string; line2: string | null; postal_code: string; city: string; region: string | null; country_code: string; is_default: boolean }

const profileOf = (r: CustomerRow): Profile => ({
  id: r.id, email: r.email, firstName: r.first_name ?? '', lastName: r.last_name ?? '', phone: r.phone, locale: r.locale,
  emailVerifiedAt: iso(r.email_verified_at), createdAt: r.created_at.toISOString(),
});

const addressOf = (r: AddressRow): Address => ({
  id: r.id, addressType: r.address_type, recipient: r.recipient, line1: r.line1, line2: r.line2, postalCode: r.postal_code,
  city: r.city, region: r.region, countryCode: r.country_code.trim(), isDefault: r.is_default,
});

async function profile(db: Db, id: string): Promise<CustomerRow> {
  const { rows } = await db.query<CustomerRow>(`select * from customers where id = $1 and status = 'ACTIVE'`, [id]);
  if (!rows[0]) throw new ApiError('UNAUTHENTICATED');
  return rows[0];
}

async function consents(db: Db, id: string) {
  const { rows } = await db.query<{ consent_type: 'TERMS' | 'PRIVACY' | 'MARKETING'; version: string; granted_at: Date; withdrawn_at: Date | null }>(
    'select consent_type, version, granted_at, withdrawn_at from customer_consents where customer_id = $1 order by granted_at desc', [id]);
  return { items: rows.map(r => ({ type: r.consent_type, version: r.version, grantedAt: r.granted_at.toISOString(), withdrawnAt: iso(r.withdrawn_at) })) };
}

/** Only one default address per type: clearing the old default first keeps the partial unique index happy. */
async function clearDefault(db: Db, customerId: string, type: string, exceptId?: string): Promise<void> {
  await db.query('update customer_addresses set is_default = false, updated_at = now() where customer_id = $1 and address_type = $2 and is_default and id is distinct from $3',
    [customerId, type, exceptId ?? null]);
}

/** Customer self-service: profile, addresses, consents, data export and erasure (design 15.3). */
export function registerAccount(app: Hono<AppEnv>): void {
  mount(app, routes.me, async ({ c, principal }) => {
    const me = asCustomer(principal);
    c.header('Cache-Control', 'no-store');
    return profileOf(await tenantTx(c, db => profile(db, me.customerId)));
  });

  mount(app, routes.patchMe, async ({ c, body, principal }) => {
    const me = asCustomer(principal);
    return profileOf(await tenantTx(c, async db => {
      await profile(db, me.customerId);
      const { rows } = await db.query<CustomerRow>(
        `update customers set first_name = coalesce($2, first_name), last_name = coalesce($3, last_name),
                phone = case when $4::boolean then $5 else phone end, locale = coalesce($6, locale), updated_at = now()
          where id = $1 returning *`,
        [me.customerId, body.firstName ?? null, body.lastName ?? null, body.phone !== undefined, body.phone || null, body.locale ?? null]);
      return rows[0]!;
    }));
  });

  mount(app, routes.exportMe, async ({ c, principal, tenant }) => {
    const me = asCustomer(principal);
    const locale = requestLocale(c);
    const data = await tenantTx(c, async db => {
      const [p, addresses, cons, configs, requests, links] = await Promise.all([
        profile(db, me.customerId),
        db.query<AddressRow>('select * from customer_addresses where customer_id = $1 order by created_at', [me.customerId]),
        consents(db, me.customerId),
        listConfigurationSummaries(db, tenant!, locale, { customerId: me.customerId }, null, 10_000),
        listRequestSummaries(db, tenant!, locale, { customerId: me.customerId }, null, 10_000),
        db.query<{ id: string; configuration_id: string; expires_at: Date; revoked_at: Date | null; created_at: Date }>(
          'select id, configuration_id, expires_at, revoked_at, created_at from share_links where created_by_customer_id = $1 order by created_at', [me.customerId]),
      ]);
      return {
        exportedAt: c.get('deps').now().toISOString(),
        profile: profileOf(p),
        addresses: addresses.rows.map(addressOf),
        consents: cons.items,
        configurations: configs.map(({ _at, ...r }) => r),
        requests: requests.map(({ _at, customerName: _n, customerEmail: _e, ...r }) => r),
        shareLinks: links.rows.map(l => ({ id: l.id, configurationId: l.configuration_id, expiresAt: l.expires_at.toISOString(), revokedAt: iso(l.revoked_at), createdAt: l.created_at.toISOString() })),
      };
    });
    c.header('Cache-Control', 'no-store');
    c.header('Content-Disposition', `attachment; filename="my-data-${c.get('deps').now().toISOString().slice(0, 10)}.json"`);
    return data;
  });

  mount(app, routes.deleteMe, async ({ c, body, principal }) => {
    const me = asCustomer(principal);
    const { identity } = c.get('deps').adapters;
    // Re-authentication: erasure cannot be triggered by a stolen session cookie alone.
    try {
      const result = await identity.initiateAuth('CUSTOMER', me.customerId, body.password);
      if (result.kind !== 'TOKENS') throw new ApiError('INVALID_CREDENTIALS');
      await identity.revoke('CUSTOMER', result.tokens.refreshToken).catch(() => undefined);
    } catch (err) {
      if (err instanceof IdpError) throw new ApiError('INVALID_CREDENTIALS');
      throw err;
    }
    await tenantTx(c, async db => {
      // Open requests are cancelled by the customer so the reseller sees why they stopped.
      const open = await db.query<{ id: string }>(`select id from configuration_requests where customer_id = $1 and status_code in ('SUBMITTED', 'IN_REVIEW', 'QUOTED')`, [me.customerId]);
      for (const r of open.rows) {
        await db.query(`select set_config('app.status_note', 'Account deleted by the customer.', true)`);
        await db.query(`update configuration_requests set status_code = 'CANCELLED' where id = $1`, [r.id]);
      }
      // Drafts carry no business record; locked configurations stay (anonymously) behind requests and links.
      const drafts = await db.query<{ id: string }>('select id from configurations where customer_id = $1 and locked_at is null', [me.customerId]);
      const ids = drafts.rows.map(r => r.id);
      if (ids.length) {
        await db.query('delete from configuration_room_placements where configuration_id = any($1::uuid[])', [ids]);
        await db.query('delete from configuration_selections where configuration_id = any($1::uuid[])', [ids]);
        await db.query('delete from configurations where id = any($1::uuid[])', [ids]);
      }
      await db.query('update customer_consents set withdrawn_at = now() where customer_id = $1 and withdrawn_at is null', [me.customerId]);
      await db.query('select anonymise_customer($1)', [me.customerId]);
    });
    const { config } = c.get('deps');
    const rt = readCookie(c, config, 'rt');
    if (rt) await identity.revoke('CUSTOMER', rt).catch(() => undefined);
    await identity.adminDeleteUser('CUSTOMER', me.customerId).catch(err => {
      if (!(err instanceof IdpError)) throw err;
    });
    clearSessionCookies(c);
    return { ok: true as const };
  });

  mount(app, routes.addresses, async ({ c, principal }) => {
    const me = asCustomer(principal);
    const { rows } = await tenantTx(c, db => db.query<AddressRow>('select * from customer_addresses where customer_id = $1 order by is_default desc, created_at', [me.customerId]));
    return { items: rows.map(addressOf) };
  });

  mount(app, routes.createAddress, async ({ c, body, principal, tenant }) => {
    const me = asCustomer(principal);
    return addressOf(await tenantTx(c, async db => {
      const { rows: count } = await db.query<{ n: string }>('select count(*) as n from customer_addresses where customer_id = $1', [me.customerId]);
      if (Number(count[0]!.n) >= 20) throw new ApiError('VALIDATION_FAILED', 'You can save up to 20 addresses.');
      if (body.isDefault) await clearDefault(db, me.customerId, body.addressType);
      const { rows } = await db.query<AddressRow>(
        `insert into customer_addresses (customer_id, reseller_id, address_type, recipient, line1, line2, postal_code, city, region, country_code, is_default)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
        [me.customerId, tenant!.id, body.addressType, body.recipient, body.line1, body.line2 || null, body.postalCode, body.city, body.region || null, body.countryCode, body.isDefault]);
      return rows[0]!;
    }));
  });

  mount(app, routes.updateAddress, async ({ c, params, body, principal }) => {
    const me = asCustomer(principal);
    return addressOf(await tenantTx(c, async db => {
      const { rows: found } = await db.query<AddressRow>('select * from customer_addresses where id = $1 and customer_id = $2 for update', [params.id, me.customerId]);
      const cur = found[0];
      if (!cur) throw new ApiError('NOT_FOUND', 'Address not found.');
      const next = {
        addressType: body.addressType ?? cur.address_type,
        recipient: body.recipient ?? cur.recipient,
        line1: body.line1 ?? cur.line1,
        line2: body.line2 !== undefined ? body.line2 || null : cur.line2,
        postalCode: body.postalCode ?? cur.postal_code,
        city: body.city ?? cur.city,
        region: body.region !== undefined ? body.region || null : cur.region,
        countryCode: body.countryCode ?? cur.country_code,
        isDefault: body.isDefault ?? cur.is_default,
      };
      if (next.isDefault) await clearDefault(db, me.customerId, next.addressType, cur.id);
      const { rows } = await db.query<AddressRow>(
        `update customer_addresses set address_type = $2, recipient = $3, line1 = $4, line2 = $5, postal_code = $6, city = $7,
                region = $8, country_code = $9, is_default = $10, updated_at = now()
          where id = $1 returning *`,
        [cur.id, next.addressType, next.recipient, next.line1, next.line2, next.postalCode, next.city, next.region, next.countryCode, next.isDefault]);
      return rows[0]!;
    }));
  });

  mount(app, routes.deleteAddress, async ({ c, params, principal }) => {
    const me = asCustomer(principal);
    const { rowCount } = await tenantTx(c, db => db.query('delete from customer_addresses where id = $1 and customer_id = $2', [params.id, me.customerId]));
    if (!rowCount) throw new ApiError('NOT_FOUND', 'Address not found.');
    return { ok: true as const };
  });

  mount(app, routes.consents, async ({ c, principal }) => {
    const me = asCustomer(principal);
    return tenantTx(c, db => consents(db, me.customerId));
  });

  mount(app, routes.putConsents, async ({ c, body, principal, tenant }) => {
    const me = asCustomer(principal);
    return tenantTx(c, async db => {
      const { rows } = await db.query<{ granted_at: Date }>(
        `select granted_at from customer_consents where customer_id = $1 and consent_type = 'MARKETING' and withdrawn_at is null for update`, [me.customerId]);
      const active = rows.length > 0;
      if (body.marketing && !active) {
        await db.query(`insert into customer_consents (customer_id, reseller_id, consent_type, version) values ($1, $2, 'MARKETING', $3)`,
          [me.customerId, tenant!.id, CONSENT_VERSIONS.MARKETING]);
      } else if (!body.marketing && active) {
        await db.query(`update customer_consents set withdrawn_at = now() where customer_id = $1 and consent_type = 'MARKETING' and withdrawn_at is null`, [me.customerId]);
      }
      return consents(db, me.customerId);
    });
  });
}
