/**
 * The API's hot queries, verbatim from services/api/src (keep in sync when the code changes),
 * with the role and tenant settings the API runs them under.
 */
import type pg from 'pg';

export interface PerfContext {
  alphaId: string;
  alphaCurrency: string;
  manufacturerId: string;
  /** Alpha customer with the most configurations. */
  customerId: string;
  /** (updated_at, id) of alpha's 5000th configuration, newest first. */
  configCursor: [string, string];
  /** (created_at, id) of alpha's 5000th request. */
  requestCursor: [string, string];
  /** (created_at, id) of alpha's 10000th customer. */
  customerCursor: [string, string];
  /** Alpha configuration that has share links. */
  sharedConfigurationId: string;
  /** E-mail of an alpha customer (login lookup). */
  loginEmail: string;
  /** A fragment that matches exactly one alpha customer. */
  rareTerm: string;
}

export interface PerfQuery {
  name: string;
  role: 'app_tenant' | 'app_platform';
  /** Sets app.actor_customer_id (customer-facing routes). */
  asCustomer?: boolean;
  sql: string;
  params: (ctx: PerfContext) => unknown[];
}

const like = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

// services/api/src/domain/configurations.ts listConfigurationSummaries
const CONFIG_LIST = (extra: string) => `
  with page as materialized (
    select c.id, c.name, c.locked_at, c.customer_id, c.created_at, c.updated_at, c.sauna_model_id
      from configurations c
      join sauna_models m on m.id = c.sauna_model_id
     where c.reseller_id = $1 ${extra}
     order by c.updated_at desc, c.id desc
     limit $3)
  select p.id, p.name, p.locked_at, p.customer_id, p.created_at, p.updated_at,
         m.id as model_id, m.slug, coalesce(t.name, m.name) as model_name,
         th.storage_key as thumb,
         s.final_price_minor, r.id as request_id, r.status_code
    from page p
    join sauna_models m on m.id = p.sauna_model_id
    left join sauna_model_translations t on t.sauna_model_id = m.id and t.locale = $2
    left join lateral (
      select a.storage_key from sauna_model_assets x join assets a on a.id = x.asset_id
       where x.sauna_model_id = m.id and x.asset_role = 'MODEL_THUMBNAIL' order by x.position limit 1) th on true
    left join configuration_price_snapshots s on s.configuration_id = p.id
    left join configuration_requests r on r.configuration_id = p.id
   order by p.updated_at desc, p.id desc`;

// services/api/src/domain/requests.ts listRequestSummaries
const REQUEST_LIST = (extra: string) => `
  with page as materialized (
    select r.id, r.status_code, r.created_at, r.updated_at, r.customer_id, r.configuration_id, c.name as config_name, c.sauna_model_id
      from configuration_requests r
      join configurations c on c.id = r.configuration_id
      join sauna_models m on m.id = c.sauna_model_id
     where r.reseller_id = $1 ${extra}
     order by r.created_at desc, r.id desc
     limit $3)
  select p.id, p.status_code, coalesce(t.name, m.name) as model_name, p.config_name, s.final_price_minor, s.currency_code,
         p.created_at, p.updated_at, cu.first_name, cu.last_name, cu.email
    from page p
    join sauna_models m on m.id = p.sauna_model_id
    left join sauna_model_translations t on t.sauna_model_id = m.id and t.locale = $2
    join configuration_price_snapshots s on s.configuration_id = p.configuration_id
    join customers cu on cu.id = p.customer_id
   order by p.created_at desc, p.id desc`;

// services/api/src/routes/admin.ts adminCustomers
const CUSTOMER_LIST = (extra: string) => `
  select cu.id, cu.email, cu.first_name, cu.last_name, cu.status, cu.created_at,
         (select count(*) from configurations x where x.customer_id = cu.id) as configurations,
         (select count(*) from configuration_requests r where r.customer_id = cu.id) as requests
    from customers cu
   where cu.reseller_id = $1 ${extra}
   order by cu.created_at desc, cu.id desc
   limit $2`;
const CUSTOMER_SEARCH = `and (cu.email ilike $3 or (coalesce(cu.first_name, '') || ' ' || coalesce(cu.last_name, '')) ilike $3)`;

