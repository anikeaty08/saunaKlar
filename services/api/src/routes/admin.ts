import type { Hono } from 'hono';
import { calculatePrice, type Discount } from '@saunaklar/pricing';
import { UPLOAD_LIMITS, routes, type AdminSauna, type Analytics } from '@saunaklar/shared';
import { processBrandingUpload } from '../adapters/images.ts';
import { originFor } from '../config.ts';
import type { AppEnv, Ctx, Db, TenantInfo } from '../context.ts';
import { hmac, randomToken, safeEqual } from '../lib/crypto.ts';
import { decodeCursor, pageOf } from '../lib/cursor.ts';
import { tenantTx } from '../lib/db.ts';
import { requestLocale } from '../lib/locale.ts';
import { ApiError } from '../lib/problem.ts';
import { asStaff, mount } from '../lib/route.ts';
import { assetUrl } from '../domain/catalog.ts';
import {
  createConfiguration, getConfigRow, listConfigurationSummaries, lockConfiguration, replacePlacement, replaceSelections, toConfigurationDto,
} from '../domain/configurations.ts';
import { addNote, buildAdminRequestDto, listRequestSummaries, putQuote, staffTransition } from '../domain/requests.ts';
import { hashShareToken, newShareToken, shareState } from '../domain/sharing.ts';

const STAFF = { staff: true } as const;
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const UPLOAD_TTL_SECONDS = 600;

// ---- branding ---------------------------------------------------------------

interface BrandingRow {
  display_name: string; tagline: string | null; primary_color: string; logo: string | null; favicon: string | null;
  support_email: string | null; support_phone: string | null; legal_name: string | null; legal_address: string | null;
  vat_display: 'INCLUDED' | 'EXCLUDED' | 'NONE';
}

async function loadBranding(db: Db, tenant: TenantInfo) {
  const { rows } = await db.query<BrandingRow>(
    `select b.display_name, b.tagline, b.primary_color, l.storage_key as logo, f.storage_key as favicon,
            b.support_email, b.support_phone, b.legal_name, b.legal_address, b.vat_display
       from reseller_branding b
       left join assets l on l.id = b.logo_asset_id
       left join assets f on f.id = b.favicon_asset_id
      where b.reseller_id = $1`, [tenant.id]);
  const b = rows[0];
  if (!b) {
    const { rows: r } = await db.query<{ name: string }>('select name from resellers where id = $1', [tenant.id]);
    return {
      displayName: r[0]?.name ?? tenant.slug, tagline: null, primaryColor: '#1a1a1a', logoUrl: null, faviconUrl: null,
      supportEmail: null, supportPhone: null, legalName: null, legalAddress: null, vatDisplay: 'INCLUDED' as const,
    };
  }
  return {
    displayName: b.display_name, tagline: b.tagline, primaryColor: b.primary_color.trim(), logoUrl: assetUrl(b.logo), faviconUrl: assetUrl(b.favicon),
    supportEmail: b.support_email, supportPhone: b.support_phone, legalName: b.legal_name, legalAddress: b.legal_address, vatDisplay: b.vat_display,
  };
}

/** Creates the branding row on first edit, so every later write is a plain update. */
async function ensureBranding(db: Db, tenant: TenantInfo): Promise<void> {
  await db.query(
    `insert into reseller_branding (reseller_id, display_name)
     select r.id, r.name from resellers r where r.id = $1
     on conflict (reseller_id) do nothing`, [tenant.id]);
}

/**
 * Upload ids are signed, self-contained tickets, so no table is needed for
 * half-finished uploads: the staging key, kind, declared type and expiry are
 * bound to the reseller by an HMAC.
 */
interface UploadTicket { k: string; kind: 'LOGO' | 'FAVICON'; ct: string; r: string; exp: number }

function signTicket(secret: string, t: UploadTicket): string {
  const body = Buffer.from(JSON.stringify(t)).toString('base64url');
  return `${body}.${hmac(secret, `upload:${body}`).slice(0, 32)}`;
}

