import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ALPHA, BETA, M, O, SEED, VALID_ESPOO, count, draft, expectCode, lock, one, setupEnv, tenant, writeSnapshot, type Env } from './helpers.ts';

let env: Env;
beforeAll(async () => { env = await setupEnv(); });
afterAll(async () => { await env?.close(); });

const anna = SEED.customers.annaAlpha;
const alphaTx = <T>(fn: (c: pg.PoolClient) => Promise<T>) => tenant(env, ALPHA, fn, { actorStaffId: SEED.staff.alphaOwner });

describe('rule 4: configurations', () => {
  it('accepts a configuration for an offered sauna and a customer of the same reseller', async () => {
    const id = await alphaTx(c => draft(c, { reseller: ALPHA, model: 'espoo-compact', customer: anna, options: VALID_ESPOO }));
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects a sauna the reseller does not offer', async () => {
    await expectCode(alphaTx(c => draft(c, { reseller: ALPHA, model: 'helsinki-studio', customer: anna, options: [] })), 'FOREIGN_KEY_VIOLATION');
  });

  it('rejects a customer of another reseller', async () => {
    await expectCode(alphaTx(c => draft(c, { reseller: ALPHA, model: 'espoo-compact', customer: SEED.customers.annaBeta, options: [] })),
      'FOREIGN_KEY_VIOLATION');
  });

  it('requires an owner (customer or staff)', async () => {
    await expectCode(alphaTx(c => draft(c, { reseller: ALPHA, model: 'espoo-compact', options: [] })), 'CHECK_VIOLATION');
  });

  it('accepts a staff-prepared draft only by an admin of the reseller', async () => {
    await alphaTx(c => draft(c, { reseller: ALPHA, model: 'espoo-compact', staff: SEED.staff.alphaOwner, options: [] }));
    await expectCode(alphaTx(c => draft(c, { reseller: ALPHA, model: 'espoo-compact', staff: SEED.staff.betaOwner, options: [] })),
      'STAFF_NOT_RESELLER_ADMIN');
  });

  it('rejects a configuration created already locked', async () => {
    await expectCode(alphaTx(c => c.query(`INSERT INTO configurations (reseller_id, sauna_model_id, customer_id, locked_at) VALUES ($1, $2, $3, now())`,
      [ALPHA, M('espoo-compact'), anna])), 'SNAPSHOT_MISSING');
  });
});

describe('rule 5: selections', () => {
  it('rejects an option the model does not offer', async () => {
    // espoo-compact has no 9 kW heater
    await expectCode(alphaTx(c => draft(c, { reseller: ALPHA, model: 'espoo-compact', customer: anna, options: ['heater-9kw'] })), 'FOREIGN_KEY_VIOLATION');
  });

  it('rejects a selection whose model differs from the configuration model', async () => {
    await expectCode(alphaTx(async c => {
      const id = await draft(c, { reseller: ALPHA, model: 'espoo-compact', customer: anna, options: [] });
      await c.query(`INSERT INTO configuration_selections (configuration_id, sauna_model_id, option_id) VALUES ($1, $2, $3)`,
        [id, M('lappi-barrel'), O('heater-9kw')]);
    }), 'FOREIGN_KEY_VIOLATION');
  });

  it('allows one option per SINGLE group', async () => {
    await expectCode(alphaTx(c => draft(c, { reseller: ALPHA, model: 'espoo-compact', customer: anna, options: ['spruce', 'aspen'] })),
      'OPTION_RULES_VIOLATED', 'SINGLE_GROUP_MULTIPLE');
  });

  it('allows several options in a MULTI group', async () => {
    await alphaTx(c => draft(c, { reseller: ALPHA, model: 'lappi-barrel', customer: anna, options: ['led-backrest', 'led-underbench', 'star-ceiling'] }));
  });

  it('lets a draft switch its SINGLE option by delete + insert', async () => {
    await alphaTx(async c => {
      const id = await draft(c, { reseller: ALPHA, model: 'espoo-compact', customer: anna, options: ['spruce'] });
      await c.query(`DELETE FROM configuration_selections WHERE configuration_id = $1 AND option_id = $2`, [id, O('spruce')]);
      await c.query(`INSERT INTO configuration_selections VALUES ($1, $2, $3)`, [id, M('espoo-compact'), O('aspen')]);
    });
  });
});

