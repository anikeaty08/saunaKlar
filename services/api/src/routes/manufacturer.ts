import type { Hono } from 'hono';
import { routes, storefrontHost, type ManufacturerSaunaDetail, type ResellerDetail, type ResellerSummary } from '@saunaklar/shared';
import { IdpError } from '../adapters/errors.ts';
import { originFor } from '../config.ts';
import type { AppEnv, Ctx, Db } from '../context.ts';
import { decodeCursor, pageOf } from '../lib/cursor.ts';
import { platformTx } from '../lib/db.ts';
import { requestLocale } from '../lib/locale.ts';
import { ApiError } from '../lib/problem.ts';
import { asStaff, mount } from '../lib/route.ts';
import { assetUrl } from '../domain/catalog.ts';

/**
 * Manufacturer admin on ADMIN_HOST (design 8.3). Runs as `app_platform`,
 * which has no grant on customer PII, configurations or requests: reseller
 * figures come only from the aggregate SECURITY DEFINER functions (A10).
 * Every query is scoped to the signed-in admin's manufacturer.
 */

const iso = (d: Date) => d.toISOString();

function manufacturerOf(c: Ctx): string {
  const me = asStaff(c.get('principal'));
  if (me.scope !== 'MANUFACTURER' || !me.manufacturerId) throw new ApiError('FORBIDDEN');
  return me.manufacturerId;
}

const storefrontUrl = (c: Ctx, slug: string) => {
  const { config } = c.get('deps');
  return originFor(config, storefrontHost(slug, { platformDomain: config.PLATFORM_DOMAIN, adminHost: config.ADMIN_HOST }));
};

interface ResellerRow { id: string; slug: string; name: string; currency_code: string; status: 'ACTIVE' | 'SUSPENDED'; created_at: Date; default_share_expiry_days: number; catalog_version: string }

async function getReseller(db: Db, manufacturerId: string, id: string): Promise<ResellerRow> {
  const { rows } = await db.query<ResellerRow>('select * from resellers where id = $1 and manufacturer_id = $2', [id, manufacturerId]);
  if (!rows[0]) throw new ApiError('NOT_FOUND', 'Reseller not found.');
  return rows[0];
}

async function summaries(c: Ctx, db: Db, manufacturerId: string, onlyId?: string): Promise<ResellerSummary[]> {
  const { rows } = await db.query<ResellerRow & { saunas: string; customers: string | null; requests_open: string | null }>(
    `select r.*, (select count(*) from reseller_saunas rs where rs.reseller_id = r.id) as saunas,
            st.customers, st.requests_open
       from resellers r
       left join lateral reseller_stats(r.id) st on true
      where r.manufacturer_id = $1 and ($2::uuid is null or r.id = $2)
      order by r.name, r.slug`, [manufacturerId, onlyId ?? null]);
  return rows.map(r => ({
    id: r.id, slug: r.slug, name: r.name, currency: r.currency_code.trim(), status: r.status, storefrontUrl: storefrontUrl(c, r.slug),
    saunasAssigned: Number(r.saunas), customers: Number(r.customers ?? 0), openRequests: Number(r.requests_open ?? 0), createdAt: iso(r.created_at),
  }));
}

async function detail(c: Ctx, db: Db, manufacturerId: string, id: string): Promise<ResellerDetail> {
  const r = await getReseller(db, manufacturerId, id);
  const [summary] = await summaries(c, db, manufacturerId, id);
  const [admins, rooms] = await Promise.all([
    db.query<{ id: string; email: string; display_name: string; role: 'OWNER' | 'ADMIN'; status: 'INVITED' | 'ACTIVE' | 'DISABLED' }>(
      `select s.id, s.email, s.display_name, ra.role, s.status
         from reseller_admins ra join staff_users s on s.id = ra.staff_user_id
        where ra.reseller_id = $1 order by ra.role desc, s.display_name`, [id]),
    db.query<{ id: string; code: string; name: string; assigned: boolean }>(
      `select rs.id, rs.code, rs.name, exists (select 1 from reseller_room_scenes x where x.reseller_id = $1 and x.room_scene_id = rs.id) as assigned
         from room_scenes rs where rs.manufacturer_id = $2 and rs.status = 'ACTIVE' order by rs.sort_order, rs.name`, [id, manufacturerId]),
  ]);
  return {
    ...summary!,
    defaultShareExpiryDays: r.default_share_expiry_days,
    catalogVersion: Number(r.catalog_version),
    admins: admins.rows.map(a => ({ id: a.id, email: a.email, displayName: a.display_name, role: a.role, status: a.status })),
    rooms: rooms.rows,
  };
}

