import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ALPHA, BETA, GAMMA, M, O, SEED, as, count, expectCode, one, ownerTx, platform, setupEnv, tenant, type Env } from './helpers.ts';

let env: Env;
beforeAll(async () => { env = await setupEnv(); });
afterAll(async () => { await env?.close(); });

const versions = async () => {
  const { rows } = await env.owner.query<{ id: string; v: number }>('SELECT id, catalog_version AS v FROM resellers');
  return Object.fromEntries(rows.map(r => [r.id, r.v])) as Record<string, number>;
};

/** A new ACTIVE model with prices in the given currencies and one wood option priced in optionCurrencies. */
async function newModel(c: pg.ClientBase, slug: string, currencies: string[], optionCurrencies = currencies, manufacturerId: string = SEED.manufacturerId, status = 'ACTIVE') {
  const { id } = await one<{ id: string }>(c, `INSERT INTO sauna_models (manufacturer_id, sku, slug, status, name)
    VALUES ($1, upper($2), $2, $3, $2) RETURNING id`, [manufacturerId, slug, status]);
  for (const cur of currencies) {
    await c.query(`INSERT INTO sauna_model_prices VALUES ($1, $2, 500000, 1000)`, [id, cur]);
  }
  await c.query(`INSERT INTO sauna_model_option_groups (sauna_model_id, option_group_id, is_required) VALUES ($1, $2, true)`, [id, SEED.groups('wood')]);
  await c.query(`INSERT INTO sauna_model_options (sauna_model_id, option_id, option_group_id, is_default) VALUES ($1, $2, $3, true)`, [id, O('spruce'), SEED.groups('wood')]);
  for (const cur of optionCurrencies) {
    await c.query(`INSERT INTO sauna_model_option_prices (sauna_model_id, option_id, currency_code, price_delta_minor) VALUES ($1, $2, $3, 0)`, [id, O('spruce'), cur]);
  }
  return id;
}

describe('rule 1: discounts within the cap', () => {
  it('accepts a per-sauna percent discount at the cap and rejects one above it', async () => {
    // lappi-barrel: cap 1200 bps
    await tenant(env, ALPHA, c => c.query(`UPDATE reseller_sauna_discounts SET discount_value = 1200 WHERE sauna_model_id = $1`, [M('lappi-barrel')]));
    await expectCode(tenant(env, ALPHA, c => c.query(`UPDATE reseller_sauna_discounts SET discount_value = 1201 WHERE sauna_model_id = $1`, [M('lappi-barrel')])),
      'DISCOUNT_EXCEEDS_CAP', 'PERCENT');
  });

  it('caps a fixed discount at floor(list × cap / 10000)', async () => {
    // espoo-compact EUR: 699000 × 1500 / 10000 = 104850
    await tenant(env, ALPHA, c => c.query(`UPDATE reseller_sauna_discounts SET discount_type = 'FIXED', discount_value = 104850 WHERE sauna_model_id = $1`, [M('espoo-compact')]));
    await expectCode(tenant(env, ALPHA, c => c.query(`UPDATE reseller_sauna_discounts SET discount_value = 104851 WHERE sauna_model_id = $1`, [M('espoo-compact')])),
      'DISCOUNT_EXCEEDS_CAP', 'FIXED');
  });

  it('checks a new per-sauna discount on insert', async () => {
    // turku-panorama cap 1000
    await expectCode(tenant(env, ALPHA, c => c.query(`INSERT INTO reseller_sauna_discounts VALUES ($1, $2, 'PERCENT', 1500)`, [ALPHA, M('turku-panorama')])), 'DISCOUNT_EXCEEDS_CAP');
    await tenant(env, ALPHA, c => c.query(`INSERT INTO reseller_sauna_discounts VALUES ($1, $2, 'PERCENT', 900)`, [ALPHA, M('turku-panorama')]));
  });

  it('checks the default discount against the lowest cap of the assigned saunas', async () => {
    // alpha's lowest cap is turku-panorama's 1000 bps
    await tenant(env, ALPHA, c => c.query(`UPDATE reseller_default_discounts SET discount_value = 1000`));
    await expectCode(tenant(env, ALPHA, c => c.query(`UPDATE reseller_default_discounts SET discount_value = 1001`)), 'DISCOUNT_EXCEEDS_CAP', 'PERCENT');
    const { min } = await one<{ min: number }>(env.owner,
      `SELECT min(p.list_price_minor * p.max_discount_bps / 10000) AS min FROM reseller_saunas rs
       JOIN sauna_model_prices p ON p.sauna_model_id = rs.sauna_model_id AND p.currency_code = 'EUR' WHERE rs.reseller_id = $1`, [ALPHA]);
    await tenant(env, ALPHA, c => c.query(`UPDATE reseller_default_discounts SET discount_type = 'FIXED', discount_value = $1`, [min]));
    await expectCode(tenant(env, ALPHA, c => c.query(`UPDATE reseller_default_discounts SET discount_value = $1`, [min + 1])), 'DISCOUNT_EXCEEDS_CAP', 'FIXED');
  });

  it('rejects a percent above 100 % (CHECK) even when no sauna is assigned yet', async () => {
    const { id } = await platform(env, c => one<{ id: string }>(c,
      `INSERT INTO resellers (manufacturer_id, slug, name, currency_code) VALUES ($1, 'zeta', 'Zeta', 'EUR') RETURNING id`, [SEED.manufacturerId]));
    await expectCode(tenant(env, id, c => c.query(`INSERT INTO reseller_default_discounts VALUES ($1, 'PERCENT', 10001)`, [id])), 'CHECK_VIOLATION');
    await tenant(env, id, c => c.query(`INSERT INTO reseller_default_discounts VALUES ($1, 'PERCENT', 5000)`, [id]));
  });
});