describe('rule 6: locking', () => {
  it('requires a price snapshot', async () => {
    await expectCode(alphaTx(async c => {
      const id = await draft(c, { reseller: ALPHA, model: 'espoo-compact', customer: anna, options: VALID_ESPOO });
      await c.query(`UPDATE configurations SET locked_at = now() WHERE id = $1`, [id]);
    }), 'SNAPSHOT_MISSING');
  });

  it('requires every required group to be filled', async () => {
    await expectCode(alphaTx(async c => {
      lockLater = await draft(c, { reseller: ALPHA, model: 'espoo-compact', customer: anna, options: ['spruce', 'heater-6kw'] }); // no door
      await lock(c, lockLater);
    }), 'OPTION_RULES_VIOLATED', 'REQUIRED_GROUP_EMPTY');
  });

  it('requires "requires" rules to be satisfied', async () => {
    await expectCode(alphaTx(async c => lock(c, await draft(c, { reseller: ALPHA, model: 'lappi-barrel', customer: anna,
      options: ['spruce', 'heater-9kw', 'door-clear', 'audio'] }))), 'OPTION_RULES_VIOLATED', 'REQUIRES_MISSING');
  });

  it('rejects excluded pairs', async () => {
    await expectCode(alphaTx(async c => lock(c, await draft(c, { reseller: ALPHA, model: 'lappi-barrel', customer: anna,
      options: ['aspen', 'heater-wood', 'control-basic', 'door-clear'] }))), 'OPTION_RULES_VIOLATED', 'EXCLUDED_PAIR');
  });

  it('rejects a snapshot whose lines do not match the selections', async () => {
    await expectCode(alphaTx(async c => {
      const id = await draft(c, { reseller: ALPHA, model: 'espoo-compact', customer: anna, options: VALID_ESPOO });
      await writeSnapshot(c, id);
      await c.query(`DELETE FROM configuration_price_snapshot_lines WHERE configuration_id = $1 AND option_id = $2`, [id, O('spruce')]);
      await c.query(`UPDATE configurations SET locked_at = now() WHERE id = $1`, [id]);
    }), 'SNAPSHOT_INVALID', 'LINES');
  });

  it('rejects a snapshot with a stale or fabricated list price', async () => {
    await expectCode(alphaTx(async c => {
      const id = await draft(c, { reseller: ALPHA, model: 'espoo-compact', customer: anna, options: VALID_ESPOO });
      await writeSnapshot(c, id);
      await c.query(`UPDATE configuration_price_snapshots SET list_price_minor = list_price_minor - 1000, final_price_minor = final_price_minor - 1000
                     WHERE configuration_id = $1`, [id]);
      await c.query(`UPDATE configurations SET locked_at = now() WHERE id = $1`, [id]);
    }), 'SNAPSHOT_INVALID', 'STALE_PRICE');
  });

  let locked = '';
  let lockLater = '';
  it('locks a complete, rule-valid configuration with a matching snapshot', async () => {
    locked = await alphaTx(async c => {
      const id = await draft(c, { reseller: ALPHA, model: 'lappi-barrel', customer: anna, options: ['aspen', 'heater-9kw', 'door-clear', 'led-backrest', 'audio'] });
      await c.query(`INSERT INTO configuration_room_placements (configuration_id, reseller_id, room_scene_id, position_x_mm) VALUES ($1, $2, $3, 500)`,
        [id, ALPHA, SEED.rooms('garden-deck')]);
      await lock(c, id);
      return id;
    });
    expect((await one<{ l: Date | null }>(env.owner, 'SELECT locked_at AS l FROM configurations WHERE id = $1', [locked])).l).not.toBeNull();
  });

  it('makes a locked configuration and all its parts immutable', async () => {
    const attempts: [string, unknown[]][] = [
      [`UPDATE configurations SET name = 'renamed' WHERE id = $1`, [locked]],
      [`UPDATE configurations SET locked_at = NULL WHERE id = $1`, [locked]],
      [`DELETE FROM configurations WHERE id = $1`, [locked]],
      [`INSERT INTO configuration_selections VALUES ($1, $2, $3)`, [locked, M('lappi-barrel'), O('aroma')]],
      [`DELETE FROM configuration_selections WHERE configuration_id = $1`, [locked]],
      [`UPDATE configuration_price_snapshots SET price_valid_until = now() + interval '90 days' WHERE configuration_id = $1`, [locked]],
      [`DELETE FROM configuration_price_snapshot_lines WHERE configuration_id = $1`, [locked]],
      [`UPDATE configuration_room_placements SET position_x_mm = 0 WHERE configuration_id = $1`, [locked]],
      [`DELETE FROM configuration_room_placements WHERE configuration_id = $1`, [locked]],
    ];
    for (const [text, values] of attempts) await expectCode(alphaTx(c => c.query(text, values)), 'CONFIGURATION_LOCKED');
    // Not even the owner (superuser) can bypass the rule.
    await expectCode(env.owner.query(`UPDATE configurations SET name = 'x' WHERE id = $1`, [locked]), 'CONFIGURATION_LOCKED');
  });

  it('allows deleting a draft (with its selections)', async () => {
    const id = await alphaTx(c => draft(c, { reseller: ALPHA, model: 'espoo-compact', customer: anna, options: VALID_ESPOO }));
    await alphaTx(c => c.query('DELETE FROM configurations WHERE id = $1', [id]));
    expect(await count(env.owner, 'SELECT 1 FROM configuration_selections WHERE configuration_id = $1', [id])).toBe(0);
  });

  it('keeps clones inside the tenant', async () => {
    await alphaTx(c => c.query(`INSERT INTO configurations (reseller_id, sauna_model_id, customer_id, source_configuration_id)
      VALUES ($1, $2, $3, $4)`, [ALPHA, M('lappi-barrel'), anna, locked]));
    await expectCode(tenant(env, BETA, c => c.query(`INSERT INTO configurations (reseller_id, sauna_model_id, customer_id, source_configuration_id)
      VALUES ($1, $2, $3, $4)`, [BETA, M('espoo-compact'), SEED.customers.annaBeta, locked])), 'FOREIGN_KEY_VIOLATION');
  });

  it('only places a sauna in a room the reseller offers', async () => {
    // beta does not offer basement-spa
    await expectCode(tenant(env, BETA, async c => {
      const id = await draft(c, { reseller: BETA, model: 'espoo-compact', customer: SEED.customers.annaBeta, options: [] });
      await c.query(`INSERT INTO configuration_room_placements (configuration_id, reseller_id, room_scene_id) VALUES ($1, $2, $3)`,
        [id, BETA, SEED.rooms('basement-spa')]);
    }), 'FOREIGN_KEY_VIOLATION');
  });
});