// services/api/src/routes/admin.ts analytics()
const SINCE = `now() - make_interval(days => $2)`;
const ANALYTICS_TOTALS = `
  select (select count(*) from customers where reseller_id = $1 and status = 'ACTIVE' and created_at >= ${SINCE}) as customers,
         (select count(*) from configurations where reseller_id = $1 and created_at >= ${SINCE}) as configurations,
         (select count(*) from configuration_requests where reseller_id = $1 and created_at >= ${SINCE}) as requests,
         (select count(*) from share_link_views where reseller_id = $1 and viewed_at >= ${SINCE}) as views,
         (select count(*) from configuration_requests where reseller_id = $1 and status_code = 'ACCEPTED' and created_at >= ${SINCE}) as accepted`;
const ANALYTICS_BY_STATUS = `select status_code, count(*) as n from configuration_requests where reseller_id = $1 and created_at >= ${SINCE} group by status_code`;
const ANALYTICS_DAILY = `
  with days as (
    select d from generate_series(date_trunc('day', now()) - make_interval(days => $2 - 1), date_trunc('day', now()), interval '1 day') as d),
  r as (select date_trunc('day', created_at) as d, count(*) as n from configuration_requests
         where reseller_id = $1 and created_at >= date_trunc('day', now()) - make_interval(days => $2 - 1) group by 1),
  c as (select date_trunc('day', created_at) as d, count(*) as n from configurations
         where reseller_id = $1 and created_at >= date_trunc('day', now()) - make_interval(days => $2 - 1) group by 1),
  v as (select date_trunc('day', viewed_at) as d, count(*) as n from share_link_views
         where reseller_id = $1 and viewed_at >= date_trunc('day', now()) - make_interval(days => $2 - 1) group by 1)
  select to_char(days.d, 'YYYY-MM-DD') as day, coalesce(r.n, 0) as requests, coalesce(c.n, 0) as configurations, coalesce(v.n, 0) as views
    from days left join r on r.d = days.d left join c on c.d = days.d left join v on v.d = days.d
   order by days.d`;
const ANALYTICS_TOP = `
  with cfg as (
    select c.sauna_model_id, count(*) as n from configurations c
     where c.reseller_id = $1 and c.created_at >= ${SINCE} group by c.sauna_model_id),
  req as (
    select c.sauna_model_id, count(*) as n from configuration_requests r join configurations c on c.id = r.configuration_id
     where r.reseller_id = $1 and r.created_at >= ${SINCE} and c.created_at >= ${SINCE} group by c.sauna_model_id)
  select m.id, coalesce(t.name, m.name) as name, cfg.n as configurations, coalesce(req.n, 0) as requests
    from cfg
    join sauna_models m on m.id = cfg.sauna_model_id
    left join sauna_model_translations t on t.sauna_model_id = m.id and t.locale = $3
    left join req on req.sauna_model_id = cfg.sauna_model_id
   order by coalesce(req.n, 0) desc, cfg.n desc
   limit 10`;

// services/api/src/routes/admin.ts LINK_SQL
const LINKS = `
  select s.id, s.configuration_id, s.expires_at, s.revoked_at, s.created_at,
         (select count(*) from share_link_views v where v.share_link_id = s.id) as views,
         (select max(v.viewed_at) from share_link_views v where v.share_link_id = s.id) as last_viewed_at
    from share_links s where s.configuration_id = $1 order by s.created_at desc`;

// services/api/src/domain/catalog.ts MODEL_SQL (listing)
const CATALOG = `
  select m.id, m.slug, m.sku, coalesce(t.name, m.name) as name, coalesce(t.description, m.description) as description,
         rs.sort_order, rs.is_visible, p.list_price_minor, p.max_discount_bps,
         d.discount_type as sauna_type, d.discount_value as sauna_value, dd.discount_type as default_type, dd.discount_value as default_value
    from reseller_saunas rs
    join sauna_models m on m.id = rs.sauna_model_id and m.status = 'ACTIVE'
    join sauna_model_prices p on p.sauna_model_id = m.id and p.currency_code = $2
    left join sauna_model_translations t on t.sauna_model_id = m.id and t.locale = $3
    left join reseller_sauna_discounts d on d.reseller_id = rs.reseller_id and d.sauna_model_id = m.id
    left join reseller_default_discounts dd on dd.reseller_id = rs.reseller_id
   where rs.reseller_id = $1 and rs.is_visible order by rs.sort_order, name`;

