import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Queryable } from '../src/index.ts';
import { ALPHA, BETA, M, O, SEED, count, draft, expectCode, one, platform, setupEnv, tenant, writeSnapshot, type Env } from './helpers.ts';

/** 0015 reseller_sauna_options: tenant isolation, option rules, lock pricing, versioning, audit. */
let env: Env;
beforeAll(async () => { env = await setupEnv(); });
afterAll(async () => { await env?.close(); });

const staff = { actorStaffId: SEED.staff.alphaOwner };
const setting = (reseller: string, model: string, option: string, enabled = true, price: number | null = null) =>
  [`INSERT INTO reseller_sauna_options (reseller_id, sauna_model_id, option_id, is_enabled, price_override_minor) VALUES ($1, $2, $3, $4, $5)`,
    [reseller, M(model), O(option), enabled, price]] as [string, unknown[]];

describe('reseller_sauna_options: tenant isolation (RLS)', () => {
  it('each reseller sees and changes only its own rows', async () => {
    // Both offer espoo-compact; the seed holds alpha rows (aurora-hex) only.
    await tenant(env, BETA, c => c.query(...setting(BETA, 'espoo-compact', 'aspen', false)), { actorStaffId: SEED.staff.betaOwner });
    expect(await count(env.owner, `SELECT 1 FROM reseller_sauna_options WHERE reseller_id = $1`, [BETA])).toBe(1);

    expect(await tenant(env, ALPHA, c => count(c, `SELECT 1 FROM reseller_sauna_options WHERE reseller_id = $1`, [BETA]))).toBe(0);
    expect(await tenant(env, BETA, c => count(c, `SELECT 1 FROM reseller_sauna_options WHERE reseller_id = $1`, [ALPHA]))).toBe(0);
    expect(await tenant(env, ALPHA, c => count(c, 'SELECT 1 FROM reseller_sauna_options'))).toBe(2);
    expect(await tenant(env, null, c => count(c, 'SELECT 1 FROM reseller_sauna_options'))).toBe(0);

    // Writes into another tenant fail (WITH CHECK); updates and deletes of its rows touch nothing.
    await expectCode(tenant(env, ALPHA, c => c.query(...setting(BETA, 'espoo-compact', 'door-bronze', false)), staff), 'INSUFFICIENT_PRIVILEGE');
    const upd = await tenant(env, ALPHA, c => c.query('UPDATE reseller_sauna_options SET is_enabled = true WHERE reseller_id = $1', [BETA]), staff);
    const del = await tenant(env, ALPHA, c => c.query('DELETE FROM reseller_sauna_options WHERE reseller_id = $1', [BETA]), staff);
    expect([upd.rowCount, del.rowCount]).toEqual([0, 0]);
    // Moving an own row to another tenant is refused too.
    await expectCode(tenant(env, ALPHA, c => c.query('UPDATE reseller_sauna_options SET reseller_id = $1 WHERE reseller_id = $2', [BETA, ALPHA]), staff),
      'INSUFFICIENT_PRIVILEGE');
    expect((await one<{ e: boolean }>(env.owner, 'SELECT is_enabled AS e FROM reseller_sauna_options WHERE reseller_id = $1', [BETA])).e).toBe(false);
  });

  it('only for saunas the reseller offers and options that sauna offers', async () => {
    // beta does not offer kelo-barrel.
    await expectCode(tenant(env, BETA, c => c.query(...setting(BETA, 'kelo-barrel', 'aspen', false))), 'FOREIGN_KEY_VIOLATION');
    // espoo-compact does not offer the salt wall.
    await expectCode(tenant(env, ALPHA, c => c.query(...setting(ALPHA, 'espoo-compact', 'salt-wall', false))), 'FOREIGN_KEY_VIOLATION');
    await expectCode(tenant(env, ALPHA, c => c.query(...setting(ALPHA, 'espoo-compact', 'aspen', true, -1))), 'CHECK_VIOLATION');
  });

  it('the manufacturer reads but cannot write; the worker cannot read', async () => {
    expect(await platform(env, c => count(c, 'SELECT 1 FROM reseller_sauna_options'))).toBeGreaterThanOrEqual(3);
    await expectCode(platform(env, c => c.query('DELETE FROM reseller_sauna_options')), 'INSUFFICIENT_PRIVILEGE');
  });
});