interface PendingIdpUser { staffId: string; email: string; displayName: string; reseller: ResellerRow }

/**
 * Invites a reseller admin, in two steps so a rollback never leaves an IdP
 * user or a sent invitation behind: `invite` writes the staff rows inside the
 * transaction and returns the IdP work, which `provisionIdp` does after the
 * commit. If the IdP call then fails, the staff row stays without a subject
 * and inviting the same address again retries the provisioning.
 * A person who already administers another reseller is reused.
 */
async function invite(db: Db, reseller: ResellerRow, input: { email: string; displayName: string; role: 'OWNER' | 'ADMIN' }): Promise<PendingIdpUser | null> {
  const email = input.email.toLowerCase();
  const { rows: existing } = await db.query<{ id: string; status: string; idp_subject: string | null }>(
    'select id, status, idp_subject from staff_users where lower(email) = $1', [email]);
  const found = existing[0];
  if (found?.status === 'DISABLED') throw new ApiError('CONFLICT', 'This person is disabled. Re-enable them first.');
  let staffId = found?.id;
  const { rows: already } = staffId
    ? await db.query('select 1 from reseller_admins where reseller_id = $1 and staff_user_id = $2', [reseller.id, staffId])
    : { rows: [] };
  if (already.length) {
    if (found && !found.idp_subject) return { staffId: found.id, email, displayName: input.displayName, reseller };
    throw new ApiError('EMAIL_TAKEN', 'This person already administers the reseller.');
  }
  if (!staffId) {
    const { rows } = await db.query<{ id: string }>(`insert into staff_users (email, display_name) values ($1, $2) returning id`, [email, input.displayName]);
    staffId = rows[0]!.id;
  }
  await db.query('insert into reseller_admins (reseller_id, staff_user_id, role) values ($1, $2, $3)', [reseller.id, staffId, input.role]);
  return found?.idp_subject ? null : { staffId, email, displayName: input.displayName, reseller };
}

async function provisionIdp(c: Ctx, pending: PendingIdpUser | null): Promise<void> {
  if (!pending) return;
  const { reseller } = pending;
  try {
    const { sub } = await c.get('deps').adapters.identity.adminCreateUser('STAFF', {
      username: pending.email,
      email: pending.email,
      attributes: { name: pending.displayName },
      clientMetadata: { resellerId: reseller.id, brandName: reseller.name, storefrontUrl: `${storefrontUrl(c, reseller.slug)}/admin` },
    });
    await platformTx(c, db => db.query('update staff_users set idp_subject = $2 where id = $1', [pending.staffId, sub]));
  } catch (err) {
    if (err instanceof IdpError) throw new ApiError(err.code, `The account was saved but the invitation failed: ${err.message} Invite the same address again to retry.`);
    throw err;
  }
}