describe('rule 2: assignment', () => {
  it('assigns an ACTIVE, fully priced sauna of the same manufacturer', async () => {
    await platform(env, c => c.query(`INSERT INTO reseller_saunas (reseller_id, sauna_model_id) VALUES ($1, $2)`, [ALPHA, M('helsinki-studio')]));
    expect(await count(env.owner, 'SELECT 1 FROM reseller_saunas WHERE reseller_id = $1', [ALPHA])).toBe(6);
  });

  it('rejects a model that is not ACTIVE', async () => {
    const id = await ownerTx(env, c => newModel(c, 'draft-model', ['EUR'], ['EUR'], SEED.manufacturerId, 'DRAFT'));
    await expectCode(platform(env, c => c.query(`INSERT INTO reseller_saunas (reseller_id, sauna_model_id) VALUES ($1, $2)`, [ALPHA, id])),
      'SAUNA_NOT_ASSIGNABLE', 'NOT_ACTIVE');
  });

  it('rejects a model of another manufacturer', async () => {
    const id = await ownerTx(env, async c => {
      const { id: mf } = await one<{ id: string }>(c, `INSERT INTO manufacturers (name) VALUES ('Other Saunas') RETURNING id`);
      return newModel(c, 'other-maker', ['EUR'], ['EUR'], mf);
    });
    await expectCode(platform(env, c => c.query(`INSERT INTO reseller_saunas (reseller_id, sauna_model_id) VALUES ($1, $2)`, [ALPHA, id])),
      'SAUNA_NOT_ASSIGNABLE', 'MANUFACTURER_MISMATCH');
  });

  it('requires a list price in the reseller currency', async () => {
    const id = await ownerTx(env, c => newModel(c, 'eur-only', ['EUR']));
    await expectCode(platform(env, c => c.query(`INSERT INTO reseller_saunas (reseller_id, sauna_model_id) VALUES ($1, $2)`, [BETA, id])),
      'SAUNA_NOT_ASSIGNABLE', 'PRICE_MISSING');
  });

  it('requires a price for every option of the model in the reseller currency (C4)', async () => {
    const id = await ownerTx(env, c => newModel(c, 'chf-no-option-price', ['EUR', 'CHF'], ['EUR']));
    await expectCode(platform(env, c => c.query(`INSERT INTO reseller_saunas (reseller_id, sauna_model_id) VALUES ($1, $2)`, [BETA, id])),
      'SAUNA_NOT_ASSIGNABLE', 'OPTION_PRICE_MISSING');
  });

  it('re-checks at commit when a price of an assigned model disappears (deferred)', async () => {
    // beta sells espoo-compact in CHF
    await expectCode(platform(env, c => c.query(`DELETE FROM sauna_model_option_prices WHERE sauna_model_id = $1 AND option_id = $2 AND currency_code = 'CHF'`,
      [M('espoo-compact'), O('aspen')])), 'SAUNA_NOT_ASSIGNABLE', 'ASSIGNED_PRICE_MISSING');
    await expectCode(platform(env, c => c.query(`DELETE FROM sauna_model_prices WHERE sauna_model_id = $1 AND currency_code = 'CHF'`, [M('espoo-compact')])),
      'SAUNA_NOT_ASSIGNABLE', 'ASSIGNED_PRICE_MISSING');
    // Nobody sells helsinki-studio in SEK: removing that price is fine.
    await platform(env, c => c.query(`DELETE FROM sauna_model_prices WHERE sauna_model_id = $1 AND currency_code = 'SEK'`, [M('helsinki-studio')]));
  });

  it('re-checks a new option on an assigned model at commit, allowing prices added in the same transaction', async () => {
    const addOption = (c: pg.ClientBase) => c.query(
      `INSERT INTO sauna_model_options (sauna_model_id, option_id, option_group_id) VALUES ($1, $2, $3)`,
      [M('espoo-compact'), O('salt-wall'), SEED.groups('extras')]);
    await expectCode(as(env, 'catalog_admin', {}, addOption), 'SAUNA_NOT_ASSIGNABLE', 'ASSIGNED_PRICE_MISSING');
    await as(env, 'catalog_admin', {}, async c => {
      await addOption(c);
      for (const cur of ['EUR', 'CHF', 'SEK']) {
        await c.query(`INSERT INTO sauna_model_option_prices VALUES ($1, $2, $3, 99000)`, [M('espoo-compact'), O('salt-wall'), cur]);
      }
    });
  });

  it('rejects a room scene that is not ACTIVE', async () => {
    const room = await ownerTx(env, c => one<{ id: string }>(c,
      `INSERT INTO room_scenes (manufacturer_id, code, name, status) VALUES ($1, 'draft-room', 'Draft', 'DRAFT') RETURNING id`, [SEED.manufacturerId]));
    await expectCode(platform(env, c => c.query(`INSERT INTO reseller_room_scenes (reseller_id, room_scene_id) VALUES ($1, $2)`, [BETA, room.id])),
      'ROOM_NOT_ASSIGNABLE');
  });

  it('app_tenant cannot assign saunas, change prices or create resellers', async () => {
    await expectCode(tenant(env, ALPHA, c => c.query(`INSERT INTO reseller_saunas (reseller_id, sauna_model_id) VALUES ($1, $2)`, [ALPHA, M('helsinki-studio')])),
      'INSUFFICIENT_PRIVILEGE');
    await expectCode(tenant(env, ALPHA, c => c.query(`UPDATE sauna_model_prices SET list_price_minor = 1 WHERE currency_code = 'EUR'`)), 'INSUFFICIENT_PRIVILEGE');
    await expectCode(tenant(env, ALPHA, c => c.query(`UPDATE sauna_model_option_prices SET price_delta_minor = 0`)), 'INSUFFICIENT_PRIVILEGE');
    await expectCode(tenant(env, ALPHA, c => c.query(
      `INSERT INTO resellers (manufacturer_id, slug, name, currency_code) VALUES ($1, 'rogue', 'Rogue', 'EUR')`, [SEED.manufacturerId])), 'INSUFFICIENT_PRIVILEGE');
    await expectCode(tenant(env, ALPHA, c => c.query(`UPDATE resellers SET status = 'ACTIVE' WHERE id = $1`, [ALPHA])), 'INSUFFICIENT_PRIVILEGE');
    await expectCode(tenant(env, ALPHA, c => c.query(`UPDATE reseller_saunas SET sauna_model_id = $1`, [M('helsinki-studio')])), 'INSUFFICIENT_PRIVILEGE');
    await expectCode(tenant(env, ALPHA, c => c.query(`UPDATE resellers SET catalog_version = 1 WHERE id = $1`, [ALPHA])), 'INSUFFICIENT_PRIVILEGE');
  });
});

