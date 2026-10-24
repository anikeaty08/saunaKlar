import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ALPHA, BETA, GAMMA, M, SEED, as, count, expectCode, one, ownerTx, platform, setupEnv, tenant, type Env } from './helpers.ts';

let env: Env;
beforeAll(async () => { env = await setupEnv(); });
afterAll(async () => { await env?.close(); });

const worker = <T>(fn: (c: pg.PoolClient) => Promise<T>) => as(env, 'app_worker', {}, fn);

/** Tables holding tenant rows, with how many rows beta owns in the seed (> 0 for every one). */
const TENANT_TABLES = [
  'customers', 'customer_addresses', 'customer_consents', 'configurations', 'configuration_selections',
  'configuration_price_snapshots', 'configuration_price_snapshot_lines', 'configuration_requests',
  'request_status_history', 'request_quotes', 'reseller_saunas', 'reseller_sauna_discounts', 'reseller_room_scenes',
  'reseller_branding', 'reseller_admins',
];

describe('rule 12: tenant isolation', () => {
  it('fails closed: no tenant set means zero rows everywhere', async () => {
    for (const t of [...TENANT_TABLES, 'resellers', 'sauna_models', 'sauna_model_prices', 'options', 'room_scenes', 'share_links', 'request_notes']) {
      expect(await tenant(env, null, c => count(c, `SELECT 1 FROM ${t}`)), t).toBe(0);
    }
  });

  it('a malformed tenant setting also reads as no tenant', async () => {
    const c = await env.api.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE app_tenant');
      await c.query(`SELECT set_config('app.reseller_id', 'x'' OR true --', true)`);
      expect(await count(c, 'SELECT 1 FROM customers')).toBe(0);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  it('tenant A reads none of tenant B\'s rows (every tenant table)', async () => {
    for (const t of TENANT_TABLES) {
      const betaRows = await count(env.owner, `SELECT 1 FROM ${t} WHERE ${t === 'configuration_selections' || t.startsWith('configuration_price')
        ? `configuration_id IN (SELECT id FROM configurations WHERE reseller_id = '${BETA}')` : `reseller_id = '${BETA}'`}`);
      expect(betaRows, `seed has beta rows in ${t}`).toBeGreaterThan(0);
      const seen = await tenant(env, ALPHA, c => count(c, `SELECT 1 FROM ${t} WHERE ${t === 'configuration_selections' || t.startsWith('configuration_price')
        ? `configuration_id IN (SELECT id FROM configurations WHERE reseller_id = '${BETA}')` : `reseller_id = '${BETA}'`}`));
      expect(seen, t).toBe(0);
    }
    expect(await tenant(env, BETA, c => count(c, 'SELECT 1 FROM share_links'))).toBe(0);
    expect(await tenant(env, BETA, c => count(c, 'SELECT 1 FROM request_notes'))).toBe(0);
    expect(await tenant(env, ALPHA, c => count(c, 'SELECT 1 FROM share_links'))).toBe(1);
  });

  it('sees the same e-mail once per tenant; duplicates within a tenant are refused case-insensitively', async () => {
    expect(await tenant(env, ALPHA, c => count(c, `SELECT 1 FROM customers WHERE email = 'anna@example.test'`))).toBe(1);
    expect(await tenant(env, BETA, c => count(c, `SELECT 1 FROM customers WHERE email = 'anna@example.test'`))).toBe(1);
    await expectCode(tenant(env, ALPHA, c => c.query(`INSERT INTO customers (reseller_id, email) VALUES ($1, 'ANNA@example.test')`, [ALPHA])),
      'UNIQUE_VIOLATION');
    await tenant(env, GAMMA, c => c.query(`INSERT INTO customers (reseller_id, email) VALUES ($1, 'anna@example.test')`, [GAMMA]));
  });

  it('tenant A cannot write tenant B rows', async () => {
    // insert with another reseller_id: RLS WITH CHECK
    await expectCode(tenant(env, ALPHA, c => c.query(`INSERT INTO customers (reseller_id, email) VALUES ($1, 'x@example.test')`, [BETA])),
      'INSUFFICIENT_PRIVILEGE');
    await expectCode(tenant(env, ALPHA, c => c.query(`INSERT INTO configuration_selections VALUES ($1, $2, $3)`,
      [SEED.configurations.annaBetaDraft, M('espoo-compact'), SEED.options('door-clear')])), 'INSUFFICIENT_PRIVILEGE');
    await expectCode(tenant(env, ALPHA, c => c.query(`INSERT INTO share_link_views (share_link_id, reseller_id) VALUES ($1, $2)`,
      [SEED.shareLinkId, BETA])), 'INSUFFICIENT_PRIVILEGE');
    // update / delete of invisible rows touch nothing
    for (const [sql, args] of [
      ['UPDATE customers SET first_name = $2 WHERE id = $1', [SEED.customers.annaBeta, 'Hacked']],
      ['DELETE FROM customer_addresses WHERE customer_id = $1', [SEED.customers.annaBeta]],
      ['UPDATE configurations SET name = $2 WHERE id = $1', [SEED.configurations.annaBetaDraft, 'x']],
      ['UPDATE configuration_requests SET status_code = $2 WHERE reseller_id = $1', [BETA, 'CLOSED']],
      ['DELETE FROM reseller_sauna_discounts WHERE reseller_id = $1', [BETA]],
    ] as [string, unknown[]][]) {
      const r = await tenant(env, ALPHA, c => c.query(sql, args), { actorStaffId: SEED.staff.alphaOwner });
      expect(r.rowCount, sql).toBe(0);
    }
    expect((await one<{ f: string }>(env.owner, 'SELECT first_name AS f FROM customers WHERE id = $1', [SEED.customers.annaBeta])).f).toBe('Anna');
  });

  it('narrows PII to the acting customer', async () => {
    const asBen = <T>(fn: (c: pg.PoolClient) => Promise<T>) => tenant(env, ALPHA, fn, { actorCustomerId: SEED.customers.benAlpha });
    expect(await asBen(c => count(c, 'SELECT 1 FROM customers'))).toBe(1);
    expect(await asBen(c => count(c, 'SELECT 1 FROM customer_addresses WHERE customer_id <> $1', [SEED.customers.benAlpha]))).toBe(0);
    expect(await asBen(c => count(c, 'SELECT 1 FROM customer_consents WHERE customer_id <> $1', [SEED.customers.benAlpha]))).toBe(0);
    expect(await tenant(env, ALPHA, c => count(c, 'SELECT 1 FROM customers'))).toBeGreaterThanOrEqual(2);
  });

  it('shows a tenant only the catalog it offers, priced in its own currency', async () => {
    const alpha = await tenant(env, ALPHA, async c => ({
      models: (await c.query<{ slug: string }>('SELECT slug FROM sauna_models ORDER BY slug')).rows.map(r => r.slug),
      currencies: (await c.query<{ c: string }>('SELECT DISTINCT currency_code AS c FROM sauna_model_prices')).rows.map(r => r.c),
      optionCurrencies: (await c.query<{ c: string }>('SELECT DISTINCT currency_code AS c FROM sauna_model_option_prices')).rows.map(r => r.c),
      rooms: await count(c, 'SELECT 1 FROM room_scenes'),
    }));
    expect(alpha.models).toEqual(['espoo-compact', 'kuopio-cube', 'lappi-barrel', 'oulu-corner', 'turku-panorama']);
    expect(alpha.currencies).toEqual(['EUR']);
    expect(alpha.optionCurrencies).toEqual(['EUR']);
    expect(alpha.rooms).toBe(3);
    const gamma = await tenant(env, GAMMA, async c => ({
      currencies: (await c.query<{ c: string }>('SELECT DISTINCT currency_code AS c FROM sauna_model_prices')).rows.map(r => r.c),
      helsinki: await count(c, 'SELECT 1 FROM sauna_model_option_groups WHERE sauna_model_id = $1', [M('helsinki-studio')]),
      rooms: await count(c, 'SELECT 1 FROM room_scenes'),
      espooAssets: await count(c, `SELECT 1 FROM assets WHERE storage_key LIKE '%/espoo-compact/%'`),
      assets: await count(c, 'SELECT 1 FROM assets'),
    }));
    // Gamma offers lappi-barrel, oulu-corner and kuopio-cube (6 assets each), the basement-spa room
    // (1 thumbnail) and the 19 options those models carry (1 thumbnail each); nothing of Espoo.
    expect(gamma).toEqual({ currencies: ['SEK'], helsinki: 0, rooms: 1, espooAssets: 0, assets: 3 * 6 + 1 + 19 });
    // Beta offers espoo-compact: its 4 sample files plus 2 gallery images.
    expect(await tenant(env, BETA, c => count(c, `SELECT 1 FROM assets WHERE storage_key LIKE '%/espoo-compact/%'`))).toBe(6);
  });

  it('lets a tenant change its own visibility, order, share expiry and branding only', async () => {
    await tenant(env, ALPHA, async c => {
      await c.query(`UPDATE reseller_saunas SET sort_order = 5 WHERE sauna_model_id = $1`, [M('kuopio-cube')]);
      await c.query(`UPDATE resellers SET default_share_expiry_days = 14 WHERE id = $1`, [ALPHA]);
      await c.query(`UPDATE reseller_branding SET primary_color = '#203040' WHERE reseller_id = $1`, [ALPHA]);
    });
    await expectCode(tenant(env, ALPHA, c => c.query(`UPDATE resellers SET name = 'x'`)), 'INSUFFICIENT_PRIVILEGE');
    await expectCode(tenant(env, ALPHA, c => c.query(`UPDATE reseller_branding SET primary_color = '#FFFFFF'`)), 'CHECK_VIOLATION');
  });

  it('exposes staff names but not e-mails to tenants', async () => {
    const names = await tenant(env, ALPHA, c => c.query<{ display_name: string }>('SELECT id, display_name FROM staff_users'));
    expect(names.rows.map(r => r.display_name)).toEqual(['Anton Albrecht']);
    await expectCode(tenant(env, ALPHA, c => c.query('SELECT email FROM staff_users')), 'INSUFFICIENT_PRIVILEGE');
  });
});

describe('platform, worker and catalog roles', () => {
  it('app_platform cannot read customer PII, configurations or request content', async () => {
    for (const t of ['customers', 'customer_addresses', 'customer_consents', 'configurations', 'configuration_requests',
      'request_notes', 'request_quotes', 'request_status_history', 'share_links']) {
      await expectCode(platform(env, c => c.query(`SELECT * FROM ${t} LIMIT 1`)), 'INSUFFICIENT_PRIVILEGE');
    }
  });

  it('app_platform gets aggregate counts through reseller_stats()', async () => {
    const all = await platform(env, c => c.query('SELECT * FROM reseller_stats(NULL)'));
    expect(all.rows).toHaveLength(3);
    const alpha = await platform(env, c => one(c, 'SELECT * FROM reseller_stats($1)', [ALPHA]));
    expect(alpha).toMatchObject({ reseller_id: ALPHA, customers: 2, configurations: 5, locked_configurations: 4, share_links: 1,
      share_link_views: 2, requests: 3, requests_open: 3, requests_accepted: 0 });
    const recent = await platform(env, c => one(c, `SELECT * FROM reseller_stats($1, now() - interval '36 hours')`, [ALPHA]));
    expect(recent).toMatchObject({ customers: 0, configurations: 0, share_links: 1, share_link_views: 1, requests: 3 });
    const statuses = await platform(env, c => c.query('SELECT status_code, requests FROM reseller_request_status_counts($1)', [BETA]));
    expect(statuses.rows).toEqual([{ status_code: 'ACCEPTED', requests: 1 }]);
    await expectCode(tenant(env, ALPHA, c => c.query('SELECT * FROM reseller_stats($1)', [BETA])), 'INSUFFICIENT_PRIVILEGE');
  });

  it('app_platform manages resellers, assignments and prices', async () => {
    await platform(env, async c => {
      await c.query(`UPDATE sauna_model_prices SET list_price_minor = 700000 WHERE sauna_model_id = $1 AND currency_code = 'EUR'`, [M('espoo-compact')]);
      await c.query(`UPDATE reseller_saunas SET is_visible = true WHERE reseller_id = $1`, [ALPHA]);
      await c.query(`UPDATE resellers SET name = 'Gamma Bastu' WHERE id = $1`, [GAMMA]);
    });
    await expectCode(platform(env, c => c.query(`UPDATE reseller_sauna_discounts SET discount_value = 0`)), 'INSUFFICIENT_PRIVILEGE');
  });

  it('app_worker reads customer e-mail (only the granted columns) and drains the outbox', async () => {
    const r = await worker(c => one<{ email: string }>(c, 'SELECT id, reseller_id, email, first_name, locale, status FROM customers WHERE id = $1',
      [SEED.customers.annaAlpha]));
    expect(r.email).toBe('anna@example.test');
    await expectCode(worker(c => c.query('SELECT last_name FROM customers')), 'INSUFFICIENT_PRIVILEGE');
    await expectCode(worker(c => c.query('SELECT phone FROM customers')), 'INSUFFICIENT_PRIVILEGE');
    await expectCode(worker(c => c.query('SELECT message FROM configuration_requests')), 'INSUFFICIENT_PRIVILEGE');
    await expectCode(worker(c => c.query('SELECT * FROM customer_addresses')), 'INSUFFICIENT_PRIVILEGE');
    const claimed = await worker(c => c.query(`UPDATE notification_outbox SET locked_until = now() + interval '1 minute', attempts = attempts + 1
      WHERE id IN (SELECT id FROM notification_outbox WHERE sent_at IS NULL ORDER BY id LIMIT 5 FOR UPDATE SKIP LOCKED) RETURNING id`));
    expect(claimed.rowCount).toBe(5);
    await worker(c => c.query(`INSERT INTO email_suppressions (email_lower, reason) VALUES ('bounce@example.test', 'BOUNCE')`));
  });

  it('app_tenant can enqueue for itself but not read the outbox', async () => {
    await tenant(env, ALPHA, c => c.query(`INSERT INTO notification_outbox (reseller_id, event_type, payload) VALUES ($1, 'SHARE_LINK_CREATED', '{}')`, [ALPHA]));
    await expectCode(tenant(env, ALPHA, c => c.query(`INSERT INTO notification_outbox (reseller_id, event_type) VALUES ($1, 'X_EVENT')`, [BETA])),
      'INSUFFICIENT_PRIVILEGE');
    await expectCode(tenant(env, ALPHA, c => c.query('SELECT * FROM notification_outbox')), 'INSUFFICIENT_PRIVILEGE');
  });
});

describe('SECURITY DEFINER API functions', () => {
  it('search_customer_ids searches the current tenant only, honours the customer actor, escapes LIKE and pages', async () => {
    const ids = (r: pg.QueryResult) => r.rows.map(x => x.id as string);
    const search = (reseller: string, q: string, limit: number | null = null, before: [string, string] | [null, null] = [null, null]) =>
      (c: pg.PoolClient) => c.query('SELECT search_customer_ids AS id FROM search_customer_ids($1, $2, $3, $4, $5)', [reseller, q, limit, ...before]);
    const alpha = ids(await tenant(env, ALPHA, search(ALPHA, 'VIRTANEN')));
    expect(alpha).toContain(SEED.customers.annaAlpha);
    expect(alpha).not.toContain(SEED.customers.annaBeta);
    expect(ids(await tenant(env, ALPHA, search(ALPHA, 'anna@exa')))).toContain(SEED.customers.annaAlpha);
    expect(ids(await tenant(env, ALPHA, search(ALPHA, 'anna virt')))).toContain(SEED.customers.annaAlpha);
    // Not across fields (e-mail end + first name), and LIKE metacharacters are literal.
    expect(ids(await tenant(env, ALPHA, search(ALPHA, 'test anna')))).toEqual([]);
    expect(ids(await tenant(env, ALPHA, search(ALPHA, '%')))).toEqual([]);
    expect(ids(await tenant(env, ALPHA, search(ALPHA, 'a_na')))).toEqual([]);
    // Another tenant's id, or no tenant, is refused; a customer session finds only itself.
    await expectCode(tenant(env, ALPHA, search(BETA, 'anna')), 'INSUFFICIENT_PRIVILEGE');
    await expectCode(tenant(env, null, search(ALPHA, 'anna')), 'INSUFFICIENT_PRIVILEGE');
    expect(ids(await tenant(env, ALPHA, search(ALPHA, 'example'), { actorCustomerId: SEED.customers.benAlpha }))).toEqual([SEED.customers.benAlpha]);
    await expectCode(platform(env, search(ALPHA, 'anna')), 'INSUFFICIENT_PRIVILEGE');
    await expectCode(as(env, 'app_worker', {}, search(ALPHA, 'anna')), 'INSUFFICIENT_PRIVILEGE');
    // Keyset: newest first, limit, then strictly after the cursor.
    const all = ids(await tenant(env, ALPHA, search(ALPHA, 'example')));
    expect(all.length).toBeGreaterThan(1);
    const first = ids(await tenant(env, ALPHA, search(ALPHA, 'example', 1)));
    expect(first).toEqual([all[0]]);
    const at = await one<{ at: string }>(env.owner, `SELECT created_at::text AS at FROM customers WHERE id = $1`, [all[0]]);
    expect(ids(await tenant(env, ALPHA, search(ALPHA, 'example', null, [at.at, all[0]!])))).toEqual(all.slice(1));
  });

  it('customers.email_lower follows the e-mail', async () => {
    const row = await tenant(env, ALPHA, c => one<{ email_lower: string }>(c, `SELECT email_lower FROM customers WHERE email_lower = lower('ANNA@Example.test')`));
    expect(row.email_lower).toBe('anna@example.test');
    await expect(tenant(env, ALPHA, c => c.query(`UPDATE customers SET email_lower = 'x' WHERE id = $1`, [SEED.customers.annaAlpha])))
      .rejects.toMatchObject({ code: '428C9' });
  });

  const alphaSub = () => one<{ s: string }>(env.owner, 'SELECT idp_subject AS s FROM staff_users WHERE id = $1', [SEED.staff.alphaOwner]).then(r => r.s);

  it('staff_principal_for_reseller returns ACTIVE admins of that reseller only', async () => {
    const sub = await alphaSub();
    const p = await tenant(env, ALPHA, c => c.query('SELECT * FROM staff_principal_for_reseller($1, $2)', [sub, ALPHA]));
    expect(p.rows).toEqual([{ staff_user_id: SEED.staff.alphaOwner, email: 'owner@alpha.test', display_name: 'Anton Albrecht', role: 'OWNER', status: 'ACTIVE' }]);
    expect((await tenant(env, BETA, c => c.query('SELECT * FROM staff_principal_for_reseller($1, $2)', [sub, BETA]))).rowCount).toBe(0);
    await expectCode(platform(env, c => c.query('SELECT * FROM staff_principal_for_reseller($1, $2)', [sub, ALPHA])), 'INSUFFICIENT_PRIVILEGE');
  });

  it('staff_principal_for_manufacturer, staff_by_email and activate_staff_user', async () => {
    const adminSub = (await one<{ s: string }>(env.owner, 'SELECT idp_subject AS s FROM staff_users WHERE id = $1', [SEED.staff.admin])).s;
    const m = await platform(env, c => one(c, 'SELECT * FROM staff_principal_for_manufacturer($1)', [adminSub]));
    expect(m).toMatchObject({ staff_user_id: SEED.staff.admin, manufacturer_id: SEED.manufacturerId, status: 'ACTIVE' });
    const alphaSubject = await alphaSub();
    expect((await platform(env, c => c.query('SELECT * FROM staff_principal_for_manufacturer($1)', [alphaSubject]))).rowCount).toBe(0);
    const byEmail = await tenant(env, ALPHA, c => one(c, `SELECT * FROM staff_by_email('OWNER@alpha.test ')`));
    expect(byEmail).toMatchObject({ staff_user_id: SEED.staff.alphaOwner, status: 'ACTIVE' });

    await ownerTx(env, c => c.query(`INSERT INTO staff_users (email, display_name, idp_subject, status) VALUES ('new@alpha.test', 'New', 'sub-new', 'INVITED')`));
    expect((await platform(env, c => one<{ a: boolean }>(c, `SELECT activate_staff_user('sub-new') AS a`))).a).toBe(true);
    expect((await platform(env, c => one<{ a: boolean }>(c, `SELECT activate_staff_user('sub-new') AS a`))).a).toBe(false);
    await ownerTx(env, c => c.query(`UPDATE staff_users SET status = 'DISABLED' WHERE idp_subject = 'sub-new'`));
    expect((await tenant(env, ALPHA, c => one<{ a: boolean }>(c, `SELECT activate_staff_user('sub-new') AS a`))).a).toBe(false);
  });

  it('anonymise_customer erases identity, keeps consents and works only inside the tenant', async () => {
    const id = SEED.customers.benAlpha;
    expect((await tenant(env, BETA, c => one<{ a: boolean }>(c, 'SELECT anonymise_customer($1) AS a', [id]))).a).toBe(false);
    expect((await tenant(env, ALPHA, c => one<{ a: boolean }>(c, 'SELECT anonymise_customer($1) AS a', [id]))).a).toBe(true);
    const row = await one(env.owner, 'SELECT email, first_name, status FROM customers WHERE id = $1', [id]);
    expect(row).toEqual({ email: `anonymised+${id}@invalid`, first_name: null, status: 'ANONYMISED' });
    expect(await count(env.owner, 'SELECT 1 FROM customer_addresses WHERE customer_id = $1', [id])).toBe(0);
    expect(await count(env.owner, 'SELECT 1 FROM customer_consents WHERE customer_id = $1', [id])).toBe(2);
    await expectCode(env.owner.query(`UPDATE customers SET status = 'ACTIVE' WHERE id = $1`, [id]), 'CUSTOMER_ANONYMISED');
    // the address is free again at alpha
    await tenant(env, ALPHA, c => c.query(`INSERT INTO customers (reseller_id, email) VALUES ($1, 'ben@example.test')`, [ALPHA]));
  });
});

describe('worker retention functions', () => {
  it('retention_delete_batch respects the limit and the allow-list', async () => {
    await ownerTx(env, c => c.query(`INSERT INTO share_link_views (share_link_id, reseller_id, viewed_at)
      SELECT $1, $2, now() - interval '2 years' - n * interval '1 minute' FROM generate_series(1, 5) n`, [SEED.shareLinkId, ALPHA]));
    const cutoff = `now() - interval '13 months'`;
    expect((await worker(c => one<{ n: number }>(c, `SELECT retention_delete_batch('share_link_views', ${cutoff}, 3) AS n`))).n).toBe(3);
    expect((await worker(c => one<{ n: number }>(c, `SELECT retention_delete_batch('share_link_views', ${cutoff}, 3) AS n`))).n).toBe(2);
    expect((await worker(c => one<{ n: number }>(c, `SELECT retention_delete_batch('share_link_views', ${cutoff}, 3) AS n`))).n).toBe(0);
    expect(await count(env.owner, 'SELECT 1 FROM share_link_views')).toBeGreaterThanOrEqual(2); // recent views untouched
    expect((await worker(c => one<{ n: number }>(c, `SELECT retention_delete_batch('audit_events', ${cutoff}, 10) AS n`))).n).toBe(0);
    await expectCode(worker(c => c.query(`SELECT retention_delete_batch('customers', now(), 10)`)), 'RETENTION_TABLE_NOT_ALLOWED');
    await expectCode(tenant(env, ALPHA, c => c.query(`SELECT retention_delete_batch('audit_events', now(), 10)`)), 'INSUFFICIENT_PRIVILEGE');
  });

  it('delete_expired_pending_customers removes old, data-less PENDING sign-ups in batches', async () => {
    const ids = await ownerTx(env, async c => {
      const { rows } = await c.query<{ id: string }>(`INSERT INTO customers (reseller_id, email, status, created_at)
        SELECT $1, 'pending' || n || '@example.test', 'PENDING', now() - interval '10 days' FROM generate_series(1, 3) n RETURNING id`, [BETA]);
      // one recent PENDING row and one old PENDING row that owns a configuration
      await c.query(`INSERT INTO customers (reseller_id, email, status) VALUES ($1, 'fresh@example.test', 'PENDING')`, [BETA]);
      const { rows: [keep] } = await c.query<{ id: string }>(`INSERT INTO customers (reseller_id, email, status, created_at)
        VALUES ($1, 'keeper@example.test', 'PENDING', now() - interval '10 days') RETURNING id`, [BETA]);
      await c.query(`INSERT INTO configurations (reseller_id, sauna_model_id, customer_id) VALUES ($1, $2, $3)`, [BETA, M('espoo-compact'), keep!.id]);
      return rows.map(r => r.id);
    });
    const cutoff = `now() - interval '7 days'`;
    const first = await worker(c => c.query<{ id: string; reseller_id: string }>(`SELECT * FROM delete_expired_pending_customers(${cutoff}, 2)`));
    expect(first.rowCount).toBe(2);
    expect(first.rows.every(r => r.reseller_id === BETA && ids.includes(r.id))).toBe(true);
    const second = await worker(c => c.query(`SELECT * FROM delete_expired_pending_customers(${cutoff}, 2)`));
    expect(second.rowCount).toBe(1);
    expect((await worker(c => c.query(`SELECT * FROM delete_expired_pending_customers(${cutoff}, 2)`))).rowCount).toBe(0);
    expect(await count(env.owner, `SELECT 1 FROM customers WHERE email IN ('fresh@example.test', 'keeper@example.test')`)).toBe(2);
    await expectCode(platform(env, c => c.query(`SELECT * FROM delete_expired_pending_customers(now(), 1)`)), 'INSUFFICIENT_PRIVILEGE');
  });

  it('run_retention() returns deleted counts', async () => {
    const r = await worker(c => one<{ r: Record<string, number> }>(c, 'SELECT run_retention() AS r'));
    expect(Object.keys(r.r).sort()).toEqual(['auditEvents', 'pendingCustomers', 'sentOutbox', 'shareLinkViews']);
  });
});