describe('rule 8: snapshot and share-link checks', () => {
  const snapshot = (fields: Record<string, unknown>) => alphaTx(async c => {
    const id = await draft(c, { reseller: ALPHA, model: 'espoo-compact', customer: anna, options: [] });
    const row = { list_price_minor: 1000, options_total_minor: 0, discount_amount_minor: 0, final_price_minor: 1000,
      discount_source: 'NONE', discount_type: null, discount_value: null, max_discount_bps: 1000, ...fields };
    await c.query(`INSERT INTO configuration_price_snapshots (configuration_id, currency_code, list_price_minor, options_total_minor,
      discount_amount_minor, final_price_minor, discount_source, discount_type, discount_value, max_discount_bps)
      VALUES ($1, 'EUR', $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, row.list_price_minor, row.options_total_minor, row.discount_amount_minor, row.final_price_minor,
       row.discount_source, row.discount_type, row.discount_value, row.max_discount_bps]);
  });

  it('accepts consistent snapshot arithmetic', async () => {
    await snapshot({ discount_amount_minor: 100, final_price_minor: 900, discount_source: 'DEFAULT', discount_type: 'PERCENT', discount_value: 1000 });
  });
  it('rejects final <> list + options - discount', async () => {
    await expectCode(snapshot({ final_price_minor: 999 }), 'CHECK_VIOLATION');
  });
  it('rejects a discount above the cap or the subtotal', async () => {
    await expectCode(snapshot({ discount_amount_minor: 101, final_price_minor: 899, discount_source: 'SAUNA', discount_type: 'FIXED', discount_value: 101 }),
      'CHECK_VIOLATION');
  });
  it('rejects a discount without a source', async () => {
    await expectCode(snapshot({ discount_amount_minor: 10, final_price_minor: 990 }), 'CHECK_VIOLATION');
  });

  const link = (configurationId: string, fields: { expires?: string; hash?: Buffer } = {}) => alphaTx(c => c.query(
    `INSERT INTO share_links (reseller_id, configuration_id, token_hash, created_by_staff_id, expires_at)
     VALUES ($1, $2, $3, $4, now() + $5::interval) RETURNING id`,
    [ALPHA, configurationId, fields.hash ?? createHash('sha256').update(randomBytes(32)).digest(), SEED.staff.alphaOwner, fields.expires ?? '30 days']));

  it('shares only locked configurations', async () => {
    const id = await alphaTx(c => draft(c, { reseller: ALPHA, model: 'espoo-compact', customer: anna, options: [] }));
    await expectCode(link(id), 'CONFIGURATION_NOT_LOCKED');
  });

  it('enforces expiry within (created, created + 90 days] and a 32-byte hash', async () => {
    const shared = SEED.configurations.staffShared;
    await link(shared, { expires: '90 days' });
    await expectCode(link(shared, { expires: '91 days' }), 'CHECK_VIOLATION');
    await expectCode(link(shared, { expires: '-1 minute' }), 'CHECK_VIOLATION');
    await expectCode(link(shared, { hash: randomBytes(31) }), 'CHECK_VIOLATION');
  });

  it('allows revoking once; nothing else on a link changes', async () => {
    const shared = SEED.configurations.staffShared;
    const { rows } = await link(shared);
    const id = (rows[0] as { id: string }).id;
    await alphaTx(c => c.query(`UPDATE share_links SET revoked_at = now() WHERE id = $1`, [id]));
    await expectCode(alphaTx(c => c.query(`UPDATE share_links SET revoked_at = NULL WHERE id = $1`, [id])), 'SHARE_LINK_IMMUTABLE');
    await expectCode(alphaTx(c => c.query(`UPDATE share_links SET expires_at = now() WHERE id = $1`, [id])), 'INSUFFICIENT_PRIVILEGE');
    await expectCode(env.owner.query(`UPDATE share_links SET expires_at = now() + interval '1 day' WHERE id = $1`, [id]), 'SHARE_LINK_IMMUTABLE');
  });

  it('records views with a device class and no other data; views are append-only', async () => {
    await alphaTx(c => c.query(`INSERT INTO share_link_views (share_link_id, reseller_id, device_class) VALUES ($1, $2, 'TABLET')`, [SEED.shareLinkId, ALPHA]));
    await expectCode(alphaTx(c => c.query(`INSERT INTO share_link_views (share_link_id, reseller_id, device_class) VALUES ($1, $2, 'TOASTER')`,
      [SEED.shareLinkId, ALPHA])), 'CHECK_VIOLATION');
    await expectCode(alphaTx(c => c.query(`UPDATE share_link_views SET device_class = 'OTHER'`)), 'INSUFFICIENT_PRIVILEGE');
  });
});