describe('rule 3: slugs', () => {
  const create = (slug: string) => platform(env, c => c.query(
    `INSERT INTO resellers (manufacturer_id, slug, name, currency_code) VALUES ($1, $2, 'X', 'EUR')`, [SEED.manufacturerId, slug]));

  it('accepts a well-formed slug', async () => {
    await create('delta-spa');
  });
  it('rejects reserved slugs on insert and update', async () => {
    await expectCode(create('admin'), 'SLUG_RESERVED');
    await expectCode(platform(env, c => c.query(`UPDATE resellers SET slug = 'www' WHERE id = $1`, [ALPHA])), 'SLUG_RESERVED');
  });
  it('rejects malformed slugs', async () => {
    for (const slug of ['Bad_Slug', '-alpha', 'alpha-', 'a'.repeat(33), '', 'ä']) await expectCode(create(slug), 'SLUG_INVALID');
  });
  it('rejects a duplicate slug', async () => {
    await expectCode(create('alpha'), 'UNIQUE_VIOLATION');
  });
  it('keeps currency and manufacturer immutable', async () => {
    await expectCode(platform(env, c => c.query(`UPDATE resellers SET currency_code = 'CHF' WHERE id = $1`, [ALPHA])), 'RESELLER_IMMUTABLE_FIELD');
  });
});