// services/api/src/routes/manufacturer.ts summaries() and mAnalytics
const M_RESELLERS = `
  select r.*, (select count(*) from reseller_saunas rs where rs.reseller_id = r.id) as saunas, st.customers, st.requests_open
    from resellers r
    left join reseller_overview($1, $2) st on st.reseller_id = r.id
   where r.manufacturer_id = $1 and ($2::uuid is null or r.id = $2)
   order by r.name, r.slug`;
const M_ANALYTICS = `
  select r.id, r.name, r.slug, st.customers, st.configurations, st.requests, st.requests_accepted, st.share_link_views
    from resellers r cross join lateral reseller_stats(r.id, now() - make_interval(days => $2)) st
   where r.manufacturer_id = $1 order by st.requests desc, r.name`;

export const QUERIES: PerfQuery[] = [
  { name: 'configurations: admin list, page 1', role: 'app_tenant', sql: CONFIG_LIST(''), params: (c) => [c.alphaId, 'de', 26] },
  {
    name: 'configurations: admin list, page 200', role: 'app_tenant',
    sql: CONFIG_LIST('and (c.updated_at, c.id) < ($4::timestamptz, $5::uuid)'), params: (c) => [c.alphaId, 'de', 26, ...c.configCursor],
  },
  {
    name: 'configurations: customer list', role: 'app_tenant', asCustomer: true,
    sql: CONFIG_LIST('and c.customer_id = $4'), params: (c) => [c.alphaId, 'de', 26, c.customerId],
  },
  { name: 'requests: admin list, page 1', role: 'app_tenant', sql: REQUEST_LIST(''), params: (c) => [c.alphaId, 'de', 26] },
  {
    name: 'requests: admin list, page 200', role: 'app_tenant',
    sql: REQUEST_LIST('and (r.created_at, r.id) < ($4::timestamptz, $5::uuid)'), params: (c) => [c.alphaId, 'de', 26, ...c.requestCursor],
  },
  { name: 'requests: status SUBMITTED', role: 'app_tenant', sql: REQUEST_LIST('and r.status_code = $4'), params: (c) => [c.alphaId, 'de', 26, 'SUBMITTED'] },
  {
    name: 'requests: search "virtanen"', role: 'app_tenant',
    sql: REQUEST_LIST(
      `and (c.name ilike $4 or exists (select 1 from customers cu where cu.id = r.customer_id and (cu.email ilike $4 or (coalesce(cu.first_name, '') || ' ' || coalesce(cu.last_name, '')) ilike $4)))`,
    ),
    params: (c) => [c.alphaId, 'de', 26, like('virtanen')],
  },
  {
    name: 'requests: customer list', role: 'app_tenant', asCustomer: true,
    sql: REQUEST_LIST('and r.customer_id = $4'), params: (c) => [c.alphaId, 'de', 26, c.customerId],
  },
  { name: 'customers: list, page 1', role: 'app_tenant', sql: CUSTOMER_LIST(''), params: (c) => [c.alphaId, 26] },
  {
    name: 'customers: list, page 400', role: 'app_tenant',
    sql: CUSTOMER_LIST('and (cu.created_at, cu.id) < ($3::timestamptz, $4::uuid)'), params: (c) => [c.alphaId, 26, ...c.customerCursor],
  },
  { name: 'customers: search "anna" (common)', role: 'app_tenant', sql: CUSTOMER_LIST(CUSTOMER_SEARCH), params: (c) => [c.alphaId, 26, like('anna')] },
  { name: 'customers: search one e-mail (rare)', role: 'app_tenant', sql: CUSTOMER_LIST(CUSTOMER_SEARCH), params: (c) => [c.alphaId, 26, like(c.rareTerm)] },
  { name: 'customers: search "zzqx" (no match)', role: 'app_tenant', sql: CUSTOMER_LIST(CUSTOMER_SEARCH), params: (c) => [c.alphaId, 26, like('zzqx')] },
  {
    name: 'auth: login lookup by e-mail', role: 'app_tenant',
    sql: `select id, status, created_at, locale from customers where lower(email) = lower($1) and status in ('PENDING', 'ACTIVE')`,
    params: (c) => [c.loginEmail],
  },
  { name: 'analytics: totals 30 d', role: 'app_tenant', sql: ANALYTICS_TOTALS, params: (c) => [c.alphaId, 30] },
  { name: 'analytics: totals 365 d', role: 'app_tenant', sql: ANALYTICS_TOTALS, params: (c) => [c.alphaId, 365] },
  { name: 'analytics: by status 365 d', role: 'app_tenant', sql: ANALYTICS_BY_STATUS, params: (c) => [c.alphaId, 365] },
  { name: 'analytics: daily 30 d', role: 'app_tenant', sql: ANALYTICS_DAILY, params: (c) => [c.alphaId, 30] },
  { name: 'analytics: daily 365 d', role: 'app_tenant', sql: ANALYTICS_DAILY, params: (c) => [c.alphaId, 365] },
  { name: 'analytics: top saunas 30 d', role: 'app_tenant', sql: ANALYTICS_TOP, params: (c) => [c.alphaId, 30, 'de'] },
  { name: 'analytics: top saunas 365 d', role: 'app_tenant', sql: ANALYTICS_TOP, params: (c) => [c.alphaId, 365, 'de'] },
  { name: 'share links of a configuration (view counts)', role: 'app_tenant', sql: LINKS, params: (c) => [c.sharedConfigurationId] },
  { name: 'catalog: storefront listing', role: 'app_tenant', sql: CATALOG, params: (c) => [c.alphaId, c.alphaCurrency, 'de'] },
  { name: 'manufacturer: reseller list (500)', role: 'app_platform', sql: M_RESELLERS, params: (c) => [c.manufacturerId, null] },
  { name: 'manufacturer: analytics 30 d', role: 'app_platform', sql: M_ANALYTICS, params: (c) => [c.manufacturerId, 30] },
];