function readTicket(secret: string, raw: string, resellerId: string, now: Date): UploadTicket {
  const [body, sig] = raw.split('.');
  if (!body || !sig || !safeEqual(sig, hmac(secret, `upload:${body}`).slice(0, 32))) throw new ApiError('NOT_FOUND', 'Unknown upload.');
  const t = JSON.parse(Buffer.from(body, 'base64url').toString()) as UploadTicket;
  if (t.r !== resellerId) throw new ApiError('NOT_FOUND', 'Unknown upload.');
  if (t.exp < now.getTime()) throw new ApiError('GONE', 'The upload window has closed. Start again.');
  return t;
}

// ---- saunas and discounts -----------------------------------------------------

const discountOf = (type: string | null, value: string | null): Discount | null =>
  type ? { type: type as Discount['type'], value: Number(value) } : null;

async function adminSaunas(db: Db, tenant: TenantInfo, locale: string, onlyId?: string) {
  const { rows } = await db.query<{
    id: string; slug: string; name: string; thumb: string | null; is_visible: boolean; sort_order: number;
    list_price_minor: string; max_discount_bps: number; s_type: string | null; s_value: string | null; d_type: string | null; d_value: string | null;
  }>(
    `select m.id, m.slug, coalesce(t.name, m.name) as name,
            (select a.storage_key from sauna_model_assets x join assets a on a.id = x.asset_id
              where x.sauna_model_id = m.id and x.asset_role = 'MODEL_THUMBNAIL' order by x.position limit 1) as thumb,
            rs.is_visible, rs.sort_order, p.list_price_minor, p.max_discount_bps,
            d.discount_type as s_type, d.discount_value as s_value, dd.discount_type as d_type, dd.discount_value as d_value
       from reseller_saunas rs
       join sauna_models m on m.id = rs.sauna_model_id
       join sauna_model_prices p on p.sauna_model_id = m.id and p.currency_code = $2
       left join sauna_model_translations t on t.sauna_model_id = m.id and t.locale = $3
       left join reseller_sauna_discounts d on d.reseller_id = rs.reseller_id and d.sauna_model_id = m.id
       left join reseller_default_discounts dd on dd.reseller_id = rs.reseller_id
      where rs.reseller_id = $1 and ($4::uuid is null or m.id = $4)
      order by rs.sort_order, name`,
    [tenant.id, tenant.currency, locale, onlyId ?? null]);
  const defaultDiscount = rows[0] ? discountOf(rows[0].d_type, rows[0].d_value) : await loadDefaultDiscount(db, tenant);
  const items: AdminSauna[] = rows.map(r => {
    const own = discountOf(r.s_type, r.s_value);
    // Review G5: the effective discount is what the customer actually gets, after the cap.
    const p = calculatePrice({ listPriceMinor: Number(r.list_price_minor), maxDiscountBps: r.max_discount_bps, perSaunaDiscount: own, defaultDiscount, options: [] });
    return {
      id: r.id, slug: r.slug, name: r.name, thumbnailUrl: assetUrl(r.thumb), isVisible: r.is_visible, sortOrder: r.sort_order,
      listPriceMinor: Number(r.list_price_minor), maxDiscountBps: r.max_discount_bps, discount: own,
      effectiveDiscount: p.discountMinor > 0 ? { type: 'FIXED', value: p.discountMinor } : null,
      priceFromMinor: p.finalPriceMinor,
    };
  });
  return { items, defaultDiscount };
}

async function loadDefaultDiscount(db: Db, tenant: TenantInfo): Promise<Discount | null> {
  const { rows } = await db.query<{ discount_type: string; discount_value: string }>('select discount_type, discount_value from reseller_default_discounts where reseller_id = $1', [tenant.id]);
  return rows[0] ? discountOf(rows[0].discount_type, rows[0].discount_value) : null;
}

async function oneSauna(db: Db, tenant: TenantInfo, locale: string, id: string): Promise<AdminSauna> {
  const { items } = await adminSaunas(db, tenant, locale, id);
  if (!items[0]) throw new ApiError('NOT_FOUND', 'This sauna is not assigned to you.');
  return items[0];
}

function checkDiscount(d: Discount): void {
  if (d.type === 'PERCENT' && d.value > 10_000) throw new ApiError('VALIDATION_FAILED', 'A percentage is at most 100 %.', { errors: { value: ['At most 10000 basis points.'] } });
}