async function assignments(db: Db, manufacturerId: string, reseller: ResellerRow, locale: string) {
  const { rows } = await db.query<{ id: string; slug: string; name: string; status: string; assigned: boolean; is_visible: boolean | null; has_price: boolean; missing_option_prices: string }>(
    `select m.id, m.slug, coalesce(t.name, m.name) as name, m.status,
            rs.sauna_model_id is not null as assigned, rs.is_visible,
            exists (select 1 from sauna_model_prices p where p.sauna_model_id = m.id and p.currency_code = $3) as has_price,
            (select count(*) from sauna_model_options o
              where o.sauna_model_id = m.id
                and not exists (select 1 from sauna_model_option_prices op
                                 where op.sauna_model_id = m.id and op.option_id = o.option_id and op.currency_code = $3)) as missing_option_prices
       from sauna_models m
       left join sauna_model_translations t on t.sauna_model_id = m.id and t.locale = $4
       left join reseller_saunas rs on rs.sauna_model_id = m.id and rs.reseller_id = $2
      where m.manufacturer_id = $1 and (m.status = 'ACTIVE' or rs.sauna_model_id is not null)
      order by m.sort_order, name`, [manufacturerId, reseller.id, reseller.currency_code, locale]);
  const cur = reseller.currency_code.trim();
  return {
    items: rows.map(r => {
      // Mirrors the assignment trigger (rule 2, review C4) so the UI can explain a disabled toggle.
      const blockedReason = r.status !== 'ACTIVE' ? `This sauna is ${r.status.toLowerCase()}.`
        : !r.has_price ? `No ${cur} list price.`
        : Number(r.missing_option_prices) > 0 ? `${r.missing_option_prices} option(s) have no ${cur} price.`
        : null;
      return { saunaModelId: r.id, slug: r.slug, name: r.name, assigned: r.assigned, blockedReason: r.assigned ? null : blockedReason, isVisible: r.is_visible };
    }),
  };
}

async function saunaDetail(db: Db, manufacturerId: string, id: string, locale: string): Promise<ManufacturerSaunaDetail> {
  const [list] = await saunaList(db, manufacturerId, locale, id);
  if (!list) throw new ApiError('NOT_FOUND', 'Sauna not found.');
  const { rows } = await db.query<{ group_id: string; group_code: string; group_name: string; selection_type: 'SINGLE' | 'MULTI'; is_required: boolean; option_id: string; option_code: string; option_name: string; prices: { currency: string; priceDeltaMinor: number }[] | null }>(
    `select g.id as group_id, g.code as group_code, coalesce(gt.name, g.name) as group_name, g.selection_type, smg.is_required,
            o.id as option_id, o.code as option_code, coalesce(ot.name, o.name) as option_name,
            (select json_agg(json_build_object('currency', trim(op.currency_code), 'priceDeltaMinor', op.price_delta_minor) order by op.currency_code)
               from sauna_model_option_prices op where op.sauna_model_id = smo.sauna_model_id and op.option_id = o.id) as prices
       from sauna_model_option_groups smg
       join option_groups g on g.id = smg.option_group_id
       left join option_group_translations gt on gt.option_group_id = g.id and gt.locale = $2
       join sauna_model_options smo on smo.sauna_model_id = smg.sauna_model_id and smo.option_group_id = g.id
       join options o on o.id = smo.option_id
       left join option_translations ot on ot.option_id = o.id and ot.locale = $2
      where smg.sauna_model_id = $1
      order by smg.sort_order, g.sort_order, g.code, o.sort_order, o.code`, [id, locale]);
  const groups = new Map<string, ManufacturerSaunaDetail['groups'][number]>();
  for (const r of rows) {
    let g = groups.get(r.group_id);
    if (!g) groups.set(r.group_id, (g = { id: r.group_id, code: r.group_code, name: r.group_name, selectionType: r.selection_type, required: r.is_required, options: [] }));
    g.options.push({ id: r.option_id, code: r.option_code, name: r.option_name, prices: (r.prices ?? []).map(p => ({ currency: p.currency, priceDeltaMinor: Number(p.priceDeltaMinor) })) });
  }
  return { ...list, groups: [...groups.values()] };
}

