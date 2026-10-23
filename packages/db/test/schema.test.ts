import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  dbErrorCode, dbErrorInfo, loadMigrations, migrate, seed, SEED, SEED_PASSWORD, sql, verifyPassword, withTx,
} from '../src/index.ts';
import { ALPHA, count, expectCode, one, setupEnv, tenant, type Env } from './helpers.ts';

let env: Env;
beforeAll(async () => { env = await setupEnv(); });
afterAll(async () => { await env?.close(); });

describe('migrations and roles', () => {
  it('records every migration file, including local/, and re-running applies nothing', async () => {
    const files = await loadMigrations(true);
    const { rows } = await env.owner.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
    expect(rows.map(r => r.version).sort()).toEqual(files.map(f => f.version).sort());
    expect(files.some(f => f.version.startsWith('local/'))).toBe(true);
    expect(await migrate(env.db.url, { local: true })).toEqual([]);
  });

  it('creates NOLOGIN app roles and a NOINHERIT LOGIN sauna_api member', async () => {
    const { rows } = await env.owner.query<{ rolname: string; rolcanlogin: boolean; rolinherit: boolean }>(
      `SELECT rolname, rolcanlogin, rolinherit FROM pg_roles
       WHERE rolname IN ('app_tenant','app_platform','app_worker','catalog_admin','idp_local','sauna_api') ORDER BY rolname`);
    expect(rows).toHaveLength(6);
    for (const r of rows) expect(r.rolcanlogin).toBe(r.rolname === 'sauna_api');
    expect(rows.find(r => r.rolname === 'sauna_api')!.rolinherit).toBe(false);
    const members = await count(env.owner,
      `SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
       WHERE u.rolname = 'sauna_api' AND g.rolname IN ('app_tenant','app_platform','app_worker','idp_local')`);
    expect(members).toBe(4);
  });

  it('enables and forces RLS on every tenant table', async () => {
    const { rows } = await env.owner.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
       WHERE relname IN ('customers','customer_addresses','customer_consents','configurations','configuration_selections',
                         'configuration_requests','request_notes','request_quotes','share_links','share_link_views','resellers')`);
    expect(rows).toHaveLength(11);
    for (const r of rows) expect([r.relname, r.relrowsecurity, r.relforcerowsecurity]).toEqual([r.relname, true, true]);
  });

  it('loads reference data', async () => {
    expect(await count(env.owner, 'SELECT 1 FROM currencies')).toBe(8);
    expect(await count(env.owner, 'SELECT 1 FROM countries')).toBe(32);
    expect(await count(env.owner, 'SELECT 1 FROM request_statuses WHERE is_terminal')).toBe(3);
    expect(await count(env.owner, `SELECT 1 FROM request_status_transitions WHERE actor_kind = 'CUSTOMER'`)).toBe(4);
    expect(await count(env.owner, 'SELECT 1 FROM reserved_slugs')).toBe(17);
    const roles = await env.owner.query<{ code: string; tier: string; is_protected: boolean }>('SELECT code, tier, is_protected FROM asset_roles');
    expect(roles.rows).toHaveLength(13);
    expect(roles.rows.find(r => r.code === 'MODEL_AR_USDZ')).toMatchObject({ tier: 'AR', is_protected: true });
    expect(roles.rows.find(r => r.code === 'BRAND_FAVICON')).toMatchObject({ tier: 'PUBLIC', is_protected: false });
  });
});

describe('dev seed', () => {
  it('is idempotent', async () => {
    const again = await seed(env.db.url, { local: true });
    expect(again).toEqual({ seeded: false, idpUsers: 0 });
    expect(await count(env.owner, 'SELECT 1 FROM sauna_models')).toBe(6);
  });

  it('creates matching local IdP users with a verifiable scrypt hash', async () => {
    const anna = await one<{ username: string; pool: string; password_hash: string; status: string }>(env.owner,
      'SELECT username, pool, password_hash, status FROM idp.users WHERE sub = $1', [SEED.customers.annaAlpha]);
    expect(anna).toMatchObject({ username: SEED.customers.annaAlpha, pool: 'CUSTOMER', status: 'CONFIRMED' });
    expect(anna.password_hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await verifyPassword(SEED_PASSWORD, anna.password_hash)).toBe(true);
    expect(await verifyPassword('wrong', anna.password_hash)).toBe(false);
    const staff = await count(env.owner,
      `SELECT 1 FROM staff_users s JOIN idp.users u ON u.sub::text = s.idp_subject AND u.username = lower(s.email) AND u.pool = 'STAFF'
       WHERE NOT u.mfa_enabled`);
    expect(staff).toBe(4);
  });

  it('keeps the same e-mail as two customer accounts at alpha and beta', async () => {
    expect(await count(env.owner, `SELECT 1 FROM customers WHERE lower(email) = 'anna@example.test'`)).toBe(2);
  });

  it('seeds translations (de, fr, it) for models, groups, options, rooms and attributes', async () => {
    for (const [table, total] of [['sauna_model_translations', 6], ['option_group_translations', 6], ['option_translations', 19],
      ['room_scene_translations', 3], ['attribute_definition_translations', 6]] as const) {
      expect(await count(env.owner, `SELECT 1 FROM ${table} WHERE locale IN ('de','fr','it')`), table).toBe(total * 3);
    }
  });

  it('links the Espoo Compact sample asset set by tier prefix', async () => {
    const { rows } = await env.owner.query<{ asset_role: string; storage_key: string }>(
      `SELECT a.asset_role, s.storage_key FROM sauna_model_assets a JOIN assets s ON s.id = a.asset_id
       WHERE a.sauna_model_id = $1 ORDER BY a.asset_role`, [SEED.models('espoo-compact')]);
    expect(rows).toEqual([
      { asset_role: 'MODEL_AR_GLB', storage_key: 'assets/hi/catalog/espoo-compact/ar-9f3c2a.glb' },
      { asset_role: 'MODEL_GLB_HIGH', storage_key: 'assets/hi/catalog/espoo-compact/high-9f3c2a.glb' },
      { asset_role: 'MODEL_GLB_LOW', storage_key: 'assets/lo/catalog/espoo-compact/low-4b1e7d.glb' },
      { asset_role: 'MODEL_THUMBNAIL', storage_key: 'media/catalog/espoo-compact/thumb-1a2b3c.webp' },
    ]);
  });

  it('rejects a protected role whose file sits under the public prefix (ASSET_TIER_MISMATCH)', async () => {
    await expectCode(env.owner.query(
      `WITH a AS (INSERT INTO assets (storage_key, content_type) VALUES ('media/x/leak.glb', 'model/gltf-binary') RETURNING id)
       INSERT INTO sauna_model_assets (sauna_model_id, asset_role, asset_id) SELECT $1, 'MODEL_GLB_LOW', id FROM a`,
      [SEED.models('lappi-barrel')]), 'ASSET_TIER_MISMATCH');
  });
});

describe('client helpers', () => {
  it('lets the login call resolve_tenant before any role switch (suspended tenants included)', async () => {
    const c = new pg.Client({ connectionString: env.db.apiUrl });
    await c.connect();
    try {
      const gamma = await one(c, `SELECT * FROM resolve_tenant('GAMMA')`);
      expect(gamma).toMatchObject({ slug: 'gamma', status: 'SUSPENDED', currency_code: 'SEK', manufacturer_id: SEED.manufacturerId });
      expect(await count(c, `SELECT * FROM resolve_tenant('nope')`)).toBe(0);
      await expectCode(c.query('SELECT * FROM customers'), 'INSUFFICIENT_PRIVILEGE');
    } finally {
      await c.end();
    }
  });

  it('withTx validates its context and rolls back on error', async () => {
    await expect(withTx(env.api, { role: 'app_tenant', resellerId: 'not-a-uuid' }, async () => 1)).rejects.toThrow(TypeError);
    await expect(withTx(env.api, { role: 'app_tenant', actorStaffId: SEED.staff.alphaOwner, actorCustomerId: SEED.customers.annaAlpha },
      async () => 1)).rejects.toThrow(/not both/);
    await expect(withTx(env.api, { role: 'superuser' as never }, async () => 1)).rejects.toThrow(/unknown role/);
    await expect(tenant(env, ALPHA, async c => {
      await c.query(`UPDATE resellers SET default_share_expiry_days = 45 WHERE id = $1`, [ALPHA]);
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect((await one<{ d: number }>(env.owner, 'SELECT default_share_expiry_days AS d FROM resellers WHERE id = $1', [ALPHA])).d).toBe(30);
  });

  it('settings are transaction-local: a fresh transaction sees no tenant', async () => {
    const r = await tenant(env, ALPHA, async c => one<{ r: string }>(c, `SELECT current_setting('app.reseller_id') AS r`));
    expect(r.r).toBe(ALPHA);
    const after = await withTx(env.api, { role: 'app_tenant' }, async c => one<{ r: string | null }>(c, `SELECT app_reseller_id() AS r`));
    expect(after.r).toBeNull();
  });

  it('parses bigint columns as numbers', async () => {
    const r = await tenant(env, ALPHA, async c => one<{ v: unknown }>(c, 'SELECT catalog_version AS v FROM resellers'));
    expect(typeof r.v).toBe('number');
  });

  it('sql`` builds numbered parameters and inlines nested fragments', () => {
    const where = sql.join([sql`a = ${1}`, sql`b = ${'x'}`], ' AND ');
    const q = sql`SELECT * FROM t WHERE ${where} LIMIT ${10}`;
    expect(q.text).toBe('SELECT * FROM t WHERE a = $1 AND b = $2 LIMIT $3');
    expect(q.values).toEqual([1, 'x', 10]);
  });

  it('maps errors to stable codes', async () => {
    const err = await env.owner.query(`INSERT INTO currencies VALUES ('EUR', 2, 'dup')`).catch(e => e);
    expect(dbErrorInfo(err)).toMatchObject({ code: 'UNIQUE_VIOLATION', constraint: 'currencies_pkey' });
    expect(dbErrorCode(await env.owner.query(`INSERT INTO countries VALUES ('zz', 'x')`).catch(e => e))).toBe('CHECK_VIOLATION');
    expect(dbErrorCode(await env.owner.query(`INSERT INTO reseller_admins (reseller_id, staff_user_id) VALUES (gen_random_uuid(), gen_random_uuid())`).catch(e => e)))
      .toBe('FOREIGN_KEY_VIOLATION');
    expect(dbErrorCode(await env.owner.query(`SELECT raise_rule('SLUG_RESERVED', 'x', 'y')`).catch(e => e))).toBe('SLUG_RESERVED');
    expect(dbErrorCode(new Error('plain'))).toBeUndefined();
  });
});