// ---- share links ---------------------------------------------------------------

interface LinkRow { id: string; configuration_id: string; expires_at: Date; revoked_at: Date | null; created_at: Date; views: string; last_viewed_at: Date | null }

const LINK_SQL = `
  select s.id, s.configuration_id, s.expires_at, s.revoked_at, s.created_at,
         (select count(*) from share_link_views v where v.share_link_id = s.id) as views,
         (select max(v.viewed_at) from share_link_views v where v.share_link_id = s.id) as last_viewed_at
    from share_links s`;

const linkOf = (r: LinkRow, now: Date) => ({
  id: r.id, configurationId: r.configuration_id, expiresAt: r.expires_at.toISOString(), revokedAt: iso(r.revoked_at),
  createdAt: r.created_at.toISOString(), views: Number(r.views), lastViewedAt: iso(r.last_viewed_at), state: shareState(r, now),
});

// ---- analytics ---------------------------------------------------------------------

async function analytics(db: Db, tenant: TenantInfo, locale: string, days: number): Promise<Analytics> {
  const since = `now() - make_interval(days => $2)`;
  const [totals, byStatus, daily, top] = await Promise.all([
    db.query<{ customers: string; configurations: string; requests: string; views: string; accepted: string }>(
      `select (select count(*) from customers where reseller_id = $1 and status = 'ACTIVE' and created_at >= ${since}) as customers,
              (select count(*) from configurations where reseller_id = $1 and created_at >= ${since}) as configurations,
              (select count(*) from configuration_requests where reseller_id = $1 and created_at >= ${since}) as requests,
              (select count(*) from share_link_views where reseller_id = $1 and viewed_at >= ${since}) as views,
              (select count(*) from configuration_requests where reseller_id = $1 and status_code = 'ACCEPTED' and created_at >= ${since}) as accepted`,
      [tenant.id, days]),
    db.query<{ status_code: string; n: string }>(
      `select status_code, count(*) as n from configuration_requests where reseller_id = $1 and created_at >= ${since} group by status_code`, [tenant.id, days]),
    db.query<{ day: string; requests: string; configurations: string; views: string }>(
      // Correlated counts per day stay: each is an index(-only) range scan, and measured at
      // design scale they beat one grouped scan per table (tools/perf).
      `select to_char(d, 'YYYY-MM-DD') as day,
              (select count(*) from configuration_requests r where r.reseller_id = $1 and r.created_at >= d and r.created_at < d + interval '1 day') as requests,
              (select count(*) from configurations c where c.reseller_id = $1 and c.created_at >= d and c.created_at < d + interval '1 day') as configurations,
              (select count(*) from share_link_views v where v.reseller_id = $1 and v.viewed_at >= d and v.viewed_at < d + interval '1 day') as views
         from generate_series(date_trunc('day', now()) - make_interval(days => $2 - 1), date_trunc('day', now()), interval '1 day') as d
        order by d`, [tenant.id, days]),
    db.query<{ id: string; name: string; configurations: string; requests: string }>(
      // Configurations created in the window, and the requests on them (at most one each), counted
      // per model separately: the old configuration-to-request join was planned as a nested loop
      // over all of the reseller's requests per configuration, because RLS on
      // configuration_requests makes the planner expect a handful of rows. A request is created
      // after its configuration, so r.created_at >= since only narrows the range scan.
      `with cfg as (
         select c.sauna_model_id, count(*) as n from configurations c
          where c.reseller_id = $1 and c.created_at >= ${since} group by c.sauna_model_id),
       req as (
         select c.sauna_model_id, count(*) as n from configuration_requests r join configurations c on c.id = r.configuration_id
          where r.reseller_id = $1 and r.created_at >= ${since} and c.created_at >= ${since} group by c.sauna_model_id)
       select m.id, coalesce(t.name, m.name) as name, cfg.n as configurations, coalesce(req.n, 0) as requests
         from cfg
         join sauna_models m on m.id = cfg.sauna_model_id
         left join sauna_model_translations t on t.sauna_model_id = m.id and t.locale = $3
         left join req on req.sauna_model_id = cfg.sauna_model_id
        order by coalesce(req.n, 0) desc, cfg.n desc
        limit 10`, [tenant.id, days, locale]),
  ]);
  const t = totals.rows[0]!;
  return {
    days,
    totals: { customers: Number(t.customers), configurations: Number(t.configurations), requests: Number(t.requests), shareLinkViews: Number(t.views), acceptedRequests: Number(t.accepted) },
    requestsByStatus: Object.fromEntries(byStatus.rows.map(r => [r.status_code, Number(r.n)])),
    daily: daily.rows.map(d => ({ date: d.day, requests: Number(d.requests), configurations: Number(d.configurations), views: Number(d.views) })),
    topSaunas: top.rows.map(r => ({ saunaModelId: r.id, name: r.name, configurations: Number(r.configurations), requests: Number(r.requests) })),
  };
}