async function saunaList(db: Db, manufacturerId: string, locale: string, onlyId?: string) {
  const { rows } = await db.query<{ id: string; sku: string; slug: string; name: string; status: 'DRAFT' | 'ACTIVE' | 'RETIRED'; thumb: string | null; prices: { currency: string; listPriceMinor: number; maxDiscountBps: number }[] | null; resellers: string }>(
    `select m.id, m.sku, m.slug, coalesce(t.name, m.name) as name, m.status,
            (select a.storage_key from sauna_model_assets x join assets a on a.id = x.asset_id
              where x.sauna_model_id = m.id and x.asset_role = 'MODEL_THUMBNAIL' order by x.position limit 1) as thumb,
            (select json_agg(json_build_object('currency', trim(p.currency_code), 'listPriceMinor', p.list_price_minor, 'maxDiscountBps', p.max_discount_bps) order by p.currency_code)
               from sauna_model_prices p where p.sauna_model_id = m.id) as prices,
            (select count(*) from reseller_saunas rs where rs.sauna_model_id = m.id) as resellers
       from sauna_models m
       left join sauna_model_translations t on t.sauna_model_id = m.id and t.locale = $2
      where m.manufacturer_id = $1 and ($3::uuid is null or m.id = $3)
      order by m.sort_order, name`, [manufacturerId, locale, onlyId ?? null]);
  return rows.map(r => ({
    id: r.id, sku: r.sku, slug: r.slug, name: r.name, status: r.status, thumbnailUrl: assetUrl(r.thumb),
    prices: (r.prices ?? []).map(p => ({ currency: p.currency, listPriceMinor: Number(p.listPriceMinor), maxDiscountBps: Number(p.maxDiscountBps) })),
    resellersAssigned: Number(r.resellers),
  }));
}

const CURRENCY = /^[A-Z]{3}$/;