describe('rule 9: catalog_version bumps only affected resellers', () => {
  it('a EUR price change bumps the EUR resellers offering the model only', async () => {
    const before = await versions();
    await platform(env, c => c.query(`UPDATE sauna_model_prices SET list_price_minor = list_price_minor + 100 WHERE sauna_model_id = $1 AND currency_code = 'EUR'`,
      [M('kuopio-cube')]));
    const after = await versions();
    expect(after[ALPHA]).toBe(before[ALPHA]! + 1);
    expect(after[BETA]).toBe(before[BETA]); // CHF
    expect(after[GAMMA]).toBe(before[GAMMA]); // SEK
  });

  it('a CHF option price change bumps beta only', async () => {
    const before = await versions();
    await platform(env, c => c.query(`UPDATE sauna_model_option_prices SET price_delta_minor = price_delta_minor + 100
      WHERE sauna_model_id = $1 AND currency_code = 'CHF'`, [M('turku-panorama')]));
    const after = await versions();
    expect([after[ALPHA]! - before[ALPHA]!, after[BETA]! - before[BETA]!, after[GAMMA]! - before[GAMMA]!]).toEqual([0, 1, 0]);
  });

  it('tenant discount, visibility and branding changes bump that tenant only', async () => {
    const before = await versions();
    await tenant(env, BETA, async c => {
      await c.query(`UPDATE reseller_saunas SET is_visible = false WHERE sauna_model_id = $1`, [M('kuopio-cube')]);
      await c.query(`UPDATE reseller_branding SET tagline = 'New' WHERE reseller_id = $1`, [BETA]);
    });
    const after = await versions();
    expect(after[BETA]).toBeGreaterThan(before[BETA]!);
    expect(after[ALPHA]).toBe(before[ALPHA]);
  });

  it('a model status/name change bumps every reseller offering it; an option rename bumps resellers whose models offer it', async () => {
    const before = await versions();
    await platform(env, c => c.query(`UPDATE sauna_models SET sort_order = 99 WHERE id = $1`, [M('oulu-corner')])); // alpha, gamma
    const mid = await versions();
    expect([mid[ALPHA]! - before[ALPHA]!, mid[BETA]! - before[BETA]!, mid[GAMMA]! - before[GAMMA]!]).toEqual([1, 0, 1]);
    await as(env, 'catalog_admin', {}, c => c.query(`UPDATE options SET name = 'Wood stove' WHERE id = $1`, [O('heater-wood')]));
    const after = await versions();
    // heater-wood: lappi (alpha, gamma), turku (alpha, beta), kuopio (all), helsinki (alpha, beta)
    expect([after[ALPHA]! - mid[ALPHA]!, after[BETA]! - mid[BETA]!, after[GAMMA]! - mid[GAMMA]!]).toEqual([1, 1, 1]);
  });

  it('bump_all_catalog_versions() bumps everyone (import pipeline)', async () => {
    const before = await versions();
    await as(env, 'catalog_admin', {}, c => c.query('SELECT bump_all_catalog_versions()'));
    const after = await versions();
    for (const id of [ALPHA, BETA, GAMMA]) expect(after[id]).toBe(before[id]! + 1);
  });
});