/** Picks the parameters from the loaded data (as the owner, bypassing RLS). */
export async function loadContext(client: pg.Client): Promise<PerfContext> {
  const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => {
    const { rows } = await client.query(sql, params);
    if (!rows[0]) throw new Error(`no row for: ${sql}`);
    return rows[0] as T;
  };
  const alpha = await one<{ id: string; currency_code: string; manufacturer_id: string }>(`select id, currency_code, manufacturer_id from resellers where slug = 'alpha'`);
  const cust = await one<{ customer_id: string }>(
    `select customer_id from configurations where reseller_id = $1 and customer_id is not null group by customer_id order by count(*) desc limit 1`, [alpha.id]);
  const cfg = await one<{ updated_at: Date; id: string }>(
    `select updated_at, id from configurations where reseller_id = $1 order by updated_at desc, id desc offset least(5000, (select count(*) / 2 from configurations where reseller_id = $1)) limit 1`, [alpha.id]);
  const req = await one<{ created_at: Date; id: string }>(
    `select created_at, id from configuration_requests where reseller_id = $1 order by created_at desc, id desc offset least(5000, (select count(*) / 2 from configuration_requests where reseller_id = $1)) limit 1`, [alpha.id]);
  const cu = await one<{ created_at: Date; id: string }>(
    `select created_at, id from customers where reseller_id = $1 order by created_at desc, id desc offset least(10000, (select count(*) / 2 from customers where reseller_id = $1)) limit 1`, [alpha.id]);
  const shared = await one<{ configuration_id: string }>(
    `select configuration_id from share_links where reseller_id = $1 group by configuration_id order by count(*) desc limit 1`, [alpha.id]);
  const login = await one<{ email: string }>(`select email from customers where reseller_id = $1 and status = 'ACTIVE' order by id limit 1 offset least(777, (select count(*) / 2 from customers where reseller_id = $1))`, [alpha.id]);
  return {
    alphaId: alpha.id,
    alphaCurrency: alpha.currency_code.trim(),
    manufacturerId: alpha.manufacturer_id,
    customerId: cust.customer_id,
    configCursor: [cfg.updated_at.toISOString(), cfg.id],
    requestCursor: [req.created_at.toISOString(), req.id],
    customerCursor: [cu.created_at.toISOString(), cu.id],
    sharedConfigurationId: shared.configuration_id,
    loginEmail: login.email.toUpperCase(),
    rareTerm: login.email.split('@')[0]!,
  };
}