export function registerManufacturer(app: Hono<AppEnv>): void {
  mount(app, routes.mResellers, async ({ c }) => {
    const m = manufacturerOf(c);
    return { items: await platformTx(c, db => summaries(c, db, m)) };
  });

  mount(app, routes.mCreateReseller, async ({ c, body }) => {
    const m = manufacturerOf(c);
    return platformTx(c, async db => {
      const { rows: reserved } = await db.query('select 1 from reserved_slugs where slug = $1', [body.slug]);
      if (reserved.length) throw new ApiError('SLUG_RESERVED', 'This subdomain is reserved.');
      const { rows } = await db.query<ResellerRow>(
        `insert into resellers (manufacturer_id, slug, name, currency_code) values ($1, $2, $3, $4) returning *`,
        [m, body.slug, body.name, body.currencyCode]);
      const reseller = rows[0]!;
      await db.query('insert into reseller_branding (reseller_id, display_name) values ($1, $2)', [reseller.id, body.name]);
      // Every active room of the manufacturer is offered by default; the manufacturer can narrow it later.
      await db.query(
        `insert into reseller_room_scenes (reseller_id, room_scene_id, sort_order)
         select $1, id, sort_order from room_scenes where manufacturer_id = $2 and status = 'ACTIVE'`, [reseller.id, m]);
      return { id: reseller.id, pending: await invite(db, reseller, { ...body.owner, role: 'OWNER' }) };
    }).then(async ({ id, pending }) => {
      await provisionIdp(c, pending);
      return platformTx(c, db => detail(c, db, m, id));
    });
  });

  mount(app, routes.mReseller, async ({ c, params }) => {
    const m = manufacturerOf(c);
    return platformTx(c, db => detail(c, db, m, params.id!));
  });

  mount(app, routes.mPatchReseller, async ({ c, params, body }) => {
    const m = manufacturerOf(c);
    return platformTx(c, async db => {
      await getReseller(db, m, params.id!);
      await db.query('update resellers set name = coalesce($2, name), status = coalesce($3, status), updated_at = now() where id = $1',
        [params.id, body.name ?? null, body.status ?? null]);
      // Suspension reaches the edge through the TENANT_SYNC outbox (rule 10) and the API's 60 s tenant cache.
      return detail(c, db, m, params.id!);
    });
  });

  mount(app, routes.mInviteAdmin, async ({ c, params, body }) => {
    const m = manufacturerOf(c);
    const pending = await platformTx(c, async db => invite(db, await getReseller(db, m, params.id!), body));
    await provisionIdp(c, pending);
    return platformTx(c, db => detail(c, db, m, params.id!));
  });

  mount(app, routes.mAssignments, async ({ c, params }) => {
    const m = manufacturerOf(c);
    return platformTx(c, async db => assignments(db, m, await getReseller(db, m, params.id!), requestLocale(c)));
  });

  mount(app, routes.mAssign, async ({ c, params }) => {
    const m = manufacturerOf(c);
    return platformTx(c, async db => {
      const reseller = await getReseller(db, m, params.id!);
      const { rows: model } = await db.query('select 1 from sauna_models where id = $1 and manufacturer_id = $2', [params.saunaId, m]);
      if (!model.length) throw new ApiError('NOT_FOUND', 'Sauna not found.');
      // The trigger refuses a model without prices in the reseller currency (SAUNA_NOT_ASSIGNABLE).
      await db.query(
        `insert into reseller_saunas (reseller_id, sauna_model_id, sort_order)
         values ($1, $2, coalesce((select max(sort_order) + 10 from reseller_saunas where reseller_id = $1), 0))
         on conflict do nothing`, [reseller.id, params.saunaId]);
      return assignments(db, m, reseller, requestLocale(c));
    });
  });

  mount(app, routes.mUnassign, async ({ c, params }) => {
    const m = manufacturerOf(c);
    return platformTx(c, async db => {
      const reseller = await getReseller(db, m, params.id!);
      // Configurations reference the assignment (app_platform cannot read them, the FK tells us):
      // once any exist, the sauna can only be hidden by the reseller.
      await db.query('delete from reseller_saunas where reseller_id = $1 and sauna_model_id = $2', [reseller.id, params.saunaId]).catch((err: { code?: string }) => {
        if (err.code === '23503') throw new ApiError('CONFLICT', 'Customers have configured this sauna. Ask the reseller to hide it instead.');
        throw err;
      });
      return assignments(db, m, reseller, requestLocale(c));
    });
  });

  mount(app, routes.mPutRooms, async ({ c, params, body }) => {
    const m = manufacturerOf(c);
    const ids = [...new Set(body.roomSceneIds)];
    return platformTx(c, async db => {
      const reseller = await getReseller(db, m, params.id!);
      const { rows } = await db.query<{ id: string }>(`select id from room_scenes where id = any($1::uuid[]) and manufacturer_id = $2 and status = 'ACTIVE'`, [ids, m]);
      if (rows.length !== ids.length) throw new ApiError('VALIDATION_FAILED', 'Unknown or inactive room in the list.');
      await db.query('delete from reseller_room_scenes where reseller_id = $1 and not (room_scene_id = any($2::uuid[]))', [reseller.id, ids]);
      await db.query(
        `insert into reseller_room_scenes (reseller_id, room_scene_id, sort_order)
         select $1, x.id, (x.ord::int - 1) * 10 from unnest($2::uuid[]) with ordinality as x(id, ord)
         on conflict (reseller_id, room_scene_id) do update set sort_order = excluded.sort_order`, [reseller.id, ids]);
      return detail(c, db, m, reseller.id);
    });
  });

  mount(app, routes.mSaunas, async ({ c }) => {
    const m = manufacturerOf(c);
    return { items: await platformTx(c, db => saunaList(db, m, requestLocale(c))) };
  });

  mount(app, routes.mSauna, async ({ c, params }) => {
    const m = manufacturerOf(c);
    return platformTx(c, db => saunaDetail(db, m, params.id!, requestLocale(c)));
  });

  mount(app, routes.mPutPrice, async ({ c, params, body }) => {
    const m = manufacturerOf(c);
    const currency = params.currency!.toUpperCase();
    if (!CURRENCY.test(currency)) throw new ApiError('VALIDATION_FAILED', 'Unknown currency.');
    return platformTx(c, async db => {
      await saunaDetail(db, m, params.id!, 'en');
      // Changing a price bumps catalog_version for every reseller that offers the model (rule 9).
      await db.query(
        `insert into sauna_model_prices (sauna_model_id, currency_code, list_price_minor, max_discount_bps) values ($1, $2, $3, $4)
         on conflict (sauna_model_id, currency_code) do update set list_price_minor = excluded.list_price_minor,
           max_discount_bps = excluded.max_discount_bps, updated_at = now()`,
        [params.id, currency, body.listPriceMinor, body.maxDiscountBps]);
      return saunaDetail(db, m, params.id!, requestLocale(c));
    });
  });

  mount(app, routes.mPutOptionPrice, async ({ c, params, body }) => {
    const m = manufacturerOf(c);
    const currency = params.currency!.toUpperCase();
    if (!CURRENCY.test(currency)) throw new ApiError('VALIDATION_FAILED', 'Unknown currency.');
    return platformTx(c, async db => {
      await saunaDetail(db, m, params.id!, 'en');
      const { rowCount } = await db.query(
        `insert into sauna_model_option_prices (sauna_model_id, option_id, currency_code, price_delta_minor)
         select $1, $2, $3, $4 where exists (select 1 from sauna_model_options where sauna_model_id = $1 and option_id = $2)
         on conflict (sauna_model_id, option_id, currency_code) do update set price_delta_minor = excluded.price_delta_minor, updated_at = now()`,
        [params.id, params.optionId, currency, body.priceDeltaMinor]);
      if (!rowCount) throw new ApiError('NOT_FOUND', 'This option is not part of the sauna.');
      return saunaDetail(db, m, params.id!, requestLocale(c));
    });
  });

  mount(app, routes.mAnalytics, async ({ c, query }) => {
    const m = manufacturerOf(c);
    c.header('Cache-Control', 'private, max-age=60');
    const { rows } = await platformTx(c, db => db.query<{ id: string; name: string; slug: string; customers: string; configurations: string; requests: string; requests_accepted: string; share_link_views: string }>(
      `select r.id, r.name, r.slug, st.customers, st.configurations, st.requests, st.requests_accepted, st.share_link_views
         from resellers r cross join lateral reseller_stats(r.id, now() - make_interval(days => $2)) st
        where r.manufacturer_id = $1 order by st.requests desc, r.name`, [m, query.days]));
    return {
      days: query.days,
      resellers: rows.map(r => ({
        resellerId: r.id, name: r.name, slug: r.slug, customers: Number(r.customers), configurations: Number(r.configurations),
        requests: Number(r.requests), acceptedRequests: Number(r.requests_accepted), shareLinkViews: Number(r.share_link_views),
      })),
    };
  });

  mount(app, routes.mAudit, async ({ c, query }) => {
    const m = manufacturerOf(c);
    const { config } = c.get('deps');
    const cursor = decodeCursor(config.APP_SECRET, query.cursor);
    const params: unknown[] = [m, query.limit + 1];
    // Rows without a reseller (catalog prices) belong to the manufacturer of their sauna model;
    // other manufacturers' catalog changes stay invisible.
    const where = [`(a.reseller_id in (select id from resellers where manufacturer_id = $1)
      or (a.reseller_id is null and coalesce(a.details->'new'->>'sauna_model_id', a.details->'old'->>'sauna_model_id')::uuid
            in (select id from sauna_models where manufacturer_id = $1)))`];
    if (query.resellerId) { params.push(query.resellerId); where.push(`a.reseller_id = $${params.length}`); }
    if (query.entityType) { params.push(query.entityType); where.push(`a.entity_type = $${params.length}`); }
    if (cursor) { params.push(cursor.id); where.push(`a.id < $${params.length}::bigint`); }
    const { rows } = await platformTx(c, db => db.query<{ id: string; occurred_at: Date; action: string; entity_type: string; entity_id: string; reseller_id: string | null; actor: string | null; details: Record<string, unknown> }>(
      `select a.id, a.occurred_at, a.action, a.entity_type, a.entity_id, a.reseller_id, s.display_name as actor, a.details
         from audit_events a left join staff_users s on s.id = a.actor_staff_id
        where ${where.join(' and ')}
        order by a.id desc limit $2`, params));
    const p = pageOf(rows, query.limit, config.APP_SECRET, r => ({ at: iso(r.occurred_at), id: String(r.id) }));
    return {
      items: p.items.map(r => ({
        id: String(r.id), occurredAt: iso(r.occurred_at), action: r.action, entityType: r.entity_type, entityId: r.entity_id,
        resellerId: r.reseller_id, actorName: r.actor, details: r.details,
      })),
      nextCursor: p.nextCursor,
    };
  });
}
