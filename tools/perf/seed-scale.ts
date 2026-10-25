/**
 * Scaled dataset for query-plan work (design 16: 500 resellers, ~1M customers).
 *
 * Builds a throwaway database with createTestDatabase({seed: true}) and bulk-loads, set-based
 * with generate_series (no row-by-row inserts):
 *   ~500 resellers (497 synthetic + the seeded ones), each offering every active sauna
 *   200k customers   (alpha: 20k, the rest spread evenly)
 *   1M configurations (alpha: 100k), 30 % locked with a price snapshot
 *   ~180k requests on locked configurations, ~15k share links with ~900k views
 *
 * Loading runs with session_replication_role = replica (no triggers, no FK checks), so the
 * generator itself keeps the data consistent; CHECK constraints still apply. Ends with
 * VACUUM ANALYZE so plans and index-only scans look like a settled production database.
 *
 * CLI: node tools/perf/seed-scale.ts [--keep] [--scale 0.1] [--out tools/perf/results/<name>.md]
 * Then the hot queries are EXPLAINed (see explain.ts and queries.ts).
 */
import pg from 'pg';
import { createTestDatabase } from '../../packages/db/src/testing.ts';

export interface ScaleOptions {
  /** Multiplies every row count (1 = the numbers above). */
  scale?: number;
  log?: (msg: string) => void;
}

export const SCALE = {
  syntheticResellers: 497,
  customers: 200_000,
  alphaCustomers: 20_000,
  configurations: 1_000_000,
  alphaConfigurations: 100_000,
};

const FIRST = ['Anna', 'Ben', 'Clara', 'David', 'Elin', 'Felix', 'Greta', 'Hugo', 'Ida', 'Jonas', 'Kaisa', 'Lars', 'Mia', 'Nils',
  'Olga', 'Paul', 'Rosa', 'Sven', 'Tilda', 'Urs', 'Vera', 'Wim', 'Xenia', 'Yann', 'Zoe', 'Aino', 'Bruno', 'Chiara', 'Dario', 'Emma'];
const LAST = ['Virtanen', 'Koskinen', 'Müller', 'Meier', 'Rossi', 'Bernard', 'Lindqvist', 'Nieminen', 'Schmid', 'Keller', 'Weber',
  'Huber', 'Fischer', 'Bianchi', 'Dubois', 'Laine', 'Heikkinen', 'Berg', 'Brunner', 'Gerber', 'Moretti', 'Lambert', 'Svensson',
  'Johansson', 'Hansen', 'Jensen', 'Wagner', 'Becker', 'Hoffmann', 'Ricci'];

const sqlArray = (xs: string[]) => `ARRAY[${xs.map((x) => `'${x.replace(/'/g, "''")}'`).join(',')}]`;