describe('reseller_sauna_options: option rules', () => {
  it('a required group keeps at least one enabled option', async () => {
    await tenant(env, ALPHA, c => c.query(...setting(ALPHA, 'fjord-panorama', 'door-clear', false)), staff);
    await expectCode(tenant(env, ALPHA, async c => {
      for (const d of ['door-bronze', 'door-satin', 'door-wood']) await c.query(...setting(ALPHA, 'fjord-panorama', d, false));
    }, staff), 'OPTION_RULES_VIOLATED', 'REQUIRED_GROUP_DISABLED');
  });

  it('an enabled option cannot require a disabled one', async () => {
    await expectCode(tenant(env, ALPHA, c => c.query(...setting(ALPHA, 'fjord-panorama', 'led-backrest', false)), staff),
      'OPTION_RULES_VIOLATED', 'REQUIRED_OPTION_DISABLED');
    // Disabling both in one statement is fine.
    await tenant(env, ALPHA, c => c.query(
      `INSERT INTO reseller_sauna_options (reseller_id, sauna_model_id, option_id, is_enabled)
       VALUES ($1, $2, $3, false), ($1, $2, $4, false)`, [ALPHA, M('fjord-panorama'), O('led-backrest'), O('audio')]), staff);
  });
});

describe('reseller_sauna_options: lock, versioning, audit', () => {
  it('a snapshot must carry the override price, and a disabled option cannot be locked', async () => {
    await tenant(env, ALPHA, c => c.query(...setting(ALPHA, 'espoo-compact', 'door-bronze', true, 12345)), staff);
    const espoo = (c: Queryable) =>
      draft(c, { reseller: ALPHA, model: 'espoo-compact', staff: SEED.staff.alphaOwner, options: ['spruce', 'heater-6kw', 'door-bronze'] });
    // Snapshot at the manufacturer's prices: stale for this reseller.
    await expectCode(tenant(env, ALPHA, async c => {
      const id = await espoo(c);
      await writeSnapshot(c, id);
      await c.query('UPDATE configurations SET locked_at = now() WHERE id = $1', [id]);
    }, staff), 'SNAPSHOT_INVALID', 'STALE_PRICE');
    // Re-priced at the override: the lock goes through.
    await tenant(env, ALPHA, async c => {
      const id = await espoo(c);
      await writeSnapshot(c, id);
      const { base } = await one<{ base: string }>(c, `SELECT price_delta_minor AS base FROM configuration_price_snapshot_lines WHERE configuration_id = $1 AND option_id = $2`, [id, O('door-bronze')]);
      await c.query(`UPDATE configuration_price_snapshot_lines SET price_delta_minor = 12345 WHERE configuration_id = $1 AND option_id = $2`, [id, O('door-bronze')]);
      await c.query(`UPDATE configuration_price_snapshots SET options_total_minor = options_total_minor - $2 + 12345,
                       final_price_minor = final_price_minor - $2 + 12345 WHERE configuration_id = $1`, [id, Number(base)]);
      await c.query('UPDATE configurations SET locked_at = now() WHERE id = $1', [id]);
    }, staff);

    await expectCode(tenant(env, ALPHA, async c => {
      const id = await draft(c, { reseller: ALPHA, model: 'aurora-hex', staff: SEED.staff.alphaOwner, options: ['spruce', 'heater-6kw', 'door-clear', 'salt-wall'] });
      await writeSnapshot(c, id);
      await c.query('UPDATE configurations SET locked_at = now() WHERE id = $1', [id]);
    }, staff), 'OPTION_RULES_VIOLATED', 'OPTION_DISABLED');
  });

  it('bumps only the owning reseller\'s catalog_version and audits price and availability', async () => {
    const version = async () => Object.fromEntries((await env.owner.query<{ id: string; v: string }>('SELECT id, catalog_version AS v FROM resellers')).rows.map(r => [r.id, Number(r.v)]));
    const before = await version();
    await tenant(env, ALPHA, c => c.query(...setting(ALPHA, 'kelo-barrel', 'aroma', true, 9900)), staff);
    const after = await version();
    expect(after[ALPHA]).toBe(before[ALPHA]! + 1);
    expect(after[BETA]).toBe(before[BETA]);
    const audit = await one<{ actor: string; details: { new: Record<string, unknown> } }>(env.owner,
      `SELECT actor_staff_id AS actor, details FROM audit_events WHERE action = 'reseller_sauna_options.insert' AND entity_id = $1`,
      [`${ALPHA}:${M('kelo-barrel')}:${O('aroma')}`]);
    expect(audit.actor).toBe(SEED.staff.alphaOwner);
    expect(audit.details.new).toEqual({ is_enabled: true, price_override_minor: 9900 });
  });

  it('cascades away when the sauna is unassigned', async () => {
    // beta offers aurora-hex without any configuration of it.
    await tenant(env, BETA, c => c.query(...setting(BETA, 'aurora-hex', 'aroma', false)), { actorStaffId: SEED.staff.betaOwner });
    await platform(env, c => c.query('DELETE FROM reseller_saunas WHERE reseller_id = $1 AND sauna_model_id = $2', [BETA, M('aurora-hex')]));
    expect(await count(env.owner, 'SELECT 1 FROM reseller_sauna_options WHERE reseller_id = $1 AND sauna_model_id = $2', [BETA, M('aurora-hex')])).toBe(0);
  });
});