const like = (q: string) => `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;

// ---- routes -----------------------------------------------------------------------

/** Reseller admin panel API on `{slug}.<domain>/admin` (design 8.2). RLS limits everything to the tenant. */
export function registerAdmin(app: Hono<AppEnv>): void {
  const ctx = (c: Ctx) => ({ tenant: c.get('tenant')!, locale: requestLocale(c), deps: c.get('deps') });

  // branding
  mount(app, routes.adminBranding, async ({ c }) => tenantTx(c, db => loadBranding(db, c.get('tenant')!)));

  mount(app, routes.adminPatchBranding, async ({ c, body }) => {
    const { tenant } = ctx(c);
    return tenantTx(c, async db => {
      await ensureBranding(db, tenant);
      const sets: string[] = [];
      const vals: unknown[] = [tenant.id];
      const set = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
      if (body.displayName !== undefined) set('display_name', body.displayName);
      if (body.tagline !== undefined) set('tagline', body.tagline || null);
      if (body.primaryColor !== undefined) set('primary_color', body.primaryColor.toLowerCase());
      if (body.supportEmail !== undefined) set('support_email', body.supportEmail || null);
      if (body.supportPhone !== undefined) set('support_phone', body.supportPhone || null);
      if (body.legalName !== undefined) set('legal_name', body.legalName || null);
      if (body.legalAddress !== undefined) set('legal_address', body.legalAddress || null);
      if (body.vatDisplay !== undefined) set('vat_display', body.vatDisplay);
      if (sets.length) await db.query(`update reseller_branding set ${sets.join(', ')}, updated_at = now() where reseller_id = $1`, vals);
      return loadBranding(db, tenant);
    });
  });

  mount(app, routes.adminCreateUpload, async ({ c, body }) => {
    const { tenant, deps } = ctx(c);
    const limits = UPLOAD_LIMITS[body.kind];
    if (!(limits.contentTypes as readonly string[]).includes(body.contentType)) {
      throw new ApiError('VALIDATION_FAILED', `Use ${limits.contentTypes.join(', ')}.`, { errors: { contentType: ['Not an allowed image type.'] } });
    }
    if (body.byteSize > limits.maxBytes) throw new ApiError('PAYLOAD_TOO_LARGE', `At most ${limits.maxBytes / 1024 / 1024} MB.`);
    // Staging prefix: never served by the edge, so unvalidated bytes cannot reach visitors.
    const key = `uploads/${tenant.slug}/${randomToken(18)}`;
    const put = await deps.adapters.objectStore.presignPut({ key, contentType: body.contentType, byteSize: body.byteSize, ttlSeconds: UPLOAD_TTL_SECONDS });
    const uploadId = signTicket(deps.config.APP_SECRET, { k: key, kind: body.kind, ct: body.contentType, r: tenant.id, exp: put.expiresAt.getTime() + 300_000 });
    return { uploadId, url: put.url, headers: put.headers, expiresAt: put.expiresAt.toISOString() };
  });

  mount(app, routes.adminCompleteUpload, async ({ c, params }) => {
    const { tenant, deps } = ctx(c);
    const { objectStore } = deps.adapters;
    const ticket = readTicket(deps.config.APP_SECRET, params.uploadId!, tenant.id, deps.now());
    const raw = await objectStore.get(ticket.k);
    if (!raw) throw new ApiError('NOT_FOUND', 'Nothing was uploaded yet.');
    // Validates by content (magic bytes, decode, size) and re-encodes without metadata.
    const files = await processBrandingUpload(ticket.kind, raw, ticket.ct);
    const prefix = `branding/${tenant.slug}/${randomToken(12)}`;
    await Promise.all(files.map(f => objectStore.put(`${prefix}/${f.name}`, f.bytes, f.contentType, 'public, max-age=31536000, immutable')));
    await objectStore.delete(ticket.k).catch(() => undefined);
    const primaryName = ticket.kind === 'LOGO' ? 'logo.webp' : 'favicon.ico';
    return tenantTx(c, async db => {
      await ensureBranding(db, tenant);
      let primaryId: string | null = null;
      for (const f of files) {
        const { rows } = await db.query<{ id: string }>(
          `insert into assets (owner_reseller_id, storage_key, content_type, byte_size, sha256, width, height)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [tenant.id, `${prefix}/${f.name}`, f.contentType, f.bytes.byteLength, f.sha256, f.width, f.height]);
        if (f.name === primaryName) primaryId = rows[0]!.id;
      }
      const col = ticket.kind === 'LOGO' ? 'logo_asset_id' : 'favicon_asset_id';
      await db.query(`update reseller_branding set ${col} = $2, updated_at = now() where reseller_id = $1`, [tenant.id, primaryId]);
      return loadBranding(db, tenant);
    });
  });

  // settings
  mount(app, routes.adminSettings, async ({ c }) => {
    const { rows } = await tenantTx(c, db => db.query<{ d: number }>('select default_share_expiry_days as d from resellers where id = $1', [c.get('tenant')!.id]));
    return { defaultShareExpiryDays: rows[0]!.d };
  });

  mount(app, routes.adminPatchSettings, async ({ c, body }) => {
    const { rows } = await tenantTx(c, db =>
      db.query<{ d: number }>('update resellers set default_share_expiry_days = $2 where id = $1 returning default_share_expiry_days as d', [c.get('tenant')!.id, body.defaultShareExpiryDays]));
    return { defaultShareExpiryDays: rows[0]!.d };
  });

  // saunas, visibility, order, discounts (each write bumps catalog_version by trigger, rule 9)
  mount(app, routes.adminSaunas, async ({ c }) => {
    const { tenant, locale } = ctx(c);
    return tenantTx(c, db => adminSaunas(db, tenant, locale));
  });

  mount(app, routes.adminPatchSauna, async ({ c, params, body }) => {
    const { tenant, locale } = ctx(c);
    return tenantTx(c, async db => {
      const { rowCount } = await db.query(
        `update reseller_saunas set is_visible = coalesce($3, is_visible), sort_order = coalesce($4, sort_order)
          where reseller_id = $1 and sauna_model_id = $2`,
        [tenant.id, params.id, body.isVisible ?? null, body.sortOrder ?? null]);
      if (!rowCount) throw new ApiError('NOT_FOUND', 'This sauna is not assigned to you.');
      return oneSauna(db, tenant, locale, params.id!);
    });
  });

  mount(app, routes.adminSaunaOrder, async ({ c, body }) => {
    const { tenant, locale } = ctx(c);
    const ids = body.saunaModelIds;
    if (new Set(ids).size !== ids.length) throw new ApiError('VALIDATION_FAILED', 'Each sauna may appear once.');
    return tenantTx(c, async db => {
      const { rowCount } = await db.query(
        `update reseller_saunas rs set sort_order = x.ord::int * 10
           from unnest($2::uuid[]) with ordinality as x(id, ord)
          where rs.reseller_id = $1 and rs.sauna_model_id = x.id`, [tenant.id, ids]);
      if (rowCount !== ids.length) throw new ApiError('VALIDATION_FAILED', 'The list contains saunas that are not assigned to you.');
      return adminSaunas(db, tenant, locale);
    });
  });

  mount(app, routes.adminPutSaunaDiscount, async ({ c, params, body }) => {
    const { tenant, locale } = ctx(c);
    checkDiscount(body);
    return tenantTx(c, async db => {
      await oneSauna(db, tenant, locale, params.id!);
      await db.query(
        `insert into reseller_sauna_discounts (reseller_id, sauna_model_id, discount_type, discount_value) values ($1, $2, $3, $4)
         on conflict (reseller_id, sauna_model_id) do update set discount_type = excluded.discount_type, discount_value = excluded.discount_value, updated_at = now()`,
        [tenant.id, params.id, body.type, body.value]);
      return oneSauna(db, tenant, locale, params.id!);
    });
  });

  mount(app, routes.adminDeleteSaunaDiscount, async ({ c, params }) => {
    const { tenant, locale } = ctx(c);
    return tenantTx(c, async db => {
      await db.query('delete from reseller_sauna_discounts where reseller_id = $1 and sauna_model_id = $2', [tenant.id, params.id]);
      return oneSauna(db, tenant, locale, params.id!);
    });
  });

  mount(app, routes.adminPutDefaultDiscount, async ({ c, body }) => {
    const { tenant, locale } = ctx(c);
    checkDiscount(body);
    return tenantTx(c, async db => {
      await db.query(
        `insert into reseller_default_discounts (reseller_id, discount_type, discount_value) values ($1, $2, $3)
         on conflict (reseller_id) do update set discount_type = excluded.discount_type, discount_value = excluded.discount_value, updated_at = now()`,
        [tenant.id, body.type, body.value]);
      return adminSaunas(db, tenant, locale);
    });
  });

  mount(app, routes.adminDeleteDefaultDiscount, async ({ c }) => {
    const { tenant, locale } = ctx(c);
    return tenantTx(c, async db => {
      await db.query('delete from reseller_default_discounts where reseller_id = $1', [tenant.id]);
      return adminSaunas(db, tenant, locale);
    });
  });

  // configurations on behalf of customers, and share links
  mount(app, routes.adminConfigurations, async ({ c, query }) => {
    const { tenant, locale, deps } = ctx(c);
    const rows = await tenantTx(c, db => listConfigurationSummaries(db, tenant, locale, {}, decodeCursor(deps.config.APP_SECRET, query.cursor), query.limit));
    const p = pageOf(rows, query.limit, deps.config.APP_SECRET, r => ({ at: r._at, id: r.id }));
    return { items: p.items.map(({ _at, ...r }) => r), nextCursor: p.nextCursor };
  });

  mount(app, routes.adminCreateConfiguration, async ({ c, body, principal }) => {
    const me = asStaff(principal);
    const { tenant, locale } = ctx(c);
    return tenantTx(c, async db => {
      if (body.customerId) {
        const { rows } = await db.query(`select 1 from customers where id = $1 and status = 'ACTIVE'`, [body.customerId]);
        if (!rows[0]) throw new ApiError('NOT_FOUND', 'Customer not found.');
      }
      const row = await createConfiguration(db, tenant, locale, {
        saunaModelId: body.saunaModelId, name: body.name, selections: body.selections, customerId: body.customerId ?? null, staffId: me.staffId,
      });
      return toConfigurationDto(db, tenant, locale, row);
    });
  });

  mount(app, routes.adminConfiguration, async ({ c, params }) => {
    const { tenant, locale } = ctx(c);
    return tenantTx(c, async db => toConfigurationDto(db, tenant, locale, await getConfigRow(db, params.id!, STAFF)));
  });

  mount(app, routes.adminPutSelections, async ({ c, params, body }) => {
    const { tenant, locale } = ctx(c);
    return tenantTx(c, async db => {
      const row = await getConfigRow(db, params.id!, STAFF);
      await replaceSelections(db, tenant, locale, row, body.optionIds);
      return toConfigurationDto(db, tenant, locale, await getConfigRow(db, row.id, STAFF));
    });
  });

  mount(app, routes.adminPutPlacement, async ({ c, params, body }) => {
    const { tenant, locale } = ctx(c);
    return tenantTx(c, async db => {
      const row = await getConfigRow(db, params.id!, STAFF);
      await replacePlacement(db, tenant, row, body);
      await db.query('update configurations set updated_at = now() where id = $1', [row.id]);
      return toConfigurationDto(db, tenant, locale, await getConfigRow(db, row.id, STAFF));
    });
  });

  mount(app, routes.adminShareLinks, async ({ c, params }) => {
    const now = c.get('deps').now();
    const { rows } = await tenantTx(c, async db => {
      await getConfigRow(db, params.id!, STAFF);
      return db.query<LinkRow>(`${LINK_SQL} where s.configuration_id = $1 order by s.created_at desc`, [params.id]);
    });
    return { items: rows.map(r => linkOf(r, now)) };
  });

  // Sharing locks the configuration and freezes its price (design 9.3); the token is shown once.
  mount(app, routes.adminCreateShareLink, async ({ c, params, body, principal }) => {
    const me = asStaff(principal);
    const { tenant, locale, deps } = ctx(c);
    const token = newShareToken();
    const link = await tenantTx(c, async db => {
      const row = await getConfigRow(db, params.id!, STAFF);
      await lockConfiguration(db, tenant, locale, row, deps.config.SHARE_PRICE_VALID_DAYS);
      const { rows: s } = await db.query<{ d: number }>('select default_share_expiry_days as d from resellers where id = $1', [tenant.id]);
      const days = body.expiresInDays ?? s[0]!.d;
      const { rows } = await db.query<{ id: string; expires_at: Date }>(
        `insert into share_links (reseller_id, configuration_id, token_hash, created_by_staff_id, expires_at)
         values ($1, $2, $3, $4, now() + make_interval(days => $5)) returning id, expires_at`,
        [tenant.id, row.id, hashShareToken(token), me.staffId, days]);
      return rows[0]!;
    });
    c.header('Cache-Control', 'no-store');
    return { id: link.id, url: `${originFor(deps.config, c.get('host').name)}/s/${token}`, expiresAt: link.expires_at.toISOString() };
  });

  mount(app, routes.adminRevokeShareLink, async ({ c, params }) => {
    const now = c.get('deps').now();
    const row = await tenantTx(c, async db => {
      await db.query('update share_links set revoked_at = now() where id = $1 and configuration_id = $2 and revoked_at is null', [params.linkId, params.id]);
      const { rows } = await db.query<LinkRow>(`${LINK_SQL} where s.id = $1 and s.configuration_id = $2`, [params.linkId, params.id]);
      if (!rows[0]) throw new ApiError('NOT_FOUND', 'Share link not found.');
      return rows[0];
    });
    return linkOf(row, now);
  });

  // requests
  mount(app, routes.adminRequests, async ({ c, query }) => {
    const { tenant, locale, deps } = ctx(c);
    const rows = await tenantTx(c, db => listRequestSummaries(db, tenant, locale, { status: query.status, q: query.q || undefined }, decodeCursor(deps.config.APP_SECRET, query.cursor), query.limit));
    const p = pageOf(rows, query.limit, deps.config.APP_SECRET, r => ({ at: r._at, id: r.id }));
    return { items: p.items.map(({ _at, ...r }) => r), nextCursor: p.nextCursor };
  });

  mount(app, routes.adminRequest, async ({ c, params }) => {
    const { tenant, locale } = ctx(c);
    c.header('Cache-Control', 'no-store');
    return tenantTx(c, db => buildAdminRequestDto(db, tenant, locale, params.id!));
  });

  mount(app, routes.adminTransition, async ({ c, params, body }) => {
    const { tenant, locale } = ctx(c);
    return tenantTx(c, async db => {
      await staffTransition(db, params.id!, body.toStatus, body.note);
      return buildAdminRequestDto(db, tenant, locale, params.id!);
    });
  });

  mount(app, routes.adminNote, async ({ c, params, body, principal }) => {
    const me = asStaff(principal);
    const { tenant, locale } = ctx(c);
    return tenantTx(c, async db => {
      await addNote(db, tenant, params.id!, me.staffId, body.body);
      return buildAdminRequestDto(db, tenant, locale, params.id!);
    });
  });

  mount(app, routes.adminQuote, async ({ c, params, body, principal }) => {
    const me = asStaff(principal);
    const { tenant, locale, deps } = ctx(c);
    return tenantTx(c, async db => {
      await putQuote(db, tenant, params.id!, me.staffId, body, deps.now());
      return buildAdminRequestDto(db, tenant, locale, params.id!);
    });
  });

  // customers
  mount(app, routes.adminCustomers, async ({ c, query }) => {
    const { tenant, deps } = ctx(c);
    const cursor = decodeCursor(deps.config.APP_SECRET, query.cursor);
    const params: unknown[] = [tenant.id, query.limit + 1];
    const where = ['cu.reseller_id = $1'];
    if (query.q) {
      params.push(like(query.q));
      where.push(`(cu.email ilike $${params.length} or (coalesce(cu.first_name, '') || ' ' || coalesce(cu.last_name, '')) ilike $${params.length})`);
    }
    if (cursor) {
      params.push(cursor.at, cursor.id);
      where.push(`(cu.created_at, cu.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    const { rows } = await tenantTx(c, db => db.query<{ id: string; email: string; first_name: string | null; last_name: string | null; status: 'PENDING' | 'ACTIVE' | 'ANONYMISED'; created_at: Date; configurations: string; requests: string }>(
      `select cu.id, cu.email, cu.first_name, cu.last_name, cu.status, cu.created_at,
              (select count(*) from configurations x where x.customer_id = cu.id) as configurations,
              (select count(*) from configuration_requests r where r.customer_id = cu.id) as requests
         from customers cu
        where ${where.join(' and ')}
        order by cu.created_at desc, cu.id desc
        limit $2`, params));
    const p = pageOf(rows, query.limit, deps.config.APP_SECRET, r => ({ at: r.created_at.toISOString(), id: r.id }));
    return {
      items: p.items.map(r => ({
        id: r.id, email: r.email, firstName: r.first_name ?? '', lastName: r.last_name ?? '', status: r.status,
        createdAt: r.created_at.toISOString(), configurations: Number(r.configurations), requests: Number(r.requests),
      })),
      nextCursor: p.nextCursor,
    };
  });

  mount(app, routes.adminCustomer, async ({ c, params }) => {
    const { tenant, locale } = ctx(c);
    c.header('Cache-Control', 'no-store');
    return tenantTx(c, async db => {
      const { rows } = await db.query<{ id: string; email: string; first_name: string | null; last_name: string | null; phone: string | null; status: 'PENDING' | 'ACTIVE' | 'ANONYMISED'; created_at: Date; configurations: string; requests: string }>(
        `select cu.*, (select count(*) from configurations x where x.customer_id = cu.id) as configurations,
                (select count(*) from configuration_requests r where r.customer_id = cu.id) as requests
           from customers cu where cu.id = $1`, [params.id]);
      const cu = rows[0];
      if (!cu) throw new ApiError('NOT_FOUND', 'Customer not found.');
      const [addresses, configs, requests] = await Promise.all([
        db.query<{ id: string; address_type: 'BILLING' | 'SHIPPING' | 'SITE'; recipient: string; line1: string; line2: string | null; postal_code: string; city: string; region: string | null; country_code: string; is_default: boolean }>(
          'select * from customer_addresses where customer_id = $1 order by is_default desc, created_at', [cu.id]),
        listConfigurationSummaries(db, tenant, locale, { customerId: cu.id }, null, 10),
        listRequestSummaries(db, tenant, locale, { customerId: cu.id }, null, 10),
      ]);
      return {
        id: cu.id, email: cu.email, firstName: cu.first_name ?? '', lastName: cu.last_name ?? '', phone: cu.phone, status: cu.status,
        createdAt: cu.created_at.toISOString(), configurations: Number(cu.configurations), requests: Number(cu.requests),
        addresses: addresses.rows.map(a => ({
          id: a.id, addressType: a.address_type, recipient: a.recipient, line1: a.line1, line2: a.line2, postalCode: a.postal_code,
          city: a.city, region: a.region, countryCode: a.country_code.trim(), isDefault: a.is_default,
        })),
        recentConfigurations: configs.slice(0, 10).map(({ _at, ...r }) => r),
        recentRequests: requests.slice(0, 10).map(({ _at, customerName: _n, customerEmail: _e, ...r }) => r),
      };
    });
  });

  mount(app, routes.adminAnalytics, async ({ c, query }) => {
    const { tenant, locale } = ctx(c);
    c.header('Cache-Control', 'private, max-age=60');
    return tenantTx(c, db => analytics(db, tenant, locale, query.days));
  });
}