export async function seedScale(url: string, options: ScaleOptions = {}): Promise<void> {
  const log = options.log ?? (() => {});
  const s = options.scale ?? 1;
  const n = (x: number) => Math.max(1, Math.round(x * s));
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const step = async (label: string, sql: string, params: unknown[] = []) => {
    const t = Date.now();
    const res = await client.query(sql, params);
    log(`  ${label}: ${res.rowCount ?? 0} rows, ${((Date.now() - t) / 1000).toFixed(1)} s`);
  };
  try {
    await client.query(`SET session_replication_role = replica`);
    await client.query(`SET maintenance_work_mem = '256MB'`);
    await client.query(`SET work_mem = '64MB'`);

    await step('resellers', `
      INSERT INTO resellers (manufacturer_id, slug, name, currency_code, created_at, updated_at)
      SELECT m.id, 'perf-' || lpad(g::text, 4, '0'), 'Perf Sauna Partner ' || g,
             (ARRAY['EUR', 'CHF', 'SEK'])[1 + g % 3], now() - interval '800 days', now() - interval '800 days'
        FROM generate_series(1, $1::int) g, (SELECT id FROM manufacturers ORDER BY name LIMIT 1) m`, [n(SCALE.syntheticResellers)]);
    await step('branding', `
      INSERT INTO reseller_branding (reseller_id, display_name, primary_color)
      SELECT id, name, '#1f2a24' FROM resellers WHERE slug LIKE 'perf-%'`);
    await step('reseller_saunas', `
      INSERT INTO reseller_saunas (reseller_id, sauna_model_id, sort_order)
      SELECT r.id, m.id, m.sort_order FROM resellers r CROSS JOIN sauna_models m
       WHERE r.slug LIKE 'perf-%' AND m.status = 'ACTIVE'`);

    // Per-reseller plan: how many customers and configurations, and which models it offers.
    const others = n(SCALE.syntheticResellers) + 1; // synthetic + beta
    await client.query(`
      CREATE TEMP TABLE perf_res AS
      SELECT r.id, r.currency_code, row_number() OVER (ORDER BY r.slug)::int AS k,
             CASE WHEN r.slug = 'alpha' THEN $1::int ELSE $2::int END AS n_cust,
             CASE WHEN r.slug = 'alpha' THEN $3::int ELSE $4::int END AS n_conf,
             (SELECT array_agg(rs.sauna_model_id ORDER BY rs.sort_order) FROM reseller_saunas rs WHERE rs.reseller_id = r.id) AS models
        FROM resellers r WHERE r.status = 'ACTIVE'`,
      [n(SCALE.alphaCustomers), Math.max(1, Math.round((n(SCALE.customers) - n(SCALE.alphaCustomers)) / others)),
        n(SCALE.alphaConfigurations), Math.max(1, Math.round((n(SCALE.configurations) - n(SCALE.alphaConfigurations)) / others))]);

    // Timestamps are deterministic functions of the series index, spread over two years / one year.
    await step('customers', `
      INSERT INTO customers (reseller_id, email, first_name, last_name, locale, status, email_verified_at, created_at, updated_at)
      SELECT r.id,
             lower(f.first) || '.' || lower(f.last) || '.' || r.k || '.' || g || '@example.test',
             f.first, f.last,
             (ARRAY['en', 'de', 'fr', 'it', 'rm'])[1 + g % 5],
             CASE WHEN g % 50 = 0 THEN 'PENDING' ELSE 'ACTIVE' END,
             CASE WHEN g % 50 = 0 THEN NULL ELSE t.ts END, t.ts, t.ts
        FROM perf_res r
        CROSS JOIN LATERAL generate_series(1, r.n_cust) g
        CROSS JOIN LATERAL (SELECT now() - ((g::bigint * 7919 + r.k * 104729) % 1051200) * interval '1 minute' AS ts) t
        CROSS JOIN LATERAL (SELECT (${sqlArray(FIRST)})[1 + (g * 7 + r.k) % ${FIRST.length}] AS first,
                                   (${sqlArray(LAST)})[1 + (g * 13 + r.k * 3) % ${LAST.length}] AS last) f`);
    await client.query(`
      CREATE TEMP TABLE perf_cust AS
      SELECT c.id, c.reseller_id, row_number() OVER (PARTITION BY c.reseller_id ORDER BY c.id)::int AS seq
        FROM customers c WHERE c.email LIKE '%@example.test' AND c.status = 'ACTIVE'`);
    await client.query(`CREATE INDEX ON perf_cust (reseller_id, seq)`);
    await client.query(`ANALYZE perf_cust`);
    await client.query(`CREATE TEMP TABLE perf_cust_n AS SELECT reseller_id, count(*)::int AS n FROM perf_cust GROUP BY reseller_id`);

    await step('configurations', `
      INSERT INTO configurations (reseller_id, sauna_model_id, customer_id, locked_at, created_at, updated_at)
      SELECT r.id, r.models[1 + g % cardinality(r.models)], c.id,
             CASE WHEN g % 10 < 3 THEN t.ts + interval '2 hours' END,
             t.ts, LEAST(now(), t.ts + (g % 7) * interval '1 day' + interval '2 hours')
        FROM perf_res r
        JOIN perf_cust_n cn ON cn.reseller_id = r.id
        CROSS JOIN LATERAL generate_series(1, r.n_conf) g
        CROSS JOIN LATERAL (SELECT now() - ((g::bigint * 15485863 + r.k * 7) % 525600) * interval '1 minute' AS ts) t
        JOIN perf_cust c ON c.reseller_id = r.id AND c.seq = 1 + (g::bigint * 2654435761 % cn.n)::int`);

    await step('price snapshots', `
      INSERT INTO configuration_price_snapshots (configuration_id, currency_code, list_price_minor, options_total_minor,
             discount_amount_minor, final_price_minor, discount_source, max_discount_bps, price_valid_until, computed_at)
      SELECT c.id, r.currency_code, p.list_price_minor, 0, 0, p.list_price_minor, 'NONE', p.max_discount_bps,
             c.locked_at + interval '30 days', c.locked_at
        FROM configurations c
        JOIN resellers r ON r.id = c.reseller_id
        JOIN sauna_model_prices p ON p.sauna_model_id = c.sauna_model_id AND p.currency_code = r.currency_code
       WHERE c.locked_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM configuration_price_snapshots s WHERE s.configuration_id = c.id)`);

    await step('requests', `
      INSERT INTO configuration_requests (reseller_id, customer_id, configuration_id, status_code, created_at, updated_at)
      SELECT c.reseller_id, c.customer_id, c.id,
             (ARRAY['SUBMITTED', 'IN_REVIEW', 'QUOTED', 'ACCEPTED', 'CLOSED', 'REJECTED', 'CANCELLED'])[1 + abs(hashtext(c.id::text)) % 7],
             c.locked_at, c.locked_at
        FROM configurations c
       WHERE c.locked_at IS NOT NULL AND c.customer_id IS NOT NULL
         AND abs(hashtext(c.id::text) % 10) < 6
         AND NOT EXISTS (SELECT 1 FROM configuration_requests q WHERE q.configuration_id = c.id)`);

    await step('share links', `
      INSERT INTO share_links (reseller_id, configuration_id, token_hash, created_by_customer_id, expires_at, created_at)
      SELECT c.reseller_id, c.id, sha256(convert_to('perf-share:' || c.id, 'UTF8')), c.customer_id,
             c.locked_at + interval '30 days', c.locked_at
        FROM configurations c
       WHERE c.locked_at IS NOT NULL AND c.customer_id IS NOT NULL AND abs(hashtext(c.id::text || 's') % 20) = 0`);

    await step('share link views', `
      INSERT INTO share_link_views (share_link_id, reseller_id, viewed_at, device_class)
      SELECT l.id, l.reseller_id, LEAST(now(), l.created_at + g * interval '3 hours'),
             (ARRAY['MOBILE', 'TABLET', 'DESKTOP', 'OTHER'])[1 + g % 4]
        FROM share_links l
        CROSS JOIN LATERAL generate_series(1, 1 + abs(hashtext(l.id::text) % 120)) g`);

    await client.query(`SET session_replication_role = origin`);
    const t = Date.now();
    await client.query('VACUUM ANALYZE');
    log(`  vacuum analyze: ${((Date.now() - t) / 1000).toFixed(1)} s`);
  } finally {
    await client.end();
  }
}

export async function tableCounts(url: string): Promise<Record<string, number>> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const tables = ['resellers', 'customers', 'configurations', 'configuration_price_snapshots', 'configuration_requests', 'share_links', 'share_link_views'];
    const out: Record<string, number> = {};
    for (const t of tables) out[t] = Number((await client.query(`SELECT count(*) AS n FROM ${t}`)).rows[0].n);
    return out;
  } finally {
    await client.end();
  }
}

/** Creates a throwaway database with the dev seed plus the scaled data. */
export async function createScaleDatabase(options: ScaleOptions = {}) {
  const db = await createTestDatabase({ seed: true });
  try {
    await seedScale(db.url, options);
  } catch (err) {
    await db.drop();
    throw err;
  }
  return db;
}