describe('rule 10: TENANT_SYNC outbox', () => {
  const syncs = (c: pg.ClientBase, id: string) =>
    c.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM notification_outbox WHERE event_type = 'TENANT_SYNC' AND reseller_id = $1 ORDER BY id`, [id]);

  it('writes TENANT_SYNC on create, status change and slug change, but not on other changes', async () => {
    const { id } = await platform(env, c => one<{ id: string }>(c,
      `INSERT INTO resellers (manufacturer_id, slug, name, currency_code) VALUES ($1, 'epsilon', 'Epsilon', 'NOK') RETURNING id`, [SEED.manufacturerId]));
    await platform(env, c => c.query(`UPDATE resellers SET name = 'Epsilon AS' WHERE id = $1`, [id]));
    await platform(env, c => c.query(`UPDATE resellers SET status = 'SUSPENDED' WHERE id = $1`, [id]));
    await platform(env, c => c.query(`UPDATE resellers SET slug = 'epsilon-spa' WHERE id = $1`, [id]));
    const { rows } = await syncs(env.owner, id);
    expect(rows.map(r => r.payload)).toEqual([
      { resellerId: id, slug: 'epsilon', previousSlug: null, status: 'ACTIVE' },
      { resellerId: id, slug: 'epsilon', previousSlug: null, status: 'SUSPENDED' },
      { resellerId: id, slug: 'epsilon-spa', previousSlug: 'epsilon', status: 'SUSPENDED' },
    ]);
  });
});

describe('rule 11: audit trail', () => {
  it('records price changes with the acting staff user and old/new values', async () => {
    await platform(env, c => c.query(`UPDATE sauna_model_prices SET max_discount_bps = 1300 WHERE sauna_model_id = $1 AND currency_code = 'EUR'`, [M('lappi-barrel')]));
    const ev = await one<{ actor_staff_id: string; details: { old: { max_discount_bps: number }; new: { max_discount_bps: number } } }>(env.owner,
      `SELECT actor_staff_id, details FROM audit_events WHERE action = 'sauna_model_prices.update' AND entity_id = $1 ORDER BY id DESC LIMIT 1`,
      [`${M('lappi-barrel')}:EUR`]);
    expect(ev.actor_staff_id).toBe(SEED.staff.admin);
    expect([ev.details.old.max_discount_bps, ev.details.new.max_discount_bps]).toEqual([1200, 1300]);
  });

  it('records tenant discount changes under the tenant, readable by that tenant only', async () => {
    await tenant(env, ALPHA, c => c.query(`DELETE FROM reseller_sauna_discounts WHERE sauna_model_id = $1`, [M('turku-panorama')]), { actorStaffId: SEED.staff.alphaOwner });
    const seen = await tenant(env, ALPHA, c => count(c, `SELECT 1 FROM audit_events WHERE action = 'reseller_sauna_discounts.delete'`));
    expect(seen).toBe(1);
    expect(await tenant(env, BETA, c => count(c, `SELECT 1 FROM audit_events WHERE action = 'reseller_sauna_discounts.delete'`))).toBe(0);
  });

  it('records reseller status changes and assignments', async () => {
    await platform(env, c => c.query(`UPDATE resellers SET status = 'ACTIVE' WHERE id = $1`, [GAMMA]));
    const ev = await one<{ details: unknown }>(env.owner, `SELECT details FROM audit_events WHERE action = 'resellers.update' AND reseller_id = $1`, [GAMMA]);
    expect(ev.details).toEqual({ old: { status: 'SUSPENDED' }, new: { status: 'ACTIVE' } });
    expect(await count(env.owner, `SELECT 1 FROM audit_events WHERE action = 'reseller_saunas.insert' AND reseller_id = $1`, [ALPHA])).toBeGreaterThanOrEqual(6);
  });

  it('is append-only', async () => {
    await expectCode(platform(env, c => c.query(`UPDATE audit_events SET action = 'x'`)), 'INSUFFICIENT_PRIVILEGE');
    await expectCode(env.owner.query(`UPDATE audit_events SET action = 'x'`), 'APPEND_ONLY');
  });
});

describe('catalog_admin', () => {
  it('writes catalog tables but cannot read tenant data', async () => {
    await as(env, 'catalog_admin', {}, c => c.query(`INSERT INTO option_translations (option_id, locale, name) VALUES ($1, 'rm', 'Pign')`, [O('spruce')]));
    await expectCode(as(env, 'catalog_admin', {}, c => c.query('SELECT * FROM customers')), 'INSUFFICIENT_PRIVILEGE');
    await expectCode(as(env, 'catalog_admin', {}, c => c.query('SELECT * FROM configurations')), 'INSUFFICIENT_PRIVILEGE');
    await expectCode(as(env, 'catalog_admin', {}, c => c.query('SELECT * FROM resellers')), 'INSUFFICIENT_PRIVILEGE');
    await expectCode(as(env, 'catalog_admin', {}, c => c.query(
      `INSERT INTO assets (owner_reseller_id, storage_key, content_type) VALUES ($1, 'branding/alpha/x.png', 'image/png')`, [ALPHA])),
      'INSUFFICIENT_PRIVILEGE');
  });
});
